const {
    createAdminClient, requireRecruiter, writeAuditLog,
    sendSubmitConfirmation, sendAdminNewSubmission,
    sendError, handleOptions, ADMIN_EMAIL,
} = require('../../_lib');

// POST /api/portal/roles/:id/submit
// Transitions status draft → submitted. Sends emails to recruiter + admin.

module.exports = async function handler(req, res) {
    if (handleOptions(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { user, profile } = await requireRecruiter(req);
        const admin = createAdminClient();
        const orgId = profile.organisation_id;
        const roleId = req.query.id;

        const { data: role, error: roleErr } = await admin
            .from('roles').select('*').eq('id', roleId).eq('organisation_id', orgId).single();
        if (roleErr || !role) return res.status(404).json({ error: 'Role not found' });
        if (role.status !== 'draft') {
            return res.status(409).json({ error: `Role is already ${role.status}` });
        }
        if (!role.title?.trim()) {
            return res.status(400).json({ error: 'Add a role title before submitting' });
        }

        // Count CVs
        const { count: cvCount } = await admin
            .from('uploads')
            .select('id', { count: 'exact', head: true })
            .eq('role_id', roleId);
        if (!cvCount || cvCount === 0) {
            return res.status(400).json({ error: 'Upload at least one CV before submitting' });
        }

        // Transition status
        const { data: updated, error: updateErr } = await admin
            .from('roles')
            .update({ status: 'submitted', submitted_at: new Date().toISOString() })
            .eq('id', roleId)
            .select()
            .single();
        if (updateErr) throw updateErr;

        await writeAuditLog(admin, {
            userId: user.id, action: 'submit', roleId,
            meta: { cv_count: cvCount, title: role.title },
        });

        // Get org name and recruiter email for emails
        const [{ data: org }, { data: { user: authUser } }] = await Promise.all([
            admin.from('organisations').select('name').eq('id', orgId).single(),
            admin.auth.admin.getUserById(user.id),
        ]);

        const recruiterName = (await admin.from('rec_profiles')
            .select('full_name').eq('user_id', user.id).single()).data?.full_name;

        // Fire emails — don't let a send failure block the response
        await Promise.allSettled([
            sendSubmitConfirmation({
                recruiterEmail: authUser.email,
                recruiterName:  recruiterName,
                roleTitle:      role.title,
                orgName:        org?.name,
            }),
            sendAdminNewSubmission({
                recruiterEmail: authUser.email,
                orgName:        org?.name ?? '',
                roleTitle:      role.title,
                cvCount,
                roleId,
            }),
        ]);

        return res.status(200).json({ role: updated });

    } catch (err) {
        return sendError(res, err);
    }
};

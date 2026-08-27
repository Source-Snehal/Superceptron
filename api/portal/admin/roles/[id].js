const {
    createAdminClient, requireAdmin, writeAuditLog,
    sendError, handleOptions,
} = require('../../_lib');

// GET   /api/portal/admin/roles/:id  — full role detail for admin view
// PATCH /api/portal/admin/roles/:id  — update notes or status (admin-only transitions)

const VALID_TRANSITIONS = {
    draft:            ['submitted'],         // shouldn't normally happen manually
    submitted:        ['in_review', 'draft'], // can send back if needed
    in_review:        ['shortlist_ready', 'submitted'],
    shortlist_ready:  [],                    // terminal after delivery; use deliver endpoint
};

module.exports = async function handler(req, res) {
    if (handleOptions(req, res)) return;

    try {
        const { user } = await requireAdmin(req);
        const admin = createAdminClient();
        const roleId = req.query.id;
        if (!roleId) return res.status(400).json({ error: 'Missing role id' });

        if (req.method === 'GET') {
            const { data: role, error } = await admin
                .from('roles')
                .select(`*, organisations(id, name), uploads(*), deliverables(*)`)
                .eq('id', roleId)
                .single();
            if (error || !role) return res.status(404).json({ error: 'Role not found' });

            // Get recruiter contact email
            const { data: ownerProfile } = await admin
                .from('rec_profiles')
                .select('user_id, full_name')
                .eq('organisation_id', role.organisations?.id)
                .eq('is_owner', true)
                .single();
            let recruiterEmail = null;
            if (ownerProfile) {
                const { data: { user: u } } = await admin.auth.admin.getUserById(ownerProfile.user_id);
                recruiterEmail = u?.email ?? null;
            }

            // Audit trail for this role
            const { data: auditLog } = await admin
                .from('audit_log')
                .select('action, file_path, meta, created_at, user_id')
                .eq('role_id', roleId)
                .order('created_at', { ascending: false })
                .limit(50);

            return res.status(200).json({
                role,
                recruiter_email: recruiterEmail,
                recruiter_name:  ownerProfile?.full_name ?? null,
                audit_log:       auditLog ?? [],
            });
        }

        if (req.method === 'PATCH') {
            const { data: current } = await admin
                .from('roles').select('status, notes').eq('id', roleId).single();
            if (!current) return res.status(404).json({ error: 'Role not found' });

            const body = req.body ?? {};
            const updates = {};

            if ('notes' in body) updates.notes = body.notes ?? null;

            if ('status' in body && body.status !== current.status) {
                const allowed = VALID_TRANSITIONS[current.status] ?? [];
                if (!allowed.includes(body.status)) {
                    return res.status(400).json({
                        error: `Cannot transition from ${current.status} to ${body.status}`,
                    });
                }
                updates.status = body.status;
            }

            if (Object.keys(updates).length === 0) {
                return res.status(400).json({ error: 'Nothing to update' });
            }

            const { data: updated, error } = await admin
                .from('roles').update(updates).eq('id', roleId).select().single();
            if (error) throw error;

            if (updates.status) {
                await writeAuditLog(admin, {
                    userId: user.id, action: 'status_change', roleId,
                    meta: { from: current.status, to: updates.status },
                });
            }

            return res.status(200).json({ role: updated });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (err) {
        return sendError(res, err);
    }
};

const {
    createAdminClient, sendApprovalConfirmation, sendError,
} = require('../_lib');

// GET /api/portal/auth/approve?token=<uuid>&uid=<user_id>
// No auth required — the token IS the credential (single-use uuid).
// Activates a pending rec_profiles row. Redirects to a confirmation page.

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { token, uid } = req.query ?? {};
        if (!token || !uid) {
            return res.redirect('/portal-approve.html?error=missing_params');
        }

        const admin = createAdminClient();

        const { data: profile, error } = await admin
            .from('rec_profiles')
            .select('user_id, approval_token, status, organisation_id')
            .eq('user_id', uid)
            .single();

        if (error || !profile) {
            return res.redirect('/portal-approve.html?error=not_found');
        }
        if (profile.status === 'active') {
            // Already approved — idempotent
            return res.redirect('/portal-approve.html?result=already_active');
        }
        if (profile.status !== 'pending') {
            return res.redirect('/portal-approve.html?error=invalid_state');
        }
        if (profile.approval_token !== token) {
            return res.redirect('/portal-approve.html?error=invalid_token');
        }

        // Activate — clear token (single-use)
        const { error: updateErr } = await admin
            .from('rec_profiles')
            .update({ status: 'active', approval_token: null })
            .eq('user_id', uid);
        if (updateErr) throw updateErr;

        // Notify the new user
        const { data: { user } } = await admin.auth.admin.getUserById(uid);
        const { data: org } = await admin
            .from('organisations').select('name').eq('id', profile.organisation_id).single();

        if (user?.email) {
            await sendApprovalConfirmation({
                newUserEmail: user.email,
                orgName: org?.name ?? '',
            });
        }

        return res.redirect('/portal-approve.html?result=approved');

    } catch (err) {
        return sendError(res, err);
    }
};

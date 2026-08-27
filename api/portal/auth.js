const {
    createAdminClient, requireAuth, isGenericDomain, extractDomain,
    sendApprovalRequest, sendApprovalConfirmation, sendError, handleOptions,
} = require('./_lib');

// GET  /api/portal/auth?action=approve&token=<uuid>&uid=<user_id>  — approval link from email
// POST /api/portal/auth  — called after signUp(); creates rec_profiles + org

module.exports = async function handler(req, res) {
    if (handleOptions(req, res)) return;

    if (req.method === 'GET' && req.query.action === 'approve') {
        return handleApprove(req, res);
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { userId, fullName } = req.body ?? {};
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        // Verify identity via the user's own session token — more reliable than getUserById
        const { user: authUser } = await requireAuth(req);
        if (authUser.id !== userId) {
            return res.status(403).json({ error: 'User verification failed' });
        }
        const email = authUser.email;

        const admin = createAdminClient();

        // Check profile doesn't already exist (idempotent call guard)
        const { data: existing } = await admin
            .from('rec_profiles').select('status, organisation_id').eq('user_id', userId).single();
        if (existing) {
            const { data: org } = await admin.from('organisations')
                .select('name').eq('id', existing.organisation_id).single();
            return res.status(200).json({ status: existing.status, orgName: org?.name ?? '' });
        }

        const domain = extractDomain(email);
        const generic = isGenericDomain(domain);

        let orgId, orgName, profileStatus, isOwner, approvalToken;

        if (!generic) {
            // Look for existing org with this domain
            const { data: existingOrg } = await admin
                .from('organisations').select('id, name').eq('domain', domain).single();

            if (existingOrg) {
                // Join request — pending until owner approves
                orgId = existingOrg.id;
                orgName = existingOrg.name;
                profileStatus = 'pending';
                isOwner = false;
                approvalToken = crypto.randomUUID();
            }
        }

        if (!orgId) {
            // Create new org (first at domain, or generic)
            const { data: newOrg, error: orgErr } = await admin
                .from('organisations')
                .insert({ name: fullName || domain, domain: generic ? null : domain })
                .select('id, name')
                .single();
            if (orgErr) throw orgErr;
            orgId = newOrg.id;
            orgName = newOrg.name;
            profileStatus = 'active';
            isOwner = true;
            approvalToken = null;
        }

        // Create profile
        const { error: profileErr } = await admin.from('rec_profiles').insert({
            user_id:        userId,
            organisation_id: orgId,
            role:           'recruiter',
            full_name:      fullName || null,
            status:         profileStatus,
            is_owner:       isOwner,
            approval_token: approvalToken ?? null,
        });
        if (profileErr) throw profileErr;

        // If pending, email the org owner
        if (profileStatus === 'pending') {
            const { data: ownerProfile } = await admin
                .from('rec_profiles')
                .select('user_id')
                .eq('organisation_id', orgId)
                .eq('is_owner', true)
                .single();

            if (ownerProfile) {
                const { data: { user: ownerUser } } =
                    await admin.auth.admin.getUserById(ownerProfile.user_id);
                if (ownerUser?.email) {
                    await sendApprovalRequest({
                        ownerEmail:     ownerUser.email,
                        pendingName:    fullName || '',
                        pendingEmail:   email,
                        orgName,
                        approvalToken,
                        pendingUserId:  userId,
                    });
                }
            }

            // Return masked owner email so client can show "chase X"
            const ownerMasked = await getMaskedOwnerEmail(admin, orgId);
            return res.status(200).json({ status: 'pending', orgName, ownerEmail: ownerMasked });
        }

        return res.status(200).json({ status: 'active', orgName });

    } catch (err) {
        return sendError(res, err);
    }
};

async function handleApprove(req, res) {
    const { token, uid } = req.query ?? {};
    if (!token || !uid) return res.redirect('/portal-approve.html?error=missing_params');
    try {
        const admin = createAdminClient();
        const { data: profile, error } = await admin
            .from('rec_profiles')
            .select('user_id, approval_token, status, organisation_id')
            .eq('user_id', uid).single();
        if (error || !profile) return res.redirect('/portal-approve.html?error=not_found');
        if (profile.status === 'active') return res.redirect('/portal-approve.html?result=already_active');
        if (profile.status !== 'pending') return res.redirect('/portal-approve.html?error=invalid_state');
        if (profile.approval_token !== token) return res.redirect('/portal-approve.html?error=invalid_token');
        const { error: updateErr } = await admin
            .from('rec_profiles').update({ status: 'active', approval_token: null }).eq('user_id', uid);
        if (updateErr) throw updateErr;
        const { data: { user } } = await admin.auth.admin.getUserById(uid);
        const { data: org } = await admin.from('organisations').select('name').eq('id', profile.organisation_id).single();
        if (user?.email) await sendApprovalConfirmation({ newUserEmail: user.email, orgName: org?.name ?? '' });
        return res.redirect('/portal-approve.html?result=approved');
    } catch (err) {
        return sendError(res, err);
    }
}

async function getMaskedOwnerEmail(admin, orgId) {
    try {
        const { data: ownerProfile } = await admin
            .from('rec_profiles').select('user_id').eq('organisation_id', orgId).eq('is_owner', true).single();
        if (!ownerProfile) return null;
        const { data: { user } } = await admin.auth.admin.getUserById(ownerProfile.user_id);
        if (!user?.email) return null;
        const [local, domain] = user.email.split('@');
        return local.slice(0, 2) + '***@' + domain;
    } catch {
        return null;
    }
}

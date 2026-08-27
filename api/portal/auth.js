const {
    createAdminClient, isGenericDomain, extractDomain,
    sendApprovalRequest, sendError, handleOptions,
} = require('./_lib');

// POST /api/portal/auth
// Called client-side immediately after supabase.auth.signUp() succeeds.
// Creates the rec_profiles row and organisation (or join request).
// Returns: { status: 'active' | 'pending', orgName, ownerEmail (masked, if pending) }

module.exports = async function handler(req, res) {
    if (handleOptions(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { userId, email, fullName } = req.body ?? {};
        if (!userId || !email) return res.status(400).json({ error: 'Missing userId or email' });

        const admin = createAdminClient();

        // Verify this user actually exists in auth.users (prevent spoofing)
        const { data: { user: authUser }, error: authErr } =
            await admin.auth.admin.getUserById(userId);
        if (authErr || !authUser || authUser.email !== email) {
            return res.status(403).json({ error: 'User verification failed' });
        }

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

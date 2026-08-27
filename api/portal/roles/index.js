const {
    createAdminClient, requireRecruiter, writeAuditLog,
    sendError, handleOptions,
} = require('../_lib');

const FREE_TIER_ACTIVE_STATUSES = ['submitted', 'in_review', 'shortlist_ready'];

// GET  /api/portal/roles  — list caller's org's roles with CV count + deliverable presence
// POST /api/portal/roles  — create a new draft role (enforces free-tier cap)

module.exports = async function handler(req, res) {
    if (handleOptions(req, res)) return;

    try {
        const { user, profile } = await requireRecruiter(req);
        const admin = createAdminClient();
        const orgId = profile.organisation_id;

        if (req.method === 'GET') {
            const { data: roles, error } = await admin
                .from('roles')
                .select(`
                    id, title, location, seniority, status,
                    created_at, submitted_at,
                    uploads(id),
                    deliverables(id, delivered_at, notes)
                `)
                .eq('organisation_id', orgId)
                .order('created_at', { ascending: false });

            if (error) throw error;

            const shaped = (roles ?? []).map(r => ({
                id:          r.id,
                title:       r.title || 'Untitled role',
                location:    r.location,
                seniority:   r.seniority,
                status:      r.status,
                created_at:  r.created_at,
                submitted_at: r.submitted_at,
                cv_count:    r.uploads?.length ?? 0,
                has_shortlist: (r.deliverables?.length ?? 0) > 0,
            }));

            // Free-tier usage: count active (non-draft) roles only
            const activeCount = shaped.filter(r =>
                FREE_TIER_ACTIVE_STATUSES.includes(r.status)
            ).length;

            return res.status(200).json({
                roles: shaped,
                free_tier: { active_roles: activeCount, limit: 1, cv_limit: 60 },
            });
        }

        if (req.method === 'POST') {
            // Free-tier cap: max 1 active (non-draft) role per org
            const { count, error: countErr } = await admin
                .from('roles')
                .select('id', { count: 'exact', head: true })
                .eq('organisation_id', orgId)
                .in('status', FREE_TIER_ACTIVE_STATUSES);
            if (countErr) throw countErr;

            if (count >= 1) {
                return res.status(403).json({
                    error: 'Free plan allows one active role at a time. Upgrade to add more.',
                    code: 'FREE_TIER_LIMIT',
                });
            }

            const { data: role, error } = await admin
                .from('roles')
                .insert({ organisation_id: orgId, status: 'draft' })
                .select('id, status, created_at')
                .single();
            if (error) throw error;

            await writeAuditLog(admin, {
                userId: user.id, action: 'create_role', roleId: role.id,
            });

            return res.status(201).json({ role });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (err) {
        return sendError(res, err);
    }
};

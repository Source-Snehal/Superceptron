const {
    createAdminClient, requireAdmin, sendError, handleOptions,
} = require('../_lib');

// GET /api/portal/admin/roles
// Returns all roles across all orgs with org name, recruiter email, CV count, age.
// Query params: ?status=submitted&sort=age_desc (optional)

module.exports = async function handler(req, res) {
    if (handleOptions(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        await requireAdmin(req);
        const admin = createAdminClient();

        const { status: statusFilter, sort } = req.query ?? {};

        let query = admin
            .from('roles')
            .select(`
                id, title, location, seniority, status,
                created_at, submitted_at, notes,
                organisations(id, name),
                uploads(id),
                rec_profiles!inner(user_id, full_name, is_owner)
            `)
            .order('submitted_at', { ascending: true, nullsFirst: false });

        if (statusFilter) query = query.eq('status', statusFilter);

        const { data: roles, error } = await query;
        if (error) throw error;

        // Enrich with recruiter email from auth.users (service role required)
        const shaped = await Promise.all((roles ?? []).map(async r => {
            const ownerProfile = r.rec_profiles?.find(p => p.is_owner) ?? r.rec_profiles?.[0];
            let recruiterEmail = null;
            if (ownerProfile?.user_id) {
                const { data: { user } } = await admin.auth.admin.getUserById(ownerProfile.user_id);
                recruiterEmail = user?.email ?? null;
            }

            const submittedAt = r.submitted_at ? new Date(r.submitted_at) : null;
            const ageInDays = submittedAt
                ? Math.floor((Date.now() - submittedAt.getTime()) / 86_400_000)
                : null;

            return {
                id:              r.id,
                title:           r.title || 'Untitled',
                location:        r.location,
                seniority:       r.seniority,
                status:          r.status,
                org_id:          r.organisations?.id,
                org_name:        r.organisations?.name ?? '—',
                recruiter_email: recruiterEmail,
                cv_count:        r.uploads?.length ?? 0,
                submitted_at:    r.submitted_at,
                age_days:        ageInDays,
                stale:           ageInDays !== null && ageInDays > 7,
            };
        }));

        // Client-side sort options
        if (sort === 'age_desc') shaped.sort((a, b) => (b.age_days ?? -1) - (a.age_days ?? -1));
        if (sort === 'cv_desc')  shaped.sort((a, b) => b.cv_count - a.cv_count);

        return res.status(200).json({ roles: shaped });

    } catch (err) {
        return sendError(res, err);
    }
};

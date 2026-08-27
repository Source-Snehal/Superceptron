const {
    createAdminClient, requireRecruiter, writeAuditLog,
    sendError, handleOptions,
} = require('../_lib');

const TRACKER_FIELDS = [
    'title', 'location', 'seniority', 'salary_range',
    'must_haves', 'nice_to_haves', 'unlisted_criteria', 'deadline',
];

// GET    /api/portal/roles/:id  — fetch role + uploads + deliverable
// PATCH  /api/portal/roles/:id  — update tracker fields (draft only)
// DELETE /api/portal/roles/:id  — delete draft role + all its files

module.exports = async function handler(req, res) {
    if (handleOptions(req, res)) return;

    try {
        const { user, profile } = await requireRecruiter(req);
        const admin = createAdminClient();
        const orgId = profile.organisation_id;
        const roleId = req.query.id;
        if (!roleId) return res.status(400).json({ error: 'Missing role id' });

        // Fetch role and verify ownership
        const { data: role, error: roleErr } = await admin
            .from('roles')
            .select('*')
            .eq('id', roleId)
            .eq('organisation_id', orgId)
            .single();

        if (roleErr || !role) return res.status(404).json({ error: 'Role not found' });

        // ── GET ───────────────────────────────────────────────
        if (req.method === 'GET') {
            const [{ data: uploads }, { data: deliverables }] = await Promise.all([
                admin.from('uploads')
                    .select('id, original_filename, file_size, uploaded_at')
                    .eq('role_id', roleId)
                    .order('uploaded_at', { ascending: true }),
                admin.from('deliverables')
                    .select('id, original_filename, notes, delivered_at')
                    .eq('role_id', roleId)
                    .order('delivered_at', { ascending: false })
                    .limit(1),
            ]);

            return res.status(200).json({
                role,
                uploads: uploads ?? [],
                deliverable: deliverables?.[0] ?? null,
                cv_limit: 60,
            });
        }

        // ── PATCH ─────────────────────────────────────────────
        if (req.method === 'PATCH') {
            if (role.status !== 'draft') {
                return res.status(409).json({ error: 'Only draft roles can be edited' });
            }

            const body = req.body ?? {};
            const updates = {};
            for (const field of TRACKER_FIELDS) {
                if (field in body) updates[field] = body[field] ?? null;
            }
            if (Object.keys(updates).length === 0) {
                return res.status(400).json({ error: 'No valid fields to update' });
            }

            const { data: updated, error } = await admin
                .from('roles')
                .update(updates)
                .eq('id', roleId)
                .eq('organisation_id', orgId)
                .eq('status', 'draft')
                .select()
                .single();
            if (error) throw error;

            return res.status(200).json({ role: updated });
        }

        // ── DELETE ────────────────────────────────────────────
        if (req.method === 'DELETE') {
            if (role.status !== 'draft') {
                return res.status(409).json({
                    error: 'Only draft roles can be deleted. Contact support to remove a submitted role.',
                });
            }

            // List all storage objects for this role
            const { data: objects } = await admin.storage
                .from('recruiter-uploads')
                .list(`${orgId}/${roleId}`);

            if (objects?.length) {
                const paths = objects.map(o => `${orgId}/${roleId}/${o.name}`);
                await admin.storage.from('recruiter-uploads').remove(paths);
            }

            // JD file if present
            if (role.jd_file_path) {
                await admin.storage.from('recruiter-uploads').remove([role.jd_file_path]);
            }

            // Delete the role (uploads cascade via FK)
            await admin.from('roles').delete().eq('id', roleId);

            await writeAuditLog(admin, {
                userId: user.id, action: 'delete_role', roleId,
                meta: { title: role.title },
            });

            return res.status(200).json({ ok: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (err) {
        return sendError(res, err);
    }
};

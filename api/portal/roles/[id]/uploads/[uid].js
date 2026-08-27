const {
    createAdminClient, requireRecruiter, writeAuditLog,
    sendError, handleOptions,
} = require('../../../_lib');

// DELETE /api/portal/roles/:id/uploads/:uid
// Removes the storage object and the uploads row.
// Only allowed while the role is still in draft status.

module.exports = async function handler(req, res) {
    if (handleOptions(req, res)) return;
    if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { user, profile } = await requireRecruiter(req);
        const admin = createAdminClient();
        const orgId = profile.organisation_id;
        const roleId = req.query.id;
        const uploadId = req.query.uid;

        // Verify role ownership and draft status
        const { data: role } = await admin
            .from('roles').select('id, status').eq('id', roleId).eq('organisation_id', orgId).single();
        if (!role) return res.status(404).json({ error: 'Role not found' });
        if (role.status !== 'draft') {
            return res.status(409).json({ error: 'Cannot remove files from a submitted role' });
        }

        // Fetch the upload row (verify it belongs to this role)
        const { data: upload } = await admin
            .from('uploads').select('id, file_path, original_filename').eq('id', uploadId).eq('role_id', roleId).single();
        if (!upload) return res.status(404).json({ error: 'Upload not found' });

        // Delete from storage first
        const { error: storageErr } = await admin.storage
            .from('recruiter-uploads').remove([upload.file_path]);
        // Log storage failure but don't block row deletion
        if (storageErr) {
            await writeAuditLog(admin, {
                userId: user.id, action: 'delete_failed', roleId,
                filePath: upload.file_path,
                meta: { error: storageErr.message },
            });
        }

        // Delete the row
        await admin.from('uploads').delete().eq('id', uploadId);

        await writeAuditLog(admin, {
            userId: user.id, action: 'delete', roleId,
            filePath: upload.file_path,
            meta: { original_filename: upload.original_filename },
        });

        return res.status(200).json({ ok: true });

    } catch (err) {
        return sendError(res, err);
    }
};

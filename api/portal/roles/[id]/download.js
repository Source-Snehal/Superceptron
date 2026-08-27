const {
    createAdminClient, requireRecruiter, writeAuditLog,
    sendError, handleOptions,
} = require('../../_lib');

// GET /api/portal/roles/:id/download?uploadId=<uid>|deliverableId=<uid>
// Returns a 60-second signed download URL for a specific file.
// Verifies the file belongs to the caller's org before issuing.

const SIGNED_URL_EXPIRY_SECONDS = 60;

module.exports = async function handler(req, res) {
    if (handleOptions(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { user, profile } = await requireRecruiter(req);
        const admin = createAdminClient();
        const orgId = profile.organisation_id;
        const roleId = req.query.id;
        const { uploadId, deliverableId } = req.query;

        if (!uploadId && !deliverableId) {
            return res.status(400).json({ error: 'Provide uploadId or deliverableId' });
        }

        // Verify role belongs to org
        const { data: role } = await admin
            .from('roles').select('id').eq('id', roleId).eq('organisation_id', orgId).single();
        if (!role) return res.status(404).json({ error: 'Role not found' });

        let filePath, bucket;

        if (uploadId) {
            const { data: upload } = await admin
                .from('uploads').select('file_path').eq('id', uploadId).eq('role_id', roleId).single();
            if (!upload) return res.status(404).json({ error: 'Upload not found' });
            filePath = upload.file_path;
            bucket = 'recruiter-uploads';
        } else {
            const { data: del } = await admin
                .from('deliverables').select('file_path').eq('id', deliverableId).eq('role_id', roleId).single();
            if (!del) return res.status(404).json({ error: 'Deliverable not found' });
            filePath = del.file_path;
            bucket = 'recruiter-deliverables';
        }

        const { data, error } = await admin.storage
            .from(bucket)
            .createSignedUrl(filePath, SIGNED_URL_EXPIRY_SECONDS);
        if (error) throw error;

        await writeAuditLog(admin, {
            userId: user.id, action: 'download', roleId,
            filePath,
            meta: { bucket, uploadId: uploadId ?? null, deliverableId: deliverableId ?? null },
        });

        return res.status(200).json({ signedUrl: data.signedUrl });

    } catch (err) {
        return sendError(res, err);
    }
};

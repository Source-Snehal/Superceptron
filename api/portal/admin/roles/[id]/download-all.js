const {
    createAdminClient, requireAdmin, writeAuditLog,
    sendError, handleOptions,
} = require('../../../_lib');

// GET /api/portal/admin/roles/:id/download-all
// Returns signed download URLs for every CV in the role (C1: no zip streaming).
// Admin's browser downloads each file. URLs are valid for 5 minutes.

const SIGNED_URL_EXPIRY = 300; // 5 minutes — enough time to download 60 files

module.exports = async function handler(req, res) {
    if (handleOptions(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { user } = await requireAdmin(req);
        const admin = createAdminClient();
        const roleId = req.query.id;

        const { data: role } = await admin
            .from('roles').select('title, organisation_id').eq('id', roleId).single();
        if (!role) return res.status(404).json({ error: 'Role not found' });

        const { data: uploads, error } = await admin
            .from('uploads')
            .select('id, file_path, original_filename, file_size')
            .eq('role_id', roleId)
            .order('uploaded_at', { ascending: true });
        if (error) throw error;

        if (!uploads?.length) {
            return res.status(200).json({ files: [], role_title: role.title });
        }

        // Generate signed URLs for all files in one batch
        const { data: signedData, error: signErr } = await admin.storage
            .from('recruiter-uploads')
            .createSignedUrls(
                uploads.map(u => u.file_path),
                SIGNED_URL_EXPIRY
            );
        if (signErr) throw signErr;

        const files = uploads.map((u, i) => ({
            id:                u.id,
            original_filename: u.original_filename,
            file_size:         u.file_size,
            signed_url:        signedData[i]?.signedUrl ?? null,
        }));

        await writeAuditLog(admin, {
            userId: user.id, action: 'admin_download_all', roleId,
            meta: { count: files.length, role_title: role.title },
        });

        return res.status(200).json({ files, role_title: role.title });

    } catch (err) {
        return sendError(res, err);
    }
};

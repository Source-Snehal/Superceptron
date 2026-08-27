const {
    createAdminClient, requireAdmin, sanitiseFilename,
    writeAuditLog, sendError, handleOptions,
} = require('../../../_lib');

// GET  /api/portal/admin/roles/:id/actions — batch signed download URLs for all CVs
// POST /api/portal/admin/roles/:id/actions — signed upload URL for shortlist deliverable

const SIGNED_URL_EXPIRY    = 300; // 5 minutes
const MAX_DELIVERABLE_BYTES = 50 * 1024 * 1024; // 50 MB
const ALLOWED_DELIVERABLE   = new Set(['pdf','doc','docx','xls','xlsx','csv','txt','zip']);

module.exports = async function handler(req, res) {
    if (handleOptions(req, res)) return;
    if (req.method === 'GET')  return handleDownloadAll(req, res);
    if (req.method === 'POST') return handleUploadInit(req, res);
    return res.status(405).json({ error: 'Method not allowed' });
};

async function handleDownloadAll(req, res) {
    try {
        const { user } = await requireAdmin(req);
        const admin  = createAdminClient();
        const roleId = req.query.id;

        const { data: role } = await admin
            .from('roles').select('title, organisation_id').eq('id', roleId).single();
        if (!role) return res.status(404).json({ error: 'Role not found' });

        const { data: uploads, error } = await admin
            .from('uploads').select('id, file_path, original_filename, file_size')
            .eq('role_id', roleId).order('uploaded_at', { ascending: true });
        if (error) throw error;

        if (!uploads?.length) return res.status(200).json({ files: [], role_title: role.title });

        const { data: signedData, error: signErr } = await admin.storage
            .from('recruiter-uploads').createSignedUrls(uploads.map(u => u.file_path), SIGNED_URL_EXPIRY);
        if (signErr) throw signErr;

        const files = uploads.map((u, i) => ({
            id: u.id, original_filename: u.original_filename,
            file_size: u.file_size, signed_url: signedData[i]?.signedUrl ?? null,
        }));

        await writeAuditLog(admin, {
            userId: user.id, action: 'admin_download_all', roleId,
            meta: { count: files.length, role_title: role.title },
        });

        return res.status(200).json({ files, role_title: role.title });
    } catch (err) {
        return sendError(res, err);
    }
}

async function handleUploadInit(req, res) {
    try {
        await requireAdmin(req);
        const admin  = createAdminClient();
        const roleId = req.query.id;

        const { filename, size } = req.body ?? {};
        if (!filename) return res.status(400).json({ error: 'Missing filename' });

        const ext = filename.split('.').pop()?.toLowerCase() ?? '';
        if (!ALLOWED_DELIVERABLE.has(ext)) {
            return res.status(400).json({ error: `File type .${ext} not accepted for shortlists` });
        }
        if (size && size > MAX_DELIVERABLE_BYTES) {
            return res.status(400).json({ error: 'File exceeds 50 MB limit' });
        }

        const { data: role } = await admin.from('roles').select('organisation_id').eq('id', roleId).single();
        if (!role) return res.status(404).json({ error: 'Role not found' });

        const safe = sanitiseFilename(filename);
        const storagePath = `${role.organisation_id}/${roleId}/${safe}`;

        const { data, error } = await admin.storage
            .from('recruiter-deliverables').createSignedUploadUrl(storagePath);
        if (error) throw error;

        return res.status(200).json({ signedUrl: data.signedUrl, path: storagePath, sanitisedName: safe });
    } catch (err) {
        return sendError(res, err);
    }
}

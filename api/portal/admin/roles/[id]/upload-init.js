const {
    createAdminClient, requireAdmin, sanitiseFilename,
    sendError, handleOptions,
} = require('../../../_lib');

// POST /api/portal/admin/roles/:id/upload-init
// Body: { filename, size }
// Generates a signed upload URL for the admin to upload a shortlist file.
// Mirrors the recruiter upload-init, but targets recruiter-deliverables bucket.

const MAX_DELIVERABLE_BYTES = 50 * 1024 * 1024; // 50 MB
const ALLOWED = new Set(['pdf','doc','docx','xls','xlsx','csv','txt','zip']);

module.exports = async function handler(req, res) {
    if (handleOptions(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        await requireAdmin(req);
        const admin = createAdminClient();
        const roleId = req.query.id;

        const { filename, size } = req.body ?? {};
        if (!filename) return res.status(400).json({ error: 'Missing filename' });

        const ext = filename.split('.').pop()?.toLowerCase() ?? '';
        if (!ALLOWED.has(ext)) {
            return res.status(400).json({ error: `File type .${ext} not accepted for shortlists` });
        }
        if (size && size > MAX_DELIVERABLE_BYTES) {
            return res.status(400).json({ error: 'File exceeds 50 MB limit' });
        }

        // Verify role exists
        const { data: role } = await admin.from('roles').select('organisation_id').eq('id', roleId).single();
        if (!role) return res.status(404).json({ error: 'Role not found' });

        const safe = sanitiseFilename(filename);
        const storagePath = `${role.organisation_id}/${roleId}/${safe}`;

        const { data, error } = await admin.storage
            .from('recruiter-deliverables')
            .createSignedUploadUrl(storagePath);
        if (error) throw error;

        return res.status(200).json({
            signedUrl:     data.signedUrl,
            path:          storagePath,
            sanitisedName: safe,
        });

    } catch (err) {
        return sendError(res, err);
    }
};

const {
    createAdminClient, requireRecruiter, validateFile, sanitiseFilename,
    sendError, handleOptions,
} = require('../../_lib');

const CV_LIMIT = 60;

// POST /api/portal/roles/:id/upload-init
// Body: { filename: string, size: number }
// Validates the file, checks CV count cap, then issues a signed upload URL
// (server-generated via service role for a specific path).
// Client PUTs the file to signedUrl, then calls upload-confirm.

module.exports = async function handler(req, res) {
    if (handleOptions(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { user, profile } = await requireRecruiter(req);
        const admin = createAdminClient();
        const orgId = profile.organisation_id;
        const roleId = req.query.id;

        const { filename, size } = req.body ?? {};
        if (!filename || !size) return res.status(400).json({ error: 'Missing filename or size' });

        // Verify role exists and belongs to org
        const { data: role, error: roleErr } = await admin
            .from('roles').select('id, status').eq('id', roleId).eq('organisation_id', orgId).single();
        if (roleErr || !role) return res.status(404).json({ error: 'Role not found' });
        if (role.status !== 'draft') {
            return res.status(409).json({ error: 'Cannot upload to a submitted role' });
        }

        // Extension and size validation (A10: this is extension allowlisting, not MIME validation)
        const validationError = validateFile(filename, size);
        if (validationError) return res.status(400).json({ error: validationError });

        // CV count cap (server-side enforcement — cannot be bypassed via direct API calls)
        const { count: existing } = await admin
            .from('uploads')
            .select('id', { count: 'exact', head: true })
            .eq('role_id', roleId);
        if ((existing ?? 0) >= CV_LIMIT) {
            return res.status(403).json({
                error: `This role has reached the ${CV_LIMIT} CV limit.`,
                code: 'CV_LIMIT',
            });
        }

        const safe = sanitiseFilename(filename);
        const storagePath = `${orgId}/${roleId}/${safe}`;

        // Service role issues the signed upload URL for this specific path.
        // Client can only PUT to this exact path — cannot deviate.
        const { data, error: signErr } = await admin.storage
            .from('recruiter-uploads')
            .createSignedUploadUrl(storagePath);
        if (signErr) throw signErr;

        return res.status(200).json({
            signedUrl:      data.signedUrl,
            path:           storagePath,
            sanitisedName:  safe,
            originalName:   filename,
        });

    } catch (err) {
        return sendError(res, err);
    }
};

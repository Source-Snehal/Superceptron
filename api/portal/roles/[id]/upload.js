const {
    createAdminClient, requireRecruiter, validateFile, sanitiseFilename,
    writeAuditLog, sendError, handleOptions,
} = require('../../_lib');

// POST /api/portal/roles/:id/upload?action=init   — validate + issue signed upload URL
// POST /api/portal/roles/:id/upload?action=confirm — verify storage object, record row

const CV_LIMIT = 60;

module.exports = async function handler(req, res) {
    if (handleOptions(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const action = req.query.action;
    if (action === 'init')    return handleInit(req, res);
    if (action === 'confirm') return handleConfirm(req, res);
    return res.status(400).json({ error: 'Missing or unknown action' });
};

async function handleInit(req, res) {
    try {
        const { user, profile } = await requireRecruiter(req);
        const admin  = createAdminClient();
        const orgId  = profile.organisation_id;
        const roleId = req.query.id;

        const { filename, size } = req.body ?? {};
        if (!filename || !size) return res.status(400).json({ error: 'Missing filename or size' });

        const { data: role, error: roleErr } = await admin
            .from('roles').select('id, status').eq('id', roleId).eq('organisation_id', orgId).single();
        if (roleErr || !role) return res.status(404).json({ error: 'Role not found' });
        if (role.status !== 'draft') return res.status(409).json({ error: 'Cannot upload to a submitted role' });

        // Extension allowlisting (A10) — not MIME validation
        const validationError = validateFile(filename, size);
        if (validationError) return res.status(400).json({ error: validationError });

        // CV count cap — server-side, cannot be bypassed via direct API calls
        const { count: existing } = await admin
            .from('uploads').select('id', { count: 'exact', head: true }).eq('role_id', roleId);
        if ((existing ?? 0) >= CV_LIMIT) {
            return res.status(403).json({ error: `This role has reached the ${CV_LIMIT} CV limit.`, code: 'CV_LIMIT' });
        }

        const safe = sanitiseFilename(filename);
        const storagePath = `${orgId}/${roleId}/${safe}`;

        // Service role issues the signed URL for this exact path — client cannot deviate
        const { data, error: signErr } = await admin.storage
            .from('recruiter-uploads').createSignedUploadUrl(storagePath);
        if (signErr) throw signErr;

        return res.status(200).json({
            signedUrl:     data.signedUrl,
            path:          storagePath,
            sanitisedName: safe,
            originalName:  filename,
        });
    } catch (err) {
        return sendError(res, err);
    }
}

async function handleConfirm(req, res) {
    try {
        const { user, profile } = await requireRecruiter(req);
        const admin  = createAdminClient();
        const orgId  = profile.organisation_id;
        const roleId = req.query.id;

        const { path, originalName, size } = req.body ?? {};
        if (!path || !originalName) return res.status(400).json({ error: 'Missing path or originalName' });

        // Reject any path the server didn't issue (A8)
        if (!path.startsWith(`${orgId}/${roleId}/`)) {
            return res.status(403).json({ error: 'Path does not belong to this role' });
        }

        const { data: role } = await admin
            .from('roles').select('id, status').eq('id', roleId).eq('organisation_id', orgId).single();
        if (!role) return res.status(404).json({ error: 'Role not found' });

        // Verify the storage object actually exists (A8)
        const filename = path.split('/').pop();
        const folder   = `${orgId}/${roleId}`;
        const { data: objects, error: listErr } = await admin.storage
            .from('recruiter-uploads').list(folder, { search: filename });
        if (listErr || !objects?.some(o => o.name === filename)) {
            return res.status(400).json({ error: 'File not found in storage — upload may have failed' });
        }

        // Re-validate extension (A10)
        const validationError = validateFile(originalName, size ?? 0);
        if (validationError) {
            await admin.storage.from('recruiter-uploads').remove([path]);
            return res.status(400).json({ error: validationError });
        }

        // Derive mime_type from extension only
        const ext  = originalName.split('.').pop()?.toLowerCase() ?? '';
        const MIME = { pdf: 'application/pdf', doc: 'application/msword',
            docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            rtf: 'application/rtf', txt: 'text/plain' };

        const { data: upload, error: insertErr } = await admin
            .from('uploads')
            .insert({
                role_id: roleId, file_path: path, original_filename: originalName,
                file_size: size ?? null, mime_type: MIME[ext] ?? null, uploaded_by: user.id,
            })
            .select().single();
        if (insertErr) throw insertErr;

        await writeAuditLog(admin, {
            userId: user.id, action: 'upload', roleId,
            filePath: path, meta: { original_filename: originalName, size },
        });

        return res.status(201).json({ upload });
    } catch (err) {
        return sendError(res, err);
    }
}

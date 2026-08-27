const {
    createAdminClient, requireRecruiter, writeAuditLog,
    validateFile, sendError, handleOptions,
} = require('../../_lib');

// POST /api/portal/roles/:id/upload-confirm
// Body: { path, originalName, size }
// Called after a successful PUT to the signed upload URL.
// Server verifies the object actually exists at that path before recording the row.

module.exports = async function handler(req, res) {
    if (handleOptions(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { user, profile } = await requireRecruiter(req);
        const admin = createAdminClient();
        const orgId = profile.organisation_id;
        const roleId = req.query.id;

        const { path, originalName, size } = req.body ?? {};
        if (!path || !originalName) return res.status(400).json({ error: 'Missing path or originalName' });

        // The path must be under this org's prefix — reject any attempt to confirm
        // a path the server didn't issue (belt-and-suspenders for upload-init)
        const expectedPrefix = `${orgId}/${roleId}/`;
        if (!path.startsWith(expectedPrefix)) {
            return res.status(403).json({ error: 'Path does not belong to this role' });
        }

        // Verify role ownership
        const { data: role } = await admin
            .from('roles').select('id, status').eq('id', roleId).eq('organisation_id', orgId).single();
        if (!role) return res.status(404).json({ error: 'Role not found' });

        // Verify the storage object actually exists (A8: don't trust client-supplied path)
        const filename = path.split('/').pop();
        const folder   = `${orgId}/${roleId}`;
        const { data: objects, error: listErr } = await admin.storage
            .from('recruiter-uploads')
            .list(folder, { search: filename });
        if (listErr || !objects?.some(o => o.name === filename)) {
            return res.status(400).json({ error: 'File not found in storage — upload may have failed' });
        }

        // Re-validate extension (never trust the client)
        const validationError = validateFile(originalName, size ?? 0);
        if (validationError) {
            // Purge the object — it shouldn't be there
            await admin.storage.from('recruiter-uploads').remove([path]);
            return res.status(400).json({ error: validationError });
        }

        // Derive mime_type from extension only (A10)
        const ext = originalName.split('.').pop()?.toLowerCase() ?? '';
        const MIME = { pdf: 'application/pdf', doc: 'application/msword',
            docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            rtf: 'application/rtf', txt: 'text/plain' };

        const { data: upload, error: insertErr } = await admin
            .from('uploads')
            .insert({
                role_id:           roleId,
                file_path:         path,
                original_filename: originalName,
                file_size:         size ?? null,
                mime_type:         MIME[ext] ?? null,
                uploaded_by:       user.id,
            })
            .select()
            .single();
        if (insertErr) throw insertErr;

        await writeAuditLog(admin, {
            userId: user.id, action: 'upload', roleId,
            filePath: path,
            meta: { original_filename: originalName, size },
        });

        return res.status(201).json({ upload });

    } catch (err) {
        return sendError(res, err);
    }
};

const {
    createAdminClient, requireAdmin, writeAuditLog,
    sendShortlistReady, sendError, handleOptions,
} = require('../../../_lib');

// POST /api/portal/admin/roles/:id/deliver
// Body: { filePath, originalFilename, notes }
// filePath is the path in recruiter-deliverables where admin has already uploaded the shortlist
// (admin uses a separate signed upload URL, same pattern as recruiter uploads).
//
// This endpoint:
//   1. Verifies the deliverable file exists in storage
//   2. Deletes all CV storage objects (retention promise)
//   3. Deletes uploads rows
//   4. Inserts deliverable row
//   5. Sets status → shortlist_ready
//   6. Emails the recruiter
//   7. Writes audit log throughout

module.exports = async function handler(req, res) {
    if (handleOptions(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { user } = await requireAdmin(req);
        const admin = createAdminClient();
        const roleId = req.query.id;

        const { filePath, originalFilename, notes } = req.body ?? {};
        if (!filePath) return res.status(400).json({ error: 'Missing filePath' });

        // Fetch role with org
        const { data: role, error: roleErr } = await admin
            .from('roles')
            .select('*, organisations(id, name)')
            .eq('id', roleId)
            .single();
        if (roleErr || !role) return res.status(404).json({ error: 'Role not found' });
        if (role.status === 'shortlist_ready') {
            return res.status(409).json({ error: 'Shortlist already delivered' });
        }
        if (role.status === 'draft') {
            return res.status(409).json({ error: 'Role is still in draft' });
        }

        // Verify the deliverable file actually exists in storage
        const deliverableFilename = filePath.split('/').pop();
        const deliverableFolder = filePath.split('/').slice(0, -1).join('/');
        const { data: deliverableObjects } = await admin.storage
            .from('recruiter-deliverables')
            .list(deliverableFolder, { search: deliverableFilename });
        if (!deliverableObjects?.some(o => o.name === deliverableFilename)) {
            return res.status(400).json({ error: 'Deliverable file not found in storage' });
        }

        // Fetch all CV uploads for this role
        const { data: cvUploads } = await admin
            .from('uploads').select('id, file_path, original_filename').eq('role_id', roleId);
        const paths = (cvUploads ?? []).map(u => u.file_path);

        // ── Step 1: Delete CV storage objects ─────────────────
        let storageOk = true;
        if (paths.length > 0) {
            const { error: storageErr } = await admin.storage
                .from('recruiter-uploads').remove(paths);
            if (storageErr) {
                storageOk = false;
                // Log failures for manual follow-up
                await admin.from('audit_log').insert(
                    paths.map(p => ({
                        user_id: user.id, action: 'delete_failed',
                        role_id: roleId, file_path: p,
                        meta: { error: storageErr.message, reason: 'retention' },
                    }))
                );
            } else {
                // Log successful deletions
                await admin.from('audit_log').insert(
                    paths.map(p => ({
                        user_id: user.id, action: 'delete',
                        role_id: roleId, file_path: p,
                        meta: { reason: 'retention: post-delivery cleanup' },
                    }))
                );
            }
        }

        // ── Step 2: Delete uploads rows (regardless of storage result) ─────
        if (cvUploads?.length) {
            await admin.from('uploads').delete().eq('role_id', roleId);
        }

        // ── Step 3: Insert deliverable row ─────────────────────
        await admin.from('deliverables').insert({
            role_id:           roleId,
            file_path:         filePath,
            original_filename: originalFilename ?? deliverableFilename,
            notes:             notes ?? null,
        });

        // ── Step 4: Set status → shortlist_ready ───────────────
        await admin.from('roles')
            .update({ status: 'shortlist_ready' }).eq('id', roleId);

        // ── Step 5: Audit log ──────────────────────────────────
        await writeAuditLog(admin, {
            userId: user.id, action: 'deliver', roleId,
            filePath,
            meta: {
                cvs_deleted:     paths.length,
                storage_ok:      storageOk,
                org_name:        role.organisations?.name,
                role_title:      role.title,
            },
        });

        // ── Step 6: Email recruiter ────────────────────────────
        const orgId = role.organisations?.id;
        const { data: ownerProfile } = await admin
            .from('rec_profiles').select('user_id, full_name').eq('organisation_id', orgId).eq('is_owner', true).single();
        if (ownerProfile) {
            const { data: { user: recruiter } } = await admin.auth.admin.getUserById(ownerProfile.user_id);
            if (recruiter?.email) {
                await sendShortlistReady({
                    recruiterEmail:   recruiter.email,
                    recruiterName:    ownerProfile.full_name,
                    roleTitle:        role.title,
                    deliverableNotes: notes,
                }).catch(e => console.error('Email send failed:', e));
            }
        }

        return res.status(200).json({
            ok: true,
            cvs_deleted:  paths.length,
            storage_ok:   storageOk,
        });

    } catch (err) {
        return sendError(res, err);
    }
};

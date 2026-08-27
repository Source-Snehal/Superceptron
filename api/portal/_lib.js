const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

// ── Clients ──────────────────────────────────────────────────

function createAdminClient() {
    return createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false } }
    );
}

// ── Auth helpers ─────────────────────────────────────────────

// Verifies the Bearer JWT, returns { user } or throws.
async function requireAuth(req) {
    const auth = req.headers['authorization'] ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) throw Object.assign(new Error('Missing auth token'), { status: 401 });

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) throw Object.assign(new Error('Unauthorized'), { status: 401 });
    return { user, token };
}

// Verifies auth AND that the caller's rec_profiles.role = 'admin'.
async function requireAdmin(req) {
    const { user, token } = await requireAuth(req);
    const admin = createAdminClient();
    const { data: profile, error } = await admin
        .from('rec_profiles')
        .select('role, status, organisation_id')
        .eq('user_id', user.id)
        .single();
    if (error || !profile || profile.role !== 'admin' || profile.status !== 'active') {
        throw Object.assign(new Error('Forbidden'), { status: 403 });
    }
    return { user, token, profile };
}

// Returns the caller's active rec_profile, or throws.
async function requireRecruiter(req) {
    const { user, token } = await requireAuth(req);
    const admin = createAdminClient();
    const { data: profile, error } = await admin
        .from('rec_profiles')
        .select('organisation_id, role, status')
        .eq('user_id', user.id)
        .single();
    if (error || !profile) throw Object.assign(new Error('Profile not found'), { status: 403 });
    if (profile.status === 'pending') throw Object.assign(new Error('pending'), { status: 403 });
    return { user, token, profile };
}

// ── Org helpers ──────────────────────────────────────────────

const GENERIC_DOMAINS = new Set([
    'gmail.com','googlemail.com','outlook.com','hotmail.com','hotmail.co.uk',
    'yahoo.com','yahoo.co.uk','icloud.com','me.com','mac.com',
    'proton.me','protonmail.com','live.com','live.co.uk','msn.com',
    'aol.com','btinternet.com','sky.com',
]);

function isGenericDomain(domain) {
    return GENERIC_DOMAINS.has(domain.toLowerCase());
}

function extractDomain(email) {
    return email.split('@')[1]?.toLowerCase() ?? '';
}

// ── File validation ──────────────────────────────────────────

const ALLOWED_EXTENSIONS = new Set(['pdf','doc','docx','rtf','txt']);
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

function validateFile(filename, size) {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_EXTENSIONS.has(ext)) {
        return `File type .${ext} is not accepted. Upload PDF, DOC, DOCX, RTF, or TXT.`;
    }
    if (size > MAX_FILE_BYTES) {
        return `${filename} is ${(size / 1024 / 1024).toFixed(1)} MB — the 10 MB per-file limit applies.`;
    }
    return null;
}

// Sanitise filename: strip non-ASCII, replace spaces/special chars with underscores.
function sanitiseFilename(filename) {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const base = filename.slice(0, filename.lastIndexOf('.'))
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s]+/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 80);
    const uuid = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    return `${uuid}_${base}.${ext}`;
}

// ── Audit log ────────────────────────────────────────────────

async function writeAuditLog(admin, { userId, action, roleId, filePath, meta }) {
    await admin.from('audit_log').insert({
        user_id:   userId   ?? null,
        action,
        role_id:   roleId   ?? null,
        file_path: filePath ?? null,
        meta:      meta     ?? null,
    });
}

// ── Email (Resend) ───────────────────────────────────────────

const resend = new Resend(process.env.RESEND_API_KEY);
const ADMIN_EMAIL = 'snehalsavio123@gmail.com';
const FROM = 'Superceptron <noreply@superceptron.com>';

function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

async function sendSubmitConfirmation({ recruiterEmail, recruiterName, roleTitle, orgName }) {
    await resend.emails.send({
        from: FROM,
        to: recruiterEmail,
        subject: `We've received your brief — ${esc(roleTitle)}`,
        html: emailWrap(`
<p>Hi ${esc(recruiterName || 'there')},</p>
<p>We've received the CVs for <strong>${esc(roleTitle)}</strong>${orgName ? ` from ${esc(orgName)}` : ''}.</p>
<p>We'll read through them and have a ranked shortlist back to you within <strong>2–3 working days</strong>.
You'll get an email the moment it's ready.</p>
<p>If anything's missing or you'd like to add more CVs, just reply to this email.</p>
<p style="margin-top:2rem">Snehal<br>Superceptron</p>
        `),
    });
}

async function sendAdminNewSubmission({ recruiterEmail, orgName, roleTitle, cvCount, roleId }) {
    await resend.emails.send({
        from: FROM,
        to: ADMIN_EMAIL,
        subject: `New submission: ${esc(roleTitle)} — ${esc(orgName)}`,
        html: emailWrap(`
<p><strong>Org:</strong> ${esc(orgName)}</p>
<p><strong>Role:</strong> ${esc(roleTitle)}</p>
<p><strong>CVs:</strong> ${cvCount}</p>
<p><strong>Recruiter:</strong> ${esc(recruiterEmail)}</p>
<p><strong>Role ID:</strong> <code>${esc(roleId)}</code></p>
<p><a href="https://www.superceptron.com/portal-admin.html#${esc(roleId)}">View in admin portal</a></p>
        `),
    });
}

async function sendApprovalRequest({ ownerEmail, pendingName, pendingEmail, orgName, approvalToken, pendingUserId }) {
    const link = `https://www.superceptron.com/api/portal/auth?action=approve&token=${approvalToken}&uid=${pendingUserId}`;
    await resend.emails.send({
        from: FROM,
        to: ownerEmail,
        subject: `Someone wants to join your ${esc(orgName)} account`,
        html: emailWrap(`
<p>${esc(pendingName || pendingEmail)} has signed up to join your <strong>${esc(orgName)}</strong> account on Superceptron.</p>
<p>If you know them and want to give them access, click the link below:</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#1FA97F;color:#fff;padding:0.6rem 1.25rem;border-radius:6px;text-decoration:none;font-weight:600">Approve access</a></p>
<p style="margin-top:1.5rem;color:#666;font-size:0.875rem">If you don't recognise this person, ignore this email. The link expires when used.</p>
<p style="color:#666;font-size:0.875rem">Their email: ${esc(pendingEmail)}</p>
        `),
    });
}

async function sendApprovalConfirmation({ newUserEmail, orgName }) {
    await resend.emails.send({
        from: FROM,
        to: newUserEmail,
        subject: `You've been approved — ${esc(orgName)}`,
        html: emailWrap(`
<p>You now have access to the Superceptron portal for <strong>${esc(orgName)}</strong>.</p>
<p><a href="https://www.superceptron.com/portal-dashboard.html">Go to your dashboard →</a></p>
        `),
    });
}

async function sendShortlistReady({ recruiterEmail, recruiterName, roleTitle, deliverableNotes }) {
    await resend.emails.send({
        from: FROM,
        to: recruiterEmail,
        subject: `Shortlist ready — ${esc(roleTitle)}`,
        html: emailWrap(`
<p>Hi ${esc(recruiterName || 'there')},</p>
<p>The shortlist for <strong>${esc(roleTitle)}</strong> is ready.</p>
${deliverableNotes ? `<p><strong>Note:</strong> ${esc(deliverableNotes)}</p>` : ''}
<p><a href="https://www.superceptron.com/portal-dashboard.html">Download shortlist →</a></p>
<p style="margin-top:1.5rem;color:#666;font-size:0.875rem">The CV files you uploaded have been deleted from our servers as promised.</p>
        `),
    });
}

function emailWrap(body) {
    return `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:520px;margin:2rem auto;color:#14171A;line-height:1.6">${body}</body></html>`;
}

// ── CORS / method guard ──────────────────────────────────────

function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', 'https://www.superceptron.com');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
}

function handleOptions(req, res) {
    if (req.method === 'OPTIONS') {
        setCors(res);
        res.status(204).end();
        return true;
    }
    setCors(res);
    return false;
}

// ── Error handler ────────────────────────────────────────────

function sendError(res, err) {
    const status = err.status ?? 500;
    const message = status < 500 ? err.message : 'Internal server error';
    if (status >= 500) console.error(err);
    return res.status(status).json({ error: message });
}

module.exports = {
    createAdminClient,
    requireAuth,
    requireAdmin,
    requireRecruiter,
    isGenericDomain,
    extractDomain,
    validateFile,
    sanitiseFilename,
    writeAuditLog,
    sendSubmitConfirmation,
    sendAdminNewSubmission,
    sendApprovalRequest,
    sendApprovalConfirmation,
    sendShortlistReady,
    handleOptions,
    sendError,
    ADMIN_EMAIL,
};

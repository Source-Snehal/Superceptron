const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const RECIPIENTS = ['ceo@superceptron.com', 'snehalsavio123@gmail.com'];

function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { name, email, firm, volume, notes, botcheck } = req.body ?? {};

    // Honeypot: bots fill hidden fields. Pretend success, send nothing.
    if (botcheck) {
        return res.status(200).json({ ok: true });
    }

    if (!name?.trim() || !email?.trim() || !firm?.trim()) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Invalid email' });
    }

    const { data, error } = await resend.emails.send({
        from: 'Superceptron <onboarding@resend.dev>',
        to: RECIPIENTS,
        replyTo: email.trim(),
        subject: `First Role Free Request – ${name.trim()} @ ${firm.trim()}`,
        html: `
<h2 style="margin:0 0 1rem;font-family:sans-serif">First Role Free Request</h2>
<p style="font-family:sans-serif"><strong>Name:</strong> ${esc(name)}</p>
<p style="font-family:sans-serif"><strong>Email:</strong> <a href="mailto:${esc(email)}">${esc(email)}</a></p>
<p style="font-family:sans-serif"><strong>Firm:</strong> ${esc(firm)}</p>
${volume?.trim() ? `<p style="font-family:sans-serif"><strong>Typical resumes per batch:</strong> ${esc(volume)}</p>` : ''}
${notes?.trim() ? `<p style="font-family:sans-serif;margin-top:1rem"><strong>First role to screen:</strong></p><p style="font-family:sans-serif;white-space:pre-wrap;background:#f5f5f5;padding:1rem;border-radius:6px">${esc(notes)}</p>` : ''}
        `.trim(),
    });

    if (error) {
        console.error('Resend error:', error);
        return res.status(500).json({ error: 'Failed to send' });
    }

    return res.status(200).json({ ok: true });
};

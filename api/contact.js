const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

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

    const { name, email, company, message } = req.body ?? {};

    if (!name?.trim() || !email?.trim() || !message?.trim()) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Invalid email' });
    }

    try {
        await resend.emails.send({
            from: 'Superceptron <onboarding@resend.dev>',
            to: 'snehalsavio123@gmail.com',
            replyTo: email.trim(),
            subject: `New interest registration — ${name.trim()}`,
            html: `
<h2 style="margin:0 0 1rem;font-family:sans-serif">New Registration of Interest</h2>
<p style="font-family:sans-serif"><strong>Name:</strong> ${esc(name)}</p>
<p style="font-family:sans-serif"><strong>Email:</strong> <a href="mailto:${esc(email)}">${esc(email)}</a></p>
${company?.trim() ? `<p style="font-family:sans-serif"><strong>Company:</strong> ${esc(company)}</p>` : ''}
<p style="font-family:sans-serif;margin-top:1rem"><strong>Message:</strong></p>
<p style="font-family:sans-serif;white-space:pre-wrap;background:#f5f5f5;padding:1rem;border-radius:6px">${esc(message)}</p>
            `.trim(),
        });

        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('Resend error:', err);
        return res.status(500).json({ error: 'Failed to send' });
    }
};

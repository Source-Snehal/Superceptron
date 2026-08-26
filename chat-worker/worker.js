/**
 * Superceptron Chat Worker — Cloudflare Workers
 *
 * DEPLOY INSTRUCTIONS (one-time, ~5 minutes):
 *
 * 1. Create a free Cloudflare account at cloudflare.com
 * 2. Get a Claude API key at console.anthropic.com
 * 3. Install Wrangler CLI:
 *      npm install -g wrangler
 * 4. From this directory (chat-worker/), run:
 *      wrangler login
 *      wrangler deploy
 * 5. Set your secret API key (paste when prompted):
 *      wrangler secret put ANTHROPIC_API_KEY
 * 6. Your worker URL will be printed after deploy — looks like:
 *      https://superceptron-chat.YOURNAME.workers.dev
 * 7. Paste that URL into chatbot.js (WORKER_URL constant at the top)
 *
 * Cost: Claude Haiku is ~$0.001 per conversation. Cloudflare Workers free
 * tier covers 100,000 requests/day — more than enough for a chat widget.
 */

const SYSTEM_PROMPT = `You are Percy, the Superceptron AI assistant — concise, knowledgeable, and friendly.

ABOUT SUPERCEPTRON:
An AI resume screening service for independent recruiting firms, founded by Snehal Roymedhi. Snehal is the sole founder and does the work directly — no account managers, no handoffs, no ticket queues.

TWIN ENGINE APPROACH:
• Engine 1 — AI: reads every resume for semantic meaning (not keywords), ranks every candidate, writes a rationale for each — in minutes
• Engine 2 — Expert: a leading industry expert reviews every shortlist before it reaches the client, catching AI blind spots and calibrating to each client's specific needs
Result: a ranked shortlist with a written brief per candidate, delivered within the hour. The client always sees the reasoning and always makes the final call.

THE PROBLEM WE SOLVE:
• AI keyword tools silently bury great candidates who describe skills differently — they never appear in the pile. When a placement falls through, it's the recruiter's reputation at stake, not the algorithm's
• AI-written CVs are flooding inboxes: keyword-dense, polished, hollow. They sail through automated screening. Only a trained expert eye catches them — and spots genuine talent hidden behind non-standard formats
• Recruiters lose hours every week to resume admin. We take that off the desk entirely.

HOW IT WORKS:
1. Client sends resume batch + job spec by email (no software to install, no ATS migration)
2. AI scores and ranks every candidate in minutes
3. Industry expert reviews and validates the shortlist
4. Client receives ranked shortlist + written brief per candidate, within the hour
5. Client sees the full reasoning, makes the final call

PRICING:
• £89 per role (pay-as-you-go)
• £199/month (subscription — unlimited roles)
• 30-day free trial for new firms — no commitment, no sales call
• No seat licences. No minimum contracts. No annual commitments. Pay for what you use.

KEY SELLING POINTS vs ALTERNATIVES:
• vs ChatGPT/DIY AI: Superceptron does all the work. A human reviews every output. Plugs into your existing email workflow — no prompt engineering, no file handling.
• vs self-serve tools (ShortlistHQ etc): Zero tool adoption. Human review step included. You never log in to anything.
• vs hiring in-house: No salary, no onboarding, scales with your volume. Available same day.

WHO IT'S FOR:
Independent recruiting firms — focused teams, typically 1–20 consultants, who want to move faster without enterprise overhead. Works with any existing ATS or CRM (Bullhorn, Crelate, JobDiva, anything).

COMPANY DETAILS:
• Superceptron Limited (Companies House No. 17407955)
• Registered in England and Wales
• Registered office: Office 20638, 182–184 High Street North, East Ham, London E6 2JA
• Contact: info@superceptron.com

RESPONSE RULES (follow exactly):
1. Keep replies under 100 words unless the question genuinely needs more depth
2. Be direct and friendly — no corporate waffle, no buzzword soup
3. For sign-up or free trial → point to superceptron.com/register.html
4. When the user wants to: send a message, speak to Snehal, discuss their specific situation, ask a question for the team, or anything that warrants a personal reply → write a short helpful response AND add the token [CONTACT_FORM] on its own line at the very end
5. If asked something not covered here → say so honestly and suggest emailing info@superceptron.com directly
6. Never make up pricing, features, or facts not listed above`;

const SCORE_SYSTEM = `You are an expert CV analyst and senior recruitment specialist. Analyse the candidate's CV against the job description they provide.

Return ONLY valid JSON — no markdown fencing, no prose outside the JSON object.

Required structure:
{
  "overall_score": <integer 0-100>,
  "headline": "<one honest sentence — the single most important thing to know about this CV vs this JD>",
  "sections": [
    {
      "title": "Role Fit",
      "score": <integer 0-100>,
      "finding": "<specific observation grounded in actual content from both documents>",
      "suggestion": "<one concrete, actionable change: e.g. 'Add a line about X to your Y role'>"
    },
    {
      "title": "Keywords & Language",
      "score": <integer 0-100>,
      "finding": "<which key terms or phrases from the JD appear or are absent from the CV>",
      "suggestion": "<specific terms to surface and where to place them>"
    },
    {
      "title": "Experience Clarity",
      "score": <integer 0-100>,
      "finding": "<are achievements quantified? is impact clear? are there vague bullets that obscure real experience?>",
      "suggestion": "<a specific bullet or section to strengthen with a concrete example>"
    },
    {
      "title": "CV Structure",
      "score": <integer 0-100>,
      "finding": "<section order, length, formatting — what works and what doesn't for this type of role>",
      "suggestion": "<one specific structural change worth making>"
    }
  ],
  "quick_wins": [
    "<specific, immediately actionable suggestion>",
    "<specific, immediately actionable suggestion>",
    "<specific, immediately actionable suggestion>"
  ],
  "ai_flag": <true if the CV has strong signals of AI generation — generic language, high buzzword density, consistent phrasing without specific evidence, no rough edges; false otherwise>
}

Scoring calibration:
- Weak match or poor CV: 25-50
- Moderate match or mixed signals: 51-69
- Strong match with clear evidence: 70-85
- Exceptional match, very few gaps: 86-95
- Do not inflate scores. Honest assessment serves the candidate.

Language rules:
- Frame all feedback as helping the candidate surface their real strengths and make sure their experience comes across clearly
- Never say "beat," "trick," "hack," "game," or "fool" — say "make sure it reads clearly" or "ensure it comes through"
- Keep findings and suggestions to 1-2 sentences each
- Cite actual content from the CV and JD — never give generic advice`;

/* ── STRIPE + TIER CONFIG ───────────────────────────────────────
 * TODO: update amounts (GBP pence) before going live.
 * Change prices in ONE place here — nowhere else.
 * ─────────────────────────────────────────────────────────────── */
const PRICES = {
  cv_pdf:         { amount: 999,  label: 'SuperRewrite' }, // £9.99 / $9.99
  human_review:   { amount: 2999, label: 'SuperReview' },  // £29.99 / $29.99
  career_session: { amount: 8999, label: 'SuperCoach' },   // £89.99 / $89.99
};
// TODO: paste your Calendly / booking link here before launching tier 3
const BOOKING_URL = '';

const W3F_KEY = '8d60dc7b-2668-4945-9ae5-c522327c14da';

const SITE_ORIGIN = 'https://www.superceptron.com';

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return respond(null, 204);
    }

    if (request.method !== 'POST') {
      return respond('Method not allowed', 405);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // ── /score route (candidate CV analyser) ──
    if (path === '/score') return handleScore(request, env);

    // ── /create-checkout (Stripe Checkout Session) ──
    if (path === '/create-checkout') return handleCreateCheckout(request, env);

    // ── /stripe-webhook (payment confirmation) ──
    if (path === '/stripe-webhook') return handleStripeWebhook(request, env);

    // ── Default: chat route ──
    let body;
    try {
      body = await request.json();
    } catch {
      return respond('Invalid JSON', 400);
    }

    const { messages } = body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return respond('Invalid messages', 400);
    }

    // Trim to last 16 messages to keep context reasonable
    const trimmed = messages.slice(-16);

    try {
      const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          system: SYSTEM_PROMPT,
          messages: trimmed,
        }),
      });

      if (!apiRes.ok) {
        const err = await apiRes.text();
        console.error('Anthropic API error:', err);
        return respond(JSON.stringify({ text: "I'm having a moment — please email info@superceptron.com and Snehal will reply shortly." }), 200, { 'Content-Type': 'application/json' });
      }

      const data = await apiRes.json();
      const text = data.content?.[0]?.text ?? "I'm not sure how to answer that. Try emailing info@superceptron.com.";

      return respond(JSON.stringify({ text }), 200, { 'Content-Type': 'application/json' });

    } catch (err) {
      console.error('Worker error:', err);
      return respond(JSON.stringify({ text: "I'm having a moment — please email info@superceptron.com and Snehal will reply shortly." }), 200, { 'Content-Type': 'application/json' });
    }
  },
};

async function handleScore(request, env) {
  if (request.method !== 'POST') {
    return respond('Method not allowed', 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return respond('Invalid JSON', 400);
  }

  const { cv, jd } = body;
  if (!cv || !jd) {
    return respond(JSON.stringify({ error: 'Missing cv or jd' }), 400, { 'Content-Type': 'application/json' });
  }

  // Trim inputs to keep prompt within token budget
  const cvText = String(cv).slice(0, 8000);
  const jdText = String(jd).slice(0, 4000);

  const userMessage = `CV:\n${cvText}\n\nJob Description:\n${jdText}`;

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1800,
        system: SCORE_SYSTEM,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!apiRes.ok) {
      const err = await apiRes.text();
      console.error('Anthropic /score error:', err);
      return respond(JSON.stringify({ error: 'Analysis failed — please try again.' }), 200, { 'Content-Type': 'application/json' });
    }

    const data = await apiRes.json();
    const raw = data.content?.[0]?.text ?? '{}';

    // Strip any accidental markdown fencing before parsing
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    let result;
    try {
      result = JSON.parse(cleaned);
    } catch {
      console.error('JSON parse error, raw:', raw);
      return respond(JSON.stringify({ error: 'Could not parse analysis — please try again.' }), 200, { 'Content-Type': 'application/json' });
    }

    // Store CV + analysis in D1 (non-blocking — a DB error never fails the user's result)
    if (env.DB) {
      try {
        await env.DB.prepare(
          'INSERT INTO analyses (cv_text, jd_text, overall_score, headline, result_json) VALUES (?, ?, ?, ?, ?)'
        ).bind(cvText, jdText, result.overall_score ?? null, result.headline ?? null, JSON.stringify(result)).run();
      } catch (dbErr) {
        console.error('D1 insert error:', dbErr);
      }
    }

    return respond(JSON.stringify(result), 200, { 'Content-Type': 'application/json' });

  } catch (err) {
    console.error('Worker /score error:', err);
    return respond(JSON.stringify({ error: 'Analysis failed — please try again.' }), 200, { 'Content-Type': 'application/json' });
  }
}

/* ── STRIPE CHECKOUT ──────────────────────────────────────────── */
async function handleCreateCheckout(request, env) {
  let body;
  try { body = await request.json(); } catch { return respond('Invalid JSON', 400); }

  const { tier, cv, jd, currency } = body;
  const curr = (currency === 'usd') ? 'usd' : 'gbp';
  if (!tier || !PRICES[tier]) {
    return respond(JSON.stringify({ error: 'Invalid tier.' }), 400, { 'Content-Type': 'application/json' });
  }
  if (!env.STRIPE_SECRET_KEY) {
    return respond(JSON.stringify({ error: 'Stripe not configured on this server.' }), 500, { 'Content-Type': 'application/json' });
  }

  // Store purchase row before redirecting so we have CV/JD after payment lands
  let purchaseId = null;
  if (env.DB) {
    try {
      const ins = await env.DB.prepare(
        'INSERT INTO purchases (tier, status, cv_text, jd_text) VALUES (?, ?, ?, ?)'
      ).bind(
        tier,
        'pending',
        cv  ? String(cv).slice(0, 12000) : null,
        jd  ? String(jd).slice(0, 6000)  : null
      ).run();
      purchaseId = ins.meta.last_row_id;
    } catch (dbErr) {
      console.error('D1 insert (checkout):', dbErr);
    }
  }

  const params = new URLSearchParams({
    mode: 'payment',
    'line_items[0][price_data][currency]': curr,
    'line_items[0][price_data][product_data][name]': PRICES[tier].label,
    'line_items[0][price_data][unit_amount]': String(PRICES[tier].amount),
    'line_items[0][quantity]': '1',
    success_url: `${SITE_ORIGIN}/checkout-success.html?tier=${tier}&currency=${curr}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${SITE_ORIGIN}/checkout-cancel.html`,
    'metadata[tier]':        tier,
    'metadata[purchase_id]': String(purchaseId ?? ''),
  });

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!stripeRes.ok) {
    const err = await stripeRes.text();
    console.error('Stripe /checkout/sessions error:', err);
    return respond(
      JSON.stringify({ error: 'Could not create checkout session — please try again.' }),
      502, { 'Content-Type': 'application/json' }
    );
  }

  const session = await stripeRes.json();
  return respond(JSON.stringify({ url: session.url }), 200, { 'Content-Type': 'application/json' });
}

/* ── STRIPE WEBHOOK ───────────────────────────────────────────── */
async function handleStripeWebhook(request, env) {
  const sig     = request.headers.get('stripe-signature');
  const rawBody = await request.text();

  if (!sig || !env.STRIPE_WEBHOOK_SECRET) {
    return respond('Webhook not configured.', 400);
  }

  const valid = await verifyStripeSignature(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return respond('Invalid signature.', 400);

  let event;
  try { event = JSON.parse(rawBody); } catch { return respond('Invalid JSON.', 400); }

  if (event.type === 'checkout.session.completed') {
    const session    = event.data.object;
    const tier       = session.metadata?.tier ?? '';
    const purchaseId = parseInt(session.metadata?.purchase_id ?? '0', 10) || null;
    const email      = session.customer_details?.email ?? '';

    // Mark purchase paid and capture Stripe session ID + customer email
    if (purchaseId && env.DB) {
      try {
        await env.DB.prepare(
          `UPDATE purchases
           SET status = 'paid',
               stripe_session_id = ?,
               customer_email    = COALESCE(NULLIF(customer_email, ''), ?)
           WHERE id = ?`
        ).bind(session.id, email, purchaseId).run();
      } catch (dbErr) {
        console.error('D1 update (webhook):', dbErr);
      }
    }

    if (tier === 'human_review') {
      await notifyReview(email, purchaseId);
    }
    // TODO (cv_pdf):         trigger PDF generation pipeline when ready
    // TODO (career_session): booking handled client-side via BOOKING_URL constant
  }

  return respond(JSON.stringify({ received: true }), 200, { 'Content-Type': 'application/json' });
}

async function verifyStripeSignature(payload, sigHeader, secret) {
  const parts = {};
  for (const chunk of sigHeader.split(',')) {
    const eq = chunk.indexOf('=');
    if (eq !== -1) parts[chunk.slice(0, eq)] = chunk.slice(eq + 1);
  }
  if (!parts.t || !parts.v1) return false;

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(`${parts.t}.${payload}`)
  );
  const computed = Array.from(new Uint8Array(mac))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return computed === parts.v1;
}

async function notifyReview(customerEmail, purchaseId) {
  const fd = new FormData();
  fd.append('access_key', W3F_KEY);
  fd.append('subject',   'New Expert Review Purchase — Action Required');
  fd.append('from_name', 'Superceptron Payments');
  fd.append('name',      customerEmail || 'Unknown');
  fd.append('email',     customerEmail || 'info@superceptron.com');
  fd.append('cc',        'neal.roym@gmail.com');
  fd.append('message',
    `A candidate has purchased an Expert Human Review.\n\n` +
    `Customer email: ${customerEmail}\n` +
    `D1 purchase ID: ${purchaseId}\n\n` +
    `Retrieve their CV and JD:\n` +
    `wrangler d1 execute superceptron-cvs --command ` +
    `"SELECT id, tier, customer_email, cv_text, jd_text FROM purchases WHERE id = ${purchaseId};"`
  );
  try {
    await fetch('https://api.web3forms.com/submit', { method: 'POST', body: fd });
  } catch (e) {
    console.error('notifyReview web3forms error:', e);
  }
}

function respond(body, status, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      ...extraHeaders,
    },
  });
}

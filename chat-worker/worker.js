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

const SUPABASE_URL = 'https://nnvfflsenziqecjrdkks.supabase.co';
const SITE_ORIGIN  = 'https://www.superceptron.com';

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

    // ── /lead (homepage email capture) ──
    if (path === '/lead') return handleLead(request, env);

    // ── /cv-notify (fulfilment email on CV submission) ──
    if (path === '/cv-notify') return handleCvNotify(request, env);

    // ── /customer-portal (Stripe billing portal link) ──
    if (path === '/customer-portal') return handleCustomerPortal(request, env);

    // ── Admin routes (JWT + admins-table check on every call) ──
    if (path === '/admin/submissions')   return handleAdminSubmissions(request, env);
    if (path === '/admin/cv-url')        return handleAdminCvUrl(request, env);
    if (path === '/admin/set-status')    return handleAdminSetStatus(request, env);
    if (path === '/admin/complete')      return handleAdminComplete(request, env);

    // ── Candidate authenticated routes ──
    if (path === '/candidate/completed-url') return handleCandidateCompletedUrl(request, env);
    if (path === '/delete-account')          return handleDeleteAccount(request, env);

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
        max_tokens: 2400,
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
    const raw = data.content?.[0]?.text;

    if (!raw || !raw.trim()) {
      console.error('Empty Anthropic content:', JSON.stringify(data).slice(0, 300));
      return respond(JSON.stringify({ error: 'Analysis returned no content — please try again.' }), 200, { 'Content-Type': 'application/json' });
    }

    // Strip any accidental markdown fencing before parsing
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    let result;
    try {
      result = JSON.parse(cleaned);
    } catch {
      console.error('JSON parse error, raw:', raw.slice(0, 400));
      return respond(JSON.stringify({ error: 'Could not parse analysis — please try again.' }), 200, { 'Content-Type': 'application/json' });
    }

    // Guard against a structurally empty result (catches model returning {} or 0s)
    if (!result.overall_score || !Array.isArray(result.sections) || result.sections.length === 0) {
      console.error('Invalid result structure:', JSON.stringify(result).slice(0, 300));
      return respond(JSON.stringify({ error: 'Analysis did not produce a valid result — please try again.' }), 200, { 'Content-Type': 'application/json' });
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
    const session = event.data.object;
    const email   = session.customer_details?.email ?? '';

    // Parse client_reference_id written by cv-score.html: "{userId}___{tier}"
    const crid   = session.client_reference_id ?? '';
    const sepIdx = crid.indexOf('___');
    const userId = sepIdx !== -1 ? crid.slice(0, sepIdx) : null;
    const tier   = sepIdx !== -1 ? crid.slice(sepIdx + 3) : (session.metadata?.tier ?? '');

    // For subscriptions: fetch sub to get period_end
    let subId = null, periodEnd = null, customerId = session.customer ?? null;
    if (session.mode === 'subscription' && session.subscription && env.STRIPE_SECRET_KEY) {
      try {
        const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${session.subscription}`, {
          headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
        });
        if (subRes.ok) {
          const sub = await subRes.json();
          subId     = sub.id;
          periodEnd = new Date(sub.current_period_end * 1000).toISOString();
        }
      } catch (e) { console.error('Fetch subscription error:', e); }
    }

    // Write purchase to Supabase — upsert by user_id+tier so re-purchases or webhook replays don't duplicate
    if (userId && env.SUPABASE_SERVICE_KEY) {
      try {
        const updates = {
          status:               'paid',
          stripe_session_id:    session.id,
          stripe_customer_id:   customerId,
          subscription_id:      subId,
          subscription_status:  subId ? 'active' : null,
          current_period_end:   periodEnd,
        };
        // Check if a row already exists for this user+tier
        const checkRes = await fetch(
          `${SUPABASE_URL}/rest/v1/purchases?user_id=eq.${encodeURIComponent(userId)}&tier=eq.${encodeURIComponent(tier)}&select=id&limit=1`,
          { headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
        );
        const existing = checkRes.ok ? await checkRes.json() : [];
        if (existing.length > 0) {
          // Update the existing row
          const patchRes = await fetch(
            `${SUPABASE_URL}/rest/v1/purchases?id=eq.${existing[0].id}`,
            {
              method: 'PATCH',
              headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
              body: JSON.stringify(updates),
            }
          );
          if (!patchRes.ok) console.error('Supabase purchases patch error:', await patchRes.text());
        } else {
          // Insert a new row
          const postRes = await fetch(`${SUPABASE_URL}/rest/v1/purchases`, {
            method: 'POST',
            headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify({ user_id: userId, tier, ...updates }),
          });
          if (!postRes.ok) console.error('Supabase purchases insert error:', await postRes.text());
        }
      } catch (sbErr) { console.error('Supabase purchases fetch error:', sbErr); }
    }

    if (tier === 'super_review' || tier === 'human_review') {
      await notifyReview(email, session.id, env);
    }
    // TODO (cv_pdf):         trigger PDF generation pipeline when ready
    // TODO (career_session): booking handled client-side via BOOKING_URL constant
  }

  // ── Subscription updated (renewal, cancel, reactivate) ──
  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object;
    await supabaseUpdateBySub(env, sub.id, {
      subscription_status: sub.status,
      current_period_end:  new Date(sub.current_period_end * 1000).toISOString(),
    });
  }

  // ── Payment failed → mark past_due ──
  if (event.type === 'invoice.payment_failed') {
    const inv = event.data.object;
    if (inv.subscription) {
      await supabaseUpdateBySub(env, inv.subscription, { subscription_status: 'past_due' });
    }
  }

  // ── Invoice paid → restore active + new period_end ──
  if (event.type === 'invoice.paid') {
    const inv = event.data.object;
    if (inv.subscription && inv.lines?.data?.[0]?.period?.end) {
      await supabaseUpdateBySub(env, inv.subscription, {
        subscription_status: 'active',
        current_period_end:  new Date(inv.lines.data[0].period.end * 1000).toISOString(),
      });
    }
  }

  return respond(JSON.stringify({ received: true }), 200, { 'Content-Type': 'application/json' });
}

async function supabaseUpdateBySub(env, subscriptionId, updates) {
  if (!env.SUPABASE_SERVICE_KEY || !subscriptionId) return;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/purchases?subscription_id=eq.${encodeURIComponent(subscriptionId)}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json', 'Prefer': 'return=minimal',
        },
        body: JSON.stringify(updates),
      }
    );
    if (!res.ok) console.error('supabaseUpdateBySub error:', await res.text());
  } catch (e) { console.error('supabaseUpdateBySub fetch error:', e); }
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

/* ── EMAIL (Resend) ───────────────────────────────────────────── */
async function sendEmail(env, { to, subject, text }) {
  if (!env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — email not sent:', subject);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'Superceptron <notifications@superceptron.com>',
        to:      Array.isArray(to) ? to : [to],
        subject,
        text,
      }),
    });
    if (!res.ok) console.error('Resend error:', await res.text());
  } catch (e) {
    console.error('sendEmail error:', e);
  }
}

/* ── LEAD CAPTURE ─────────────────────────────────────────────── */
async function handleLead(request, env) {
  let body;
  try { body = await request.json(); } catch { return respond('Invalid JSON', 400); }

  const email = (body.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return respond(JSON.stringify({ error: 'Invalid email.' }), 400, { 'Content-Type': 'application/json' });
  }

  // Save to D1 leads table
  if (env.DB) {
    try {
      await env.DB.prepare(
        'INSERT OR IGNORE INTO leads (email) VALUES (?)'
      ).bind(email).run();
    } catch (dbErr) {
      console.error('D1 leads insert error:', dbErr);
    }
  }

  await sendEmail(env, {
    to:      'info@superceptron.com',
    subject: `New lead: ${email}`,
    text:    `New homepage lead.\n\nEmail: ${email}\n\nThey left their email on superceptron.com asking to be kept posted.`,
  });

  return respond(JSON.stringify({ ok: true }), 200, { 'Content-Type': 'application/json' });
}

/* ── CV SUBMISSION NOTIFY ────────────────────────────────────── */
async function handleCvNotify(request, env) {
  let body;
  try { body = await request.json(); } catch { return respond('Invalid JSON', 400); }

  const { submission_id, purchase_id, tier, user_email, storage_path, note } = body;

  const tierLabels = { super_review: 'SuperReview', super_rewrite: 'SuperRewrite', super_coach: 'SuperCoach' };
  const tierLabel  = tierLabels[tier] || tier;
  const dateStr    = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  // Generate a signed download URL (7 days) so admin can download the CV
  let fileUrl = null;
  const svcKey = env.SUPABASE_SERVICE_KEY || '';
  if (storage_path && svcKey) {
    try {
      const signRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/sign/cv-uploads/${storage_path}`,
        {
          method: 'POST',
          headers: {
            'apikey': svcKey, 'Authorization': `Bearer ${svcKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ expiresIn: 604800 }),
        }
      );
      if (signRes.ok) {
        const sd = await signRes.json();
        fileUrl = `${SUPABASE_URL}/storage/v1${sd.signedURL}`;
      } else {
        console.error('Signed URL error:', await signRes.text());
      }
    } catch (e) { console.error('Signed URL fetch error:', e); }
  }

  /* TODO: REPLACE WITH GOOGLE DRIVE API
   * Service account → auto-forward to per-tier subfolders:
   *   SuperReview/  SuperRewrite/  SuperCoach/
   * Swap this sendEmail call for a Drive upload when ready.
   * Function signature to keep: forwardCvToFulfilment(tierLabel, userEmail, fileUrl, note)
   */
  await sendEmail(env, {
    to:      'info@superceptron.com',
    subject: `[${tierLabel}] CV from ${user_email} — ${dateStr}`,
    text:
      `New ${tierLabel} submission.\n\n` +
      `Customer: ${user_email}\n` +
      `Tier: ${tierLabel}\n` +
      `Purchase ID: ${purchase_id}\n` +
      `Submission ID: ${submission_id}\n` +
      `Date: ${dateStr}\n\n` +
      `Note from customer:\n${note || '(none)'}\n\n` +
      (fileUrl
        ? `Download CV (link valid 7 days):\n${fileUrl}`
        : `Storage path: cv-uploads/${storage_path}\nDownload from Supabase Storage dashboard.`),
  });

  return respond(JSON.stringify({ ok: true }), 200, { 'Content-Type': 'application/json' });
}

/* ── STRIPE CUSTOMER PORTAL ───────────────────────────────────── */
async function handleCustomerPortal(request, env) {
  if (!env.STRIPE_SECRET_KEY) {
    return respond(JSON.stringify({ error: 'Not configured.' }), 500, { 'Content-Type': 'application/json' });
  }

  let body;
  try { body = await request.json(); } catch { return respond('Invalid JSON', 400); }

  const { stripe_customer_id } = body;
  if (!stripe_customer_id) {
    return respond(JSON.stringify({ error: 'Missing stripe_customer_id.' }), 400, { 'Content-Type': 'application/json' });
  }

  try {
    const params = new URLSearchParams({
      customer:   stripe_customer_id,
      return_url: `${SITE_ORIGIN}/profile.html`,
    });
    const portalRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    if (!portalRes.ok) {
      const err = await portalRes.text();
      console.error('Stripe portal error:', err);
      return respond(JSON.stringify({ error: 'Could not open billing portal.' }), 502, { 'Content-Type': 'application/json' });
    }
    const portal = await portalRes.json();
    return respond(JSON.stringify({ url: portal.url }), 200, { 'Content-Type': 'application/json' });
  } catch (e) {
    console.error('handleCustomerPortal error:', e);
    return respond(JSON.stringify({ error: 'Server error.' }), 500, { 'Content-Type': 'application/json' });
  }
}

async function notifyReview(customerEmail, purchaseId, env) {
  await sendEmail(env, {
    to:      ['info@superceptron.com', 'neal.roym@gmail.com'],
    subject: 'New Expert Review Purchase — Action Required',
    text:
      `A candidate has purchased an Expert Human Review.\n\n` +
      `Customer email: ${customerEmail}\n` +
      `D1 purchase ID: ${purchaseId}\n\n` +
      `Retrieve their CV and JD:\n` +
      `wrangler d1 execute superceptron-cvs --remote --command ` +
      `"SELECT id, tier, customer_email, cv_text, jd_text FROM purchases WHERE id = ${purchaseId};"`,
  });
}

/* ── AUTH VERIFICATION HELPERS ───────────────────────────────── */
async function verifyUser(token, env) {
  if (!token || !env.SUPABASE_SERVICE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${token}`,
      },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user?.id ? user : null;
  } catch { return null; }
}

async function verifyAdmin(token, env) {
  const user = await verifyUser(token, env);
  if (!user) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/admins?user_id=eq.${encodeURIComponent(user.id)}&select=user_id&limit=1`,
      { headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows.length > 0 ? user : null;
  } catch { return null; }
}

/* ── ADMIN ROUTES ─────────────────────────────────────────────── */

async function handleAdminSubmissions(request, env) {
  let body;
  try { body = await request.json(); } catch { return respond('Invalid JSON', 400); }
  const admin = await verifyAdmin(body.token, env);
  if (!admin) return respond(JSON.stringify({ error: 'Unauthorized' }), 403, { 'Content-Type': 'application/json' });

  const svcKey = env.SUPABASE_SERVICE_KEY;
  let url = `${SUPABASE_URL}/rest/v1/cv_submissions?select=*,purchases(id,tier,created_at,subscription_status)&order=submitted_at.desc`;
  if (body.status) url += `&status=eq.${encodeURIComponent(body.status)}`;

  const res = await fetch(url, {
    headers: { 'apikey': svcKey, 'Authorization': `Bearer ${svcKey}` },
  });
  if (!res.ok) return respond(JSON.stringify({ error: 'Failed to fetch submissions' }), 502, { 'Content-Type': 'application/json' });
  return respond(await res.text(), 200, { 'Content-Type': 'application/json' });
}

async function handleAdminCvUrl(request, env) {
  let body;
  try { body = await request.json(); } catch { return respond('Invalid JSON', 400); }
  const admin = await verifyAdmin(body.token, env);
  if (!admin) return respond(JSON.stringify({ error: 'Unauthorized' }), 403, { 'Content-Type': 'application/json' });

  const { storage_path, bucket = 'cv-uploads' } = body;
  if (!storage_path) return respond(JSON.stringify({ error: 'Missing storage_path' }), 400, { 'Content-Type': 'application/json' });
  const allowed = ['cv-uploads', 'completed-cvs'];
  if (!allowed.includes(bucket)) return respond(JSON.stringify({ error: 'Invalid bucket' }), 400, { 'Content-Type': 'application/json' });

  const svcKey = env.SUPABASE_SERVICE_KEY;
  const signRes = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${storage_path}`, {
    method: 'POST',
    headers: { 'apikey': svcKey, 'Authorization': `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 3600 }),
  });
  if (!signRes.ok) return respond(JSON.stringify({ error: 'Could not generate URL' }), 502, { 'Content-Type': 'application/json' });
  const sd = await signRes.json();
  return respond(JSON.stringify({ url: `${SUPABASE_URL}/storage/v1${sd.signedURL}` }), 200, { 'Content-Type': 'application/json' });
}

async function handleAdminSetStatus(request, env) {
  let body;
  try { body = await request.json(); } catch { return respond('Invalid JSON', 400); }
  const admin = await verifyAdmin(body.token, env);
  if (!admin) return respond(JSON.stringify({ error: 'Unauthorized' }), 403, { 'Content-Type': 'application/json' });

  const { submission_id } = body;
  if (!submission_id) return respond(JSON.stringify({ error: 'Missing submission_id' }), 400, { 'Content-Type': 'application/json' });

  const svcKey = env.SUPABASE_SERVICE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/cv_submissions?id=eq.${encodeURIComponent(submission_id)}`, {
    method: 'PATCH',
    headers: { 'apikey': svcKey, 'Authorization': `Bearer ${svcKey}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ status: 'in_review' }),
  });
  if (!res.ok) return respond(JSON.stringify({ error: 'Status update failed' }), 502, { 'Content-Type': 'application/json' });
  return respond(JSON.stringify({ ok: true }), 200, { 'Content-Type': 'application/json' });
}

async function handleAdminComplete(request, env) {
  let form;
  try { form = await request.formData(); } catch { return respond(JSON.stringify({ error: 'Invalid form data' }), 400, { 'Content-Type': 'application/json' }); }

  const token         = form.get('token');
  const submission_id = form.get('submission_id');
  const purchase_id   = form.get('purchase_id');
  const user_id       = form.get('user_id');
  const tier          = form.get('tier') || '';
  const candidate_email = form.get('candidate_email') || '';
  const file          = form.get('file');

  if (!token || !submission_id || !purchase_id || !user_id || !file) {
    return respond(JSON.stringify({ error: 'Missing required fields' }), 400, { 'Content-Type': 'application/json' });
  }

  const admin = await verifyAdmin(token, env);
  if (!admin) return respond(JSON.stringify({ error: 'Unauthorized' }), 403, { 'Content-Type': 'application/json' });

  if (file.type !== 'application/pdf') {
    return respond(JSON.stringify({ error: 'File must be a PDF' }), 400, { 'Content-Type': 'application/json' });
  }
  if (file.size > 20 * 1024 * 1024) {
    return respond(JSON.stringify({ error: 'File too large (max 20 MB)' }), 400, { 'Content-Type': 'application/json' });
  }

  const svcKey = env.SUPABASE_SERVICE_KEY;
  const storagePath = `${user_id}/${purchase_id}/completed.pdf`;
  const fileBuffer  = await file.arrayBuffer();

  const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/completed-cvs/${storagePath}`, {
    method: 'POST',
    headers: {
      'apikey': svcKey, 'Authorization': `Bearer ${svcKey}`,
      'Content-Type': 'application/pdf', 'x-upsert': 'true',
    },
    body: fileBuffer,
  });
  if (!uploadRes.ok) {
    console.error('Storage upload error:', await uploadRes.text());
    return respond(JSON.stringify({ error: 'File upload failed' }), 502, { 'Content-Type': 'application/json' });
  }

  const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/cv_submissions?id=eq.${encodeURIComponent(submission_id)}`, {
    method: 'PATCH',
    headers: { 'apikey': svcKey, 'Authorization': `Bearer ${svcKey}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ status: 'complete', completed_file_path: storagePath }),
  });
  if (!updateRes.ok) {
    console.error('Status update error:', await updateRes.text());
    return respond(JSON.stringify({ error: 'File uploaded but status update failed — retry or update manually' }), 502, { 'Content-Type': 'application/json' });
  }

  if (candidate_email) {
    const tierLabels = { super_review: 'SuperReview', super_rewrite: 'SuperRewrite', super_coach: 'SuperCoach' };
    const label = tierLabels[tier] || tier;
    await sendEmail(env, {
      to: candidate_email,
      subject: `Your ${label} from Superceptron is ready`,
      text:
        `Hi,\n\nYour ${label} is complete. Log in to download your reviewed CV:\n\n` +
        `${SITE_ORIGIN}/profile.html\n\n` +
        `Questions? Reply to this email or reach us at info@superceptron.com.\n\n` +
        `— Superceptron`,
    });
  }

  return respond(JSON.stringify({ ok: true }), 200, { 'Content-Type': 'application/json' });
}

/* ── CANDIDATE AUTHENTICATED ROUTES ──────────────────────────── */

async function handleCandidateCompletedUrl(request, env) {
  let body;
  try { body = await request.json(); } catch { return respond('Invalid JSON', 400); }

  const { token, purchase_id } = body;
  if (!token || !purchase_id) return respond(JSON.stringify({ error: 'Missing fields' }), 400, { 'Content-Type': 'application/json' });

  const user = await verifyUser(token, env);
  if (!user) return respond(JSON.stringify({ error: 'Unauthorized' }), 403, { 'Content-Type': 'application/json' });

  const svcKey = env.SUPABASE_SERVICE_KEY;

  // Confirm ownership: purchase must belong to this user
  const pRes = await fetch(
    `${SUPABASE_URL}/rest/v1/purchases?id=eq.${encodeURIComponent(purchase_id)}&user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`,
    { headers: { 'apikey': svcKey, 'Authorization': `Bearer ${svcKey}` } }
  );
  const purchases = pRes.ok ? await pRes.json() : [];
  if (purchases.length === 0) return respond(JSON.stringify({ error: 'Not found' }), 404, { 'Content-Type': 'application/json' });

  const storagePath = `${user.id}/${purchase_id}/completed.pdf`;
  const signRes = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/completed-cvs/${storagePath}`, {
    method: 'POST',
    headers: { 'apikey': svcKey, 'Authorization': `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 3600 }),
  });
  if (!signRes.ok) return respond(JSON.stringify({ error: 'Could not generate download link' }), 502, { 'Content-Type': 'application/json' });
  const sd = await signRes.json();
  return respond(JSON.stringify({ url: `${SUPABASE_URL}/storage/v1${sd.signedURL}` }), 200, { 'Content-Type': 'application/json' });
}

async function handleDeleteAccount(request, env) {
  let body;
  try { body = await request.json(); } catch { return respond('Invalid JSON', 400); }

  const user = await verifyUser(body.token, env);
  if (!user) return respond(JSON.stringify({ error: 'Unauthorized' }), 403, { 'Content-Type': 'application/json' });

  const svcKey = env.SUPABASE_SERVICE_KEY;
  const uid    = user.id;

  // Collect storage paths from cv_submissions before DB rows are deleted
  let cvPaths = [], completedPaths = [];
  try {
    const subRes = await fetch(
      `${SUPABASE_URL}/rest/v1/cv_submissions?user_id=eq.${uid}&select=storage_path,completed_file_path`,
      { headers: { 'apikey': svcKey, 'Authorization': `Bearer ${svcKey}` } }
    );
    if (subRes.ok) {
      const subs = await subRes.json();
      cvPaths        = subs.map(s => s.storage_path).filter(Boolean);
      completedPaths = subs.map(s => s.completed_file_path).filter(Boolean);
    }
  } catch (e) { console.error('GDPR: fetch subs error:', e); }

  // Delete files from Storage (non-blocking — don't fail the delete if storage cleanup fails)
  async function deleteFiles(bucket, paths) {
    if (!paths.length) return;
    await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, {
      method: 'DELETE',
      headers: { 'apikey': svcKey, 'Authorization': `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: paths }),
    });
  }
  try { await deleteFiles('cv-uploads',   cvPaths); }        catch (e) { console.error('GDPR: cv-uploads delete:', e); }
  try { await deleteFiles('completed-cvs', completedPaths); } catch (e) { console.error('GDPR: completed-cvs delete:', e); }

  // Delete the auth user — FK ON DELETE CASCADE handles profiles, purchases, cv_submissions
  const delRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE',
    headers: { 'apikey': svcKey, 'Authorization': `Bearer ${svcKey}` },
  });
  if (!delRes.ok) {
    console.error('GDPR: auth delete error:', await delRes.text());
    return respond(JSON.stringify({ error: 'Deletion failed — contact info@superceptron.com' }), 502, { 'Content-Type': 'application/json' });
  }

  return respond(JSON.stringify({ ok: true }), 200, { 'Content-Type': 'application/json' });
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

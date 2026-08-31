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
• $89 per role (pay-as-you-go)
• $199/month (subscription — up to 5 roles)
• Your first role is free for new firms — no commitment, no sales call
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

/* ── USAGE / OVERFLOW CONFIG ─────────────────────────────────────
 * One place for review allowances + £15 overflow price.
 * ─────────────────────────────────────────────────────────────── */
const OVERFLOW_PAYMENT_LINK = 'https://buy.stripe.com/9B628ka93fMyfxjf6agUM09'; // £15 extra review
const TIER_REVIEW_ALLOWANCE = { super_review: 2 }; // tiers that include human reviews

/* ── FREE SCORER RATE LIMIT ──────────────────────────────────────
 * Tune this number without touching any other code.
 * ─────────────────────────────────────────────────────────────── */
const FREE_SCORER_DAILY_LIMIT = 5; // runs per IP per rolling 24 hours

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

    // ── Usage + overflow routes ──
    if (path === '/submit-review')       return handleSubmitReview(request, env);
    if (path === '/buy-overflow-review') return handleBuyOverflowReview(request, env);
    if (path === '/usage')               return handleUsage(request, env);

    // ── Admin routes (JWT + admins-table check on every call) ──
    if (path === '/admin/submissions')   return handleAdminSubmissions(request, env);
    if (path === '/admin/cv-url')        return handleAdminCvUrl(request, env);
    if (path === '/admin/set-status')    return handleAdminSetStatus(request, env);
    if (path === '/admin/complete')      return handleAdminComplete(request, env);

    // ── Candidate authenticated routes ──
    if (path === '/candidate/completed-url') return handleCandidateCompletedUrl(request, env);
    if (path === '/delete-account')          return handleDeleteAccount(request, env);
    if (path === '/ai-rewrite')              return handleAiRewrite(request, env);

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

  // ── Rate limit check (must run before any Claude API call) ──
  try {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const ipHash = await sha256Hex(ip);
    const rlRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_scorer_rate_limit`, {
      method: 'POST',
      headers: {
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ p_ip_hash: ipHash, p_limit: FREE_SCORER_DAILY_LIMIT }),
    });
    if (rlRes.ok) {
      const rl = await rlRes.json();
      if (!rl.allowed) {
        return respond(
          JSON.stringify({ error: "You've used your 5 free scores for today. Try again in 24 hours, or upgrade for unlimited scoring.", upgradeUrl: '/pricing.html' }),
          429,
          { 'Content-Type': 'application/json' }
        );
      }
    } else {
      // Rate limit check failed — log and allow rather than blocking the user
      console.error('Rate limit check failed:', rlRes.status, await rlRes.text());
    }
  } catch (rlErr) {
    console.error('Rate limit error (allowing request):', rlErr);
  }

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

    let data;
    try {
      data = await apiRes.json();
    } catch (parseErr) {
      console.error('Anthropic /score response parse error:', parseErr);
      return respond(JSON.stringify({ error: 'Analysis failed — please try again.' }), 200, { 'Content-Type': 'application/json' });
    }

    // Handle Anthropic error objects returned with 200 status (e.g. overloaded)
    if (data.type === 'error' || !data.content) {
      console.error('Anthropic /score returned error object:', JSON.stringify(data).slice(0, 300));
      return respond(JSON.stringify({ error: 'Analysis failed — please try again.' }), 200, { 'Content-Type': 'application/json' });
    }

    const raw = data.content?.[0]?.text;

    if (!raw || !raw.trim()) {
      console.error('Empty Anthropic content:', JSON.stringify(data).slice(0, 300));
      return respond(JSON.stringify({ error: 'Analysis returned no content — please try again.' }), 200, { 'Content-Type': 'application/json' });
    }

    // Strip markdown fencing — handle both boundary-exact and mid-text wrapping
    const cleaned = raw
      .replace(/^```(?:json)?\r?\n?/im, '')
      .replace(/\r?\n?```\s*$/m, '')
      .trim();

    let result;
    try {
      result = JSON.parse(cleaned);
    } catch {
      // Fallback: extract the outermost {...} block — handles model adding a preamble or suffix
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          result = JSON.parse(jsonMatch[0]);
        } catch (innerErr) {
          console.error('JSON parse error (both passes), raw:', raw.slice(0, 500));
          return respond(JSON.stringify({ error: 'Could not parse analysis — please try again.' }), 200, { 'Content-Type': 'application/json' });
        }
      } else {
        console.error('No JSON object in response, raw:', raw.slice(0, 500));
        return respond(JSON.stringify({ error: 'Could not parse analysis — please try again.' }), 200, { 'Content-Type': 'application/json' });
      }
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

    // Write purchase to Supabase — skip for overflow_review (not a subscription purchase)
    if (userId && env.SUPABASE_SERVICE_KEY && tier !== 'overflow_review') {
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

    // Overflow review purchase: idempotently increment reviews_allowance
    if (tier === 'overflow_review') {
      if (userId && env.SUPABASE_SERVICE_KEY) {
        await handleOverflowPayment(env, session.id, userId);
      }
    }
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

  // ── Invoice paid → restore active + new period_end + reset usage row ──
  if (event.type === 'invoice.paid') {
    const inv = event.data.object;
    if (inv.subscription && inv.lines?.data?.[0]?.period) {
      const period      = inv.lines.data[0].period;
      const periodStart = new Date(period.start * 1000).toISOString();
      const periodEnd   = new Date(period.end   * 1000).toISOString();
      await supabaseUpdateBySub(env, inv.subscription, {
        subscription_status:  'active',
        current_period_start: periodStart,
        current_period_end:   periodEnd,
      });
      await upsertUsagePeriod(env, inv.subscription, periodStart, periodEnd);
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

/* ── AI REWRITE ───────────────────────────────────────────────── */
async function handleAiRewrite(request, env) {
  let body;
  try { body = await request.json(); } catch { return respond('Invalid JSON', 400); }

  const { token, cv_text, jd_text } = body;
  if (!token || !cv_text || !jd_text) {
    return respond(JSON.stringify({ error: 'Missing fields' }), 400, { 'Content-Type': 'application/json' });
  }

  const user = await verifyUser(token, env);
  if (!user) return respond(JSON.stringify({ error: 'Unauthorized' }), 403, { 'Content-Type': 'application/json' });

  // Verify active super_rewrite or super_review subscription
  const subRes = await fetch(
    `${SUPABASE_URL}/rest/v1/purchases?user_id=eq.${encodeURIComponent(user.id)}&status=eq.paid&select=tier,subscription_status`,
    { headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
  );
  if (!subRes.ok) return respond(JSON.stringify({ error: 'Subscription check failed' }), 500, { 'Content-Type': 'application/json' });
  const subs = await subRes.json();
  const hasAccess = Array.isArray(subs) && subs.some(s =>
    (s.tier === 'super_rewrite' || s.tier === 'super_review') &&
    (s.subscription_status === 'active' || s.subscription_status === 'past_due')
  );
  if (!hasAccess) return respond(JSON.stringify({ error: 'No active SuperRewrite subscription' }), 403, { 'Content-Type': 'application/json' });

  const prompt = `You are an elite CV writer with 20 years of experience placing candidates at top companies. Rewrite the candidate's CV for the specific job description below.

Rules — follow every one:
- Preserve ALL facts: employers, job titles, dates, education, certifications. Never fabricate or exaggerate.
- Mirror the exact keywords, competencies, and terminology from the JD throughout the CV — ATS systems match on exact phrasing.
- Open with a tight 3-sentence Professional Summary written directly for this role and sector.
- Include a Core Skills section as a clean keyword grid (12–18 skills drawn from both the original CV and the JD).
- Experience bullets: strong action verb → specific achievement → quantified result (use original figures; do not invent numbers).
- ATS-safe structure only — no tables, no text boxes, no columns, no images, no headers/footers.
- Section order: Contact Info · Professional Summary · Core Skills · Professional Experience (reverse-chronological) · Education · Certifications (if present).
- Output a COMPLETE, SELF-CONTAINED HTML document with all CSS embedded in a <style> tag.
- Design: A4-width (210mm), Inter or system-ui sans-serif, 11pt body, 1.5 line-height, accent colour #7b68ee on name and section headings, subtle top rule under each section heading, generous white space, print-ready (no background colours on sections).
- The file must look polished when opened in a browser and printed to PDF.

JOB DESCRIPTION:
${jd_text}

CANDIDATE'S CURRENT CV:
${cv_text}

Output the complete HTML document only — no commentary before or after, no markdown code fences.`;

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-5',
      max_tokens: 8000,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });

  if (!aiRes.ok) return respond(JSON.stringify({ error: 'AI service error' }), 502, { 'Content-Type': 'application/json' });

  const aiData = await aiRes.json();
  const rewritten = aiData.content && aiData.content[0] && aiData.content[0].text;
  if (!rewritten) return respond(JSON.stringify({ error: 'Empty AI response' }), 502, { 'Content-Type': 'application/json' });

  return respond(JSON.stringify({ cv: rewritten }), 200, { 'Content-Type': 'application/json' });
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

  // Explicitly delete public-schema rows before deleting the auth user.
  // This avoids FK constraint failures when CASCADE is not configured on the DB tables.
  const svcHdrs = { 'apikey': svcKey, 'Authorization': `Bearer ${svcKey}` };
  const uidQ    = `user_id=eq.${uid}`;
  await Promise.allSettled([
    fetch(`${SUPABASE_URL}/rest/v1/cv_submissions?${uidQ}`,   { method: 'DELETE', headers: svcHdrs }),
    fetch(`${SUPABASE_URL}/rest/v1/review_usage?${uidQ}`,     { method: 'DELETE', headers: svcHdrs }),
    fetch(`${SUPABASE_URL}/rest/v1/purchases?${uidQ}`,        { method: 'DELETE', headers: svcHdrs }),
  ]);
  // profiles uses id = uid (not user_id)
  await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${uid}`, { method: 'DELETE', headers: svcHdrs })
        .catch(e => console.error('GDPR: profiles delete:', e));

  // Now delete the auth user
  const delRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE',
    headers: svcHdrs,
  });
  if (!delRes.ok) {
    const errText = await delRes.text().catch(() => '');
    console.error('GDPR: auth delete error:', errText);
    return respond(JSON.stringify({ error: 'Deletion failed — contact info@superceptron.com' }), 502, { 'Content-Type': 'application/json' });
  }

  return respond(JSON.stringify({ ok: true }), 200, { 'Content-Type': 'application/json' });
}

/* ── USAGE HELPERS ────────────────────────────────────────────── */

async function upsertUsagePeriod(env, subscriptionId, periodStart, periodEnd) {
  if (!env.SUPABASE_SERVICE_KEY || !subscriptionId) return;
  const svcKey = env.SUPABASE_SERVICE_KEY;
  // Look up user_id + tier from the purchases row for this subscription
  const pRes = await fetch(
    `${SUPABASE_URL}/rest/v1/purchases?subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=user_id,tier&limit=1`,
    { headers: { 'apikey': svcKey, 'Authorization': `Bearer ${svcKey}` } }
  );
  if (!pRes.ok) { console.error('upsertUsagePeriod: purchases lookup failed'); return; }
  const rows = await pRes.json();
  if (!rows.length) return;
  const { user_id, tier } = rows[0];
  const allowance = TIER_REVIEW_ALLOWANCE[tier];
  if (!allowance) return; // tier doesn't include capped human reviews
  // Insert — on conflict (subscription_id, period_start) do nothing, preserving reviews_used mid-period
  const res = await fetch(`${SUPABASE_URL}/rest/v1/usage`, {
    method: 'POST',
    headers: {
      'apikey': svcKey, 'Authorization': `Bearer ${svcKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify({
      user_id, subscription_id: subscriptionId,
      period_start: periodStart, period_end: periodEnd,
      reviews_used: 0, reviews_allowance: allowance,
    }),
  });
  if (!res.ok) console.error('upsertUsagePeriod error:', await res.text());
}

async function getCurrentUsage(env, userId) {
  const svcKey = env.SUPABASE_SERVICE_KEY;
  const now = new Date().toISOString();
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/usage?user_id=eq.${encodeURIComponent(userId)}&period_start=lte.${encodeURIComponent(now)}&period_end=gt.${encodeURIComponent(now)}&order=period_start.desc&limit=1`,
    { headers: { 'apikey': svcKey, 'Authorization': `Bearer ${svcKey}` } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

async function handleOverflowPayment(env, sessionId, userId) {
  const svcKey = env.SUPABASE_SERVICE_KEY;
  // Idempotency: bail if already processed
  const chkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/overflow_payments?stripe_session_id=eq.${encodeURIComponent(sessionId)}&select=stripe_session_id&limit=1`,
    { headers: { 'apikey': svcKey, 'Authorization': `Bearer ${svcKey}` } }
  );
  if (chkRes.ok) {
    const existing = await chkRes.json();
    if (existing.length > 0) { console.log('overflow already processed:', sessionId); return; }
  }
  // Find the current usage row for this user
  const usage = await getCurrentUsage(env, userId);
  if (!usage) { console.error('handleOverflowPayment: no usage row for user', userId); return; }
  // Increment reviews_allowance by 1
  const patchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/usage?id=eq.${encodeURIComponent(usage.id)}`,
    {
      method: 'PATCH',
      headers: { 'apikey': svcKey, 'Authorization': `Bearer ${svcKey}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ reviews_allowance: usage.reviews_allowance + 1 }),
    }
  );
  if (!patchRes.ok) { console.error('handleOverflowPayment: allowance increment failed:', await patchRes.text()); return; }
  // Log the payment for idempotency
  await fetch(`${SUPABASE_URL}/rest/v1/overflow_payments`, {
    method: 'POST',
    headers: { 'apikey': svcKey, 'Authorization': `Bearer ${svcKey}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ stripe_session_id: sessionId, user_id: userId, usage_id: usage.id }),
  });
}

/* ── USAGE + OVERFLOW ROUTE HANDLERS ─────────────────────────── */

async function handleSubmitReview(request, env) {
  let body;
  try { body = await request.json(); } catch { return respond('Invalid JSON', 400); }
  const { token, purchase_id, storage_path, request_note } = body;
  if (!token || !purchase_id || !storage_path) {
    return respond(JSON.stringify({ error: 'Missing required fields' }), 400, { 'Content-Type': 'application/json' });
  }

  const user = await verifyUser(token, env);
  if (!user) return respond(JSON.stringify({ error: 'Unauthorized' }), 403, { 'Content-Type': 'application/json' });

  const svcKey = env.SUPABASE_SERVICE_KEY;
  const uid    = user.id;

  // Confirm the purchase belongs to this user and get tier
  const pRes = await fetch(
    `${SUPABASE_URL}/rest/v1/purchases?id=eq.${encodeURIComponent(purchase_id)}&user_id=eq.${encodeURIComponent(uid)}&select=id,tier&limit=1`,
    { headers: { 'apikey': svcKey, 'Authorization': `Bearer ${svcKey}` } }
  );
  const purchases = pRes.ok ? await pRes.json() : [];
  if (!purchases.length) return respond(JSON.stringify({ error: 'Purchase not found' }), 404, { 'Content-Type': 'application/json' });

  const { tier } = purchases[0];
  if (!TIER_REVIEW_ALLOWANCE[tier]) {
    return respond(JSON.stringify({ error: 'tier_not_eligible', message: 'Your plan does not include human reviews.' }), 403, { 'Content-Type': 'application/json' });
  }

  // Enforce cap
  const usage = await getCurrentUsage(env, uid);
  if (!usage) {
    return respond(JSON.stringify({ error: 'no_usage_record', message: 'Usage record not found — contact support.' }), 403, { 'Content-Type': 'application/json' });
  }
  if (usage.reviews_used >= usage.reviews_allowance) {
    return respond(JSON.stringify({
      error:             'cap_reached',
      reviews_used:      usage.reviews_used,
      reviews_allowance: usage.reviews_allowance,
      period_end:        usage.period_end,
    }), 403, { 'Content-Type': 'application/json' });
  }

  // Increment reviews_used
  const incRes = await fetch(
    `${SUPABASE_URL}/rest/v1/usage?id=eq.${encodeURIComponent(usage.id)}`,
    {
      method: 'PATCH',
      headers: { 'apikey': svcKey, 'Authorization': `Bearer ${svcKey}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ reviews_used: usage.reviews_used + 1 }),
    }
  );
  if (!incRes.ok) {
    return respond(JSON.stringify({ error: 'Server error — please try again.' }), 502, { 'Content-Type': 'application/json' });
  }

  // Insert into cv_submissions (service role — bypasses client INSERT restrictions)
  const subRes = await fetch(`${SUPABASE_URL}/rest/v1/cv_submissions`, {
    method: 'POST',
    headers: { 'apikey': svcKey, 'Authorization': `Bearer ${svcKey}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify({
      purchase_id, user_id: uid, storage_path,
      request_note: request_note || '', status: 'submitted', candidate_email: user.email,
    }),
  });
  if (!subRes.ok) {
    // Roll back the increment so the user can try again
    await fetch(`${SUPABASE_URL}/rest/v1/usage?id=eq.${encodeURIComponent(usage.id)}`, {
      method: 'PATCH',
      headers: { 'apikey': svcKey, 'Authorization': `Bearer ${svcKey}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ reviews_used: usage.reviews_used }),
    });
    return respond(JSON.stringify({ error: 'Submission failed — please try again.' }), 502, { 'Content-Type': 'application/json' });
  }
  const subData = await subRes.json();
  const sub = Array.isArray(subData) ? subData[0] : subData;

  // Notify admin (awaited to ensure delivery)
  const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  let fileUrl = null;
  try {
    const signRes = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/cv-uploads/${storage_path}`, {
      method: 'POST',
      headers: { 'apikey': svcKey, 'Authorization': `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 604800 }),
    });
    if (signRes.ok) { const sd = await signRes.json(); fileUrl = `${SUPABASE_URL}/storage/v1${sd.signedURL}`; }
  } catch (_) {}
  try {
    await sendEmail(env, {
      to: ['info@superceptron.com', 'neal.roym@gmail.com'],
      subject: `[SuperReview] CV from ${user.email} — ${dateStr}`,
      text:
        `New SuperReview submission.\n\n` +
        `Customer: ${user.email}\nPurchase ID: ${purchase_id}\nSubmission ID: ${sub?.id}\nDate: ${dateStr}\n` +
        `Reviews used this period: ${usage.reviews_used + 1} / ${usage.reviews_allowance}\n\n` +
        `Note:\n${request_note || '(none)'}\n\n` +
        (fileUrl ? `Download CV (7 days):\n${fileUrl}` : `Storage path: cv-uploads/${storage_path}`),
    });
  } catch (_) {}

  return respond(JSON.stringify({ ok: true, submission: sub || null }), 200, { 'Content-Type': 'application/json' });
}

async function handleBuyOverflowReview(request, env) {
  let body;
  try { body = await request.json(); } catch { return respond('Invalid JSON', 400); }

  const user = await verifyUser(body.token, env);
  if (!user) return respond(JSON.stringify({ error: 'Unauthorized' }), 403, { 'Content-Type': 'application/json' });
  if (!OVERFLOW_PAYMENT_LINK) {
    return respond(JSON.stringify({ error: 'overflow_not_configured', message: 'Extra review purchases are not yet available.' }), 503, { 'Content-Type': 'application/json' });
  }

  // Stripe Payment Links accept ?client_reference_id — encode userId+tier so the webhook identifies this payment
  const url = OVERFLOW_PAYMENT_LINK + '?client_reference_id=' + encodeURIComponent(user.id + '___overflow_review');
  return respond(JSON.stringify({ url }), 200, { 'Content-Type': 'application/json' });
}

async function handleUsage(request, env) {
  let body;
  try { body = await request.json(); } catch { return respond('Invalid JSON', 400); }
  const user = await verifyUser(body.token, env);
  if (!user) return respond(JSON.stringify({ error: 'Unauthorized' }), 403, { 'Content-Type': 'application/json' });
  const usage = await getCurrentUsage(env, user.id);
  if (!usage) return respond(JSON.stringify({ eligible: false }), 200, { 'Content-Type': 'application/json' });
  return respond(JSON.stringify({
    eligible:          true,
    reviews_used:      usage.reviews_used,
    reviews_allowance: usage.reviews_allowance,
    period_start:      usage.period_start,
    period_end:        usage.period_end,
  }), 200, { 'Content-Type': 'application/json' });
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

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

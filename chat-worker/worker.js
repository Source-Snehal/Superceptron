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

const SYSTEM_PROMPT = `You are the Superceptron assistant — a concise, knowledgeable chatbot for Superceptron.

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

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return respond(null, 204);
    }

    if (request.method !== 'POST') {
      return respond('Method not allowed', 405);
    }

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

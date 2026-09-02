/*!
 * Superceptron Chat Widget
 *
 * SETUP — do this once after deploying the worker:
 *   1. Follow instructions in chat-worker/worker.js to deploy to Cloudflare
 *   2. Replace WORKER_URL below with your .workers.dev URL
 *   3. Done — this script is already included on every page
 */
(function () {
  'use strict';

  /* ── CONFIG ────────────────────────────────────────────────── */
  var WORKER_URL = 'https://superceptron-chat.superceptron.workers.dev';
  var W3F_KEY    = '8d60dc7b-2668-4945-9ae5-c522327c14da';
  var GREETING   = "Hi — I’m Percy, Superceptron’s AI assistant. Ask me anything about our resume screening service, pricing, or how to get started.";

  /* ── Recruiter specialization routing (index.html, recruiter-tech.html,
       recruiter-engineering.html only — cv-score.html and every other page
       keep the default GREETING above, unchanged) ── */
  var ROUTING_GREETING  = "Hey — are you hiring for tech roles, or engineering/construction?";
  var ROUTING_PAGES     = ['/', '/index.html', '/recruiter-tech.html', '/recruiter-engineering.html'];
  var TECH_KEYWORDS     = ['software', 'backend', 'data', 'ml'];
  var ENGINEERING_KEYWORDS = ['superintendent', 'foreman', 'bim', 'civil', 'electrician'];

  /* Shown once, on arrival, after Percy routes someone to a specialization
     page — replaces the routing question there instead of repeating it. */
  var ROUTED_KEY = 'sc_routed_from';
  var ROUTED_WELCOME = {
    tech: "Welcome to Tech Recruitment — I’m Percy. Ask me anything about how shortlisting works for software, data, or AI/ML roles, pricing, or how to get started.",
    engineering: "Welcome to Engineering & Construction Recruitment — I’m Percy. Ask me anything about how shortlisting works for site managers, engineers, or trades, pricing, or how to get started."
  };

  if (WORKER_URL.indexOf('YOUR_SUBDOMAIN') !== -1) {
    console.warn('[Superceptron chat] Worker not configured yet. Set WORKER_URL in chatbot.js after deploying chat-worker/worker.js.');
    return;
  }

  /* ── CSS ────────────────────────────────────────────────────── */
  var CSS = [
    '#sc-btn{position:fixed;bottom:28px;right:28px;width:56px;height:56px;border-radius:50%;background:#0e0e0e;border:1.5px solid rgba(77,255,180,0.32);box-shadow:0 4px 24px rgba(0,0,0,0.45);cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:9998;transition:box-shadow .25s,border-color .25s,transform .2s;}',
    '#sc-btn:hover{border-color:rgba(77,255,180,0.7);box-shadow:0 0 0 6px rgba(77,255,180,0.07),0 4px 24px rgba(0,0,0,0.45);transform:scale(1.06);}',
    '#sc-btn svg{transition:transform .3s;}',
    '#sc-btn.sc-open svg{transform:rotate(45deg);}',

    '#sc-panel{position:fixed;bottom:96px;right:28px;width:360px;height:528px;background:#0e0e0e;border:1px solid rgba(255,255,255,0.07);border-radius:20px;box-shadow:0 28px 72px rgba(0,0,0,0.65),0 0 0 1px rgba(77,255,180,0.05);display:flex;flex-direction:column;overflow:hidden;z-index:9999;opacity:0;transform:translateY(14px) scale(0.97);pointer-events:none;transition:opacity .25s cubic-bezier(0.16,1,0.3,1),transform .25s cubic-bezier(0.16,1,0.3,1);}',
    '#sc-panel.sc-open{opacity:1;transform:translateY(0) scale(1);pointer-events:all;}',

    '#sc-head{padding:1rem 1.25rem;background:#070707;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:.75rem;flex-shrink:0;}',
    '#sc-avatar{width:36px;height:36px;border-radius:50%;background:rgba(77,255,180,0.07);border:1px solid rgba(77,255,180,0.24);display:flex;align-items:center;justify-content:center;flex-shrink:0;}',
    '#sc-head-info{flex:1;}',
    '#sc-head-name{font-family:Inter,sans-serif;font-size:.875rem;font-weight:700;color:#fff;letter-spacing:-.01em;display:block;}',
    '#sc-head-status{font-family:"JetBrains Mono",monospace;font-size:.65rem;color:rgba(77,255,180,.75);letter-spacing:.04em;display:flex;align-items:center;gap:.35rem;}',
    '#sc-head-status::before{content:"";width:6px;height:6px;border-radius:50%;background:#4DFFB4;display:inline-block;}',
    '#sc-close-btn{background:none;border:none;color:rgba(255,255,255,.28);cursor:pointer;padding:4px;border-radius:6px;display:flex;align-items:center;justify-content:center;transition:color .2s,background .2s;}',
    '#sc-close-btn:hover{color:#fff;background:rgba(255,255,255,.07);}',

    '#sc-msgs{flex:1;overflow-y:auto;padding:1.125rem;display:flex;flex-direction:column;gap:.875rem;scroll-behavior:smooth;}',
    '#sc-msgs::-webkit-scrollbar{width:3px;}',
    '#sc-msgs::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);border-radius:2px;}',

    '.sc-row{display:flex;flex-direction:column;max-width:86%;}',
    '.sc-row.sc-bot{align-self:flex-start;}',
    '.sc-row.sc-user{align-self:flex-end;}',
    '.sc-bubble{padding:.7rem .95rem;border-radius:14px;font-family:Inter,sans-serif;font-size:.8375rem;line-height:1.65;}',
    '.sc-bot .sc-bubble{background:#141414;border:1px solid rgba(255,255,255,.07);color:rgba(255,255,255,.88);border-bottom-left-radius:4px;}',
    '.sc-user .sc-bubble{background:#4DFFB4;color:#070707;font-weight:500;border-bottom-right-radius:4px;}',
    '.sc-bubble a{color:#4DFFB4;text-decoration:underline;}',
    '.sc-user .sc-bubble a{color:#1a3f30;}',

    '.sc-typing{display:flex;gap:5px;align-items:center;padding:.7rem .95rem;background:#141414;border:1px solid rgba(255,255,255,.07);border-radius:14px;border-bottom-left-radius:4px;width:fit-content;}',
    '.sc-typing span{width:5px;height:5px;border-radius:50%;background:rgba(77,255,180,.5);animation:sc-dot 1.4s ease-in-out infinite;}',
    '.sc-typing span:nth-child(2){animation-delay:.2s;}',
    '.sc-typing span:nth-child(3){animation-delay:.4s;}',
    '@keyframes sc-dot{0%,80%,100%{opacity:.3;transform:scale(.8);}40%{opacity:1;transform:scale(1);}}',

    '.sc-cform{background:#141414;border:1px solid rgba(77,255,180,.14);border-radius:14px;border-bottom-left-radius:4px;padding:.875rem;display:flex;flex-direction:column;gap:.55rem;max-width:92%;align-self:flex-start;}',
    '.sc-cform input,.sc-cform textarea{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:.575rem .75rem;font-family:Inter,sans-serif;font-size:.8rem;color:#fff;outline:none;width:100%;box-sizing:border-box;transition:border-color .2s;}',
    '.sc-cform input::placeholder,.sc-cform textarea::placeholder{color:rgba(255,255,255,.2);}',
    '.sc-cform input:focus,.sc-cform textarea:focus{border-color:rgba(77,255,180,.35);}',
    '.sc-cform textarea{resize:none;min-height:64px;line-height:1.5;}',
    '.sc-cform-note{font-family:"JetBrains Mono",monospace;font-size:.65rem;color:rgba(255,255,255,.3);letter-spacing:.02em;}',
    '.sc-cform-btn{background:#4DFFB4;color:#070707;border:none;border-radius:8px;padding:.6rem .875rem;font-family:Inter,sans-serif;font-size:.8rem;font-weight:700;cursor:pointer;transition:opacity .2s;text-align:left;}',
    '.sc-cform-btn:hover{opacity:.85;}',
    '.sc-cform-btn:disabled{opacity:.4;cursor:not-allowed;}',

    '.sc-quickreplies{display:flex;flex-direction:column;gap:.5rem;max-width:92%;align-self:flex-start;}',
    '.sc-qr-btn{background:#141414;border:1px solid rgba(77,255,180,.28);border-radius:10px;padding:.6rem .875rem;font-family:Inter,sans-serif;font-size:.8125rem;font-weight:600;color:#4DFFB4;cursor:pointer;text-align:left;transition:background .2s,border-color .2s;}',
    '.sc-qr-btn:hover{background:rgba(77,255,180,.08);border-color:rgba(77,255,180,.5);}',
    '.sc-qr-btn:disabled{opacity:.4;cursor:not-allowed;}',

    '#sc-foot{padding:.75rem .875rem;border-top:1px solid rgba(255,255,255,.06);background:#070707;display:flex;gap:.5rem;flex-shrink:0;align-items:flex-end;}',
    '#sc-input{flex:1;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:.6rem .875rem;font-family:Inter,sans-serif;font-size:.875rem;color:#fff;outline:none;resize:none;min-height:40px;max-height:110px;line-height:1.55;transition:border-color .2s;overflow-y:auto;}',
    '#sc-input:focus{border-color:rgba(77,255,180,.3);}',
    '#sc-input::placeholder{color:rgba(255,255,255,.2);}',
    '#sc-send{width:36px;height:36px;border-radius:8px;background:#4DFFB4;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .2s,transform .15s;}',
    '#sc-send:hover{opacity:.85;transform:scale(1.06);}',
    '#sc-send:disabled{opacity:.35;cursor:not-allowed;transform:none;}',


    '@media(max-width:480px){#sc-panel{right:10px;left:10px;width:auto;bottom:80px;}#sc-btn{right:14px;bottom:14px;}}'
  ].join('');

  /* ── ICONS ──────────────────────────────────────────────────── */
  var ICON_CHAT = '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true"><path d="M11 2C6.03 2 2 5.58 2 10c0 1.86.68 3.57 1.82 4.94L3 19l4.44-1.44C8.5 17.84 9.72 18 11 18c4.97 0 9-3.58 9-8s-4.03-8-9-8z" stroke="#4DFFB4" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><line x1="7" y1="10" x2="15" y2="10" stroke="#4DFFB4" stroke-width="1.3" stroke-linecap="round"/><line x1="7" y1="13.5" x2="12" y2="13.5" stroke="#4DFFB4" stroke-width="1.3" stroke-linecap="round"/></svg>';

  var ICON_X = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><line x1="4.5" y1="4.5" x2="13.5" y2="13.5" stroke="#4DFFB4" stroke-width="1.7" stroke-linecap="round"/><line x1="13.5" y1="4.5" x2="4.5" y2="13.5" stroke="#4DFFB4" stroke-width="1.7" stroke-linecap="round"/></svg>';

  var ICON_SEND = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 8H14M14 8L9 3M14 8L9 13" stroke="#070707" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var ICON_BOT = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="3" y="3" width="12" height="12" rx="2.5" stroke="#4DFFB4" stroke-width="1.3"/><rect x="6" y="6" width="6" height="6" rx="1" stroke="#4DFFB4" stroke-width="0.85" opacity="0.45"/><line x1="6.5" y1="3" x2="6.5" y2="1" stroke="#4DFFB4" stroke-width="1.3" stroke-linecap="round"/><line x1="9" y1="3" x2="9" y2="1" stroke="#4DFFB4" stroke-width="1.3" stroke-linecap="round"/><line x1="11.5" y1="3" x2="11.5" y2="1" stroke="#4DFFB4" stroke-width="1.3" stroke-linecap="round"/><line x1="6.5" y1="15" x2="6.5" y2="17" stroke="#4DFFB4" stroke-width="1.3" stroke-linecap="round"/><line x1="9" y1="15" x2="9" y2="17" stroke="#4DFFB4" stroke-width="1.3" stroke-linecap="round"/><line x1="11.5" y1="15" x2="11.5" y2="17" stroke="#4DFFB4" stroke-width="1.3" stroke-linecap="round"/></svg>';

  /* ── UTILS ──────────────────────────────────────────────────── */
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmt(text) {
    return esc(text)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/superceptron\.com\/register\.html/g, '<a href="register.html">superceptron.com/register.html</a>')
      .replace(/info@superceptron\.com/g, '<a href="mailto:info@superceptron.com">info@superceptron.com</a>')
      .replace(/\n/g, '<br>');
  }

  /* ── MAIN ───────────────────────────────────────────────────── */
  function boot() {
    // Inject styles
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    // Toggle button
    var btn = document.createElement('button');
    btn.id = 'sc-btn';
    btn.setAttribute('aria-label', 'Open chat');
    btn.innerHTML = ICON_CHAT;
    document.body.appendChild(btn);

    // Panel
    var panel = document.createElement('div');
    panel.id = 'sc-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Percy — Superceptron AI assistant');
    panel.innerHTML =
      '<div id="sc-head">' +
        '<div id="sc-avatar">' + ICON_BOT + '</div>' +
        '<div id="sc-head-info">' +
          '<span id="sc-head-name">Percy</span>' +
          '<span id="sc-head-status">Online &middot; Superceptron AI</span>' +
        '</div>' +
        '<button id="sc-close-btn" aria-label="Close chat">' +
          '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><line x1="3" y1="3" x2="11" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="11" y1="3" x2="3" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
        '</button>' +
      '</div>' +
      '<div id="sc-msgs"></div>' +
      '<div id="sc-foot">' +
        '<textarea id="sc-input" placeholder="Ask anything…" rows="1" aria-label="Chat message"></textarea>' +
        '<button id="sc-send" aria-label="Send">' + ICON_SEND + '</button>' +
      '</div>' +
      '';
    document.body.appendChild(panel);

    var msgsEl  = panel.querySelector('#sc-msgs');
    var inputEl = panel.querySelector('#sc-input');
    var sendEl  = panel.querySelector('#sc-send');
    var closeEl = panel.querySelector('#sc-close-btn');

    var history  = [];
    var isOpen   = false;
    var busy     = false;
    var welcomed = false;

    var pathname       = (window.location.pathname || '/').toLowerCase();
    var isRoutingPage  = ROUTING_PAGES.some(function (p) {
      return pathname === p || pathname.slice(-p.length) === p;
    });

    var routedFrom = null;
    try {
      routedFrom = sessionStorage.getItem(ROUTED_KEY);
      if (routedFrom) sessionStorage.removeItem(ROUTED_KEY);
    } catch (e) { /* storage unavailable — fall back to normal greeting */ }

    var routingResolved = !isRoutingPage || !!routedFrom;

    /* Open / close */
    function open() {
      isOpen = true;
      panel.classList.add('sc-open');
      btn.classList.add('sc-open');
      btn.setAttribute('aria-label', 'Close chat');
      btn.innerHTML = ICON_X;
      if (!welcomed) {
        welcomed = true;
        if (routedFrom && ROUTED_WELCOME[routedFrom]) {
          addBot(ROUTED_WELCOME[routedFrom]);
        } else if (isRoutingPage && !routingResolved) {
          addBot(ROUTING_GREETING);
          appendQuickReplies();
        } else {
          addBot(GREETING);
        }
      }
      setTimeout(function() { inputEl.focus(); }, 60);
    }

    function close() {
      isOpen = false;
      panel.classList.remove('sc-open');
      btn.classList.remove('sc-open');
      btn.setAttribute('aria-label', 'Open chat');
      btn.innerHTML = ICON_CHAT;
    }

    var DISMISSED_KEY = 'sc_dismissed';
    var dismissed = false;
    try { dismissed = sessionStorage.getItem(DISMISSED_KEY) === '1'; } catch (e) { /* storage unavailable */ }

    function userClose() {
      close();
      dismissed = true;
      try { sessionStorage.setItem(DISMISSED_KEY, '1'); } catch (e) { /* storage unavailable */ }
    }

    btn.addEventListener('click', function() { isOpen ? userClose() : open(); });
    closeEl.addEventListener('click', userClose);

    // Auto-open once the hero has been scrolled past, or on click, whichever first.
    // Never opens over the hero, and never reopens after the visitor closes it this session.
    if (!dismissed) {
      var heroEl = document.querySelector('.hero, .hub-hero, .pricing-hero, .about-page-hero, .blog-hero');
      if (heroEl && 'IntersectionObserver' in window) {
        var heroObserver = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting && !isOpen && !dismissed) {
              open();
              heroObserver.disconnect();
            }
          });
        }, { threshold: 0 });
        heroObserver.observe(heroEl);
      } else if (!heroEl) {
        // No hero on this page (e.g. portal, register) — nothing to cover, use the old fixed delay.
        setTimeout(function () { if (!isOpen && !dismissed) open(); }, 2500);
      }
    }

    /* Auto-resize textarea */
    inputEl.addEventListener('input', function() {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 110) + 'px';
    });

    inputEl.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    sendEl.addEventListener('click', send);

    /* Scroll to bottom */
    function scrollBot() {
      requestAnimationFrame(function() {
        msgsEl.scrollTop = msgsEl.scrollHeight;
      });
    }

    /* Append bot message */
    function addBot(text) {
      var triggerForm = text.indexOf('[CONTACT_FORM]') !== -1;
      text = text.replace('[CONTACT_FORM]', '').trim();

      var row = document.createElement('div');
      row.className = 'sc-row sc-bot';
      var bub = document.createElement('div');
      bub.className = 'sc-bubble';
      bub.innerHTML = fmt(text);
      row.appendChild(bub);
      msgsEl.appendChild(row);

      if (triggerForm) appendContactForm();
      scrollBot();
    }

    /* Append user message */
    function addUser(text) {
      var row = document.createElement('div');
      row.className = 'sc-row sc-user';
      var bub = document.createElement('div');
      bub.className = 'sc-bubble';
      bub.textContent = text;
      row.appendChild(bub);
      msgsEl.appendChild(row);
      scrollBot();
    }

    /* Typing indicator */
    function showTyping() {
      var row = document.createElement('div');
      row.className = 'sc-row sc-bot';
      row.id = 'sc-typing';
      row.innerHTML = '<div class="sc-typing"><span></span><span></span><span></span></div>';
      msgsEl.appendChild(row);
      scrollBot();
    }

    function hideTyping() {
      var el = document.getElementById('sc-typing');
      if (el) el.remove();
    }

    /* Inline contact form */
    function appendContactForm() {
      var form = document.createElement('div');
      form.className = 'sc-cform';
      form.innerHTML =
        '<input type="text" id="sc-cf-name" placeholder="Your name *" autocomplete="name">' +
        '<input type="email" id="sc-cf-email" placeholder="Work email *" autocomplete="email">' +
        '<textarea id="sc-cf-msg" rows="2" placeholder="Your message (optional)"></textarea>' +
        '<span class="sc-cform-note">Forwarded directly to Snehal &rarr; info@superceptron.com</span>' +
        '<button class="sc-cform-btn" id="sc-cf-sub">Send message &rarr;</button>';
      msgsEl.appendChild(form);
      scrollBot();

      form.querySelector('#sc-cf-sub').addEventListener('click', function() {
        submitContact(form);
      });
    }

    function submitContact(form) {
      var nameEl  = form.querySelector('#sc-cf-name');
      var emailEl = form.querySelector('#sc-cf-email');
      var msgEl   = form.querySelector('#sc-cf-msg');
      var subBtn  = form.querySelector('#sc-cf-sub');

      var name  = nameEl.value.trim();
      var email = emailEl.value.trim();
      var msg   = msgEl.value.trim();

      nameEl.style.borderColor  = name ? '' : 'rgba(255,80,80,.5)';
      emailEl.style.borderColor = email ? '' : 'rgba(255,80,80,.5)';
      if (!name || !email) return;

      subBtn.disabled = true;
      subBtn.textContent = 'Sending…';

      var fd = new FormData();
      fd.append('access_key', W3F_KEY);
      fd.append('subject',    'Chat enquiry – ' + name);
      fd.append('from_name',  'Superceptron Chat');
      fd.append('name',       name);
      fd.append('email',      email);
      fd.append('message',    msg || '(No additional message — enquiry via chat widget)');

      fetch('https://api.web3forms.com/submit', { method: 'POST', body: fd })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.success) {
            form.remove();
            addBot('Done — your message is on its way to Snehal. You’ll hear back at ' + email + ' within a few hours.');
          } else {
            throw new Error('w3f');
          }
        })
        .catch(function() {
          subBtn.disabled = false;
          subBtn.textContent = 'Send message →';
          addBot('Something went wrong with the form. Please email **info@superceptron.com** directly — Snehal will reply.');
        });
    }

    /* Recruiter specialization quick replies */
    function appendQuickReplies() {
      var wrap = document.createElement('div');
      wrap.className = 'sc-quickreplies';
      wrap.innerHTML =
        '<button class="sc-qr-btn" data-route="tech">Tech</button>' +
        '<button class="sc-qr-btn" data-route="engineering">Engineering &amp; Construction</button>';
      msgsEl.appendChild(wrap);
      scrollBot();

      var buttons = wrap.querySelectorAll('.sc-qr-btn');
      for (var i = 0; i < buttons.length; i++) {
        buttons[i].addEventListener('click', function (e) {
          for (var j = 0; j < buttons.length; j++) buttons[j].disabled = true;
          routeTo(e.currentTarget.getAttribute('data-route'));
        });
      }
    }

    function destForKind(kind) {
      return kind === 'tech' ? 'recruiter-tech.html' : 'recruiter-engineering.html';
    }

    function goToRoute(kind) {
      try { sessionStorage.setItem(ROUTED_KEY, kind); } catch (e) { /* storage unavailable — page still navigates, just re-asks there */ }
      setTimeout(function () { window.location.href = destForKind(kind); }, 500);
    }

    function routeTo(kind) {
      routingResolved = true;
      var label = kind === 'tech' ? 'Tech' : 'Engineering & Construction';
      addUser(label);
      addBot('Got it — taking you there now.');
      goToRoute(kind);
    }

    /* Matches free-text against the same keyword list as the quick replies.
       Returns 'tech' / 'engineering', or null if ambiguous/no match. */
    function matchRoute(text) {
      var lower = text.toLowerCase();
      var isTech = false, isEng = false, i;
      for (i = 0; i < TECH_KEYWORDS.length; i++) {
        if (lower.indexOf(TECH_KEYWORDS[i]) !== -1) { isTech = true; break; }
      }
      for (i = 0; i < ENGINEERING_KEYWORDS.length; i++) {
        if (lower.indexOf(ENGINEERING_KEYWORDS[i]) !== -1) { isEng = true; break; }
      }
      if (isTech && !isEng) return 'tech';
      if (isEng && !isTech) return 'engineering';
      return null;
    }

    /* Call the Worker */
    function send() {
      var text = inputEl.value.trim();
      if (!text || busy) return;

      if (isRoutingPage && !routingResolved) {
        inputEl.value = '';
        inputEl.style.height = 'auto';
        var kind = matchRoute(text);
        addUser(text);
        if (kind) {
          routingResolved = true;
          addBot('Got it — taking you there now.');
          goToRoute(kind);
        } else {
          addBot(ROUTING_GREETING);
          appendQuickReplies();
        }
        return;
      }

      busy = true;
      sendEl.disabled = true;
      inputEl.value = '';
      inputEl.style.height = 'auto';

      addUser(text);
      history.push({ role: 'user', content: text });
      showTyping();

      fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history })
      })
        .then(function(r) {
          if (!r.ok) throw new Error('http ' + r.status);
          return r.json();
        })
        .then(function(data) {
          hideTyping();
          var reply = data.text || "I’m not sure — try emailing info@superceptron.com.";
          addBot(reply);
          history.push({ role: 'assistant', content: reply.replace('[CONTACT_FORM]', '').trim() });
          if (history.length > 20) history = history.slice(-20);
        })
        .catch(function() {
          hideTyping();
          addBot("I’m having trouble connecting right now. Please email **info@superceptron.com** — Snehal will get back to you.");
        })
        .finally(function() {
          busy = false;
          sendEl.disabled = false;
          inputEl.focus();
        });
    }
  }

  /* Boot when DOM is ready */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();

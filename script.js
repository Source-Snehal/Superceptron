document.addEventListener('DOMContentLoaded', () => {

    // ── Brand word cycler ─────────────────────────
    const brandWord = document.getElementById('brandWord');
    const brandLogo = document.getElementById('brandLogo');
    if (brandWord) {
        const words  = ['Screen faster.', 'Source smarter.', 'Place more.', 'Cut admin.', 'Scale up.', 'Superceptron'];
        const pauses = [480, 400, 340, 280, 800]; // last pause longer — lets "Scale up." breathe before reveal
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (reduced) {
            brandWord.textContent = 'Superceptron';
        } else {
            function flipTo(text) {
                return new Promise(resolve => {
                    brandWord.style.transition = 'transform 0.2s cubic-bezier(0.4,0,1,1)';
                    brandWord.style.transform  = 'translateY(-115%)';
                    setTimeout(() => {
                        brandWord.style.transition = 'none';
                        brandWord.style.transform  = 'translateY(115%)';
                        brandWord.textContent = text;
                        brandWord.getBoundingClientRect();
                        brandWord.style.transition = 'transform 0.2s cubic-bezier(0,0,0.2,1)';
                        brandWord.style.transform  = 'translateY(0)';
                        setTimeout(resolve, 200);
                    }, 200);
                });
            }

            async function showSuperceptron() {
                // Phase 1 — word sequence ends: gentle fade+lift (not a flip)
                // This signals a phase change from the word cycle
                brandWord.style.transition = 'transform 0.5s cubic-bezier(0.3,0,0.7,1), opacity 0.4s ease-in';
                brandWord.style.transform  = 'translateY(-24px)';
                brandWord.style.opacity    = '0';
                await new Promise(r => setTimeout(r, 480));

                brandWord.style.transition = 'none';
                brandWord.style.opacity    = '0';
                brandWord.style.transform  = 'translateY(0)';

                // Phase 2 — logo materialises from centre (scale+fade, nothing like the word flips)
                if (brandLogo) {
                    brandLogo.style.transition = 'none';
                    brandLogo.style.transform  = 'translateX(-50%) translateY(-50%) scale(0.15)';
                    brandLogo.style.opacity    = '0';
                    brandLogo.getBoundingClientRect();
                    brandLogo.style.transition = 'transform 0.55s cubic-bezier(0,0,0.2,1), opacity 0.45s ease-out';
                    brandLogo.style.transform  = 'translateX(-50%) translateY(-50%) scale(1)';
                    brandLogo.style.opacity    = '1';
                    await new Promise(r => setTimeout(r, 620));

                    // Brief pause — logo sits fully visible before spinning
                    await new Promise(r => setTimeout(r, 180));

                    // Phase 3 — spin (ease-in-out so it builds speed then slows, feels physical)
                    brandLogo.style.transition = 'transform 0.85s cubic-bezier(0.4,0,0.6,1)';
                    brandLogo.style.transform  = 'translateX(-50%) translateY(-50%) scale(1) rotate(1080deg)';
                    await new Promise(r => setTimeout(r, 780));

                    // Phase 4 — expand outward and dissolve
                    brandLogo.style.transition = 'transform 0.45s cubic-bezier(0.2,0,0.6,1), opacity 0.38s ease-in';
                    brandLogo.style.transform  = 'translateX(-50%) translateY(-50%) scale(16) rotate(1080deg)';
                    brandLogo.style.opacity    = '0';
                }

                // Phase 5 — "Superceptron" expands in from centre
                await new Promise(r => setTimeout(r, 100));
                brandWord.style.transition    = 'none';
                brandWord.textContent         = 'Superceptron';
                brandWord.style.transform     = 'translateY(0) scale(0.5)';
                brandWord.style.letterSpacing = '0.06em';
                brandWord.getBoundingClientRect();

                brandWord.style.transition    = 'transform 0.6s cubic-bezier(0,0,0.2,1), opacity 0.45s ease-out, letter-spacing 0.6s ease-out';
                brandWord.style.transform     = 'translateY(0) scale(1)';
                brandWord.style.opacity       = '1';
                brandWord.style.letterSpacing = '-0.035em';
                await new Promise(r => setTimeout(r, 600));

                // Cleanup
                if (brandLogo) {
                    brandLogo.style.transition = 'none';
                    brandLogo.style.transform  = 'translateX(-50%) translateY(-50%) scale(0)';
                    brandLogo.style.opacity    = '0';
                }
            }

            (async () => {
                for (let i = 1; i < words.length - 1; i++) {
                    await new Promise(r => setTimeout(r, pauses[i - 1]));
                    await flipTo(words[i]);
                }
                await new Promise(r => setTimeout(r, pauses[pauses.length - 1]));
                await showSuperceptron();
            })();
        }
    }

    // ── Mobile nav toggle ─────────────────────────
    const navToggle = document.getElementById('navToggle');
    const navMobile = document.getElementById('navMobile');
    if (navToggle && navMobile) {
        navToggle.addEventListener('click', () => {
            const open = navMobile.classList.toggle('is-open');
            navToggle.classList.toggle('is-open', open);
            navToggle.setAttribute('aria-expanded', open);
            navMobile.setAttribute('aria-hidden', !open);
        });
        navMobile.querySelectorAll('.nav-mobile-link').forEach(link => {
            link.addEventListener('click', () => {
                navMobile.classList.remove('is-open');
                navToggle.classList.remove('is-open');
                navToggle.setAttribute('aria-expanded', 'false');
                navMobile.setAttribute('aria-hidden', 'true');
            });
        });
    }

    // ── Scroll reveal ──────────────────────────────
    const io = new IntersectionObserver(
        (entries) => {
            entries.forEach(e => {
                if (e.isIntersecting) {
                    e.target.classList.add('visible');
                    io.unobserve(e.target);
                }
            });
        },
        { threshold: 0.1, rootMargin: '0px 0px -36px 0px' }
    );
    document.querySelectorAll('.reveal').forEach(el => io.observe(el));

    // ── Nav opacity on scroll ──────────────────────
    const nav = document.querySelector('.nav');
    window.addEventListener('scroll', () => {
        nav.style.background = window.scrollY > 48
            ? 'rgba(7,7,7,0.96)'
            : 'rgba(7,7,7,0.75)';
    }, { passive: true });

    // ── Form handling ──────────────────────────────
    const form    = document.getElementById('interestForm');
    const success = document.getElementById('formSuccess');
    const btn     = document.getElementById('submitBtn');

    if (!form) return;

    function validate() {
        let ok = true;

        const fields = [
            { id: 'fname',    errId: 'fname-error' },
            { id: 'femail',   errId: 'femail-error' },
            { id: 'fmessage', errId: 'fmessage-error' },
        ];

        fields.forEach(({ id, errId }) => {
            const input = document.getElementById(id);
            const field = input.closest('.form-field');
            const valid = input.checkValidity();
            field.classList.toggle('has-error', !valid);
            input.classList.toggle('invalid', !valid);
            if (!valid) ok = false;
        });

        return ok;
    }

    // Clear error on input
    form.querySelectorAll('input, textarea').forEach(input => {
        input.addEventListener('input', () => {
            const field = input.closest('.form-field');
            if (input.checkValidity()) {
                field.classList.remove('has-error');
                input.classList.remove('invalid');
            }
        });
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!validate()) return;

        btn.disabled = true;
        btn.querySelector('.btn-text').textContent = 'Sending…';

        // Remove any previous submission error
        const prev = form.querySelector('.submit-error');
        if (prev) prev.remove();

        try {
            const res = await fetch('/api/contact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name:    document.getElementById('fname').value.trim(),
                    email:   document.getElementById('femail').value.trim(),
                    company: document.getElementById('fcompany').value.trim(),
                    message: document.getElementById('fmessage').value.trim(),
                }),
            });

            if (!res.ok) throw new Error('Request failed');

            form.style.display = 'none';
            success.classList.add('visible');
            success.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch {
            btn.disabled = false;
            btn.querySelector('.btn-text').textContent = 'Register My Interest';
            const err = document.createElement('p');
            err.className = 'submit-error';
            err.style.cssText = 'color:#ff7070;font-size:0.875rem;margin-top:0.75rem;';
            err.textContent = 'Something went wrong — please email us directly at info@superceptron.com.';
            form.appendChild(err);
        }
    });

});

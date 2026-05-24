document.addEventListener('DOMContentLoaded', () => {

    // ── Brand word cycler ─────────────────────────
    const brandWord = document.getElementById('brandWord');
    if (brandWord) {
        const words  = ['Screen faster.', 'Source smarter.', 'Place more.', 'Cut admin.', 'Scale up.', 'Superceptron'];
        const pauses = [480, 400, 340, 280, 230]; // ms to show each word before flipping
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (reduced) {
            brandWord.textContent = 'Superceptron';
        } else {
            function flipTo(text) {
                return new Promise(resolve => {
                    // Slide current word up and out
                    brandWord.style.transition = 'transform 0.2s cubic-bezier(0.4,0,1,1)';
                    brandWord.style.transform  = 'translateY(-115%)';
                    setTimeout(() => {
                        // Instantly reposition below, swap text
                        brandWord.style.transition = 'none';
                        brandWord.style.transform  = 'translateY(115%)';
                        brandWord.textContent = text;
                        brandWord.getBoundingClientRect(); // force reflow
                        // Slide new word up into place
                        brandWord.style.transition = 'transform 0.2s cubic-bezier(0,0,0.2,1)';
                        brandWord.style.transform  = 'translateY(0)';
                        setTimeout(resolve, 200);
                    }, 200);
                });
            }

            (async () => {
                for (let i = 1; i < words.length; i++) {
                    await new Promise(r => setTimeout(r, pauses[i - 1]));
                    await flipTo(words[i]);
                }
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

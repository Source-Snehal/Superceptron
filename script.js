// Modern JavaScript for Superceptron Website
document.addEventListener('DOMContentLoaded', function() {
    // Navigation functionality
    const navLinks = document.querySelectorAll('.nav-link');
    const sections = document.querySelectorAll('.section');
    const navbar = document.querySelector('.navbar');
    const navToggle = document.querySelector('.nav-toggle');
    const navLinksContainer = document.querySelector('.nav-links');

    // Section switching with smooth transitions
    function switchSection(targetSection) {
        // Remove active class from all sections and nav links
        sections.forEach(section => section.classList.remove('active'));
        navLinks.forEach(link => link.classList.remove('active'));

        // Add active class to target section and corresponding nav link
        const section = document.getElementById(targetSection);
        const navLink = document.querySelector(`[data-section="${targetSection}"]`);

        if (section && navLink) {
            section.classList.add('active');
            navLink.classList.add('active');
        }

        // Animate section entrance
        setTimeout(() => {
            section.style.opacity = '0';
            section.style.transform = 'translateY(20px)';
            setTimeout(() => {
                section.style.transition = 'all 0.6s ease';
                section.style.opacity = '1';
                section.style.transform = 'translateY(0)';
            }, 50);
        }, 100);
    }

    // Navigation link click handlers
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            const targetSection = this.getAttribute('data-section');
            // Only prevent default and switch sections if it's an internal section link
            if (targetSection) {
                e.preventDefault();
                switchSection(targetSection);
            }
            // For external links (products.html, careers.html, about.html), allow normal navigation
        });
    });

    // Mobile navigation toggle
    navToggle.addEventListener('click', function() {
        navLinksContainer.classList.toggle('mobile-open');
        this.classList.toggle('active');
    });

    // Navbar scroll effect
    let lastScrollY = window.scrollY;
    window.addEventListener('scroll', function() {
        if (window.scrollY > 50) {
            navbar.style.background = 'rgba(255, 255, 255, 0.98)';
            navbar.style.boxShadow = '0 2px 20px rgba(0, 0, 0, 0.1)';
        } else {
            navbar.style.background = 'rgba(255, 255, 255, 0.95)';
            navbar.style.boxShadow = 'none';
        }
        lastScrollY = window.scrollY;
    });

    // Smooth scrolling for internal links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Enhanced neural network animation
    function createParticleEffect() {
        const heroVisual = document.querySelector('.hero-visual');
        if (!heroVisual) return;

        // Create floating particles
        for (let i = 0; i < 20; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            particle.style.cssText = `
                position: absolute;
                width: 4px;
                height: 4px;
                background: linear-gradient(45deg, #10b981, #34d399);
                border-radius: 50%;
                opacity: 0;
                animation: floatParticle ${3 + Math.random() * 4}s ease-in-out infinite;
                animation-delay: ${Math.random() * 2}s;
                left: ${Math.random() * 100}%;
                top: ${Math.random() * 100}%;
            `;
            heroVisual.appendChild(particle);
        }

        // Add floating particle animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes floatParticle {
                0%, 100% {
                    opacity: 0;
                    transform: translateY(0px) scale(0);
                }
                50% {
                    opacity: 1;
                    transform: translateY(-20px) scale(1);
                }
            }
        `;
        document.head.appendChild(style);
    }

    // Initialize particle effect
    createParticleEffect();

    // Intersection Observer for scroll animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';

                // Special animations for different elements
                if (entry.target.classList.contains('product-card')) {
                    entry.target.style.animationDelay = `${Math.random() * 0.5}s`;
                    entry.target.style.animation = 'slideInUp 0.8s ease forwards';
                }
            }
        });
    }, observerOptions);

    // Observe elements for scroll animations
    document.querySelectorAll('.product-card, .position-card, .stat-item').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'all 0.8s ease';
        observer.observe(el);
    });

    // Add slide-in-up animation
    const slideUpStyle = document.createElement('style');
    slideUpStyle.textContent = `
        @keyframes slideInUp {
            from {
                opacity: 0;
                transform: translateY(30px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
    `;
    document.head.appendChild(slideUpStyle);

    // Contact form handling with modern UX
    const contactForm = document.getElementById('contactForm');
    if (contactForm) {
        const formInputs = contactForm.querySelectorAll('input, textarea');

        // Add floating label effect
        formInputs.forEach(input => {
            input.addEventListener('focus', function() {
                this.parentElement.classList.add('focused');
            });

            input.addEventListener('blur', function() {
                if (!this.value) {
                    this.parentElement.classList.remove('focused');
                }
            });

            // Check if input has value on page load
            if (input.value) {
                input.parentElement.classList.add('focused');
            }
        });

        // Form submission with loading state
        contactForm.addEventListener('submit', function(e) {
            e.preventDefault();

            const submitBtn = this.querySelector('button[type="submit"]');
            const originalText = submitBtn.querySelector('span').textContent;

            // Show loading state
            submitBtn.disabled = true;
            submitBtn.querySelector('span').textContent = 'Sending...';
            submitBtn.style.opacity = '0.7';

            // Simulate form submission (replace with actual form handling)
            setTimeout(() => {
                submitBtn.querySelector('span').textContent = 'Message Sent!';
                submitBtn.style.background = 'linear-gradient(135deg, #10b981, #059669)';

                setTimeout(() => {
                    submitBtn.disabled = false;
                    submitBtn.querySelector('span').textContent = originalText;
                    submitBtn.style.opacity = '1';
                    submitBtn.style.background = '';
                    this.reset();
                    formInputs.forEach(input => {
                        input.parentElement.classList.remove('focused');
                    });
                }, 2000);
            }, 1500);
        });
    }

    // Advanced button interactions
    document.querySelectorAll('.btn-primary, .btn-secondary').forEach(btn => {
        btn.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-2px) scale(1.02)';
        });

        btn.addEventListener('mouseleave', function() {
            this.style.transform = '';
        });

        btn.addEventListener('mousedown', function() {
            this.style.transform = 'translateY(0) scale(0.98)';
        });

        btn.addEventListener('mouseup', function() {
            this.style.transform = 'translateY(-2px) scale(1.02)';
        });
    });

    // Product card hover effects
    document.querySelectorAll('.product-card').forEach(card => {
        card.addEventListener('mouseenter', function() {
            // Create ripple effect
            const rect = this.getBoundingClientRect();
            const ripple = document.createElement('div');
            ripple.style.cssText = `
                position: absolute;
                border-radius: 50%;
                background: radial-gradient(circle, rgba(16, 185, 129, 0.1) 0%, transparent 70%);
                width: 100px;
                height: 100px;
                left: 50%;
                top: 50%;
                transform: translate(-50%, -50%) scale(0);
                animation: ripple 0.6s ease-out forwards;
                pointer-events: none;
                z-index: 1;
            `;
            this.appendChild(ripple);

            setTimeout(() => {
                ripple.remove();
            }, 600);
        });
    });

    // Add ripple animation
    const rippleStyle = document.createElement('style');
    rippleStyle.textContent = `
        @keyframes ripple {
            to {
                transform: translate(-50%, -50%) scale(3);
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(rippleStyle);

    // Typing animation for hero title
    function typeWriter(element, text, speed = 100) {
        let i = 0;
        element.textContent = '';

        function type() {
            if (i < text.length) {
                element.textContent += text.charAt(i);
                i++;
                setTimeout(type, speed);
            }
        }
        type();
    }

    // Initialize typing animation for gradient text
    setTimeout(() => {
        const gradientText = document.querySelector('.gradient-text');
        if (gradientText) {
            const originalText = gradientText.textContent;
            typeWriter(gradientText, originalText, 80);
        }
    }, 1000);

    // Parallax effect for hero section
    window.addEventListener('scroll', function() {
        const scrolled = window.pageYOffset;
        const heroSection = document.querySelector('.hero-section');
        const neuralNetwork = document.querySelector('.neural-network');

        if (heroSection && neuralNetwork) {
            const rate = scrolled * -0.5;
            neuralNetwork.style.transform = `translateY(${rate}px)`;
        }
    });

    // Dynamic gradient animation
    let gradientAngle = 0;
    setInterval(() => {
        gradientAngle = (gradientAngle + 1) % 360;
        const gradientElements = document.querySelectorAll('.gradient-text, .brand-text');
        gradientElements.forEach(el => {
            if (el.classList.contains('gradient-text') || el.classList.contains('brand-text')) {
                el.style.background = `linear-gradient(${gradientAngle}deg, #10b981 0%, #34d399 50%, #6ee7b7 100%)`;
                el.style.webkitBackgroundClip = 'text';
                el.style.webkitTextFillColor = 'transparent';
                el.style.backgroundClip = 'text';
            }
        });
    }, 100);

    // Smooth page transitions
    function smoothTransition() {
        document.body.style.opacity = '0';
        setTimeout(() => {
            document.body.style.transition = 'opacity 0.5s ease';
            document.body.style.opacity = '1';
        }, 100);
    }

    // Initialize smooth transition
    smoothTransition();

    // Add custom cursor effect for interactive elements
    const cursor = document.createElement('div');
    cursor.className = 'custom-cursor';
    cursor.style.cssText = `
        position: fixed;
        width: 20px;
        height: 20px;
        background: radial-gradient(circle, rgba(16, 185, 129, 0.6), transparent);
        border-radius: 50%;
        pointer-events: none;
        z-index: 9999;
        transition: transform 0.1s ease;
        display: none;
    `;
    document.body.appendChild(cursor);

    // Show custom cursor on interactive elements
    document.querySelectorAll('button, a, .product-card').forEach(el => {
        el.addEventListener('mouseenter', () => {
            cursor.style.display = 'block';
            cursor.style.transform = 'scale(2)';
        });

        el.addEventListener('mouseleave', () => {
            cursor.style.transform = 'scale(1)';
        });
    });

    // Update cursor position
    document.addEventListener('mousemove', (e) => {
        cursor.style.left = e.clientX - 10 + 'px';
        cursor.style.top = e.clientY - 10 + 'px';
    });

    // Performance optimization: Debounce scroll events
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Apply debouncing to scroll events
    window.addEventListener('scroll', debounce(function() {
        // Scroll-based animations here
    }, 10));

    console.log('🚀 Superceptron website loaded successfully!');
});
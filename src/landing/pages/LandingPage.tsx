import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  ArrowRight,
  Bike,
  Loader2,
  Menu,
  Moon,
  Route,
  Siren,
  Sun,
  Wrench,
  X,
} from 'lucide-react';
import { BrandLogo } from '../../components/BrandLogo';
import { useThemeStore } from '../../store/themeStore';
import { MiniWorld } from '../world/MiniWorld';
import { LandingFooter } from '../footer/LandingFooter';
import '../landing.css';

const rawGarageUrl = import.meta.env.VITE_GARAGE_PORTAL_URL || (import.meta.env.DEV ? 'http://localhost:5174' : 'https://guradge.voltlink.in');
const GARAGE_PORTAL_URL = (rawGarageUrl.startsWith('http://') || rawGarageUrl.startsWith('https://') ? rawGarageUrl : `https://${rawGarageUrl}`).replace(/\/$/, '');

gsap.registerPlugin(ScrollTrigger);

type Icon = typeof Siren;
type Part = string | { chip: string; icon: Icon };

/* ── Story beats: real Customer app screens (public/landing/app), described as the app actually behaves ── */
const BEATS: {
  id: string;
  kicker: string;
  parts: Part[];
  screen: string;
  alt: string;
  caption: string;
  ping?: React.CSSProperties;
}[] = [
  {
    id: 'sos',
    kicker: 'When the bike stops on the way to work –',
    parts: ['Press', { chip: 'SOS', icon: Siren }, 'and VoltLink alerts nearby garages with your location and phone number.'],
    screen: 'home',
    alt: 'VoltLink app home screen with the roadside SOS button',
    caption: 'Roadside SOS, one tap from the home screen.',
    // Where the SOS button sits in home.webp
    ping: { left: '79.2%', top: '6.8%', width: '15.1%', height: '4.8%' },
  },
  {
    id: 'report',
    kicker: 'When something just doesn’t sound right –',
    parts: ['Tell us', { chip: 'What’s wrong', icon: Wrench }, 'in your own words, and a garage picks it up from there.'],
    screen: 'report',
    alt: 'Report a problem screen in the VoltLink app',
    caption: 'Describe the problem; the garage takes it from there.',
  },
  {
    id: 'vehicle',
    kicker: 'Before the first booking –',
    parts: ['Add your', { chip: 'Bike', icon: Bike }, 'or scooter once. Every service after that already knows it.'],
    screen: 'addvehicle',
    alt: 'Add vehicle screen in the VoltLink app',
    caption: 'Your two-wheelers, saved to your account.',
  },
  {
    id: 'track',
    kicker: 'While it’s in the workshop –',
    parts: [
      'Follow every',
      { chip: 'Stage', icon: Route },
      'from pickup to delivery, and approve the estimate before any work begins.',
    ],
    screen: 'orders',
    alt: 'Orders screen tracking a repair in the VoltLink app',
    caption: 'Pickup and drop-off are confirmed with a handover code.',
  },
];

/* ── The garage side: each real portal screen (public/screenshots/{light,dark}/N.webp) beside what it does ── */
const FEATURES = [
  {
    n: 1,
    alt: 'VoltLink garage dashboard',
    label: 'Dashboard',
    title: 'The whole garage at a glance.',
    body: 'Pending requests, today’s tasks, active jobs and your fleet on a map, all on the first screen you open.',
  },
  {
    n: 2,
    alt: 'VoltLink service orders calendar',
    label: 'Service orders',
    title: 'Pickups and services, planned by the day.',
    body: 'Every service order sits on a calendar, so collections, drop-offs and bay time are scheduled before the day begins.',
  },
  {
    n: 5,
    alt: 'VoltLink kanban workshop board',
    label: 'Workshop',
    title: 'Run the workshop on one board.',
    body: 'Jobs move across the board, from received at the garage and under inspection to waiting for parts and in progress, so the whole team sees what comes next.',
  },
  {
    n: 3,
    alt: 'VoltLink billing and invoice ledger',
    label: 'Billing',
    title: 'Every invoice in one ledger.',
    body: 'Invoices are kept together with what has been paid and what is still pending, ready to open and share with the customer.',
  },
];

const NAV = [
  { href: '#how', label: 'How it works' },
  { href: '#garages', label: 'For garages' },
  { href: '#start', label: 'Get started' },
];

/** Words as separate inline blocks so they can enter one after another; spaces stay real text for wrapping. */
function Words({ text }: { text: string }): React.JSX.Element {
  const words = text.split(' ');
  return (
    <>
      {words.map((w, i) => (
        <React.Fragment key={i}>
          <span className="vl-word">{w}</span>
          {i < words.length - 1 ? ' ' : ''}
        </React.Fragment>
      ))}
    </>
  );
}

function Statement({ parts }: { parts: Part[] }): React.JSX.Element {
  return (
    <p className="vl-statement">
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {typeof p === 'string' ? (
            <Words text={p} />
          ) : (
            <span className="vl-chip">
              <p.icon aria-hidden="true" strokeWidth={2.2} />
              {p.chip}
            </span>
          )}
          {i < parts.length - 1 ? ' ' : ''}
        </React.Fragment>
      ))}
    </p>
  );
}

/** A phone with real app screens; a second screen sits on top for the hero to fade into, `ping` marks a control. */
function Phone({
  screens,
  alt,
  eager,
  ping,
  theme = 'dark',
}: {
  screens: string[];
  alt: string;
  eager?: boolean;
  ping?: React.CSSProperties;
  theme?: 'light' | 'dark';
}): React.JSX.Element {
  const mode = theme === 'light' ? 'light' : 'dark';
  return (
    <div className="vl-phone">
      <div className="vl-screen">
        {screens.map((screen, i) => (
          <img
            key={`${screen}-${mode}`}
            src={`/landing/app/${screen}-${mode}.webp`}
            alt={i === 0 ? alt : ''}
            width={540}
            height={1212}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            draggable={false}
            {...(eager && i === 0 ? { fetchPriority: 'high' as const } : {})}
          />
        ))}
        {ping && <span className="vl-ping" style={ping} aria-hidden="true" />}
      </div>
    </div>
  );
}

export function LandingPage(): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const isLight = theme === 'light';
  const toggleLabel = isLight ? 'Switch to dark mode' : 'Switch to light mode';
  const shotBase = isLight ? '/screenshots/light' : '/screenshots/dark';
  const year = new Date().getFullYear();

  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [isCheckingGarage, setIsCheckingGarage] = React.useState(false);
  const [underConstructionOpen, setUnderConstructionOpen] = React.useState(false);

  const handleGarageClick = async (e?: React.SyntheticEvent, path: string = '/login') => {
    if (e) e.preventDefault();
    setIsCheckingGarage(true);

    const targetUrl = `${GARAGE_PORTAL_URL}${path}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1800);
      await fetch(targetUrl, {
        method: 'GET',
        mode: 'no-cors',
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      setIsCheckingGarage(false);
      window.location.href = targetUrl;
    } catch {
      setIsCheckingGarage(false);
      setUnderConstructionOpen(true);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setUnderConstructionOpen(false);
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Header: a full-width bar at the top that settles into a floating pill once the page moves.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      root.toggleAttribute('data-compact', root.scrollTop > 60);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      root.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // The SOS ring pulses forever, and a box-shadow pulse repaints every frame: run it only while it can be seen
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const io = new IntersectionObserver((entries) => entries.forEach((e) => e.target.toggleAttribute('data-live', e.isIntersecting)));
    root.querySelectorAll('.vl-ping').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // Motion: entrances on load, scrubbed hero, beats that enter as they arrive, portal screens rising beside their copy.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const mm = gsap.matchMedia(root);
    const ctx = gsap.context(() => {
      const st = { scroller: root };

      // Load: the bar drops in, the headline rises word by word
      gsap.from('.vl-bar', { yPercent: -140, duration: 0.8, ease: 'expo.out', delay: 0.1 });
      gsap.from('.vl-hero-title .vl-word', {
        yPercent: 40,
        opacity: 0,
        duration: 0.9,
        ease: 'expo.out',
        stagger: 0.04,
        delay: 0.15,
      });

      // Hero: the phone rises through the pinned headline, which steps back (scale, fade).
      const phoneStart = () => {
        const h = window.innerHeight;
        if (h <= window.innerWidth * 1.1) return h * 0.62;
        const title = root.querySelector<HTMLElement>('.vl-hero-title');
        const phone = root.querySelector<HTMLElement>('.vl-hero-phone');
        if (!title || !phone) return h * 0.5;
        const below = title.offsetTop + title.offsetHeight + 48 + phone.offsetHeight / 2 - h / 2;
        return Math.max(h * 0.2, Math.min(h * 0.62, below));
      };
      const hero = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          ...st,
          trigger: '.vl-hero',
          start: 'top top',
          end: 'bottom bottom',
          scrub: 0.35,
          invalidateOnRefresh: true,
        },
      });
      hero
        .fromTo(
          '.vl-hero-phone',
          { xPercent: -50, yPercent: -50, y: phoneStart },
          { xPercent: -50, yPercent: -50, y: 0, duration: 1 },
          0
        )
        .to('.vl-hero-title', { scale: 0.92, opacity: 0.28, duration: 0.8 }, 0.1)
        .to('.vl-hero-corner', { opacity: 0, y: 12, duration: 0.25 }, 0)
        .to('.vl-hero-phone .vl-phone', { scale: 1.04, duration: 0.4 }, 0.6)
        // Signed in: the welcome screen gives way to home as the phone settles
        .to('.vl-hero-phone .vl-screen img:nth-child(2)', { opacity: 1, duration: 0.18 }, 0.72);

      // Beats: scene-setter, then the statement word by word, the chip pops, the phone rises into place
      gsap.utils.toArray<HTMLElement>('.vl-beat').forEach((beat) => {
        const tl = gsap.timeline({ scrollTrigger: { ...st, trigger: beat, start: 'top 75%', once: true } });
        tl.from(beat.querySelector('.vl-kicker'), { y: 14, opacity: 0, duration: 0.5, ease: 'sine.out' })
          .from(
            beat.querySelectorAll('.vl-statement .vl-word'),
            { y: 18, opacity: 0, duration: 0.7, ease: 'expo.out', stagger: 0.02 },
            0.1,
          )
          .from(beat.querySelector('.vl-chip'), { scale: 0.4, opacity: 0, duration: 0.5, ease: 'back.out(2)' }, 0.25)
          .from(beat.querySelector('.vl-phone'), { y: 60, opacity: 0, duration: 0.8, ease: 'expo.out' }, 0.2)
          .from(beat.querySelector('.vl-beat-caption'), { opacity: 0, duration: 0.5, ease: 'sine.out' }, 0.6);

        // Depth while it passes: the phone drifts a little slower than the page
        gsap.fromTo(
          beat.querySelector('.vl-beat-phone'),
          { y: 30 },
          { y: -30, ease: 'none', scrollTrigger: { ...st, trigger: beat, start: 'top bottom', end: 'bottom top', scrub: true } },
        );
      });

      // Headings outside the beats enter the same way
      gsap.utils.toArray<HTMLElement>('[data-reveal]').forEach((el) => {
        gsap
          .timeline({ scrollTrigger: { ...st, trigger: el, start: 'top 80%', once: true } })
          .from(el.querySelectorAll('.vl-word'), {
            y: 18,
            opacity: 0,
            duration: 0.7,
            ease: 'expo.out',
            stagger: 0.02,
          })
          .from(el.querySelectorAll('[data-fade]'), { y: 12, opacity: 0, duration: 0.5, ease: 'sine.out', stagger: 0.06 }, 0.2);
      });

      // Portal screens rise into place beside their copy
      gsap.utils.toArray<HTMLElement>('.vl-feature-shot').forEach((el) => {
        gsap.from(el, { y: 40, opacity: 0, duration: 0.8, ease: 'expo.out', scrollTrigger: { ...st, trigger: el, start: 'top 85%', once: true } });
      });

      // The model rises onto the page as its section arrives
      gsap.from('.vl-world-stage', {
        y: 60,
        opacity: 0,
        scale: 0.98,
        duration: 1.0,
        ease: 'expo.out',
        scrollTrigger: { ...st, trigger: '.vl-world-stage', start: 'top 85%', once: true },
      });

    }, root);

    const refresh = () => ScrollTrigger.refresh();
    document.fonts?.ready?.then(refresh);
    requestAnimationFrame(refresh);

    return () => {
      mm.revert();
      ctx.revert();
    };
  }, []);

  const scrollTo = (id: string) => (e: React.MouseEvent) => {
    const root = rootRef.current;
    const target = id === 'top' ? null : root?.querySelector<HTMLElement>(id);
    if (!root) return;
    e.preventDefault();
    root.scrollTo({ top: target ? target.offsetTop - 24 : 0 });
  };

  const themeButton = (
    <button
      type="button"
      className="vl-icon-btn cursor-target"
      aria-label={toggleLabel}
      title={toggleLabel}
      aria-pressed={!isLight}
      onClick={toggleTheme}
    >
      {isLight ? <Moon size={16} strokeWidth={1.9} /> : <Sun size={16} strokeWidth={1.9} />}
    </button>
  );

  return (
    <div ref={rootRef} data-theme={theme} data-opaque-page="" className="vl-landing">
      <header className="vl-header">
        <nav className="vl-bar" aria-label="Primary">
          <a href="#top" className="vl-brand cursor-target" onClick={scrollTo('top')}>
            <BrandLogo />
            <span>voltlink</span>
          </a>
          <ul className="vl-links">
            {NAV.map((n) => (
              <li key={n.href}>
                <a href={n.href} className="cursor-target" onClick={scrollTo(n.href)}>
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="vl-actions">
            <a
              href={`${GARAGE_PORTAL_URL}/login`}
              className="vl-login cursor-target"
              onClick={(e) => handleGarageClick(e, '/login')}
            >
              Garage login
            </a>
            <a
              href={`${GARAGE_PORTAL_URL}/contact-admin`}
              className="vl-pill cursor-target"
              onClick={(e) => handleGarageClick(e, '/contact-admin')}
            >
              {isCheckingGarage ? <Loader2 size={15} className="animate-spin" /> : 'Get a garage account'}
            </a>
          </div>

          <div className="vl-mobile-actions">
            <button
              type="button"
              className="vl-mobile-toggle cursor-target"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X size={22} strokeWidth={2.2} /> : <Menu size={22} strokeWidth={2.2} />}
            </button>
          </div>
        </nav>

        {mobileMenuOpen && (
          <div className="vl-mobile-dropdown">
            <ul className="vl-mobile-links">
              {NAV.map((n) => (
                <li key={n.href}>
                  <a
                    href={n.href}
                    className="cursor-target"
                    onClick={(e) => {
                      setMobileMenuOpen(false);
                      scrollTo(n.href)(e);
                    }}
                  >
                    <span>{n.label}</span>
                    <ArrowRight size={14} opacity={0.6} />
                  </a>
                </li>
              ))}
            </ul>
            <div className="vl-mobile-divider" />
            <div className="vl-mobile-portal-group">
              <button
                type="button"
                className="vl-mobile-portal-btn cursor-target"
                onClick={(e) => {
                  setMobileMenuOpen(false);
                  handleGarageClick(e, '/login');
                }}
              >
                Garage login
              </button>
              <button
                type="button"
                className="vl-pill vl-pill--full cursor-target"
                onClick={(e) => {
                  setMobileMenuOpen(false);
                  handleGarageClick(e, '/contact-admin');
                }}
              >
                Get a garage account
              </button>
            </div>
            <div className="vl-mobile-divider" />
            <button
              type="button"
              className="vl-mobile-theme-btn cursor-target"
              onClick={() => toggleTheme()}
            >
              {isLight ? <Moon size={16} /> : <Sun size={16} />}
              <span>{isLight ? 'Switch to dark theme' : 'Switch to light theme'}</span>
            </button>
          </div>
        )}
      </header>

      <main>
        {/* Hero: the headline holds still while the app rises through it */}
        <section className="vl-hero" aria-labelledby="vl-hero-title">
          <div className="vl-hero-stage">
            <h1 id="vl-hero-title" className="vl-hero-title">
              <span className="vl-line">
                <Words text="The new companion" />
              </span>{' '}
              <span className="vl-line">
                <Words text="to your two-wheeler." />
              </span>
            </h1>
            <div className="vl-hero-phone">
              <Phone screens={['auth', 'home']} alt="VoltLink Customer app sign-in screen" eager theme={theme} />
            </div>
            <div className="vl-hero-corner vl-hero-corner--l">
              {themeButton}
              <span className="vl-hero-note">Roadside help, servicing and repairs.</span>
            </div>
            <div className="vl-hero-corner vl-hero-corner--r">
              <a href="#how" className="vl-hero-tag cursor-target" onClick={scrollTo('#how')}>
                <i>
                  <ArrowRight size={13} strokeWidth={2.4} style={{ transform: 'rotate(90deg)' }} />
                </i>
                How it works
              </a>
            </div>
          </div>
        </section>

        {/* Story: one moment at a time, each acted out on the real app */}
        <section id="how" className="vl-story" aria-label="How VoltLink works">
          {BEATS.map((b) => (
            <article key={b.id} className="vl-beat">
              <p className="vl-kicker">{b.kicker}</p>
              <Statement parts={b.parts} />
              <div className="vl-beat-phone">
                <Phone screens={[b.screen]} alt={b.alt} ping={b.ping} theme={theme} />
              </div>
              <p className="vl-beat-caption">{b.caption}</p>
            </article>
          ))}
        </section>

        {/* The other side: technicians and the garage portal, around the workshop itself */}
        <section id="garages" className="vl-sync" aria-labelledby="vl-sync-title">
          <div data-reveal>
            <span className="vl-sync-mark" data-fade aria-hidden="true">
              <Wrench size={18} strokeWidth={1.8} />
            </span>
            <h2 id="vl-sync-title" className="vl-h2">
              <Words text="One service, three apps." />
            </h2>
            <p className="vl-lede" data-fade>
              Riders use the Customer app. Technicians collect and return the vehicle with their own app. The garage
              runs orders, quotations, the workshop board and billing from the portal.
            </p>
          </div>

          <div className="vl-features">
            {FEATURES.map((f, i) => (
              <article key={f.n} className="vl-feature" data-flip={i % 2 ? '' : undefined}>
                <div className="vl-feature-copy" data-reveal>
                  <p className="vl-feature-label" data-fade>
                    {f.label}
                  </p>
                  <h3 className="vl-h3">
                    <Words text={f.title} />
                  </h3>
                  <p className="vl-feature-body" data-fade>
                    {f.body}
                  </p>
                </div>
                <figure className="vl-feature-shot">
                  <img
                    src={`${shotBase}/${f.n}.webp`}
                    alt={f.alt}
                    width={1200}
                    height={750}
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                  />
                </figure>
              </article>
            ))}
          </div>
        </section>

        {/* Call to action */}
        <section id="start" className="vl-cta" aria-labelledby="vl-cta-title">
          <div data-reveal>
            <p className="vl-kicker" data-fade>
              Run a two-wheeler garage?
            </p>
            <h2 id="vl-cta-title" className="vl-h2">
              <Words text="Bring your workshop onto VoltLink." />
            </h2>
            <div className="vl-cta-row">
              <a
                href={`${GARAGE_PORTAL_URL}/login`}
                className="vl-pill vl-pill--lg cursor-target"
                data-fade
                onClick={(e) => handleGarageClick(e, '/login')}
              >
                Garage owner login
                <ArrowRight size={16} strokeWidth={2.2} />
              </a>
              <a
                href={`${GARAGE_PORTAL_URL}/contact-admin`}
                className="vl-pill vl-pill--ghost vl-pill--lg cursor-target"
                data-fade
                onClick={(e) => handleGarageClick(e, '/contact-admin')}
              >
                Contact admin for an account
              </a>
            </div>
          </div>
        </section>

        {/* The whole service in miniature, as the last thing before the footer */}
        <section id="world" className="vl-world" aria-labelledby="vl-world-title">
          <div className="vl-world-intro" data-reveal>
            <p className="vl-kicker" data-fade>
              Look a little closer –
            </p>
            <h2 id="vl-world-title" className="vl-h2">
              <Words text="All of VoltLink, in miniature." />
            </h2>
            <p className="vl-lede" data-fade>
              A rider breaks down on the side road and the pickup truck sets off. Three bays are busy, reception is
              open, and the next scooter is being handed over out front.
            </p>
          </div>
          <MiniWorld />
          <p className="vl-world-note" aria-hidden="true">
            <span className="vl-fine">Move your pointer to look around, and click a bay, the truck or a scooter</span>
            <span className="vl-touch">Tap a bay, the truck or a scooter</span>
          </p>
        </section>
      </main>

      <LandingFooter
        rootRef={rootRef}
        nav={NAV}
        scrollTo={scrollTo}
        isLight={isLight}
        onToggleTheme={toggleTheme}
        year={year}
        onGarageAction={handleGarageClick}
      />

      {underConstructionOpen && (
        <div
          className="vl-modal-backdrop"
          onClick={() => setUnderConstructionOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="vl-modal-title"
        >
          <div
            className="vl-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="vl-modal-close"
              onClick={() => setUnderConstructionOpen(false)}
              aria-label="Close dialog"
            >
              <X size={18} />
            </button>

            <div className="vl-modal-icon-wrap">
              <Wrench size={26} strokeWidth={2} />
            </div>

            <span className="vl-modal-badge">Workshop Portal</span>

            <h3 id="vl-modal-title" className="vl-modal-title">
              Portal Under Construction
            </h3>

            <p className="vl-modal-body">
              The VoltLink Garage & Partner Workshop Portal (<code>guradge.voltlink.in</code>) is currently undergoing scheduled infrastructure updates and onboarding configuration.
            </p>

            <div className="vl-modal-info-box">
              <div className="vl-modal-info-row">
                <span className="vl-modal-info-label">Service</span>
                <span className="vl-modal-info-val">Garage Operations System</span>
              </div>
              <div className="vl-modal-info-row">
                <span className="vl-modal-info-label">Status</span>
                <span className="vl-modal-info-val vl-modal-status-pill">Under Construction</span>
              </div>
            </div>

            <button
              type="button"
              className="vl-pill vl-pill--full cursor-target"
              onClick={() => setUnderConstructionOpen(false)}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

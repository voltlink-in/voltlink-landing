import React, { useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ArrowUp, Route, Siren, Warehouse, Wrench } from 'lucide-react';
import { FooterScooter } from './FooterScooter';
import './footer.css';

const rawGarageUrl = import.meta.env.VITE_GARAGE_PORTAL_URL || (import.meta.env.DEV ? 'http://localhost:5174' : 'https://guradge.voltlink.in');
const GARAGE_PORTAL_URL = (rawGarageUrl.startsWith('http://') || rawGarageUrl.startsWith('https://') ? rawGarageUrl : `https://${rawGarageUrl}`).replace(/\/$/, '');

/* What VoltLink does, in the words the rest of the page already uses */
const SERVICES = [
  { icon: Siren, title: ['Roadside', 'support'], body: 'Press SOS and nearby garages get your location and phone number.' },
  { icon: Route, title: ['Pickup &', 'drop-off'], body: 'A garage collects the bike and brings it back, with a handover code at each end.' },
  { icon: Wrench, title: ['Servicing &', 'repairs'], body: 'Say what’s wrong in your own words, and approve the estimate before any work begins.' },
  { icon: Warehouse, title: ['Garage', 'assistance'], body: 'Partner garages run service orders, the workshop board and billing on VoltLink.' },
];

interface Props {
  rootRef: React.RefObject<HTMLDivElement | null>;
  nav: { href: string; label: string }[];
  scrollTo: (id: string) => (e: React.MouseEvent) => void;
  isLight: boolean;
  onToggleTheme: () => void;
  year: number;
}

/**
 * The last chapter: one scooter parked on the dark slab the footer is built on, the giant wordmark behind it, what
 * VoltLink does along the slab's top, then the links.
 */
export function LandingFooter({ rootRef, nav, scrollTo, isLight, onToggleTheme, year }: Props): React.JSX.Element {
  const footRef = useRef<HTMLElement>(null);
  const speedRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const foot = footRef.current;
    if (!root || !foot || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = gsap.context(() => {
      // refresh after the page's pinned sections above, so positions include their spacing
      const st = { scroller: root, refreshPriority: -1 };
      gsap.fromTo(
        '.vl-ft-ghost',
        { xPercent: 7 },
        { xPercent: -7, ease: 'none', scrollTrigger: { ...st, trigger: foot, start: 'top bottom', end: 'bottom bottom', scrub: 0.35 } },
      );
      gsap.from('.vl-ft-service', {
        y: 40,
        opacity: 0,
        duration: 1,
        ease: 'expo.out',
        stagger: 0.08,
        scrollTrigger: { ...st, trigger: '.vl-ft-services', start: 'top 92%', once: true },
      });
      gsap.from('.vl-ft-cta, .vl-ft-main > *, .vl-ft-legal', {
        y: 30,
        opacity: 0,
        duration: 1,
        ease: 'expo.out',
        stagger: 0.08,
        scrollTrigger: { ...st, trigger: '.vl-ft-cta', start: 'top 95%', once: true },
      });
    }, foot);
    return () => ctx.revert();
  }, [rootRef]);

  return (
    <footer ref={footRef} className="vl-ft" aria-labelledby="vl-ft-title">
      <div className="vl-ft-ride">
        <div className="vl-ft-stage">
          <div className="vl-ft-clip" aria-hidden="true">
            <p className="vl-ft-ghost">voltlink</p>
          </div>
          <p className="vl-ft-speed" aria-hidden="true">
            <span ref={speedRef}>0</span> km/h
          </p>
          <div className="vl-ft-ground" aria-hidden="true" />
          <FooterScooter speedRef={speedRef} rootRef={rootRef} />
        </div>
      </div>

      <div className="vl-ft-slab">
        <ul className="vl-ft-services">
          {SERVICES.map(({ icon: Icon, title, body }) => (
            <li key={title.join(' ')} className="vl-ft-service">
              <Icon size={26} strokeWidth={1.5} aria-hidden="true" />
              <h3>
                {title[0]} <br />
                {title[1]}
              </h3>
              <p>{body}</p>
            </li>
          ))}
        </ul>

        <a href="#how" className="vl-ft-cta cursor-target" onClick={scrollTo('#how')}>
          See how it works
          <ArrowUp size={14} strokeWidth={2} aria-hidden="true" />
        </a>

        <div className="vl-ft-main">
          <h2 id="vl-ft-title" className="vl-ft-statement">
            Your ride. Our pickup. <span>Garage care.</span>
          </h2>
          <nav className="vl-ft-cols" aria-label="Footer">
            <div>
              <h3>Product</h3>
              <ul>
                {nav.map((n) => (
                  <li key={n.href}>
                    <a href={n.href} className="cursor-target" onClick={scrollTo(n.href)}>
                      {n.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Garages</h3>
              <ul>
                <li>
                  <a href={`${GARAGE_PORTAL_URL}/login`} className="cursor-target">
                    Garage owner login
                  </a>
                </li>
                <li>
                  <a href={`${GARAGE_PORTAL_URL}/contact-admin`} className="cursor-target">
                    Contact admin
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h3>Display</h3>
              <ul>
                <li>
                  <button type="button" className="cursor-target" onClick={onToggleTheme} aria-pressed={!isLight}>
                    {isLight ? 'Dark mode' : 'Light mode'}
                  </button>
                </li>
              </ul>
            </div>
          </nav>
        </div>

        <div className="vl-ft-legal">
          <span className="vl-ft-brand">
            <img src="/brand/voltlink-mark.webp" alt="" width={320} height={336} decoding="async" draggable={false} />
            <b>voltlink</b>
          </span>
          <span>© {year} VoltLink</span>
          <span className="vl-ft-tag">Roadside help, servicing and repairs.</span>
        </div>
      </div>
    </footer>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useThemeStore } from '../../store/themeStore';
import type { Frame, Pose, ScooterStage } from './scooter';

gsap.registerPlugin(ScrollTrigger);

const ARRIVING: Pose = { travel: 0, turn: 0, stand: 0, steer: 0, dip: 0, light: 1 };
const PARKED: Pose = { travel: 1, turn: 1, stand: 1, steer: 1, dip: 0, light: 0 };
const TOP_SPEED = 18; // km/h at the middle of the ride

/** Where the slab starts and how big the scooter is, read from the stage's CSS so layout stays in the stylesheet. */
function readFrame(el: HTMLElement): Frame {
  const css = getComputedStyle(el);
  const num = (name: string, fallback: number) => parseFloat(css.getPropertyValue(name)) || fallback;
  return { horizon: num('--ft-horizon', 0.8), span: num('--ft-span', 0.46), centre: num('--ft-centre', 0.5) };
}
const slabColour = (el: HTMLElement) => getComputedStyle(el).getPropertyValue('--ft-slab').trim() || '#111114';

/**
 * The scooter, ridden by the scroll. One scrubbed timeline, pinned to the footer's scroll range, owns the whole
 * ride — position, wheels, the turn in, side stand, bars, headlight and the km/h readout — so scrolling down rides
 * it in and parks it, scrolling up reverses every step, and stopping holds the frame. Three.js arrives a screen ahead.
 * Reduced motion shows it parked; without WebGL a still picture of it stands on the slab.
 */
export function FooterScooter({
  speedRef,
  rootRef,
}: {
  speedRef: React.RefObject<HTMLSpanElement | null>;
  rootRef: React.RefObject<HTMLDivElement | null>;
}): React.JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<ScooterStage | null>(null);
  const theme = useThemeStore((s) => s.theme);
  const darkRef = useRef(theme === 'dark');
  const [state, setState] = useState<'waiting' | 'live' | 'fallback'>('waiting');

  useEffect(() => {
    darkRef.current = theme === 'dark';
    const stage = stageRef.current;
    // the slab colour comes from the theme's CSS, read after it has applied
    if (stage) requestAnimationFrame(() => sceneRef.current?.setTheme(darkRef.current, slabColour(stage)));
  }, [theme]);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const query = window.location.search;
    // Dev only: ?still previews reduced motion, ?nogl the fallback
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches || (import.meta.env.DEV && query.includes('still'));
    const noGl = import.meta.env.DEV && query.includes('nogl');
    const fine = window.matchMedia('(pointer: fine)').matches;

    let disposed = false;
    let loading = false;
    let onScreen = false;
    let fallback = false;
    let scene: ScooterStage | null = null;

    /* The ride: one timeline (duration 1) scrubbed by scroll. Travel eases in and out, so the speed rises and falls
       in a straight line to and from its peak, exactly the slope of that ease. */
    const pose = { ...(still ? PARKED : ARRIVING), speed: 0 };
    let shownSpeed = -1;
    const push = () => {
      scene?.setPose(pose);
      const kmh = fallback ? 0 : Math.round(pose.speed);
      if (kmh !== shownSpeed && speedRef.current) speedRef.current.textContent = String((shownSpeed = kmh));
    };
    const scroller = rootRef.current;
    const held = stage.closest<HTMLElement>('.vl-ft-stage');
    const ride = stage.closest<HTMLElement>('.vl-ft-ride');
    const ctx = gsap.context(() => {
      if (still || !scroller || !held || !ride) return;
      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        onUpdate: push,
        scrollTrigger: {
          // from the stage rising into view to the end of its held stretch, where the footer scrolls on
          trigger: ride,
          scroller,
          start: 'top 80%',
          end: () => `bottom top+=${parseFloat(getComputedStyle(held).top) + held.offsetHeight}`,
          invalidateOnRefresh: true,
          scrub: 0.35,
          // measured after the page's pinned sections above, so the range includes their spacing
          refreshPriority: -1,
        },
      });
      tl.to(pose, { travel: 1, duration: 0.76, ease: 'power2.inOut' }, 0)
        .to(pose, { speed: TOP_SPEED, duration: 0.38 }, 0)
        .to(pose, { speed: 0, duration: 0.38 }, 0.38)
        .to(pose, { turn: 1, duration: 0.24, ease: 'sine.inOut' }, 0.54)
        .to(pose, { dip: 1, duration: 0.05, ease: 'power2.out' }, 0.74)
        .to(pose, { dip: 0, duration: 0.08, ease: 'sine.inOut' }, 0.79)
        .to(pose, { stand: 1, duration: 0.1, ease: 'power2.inOut' }, 0.78)
        .to(pose, { steer: 1, duration: 0.12, ease: 'power2.inOut' }, 0.85)
        .to(pose, { light: 0, duration: 0.08 }, 0.88)
        .to({}, { duration: 0.03 }, 0.97);
      if (import.meta.env.DEV) (window as unknown as { __ride?: gsap.core.Timeline }).__ride = tl;
    }, stage);
    push();

    const wake = () => {
      if (!scene) return;
      if (onScreen) scene.start();
      else scene.stop();
    };

    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const mod = await import('./scooter');
        if (disposed) return;
        if (noGl) throw new Error('nogl');
        const made = await mod.createScooterStage(canvas, { dark: darkRef.current, slab: slabColour(stage), pose });
        if (disposed) {
          made?.dispose();
          return;
        }
        if (!made) throw new Error('webgl');
        scene = made;
        sceneRef.current = scene;
        // its first frame in a task of its own
        await new Promise<void>((r) => setTimeout(r, 0));
        if (disposed) return;
        scene.resize(stage.clientWidth, stage.clientHeight, readFrame(stage));
        if (import.meta.env.DEV) (window as unknown as { __scooter?: ScooterStage }).__scooter = scene;
        setState('live');
        wake();
      } catch (e) {
        if (import.meta.env.DEV && (e as Error).message !== 'nogl') console.warn('[scooter]', e);
        if (!disposed) {
          fallback = true;
          push();
          setState('fallback');
          // the held stretch collapses without a scooter to ride, so the page's scroll positions move
          requestAnimationFrame(() => ScrollTrigger.refresh());
        }
      }
    };

    // Parse the stage's code while the browser is idle after load; building it still waits until the footer is near
    const idle = 'requestIdleCallback' in window;
    const prefetch = idle ? window.requestIdleCallback(() => void import('./scooter'), { timeout: 6000 }) : window.setTimeout(() => void import('./scooter'), 3000);

    const near = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void load(), { rootMargin: '900px 0px' });
    near.observe(stage);
    // Draw only while the stage is on screen
    const seen = new IntersectionObserver(
      ([e]) => {
        onScreen = e.isIntersecting;
        wake();
      },
      { threshold: 0 },
    );
    seen.observe(stage);
    const onVisibility = () => {
      if (document.hidden) scene?.stop();
      else wake();
    };
    document.addEventListener('visibilitychange', onVisibility);

    let resizeTimer = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => scene?.resize(stage.clientWidth, stage.clientHeight, readFrame(stage)), 100);
    });
    ro.observe(stage);

    const onMove = (e: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      scene?.setPointer(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
    };
    const onLeave = () => scene?.setPointer(0, 0);
    if (fine && !still) {
      stage.addEventListener('pointermove', onMove);
      stage.addEventListener('pointerleave', onLeave);
    }

    return () => {
      disposed = true;
      ctx.revert();
      near.disconnect();
      seen.disconnect();
      ro.disconnect();
      window.clearTimeout(resizeTimer);
      if (idle) window.cancelIdleCallback(prefetch);
      else window.clearTimeout(prefetch);
      document.removeEventListener('visibilitychange', onVisibility);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerleave', onLeave);
      scene?.dispose();
      sceneRef.current = null;
    };
  }, [speedRef, rootRef]);

  return (
    <div ref={stageRef} className="vl-ft-scooter" data-state={state}>
      {state === 'fallback' && (
        <img className="vl-ft-poster" src={`/landing/footer/scooter-${theme}.webp`} alt="" width={1600} height={800} decoding="async" draggable={false} />
      )}
      <canvas
        ref={canvasRef}
        className="vl-ft-canvas"
        role="img"
        aria-label="A VoltLink scooter in indigo paint, parked on its side stand with the front wheel turned out and the VoltLink emblem on its side panel."
      />
    </div>
  );
}

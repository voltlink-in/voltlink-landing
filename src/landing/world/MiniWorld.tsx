import React, { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { X } from 'lucide-react';
import { useThemeStore } from '../../store/themeStore';
import type { MiniWorld as World, ShownSpot, Tier } from './scene';
import { SPOTS, SPOT_ORDER, spotText, type SpotId } from './spots';

gsap.registerPlugin(ScrollTrigger);

/**
 * The miniature VoltLink world. Three.js and the scene are only fetched when the section comes near, the loop only
 * runs while it is on screen, and a still image stands in until the first frame (and wherever WebGL is missing).
 * The camera follows the section's scroll and leans toward the pointer; bays, the forecourt, the truck, the
 * roadside call and the scooters answer a hover or a tap with a small label and a moment of their story.
 * Reduced motion gets still frames: the labels still answer, nothing moves.
 */
export function MiniWorld(): React.JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<World | null>(null);
  const theme = useThemeStore((s) => s.theme);
  const darkRef = useRef(theme === 'dark');
  const [state, setState] = useState<'waiting' | 'live' | 'fallback'>('waiting');
  const [shown, setShown] = useState<ShownSpot | null>(null);
  // the last spot shown, so the label keeps its words while it fades out
  const [held, setHeld] = useState<ShownSpot | null>(null);

  useEffect(() => {
    darkRef.current = theme === 'dark';
    worldRef.current?.setTheme(darkRef.current);
  }, [theme]);

  useEffect(() => {
    const frame = frameRef.current;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!frame || !stage || !canvas) return;
    const query = window.location.search;
    // Dev only: ?still previews reduced motion, ?nogl the fallback, without changing OS settings
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches || (import.meta.env.DEV && query.includes('still'));
    const noGl = import.meta.env.DEV && query.includes('nogl');
    const fine = window.matchMedia('(pointer: fine)').matches;
    const tier: Tier = fine && window.innerWidth >= 1024 && (navigator.hardwareConcurrency ?? 4) >= 4 ? 'high' : 'low';

    let disposed = false;
    let loading = false;
    let onScreen = false;
    let world: World | null = null;
    let progress = 0;

    const onSpot = (s: ShownSpot | null) => {
      setShown(s);
      if (s) setHeld(s);
    };

    const wake = () => {
      if (!world) return;
      if (onScreen) world.start();
      else {
        world.stop();
        world.select(null);
      }
    };

    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const mod = await import('./scene');
        if (disposed) return;
        if (noGl) throw new Error('nogl');
        // built in short steps, so the page keeps scrolling while it comes together
        const made = await mod.createMiniWorld(canvas, { dark: darkRef.current, still, tier, tip: tipRef.current, onSpot, cancelled: () => disposed });
        if (disposed) {
          made?.dispose();
          return;
        }
        if (!made) throw new Error('webgl');
        world = made;
        worldRef.current = world;
        // the first frames in separate tasks: a 1×1 one that uploads textures and buffers, then the full-size one
        const next = () => new Promise<void>((r) => setTimeout(r, 0));
        world.setScroll(progress);
        await next();
        if (disposed) return;
        world.resize(stage.clientWidth, stage.clientHeight);
        if (import.meta.env.DEV) (window as unknown as { __miniworld?: World }).__miniworld = world;
        setState('live');
        wake();
      } catch (e) {
        if (import.meta.env.DEV && (e as Error).message !== 'nogl') console.warn('[miniworld]', e);
        if (!disposed) setState('fallback');
      }
    };

    // Parse the scene's code (three.js among it) while the browser is idle after the page has loaded, so arriving
    // at the section later costs no download or parse; building it still waits until the section is near
    const idle = 'requestIdleCallback' in window;
    const prefetch = idle ? window.requestIdleCallback(() => void import('./scene'), { timeout: 6000 }) : window.setTimeout(() => void import('./scene'), 3000);

    // Fetch the scene a screen or so ahead; run it only while it is actually visible
    const near = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void load(), { rootMargin: '900px 0px' });
    near.observe(stage);
    const seen = new IntersectionObserver(
      ([e]) => {
        onScreen = e.isIntersecting;
        wake();
      },
      { threshold: 0.12 },
    );
    seen.observe(stage);
    const onVisibility = () => {
      if (document.hidden) world?.stop();
      else wake();
    };
    document.addEventListener('visibilitychange', onVisibility);

    let resizeTimer = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => world?.resize(stage.clientWidth, stage.clientHeight), 120);
    });
    ro.observe(stage);

    // The camera follows the section through the view: it turns into place as the model arrives and eases on a
    // touch as it leaves, in both directions, read straight from the scroll position
    const ctx = gsap.context(() => {
      if (still) return;
      const st = ScrollTrigger.create({
        trigger: frame,
        scroller: frame.closest<HTMLElement>('.vl-landing') ?? undefined,
        start: 'top bottom',
        end: 'bottom top',
        refreshPriority: -1,
        onUpdate: (self) => {
          progress = self.progress;
          world?.setScroll(progress);
        },
      });
      progress = st.progress;
    }, frame);

    const at = (e: PointerEvent): [number, number] => {
      const r = stage.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1];
    };
    // Mouse and trackpad: the camera leans toward the pointer, and what's under it lights up
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      world?.setPointer(...at(e), true);
    };
    const onLeave = () => world?.setPointer(0, 0, false);
    // A click, or a tap that didn't turn into a scroll, opens what is there. Nothing here stops the page scrolling.
    let down: { x: number; y: number; t: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = e.isPrimary ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
    };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 700;
      down = null;
      if (moved < 10 && quick) world?.click(...at(e));
    };
    const onCancel = () => (down = null);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerleave', onLeave);
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onCancel);
    // Anywhere else on the page, or Escape, closes the label and lets the camera settle back
    const onOutside = (e: PointerEvent) => {
      if (!frame.contains(e.target as Node)) world?.select(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') world?.select(null);
    };
    document.addEventListener('pointerdown', onOutside);
    window.addEventListener('keydown', onKey);

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
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('pointerdown', onOutside);
      window.removeEventListener('keydown', onKey);
      world?.dispose();
      worldRef.current = null;
    };
  }, []);

  const tip = shown ?? held;
  const copy = tip ? SPOTS[tip.id] : null;
  const open = (id: SpotId) => worldRef.current?.select(id);

  return (
    <div ref={frameRef} className="vl-world-frame">
      <div ref={stageRef} className="vl-world-stage" data-state={state}>
        <img
          className="vl-world-poster"
          src={`/landing/world/poster-${theme}.webp`}
          alt=""
          width={1600}
          height={900}
          loading="lazy"
          decoding="async"
          draggable={false}
        />
        <canvas
          ref={canvasRef}
          className="vl-world-canvas"
          role="img"
          aria-label="A miniature VoltLink garage on a wooden model base: three service bays with mechanics at a bike lift, a scooter and a wheel balancer, a glass reception, a pick-up and drop-off zone with a customer handing over a scooter, customer parking, and the streets outside, where a rider has broken down and the VoltLink pickup truck is on its way."
        />
      </div>

      {/* The label: placed by the scene beside its spot, so it moves with the camera and with the vehicles */}
      <div ref={tipRef} className="vl-world-tip" data-show={shown ? 'true' : 'false'} data-open={shown?.open ? 'true' : 'false'}>
        <div className="vl-world-tip-card" role="status" aria-live="polite">
          {copy && tip && (
            <>
              <span className="vl-world-tip-kicker">{copy.kicker}</span>
              <strong>{copy.title}</strong>
              {tip.open && <p>{spotText(tip.id, tip.note)}</p>}
              {tip.open && (
                <button type="button" className="vl-world-tip-close" aria-label="Close" onClick={() => worldRef.current?.select(null)}>
                  <X size={13} strokeWidth={2} aria-hidden="true" />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* The same places for the keyboard and screen readers; the label shows what each one opens */}
      {state === 'live' && (
        <ul className="vl-world-spots" aria-label="Places in the model">
          {SPOT_ORDER.map((id) => (
            <li key={id}>
              <button type="button" onClick={() => open(id)}>
                {SPOTS[id].kicker}: {SPOTS[id].title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

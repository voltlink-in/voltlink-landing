// VoltLink in miniature: a two-wheeler garage built as an architectural model on a wooden plinth, seen through an
// orthographic isometric camera. Three working bays, a glass reception, a pick-up and drop-off zone, customer
// parking and the streets around them. On the side road a rider has broken down: a pin marks the call, and the
// VoltLink pickup truck leaves the forecourt, collects the scooter and comes back round the block.
//
// Static geometry is merged into one mesh per material; only the moving pieces stay separate. Lighting is soft
// sun and sky with PCF shadows, plus screen-space ambient occlusion (GTAO) where the device can afford it.
//
// A director takes turns between two stories, with a pause between them: the truck's call-out, and a test ride
// in which a mechanic takes the bike from bay 3 round the block and parks it back in the bay. Everything else
// keeps its own quiet rhythm. A dozen places answer the pointer: a soft outline on the ground, a label beside
// them, and on a click a small piece of their story (a bay light warms, the lift rises, a scooter's lights chirp).

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { bake, box, clearGeometry, clearMaterials, label, makeTextures, mat, mergeStatic, type Textures } from './kit';
import * as M from './models';
import type { SpotId, SpotNote } from './spots';

export type Tier = 'high' | 'low';

/** The spot the label is on, and whether it was clicked (open) or only hovered. */
export interface ShownSpot {
  id: SpotId;
  note: SpotNote;
  open: boolean;
}

export interface WorldOptions {
  dark: boolean;
  /** Reduced motion: still frames only. Spots still answer, without anything moving. */
  still: boolean;
  tier: Tier;
  /** The label element; the world keeps it beside its spot as things move. */
  tip?: HTMLElement | null;
  onSpot?: (spot: ShownSpot | null) => void;
  /** Checked between build steps: true once nobody wants this world any more, and the build stops there. */
  cancelled?: () => boolean;
}

export interface MiniWorld {
  resize(w: number, h: number): void;
  setTheme(dark: boolean): void;
  /** Pointer position over the stage, each axis in -1..1 (y down); `inside` false when it leaves. */
  setPointer(x: number, y: number, inside: boolean): void;
  /** How far the section has scrolled through the view, 0..1. */
  setScroll(p: number): void;
  /** A click or tap at a stage position (-1..1): opens what is there, or closes the open spot. */
  click(x: number, y: number): void;
  select(id: SpotId | null): void;
  start(): void;
  stop(): void;
  renderOnce(): void;
  snapshot(type?: string, quality?: number): string;
  /** For tests: where a spot's outline sits on the stage, in pixels, and the story so far. */
  where(id: SpotId): { x: number; y: number; on: boolean };
  stats(): { calls: number; triangles: number; frameMs: number; fps: number; cap: number; story: string; k: number; selected: SpotId | null; hover: SpotId | null };
  dispose(): void;
}

/* ── Plan (units ≈ metres; x to the right, z toward the viewer) ── */
const PW = 26;
const PD = 20;
const BAYS = [-9.85, -5.25, -0.65];
const STRANDED = new THREE.Vector3(12.55, 0, -5.0);
/** where the bay 3 motorcycle stands, leaning a touch on its stand, and where its mechanic waits by the balancer */
const PARK = new THREE.Vector3(BAYS[2] - 0.5, 0.08, -5.6);
const PARK_TILT = 0.03;
const WATCH = new THREE.Vector3(1.0, 0.08, -7.55);

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeIn = (t: number) => t * t * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smooth = (a: number, b: number, t: number) => {
  const x = clamp01((t - a) / (b - a));
  return x * x * (3 - 2 * x);
};
/** Up and back down over `d` seconds, easing at both ends: a gesture, not a loop. */
const bump = (t: number, d: number) => (t <= 0 || t >= d ? 0 : Math.sin((Math.PI * t) / d) ** 2);

/** A critically damped spring: follows its target smoothly, never overshoots, the same at any frame rate. */
class Spring {
  x: number;
  to: number;
  v = 0;
  constructor(x: number, readonly time = 0.3) {
    this.x = this.to = x;
  }
  step(dt: number) {
    const o = 2 / this.time;
    const k = o * dt;
    const e = 1 / (1 + k + 0.48 * k * k + 0.235 * k * k * k);
    const c = this.x - this.to;
    const s = (this.v + o * c) * dt;
    this.v = (this.v - o * s) * e;
    this.x = this.to + (c + s) * e;
    return this.x;
  }
  snap(x = this.to) {
    this.x = this.to = x;
    this.v = 0;
  }
}

/** ∫ smoothstep: distance covered while speed eases from 0 to full. */
const ramp = (x: number) => x * x * x - (x * x * x * x) / 2;
const travelTime = (L: number, v: number, tin: number, tout: number) => L / v + (tin + tout) / 2;
/** Distance along a path of length L at time t: easing up to speed v over `tin` s, cruising, easing to a stop over `tout` s. */
function travel(t: number, L: number, v: number, tin: number, tout: number) {
  const T = travelTime(L, v, tin, tout);
  if (t <= 0) return 0;
  if (t >= T) return L;
  if (tin > 0 && t < tin) return v * tin * ramp(t / tin);
  if (tout > 0 && T - t < tout) return L - v * tout * ramp((T - t) / tout);
  return (v * tin) / 2 + v * (t - tin);
}

/* ── Painted signs and road paint ── */

function signTexture(text: string, sub: string | null, bg: string, w = 1024, h = 128) {
  return label(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.textBaseline = 'middle';
    g.font = `700 ${Math.round(h * 0.5)}px "Public Sans", system-ui, sans-serif`;
    const tw = g.measureText(text).width;
    let x = w / 2 - tw / 2;
    if (sub) {
      g.font = `500 ${Math.round(h * 0.26)}px "Public Sans", system-ui, sans-serif`;
      const sw = g.measureText(sub).width;
      x = w / 2 - (tw + 40 + sw) / 2;
      g.globalAlpha = 0.75;
      g.fillText(sub, x + tw + 40, h / 2 + 3);
      g.globalAlpha = 1;
      g.font = `700 ${Math.round(h * 0.5)}px "Public Sans", system-ui, sans-serif`;
    }
    g.fillText(text, x, h / 2 + 2);
  });
}

function zoneTexture() {
  return label(1024, 560, (g) => {
    const W = 1024;
    const H = 560;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(88,101,242,0.16)';
    g.fillRect(14, 14, W - 28, H - 28);
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineWidth = 14;
    g.setLineDash([46, 26]);
    g.strokeRect(14, 14, W - 28, H - 28);
    g.setLineDash([]);
    // hatched ends
    g.save();
    g.beginPath();
    g.rect(14, 14, 150, H - 28);
    g.rect(W - 164, 14, 150, H - 28);
    g.clip();
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 12;
    for (let i = -H; i < W + H; i += 44) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + H, H);
      g.stroke();
    }
    g.restore();
    g.fillStyle = 'rgba(76,88,214,0.85)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '800 92px "Public Sans", system-ui, sans-serif';
    g.fillText('PICK-UP', W / 2, H / 2 - 62);
    g.fillText('DROP-OFF', W / 2, H / 2 + 52);
    g.font = '700 40px "Public Sans", system-ui, sans-serif';
    g.fillStyle = 'rgba(76,88,214,0.7)';
    g.fillText('voltlink', W / 2, H / 2 + 150);
  });
}

function shadowTexture() {
  return label(256, 256, (g) => {
    const r = g.createRadialGradient(128, 128, 20, 128, 128, 128);
    r.addColorStop(0, 'rgba(0,0,0,0.55)');
    r.addColorStop(0.55, 'rgba(0,0,0,0.25)');
    r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 256, 256);
  });
}

/* ── The model ── */

interface Anim {
  lift: { platform: THREE.Group; scissor: THREE.Group; bike: THREE.Group };
  wrench: M.Figure;
  watcher: M.Figure;
  liftMech: M.Figure;
  walker: M.Figure;
  greeter: M.Figure;
  customer: M.Figure;
  spin: THREE.Group;
  trees: THREE.Object3D[];
  riders: { ride: M.Ride; man: M.Figure; group: THREE.Group; axis: 'x' | 'z'; lane: number; dir: number; speed: number; phase: number }[];
  truck: M.Truck;
  bedScooter: THREE.Group;
  pathA: THREE.CatmullRomCurve3;
  pathB: THREE.CatmullRomCurve3;
  uStop: number;
  stranded: THREE.Group;
  strandedHazard: THREE.MeshStandardMaterial;
  pin: THREE.Group;
  ring: THREE.Mesh;
  route: THREE.InstancedMesh;
  routeAt: { p: THREE.Vector3; q: THREE.Quaternion; u: number }[];
  routeShown: boolean;
  lamps: THREE.PointLight[];
  /** the bulbs of the three bay pendants, each its own material so a bay can light up alone */
  bayBulbs: THREE.MeshStandardMaterial[];
  /** the moving group that holds everything not baked */
  live: THREE.Group;
  /** everything that never moves, waiting to be baked (in its own step, after the build) */
  statics: THREE.Group;
  /** the motorcycle in bay 3 and the mechanic who takes it for its test ride */
  test: { bike: M.Ride; head: THREE.MeshStandardMaterial; out: THREE.CatmullRomCurve3; back: THREE.CatmullRomCurve3 };
  handover: M.Figure;
  /** vehicles whose lights can chirp, as a car does when it's unlocked: the drop-off scooter, then the parked ones */
  chirps: Chirp[];
}

interface Chirp {
  head: THREE.MeshStandardMaterial;
  hazard: THREE.MeshStandardMaterial | null;
  at: number;
}

/** Give a vehicle its own lamp materials, so its lights can blink without the others. */
function ownLights(r: M.Ride): Chirp {
  const head = M.L.head().clone();
  r.head.material = head;
  const hazard = r.hazards.length ? M.L.hazard().clone() : null;
  if (hazard) r.hazards.forEach((m) => (m.material = hazard));
  return { head, hazard, at: -99 };
}

/** Builds the model, pausing (`pause`) between its larger parts so no single step holds the page up. */
async function buildWorld(tex: Textures, pause: () => Promise<void>): Promise<Anim> {
  const root = new THREE.Group();

  /* plinth and ground */
  box(root, PW + 0.7, 1.3, PD + 0.7, mat('#5f4230', { rough: 0.5, map: tex.wood }), 0, -1.48, 0, 0.14);
  box(root, PW + 0.24, 0.18, PD + 0.24, mat('#ebe5da', { rough: 0.75 }), 0, -0.18, 0, 0.04);
  box(root, PW, 0.06, PD, mat('#a4bc86', { rough: 0.95, map: tex.grass }), 0, -0.06, 0);
  const slab = mat('#d7d2c8', { rough: 0.9, map: tex.slab });
  box(root, 20.8, 0.06, 14.8, slab, -2.6, 0, -2.6);
  box(root, 14.0, 0.02, 7.2, mat('#c4c9cf', { rough: 0.38, map: tex.concrete }), -5.2, 0.06, -5.8);
  const walk = mat('#e4dfd6', { rough: 0.9, map: tex.concrete });
  box(root, 21.8, 0.12, 1.0, walk, -2.1, 0, 5.3);
  box(root, 1.0, 0.12, 14.8, walk, 8.3, 0, -2.6);
  const curb = mat('#f1ede6', { rough: 0.7 });
  for (const [a, b] of [[-13, -7.4], [-4.4, 3.6], [7.6, 9.0]]) box(root, b - a, 0.15, 0.2, curb, (a + b) / 2, 0, 5.9);
  box(root, 0.2, 0.15, 16.0, curb, 8.9, 0, -2.0);
  const asphalt = mat('#3c3e44', { rough: 0.92, map: tex.asphalt });
  box(root, PW, 0.05, 3.6, asphalt, 0, 0, 7.8);
  box(root, 3.2, 0.05, 16.0, asphalt, 10.6, 0, -2.0);
  const paint = mat('#f3f1ea', { rough: 0.6 });
  for (let x = -12.4; x < 8.4; x += 1.6) box(root, 0.8, 0.012, 0.1, paint, x, 0.05, 7.8);
  for (let z = -9.6; z < 2.6; z += 1.6) box(root, 0.1, 0.012, 0.8, paint, 10.6, 0.05, z);
  box(root, PW, 0.012, 0.08, paint, 0, 0.05, 9.35);
  for (let x = 9.3; x < 12.1; x += 0.46) box(root, 0.26, 0.012, 1.3, paint, x, 0.05, 3.7);
  const lot = mat('#f6f4ef', { rough: 0.6 });
  for (let x = -12.4; x <= -7.5; x += 1.2) box(root, 0.07, 0.012, 2.6, lot, x, 0.06, 2.3);
  const yellow = mat('#e1b23f', { rough: 0.5 });
  for (const bx of BAYS) {
    box(root, 3.8, 0.012, 0.08, yellow, bx, 0.08, -8.4);
    box(root, 3.8, 0.012, 0.08, yellow, bx, 0.08, -3.0);
    box(root, 0.08, 0.012, 5.4, yellow, bx - 1.9, 0.08, -5.7);
    box(root, 0.08, 0.012, 5.4, yellow, bx + 1.9, 0.08, -5.7);
  }

  /* the workshop: a cut-away model, open to the front and the sky */
  const wall = mat('#efebe5', { rough: 0.92, map: tex.plaster });
  const trim = mat('#d8d1c5', { rough: 0.8 });
  const steel = mat('#8d939c', { rough: 0.5, metal: 0.25 });
  box(root, 14.4, 3.2, 0.25, wall, -5.2, 0.06, -9.53);
  box(root, 0.25, 3.2, 7.45, wall, -12.28, 0.06, -5.83);
  box(root, 0.25, 3.2, 2.8, wall, 1.88, 0.06, -8.15);
  box(root, 0.25, 0.95, 4.5, wall, 1.88, 0.06, -4.45);
  box(root, 14.5, 0.1, 0.34, trim, -5.2, 3.26, -9.53);
  box(root, 0.34, 0.1, 7.5, trim, -12.28, 3.26, -5.83);
  box(root, 14.4, 0.25, 0.27, mat('#b9b2a6', { rough: 0.9 }), -5.2, 0.06, -9.38);
  for (const x of [-12.2, -7.55, -2.95, 1.8]) box(root, 0.28, 3.2, 0.28, steel, x, 0.06, -2.2, 0.02);
  for (const x of BAYS) box(root, 0.11, 0.16, 7.3, steel, x, 3.1, -5.85);
  // fascia with the sign
  box(root, 14.6, 0.6, 0.3, mat(M.C.accent, { rough: 0.45 }), -5.2, 3.26, -2.2, 0.03);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(7.2, 0.56),
    new THREE.MeshStandardMaterial({ map: signTexture('voltlink', 'two-wheeler service', M.C.accent), roughness: 0.6 }),
  );
  sign.position.set(-5.2, 3.56, -2.045);
  sign.userData.keep = true;
  root.add(sign);
  // high windows in the back wall
  const winGlass = mat('#9db6cc', { rough: 0.1, metal: 0.3 });
  for (const x of [-10.6, -6.0, -1.4]) {
    box(root, 1.8, 0.72, 0.06, steel, x, 2.0, -9.41);
    box(root, 1.64, 0.58, 0.07, winGlass, x, 2.07, -9.4);
  }

  await pause();
  /* bay 1: a motorcycle on the lift */
  const liftParts = M.bikeLift(root, BAYS[0], -5.7);
  const liftBike = M.motorcycle('#b8382f');
  liftBike.root.position.set(-0.05, 0.12, 0);
  liftParts.platform.add(liftBike.root);
  const liftMech = M.figure({ ...M.WORKWEAR, skin: 1, hair: 0 });
  liftMech.root.position.set(BAYS[0] + 0.3, 0.08, -4.5);
  liftMech.root.rotation.y = Math.PI / 2;
  root.add(liftMech.root);
  M.toolCabinet(root, -11.0, -9.05);
  M.compressor(root, -9.0, -8.95);
  M.pegboard(root, BAYS[0], 1.2, -9.38, 2.8);
  M.drum(root, -11.75, -3.25, '#2f5fa8');
  M.drum(root, -11.75, -3.9, '#c8453b');
  M.tyreStack(root, -11.65, -4.85, 5);

  /* bay 2: a scooter being serviced on the floor */
  const scoot = M.still(M.scooter('#ece0c2'));
  scoot.root.position.set(BAYS[1], 0.08, -5.9);
  root.add(scoot.root);
  const wrench = M.figure({ ...M.WORKWEAR, skin: 2, hair: 1 });
  M.crouch(wrench);
  wrench.root.position.set(BAYS[1] + 0.1, 0.08, -4.95);
  wrench.root.rotation.y = Math.PI / 2;
  root.add(wrench.root);
  box(root, 0.5, 0.26, 0.26, mat(M.C.red, { rough: 0.35, metal: 0.3 }), BAYS[1] + 1.0, 0.08, -4.7, 0.03);
  M.toolCabinet(root, -6.6, -9.05, '#2f5fa8');
  M.workbench(root, -4.3, -8.95, 2.0);
  M.pegboard(root, -4.3, 1.4, -9.38, 2.0);

  /* bay 3: a motorcycle on its stand, a wheel on the balancer */
  const navy = M.motorcycle('#2c3e66');
  navy.root.position.copy(PARK);
  navy.root.rotation.order = 'YXZ';
  navy.root.rotation.z = PARK_TILT;
  const navyHead = M.L.head().clone();
  navy.head.material = navyHead;
  root.add(navy.root);
  M.tyreRack(root, -1.8, -9.05);
  const spin = M.balancer(root, 0.2, -8.6);
  const watcher = M.figure({ ...M.WORKWEAR, skin: 3, hair: 2 });
  watcher.root.position.copy(WATCH);
  watcher.root.rotation.y = Math.PI / 2;
  watcher.armL.rotation.z = 0.5;
  root.add(watcher.root);

  /* a mechanic fetching tools between the cabinet and the lift */
  const walker = M.figure({ ...M.WORKWEAR, skin: 0, hair: 2 });
  root.add(walker.root);

  /* pendant lamps over the bays */
  const bayBulbs = BAYS.map(() => M.L.bulb().clone());
  const lampSpots: M.Lamp[] = BAYS.map((x, i) => M.pendant(root, x, 3.06, -5.7, bayBulbs[i]));

  await pause();
  /* reception: a glass pavilion */
  const recFloor = mat('#c9b294', { rough: 0.6, map: tex.wood });
  box(root, 4.8, 0.05, 4.8, recFloor, 5.0, 0.06, -7.0);
  box(root, 4.9, 2.8, 0.22, wall, 5.0, 0.06, -9.45);
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 0.42),
    new THREE.MeshStandardMaterial({ map: signTexture('voltlink', 'reception', M.C.accent, 1024, 180), roughness: 0.5 }),
  );
  panel.position.set(5.0, 2.05, -9.33);
  panel.userData.keep = true;
  root.add(panel);
  const glass = mat('#c4dcef', { rough: 0.05, metal: 0.1, opacity: 0.2 });
  const frame = mat('#2f333b', { rough: 0.45, metal: 0.6 });
  box(root, 0.04, 2.6, 4.7, glass, 2.6, 0.11, -7.0);
  box(root, 0.04, 2.6, 4.7, glass, 7.4, 0.11, -7.0);
  box(root, 1.8, 2.6, 0.04, glass, 3.5, 0.11, -4.62);
  box(root, 2.0, 2.6, 0.04, glass, 6.4, 0.11, -4.62);
  for (const [x, z] of [[2.6, -4.62], [7.4, -4.62], [2.6, -9.35], [7.4, -9.35], [4.4, -4.62], [5.4, -4.62]]) box(root, 0.1, 2.7, 0.1, frame, x, 0.11, z);
  box(root, 4.9, 0.1, 0.1, frame, 5.0, 2.76, -4.62);
  box(root, 0.1, 0.1, 4.8, frame, 2.6, 2.76, -7.0);
  box(root, 0.1, 0.1, 4.8, frame, 7.4, 2.76, -7.0);
  box(root, 2.4, 1.0, 0.6, mat('#ebe5da', { rough: 0.8 }), 5.0, 0.11, -7.2, 0.04);
  box(root, 2.5, 0.06, 0.72, mat('#b48a5d', { rough: 0.6 }), 5.0, 1.11, -7.2, 0.02);
  box(root, 0.5, 0.32, 0.04, M.L.screen(), 4.5, 1.25, -7.42);
  box(root, 0.06, 0.1, 0.06, frame, 4.5, 1.17, -7.42);
  M.planter(root, 7.0, -9.0);
  M.bench(root, 3.2, -6.4, -Math.PI / 2);
  const greeter = M.figure({ shirt: '#f4f2ee', legs: '#2c3550', skin: 2, hair: 2 });
  greeter.root.position.set(5.2, 0.11, -8.05);
  greeter.root.rotation.y = -Math.PI / 2;
  root.add(greeter.root);
  const customer = M.figure({ shirt: '#d6834a', legs: '#4d5a6e', skin: 0, hair: 1 });
  customer.root.position.set(5.4, 0.11, -6.2);
  customer.root.rotation.y = Math.PI / 2;
  root.add(customer.root);
  M.helmet(root, 4.0, 1.14, -7.1, '#e8e4dc');
  const recLight = new THREE.PointLight('#ffd7a3', 0, 7, 2);
  recLight.position.set(5.0, 2.4, -7.0);
  recLight.userData.power = 9;

  /* totem by the entrance */
  box(root, 0.56, 2.7, 0.44, mat('#2b2f38', { rough: 0.6 }), 7.25, 0.06, -3.4, 0.04);
  const totem = new THREE.Mesh(
    new THREE.PlaneGeometry(2.1, 0.42),
    new THREE.MeshStandardMaterial({ map: signTexture('voltlink', null, M.C.accent, 512, 104), roughness: 0.5 }),
  );
  totem.rotation.z = Math.PI / 2;
  totem.position.set(7.25, 1.55, -3.17);
  totem.userData.keep = true;
  root.add(totem);

  /* forecourt: the pick-up and drop-off zone, and a drop-off in progress */
  const zone = new THREE.Mesh(
    new THREE.PlaneGeometry(8.0, 4.4),
    new THREE.MeshStandardMaterial({ map: zoneTexture(), transparent: true, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  zone.rotation.x = -Math.PI / 2;
  zone.position.set(-2.5, 0.065, 1.5);
  zone.userData.keep = true;
  zone.receiveShadow = true;
  root.add(zone);
  const dropScooter = M.still(M.scooter('#2a7f86'));
  dropScooter.root.position.set(0.5, 0.06, 3.2);
  root.add(dropScooter.root);
  const chirps = [ownLights(dropScooter)];
  M.helmet(root, 0.1, 0.8, 3.2, '#2b2f38');
  const handover = M.figure({ ...M.WORKWEAR, skin: 1, hair: 1 });
  handover.root.position.set(1.25, 0.06, 2.45);
  handover.root.rotation.y = Math.PI * 0.85;
  root.add(handover.root);
  const rider = M.figure({ shirt: '#9fb7c9', legs: '#3c4250', skin: 3, hair: 0 });
  rider.armR.rotation.z = 0.9;
  rider.root.position.set(0.45, 0.06, 2.5);
  rider.root.rotation.y = -Math.PI * 0.15;
  root.add(M.still(rider.root));

  /* customer parking */
  const parked = [
    { c: '#c8453b', s: true },
    { c: '#ece0c2', s: true },
    { c: '#2f2f33', s: false },
    { c: '#5a7a4f', s: true },
  ];
  parked.forEach((p, i) => {
    const r = M.still(p.s ? M.scooter(p.c) : M.motorcycle(p.c));
    r.root.position.set(-11.8 + i * 1.2, 0.06, 2.3);
    r.root.rotation.y = Math.PI / 2;
    root.add(r.root);
    chirps.push(ownLights(r));
  });
  M.helmet(root, -11.8, 0.82, 2.65, '#f2a93b');

  /* seating and greenery out front */
  M.bench(root, 4.6, -1.3, 0);
  M.planter(root, 2.9, -1.4);
  M.planter(root, 6.3, -1.4);
  const trees: THREE.Object3D[] = [];
  for (const [x, z, s, t] of [[-10.6, 5.3, 0.9, 0], [-1.6, 5.3, 0.85, 1], [8.3, -8.4, 0.95, 0], [8.3, -0.9, 0.8, 1]] as const) {
    box(root, 0.8, 0.13, 0.8, mat('#8a6b52', { rough: 0.95 }), x, 0, z);
    trees.push(M.tree(root, x, z, s, t));
  }
  for (const z of [-9.2, -1.8, 2.4]) trees.push(M.cypress(root, 12.62, z, 0.9));
  for (const z of [-9.0, -7.4, -3.4]) M.bush(root, -12.65, z, 0.9);
  for (const x of [3.2, 6.6]) M.bush(root, x, -9.82, 0.8);
  const streetSpots = [
    M.streetLamp(root, -12.2, 5.55, -Math.PI / 2),
    M.streetLamp(root, -3.0, 5.55, -Math.PI / 2),
    M.streetLamp(root, 2.9, 5.55, -Math.PI / 2),
    M.streetLamp(root, 8.55, -5.4, 0),
  ];
  M.cone(root, 11.95, -3.7);
  M.cone(root, 11.95, -6.5);

  await pause();
  /* the breakdown on the side road */
  const stranded = new THREE.Group();
  stranded.position.copy(STRANDED);
  const sScooter = M.scooter('#e5b13a');
  sScooter.root.rotation.y = -Math.PI / 2;
  // its own hazard lamps, so only this scooter blinks
  const strandedHazard = M.L.hazard().clone();
  sScooter.hazards.forEach((m) => (m.material = strandedHazard));
  stranded.add(sScooter.root);
  const sRider = M.figure({ shirt: '#7a5ea8', legs: '#33384a', skin: 0, hair: 0 });
  sRider.root.position.set(0.05, 0, -1.25);
  sRider.root.rotation.y = Math.PI;
  sRider.armR.rotation.z = 2.2;
  sRider.armR.rotation.x = 0.4;
  sRider.head.rotation.z = -0.15;
  stranded.add(sRider.root);
  M.helmet(stranded, 0.0, 0.8, -0.35, '#f4f2ee');
  stranded.traverse((o) => (o.userData.keep = true));
  root.add(stranded);
  const pinM = M.pin();
  pinM.position.set(STRANDED.x, 2.2, STRANDED.z);
  root.add(pinM);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.68, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: M.C.accent, transparent: true, opacity: 0.6, depthWrite: false }),
  );
  ring.position.set(STRANDED.x - 0.3, 0.07, STRANDED.z);
  ring.userData.keep = true;
  root.add(ring);

  /* the pickup truck and its routes */
  const truck = M.truck();
  const bedScooter = M.scooter('#e5b13a').root;
  bedScooter.position.set(0.0, 0.06, 0);
  truck.bed.add(bedScooter);
  root.add(truck.root);
  const v = (x: number, z: number) => new THREE.Vector3(x, 0.06, z);
  const pathA = new THREE.CatmullRomCurve3(
    [v(-4.2, 1.6), v(-0.6, 0.9), v(3.2, 1.2), v(4.8, 3.0), v(5.8, 5.4), v(8.0, 6.9), v(9.8, 5.0), v(9.8, 0.0), v(9.8, -5.0), v(9.8, -10.8)],
    false,
    'centripetal',
  );
  const pathB = new THREE.CatmullRomCurve3(
    [v(-14.0, 6.9), v(-9.5, 6.9), v(-6.6, 5.7), v(-6.6, 3.6), v(-5.8, 1.9), v(-4.2, 1.6)],
    false,
    'centripetal',
  );
  let uStop = 0;
  let best = Infinity;
  for (let i = 0; i <= 400; i++) {
    const p = pathA.getPointAt(i / 400);
    const d = p.distanceToSquared(v(9.8, -5.0));
    if (d < best) {
      best = d;
      uStop = i / 400;
    }
  }
  // the dispatch route, painted in light along the road to the call: each dash placed once, only its size animates
  const routeAt: Anim['routeAt'] = [];
  for (let u = 0.1; u < uStop - 0.01; u += 0.022) {
    const p = pathA.getPointAt(u);
    const tg = pathA.getTangentAt(u);
    p.y = 0.07;
    routeAt.push({ p, q: new THREE.Quaternion().setFromAxisAngle(yAxis, Math.atan2(-tg.z, tg.x)), u });
  }
  const route = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.34, 0.02, 0.12),
    new THREE.MeshBasicMaterial({ color: '#8f99ff', transparent: true, opacity: 0.9, depthWrite: false }),
    routeAt.length,
  );
  route.userData.keep = true;
  route.frustumCulled = false;
  for (let i = 0; i < routeAt.length; i++) route.setMatrixAt(i, tmpM.makeScale(0.001, 0.001, 0.001));
  root.add(route);

  /* the test ride: out of bay 3 and the right-hand gate, up the side road; back along the main road and the left
     gate, across the forecourt (well clear of the parked truck and the handover) and into the bay, ending where it
     started. y follows the floor it rolls on. */
  const w = (x: number, z: number, y = 0.06) => new THREE.Vector3(x, y, z);
  const testOut = new THREE.CatmullRomCurve3(
    [w(PARK.x, PARK.z, 0.08), w(-0.55, PARK.z, 0.08), w(0.1, -5.2, 0.08), w(0.35, -4.2, 0.08), w(0.35, -2.8, 0.08), w(0.4, -1.4), w(0.9, -0.2), w(2.0, 0.8), w(4.0, 2.6), w(5.6, 4.9), w(7.3, 6.6, 0.05), w(9.2, 6.6, 0.05), w(9.8, 5.0, 0.05), w(9.8, 0.0, 0.05), w(9.8, -10.8, 0.05)],
    false,
    'centripetal',
  );
  const testBack = new THREE.CatmullRomCurve3(
    [w(-14.0, 6.9, 0.05), w(-9.5, 6.9, 0.05), w(-6.7, 6.2, 0.05), w(-5.8, 4.9), w(-4.0, 4.1), w(-1.9, 3.6), w(-1.3, 2.1), w(-0.7, 0.2), w(-0.9, -2.6, 0.08), w(-1.9, -4.0, 0.08), w(-2.15, -5.0, 0.08), w(-1.65, PARK.z, 0.08), w(PARK.x, PARK.z, 0.08)],
    false,
    'centripetal',
  );

  await pause();
  /* riders on the roads */
  const mkRider = (ride: M.Ride, dress: M.Dress, seatH: number) => {
    const group = new THREE.Group();
    group.add(ride.root);
    const man = M.figure(dress);
    M.sit(man, seatH);
    man.root.position.x = -0.3;
    group.add(man.root);
    root.add(group);
    return { ride, man, group };
  };
  const r1 = mkRider(M.motorcycle('#2a7f86'), { shirt: '#3b3f4a', legs: '#2a2d36', cap: '#e8e4dc', skin: 1 }, 0.9);
  const r2 = mkRider(M.scooter('#c8453b'), { shirt: '#e3d4b8', legs: '#4d5a6e', cap: '#f2a93b', skin: 2 }, 0.78);
  const riders = [
    { ...r1, axis: 'x' as const, lane: 8.7, dir: -1, speed: 2.4, phase: 0 },
    { ...r2, axis: 'z' as const, lane: 11.4, dir: 1, speed: 1.7, phase: 0.45 },
  ];

  /* light */
  const lamps: THREE.PointLight[] = [];
  for (const l of lampSpots) {
    const p = new THREE.PointLight('#ffd9a8', 0, 6.5, 2);
    p.position.set(l.x, l.y, l.z);
    p.userData.power = 14;
    lamps.push(p);
  }
  for (const l of streetSpots) {
    const p = new THREE.PointLight('#ffcf94', 0, 6, 2);
    p.position.set(l.x, l.y, l.z);
    p.userData.power = 12;
    lamps.push(p);
  }
  lamps.push(recLight);
  lamps.forEach((l) => root.add(l));

  /* ground shadow under the plinth */
  const under = new THREE.Mesh(
    new THREE.PlaneGeometry(PW * 1.42, PD * 1.5).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.55, color: '#000000' }),
  );
  under.position.set(0.8, -1.5, 0.6);
  under.userData.keep = true;
  root.add(under);

  // Everything that never moves becomes a handful of merged meshes
  const statics = new THREE.Group();
  const live = new THREE.Group();
  for (const child of [...root.children]) {
    let keep = false;
    child.traverse((o) => {
      if (o.userData.keep || (o as THREE.Light).isLight) keep = true;
    });
    if (keep) live.add(child);
    else statics.add(child);
  }

  return {
    lift: { platform: liftParts.platform, scissor: liftParts.scissor, bike: liftBike.root },
    wrench,
    watcher,
    liftMech,
    walker,
    greeter,
    customer,
    spin,
    trees,
    riders,
    truck,
    bedScooter,
    pathA,
    pathB,
    uStop,
    stranded,
    strandedHazard,
    pin: pinM,
    ring,
    route,
    routeAt,
    routeShown: false,
    lamps,
    bayBulbs,
    live,
    statics,
    test: { bike: navy, head: navyHead, out: testOut, back: testBack },
    handover,
    chirps,
  };
}

/* ── Animation ── */

const tmpM = new THREE.Matrix4();
const tmpS = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpT = new THREE.Vector3();
const yAxis = new THREE.Vector3(0, 1, 0);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/* The director: the truck's call-out and the test ride take turns, with a pause between them. A click asks for
   one sooner: it starts at once if nothing is running, otherwise it goes next. */
type Story = 'truck' | 'ride';
const REST = 7;
const TRUCK_STORY = 37;
/** The call-out on the truck's 40 s clock: from home (8) to the call, round the block, home (40 = 0), unloaded by 5. */
const truckClock = (k: number) => (k < 32 ? k + 8 : k - 32);
/** Between stories the truck stands at home with its bed empty: the frame the poster shows. */
const TRUCK_HOME = 6;

/* The test ride, in seconds from its start */
const RIDE_V = 2.6;
const WALK = 4.4;
const MOUNT = 1.3;
/** where the mechanic stands to get on, beside the bike (in its own frame), and the saddle */
const BESIDE = new THREE.Vector3(0.15, 0, 0.6);
const SEAT = new THREE.Vector3(-0.3, 0, 0);
const WALK_PATH = [WATCH, new THREE.Vector3(0.5, 0.08, -5.0), new THREE.Vector3(PARK.x + BESIDE.x, 0.08, PARK.z + BESIDE.z)];

interface RideTimes {
  mount: number;
  go: number;
  out: number;
  back: number;
  parked: number;
  off: number;
  home: number;
  end: number;
  outLen: number;
  backLen: number;
}
function rideTimes(out: THREE.Curve<THREE.Vector3>, back: THREE.Curve<THREE.Vector3>): RideTimes {
  const outLen = out.getLength();
  const backLen = back.getLength();
  const mount = WALK;
  const go = mount + MOUNT + 1.4; // a moment with the engine running before it pulls away
  const out_ = go + travelTime(outLen, RIDE_V, 2.4, 0);
  const back_ = out_ + 4.5; // off the model, round the block
  const parked = back_ + travelTime(backLen, RIDE_V, 0, 2.8);
  const off = parked + 0.9 + MOUNT; // the stand goes down, then the mechanic steps off
  const home = off + WALK;
  return { mount, go, out: out_, back: back_, parked, off, home, end: home + 0.5, outLen, backLen };
}

/** A vehicle on the move: wheels turned by the distance it covers, leaning into turns, pitching as it speeds up or brakes. */
interface Mover {
  obj: THREE.Object3D;
  wheels: THREE.Object3D[];
  r: number;
  prev: THREE.Vector3;
  heading: number;
  speed: number;
  lean: Spring;
  pitch: Spring;
  ready: boolean;
}
const mover = (obj: THREE.Object3D, wheels: THREE.Object3D[], r: number): Mover => {
  obj.rotation.order = 'YXZ';
  return { obj, wheels, r, prev: new THREE.Vector3(), heading: obj.rotation.y, speed: 0, lean: new Spring(0, 0.35), pitch: new Spring(0, 0.3), ready: false };
};

function roll(m: Mover, pos: THREE.Vector3, heading: number, dt: number, leanK: number, pitchK: number, tilt = 0) {
  const dist = m.ready ? m.prev.distanceTo(pos) : 0;
  // a jump (the vehicle reappearing at the model's edge) turns no wheels and swings no body
  const jump = dist > 1.5;
  if (!jump) for (const w of m.wheels) w.rotation.z -= dist / m.r;
  if (dt > 0) {
    const speed = jump ? m.speed : dist / dt;
    const yaw = jump ? 0 : wrap(heading - m.heading) / dt;
    m.lean.to = THREE.MathUtils.clamp(-leanK * speed * yaw, -0.22, 0.22);
    m.pitch.to = THREE.MathUtils.clamp((pitchK * (speed - m.speed)) / dt, -0.035, 0.035);
    m.speed = speed;
    m.lean.step(dt);
    m.pitch.step(dt);
  } else {
    m.lean.snap(0);
    m.pitch.snap(0);
    m.speed = 0;
  }
  m.heading = heading;
  m.prev.copy(pos);
  m.ready = true;
  m.obj.position.copy(pos);
  m.obj.rotation.set(m.lean.x, heading, m.pitch.x + tilt);
}

function drive(m: Mover, curve: THREE.Curve<THREE.Vector3>, u: number, dt: number, leanK: number, pitchK: number) {
  curve.getPointAt(u, tmpV);
  curve.getTangentAt(Math.min(0.999, Math.max(0.001, u)), tmpT);
  roll(m, tmpV, Math.atan2(-tmpT.z, tmpT.x), dt, leanK, pitchK);
}

/** Turn a figure toward a heading, quickly but never in one frame. */
function face(o: THREE.Object3D, yaw: number, dt: number) {
  o.rotation.y = dt > 0 ? o.rotation.y + wrap(yaw - o.rotation.y) * (1 - Math.exp(-dt * 7)) : yaw;
}

/** Walking, weighted 0..1 so a step eases in and out of standing still. */
function stride(f: M.Figure, t: number, w: number) {
  const s = Math.sin(t * 7) * 0.5 * w;
  f.legL.rotation.z = s;
  f.legR.rotation.z = -s;
  f.armL.rotation.z = -s * 0.7;
  f.armR.rotation.z = s * 0.7;
  f.body.position.y = Math.abs(Math.sin(t * 7)) * 0.03 * w;
}

/** Sitting on a saddle, weighted 0..1 from standing (arms at `l`, `r`) to riding. */
function seat(f: M.Figure, w: number, l: number, r: number) {
  f.body.position.y = 0.06 * w;
  f.legL.rotation.z = f.legR.rotation.z = 1.35 * w;
  f.armL.rotation.z = l + (1.0 - l) * w;
  f.armR.rotation.z = r + (1.0 - r) * w;
  f.body.rotation.z = -0.14 * w;
}

/** A point along a walk of straight legs, `k` 0..1 by distance; returns the heading of that leg. */
function along(pts: THREE.Vector3[], k: number, out: THREE.Vector3) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += pts[i].distanceTo(pts[i - 1]);
  let d = k * total;
  for (let i = 1; i < pts.length; i++) {
    const seg = pts[i].distanceTo(pts[i - 1]);
    if (d <= seg || i === pts.length - 1) {
      out.lerpVectors(pts[i - 1], pts[i], Math.min(1, d / seg));
      return Math.atan2(-(pts[i].z - pts[i - 1].z), pts[i].x - pts[i - 1].x);
    }
    d -= seg;
  }
  return 0;
}
const WALK_BACK = [...WALK_PATH].reverse();

/** Everything the animation remembers between frames, and the gestures a click starts (world time they began). */
interface Play {
  story: Story | 'rest';
  k: number;
  last: Story;
  queue: Story[];
  lift: number;
  wave: number;
  greet: number;
  nod: number;
  hop: number;
  truck: Mover;
  bike: Mover;
  mounted: boolean;
  spin: Spring;
  times: RideTimes;
}

function makePlay(a: Anim): Play {
  return {
    story: 'rest',
    k: REST - 3, // the truck sets off a few seconds after the model comes into view
    last: 'ride',
    queue: [],
    lift: 0,
    wave: -99,
    greet: -99,
    nod: -99,
    hop: -99,
    truck: mover(a.truck.root, a.truck.wheels, 0.31),
    bike: mover(a.test.bike.root, a.test.bike.wheels, 0.385),
    mounted: false,
    spin: new Spring(0, 0.6),
    times: rideTimes(a.test.out, a.test.back),
  };
}

const storyLength = (p: Play, s: Story) => (s === 'truck' ? TRUCK_STORY : p.times.end);

function startStory(p: Play, s: Story) {
  p.story = s;
  p.k = 0;
  p.queue = p.queue.filter((q) => q !== s);
}

/** Ask for a story: now if the model is resting, otherwise as soon as the current one is over. */
function request(p: Play, s: Story) {
  if (p.story === 'rest') startStory(p, s);
  else if (p.story !== s && !p.queue.includes(s)) p.queue.push(s);
}

function direct(p: Play, dt: number) {
  p.k += dt;
  if (p.story === 'rest') {
    if (p.k >= REST) startStory(p, p.queue[0] ?? (p.last === 'truck' ? 'ride' : 'truck'));
  } else if (p.k >= storyLength(p, p.story)) {
    p.last = p.story;
    p.story = 'rest';
    p.k = 0;
  }
}

/** The lift's cycle: up, hold, down, hold. A click raises it from wherever it is, without a jump. */
const liftHeight = (lc: number) => (lc < 3 ? easeInOut(lc / 3) : lc < 9 ? 1 : lc < 12 ? 1 - easeInOut((lc - 9) / 3) : 0);
function raiseLift(p: Play) {
  if (p.lift >= 12) p.lift = 0;
  else if (p.lift >= 9) p.lift = 3 - (p.lift - 9); // the ease is symmetric, so this is the same height, rising
  else if (p.lift >= 3) p.lift = 3;
}

function animate(a: Anim, p: Play, t: number, dt: number) {
  if (dt > 0) {
    direct(p, dt);
    p.lift = (p.lift + dt) % 14;
  }

  // lift: up, hold, down, hold
  const lh = liftHeight(p.lift);
  const h = 0.08 + 0.62 * lh;
  a.lift.platform.position.y = h;
  const ang = Math.asin(Math.min(0.95, (h - 0.08) / 0.75 + 0.06));
  a.lift.scissor.children.forEach((arm) => {
    arm.rotation.z = ang * (arm.userData.dir as number);
    arm.position.y = (h - 0.08) / 2 + 0.02;
  });
  a.liftMech.armR.rotation.z = 0.5 + lh * 1.6;
  a.liftMech.head.rotation.z = lh * 0.35;

  // the crouched mechanic works a spanner; asked, they look up and wave, then get back to it
  const wv = smooth(0, 0.45, t - p.wave) * (1 - smooth(2.1, 2.7, t - p.wave));
  a.wrench.armR.rotation.z = 1.2 + Math.sin(t * 5.2) * 0.22 * (1 - wv);
  a.wrench.armR.rotation.x = Math.sin(t * 5.2 + 1) * 0.12 * (1 - wv);
  a.wrench.body.rotation.x = Math.sin(t * 0.6) * 0.04 - wv * 0.12;
  a.wrench.head.rotation.y = wv * 1.0;
  a.wrench.head.rotation.z = wv * 0.25;
  a.wrench.armL.rotation.z = 0.9 + wv * (1.75 + Math.sin((t - p.wave) * 9) * 0.22);
  a.wrench.armL.rotation.x = -wv * 0.5;

  // fetching: cabinet ↔ lift, with pauses, easing in and out of each step
  const wc = t % 16;
  const from = { x: -6.75, z: -8.35 };
  const to = { x: -8.25, z: -4.5 };
  const k = wc < 2 ? 0 : wc < 7 ? easeInOut((wc - 2) / 5) : wc < 10 ? 1 : wc < 15 ? 1 - easeInOut((wc - 10) / 5) : 0;
  const walking = smooth(2, 2.5, wc) * (1 - smooth(6.5, 7, wc)) + smooth(10, 10.5, wc) * (1 - smooth(14.5, 15, wc));
  a.walker.root.position.set(from.x + (to.x - from.x) * k, 0.08, from.z + (to.z - from.z) * k);
  const outward = Math.atan2(-(to.z - from.z), to.x - from.x);
  // walking: face the way they're going; standing: face the cabinet, or the bike on the lift
  face(a.walker.root, wc >= 2 && wc < 7 ? outward : wc >= 10 && wc < 15 ? outward + Math.PI : wc < 2 || wc >= 15 ? Math.PI / 2 : Math.PI, dt);
  stride(a.walker, t, walking);
  a.walker.armR.rotation.z += (1 - walking) * (1.1 + Math.sin(t * 3) * 0.15);

  // reception: a small conversation; asked, the receptionist waves
  const gr = smooth(0, 0.45, t - p.greet) * (1 - smooth(2.1, 2.7, t - p.greet));
  a.greeter.head.rotation.y = Math.sin(t * 0.7) * 0.2 * (1 - gr) + gr * 0.5;
  a.greeter.armR.rotation.z = 0.25 + Math.max(0, Math.sin(t * 1.1)) * 0.5 * (1 - gr) + gr * (2.2 + Math.sin((t - p.greet) * 8) * 0.25);
  a.customer.body.rotation.y = Math.sin(t * 0.5) * 0.06;

  // the handover: a nod as the code checks out
  a.handover.head.rotation.z = -0.2 * (bump(t - p.nod, 0.55) + bump(t - p.nod - 0.65, 0.55));

  // trees breathe in the breeze
  a.trees.forEach((tr, i) => {
    tr.rotation.z = Math.sin(t * 0.8 + i) * 0.012;
    tr.rotation.x = Math.cos(t * 0.6 + i * 1.7) * 0.01;
  });

  // riders along the roads, entering and leaving through the model's edge, riding over the road's small bumps
  for (const r of a.riders) {
    const span = 23;
    const pos = (((t * r.speed) / span + r.phase) % 1) * span - span / 2;
    const s = r.dir * pos;
    if (r.axis === 'x') {
      r.group.position.set(s * 1.13, 0.05, r.lane);
      r.group.rotation.y = r.dir > 0 ? 0 : Math.PI;
    } else {
      r.group.position.set(r.lane, 0.05, s * 0.88);
      r.group.rotation.y = r.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    }
    const edge = r.axis === 'x' ? Math.abs(r.group.position.x) - 11.8 : Math.abs(r.group.position.z) - 8.8;
    r.group.scale.setScalar(1 - smooth(0, 1.0, edge));
    r.ride.root.position.y = Math.sin(t * 7.3 + r.phase * 9) * 0.006;
    r.man.body.rotation.x = Math.sin(t * 1.3 + r.phase * 5) * 0.025;
    for (const w of r.ride.wheels) w.rotation.z -= (r.speed * dt) / 0.38;
  }

  animateTruck(a, p, t, dt);
  animateRide(a, p, t, dt);
}

const blinkAt = (t: number) => smooth(-0.35, 0.35, Math.sin(t * 6));

function animateTruck(a: Anim, p: Play, t: number, dt: number) {
  const tt = p.story === 'truck' ? truckClock(p.k) : TRUCK_HOME;
  let curve = a.pathA;
  let u = 0;
  let fade = 1;
  if (tt < 9) u = 0;
  else if (tt < 21) u = a.uStop * easeInOut((tt - 9) / 12);
  else if (tt < 27) u = a.uStop;
  else if (tt < 31) {
    u = a.uStop + (1 - a.uStop) * easeIn((tt - 27) / 4);
    fade = 1 - smooth(0.93, 1, u);
  } else {
    curve = a.pathB;
    u = easeOut((tt - 31) / 9);
    fade = smooth(0, 0.07, u);
  }
  drive(p.truck, curve, u, dt, 0, 0.012);
  a.truck.root.rotation.x = 0; // a truck sits square on its springs; only the pitch shows
  a.truck.root.scale.setScalar(Math.max(0.001, fade));
  const atCall = tt >= 20.5 && tt < 27.5;
  const blink = blinkAt(t);
  (a.truck.hazards[0].material as THREE.MeshStandardMaterial).emissiveIntensity = atCall ? blink * 3 : 0;

  // the broken-down scooter is loaded at the call, and is back in the bays' queue once the truck is home
  const loaded = tt >= 24 || tt < 5;
  const sc = (x: number) => THREE.MathUtils.clamp(x, 0, 1);
  const strandedIn = tt < 24 ? 1 - sc((tt - 23.4) / 0.6) : sc((tt - 33) / 0.8);
  a.stranded.scale.setScalar(Math.max(0.001, strandedIn));
  a.bedScooter.scale.setScalar(Math.max(0.001, loaded ? (tt >= 24 ? sc((tt - 24) / 0.6) : 1 - sc((tt - 4.4) / 0.6)) : 0));
  a.strandedHazard.emissiveIntensity = blink * 3.2 * strandedIn;

  // the call: the pin bobbing (and hopping when it's tapped), a ring spreading on the ground
  a.pin.position.y = 2.1 + Math.sin(t * 2) * 0.12 + 0.45 * bump(t - p.hop, 0.8);
  a.pin.rotation.y = t * 0.8;
  a.pin.scale.setScalar(Math.max(0.001, strandedIn));
  const rp = (t * 0.6) % 1;
  a.ring.scale.setScalar(0.6 + rp * 2.4);
  (a.ring.material as THREE.MeshBasicMaterial).opacity = (1 - rp) * 0.55 * strandedIn;

  // dispatch route: lit while the truck is on its way, a pulse running ahead of it toward the call
  const routeOn = smooth(8, 9.5, tt) * (1 - smooth(21, 23, tt));
  if (routeOn > 0 || a.routeShown) {
    const truckU = tt >= 9 && tt < 21 ? a.uStop * easeInOut((tt - 9) / 12) : 0;
    a.routeAt.forEach((r, i) => {
      const pulse = 0.55 + 0.45 * Math.max(0, Math.sin(i * 0.55 - t * 6));
      tmpS.setScalar(Math.max(0.001, routeOn * (r.u > truckU ? 1 : 0) * pulse));
      tmpM.compose(r.p, r.q, tmpS);
      a.route.setMatrixAt(i, tmpM);
    });
    a.route.instanceMatrix.needsUpdate = true;
    a.routeShown = routeOn > 0;
  }
}

/** The test ride: walk over, get on, ride out round the block, come back into the bay, get off, walk back. */
function animateRide(a: Anim, p: Play, t: number, dt: number) {
  const T = p.times;
  const k = p.story === 'ride' ? p.k : -1;
  const f = a.watcher;
  const bike = p.bike;

  /* the bike */
  let scale = 1;
  if (k < T.go || k >= T.parked) {
    // on its stand in the bay: upright while someone sits on it, the stand down otherwise
    const up = k < 0 ? 0 : k < T.go ? smooth(T.mount + 0.3, T.mount + 1.0, k) : 1 - smooth(T.parked, T.parked + 0.9, k);
    roll(bike, PARK, 0, dt, 0, 0, PARK_TILT * (1 - up));
    // engine running: the faintest shiver
    if (up > 0 && k < T.go) bike.obj.position.y += Math.sin(t * 23) * 0.0025 * smooth(T.mount + MOUNT, T.mount + MOUNT + 0.4, k);
  } else if (k < T.out) {
    const u = travel(k - T.go, T.outLen, RIDE_V, 2.4, 0) / T.outLen;
    drive(bike, a.test.out, u, dt, 0.05, 0.02);
    scale = 1 - smooth(0.95, 1, u);
  } else if (k < T.back) {
    scale = 0; // round the block, out of sight
  } else {
    const u = travel(k - T.back, T.backLen, RIDE_V, 0, 2.8) / T.backLen;
    drive(bike, a.test.back, u, dt, 0.05, 0.02);
    scale = smooth(0, 0.05, u);
  }
  bike.obj.scale.setScalar(Math.max(0.001, scale));

  /* the mechanic: at the balancer, walking to the bike, riding it, walking back */
  const riding = k >= T.mount && k < T.off;
  if (riding !== p.mounted) {
    p.mounted = riding;
    if (riding) a.test.bike.root.add(f.root);
    else {
      a.live.add(f.root);
      f.root.rotation.set(0, Math.PI / 2, 0);
      f.body.rotation.z = 0;
    }
  }
  if (riding) {
    const on = k < T.mount + MOUNT ? easeInOut((k - T.mount) / MOUNT) : k > T.off - MOUNT ? easeInOut((T.off - k) / MOUNT) : 1;
    f.root.position.lerpVectors(BESIDE, SEAT, on);
    f.root.position.y = Math.sin(Math.PI * on) * 0.12; // a small hop up onto the saddle
    f.root.rotation.set(0, (Math.PI / 2) * (1 - on), 0);
    seat(f, on, 0.5, 0);
    f.head.rotation.y = 0;
    f.body.rotation.x = Math.sin(t * 1.6) * 0.02 * on;
  } else {
    const going = k >= 0 && k < T.mount;
    const coming = k >= T.off && k < T.home;
    if (going || coming) {
      const q = going ? k / WALK : (k - T.off) / WALK;
      const yaw = along(going ? WALK_PATH : WALK_BACK, easeInOut(clamp01(q)), f.root.position);
      face(f.root, q > 0.94 ? Math.PI / 2 : yaw, dt);
      stride(f, t, smooth(0, 0.08, q) * (1 - smooth(0.9, 1, q)));
      f.armL.rotation.z += 0.5 * (1 - smooth(0, 0.08, q) * (1 - smooth(0.9, 1, q)));
      f.head.rotation.y = 0;
    } else {
      // at the balancer, glancing at the readout
      f.root.position.copy(WATCH);
      face(f.root, Math.PI / 2, dt);
      stride(f, t, 0);
      f.armL.rotation.z = 0.5;
      f.head.rotation.y = Math.sin(t * 0.45) * 0.35;
    }
  }

  // the balancer runs while its mechanic is there to watch it: spins up, runs, slows to a stop
  const home = k < 0 || k >= T.home;
  const bc = t % 9;
  p.spin.to = home ? (bc < 1 ? bc * 14 : bc < 5 ? 14 : bc < 7 ? 14 * (1 - (bc - 5) / 2) : 0) : 0;
  if (dt > 0) a.spin.rotation.z -= p.spin.step(dt) * dt;
}

/* ── Spots: the places that answer the pointer ── */

interface Spot {
  id: SpotId;
  /** when boxes overlap, the higher rank wins: a vehicle over the zone it stands in */
  rank: number;
  box: THREE.Box3;
  anchor: THREE.Vector3;
  focus: THREE.Vector3 | null;
  halo: THREE.Group;
  fill: THREE.MeshBasicMaterial;
  line: THREE.MeshBasicMaterial;
  glow: Spring;
  on: boolean;
}

function roundedRect(w: number, d: number, r: number, path: THREE.Path = new THREE.Shape()) {
  const x = -w / 2;
  const y = -d / 2;
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + d - r);
  path.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  path.lineTo(x + r, y + d);
  path.quadraticCurveTo(x, y + d, x, y + d - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
  return path;
}

/** A soft outline on the ground: a faint fill and a crisp rounded edge, built once per spot. */
function halo(parent: THREE.Object3D, w: number, d: number) {
  const r = Math.min(0.4, Math.min(w, d) * 0.22);
  const edge = 0.06;
  const outline = roundedRect(w, d, r) as THREE.Shape;
  outline.holes.push(roundedRect(w - 2 * edge, d - 2 * edge, Math.max(0.02, r - edge), new THREE.Path()));
  const make = () =>
    new THREE.MeshBasicMaterial({ color: M.C.accent, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, toneMapped: false });
  const fill = make();
  const line = make();
  const g = new THREE.Group();
  const a = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(w, d, r) as THREE.Shape, 6).rotateX(-Math.PI / 2), fill);
  const b = new THREE.Mesh(new THREE.ShapeGeometry(outline, 6).rotateX(-Math.PI / 2), line);
  a.renderOrder = b.renderOrder = 2;
  g.add(a, b);
  g.visible = false;
  parent.add(g);
  return { g, fill, line };
}

function makeSpots(scene: THREE.Scene): Spot[] {
  const spots: Spot[] = [];
  const add = (id: SpotId, rank: number, cx: number, cz: number, w: number, d: number, top: number, y: number, anchorY: number, focus = true) => {
    const { g, fill, line } = halo(scene, w, d);
    g.position.set(cx, y, cz);
    spots.push({
      id,
      rank,
      box: new THREE.Box3(new THREE.Vector3(cx - w / 2, 0, cz - d / 2), new THREE.Vector3(cx + w / 2, top, cz + d / 2)),
      anchor: new THREE.Vector3(cx, anchorY, cz),
      focus: focus ? new THREE.Vector3(cx, 0, cz) : null,
      halo: g,
      fill,
      line,
      glow: new Spring(0, 0.22),
      on: true,
    });
  };
  BAYS.forEach((x, i) => add(`bay${i + 1}` as SpotId, 2, i === 2 ? x + 0.25 : x, -5.85, i === 2 ? 4.3 : 3.8, 5.7, 3.1, 0.09, 3.3));
  add('reception', 2, 5.0, -7.0, 4.8, 4.8, 2.8, 0.12, 3.0);
  add('pickup', 1, -2.5, 1.5, 8.0, 4.4, 0.3, 0.08, 0.3);
  add('handover', 3, 0.65, 2.85, 2.2, 1.8, 1.8, 0.08, 2.0);
  add('roadside', 3, 12.45, -5.3, 2.1, 3.0, 3.2, 0.06, 3.4);
  for (let i = 0; i < 4; i++) add(`parked${i}` as SpotId, 3, -11.8 + i * 1.2, 2.3, 0.85, 2.3, 1.4, 0.08, 1.7, false);
  // moving spots: their box, anchor and outline follow the vehicle each frame
  add('truck', 4, 0, 0, 3.8, 1.75, 2.0, 0.07, 2.4, false);
  add('ride', 4, 0, 0, 2.3, 0.85, 1.7, 0.07, 2.0, false);
  return spots;
}

/** Keep a moving spot on its vehicle: box around it, outline under it turned with it, label above it. */
function follow(s: Spot, o: THREE.Object3D, len: number, wid: number, top: number, on: boolean) {
  const h = o.rotation.y;
  const hx = Math.abs(Math.cos(h)) * len + Math.abs(Math.sin(h)) * wid;
  const hz = Math.abs(Math.sin(h)) * len + Math.abs(Math.cos(h)) * wid;
  s.box.min.set(o.position.x - hx, 0, o.position.z - hz);
  s.box.max.set(o.position.x + hx, top, o.position.z + hz);
  s.halo.position.set(o.position.x, s.halo.position.y, o.position.z);
  s.halo.rotation.y = h;
  s.anchor.set(o.position.x, s.anchor.y, o.position.z);
  s.on = on;
}

/* ── The world ── */

/** Hand the main thread back between the expensive steps of building the world, so scrolling never stalls on it. */
const breathe = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Builds the world in steps, each a short task: the renderer and its environment, the painted textures, the model,
 * and the shader programs, which compile on the driver's own threads (compileAsync) instead of blocking the page.
 */
export function createMiniWorld(canvas: HTMLCanvasElement, opts: WorldOptions): Promise<MiniWorld | null> {
  // one build at a time: they share the seeded grain and the material cache
  const run = building.then(() => buildMiniWorld(canvas, opts));
  building = run.catch(() => null);
  return run;
}
let building: Promise<unknown> = Promise.resolve();

async function buildMiniWorld(canvas: HTMLCanvasElement, opts: WorldOptions): Promise<MiniWorld | null> {
  if (opts.cancelled?.()) return null;
  let renderer: THREE.WebGLRenderer;
  try {
    // Transparent: the page shows through around the model, so there is never a seam with the section behind it
    renderer = new THREE.WebGLRenderer({ canvas, antialias: opts.tier === 'low', alpha: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  const high = opts.tier === 'high';
  // 1.5x is sharp enough for a miniature and keeps the page itself at full frame rate
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  // Reading back every program's log forces each compile to finish on the spot; only worth it while developing
  renderer.debug.checkShaderErrors = import.meta.env.DEV;

  await breathe();
  if (opts.cancelled?.()) {
    renderer.dispose();
    return null;
  }
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  pmrem.dispose();

  // a build nobody wants any more stops at the next step and gives back what it made
  const abandon = (tex?: Textures) => {
    if (tex) Object.values(tex).forEach((t) => t.dispose());
    env.dispose();
    renderer.dispose();
    return null;
  };
  await breathe();
  if (opts.cancelled?.()) return abandon();
  const tex = await makeTextures(breathe);
  await breathe();
  if (opts.cancelled?.()) return abandon(tex);
  const anim = await buildWorld(tex, breathe);
  await breathe();
  // Everything that never moves becomes a handful of merged meshes
  scene.add(await bake(anim.statics, breathe), anim.live);
  anim.statics.clear();
  await breathe();
  // and inside what moves, the parts that move together are drawn together; the lift's scissor arms each turn alone
  mergeStatic(anim.live, (o) => o.userData.dir !== undefined);
  await breathe();
  const play = makePlay(anim);
  const spots = makeSpots(scene);
  const spotOf = (id: SpotId) => spots.find((s) => s.id === id)!;
  const truckSpot = spotOf('truck');
  const rideSpot = spotOf('ride');

  const hemi = new THREE.HemisphereLight('#eef2fb', '#c9b9a0', 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff1dc', 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -20;
  sc.right = 20;
  sc.top = 20;
  sc.bottom = -20;
  sc.near = 1;
  sc.far = 90;
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.025;
  scene.add(sun, sun.target);

  /* camera */
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  const BASE_AZ = THREE.MathUtils.degToRad(42);
  const BASE_EL = THREE.MathUtils.degToRad(33);
  const BASE = new THREE.Vector3(0, -0.4, 0.4);
  const target = BASE.clone();
  let width = 1;
  let height = 1;
  let half = 10;

  const place = (az: number, el: number) => {
    camera.position.set(target.x + Math.cos(el) * Math.sin(az) * 120, target.y + Math.sin(el) * 120, target.z + Math.cos(el) * Math.cos(az) * 120);
    camera.lookAt(target);
  };

  // Fit the whole plinth into the frame (with room for the parallax), whatever the stage's shape
  const fit = () => {
    target.copy(BASE);
    place(BASE_AZ, BASE_EL);
    camera.updateMatrixWorld();
    const inv = camera.matrixWorldInverse;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const c = new THREE.Vector3();
    for (const x of [-PW / 2 - 0.4, PW / 2 + 0.4])
      // a little below the plinth too, for its shadow on the page
      for (const y of [-3.0, 3.9])
        for (const z of [-PD / 2 - 0.4, PD / 2 + 0.4]) {
          c.set(x, y, z).applyMatrix4(inv);
          minX = Math.min(minX, c.x);
          maxX = Math.max(maxX, c.x);
          minY = Math.min(minY, c.y);
          maxY = Math.max(maxY, c.y);
        }
    const aspect = width / height;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const hw = ((maxX - minX) / 2) * 1.06;
    const hh = ((maxY - minY) / 2) * 1.06;
    half = Math.max(hh, hw / aspect);
    camera.left = cx - half * aspect;
    camera.right = cx + half * aspect;
    camera.top = cy + half;
    camera.bottom = cy - half;
    camera.updateProjectionMatrix();
  };

  /* The camera's moves, each on a spring so nothing jumps: the pointer's lean (a few degrees at most), the lean
     toward a selected spot (a third of the way, a little closer), and the scroll: it turns into place as the
     section arrives and eases on a touch as it leaves. The isometric angle stays recognisable throughout. */
  const cam = {
    lookX: new Spring(0, 0.45),
    lookY: new Spring(0, 0.45),
    fx: new Spring(0, 0.7),
    fz: new Spring(0, 0.7),
    zoom: new Spring(1, 0.7),
    scroll: new Spring(opts.still ? 0.5 : 0, 0.35),
  };
  const pose = () => {
    const p = cam.scroll.x;
    const arrive = 1 - smooth(0, 0.45, p);
    const leave = smooth(0.6, 1, p);
    target.set(BASE.x + cam.fx.x, BASE.y, BASE.z + cam.fz.x);
    const az = BASE_AZ + THREE.MathUtils.degToRad(arrive * 14 - leave * 3 + cam.lookX.x * 3.5 + (opts.still ? 0 : Math.sin(time * 0.07) * 1.2));
    const el = BASE_EL + THREE.MathUtils.degToRad(arrive * 5 - leave * 1.5 - cam.lookY.x * 2);
    place(az, el);
    camera.zoom = cam.zoom.x * (1 - 0.12 * arrive);
    camera.updateProjectionMatrix();
  };

  /* render pipeline */
  let composer: EffectComposer | null = null;
  let gtao: GTAOPass | null = null;
  if (high) {
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    gtao = new GTAOPass(scene, camera, 1, 1);
    // Ambient occlusion is soft by nature: compute it at half resolution and let the blend upsample it
    const fullSize = gtao.setSize.bind(gtao);
    gtao.setSize = (w: number, h: number) => fullSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    gtao.blendIntensity = 0.85;
    gtao.updateGtaoMaterial({ radius: 0.7, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: 16, distanceFallOff: 1 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 16 });
    composer.addPass(gtao);
    composer.addPass(new OutputPass());
  }

  let drawMs = 0;
  let frames = 0;
  renderer.info.autoReset = false;
  const draw = () => {
    const t0 = performance.now();
    renderer.info.reset();
    // shadows follow the moving pieces at half the frame rate on the smooth tier: a lag nobody can see, a third
    // less drawing each frame
    renderer.shadowMap.needsUpdate = !running || frameMs > 20 || frames++ % 2 === 0;
    if (composer) composer.render();
    else renderer.render(scene, camera);
    drawMs += (performance.now() - t0 - drawMs) * 0.1;
  };

  /* theme: daylight or dusk with the lamps on */
  let dark = opts.dark;
  const applyTheme = () => {
    hemi.color.set(dark ? '#4a5888' : '#eef2fb');
    hemi.groundColor.set(dark ? '#1c1814' : '#c9b9a0');
    hemi.intensity = dark ? 0.8 : 1.15;
    sun.color.set(dark ? '#9fb0ff' : '#fff1dc');
    sun.intensity = dark ? 0.9 : 3.0;
    sun.position.set(dark ? 14 : -11, dark ? 20 : 24, dark ? 9 : 15);
    scene.environmentIntensity = dark ? 0.14 : 0.42;
    renderer.toneMappingExposure = dark ? 1.08 : 1.0;
    M.L.bulb().emissiveIntensity = dark ? 4 : 0;
    M.L.head().emissiveIntensity = dark ? 2.2 : 0.15;
    M.L.screen().emissiveIntensity = dark ? 1.2 : 0.5;
    anim.lamps.forEach((l) => (l.intensity = dark ? (l.userData.power as number) : 0));
    for (const s of spots) {
      s.fill.color.set(dark ? '#8f99ff' : M.C.accent);
      s.line.color.set(dark ? '#a9b1ff' : M.C.accent);
    }
  };
  applyTheme();

  /* what the pointer is over, what was clicked */
  let hover: SpotId | null = null;
  let selected: SpotId | null = null;
  let pointerIn = false;
  const pointer = new THREE.Vector2();
  const ray = new THREE.Raycaster();
  const hit = new THREE.Vector3();
  const ground = new THREE.Vector3();
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.08);
  // A ray against a dozen boxes, only when the pointer moves or the view does. Tall boxes overlap along the line
  // of sight, so between equals the one whose floor the pointer is over wins, then the nearest.
  const pick = (x: number, y: number): SpotId | null => {
    pointer.set(x, -y);
    ray.setFromCamera(pointer, camera);
    const onFloor = ray.ray.intersectPlane(floor, ground) !== null;
    let best: Spot | null = null;
    let bestScore = -1;
    let bestD = Infinity;
    for (const s of spots) {
      if (!s.on || !ray.ray.intersectBox(s.box, hit)) continue;
      const under = onFloor && ground.x >= s.box.min.x && ground.x <= s.box.max.x && ground.z >= s.box.min.z && ground.z <= s.box.max.z;
      const score = s.rank * 2 + (under ? 1 : 0);
      const d = hit.distanceToSquared(ray.ray.origin);
      if (score > bestScore || (score === bestScore && d < bestD)) {
        best = s;
        bestScore = score;
        bestD = d;
      }
    }
    return best ? best.id : null;
  };
  const pointerAt = { x: 0, y: 0 };

  /* lights: each bay's pendant warms when its bay is pointed at, opened, or a vehicle rolls in */
  const bayGlow = BAYS.map(() => new Spring(0, 0.5));
  const recGlow = new Spring(0, 0.5);
  const lights = (dt: number) => {
    const T = play.times;
    const k = play.story === 'ride' ? play.k : -1;
    const want = (id: SpotId) => Math.max(hover === id ? 0.45 : 0, selected === id ? 1 : 0);
    bayGlow[0].to = Math.max(want('bay1'), 0.3 * liftHeight(play.lift));
    bayGlow[1].to = want('bay2');
    // bay 3 lights up as the bike comes back in, and dims a few seconds after it's parked
    bayGlow[2].to = Math.max(want('bay3'), smooth(T.parked - 3.5, T.parked - 0.5, k) * (1 - smooth(T.parked + 3.5, T.parked + 6, k)));
    recGlow.to = Math.max(want('reception'), 0.8 * bump(time - play.greet, 2.7));
    bayGlow.forEach((g, i) => {
      if (dt > 0) g.step(dt);
      else g.snap();
      anim.lamps[i].intensity = (dark ? (anim.lamps[i].userData.power as number) : 0) + g.x * (dark ? 10 : 8);
      anim.bayBulbs[i].emissiveIntensity = (dark ? 4 : 0) + g.x * (dark ? 2 : 2.4);
    });
    if (dt > 0) recGlow.step(dt);
    else recGlow.snap();
    const rec = anim.lamps[anim.lamps.length - 1];
    rec.intensity = (dark ? (rec.userData.power as number) : 0) + recGlow.x * 6;
    // lights that chirp, two soft blinks, as a scooter does when its owner finds it
    const head = dark ? 2.2 : 0.15;
    for (const c of anim.chirps) {
      const b = bump(time - c.at, 0.45) + bump(time - c.at - 0.55, 0.45);
      c.head.emissiveIntensity = head + 2.6 * b;
      if (c.hazard) c.hazard.emissiveIntensity = 3 * b;
    }
    // the test bike's headlight is on while it's ridden
    const lit = k < 0 ? 0 : smooth(T.mount + MOUNT, T.mount + MOUNT + 0.5, k) * (1 - smooth(T.parked + 0.3, T.parked + 0.9, k));
    anim.test.head.emissiveIntensity = head + (Math.max(head, 1.8) - head) * lit;
  };

  /* outlines on the ground under what is pointed at or open */
  const halos = (dt: number) => {
    const T = play.times;
    const k = play.story === 'ride' ? play.k : -1;
    follow(truckSpot, anim.truck.root, 1.9, 0.9, 2.0, anim.truck.root.scale.x > 0.6);
    follow(rideSpot, anim.test.bike.root, 1.15, 0.42, 1.7, k >= T.go && k < T.parked && anim.test.bike.root.scale.x > 0.6);
    spotOf('roadside').on = anim.stranded.scale.x > 0.6;
    for (const s of spots) {
      s.glow.to = s.on ? (selected === s.id ? 1 : hover === s.id ? 0.6 : 0) : 0;
      if (dt > 0) s.glow.step(dt);
      else s.glow.snap();
      s.line.opacity = 0.85 * s.glow.x;
      s.fill.opacity = 0.11 * s.glow.x;
      s.halo.visible = s.glow.x > 0.004;
    }
    // something that drives off the model can't stay open
    if (selected && !spotOf(selected).on) select(null);
    if (hover && !spotOf(hover).on) hover = null;
  };

  /* where things are in the story, for the label */
  const noteFor = (id: SpotId): SpotNote => {
    const truckQueued = play.queue.includes('truck');
    const tt = play.story === 'truck' ? truckClock(play.k) : TRUCK_HOME;
    const truckOut = play.story === 'truck' && play.k < 32;
    if (id === 'truck') return truckOut ? (tt < 20.5 ? 'out' : tt < 27.5 ? 'call' : 'back') : truckQueued ? 'queued' : null;
    if (id === 'pickup') return truckOut ? 'out' : truckQueued ? 'queued' : null;
    if (id === 'roadside') return play.story === 'truck' && tt < 24 ? 'coming' : truckQueued ? 'queued' : null;
    if (id === 'bay3') {
      const k = play.story === 'ride' ? play.k : -1;
      return k >= play.times.go && k < play.times.parked ? 'away' : play.queue.includes('ride') ? 'queued' : null;
    }
    return null;
  };

  /* the label: content through onSpot (only when it changes), position written straight to the element */
  let shownKey = '';
  let tipX = -1;
  let tipY = -1;
  const tipAt = () => {
    const id = selected ?? hover;
    const note = id ? noteFor(id) : null;
    const key = id ? `${id}|${note}|${selected === id}` : '';
    if (key !== shownKey) {
      shownKey = key;
      opts.onSpot?.(id ? { id, note, open: selected === id } : null);
    }
    const el = opts.tip;
    if (!el || !id) return;
    tmpV.copy(spotOf(id).anchor).project(camera);
    const x = (tmpV.x * 0.5 + 0.5) * width;
    const y = (0.5 - tmpV.y * 0.5) * height;
    if (Math.abs(x - tipX) < 0.25 && Math.abs(y - tipY) < 0.25) return;
    tipX = x;
    tipY = y;
    // keep the card inside the stage; the dot stays on the spot
    const m = Math.min(140, width / 2);
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    el.style.setProperty('--shift', `${(THREE.MathUtils.clamp(x, m, width - m) - x).toFixed(1)}px`);
    el.dataset.below = y < 150 ? 'true' : 'false';
  };

  /* what a click does: each spot shows a little of its story */
  const act = (id: SpotId) => {
    if (opts.still) return;
    if (id === 'bay1') raiseLift(play);
    else if (id === 'bay2') play.wave = time;
    else if (id === 'bay3') request(play, 'ride');
    else if (id === 'reception') play.greet = time;
    else if (id === 'pickup' || id === 'truck') request(play, 'truck');
    else if (id === 'roadside') {
      play.hop = time;
      request(play, 'truck');
    } else if (id === 'handover') {
      play.nod = time;
      anim.chirps[0].at = time;
    } else if (id.startsWith('parked')) anim.chirps[1 + Number(id.slice(6))].at = time;
  };
  const select = (id: SpotId | null) => {
    selected = id;
    if (id) act(id);
    const f = id ? spotOf(id).focus : null;
    cam.fx.to = f ? (f.x - BASE.x) * 0.32 : 0;
    cam.fz.to = f ? (f.z - BASE.z) * 0.32 : 0;
    cam.zoom.to = f ? 1.16 : 1;
    if (!running) renderStill();
  };

  /* loop */
  let raf = 0;
  let running = false;
  let last = 0;
  let lastDraw = 0;
  let lastTick = 0;
  let time = 6;
  let fps = 0;
  // smooth motion on capable machines, a steady 30 everywhere else; if 60 costs the page its own frames, 30 it is
  let frameMs = high ? 1000 / 60 - 2 : 1000 / 30 - 2;
  let paced = 16.7;
  let slow = 0;
  // when the page missed a frame lately (skipping the first moments after starting, while everything settles in)
  const misses: number[] = [];
  let startedAt = 0;

  const step = (dt: number) => {
    time += dt;
    animate(anim, play, time, dt);
    if (pointerIn) {
      const h = pick(pointerAt.x, pointerAt.y);
      if (h !== hover) {
        hover = h;
        canvas.style.cursor = h ? 'pointer' : '';
      }
    }
    halos(dt);
    lights(dt);
    cam.lookX.step(dt);
    cam.lookY.step(dt);
    cam.fx.step(dt);
    cam.fz.step(dt);
    cam.zoom.step(dt);
    cam.scroll.step(dt);
    pose();
    tipAt();
  };

  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    if (frameMs < 20 && lastTick) {
      const gap = now - lastTick;
      paced += (Math.min(100, gap) - paced) * 0.05;
      slow = paced > 21 ? slow + 1 : 0;
      // the average can look fine while frames keep dropping in spikes: six missed frames in two seconds count too
      if (gap > 25 && gap < 250 && now - startedAt > 1500) {
        misses.push(now);
        while (misses[0] < now - 2000) misses.shift();
      }
      if (slow > 90 || misses.length >= 6) frameMs = 1000 / 30 - 2;
    }
    lastTick = now;
    if (now - lastDraw < frameMs) return;
    const dt = Math.min((now - (last || now)) / 1000, 0.1);
    if (dt > 0) fps += (1 / dt - fps) * 0.05;
    last = now;
    lastDraw = now;
    step(dt);
    draw();
  };

  // A frame without time passing: the current state as it stands, every spring at rest
  const renderStill = () => {
    animate(anim, play, time, 0);
    halos(0);
    lights(0);
    for (const s of Object.values(cam)) s.snap();
    pose();
    tipX = tipY = -1;
    tipAt();
    draw();
  };

  const handle: MiniWorld = {
    resize(w, h) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      renderer.setSize(width, height, false);
      composer?.setSize(width, height);
      composer?.setPixelRatio(renderer.getPixelRatio());
      fit();
      tipX = -1;
      if (!running) renderStill();
    },
    setTheme(d) {
      dark = d;
      applyTheme();
      if (!running) renderStill();
    },
    setPointer(x, y, inside) {
      pointerIn = inside;
      pointerAt.x = x;
      pointerAt.y = y;
      if (!opts.still) {
        cam.lookX.to = inside ? x : 0;
        cam.lookY.to = inside ? y : 0;
      }
      if (!inside && hover) {
        hover = null;
        canvas.style.cursor = '';
      }
      // nothing runs under reduced motion, so answer the pointer here
      if (!running) {
        const h = inside ? pick(x, y) : null;
        if (h !== hover) {
          hover = h;
          canvas.style.cursor = h ? 'pointer' : '';
          renderStill();
        }
      }
    },
    setScroll(p) {
      if (opts.still) return;
      cam.scroll.to = p;
      if (!running) {
        cam.scroll.snap(p);
        renderStill();
      }
    },
    click(x, y) {
      const id = pick(x, y);
      select(id && id !== selected ? id : null);
    },
    select(id) {
      select(id);
    },
    start() {
      if (opts.still || running) return;
      running = true;
      last = 0;
      lastTick = 0;
      startedAt = performance.now();
      misses.length = 0;
      raf = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    renderOnce() {
      if (!running) renderStill();
    },
    snapshot(type = 'image/webp', quality = 0.9) {
      const s = cam.scroll.x;
      cam.scroll.snap(0.5);
      cam.lookX.snap(0);
      cam.lookY.snap(0);
      renderStill();
      const url = renderer.domElement.toDataURL(type, quality);
      cam.scroll.snap(s);
      return url;
    },
    where(id) {
      const s = spotOf(id);
      tmpV.copy(s.halo.position).project(camera);
      return { x: Math.round((tmpV.x * 0.5 + 0.5) * width), y: Math.round((0.5 - tmpV.y * 0.5) * height), on: s.on };
    },
    stats() {
      const r = renderer.info.render;
      return { calls: r.calls, triangles: r.triangles, frameMs: +drawMs.toFixed(2), fps: Math.round(fps), cap: Math.round(1000 / (frameMs + 2)), story: play.story, k: +play.k.toFixed(2), selected, hover };
    },
    dispose() {
      handle.stop();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          const m = mesh.material as THREE.MeshStandardMaterial;
          m.map?.dispose();
          m.dispose();
        }
      });
      Object.values(tex).forEach((t) => t.dispose());
      env.dispose();
      clearMaterials();
      clearGeometry();
      composer?.dispose();
      gtao?.dispose();
      renderer.dispose();
    },
  };
  // Compile every material the scene uses before its first frame, off the main thread where the driver allows it,
  // for the target the scene actually draws into (the composer's buffer on the smooth tier)
  await breathe();
  fit();
  if (composer) renderer.setRenderTarget(composer.readBuffer);
  try {
    await renderer.compileAsync(scene, camera);
    // the ambient occlusion pass's own materials too, which would otherwise compile in the middle of the first frame
    if (gtao) {
      const warm = new THREE.Scene();
      const quad = new THREE.PlaneGeometry(2, 2);
      for (const v of Object.values(gtao)) if ((v as THREE.Material)?.isMaterial) warm.add(new THREE.Mesh(quad, v as THREE.Material));
      await renderer.compileAsync(warm, camera);
      quad.dispose();
    }
  } finally {
    renderer.setRenderTarget(null);
  }
  return handle;
}

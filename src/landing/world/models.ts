// The miniature's cast and props, built from primitives at model scale (1 unit ≈ 1 m).
// Vehicles and people face +x. Anything the animation moves is returned as a handle.

import * as THREE from 'three';
import { ball, box, capsule, cyl, mat, tyre } from './kit';

export const C = {
  accent: '#5865f2',
  rubber: '#1d1e21',
  steel: '#8b9099',
  chrome: '#d3d6db',
  black: '#26272b',
  white: '#f4f2ee',
  glass: '#2b3442',
  red: '#c8453b',
  skin: ['#e5bb94', '#b98057', '#d29f77', '#8f5d3e'],
  hair: ['#2b2420', '#4a3426', '#1d1b1a'],
};

/** Materials that light up, shared so the theme can switch them all at once. */
export const L = {
  bulb: () => mat('#fff4dc', { emissive: '#ffd9a0', glow: 0 }),
  head: () => mat('#fff7e0', { emissive: '#ffe7b0', glow: 0, rough: 0.2 }),
  tail: () => mat('#7a1712', { emissive: '#ff3b2f', glow: 0.6 }),
  hazard: () => mat('#a8621a', { emissive: '#ffae2e', glow: 0 }),
  truckHazard: () => mat('#a8621b', { emissive: '#ffae2e', glow: 0 }),
  screen: () => mat('#1f2a3a', { emissive: '#7cb8ff', glow: 0.7, rough: 0.2 }),
};

/** A box centred on its middle, for parts that turn about their centre. */
const centred = new Map<string, THREE.BoxGeometry>();
function cbox(parent: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, rz = 0) {
  const k = `${w},${h},${d}`;
  let g = centred.get(k);
  if (!g) centred.set(k, (g = new THREE.BoxGeometry(w, h, d)));
  const mesh = new THREE.Mesh(g, m);
  mesh.rotation.z = rz;
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Mark a model as never moving, so the bake can merge it. */
export function still<T extends THREE.Object3D | { root: THREE.Object3D }>(o: T): T {
  const obj: THREE.Object3D = o instanceof THREE.Object3D ? o : o.root;
  obj.traverse((c) => (c.userData.keep = false));
  return o;
}
const live = (o: THREE.Object3D) => o.traverse((c) => (c.userData.keep = true));

/* ── People ── */

export interface Figure {
  root: THREE.Group;
  body: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  head: THREE.Group;
}

export interface Dress {
  shirt: string;
  legs: string;
  skin?: number;
  hair?: number;
  cap?: string;
}

export const WORKWEAR: Dress = { shirt: '#3c4c74', legs: '#2c3550', cap: C.accent };

export function figure(d: Dress): Figure {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const skin = mat(C.skin[d.skin ?? 0], { rough: 0.7 });
  const legs = mat(d.legs, { rough: 0.85 });
  const shirt = mat(d.shirt, { rough: 0.85 });
  const shoe = mat('#2a2522', { rough: 0.6 });

  const leg = (z: number) => {
    const g = new THREE.Group();
    g.position.set(0, 0.82, z);
    capsule(g, 0.085, 0.8, legs, 0, -0.8, 0);
    box(g, 0.2, 0.08, 0.13, shoe, 0.04, -0.82, 0, 0.03);
    body.add(g);
    return g;
  };
  const legL = leg(0.1);
  const legR = leg(-0.1);
  capsule(body, 0.19, 0.64, shirt, 0, 0.74, 0).scale.set(0.8, 1, 1.05);
  const arm = (z: number) => {
    const g = new THREE.Group();
    g.position.set(0, 1.28, z);
    capsule(g, 0.062, 0.56, shirt, 0, -0.56, 0);
    ball(g, 0.06, skin, 0, -0.56, 0, 10);
    body.add(g);
    return g;
  };
  const armL = arm(0.24);
  const armR = arm(-0.24);
  const head = new THREE.Group();
  head.position.set(0, 1.4, 0);
  ball(head, 0.065, skin, 0, 0.0, 0, 8);
  ball(head, 0.135, skin, 0, 0.16, 0, 16);
  const hair = ball(head, 0.142, mat(C.hair[d.hair ?? 0], { rough: 0.9 }), -0.025, 0.2, 0, 14);
  hair.scale.set(1, 0.72, 1);
  if (d.cap) {
    const cap = mat(d.cap, { rough: 0.6 });
    ball(head, 0.146, cap, -0.005, 0.22, 0, 14).scale.set(1, 0.62, 1);
    box(head, 0.15, 0.02, 0.2, cap, 0.12, 0.2, 0, 0.01);
  }
  body.add(head);
  live(root);
  return { root, body, armL, armR, legL, legR, head };
}

/** Sit a figure on a saddle at `h`: thighs forward, hands out to the bars. */
export function sit(f: Figure, h: number, reach = 1.0) {
  f.body.position.y = h - 0.84;
  f.legL.rotation.z = f.legR.rotation.z = 1.35;
  f.armL.rotation.z = f.armR.rotation.z = reach;
  f.body.rotation.z = -0.14;
}

/** Crouch beside work: knees folded, arms forward. */
export function crouch(f: Figure) {
  f.body.position.y = -0.42;
  f.legL.rotation.z = f.legR.rotation.z = 1.2;
  f.armL.rotation.z = 0.9;
  f.armR.rotation.z = 1.2;
  f.body.rotation.z = -0.3;
}

/* ── Two-wheelers ── */

export interface Ride {
  root: THREE.Group;
  wheels: THREE.Object3D[];
  head: THREE.Mesh;
  hazards: THREE.Mesh[];
}

function wheel(parent: THREE.Group, r: number, tube: number, x: number, rim: THREE.Material, spokes = 6) {
  const g = new THREE.Group();
  g.position.set(x, r + tube, 0);
  tyre(g, r, tube, mat(C.rubber, { rough: 0.62 }), 0, 0, 0);
  const hub = cyl(g, 0.06, 0.06, 0.12, rim, 0, 0, 0, 12);
  hub.rotation.x = Math.PI / 2;
  for (let i = 0; i < spokes / 2; i++) cbox(g, 0.03, r * 2 - 0.02, 0.025, rim, (i / (spokes / 2)) * Math.PI);
  parent.add(g);
  return g;
}

export function motorcycle(color: string): Ride {
  const root = new THREE.Group();
  const paint = mat(color, { rough: 0.3, metal: 0.25 });
  const chrome = mat(C.chrome, { rough: 0.22, metal: 0.9 });
  const dark = mat(C.black, { rough: 0.55, metal: 0.2 });
  const engine = mat('#4b4f57', { rough: 0.45, metal: 0.65 });
  const wf = wheel(root, 0.3, 0.085, 0.74, chrome);
  const wr = wheel(root, 0.3, 0.085, -0.72, chrome);
  box(root, 0.5, 0.34, 0.26, engine, 0.02, 0.4, 0, 0.05);
  for (let i = 0; i < 3; i++) box(root, 0.44, 0.02, 0.28, engine, 0.02, 0.48 + i * 0.07, 0);
  box(root, 0.56, 0.26, 0.34, paint, 0.2, 0.84, 0, 0.11);
  box(root, 0.62, 0.09, 0.28, dark, -0.34, 0.86, 0, 0.04);
  box(root, 0.4, 0.07, 0.2, paint, -0.8, 0.84, 0, 0.03);
  for (const z of [0.1, -0.1]) {
    const rail = cbox(root, 0.95, 0.05, 0.05, dark, -0.33);
    rail.position.set(-0.35, 0.66, z);
  }
  const ex = cyl(root, 0.05, 0.06, 0.66, chrome, -0.22, 0.38, 0.18, 12);
  ex.rotation.z = Math.PI / 2 - 0.1;
  for (const z of [0.1, -0.1]) {
    const fork = cbox(root, 0.04, 0.82, 0.04, chrome, 0.38);
    fork.position.set(0.6, 0.76, z);
  }
  const bar = cyl(root, 0.022, 0.022, 0.66, dark, 0.48, 1.14, -0.33, 8);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(0.48, 1.14, -0.33);
  const head = ball(root, 0.09, L.head(), 0.66, 1.02, 0, 12);
  box(root, 0.04, 0.05, 0.12, L.tail(), -1.0, 0.84, 0);
  live(root);
  return { root, wheels: [wf, wr], head, hazards: [] };
}

export function scooter(color: string): Ride {
  const root = new THREE.Group();
  const paint = mat(color, { rough: 0.28, metal: 0.15 });
  const chrome = mat(C.chrome, { rough: 0.25, metal: 0.85 });
  const dark = mat(C.black, { rough: 0.6 });
  const wf = wheel(root, 0.2, 0.075, 0.6, chrome, 4);
  const wr = wheel(root, 0.2, 0.075, -0.56, chrome, 4);
  box(root, 0.8, 0.07, 0.3, dark, 0.02, 0.3, 0, 0.02);
  box(root, 0.76, 0.4, 0.38, paint, -0.38, 0.34, 0, 0.15);
  box(root, 0.62, 0.09, 0.3, mat('#3a2e28', { rough: 0.7 }), -0.36, 0.74, 0, 0.04);
  const shield = cbox(root, 0.13, 0.66, 0.38, paint, -0.2);
  shield.position.set(0.5, 0.66, 0);
  const stem = cbox(root, 0.06, 0.42, 0.06, dark, -0.22);
  stem.position.set(0.56, 1.08, 0);
  box(root, 0.18, 0.12, 0.52, paint, 0.5, 1.22, 0, 0.05);
  const head = ball(root, 0.065, L.head(), 0.6, 1.28, 0, 10);
  const hazards = [0.27, -0.27].map((z) => ball(root, 0.04, L.hazard(), 0.56, 1.24, z, 8));
  box(root, 0.04, 0.05, 0.14, L.tail(), -0.78, 0.6, 0);
  live(root);
  return { root, wheels: [wf, wr], head, hazards };
}

/* ── The VoltLink pickup truck that collects two-wheelers ── */

export interface Truck extends Ride {
  bed: THREE.Group;
}

export function truck(): Truck {
  const root = new THREE.Group();
  const body = mat(C.accent, { rough: 0.35, metal: 0.2 });
  const dark = mat(C.black, { rough: 0.6 });
  const glass = mat(C.glass, { rough: 0.08, metal: 0.4 });
  const white = mat(C.white, { rough: 0.5 });
  const steel = mat(C.steel, { rough: 0.45, metal: 0.7 });
  box(root, 3.3, 0.3, 1.36, dark, -0.1, 0.32, 0, 0.04);
  box(root, 1.15, 0.6, 1.4, body, 0.98, 0.56, 0, 0.12);
  box(root, 0.92, 0.52, 1.3, body, 0.86, 1.1, 0, 0.14);
  box(root, 0.64, 0.34, 1.32, glass, 0.86, 1.2, 0, 0.05);
  const screen = cbox(root, 0.05, 0.38, 1.16, glass, -0.32);
  screen.position.set(1.3, 1.36, 0);
  box(root, 1.16, 0.06, 1.41, white, 0.98, 0.86, 0);
  box(root, 0.1, 0.16, 1.2, mat('#d9dce2', { rough: 0.3, metal: 0.8 }), 1.56, 0.4, 0, 0.03);
  const bed = new THREE.Group();
  bed.position.set(-0.68, 0.62, 0);
  root.add(bed);
  box(bed, 2.1, 0.1, 1.4, steel, 0, 0, 0, 0.02);
  for (const z of [0.66, -0.66]) box(bed, 2.1, 0.22, 0.05, body, 0, 0.1, z, 0.02);
  box(bed, 0.06, 0.34, 1.38, body, -1.04, 0.1, 0, 0.02);
  // a ramp folded against the tailgate
  box(bed, 0.04, 0.5, 0.36, steel, -1.1, 0.1, 0.3);
  const wheels: THREE.Object3D[] = [];
  const tyreM = mat(C.rubber, { rough: 0.7 });
  for (const x of [1.0, -1.05]) {
    for (const z of [0.6, -0.6]) {
      const g = new THREE.Group();
      g.position.set(x, 0.32, z);
      const t = cyl(g, 0.31, 0.31, 0.22, tyreM, 0, 0, 0, 22);
      t.geometry = t.geometry.clone().translate(0, -0.11, 0);
      t.rotation.x = Math.PI / 2;
      const hub = cyl(g, 0.15, 0.15, 0.24, steel, 0, 0, 0, 12);
      hub.geometry = hub.geometry.clone().translate(0, -0.12, 0);
      hub.rotation.x = Math.PI / 2;
      // one bolt, so the spin reads
      cbox(g, 0.06, 0.06, 0.26, white).position.set(0.08, 0.05, 0);
      root.add(g);
      wheels.push(g);
    }
  }
  const head = box(root, 0.04, 0.12, 0.22, L.head(), 1.6, 0.6, 0.46, 0.02);
  box(root, 0.04, 0.12, 0.22, L.head(), 1.6, 0.6, -0.46, 0.02);
  const hazards = [0.36, -0.36].map((z) => box(root, 0.12, 0.08, 0.16, L.truckHazard(), 0.86, 1.62, z, 0.03));
  live(root);
  return { root, wheels, head, hazards, bed };
}

/* ── Surroundings ── */

export function tree(parent: THREE.Object3D, x: number, z: number, s: number, tone = 0) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.scale.setScalar(s);
  cyl(g, 0.07, 0.11, 1.05, mat('#6e5240', { rough: 0.9 }), 0, 0, 0, 8);
  const greens = [
    ['#6a9350', '#7ea85f', '#5a8145'],
    ['#7c9a52', '#93b166', '#678542'],
  ][tone];
  ball(g, 0.62, mat(greens[0], { rough: 0.95 }), 0, 1.5, 0, 16);
  ball(g, 0.46, mat(greens[1], { rough: 0.95 }), 0.28, 1.9, 0.18, 14);
  ball(g, 0.42, mat(greens[2], { rough: 0.95 }), -0.3, 1.74, -0.22, 14);
  live(g);
  parent.add(g);
  return g;
}

export function cypress(parent: THREE.Object3D, x: number, z: number, s: number) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.scale.setScalar(s);
  cyl(g, 0.05, 0.08, 0.5, mat('#6e5240', { rough: 0.9 }), 0, 0, 0, 8);
  capsule(g, 0.34, 2.0, mat('#4f7542', { rough: 0.95 }), 0, 0.35, 0);
  live(g);
  parent.add(g);
  return g;
}

export function bush(parent: THREE.Object3D, x: number, z: number, s = 1) {
  ball(parent, 0.32 * s, mat('#6a9150', { rough: 0.95 }), x, 0.24 * s, z, 12);
  ball(parent, 0.24 * s, mat('#84a964', { rough: 0.95 }), x + 0.26 * s, 0.2 * s, z + 0.1 * s, 10);
}

export interface Lamp {
  x: number;
  y: number;
  z: number;
}

export function streetLamp(parent: THREE.Object3D, x: number, z: number, face: number): Lamp {
  const pole = mat('#3a3d44', { rough: 0.5, metal: 0.6 });
  cyl(parent, 0.05, 0.07, 2.9, pole, x, 0, z, 10);
  const g = new THREE.Group();
  g.position.set(x, 2.84, z);
  g.rotation.y = face;
  box(g, 0.9, 0.05, 0.06, pole, 0.42, 0, 0);
  box(g, 0.36, 0.1, 0.22, pole, 0.84, -0.06, 0, 0.03);
  box(g, 0.28, 0.02, 0.15, L.bulb(), 0.84, -0.075, 0);
  parent.add(g);
  return { x: x + Math.cos(face) * 0.84, y: 2.55, z: z - Math.sin(face) * 0.84 };
}

export function cone(parent: THREE.Object3D, x: number, z: number) {
  const o = mat('#ee6b2d', { rough: 0.6 });
  box(parent, 0.34, 0.04, 0.34, o, x, 0, z, 0.02);
  cyl(parent, 0.03, 0.13, 0.46, o, x, 0.04, z, 12);
  cyl(parent, 0.085, 0.1, 0.07, mat(C.white, { rough: 0.5 }), x, 0.22, z, 12);
}

export function bench(parent: THREE.Object3D, x: number, z: number, rot = 0) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  const wood = mat('#a8774f', { rough: 0.8 });
  const iron = mat('#33363c', { rough: 0.5, metal: 0.5 });
  for (const sx of [-0.55, 0.55]) box(g, 0.06, 0.42, 0.42, iron, sx, 0, 0);
  for (const sz of [-0.14, 0, 0.14]) box(g, 1.3, 0.04, 0.11, wood, 0, 0.42, sz, 0.01);
  box(g, 1.3, 0.14, 0.04, wood, 0, 0.6, -0.2, 0.01);
  parent.add(g);
}

export function planter(parent: THREE.Object3D, x: number, z: number) {
  box(parent, 0.5, 0.42, 0.5, mat('#c9c2b6', { rough: 0.9 }), x, 0, z, 0.04);
  ball(parent, 0.3, mat('#6a9350', { rough: 0.95 }), x, 0.62, z, 12);
  ball(parent, 0.2, mat('#86ad66', { rough: 0.95 }), x + 0.12, 0.8, z + 0.08, 10);
}

/* ── Workshop equipment ── */

export function toolCabinet(parent: THREE.Object3D, x: number, z: number, color = C.red) {
  const body = mat(color, { rough: 0.32, metal: 0.3 });
  const dark = mat('#2c2e33', { rough: 0.5, metal: 0.5 });
  box(parent, 1.0, 0.95, 0.5, body, x, 0.06, z, 0.04);
  for (let i = 0; i < 5; i++) box(parent, 0.9, 0.014, 0.02, dark, x, 0.24 + i * 0.16, z + 0.25);
  for (let i = 0; i < 5; i++) box(parent, 0.3, 0.03, 0.03, mat(C.chrome, { rough: 0.3, metal: 0.9 }), x, 0.3 + i * 0.16, z + 0.26);
  box(parent, 1.04, 0.05, 0.54, dark, x, 1.01, z, 0.02);
  for (const sx of [-0.4, 0.4]) cyl(parent, 0.05, 0.05, 0.06, dark, x + sx, 0, z + 0.15, 8);
}

export function workbench(parent: THREE.Object3D, x: number, z: number, w = 2.2) {
  const top = mat('#b48a5d', { rough: 0.7 });
  const leg = mat('#4a4e56', { rough: 0.45, metal: 0.6 });
  box(parent, w, 0.08, 0.7, top, x, 0.86, z, 0.02);
  for (const sx of [-w / 2 + 0.08, w / 2 - 0.08]) for (const sz of [-0.28, 0.28]) box(parent, 0.06, 0.86, 0.06, leg, x + sx, 0, z + sz);
  box(parent, w - 0.2, 0.04, 0.6, leg, x, 0.25, z);
  box(parent, 0.22, 0.16, 0.14, mat('#3d6fb6', { rough: 0.4, metal: 0.4 }), x - w / 2 + 0.3, 0.94, z + 0.18, 0.02);
  box(parent, 0.42, 0.18, 0.22, mat(C.red, { rough: 0.4, metal: 0.3 }), x + 0.2, 0.94, z - 0.1, 0.03);
  cyl(parent, 0.06, 0.06, 0.12, mat('#d9a441', { rough: 0.4, metal: 0.6 }), x + w / 2 - 0.35, 0.94, z + 0.12, 10);
  cyl(parent, 0.04, 0.04, 0.22, mat('#2c7c6d', { rough: 0.5 }), x + w / 2 - 0.55, 0.94, z + 0.2, 8);
}

/** Pegboard on the back wall with hand tools hung on it. */
export function pegboard(parent: THREE.Object3D, x: number, y: number, z: number, w = 2.2) {
  box(parent, w, 0.9, 0.04, mat('#d8cdbb', { rough: 0.9 }), x, y, z);
  const tools = ['#c8453b', '#3d6fb6', '#2c2e33', '#d9a441', '#2c7c6d'];
  for (let i = 0; i < 9; i++) {
    const t = mat(tools[i % tools.length], { rough: 0.4, metal: 0.4 });
    const tx = x - w / 2 + 0.2 + (i * (w - 0.4)) / 8;
    box(parent, 0.05, 0.28 + (i % 3) * 0.08, 0.03, t, tx, y + 0.42 - (i % 2) * 0.06, z + 0.04);
  }
}

export function tyreRack(parent: THREE.Object3D, x: number, z: number) {
  const frame = mat('#4a4e56', { rough: 0.45, metal: 0.6 });
  for (const sx of [-0.8, 0.8]) box(parent, 0.06, 1.9, 0.5, frame, x + sx, 0, z);
  for (const y of [0.1, 1.0]) box(parent, 1.66, 0.04, 0.5, frame, x, y, z);
  const t = mat(C.rubber, { rough: 0.7 });
  for (const y of [0.42, 1.32]) for (let i = 0; i < 4; i++) tyre(parent, 0.3, 0.1, t, x - 0.54 + i * 0.36, y, z).rotation.y = Math.PI / 2;
}

export function tyreStack(parent: THREE.Object3D, x: number, z: number, n = 4) {
  const m = mat(C.rubber, { rough: 0.7 });
  for (let i = 0; i < n; i++) tyre(parent, 0.27, 0.1, m, x, 0.1 + i * 0.2, z).rotation.x = Math.PI / 2;
}

export function drum(parent: THREE.Object3D, x: number, z: number, color: string) {
  const band = mat('#2c2e33', { rough: 0.5, metal: 0.5 });
  cyl(parent, 0.28, 0.28, 0.86, mat(color, { rough: 0.45, metal: 0.4 }), x, 0, z, 18);
  cyl(parent, 0.29, 0.29, 0.04, band, x, 0.3, z, 18);
  cyl(parent, 0.29, 0.29, 0.04, band, x, 0.6, z, 18);
}

export function compressor(parent: THREE.Object3D, x: number, z: number) {
  const tank = cyl(parent, 0.26, 0.26, 1.0, mat(C.red, { rough: 0.35, metal: 0.3 }), 0, 0, 0, 18);
  tank.geometry = tank.geometry.clone().translate(0, -0.5, 0);
  tank.rotation.z = Math.PI / 2;
  tank.position.set(x, 0.3, z);
  box(parent, 0.4, 0.3, 0.3, mat('#3a3d44', { rough: 0.5, metal: 0.5 }), x, 0.56, z, 0.04);
  cyl(parent, 0.1, 0.1, 0.06, mat(C.chrome, { rough: 0.3, metal: 0.9 }), x + 0.3, 0.56, z, 12);
}

/** A hydraulic bike lift: the platform is raised by the animation. */
export function bikeLift(parent: THREE.Object3D, x: number, z: number) {
  box(parent, 2.4, 0.08, 0.8, mat('#2f3236', { rough: 0.6, metal: 0.4 }), x, 0, z, 0.02);
  const platform = new THREE.Group();
  platform.position.set(x, 0.08, z);
  box(platform, 2.3, 0.1, 0.72, mat(C.red, { rough: 0.38, metal: 0.3 }), 0, 0, 0, 0.03);
  box(platform, 2.3, 0.02, 0.36, mat('#3a3d44', { rough: 0.8 }), 0, 0.1, 0);
  box(platform, 0.12, 0.22, 0.36, mat('#3a3d44', { rough: 0.5, metal: 0.5 }), 1.05, 0.1, 0, 0.02);
  live(platform);
  const scissor = new THREE.Group();
  scissor.position.set(x, 0.08, z);
  const steel = mat(C.steel, { rough: 0.45, metal: 0.7 });
  for (const s of [1, -1]) {
    const arm = cbox(scissor, 1.5, 0.05, 0.5, steel, 0);
    arm.userData.dir = s;
  }
  live(scissor);
  parent.add(platform, scissor);
  return { platform, scissor };
}

/** A wheel balancer with a wheel on its spindle that spins. */
export function balancer(parent: THREE.Object3D, x: number, z: number) {
  box(parent, 0.7, 0.85, 0.6, mat('#e8e6e1', { rough: 0.45 }), x, 0, z, 0.06);
  box(parent, 0.5, 0.06, 0.4, mat('#3a3d44', { rough: 0.5 }), x, 0.85, z, 0.02);
  box(parent, 0.3, 0.2, 0.04, L.screen(), x - 0.05, 0.6, z + 0.31);
  const spin = new THREE.Group();
  spin.position.set(x + 0.5, 0.62, z);
  spin.rotation.y = Math.PI / 2;
  tyre(spin, 0.27, 0.09, mat(C.rubber, { rough: 0.62 }), 0, 0, 0);
  const metal = mat(C.chrome, { rough: 0.2, metal: 0.9 });
  for (let i = 0; i < 3; i++) cbox(spin, 0.05, 0.52, 0.04, metal, (i / 3) * Math.PI);
  cbox(spin, 0.07, 0.07, 0.07, mat(C.red, { rough: 0.4 })).position.set(0, 0.2, 0.03);
  live(spin);
  parent.add(spin);
  return spin;
}

/** A pendant shop lamp; `bulb` lets a bay light up on its own. */
export function pendant(parent: THREE.Object3D, x: number, y: number, z: number, bulb: THREE.Material = L.bulb()): Lamp {
  cyl(parent, 0.01, 0.01, 0.5, mat('#2c2e33'), x, y - 0.5, z, 6);
  cyl(parent, 0.08, 0.34, 0.2, mat('#3a3d44', { rough: 0.4, metal: 0.6 }), x, y - 0.7, z, 18);
  cyl(parent, 0.3, 0.3, 0.02, bulb, x, y - 0.71, z, 18);
  return { x, y: y - 1.0, z };
}

/** The map pin that marks a call for help, in the brand colour. */
export function pin(): THREE.Group {
  const g = new THREE.Group();
  const m = mat(C.accent, { rough: 0.25, metal: 0.1 });
  ball(g, 0.3, m, 0, 0.62, 0, 22);
  // the point: wide where it meets the head, narrowing to the ground
  cyl(g, 0.25, 0.01, 0.52, m, 0, 0.1, 0, 22);
  ball(g, 0.12, mat(C.white, { rough: 0.4 }), 0.0, 0.66, 0.22, 12);
  live(g);
  return g;
}

export function helmet(parent: THREE.Object3D, x: number, y: number, z: number, color: string) {
  ball(parent, 0.16, mat(color, { rough: 0.25, metal: 0.2 }), x, y + 0.12, z, 14).scale.set(1.1, 0.95, 1);
  box(parent, 0.05, 0.1, 0.22, mat(C.glass, { rough: 0.1 }), x + 0.14, y + 0.06, z, 0.02);
}

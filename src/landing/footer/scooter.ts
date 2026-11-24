// The footer's scooter: one studio-lit two-wheeler, parked on the dark slab the footer is built on.
// 1 unit ≈ 1 m. The scooter faces +x; the camera stands front-left of it, a little above wheel height.
// The slab is pinned to a horizon line set by CSS, so the 3D ground and the HTML slab meet exactly.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const R = 0.265; // tyre radius
const FRONT = 0.66;
const REAR = -0.64;
const STEER = 0.24; // the parked front wheel turns toward the viewer
const AZ = THREE.MathUtils.degToRad(30);
const EL = THREE.MathUtils.degToRad(5);
const LOOK = new THREE.Vector3(-0.06, 0.6, 0);
const LENGTH = 2.2; // nose to tail as seen from the camera
const HEIGHT = 1.32; // ground to mirror tops

export interface Frame {
  /** Ground line, as a fraction of the canvas height from the top. */
  horizon: number;
  /** How much of the canvas width the scooter spans. */
  span: number;
  /** Horizontal centre of the scooter, as a fraction of the canvas width. */
  centre: number;
}

/**
 * Where the ride is, each part 0 → 1. The footer's scroll timeline owns these; the scene only draws them, so any
 * scroll position always gives the same frame, forwards or backwards.
 */
export interface Pose {
  /** Off the left edge (0) to the parking spot (1), along the slab. Wheel rotation follows from the distance. */
  travel: number;
  /** Side-on while riding (0), turned to face the viewer when parked (1). */
  turn: number;
  /** Side stand up (0) or down (1). */
  stand: number;
  /** Bars straight (0) or turned out (1). */
  steer: number;
  /** The nose dipping on the suspension as it stops. */
  dip: number;
  /** Headlight: riding (1) or switched off once parked (0). */
  light: number;
}

export interface ScooterStage {
  resize(w: number, h: number, frame: Frame): void;
  setTheme(dark: boolean, slab: string): void;
  setPointer(x: number, y: number): void;
  setPose(pose: Pose): void;
  start(): void;
  stop(): void;
  renderOnce(): void;
  snapshot(w: number, h: number, frame: Frame): string;
  dispose(): void;
}

/* ── Geometry helpers ── */

/** A soft-edged body panel: a side profile extruded across the scooter, flat faces kept flat, bevels shaded smooth. */
function panel(shape: THREE.Shape, depth: number, bevel: number, thick = bevel, bend = 0): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSize: bevel,
    bevelThickness: thick,
    bevelSegments: 10,
    curveSegments: 56,
    steps: bend ? 16 : 1,
  });
  g.translate(0, 0, -depth / 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  // sweep the outer edges back, so a flat panel becomes a curved shield
  if (bend) for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) - bend * pos.getZ(i) ** 2);
  const part = (index: number) => {
    const grp = g.groups.filter((x) => x.materialIndex === index);
    const out: number[] = [];
    for (const { start, count } of grp) for (let i = start; i < start + count; i++) out.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    const b = new THREE.BufferGeometry();
    b.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    return b;
  };
  const caps = part(0);
  caps.computeVertexNormals();
  const sides = mergeVertices(part(1), 1e-5);
  sides.computeVertexNormals();
  const merged = mergeGeometries([caps, sides.toNonIndexed()], false)!;
  g.dispose();
  return merged;
}

const sm = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * A rounded body whose side silhouette is `shape`: a superellipsoid stretched to the profile, so the sides are
 * gently convex and the edges roll over softly, like pressed steel. `taper` narrows it along x, `bend` sweeps it back.
 */
function shell(shape: THREE.Shape, centre: [number, number], width: number, o: { e?: number; taper?: (x: number) => number; bend?: number } = {}) {
  const ring = shape.getSpacedPoints(180);
  ring.pop();
  if (THREE.ShapeUtils.isClockWise(ring)) ring.reverse();
  const N = ring.length;
  const M = 48;
  const e = o.e ?? 0.5;
  const sp = (a: number, k: number) => Math.sign(a) * Math.abs(a) ** k;
  const pos: number[] = [];
  for (let j = 0; j <= M; j++) {
    const v = (j / M) * Math.PI;
    const sz = sp(Math.cos(v), e);
    const t = sp(Math.sin(v), e);
    for (const p of ring) {
      const x = centre[0] + t * (p.x - centre[0]);
      const y = centre[1] + t * (p.y - centre[1]);
      const z = sz * (width / 2) * (o.taper ? o.taper(x) : 1);
      pos.push(x - (o.bend ?? 0) * z * z, y, z);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < M; j++)
    for (let i = 0; i < N; i++) {
      const a = j * N + i;
      const b = j * N + ((i + 1) % N);
      const c = (j + 1) * N + i;
      const d = (j + 1) * N + ((i + 1) % N);
      idx.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = o.receiveShadow = true;
  parent.add(o);
  return o;
}

/** A tube between two points (cylinder aligned to the segment). */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material, parent: THREE.Object3D) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), 20);
  const o = mesh(g, m, parent);
  o.position.copy(a).addScaledVector(d, 0.5);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return o;
}

/** A soft radial spot for glows and the contact shadow. */
function spot(inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ── The scooter ── */

interface Rig {
  root: THREE.Group; // rolls along x
  pitch: THREE.Group; // nods about the rear contact patch when it stops
  steer: THREE.Group; // turns the front end
  front: THREE.Group; // front wheel spin
  rear: THREE.Group; // rear wheel spin
  stand: THREE.Group; // side stand, folds down once parked
  lamp: THREE.MeshStandardMaterial;
  halo: THREE.Sprite;
  disposables: { dispose(): void }[];
  /** settles once the emblem's image has arrived (or failed), so a still frame can be drawn again with it */
  emblem: Promise<void>;
}

function build(): Rig {
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  const paint = keep(
    new THREE.MeshPhysicalMaterial({ color: '#4d59e4', metalness: 0.55, roughness: 0.27, clearcoat: 1, clearcoatRoughness: 0.04 }),
  );
  const seat = keep(new THREE.MeshPhysicalMaterial({ color: '#2b2522', roughness: 0.62, sheen: 0.5, sheenColor: new THREE.Color('#6b5a4e') }));
  const rubber = keep(new THREE.MeshStandardMaterial({ color: '#17171a', roughness: 0.88 }));
  const trim = keep(new THREE.MeshStandardMaterial({ color: '#1e1f24', roughness: 0.5, metalness: 0.2 }));
  const alloy = keep(new THREE.MeshStandardMaterial({ color: '#d6d9df', roughness: 0.26, metalness: 1 }));
  const graphite = keep(new THREE.MeshStandardMaterial({ color: '#2c2e34', roughness: 0.42, metalness: 0.55 }));
  const chrome = keep(new THREE.MeshStandardMaterial({ color: '#f1f3f6', roughness: 0.1, metalness: 1 }));
  const gold = keep(new THREE.MeshStandardMaterial({ color: '#cfa64e', roughness: 0.28, metalness: 1 }));
  const lamp = keep(new THREE.MeshStandardMaterial({ color: '#fff6e6', roughness: 0.08, metalness: 0.2, emissive: '#ffe9c2', emissiveIntensity: 0 }));

  const root = new THREE.Group();
  const pitch = new THREE.Group();
  pitch.position.x = REAR;
  root.add(pitch);
  const body = new THREE.Group();
  body.position.x = -REAR;
  pitch.add(body);

  /* Wheels: tyre, two-tone alloy rim with five twin spokes, hub */
  const wheel = (disc: boolean) => {
    const w = new THREE.Group();
    const tyre = mesh(keep(new THREE.TorusGeometry(R - 0.062, 0.062, 28, 96)), rubber, w);
    tyre.scale.z = 1.12;
    mesh(keep(new THREE.CylinderGeometry(0.15, 0.15, 0.1, 72, 1, true).rotateX(Math.PI / 2)), graphite, w);
    for (const z of [-0.052, 0.052]) mesh(keep(new THREE.TorusGeometry(0.152, 0.011, 12, 96)), alloy, w, 0, 0, z);
    const spoke = keep(new RoundedBoxGeometry(0.115, 0.02, 0.026, 2, 0.008).translate(0.092, 0, 0));
    for (let i = 0; i < 10; i++) {
      const s = mesh(spoke, i % 2 ? graphite : alloy, w, 0, 0, 0.026);
      s.rotation.z = (i * Math.PI) / 5 + (i % 2 ? 0.06 : -0.06);
    }
    mesh(keep(new THREE.CylinderGeometry(0.046, 0.046, 0.13, 32).rotateX(Math.PI / 2)), alloy, w);
    mesh(keep(new THREE.CylinderGeometry(0.022, 0.022, 0.15, 24).rotateX(Math.PI / 2)), chrome, w);
    if (disc) {
      const d = mesh(keep(new THREE.RingGeometry(0.05, 0.098, 64)), alloy, w, 0, 0, 0.074);
      d.material = keep(new THREE.MeshStandardMaterial({ color: '#7d8188', roughness: 0.5, metalness: 1, side: THREE.DoubleSide }));
    }
    return w;
  };

  const rearWheel = new THREE.Group();
  rearWheel.position.set(REAR, R, 0);
  rearWheel.add(wheel(false));
  root.add(rearWheel);

  /* Rear body: a teardrop over the engine and rear wheel, widest behind the seat's middle, tapering to the tail */
  const cowl = new THREE.Shape();
  cowl.moveTo(0.0, 0.29);
  cowl.bezierCurveTo(-0.16, 0.31, -0.3, 0.355, -0.42, 0.38);
  cowl.bezierCurveTo(-0.58, 0.41, -0.76, 0.43, -0.86, 0.47);
  cowl.bezierCurveTo(-0.98, 0.52, -1.06, 0.58, -1.08, 0.66);
  cowl.bezierCurveTo(-1.1, 0.73, -1.06, 0.79, -1.0, 0.8);
  cowl.bezierCurveTo(-0.8, 0.81, -0.5, 0.81, -0.32, 0.8);
  cowl.bezierCurveTo(-0.2, 0.795, -0.13, 0.74, -0.1, 0.64);
  cowl.bezierCurveTo(-0.07, 0.52, -0.02, 0.38, 0.0, 0.29);
  mesh(keep(shell(cowl, [-0.54, 0.6], 0.5, { e: 0.42, taper: (x) => 1 - 0.26 * sm(-0.58, -0.06, x) - 0.4 * sm(-0.62, -1.1, x) })), paint, body);

  /* Seat: a long cushion, narrower at the rider's knees */
  const s = new THREE.Shape();
  s.moveTo(-0.97, 0.78);
  s.bezierCurveTo(-0.99, 0.85, -0.95, 0.91, -0.86, 0.92);
  s.lineTo(-0.36, 0.935);
  s.bezierCurveTo(-0.22, 0.935, -0.12, 0.91, -0.1, 0.86);
  s.bezierCurveTo(-0.09, 0.82, -0.12, 0.79, -0.18, 0.785);
  s.lineTo(-0.97, 0.78);
  mesh(keep(shell(s, [-0.54, 0.855], 0.34, { e: 0.45, taper: (x) => 1 - 0.3 * sm(-0.42, -0.1, x) - 0.2 * sm(-0.8, -0.98, x) })), seat, body);

  /* Floorboard with rubber strips */
  mesh(keep(new RoundedBoxGeometry(0.7, 0.075, 0.42, 3, 0.03)), graphite, body, 0.12, 0.22, 0);
  const strip = keep(new RoundedBoxGeometry(0.56, 0.012, 0.022, 2, 0.005));
  for (let i = 0; i < 5; i++) mesh(strip, alloy, body, 0.1, 0.261, -0.15 + i * 0.075);

  /* Leg shield */
  const ls = new THREE.Shape();
  ls.moveTo(0.42, 0.22);
  ls.lineTo(0.57, 0.24);
  ls.bezierCurveTo(0.63, 0.4, 0.63, 0.7, 0.595, 0.95);
  ls.bezierCurveTo(0.585, 0.985, 0.54, 0.99, 0.515, 0.965);
  ls.bezierCurveTo(0.51, 0.72, 0.48, 0.42, 0.42, 0.22);
  mesh(keep(panel(ls, 0.38, 0.03, 0.045, 0.9)), paint, body);
  const edge = new THREE.CubicBezierCurve(new THREE.Vector2(0.6, 0.25), new THREE.Vector2(0.655, 0.4), new THREE.Vector2(0.655, 0.7), new THREE.Vector2(0.62, 0.96));
  for (const z of [-0.226, 0.226]) {
    const pts = edge.getPoints(40).map((p) => new THREE.Vector3(p.x - 0.9 * z * z, p.y, z));
    mesh(keep(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.0075, 10, false)), alloy, body);
  }

  /* Engine block, belt cover and exhaust under the cowl */
  mesh(keep(new RoundedBoxGeometry(0.42, 0.16, 0.22, 3, 0.04)), graphite, body, -0.36, 0.2, 0.0);
  const belt = mesh(keep(new RoundedBoxGeometry(0.4, 0.075, 0.04, 3, 0.018)), graphite, body, -0.46, 0.27, 0.11);
  belt.rotation.z = 0.08;
  mesh(keep(new THREE.CylinderGeometry(0.042, 0.036, 0.4, 28).rotateZ(Math.PI / 2)), chrome, body, -0.84, 0.26, -0.17);
  mesh(keep(new THREE.CylinderGeometry(0.046, 0.046, 0.22, 28).rotateZ(Math.PI / 2)), graphite, body, -0.78, 0.27, -0.17);

  /* Chrome rack behind the seat */
  const rack = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(-0.74, 0.82, 0.13),
      new THREE.Vector3(-0.96, 0.84, 0.13),
      new THREE.Vector3(-1.05, 0.84, 0.0),
      new THREE.Vector3(-0.96, 0.84, -0.13),
      new THREE.Vector3(-0.74, 0.82, -0.13),
    ],
    false,
    'catmullrom',
    0.4,
  );
  mesh(keep(new THREE.TubeGeometry(rack, 64, 0.013, 12, false)), chrome, body);
  for (const x of [-0.84, -0.96]) rod(new THREE.Vector3(x, 0.84, -0.13), new THREE.Vector3(x, 0.84, 0.13), 0.009, chrome, body);
  for (const z of [-0.13, 0.13]) rod(new THREE.Vector3(-0.98, 0.84, z), new THREE.Vector3(-0.95, 0.74, z * 0.8), 0.011, chrome, body);

  /* The VoltLink emblem: on the side panel and on the horn cover, from the real logo art */
  let arrived = () => {};
  const emblem = new Promise<void>((r) => (arrived = r));
  const badge = keep(new THREE.TextureLoader().load('/brand/voltlink-mark.webp', () => arrived(), undefined, () => arrived()));
  badge.colorSpace = THREE.SRGBColorSpace;
  badge.anisotropy = 8;
  const badgeMat = keep(new THREE.MeshStandardMaterial({ map: badge, transparent: true, alphaTest: 0.08, metalness: 0.7, roughness: 0.3 }));
  const side = mesh(keep(new THREE.PlaneGeometry(0.12, 0.126)), badgeMat, body, -0.56, 0.6, 0.254);
  side.castShadow = false;
  const horn = mesh(keep(new THREE.PlaneGeometry(0.075, 0.079)), badgeMat, body, 0.636, 0.78, 0);
  horn.rotation.set(0, Math.PI / 2, -0.12);
  horn.castShadow = false;

  /* Side stand on the near side, folded while riding */
  const stand = new THREE.Group();
  stand.position.set(-0.12, 0.2, 0.17);
  rod(new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.12, -0.19, 0.08), 0.012, graphite, stand);
  mesh(keep(new RoundedBoxGeometry(0.06, 0.012, 0.035, 2, 0.005)), graphite, stand, -0.125, -0.2, 0.084);
  body.add(stand);

  /* Front end: everything that turns with the bars, hung from the steering axis */
  const rake = new THREE.Group();
  rake.position.set(FRONT, R, 0);
  rake.rotation.z = Math.atan2(0.13, 0.72);
  body.add(rake);
  const steer = new THREE.Group();
  rake.add(steer);
  const front = new THREE.Group();
  front.add(wheel(true));
  const frontParts = new THREE.Group(); // built in body space, then moved under the steering
  body.add(frontParts);

  frontParts.add(front);
  front.position.set(FRONT, R, 0);

  const fender = new THREE.Shape();
  fender.absarc(FRONT, R, 0.335, -0.08, 2.55, false);
  fender.absarc(FRONT, R, 0.302, 2.55, -0.08, true);
  mesh(keep(panel(fender, 0.11, 0.028, 0.03)), paint, frontParts);

  // Single-sided link arm and a gold coil-over shock on the near side
  rod(new THREE.Vector3(FRONT, R, 0.09), new THREE.Vector3(FRONT - 0.14, R + 0.12, 0.09), 0.022, graphite, frontParts);
  rod(new THREE.Vector3(FRONT - 0.13, R + 0.13, 0.11), new THREE.Vector3(FRONT - 0.06, R + 0.5, 0.11), 0.011, chrome, frontParts);
  const coil = new THREE.CatmullRomCurve3(
    Array.from({ length: 129 }, (_, i) => {
      const t = i / 128;
      return new THREE.Vector3(0.026 * Math.cos(t * Math.PI * 16), t * 0.22, 0.026 * Math.sin(t * Math.PI * 16));
    }),
  );
  const spring = mesh(keep(new THREE.TubeGeometry(coil, 240, 0.0055, 8, false)), gold, frontParts);
  spring.position.set(FRONT - 0.115, R + 0.2, 0.11);
  spring.rotation.z = -Math.atan2(0.07, 0.37);
  const caliper = mesh(keep(new RoundedBoxGeometry(0.075, 0.05, 0.03, 2, 0.012)), gold, frontParts, FRONT - 0.07, R + 0.07, 0.085);
  caliper.rotation.z = 0.75;

  // Headset with the headlight, grips, levers and mirrors
  const hs = new THREE.Shape();
  hs.moveTo(0.43, 0.98);
  hs.bezierCurveTo(0.5, 0.965, 0.6, 0.97, 0.65, 0.99);
  hs.bezierCurveTo(0.69, 1.02, 0.69, 1.09, 0.65, 1.11);
  hs.bezierCurveTo(0.58, 1.13, 0.47, 1.13, 0.41, 1.1);
  hs.bezierCurveTo(0.38, 1.07, 0.39, 1.0, 0.43, 0.98);
  mesh(keep(shell(hs, [0.54, 1.045], 0.27, { e: 0.45, bend: 0.7 })), paint, frontParts);
  const bezel = mesh(keep(new THREE.TorusGeometry(0.07, 0.012, 16, 72).rotateY(Math.PI / 2)), chrome, frontParts, 0.69, 1.045, 0);
  bezel.castShadow = false;
  const lens = mesh(keep(new THREE.SphereGeometry(0.07, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(-Math.PI / 2)), lamp, frontParts, 0.685, 1.045, 0);
  lens.scale.set(0.42, 1, 1);
  for (const z of [-1, 1]) {
    mesh(keep(new THREE.CylinderGeometry(0.021, 0.021, 0.13, 24).rotateX(Math.PI / 2)), trim, frontParts, 0.5, 1.05, z * 0.235);
    mesh(keep(new THREE.CylinderGeometry(0.024, 0.024, 0.025, 24).rotateX(Math.PI / 2)), chrome, frontParts, 0.5, 1.05, z * 0.31);
    const lever = mesh(keep(new RoundedBoxGeometry(0.014, 0.012, 0.15, 2, 0.005)), chrome, frontParts, 0.56, 1.06, z * 0.235);
    lever.rotation.y = z * 0.08;
    rod(new THREE.Vector3(0.5, 1.1, z * 0.11), new THREE.Vector3(0.475, 1.215, z * 0.27), 0.007, chrome, frontParts);
    // round mirrors: painted backs facing forward, glass facing the rider
    const head = new THREE.Group();
    head.position.set(0.475, 1.235, z * 0.285);
    head.rotation.y = z * 0.25;
    frontParts.add(head);
    mesh(keep(new THREE.CylinderGeometry(0.046, 0.04, 0.016, 40).rotateZ(Math.PI / 2)), paint, head, 0.004, 0, 0);
    mesh(keep(new THREE.TorusGeometry(0.046, 0.004, 8, 48).rotateY(Math.PI / 2)), chrome, head, -0.004, 0, 0);
    mesh(keep(new THREE.CircleGeometry(0.043, 40).rotateY(-Math.PI / 2)), chrome, head, -0.0045, 0, 0);
  }
  // Halo around the headlight, visible after dark
  const haloMat = keep(
    new THREE.SpriteMaterial({ map: keep(spot('rgba(255,236,200,0.9)', 'rgba(255,236,200,0)')), blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }),
  );
  const halo = new THREE.Sprite(haloMat);
  halo.scale.set(0.24, 0.24, 1);
  halo.position.set(0.71, 1.045, 0);
  frontParts.add(halo);

  // Move the front end under the steering axis without changing where it sits
  body.updateMatrixWorld(true);
  for (const c of [...frontParts.children]) steer.attach(c);
  body.remove(frontParts);

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) disposables.push((o as THREE.Mesh).geometry);
  });
  return { root, pitch, steer, front, rear: rearWheel, stand, lamp, halo, disposables, emblem };
}

/* ── Stage ── */

/**
 * Builds the stage, then compiles its shader programs on the driver's own threads (compileAsync) before the first
 * frame, so arriving at the footer never stalls the page while they compile.
 */
export async function createScooterStage(canvas: HTMLCanvasElement, opts: { dark: boolean; slab: string; pose: Pose }): Promise<ScooterStage | null> {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.autoClear = false;
  // Reading back every program's log forces each compile to finish on the spot; only worth it while developing
  renderer.debug.checkShaderErrors = import.meta.env.DEV;

  await new Promise<void>((r) => setTimeout(r, 0));
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.03).texture;
  room.dispose();

  const camera = new THREE.PerspectiveCamera(20, 2, 0.1, 80);

  /* Lights: warm key from the front, cool rim from behind to draw the silhouette, a low fill */
  const hemi = new THREE.HemisphereLight('#ffffff', '#1a1a1f', 0.35);
  const key = new THREE.DirectionalLight('#fff4e8', 2.6);
  key.position.set(3, 4.6, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -1.6, right: 1.6, top: 1.6, bottom: -1.6, near: 1, far: 16 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  const rim = new THREE.DirectionalLight('#d6dcff', 2.4);
  rim.position.set(-3.5, 3, -4.5);
  const fill = new THREE.DirectionalLight('#ffffff', 0.5);
  fill.position.set(-5, 1.4, 2.5);
  scene.add(hemi, key, key.target, rim, fill);

  // the model in a task of its own, after the renderer and its environment
  await new Promise<void>((r) => setTimeout(r, 0));
  const rig = build();
  scene.add(rig.root);

  /* The slab: a ground plane in exactly the HTML slab's colour, faded over the scooter's reflection */
  const fade = document.createElement('canvas');
  fade.width = 4;
  fade.height = 256;
  const fg = fade.getContext('2d')!;
  const grad = fg.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#d9d9d9'); // back edge: lets ~15% of the reflection through
  grad.addColorStop(0.075, '#ffffff');
  fg.fillStyle = grad;
  fg.fillRect(0, 0, 4, 256);
  const fadeTex = new THREE.CanvasTexture(fade);
  const DEPTH = 14;
  const BACK = 0.5; // the slab's back edge sits this far behind the parking spot
  const groundMat = new THREE.MeshBasicMaterial({ color: opts.slab, alphaMap: fadeTex, transparent: true, toneMapped: false, depthWrite: false });
  const groundGeo = new THREE.PlaneGeometry(60, DEPTH).rotateX(-Math.PI / 2).translate(0, 0, DEPTH / 2 - BACK);
  // The fade's top row lands on the back edge (texture flipY + the plane's rotation)
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.renderOrder = 1;
  scene.add(ground);

  // Contact shadow, a faint accent pool of light and the headlight's throw, all lying on the slab
  const decals = new THREE.Group();
  decals.renderOrder = 2;
  scene.add(decals);
  const decal = (tex: THREE.Texture, w: number, d: number, x: number, blending: THREE.Blending, opacity: number) => {
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, blending, opacity });
    const o = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), m);
    o.position.set(x, 0.002, 0);
    o.renderOrder = 2;
    decals.add(o);
    return o;
  };
  const shadowMat = decal(spot('rgba(0,0,0,0.75)', 'rgba(0,0,0,0)'), 2.6, 0.8, -0.02, THREE.NormalBlending, 0.8).material as THREE.MeshBasicMaterial;
  const poolMat = decal(spot('rgba(88,101,242,0.9)', 'rgba(88,101,242,0)'), 3.6, 1.6, -0.05, THREE.AdditiveBlending, 0.1).material as THREE.MeshBasicMaterial;
  const beam = decal(spot('rgba(255,226,170,0.9)', 'rgba(255,226,170,0)'), 2.4, 1.0, 0, THREE.AdditiveBlending, 0);
  const beamMat = beam.material as THREE.MeshBasicMaterial;

  /* State */
  let w = 2;
  let h = 1;
  let frame: Frame = { horizon: 0.78, span: 0.46, centre: 0.5 };
  let dark = opts.dark;
  let visible = false;
  let raf = 0;
  let pose: Pose = { ...opts.pose };
  let reach = 4; // how far left the ride starts: set from the frame so it begins just out of view
  const pointer = { x: 0, y: 0 };
  const lean = { x: 0, y: 0 };
  // the ride runs parallel to the screen, so the scooter stays on the slab at the same depth the whole way
  const lane = new THREE.Vector3(Math.cos(AZ), 0, -Math.sin(AZ));

  const applyTheme = () => {
    hemi.intensity = dark ? 0.1 : 0.2;
    scene.environmentIntensity = dark ? 0.32 : 0.85;
    key.intensity = dark ? 1.25 : 2.3;
    key.color.set(dark ? '#ffe9d1' : '#fff4e8');
    rim.intensity = dark ? 4.2 : 2.2;
    fill.intensity = dark ? 0.22 : 0.5;
    shadowMat.opacity = dark ? 0.9 : 0.8;
  };
  applyTheme();

  const applyPose = () => {
    const { travel, turn, stand, steer, dip, light } = pose;
    const back = reach * (1 - travel);
    rig.root.position.copy(lane).multiplyScalar(-back);
    rig.root.rotation.y = AZ * (1 - turn);
    // the wheels turn by exactly the distance covered, so reversing the scroll winds them back
    rig.front.rotation.z = rig.rear.rotation.z = back / R;
    // folded, the stand swings back to lie flat under the floor; parked, it reaches down to the slab
    rig.stand.rotation.z = -1.0 * (1 - stand);
    rig.stand.rotation.x = -0.25 * (1 - stand);
    rig.steer.rotation.y = STEER * steer;
    rig.pitch.rotation.z = -0.008 * dip;
    decals.position.copy(rig.root.position);
    decals.rotation.y = rig.root.rotation.y;
    // the headlight's throw swings with the bars
    beam.position.set(FRONT + Math.cos(rig.steer.rotation.y) * 1.1, 0.002, -Math.sin(rig.steer.rotation.y) * 1.1);
    beam.rotation.y = rig.steer.rotation.y;
    // riding: headlight on; parked: switched off (dusk keeps a parking glow), and the slab's pool of light comes up
    rig.lamp.emissiveIntensity = dark ? 0.7 + 2.5 * light : 1.6 * light;
    rig.halo.material.opacity = dark ? 0.2 + 0.5 * light : 0.3 * light;
    beamMat.opacity = dark ? 0.26 * light : 0;
    poolMat.opacity = (dark ? 0.06 + 0.1 * travel : 0.03 + 0.05 * travel) * (1 - 0.4 * light);
  };

  const update = (): boolean => {
    // the camera leans a few degrees toward the pointer
    lean.x += (pointer.x - lean.x) * 0.08;
    lean.y += (pointer.y - lean.y) * 0.08;
    return Math.abs(pointer.x - lean.x) > 0.001 || Math.abs(pointer.y - lean.y) > 0.001;
  };

  const place = (cw: number, ch: number, f: Frame) => {
    const aspect = cw / ch;
    camera.aspect = aspect;
    const az = AZ + lean.x * THREE.MathUtils.degToRad(4);
    const el = EL + lean.y * THREE.MathUtils.degToRad(-1.5);
    const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const th = tv * aspect;
    // distance that makes the scooter span the requested width, pulled back if it would be too tall
    let d = LENGTH / (f.span * 2 * th);
    d = Math.max(d, HEIGHT / (2 * tv * (f.horizon - 0.05)));
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    camera.position.copy(LOOK).addScaledVector(dir, d);
    camera.lookAt(LOOK);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    ground.rotation.y = az;
    // Lens shift: pin the slab's back edge to the CSS horizon and the parking spot to the requested centre
    const edge = new THREE.Vector3(-Math.sin(az) * BACK, 0, -Math.cos(az) * BACK).project(camera);
    const spotNdc = new THREE.Vector3(0, 0, 0).project(camera);
    const e = camera.projectionMatrix.elements;
    e[9] += edge.y - (1 - 2 * f.horizon);
    e[8] += spotNdc.x - (2 * f.centre - 1);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    // start the ride just beyond the left edge of the view, wherever that is for this frame
    reach = d * th * (1 + Math.abs(2 * f.centre - 1)) + LENGTH * 0.75;
  };

  const draw = () => {
    place(w, h, frame);
    applyPose();
    renderer.clear();
    // 1. the reflection: the same scooter mirrored under the slab
    ground.visible = false;
    decals.visible = false;
    rig.root.scale.y = -1;
    renderer.render(scene, camera);
    // 2. the slab over it, then the scooter itself
    rig.root.scale.y = 1;
    ground.visible = true;
    decals.visible = true;
    renderer.render(scene, camera);
  };

  const loop = () => {
    raf = 0;
    if (!visible) return;
    const busy = update();
    draw();
    if (busy) raf = requestAnimationFrame(loop);
  };
  const kick = () => {
    if (!raf && visible) raf = requestAnimationFrame(loop);
  };

  const stage: ScooterStage = {
    resize(cw, ch, f) {
      w = Math.max(2, cw);
      h = Math.max(1, ch);
      frame = f;
      renderer.setSize(w, h, false);
      if (visible) kick();
      else draw();
    },
    setTheme(isDark, slab) {
      dark = isDark;
      groundMat.color.set(slab);
      applyTheme();
      draw();
    },
    setPointer(px, py) {
      pointer.x = px;
      pointer.y = py;
      kick();
    },
    setPose(next) {
      pose = { ...next };
      if (visible) kick();
    },
    start() {
      visible = true;
      kick();
    },
    stop() {
      visible = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    renderOnce() {
      update();
      draw();
    },
    snapshot(sw, sh, f) {
      const keepW = w;
      const keepH = h;
      const keepF = frame;
      w = sw;
      h = sh;
      frame = f;
      renderer.setSize(sw, sh, false);
      draw();
      const url = canvas.toDataURL('image/png');
      w = keepW;
      h = keepH;
      frame = keepF;
      renderer.setSize(w, h, false);
      draw();
      return url;
    },
    dispose() {
      gone = true;
      this.stop();
      rig.disposables.forEach((d) => d.dispose());
      groundGeo.dispose();
      groundMat.dispose();
      fadeTex.dispose();
      decals.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as THREE.MeshBasicMaterial).map?.dispose();
          (m.material as THREE.Material).dispose();
        }
      });
      scene.environment?.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
  // a still frame (reduced motion, or the scooter parked) is drawn again once the emblem's image is in
  let gone = false;
  void rig.emblem.then(() => {
    if (!raf && !gone) draw();
  });
  await new Promise<void>((r) => setTimeout(r, 0));
  await renderer.compileAsync(scene, camera);
  return stage;
}

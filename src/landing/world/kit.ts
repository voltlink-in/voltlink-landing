// Building blocks for the miniature world: painted surface textures, a material cache, primitive helpers that
// stand things on the ground, and a bake step that merges everything static into one mesh per material.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ── Surface textures: greyscale grain painted once, tinted by each material's colour ── */

let seed = 7;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

async function paint(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void | Promise<void>, repeat = 1): Promise<THREE.CanvasTexture> {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  await draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

/** Between batches of specks: the canvas keeps what is drawn, so painting resumes exactly where it stopped. */
let rest: () => Promise<void> = async () => {};
const BATCH = 16000;

/** Speckle and soft blotches over a near-white base: `dark` is how far specks reach toward black. */
async function grain(g: CanvasRenderingContext2D, s: number, base: number, blotch: number, speck: number, dark: number) {
  g.fillStyle = `rgb(${base},${base},${base})`;
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 70; i++) {
    const x = rand() * s;
    const y = rand() * s;
    const r = (0.04 + rand() * 0.16) * s;
    const v = base - blotch * rand();
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(${v},${v},${v},0.35)`);
    grd.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  const n = s * s * speck;
  for (let i = 0; i < n; i++) {
    if (i % BATCH === BATCH - 1) await rest();
    const v = Math.round(base - dark * rand());
    g.fillStyle = `rgba(${v},${v},${v},${0.25 + 0.5 * rand()})`;
    const d = rand() < 0.9 ? 1 : 2;
    g.fillRect(rand() * s, rand() * s, d, d);
  }
}

export interface Textures {
  concrete: THREE.CanvasTexture;
  slab: THREE.CanvasTexture;
  asphalt: THREE.CanvasTexture;
  wood: THREE.CanvasTexture;
  plaster: THREE.CanvasTexture;
  grass: THREE.CanvasTexture;
}

/** Paints the surfaces in a fixed order (the grain is seeded, so they come out the same every time), handing the
 *  main thread back between them through `pause`. */
export async function makeTextures(pause: () => Promise<void> = async () => {}): Promise<Textures> {
  seed = 7;
  rest = pause;
  const concrete = await paint(512, (g, s) => grain(g, s, 248, 34, 0.06, 70), 3);
  await pause();
  // Poured slab with saw-cut joints, for the workshop and forecourt
  const slab = await paint(512, async (g, s) => {
    await grain(g, s, 250, 26, 0.05, 60);
    g.strokeStyle = 'rgba(120,120,120,0.55)';
    g.lineWidth = 2;
    for (const p of [0, s / 2]) {
      g.beginPath();
      g.moveTo(p + 1, 0);
      g.lineTo(p + 1, s);
      g.moveTo(0, p + 1);
      g.lineTo(s, p + 1);
      g.stroke();
    }
  }, 4);
  await pause();
  const asphalt = await paint(512, (g, s) => grain(g, s, 230, 40, 0.35, 150), 5);
  await pause();
  const wood = await paint(512, (g, s) => {
    g.fillStyle = '#f2f2f2';
    g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 2) {
      const v = 200 + 50 * Math.sin(y * 0.09 + 3 * Math.sin(y * 0.013)) * rand();
      g.fillStyle = `rgba(${v},${v},${v},0.5)`;
      g.fillRect(0, y, s, 1 + (rand() < 0.2 ? 1 : 0));
    }
  }, 1);
  const plaster = await paint(256, (g, s) => grain(g, s, 252, 14, 0.04, 30), 2);
  const grass = await paint(256, (g, s) => grain(g, s, 240, 50, 0.5, 90), 4);
  return { concrete, slab, asphalt, wood, plaster, grass };
}

/* ── Materials ── */

export interface MatOpts {
  rough?: number;
  metal?: number;
  map?: THREE.Texture;
  emissive?: string;
  glow?: number;
  opacity?: number;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();

export function mat(color: string, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${o.rough ?? 0.8}|${o.metal ?? 0}|${o.map?.uuid ?? ''}|${o.emissive ?? ''}|${o.opacity ?? 1}`;
  const hit = matCache.get(key);
  if (hit) return hit;
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: o.rough ?? 0.8,
    metalness: o.metal ?? 0,
    map: o.map ?? null,
  });
  if (o.emissive) {
    m.emissive = new THREE.Color(o.emissive);
    m.emissiveIntensity = o.glow ?? 0;
    // Lamps are switched on and off with the theme through their material, so a baked lamp still follows it
    m.userData.lamp = true;
  }
  if (o.opacity !== undefined && o.opacity < 1) {
    m.transparent = true;
    m.opacity = o.opacity;
    m.depthWrite = false;
  }
  matCache.set(key, m);
  return m;
}

export function clearMaterials() {
  matCache.forEach((m) => m.dispose());
  matCache.clear();
}

/* ── Primitives: positioned by the point their base rests on ── */

const geoCache = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry) {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

export function clearGeometry() {
  geoCache.forEach((g) => g.dispose());
  geoCache.clear();
}

function place<T extends THREE.Object3D>(o: T, x: number, y: number, z: number, parent?: THREE.Object3D): T {
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  parent?.add(o);
  return o;
}

/** A box standing on (x, y, z); `r` rounds its edges. */
export function box(parent: THREE.Object3D | undefined, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, r = 0) {
  const k = `b${w.toFixed(3)},${h.toFixed(3)},${d.toFixed(3)},${r}`;
  const g = geo(k, () => {
    const b = r > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d);
    b.translate(0, h / 2, 0);
    return b;
  });
  return place(new THREE.Mesh(g, m), x, y, z, parent);
}

/** An upright cylinder standing on (x, y, z). */
export function cyl(parent: THREE.Object3D | undefined, rt: number, rb: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 18) {
  const k = `c${rt},${rb},${h},${seg}`;
  const g = geo(k, () => new THREE.CylinderGeometry(rt, rb, h, seg).translate(0, h / 2, 0));
  return place(new THREE.Mesh(g, m), x, y, z, parent);
}

/** A sphere centred on (x, y, z). */
export function ball(parent: THREE.Object3D | undefined, r: number, m: THREE.Material, x: number, y: number, z: number, seg = 16) {
  const g = geo(`s${r},${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(8, seg * 0.75)));
  return place(new THREE.Mesh(g, m), x, y, z, parent);
}

/** A capsule standing on (x, y, z), total height h. */
export function capsule(parent: THREE.Object3D | undefined, r: number, h: number, m: THREE.Material, x: number, y: number, z: number) {
  const g = geo(`p${r},${h}`, () => new THREE.CapsuleGeometry(r, Math.max(0.001, h - 2 * r), 6, 14).translate(0, h / 2, 0));
  return place(new THREE.Mesh(g, m), x, y, z, parent);
}

/** A tyre: a torus standing upright in the x-y plane, centred on (x, y, z). */
export function tyre(parent: THREE.Object3D | undefined, r: number, tube: number, m: THREE.Material, x: number, y: number, z: number) {
  const g = geo(`t${r},${tube}`, () => new THREE.TorusGeometry(r, tube, 10, 28));
  return place(new THREE.Mesh(g, m), x, y, z, parent);
}

/** A flat decal lying on the ground at height y (no shadow casting). */
export function decal(parent: THREE.Object3D, w: number, d: number, m: THREE.Material, x: number, y: number, z: number, rot = 0) {
  const g = geo(`d${w},${d}`, () => new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2));
  const p = new THREE.Mesh(g, m);
  p.position.set(x, y, z);
  p.rotation.y = rot;
  p.receiveShadow = true;
  p.userData.keep = true;
  parent.add(p);
  return p;
}

/** A canvas-painted texture for signs and road paint. */
export function label(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* ── Bake: everything that never moves becomes one mesh per material ── */

export async function bake(root: THREE.Object3D, pause: () => Promise<void> = async () => {}): Promise<THREE.Group> {
  root.updateMatrixWorld(true);
  // Meshes are grouped by surface (roughness, metalness, texture), not by colour: within a surface each mesh's
  // colour goes into its vertices, so a dozen painted parts draw as one. Lamps keep their own material, because
  // the theme and the bay lights change how bright they glow.
  const bySurface = new Map<string, { m: THREE.MeshStandardMaterial; parts: { g: THREE.BufferGeometry; c: THREE.Color }[]; mats: Set<THREE.Material> }>();
  const keep: THREE.Mesh[] = [];
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  // a few hundred meshes at a time, so baking never holds the page up for long
  for (let i = 0; i < meshes.length; i++) {
    if (i % 150 === 149) await pause();
    const mesh = meshes[i];
    const m = mesh.material as THREE.MeshStandardMaterial;
    if (mesh.userData.keep || m.transparent) {
      keep.push(mesh);
      continue;
    }
    const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', src.getAttribute('position'));
    g.setAttribute('normal', src.getAttribute('normal'));
    g.setAttribute('uv', src.getAttribute('uv'));
    g.applyMatrix4(mesh.matrixWorld);
    src.dispose();
    const key = m.userData.lamp ? m.uuid : `${m.roughness}|${m.metalness}|${m.map?.uuid ?? ''}|${m.side}`;
    const set = bySurface.get(key) ?? { m, parts: [], mats: new Set<THREE.Material>() };
    set.parts.push({ g, c: m.color });
    set.mats.add(m);
    bySurface.set(key, set);
  }
  await pause();
  const out = new THREE.Group();
  for (const { m, parts, mats } of bySurface.values()) {
    // one colour: the material as it was; several: white, tinted per vertex with each part's own colour
    const tint = mats.size > 1;
    if (tint)
      for (const { g, c } of parts) {
        const n = g.getAttribute('position').count;
        const rgb = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) rgb.set([c.r, c.g, c.b], i * 3);
        g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
      }
    const merged = mergeGeometries(
      parts.map((p) => p.g),
      false,
    );
    parts.forEach((p) => p.g.dispose());
    if (!merged) continue;
    merged.computeBoundingSphere();
    let material: THREE.Material = m;
    if (tint) {
      const shared = m.clone();
      shared.color.setRGB(1, 1, 1);
      shared.vertexColors = true;
      material = shared;
    }
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    out.add(mesh);
    if (parts.length > 40) await pause();
  }
  // Decals and glass keep their own meshes, in world space
  for (const mesh of keep) {
    mesh.updateMatrixWorld(true);
    const clone = mesh.clone();
    mesh.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
    out.add(clone);
  }
  return out;
}

/* ── Merge within moving groups: siblings that never move apart become one mesh per material ── */

/**
 * Inside every group of the live (animated) tree, the meshes that share a material and never move on their own are
 * merged into one mesh, in the group's own space, so the group still moves, turns and scales as a whole. Groups are
 * left as they are; so are transparent meshes, instanced ones, and anything `skip` names (a part animated by itself).
 * Same look, a fraction of the draw calls.
 */
export function mergeStatic(root: THREE.Object3D, skip: (o: THREE.Object3D) => boolean = () => false): void {
  const parents: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.children.length > 1) parents.push(o);
  });
  for (const parent of parents) {
    const sets = new Map<string, THREE.Mesh[]>();
    for (const c of parent.children) {
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh || (mesh as unknown as THREE.InstancedMesh).isInstancedMesh || mesh.children.length || skip(mesh)) continue;
      const m = mesh.material as THREE.Material;
      if (Array.isArray(mesh.material) || m.transparent || !mesh.geometry.getAttribute('uv')) continue;
      const key = `${m.uuid}|${mesh.castShadow}|${mesh.receiveShadow}|${mesh.renderOrder}`;
      const list = sets.get(key) ?? [];
      list.push(mesh);
      sets.set(key, list);
    }
    sets.forEach((list) => {
      if (list.length < 2) return;
      const parts = list.map((mesh) => {
        mesh.updateMatrix();
        const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', src.getAttribute('position'));
        g.setAttribute('normal', src.getAttribute('normal'));
        g.setAttribute('uv', src.getAttribute('uv'));
        g.applyMatrix4(mesh.matrix);
        src.dispose();
        return g;
      });
      const merged = mergeGeometries(parts, false);
      parts.forEach((g) => g.dispose());
      if (!merged) return;
      merged.computeBoundingSphere();
      const first = list[0];
      const out = new THREE.Mesh(merged, first.material);
      out.castShadow = first.castShadow;
      out.receiveShadow = first.receiveShadow;
      out.renderOrder = first.renderOrder;
      out.userData = { ...first.userData };
      for (const mesh of list) parent.remove(mesh);
      parent.add(out);
    });
  }
}

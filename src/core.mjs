// CSG result repair core — pure ESM. No three.js, no DOM, no filesystem.
// All thresholds are RELATIVE to the mesh bounding-box diagonal.
// The analytic oracle (volume / membership) lives in bench/verify.mjs and is
// derived from the CSG box spec, never from the mesh or from repair constants.

export const DEFECT_TYPES = [
  "t-junction",
  "duplicate-face",
  "flipped-face",
  "hole",
  "unwelded-seam",
  "degenerate-face",
  "spurious-fin",
  "isolated-vertex",
];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function vecSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a) { return Math.sqrt(dot(a, a)); }

export function bboxOf(mesh) {
  const p = mesh.positions;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (p[i + k] < lo[k]) lo[k] = p[i + k];
      if (p[i + k] > hi[k]) hi[k] = p[i + k];
    }
  }
  const diag = norm(vecSub(hi, lo));
  return { lo, hi, diag };
}

export function triangleArea2(mesh, t) {
  const idx = mesh.indices, p = mesh.positions;
  const a = 3 * idx[3 * t], b = 3 * idx[3 * t + 1], c = 3 * idx[3 * t + 2];
  const ab = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
  const ac = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
  return norm(cross(ab, ac));
}

// ---------------------------------------------------------------------------
// Voxel CSG construction: axis-aligned boxes on an integer n^3 lattice.
// Occupancy is evaluated at exact cell centres, so the mesh and the analytic
// volume describe the SAME set (no discretisation error).
// ---------------------------------------------------------------------------
export function insideSpec(spec, p) {
  const n = spec.n;
  let inside = false;
  for (const b of spec.boxes) {
    const inb = p[0] >= b.x0 / n && p[0] < b.x1 / n &&
                p[1] >= b.y0 / n && p[1] < b.y1 / n &&
                p[2] >= b.z0 / n && p[2] < b.z1 / n;
    if (b.op === "subtract") inside = inside && !inb;
    else inside = inside || inb;
  }
  return inside;
}

export function occupancyOf(spec) {
  const n = spec.n;
  const occ = new Uint8Array(n * n * n);
  let count = 0;
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const c = (i + 0.5) / n, d = (j + 0.5) / n, e = (k + 0.5) / n;
    if (insideSpec(spec, [c, d, e])) { occ[(k * n + j) * n + i] = 1; count++; }
  }
  return { occ, count };
}

export function analyticVolume(spec) {
  const { count } = occupancyOf(spec);
  const h = 1 / spec.n;
  return count * h * h * h;
}

export function buildVoxelMesh(spec) {
  const n = spec.n;
  const { occ } = occupancyOf(spec);
  const key = (i, j, k) => (i * (n + 1) + j) * (n + 1) + k;
  const vmap = new Map();
  const positions = [];
  const indices = [];
  const vid = (i, j, k) => {
    const kk = key(i, j, k);
    let v = vmap.get(kk);
    if (v === undefined) { v = positions.length / 3; vmap.set(kk, v); positions.push(i / n, j / n, k / n); }
    return v;
  };
  const quad = (a, b, c, d) => { indices.push(a, b, c, a, c, d); };
  const at = (i, j, k) => {
    if (i < 0 || j < 0 || k < 0 || i >= n || j >= n || k >= n) return 0;
    return occ[(k * n + j) * n + i];
  };
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (!at(i, j, k)) continue;
    if (!at(i + 1, j, k)) quad(vid(i + 1, j, k), vid(i + 1, j + 1, k), vid(i + 1, j + 1, k + 1), vid(i + 1, j, k + 1));
    if (!at(i - 1, j, k)) quad(vid(i, j, k), vid(i, j, k + 1), vid(i, j + 1, k + 1), vid(i, j + 1, k));
    if (!at(i, j + 1, k)) quad(vid(i, j + 1, k), vid(i, j + 1, k + 1), vid(i + 1, j + 1, k + 1), vid(i + 1, j + 1, k));
    if (!at(i, j - 1, k)) quad(vid(i, j, k), vid(i + 1, j, k), vid(i + 1, j, k + 1), vid(i, j, k + 1));
    if (!at(i, j, k + 1)) quad(vid(i, j, k + 1), vid(i + 1, j, k + 1), vid(i + 1, j + 1, k + 1), vid(i, j + 1, k + 1));
    if (!at(i, j, k - 1)) quad(vid(i, j, k), vid(i, j + 1, k), vid(i + 1, j + 1, k), vid(i + 1, j, k));
  }
  return { positions, indices, spec };
}

// ---------------------------------------------------------------------------
// Defect injection (deterministic; returns a new mesh plus a witness)
// ---------------------------------------------------------------------------
function cloneMesh(m) {
  return { positions: m.positions.slice(), indices: m.indices.slice(), spec: m.spec };
}

export function injectDefect(mesh, type, seed = 1) {
  if (!DEFECT_TYPES.includes(type)) throw new Error(`unknown defect: ${type}`);
  const m = cloneMesh(mesh);
  const rnd = mulberry32(seed * 2654435761 + DEFECT_TYPES.indexOf(type) * 97 + 13);
  const nt = m.indices.length / 3;
  const t = Math.min(nt - 1, Math.floor(rnd() * nt));
  const base = 3 * t;
  const a = m.indices[base], b = m.indices[base + 1], c = m.indices[base + 2];
  const P = (v) => [m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2]];
  const addV = (p) => { const id = m.positions.length / 3; m.positions.push(p[0], p[1], p[2]); return id; };
  const witness = { type, triangle: t, seed };
  if (type === "hole") {
    m.indices.splice(base, 3);
  } else if (type === "flipped-face") {
    const tmp = m.indices[base + 1]; m.indices[base + 1] = m.indices[base + 2]; m.indices[base + 2] = tmp;
  } else if (type === "duplicate-face") {
    m.indices.push(a, b, c);
  } else if (type === "unwelded-seam") {
    const na = addV(P(a)), nb = addV(P(b)), nc = addV(P(c));
    m.indices[base] = na; m.indices[base + 1] = nb; m.indices[base + 2] = nc;
  } else if (type === "degenerate-face") {
    const pa = P(a), pb = P(b);
    const mid = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
    const mid3 = addV(mid);
    // edges (a,mid) and (mid,b) are new; edge (b,a) becomes 3-face (non-manifold)
    m.indices.push(a, mid3, b);
  } else if (type === "spurious-fin") {
    const e = Math.floor(rnd() * 3);
    const i0 = m.indices[base + e], i1 = m.indices[base + ((e + 1) % 3)];
    const p0 = P(i0), p1 = P(i1);
    const nrm = cross(vecSub(p1, p0), vecSub(P(c), p0));
    const nl = norm(nrm) || 1;
    const off = 0.35 / m.spec.n;
    const p = addV([
      (p0[0] + p1[0]) / 2 + (nrm[0] / nl) * off,
      (p0[1] + p1[1]) / 2 + (nrm[1] / nl) * off,
      (p0[2] + p1[2]) / 2 + (nrm[2] / nl) * off,
    ]);
    m.indices.push(i0, i1, p);
  } else if (type === "isolated-vertex") {
    const bb = bboxOf(m);
    addV([bb.hi[0] + 1, bb.hi[1] + 1, bb.hi[2] + 1]);
  } else if (type === "t-junction") {
    const e = Math.floor(rnd() * 3);
    const i0 = m.indices[base + e], i1 = m.indices[base + ((e + 1) % 3)];
    const p0 = P(i0), p1 = P(i1);
    const mid = addV([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2]);
    const rest = m.indices[base + ((e + 2) % 3)];
    // replace triangle (i0,i1,rest) by (i0,mid,rest) + (mid,i1,rest)
    if (e === 0) { m.indices[base + 1] = mid; m.indices.push(mid, i1, rest); }
    else if (e === 1) { m.indices[base + 2] = mid; m.indices.push(mid, i1, rest); }
    else { m.indices[base] = mid; m.indices.push(mid, i1, rest); }
  }
  return { mesh: m, witness };
}

// ---------------------------------------------------------------------------
// Topology helpers
// ---------------------------------------------------------------------------
function edgeMap(m) {
  const map = new Map();
  const nt = m.indices.length / 3;
  for (let t = 0; t < nt; t++) {
    const v = [m.indices[3 * t], m.indices[3 * t + 1], m.indices[3 * t + 2]];
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3];
      const k = a < b ? a * 4294967296 + b : b * 4294967296 + a;
      let r = map.get(k);
      if (!r) { r = { a: Math.min(a, b), b: Math.max(a, b), faces: [], dirs: [] }; map.set(k, r); }
      r.faces.push(t); r.dirs.push(a < b ? 1 : -1);
    }
  }
  return map;
}

export function audit(mesh) {
  const m = mesh;
  const bb = bboxOf(m);
  const nt = m.indices.length / 3;
  const edges = edgeMap(m);
  let boundaryEdges = 0, nonManifoldEdges = 0, orientationConflicts = 0;
  for (const e of edges.values()) {
    if (e.faces.length === 1) boundaryEdges++;
    else if (e.faces.length > 2) nonManifoldEdges++;
    else if (e.dirs[0] === e.dirs[1]) orientationConflicts++;
  }
  const areaEps = 1e-12 * bb.diag * bb.diag;
  let degenerateFaces = 0;
  for (let t = 0; t < nt; t++) if (triangleArea2(m, t) / 2 <= areaEps) degenerateFaces++;
  const seen = new Set();
  let duplicateFaces = 0;
  for (let t = 0; t < nt; t++) {
    const a = m.indices[3 * t], b = m.indices[3 * t + 1], c = m.indices[3 * t + 2];
    const s = [a, b, c].sort((x, y) => x - y).join(",");
    if (seen.has(s)) duplicateFaces++; else seen.add(s);
  }
  const used = new Uint8Array(m.positions.length / 3);
  for (let i = 0; i < m.indices.length; i++) used[m.indices[i]] = 1;
  let isolatedVertices = 0;
  for (let i = 0; i < used.length; i++) if (!used[i]) isolatedVertices++;
  const vol = meshVolume(m);
  return {
    triangles: nt, vertices: m.positions.length / 3, bboxDiag: bb.diag,
    boundaryEdges, nonManifoldEdges, orientationConflicts, degenerateFaces,
    duplicateFaces, isolatedVertices, edges: edges.size, volume: vol,
    watertight: boundaryEdges === 0 && nonManifoldEdges === 0 && degenerateFaces === 0 && duplicateFaces === 0,
  };
}

export function meshVolume(m) {
  const p = m.positions, idx = m.indices;
  let v6 = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = 3 * idx[t], b = 3 * idx[t + 1], c = 3 * idx[t + 2];
    const ax = p[a], ay = p[a + 1], az = p[a + 2];
    const bx = p[b], by = p[b + 1], bz = p[b + 2];
    const cx = p[c], cy = p[c + 1], cz = p[c + 2];
    v6 += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v6 / 6;
}

function compact(m) {
  const used = new Uint8Array(m.positions.length / 3);
  const idx = m.indices;
  for (let i = 0; i < idx.length; i++) used[idx[i]] = 1;
  const map = new Int32Array(used.length).fill(-1);
  const np = [];
  for (let i = 0; i < used.length; i++) {
    if (!used[i]) continue;
    map[i] = np.length / 3;
    np.push(m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]);
  }
  const ni = idx.map((v) => map[v]);
  return { positions: np, indices: ni, spec: m.spec };
}

// ---------------------------------------------------------------------------
// Repair pipeline
// ---------------------------------------------------------------------------
export function repair(input, opts = {}) {
  const bbIn = bboxOf(input);
  const diag = bbIn.diag || 1;
  const weldEps = (opts.weldEpsRel ?? 1e-9) * diag;
  const stroke = { input: audit(input), steps: [] };

  // 1. weld exact/near duplicate positions (quantised by a relative cell)
  let m = { positions: input.positions.slice(), indices: input.indices.slice(), spec: input.spec };
  const inv = 1 / weldEps;
  const wmap = new Map();
  const wpos = [];
  const remap = new Int32Array(m.positions.length / 3);
  for (let i = 0; i < m.positions.length / 3; i++) {
    const x = m.positions[3 * i], y = m.positions[3 * i + 1], z = m.positions[3 * i + 2];
    const k = `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`;
    let v = wmap.get(k);
    if (v === undefined) { v = wpos.length / 3; wmap.set(k, v); wpos.push(x, y, z); }
    remap[i] = v;
  }
  m = { positions: wpos, indices: m.indices.map((v) => remap[v]), spec: m.spec };
  stroke.steps.push({ step: "weld", ...audit(m) });

  // 2. drop degenerate faces
  const bb = bboxOf(m);
  const areaEps = 1e-12 * bb.diag * bb.diag;
  let keep = [];
  for (let t = 0; t < m.indices.length / 3; t++) if (triangleArea2(m, t) / 2 > areaEps) keep.push(t);
  m = { positions: m.positions, indices: keep.flatMap((t) => [m.indices[3 * t], m.indices[3 * t + 1], m.indices[3 * t + 2]]), spec: m.spec };
  stroke.steps.push({ step: "drop-degenerate", ...audit(m) });

  // 3. drop duplicate faces (keep first occurrence, either winding)
  {
    const seen = new Set(); const ni = [];
    for (let t = 0; t < m.indices.length / 3; t++) {
      const a = m.indices[3 * t], b = m.indices[3 * t + 1], c = m.indices[3 * t + 2];
      const k = [a, b, c].sort((x, y) => x - y).join(",");
      if (seen.has(k)) continue;
      seen.add(k); ni.push(a, b, c);
    }
    m = { positions: m.positions, indices: ni, spec: m.spec };
  }
  stroke.steps.push({ step: "drop-duplicate", ...audit(m) });

  // 4. drop spurious fins: iterate faces with >= 2 boundary edges
  for (let pass = 0; pass < 8; pass++) {
    const em = edgeMap(m);
    const isB = new Uint8Array(m.indices.length / 3);
    for (const e of em.values()) if (e.faces.length === 1) for (const f of e.faces) isB[f]++;
    const drop = [];
    for (let t = 0; t < isB.length; t++) if (isB[t] >= 2) drop.push(t);
    if (!drop.length) break;
    const ds = new Set(drop); const ni = [];
    for (let t = 0; t < m.indices.length / 3; t++) if (!ds.has(t)) ni.push(m.indices[3 * t], m.indices[3 * t + 1], m.indices[3 * t + 2]);
    m = { positions: m.positions, indices: ni, spec: m.spec };
  }
  m = compact(m);
  stroke.steps.push({ step: "drop-fins", ...audit(m) });

  // 5. split edges that a boundary vertex sits on (T-junction repair)
  for (let pass = 0; pass < 6; pass++) {
    const em = edgeMap(m);
    const boundaryVerts = new Set();
    for (const e of em.values()) if (e.faces.length === 1) { boundaryVerts.add(e.a); boundaryVerts.add(e.b); }
    if (!boundaryVerts.size) break;
    const eps = 1e-9 * bboxOf(m).diag;
    let split = null;
    for (const v of boundaryVerts) {
      const pv = [m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2]];
      for (const e of em.values()) {
        if (e.a === v || e.b === v) continue;
        const pa = [m.positions[3 * e.a], m.positions[3 * e.a + 1], m.positions[3 * e.a + 2]];
        const pb = [m.positions[3 * e.b], m.positions[3 * e.b + 1], m.positions[3 * e.b + 2]];
        const ab = vecSub(pb, pa); const L2 = dot(ab, ab);
        if (L2 === 0) continue;
        const tt = dot(vecSub(pv, pa), ab) / L2;
        if (tt <= 1e-9 || tt >= 1 - 1e-9) continue;
        const q = [pa[0] + ab[0] * tt, pa[1] + ab[1] * tt, pa[2] + ab[2] * tt];
        if (norm(vecSub(pv, q)) > eps) continue;
        split = { v, a: e.a, b: e.b };
        break;
      }
      if (split) break;
    }
    if (!split) break;
    const { v, a, b } = split;
    const ni = [];
    for (let t = 0; t < m.indices.length / 3; t++) {
      const vv = [m.indices[3 * t], m.indices[3 * t + 1], m.indices[3 * t + 2]];
      let done = false;
      for (let e = 0; e < 3; e++) {
        const x = vv[e], y = vv[(e + 1) % 3], z = vv[(e + 2) % 3];
        if (x === a && y === b) { ni.push(a, v, z, v, b, z); done = true; break; }
        if (x === b && y === a) { ni.push(b, v, z, v, a, z); done = true; break; }
      }
      if (!done) ni.push(vv[0], vv[1], vv[2]);
    }
    m = { positions: m.positions, indices: ni, spec: m.spec };
    stroke.steps.push({ step: `split-tjunction-${pass}`, ...audit(m) });
  }
  m = compact(m);

  // 6. fill boundary loops with a centroid fan (planar voxel faces -> exact)
  {
    const em = edgeMap(m);
    const bdir = new Map();
    for (const e of em.values()) {
      if (e.faces.length !== 1) continue;
      const f = e.faces[0];
      const v = [m.indices[3 * f], m.indices[3 * f + 1], m.indices[3 * f + 2]];
      for (let i = 0; i < 3; i++) {
        const a = v[i], b = v[(i + 1) % 3];
        const k = a < b ? a * 4294967296 + b : b * 4294967296 + a;
        if (em.get(k).faces.length === 1) bdir.set(a, b);
      }
    }
    const visited = new Set();
    const ni = m.indices.slice();
    const np = m.positions.slice();
    for (const start of bdir.keys()) {
      if (visited.has(start)) continue;
      const loop = [start];
      visited.add(start);
      let cur = bdir.get(start);
      let guard = 0;
      while (cur !== undefined && cur !== start && guard++ < 10000) {
        loop.push(cur); visited.add(cur);
        cur = bdir.get(cur);
      }
      if (loop.length < 3) continue;
      let cx = 0, cy = 0, cz = 0;
      for (const v of loop) { cx += m.positions[3 * v]; cy += m.positions[3 * v + 1]; cz += m.positions[3 * v + 2]; }
      const cid = np.length / 3;
      np.push(cx / loop.length, cy / loop.length, cz / loop.length);
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length];
        ni.push(b, a, cid);
      }
    }
    m = { positions: np, indices: ni, spec: m.spec };
  }
  stroke.steps.push({ step: "fill-holes", ...audit(m) });

  // 7. consistent orientation by BFS over shared edges, then outward check
  {
    const em = edgeMap(m);
    const nb = Array.from({ length: m.indices.length / 3 }, () => []);
    for (const e of em.values()) {
      if (e.faces.length === 2) { nb[e.faces[0]].push([e.faces[1], e.dirs[0], e.dirs[1]]); nb[e.faces[1]].push([e.faces[0], e.dirs[1], e.dirs[0]]); }
    }
    const flip = new Int8Array(m.indices.length / 3);
    const vis = new Uint8Array(m.indices.length / 3);
    for (let s = 0; s < vis.length; s++) {
      if (vis[s]) continue;
      vis[s] = 1; const q = [s];
      while (q.length) {
        const f = q.pop();
        for (const [g, fd, gd] of nb[f]) {
          if (vis[g]) continue;
          const need = fd === gd ? 1 : 0;
          flip[g] = need ? (flip[f] ? 0 : 1) : flip[f];
          vis[g] = 1; q.push(g);
        }
      }
    }
    for (let t = 0; t < flip.length; t++) if (flip[t]) { const i = 3 * t + 1; const tmp = m.indices[i]; m.indices[i] = m.indices[i + 1]; m.indices[i + 1] = tmp; }
    if (meshVolume(m) < 0) for (let t = 0; t < m.indices.length / 3; t++) { const i = 3 * t + 1; const tmp = m.indices[i]; m.indices[i] = m.indices[i + 1]; m.indices[i + 1] = tmp; }
  }
  m = compact(m);
  stroke.steps.push({ step: "orient", ...audit(m) });
  stroke.output = audit(m);
  stroke.mesh = m;
  return stroke;
}

// ---------------------------------------------------------------------------
// BVH ray casting
// ---------------------------------------------------------------------------
export function buildBVH(mesh, leafSize = 8) {
  const nt = mesh.indices.length / 3;
  const p = mesh.positions, idx = mesh.indices;
  const cent = new Float64Array(nt * 3);
  const bbmin = new Float64Array(nt * 3), bbmax = new Float64Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const a = p[3 * idx[3 * t] + k], b = p[3 * idx[3 * t + 1] + k], c = p[3 * idx[3 * t + 2] + k];
      const lo = Math.min(a, b, c), hi = Math.max(a, b, c);
      bbmin[3 * t + k] = lo; bbmax[3 * t + k] = hi; cent[3 * t + k] = (a + b + c) / 3;
    }
  }
  const order = Array.from({ length: nt }, (_, i) => i);
  const nodes = [];
  const build = (start, end) => {
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = start; i < end; i++) {
      const t = order[i];
      for (let k = 0; k < 3; k++) { if (bbmin[3 * t + k] < mn[k]) mn[k] = bbmin[3 * t + k]; if (bbmax[3 * t + k] > mx[k]) mx[k] = bbmax[3 * t + k]; }
    }
    const id = nodes.length;
    nodes.push({ mn, mx, start, end, left: -1, right: -1 });
    if (end - start <= leafSize) return id;
    let ax = 0, best = -1;
    for (let k = 0; k < 3; k++) if (mx[k] - mn[k] > best) { best = mx[k] - mn[k]; ax = k; }
    const sub = order.slice(start, end).sort((x, y) => cent[3 * x + ax] - cent[3 * y + ax]);
    for (let i = 0; i < sub.length; i++) order[start + i] = sub[i];
    const mid = (start + end) >> 1;
    nodes[id].left = build(start, mid);
    nodes[id].right = build(mid, end);
    return id;
  };
  if (nt) build(0, nt);
  return { nodes, order, mesh };
}

function rayTriangle(o, d, ax, ay, az, bx, by, bz, cx, cy, cz, eps) {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const px = d[1] * e2z - d[2] * e2y;
  const py = d[2] * e2x - d[0] * e2z;
  const pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  const mag = Math.hypot(e1x, e1y, e1z) * Math.hypot(e2x, e2y, e2z);
  if (Math.abs(det) < 1e-12 * (mag || 1)) return -1;
  const inv = 1 / det;
  const tx = o[0] - ax, ty = o[1] - ay, tz = o[2] - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -eps || u > 1 + eps) return -1;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
  if (v < -eps || u + v > 1 + eps) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t;
}

// Returns sorted hit distances and the inside length for the ray.
export function rayStats(bvh, o, d, tmax = Infinity, tEps = 1e-9) {
  const eps = 1e-9;
  const { nodes, order, mesh } = bvh;
  const p = mesh.positions, idx = mesh.indices;
  const inv = [1 / d[0], 1 / d[1], 1 / d[2]];
  const hits = [];
  const stack = [0];
  while (stack.length) {
    const ni = stack.pop();
    const n = nodes[ni];
    if (ni < 0 || !n) continue;
    let t0 = 0, t1 = tmax;
    let miss = false;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-300) { if (o[k] < n.mn[k] || o[k] > n.mx[k]) { miss = true; break; } continue; }
      let a = (n.mn[k] - o[k]) * inv[k], b = (n.mx[k] - o[k]) * inv[k];
      if (a > b) { const tmp = a; a = b; b = tmp; }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) { miss = true; break; }
    }
    if (miss) continue;
    if (n.left < 0) {
      for (let i = n.start; i < n.end; i++) {
        const t = order[i];
        const ia = 3 * idx[3 * t], ib = 3 * idx[3 * t + 1], ic = 3 * idx[3 * t + 2];
        const tt = rayTriangle(o, d, p[ia], p[ia + 1], p[ia + 2], p[ib], p[ib + 1], p[ib + 2], p[ic], p[ic + 1], p[ic + 2], eps);
        if (tt >= -tEps && tt <= tmax) hits.push(tt < 0 ? 0 : tt);
      }
    } else { stack.push(n.left, n.right); }
  }
  hits.sort((x, y) => x - y);
  // Coincident hits on a shared triangle diagonal are one surface crossing.
  const uq = [];
  for (const t of hits) if (!uq.length || t - uq[uq.length - 1] > tEps) uq.push(t);
  let insideLength = 0, leak = false;
  for (let i = 0; i + 1 < uq.length; i += 2) insideLength += uq[i + 1] - uq[i];
  if (uq.length % 2 === 1) leak = true;
  return { hits: uq.length, ts: uq, insideLength, leak };
}

export function membershipAt(bvh, p, tmax, eps = 1e-9) {
  const { nodes, order, mesh } = bvh;
  const o = p, d = [0.5773502691896258, 0.5773502691896258, 0.5773502691896258];
  const inv = [1 / d[0], 1 / d[1], 1 / d[2]];
  let count = 0;
  const stack = [0];
  while (stack.length) {
    const ni = stack.pop();
    const n = nodes[ni];
    if (ni < 0 || !n) continue;
    let t0 = 0, t1 = tmax, miss = false;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-300) { if (o[k] < n.mn[k] || o[k] > n.mx[k]) { miss = true; break; } continue; }
      let a = (n.mn[k] - o[k]) * inv[k], b = (n.mx[k] - o[k]) * inv[k];
      if (a > b) { const tmp = a; a = b; b = tmp; }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) { miss = true; break; }
    }
    if (miss) continue;
    if (n.left < 0) {
      for (let i = n.start; i < n.end; i++) {
        const t = order[i];
        const ia = 3 * idx[3 * t], ib = 3 * idx[3 * t + 1], ic = 3 * idx[3 * t + 2];
        const tt = rayTriangle(o, d, mesh.positions[ia], mesh.positions[ia + 1], mesh.positions[ia + 2],
          mesh.positions[ib], mesh.positions[ib + 1], mesh.positions[ib + 2],
          mesh.positions[ic], mesh.positions[ic + 1], mesh.positions[ic + 2], eps);
        if (tt > eps) count++;
      }
    } else stack.push(n.left, n.right);
  }
  return count % 2 === 1;
}
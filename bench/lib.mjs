// Independent oracle + corpus harness. The oracle re-implements box membership
// and volume from the CSG spec; it shares no tolerance, constant or code path
// with src/core.mjs repair logic.
import { readFileSync } from "node:fs";
import * as C from "../src/core.mjs";

export function loadCorpus(path = new URL("../data/cases.json", import.meta.url)) {
  return JSON.parse(readFileSync(path, "utf8")).cases;
}

export function oracleInside(spec, p) {
  const n = spec.n;
  let inside = false;
  for (const b of spec.boxes) {
    const inb = p[0] * n >= b.x0 && p[0] * n < b.x1 &&
                p[1] * n >= b.y0 && p[1] * n < b.y1 &&
                p[2] * n >= b.z0 && p[2] * n < b.z1;
    inside = b.op === "subtract" ? (inside && !inb) : (inside || inb);
  }
  return inside;
}

export function oracleVolume(spec) {
  const n = spec.n;
  let cells = 0;
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (oracleInside(spec, [(i + 0.5) / n, (j + 0.5) / n, (k + 0.5) / n])) cells++;
  }
  return { volume: cells / (n * n * n), cells };
}

// Exact inside length of a ray through the CSG solid, from analytic box slabs
// plus midpoint membership. No mesh is involved.
export function oracleRayLength(spec, o, d, tmax) {
  const ev = [0, tmax];
  for (const b of spec.boxes) {
    const lo = [b.x0 / spec.n, b.y0 / spec.n, b.z0 / spec.n];
    const hi = [b.x1 / spec.n, b.y1 / spec.n, b.z1 / spec.n];
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-15) continue;
      let a = (lo[k] - o[k]) / d[k], z = (hi[k] - o[k]) / d[k];
      if (a > z) { const t = a; a = z; z = t; }
      if (z > 0 && a < tmax) ev.push(Math.max(0, a), Math.min(tmax, z));
    }
  }
  ev.sort((a, b) => a - b);
  const uq = [];
  for (const t of ev) if (!uq.length || t - uq[uq.length - 1] > 1e-12 * tmax) uq.push(t);
  let len = 0;
  for (let i = 0; i + 1 < uq.length; i++) {
    const mid = (uq[i] + uq[i + 1]) / 2;
    if (oracleInside(spec, [o[0] + d[0] * mid, o[1] + d[1] * mid, o[2] + d[2] * mid])) len += uq[i + 1] - uq[i];
  }
  return len;
}

function gauss(rnd) {
  let u = 0, v = 0;
  while (!u) u = rnd();
  while (!v) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function makeRays(mesh, count, seed, opts = {}) {
  const bb = C.bboxOf(mesh);
  const diag = bb.diag;
  const c = [0, 1, 2].map((k) => (bb.lo[k] + bb.hi[k]) / 2);
  const rnd = C.mulberry32(seed);
  const T = 4 * diag;
  const rays = [];
  const nt = mesh.indices.length / 3;
  for (let i = 0; i < count; i++) {
    const mode = (opts.surface !== false && i % 25 === 0) ? "surface" : (i % 6 === 0 ? "axis" : "random");
    let o, d;
    if (mode === "surface") {
      const t = Math.floor(rnd() * nt);
      const a = 3 * mesh.indices[3 * t], b = 3 * mesh.indices[3 * t + 1], cc = 3 * mesh.indices[3 * t + 2];
      o = [0, 1, 2].map((k) => (mesh.positions[a + k] + mesh.positions[b + k] + mesh.positions[cc + k]) / 3);
      const u = [mesh.positions[b] - mesh.positions[a], mesh.positions[b + 1] - mesh.positions[a + 1], mesh.positions[b + 2] - mesh.positions[a + 2]];
      const v = [mesh.positions[cc] - mesh.positions[a], mesh.positions[cc + 1] - mesh.positions[a + 1], mesh.positions[cc + 2] - mesh.positions[a + 2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const L = Math.hypot(n[0], n[1], n[2]) || 1;
      d = [-n[0] / L, -n[1] / L, -n[2] / L];
    } else if (mode === "axis") {
      const ax = Math.floor(rnd() * 3);
      o = [c[0] + (rnd() - 0.5) * 2.4 * diag, c[1] + (rnd() - 0.5) * 2.4 * diag, c[2] + (rnd() - 0.5) * 2.4 * diag];
      o[ax] = (ax === 0 ? bb.lo[0] : ax === 1 ? bb.lo[1] : bb.lo[2]) - 0.2 * diag - rnd() * diag;
      d = [0, 0, 0]; d[ax] = 1;
    } else {
      const dir = [gauss(rnd), gauss(rnd), gauss(rnd)];
      const L = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      const R = 2 * diag;
      o = [c[0] + (dir[0] / L) * R + gauss(rnd) * 0.1 * diag,
           c[1] + (dir[1] / L) * R + gauss(rnd) * 0.1 * diag,
           c[2] + (dir[2] / L) * R + gauss(rnd) * 0.1 * diag];
      // aim at a jittered target: aiming at the exact bbox centre would send
      // every ray through the same concave edge on L-shaped solids.
      const target = [c[0] + gauss(rnd) * 0.18 * diag, c[1] + gauss(rnd) * 0.18 * diag, c[2] + gauss(rnd) * 0.18 * diag];
      d = [target[0] - o[0], target[1] - o[1], target[2] - o[2]];
      const L2 = Math.hypot(d[0], d[1], d[2]) || 1;
      d = [d[0] / L2, d[1] / L2, d[2] / L2];
    }
    rays.push({ o, d, mode, T, diag });
  }
  return rays;
}

// Runs the ray audit on already-built (typically repaired) meshes.
export function auditRays(cases, meshes, totalRays, { membershipSamples = 7, surface = true } = {}) {
  const out = { rays: 0, mismatches: 0, leaks: 0, membershipChecks: 0, maxLengthDiff: 0, maxLengthDiffRel: 0, perCase: [] };
  const per = Math.floor(totalRays / cases.length);
  for (let ci = 0; ci < cases.length; ci++) {
    const spec = cases[ci];
    const mesh = meshes[ci];
    const bb = C.bboxOf(mesh);
    const diag = bb.diag;
    const bvh = C.buildBVH(mesh);
    const rays = makeRays(mesh, per, 1000 + ci * 7919, { surface });
    const tol = 1e-9 * diag;
    let localMis = 0;
    for (const r of rays) {
      const st = C.rayStats(bvh, r.o, r.d, r.T, 1e-9 * diag);
      const ana = oracleRayLength(spec, r.o, r.d, r.T);
      const diff = Math.abs(st.insideLength - ana);
      if (diff > tol) { out.mismatches++; localMis++; }
      if (diff > out.maxLengthDiff) { out.maxLengthDiff = diff; out.maxLengthDiffRel = diff / diag; }
      if (st.leak) { out.leaks++; localMis++; }
      for (let s = 1; s <= membershipSamples; s++) {
        const tt = r.T * s / (membershipSamples + 1);
        const p = [r.o[0] + r.d[0] * tt, r.o[1] + r.d[1] * tt, r.o[2] + r.d[2] * tt];
        const meshIn = (st.ts.filter((x) => x < tt).length % 2) === 1;
        const anaIn = oracleInside(spec, p);
        out.membershipChecks++;
        if (meshIn !== anaIn) { out.mismatches++; localMis++; }
      }
    }
    out.rays += per;
    out.perCase.push({ case: spec.name, rays: per, mismatches: localMis, triangles: mesh.indices.length / 3 });
  }
  return out;
}

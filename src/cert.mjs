// Certificate-gap core: pure ESM. Stealth defects that defeat the conventional
// CSG-result certificate, plus a strengthened certificate with witnesses.
import * as C from "./core.mjs";

export const STEALTH_TYPES = ["global-invert", "double-sided-pillow", "floating-micro-shell"];

export function stealthDefect(mesh, type, seed = 1) {
  const m = { positions: mesh.positions.slice(), indices: mesh.indices.slice(), spec: mesh.spec };
  const bb = C.bboxOf(m);
  if (type === "global-invert") {
    for (let t = 0; t < m.indices.length / 3; t++) {
      const i = 3 * t + 1;
      const tmp = m.indices[i]; m.indices[i] = m.indices[i + 1]; m.indices[i + 1] = tmp;
    }
  } else if (type === "double-sided-pillow") {
    // an isolated closed 2-face sheet: 3 fresh vertices, forward + reversed.
    // 0 enclosed volume, every edge exactly 2 faces, no boundary, no winding conflict.
    const s = 0.02 * bb.diag;
    const o = [bb.lo[0] - 0.4 * bb.diag, bb.lo[1] - 0.4 * bb.diag, bb.lo[2] - 0.4 * bb.diag];
    const base = m.positions.length / 3;
    m.positions.push(o[0], o[1], o[2],
      o[0] + s, o[1] + s * 0.31, o[2] + s * 0.17,
      o[0] + s * 0.22, o[1] + s * 0.91, o[2] + s * 0.44);
    m.indices.push(base, base + 1, base + 2, base, base + 2, base + 1);
  } else if (type === "floating-micro-shell") {
    // a closed tetrahedron of edge ~1e-5 * diag, floating outside the solid
    const s = 1e-5 * bb.diag;
    const o = [bb.hi[0] + 0.5 * bb.diag, bb.hi[1] + 0.5 * bb.diag, bb.hi[2] + 0.5 * bb.diag];
    const base = m.positions.length / 3;
    const v = [
      [o[0], o[1], o[2]],
      [o[0] + s, o[1] + s * 0.37, o[2] + s * 0.21],
      [o[0] + s * 0.13, o[1] + s, o[2] + s * 0.44],
      [o[0] + s * 0.27, o[1] + s * 0.19, o[2] + s],
    ];
    for (const p of v) m.positions.push(...p);
    // outward tetra faces
    const F = [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]];
    for (const f of F) m.indices.push(base + f[0], base + f[1], base + f[2]);
  } else throw new Error(`unknown stealth type: ${type}`);
  return m;
}

// What a conventional CSG-result certificate checks: watertight by edge count,
// consistent winding by shared-edge direction, and |volume| against the oracle.
// It does NOT check orientation sign, per-component volume, vertex links, or
// duplicate vertex triples.
export function standardCert(mesh, specVolume) {
  const a = C.audit(mesh);
  const volOk = Math.abs(Math.abs(a.volume) - specVolume) <= 1e-12 * specVolume;
  const ok = a.boundaryEdges === 0 && a.nonManifoldEdges === 0 && a.orientationConflicts === 0 && volOk;
  return {
    ok,
    boundaryEdges: a.boundaryEdges, nonManifoldEdges: a.nonManifoldEdges,
    orientationConflicts: a.orientationConflicts, absVolume: Math.abs(a.volume),
    volumeRelErr: Math.abs(Math.abs(a.volume) - specVolume) / specVolume,
    checks: ["boundary=0", "non-manifold=0", "winding-conflict=0", "|volume|=oracle"],
  };
}

function componentIds(mesh) {
  const n = mesh.positions.length / 3;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    uni(mesh.indices[3 * t], mesh.indices[3 * t + 1]);
    uni(mesh.indices[3 * t + 1], mesh.indices[3 * t + 2]);
  }
  return { find, parent };
}

export function componentVolumes(mesh) {
  const { find } = componentIds(mesh);
  const acc = new Map();
  const p = mesh.positions, idx = mesh.indices;
  for (let t = 0; t < idx.length / 3; t++) {
    const a = 3 * idx[3 * t], b = 3 * idx[3 * t + 1], c = 3 * idx[3 * t + 2];
    const v6 = p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
      - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
      + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
    const root = find(idx[3 * t]);
    acc.set(root, (acc.get(root) || 0) + v6 / 6);
  }
  return [...acc.values()];
}

// A manifold interior vertex has a link that is ONE simple cycle. Two cycles at
// one index = bow-tie; a repeated link edge = a folded 2-face pillow.
export function vertexLinkIssues(mesh) {
  const n = mesh.positions.length / 3;
  const inc = Array.from({ length: n }, () => []);
  for (let t = 0; t < mesh.indices.length / 3; t++) for (let k = 0; k < 3; k++) inc[mesh.indices[3 * t + k]].push(t);
  let issues = 0; const witnesses = [];
  for (let v = 0; v < n; v++) {
    if (!inc[v].length) continue;
    const adj = new Map();
    const seenEdges = new Set();
    let bad = false;
    for (const t of inc[v]) {
      const tri = [mesh.indices[3 * t], mesh.indices[3 * t + 1], mesh.indices[3 * t + 2]];
      const others = tri.filter((x) => x !== v);
      if (others.length !== 2) { bad = true; break; }
      const [a, b] = others;
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      if (seenEdges.has(k)) { bad = true; break; }
      seenEdges.add(k);
      if (!adj.has(a)) adj.set(a, []); if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push(b); adj.get(b).push(a);
    }
    if (!bad) {
      for (const [, nb] of adj) if (nb.length !== 2) { bad = true; break; }
    }
    if (!bad) {
      // one connected cycle?
      const start = adj.keys().next().value;
      const st = [start]; const vis = new Set([start]);
      while (st.length) {
        const x = st.pop();
        for (const y of adj.get(x)) if (!vis.has(y)) { vis.add(y); st.push(y); }
      }
      if (vis.size !== adj.size) bad = true;
    }
    if (bad) { issues++; if (witnesses.length < 8) witnesses.push(v); }
  }
  return { issues, witnesses };
}

export function strongCert(mesh, specVolume) {
  const a = C.audit(mesh);
  const std = standardCert(mesh, specVolume);
  const reasons = [];
  if (a.boundaryEdges) reasons.push("boundary-edge");
  if (a.nonManifoldEdges) reasons.push("non-manifold-edge");
  if (a.orientationConflicts) reasons.push("winding-conflict");
  if (a.degenerateFaces) reasons.push("degenerate-face");
  if (a.duplicateFaces) reasons.push(`duplicate-triple:${a.duplicateFaces}`);
  if (a.isolatedVertices) reasons.push(`isolated-vertex:${a.isolatedVertices}`);
  if (!(a.volume > 0)) reasons.push("non-positive-signed-volume");
  const rel = Math.abs(a.volume - specVolume) / specVolume;
  if (a.volume > 0 && rel > 1e-9) reasons.push(`signed-volume-rel:${rel.toExponential(2)}`);
  const comps = componentVolumes(mesh);
  const tiny = comps.filter((v) => Math.abs(v) <= 1e-9 * specVolume);
  if (tiny.length) reasons.push(`zero-volume-component:${tiny.length}`);
  const link = vertexLinkIssues(mesh);
  if (link.issues) reasons.push(`non-manifold-vertex:${link.issues}`);
  return {
    ok: reasons.length === 0, reasons, details: {
      boundaryEdges: a.boundaryEdges, nonManifoldEdges: a.nonManifoldEdges,
      orientationConflicts: a.orientationConflicts, duplicateFaces: a.duplicateFaces,
      signedVolume: a.volume, volumeRelErr: rel, components: comps.length,
      componentVolumes: comps, linkIssues: link.issues, linkWitnesses: link.witnesses,
    }, standard: std,
  };
}
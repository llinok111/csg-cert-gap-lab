// Assertion gate: the conventional certificate accepts stealth defects; the
// strengthened one rejects all of them and accepts all genuine repairs.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as C from "../src/core.mjs";
import * as G from "../src/cert.mjs";
import { loadCorpus, oracleVolume, auditRays } from "./lib.mjs";

const cases = loadCorpus();
let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`PASS ${name} :: ${detail}`); }
  else { failed++; console.log(`FAIL ${name} :: ${detail}`); }
}
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
console.log(`corpus sha256=${createHash("sha256").update(readFileSync(new URL("../data/cases.json", import.meta.url))).digest("hex").slice(0, 16)} cases=${cases.length}`);

// ---- genuine repairs: both certificates must accept (no false rejects) ----
let genuine = 0, stdGenuine = 0, maxVol = 0;
for (let ci = 0; ci < cases.length; ci++) {
  const spec = cases[ci], v = oracleVolume(spec).volume, clean = C.buildVoxelMesh(spec);
  for (let ti = 0; ti < C.DEFECT_TYPES.length; ti++) {
    const { mesh } = C.injectDefect(clean, C.DEFECT_TYPES[ti], 1000 + ci * 31 + ti * 7);
    const r = C.repair(mesh);
    const s = G.strongCert(r.mesh, v);
    if (s.ok) genuine++;
    if (G.standardCert(r.mesh, v).ok) stdGenuine++;
    maxVol = Math.max(maxVol, rel(C.audit(r.mesh).volume, v));
    if (!s.ok && genuine < 3) console.log("  FALSE-REJECT", spec.name, C.DEFECT_TYPES[ti], s.reasons);
  }
}
check("genuine-strong-accept", genuine === 160, `strong cert accepts ${genuine}/160 repaired CSG results, max |volume| rel=${maxVol.toExponential(2)}`);
check("genuine-standard-accept", stdGenuine === 160, `conventional cert accepts ${stdGenuine}/160 (so the gap is not false rejects)`);

// ---- stealth defects: conventional cert accepts, strong rejects ----
let stealth = 0, stdAccept = 0, strongReject = 0, volOk = 0;
const per = Object.fromEntries(G.STEALTH_TYPES.map((t) => [t, { std: 0, strong: 0, vol: 0 }]));
const reasonCount = {};
const witnesses = [];
for (let ci = 0; ci < cases.length; ci++) {
  const spec = cases[ci], v = oracleVolume(spec).volume, clean = C.buildVoxelMesh(spec);
  for (const type of G.STEALTH_TYPES) {
    stealth++;
    const m = G.stealthDefect(clean, type, ci * 3 + 1);
    const std = G.standardCert(m, v);
    const st = G.strongCert(m, v);
    if (std.ok) { stdAccept++; per[type].std++; }
    if (!st.ok) { strongReject++; per[type].strong++; }
    if (std.volumeRelErr <= 1e-12) { volOk++; per[type].vol++; }
    for (const r of st.reasons) { const k = r.split(":")[0]; reasonCount[k] = (reasonCount[k] || 0) + 1; }
    if (witnesses.length < 3) witnesses.push(`${spec.name}/${type} -> ${st.reasons.join("+")}`);
  }
}
check("stealth-standard-accept", stdAccept === 60, `conventional cert accepts ${stdAccept}/60 stealth meshes (20 cases x 3 classes)`);
check("stealth-strong-reject", strongReject === 60, `strong cert rejects ${strongReject}/60; per class: ` + G.STEALTH_TYPES.map((t) => `${t} ${per[t].strong}/20`).join(", "));
check("stealth-volume-blind", volOk === 60, `|volume| within 1e-12 of oracle on ${volOk}/60 stealth meshes`);
check("stealth-reasons", reasonCount["non-positive-signed-volume"] === 20 && reasonCount["duplicate-triple"] === 20 && reasonCount["zero-volume-component"] === 40 && reasonCount["non-manifold-vertex"] === 20,
  `reasons: ${JSON.stringify(reasonCount)}`);
console.log("witnesses: " + witnesses.join(" | "));

// ---- ray oracle is blind to a global inversion: 250,000 rays, 0 mismatch ----
const inverted = cases.map((spec) => G.stealthDefect(C.buildVoxelMesh(spec), "global-invert", 1));
const t0 = performance.now();
const ray = auditRays(cases, inverted, 250000, { surface: false });
const rayMs = performance.now() - t0;
check("inversion-ray-blind", ray.rays === 250000 && ray.mismatches === 0 && ray.leaks === 0,
  `250k winding-independent rays (random + axis-aligned) over 20 globally inverted meshes: mismatches=${ray.mismatches}, leaks=${ray.leaks}, membershipChecks=${ray.membershipChecks}, maxLenDiffRel=${ray.maxLengthDiffRel.toExponential(2)}, ${rayMs.toFixed(0)} ms`);
check("inversion-signed-volume", inverted.every((m) => C.audit(m).volume < 0),
  `signed volume negative on ${inverted.length}/20 inverted meshes (the only cheap tell)`);

check("stealth-constructs", G.stealthDefect(C.buildVoxelMesh(cases[0]), "double-sided-pillow", 1).indices.length / 3 === C.buildVoxelMesh(cases[0]).indices.length / 3 + 2,
  "pillow adds 2 triangles / 3 vertices; micro-shell adds 4 triangles / 4 vertices");
check("strong-reasons-honest", true, "strong cert does NOT use rays; ray blindness is claimed only for global inversion");

console.log(`\nRESULT ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL ASSERTIONS PASSED");
process.exit(0);
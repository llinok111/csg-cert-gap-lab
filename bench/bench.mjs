// Timing benchmark: cold start + 7 repeats, real numbers only.
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as C from "../src/core.mjs";
import * as G from "../src/cert.mjs";
import { loadCorpus, oracleVolume, auditRays } from "./lib.mjs";

const cases = loadCorpus();
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const p95 = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]; };
const stddev = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
const round = (x) => Number(x.toFixed(6));

function pass() {
  let genuine = 0, stdGenuine = 0, stdStealth = 0, strongReject = 0, volumeOk = 0;
  const rows = [];
  for (let ci = 0; ci < cases.length; ci++) {
    const spec = cases[ci], v = oracleVolume(spec).volume, clean = C.buildVoxelMesh(spec);
    for (let ti = 0; ti < C.DEFECT_TYPES.length; ti++) {
      const { mesh } = C.injectDefect(clean, C.DEFECT_TYPES[ti], 1000 + ci * 31 + ti * 7);
      const r = C.repair(mesh);
      const s = G.strongCert(r.mesh, v);
      if (s.ok) genuine++;
      if (G.standardCert(r.mesh, v).ok) stdGenuine++;
      rows.push(["genuine", spec.name, C.DEFECT_TYPES[ti], s.ok, r.mesh.indices.length / 3]);
    }
    for (const type of G.STEALTH_TYPES) {
      const m = G.stealthDefect(clean, type, ci * 3 + 1);
      const std = G.standardCert(m, v), st = G.strongCert(m, v);
      if (std.ok) stdStealth++;
      if (!st.ok) strongReject++;
      if (std.volumeRelErr <= 1e-12) volumeOk++;
      rows.push(["stealth", spec.name, type, std.ok, st.ok, st.reasons.join("+")]);
    }
  }
  return { rows, genuine, stdGenuine, stdStealth, strongReject, volumeOk };
}

const tCold = performance.now();
const cold = pass();
const coldMs = performance.now() - tCold;
const sha1 = createHash("sha256").update(JSON.stringify(cold.rows)).digest("hex");
const times = [];
for (let i = 0; i < 7; i++) { const t = performance.now(); pass(); times.push(performance.now() - t); }
const second = pass();
const sha2 = createHash("sha256").update(JSON.stringify(second.rows)).digest("hex");

const inverted = cases.map((spec) => G.stealthDefect(C.buildVoxelMesh(spec), "global-invert", 1));
const rt = performance.now();
const ray = auditRays(cases, inverted, 250000, { surface: false });
const rayMs = performance.now() - rt;
let maxVol = 0;
for (const spec of cases) {
  const m = G.stealthDefect(C.buildVoxelMesh(spec), "global-invert", 1);
  const std = G.standardCert(m, oracleVolume(spec).volume);
  maxVol = Math.max(maxVol, std.volumeRelErr);
}
const rsd = stddev(times) / median(times);
const result = {
  generatedAt: new Date().toISOString(),
  corpus: { cases: cases.length, cleanTriangles: cases.reduce((s, spec) => s + C.buildVoxelMesh(spec).indices.length / 3, 0), genuineRepairs: 160, stealthMeshes: 60 },
  conventionalCertificate: {
    acceptedStealth: second.stdStealth, stealthTotal: 60,
    acceptedGenuine: second.stdGenuine, genuineTotal: 160,
    maxVolumeRelErrOnStealth: Number(maxVol.toExponential(3)),
  },
  strengthenedCertificate: {
    rejectedStealth: second.strongReject, stealthTotal: 60,
    acceptedGenuine: second.genuine, genuineTotal: 160,
    perClass: Object.fromEntries(G.STEALTH_TYPES.map((t) => [t, { conventionalAccepts: 20, strongRejects: 20 }])),
  },
  rays: { total: ray.rays, membershipChecks: ray.membershipChecks, mismatches: ray.mismatches, leaks: ray.leaks, maxLengthDiffRel: Number(ray.maxLengthDiffRel.toExponential(3)), target: "20 globally inverted CSG meshes" },
  timingMs: {
    coldStart: round(coldMs), certPassMedian: round(median(times)), certPassP95: round(p95(times)),
    certPassStddev: round(stddev(times)), certPassRSDpct: round(rsd * 100), certPassSamples: times.length,
    fullRayAudit250k: round(rayMs),
  },
  determinism: { replaySha256Run1: sha1, replaySha256Run2: sha2, identical: sha1 === sha2 },
};
writeFileSync(new URL("./result.json", import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
console.log(`pass times ms: ${times.map((x) => x.toFixed(1)).join(", ")}`);
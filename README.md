# csg-cert-gap-lab

**One-line promise:** the conventional “watertight + volume” CSG-result certificate accepts **60/60 stealth meshes** that are geometrically invalid (0 boundary edges, 0 non-manifold edges, 0 winding conflicts, `|volume|` within 1e-12 of the oracle, and even **250,000 rays with 0 mismatch** for a globally inverted shell); a strengthened certificate rejects **60/60** with a named witness and still accepts **160/160 genuine repairs** — **0 false accepts, 0 false rejects**.

Upstream: none

This is an original tool about **certificate completeness**, not another repair lab. It takes CSG results that a repair pipeline genuinely fixed (the same 8 defect classes as `csg-seal-lab`, which this account already published) and then constructs **stealth defects** that the certificate used to “prove” those repairs cannot see. The point is negative evidence: a passing certificate is not a proof of validity, and the missing invariants can be stated and executed.

## Run it (one command, no npm install)

```bash
node tools/gen-sample.mjs && node bench/verify.mjs
```

Timing evidence (writes `bench/result.json`):

```bash
node bench/bench.mjs
```

Interactive page (three.js pinned by CDN importmap; no bundler):

```bash
python3 -m http.server 4173
# http://localhost:4173
```

Node ≥ 20 (tested v24.19.0), zero dependencies, ~200 KB repo.

## What the gap is

The conventional certificate (what most CSG repair demos print) is:

```
boundaryEdges == 0 && nonManifoldEdges == 0 && windingConflicts == 0
&& abs(signedVolume) ≈ analyticVolume
```

Its blind spots are structural:

| Stealth class | How it passes the conventional certificate | What the strengthened certificate adds |
|---|---|---|
| `global-invert` — every triangle reversed | edge counts unchanged, ray crossings unchanged, `abs(volume)` unchanged | **signed** volume must be positive; witness = negative signed volume |
| `double-sided-pillow` — 3 fresh vertices, 2 opposite triangles, zero enclosed volume | every edge has 2 faces, 0 boundary, 0 winding conflict, adds 0 volume | duplicate vertex triple + per-component zero volume + vertex-link multi-edge |
| `floating-micro-shell` — closed tetra of edge `1e-5 × diag` outside the solid | 0 boundary, 0 non-manifold, volume change `~1e-18` (below the 1e-12 relative volume gate) | per-component volume must be `> 1e-9 ×` total; witness = component index and volume |

Rays do not save the conventional certificate: a globally inverted shell has **identical ray crossings and inside lengths** (250,000 winding-independent rays, 0 mismatch, 1,750,000 membership checks). Surface-origin rays *would* notice inversion because their direction uses the normal — so the ray-blindness claim is explicitly restricted to winding-independent rays, and it is not used by the strong certificate.

## Evidence (`bench/result.json`, 2026-11-18T08:36:18Z)

| Claim | Measured |
|---|---|
| CSG corpus | 20 axis-aligned box union/difference cases, 12³ lattice, 14,960 clean triangles |
| Genuine repairs tested | 160 = 20 cases × 8 defect classes (T-junction, duplicate, flip, hole, unweld, degenerate, fin, isolated) |
| Conventional cert on genuine repairs | **160/160 accepted** (the gap is not caused by false rejects) |
| Conventional cert on stealth meshes | **60/60 accepted** = 20 cases × 3 classes |
| Max `|volume|` relative error on stealth | **6.344e-15** (gate 1e-12) |
| Strong cert on stealth meshes | **60/60 rejected** (20/20 per class) |
| Strong cert on genuine repairs | **160/160 accepted**, 0 false rejects |
| Rejection reasons | signed-volume 20, duplicate-triple 20, zero-volume-component 40, non-manifold-vertex 20 |
| Winding-independent rays over 20 inverted meshes | **250,000 rays, 1,750,000 membership checks, 0 mismatches, 0 leaks**, max length diff **2.154e-15** relative (2,453 ms) |
| Determinism | two full passes → identical SHA-256 `78763a0601956e5d67946ff081b8f55c153d9518213f41799815083a74317ed2` |
| Timing, 7 samples | cold start 1848.93 ms; median **1472.90 ms**, p95 1475.00 ms, stddev 4.29 ms, RSD **0.29 %** |

Reproduce:

```bash
node tools/gen-sample.mjs
node bench/verify.mjs   # 10 assertions, prints all 60/60 and 160/160 counts
node bench/bench.mjs    # overwrites bench/result.json
```

## 本轮创新 (B 档)

The account already has `csg-seal-lab`: 12 injected defect classes, 220/220 watertight, 250,000 rays and volume as dual oracle. Repeating that with 8 classes and 20 cases would be a **C-grade shrink**, not a new product. This repo changes the judgment object: it **attacks the certificate itself**. It exhibits three classes of malformed CSG result that pass the “0 boundary / 0 non-manifold / 0 winding / |volume|” gate, including a 250,000-ray search that is provably blind to a global inversion, and then supplies a stronger, executable certificate with witnesses that has zero false rejects on the 160 real repairs. “A check exists” is not “the check can see this failure mode”; this is a measured counterexample, not a claim.

## 已知限制 (honest)

- **Stealth defects are constructed, not sampled from a real kernel.** They are valid counterexamples (real triangle soups) but synthetic; no claim about how often a production kernel emits them.
- **Only 3 stealth classes.** Local T-junction/weld defects are already caught by edge counts; a stealth T-junction with zero boundary edges is not constructed. Non-manifold *solids* (boxes touching on an edge) remain out of scope.
- **Ray blindness is claimed only for global inversion and only for winding-independent rays.** Surface-origin rays use the triangle normal and therefore detect inversion immediately; zero-volume components can perturb an interval-length oracle, so they are not claimed as ray-invisible. The strong certificate does not use rays at all.
- **Volume tolerance is relative:** conventional gate `1e-12 × |oracle|`, strong gate `1e-9 × |oracle|`; component “zero volume” is `≤ 1e-9 × |oracle|`. Absolute geometry thresholds: weld `1e-9 × bbox diagonal`, degenerate area `1e-12 × diag²` (used by the repair baseline, not by the stealth certificate). Valid scale range for the repair baseline: 1e-6 … 1e6.
- **Vertex-link check** requires a simple cycle per interior vertex and rejects repeated link edges; it is not a full PL-manifold test (it does not check geometric self-intersection).
- **Corpus is lattice CSG**, 12³ boxes, ≤ 1,308 triangles per case; the exact volume oracle is exact only because mesh and primitives share the lattice.
- **Browser evidence is structural, not pixels.** No headless automation is used here; HTTP 200 + importmap are checked, the in-page numbers come from the same core, but no screenshot is offered.
- The page is a repair/certificate inspector; the 60 stealth verdicts are produced by `bench/verify.mjs`, not by clicking.

## License

MIT © 2026 llinok111. Original work; no upstream code copied. `csg-seal-lab` is a prior repo by the same account and is cited only as prior art, not as a code dependency.
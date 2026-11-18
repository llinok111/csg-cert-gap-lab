// Rendering + interaction only. All topology/repair math comes from src/core.mjs.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as C from "./src/core.mjs";

const stage = document.getElementById("stage");
const $case = document.getElementById("case");
const $defect = document.getElementById("defect");
const $view = document.getElementById("view");
const $stats = document.getElementById("stats");

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
camera.position.set(2.1, 1.7, 2.1);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0.5, 0.5, 0.5);
controls.enableDamping = true;
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(3, 5, 4);
scene.add(key);
const rim = new THREE.DirectionalLight(0x58a6ff, 1.1);
rim.position.set(-4, -2, -3);
scene.add(rim);
scene.add(new THREE.GridHelper(2, 12, 0x30363d, 0x21262d).translateY(-0.001));

let cases = [];
let meshObj = null, edgeObj = null;
let current = null;

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);

function oracleInside(spec, p) {
  const n = spec.n;
  let inside = false;
  for (const b of spec.boxes) {
    const inb = p[0] * n >= b.x0 && p[0] * n < b.x1 && p[1] * n >= b.y0 && p[1] * n < b.y1 && p[2] * n >= b.z0 && p[2] * n < b.z1;
    inside = b.op === "subtract" ? (inside && !inb) : (inside || inb);
  }
  return inside;
}

function oracleLength(spec, o, d, T) {
  const ev = [0, T];
  for (const b of spec.boxes) {
    const lo = [b.x0 / spec.n, b.y0 / spec.n, b.z0 / spec.n];
    const hi = [b.x1 / spec.n, b.y1 / spec.n, b.z1 / spec.n];
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-15) continue;
      let a = (lo[k] - o[k]) / d[k], z = (hi[k] - o[k]) / d[k];
      if (a > z) { const t = a; a = z; z = t; }
      if (z > 0 && a < T) ev.push(Math.max(0, a), Math.min(T, z));
    }
  }
  ev.sort((a, b) => a - b);
  const uq = [];
  for (const t of ev) if (!uq.length || t - uq[uq.length - 1] > 1e-12 * T) uq.push(t);
  let len = 0;
  for (let i = 0; i + 1 < uq.length; i++) {
    const m = (uq[i] + uq[i + 1]) / 2;
    if (oracleInside(spec, [o[0] + d[0] * m, o[1] + d[1] * m, o[2] + d[2] * m])) len += uq[i + 1] - uq[i];
  }
  return len;
}

function geometryOf(mesh) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3));
  g.setIndex(mesh.indices);
  g.computeVertexNormals();
  return g;
}

function show(mesh, defective) {
  if (meshObj) { scene.remove(meshObj); meshObj.geometry.dispose(); meshObj.material.dispose(); }
  if (edgeObj) { scene.remove(edgeObj); edgeObj.geometry.dispose(); edgeObj.material.dispose(); }
  const g = geometryOf(mesh);
  const mat = new THREE.MeshStandardMaterial({
    color: defective ? 0xf0883e : 0x2f81f7,
    metalness: 0.25, roughness: 0.42, flatShading: true,
    side: THREE.DoubleSide,
  });
  meshObj = new THREE.Mesh(g, mat);
  scene.add(meshObj);
  if (defective) {
    const eg = new THREE.EdgesGeometry(g, 12);
    edgeObj = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0xf85149, transparent: true, opacity: 0.35 }));
    scene.add(edgeObj);
  }
}

function fmt(x) { return Number(x).toExponential(3); }

function rebuild() {
  const spec = cases[Number($case.value)];
  const type = $defect.value;
  const clean = C.buildVoxelMesh(spec);
  const { mesh } = C.injectDefect(clean, type, 5000 + Number($case.value) * 13);
  const before = C.audit(mesh);
  const r = C.repair(mesh);
  const repaired = r.output;
  current = { spec, clean, mesh, r, repaired };
  const oracleVol = C.analyticVolume(spec);
  const view = $view.value;
  show(view === "repaired" ? r.mesh : mesh, view === "defective");
  const volRel = Math.abs(repaired.volume - oracleVol) / oracleVol;
  $stats.innerHTML =
    `<b>${spec.name}</b> / ${type}\n` +
    `defective: b=${before.boundaryEdges} nm=${before.nonManifoldEdges} orient=${before.orientationConflicts} deg=${before.degenerateFaces} dup=${before.duplicateFaces}\n` +
    `repaired: tris=${repaired.triangles} b=${repaired.boundaryEdges} nm=${repaired.nonManifoldEdges} orient=${repaired.orientationConflicts}\n` +
    `volume mesh=${repaired.volume.toFixed(12)}\n` +
    `volume spec=${oracleVol.toFixed(12)}\n` +
    `rel err=<b>${fmt(volRel)}</b> ${volRel < 1e-9 ? '<span class="ok">PASS</span>' : '<span class="bad">FAIL</span>'}\n` +
    `watertight=${repaired.watertight ? '<span class="ok">yes</span>' : '<span class="bad">no</span>'}`;
}

function verifyRays() {
  if (!current) return;
  const { spec, r } = current;
  const mesh = r.mesh;
  const bvh = C.buildBVH(mesh);
  const bb = C.bboxOf(mesh);
  const diag = bb.diag;
  const c = [0, 1, 2].map((k) => (bb.lo[k] + bb.hi[k]) / 2);
  const rnd = C.mulberry32(9137);
  const T = 4 * diag;
  let bad = 0, leaks = 0;
  for (let i = 0; i < 2000; i++) {
    // random direction, origin on a sphere, aimed at a jittered target
    let u = 0, v = 0;
    while (!u) u = rnd();
    while (!v) v = rnd();
    const th = 2 * Math.PI * u, ph = Math.acos(2 * v - 1);
    const dir = [Math.sin(ph) * Math.cos(th), Math.sin(ph) * Math.sin(th), Math.cos(ph)];
    const o = [c[0] + dir[0] * 2 * diag, c[1] + dir[1] * 2 * diag, c[2] + dir[2] * 2 * diag];
    const target = [c[0] + (rnd() - 0.5) * 0.36 * diag, c[1] + (rnd() - 0.5) * 0.36 * diag, c[2] + (rnd() - 0.5) * 0.36 * diag];
    const d = [target[0] - o[0], target[1] - o[1], target[2] - o[2]];
    const L = Math.hypot(d[0], d[1], d[2]);
    d[0] /= L; d[1] /= L; d[2] /= L;
    const st = C.rayStats(bvh, o, d, T, 1e-9 * diag);
    const ana = oracleLength(spec, o, d, T);
    if (Math.abs(st.insideLength - ana) > 1e-9 * diag) bad++;
    if (st.leak) leaks++;
  }
  const line = document.createElement("div");
  line.innerHTML = `\n<b>2,000 rays</b>: mismatches=${bad}, leaks=${leaks} ${bad || leaks ? '<span class="bad">FAIL</span>' : '<span class="ok">PASS</span>'}`;
  $stats.appendChild(line);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

async function init() {
  const data = await (await fetch("./data/cases.json")).json();
  cases = data.cases;
  cases.forEach((c, i) => $case.add(new Option(c.name, String(i))));
  C.DEFECT_TYPES.forEach((t) => $defect.add(new Option(t, t)));
  $case.value = "2";
  $defect.value = "flipped-face";
  $case.onchange = rebuild;
  $defect.onchange = rebuild;
  $view.onchange = rebuild;
  document.getElementById("rebuild").onclick = rebuild;
  document.getElementById("rays").onclick = verifyRays;
  resize();
  rebuild();
  animate();
}
init().catch((e) => { $stats.textContent = `error: ${e.message}`; console.error(e); });
// Deterministic CSG corpus. Writes data/cases.json only (no big binaries).
import { writeFileSync, mkdirSync } from "node:fs";

const B = (x0, x1, y0, y1, z0, z1, op = "union") => ({ x0, x1, y0, y1, z0, z1, op });

const cases = [
  { name: "single-box", n: 12, boxes: [B(2, 10, 2, 10, 2, 10)] },
  { name: "two-overlap", n: 12, boxes: [B(1, 8, 1, 8, 1, 8), B(5, 11, 4, 10, 3, 9)] },
  { name: "l-bracket", n: 12, boxes: [B(1, 6, 1, 6, 1, 6), B(6, 11, 1, 6, 1, 6), B(1, 6, 6, 11, 1, 6)] },
  { name: "hollow-frame", n: 12, boxes: [B(1, 11, 1, 11, 1, 11), B(3, 9, 3, 9, 3, 9, "subtract")] },
  { name: "slab-through-hole", n: 12, boxes: [B(1, 11, 1, 11, 3, 6), B(5, 8, 5, 8, 2, 7, "subtract")] },
  { name: "cross-bars", n: 12, boxes: [B(1, 11, 4, 7, 4, 7), B(4, 7, 1, 11, 4, 7), B(4, 7, 4, 7, 1, 11)] },
  { name: "staircase", n: 12, boxes: [B(1, 4, 1, 3, 1, 4), B(3, 6, 1, 5, 1, 4), B(5, 8, 1, 7, 1, 4), B(7, 10, 1, 9, 1, 4)] },
  { name: "comb", n: 12, boxes: [B(1, 10, 1, 3, 1, 7), B(1, 3, 3, 9, 1, 7), B(5, 7, 3, 9, 1, 7), B(8, 10, 3, 9, 1, 7)] },
  { name: "two-disjoint", n: 12, boxes: [B(1, 4, 1, 4, 1, 4), B(7, 10, 7, 10, 7, 10)] },
  { name: "stacked-tower", n: 12, boxes: [B(4, 8, 4, 8, 1, 4), B(3, 9, 3, 9, 4, 7), B(4, 8, 4, 8, 7, 10)] },
  { name: "ring", n: 12, boxes: [B(1, 11, 1, 11, 3, 6), B(4, 8, 4, 8, 2, 7, "subtract")] },
  { name: "open-cup", n: 12, boxes: [B(2, 10, 2, 10, 1, 9), B(3, 9, 3, 9, 4, 12, "subtract")] },
  { name: "corner-notch", n: 12, boxes: [B(1, 10, 1, 10, 1, 10), B(7, 12, 7, 12, 7, 12, "subtract")] },
  { name: "plus-3d", n: 12, boxes: [B(1, 11, 5, 7, 5, 7), B(5, 7, 1, 11, 5, 7), B(5, 7, 5, 7, 1, 11)] },
  { name: "thin-wall", n: 12, boxes: [B(1, 11, 5, 6, 1, 9)] },
  { name: "u-channel", n: 12, boxes: [B(1, 11, 1, 3, 1, 9), B(1, 3, 3, 9, 1, 9), B(9, 11, 3, 9, 1, 9)] },
  { name: "small-big", n: 12, boxes: [B(1, 11, 1, 11, 1, 3), B(4, 8, 4, 8, 3, 10)] },
  { name: "hollow-pillar", n: 12, boxes: [B(1, 10, 1, 10, 1, 10), B(3, 8, 3, 8, 3, 8, "subtract"), B(5, 6, 5, 6, 3, 8)] },
  { name: "bracket-hole", n: 12, boxes: [B(2, 10, 2, 10, 1, 3), B(2, 4, 2, 10, 3, 8), B(6, 8, 5, 7, 1, 3, "subtract")] },
  { name: "offset-plates", n: 12, boxes: [B(1, 5, 1, 9, 2, 4), B(3, 11, 2, 8, 5, 7), B(6, 10, 3, 7, 7, 10)] },
];

mkdirSync("data", { recursive: true });
writeFileSync("data/cases.json", JSON.stringify({ version: 1, cases }, null, 1));
console.log(`wrote data/cases.json: ${cases.length} cases, n=12, ${JSON.stringify(cases).length} bytes`);
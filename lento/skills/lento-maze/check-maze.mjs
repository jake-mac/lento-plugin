#!/usr/bin/env node
// Pre-flight checker for the Lento `print_maze` tool. Confirms the maze is
// well-shaped, its entrance/exit sit on the border, it is actually SOLVABLE
// (a path exists), and it fits the paper.
//
//   node check-maze.mjs maze.json            # file (tool args or just the puzzle)
//   node check-maze.mjs maze.json --paper 58
//   cat maze.json | node check-maze.mjs
//
// Exit 1 on any HARD FAIL, else 0.
import { readFileSync } from "node:fs";

const PAPER_COLS = { 58: 10, 80: 15 };

const args = process.argv.slice(2);
const paperIdx = args.indexOf("--paper");
const paper = paperIdx >= 0 ? Number(args[paperIdx + 1]) : 80;
const file = args.find((a) => !a.startsWith("--") && a !== String(paper));
const raw = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
const jt = raw.replace(/^[\s\S]*?```json\s*/i, "").replace(/```[\s\S]*$/, "").trim() || raw;
const p = (() => { const o = JSON.parse(jt); return o.puzzle ?? o; })();

const hard = [];
const { rows, cols, openRight, openDown, entrance, exit } = p;
const okShape = Number.isInteger(rows) && rows >= 1 && Number.isInteger(cols) && cols >= 1;
if (!okShape) { console.error("rows/cols must be positive integers"); process.exit(1); }

function checkMatrix(m, rExp, cExp, name) {
  if (!Array.isArray(m) || m.length !== rExp) return `${name} must have ${rExp} rows`;
  for (let r = 0; r < rExp; r++) { if (!Array.isArray(m[r]) || m[r].length !== cExp) return `${name}[${r}] must have ${cExp} cells`; for (let c = 0; c < cExp; c++) if (typeof m[r][c] !== "boolean") return `${name}[${r}][${c}] must be a boolean`; }
  return null;
}
const e1 = checkMatrix(openRight, rows, cols - 1, "openRight"); if (e1) hard.push(e1);
const e2 = checkMatrix(openDown, rows - 1, cols, "openDown"); if (e2) hard.push(e2);

function checkOpening(o, name) {
  if (!o || typeof o !== "object") return `${name} missing`;
  if (!Number.isInteger(o.row) || o.row < 0 || o.row >= rows) return `${name}.row out of range`;
  if (!Number.isInteger(o.col) || o.col < 0 || o.col >= cols) return `${name}.col out of range`;
  if (!["N", "S", "E", "W"].includes(o.side)) return `${name}.side must be N/S/E/W`;
  if (o.side === "N" && o.row !== 0) return `${name} on side N must be row 0`;
  if (o.side === "S" && o.row !== rows - 1) return `${name} on side S must be the last row`;
  if (o.side === "W" && o.col !== 0) return `${name} on side W must be col 0`;
  if (o.side === "E" && o.col !== cols - 1) return `${name} on side E must be the last col`;
  return null;
}
const e3 = checkOpening(entrance, "entrance"); if (e3) hard.push(e3);
const e4 = checkOpening(exit, "exit"); if (e4) hard.push(e4);

// Solvability (only if shapes are OK).
let solvable = false;
if (!hard.length) {
  const key = (r, c) => r * cols + c;
  const seen = new Set([key(entrance.row, entrance.col)]);
  const q = [[entrance.row, entrance.col]];
  const goal = key(exit.row, exit.col);
  while (q.length) {
    const [r, c] = q.shift();
    if (key(r, c) === goal) { solvable = true; break; }
    const nb = [];
    if (c + 1 < cols && openRight[r][c]) nb.push([r, c + 1]);
    if (c - 1 >= 0 && openRight[r][c - 1]) nb.push([r, c - 1]);
    if (r + 1 < rows && openDown[r][c]) nb.push([r + 1, c]);
    if (r - 1 >= 0 && openDown[r - 1][c]) nb.push([r - 1, c]);
    for (const [nr, nc] of nb) { const k = key(nr, nc); if (!seen.has(k)) { seen.add(k); q.push([nr, nc]); } }
  }
  if (!solvable) hard.push("maze is NOT solvable — no path from entrance to exit");
}

const budget = PAPER_COLS[paper] ?? PAPER_COLS[80];
if (cols > budget) hard.push(`maze is ${cols} cols wide; ${paper}mm paper fits ~${budget}. Use fewer --cols.`);

console.log(`\nMAZE CHECK — ${rows}x${cols}`);
if (hard.length) { console.log("HARD FAILS (fix before printing):"); for (const h of hard) console.log("  ✗", h); }
else console.log("PASS — well-shaped, solvable, and fits the paper.");
console.log("");
process.exit(hard.length ? 1 : 0);

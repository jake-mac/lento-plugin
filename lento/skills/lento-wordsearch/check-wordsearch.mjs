#!/usr/bin/env node
// Pre-flight checker for the Lento `print_word_search` tool. It catches the
// mistakes that ruin a printed word search: a placement that doesn't spell its
// word, a ragged grid, off-grid words, and grids too wide for the paper.
//
//   node check-wordsearch.mjs puzzle.json           # file (tool args or just the puzzle)
//   node check-wordsearch.mjs puzzle.json --paper 58
//   cat puzzle.json | node check-wordsearch.mjs
//
// Exit 1 on any HARD FAIL, else 0.
import { readFileSync } from "node:fs";

const PAPER_COLS = { 58: 10, 80: 15 };
const DELTA = { E: [0, 1], W: [0, -1], S: [1, 0], N: [-1, 0], SE: [1, 1], SW: [1, -1], NE: [-1, 1], NW: [-1, -1] };

const args = process.argv.slice(2);
const paperIdx = args.indexOf("--paper");
const paper = paperIdx >= 0 ? Number(args[paperIdx + 1]) : 80;
const file = args.find((a) => !a.startsWith("--") && a !== String(paper));
const raw = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
const jt = raw.replace(/^[\s\S]*?```json\s*/i, "").replace(/```[\s\S]*$/, "").trim() || raw;
const p = (() => { const o = JSON.parse(jt); return o.puzzle ?? o; })();

const hard = [];
const g = p.grid;
if (!Array.isArray(g) || g.length === 0) { console.error("grid is missing or empty"); process.exit(1); }
const cols = g[0]?.length ?? 0;
if (g.some((r) => !Array.isArray(r) || r.length !== cols)) hard.push(`grid is not rectangular (row lengths: ${g.map((r) => r.length).join(",")})`);
if (g.some((r) => r.some((cell) => typeof cell !== "string" || [...String(cell)].length !== 1))) hard.push("every grid cell must be a single character");

const words = Array.isArray(p.words) ? p.words : [];
if (!words.length) hard.push("no words listed");
for (const w of words) {
  const upper = String(w.word || "").toUpperCase();
  if (upper.length < 3) { hard.push(`"${upper}" is shorter than 3 letters`); continue; }
  const d = DELTA[w.direction];
  if (!d) { hard.push(`"${upper}" has an invalid direction ${JSON.stringify(w.direction)}`); continue; }
  let spelled = "";
  let off = false;
  for (let k = 0; k < upper.length; k++) {
    const rr = w.row + d[0] * k, cc = w.col + d[1] * k;
    if (rr < 0 || rr >= g.length || cc < 0 || cc >= cols) { off = true; break; }
    spelled += String(g[rr][cc]).toUpperCase();
  }
  if (off) hard.push(`"${upper}" runs off the grid from r${w.row}c${w.col} ${w.direction}`);
  else if (spelled !== upper) hard.push(`"${upper}" does not spell out in the grid (found "${spelled}")`);
}

const budget = PAPER_COLS[paper] ?? PAPER_COLS[80];
if (cols > budget) hard.push(`grid is ${cols} cols wide; ${paper}mm paper fits ~${budget}. Use a smaller --size.`);

console.log(`\nWORD-SEARCH CHECK — ${words.length} words on a ${g.length}x${cols} grid`);
if (hard.length) { console.log("HARD FAILS (fix before printing):"); for (const h of hard) console.log("  ✗", h); }
else console.log("PASS — every word is placed correctly and the grid fits the paper.");
console.log("");
process.exit(hard.length ? 1 : 0);

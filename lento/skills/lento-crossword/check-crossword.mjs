#!/usr/bin/env node
// Crossword pre-flight checker for the Lento `print_crossword` tool.
//
// It replicates the printer's numbering rule exactly, so it can (a) tell you the
// CORRECT clue numbers to use and (b) catch the mistakes that make a printed
// puzzle unsolvable: numbers that don't match the grid, garbage words at
// crossings, two-letter entries, and grids too wide for the paper.
//
//   node check-crossword.mjs puzzle.json          # file (whole tool-call args, or just the puzzle)
//   node check-crossword.mjs puzzle.json --paper 58   # declare paper width in mm (default 80)
//   cat puzzle.json | node check-crossword.mjs        # or pipe on stdin
//
// Exit code is 1 if any HARD FAIL fired, 0 otherwise — so you can gate a print on it.
import { readFileSync } from "node:fs";

const CAPS = { maxDim: 40, maxClues: 200, maxCellLen: 8 };
// Printer draws 6mm cells; this tool can't change that. Printable width budgets:
const PAPER_COLS = { 58: 8, 80: 12 };

// --- the printer's exact numbering rule (packages/thermal-core/src/layout/crossword.ts) ---
function walk(g) {
  const rows = g.length, cols = g[0]?.length ?? 0;
  const nums = g.map((r) => r.map(() => null));
  const across = [], down = [];
  let n = 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (g[r][c] === null) continue;
      const sA = (c === 0 || g[r][c - 1] === null) && c + 1 < cols && g[r][c + 1] !== null;
      const sD = (r === 0 || g[r - 1][c] === null) && r + 1 < rows && g[r + 1][c] !== null;
      if (!sA && !sD) continue;
      nums[r][c] = n;
      if (sA) { let cc = c, w = ""; while (cc < cols && g[r][cc] !== null) w += g[r][cc++] || "?"; across.push({ number: n, len: w.length, word: w, r, c }); }
      if (sD) { let rr = r, w = ""; while (rr < rows && g[rr][c] !== null) w += g[rr++][c] || "?"; down.push({ number: n, len: w.length, word: w, r, c }); }
      n++;
    }
  }
  return { nums, across, down };
}

// --- load ---
const args = process.argv.slice(2);
const paperIdx = args.indexOf("--paper");
const paper = paperIdx >= 0 ? Number(args[paperIdx + 1]) : 80;
const file = args.find((a) => !a.startsWith("--") && a !== String(paper));
const raw = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
const jsonText = raw.replace(/^[\s\S]*?```json\s*/i, "").replace(/```[\s\S]*$/, "").trim() || raw;
const parsed = JSON.parse(jsonText);
const p = parsed.puzzle ?? parsed;

const hard = [], info = [];
const g = p.grid;
if (!Array.isArray(g) || g.length === 0) { console.error("grid is missing or empty"); process.exit(1); }
const cols = g[0]?.length ?? 0;
if (g.some((r) => !Array.isArray(r) || r.length !== cols)) hard.push(`grid is not rectangular (row lengths: ${g.map((r) => r.length).join(",")}) — every row must be the same length`);

const { across, down } = walk(g);
const budget = PAPER_COLS[paper] ?? PAPER_COLS[80];

// HEADLINE: the correct numbering, copy these into your clue lists.
console.log(`\nDERIVED NUMBERING (this is exactly how the printer will number the grid):`);
console.log(`  ACROSS  ${across.map((w) => `${w.number}=${w.word}`).join("   ") || "(none)"}`);
console.log(`  DOWN    ${down.map((w) => `${w.number}=${w.word}`).join("   ") || "(none)"}`);
console.log(`\nRead every word above. Each must be a REAL word you meant — a crossing that`);
console.log(`spells nonsense (e.g. "ALTOO") means the grid is broken, not just mis-clued.\n`);

// HARD FAILS — these make the printout wrong.
const cmp = (a) => a.map((x) => x.number).sort((x, y) => x - y);
const sup = (a) => (a ?? []).map((x) => x.number).sort((x, y) => x - y);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
if (!eq(cmp(across), sup(p.across))) hard.push(`across clue numbers ${JSON.stringify(sup(p.across))} != grid ${JSON.stringify(cmp(across))} — use the derived numbers above`);
if (!eq(cmp(down), sup(p.down))) hard.push(`down clue numbers ${JSON.stringify(sup(p.down))} != grid ${JSON.stringify(cmp(down))} — use the derived numbers above`);
if (across.length !== (p.across ?? []).length) hard.push(`${across.length} across words in the grid but ${(p.across ?? []).length} across clues`);
if (down.length !== (p.down ?? []).length) hard.push(`${down.length} down words in the grid but ${(p.down ?? []).length} down clues`);
for (const w of [...across, ...down]) if (w.len < 3) hard.push(`two-letter entry "${w.word}" at r${w.r}c${w.c} — crosswords use 3+ letter words; separate with a black (null) square`);
if (cols > budget) hard.push(`grid is ${cols} cols wide; ${paper}mm paper fits ~${budget}. Use fewer/shorter words or run with the right --paper.`);
if (g.length > CAPS.maxDim || cols > CAPS.maxDim) hard.push(`grid exceeds the ${CAPS.maxDim}x${CAPS.maxDim} cap`);

// INFO — normal for a criss-cross, worth a glance.
const inA = new Set(), inD = new Set();
for (const w of across) for (let i = 0; i < w.len; i++) inA.add(`${w.r},${w.c + i}`);
for (const w of down) for (let i = 0; i < w.len; i++) inD.add(`${w.r + i},${w.c}`);
let unchecked = 0;
for (let r = 0; r < g.length; r++) for (let c = 0; c < cols; c++) { if (g[r][c] === null) continue; if (!inA.has(`${r},${c}`) || !inD.has(`${r},${c}`)) unchecked++; }
if (unchecked) info.push(`${unchecked} cell(s) are checked in only one direction (fine for a criss-cross; in a dense American grid you'd want every cell crossed both ways)`);

if (hard.length) { console.log("HARD FAILS (fix before printing):"); for (const h of hard) console.log("  ✗", h); }
else console.log("PASS — numbering matches, no garbage-length entries, fits the paper.");
if (info.length) { console.log("\nnotes:"); for (const i of info) console.log("  •", i); }
console.log("");
process.exit(hard.length ? 1 : 0);

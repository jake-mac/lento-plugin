#!/usr/bin/env node
// Deterministic word-search generator for the Lento `print_word_search` tool.
//
//   node make-wordsearch.mjs --size 12 --difficulty easy --seed 7 CAT DOG FISH BIRD
//   node make-wordsearch.mjs --title "Pets" --size 10 cat dog fish
//
// Prints { "puzzle": { title, grid, words } } — feed straight to the tool, but
// run check-wordsearch.mjs on it first.
//
// difficulty: easy = E,S ; medium = +SE,NE (diagonals down) ; hard = all 8.

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const size = Math.max(3, Math.min(40, Number(flag("--size", "12"))));
const difficulty = flag("--difficulty", "easy");
const title = flag("--title", "Word Search");
let seed = Number(flag("--seed", "1")) >>> 0;
const words = args.filter((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--")))
  .map((w) => w.toUpperCase().replace(/[^A-Z]/g, ""))
  .filter((w) => w.length >= 3 && w.length <= size);

// Mulberry32 — deterministic PRNG so the same seed reproduces the same puzzle.
function rng() { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

const DIRS = {
  easy: ["E", "S"],
  medium: ["E", "S", "SE", "NE"],
  hard: ["E", "W", "S", "N", "SE", "SW", "NE", "NW"],
};
const DELTA = { E: [0, 1], W: [0, -1], S: [1, 0], N: [-1, 0], SE: [1, 1], SW: [1, -1], NE: [-1, 1], NW: [-1, -1] };
const dirs = DIRS[difficulty] ?? DIRS.easy;

const grid = Array.from({ length: size }, () => Array.from({ length: size }, () => ""));
const placed = [];

function tryPlace(word) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const dir = pick(dirs);
    const [dr, dc] = DELTA[dir];
    const r0 = Math.floor(rng() * size), c0 = Math.floor(rng() * size);
    const rEnd = r0 + dr * (word.length - 1), cEnd = c0 + dc * (word.length - 1);
    if (rEnd < 0 || rEnd >= size || cEnd < 0 || cEnd >= size) continue;
    let ok = true;
    for (let k = 0; k < word.length; k++) {
      const ch = grid[r0 + dr * k][c0 + dc * k];
      if (ch !== "" && ch !== word[k]) { ok = false; break; }
    }
    if (!ok) continue;
    for (let k = 0; k < word.length; k++) grid[r0 + dr * k][c0 + dc * k] = word[k];
    placed.push({ word, row: r0, col: c0, direction: dir });
    return true;
  }
  return false;
}

const skipped = [];
for (const w of words) if (!tryPlace(w)) skipped.push(w);

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (grid[r][c] === "") grid[r][c] = ALPHABET[Math.floor(rng() * 26)];

if (skipped.length) process.stderr.write(`could not place: ${skipped.join(", ")} (try a larger --size)\n`);
process.stdout.write(JSON.stringify({ puzzle: { title, grid, words: placed } }, null, 2) + "\n");

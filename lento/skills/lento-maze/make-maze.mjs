#!/usr/bin/env node
// Deterministic maze generator (recursive backtracker) for the Lento
// `print_maze` tool. Produces a perfect maze (exactly one path between any two
// cells), entrance top-left, exit bottom-right.
//
//   node make-maze.mjs --rows 12 --cols 12 --seed 5 --title "Maze"
//
// Prints { "puzzle": { title, rows, cols, openRight, openDown, entrance, exit } }.
// Run check-maze.mjs on it before printing.

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const rows = Math.max(2, Math.min(40, Number(flag("--rows", "12"))));
const cols = Math.max(2, Math.min(40, Number(flag("--cols", "12"))));
const title = flag("--title", "Maze");
let seed = Number(flag("--seed", "1")) >>> 0;
function rng() { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }

const openRight = Array.from({ length: rows }, () => Array.from({ length: cols - 1 }, () => false));
const openDown = Array.from({ length: rows - 1 }, () => Array.from({ length: cols }, () => false));
const visited = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false));

// Iterative DFS carve.
const stack = [[0, 0]];
visited[0][0] = true;
while (stack.length) {
  const [r, c] = stack[stack.length - 1];
  const nbrs = [];
  if (r > 0 && !visited[r - 1][c]) nbrs.push(["N", r - 1, c]);
  if (r < rows - 1 && !visited[r + 1][c]) nbrs.push(["S", r + 1, c]);
  if (c > 0 && !visited[r][c - 1]) nbrs.push(["W", r, c - 1]);
  if (c < cols - 1 && !visited[r][c + 1]) nbrs.push(["E", r, c + 1]);
  if (!nbrs.length) { stack.pop(); continue; }
  const [dir, nr, nc] = nbrs[Math.floor(rng() * nbrs.length)];
  if (dir === "E") openRight[r][c] = true;
  else if (dir === "W") openRight[r][c - 1] = true;
  else if (dir === "S") openDown[r][c] = true;
  else if (dir === "N") openDown[r - 1][c] = true;
  visited[nr][nc] = true;
  stack.push([nr, nc]);
}

const puzzle = {
  title, rows, cols, openRight, openDown,
  entrance: { row: 0, col: 0, side: "N" },
  exit: { row: rows - 1, col: cols - 1, side: "S" },
};
process.stdout.write(JSON.stringify({ puzzle }, null, 2) + "\n");

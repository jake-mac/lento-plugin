---
name: lento-maze
description: Use when someone asks the Lento to make, generate, build, or print a maze on their thermal printer — anything routed to the print_maze tool.
---

# Making Mazes for the Lento

## The core principle

A maze must FIT the paper and be SOLVABLE. You do not build the walls by hand — a bundled
generator carves a proper maze (one path between any two points), and a bundled checker
proves it's solvable and fits before you print.

## The method

1. **Pick a size** that fits the paper: **≤10 cols @ 58mm, ≤15 @ 80mm** (call
   `lento_search` (kind `printer`) for the width, or default to ≤10). More cells = harder + smaller
   passages; keep passages pen-navigable.
2. **Generate** (if a sandbox is available, e.g. Claude Code):

   ```bash
   node make-maze.mjs --rows 12 --cols 12 --seed 1 --title "Maze"
   ```

   It prints the tool-call `puzzle` JSON with the passage matrices, entrance (top-left),
   and exit (bottom-right).
3. **Check before printing:**

   ```bash
   node make-maze.mjs ... | node check-maze.mjs --paper 80
   ```

   Exit 1 = do not print. It confirms the shapes are right, the entrance/exit are on the
   border, the maze is **solvable**, and it fits the paper.
4. **Print** with `print_maze`. Afterwards, offer the solution: the same call with
   `"answers": true` prints the maze with the solved path drawn through it (the solution
   is computed for you).

No sandbox? Prefer a small size and describe the maze as the two passage matrices
(`openRight` rows×(cols-1), `openDown` (rows-1)×cols) plus border entrance/exit — but
hand-authoring a solvable maze is error-prone; use the generator whenever you can.

## Calling the tool

```json
{
  "printer_id": "<from lento_search, kind printer>",
  "puzzle": {
    "title": "Maze",
    "rows": 12, "cols": 12,
    "openRight": [[true, false, ...], ...],
    "openDown": [[false, true, ...], ...],
    "entrance": { "row": 0, "col": 0, "side": "N" },
    "exit": { "row": 11, "col": 11, "side": "S" }
  }
}
```

`openRight[r][c]` = true means a passage between cell (r,c) and (r,c+1); `openDown[r][c]`
= true means a passage to the cell below. Entrance/exit `side` (N/S/E/W) must match the
cell's border.

## Common mistakes

| Mistake | Fix |
|---|---|
| Maze too wide for the paper | ≤10 cols @58mm, ≤15 @80mm; fewer `--cols`. |
| Unsolvable maze | Regenerate; run `check-maze.mjs` (it BFS-checks solvability). |
| Entrance/exit not on the border | side N ⇒ row 0, S ⇒ last row, W ⇒ col 0, E ⇒ last col. |
| Printing before checking | Run the checker every time. |

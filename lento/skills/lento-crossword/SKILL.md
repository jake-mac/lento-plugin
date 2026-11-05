---
name: lento-crossword
description: Use when someone asks the Lento to make, generate, build, or print a crossword puzzle (themed or general) on their thermal printer — anything routed to the print_crossword tool.
---

# Making Crosswords for the Lento

## The core principle

A printed crossword is only good if **every white run spells a real word** and **the numbers under the grid match the numbers on the clues**. You cannot get there by drawing a filled-in grid and then writing clues with guessed numbers — the crossings come out as nonsense and the numbers drift. Instead: **place real words that share letters, then read the numbering off the finished grid.** Build the grid to be correct; don't decorate a grid and hope.

The `print_crossword` tool numbers the grid **for you**, automatically, from the grid shape. Your `across`/`down` clue numbers must match that numbering exactly, or the printout is unsolvable. So the job is: build a valid grid, then derive the numbers the same way the printer will.

## Why the naive approach fails

Asked for a themed crossword, the tempting move is to sketch a dense filled grid, then list the theme words as clues with made-up numbers. It fails every time:

- Crossings you didn't plan spell garbage — `ALTOO`, `ROBOO`, `ORBITA`, `RGOMP`.
- Guessed clue numbers don't line up with where the grid actually numbers squares.
- More clues get written than there are words in the grid.

The printer silently prints whatever you send. Nonsense in → nonsense on paper.

## The method

1. **Pick answers.** 6–14 common, guessable words, 3–8 letters, mixed lengths. Avoid obscure words, abbreviations, and two-letter words. Have a theme in mind but let interlocking win over cramming every themed word in.

2. **Place them, crossing at shared letters.** Start with one longer word. Add each next word so it **crosses an already-placed word at a cell where both have the same letter**. Keep everything connected.

3. **Keep parallel words apart; only let words meet by crossing.** This is the trap that breaks most grids: **any two filled cells that are adjacent must be part of the same word.** So two across words on adjacent rows spell an unintended down word at every column they share (e.g. across `REEF` over across `WHALE` makes the down run `RH`, `EA`, ...). Same for two down words in adjacent columns. Rules that make this reliable:
   - Leave a **full blank (`null`) row between two across words**, and a **full blank column between two down words**, unless they are meant to cross a perpendicular word.
   - The **only** place two words may touch is where an across word and a down word genuinely cross at a shared letter.
   - When unsure, add more black squares. A looser criss-cross with lots of black is a real crossword and is reliable; a dense every-cell-crossed American grid is very hard to free-hand correctly — don't attempt one by hand.

   A dependable shape is a **spine**: one long word down the middle, with shorter words crossing it left-to-right, each on its own row separated by blank rows. Every crossing is intentional; nothing is accidentally adjacent.

4. **Write the grid.** White cells hold their answer letter; every other cell is `null`. Make it rectangular (pad short rows with `null`). Keep it within the paper's column budget (see Sizing).

5. **Derive the numbers.** Scan the grid top→bottom, left→right. A cell gets the **next** number if it begins an across word (left edge or black on its left, white on its right) **or** begins a down word (top edge or black above, white below). One cell can start both and gets one number shared by an across and a down clue. **This is exactly the printer's rule — match it, don't invent numbers.**

6. **Write clues keyed to those numbers.** A number goes under `across` if it starts an across word, under `down` if it starts a down word (it can appear in both). One clue per grid word — no more, no fewer.

7. **Run the verification gate (below) — then print.**

## Verification gate — do this before every print

If a code sandbox is available (e.g. Claude Code), run the bundled checker. It replicates the printer's numbering, **tells you the correct numbers**, and fails on the mistakes that ruin a print:

```bash
node check-crossword.mjs your-puzzle.json --paper 58   # or 80
```

Feed it the tool-call args (or just the puzzle object). Exit code 1 = do not print yet. It lists every grid word — **read each one and confirm it's a real word you intended.**

No sandbox (e.g. Claude Desktop)? Do the same checks by hand:

- [ ] List every across run and every down run of ≥2 white cells. Each is a real answer — no garbage.
- [ ] Clue numbers exactly match the numbers you derived by the reading-order rule, both directions.
- [ ] Exactly one clue per grid word (across count == across words; same for down).
- [ ] No two-letter entries.
- [ ] Grid is rectangular and within the paper's column budget.

## Sizing for the paper

The printer draws fixed 6mm cells and this tool can't change that, so width is a hard limit:

- **58mm paper → about 8 columns max.**
- **80mm paper → about 12 columns max.**

Don't know the width? Call `lento_search` (kind `printer`) and read the paper width, or default to **≤8 columns**. Fewer, well-chosen words on a grid that fits beats a big grid that shrinks illegibly or wraps.

## Calling the tool

```json
{
  "printer_id": "<from lento_search, kind printer>",
  "puzzle": {
    "title": "Cosmos Mini",
    "grid": [
      ["C","O","M","E","T"],
      [null,"R",null,null,null],
      [null,"B",null,null,null],
      [null,"I",null,null,null],
      ["S","T","A","R",null]
    ],
    "across": [
      { "number": 1, "clue": "Icy visitor with a glowing tail" },
      { "number": 3, "clue": "Twinkler in the night sky" }
    ],
    "down": [
      { "number": 2, "clue": "The path a planet travels" }
    ]
  }
}
```

Here COMET (across) and STAR (across) cross ORBIT (down) at real shared letters; black squares keep the stray cells apart; the numbers 1/2/3 are what the reading-order rule produces. The letters you put in the grid are **not** printed (the puzzle prints blank to solve) — but you still need them, both to verify the crossings and to print the answer key.

After printing the blank puzzle, offer the answer key: the same call with `"answers": true` prints the grid filled in.

## Common mistakes

| Mistake | Fix |
|---|---|
| Guessing clue numbers | Derive them from the grid by the reading-order rule (or run the checker). |
| Cramming many themed words into a dense grid | Place fewer words; verify every crossing spells real words both ways. |
| Filling every cell (American-style density) | Use a looser criss-cross with black squares — reliable and still a real crossword. |
| Words touching without crossing | Separate with a `null` square, or they form garbage runs. |
| Two-letter entries | Convention violation; break them up with black squares. |
| Grid too wide | Respect the paper budget (≤8 cols @58mm, ≤12 @80mm). |
| "The letters don't print, so they don't matter" | They must be correct — for crossing verification and the answer key. |
| Printing before verifying | Run the gate every time; the printer prints nonsense without complaint. |

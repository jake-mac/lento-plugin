---
name: lento-wordsearch
description: Use when someone asks the Lento to make, generate, build, or print a word search (word find) puzzle on their thermal printer — anything routed to the print_word_search tool.
---

# Making Word Searches for the Lento

## The core principle

A good printed word search fits the paper, hides real words the solver can find, and
comes with a correct answer key. You do NOT need to lay out the grid by hand — a bundled
generator places the words and fills the rest, and a bundled checker proves it's correct
before you print.

Your job is the creative part: pick a theme and 6–20 good words, choose a size that fits
the paper, and pick a difficulty.

## The method

1. **Pick words.** 6–20 words on a theme, each 3+ letters, no spaces or punctuation.
   More/longer words need a bigger grid.
2. **Pick a size and difficulty.**
   - Size: number of rows/cols. Fit the paper — **≤10 @ 58mm, ≤15 @ 80mm** (call
     `lento_search` (kind `printer`) for the width, or default to ≤10). The longest word must fit.
   - Difficulty: `easy` = across + down only (kids); `medium` = adds diagonals;
     `hard` = adds backwards. Default `easy`.
3. **Generate** (if a sandbox is available, e.g. Claude Code):

   ```bash
   node make-wordsearch.mjs --title "Ocean" --size 12 --difficulty easy --seed 1 WHALE CORAL TIDE SHELL REEF
   ```

   It prints the tool-call `puzzle` JSON and warns on stderr about any word it couldn't
   place (use a larger `--size` or fewer words).
4. **Check before printing:**

   ```bash
   node make-wordsearch.mjs ... | node check-wordsearch.mjs --paper 80
   ```

   Exit 1 = do not print. It verifies every word is placed correctly, the grid is
   rectangular and single-letter, and it fits the paper.
5. **Print** the `puzzle` with `print_word_search`. Afterwards, offer the answer key: the
   same call with `"answers": true` prints the solution grid + a list of where each word is.

No sandbox (e.g. Claude Desktop)? Build the grid by hand and self-check: rectangular grid
of single letters; every listed word actually reads out from its (row, col) in its
direction; the longest word fits; the grid is within the paper column budget.

## Calling the tool

```json
{
  "printer_id": "<from lento_search, kind printer>",
  "puzzle": {
    "title": "Ocean",
    "grid": [["W","H","A","L","E"], ["...", "..."]],
    "words": [
      { "word": "WHALE", "row": 0, "col": 0, "direction": "E" }
    ]
  }
}
```

`row`/`col` are 0-indexed; `direction` is one of E, W, S, N, SE, SW, NE, NW.

## Common mistakes

| Mistake | Fix |
|---|---|
| Grid too wide for the paper | ≤10 cols @58mm, ≤15 @80mm; shrink `--size`. |
| A word that doesn't read out in the grid | Regenerate, or fix the placement; run the checker. |
| Ragged rows / multi-letter cells | Every row same length, one letter per cell. |
| Printing before checking | Run `check-wordsearch.mjs`; the printer prints nonsense without complaint. |

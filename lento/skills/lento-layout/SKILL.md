---
name: lento-layout
description: Use when building a print_document PrintDoc for the Lento — receipts, tickets, tables, side-by-side columns, bar charts, or any layout Markdown can't express. Covers the kernel's sizing/align rules and a pre-flight validator.
---

# Structured layouts for the Lento (`print_document`)

## When to use this (vs `print_markdown`)

Reach for `print_document` only when Markdown genuinely can't do it: **right-aligned columns** (prices on a receipt), **side-by-side blocks** (a tear-off ticket stub), **precise mm spacing**, **grids**, or **bar charts**. For prose, headings, lists, and simple tables, `print_markdown` is simpler and better — don't hand-build a PrintDoc for it.

## The core idea

A `PrintDoc` is `{ version: 1, page: {...}, content: <block> }`. You compose **blocks** into a tree. The layout is width-driven: the paper is a fixed-width column and blocks divide that width. **The single most useful idiom** is using `size` to control that division (below). Get the sizing model right and everything else follows.

## Blocks

- `stack` — vertical: `{ type:'stack', children:[...], gap?, align? }`
- `row` — side-by-side columns: `{ type:'row', children:[...], gap?, align? }`
- `text` — `{ type:'text', runs:[{ text, bold?, italic?, code?, strike? }], level?:1-6, align? }` — **text is always a `runs` array, never a bare string**
- `table` — `{ type:'table', columns:string[], rows:string[][], align?:('left'|'right')[] }`
- `grid` — `{ type:'grid', cols, rows, cells:[{ text?, number? }], border?:'light'|'heavy' }`
- `chart` — `{ type:'chart', chartType:'bar', categories:string[], series:[{ name?, values:number[] }] }`
- `flow` — a flowchart (linear chain of labeled boxes + arrows): `{ type:'flow', nodes:[{ id, label }], edges:[{ from, to }], direction?:'LR'|'TD' }`. `from`/`to` reference node `id`s. Caps: 40 nodes, 60 edges. v1 is a straight chain (no branches/swimlanes).
- `rule` — `{ type:'rule', style?:'solid'|'dashed' }` · `image` — `{ type:'image', src }` (src must be an uploaded-image URL) · `spacer` · `cut` — `{ type:'cut' }` a cut marker between top-level `stack` children

## Page options

`page` carries the envelope, not just width/dpi. Optional fields the validator accepts:

- `finish` — `'cut' | 'feed' | 'none'` (how the slip ends).
- `theme` — a named typography preset string (e.g. `'classic'` for the serif "newspaper" look). Unknown names fall back to the default theme.
- `branding` — `{ enabled?: boolean }`. Branding is on by default; set `{ enabled: false }` to drop the footer logomark.

## Sizing — the rules that trip people up

Every block may set `size`. Allowed forms **only**:

| `size` | meaning |
|---|---|
| `'fill'` (default) | take all remaining width |
| `'fit'` | shrink to content |
| `{ fill: n }` | take `n` **percent** (0–100) of the width — `{fill:65}`, NOT `{fill:0.65}` |
| `{ mm: n }` | exactly `n` millimetres |

**All gaps, padding, and sizes are millimetres. There are no pixels.** A bare number (`size: 10`) is invalid — write `{ mm: 10 }`.

**Right-align by making the left sibling `fill`.** This is the key idiom and it is NOT obvious:

```json
{ "type": "row", "children": [
  { "type": "text", "size": "fill", "runs": [{ "text": "Flat White" }] },
  { "type": "text", "size": "fit",  "runs": [{ "text": "4.50" }] }
]}
```

The left cell fills the row, so the `fit` right cell is pushed to the right edge. `align:"right"` on a `fit` block does nothing (it's already shrunk to its text) — use the fill-sibling trick instead.

## Align — no flexbox words

`align` accepts **only `"left"`, `"center"`, `"right"`.** `"start"`, `"end"`, `"justify"`, `"space-between"` are all rejected by the printer — a common reflex from CSS. For edge-alignment inside a row, use the fill-sibling idiom above, not an align word.

`borderLeft` on a stack is a **boolean** (a thin left rule), not a style — for a dashed divider between columns use a `rule` block, not `borderLeft:"dashed"`.

## Verify before printing

If a code sandbox is available, run the bundled checker — it mirrors the printer's real `validatePrintDoc`, so a pass means the printer will accept it, and it explains any rejection:

```bash
node check-doc.mjs your-doc.json     # feed the `document` object, or the whole tool args
```

Exit 1 = fix it before printing. It also lints the common gotchas (flexbox aligns, fraction fills, bare-number sizes). No sandbox? Self-check: every `text` uses a `runs` array; every `align` is left/center/right; every `size` is `fill`/`fit`/`{fill:0-100}`/`{mm:n}`; the tree is `{version:1, page, content}`.

## Sizing for the paper

Widths are hard limits — the column is the paper width. 58mm ≈ 32 monospace chars / a couple of columns; 80mm ≈ 48 chars / a few columns. Read `paper_width_mm` from `list_printers` when it matters, and keep `{mm}` blocks within it (an over-wide `{mm}` block prints but overflows).

## Common mistakes

| Mistake | Fix |
|---|---|
| `align:"start"` / `"end"` / `"space-between"` | Only `left`/`center`/`right`. Edge-align via the fill-sibling trick. |
| `{ fill: 0.65 }` | `fill` is a percent: `{ fill: 65 }`. |
| `size: 10` (bare number) | Millimetres go in `{ mm: 10 }`. |
| `text: "Hello"` on a block | Text is a `text` block with a `runs` array: `{type:'text',runs:[{text:'Hello'}]}`. |
| `borderLeft:"dashed"` for a divider | `borderLeft` is a boolean; use a `rule` block for a dashed line. |
| Right-aligning a price with `align:"right"` | Give the left sibling `size:"fill"`. |
| Building a PrintDoc for plain prose | Use `print_markdown`. |
| Printing before validating | Run `check-doc.mjs`; the printer accepts silently-wrong structure only if it validates. |

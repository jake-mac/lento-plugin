---
name: lento-layout
description: Use when building a print_document PrintDoc for the Lento — receipts, tickets, tables, side-by-side columns, bar charts, or any layout Markdown can't express. Covers the kernel's sizing/align rules and a pre-flight validator.
---

# Structured layouts for the Lento (`print_document`)

## When to use this (vs `print_markdown`)

Reach for `print_document` only when Markdown genuinely can't do it: **right-aligned columns** (prices on a receipt), **side-by-side blocks** (a tear-off ticket stub), **precise mm spacing**, **grids**, or **bar charts**. For prose, headings, lists, and simple tables, `print_markdown` is simpler and better — don't hand-build a PrintDoc for it. Both tools also accept an optional `format` setting (typeface, text size, line spacing, render mode, weights — the same knobs as the web app's Formatting panel); see **Global formatting** below.

## The core idea

A `PrintDoc` is `{ version: 1, page: {...}, content: <block> }`. You compose **blocks** into a tree. The layout is width-driven: the paper is a fixed-width column and blocks divide that width. **The single most useful idiom** is using `size` to control that division (below). Get the sizing model right and everything else follows.

## Blocks

- `stack` — vertical: `{ type:'stack', children:[...], gap?, align? }`
- `row` — side-by-side columns: `{ type:'row', children:[...], gap?, align? }`
- `text` — `{ type:'text', runs:[{ text, bold?, italic?, code?, strike? }], level?:1-6, align? }` — **text is always a `runs` array, never a bare string**
- `table` — `{ type:'table', columns:string[], rows:string[][], align?:('left'|'right')[] }`
- `grid` — `{ type:'grid', cols, rows, cells:[{ text?, number? }], border?:'light'|'heavy'|'none' }` (`'none'` = a borderless letter grid, no cell boxes)
- `chart` — `{ type:'chart', chartType:'bar', categories:string[], series:[{ name?, values:number[] }] }`
- `flow` — a flowchart (linear chain of labeled boxes + arrows): `{ type:'flow', nodes:[{ id, label }], edges:[{ from, to }], direction?:'LR'|'TD' }`. `from`/`to` reference node `id`s. Caps: 40 nodes, 60 edges. v1 is a straight chain (no branches/swimlanes).
- `qr` — a scannable QR code: `{ type:'qr', data, ecc?:'L'|'M'|'Q'|'H', quietZone?, moduleMm?, caption?, align? }`. `data` (required) is the **finished payload string** — a URL, or a `WIFI:T:WPA;S:…;P:…;;` / `BEGIN:VCARD…END:VCARD` string you format yourself (the block is content-agnostic; it has no WiFi/contact typing). `ecc` defaults `M` (use `Q` for long/scan-critical codes). `quietZone` is the white-margin modules (int 0–16, default 4). `moduleMm` forces an exact module size; otherwise it prints ~35mm. `caption` is a centered line below; `align` defaults **left** so it composes mid-stack. For a *standalone* typed QR (WiFi/contact input, auto-cut), use the `print_qr` tool + the **lento-qr** skill instead.
- `maze` — a maze grid (walls from `openRight`/`openDown` passage matrices + `entrance`/`exit`). Normally you don't hand-author this — use the dedicated `print_maze` tool (and the `lento-maze` skill), which builds it for you. It's listed here only because `validatePrintDoc` accepts it as a block. (Word searches likewise have their own `print_word_search` tool + `lento-wordsearch` skill rather than being hand-built here.)
- `rule` — `{ type:'rule', style?:'solid'|'dashed' }` · `image` — `{ type:'image', src, reflow? }` (src must be an uploaded-image URL — use the `upload_image` tool, passing a local `path` or `data_base64`, to mint one); `reflow:false` prints it exactly as given, with no automatic comic-panel split or wide-image rotation · `spacer` · `cut` — `{ type:'cut' }` a cut marker between top-level `stack` children

## Page options

`page` carries the envelope, not just width/dpi. Optional fields the validator accepts:

- `finish` — `'cut' | 'feed' | 'none'` (how the slip ends).
- `theme` — a named typography preset string (e.g. `'classic'` for the serif "newspaper" look). Unknown names fall back to the default theme.
- `branding` — `{ enabled?: boolean }`. Branding is on by default; set `{ enabled: false }` to drop the footer logomark.

## Global formatting (`format`) — the one broad lever

Both `print_markdown` **and** `print_document` accept an optional top-level **`format`** object that restyles the **whole print** at once. This is the lever to reach for to set the overall look; use the per-block controls (align, `level`, marks, `size` — below) only for local exceptions. Every field is optional, out-of-range or unknown values are clamped server-side, and omitting `format` entirely prints the default look (byte-identical to no format).

| field | values | default | effect |
|---|---|---|---|
| `font` | `"sans"` / `"serif"` / `"mono"` | `sans` | body typeface (Roboto Flex / Source Serif 4 / JetBrains Mono) |
| `textSizeMm` | `2.2`–`4.6` | `3.1` | base text size, mm |
| `lineHeight` | `1.0`–`1.9` | `1.32` | leading |
| `bodyWeight` | `"normal"` / `"bold"` | `normal` | body stroke weight |
| `headingWeight` | `"match"` / `"bold"` | `match` | headings bold, or same weight as body |
| `codeStyle` | `"inverted"` / `"outline"` / `"fill"` | `inverted` | how code spans/blocks are framed |
| `renderMode` | `"hybrid"` / `"dither"` / `"threshold"` / `"grayscale"` | `hybrid` | 1-bit reduction. `hybrid` (crisp text + dithered images) suits almost everything; `threshold` for pure line art, `dither` for photo-heavy prints |

`format` sits **beside** `printer_id` / `document` in the tool call, not inside the document:

```json
{ "printer_id": "…", "document": { "version": 1, "page": {}, "content": { } },
  "format": { "font": "serif", "textSizeMm": 3.4 } }
```

For `print_document`, a `format` **overrides** the document's `page.theme` if both are set (an explicit per-call format wins). Rule of thumb: **set the whole-print look with `format`; reach into per-block controls only where one block needs to differ.**

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

## Composing a QR mid-stack

A `qr` block is a first-class primitive, so it drops into any `stack` alongside prose — an event flyer with a "scan to join WiFi" code as its footer:

```json
{
  "version": 1,
  "page": { "finish": "cut" },
  "content": { "type": "stack", "gap": 3, "align": "center", "children": [
    { "type": "text", "level": 1, "align": "center", "runs": [{ "text": "Rooftop Launch Party" }] },
    { "type": "text", "align": "center", "runs": [{ "text": "Fri 8pm · Floor 12 · Guests welcome. Join the guest WiFi below." }] },
    { "type": "rule", "style": "dashed" },
    { "type": "qr", "data": "WIFI:T:WPA;S:RooftopGuest;P:welcome2026;;", "ecc": "Q", "caption": "Scan to join WiFi", "align": "center" }
  ]}
}
```

The `qr` block's `data` is the **finished** payload string — you format the `WIFI:…;;` (or `BEGIN:VCARD…`) grammar yourself, because the block is content-agnostic (escape `\ ; , : "` in the SSID/password). For a *standalone* QR from typed WiFi/contact input, reach for the `print_qr` tool and the **lento-qr** skill instead — it handles the formatting and the print-then-scan gate.

## Verify before printing

If a code sandbox is available, run the bundled checker — it mirrors the printer's real `validatePrintDoc`, so a pass means the printer will accept it, and it explains any rejection:

```bash
node check-doc.mjs your-doc.json     # feed the `document` object, or the whole tool args
```

Exit 1 = fix it before printing. It also lints the common gotchas (flexbox aligns, fraction fills, bare-number sizes). No sandbox? Self-check: every `text` uses a `runs` array; every `align` is left/center/right; every `size` is `fill`/`fit`/`{fill:0-100}`/`{mm:n}`; the tree is `{version:1, page, content}`.

## Sizing for the paper

Widths are hard limits — the column is the paper width. 58mm ≈ 32 monospace chars / a couple of columns; 80mm ≈ 48 chars / a few columns. Read the width from `lento_search` (kind `printer`): `paper_width_px` at `dpi` (576 px at 203 dpi is a 72 mm printable column on 80 mm paper; 384 px is 58 mm paper) when it matters, and keep `{mm}` blocks within it (an over-wide `{mm}` block prints but overflows).

**Read `warnings` in the print result.** Every print tool returns `{ success: true, warnings: [...] }`.
The most important entry is `overflow`: a word with no break opportunity (a file path, a long URL)
is wider than the column, and its end was **clipped on the paper that just printed**. The message
names the token. Fix it (smaller text via a higher `level`, a space or line break, or a shorter
token) and reprint. `check-doc.mjs` can't catch this, because it validates structure and has no font
metrics. An absent `warnings` key means nothing could be measured (a queued print whose cloud check failed
or timed out), which is not the same as a clean print.

**`pending: true` means it is still printing. Never reprint it.** A long print (an article, an edition)
can outlast the tool call. Instead of an error you then get
`{ pending: true, status: "printing" | "queued", job_id?, message }`. That is not a failure: the paper
is still coming out, or the job is queued for the helper. Retrying prints it twice. Tell the user it's
on its way. For `queued`, `cancel_print_job` with the `job_id` stops it if they want it stopped.

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

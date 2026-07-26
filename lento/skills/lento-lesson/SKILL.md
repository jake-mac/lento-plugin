---
name: lento-lesson
description: Use when someone asks Lento for a lesson, a daily lesson, or to teach them about the Lento app/architecture/technology — generate one bite-size, fact-checked lesson from the Codex and print it via print_document.
---

# Making a Lento lesson

## The core principle

A lesson is only good if **every fact on it is true of the app right now** and it **fits the thermal
canvas**. You get there by drawing from ONE verified source — the Codex (`.lessons/codex.md`) —
never from memory or a fresh read of the code. The Codex already did the verification; your job is to
teach one chapter of it, at the learner's level, on paper. Build from the Codex; don't improvise facts.

## The method

1. **Load state.** Read the learner-state file (`.lessons/lesson-state.json`; see schema below).
   If it's missing, run the **seeding interview** (below) and write it. It tells you the next chapter and
   the learner's tone / level / goal / pacing.
2. **Load the chapter.** Open `.lessons/codex.md`, find the next chapter from state. Use ONLY its
   `[✓]` facts as "how it works," its `[~]` as "on the roadmap," its `[H]` as lineage. **Do not draw
   facts from memory or from a fresh read of the source code** — even if you can see the real file,
   the Codex is the single source of truth for what a lesson may assert; a fact not present in the
   Codex under a mark does not go on the lesson, full stop. If the next chapter is still a **scaffold**
   (no `[✓]` facts authored yet), **decline**: tell the user this chapter needs authoring first and
   stop there — do not invent or fabricate a lesson for it.
3. **Compose the PrintDoc.** Build a `print_document` block tree (NOT Markdown). Follow the
   `lento-layout` skill for the block/sizing/align rules. Use the fixed **skeleton** below.
4. **Safe glyphs only** (the checker enforces this — see `SAFE_NONASCII`). Thanks to #97's glyph
   fallback you CAN use real box-drawing (`─ │ ┌ ┐ └ ┘ ├ ┤ ┼`), arrows (`→ ← ↑ ↓`), checkboxes
   (`☐ ☑ ✓ ✗`), and bullets/stars — build crisp boxes-and-arrows diagrams, not ASCII approximations.
   Inline **pictographs** are available too (`:anchor:` etc.). A glyph OUTSIDE the safe set (e.g. `₿`)
   still tofus — the checker rejects it. Escalate to a real image only when a concept is truly pictorial.
5. **Gate, then print.** Run BOTH checkers on your tool-args JSON. Fix every failure before printing:
   - `node <layout skill>/check-doc.mjs args.json`   (structural PrintDoc)
   - `node ./check-lesson.mjs args.json`             (glyph safety, skeleton, citations)
6. **Print + advance.** Call `list_printers` -> `get_printer_status` -> `print_document`. On success,
   bump the state's chapter counter and append what was taught.

## The skeleton (every lesson)

A vertical `stack` of text blocks, in this order:
1. **Masthead** — `LENTO · LESSON NN · <arc>`
2. **Title** — a `text` block `level:1`
3. **Hook** — one line
4. **Concept + visual** — prose + a text-built diagram (safe glyphs)
5. **"WHERE THIS COMES FROM"** — one tight lineage line (`[H]` facts)
6. **Verified line** — `[✓] verified in this app: <claim>. [NN]` (or `[~] on the roadmap: ...`)
7. **Citation def** — `[NN] <what> -> <file path or source>`
8. **Teaser** — `Tomorrow -> Lesson NN+1: <topic>`
9. **Footer** — `tone: <t> · level: <l> · goal: <g> · learns: <type>`

## Marks (never blur fact and plan)

- `[✓]` — verified now; carry the citation. Only these may be stated as "how it works." Never mark
  something not yet built as `[✓]` — a feature that doesn't exist yet is `[~]` roadmap, no matter how
  confident the description sounds.
- `[~]` — roadmap; frame as "on the roadmap," never as current behavior.
- `[H]` — historical / lineage.

Use these three marks **exactly as written** — `[✓]` / `[~]` / `[H]`. Do not substitute `[OK]` or
any other spelling; the pre-print checker (`check-lesson.mjs`) keys its citation check off the literal
`[✓]` glyph, so a substitute both misrepresents the fact's status *and* silently defeats the check.

Anything you can't back from the Codex under one of these marks: **cut it.**

## Learner-state schema

`.lessons/lesson-state.json`:

```json
{
  "profile": { "tone": "plain", "level": "curious designer; new to networking/Rust", "goal": "architecture map", "pacing": "one concept per day", "learns": "visual" },
  "progress": { "nextChapter": 2, "taught": [1] },
  "feedback": []
}
```

- `tone`: plain | playful | nerdy-deep | socratic
- `pacing`: "one concept per day" | "denser card"
- `taught`: chapter numbers already sent (so lessons can call back and never repeat).

## Seeding interview (first run only)

Ask, one at a time: (1) tone, (2) what they already know vs. don't (level), (3) what "expert" means to
them (goal), (4) one concept a day or a denser card (pacing). Write the answers to the state file.
`learns` is "visual" by default.

## Sizing for the paper

80mm ≈ 48 monospace chars / 12 grid cols; 58mm ≈ 32 / 8. Read the width from `list_printers`. Keep
diagram lines short; a lesson should be bite-size — one concept, not a chapter dump.

## Common mistakes

| Mistake | Fix |
|---|---|
| Facts from memory / a fresh code read | Draw ONLY from the Codex; it's the verified source. |
| Teaching a scaffolded (unauthored) chapter | Say it needs authoring; don't invent it. |
| Using `[OK]` or any other substitute mark | Use exactly `[✓]` / `[~]` / `[H]` — the checker keys citations off `[✓]` literally. |
| Marking a not-yet-built feature as `[✓]` verified | Not-built = `[~]` roadmap, never `[✓]`. Don't blur built vs. planned. |
| Stating a `[~]` roadmap item as fact | Keep the mark; frame as "on the roadmap." |
| A glyph outside the safe set (e.g. `₿`) | Use a confirmed-safe glyph; arrows/box-drawing/checks ARE safe now (#97), `₿`-type ones aren't. |
| Markdown instead of a block tree | Emit `print_document`; see the `lento-layout` skill. |
| Printing before gating | Run check-doc.mjs AND check-lesson.mjs; exit 1 = fix first. |

#!/usr/bin/env node
// plugin/lento/skills/lento-recipe/check-recipe.mjs
//
// HAND-COPY of the kernel's validateRecipe + lintRecipe. The plugin ships
// standalone, so it cannot import @lento/thermal-core at user runtime.
// A parity test (packages/mcp-tools/src/__tests__/plugin-recipe-checker-parity.test.ts)
// fails on any accept/reject divergence. Update BOTH halves together.
//
// Usage: node check-recipe.mjs recipe.json
//   exit 0 = valid (advisory warnings may still print)
//   exit 1 = invalid; fix before calling save_recipe or print_recipe

import { readFileSync } from "node:fs";

// ============================================================================
// --- ported from packages/thermal-core/src/layout/quantity.ts ---
// ============================================================================

/** US customary. Pinned deliberately — imperial cups differ. */
const VOLUME_ML = {
  tsp: 4.92892, tbsp: 14.78676, floz: 29.57352, cup: 236.5882,
  pint: 473.1764, quart: 946.3529, gallon: 3785.412, ml: 1, l: 1000,
};
const MASS_G = { oz: 28.3495, lb: 453.592, g: 1, kg: 1000 };

const COUNT_UNITS = ["whole", "clove", "stick", "can", "box", "bunch", "pkg", "slice"];
const INFORMAL_UNITS = ["pinch", "dash"];

const ALL_UNITS = [
  ...Object.keys(VOLUME_ML),
  ...Object.keys(MASS_G),
  ...COUNT_UNITS,
  ...INFORMAL_UNITS,
];

const PLURAL_ES = new Set(["box", "pinch", "dash", "bunch"]);

function normalizeUnit(s) {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  if (ALL_UNITS.includes(t)) return t;
  // Scoped to PLURAL_ES: those are the only units `pluralize` ever renders with
  // an "-es", so an unscoped strip would fold words that are not the plural of
  // any unit ("canes" -> "can", "lbes" -> "lb").
  if (t.endsWith("es") && PLURAL_ES.has(t.slice(0, -2))) {
    return t.slice(0, -2);
  }
  if (t.endsWith("s") && ALL_UNITS.includes(t.slice(0, -1))) {
    return t.slice(0, -1);
  }
  return null;
}

const AMOUNT_RE = /^\s*(?:(\d+)\s+)?(?:(\d+)\s*\/\s*(\d+)|(\d+(?:\.\d+)?))\s*([a-zA-Z]+)?\s*$/;

function parseAmount(s) {
  const m = AMOUNT_RE.exec(s);
  if (!m) return null;
  const [, whole, num, den, dec, rawUnit] = m;
  let quantity;
  if (num !== undefined && den !== undefined) {
    const d = Number(den);
    if (d === 0) return null;
    quantity = (whole ? Number(whole) : 0) + Number(num) / d;
  } else if (dec !== undefined) {
    if (whole !== undefined) return null; // "1 2" is not an amount
    quantity = Number(dec);
  } else {
    return null;
  }
  if (!rawUnit) return { quantity };
  const unit = normalizeUnit(rawUnit);
  return unit ? { quantity, unit } : null;
}

// ============================================================================
// --- ported from packages/thermal-core/src/layout/recipe-steps.ts ---
// ============================================================================

const MARK_RE = /\{\{([^|{}]+)\|([^{}]+)\}\}/g;

/** `\{{` is an authored literal; the backslash is consumed, never printed. */
const unescape = (s) => s.replace(/\\\{\{/g, "{{");

function parseStepSegments(text) {
  const out = [];
  let last = 0;
  MARK_RE.lastIndex = 0;
  let m;
  while ((m = MARK_RE.exec(text)) !== null) {
    // An escaped `{{` is literal text, not a mark. Recognised in place rather
    // than substituted out with a sentinel string: ANY sentinel can itself
    // occur in authored step text, and the blind split putting it back then
    // corrupts that text.
    if (m.index > 0 && text[m.index - 1] === "\\") continue;
    if (m.index > last) out.push({ type: "text", text: unescape(text.slice(last, m.index)) });
    const rawAmount = m[2].trim();
    const parsed = parseAmount(rawAmount);
    out.push(
      parsed
        ? {
            type: "amount",
            ref: m[1].trim(),
            quantity: parsed.quantity,
            ...(parsed.unit ? { unit: parsed.unit } : {}),
            raw: rawAmount,
          }
        : { type: "invalid", raw: m[0] },
    );
    last = MARK_RE.lastIndex;
  }
  if (last < text.length) out.push({ type: "text", text: unescape(text.slice(last)) });
  return out.length > 0 ? out : [{ type: "text", text: unescape(text) }];
}

const usageKey = (item) => item.trim().toLowerCase();

// ============================================================================
// --- ported from packages/thermal-core/src/layout/recipe.ts ---
// ============================================================================

const RECIPE_CAPS = {
  maxTitleLen: 200,
  maxIngredients: 100,
  maxSteps: 100,
  maxStepLen: 1000,
  maxNotes: 20,
  maxFieldLen: 200,
};

const isObj = (v) =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isUnit = (v) =>
  typeof v === "string" && ALL_UNITS.includes(v);

/** Optional string with a length cap. Returns an error string, or null when fine. */
function optStr(v, path, max = RECIPE_CAPS.maxFieldLen) {
  if (v === undefined) return null;
  if (typeof v !== "string") return `${path} must be a string`;
  if (v.length > max) return `${path} exceeds the ${max}-char cap`;
  return null;
}

function validateReserve(raw, path, parentQty, parentUnit) {
  if (!isObj(raw)) return `${path} must be an object`;
  if (typeof raw.label !== "string" || raw.label.length === 0) return `${path}.label must be a non-empty string`;
  if (raw.label.length > RECIPE_CAPS.maxFieldLen) return `${path}.label exceeds the ${RECIPE_CAPS.maxFieldLen}-char cap`;
  if (raw.unit !== undefined && !isUnit(raw.unit)) return `${path}.unit must be a known unit`;
  if (raw.quantity !== undefined) {
    if (typeof raw.quantity !== "number" || !Number.isFinite(raw.quantity) || raw.quantity <= 0) {
      return `${path}.quantity must be a positive number`;
    }
    const sameUnit = (raw.unit ?? parentUnit) === parentUnit;
    if (parentQty !== undefined && sameUnit && raw.quantity > parentQty + 1e-9) {
      return `${path} reserves more than the ingredient provides`;
    }
  }
  return null;
}

function validateRecipe(raw) {
  if (!isObj(raw)) return { ok: false, reason: "recipe must be an object" };

  if (typeof raw.title !== "string") return { ok: false, reason: "recipe.title must be a string" };
  if (raw.title.length > RECIPE_CAPS.maxTitleLen) {
    return { ok: false, reason: `recipe.title exceeds the ${RECIPE_CAPS.maxTitleLen}-char cap` };
  }

  for (const f of ["source", "yield"]) {
    const e = optStr(raw[f], `recipe.${f}`);
    if (e) return { ok: false, reason: e };
  }

  if (raw.servings !== undefined) {
    if (typeof raw.servings !== "number" || !Number.isInteger(raw.servings) || raw.servings <= 0) {
      return { ok: false, reason: "recipe.servings must be a positive integer" };
    }
  }

  if (raw.times !== undefined) {
    if (!isObj(raw.times)) return { ok: false, reason: "recipe.times must be an object" };
    for (const f of ["prep", "cook", "total"]) {
      const e = optStr(raw.times[f], `recipe.times.${f}`);
      if (e) return { ok: false, reason: e };
    }
  }

  if (!Array.isArray(raw.ingredients)) return { ok: false, reason: "recipe.ingredients must be an array" };
  if (raw.ingredients.length === 0) return { ok: false, reason: "recipe.ingredients must have at least one entry" };
  if (raw.ingredients.length > RECIPE_CAPS.maxIngredients) {
    return { ok: false, reason: `recipe.ingredients exceeds the ${RECIPE_CAPS.maxIngredients}-entry cap` };
  }

  const ingredients = [];
  for (let i = 0; i < raw.ingredients.length; i++) {
    const g = raw.ingredients[i];
    const p = `recipe.ingredients[${i}]`;
    if (!isObj(g)) return { ok: false, reason: `${p} must be an object` };
    if (typeof g.item !== "string" || g.item.length === 0) {
      return { ok: false, reason: `${p}.item must be a non-empty string` };
    }
    if (g.item.length > RECIPE_CAPS.maxFieldLen) {
      return { ok: false, reason: `${p}.item exceeds the ${RECIPE_CAPS.maxFieldLen}-char cap` };
    }
    if (g.quantity !== undefined) {
      if (typeof g.quantity !== "number" || !Number.isFinite(g.quantity) || g.quantity <= 0) {
        return { ok: false, reason: `${p}.quantity must be a positive number` };
      }
    }
    if (g.unit !== undefined && !isUnit(g.unit)) {
      return { ok: false, reason: `${p}.unit must be a known unit` };
    }
    for (const f of ["brand", "generic", "note", "group"]) {
      const e = optStr(g[f], `${p}.${f}`);
      if (e) return { ok: false, reason: e };
    }
    if (g.section !== undefined && typeof g.section !== "string") {
      return { ok: false, reason: `${p}.section must be a string` };
    }
    if (g.optional !== undefined && typeof g.optional !== "boolean") {
      return { ok: false, reason: `${p}.optional must be a boolean` };
    }
    if (g.reserve !== undefined) {
      const e = validateReserve(g.reserve, `${p}.reserve`, g.quantity, g.unit);
      if (e) return { ok: false, reason: e };
    }
    ingredients.push({
      item: g.item,
      ...(g.quantity !== undefined ? { quantity: g.quantity } : {}),
      ...(g.unit !== undefined ? { unit: g.unit } : {}),
      ...(g.brand !== undefined ? { brand: g.brand } : {}),
      ...(g.generic !== undefined ? { generic: g.generic } : {}),
      ...(g.note !== undefined ? { note: g.note } : {}),
      ...(g.group !== undefined ? { group: g.group } : {}),
      ...(g.section !== undefined ? { section: g.section } : {}),
      ...(g.optional !== undefined ? { optional: g.optional } : {}),
      ...(g.reserve !== undefined ? { reserve: g.reserve } : {}),
    });
  }

  if (!Array.isArray(raw.steps)) return { ok: false, reason: "recipe.steps must be an array" };
  if (raw.steps.length === 0) return { ok: false, reason: "recipe.steps must have at least one entry" };
  if (raw.steps.length > RECIPE_CAPS.maxSteps) {
    return { ok: false, reason: `recipe.steps exceeds the ${RECIPE_CAPS.maxSteps}-entry cap` };
  }
  const steps = [];
  for (let i = 0; i < raw.steps.length; i++) {
    const s = raw.steps[i];
    if (typeof s !== "string" || s.length === 0) {
      return { ok: false, reason: `recipe.steps[${i}] must be a non-empty string` };
    }
    if (s.length > RECIPE_CAPS.maxStepLen) {
      return { ok: false, reason: `recipe.steps[${i}] exceeds the ${RECIPE_CAPS.maxStepLen}-char cap` };
    }
    steps.push(s);
  }

  let notes;
  if (raw.notes !== undefined) {
    if (!Array.isArray(raw.notes)) return { ok: false, reason: "recipe.notes must be an array" };
    if (raw.notes.length > RECIPE_CAPS.maxNotes) {
      return { ok: false, reason: `recipe.notes exceeds the ${RECIPE_CAPS.maxNotes}-entry cap` };
    }
    notes = [];
    for (let i = 0; i < raw.notes.length; i++) {
      const e = optStr(raw.notes[i], `recipe.notes[${i}]`, RECIPE_CAPS.maxStepLen);
      if (e) return { ok: false, reason: e };
      notes.push(raw.notes[i]);
    }
  }

  // --- marking checks: references resolve, and marked usage fits the ingredient ---
  const byKey = new Map();
  for (const g of ingredients) {
    const k = usageKey(g.item);
    byKey.set(k, [...(byKey.get(k) ?? []), g]);
  }
  const marked = new Map();
  for (let i = 0; i < steps.length; i++) {
    for (const seg of parseStepSegments(steps[i])) {
      if (seg.type === "invalid") {
        return { ok: false, reason: `recipe.steps[${i}] has a marked amount that could not be parsed: ${seg.raw}` };
      }
      if (seg.type !== "amount") continue;
      const matches = byKey.get(usageKey(seg.ref));
      if (!matches || matches.length === 0) {
        return { ok: false, reason: `recipe.steps[${i}] references an ingredient that does not exist: "${seg.ref}"` };
      }
      if (matches.length > 1) {
        return { ok: false, reason: `recipe.steps[${i}] references "${seg.ref}", which matches more than one ingredient` };
      }
      const k = usageKey(seg.ref);
      const cur = marked.get(k) ?? { total: 0, unit: seg.unit };
      if (cur.unit === seg.unit) cur.total += seg.quantity;
      marked.set(k, cur);
    }
  }
  for (const [k, use] of marked) {
    const g = byKey.get(k)[0];
    if (g.quantity === undefined) continue;          // "to taste" - nothing to exceed
    if ((use.unit ?? g.unit) !== g.unit) continue;   // different unit; not comparable here
    if (use.total > g.quantity + 1e-9) {
      return { ok: false, reason: `recipe.steps use more "${g.item}" than recipe.ingredients provides` };
    }
  }

  return {
    ok: true,
    value: {
      title: raw.title,
      ...(raw.source !== undefined ? { source: raw.source } : {}),
      ...(raw.yield !== undefined ? { yield: raw.yield } : {}),
      ...(raw.servings !== undefined ? { servings: raw.servings } : {}),
      ...(raw.times !== undefined ? { times: raw.times } : {}),
      ingredients,
      steps,
      ...(notes !== undefined ? { notes } : {}),
    },
  };
}

// ============================================================================
// --- ported from packages/thermal-core/src/layout/recipe-lint.ts ---
// ============================================================================

/**
 * Prose that signals a split the author never structured. These say "hold
 * something back" on their own, so they fire whether or not the step names the
 * ingredient - "Reserve half for garnish." is exactly the case this lint exists
 * to catch.
 */
const RESERVE_PHRASES = [
  "reserve", "set aside", "save some", "save a", "hold back",
  "the other half", "divided", "leave a small amount", "leave some",
];

/**
 * Signals that ALSO occur in ordinary recipe prose about something that is not
 * an ingredient - "simmer until the remaining liquid has reduced", "cook the
 * rest of the way in the oven", "fold in the remaining ingredients", "discard
 * the rest of the marinade". All four are real recipe sentences and all four
 * used to raise `prose-reserve`. They count only when an ingredient is named
 * AFTER the phrase, which "add the rest of the butter" has and those four do not.
 */
const WEAK_RESERVE_PHRASES = ["remaining", "the rest of"];

/** number (incl. fractions) + optional unit word, anywhere in prose */
const PROSE_AMOUNT_RE = /(\d+(?:\s+\d+\/\d+)?(?:\/\d+)?(?:\.\d+)?)\s*([a-zA-Z]+)?/g;

// Unicode-aware on purpose: an ASCII-only class reads the accented letter in
// "anchoiade" as a non-word character, making "ancho" look like a whole word
// inside it.
const isWordChar = (ch) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/**
 * True when `needle` occurs in `haystack` as a whole word (or phrase) — not as
 * a substring of a longer word. "salt" matches "the salt," but not "salted";
 * "egg" matches "an egg" but not "eggplant". Deliberately NOT a RegExp built
 * from `needle`: an ingredient name is untrusted, free-form user text that may
 * contain regex metacharacters (a literal `"C++"` or `"a.b"` is a legal
 * ingredient name), so matching is done with `indexOf` + manual boundary
 * checks instead of constructing a pattern from it.
 */
function mentionsWord(haystack, needle) {
  if (!needle) return false;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return false;
    const before = idx > 0 ? haystack[idx - 1] : undefined;
    const after = idx + needle.length < haystack.length ? haystack[idx + needle.length] : undefined;
    if (!isWordChar(before) && !isWordChar(after)) return true;
    from = idx + 1;
  }
}

/** Every start offset at which `phrase` occurs in `haystack`. */
function occurrences(haystack, phrase) {
  const out = [];
  if (!phrase) return out; // indexOf("") never advances past the end - would spin
  for (let i = haystack.indexOf(phrase); i !== -1; i = haystack.indexOf(phrase, i + 1)) out.push(i);
  return out;
}

/**
 * Which steps carry a MARKED amount for an ingredient. This is evidence of
 * structure, which is what the prose-reserve guard needs — a name appearing in
 * two steps is not evidence that the split was ever declared.
 */
function markedByStep(recipe) {
  const out = new Map();
  recipe.steps.forEach((step, i) => {
    for (const seg of parseStepSegments(step)) {
      if (seg.type !== "amount") continue;
      const s = out.get(usageKey(seg.ref)) ?? new Set();
      s.add(i);
      out.set(usageKey(seg.ref), s);
    }
  });
  return out;
}

/** Which steps mention an ingredient at all — by marking, or by its name in prose. */
function mentionsByStep(recipe) {
  const out = new Map();
  // A blank/whitespace-only item name (validateRecipe allows " ", length 1)
  // trims to "" — skip it, or mentionsWord's `!needle` guard would otherwise
  // have to be relied on silently; filtering here keeps the name list honest.
  const names = recipe.ingredients
    .map((g) => ({ key: usageKey(g.item), needle: g.item.trim().toLowerCase() }))
    .filter((n) => n.needle.length > 0);
  recipe.steps.forEach((step, i) => {
    const lower = step.toLowerCase();
    for (const seg of parseStepSegments(step)) {
      if (seg.type !== "amount") continue;
      const s = out.get(usageKey(seg.ref)) ?? new Set();
      s.add(i);
      out.set(usageKey(seg.ref), s);
    }
    for (const { key, needle } of names) {
      if (mentionsWord(lower, needle)) {
        const s = out.get(key) ?? new Set();
        s.add(i);
        out.set(key, s);
      }
    }
  });
  return out;
}

function lintRecipe(recipe) {
  const warnings = [];
  const mentions = mentionsByStep(recipe);
  const marked = markedByStep(recipe);

  // Same step + same INGREDIENT + same code should surface once, not once per
  // matching prose amount in that step (e.g. "Add 2 cups flour, then 2 more
  // cups flour" would otherwise push two identical restated-amount warnings).
  // Keyed on the ingredient's INDEX rather than its name: two distinct
  // ingredients may carry the same `item` string ("Flour" in cups alongside
  // "Flour" in lb), and a name-keyed set silently drops the second warning.
  const seen = new Set();
  const pushOnce = (w, ingredientIndex) => {
    const key = `${w.code}:${w.stepIndex}:${ingredientIndex}`;
    if (seen.has(key)) return;
    seen.add(key);
    warnings.push(w);
  };

  recipe.steps.forEach((step, i) => {
    // Strip marked spans first — a marked amount is by definition not unmarked.
    const prose = parseStepSegments(step)
      .filter((s) => s.type === "text")
      .map((s) => s.text)
      .join(" ");
    const lower = prose.toLowerCase();

    PROSE_AMOUNT_RE.lastIndex = 0;
    let m;
    while ((m = PROSE_AMOUNT_RE.exec(prose)) !== null) {
      const unit = m[2] ? normalizeUnit(m[2]) : null;
      if (!unit) continue; // a bare number, or a non-unit word (minutes, F) - not an amount
      // `parseAmount`, not `Number`: a prose amount may be a fraction or a mixed
      // number, and `Number("1/2")` is NaN - which compares false against every
      // ingredient quantity, silently suppressing the lint.
      const proseQty = parseAmount(m[1])?.quantity;
      for (let gi = 0; gi < recipe.ingredients.length; gi++) {
        const g = recipe.ingredients[gi];
        if (g.unit !== unit) continue;
        const needle = g.item.trim().toLowerCase();
        if (!needle) continue; // blank/whitespace-only name - not matchable, never "mentioned"
        if (!mentionsWord(lower, needle)) continue;
        const usedIn = mentions.get(usageKey(g.item));
        if (usedIn && usedIn.size > 1) {
          pushOnce({
            code: "unmarked-split",
            stepIndex: i,
            item: g.item,
            message: `Step ${i + 1} names an amount of "${g.item}", which is used in ${usedIn.size} steps. Mark it as {{${g.item}|${m[1]} ${unit}}} so it scales.`,
          }, gi);
        } else if (g.quantity !== undefined && proseQty !== undefined && Math.abs(proseQty - g.quantity) < 1e-9) {
          pushOnce({
            code: "restated-amount",
            stepIndex: i,
            item: g.item,
            message: `Step ${i + 1} restates the full amount of "${g.item}". Prefer "add the ${g.item.toLowerCase()}" so there is only one number on the card.`,
          }, gi);
        }
      }
    }

    const namesIngredientAfter = (at) => {
      const tail = lower.slice(at);
      return recipe.ingredients.some((g) => {
        const needle = g.item.trim().toLowerCase();
        return needle.length > 0 && mentionsWord(tail, needle);
      });
    };
    const reserveLanguage =
      RESERVE_PHRASES.some((p) => lower.includes(p)) ||
      WEAK_RESERVE_PHRASES.some((p) =>
        occurrences(lower, p).some((at) => namesIngredientAfter(at + p.length)),
      );
    if (reserveLanguage) {
      // A hand-authored reserve, or an actual multi-step MARKING, counts as
      // structured. A bare name mention in two steps does not.
      const structured = recipe.ingredients.some((g) => {
        if (g.reserve) return true;
        const markedIn = marked.get(usageKey(g.item));
        return Boolean(markedIn && markedIn.size > 1);
      });
      if (!structured) {
        pushOnce({
          code: "prose-reserve",
          stepIndex: i,
          message: `Step ${i + 1} describes holding part of an ingredient back, but no ingredient carries a reserve or a multi-step marking. The cook will not see it in the ingredient list.`,
        }, -1);
      }
    }
  });

  return warnings;
}

// ============================================================================
// --- CLI driver ---
// ============================================================================

const file = process.argv[2];
if (!file) {
  console.error("usage: node check-recipe.mjs <recipe.json>");
  process.exit(2);
}

let raw;
try {
  raw = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
  console.error(`could not read ${file}: ${err.message}`);
  process.exit(2);
}
// Accept either a bare recipe or whole tool args ({ recipe: {...} }).
const recipe = raw && typeof raw === "object" && "recipe" in raw ? raw.recipe : raw;

const result = validateRecipe(recipe);
if (!result.ok) {
  console.error(`INVALID: ${result.reason}`);
  process.exit(1);
}

const warnings = lintRecipe(result.value);
if (warnings.length === 0) {
  console.log("VALID - no warnings.");
  process.exit(0);
}
console.log("VALID, with advisory warnings (these do NOT block a save):");
for (const w of warnings) console.log(`  [${w.code}] ${w.message}`);
process.exit(0);

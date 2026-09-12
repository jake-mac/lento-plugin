---
name: lento-recipe
description: Use when someone asks the Lento to save, recall, scale, or print a recipe or a shopping/packing list — anything routed to print_recipe, print_list, save_recipe, list_recipes, get_recipe, update_recipe, delete_recipe, save_list, list_lists, get_list, update_list, delete_list, add_cook_note, or delete_cook_note.
---

# Recipes and lists for the Lento

## 1. The `Recipe` shape

```
{
  title: string,
  source?: string,
  yield?: string,
  servings?: number,
  times?: { prep?: string, cook?: string, total?: string },
  ingredients: [{
    item: string,
    quantity?: number,
    unit?: string,          // "cup", "tbsp", "stick", "lb", ... — see valid units below
    brand?: string,
    note?: string,           // "melted", "room temp"
    group?: string,          // subheading, e.g. "For the crust"
    section?: string,        // grocery-store section, for when this becomes a shopping list item
    optional?: boolean,
    reserve?: { quantity?: number, unit?: string, label: string },
  }],
  steps: string[],
  notes?: string[],
}
```

**`steps` are auto-numbered by the printer. Never write "1. Preheat the oven" yourself** — pass the plain step text and the card numbers it for you. A hand-numbered step becomes double-numbered on paper.

Valid `unit` values: `tsp`, `tbsp`, `floz`, `cup`, `pint`, `quart`, `gallon`, `ml`, `l` (volume); `oz`, `lb`, `g`, `kg` (mass); `whole`, `clove`, `stick`, `can`, `box`, `bunch`, `pkg`, `slice` (count); `pinch`, `dash` (informal). Omit `quantity`/`unit` entirely for a to-taste ingredient like salt.

## 2. The marking rule — stated narrowly

Step text can reference an ingredient's amount with `{{Ingredient|1/2 stick}}` so that amount scales when the recipe is scaled or converted to a target serving count. **But mark an amount ONLY when its ingredient is used in more than one step.** If an ingredient appears in exactly one step, leave the amount as plain prose — it already has one number on the card (the ingredient list) and needs no markup.

**Most recipes need zero markup.** Don't reach for `{{...}}` by default; it exists for the specific case of a split ingredient.

Worked example — mac and cheese, where butter is used twice (once to sauté, once stirred in at the end):

```json
{
  "title": "Mac and Cheese",
  "ingredients": [{ "item": "Butter", "quantity": 1, "unit": "stick" }],
  "steps": [
    "Melt {{Butter|1/2 stick}} in a pan and sauté the breadcrumbs.",
    "Off heat, stir in {{Butter|1/2 stick}} until the sauce is glossy."
  ]
}
```

Both marks reference the same ingredient (`Butter`), together they total `1 stick` — exactly what the ingredient list says. The printed card shows the split under the ingredient line automatically ("1/2 stick in step 1, 1/2 stick in step 2"), so the cook sees it without hunting through the steps.

## 3. The style rule — don't restate a single-use amount

If an ingredient is used in exactly one step, write the step in prose without repeating its quantity: **"add the flour"**, not **"add 2/3 cup flour."** The ingredient list already carries that number. Restating it gives the card two numbers for one fact, and if the recipe is scaled, the un-marked prose number goes stale while the ingredient-list number updates — now the two disagree. `check-recipe.mjs` flags a restated full amount as a `restated-amount` warning.

## 4. Why it matters — unmarked amounts do not scale, and that is deliberate

Only `{{...}}`-marked amounts scale when a recipe is scaled or converted to a target serving count. Everything else in step prose is printed verbatim. This is not a limitation to work around — **it is required**, because step prose also carries things that must never scale: an oven temperature, a cook time, a pan size. `375F` and `18 minutes` do not become `750F` and `36 minutes` when a recipe is doubled — an oven runs at the temperature it runs at regardless of batch size. If every number in a step scaled automatically, doubling a recipe would try to preheat the oven to 750°F. Marking is opt-in, per-amount, and exists only for the ingredient-quantity case where scaling actually is correct.

## 5. Reservations

When an ingredient is split with a *vague* or *unstructured* portion — "a few cubes of butter, off heat" — give it a structured `reserve` on the ingredient itself, with a `label` describing when/how it's used:

```json
{ "item": "Butter", "quantity": 1, "unit": "stick", "reserve": { "quantity": 2, "unit": "tbsp", "label": "off heat, to finish" } }
```

`reserve.quantity`/`reserve.unit` are optional — a reserve can be label-only ("a pinch, for garnish") when there's nothing to subtract numerically. If `quantity` IS given, it cannot exceed the ingredient's own quantity in the same unit.

**A derived split — two `{{marks}}` on the same ingredient across steps — needs no `reserve` at all.** The marking itself is the structure; `reserve` is only for a portion that is never marked in step text (e.g. garnish reserved off-card, or a vague hand-wave the author never quantified per-step). Don't add both for the same split.

## 6. The `List` shape

```
{
  title: string,
  subtype?: "shopping" | "packing" | "chore" | "todo",
  items: [{ text: string, quantity?: number, unit?: string, note?: string, checked?: boolean, section?: string, from?: string[] }],
  notes?: string[],
}
```

`items` is **flat** — there is no grouping structure to build yourself. Set `section` on each item to one of the eleven grocery-section values (`produce`, `meat_seafood`, `dairy_eggs`, `bakery`, `deli`, `frozen`, `pantry`, `spices`, `beverages`, `household`, `other`) and `print_list` groups and orders them into store-walk order automatically. **Checkboxes are drawn for you** — don't put `[ ]`/`☐` in the item text; `checked` is a real field.

## 7. Cook's notes vs `Recipe.notes[]` — a naming hazard

These are two different things that share the word "notes" and are easy to conflate:

- **`Recipe.notes[]`** is part of the recipe document itself — authored guidance from the recipe's *source* ("can substitute margarine", "best made a day ahead"). It's set via `save_recipe`/`update_recipe` and travels with the recipe.
- **Cook's notes** are the *user's own history* with this dish ("used half the salt", "needed 5 more minutes than stated") — stored **separately** from the recipe (its own table, via `add_cook_note`/`delete_cook_note`), so editing the recipe with `update_recipe` never touches or disturbs them. `get_recipe` returns both, distinctly (`recipe.notes` vs. `cook_notes`), and the most recent few cook's notes print on the card under their own "Cook's notes" heading, separate from the recipe's own "Notes" section.

Don't write a cook's observation into `Recipe.notes[]` — it'll get silently blown away the next time the recipe itself is edited. Use `add_cook_note`.

## 8. The verification gate — run this before every save or print

```bash
node check-recipe.mjs recipe.json
```

- **Exit 1** = invalid. The kernel's own `validateRecipe` would reject this — fix the reported field before calling `save_recipe` or `print_recipe`; it would fail at that point too.
- **Exit 0** = valid, with any advisory warnings printed underneath (`unmarked-split`, `restated-amount`, `prose-reserve`). **Warnings do NOT block a save or a print** — they're hints, not errors. `unmarked-split` is the one worth acting on: it means an ingredient used in multiple steps has an amount written in prose instead of `{{marked}}`, so it won't scale.

Feed it either a bare recipe object or the whole tool-call args (`{ "recipe": {...} }`) — it unwraps either shape.

## 9. The call sequence

```
list_printers          # find the printer_id
get_printer_status      # confirm it's reachable before printing
save_recipe / print_recipe   # (or print_recipe with recipe_id to reprint a saved one)
```

For a list: `list_printers` → `get_printer_status` → `save_list` / `print_list`. Saving first (`save_recipe`/`save_list`) is worth doing whenever the user might want the recipe/list again — `print_recipe`/`print_list` can then be called with `recipe_id`/`list_id` instead of re-sending the whole object, and a saved recipe's cook's notes print automatically.

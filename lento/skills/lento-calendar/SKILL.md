---
name: lento-calendar
description: Use when someone asks the Lento to print, make, or generate a calendar, month, week, day, year planner, wall planner, or agenda on their thermal printer — anything routed to the print_calendar tool.
---

# Printing calendars for the Lento (`print_calendar`)

## The core idea

`print_calendar` takes a small, high-level spec — a `view`, an anchor `date`, and some optional formatting knobs — and the kernel builds the whole layout for you (grid sizing, weekday/month names, numbering). You never hand-build a grid for this; you just pick the right `view` and `date`, and the right `orientation` for how it'll be read.

There are four views: `month`, `week`, `day`, `year`. Each anchors off `date` differently — get this right before you call the tool:

| `view` | what `date` means |
|---|---|
| `month` | any date in the target month — the tool prints that whole month (year + month matter; the day is ignored) |
| `week` | any date in the target week — the tool snaps back to that week's start (per `week_start`/locale) and prints all 7 days |
| `day` | the exact date — prints just that one day |
| `year` | any date in the target year — the tool prints the whole year (only the year matters) |

So "print next Tuesday" for a `day` view needs that Tuesday's exact ISO date; "print this week" for a `week` view can use *any* day in it — you don't need to compute the Monday yourself.

## Every field

```
{
  printer_id: string,        // required — from list_printers
  view: "month"|"week"|"day"|"year",  // required
  date: "YYYY-MM-DD",        // required — a real calendar date; anchors per the table above
  title?: string,            // override the derived heading (default: "July 2026", "2026", "July 14, 2026", "Week of July 14")
  locale?: string,           // BCP-47, e.g. "en-US", "fr-FR". Default en-US. Drives month/weekday names AND the default week start.
  week_start?: "sunday"|"monday",  // override the locale's default week start
  density?: "compact"|"roomy",     // month view only — cell height. Default roomy.
  orientation?: "portrait"|"landscape",  // landscape is read by turning the paper — see below. Default portrait.
  style?: "cells"|"gantt",   // week/day only — cosmetic in v1; both render the same write-in grid (a true time-scaled timeline is a future upgrade, so don't promise proportional hour-blocks yet)
  day_start_hour?: number,  // 0-23, day/week schedule start. Default 7.
  day_end_hour?: number,    // 0-23, day/week schedule end. Default 21. Must be greater than day_start_hour.
}
```

`day_start_hour`/`day_end_hour` only affect the `day` view's hour rows and the landscape `week` view's hour axis — they don't apply to `month`/`year`. For a **full 24-hour day**, pass `day_start_hour: 0, day_end_hour: 23`.

An `events` field is not part of this shape — the tool doesn't take a list of appointments to lay out. If a future version adds one, it will show up in the schema; don't invent one today.

## Orientation — when to go landscape

**Portrait** (the default) prints down the narrow column, same as everything else on the printer.

**Landscape** rotates the whole layout 90°: it's laid out on the paper's long axis and comes out as a wide strip you read by turning sideways. **Always tell the person this when you print landscape**: the print comes out sideways; turn the receipt to read it.

Use landscape for:
- **The week view as a timeline** — 7 day-columns side by side, each a tall write-in slot. This reads far better landscape than as 7 stacked portrait bands, especially with a wide schedule window.
- **The year wall-planner** — a single landscape grid: a day-number header row (1–31) down one axis and a labeled row per month, so the whole year is one glance-able strip pinned to a wall. **State this plainly when it's relevant: the portrait year view is 12 tiny mini-months stacked down a narrow column — coarse and hard to read on narrow paper. Landscape is the legible annual view.** If someone asks for "a year calendar" without specifying orientation, lean toward recommending landscape.

`month` and `day` can go landscape too (a wide row of write-in cells), but they're most useful in portrait — reach for landscape mainly for `week` and `year`.

## Worked examples

**Month (portrait, default):**
```json
{ "printer_id": "<from list_printers>", "view": "month", "date": "2026-07-01" }
```
Prints July 2026, 7 columns × up to 6 weeks, roomy write-in cells.

**Week, as a landscape timeline:**
```json
{
  "printer_id": "<from list_printers>",
  "view": "week", "date": "2026-07-14",
  "orientation": "landscape",
  "day_start_hour": 7, "day_end_hour": 21
}
```
Any date inside the target week works — the tool snaps to the week containing July 14, 2026 and prints all 7 days as landscape columns. Mention that it prints sideways.

**Day, full 24 hours:**
```json
{
  "printer_id": "<from list_printers>",
  "view": "day", "date": "2026-07-14",
  "day_start_hour": 0, "day_end_hour": 23,
  "title": "Launch Day"
}
```
An hour row for every hour of the day, midnight through 11pm, under a custom title.

**Year, as the landscape wall-planner (recommended for "a year calendar"):**
```json
{
  "printer_id": "<from list_printers>",
  "view": "year", "date": "2026-01-01",
  "orientation": "landscape"
}
```
Any date in 2026 works — only the year matters. Tell the person this prints as one long sideways strip meant to be read by turning the receipt (or pinned up and read across).

**Year, portrait (only if they specifically want it stacked down the column):**
```json
{ "printer_id": "<from list_printers>", "view": "year", "date": "2026-01-01" }
```
12 stacked mini-months — compact but coarse; flag that landscape is more legible if they haven't already chosen portrait on purpose.

## Common mistakes

| Mistake | Fix |
|---|---|
| Computing the week's Monday/Sunday by hand for `view: "week"` | Don't — pass any date in the target week, the tool snaps to the week start. |
| Passing a specific day for `view: "year"` and expecting it to matter | Only the year is used; any date in the target year gives the same print. |
| Printing a portrait year view without mentioning it's coarse | Say so, or default to landscape for "a year calendar" requests. |
| Printing landscape without warning about reading orientation | Always mention: it prints sideways, turn the receipt to read it. |
| Expecting `style: "gantt"` to draw proportional hour blocks | It's cosmetic in v1 — same grid as `style: "cells"`. |
| Passing an `events` list | Not a supported field yet — the tool only lays out the empty template. |
| `day_start_hour`/`day_end_hour` for `month` or `year` | Those fields only affect `day` and the landscape `week` axis. |

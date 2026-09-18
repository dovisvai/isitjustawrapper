# Design system

The visual world is **glass over light**: deep space-navy under three slowly drifting
colour orbs — violet, cyan, ember — with frosted panels floating above them, rim-lit
along the top edge.

This replaced a flat "carbon copy form" look, then briefly an opaque "instrument panel",
in August 2026. Both are anti-reference, not authority.

## The rule that makes it work

**Glass goes on containers, never on rows.**

The table sits inside *one* frosted panel and its rows are transparent within it. Thirty
individually blurred elements would be slower to scroll and — more importantly — would
give every figure a slightly different background to be read against. One controlled
frosted layer means one measurable contrast for the whole table.

That is also why the sticky table header carries its own heavier tint: rows scroll
underneath it, and a fully translucent header would let them show through.

## Why the orbs are not decoration

Frosted glass with nothing behind it is a grey box. The orbs are what make every panel
on the site read as glass — they are the load-bearing part of the effect, not an
ornament layered on top of it. One fixed, composited element carries all three radial
gradients and drifts on a 44-second loop, kept on its own layer with `will-change` so
the motion never repaints content. Disabled entirely under `prefers-reduced-motion`.

## Tokens

Declared once with `light-dark()`, so the palette cannot drift between themes.
`color-scheme` carries the switch. Dark is the stylesheet default, not merely the
preferred option — `auto` is an explicit opt-in state on the toggle.

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--void` | `#070a12` | `#eaeefb` | The page beneath everything |
| `--orb-violet` / `-cyan` / `-ember` | 34–50% alpha | 20–28% alpha | The light behind the glass |
| `--glass` | `rgb(18 24 42 / .58)` | `rgb(255 255 255 / .62)` | Panel surface |
| `--glass-strong` | `.76` alpha | `.78` alpha | Sticky table header |
| `--glass-quiet` | `rgb(255 255 255 / .035)` | `rgb(255 255 255 / .4)` | Row banding, inputs, tags |
| `--rim` | `rgb(255 255 255 / .14)` | `rgb(255 255 255 / .85)` | The lit top edge |
| `--ink` / `--ink-2` | `#f2f5fa` / `#9dabc4` | `#0b1020` / `#4d5875` | Text |
| `--accent` | `#a394ff` | `#5b3df5` | Links, focus, sort state |
| `--fair` / `--steep` / `--wrapper` | `#34e0a1` / `#ffb13d` / `#ff7a88` | `#047857` / `#9a5b00` / `#c62b3d` | Verdict lamps |

Colour strategy is **Restrained**: the orbs own the ambient colour, and every saturated
colour *on a surface* is a verdict.

## Contrast is measured, not assumed

Glass is where contrast quietly fails, because the effective background varies with
whatever is behind it. The check is to composite the glass tint over the **brightest
point of each orb** and measure against that worst case:

| Over | Surface | `--ink` | `--ink-2` | fair | steep | wrapper |
| --- | --- | --- | --- | --- | --- | --- |
| violet | `rgb(35,35,82)` | 13.4 | 6.3 | 8.6 | 8.1 | 5.9 |
| cyan | `rgb(17,47,63)` | 12.8 | 6.0 | 8.2 | 7.7 | 5.6 |
| ember | `rgb(49,32,40)` | 14.1 | 6.6 | 9.0 | 8.5 | 6.1 |

The dark accent was lightened from `#8b7cff` to `#a394ff` after measuring 4.3:1 as link
text over the cyan orb — above AA but with nothing to spare. Re-run this calculation
whenever a glass alpha or an orb colour changes; the numbers move together.

## Materials

- **Rim light.** `border-top-color: var(--rim)` against a fainter `--rim-soft` on the
  other three sides. This single detail is most of what separates convincing glass from
  a translucent rectangle.
- **Status lamps.** Verdict chips are pills with a glyph carrying a tight `text-shadow`
  glow, a 1px border in their own hue and a 12% tint. Each verdict has a distinct glyph
  *and* an uppercase label, so the chip survives greyscale.
- **Verdict dots, in the table only.** Thirty repeated labels are noise, so the table
  column drops to a bare glowing dot. This is the one place colour is the sole *visual*
  carrier, and it rests on two supports: the summary bar immediately above is a legend
  (coloured dot + count + word), and every dot keeps visually-hidden text plus a hover
  title. Worth knowing that red/green is the pairing most affected by colour vision
  deficiency — if that becomes a complaint, restore the glyphs rather than the words.

- **Form controls are opaque, not frosted.** A translucent background leaks into the
  browser-drawn `<select>` popup and composites it to white, which made every option
  invisible against near-white `--ink`. `--field` is deliberately solid, and `option`
  carries it explicitly.
- **Graticule division.** A dashed rule marking off the multiple from the columns left
  of it — the one element carried over from the previous world.

## Type

System stacks, no webfonts — nothing on this site loads from a third-party host.

- **Sans** for prose and headings, tightened to `-0.025em` at display sizes.
- **Mono** for every number, unit, label and control, with `tabular-nums` throughout.
  This is measurement, not a costume: figures must align vertically so two rows can be
  compared at a glance.

## Motion

One authored moment: verdict lamps ramp up in a staggered sequence on load, driven by a
`--row` index set in the markup. Roughly 45ms apart, opacity and glow only, running from
an already-visible state.

**Figures are never animated.** A number that counts up is dashboard theatre and it
undercuts the claim that these are careful estimates. The housing performs; the readout
does not.

## Known traps

- `all: unset` on a button also resets `box-sizing` to `content-box`. In the table
  header that made `width: 100%` resolve to the cell width and then add padding on top,
  overflowing every header by exactly its own padding while the neighbouring cell's
  glass painted over the spill. `box-sizing: border-box` is restored explicitly.
- `backdrop-filter` has a `@supports` fallback that makes panels **solid**, not
  transparent. Unreadable is not an acceptable degradation.
- **The Content-Security-Policy breaks every island unless the build injects hashes.**
  Astro inlines small scripts into the HTML rather than emitting files, and
  `script-src 'self'` blocks inline scripts — so under the production header the theme
  toggle, the table's search and sort, and the calculator all silently stop working.
  `astro dev` never sends the header, so it looks perfect locally. `npm run build` runs
  `scripts/csp-hashes.ts`, which hashes the real output into `dist/_headers`. If you
  ever change how scripts are emitted, re-test by serving `dist/` with those headers
  rather than trusting the dev server.

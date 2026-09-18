# Contributing

Entries arrive by pull request. One JSON file per product in `data/apps/`, named for its slug.

**The short version:** run `npm run admin:new`. It prompts for every field, offers menus for the categories, rates and
tags, validates before it writes, and produces a file that already matches everything below. Then `npm run validate`
before you open the PR — it will tell you more than this document does.

The rest of this page explains what the tool is asking you for, and why.

## The bar for an entry

An entry needs all of these, or it does not go in:

1. **A public price with a date, on the right basis.** If the price is not on a page anyone can open, the entry cannot
   meet the standard.

   > **`monthlyUsd` is always the month-to-month price** — what someone pays without committing to a year. Nearly every
   > vendor advertises a cheaper annual rate; record that in `billingNote`, not in `monthlyUsd`.
   >
   > This is not fussiness. The directory ranks products against each other, so an entry quoting an annual rate while
   > its neighbours quote monthly rates makes both multiples meaningless — a product can halve its apparent markup
   > purely by which of its own prices got picked. Pricing pages very often default their toggle to annual, which is
   > exactly how this goes wrong. Check which toggle is active before you write the number down.
   >
   > Where a vendor prices by region, use the US list price and say so in the billing note.
2. **A usage assumption stated in plain language.** Specific and boring: "80 patient visits a month at about 18
   minutes each". A reader must be able to say "that is nothing like me" and know the number is not about them.
3. **At least two sources**, one of which has `kind: "pricing"`. That is the page the watcher polls weekly.
4. **Reasoning that is not the number.** If your `verdictReasoning` amounts to "the multiple is high", the entry is not
   finished.

## The file

```jsonc
{
  "slug": "example-ai-writer",          // kebab-case; must equal the filename
  "name": "Example AI Writer",
  "vendor": "Example Inc",
  "category": "writing",                // fixed enum — see src/schema.ts
  "url": "https://example.com",

  "pricing": {
    "tier": "Pro",
    "monthlyUsd": 29,
    "billingNote": "Annual billing; month-to-month is $39.",
    "checkedOn": "2026-08-11"           // the date this figure was READ
  },

  "usageAssumption": {
    "description": "40 documents a month, ~2k input and 1k output tokens each.",
    "components": [
      { "modelId": "frontier-mid", "units": { "inputTokens": 80000, "outputTokens": 40000 } }
    ],
    "extras": []                        // non-model monthly costs, if any
  },

  "verdict": "steep",                   // fair | steep | wrapper
  "verdictSummary": "One sentence a reader could quote.",
  "verdictReasoning": "Why this verdict rather than the one the number suggests.",

  "valueAddTags": ["ux-craft"],         // 1-3, strongest first, from the fixed list
  "valueAddNotes": "What the tags miss.",
  "whatYouLose": "What actually breaks if you self-host the equivalent.",
  "diyPath": "The honest cheapest alternative.",

  "sources": [
    { "kind": "pricing", "label": "Pricing page", "url": "https://example.com/pricing" },
    { "kind": "rate-card", "label": "API rate card", "url": "https://..." }
  ],

  "verification": { "status": "unverified" },
  "lastReviewed": "2026-08-11"
}
```

**Do not include `estimatedApiCostUsd` or `markupMultiple`.** They are computed at build time from `data/rates.json`,
and the schema will reject the file if it finds them. A stored number and a computed number eventually disagree.

`checkedOn` is the date the figure was read. `verification` is the separate question of whether anyone confirmed it.

## Choosing a verdict

The multiple is a question, not an answer. The question is: *what else is this price buying?*

| | |
| --- | --- |
| **fair** | The price mostly buys things that are not the model. The markup is defensible. |
| **steep** | Genuine work exists on top of the API, but the multiple is high for what it buys. |
| **wrapper** | An interface and a system prompt over a public API. The markup is the product. |

A 40× markup on a compliance-bound medical scribe can be **fair**. A 4× markup on a prompt in a text box can be a
**wrapper**. If your verdict can be derived from the multiple alone, reconsider it.

**On the word "wrapper":** it describes an architecture, not misconduct. Building one is legal, common and often
sensible. Write entries accordingly — state what the product does and what it costs, and let the number carry the
judgement. Copy that editorialises about a vendor's honesty will be sent back.

The project needs its **fair** entries. A directory that only exposes is not a reference, it is a campaign. The
validator warns when fewer than four entries in a set of eight or more are fair.

## Value-add tags

Pick 1–3, strongest first. You may not invent new ones; adding one is a separate PR that changes `src/schema.ts`.

`proprietary-model` · `eval-harness` · `data-pipeline` · `integrations` · `compliance-regulatory` · `scale-infra` ·
`human-in-loop` · `ux-craft` · `orchestration` · `distribution`

## Rates

`data/rates.json` prices **archetypes** ("mid-tier frontier text model"), not named vendor models — naming one would
make every estimate wrong the day that vendor repriced. Each archetype links a real rate card and carries a
`checkedOn`.

Cost is `count / per * usdPer`, summed across every unit of every component. That covers per-million-token text,
per-minute audio, per-image and per-hour GPU rental with one formula. If your product needs a unit that does not exist,
add it to the rate card with a source in the same PR.

Where a product has no comparable public API — an image model with no API, say — price the honest alternative
(self-hosting open weights on rented GPU) and say so in the assumption.

## When the price cannot be checked automatically

Some vendors render prices client-side, often behind a monthly/yearly toggle, so the figure never appears in the HTML
the server sends. The watcher cannot confirm those, and left alone it reports `price-missing` every single week —
which would demote a correctly verified entry every Monday and block the deploy on a false alarm.

If that is genuinely the case, say so in the entry:

```json
"priceCheck": {
  "automatable": false,
  "reason": "The pricing page renders figures client-side behind a monthly/yearly toggle, so the month-to-month price never appears in the served HTML."
}
```

The entry still gets change detection by content hash — if the page moves, you still hear about it. Only the
price-string match is skipped. **Use this when the check is impossible, never to silence an inconvenient warning:** a
monitor people learn to ignore is worse than no monitor. Say concretely what you observed, so the next person can
re-test it when the vendor rebuilds their site.

## Verification

New entries are merged as `unverified`. That is fine and expected; it just means they cannot be published yet.

To promote an entry to `verified`, run `npm run admin:verify` — it opens the pricing page for you, asks the one
question, and writes the block below with your name in it. If you would rather do it by hand: open the vendor's pricing
page yourself, confirm the tier, the price and the billing period, and commit:

```json
"verification": {
  "status": "verified",
  "checkedBy": "your-handle",
  "checkedOn": "2026-08-11"
}
```

Your name goes on it. `npm run check:publish` fails while anything is not `verified`, and the weekly price watcher can
demote an entry back to `unverified` automatically when a vendor's page changes.

## Corrections

If a published figure was wrong, fix the entry **and** add an item to `data/corrections.json` in the same PR. Log the
ones we caught ourselves too — a reference that only publishes the mistakes outsiders spotted is not more accurate, it
is just harder to check.

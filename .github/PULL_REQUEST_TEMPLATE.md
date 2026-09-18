<!--
Thanks for contributing. `npm run validate` will tell you more than this template does — run it first.
-->

## What this changes

<!-- One or two lines. If it adds or edits an entry, name the product. -->

## If this touches a price

- [ ] The figure is the **month-to-month** price, not an annual rate shown as a monthly equivalent
- [ ] I opened the vendor's pricing page myself and checked which way the monthly/yearly toggle was set
- [ ] `pricing.checkedOn` is today's date
- [ ] The `billingNote` describes the same price the entry lists — they do not contradict each other
- [ ] If a published figure changed, I added an entry to `data/corrections.json`

## If this adds an entry

- [ ] At least two sources, one with `kind: "pricing"`
- [ ] The usage assumption is stated in plain language a reader can disagree with
- [ ] `verdictReasoning` says something the multiple alone does not
- [ ] `verification.status` is `unverified` (a maintainer promotes it — do not mark your own entry verified unless you are one)

## Checks

- [ ] `npm run validate` passes
- [ ] `npm run build` passes

<!--
A reminder on tone, since it is the thing most often sent back: state what a product does and what it costs,
and let the number carry the judgement. "Wrapper" describes an architecture, not a vendor's conduct.
-->

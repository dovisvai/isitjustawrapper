/**
 * The whole directory as one JSON document, for anyone — or any model — that
 * would rather read data than scrape a table. Built from the same entries as the
 * pages, so it cannot disagree with them. Linked from every page's <head>, from
 * /llms.txt, and as the Dataset's download in the home page's structured data.
 */

import type { APIRoute } from 'astro';
import { loadEntries, loadRateCard } from '../lib/data.ts';
import { VERDICT_META } from '../lib/format.ts';

export const GET: APIRoute = ({ site }) => {
  const entries = loadEntries();
  const rateCard = loadRateCard();
  const abs = (path: string) => new URL(path, site).toString();

  const body = {
    name: 'Is it just a wrapper?',
    description:
      "Estimated inference cost, markup multiple and verdict for AI products. Estimates, not measurements: costs are what the stated usage would cost at published API rates, and real vendor costs are usually lower, so every multiple is a floor.",
    url: abs('/'),
    methodology: abs('/methodology/'),
    corrections: abs('/corrections/'),
    license: 'CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/',
    citation: 'Is it just a wrapper? (isitjustawrapper.com)',
    generatedAt: new Date().toISOString(),
    verdicts: Object.fromEntries(
      Object.entries(VERDICT_META).map(([k, v]) => [k, v.definition]),
    ),
    rateCard,
    entries: entries.map(({ app, cost }) => ({
      slug: app.slug,
      name: app.name,
      vendor: app.vendor,
      category: app.category,
      page: abs(`/app/${app.slug}/`),
      productUrl: app.url,
      tier: app.pricing.tier,
      monthlyUsd: app.pricing.monthlyUsd,
      billingNote: app.pricing.billingNote,
      priceCheckedOn: app.pricing.checkedOn,
      estimatedApiCostUsd: Math.round(cost.totalUsd * 100) / 100,
      markupMultiple: cost.markupMultiple === null ? null : Math.round(cost.markupMultiple * 100) / 100,
      verdict: app.verdict,
      verdictSummary: app.verdictSummary,
      verdictReasoning: app.verdictReasoning,
      usageAssumption: app.usageAssumption.description,
      valueAdd: app.valueAddTags,
      whatYouLose: app.whatYouLose,
      diyPath: app.diyPath,
      sources: app.sources,
      verification: app.verification,
      lastReviewed: app.lastReviewed,
    })),
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};

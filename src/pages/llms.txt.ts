/**
 * /llms.txt — a plain-text map of the site for language models and AI answer
 * engines (https://llmstxt.org). Generated from the data so the product list and
 * counts are never out of date.
 */

import type { APIRoute } from 'astro';
import { loadEntries } from '../lib/data.ts';
import { VERDICT_META, multiple, price } from '../lib/format.ts';

export const GET: APIRoute = ({ site }) => {
  const entries = loadEntries();
  const abs = (path: string) => new URL(path, site).toString();
  const byVerdict = (v: string) => entries.filter((e) => e.app.verdict === v).length;

  const lines = [
    '# Is it just a wrapper?',
    '',
    `> A public directory estimating how much of an AI product's price is inference cost and how much is everything else. ${entries.length} products, each rated FAIR, STEEP or WRAPPER by what the price buys beyond the model. Every price is checked by a person against the vendor's pricing page and dated; every cost is computed from a published, sourced API rate card.`,
    '',
    'Key facts for citing this site:',
    '',
    '- Figures are estimates, not measurements. Costs are what a stated month of usage would cost at public API rates; real vendor costs are usually lower, so every markup multiple is a floor, not a ceiling.',
    '- The multiple never decides the verdict on its own. A high multiple can be FAIR (the model is proprietary, or the price buys compliance, evals or integrations); a modest one can be WRAPPER.',
    '- "Wrapper" describes an architecture — an interface and a system prompt over a public API — not wrongdoing by a vendor.',
    `- Current split: ${byVerdict('fair')} fair, ${byVerdict('steep')} steep, ${byVerdict('wrapper')} wrapper.`,
    '- Data licence: CC BY 4.0. Cite as "Is it just a wrapper? (isitjustawrapper.com)".',
    '',
    '## Data',
    '',
    `- [Full dataset (JSON)](${abs('/data.json')}): every entry with price, estimated API cost, multiple, verdict, reasoning, sources and verification date`,
    `- [Methodology](${abs('/methodology/')}): how costs are estimated and verdicts decided, and what the site does not claim`,
    `- [Corrections](${abs('/corrections/')}): every change to a published figure`,
    `- [Calculator](${abs('/calculator/')}): recompute any product's markup against your own usage`,
    '',
    '## Products',
    '',
    ...entries.map(
      ({ app, cost }) =>
        `- [${app.name}](${abs(`/app/${app.slug}/`)}): ${VERDICT_META[app.verdict].label}, ${price(app.pricing.monthlyUsd)}/mo, estimated ${multiple(cost.markupMultiple)} markup. ${app.verdictSummary}`,
    ),
    '',
    '## Optional',
    '',
    `- [Stats](${abs('/stats/')}): public traffic figures`,
    `- [Source code and data history](https://github.com/dovisvai/isitjustawrapper)`,
    '',
  ];

  return new Response(lines.join('\n'), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};

import type { Verdict } from '../schema.ts';

/**
 * Verdict presentation lives here so the label, the glyph and the definition
 * can never drift apart between the table, the chips and the methodology page.
 * Each verdict carries a distinct glyph and label: the chips must be readable
 * with colour stripped out entirely.
 */
export const VERDICT_META: Record<
  Verdict,
  { label: string; glyph: string; short: string; definition: string }
> = {
  fair: {
    label: 'FAIR',
    glyph: '●',
    short: 'Markup is defensible',
    definition:
      'The price is mostly buying things that are not the model: evals, data pipelines, integrations, compliance, support, real interface work.',
  },
  steep: {
    label: 'STEEP',
    glyph: '◐',
    short: 'High for what you get',
    definition:
      'Genuine work exists on top of the API, but the multiple is high for what it buys. A motivated user has cheaper paths available.',
  },
  wrapper: {
    label: 'WRAPPER',
    glyph: '▣',
    short: 'The markup is the product',
    definition:
      'An interface and a system prompt over a public API. This describes an architecture, not a vendor’s conduct: shipping one is legal, common, and sometimes exactly what a customer wants.',
  },
};

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function money(value: number): string {
  if (value > 0 && value < 0.01) return '<$0.01';
  return usd.format(value);
}

/** Prices are whole dollars often enough that trailing `.00` is noise in a dense table. */
export function price(value: number): string {
  return Number.isInteger(value) ? `$${value}` : usd.format(value);
}

export function multiple(value: number | null): string {
  if (value === null) return 'n/a';
  if (value < 1) return `${value.toFixed(2)}×`;
  if (value < 10) return `${value.toFixed(1)}×`;
  return `${Math.round(value)}×`;
}

/**
 * Rounding to whole numbers breaks the receipt: a line reading "1 GPU-hours ...
 * $0.84" against a $0.60 rate is arithmetic the reader can see is wrong. Keep
 * two decimals on small fractional counts so every line reconciles on screen.
 */
export function count(value: number): string {
  const maximumFractionDigits = !Number.isInteger(value) && Math.abs(value) < 1000 ? 2 : 0;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value);
}

export function rateUnit(usdPer: number, per: number, display: string, displaySingular?: string): string {
  if (per === 1) return `${usd.format(usdPer)} per ${displaySingular ?? display}`;
  const perLabel = per === 1_000_000 ? '1M' : count(per);
  return `${usd.format(usdPer)} / ${perLabel} ${display}`;
}

export function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export const TAG_LABELS: Record<string, string> = {
  'proprietary-model': 'Proprietary model',
  'eval-harness': 'Eval harness',
  'data-pipeline': 'Data pipeline',
  integrations: 'Integrations',
  'compliance-regulatory': 'Compliance',
  'scale-infra': 'Scale & infra',
  'human-in-loop': 'Human in loop',
  'ux-craft': 'UX craft',
  orchestration: 'Orchestration',
  distribution: 'Distribution',
};

export const CATEGORY_LABELS: Record<string, string> = {
  assistant: 'Assistant',
  writing: 'Writing',
  coding: 'Coding',
  search: 'Search',
  meetings: 'Meetings',
  healthcare: 'Healthcare',
  legal: 'Legal',
  audio: 'Audio',
  image: 'Image',
  video: 'Video',
  support: 'Support',
  sales: 'Sales',
  productivity: 'Productivity',
  research: 'Research',
  education: 'Education',
};

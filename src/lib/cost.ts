import type { App, RateCard } from '../schema.ts';

/**
 * One line of the cost receipt. Every figure a reader sees on an app page is
 * one of these, so the arithmetic is always visible rather than asserted.
 */
export interface CostLine {
  /** Which usage component this line came from, so the receipt can print its note once. */
  componentIndex: number;
  modelId: string;
  modelLabel: string;
  unitKey: string;
  display: string;
  displaySingular?: string;
  count: number;
  usdPer: number;
  per: number;
  usd: number;
  note?: string;
}

export interface ExtraLine {
  label: string;
  usd: number;
  note?: string;
}

export interface CostEstimate {
  lines: CostLine[];
  extras: ExtraLine[];
  modelUsd: number;
  extrasUsd: number;
  totalUsd: number;
  /** price ÷ estimated cost. Null when the estimate rounds to zero, rather than Infinity. */
  markupMultiple: number | null;
  /** Rate-card ids this estimate depends on, for showing "what this is priced against". */
  modelIds: string[];
}

export class RateLookupError extends Error {}

/**
 * Cost is `count / per * usdPer` summed over every unit of every component.
 * That one formula covers per-million-token text, per-minute audio, per-image
 * and per-hour GPU rental without a special case for each.
 */
export function computeCost(app: App, rateCard: RateCard): CostEstimate {
  const lines: CostLine[] = [];

  for (const [componentIndex, component] of app.usageAssumption.components.entries()) {
    const rate = rateCard.models[component.modelId];
    if (!rate) {
      throw new RateLookupError(
        `${app.slug}: unknown modelId "${component.modelId}" — add it to data/rates.json or fix the reference`,
      );
    }

    for (const [unitKey, count] of Object.entries(component.units)) {
      const unit = rate.units[unitKey];
      if (!unit) {
        throw new RateLookupError(
          `${app.slug}: rate "${component.modelId}" has no unit "${unitKey}" (it prices: ${Object.keys(rate.units).join(', ')})`,
        );
      }
      lines.push({
        componentIndex,
        modelId: component.modelId,
        modelLabel: rate.label,
        unitKey,
        display: unit.display,
        displaySingular: unit.displaySingular,
        count,
        usdPer: unit.usdPer,
        per: unit.per,
        usd: (count / unit.per) * unit.usdPer,
        note: component.note,
      });
    }
  }

  const extras: ExtraLine[] = app.usageAssumption.extras.map((e) => ({
    label: e.label,
    usd: e.monthlyUsd,
    note: e.note,
  }));

  const modelUsd = lines.reduce((sum, l) => sum + l.usd, 0);
  const extrasUsd = extras.reduce((sum, e) => sum + e.usd, 0);
  const totalUsd = modelUsd + extrasUsd;

  return {
    lines,
    extras,
    modelUsd,
    extrasUsd,
    totalUsd,
    markupMultiple: totalUsd > 0 ? app.pricing.monthlyUsd / totalUsd : null,
    modelIds: [...new Set(lines.map((l) => l.modelId))],
  };
}

/**
 * Recompute a markup for a reader's own volume. The calculator scales every
 * usage component by the same factor rather than asking the reader to restate
 * token counts they have no way of knowing.
 */
export function scaleCost(estimate: CostEstimate, factor: number, monthlyUsd: number): CostEstimate {
  const lines = estimate.lines.map((l) => ({ ...l, count: l.count * factor, usd: l.usd * factor }));
  const extras = estimate.extras.map((e) => ({ ...e, usd: e.usd * factor }));
  const modelUsd = estimate.modelUsd * factor;
  const extrasUsd = estimate.extrasUsd * factor;
  const totalUsd = modelUsd + extrasUsd;
  return {
    ...estimate,
    lines,
    extras,
    modelUsd,
    extrasUsd,
    totalUsd,
    markupMultiple: totalUsd > 0 ? monthlyUsd / totalUsd : null,
  };
}

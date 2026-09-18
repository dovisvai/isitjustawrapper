import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  AppSchema,
  RateCardSchema,
  SponsorsSchema,
  CorrectionsSchema,
  WatchReportSchema,
  SPONSOR_SLOT_COUNT,
  STALE_AFTER_DAYS,
  type App,
  type RateCard,
  type WatchResult,
} from '../schema.ts';
import { computeCost, type CostEstimate } from './cost.ts';

/**
 * Filesystem loading rather than `import.meta.glob` so that the exact same code
 * path serves the Astro build, the validator and the price watcher. One loader,
 * one set of failure messages.
 *
 * Resolved from the working directory, not `import.meta.url`: Astro bundles this
 * module into a chunk under dist/ before running it, so a path relative to the
 * source file points nowhere at build time. Every entry point is an npm script
 * run from the repository root.
 */
const DATA_DIR = join(process.cwd(), 'data');

export interface Entry {
  app: App;
  cost: CostEstimate;
  /** Days since lastReviewed; drives the stale flag shown on the site. */
  ageDays: number;
  isStale: boolean;
  watch?: WatchResult;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Could not read ${path}: ${(err as Error).message}`);
  }
}

export function loadRateCard(): RateCard {
  return RateCardSchema.parse(readJson(join(DATA_DIR, 'rates.json')));
}

export function loadWatchReport(): Map<string, WatchResult> {
  const path = join(DATA_DIR, 'price-watch.json');
  if (!existsSync(path)) return new Map();
  const report = WatchReportSchema.parse(readJson(path));
  return new Map(report.results.map((r) => [r.slug, r]));
}

export function daysSince(iso: string, now = new Date()): number {
  return Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000);
}

/** Raw app records with their filenames, for the validator's error messages. */
export function loadAppFiles(): { file: string; raw: unknown }[] {
  const dir = join(DATA_DIR, 'apps');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => ({ file, raw: readJson(join(dir, file)) }));
}

export function loadEntries(): Entry[] {
  const rateCard = loadRateCard();
  const watch = loadWatchReport();

  return loadAppFiles()
    .map(({ file, raw }) => {
      const parsed = AppSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `data/apps/${file} is invalid:\n${parsed.error.issues
            .map((i) => `  · ${i.path.join('.') || '(root)'}: ${i.message}`)
            .join('\n')}\nRun \`npm run validate\` for the full report.`,
        );
      }
      const app = parsed.data;
      const ageDays = daysSince(app.lastReviewed);
      return {
        app,
        cost: computeCost(app, rateCard),
        ageDays,
        isStale: ageDays > STALE_AFTER_DAYS,
        watch: watch.get(app.slug),
      };
    })
    .sort((a, b) => (b.cost.markupMultiple ?? 0) - (a.cost.markupMultiple ?? 0));
}

export function loadSponsors() {
  const filled = SponsorsSchema.parse(readJson(join(DATA_DIR, 'sponsors.json')));
  const bySlot = new Map(filled.map((s) => [s.slot, s]));
  return Array.from({ length: SPONSOR_SLOT_COUNT }, (_, i) => {
    const slot = i + 1;
    return bySlot.get(slot) ?? { slot, status: 'available' as const };
  });
}

export function loadCorrections() {
  const corrections = CorrectionsSchema.parse(readJson(join(DATA_DIR, 'corrections.json')));
  return [...corrections].sort((a, b) => b.date.localeCompare(a.date));
}

export function countBy<T, K extends string>(items: T[], key: (item: T) => K): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

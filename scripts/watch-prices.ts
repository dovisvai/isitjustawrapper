#!/usr/bin/env node
/**
 * Price watcher.
 *
 *   npm run watch:prices              check every cited pricing page, write a report
 *   npm run watch:prices:ci           the same, plus non-zero exit on any drift
 *
 * Flags: --demote  mark an entry unverified when its recorded price disappears
 *        --promote mark an entry auto-observed when its recorded price is present
 *
 * This is a CHANGE DETECTOR, not a price scraper. Pricing pages are rendered
 * client-side, split-tested and localised; anything claiming to reliably *read* a
 * price off one is lying to you. Noticing that the page moved is robust, and it is
 * enough — a human confirms the new number.
 *
 * Statuses, most severe first:
 *   unreachable    the page could not be fetched
 *   price-missing  the recorded price string no longer appears on the page
 *   changed        the page text moved since the last run
 *   new            no previous snapshot to compare against
 *   ok             unchanged, recorded price still present
 */
import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AppSchema, WatchReportSchema, type WatchResult } from '../src/schema.ts';
import { loadAppFiles, loadRateCard } from '../src/lib/data.ts';

const CI = process.argv.includes('--ci');
const DEMOTE = process.argv.includes('--demote');
const PROMOTE = process.argv.includes('--promote');

const REPORT_PATH = fileURLToPath(new URL('../data/price-watch.json', import.meta.url));
const APPS_DIR = fileURLToPath(new URL('../data/apps/', import.meta.url));

// ASCII only: HTTP header values are latin-1, so a stray em dash here throws
// before the request is ever sent.
// Points at the methodology page rather than the repository: a vendor whose
// pricing page we fetch weekly should land somewhere that explains what this is
// and how to file a correction, not on a git host.
const USER_AGENT =
  'is-it-just-a-wrapper price watcher (+https://isitjustawrapper.com/methodology); weekly check of publicly listed prices';
const TIMEOUT_MS = 20_000;
const CONCURRENCY = 4;
const today = new Date().toISOString().slice(0, 10);

const c = process.stdout.isTTY
  ? { red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m', off: '\x1b[0m' }
  : { red: '', yellow: '', green: '', dim: '', bold: '', off: '' };

/** Strip everything that changes between two identical page loads: scripts, tags, whitespace. */
function normalise(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function priceCandidates(text: string): string[] {
  const found = text.match(/\$\s?\d{1,4}(?:[.,]\d{1,2})?/g) ?? [];
  return [...new Set(found.map((m) => m.replace(/\s/g, '')))].sort(
    (a, b) => Number(a.slice(1).replace(',', '.')) - Number(b.slice(1).replace(',', '.')),
  );
}

/**
 * Does the recorded price appear on the page in any form a pricing page
 * plausibly writes it?
 *
 * Checked against the whitespace-stripped text as well as the normal one:
 * pricing pages routinely split a figure across elements for typographic effect
 * ("$16" in one span, ".99" superscripted in another), which after tag-stripping
 * reads as "$16 .99". Matching only the spaced form reports a false
 * `price-missing` on a price that is plainly there — which is worse than useless,
 * because a watcher that cries wolf gets ignored.
 */
function recordedPricePresent(text: string, usd: number): boolean {
  const plain = Number.isInteger(usd) ? String(usd) : usd.toFixed(2);
  const forms = [`$${plain}`, `us$${plain}`, `${plain}usd`, `${plain}/mo`, `${plain}permonth`];
  if (Number.isInteger(usd)) forms.push(`$${usd}.00`);

  const squashed = text.replace(/\s+/g, '');
  return forms.some((f) => squashed.includes(f.replace(/\s+/g, '')));
}

async function fetchText(url: string): Promise<{ ok: true; text: string } | { ok: false; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    return { ok: true, text: await res.text() };
  } catch (err) {
    const e = err as Error;
    return { ok: false, detail: e.name === 'AbortError' ? `timed out after ${TIMEOUT_MS / 1000}s` : e.message };
  } finally {
    clearTimeout(timer);
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

// --- collect targets -------------------------------------------------------

interface Target {
  slug: string;
  label: string;
  url: string;
  monthlyUsd?: number;
  file?: string;
}

const targets: Target[] = [];

for (const { file, raw } of loadAppFiles()) {
  const parsed = AppSchema.safeParse(raw);
  if (!parsed.success) {
    console.log(`${c.yellow}skip${c.off}  ${file} does not validate — run \`npm run validate\` first`);
    continue;
  }
  const app = parsed.data;
  const pricing = app.sources.find((s) => s.kind === 'pricing');
  if (!pricing) continue;
  targets.push({
    slug: app.slug,
    label: app.name,
    url: pricing.url,
    // Entries that declare the price unmatchable get change detection only. Leaving
    // monthlyUsd undefined is what skips the string match further down.
    monthlyUsd: app.priceCheck?.automatable === false ? undefined : app.pricing.monthlyUsd,
    file,
  });
}

// Rate-card drift matters as much as vendor drift: if the API price moves, every
// estimate on the site is wrong at once.
const rateCard = loadRateCard();
const rateUrls = new Set<string>();
for (const [id, rate] of Object.entries(rateCard.models)) {
  if (rateUrls.has(rate.source.url)) continue;
  rateUrls.add(rate.source.url);
  targets.push({ slug: `rate:${id}`, label: rate.source.label, url: rate.source.url });
}

// --- previous snapshot -----------------------------------------------------

const previous = new Map<string, WatchResult>();
if (existsSync(REPORT_PATH)) {
  const parsed = WatchReportSchema.safeParse(JSON.parse(readFileSync(REPORT_PATH, 'utf8')));
  if (parsed.success) for (const r of parsed.data.results) previous.set(r.slug, r);
}

// --- run -------------------------------------------------------------------

console.log(`${c.dim}Checking ${targets.length} pages…${c.off}\n`);

const results = await mapLimit(targets, CONCURRENCY, async (target): Promise<WatchResult> => {
  const fetched = await fetchText(target.url);

  if (!fetched.ok) {
    return {
      slug: target.slug,
      url: target.url,
      status: 'unreachable',
      checkedOn: today,
      priceCandidates: [],
      detail: fetched.detail,
      // Keep the old hash so a temporary outage does not read as a change next run.
      contentHash: previous.get(target.slug)?.contentHash,
    };
  }

  const text = normalise(fetched.text);
  const contentHash = createHash('sha256').update(text).digest('hex').slice(0, 16);
  const candidates = priceCandidates(text);
  const prior = previous.get(target.slug);

  const seen = target.monthlyUsd === undefined ? undefined : recordedPricePresent(text, target.monthlyUsd);

  let status: WatchResult['status'];
  let detail: string | undefined;

  if (seen === false) {
    status = 'price-missing';
    detail = `recorded $${target.monthlyUsd} not found on the page. Prices visible: ${
      candidates.slice(0, 8).join(', ') || 'none detected (page is probably rendered client-side)'
    }`;
  } else if (!prior?.contentHash) {
    status = 'new';
    detail = 'first snapshot — nothing to compare against yet';
  } else if (prior.contentHash !== contentHash) {
    status = 'changed';
    detail = 'page text changed since the last check — re-read it and confirm the price still stands';
  } else {
    status = 'ok';
  }

  return {
    slug: target.slug,
    url: target.url,
    status,
    checkedOn: today,
    contentHash,
    recordedPriceSeen: seen,
    priceCandidates: candidates.slice(0, 12),
    detail,
  };
});

writeFileSync(REPORT_PATH, `${JSON.stringify({ generatedOn: today, results }, null, 2)}\n`, 'utf8');

// --- optional data mutations ----------------------------------------------

/**
 * The point of --demote: when a vendor's price disappears from their own page,
 * the claim on this site stops being publishable automatically, without waiting
 * for anyone to notice. `check:publish` then fails and the deploy stops.
 */
function rewriteVerification(slug: string, mutate: (v: Record<string, unknown>) => void): void {
  const path = `${APPS_DIR}${slug}.json`;
  if (!existsSync(path)) return;
  const json = JSON.parse(readFileSync(path, 'utf8'));
  mutate(json.verification);
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
}

let demoted = 0;
let promoted = 0;

for (const r of results) {
  if (r.slug.startsWith('rate:')) continue;
  if (DEMOTE && r.status === 'price-missing') {
    rewriteVerification(r.slug, (v) => {
      v.status = 'unverified';
      v.note = `Demoted by the price watcher on ${today}: the recorded price was not found at ${r.url}. A human must re-check before this can be published again.`;
      delete v.checkedBy;
      delete v.checkedOn;
    });
    demoted++;
  }
  if (PROMOTE && r.status === 'ok' && r.recordedPriceSeen === true) {
    rewriteVerification(r.slug, (v) => {
      if (v.status === 'verified') return; // never downgrade a human check
      v.status = 'auto-observed';
      v.checkedBy = 'price-watch';
      v.checkedOn = today;
      v.note = `The recorded price was present at ${r.url} on ${today}. Machine-observed only — still needs a human before publication.`;
    });
    promoted++;
  }
}

// --- report ----------------------------------------------------------------

const order = { unreachable: 0, 'price-missing': 1, changed: 2, new: 3, ok: 4 } as const;
const badge: Record<WatchResult['status'], string> = {
  unreachable: `${c.red}unreachable  ${c.off}`,
  'price-missing': `${c.red}price-missing${c.off}`,
  changed: `${c.yellow}changed      ${c.off}`,
  new: `${c.dim}new          ${c.off}`,
  ok: `${c.green}ok           ${c.off}`,
};

for (const r of [...results].sort((a, b) => order[a.status] - order[b.status])) {
  console.log(`${badge[r.status]} ${r.slug.padEnd(22)} ${c.dim}${r.detail ?? r.url}${c.off}`);
}

const drift = results.filter((r) => r.status === 'changed' || r.status === 'price-missing' || r.status === 'unreachable');
console.log(
  `\n${c.dim}${results.length} checked · ${drift.length} need review${
    demoted ? ` · ${demoted} demoted to unverified` : ''
  }${promoted ? ` · ${promoted} auto-observed` : ''}${c.off}`,
);
console.log(`${c.dim}Report written to data/price-watch.json${c.off}`);

if (CI && drift.length) {
  console.log(`${c.red}${c.bold}✗ ${drift.length} page(s) need a human${c.off}`);
  process.exit(1);
}

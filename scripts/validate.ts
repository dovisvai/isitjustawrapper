#!/usr/bin/env node
/**
 * Data validation and the publication gate.
 *
 *   npm run validate        schema, references and arithmetic — runs before every build
 *   npm run check:publish   the above, plus: refuse to pass while any entry is
 *                           unverified or only machine-observed
 *
 * The second one is the one that keeps a draft price out of production. Wire it
 * into your deploy command, not just CI.
 */
import { AppSchema, SponsorsSchema, CorrectionsSchema, STALE_AFTER_DAYS, VERDICTS } from '../src/schema.ts';
import { loadAppFiles, loadRateCard, loadWatchReport, daysSince } from '../src/lib/data.ts';
import { computeCost } from '../src/lib/cost.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const requireVerified = process.argv.includes('--require-verified');
const allowAuto = process.argv.includes('--allow-auto-observed');

const errors: string[] = [];
const warnings: string[] = [];

const c = process.stdout.isTTY
  ? { red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m', off: '\x1b[0m' }
  : { red: '', yellow: '', green: '', dim: '', bold: '', off: '' };

const dataUrl = (f: string) => fileURLToPath(new URL(`../data/${f}`, import.meta.url));

// --- rate card -------------------------------------------------------------

let rateCard;
try {
  rateCard = loadRateCard();
} catch (err) {
  console.error(`${c.red}data/rates.json is invalid${c.off}\n${(err as Error).message}`);
  process.exit(1);
}

for (const [id, rate] of Object.entries(rateCard.models)) {
  const age = daysSince(rate.checkedOn);
  if (age > STALE_AFTER_DAYS) {
    warnings.push(`rates.json: "${id}" was last checked ${age} days ago — re-check ${rate.source.url}`);
  }
}

// --- apps ------------------------------------------------------------------

const watch = loadWatchReport();
const seenSlugs = new Map<string, string>();
const verdictCounts = Object.fromEntries(VERDICTS.map((v) => [v, 0])) as Record<string, number>;
let appCount = 0;

for (const { file, raw } of loadAppFiles()) {
  const parsed = AppSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`apps/${file} · ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    continue;
  }

  const app = parsed.data;
  appCount++;
  verdictCounts[app.verdict]++;

  const expected = `${app.slug}.json`;
  if (file !== expected) errors.push(`apps/${file}: slug "${app.slug}" requires the filename ${expected}`);

  const duplicate = seenSlugs.get(app.slug);
  if (duplicate) errors.push(`apps/${file}: slug "${app.slug}" already used by ${duplicate}`);
  seenSlugs.set(app.slug, file);

  // Cross-check every usage unit against the rate card, and confirm the
  // arithmetic actually produces a number.
  try {
    const cost = computeCost(app, rateCard);
    if (!Number.isFinite(cost.totalUsd)) errors.push(`apps/${file}: cost estimate is not a finite number`);
    if (cost.totalUsd === 0) {
      warnings.push(`apps/${file}: estimated cost is $0.00, so no multiple can be shown`);
    }
  } catch (err) {
    errors.push(`apps/${file}: ${(err as Error).message}`);
  }

  // Provenance. An entry may sit at `unverified` in the repository; it may not
  // reach production there.
  const status = app.verification.status;
  if (requireVerified) {
    const ok = status === 'verified' || (allowAuto && status === 'auto-observed');
    if (!ok) {
      errors.push(
        `apps/${file}: verification.status is "${status}" — a human must confirm ${app.name}'s price against ${
          app.sources.find((s) => s.kind === 'pricing')?.url ?? 'its pricing page'
        } before this can be published`,
      );
    }
  } else if (status === 'unverified') {
    warnings.push(`apps/${file}: unverified — will block \`npm run check:publish\``);
  }

  const age = daysSince(app.lastReviewed);
  if (age > STALE_AFTER_DAYS) warnings.push(`apps/${file}: last reviewed ${age} days ago`);

  const result = watch.get(app.slug);
  if (result && result.status !== 'ok' && result.status !== 'new') {
    warnings.push(`apps/${file}: price watcher reports "${result.status}" — ${result.detail ?? 'needs review'}`);
  }
}

// --- sponsors and corrections ---------------------------------------------

for (const [file, schema] of [
  ['sponsors.json', SponsorsSchema],
  ['corrections.json', CorrectionsSchema],
] as const) {
  const parsed = schema.safeParse(JSON.parse(readFileSync(dataUrl(file), 'utf8')));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${file} · ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
  }
}

const slots = SponsorsSchema.safeParse(JSON.parse(readFileSync(dataUrl('sponsors.json'), 'utf8')));
if (slots.success) {
  const used = new Set<number>();
  for (const s of slots.data) {
    if (used.has(s.slot)) errors.push(`sponsors.json: slot ${s.slot} is claimed twice`);
    used.add(s.slot);
  }
}

// --- editorial invariant ---------------------------------------------------

// The brief's own credibility rule: the site defends as often as it exposes.
// A warning rather than an error — it is an editorial judgement, not a schema one.
if (appCount >= 8 && verdictCounts.fair < 4) {
  warnings.push(
    `only ${verdictCounts.fair} entries are FAIR out of ${appCount}. The 🔴 verdicts are believable because the 🟢 ones exist.`,
  );
}

// --- report ----------------------------------------------------------------

for (const w of warnings) console.log(`${c.yellow}warn${c.off}  ${w}`);
for (const e of errors) console.log(`${c.red}error${c.off} ${e}`);

const summary = VERDICTS.map((v) => `${verdictCounts[v]} ${v}`).join(' · ');
console.log(
  `\n${c.dim}${appCount} entries (${summary}) · ${Object.keys(rateCard.models).length} rates · ${
    warnings.length
  } warnings${c.off}`,
);

if (errors.length) {
  console.log(`${c.red}${c.bold}✗ ${errors.length} error${errors.length === 1 ? '' : 's'}${c.off}`);
  process.exit(1);
}
console.log(
  `${c.green}${c.bold}✓ data is valid${c.off}${requireVerified ? `${c.dim} · every entry is human-verified${c.off}` : ''}`,
);

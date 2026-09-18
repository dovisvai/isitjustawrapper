#!/usr/bin/env node
/**
 * Admin console.
 *
 *   npm run admin            what needs your attention
 *   npm run admin:verify     guided verification — the main chore, one prompt per entry
 *   npm run admin:new        scaffold a new entry without hand-writing JSON
 *   npm run admin:price      change a price, log the correction, reset verification
 *   npm run admin:sponsor    fill or clear a sponsor slot
 *
 * Everything here edits the JSON files in data/ and nothing else. There is
 * deliberately no web admin panel and no database: the audit trail — a named
 * human, a dated commit, a reviewable diff — is what makes publishing a claim
 * about someone's pricing defensible. A form that mutates a database in place
 * would throw that away for a bit of convenience.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { CATEGORIES, VALUE_ADD_TAGS, VERDICTS, SPONSOR_SLOT_COUNT, AppSchema } from '../src/schema.ts';
import { loadEntries, loadRateCard, loadSponsors, type Entry } from '../src/lib/data.ts';
import { multiple, price as fmtPrice, money } from '../src/lib/format.ts';

const DATA = fileURLToPath(new URL('../data/', import.meta.url));
const today = new Date().toISOString().slice(0, 10);
const rl = createInterface({ input: stdin, output: stdout });

/**
 * Prompts read from a line queue rather than `rl.question`.
 *
 * readline emits every buffered line as soon as it has them, and `question`
 * only captures whichever line arrives while it happens to be waiting. With
 * piped stdin that means the first prompt gets an answer and the rest are
 * silently dropped. Queueing lines ourselves makes the console behave the same
 * whether it is driven by a person or by a script, and turns EOF into a clean
 * exit instead of a process that hangs mid-edit.
 */
const bufferedLines: string[] = [];
const waitingForLine: ((line: string | null) => void)[] = [];
let stdinEnded = false;

rl.on('line', (line) => {
  const waiter = waitingForLine.shift();
  if (waiter) waiter(line);
  else bufferedLines.push(line);
});
rl.on('close', () => {
  stdinEnded = true;
  while (waitingForLine.length) waitingForLine.shift()!(null);
});

function nextLine(): Promise<string | null> {
  if (bufferedLines.length) return Promise.resolve(bufferedLines.shift()!);
  if (stdinEnded) return Promise.resolve(null);
  return new Promise((resolve) => waitingForLine.push(resolve));
}

const c = stdout.isTTY
  ? { red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', blue: '\x1b[34m', dim: '\x1b[2m', bold: '\x1b[1m', off: '\x1b[0m' }
  : { red: '', yellow: '', green: '', blue: '', dim: '', bold: '', off: '' };

// --- file helpers ----------------------------------------------------------

const readJson = (rel: string) => JSON.parse(readFileSync(`${DATA}${rel}`, 'utf8'));
const writeJson = (rel: string, value: unknown) =>
  writeFileSync(`${DATA}${rel}`, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

function logCorrection(entry: {
  slug?: string;
  raisedBy: 'vendor' | 'reader' | 'maintainer' | 'price-watch';
  summary: string;
  change: string;
}): void {
  const log = readJson('corrections.json');
  log.push({ date: today, ...entry });
  writeJson('corrections.json', log);
}

function openInBrowser(url: string): void {
  const win = process.platform === 'win32';
  const cmd = win ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = win ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    console.log(`${c.dim}Could not open a browser. Visit: ${url}${c.off}`);
  }
}

// --- prompt helpers --------------------------------------------------------

async function ask(question: string, fallback = ''): Promise<string> {
  const suffix = fallback ? ` ${c.dim}[${fallback}]${c.off}` : '';
  stdout.write(`${question}${suffix} `);
  const line = await nextLine();
  if (line === null) {
    console.log(`\n${c.red}Input ended before the answer. Stopping here — earlier steps were already saved.${c.off}`);
    process.exit(1);
  }
  return line.trim() || fallback;
}

async function askRequired(question: string, minLength = 1): Promise<string> {
  for (;;) {
    const answer = await ask(question);
    if (answer.length >= minLength) return answer;
    console.log(`${c.red}Needs at least ${minLength} characters.${c.off}`);
  }
}

async function askNumber(question: string, fallback?: number): Promise<number> {
  for (;;) {
    const answer = await ask(question, fallback === undefined ? '' : String(fallback));
    const value = Number(answer);
    if (answer !== '' && Number.isFinite(value) && value >= 0) return value;
    console.log(`${c.red}Enter a number.${c.off}`);
  }
}

async function pick<T>(label: string, options: readonly T[], render: (o: T) => string): Promise<T> {
  console.log(`\n${c.bold}${label}${c.off}`);
  options.forEach((o, i) => console.log(`  ${String(i + 1).padStart(2)}. ${render(o)}`));
  for (;;) {
    const answer = Number(await ask('  Number:'));
    if (Number.isInteger(answer) && answer >= 1 && answer <= options.length) return options[answer - 1]!;
    console.log(`${c.red}Pick 1-${options.length}.${c.off}`);
  }
}

async function pickMany<T>(label: string, options: readonly T[], max: number): Promise<T[]> {
  console.log(`\n${c.bold}${label}${c.off} ${c.dim}(comma-separated numbers, strongest first, max ${max})${c.off}`);
  options.forEach((o, i) => console.log(`  ${String(i + 1).padStart(2)}. ${o}`));
  for (;;) {
    const chosen = (await ask('  Numbers:'))
      .split(',')
      .map((n) => Number(n.trim()))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= options.length)
      .map((n) => options[n - 1]!);
    if (chosen.length >= 1 && chosen.length <= max) return [...new Set(chosen)];
    console.log(`${c.red}Pick between 1 and ${max}.${c.off}`);
  }
}

async function confirm(question: string): Promise<boolean> {
  const answer = (await ask(`${question} ${c.dim}(y/N)${c.off}`)).toLowerCase();
  return answer === 'y' || answer === 'yes';
}

/** Attribution is the point of the whole exercise, so it is never optional. */
let cachedName = process.env.ADMIN_NAME ?? '';
async function maintainerName(): Promise<string> {
  if (!cachedName) {
    cachedName = await askRequired('Your name or handle (goes into the entry and the commit):', 2);
  }
  return cachedName;
}

// --- status ----------------------------------------------------------------

function attention(entries: Entry[]) {
  return {
    unverified: entries.filter((e) => e.app.verification.status === 'unverified'),
    autoOnly: entries.filter((e) => e.app.verification.status === 'auto-observed'),
    stale: entries.filter((e) => e.isStale),
    flagged: entries.filter((e) => e.watch && !['ok', 'new'].includes(e.watch.status)),
  };
}

function showStatus(entries: Entry[]): void {
  const { unverified, autoOnly, stale, flagged } = attention(entries);
  const publishable = entries.length - unverified.length - autoOnly.length;

  console.log(`\n${c.bold}Is it just a wrapper? — admin${c.off}\n`);
  console.log(`  ${c.bold}${entries.length}${c.off} entries · ${c.green}${publishable} publishable${c.off}`);
  console.log(`  ${unverified.length ? c.red : c.dim}${unverified.length} unverified${c.off}   ${
    autoOnly.length ? c.yellow : c.dim
  }${autoOnly.length} machine-checked only${c.off}   ${flagged.length ? c.yellow : c.dim}${
    flagged.length
  } flagged by the watcher${c.off}   ${stale.length ? c.yellow : c.dim}${stale.length} stale${c.off}`);

  if (publishable === entries.length) {
    console.log(`\n  ${c.green}${c.bold}Every entry is human-verified. \`npm run check:publish\` will pass.${c.off}`);
  } else {
    console.log(`\n  ${c.dim}Deploy is blocked until every entry is verified. Run \`npm run admin:verify\`.${c.off}`);
  }

  console.log(`\n${c.dim}  status          entry                  price      multiple  watcher${c.off}`);
  for (const e of entries) {
    const s = e.app.verification.status;
    const badge =
      s === 'verified'
        ? `${c.green}verified   ${c.off}`
        : s === 'auto-observed'
          ? `${c.yellow}auto-only  ${c.off}`
          : `${c.red}unverified ${c.off}`;
    const watch = e.watch?.status ?? '—';
    const watchColour = ['ok', 'new', '—'].includes(watch) ? c.dim : c.yellow;
    console.log(
      `  ${badge} ${e.app.name.padEnd(22).slice(0, 22)} ${fmtPrice(e.app.pricing.monthlyUsd).padStart(8)} ${multiple(
        e.cost.markupMultiple,
      ).padStart(9)}  ${watchColour}${watch}${c.off}`,
    );
  }

  console.log(`\n${c.dim}  npm run admin:verify   confirm prices and unblock the deploy`);
  console.log(`  npm run admin:new      add a product`);
  console.log(`  npm run admin:price    change a price and log the correction`);
  console.log(`  npm run admin:sponsor  fill or clear one of the ${SPONSOR_SLOT_COUNT} slots${c.off}\n`);
}

// --- verify ----------------------------------------------------------------

async function verify(entries: Entry[]): Promise<void> {
  // Highest multiple first: those are the claims that would hurt most if wrong.
  const queue = entries
    .filter((e) => e.app.verification.status !== 'verified')
    .sort((a, b) => (b.cost.markupMultiple ?? 0) - (a.cost.markupMultiple ?? 0));

  if (!queue.length) {
    console.log(`\n${c.green}Nothing to verify — every entry is human-checked.${c.off}\n`);
    return;
  }

  const who = await maintainerName();
  console.log(
    `\n${c.dim}${queue.length} to check, riskiest first. For each: open the page, confirm the tier and the price.\n` +
      `y = correct · n = wrong (you will be asked for the real price) · s = skip · q = quit${c.off}`,
  );
  console.log(
    `\n${c.yellow}Record the MONTH-TO-MONTH price, never the annual rate.${c.off}\n` +
      `${c.dim}Pricing pages very often default their toggle to annual. Because the directory ranks products against\n` +
      `each other, one entry quoting an annual rate while its neighbours quote monthly makes both multiples\n` +
      `meaningless — a product can halve its apparent markup purely by which of its own prices got written down.${c.off}`,
  );

  let done = 0;
  for (const entry of queue) {
    const { app, cost } = entry;
    const pricingUrl = app.sources.find((s) => s.kind === 'pricing')!.url;

    console.log(`\n${c.bold}${app.name}${c.off} ${c.dim}(${app.vendor})${c.off}`);
    console.log(`  Recorded: ${c.bold}${fmtPrice(app.pricing.monthlyUsd)}/mo${c.off} on tier "${app.pricing.tier}"`);
    console.log(`  ${c.dim}${app.pricing.billingNote}${c.off}`);
    console.log(`  Estimated cost ${money(cost.totalUsd)} → ${c.bold}${multiple(cost.markupMultiple)}${c.off} · ${app.verdict.toUpperCase()}`);
    if (entry.watch && !['ok', 'new'].includes(entry.watch.status)) {
      console.log(`  ${c.yellow}watcher: ${entry.watch.status} — ${entry.watch.detail ?? ''}${c.off}`);
    }
    console.log(`  ${c.blue}${pricingUrl}${c.off}`);

    if (await confirm('  Open this page in your browser?')) openInBrowser(pricingUrl);

    const answer = (await ask('  Is the recorded price correct? (y/n/s/q)')).toLowerCase();
    if (answer === 'q') break;
    if (answer === 's' || answer === '') continue;

    const raw = readJson(`apps/${app.slug}.json`);

    if (answer === 'n') {
      const newPrice = await askNumber('  Correct MONTH-TO-MONTH price in USD:');
      if (!(await confirm('  Confirm that is the price without an annual commitment?'))) {
        console.log(
          `  ${c.yellow}Left unchanged. Switch the page's toggle to monthly and run this again.${c.off}`,
        );
        continue;
      }
      const newTier = await ask('  Tier name:', app.pricing.tier);

      // The billing note describes the price in prose. Changing one without the
      // other publishes a page that contradicts itself in two places at once.
      console.log(`  ${c.dim}Current billing note: ${app.pricing.billingNote}${c.off}`);
      const newBillingNote = await ask('  Updated billing note (Enter keeps it):', app.pricing.billingNote);
      if (newBillingNote === app.pricing.billingNote && app.pricing.billingNote.includes('$')) {
        console.log(
          `  ${c.yellow}Note still mentions a dollar figure and you changed the price — check it does not now contradict the entry.${c.off}`,
        );
      }
      raw.pricing.billingNote = newBillingNote;

      const note = await askRequired('  What was wrong, in one line (goes on the public corrections log):', 10);

      logCorrection({
        slug: app.slug,
        raisedBy: 'maintainer',
        summary: `Recorded ${fmtPrice(app.pricing.monthlyUsd)}/month on tier "${app.pricing.tier}". ${note}`,
        change: `Corrected to ${fmtPrice(newPrice)}/month on tier "${newTier}", verified against ${pricingUrl} by ${who}.`,
      });

      raw.pricing.monthlyUsd = newPrice;
      raw.pricing.tier = newTier;
      console.log(`  ${c.yellow}Correction logged.${c.off}`);
    }

    raw.pricing.checkedOn = today;
    raw.lastReviewed = today;
    raw.verification = { status: 'verified', checkedBy: who, checkedOn: today };
    writeJson(`apps/${app.slug}.json`, raw);
    done++;
    console.log(`  ${c.green}Verified by ${who} on ${today}.${c.off}`);
  }

  console.log(`\n${c.green}${done} entr${done === 1 ? 'y' : 'ies'} verified.${c.off}`);
  console.log(`${c.dim}Review with \`git diff\`, then commit — your name is on it.${c.off}\n`);
}

// --- new entry -------------------------------------------------------------

async function newEntry(): Promise<void> {
  const rateCard = loadRateCard();
  const rateIds = Object.keys(rateCard.models);

  console.log(`\n${c.bold}New entry${c.off} ${c.dim}— everything is required; the schema will reject a half-filled file.${c.off}`);

  const name = await askRequired('Product name:', 2);
  const slug = await ask('Slug:', name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  if (existsSync(`${DATA}apps/${slug}.json`)) {
    console.log(`${c.red}data/apps/${slug}.json already exists.${c.off}`);
    return;
  }

  const vendor = await askRequired('Vendor / company:', 2);
  const category = await pick('Category', CATEGORIES, (x) => x);
  const url = await askRequired('Product URL (https://):', 8);
  const tier = await askRequired('Tier name:');
  const monthlyUsd = await askNumber('Monthly price in USD:');
  const billingNote = await askRequired('Billing note — annual vs monthly, what the tier includes:', 10);
  const description = await askRequired('Usage assumption in plain language (20+ chars):', 20);

  const components: unknown[] = [];
  do {
    const modelId = await pick('Which rate does this part of the usage price against?', rateIds, (id) => `${id} — ${rateCard.models[id]!.label}`);
    const units: Record<string, number> = {};
    for (const [key, unit] of Object.entries(rateCard.models[modelId]!.units)) {
      units[key] = await askNumber(`  ${unit.display} per month:`, 0);
    }
    const note = await ask('  Note for this component (optional):');
    components.push(note ? { modelId, units, note } : { modelId, units });
  } while (await confirm('Add another usage component?'));

  const verdict = await pick('Verdict', VERDICTS, (v) => v);
  console.log(`${c.dim}Reminder: the verdict must not be readable off the multiple alone.${c.off}`);
  const verdictSummary = await askRequired('One quotable sentence (20+ chars):', 20);
  const verdictReasoning = await askRequired('Why this verdict rather than the one the number suggests (40+):', 40);
  const valueAddTags = await pickMany('What the price buys besides tokens', VALUE_ADD_TAGS, 3);
  const valueAddNotes = await askRequired('What the tags miss (20+):', 20);
  const whatYouLose = await askRequired('What actually breaks if you self-host the equivalent (20+):', 20);
  const diyPath = await askRequired('The honest cheapest alternative (20+):', 20);

  const pricingSourceUrl = await askRequired('Pricing page URL — the one the watcher will poll:', 8);
  const secondSourceUrl = await askRequired('A second source URL (rate card, docs, comparison):', 8);
  const secondSourceLabel = await askRequired('Label for that second source:', 3);

  const entry = {
    slug,
    name,
    vendor,
    category,
    url,
    pricing: { tier, monthlyUsd, billingNote, checkedOn: today },
    usageAssumption: { description, components, extras: [] },
    verdict,
    verdictSummary,
    verdictReasoning,
    valueAddTags,
    valueAddNotes,
    whatYouLose,
    diyPath,
    sources: [
      { kind: 'pricing', label: `${name} pricing`, url: pricingSourceUrl },
      { kind: 'other', label: secondSourceLabel, url: secondSourceUrl },
    ],
    verification: { status: 'unverified', note: 'New entry; price not yet confirmed by a human.' },
    lastReviewed: today,
  };

  const parsed = AppSchema.safeParse(entry);
  if (!parsed.success) {
    console.log(`\n${c.red}That did not validate:${c.off}`);
    for (const issue of parsed.error.issues) console.log(`  · ${issue.path.join('.')}: ${issue.message}`);
    console.log(`${c.dim}Nothing was written.${c.off}\n`);
    return;
  }

  writeJson(`apps/${slug}.json`, entry);
  console.log(`\n${c.green}Wrote data/apps/${slug}.json${c.off}`);
  console.log(`${c.dim}It is unverified, so it will not publish until you run \`npm run admin:verify\`.${c.off}\n`);
}

// --- change a price --------------------------------------------------------

async function changePrice(entries: Entry[]): Promise<void> {
  const entry = await pick('Which product?', entries, (e) => `${e.app.name} — ${fmtPrice(e.app.pricing.monthlyUsd)}/mo (${e.app.pricing.tier})`);
  const who = await maintainerName();
  const raw = readJson(`apps/${entry.app.slug}.json`);

  const newPrice = await askNumber('New monthly price in USD:', entry.app.pricing.monthlyUsd);
  const newTier = await ask('Tier name:', entry.app.pricing.tier);
  const why = await askRequired('Why did it change (goes on the public corrections log):', 10);

  logCorrection({
    slug: entry.app.slug,
    raisedBy: await pick('Who raised this?', ['vendor', 'reader', 'maintainer', 'price-watch'] as const, (x) => x),
    summary: `${entry.app.name} was listed at ${fmtPrice(entry.app.pricing.monthlyUsd)}/month on tier "${entry.app.pricing.tier}". ${why}`,
    change: `Updated to ${fmtPrice(newPrice)}/month on tier "${newTier}" by ${who}.`,
  });

  raw.pricing.monthlyUsd = newPrice;
  raw.pricing.tier = newTier;
  raw.pricing.checkedOn = today;
  raw.lastReviewed = today;

  // Never assume a price typed here was seen on the vendor's page — a figure
  // relayed in an email is not a figure you checked, and only one of those is
  // publishable.
  raw.verification = (await confirm('Did you just confirm this on the vendor’s own pricing page?'))
    ? { status: 'verified', checkedBy: who, checkedOn: today }
    : {
        status: 'unverified',
        note: `Price changed by ${who} on ${today} without being checked against the vendor's page. Needs confirming before publication.`,
      };
  writeJson(`apps/${entry.app.slug}.json`, raw);

  console.log(`\n${c.green}Updated and logged.${c.off} ${c.dim}The multiple recomputes on the next build.${c.off}`);
  if (raw.verification.status === 'unverified') {
    console.log(`${c.yellow}Left unverified, so it will not publish until someone opens the page.${c.off}`);
  }
  console.log('');
}

// --- sponsors --------------------------------------------------------------

async function manageSponsor(): Promise<void> {
  const slots = loadSponsors();
  const slot = await pick(
    `Sponsor slots (${SPONSOR_SLOT_COUNT} total)`,
    slots,
    (s) => `Slot ${String(s.slot).padStart(2, '0')} — ${s.status === 'filled' ? `${(s as { name?: string }).name}` : 'available'}`,
  );

  const stored: { slot: number; status: string; name?: string; pitch?: string; url?: string; startedOn?: string }[] =
    readJson('sponsors.json');
  const without = stored.filter((s) => s.slot !== slot.slot);

  if (slot.status === 'filled' && (await confirm('This slot is filled. Clear it?'))) {
    writeJson('sponsors.json', without.sort((a, b) => a.slot - b.slot));
    console.log(`\n${c.green}Slot ${slot.slot} is now available.${c.off}\n`);
    return;
  }

  const name = await askRequired('Sponsor name:', 2);
  const pitch = await askRequired('One-line pitch (max 90 chars):', 5);
  const url = await askRequired('Destination URL (https://) — UTM tags are added automatically:', 8);

  without.push({ slot: slot.slot, status: 'filled', name, pitch: pitch.slice(0, 90), url, startedOn: today });
  writeJson('sponsors.json', without.sort((a, b) => a.slot - b.slot));

  console.log(`\n${c.green}Slot ${slot.slot} filled.${c.off}`);
  console.log(`${c.dim}Reminder: this buys placement and nothing else. It cannot affect a verdict.${c.off}\n`);
}

// --- dispatch --------------------------------------------------------------

try {
  const command = process.argv[2] ?? 'status';
  const entries = loadEntries();

  if (command !== 'status' && !stdin.isTTY) {
    console.log(
      `${c.yellow}Note: stdin is not a terminal. These commands are interactive and are not meant to run unattended.${c.off}`,
    );
  }

  if (command === 'verify') await verify(entries);
  else if (command === 'new') await newEntry();
  else if (command === 'price') await changePrice(entries);
  else if (command === 'sponsor') await manageSponsor();
  else showStatus(entries);

  if (command !== 'status') {
    console.log(`${c.dim}Run \`npm run validate\` to check your changes.${c.off}`);
  }
} finally {
  rl.close();
}

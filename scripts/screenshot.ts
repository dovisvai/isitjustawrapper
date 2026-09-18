#!/usr/bin/env node
/**
 * Regenerates the README screenshot.
 *
 *   npm run screenshot
 *
 * Uses `playwright-core` driving whatever Chrome or Edge is already installed,
 * rather than `playwright`, which downloads its own ~150MB browser on install.
 * That keeps the dependency at about two megabytes and keeps CI installs fast.
 *
 * Starts its own dev server unless one is already listening on the port, so it
 * works from a clean checkout with no setup.
 */
import { chromium, type Browser } from 'playwright-core';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = 4321;
// Not named URL: that would shadow the global URL constructor used just below.
const SITE = `http://localhost:${PORT}/`;
// `--mobile` captures the small-screen composition instead; `--out <name>` writes
// somewhere other than the README image, for checking a change without replacing it.
const MOBILE = process.argv.includes('--mobile');
const outFlag = process.argv.indexOf('--out');
const OUT = fileURLToPath(
  new URL(`../docs/${outFlag > -1 ? process.argv[outFlag + 1] : 'screenshot.png'}`, import.meta.url),
);
const WIDTH = MOBILE ? 390 : 1280;
const HEIGHT = MOBILE ? 844 : 900;

async function isUp(): Promise<boolean> {
  try {
    const res = await fetch(SITE, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isUp()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Dev server never came up on ${SITE}`);
}

/** Prefer an already-installed browser; fall back to a Playwright-managed one. */
async function launch(): Promise<Browser> {
  for (const channel of ['chrome', 'msedge'] as const) {
    try {
      return await chromium.launch({ channel });
    } catch {
      /* try the next one */
    }
  }
  try {
    return await chromium.launch();
  } catch {
    throw new Error(
      'No usable browser found. Install Chrome or Edge, or run `npx playwright install chromium`.',
    );
  }
}

let server: ChildProcess | undefined;

try {
  if (!(await isUp())) {
    console.log('Starting dev server…');
    server = spawn('npm', ['run', 'dev'], { shell: true, stdio: 'ignore', detached: false });
    await waitForServer();
  } else {
    console.log(`Reusing the dev server already running on port ${PORT}.`);
  }

  const browser = await launch();
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2, // retina, so the table stays legible when GitHub scales it down
    isMobile: MOBILE,
    hasTouch: MOBILE,
    // No colorScheme override: the stylesheet defaults to dark regardless of the host
    // preference, and the README should show the design's own default.
  });

  await page.goto(SITE, { waitUntil: 'networkidle' });
  // The table is progressively enhanced; give the filter island a moment to boot
  // so the screenshot shows the controls in their real state.
  await page.waitForSelector('#directory tbody tr');
  await page.waitForTimeout(400);

  mkdirSync(fileURLToPath(new URL('../docs', import.meta.url)), { recursive: true });
  await page.screenshot({ path: OUT });
  await browser.close();

  console.log(`Wrote ${OUT.replace(/\\/g, '/').split('/').slice(-2).join('/')} (${WIDTH}x${HEIGHT} @2x)`);
} finally {
  if (server) server.kill();
}

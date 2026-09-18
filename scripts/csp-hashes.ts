#!/usr/bin/env node
/**
 * Injects SHA-256 hashes for every inline script into the built `_headers` file.
 *
 * Astro inlines small scripts into the HTML rather than emitting separate files, so a
 * strict `script-src 'self'` blocks all of them — and because `astro dev` never sends
 * the CSP, the breakage is invisible until production. It is not subtle either: the
 * theme toggle, the table's search and sort, and the calculator all stop existing.
 *
 * Hashes are computed from the actual build output, so they cannot drift out of sync
 * the way a hand-maintained list would. Runs as part of `npm run build`.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));

function* htmlFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* htmlFiles(full);
    else if (name.endsWith('.html')) yield full;
  }
}

const hashes = new Set<string>();
let scanned = 0;

for (const file of htmlFiles(DIST)) {
  scanned++;
  const html = readFileSync(file, 'utf8');
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)) {
    const attrs = match[1] ?? '';
    const body = match[2] ?? '';
    if (!body.trim()) continue;
    // Data blocks are never executed, so the CSP does not apply to them.
    const type = attrs.match(/type=["']([^"']+)["']/)?.[1];
    if (type && !/module|javascript/i.test(type)) continue;
    hashes.add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
}

const headersPath = join(DIST, '_headers');
const headers = readFileSync(headersPath, 'utf8');
const updated = headers.replace(/script-src 'self'[^;]*/, `script-src 'self' ${[...hashes].join(' ')}`);
if (updated === headers) {
  console.error('csp-hashes: could not find a script-src directive in dist/_headers');
  process.exit(1);
}
writeFileSync(headersPath, updated, 'utf8');
console.log(`csp-hashes: ${hashes.size} inline script hash(es) from ${scanned} pages written to dist/_headers`);

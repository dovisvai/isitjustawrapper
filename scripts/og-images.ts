/**
 * Post-build: renders the link-preview cards that X, LinkedIn, Slack, iMessage and
 * search engines show beside a shared URL.
 *
 *   dist/og/site.png     the directory, used by every page without its own card
 *   dist/og/<slug>.png   one per product: name, markup multiple, verdict
 *
 * Generated from the same data as the pages on every build, so a card can never
 * show a price or verdict the page itself no longer does. Satori lays out the
 * card and resvg rasterises it — pure npm, no browser, runs the same in CI.
 * Fonts are bundled from @fontsource rather than fetched, because the build must
 * not depend on a third-party host.
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { loadEntries } from '../src/lib/data.ts';
import { VERDICT_META, multiple, money, price } from '../src/lib/format.ts';
import type { Verdict } from '../src/schema.ts';

const require = createRequire(import.meta.url);
const font = (pkg: string, file: string) => readFileSync(require.resolve(`${pkg}/files/${file}`));

const FONTS = [
  { name: 'Inter', data: font('@fontsource/inter', 'inter-latin-400-normal.woff'), weight: 400 as const },
  { name: 'Inter', data: font('@fontsource/inter', 'inter-latin-800-normal.woff'), weight: 800 as const },
  { name: 'Mono', data: font('@fontsource/jetbrains-mono', 'jetbrains-mono-latin-400-normal.woff'), weight: 400 as const },
  { name: 'Mono', data: font('@fontsource/jetbrains-mono', 'jetbrains-mono-latin-800-normal.woff'), weight: 800 as const },
];

const W = 1200;
const H = 630;
const OUT = join(process.cwd(), 'dist', 'og');

// The dark palette from global.css. Cards are always dark: previews sit in feeds
// of every theme, and the glass look only exists on the dark side.
const C = {
  void: '#070a12',
  ink: '#eef1ff',
  ink2: '#a9b0c9',
  rim: 'rgba(255,255,255,0.14)',
  glass: 'rgba(255,255,255,0.05)',
  accent: '#a394ff',
  fair: '#34e0a1',
  steep: '#ffb13d',
  wrapper: '#ff7a88',
} satisfies Record<string, string>;

// --- a minimal element builder, so this file needs no JSX toolchain ----------

type Node = { type: string; props: { style?: Record<string, unknown>; children?: unknown } };
const el = (style: Record<string, unknown>, ...children: unknown[]): Node => ({
  type: 'div',
  props: { style: { display: 'flex', ...style }, children: children.length === 1 ? children[0] : children },
});

// The orbs behind the glass, as gradients: satori has no blur filter.
const background = {
  backgroundColor: C.void,
  backgroundImage: [
    'radial-gradient(circle at 12% 8%, rgba(110,80,255,0.45), transparent 45%)',
    'radial-gradient(circle at 92% 22%, rgba(20,160,170,0.30), transparent 42%)',
    'radial-gradient(circle at 70% 110%, rgba(255,90,110,0.22), transparent 45%)',
  ].join(', '),
};

const wordmark = (size: number) =>
  el(
    { fontFamily: 'Mono', fontWeight: 800, fontSize: size, letterSpacing: '0.08em', color: C.ink },
    // A trailing space before a flex sibling collapses; a no-break space does not.
    'IS IT JUST A ',
    el({ color: C.wrapper }, 'WRAPPER'),
    '?',
  );

const pill = (verdict: Verdict, text: string, size = 26) =>
  el(
    {
      alignItems: 'center',
      gap: 12,
      padding: `${size * 0.45}px ${size * 0.9}px`,
      border: `2px solid ${C[verdict]}`,
      borderRadius: 999,
      backgroundColor: 'rgba(255,255,255,0.04)',
      color: C[verdict],
      fontFamily: 'Mono',
      fontWeight: 800,
      fontSize: size,
      letterSpacing: '0.08em',
    },
    el({ width: size * 0.5, height: size * 0.5, borderRadius: 999, backgroundColor: C[verdict] }, ''),
    text,
  );

const footer = (left: string) =>
  el(
    {
      justifyContent: 'space-between',
      alignItems: 'center',
      fontFamily: 'Mono',
      fontSize: 22,
      letterSpacing: '0.06em',
      color: C.ink2,
    },
    left,
    el({ color: C.ink }, 'isitjustawrapper.com'),
  );

const frame = (...children: Node[]) =>
  el(
    { width: W, height: H, padding: 56, flexDirection: 'column', justifyContent: 'space-between', ...background },
    ...children,
  );

// --- the two card layouts -----------------------------------------------------

function siteCard(counts: Record<Verdict, number>, total: number): Node {
  return frame(
    wordmark(30),
    el(
      { flexDirection: 'column', gap: 28 },
      el(
        { fontFamily: 'Inter', fontWeight: 800, fontSize: 68, lineHeight: 1.05, color: C.ink, letterSpacing: '-0.02em' },
        'What AI products charge — and what the inference actually costs.',
      ),
      el(
        { gap: 18 },
        pill('fair', `${counts.fair} FAIR`),
        pill('steep', `${counts.steep} STEEP`),
        pill('wrapper', `${counts.wrapper} WRAPPER`),
      ),
    ),
    footer(`${total} PRODUCTS · EVERY PRICE HUMAN-VERIFIED`),
  );
}

function appCard(e: ReturnType<typeof loadEntries>[number]): Node {
  const { app, cost } = e;
  const nameSize = app.name.length > 22 ? 64 : 80;
  return frame(
    wordmark(26),
    el(
      { justifyContent: 'space-between', alignItems: 'flex-end', gap: 40 },
      el(
        { flexDirection: 'column', gap: 18, flex: 1 },
        el(
          { fontFamily: 'Inter', fontWeight: 800, fontSize: nameSize, lineHeight: 1, color: C.ink, letterSpacing: '-0.02em' },
          app.name,
        ),
        el(
          { fontFamily: 'Mono', fontSize: 24, letterSpacing: '0.06em', color: C.ink2 },
          `${app.vendor} · ${app.pricing.tier}`.toUpperCase(),
        ),
        el(
          { marginTop: 18, fontFamily: 'Inter', fontSize: 30, color: C.ink2 },
          `${price(app.pricing.monthlyUsd)}/mo vs ~${money(cost.totalUsd)} est. API cost`,
        ),
      ),
      el(
        {
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 20,
          padding: '28px 36px',
          border: `1px solid ${C.rim}`,
          borderRadius: 28,
          backgroundColor: C.glass,
        },
        el(
          { fontFamily: 'Mono', fontWeight: 800, fontSize: 132, lineHeight: 1, color: C.ink },
          multiple(cost.markupMultiple),
        ),
        el({ fontFamily: 'Mono', fontSize: 20, letterSpacing: '0.08em', color: C.ink2 }, 'ESTIMATED MARKUP'),
        pill(app.verdict, VERDICT_META[app.verdict].label, 24),
      ),
    ),
    footer('INFERENCE COST VS PRICE · ESTIMATE, DATED & SOURCED'),
  );
}

// --- render -------------------------------------------------------------------

async function render(node: Node, path: string): Promise<void> {
  const svg = await satori(node as Parameters<typeof satori>[0], { width: W, height: H, fonts: FONTS });
  writeFileSync(path, new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng());
}

// The home-screen icon iOS and some search results use, and the logo in the
// structured data. The favicon's mark — a receipt with a perforation — plus a
// multiplication sign, drawn as shapes: at this size a glyph adds nothing, and
// shapes rasterise identically everywhere with no font involved.
const ICON = 180;
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON}" height="${ICON}" viewBox="0 0 180 180">
  <defs>
    <radialGradient id="a" cx="15%" cy="10%" r="75%"><stop offset="0" stop-color="#6e50ff" stop-opacity=".55"/><stop offset="1" stop-color="#6e50ff" stop-opacity="0"/></radialGradient>
    <radialGradient id="b" cx="95%" cy="30%" r="60%"><stop offset="0" stop-color="#14a0aa" stop-opacity=".35"/><stop offset="1" stop-color="#14a0aa" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="180" height="180" fill="${C.void}"/>
  <rect width="180" height="180" fill="url(#a)"/>
  <rect width="180" height="180" fill="url(#b)"/>
  <rect x="38" y="30" width="104" height="120" rx="10" fill="rgba(255,255,255,0.05)" stroke="${C.ink}" stroke-width="7"/>
  <path d="M38 102h104" stroke="${C.ink}" stroke-width="4" stroke-dasharray="7 7"/>
  <path d="M64 56h52M64 74h32" stroke="${C.ink2}" stroke-width="7" stroke-linecap="round"/>
  <path d="M77 114l26 26M103 114l-26 26" stroke="${C.wrapper}" stroke-width="9" stroke-linecap="round"/>
</svg>`;

const entries = loadEntries();
const counts = { fair: 0, steep: 0, wrapper: 0 } as Record<Verdict, number>;
for (const e of entries) counts[e.app.verdict]++;

mkdirSync(OUT, { recursive: true });
await render(siteCard(counts, entries.length), join(OUT, 'site.png'));
for (const e of entries) await render(appCard(e), join(OUT, `${e.app.slug}.png`));
writeFileSync(join(process.cwd(), 'dist', 'apple-touch-icon.png'), new Resvg(iconSvg).render().asPng());

console.log(`og-images: ${entries.length + 1} preview cards and the touch icon written to dist/`);

/**
 * Post-build: renders the link-preview cards that X, LinkedIn, Slack, iMessage and
 * search engines show beside a shared URL.
 *
 *   dist/og/<slug>.png   one per product: name, markup multiple, verdict
 *
 * The site-wide card (public/og/site.png) and the icons are the brand's own
 * artwork and live in public/; these follow their look — flat near-black, a
 * faint grid, the verdict colours as the only saturated marks.
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

// Neutral near-black to match the banner; the verdict colours are the site's own.
// Cards are always dark: previews sit in feeds of every theme.
const C = {
  void: '#0b0b0c',
  ink: '#f4f4f5',
  ink2: '#9a9aa3',
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

// Matches the banner: flat near-black with a faint 100px grid.
const background = {
  backgroundColor: C.void,
  backgroundImage: [
    'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px)',
    'linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
  ].join(', '),
  backgroundSize: '100px 100px',
};

const wordmark = (size: number) =>
  el({ fontFamily: 'Inter', fontWeight: 800, fontSize: size, letterSpacing: '-0.01em', color: C.ink }, 'Is it just a wrapper?');

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

function appCard(e: ReturnType<typeof loadEntries>[number]): Node {
  const { app, cost } = e;
  const nameSize = app.name.length > 22 ? 64 : 80;
  return frame(
    wordmark(34),
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

const entries = loadEntries();

mkdirSync(OUT, { recursive: true });
for (const e of entries) await render(appCard(e), join(OUT, `${e.app.slug}.png`));

console.log(`og-images: ${entries.length} product preview cards written to dist/og/`);

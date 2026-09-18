/**
 * Public traffic and sponsor totals. Everything this returns is published on
 * /stats — there is no private analytics view, because there is no private
 * analytics.
 */

interface Env {
  STATS?: KVNamespace;
}

const DAYS = 30;

async function readNumbers(kv: KVNamespace, keys: string[]): Promise<Record<string, number>> {
  const values = await Promise.all(keys.map((k) => kv.get(k)));
  return Object.fromEntries(keys.map((k, i) => [k, Number(values[i] ?? 0)]));
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    // Short cache: these are published figures, not a live dashboard.
    'cache-control': 'public, max-age=300',
    'access-control-allow-origin': '*',
  };

  if (!env.STATS) {
    // Local dev and preview builds have no KV binding. Say so plainly rather
    // than inventing numbers.
    return new Response(JSON.stringify({ available: false, reason: 'no KV binding configured' }), { headers });
  }

  const today = new Date();
  const dayKeys = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    return `pv:day:${d.toISOString().slice(0, 10)}`;
  });

  const [totals, days, paths, sponsors] = await Promise.all([
    readNumbers(env.STATS, ['pv:total']),
    readNumbers(env.STATS, dayKeys),
    env.STATS.list({ prefix: 'pv:path:', limit: 200 }),
    env.STATS.list({ prefix: 'sponsor:', limit: 200 }),
  ]);

  const pathCounts = await readNumbers(
    env.STATS,
    paths.keys.map((k) => k.name),
  );
  const sponsorCounts = await readNumbers(
    env.STATS,
    sponsors.keys.map((k) => k.name),
  );

  const impressions = Object.entries(sponsorCounts)
    .filter(([k]) => k.startsWith('sponsor:imp:'))
    .reduce((sum, [, v]) => sum + v, 0);
  const clicks = Object.entries(sponsorCounts)
    .filter(([k]) => k.startsWith('sponsor:clk:'))
    .reduce((sum, [, v]) => sum + v, 0);

  return new Response(
    JSON.stringify({
      available: true,
      approximate: true,
      generatedAt: new Date().toISOString(),
      pageViewsAllTime: totals['pv:total'] ?? 0,
      pageViewsLast30Days: Object.values(days).reduce((a, b) => a + b, 0),
      byDay: Object.fromEntries(Object.entries(days).map(([k, v]) => [k.replace('pv:day:', ''), v])),
      topPages: Object.entries(pathCounts)
        .map(([k, v]) => [k.replace('pv:path:', ''), v] as const)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10),
      // Impressions are derived from views of the pages that carry the sponsor
      // rail, rather than counted with a client-side beacon. Slightly less
      // precise, and it costs the reader nothing to be measured.
      sponsorRailViews: (pathCounts['pv:path:/'] ?? 0) + (pathCounts['pv:path:/sponsor'] ?? 0),
      sponsorImpressions: impressions,
      sponsorClicks: clicks,
      sponsorClickRate: impressions > 0 ? clicks / impressions : null,
    }),
    { headers },
  );
};

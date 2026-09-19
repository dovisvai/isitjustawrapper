/**
 * Public traffic and sponsor totals. Everything this returns is published on
 * /stats.
 *
 * Traffic comes from Cloudflare's own zone analytics, read through its GraphQL
 * API. Cloudflare already records aggregate request counts for every site it
 * proxies; this endpoint publishes the daily totals and adds nothing to what is
 * collected — no cookies, no script, no beacon, no storage of our own.
 *
 * Sponsor clicks are the one thing we count ourselves, on the redirect in
 * go/[slot].ts, because Cloudflare cannot tell a sponsor click from any other
 * request. Clicks are rare, so a KV counter is fine for them in a way it is not
 * for page views (KV's free tier allows about 1,000 writes a day).
 */

interface Env {
  /** API token with Zone → Analytics → Read on this zone. Set as a secret. */
  CF_API_TOKEN?: string;
  /** The zone id shown on the domain's Overview page in the dashboard. */
  CF_ZONE_ID?: string;
  STATS?: KVNamespace;
}

interface DayGroup {
  dimensions: { date: string };
  sum: { pageViews: number };
  uniq: { uniques: number };
}

const DAYS = 30;

const QUERY = `query ($zone: String!, $since: Date!, $until: Date!) {
  viewer {
    zones(filter: { zoneTag: $zone }) {
      httpRequests1dGroups(
        limit: 31
        filter: { date_geq: $since, date_leq: $until }
        orderBy: [date_ASC]
      ) {
        dimensions { date }
        sum { pageViews }
        uniq { uniques }
      }
    }
  }
}`;

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

async function fetchTraffic(token: string, zone: string): Promise<DayGroup[]> {
  const until = new Date();
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - (DAYS - 1));

  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { zone, since: isoDate(since), until: isoDate(until) } }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    data?: { viewer?: { zones?: { httpRequests1dGroups?: DayGroup[] }[] } };
    errors?: { message: string }[] | null;
  };
  // Auth failures come back as HTTP 400 with the reason in `errors`, so read the
  // body before the status: "Authentication failed" beats "HTTP 400" on /stats.
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
  if (!res.ok) throw new Error(`analytics API returned HTTP ${res.status}`);
  return body.data?.viewer?.zones?.[0]?.httpRequests1dGroups ?? [];
}

async function sponsorClicks(kv: KVNamespace | undefined): Promise<number | null> {
  if (!kv) return null;
  const { keys } = await kv.list({ prefix: 'sponsor:clk:', limit: 100 });
  const values = await Promise.all(keys.map((k) => kv.get(k.name)));
  return values.reduce((sum, v) => sum + Number(v ?? 0), 0);
}

const json = (data: unknown, maxAge: number) =>
  new Response(JSON.stringify(data), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${maxAge}`,
      'access-control-allow-origin': '*',
    },
  });

export const onRequestGet: PagesFunction<Env> = async ({ env, request, waitUntil }) => {
  if (!env.CF_API_TOKEN || !env.CF_ZONE_ID) {
    // Local dev and preview builds have no credentials. Say so plainly rather
    // than inventing numbers.
    return json({ available: false, reason: 'analytics not configured' }, 60);
  }

  // Every visit to /stats would otherwise be an API call, and the analytics API
  // is rate-limited. Daily totals do not move fast; serve them from the edge
  // cache for ten minutes.
  const cache = caches.default;
  const cacheKey = new Request(new URL('/api/stats', request.url).toString());
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let days: DayGroup[];
  let clicks: number | null;
  try {
    [days, clicks] = await Promise.all([fetchTraffic(env.CF_API_TOKEN, env.CF_ZONE_ID), sponsorClicks(env.STATS)]);
  } catch (err) {
    return json({ available: false, reason: (err as Error).message }, 60);
  }

  const last = (n: number) => days.slice(-n);
  const live = days.filter((g) => g.sum.pageViews > 0);
  const sumViews = (d: DayGroup[]) => d.reduce((s, g) => s + g.sum.pageViews, 0);

  const response = json(
    {
      available: true,
      source: 'cloudflare',
      generatedAt: new Date().toISOString(),
      pageViewsLast30Days: sumViews(days),
      pageViewsLast7Days: sumViews(last(7)),
      // Cloudflare counts unique IPs per day. Summing days would count a returning
      // reader thirty times, so publish the daily average instead — over days that
      // had traffic, so the weeks before launch do not drag it towards zero.
      avgDailyVisitors: live.length ? Math.round(live.reduce((s, g) => s + g.uniq.uniques, 0) / live.length) : 0,
      sponsorClicks: clicks,
      byDay: Object.fromEntries(days.map((g) => [g.dimensions.date, g.sum.pageViews])),
    },
    600,
  );
  waitUntil(cache.put(cacheKey, response.clone()));
  return response;
};

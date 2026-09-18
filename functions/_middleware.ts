/**
 * Cookieless, first-party page counting.
 *
 * This is the piece that resolves the contradiction in the original brief: the
 * site is statically generated with no database and no server, but /stats is
 * supposed to publish real traffic numbers and sponsor clicks. Cloudflare Pages
 * Functions give exactly enough server to count, without making the site dynamic.
 *
 * What is stored: a counter per day and a counter per page path. That is all.
 * No cookies, no identifiers, no IP addresses, no user agents, no third parties.
 * Nothing here can be tied back to a person, which is the only kind of analytics
 * a site that lectures other people about honesty has any business running.
 *
 * On KV as a counter: read-modify-write races under concurrent requests and KV
 * caps sustained writes at roughly one per second per key, so these totals are
 * approximate and the /stats page says so. If this site ever gets enough traffic
 * for that to matter, move the counters to a Durable Object or Analytics Engine —
 * the read side in api/stats.ts is the only other thing that would change.
 */

interface Env {
  STATS?: KVNamespace;
}

/** Bounded key cardinality: an open-ended path space would let anyone fill the namespace. */
function countableKey(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return '/';
  if (/^\/app\/[a-z0-9-]{1,60}$/.test(path)) return path;
  if (['/methodology', '/calculator', '/stats', '/corrections', '/sponsor'].includes(path)) return path;
  return null;
}

async function bump(kv: KVNamespace, key: string): Promise<void> {
  const current = Number((await kv.get(key)) ?? 0);
  await kv.put(key, String(current + 1));
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const response = await context.next();

  const { request, env, waitUntil } = context;
  const url = new URL(request.url);

  const isPageView =
    request.method === 'GET' &&
    response.headers.get('content-type')?.includes('text/html') &&
    !request.headers.get('sec-fetch-dest')?.includes('iframe');

  if (isPageView && env.STATS) {
    const key = countableKey(url.pathname);
    if (key) {
      const today = new Date().toISOString().slice(0, 10);
      // Counting must never delay or break the response.
      waitUntil(
        Promise.all([
          bump(env.STATS, 'pv:total'),
          bump(env.STATS, `pv:day:${today}`),
          bump(env.STATS, `pv:path:${key}`),
        ]).catch(() => {}),
      );
    }
  }

  return response;
};

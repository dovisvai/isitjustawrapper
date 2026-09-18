/**
 * Counted sponsor outbound link.
 *
 * Clicks are counted here, on the server, before redirecting — no client-side
 * tracker, no beacon, nothing for an ad blocker to strip, and nothing that works
 * differently depending on whether the reader has JavaScript. The sponsor's
 * destination is read from the committed sponsors.json, so a slot can only ever
 * point where the repository says it points.
 */

import sponsors from '../../data/sponsors.json';

interface Env {
  STATS?: KVNamespace;
  SITE_ORIGIN?: string;
}

interface Sponsor {
  slot: number;
  status: string;
  name?: string;
  url?: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env, request, waitUntil }) => {
  const slot = Number(params.slot);
  const sponsor = (sponsors as Sponsor[]).find((s) => s.slot === slot && s.status === 'filled');

  if (!sponsor?.url) {
    return new Response('Unknown sponsor slot', { status: 404 });
  }

  // UTM tags are added here rather than stored, so they stay consistent across
  // every slot and cannot drift per entry.
  const destination = new URL(sponsor.url);
  const origin = env.SITE_ORIGIN ?? new URL(request.url).origin;
  destination.searchParams.set('utm_source', new URL(origin).hostname);
  destination.searchParams.set('utm_medium', 'sponsor');
  destination.searchParams.set('utm_campaign', `slot-${String(slot).padStart(2, '0')}`);

  if (env.STATS) {
    const key = `sponsor:clk:${slot}`;
    waitUntil(
      env.STATS.get(key)
        .then((v) => env.STATS!.put(key, String(Number(v ?? 0) + 1)))
        .catch(() => {}),
    );
  }

  return Response.redirect(destination.toString(), 302);
};

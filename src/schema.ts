import { z } from 'zod';

/**
 * The single source of truth for every controlled vocabulary on the site.
 * Contributors may not invent new values for any of these — that is the whole
 * point of having them. Adding one is a deliberate PR that changes this file.
 */

export const VERDICTS = ['fair', 'steep', 'wrapper'] as const;
export type Verdict = (typeof VERDICTS)[number];

/**
 * Categories are a fixed enum for the same reason value-add tags are: free-text
 * categories fragment across contributor spellings and quietly break filtering.
 */
export const CATEGORIES = [
  'assistant',
  'writing',
  'coding',
  'search',
  'meetings',
  'healthcare',
  'legal',
  'audio',
  'image',
  'video',
  'support',
  'sales',
  'productivity',
  'research',
  'education',
] as const;

export const VALUE_ADD_TAGS = [
  'proprietary-model',
  'eval-harness',
  'data-pipeline',
  'integrations',
  'compliance-regulatory',
  'scale-infra',
  'human-in-loop',
  'ux-craft',
  'orchestration',
  'distribution',
] as const;
export type ValueAddTag = (typeof VALUE_ADD_TAGS)[number];

/** Ten was the brief; twenty is what we sell. Referenced everywhere, defined once. */
export const SPONSOR_SLOT_COUNT = 20;

/**
 * The one published address. Corrections, vendor disputes, sponsorship and conduct
 * reports all arrive here — a reference that is hard to reach is a reference nobody
 * corrects, so it is deliberately a plain mailto rather than an obfuscated one or a
 * form. That costs some spam; being reachable in one click is worth more.
 */
export const CONTACT_EMAIL = 'office@isitjustawrapper.com';

/** X (Twitter) ads website tag. Loaded only after cookie consent — see Consent.astro. */
export const X_PIXEL_ID = 'rg1j3';

/** Where the data, the code and the full history of every figure live. */
export const REPO_URL = 'https://github.com/dovisvai/isitjustawrapper';

/** Entries older than this are surfaced as stale on the site and by `npm run validate`. */
export const STALE_AFTER_DAYS = 90;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date, e.g. 2026-08-11')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'must be a real calendar date');

const httpsUrl = z.string().url().startsWith('https://', 'sources must be https');

/**
 * The meter: what a seat actually includes, in API-dollar terms. The sticker price
 * rarely moves; the allowance behind it does. Every field is nullable because the
 * honest answer for most products is "not yet measured", and a guessed number here
 * would be the one figure on the site with no source behind it. A value needs both
 * a basis and a source.
 */
export const MeterSchema = z
  .object({
    apiValuePerSeat: z.number().positive().nullable(),
    basis: z.string().min(10).max(200).nullable(),
    lastChanged: isoDate.nullable(),
    source: httpsUrl.nullable(),
    /** True when only part of the allowance has a published rate, so the value understates it. */
    isFloor: z.boolean().optional(),
  })
  .strict()
  .refine((m) => m.apiValuePerSeat === null || (m.basis !== null && m.source !== null), {
    message: 'a meter value needs a basis and a source',
    path: ['apiValuePerSeat'],
  });

export type Meter = z.infer<typeof MeterSchema>;

export const SourceSchema = z
  .object({
    /** `pricing` is special: every entry needs at least one, and the watcher polls it. */
    kind: z.enum(['pricing', 'rate-card', 'docs', 'other']),
    label: z.string().min(3).max(120),
    url: httpsUrl,
  })
  .strict();

// ---------------------------------------------------------------------------
// Rate card
// ---------------------------------------------------------------------------

/**
 * A priced unit. Cost is `count / per * usdPer`, which covers per-million-token
 * text pricing, per-minute audio, per-image, and per-hour GPU rental without
 * needing a different shape for each.
 */
export const RateUnitSchema = z
  .object({
    usdPer: z.number().nonnegative(),
    per: z.number().positive(),
    display: z.string().min(1).max(40),
    /** Used when `per` is 1, so the rate reads "$0.60 per GPU-hour" rather than "per GPU-hours". */
    displaySingular: z.string().min(1).max(40).optional(),
  })
  .strict();

export const RateSchema = z
  .object({
    label: z.string().min(3).max(120),
    note: z.string().max(400).optional(),
    units: z.record(RateUnitSchema).refine((u) => Object.keys(u).length > 0, 'needs at least one unit'),
    source: SourceSchema,
    checkedOn: isoDate,
  })
  .strict();

export const RateCardSchema = z
  .object({
    updatedOn: isoDate,
    note: z.string(),
    models: z.record(RateSchema),
  })
  .strict();

export type RateCard = z.infer<typeof RateCardSchema>;

// ---------------------------------------------------------------------------
// Apps
// ---------------------------------------------------------------------------

export const UsageComponentSchema = z
  .object({
    modelId: z.string().min(1),
    /** Unit counts keyed to match the referenced rate's `units`. Cross-checked in validate.ts. */
    units: z.record(z.number().nonnegative()),
    note: z.string().max(200).optional(),
  })
  .strict();

export const UsageExtraSchema = z
  .object({
    label: z.string().min(3).max(120),
    monthlyUsd: z.number().nonnegative(),
    note: z.string().max(300).optional(),
  })
  .strict();

/**
 * Three-state provenance. Nothing reaches production on my say-so:
 *  - unverified    nobody has confirmed this price against the vendor's page
 *  - auto-observed the watcher found this price on the live pricing page, dated
 *  - verified      a named human confirmed it, dated
 * `npm run check:publish` fails on anything that is not `verified`.
 */
export const VerificationSchema = z
  .object({
    status: z.enum(['unverified', 'auto-observed', 'verified']),
    checkedBy: z.string().min(2).max(80).optional(),
    checkedOn: isoDate.optional(),
    note: z.string().max(400).optional(),
  })
  .strict()
  .refine(
    (v) => v.status === 'unverified' || (!!v.checkedBy && !!v.checkedOn),
    'verified and auto-observed entries need both checkedBy and checkedOn',
  );

export const AppSchema = z
  .object({
    slug: z
      .string()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase kebab-case only')
      .max(60),
    name: z.string().min(2).max(80),
    category: z.enum(CATEGORIES),
    url: httpsUrl,
    vendor: z.string().min(2).max(80),

    pricing: z
      .object({
        tier: z.string().min(1).max(60),
        monthlyUsd: z.number().nonnegative(),
        billingNote: z.string().max(400),
        checkedOn: isoDate,
      })
      .strict(),

    usageAssumption: z
      .object({
        description: z.string().min(20).max(500),
        components: z.array(UsageComponentSchema).min(1),
        extras: z.array(UsageExtraSchema).default([]),
      })
      .strict(),

    verdict: z.enum(VERDICTS),
    /** One quotable sentence. States what the product does and what it costs — no adjectives about the vendor. */
    verdictSummary: z.string().min(20).max(300),
    verdictReasoning: z.string().min(40).max(2000),

    valueAddTags: z.array(z.enum(VALUE_ADD_TAGS)).min(1).max(3),
    valueAddNotes: z.string().min(20).max(1200),
    whatYouLose: z.string().min(20).max(1200),
    diyPath: z.string().min(20).max(1200),

    sources: z.array(SourceSchema).min(2),

    /**
     * Some vendors render prices client-side, often behind a monthly/yearly toggle, so
     * the figure never appears in the served HTML. The watcher cannot confirm those and
     * would otherwise report `price-missing` on every run, demoting a correctly verified
     * entry every week. A monitor that cries wolf gets ignored, so an entry may declare
     * the check impossible — with a reason. It still gets change detection by content
     * hash; only the price-string match is skipped.
     */
    priceCheck: z
      .object({
        automatable: z.literal(false),
        reason: z.string().min(20).max(400),
      })
      .strict()
      .optional(),

    meter: MeterSchema.optional(),

    /**
     * An editorial notice shown at the top of the entry, for a change the data
     * cannot yet express (a plan discontinued, a verdict under review). Sourced and
     * dated like everything else.
     */
    notice: z
      .object({
        title: z.string().min(3).max(60),
        body: z.string().min(20).max(500),
        source: httpsUrl,
        verifiedOn: isoDate,
      })
      .strict()
      .optional(),

    verification: VerificationSchema,
    lastReviewed: isoDate,
  })
  .strict()
  /**
   * Fix #3 from the spec review: the markup multiple and the API cost estimate are
   * DERIVED at build time from the rate card. Storing them invites the stored value
   * and the arithmetic to drift apart across contributor PRs. Reject them loudly
   * rather than silently ignoring them.
   */
  .superRefine((app, ctx) => {
    for (const derived of ['markupMultiple', 'estimatedApiCostUsd'] as const) {
      if (derived in app) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [derived],
          message: `${derived} is computed at build time from data/rates.json — remove it from the entry.`,
        });
      }
    }
    if (!app.sources.some((s) => s.kind === 'pricing')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sources'],
        message: 'at least one source must have kind "pricing" — it is what the price watcher polls',
      });
    }
  });

export type App = z.infer<typeof AppSchema>;

// ---------------------------------------------------------------------------
// Sponsors, corrections, price watch
// ---------------------------------------------------------------------------

export const SponsorSchema = z
  .object({
    slot: z.number().int().min(1).max(SPONSOR_SLOT_COUNT),
    status: z.enum(['available', 'filled']),
    name: z.string().min(2).max(60).optional(),
    pitch: z.string().max(90).optional(),
    url: httpsUrl.optional(),
    faviconUrl: z.string().max(400).optional(),
    startedOn: isoDate.optional(),
  })
  .strict()
  .refine(
    (s) => s.status === 'available' || (!!s.name && !!s.pitch && !!s.url),
    'filled slots need name, pitch and url',
  );

export const SponsorsSchema = z.array(SponsorSchema).max(SPONSOR_SLOT_COUNT);

export const CorrectionSchema = z
  .object({
    date: isoDate,
    slug: z.string().optional(),
    raisedBy: z.enum(['vendor', 'reader', 'maintainer', 'price-watch']),
    summary: z.string().min(10).max(600),
    change: z.string().min(10).max(600),
    prUrl: z.string().url().optional(),
  })
  .strict();

export const CorrectionsSchema = z.array(CorrectionSchema);

/**
 * Meter changes: a vendor retuning what a seat includes. `tool` is the plan as the
 * vendor names it, because a change can land on a plan this directory does not
 * list; `slug` links it to an entry when there is one. Every entry needs a source.
 */
export const MeterChangeSchema = z
  .object({
    date: isoDate,
    /** The source dates the change only roughly; shown as "around <date>". */
    approximate: z.boolean().optional(),
    tool: z.string().min(2).max(80),
    slug: z.string().optional(),
    summary: z.string().min(10).max(400),
    before: z.string().max(120).nullable(),
    after: z.string().max(120).nullable(),
    source: httpsUrl,
  })
  .strict();

export const MeterChangelogSchema = z.array(MeterChangeSchema);

/**
 * Plans measured independently by someone else, kept apart from data/apps because
 * they are not directory entries: no verdict, no usage assumption, no price check.
 * A derived row (measured: false) is extrapolated rather than run, and must say how
 * in its note so the table can show it.
 */
export const MeterMeasurementSchema = z
  .object({
    plan: z.string().min(2).max(80),
    vendor: z.string().min(2).max(60),
    pricePerMonth: z.number().positive(),
    multiplier: z.number().positive(),
    multiplierRange: z.tuple([z.number().positive(), z.number().positive()]).optional(),
    apiValuePerMonth: z.number().positive(),
    measured: z.boolean(),
    measuredOn: isoDate,
    basis: z.string().min(10).max(200),
    source: httpsUrl,
    note: z.string().min(5).max(200).optional(),
  })
  .strict()
  .superRefine((m, ctx) => {
    // Stored for readability, but it must agree with the arithmetic (to the dollar,
    // since source figures are rounded).
    if (Math.abs(m.apiValuePerMonth - m.multiplier * m.pricePerMonth) > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['apiValuePerMonth'],
        message: `must equal multiplier x pricePerMonth (${m.multiplier * m.pricePerMonth})`,
      });
    }
    if (m.multiplierRange) {
      const [lo, hi] = m.multiplierRange;
      if (!(lo <= m.multiplier && m.multiplier <= hi)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['multiplierRange'], message: 'range must contain the multiplier' });
      }
    }
    if (!m.measured && !m.note) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: 'a derived row needs a note saying how it was derived' });
    }
  });

export const MeterMeasurementsSchema = z.array(MeterMeasurementSchema);
export type MeterMeasurement = z.infer<typeof MeterMeasurementSchema>;
export type MeterChange = z.infer<typeof MeterChangeSchema>;

export const WatchResultSchema = z
  .object({
    slug: z.string(),
    url: z.string(),
    status: z.enum(['ok', 'changed', 'price-missing', 'unreachable', 'new']),
    checkedOn: z.string(),
    contentHash: z.string().optional(),
    recordedPriceSeen: z.boolean().optional(),
    priceCandidates: z.array(z.string()).default([]),
    detail: z.string().optional(),
  })
  .strict();

export const WatchReportSchema = z
  .object({
    generatedOn: z.string(),
    results: z.array(WatchResultSchema),
  })
  .strict();

export type WatchReport = z.infer<typeof WatchReportSchema>;
export type WatchResult = z.infer<typeof WatchResultSchema>;

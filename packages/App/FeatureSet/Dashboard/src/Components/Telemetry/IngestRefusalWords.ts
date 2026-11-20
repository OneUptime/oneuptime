import OneUptimeDate from "Common/Types/Date";
import { writeReaderMoment } from "Common/UI/Utils/ReaderMoments";
import {
  TelemetryIngestRefusalReason,
  UNNAMED_TELEMETRY_INGEST_SURFACE,
} from "Common/Types/Telemetry/TelemetryIngestRefusal";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * What a refusal of telemetry says, wherever it is shown (issue #6378): the
 * RUM setup check and its empty charts, and the refused key's own page.
 * React-free, so a node test reads every sentence in any locale.
 *
 * Each reason is a whole sentence of its own, the key's name a value of it,
 * set apart in a right-to-left sentence (a key's name is usually Latin).
 */

export const REFUSAL_REASON_WORDS: Readonly<
  Record<TelemetryIngestRefusalReason, string>
> = {
  [TelemetryIngestRefusalReason.KeyDisabled]: translationKey(
    'The key "{{key}}" is turned off, so everything sent with it is refused.',
  ),
  [TelemetryIngestRefusalReason.KeyExpired]: translationKey(
    'The key "{{key}}" has expired, so everything sent with it is refused.',
  ),
  [TelemetryIngestRefusalReason.OriginNotAllowed]: translationKey(
    "The key \"{{key}}\" doesn't allow the origin the requests came from. Add your site's origin to the key.",
  ),
  [TelemetryIngestRefusalReason.BrowserKeyNotAllowedHere]: translationKey(
    '"{{key}}" is a Browser key, and this endpoint takes only Server keys.',
  ),
  [TelemetryIngestRefusalReason.MobileKeyNotAllowedHere]: translationKey(
    '"{{key}}" is a Mobile key, which sends only a mobile app\'s traces, logs and metrics, never from a web page.',
  ),
  [TelemetryIngestRefusalReason.PinnedKeyNotAllowedHere]: translationKey(
    '"{{key}}" is pinned to one service, and this endpoint takes only unpinned keys.',
  ),
  [TelemetryIngestRefusalReason.KeyRequestsPerMinute]: translationKey(
    'The key "{{key}}" went over its limit of requests per minute.',
  ),
  [TelemetryIngestRefusalReason.KeyDailyBudget]: translationKey(
    'The key "{{key}}" used up its daily ingestion budget.',
  ),
  [TelemetryIngestRefusalReason.KeyIngestionRate]: translationKey(
    'The key "{{key}}" went over its ingestion rate limit.',
  ),
  [TelemetryIngestRefusalReason.ProjectDailyBudget]: translationKey(
    "This project used up its daily ingestion budget.",
  ),
  [TelemetryIngestRefusalReason.ProjectIngestionRate]: translationKey(
    "This project went over its ingestion rate limit.",
  ),
  [TelemetryIngestRefusalReason.PaymentRequired]: translationKey(
    "This project has no payment method, so its telemetry is refused.",
  ),
  [TelemetryIngestRefusalReason.ProjectBlocked]: translationKey(
    "An administrator blocked this project, so its telemetry is refused.",
  ),
};

/*
 * The same reasons in a few words, heading each line of the key's own page
 * (IngestionKeyRefusalsCard): the page is the key's, so its name would only
 * repeat, and a refusal of days ago is told as what it was then - "Key
 * turned off" - not as what the key is now.
 */
export const REFUSAL_REASON_LABELS: Readonly<
  Record<TelemetryIngestRefusalReason, string>
> = {
  [TelemetryIngestRefusalReason.KeyDisabled]: translationKey("Key turned off"),
  [TelemetryIngestRefusalReason.KeyExpired]: translationKey("Key expired"),
  [TelemetryIngestRefusalReason.OriginNotAllowed]: translationKey(
    "Origin not allowed by the key",
  ),
  [TelemetryIngestRefusalReason.BrowserKeyNotAllowedHere]: translationKey(
    "Endpoint takes only Server keys",
  ),
  [TelemetryIngestRefusalReason.MobileKeyNotAllowedHere]: translationKey(
    "Not a mobile app's traces, logs or metrics",
  ),
  [TelemetryIngestRefusalReason.PinnedKeyNotAllowedHere]: translationKey(
    "Endpoint takes only unpinned keys",
  ),
  [TelemetryIngestRefusalReason.KeyRequestsPerMinute]: translationKey(
    "Over the key's limit of requests per minute",
  ),
  [TelemetryIngestRefusalReason.KeyDailyBudget]: translationKey(
    "Key's daily ingestion budget used up",
  ),
  [TelemetryIngestRefusalReason.KeyIngestionRate]: translationKey(
    "Over the key's ingestion rate limit",
  ),
  [TelemetryIngestRefusalReason.ProjectDailyBudget]: translationKey(
    "Project's daily ingestion budget used up",
  ),
  [TelemetryIngestRefusalReason.ProjectIngestionRate]: translationKey(
    "Over the project's ingestion rate limit",
  ),
  [TelemetryIngestRefusalReason.PaymentRequired]: translationKey(
    "No payment method on the project",
  ),
  [TelemetryIngestRefusalReason.ProjectBlocked]: translationKey(
    "Project blocked by an administrator",
  ),
};

// What puts a refusal right, as a button names it.
export const PICK_ANOTHER_KEY: string = translationKey("Pick another key");
export const OPEN_THE_KEY: string = translationKey("Open the key");
export const SEE_BUDGETS: string = translationKey("See budgets");
export const ADD_A_PAYMENT_METHOD: string = translationKey(
  "Add a payment method",
);

/*
 * Where a refusal is put right:
 *
 *   pick-key  - the key is off or expired: send with another (the setup
 *               guide in a dialog, its first step the key);
 *   open-key  - the key's own settings: its origins, its limit, its budget;
 *   budgets   - the project's budgets (Settings > Usage);
 *   billing   - a payment method (Settings > Billing);
 *   null      - nothing here puts it right (a blocked project; a key on an
 *               endpoint that does not take its kind). The key's page still
 *               says the fix in words (KEY_PAGE_REFUSAL_FIX_WORDS).
 */
export type IngestRefusalFix = "pick-key" | "open-key" | "budgets" | "billing";

export const INGEST_REFUSAL_FIXES: Readonly<
  Record<TelemetryIngestRefusalReason, IngestRefusalFix | null>
> = {
  [TelemetryIngestRefusalReason.KeyDisabled]: "pick-key",
  [TelemetryIngestRefusalReason.KeyExpired]: "pick-key",
  [TelemetryIngestRefusalReason.OriginNotAllowed]: "open-key",
  [TelemetryIngestRefusalReason.BrowserKeyNotAllowedHere]: null,
  [TelemetryIngestRefusalReason.MobileKeyNotAllowedHere]: null,
  [TelemetryIngestRefusalReason.PinnedKeyNotAllowedHere]: null,
  [TelemetryIngestRefusalReason.KeyRequestsPerMinute]: "open-key",
  [TelemetryIngestRefusalReason.KeyDailyBudget]: "open-key",
  [TelemetryIngestRefusalReason.KeyIngestionRate]: "open-key",
  [TelemetryIngestRefusalReason.ProjectDailyBudget]: "budgets",
  [TelemetryIngestRefusalReason.ProjectIngestionRate]: "budgets",
  [TelemetryIngestRefusalReason.PaymentRequired]: "billing",
  [TelemetryIngestRefusalReason.ProjectBlocked]: null,
};

export const INGEST_REFUSAL_FIX_LABELS: Readonly<
  Record<IngestRefusalFix, string>
> = {
  "pick-key": PICK_ANOTHER_KEY,
  "open-key": OPEN_THE_KEY,
  budgets: SEE_BUDGETS,
  billing: ADD_A_PAYMENT_METHOD,
};

/*
 * What puts each refusal right, in words, under its line on the key's own
 * page (IngestionKeyRefusalsCard, #6458). Every reason has one: the card
 * used to link only the fixes that live on another page (budgets,
 * billing), so an origin refusal no longer said to add the origin, and a
 * reason with nothing to link showed no fix at all. The key's own settings
 * are on that page - its details above the card, its budgets below.
 */
export const KEY_PAGE_REFUSAL_FIX_WORDS: Readonly<
  Record<TelemetryIngestRefusalReason, string>
> = {
  [TelemetryIngestRefusalReason.KeyDisabled]: translationKey(
    "Turn this key back on in its details above, or send with another key.",
  ),
  [TelemetryIngestRefusalReason.KeyExpired]: translationKey(
    "Set a later expiry date in this key's details above, or send with another key.",
  ),
  [TelemetryIngestRefusalReason.OriginNotAllowed]: translationKey(
    "Add the origin the requests came from to this key's Allowed Origins above, with its scheme and any port.",
  ),
  [TelemetryIngestRefusalReason.BrowserKeyNotAllowedHere]: translationKey(
    "Send to this endpoint with a Server key: a Browser key is only for a web page's telemetry.",
  ),
  [TelemetryIngestRefusalReason.MobileKeyNotAllowedHere]: translationKey(
    "Use a Browser key in a web page and a Server key everywhere else: a Mobile key is only for its app's traces, logs and metrics, sent over HTTP.",
  ),
  [TelemetryIngestRefusalReason.PinnedKeyNotAllowedHere]: translationKey(
    "Register the agent with a Server key that is not pinned to a service.",
  ),
  [TelemetryIngestRefusalReason.KeyRequestsPerMinute]: translationKey(
    "Raise this key's Requests Per Minute Limit above, or send less often.",
  ),
  [TelemetryIngestRefusalReason.KeyDailyBudget]: translationKey(
    "Raise this key's daily budgets under Ingestion Budgets below, or wait for the next budget day.",
  ),
  [TelemetryIngestRefusalReason.KeyIngestionRate]: translationKey(
    "Raise this key's rate limits under Ingestion Budgets below, or send more slowly.",
  ),
  [TelemetryIngestRefusalReason.ProjectDailyBudget]: translationKey(
    "Raise the project's daily ingestion budget, or wait for the next budget day.",
  ),
  [TelemetryIngestRefusalReason.ProjectIngestionRate]: translationKey(
    "Raise the project's ingestion rate limit, or send more slowly.",
  ),
  [TelemetryIngestRefusalReason.PaymentRequired]: translationKey(
    "Add a payment method to the project, and its telemetry is accepted again.",
  ),
  [TelemetryIngestRefusalReason.ProjectBlocked]: translationKey(
    "Ask an administrator of this OneUptime server to unblock the project.",
  ),
};

/*
 * How many were refused, and over what span. A single refusal has no span,
 * so it is a sentence of its own: the plural's "one" form also serves 21 in
 * Russian and 0 in French, and must keep the span.
 */
export const ONE_REQUEST_REFUSED: string = translationKey(
  "One request refused {{time}}.",
);
export const REFUSED_COUNT_WORDS: PluralTemplate = {
  one: "{{count}} request refused since {{date}}, the latest {{time}}.",
  other: "{{count}} requests refused since {{date}}, the latest {{time}}.",
};

// Where it was refused: the ingest endpoint, as the key's page names it.
export const INGEST_SURFACE_LABELS: Readonly<Record<string, string>> = {
  [TelemetryIngestSurface.OtelTraces]: translationKey("Traces"),
  [TelemetryIngestSurface.OtelLogs]: translationKey("Logs"),
  [TelemetryIngestSurface.OtelMetrics]: translationKey("Metrics"),
  [TelemetryIngestSurface.OtelProfiles]: translationKey("Profiles"),
  [TelemetryIngestSurface.SessionReplay]: translationKey("Session Replay"),
  [TelemetryIngestSurface.SourceMap]: translationKey("Source Maps"),
  [TelemetryIngestSurface.Dsym]: translationKey("dSYMs"),
  [TelemetryIngestSurface.Syslog]: translationKey("Syslog"),
  [TelemetryIngestSurface.Fluent]: translationKey("Fluentd / Fluent Bit"),
  [TelemetryIngestSurface.VercelLogDrain]: translationKey("Vercel log drain"),
  [TelemetryIngestSurface.Pyroscope]: translationKey("Pyroscope profiles"),
  [TelemetryIngestSurface.KubernetesCost]: translationKey("Kubernetes cost"),
  [TelemetryIngestSurface.ChangeEvents]: translationKey("Change Events"),
  [TelemetryIngestSurface.OpenLineage]: translationKey("OpenLineage events"),
  [TelemetryIngestSurface.DbtArtifacts]: translationKey("dbt artifacts"),
  [TelemetryIngestSurface.SyncWebhooks]: translationKey(
    "Fivetran and Airbyte webhooks",
  ),
  [TelemetryIngestSurface.SecurityEvents]: translationKey("Security Events"),
  [TelemetryIngestSurface.PrometheusRemoteWrite]: translationKey(
    "Prometheus remote write",
  ),
  [TelemetryIngestSurface.Loki]: translationKey("Loki push API"),
  [TelemetryIngestSurface.SplunkHec]: translationKey(
    "Splunk HTTP Event Collector",
  ),
  [TelemetryIngestSurface.Datadog]: translationKey("Datadog Agent and API"),
  [TelemetryIngestSurface.Sentry]: translationKey("Sentry SDKs"),
  [TelemetryIngestSurface.Grpc]: translationKey("OTLP over gRPC"),
  [TelemetryIngestSurface.Mqtt]: translationKey("MQTT"),
  [TelemetryIngestSurface.KubernetesAgentRunner]: translationKey(
    "Kubernetes agent registration",
  ),
  [TelemetryIngestSurface.KubernetesAiAgent]: translationKey(
    "Kubernetes AI agent registration",
  ),
  [TelemetryIngestSurface.ResourceAiAgent]: translationKey(
    "AI agent registration",
  ),
  [TelemetryIngestSurface.HostCollectorManagement]: translationKey(
    "Host collector management",
  ),
  [TelemetryIngestSurface.AndroidAgentLogSessions]: translationKey(
    "Android agent log sessions",
  ),
  [UNNAMED_TELEMETRY_INGEST_SURFACE]: translationKey("Other endpoints"),
};

function translate(translator: Translator, text: string): string {
  return translator.translateText(text) || text;
}

/*
 * Settings > Ingestion Keys > a key > Refused Telemetry
 * (IngestionKeyRefusalsCard): the card's own words.
 */
export const REFUSALS_LOOKBACK_DAYS: number = 30;

/*
 * A line whose latest refusal is older than this is history - the key was
 * put right, or nothing sends with it - and is drawn without the alarm.
 * The RUM setup check's "arriving" window, a day.
 */
export const REFUSALS_RECENT_MS: number = 24 * 60 * 60 * 1000;

export const REFUSALS_TITLE: string = translationKey("Refused Telemetry");
export const REFUSALS_DESCRIPTION: string = translationKey(
  "Telemetry sent with this key that OneUptime refused in the past 30 days, and why. A refusal shows here within a few minutes.",
);
export const REFUSALS_NONE: string = translationKey(
  "Nothing sent with this key was refused in the past 30 days.",
);
export const REFUSALS_FAILED: string = translationKey(
  "Couldn't load the refused telemetry. Try again in a moment.",
);
export const REFUSALS_LOADING: string = translationKey("Checking…");
export const REFUSALS_CHECK_AGAIN: string = translationKey("Check again");

// What puts a refusal right, in words, as the key's own page says it.
export function getKeyPageRefusalFixText(
  reason: TelemetryIngestRefusalReason,
  translator: Translator,
): string {
  return translate(translator, KEY_PAGE_REFUSAL_FIX_WORDS[reason]);
}

// Whether a line's latest refusal is recent enough to draw as a problem.
export function isIngestRefusalRecent(
  refusal: { lastRefusedAt: Date },
  now: Date,
): boolean {
  return now.getTime() - refusal.lastRefusedAt.getTime() <= REFUSALS_RECENT_MS;
}

// The reason a refusal was made, as a whole sentence in the reader's language.
export function getIngestRefusalReasonText(
  refusal: {
    reason: TelemetryIngestRefusalReason;
    keyName: string | null;
    keyId: string;
  },
  translator: Translator,
): string {
  return translator.translateTemplate(
    REFUSAL_REASON_WORDS[refusal.reason],
    { key: refusal.keyName || refusal.keyId },
    { setsValuesApart: true },
  );
}

// The reason in a few words, as the key's own page heads its line.
export function getIngestRefusalReasonLabel(
  reason: TelemetryIngestRefusalReason,
  translator: Translator,
): string {
  return translate(translator, REFUSAL_REASON_LABELS[reason]);
}

// Where a refusal was made, as the key's page names it.
export function getIngestSurfaceLabel(
  surface: string,
  translator: Translator,
): string {
  return translate(
    translator,
    INGEST_SURFACE_LABELS[surface] ||
      INGEST_SURFACE_LABELS[UNNAMED_TELEMETRY_INGEST_SURFACE]!,
  );
}

/*
 * "{{count}} requests refused since {{date}}, the latest {{time}}."
 *
 * The "since" is one shape on every line (#6458): a moment in a sentence,
 * the day and the time on the reader's clock and in their zone
 * (writeReaderMoment). It was the day alone two days on and the day, the
 * time and the zone before that, so a card read "Nov 04, 2026" on one line
 * and "Nov 08 2026, 12:32 CET" on the next.
 */
export function getIngestRefusalCountText(
  refusal: { count: number; firstRefusedAt: Date; lastRefusedAt: Date },
  translator: Translator,
  now: Date,
): string {
  if (refusal.count === 1) {
    return translator.translateTemplate(ONE_REQUEST_REFUSED, {
      time: OneUptimeDate.fromNow(refusal.lastRefusedAt, now),
    });
  }

  return translator.translatePlural(REFUSED_COUNT_WORDS, refusal.count, {
    date: writeReaderMoment(refusal.firstRefusedAt),
    time: OneUptimeDate.fromNow(refusal.lastRefusedAt, now),
  });
}

import OneUptimeDate from "Common/Types/Date";
import { TelemetryIngestRefusalReason } from "Common/Types/Telemetry/TelemetryIngestRefusal";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import { UNNAMED_TELEMETRY_INGEST_SURFACE } from "Common/Types/Telemetry/TelemetryIngestRefusal";
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
 *               endpoint that does not take its kind).
 */
export type IngestRefusalFix = "pick-key" | "open-key" | "budgets" | "billing";

export const INGEST_REFUSAL_FIXES: Readonly<
  Record<TelemetryIngestRefusalReason, IngestRefusalFix | null>
> = {
  [TelemetryIngestRefusalReason.KeyDisabled]: "pick-key",
  [TelemetryIngestRefusalReason.KeyExpired]: "pick-key",
  [TelemetryIngestRefusalReason.OriginNotAllowed]: "open-key",
  [TelemetryIngestRefusalReason.BrowserKeyNotAllowedHere]: null,
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

// How many were refused, and over what span.
export const REFUSED_COUNT_WORDS: PluralTemplate = {
  one: translationKey("{{count}} request refused {{time}}."),
  other: translationKey(
    "{{count}} requests refused since {{date}}, the latest {{time}}.",
  ),
};

// Where it was refused: the ingest endpoint, as the key's page names it.
export const INGEST_SURFACE_LABELS: Readonly<Record<string, string>> = {
  [TelemetryIngestSurface.OtelTraces]: translationKey("Traces"),
  [TelemetryIngestSurface.OtelLogs]: translationKey("Logs"),
  [TelemetryIngestSurface.OtelMetrics]: translationKey("Metrics"),
  [TelemetryIngestSurface.OtelProfiles]: translationKey("Profiles"),
  [TelemetryIngestSurface.SessionReplay]: translationKey("Session Replay"),
  [TelemetryIngestSurface.SourceMap]: translationKey("Source Maps"),
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
  [UNNAMED_TELEMETRY_INGEST_SURFACE]: translationKey("Other ingest"),
};

function translate(translator: Translator, text: string): string {
  return translator.translateText(text) || text;
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

// "{{count}} requests refused since {{date}}, the latest {{time}}."
export function getIngestRefusalCountText(
  refusal: { count: number; firstRefusedAt: Date; lastRefusedAt: Date },
  translator: Translator,
  now: Date,
): string {
  return translator.translatePlural(REFUSED_COUNT_WORDS, refusal.count, {
    date: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
      refusal.firstRefusedAt,
      Math.abs(now.getTime() - refusal.firstRefusedAt.getTime()) >=
        2 * 24 * 60 * 60 * 1000,
    ),
    time: OneUptimeDate.fromNow(refusal.lastRefusedAt, now),
  });
}

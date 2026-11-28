import ProductType from "../MeteredPlan/ProductType";
import {
  TelemetryIngestionBudgetRefusalKind,
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetSignal,
  TelemetryIngestionQueueRefusalKind,
  TelemetryIngestionQueueRefusalStatus,
} from "./TelemetryIngestionBudget";
import TelemetryIngestSurface from "./TelemetryIngestSurface";

/*
 * WHY TELEMETRY SENT WITH A KNOWN INGESTION KEY WAS REFUSED (issue #6378).
 *
 * The ingest guards turn a request away for one of these reasons, and
 * TelemetryIngestRefusalRecorder counts each refusal against the key that
 * sent it (TelemetryIngestionKeyRefusal: one row per key, reason and
 * surface), so the RUM setup check, its empty charts and the key's own page
 * can say what was refused, when, and how to fix it.
 *
 * Only a refusal of a key that resolved is counted. A missing or unknown
 * token names no project, so it is counted nowhere: the sender's 401 and the
 * server's "Invalid service token." log line are all there is of it.
 *
 * The values are stored, so they never change; a new reason is a new value.
 */
export enum TelemetryIngestRefusalReason {
  // The key's kill switch is off.
  KeyDisabled = "key-disabled",
  // The key's expiry date passed.
  KeyExpired = "key-expired",
  // A Browser key's request came from an origin it does not list, or none.
  OriginNotAllowed = "origin-not-allowed",
  // A Browser key on a surface only Server keys may use.
  BrowserKeyNotAllowedHere = "browser-key-not-allowed-here",
  /*
   * A Mobile key (issue #6457) sending anything but a mobile app's OTLP
   * traces, logs and metrics over HTTP, or sending from a web page.
   */
  MobileKeyNotAllowedHere = "mobile-key-not-allowed-here",
  // A key pinned to one service on an identity registration surface.
  PinnedKeyNotAllowedHere = "pinned-key-not-allowed-here",
  // Over the key's own requests-per-minute limit.
  KeyRequestsPerMinute = "key-requests-per-minute",
  // The key's own daily ingestion budget is used up.
  KeyDailyBudget = "key-daily-budget",
  // Over the key's own ingestion rate (bytes per second).
  KeyIngestionRate = "key-ingestion-rate",
  // The project's daily ingestion budget is used up.
  ProjectDailyBudget = "project-daily-budget",
  // Over the project's ingestion rate (bytes per second).
  ProjectIngestionRate = "project-ingestion-rate",
  // The project has no way to pay (pay-as-you-go billing).
  PaymentRequired = "payment-required",
  // An administrator of this install blocked the project.
  ProjectBlocked = "project-blocked",
  /*
   * Too much of the project's telemetry of the signal is still waiting in
   * the telemetry queue to be stored (TelemetryIngestShedding): refused
   * until the workers catch up, and the sender told to retry (#11440).
   */
  QueueBacklogged = "queue-backlogged",
  /*
   * The telemetry queue is nearly full for every project
   * (TelemetryIngestShedding): refused until it has room, and the sender
   * told to retry (#11440).
   */
  QueueFull = "queue-full",
}

export const ALL_TELEMETRY_INGEST_REFUSAL_REASONS: ReadonlyArray<TelemetryIngestRefusalReason> =
  Object.values(TelemetryIngestRefusalReason);

/*
 * The reasons that hold for every key of the project alike: whichever key
 * the sender used, it would have been refused the same way. The rest belong
 * to the key that was refused.
 */
export const PROJECT_WIDE_TELEMETRY_INGEST_REFUSAL_REASONS: ReadonlySet<TelemetryIngestRefusalReason> =
  new Set<TelemetryIngestRefusalReason>([
    TelemetryIngestRefusalReason.ProjectDailyBudget,
    TelemetryIngestRefusalReason.ProjectIngestionRate,
    TelemetryIngestRefusalReason.PaymentRequired,
    TelemetryIngestRefusalReason.ProjectBlocked,
    TelemetryIngestRefusalReason.QueueBacklogged,
    TelemetryIngestRefusalReason.QueueFull,
  ]);

/*
 * The reasons the telemetry queue refuses for (#11440): not the key's, and
 * no setting of the project's - OneUptime refuses while it catches up, and
 * the sender retries. They come and go, so each stretch of them is told
 * apart: a refusal more than TELEMETRY_INGEST_REFUSAL_STRETCH_GAP_MS after
 * the latest one counted begins a new stretch, its row's count and first
 * refusal starting again (TelemetryIngestionKeyRefusalService), so "since"
 * says when this stretch began, not the first one ever.
 */
export const QUEUE_TELEMETRY_INGEST_REFUSAL_REASONS: ReadonlySet<TelemetryIngestRefusalReason> =
  new Set<TelemetryIngestRefusalReason>([
    TelemetryIngestRefusalReason.QueueBacklogged,
    TelemetryIngestRefusalReason.QueueFull,
  ]);

/*
 * Longer than any wait between two refusals of a stretch: a refused
 * sender is told to retry in 30 seconds, and each ingest process writes
 * what it refused every five minutes (TelemetryIngestRefusalRecorder).
 */
export const TELEMETRY_INGEST_REFUSAL_STRETCH_GAP_MS: number = 15 * 60 * 1000;

/*
 * The surface a queue refusal is counted under: the signal's own, whatever
 * endpoint carried it. The queue refuses a project's signal, not an
 * endpoint - its logs over syslog as over OTLP - and the one OTLP/gRPC
 * surface carries every signal, so a refusal counted under it would no
 * longer say which signal was refused.
 */
export const QUEUE_REFUSAL_SURFACE_FOR_SIGNAL: Readonly<
  Record<TelemetryIngestionBudgetSignal, TelemetryIngestSurface>
> = {
  [ProductType.Logs]: TelemetryIngestSurface.OtelLogs,
  [ProductType.Traces]: TelemetryIngestSurface.OtelTraces,
  [ProductType.Metrics]: TelemetryIngestSurface.OtelMetrics,
  [ProductType.Profiles]: TelemetryIngestSurface.OtelProfiles,
  [ProductType.SecurityEvents]: TelemetryIngestSurface.SecurityEvents,
};

// The signal a queue refusal counted under a surface is for, or null.
export function getSignalForQueueRefusalSurface(
  surface: string,
): TelemetryIngestionBudgetSignal | null {
  for (const signal of Object.keys(
    QUEUE_REFUSAL_SURFACE_FOR_SIGNAL,
  ) as Array<TelemetryIngestionBudgetSignal>) {
    if (QUEUE_REFUSAL_SURFACE_FOR_SIGNAL[signal] === surface) {
      return signal;
    }
  }

  return null;
}

// The kind of queue refusal a stored reason is, or null for any other reason.
const QUEUE_REFUSAL_KIND_OF_REASON: Readonly<
  Partial<
    Record<TelemetryIngestRefusalReason, TelemetryIngestionQueueRefusalKind>
  >
> = {
  [TelemetryIngestRefusalReason.QueueBacklogged]:
    TelemetryIngestionBudgetRefusalKind.QueueBacklogged,
  [TelemetryIngestRefusalReason.QueueFull]:
    TelemetryIngestionBudgetRefusalKind.QueueFull,
};

// One key's count of queue refusals, as its row holds it.
export interface TelemetryIngestQueueRefusalRow {
  reason: string;
  surface: string;
  count: number;
  firstRefusedAt: Date;
  lastRefusedAt: Date;
}

interface QueueRefusalStretch {
  signal: TelemetryIngestionBudgetSignal;
  kind: TelemetryIngestionQueueRefusalKind;
  count: number;
  firstAt: number;
  lastAt: number;
}

/*
 * What the queue refused of each of a project's signals, from its keys'
 * rows (#11440): per signal and kind of refusal, the latest stretch -
 * every key's rows whose refusals ran on into one another, no more than
 * TELEMETRY_INGEST_REFUSAL_STRETCH_GAP_MS apart - with their counts added
 * up, from its first refusal to its latest. A row of another reason, or
 * under a surface no signal's queue refusals are counted under, is left
 * out. The latest refusal first.
 */
export function summarizeTelemetryQueueRefusals(
  rows: ReadonlyArray<TelemetryIngestQueueRefusalRow>,
): Array<TelemetryIngestionQueueRefusalStatus> {
  const byStream: Map<
    string,
    Array<TelemetryIngestQueueRefusalRow>
  > = new Map();

  for (const row of rows) {
    const kind: TelemetryIngestionQueueRefusalKind | undefined =
      isTelemetryIngestRefusalReason(row.reason)
        ? QUEUE_REFUSAL_KIND_OF_REASON[row.reason]
        : undefined;
    const signal: TelemetryIngestionBudgetSignal | null =
      getSignalForQueueRefusalSurface(row.surface);

    if (
      !kind ||
      !signal ||
      !Number.isFinite(row.lastRefusedAt.getTime()) ||
      !Number.isFinite(row.firstRefusedAt.getTime())
    ) {
      continue;
    }

    const id: string = `${signal}|${kind}`;
    const stream: Array<TelemetryIngestQueueRefusalRow> =
      byStream.get(id) || [];

    stream.push(row);
    byStream.set(id, stream);
  }

  const latest: Array<QueueRefusalStretch> = [];

  for (const [id, stream] of byStream) {
    const [signal, kind] = id.split("|") as [
      TelemetryIngestionBudgetSignal,
      TelemetryIngestionQueueRefusalKind,
    ];

    // A row's first refusal is never after its latest.
    const spans: Array<{ firstAt: number; lastAt: number; count: number }> =
      stream.map((row: TelemetryIngestQueueRefusalRow) => {
        return {
          firstAt: Math.min(
            row.firstRefusedAt.getTime(),
            row.lastRefusedAt.getTime(),
          ),
          lastAt: row.lastRefusedAt.getTime(),
          count:
            Number.isFinite(row.count) && row.count >= 1
              ? Math.floor(row.count)
              : 1,
        };
      });

    // Earliest first, so each stretch is built from the rows that run on into it.
    spans.sort((a: { firstAt: number }, b: { firstAt: number }): number => {
      return a.firstAt - b.firstAt;
    });

    let stretch: QueueRefusalStretch | null = null;

    for (const { firstAt, lastAt, count } of spans) {
      if (
        stretch &&
        firstAt <= stretch.lastAt + TELEMETRY_INGEST_REFUSAL_STRETCH_GAP_MS
      ) {
        stretch.count += count;
        stretch.lastAt = Math.max(stretch.lastAt, lastAt);
        continue;
      }

      // The first row, or one that began after the stretch before had ended.
      stretch = { signal, kind, count, firstAt, lastAt };
    }

    if (stretch) {
      latest.push(stretch);
    }
  }

  return latest
    .sort((a: QueueRefusalStretch, b: QueueRefusalStretch): number => {
      return b.lastAt - a.lastAt;
    })
    .map(
      (stretch: QueueRefusalStretch): TelemetryIngestionQueueRefusalStatus => {
        return {
          signal: stretch.signal,
          kind: stretch.kind,
          refusedRequests: stretch.count,
          firstRefusedAt: new Date(stretch.firstAt).toISOString(),
          lastRefusedAt: new Date(stretch.lastAt).toISOString(),
        };
      },
    );
}

/*
 * The surface stored for a refusal on the legacy guard
 * (TelemetryIngest.isAuthorizedServiceMiddleware), which names none.
 */
export const UNNAMED_TELEMETRY_INGEST_SURFACE: string = "unnamed";

export function isTelemetryIngestRefusalReason(
  value: unknown,
): value is TelemetryIngestRefusalReason {
  return (
    typeof value === "string" &&
    (ALL_TELEMETRY_INGEST_REFUSAL_REASONS as ReadonlyArray<string>).includes(
      value,
    )
  );
}

/*
 * Whether a budget scope's refusal is the key's own, or holds for every key
 * of the project alike - each scope named, so a new one is decided here.
 *
 * A team's or a label's budget (#6386) never refuses a request: whose
 * telemetry a request carries is known only in the worker, after the
 * sender was answered, so its budget drops what it counts there and keeps
 * its drops in its own day counters (TelemetryIngestAttribution), which
 * the Usage page and Security Events read. Were one handed here, it would
 * read as the project's, not the key's: whichever key sent the team's
 * telemetry, it would have been dropped the same way.
 */
const IS_KEY_SCOPE: Record<TelemetryIngestionBudgetScope, boolean> = {
  [TelemetryIngestionBudgetScope.Project]: false,
  [TelemetryIngestionBudgetScope.IngestionKey]: true,
  [TelemetryIngestionBudgetScope.Team]: false,
  [TelemetryIngestionBudgetScope.Label]: false,
};

/*
 * The reason an ingestion budget refusal is counted under - or the
 * telemetry queue's (TelemetryIngestShedding answers as a budget does).
 */
export function getTelemetryIngestRefusalReasonForBudget(refusal: {
  kind: TelemetryIngestionBudgetRefusalKind;
  scope: TelemetryIngestionBudgetScope;
}): TelemetryIngestRefusalReason {
  if (refusal.kind === TelemetryIngestionBudgetRefusalKind.QueueBacklogged) {
    return TelemetryIngestRefusalReason.QueueBacklogged;
  }

  if (refusal.kind === TelemetryIngestionBudgetRefusalKind.QueueFull) {
    return TelemetryIngestRefusalReason.QueueFull;
  }

  const isKey: boolean = IS_KEY_SCOPE[refusal.scope] === true;

  if (refusal.kind === TelemetryIngestionBudgetRefusalKind.RateLimited) {
    return isKey
      ? TelemetryIngestRefusalReason.KeyIngestionRate
      : TelemetryIngestRefusalReason.ProjectIngestionRate;
  }

  return isKey
    ? TelemetryIngestRefusalReason.KeyDailyBudget
    : TelemetryIngestRefusalReason.ProjectDailyBudget;
}

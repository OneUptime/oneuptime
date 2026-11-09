import {
  ALL_TELEMETRY_INGEST_REFUSAL_REASONS,
  PROJECT_WIDE_TELEMETRY_INGEST_REFUSAL_REASONS,
} from "Common/Types/Telemetry/TelemetryIngestRefusal";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import { IngestRefusalFact } from "../../Telemetry/IngestRefusalFacts";
import {
  RUM_SETUP_CHECK_RECENT_WINDOW_MS,
  RUM_SIGNAL_STAMP_TOLERANCE_MS,
} from "./RumSignalDiagnosis";

export type { IngestRefusalFact } from "../../Telemetry/IngestRefusalFacts";

/*
 * WHETHER A RUM APPLICATION'S TELEMETRY IS BEING REFUSED (issue #6378),
 * without React.
 *
 * The ingest endpoints count what they refuse per ingestion key, reason and
 * surface (TelemetryIngestionKeyRefusal). They refuse before the payload is
 * read, so before anything in it names an application: a refusal belongs
 * to a key, not an app. So a refusal speaks for an application when:
 *
 *   - it holds for every key of the project alike (a used-up project
 *     budget, no payment method, a blocked project): whatever key the app
 *     sends with, it is refused the same way;
 *   - its key is pinned to the app's service.name;
 *   - its key is an unpinned Browser key and the app is a browser app. A
 *     browser app's setup gives it a Browser key, and nothing but a page
 *     sends with one. A mobile app sends with a Server key, which the
 *     project's backends send with too, so an unpinned Server key's refusal
 *     does not speak for one.
 *
 * And it explains what the app sends of a kind (page loads and requests,
 * logs, metrics, recordings - the surface it was refused on) only while
 * nothing of that kind has arrived since:
 *
 *   refused         - the latest refusal is newer than the kind's latest
 *                     arrival, by more than the stamps can be apart
 *                     (RUM_SIGNAL_STAMP_TOLERANCE_MS), or nothing of the
 *                     kind ever arrived;
 *   partly-refused  - the kind arrives around the time it is refused: a
 *                     limit refuses what goes over it, or the key was just
 *                     put right. Only for a refusal that is the app's own
 *                     (project-wide, or its key pinned to the app): an
 *                     unpinned Browser key is shared by every page that
 *                     sends with it, and while this app's telemetry keeps
 *                     arriving, its refusals are most likely another app's.
 *                     In a busy project that would be a warning on every
 *                     healthy browser app;
 *   (none)          - it arrived well after the latest refusal: put right,
 *                     or another key sends it now.
 *
 * Only refusals of the past day count (RUM_SETUP_CHECK_RECENT_WINDOW_MS):
 * the setup check's "arriving" window.
 */

// The kinds of telemetry a RUM application sends, each on its own surface.
export type RumRefusalKind = "traces" | "logs" | "metrics" | "sessionReplay";

export const RUM_REFUSAL_KIND_OF_SURFACE: Readonly<
  Partial<Record<string, RumRefusalKind>>
> = {
  [TelemetryIngestSurface.OtelTraces]: "traces",
  [TelemetryIngestSurface.OtelLogs]: "logs",
  [TelemetryIngestSurface.OtelMetrics]: "metrics",
  [TelemetryIngestSurface.SessionReplay]: "sessionReplay",
};

export interface RumRefusalApp {
  client: "browser" | "mobile";
  // The app's service.name (RumApplication.appIdentifier).
  appIdentifier: string | null;
}

export type RumRefusalState = "refused" | "partly-refused";

export interface RumKindRefusal {
  state: RumRefusalState;
  // The refusal to explain: the latest that speaks for the app.
  refusal: IngestRefusalFact;
}

/*
 * Whether a refusal is the application's own: it holds for every key of the
 * project, or its key is pinned to the app. The rest (an unpinned Browser
 * key's) may be another app's.
 */
export function isIngestRefusalOwnedByRumApp(
  fact: IngestRefusalFact,
  app: RumRefusalApp,
): boolean {
  if (PROJECT_WIDE_TELEMETRY_INGEST_REFUSAL_REASONS.has(fact.reason)) {
    return true;
  }

  return Boolean(
    fact.pinnedServiceName &&
      app.appIdentifier &&
      fact.pinnedServiceName === app.appIdentifier,
  );
}

// Whether a refusal speaks for this application at all (see the top).
export function isIngestRefusalForRumApp(
  fact: IngestRefusalFact,
  app: RumRefusalApp,
): boolean {
  if (PROJECT_WIDE_TELEMETRY_INGEST_REFUSAL_REASONS.has(fact.reason)) {
    return true;
  }

  if (fact.pinnedServiceName) {
    return Boolean(
      app.appIdentifier && fact.pinnedServiceName === app.appIdentifier,
    );
  }

  return (
    app.client === "browser" &&
    fact.keyType === TelemetryIngestionKeyType.Browser
  );
}

/*
 * The newer of two refusals; on the same instant, the reason listed first
 * (a key switched off before the limits it would also have gone over).
 */
function isNewer(a: IngestRefusalFact, b: IngestRefusalFact): boolean {
  const at: number = a.lastRefusedAt.getTime();
  const bt: number = b.lastRefusedAt.getTime();

  if (at !== bt) {
    return at > bt;
  }

  return (
    ALL_TELEMETRY_INGEST_REFUSAL_REASONS.indexOf(a.reason) <
    ALL_TELEMETRY_INGEST_REFUSAL_REASONS.indexOf(b.reason)
  );
}

/*
 * Whether, and how, what the application sends of one kind is refused;
 * null when nothing refused speaks for it (see the top).
 */
export function getRumKindRefusal(data: {
  // null while they load, or when they could not be read.
  refusals: ReadonlyArray<IngestRefusalFact> | null;
  kind: RumRefusalKind;
  // When the kind last arrived from the application, null for never.
  lastArrivalAt: Date | null;
  app: RumRefusalApp;
  now: Date;
}): RumKindRefusal | null {
  if (!data.refusals || data.refusals.length === 0) {
    return null;
  }

  const now: number = data.now.getTime();
  // The latest refusal that speaks for the app, and the latest of its own.
  let latest: IngestRefusalFact | null = null;
  let latestOwn: IngestRefusalFact | null = null;

  for (const fact of data.refusals) {
    if (RUM_REFUSAL_KIND_OF_SURFACE[fact.surface] !== data.kind) {
      continue;
    }

    if (now - fact.lastRefusedAt.getTime() > RUM_SETUP_CHECK_RECENT_WINDOW_MS) {
      continue;
    }

    if (!isIngestRefusalForRumApp(fact, data.app)) {
      continue;
    }

    if (!latest || isNewer(fact, latest)) {
      latest = fact;
    }

    if (
      isIngestRefusalOwnedByRumApp(fact, data.app) &&
      (!latestOwn || isNewer(fact, latestOwn))
    ) {
      latestOwn = fact;
    }
  }

  if (!latest) {
    return null;
  }

  const arrivedAt: number | null =
    data.lastArrivalAt && !Number.isNaN(data.lastArrivalAt.getTime())
      ? data.lastArrivalAt.getTime()
      : null;

  if (
    arrivedAt === null ||
    arrivedAt < latest.lastRefusedAt.getTime() - RUM_SIGNAL_STAMP_TOLERANCE_MS
  ) {
    return { state: "refused", refusal: latest };
  }

  if (
    latestOwn &&
    arrivedAt <=
      latestOwn.lastRefusedAt.getTime() + RUM_SIGNAL_STAMP_TOLERANCE_MS
  ) {
    return { state: "partly-refused", refusal: latestOwn };
  }

  return null;
}

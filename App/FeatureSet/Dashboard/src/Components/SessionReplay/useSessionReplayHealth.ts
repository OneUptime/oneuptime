import { useCallback, useEffect, useState } from "react";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  RecordingHealthDiagnosis,
  RecordingHealthStatus,
} from "Common/Types/Rum/SessionReplayHealth";
import {
  diagnoseRecordingHealth,
  parseRecordingHealthStatus,
} from "Common/Utils/Rum/SessionReplayHealth";
import {
  readDtoOptionalNumber,
  readDtoStringArray,
} from "Common/Types/Rum/SessionReplayApi";

/*
 * useSessionReplayHealth(rumApplicationId): the one source of "is recording
 * working?" for every replay surface.
 *
 * The list page's health strip, the empty-list setup guide, the settings
 * page's health card and the installation test can all be mounted for the
 * same application at once, and each wants the same /ingest-status answer.
 * Rather than four pollers, one poller per application lives in a module
 * store and every hook instance subscribes to it. The poll interval is the
 * FASTEST any subscriber asked for: the setup guide asks for 10s because a
 * customer is sitting there waiting for their first chunk, the strip asks
 * for 60s because it is a status line. When the guide unmounts the poller
 * slows back down; when the last subscriber unmounts it stops.
 *
 * Generation-guarded (a stale response never overwrites a newer one) and
 * unmount-safe (a response that lands after every subscriber left is
 * stored but notifies nobody).
 */

export const SESSION_REPLAY_INGEST_STATUS_ROUTE: string =
  "/telemetry/rum/session-replay/ingest-status";

/* While somebody is waiting for a first chunk: uploads flush every 15s. */
export const SESSION_REPLAY_HEALTH_POLL_FAST_MS: number = 10 * 1000;

/* A status line: fresh enough for "last chunk 2m ago" to stay honest. */
export const SESSION_REPLAY_HEALTH_POLL_SLOW_MS: number = 60 * 1000;

export type SessionReplayHealthErrorKind =
  /* 401/403: the viewer lacks the session-replay read permission. */
  | "permission"
  /* 402: the project's plan does not include session replay. */
  | "plan"
  /* Anything else: network, 5xx, malformed body. */
  | "other";

export interface SessionReplayHealthError {
  kind: SessionReplayHealthErrorKind;
  /* The server's own message, kept for the "details" line only. */
  message: string;
}

/*
 * Additive fields the route sends that RecordingHealthStatus does not carry
 * yet. Read defensively off the raw body so an older server (or a newer
 * one) never breaks the parse; null means "the server did not say".
 */
export interface SessionReplayHealthExtras {
  /* Chunks dropped inside the worker AFTER a 202; null = counter unreachable. */
  dropsLast24h: Array<{ reason: string; count: number }> | null;
  /* attributes["recorder.capabilities"] of the newest session, when sent. */
  recorderCapabilities: Array<string> | null;
}

export interface SessionReplayHealthSnapshot {
  status: RecordingHealthStatus | null;
  diagnosis: RecordingHealthDiagnosis;
  extras: SessionReplayHealthExtras;
  /* True until the FIRST response (success or failure) for this application. */
  isLoading: boolean;
  /* True while a request is in flight, including polls. */
  isRefreshing: boolean;
  error: SessionReplayHealthError | null;
  /* When the status was last read successfully; null before the first success. */
  fetchedAtUnixMs: number | null;
  /* The clock the diagnosis was computed against. */
  nowUnixMs: number;
}

export interface UseSessionReplayHealthOptions {
  /* Defaults to the slow interval. The store polls at the fastest subscriber's rate. */
  pollIntervalMs?: number | undefined;
  /* false = subscribe without polling (a test, or a surface that is hidden). */
  enabled?: boolean | undefined;
}

export interface UseSessionReplayHealthResult
  extends SessionReplayHealthSnapshot {
  refresh: () => Promise<void>;
}

type Listener = () => void;

interface Subscriber {
  listener: Listener;
  intervalMs: number;
}

interface Poller {
  rumApplicationId: string;
  snapshot: SessionReplayHealthSnapshot;
  subscribers: Set<Subscriber>;
  timer: ReturnType<typeof setTimeout> | null;
  /* Bumped per request; a response from an older generation is dropped. */
  generation: number;
  inFlight: Promise<void> | null;
}

const pollers: Map<string, Poller> = new Map<string, Poller>();

/* What the hook returns before anything has been read. */
function makeInitialSnapshot(nowUnixMs: number): SessionReplayHealthSnapshot {
  return {
    status: null,
    diagnosis: diagnoseRecordingHealth(null, nowUnixMs),
    extras: { dropsLast24h: null, recorderCapabilities: null },
    isLoading: true,
    isRefreshing: false,
    error: null,
    fetchedAtUnixMs: null,
    nowUnixMs: nowUnixMs,
  };
}

/* HTTP status -> error kind. Anything the caller can act on gets its own word. */
export function classifyHealthError(err: unknown): SessionReplayHealthError {
  const statusCode: number =
    err instanceof HTTPErrorResponse ? err.statusCode : -1;

  let kind: SessionReplayHealthErrorKind = "other";

  if (statusCode === 401 || statusCode === 403) {
    kind = "permission";
  } else if (statusCode === 402) {
    kind = "plan";
  }

  return {
    kind: kind,
    message: API.getFriendlyMessage(err as HTTPErrorResponse),
  };
}

/*
 * Honest copy per failure class. The raw server string is kept as a
 * secondary line, never as the headline: "Please upgrade your plan" and
 * "Not authorized" do not tell the person which permission or plan they
 * are missing, and both used to be printed bare in red.
 */
export function describeHealthError(error: SessionReplayHealthError): {
  title: string;
  detail: string;
} {
  if (error.kind === "permission") {
    return {
      title: "You cannot see recording health",
      detail:
        "Reading recording health needs the Read Session Replay permission (project owners, admins and telemetry admins have it). Ask a project admin to grant it, or to run this check for you.",
    };
  }

  if (error.kind === "plan") {
    return {
      title: "Recording health is not included in this project's plan",
      detail:
        "Session replay needs a plan that includes it. Once the plan is upgraded, this check and the recordings themselves become available. The project-wide master switch is never plan-gated.",
    };
  }

  return {
    title: "Recording health could not be loaded",
    detail:
      "The health request failed, so nothing here says whether recording works. It retries on its own; the next poll may succeed.",
  };
}

function readExtras(raw: JSONObject): SessionReplayHealthExtras {
  const rawDrops: unknown = raw["dropsLast24h"];
  let drops: Array<{ reason: string; count: number }> | null = null;

  if (Array.isArray(rawDrops)) {
    drops = [];

    for (const entry of rawDrops) {
      if (entry === null || typeof entry !== "object") {
        continue;
      }

      const row: Record<string, unknown> = entry as Record<string, unknown>;
      const reason: unknown = row["reason"];
      const count: number | undefined = readDtoOptionalNumber(row, "count");

      if (
        typeof reason === "string" &&
        reason.length > 0 &&
        count !== undefined
      ) {
        drops.push({ reason: reason, count: count });
      }
    }
  }

  const capabilities: Array<string> = readDtoStringArray(
    raw,
    "recorderCapabilities",
  );

  return {
    dropsLast24h: drops,
    recorderCapabilities: Array.isArray(raw["recorderCapabilities"])
      ? capabilities
      : null,
  };
}

function notify(poller: Poller): void {
  for (const subscriber of Array.from(poller.subscribers)) {
    subscriber.listener();
  }
}

function fastestIntervalMs(poller: Poller): number | null {
  let fastest: number | null = null;

  for (const subscriber of poller.subscribers) {
    if (fastest === null || subscriber.intervalMs < fastest) {
      fastest = subscriber.intervalMs;
    }
  }

  return fastest;
}

function clearTimer(poller: Poller): void {
  if (poller.timer !== null) {
    clearTimeout(poller.timer);
    poller.timer = null;
  }
}

function scheduleNext(poller: Poller): void {
  clearTimer(poller);

  const intervalMs: number | null = fastestIntervalMs(poller);

  if (intervalMs === null) {
    return;
  }

  poller.timer = setTimeout((): void => {
    poller.timer = null;
    void fetchNow(poller);
  }, intervalMs);
}

/*
 * A hidden tab keeps its subscribers but does not poll: a settings page left
 * open overnight would otherwise fire 1,440 requests to update a line
 * nobody is reading. The next poll after it becomes visible refreshes it.
 */
function isDocumentHidden(): boolean {
  try {
    return (
      typeof document !== "undefined" && document.visibilityState === "hidden"
    );
  } catch {
    return false;
  }
}

async function fetchNow(poller: Poller): Promise<void> {
  if (poller.subscribers.size === 0) {
    return;
  }

  if (isDocumentHidden() && poller.snapshot.fetchedAtUnixMs !== null) {
    scheduleNext(poller);
    return;
  }

  poller.generation += 1;
  const generation: number = poller.generation;

  poller.snapshot = { ...poller.snapshot, isRefreshing: true };
  notify(poller);

  const run: Promise<void> = (async (): Promise<void> => {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            SESSION_REPLAY_INGEST_STATUS_ROUTE,
          ),
          data: { rumApplicationId: poller.rumApplicationId },
          headers: { ...ModelAPI.getCommonHeaders() },
        });

      if (generation !== poller.generation) {
        return;
      }

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const nowUnixMs: number = Date.now();
      const raw: JSONObject = response.data;
      const status: RecordingHealthStatus | null =
        parseRecordingHealthStatus(raw);

      poller.snapshot = {
        status: status,
        diagnosis: diagnoseRecordingHealth(status, nowUnixMs),
        extras:
          status === null
            ? { dropsLast24h: null, recorderCapabilities: null }
            : readExtras(raw),
        isLoading: false,
        isRefreshing: false,
        error:
          status === null
            ? {
                kind: "other",
                message: "The health response was not readable.",
              }
            : null,
        fetchedAtUnixMs: nowUnixMs,
        nowUnixMs: nowUnixMs,
      };
    } catch (err: unknown) {
      if (generation !== poller.generation) {
        return;
      }

      /*
       * A failed poll keeps the last good status on screen (it is still
       * the best information there is) but records the failure so the
       * surfaces can say "last read 3m ago, refresh failed".
       */
      poller.snapshot = {
        ...poller.snapshot,
        isLoading: false,
        isRefreshing: false,
        error: classifyHealthError(err),
        nowUnixMs: Date.now(),
      };
    } finally {
      if (generation === poller.generation) {
        poller.inFlight = null;
        notify(poller);
        scheduleNext(poller);
      }
    }
  })();

  poller.inFlight = run;

  return run;
}

function getPoller(rumApplicationId: string): Poller {
  let poller: Poller | undefined = pollers.get(rumApplicationId);

  if (!poller) {
    poller = {
      rumApplicationId: rumApplicationId,
      snapshot: makeInitialSnapshot(Date.now()),
      subscribers: new Set<Subscriber>(),
      timer: null,
      generation: 0,
      inFlight: null,
    };

    pollers.set(rumApplicationId, poller);
  }

  return poller;
}

/* Tests only: forget every poller so one test's response cannot leak into the next. */
export function clearSessionReplayHealthStore(): void {
  for (const poller of pollers.values()) {
    clearTimer(poller);
    poller.generation += 1;
    poller.subscribers.clear();
  }

  pollers.clear();
}

/* The current snapshot for an application, without subscribing. */
export function peekSessionReplayHealth(
  rumApplicationId: string,
): SessionReplayHealthSnapshot | null {
  return pollers.get(rumApplicationId)?.snapshot ?? null;
}

export default function useSessionReplayHealth(
  rumApplicationId: ObjectID | string,
  options?: UseSessionReplayHealthOptions,
): UseSessionReplayHealthResult {
  const applicationId: string = rumApplicationId.toString();
  const intervalMs: number =
    options?.pollIntervalMs ?? SESSION_REPLAY_HEALTH_POLL_SLOW_MS;
  const enabled: boolean = options?.enabled !== false;

  const [snapshot, setSnapshot] = useState<SessionReplayHealthSnapshot>(
    (): SessionReplayHealthSnapshot => {
      return getPoller(applicationId).snapshot;
    },
  );

  useEffect((): (() => void) => {
    const poller: Poller = getPoller(applicationId);

    const subscriber: Subscriber = {
      listener: (): void => {
        setSnapshot(poller.snapshot);
      },
      intervalMs: intervalMs,
    };

    poller.subscribers.add(subscriber);

    /* Another instance may have advanced the snapshot since our useState ran. */
    setSnapshot(poller.snapshot);

    if (enabled) {
      if (
        poller.inFlight === null &&
        poller.snapshot.fetchedAtUnixMs === null
      ) {
        void fetchNow(poller);
      } else if (poller.inFlight === null) {
        /*
         * A poller that already has a status reschedules at the (possibly
         * faster) new rate rather than waiting out the old timer: the
         * setup guide mounting on a page whose strip polls at 60s should
         * see 10s polling straight away.
         */
        scheduleNext(poller);
      }
    }

    return (): void => {
      poller.subscribers.delete(subscriber);

      if (poller.subscribers.size === 0) {
        clearTimer(poller);
      } else {
        scheduleNext(poller);
      }
    };
  }, [applicationId, intervalMs, enabled]);

  const refresh: () => Promise<void> = useCallback(async (): Promise<void> => {
    const poller: Poller = getPoller(applicationId);

    if (poller.inFlight) {
      return poller.inFlight;
    }

    return fetchNow(poller);
  }, [applicationId]);

  return { ...snapshot, refresh: refresh };
}

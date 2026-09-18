import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import RumSession from "Common/Models/AnalyticsModels/RumSession";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import { ReplayRailTabId } from "../Components/SessionReplay/Rail/ReplaySignalTypes";
import { buildReplayMomentRoute } from "../Components/SessionReplay/ReplayPlayerUrlState";

/*
 * Session id -> the RumSession header facts a replay link needs.
 *
 * A log row, a span and an exception occurrence all carry a sessionId but
 * none of them carries the RUM application the session belongs to, and the
 * player route needs both ids. Resolving that used to be a private cache
 * inside the logs viewer; the span panel and the occurrence table each grew
 * their own copy. One module-level cache means a session looked up from any
 * surface is known to every other one for the life of the page, and a
 * session id that is being resolved right now is not fetched a second time
 * by a sibling row that expanded a moment later.
 *
 * Empty results ARE cached: the recorder assigns the session id before the
 * first chunk is uploaded, so a telemetry row can name a session that was
 * never recorded (sampled out, consent withheld). That answer does not
 * change by asking again. Failures are NOT cached, so a transient 5xx can
 * retry on the next expand.
 */

export interface RumSessionLookupResult {
  sessionId: string;
  rumApplicationId: string;
  /* The recording's start on the server clock; null when the row lacks it. */
  startTime: Date | null;
}

type LookupPromise = Promise<RumSessionLookupResult | undefined>;

const cache: Map<string, LookupPromise> = new Map<string, LookupPromise>();

function normalizeSessionId(sessionId: string | null | undefined): string {
  return typeof sessionId === "string" ? sessionId.trim() : "";
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed: Date = new Date(value);

    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value);
  }

  return null;
}

function toLookupResult(
  session: RumSession | null | undefined,
): RumSessionLookupResult | undefined {
  const sessionId: string = normalizeSessionId(session?.sessionId?.toString());
  const rumApplicationId: string = (
    session?.rumApplicationId?.toString() || ""
  ).trim();

  if (sessionId.length === 0 || rumApplicationId.length === 0) {
    return undefined;
  }

  return {
    sessionId: sessionId,
    rumApplicationId: rumApplicationId,
    startTime: toDate(session?.startTime),
  };
}

async function fetchSessions(
  sessionIds: Array<string>,
): Promise<Array<RumSessionLookupResult>> {
  const result: ListResult<RumSession> =
    await AnalyticsModelAPI.getList<RumSession>({
      modelType: RumSession,
      query: {
        sessionId:
          sessionIds.length === 1 ? sessionIds[0] : new Includes(sessionIds),
      } as Query<RumSession>,
      select: {
        sessionId: true,
        rumApplicationId: true,
        startTime: true,
      },
      sort: {},
      skip: 0,
      limit: Math.min(Math.max(sessionIds.length, 1), LIMIT_PER_PROJECT),
    });

  const rows: Array<RumSessionLookupResult> = [];

  for (const session of result.data) {
    const row: RumSessionLookupResult | undefined = toLookupResult(session);

    if (row) {
      rows.push(row);
    }
  }

  return rows;
}

/*
 * One session. Concurrent callers share the in-flight promise; a settled
 * answer (found or not found) is served from the cache; a rejection is
 * evicted so the next caller retries.
 */
export function lookupRumSessionBySessionId(
  sessionId: string | null | undefined,
): LookupPromise {
  const key: string = normalizeSessionId(sessionId);

  if (key.length === 0) {
    return Promise.resolve(undefined);
  }

  const cached: LookupPromise | undefined = cache.get(key);

  if (cached) {
    return cached;
  }

  const pending: LookupPromise = fetchSessions([key])
    .then((rows: Array<RumSessionLookupResult>) => {
      return rows.find((row: RumSessionLookupResult): boolean => {
        return row.sessionId === key;
      });
    })
    .catch((error: unknown) => {
      cache.delete(key);
      throw error;
    });

  cache.set(key, pending);

  return pending;
}

/*
 * Many sessions in one read - a table page of occurrence rows. Ids already
 * cached (settled or in flight) are not re-fetched; the rest go out as one
 * Includes query and each answer is stored under its own id so later
 * single lookups from another surface hit the cache. Returns only the
 * sessions that exist; a rejection leaves nothing cached.
 */
export async function lookupRumSessionsBySessionIds(
  sessionIds: Array<string> | null | undefined,
): Promise<Map<string, RumSessionLookupResult>> {
  const found: Map<string, RumSessionLookupResult> = new Map<
    string,
    RumSessionLookupResult
  >();

  const wanted: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const raw of sessionIds || []) {
    const key: string = normalizeSessionId(raw);

    if (key.length === 0 || seen.has(key)) {
      continue;
    }

    seen.add(key);
    wanted.push(key);
  }

  if (wanted.length === 0) {
    return found;
  }

  const missing: Array<string> = wanted.filter((key: string): boolean => {
    return !cache.has(key);
  });

  if (missing.length > 0) {
    const batch: Promise<Array<RumSessionLookupResult>> = fetchSessions(
      missing,
    ).catch((error: unknown) => {
      for (const key of missing) {
        cache.delete(key);
      }
      throw error;
    });

    for (const key of missing) {
      cache.set(
        key,
        batch.then((rows: Array<RumSessionLookupResult>) => {
          return rows.find((row: RumSessionLookupResult): boolean => {
            return row.sessionId === key;
          });
        }),
      );
    }
  }

  const answers: Array<RumSessionLookupResult | undefined> = await Promise.all(
    wanted.map((key: string): LookupPromise => {
      return cache.get(key) || Promise.resolve(undefined);
    }),
  );

  for (const answer of answers) {
    if (answer) {
      found.set(answer.sessionId, answer);
    }
  }

  return found;
}

/* Tests, and any surface that must observe a fresh read. */
export function clearRumSessionLookupCache(): void {
  cache.clear();
}

export function getRumSessionLookupCacheSize(): number {
  return cache.size;
}

export interface ReplayMomentForSessionArgs {
  sessionId: string | null | undefined;
  /* The moment as a Date or unix milliseconds; the player converts it. */
  at?: Date | number | null | undefined;
  /* An offset into the recording, when the caller has that instead. */
  t?: number | null | undefined;
  signal?: string | null | undefined;
  rail?: ReplayRailTabId | string | null | undefined;
  preRollMs?: number | undefined;
}

/*
 * The player route for a moment in a session whose application is not yet
 * known. This is the whole of what a log row or a span panel needs: one
 * cached lookup, then the shared builder so pre-roll and clamping match
 * every other inbound link. undefined when the session has no recording;
 * rejects only when the lookup itself failed.
 */
export async function resolveReplayMomentRouteForSession(
  args: ReplayMomentForSessionArgs,
): Promise<Route | undefined> {
  const session: RumSessionLookupResult | undefined =
    await lookupRumSessionBySessionId(args.sessionId);

  if (!session) {
    return undefined;
  }

  return (
    buildReplayMomentRoute({
      rumApplicationId: session.rumApplicationId,
      sessionId: session.sessionId,
      at: args.at,
      t: args.t,
      signal: args.signal,
      rail: args.rail,
      ...(args.preRollMs !== undefined ? { preRollMs: args.preRollMs } : {}),
    }) || undefined
  );
}

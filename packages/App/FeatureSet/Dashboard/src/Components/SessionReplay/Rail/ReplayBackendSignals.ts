import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import GroupBy from "Common/Types/BaseDatabase/GroupBy";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import ModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import {
  ReplayClockNetworkAnchor,
  networkAnchorsFromSignals,
} from "./ReplayClockAlignment";
import {
  REPLAY_BACKEND_SIGNALS_ROW_LIMIT,
  ReplayBackendSignalKind,
  ReplayBackendSignalsSlot,
  ReplayBackendSignalsState,
  ReplaySignal,
  makeIdleBackendSignalsSlot,
} from "./ReplaySignalTypes";

/*
 * Fetching the backend side of a session - its logs, spans and exception
 * instances - through the ordinary analytics model reads.
 *
 * WHY THESE READS AND NOT A DEDICATED ENDPOINT. The model ACLs already gate
 * Log / Span / ExceptionInstance per project role, the sessionId and
 * traceId columns carry bloom skip indexes, and the Logs and Traces pages
 * use the same reads, so the rail cannot show anything those pages would
 * not. A 403 from a read therefore means exactly "this user lacks this
 * permission", which the rail renders as a locked tab naming it.
 *
 * TWO READS PER KIND. Read A is keyed on the session id: rows stamped with
 * it (span ingest stamps spans from the recorder's tracestate member, and
 * span-event exceptions inherit it; manual session.id wiring stamps the
 * rest). Read B is keyed on trace ids: rows of the traces this session
 * caused, over the same window. OTLP logs carry no trace state, so a
 * backend log only reaches the rail through B. The trace ids come from,
 * in this priority order (it decides who survives the cap):
 *
 *   recording   links.traceId of the network rows decoded so far
 *   header      the session header's traceIds (manifest; live poll)
 *   spans       logs and exceptions only: the distinct trace ids of this
 *               session's stamped spans - one grouped Span read, shared by
 *               both kinds and never touching the Traces tab's own slot
 *
 * No ids means read A alone, which is exactly the rail before trace ids.
 * A is the read that decides the slot: when it fails the slot is locked or
 * errored as before. When only B fails, A's rows are still published - a
 * tab that works without B must not blank with it - but on an ERROR slot
 * saying some linked rows did not load, so the rail keeps them on screen
 * beside a Retry instead of passing a partial answer off as the whole one
 * ("No backend logs matched" is false when the read that finds them
 * failed). B's ids are not counted as read, so a later reload names them
 * again. A 403 on B alone (not expected: both reads share the model's ACL)
 * leaves the slot ready, since no retry could change it. The grouped span
 * read stays best effort: a role that may read logs but not traces gets a
 * 403 there and simply loses the span-derived ids.
 *
 * WINDOWS. Each read is bounded to the session's [start, end] padded by a
 * few minutes on either side, because server stamps lag the browser and a
 * span that started before the first chunk was flushed still belongs to
 * this session. Live sessions have no end yet; "now" stands in. The time
 * column is also what prunes a trace-id read by partition and sort key.
 *
 * CAPS. Every read asks for REPLAY_BACKEND_SIGNALS_ROW_LIMIT rows. A and B
 * are merged (deduped, time-ascending) and cut back to that limit; when
 * either read came back full, or the merge overflowed, the slot is flagged
 * truncated and the rail defaults its scope toggle to "+-30s around
 * playhead", where 500 rows is plenty. B names at most
 * REPLAY_BACKEND_TRACE_IDS_CAP ids; when the session had more (the grouped
 * span read came back full, or the sources together passed the cap) the
 * rows of the traces left out were never asked for, so that is truncation
 * too (isTraceIdSetCapped says why).
 *
 * GENERATIONS. A load bumps the slot's generation and captures it; a
 * response whose generation is no longer current (the store was disposed
 * or reloaded) is dropped on the floor rather than overwriting fresher
 * rows - the same guard the ChunkLoader uses for chunk fetches. A and B
 * settle inside one generation, so a stale B can never land either, and a
 * B whose generation went stale while it waited for its ids (the grouped
 * span read can take tens of seconds) is never sent at all.
 */

/* Server stamps lag the recording; widen the window so nothing is clipped. */
export const REPLAY_BACKEND_SIGNALS_WINDOW_PADDING_MS: number = 5 * 60 * 1000;

/* Live sessions re-read their backend rows this often. */
export const REPLAY_BACKEND_SIGNALS_LIVE_REFRESH_MS: number = 60 * 1000;

/*
 * How often the rail asks the store whether a refresh is due; the store's
 * isBackendRefreshDue decides. The tick is much shorter than the refresh
 * interval on purpose: an interval as long as the refresh itself misses
 * the due moment by any latency at all and waits a whole second interval,
 * so "once a minute" ran every two minutes.
 */
export const REPLAY_BACKEND_SIGNALS_REFRESH_TICK_MS: number = 5 * 1000;

/*
 * The least rest a live slot gets after its load settles before it is due
 * again. The interval runs from the load's START so a fast read keeps a
 * steady once-a-minute cadence, but a slow one - a struggling ClickHouse
 * can take the grouped read and read B to the 45 s query cap each - must
 * not be re-run the moment it settles, by every open viewer, against the
 * backend that made it slow.
 */
export const REPLAY_BACKEND_SIGNALS_MIN_REST_MS: number = 30 * 1000;

/*
 * The fetchedAtUnixMs a load that started at startedAtUnixMs and settles
 * at settledAtUnixMs leaves on its slot: its start, unless that would make
 * the slot due again sooner than REPLAY_BACKEND_SIGNALS_MIN_REST_MS after
 * it settled.
 */
export function getBackendRefreshStamp(
  startedAtUnixMs: number,
  settledAtUnixMs: number,
): number {
  return Math.max(
    startedAtUnixMs,
    settledAtUnixMs -
      (REPLAY_BACKEND_SIGNALS_LIVE_REFRESH_MS -
        REPLAY_BACKEND_SIGNALS_MIN_REST_MS),
  );
}

/*
 * The most trace ids one trace-id read names (~34 KB of request body at
 * the cap). Recording ids fill it first, then header ids, then span ids.
 */
export const REPLAY_BACKEND_TRACE_IDS_CAP: number = 1000;

/* Distinct trace ids asked of the session's stamped spans. */
export const REPLAY_BACKEND_SESSION_TRACE_IDS_LIMIT: number =
  REPLAY_BACKEND_TRACE_IDS_CAP;

/*
 * New recording trace ids reload the ready slots once the decoder has been
 * quiet this long, so a burst of chunks costs one reload, not one per
 * chunk. A session whose footage is still being RECORDED (a tab is still
 * open: isManifestRecordingLive) never takes this path: its chunks keep
 * arriving (one every flush interval, each with new ids), so a debounce
 * would re-run every read every few seconds; its once-a-minute refresh
 * re-reads with every id known by then instead. A session whose tabs have
 * all closed keeps this pickup while the finalizer has yet to reach it
 * (10-15 minutes): its footage is complete, so the ids only grow as the
 * viewer's decoder works through it, as on a finalized session.
 */
export const REPLAY_BACKEND_RECORDING_RELOAD_DEBOUNCE_MS: number = 3 * 1000;

export const REPLAY_BACKEND_SIGNAL_KINDS: ReadonlyArray<ReplayBackendSignalKind> =
  ["log", "span", "exception"];

/* The model read each kind needs; the locked-tab copy names its title. */
export const REPLAY_BACKEND_SIGNAL_PERMISSIONS: Record<
  ReplayBackendSignalKind,
  Permission
> = {
  log: Permission.ReadTelemetryServiceLog,
  span: Permission.ReadTelemetryServiceTraces,
  exception: Permission.ReadTelemetryException,
};

const KIND_NOUNS: Record<ReplayBackendSignalKind, string> = {
  log: "backend logs",
  span: "traces",
  exception: "server exceptions",
};

export interface ReplayBackendSignalsWindowInput {
  startTimeUnixMs: number;
  /* null while the session is live. */
  endTimeUnixMs: number | null;
  nowUnixMs: number;
  paddingMs?: number | undefined;
}

/*
 * [start - padding, end + padding]; for a live session the end is "now".
 * A malformed end (before start) collapses to start so the window is
 * never inverted, which ClickHouse would answer with zero rows and no
 * explanation.
 */
export function buildBackendSignalsWindow(
  input: ReplayBackendSignalsWindowInput,
): InBetween<Date> {
  const paddingMs: number =
    typeof input.paddingMs === "number" && input.paddingMs >= 0
      ? input.paddingMs
      : REPLAY_BACKEND_SIGNALS_WINDOW_PADDING_MS;
  const endUnixMs: number =
    input.endTimeUnixMs !== null && Number.isFinite(input.endTimeUnixMs)
      ? Math.max(input.endTimeUnixMs, input.startTimeUnixMs)
      : Math.max(input.nowUnixMs, input.startTimeUnixMs);

  return new InBetween<Date>(
    new Date(input.startTimeUnixMs - paddingMs),
    new Date(endUnixMs + paddingMs),
  );
}

/* ---- Trace ids. ---- */

const TRACE_ID_PATTERN: RegExp = /^[0-9a-f]{32}$/;
const ALL_ZERO_TRACE_ID_PATTERN: RegExp = /^0+$/;

/*
 * One ordered, deduplicated list of W3C trace ids from several sources, in
 * the order given: lowercased (ingest stores hex ids lowercase), 32 hex
 * digits, never the all-zero invalid id, at most `cap` of them. Anything
 * else - wrong length, non-hex, not a string - is dropped rather than sent
 * to ClickHouse, where it could only ever match nothing.
 */
export function normalizeReplayTraceIds(
  sources: ReadonlyArray<ReadonlyArray<unknown> | null | undefined>,
  cap?: number | undefined,
): Array<string> {
  const limit: number =
    typeof cap === "number" && cap >= 0 ? cap : REPLAY_BACKEND_TRACE_IDS_CAP;
  const ids: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const source of sources) {
    if (!Array.isArray(source)) {
      continue;
    }

    for (const value of source) {
      if (ids.length >= limit) {
        return ids;
      }

      if (typeof value !== "string") {
        continue;
      }

      const id: string = value.trim().toLowerCase();

      if (
        !TRACE_ID_PATTERN.test(id) ||
        ALL_ZERO_TRACE_ID_PATTERN.test(id) ||
        seen.has(id)
      ) {
        continue;
      }

      seen.add(id);
      ids.push(id);
    }
  }

  return ids;
}

/*
 * The trace ids of the recording's own network rows (the same rows clock
 * anchoring pairs with spans), normalised and deduplicated, uncapped, in
 * the order the requests happened.
 */
export function recordingTraceIdsFromSignals(
  signals: Array<ReplaySignal>,
): Array<string> {
  return normalizeReplayTraceIds(
    [
      networkAnchorsFromSignals(signals).map(
        (anchor: ReplayClockNetworkAnchor): string => {
          return anchor.traceId;
        },
      ),
    ],
    Number.POSITIVE_INFINITY,
  );
}

/* ---- Request shapes. ---- */

export interface ReplayBackendListRequest<T extends AnalyticsBaseModel> {
  modelType: { new (): T };
  query: Query<T>;
  select: Select<T>;
  /* Only the session trace-id read groups; row reads never do. */
  groupBy?: GroupBy<T> | undefined;
  sort: Sort<T>;
  limit: number;
  skip: number;
}

/*
 * What a row read is keyed on: the session id (read A) or a set of trace
 * ids (read B). Both share the window, the columns, the sort and the cap.
 */
export type ReplayBackendQueryInput =
  | { sessionId: string; window: InBetween<Date> }
  | { traceIds: Array<string>; window: InBetween<Date> };

function rowKeyQuery(
  input: ReplayBackendQueryInput,
): Record<string, string | Includes> {
  if ("traceIds" in input) {
    return { traceId: new Includes(input.traceIds) };
  }

  return { sessionId: input.sessionId };
}

/*
 * Only the columns the rail renders. Log bodies can be large, and every
 * unselected column is bytes ClickHouse does not read. Service names come
 * from primaryEntityId (the Log/Span/ExceptionInstance column; there is no
 * serviceId column on these tables) resolved once per page by the rail.
 */
export function buildBackendLogsRequest(
  input: ReplayBackendQueryInput,
): ReplayBackendListRequest<Log> {
  return {
    modelType: Log,
    query: {
      ...rowKeyQuery(input),
      time: input.window,
    } as Query<Log>,
    select: {
      _id: true,
      time: true,
      severityText: true,
      severityNumber: true,
      body: true,
      primaryEntityId: true,
      primaryEntityType: true,
      traceId: true,
      spanId: true,
    } as Select<Log>,
    sort: { time: SortOrder.Ascending } as Sort<Log>,
    limit: REPLAY_BACKEND_SIGNALS_ROW_LIMIT,
    skip: 0,
  };
}

export function buildBackendSpansRequest(
  input: ReplayBackendQueryInput,
): ReplayBackendListRequest<Span> {
  return {
    modelType: Span,
    query: {
      ...rowKeyQuery(input),
      startTime: input.window,
    } as Query<Span>,
    select: {
      _id: true,
      traceId: true,
      spanId: true,
      parentSpanId: true,
      name: true,
      kind: true,
      startTime: true,
      durationUnixNano: true,
      statusCode: true,
      statusMessage: true,
      primaryEntityId: true,
      primaryEntityType: true,
    } as Select<Span>,
    sort: { startTime: SortOrder.Ascending } as Sort<Span>,
    limit: REPLAY_BACKEND_SIGNALS_ROW_LIMIT,
    skip: 0,
  };
}

export function buildBackendExceptionsRequest(
  input: ReplayBackendQueryInput,
): ReplayBackendListRequest<ExceptionInstance> {
  return {
    modelType: ExceptionInstance,
    query: {
      ...rowKeyQuery(input),
      time: input.window,
    } as Query<ExceptionInstance>,
    select: {
      _id: true,
      time: true,
      fingerprint: true,
      message: true,
      exceptionType: true,
      stackTrace: true,
      spanName: true,
      traceId: true,
      spanId: true,
      primaryEntityId: true,
      primaryEntityType: true,
    } as Select<ExceptionInstance>,
    sort: { time: SortOrder.Ascending } as Sort<ExceptionInstance>,
    limit: REPLAY_BACKEND_SIGNALS_ROW_LIMIT,
    skip: 0,
  };
}

/*
 * The distinct trace ids of the spans stamped with this session: GROUP BY
 * traceId, so one row per trace however many spans it has (a busy session
 * blows through 500 span ROWS in its first minutes). The server swaps the
 * select for the grouping and skips the _id tiebreak for grouped finds, so
 * the sort must name the grouped column.
 */
export function buildSessionTraceIdsRequest(input: {
  sessionId: string;
  window: InBetween<Date>;
}): ReplayBackendListRequest<Span> {
  return {
    modelType: Span,
    query: {
      sessionId: input.sessionId,
      startTime: input.window,
    } as Query<Span>,
    select: { traceId: true } as Select<Span>,
    groupBy: { traceId: true } as GroupBy<Span>,
    sort: { traceId: SortOrder.Ascending } as Sort<Span>,
    limit: REPLAY_BACKEND_SESSION_TRACE_IDS_LIMIT,
    skip: 0,
  };
}

/* ---- Merging read A with read B. ---- */

/* A read that came back full, or that the server says had more. */
export function isBackendListTruncated<T extends AnalyticsBaseModel>(
  result: ListResult<T>,
): boolean {
  if (result.data.length >= REPLAY_BACKEND_SIGNALS_ROW_LIMIT) {
    return true;
  }

  if (result.hasMore === true) {
    return true;
  }

  return (
    typeof result.count === "number" &&
    result.count > result.data.length &&
    result.data.length > 0
  );
}

/*
 * The grouped span read came back holding as many ids as it may, or the
 * server says there were more: some of the session's traces are missing
 * from it. It sorts by traceId, not time, so the ones left out are spread
 * across the whole session rather than being its tail.
 */
export function isSessionTraceIdListCapped(
  result: ListResult<Span> | null | undefined,
): boolean {
  if (!result) {
    return false;
  }

  const length: number = Array.isArray(result.data) ? result.data.length : 0;

  if (result.hasMore === true) {
    return true;
  }

  if (length >= REPLAY_BACKEND_SESSION_TRACE_IDS_LIMIT) {
    return true;
  }

  return (
    typeof result.count === "number" && result.count > length && length > 0
  );
}

function toUnixMs(value: unknown): number | null {
  if (value instanceof Date) {
    const ms: number = value.getTime();

    return Number.isFinite(ms) ? ms : null;
  }

  if (typeof value === "string" || typeof value === "number") {
    const ms: number = new Date(value).getTime();

    return Number.isFinite(ms) ? ms : null;
  }

  return null;
}

/* A row's _id as text; null when it has none (such rows never collapse). */
export function backendRowIdKey(row: AnalyticsBaseModel): string | null {
  const id: unknown = row._id;

  if (typeof id === "string") {
    return id.length > 0 ? id : null;
  }

  if (id !== null && typeof id === "object") {
    const text: string = String(id);

    return text.length > 0 && text !== "[object Object]" ? text : null;
  }

  return null;
}

/*
 * A span is one (traceId, spanId): the same span returned by both reads
 * must not double a trace's span count. Falls back to the row _id.
 */
export function backendSpanRowKey(row: Span): string | null {
  const traceId: unknown = row.traceId;
  const spanId: unknown = row.spanId;

  if (
    typeof traceId === "string" &&
    traceId.length > 0 &&
    typeof spanId === "string" &&
    spanId.length > 0
  ) {
    return `span:${traceId}:${spanId}`;
  }

  const id: string | null = backendRowIdKey(row);

  return id === null ? null : `id:${id}`;
}

export interface ReplayBackendMergedRows<T extends AnalyticsBaseModel> {
  rows: Array<T>;
  rowCount: number;
  isTruncated: boolean;
}

interface MergeEntry<T> {
  row: T;
  timeMs: number | null;
  order: number;
}

/*
 * A's rows then B's, deduplicated (first occurrence wins, so a row both
 * reads returned keeps A's copy), sorted ascending by the time column -
 * rows without a usable time go last, in arrival order - and cut to the
 * row limit. The sort decides which rows survive the cap. Without B the
 * result is A exactly as it came back.
 */
export function mergeBackendRows<T extends AnalyticsBaseModel>(args: {
  sessionRead: ListResult<T>;
  traceRead: ListResult<T> | null;
  timeOf: (row: T) => unknown;
  keyOf: (row: T) => string | null;
  limit?: number | undefined;
}): ReplayBackendMergedRows<T> {
  const limit: number =
    typeof args.limit === "number" && args.limit >= 0
      ? args.limit
      : REPLAY_BACKEND_SIGNALS_ROW_LIMIT;

  if (!args.traceRead) {
    return {
      rows: args.sessionRead.data,
      rowCount: args.sessionRead.data.length,
      isTruncated: isBackendListTruncated(args.sessionRead),
    };
  }

  const seen: Set<string> = new Set<string>();
  const entries: Array<MergeEntry<T>> = [];

  for (const row of [...args.sessionRead.data, ...args.traceRead.data]) {
    const key: string | null = args.keyOf(row);

    if (key !== null) {
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
    }

    entries.push({
      row: row,
      timeMs: toUnixMs(args.timeOf(row)),
      order: entries.length,
    });
  }

  entries.sort((a: MergeEntry<T>, b: MergeEntry<T>): number => {
    if (a.timeMs !== b.timeMs) {
      if (a.timeMs === null) {
        return 1;
      }

      if (b.timeMs === null) {
        return -1;
      }

      return a.timeMs < b.timeMs ? -1 : 1;
    }

    return a.order - b.order;
  });

  const rows: Array<T> = entries.slice(0, limit).map((entry: MergeEntry<T>) => {
    return entry.row;
  });

  return {
    rows: rows,
    rowCount: rows.length,
    isTruncated:
      isBackendListTruncated(args.sessionRead) ||
      isBackendListTruncated(args.traceRead) ||
      entries.length > limit,
  };
}

/* ---- Error classification. ---- */

export type ReplayBackendSignalsFailure =
  | { status: "locked"; lockedPermission: string }
  | { status: "error"; errorMessage: string };

function permissionTitle(permission: Permission): string {
  try {
    return PermissionHelper.getTitle(permission);
  } catch {
    /* A permission without props is a programming error; the enum value still names it. */
    return String(permission);
  }
}

function readStatusCode(error: unknown): number | null {
  if (error instanceof HTTPErrorResponse) {
    return error.statusCode;
  }

  if (
    error !== null &&
    typeof error === "object" &&
    "statusCode" in error &&
    typeof (error as { statusCode: unknown }).statusCode === "number"
  ) {
    return (error as { statusCode: number }).statusCode;
  }

  return null;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof HTTPErrorResponse) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "";
}

/*
 * 403 -> locked, naming the permission the user is missing (the only
 * action that fixes it is asking an admin for that permission). Anything
 * else -> error with domain copy; the row limit and the HTTP status are
 * the two numbers a person can act on.
 */
export function classifyBackendSignalsFailure(
  error: unknown,
  kind: ReplayBackendSignalKind,
): ReplayBackendSignalsFailure {
  const statusCode: number | null = readStatusCode(error);

  if (statusCode === 403) {
    return {
      status: "locked",
      lockedPermission: permissionTitle(
        REPLAY_BACKEND_SIGNAL_PERMISSIONS[kind],
      ),
    };
  }

  const noun: string = KIND_NOUNS[kind];
  const message: string = readErrorMessage(error).trim();

  if (statusCode !== null && statusCode > 0) {
    return {
      status: "error",
      errorMessage: `Loading ${noun} failed (HTTP ${statusCode}). Retry.`,
    };
  }

  if (message.length > 0) {
    return {
      status: "error",
      errorMessage: `Loading ${noun} failed: ${message}. Retry.`,
    };
  }

  return {
    status: "error",
    errorMessage: `Loading ${noun} failed before the server answered. Retry.`,
  };
}

/*
 * The copy for a slot whose session-id read worked but whose trace-id read
 * failed: the rows on screen are real, just not all of them. Same numbers
 * as classifyBackendSignalsFailure (status, else the transport's message).
 */
export function describePartialBackendSignalsFailure(
  error: unknown,
  kind: ReplayBackendSignalKind,
): string {
  const noun: string = KIND_NOUNS[kind];
  const statusCode: number | null = readStatusCode(error);
  const message: string = readErrorMessage(error).trim();

  if (statusCode !== null && statusCode > 0) {
    return `Some linked ${noun} did not load (HTTP ${statusCode}). Retry.`;
  }

  if (message.length > 0) {
    return `Some linked ${noun} did not load: ${message}. Retry.`;
  }

  return `Some linked ${noun} did not load. Retry.`;
}

/* ---- The store. ---- */

export interface ReplayBackendSignalsRows {
  log: Array<Log>;
  span: Array<Span>;
  exception: Array<ExceptionInstance>;
}

export interface ReplayBackendSignalsSnapshot {
  slots: ReplayBackendSignalsState;
  rows: ReplayBackendSignalsRows;
}

export type ReplayBackendListFetcher = <T extends AnalyticsBaseModel>(
  request: ReplayBackendListRequest<T>,
) => Promise<ListResult<T>>;

export interface ReplayBackendSignalsStoreOptions {
  sessionId: string;
  startTimeUnixMs: number;
  endTimeUnixMs: number | null;
  /* Live sessions refresh; finalized ones are read once per page. */
  isFinalized: boolean;
  /*
   * Footage is still being recorded (isManifestRecordingLive: some tab is
   * still open). Decides whether new recording ids wait for the live
   * refresh or get the debounced reload. Defaults to !isFinalized.
   */
  isRecordingLive?: boolean | undefined;
  /* The session header's trace ids (manifest.details.traceIds). */
  traceIds?: ReadonlyArray<string> | undefined;
  /* Injected for tests; defaults to Date.now and ModelAPI.getList. */
  now?: (() => number) | undefined;
  fetchList?: ReplayBackendListFetcher | undefined;
}

export type ReplayBackendSignalsListener = (
  snapshot: ReplayBackendSignalsSnapshot,
) => void;

const defaultFetchList: ReplayBackendListFetcher = async <
  T extends AnalyticsBaseModel,
>(
  request: ReplayBackendListRequest<T>,
): Promise<ListResult<T>> => {
  return await ModelAPI.getList<T>({
    modelType: request.modelType,
    query: request.query,
    select: request.select,
    groupBy: request.groupBy,
    sort: request.sort,
    limit: request.limit,
    skip: request.skip,
  });
};

export function makeIdleBackendSignalsState(): ReplayBackendSignalsState {
  return {
    log: makeIdleBackendSignalsSlot(),
    span: makeIdleBackendSignalsSlot(),
    exception: makeIdleBackendSignalsSlot(),
  };
}

/* The id-cap flag to carry onto a slot that keeps another's rows. */
function traceIdSetCapOf(slot: ReplayBackendSignalsSlot): {
  isTraceIdSetCapped?: boolean;
} {
  return slot.isTraceIdSetCapped === true ? { isTraceIdSetCapped: true } : {};
}

/*
 * A finished slot older than the refresh interval, on a live session. The
 * age runs from when the slot's load STARTED (fetchedAtUnixMs), so a read
 * that took a few hundred milliseconds is still due one interval after
 * the last one began, not one interval plus its latency - and a slow read
 * still rests REPLAY_BACKEND_SIGNALS_MIN_REST_MS (getBackendRefreshStamp).
 */
export function isBackendRefreshDue(
  slot: ReplayBackendSignalsSlot,
  nowUnixMs: number,
  isFinalized: boolean,
): boolean {
  if (isFinalized) {
    return false;
  }

  if (slot.status !== "ready" && slot.status !== "error") {
    return false;
  }

  if (slot.fetchedAtUnixMs === null) {
    return true;
  }

  return (
    nowUnixMs - slot.fetchedAtUnixMs >= REPLAY_BACKEND_SIGNALS_LIVE_REFRESH_MS
  );
}

/* A list of trace ids, and whether ids were left out of it at a cap. */
interface CappedTraceIds {
  ids: Array<string>;
  isCapped: boolean;
}

/* The grouped span read, shared by the log and exception loads. */
interface SessionTraceIdsRead {
  windowStartUnixMs: number;
  windowEndUnixMs: number;
  isInFlight: boolean;
  /* Never rejects: a failure resolves to no ids, not capped. */
  promise: Promise<CappedTraceIds>;
}

type TraceReadOutcome<T extends AnalyticsBaseModel> =
  | {
      ok: true;
      /* null when B did not run (no ids, A failed, or the load went stale). */
      result: ListResult<T> | null;
      namedTraceIds: Array<string>;
      isTraceIdSetCapped: boolean;
    }
  | { ok: false; error: unknown };

/* One kind's read A and read B, merged. */
interface ReplayBackendKindRead<T extends AnalyticsBaseModel>
  extends ReplayBackendMergedRows<T> {
  /* The ids a SUCCESSFUL read B named; empty when B did not run or failed. */
  namedTraceIds: Array<string>;
  isTraceIdSetCapped: boolean;
  /* Read B's failure; null when it succeeded or did not run. */
  traceReadFailure: { error: unknown } | null;
}

/*
 * Holds the three slots and their rows; the rail binds it with
 * useSyncExternalStore (getSnapshot returns the same object until
 * something changes, so React bails out cheaply). No React in here so it
 * can be driven synchronously from a test with a fake fetcher.
 */
export class ReplayBackendSignalsStore {
  private sessionId: string;
  private startTimeUnixMs: number;
  private endTimeUnixMs: number | null;
  private isFinalized: boolean;
  private isRecordingLive: boolean;
  private headerTraceIds: Array<string>;
  /* Only ever grows: a tab switch hands the player another tab's rows. */
  private readonly recordingTraceIds: Array<string>;
  private readonly recordingTraceIdSet: Set<string>;
  /* The trace ids each kind's last settled load named in its read B. */
  private readonly namedTraceIds: Record<ReplayBackendSignalKind, Set<string>>;
  private sessionTraceIdsRead: SessionTraceIdsRead | null;
  /* A 403 on the grouped span read holds for the page, like a locked slot. */
  private isSessionTraceIdsReadForbidden: boolean;
  private recordingReloadTimer: ReturnType<typeof setTimeout> | null;
  private readonly now: () => number;
  private readonly fetchList: ReplayBackendListFetcher;
  private readonly listeners: Set<ReplayBackendSignalsListener>;
  private readonly generations: Record<ReplayBackendSignalKind, number>;
  private snapshot: ReplayBackendSignalsSnapshot;
  private isDisposed: boolean;

  public constructor(options: ReplayBackendSignalsStoreOptions) {
    this.sessionId = options.sessionId;
    this.startTimeUnixMs = options.startTimeUnixMs;
    this.endTimeUnixMs = options.endTimeUnixMs;
    this.isFinalized = options.isFinalized;
    this.isRecordingLive =
      typeof options.isRecordingLive === "boolean"
        ? options.isRecordingLive
        : !options.isFinalized;
    this.headerTraceIds = normalizeReplayTraceIds(
      [options.traceIds],
      Number.POSITIVE_INFINITY,
    );
    this.recordingTraceIds = [];
    this.recordingTraceIdSet = new Set<string>();
    this.namedTraceIds = {
      log: new Set<string>(),
      span: new Set<string>(),
      exception: new Set<string>(),
    };
    this.sessionTraceIdsRead = null;
    this.isSessionTraceIdsReadForbidden = false;
    this.recordingReloadTimer = null;
    this.now =
      options.now ||
      ((): number => {
        return Date.now();
      });
    this.fetchList = options.fetchList || defaultFetchList;
    this.listeners = new Set<ReplayBackendSignalsListener>();
    this.generations = { log: 0, span: 0, exception: 0 };
    this.snapshot = {
      slots: makeIdleBackendSignalsState(),
      rows: { log: [], span: [], exception: [] },
    };
    this.isDisposed = false;
  }

  public getSnapshot(): ReplayBackendSignalsSnapshot {
    return this.snapshot;
  }

  public getSlot(kind: ReplayBackendSignalKind): ReplayBackendSignalsSlot {
    return this.snapshot.slots[kind];
  }

  public getRows<K extends ReplayBackendSignalKind>(
    kind: K,
  ): ReplayBackendSignalsRows[K] {
    return this.snapshot.rows[kind];
  }

  public subscribe(listener: ReplayBackendSignalsListener): () => void {
    this.listeners.add(listener);

    return (): void => {
      this.listeners.delete(listener);
    };
  }

  /*
   * Session facts can arrive after construction (manifest refresh). New
   * header trace ids are picked up by the next load or live refresh. When
   * the footage stops being recorded (the last tab closed) or the session
   * finalizes, recording ids that arrived since the last live refresh get
   * one debounced reload: from then on new ids take the debounce, and on
   * a finalized session the live refresh stops altogether.
   */
  public setSessionBounds(args: {
    startTimeUnixMs?: number | undefined;
    endTimeUnixMs?: number | null | undefined;
    isFinalized?: boolean | undefined;
    isRecordingLive?: boolean | undefined;
    traceIds?: ReadonlyArray<string> | undefined;
  }): void {
    const wasFinalized: boolean = this.isFinalized;
    const wasRecording: boolean = this.isFootageBeingRecorded();

    if (typeof args.startTimeUnixMs === "number") {
      this.startTimeUnixMs = args.startTimeUnixMs;
    }

    if (args.endTimeUnixMs !== undefined) {
      this.endTimeUnixMs = args.endTimeUnixMs;
    }

    if (typeof args.isFinalized === "boolean") {
      this.isFinalized = args.isFinalized;
    }

    if (typeof args.isRecordingLive === "boolean") {
      this.isRecordingLive = args.isRecordingLive;
    }

    if (args.traceIds !== undefined) {
      this.headerTraceIds = normalizeReplayTraceIds(
        [args.traceIds],
        Number.POSITIVE_INFINITY,
      );
    }

    if (
      (wasRecording && !this.isFootageBeingRecorded()) ||
      (!wasFinalized && this.isFinalized)
    ) {
      this.scheduleRecordingReload();
    }
  }

  /*
   * The trace ids of the recording's network rows decoded so far (the
   * player calls this whenever its decoded signals change; ids it already
   * knows are ignored). When the set grows, every READY slot whose read B
   * did not name the new ids is re-read once the decoder has been quiet
   * for REPLAY_BACKEND_RECORDING_RELOAD_DEBOUNCE_MS - unless footage is
   * still being recorded: then the ids are only remembered and the next
   * live refresh (refreshIfDue) names them. Idle slots stay idle, locked
   * and failed ones keep their state.
   */
  public setRecordingTraceIds(ids: ReadonlyArray<string>): void {
    if (this.isDisposed) {
      return;
    }

    const countBefore: number = this.recordingTraceIds.length;

    for (const id of normalizeReplayTraceIds([ids], Number.POSITIVE_INFINITY)) {
      if (!this.recordingTraceIdSet.has(id)) {
        this.recordingTraceIdSet.add(id);
        this.recordingTraceIds.push(id);
      }
    }

    /* Past the cap, a new id could not make it into any read anyway. */
    if (
      this.recordingTraceIds.length === countBefore ||
      countBefore >= REPLAY_BACKEND_TRACE_IDS_CAP
    ) {
      return;
    }

    this.scheduleRecordingReload();
  }

  public getWindow(): InBetween<Date> {
    return buildBackendSignalsWindow({
      startTimeUnixMs: this.startTimeUnixMs,
      endTimeUnixMs: this.endTimeUnixMs,
      nowUnixMs: this.now(),
    });
  }

  /*
   * Load one kind. Idempotent while a load is in flight (a second open of
   * the tab does not double-fetch); `force` re-reads a ready/locked/error
   * slot (retry button, live refresh). Resolves when the slot settled or
   * the response was dropped as stale.
   */
  public async load(
    kind: ReplayBackendSignalKind,
    options?: { force?: boolean | undefined },
  ): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    const current: ReplayBackendSignalsSlot = this.snapshot.slots[kind];

    if (current.status === "loading") {
      return;
    }

    if (current.status !== "idle" && !options?.force) {
      return;
    }

    this.generations[kind]++;
    const generation: number = this.generations[kind];
    /*
     * The settled slot's fetchedAtUnixMs: the refresh interval runs from
     * when this load began, not from when it settled (isBackendRefreshDue),
     * with a minimum rest after a slow one (getBackendRefreshStamp).
     */
    const startedAtUnixMs: number = this.now();

    /*
     * Keep the previous rows visible during a refresh; a live rail that
     * blanks every 60s is worse than one that is a minute stale.
     */
    this.patchSlot(kind, {
      status: "loading",
      rowCount: current.rowCount,
      isTruncated: current.isTruncated,
      ...traceIdSetCapOf(current),
      fetchedAtUnixMs: current.fetchedAtUnixMs,
    });

    const window: InBetween<Date> = this.getWindow();
    const recordingCountAtStart: number = this.recordingTraceIds.length;

    try {
      let read: ReplayBackendKindRead<AnalyticsBaseModel>;
      let rows: ReplayBackendSignalsRows;

      if (kind === "log") {
        const result: ReplayBackendKindRead<Log> = await this.readKind<Log>({
          kind: kind,
          generation: generation,
          window: window,
          build: buildBackendLogsRequest,
          timeOf: (row: Log): unknown => {
            return row.time;
          },
          keyOf: backendRowIdKey,
        });

        if (!this.isCurrent(kind, generation)) {
          return;
        }

        read = result;
        rows = { ...this.snapshot.rows, log: result.rows };
      } else if (kind === "span") {
        const result: ReplayBackendKindRead<Span> = await this.readKind<Span>({
          kind: kind,
          generation: generation,
          window: window,
          build: buildBackendSpansRequest,
          timeOf: (row: Span): unknown => {
            return row.startTime;
          },
          keyOf: backendSpanRowKey,
        });

        if (!this.isCurrent(kind, generation)) {
          return;
        }

        read = result;
        rows = { ...this.snapshot.rows, span: result.rows };
      } else {
        const result: ReplayBackendKindRead<ExceptionInstance> =
          await this.readKind<ExceptionInstance>({
            kind: kind,
            generation: generation,
            window: window,
            build: buildBackendExceptionsRequest,
            timeOf: (row: ExceptionInstance): unknown => {
              return row.time;
            },
            keyOf: backendRowIdKey,
          });

        if (!this.isCurrent(kind, generation)) {
          return;
        }

        read = result;
        rows = { ...this.snapshot.rows, exception: result.rows };
      }

      /* A failed B named nothing, so a later reload names its ids again. */
      this.namedTraceIds[kind] = new Set<string>(read.namedTraceIds);

      this.publish({
        slots: {
          ...this.snapshot.slots,
          [kind]: this.settledSlot(
            kind,
            read,
            getBackendRefreshStamp(startedAtUnixMs, this.now()),
          ),
        },
        rows: rows,
      });

      /* Ids that arrived while this load was in flight get their reload. */
      if (this.recordingTraceIds.length !== recordingCountAtStart) {
        this.scheduleRecordingReload();
      }
    } catch (error) {
      if (!this.isCurrent(kind, generation)) {
        return;
      }

      const failure: ReplayBackendSignalsFailure =
        classifyBackendSignalsFailure(error, kind);
      const previous: ReplayBackendSignalsSlot = this.snapshot.slots[kind];
      const refreshStamp: number = getBackendRefreshStamp(
        startedAtUnixMs,
        this.now(),
      );

      if (failure.status === "locked") {
        this.patchSlot(kind, {
          status: "locked",
          rowCount: null,
          isTruncated: false,
          lockedPermission: failure.lockedPermission,
          fetchedAtUnixMs: refreshStamp,
        });
      } else {
        /* A failed refresh keeps the last good rows and count on screen. */
        this.patchSlot(kind, {
          status: "error",
          rowCount: previous.rowCount,
          isTruncated: previous.isTruncated,
          ...traceIdSetCapOf(previous),
          errorMessage: failure.errorMessage,
          fetchedAtUnixMs: refreshStamp,
        });
      }
    }
  }

  public async loadAll(options?: {
    force?: boolean | undefined;
  }): Promise<void> {
    await Promise.all(
      REPLAY_BACKEND_SIGNAL_KINDS.map(
        (kind: ReplayBackendSignalKind): Promise<void> => {
          return this.load(kind, options);
        },
      ),
    );
  }

  /* Kinds whose rows are older than the refresh interval, on a live session. */
  public getRefreshDueKinds(): Array<ReplayBackendSignalKind> {
    const nowUnixMs: number = this.now();

    return REPLAY_BACKEND_SIGNAL_KINDS.filter(
      (kind: ReplayBackendSignalKind): boolean => {
        return isBackendRefreshDue(
          this.snapshot.slots[kind],
          nowUnixMs,
          this.isFinalized,
        );
      },
    );
  }

  /*
   * The 60s live refresh: re-read every settled slot that has gone stale.
   * The rail calls this every REPLAY_BACKEND_SIGNALS_REFRESH_TICK_MS and
   * this decides; a tick that finds nothing due costs nothing. Idle slots
   * stay idle (a tab nobody opened is not fetched on a timer) and locked
   * slots stay locked (permissions do not change by the minute).
   */
  public async refreshIfDue(): Promise<Array<ReplayBackendSignalKind>> {
    const due: Array<ReplayBackendSignalKind> = this.getRefreshDueKinds();

    await Promise.all(
      due.map((kind: ReplayBackendSignalKind): Promise<void> => {
        return this.load(kind, { force: true });
      }),
    );

    return due;
  }

  /* Drops every in-flight response, cancels pending reloads, stops notifying. */
  public dispose(): void {
    this.isDisposed = true;

    for (const kind of REPLAY_BACKEND_SIGNAL_KINDS) {
      this.generations[kind]++;
    }

    if (this.recordingReloadTimer !== null) {
      clearTimeout(this.recordingReloadTimer);
      this.recordingReloadTimer = null;
    }

    this.listeners.clear();
  }

  /*
   * Read A and read B of one kind. A starts at once; B starts as soon as
   * the kind's trace ids are known (for logs and exceptions that waits on
   * the grouped span read, which runs alongside A). A failure of A rejects
   * at once, without waiting for B (the caller turns it into a locked or
   * error slot, and a B not yet started is skipped). A failure of B
   * resolves to A's rows with the failure beside them. B is not sent when
   * the load went stale (dispose, or a newer load of the kind) while its
   * ids were being read: the response would only be dropped.
   */
  private async readKind<T extends AnalyticsBaseModel>(args: {
    kind: ReplayBackendSignalKind;
    generation: number;
    window: InBetween<Date>;
    build: (input: ReplayBackendQueryInput) => ReplayBackendListRequest<T>;
    timeOf: (row: T) => unknown;
    keyOf: (row: T) => string | null;
  }): Promise<ReplayBackendKindRead<T>> {
    const sessionRead: Promise<ListResult<T>> = this.fetchList<T>(
      args.build({ sessionId: this.sessionId, window: args.window }),
    );
    let hasSessionReadFailed: boolean = false;

    const traceRead: Promise<TraceReadOutcome<T>> = this.collectTraceIds(
      args.kind,
      args.window,
    )
      .then(async (traceIds: CappedTraceIds): Promise<TraceReadOutcome<T>> => {
        if (
          traceIds.ids.length === 0 ||
          hasSessionReadFailed ||
          !this.isCurrent(args.kind, args.generation)
        ) {
          return {
            ok: true,
            result: null,
            namedTraceIds: [],
            isTraceIdSetCapped: false,
          };
        }

        const result: ListResult<T> = await this.fetchList<T>(
          args.build({ traceIds: traceIds.ids, window: args.window }),
        );

        return {
          ok: true,
          result: result,
          namedTraceIds: traceIds.ids,
          isTraceIdSetCapped: traceIds.isCapped,
        };
      })
      .catch((error: unknown): TraceReadOutcome<T> => {
        return { ok: false, error: error };
      });

    let sessionResult: ListResult<T>;

    try {
      sessionResult = await sessionRead;
    } catch (error) {
      hasSessionReadFailed = true;
      throw error;
    }

    const trace: TraceReadOutcome<T> = await traceRead;

    if (!trace.ok) {
      return {
        ...mergeBackendRows<T>({
          sessionRead: sessionResult,
          traceRead: null,
          timeOf: args.timeOf,
          keyOf: args.keyOf,
        }),
        namedTraceIds: [],
        isTraceIdSetCapped: false,
        traceReadFailure: { error: trace.error },
      };
    }

    const merged: ReplayBackendMergedRows<T> = mergeBackendRows<T>({
      sessionRead: sessionResult,
      traceRead: trace.result,
      timeOf: args.timeOf,
      keyOf: args.keyOf,
    });

    return {
      rows: merged.rows,
      rowCount: merged.rowCount,
      isTruncated: merged.isTruncated || trace.isTraceIdSetCapped,
      namedTraceIds: trace.namedTraceIds,
      isTraceIdSetCapped: trace.isTraceIdSetCapped,
      traceReadFailure: null,
    };
  }

  /*
   * The slot a settled load publishes. Read B failing turns what would be
   * a ready slot into an error slot that still counts the rows it has (see
   * the class comment); a 403 on B alone stays ready, as no retry could
   * change it. Stamped with the load's start (see isBackendRefreshDue).
   */
  private settledSlot(
    kind: ReplayBackendSignalKind,
    read: ReplayBackendKindRead<AnalyticsBaseModel>,
    startedAtUnixMs: number,
  ): ReplayBackendSignalsSlot {
    const slot: ReplayBackendSignalsSlot = {
      status: "ready",
      rowCount: read.rowCount,
      isTruncated: read.isTruncated,
      ...(read.isTraceIdSetCapped ? { isTraceIdSetCapped: true } : {}),
      fetchedAtUnixMs: startedAtUnixMs,
    };

    if (
      read.traceReadFailure !== null &&
      classifyBackendSignalsFailure(read.traceReadFailure.error, kind)
        .status !== "locked"
    ) {
      slot.status = "error";
      slot.errorMessage = describePartialBackendSignalsFailure(
        read.traceReadFailure.error,
        kind,
      );
    }

    return slot;
  }

  /*
   * The ids read B names for a kind. Spans: recording then header ids -
   * spans stamped with the session id already arrive through read A.
   * Logs and exceptions: those plus the session's span-derived trace ids,
   * because a backend log is only ever reachable by its trace id. Capped
   * when the grouped span read was, or when the sources together hold
   * more ids than one read names.
   */
  private async collectTraceIds(
    kind: ReplayBackendSignalKind,
    window: InBetween<Date>,
  ): Promise<CappedTraceIds> {
    const sources: Array<ReadonlyArray<string>> = [
      this.recordingTraceIds,
      this.headerTraceIds,
    ];
    let isSessionReadCapped: boolean = false;

    if (kind !== "span") {
      const sessionTraceIds: CappedTraceIds =
        await this.readSessionTraceIds(window);

      sources.push(sessionTraceIds.ids);
      isSessionReadCapped = sessionTraceIds.isCapped;
    }

    const all: Array<string> = normalizeReplayTraceIds(
      sources,
      Number.POSITIVE_INFINITY,
    );

    return {
      ids: all.slice(0, REPLAY_BACKEND_TRACE_IDS_CAP),
      isCapped:
        isSessionReadCapped || all.length > REPLAY_BACKEND_TRACE_IDS_CAP,
    };
  }

  /*
   * The grouped span read, memoised: a read still in flight is shared by
   * every load that asks (the log and exception loads of one refresh or
   * one loadAll), and a finished one is reused while the window it covered
   * is unchanged - forever on a finalized session, never on a live one,
   * whose window end moves with "now". A failure is not remembered (the
   * next load tries again) unless it was a 403.
   */
  private readSessionTraceIds(
    window: InBetween<Date>,
  ): Promise<CappedTraceIds> {
    if (this.isSessionTraceIdsReadForbidden) {
      return Promise.resolve({ ids: [], isCapped: false });
    }

    const windowStartUnixMs: number = window.startValue.getTime();
    const windowEndUnixMs: number = window.endValue.getTime();
    const memo: SessionTraceIdsRead | null = this.sessionTraceIdsRead;

    if (
      memo &&
      memo.windowStartUnixMs === windowStartUnixMs &&
      (memo.isInFlight || memo.windowEndUnixMs === windowEndUnixMs)
    ) {
      return memo.promise;
    }

    let request: Promise<ListResult<Span>>;

    try {
      request = this.fetchList<Span>(
        buildSessionTraceIdsRequest({
          sessionId: this.sessionId,
          window: window,
        }),
      );
    } catch (error) {
      request = Promise.reject(error);
    }

    const read: SessionTraceIdsRead = {
      windowStartUnixMs: windowStartUnixMs,
      windowEndUnixMs: windowEndUnixMs,
      isInFlight: true,
      promise: Promise.resolve({ ids: [], isCapped: false }),
    };

    read.promise = request.then(
      (result: ListResult<Span>): CappedTraceIds => {
        read.isInFlight = false;

        const data: Array<Span> = Array.isArray(result?.data)
          ? result.data
          : [];

        return {
          ids: normalizeReplayTraceIds(
            [
              data.map((row: Span): unknown => {
                return row.traceId;
              }),
            ],
            REPLAY_BACKEND_SESSION_TRACE_IDS_LIMIT,
          ),
          isCapped: isSessionTraceIdListCapped(result),
        };
      },
      (error: unknown): CappedTraceIds => {
        read.isInFlight = false;

        if (this.sessionTraceIdsRead === read) {
          this.sessionTraceIdsRead = null;
        }

        if (readStatusCode(error) === 403) {
          this.isSessionTraceIdsReadForbidden = true;
        }

        return { ids: [], isCapped: false };
      },
    );

    this.sessionTraceIdsRead = read;

    return read.promise;
  }

  /*
   * True when some recording id that would make the cut was not named by
   * the kind's last read B. Recording ids lead the priority order, so the
   * first REPLAY_BACKEND_TRACE_IDS_CAP of them always make it.
   */
  private isMissingRecordingTraceIds(kind: ReplayBackendSignalKind): boolean {
    const named: Set<string> = this.namedTraceIds[kind];
    const count: number = Math.min(
      this.recordingTraceIds.length,
      REPLAY_BACKEND_TRACE_IDS_CAP,
    );

    for (let index: number = 0; index < count; index++) {
      if (!named.has(this.recordingTraceIds[index] as string)) {
        return true;
      }
    }

    return false;
  }

  private getRecordingReloadKinds(): Array<ReplayBackendSignalKind> {
    return REPLAY_BACKEND_SIGNAL_KINDS.filter(
      (kind: ReplayBackendSignalKind): boolean => {
        return (
          this.snapshot.slots[kind].status === "ready" &&
          this.isMissingRecordingTraceIds(kind)
        );
      },
    );
  }

  /* Some tab is still recording: new chunks, and new ids, keep coming. */
  private isFootageBeingRecorded(): boolean {
    return !this.isFinalized && this.isRecordingLive;
  }

  /*
   * (Re)starts the debounce; nothing to do while no ready slot is behind,
   * nor while footage is still being recorded - see
   * REPLAY_BACKEND_RECORDING_RELOAD_DEBOUNCE_MS.
   */
  private scheduleRecordingReload(): void {
    if (
      this.isDisposed ||
      this.isFootageBeingRecorded() ||
      this.getRecordingReloadKinds().length === 0
    ) {
      return;
    }

    if (this.recordingReloadTimer !== null) {
      clearTimeout(this.recordingReloadTimer);
    }

    this.recordingReloadTimer = setTimeout((): void => {
      this.recordingReloadTimer = null;

      if (this.isDisposed) {
        return;
      }

      for (const kind of this.getRecordingReloadKinds()) {
        void this.load(kind, { force: true });
      }
    }, REPLAY_BACKEND_RECORDING_RELOAD_DEBOUNCE_MS);
  }

  private isCurrent(
    kind: ReplayBackendSignalKind,
    generation: number,
  ): boolean {
    return !this.isDisposed && this.generations[kind] === generation;
  }

  private patchSlot(
    kind: ReplayBackendSignalKind,
    slot: ReplayBackendSignalsSlot,
  ): void {
    this.publish({
      slots: { ...this.snapshot.slots, [kind]: slot },
      rows: this.snapshot.rows,
    });
  }

  private publish(next: ReplayBackendSignalsSnapshot): void {
    this.snapshot = next;

    for (const listener of Array.from(this.listeners)) {
      listener(next);
    }
  }
}

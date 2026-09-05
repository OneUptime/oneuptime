import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import ModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import {
  REPLAY_BACKEND_SIGNALS_ROW_LIMIT,
  ReplayBackendSignalKind,
  ReplayBackendSignalsSlot,
  ReplayBackendSignalsState,
  makeIdleBackendSignalsSlot,
} from "./ReplaySignalTypes";

/*
 * Fetching the backend side of a session - its logs, spans and exception
 * instances - through the ordinary analytics model reads.
 *
 * WHY THESE READS AND NOT A DEDICATED ENDPOINT. The model ACLs already gate
 * Log / Span / ExceptionInstance per project role, the sessionId columns
 * carry bloom skip indexes, and the Logs and Traces pages use the same
 * reads, so the rail cannot show anything those pages would not. A 403
 * from a read therefore means exactly "this user lacks this permission",
 * which the rail renders as a locked tab naming it.
 *
 * WINDOWS. Each read is bounded to the session's [start, end] padded by a
 * few minutes on either side, because server stamps lag the browser and a
 * span that started before the first chunk was flushed still belongs to
 * this session. Live sessions have no end yet; "now" stands in.
 *
 * CAPS. Every read asks for REPLAY_BACKEND_SIGNALS_ROW_LIMIT rows; when it
 * comes back full the slot is flagged truncated and the rail defaults its
 * scope toggle to "+-30s around playhead", where 500 rows is plenty.
 *
 * GENERATIONS. A load bumps the slot's generation and captures it; a
 * response whose generation is no longer current (the store was disposed
 * or reloaded) is dropped on the floor rather than overwriting fresher
 * rows - the same guard the ChunkLoader uses for chunk fetches.
 */

/* Server stamps lag the recording; widen the window so nothing is clipped. */
export const REPLAY_BACKEND_SIGNALS_WINDOW_PADDING_MS: number = 5 * 60 * 1000;

/* Live sessions re-read their backend rows this often. */
export const REPLAY_BACKEND_SIGNALS_LIVE_REFRESH_MS: number = 60 * 1000;

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

export interface ReplayBackendListRequest<T extends AnalyticsBaseModel> {
  modelType: { new (): T };
  query: Query<T>;
  select: Select<T>;
  sort: Sort<T>;
  limit: number;
  skip: number;
}

export interface ReplayBackendQueryInput {
  sessionId: string;
  window: InBetween<Date>;
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
      sessionId: input.sessionId,
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
      sessionId: input.sessionId,
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
      sessionId: input.sessionId,
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

/* A finished slot older than the refresh interval, on a live session. */
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

  /* Session facts can arrive after construction (manifest refresh). */
  public setSessionBounds(args: {
    startTimeUnixMs?: number | undefined;
    endTimeUnixMs?: number | null | undefined;
    isFinalized?: boolean | undefined;
  }): void {
    if (typeof args.startTimeUnixMs === "number") {
      this.startTimeUnixMs = args.startTimeUnixMs;
    }

    if (args.endTimeUnixMs !== undefined) {
      this.endTimeUnixMs = args.endTimeUnixMs;
    }

    if (typeof args.isFinalized === "boolean") {
      this.isFinalized = args.isFinalized;
    }
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
     * Keep the previous rows visible during a refresh; a live rail that
     * blanks every 60s is worse than one that is a minute stale.
     */
    this.patchSlot(kind, {
      status: "loading",
      rowCount: current.rowCount,
      isTruncated: current.isTruncated,
      fetchedAtUnixMs: current.fetchedAtUnixMs,
    });

    const window: InBetween<Date> = this.getWindow();
    const queryInput: ReplayBackendQueryInput = {
      sessionId: this.sessionId,
      window: window,
    };

    try {
      let rowCount: number = 0;
      let isTruncated: boolean = false;
      let rows: ReplayBackendSignalsRows;

      if (kind === "log") {
        const result: ListResult<Log> = await this.fetchList<Log>(
          buildBackendLogsRequest(queryInput),
        );

        if (!this.isCurrent(kind, generation)) {
          return;
        }

        rows = { ...this.snapshot.rows, log: result.data };
        rowCount = result.data.length;
        isTruncated = ReplayBackendSignalsStore.isTruncated(result);
      } else if (kind === "span") {
        const result: ListResult<Span> = await this.fetchList<Span>(
          buildBackendSpansRequest(queryInput),
        );

        if (!this.isCurrent(kind, generation)) {
          return;
        }

        rows = { ...this.snapshot.rows, span: result.data };
        rowCount = result.data.length;
        isTruncated = ReplayBackendSignalsStore.isTruncated(result);
      } else {
        const result: ListResult<ExceptionInstance> =
          await this.fetchList<ExceptionInstance>(
            buildBackendExceptionsRequest(queryInput),
          );

        if (!this.isCurrent(kind, generation)) {
          return;
        }

        rows = { ...this.snapshot.rows, exception: result.data };
        rowCount = result.data.length;
        isTruncated = ReplayBackendSignalsStore.isTruncated(result);
      }

      this.publish({
        slots: {
          ...this.snapshot.slots,
          [kind]: {
            status: "ready",
            rowCount: rowCount,
            isTruncated: isTruncated,
            fetchedAtUnixMs: this.now(),
          },
        },
        rows: rows,
      });
    } catch (error) {
      if (!this.isCurrent(kind, generation)) {
        return;
      }

      const failure: ReplayBackendSignalsFailure =
        classifyBackendSignalsFailure(error, kind);
      const previous: ReplayBackendSignalsSlot = this.snapshot.slots[kind];

      if (failure.status === "locked") {
        this.patchSlot(kind, {
          status: "locked",
          rowCount: null,
          isTruncated: false,
          lockedPermission: failure.lockedPermission,
          fetchedAtUnixMs: this.now(),
        });
      } else {
        /* A failed refresh keeps the last good rows and count on screen. */
        this.patchSlot(kind, {
          status: "error",
          rowCount: previous.rowCount,
          isTruncated: previous.isTruncated,
          errorMessage: failure.errorMessage,
          fetchedAtUnixMs: this.now(),
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
   * Idle slots stay idle (a tab nobody opened is not fetched on a timer)
   * and locked slots stay locked (permissions do not change by the minute).
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

  /* Drops every in-flight response and stops notifying. */
  public dispose(): void {
    this.isDisposed = true;

    for (const kind of REPLAY_BACKEND_SIGNAL_KINDS) {
      this.generations[kind]++;
    }

    this.listeners.clear();
  }

  private static isTruncated<T extends AnalyticsBaseModel>(
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

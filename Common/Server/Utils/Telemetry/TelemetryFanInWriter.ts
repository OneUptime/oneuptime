import logger from "../Logger";
import Sleep from "../../../Types/Sleep";
import UUID from "../../../Utils/UUID";
import { JSONObject } from "../../../Types/JSON";
import GracefulShutdown, { ShutdownPriority } from "../GracefulShutdown";
import { nextInsertDedupToken } from "../AnalyticsDatabase/InsertDedupContext";
import { ClickHouseError, type ClickHouseSettings } from "@clickhouse/client";

/*
 * Re-exported so App-side code (which does not depend on @clickhouse/client
 * directly) can type fan-in submissions.
 */
export { type ClickHouseSettings } from "@clickhouse/client";

/*
 * Fan-in writer: the single funnel between the telemetry ingest workers and
 * ClickHouse.
 *
 * Problem it solves: each worker job used to insert its own row batches
 * directly, so fleet-wide concurrent-query demand scaled as
 * (pods × TELEMETRY_CONCURRENCY) and overran ClickHouse's
 * max_concurrent_queries once the worker fleet scaled out ("Too many
 * simultaneous queries. Maximum: 1000"). ClickHouse wants few fat inserts,
 * not thousands of thin concurrent ones.
 *
 * This component accumulates rows per table ACROSS jobs and flushes them as
 * large combined inserts through a small per-pod semaphore, so ClickHouse
 * sees (pods × maxConcurrentInserts) queries regardless of job concurrency.
 *
 * Delivery semantics — ack-after-flush with per-job retry idempotence:
 * - submit() resolves with a `flushed` promise that settles only when the
 *   rows have durably landed in ClickHouse (wait_for_async_insert=1) or
 *   definitively failed. Jobs await it before completing, so BullMQ retries
 *   any payload whose rows did not land.
 * - submit() captures a deterministic insert_deduplication_token from the
 *   ambient runWithInsertDedup context AT SUBMIT TIME (still inside the
 *   job's scope). Tokened submissions are inserted individually under that
 *   token — "<jobId>:<table>:<chunkIndex>", byte-identical when a BullMQ
 *   retry re-processes the same payload — so ClickHouse drops rows a prior
 *   attempt already landed. Merging them under one cross-job token would
 *   forfeit exactly that guarantee.
 * - Submissions arriving outside any dedup scope are merged into one insert
 *   under a minted per-batch token, unique per batch and reused only across
 *   the writer's own in-place retries of it. Either way, transient errors
 *   (overload, timeouts, network) retry with the SAME token, so an
 *   ambiguous failure whose rows actually landed never double-writes (the
 *   telemetry tables set non_replicated_deduplication_window).
 * - A submission is never split across batches, so an insert failure
 *   rejects exactly the submissions it contains and nothing else.
 *
 * Backpressure: awaiting submit() blocks while (buffered + in-flight) rows
 * are at maxPendingRows, bounding per-pod memory; the retry loop holds its
 * insert slot during backoff so a saturated ClickHouse is never offered more
 * concurrent load. Upstream, jobs slow down, the BullMQ queue absorbs the
 * backlog, and queue depth becomes the scale-out signal.
 *
 * Remote mode (unbounded worker scale-out): when TELEMETRY_WRITER_URL is
 * set, an insert transport (TelemetryWriterClient) replaces the direct
 * ClickHouse call and ships each token group to the dedicated
 * telemetry-writer tier over HTTP. ClickHouse then sees
 * (writerReplicas × maxConcurrentInserts) queries — a constant chosen by
 * the operator — no matter how many worker pods exist. Everything else
 * (dedup tokens, ack-after-flush, retries, backpressure) is unchanged; the
 * writer tier runs this same class with the default direct transport.
 */

export interface FanInInsertTarget {
  model: { tableName: string };
  insertJsonRows(
    rows: Array<JSONObject>,
    options?: {
      dedupToken?: string | undefined;
      clickhouseSettings?: ClickHouseSettings | undefined;
    },
  ): Promise<void>;
}

export interface FanInSubmitResult {
  /** Settles when the rows have durably landed in ClickHouse (or definitively failed). */
  flushed: Promise<void>;
}

/*
 * Pluggable delivery for one token group. The default transport inserts
 * directly into ClickHouse via target.insertJsonRows; the remote transport
 * (TelemetryWriterClient) ships the group to the telemetry-writer tier over
 * HTTP instead, so worker pods add no telemetry INSERT load to ClickHouse
 * and fleet-wide insert concurrency is bounded by the writer tier's size,
 * not by worker replica count. Transports signal "retry me with the same token"
 * by throwing TransientInsertError (or any error isRetryableInsertError
 * recognizes).
 */
export type FanInInsertTransport = (
  target: FanInInsertTarget,
  rows: Array<JSONObject>,
  options: {
    dedupToken: string;
    clickhouseSettings: ClickHouseSettings | undefined;
  },
) => Promise<void>;

export interface FanInWriterOptions {
  /** Target rows per ClickHouse insert. Buffers flush as soon as they reach this. */
  maxBatchRows: number;
  /** Max time rows sit buffered before a flush is forced, ms. */
  maxWaitMs: number;
  /** Per-pod cap on concurrent ClickHouse inserts across all tables. */
  maxConcurrentInserts: number;
  /** High-water mark of buffered+in-flight rows; submit() blocks above it. */
  maxPendingRows: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/*
 * Marker for transient failures raised by a pluggable insert transport
 * (e.g. the remote telemetry-writer client): overload shedding (HTTP 429),
 * writer-tier unavailability (503), or an ambiguous network failure. The
 * writer retries these with the SAME dedup token, so an ambiguous failure
 * whose rows actually landed never double-writes.
 */
export class TransientInsertError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TransientInsertError";
  }
}

export class FanInInsertError extends Error {
  /*
   * The final underlying failure, kept structured so the telemetry-writer
   * HTTP endpoint can map "gave up on a transient error" to 503 (caller
   * should retry with the same token) vs. a definitive failure to 500.
   */
  public readonly causeError: unknown;

  public constructor(data: {
    tableName: string;
    attempts: number;
    cause: unknown;
  }) {
    const causeMessage: string =
      data.cause instanceof Error ? data.cause.message : String(data.cause);
    super(
      `Fan-in insert into ${data.tableName} failed after ${data.attempts} attempt(s): ${causeMessage}`,
    );
    this.name = "FanInInsertError";
    this.causeError = data.cause;
    if (data.cause instanceof Error && data.cause.stack) {
      this.stack = `${this.stack}\nCaused by: ${data.cause.stack}`;
    }
  }
}

type PendingSubmission = {
  rows: Array<JSONObject>;
  clickhouseSettings: ClickHouseSettings | undefined;
  /*
   * Deterministic per-job dedup token captured at submit time from the
   * ambient runWithInsertDedup context ("<jobId>:<table>:<chunkIndex>"),
   * or undefined when submitted outside any job scope. Tokened submissions
   * are inserted individually under their token so a BullMQ job retry
   * re-issues byte-identical tokens and ClickHouse drops already-landed
   * rows; untokened ones are merged under a minted per-batch token.
   */
  dedupToken: string | undefined;
  resolveAck: () => void;
  rejectAck: (err: Error) => void;
};

type TableBuffer = {
  target: FanInInsertTarget;
  submissions: Array<PendingSubmission>;
  rowCount: number;
  timer: NodeJS.Timeout | null;
};

/*
 * ClickHouse server error codes that indicate transient overload or an
 * ambiguous outcome. All are safe to retry here because every insert
 * carries a dedup token that is stable across the writer's retries: a
 * retry of a block that actually landed is dropped server-side.
 *   202 TOO_MANY_SIMULTANEOUS_QUERIES, 209 SOCKET_TIMEOUT,
 *   210 NETWORK_ERROR, 241 MEMORY_LIMIT_EXCEEDED, 252 TOO_MANY_PARTS,
 *   319 UNKNOWN_STATUS_OF_INSERT
 * NOTE: the client exposes `code` as a STRING (e.g. "202").
 */
const RETRYABLE_CLICKHOUSE_CODES: Set<string> = new Set([
  "202",
  "209",
  "210",
  "241",
  "252",
  "319",
]);

const NUMERIC_ERROR_CODE_REGEX: RegExp = /^\d+$/;

const RETRYABLE_SOCKET_CODES: Set<string> = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
]);

export function isRetryableInsertError(err: unknown): boolean {
  if (err instanceof ClickHouseError) {
    return RETRYABLE_CLICKHOUSE_CODES.has(err.code);
  }

  if (err instanceof TransientInsertError) {
    return true;
  }

  if (err instanceof Error) {
    // Duck-typed TransientInsertError (duplicated module instances).
    if (err.name === "TransientInsertError") {
      return true;
    }
    const code: unknown = (err as unknown as JSONObject)["code"];
    if (typeof code === "string") {
      if (RETRYABLE_SOCKET_CODES.has(code)) {
        return true;
      }
      // Duck-typed ClickHouseError (in case of duplicated package instances).
      if (NUMERIC_ERROR_CODE_REGEX.test(code)) {
        return RETRYABLE_CLICKHOUSE_CODES.has(code);
      }
    }
    /*
     * @clickhouse/client surfaces its socket-idle request_timeout as a plain
     * Error("Timeout error."), with no code. The outcome is ambiguous (the
     * body may have been received), which is exactly what the per-batch dedup
     * token exists for — retry.
     */
    if (
      err.message.includes("Timeout error") ||
      err.message.includes("socket hang up")
    ) {
      return true;
    }
  }

  return false;
}

type EnvIntReader = (envKey: string, defaultValue: number) => number;

const readPositiveInt: EnvIntReader = (
  envKey: string,
  defaultValue: number,
): number => {
  const raw: string | undefined = process.env[envKey];
  if (!raw) {
    return defaultValue;
  }
  const parsed: number = parseInt(raw, 10);
  return !isNaN(parsed) && parsed > 0 ? parsed : defaultValue;
};

export function readFanInWriterOptionsFromEnv(): FanInWriterOptions {
  return {
    maxBatchRows: readPositiveInt("TELEMETRY_FANIN_MAX_BATCH_ROWS", 5000),
    maxWaitMs: readPositiveInt("TELEMETRY_FANIN_MAX_WAIT_MS", 1000),
    maxConcurrentInserts: readPositiveInt(
      "TELEMETRY_FANIN_MAX_CONCURRENT_INSERTS",
      4,
    ),
    maxPendingRows: readPositiveInt(
      "TELEMETRY_FANIN_MAX_PENDING_ROWS",
      100_000,
    ),
    retryMaxAttempts: readPositiveInt("TELEMETRY_FANIN_RETRY_MAX_ATTEMPTS", 6),
    retryBaseDelayMs: readPositiveInt(
      "TELEMETRY_FANIN_RETRY_BASE_DELAY_MS",
      250,
    ),
    retryMaxDelayMs: readPositiveInt(
      "TELEMETRY_FANIN_RETRY_MAX_DELAY_MS",
      10_000,
    ),
  };
}

export class TelemetryFanInWriter {
  private options: FanInWriterOptions;
  private buffers: Map<string, TableBuffer> = new Map();
  private pendingRows: number = 0;
  private capacityWaiters: Array<() => void> = [];
  private activeInserts: number = 0;
  private insertSlotWaiters: Array<() => void> = [];
  private inFlightDispatches: Set<Promise<void>> = new Set();
  /*
   * Submits that have been called but have not yet buffered their rows
   * (parked at the waitForCapacity await, or merely yielding its one
   * microtask). flushAll() must not conclude the drain while any exist —
   * their rows would land just after the final cut and strand.
   */
  private acceptingSubmits: number = 0;
  private shutdownHandlerRegistered: boolean = false;
  private insertTransport: FanInInsertTransport | null = null;

  public constructor(options: FanInWriterOptions) {
    this.options = options;
  }

  /*
   * Install (or clear, with null) a custom delivery transport for token
   * groups. Set once at boot when TELEMETRY_WRITER_URL is configured;
   * batching, dedup-token capture, the per-pod semaphore, retry/backoff,
   * and backpressure all stay in front of it unchanged.
   */
  public setInsertTransport(transport: FanInInsertTransport | null): void {
    this.insertTransport = transport;
  }

  public hasInsertTransport(): boolean {
    return this.insertTransport !== null;
  }

  /** Test hook: override options on the shared instance (e.g. shrink maxWaitMs). */
  public configure(partial: Partial<FanInWriterOptions>): void {
    this.options = { ...this.options, ...partial };
  }

  public getStats(): {
    bufferedRows: number;
    pendingRows: number;
    activeInserts: number;
  } {
    let bufferedRows: number = 0;
    for (const buffer of this.buffers.values()) {
      bufferedRows += buffer.rowCount;
    }
    return {
      bufferedRows,
      pendingRows: this.pendingRows,
      activeInserts: this.activeInserts,
    };
  }

  /*
   * Hand a batch of rows to the writer. Takes ownership of the `rows` array —
   * callers must not mutate it afterwards.
   *
   * Awaiting submit() itself is the backpressure point: it resolves once the
   * rows are accepted into the buffer (immediately under normal load, later
   * when the pod is at maxPendingRows). The returned `flushed` promise is the
   * durability ack — resolve it into the job's pending-ack list and await
   * before completing the job.
   *
   * All submitters of one table must pass identical clickhouseSettings: a
   * batch mixes submissions and applies the first submission's settings.
   */
  public async submit(
    target: FanInInsertTarget,
    rows: Array<JSONObject>,
    options?: {
      clickhouseSettings?: ClickHouseSettings | undefined;
      /*
       * Explicit dedup token for rows whose token was already captured
       * elsewhere — the telemetry-writer endpoint passes through the token
       * the worker-side writer minted/captured, since no ambient
       * runWithInsertDedup scope exists in an HTTP handler.
       */
      dedupToken?: string | undefined;
    },
  ): Promise<FanInSubmitResult> {
    if (!rows || rows.length === 0) {
      return { flushed: Promise.resolve() };
    }

    this.registerShutdownHandlerOnce();

    const tableName: string = target.model.tableName;

    /*
     * Capture the deterministic per-job dedup token NOW, synchronously in
     * the caller's flow: submit() runs inside the job's runWithInsertDedup
     * scope, while the dispatch that eventually inserts these rows runs on
     * a timer with no ambient context. Capturing before any await also
     * keeps token order deterministic across retries of the same payload.
     */
    const dedupToken: string | undefined =
      options?.dedupToken ?? nextInsertDedupToken(tableName);

    this.acceptingSubmits++;
    try {
      await this.waitForCapacity();

      let buffer: TableBuffer | undefined = this.buffers.get(tableName);
      if (!buffer) {
        buffer = {
          target,
          submissions: [],
          rowCount: 0,
          timer: null,
        };
        this.buffers.set(tableName, buffer);
      }

      let resolveAck: () => void = () => {};
      let rejectAck: (err: Error) => void = () => {};
      const flushed: Promise<void> = new Promise<void>(
        (resolve: () => void, reject: (err: Error) => void) => {
          resolveAck = resolve;
          rejectAck = reject;
        },
      );

      buffer.submissions.push({
        rows,
        clickhouseSettings: options?.clickhouseSettings,
        dedupToken,
        resolveAck,
        rejectAck,
      });
      buffer.rowCount += rows.length;
      this.pendingRows += rows.length;

      if (buffer.rowCount >= this.options.maxBatchRows) {
        this.cutAndDispatch(tableName, false);
      } else if (!buffer.timer) {
        buffer.timer = setTimeout(() => {
          const timedBuffer: TableBuffer | undefined =
            this.buffers.get(tableName);
          if (timedBuffer) {
            timedBuffer.timer = null;
          }
          this.cutAndDispatch(tableName, true);
        }, this.options.maxWaitMs);
        /*
         * Never keep the process alive just for a pending flush timer —
         * graceful shutdown drains buffers explicitly.
         */
        buffer.timer.unref?.();
      }

      return { flushed };
    } finally {
      this.acceptingSubmits--;
    }
  }

  /** Force-flush everything buffered and wait for all in-flight inserts to settle. */
  public async flushAll(): Promise<void> {
    /*
     * Dispatch promises never reject (failures are routed to submission
     * acks), so a plain all() is safe. Re-cut on EVERY pass: a submit
     * parked in waitForCapacity() resumes when a completing dispatch
     * releases capacity — scheduled BEFORE the dispatch promise's own
     * reactions — and buffers its rows WITHOUT creating a dispatch when
     * they are below maxBatchRows (its flush timer is unref'd and will
     * never fire before process exit). Waiting on inFlightDispatches alone
     * would therefore return with those rows stranded. Exit only when a
     * fresh cut pass leaves nothing in flight and no submit is still
     * mid-acceptance; the microtask yield lets a not-yet-buffered submit
     * (parked only on waitForCapacity's fast-path await) land its rows so
     * the next pass picks them up.
     */
    for (;;) {
      for (const tableName of Array.from(this.buffers.keys())) {
        this.cutAndDispatch(tableName, true);
      }

      if (this.inFlightDispatches.size > 0) {
        await Promise.all(Array.from(this.inFlightDispatches));
        continue;
      }

      if (this.acceptingSubmits === 0) {
        return;
      }

      await Promise.resolve();
    }
  }

  private registerShutdownHandlerOnce(): void {
    if (this.shutdownHandlerRegistered) {
      return;
    }
    this.shutdownHandlerRegistered = true;
    GracefulShutdown.registerHandler(
      "TelemetryFanInWriter",
      ShutdownPriority.Buffers,
      async () => {
        await this.flushAll();
      },
    );
  }

  private async waitForCapacity(): Promise<void> {
    while (this.pendingRows >= this.options.maxPendingRows) {
      await new Promise<void>((resolve: () => void) => {
        this.capacityWaiters.push(resolve);
      });
    }
  }

  private releaseCapacity(): void {
    /*
     * Wake all waiters; each re-checks the high-water mark in its
     * waitForCapacity loop, so overshoot stays bounded to one submission
     * per waiter.
     */
    const waiters: Array<() => void> = this.capacityWaiters;
    this.capacityWaiters = [];
    for (const wake of waiters) {
      wake();
    }
  }

  private async acquireInsertSlot(): Promise<void> {
    while (this.activeInserts >= this.options.maxConcurrentInserts) {
      await new Promise<void>((resolve: () => void) => {
        this.insertSlotWaiters.push(resolve);
      });
    }
    this.activeInserts++;
  }

  private releaseInsertSlot(): void {
    this.activeInserts--;
    const next: (() => void) | undefined = this.insertSlotWaiters.shift();
    if (next) {
      next();
    }
  }

  /*
   * Cut batches from a table buffer and dispatch them. When `drain` is false,
   * only full batches (>= maxBatchRows) are cut — the remainder keeps waiting
   * for more rows or the timer. When true, everything goes.
   *
   * A batch is a FIFO run of WHOLE submissions packed up to maxBatchRows
   * (a single oversized submission forms its own batch), so an insert failure
   * maps 1:1 onto the submissions it contained.
   */
  private cutAndDispatch(tableName: string, drain: boolean): void {
    const buffer: TableBuffer | undefined = this.buffers.get(tableName);
    if (!buffer) {
      return;
    }

    while (
      buffer.rowCount >= this.options.maxBatchRows ||
      (drain && buffer.rowCount > 0)
    ) {
      const batch: Array<PendingSubmission> = [];
      let batchRows: number = 0;

      while (buffer.submissions.length > 0) {
        const next: PendingSubmission = buffer.submissions[0]!;
        if (
          batch.length > 0 &&
          batchRows + next.rows.length > this.options.maxBatchRows
        ) {
          break;
        }
        buffer.submissions.shift();
        batch.push(next);
        batchRows += next.rows.length;
        if (batchRows >= this.options.maxBatchRows) {
          break;
        }
      }

      if (batch.length === 0) {
        break;
      }

      buffer.rowCount -= batchRows;

      const dispatch: Promise<void> = this.dispatchInsert(
        buffer.target,
        tableName,
        batch,
        batchRows,
      );
      this.inFlightDispatches.add(dispatch);
      dispatch.finally(() => {
        this.inFlightDispatches.delete(dispatch);
      });
    }

    if (buffer.rowCount === 0 && buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }
  }

  /*
   * Insert one batch while holding a single insert slot. Submissions that
   * carry a deterministic per-job dedup token are inserted INDIVIDUALLY
   * under their own token — this is what keeps BullMQ job retries
   * duplicate-free: the retry re-derives byte-identical tokens and
   * ClickHouse drops blocks a prior attempt already landed. Merging them
   * under one shared cross-job token would break that (a token dedups by
   * token, not content, so a differently-composed block under a reused
   * token would silently drop other jobs' rows — the same hazard that kept
   * the probe paths off dedup tokens historically). Untokened submissions
   * are merged into one insert under a minted per-batch token.
   *
   * The tokened inserts run sequentially within this one slot, so the
   * per-pod concurrency cap — the property that fixes the
   * max_concurrent_queries incident — is unaffected; only the statement
   * count returns to master's per-chunk granularity, and ClickHouse's
   * async-insert coalescing (async_insert=1) still assembles fat parts
   * server-side.
   *
   * Never rejects — outcomes are routed to the submissions' acks.
   */
  private async dispatchInsert(
    target: FanInInsertTarget,
    tableName: string,
    batch: Array<PendingSubmission>,
    batchRows: number,
  ): Promise<void> {
    await this.acquireInsertSlot();

    try {
      const untokened: Array<PendingSubmission> = [];

      for (const submission of batch) {
        if (submission.dedupToken) {
          await this.insertGroupWithRetry(
            target,
            tableName,
            [submission],
            submission.dedupToken,
          );
        } else {
          untokened.push(submission);
        }
      }

      if (untokened.length > 0) {
        await this.insertGroupWithRetry(
          target,
          tableName,
          untokened,
          `fanin:${tableName}:${UUID.generateTimeOrdered()}`,
        );
      }
    } finally {
      this.pendingRows -= batchRows;
      this.releaseCapacity();
      this.releaseInsertSlot();
    }
  }

  /*
   * Insert one token group, retrying transient failures with full-jitter
   * exponential backoff and the SAME dedup token — an ambiguous failure
   * (timeout, connection reset) whose rows actually landed is dropped
   * server-side on the retry. The insert slot is held across backoff sleeps
   * on purpose: when ClickHouse is saturated, offering it MORE concurrent
   * load from this pod is the failure mode this component exists to
   * prevent. Never rejects — outcomes are routed to the group's acks, so
   * one group's definitive failure does not fail the batch's other groups.
   */
  private async insertGroupWithRetry(
    target: FanInInsertTarget,
    tableName: string,
    group: Array<PendingSubmission>,
    dedupToken: string,
  ): Promise<void> {
    const rows: Array<JSONObject> = [];
    for (const submission of group) {
      for (const row of submission.rows) {
        rows.push(row);
      }
    }

    const clickhouseSettings: ClickHouseSettings | undefined =
      group[0]?.clickhouseSettings;
    const sleep: (ms: number) => Promise<void> =
      this.options.sleep ??
      ((ms: number): Promise<void> => {
        return Sleep.sleep(ms);
      });

    let lastError: unknown = null;
    let attemptsMade: number = 0;

    for (
      let attempt: number = 1;
      attempt <= this.options.retryMaxAttempts;
      attempt++
    ) {
      attemptsMade = attempt;
      try {
        if (this.insertTransport) {
          await this.insertTransport(target, rows, {
            dedupToken,
            clickhouseSettings,
          });
        } else {
          await target.insertJsonRows(rows, {
            dedupToken,
            clickhouseSettings,
          });
        }

        for (const submission of group) {
          submission.resolveAck();
        }
        if (attempt > 1) {
          logger.info(
            `TelemetryFanInWriter: insert into ${tableName} (${rows.length} rows) succeeded on attempt ${attempt}.`,
          );
        }
        return;
      } catch (err) {
        lastError = err;

        if (
          !isRetryableInsertError(err) ||
          attempt === this.options.retryMaxAttempts
        ) {
          break;
        }

        const expDelay: number = Math.min(
          this.options.retryMaxDelayMs,
          this.options.retryBaseDelayMs * Math.pow(2, attempt - 1),
        );
        const jitteredDelay: number = Math.ceil(Math.random() * expDelay);
        logger.warn(
          `TelemetryFanInWriter: transient insert failure on ${tableName} (${rows.length} rows, attempt ${attempt}/${this.options.retryMaxAttempts}); retrying with the same dedup token in ${jitteredDelay}ms: ${err instanceof Error ? err.message : String(err)}`,
        );
        await sleep(jitteredDelay);
      }
    }

    const finalError: FanInInsertError = new FanInInsertError({
      tableName,
      attempts: attemptsMade,
      cause: lastError,
    });
    logger.error(
      `TelemetryFanInWriter: giving up on insert into ${tableName} (${rows.length} rows); failing ${group.length} submission(s).`,
    );
    logger.error(finalError);
    for (const submission of group) {
      submission.rejectAck(finalError);
    }
  }
}

/*
 * Register a durability ack on a job's pending-ack list, wrapped in the
 * service's storage error class and pre-observed: a mid-job batch failure
 * would otherwise reject the stored promise long before the job's final
 * `await Promise.all(pendingAcks)` reaches it, firing the process-level
 * unhandledRejection logger once per ack. The no-op catch marks the promise
 * handled without swallowing anything — the rejection is still delivered at
 * the job's await point, failing the job so BullMQ retries the payload.
 */
export function pushObservedAck(
  pendingAcks: Array<Promise<void>>,
  flushed: Promise<void>,
  wrapError: (err: Error) => Error,
): void {
  const ack: Promise<void> = flushed.catch((error: Error) => {
    throw wrapError(error);
  });
  ack.catch(() => {
    // Pre-observed; delivered for real at the job's await point.
  });
  pendingAcks.push(ack);
}

const defaultWriter: TelemetryFanInWriter = new TelemetryFanInWriter(
  readFanInWriterOptionsFromEnv(),
);

export default defaultWriter;

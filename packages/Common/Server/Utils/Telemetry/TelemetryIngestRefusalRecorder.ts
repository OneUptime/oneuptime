import ObjectID from "../../../Types/ObjectID";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ProjectBlockedException from "../../../Types/Exception/ProjectBlockedException";
import {
  TelemetryIngestRefusalReason,
  UNNAMED_TELEMETRY_INGEST_SURFACE,
} from "../../../Types/Telemetry/TelemetryIngestRefusal";
import TelemetryIngestSurface from "../../../Types/Telemetry/TelemetryIngestSurface";
import TelemetryIngestionKeyRefusalService, {
  TelemetryIngestRefusalBatch,
} from "../../Services/TelemetryIngestionKeyRefusalService";
import logger from "../Logger";

/*
 * COUNTS THE TELEMETRY THE INGEST GUARDS REFUSE, PER KEY, REASON AND
 * SURFACE (issue #6378), without a write per refused request.
 *
 * A refused sender keeps sending: an exporter retries, a page loads again,
 * a collector flushes every few seconds. Writing on every refusal would put
 * a Postgres write behind every request a flood sends - the one moment the
 * database most needs to be left alone. So refusals are counted here, in
 * memory, and written in batches:
 *
 *   - a (key, reason, surface) not written in the past
 *     REFUSAL_WRITE_INTERVAL_MS is written REFUSAL_WRITE_DELAY_MS after its
 *     first refusal, so the setup check can say "refused" while the reader
 *     is still looking;
 *   - after that, its refusals only add to the count in memory until the
 *     interval since its last write is over, and are written then.
 *
 * One timer serves every count, and each write takes everything that is due
 * as ONE batch (TelemetryIngestionKeyRefusalService.addRefusals: one
 * statement per 500 rows). Writes start at least REFUSAL_WRITE_DELAY_MS
 * apart and never overlap, and a (key, reason, surface) is in at most two of
 * them per interval - so N ingest processes add to a row at most 2N times
 * per interval, whatever the flood. Nothing here throws to its caller or
 * waits on the database: a refusal is answered at the same speed, and a
 * write that fails costs that batch's counts, not the response.
 *
 * Only a key that resolved is counted: a missing or unknown token names no
 * project, so it is counted nowhere (the sender's 401 and the server's
 * "Invalid service token." log line are what an operator has of it). What
 * is held in memory is bounded anyway - only real keys reach it, but "the
 * input is trusted" is the assumption that ages worst.
 */

// How often a (key, reason, surface) refused again and again is written.
export const REFUSAL_WRITE_INTERVAL_MS: number = 5 * 60 * 1000;

/*
 * The soonest a write follows a refusal, and the least time between two
 * writes: what falls due within it goes in the same one.
 */
export const REFUSAL_WRITE_DELAY_MS: number = 1000;

/*
 * Distinct (key, reason, surface) counts held between writes, per process,
 * and as many marks of when each was last written.
 */
export const MAX_PENDING_REFUSALS: number = 5000;

// A failed write or a full count is logged at most this often.
const LOG_INTERVAL_MS: number = 60 * 1000;

export interface TelemetryIngestRefusalKey {
  projectId: ObjectID;
  ingestionKeyId: ObjectID;
}

export interface TelemetryIngestRefusalRecord
  extends TelemetryIngestRefusalKey {
  reason: TelemetryIngestRefusalReason;
  // null for the legacy guard, which names no surface.
  surface: TelemetryIngestSurface | null;
}

interface PendingRefusal {
  projectId: ObjectID;
  ingestionKeyId: ObjectID;
  reason: TelemetryIngestRefusalReason;
  surface: string;
  count: number;
  // ms since the epoch: no Date is made per refusal.
  firstRefusedAt: number;
  lastRefusedAt: number;
}

export type TelemetryIngestRefusalWriter = (
  batches: Array<TelemetryIngestRefusalBatch>,
) => Promise<void>;

export class TelemetryIngestRefusalCounter {
  private pending: Map<string, PendingRefusal> = new Map();

  // When each (key, reason, surface) was last written, oldest first.
  private lastWrittenAt: Map<string, number> = new Map();

  private timer: ReturnType<typeof setTimeout> | null = null;

  // When the armed timer fires (ms since the epoch).
  private timerDueAt: number = Number.POSITIVE_INFINITY;

  // The write in flight: one at a time.
  private writing: Promise<void> | null = null;

  private lastFailureLoggedAt: number = Number.NEGATIVE_INFINITY;

  private lastOverflowLoggedAt: number = Number.NEGATIVE_INFINITY;

  public constructor(
    private writer: TelemetryIngestRefusalWriter,
    private now: () => number = (): number => {
      return Date.now();
    },
  ) {}

  /*
   * Count one refused request. Never throws, never waits: the refusal is
   * answered whatever happens here.
   */
  public record(data: TelemetryIngestRefusalRecord): void {
    try {
      if (!data.projectId || !data.ingestionKeyId) {
        return;
      }

      const surface: string = data.surface || UNNAMED_TELEMETRY_INGEST_SURFACE;
      const id: string = `${data.ingestionKeyId.toString()}|${data.reason}|${surface}`;
      const nowMs: number = this.now();

      let entry: PendingRefusal | undefined = this.pending.get(id);

      if (!entry) {
        if (this.pending.size >= MAX_PENDING_REFUSALS) {
          this.logOverflow(nowMs);
          return;
        }

        entry = {
          projectId: data.projectId,
          ingestionKeyId: data.ingestionKeyId,
          reason: data.reason,
          surface,
          count: 0,
          firstRefusedAt: nowMs,
          lastRefusedAt: nowMs,
        };
        this.pending.set(id, entry);
      }

      entry.count += 1;
      entry.lastRefusedAt = nowMs;

      this.armTimer(this.getDueAt(id, nowMs), nowMs);
    } catch (err) {
      // Counting must never be what turns a refusal into a 500.
      logger.warn("TelemetryIngestRefusalRecorder: could not count a refusal");
      logger.warn(err);
    }
  }

  // Write everything still counted, due or not, and wait for it: shutdown, and tests.
  public async flushAll(): Promise<void> {
    while (this.writing) {
      await this.writing;
    }

    await this.write({ all: true });
  }

  public getPendingCount(): number {
    return this.pending.size;
  }

  public reset(): void {
    this.clearTimer();
    this.pending.clear();
    this.lastWrittenAt.clear();
    this.writing = null;
    this.lastFailureLoggedAt = Number.NEGATIVE_INFINITY;
    this.lastOverflowLoggedAt = Number.NEGATIVE_INFINITY;
  }

  // When a (key, reason, surface) may be written next: an interval after its last write.
  private getDueAt(id: string, nowMs: number): number {
    const writtenAt: number | undefined = this.lastWrittenAt.get(id);

    return writtenAt === undefined
      ? nowMs
      : writtenAt + REFUSAL_WRITE_INTERVAL_MS;
  }

  /*
   * Take what is due (everything, with `all`) out of the counts and write
   * it as one batch. While a write is in flight nothing more is taken: it
   * arms the timer for what is left when it ends.
   */
  private write(data: { all: boolean }): Promise<void> {
    if (this.writing) {
      return this.writing;
    }

    const nowMs: number = this.now();
    const batches: Array<TelemetryIngestRefusalBatch> = [];

    for (const [id, entry] of this.pending) {
      if (!data.all && this.getDueAt(id, nowMs) > nowMs) {
        continue;
      }

      this.pending.delete(id);

      // Kept oldest first, so pruning stops at the first one still in its interval.
      this.lastWrittenAt.delete(id);
      this.lastWrittenAt.set(id, nowMs);

      batches.push({
        projectId: entry.projectId,
        telemetryIngestionKeyId: entry.ingestionKeyId,
        reason: entry.reason,
        surface: entry.surface,
        count: entry.count,
        firstRefusedAt: new Date(entry.firstRefusedAt),
        lastRefusedAt: new Date(entry.lastRefusedAt),
      });
    }

    this.pruneWrittenMarks(nowMs);

    if (batches.length === 0) {
      this.armTimerForPending(nowMs);
      return Promise.resolve();
    }

    let write: Promise<void>;

    try {
      write = this.writer(batches);
    } catch (err) {
      write = Promise.reject(err);
    }

    const settled: Promise<void> = write
      .catch((err: unknown) => {
        /*
         * Lost, not retried: the key may be gone (its rows went with it),
         * or the database is down and a retry would only add to its load.
         * The next refusal starts a new count.
         */
        this.logWriteFailure(err);
      })
      .then(() => {
        if (this.writing === settled) {
          this.writing = null;
          this.armTimerForPending(this.now());
        }
      });

    this.writing = settled;

    return settled;
  }

  /*
   * Marks older than an interval say nothing any more; dropping them keeps
   * the map to the (key, reason, surface) written lately, and the bound
   * keeps it there even when that is many (a dropped mark only lets its
   * count go in an earlier write).
   */
  private pruneWrittenMarks(nowMs: number): void {
    for (const [id, writtenAt] of this.lastWrittenAt) {
      if (
        nowMs - writtenAt < REFUSAL_WRITE_INTERVAL_MS &&
        this.lastWrittenAt.size <= MAX_PENDING_REFUSALS
      ) {
        break;
      }

      this.lastWrittenAt.delete(id);
    }
  }

  // Arm the timer for the count that falls due first, after a write.
  private armTimerForPending(nowMs: number): void {
    let dueAt: number = Number.POSITIVE_INFINITY;

    for (const id of this.pending.keys()) {
      dueAt = Math.min(dueAt, this.getDueAt(id, nowMs));
    }

    if (dueAt !== Number.POSITIVE_INFINITY) {
      this.armTimer(dueAt, nowMs);
    }
  }

  /*
   * Have the timer fire by dueAt, and no sooner than REFUSAL_WRITE_DELAY_MS
   * from now. It is moved earlier when a count falls due before it, never
   * later, so a refusal costs one lookup however many counts are waiting.
   */
  private armTimer(dueAt: number, nowMs: number): void {
    const fireAt: number = Math.max(dueAt, nowMs + REFUSAL_WRITE_DELAY_MS);

    if (this.timer && this.timerDueAt <= fireAt) {
      return;
    }

    this.clearTimer();
    this.timerDueAt = fireAt;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.timerDueAt = Number.POSITIVE_INFINITY;
      // write() logs its own failures.
      void this.write({ all: false });
    }, fireAt - nowMs);

    // A pending count must not keep a process (or a test) alive.
    if (typeof this.timer === "object" && this.timer && "unref" in this.timer) {
      this.timer.unref();
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.timerDueAt = Number.POSITIVE_INFINITY;
  }

  private logWriteFailure(err: unknown): void {
    const nowMs: number = this.now();

    if (nowMs - this.lastFailureLoggedAt < LOG_INTERVAL_MS) {
      return;
    }

    this.lastFailureLoggedAt = nowMs;
    logger.warn(
      "TelemetryIngestRefusalRecorder: could not write refused telemetry counts",
    );
    logger.warn(err);
  }

  private logOverflow(nowMs: number): void {
    if (nowMs - this.lastOverflowLoggedAt < LOG_INTERVAL_MS) {
      return;
    }

    this.lastOverflowLoggedAt = nowMs;
    logger.warn(
      `TelemetryIngestRefusalRecorder: ${MAX_PENDING_REFUSALS} refusal counts are waiting to be written; not counting more until they are`,
    );
  }
}

/*
 * The key a billing refusal was thrown for. TelemetryIngestionKeyService
 * throws PaymentRequiredException and ProjectBlockedException while it
 * resolves a key, so the caller that catches one never holds the policy;
 * the service notes it on the exception for the caller to count.
 */
const refusedKeys: WeakMap<Error, TelemetryIngestRefusalKey> = new WeakMap();

export function noteTelemetryIngestRefusalKey(
  err: unknown,
  key: TelemetryIngestRefusalKey,
): void {
  if (err instanceof Error) {
    refusedKeys.set(err, key);
  }
}

export function getTelemetryIngestRefusalKey(
  err: unknown,
): TelemetryIngestRefusalKey | null {
  if (!(err instanceof Error)) {
    return null;
  }

  return refusedKeys.get(err) || null;
}

// The reason a billing exception refuses telemetry under, or null.
export function getTelemetryIngestBillingRefusalReason(
  err: unknown,
): TelemetryIngestRefusalReason | null {
  if (err instanceof ProjectBlockedException) {
    return TelemetryIngestRefusalReason.ProjectBlocked;
  }

  if (err instanceof PaymentRequiredException) {
    return TelemetryIngestRefusalReason.PaymentRequired;
  }

  return null;
}

const TelemetryIngestRefusalRecorder: TelemetryIngestRefusalCounter =
  new TelemetryIngestRefusalCounter(
    (batches: Array<TelemetryIngestRefusalBatch>): Promise<void> => {
      return TelemetryIngestionKeyRefusalService.addRefusals(batches);
    },
  );

/*
 * Count a billing refusal (an exception key resolution threw), when the key
 * it was thrown for is known. Returns whether it was counted.
 */
export function recordTelemetryIngestBillingRefusal(data: {
  err: unknown;
  surface: TelemetryIngestSurface | null;
  counter?: TelemetryIngestRefusalCounter | undefined;
}): boolean {
  const reason: TelemetryIngestRefusalReason | null =
    getTelemetryIngestBillingRefusalReason(data.err);
  const key: TelemetryIngestRefusalKey | null = getTelemetryIngestRefusalKey(
    data.err,
  );

  if (!reason || !key) {
    return false;
  }

  (data.counter || TelemetryIngestRefusalRecorder).record({
    projectId: key.projectId,
    ingestionKeyId: key.ingestionKeyId,
    reason,
    surface: data.surface,
  });

  return true;
}

export default TelemetryIngestRefusalRecorder;

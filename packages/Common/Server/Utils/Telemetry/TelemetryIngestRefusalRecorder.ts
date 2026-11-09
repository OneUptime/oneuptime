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
 * memory, and written as one upsert per (key, reason, surface) at most once
 * per REFUSAL_WRITE_INTERVAL_MS per process:
 *
 *   - the first refusal of a (key, reason, surface) is written at once, so
 *     the setup check can say "refused" while the reader is still looking;
 *   - every refusal after it, inside the interval, only adds to the count
 *     in memory, and one timer writes what gathered when the interval ends.
 *
 * N ingest processes write at most N times per interval per key, reason and
 * surface, whatever the flood. Nothing here throws to its caller or waits on
 * the database: a refusal is answered at the same speed, and a write that
 * fails costs that batch's count, not the response.
 *
 * Only a key that resolved is counted: a missing or unknown token names no
 * project, so it is counted nowhere (the sender's 401 and the server's
 * "Invalid service token." log line are what an operator has of it). The
 * pending map is bounded anyway - only real keys reach it, but "the input
 * is trusted" is the assumption that ages worst.
 */

export const REFUSAL_WRITE_INTERVAL_MS: number = 5 * 60 * 1000;

// Distinct (key, reason, surface) counts held between writes, per process.
export const MAX_PENDING_REFUSALS: number = 5000;

// A failed write is logged at most this often: a database outage fails them all.
const WRITE_FAILURE_LOG_INTERVAL_MS: number = 60 * 1000;

// The smallest wait the timer is armed with, so it never spins.
const MIN_TIMER_DELAY_MS: number = 1000;

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
  firstRefusedAt: Date;
  lastRefusedAt: Date;
}

export type TelemetryIngestRefusalWriter = (
  batch: TelemetryIngestRefusalBatch,
) => Promise<void>;

export class TelemetryIngestRefusalCounter {
  private pending: Map<string, PendingRefusal> = new Map();

  // When each (key, reason, surface) was last written, oldest first.
  private lastWrittenAt: Map<string, number> = new Map();

  private timer: ReturnType<typeof setTimeout> | null = null;

  // When the armed timer fires (ms since the epoch).
  private timerDueAt: number = Number.POSITIVE_INFINITY;

  private lastFailureLoggedAt: number = Number.NEGATIVE_INFINITY;

  private lastOverflowLoggedAt: number = Number.NEGATIVE_INFINITY;

  public constructor(
    private writer: TelemetryIngestRefusalWriter,
    private now: () => number = Date.now,
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
      const at: Date = new Date(nowMs);

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
          firstRefusedAt: at,
          lastRefusedAt: at,
        };
        this.pending.set(id, entry);
      }

      entry.count += 1;
      entry.lastRefusedAt = at;

      if (this.isWriteDue(id, nowMs)) {
        void this.writeOne(id, nowMs);
        return;
      }

      this.armTimer(this.getDueAt(id, nowMs), nowMs);
    } catch (err) {
      // Counting must never be what turns a refusal into a 500.
      logger.warn("TelemetryIngestRefusalRecorder: could not count a refusal");
      logger.warn(err);
    }
  }

  // Write everything still pending: shutdown, and tests.
  public async flushAll(): Promise<void> {
    this.clearTimer();

    const writes: Array<Promise<void>> = [];
    const nowMs: number = this.now();

    for (const id of Array.from(this.pending.keys())) {
      writes.push(this.writeOne(id, nowMs));
    }

    await Promise.all(writes);
  }

  public getPendingCount(): number {
    return this.pending.size;
  }

  public reset(): void {
    this.clearTimer();
    this.pending.clear();
    this.lastWrittenAt.clear();
    this.lastFailureLoggedAt = Number.NEGATIVE_INFINITY;
    this.lastOverflowLoggedAt = Number.NEGATIVE_INFINITY;
  }

  private isWriteDue(id: string, nowMs: number): boolean {
    return this.getDueAt(id, nowMs) <= nowMs;
  }

  // When a (key, reason, surface) may be written next: an interval after its last write.
  private getDueAt(id: string, nowMs: number): number {
    const writtenAt: number | undefined = this.lastWrittenAt.get(id);

    return writtenAt === undefined
      ? nowMs
      : writtenAt + REFUSAL_WRITE_INTERVAL_MS;
  }

  private writeOne(id: string, nowMs: number): Promise<void> {
    const entry: PendingRefusal | undefined = this.pending.get(id);

    if (!entry) {
      return Promise.resolve();
    }

    this.pending.delete(id);

    // Kept oldest first, so pruning stops at the first one still in its interval.
    this.lastWrittenAt.delete(id);
    this.lastWrittenAt.set(id, nowMs);
    this.pruneWrittenMarks(nowMs);

    let write: Promise<void>;

    try {
      write = this.writer({
        projectId: entry.projectId,
        telemetryIngestionKeyId: entry.ingestionKeyId,
        reason: entry.reason,
        surface: entry.surface,
        count: entry.count,
        firstRefusedAt: entry.firstRefusedAt,
        lastRefusedAt: entry.lastRefusedAt,
      });
    } catch (err) {
      write = Promise.reject(err);
    }

    return write.catch((err: unknown) => {
      /*
       * Lost, not retried: the key may be gone (its rows went with it), or
       * the database is down and a retry would only add to its load. The
       * next refusal starts a new count.
       */
      this.logWriteFailure(err);
    });
  }

  /*
   * Marks older than an interval say nothing any more; dropping them keeps
   * the map to the (key, reason, surface) refused lately, and the bound
   * keeps it there even when that is many.
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

  /*
   * Have the timer fire by dueAt. One timer serves every pending count: it
   * is moved earlier when a count falls due before it, never later, so a
   * refusal costs one lookup however many counts are waiting.
   */
  private armTimer(dueAt: number, nowMs: number): void {
    const fireAt: number = Math.max(dueAt, nowMs + MIN_TIMER_DELAY_MS);

    if (this.timer && this.timerDueAt <= fireAt) {
      return;
    }

    this.clearTimer();
    this.timerDueAt = fireAt;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.timerDueAt = Number.POSITIVE_INFINITY;
      this.writeDue();
    }, fireAt - nowMs);

    // A pending count must not keep a process (or a test) alive.
    if (typeof this.timer === "object" && this.timer && "unref" in this.timer) {
      this.timer.unref();
    }
  }

  private writeDue(): void {
    const nowMs: number = this.now();
    let nextDueAt: number = Number.POSITIVE_INFINITY;

    for (const id of Array.from(this.pending.keys())) {
      const dueAt: number = this.getDueAt(id, nowMs);

      if (dueAt <= nowMs) {
        // writeOne logs its own failures.
        void this.writeOne(id, nowMs);
      } else {
        nextDueAt = Math.min(nextDueAt, dueAt);
      }
    }

    if (nextDueAt !== Number.POSITIVE_INFINITY) {
      this.armTimer(nextDueAt, nowMs);
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

    if (nowMs - this.lastFailureLoggedAt < WRITE_FAILURE_LOG_INTERVAL_MS) {
      return;
    }

    this.lastFailureLoggedAt = nowMs;
    logger.warn(
      "TelemetryIngestRefusalRecorder: could not write refused telemetry counts",
    );
    logger.warn(err);
  }

  private logOverflow(nowMs: number): void {
    if (nowMs - this.lastOverflowLoggedAt < WRITE_FAILURE_LOG_INTERVAL_MS) {
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
const refusedKeys: WeakMap<object, TelemetryIngestRefusalKey> = new WeakMap();

export function noteTelemetryIngestRefusalKey(
  err: unknown,
  key: TelemetryIngestRefusalKey,
): void {
  if (err && typeof err === "object") {
    refusedKeys.set(err, key);
  }
}

export function getTelemetryIngestRefusalKey(
  err: unknown,
): TelemetryIngestRefusalKey | null {
  if (!err || typeof err !== "object") {
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
    (batch: TelemetryIngestRefusalBatch): Promise<void> => {
      return TelemetryIngestionKeyRefusalService.addRefusals(batch);
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

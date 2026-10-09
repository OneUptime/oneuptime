import InstanceReceivingPeriodService, {
  ReceivingLedgerRead,
} from "../../Services/InstanceReceivingPeriodService";
import PostgresAppInstance from "../../Infrastructure/PostgresDatabase";
import TelemetryIngestBacklog from "./TelemetryIngestBacklog";
import logger from "../Logger";
import CaptureSpan from "./CaptureSpan";
import OneUptimeDate from "../../../Types/Date";
import ReceivingGapsUtil, {
  INGEST_BACKLOG_ALLOWANCE_MS,
  MAX_RECEIVING_LOOKBACK_EXTENSION_MS,
  ReceivingGap,
  ReceivingGapReason,
} from "../../../Utils/Telemetry/ReceivingGaps";

/*
 * What every verdict that rests on silence asks before it holds silence
 * against a resource: when was OneUptime itself not receiving (issue #2825)?
 *
 * Two sources:
 *
 *   - The instance's receiving ledger (InstanceReceivingPeriod), written by
 *     every process that takes ingress traffic: restarts, upgrades and
 *     unreachable datastores, each followed by a short reconnect grace.
 *   - The Telemetry queue, live: while it is more than a minute behind, the
 *     data of the time since its oldest waiting job may not be readable yet.
 *
 * And four questions the verdicts ask of them:
 *
 *   - getGaps: the gaps in a window (the availability charts).
 *   - getReceivingMs: how much of a silence OneUptime was receiving (server,
 *     incoming-request and incoming-email monitors).
 *   - getSilenceCutoff: the instant before which a resource has been silent
 *     for N minutes of receiving time (the "disconnected" sweeps).
 *   - planTelemetryEvaluation: whether a telemetry check's window can be
 *     judged now, and up to when (the telemetry monitors).
 *
 * The answer is cached per process for a few seconds - thousands of checks
 * ask it every minute and it changes only when OneUptime stops or starts
 * receiving. Every failure falls back to "no gaps", which is exactly the
 * behaviour before this existed: a broken ledger can make a verdict as
 * strict as it used to be, never hide an outage.
 */

/*
 * Live verdicts look back at most this far (a heartbeat monitor with a long
 * window, a silence cutoff walking back past an outage), so the ledger is
 * read for this whole horizon at once and cached. Older windows (a chart of
 * last quarter) are read directly.
 */
export const RECEIVING_LEDGER_CACHE_HORIZON_MS: number =
  35 * 24 * 60 * 60_000;

const LEDGER_CACHE_TTL_MS: number = 15_000;
const BACKLOG_CACHE_TTL_MS: number = 10_000;
const ERROR_LOG_INTERVAL_MS: number = 60_000;

/*
 * A telemetry check whose window holds time OneUptime was not receiving
 * waits until that time is behind the window - and, for windows longer than
 * this, waits this long after it at most. By then a long window holds plenty
 * of fresh data again, and waiting for the gap to leave a day-long window
 * would mean not checking for a day.
 */
export const TELEMETRY_EVALUATION_MAX_DEFERRAL_MS: number = 15 * 60_000;

export interface TelemetryEvaluationPlan {
  evaluate: boolean;
  /*
   * The end of the window to read: now, or the time of the oldest job still
   * waiting while the ingest queue is behind, so the window holds data that
   * has been read.
   */
  evaluateUntil: Date;
  /*
   * True when evaluateUntil is earlier than now because the ingest queue is
   * behind; false when the window simply ends now.
   */
  isIngestBehind: boolean;
  // Set when the check waits: what OneUptime was doing during its window.
  deferredBecause?: ReceivingGapReason | undefined;
}

interface CachedLedgerGaps {
  readAtMs: number;
  horizonStartMs: number;
  gaps: Array<ReceivingGap>;
}

interface CachedBacklog {
  readAtMs: number;
  oldestWaitingSince: Date | null;
}

export default class ReceivingCoverage {
  private static ledgerCache: CachedLedgerGaps | null = null;
  private static ledgerRead: Promise<CachedLedgerGaps> | null = null;
  private static backlogCache: CachedBacklog | null = null;
  private static backlogRead: Promise<CachedBacklog> | null = null;
  private static lastErrorLoggedAtMs: number = 0;

  /*
   * The gaps in [startsAt, endsAt]: the ledger's, and while the ingest queue
   * is behind, the time since its oldest waiting job. Sorted and
   * non-overlapping.
   */
  @CaptureSpan()
  public static async getGaps(data: {
    startsAt: Date;
    endsAt: Date;
    now?: Date | undefined;
  }): Promise<Array<ReceivingGap>> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();

    const [ledgerGaps, backlogGap]: [
      Array<ReceivingGap>,
      ReceivingGap | null,
    ] = await Promise.all([
      this.getLedgerGaps({
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        now,
      }),
      this.getBacklogGap(now),
    ]);

    return ReceivingGapsUtil.clip(
      backlogGap ? [...ledgerGaps, backlogGap] : ledgerGaps,
      data.startsAt,
      data.endsAt,
    );
  }

  /*
   * How much of [from, to] OneUptime was receiving: the part of a silence
   * from `from` (the last time a resource was heard from) to `to` that may
   * be held against it.
   */
  @CaptureSpan()
  public static async getReceivingMs(data: {
    from: Date;
    to: Date;
    now?: Date | undefined;
  }): Promise<number> {
    const gaps: Array<ReceivingGap> = await this.getGaps({
      startsAt: data.from,
      endsAt: data.to,
      now: data.now,
    });

    return ReceivingGapsUtil.getReceivingMs(gaps, data.from, data.to);
  }

  /*
   * The minutes between two instants that OneUptime was receiving: how long
   * a resource last heard from at `from` has really been silent at `to`.
   * Truncated and order-free exactly like OneUptimeDate.getDifferenceInMinutes,
   * so with no gaps the two agree to the minute and a check that switches
   * from one to the other is exactly as strict as before whenever OneUptime
   * was up.
   */
  @CaptureSpan()
  public static async getReceivingMinutes(data: {
    from: Date | string;
    to: Date | string;
    now?: Date | undefined;
  }): Promise<number> {
    let from: Date = OneUptimeDate.fromString(data.from);
    let to: Date = OneUptimeDate.fromString(data.to);

    if (from.getTime() > to.getTime()) {
      [from, to] = [to, from];
    }

    const receivingMs: number = await this.getReceivingMs({
      from,
      to,
      now: data.now,
    });

    return Math.floor(receivingMs / 60_000);
  }

  /*
   * The instant before which a resource has been silent for at least
   * `silenceInMinutes` of time OneUptime was receiving. With no gaps that is
   * simply `silenceInMinutes` ago, so a sweep that compares "last seen" with
   * this is exactly as strict as before whenever OneUptime was up.
   */
  @CaptureSpan()
  public static async getSilenceCutoff(data: {
    silenceInMinutes: number;
    now?: Date | undefined;
  }): Promise<Date> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const receivingMs: number = Math.max(0, data.silenceInMinutes) * 60_000;

    const gaps: Array<ReceivingGap> = await this.getGaps({
      startsAt: new Date(
        now.getTime() - receivingMs - MAX_RECEIVING_LOOKBACK_EXTENSION_MS,
      ),
      endsAt: now,
      now,
    });

    return ReceivingGapsUtil.getReceivingWindowStart({
      gaps,
      endsAt: now,
      receivingMs,
    });
  }

  /*
   * Whether a telemetry check over a window of `windowInMs` can be judged
   * now, and up to when.
   *
   * - While the ingest queue is behind, the window ends where the queue is
   *   (its oldest waiting job) instead of now: the check judges data that has
   *   been read, a little late, rather than missing data, on time.
   * - When the window holds time OneUptime was not receiving (or was just
   *   back and reconnecting), the check waits: no status change, no incident
   *   or alert opened, none resolved. It waits until that time is behind the
   *   window, and at most TELEMETRY_EVALUATION_MAX_DEFERRAL_MS after it.
   */
  @CaptureSpan()
  public static async planTelemetryEvaluation(data: {
    windowInMs: number;
    now?: Date | undefined;
  }): Promise<TelemetryEvaluationPlan> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const nowMs: number = now.getTime();

    const backlog: CachedBacklog = await this.readBacklog(now);
    const backlogSinceMs: number | null =
      backlog.oldestWaitingSince?.getTime() ?? null;

    const isIngestBehind: boolean =
      backlogSinceMs !== null &&
      nowMs - backlogSinceMs > INGEST_BACKLOG_ALLOWANCE_MS;

    const evaluateUntilMs: number = isIngestBehind ? backlogSinceMs! : nowMs;

    const evaluateUntil: Date = new Date(evaluateUntilMs);
    const windowStart: Date = new Date(
      evaluateUntilMs - Math.max(0, data.windowInMs),
    );

    const ledgerGaps: Array<ReceivingGap> = ReceivingGapsUtil.clip(
      await this.getLedgerGaps({
        startsAt: windowStart,
        endsAt: evaluateUntil,
        now,
      }),
      windowStart,
      evaluateUntil,
    );

    let latestGap: ReceivingGap | null = null;

    for (const gap of ledgerGaps) {
      if (!latestGap || gap.endsAt.getTime() > latestGap.endsAt.getTime()) {
        latestGap = gap;
      }
    }

    if (
      latestGap &&
      nowMs - latestGap.endsAt.getTime() < TELEMETRY_EVALUATION_MAX_DEFERRAL_MS
    ) {
      return {
        evaluate: false,
        evaluateUntil,
        isIngestBehind,
        deferredBecause: latestGap.reason,
      };
    }

    return { evaluate: true, evaluateUntil, isIngestBehind };
  }

  // Forgets every cached answer. For tests, and after a heartbeat starts a new period.
  public static clearCache(): void {
    this.ledgerCache = null;
    this.ledgerRead = null;
    this.backlogCache = null;
    this.backlogRead = null;
  }

  private static async getLedgerGaps(data: {
    startsAt: Date;
    endsAt: Date;
    now: Date;
  }): Promise<Array<ReceivingGap>> {
    if (data.endsAt.getTime() <= data.startsAt.getTime()) {
      return [];
    }

    try {
      if (!PostgresAppInstance.isConnected()) {
        return [];
      }

      const nowMs: number = data.now.getTime();
      const horizonStartMs: number = nowMs - RECEIVING_LEDGER_CACHE_HORIZON_MS;

      if (data.startsAt.getTime() >= horizonStartMs) {
        const cached: CachedLedgerGaps = await this.readRecentLedger(data.now);
        return ReceivingGapsUtil.clip(cached.gaps, data.startsAt, data.endsAt);
      }

      const read: ReceivingLedgerRead =
        await InstanceReceivingPeriodService.readLedger({
          startsAt: data.startsAt,
          endsAt: data.endsAt,
        });

      return ReceivingGapsUtil.clip(
        ReceivingGapsUtil.gapsFromPeriods({
          periods: read.periods,
          latestReceivingAt: read.latestReceivingAt,
          now: read.now,
        }),
        data.startsAt,
        data.endsAt,
      );
    } catch (err) {
      this.logError("Could not read when this instance was receiving", err);
      return [];
    }
  }

  private static async readRecentLedger(now: Date): Promise<CachedLedgerGaps> {
    const nowMs: number = now.getTime();
    const cached: CachedLedgerGaps | null = this.ledgerCache;

    if (
      cached &&
      nowMs - cached.readAtMs < LEDGER_CACHE_TTL_MS &&
      nowMs >= cached.readAtMs
    ) {
      return cached;
    }

    // One read in flight per process, however many checks ask at once.
    if (!this.ledgerRead) {
      this.ledgerRead = (async (): Promise<CachedLedgerGaps> => {
        const horizonStartMs: number =
          nowMs - RECEIVING_LEDGER_CACHE_HORIZON_MS;

        const read: ReceivingLedgerRead =
          await InstanceReceivingPeriodService.readLedger({
            startsAt: new Date(horizonStartMs),
            endsAt: now,
          });

        const fresh: CachedLedgerGaps = {
          readAtMs: nowMs,
          horizonStartMs,
          gaps: ReceivingGapsUtil.gapsFromPeriods({
            periods: read.periods,
            latestReceivingAt: read.latestReceivingAt,
            now: read.now,
          }),
        };

        this.ledgerCache = fresh;
        return fresh;
      })().finally(() => {
        this.ledgerRead = null;
      });
    }

    return await this.ledgerRead;
  }

  private static async getBacklogGap(now: Date): Promise<ReceivingGap | null> {
    const backlog: CachedBacklog = await this.readBacklog(now);
    const sinceMs: number | null =
      backlog.oldestWaitingSince?.getTime() ?? null;

    if (
      sinceMs === null ||
      now.getTime() - sinceMs <= INGEST_BACKLOG_ALLOWANCE_MS
    ) {
      return null;
    }

    return {
      startsAt: new Date(sinceMs),
      endsAt: now,
      reason: ReceivingGapReason.CatchingUp,
    };
  }

  private static async readBacklog(now: Date): Promise<CachedBacklog> {
    const nowMs: number = now.getTime();
    const cached: CachedBacklog | null = this.backlogCache;

    if (
      cached &&
      nowMs - cached.readAtMs < BACKLOG_CACHE_TTL_MS &&
      nowMs >= cached.readAtMs
    ) {
      return cached;
    }

    if (!this.backlogRead) {
      this.backlogRead = (async (): Promise<CachedBacklog> => {
        let oldestWaitingSince: Date | null = null;

        try {
          oldestWaitingSince =
            await TelemetryIngestBacklog.getOldestWaitingSince();
        } catch (err) {
          this.logError("Could not read how far behind ingest is", err);
        }

        const fresh: CachedBacklog = { readAtMs: nowMs, oldestWaitingSince };
        this.backlogCache = fresh;
        return fresh;
      })().finally(() => {
        this.backlogRead = null;
      });
    }

    return await this.backlogRead;
  }

  private static logError(message: string, err: unknown): void {
    const nowMs: number = Date.now();

    if (nowMs - this.lastErrorLoggedAtMs < ERROR_LOG_INTERVAL_MS) {
      return;
    }

    this.lastErrorLoggedAtMs = nowMs;
    logger.error(
      `ReceivingCoverage: ${message}; judging silence as if this instance had been receiving throughout.`,
    );
    logger.error(err);
  }
}

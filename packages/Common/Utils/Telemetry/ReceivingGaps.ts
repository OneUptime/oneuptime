import { JSONArray, JSONObject, JSONValue } from "../../Types/JSON";

/*
 * Time when OneUptime itself was not receiving data, and the arithmetic every
 * "silent for too long means down" rule uses to leave that time out
 * (issue #2825).
 *
 * Agents, probes, collectors and heartbeat senders cannot reach OneUptime
 * while it restarts or is upgraded, and data that did reach it can wait in
 * the ingest queue before anything can read it. Silence during that time
 * says nothing about the resource that was silent. So OneUptime never holds
 * it against the resource:
 *
 *   - A live verdict that rests on silence (a server or heartbeat monitor
 *     going offline, a host or cluster turning "disconnected", a telemetry
 *     check finding no data) only counts the time OneUptime was receiving.
 *   - The availability charts show that time as "not monitored": a bucket
 *     with data still proves the resource up, a silent one is neither up
 *     nor down, and the uptime percentage leaves it out.
 *
 * Everything here is pure, so the server (live verdicts) and the Dashboard
 * (charts) share one definition of the rule, and the rule is tested without
 * a database. Where the gaps come from is the server's business: the
 * instance's own receiving heartbeat (InstanceReceivingPeriod) and the age
 * of the ingest queue (ReceivingCoverage).
 */

export enum ReceivingGapReason {
  /*
   * OneUptime was not running, or could not take in or store data: a
   * restart, an upgrade, or one of its datastores being unreachable.
   */
  NotReceiving = "NotReceiving",
  /*
   * OneUptime had just come back. Agents were reconnecting and resending
   * what they had queued, so a resource that was silent here may simply not
   * have got through yet.
   */
  Reconnecting = "Reconnecting",
  /*
   * OneUptime had received the data but was still working through its
   * ingest queue, so the data was not readable yet.
   */
  CatchingUp = "CatchingUp",
}

export interface ReceivingGap {
  startsAt: Date;
  endsAt: Date;
  reason: ReceivingGapReason;
}

/*
 * A stretch of time the instance recorded itself as receiving: from the
 * first receiving heartbeat after a gap to the latest one.
 */
export interface ReceivingPeriod {
  startedAt: Date;
  lastReceivingAt: Date;
}

/*
 * How often every process that takes ingress traffic records that it is
 * receiving (InstanceReceivingHeartbeat).
 */
export const RECEIVING_HEARTBEAT_INTERVAL_MS: number = 30_000;

/*
 * No receiving heartbeat from any process for longer than this means
 * OneUptime stopped receiving. Three intervals, so one late or failed
 * heartbeat (a busy event loop, a slow database) is never mistaken for a
 * gap. A restart shorter than this leaves no gap: collectors retry, and the
 * minute-grid charts already bridge a single missed beat.
 */
export const RECEIVING_GAP_THRESHOLD_MS: number = 90_000;

/*
 * After OneUptime comes back, how long agents get to reconnect and resend
 * before their silence counts again. An OpenTelemetry collector backs off to
 * at most 30 seconds between retries, so every one is through well within
 * this.
 */
export const RECONNECT_GRACE_MS: number = 2 * 60_000;

/*
 * The longest a gap that has not closed yet is believed. A gap is open when
 * no process is recording that it receives - which is what a stopped
 * receiving tier looks like, and also what a heartbeat that stopped being
 * written for any other reason looks like. Believing that forever would
 * silence every "went quiet" alert for good, so after an hour silence counts
 * again: at worst an hour of silence goes unjudged, never all of it.
 */
export const OPEN_GAP_MAX_TRUST_MS: number = 60 * 60_000;

/*
 * Ingest that is this far behind is the pipeline's normal lag (batching,
 * queueing, the fan-in writer's flush window). Checks and charts already
 * allow for it, so only a queue further behind than this is catching up.
 * The same allowance the availability charts give the trailing edge
 * (HEARTBEAT_INGEST_LAG_MS).
 */
export const INGEST_BACKLOG_ALLOWANCE_MS: number = 60_000;

/*
 * A window that has to reach back past gaps to hold enough receiving time
 * never reaches back further than this past its own length.
 *
 * Long enough for any outage an installation comes back from: a OneUptime
 * that was off for a long weekend still gives every resource its full
 * silence threshold of receiving time before calling it disconnected, as
 * the monitors' own silence criteria do. Short enough that, with the
 * longest silence threshold added, the walk stays inside the ledger horizon
 * every process keeps cached (RECEIVING_LEDGER_CACHE_HORIZON_MS), so a
 * sweep never reads the ledger itself.
 */
export const MAX_RECEIVING_LOOKBACK_EXTENSION_MS: number =
  30 * 24 * 60 * 60_000;

/*
 * When two reasons cover the same instant, the one that says the most about
 * why the data is missing is the one shown.
 */
const REASON_PRIORITY: Record<ReceivingGapReason, number> = {
  [ReceivingGapReason.NotReceiving]: 3,
  [ReceivingGapReason.Reconnecting]: 2,
  [ReceivingGapReason.CatchingUp]: 1,
};

const ALL_REASONS: Array<string> = Object.values(ReceivingGapReason);

export default class ReceivingGapsUtil {
  /*
   * The gaps a ledger of receiving periods implies.
   *
   * `periods` must hold every period around the time asked about: the ones
   * that overlap it, and the nearest one on either side (the server reads
   * exactly those). Between two periods more than RECEIVING_GAP_THRESHOLD_MS
   * apart OneUptime was not receiving, and for RECONNECT_GRACE_MS after the
   * later one began agents were reconnecting. Two processes that both found
   * the ledger stale after an outage may each have started a period; those
   * overlap and merge.
   *
   * After the latest period (`latestReceivingAt`, the newest heartbeat in the
   * whole ledger) the gap is still open when that heartbeat is older than
   * the threshold, and is believed for at most OPEN_GAP_MAX_TRUST_MS.
   *
   * Before the first period nothing is known - the ledger did not exist yet,
   * or its oldest rows were pruned - so no gap is ever invented there.
   */
  public static gapsFromPeriods(data: {
    periods: Array<ReceivingPeriod>;
    latestReceivingAt: Date | null;
    now: Date;
  }): Array<ReceivingGap> {
    const nowMs: number = data.now.getTime();

    const merged: Array<{ startMs: number; endMs: number }> = this.mergePeriods(
      data.periods,
      nowMs,
    );

    if (merged.length === 0) {
      return [];
    }

    const gaps: Array<ReceivingGap> = [];

    for (let index: number = 1; index < merged.length; index++) {
      const previous: { startMs: number; endMs: number } = merged[index - 1]!;
      const next: { startMs: number; endMs: number } = merged[index]!;

      gaps.push({
        startsAt: new Date(previous.endMs),
        endsAt: new Date(next.startMs),
        reason: ReceivingGapReason.NotReceiving,
      });

      const graceEndMs: number = Math.min(
        next.startMs + RECONNECT_GRACE_MS,
        nowMs,
      );

      if (graceEndMs > next.startMs) {
        gaps.push({
          startsAt: new Date(next.startMs),
          endsAt: new Date(graceEndMs),
          reason: ReceivingGapReason.Reconnecting,
        });
      }
    }

    const last: { startMs: number; endMs: number } = merged[merged.length - 1]!;
    const latestMs: number | null = this.toMs(data.latestReceivingAt);

    /*
     * Only the ledger's newest period can have an open gap after it. When a
     * later period exists outside what was read, the time after `last` is
     * the gap to that period, which `periods` would have included.
     */
    const isLedgerNewest: boolean = latestMs === null || latestMs <= last.endMs;

    if (isLedgerNewest && nowMs - last.endMs > RECEIVING_GAP_THRESHOLD_MS) {
      gaps.push({
        startsAt: new Date(last.endMs),
        endsAt: new Date(Math.min(nowMs, last.endMs + OPEN_GAP_MAX_TRUST_MS)),
        reason: ReceivingGapReason.NotReceiving,
      });
    }

    return this.normalize(gaps);
  }

  /*
   * Sorted, non-overlapping gaps. Where gaps overlap, the instant goes to
   * the reason that explains the most (REASON_PRIORITY); touching pieces with
   * the same reason are joined. Empty and malformed gaps are dropped.
   */
  public static normalize(gaps: Array<ReceivingGap>): Array<ReceivingGap> {
    const valid: Array<{ startMs: number; endMs: number; reason: string }> = [];

    for (const gap of gaps || []) {
      const startMs: number | null = this.toMs(gap?.startsAt);
      const endMs: number | null = this.toMs(gap?.endsAt);

      if (
        startMs === null ||
        endMs === null ||
        endMs <= startMs ||
        !ALL_REASONS.includes(gap.reason)
      ) {
        continue;
      }

      valid.push({ startMs, endMs, reason: gap.reason });
    }

    if (valid.length === 0) {
      return [];
    }

    const boundaries: Array<number> = Array.from(
      new Set(
        valid.flatMap((gap: { startMs: number; endMs: number }) => {
          return [gap.startMs, gap.endMs];
        }),
      ),
    ).sort((a: number, b: number) => {
      return a - b;
    });

    const pieces: Array<ReceivingGap> = [];

    for (let index: number = 0; index < boundaries.length - 1; index++) {
      const pieceStart: number = boundaries[index]!;
      const pieceEnd: number = boundaries[index + 1]!;

      let reason: ReceivingGapReason | null = null;

      for (const gap of valid) {
        if (gap.startMs <= pieceStart && gap.endMs >= pieceEnd) {
          const candidate: ReceivingGapReason =
            gap.reason as ReceivingGapReason;
          if (
            reason === null ||
            REASON_PRIORITY[candidate] > REASON_PRIORITY[reason]
          ) {
            reason = candidate;
          }
        }
      }

      if (reason === null) {
        continue;
      }

      const previous: ReceivingGap | undefined = pieces[pieces.length - 1];

      if (
        previous &&
        previous.reason === reason &&
        previous.endsAt.getTime() === pieceStart
      ) {
        previous.endsAt = new Date(pieceEnd);
        continue;
      }

      pieces.push({
        startsAt: new Date(pieceStart),
        endsAt: new Date(pieceEnd),
        reason,
      });
    }

    return pieces;
  }

  // The parts of the gaps that fall inside [from, to].
  public static clip(
    gaps: Array<ReceivingGap>,
    from: Date,
    to: Date,
  ): Array<ReceivingGap> {
    const fromMs: number | null = this.toMs(from);
    const toMs: number | null = this.toMs(to);

    if (fromMs === null || toMs === null || toMs <= fromMs) {
      return [];
    }

    const clipped: Array<ReceivingGap> = [];

    for (const gap of this.normalize(gaps)) {
      const startMs: number = Math.max(gap.startsAt.getTime(), fromMs);
      const endMs: number = Math.min(gap.endsAt.getTime(), toMs);

      if (endMs > startMs) {
        clipped.push({
          startsAt: new Date(startMs),
          endsAt: new Date(endMs),
          reason: gap.reason,
        });
      }
    }

    return clipped;
  }

  // Whether any gap covers part of [from, to].
  public static overlaps(
    gaps: Array<ReceivingGap>,
    from: Date,
    to: Date,
  ): boolean {
    return this.clip(gaps, from, to).length > 0;
  }

  // How much of [from, to] OneUptime was not receiving, in milliseconds.
  public static getNotReceivingMs(
    gaps: Array<ReceivingGap>,
    from: Date,
    to: Date,
  ): number {
    return this.clip(gaps, from, to).reduce(
      (total: number, gap: ReceivingGap) => {
        return total + (gap.endsAt.getTime() - gap.startsAt.getTime());
      },
      0,
    );
  }

  /*
   * How much of [from, to] OneUptime was receiving, in milliseconds: the
   * part of a silence that may be held against the resource.
   */
  public static getReceivingMs(
    gaps: Array<ReceivingGap>,
    from: Date,
    to: Date,
  ): number {
    const fromMs: number | null = this.toMs(from);
    const toMs: number | null = this.toMs(to);

    if (fromMs === null || toMs === null || toMs <= fromMs) {
      return 0;
    }

    return Math.max(0, toMs - fromMs - this.getNotReceivingMs(gaps, from, to));
  }

  /*
   * Where a window that ends at `endsAt` has to start to hold `receivingMs`
   * of time OneUptime was receiving: walk back from the end, skipping every
   * gap. With no gaps that is simply `endsAt - receivingMs`.
   *
   * This is how a silence threshold is turned into a cutoff: anything last
   * heard from before the returned instant has been silent for at least
   * `receivingMs` of receiving time. The walk never reaches back more than
   * `maxExtensionMs` past the plain window.
   */
  public static getReceivingWindowStart(data: {
    gaps: Array<ReceivingGap>;
    endsAt: Date;
    receivingMs: number;
    maxExtensionMs?: number | undefined;
  }): Date {
    const endMs: number = data.endsAt.getTime();
    const receivingMs: number = Math.max(0, data.receivingMs);
    const maxExtensionMs: number = Math.max(
      0,
      data.maxExtensionMs ?? MAX_RECEIVING_LOOKBACK_EXTENSION_MS,
    );
    const earliestMs: number = endMs - receivingMs - maxExtensionMs;

    const gaps: Array<ReceivingGap> = this.normalize(data.gaps)
      .filter((gap: ReceivingGap) => {
        return gap.startsAt.getTime() < endMs;
      })
      .sort((a: ReceivingGap, b: ReceivingGap) => {
        return b.endsAt.getTime() - a.endsAt.getTime();
      });

    let cursorMs: number = endMs;
    let remainingMs: number = receivingMs;

    for (const gap of gaps) {
      const gapEndMs: number = Math.min(gap.endsAt.getTime(), cursorMs);
      const gapStartMs: number = gap.startsAt.getTime();

      if (gapEndMs <= gapStartMs) {
        continue;
      }

      const receivingBeforeCursorMs: number = cursorMs - gapEndMs;

      if (receivingBeforeCursorMs >= remainingMs) {
        break;
      }

      remainingMs -= receivingBeforeCursorMs;
      cursorMs = gapStartMs;

      if (cursorMs - remainingMs <= earliestMs) {
        return new Date(earliestMs);
      }
    }

    return new Date(Math.max(cursorMs - remainingMs, earliestMs));
  }

  /*
   * The latest end among the gaps that cover part of [from, to], or null
   * when none does. A check whose window holds a gap waits until that gap is
   * far enough behind it.
   */
  public static getLatestOverlappingEnd(
    gaps: Array<ReceivingGap>,
    from: Date,
    to: Date,
  ): Date | null {
    let latestMs: number | null = null;

    for (const gap of this.clip(gaps, from, to)) {
      const endMs: number = gap.endsAt.getTime();
      if (latestMs === null || endMs > latestMs) {
        latestMs = endMs;
      }
    }

    return latestMs === null ? null : new Date(latestMs);
  }

  public static toJSON(gaps: Array<ReceivingGap>): JSONArray {
    return this.normalize(gaps).map((gap: ReceivingGap): JSONObject => {
      return {
        startsAt: gap.startsAt.toISOString(),
        endsAt: gap.endsAt.toISOString(),
        reason: gap.reason,
      };
    });
  }

  /*
   * Reads gaps back from an API response. Anything that is not a gap (a
   * missing or unreadable date, an unknown reason) is dropped rather than
   * trusted: a malformed answer must never hide a real outage.
   */
  public static fromJSON(value: JSONValue | undefined): Array<ReceivingGap> {
    if (!Array.isArray(value)) {
      return [];
    }

    const gaps: Array<ReceivingGap> = [];

    for (const entry of value) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }

      const json: JSONObject = entry as JSONObject;
      const startsAt: Date | null = this.readDate(json["startsAt"]);
      const endsAt: Date | null = this.readDate(json["endsAt"]);
      const reason: JSONValue | undefined = json["reason"];

      if (
        !startsAt ||
        !endsAt ||
        typeof reason !== "string" ||
        !ALL_REASONS.includes(reason)
      ) {
        continue;
      }

      gaps.push({
        startsAt,
        endsAt,
        reason: reason as ReceivingGapReason,
      });
    }

    return this.normalize(gaps);
  }

  private static mergePeriods(
    periods: Array<ReceivingPeriod>,
    nowMs: number,
  ): Array<{ startMs: number; endMs: number }> {
    const valid: Array<{ startMs: number; endMs: number }> = [];

    for (const period of periods || []) {
      const startMs: number | null = this.toMs(period?.startedAt);
      const lastMs: number | null = this.toMs(period?.lastReceivingAt);

      if (startMs === null || lastMs === null) {
        continue;
      }

      /*
       * A heartbeat stamped after `now` (clock skew between the database and
       * the reader) still only proves receiving up to now.
       */
      const endMs: number = Math.min(Math.max(lastMs, startMs), nowMs);
      const clampedStartMs: number = Math.min(startMs, endMs);

      valid.push({ startMs: clampedStartMs, endMs });
    }

    valid.sort(
      (
        a: { startMs: number; endMs: number },
        b: { startMs: number; endMs: number },
      ) => {
        return a.startMs - b.startMs;
      },
    );

    const merged: Array<{ startMs: number; endMs: number }> = [];

    for (const period of valid) {
      const previous: { startMs: number; endMs: number } | undefined =
        merged[merged.length - 1];

      if (
        previous &&
        period.startMs - previous.endMs <= RECEIVING_GAP_THRESHOLD_MS
      ) {
        previous.endMs = Math.max(previous.endMs, period.endMs);
        continue;
      }

      merged.push({ ...period });
    }

    return merged;
  }

  private static readDate(value: JSONValue | undefined): Date | null {
    if (typeof value !== "string" && typeof value !== "number") {
      return null;
    }

    const date: Date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  private static toMs(value: Date | null | undefined): number | null {
    if (!(value instanceof Date)) {
      return null;
    }

    const ms: number = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
}

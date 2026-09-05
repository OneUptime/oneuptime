import Redis, { ClientType } from "../../Infrastructure/Redis";
import logger from "../Logger";
import ObjectID from "../../../Types/ObjectID";
import {
  SessionReplayRefusalCount,
  isSessionReplayRefusalReason,
} from "../../../Types/Rum/SessionReplayHealth";

/*
 * Per-application counters of what the session replay ingest path did NOT
 * keep, and why.
 *
 * The chunk gate answers every refusal with a reason string the recorder
 * can log, but the person who has to explain "why are there no recordings?"
 * is looking at the Dashboard, not at a visitor's browser console. These
 * counters are the server-side memory of those answers: one Redis hash per
 * (project, application, UTC day) with one field per reason, incremented by
 * HINCRBY from the gate for every non-accepted request, and read back by
 * the ingest-status endpoint summed over today and yesterday so the
 * "last 24h" figure is stable across midnight.
 *
 * Two rules that every reader of this module relies on:
 *
 *   1. Writes never throw and never delay a response. A counter is
 *      bookkeeping; the chunk decision has already been made.
 *   2. Reads return null - never 0, never [] - when Redis could not be
 *      consulted. "Nothing was refused" and "we cannot tell" are different
 *      facts, and the health copy renders the second as "unknown".
 *
 * Day buckets are UTC so every pod agrees on which hash a refusal lands in,
 * and the 48h TTL is what bounds the keyspace: a day's hash lives long
 * enough to be yesterday's half of a 24h window and no longer.
 */

const REFUSAL_KEY_PREFIX: string = "replay:refusals:";

/*
 * Worker-side drops are counted separately from gate refusals. A refusal
 * was answered to the recorder (204 with a reason); a drop happened AFTER a
 * 202, inside the queue consumer, and the recorder was never told. They
 * are different explanations for the same missing recording and the
 * Dashboard must not blur them: "212 refused: origin not allowed" tells the
 * customer to fix a setting, "12 dropped: scrub incomplete" tells them the
 * server chose not to store something it had already accepted.
 */
const DROP_KEY_PREFIX: string = "replay:drops:";

export const SESSION_REPLAY_HEALTH_COUNTER_TTL_SECONDS: number = 48 * 60 * 60;

const DAY_MS: number = 24 * 60 * 60 * 1000;

/* Bounds a hostile or buggy caller: the reason is a Redis hash field. */
const MAX_REASON_LENGTH: number = 64;

export interface SessionReplayDropCount {
  reason: string;
  count: number;
}

export default class SessionReplayHealthCounters {
  /* "YYYY-MM-DD" in UTC for the given instant. */
  public static getUtcDayBucket(unixMs: number): string {
    return new Date(unixMs).toISOString().substring(0, 10);
  }

  public static getRefusalCounterKey(data: {
    projectId: ObjectID | string;
    appIdentifier: string;
    utcDay: string;
  }): string {
    return `${REFUSAL_KEY_PREFIX}${this.buildScope(data)}:${data.utcDay}`;
  }

  public static getDropCounterKey(data: {
    projectId: ObjectID | string;
    appIdentifier: string;
    utcDay: string;
  }): string {
    return `${DROP_KEY_PREFIX}${this.buildScope(data)}:${data.utcDay}`;
  }

  /*
   * Count one refused chunk request. Best-effort: a Redis failure is logged
   * at debug (it would otherwise spam the log for the whole outage) and
   * swallowed, because the gate has already decided and the response must
   * not wait on bookkeeping.
   */
  public static async recordRefusal(data: {
    projectId: ObjectID | string;
    appIdentifier: string;
    reason: string;
    nowUnixMs?: number | undefined;
  }): Promise<void> {
    await this.increment({
      key: this.getRefusalCounterKey({
        projectId: data.projectId,
        appIdentifier: data.appIdentifier,
        utcDay: this.getUtcDayBucket(data.nowUnixMs ?? Date.now()),
      }),
      reason: data.reason,
      describe: "refusal",
    });
  }

  /* Count one chunk the worker dropped after the route had answered 202. */
  public static async recordDrop(data: {
    projectId: ObjectID | string;
    appIdentifier: string;
    reason: string;
    nowUnixMs?: number | undefined;
  }): Promise<void> {
    await this.increment({
      key: this.getDropCounterKey({
        projectId: data.projectId,
        appIdentifier: data.appIdentifier,
        utcDay: this.getUtcDayBucket(data.nowUnixMs ?? Date.now()),
      }),
      reason: data.reason,
      describe: "drop",
    });
  }

  /*
   * Refusals over the last 24 hours, summed over today's and yesterday's
   * buckets, highest count first. Only the gate's closed vocabulary is
   * returned: a field that is not a known reason (an older or newer build
   * of the gate) is dropped rather than rendered as a bare string.
   *
   * null when Redis is unavailable or either read failed.
   */
  public static async readRefusalsLast24h(data: {
    projectId: ObjectID | string;
    appIdentifier: string;
    nowUnixMs?: number | undefined;
  }): Promise<Array<SessionReplayRefusalCount> | null> {
    const nowUnixMs: number = data.nowUnixMs ?? Date.now();

    const totals: Map<string, number> | null = await this.readTwoDayTotals([
      this.getRefusalCounterKey({
        projectId: data.projectId,
        appIdentifier: data.appIdentifier,
        utcDay: this.getUtcDayBucket(nowUnixMs),
      }),
      this.getRefusalCounterKey({
        projectId: data.projectId,
        appIdentifier: data.appIdentifier,
        utcDay: this.getUtcDayBucket(nowUnixMs - DAY_MS),
      }),
    ]);

    if (totals === null) {
      return null;
    }

    const refusals: Array<SessionReplayRefusalCount> = [];

    for (const [reason, count] of totals.entries()) {
      if (isSessionReplayRefusalReason(reason) && count > 0) {
        refusals.push({ reason: reason, count: count });
      }
    }

    return this.sortByCountDescending(refusals);
  }

  /*
   * Worker drops over the last 24 hours. The drop vocabulary is open (it is
   * whatever recordDrop in the ingest service names), so every non-empty
   * field is returned. null when Redis is unavailable.
   */
  public static async readDropsLast24h(data: {
    projectId: ObjectID | string;
    appIdentifier: string;
    nowUnixMs?: number | undefined;
  }): Promise<Array<SessionReplayDropCount> | null> {
    const nowUnixMs: number = data.nowUnixMs ?? Date.now();

    const totals: Map<string, number> | null = await this.readTwoDayTotals([
      this.getDropCounterKey({
        projectId: data.projectId,
        appIdentifier: data.appIdentifier,
        utcDay: this.getUtcDayBucket(nowUnixMs),
      }),
      this.getDropCounterKey({
        projectId: data.projectId,
        appIdentifier: data.appIdentifier,
        utcDay: this.getUtcDayBucket(nowUnixMs - DAY_MS),
      }),
    ]);

    if (totals === null) {
      return null;
    }

    const drops: Array<SessionReplayDropCount> = [];

    for (const [reason, count] of totals.entries()) {
      if (reason && count > 0) {
        drops.push({ reason: reason, count: count });
      }
    }

    return this.sortByCountDescending(drops);
  }

  /*
   * The application identifier is lower-cased because RumApplication lookup
   * is case-insensitive (QueryHelper.findWithSameText): two recorders that
   * spell the identifier differently are one application and must share one
   * counter.
   */
  private static buildScope(data: {
    projectId: ObjectID | string;
    appIdentifier: string;
  }): string {
    return `${data.projectId.toString()}:${data.appIdentifier.trim().toLowerCase()}`;
  }

  private static async increment(data: {
    key: string;
    reason: string;
    describe: string;
  }): Promise<void> {
    const reason: string = data.reason.trim().substring(0, MAX_REASON_LENGTH);

    if (!reason) {
      return;
    }

    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return;
    }

    try {
      await client.hincrby(data.key, reason, 1);
      /*
       * Refreshed on every write rather than only on the first: HINCRBY
       * cannot say whether it created the key, and a second round trip to
       * find out costs the same as the EXPIRE itself.
       */
      await client.expire(data.key, SESSION_REPLAY_HEALTH_COUNTER_TTL_SECONDS);
    } catch (err) {
      logger.debug(
        `SessionReplayHealthCounters: could not record a ${data.describe} at ${data.key}`,
      );
      logger.debug(err);
    }
  }

  private static async readTwoDayTotals(
    keys: Array<string>,
  ): Promise<Map<string, number> | null> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return null;
    }

    const totals: Map<string, number> = new Map<string, number>();

    try {
      for (const key of keys) {
        const fields: Record<string, string> = await client.hgetall(key);

        for (const reason of Object.keys(fields || {})) {
          const parsed: number = parseInt(fields[reason] as string, 10);

          if (!Number.isFinite(parsed) || parsed <= 0) {
            continue;
          }

          totals.set(reason, (totals.get(reason) || 0) + parsed);
        }
      }
    } catch (err) {
      logger.warn(
        "SessionReplayHealthCounters: could not read the replay health counters",
      );
      logger.warn(err);
      return null;
    }

    return totals;
  }

  private static sortByCountDescending<
    TCount extends { reason: string; count: number },
  >(entries: Array<TCount>): Array<TCount> {
    return entries.sort((a: TCount, b: TCount): number => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }

      return a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0;
    });
  }
}

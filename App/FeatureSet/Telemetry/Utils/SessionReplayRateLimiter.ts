import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import {
  SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY,
  SESSION_REPLAY_MAX_CHUNKS_PER_PROJECT_PER_MINUTE,
} from "../Config";

/*
 * Per-project rate and byte-budget counters for session replay ingest.
 *
 * Built on raw Redis INCR / INCRBY + EXPIRE. This is net-new machinery: the
 * only rate-limiting precedent in the repo (PushRelay) is a per-process
 * in-memory per-IP window, which is useless behind a load balancer with
 * autoscaled app pods. GlobalCache is not an option either - it has no
 * counter primitive at all, only get/set, so a read-modify-write there would
 * lose increments under concurrency.
 *
 * The two counters answer different questions and therefore fail
 * differently:
 *
 *  - the per-minute chunk counter protects the queue and the cluster from a
 *    burst; over it we answer 429 with Retry-After so the recorder backs off
 *    and comes back.
 *  - the per-day byte counter is a hard budget; over it we answer 204 with
 *    directive "stop" so the recorder stands down for the rest of the day
 *    rather than retry-storming against a quota it cannot satisfy.
 *
 * Both fail CLOSED when Redis is unavailable, reported as a distinct
 * outcome so the caller can answer 503 (retryable) rather than silently
 * dropping. That is the honest answer: without a counter we cannot honour a
 * budget whose entire purpose is stopping an unmetered self-hosted install
 * from pushing ClickHouse into capacity pruning.
 */

const CHUNK_RATE_KEY_PREFIX: string = "replay:rate:chunks:";
const BYTE_BUDGET_KEY_PREFIX: string = "replay:rate:bytes:";

/*
 * Two minutes, so the counter for a minute bucket outlives the bucket it
 * belongs to and a request landing at the boundary cannot read a key that
 * was reclaimed mid-window.
 */
const CHUNK_RATE_TTL_SECONDS: number = 120;

/* Two days, for the same boundary reason applied to a UTC day bucket. */
const BYTE_BUDGET_TTL_SECONDS: number = 2 * 24 * 60 * 60;

export enum SessionReplayLimitOutcome {
  /* Within both limits. */
  Allowed = "allowed",

  /* Over the per-minute chunk rate. Retryable. */
  RateLimited = "rate-limited",

  /* Over the per-project daily byte budget. Not retryable today. */
  BudgetExhausted = "budget-exhausted",

  /* Counters unavailable, so no limit can be honoured. Retryable. */
  CounterUnavailable = "counter-unavailable",
}

export interface SessionReplayLimitDecision {
  outcome: SessionReplayLimitOutcome;
  retryAfterSeconds?: number | undefined;
}

export default class SessionReplayRateLimiter {
  /*
   * Consume `chunkCount` from the project's per-minute allowance.
   *
   * Counted before the body is staged, so a burst is rejected before it
   * costs anything. The counter is incremented even on the rejecting request
   * - that is intentional and standard for a fixed-window limiter: a client
   * that keeps hammering keeps the window pinned rather than being handed a
   * fresh allowance for free.
   */
  public static async consumeChunkAllowance(data: {
    projectId: ObjectID;
    chunkCount: number;
  }): Promise<SessionReplayLimitDecision> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return { outcome: SessionReplayLimitOutcome.CounterUnavailable };
    }

    const minuteBucket: number = Math.floor(Date.now() / 60000);
    const key: string = `${CHUNK_RATE_KEY_PREFIX}${data.projectId.toString()}:${minuteBucket}`;

    try {
      const total: number = await client.incrby(key, data.chunkCount);

      /*
       * Set the expiry only on the write that created the key. Re-issuing
       * EXPIRE on every increment would slide the window forward forever
       * under sustained load, so the counter would never reset.
       */
      if (total === data.chunkCount) {
        await client.expire(key, CHUNK_RATE_TTL_SECONDS);
      }

      if (total > SESSION_REPLAY_MAX_CHUNKS_PER_PROJECT_PER_MINUTE) {
        /*
         * Retry-After is the remaining seconds in this fixed window, so
         * every rejected recorder is told to come back exactly when the
         * window rolls rather than all backing off by the same constant.
         */
        const secondsIntoWindow: number = Math.floor(
          (Date.now() % 60000) / 1000,
        );

        return {
          outcome: SessionReplayLimitOutcome.RateLimited,
          retryAfterSeconds: Math.max(1, 60 - secondsIntoWindow),
        };
      }

      return { outcome: SessionReplayLimitOutcome.Allowed };
    } catch (err) {
      logger.warn(
        `SessionReplayRateLimiter: chunk counter failed for project ${data.projectId.toString()}`,
      );
      logger.warn(err);
      return { outcome: SessionReplayLimitOutcome.CounterUnavailable };
    }
  }

  /*
   * Consume `bytes` from the project's daily budget.
   *
   * Note the budget is checked AFTER the increment, so the request that
   * crosses the line is still accepted. That is deliberate: rejecting a
   * chunk mid-session leaves an unplayable fragment, and the overshoot is
   * bounded by one request (at most MAX_SESSION_REPLAY_CHUNK_BYTES).
   * Everything after it is refused.
   */
  public static async consumeByteBudget(data: {
    projectId: ObjectID;
    bytes: number;
  }): Promise<SessionReplayLimitDecision> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return { outcome: SessionReplayLimitOutcome.CounterUnavailable };
    }

    const key: string = `${BYTE_BUDGET_KEY_PREFIX}${data.projectId.toString()}:${this.getUtcDayBucket()}`;

    try {
      const total: number = await client.incrby(key, data.bytes);

      if (total === data.bytes) {
        await client.expire(key, BYTE_BUDGET_TTL_SECONDS);
      }

      if (total > SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY) {
        return { outcome: SessionReplayLimitOutcome.BudgetExhausted };
      }

      return { outcome: SessionReplayLimitOutcome.Allowed };
    } catch (err) {
      logger.warn(
        `SessionReplayRateLimiter: byte budget counter failed for project ${data.projectId.toString()}`,
      );
      logger.warn(err);
      return { outcome: SessionReplayLimitOutcome.CounterUnavailable };
    }
  }

  /*
   * Bytes already consumed today. Read-only, used by the config endpoint so
   * a Dashboard can surface "quota exhausted" as a state rather than
   * leaving the customer to infer it from missing recordings.
   */
  public static async getBytesUsedToday(
    projectId: ObjectID,
  ): Promise<number | null> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return null;
    }

    const key: string = `${BYTE_BUDGET_KEY_PREFIX}${projectId.toString()}:${this.getUtcDayBucket()}`;

    try {
      const value: string | null = await client.get(key);

      if (value === null) {
        return 0;
      }

      const parsed: number = parseInt(value, 10);

      return isNaN(parsed) ? 0 : parsed;
    } catch (err) {
      logger.warn(
        `SessionReplayRateLimiter: could not read the byte budget for project ${projectId.toString()}`,
      );
      logger.warn(err);
      return null;
    }
  }

  /*
   * UTC rather than local, so the budget window is the same for every pod
   * regardless of container timezone.
   */
  private static getUtcDayBucket(): string {
    return new Date().toISOString().substring(0, 10);
  }
}

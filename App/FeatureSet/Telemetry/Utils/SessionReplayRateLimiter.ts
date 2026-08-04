import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import SessionReplayUsage from "Common/Server/Utils/SessionReplay/SessionReplayUsage";
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

/*
 * Two minutes, so the counter for a minute bucket outlives the bucket it
 * belongs to and a request landing at the boundary cannot read a key that
 * was reclaimed mid-window.
 */
const CHUNK_RATE_TTL_SECONDS: number = 120;

/* Two days, for the same boundary reason applied to a UTC day bucket. */
const BYTE_BUDGET_TTL_SECONDS: number = 2 * 24 * 60 * 60;

/*
 * The monthly key is created by whichever chunk lands first in the month,
 * possibly on day 1, and must survive to the end of a 31-day month plus the
 * same boundary margin. 40 days is one small integer per application per
 * month - the memory cost is nothing.
 */
const MONTHLY_BYTE_BUDGET_TTL_SECONDS: number = 40 * 24 * 60 * 60;

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

    const key: string = SessionReplayUsage.getDailyProjectByteKey(
      data.projectId,
    );

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
   * Consume `bytes` from one application's customer-configured MONTHLY
   * budget. Same crossing-request semantics as the daily budget above, and
   * the same fail-closed answer when the counter is unreachable.
   *
   * The instance-wide daily cap and this cap answer different questions:
   * the daily cap protects the operator's ClickHouse from any single
   * project, while this one enforces the spend ceiling the customer set on
   * their own application - it is the only control a customer can actually
   * turn.
   */
  public static async consumeApplicationMonthlyBudget(data: {
    projectId: ObjectID;
    rumApplicationId: ObjectID;
    bytes: number;
    budgetBytes: number;
  }): Promise<SessionReplayLimitDecision> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return { outcome: SessionReplayLimitOutcome.CounterUnavailable };
    }

    const key: string = SessionReplayUsage.getMonthlyApplicationByteKey({
      projectId: data.projectId,
      rumApplicationId: data.rumApplicationId,
    });

    try {
      const total: number = await client.incrby(key, data.bytes);

      if (total === data.bytes) {
        await client.expire(key, MONTHLY_BYTE_BUDGET_TTL_SECONDS);
      }

      if (total > data.budgetBytes) {
        /*
         * Refund the refused bytes. Unlike the daily counter (which resets
         * in 24h), this counter is read back as "usage" by the Dashboard's
         * ingest-status endpoint and accumulates for up to 31 days — every
         * post-exhaustion upload attempt would otherwise inflate the
         * displayed figure past both the budget and the bytes actually
         * stored, and a mid-month budget raise would find its new headroom
         * already eaten by chunks that were never accepted. Best-effort:
         * losing one decrement to a Redis blip skews the display by one
         * chunk, which is better than failing the refusal path.
         */
        try {
          await client.decrby(key, data.bytes);
        } catch (decrementErr) {
          logger.warn(
            `SessionReplayRateLimiter: could not refund refused bytes for application ${data.rumApplicationId.toString()}`,
          );
          logger.warn(decrementErr);
        }

        return { outcome: SessionReplayLimitOutcome.BudgetExhausted };
      }

      return { outcome: SessionReplayLimitOutcome.Allowed };
    } catch (err) {
      logger.warn(
        `SessionReplayRateLimiter: monthly budget counter failed for application ${data.rumApplicationId.toString()}`,
      );
      logger.warn(err);
      return { outcome: SessionReplayLimitOutcome.CounterUnavailable };
    }
  }

  /*
   * Bytes already consumed today. Read-only, used by the ingest-status
   * endpoint so a Dashboard can surface "quota exhausted" as a state rather
   * than leaving the customer to infer it from missing recordings. The
   * actual read lives in Common (SessionReplayUsage) so the Dashboard API
   * and this consumer can never disagree on the key.
   */
  public static async getBytesUsedToday(
    projectId: ObjectID,
  ): Promise<number | null> {
    return SessionReplayUsage.getProjectBytesUsedToday(projectId);
  }
}

import Redis, { ClientType } from "../../Infrastructure/Redis";
import logger from "../Logger";
import ObjectID from "../../../Types/ObjectID";

/*
 * Per-ingestion-key request rate limiting.
 *
 * This exists because a Browser ingestion key is, by design, published in a
 * page: anyone who views source has it. Rotation and the origin allowlist
 * bound WHO can use a scraped key, but neither bounds HOW MUCH a caller who
 * satisfies them can push. Without a per-key ceiling, one scraped key plus a
 * loop is unbounded write volume into a customer's project - poisoned
 * dashboards, forged spans and, on a metered plan, a bill. The ceiling is
 * per key rather than per project so that turning the abuse off (rotate or
 * disable that one key) never takes a customer's server ingest down with it.
 *
 * Built on raw Redis INCR + EXPIRE, mirroring
 * App/FeatureSet/Telemetry/Utils/SessionReplayRateLimiter.ts. The same
 * reasoning applies: a per-process in-memory counter is useless across
 * autoscaled ingest pods, and GlobalCache has no counter primitive at all
 * (only get/set, so a read-modify-write there would lose increments under
 * exactly the concurrency this is meant to bound).
 *
 * ---------------------------------------------------------------------
 * THIS LIMITER FAILS OPEN, AND THAT IS DIFFERENT FROM SESSION REPLAY.
 * ---------------------------------------------------------------------
 * When Redis is unreachable this returns CounterUnavailable, and the CALLER
 * is expected to ADMIT the request anyway. The limit here bounds ABUSE of a
 * key that leaked; it is not a privacy control and it is not a hard billing
 * quota. Weigh the two failure modes during a Redis blip:
 *
 *   - fail closed: every paying customer's production telemetry stops for
 *     the duration of the outage, and the gap is permanent because dropped
 *     spans are not replayed. An infrastructure hiccup becomes a
 *     customer-visible data loss incident, and the operator's incident
 *     dashboards go dark at the exact moment they are needed.
 *
 *   - fail open: for the length of the blip an attacker who already holds a
 *     scraped key gets an unbounded window. They already had that window up
 *     until this feature shipped, the origin allowlist and enable/disable
 *     switch still apply (they are resolved from Postgres, not Redis), and
 *     Redis being down is itself alarmed on.
 *
 * The second is plainly the better trade for telemetry. SessionReplayRate-
 * Limiter fails CLOSED because a recording is a video of a real person and a
 * budget that cannot be counted cannot be honoured - accepting an unbounded
 * volume of that is not a recoverable mistake. Same machinery, opposite
 * answer, because the thing being protected is different.
 */

const RATE_KEY_PREFIX: string = "telemetry:ingestkey:rate:";

/*
 * Two minutes, so the counter for a minute bucket outlives the bucket it
 * belongs to. A request landing right on a boundary cannot then read a key
 * that was already reclaimed mid-window and be handed a fresh allowance.
 */
const RATE_TTL_SECONDS: number = 120;

const WINDOW_MS: number = 60000;

/*
 * A Redis outage puts EVERY request on the unavailable path, so an unguarded
 * log line there is one line per ingested request for as long as the outage
 * lasts - the ingest path is the highest-volume surface in the product, so
 * that buries the very incident it is reporting. One line per interval is
 * enough to make the condition visible. Same idea as the throttle in
 * Common/Server/Middleware/PublicDashboardRateLimit.ts.
 */
const COUNTER_UNAVAILABLE_LOG_INTERVAL_MS: number = 60 * 1000;

export enum TelemetryIngestionKeyLimitOutcome {
  /* Within this key's per-minute allowance. */
  Allowed = "allowed",

  /* Over the allowance. Retryable when the fixed window rolls. */
  RateLimited = "rate-limited",

  /*
   * Redis is unreachable, so no limit can be honoured either way. The caller
   * admits the request - see the fail-open rationale at the top of the file.
   */
  CounterUnavailable = "counter-unavailable",
}

export interface TelemetryIngestionKeyLimitDecision {
  outcome: TelemetryIngestionKeyLimitOutcome;
  retryAfterSeconds?: number | undefined;

  /*
   * True only on the request that first crossed the line in this window.
   *
   * The whole point of a limiter is that the rejected caller keeps knocking,
   * so a caller that logs every refusal turns an ingest flood into a second
   * flood in the log pipeline. Logging only the crossing gives exactly one
   * line per key per minute, which is what an operator actually wants when
   * they are trying to see WHICH key is being abused. Unset unless rejected.
   */
  isFirstRejectionInWindow?: boolean | undefined;
}

export default class TelemetryIngestionKeyRateLimiter {
  /*
   * Consume one request from this key's per-minute allowance.
   *
   * Fixed window keyed on the minute bucket, deliberately not a sliding
   * window: the sliding version needs a sorted set per key and a read of it
   * per request, and this runs in front of every OTLP payload the product
   * accepts. A fixed window admits at most 2x the limit across an unlucky
   * boundary pair, which is an entirely acceptable overshoot for an
   * abuse ceiling and costs one INCR.
   *
   * The counter is incremented on rejected requests too. That is standard
   * fixed-window behaviour and it is the point: a client hammering a scraped
   * key keeps its own window pinned rather than being handed a fresh
   * allowance for free by virtue of having been refused.
   */
  public static async consume(data: {
    ingestionKeyId: ObjectID;
    limitPerMinute: number;
  }): Promise<TelemetryIngestionKeyLimitDecision> {
    /*
     * A non-positive or non-finite limit means "no limit" rather than "block
     * everything", and short-circuits before Redis is touched.
     *
     * The column behind this is nullable and the caller resolves NULL to the
     * shipped browser default (or to unlimited for a Server key), so a zero
     * or garbage value reaching here is a bug or a bad row, not a customer
     * asking for a total block. Reading it as a block would silently black
     * out that key's ingest, and this file's whole posture (above) is that a
     * malfunction in the limiter must not stop real telemetry.
     */
    if (!Number.isFinite(data.limitPerMinute) || data.limitPerMinute <= 0) {
      return { outcome: TelemetryIngestionKeyLimitOutcome.Allowed };
    }

    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return { outcome: TelemetryIngestionKeyLimitOutcome.CounterUnavailable };
    }

    const minuteBucket: number = Math.floor(Date.now() / WINDOW_MS);
    const key: string = `${RATE_KEY_PREFIX}${data.ingestionKeyId.toString()}:${minuteBucket}`;

    try {
      const total: number = await client.incr(key);

      /*
       * Set the expiry only on the write that CREATED the key. Re-issuing
       * EXPIRE on every increment would slide the window forward for as long
       * as the load continues, so the counter would never reset and a key
       * that tripped its limit once under sustained traffic could never
       * recover - which is precisely the state an attacker's loop produces.
       */
      if (total === 1) {
        await client.expire(key, RATE_TTL_SECONDS);
      }

      if (total > data.limitPerMinute) {
        return {
          outcome: TelemetryIngestionKeyLimitOutcome.RateLimited,
          retryAfterSeconds:
            TelemetryIngestionKeyRateLimiter.getSecondsUntilWindowEnd(),

          /*
           * total is monotonic within the window, so the request that took
           * it to limit + 1 is the unique first rejection.
           */
          isFirstRejectionInWindow: total === data.limitPerMinute + 1,
        };
      }

      return { outcome: TelemetryIngestionKeyLimitOutcome.Allowed };
    } catch (err) {
      if (TelemetryIngestionKeyRateLimiter.shouldLogCounterUnavailable()) {
        logger.warn(
          `TelemetryIngestionKeyRateLimiter: counter failed for ingestion key ${data.ingestionKeyId.toString()}, admitting request unthrottled`,
        );
        logger.warn(err);
      }

      return { outcome: TelemetryIngestionKeyLimitOutcome.CounterUnavailable };
    }
  }

  /*
   * Remaining whole seconds in the current fixed window, floored at 1.
   *
   * Every rejected client is told to come back exactly when the window rolls
   * rather than all backing off by the same constant - a constant makes every
   * refused caller retry in lockstep and re-collide, which is a
   * self-inflicted thundering herd on top of the burst being limited.
   */
  private static getSecondsUntilWindowEnd(): number {
    const msIntoWindow: number = Date.now() % WINDOW_MS;

    return Math.max(1, Math.ceil((WINDOW_MS - msIntoWindow) / 1000));
  }

  private static counterUnavailableLastLoggedAt: number = 0;

  private static shouldLogCounterUnavailable(): boolean {
    const now: number = Date.now();

    if (
      now - TelemetryIngestionKeyRateLimiter.counterUnavailableLastLoggedAt <
      COUNTER_UNAVAILABLE_LOG_INTERVAL_MS
    ) {
      return false;
    }

    TelemetryIngestionKeyRateLimiter.counterUnavailableLastLoggedAt = now;

    return true;
  }
}

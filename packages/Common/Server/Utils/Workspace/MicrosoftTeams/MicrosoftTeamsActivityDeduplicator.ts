import { JSONObject } from "../../../../Types/JSON";
import ErrorClass from "../../../../Types/Telemetry/ErrorClass";
import { ERROR_CLASS_ATTRIBUTE_KEY } from "../../../../Types/Telemetry/UnitOfWork";
import GlobalCache from "../../../Infrastructure/GlobalCache";
import InMemoryTTLCache from "../../../Infrastructure/InMemoryTTLCache";
import Redis from "../../../Infrastructure/Redis";
import logger, { LogAttributes } from "../../Logger";

/*
 * Teams delivers an activity again when the bot was slow to answer it
 * (documented: more than 15 seconds) and, in practice, when the bot answered
 * it with an error. The redelivery carries the same activity id. Without a
 * guard the user sees every reply twice, and a submitted form creates two
 * incidents (issue #4111 showed each error bubble twice). Claiming the id
 * before acting on an activity turns every delivery after the first into a
 * no-op.
 *
 * The claim is shared through Redis, because a redelivery can reach another
 * App instance, and kept in this process's memory as well. When Redis is
 * disconnected the memory decides at once; when it is slow, after at most
 * REDIS_CLAIM_TIMEOUT_IN_MS. Memory alone still covers a single instance.
 */

const CLAIM_NAMESPACE: string = "microsoft-teams-inbound-activity";

// Redeliveries arrive within seconds; ten minutes leaves a wide margin.
const CLAIM_TTL_IN_SECONDS: number = 10 * 60;

// How long a Redis claim may take before this process's memory decides.
const REDIS_CLAIM_TIMEOUT_IN_MS: number = 2000;

// A Redis fallback is logged at most this often; each message would repeat it.
const FALLBACK_LOG_INTERVAL_IN_MS: number = 60 * 1000;

export default class MicrosoftTeamsActivityDeduplicator {
  private static localClaims: InMemoryTTLCache<boolean> =
    new InMemoryTTLCache<boolean>(10_000);

  private static lastFallbackLoggedAt: number = 0;

  /*
   * The key an activity is claimed under: its conversation and its id. Null
   * when the activity has no id, which Teams always sends.
   */
  public static getClaimKey(activity: JSONObject): string | null {
    const activityId: string = (activity["id"] as string | undefined) || "";

    if (!activityId) {
      return null;
    }

    const conversationId: string =
      ((activity["conversation"] as JSONObject | undefined)?.["id"] as
        | string
        | undefined) || "";

    return `${conversationId}|${activityId}`;
  }

  /*
   * True for the first delivery of an activity, false for a repeat. An
   * activity without an id is always processed.
   */
  public static async claim(activity: JSONObject): Promise<boolean> {
    const key: string | null = this.getClaimKey(activity);

    if (!key) {
      return true;
    }

    /*
     * This process's memory is consulted whatever Redis says: a claim made
     * here while Redis was down never reached Redis, so once Redis is back it
     * would let a redelivery of that activity through.
     */
    const isClaimedHere: boolean = this.localClaims.has(key);

    // A repeat leaves the claim alone, so it lapses with the Redis key.
    if (!isClaimedHere) {
      this.localClaims.set(key, true, CLAIM_TTL_IN_SECONDS * 1000);
    }

    // Asked even then, so that other App instances learn of the claim.
    const claimedInRedis: boolean | null = await this.claimInRedis(key);

    if (isClaimedHere) {
      return false;
    }

    return claimedInRedis ?? true;
  }

  // The Redis answer, or null when Redis could not answer in time.
  private static async claimInRedis(key: string): Promise<boolean | null> {
    let timeout: ReturnType<typeof setTimeout> | undefined = undefined;

    try {
      return await Promise.race([
        GlobalCache.setStringIfNotExists(CLAIM_NAMESPACE, key, "1", {
          expiresInSeconds: CLAIM_TTL_IN_SECONDS,
        }),
        new Promise<null>((resolve: (value: null) => void) => {
          timeout = setTimeout(() => {
            this.logFallback(
              `Redis did not answer within ${REDIS_CLAIM_TIMEOUT_IN_MS} ms`,
            );
            resolve(null);
          }, REDIS_CLAIM_TIMEOUT_IN_MS);
        }),
      ]);
    } catch (error) {
      this.logFallback("Redis refused the claim", error);
      return null;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  /*
   * Falling back to memory means a redelivery that reaches another App
   * instance is handled twice, which an operator should hear about. Logged at
   * error level (warn is dropped at the default LOG_LEVEL) and at most once a
   * minute. A process that never had a Redis client (a script, a test) has no
   * other instance to share with, so it only logs at debug.
   *
   * It never throws: it runs from the claim's catch and from its timeout, and
   * a throw there would lose the claim, or the reply, over a log line.
   */
  private static logFallback(reason: string, error?: unknown): void {
    try {
      const now: number = Date.now();

      if (
        !Redis.getClient() ||
        now - this.lastFallbackLoggedAt < FALLBACK_LOG_INTERVAL_IN_MS
      ) {
        logger.debug(
          `Microsoft Teams activity dedupe is using this process's memory: ${reason}`,
        );
        return;
      }

      this.lastFallbackLoggedAt = now;

      const attributes: LogAttributes = {
        [ERROR_CLASS_ATTRIBUTE_KEY]: ErrorClass.Infrastructure,
      };

      logger.error(
        `Microsoft Teams activity dedupe fell back to this process's memory (${reason}); a Teams redelivery that reaches another App instance may be handled twice.`,
        attributes,
      );

      if (error) {
        logger.error(error, attributes);
      }
    } catch {
      // Nothing to do: the claim goes on from memory either way.
    }
  }
}

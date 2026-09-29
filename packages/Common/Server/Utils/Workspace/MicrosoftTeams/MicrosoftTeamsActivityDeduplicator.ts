import { JSONObject } from "../../../../Types/JSON";
import GlobalCache from "../../../Infrastructure/GlobalCache";
import InMemoryTTLCache from "../../../Infrastructure/InMemoryTTLCache";
import logger from "../../Logger";

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
 * App instance. When Redis is down or slow the claim falls back to this
 * process's memory, which still covers a single instance and never holds up
 * the reply.
 */

const CLAIM_NAMESPACE: string = "microsoft-teams-inbound-activity";

// Redeliveries arrive within seconds; ten minutes leaves a wide margin.
const CLAIM_TTL_IN_SECONDS: number = 10 * 60;

// How long a Redis claim may take before this process's memory decides.
const REDIS_CLAIM_TIMEOUT_IN_MS: number = 2000;

export default class MicrosoftTeamsActivityDeduplicator {
  private static localClaims: InMemoryTTLCache<boolean> =
    new InMemoryTTLCache<boolean>(10_000);

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

    const claimedInRedis: boolean | null = await this.claimInRedis(key);

    if (claimedInRedis !== null) {
      /*
       * Remember it locally as well, so a Redis outage right after this does
       * not let a redelivery to this instance through.
       */
      this.localClaims.set(key, true, CLAIM_TTL_IN_SECONDS * 1000);
      return claimedInRedis;
    }

    if (this.localClaims.has(key)) {
      return false;
    }

    this.localClaims.set(key, true, CLAIM_TTL_IN_SECONDS * 1000);
    return true;
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
            resolve(null);
          }, REDIS_CLAIM_TIMEOUT_IN_MS);
        }),
      ]);
    } catch (error) {
      logger.debug(
        "Could not claim a Microsoft Teams activity in Redis; using this process's memory instead",
      );
      logger.debug(error);
      return null;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}

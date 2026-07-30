import Redis, { ClientType } from "../../Infrastructure/Redis";
import logger from "../Logger";
import ObjectID from "../../../Types/ObjectID";

/*
 * Cache state and invalidation for the session-replay gate.
 *
 * Split out of SessionReplayGateCache so the services that OWN the policy
 * rows (RumApplicationService, ProjectService) can invalidate it without
 * importing the resolver. The resolver imports both of those services, so a
 * direct import back would be a cycle; this module is a leaf that touches
 * only Redis and the logger.
 *
 * Two layers, because a policy change has to be honoured on two different
 * timescales:
 *
 *   - the process-local policy map, which the writing pod can drop
 *     immediately but other pods cannot;
 *   - a Redis kill key, which every pod consults on a 5s TTL, so "I turned
 *     this off" stops the fleet within seconds instead of within the 60s
 *     policy TTL plus the config endpoint's 300s browser cache.
 */

export const POLICY_CACHE_TTL_MS: number = 60 * 1000;
export const KILL_KEY_CACHE_TTL_MS: number = 5 * 1000;

const KILL_KEY_PREFIX: string = "replay:gate:off:";

/*
 * The kill key only has to outlive the policy cache it is racing. Anything
 * longer just keeps a project switched off after the policy cache has
 * already picked up the real setting.
 */
const KILL_KEY_TTL_SECONDS: number = 120;

export interface PolicyCacheEntry<TPolicy> {
  policy: TPolicy | null;
  loadedAt: number;
}

interface KillKeyCacheEntry {
  isDisabled: boolean;
  loadedAt: number;
}

/*
 * Untyped at this layer: the policy shape belongs to the resolver, and
 * parameterising this module on it would reintroduce the import it exists to
 * avoid. The resolver casts on read, which is safe because it is the only
 * writer.
 */
const policyCache: Map<string, PolicyCacheEntry<unknown>> = new Map();
const killKeyCache: Map<string, KillKeyCacheEntry> = new Map();

export default class SessionReplayGateCacheStore {
  public static getPolicyEntry<TPolicy>(
    cacheKey: string,
  ): PolicyCacheEntry<TPolicy> | undefined {
    return policyCache.get(cacheKey) as PolicyCacheEntry<TPolicy> | undefined;
  }

  public static setPolicyEntry<TPolicy>(
    cacheKey: string,
    policy: TPolicy | null,
  ): void {
    policyCache.set(cacheKey, { policy: policy, loadedAt: Date.now() });
  }

  /*
   * Switch a project off immediately, ahead of the policy cache.
   *
   * Called from the update path of the project / application settings so
   * "I turned this off" is honoured by the server within KILL_KEY_CACHE_TTL_MS
   * rather than within the policy cache TTL. Best-effort: a Redis outage only
   * means the ordinary cache expiry applies.
   */
  public static async markProjectDisabled(projectId: ObjectID): Promise<void> {
    const client: ClientType | null = Redis.getClient();

    if (client && Redis.isConnected()) {
      try {
        await client.set(
          `${KILL_KEY_PREFIX}${projectId.toString()}`,
          "1",
          "EX",
          KILL_KEY_TTL_SECONDS,
        );
      } catch (err) {
        logger.warn(
          `SessionReplayGateCacheStore: could not set the kill key for project ${projectId.toString()}`,
        );
        logger.warn(err);
      }
    }

    killKeyCache.set(projectId.toString(), {
      isDisabled: true,
      loadedAt: Date.now(),
    });
  }

  /*
   * Clear the kill key again, so re-enabling replay is honoured as promptly
   * as disabling it was. Without this a project switched off and back on
   * within KILL_KEY_TTL_SECONDS would keep being refused for the remainder
   * of the key's TTL even though its policy row says yes.
   */
  public static async clearProjectDisabled(projectId: ObjectID): Promise<void> {
    const client: ClientType | null = Redis.getClient();

    if (client && Redis.isConnected()) {
      try {
        await client.del(`${KILL_KEY_PREFIX}${projectId.toString()}`);
      } catch (err) {
        logger.warn(
          `SessionReplayGateCacheStore: could not clear the kill key for project ${projectId.toString()}`,
        );
        logger.warn(err);
      }
    }

    killKeyCache.delete(projectId.toString());
  }

  /* Drop cached policy for one project, or for everything. */
  public static clearCache(projectId?: ObjectID | undefined): void {
    if (!projectId) {
      policyCache.clear();
      killKeyCache.clear();
      return;
    }

    const prefix: string = `${projectId.toString()}:`;

    for (const key of Array.from(policyCache.keys())) {
      if (key.startsWith(prefix)) {
        policyCache.delete(key);
      }
    }

    killKeyCache.delete(projectId.toString());
  }

  public static async isProjectKilled(projectId: ObjectID): Promise<boolean> {
    const cacheKey: string = projectId.toString();

    const cached: KillKeyCacheEntry | undefined = killKeyCache.get(cacheKey);

    if (cached && Date.now() - cached.loadedAt < KILL_KEY_CACHE_TTL_MS) {
      return cached.isDisabled;
    }

    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      /*
       * Fail OPEN on this one check only, and only because it is a
       * fast-path override on top of a policy that already had to say yes.
       * Failing closed here would make a Redis blip stop replay ingest for
       * every project that had correctly opted in.
       */
      killKeyCache.set(cacheKey, { isDisabled: false, loadedAt: Date.now() });
      return false;
    }

    let isDisabled: boolean = false;

    try {
      const value: string | null = await client.get(
        `${KILL_KEY_PREFIX}${cacheKey}`,
      );
      isDisabled = value !== null;
    } catch (err) {
      logger.warn(
        `SessionReplayGateCacheStore: could not read the kill key for project ${cacheKey}`,
      );
      logger.warn(err);
      isDisabled = false;
    }

    killKeyCache.set(cacheKey, {
      isDisabled: isDisabled,
      loadedAt: Date.now(),
    });

    return isDisabled;
  }
}

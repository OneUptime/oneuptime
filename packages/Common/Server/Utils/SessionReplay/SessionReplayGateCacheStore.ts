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

/*
 * The policy cache key includes a client-supplied appIdentifier, so without a
 * bound anyone holding an ingestion key could grow this map forever. Caps
 * match the InMemoryTTLCache house default; that class is not used directly
 * because clearCache(projectId) needs the prefix key scan it lacks.
 */
export const MAX_POLICY_CACHE_ENTRIES: number = 10_000;
export const MAX_KILL_KEY_CACHE_ENTRIES: number = 10_000;

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

/*
 * Coarse-LRU bounded write (mirrors InMemoryTTLCache): evict the oldest entry
 * only when at capacity AND the key is new, so rewriting an existing key never
 * evicts a different entry; delete-before-set refreshes insertion order. The
 * entry being written always lands, which markProjectDisabled's local kill
 * marker depends on.
 */
function boundedSet<TValue>(
  map: Map<string, TValue>,
  key: string,
  value: TValue,
  maxEntries: number,
): void {
  if (map.size >= maxEntries && !map.has(key)) {
    const oldest: string | undefined = map.keys().next().value;
    if (oldest !== undefined) {
      map.delete(oldest);
    }
  }
  map.delete(key);
  map.set(key, value);
}

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
    boundedSet(
      policyCache,
      cacheKey,
      { policy: policy, loadedAt: Date.now() },
      MAX_POLICY_CACHE_ENTRIES,
    );
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

    boundedSet(
      killKeyCache,
      projectId.toString(),
      { isDisabled: true, loadedAt: Date.now() },
      MAX_KILL_KEY_CACHE_ENTRIES,
    );
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
      boundedSet(
        killKeyCache,
        cacheKey,
        { isDisabled: false, loadedAt: Date.now() },
        MAX_KILL_KEY_CACHE_ENTRIES,
      );
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

    boundedSet(
      killKeyCache,
      cacheKey,
      { isDisabled: isDisabled, loadedAt: Date.now() },
      MAX_KILL_KEY_CACHE_ENTRIES,
    );

    return isDisabled;
  }
}

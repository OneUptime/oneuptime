import GlobalCache from "./GlobalCache";
import InMemoryTTLCache from "./InMemoryTTLCache";
import logger from "../Utils/Logger";
import { RENDER_CONCURRENCY } from "../../Types/OnCallDutyPolicy/CalendarFeedWindow";
import { createHash, randomBytes } from "crypto";

/*
 * Caches for the on-call calendar feeds.
 *
 * Three things are cached, at three lifetimes:
 *
 *  1. Schedule segments. One schedule's resolved shifts over a window, shared
 *     by every subscriber of that schedule: N personal feeds, the schedule
 *     feed and the project feed all read one LayerUtil expansion instead of
 *     each doing their own. Apple Calendar's five-minute polls hit this.
 *
 *  2. Feed bodies. The rendered .ics plus its ETag/Last-Modified for one feed,
 *     short-lived (the same 300 s the Cache-Control header promises). A
 *     client that comes back within the TTL costs one Redis GET.
 *
 *  3. Last-good bodies. The most recent body that rendered successfully for a
 *     feed, kept for a day. Served -- with Warning: 110 -- when a render
 *     fails, hits the per-process render cap, or trips an iteration cap, so a
 *     transient failure degrades to "slightly stale" rather than to a 503
 *     that some clients answer by dropping the calendar.
 *
 * Invalidation is by scope generation, not by key scan. GlobalCache has no
 * SCAN, and a SCAN across a Redis that also backs BullMQ is not something a
 * hook should do. Instead every project, user-in-project and schedule has a
 * generation token in Redis; a cached body's real key mixes in the current
 * generations of every scope the feed depends on, so bumping a generation
 * makes every dependent entry unreachable in one write. Old entries age out on
 * their own TTLs. purgeForUser / purgeForSchedule / purgeForProject are those
 * bumps. Last-good bodies are the deliberate exception: their key embeds the
 * feed's own cache key -- which carries the token hash and the candidate
 * schedule set -- and nothing else, so a rotated token or a changed schedule
 * set can never reach one, while a hook-triggered purge does not throw away
 * the only thing standing between a failed render and a 503.
 *
 * Every GlobalCache call is wrapped: each one throws
 * DatabaseNotConnectedException when Redis is down, and the feeds must keep
 * working through that. Reads and writes fall back to a per-process
 * InMemoryTTLCache; generations are written to both so a purge made while
 * Redis is down still takes effect in this process. The in-memory tier is
 * consulted only when Redis fails -- it is never a first-level cache, so a
 * purge made by another process is not masked by a stale local copy.
 *
 * The render slots are the per-process concurrency cap on cache-miss renders.
 * Not Redis-backed on purpose: the thing being protected is THIS process's
 * event loop and heap, and a cap that vanishes when Redis blips would vanish
 * at exactly the moment every request becomes a miss.
 */

export const ON_CALL_CALENDAR_FEED_CACHE_NAMESPACE: string = "oncall-calendar";

/*
 * The shared window constant is the default; configure() exists so a test (or
 * an operator-facing knob, should one ever be added) can override it per
 * process without touching the pure-types package.
 */
export const DEFAULT_RENDER_CONCURRENCY: number = RENDER_CONCURRENCY;

/*
 * Bodies above this are not cached. The compose Redis has no maxmemory and
 * also backs BullMQ; a handful of multi-megabyte feeds is not what it is
 * sized for, and a body this large is already at the MAX_EVENTS ceiling.
 */
export const MAX_CACHED_BODY_BYTES: number = 2 * 1024 * 1024;

/* How long a last-good body is kept, in seconds. */
export const LAST_GOOD_TTL_SECONDS: number = 24 * 60 * 60;

/*
 * Generations are read on every feed request and only ever replaced, never
 * incremented, so they need no TTL at all -- but a key with no TTL is a leak
 * once its schedule or user is deleted. 30 days comfortably exceeds every
 * cache TTL that depends on them; an expired generation reads as the default
 * and simply starts a fresh key space.
 */
const GENERATION_TTL_SECONDS: number = 30 * 24 * 60 * 60;

/* Generation value when none has ever been written for a scope. */
const DEFAULT_GENERATION: string = "0";

const MEMORY_MAX_ENTRIES: number = 500;
const MEMORY_GENERATION_MAX_ENTRIES: number = 5000;

/*
 * What a feed body depends on, for invalidation. projectId is always known
 * (every feed is per project). userId is set for a personal feed.
 * scheduleIds are the candidate schedules the body was rendered from --
 * every schedule for a schedule/project feed, the user's candidates for a
 * personal one.
 */
export interface OnCallCalendarFeedCacheScope {
  projectId: string;
  userId?: string | undefined;
  scheduleIds?: Array<string> | undefined;
}

/* A rendered feed as the response helper wants it. */
export interface CachedCalendarBody {
  body: string;
  etag: string;
  lastModified: Date;
}

/* The wire form of CachedCalendarBody (Date as ISO 8601). */
interface SerializedCalendarBody {
  body: string;
  etag: string;
  lastModified: string;
}

export default class OnCallCalendarFeedCache {
  private static renderConcurrency: number = DEFAULT_RENDER_CONCURRENCY;
  private static activeRenderSlots: number = 0;

  private static memorySegments: InMemoryTTLCache<string> =
    new InMemoryTTLCache<string>(MEMORY_MAX_ENTRIES);
  private static memoryBodies: InMemoryTTLCache<string> =
    new InMemoryTTLCache<string>(MEMORY_MAX_ENTRIES);
  private static memoryLastGood: InMemoryTTLCache<string> =
    new InMemoryTTLCache<string>(MEMORY_MAX_ENTRIES);
  private static memoryGenerations: InMemoryTTLCache<string> =
    new InMemoryTTLCache<string>(MEMORY_GENERATION_MAX_ENTRIES);

  /*
   * In-flight renders by effective key, so two requests that miss the same
   * segment key in the same instant share one expansion instead of racing to
   * do it twice. Per process; Redis dedupes nothing here, and does not need
   * to -- the point is not to double the CPU spent on one miss.
   */
  private static inFlightRenders: Map<string, Promise<unknown>> = new Map();

  // -- Configuration -----------------------------------------------------

  public static configure(options: { renderConcurrency?: number }): void {
    if (
      options.renderConcurrency !== undefined &&
      Number.isInteger(options.renderConcurrency) &&
      options.renderConcurrency > 0
    ) {
      OnCallCalendarFeedCache.renderConcurrency = options.renderConcurrency;
    }
  }

  public static getRenderConcurrency(): number {
    return OnCallCalendarFeedCache.renderConcurrency;
  }

  /*
   * Drop every in-process fallback entry and release every slot. For tests
   * and for nothing else -- a running server has no reason to do this.
   */
  public static clearInProcessState(): void {
    OnCallCalendarFeedCache.memorySegments.clear();
    OnCallCalendarFeedCache.memoryBodies.clear();
    OnCallCalendarFeedCache.memoryLastGood.clear();
    OnCallCalendarFeedCache.memoryGenerations.clear();
    OnCallCalendarFeedCache.inFlightRenders.clear();
    OnCallCalendarFeedCache.activeRenderSlots = 0;
    OnCallCalendarFeedCache.renderConcurrency = DEFAULT_RENDER_CONCURRENCY;
  }

  // -- Render slots ------------------------------------------------------

  /*
   * Take a render slot, or refuse. The caller MUST release it in a finally
   * block; a leaked slot is one fewer render this process can do until it
   * restarts.
   */
  public static tryAcquireRenderSlot(): boolean {
    if (
      OnCallCalendarFeedCache.activeRenderSlots >=
      OnCallCalendarFeedCache.renderConcurrency
    ) {
      return false;
    }

    OnCallCalendarFeedCache.activeRenderSlots++;

    return true;
  }

  public static releaseRenderSlot(): void {
    if (OnCallCalendarFeedCache.activeRenderSlots > 0) {
      OnCallCalendarFeedCache.activeRenderSlots--;
    }
  }

  public static getActiveRenderSlots(): number {
    return OnCallCalendarFeedCache.activeRenderSlots;
  }

  // -- Schedule-level segment cache --------------------------------------

  /*
   * Read one schedule's resolved segments for `key`, rendering and storing
   * them on a miss. `key` should already carry everything the result depends
   * on (the shiftConfigVersion, the window, the day bucket); the schedule's
   * generation is mixed in here so purgeForSchedule invalidates it.
   *
   * The render function's result must survive JSON.stringify/JSON.parse --
   * Dates should be ISO strings or epoch numbers. The value handed back on a
   * hit is the parsed JSON, so callers must not rely on class instances.
   *
   * A render that throws is not cached and the error propagates; a cache that
   * throws is treated as a miss.
   */
  public static async getOrRenderScheduleSegments<T>(data: {
    scheduleId: string;
    key: string;
    ttlSeconds: number;
    render: () => Promise<T>;
  }): Promise<T> {
    const generation: string = await OnCallCalendarFeedCache.getGeneration(
      OnCallCalendarFeedCache.scheduleGenerationKey(data.scheduleId),
    );

    const effectiveKey: string = `seg:${OnCallCalendarFeedCache.digest(
      `${data.scheduleId}|${generation}|${data.key}`,
    )}`;

    const cached: string | null = await OnCallCalendarFeedCache.readString(
      effectiveKey,
      OnCallCalendarFeedCache.memorySegments,
    );

    if (cached !== null) {
      const parsed: T | undefined =
        OnCallCalendarFeedCache.parseJson<T>(cached);

      if (parsed !== undefined) {
        return parsed;
      }
    }

    const inFlight: Promise<unknown> | undefined =
      OnCallCalendarFeedCache.inFlightRenders.get(effectiveKey);

    if (inFlight) {
      return (await inFlight) as T;
    }

    const renderPromise: Promise<T> = (async (): Promise<T> => {
      const rendered: T = await data.render();

      await OnCallCalendarFeedCache.writeString(
        effectiveKey,
        JSON.stringify(rendered),
        data.ttlSeconds,
        OnCallCalendarFeedCache.memorySegments,
      );

      return rendered;
    })();

    OnCallCalendarFeedCache.inFlightRenders.set(effectiveKey, renderPromise);

    try {
      return await renderPromise;
    } finally {
      OnCallCalendarFeedCache.inFlightRenders.delete(effectiveKey);
    }
  }

  // -- Body cache --------------------------------------------------------

  public static async getBody(data: {
    key: string;
    scope: OnCallCalendarFeedCacheScope;
  }): Promise<CachedCalendarBody | null> {
    const effectiveKey: string = await OnCallCalendarFeedCache.bodyKey(
      data.key,
      data.scope,
    );

    const cached: string | null = await OnCallCalendarFeedCache.readString(
      effectiveKey,
      OnCallCalendarFeedCache.memoryBodies,
    );

    return OnCallCalendarFeedCache.deserializeBody(cached);
  }

  /*
   * Store a rendered body. Returns false, and stores nothing, when the body
   * is over MAX_CACHED_BODY_BYTES -- the caller still serves it, it just is
   * not kept.
   */
  public static async setBody(data: {
    key: string;
    scope: OnCallCalendarFeedCacheScope;
    value: CachedCalendarBody;
    ttlSeconds: number;
  }): Promise<boolean> {
    if (!OnCallCalendarFeedCache.isCacheableBody(data.value.body)) {
      return false;
    }

    const effectiveKey: string = await OnCallCalendarFeedCache.bodyKey(
      data.key,
      data.scope,
    );

    await OnCallCalendarFeedCache.writeString(
      effectiveKey,
      OnCallCalendarFeedCache.serializeBody(data.value),
      data.ttlSeconds,
      OnCallCalendarFeedCache.memoryBodies,
    );

    return true;
  }

  // -- Last-good (stale-while-error) -------------------------------------

  public static async getLastGood(
    key: string,
  ): Promise<CachedCalendarBody | null> {
    const cached: string | null = await OnCallCalendarFeedCache.readString(
      OnCallCalendarFeedCache.lastGoodKey(key),
      OnCallCalendarFeedCache.memoryLastGood,
    );

    return OnCallCalendarFeedCache.deserializeBody(cached);
  }

  public static async setLastGood(
    key: string,
    value: CachedCalendarBody,
  ): Promise<boolean> {
    if (!OnCallCalendarFeedCache.isCacheableBody(value.body)) {
      return false;
    }

    await OnCallCalendarFeedCache.writeString(
      OnCallCalendarFeedCache.lastGoodKey(key),
      OnCallCalendarFeedCache.serializeBody(value),
      LAST_GOOD_TTL_SECONDS,
      OnCallCalendarFeedCache.memoryLastGood,
    );

    return true;
  }

  // -- Purges ------------------------------------------------------------

  /*
   * Every body cached for this user's personal feed in this project. Called
   * on token rotation, on disable, and when the user leaves the project.
   */
  public static async purgeForUser(
    projectId: string,
    userId: string,
  ): Promise<void> {
    await OnCallCalendarFeedCache.bumpGeneration(
      OnCallCalendarFeedCache.userGenerationKey(projectId, userId),
    );
  }

  /*
   * The schedule's segment cache and every body that was rendered from it:
   * personal feeds of its members, its own shared feed, the project feed.
   * Called from the layer / layer-user / override / attachment hooks.
   */
  public static async purgeForSchedule(scheduleId: string): Promise<void> {
    await OnCallCalendarFeedCache.bumpGeneration(
      OnCallCalendarFeedCache.scheduleGenerationKey(scheduleId),
    );
  }

  /*
   * Every body in the project. Called when the project feed is rotated and
   * when a member leaving triggers rotation of the shared feeds.
   */
  public static async purgeForProject(projectId: string): Promise<void> {
    await OnCallCalendarFeedCache.bumpGeneration(
      OnCallCalendarFeedCache.projectGenerationKey(projectId),
    );
  }

  // -- Keys --------------------------------------------------------------

  /*
   * The real key of a body: the caller's key plus the current generation of
   * every scope the body depends on, digested so the Redis key stays short
   * whatever the schedule count. Generations are fetched concurrently; a
   * project feed over fifty schedules is fifty-two GETs in one round of
   * awaits, not fifty-two round trips in sequence.
   */
  private static async bodyKey(
    key: string,
    scope: OnCallCalendarFeedCacheScope,
  ): Promise<string> {
    const generationKeys: Array<string> = [
      OnCallCalendarFeedCache.projectGenerationKey(scope.projectId),
    ];

    if (scope.userId) {
      generationKeys.push(
        OnCallCalendarFeedCache.userGenerationKey(
          scope.projectId,
          scope.userId,
        ),
      );
    }

    for (const scheduleId of OnCallCalendarFeedCache.uniqueSorted(
      scope.scheduleIds || [],
    )) {
      generationKeys.push(
        OnCallCalendarFeedCache.scheduleGenerationKey(scheduleId),
      );
    }

    const generations: Array<string> = await Promise.all(
      generationKeys.map((generationKey: string): Promise<string> => {
        return OnCallCalendarFeedCache.getGeneration(generationKey);
      }),
    );

    return `body:${OnCallCalendarFeedCache.digest(
      `${key}|${generationKeys
        .map((generationKey: string, index: number): string => {
          return `${generationKey}=${generations[index]}`;
        })
        .join("|")}`,
    )}`;
  }

  private static lastGoodKey(key: string): string {
    return `lastgood:${OnCallCalendarFeedCache.digest(key)}`;
  }

  private static projectGenerationKey(projectId: string): string {
    return `gen:project:${projectId}`;
  }

  private static userGenerationKey(projectId: string, userId: string): string {
    return `gen:user:${projectId}:${userId}`;
  }

  private static scheduleGenerationKey(scheduleId: string): string {
    return `gen:schedule:${scheduleId}`;
  }

  private static digest(value: string): string {
    return createHash("sha256")
      .update(value, "utf8")
      .digest("hex")
      .slice(0, 40);
  }

  private static uniqueSorted(values: Array<string>): Array<string> {
    return Array.from(new Set(values)).sort();
  }

  // -- Generations -------------------------------------------------------

  /*
   * Redis first; the in-memory copy only when Redis fails. Reading memory
   * first would let a stale local generation hide a purge another process
   * made.
   */
  private static async getGeneration(generationKey: string): Promise<string> {
    try {
      const value: string | null = await GlobalCache.getString(
        ON_CALL_CALENDAR_FEED_CACHE_NAMESPACE,
        generationKey,
      );

      if (value) {
        return value;
      }

      return DEFAULT_GENERATION;
    } catch (err) {
      OnCallCalendarFeedCache.logCacheFailure("read generation", err);

      return (
        OnCallCalendarFeedCache.memoryGenerations.get(generationKey) ||
        DEFAULT_GENERATION
      );
    }
  }

  /*
   * A fresh random token, not an increment: GlobalCache has no INCR, and a
   * value nobody can predict cannot collide with a stale one. Written to
   * memory unconditionally so a purge made during a Redis outage is honoured
   * by this process straight away; the Redis write is best effort and logged.
   * Never throws -- hooks call this and must not fail over a cache.
   */
  private static async bumpGeneration(generationKey: string): Promise<void> {
    const generation: string = `${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;

    OnCallCalendarFeedCache.memoryGenerations.set(
      generationKey,
      generation,
      GENERATION_TTL_SECONDS * 1000,
    );

    try {
      await GlobalCache.setString(
        ON_CALL_CALENDAR_FEED_CACHE_NAMESPACE,
        generationKey,
        generation,
        { expiresInSeconds: GENERATION_TTL_SECONDS },
      );
    } catch (err) {
      OnCallCalendarFeedCache.logCacheFailure("write generation", err);
    }
  }

  // -- Storage tiers -----------------------------------------------------

  private static async readString(
    key: string,
    memory: InMemoryTTLCache<string>,
  ): Promise<string | null> {
    try {
      return await GlobalCache.getString(
        ON_CALL_CALENDAR_FEED_CACHE_NAMESPACE,
        key,
      );
    } catch (err) {
      OnCallCalendarFeedCache.logCacheFailure("read", err);

      return memory.get(key) ?? null;
    }
  }

  private static async writeString(
    key: string,
    value: string,
    ttlSeconds: number,
    memory: InMemoryTTLCache<string>,
  ): Promise<void> {
    const ttl: number = Math.max(1, Math.floor(ttlSeconds));

    try {
      await GlobalCache.setString(
        ON_CALL_CALENDAR_FEED_CACHE_NAMESPACE,
        key,
        value,
        { expiresInSeconds: ttl },
      );
    } catch (err) {
      OnCallCalendarFeedCache.logCacheFailure("write", err);
      memory.set(key, value, ttl * 1000);
    }
  }

  // -- Serialisation -----------------------------------------------------

  private static isCacheableBody(body: string): boolean {
    return Buffer.byteLength(body, "utf8") <= MAX_CACHED_BODY_BYTES;
  }

  private static serializeBody(value: CachedCalendarBody): string {
    const serialized: SerializedCalendarBody = {
      body: value.body,
      etag: value.etag,
      lastModified: value.lastModified.toISOString(),
    };

    return JSON.stringify(serialized);
  }

  /*
   * A corrupt or foreign entry is a miss, never an error: the worst case is
   * one extra render, which is what a miss costs anyway.
   */
  private static deserializeBody(
    cached: string | null,
  ): CachedCalendarBody | null {
    if (cached === null) {
      return null;
    }

    const parsed: SerializedCalendarBody | undefined =
      OnCallCalendarFeedCache.parseJson<SerializedCalendarBody>(cached);

    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.body !== "string" ||
      typeof parsed.etag !== "string" ||
      typeof parsed.lastModified !== "string"
    ) {
      return null;
    }

    const lastModified: Date = new Date(parsed.lastModified);

    if (Number.isNaN(lastModified.getTime())) {
      return null;
    }

    return {
      body: parsed.body,
      etag: parsed.etag,
      lastModified,
    };
  }

  private static parseJson<T>(value: string): T | undefined {
    try {
      return JSON.parse(value) as T;
    } catch {
      return undefined;
    }
  }

  // -- Logging -----------------------------------------------------------

  /*
   * Debug, not warn: when Redis is down every feed request takes this path
   * several times, and Redis being down is already alarmed on by the code
   * that owns the connection. The message never carries a key -- keys are
   * digests of token hashes, which is one hop closer to a token than a log
   * should get.
   */
  private static logCacheFailure(operation: string, err: unknown): void {
    logger.debug(
      `OnCallCalendarFeedCache: ${operation} failed, using in-process fallback`,
    );
    logger.debug(err);
  }
}

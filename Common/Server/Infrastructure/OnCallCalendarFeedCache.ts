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
 * sized for. Note that this is NOT the same ceiling as MAX_EVENTS: a VEVENT
 * is roughly 0.9 KB, so 2 MiB is crossed at about 2,200 events while
 * MAX_EVENTS allows 5,000. An hourly rotation over a long window is over this
 * cap and still well inside the event cap; such a feed is re-rendered on
 * every poll.
 */
export const MAX_CACHED_BODY_BYTES: number = 2 * 1024 * 1024;

/*
 * Last-good bodies get their own, larger ceiling. The body cache exists to
 * save work and can afford to skip the heaviest feeds; the last-good tier is
 * the only thing between a failed or capped render and a 503, and refusing it
 * for exactly the feeds most expensive to render -- the ones most likely to
 * trip the render cap -- removed the stale-while-error tier where it matters
 * most. It is written at most once per successful render and read only when
 * something has already gone wrong.
 */
export const MAX_CACHED_LAST_GOOD_BYTES: number = 8 * 1024 * 1024;

/*
 * A schedule's cached segments carry every user's shifts over the window; an
 * hourly rotation over the widest window is several megabytes. Cached, they
 * save the expansion for every subscriber of that schedule, so the ceiling is
 * generous -- but it is a ceiling: an entry above it is returned to the
 * caller and simply not stored, rather than pushed into a Redis with no
 * maxmemory that also backs BullMQ.
 */
export const MAX_CACHED_SEGMENT_BYTES: number = 8 * 1024 * 1024;

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
 * The in-process fallback tiers are bounded by BYTES as well as by entries.
 * They are only written while Redis is failing, but what they hold then are
 * whole calendar bodies and whole schedule expansions -- megabytes each -- so
 * an entry count alone bounds nothing: 500 multi-megabyte strings is most of
 * a container's heap. Entries also outlive their TTL (nothing reads a
 * fallback tier once Redis is healthy again, so nothing triggers the
 * expire-on-read), which is why the store sweeps expired entries when it
 * needs room.
 */
export const MEMORY_MAX_BYTES: number = 32 * 1024 * 1024;

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

/* One schedule's slot in a batched segment read. */
export interface ScheduleSegmentsCacheEntry {
  scheduleId: string;
  /* Everything the value depends on except the schedule's generation. */
  key: string;
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

interface MemoryEntry {
  value: string;
  bytes: number;
  expiresAt: number;
}

/*
 * The in-process fallback store: InMemoryTTLCache's coarse-LRU behaviour plus
 * a byte budget and a sweep. Not a change to InMemoryTTLCache itself -- every
 * other user of that class caches small values and does not need the
 * accounting (SessionReplayGateCacheStore keeps its own bounded store for the
 * same reason).
 */
class MemoryStringStore {
  private store: Map<string, MemoryEntry> = new Map();
  private bytes: number = 0;

  public constructor(
    private maxEntries: number,
    private maxBytes: number,
  ) {}

  public set(key: string, value: string, ttlMs: number): void {
    this.delete(key);

    const bytes: number = Buffer.byteLength(value, "utf8");

    /* A single value over the whole budget is not worth evicting for. */
    if (bytes > this.maxBytes) {
      return;
    }

    /*
     * Sweep on every write. Nothing reads these tiers while Redis is healthy,
     * so expire-on-read never fires for them: without this, an entry written
     * during an outage stays resident long past its TTL, until 500 newer
     * writes push it out. A write only happens while Redis is failing and the
     * store holds at most a few hundred entries, so the scan is free.
     */
    this.sweepExpired();

    /* Map iteration is insertion order, so the first key is the oldest. */
    while (
      this.store.size > 0 &&
      (this.store.size + 1 > this.maxEntries ||
        this.bytes + bytes > this.maxBytes)
    ) {
      const oldest: string | undefined = this.store.keys().next().value;

      if (oldest === undefined) {
        break;
      }

      this.delete(oldest);
    }

    this.store.set(key, { value, bytes, expiresAt: Date.now() + ttlMs });
    this.bytes += bytes;
  }

  public get(key: string): string | undefined {
    const entry: MemoryEntry | undefined = this.store.get(key);

    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return undefined;
    }

    return entry.value;
  }

  public delete(key: string): void {
    const entry: MemoryEntry | undefined = this.store.get(key);

    if (!entry) {
      return;
    }

    this.bytes -= entry.bytes;
    this.store.delete(key);
  }

  public clear(): void {
    this.store.clear();
    this.bytes = 0;
  }

  public size(): number {
    return this.store.size;
  }

  public byteSize(): number {
    return this.bytes;
  }

  private sweepExpired(): void {
    const now: number = Date.now();

    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.delete(key);
      }
    }
  }
}

export default class OnCallCalendarFeedCache {
  private static renderConcurrency: number = DEFAULT_RENDER_CONCURRENCY;
  private static activeRenderSlots: number = 0;

  private static memorySegments: MemoryStringStore = new MemoryStringStore(
    MEMORY_MAX_ENTRIES,
    MEMORY_MAX_BYTES,
  );
  private static memoryBodies: MemoryStringStore = new MemoryStringStore(
    MEMORY_MAX_ENTRIES,
    MEMORY_MAX_BYTES,
  );
  private static memoryLastGood: MemoryStringStore = new MemoryStringStore(
    MEMORY_MAX_ENTRIES,
    MEMORY_MAX_BYTES,
  );
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
  public static tryAcquireRenderSlot(
    options?: { leaveFreeSlots?: number | undefined } | undefined,
  ): boolean {
    /*
     * `leaveFreeSlots` keeps a caller out of the last few slots. Session
     * routes (/my-shifts) pass it so they can never take every slot away from
     * the public feed routes, whose callers are calendar clients that answer
     * a 503 with a stale or empty calendar. Clamped so it can never make the
     * budget zero.
     */
    const requestedReserve: number = options?.leaveFreeSlots ?? 0;

    const reserve: number = Math.min(
      Math.max(0, Math.floor(requestedReserve)),
      OnCallCalendarFeedCache.renderConcurrency - 1,
    );

    const budget: number = OnCallCalendarFeedCache.renderConcurrency - reserve;

    if (OnCallCalendarFeedCache.activeRenderSlots >= budget) {
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

  /* Bytes held by the three in-process fallback tiers. Tests and diagnostics. */
  public static getInProcessBytes(): number {
    return (
      OnCallCalendarFeedCache.memorySegments.byteSize() +
      OnCallCalendarFeedCache.memoryBodies.byteSize() +
      OnCallCalendarFeedCache.memoryLastGood.byteSize()
    );
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
    const rendered: Map<string, T> =
      await OnCallCalendarFeedCache.getOrRenderScheduleSegmentsBatch<T>({
        entries: [{ scheduleId: data.scheduleId, key: data.key }],
        ttlSeconds: data.ttlSeconds,
        renderMissing: async (
          missing: Array<ScheduleSegmentsCacheEntry>,
        ): Promise<Map<string, T>> => {
          const out: Map<string, T> = new Map();

          if (missing.length > 0) {
            out.set(data.scheduleId, await data.render());
          }

          return out;
        },
      });

    const value: T | undefined = rendered.get(data.scheduleId);

    if (value === undefined) {
      throw new Error(
        "OnCallCalendarFeedCache: the schedule segment render produced no value.",
      );
    }

    return value;
  }

  /*
   * The same thing for MANY schedules at once, which is how a feed render
   * actually reads: a project feed wants every schedule in the project, a
   * personal feed every schedule its subscriber is on.
   *
   * Reading them one at a time meant one materialization per schedule, and
   * each of those is a schedule query, three IN queries, an override query
   * and a users/project lookup -- roughly seven round trips PER SCHEDULE,
   * with the same user and project rows re-read every time, all fanned out
   * concurrently against a fifty-connection pool. `renderMissing` is called
   * ONCE with every schedule that missed, so the batched resolver behind it
   * does that work in a handful of IN queries for the whole feed.
   *
   * Hits, in-flight renders (a schedule another feed is already expanding)
   * and misses are separated first; only the misses reach `renderMissing`,
   * which MUST return an entry for every id it is given. Each result is
   * stored under its own key, so a schedule expanded for one feed is a hit
   * for the next.
   */
  public static async getOrRenderScheduleSegmentsBatch<T>(data: {
    entries: Array<ScheduleSegmentsCacheEntry>;
    ttlSeconds: number;
    renderMissing: (
      missing: Array<ScheduleSegmentsCacheEntry>,
    ) => Promise<Map<string, T>>;
  }): Promise<Map<string, T>> {
    const result: Map<string, T> = new Map();

    /* One entry per schedule; a repeated id is one read and one render. */
    const entries: Array<ScheduleSegmentsCacheEntry> = [];
    const seen: Set<string> = new Set();

    for (const entry of data.entries) {
      if (seen.has(entry.scheduleId)) {
        continue;
      }

      seen.add(entry.scheduleId);
      entries.push(entry);
    }

    if (entries.length === 0) {
      return result;
    }

    const effectiveKeys: Map<string, string> = new Map();

    await Promise.all(
      entries.map(async (entry: ScheduleSegmentsCacheEntry): Promise<void> => {
        const generation: string = await OnCallCalendarFeedCache.getGeneration(
          OnCallCalendarFeedCache.scheduleGenerationKey(entry.scheduleId),
        );

        effectiveKeys.set(
          entry.scheduleId,
          `seg:${OnCallCalendarFeedCache.digest(
            `${entry.scheduleId}|${generation}|${entry.key}`,
          )}`,
        );
      }),
    );

    const reads: Array<{
      entry: ScheduleSegmentsCacheEntry;
      parsed: T | undefined;
    }> = await Promise.all(
      entries.map(
        async (
          entry: ScheduleSegmentsCacheEntry,
        ): Promise<{
          entry: ScheduleSegmentsCacheEntry;
          parsed: T | undefined;
        }> => {
          const cached: string | null =
            await OnCallCalendarFeedCache.readString(
              effectiveKeys.get(entry.scheduleId) as string,
              OnCallCalendarFeedCache.memorySegments,
            );

          return {
            entry,
            parsed:
              cached === null
                ? undefined
                : OnCallCalendarFeedCache.parseJson<T>(cached),
          };
        },
      ),
    );

    const missing: Array<ScheduleSegmentsCacheEntry> = [];
    const joining: Array<ScheduleSegmentsCacheEntry> = [];

    /*
     * From here to the in-flight registration below there is NO await: a
     * concurrent caller must not be able to look at the in-flight map between
     * this check and the registration, or two requests that missed the same
     * key in the same instant would both render it.
     */
    for (const read of reads) {
      if (read.parsed !== undefined) {
        result.set(read.entry.scheduleId, read.parsed);
        continue;
      }

      if (
        OnCallCalendarFeedCache.inFlightRenders.has(
          effectiveKeys.get(read.entry.scheduleId) as string,
        )
      ) {
        joining.push(read.entry);
        continue;
      }

      missing.push(read.entry);
    }

    const registered: Array<string> = [];

    let renderPromise: Promise<Map<string, T>> | null = null;

    if (missing.length > 0) {
      renderPromise = (async (): Promise<Map<string, T>> => {
        const rendered: Map<string, T> = await data.renderMissing(missing);

        await Promise.all(
          missing.map(
            async (entry: ScheduleSegmentsCacheEntry): Promise<void> => {
              const value: T | undefined = rendered.get(entry.scheduleId);

              if (value === undefined) {
                return;
              }

              const serialized: string = JSON.stringify(value);

              if (
                !OnCallCalendarFeedCache.isWithinLimit(
                  serialized,
                  MAX_CACHED_SEGMENT_BYTES,
                  "schedule segment",
                )
              ) {
                return;
              }

              await OnCallCalendarFeedCache.writeString(
                effectiveKeys.get(entry.scheduleId) as string,
                serialized,
                data.ttlSeconds,
                OnCallCalendarFeedCache.memorySegments,
              );
            },
          ),
        );

        return rendered;
      })();

      for (const entry of missing) {
        const effectiveKey: string = effectiveKeys.get(
          entry.scheduleId,
        ) as string;

        const view: Promise<T | undefined> = renderPromise.then(
          (rendered: Map<string, T>): T | undefined => {
            return rendered.get(entry.scheduleId);
          },
        );

        /*
         * A view nobody joins must not become an unhandled rejection when the
         * batch fails; the failure still reaches everyone who awaits it.
         */
        view.catch((): void => {});

        OnCallCalendarFeedCache.inFlightRenders.set(effectiveKey, view);
        registered.push(effectiveKey);
      }
    }

    try {
      await Promise.all([
        ...joining.map(
          async (entry: ScheduleSegmentsCacheEntry): Promise<void> => {
            const inFlight: Promise<unknown> | undefined =
              OnCallCalendarFeedCache.inFlightRenders.get(
                effectiveKeys.get(entry.scheduleId) as string,
              );

            if (!inFlight) {
              return;
            }

            const value: T | undefined = (await inFlight) as T | undefined;

            if (value !== undefined) {
              result.set(entry.scheduleId, value);
            }
          },
        ),
        (async (): Promise<void> => {
          if (!renderPromise) {
            return;
          }

          const rendered: Map<string, T> = await renderPromise;

          for (const entry of missing) {
            const value: T | undefined = rendered.get(entry.scheduleId);

            if (value !== undefined) {
              result.set(entry.scheduleId, value);
            }
          }
        })(),
      ]);
    } finally {
      for (const effectiveKey of registered) {
        OnCallCalendarFeedCache.inFlightRenders.delete(effectiveKey);
      }
    }

    return result;
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
    if (
      !OnCallCalendarFeedCache.isWithinLimit(
        data.value.body,
        MAX_CACHED_BODY_BYTES,
        "body",
      )
    ) {
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
    if (
      !OnCallCalendarFeedCache.isWithinLimit(
        value.body,
        MAX_CACHED_LAST_GOOD_BYTES,
        "last-good body",
      )
    ) {
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
    memory: MemoryStringStore,
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
    memory: MemoryStringStore,
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

  /*
   * Refusals are logged: a feed that is silently never cached looks exactly
   * like a feed that is cached and busy, and the only symptom is a render on
   * every poll.
   */
  private static isWithinLimit(
    value: string,
    maxBytes: number,
    what: string,
  ): boolean {
    const bytes: number = Buffer.byteLength(value, "utf8");

    if (bytes <= maxBytes) {
      return true;
    }

    logger.debug(
      `OnCallCalendarFeedCache: not caching a ${what} of ${bytes} bytes (limit ${maxBytes}).`,
    );

    return false;
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

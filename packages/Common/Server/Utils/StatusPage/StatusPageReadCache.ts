import InMemoryLruCache from "../../Infrastructure/InMemoryLruCache";
import ObjectID from "../../../Types/ObjectID";
import StatusPageOverviewCache, {
  SharedForm,
  StatusPageCacheKey,
} from "./StatusPageOverviewCache";
import StatusPageSharedReads, { SharedRead } from "./StatusPageSharedReads";

/*
 * What a status page reads for every visitor, kept for a few seconds: the
 * rules of who may read it, what its HTML is rendered with (/seo), its
 * settings (/master-page) and the lists its tabs show - each its own cache,
 * built the way the overview's is (StatusPageOverviewCache).
 *
 * A visitor's view used to read Postgres for each of them on every request,
 * and the lists on every open of a tab. Each is now kept per process under
 * the page and its project's generation, so the writes that start a new
 * generation of the page's overview - anything taken off the page, any
 * change to its settings, made in any process (CacheGenerations) - are a new
 * key for these at once too. What can only show more - a new incident, a
 * monitor's new status - is seen when the entry runs out, within its ttlMs.
 *
 * Who may read a page is asked on every request before any of these is: what
 * is kept is the same for every visitor who may. The rules themselves are
 * kept only while the page's generation is read from Redis
 * (keepOnlyWhileShared): a page made private stops being served at once in
 * the process that made the change and within a second everywhere else,
 * and while Redis cannot be reached every request reads them again.
 *
 * A page that does not exist, or whose project cannot be read, is read on
 * every request and never kept: ids nobody has cannot fill the cache.
 */

export interface StatusPageReadCacheOptions<T> {
  // What the reads are: the first part of their keys.
  kind: string;
  // How long a read is kept, at most, from when it started.
  ttlMs: number;
  // At most how many this process keeps.
  maxEntries: number;
  /*
   * For reads that can be large - a page's settings carry its images, a
   * list its incidents and notes: at most how many bytes (sizeOf) this
   * process keeps of them together, and the most one may take - a bigger
   * one is served as it was read, never kept. Left out, only maxEntries
   * bounds the cache.
   */
  maxBytes?: number | undefined;
  maxValueBytes?: number | undefined;
  sizeOf?: ((value: T) => number) | undefined;
  /*
   * How a read is written to Redis and read back, so one process makes it
   * for every process (StatusPageSharedReads). Left out, each process makes
   * its own.
   */
  shared?: SharedForm<T> | undefined;
  /*
   * Kept only while the page's generation is read from Redis, so a change
   * made in another process takes effect here within a second: while Redis
   * cannot be reached every request reads again. For what decides who may
   * read a page.
   */
  keepOnlyWhileShared?: boolean | undefined;
}

// A read as it is kept: boxed, so null and false are kept too.
interface Kept<T> {
  value: T;
}

export default class StatusPageReadCache<T> {
  // Every cache made, to clear them all at once (tests).
  private static caches: Array<StatusPageReadCache<unknown>> = [];

  private readonly options: StatusPageReadCacheOptions<T>;
  private kept: InMemoryLruCache<Kept<T>>;

  // Reads under way, so requests that miss together share one.
  private inFlight: Map<string, Promise<T>> = new Map();

  public constructor(options: StatusPageReadCacheOptions<T>) {
    this.options = options;
    this.kept = new InMemoryLruCache<Kept<T>>(() => {
      return {
        maxEntries: options.maxEntries,
        maxBytes: options.maxBytes ?? Number.POSITIVE_INFINITY,
        maxEntryBytes: options.maxValueBytes ?? Number.POSITIVE_INFINITY,
        sizeOf: (kept: Kept<T>): number => {
          return options.sizeOf ? options.sizeOf(kept.value) : 0;
        },
      };
    });
    StatusPageReadCache.caches.push(this as StatusPageReadCache<unknown>);
  }

  public get kind(): string {
    return this.options.kind;
  }

  public get ttlMs(): number {
    return this.options.ttlMs;
  }

  /*
   * The page's read: the one kept for it under its project's current
   * generation, else one made now by `read` (shared with any request for it
   * that arrives meanwhile) and kept. A failed read is never kept. What is
   * returned is shared between requests and must not be changed.
   */
  public async getOrRead(data: {
    statusPageId: ObjectID;
    // Anything else the read depends on, as part of its key.
    variant?: string | undefined;
    // The page's project; null when there is no such page.
    readProjectId: () => Promise<ObjectID | null>;
    read: () => Promise<T>;
    /*
     * Whether what was read may be kept - here and in Redis. False for a
     * read that found nothing worth keeping (an item the page does not
     * show): it is read again every time, and ids nobody has never fill the
     * cache. Left out, every read is kept.
     */
    shouldKeep?: ((value: T) => boolean) | undefined;
  }): Promise<T> {
    const pageKey: StatusPageCacheKey =
      await StatusPageOverviewCache.getPageKey({
        statusPageId: data.statusPageId,
        readProjectId: data.readProjectId,
      });

    if (
      !pageKey.hasProject ||
      (this.options.keepOnlyWhileShared && !pageKey.isShared)
    ) {
      return await data.read();
    }

    const key: string = [
      this.options.kind,
      data.variant || "",
      pageKey.key,
    ].join("|");

    const kept: Kept<T> | undefined = this.kept.get(key);

    if (kept) {
      return kept.value;
    }

    let reading: Promise<T> | undefined = this.inFlight.get(key);

    if (!reading) {
      const read: Promise<SharedRead<T>> =
        this.options.shared && pageKey.isShared
          ? StatusPageSharedReads.getOrBuild<T>({
              key: key,
              ttlMs: this.options.ttlMs,
              build: data.read,
              toJSON: this.options.shared.toJSON,
              fromJSON: this.options.shared.fromJSON,
              shouldKeep: data.shouldKeep,
            })
          : this.readHere(data.read);

      const started: Promise<T> = read.then((result: SharedRead<T>): T => {
        const lifetime: number = result.expiresAt - Date.now();

        if (
          lifetime > 0 &&
          (!data.shouldKeep || data.shouldKeep(result.value))
        ) {
          this.kept.set(key, { value: result.value }, lifetime);
        }

        return result.value;
      });

      reading = started;
      this.inFlight.set(key, started);

      started
        .catch(() => {
          // A failed read is never kept; the next request reads again.
        })
        .finally(() => {
          if (this.inFlight.get(key) === started) {
            this.inFlight.delete(key);
          }
        });
    }

    return await reading;
  }

  // Drops everything this cache keeps. For tests.
  public clear(): void {
    this.kept.clear();
    this.inFlight.clear();
  }

  // Drops everything every cache keeps. For tests.
  public static clearAll(): void {
    for (const cache of StatusPageReadCache.caches) {
      cache.clear();
    }
  }

  private async readHere(read: () => Promise<T>): Promise<SharedRead<T>> {
    const startedAt: number = Date.now();

    return { value: await read(), expiresAt: startedAt + this.options.ttlMs };
  }
}

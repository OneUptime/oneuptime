import GlobalCache from "../../Infrastructure/GlobalCache";
import logger from "../Logger";
import { randomBytes } from "crypto";

/*
 * What a status page shows, built once for every process: the second tier
 * behind each process's own cache of a page's overview and lists
 * (StatusPageOverviewCache, StatusPageReadCache).
 *
 * Each process used to build a busy page's overview for itself every time
 * its copy ran out - some thirty Postgres statements, on every pod, every 15
 * seconds, for every page someone was looking at. Kept in Redis as well, a
 * page is built by one process and read by the rest:
 *
 *   - A process that misses reads Redis. A value there that is still within
 *     its lifetime is served, and kept in the process until that lifetime
 *     ends - never longer than a value built here would be: the lifetime
 *     runs from when the build that made it started.
 *   - Missing there too, the process claims the build (SET NX, for
 *     BUILD_CLAIM_SECONDS). The one that claims it builds and writes the
 *     value back; any other waits for it, BUILD_WAIT_MS at most, reading
 *     Redis every BUILD_POLL_MS, and builds itself only when the value does
 *     not come - its claim given up, or its builder gone.
 *   - A value over MAX_ENTRY_BYTES is not written: it is kept in the process
 *     that built it alone, as before, rather than pushed into a Redis that
 *     also backs the job queues.
 *
 * Who may read what is never kept here. The keys are built by the caller
 * from the page, the generation of its project (StatusPageOverviewCache) and
 * what else the value depends on, and every route asks who may read the page
 * before it asks for one.
 *
 * Nothing here throws. A Redis that cannot be reached is a value not found,
 * a build claimed, and a write that is let go: each process builds for
 * itself, as it did before.
 */

export const STATUS_PAGE_SHARED_READS_NAMESPACE: string =
  "status-page-shared-reads";

// A value as a process reads it: the value, and when it stops being served.
export interface SharedRead<T> {
  value: T;
  // Its build's start, plus the read's lifetime (ms since the epoch).
  expiresAt: number;
}

// What is kept in Redis for a read.
interface SharedEntry {
  // When the build that made it started (ms since the epoch).
  builtAt: number;
  // When it stops being served (ms since the epoch).
  expiresAt: number;
  value: unknown;
}

/*
 * How far another process's clock may be ahead of this one's before what it
 * wrote is not believed: past that, a value is built here instead.
 */
const CLOCK_SKEW_TOLERANCE_MS: number = 5_000;

export interface SharedReadOptions<T> {
  // Everything the value depends on that must take effect at once.
  key: string;
  // How long a value is served, from when its build started.
  ttlMs: number;
  /*
   * When a value built now stops being served, if sooner: a value that
   * belongs to another - an overview's uptime history - runs out with it.
   */
  expiresAt?: number | undefined;
  build: () => Promise<T>;
  // The value as JSON, and back.
  toJSON: (value: T) => unknown;
  fromJSON: (json: unknown) => T;
}

export default class StatusPageSharedReads {
  // A value bigger than this is kept in the process that built it alone.
  public static MAX_ENTRY_BYTES: number = 2 * 1024 * 1024;

  /*
   * How long a process waits for the build another process claimed, at
   * most, and how often it reads Redis meanwhile.
   */
  public static BUILD_WAIT_MS: number = 3_000;
  public static BUILD_POLL_MS: number = 100;

  /*
   * How long a claim to build lasts: past the wait, so a process that gave
   * up waiting finds the claim of a builder that is gone run out.
   */
  public static readonly BUILD_CLAIM_SECONDS: number = 10;

  /*
   * The value kept in Redis under `key` while it is within its lifetime,
   * else one built now - by this process, or by the one that claimed the
   * build first - and written back. A failed build is never kept.
   */
  public static async getOrBuild<T>(
    options: SharedReadOptions<T>,
  ): Promise<SharedRead<T>> {
    const kept: SharedRead<T> | null = await this.read(options);

    if (kept) {
      return kept;
    }

    const claim: string | null = await this.claim(options.key);

    if (claim === null) {
      const waited: SharedRead<T> | null = await this.waitForBuild(options);

      if (waited) {
        return waited;
      }
    }

    const startedAt: number = Date.now();

    let value: T;

    try {
      value = await options.build();
    } catch (err) {
      if (claim) {
        // Whoever waits for it builds at once rather than at the end of the wait.
        void this.giveUpClaim(options.key, claim);
      }

      throw err;
    }

    const expiresAt: number = this.getExpiresAt(options, startedAt);

    void this.write(options, value, startedAt, expiresAt);

    return { value: value, expiresAt: expiresAt };
  }

  // When a value whose build started at `builtAt` stops being served.
  public static getExpiresAt(
    options: Pick<SharedReadOptions<unknown>, "ttlMs" | "expiresAt">,
    builtAt: number,
  ): number {
    const expiresAt: number = builtAt + options.ttlMs;

    return options.expiresAt !== undefined
      ? Math.min(expiresAt, options.expiresAt)
      : expiresAt;
  }

  /*
   * The value kept under `key` while it is within its lifetime; null when
   * there is none, it ran out, it cannot be read, or Redis cannot be
   * reached.
   */
  public static async read<T>(
    options: Pick<
      SharedReadOptions<T>,
      "key" | "ttlMs" | "expiresAt" | "fromJSON"
    >,
  ): Promise<SharedRead<T> | null> {
    let raw: string | null;

    try {
      raw = await GlobalCache.getString(
        STATUS_PAGE_SHARED_READS_NAMESPACE,
        this.entryKey(options.key),
      );
    } catch (err) {
      this.logFailure("read", err);
      return null;
    }

    return this.parse(options, raw);
  }

  // The claim key and the value key of a read.
  public static entryKey(key: string): string {
    return `value|${key}`;
  }

  public static claimKey(key: string): string {
    return `claim|${key}`;
  }

  /*
   * Claims the build of `key`: the claim's token when this process got it
   * - or Redis cannot be reached, so it builds for itself - and null when
   * another process holds it.
   */
  private static async claim(key: string): Promise<string | null> {
    const token: string = randomBytes(8).toString("hex");

    try {
      const isClaimed: boolean = await GlobalCache.setStringIfNotExists(
        STATUS_PAGE_SHARED_READS_NAMESPACE,
        this.claimKey(key),
        token,
        { expiresInSeconds: this.BUILD_CLAIM_SECONDS },
      );

      return isClaimed ? token : null;
    } catch (err) {
      this.logFailure("claim", err);
      return token;
    }
  }

  private static async giveUpClaim(key: string, token: string): Promise<void> {
    try {
      await GlobalCache.deleteKeyIfValue(
        STATUS_PAGE_SHARED_READS_NAMESPACE,
        this.claimKey(key),
        token,
      );
    } catch (err) {
      this.logFailure("release", err);
    }
  }

  /*
   * The value another process claimed the build of, once it is written;
   * null when the wait ends first, or the claim is given up or runs out
   * with no value written.
   */
  private static async waitForBuild<T>(
    options: SharedReadOptions<T>,
  ): Promise<SharedRead<T> | null> {
    const waitUntil: number = Date.now() + this.BUILD_WAIT_MS;

    while (Date.now() < waitUntil) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, this.BUILD_POLL_MS);
      });

      let found: Array<string | null>;

      try {
        found = await GlobalCache.getStrings(
          STATUS_PAGE_SHARED_READS_NAMESPACE,
          [this.entryKey(options.key), this.claimKey(options.key)],
        );
      } catch (err) {
        this.logFailure("read", err);
        return null;
      }

      const kept: SharedRead<T> | null = this.parse(options, found[0] || null);

      if (kept) {
        return kept;
      }

      if (!found[1]) {
        return null;
      }
    }

    return null;
  }

  // Writes a value built now, unless it is too big. Never throws.
  private static async write<T>(
    options: SharedReadOptions<T>,
    value: T,
    builtAt: number,
    expiresAt: number,
  ): Promise<void> {
    try {
      const entry: SharedEntry = {
        builtAt: builtAt,
        expiresAt: expiresAt,
        value: options.toJSON(value),
      };

      const raw: string = JSON.stringify(entry);

      if (Buffer.byteLength(raw, "utf8") > this.MAX_ENTRY_BYTES) {
        return;
      }

      const expiresInMs: number = expiresAt - Date.now();

      if (expiresInMs <= 0) {
        return;
      }

      await GlobalCache.setString(
        STATUS_PAGE_SHARED_READS_NAMESPACE,
        this.entryKey(options.key),
        raw,
        { expiresInSeconds: Math.max(1, Math.ceil(expiresInMs / 1000)) },
      );
    } catch (err) {
      this.logFailure("write", err);
    }
  }

  /*
   * A value read from Redis while it is within its lifetime - as this
   * process reckons it too: never past its build's start plus ttlMs (and
   * any expiresAt asked for), and never one from a clock too far ahead.
   */
  private static parse<T>(
    options: Pick<SharedReadOptions<T>, "ttlMs" | "expiresAt" | "fromJSON">,
    raw: string | null,
  ): SharedRead<T> | null {
    if (!raw) {
      return null;
    }

    try {
      const entry: SharedEntry = JSON.parse(raw) as SharedEntry;
      const now: number = Date.now();

      if (
        !entry ||
        typeof entry.builtAt !== "number" ||
        !Number.isFinite(entry.builtAt) ||
        typeof entry.expiresAt !== "number" ||
        !Number.isFinite(entry.expiresAt) ||
        entry.builtAt > now + CLOCK_SKEW_TOLERANCE_MS
      ) {
        return null;
      }

      const expiresAt: number = Math.min(
        entry.expiresAt,
        this.getExpiresAt(options, entry.builtAt),
      );

      if (expiresAt <= now) {
        return null;
      }

      return { value: options.fromJSON(entry.value), expiresAt: expiresAt };
    } catch (err) {
      this.logFailure("read", err);
      return null;
    }
  }

  /*
   * Debug only: while Redis is down every request takes this path, and Redis
   * being down is alarmed on by the code that owns the connection. Never
   * names a key.
   */
  private static logFailure(
    operation: "read" | "claim" | "release" | "write",
    err: unknown,
  ): void {
    logger.debug(
      `Shared status page reads: Redis ${operation} failed; this process builds for itself.`,
    );
    logger.debug(err);
  }
}

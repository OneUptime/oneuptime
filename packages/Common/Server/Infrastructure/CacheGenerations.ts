import GlobalCache from "./GlobalCache";
import InMemoryTTLCache from "./InMemoryTTLCache";
import logger from "../Utils/Logger";
import { randomBytes } from "crypto";

/*
 * Generations of what a cache keeps, by key: how one change makes everything
 * a cache kept under a key unreachable - in this process at once, and in
 * every other process through Redis - without finding or deleting the
 * entries themselves, which run out on their own lifetimes. A cache keeps
 * each entry under the generation its key had when the entry was built
 * (get), and a change starts a new generation (bump). The status page
 * overview (StatusPageOverviewCache) and the on-call calendar feeds
 * (OnCallCalendarFeedCache) both keep their entries this way.
 *
 * A generation has two parts:
 *
 *   - the shared part, a random token in Redis that every process reads:
 *     asked of Redis at most once per SHARED_READ_TTL_MS per key, and once
 *     by all the requests that ask together;
 *   - this process's own part: the token of a change made here, set at once,
 *     before Redis is asked anything.
 *
 * A change made here counts here at once, whatever Redis answers. Once
 * Redis has taken its token as the shared part, every process sees it
 * within SHARED_READ_TTL_MS, and this process no longer needs its own part:
 * every process keeps entries under one generation again. When Redis does
 * not take it, this process keeps its own part (for ttlSeconds), so the
 * change is never lost here - the shared part Redis still holds from before
 * never brings back what was kept before the change - and it writes the
 * change to Redis again, under a new token, the first time Redis answers it
 * about the key, so every other process sees it then too; until Redis takes
 * it, the change keeps counting here under its own token. A request that
 * read the shared part while a change was being made never gets the
 * generation from before the change.
 *
 * While Redis cannot be reached, the shared part reads as UNREACHABLE,
 * with the last shared part this process saw, remembered for
 * SHARED_READ_TTL_MS so a Redis that fails or stalls is asked once in that
 * time, not by every request. Entries kept meanwhile are never served once
 * Redis answers again, nor in a later outage once a change this process
 * heard of came between.
 *
 * Nothing here throws: a generation that cannot be read is one that
 * misses, and a change Redis does not take still counts here.
 */

// What a part of a generation reads as before any change started one.
export const DEFAULT_GENERATION: string = "0";

/*
 * What the shared part reads as while Redis cannot be reached: never a
 * token Redis holds, so entries kept meanwhile and entries kept while Redis
 * answers never meet.
 */
export const UNREACHABLE_GENERATION: string = "unreachable";

// How the two parts of a generation are joined.
const PARTS_SEPARATOR: string = ".";

export interface CacheGenerationsOptions {
  // The GlobalCache namespace the shared parts are kept under.
  namespace: string;
  /*
   * How long a generation is kept, in Redis and in this process, in
   * seconds: many times longer than anything a cache keeps under it, so one
   * that runs out is only ever read again by entries long gone.
   */
  ttlSeconds: number;
  // At most how many keys this process remembers parts of.
  maxKeys?: number | undefined;
  // What the generations are of, for the log - never a key.
  description: string;
}

// This process's own part of a key's generation, while it is needed.
interface OwnGeneration {
  token: string;
  // Redis did not take it: it is written again once Redis answers.
  isUnsent: boolean;
  // When it may be written again, after an attempt that failed (ms).
  retryAt: number;
}

// A read of a key's shared part under way.
interface SharedRead {
  promise: Promise<string>;
  /*
   * A change was made to the key since the read started: what it reads may
   * be from before the change, so it is not remembered.
   */
  isSuperseded: boolean;
}

// A key's shared part as a request got it.
interface SharedAnswer {
  shared: string;
  // Read while a change was being made: it may be from before the change.
  isSuperseded: boolean;
}

export default class CacheGenerations {
  /*
   * How long this process goes by a shared part it read before it asks
   * Redis again: a change made in another process is seen here within it.
   */
  public static readonly SHARED_READ_TTL_MS: number = 1_000;

  private readonly namespace: string;
  private readonly ttlSeconds: number;
  private readonly description: string;

  // Each key's shared part as last read from Redis, or written to it.
  private shared: InMemoryTTLCache<string>;

  // The last shared part this process saw of each key, for the outage marker.
  private lastSeen: InMemoryTTLCache<string>;

  // This process's own part of each key, while it is needed.
  private own: InMemoryTTLCache<OwnGeneration>;

  // Reads of shared parts under way, so requests that ask together share one.
  private reads: Map<string, SharedRead> = new Map();

  // Writes of own parts Redis did not take, under way: one per key.
  private resends: Map<string, Promise<void>> = new Map();

  public constructor(options: CacheGenerationsOptions) {
    const maxKeys: number = options.maxKeys || 10_000;

    this.namespace = options.namespace;
    this.ttlSeconds = options.ttlSeconds;
    this.description = options.description;
    this.shared = new InMemoryTTLCache<string>(maxKeys);
    this.lastSeen = new InMemoryTTLCache<string>(maxKeys);
    this.own = new InMemoryTTLCache<OwnGeneration>(maxKeys);
  }

  /*
   * A key's generation: its shared part and this process's own. A change
   * made here counts at once; one made in another process within
   * SHARED_READ_TTL_MS. Never throws.
   */
  public async get(key: string): Promise<string> {
    let shared: string = await this.getSharedAfterChanges(key);

    const own: OwnGeneration | undefined = this.own.get(key);

    if (
      own &&
      own.isUnsent &&
      !this.isUnreachable(shared) &&
      Date.now() >= own.retryAt
    ) {
      // Redis answers again: the change it did not take is written now.
      await this.resend(key, own);
      shared = await this.getSharedAfterChanges(key);
    }

    return [shared, this.own.get(key)?.token || DEFAULT_GENERATION].join(
      PARTS_SEPARATOR,
    );
  }

  /*
   * Starts a new generation of each key: here at once, before anything is
   * asked of Redis, and - through Redis - in every other process. Nothing
   * kept before is served again. Never throws.
   */
  public async bump(keys: Array<string>): Promise<void> {
    const started: Array<{ key: string; own: OwnGeneration }> = Array.from(
      new Set<string>(keys),
    ).map((key: string): { key: string; own: OwnGeneration } => {
      const own: OwnGeneration = {
        token: CacheGenerations.newToken(),
        isUnsent: false,
        retryAt: 0,
      };

      this.own.set(key, own, this.ttlSeconds * 1000);

      // A read that started before this change does not decide after it.
      this.supersedeRead(key);

      return { key, own };
    });

    // Every key's shared part together, not one after another.
    await Promise.all(
      started.map(
        async (change: { key: string; own: OwnGeneration }): Promise<void> => {
          await this.publish(change.key, change.own, change.own.token, "write");
        },
      ),
    );
  }

  // Drops everything this process keeps. For tests.
  public clear(): void {
    for (const read of this.reads.values()) {
      read.isSuperseded = true;
    }

    this.reads.clear();
    this.resends.clear();
    this.shared.clear();
    this.lastSeen.clear();
    this.own.clear();
  }

  // A new token: nobody can predict it, so it never meets one used before.
  public static newToken(): string {
    return `${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;
  }

  /*
   * A key's shared part as getShared answers it - unless a change was made
   * to the key while it was being read. Then what the change left counts
   * instead: the shared part it wrote, or this process's own part, which
   * keeps the generation apart from the one before while the change is not
   * in Redis; with neither left, Redis is read again. A request that asked
   * before a change never gets the generation from before it.
   */
  private async getSharedAfterChanges(key: string): Promise<string> {
    const answer: SharedAnswer = await this.getShared(key);

    if (!answer.isSuperseded) {
      return answer.shared;
    }

    const remembered: string | undefined = this.shared.get(key);

    if (remembered !== undefined) {
      return remembered;
    }

    if (this.own.get(key)) {
      return answer.shared;
    }

    return (await this.getShared(key)).shared;
  }

  /*
   * A key's shared part, as read from Redis at most SHARED_READ_TTL_MS ago;
   * requests that ask together share one read. UNREACHABLE while Redis
   * cannot be reached - remembered as long, so Redis is asked once in that
   * time.
   */
  private async getShared(key: string): Promise<SharedAnswer> {
    const remembered: string | undefined = this.shared.get(key);

    if (remembered !== undefined) {
      return { shared: remembered, isSuperseded: false };
    }

    let read: SharedRead | undefined = this.reads.get(key);

    if (!read) {
      const started: SharedRead = {
        isSuperseded: false,
        promise: Promise.resolve(DEFAULT_GENERATION),
      };

      started.promise = this.readShared(key, started).finally(() => {
        if (this.reads.get(key) === started) {
          this.reads.delete(key);
        }
      });

      this.reads.set(key, started);
      read = started;
    }

    const shared: string = await read.promise;

    return { shared, isSuperseded: read.isSuperseded };
  }

  private async readShared(key: string, read: SharedRead): Promise<string> {
    try {
      const shared: string =
        (await GlobalCache.getString(this.namespace, key)) ||
        DEFAULT_GENERATION;

      if (!read.isSuperseded) {
        this.remember(key, shared);
      }

      return shared;
    } catch (err) {
      const unreachable: string = this.getUnreachableGeneration(key);

      if (!read.isSuperseded) {
        this.shared.set(key, unreachable, CacheGenerations.SHARED_READ_TTL_MS);
      }

      this.logFailure("read", err);

      return unreachable;
    }
  }

  /*
   * Writes a change to Redis as the key's shared part, as `token`: the
   * change's own token, or a new one when it is written again. Once Redis
   * holds it, every process reads it, and this process no longer needs its
   * own part - unless a newer change of its own is under way. When Redis
   * does not take it, the own part stays, to be written again once Redis
   * answers. Never throws.
   */
  private async publish(
    key: string,
    own: OwnGeneration,
    token: string,
    operation: "write" | "resend",
  ): Promise<void> {
    try {
      await GlobalCache.setString(this.namespace, key, token, {
        expiresInSeconds: this.ttlSeconds,
      });
    } catch (err) {
      own.isUnsent = true;
      own.retryAt = Date.now() + CacheGenerations.SHARED_READ_TTL_MS;
      this.logFailure(operation, err);
      return;
    }

    // A read from before Redis held it does not decide after it.
    this.supersedeRead(key);
    this.remember(key, token);

    if (this.own.get(key) === own) {
      this.own.delete(key);
    }
  }

  /*
   * Writes a change Redis did not take, once at a time per key - under a
   * new token: the one it did not take may have reached Redis after all,
   * and been replaced since by a newer change of another process, which
   * writing it again would undo. Until Redis takes the new one, the change
   * keeps counting here under its own token, so a write that keeps failing
   * costs this process nothing it kept since. Nothing is written when a
   * newer change of this process is under way: it carries this one.
   */
  private async resend(key: string, unsent: OwnGeneration): Promise<void> {
    let resending: Promise<void> | undefined = this.resends.get(key);

    if (!resending) {
      const started: Promise<void> = (async (): Promise<void> => {
        if (this.own.get(key) !== unsent) {
          return;
        }

        await this.publish(key, unsent, CacheGenerations.newToken(), "resend");
      })().finally(() => {
        if (this.resends.get(key) === started) {
          this.resends.delete(key);
        }
      });

      this.resends.set(key, started);
      resending = started;
    }

    await resending;
  }

  private remember(key: string, shared: string): void {
    this.shared.set(key, shared, CacheGenerations.SHARED_READ_TTL_MS);
    this.lastSeen.set(key, shared, this.ttlSeconds * 1000);
  }

  private supersedeRead(key: string): void {
    const read: SharedRead | undefined = this.reads.get(key);

    if (read) {
      read.isSuperseded = true;
      this.reads.delete(key);
    }
  }

  /*
   * The shared part while Redis cannot be reached: UNREACHABLE, with the
   * last shared part this process saw of the key, so entries kept in an
   * outage are never served in a later one once a change came between.
   */
  private getUnreachableGeneration(key: string): string {
    const lastSeen: string | undefined = this.lastSeen.get(key);

    return lastSeen
      ? `${UNREACHABLE_GENERATION}:${lastSeen}`
      : UNREACHABLE_GENERATION;
  }

  private isUnreachable(shared: string): boolean {
    return (
      shared === UNREACHABLE_GENERATION ||
      shared.startsWith(`${UNREACHABLE_GENERATION}:`)
    );
  }

  /*
   * A change Redis did not take is a warning, once per change: until it is
   * written, other processes keep serving what was kept before it. A read,
   * or a change written again, is debug: while Redis is down every request
   * takes that path, and Redis being down is alarmed on by the code that
   * owns the connection. Never names a key: some caches build theirs from
   * secrets' digests.
   */
  private logFailure(
    operation: "read" | "write" | "resend",
    err: unknown,
  ): void {
    if (operation === "write") {
      logger.warn(
        `Generations of ${this.description}: Redis did not take a change, so it counts in this process only until Redis answers again: ${String(err)}`,
      );
      return;
    }

    logger.debug(
      `Generations of ${this.description}: Redis ${operation} failed; changes made in this process still count here.`,
    );
    logger.debug(err);
  }
}

/*
 * A COUNTER PER KEY, PER FIXED WINDOW, IN THIS PROCESS'S MEMORY.
 *
 * The Home service runs without Redis or a database (Index.ts checks
 * neither), so the one form it takes - the reseller inquiry - is limited
 * here, per process. With more than one Home replica each counts on its
 * own, which is enough for what this is for: keeping one sender, and all
 * senders together, from turning the form into a stream of email.
 *
 * Every request that reaches a counter counts, the ones it refuses too: a
 * sender that keeps knocking stays refused until its window ends, rather
 * than being let through again whenever it pauses.
 *
 * Memory is bounded: past `maxKeys` keys, finished windows are dropped
 * first, then the oldest. Dropping a key only ever forgets a count - it can
 * let one sender start again early, never refuse one that should not be.
 */

export interface RateLimitDecision {
  allowed: boolean;
  // Seconds until the window that refused the request ends; 0 when allowed.
  retryAfterSeconds: number;
}

export interface FixedWindowRateLimiterOptions {
  // Requests allowed per key in one window.
  limit: number;
  windowInMs: number;
  // How many keys are counted at once, at most.
  maxKeys: number;
  // The clock, in milliseconds; Date.now unless a test sets one.
  now?: (() => number) | undefined;
}

interface Window {
  startedAt: number;
  count: number;
}

export default class FixedWindowRateLimiter {
  private readonly limit: number;
  private readonly windowInMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;
  private readonly windows: Map<string, Window> = new Map<string, Window>();

  public constructor(options: FixedWindowRateLimiterOptions) {
    if (!(options.limit >= 1) || !(options.windowInMs >= 1)) {
      throw new Error("A rate limit needs a limit and a window of 1 or more.");
    }

    if (!(options.maxKeys >= 1)) {
      throw new Error("A rate limit needs room for at least one key.");
    }

    this.limit = Math.floor(options.limit);
    this.windowInMs = options.windowInMs;
    this.maxKeys = Math.floor(options.maxKeys);
    this.now =
      options.now ||
      ((): number => {
        return Date.now();
      });
  }

  // Counts one request for the key, and says whether it may go ahead.
  public consume(key: string): RateLimitDecision {
    const now: number = this.now();
    let window: Window | undefined = this.windows.get(key);

    if (!window || this.hasEnded(window, now)) {
      if (window) {
        // Re-inserted below, so the key moves to the newest end.
        this.windows.delete(key);
      }

      this.makeRoom(now);
      window = { startedAt: now, count: 0 };
      this.windows.set(key, window);
    }

    window.count++;

    if (window.count <= this.limit) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((window.startedAt + this.windowInMs - now) / 1000),
      ),
    };
  }

  // How many keys are being counted.
  public get size(): number {
    return this.windows.size;
  }

  private hasEnded(window: Window, now: number): boolean {
    /*
     * A clock that went back (a test, a corrected system clock) ends the
     * window too, rather than holding a key for longer than a window.
     */
    return now - window.startedAt >= this.windowInMs || now < window.startedAt;
  }

  // Frees a place for one more key.
  private makeRoom(now: number): void {
    if (this.windows.size < this.maxKeys) {
      return;
    }

    for (const [key, window] of this.windows) {
      if (this.hasEnded(window, now)) {
        this.windows.delete(key);
      }
    }

    // A Map keeps its keys in the order they were set: the oldest first.
    for (const key of this.windows.keys()) {
      if (this.windows.size < this.maxKeys) {
        break;
      }

      this.windows.delete(key);
    }
  }
}

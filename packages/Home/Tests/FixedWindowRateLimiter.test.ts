import FixedWindowRateLimiter, {
  RateLimitDecision,
} from "../Utils/FixedWindowRateLimiter";
import { describe, expect, test } from "@jest/globals";

/*
 * THE IN-MEMORY LIMITER BEHIND THE RESELLER FORM.
 *
 * Home has no Redis, so the form's per-sender and overall limits are
 * counted in the process. These pin the counting - a fixed window per key,
 * refused requests counted too, when a refused sender may come back - and
 * that the memory it holds stays bounded however many senders there are.
 */

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

interface Clock {
  now: () => number;
  advance: (milliseconds: number) => void;
  set: (milliseconds: number) => void;
}

function clock(start: number = 1_000_000): Clock {
  let current: number = start;

  return {
    now: (): number => {
      return current;
    },
    advance: (milliseconds: number): void => {
      current += milliseconds;
    },
    set: (milliseconds: number): void => {
      current = milliseconds;
    },
  };
}

function limiter(
  time: Clock,
  limit: number = 3,
  maxKeys: number = 100,
): FixedWindowRateLimiter {
  return new FixedWindowRateLimiter({
    limit: limit,
    windowInMs: HOUR,
    maxKeys: maxKeys,
    now: time.now,
  });
}

describe("a key's window", () => {
  test("lets the first `limit` requests through and refuses the next", () => {
    const time: Clock = clock();
    const counter: FixedWindowRateLimiter = limiter(time);

    expect(
      [1, 2, 3].map(() => {
        return counter.consume("203.0.113.7").allowed;
      }),
    ).toEqual([true, true, true]);
    expect(counter.consume("203.0.113.7")).toEqual({
      allowed: false,
      retryAfterSeconds: 3600,
    });
  });

  test("says when the refused sender may come back: when its window ends", () => {
    const time: Clock = clock();
    const counter: FixedWindowRateLimiter = limiter(time, 1);

    counter.consume("a");
    time.advance(20 * MINUTE + 500);

    const refused: RateLimitDecision = counter.consume("a");

    expect(refused.allowed).toBe(false);
    // 39 minutes and 59.5 seconds left, rounded up.
    expect(refused.retryAfterSeconds).toBe(40 * 60);
  });

  test("never says to come back in less than a second", () => {
    const time: Clock = clock();
    const counter: FixedWindowRateLimiter = limiter(time, 1);

    counter.consume("a");
    time.advance(HOUR - 1);

    expect(counter.consume("a")).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
  });

  test("counts the refused requests too: knocking again does not get a sender in", () => {
    const time: Clock = clock();
    const counter: FixedWindowRateLimiter = limiter(time, 2);

    counter.consume("a");
    counter.consume("a");

    for (let attempt: number = 0; attempt < 50; attempt++) {
      time.advance(MINUTE / 2);
      expect(counter.consume("a").allowed).toBe(false);
    }
  });

  test("starts again when the window is over", () => {
    const time: Clock = clock();
    const counter: FixedWindowRateLimiter = limiter(time, 2);

    counter.consume("a");
    counter.consume("a");
    expect(counter.consume("a").allowed).toBe(false);

    time.advance(HOUR);

    expect(counter.consume("a")).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(counter.consume("a").allowed).toBe(true);
    expect(counter.consume("a").allowed).toBe(false);
  });

  test("is a fixed window: it does not slide with each request", () => {
    const time: Clock = clock();
    const counter: FixedWindowRateLimiter = limiter(time, 2);

    counter.consume("a");
    time.advance(59 * MINUTE);
    counter.consume("a");
    time.advance(MINUTE);

    // The window that started an hour ago is over, so the count starts again.
    expect(counter.consume("a").allowed).toBe(true);
  });

  test("ends when the clock goes back, rather than holding a key longer than a window", () => {
    const time: Clock = clock(10 * HOUR);
    const counter: FixedWindowRateLimiter = limiter(time, 1);

    counter.consume("a");
    expect(counter.consume("a").allowed).toBe(false);

    time.set(9 * HOUR);

    expect(counter.consume("a").allowed).toBe(true);
  });
});

describe("keys", () => {
  test("are counted apart", () => {
    const time: Clock = clock();
    const counter: FixedWindowRateLimiter = limiter(time, 1);

    expect(counter.consume("203.0.113.7").allowed).toBe(true);
    expect(counter.consume("203.0.113.7").allowed).toBe(false);
    expect(counter.consume("198.51.100.4").allowed).toBe(true);
    expect(counter.consume("2001:db8::1").allowed).toBe(true);
  });

  test("are held at most maxKeys at a time, however many senders there are", () => {
    const time: Clock = clock();
    const counter: FixedWindowRateLimiter = limiter(time, 1, 1000);
    let largest: number = 0;

    // A sender on a new address every request, all inside one window.
    for (let sender: number = 0; sender < 30000; sender++) {
      counter.consume(`sender-${sender}`);
      largest = Math.max(largest, counter.size);
    }

    expect(largest).toBe(1000);
    expect(counter.size).toBe(1000);
    // The newest thousand are still counted: a second request is refused.
    expect(counter.consume("sender-29999").allowed).toBe(false);
    expect(counter.consume("sender-29001").allowed).toBe(false);
    // The first sender was forgotten long ago, so it starts a new window.
    expect(counter.consume("sender-0").allowed).toBe(true);
  });

  test("make room by dropping the oldest key, whose window ends first", () => {
    const time: Clock = clock();
    const counter: FixedWindowRateLimiter = limiter(time, 1, 3);

    counter.consume("old");
    time.advance(HOUR);
    counter.consume("current-1");
    counter.consume("current-2");
    // Full: the oldest key, whose window is over, makes room.
    counter.consume("new");

    expect(counter.size).toBe(3);
    // The others are still counted: their second request is refused.
    expect(counter.consume("current-1").allowed).toBe(false);
    expect(counter.consume("current-2").allowed).toBe(false);
    expect(counter.consume("new").allowed).toBe(false);
  });

  test("drop the oldest window even when none has finished", () => {
    const time: Clock = clock();
    const counter: FixedWindowRateLimiter = limiter(time, 1, 3);

    counter.consume("first");
    counter.consume("second");
    counter.consume("third");
    counter.consume("fourth");

    expect(counter.size).toBe(3);
    // first was forgotten, so it may start again; the others are still counted.
    expect(counter.consume("second").allowed).toBe(false);
    expect(counter.consume("third").allowed).toBe(false);
    expect(counter.consume("fourth").allowed).toBe(false);
  });

  test("a key whose window restarts moves to the newest end, so it is dropped last", () => {
    const time: Clock = clock();
    const counter: FixedWindowRateLimiter = limiter(time, 1, 2);

    counter.consume("a");
    time.advance(30 * MINUTE);
    counter.consume("b");
    time.advance(30 * MINUTE);
    // a's window is over and restarts now, after b's: a is the newest key.
    counter.consume("a");
    // Full, and neither window is over: the oldest, b, goes.
    counter.consume("c");

    expect(counter.size).toBe(2);
    expect(counter.consume("a").allowed).toBe(false);
    expect(counter.consume("c").allowed).toBe(false);
    // b was forgotten, so it starts a new window.
    expect(counter.consume("b").allowed).toBe(true);
  });
});

describe("a limiter", () => {
  test.each([
    ["a limit of 0", { limit: 0, windowInMs: HOUR, maxKeys: 1 }],
    ["a window of 0", { limit: 1, windowInMs: 0, maxKeys: 1 }],
    ["no room for keys", { limit: 1, windowInMs: HOUR, maxKeys: 0 }],
    ["a limit that is no number", { limit: Number.NaN, windowInMs: HOUR, maxKeys: 1 }],
  ])("with %s is refused", (_case: string, options: {
    limit: number;
    windowInMs: number;
    maxKeys: number;
  }) => {
    expect(() => {
      return new FixedWindowRateLimiter(options);
    }).toThrow();
  });

  test("reads the real clock unless it is given one", () => {
    const counter: FixedWindowRateLimiter = new FixedWindowRateLimiter({
      limit: 1,
      windowInMs: HOUR,
      maxKeys: 10,
    });

    expect(counter.consume("a").allowed).toBe(true);

    const refused: RateLimitDecision = counter.consume("a");

    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(3590);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(3600);
  });
});

import SingleFlight from "../../../Server/Utils/SingleFlight";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * SingleFlight collapses duplicate concurrent work inside one process.
 *
 * On the telemetry ingest path a single OTLP batch resolves the same service
 * once per resource — the collector config OneUptime ships emits hundreds of
 * resources per batch — so without coalescing, hundreds of coroutines
 * independently ask Redis the same question and throw the answer away. The
 * distributed fence downstream is still what guarantees correctness; this is
 * what stops each pod from paying for that guarantee N times over.
 *
 * Two properties carry the weight, and both are easy to break in a refactor:
 * the map entry must be removed when the work settles (or the process leaks a
 * promise per key, forever), and it must be removed only if it is still the
 * CURRENT entry (or a later leader's live run gets evicted and the next caller
 * starts a duplicate of work already underway).
 */

describe("SingleFlight", () => {
  beforeEach(() => {
    SingleFlight.clear();
  });

  afterEach(() => {
    SingleFlight.clear();
  });

  test("runs the work and returns its result", async () => {
    const result: string = await SingleFlight.run("key", async () => {
      return "value";
    });

    expect(result).toBe("value");
  });

  test("collapses concurrent callers of the same key into one run", async () => {
    let runs: number = 0;
    let release: (() => void) | null = null;

    const gate: Promise<void> = new Promise<void>((resolve: () => void) => {
      release = resolve;
    });

    const work: () => Promise<number> = async (): Promise<number> => {
      runs++;
      await gate;
      return runs;
    };

    const all: Promise<Array<number>> = Promise.all(
      Array.from({ length: 100 }, () => {
        return SingleFlight.run("key", work);
      }),
    );

    release!();
    const results: Array<number> = await all;

    expect(runs).toBe(1);
    expect(results).toHaveLength(100);
    expect(new Set(results)).toEqual(new Set([1]));
  });

  test("keeps different keys independent", async () => {
    let runs: number = 0;

    await Promise.all([
      SingleFlight.run("a", async () => {
        runs++;
      }),
      SingleFlight.run("b", async () => {
        runs++;
      }),
    ]);

    expect(runs).toBe(2);
  });

  /*
   * Coalescing applies only to work that is genuinely IN FLIGHT. Caching the
   * result beyond that would turn a latency optimisation into a correctness
   * hazard — the caller's next call must see the world as it is now.
   */
  test("does not cache across sequential calls", async () => {
    let runs: number = 0;

    await SingleFlight.run("key", async () => {
      runs++;
    });
    await SingleFlight.run("key", async () => {
      runs++;
    });

    expect(runs).toBe(2);
  });

  test("releases the key once the work settles", async () => {
    await SingleFlight.run("key", async () => {
      return "value";
    });

    expect(SingleFlight.inflightCount()).toBe(0);
  });

  test("propagates a rejection to every joined caller", async () => {
    let release: (() => void) | null = null;
    const gate: Promise<void> = new Promise<void>((resolve: () => void) => {
      release = resolve;
    });

    const work: () => Promise<void> = async (): Promise<void> => {
      await gate;
      throw new Error("boom");
    };

    const results: Array<Promise<void>> = Array.from({ length: 5 }, () => {
      return SingleFlight.run("key", work);
    });

    release!();

    for (const result of results) {
      await expect(result).rejects.toThrow("boom");
    }
  });

  /*
   * A leaked entry after a failure is the worst outcome available: the key
   * would be permanently occupied by a settled, rejected promise and every
   * future caller would inherit a stale error instead of retrying.
   */
  test("releases the key when the work rejects", async () => {
    await expect(
      SingleFlight.run("key", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(SingleFlight.inflightCount()).toBe(0);
  });

  test("recovers on the next call after a rejection", async () => {
    await expect(
      SingleFlight.run("key", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    await expect(
      SingleFlight.run("key", async () => {
        return "ok";
      }),
    ).resolves.toBe("ok");
  });

  /*
   * A synchronously-throwing callback must not escape past the bookkeeping —
   * calling it bare would leave the key registered forever.
   */
  test("releases the key when the work throws synchronously", async () => {
    await expect(
      SingleFlight.run("key", (): Promise<void> => {
        throw new Error("sync boom");
      }),
    ).rejects.toThrow("sync boom");

    expect(SingleFlight.inflightCount()).toBe(0);
  });

  test("tracks in-flight work while it is running", async () => {
    let release: (() => void) | null = null;
    const gate: Promise<void> = new Promise<void>((resolve: () => void) => {
      release = resolve;
    });

    const running: Promise<void> = SingleFlight.run("key", async () => {
      await gate;
    });

    expect(SingleFlight.inflightCount()).toBe(1);

    release!();
    await running;

    expect(SingleFlight.inflightCount()).toBe(0);
  });

  /*
   * The `finally` must not evict an entry it does not own. Without the
   * identity check, the first run's cleanup deletes the SECOND run's live
   * entry, and a third caller then starts a duplicate of work already
   * underway — precisely the stampede this class exists to prevent.
   */
  test("a finished run never evicts a later run's entry", async () => {
    await SingleFlight.run("key", async () => {
      return 1;
    });

    let release: (() => void) | null = null;
    const gate: Promise<void> = new Promise<void>((resolve: () => void) => {
      release = resolve;
    });

    let secondRuns: number = 0;
    const second: Promise<void> = SingleFlight.run("key", async () => {
      secondRuns++;
      await gate;
    });

    const joined: Promise<void> = SingleFlight.run("key", async () => {
      secondRuns++;
    });

    release!();
    await Promise.all([second, joined]);

    expect(secondRuns).toBe(1);
  });
});

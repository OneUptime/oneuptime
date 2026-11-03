/// <reference lib="es2021.weakref" />
import OldestKeyMap from "../../Utils/OldestKeyMap";
import {
  ComparedRuns,
  FastestRun,
  fastestRunsCompared,
} from "../Helpers/FastestRun";
import { SeededRandom, seededRandom } from "../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";
import v8 from "v8";
import vm from "vm";

/*
 * OldestKeyMap answers what map.keys().next() answers - the oldest key - in
 * constant time for a cache that evicts on every write, and lets go of
 * every value it deletes or replaces. What the tests hold it to:
 *   - it is a Map: the same entries, order, size and reads;
 *   - oldestKey() answers keys().next()'s key after every kind of change -
 *     in the three shapes the product's caches evict in (evict, then add;
 *     move a key to the end, then evict past the cap; add, then evict) and
 *     through deletes, writes over a key, clears and keys asked for and not
 *     deleted - in 200 seeded runs of 2,000 operations each;
 *   - asked twice before the key it answered is deleted, the same key;
 *   - nothing it deleted, replaced, cleared or evicted stays in memory (a
 *     forced garbage collection and WeakRefs), in each of those shapes;
 *   - in a full cache that evicts on every write, a fraction of the time of
 *     keys().next() (the two timed against each other).
 */

interface Payload {
  round: number;
}

/*
 * The product's three ways to evict, each as a write: `oldest` finds the
 * key to evict (oldestKey() here, keys().next() for the plain Map).
 */
type Oldest = (map: Map<string, Payload>) => string | undefined;

const fromOldestKeyMap: Oldest = (
  map: Map<string, Payload>,
): string | undefined => {
  return (map as OldestKeyMap<string, Payload>).oldestKey();
};

const fromNewIterator: Oldest = (
  map: Map<string, Payload>,
): string | undefined => {
  return map.keys().next().value;
};

// InProcessMemo, DnsResolutionCache: evict the oldest when full and the key is new, then add.
function evictThenAdd(
  map: Map<string, Payload>,
  oldest: Oldest,
  capacity: number,
  key: string,
  value: Payload,
): Array<string> {
  const evicted: Array<string> = [];

  if (map.size >= capacity && !map.has(key)) {
    const first: string | undefined = oldest(map);

    if (first !== undefined) {
      map.delete(first);
      evicted.push(first);
    }
  }

  map.set(key, value);

  return evicted;
}

// DateLanguage, VSphereSessionCache: the newest last, then evict past the cap.
function moveToEndThenEvict(
  map: Map<string, Payload>,
  oldest: Oldest,
  capacity: number,
  key: string,
  value: Payload,
): Array<string> {
  const evicted: Array<string> = [];

  map.delete(key);
  map.set(key, value);

  while (map.size > capacity) {
    const first: string | undefined = oldest(map);

    if (first === undefined) {
      break;
    }

    map.delete(first);
    evicted.push(first);
  }

  return evicted;
}

// SlackInlineImages, FlowAggregator: add (a key already there keeps its place), then evict past the cap.
function addThenEvict(
  map: Map<string, Payload>,
  oldest: Oldest,
  capacity: number,
  key: string,
  value: Payload,
): Array<string> {
  const evicted: Array<string> = [];

  map.set(key, value);

  while (map.size > capacity) {
    const first: string | undefined = oldest(map);

    if (first === undefined) {
      break;
    }

    map.delete(first);
    evicted.push(first);
  }

  return evicted;
}

type Write = (
  map: Map<string, Payload>,
  oldest: Oldest,
  capacity: number,
  key: string,
  value: Payload,
) => Array<string>;

const WRITES: Array<{ name: string; write: Write }> = [
  { name: "evict, then add", write: evictThenAdd },
  { name: "move to the end, then evict", write: moveToEndThenEvict },
  { name: "add, then evict", write: addThenEvict },
];

function keysOf(map: Map<string, unknown>): string {
  return Array.from(map.keys()).join(",");
}

describe("OldestKeyMap is a Map", () => {
  test("with a Map's entries, order, size and reads", () => {
    const map: OldestKeyMap<string, number> = new OldestKeyMap<
      string,
      number
    >();

    expect(map).toBeInstanceOf(Map);

    map.set("a", 1).set("b", 2).set("c", 3);
    map.set("a", 4);

    expect(Array.from(map.entries())).toEqual([
      ["a", 4],
      ["b", 2],
      ["c", 3],
    ]);
    expect(map.size).toBe(3);
    expect(map.get("b")).toBe(2);
    expect(map.has("c")).toBe(true);
    expect(map.delete("b")).toBe(true);
    expect(map.delete("b")).toBe(false);
    expect(Array.from(map.keys())).toEqual(["a", "c"]);

    const seen: Array<string> = [];
    map.forEach((value: number, key: string): void => {
      seen.push(`${key}=${value}`);
    });

    expect(seen).toEqual(["a=4", "c=3"]);

    map.clear();

    expect(map.size).toBe(0);
  });
});

describe("oldestKey()", () => {
  test("answers undefined for an empty map, and the first key of one filled later", () => {
    const map: OldestKeyMap<string, number> = new OldestKeyMap<
      string,
      number
    >();

    expect(map.oldestKey()).toBeUndefined();

    map.set("a", 1).set("b", 2);

    expect(map.oldestKey()).toBe("a");
  });

  test("answers each oldest key in turn as the one it answered is deleted, then undefined, then a key added after", () => {
    const map: OldestKeyMap<string, number> = new OldestKeyMap<
      string,
      number
    >();

    map.set("a", 1).set("b", 2).set("c", 3);

    const answered: Array<string | undefined> = [];

    for (let turn: number = 0; turn < 4; turn++) {
      const key: string | undefined = map.oldestKey();

      answered.push(key);

      if (key !== undefined) {
        map.delete(key);
      }
    }

    expect(answered).toEqual(["a", "b", "c", undefined]);

    map.set("d", 4);

    expect(map.oldestKey()).toBe("d");
  });

  test("asked again before the key it answered is deleted, answers that key again", () => {
    const map: OldestKeyMap<string, number> = new OldestKeyMap<
      string,
      number
    >();

    map.set("a", 1).set("b", 2);

    expect(map.oldestKey()).toBe("a");
    expect(map.oldestKey()).toBe("a");

    map.delete("a");

    expect(map.oldestKey()).toBe("b");
  });

  test("follows deletes ahead of it, a key written again, a key moved to the end and a clear", () => {
    const map: OldestKeyMap<string, number> = new OldestKeyMap<
      string,
      number
    >();

    map.set("a", 1).set("b", 2).set("c", 3).set("d", 4);

    expect(map.oldestKey()).toBe("a");
    map.delete("a");

    // The next key, deleted by someone else: the one after.
    map.delete("b");
    expect(map.oldestKey()).toBe("c");

    // Written over in place: keeps its place.
    map.set("c", 30);
    expect(map.oldestKey()).toBe("c");

    // Moved to the end.
    map.delete("c");
    map.set("c", 31);
    expect(map.oldestKey()).toBe("d");

    map.clear();
    expect(map.oldestKey()).toBeUndefined();

    map.set("e", 5);
    expect(map.oldestKey()).toBe("e");
  });

  test("200 seeded runs of 2,000 writes in each eviction shape, deletes, rewrites, clears and keys asked for twice answer what keys().next() answers", () => {
    const differences: Array<string> = [];

    for (let run: number = 0; run < 200; run++) {
      const random: SeededRandom = seededRandom(20261102 + run);
      const capacity: number = 1 + random(16);
      const fast: OldestKeyMap<string, Payload> = new OldestKeyMap<
        string,
        Payload
      >();
      const plain: Map<string, Payload> = new Map<string, Payload>();

      for (let step: number = 0; step < 2000; step++) {
        const key: string = `k${random(40)}`;
        const operation: number = random(100);
        const value: Payload = { round: step };

        if (operation < 75) {
          const shape: { name: string; write: Write } =
            WRITES[random(WRITES.length)]!;
          const evicted: string = shape
            .write(fast, fromOldestKeyMap, capacity, key, value)
            .join(",");
          const evictedBefore: string = shape
            .write(plain, fromNewIterator, capacity, key, value)
            .join(",");

          if (evicted !== evictedBefore) {
            differences.push(
              `run ${run} step ${step} (${shape.name}): evicted ${evicted} for ${evictedBefore}`,
            );
          }
        } else if (operation < 90) {
          fast.delete(key);
          plain.delete(key);
        } else if (operation < 96) {
          // A read of the oldest key nobody acts on.
          const asked: string | undefined = fast.oldestKey();
          const first: string | undefined = plain.keys().next().value;

          if (asked !== first) {
            differences.push(
              `run ${run} step ${step}: asked ${asked} for ${first}`,
            );
          }
        } else if (operation < 99) {
          // Written over in place.
          if (plain.has(key)) {
            fast.set(key, value);
            plain.set(key, value);
          }
        } else {
          fast.clear();
          plain.clear();
        }

        if (keysOf(fast) !== keysOf(plain)) {
          differences.push(
            `run ${run} step ${step}: kept ${keysOf(fast)} for ${keysOf(plain)}`,
          );
        }
      }
    }

    expect(differences).toEqual([]);
  });
});

/*
 * A full garbage collection, from inside a test. V8 exposes gc() under a
 * flag, and a context made after the flag is set has it; the flag adds that
 * function and changes nothing else in the worker.
 */
function garbageCollector(): () => void {
  v8.setFlagsFromString("--expose-gc");
  return vm.runInNewContext("gc") as () => void;
}

/*
 * Collects garbage, after the current job has ended: a WeakRef made or read
 * in the job that is running keeps its value alive until the job ends.
 */
async function collectGarbage(): Promise<void> {
  const gc: () => void = garbageCollector();

  for (let pass: number = 0; pass < 2; pass++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
    gc();
  }
}

/*
 * Runs `work` with a function that makes one value a round, and returns a
 * WeakRef to each by its round. The values are made in this synchronous
 * function rather than in the async test: a suspended async function keeps
 * its registers, and with them the last value it made.
 */
function valuesMadeIn(
  work: (make: (round: number) => Payload) => void,
): Map<number, WeakRef<Payload>> {
  const refs: Map<number, WeakRef<Payload>> = new Map();

  work((round: number): Payload => {
    const value: Payload = { round: round };

    refs.set(round, new WeakRef<Payload>(value));

    return value;
  });

  return refs;
}

function roundsAlive(refs: Map<number, WeakRef<Payload>>): Array<number> {
  const alive: Array<number> = [];

  for (const [round, ref] of refs) {
    if (ref.deref() !== undefined) {
      alive.push(round);
    }
  }

  return alive;
}

function roundsHeld(map: Map<string, Payload>): Array<number> {
  return Array.from(map.values())
    .map((value: Payload): number => {
      return value.round;
    })
    .sort((a: number, b: number): number => {
      return a - b;
    });
}

describe("OldestKeyMap lets go of what it no longer holds", () => {
  test("the collector this suite forces works: a value nothing refers to is collected, one still referred to is not", async () => {
    const kept: Array<Payload> = [];
    const refs: Map<number, WeakRef<Payload>> = valuesMadeIn(
      (make: (round: number) => Payload): void => {
        make(0);
        kept.push(make(1));
      },
    );

    await collectGarbage();

    expect(roundsAlive(refs)).toEqual([1]);
    expect(kept[0]!.round).toBe(1);
  });

  for (const shape of WRITES) {
    test(`full once, then churning below its cap (${shape.name}, deletes and rewrites): only the values it holds stay`, async () => {
      const map: OldestKeyMap<string, Payload> = new OldestKeyMap<
        string,
        Payload
      >();
      const CAPACITY: number = 100;
      const refs: Map<number, WeakRef<Payload>> = valuesMadeIn(
        (make: (round: number) => Payload): void => {
          let round: number = 0;

          // Full, evicting on every write.
          for (; round < 2 * CAPACITY; round++) {
            shape.write(
              map,
              fromOldestKeyMap,
              CAPACITY,
              `fill${round}`,
              make(round),
            );
          }

          // Then below the cap: deletes, rewrites and new keys.
          for (let churn: number = 0; churn < 5000; churn++, round++) {
            const key: string = `churn${churn % 60}`;

            if (churn % 3 === 0) {
              map.delete(`fill${churn % (2 * CAPACITY)}`);
              map.delete(`churn${(churn + 7) % 60}`);
            }

            map.set(key, make(round));
          }
        },
      );

      await collectGarbage();

      expect(roundsAlive(refs)).toEqual(roundsHeld(map));
      expect(map.size).toBeLessThanOrEqual(CAPACITY);
    });
  }

  test("evicting on every write for a long while: only the values it holds stay", async () => {
    const map: OldestKeyMap<string, Payload> = new OldestKeyMap<
      string,
      Payload
    >();
    const refs: Map<number, WeakRef<Payload>> = valuesMadeIn(
      (make: (round: number) => Payload): void => {
        for (let round: number = 0; round < 20000; round++) {
          evictThenAdd(map, fromOldestKeyMap, 50, `k${round}`, make(round));
        }
      },
    );

    await collectGarbage();

    expect(roundsAlive(refs)).toEqual(roundsHeld(map));
    expect(roundsHeld(map)).toHaveLength(50);
  });

  test("cleared, or written over: none of the values it let go of stays", async () => {
    const map: OldestKeyMap<string, Payload> = new OldestKeyMap<
      string,
      Payload
    >();
    const refs: Map<number, WeakRef<Payload>> = valuesMadeIn(
      (make: (round: number) => Payload): void => {
        for (let round: number = 0; round < 300; round++) {
          evictThenAdd(map, fromOldestKeyMap, 20, `k${round}`, make(round));
        }

        map.clear();

        for (let round: number = 300; round < 3300; round++) {
          // Ten keys, each written over again and again.
          map.set(`k${round % 10}`, make(round));
        }
      },
    );

    await collectGarbage();

    expect(roundsAlive(refs)).toEqual(roundsHeld(map));
    expect(roundsHeld(map)).toHaveLength(10);
  });
});

describe("OldestKeyMap in a full cache that evicts on every write", () => {
  test.each(WRITES)(
    "$name: costs a fraction of a new keys().next() per write",
    ({ write }: { write: Write }) => {
      const CAPACITY: number = 20000;
      const WRITES_TIMED: number = 25000;

      const churn: (map: Map<string, Payload>, oldest: Oldest) => number = (
        map: Map<string, Payload>,
        oldest: Oldest,
      ): number => {
        const value: Payload = { round: 0 };

        for (let index: number = 0; index < CAPACITY; index++) {
          map.set(`k${index}`, value);
        }
        for (let index: number = 0; index < WRITES_TIMED; index++) {
          write(map, oldest, CAPACITY, `n${index}`, value);
        }

        return map.size;
      };

      /*
       * Timed against each other, in turns (fastestRunsCompared): the
       * machine's speed cancels out, and one stall cannot slow one side alone.
       * Each attempt fills a map of its own.
       */
      const runs: ComparedRuns<number, number> = fastestRunsCompared({
        first: (): number => {
          return churn(new OldestKeyMap<string, Payload>(), fromOldestKeyMap);
        },
        second: (): number => {
          return churn(new Map<string, Payload>(), fromNewIterator);
        },
      });
      const fast: FastestRun<number> = runs.first;
      const before: FastestRun<number> = runs.second;

      expect(fast.result).toBe(CAPACITY);
      expect(before.result).toBe(CAPACITY);
      // The cursor alone measured about 15 times faster (Node 26); three is the floor.
      expect(fast.inMs * 3).toBeLessThan(before.inMs);
    },
  );
});

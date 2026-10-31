import OldestKeyCursor from "../../Utils/OldestKeyCursor";
import {
  ComparedRuns,
  FastestRun,
  fastestRunsCompared,
} from "../Helpers/FastestRun";
import { SeededRandom, seededRandom } from "../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * OldestKeyCursor answers what map.keys().next() answers - the map's oldest
 * live key - from one iterator kept between calls, so a bounded cache that
 * evicts its oldest entry on every write no longer walks past every slot it
 * evicted before (V8 keeps a deleted entry's slot until it compacts the
 * table). What the tests hold it to:
 *   - the answer is keys().next()'s after every kind of change: adds at the
 *     end, deletes at the front, in the middle and of the next key, a key
 *     set again (which moves it to the end), a clear, a map emptied and
 *     filled again after the iterator ran out;
 *   - a seeded differential run of 200 x 2,000 cache operations against
 *     keys().next() never differs;
 *   - in a full cache that evicts on every write it is several times faster
 *     than keys().next() (the two timed against each other, so the
 *     machine's speed cancels out).
 */

// What a bounded cache does on a write: evict the oldest when full.
function writeEvictingWithCursor(
  map: Map<string, number>,
  cursor: OldestKeyCursor<string>,
  capacity: number,
  key: string,
  value: number,
): string | undefined {
  let evicted: string | undefined = undefined;

  if (map.size >= capacity && !map.has(key)) {
    evicted = cursor.takeOldest();
    if (evicted !== undefined) {
      map.delete(evicted);
    }
  }
  map.delete(key);
  map.set(key, value);

  return evicted;
}

// The same write as caches made it before: keys().next() each time.
function writeEvictingWithNewIterator(
  map: Map<string, number>,
  capacity: number,
  key: string,
  value: number,
): string | undefined {
  let evicted: string | undefined = undefined;

  if (map.size >= capacity && !map.has(key)) {
    evicted = map.keys().next().value;
    if (evicted !== undefined) {
      map.delete(evicted);
    }
  }
  map.delete(key);
  map.set(key, value);

  return evicted;
}

describe("OldestKeyCursor answers the map's oldest live key", () => {
  test("an empty map has none, and a map filled later has its first key", () => {
    const map: Map<string, number> = new Map();
    const cursor: OldestKeyCursor<string> = new OldestKeyCursor<string>(map);

    expect(cursor.takeOldest()).toBeUndefined();

    // The iterator that found nothing has finished; a fresh one sees "a".
    map.set("a", 1);
    map.set("b", 2);
    expect(cursor.takeOldest()).toBe("a");
  });

  test("hands out keys in insertion order as each one it answered is deleted", () => {
    const map: Map<string, number> = new Map([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    const cursor: OldestKeyCursor<string> = new OldestKeyCursor<string>(map);
    const taken: Array<string | undefined> = [];

    for (let index: number = 0; index < 4; index++) {
      const key: string | undefined = cursor.takeOldest();
      taken.push(key);
      if (key !== undefined) {
        map.delete(key);
      }
    }

    expect(taken).toEqual(["a", "b", "c", undefined]);
  });

  test("skips keys deleted ahead of it, in the middle and the very next one", () => {
    const map: Map<string, number> = new Map([
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["d", 4],
    ]);
    const cursor: OldestKeyCursor<string> = new OldestKeyCursor<string>(map);

    map.delete(cursor.takeOldest()!);
    map.delete("b");
    map.delete("d");
    expect(cursor.takeOldest()).toBe("c");
  });

  test("a key set again moves to the end, and is answered there", () => {
    const map: Map<string, number> = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    const cursor: OldestKeyCursor<string> = new OldestKeyCursor<string>(map);

    map.delete("a");
    map.set("a", 10);
    map.set("c", 3);

    const order: Array<string | undefined> = [];
    for (let index: number = 0; index < 3; index++) {
      const key: string | undefined = cursor.takeOldest();
      order.push(key);
      map.delete(key!);
    }

    expect(order).toEqual(["b", "a", "c"]);
  });

  test("reaches entries added after it ran out, and after the map was cleared", () => {
    const map: Map<string, number> = new Map([["a", 1]]);
    const cursor: OldestKeyCursor<string> = new OldestKeyCursor<string>(map);

    map.delete(cursor.takeOldest()!);
    expect(cursor.takeOldest()).toBeUndefined();

    map.set("b", 2);
    map.set("c", 3);
    expect(cursor.takeOldest()).toBe("b");

    map.clear();
    map.set("x", 1);
    expect(cursor.takeOldest()).toBe("x");

    map.clear();
    cursor.reset();
    map.set("y", 1);
    expect(cursor.takeOldest()).toBe("y");
  });

  test("answers the oldest live key across a table V8 compacts while it is kept", () => {
    // Enough churn that V8 rebuilds the map's table several times over.
    const map: Map<string, number> = new Map();
    const cursor: OldestKeyCursor<string> = new OldestKeyCursor<string>(map);

    for (let index: number = 0; index < 1000; index++) {
      map.set(`k${index}`, index);
    }
    const differences: Array<string> = [];

    for (let index: number = 1000; index < 60000; index++) {
      const expected: string | undefined = map.keys().next().value;
      const oldest: string | undefined = cursor.takeOldest();

      if (oldest !== expected) {
        differences.push(`${index}: ${oldest} for ${expected}`);
      }
      map.delete(oldest!);
      map.set(`k${index}`, index);
    }

    expect(differences).toEqual([]);
  });

  test("200 seeded runs of 2,000 cache writes, deletes, re-sets and clears evict exactly what keys().next() evicted", () => {
    const differences: Array<string> = [];

    for (let run: number = 0; run < 200; run++) {
      const random: SeededRandom = seededRandom(20261027 + run);
      const capacity: number = 1 + random(16);
      const withCursor: Map<string, number> = new Map();
      const cursor: OldestKeyCursor<string> = new OldestKeyCursor<string>(
        withCursor,
      );
      const withIterator: Map<string, number> = new Map();

      for (let step: number = 0; step < 2000; step++) {
        const key: string = `k${random(40)}`;
        const operation: number = random(100);

        if (operation < 70) {
          const evicted: string | undefined = writeEvictingWithCursor(
            withCursor,
            cursor,
            capacity,
            key,
            step,
          );
          const evictedBefore: string | undefined =
            writeEvictingWithNewIterator(withIterator, capacity, key, step);

          if (evicted !== evictedBefore) {
            differences.push(
              `run ${run} step ${step}: evicted ${evicted} for ${evictedBefore}`,
            );
          }
        } else if (operation < 97) {
          withCursor.delete(key);
          withIterator.delete(key);
        } else {
          withCursor.clear();
          cursor.reset();
          withIterator.clear();
        }

        const kept: string = Array.from(withCursor.keys()).join(",");
        const keptBefore: string = Array.from(withIterator.keys()).join(",");

        if (kept !== keptBefore) {
          differences.push(
            `run ${run} step ${step}: kept ${kept} for ${keptBefore}`,
          );
        }
      }
    }

    expect(differences).toEqual([]);
  });
});

describe("OldestKeyCursor in a full cache that evicts on every write", () => {
  test("costs a fraction of a new keys().next() per write", () => {
    const CAPACITY: number = 20000;
    const WRITES: number = 40000;

    const churn: (useCursor: boolean) => number = (
      useCursor: boolean,
    ): number => {
      const map: Map<string, number> = new Map();
      const cursor: OldestKeyCursor<string> = new OldestKeyCursor<string>(map);

      for (let index: number = 0; index < CAPACITY; index++) {
        map.set(`k${index}`, index);
      }
      for (let index: number = 0; index < WRITES; index++) {
        if (useCursor) {
          writeEvictingWithCursor(map, cursor, CAPACITY, `n${index}`, index);
        } else {
          writeEvictingWithNewIterator(map, CAPACITY, `n${index}`, index);
        }
      }

      return map.size;
    };

    /*
     * Timed against each other, in turns (fastestRunsCompared): the
     * machine's speed cancels out, and one stall cannot slow one side alone.
     */
    const runs: ComparedRuns<number, number> = fastestRunsCompared({
      first: (): number => {
        return churn(true);
      },
      second: (): number => {
        return churn(false);
      },
    });
    const cursorRun: FastestRun<number> = runs.first;
    const iteratorRun: FastestRun<number> = runs.second;

    expect(cursorRun.result).toBe(CAPACITY);
    expect(iteratorRun.result).toBe(CAPACITY);
    // Measured about 15 times faster (Node 26); three is the floor held here.
    expect(cursorRun.inMs * 3).toBeLessThan(iteratorRun.inMs);
  });
});

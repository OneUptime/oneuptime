import { describe, expect, test } from "@jest/globals";
import ReadLanes from "../../../Server/Utils/ReadLanes";

/*
 * THE READS OF ONE VIEW, A FEW AT A TIME (ReadLanes).
 *
 * At most `lanes` reads run at once, the rest start in the order they were
 * handed over as lanes come free, and once one fails the reads still
 * waiting fail with it without running; reads already running finish.
 */

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | null = null;
  let reject: ((error: Error) => void) | null = null;
  const promise: Promise<T> = new Promise<T>(
    (yes: (value: T) => void, no: (error: Error) => void) => {
      resolve = yes;
      reject = no;
    },
  );
  return { promise, resolve: resolve!, reject: reject! };
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 10; index++) {
    await Promise.resolve();
  }
}

describe("ReadLanes", () => {
  test("runs no more reads at once than it has lanes, in the order they came", async () => {
    const lanes: ReadLanes = new ReadLanes(2);
    const reads: Array<Deferred<number>> = [];
    const started: Array<number> = [];

    const answers: Array<Promise<number>> = [];

    for (let index: number = 0; index < 6; index++) {
      const read: Deferred<number> = deferred<number>();
      reads.push(read);
      answers.push(
        lanes.run((): Promise<number> => {
          started.push(index);
          return read.promise;
        }),
      );
    }

    await settle();
    expect(started).toEqual([0, 1]);

    reads[1]!.resolve(1);
    await settle();
    expect(started).toEqual([0, 1, 2]);

    reads[0]!.resolve(0);
    await settle();
    expect(started).toEqual([0, 1, 2, 3]);

    reads[2]!.resolve(2);
    reads[3]!.resolve(3);
    await settle();
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);

    reads[4]!.resolve(4);
    reads[5]!.resolve(5);

    expect(await Promise.all(answers)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(lanes.getMostRunning()).toBe(2);
  });

  test("never exceeds its lanes, whatever the reads take", async () => {
    for (const laneCount of [1, 2, 3]) {
      const lanes: ReadLanes = new ReadLanes(laneCount);
      let running: number = 0;
      let mostRunning: number = 0;

      await Promise.all(
        Array.from({ length: 12 }, (_value: unknown, index: number) => {
          return lanes.run(async (): Promise<number> => {
            running++;
            mostRunning = Math.max(mostRunning, running);

            for (let turn: number = 0; turn < (index % 4) + 1; turn++) {
              await Promise.resolve();
            }

            running--;
            return index;
          });
        }),
      );

      expect(mostRunning).toBe(laneCount);
      expect(lanes.getMostRunning()).toBe(laneCount);
    }
  });

  test("a failed read fails the reads still waiting, without running them; running ones finish", async () => {
    const lanes: ReadLanes = new ReadLanes(2);
    const first: Deferred<string> = deferred<string>();
    const second: Deferred<string> = deferred<string>();
    const started: Array<string> = [];

    const a: Promise<string> = lanes.run((): Promise<string> => {
      started.push("a");
      return first.promise;
    });
    const b: Promise<string> = lanes.run((): Promise<string> => {
      started.push("b");
      return second.promise;
    });
    const c: Promise<string> = lanes.run(async (): Promise<string> => {
      started.push("c");
      return "c";
    });
    const d: Promise<string> = lanes.run(async (): Promise<string> => {
      started.push("d");
      return "d";
    });

    await settle();

    const failure: Error = new Error("statement timeout");
    first.reject(failure);

    await expect(a).rejects.toBe(failure);
    await expect(c).rejects.toBe(failure);
    await expect(d).rejects.toBe(failure);

    // The read already running is not cut short.
    second.resolve("b");
    expect(await b).toBe("b");

    expect(started).toEqual(["a", "b"]);

    // And a read handed over afterwards is not run either.
    await expect(
      lanes.run(async (): Promise<string> => {
        started.push("e");
        return "e";
      }),
    ).rejects.toBe(failure);
    expect(started).toEqual(["a", "b"]);
  });

  test("a read that throws as it starts fails like one that rejects, and frees its lane", async () => {
    const lanes: ReadLanes = new ReadLanes(1);

    await expect(
      lanes.run((): Promise<number> => {
        throw new Error("could not start");
      }),
    ).rejects.toThrow("could not start");

    // Failed: what follows is not run.
    await expect(
      lanes.run(async (): Promise<number> => {
        return 1;
      }),
    ).rejects.toThrow("could not start");
  });

  test("answers each read's own value", async () => {
    const lanes: ReadLanes = new ReadLanes(2);

    const [a, b, c]: [string, number, Array<string>] = await Promise.all([
      lanes.run(async (): Promise<string> => {
        return "fleet";
      }),
      lanes.run(async (): Promise<number> => {
        return 42;
      }),
      lanes.run(async (): Promise<Array<string>> => {
        return ["row"];
      }),
    ]);

    expect([a, b, c]).toEqual(["fleet", 42, ["row"]]);
  });

  test.each([[0], [-1], [1.5], [Number.NaN]])(
    "refuses %p lanes",
    (laneCount: number) => {
      expect(() => {
        return new ReadLanes(laneCount);
      }).toThrow(/at least one lane/);
    },
  );
});

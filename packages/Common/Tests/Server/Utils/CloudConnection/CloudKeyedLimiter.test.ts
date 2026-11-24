import { describe, expect, test } from "@jest/globals";
import { CloudKeyedLimiter } from "../../../../Server/Utils/CloudConnection/CloudConcurrency";

/*
 * At most so many at once per key - a subscription and Region - and half as
 * many once the cloud says that place is busy (#10291).
 */

interface Gate {
  promise: Promise<void>;
  open: () => void;
}

function gate(): Gate {
  let open: () => void = (): void => {};
  const promise: Promise<void> = new Promise<void>((resolve: () => void) => {
    open = resolve;
  });

  return { promise, open };
}

// Lets every promise that can settle now settle.
async function settle(): Promise<void> {
  for (let tick: number = 0; tick < 10; tick++) {
    await Promise.resolve();
  }
}

describe("CloudKeyedLimiter", () => {
  test("runs a key's work its limit at a time, in the order it came, and other keys apart", async () => {
    const limiter: CloudKeyedLimiter = new CloudKeyedLimiter(2);
    const gates: Array<Gate> = [gate(), gate(), gate(), gate()];
    const started: Array<string> = [];
    const work: (key: string, index: number) => Promise<number> = (
      key: string,
      index: number,
    ): Promise<number> => {
      return limiter.run(key, async (): Promise<number> => {
        started.push(`${key}${index}`);
        await gates[index]!.promise;
        return index;
      });
    };

    const results: Array<Promise<number>> = [
      work("a", 0),
      work("a", 1),
      work("a", 2),
      work("a", 3),
      work("b", 0),
    ];

    await settle();
    // Two of a's at once; b's own goes on.
    expect(started).toEqual(["a0", "a1", "b0"]);

    gates[1]!.open();
    await settle();
    expect(started).toEqual(["a0", "a1", "b0", "a2"]);

    gates[0]!.open();
    gates[2]!.open();
    gates[3]!.open();

    expect(await Promise.all(results)).toEqual([0, 1, 2, 3, 0]);
    expect(started).toEqual(["a0", "a1", "b0", "a2", "a3"]);
  });

  test("halves a key's limit each time it slows down, to one at least, and no other key's", () => {
    const limiter: CloudKeyedLimiter = new CloudKeyedLimiter(4);

    expect(limiter.getLimit("busy")).toBe(4);
    limiter.slowDown("busy");
    expect(limiter.getLimit("busy")).toBe(2);
    limiter.slowDown("busy");
    limiter.slowDown("busy");
    limiter.slowDown("busy");
    expect(limiter.getLimit("busy")).toBe(1);
    expect(limiter.getLimit("calm")).toBe(4);
    expect(new CloudKeyedLimiter(0).getLimit("any")).toBe(1);
  });

  test("slowed down while its work runs, a key starts no more than its new limit", async () => {
    const limiter: CloudKeyedLimiter = new CloudKeyedLimiter(2);
    const gates: Array<Gate> = [gate(), gate(), gate(), gate()];
    let running: number = 0;
    let most: number = 0;
    const results: Array<Promise<void>> = gates.map(
      (each: Gate): Promise<void> => {
        return limiter.run("place", async (): Promise<void> => {
          running++;
          most = Math.max(most, running);
          await each.promise;
          running--;
        });
      },
    );

    await settle();
    limiter.slowDown("place");
    gates[0]!.open();
    gates[1]!.open();
    await settle();
    // Two ended: one more started, not two.
    expect(running).toBe(1);

    gates[2]!.open();
    gates[3]!.open();
    await Promise.all(results);
    expect(most).toBe(2);
  });

  test("a work that throws frees its place for the next", async () => {
    const limiter: CloudKeyedLimiter = new CloudKeyedLimiter(1);

    await expect(
      limiter.run("place", async (): Promise<void> => {
        throw new Error("refused");
      }),
    ).rejects.toThrow("refused");
    expect(
      await limiter.run("place", async (): Promise<string> => {
        return "next";
      }),
    ).toBe("next");
  });
});

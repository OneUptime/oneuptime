import runWithConcurrency from "../../Utils/ConcurrencyLimiter";

type Deferred = {
  delayMs: number;
};

const delay: (ms: number) => Promise<void> = (ms: number): Promise<void> => {
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
};

describe("runWithConcurrency", () => {
  test("returns an empty array for empty input and never calls the worker", async () => {
    const worker: jest.Mock = jest.fn();
    const results: Array<PromiseSettledResult<number>> =
      await runWithConcurrency<number, number>([], 5, worker);

    expect(results).toEqual([]);
    expect(worker).not.toHaveBeenCalled();
  });

  test("processes every item and aligns results with the input by index", async () => {
    const items: Array<number> = [1, 2, 3, 4, 5];

    const results: Array<PromiseSettledResult<number>> =
      await runWithConcurrency<number, number>(
        items,
        2,
        async (item: number) => {
          return item * 10;
        },
      );

    expect(
      results.map((r: PromiseSettledResult<number>) => {
        return r.status === "fulfilled" ? r.value : null;
      }),
    ).toEqual([10, 20, 30, 40, 50]);
  });

  test("never keeps more than `concurrencyLimit` workers in flight", async () => {
    const items: Array<Deferred> = Array.from({ length: 20 }, () => {
      return { delayMs: 10 };
    });

    let inFlight: number = 0;
    let maxInFlight: number = 0;
    const LIMIT: number = 4;

    await runWithConcurrency<Deferred, void>(
      items,
      LIMIT,
      async (item: Deferred) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await delay(item.delayMs);
        inFlight--;
      },
    );

    expect(maxInFlight).toBeGreaterThan(0);
    expect(maxInFlight).toBeLessThanOrEqual(LIMIT);
  });

  test("isolates failures: one rejecting worker does not abort the others", async () => {
    const items: Array<number> = [0, 1, 2, 3, 4];

    const results: Array<PromiseSettledResult<number>> =
      await runWithConcurrency<number, number>(
        items,
        3,
        async (item: number) => {
          if (item === 2) {
            throw new Error("boom on 2");
          }
          return item;
        },
      );

    expect(results[0]).toEqual({ status: "fulfilled", value: 0 });
    expect(results[1]).toEqual({ status: "fulfilled", value: 1 });
    const rejected: PromiseSettledResult<number> = results[2]!;
    expect(rejected.status).toBe("rejected");
    if (rejected.status === "rejected") {
      expect(rejected.reason).toBeInstanceOf(Error);
    }
    expect(results[3]).toEqual({ status: "fulfilled", value: 3 });
    expect(results[4]).toEqual({ status: "fulfilled", value: 4 });
  });

  test("processes all items even when the limit exceeds the item count", async () => {
    const items: Array<number> = [1, 2, 3];

    const results: Array<PromiseSettledResult<number>> =
      await runWithConcurrency<number, number>(
        items,
        100,
        async (item: number) => {
          return item;
        },
      );

    expect(results).toHaveLength(3);
    expect(
      results.every((r: PromiseSettledResult<number>) => {
        return r.status === "fulfilled";
      }),
    ).toBe(true);
  });

  test("clamps a non-positive limit to serial execution (limit < 1 => 1 in flight)", async () => {
    const items: Array<Deferred> = Array.from({ length: 6 }, () => {
      return { delayMs: 5 };
    });

    let inFlight: number = 0;
    let maxInFlight: number = 0;

    await runWithConcurrency<Deferred, void>(
      items,
      0,
      async (item: Deferred) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await delay(item.delayMs);
        inFlight--;
      },
    );

    expect(maxInFlight).toBe(1);
  });

  test("passes the correct index to the worker", async () => {
    const items: Array<string> = ["a", "b", "c"];
    const seen: Array<number> = [];

    await runWithConcurrency<string, void>(
      items,
      1,
      async (_item: string, index: number) => {
        seen.push(index);
      },
    );

    expect(seen).toEqual([0, 1, 2]);
  });
});

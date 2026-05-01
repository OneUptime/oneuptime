import QueryCoalescer from "../../../Utils/Dashboard/QueryCoalescer";

describe("QueryCoalescer", () => {
  test("two concurrent calls with the same key share one fetch", async () => {
    const coalescer: QueryCoalescer<number> = new QueryCoalescer<number>();
    let calls: number = 0;
    const fetcher: () => Promise<number> = (): Promise<number> => {
      calls += 1;
      return new Promise<number>((resolve: (v: number) => void) => {
        setTimeout(() => {
          resolve(42);
        }, 10);
      });
    };

    const [a, b] = await Promise.all([
      coalescer.run("k", fetcher),
      coalescer.run("k", fetcher),
    ]);

    expect(a).toEqual(42);
    expect(b).toEqual(42);
    expect(calls).toEqual(1);
    expect(coalescer.size()).toEqual(0);
  });

  test("calls with different keys don't share fetches", async () => {
    const coalescer: QueryCoalescer<number> = new QueryCoalescer<number>();
    let calls: number = 0;
    const fetcher: () => Promise<number> = (): Promise<number> => {
      calls += 1;
      return Promise.resolve(1);
    };

    await Promise.all([
      coalescer.run("k1", fetcher),
      coalescer.run("k2", fetcher),
    ]);

    expect(calls).toEqual(2);
  });

  test("after settle, the next call re-fetches (no caching)", async () => {
    const coalescer: QueryCoalescer<number> = new QueryCoalescer<number>();
    let calls: number = 0;
    const fetcher: () => Promise<number> = (): Promise<number> => {
      calls += 1;
      return Promise.resolve(7);
    };

    await coalescer.run("k", fetcher);
    await coalescer.run("k", fetcher);

    expect(calls).toEqual(2);
  });

  test("rejection is propagated and entry is cleaned up", async () => {
    const coalescer: QueryCoalescer<number> = new QueryCoalescer<number>();
    const fetcher: () => Promise<number> = (): Promise<number> => {
      return Promise.reject(new Error("boom"));
    };

    await expect(coalescer.run("k", fetcher)).rejects.toThrow("boom");
    expect(coalescer.size()).toEqual(0);

    // After rejection, a new call retries — does not cache the failure.
    let calls: number = 0;
    const successFetcher: () => Promise<number> = (): Promise<number> => {
      calls += 1;
      return Promise.resolve(1);
    };
    await coalescer.run("k", successFetcher);
    expect(calls).toEqual(1);
  });

  test("clear drops all in-flight entries (subsequent runs proceed)", async () => {
    const coalescer: QueryCoalescer<number> = new QueryCoalescer<number>();
    let resolved: boolean = false;
    const slowFetcher: () => Promise<number> = (): Promise<number> => {
      return new Promise<number>((resolve: (v: number) => void) => {
        setTimeout(() => {
          resolved = true;
          resolve(1);
        }, 50);
      });
    };

    const inFlight: Promise<number> = coalescer.run("k", slowFetcher);
    coalescer.clear();
    expect(coalescer.size()).toEqual(0);

    // The original promise still settles and the test waits for it.
    await inFlight;
    expect(resolved).toBe(true);
  });
});

import { describe, expect, test } from "@jest/globals";
import CoalescedRefresh, {
  CoalescedRefreshTimers,
} from "../../../UI/Utils/CoalescedRefresh";

/*
 * A REFRESH MANY EVENTS ASK FOR, RUN ONCE FOR ALL OF THEM (issue #5299).
 *
 * The Dashboard header read its open alert count again for every alert the
 * realtime connection said had changed - 4,594 count requests while a bulk
 * action resolved 4,594 alerts, competing with the writes they counted.
 * CoalescedRefresh runs the first refresh at once and folds every request
 * after it, within the interval, into one more.
 *
 * Time is a clock the test moves; nothing waits for real time.
 */

class FakeTimers implements CoalescedRefreshTimers {
  public time: number = 1_000_000;
  private nextId: number = 1;
  private timers: Array<{ id: number; at: number; callback: () => void }> = [];

  public now: () => number = (): number => {
    return this.time;
  };

  public setTimeout: (callback: () => void, delayInMs: number) => unknown = (
    callback: () => void,
    delayInMs: number,
  ): unknown => {
    const id: number = this.nextId++;
    this.timers.push({ id: id, at: this.time + delayInMs, callback: callback });
    return id;
  };

  public clearTimeout: (handle: unknown) => void = (handle: unknown): void => {
    this.timers = this.timers.filter((timer: { id: number }): boolean => {
      return timer.id !== handle;
    });
  };

  public get pending(): number {
    return this.timers.length;
  }

  public advance(ms: number): void {
    const until: number = this.time + ms;

    for (;;) {
      const next: { id: number; at: number; callback: () => void } | undefined =
        this.timers
          .filter((timer: { at: number }): boolean => {
            return timer.at <= until;
          })
          .sort((a: { at: number }, b: { at: number }): number => {
            return a.at - b.at;
          })[0];

      if (!next) {
        break;
      }

      this.timers = this.timers.filter((timer: { id: number }): boolean => {
        return timer.id !== next.id;
      });
      this.time = Math.max(this.time, next.at);
      next.callback();
    }

    this.time = until;
  }
}

async function flush(): Promise<void> {
  for (let i: number = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

interface Counting {
  refresh: CoalescedRefresh;
  timers: FakeTimers;
  calls: () => number;
  // Holds the refresh in flight until released.
  hold: () => () => void;
}

function counting(minIntervalInMs: number = 5000): Counting {
  const timers: FakeTimers = new FakeTimers();
  let calls: number = 0;
  let gate: Promise<void> | null = null;

  const refresh: CoalescedRefresh = new CoalescedRefresh({
    minIntervalInMs: minIntervalInMs,
    timers: timers,
    refresh: async (): Promise<void> => {
      calls++;

      if (gate) {
        await gate;
      }
    },
  });

  return {
    refresh,
    timers,
    calls: (): number => {
      return calls;
    },
    hold: (): (() => void) => {
      let release: () => void = (): void => {};
      gate = new Promise<void>((resolve: () => void) => {
        release = (): void => {
          gate = null;
          resolve();
        };
      });
      return release;
    },
  };
}

describe("CoalescedRefresh", () => {
  test("the first request refreshes at once", async () => {
    const c: Counting = counting();

    c.refresh.request();
    await flush();

    expect(c.calls()).toBe(1);
    expect(c.timers.pending).toBe(0);
  });

  test("a burst of requests within the interval runs exactly one more refresh, once the interval has passed", async () => {
    const c: Counting = counting(5000);

    c.refresh.request();
    await flush();

    // 4,593 more changes, all within a second.
    for (let i: number = 0; i < 4593; i++) {
      c.timers.advance(0.2);
      c.refresh.request();
    }
    await flush();

    expect(c.calls()).toBe(1);
    expect(c.timers.pending).toBe(1);

    c.timers.advance(5000);
    await flush();

    expect(c.calls()).toBe(2);
    expect(c.timers.pending).toBe(0);
  });

  test("a request after the interval has passed refreshes at once again", async () => {
    const c: Counting = counting(5000);

    c.refresh.request();
    await flush();
    c.timers.advance(6000);
    c.refresh.request();
    await flush();

    expect(c.calls()).toBe(2);
    expect(c.timers.pending).toBe(0);
  });

  test("a request while a refresh runs is counted once it has finished: the last change is never missed", async () => {
    const c: Counting = counting(5000);
    const release: () => void = c.hold();

    c.refresh.request();
    await flush();
    expect(c.calls()).toBe(1);

    // Changes while the count is being read.
    c.refresh.request();
    c.refresh.request();
    await flush();
    expect(c.calls()).toBe(1);

    release();
    await flush();

    // One more, once the interval since the first has passed.
    expect(c.timers.pending).toBe(1);
    c.timers.advance(5000);
    await flush();
    expect(c.calls()).toBe(2);
  });

  test("a refresh that fails is tried again by the next change", async () => {
    const timers: FakeTimers = new FakeTimers();
    let calls: number = 0;

    const refresh: CoalescedRefresh = new CoalescedRefresh({
      minIntervalInMs: 1000,
      timers: timers,
      refresh: async (): Promise<void> => {
        calls++;
        throw new Error("The count could not be read.");
      },
    });

    refresh.request();
    await flush();
    timers.advance(1000);
    refresh.request();
    await flush();

    expect(calls).toBe(2);
  });

  test("stopped, it refreshes no more and drops the one it was waiting to run", async () => {
    const c: Counting = counting(5000);

    c.refresh.request();
    await flush();
    c.refresh.request();
    expect(c.timers.pending).toBe(1);

    c.refresh.stop();
    expect(c.timers.pending).toBe(0);

    c.timers.advance(60_000);
    c.refresh.request();
    await flush();

    expect(c.calls()).toBe(1);
  });

  test("an interval of nothing refreshes for every request that comes after the last one finished", async () => {
    const c: Counting = counting(0);

    c.refresh.request();
    await flush();
    c.refresh.request();
    await flush();
    c.refresh.request();
    await flush();

    expect(c.calls()).toBe(3);
  });
});

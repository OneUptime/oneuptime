import EventLoopStalls, {
  EVENT_LOOP_STALL_MS,
  EVENT_LOOP_TICK_MS,
  EventLoopStall,
} from "../../../Server/Utils/EventLoopStalls";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHEN THE EVENT LOOP WAS BLOCKED (issue #10108): what a statement timed
 * from send to read can have waited for this process rather than for its
 * database. The ticks are driven by hand at chosen times, then once for real
 * with a loop that is really blocked.
 */

const T0: number = 1_700_000_000_000;

function startAt(nowMs: number): void {
  jest.spyOn(Date, "now").mockReturnValue(nowMs);
  EventLoopStalls.start();
  jest.restoreAllMocks();
}

afterEach(() => {
  EventLoopStalls.stop();
  jest.restoreAllMocks();
});

describe("EventLoopStalls", () => {
  test("says nothing before it is started", () => {
    expect(EventLoopStalls.isStarted()).toBe(false);
    expect(EventLoopStalls.getBlockedStretchBefore(T0)).toBe(0);
  });

  test("starts once, however often it is asked", () => {
    const setIntervalSpy: jest.SpiedFunction<typeof setInterval> = jest.spyOn(
      global,
      "setInterval",
    );

    EventLoopStalls.start();
    EventLoopStalls.start();
    EventLoopStalls.start();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(EventLoopStalls.isStarted()).toBe(true);
  });

  test("ticks on time are no stall", () => {
    startAt(T0);

    for (let tick: number = 1; tick <= 100; tick++) {
      EventLoopStalls.tick(T0 + tick * EVENT_LOOP_TICK_MS + 3);
    }

    expect(EventLoopStalls.getStalls()).toEqual([]);
    expect(
      EventLoopStalls.getBlockedStretchBefore(
        T0 + 100 * EVENT_LOOP_TICK_MS + 5,
      ),
    ).toBe(0);
  });

  test("a late tick keeps the stretch the loop was blocked, from when it was due", () => {
    startAt(T0);
    EventLoopStalls.tick(T0 + 10);
    // Blocked for 2.5 s: the next tick runs that late.
    EventLoopStalls.tick(T0 + 2_520);

    expect(EventLoopStalls.getStalls()).toEqual([
      { startMs: T0 + 20, endMs: T0 + 2_520 },
    ]);
  });

  test("an answer read while the loop is still blocked waited up to the stretch so far", () => {
    startAt(T0);
    EventLoopStalls.tick(T0 + 10);

    // The tick due at T0 + 20 has not run by T0 + 2,620.
    expect(EventLoopStalls.getBlockedStretchBefore(T0 + 2_620)).toBe(2_600);
  });

  test("an answer read just after a stall ended waited up to all of it", () => {
    startAt(T0);
    EventLoopStalls.tick(T0 + 10);
    EventLoopStalls.tick(T0 + 2_520);

    // Read in the same turn of the loop as the late tick, or the next.
    expect(EventLoopStalls.getBlockedStretchBefore(T0 + 2_521)).toBe(2_501);
    expect(
      EventLoopStalls.getBlockedStretchBefore(
        T0 + 2_520 + EVENT_LOOP_TICK_MS + EVENT_LOOP_STALL_MS,
      ),
    ).toBe(2_500 + EVENT_LOOP_TICK_MS + EVENT_LOOP_STALL_MS);
  });

  test("an answer read once the loop had been free again did not wait for that stall", () => {
    startAt(T0);
    EventLoopStalls.tick(T0 + 10);
    EventLoopStalls.tick(T0 + 2_520);

    // Ticks on time since: the loop was free, the answer would have been read.
    let nowMs: number = T0 + 2_520;
    for (let tick: number = 0; tick < 10; tick++) {
      nowMs += EVENT_LOOP_TICK_MS;
      EventLoopStalls.tick(nowMs);
    }

    expect(EventLoopStalls.getBlockedStretchBefore(nowMs + 2)).toBe(0);
  });

  test("keeps the stalls of the last few minutes, and a bounded number of them", () => {
    startAt(T0);
    let nowMs: number = T0;

    for (let stall: number = 0; stall < 3_000; stall++) {
      nowMs += EVENT_LOOP_TICK_MS + EVENT_LOOP_STALL_MS + 15;
      EventLoopStalls.tick(nowMs);
    }

    const stalls: Array<EventLoopStall> = EventLoopStalls.getStalls();

    expect(stalls.length).toBeLessThanOrEqual(1_024);
    expect(stalls[stalls.length - 1]!.endMs).toBe(nowMs);

    // Ten minutes later, the old ones are gone.
    EventLoopStalls.tick(nowMs + 10 * 60 * 1000);
    expect(EventLoopStalls.getStalls()).toHaveLength(1);
  });

  test("measures a loop that is really blocked", async () => {
    EventLoopStalls.start();

    // Let it tick on time first.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 60);
    });

    const blockedFrom: number = Date.now();
    while (Date.now() - blockedFrom < 300) {
      // Holding the loop, as an evaluation did.
    }

    // Read right after, as an answer that waited would be.
    expect(EventLoopStalls.getBlockedStretchBefore()).toBeGreaterThanOrEqual(
      250,
    );

    // And once the loop has been free a while, nothing.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 120);
    });
    expect(EventLoopStalls.getBlockedStretchBefore()).toBe(0);
  });
});

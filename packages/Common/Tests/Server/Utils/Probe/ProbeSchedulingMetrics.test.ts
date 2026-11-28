import { KeyedConcurrencyRefusal } from "../../../../Server/Utils/KeyedConcurrencyLimiter";
import ProbeSchedulingLane from "../../../../Server/Utils/Probe/ProbeSchedulingLane";
import {
  LATENESS_BUCKETS_IN_SECONDS,
  PROBE_SCHEDULING_METRICS_WINDOW_SECONDS,
  ProbeSchedulingMetrics,
  ProbeSchedulingMetricsSnapshot,
  SLOT_WAIT_BUCKETS_IN_MS,
} from "../../../../Server/Utils/Probe/ProbeSchedulingMetrics";
import AppMetrics from "../../../../Server/Utils/Telemetry/AppMetrics";
import Telemetry from "../../../../Server/Utils/Telemetry";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * What one App replica says of its probe scheduling (issue #10819): each
 * lane's slots, queue and waits, the refusals and why, how late each
 * monitor was handed out past when it was due - and whether by a whole
 * interval - and how long each Test Monitor run waited for a probe, all
 * over the last minute.
 */

const MINUTE: number = 60 * 1000;

function clockAt(startMs: number): {
  now: () => number;
  move: (ms: number) => void;
} {
  let current: number = startMs;
  return {
    now: (): number => {
      return current;
    },
    move: (ms: number): void => {
      current += ms;
    },
  };
}

function metricsAt(clock: { now: () => number }): ProbeSchedulingMetrics {
  return new ProbeSchedulingMetrics({ now: clock.now, replica: "app-1" });
}

describe("ProbeSchedulingMetrics", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("over the last minute, with buckets for a wait up to past the lane's limit and lateness up to an hour", () => {
    expect(PROBE_SCHEDULING_METRICS_WINDOW_SECONDS).toBe(60);
    expect(SLOT_WAIT_BUCKETS_IN_MS).toContain(5000);
    expect(LATENESS_BUCKETS_IN_SECONDS).toContain(60);
    expect(
      LATENESS_BUCKETS_IN_SECONDS[LATENESS_BUCKETS_IN_SECONDS.length - 1],
    ).toBe(3600);
  });

  test("a fresh replica reports both lanes idle and nothing handed out", () => {
    const snapshot: ProbeSchedulingMetricsSnapshot = metricsAt(
      clockAt(1_000_000),
    ).snapshot();

    expect(snapshot.replica).toBe("app-1");
    expect(snapshot.at).toBe(1_000_000);
    expect(Object.keys(snapshot.lanes).sort()).toEqual(
      [ProbeSchedulingLane.MonitorTests, ProbeSchedulingLane.Work].sort(),
    );
    expect(snapshot.lanes[ProbeSchedulingLane.Work]).toMatchObject({
      running: 0,
      waiting: 0,
      refused: 0,
    });
    expect(snapshot.monitorsHandedOut).toBe(0);
    expect(snapshot.monitorTestsHandedOut).toBe(0);
  });

  test("each lane's state comes from the limiter it observes", () => {
    const metrics: ProbeSchedulingMetrics = metricsAt(clockAt(0));
    metrics.observe((lane: ProbeSchedulingLane) => {
      return lane === ProbeSchedulingLane.Work
        ? { running: 10, waiting: 37, maxConcurrentRequests: 10 }
        : { running: 1, waiting: 0, maxConcurrentRequests: 2 };
    });

    const snapshot: ProbeSchedulingMetricsSnapshot = metrics.snapshot();
    expect(snapshot.lanes[ProbeSchedulingLane.Work]).toMatchObject({
      running: 10,
      waiting: 37,
      maxConcurrentRequests: 10,
    });
    expect(snapshot.lanes[ProbeSchedulingLane.MonitorTests]).toMatchObject({
      running: 1,
      maxConcurrentRequests: 2,
    });
  });

  test("slot waits and refusals are kept per lane, refusals by why", () => {
    const metrics: ProbeSchedulingMetrics = metricsAt(clockAt(2_000_000));

    metrics.recordSlotWait(ProbeSchedulingLane.Work, 3);
    metrics.recordSlotWait(ProbeSchedulingLane.Work, 4800);
    metrics.recordSlotWait(ProbeSchedulingLane.MonitorTests, 0);
    metrics.recordRefusal(
      ProbeSchedulingLane.Work,
      KeyedConcurrencyRefusal.QueueFull,
    );
    metrics.recordRefusal(
      ProbeSchedulingLane.Work,
      KeyedConcurrencyRefusal.WaitedTooLong,
    );
    metrics.recordRefusal(
      ProbeSchedulingLane.Work,
      KeyedConcurrencyRefusal.WaitedTooLong,
    );

    const snapshot: ProbeSchedulingMetricsSnapshot = metrics.snapshot();
    expect(snapshot.lanes[ProbeSchedulingLane.Work]!.slotWaitMs).toMatchObject({
      count: 2,
      max: 4800,
    });
    expect(snapshot.lanes[ProbeSchedulingLane.Work]).toMatchObject({
      refused: 3,
      refusedQueueFull: 1,
      refusedWaitedTooLong: 2,
    });
    expect(snapshot.lanes[ProbeSchedulingLane.MonitorTests]).toMatchObject({
      refused: 0,
      slotWaitMs: expect.objectContaining({ count: 1, max: 0 }),
    });
  });

  test("dispatch lag: how late each monitor was handed out, past when it was due", () => {
    const clock: { now: () => number; move: (ms: number) => void } =
      clockAt(3_000_000);
    const metrics: ProbeSchedulingMetrics = metricsAt(clock);
    const handedOutAt: Date = new Date(3_000_000);

    metrics.recordMonitorsHandedOut({
      handedOutAt: handedOutAt,
      monitors: [
        { dueAt: new Date(3_000_000 - 2_000), intervalInMs: MINUTE },
        { dueAt: new Date(3_000_000 - 40_000), intervalInMs: MINUTE },
        // Handed out before it was due (a clock a little ahead): on time.
        { dueAt: new Date(3_000_000 + 500), intervalInMs: MINUTE },
        // Never scheduled: not counted.
        { dueAt: null, intervalInMs: MINUTE },
      ],
    });

    const snapshot: ProbeSchedulingMetricsSnapshot = metrics.snapshot();
    expect(snapshot.monitorsHandedOut).toBe(3);
    expect(snapshot.dispatchLagSeconds.max).toBe(40);
    expect(snapshot.dispatchLagSeconds.p50).toBe(2);
    expect(snapshot.monitorsLateByAnInterval).toBe(0);
  });

  test("a monitor handed out a whole interval or more late has skipped a check, and is counted", () => {
    const metrics: ProbeSchedulingMetrics = metricsAt(clockAt(4_000_000));

    metrics.recordMonitorsHandedOut({
      handedOutAt: new Date(4_000_000),
      monitors: [
        // A one-minute monitor 90 s late: a check skipped.
        { dueAt: new Date(4_000_000 - 90_000), intervalInMs: MINUTE },
        // A five-minute monitor 90 s late: still within its interval.
        { dueAt: new Date(4_000_000 - 90_000), intervalInMs: 5 * MINUTE },
        // Exactly one interval late.
        { dueAt: new Date(4_000_000 - MINUTE), intervalInMs: MINUTE },
        // An interval that could not be read: late, but not by an interval.
        { dueAt: new Date(4_000_000 - 10 * MINUTE), intervalInMs: null },
      ],
    });

    expect(metrics.snapshot().monitorsLateByAnInterval).toBe(2);
  });

  test("Test Monitor wait: from when the test was asked for to when a probe was handed it", () => {
    const metrics: ProbeSchedulingMetrics = metricsAt(clockAt(5_000_000));

    metrics.recordMonitorTestsHandedOut({
      handedOutAt: new Date(5_000_000),
      askedAt: [new Date(5_000_000 - 3_000), new Date(5_000_000 - 9_000)],
    });

    const snapshot: ProbeSchedulingMetricsSnapshot = metrics.snapshot();
    expect(snapshot.monitorTestsHandedOut).toBe(2);
    expect(snapshot.monitorTestWaitSeconds.max).toBe(9);
    expect(snapshot.monitorTestWaitSeconds.p50).toBe(5);
  });

  test("everything is of the last minute: what came before it is forgotten", () => {
    const clock: { now: () => number; move: (ms: number) => void } =
      clockAt(6_000_000);
    const metrics: ProbeSchedulingMetrics = metricsAt(clock);

    metrics.recordSlotWait(ProbeSchedulingLane.Work, 900);
    metrics.recordRefusal(
      ProbeSchedulingLane.Work,
      KeyedConcurrencyRefusal.QueueFull,
    );
    metrics.recordMonitorsHandedOut({
      handedOutAt: new Date(clock.now()),
      monitors: [{ dueAt: new Date(clock.now() - 1000), intervalInMs: null }],
    });
    metrics.recordMonitorTestsHandedOut({
      handedOutAt: new Date(clock.now()),
      askedAt: [new Date(clock.now() - 1000)],
    });

    clock.move(61_000);

    const snapshot: ProbeSchedulingMetricsSnapshot = metrics.snapshot();
    expect(snapshot.lanes[ProbeSchedulingLane.Work]).toMatchObject({
      refused: 0,
      slotWaitMs: expect.objectContaining({ count: 0 }),
    });
    expect(snapshot.monitorsHandedOut).toBe(0);
    expect(snapshot.monitorTestsHandedOut).toBe(0);
  });

  test("only the process's own metrics go out as OneUptime's OpenTelemetry metrics", () => {
    const record: Mock<(...args: Array<unknown>) => void> = jest.fn();
    const add: Mock<(...args: Array<unknown>) => void> = jest.fn();
    jest
      .spyOn(AppMetrics, "getProbeSchedulingSlotWait")
      .mockReturnValue({ record } as never);
    jest
      .spyOn(AppMetrics, "getProbeSchedulingRefusedCounter")
      .mockReturnValue({ add } as never);
    jest
      .spyOn(AppMetrics, "getProbeDispatchLag")
      .mockReturnValue({ record } as never);
    jest
      .spyOn(AppMetrics, "getProbeMonitorTestWait")
      .mockReturnValue({ record } as never);

    const quiet: ProbeSchedulingMetrics = metricsAt(clockAt(0));
    quiet.recordSlotWait(ProbeSchedulingLane.Work, 5);
    quiet.recordRefusal(
      ProbeSchedulingLane.Work,
      KeyedConcurrencyRefusal.QueueFull,
    );
    expect(record).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();

    const exported: ProbeSchedulingMetrics = new ProbeSchedulingMetrics({
      now: clockAt(0).now,
      exportTelemetry: true,
    });
    exported.recordSlotWait(ProbeSchedulingLane.MonitorTests, 5);
    exported.recordRefusal(
      ProbeSchedulingLane.Work,
      KeyedConcurrencyRefusal.WaitedTooLong,
    );
    exported.recordMonitorsHandedOut({
      handedOutAt: new Date(10_000),
      monitors: [{ dueAt: new Date(7_000), intervalInMs: MINUTE }],
    });
    exported.recordMonitorTestsHandedOut({
      handedOutAt: new Date(10_000),
      askedAt: [new Date(4_000)],
    });

    expect(record).toHaveBeenCalledWith(5, { lane: "monitor-tests" });
    expect(add).toHaveBeenCalledWith(1, {
      lane: "work",
      reason: "waited-too-long",
    });
    // In ms, as OneUptime's other durations are.
    expect(record).toHaveBeenCalledWith(3000);
    expect(record).toHaveBeenCalledWith(6000);
  });

  /*
   * #11392: an answer that asked its probe's connection to reconnect
   * ("Connection: close", ProbeSchedulingReconnect) - which a replica with
   * requests waiting for a slot does a few times a second - is counted by
   * its lane, over the last minute, as a refusal is.
   */
  describe("answers that asked their connection to reconnect (#11392)", () => {
    test("a fresh replica has asked none, in either lane", () => {
      const snapshot: ProbeSchedulingMetricsSnapshot = metricsAt(
        clockAt(0),
      ).snapshot();

      expect(snapshot.lanes[ProbeSchedulingLane.Work]!.reconnectsAsked).toBe(0);
      expect(
        snapshot.lanes[ProbeSchedulingLane.MonitorTests]!.reconnectsAsked,
      ).toBe(0);
    });

    test("each is counted in its own lane", () => {
      const metrics: ProbeSchedulingMetrics = metricsAt(clockAt(0));

      for (let asked: number = 0; asked < 7; asked++) {
        metrics.recordReconnectAsked(ProbeSchedulingLane.Work);
      }
      metrics.recordReconnectAsked(ProbeSchedulingLane.MonitorTests);
      metrics.recordReconnectAsked(ProbeSchedulingLane.MonitorTests);

      const snapshot: ProbeSchedulingMetricsSnapshot = metrics.snapshot();
      expect(snapshot.lanes[ProbeSchedulingLane.Work]!.reconnectsAsked).toBe(7);
      expect(
        snapshot.lanes[ProbeSchedulingLane.MonitorTests]!.reconnectsAsked,
      ).toBe(2);
      // Neither a refusal, nor anything handed out.
      expect(snapshot.lanes[ProbeSchedulingLane.Work]!.refused).toBe(0);
      expect(snapshot.monitorsHandedOut).toBe(0);
    });

    test("they are of the last minute: older ones are forgotten", () => {
      const clock: { now: () => number; move: (ms: number) => void } =
        clockAt(9_000_000);
      const metrics: ProbeSchedulingMetrics = metricsAt(clock);

      // Ten a second for 30 s, the most a backed-up lane asks.
      for (let second: number = 0; second < 30; second++) {
        for (let asked: number = 0; asked < 10; asked++) {
          metrics.recordReconnectAsked(ProbeSchedulingLane.Work);
        }
        clock.move(1000);
      }

      expect(
        metrics.snapshot().lanes[ProbeSchedulingLane.Work]!.reconnectsAsked,
      ).toBe(300);

      // Past the minute, every one of them has gone out of the window.
      clock.move(61_000);
      expect(
        metrics.snapshot().lanes[ProbeSchedulingLane.Work]!.reconnectsAsked,
      ).toBe(0);
    });

    test("the process's own go out as probe.scheduling.reconnect.count, by lane; a view made for a test does not", () => {
      const add: Mock<(...args: Array<unknown>) => void> = jest.fn();
      jest
        .spyOn(AppMetrics, "getProbeSchedulingReconnectCounter")
        .mockReturnValue({ add } as never);

      metricsAt(clockAt(0)).recordReconnectAsked(ProbeSchedulingLane.Work);
      expect(add).not.toHaveBeenCalled();

      const exported: ProbeSchedulingMetrics = new ProbeSchedulingMetrics({
        now: clockAt(0).now,
        exportTelemetry: true,
      });
      exported.recordReconnectAsked(ProbeSchedulingLane.Work);
      exported.recordReconnectAsked(ProbeSchedulingLane.MonitorTests);

      expect(add.mock.calls).toEqual([
        [1, { lane: "work" }],
        [1, { lane: "monitor-tests" }],
      ]);
    });

    test("OneUptime's counter is made once, named and described beside the refusals'", () => {
      (AppMetrics as unknown as Record<string, unknown>)[
        "probeSchedulingReconnectCounter"
      ] = null;
      const made: Array<{ name: string; description: string; unit?: string }> =
        [];
      jest
        .spyOn(Telemetry, "getCounter")
        .mockImplementation(
          (data: { name: string; description: string; unit?: string }) => {
            made.push(data);
            return { add: jest.fn() } as never;
          },
        );

      const counter: unknown = AppMetrics.getProbeSchedulingReconnectCounter();
      expect(AppMetrics.getProbeSchedulingReconnectCounter()).toBe(counter);

      expect(made).toHaveLength(1);
      expect(made[0]).toMatchObject({
        name: "probe.scheduling.reconnect.count",
        unit: "1",
      });
      expect(made[0]!.description).toContain("Connection: close");
      expect(made[0]!.description).toContain("by lane");

      (AppMetrics as unknown as Record<string, unknown>)[
        "probeSchedulingReconnectCounter"
      ] = null;
    });
  });
});

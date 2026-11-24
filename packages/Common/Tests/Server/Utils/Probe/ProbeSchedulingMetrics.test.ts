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
    expect(LATENESS_BUCKETS_IN_SECONDS[LATENESS_BUCKETS_IN_SECONDS.length - 1]).toBe(3600);
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
    expect(snapshot.lanes[ProbeSchedulingLane.Work]!.slotWaitMs).toMatchObject(
      { count: 2, max: 4800 },
    );
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
});

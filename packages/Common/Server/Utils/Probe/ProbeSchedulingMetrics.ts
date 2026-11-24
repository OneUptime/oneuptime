import { KeyedConcurrencyRefusal } from "../KeyedConcurrencyLimiter";
import RollingHistogram, {
  RollingCount,
  RollingSummary,
} from "../RollingHistogram";
import AppMetrics from "../Telemetry/AppMetrics";
import ProbeSchedulingLane, {
  PROBE_SCHEDULING_LANES,
} from "./ProbeSchedulingLane";
import os from "os";

/*
 * WHAT AN OPERATOR AUTOSCALES PROBE SCHEDULING ON (issue #10819).
 *
 * A self-hosted install with 40,000 monitors had its probes answered busy
 * and its Test Monitor runs never picked up, and nothing said where the
 * dispatch path was short. This process's view of it, over the last
 * PROBE_SCHEDULING_METRICS_WINDOW_SECONDS:
 *
 *   - for each lane of the probe scheduling limit (ProbeSchedulingLane):
 *     the requests running and waiting for a slot now (the queue depth),
 *     the slots, how long the requests that got one waited for it, and how
 *     many were refused - answered busy - because the queue was full or
 *     they waited too long;
 *   - dispatch lag: how late each monitor was handed to its probe, past the
 *     moment its interval made it due (MonitorProbe.nextPingAt), and how
 *     many were handed out a whole interval or more late - a check that was
 *     skipped;
 *   - Test Monitor wait: how long each test run waited, from the moment
 *     someone asked for it to the moment a probe was handed it.
 *
 * ProbeSchedulingFleetMetrics adds up every App replica's view (through
 * Valkey) for /metrics/probe-scheduling, the endpoint KEDA reads. With an
 * OpenTelemetry exporter configured, the same go out as OneUptime's own
 * metrics (AppMetrics: probe.scheduling.*, probe.dispatch.lag,
 * probe.monitor_test.wait).
 */

export const PROBE_SCHEDULING_METRICS_WINDOW_SECONDS: number = 60;

// A slot is waited for from no time at all to the lane's wait limit.
export const SLOT_WAIT_BUCKETS_IN_MS: ReadonlyArray<number> = [
  1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2000, 3000, 4000, 5000, 10000,
  30000,
];

/*
 * How late a monitor or a test is handed out: within a few seconds when the
 * probes keep up, a minute or more when a one-minute monitor skipped a
 * check, up to an hour when they fell far behind.
 */
export const LATENESS_BUCKETS_IN_SECONDS: ReadonlyArray<number> = [
  0.5, 1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300, 600, 900, 1800,
  3600,
];

export interface ProbeSchedulingLaneState {
  running: number;
  waiting: number;
  maxConcurrentRequests: number;
}

export interface ProbeSchedulingLaneMetrics extends ProbeSchedulingLaneState {
  slotWaitMs: RollingSummary;
  refused: number;
  refusedQueueFull: number;
  refusedWaitedTooLong: number;
}

export interface ProbeSchedulingMetricsSnapshot {
  // Which App replica: its host name and process.
  replica: string;
  // When, in ms since the epoch.
  at: number;
  windowSeconds: number;
  lanes: Record<string, ProbeSchedulingLaneMetrics>;
  monitorsHandedOut: number;
  dispatchLagSeconds: RollingSummary;
  monitorsLateByAnInterval: number;
  monitorTestsHandedOut: number;
  monitorTestWaitSeconds: RollingSummary;
}

// What the limiter's lanes hold now.
export type ProbeSchedulingStateReader = (
  lane: ProbeSchedulingLane,
) => ProbeSchedulingLaneState;

export interface MonitorHandedOut {
  // When its interval made it due; null for one never scheduled.
  dueAt: Date | null;
  // Its interval, when it could be read.
  intervalInMs: number | null;
}

export interface ProbeSchedulingMetricsOptions {
  // Test seam: the clock, in ms.
  now?: (() => number) | undefined;
  replica?: string | undefined;
  // Also record into OneUptime's own OpenTelemetry metrics.
  exportTelemetry?: boolean | undefined;
}

function idleLane(): ProbeSchedulingLaneState {
  return { running: 0, waiting: 0, maxConcurrentRequests: 0 };
}

export class ProbeSchedulingMetrics {
  private readonly now: () => number;
  private readonly replica: string;
  private readonly exportTelemetry: boolean;
  private readonly slotWaits: Map<string, RollingHistogram> = new Map<
    string,
    RollingHistogram
  >();
  private readonly refusals: Map<string, RollingCount> = new Map<
    string,
    RollingCount
  >();
  private readonly dispatchLag: RollingHistogram;
  private readonly lateByAnInterval: RollingCount;
  private readonly monitorTestWait: RollingHistogram;
  private stateReader: ProbeSchedulingStateReader | null = null;

  public constructor(options: ProbeSchedulingMetricsOptions = {}) {
    this.now = options.now || Date.now;
    this.replica = options.replica || `${os.hostname()}:${process.pid}`;
    this.exportTelemetry = Boolean(options.exportTelemetry);

    const window: { windowSeconds: number; now: () => number } = {
      windowSeconds: PROBE_SCHEDULING_METRICS_WINDOW_SECONDS,
      now: this.now,
    };

    for (const lane of PROBE_SCHEDULING_LANES) {
      this.slotWaits.set(
        lane,
        new RollingHistogram({
          ...window,
          bucketBounds: [...SLOT_WAIT_BUCKETS_IN_MS],
        }),
      );

      for (const reason of Object.values(KeyedConcurrencyRefusal)) {
        this.refusals.set(`${lane}:${reason}`, new RollingCount(window));
      }
    }

    this.dispatchLag = new RollingHistogram({
      ...window,
      bucketBounds: [...LATENESS_BUCKETS_IN_SECONDS],
    });
    this.lateByAnInterval = new RollingCount(window);
    this.monitorTestWait = new RollingHistogram({
      ...window,
      bucketBounds: [...LATENESS_BUCKETS_IN_SECONDS],
    });
  }

  // The limiter whose lanes the snapshot reports.
  public observe(reader: ProbeSchedulingStateReader): void {
    this.stateReader = reader;
  }

  public recordSlotWait(lane: ProbeSchedulingLane, waitedMs: number): void {
    this.slotWaits.get(lane)?.record(waitedMs);

    if (this.exportTelemetry) {
      AppMetrics.getProbeSchedulingSlotWait().record(Math.max(0, waitedMs), {
        lane: lane,
      });
    }
  }

  public recordRefusal(
    lane: ProbeSchedulingLane,
    reason: KeyedConcurrencyRefusal,
  ): void {
    this.refusals.get(`${lane}:${reason}`)?.add(1);

    if (this.exportTelemetry) {
      AppMetrics.getProbeSchedulingRefusedCounter().add(1, {
        lane: lane,
        reason: reason,
      });
    }
  }

  /*
   * Monitors just handed to a probe: how late each one was, past when its
   * interval made it due, and whether by a whole interval or more.
   */
  public recordMonitorsHandedOut(data: {
    handedOutAt: Date;
    monitors: Array<MonitorHandedOut>;
  }): void {
    const handedOutAtMs: number = data.handedOutAt.getTime();

    for (const monitor of data.monitors) {
      if (!monitor.dueAt) {
        continue;
      }

      const lateMs: number = Math.max(
        0,
        handedOutAtMs - monitor.dueAt.getTime(),
      );

      this.dispatchLag.record(lateMs / 1000);

      if (monitor.intervalInMs && lateMs >= monitor.intervalInMs) {
        this.lateByAnInterval.add(1);
      }

      if (this.exportTelemetry) {
        AppMetrics.getProbeDispatchLag().record(lateMs);
      }
    }
  }

  // Test runs just handed to a probe, by when each was asked for.
  public recordMonitorTestsHandedOut(data: {
    handedOutAt: Date;
    askedAt: Array<Date>;
  }): void {
    const handedOutAtMs: number = data.handedOutAt.getTime();

    for (const askedAt of data.askedAt) {
      const waitedMs: number = Math.max(0, handedOutAtMs - askedAt.getTime());

      this.monitorTestWait.record(waitedMs / 1000);

      if (this.exportTelemetry) {
        AppMetrics.getProbeMonitorTestWait().record(waitedMs);
      }
    }
  }

  public laneState(lane: ProbeSchedulingLane): ProbeSchedulingLaneState {
    return this.stateReader ? this.stateReader(lane) : idleLane();
  }

  public snapshot(): ProbeSchedulingMetricsSnapshot {
    const lanes: Record<string, ProbeSchedulingLaneMetrics> = {};

    for (const lane of PROBE_SCHEDULING_LANES) {
      const queueFull: number =
        this.refusals
          .get(`${lane}:${KeyedConcurrencyRefusal.QueueFull}`)
          ?.total() || 0;
      const waitedTooLong: number =
        this.refusals
          .get(`${lane}:${KeyedConcurrencyRefusal.WaitedTooLong}`)
          ?.total() || 0;

      lanes[lane] = {
        ...this.laneState(lane),
        slotWaitMs: this.slotWaits.get(lane)!.summary(),
        refused: queueFull + waitedTooLong,
        refusedQueueFull: queueFull,
        refusedWaitedTooLong: waitedTooLong,
      };
    }

    const dispatchLag: RollingSummary = this.dispatchLag.summary();
    const monitorTestWait: RollingSummary = this.monitorTestWait.summary();

    return {
      replica: this.replica,
      at: this.now(),
      windowSeconds: PROBE_SCHEDULING_METRICS_WINDOW_SECONDS,
      lanes: lanes,
      monitorsHandedOut: dispatchLag.count,
      dispatchLagSeconds: dispatchLag,
      monitorsLateByAnInterval: this.lateByAnInterval.total(),
      monitorTestsHandedOut: monitorTestWait.count,
      monitorTestWaitSeconds: monitorTestWait,
    };
  }
}

export default new ProbeSchedulingMetrics({ exportTelemetry: true });

import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import {
  ProbeSchedulingMaxConcurrentMonitorTestRequests,
  ProbeSchedulingMaxConcurrentRequests,
} from "../../EnvironmentConfig";
import KeyedConcurrencyLimiter, {
  KeyedConcurrencyLimits,
  KeyedConcurrencyOrder,
  KeyedConcurrencyRefusal,
  KeyedConcurrencyRelease,
  KeyedConcurrencyWaitOptions,
} from "../KeyedConcurrencyLimiter";
import logger from "../Logger";
import AppMetrics from "../Telemetry/AppMetrics";
import ProbeSchedulingFleetMetrics from "./ProbeSchedulingFleetMetrics";
import ProbeSchedulingLane, {
  PROBE_SCHEDULING_LANES,
} from "./ProbeSchedulingLane";
import ProbeSchedulingMetricsInstance, {
  ProbeSchedulingLaneState,
  ProbeSchedulingMetrics,
} from "./ProbeSchedulingMetrics";

/*
 * THE PROBES' SCHEDULING REQUESTS (issues #7920 and #10819).
 *
 * Every worker of every probe replica asks the App servers for work on a
 * timer: the monitors due for a check (/monitor/list, once a minute per
 * worker, and again while it is handed full batches), the monitor tests
 * people asked for (/monitor-test/list, every ten seconds), the network
 * devices due for a poll (/probe/network-device/list, once a minute), and
 * the pending count its autoscaler reads (/monitor/pending-count) - and,
 * since issue #8051, the rest of its work: discovery scans, device
 * diagnostics, packet captures, VMware and OpenStack collections, OpenStack
 * checks, Data Security scans and Data Observability collections. Each holds
 * a Postgres connection of the pool the process shares with everything else
 * it serves (a network device list a second one, for the moment it resolves
 * the devices' SNMP credentials), and nothing bounded how many held one at
 * once: when the database slowed down, a fleet's requests piled up holding
 * connections a sign-in needed. What a probe reports back - results,
 * collections, captures - is not held to it: refusing a report would lose
 * work the probe has done.
 *
 * So they run in two lanes (ProbeSchedulingLane), each with slots and a
 * queue of its own, and the rest wait in their lane WITHOUT a connection
 * (KeyedConcurrencyLimiter):
 *
 *   - work: at most PROBE_SCHEDULING_MAX_CONCURRENT_REQUESTS at once in a
 *     process (a fifth of its pool by default, Utils/Database/
 *     ConnectionShares). The slots are shared fairly among the probes
 *     asking: a released slot goes to the waiting probe that holds the
 *     fewest (KeyedConcurrencyOrder.FewestRunning). A probe alone may use
 *     every slot, and probes that compete end up with equal shares however
 *     many replicas and workers each runs. It used to be at most half of
 *     the slots for one probe, whatever the others needed: an install whose
 *     monitors were all on one probe could never use the other half
 *     (#10819).
 *   - monitor tests: at most PROBE_SCHEDULING_MAX_CONCURRENT_MONITOR_TEST_
 *     REQUESTS at once (2 by default), with a queue of their own. Someone
 *     is waiting on the Dashboard for each test, and they used to wait in
 *     the same queue as every monitor fetch of the same probe: a fleet
 *     catching up with its monitors had its test fetches answered busy,
 *     again and again, and the test was never run (#10819).
 *
 * A request that finds its lane's queue full, or waits longer than
 * PROBE_SCHEDULING_MAX_WAIT_MS, is answered busy at once, well inside the
 * probe's slow-request threshold (PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS,
 * 10 s): what that answer is, each endpoint decides (an empty batch or a
 * 429 for a list, the last known count for the pending count) - nothing it
 * would have handed out is lost, it stays due for the next request.
 *
 * Per process, as the pool it protects is: the bound for a fleet is these
 * times the App replicas, and adding replicas adds their slots
 * (/metrics/probe-scheduling, ProbeSchedulingMetrics, says how full they
 * are).
 */

export const PROBE_SCHEDULING_BUSY_MESSAGE: string =
  "This OneUptime server is busy handing out work to probes. The probe asks again at its next tick.";

// Sent as Retry-After with a 429 from a probe scheduling endpoint.
export const PROBE_SCHEDULING_BUSY_RETRY_AFTER_SECONDS: number = 10;

// Longest a scheduling request waits for a slot before it is answered busy.
export const PROBE_SCHEDULING_MAX_WAIT_MS: number = 5000;

// The busy warning in the server log, at most once in this long per lane.
export const PROBE_SCHEDULING_BUSY_WARNING_EVERY_MS: number = 60 * 1000;

/*
 * The work lane of a process that runs `maxConcurrentRequests` at once. Any
 * one probe may hold every slot: the fair share is in the order a released
 * slot is handed out, not in a cap.
 */
export function probeSchedulingLimits(
  maxConcurrentRequests: number,
): KeyedConcurrencyLimits {
  const maxRunning: number = Math.max(1, Math.floor(maxConcurrentRequests));

  return {
    maxRunning: maxRunning,
    maxRunningPerKey: maxRunning,
    maxWaiting: maxRunning * 10,
    maxWaitingPerKey: maxRunning * 5,
    maxWaitMs: PROBE_SCHEDULING_MAX_WAIT_MS,
  };
}

/*
 * The monitor test lane of a process that runs `maxConcurrentRequests` test
 * fetches at once. Every probe replica has at most one in flight
 * (FetchMonitorTest is single flight), so the queue holds a large fleet's.
 */
export function monitorTestLaneLimits(
  maxConcurrentRequests: number,
): KeyedConcurrencyLimits {
  const maxRunning: number = Math.max(1, Math.floor(maxConcurrentRequests));
  const maxWaiting: number = Math.max(200, maxRunning * 50);

  return {
    maxRunning: maxRunning,
    maxRunningPerKey: maxRunning,
    maxWaiting: maxWaiting,
    maxWaitingPerKey: maxWaiting,
    maxWaitMs: PROBE_SCHEDULING_MAX_WAIT_MS,
  };
}

/*
 * The process is running all the probe scheduling it may in the request's
 * lane, and this request found the lane's queue full or waited too long.
 */
export class ProbeSchedulingBusyError extends TooManyRequestsException {
  public readonly reason: KeyedConcurrencyRefusal;

  public constructor(
    reason: KeyedConcurrencyRefusal = KeyedConcurrencyRefusal.WaitedTooLong,
  ) {
    super(PROBE_SCHEDULING_BUSY_MESSAGE);
    this.name = "ProbeSchedulingBusyError";
    this.reason = reason;
  }
}

// The probe went away before its request started; nobody is waiting for it.
export class ProbeSchedulingAbandonedError extends Error {
  public constructor() {
    super("The probe's scheduling request was abandoned by its client.");
    this.name = "ProbeSchedulingAbandonedError";
  }
}

export interface ProbeSchedulingRequestOptions
  extends KeyedConcurrencyWaitOptions {
  // The work lane unless said.
  lane?: ProbeSchedulingLane | undefined;
}

// What each lane's busy warning names.
const LANE_SETTING: Record<ProbeSchedulingLane, string> = {
  [ProbeSchedulingLane.Work]: "PROBE_SCHEDULING_MAX_CONCURRENT_REQUESTS",
  [ProbeSchedulingLane.MonitorTests]:
    "PROBE_SCHEDULING_MAX_CONCURRENT_MONITOR_TEST_REQUESTS",
};

const LANE_NAME: Record<ProbeSchedulingLane, string> = {
  [ProbeSchedulingLane.Work]: "work",
  [ProbeSchedulingLane.MonitorTests]: "monitor test",
};

interface BusyWarning {
  busySinceLastWarning: number;
  lastWarnedAt: number | null;
}

export class ProbeSchedulingLimiter {
  private lanes: Map<ProbeSchedulingLane, KeyedConcurrencyLimiter> = new Map<
    ProbeSchedulingLane,
    KeyedConcurrencyLimiter
  >();
  private busyWarnings: Map<ProbeSchedulingLane, BusyWarning> = new Map<
    ProbeSchedulingLane,
    BusyWarning
  >();
  public readonly metrics: ProbeSchedulingMetrics;

  public constructor(
    limits: KeyedConcurrencyLimits = probeSchedulingLimits(
      ProbeSchedulingMaxConcurrentRequests,
    ),
    monitorTestLimits: KeyedConcurrencyLimits = monitorTestLaneLimits(
      ProbeSchedulingMaxConcurrentMonitorTestRequests,
    ),
    metrics: ProbeSchedulingMetrics = new ProbeSchedulingMetrics(),
  ) {
    const lanes: Record<ProbeSchedulingLane, KeyedConcurrencyLimits> = {
      [ProbeSchedulingLane.Work]: limits,
      [ProbeSchedulingLane.MonitorTests]: monitorTestLimits,
    };

    for (const lane of PROBE_SCHEDULING_LANES) {
      this.lanes.set(
        lane,
        new KeyedConcurrencyLimiter({
          limits: lanes[lane],
          order: KeyedConcurrencyOrder.FewestRunning,
          busyError: (reason: KeyedConcurrencyRefusal): Error => {
            return new ProbeSchedulingBusyError(reason);
          },
          abandonedError: (): Error => {
            return new ProbeSchedulingAbandonedError();
          },
        }),
      );
      this.busyWarnings.set(lane, {
        busySinceLastWarning: 0,
        lastWarnedAt: null,
      });
    }

    this.metrics = metrics;
    this.metrics.observe(
      (lane: ProbeSchedulingLane): ProbeSchedulingLaneState => {
        return this.laneState(lane);
      },
    );
  }

  private lane(lane: ProbeSchedulingLane | undefined): KeyedConcurrencyLimiter {
    return this.lanes.get(lane || ProbeSchedulingLane.Work)!;
  }

  // The work lane's limits.
  public get limits(): KeyedConcurrencyLimits {
    return this.lane(ProbeSchedulingLane.Work).limits;
  }

  public laneLimits(lane: ProbeSchedulingLane): KeyedConcurrencyLimits {
    return this.lane(lane).limits;
  }

  public laneState(lane: ProbeSchedulingLane): ProbeSchedulingLaneState {
    const limiter: KeyedConcurrencyLimiter = this.lane(lane);

    return {
      running: limiter.runningCount(),
      waiting: limiter.waitingCount(),
      maxConcurrentRequests: limiter.limits.maxRunning,
    };
  }

  /*
   * Runs one scheduling request's work for the probe `probeKey` once a slot
   * of its lane is free. Throws ProbeSchedulingBusyError without running it
   * when the lane's queue is full or the wait too long, and
   * ProbeSchedulingAbandonedError without running it when `signal` fires
   * first.
   */
  public async run<T>(
    probeKey: string,
    work: () => Promise<T>,
    options?: ProbeSchedulingRequestOptions | undefined,
  ): Promise<T> {
    const release: KeyedConcurrencyRelease = await this.acquire(
      probeKey,
      options,
    );

    try {
      // The slot can be handed over in the same tick the client leaves.
      if (options?.signal?.aborted) {
        throw new ProbeSchedulingAbandonedError();
      }

      return await work();
    } finally {
      release();
    }
  }

  /*
   * Takes a slot of its lane for the probe `probeKey`, for a request whose
   * work spans more than one promise (Telemetry/Middleware/ProbeScheduling
   * holds it until the response is sent), and hands back the function that
   * gives it back. Refused as run() is.
   */
  public async acquire(
    probeKey: string,
    options?: ProbeSchedulingRequestOptions | undefined,
  ): Promise<KeyedConcurrencyRelease> {
    const lane: ProbeSchedulingLane = options?.lane || ProbeSchedulingLane.Work;
    const startedAt: number = Date.now();

    this.startReporting();

    try {
      const release: KeyedConcurrencyRelease = await this.lane(lane).acquire(
        probeKey,
        options,
      );

      this.metrics.recordSlotWait(lane, Date.now() - startedAt);

      return release;
    } catch (error) {
      if (error instanceof ProbeSchedulingBusyError) {
        this.metrics.recordRefusal(lane, error.reason);
        this.noteBusy(lane);
      }
      throw error;
    }
  }

  public runningCount(
    probeKey?: string,
    lane: ProbeSchedulingLane = ProbeSchedulingLane.Work,
  ): number {
    return this.lane(lane).runningCount(probeKey);
  }

  public waitingCount(
    probeKey?: string,
    lane: ProbeSchedulingLane = ProbeSchedulingLane.Work,
  ): number {
    return this.lane(lane).waitingCount(probeKey);
  }

  /*
   * For the limiter whose metrics are the process's (the default one), from
   * its first request: this replica's view goes to Valkey for
   * /metrics/probe-scheduling (ProbeSchedulingFleetMetrics), and the lanes'
   * requests running and waiting to OneUptime's own metrics.
   */
  private startReporting(): void {
    if (this.metrics !== ProbeSchedulingMetricsInstance) {
      return;
    }

    ProbeSchedulingFleetMetrics.ensurePublishing();

    AppMetrics.registerProbeSchedulingGauges(
      (): Array<{ lane: string; running: number; waiting: number }> => {
        return PROBE_SCHEDULING_LANES.map((lane: ProbeSchedulingLane) => {
          const state: ProbeSchedulingLaneState = this.laneState(lane);
          return {
            lane: lane,
            running: state.running,
            waiting: state.waiting,
          };
        });
      },
    );
  }

  /*
   * Says in the server log that probe requests are being answered busy in
   * a lane, at most once a minute per lane, with how many since it last
   * said so: under a burst every refused request would otherwise log a
   * line of its own.
   */
  private noteBusy(lane: ProbeSchedulingLane): void {
    const warning: BusyWarning = this.busyWarnings.get(lane)!;
    warning.busySinceLastWarning++;

    const now: number = Date.now();

    if (
      warning.lastWarnedAt !== null &&
      now - warning.lastWarnedAt < PROBE_SCHEDULING_BUSY_WARNING_EVERY_MS
    ) {
      return;
    }

    const limits: KeyedConcurrencyLimits = this.lane(lane).limits;

    logger.warn(
      `Probe scheduling is at its limit in this process: ${this.runningCount(undefined, lane)} requests running and ${this.waitingCount(undefined, lane)} waiting in the ${LANE_NAME[lane]} lane (${LANE_SETTING[lane]}=${limits.maxRunning}, shared fairly among the probes asking). ${warning.busySinceLastWarning} probe request(s) answered busy since the last report; what they would have been handed stays due, and the probes ask again at their next tick. /metrics/probe-scheduling says how long requests wait and how late monitors are handed out.`,
    );

    warning.lastWarnedAt = now;
    warning.busySinceLastWarning = 0;
  }
}

export default new ProbeSchedulingLimiter(
  undefined,
  undefined,
  ProbeSchedulingMetricsInstance,
);

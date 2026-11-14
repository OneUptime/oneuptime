import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import { ProbeSchedulingMaxConcurrentRequests } from "../../EnvironmentConfig";
import KeyedConcurrencyLimiter, {
  KeyedConcurrencyLimits,
  KeyedConcurrencyRelease,
  KeyedConcurrencyWaitOptions,
} from "../KeyedConcurrencyLimiter";
import logger from "../Logger";

/*
 * THE PROBES' SCHEDULING REQUESTS (issue #7920).
 *
 * Every worker of every probe replica asks the App servers for work on a
 * timer: the monitors due for a check (/monitor/list, once a minute per
 * worker), the monitor tests people asked for (/monitor-test/list, every ten
 * seconds), the network devices due for a poll (/probe/network-device/list,
 * once a minute), and the pending count its autoscaler reads
 * (/monitor/pending-count). Each holds a Postgres connection of the pool the
 * process shares with everything else it serves (a network device list a
 * second one, for the moment it resolves the devices' SNMP credentials),
 * and nothing bounded how
 * many held one at once: when the database slowed down, a fleet's requests
 * piled up holding connections a sign-in needed.
 *
 * So at most PROBE_SCHEDULING_MAX_CONCURRENT_REQUESTS of them run at once in
 * a process (a fifth of its pool by default, Utils/Database/ConnectionShares),
 * and at most half of that for one probe, so one probe's replicas cannot take
 * every slot. The rest wait in arrival order WITHOUT a connection
 * (KeyedConcurrencyLimiter). The queue is bounded - per process and per
 * probe - and a request that finds it full, or waits longer than
 * PROBE_SCHEDULING_MAX_WAIT_MS, is answered busy at once, well inside the
 * probe's slow-request threshold (PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS,
 * 10 s): what that answer is, each endpoint decides (an empty batch or a
 * 429 for a list, the last known count for the pending count) - nothing it
 * would have handed out is lost, it stays due for the next request.
 *
 * Per process; the bound for a fleet is this times the App replicas.
 */

export const PROBE_SCHEDULING_BUSY_MESSAGE: string =
  "This OneUptime server is busy handing out work to probes. The probe asks again at its next tick.";

// Sent as Retry-After with a 429 from a probe scheduling endpoint.
export const PROBE_SCHEDULING_BUSY_RETRY_AFTER_SECONDS: number = 10;

// Longest a scheduling request waits for a slot before it is answered busy.
export const PROBE_SCHEDULING_MAX_WAIT_MS: number = 5000;

// The busy warning in the server log, at most once in this long.
export const PROBE_SCHEDULING_BUSY_WARNING_EVERY_MS: number = 60 * 1000;

// The limits for a process that runs `maxConcurrentRequests` at once.
export function probeSchedulingLimits(
  maxConcurrentRequests: number,
): KeyedConcurrencyLimits {
  const maxRunning: number = Math.max(1, Math.floor(maxConcurrentRequests));

  return {
    maxRunning: maxRunning,
    maxRunningPerKey: Math.max(1, Math.ceil(maxRunning / 2)),
    maxWaiting: maxRunning * 10,
    maxWaitingPerKey: maxRunning * 5,
    maxWaitMs: PROBE_SCHEDULING_MAX_WAIT_MS,
  };
}

/*
 * The process is running all the probe scheduling it may, and this request
 * found the queue full or waited too long.
 */
export class ProbeSchedulingBusyError extends TooManyRequestsException {
  public constructor() {
    super(PROBE_SCHEDULING_BUSY_MESSAGE);
    this.name = "ProbeSchedulingBusyError";
  }
}

// The probe went away before its request started; nobody is waiting for it.
export class ProbeSchedulingAbandonedError extends Error {
  public constructor() {
    super("The probe's scheduling request was abandoned by its client.");
    this.name = "ProbeSchedulingAbandonedError";
  }
}

export class ProbeSchedulingLimiter {
  private limiter: KeyedConcurrencyLimiter;
  private busySinceLastWarning: number = 0;
  private lastWarnedAt: number | null = null;

  public constructor(
    limits: KeyedConcurrencyLimits = probeSchedulingLimits(
      ProbeSchedulingMaxConcurrentRequests,
    ),
  ) {
    this.limiter = new KeyedConcurrencyLimiter({
      limits: limits,
      busyError: (): Error => {
        return new ProbeSchedulingBusyError();
      },
      abandonedError: (): Error => {
        return new ProbeSchedulingAbandonedError();
      },
    });
  }

  public get limits(): KeyedConcurrencyLimits {
    return this.limiter.limits;
  }

  /*
   * Runs one scheduling request's work for the probe `probeKey` once a slot
   * is free. Throws ProbeSchedulingBusyError without running it when the
   * queue is full or the wait too long, and ProbeSchedulingAbandonedError
   * without running it when `signal` fires first.
   */
  public async run<T>(
    probeKey: string,
    work: () => Promise<T>,
    options?: KeyedConcurrencyWaitOptions | undefined,
  ): Promise<T> {
    try {
      return await this.limiter.run<T>(probeKey, work, options);
    } catch (error) {
      if (error instanceof ProbeSchedulingBusyError) {
        this.noteBusy();
      }
      throw error;
    }
  }

  /*
   * Takes a slot for the probe `probeKey`, for a request whose work spans
   * more than one promise (Telemetry/Middleware/ProbeScheduling holds it
   * until the response is sent), and hands back the function that gives it
   * back. Refused as run() is.
   */
  public async acquire(
    probeKey: string,
    options?: KeyedConcurrencyWaitOptions | undefined,
  ): Promise<KeyedConcurrencyRelease> {
    try {
      return await this.limiter.acquire(probeKey, options);
    } catch (error) {
      if (error instanceof ProbeSchedulingBusyError) {
        this.noteBusy();
      }
      throw error;
    }
  }

  public runningCount(probeKey?: string): number {
    return this.limiter.runningCount(probeKey);
  }

  public waitingCount(probeKey?: string): number {
    return this.limiter.waitingCount(probeKey);
  }

  /*
   * Says in the server log that probe requests are being answered busy, at
   * most once a minute, with how many since it last said so: under a burst
   * every refused request would otherwise log a line of its own.
   */
  private noteBusy(): void {
    this.busySinceLastWarning++;

    const now: number = Date.now();

    if (
      this.lastWarnedAt !== null &&
      now - this.lastWarnedAt < PROBE_SCHEDULING_BUSY_WARNING_EVERY_MS
    ) {
      return;
    }

    logger.warn(
      `Probe scheduling is at its limit in this process: ${this.runningCount()} requests running and ${this.waitingCount()} waiting (PROBE_SCHEDULING_MAX_CONCURRENT_REQUESTS=${this.limits.maxRunning}, at most ${this.limits.maxRunningPerKey} for one probe). ${this.busySinceLastWarning} probe request(s) answered busy since the last report; what they would have been handed stays due, and the probes ask again at their next tick.`,
    );

    this.lastWarnedAt = now;
    this.busySinceLastWarning = 0;
  }
}

export default new ProbeSchedulingLimiter();

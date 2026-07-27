// Set required env vars before importing anything that pulls Config.ts
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import ping from "ping";
import PingMonitor, {
  DEFAULT_PING_ATTEMPT_TIMEOUT_IN_MS,
  PING_PACKET_COUNT,
  PingResponse,
} from "../../../../Utils/Monitors/MonitorTypes/PingMonitor";
import MonitorCheckBudget, {
  MIN_MONITOR_CHECK_ATTEMPT_TIMEOUT_IN_MS,
  MONITOR_CHECK_RETRY_DELAY_IN_MS,
} from "Common/Types/Monitor/MonitorCheckBudget";
import Hostname from "Common/Types/API/Hostname";
import IPv4 from "Common/Types/IP/IPv4";
import PositiveNumber from "Common/Types/PositiveNumber";
import ObjectID from "Common/Types/ObjectID";

/*
 * A Ping check against an unresponsive IP used to cost `timeout × retries`.
 * With the shipped defaults (60s timeout, 3 retries) that is over three
 * minutes, so a 1-minute monitor could never report on schedule: results
 * landed ~3 intervals late and the monitor looked like it had stalled and then
 * caught up. These tests pin the two things that stop that happening — the
 * per-invocation deadline handed to `ping`, and the check-level deadline that
 * truncates retries.
 */

jest.mock("ping", () => {
  return {
    promise: {
      probe: jest.fn(),
    },
  };
});

type PingProbeFunction = (
  host: string,
  config: ping.PingConfig,
) => Promise<ping.PingResponse>;

const mockPingProbe: Mock<PingProbeFunction> = ping.promise
  .probe as unknown as Mock<PingProbeFunction>;

const HOST: IPv4 = new IPv4("10.0.0.1");
const MONITOR_ID: ObjectID = new ObjectID("100000000000000000000001");

type ProbeCall = [string, ping.PingConfig];

function getProbeCalls(): Array<ProbeCall> {
  return mockPingProbe.mock.calls as unknown as Array<ProbeCall>;
}

function getProbeConfigs(): Array<ping.PingConfig> {
  return getProbeCalls().map((call: ProbeCall) => {
    return call[1];
  });
}

function getLastProbeConfig(): ping.PingConfig {
  const configs: Array<ping.PingConfig> = getProbeConfigs();
  return configs[configs.length - 1]!;
}

function aliveResponse(timeInMs: number = 12): ping.PingResponse {
  return {
    inputHost: "10.0.0.1",
    host: "10.0.0.1",
    alive: true,
    output: "",
    time: timeInMs,
    times: [timeInMs, timeInMs, timeInMs, timeInMs, timeInMs],
    min: `${timeInMs}`,
    max: `${timeInMs}`,
    avg: `${timeInMs}`,
    stddev: "0",
    packetLoss: "0",
    numeric_host: "10.0.0.1",
  } as unknown as ping.PingResponse;
}

function deadResponse(): ping.PingResponse {
  return {
    inputHost: "10.0.0.1",
    host: "10.0.0.1",
    alive: false,
    output: "",
    time: "unknown",
    times: [],
    min: "unknown",
    max: "unknown",
    avg: "unknown",
    stddev: "unknown",
    packetLoss: "100.000",
    numeric_host: "10.0.0.1",
  } as unknown as ping.PingResponse;
}

/*
 * Stands in for a real ping: consumes the wall-clock the OS binary would have
 * consumed. Paired with jest's fake clock so the suite stays fast while the
 * budget arithmetic is exercised against realistic durations.
 */
function respondAfter(
  durationInMsProvider: (config: ping.PingConfig) => number,
  responseProvider: () => ping.PingResponse,
): void {
  mockPingProbe.mockImplementation(
    (_host: string, config: ping.PingConfig): Promise<ping.PingResponse> => {
      const durationInMs: number = durationInMsProvider(config);

      return new Promise<ping.PingResponse>(
        (resolve: (value: ping.PingResponse) => void) => {
          setTimeout(() => {
            resolve(responseProvider());
          }, durationInMs);
        },
      );
    },
  );
}

// A dead host consumes exactly the deadline the caller allowed it.
function respondDeadAtDeadline(): void {
  respondAfter((config: ping.PingConfig) => {
    return (config.deadline ?? config.timeout ?? 1) * 1000;
  }, deadResponse);
}

/*
 * Jest 28 has no runAllTimersAsync, so pump the fake clock by hand: fire the
 * pending timers, then yield so the promise chain they unblocked can schedule
 * the next one (another ping attempt, or the backoff between two attempts).
 */
async function flushTimers(): Promise<void> {
  for (let i: number = 0; i < 200; i++) {
    if (jest.getTimerCount() === 0) {
      // Give any in-flight microtasks a chance to schedule more work.
      await Promise.resolve();
      await Promise.resolve();

      if (jest.getTimerCount() === 0) {
        return;
      }
    }

    jest.runOnlyPendingTimers();

    await Promise.resolve();
    await Promise.resolve();
  }
}

describe("PingMonitor.getAttemptTimeoutInMs", () => {
  it("uses the configured timeout when there is no check deadline", () => {
    expect(
      PingMonitor.getAttemptTimeoutInMs({
        timeout: new PositiveNumber(15000),
      }),
    ).toBe(15000);
  });

  it("falls back to the default when no timeout is configured", () => {
    expect(PingMonitor.getAttemptTimeoutInMs({})).toBe(
      DEFAULT_PING_ATTEMPT_TIMEOUT_IN_MS,
    );
  });

  it("shortens the attempt to what is left of the check budget", () => {
    expect(
      PingMonitor.getAttemptTimeoutInMs({
        timeout: new PositiveNumber(15000),
        deadlineAt: new Date(Date.now() + 4000),
      }),
    ).toBeLessThanOrEqual(4000);
  });

  it("never stretches an attempt past the configured timeout", () => {
    expect(
      PingMonitor.getAttemptTimeoutInMs({
        timeout: new PositiveNumber(3000),
        deadlineAt: new Date(Date.now() + 600000),
      }),
    ).toBe(3000);
  });

  it("keeps a floor once the budget is spent, so the attempt still happens", () => {
    expect(
      PingMonitor.getAttemptTimeoutInMs({
        timeout: new PositiveNumber(15000),
        deadlineAt: new Date(Date.now() - 30000),
      }),
    ).toBe(MIN_MONITOR_CHECK_ATTEMPT_TIMEOUT_IN_MS);
  });
});

describe("PingMonitor.canRetry", () => {
  it("retries while attempts remain and no deadline is set", () => {
    expect(PingMonitor.canRetry({ retry: 3, currentRetryCount: 1 })).toBe(true);
  });

  it("stops once the retry count is exhausted", () => {
    expect(PingMonitor.canRetry({ retry: 3, currentRetryCount: 3 })).toBe(
      false,
    );
  });

  it("stops when the check deadline has passed, even with retries left", () => {
    expect(
      PingMonitor.canRetry({
        retry: 3,
        currentRetryCount: 1,
        deadlineAt: new Date(Date.now() - 1000),
      }),
    ).toBe(false);
  });

  it("stops when what is left cannot fit a backoff plus a real attempt", () => {
    const tooLittleInMs: number =
      MONITOR_CHECK_RETRY_DELAY_IN_MS + MIN_MONITOR_CHECK_ATTEMPT_TIMEOUT_IN_MS;

    expect(
      PingMonitor.canRetry({
        retry: 3,
        currentRetryCount: 1,
        deadlineAt: new Date(Date.now() + tooLittleInMs - 100),
      }),
    ).toBe(false);

    expect(
      PingMonitor.canRetry({
        retry: 3,
        currentRetryCount: 1,
        deadlineAt: new Date(Date.now() + tooLittleInMs + 5000),
      }),
    ).toBe(true);
  });
});

describe("PingMonitor.ping - options handed to the ping binary", () => {
  beforeEach(() => {
    mockPingProbe.mockReset();
    respondAfter(() => {
      return 0;
    }, aliveResponse);
  });

  it("sets a deadline so one invocation cannot outlive its attempt timeout", async () => {
    await PingMonitor.ping(HOST, {
      timeout: new PositiveNumber(9000),
      retry: 1,
      monitorId: MONITOR_ID,
    });

    const config: ping.PingConfig = getLastProbeConfig();

    /*
     * Without `deadline`, `ping -c 5 -W 9` sends its packets a second apart
     * and then waits the full per-reply timeout for the last one, so the
     * invocation outlives the timeout it was given.
     */
    expect(config.deadline).toBe(9);
    expect(config.timeout).toBe(9);
  });

  it("still sends the full packet count for loss and jitter stats", async () => {
    await PingMonitor.ping(HOST, {
      timeout: new PositiveNumber(9000),
      retry: 1,
    });

    expect(getLastProbeConfig().min_reply).toBe(PING_PACKET_COUNT);
  });

  it("rounds a sub-second timeout up to a whole second", async () => {
    await PingMonitor.ping(HOST, {
      timeout: new PositiveNumber(400),
      retry: 1,
    });

    const config: ping.PingConfig = getLastProbeConfig();

    expect(config.timeout).toBe(1);
    expect(config.deadline).toBe(1);
  });

  it("pings a Hostname by name", async () => {
    await PingMonitor.ping(new Hostname("example.com"), {
      timeout: new PositiveNumber(5000),
      retry: 1,
    });

    expect(getProbeCalls()[0]![0]).toBe("example.com");
  });

  it("reports packet statistics from a successful check", async () => {
    respondAfter(
      () => {
        return 0;
      },
      () => {
        return aliveResponse(20);
      },
    );

    const response: PingResponse | null = await PingMonitor.ping(HOST, {
      timeout: new PositiveNumber(5000),
      retry: 1,
    });

    expect(response?.pingResponse?.packetsSent).toBe(PING_PACKET_COUNT);
    expect(response?.pingResponse?.packetsReceived).toBe(PING_PACKET_COUNT);
    expect(response?.pingResponse?.packetLossPercent).toBe(0);
    expect(response?.pingResponse?.avgRoundTripTimeInMs).toBe(20);
  });
});

describe("PingMonitor.ping - the check stays inside its budget", () => {
  beforeEach(() => {
    mockPingProbe.mockReset();
    jest.useFakeTimers({ doNotFake: ["performance"] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("shrinks each attempt's deadline as the check budget is consumed", async () => {
    // Each attempt burns 10s of a 25s check budget.
    respondAfter(() => {
      return 10000;
    }, deadResponse);

    const pingPromise: Promise<PingResponse | null> = PingMonitor.ping(HOST, {
      timeout: new PositiveNumber(15000),
      retry: 3,
      deadlineAt: new Date(Date.now() + 25000),
      isOnlineCheckRequest: true,
    });

    await flushTimers();
    await pingPromise;

    const deadlines: Array<number | undefined> = getProbeConfigs().map(
      (config: ping.PingConfig) => {
        return config.deadline;
      },
    );

    expect(deadlines.length).toBeGreaterThan(1);

    // The first attempt gets the configured 15s; later ones only what is left.
    expect(deadlines[0]).toBe(15);
    expect(deadlines[1]!).toBeLessThan(deadlines[0]!);
  });

  interface Scenario {
    label: string;
    monitoringInterval: string;
  }

  const SCENARIOS: Array<Scenario> = [
    { label: "1-minute monitor", monitoringInterval: "* * * * *" },
    { label: "5-minute monitor", monitoringInterval: "*/5 * * * *" },
  ];

  it.each(SCENARIOS)(
    "a fully-failing check on a $label finishes inside its budget",
    async ({ monitoringInterval }: Scenario) => {
      respondDeadAtDeadline();

      const retryCount: number = 3;

      const checkBudgetInMs: number = MonitorCheckBudget.getCheckBudgetInMs({
        requestTimeoutInMs: 60000,
        monitoringInterval: monitoringInterval,
      });

      const reachabilityBudgetInMs: number =
        MonitorCheckBudget.getReachabilityBudgetInMs(checkBudgetInMs);

      const startedAtInMs: number = Date.now();

      const pingPromise: Promise<PingResponse | null> = PingMonitor.ping(HOST, {
        timeout: new PositiveNumber(
          MonitorCheckBudget.getAttemptTimeoutInMs({
            budgetInMs: reachabilityBudgetInMs,
            retryCount: retryCount,
          }),
        ),
        retry: retryCount,
        deadlineAt: new Date(startedAtInMs + reachabilityBudgetInMs),
        monitorId: MONITOR_ID,
        isOnlineCheckRequest: true,
      });

      await flushTimers();

      const response: PingResponse | null = await pingPromise;
      const elapsedInMs: number = Date.now() - startedAtInMs;

      expect(response?.isOnline).toBe(false);
      expect(elapsedInMs).toBeLessThanOrEqual(reachabilityBudgetInMs);

      /*
       * The whole point: the old code spent 60s per attempt × 3 attempts,
       * blowing past a 1-minute interval by minutes.
       */
      expect(elapsedInMs).toBeLessThan(60000);
    },
  );

  it("does not start a retry it cannot finish before the deadline", async () => {
    // A single attempt eats almost the entire budget.
    respondAfter(() => {
      return 19000;
    }, deadResponse);

    const startedAtInMs: number = Date.now();

    const pingPromise: Promise<PingResponse | null> = PingMonitor.ping(HOST, {
      timeout: new PositiveNumber(19000),
      retry: 3,
      deadlineAt: new Date(startedAtInMs + 20000),
      isOnlineCheckRequest: true,
    });

    await flushTimers();
    const response: PingResponse | null = await pingPromise;

    expect(getProbeCalls()).toHaveLength(1);
    expect(response?.totalAttempts).toBe(1);
    expect(Date.now() - startedAtInMs).toBeLessThanOrEqual(20000);
  });

  it("uses every attempt it can afford when they are cheap", async () => {
    respondAfter(() => {
      return 1000;
    }, deadResponse);

    const pingPromise: Promise<PingResponse | null> = PingMonitor.ping(HOST, {
      timeout: new PositiveNumber(11000),
      retry: 3,
      deadlineAt: new Date(Date.now() + 36000),
      isOnlineCheckRequest: true,
    });

    await flushTimers();
    const response: PingResponse | null = await pingPromise;

    expect(getProbeCalls()).toHaveLength(3);
    expect(response?.totalAttempts).toBe(3);
    expect(response?.probeAttempts).toHaveLength(3);
  });

  it("retries the configured number of times when no deadline is set", async () => {
    respondAfter(() => {
      return 1000;
    }, deadResponse);

    const pingPromise: Promise<PingResponse | null> = PingMonitor.ping(HOST, {
      timeout: new PositiveNumber(5000),
      retry: 3,
      isOnlineCheckRequest: true,
    });

    await flushTimers();
    const response: PingResponse | null = await pingPromise;

    expect(getProbeCalls()).toHaveLength(3);
    expect(response?.totalAttempts).toBe(3);
  });

  it("returns as soon as the host answers, without spending the budget", async () => {
    respondAfter(() => {
      return 40;
    }, aliveResponse);

    const startedAtInMs: number = Date.now();

    const pingPromise: Promise<PingResponse | null> = PingMonitor.ping(HOST, {
      timeout: new PositiveNumber(11000),
      retry: 3,
      deadlineAt: new Date(startedAtInMs + 36000),
    });

    await flushTimers();
    const response: PingResponse | null = await pingPromise;

    expect(response?.isOnline).toBe(true);
    expect(getProbeCalls()).toHaveLength(1);
    expect(Date.now() - startedAtInMs).toBeLessThan(1000);
  });

  it("records every attempt it made with its own timing", async () => {
    respondAfter(() => {
      return 2000;
    }, deadResponse);

    const pingPromise: Promise<PingResponse | null> = PingMonitor.ping(HOST, {
      timeout: new PositiveNumber(11000),
      retry: 2,
      deadlineAt: new Date(Date.now() + 36000),
      isOnlineCheckRequest: true,
    });

    await flushTimers();
    const response: PingResponse | null = await pingPromise;

    expect(response?.probeAttempts).toHaveLength(2);

    for (const attempt of response!.probeAttempts!) {
      expect(attempt.isOnline).toBe(false);
      expect(attempt.attemptedAt).toBeInstanceOf(Date);
      expect(attempt.responseReceivedAt).toBeInstanceOf(Date);
      expect(attempt.failureCause).toBeTruthy();
    }
  });
});

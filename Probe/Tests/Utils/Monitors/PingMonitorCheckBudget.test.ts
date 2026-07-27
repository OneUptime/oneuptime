// Set required env vars before importing anything that pulls Config.ts
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "100000000000000000000009";

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
import MonitorUtil from "../../../Utils/Monitors/Monitor";
import NetworkPathMonitor from "../../../Utils/Monitors/MonitorTypes/NetworkPathMonitor";
import MonitorCheckBudget from "Common/Types/Monitor/MonitorCheckBudget";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import IPv4 from "Common/Types/IP/IPv4";
import ObjectID from "Common/Types/ObjectID";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";

/*
 * The user-visible bug, end to end.
 *
 * A Ping monitor on a 1-minute interval whose target stops answering used to
 * log at 08:08, then 08:12, then 08:13, 08:14 — a four-minute hole followed by
 * an on-time run. Two things caused it: a check spent `timeout × retries`
 * (over three minutes on the defaults) because the request timeout was handed
 * to `ping` as the per-reply wait with no deadline, and the result was stamped
 * when the check FINISHED rather than when it started.
 *
 * These tests drive the real probeMonitorStep with the ping binary mocked, and
 * assert both: the check now fits inside its interval, and it reports the
 * moment it was taken.
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

const PROJECT_ID: ObjectID = new ObjectID("100000000000000000000001");
const MONITOR_ID: ObjectID = new ObjectID("100000000000000000000002");

const EVERY_MINUTE: string = "* * * * *";
const EVERY_FIVE_MINUTES: string = "*/5 * * * *";

function buildPingMonitorStep(overrides?: {
  requestTimeoutInMs?: number;
  retryCount?: number;
}): MonitorStep {
  const monitorStep: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorName: "MP56",
    monitorType: MonitorType.Ping,
    onlineMonitorStatusId: new ObjectID("100000000000000000000011"),
    offlineMonitorStatusId: new ObjectID("100000000000000000000012"),
    defaultIncidentSeverityId: new ObjectID("100000000000000000000013"),
    defaultAlertSeverityId: new ObjectID("100000000000000000000014"),
  });

  monitorStep.data!.monitorDestination = new IPv4("10.255.255.1");
  monitorStep.data!.requestTimeoutInMs = overrides?.requestTimeoutInMs ?? 60000;
  monitorStep.data!.retryCount = overrides?.retryCount ?? 3;

  return monitorStep;
}

// A dead host burns exactly the deadline the probe allowed the attempt.
function respondDeadAtDeadline(): void {
  mockPingProbe.mockImplementation(
    (_host: string, config: ping.PingConfig): Promise<ping.PingResponse> => {
      return new Promise<ping.PingResponse>(
        (resolve: (value: ping.PingResponse) => void) => {
          setTimeout(
            () => {
              resolve({
                inputHost: "10.255.255.1",
                host: "10.255.255.1",
                alive: false,
                output: "",
                time: "unknown",
                times: [],
                min: "unknown",
                max: "unknown",
                avg: "unknown",
                stddev: "unknown",
                packetLoss: "100.000",
                numeric_host: "10.255.255.1",
              } as unknown as ping.PingResponse);
            },
            (config.deadline ?? config.timeout ?? 1) * 1000,
          );
        },
      );
    },
  );
}

function respondAliveImmediately(): void {
  mockPingProbe.mockImplementation((): Promise<ping.PingResponse> => {
    return Promise.resolve({
      inputHost: "10.255.255.1",
      host: "10.255.255.1",
      alive: true,
      output: "",
      time: 8,
      times: [8, 8, 8, 8, 8],
      min: "8",
      max: "8",
      avg: "8",
      stddev: "0",
      packetLoss: "0",
      numeric_host: "10.255.255.1",
    } as unknown as ping.PingResponse);
  });
}

/*
 * Jest 28 has no runAllTimersAsync, so pump the fake clock by hand: fire the
 * pending timers, then yield so the promise chain they unblocked can schedule
 * the next one.
 */
async function flushTimers(): Promise<void> {
  for (let i: number = 0; i < 200; i++) {
    if (jest.getTimerCount() === 0) {
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

describe("probeMonitorStep - a failing Ping check fits inside its interval", () => {
  let traceSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    mockPingProbe.mockReset();

    /*
     * Failure diagnostics shell out to traceroute. Stub it out so the test
     * measures the probe's own budgeting, and assert on the timeout it was
     * handed instead.
     */
    traceSpy = jest
      .spyOn(NetworkPathMonitor, "trace")
      .mockImplementation(((): Promise<unknown> => {
        return Promise.resolve({ hops: [] });
      }) as never);

    jest.useFakeTimers({ doNotFake: ["performance"] });
  });

  afterEach(() => {
    jest.useRealTimers();
    traceSpy.mockRestore();
  });

  interface Scenario {
    label: string;
    monitoringInterval: string;
    intervalInMs: number;
  }

  const SCENARIOS: Array<Scenario> = [
    {
      label: "1-minute",
      monitoringInterval: EVERY_MINUTE,
      intervalInMs: 60 * 1000,
    },
    {
      label: "5-minute",
      monitoringInterval: EVERY_FIVE_MINUTES,
      intervalInMs: 5 * 60 * 1000,
    },
  ];

  it.each(SCENARIOS)(
    "an unreachable target on a $label monitor reports within the interval",
    async ({ monitoringInterval, intervalInMs }: Scenario) => {
      respondDeadAtDeadline();

      const startedAtInMs: number = Date.now();

      const resultPromise: Promise<ProbeMonitorResponse | null> =
        MonitorUtil.probeMonitorStep({
          monitorStep: buildPingMonitorStep(),
          monitorType: MonitorType.Ping,
          monitorId: MONITOR_ID,
          projectId: PROJECT_ID,
          monitoringInterval: monitoringInterval,
        });

      await flushTimers();

      const result: ProbeMonitorResponse | null = await resultPromise;
      const elapsedInMs: number = Date.now() - startedAtInMs;

      expect(result?.isOnline).toBe(false);

      /*
       * Before the fix this was ~194,000ms (3 × 60s attempts plus backoffs):
       * over three times a 1-minute interval, and three minutes of lateness
       * on a 5-minute one.
       */
      expect(elapsedInMs).toBeLessThan(intervalInMs);

      expect(elapsedInMs).toBeLessThanOrEqual(
        MonitorCheckBudget.getCheckBudgetInMs({
          requestTimeoutInMs: 60000,
          monitoringInterval: monitoringInterval,
        }),
      );
    },
  );

  it("stamps monitoredAt when the check STARTED, not when it finished", async () => {
    respondDeadAtDeadline();

    const startedAtInMs: number = Date.now();

    const resultPromise: Promise<ProbeMonitorResponse | null> =
      MonitorUtil.probeMonitorStep({
        monitorStep: buildPingMonitorStep(),
        monitorType: MonitorType.Ping,
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        monitoringInterval: EVERY_MINUTE,
      });

    await flushTimers();

    const result: ProbeMonitorResponse | null = await resultPromise;

    // The check consumed real (virtual) time...
    expect(Date.now()).toBeGreaterThan(startedAtInMs);

    // ...but reports the moment it began, so the log lands on schedule.
    expect(result!.monitoredAt.getTime()).toBe(startedAtInMs);
  });

  it("makes several bounded attempts rather than one long one", async () => {
    respondDeadAtDeadline();

    const resultPromise: Promise<ProbeMonitorResponse | null> =
      MonitorUtil.probeMonitorStep({
        monitorStep: buildPingMonitorStep({ retryCount: 3 }),
        monitorType: MonitorType.Ping,
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        monitoringInterval: EVERY_MINUTE,
      });

    await flushTimers();
    const result: ProbeMonitorResponse | null = await resultPromise;

    expect(result?.totalAttempts).toBe(3);

    for (const call of mockPingProbe.mock.calls) {
      const config: ping.PingConfig = call[1] as ping.PingConfig;

      // Each attempt is hard-bounded, and well short of the old 60s.
      expect(config.deadline).toBeDefined();
      expect(config.deadline!).toBeLessThan(60);
      expect(config.deadline!).toBeGreaterThan(0);
    }
  });

  it("gives a 5-minute monitor a longer per-attempt budget than a 1-minute one", async () => {
    respondDeadAtDeadline();

    const deadlinesFor: (
      monitoringInterval: string,
    ) => Promise<number> = async (
      monitoringInterval: string,
    ): Promise<number> => {
      mockPingProbe.mockClear();

      const resultPromise: Promise<ProbeMonitorResponse | null> =
        MonitorUtil.probeMonitorStep({
          monitorStep: buildPingMonitorStep(),
          monitorType: MonitorType.Ping,
          monitorId: MONITOR_ID,
          projectId: PROJECT_ID,
          monitoringInterval: monitoringInterval,
        });

      await flushTimers();
      await resultPromise;

      return (mockPingProbe.mock.calls[0]![1] as ping.PingConfig).deadline!;
    };

    const oneMinuteDeadline: number = await deadlinesFor(EVERY_MINUTE);
    const fiveMinuteDeadline: number = await deadlinesFor(EVERY_FIVE_MINUTES);

    expect(fiveMinuteDeadline).toBeGreaterThan(oneMinuteDeadline);
  });

  it("bounds the failure traceroute by what is left of the check budget", async () => {
    respondDeadAtDeadline();

    const resultPromise: Promise<ProbeMonitorResponse | null> =
      MonitorUtil.probeMonitorStep({
        monitorStep: buildPingMonitorStep(),
        monitorType: MonitorType.Ping,
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        monitoringInterval: EVERY_MINUTE,
      });

    await flushTimers();
    await resultPromise;

    expect(traceSpy).toHaveBeenCalled();

    const traceOptions: { timeout?: number } = traceSpy.mock.calls[0]![1] as {
      timeout?: number;
    };

    const checkBudgetInMs: number = MonitorCheckBudget.getCheckBudgetInMs({
      requestTimeoutInMs: 60000,
      monitoringInterval: EVERY_MINUTE,
    });

    expect(traceOptions.timeout).toBeGreaterThan(0);
    expect(traceOptions.timeout!).toBeLessThanOrEqual(
      MonitorCheckBudget.getDiagnosticsBudgetInMs(checkBudgetInMs),
    );
  });

  it("does not trace a healthy target, and returns promptly", async () => {
    respondAliveImmediately();

    const startedAtInMs: number = Date.now();

    const resultPromise: Promise<ProbeMonitorResponse | null> =
      MonitorUtil.probeMonitorStep({
        monitorStep: buildPingMonitorStep(),
        monitorType: MonitorType.Ping,
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        monitoringInterval: EVERY_MINUTE,
      });

    await flushTimers();
    const result: ProbeMonitorResponse | null = await resultPromise;

    expect(result?.isOnline).toBe(true);
    expect(result!.monitoredAt.getTime()).toBe(startedAtInMs);
    expect(mockPingProbe.mock.calls).toHaveLength(1);
    expect(traceSpy).not.toHaveBeenCalled();
  });

  it("keeps the configured timeout when the monitor has no interval (a monitor test)", async () => {
    respondDeadAtDeadline();

    const resultPromise: Promise<ProbeMonitorResponse | null> =
      MonitorUtil.probeMonitorStep({
        monitorStep: buildPingMonitorStep({
          requestTimeoutInMs: 9000,
          retryCount: 1,
        }),
        monitorType: MonitorType.Ping,
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
      });

    await flushTimers();
    await resultPromise;

    /*
     * No interval to fit inside, so the only limit is the user's 9s timeout
     * minus the diagnostics reserve.
     */
    const config: ping.PingConfig = mockPingProbe.mock
      .calls[0]![1] as ping.PingConfig;

    expect(config.deadline!).toBeLessThanOrEqual(9);
    expect(config.deadline!).toBeGreaterThan(0);
  });
});

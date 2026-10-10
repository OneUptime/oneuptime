// Set required env vars before importing anything that pulls Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";
/*
 * Different from every retry count used below, so a step that does not set
 * one is seen to get the probe-wide default.
 */
process.env["PROBE_MONITOR_RETRY_LIMIT"] = "2";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

// eslint-disable-next-line @typescript-eslint/typedef
const mockNtpQuery = jest.fn();
// eslint-disable-next-line @typescript-eslint/typedef
const mockTrace = jest.fn();

/*
 * Only the network exchange is replaced: getTarget, which decides the host
 * and the port, is the real one.
 */
jest.mock("../../../Utils/Monitors/MonitorTypes/NtpMonitor", () => {
  const actual: { default: { getTarget: unknown } } = jest.requireActual(
    "../../../Utils/Monitors/MonitorTypes/NtpMonitor",
  ) as { default: { getTarget: unknown } };

  return {
    __esModule: true,
    ...actual,
    default: {
      getTarget: actual.default.getTarget,
      query: (...args: Array<unknown>): unknown => {
        return mockNtpQuery(...args);
      },
    },
  };
});

jest.mock("../../../Utils/Monitors/MonitorTypes/NetworkPathMonitor", () => {
  return {
    __esModule: true,
    default: {
      trace: (...args: Array<unknown>): unknown => {
        return mockTrace(...args);
      },
    },
  };
});

import MonitorUtil from "../../../Utils/Monitors/Monitor";
import Hostname from "Common/Types/API/Hostname";
import IP from "Common/Types/IP/IP";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import NtpMonitorResponse from "Common/Types/Monitor/NtpMonitor/NtpMonitorResponse";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import { RequestFailedPhase } from "Common/Types/Probe/RequestFailedDetails";
import NetworkPathTrace from "Common/Types/Monitor/NetworkMonitor/NetworkPathTrace";

/*
 * How the probe runs an NTP step: what it hands NtpMonitor (the server, the
 * port, a five-second timeout unless the step sets one, the retries) and how
 * the answer becomes the result the server judges.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const MONITOR_ID: ObjectID = ObjectID.generate();

interface QueryArgs {
  host: Hostname | IP;
  port: Port | number | undefined;
  options: {
    retry?: number | undefined;
    timeout?: number | undefined;
    monitorId?: ObjectID | undefined;
  };
}

function ntpStep(destination?: Hostname | IP | undefined): MonitorStep {
  const step: MonitorStep = new MonitorStep();

  step.data = {
    ...(step.data as NonNullable<MonitorStep["data"]>),
    id: ObjectID.generate().toString(),
  } as NonNullable<MonitorStep["data"]>;

  if (destination) {
    step.setMonitorDestination(destination);
  }

  return step;
}

function lastQuery(): QueryArgs {
  return mockNtpQuery.mock.calls[
    mockNtpQuery.mock.calls.length - 1
  ]![0] as QueryArgs;
}

async function run(step: MonitorStep): Promise<ProbeMonitorResponse | null> {
  return MonitorUtil.probeMonitorStep({
    monitorStep: step,
    monitorType: MonitorType.NTP,
    monitorId: MONITOR_ID,
    projectId: PROJECT_ID,
  });
}

const HEALTHY: NtpMonitorResponse = {
  isOnline: true,
  isSynchronized: true,
  responseTimeInMs: 18,
  failureCause: "",
  isTimeout: false,
  serverAddress: "192.0.2.10",
  port: 123,
  stratum: 2,
  leapIndicator: 0,
  clockOffsetInMs: 3.5,
  totalAttempts: 1,
};

const SILENT: NtpMonitorResponse = {
  isOnline: false,
  isSynchronized: false,
  responseTimeInMs: 15000,
  failureCause:
    "No NTP reply from 192.0.2.10:123 within 5 seconds. Tried 3 times.",
  isTimeout: true,
  requestFailedDetails: {
    failedPhase: RequestFailedPhase.RequestTimeout,
    errorCode: "ETIMEDOUT",
    errorDescription: "No NTP reply within 5 seconds.",
    rawErrorMessage: "timeout",
  },
  serverAddress: "192.0.2.10",
  port: 123,
  totalAttempts: 3,
  probeAttempts: [],
};

beforeEach(() => {
  mockNtpQuery.mockReset();
  mockTrace.mockReset();
  mockNtpQuery.mockResolvedValue(HEALTHY as never);
  mockTrace.mockResolvedValue({ hops: [] } as never);
});

describe("an NTP step on the probe", () => {
  test("a step without a server is offline at once, and says why", async () => {
    const result: ProbeMonitorResponse | null = await run(ntpStep());

    expect(mockNtpQuery).not.toHaveBeenCalled();
    expect(result?.isOnline).toBe(false);
    expect(result?.failureCause).toBe("NTP server is not specified.");
  });

  test("asks the server on 123 when the step names no port", async () => {
    const result: ProbeMonitorResponse | null = await run(
      ntpStep(new Hostname("time.example.com")),
    );

    expect(lastQuery().host.toString()).toBe("time.example.com");
    expect(lastQuery().port).toBeUndefined();
    expect(result?.monitorDestinationPort?.toNumber()).toBe(123);
  });

  test("passes the step's port on", async () => {
    const step: MonitorStep = ntpStep(new Hostname("time.example.com")).setPort(
      new Port(1123),
    );

    const result: ProbeMonitorResponse | null = await run(step);

    expect((lastQuery().port as Port).toNumber()).toBe(1123);
    expect(result?.monitorDestinationPort?.toNumber()).toBe(1123);
  });

  test("a port written after the host wins over the step's port", async () => {
    const step: MonitorStep = ntpStep(
      Hostname.fromAuthority("time.example.com:4123"),
    ).setPort(new Port(1123));

    const result: ProbeMonitorResponse | null = await run(step);

    expect(result?.monitorDestinationPort?.toNumber()).toBe(4123);
  });

  test("waits five seconds per attempt by default, not the 60 of TCP and HTTP checks", async () => {
    await run(ntpStep(new IP("192.0.2.10")));

    expect(lastQuery().options.timeout).toBe(5000);
  });

  test("uses the step's timeout and retries when it sets them", async () => {
    const step: MonitorStep = ntpStep(new IP("192.0.2.10"))
      .setRequestTimeoutInMs(1500)
      .setRetryCount(0);

    await run(step);

    expect(lastQuery().options.timeout).toBe(1500);
    expect(lastQuery().options.retry).toBe(0);
    expect(lastQuery().options.monitorId?.toString()).toBe(
      MONITOR_ID.toString(),
    );
  });

  test("falls back to the probe's retry default", async () => {
    await run(ntpStep(new IP("192.0.2.10")));

    expect(lastQuery().options.retry).toBe(2);
  });

  test("an answer becomes an online result carrying the server's reply", async () => {
    const result: ProbeMonitorResponse | null = await run(
      ntpStep(new IP("192.0.2.10")),
    );

    expect(result?.isOnline).toBe(true);
    expect(result?.isTimeout).toBe(false);
    expect(result?.responseTimeInMs).toBe(18);
    expect(result?.failureCause).toBe("");
    expect(result?.ntpResponse).toEqual(HEALTHY);
    expect(result?.totalAttempts).toBe(1);
    expect(mockTrace).not.toHaveBeenCalled();
  });

  test("an answer without good time is online, with why it is not synchronized", async () => {
    mockNtpQuery.mockResolvedValue({
      ...HEALTHY,
      isSynchronized: false,
      stratum: 16,
      failureCause:
        "The server reports stratum 16: it is not synchronized to a time source.",
    } as never);

    const result: ProbeMonitorResponse | null = await run(
      ntpStep(new IP("192.0.2.10")),
    );

    expect(result?.isOnline).toBe(true);
    expect(result?.failureCause).toContain("stratum 16");
    // Reachable, so there is no route to blame.
    expect(mockTrace).not.toHaveBeenCalled();
  });

  test("silence is offline, with no response time, the failure details and a path trace", async () => {
    const trace: NetworkPathTrace = {
      hops: [],
    } as unknown as NetworkPathTrace;
    mockNtpQuery.mockResolvedValue(SILENT as never);
    mockTrace.mockResolvedValue(trace as never);

    const result: ProbeMonitorResponse | null = await run(
      ntpStep(new IP("192.0.2.10")),
    );

    expect(result?.isOnline).toBe(false);
    expect(result?.isTimeout).toBe(true);
    expect(result?.responseTimeInMs).toBeUndefined();
    expect(result?.failureCause).toBe(SILENT.failureCause);
    expect(result?.requestFailedDetails).toEqual(SILENT.requestFailedDetails);
    expect(result?.totalAttempts).toBe(3);
    expect(mockTrace).toHaveBeenCalledTimes(1);
    expect(result?.networkPathTrace).toBe(trace);
  });

  test("a path trace that fails does not fail the check", async () => {
    mockNtpQuery.mockResolvedValue(SILENT as never);
    mockTrace.mockRejectedValue(new Error("traceroute not installed") as never);

    const result: ProbeMonitorResponse | null = await run(
      ntpStep(new IP("192.0.2.10")),
    );

    expect(result?.isOnline).toBe(false);
    expect(result?.networkPathTrace).toBeUndefined();
  });

  test("a probe that has lost its own network reports nothing", async () => {
    mockNtpQuery.mockResolvedValue(null as never);

    expect(await run(ntpStep(new IP("192.0.2.10")))).toBeNull();
  });
});

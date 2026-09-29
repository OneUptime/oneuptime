process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

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

// How many times the resolver was asked, i.e. how many attempts ran.
let resolveCalls: number = 0;

class FailingResolver {
  public setServers(): void {
    // no-op: these tests never talk to a real resolver.
  }

  public async resolve4(): Promise<Array<{ address: string; ttl: number }>> {
    resolveCalls++;
    throw new Error("queryA ETIMEOUT example.com");
  }
}

jest.mock("dns", () => {
  return {
    __esModule: true,
    default: {
      promises: {
        Resolver: FailingResolver,
      },
    },
  };
});

import DnsMonitorUtil from "../../../../Utils/Monitors/MonitorTypes/DnsMonitor";
import DnsMonitorResponse from "Common/Types/Monitor/DnsMonitor/DnsMonitorResponse";
import DnsRecordType from "Common/Types/Monitor/DnsMonitor/DnsRecordType";
import MonitorStepDnsMonitor from "Common/Types/Monitor/MonitorStepDnsMonitor";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import Sleep from "Common/Types/Sleep";

/*
 * A retry value counts retries after the first attempt: 0 runs the query
 * once, 2 runs it up to three times.
 */

function buildConfig(retries: number | undefined): MonitorStepDnsMonitor {
  return {
    queryName: "example.com",
    recordType: DnsRecordType.A,
    hostname: "",
    port: 53,
    timeout: 5000,
    retries: retries,
  } as MonitorStepDnsMonitor;
}

function attemptNumbers(response: DnsMonitorResponse | null): Array<number> {
  return (response?.probeAttempts || []).map(
    (attempt: ProbeAttempt): number => {
      return attempt.attemptNumber;
    },
  );
}

let sleepSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  resolveCalls = 0;
  sleepSpy = jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("DnsMonitorUtil retries", () => {
  test("runs a persistent failure exactly once when retry is 0", async () => {
    const response: DnsMonitorResponse | null = await DnsMonitorUtil.query(
      buildConfig(5),
      { retry: 0, isOnlineCheckRequest: true },
    );

    expect(response?.isOnline).toBe(false);
    expect(response?.totalAttempts).toBe(1);
    expect(attemptNumbers(response)).toEqual([1]);
    expect(resolveCalls).toBe(1);
    expect(sleepSpy).not.toHaveBeenCalled();
    expect(response?.failureCause).toBe(
      "Request was tried 1 times and it timed out.",
    );
  });

  test("makes three attempts when retry is 2", async () => {
    const response: DnsMonitorResponse | null = await DnsMonitorUtil.query(
      buildConfig(5),
      { retry: 2, isOnlineCheckRequest: true },
    );

    expect(response?.totalAttempts).toBe(3);
    expect(attemptNumbers(response)).toEqual([1, 2, 3]);
    expect(resolveCalls).toBe(3);
    expect(sleepSpy).toHaveBeenCalledTimes(2);
    expect(response?.failureCause).toBe(
      "Request was tried 3 times and it timed out.",
    );
  });

  test("counts the config's retries after the first attempt when no retry option is passed", async () => {
    const response: DnsMonitorResponse | null = await DnsMonitorUtil.query(
      buildConfig(0),
      { isOnlineCheckRequest: true },
    );

    expect(response?.totalAttempts).toBe(1);
    expect(resolveCalls).toBe(1);
  });

  test("keeps three attempts when neither the caller nor the config sets retries", async () => {
    const response: DnsMonitorResponse | null = await DnsMonitorUtil.query(
      buildConfig(undefined),
      { isOnlineCheckRequest: true },
    );

    expect(response?.totalAttempts).toBe(3);
    expect(attemptNumbers(response)).toEqual([1, 2, 3]);
  });
});

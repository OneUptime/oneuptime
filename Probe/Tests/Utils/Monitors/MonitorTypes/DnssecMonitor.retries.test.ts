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

jest.mock("child_process", () => {
  return {
    __esModule: true,
    execFile: (
      _file: string,
      _args: Array<string>,
      _options: { timeout?: number | undefined },
      callback: (error: Error | null, stdout: string) => void,
    ): void => {
      callback(null, ";; flags: qr rd ra ad;\n");
    },
  };
});

import DnssecMonitorUtil from "../../../../Utils/Monitors/MonitorTypes/DnssecMonitor";
import DnssecMonitorResponse from "Common/Types/Monitor/DnssecMonitor/DnssecMonitorResponse";
import MonitorStepDnssecMonitor from "Common/Types/Monitor/MonitorStepDnssecMonitor";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import Sleep from "Common/Types/Sleep";

/*
 * A retry value counts retries after the first attempt: 0 runs the check
 * once, 2 runs it up to three times.
 *
 * Each dig leg swallows its own error, so the attempt-level failure is forced
 * by making the first leg throw.
 */

interface DnssecInternals {
  fetchDnskeys: () => Promise<Array<unknown>>;
}

function buildConfig(retries: number | undefined): MonitorStepDnssecMonitor {
  return {
    domainName: "example.com",
    resolvers: ["1.1.1.1"],
    checkNameserverConsistency: false,
    signatureExpiryWarningDays: 7,
    timeout: 10000,
    retries: retries,
  } as MonitorStepDnssecMonitor;
}

function attemptNumbers(response: DnssecMonitorResponse | null): Array<number> {
  return (response?.probeAttempts || []).map(
    (attempt: ProbeAttempt): number => {
      return attempt.attemptNumber;
    },
  );
}

let sleepSpy: ReturnType<typeof jest.spyOn>;
let fetchDnskeysSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  sleepSpy = jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined as never);
  fetchDnskeysSpy = jest
    .spyOn(DnssecMonitorUtil as unknown as DnssecInternals, "fetchDnskeys")
    .mockRejectedValue(
      new Error("connection timed out; no servers could be reached") as never,
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("DnssecMonitorUtil retries", () => {
  test("runs a persistent failure exactly once when retry is 0", async () => {
    const response: DnssecMonitorResponse | null =
      await DnssecMonitorUtil.query(buildConfig(5), {
        retry: 0,
        isOnlineCheckRequest: true,
      });

    expect(response?.isOnline).toBe(false);
    expect(response?.isTimeout).toBe(true);
    expect(response?.totalAttempts).toBe(1);
    expect(attemptNumbers(response)).toEqual([1]);
    expect(fetchDnskeysSpy).toHaveBeenCalledTimes(1);
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  test("makes three attempts when retry is 2", async () => {
    const response: DnssecMonitorResponse | null =
      await DnssecMonitorUtil.query(buildConfig(5), {
        retry: 2,
        isOnlineCheckRequest: true,
      });

    expect(response?.totalAttempts).toBe(3);
    expect(attemptNumbers(response)).toEqual([1, 2, 3]);
    expect(fetchDnskeysSpy).toHaveBeenCalledTimes(3);
    expect(sleepSpy).toHaveBeenCalledTimes(2);
  });

  test("counts the config's retries after the first attempt when no retry option is passed", async () => {
    const response: DnssecMonitorResponse | null =
      await DnssecMonitorUtil.query(buildConfig(0), {
        isOnlineCheckRequest: true,
      });

    expect(response?.totalAttempts).toBe(1);
    expect(fetchDnskeysSpy).toHaveBeenCalledTimes(1);
  });

  test("keeps three attempts when neither the caller nor the config sets retries", async () => {
    const response: DnssecMonitorResponse | null =
      await DnssecMonitorUtil.query(buildConfig(undefined), {
        isOnlineCheckRequest: true,
      });

    expect(response?.totalAttempts).toBe(3);
    expect(attemptNumbers(response)).toEqual([1, 2, 3]);
  });
});

// Set required env vars before importing modules that pull in Config.ts.
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
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import SnmpDataType from "Common/Types/Monitor/SnmpMonitor/SnmpDataType";
import SnmpMonitorResponse from "Common/Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import Sleep from "Common/Types/Sleep";
import logger from "Common/Server/Utils/Logger";
import SnmpMonitor from "../../../../Utils/Monitors/MonitorTypes/SnmpMonitor";

/*
 * A retry value counts retries AFTER the first attempt: 0 queries the device
 * once, 2 queries it up to three times. That holds whether the value arrives
 * as options.retry (the monitor step) or as config.retries (the SNMP form and
 * the network device poller, which passes no options.retry).
 *
 * The GET is stubbed at executeSnmpQuery, the one seam between the retry loop
 * and net-snmp, so no UDP socket is opened.
 */
type SnmpMonitorPrivate = {
  executeSnmpQuery: (
    config: MonitorStepSnmpMonitor,
    options: unknown,
  ) => Promise<unknown>;
};

function buildConfig(
  overrides?: Partial<MonitorStepSnmpMonitor>,
): MonitorStepSnmpMonitor {
  return {
    snmpVersion: SnmpVersion.V2c,
    hostname: "10.0.0.1",
    port: 161,
    communityString: "public",
    oids: [{ oid: "1.3.6.1.2.1.1.3.0" }],
    timeout: 5000,
    retries: 3,
    monitorInterfaces: false,
    ...overrides,
  } as MonitorStepSnmpMonitor;
}

function stubExecuteSnmpQuery(): jest.Mock {
  return jest.spyOn(
    SnmpMonitor as unknown as SnmpMonitorPrivate,
    "executeSnmpQuery",
  ) as unknown as jest.Mock;
}

function failEveryQuery(): jest.Mock {
  return stubExecuteSnmpQuery().mockRejectedValue(
    new Error("Request timed out") as never,
  );
}

function attemptNumbers(response: SnmpMonitorResponse | null): Array<number> {
  return (response?.probeAttempts || []).map((attempt: ProbeAttempt) => {
    return attempt.attemptNumber;
  });
}

describe("SnmpMonitor.query retries", () => {
  let sleepSpy: jest.Mock;

  beforeEach(() => {
    // The retry backoff is a real second otherwise.
    sleepSpy = jest
      .spyOn(Sleep, "sleep")
      .mockResolvedValue(undefined as never) as unknown as jest.Mock;
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("queries exactly once when options.retry is 0, even with config.retries set", async () => {
    const executeSnmpQuery: jest.Mock = failEveryQuery();

    const response: SnmpMonitorResponse | null = await SnmpMonitor.query(
      buildConfig({ retries: 3 }),
      { retry: 0, isOnlineCheckRequest: true },
    );

    expect(executeSnmpQuery).toHaveBeenCalledTimes(1);
    expect(sleepSpy).not.toHaveBeenCalled();
    expect(response?.isOnline).toBe(false);
    expect(response?.totalAttempts).toBe(1);
    expect(attemptNumbers(response)).toEqual([1]);
    expect(response?.failureCause).toBe(
      "Request was tried 1 times and it timed out.",
    );
  });

  test("queries three times when options.retry is 2", async () => {
    const executeSnmpQuery: jest.Mock = failEveryQuery();

    const response: SnmpMonitorResponse | null = await SnmpMonitor.query(
      buildConfig({ retries: 0 }),
      { retry: 2, isOnlineCheckRequest: true },
    );

    expect(executeSnmpQuery).toHaveBeenCalledTimes(3);
    expect(sleepSpy).toHaveBeenCalledTimes(2);
    expect(response?.isOnline).toBe(false);
    expect(response?.isTimeout).toBe(true);
    expect(response?.totalAttempts).toBe(3);
    expect(attemptNumbers(response)).toEqual([1, 2, 3]);
    // The attempt counter stays 1-based, so the message counts real attempts.
    expect(response?.failureCause).toBe(
      "Request was tried 3 times and it timed out.",
    );
  });

  test("falls back to config.retries as retries after the first attempt when options.retry is absent", async () => {
    const executeSnmpQuery: jest.Mock = failEveryQuery();

    const response: SnmpMonitorResponse | null = await SnmpMonitor.query(
      buildConfig({ retries: 2 }),
      { isOnlineCheckRequest: true },
    );

    expect(executeSnmpQuery).toHaveBeenCalledTimes(3);
    expect(response?.totalAttempts).toBe(3);
    expect(attemptNumbers(response)).toEqual([1, 2, 3]);
  });

  test("queries exactly once when config.retries is 0 and options.retry is absent", async () => {
    const executeSnmpQuery: jest.Mock = failEveryQuery();

    const response: SnmpMonitorResponse | null = await SnmpMonitor.query(
      buildConfig({ retries: 0 }),
      { isOnlineCheckRequest: true },
    );

    expect(executeSnmpQuery).toHaveBeenCalledTimes(1);
    expect(response?.totalAttempts).toBe(1);
  });

  test("keeps three attempts when neither options.retry nor config.retries is set", async () => {
    const executeSnmpQuery: jest.Mock = failEveryQuery();

    const response: SnmpMonitorResponse | null = await SnmpMonitor.query(
      buildConfig({ retries: undefined as unknown as number }),
      { isOnlineCheckRequest: true },
    );

    expect(executeSnmpQuery).toHaveBeenCalledTimes(3);
    expect(response?.totalAttempts).toBe(3);
    expect(attemptNumbers(response)).toEqual([1, 2, 3]);
  });

  test("retries once and recovers when options.retry is 1", async () => {
    const executeSnmpQuery: jest.Mock = stubExecuteSnmpQuery()
      .mockRejectedValueOnce(new Error("Request timed out") as never)
      .mockResolvedValueOnce([
        {
          oid: "1.3.6.1.2.1.1.3.0",
          value: 42,
          type: SnmpDataType.TimeTicks,
        },
      ] as never);

    const response: SnmpMonitorResponse | null = await SnmpMonitor.query(
      buildConfig({ retries: 0 }),
      { retry: 1, isOnlineCheckRequest: true },
    );

    expect(executeSnmpQuery).toHaveBeenCalledTimes(2);
    expect(response?.isOnline).toBe(true);
    expect(response?.totalAttempts).toBe(2);
    expect(attemptNumbers(response)).toEqual([1, 2]);
    expect(response?.oidResponses[0]?.value).toBe(42);
  });
});

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
  fetchParentDs: () => Promise<Array<unknown>>;
  fetchRrsigs: () => Promise<Array<unknown>>;
  checkResolvers: () => Promise<Array<unknown>>;
  checkNameserverConsistency: () => Promise<Array<unknown>>;
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

const VALID_DNSKEYS: Array<unknown> = [{ flags: 257, algorithm: 13 }];
const VALID_DS: Array<unknown> = [
  { keyTag: 1234, algorithm: 13, digestType: 2, digest: "abcd" },
];
const VALID_RRSIGS: Array<unknown> = [
  {
    typeCovered: "A",
    algorithm: 13,
    signerName: "example.com",
    keyTag: 1234,
    expiration: "2099-01-01T00:00:00Z",
  },
];
const VALID_RESOLVERS: Array<unknown> = [
  { resolver: "1.1.1.1", adFlag: true, servfailWhenValidating: false },
];
const VALID_NAMESERVERS: Array<unknown> = [
  { nameServer: "ns1.example.com", soaSerial: "123" },
  { nameServer: "ns2.example.com", soaSerial: "123" },
];

const VALIDATION_FAILURES: Array<{
  name: string;
  method: keyof DnssecInternals;
  records: Array<unknown>;
}> = [
  { name: "missing DNSKEY", method: "fetchDnskeys", records: [] },
  { name: "missing parent DS", method: "fetchParentDs", records: [] },
  { name: "missing RRSIG", method: "fetchRrsigs", records: [] },
  {
    name: "expired signature",
    method: "fetchRrsigs",
    records: [
      {
        typeCovered: "A",
        algorithm: 13,
        signerName: "example.com",
        keyTag: 1234,
        expiration: "2000-01-01T00:00:00Z",
      },
    ],
  },
  {
    name: "failed resolver validation",
    method: "checkResolvers",
    records: [
      { resolver: "1.1.1.1", adFlag: false, servfailWhenValidating: true },
    ],
  },
  {
    name: "resolver error",
    method: "checkResolvers",
    records: [
      {
        resolver: "1.1.1.1",
        adFlag: false,
        servfailWhenValidating: false,
        error: "timed out",
      },
    ],
  },
  {
    name: "inconsistent nameservers",
    method: "checkNameserverConsistency",
    records: [
      { nameServer: "ns1.example.com", soaSerial: "123" },
      { nameServer: "ns2.example.com", soaSerial: "456" },
    ],
  },
  {
    name: "nameserver error",
    method: "checkNameserverConsistency",
    records: [{ nameServer: "ns1.example.com", error: "query failed" }],
  },
];

describe("DNSSEC protocol validation retries", () => {
  const internals: DnssecInternals =
    DnssecMonitorUtil as unknown as DnssecInternals;
  beforeEach(() => {
    fetchDnskeysSpy.mockResolvedValue(VALID_DNSKEYS);
    jest.spyOn(internals, "fetchParentDs").mockResolvedValue(VALID_DS);
    jest.spyOn(internals, "fetchRrsigs").mockResolvedValue(VALID_RRSIGS);
    jest.spyOn(internals, "checkResolvers").mockResolvedValue(VALID_RESOLVERS);
    jest
      .spyOn(internals, "checkNameserverConsistency")
      .mockResolvedValue(VALID_NAMESERVERS);
  });

  test.each(VALIDATION_FAILURES)(
    "retries $name and retains the final validation verdict",
    async (failure: {
      name: string;
      method: keyof DnssecInternals;
      records: Array<unknown>;
    }) => {
      jest.spyOn(internals, failure.method).mockResolvedValue(failure.records);
      const response: DnssecMonitorResponse | null =
        await DnssecMonitorUtil.query(
          { ...buildConfig(3), checkNameserverConsistency: true },
          { retry: 2, isOnlineCheckRequest: true },
        );
      expect(response?.totalAttempts).toBe(3);
      expect(response?.isOnline).toBe(true);
      expect(response?.failureCause).toContain("validation failed");
      expect(
        response?.isChainValid === false ||
          response?.isNameserverConsistent === false,
      ).toBe(true);
      expect(
        response?.probeAttempts?.every((attempt: ProbeAttempt) => {
          return Boolean(attempt.failureCause);
        }),
      ).toBe(true);
      expect(fetchDnskeysSpy).toHaveBeenCalledTimes(3);
      expect(sleepSpy).toHaveBeenCalledTimes(2);
    },
  );

  test.each(["chain", "nameserver"])(
    "stops after a %s validation recovers",
    async (kind: string) => {
      if (kind === "chain") {
        fetchDnskeysSpy
          .mockResolvedValueOnce([])
          .mockResolvedValue(VALID_DNSKEYS);
      } else {
        jest
          .spyOn(internals, "checkNameserverConsistency")
          .mockResolvedValueOnce([
            { nameServer: "ns1.example.com", error: "failed" },
          ])
          .mockResolvedValue(VALID_NAMESERVERS);
      }
      const response: DnssecMonitorResponse | null =
        await DnssecMonitorUtil.query(
          { ...buildConfig(3), checkNameserverConsistency: true },
          { retry: 3, isOnlineCheckRequest: true },
        );
      expect(response?.totalAttempts).toBe(2);
      expect(response?.isChainValid).toBe(true);
      expect(response?.isNameserverConsistent).toBe(true);
      expect(response?.failureCause).toBe("");
      expect(response?.probeAttempts?.[0]?.failureCause).toContain(
        "validation failed",
      );
      expect(response?.probeAttempts?.[1]?.failureCause).toBeUndefined();
    },
  );

  test("explicit zero returns the initial failed verdict", async () => {
    fetchDnskeysSpy.mockResolvedValue([]);
    const response: DnssecMonitorResponse | null =
      await DnssecMonitorUtil.query(buildConfig(3), {
        retry: 0,
        isOnlineCheckRequest: true,
      });
    expect(response?.isChainValid).toBe(false);
    expect(response?.totalAttempts).toBe(1);
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  test("does not retry a valid chain solely because its signature is near expiry", async () => {
    jest.spyOn(internals, "fetchRrsigs").mockResolvedValue([
      {
        typeCovered: "A",
        algorithm: 13,
        signerName: "example.com",
        keyTag: 1234,
        expiration: new Date(Date.now() + 3 * 86400000).toISOString(),
      },
    ]);
    const response: DnssecMonitorResponse | null =
      await DnssecMonitorUtil.query(buildConfig(3), {
        retry: 3,
        isOnlineCheckRequest: true,
      });
    expect(response?.isChainValid).toBe(true);
    expect(response?.daysUntilSignatureExpiry).toBeLessThan(7);
    expect(response?.totalAttempts).toBe(1);
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  test("leaves optional nameserver consistency disabled", async () => {
    jest
      .spyOn(internals, "checkNameserverConsistency")
      .mockResolvedValue([{ nameServer: "ns1.example.com", error: "failed" }]);
    const response: DnssecMonitorResponse | null =
      await DnssecMonitorUtil.query(buildConfig(3), {
        retry: 3,
        isOnlineCheckRequest: true,
      });
    expect(response?.isChainValid).toBe(true);
    expect(response?.totalAttempts).toBe(1);
    expect(internals.checkNameserverConsistency).not.toHaveBeenCalled();
    expect(sleepSpy).not.toHaveBeenCalled();
  });
});

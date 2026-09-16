// Set required env vars before importing SSLMonitor (through Register/Config).
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

jest.mock("../../../../Utils/OnlineCheck", () => {
  return {
    __esModule: true,
    default: {
      canProbeMonitorWebsiteMonitors: jest.fn(async (): Promise<boolean> => {
        return true;
      }),
    },
  };
});

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

import URL from "Common/Types/API/URL";
import PositiveNumber from "Common/Types/PositiveNumber";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import Sleep from "Common/Types/Sleep";
import SSLMonitor, {
  SslResponse,
} from "../../../../Utils/Monitors/MonitorTypes/SslMonitor";

/*
 * SSLMonitor.ping's retry option counts retries AFTER the first attempt: 0
 * checks once, 2 checks up to three times. Only ping()'s own outer retry is
 * under test here - getSslMonitorResponse is stubbed, so getCertificate's
 * internal connect retry never runs - and the one-second sleep between
 * attempts is mocked out.
 */

const target: URL = URL.fromString("https://ssl-retry.example:8443/");

const connectionFailure: SslResponse = {
  isOnline: false,
  isTimeout: false,
  isValidCertificate: false,
  isSelfSigned: false,
  failureCause: "connect ECONNREFUSED 192.0.2.90:8443",
};

function attemptNumbers(response: SslResponse | null): Array<number> {
  return (response?.probeAttempts || []).map(
    (attempt: ProbeAttempt): number => {
      return attempt.attemptNumber;
    },
  );
}

// eslint-disable-next-line @typescript-eslint/typedef
let checkSpy = jest.spyOn(SSLMonitor, "getSslMonitorResponse");
// eslint-disable-next-line @typescript-eslint/typedef
let sleepSpy = jest.spyOn(Sleep, "sleep");

beforeEach(() => {
  checkSpy = jest
    .spyOn(SSLMonitor, "getSslMonitorResponse")
    .mockImplementation(async (): Promise<SslResponse> => {
      return { ...connectionFailure };
    });
  sleepSpy = jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SSLMonitor.ping retries on a persistent connection failure", () => {
  test("retry 0 checks exactly once", async () => {
    const response: SslResponse | null = await SSLMonitor.ping(target, {
      retry: 0,
      timeout: new PositiveNumber(1000),
      isOnlineCheckRequest: true,
    });

    expect(response?.isOnline).toBe(false);
    expect(checkSpy).toHaveBeenCalledTimes(1);
    expect(response?.totalAttempts).toBe(1);
    expect(attemptNumbers(response)).toEqual([1]);
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  test("retry 2 checks exactly three times", async () => {
    const response: SslResponse | null = await SSLMonitor.ping(target, {
      retry: 2,
      timeout: new PositiveNumber(1000),
      isOnlineCheckRequest: true,
    });

    expect(response?.isOnline).toBe(false);
    expect(checkSpy).toHaveBeenCalledTimes(3);
    expect(response?.totalAttempts).toBe(3);
    expect(attemptNumbers(response)).toEqual([1, 2, 3]);
    expect(sleepSpy).toHaveBeenCalledTimes(2);
  });

  test("no retry option keeps the five-attempt default", async () => {
    const response: SslResponse | null = await SSLMonitor.ping(target, {
      timeout: new PositiveNumber(1000),
      isOnlineCheckRequest: true,
    });

    expect(checkSpy).toHaveBeenCalledTimes(5);
    expect(response?.totalAttempts).toBe(5);
  });

  test("a certificate verdict is never retried, whatever the retry option", async () => {
    checkSpy.mockImplementation(async (): Promise<SslResponse> => {
      return {
        ...connectionFailure,
        failureCause: "certificate has expired",
        certificateValidationErrorCode: "CERT_HAS_EXPIRED",
      };
    });

    const response: SslResponse | null = await SSLMonitor.ping(target, {
      retry: 2,
      timeout: new PositiveNumber(1000),
      isOnlineCheckRequest: true,
    });

    expect(checkSpy).toHaveBeenCalledTimes(1);
    expect(response?.totalAttempts).toBe(1);
  });

  test("a timeout is never retried, whatever the retry option", async () => {
    checkSpy.mockImplementation(async (): Promise<SslResponse> => {
      return { ...connectionFailure, isTimeout: true };
    });

    const response: SslResponse | null = await SSLMonitor.ping(target, {
      retry: 2,
      timeout: new PositiveNumber(1000),
      isOnlineCheckRequest: true,
    });

    expect(checkSpy).toHaveBeenCalledTimes(1);
    expect(response?.totalAttempts).toBe(1);
  });
});

describe("SSLMonitor.ping retries when the check throws", () => {
  beforeEach(() => {
    checkSpy.mockRejectedValue(new Error("socket hang up"));
  });

  test("retry 0 checks exactly once", async () => {
    const response: SslResponse | null = await SSLMonitor.ping(target, {
      retry: 0,
      timeout: new PositiveNumber(1000),
      isOnlineCheckRequest: true,
    });

    expect(response?.isOnline).toBe(false);
    expect(checkSpy).toHaveBeenCalledTimes(1);
    expect(response?.totalAttempts).toBe(1);
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  test("retry 2 checks exactly three times", async () => {
    const response: SslResponse | null = await SSLMonitor.ping(target, {
      retry: 2,
      timeout: new PositiveNumber(1000),
      isOnlineCheckRequest: true,
    });

    expect(response?.isOnline).toBe(false);
    expect(checkSpy).toHaveBeenCalledTimes(3);
    expect(response?.totalAttempts).toBe(3);
    expect(attemptNumbers(response)).toEqual([1, 2, 3]);
    expect(sleepSpy).toHaveBeenCalledTimes(2);
  });

  test("no retry option keeps the five-attempt default", async () => {
    const response: SslResponse | null = await SSLMonitor.ping(target, {
      timeout: new PositiveNumber(1000),
      isOnlineCheckRequest: true,
    });

    expect(checkSpy).toHaveBeenCalledTimes(5);
    expect(response?.totalAttempts).toBe(5);
  });
});

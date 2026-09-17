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

const FAILURE_CASES: Array<{ name: string; response: SslResponse }> = [
  {
    name: "a certificate validation failure on a reachable peer",
    response: {
      ...connectionFailure,
      isOnline: true,
      certificateValidationErrorCode: "CERT_HAS_EXPIRED",
      failureCause: "certificate has expired",
    },
  },
  {
    name: "a certificate whose details could not be fetched",
    response: {
      ...connectionFailure,
      certificateValidationErrorCode: "DEPTH_ZERO_SELF_SIGNED_CERT",
      failureCause: "socket hang up while reading certificate details",
    },
  },
  {
    name: "a handshake timeout",
    response: {
      ...connectionFailure,
      isTimeout: true,
      failureCause: "SSL Certificate Monitor - the connection timed out.",
    },
  },
];

describe.each(FAILURE_CASES)(
  "SSLMonitor retries $name",
  (failure: { name: string; response: SslResponse }) => {
    beforeEach(() => {
      checkSpy.mockImplementation(async (): Promise<SslResponse> => {
        return { ...failure.response };
      });
    });

    test.each([0, 1, 2, 3])(
      "honors an explicit retry count of %s",
      async (retry: number) => {
        const response: SslResponse | null = await SSLMonitor.ping(target, {
          retry,
          timeout: new PositiveNumber(1234),
          isOnlineCheckRequest: true,
        });

        expect(checkSpy).toHaveBeenCalledTimes(retry + 1);
        expect(response?.totalAttempts).toBe(retry + 1);
        expect(attemptNumbers(response)).toEqual(
          Array.from(
            { length: retry + 1 },
            (_value: unknown, index: number) => {
              return index + 1;
            },
          ),
        );
        expect(sleepSpy).toHaveBeenCalledTimes(retry);
        expect(response?.isOnline).toBe(failure.response.isOnline);
        expect(response?.isValidCertificate).toBe(false);
        expect(response?.isTimeout).toBe(failure.response.isTimeout);
        expect(response?.certificateValidationErrorCode).toBe(
          failure.response.certificateValidationErrorCode,
        );
        expect(
          response?.probeAttempts?.every((attempt: ProbeAttempt) => {
            return attempt.failureCause === failure.response.failureCause;
          }),
        ).toBe(true);
        for (let attempt: number = 1; attempt <= retry + 1; attempt++) {
          expect(checkSpy).toHaveBeenNthCalledWith(
            attempt,
            "ssl-retry.example",
            8443,
            1234,
          );
        }
      },
    );

    test("recovers on the next attempt and retains the first failure", async () => {
      checkSpy
        .mockResolvedValueOnce({ ...failure.response })
        .mockResolvedValue({
          isOnline: true,
          isValidCertificate: true,
          isTimeout: false,
          failureCause: "",
        });

      const response: SslResponse | null = await SSLMonitor.ping(target, {
        retry: 3,
        timeout: new PositiveNumber(1234),
        isOnlineCheckRequest: true,
      });

      expect(checkSpy).toHaveBeenCalledTimes(2);
      expect(response?.totalAttempts).toBe(2);
      expect(response?.isOnline).toBe(true);
      expect(response?.isValidCertificate).toBe(true);
      expect(response?.isTimeout).toBe(false);
      expect(response?.probeAttempts?.[0]?.failureCause).toBe(
        failure.response.failureCause,
      );
      expect(response?.probeAttempts?.[1]?.failureCause).toBeUndefined();
      expect(sleepSpy).toHaveBeenCalledTimes(1);
    });
  },
);

test("a valid certificate succeeds without spending the retry budget", async () => {
  checkSpy.mockResolvedValue({
    isOnline: true,
    isValidCertificate: true,
    failureCause: "",
  });
  const response: SslResponse | null = await SSLMonitor.ping(target, {
    retry: 3,
    isOnlineCheckRequest: true,
  });

  expect(checkSpy).toHaveBeenCalledTimes(1);
  expect(response?.totalAttempts).toBe(1);
  expect(sleepSpy).not.toHaveBeenCalled();
});

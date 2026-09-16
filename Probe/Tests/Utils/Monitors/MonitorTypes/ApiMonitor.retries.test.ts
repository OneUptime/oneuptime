// Set required env vars before importing anything that pulls Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";
delete process.env["PROBE_ALLOW_PRIVATE_NETWORK_MONITORS"];

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import ApiMonitor, {
  APIResponse,
} from "../../../../Utils/Monitors/MonitorTypes/ApiMonitor";
import { HttpMonitorExecutionContext } from "../../../../Utils/Monitors/HttpMonitorRequest";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import PositiveNumber from "Common/Types/PositiveNumber";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import API from "Common/Utils/API";
import dns from "dns";

/*
 * A retry value counts retries AFTER the first attempt: 0 runs the check once,
 * 2 runs it up to three times. A monitor with no retry value keeps the five
 * attempts it always had.
 */

const TARGET_URL: string = "http://1.1.1.1/api/health";

/*
 * Generous whole-check budget so executionContext.canWait never cuts a retry
 * chain short; the sleeps between attempts are mocked out below.
 */
const CHECK_TIMEOUT: PositiveNumber = new PositiveNumber(60000);

function connectionRefusedError(): Error {
  const error: NodeJS.ErrnoException = new Error(
    "connect ECONNREFUSED 1.1.1.1:80",
  );
  error.code = "ECONNREFUSED";
  return error;
}

function errorResponse(statusCode: number): HTTPErrorResponse {
  return new HTTPErrorResponse(statusCode, { message: "failed" }, {});
}

function okResponse(): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, { ok: true }, {});
}

function attemptNumbers(response: APIResponse | null): Array<number> {
  return (response?.probeAttempts || []).map((attempt: ProbeAttempt) => {
    return attempt.attemptNumber;
  });
}

describe("ApiMonitor retries", () => {
  let sleepSpy: jest.SpyInstance;

  beforeEach(() => {
    sleepSpy = jest
      .spyOn(HttpMonitorExecutionContext.prototype, "sleep")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("on a persistent network failure", () => {
    it("makes exactly one attempt when retry is 0", async () => {
      const fetchSpy: jest.SpyInstance = jest
        .spyOn(API, "fetch")
        .mockRejectedValue(connectionRefusedError() as never);

      const response: APIResponse | null = await ApiMonitor.ping(
        URL.fromString(TARGET_URL),
        { retry: 0, timeout: CHECK_TIMEOUT, isOnlineCheckRequest: true },
      );

      expect(response).not.toBeNull();
      expect(response!.isOnline).toBe(false);
      expect(response!.totalAttempts).toBe(1);
      expect(attemptNumbers(response)).toEqual([1]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(sleepSpy).not.toHaveBeenCalled();
    });

    it("makes exactly three attempts when retry is 2", async () => {
      const fetchSpy: jest.SpyInstance = jest
        .spyOn(API, "fetch")
        .mockRejectedValue(connectionRefusedError() as never);

      const response: APIResponse | null = await ApiMonitor.ping(
        URL.fromString(TARGET_URL),
        { retry: 2, timeout: CHECK_TIMEOUT, isOnlineCheckRequest: true },
      );

      expect(response).not.toBeNull();
      expect(response!.isOnline).toBe(false);
      expect(response!.totalAttempts).toBe(3);
      expect(response!.probeAttempts).toHaveLength(3);
      expect(attemptNumbers(response)).toEqual([1, 2, 3]);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(sleepSpy).toHaveBeenCalledTimes(2);
    });

    it("keeps five attempts when no retry value is given", async () => {
      const fetchSpy: jest.SpyInstance = jest
        .spyOn(API, "fetch")
        .mockRejectedValue(connectionRefusedError() as never);

      const response: APIResponse | null = await ApiMonitor.ping(
        URL.fromString(TARGET_URL),
        { timeout: CHECK_TIMEOUT, isOnlineCheckRequest: true },
      );

      expect(response).not.toBeNull();
      expect(response!.totalAttempts).toBe(5);
      expect(attemptNumbers(response)).toEqual([1, 2, 3, 4, 5]);
      expect(fetchSpy).toHaveBeenCalledTimes(5);
    });
  });

  describe("on a persistent 5xx response", () => {
    it("makes exactly one attempt when retry is 0", async () => {
      const fetchSpy: jest.SpyInstance = jest
        .spyOn(API, "fetch")
        .mockResolvedValue(errorResponse(503) as never);

      const response: APIResponse | null = await ApiMonitor.ping(
        URL.fromString(TARGET_URL),
        { retry: 0, timeout: CHECK_TIMEOUT, isOnlineCheckRequest: true },
      );

      expect(response).not.toBeNull();
      expect(response!.statusCode).toBe(503);
      expect(response!.totalAttempts).toBe(1);
      expect(attemptNumbers(response)).toEqual([1]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(sleepSpy).not.toHaveBeenCalled();
    });

    it("makes exactly three attempts when retry is 2", async () => {
      const fetchSpy: jest.SpyInstance = jest
        .spyOn(API, "fetch")
        .mockResolvedValue(errorResponse(503) as never);

      const response: APIResponse | null = await ApiMonitor.ping(
        URL.fromString(TARGET_URL),
        { retry: 2, timeout: CHECK_TIMEOUT, isOnlineCheckRequest: true },
      );

      expect(response).not.toBeNull();
      expect(response!.statusCode).toBe(503);
      expect(response!.totalAttempts).toBe(3);
      expect(attemptNumbers(response)).toEqual([1, 2, 3]);
      expect(
        response!.probeAttempts!.map((attempt: ProbeAttempt) => {
          return attempt.failureCause;
        }),
      ).toEqual([
        "Server returned 503",
        "Server returned 503",
        "Server returned 503",
      ]);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(sleepSpy).toHaveBeenCalledTimes(2);
    });

    it("keeps five attempts when no retry value is given", async () => {
      const fetchSpy: jest.SpyInstance = jest
        .spyOn(API, "fetch")
        .mockResolvedValue(errorResponse(502) as never);

      const response: APIResponse | null = await ApiMonitor.ping(
        URL.fromString(TARGET_URL),
        { timeout: CHECK_TIMEOUT, isOnlineCheckRequest: true },
      );

      expect(response).not.toBeNull();
      expect(response!.totalAttempts).toBe(5);
      expect(attemptNumbers(response)).toEqual([1, 2, 3, 4, 5]);
      expect(fetchSpy).toHaveBeenCalledTimes(5);
    });

    it("recovers on a retry and reports every attempt made", async () => {
      const fetchSpy: jest.SpyInstance = jest
        .spyOn(API, "fetch")
        .mockResolvedValueOnce(errorResponse(503) as never)
        .mockResolvedValueOnce(okResponse() as never);

      const response: APIResponse | null = await ApiMonitor.ping(
        URL.fromString(TARGET_URL),
        { retry: 1, timeout: CHECK_TIMEOUT, isOnlineCheckRequest: true },
      );

      expect(response).not.toBeNull();
      expect(response!.statusCode).toBe(200);
      expect(response!.totalAttempts).toBe(2);
      expect(attemptNumbers(response)).toEqual([1, 2]);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  it("does not retry a 4xx response even with retries configured", async () => {
    const fetchSpy: jest.SpyInstance = jest
      .spyOn(API, "fetch")
      .mockResolvedValue(errorResponse(404) as never);

    const response: APIResponse | null = await ApiMonitor.ping(
      URL.fromString(TARGET_URL),
      { retry: 3, timeout: CHECK_TIMEOUT, isOnlineCheckRequest: true },
    );

    expect(response).not.toBeNull();
    expect(response!.statusCode).toBe(404);
    expect(response!.totalAttempts).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  describe("on a response slower than ten seconds", () => {
    beforeEach(() => {
      /*
       * Only the elapsed-time call (process.hrtime(start)) is faked; the
       * no-argument form keeps returning the real clock.
       */
      const realHrtime: typeof process.hrtime = process.hrtime;
      jest.spyOn(process, "hrtime").mockImplementation(((
        time?: [number, number],
      ): [number, number] => {
        return time ? [11, 0] : realHrtime();
      }) as typeof process.hrtime);
    });

    it("does not try again when retry is 0", async () => {
      const fetchSpy: jest.SpyInstance = jest
        .spyOn(API, "fetch")
        .mockResolvedValue(okResponse() as never);

      const response: APIResponse | null = await ApiMonitor.ping(
        URL.fromString(TARGET_URL),
        { retry: 0, timeout: CHECK_TIMEOUT, isOnlineCheckRequest: true },
      );

      expect(response).not.toBeNull();
      expect(response!.isOnline).toBe(true);
      expect(response!.totalAttempts).toBe(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(sleepSpy).not.toHaveBeenCalled();
    });

    it("makes exactly three attempts when retry is 2", async () => {
      const fetchSpy: jest.SpyInstance = jest
        .spyOn(API, "fetch")
        .mockResolvedValue(okResponse() as never);

      const response: APIResponse | null = await ApiMonitor.ping(
        URL.fromString(TARGET_URL),
        { retry: 2, timeout: CHECK_TIMEOUT, isOnlineCheckRequest: true },
      );

      expect(response).not.toBeNull();
      expect(response!.isOnline).toBe(true);
      expect(response!.totalAttempts).toBe(3);
      expect(attemptNumbers(response)).toEqual([1, 2, 3]);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });
  });

  /*
   * A guard refusal is never retried at monitor level, whatever the retry
   * value: retrying only some refusals would let the attempt count tell a DNS
   * failure apart from a policy block.
   */
  it("still makes exactly one attempt on a target-resolution refusal with retry 3", async () => {
    const host: string = "retries-refused-api.example.test";
    jest
      .spyOn(dns.promises, "lookup")
      .mockRejectedValue(new Error(`getaddrinfo EAI_AGAIN ${host}`) as never);
    const fetchSpy: jest.SpyInstance = jest.spyOn(API, "fetch");

    const response: APIResponse | null = await ApiMonitor.ping(
      URL.fromString(`https://${host}/health`),
      { retry: 3, timeout: CHECK_TIMEOUT, isOnlineCheckRequest: true },
    );

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(false);
    expect(response!.failureCause).toBe(
      `Monitor target host ${host} could not be reached.`,
    );
    expect(response!.totalAttempts).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sleepSpy).not.toHaveBeenCalled();
  });
});

// Set required env vars before importing anything that pulls Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";
delete process.env["PROBE_ALLOW_PRIVATE_NETWORK_MONITORS"];

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import WebsiteMonitor, {
  ProbeWebsiteResponse,
} from "../../../../Utils/Monitors/MonitorTypes/WebsiteMonitor";
import URL from "Common/Types/API/URL";
import TimeoutException from "Common/Types/Exception/TimeoutException";
import BadDataException from "Common/Types/Exception/BadDataException";
import HTML from "Common/Types/Html";
import PositiveNumber from "Common/Types/PositiveNumber";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import { RequestFailedPhase } from "Common/Types/Probe/RequestFailedDetails";
import Sleep from "Common/Types/Sleep";
import WebsiteRequest, { WebsiteResponse } from "Common/Types/WebsiteRequest";
import { AxiosError, AxiosHeaders, AxiosResponse } from "axios";
import dns from "dns";

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

/*
 * A retry value counts retries AFTER the first attempt: 0 runs the check once,
 * 2 runs it up to three times. A monitor with no retry value keeps the five
 * attempts it always had.
 */

const TARGET_URL: string = "http://1.1.1.1/status";

/*
 * Each attempt receives this timeout; the sleeps between attempts are mocked.
 */
const CHECK_TIMEOUT: PositiveNumber = new PositiveNumber(60000);

function connectionRefusedError(): Error {
  const error: NodeJS.ErrnoException = new Error(
    "connect ECONNREFUSED 1.1.1.1:80",
  );
  error.code = "ECONNREFUSED";
  return error;
}

function serverErrorResponse(statusCode: number): AxiosError {
  const response: AxiosResponse = {
    status: statusCode,
    statusText: "Service Unavailable",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: "down",
  };

  return new AxiosError(
    `Request failed with status code ${statusCode}`,
    AxiosError.ERR_BAD_RESPONSE,
    undefined,
    undefined,
    response,
  );
}

function okResponse(): WebsiteResponse {
  return {
    url: URL.fromString(TARGET_URL),
    requestHeaders: {},
    responseHeaders: {},
    responseStatusCode: 200,
    responseBody: new HTML("ok"),
    isOnline: true,
  };
}

function attemptNumbers(response: ProbeWebsiteResponse | null): Array<number> {
  return (response?.probeAttempts || []).map((attempt: ProbeAttempt) => {
    return attempt.attemptNumber;
  });
}

describe("WebsiteMonitor retries", () => {
  let sleepSpy: jest.SpyInstance;

  beforeEach(() => {
    sleepSpy = jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("on a persistent connection failure", () => {
    it("makes exactly one attempt when retry is 0", async () => {
      const fetchSpy: jest.SpyInstance = jest
        .spyOn(WebsiteRequest, "fetch")
        .mockRejectedValue(connectionRefusedError() as never);

      const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
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
        .spyOn(WebsiteRequest, "fetch")
        .mockRejectedValue(connectionRefusedError() as never);

      const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
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
        .spyOn(WebsiteRequest, "fetch")
        .mockRejectedValue(connectionRefusedError() as never);

      const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
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
        .spyOn(WebsiteRequest, "fetch")
        .mockRejectedValueOnce(connectionRefusedError() as never)
        .mockResolvedValueOnce(okResponse() as never);

      const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
        URL.fromString(TARGET_URL),
        { retry: 1, timeout: CHECK_TIMEOUT, isOnlineCheckRequest: true },
      );

      expect(response).not.toBeNull();
      expect(response!.isOnline).toBe(true);
      expect(response!.statusCode).toBe(200);
      expect(response!.totalAttempts).toBe(2);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("on a persistent 5xx response", () => {
    it("makes exactly one attempt when retry is 0", async () => {
      const fetchSpy: jest.SpyInstance = jest
        .spyOn(WebsiteRequest, "fetch")
        .mockRejectedValue(serverErrorResponse(503) as never);

      const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
        URL.fromString(TARGET_URL),
        { retry: 0, timeout: CHECK_TIMEOUT, isOnlineCheckRequest: true },
      );

      expect(response).not.toBeNull();
      expect(response!.statusCode).toBe(503);
      expect(response!.totalAttempts).toBe(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(sleepSpy).not.toHaveBeenCalled();
    });

    it("makes exactly three attempts when retry is 2", async () => {
      const fetchSpy: jest.SpyInstance = jest
        .spyOn(WebsiteRequest, "fetch")
        .mockRejectedValue(serverErrorResponse(503) as never);

      const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
        URL.fromString(TARGET_URL),
        { retry: 2, timeout: CHECK_TIMEOUT, isOnlineCheckRequest: true },
      );

      expect(response).not.toBeNull();
      expect(response!.statusCode).toBe(503);
      expect(response!.totalAttempts).toBe(3);
      expect(attemptNumbers(response)).toEqual([1, 2, 3]);
      expect(
        response!.probeAttempts!.map((attempt: ProbeAttempt) => {
          return attempt.responseCode;
        }),
      ).toEqual([503, 503, 503]);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe.each(["resolved", "rejected"])(
    "with %s HTTP error responses",
    (responseType: string) => {
      it.each(
        Array.from({ length: 200 }, (_value: unknown, index: number) => {
          return 400 + index;
        }),
      )(
        "retries HTTP %i through the configured attempt budget",
        async (statusCode: number) => {
          const fetchSpy: jest.SpyInstance = jest.spyOn(
            WebsiteRequest,
            "fetch",
          );
          if (responseType === "rejected") {
            fetchSpy.mockRejectedValue(
              serverErrorResponse(statusCode) as never,
            );
          } else {
            fetchSpy.mockResolvedValue({
              ...okResponse(),
              responseStatusCode: statusCode,
            } as never);
          }

          const response: ProbeWebsiteResponse | null =
            await WebsiteMonitor.ping(URL.fromString(TARGET_URL), {
              retry: 3,
              timeout: CHECK_TIMEOUT,
              isOnlineCheckRequest: true,
            });

          expect(response!.statusCode).toBe(statusCode);
          expect(response!.totalAttempts).toBe(4);
          expect(attemptNumbers(response)).toEqual([1, 2, 3, 4]);
          expect(
            response!.probeAttempts!.map((attempt: ProbeAttempt) => {
              return attempt.responseCode;
            }),
          ).toEqual([statusCode, statusCode, statusCode, statusCode]);
          expect(fetchSpy).toHaveBeenCalledTimes(4);
          expect(sleepSpy).toHaveBeenCalledTimes(3);
        },
      );
    },
  );

  it.each([400, 401, 403, 404, 408, 429, 500, 503, 599])(
    "does not retry HTTP %i when retry is zero",
    async (statusCode: number) => {
      const fetchSpy: jest.SpyInstance = jest
        .spyOn(WebsiteRequest, "fetch")
        .mockRejectedValue(serverErrorResponse(statusCode) as never);

      const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
        URL.fromString(TARGET_URL),
        { retry: 0, timeout: CHECK_TIMEOUT, isOnlineCheckRequest: true },
      );

      expect(response!.statusCode).toBe(statusCode);
      expect(response!.totalAttempts).toBe(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(sleepSpy).not.toHaveBeenCalled();
    },
  );

  it.each([0, 1, 3])(
    "retries a request timeout %i times",
    async (retries: number) => {
      const fetchSpy: jest.SpyInstance = jest
        .spyOn(WebsiteRequest, "fetch")
        .mockRejectedValue(
          new TimeoutException("Request timeout exceeded.") as never,
        );

      const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
        URL.fromString(TARGET_URL),
        { retry: retries, timeout: CHECK_TIMEOUT, isOnlineCheckRequest: true },
      );

      expect(response!.isOnline).toBe(false);
      expect(response!.isTimeout).toBe(true);
      expect(response!.totalAttempts).toBe(retries + 1);
      expect(fetchSpy).toHaveBeenCalledTimes(retries + 1);
      expect(sleepSpy).toHaveBeenCalledTimes(retries);
    },
  );

  describe.each([
    {
      name: "a native connection timeout",
      useAxiosError: false,
      code: "ETIMEDOUT",
      message: "connect ETIMEDOUT 1.1.1.1:80",
      isTimeout: true,
      failedPhase: RequestFailedPhase.RequestTimeout,
    },
    {
      name: "a native socket timeout",
      useAxiosError: false,
      code: "ESOCKETTIMEDOUT",
      message: "Socket stalled",
      isTimeout: true,
      failedPhase: RequestFailedPhase.RequestTimeout,
    },
    {
      name: "an Axios connection timeout",
      useAxiosError: true,
      code: "ETIMEDOUT",
      message: "connect ETIMEDOUT 1.1.1.1:80",
      isTimeout: true,
      failedPhase: RequestFailedPhase.RequestTimeout,
    },
    {
      name: "an Axios socket timeout",
      useAxiosError: true,
      code: "ESOCKETTIMEDOUT",
      message: "Socket stalled",
      isTimeout: true,
      failedPhase: RequestFailedPhase.RequestTimeout,
    },
    {
      name: "an Axios timeout abort",
      useAxiosError: true,
      code: "ECONNABORTED",
      message: "timeout of 1000ms exceeded",
      isTimeout: true,
      failedPhase: RequestFailedPhase.RequestAborted,
    },
    {
      name: "an unrelated connection abort",
      useAxiosError: true,
      code: "ECONNABORTED",
      message: "Connection aborted",
      isTimeout: false,
      failedPhase: RequestFailedPhase.RequestAborted,
    },
  ])(
    "when the transport reports $name",
    (scenario: {
      name: string;
      useAxiosError: boolean;
      code: string;
      message: string;
      isTimeout: boolean;
      failedPhase: RequestFailedPhase;
    }) => {
      it.each([0, 3])(
        "preserves transport timeout metadata after %i retries",
        async (retries: number) => {
          /*
           * Native timeout errors need not contain the words "timeout exceeded".
           * Axios also uses ECONNABORTED for failures unrelated to a timeout.
           */
          const error: NodeJS.ErrnoException = scenario.useAxiosError
            ? new AxiosError(scenario.message, scenario.code)
            : new Error(scenario.message);
          error.code = scenario.code;
          const fetchSpy: jest.SpyInstance = jest
            .spyOn(WebsiteRequest, "fetch")
            .mockRejectedValue(error as never);

          const response: ProbeWebsiteResponse | null =
            await WebsiteMonitor.ping(URL.fromString(TARGET_URL), {
              retry: retries,
              timeout: CHECK_TIMEOUT,
              isOnlineCheckRequest: true,
            });

          expect(response!.isOnline).toBe(false);
          expect(response!.totalAttempts).toBe(retries + 1);
          expect(fetchSpy).toHaveBeenCalledTimes(retries + 1);
          expect(sleepSpy).toHaveBeenCalledTimes(retries);
          expect(response!.requestFailedDetails?.errorCode).toBe(scenario.code);
          expect(response!.requestFailedDetails?.failedPhase).toBe(
            scenario.failedPhase,
          );
          expect(response!.isTimeout).toBe(scenario.isTimeout);
        },
      );
    },
  );

  it("preserves ordered metadata across a timeout, a 4xx, a network error and recovery", async () => {
    const fetchSpy: jest.SpyInstance = jest
      .spyOn(WebsiteRequest, "fetch")
      .mockRejectedValueOnce(
        new TimeoutException("Request timeout exceeded.") as never,
      )
      .mockRejectedValueOnce(serverErrorResponse(429) as never)
      .mockRejectedValueOnce(connectionRefusedError() as never)
      .mockResolvedValueOnce(okResponse() as never);

    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
      URL.fromString(TARGET_URL),
      { retry: 3, timeout: CHECK_TIMEOUT, isOnlineCheckRequest: true },
    );

    expect(response!.isOnline).toBe(true);
    expect(response!.isTimeout).toBe(false);
    expect(response!.statusCode).toBe(200);
    expect(response!.totalAttempts).toBe(4);
    expect(attemptNumbers(response)).toEqual([1, 2, 3, 4]);
    expect(
      response!.probeAttempts!.map((attempt: ProbeAttempt) => {
        return attempt.responseCode;
      }),
    ).toEqual([undefined, 429, undefined, 200]);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(sleepSpy).toHaveBeenCalledTimes(3);
  });

  it("does not label an exceeded response-size refusal as a timeout or retry it", async () => {
    const message: string =
      "Remote response exceeded the allowed cumulative size.";
    const fetchSpy: jest.SpyInstance = jest
      .spyOn(WebsiteRequest, "fetch")
      .mockRejectedValue(new BadDataException(message) as never);

    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
      URL.fromString(TARGET_URL),
      { retry: 3, timeout: CHECK_TIMEOUT, isOnlineCheckRequest: true },
    );

    expect(response!.isOnline).toBe(false);
    expect(response!.isTimeout).toBe(false);
    expect(response!.failureCause).toBe(message);
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
        .spyOn(WebsiteRequest, "fetch")
        .mockResolvedValue(okResponse() as never);

      const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
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
        .spyOn(WebsiteRequest, "fetch")
        .mockResolvedValue(okResponse() as never);

      const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
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
    const host: string = "retries-refused-target.example.test";
    jest
      .spyOn(dns.promises, "lookup")
      .mockRejectedValue(new Error(`getaddrinfo EAI_AGAIN ${host}`) as never);
    const fetchSpy: jest.SpyInstance = jest.spyOn(WebsiteRequest, "fetch");

    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
      URL.fromString(`https://${host}/`),
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

  it("still makes exactly one attempt on a blocked private address with retry 3", async () => {
    const host: string = "retries-private-target.example.test";
    jest
      .spyOn(dns.promises, "lookup")
      .mockResolvedValue([{ address: "10.23.45.67", family: 4 }] as never);
    const fetchSpy: jest.SpyInstance = jest.spyOn(WebsiteRequest, "fetch");

    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
      URL.fromString(`https://${host}/`),
      { retry: 3, timeout: CHECK_TIMEOUT, isOnlineCheckRequest: true },
    );

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(false);
    expect(response!.totalAttempts).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sleepSpy).not.toHaveBeenCalled();
  });
});

// Set required env vars before importing anything that pulls Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";
delete process.env["PROBE_ALLOW_PRIVATE_NETWORK_MONITORS"];

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import ApiMonitor, {
  APIResponse,
} from "../../../../Utils/Monitors/MonitorTypes/ApiMonitor";
import WebsiteMonitor, {
  ProbeWebsiteResponse,
} from "../../../../Utils/Monitors/MonitorTypes/WebsiteMonitor";
import OnlineCheck from "../../../../Utils/OnlineCheck";
import URL from "Common/Types/API/URL";
import APIException from "Common/Types/Exception/ApiException";
import PositiveNumber from "Common/Types/PositiveNumber";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import { RequestFailedPhase } from "Common/Types/Probe/RequestFailedDetails";
import Sleep from "Common/Types/Sleep";
import WebsiteRequest from "Common/Types/WebsiteRequest";
import API, { APIFetchOptions } from "Common/Utils/API";
import { AxiosError, AxiosHeaders, InternalAxiosRequestConfig } from "axios";

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
 * Website and API monitors against an IPv6 URL, run from a probe with no
 * usable IPv6.
 *
 * The reported case was a Ping monitor for 2001:518:2800:9::2 on hosted
 * probes without IPv6: every check failed before a packet left the probe,
 * while the host answered every echo from a machine that has IPv6. An HTTP
 * monitor for the same address fails the same way, with
 * "connect EADDRNOTAVAIL", and used to report it as the site not answering.
 *
 * Nothing here opens a socket. The request is stubbed at the layer each
 * monitor calls (WebsiteRequest.fetch, API.fetch) and rejects with the error
 * that layer really produces, built from the URL the monitor dispatched.
 */

const CUSTOMER_ADDRESS: string = "2001:518:2800:9::2";
const CUSTOMER_URL: string = `https://[${CUSTOMER_ADDRESS}]/`;

const CHECK_TIMEOUT: PositiveNumber = new PositiveNumber(60000);

/*
 * The shared wording for this failure, as the operator should read it. Not
 * "cannot send IPv6 traffic": from a TCP connect, EADDRNOTAVAIL is also what
 * a probe that has run out of local ports gets.
 */
const CUSTOMER_FAILURE_CAUSE: string = `This probe could not open an IPv6 connection from its own side (connect EADDRNOTAVAIL ${CUSTOMER_ADDRESS}:443 - Local (:::0)), so ${CUSTOMER_ADDRESS} was never contacted. This usually means the probe has no usable IPv6 address or route (less often, that it has run out of local ports); this says nothing about whether ${CUSTOMER_ADDRESS} is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.`;

/*
 * The socket error net.connect rejects with, as captured from Node 26 in a
 * container with IPv6 disabled on loopback (EADDRNOTAVAIL, the customer's
 * probe) and from one with no IPv6 route (ENETUNREACH).
 */
function connectError(data: {
  code: string;
  errno: number;
  address: string;
  port: number;
}): Error {
  const local: string = data.address.includes(":") ? ":::0" : "0.0.0.0:0";

  return Object.assign(
    new Error(
      `connect ${data.code} ${data.address}:${data.port} - Local (${local})`,
    ),
    {
      errno: data.errno,
      code: data.code,
      syscall: "connect",
      address: data.address,
      port: data.port,
    },
  );
}

function customerConnectError(): Error {
  return connectError({
    code: "EADDRNOTAVAIL",
    errno: -99,
    address: CUSTOMER_ADDRESS,
    port: 443,
  });
}

// axios's HTTP adapter wraps a socket error with AxiosError.from(err, null, config, req).
function axiosConnectError(dispatchedUrl: string, cause: Error): AxiosError {
  return AxiosError.from(
    cause,
    undefined,
    {
      url: dispatchedUrl,
      headers: new AxiosHeaders(),
    } as InternalAxiosRequestConfig,
    {},
  );
}

/*
 * API.fetch hands a response-less AxiosError to getErrorResponse, which
 * throws it wrapped in an APIException. Using the real function keeps the
 * wrapper's message and shape exactly what the API monitor catches.
 */
function apiFetchError(axiosError: AxiosError): APIException {
  try {
    API["getErrorResponse"](axiosError);
  } catch (error) {
    return error as APIException;
  }

  throw new Error("getErrorResponse returned instead of throwing");
}

// Makes WebsiteRequest.fetch fail the way axios fails for the URL it was given.
function failWebsiteRequestsWith(socketError: () => Error): jest.SpyInstance {
  return jest
    .spyOn(WebsiteRequest, "fetch")
    .mockImplementation(
      async (
        url: URL,
        options: Parameters<typeof WebsiteRequest.fetch>[1],
      ): Promise<never> => {
        throw axiosConnectError(
          options.dispatchUrl ?? url.toString(),
          socketError(),
        );
      },
    );
}

// Makes API.fetch fail the way it does for the URL it was given.
function failApiRequestsWith(socketError: () => Error): jest.SpyInstance {
  return jest
    .spyOn(API, "fetch")
    .mockImplementation(async (options: APIFetchOptions): Promise<never> => {
      throw apiFetchError(
        axiosConnectError(
          options.options?.dispatchUrl ?? options.url.toString(),
          socketError(),
        ),
      );
    });
}

function attemptFailureCauses(
  attempts: Array<ProbeAttempt> | undefined,
): Array<string | undefined> {
  return (attempts || []).map((attempt: ProbeAttempt) => {
    return attempt.failureCause;
  });
}

describe("HTTP monitors to an IPv6 URL from a probe with no IPv6", () => {
  let sleepSpy: jest.SpyInstance;
  let onlineCheckSpy: jest.SpyInstance;

  beforeEach(() => {
    sleepSpy = jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined);
    // The probe's own IPv4 reference checks pass, as they did for the customer.
    onlineCheckSpy = jest
      .spyOn(OnlineCheck, "canProbeMonitorWebsiteMonitors")
      .mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Website monitor", () => {
    it("reports the probe, not the site, on every attempt and in the result", async () => {
      const fetchSpy: jest.SpyInstance =
        failWebsiteRequestsWith(customerConnectError);

      const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
        URL.fromString(CUSTOMER_URL),
        { retry: 3, timeout: CHECK_TIMEOUT },
      );

      // Still a verdict: offline, with a cause that puts the failure on the probe.
      expect(response).not.toBeNull();
      expect(response!.isOnline).toBe(false);
      expect(response!.isTimeout).toBe(false);
      expect(response!.failureCause).toBe(CUSTOMER_FAILURE_CAUSE);

      // Retries are unchanged: four attempts, each carrying the same cause.
      expect(fetchSpy).toHaveBeenCalledTimes(4);
      expect(sleepSpy).toHaveBeenCalledTimes(3);
      expect(response!.totalAttempts).toBe(4);
      expect(attemptFailureCauses(response!.probeAttempts)).toEqual([
        CUSTOMER_FAILURE_CAUSE,
        CUSTOMER_FAILURE_CAUSE,
        CUSTOMER_FAILURE_CAUSE,
        CUSTOMER_FAILURE_CAUSE,
      ]);

      // The probe still checks its own health before reporting.
      expect(onlineCheckSpy).toHaveBeenCalledTimes(1);

      expect(response!.requestFailedDetails).toEqual({
        failedPhase: RequestFailedPhase.TCPConnection,
        errorCode: "EADDRNOTAVAIL",
        errorDescription:
          "The probe could not open the IPv6 connection from its own side, so the request was never sent and the server was never contacted. The failure is on the probe, not on the server.",
        rawErrorMessage: `connect EADDRNOTAVAIL ${CUSTOMER_ADDRESS}:443 - Local (:::0)`,
      });
      expect(response!.requestFailedDetails!.errorDescription).not.toContain(
        "No response received",
      );
    });

    it("hedges ENETUNREACH towards the probe having no IPv6 route", async () => {
      failWebsiteRequestsWith(() => {
        return connectError({
          code: "ENETUNREACH",
          errno: -101,
          address: CUSTOMER_ADDRESS,
          port: 443,
        });
      });

      const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
        URL.fromString(CUSTOMER_URL),
        { retry: 0, timeout: CHECK_TIMEOUT },
      );

      expect(response!.isOnline).toBe(false);
      expect(response!.failureCause).toBe(
        `This probe could not reach ${CUSTOMER_ADDRESS} over IPv6 (connect ENETUNREACH ${CUSTOMER_ADDRESS}:443 - Local (:::0)). Most likely this probe has no IPv6 route rather than ${CUSTOMER_ADDRESS} being down. Monitor IPv6 destinations from a probe that has IPv6 connectivity.`,
      );
      expect(response!.requestFailedDetails!.errorCode).toBe("ENETUNREACH");
    });

    it("keeps the message it had when the IPv6 host refuses the connection", async () => {
      const refused: () => Error = (): Error => {
        return connectError({
          code: "ECONNREFUSED",
          errno: -111,
          address: CUSTOMER_ADDRESS,
          port: 443,
        });
      };
      failWebsiteRequestsWith(refused);

      const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
        URL.fromString(CUSTOMER_URL),
        { retry: 0, timeout: CHECK_TIMEOUT },
      );

      expect(response!.failureCause).toBe(
        API.getFriendlyErrorMessage(axiosConnectError(CUSTOMER_URL, refused())),
      );
      expect(response!.failureCause).not.toContain("This probe");
      expect(response!.requestFailedDetails!.errorDescription).toContain(
        "Connection refused.",
      );
    });

    it("keeps the message it had for ENETUNREACH towards IPv4, which a router may have sent", async () => {
      const unreachable: () => Error = (): Error => {
        return connectError({
          code: "ENETUNREACH",
          errno: -101,
          address: "93.184.215.14",
          port: 80,
        });
      };
      failWebsiteRequestsWith(unreachable);

      const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
        URL.fromString("http://93.184.215.14/"),
        { retry: 0, timeout: CHECK_TIMEOUT },
      );

      expect(response!.failureCause).toBe(
        "connect ENETUNREACH 93.184.215.14:80 - Local (0.0.0.0:0)",
      );
      expect(response!.requestFailedDetails!.errorDescription).toBe(
        "Network unreachable. There is no route to the network where the server resides. This is typically a routing or connectivity issue.",
      );
    });
  });

  describe("API monitor", () => {
    it("reports the probe, not the API, through the APIException API.fetch throws", async () => {
      const fetchSpy: jest.SpyInstance =
        failApiRequestsWith(customerConnectError);

      const response: APIResponse | null = await ApiMonitor.ping(
        URL.fromString(CUSTOMER_URL),
        { retry: 3, timeout: CHECK_TIMEOUT },
      );

      expect(response).not.toBeNull();
      expect(response!.isOnline).toBe(false);
      expect(response!.isTimeout).toBe(false);
      expect(response!.failureCause).toBe(CUSTOMER_FAILURE_CAUSE);

      expect(fetchSpy).toHaveBeenCalledTimes(4);
      expect(sleepSpy).toHaveBeenCalledTimes(3);
      expect(response!.totalAttempts).toBe(4);
      expect(attemptFailureCauses(response!.probeAttempts)).toEqual([
        CUSTOMER_FAILURE_CAUSE,
        CUSTOMER_FAILURE_CAUSE,
        CUSTOMER_FAILURE_CAUSE,
        CUSTOMER_FAILURE_CAUSE,
      ]);
      expect(onlineCheckSpy).toHaveBeenCalledTimes(1);

      // Used to be phase Unknown, "Request failed: Request failed to ...".
      expect(response!.requestFailedDetails!.failedPhase).toBe(
        RequestFailedPhase.TCPConnection,
      );
      expect(response!.requestFailedDetails!.errorCode).toBe("EADDRNOTAVAIL");
      expect(response!.requestFailedDetails!.rawErrorMessage).toBe(
        `Request failed to ${CUSTOMER_URL}. connect EADDRNOTAVAIL ${CUSTOMER_ADDRESS}:443 - Local (:::0)`,
      );
    });

    it("keeps the message it had when the IPv6 host refuses the connection", async () => {
      const refused: () => Error = (): Error => {
        return connectError({
          code: "ECONNREFUSED",
          errno: -111,
          address: CUSTOMER_ADDRESS,
          port: 443,
        });
      };
      failApiRequestsWith(refused);

      const response: APIResponse | null = await ApiMonitor.ping(
        URL.fromString(CUSTOMER_URL),
        { retry: 0, timeout: CHECK_TIMEOUT },
      );

      expect(response!.failureCause).toBe(
        API.getFriendlyErrorMessage(
          apiFetchError(axiosConnectError(CUSTOMER_URL, refused())),
        ),
      );
      expect(response!.failureCause).not.toContain("This probe");
    });
  });
});

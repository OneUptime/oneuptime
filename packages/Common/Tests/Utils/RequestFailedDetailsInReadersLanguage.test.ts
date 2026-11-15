import EgressGuardException, {
  EgressFailureReason,
} from "../../Types/Exception/EgressGuardException";
import RequestFailedDetails, {
  RequestFailedPhase,
} from "../../Types/Probe/RequestFailedDetails";
import RequestFailedDetailsUtil from "../../Utils/RequestFailedDetailsUtil";
import {
  getRequestFailureDescriptionText,
  readRequestFailureDescription,
  REQUEST_FAILURE_DESCRIPTIONS,
  RequestFailureDescription,
  RequestFailureDescriptionReading,
} from "../../Utils/Monitor/RequestFailureDescriptions";
import { dashboardTranslator } from "../Helpers/DashboardLocales";
import { describe, expect, test } from "@jest/globals";
import {
  AxiosError,
  AxiosHeaders,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";

/*
 * THE WEBSITE AND API CHECKS' ERROR DETAILS, READ IN THE READER'S LANGUAGE
 * (#8001).
 *
 * RequestFailedDetailsUtil.getRequestFailedDetails writes what a failed request means - the
 * Error Details of a Website or API summary, the root cause's "- Error
 * Description:". Each explanation it writes is one of
 * RequestFailureDescriptions', so the summaries read it back and draw it in
 * the reader's language; the probe stores the same English as before
 * (Tests/Utils/RequestFailedDetails pins those sentences one by one).
 */

const config: InternalAxiosRequestConfig = {
  headers: new AxiosHeaders(),
  url: "https://shop.example.com/health",
} as InternalAxiosRequestConfig;

function responseError(status: number): AxiosError {
  const response: AxiosResponse = {
    data: {},
    status: status,
    statusText: "",
    headers: {},
    config: config,
  };

  return new AxiosError(
    `Request failed with status code ${status}`,
    "ERR_BAD_RESPONSE",
    config,
    {},
    response,
  );
}

function codeError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code: code });
}

function noResponseError(): AxiosError {
  return new AxiosError("socket hang up", "ECONNABORTEDX", config, {
    method: "GET",
  });
}

/*
 * A connect that failed on the probe, as axios's HTTP adapter wraps the
 * socket's error (the shapes Tests/Utils/RequestFailedDetails captured).
 */
function probeSideError(code: string, address: string): AxiosError {
  const local: string = address.includes(":") ? ":::0" : "0.0.0.0:0";
  const cause: Error = Object.assign(
    new Error(`connect ${code} ${address}:443 - Local (${local})`),
    { code: code, syscall: "connect", address: address, port: 443 },
  );

  return AxiosError.from(
    cause,
    undefined,
    {
      url: address.includes(":")
        ? `https://[${address}]/`
        : `https://${address}/`,
      headers: new AxiosHeaders(),
    } as InternalAxiosRequestConfig,
    {},
  );
}

const IPV6_ADDRESS: string = "2001:518:2800:9::2";

const IPV4_ADDRESS: string = "93.184.215.14";

interface FailedRequest {
  name: string;
  error: unknown;
  description: RequestFailureDescription;
  values?: RequestFailureDescriptionReading["values"];
}

const FAILED_REQUESTS: Array<FailedRequest> = [
  {
    name: "a target the guard refused as invalid",
    error: new EgressGuardException(
      "Monitor target URL is not valid.",
      EgressFailureReason.InvalidTarget,
    ),
    description: RequestFailureDescription.InvalidTarget,
    values: { message: "Monitor target URL is not valid." },
  },
  {
    name: "a target the guard could not reach",
    error: new EgressGuardException(
      "Monitor target host shop.example.com could not be reached.",
      EgressFailureReason.Unreachable,
    ),
    description: RequestFailureDescription.TargetUnreachable,
  },
  {
    name: "a connection the probe could not open",
    error: probeSideError("EADDRNOTAVAIL", IPV4_ADDRESS),
    description: RequestFailureDescription.ProbeCouldNotConnect,
  },
  {
    name: "an IPv6 connection the probe could not open",
    error: probeSideError("EADDRNOTAVAIL", IPV6_ADDRESS),
    description: RequestFailureDescription.ProbeCouldNotConnectOverIPv6,
  },
  {
    name: "a probe that cannot send IPv6",
    error: probeSideError("EAFNOSUPPORT", IPV6_ADDRESS),
    description: RequestFailureDescription.ProbeCannotSendIPv6,
  },
  {
    name: "no IPv6 route",
    error: probeSideError("ENETUNREACH", IPV6_ADDRESS),
    description: RequestFailureDescription.NoIPv6Route,
  },
  {
    name: "a network that cannot be reached",
    error: probeSideError("ENETUNREACH", IPV4_ADDRESS),
    description: RequestFailureDescription.NetworkUnreachable,
  },
  {
    name: "a name that did not resolve",
    error: codeError("ENOTFOUND", "getaddrinfo ENOTFOUND shop.example.com"),
    description: RequestFailureDescription.DnsResolutionFailed,
  },
  {
    name: "a refused connection",
    error: codeError("ECONNREFUSED", "connect ECONNREFUSED 203.0.113.7:443"),
    description: RequestFailureDescription.ConnectionRefused,
  },
  {
    name: "a reset connection",
    error: codeError("ECONNRESET", "read ECONNRESET"),
    description: RequestFailureDescription.ConnectionReset,
  },
  {
    name: "an aborted connection",
    error: codeError("ECONNABORTED", "connection aborted"),
    description: RequestFailureDescription.ConnectionAborted,
  },
  {
    name: "a request that timed out",
    error: codeError("ETIMEDOUT", "connect ETIMEDOUT 203.0.113.7:443"),
    description: RequestFailureDescription.RequestTimedOut,
  },
  {
    name: "a revoked certificate",
    error: codeError("CERT_REVOKED", "certificate has been revoked"),
    description: RequestFailureDescription.CertificateRevoked,
  },
  {
    name: "an expired certificate",
    error: new Error("certificate has expired"),
    description: RequestFailureDescription.CertificateExpired,
  },
  {
    name: "a self-signed certificate",
    error: new Error("self-signed certificate"),
    description: RequestFailureDescription.SelfSignedCertificate,
  },
  {
    name: "an unknown authority",
    error: new Error("unable to verify the first certificate"),
    description: RequestFailureDescription.CertificateUnknownAuthority,
  },
  {
    name: "a TLS handshake",
    error: new Error(
      "Client network socket disconnected before secure TLS connection was established",
    ),
    description: RequestFailureDescription.TlsHandshakeFailed,
  },
  {
    name: "a network error",
    error: new Error("Network Error"),
    description: RequestFailureDescription.NetworkError,
  },
  {
    name: "an unreachable host",
    error: codeError("EHOSTUNREACH", "host unreachable"),
    description: RequestFailureDescription.HostUnreachable,
  },
  {
    name: "a 503",
    error: responseError(503),
    description: RequestFailureDescription.HttpServerError,
    values: { status: "503" },
  },
  {
    name: "a 404",
    error: responseError(404),
    description: RequestFailureDescription.HttpNotFound,
    values: { status: "404" },
  },
  {
    name: "a 403",
    error: responseError(403),
    description: RequestFailureDescription.HttpForbidden,
    values: { status: "403" },
  },
  {
    name: "a 401",
    error: responseError(401),
    description: RequestFailureDescription.HttpUnauthorized,
    values: { status: "401" },
  },
  {
    name: "a 400",
    error: responseError(400),
    description: RequestFailureDescription.HttpBadRequest,
    values: { status: "400" },
  },
  {
    name: "a 429",
    error: responseError(429),
    description: RequestFailureDescription.HttpClientError,
    values: { status: "429" },
  },
  {
    name: "a 302",
    error: responseError(302),
    description: RequestFailureDescription.HttpStatus,
    values: { status: "302" },
  },
  {
    name: "a request with no response",
    error: noResponseError(),
    description: RequestFailureDescription.NoResponse,
  },
  {
    name: "anything else",
    error: new Error("Something unexpected"),
    description: RequestFailureDescription.RequestFailed,
    values: { message: "Something unexpected" },
  },
];

describe("RequestFailedDetailsUtil.getRequestFailedDetails writes every explanation from the table", () => {
  test.each(FAILED_REQUESTS)("$name", (request: FailedRequest) => {
    const details: RequestFailedDetails =
      RequestFailedDetailsUtil.getRequestFailedDetails(request.error);

    expect(readRequestFailureDescription(details.errorDescription)).toEqual({
      description: request.description,
      values: request.values || {},
    });
  });

  test("a fixed one is the table's English, character for character", () => {
    const details: RequestFailedDetails =
      RequestFailedDetailsUtil.getRequestFailedDetails(
        codeError("ECONNREFUSED", "connect ECONNREFUSED 203.0.113.7:443"),
      );

    expect(details.failedPhase).toBe(RequestFailedPhase.TCPConnection);
    expect(details.errorDescription).toBe(
      REQUEST_FAILURE_DESCRIPTIONS[RequestFailureDescription.ConnectionRefused],
    );
  });

  test("every one it writes is covered here", () => {
    const covered: Set<RequestFailureDescription> = new Set(
      FAILED_REQUESTS.map((request: FailedRequest) => {
        return request.description;
      }),
    );
    const uncovered: Array<RequestFailureDescription> = Object.values(
      RequestFailureDescription,
    ).filter((description: RequestFailureDescription): boolean => {
      return (
        !covered.has(description) &&
        !description.startsWith("Port") &&
        !description.startsWith("Ntp")
      );
    });

    // The Port and NTP checks' own are read in the Probe's tests.
    expect(uncovered).toEqual([]);
  });

  test("a network that cannot be reached, named by its errno alone", () => {
    const details: RequestFailedDetails =
      RequestFailedDetailsUtil.getRequestFailedDetails(
        codeError("ENETUNREACH", "network unreachable"),
      );

    expect(readRequestFailureDescription(details.errorDescription)).toEqual({
      description: RequestFailureDescription.NetworkUnreachable,
      values: {},
    });
  });
});

describe("what a German and a Persian reader see as Error Details", () => {
  test.each(["de", "fa"])(
    "in %s: every explanation the check writes reads in the reader's language",
    (language: string) => {
      for (const request of FAILED_REQUESTS) {
        const stored: string = RequestFailedDetailsUtil.getRequestFailedDetails(
          request.error,
        ).errorDescription;
        const drawn: string = getRequestFailureDescriptionText({
          translator: dashboardTranslator(language),
          description: stored,
          options: { setsValuesApart: true },
        });

        expect({ name: request.name, same: drawn === stored }).toEqual({
          name: request.name,
          same: false,
        });
      }
    },
  );

  test("in English: as the probe stored it", () => {
    for (const request of FAILED_REQUESTS) {
      const stored: string = RequestFailedDetailsUtil.getRequestFailedDetails(
        request.error,
      ).errorDescription;

      expect(
        getRequestFailureDescriptionText({
          translator: dashboardTranslator("en"),
          description: stored,
          options: { setsValuesApart: true },
        }),
      ).toBe(stored);
    }
  });
});

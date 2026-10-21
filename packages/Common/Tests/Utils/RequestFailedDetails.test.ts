import APIException from "../../Types/Exception/ApiException";
import BadDataException from "../../Types/Exception/BadDataException";
import EgressGuardException, {
  EgressFailureReason,
} from "../../Types/Exception/EgressGuardException";
import RequestFailedDetails, {
  RequestFailedPhase,
} from "../../Types/Probe/RequestFailedDetails";
import API from "../../Utils/API";
import { describe, expect, test } from "@jest/globals";
import {
  AxiosError,
  AxiosHeaders,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";

/*
 * Tests for API.getRequestFailedDetails - the function that turns a thrown
 * request error into the "Request Failed Details" block a user reads on an
 * incident. Common/Tests/Utils/API.test.ts covers the rest of API; this file
 * covers classification only.
 */

/*
 * The exact sentence the egress guard produced for the reported incident.
 * EgressGuard builds `${label} host ${bareHostname} could not be reached.`
 * for every failure branch once detail is suppressed, which is what the probe
 * asks for. Kept verbatim here so this file fails if that wording ever drifts
 * away from what the customer actually saw.
 */
const CUSTOMER_SANITIZED_MESSAGE: string =
  "Monitor target host order.abbeysbakehouse.com could not be reached.";

// A dotted quad anywhere in user-facing text would leak a resolved address.
const IPV4_PATTERN: RegExp = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;

/*
 * Builds an axios error that carries a real response, which is the only way to
 * reach the ServerResponse branch (it keys on axiosError.response).
 */
function createAxiosResponseError(status: number): AxiosError {
  const config: InternalAxiosRequestConfig = {
    headers: new AxiosHeaders(),
  } as InternalAxiosRequestConfig;

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

describe("API.getRequestFailedDetails - egress guard refusals", () => {
  /*
   * REGRESSION: the reported incident on https://order.abbeysbakehouse.com/.
   * The guard refused the target before any socket was opened and threw its
   * sanitized sentence. That sentence matched none of the string patterns
   * below it, so the incident root cause read
   *   Failed Phase: Unknown
   *   Error Description: Request failed: Monitor target host ... could not be reached.
   * which told the customer nothing. It must now be classified from the
   * exception TYPE instead.
   */
  test("classifies the customer's sanitized guard failure as Target Resolution, not Unknown", () => {
    const details: RequestFailedDetails = API.getRequestFailedDetails(
      new EgressGuardException(
        CUSTOMER_SANITIZED_MESSAGE,
        EgressFailureReason.Unreachable,
      ),
    );

    expect(details.failedPhase).toBe(RequestFailedPhase.TargetResolution);
    expect(details.failedPhase).not.toBe(RequestFailedPhase.Unknown);
    expect(details.errorCode).toBe("TARGET_UNREACHABLE");

    // The description has to actually say something.
    expect(details.errorDescription.length).toBeGreaterThan(0);

    /*
     * The old behaviour, asserted as gone: the default branch prefixed the
     * guard's own sentence with "Request failed: " and called that an
     * explanation.
     */
    expect(details.errorDescription.startsWith("Request failed:")).toBe(false);
    expect(details.errorDescription).not.toBe(
      `Request failed: ${CUSTOMER_SANITIZED_MESSAGE}`,
    );
    expect(details.errorDescription).not.toContain(CUSTOMER_SANITIZED_MESSAGE);

    // The raw sentence is still carried through untouched for debugging.
    expect(details.rawErrorMessage).toBe(CUSTOMER_SANITIZED_MESSAGE);
  });

  /*
   * THE ORACLE INVARIANT. On a shared cloud probe every tenant's hostnames are
   * resolved by the same resolver, so a tenant who could tell "did not resolve"
   * apart from "resolved to an address we refuse to dial" could enumerate
   * internal DNS names. The guard closes that by throwing one identical
   * message with reason Unreachable from both branches; this function must not
   * reopen it by deriving anything from the message or from anything else.
   */
  test("output for Unreachable is a function of the reason alone, not of the branch that threw", () => {
    // Same sentence the DNS branch throws...
    const fromDnsFailure: EgressGuardException = new EgressGuardException(
      CUSTOMER_SANITIZED_MESSAGE,
      EgressFailureReason.Unreachable,
    );

    // ...and the byte-identical sentence the address-policy branch throws.
    const fromAddressPolicy: EgressGuardException = new EgressGuardException(
      CUSTOMER_SANITIZED_MESSAGE,
      EgressFailureReason.Unreachable,
    );

    const dnsDetails: RequestFailedDetails =
      API.getRequestFailedDetails(fromDnsFailure);
    const policyDetails: RequestFailedDetails =
      API.getRequestFailedDetails(fromAddressPolicy);

    expect(dnsDetails).toEqual(policyDetails);

    /*
     * And the classification must not vary with the host either, so an
     * attacker cannot probe one hostname against another and diff the output.
     */
    const otherHostDetails: RequestFailedDetails = API.getRequestFailedDetails(
      new EgressGuardException(
        "Monitor target host internal-billing.corp could not be reached.",
        EgressFailureReason.Unreachable,
      ),
    );

    expect(otherHostDetails.failedPhase).toBe(dnsDetails.failedPhase);
    expect(otherHostDetails.errorCode).toBe(dnsDetails.errorCode);
    expect(otherHostDetails.errorDescription).toBe(dnsDetails.errorDescription);

    /*
     * The description is a fixed sentence, so it can neither name a resolved
     * address nor state that the host resolved into a private range. The
     * self-hosting hint deliberately spells the env var
     * PROBE_ALLOW_PRIVATE_NETWORK_MONITORS in caps, which is guidance and not
     * a statement about THIS host.
     */
    expect(IPV4_PATTERN.test(dnsDetails.errorDescription)).toBe(false);
    expect(dnsDetails.errorDescription).not.toContain("private network");
  });

  test("InvalidTarget is a configuration error and echoes the original message", () => {
    const message: string =
      "Monitor target URL scheme ftp:// is not supported. Only http and https are allowed.";

    const details: RequestFailedDetails = API.getRequestFailedDetails(
      new EgressGuardException(message, EgressFailureReason.InvalidTarget),
    );

    expect(details.failedPhase).toBe(RequestFailedPhase.TargetResolution);
    expect(details.errorCode).toBe("INVALID_TARGET");
    /*
     * Safe to echo: an unusable URL is the tenant's own configuration handed
     * back, it says nothing about the probe's network.
     */
    expect(details.errorDescription).toContain(message);
    expect(details.rawErrorMessage).toBe(message);
  });

  /*
   * The detail-allowed reasons, which only a self-hosted probe produces
   * (includeResolvedAddressInError = true). They are more specific internally
   * but still report the same user-facing phase and code - the specificity
   * lives in the raw message, which is preserved verbatim.
   */
  test.each([
    [
      EgressFailureReason.ResolutionFailed,
      "Monitor target host order.abbeysbakehouse.com could not be resolved: getaddrinfo EAI_AGAIN.",
    ],
    [
      EgressFailureReason.AddressBlocked,
      "Monitor target host intranet.local resolves to 10.0.0.4 which is a private network address.",
    ],
  ])(
    "reason %s maps to Target Resolution / TARGET_UNREACHABLE and preserves the raw message",
    (reason: EgressFailureReason, message: string) => {
      const details: RequestFailedDetails = API.getRequestFailedDetails(
        new EgressGuardException(message, reason),
      );

      expect(details.failedPhase).toBe(RequestFailedPhase.TargetResolution);
      expect(details.errorCode).toBe("TARGET_UNREACHABLE");
      expect(details.rawErrorMessage).toBe(message);
    },
  );

  test("keys on the exception type, not on the message text", () => {
    /*
     * A plain BadDataException carrying the very same sentence must still go
     * through the old string rules. If this ever returns TargetResolution the
     * new branch is matching text somewhere, which would misclassify unrelated
     * errors.
     */
    const details: RequestFailedDetails = API.getRequestFailedDetails(
      new BadDataException(CUSTOMER_SANITIZED_MESSAGE),
    );

    expect(details.failedPhase).toBe(RequestFailedPhase.Unknown);
    expect(details.errorDescription).toBe(
      `Request failed: ${CUSTOMER_SANITIZED_MESSAGE}`,
    );

    // And a BadDataException that DOES match a string rule is still matched.
    const dnsDetails: RequestFailedDetails = API.getRequestFailedDetails(
      new BadDataException("getaddrinfo ENOTFOUND example.com"),
    );

    expect(dnsDetails.failedPhase).toBe(RequestFailedPhase.DNSResolution);
    expect(dnsDetails.errorCode).toBe("ENOTFOUND");
  });
});

/*
 * The pre-existing classification behaviour, pinned so the new egress-guard
 * branch (which runs before all of it) cannot shadow anything.
 */
describe("API.getRequestFailedDetails - existing classification", () => {
  test.each([
    [
      "plain ENOTFOUND",
      new Error("getaddrinfo ENOTFOUND order.abbeysbakehouse.com"),
      RequestFailedPhase.DNSResolution,
      "ENOTFOUND",
    ],
    [
      "axios ENOTFOUND",
      new AxiosError("getaddrinfo ENOTFOUND example.com", "ENOTFOUND"),
      RequestFailedPhase.DNSResolution,
      "ENOTFOUND",
    ],
    [
      "ECONNREFUSED",
      new Error("connect ECONNREFUSED 127.0.0.1:443"),
      RequestFailedPhase.TCPConnection,
      "ECONNREFUSED",
    ],
    [
      "ECONNRESET",
      new Error("read ECONNRESET"),
      RequestFailedPhase.TCPConnection,
      "ECONNRESET",
    ],
    [
      "axios ETIMEDOUT",
      new AxiosError("connect ETIMEDOUT 93.184.216.34:443", "ETIMEDOUT"),
      RequestFailedPhase.RequestTimeout,
      "ETIMEDOUT",
    ],
    [
      "axios timeout message with no code",
      new Error("timeout of 5000ms exceeded"),
      RequestFailedPhase.RequestTimeout,
      "TIMEOUT",
    ],
    [
      "expired certificate",
      new Error("certificate has expired"),
      RequestFailedPhase.CertificateError,
      "CERT_HAS_EXPIRED",
    ],
    [
      "self-signed certificate",
      new Error("self-signed certificate in certificate chain"),
      RequestFailedPhase.CertificateError,
      "SELF_SIGNED_CERT",
    ],
  ])(
    "%s is classified as before",
    (
      _name: string,
      error: Error,
      expectedPhase: RequestFailedPhase,
      expectedErrorCode: string,
    ) => {
      const details: RequestFailedDetails = API.getRequestFailedDetails(error);

      expect(details.failedPhase).toBe(expectedPhase);
      expect(details.errorCode).toBe(expectedErrorCode);
      expect(details.rawErrorMessage).toBe(error.message);
    },
  );

  test.each([[500], [404], [403], [401], [400]])(
    "an HTTP %s response is classified as Server Response",
    (status: number) => {
      const details: RequestFailedDetails = API.getRequestFailedDetails(
        createAxiosResponseError(status),
      );

      expect(details.failedPhase).toBe(RequestFailedPhase.ServerResponse);
      expect(details.errorCode).toBe(`HTTP_${status}`);
      expect(details.errorDescription).toContain(
        `Server responded with HTTP status ${status}.`,
      );
    },
  );

  test("an unrecognised error still falls through to Unknown", () => {
    const details: RequestFailedDetails = API.getRequestFailedDetails(
      new Error("something odd"),
    );

    expect(details.failedPhase).toBe(RequestFailedPhase.Unknown);
    expect(details.errorCode).toBeUndefined();
    expect(details.errorDescription).toBe("Request failed: something odd");
    expect(details.rawErrorMessage).toBe("something odd");
  });
});

/*
 * A probe with no usable IPv6 fails every IPv6 URL before a packet leaves
 * it. The reported case was a Ping monitor for 2001:518:2800:9::2, which
 * answers every echo from a host that has IPv6; a Website or API monitor for
 * the same address fails the same way, with "connect EADDRNOTAVAIL".
 *
 * The error shapes below are the ones Node 26 and axios 1.20 actually
 * produce, captured in a container with IPv6 disabled on loopback (the
 * customer's probe: EADDRNOTAVAIL) and in one with no IPv6 route
 * (ENETUNREACH).
 */

const CUSTOMER_IPV6_ADDRESS: string = "2001:518:2800:9::2";
const CUSTOMER_IPV6_URL: string = `https://[${CUSTOMER_IPV6_ADDRESS}]/`;
const IPV4_ADDRESS: string = "93.184.215.14";

// EAFNOSUPPORT: only a probe with IPv6 switched off gets it.
const IPV6_NOT_SENT_DETAILS: string =
  "The probe cannot send IPv6 traffic, so the request was never sent and the server was never contacted. The failure is on the probe, not on the server.";
/*
 * EADDRNOTAVAIL: from a TCP connect it can also be the probe running out of
 * local ports, so it is not stated as missing IPv6.
 */
const IPV6_NO_SOURCE_ADDRESS_DETAILS: string =
  "The probe could not open the IPv6 connection from its own side, so the request was never sent and the server was never contacted. The failure is on the probe, not on the server.";
const IPV6_NO_ROUTE_DETAILS: string =
  "There was no IPv6 route to the server. Most likely the probe has no IPv6 route rather than the server being down.";
const NOT_SENT_DETAILS: string =
  "The probe could not open the connection from its own side, so the request was never sent and the server was never contacted. The failure is on the probe, not on the server.";
// The description ENETUNREACH has always had, kept for anything but IPv6.
const NETWORK_UNREACHABLE_DETAILS: string =
  "Network unreachable. There is no route to the network where the server resides. This is typically a routing or connectivity issue.";

const ERRNO_BY_CODE: Record<string, number> = {
  EADDRNOTAVAIL: -99,
  EAFNOSUPPORT: -97,
  ENETUNREACH: -101,
  EHOSTUNREACH: -113,
  ECONNREFUSED: -111,
  ETIMEDOUT: -110,
};

// The socket error net.connect rejects with, field for field.
function connectError(data: {
  code: string;
  address: string;
  port: number;
}): Error {
  const local: string = data.address.includes(":") ? ":::0" : "0.0.0.0:0";

  return Object.assign(
    new Error(
      `connect ${data.code} ${data.address}:${data.port} - Local (${local})`,
    ),
    {
      errno: ERRNO_BY_CODE[data.code],
      code: data.code,
      syscall: "connect",
      address: data.address,
      port: data.port,
    },
  );
}

/*
 * What Node rejects with when it tried several addresses of a dual-stack
 * name: an empty message, the first attempt's code, one error per attempt.
 */
function happyEyeballsError(attempts: Array<Error>): Error {
  return Object.assign(new Error(""), {
    name: "AggregateError",
    code: (attempts[0] as Error & { code: string }).code,
    errors: attempts,
  });
}

/*
 * What axios's HTTP adapter rejects with around a socket error. This is the
 * adapter's own call (AxiosError.from(err, null, config, req)), so the
 * wrapper is exactly what the Website monitor catches.
 */
function axiosConnectError(url: string, cause: Error): AxiosError {
  return AxiosError.from(
    cause,
    undefined,
    { url: url, headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
    {},
  );
}

/*
 * What the API monitor catches for the same failure: API.fetch hands the
 * AxiosError to getErrorResponse, which wraps it in an APIException.
 */
function apiMonitorError(axiosError: AxiosError): APIException {
  try {
    API["getErrorResponse"](axiosError);
  } catch (error) {
    return error as APIException;
  }

  throw new Error("getErrorResponse returned instead of throwing");
}

// What fetch() rejects with: the socket error is only on `cause`.
function fetchError(cause: Error): Error {
  return Object.assign(new TypeError("fetch failed"), { cause: cause });
}

function customerAxiosError(): AxiosError {
  return axiosConnectError(
    CUSTOMER_IPV6_URL,
    connectError({
      code: "EADDRNOTAVAIL",
      address: CUSTOMER_IPV6_ADDRESS,
      port: 443,
    }),
  );
}

describe("API.getRequestFailedDetails - failures on the probe itself", () => {
  /*
   * REGRESSION: EADDRNOTAVAIL matched no rule and fell through to the
   * "request was made but no response" branch, which told the customer
   * "The request was sent but no response was returned ... the server is
   * down, unreachable, or the request timed out". Nothing was sent.
   */
  test("the customer's IPv6 URL on a probe with no IPv6 is a probe failure, not a silent server", () => {
    const error: AxiosError = customerAxiosError();

    const details: RequestFailedDetails = API.getRequestFailedDetails(error);

    expect(details).toEqual({
      failedPhase: RequestFailedPhase.TCPConnection,
      errorCode: "EADDRNOTAVAIL",
      errorDescription: IPV6_NO_SOURCE_ADDRESS_DETAILS,
      rawErrorMessage: `connect EADDRNOTAVAIL ${CUSTOMER_IPV6_ADDRESS}:443 - Local (:::0)`,
    });

    // The old fall-through (phase Network Error), asserted as gone.
    expect(details.failedPhase).not.toBe(RequestFailedPhase.NetworkError);
    expect(details.errorDescription).not.toContain("No response received");
    expect(details.errorDescription).not.toContain("was sent");
  });

  test("the API monitor's APIException around the same error is classified the same way", () => {
    const error: APIException = apiMonitorError(customerAxiosError());

    // The wrapper, as the monitor sees it.
    expect(error).toBeInstanceOf(APIException);
    expect(error.message).toBe(
      `Request failed to ${CUSTOMER_IPV6_URL}. connect EADDRNOTAVAIL ${CUSTOMER_IPV6_ADDRESS}:443 - Local (:::0)`,
    );

    const details: RequestFailedDetails = API.getRequestFailedDetails(error);

    // Used to be phase Unknown, "Request failed: Request failed to ...".
    expect(details.failedPhase).toBe(RequestFailedPhase.TCPConnection);
    expect(details.errorCode).toBe("EADDRNOTAVAIL");
    expect(details.errorDescription).toBe(IPV6_NO_SOURCE_ADDRESS_DETAILS);
    expect(details.rawErrorMessage).toBe(error.message);
  });

  test("fetch's TypeError, whose only clue is its cause, is classified too", () => {
    const error: Error = fetchError(
      connectError({
        code: "EADDRNOTAVAIL",
        address: CUSTOMER_IPV6_ADDRESS,
        port: 443,
      }),
    );

    const details: RequestFailedDetails = API.getRequestFailedDetails(error);

    // Used to be phase Unknown, "Request failed: fetch failed".
    expect(details.failedPhase).toBe(RequestFailedPhase.TCPConnection);
    // TypeError has no code of its own; the one reported is the socket's.
    expect(details.errorCode).toBe("EADDRNOTAVAIL");
    expect(details.errorDescription).toBe(IPV6_NO_SOURCE_ADDRESS_DETAILS);
    expect(details.rawErrorMessage).toBe("fetch failed");
  });

  test("EAFNOSUPPORT (IPv6 switched off in the kernel) is a probe failure", () => {
    const details: RequestFailedDetails = API.getRequestFailedDetails(
      axiosConnectError(
        CUSTOMER_IPV6_URL,
        connectError({
          code: "EAFNOSUPPORT",
          address: CUSTOMER_IPV6_ADDRESS,
          port: 443,
        }),
      ),
    );

    expect(details.failedPhase).toBe(RequestFailedPhase.TCPConnection);
    expect(details.errorCode).toBe("EAFNOSUPPORT");
    expect(details.errorDescription).toBe(IPV6_NOT_SENT_DETAILS);
  });

  test("ENETUNREACH towards an IPv6 URL is hedged towards the probe having no IPv6 route", () => {
    const details: RequestFailedDetails = API.getRequestFailedDetails(
      axiosConnectError(
        CUSTOMER_IPV6_URL,
        connectError({
          code: "ENETUNREACH",
          address: CUSTOMER_IPV6_ADDRESS,
          port: 443,
        }),
      ),
    );

    expect(details.failedPhase).toBe(RequestFailedPhase.TCPConnection);
    expect(details.errorCode).toBe("ENETUNREACH");
    expect(details.errorDescription).toBe(IPV6_NO_ROUTE_DETAILS);
    // It used to put the missing route at the server's end.
    expect(details.errorDescription).not.toBe(NETWORK_UNREACHABLE_DETAILS);
  });

  test("ENETUNREACH towards an IPv4 URL keeps exactly the description it had", () => {
    const error: AxiosError = axiosConnectError(
      `http://${IPV4_ADDRESS}/`,
      connectError({ code: "ENETUNREACH", address: IPV4_ADDRESS, port: 80 }),
    );

    expect(API.getRequestFailedDetails(error)).toEqual({
      failedPhase: RequestFailedPhase.TCPConnection,
      errorCode: "ENETUNREACH",
      errorDescription: NETWORK_UNREACHABLE_DETAILS,
      rawErrorMessage: `connect ENETUNREACH ${IPV4_ADDRESS}:80 - Local (0.0.0.0:0)`,
    });
  });

  test("ENETUNREACH seen only on fetch's cause gets that same family-neutral description", () => {
    const details: RequestFailedDetails = API.getRequestFailedDetails(
      fetchError(
        connectError({ code: "ENETUNREACH", address: IPV4_ADDRESS, port: 80 }),
      ),
    );

    expect(details.failedPhase).toBe(RequestFailedPhase.TCPConnection);
    expect(details.errorCode).toBe("ENETUNREACH");
    expect(details.errorDescription).toBe(NETWORK_UNREACHABLE_DETAILS);
  });

  test("EADDRNOTAVAIL towards IPv4 is still the probe's, and says nothing about IPv6", () => {
    const details: RequestFailedDetails = API.getRequestFailedDetails(
      axiosConnectError(
        `http://${IPV4_ADDRESS}/`,
        connectError({
          code: "EADDRNOTAVAIL",
          address: IPV4_ADDRESS,
          port: 80,
        }),
      ),
    );

    expect(details.failedPhase).toBe(RequestFailedPhase.TCPConnection);
    expect(details.errorCode).toBe("EADDRNOTAVAIL");
    expect(details.errorDescription).toBe(NOT_SENT_DETAILS);
    expect(details.errorDescription).not.toContain("IPv6");
  });

  test("a DNS name that only has an IPv6 address is worded as IPv6, from the address the probe dialled", () => {
    const details: RequestFailedDetails = API.getRequestFailedDetails(
      axiosConnectError(
        "https://ipv6only.example.com/",
        connectError({
          code: "ENETUNREACH",
          address: CUSTOMER_IPV6_ADDRESS,
          port: 443,
        }),
      ),
    );

    expect(details.errorDescription).toBe(IPV6_NO_ROUTE_DETAILS);
  });

  test("a dual-stack name whose IPv4 attempt also had no route is not called an IPv6 problem", () => {
    // Captured on a probe with no network at all: both families fail.
    const details: RequestFailedDetails = API.getRequestFailedDetails(
      axiosConnectError(
        "https://dualstack.example.com/",
        happyEyeballsError([
          connectError({
            code: "EADDRNOTAVAIL",
            address: CUSTOMER_IPV6_ADDRESS,
            port: 443,
          }),
          connectError({
            code: "ENETUNREACH",
            address: IPV4_ADDRESS,
            port: 443,
          }),
        ]),
      ),
    );

    expect(details.failedPhase).toBe(RequestFailedPhase.TCPConnection);
    // The attempt the description is about, not the first one Node copied.
    expect(details.errorCode).toBe("ENETUNREACH");
    expect(details.errorDescription).toBe(NETWORK_UNREACHABLE_DETAILS);
  });

  test("a dual-stack name whose IPv4 attempt was refused is the host's answer, not a probe failure", () => {
    const error: AxiosError = axiosConnectError(
      "https://dualstack.example.com/",
      happyEyeballsError([
        connectError({
          code: "EADDRNOTAVAIL",
          address: CUSTOMER_IPV6_ADDRESS,
          port: 443,
        }),
        connectError({
          code: "ECONNREFUSED",
          address: IPV4_ADDRESS,
          port: 443,
        }),
      ]),
    );

    const details: RequestFailedDetails = API.getRequestFailedDetails(error);

    // What it was before: the refused IPv4 attempt decides.
    expect(details.failedPhase).toBe(RequestFailedPhase.TCPConnection);
    expect(details.errorDescription.startsWith("Connection refused.")).toBe(
      true,
    );
  });

  test("with no address on the error, an IPv6 literal URL is what makes it IPv6", () => {
    const error: AxiosError = new AxiosError(
      "connect EADDRNOTAVAIL",
      "EADDRNOTAVAIL",
      {
        url: CUSTOMER_IPV6_URL,
        headers: new AxiosHeaders(),
      } as InternalAxiosRequestConfig,
      {},
    );

    expect(API.getRequestFailedDetails(error).errorDescription).toBe(
      IPV6_NO_SOURCE_ADDRESS_DETAILS,
    );
  });

  test("the address the probe dialled beats the URL: an IPv4 proxy it could not reach is not an IPv6 problem", () => {
    const details: RequestFailedDetails = API.getRequestFailedDetails(
      axiosConnectError(
        CUSTOMER_IPV6_URL,
        connectError({
          code: "EADDRNOTAVAIL",
          address: "192.0.2.10",
          port: 3128,
        }),
      ),
    );

    expect(details.errorDescription).toBe(NOT_SENT_DETAILS);
  });

  /*
   * Refused, reset, timed out and "host unreachable" say something real
   * about the destination or the path to it, IPv6 or not. They must keep
   * their old classification.
   */
  test.each([
    ["ECONNREFUSED", RequestFailedPhase.TCPConnection, "Connection refused."],
    ["ETIMEDOUT", RequestFailedPhase.RequestTimeout, "Request timed out."],
    ["EHOSTUNREACH", RequestFailedPhase.TCPConnection, "Host unreachable."],
  ])(
    "%s from an IPv6 URL is classified as before",
    (
      code: string,
      expectedPhase: RequestFailedPhase,
      expectedStart: string,
    ) => {
      const details: RequestFailedDetails = API.getRequestFailedDetails(
        axiosConnectError(
          CUSTOMER_IPV6_URL,
          connectError({
            code: code,
            address: CUSTOMER_IPV6_ADDRESS,
            port: 443,
          }),
        ),
      );

      expect(details.failedPhase).toBe(expectedPhase);
      expect(details.errorCode).toBe(code);
      expect(details.errorDescription.startsWith(expectedStart)).toBe(true);
    },
  );
});

describe("API.getProbeNetworkFailureDescription", () => {
  test("gives the customer's IPv6 failure the shared probe-side wording, naming the host", () => {
    expect(API.getProbeNetworkFailureDescription(customerAxiosError())).toBe(
      `This probe could not open an IPv6 connection from its own side (connect EADDRNOTAVAIL ${CUSTOMER_IPV6_ADDRESS}:443 - Local (:::0)), so ${CUSTOMER_IPV6_ADDRESS} was never contacted. This usually means the probe has no usable IPv6 address or route (less often, that it has run out of local ports); this says nothing about whether ${CUSTOMER_IPV6_ADDRESS} is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.`,
    );
  });

  test("reads through the API monitor's APIException", () => {
    expect(
      API.getProbeNetworkFailureDescription(
        apiMonitorError(customerAxiosError()),
      ),
    ).toBe(API.getProbeNetworkFailureDescription(customerAxiosError()));
  });

  test("names the DNS name the monitor uses, not the address it resolved to", () => {
    const description: string | null = API.getProbeNetworkFailureDescription(
      axiosConnectError(
        "https://ipv6only.example.com/health",
        connectError({
          code: "EADDRNOTAVAIL",
          address: CUSTOMER_IPV6_ADDRESS,
          port: 443,
        }),
      ),
    );

    expect(description).toContain(
      "so ipv6only.example.com was never contacted",
    );
    expect(description).toContain(
      "This probe could not open an IPv6 connection from its own side",
    );
  });

  test("hedges ENETUNREACH towards IPv6", () => {
    expect(
      API.getProbeNetworkFailureDescription(
        axiosConnectError(
          CUSTOMER_IPV6_URL,
          connectError({
            code: "ENETUNREACH",
            address: CUSTOMER_IPV6_ADDRESS,
            port: 443,
          }),
        ),
      ),
    ).toBe(
      `This probe could not reach ${CUSTOMER_IPV6_ADDRESS} over IPv6 (connect ENETUNREACH ${CUSTOMER_IPV6_ADDRESS}:443 - Local (:::0)). Most likely this probe has no IPv6 route rather than ${CUSTOMER_IPV6_ADDRESS} being down. Monitor IPv6 destinations from a probe that has IPv6 connectivity.`,
    );
  });

  test("calls the target 'the server' when the error has no request URL", () => {
    expect(
      API.getProbeNetworkFailureDescription(
        fetchError(
          connectError({
            code: "EADDRNOTAVAIL",
            address: CUSTOMER_IPV6_ADDRESS,
            port: 443,
          }),
        ),
      ),
    ).toBe(
      `This probe could not open an IPv6 connection from its own side (connect EADDRNOTAVAIL ${CUSTOMER_IPV6_ADDRESS}:443 - Local (:::0)), so the server was never contacted. This usually means the probe has no usable IPv6 address or route (less often, that it has run out of local ports); this says nothing about whether the server is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.`,
    );
  });

  test("words EADDRNOTAVAIL towards IPv4 without any IPv6 claim", () => {
    expect(
      API.getProbeNetworkFailureDescription(
        axiosConnectError(
          `http://${IPV4_ADDRESS}/`,
          connectError({
            code: "EADDRNOTAVAIL",
            address: IPV4_ADDRESS,
            port: 80,
          }),
        ),
      ),
    ).toBe(
      `This probe could not send traffic to ${IPV4_ADDRESS} (connect EADDRNOTAVAIL ${IPV4_ADDRESS}:80 - Local (0.0.0.0:0)), so ${IPV4_ADDRESS} was never contacted. The failure is on the probe, not on ${IPV4_ADDRESS}.`,
    );
  });

  test("a dual-stack name where both attempts could not leave the probe gets no IPv6 claim", () => {
    const description: string | null = API.getProbeNetworkFailureDescription(
      axiosConnectError(
        "https://dualstack.example.com/",
        happyEyeballsError([
          connectError({
            code: "EADDRNOTAVAIL",
            address: CUSTOMER_IPV6_ADDRESS,
            port: 443,
          }),
          connectError({
            code: "EADDRNOTAVAIL",
            address: IPV4_ADDRESS,
            port: 443,
          }),
        ]),
      ),
    );

    expect(description).toContain(
      "This probe could not send traffic to dualstack.example.com",
    );
    expect(description).not.toContain("IPv6");
  });

  test.each([
    [
      "ENETUNREACH towards IPv4 (a router may have sent it)",
      axiosConnectError(
        `http://${IPV4_ADDRESS}/`,
        connectError({ code: "ENETUNREACH", address: IPV4_ADDRESS, port: 80 }),
      ),
    ],
    [
      "both families unreachable (Node tried IPv6 first)",
      axiosConnectError(
        "https://dualstack.example.com/",
        happyEyeballsError([
          connectError({
            code: "ENETUNREACH",
            address: CUSTOMER_IPV6_ADDRESS,
            port: 443,
          }),
          connectError({
            code: "ENETUNREACH",
            address: IPV4_ADDRESS,
            port: 443,
          }),
        ]),
      ),
    ],
    [
      "ECONNREFUSED from an IPv6 host",
      axiosConnectError(
        CUSTOMER_IPV6_URL,
        connectError({
          code: "ECONNREFUSED",
          address: CUSTOMER_IPV6_ADDRESS,
          port: 443,
        }),
      ),
    ],
    [
      "EHOSTUNREACH from an IPv6 host",
      axiosConnectError(
        CUSTOMER_IPV6_URL,
        connectError({
          code: "EHOSTUNREACH",
          address: CUSTOMER_IPV6_ADDRESS,
          port: 443,
        }),
      ),
    ],
    [
      "an axios timeout",
      new AxiosError("timeout of 5000ms exceeded", "ECONNABORTED"),
    ],
    ["an HTTP 500 response", createAxiosResponseError(500)],
    [
      "an egress guard refusal",
      new EgressGuardException(
        CUSTOMER_SANITIZED_MESSAGE,
        EgressFailureReason.Unreachable,
      ),
    ],
    ["a plain error", new Error("something odd")],
    ["a thrown string", "EADDRNOTAVAIL"],
  ])(
    "is null for %s, so the monitor keeps the message it had",
    (_name: string, error: unknown) => {
      expect(API.getProbeNetworkFailureDescription(error)).toBeNull();
    },
  );
});

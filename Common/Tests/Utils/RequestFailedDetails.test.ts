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

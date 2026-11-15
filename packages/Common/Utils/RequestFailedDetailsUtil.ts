import axios, { AxiosError } from "axios";
import APIException from "../Types/Exception/ApiException";
import EgressGuardException, {
  EgressFailureReason,
} from "../Types/Exception/EgressGuardException";
import RequestFailedDetails, {
  RequestFailedPhase,
} from "../Types/Probe/RequestFailedDetails";
import API from "./API";
import HostAddressUtil from "./HostAddressUtil";
import {
  RequestFailureDescription,
  writeRequestFailureDescription,
} from "./Monitor/RequestFailureDescriptions";
import ProbeNetworkFailureUtil, {
  ProbeNetworkFailure,
  ProbeNetworkFailureKind,
  ProbeNetworkOperation,
} from "./ProbeNetworkFailureUtil";

/*
 * WHY A MONITOR'S REQUEST FAILED, AS ITS ERROR DETAILS SAY IT: the phase it
 * failed in, its code and its explanation (RequestFailureDescriptions), for
 * the Website and API monitors' requests, which only a probe makes.
 *
 * It was part of API, which every page of every frontend loads to talk to
 * the server: every sign-in page, status page and public dashboard carried
 * the probe's failure classification (ProbeNetworkFailureUtil) and every
 * explanation's wording, which no page ever writes
 * (packages/Common/Scripts/first-load-budgets.js). A page that draws a
 * request's explanation reads it from the record the probe wrote.
 */

/*
 * A request that failed on the probe itself, before anything reached the
 * target. See RequestFailedDetailsUtil.getProbeSideRequestFailure.
 */
interface ProbeSideRequestFailure {
  failure: ProbeNetworkFailure;
  // The request's host, bare, or a stand-in when the error does not carry it.
  host: string;
  isIPv6Destination: boolean;
}

// What a probe-side failure calls the target when the error has no request URL.
const UNKNOWN_REQUEST_HOST: string = "the server";

// How far down an error's `cause` / `errors` the connect addresses are read.
const MAX_CONNECT_ADDRESS_DEPTH: number = 5;

/*
 * The code a probe-side failure is reported under. Taken from the
 * classification rather than the thrown error because fetch's TypeError and
 * the API monitor's APIException have no usable code of their own, and an
 * aggregate carries only its first attempt's. NoRouteToHost never comes out
 * of a TCP connect; it is listed so the map stays total.
 */
const PROBE_NETWORK_FAILURE_ERROR_CODES: Record<
  ProbeNetworkFailureKind,
  string
> = {
  [ProbeNetworkFailureKind.NoSourceAddress]: "EADDRNOTAVAIL",
  [ProbeNetworkFailureKind.AddressFamilyNotSupported]: "EAFNOSUPPORT",
  [ProbeNetworkFailureKind.NetworkUnreachable]: "ENETUNREACH",
  [ProbeNetworkFailureKind.NoRouteToHost]: "EHOSTUNREACH",
};

export default class RequestFailedDetailsUtil {
  /**
   * Extracts detailed error information from an axios error or generic error.
   * This provides more context about where and why a request failed.
   */
  public static getRequestFailedDetails(
    error: AxiosError | Error | unknown,
  ): RequestFailedDetails {
    const axiosError: AxiosError | null = axios.isAxiosError(error)
      ? (error as AxiosError)
      : null;
    const nativeErrorCode: unknown =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    const errorCode: string | undefined =
      typeof nativeErrorCode === "string" ? nativeErrorCode : undefined;
    const rawErrorMessage: string =
      (error as Error)?.message || String(error) || "Unknown error";

    /*
     * The egress guard refuses a target BEFORE any socket is opened, and for
     * tenant-facing callers it sanitizes its message down to one sentence that
     * matches none of the patterns below. Left to the fall-through, every such
     * failure was reported as phase "Unknown" with the sanitized sentence
     * echoed back as its own explanation — which is exactly what a monitor
     * incident showed for a host whose DNS had hiccuped. Classify it here
     * instead, from the exception TYPE rather than from its text.
     */
    if (error instanceof EgressGuardException) {
      return {
        failedPhase: RequestFailedPhase.TargetResolution,
        errorCode:
          error.reason === EgressFailureReason.InvalidTarget
            ? "INVALID_TARGET"
            : "TARGET_UNREACHABLE",
        /*
         * One constant description for every unreachable reason. It names all
         * the possibilities without saying which occurred, so it stays useful
         * without telling a tenant on a shared probe whether a hostname
         * resolved — that difference is the enumeration oracle the guard's
         * sanitized message exists to close.
         */
        errorDescription:
          error.reason === EgressFailureReason.InvalidTarget
            ? writeRequestFailureDescription(
                RequestFailureDescription.InvalidTarget,
                { message: rawErrorMessage },
              )
            : writeRequestFailureDescription(
                RequestFailureDescription.TargetUnreachable,
              ),
        rawErrorMessage,
      };
    }

    /*
     * The connect failed on the probe, before the request left it. Checked
     * ahead of the string rules below because none of them describe it:
     * EADDRNOTAVAIL matched nothing and fell through to "The request was sent
     * but no response was returned", when nothing was sent at all, and a
     * probe with no IPv6 was told there was no route to the network where the
     * server resides. Still the TCP connection phase, since connect() is what
     * failed. The failure cause the monitor reports alongside this already
     * quotes the OS error (getProbeNetworkFailureDescription), so this only
     * says what it means for the request.
     */
    const probeSideFailure: ProbeSideRequestFailure | null =
      RequestFailedDetailsUtil.getProbeSideRequestFailure(error);

    if (probeSideFailure) {
      return {
        failedPhase: RequestFailedPhase.TCPConnection,
        errorCode:
          PROBE_NETWORK_FAILURE_ERROR_CODES[probeSideFailure.failure.kind],
        errorDescription: writeRequestFailureDescription(
          RequestFailedDetailsUtil.getProbeSideFailureDescription(
            probeSideFailure,
          ),
        ),
        rawErrorMessage,
      };
    }

    // Helper to determine the phase and description based on error code/message
    const lowerMessage: string = rawErrorMessage.toLowerCase();

    // DNS resolution failures
    if (errorCode === "ENOTFOUND" || lowerMessage.includes("enotfound")) {
      return {
        failedPhase: RequestFailedPhase.DNSResolution,
        errorCode: errorCode || "ENOTFOUND",
        errorDescription: writeRequestFailureDescription(
          RequestFailureDescription.DnsResolutionFailed,
        ),
        rawErrorMessage,
      };
    }

    // Connection refused
    if (errorCode === "ECONNREFUSED" || lowerMessage.includes("econnrefused")) {
      return {
        failedPhase: RequestFailedPhase.TCPConnection,
        errorCode: errorCode || "ECONNREFUSED",
        errorDescription: writeRequestFailureDescription(
          RequestFailureDescription.ConnectionRefused,
        ),
        rawErrorMessage,
      };
    }

    // Connection reset
    if (
      errorCode === "ECONNRESET" ||
      lowerMessage.includes("econnreset") ||
      lowerMessage.includes("connection reset")
    ) {
      return {
        failedPhase: RequestFailedPhase.TCPConnection,
        errorCode: errorCode || "ECONNRESET",
        errorDescription: writeRequestFailureDescription(
          RequestFailureDescription.ConnectionReset,
        ),
        rawErrorMessage,
      };
    }

    // Connection aborted
    if (
      errorCode === "ECONNABORTED" ||
      lowerMessage.includes("econnaborted") ||
      lowerMessage.includes("connection aborted")
    ) {
      return {
        failedPhase: RequestFailedPhase.RequestAborted,
        errorCode: errorCode || "ECONNABORTED",
        errorDescription: writeRequestFailureDescription(
          RequestFailureDescription.ConnectionAborted,
        ),
        rawErrorMessage,
      };
    }

    // Timeout errors
    if (
      errorCode === "ETIMEDOUT" ||
      errorCode === "ESOCKETTIMEDOUT" ||
      lowerMessage.includes("timeout") ||
      lowerMessage.includes("exceeded")
    ) {
      return {
        failedPhase: RequestFailedPhase.RequestTimeout,
        errorCode: errorCode || "TIMEOUT",
        errorDescription: writeRequestFailureDescription(
          RequestFailureDescription.RequestTimedOut,
        ),
        rawErrorMessage,
      };
    }

    // SSL/TLS Certificate errors
    if (
      errorCode === "CERT_REVOKED" ||
      lowerMessage.includes("certificate has been revoked") ||
      lowerMessage.includes("cert_revoked")
    ) {
      return {
        failedPhase: RequestFailedPhase.CertificateError,
        errorCode: "CERT_REVOKED",
        errorDescription: writeRequestFailureDescription(
          RequestFailureDescription.CertificateRevoked,
        ),
        rawErrorMessage,
      };
    }

    if (
      lowerMessage.includes("certificate has expired") ||
      lowerMessage.includes("cert_has_expired")
    ) {
      return {
        failedPhase: RequestFailedPhase.CertificateError,
        errorCode: "CERT_HAS_EXPIRED",
        errorDescription: writeRequestFailureDescription(
          RequestFailureDescription.CertificateExpired,
        ),
        rawErrorMessage,
      };
    }

    if (
      lowerMessage.includes("self-signed certificate") ||
      lowerMessage.includes("self signed certificate") ||
      lowerMessage.includes("depth_zero_self_signed_cert")
    ) {
      return {
        failedPhase: RequestFailedPhase.CertificateError,
        errorCode: "SELF_SIGNED_CERT",
        errorDescription: writeRequestFailureDescription(
          RequestFailureDescription.SelfSignedCertificate,
        ),
        rawErrorMessage,
      };
    }

    if (
      lowerMessage.includes("certificate signed by unknown authority") ||
      lowerMessage.includes("unable_to_verify_leaf_signature") ||
      lowerMessage.includes("unable to verify")
    ) {
      return {
        failedPhase: RequestFailedPhase.CertificateError,
        errorCode: "CERT_UNKNOWN_AUTHORITY",
        errorDescription: writeRequestFailureDescription(
          RequestFailureDescription.CertificateUnknownAuthority,
        ),
        rawErrorMessage,
      };
    }

    if (
      lowerMessage.includes("ssl") ||
      lowerMessage.includes("tls") ||
      lowerMessage.includes("certificate") ||
      lowerMessage.includes("handshake")
    ) {
      return {
        failedPhase: RequestFailedPhase.TLSHandshake,
        errorCode: errorCode || "TLS_ERROR",
        errorDescription: writeRequestFailureDescription(
          RequestFailureDescription.TlsHandshakeFailed,
        ),
        rawErrorMessage,
      };
    }

    // Network errors
    if (lowerMessage.includes("network error") || errorCode === "ERR_NETWORK") {
      return {
        failedPhase: RequestFailedPhase.NetworkError,
        errorCode: errorCode || "NETWORK_ERROR",
        errorDescription: writeRequestFailureDescription(
          RequestFailureDescription.NetworkError,
        ),
        rawErrorMessage,
      };
    }

    // Host unreachable
    if (
      errorCode === "EHOSTUNREACH" ||
      lowerMessage.includes("host unreachable")
    ) {
      return {
        failedPhase: RequestFailedPhase.TCPConnection,
        errorCode: errorCode || "EHOSTUNREACH",
        errorDescription: writeRequestFailureDescription(
          RequestFailureDescription.HostUnreachable,
        ),
        rawErrorMessage,
      };
    }

    // Network unreachable
    if (
      errorCode === "ENETUNREACH" ||
      lowerMessage.includes("network unreachable")
    ) {
      return {
        failedPhase: RequestFailedPhase.TCPConnection,
        errorCode: errorCode || "ENETUNREACH",
        errorDescription: writeRequestFailureDescription(
          RequestFailureDescription.NetworkUnreachable,
        ),
        rawErrorMessage,
      };
    }

    // Server responded with error status
    if (axiosError?.response) {
      const status: number = axiosError.response.status;

      return {
        failedPhase: RequestFailedPhase.ServerResponse,
        errorCode: `HTTP_${status}`,
        errorDescription: writeRequestFailureDescription(
          RequestFailedDetailsUtil.getHttpStatusDescription(status),
          { status: status },
        ),
        rawErrorMessage,
      };
    }

    // Request was made but no response received
    if (axiosError?.request && !axiosError?.response) {
      return {
        failedPhase: RequestFailedPhase.NetworkError,
        errorCode: errorCode || "NO_RESPONSE",
        errorDescription: writeRequestFailureDescription(
          RequestFailureDescription.NoResponse,
        ),
        rawErrorMessage,
      };
    }

    // Default/Unknown error
    return {
      failedPhase: RequestFailedPhase.Unknown,
      errorCode: errorCode,
      errorDescription: writeRequestFailureDescription(
        RequestFailureDescription.RequestFailed,
        {
          message: API.getFriendlyErrorMessage(error as Error),
        },
      ),
      rawErrorMessage,
    };
  }

  /*
   * The failure cause for a monitor request that failed on the probe itself,
   * in the shared probe-side wording (which quotes the OS error), or null for
   * any other failure. A probe with no usable IPv6 fails every IPv6 URL with
   * a bare "connect EADDRNOTAVAIL ...", which reads as the customer's site
   * being down while it may be answering perfectly well.
   *
   * ENETUNREACH from a TCP connect can also be a router's "no route" to the
   * destination, so it is only reworded for an IPv6 destination, where the
   * shared wording says "most likely". Otherwise it keeps its message.
   *
   * Separate from getFriendlyErrorMessage on purpose: that one is also used
   * by the dashboard and by the server's own outbound requests, where "this
   * probe" would be false. Only the Website and API monitors call this.
   */
  public static getProbeNetworkFailureDescription(
    error: unknown,
  ): string | null {
    const probeSideFailure: ProbeSideRequestFailure | null =
      RequestFailedDetailsUtil.getProbeSideRequestFailure(error);

    if (
      !probeSideFailure ||
      (!probeSideFailure.failure.isCertain &&
        !probeSideFailure.isIPv6Destination)
    ) {
      return null;
    }

    return ProbeNetworkFailureUtil.describe({
      host: probeSideFailure.host,
      failure: probeSideFailure.failure,
      isIPv6Destination: probeSideFailure.isIPv6Destination,
    });
  }

  /*
   * Classifies a request error as a connect that failed on the probe, with
   * the host to name and whether to word it as IPv6.
   *
   * IPv6 wording needs evidence. It is used when every address the probe
   * tried to connect to was IPv6 or, when the error names no address, when
   * the request URL's host is an IPv6 literal. A dual-stack name whose IPv4
   * attempt failed as well is not an IPv6 problem, and neither is an IPv4
   * proxy the probe could not reach on the way to an IPv6 target.
   */
  private static getProbeSideRequestFailure(
    error: unknown,
  ): ProbeSideRequestFailure | null {
    // The guard refuses before any socket exists; its message is its own.
    if (error instanceof EgressGuardException) {
      return null;
    }

    /*
     * The API monitor gets the AxiosError wrapped in an APIException (see
     * getErrorResponse). The wrapper's own code is an ExceptionCode number
     * and its message carries the errno but not the OS text, so the
     * classifier would find nothing on it.
     */
    const requestError: unknown =
      error instanceof APIException && error.error ? error.error : error;

    const failure: ProbeNetworkFailure | null =
      ProbeNetworkFailureUtil.classifyError({
        error: requestError,
        operation: ProbeNetworkOperation.TcpConnect,
      });

    if (!failure) {
      return null;
    }

    const requestHost: string | null =
      RequestFailedDetailsUtil.getRequestHost(requestError);
    const connectAddresses: Array<string> = [];
    RequestFailedDetailsUtil.collectConnectAddresses(
      requestError,
      0,
      connectAddresses,
    );

    const isIPv6Destination: boolean =
      connectAddresses.length > 0
        ? connectAddresses.every((address: string) => {
            return HostAddressUtil.isIPv6(address);
          })
        : Boolean(requestHost && HostAddressUtil.isIPv6(requestHost));

    return {
      failure: failure,
      host: requestHost || UNKNOWN_REQUEST_HOST,
      isIPv6Destination: isIPv6Destination,
    };
  }

  /*
   * The "Error Details" explanation of a probe-side failure. ENETUNREACH
   * that is not towards IPv6 keeps the family-neutral description it
   * always had.
   */
  private static getProbeSideFailureDescription(
    probeSideFailure: ProbeSideRequestFailure,
  ): RequestFailureDescription {
    const failure: ProbeNetworkFailure = probeSideFailure.failure;

    if (!probeSideFailure.isIPv6Destination) {
      return failure.isCertain
        ? RequestFailureDescription.ProbeCouldNotConnect
        : RequestFailureDescription.NetworkUnreachable;
    }

    /*
     * EADDRNOTAVAIL from a TCP connect is also what a probe that has run
     * out of local ports gets, IPv6 or not, so it is not stated as missing
     * IPv6.
     */
    if (failure.isCertain && failure.isCauseAmbiguous) {
      return RequestFailureDescription.ProbeCouldNotConnectOverIPv6;
    }

    if (failure.isCertain) {
      return RequestFailureDescription.ProbeCannotSendIPv6;
    }

    return RequestFailureDescription.NoIPv6Route;
  }

  /*
   * What a server's HTTP status means, as the request's explanation says
   * it after "Server responded with HTTP status 503.".
   */
  private static getHttpStatusDescription(
    status: number,
  ): RequestFailureDescription {
    if (status >= 500) {
      return RequestFailureDescription.HttpServerError;
    }

    if (status === 404) {
      return RequestFailureDescription.HttpNotFound;
    }

    if (status === 403) {
      return RequestFailureDescription.HttpForbidden;
    }

    if (status === 401) {
      return RequestFailureDescription.HttpUnauthorized;
    }

    if (status === 400) {
      return RequestFailureDescription.HttpBadRequest;
    }

    if (status >= 400) {
      return RequestFailureDescription.HttpClientError;
    }

    return RequestFailureDescription.HttpStatus;
  }

  /*
   * The host of the URL an axios request was sent to, without IPv6
   * brackets, or null when the error is not an axios one or has no usable
   * URL. It is the hop that failed, which after a redirect is not
   * necessarily the monitor's own URL.
   */
  private static getRequestHost(error: unknown): string | null {
    if (!axios.isAxiosError(error) || !error.config?.url) {
      return null;
    }

    try {
      const requestUrl: globalThis.URL = new globalThis.URL(
        error.config.url,
        error.config.baseURL || undefined,
      );

      return HostAddressUtil.stripBrackets(requestUrl.hostname) || null;
    } catch {
      return null;
    }
  }

  /*
   * Every `address` a socket error in the chain names: the error's own, its
   * cause's (axios and fetch keep the socket error there) and each attempt
   * of an aggregate (Node's happy-eyeballs connect, one error per address).
   */
  private static collectConnectAddresses(
    value: unknown,
    depth: number,
    addresses: Array<string>,
  ): void {
    if (
      !value ||
      typeof value !== "object" ||
      depth > MAX_CONNECT_ADDRESS_DEPTH
    ) {
      return;
    }

    const errorLike: { address?: unknown; errors?: unknown; cause?: unknown } =
      value as { address?: unknown; errors?: unknown; cause?: unknown };

    if (typeof errorLike.address === "string" && errorLike.address) {
      addresses.push(HostAddressUtil.stripBrackets(errorLike.address));
    }

    if (Array.isArray(errorLike.errors)) {
      for (const attempt of errorLike.errors) {
        RequestFailedDetailsUtil.collectConnectAddresses(
          attempt,
          depth + 1,
          addresses,
        );
      }
    }

    RequestFailedDetailsUtil.collectConnectAddresses(
      errorLike.cause,
      depth + 1,
      addresses,
    );
  }
}

import {
  SentenceOptions,
  translationKey,
  Translator,
} from "../../Types/Translator";

/*
 * WHAT A FAILED REQUEST MEANS, IN THE READER'S LANGUAGE (#8001).
 *
 * When a probe's request fails it stores, beside the phase and the error
 * code, a fixed English explanation of OneUptime's own: "DNS resolution
 * failed. The hostname could not be resolved to an IP address. ...",
 * "Connection refused. ...", "SSL certificate has expired. ...". A
 * Website or API summary draws it as Error Details, and the incident's
 * root cause after "- Error Description:".
 *
 * The probe keeps storing the same English - a root cause, a log line or
 * an "Error contains" criterion may compare it - so every explanation is
 * written from this one table, word for word as it was written before
 * (writeRequestFailureDescription), by RequestFailedDetailsUtil.getRequestFailedDetails (the
 * Website and API checks) and by the Port and NTP checks. The summaries
 * and the root cause read it back here, only on an exact match against
 * the table (readRequestFailureDescription), and draw it in the reader's
 * language (getRequestFailureDescriptionText). Anything else - a message a
 * newer probe writes, the explanation inside a longer text - stays as
 * written.
 *
 * Three explanations carry a value: the HTTP status a server answered
 * with ({{status}}, three digits), and the message a refused target or
 * an unknown failure came with ({{message}}, the runtime's or a library's
 * own words), which is kept as written and, on a page, set apart from the
 * reader's words (setsValuesApart).
 *
 * The English are translation keys: the Dashboard's npm run i18n:extract
 * reads this directory.
 */

export enum RequestFailureDescription {
  // RequestFailedDetailsUtil.getRequestFailedDetails: the Website and API checks' request.
  InvalidTarget = "InvalidTarget",
  TargetUnreachable = "TargetUnreachable",
  ProbeCouldNotConnect = "ProbeCouldNotConnect",
  ProbeCouldNotConnectOverIPv6 = "ProbeCouldNotConnectOverIPv6",
  ProbeCannotSendIPv6 = "ProbeCannotSendIPv6",
  NoIPv6Route = "NoIPv6Route",
  NetworkUnreachable = "NetworkUnreachable",
  DnsResolutionFailed = "DnsResolutionFailed",
  ConnectionRefused = "ConnectionRefused",
  ConnectionReset = "ConnectionReset",
  ConnectionAborted = "ConnectionAborted",
  RequestTimedOut = "RequestTimedOut",
  CertificateRevoked = "CertificateRevoked",
  CertificateExpired = "CertificateExpired",
  SelfSignedCertificate = "SelfSignedCertificate",
  CertificateUnknownAuthority = "CertificateUnknownAuthority",
  TlsHandshakeFailed = "TlsHandshakeFailed",
  NetworkError = "NetworkError",
  HostUnreachable = "HostUnreachable",
  HttpStatus = "HttpStatus",
  HttpServerError = "HttpServerError",
  HttpNotFound = "HttpNotFound",
  HttpForbidden = "HttpForbidden",
  HttpUnauthorized = "HttpUnauthorized",
  HttpBadRequest = "HttpBadRequest",
  HttpClientError = "HttpClientError",
  NoResponse = "NoResponse",
  RequestFailed = "RequestFailed",

  // The Port check's TCP connection.
  PortProbeCouldNotConnect = "PortProbeCouldNotConnect",
  PortProbeCouldNotConnectOverIPv6 = "PortProbeCouldNotConnectOverIPv6",
  PortProbeCannotSendIPv6 = "PortProbeCannotSendIPv6",
  PortNoIPv6Route = "PortNoIPv6Route",
  PortDnsResolutionFailed = "PortDnsResolutionFailed",
  PortConnectionTimedOut = "PortConnectionTimedOut",
  PortTcpConnectionFailed = "PortTcpConnectionFailed",
  PortNetworkError = "PortNetworkError",

  // The NTP check's query.
  NtpLookupTimedOut = "NtpLookupTimedOut",
  NtpNoReply = "NtpNoReply",
  NtpNameDidNotResolve = "NtpNameDidNotResolve",
  NtpPortUnreachable = "NtpPortUnreachable",
  NtpProbeCouldNotSend = "NtpProbeCouldNotSend",
  NtpNetworkError = "NtpNetworkError",
}

// Each explanation, as the probe stores it: its English, a translation key.
export const REQUEST_FAILURE_DESCRIPTIONS: Readonly<
  Record<RequestFailureDescription, string>
> = {
  [RequestFailureDescription.InvalidTarget]: translationKey(
    "The monitor's target is not a valid HTTP or HTTPS destination, so no request was attempted. {{message}}",
  ),
  [RequestFailureDescription.TargetUnreachable]: translationKey(
    "The probe could not obtain a usable network address for this host, so no connection was attempted and the target was never contacted. Either DNS did not answer, answered with no records, or returned an address this probe is not allowed to dial. Check that the hostname resolves publicly and that its authoritative nameservers are healthy. If this monitor targets an internal host, run it from a self-hosted probe with PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true.",
  ),
  [RequestFailureDescription.ProbeCouldNotConnect]: translationKey(
    "The probe could not open the connection from its own side, so the request was never sent and the server was never contacted. The failure is on the probe, not on the server.",
  ),
  [RequestFailureDescription.ProbeCouldNotConnectOverIPv6]: translationKey(
    "The probe could not open the IPv6 connection from its own side, so the request was never sent and the server was never contacted. The failure is on the probe, not on the server.",
  ),
  [RequestFailureDescription.ProbeCannotSendIPv6]: translationKey(
    "The probe cannot send IPv6 traffic, so the request was never sent and the server was never contacted. The failure is on the probe, not on the server.",
  ),
  [RequestFailureDescription.NoIPv6Route]: translationKey(
    "There was no IPv6 route to the server. Most likely the probe has no IPv6 route rather than the server being down.",
  ),
  [RequestFailureDescription.NetworkUnreachable]: translationKey(
    "Network unreachable. There is no route to the network where the server resides. This is typically a routing or connectivity issue.",
  ),
  [RequestFailureDescription.DnsResolutionFailed]: translationKey(
    "DNS resolution failed. The hostname could not be resolved to an IP address. Please verify the hostname is correct and that DNS is working properly.",
  ),
  [RequestFailureDescription.ConnectionRefused]: translationKey(
    "Connection refused. The server actively refused the connection. This usually means no service is listening on the specified port, or a firewall is blocking the connection.",
  ),
  [RequestFailureDescription.ConnectionReset]: translationKey(
    "Connection reset. The connection was forcibly closed by the server or a network device. This can happen due to server restarts, load balancer timeouts, or network issues.",
  ),
  [RequestFailureDescription.ConnectionAborted]: translationKey(
    "Connection aborted. The request was aborted, possibly due to a timeout or the connection being closed unexpectedly.",
  ),
  [RequestFailureDescription.RequestTimedOut]: translationKey(
    "Request timed out. The server did not respond within the allowed time. This could be due to network latency, server overload, or the server being unresponsive.",
  ),
  [RequestFailureDescription.CertificateRevoked]: translationKey(
    "SSL certificate has been revoked. The certificate's issuer has withdrawn it, so browsers refuse it even though it has not expired. Install a new certificate on the server.",
  ),
  [RequestFailureDescription.CertificateExpired]: translationKey(
    "SSL certificate has expired. The server's SSL certificate is no longer valid. The certificate needs to be renewed.",
  ),
  [RequestFailureDescription.SelfSignedCertificate]: translationKey(
    "Self-signed certificate detected. The server is using a self-signed SSL certificate that is not trusted by default. Consider using a certificate from a trusted Certificate Authority.",
  ),
  [RequestFailureDescription.CertificateUnknownAuthority]: translationKey(
    "SSL certificate signed by unknown authority. The certificate chain could not be verified against known Certificate Authorities.",
  ),
  [RequestFailureDescription.TlsHandshakeFailed]: translationKey(
    "TLS/SSL handshake failed. There was an error establishing a secure connection to the server. This could be due to certificate issues, protocol mismatches, or the server not supporting HTTPS.",
  ),
  [RequestFailureDescription.NetworkError]: translationKey(
    "Network error occurred. Unable to reach the server due to network connectivity issues. Please check your network connection and ensure the server is accessible.",
  ),
  [RequestFailureDescription.HostUnreachable]: translationKey(
    "Host unreachable. The network path to the server could not be found. This may be due to routing issues or the host being offline.",
  ),
  [RequestFailureDescription.HttpStatus]: translationKey(
    "Server responded with HTTP status {{status}}.",
  ),
  [RequestFailureDescription.HttpServerError]: translationKey(
    "Server responded with HTTP status {{status}}. This indicates a server-side error.",
  ),
  [RequestFailureDescription.HttpNotFound]: translationKey(
    "Server responded with HTTP status {{status}}. The requested resource was not found.",
  ),
  [RequestFailureDescription.HttpForbidden]: translationKey(
    "Server responded with HTTP status {{status}}. Access to the resource is forbidden.",
  ),
  [RequestFailureDescription.HttpUnauthorized]: translationKey(
    "Server responded with HTTP status {{status}}. Authentication is required or has failed.",
  ),
  [RequestFailureDescription.HttpBadRequest]: translationKey(
    "Server responded with HTTP status {{status}}. The request was malformed or invalid.",
  ),
  [RequestFailureDescription.HttpClientError]: translationKey(
    "Server responded with HTTP status {{status}}. This indicates a client-side error.",
  ),
  [RequestFailureDescription.NoResponse]: translationKey(
    "No response received from the server. The request was sent but no response was returned. This could indicate the server is down, unreachable, or the request timed out.",
  ),
  [RequestFailureDescription.RequestFailed]: translationKey(
    "Request failed: {{message}}",
  ),

  [RequestFailureDescription.PortProbeCouldNotConnect]: translationKey(
    "The probe could not open the TCP connection from its own side, so the destination port was never contacted. The failure is on the probe, not on the destination.",
  ),
  [RequestFailureDescription.PortProbeCouldNotConnectOverIPv6]: translationKey(
    "The probe could not open the IPv6 connection from its own side, so the TCP connection was never attempted and the destination port was never contacted. The failure is on the probe, not on the destination.",
  ),
  [RequestFailureDescription.PortProbeCannotSendIPv6]: translationKey(
    "The probe cannot send IPv6 traffic, so the TCP connection was never attempted and the destination port was never contacted. The failure is on the probe, not on the destination.",
  ),
  [RequestFailureDescription.PortNoIPv6Route]: translationKey(
    "There was no IPv6 route for the TCP connection. Most likely the probe has no IPv6 route rather than the destination being down.",
  ),
  [RequestFailureDescription.PortDnsResolutionFailed]: translationKey(
    "DNS resolution failed before a TCP connection could be attempted.",
  ),
  [RequestFailureDescription.PortConnectionTimedOut]: translationKey(
    "The DNS and TCP connection attempt did not finish before the deadline.",
  ),
  [RequestFailureDescription.PortTcpConnectionFailed]: translationKey(
    "TCP connection establishment failed before the port could be reached.",
  ),
  [RequestFailureDescription.PortNetworkError]: translationKey(
    "The port check failed because of a network error.",
  ),

  [RequestFailureDescription.NtpLookupTimedOut]: translationKey(
    "The DNS lookup of the NTP server did not finish before the timeout.",
  ),
  [RequestFailureDescription.NtpNoReply]: translationKey(
    "The request was sent, but no NTP reply came back before the timeout. A firewall dropping UDP port 123, a server that is down, or a server that only answers some networks all look like this.",
  ),
  [RequestFailureDescription.NtpNameDidNotResolve]: translationKey(
    "The NTP server's name did not resolve to an address, so no request was sent.",
  ),
  [RequestFailureDescription.NtpPortUnreachable]: translationKey(
    "The host is reachable, but answered that no service listens on this UDP port: the NTP daemon is stopped, or listens on another port.",
  ),
  [RequestFailureDescription.NtpProbeCouldNotSend]: translationKey(
    "The probe could not send the request from its own side, so the NTP server was never contacted. The failure is on the probe, not on the server.",
  ),
  [RequestFailureDescription.NtpNetworkError]: translationKey(
    "The NTP check failed because of a network error.",
  ),
};

/*
 * The value an explanation carries, by its placeholder: the HTTP status a
 * server answered with, or the message a failure came with.
 */
export interface RequestFailureDescriptionValues {
  status?: number | string | undefined;
  message?: string | undefined;
}

type PlaceholderName = keyof RequestFailureDescriptionValues;

const PLACEHOLDERS: ReadonlyArray<PlaceholderName> = ["status", "message"];

// An explanation with a value: its English before and after the value.
interface TemplatedDescription {
  description: RequestFailureDescription;
  placeholder: PlaceholderName;
  before: string;
  after: string;
}

const placeholderOf: (name: PlaceholderName) => string = (
  name: PlaceholderName,
): string => {
  return `{{${name}}}`;
};

const DESCRIPTIONS: ReadonlyArray<RequestFailureDescription> = Object.values(
  RequestFailureDescription,
);

// The explanations with no value, by their English.
const FIXED_DESCRIPTIONS: ReadonlyMap<string, RequestFailureDescription> =
  new Map<string, RequestFailureDescription>(
    DESCRIPTIONS.filter((description: RequestFailureDescription): boolean => {
      return !PLACEHOLDERS.some((name: PlaceholderName): boolean => {
        return REQUEST_FAILURE_DESCRIPTIONS[description].includes(
          placeholderOf(name),
        );
      });
    }).map(
      (
        description: RequestFailureDescription,
      ): [string, RequestFailureDescription] => {
        return [REQUEST_FAILURE_DESCRIPTIONS[description], description];
      },
    ),
  );

// The explanations with a value, each split round it (one value each).
const TEMPLATED_DESCRIPTIONS: ReadonlyArray<TemplatedDescription> =
  DESCRIPTIONS.flatMap(
    (description: RequestFailureDescription): Array<TemplatedDescription> => {
      const english: string = REQUEST_FAILURE_DESCRIPTIONS[description];

      for (const name of PLACEHOLDERS) {
        const at: number = english.indexOf(placeholderOf(name));

        if (at !== -1) {
          return [
            {
              description: description,
              placeholder: name,
              before: english.slice(0, at),
              after: english.slice(at + placeholderOf(name).length),
            },
          ];
        }
      }

      return [];
    },
  );

/*
 * An HTTP status as a server answers with one: three digits, Latin, the
 * first 1 to 5 - as String(status) writes axios' response status.
 */
const HTTP_STATUS_PATTERN: RegExp = /^[1-5][0-9]{2}$/;

/*
 * The explanation the probe stores - word for word the English it always
 * wrote by hand: the English itself, its value put in by concatenation
 * (an HTTP status as String() writes it; a message as it came, however
 * many braces or dollar signs it holds).
 */
export const writeRequestFailureDescription: (
  description: RequestFailureDescription,
  values?: RequestFailureDescriptionValues,
) => string = (
  description: RequestFailureDescription,
  values?: RequestFailureDescriptionValues,
): string => {
  const english: string = REQUEST_FAILURE_DESCRIPTIONS[description];
  const templated: TemplatedDescription | undefined =
    TEMPLATED_DESCRIPTIONS.find((candidate: TemplatedDescription): boolean => {
      return candidate.description === description;
    });

  if (!templated) {
    return english;
  }

  return `${templated.before}${String(values?.[templated.placeholder])}${templated.after}`;
};

// An explanation the probe stored, read back.
export interface RequestFailureDescriptionReading {
  description: RequestFailureDescription;
  // The value it carries, as stored: the HTTP status's digits, a message.
  values: RequestFailureDescriptionValues;
}

/*
 * The explanation a stored text is, when the text is exactly one of the
 * table's (space round it aside), with the value it carries; null for any
 * other text - one close to an explanation but not the same, an
 * explanation inside a longer text, a newer probe's own - which stays as
 * written. No regular expression reads the stored text: a lookup, and a
 * comparison of each templated explanation's two ends, in time that grows
 * with the text's length.
 */
export const readRequestFailureDescription: (
  text: string | null | undefined,
) => RequestFailureDescriptionReading | null = (
  text: string | null | undefined,
): RequestFailureDescriptionReading | null => {
  const stored: string = typeof text === "string" ? text.trim() : "";

  if (!stored) {
    return null;
  }

  const fixed: RequestFailureDescription | undefined =
    FIXED_DESCRIPTIONS.get(stored);

  if (fixed) {
    return { description: fixed, values: {} };
  }

  for (const templated of TEMPLATED_DESCRIPTIONS) {
    if (
      stored.length <= templated.before.length + templated.after.length ||
      !stored.startsWith(templated.before) ||
      !stored.endsWith(templated.after)
    ) {
      continue;
    }

    const value: string = stored.slice(
      templated.before.length,
      stored.length - templated.after.length,
    );

    if (templated.placeholder === "status") {
      if (HTTP_STATUS_PATTERN.test(value)) {
        return {
          description: templated.description,
          values: { status: value },
        };
      }

      continue;
    }

    if (value.trim()) {
      return {
        description: templated.description,
        values: { message: value },
      };
    }
  }

  return null;
};

/*
 * A stored explanation as a summary draws it: in the reader's language
 * when the text is one of the table's and the language words it, its HTTP
 * status as the server sent it and its message as written (set apart from
 * the reader's words when the options ask, for a text drawn on the page);
 * any other text, or one the reader's language does not word yet, as
 * stored, trimmed.
 */
export const getRequestFailureDescriptionText: (data: {
  translator: Translator;
  description: string | null | undefined;
  options?: SentenceOptions | undefined;
}) => string = (data: {
  translator: Translator;
  description: string | null | undefined;
  options?: SentenceOptions | undefined;
}): string => {
  const stored: string =
    typeof data.description === "string" ? data.description.trim() : "";
  const reading: RequestFailureDescriptionReading | null =
    readRequestFailureDescription(stored);

  if (!reading) {
    return stored;
  }

  const english: string = REQUEST_FAILURE_DESCRIPTIONS[reading.description];

  if (!data.translator.hasTranslation(english)) {
    return stored;
  }

  const values: Record<string, string> = {};

  for (const name of PLACEHOLDERS) {
    const value: string | number | undefined = reading.values[name];

    if (value !== undefined) {
      values[name] = String(value);
    }
  }

  return data.translator.translateTemplate(english, values, data.options);
};

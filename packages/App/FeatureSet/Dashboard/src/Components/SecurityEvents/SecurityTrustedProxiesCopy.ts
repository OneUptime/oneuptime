import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  TrustedProxyListProblem,
  TrustedProxyListProblemKind,
  getTrustedProxyListProblem,
} from "Common/Utils/SecurityEvent/ClientAddressTrust";
import {
  ACCESS_LOG_VARIABLES,
  AccessLogFormat,
  AccessLogFormatProblem,
  AccessLogFormatProblemKind,
  readAccessLogFormat,
} from "Common/Utils/SecurityEvent/LogParsers/AccessLogFormat";

/*
 * THE WORDS OF TRUSTED PROXIES (#10416): the proxies a project's apps sit
 * behind, whose forwarded client address Security Events trusts
 * (Project.securityTrustedProxies, Common/Utils/SecurityEvent/
 * ClientAddressTrust). Under More settings on Security Events >
 * Connections, beside the sources the scans read. Each is an en.json key,
 * looked up where it is drawn.
 */

export const TRUSTED_PROXIES_TITLE: string = translationKey("Trusted Proxies");

export const TRUSTED_PROXIES_DESCRIPTION: string = translationKey(
  "The proxies your apps sit behind, such as a CDN or a load balancer. Security Events trusts the client address they forward in X-Forwarded-For.",
);

export const TRUSTED_PROXIES_FIELD_DESCRIPTION: string = translationKey(
  "One IP address or range a line, such as 203.0.113.0/24, or 10.0.0.0/24 for an HTTP proxy inside your network.",
);

/*
 * A listed range that holds where a load balancer of the project's that
 * passes on what a client wrote connects from (#11388, #11389): OneUptime
 * does not trust that part of it, listed or not. Said under the list.
 */
export const LISTED_PASS_ON_WARNING: string = translationKey(
  "{{range}} holds addresses {{loadBalancer}} connects from. It passes on the X-Forwarded-For a client wrote, so OneUptime doesn't trust them, even listed.",
);

// The same of Google's front ends, which the old docs said to list.
export const LISTED_GOOGLE_FRONT_ENDS_WARNING: string = translationKey(
  "{{range}} holds Google's front ends, which your TCP or SSL proxy load balancer {{loadBalancer}} connects from. OneUptime doesn't trust them while it does; Your Load Balancers trusts them when it's safe to.",
);

// Why the list cannot be saved as typed (getTrustedProxyListProblem).
export const TRUSTED_PROXIES_TOO_LONG: string = translationKey(
  "Trusted Proxies is too long. Use ranges, such as 203.0.113.0/24, for a block of addresses.",
);

export const TRUSTED_PROXIES_NOT_AN_ADDRESS: string = translationKey(
  "{{entry}} is not an IP address or a range. Write an address, such as 203.0.113.7, or a range, such as 203.0.113.0/24.",
);

export const TRUSTED_PROXIES_TOO_MANY: string = translationKey(
  "Trusted Proxies holds at most {{max}} addresses and ranges. Use ranges, such as 203.0.113.0/24, for a block of addresses.",
);

// A range wider than any proxy's: trusted, anyone could choose the address they are blamed on.
export const TRUSTED_PROXIES_TOO_BROAD: string = translationKey(
  "{{entry}} covers too much of the internet to be a proxy. List your proxy's own addresses or ranges, such as 203.0.113.0/24.",
);

/*
 * Why the list cannot be saved as typed, in the reader's language, or null.
 * The server refuses the same lists, in English
 * (ProjectService.applySecurityTrustedProxyRules).
 */
export function getTrustedProxiesProblemText(
  text: string | undefined | null,
  translator: Translator,
): string | null {
  const problem: TrustedProxyListProblem | null =
    getTrustedProxyListProblem(text);

  if (!problem) {
    return null;
  }

  switch (problem.kind) {
    case TrustedProxyListProblemKind.TooLong:
      return translator.translateTemplate(TRUSTED_PROXIES_TOO_LONG, {});
    case TrustedProxyListProblemKind.NotAnAddress:
      return translator.translateTemplate(TRUSTED_PROXIES_NOT_AN_ADDRESS, {
        entry: problem.entry,
      });
    case TrustedProxyListProblemKind.TooBroad:
      return translator.translateTemplate(TRUSTED_PROXIES_TOO_BROAD, {
        entry: problem.entry,
      });
    case TrustedProxyListProblemKind.TooMany:
      return translator.translateTemplate(TRUSTED_PROXIES_TOO_MANY, {
        max: translator.formatNumber(problem.max),
      });
  }
}

// The More settings fold on Connections, which holds the card.
export const CONNECTIONS_MORE_SETTINGS_DESCRIPTION: string = translationKey(
  "How Security Events reads where requests come from.",
);

/*
 * ---------------------------------------------------------------------------
 * Trusted Automatically (#10546): what Security Events trusts as a proxy
 * without being listed, and why - the private addresses, a connected edge,
 * the project's own load balancers (a switch) - and what it never trusts.
 * ---------------------------------------------------------------------------
 */

export const TRUSTED_AUTOMATICALLY_TITLE: string = translationKey(
  "Trusted Automatically",
);

export const TRUSTED_AUTOMATICALLY_DESCRIPTION: string = translationKey(
  "Security Events trusts these as proxies without your listing them.",
);

// The switch: whether the project's own load balancers are trusted.
export const OWN_LOAD_BALANCERS_TITLE: string = translationKey(
  "Your Load Balancers",
);

export const OWN_LOAD_BALANCERS_ON: string = translationKey(
  "Your application load balancers in AWS, Google Cloud and Azure. Each adds the client it forwards to X-Forwarded-For.",
);

export const OWN_LOAD_BALANCERS_OFF: string = translationKey(
  "Off: an attack that comes through one of them is blamed on the load balancer itself.",
);

// The load balancers found, under the switch.
export const OWN_LOAD_BALANCERS_NONE: string = translationKey(
  "None in your connected cloud accounts.",
);

export const OWN_LOAD_BALANCERS_UNREAD: string = translationKey(
  "Your load balancers couldn't be listed: you can't read cloud resources, or they couldn't be read.",
);

export const OWN_LOAD_BALANCERS_MORE: string = translationKey(
  "Not every one is listed here.",
);

export const OWN_LOAD_BALANCERS_NOT_TRUSTED: string = translationKey(
  "Not trusted while the switch is off.",
);

/*
 * Google's front ends (#11047), on a line of the list with the load
 * balancers that bring them - or what keeps them untrusted.
 */
export const GOOGLE_FRONT_ENDS_TITLE: string = translationKey(
  "Google's front ends",
);

export const GOOGLE_FRONT_ENDS_FOR: string = translationKey(
  "For {{loadBalancers}}",
);

export const GOOGLE_FRONT_ENDS_WITHHELD: { one: string; other: string } = {
  one: translationKey(
    "Not trusted: {{loadBalancers}} is a TCP or SSL proxy load balancer, which passes on what a client writes.",
  ),
  other: translationKey(
    "Not trusted: {{loadBalancers}} are TCP or SSL proxy load balancers, which pass on what a client writes.",
  ),
};

export const GOOGLE_FRONT_ENDS_UNREAD: string = translationKey(
  "Not trusted while not every load balancer is listed.",
);

/*
 * The second switch (#11389): whether private addresses are trusted unlisted
 * (Project.securityTrustPrivateAddresses). Off for a new project.
 */
export const PRIVATE_ADDRESSES_TITLE: string =
  translationKey("Private Addresses");

export const PRIVATE_ADDRESSES_ON: string = translationKey(
  "Every private, loopback and link-local address is trusted as an HTTP proxy, such as an ingress inside your network.",
);

export const PRIVATE_ADDRESSES_OFF: string = translationKey(
  "Off: a private address is trusted only if it's listed or one of your load balancers'. An attack through any other is blamed on it.",
);

// Under the switch while it is on: what it risks, and what to do.
export const PRIVATE_ADDRESSES_WARNING: string = translationKey(
  "Behind a TCP proxy at one, such as HAProxy in mode tcp, a client could choose who an attack is blamed on. List your proxies, then turn this off.",
);

// The fold's chip while private addresses are trusted.
export const PRIVATE_ADDRESSES_CHIP: string =
  translationKey("Private addresses");

/*
 * What is never trusted, even listed (#11389): where the project's load
 * balancers that pass on what a client wrote connect from.
 */
export const PASS_ON_TITLE: string = translationKey(
  "Not trusted, even if listed",
);

export const PASS_ON_DESCRIPTION: string = translationKey(
  "Your load balancers that work at the TCP level connect from these, and pass on the X-Forwarded-For a client wrote.",
);

// Why one of them passes on what a client wrote (Utils/SecurityEvent/PassOnLoadBalancers.PassOnReason).
export const PASS_ON_PROXY_ONLY_SUBNET: string = translationKey(
  "Connects from its region's proxy-only subnet",
);

export const PASS_ON_GOOGLE_FRONT_ENDS: string = translationKey(
  "Connects from Google's front ends",
);

export const PASS_ON_CLIENT_IP_NOT_PRESERVED: { one: string; other: string } =
  {
    one: translationKey(
      "Client IP preservation is off for target group {{targetGroups}}",
    ),
    other: translationKey(
      "Client IP preservation is off for target groups {{targetGroups}}",
    ),
  };

export const PASS_ON_DUALSTACK: string = translationKey(
  "Dualstack: an IPv6 client reaches IPv4 targets from its own address",
);

export const PASS_ON_CLIENT_IP_UNKNOWN: string = translationKey(
  "OneUptime couldn't read whether its target groups keep the client's address",
);

export const PASS_ON_TCP_LISTENER: string = translationKey(
  "Has a TCP or SSL listener",
);

export const PASS_ON_RANGES_UNREAD: string = translationKey(
  "OneUptime couldn't read where it connects from",
);

// A connected edge, such as Cloudflare: its name is the line's title.
export const EDGE_TRUSTED_DESCRIPTION: { one: string; other: string } = {
  one: translationKey(
    "Because you connected it: its {{count}} published range.",
  ),
  other: translationKey(
    "Because you connected it: its {{count}} published ranges.",
  ),
};

// What is never trusted automatically, and what to do when one is a proxy.
export const NEVER_TRUSTED_TITLE: string = translationKey(
  "Never trusted automatically",
);

export const NEVER_TRUSTED_DESCRIPTION: string = translationKey(
  "Your hosts, Kubernetes nodes and probes: whatever runs on one could name any client. If one of them is your proxy, add it to Trusted Proxies.",
);

/*
 * ---------------------------------------------------------------------------
 * Access Logs (#10548): whether the project's access logs end with the
 * X-Forwarded-For header, which a line itself never says.
 * ---------------------------------------------------------------------------
 */

export const ACCESS_LOGS_TITLE: string = translationKey("Access Logs");

export const ACCESS_LOGS_DESCRIPTION: string = translationKey(
  "How Security Events reads the client of a line in your web servers' access logs.",
);

export const ACCESS_LOGS_SWITCH_TITLE: string = translationKey(
  "Logs End With X-Forwarded-For",
);

export const ACCESS_LOGS_ON: string = translationKey(
  "Each line's last field is read as X-Forwarded-For when its first is a proxy you trust, as nginx's main format writes them.",
);

export const ACCESS_LOGS_OFF: string = translationKey(
  "Turn on if your web servers log X-Forwarded-For last, as nginx's main format does. Until then, each line's first field is its client.",
);

/*
 * ---------------------------------------------------------------------------
 * Log Format (#11048): the nginx log_format a project's access logs are
 * written in, so each line in it is read field by field.
 * ---------------------------------------------------------------------------
 */

export const ACCESS_LOG_FORMAT_TITLE: string = translationKey("Log Format");

export const ACCESS_LOG_FORMAT_NOT_GIVEN: string = translationKey(
  "Not given. Give it if your lines put X-Forwarded-For anywhere but last, such as before {{field}}.",
);

// What a line in the format is read for, the variables as the format names them.
export const ACCESS_LOG_FORMAT_READS: string = translationKey(
  "Each line in it is read field by field: the address that connected from {{connection}}, X-Forwarded-For from {{forwardedFor}}.",
);

/*
 * Said of a format with no X-Forwarded-For, such as ingress-nginx's
 * upstreaminfo. Adding the header is advised only behind an HTTP proxy,
 * which adds the client itself: behind a TCP-level one (a Network Load
 * Balancer) the header is what the client wrote, and the private hop in
 * front of the web server is trusted (#11389).
 */
export const ACCESS_LOG_FORMAT_NO_FORWARDED_FOR: string = translationKey(
  "It logs no X-Forwarded-For, so each line's client is its {{connection}}. If an Application Load Balancer or another HTTP proxy is in front, add {{forwardedFor}} to read the client it forwarded.",
);

// The dialog and its one field.
export const ACCESS_LOG_FORMAT_FIELD_TITLE: string = translationKey(
  "Your nginx log_format",
);

export const ACCESS_LOG_FORMAT_FIELD_DESCRIPTION: string = translationKey(
  "Paste it as your nginx.conf writes it, or start from a known one. Lines in it are read field by field; others as before.",
);

export const ACCESS_LOG_FORMAT_KNOWN: string =
  translationKey("Use a known format");

// Why a format cannot be kept (AccessLogFormatProblem), as the server says it in English.
export const ACCESS_LOG_FORMAT_TOO_LONG: string = translationKey(
  "Your log format is too long. OneUptime reads one of up to {{max}} characters.",
);

export const ACCESS_LOG_FORMAT_NOT_CLOSED: string = translationKey(
  "A quote in your log format never closes. Paste it as your nginx.conf writes it.",
);

export const ACCESS_LOG_FORMAT_NO_FIELD: string = translationKey(
  "This is no nginx log format: it names no field, such as {{example}}.",
);

export const ACCESS_LOG_FORMAT_NO_CONNECTION: string = translationKey(
  "Your log format must log the address that connected, {{connection}}, so OneUptime can tell whether it was a proxy you trust.",
);

export const ACCESS_LOG_FORMAT_UNCLEAR_FIELD: string = translationKey(
  "OneUptime can't tell where {{field}} ends in your log format. Put it in quotes, as {{quoted}}.",
);

// The fold's chip, while a format is given.
export const ACCESS_LOG_FORMAT_GIVEN: string =
  translationKey("Your log format");

// A variable as nginx writes it, drawn as written in every language.
function variable(name: string): string {
  return `$${name}`;
}

/*
 * Why a format cannot be kept, in the reader's language, or null. The
 * server refuses the same formats, in English
 * (ProjectService.applySecurityAccessLogFormatRules).
 */
export function getAccessLogFormatProblemText(
  text: string | undefined | null,
  translator: Translator,
): string | null {
  const problem: AccessLogFormatProblem | null =
    readAccessLogFormat(text).problem;

  if (!problem) {
    return null;
  }

  switch (problem.kind) {
    case AccessLogFormatProblemKind.TooLong:
      return translator.translateTemplate(ACCESS_LOG_FORMAT_TOO_LONG, {
        max: translator.formatNumber(problem.max),
      });
    case AccessLogFormatProblemKind.NotClosed:
      return (
        translator.translateText(ACCESS_LOG_FORMAT_NOT_CLOSED) ||
        ACCESS_LOG_FORMAT_NOT_CLOSED
      );
    case AccessLogFormatProblemKind.NoField:
      return translator.translateTemplate(ACCESS_LOG_FORMAT_NO_FIELD, {
        example: variable(ACCESS_LOG_VARIABLES.connection),
      });
    case AccessLogFormatProblemKind.NoConnectionAddress:
      return translator.translateTemplate(ACCESS_LOG_FORMAT_NO_CONNECTION, {
        connection: variable(ACCESS_LOG_VARIABLES.connection),
      });
    case AccessLogFormatProblemKind.UnclearField:
      return translator.translateTemplate(ACCESS_LOG_FORMAT_UNCLEAR_FIELD, {
        field: variable(problem.variable),
        quoted: `"${variable(problem.variable)}"`,
      });
  }
}

// What OneUptime reads of a line in the format, or that none is given.
export function getAccessLogFormatSummary(
  format: AccessLogFormat | null,
  translator: Translator,
): string {
  if (!format) {
    return translator.translateTemplate(ACCESS_LOG_FORMAT_NOT_GIVEN, {
      field: variable("request_time"),
    });
  }

  const connection: string = variable(format.connectionVariable);

  if (format.readsForwardedFor) {
    return translator.translateTemplate(ACCESS_LOG_FORMAT_READS, {
      connection,
      forwardedFor: variable(ACCESS_LOG_VARIABLES.forwardedFor),
    });
  }

  return translator.translateTemplate(ACCESS_LOG_FORMAT_NO_FORWARDED_FOR, {
    connection,
    forwardedFor: `"${variable(ACCESS_LOG_VARIABLES.forwardedFor)}"`,
  });
}

export const TRUSTED_PROXIES_TEST_IDS: Readonly<{
  card: string;
  fold: string;
  automatic: string;
  ownLoadBalancersSwitch: string;
  ownLoadBalancers: string;
  googleFrontEnds: string;
  privateAddressesSwitch: string;
  privateAddressRanges: string;
  passOn: string;
  listedPassOnWarning: string;
  edges: string;
  neverTrusted: string;
  accessLogsSwitch: string;
  accessLogFormat: string;
  accessLogFormatEdit: string;
  accessLogFormatField: string;
}> = {
  card: "security-trusted-proxies",
  fold: "security-connections-more-settings",
  automatic: "security-trusted-automatically",
  ownLoadBalancersSwitch: "security-trust-own-load-balancers",
  ownLoadBalancers: "security-own-load-balancers",
  googleFrontEnds: "security-google-front-ends",
  privateAddressesSwitch: "security-trust-private-addresses",
  privateAddressRanges: "security-private-address-ranges",
  passOn: "security-pass-on-load-balancers",
  listedPassOnWarning: "security-listed-pass-on-warning",
  edges: "security-trusted-edges",
  neverTrusted: "security-never-trusted-proxies",
  accessLogsSwitch: "security-access-logs-forwarded-for",
  accessLogFormat: "security-access-log-format",
  accessLogFormatEdit: "security-access-log-format-edit",
  accessLogFormatField: "security-access-log-format-field",
};

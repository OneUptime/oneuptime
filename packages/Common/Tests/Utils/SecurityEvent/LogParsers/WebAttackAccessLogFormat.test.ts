import { describe, expect, test } from "@jest/globals";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../../../Utils/NetworkTraffic/NetworkAddressBlock";
import {
  ClaimedClientAddress,
  ClientAddressTrust,
  TrustedProxies,
  readClaimedClientAddress,
  readClientAddressTrust,
  readForwardedBy,
} from "../../../../Utils/SecurityEvent/ClientAddressTrust";
import {
  AccessLogFormat,
  KNOWN_ACCESS_LOG_FORMATS,
  KnownAccessLogFormat,
  readAccessLogFormat,
} from "../../../../Utils/SecurityEvent/LogParsers/AccessLogFormat";
import { MAX_TEXT_LINE_LENGTH } from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogLine";
import WebAttackLogParser, {
  AccessLogRequest,
  readAccessLogByFormat,
} from "../../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import { readHiddenClientAddress } from "../../../../Utils/SecurityEvent/ScrubbedAddress";
import { logLine } from "./LogParserFixtures";

/*
 * #11048: AN ACCESS LOG READ BY THE PROJECT'S OWN FORMAT, AS AN ATTACK IS
 * BLAMED.
 *
 * Since #10548 the X-Forwarded-For a combined line ends with was read, and
 * only from exactly that shape: a format that put the header anywhere else
 * - before $request_time, before the user agent, in ingress-nginx's format
 * - kept the load balancer as every attack's client. With the project's
 * format given, a line in it is read field by field: the client is the one
 * $http_x_forwarded_for names, walked from the right, behind a proxy the
 * project trusts in $remote_addr - and nothing else of the line is ever
 * taken for it. #10548's rules stay, and a line not in the format is read
 * as before.
 */

const LOAD_BALANCER: string = "10.0.0.5";
const CLIENT: string = "198.51.100.7";
// What a sender wrote, and an address an attacker wants blamed: someone else's.
const SENDERS_CLAIM: string = "198.51.100.9";
const INNOCENT: string = "192.0.2.44";
// A public address the project does not trust: whatever runs there.
const UNTRUSTED_HOST: string = "203.0.113.50";

const TIMED: string = `log_format timed '$remote_addr - $remote_user [$time_local] "$request" '
                 '$status $body_bytes_sent "$http_referer" '
                 '"$http_user_agent" "$http_x_forwarded_for" $request_time';`;

function formatOf(text: string): AccessLogFormat {
  const format: AccessLogFormat | null = readAccessLogFormat(text).format;

  expect(format).not.toBeNull();

  return format!;
}

function known(key: string): string {
  return KNOWN_ACCESS_LOG_FORMATS.find(
    (format: KnownAccessLogFormat): boolean => {
      return format.key === key;
    },
  )!.text;
}

function blocks(...ranges: Array<string>): Array<NetworkAddressBlock> {
  return ranges.map((range: string): NetworkAddressBlock => {
    return NetworkAddressBlockUtil.parse(range)!;
  });
}

// A project that gave `format`, with the Access Logs switch as `readsSwitch` says.
function trust(
  format: string | null,
  data: { readsSwitch?: boolean; listed?: Array<string> } = {},
): TrustedProxies {
  return {
    blocks: blocks(...(data.listed || [])),
    readsAccessLogForwardedFor: data.readsSwitch === true,
    accessLogFormat: format ? formatOf(format) : null,
  };
}

function parseOne(
  body: string,
  trustedProxies: TrustedProxies,
): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = WebAttackLogParser.parse({
    ...logLine(body),
    trustedProxies,
  });

  expect(events).toHaveLength(1);

  return events[0]!;
}

function userAgentOf(event: NormalizedSecurityEvent): unknown {
  return event.attributes[SECURITY_REQUEST_ATTRIBUTES.userAgent];
}

function claimOf(event: NormalizedSecurityEvent): ClaimedClientAddress | null {
  return readClaimedClientAddress(event);
}

// The issue's request - a path traversal - written in the timed format behind `first`.
function timedLine(
  first: string = LOAD_BALANCER,
  forwardedFor: string = `${SENDERS_CLAIM}, ${CLIENT}`,
  userAgent: string = "curl/8.4.0",
): string {
  return `${first} - - [27/Nov/2026:10:00:05 +0000] "GET /download?file=../../etc/passwd HTTP/1.1" 404 153 "-" "${userAgent}" "${forwardedFor}" 0.004`;
}

describe("the issue's own format: X-Forwarded-For, then the request's duration", () => {
  test("given, the client the load balancer forwarded is named, verified, the sender's own words only claimed", () => {
    const event: NormalizedSecurityEvent = parseOne(timedLine(), trust(TIMED));

    expect(event.principalIp).toBe(CLIENT);
    expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.TrustedProxy);
    expect(readForwardedBy(event)).toEqual([LOAD_BALANCER]);
    expect(claimOf(event)?.address).toBe(SENDERS_CLAIM);
    expect(event.observables).not.toContain(SENDERS_CLAIM);
    expect(event.observables).not.toContain(LOAD_BALANCER);
  });

  test("its user agent, request and status come from their own fields", () => {
    const event: NormalizedSecurityEvent = parseOne(timedLine(), trust(TIMED));

    expect(userAgentOf(event)).toBe("curl/8.4.0");
    expect(event.attributes[SECURITY_REQUEST_ATTRIBUTES.method]).toBe("GET");
    expect(event.attributes[SECURITY_REQUEST_ATTRIBUTES.statusCode]).toBe(
      "404",
    );
    expect(event.targetResource).toBe("/download?file=../../etc/passwd");
  });

  test("not given, it is read as before: the load balancer, with the Access Logs switch on or off", () => {
    for (const readsSwitch of [true, false]) {
      const event: NormalizedSecurityEvent = parseOne(
        timedLine(),
        trust(null, { readsSwitch }),
      );

      expect(event.principalIp).toBe(LOAD_BALANCER);
      expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.Peer);
    }
  });

  test("given, the format says where the header is: the Access Logs switch need not be on", () => {
    expect(
      parseOne(timedLine(), trust(TIMED, { readsSwitch: false })).principalIp,
    ).toBe(CLIENT);
  });
});

describe("only a proxy the project trusts in the connection's field makes the header worth reading", () => {
  test("a forged header from a first field nobody trusts: that address, and the forgery only claimed", () => {
    const event: NormalizedSecurityEvent = parseOne(
      timedLine(UNTRUSTED_HOST, INNOCENT),
      trust(TIMED),
    );

    expect(event.principalIp).toBe(UNTRUSTED_HOST);
    expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.Peer);
    expect(claimOf(event)?.address).toBe(INNOCENT);
    expect(event.observables).not.toContain(INNOCENT);
  });

  test("a public proxy the project lists: read", () => {
    expect(
      parseOne(
        timedLine("203.0.113.10", CLIENT),
        trust(TIMED, { listed: ["203.0.113.0/24"] }),
      ).principalIp,
    ).toBe(CLIENT);
  });

  test("the rightmost hop no trusted proxy wrote, past the trusted ones", () => {
    const event: NormalizedSecurityEvent = parseOne(
      timedLine(LOAD_BALANCER, `${INNOCENT}, ${CLIENT}, 10.0.0.9`),
      trust(TIMED),
    );

    expect(event.principalIp).toBe(CLIENT);
    expect(readForwardedBy(event)).toEqual(["10.0.0.9", LOAD_BALANCER]);
  });

  test("a header that names nobody verifies nothing: the request's claim is all there is", () => {
    const event: NormalizedSecurityEvent = parseOne(
      timedLine(LOAD_BALANCER, `${INNOCENT}, unknown`),
      trust(TIMED),
    );

    expect(event.principalIp).toBe("");
    expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.Claimed);
  });

  test("no header (nginx's '-'): the connection's own address", () => {
    const event: NormalizedSecurityEvent = parseOne(
      timedLine(UNTRUSTED_HOST, "-"),
      trust(TIMED),
    );

    expect(event.principalIp).toBe(UNTRUSTED_HOST);
    expect(claimOf(event)).toBeNull();
  });

  test("a connection's field a scrub rule hid: the client is hidden, and nothing is read from the header", () => {
    const event: NormalizedSecurityEvent = parseOne(
      timedLine("[REDACTED]", INNOCENT),
      trust(TIMED),
    );

    expect(event.principalIp).toBe("");
    expect(readHiddenClientAddress(event)).not.toBeNull();
    expect(event.observables).not.toContain(INNOCENT);
  });
});

describe("X-Forwarded-For wherever the format puts it", () => {
  test("before the user agent", () => {
    const format: string = `$remote_addr [$time_local] "$request" $status "$http_x_forwarded_for" "$http_user_agent"`;
    const event: NormalizedSecurityEvent = parseOne(
      `${LOAD_BALANCER} [27/Nov/2026:10:00:05 +0000] "GET /download?file=../../etc/passwd HTTP/1.1" 404 "${CLIENT}" "curl/8.4.0"`,
      trust(format),
    );

    expect(event.principalIp).toBe(CLIENT);
    expect(userAgentOf(event)).toBe("curl/8.4.0");
  });

  test("unquoted, at the line's end", () => {
    expect(
      parseOne(
        `${LOAD_BALANCER} "GET /download?file=../../etc/passwd HTTP/1.1" 404 ${INNOCENT}, ${CLIENT}`,
        trust(`$remote_addr "$request" $status $http_x_forwarded_for`),
      ).principalIp,
    ).toBe(CLIENT);
  });

  test("in ingress-nginx's format, as people add it there behind a load balancer", () => {
    const format: string = `log-format-upstream: '$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" "$http_x_forwarded_for" $request_length $request_time [$proxy_upstream_name] [$proxy_alternative_upstream_name] $upstream_addr $upstream_response_length $upstream_response_time $upstream_status $req_id'`;
    const event: NormalizedSecurityEvent = parseOne(
      `10.244.0.1 - - [27/Nov/2026:10:00:05 +0000] "GET /download?file=../../etc/passwd HTTP/1.1" 404 153 "-" "curl/8.4.0" "${SENDERS_CLAIM}, ${CLIENT}" 532 0.002 [default-web-80] [] 10.244.1.15:8080 153 0.002 404 3f7a`,
      trust(format),
    );

    expect(event.principalIp).toBe(CLIENT);
    expect(claimOf(event)?.address).toBe(SENDERS_CLAIM);
    // Its upstream is never the client.
    expect(event.observables).not.toContain("10.244.1.15");
  });

  test("ingress-nginx's own upstreaminfo logs no header: its $remote_addr is the client", () => {
    const event: NormalizedSecurityEvent = parseOne(
      `${UNTRUSTED_HOST} - - [27/Nov/2026:10:00:05 +0000] "GET /download?file=../../etc/passwd HTTP/1.1" 404 153 "-" "curl/8.4.0" 532 0.002 [default-web-80] [] 10.244.1.15:8080 153 0.002 404 3f7a`,
      trust(known("ingress-nginx-upstreaminfo")),
    );

    expect(event.principalIp).toBe(UNTRUSTED_HOST);
    expect(userAgentOf(event)).toBe("curl/8.4.0");
  });

  test("nginx's realip module: $realip_remote_addr is the connection, its $remote_addr only a claim", () => {
    const format: string = `$realip_remote_addr $remote_addr "$request" $status "$http_x_forwarded_for"`;

    // Behind the load balancer, with the header: the walk names the client.
    expect(
      parseOne(
        `${LOAD_BALANCER} ${INNOCENT} "GET /download?file=../../etc/passwd HTTP/1.1" 404 "${CLIENT}"`,
        trust(format),
      ).principalIp,
    ).toBe(CLIENT);

    // No header: what realip worked out is a claim, never the client.
    const event: NormalizedSecurityEvent = parseOne(
      `${LOAD_BALANCER} ${INNOCENT} "GET /download?file=../../etc/passwd HTTP/1.1" 404 "-"`,
      trust(format),
    );

    expect(event.principalIp).toBe("");
    expect(claimOf(event)?.address).toBe(INNOCENT);
    expect(claimOf(event)?.from).toBe("remote_addr");
  });
});

/*
 * The fields a client controls - a header, the user agent - sit before and
 * after the forwarded address; they are never read as it, nor as the
 * connection's.
 */
describe("a field a client controls is never read as an address", () => {
  const FORMAT: string = `$remote_addr "$request" "$http_x_real_ip" "$http_x_forwarded_for" "$http_user_agent" "$http_cookie"`;

  function line(data: {
    realIp?: string;
    forwardedFor?: string;
    userAgent?: string;
    cookie?: string;
  }): string {
    return `${LOAD_BALANCER} "GET /download?file=../../etc/passwd HTTP/1.1" "${data.realIp || "-"}" "${data.forwardedFor || "-"}" "${data.userAgent || "curl"}" "${data.cookie || "-"}"`;
  }

  test("X-Real-IP before the header, a forged address in the user agent and the cookie after it", () => {
    const event: NormalizedSecurityEvent = parseOne(
      line({
        realIp: INNOCENT,
        forwardedFor: CLIENT,
        userAgent: `${INNOCENT}`,
        cookie: `ip=${INNOCENT}`,
      }),
      trust(FORMAT),
    );

    expect(event.principalIp).toBe(CLIENT);
    expect(event.observables).not.toContain(INNOCENT);
  });

  test("with no X-Forwarded-For, X-Real-IP is no client: the connection's own address", () => {
    const event: NormalizedSecurityEvent = parseOne(
      line({ realIp: INNOCENT }),
      trust(FORMAT),
    );

    expect(event.principalIp).toBe(LOAD_BALANCER);
    expect(event.observables).not.toContain(INNOCENT);
  });

  test("a format that logs only X-Real-IP reads no client from it", () => {
    const event: NormalizedSecurityEvent = parseOne(
      `${LOAD_BALANCER} "GET /download?file=../../etc/passwd HTTP/1.1" "${INNOCENT}"`,
      trust(`$remote_addr "$request" "$http_x_real_ip"`),
    );

    expect(event.principalIp).toBe(LOAD_BALANCER);
    expect(event.observables).not.toContain(INNOCENT);
  });

  test("nginx escapes a quote a client wrote as \\x22: it moves no field", () => {
    const event: NormalizedSecurityEvent = parseOne(
      timedLine(LOAD_BALANCER, CLIENT, `x\\x22 \\x22${INNOCENT}`),
      trust(TIMED),
    );

    expect(event.principalIp).toBe(CLIENT);
    expect(userAgentOf(event)).toBe(`x\\x22 \\x22${INNOCENT}`);
  });
});

/*
 * Express's morgan, and nginx with escape=none, write a quote a client sent
 * as it came. That adds a quote to the line, which then fits the format no
 * more: it is read as it always was, and a forgery in it is never the
 * client.
 */
describe("morgan's unescaped quotes", () => {
  test("a user agent that adds a field: the line is no line of the format, and the load balancer is its client", () => {
    const event: NormalizedSecurityEvent = parseOne(
      timedLine(LOAD_BALANCER, CLIENT, `x" "${INNOCENT}`),
      trust(TIMED),
    );

    expect(event.principalIp).toBe(LOAD_BALANCER);
    expect(event.observables).not.toContain(INNOCENT);
  });

  test("declared escape=none, the same", () => {
    const format: string = `log_format raw escape=none '$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" "$http_x_forwarded_for" $request_time';`;

    expect(
      parseOne(
        timedLine(LOAD_BALANCER, CLIENT, `x" "${INNOCENT}`),
        trust(format),
      ).principalIp,
    ).toBe(LOAD_BALANCER);
    // A line with nothing added is read by it.
    expect(parseOne(timedLine(), trust(format)).principalIp).toBe(CLIENT);
  });
});

describe("a line not in the format is read as before", () => {
  const MAIN_LINE: string = `${LOAD_BALANCER} - - [27/Nov/2026:10:00:05 +0000] "GET /download?file=../../etc/passwd HTTP/1.1" 404 153 "-" "curl/8.4.0" "${CLIENT}"`;

  test("a line of nginx's main format, with the switch on: its last field, as #10548 reads it", () => {
    expect(
      parseOne(MAIN_LINE, trust(TIMED, { readsSwitch: true })).principalIp,
    ).toBe(CLIENT);
  });

  test("the same with the switch off: its first field", () => {
    expect(
      parseOne(MAIN_LINE, trust(TIMED, { readsSwitch: false })).principalIp,
    ).toBe(LOAD_BALANCER);
  });

  test("a line cut to be read never says what it ended with: no line of the format", () => {
    const long: string = timedLine(
      LOAD_BALANCER,
      `${"1.2.3.4, ".repeat(MAX_TEXT_LINE_LENGTH / 9)}${CLIENT}`,
    );

    expect(long.length).toBeGreaterThan(MAX_TEXT_LINE_LENGTH);
    expect(parseOne(long, trust(TIMED)).principalIp).toBe(LOAD_BALANCER);
  });

  test("a JSON access log reads its own fields, format or none", () => {
    const event: NormalizedSecurityEvent = parseOne(
      JSON.stringify({
        remote_addr: LOAD_BALANCER,
        http_x_forwarded_for: CLIENT,
        request: "GET /download?file=../../etc/passwd HTTP/1.1",
        status: 404,
      }),
      trust(TIMED),
    );

    expect(event.principalIp).toBe(CLIENT);
  });
});

describe("readAccessLogByFormat", () => {
  test("a line in the format as the request it records", () => {
    const read: AccessLogRequest | null = readAccessLogByFormat(
      timedLine(),
      formatOf(TIMED),
    );

    expect(read).toEqual({
      clientIp: LOAD_BALANCER,
      method: "GET",
      target: "/download?file=../../etc/passwd",
      status: 404,
      userAgent: "curl/8.4.0",
      bodySize: 153,
      contentType: "",
      forwardedFor: `${SENDERS_CLAIM}, ${CLIENT}`,
    });
  });

  test("the method and the path from their own fields, when the format logs no request line", () => {
    expect(
      readAccessLogByFormat(
        `${LOAD_BALANCER} GET "/download?file=../../etc/passwd" 404 "${CLIENT}"`,
        formatOf(
          `$remote_addr $request_method "$request_uri" $status "$http_x_forwarded_for"`,
        ),
      ),
    ).toEqual(
      expect.objectContaining({
        method: "GET",
        target: "/download?file=../../etc/passwd",
        status: 404,
        forwardedFor: CLIENT,
      }),
    );
  });

  test("a request line whose method is none: no method, and no target guessed", () => {
    expect(
      readAccessLogByFormat(
        `${LOAD_BALANCER} - - [27/Nov/2026:10:00:05 +0000] "\\x16\\x03\\x01" 400 157 "-" "-" "-" 0.001`,
        formatOf(TIMED),
      ),
    ).toEqual(expect.objectContaining({ method: "", target: "", status: 400 }));
  });

  test("null for a line not in the format", () => {
    expect(
      readAccessLogByFormat("Failed password for root", formatOf(TIMED)),
    ).toBeNull();
  });
});

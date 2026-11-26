import { describe, expect, test } from "@jest/globals";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../../../Utils/NetworkTraffic/NetworkAddressBlock";
import {
  CLAIMED_FROM_X_FORWARDED_FOR,
  ClaimedClientAddress,
  ClientAddressTrust,
  NO_TRUSTED_PROXIES,
  TrustedProxies,
  readClaimedClientAddress,
  readClientAddressTrust,
  toTrustedProxies,
} from "../../../../Utils/SecurityEvent/ClientAddressTrust";
import WebAttackLogParser, {
  AccessLogRequest,
  COMBINED_FIELDS_WITH_FORWARDED_FOR,
  readCombinedLogTrailingFields,
  readCommonLogFormat,
  readTrailingForwardedFor,
} from "../../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import { MAX_TEXT_LINE_LENGTH } from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogLine";
import { readHiddenClientAddress } from "../../../../Utils/SecurityEvent/ScrubbedAddress";
import { logLine } from "./LogParserFixtures";

/*
 * THE X-FORWARDED-FOR A COMBINED LOG LINE ENDS WITH (#10548).
 *
 * Behind a load balancer, nginx's own main format, and many an Apache
 * format, log the forwarded address after the user agent:
 *
 *   10.0.0.5 - - [20/Nov/2026:10:00:05 +0000] "GET /download?file=../../etc/passwd HTTP/1.1" 404 153 "-" "curl/8.4.0" "198.51.100.9, 203.0.113.7"
 *
 * Every attack in such a log was blamed on the load balancer's private
 * address, its first field, and the user agent read as the forwarded
 * header. Now, when the project says its access logs end with
 * X-Forwarded-For, the field is read like any forwarded-for header: only
 * behind a proxy the project trusts, and only its rightmost hop no trusted
 * proxy wrote is verified.
 *
 * A line cannot say what its fields are. So nothing is read unless the
 * project says so - a server that does not escape quotes lets a request's
 * user agent add a field of its own - and a field is read only when it can
 * be nothing but an X-Forwarded-For: these suites forge headers through
 * hosts that must not be trusted, and feed it the custom formats whose last
 * field is something else.
 */

// The load balancer in front of the web server, and the hops it forwarded.
const LOAD_BALANCER: string = "10.0.0.5";
const SENDERS_CLAIM: string = "198.51.100.9";
const CLIENT: string = "203.0.113.7";
// An address an attacker wants blamed: someone else's.
const INNOCENT: string = "192.0.2.44";
// A public address the project does not trust: whatever runs there.
const UNTRUSTED_HOST: string = "203.0.113.50";

// The project says its access logs end with X-Forwarded-For.
const SAYS_SO: TrustedProxies = {
  blocks: [],
  readsAccessLogForwardedFor: true,
};

function blocks(...ranges: Array<string>): Array<NetworkAddressBlock> {
  return ranges.map((range: string): NetworkAddressBlock => {
    return NetworkAddressBlockUtil.parse(range)!;
  });
}

// A combined line from `first`, its request a path traversal, ending with `fields` after the size.
function combinedLine(data: {
  first?: string;
  fields?: Array<string>;
  size?: string;
  prefix?: string;
}): string {
  const fields: Array<string> = data.fields || [
    "-",
    "curl/8.4.0",
    `${SENDERS_CLAIM}, ${CLIENT}`,
  ];

  return `${data.prefix || ""}${data.first || LOAD_BALANCER} - - [20/Nov/2026:10:00:05 +0000] "GET /download?file=../../etc/passwd HTTP/1.1" 404 ${data.size || "153"}${fields
    .map((field: string): string => {
      return ` "${field}"`;
    })
    .join("")}`;
}

// The issue's own line.
const ISSUE_LINE: string = combinedLine({});

// Read with the project's trust as given; null for none at all, as Check a log line reads a line.
function parseOne(
  body: string,
  trustedProxies: TrustedProxies | null = SAYS_SO,
): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = WebAttackLogParser.parse({
    ...logLine(body),
    trustedProxies: trustedProxies || undefined,
  });

  expect(events).toHaveLength(1);

  return events[0]!;
}

function trustOf(event: NormalizedSecurityEvent): ClientAddressTrust | null {
  return readClientAddressTrust(event);
}

function claimOf(event: NormalizedSecurityEvent): ClaimedClientAddress | null {
  return readClaimedClientAddress(event);
}

function userAgentOf(event: NormalizedSecurityEvent): unknown {
  return (event.attributes as Record<string, unknown>)[
    SECURITY_REQUEST_ATTRIBUTES.userAgent
  ];
}

// Read as it was before the field was read: the first field is the client.
function expectFirstFieldIsTheClient(
  event: NormalizedSecurityEvent,
  first: string = LOAD_BALANCER,
): void {
  expect(event.principalIp).toBe(first);
  expect(trustOf(event)).toBe(ClientAddressTrust.Peer);
  expect(claimOf(event)).toBeNull();
}

describe("the issue's line, when the project says its access logs end with X-Forwarded-For", () => {
  test("names the client the load balancer forwarded, verified, and keeps the sender's own claim", () => {
    const event: NormalizedSecurityEvent = parseOne(ISSUE_LINE);

    expect(event.principalIp).toBe(CLIENT);
    expect(trustOf(event)).toBe(ClientAddressTrust.TrustedProxy);
    expect(claimOf(event)).toEqual({
      address: SENDERS_CLAIM,
      scrubbedKind: null,
      from: CLAIMED_FROM_X_FORWARDED_FOR,
      isOnlyAddress: false,
    });
  });

  test("the user agent is the field before it, not the forwarded header", () => {
    expect(userAgentOf(parseOne(ISSUE_LINE))).toBe("curl/8.4.0");
  });

  test("the load balancer's address is no observable of the attack, and the client is", () => {
    const event: NormalizedSecurityEvent = parseOne(ISSUE_LINE);

    expect(event.observables).toContain(CLIENT);
    expect(event.observables).not.toContain(LOAD_BALANCER);
    expect(event.observables).not.toContain(SENDERS_CLAIM);
  });

  test("a client that came straight to the load balancer: one hop, verified, no claim", () => {
    const event: NormalizedSecurityEvent = parseOne(
      combinedLine({ fields: ["-", "curl/8.4.0", CLIENT] }),
    );

    expect(event.principalIp).toBe(CLIENT);
    expect(trustOf(event)).toBe(ClientAddressTrust.TrustedProxy);
    expect(claimOf(event)).toBeNull();
  });

  test('"-" (no header): the first field is the client, and the user agent is still read right', () => {
    const event: NormalizedSecurityEvent = parseOne(
      combinedLine({ fields: ["-", "curl/8.4.0", "-"] }),
    );

    expectFirstFieldIsTheClient(event);
    expect(userAgentOf(event)).toBe("curl/8.4.0");
  });
});

describe("when the project has not said so, nothing is read from the field", () => {
  test("no trusted proxies at all (Check a log line, a test): the load balancer, as before", () => {
    expectFirstFieldIsTheClient(parseOne(ISSUE_LINE, null));
    expectFirstFieldIsTheClient(parseOne(ISSUE_LINE, NO_TRUSTED_PROXIES));
  });

  test("Trusted Proxies listed, but the format not said", () => {
    const listed: TrustedProxies = toTrustedProxies("104.16.0.0/13");

    expectFirstFieldIsTheClient(parseOne(ISSUE_LINE, listed));
    expectFirstFieldIsTheClient(
      parseOne(ISSUE_LINE, { ...listed, readsAccessLogForwardedFor: false }),
    );
  });

  test("the user agent is the field before it all the same", () => {
    expect(userAgentOf(parseOne(ISSUE_LINE, null))).toBe("curl/8.4.0");
  });

  test("a plain combined line whose user agent a server did not escape adds no field the project did not say it has", () => {
    /*
     * Express's morgan writes the user agent as sent: a user agent of
     * `x" "192.0.2.44` makes a plain combined line end with what reads as
     * an X-Forwarded-For. Unless the project says its logs end with one,
     * it is the line's user agent, never a forwarded client.
     */
    const event: NormalizedSecurityEvent = parseOne(
      combinedLine({ fields: ["-", "x", INNOCENT] }),
      toTrustedProxies(""),
    );

    expectFirstFieldIsTheClient(event);
    expect(event.observables).not.toContain(INNOCENT);
  });
});

describe("only a proxy the project trusts in the first field makes the field worth reading", () => {
  test("a public first field no proxy of the project's: that address, as the peer (the issue's second test)", () => {
    const event: NormalizedSecurityEvent = parseOne(
      combinedLine({ first: UNTRUSTED_HOST }),
    );

    expectFirstFieldIsTheClient(event, UNTRUSTED_HOST);
    expect(event.observables).not.toContain(CLIENT);
    expect(event.observables).not.toContain(SENDERS_CLAIM);
  });

  test("a forged header through a host that must not be trusted names nobody but the host", () => {
    for (const forged of [
      INNOCENT,
      `${INNOCENT}, ${CLIENT}`,
      `${INNOCENT}, 10.0.0.9`,
      `10.0.0.9, ${INNOCENT}`,
      "127.0.0.1",
      "2001:db8::44",
    ]) {
      const event: NormalizedSecurityEvent = parseOne(
        combinedLine({
          first: UNTRUSTED_HOST,
          fields: ["-", "sqlmap/1.7", forged],
        }),
      );

      expectFirstFieldIsTheClient(event, UNTRUSTED_HOST);
      expect(event.observables).not.toContain(INNOCENT);
    }
  });

  test("a probe, an app server or a node that is no listed proxy is no proxy: whatever runs there names no client", () => {
    // OneUptime trusts only what the project lists, its edges and its load balancers: none of these.
    const proxies: TrustedProxies = {
      ...toTrustedProxies("198.18.0.0/15"),
      readsAccessLogForwardedFor: true,
    };

    for (const host of ["34.120.1.2", "52.95.110.1", "2600:1f18::10"]) {
      const event: NormalizedSecurityEvent = parseOne(
        combinedLine({ first: host, fields: ["-", "curl/8.4.0", INNOCENT] }),
        proxies,
      );

      expectFirstFieldIsTheClient(event, host);
    }
  });

  test("a public proxy the project lists under Trusted Proxies: read", () => {
    const event: NormalizedSecurityEvent = parseOne(
      combinedLine({ first: "198.18.0.7" }),
      {
        ...toTrustedProxies("198.18.0.0/15"),
        readsAccessLogForwardedFor: true,
      },
    );

    expect(event.principalIp).toBe(CLIENT);
    expect(trustOf(event)).toBe(ClientAddressTrust.TrustedProxy);
  });

  test("an edge the project connected, or one of its own load balancers, as blocks of the trust: read", () => {
    const proxies: TrustedProxies = {
      blocks: blocks("104.16.0.0/13", "34.120.1.2/32"),
      readsAccessLogForwardedFor: true,
    };

    for (const first of ["104.16.1.1", "34.120.1.2"]) {
      const event: NormalizedSecurityEvent = parseOne(
        combinedLine({ first }),
        proxies,
      );

      expect(event.principalIp).toBe(CLIENT);
      expect(trustOf(event)).toBe(ClientAddressTrust.TrustedProxy);
    }
  });

  test("a first field a scrub rule hid cannot be told to be a proxy: the hidden peer, as before", () => {
    const event: NormalizedSecurityEvent = parseOne(
      combinedLine({ first: "[REDACTED]" }),
    );

    expect(event.principalIp).toBe("");
    expect(readHiddenClientAddress(event)).not.toBeNull();
    expect(event.observables).not.toContain(CLIENT);
    expect(claimOf(event)).toBeNull();
  });

  test("an IPv4 address written as IPv6 in the first field is the IPv4 one", () => {
    const event: NormalizedSecurityEvent = parseOne(
      combinedLine({ first: "::ffff:10.0.0.5" }),
    );

    expect(event.principalIp).toBe(CLIENT);
    expect(trustOf(event)).toBe(ClientAddressTrust.TrustedProxy);
  });

  test("behind a syslog prefix, the first field is the address before ' - '", () => {
    const event: NormalizedSecurityEvent = parseOne(
      combinedLine({ prefix: "Nov 20 10:00:05 lb-1 nginx: " }),
    );

    expect(event.principalIp).toBe(CLIENT);
    expect(trustOf(event)).toBe(ClientAddressTrust.TrustedProxy);
  });
});

describe("the rightmost hop no trusted proxy wrote is the client", () => {
  test("a sender who writes its own header is blamed for its own connection, not the address it wrote", () => {
    // The load balancer appends the address it took the connection from: the attacker's.
    const event: NormalizedSecurityEvent = parseOne(
      combinedLine({
        fields: ["-", "sqlmap/1.7", `${INNOCENT}, 198.51.100.66`],
      }),
    );

    expect(event.principalIp).toBe("198.51.100.66");
    expect(trustOf(event)).toBe(ClientAddressTrust.TrustedProxy);
    expect(claimOf(event)?.address).toBe(INNOCENT);
    expect(event.observables).not.toContain(INNOCENT);
  });

  test("trusted hops on the right are walked past, a private one and a listed edge alike", () => {
    const event: NormalizedSecurityEvent = parseOne(
      combinedLine({
        fields: [
          "-",
          "curl/8.4.0",
          `${INNOCENT}, ${CLIENT}, 10.0.0.9, 104.16.1.1`,
        ],
      }),
      { blocks: blocks("104.16.0.0/13"), readsAccessLogForwardedFor: true },
    );

    expect(event.principalIp).toBe(CLIENT);
    expect(claimOf(event)?.address).toBe(INNOCENT);
  });

  test("a trusted hop the sender wrote on the left never verifies what is left of it", () => {
    const event: NormalizedSecurityEvent = parseOne(
      combinedLine({
        fields: ["-", "curl/8.4.0", `${INNOCENT}, 10.0.0.9, 198.51.100.66`],
      }),
    );

    expect(event.principalIp).toBe("198.51.100.66");
  });

  test("every hop trusted: the leftmost is a host inside the network", () => {
    const event: NormalizedSecurityEvent = parseOne(
      combinedLine({ fields: ["-", "curl/8.4.0", "10.0.0.7, 10.0.0.8"] }),
    );

    expect(event.principalIp).toBe("10.0.0.7");
    expect(trustOf(event)).toBe(ClientAddressTrust.TrustedProxy);
  });

  test("hops written with no space after their commas, or with an empty hop the sender left", () => {
    for (const header of [
      `${SENDERS_CLAIM},${CLIENT}`,
      `${SENDERS_CLAIM},,${CLIENT}`,
      `garbage ' or 1=1--, ${CLIENT}`,
    ]) {
      const event: NormalizedSecurityEvent = parseOne(
        combinedLine({ fields: ["-", "curl/8.4.0", header] }),
      );

      expect(event.principalIp).toBe(CLIENT);
      expect(trustOf(event)).toBe(ClientAddressTrust.TrustedProxy);
    }
  });

  test("a sender who pads the header cannot push the proxy's hops out of reach, and makes no claim", () => {
    const padding: string = Array.from({ length: 900 }, (): string => {
      return INNOCENT;
    }).join(", ");
    const event: NormalizedSecurityEvent = parseOne(
      combinedLine({
        fields: ["-", "curl/8.4.0", `${padding}, ${CLIENT}`],
      }),
    );

    expect(event.principalIp).toBe(CLIENT);
    expect(claimOf(event)).toBeNull();
  });
});

describe("IPv6", () => {
  test("a private IPv6 load balancer forwarding IPv6 hops", () => {
    const event: NormalizedSecurityEvent = parseOne(
      combinedLine({
        first: "fd00::5",
        fields: ["-", "curl/8.4.0", "2001:db8::44, 2001:db8::7"],
      }),
    );

    expect(event.principalIp).toBe("2001:db8::7");
    expect(trustOf(event)).toBe(ClientAddressTrust.TrustedProxy);
    expect(claimOf(event)?.address).toBe("2001:db8::44");
  });

  test("a bracketed IPv6 hop with no port is read; with a port it is no X-Forwarded-For", () => {
    const bracketed: NormalizedSecurityEvent = parseOne(
      combinedLine({ fields: ["-", "curl/8.4.0", "[2001:db8::7]"] }),
    );

    expect(bracketed.principalIp).toBe("2001:db8::7");

    expectFirstFieldIsTheClient(
      parseOne(
        combinedLine({ fields: ["-", "curl/8.4.0", "[2001:db8::7]:443"] }),
      ),
    );
  });

  test("an IPv4 load balancer forwarding an IPv6 client, and an IPv6 public first field that is no proxy", () => {
    expect(
      parseOne(combinedLine({ fields: ["-", "curl/8.4.0", "2001:db8::7"] }))
        .principalIp,
    ).toBe("2001:db8::7");

    expectFirstFieldIsTheClient(
      parseOne(
        combinedLine({
          first: "2001:db8::50",
          fields: ["-", "curl/8.4.0", INNOCENT],
        }),
      ),
      "2001:db8::50",
    );
  });
});

describe("a custom format whose last quoted field is no X-Forwarded-For is never read as one", () => {
  const notForwardedFor: Array<{ name: string; field: string }> = [
    { name: "$request_time", field: "0.123" },
    { name: "$upstream_response_time with retries", field: "0.050, 0.100" },
    { name: "$upstream_addr", field: "10.0.0.7:8080" },
    {
      name: "$upstream_addr with retries",
      field: "10.0.0.7:8080, 10.0.0.8:8080",
    },
    { name: "$upstream_addr on a public upstream", field: "203.0.113.80:443" },
    { name: "a unix socket upstream", field: "unix:/run/app.sock" },
    { name: "$host", field: "shop.example.com" },
    { name: "$http_host with its port", field: "203.0.113.10:8080" },
    { name: "$http_cookie", field: "session=abc; theme=dark" },
    { name: "$request_id", field: "8f14e45fceea167a5a36dedd4bea2543" },
    { name: "$status again", field: "404" },
    { name: "$ssl_protocol", field: "TLSv1.3" },
    { name: "$upstream_cache_status", field: "MISS" },
    { name: "a URL", field: "https://shop.example.com/cart" },
    {
      name: "Azure Application Gateway's hop and port",
      field: "203.0.113.7:51234",
    },
    { name: "a list whose last hop names nobody", field: `${CLIENT}, unknown` },
    { name: "a list that ends with a comma", field: `${CLIENT},` },
    {
      name: "addresses apart by spaces, no commas",
      field: `${SENDERS_CLAIM} ${CLIENT}`,
    },
    { name: "an empty field", field: "" },
  ];

  for (const format of notForwardedFor) {
    test(`a format that ends with ${format.name}`, () => {
      const event: NormalizedSecurityEvent = parseOne(
        combinedLine({ fields: ["-", "curl/8.4.0", format.field] }),
      );

      expectFirstFieldIsTheClient(event);
    });
  }

  test("X-Forwarded-For with a field after it: one field too many, nothing read", () => {
    expectFirstFieldIsTheClient(
      parseOne(
        combinedLine({
          fields: ["-", "curl/8.4.0", `${SENDERS_CLAIM}, ${CLIENT}`, "0.123"],
        }),
      ),
    );
  });

  test("X-Forwarded-For followed by unquoted fields: not the line's end, nothing read", () => {
    expectFirstFieldIsTheClient(parseOne(`${combinedLine({})} 0.123 0.002`));
  });

  test("ingress-nginx's own format: its user agent read as before, no client from its upstream", () => {
    const line: string = `${LOAD_BALANCER} - - [20/Nov/2026:10:00:05 +0000] "GET /download?file=../../etc/passwd HTTP/1.1" 404 153 "-" "curl/8.4.0" 345 0.002 [default-web-80] [] 10.0.0.7:8080 615 0.002 404 3f7a`;
    const event: NormalizedSecurityEvent = parseOne(line);

    expectFirstFieldIsTheClient(event);
    expect(userAgentOf(event)).toBe("curl/8.4.0");
  });

  test("Traefik's common log format, which ends with its router, its server and a duration", () => {
    const line: string = `${LOAD_BALANCER} - - [20/Nov/2026:10:00:05 +0000] "GET /download?file=../../etc/passwd HTTP/1.1" 404 153 "-" "curl/8.4.0" 1 "web@docker" "http://10.0.0.7:80" 2ms`;

    expectFirstFieldIsTheClient(parseOne(line));
  });

  test("Envoy's default format, which starts with its time and ends with its upstream host", () => {
    const line: string = `[2026-11-20T10:00:05.000Z] "GET /download?file=../../etc/passwd HTTP/1.1" 404 NR 0 153 1 - "${SENDERS_CLAIM}, ${CLIENT}" "curl/8.4.0" "3f7a" "shop.example.com" "10.0.0.7:8080"`;
    const event: NormalizedSecurityEvent = parseOne(line);

    expect(event.principalIp).not.toBe(CLIENT);
    expect(event.observables).not.toContain(CLIENT);
  });

  test("two spaces between fields, a status that is no status, a size that is no size: no shape that is read", () => {
    const lines: Array<string> = [
      `${LOAD_BALANCER} - - [20/Nov/2026:10:00:05 +0000] "GET /download?file=../../etc/passwd HTTP/1.1" 404 153 "-"  "curl/8.4.0" "${CLIENT}"`,
      `${LOAD_BALANCER} - - [20/Nov/2026:10:00:05 +0000] "GET /download?file=../../etc/passwd HTTP/1.1" 4040 153 "-" "curl/8.4.0" "${CLIENT}"`,
      `${LOAD_BALANCER} - - [20/Nov/2026:10:00:05 +0000] "GET /download?file=../../etc/passwd HTTP/1.1" 404 1k "-" "curl/8.4.0" "${CLIENT}"`,
      `${LOAD_BALANCER} - - [20/Nov/2026:10:00:05 +0000] "GET /download?file=../../etc/passwd HTTP/1.1" 404 153 "-" "curl/8.4.0" "${CLIENT}`,
    ];

    for (const line of lines) {
      const event: NormalizedSecurityEvent = parseOne(line);

      expect(event.principalIp).toBe(LOAD_BALANCER);
      expect(trustOf(event)).toBe(ClientAddressTrust.Peer);
    }
  });

  test("Apache's size of nothing (-) and spaces after the last field are the combined shape", () => {
    expect(parseOne(combinedLine({ size: "-" })).principalIp).toBe(CLIENT);
    expect(parseOne(`${ISSUE_LINE}  `).principalIp).toBe(CLIENT);
  });
});

describe("what a request wrote never ends a field early", () => {
  test("a user agent a server did not escape, with a real X-Forwarded-For after it: one field too many, nothing read", () => {
    // The format said: it ends with X-Forwarded-For, so the extra field gives the forgery away.
    const event: NormalizedSecurityEvent = parseOne(
      combinedLine({ fields: ["-", "x", INNOCENT, "198.51.100.66"] }),
    );

    expectFirstFieldIsTheClient(event);
    expect(event.observables).not.toContain(INNOCENT);
  });

  test("a forged field in the referrer: one field too many, nothing read", () => {
    expectFirstFieldIsTheClient(
      parseOne(
        combinedLine({ fields: ["x", "y", "curl/8.4.0", "198.51.100.66"] }),
      ),
    );
  });

  test("Apache escapes the quotes a user agent carries: they are inside its field, and the real header is read", () => {
    // A user agent of `x" "192.0.2.44`, as Apache writes it.
    const event: NormalizedSecurityEvent = parseOne(
      combinedLine({
        fields: ["-", `x\\" \\"${INNOCENT}`, "198.51.100.66"],
      }),
    );

    expect(event.principalIp).toBe("198.51.100.66");
    expect(event.observables).not.toContain(INNOCENT);
    expect(userAgentOf(event)).toBe(`x\\" \\"${INNOCENT}`);
  });

  test("Apache's escaped quotes in a plain combined line add no field", () => {
    expectFirstFieldIsTheClient(
      parseOne(combinedLine({ fields: ["-", `x\\" \\"${INNOCENT}`] })),
    );
  });

  test("an escaped backslash before a closing quote ends its field where Apache meant it to", () => {
    const event: NormalizedSecurityEvent = parseOne(
      combinedLine({ fields: ["-", "agent\\\\", CLIENT] }),
    );

    expect(event.principalIp).toBe(CLIENT);
    expect(userAgentOf(event)).toBe("agent\\\\");
  });

  test("nginx writes a quote as \\x22: no bare quote, no extra field", () => {
    expectFirstFieldIsTheClient(
      parseOne(combinedLine({ fields: ["-", `x\\x22 \\x22${INNOCENT}`] })),
    );

    expect(
      parseOne(
        combinedLine({
          fields: ["-", `x\\x22 \\x22${INNOCENT}`, "198.51.100.66"],
        }),
      ).principalIp,
    ).toBe("198.51.100.66");
  });

  test("a line cut to be read never says what it ended with, even when the cut falls right after a field", () => {
    /*
     * A request padded so the line is cut right after a third field the
     * sender forged, with the real header after the cut: read whole it is
     * a field too many, and cut it must not become the right shape.
     */
    const start: string = `${LOAD_BALANCER} - - [20/Nov/2026:10:00:05 +0000] "GET /download?file=../../etc/passwd&pad=`;
    const end: string = ` HTTP/1.1" 404 153 "-" "x" "${INNOCENT}"`;
    const head: string = `${start}${"a".repeat(
      MAX_TEXT_LINE_LENGTH - start.length - end.length,
    )}${end}`;

    expect(head).toHaveLength(MAX_TEXT_LINE_LENGTH);

    const event: NormalizedSecurityEvent = parseOne(`${head} "198.51.100.66"`);

    expect(event.principalIp).toBe(LOAD_BALANCER);
    expect(event.observables).not.toContain(INNOCENT);
  });
});

describe("what a scrub rule left", () => {
  test("in the field's last hop: the client, hidden, and named as such", () => {
    const event: NormalizedSecurityEvent = parseOne(
      combinedLine({
        fields: ["-", "curl/8.4.0", `${SENDERS_CLAIM}, [REDACTED]`],
      }),
    );

    expect(event.principalIp).toBe("");
    expect(readHiddenClientAddress(event)).not.toBeNull();
    expect(trustOf(event)).toBe(ClientAddressTrust.TrustedProxy);
  });

  test("a Hash rule's token as the last hop is read as the hidden client", () => {
    const event: NormalizedSecurityEvent = parseOne(
      combinedLine({
        fields: ["-", "curl/8.4.0", "[HASHED:3f9a1c0be27d4e5a]"],
      }),
    );

    expect(event.principalIp).toBe("");
    expect(readHiddenClientAddress(event)).not.toBeNull();
  });
});

describe("a plain combined or common log line keeps its client as today (the issue's third test)", () => {
  test("a combined line with no field after the user agent", () => {
    const event: NormalizedSecurityEvent = parseOne(
      combinedLine({ fields: ["-", "curl/8.4.0"] }),
    );

    expectFirstFieldIsTheClient(event);
    expect(userAgentOf(event)).toBe("curl/8.4.0");
  });

  test("a common log line, with nothing after its size", () => {
    expectFirstFieldIsTheClient(parseOne(combinedLine({ fields: [] })));
  });

  test("a public client field with nothing forwarded is the client, as it always was", () => {
    expectFirstFieldIsTheClient(
      parseOne(
        combinedLine({ first: UNTRUSTED_HOST, fields: ["-", "curl/8.4.0"] }),
      ),
      UNTRUSTED_HOST,
    );
  });

  test("a JSON access log reads its own X-Forwarded-For field, as before", () => {
    const event: NormalizedSecurityEvent = parseOne(
      JSON.stringify({
        remote_addr: LOAD_BALANCER,
        request: "GET /download?file=../../etc/passwd HTTP/1.1",
        status: 404,
        http_x_forwarded_for: `${SENDERS_CLAIM}, ${CLIENT}`,
      }),
      NO_TRUSTED_PROXIES,
    );

    expect(event.principalIp).toBe(CLIENT);
    expect(trustOf(event)).toBe(ClientAddressTrust.TrustedProxy);
  });
});

describe("readCombinedLogTrailingFields", () => {
  test("the fields after the status and the size, in order", () => {
    expect(readCombinedLogTrailingFields(ISSUE_LINE)).toEqual([
      "-",
      "curl/8.4.0",
      `${SENDERS_CLAIM}, ${CLIENT}`,
    ]);
    expect(
      readCombinedLogTrailingFields(combinedLine({ fields: ["-", "a"] })),
    ).toEqual(["-", "a"]);
    expect(readCombinedLogTrailingFields(combinedLine({ fields: [] }))).toEqual(
      [],
    );
  });

  test("null for a line with no request, an unquoted field, or a field that never closes", () => {
    expect(readCombinedLogTrailingFields("INFO order 1234 shipped")).toBeNull();
    expect(readCombinedLogTrailingFields(`${ISSUE_LINE} 0.1`)).toBeNull();
    expect(readCombinedLogTrailingFields(`${ISSUE_LINE} "open`)).toBeNull();
    expect(
      readCombinedLogTrailingFields('10.0.0.5 - - [x] "GET / HTTP/1.1"'),
    ).toBeNull();
  });

  test("a line of thousands of empty fields is no shape that is read, and costs no more than one pass", () => {
    const line: string = combinedLine({
      fields: Array.from({ length: 4000 }, (): string => {
        return "";
      }),
    });

    expect(readCombinedLogTrailingFields(line)).toBeNull();
  });

  test(`a line that ends with an X-Forwarded-For has ${COMBINED_FIELDS_WITH_FORWARDED_FOR} fields after its size`, () => {
    expect(COMBINED_FIELDS_WITH_FORWARDED_FOR).toBe(3);
  });
});

describe("readTrailingForwardedFor", () => {
  test('"-" is no header; a list of hops ending with an address is one', () => {
    expect(readTrailingForwardedFor("-")).toBe("");
    expect(readTrailingForwardedFor(` ${SENDERS_CLAIM}, ${CLIENT} `)).toBe(
      `${SENDERS_CLAIM}, ${CLIENT}`,
    );
    expect(readTrailingForwardedFor("2001:db8::7")).toBe("2001:db8::7");
    expect(readTrailingForwardedFor("::ffff:203.0.113.7")).toBe(
      "::ffff:203.0.113.7",
    );
    expect(readTrailingForwardedFor("[2001:db8::7]")).toBe("[2001:db8::7]");
    expect(readTrailingForwardedFor("[REDACTED]")).toBe("[REDACTED]");
  });

  test("anything else is null", () => {
    for (const field of [
      "",
      " ",
      "0.123",
      "10.0.0.7:8080",
      "[2001:db8::7]:443",
      "unknown",
      `${CLIENT}, unknown`,
      "shop.example.com",
      "999.1.1.1",
      "1.2.3",
      "fe80::1%eth0, 1.2.3",
    ]) {
      expect(readTrailingForwardedFor(field)).toBeNull();
    }
  });
});

describe("readCommonLogFormat keeps the field for the client reading to decide", () => {
  test("the issue's line: the user agent before it, the header as written", () => {
    expect(readCommonLogFormat(ISSUE_LINE)).toEqual({
      clientIp: LOAD_BALANCER,
      method: "GET",
      target: "/download?file=../../etc/passwd",
      status: 404,
      // The body's size, as the line writes it after the status (#10912).
      bodySize: 153,
      userAgent: "curl/8.4.0",
      trailingForwardedFor: `${SENDERS_CLAIM}, ${CLIENT}`,
    });
  });

  test("a line cut to be read, or a field that is no header, keeps none", () => {
    const cut: AccessLogRequest | null = readCommonLogFormat(ISSUE_LINE, {
      isCut: true,
    });

    expect(cut?.trailingForwardedFor).toBeUndefined();
    expect(
      readCommonLogFormat(combinedLine({ fields: ["-", "curl/8.4.0", "0.1"] }))
        ?.trailingForwardedFor,
    ).toBeUndefined();
    expect(
      readCommonLogFormat(combinedLine({ fields: ["-", "curl/8.4.0", "-"] }))
        ?.trailingForwardedFor,
    ).toBeUndefined();
  });
});

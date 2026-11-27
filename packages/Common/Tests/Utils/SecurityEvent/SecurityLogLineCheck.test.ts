import { describe, expect, test } from "@jest/globals";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import SecurityLogFormat, {
  SECURITY_LOG_FORMATS,
  SECURITY_LOG_FORMAT_ATTRIBUTE,
  SecurityLogFormatDefinition,
  getSecurityLogFormatDefinition,
} from "../../../Types/SecurityEvent/SecurityLogFormat";
import {
  MAX_CHECKED_LINES,
  MAX_CHECKED_TEXT_LENGTH,
  MAX_SHOWN_EVENTS,
  NO_CHECKED_EVENTS,
  SECURITY_LOG_LINE_CHECK_PATH,
  SecurityLogLineCheckResult,
  checkedEventToJSON,
  readCheckedEvent,
  readSecurityLogLineCheckResult,
  securityLogLineCheckResultToJSON,
  splitPastedLogLines,
} from "../../../Types/SecurityEvent/SecurityLogLineCheck";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../../Utils/NetworkTraffic/NetworkAddressBlock";
import {
  ClientAddressTrust,
  MAX_FORWARDED_BY,
  readClaimedClientAddress,
  readClientAddressTrust,
  readForwardedBy,
} from "../../../Utils/SecurityEvent/ClientAddressTrust";
import SecurityLogParser from "../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import { checkSecurityLogLines } from "../../../Utils/SecurityEvent/SecurityLogLineCheck";
import {
  judgeSensitiveFileAnswers,
  keepSensitiveFileOutcomes,
} from "../../../Utils/SecurityEvent/SensitiveFileAnswers";
import {
  NO_TRUSTED_PROXY_SOURCES,
  TrustedProxySource,
  TrustedProxySources,
  findTrustedProxySource,
  trustedProxiesOf,
} from "../../../Utils/SecurityEvent/TrustedProxySources";

/*
 * CHECK A LOG LINE NAMES THE CLIENT AS THE SCANS DO (#11046).
 *
 * The check used to run in the browser, with no trust at all, so a line
 * written behind a proxy previewed with the proxy as its Principal IP,
 * while the event the scan stored named the client the proxy forwarded.
 * Now the server reads a paste with the project's trust, made from the
 * same sources a scan's is (trustedProxiesOf), and these suites hold the
 * reading: the issue's line, a listed public proxy, an edge, the project's
 * own load balancers and Google's front ends, each with why it is trusted,
 * and a forged X-Forwarded-For from a first field nobody trusts, which
 * keeps the first field.
 */

const NOW: Date = new Date("2026-11-27T12:00:00.000Z");

// The proxy in front of the web server, and the client it forwarded.
const PRIVATE_PROXY: string = "10.0.0.5";
const CLIENT: string = "198.51.100.7";
// An address an attacker wants blamed: someone else's.
const INNOCENT: string = "192.0.2.44";
// Public proxies, each trusted for one reason.
const LISTED_PROXY: string = "203.0.113.10";
const CLOUDFLARE_ADDRESS: string = "104.16.1.1";
const OWN_ALB: string = "52.1.2.3";
const GOOGLE_FRONT_END: string = "35.191.7.8";
const GOOGLE_LB: string = "34.120.1.2";
// A public address the project does not trust: whatever runs there.
const UNTRUSTED_HOST: string = "203.0.113.50";

function blocks(...ranges: Array<string>): Array<NetworkAddressBlock> {
  return ranges.map((range: string): NetworkAddressBlock => {
    return NetworkAddressBlockUtil.parse(range)!;
  });
}

function sources(data: Partial<TrustedProxySources> = {}): TrustedProxySources {
  return { ...NO_TRUSTED_PROXY_SOURCES, ...data };
}

// A project whose access logs end with X-Forwarded-For, trusting what `data` adds.
function sayingSo(
  data: Partial<TrustedProxySources> = {},
): TrustedProxySources {
  return sources({ readsAccessLogForwardedFor: true, ...data });
}

// The issue's own line: a SQL injection, written behind `first`, forwarded for `forwardedFor`.
function issueLine(
  first: string = PRIVATE_PROXY,
  forwardedFor: string = CLIENT,
): string {
  return `${first} - - [10/Oct/2026:13:55:36 +0000] "GET /?id=1' OR '1'='1 HTTP/1.1" 200 512 "-" "curl/8.0" "${forwardedFor}"`;
}

function check(
  text: string,
  trust: TrustedProxySources = NO_TRUSTED_PROXY_SOURCES,
): SecurityLogLineCheckResult {
  return checkSecurityLogLines({ text, sources: trust, now: NOW });
}

function onlyEvent(
  result: SecurityLogLineCheckResult,
): NormalizedSecurityEvent {
  expect(result.events).toHaveLength(1);
  return result.events[0]!;
}

function formatOf(event: NormalizedSecurityEvent): unknown {
  return event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE];
}

function definition(format: SecurityLogFormat): SecurityLogFormatDefinition {
  return getSecurityLogFormatDefinition(format)!;
}

describe("the route and the limits", () => {
  test("is asked at its own path, and reads a paste's first lines only", () => {
    expect(SECURITY_LOG_LINE_CHECK_PATH).toBe("/security-log-lines/check");
    expect(MAX_CHECKED_LINES).toBe(20);
    expect(MAX_SHOWN_EVENTS).toBe(5);
    expect(MAX_CHECKED_TEXT_LENGTH).toBe(300 * 1024);
  });
});

describe("the lines of a paste", () => {
  test("a JSON record pasted across lines is one record; other lines are read one by one", () => {
    const pretty: string = JSON.stringify(
      JSON.parse(definition(SecurityLogFormat.AwsCloudTrail).example),
      null,
      2,
    );

    expect(splitPastedLogLines(pretty)).toHaveLength(1);
    expect(formatOf(check(pretty).events[0]!)).toBe(
      SecurityLogFormat.AwsCloudTrail,
    );

    const two: SecurityLogLineCheckResult = check(
      `${definition(SecurityLogFormat.Cef).example}\n\n${definition(SecurityLogFormat.SshSignIn).example}\n`,
    );

    expect(two.linesRead).toBe(2);
    expect(two.events.map(formatOf)).toEqual([
      SecurityLogFormat.Cef,
      SecurityLogFormat.SshSignIn,
    ]);
  });

  test("a long paste is read for its first lines only, and nothing past the longest text read", () => {
    const lines: Array<string> = splitPastedLogLines(
      Array.from(
        { length: MAX_CHECKED_LINES + 30 },
        (_: unknown, index: number): string => {
          return `line ${index}`;
        },
      ).join("\n"),
    );

    expect(lines).toHaveLength(MAX_CHECKED_LINES);
    expect(lines[0]).toBe("line 0");

    const long: string = `${"a".repeat(MAX_CHECKED_TEXT_LENGTH)}tail-never-read`;

    expect(splitPastedLogLines(long).join("")).not.toContain("tail");
  });

  test("an empty paste, or one of blank lines, is no line", () => {
    expect(splitPastedLogLines("")).toEqual([]);
    expect(splitPastedLogLines("  \n\t\n ")).toEqual([]);
    expect(check("   ")).toEqual(NO_CHECKED_EVENTS);
  });
});

describe("what a line becomes, as the scan reads it", () => {
  test("every kind's example is read as that kind, as the scan's parser reads it", () => {
    for (const format of SECURITY_LOG_FORMATS) {
      const result: SecurityLogLineCheckResult = check(format.example);
      const scanned: Array<NormalizedSecurityEvent> = SecurityLogParser.parse({
        body: splitPastedLogLines(format.example)[0]!,
        attributes: {},
        time: NOW,
        trustedProxies: trustedProxiesOf(NO_TRUSTED_PROXY_SOURCES),
      });

      expect([format.format, formatOf(result.events[0]!)]).toEqual([
        format.format,
        format.format,
      ]);
      // The very events the scan's parser makes of the line.
      expect([format.format, result.events]).toEqual([
        format.format,
        scanned.slice(0, MAX_SHOWN_EVENTS),
      ]);
    }
  });

  test("an everyday line makes no event", () => {
    expect(
      check(
        '10.0.0.4 - - [30/Oct/2026:10:00:00 +0000] "GET /index.html HTTP/1.1" 200 512',
      ),
    ).toEqual({ linesRead: 1, eventCount: 0, events: [], trustedProxies: [] });
  });

  test("past the events shown, it says how many there were", () => {
    const sshLine: string = definition(SecurityLogFormat.SshSignIn).example;
    const result: SecurityLogLineCheckResult = check(
      Array.from({ length: MAX_SHOWN_EVENTS + 2 }, (): string => {
        return sshLine;
      }).join("\n"),
    );

    expect(result.eventCount).toBe(MAX_SHOWN_EVENTS + 2);
    expect(result.events).toHaveLength(MAX_SHOWN_EVENTS);
  });

  test("a line no parser can read makes no event, and the rest are still read", () => {
    const result: SecurityLogLineCheckResult = check(
      `\u0000\u0001\u0002\n${definition(SecurityLogFormat.SshSignIn).example}`,
    );

    expect(result.linesRead).toBe(2);
    expect(result.events.map(formatOf)).toEqual([SecurityLogFormat.SshSignIn]);
  });
});

/*
 * The issue's line, behind a private proxy: with Logs End With
 * X-Forwarded-For on, the scan names the client; off, the proxy. The check
 * says the same either way - the bug was that it said the proxy always.
 */
describe("the issue's line, behind a private proxy", () => {
  test("with the Access Logs switch on, it names the client the proxy forwarded, and why", () => {
    const result: SecurityLogLineCheckResult = check(issueLine(), sayingSo());
    const event: NormalizedSecurityEvent = onlyEvent(result);

    expect(event.principalIp).toBe(CLIENT);
    expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.TrustedProxy);
    expect(readForwardedBy(event)).toEqual([PRIVATE_PROXY]);
    expect(event.attributes[SECURITY_REQUEST_ATTRIBUTES.forwardedBy]).toBe(
      PRIVATE_PROXY,
    );
    expect(result.trustedProxies).toEqual([
      {
        address: PRIVATE_PROXY,
        source: TrustedProxySource.Private,
        edgeName: "",
      },
    ]);
  });

  test("with it off, the line's first field is its client, as the scan says", () => {
    const result: SecurityLogLineCheckResult = check(
      issueLine(),
      sources({ readsAccessLogForwardedFor: false }),
    );
    const event: NormalizedSecurityEvent = onlyEvent(result);

    expect(event.principalIp).toBe(PRIVATE_PROXY);
    expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.Peer);
    expect(readForwardedBy(event)).toEqual([]);
    expect(result.trustedProxies).toEqual([]);
  });

  test("the old check, with no trust, named the proxy where the scan names the client", () => {
    // What Check a log line ran before #11046: the parser alone, in the browser.
    const before: Array<NormalizedSecurityEvent> = SecurityLogParser.parse({
      body: issueLine(),
      attributes: {},
      time: NOW,
    });
    // What the scan stores, with the project's trust.
    const scanned: Array<NormalizedSecurityEvent> = SecurityLogParser.parse({
      body: issueLine(),
      attributes: {},
      time: NOW,
      trustedProxies: trustedProxiesOf(sayingSo()),
    });

    expect(before[0]!.principalIp).toBe(PRIVATE_PROXY);
    expect(scanned[0]!.principalIp).toBe(CLIENT);
    // The check now says what the scan stores.
    expect(onlyEvent(check(issueLine(), sayingSo())).principalIp).toBe(
      scanned[0]!.principalIp,
    );
  });

  test("a JSON access log's X-Forwarded-For field is read behind its trusted client field too", () => {
    const line: string = JSON.stringify({
      remote_addr: PRIVATE_PROXY,
      http_x_forwarded_for: CLIENT,
      request: "GET /?id=1' OR '1'='1 HTTP/1.1",
      status: 200,
    });

    const event: NormalizedSecurityEvent = onlyEvent(check(line));

    expect(event.principalIp).toBe(CLIENT);
    expect(readForwardedBy(event)).toEqual([PRIVATE_PROXY]);
  });
});

describe("each source of trust, and why it is trusted", () => {
  test("a public proxy listed under Trusted Proxies", () => {
    const result: SecurityLogLineCheckResult = check(
      issueLine(LISTED_PROXY),
      sayingSo({ listed: blocks("203.0.113.0/24") }),
    );

    expect(onlyEvent(result).principalIp).toBe(CLIENT);
    expect(result.trustedProxies).toEqual([
      {
        address: LISTED_PROXY,
        source: TrustedProxySource.Listed,
        edgeName: "",
      },
    ]);
  });

  test("an edge the project connected, named by the edge", () => {
    const result: SecurityLogLineCheckResult = check(
      issueLine(CLOUDFLARE_ADDRESS),
      sayingSo({
        edges: [{ name: "Cloudflare", blocks: blocks("104.16.0.0/13") }],
      }),
    );

    expect(onlyEvent(result).principalIp).toBe(CLIENT);
    expect(result.trustedProxies).toEqual([
      {
        address: CLOUDFLARE_ADDRESS,
        source: TrustedProxySource.Edge,
        edgeName: "Cloudflare",
      },
    ]);
  });

  test("one of the project's own load balancers", () => {
    const result: SecurityLogLineCheckResult = check(
      issueLine(OWN_ALB),
      sayingSo({ ownLoadBalancers: blocks(OWN_ALB) }),
    );

    expect(onlyEvent(result).principalIp).toBe(CLIENT);
    expect(result.trustedProxies).toEqual([
      {
        address: OWN_ALB,
        source: TrustedProxySource.OwnLoadBalancer,
        edgeName: "",
      },
    ]);
  });

  test("Google's front ends, through the project's own Google Cloud load balancer", () => {
    // Google appends the load balancer's own address after the client's.
    const result: SecurityLogLineCheckResult = check(
      issueLine(GOOGLE_FRONT_END, `${CLIENT}, ${GOOGLE_LB}`),
      sayingSo({
        ownLoadBalancers: blocks(GOOGLE_LB),
        googleFrontEnds: blocks("35.191.0.0/16", "130.211.0.0/22"),
      }),
    );
    const event: NormalizedSecurityEvent = onlyEvent(result);

    expect(event.principalIp).toBe(CLIENT);
    // In the order X-Forwarded-For lists them, the connection's own last.
    expect(readForwardedBy(event)).toEqual([GOOGLE_LB, GOOGLE_FRONT_END]);
    expect(result.trustedProxies).toEqual([
      {
        address: GOOGLE_LB,
        source: TrustedProxySource.OwnLoadBalancer,
        edgeName: "",
      },
      {
        address: GOOGLE_FRONT_END,
        source: TrustedProxySource.GoogleFrontEnd,
        edgeName: "",
      },
    ]);
  });

  test("a proxy no source trusts is named as the line's client, with no reason", () => {
    const result: SecurityLogLineCheckResult = check(
      issueLine(LISTED_PROXY),
      sayingSo(),
    );

    expect(onlyEvent(result).principalIp).toBe(LISTED_PROXY);
    expect(result.trustedProxies).toEqual([]);
  });

  test("a private address is private whatever else lists it", () => {
    expect(
      findTrustedProxySource(
        PRIVATE_PROXY,
        sources({ listed: blocks("10.0.0.0/8") }),
      ),
    ).toEqual({
      address: PRIVATE_PROXY,
      source: TrustedProxySource.Private,
      edgeName: "",
    });
    expect(findTrustedProxySource("not an address", sources())).toBeNull();
    expect(findTrustedProxySource(UNTRUSTED_HOST, sources())).toBeNull();
  });

  test("each proxy is said once, however many events came through it", () => {
    const result: SecurityLogLineCheckResult = check(
      [issueLine(), issueLine(PRIVATE_PROXY, "198.51.100.8")].join("\n"),
      sayingSo(),
    );

    expect(result.events).toHaveLength(2);
    expect(result.trustedProxies).toHaveLength(1);
  });

  test("the sources become what the parsers read in one order, the project's own list first", () => {
    const trust: TrustedProxySources = sayingSo({
      listed: blocks("203.0.113.0/24"),
      edges: [{ name: "Cloudflare", blocks: blocks("104.16.0.0/13") }],
      ownLoadBalancers: blocks(OWN_ALB),
      googleFrontEnds: blocks("35.191.0.0/16"),
    });

    expect(
      trustedProxiesOf(trust).blocks.map((block: NetworkAddressBlock) => {
        return block.text;
      }),
    ).toEqual(["203.0.113.0/24", "104.16.0.0/13", OWN_ALB, "35.191.0.0/16"]);
    expect(trustedProxiesOf(trust).readsAccessLogForwardedFor).toBe(true);
    expect(trustedProxiesOf(NO_TRUSTED_PROXY_SOURCES)).toEqual({
      blocks: [],
      readsAccessLogForwardedFor: false,
    });
  });
});

describe("a forged X-Forwarded-For", () => {
  test("from a first field nobody trusts keeps the first field, and the forgery is only claimed", () => {
    const result: SecurityLogLineCheckResult = check(
      issueLine(UNTRUSTED_HOST, INNOCENT),
      sayingSo({ listed: blocks(LISTED_PROXY) }),
    );
    const event: NormalizedSecurityEvent = onlyEvent(result);

    expect(event.principalIp).toBe(UNTRUSTED_HOST);
    expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.Peer);
    expect(readForwardedBy(event)).toEqual([]);
    expect(event.observables).not.toContain(INNOCENT);
    expect(result.trustedProxies).toEqual([]);
  });

  test("behind a trusted proxy, only its rightmost hop no trusted proxy wrote is verified", () => {
    const event: NormalizedSecurityEvent = onlyEvent(
      check(issueLine(PRIVATE_PROXY, `${INNOCENT}, ${CLIENT}`), sayingSo()),
    );

    expect(event.principalIp).toBe(CLIENT);
    expect(readClaimedClientAddress(event)?.address).toBe(INNOCENT);
    expect(event.observables).not.toContain(INNOCENT);
  });

  test("a forged trusted hop is no proxy the client came through", () => {
    // The sender writes a private address at the left; the walk stops at the client first.
    const event: NormalizedSecurityEvent = onlyEvent(
      check(issueLine(PRIVATE_PROXY, `10.9.9.9, ${CLIENT}`), sayingSo()),
    );

    expect(event.principalIp).toBe(CLIENT);
    expect(readForwardedBy(event)).toEqual([PRIVATE_PROXY]);
  });
});

describe("Forwarded By, on the event", () => {
  test("every hop of a header of trusted hops but the leftmost, which is the client", () => {
    const event: NormalizedSecurityEvent = onlyEvent(
      check(issueLine(PRIVATE_PROXY, "10.1.1.1, 10.2.2.2"), sayingSo()),
    );

    expect(event.principalIp).toBe("10.1.1.1");
    expect(readForwardedBy(event)).toEqual(["10.2.2.2", PRIVATE_PROXY]);
  });

  test("at most the proxies nearest the server", () => {
    const hops: Array<string> = Array.from(
      { length: MAX_FORWARDED_BY + 5 },
      (_: unknown, index: number): string => {
        return `10.0.1.${index + 1}`;
      },
    );
    const event: NormalizedSecurityEvent = onlyEvent(
      check(issueLine(PRIVATE_PROXY, [CLIENT, ...hops].join(", ")), sayingSo()),
    );

    expect(event.principalIp).toBe(CLIENT);
    expect(readForwardedBy(event)).toHaveLength(MAX_FORWARDED_BY);
    expect(readForwardedBy(event).at(-1)).toBe(PRIVATE_PROXY);
  });

  test("an event that says no trusted proxy forwarded it says none, whatever the attribute holds", () => {
    expect(
      readForwardedBy({
        attributes: {
          [SECURITY_REQUEST_ATTRIBUTES.clientAddressTrust]:
            ClientAddressTrust.Peer,
          [SECURITY_REQUEST_ATTRIBUTES.forwardedBy]: PRIVATE_PROXY,
        },
      }),
    ).toEqual([]);
    expect(
      readForwardedBy({
        attributes: {
          [SECURITY_REQUEST_ATTRIBUTES.clientAddressTrust]:
            ClientAddressTrust.TrustedProxy,
          [SECURITY_REQUEST_ATTRIBUTES.forwardedBy]: `${PRIVATE_PROXY}, unknown, [REDACTED]`,
        },
      }),
    ).toEqual([PRIVATE_PROXY]);
  });
});

/*
 * The scan judges a request for a secret file the site answered by what the
 * same site answered the page's other requests (#10912), and stores what
 * it keeps. The paste is the page.
 */
describe("as the scan judges a page before it stores it", () => {
  function secretFile(path: string, status: number, size: number): string {
    return `203.0.113.9 - - [10/Oct/2026:13:55:36 +0000] "GET ${path} HTTP/1.1" ${status} ${size} "-" "curl/8.0"`;
  }

  // What the scan stores of these lines: parsed, then judged as one page.
  function stored(lines: Array<string>): Array<NormalizedSecurityEvent> {
    const parsed: Array<NormalizedSecurityEvent> = lines.flatMap(
      (body: string): Array<NormalizedSecurityEvent> => {
        return SecurityLogParser.parse({
          body,
          attributes: {},
          time: NOW,
          trustedProxies: trustedProxiesOf(NO_TRUSTED_PROXY_SOURCES),
        });
      },
    );
    const judged: Array<NormalizedSecurityEvent> =
      judgeSensitiveFileAnswers(parsed);

    keepSensitiveFileOutcomes(judged);

    return judged;
  }

  test("a secret file answered with a size no other path got, where the site refuses what it lacks, is a leak", () => {
    const lines: Array<string> = [
      secretFile("/.env", 200, 412),
      secretFile("/.git/config", 404, 153),
    ];
    const result: SecurityLogLineCheckResult = check(lines.join("\n"));

    expect(result.events).toEqual(stored(lines));
    expect(
      result.events.map((event: NormalizedSecurityEvent): OcsfSeverity => {
        return event.severityName;
      }),
    ).toContain(OcsfSeverity.Critical);
  });

  test("two secret files answered with one size are the site's own page, no leak", () => {
    const lines: Array<string> = [
      secretFile("/.env", 200, 1789),
      secretFile("/.git/config", 200, 1789),
    ];
    const result: SecurityLogLineCheckResult = check(lines.join("\n"));

    expect(result.events).toEqual(stored(lines));
    expect(result.events.length).toBeGreaterThan(0);

    for (const event of result.events) {
      expect(event.severityName).not.toBe(OcsfSeverity.Critical);
    }
  });

  test("one nothing decides is no event, as the scan stores none", () => {
    const lines: Array<string> = [secretFile("/.env", 200, 412)];

    expect(stored(lines)).toEqual([]);
    expect(check(lines.join("\n")).events).toEqual([]);
  });
});

describe("the answer's JSON", () => {
  test("carries the events and the proxies whole, the time as text", () => {
    const result: SecurityLogLineCheckResult = check(
      issueLine(GOOGLE_FRONT_END, `${CLIENT}, ${GOOGLE_LB}`),
      sayingSo({
        ownLoadBalancers: blocks(GOOGLE_LB),
        googleFrontEnds: blocks("35.191.0.0/16"),
      }),
    );
    const json: string = JSON.stringify(
      securityLogLineCheckResultToJSON(result),
    );
    const read: SecurityLogLineCheckResult = readSecurityLogLineCheckResult(
      JSON.parse(json),
    );

    expect(read).toEqual(result);
    expect(read.events[0]!.time).toEqual(NOW);
  });

  test("an event the page cannot read is left out, never guessed at", () => {
    const event: NormalizedSecurityEvent = onlyEvent(
      check(issueLine(), sayingSo()),
    );

    expect(
      readCheckedEvent({ ...checkedEventToJSON(event), time: "yesterday" }),
    ).toBeNull();
    expect(
      readCheckedEvent({
        ...checkedEventToJSON(event),
        severityName: "Apocalyptic",
      }),
    ).toBeNull();
    expect(readCheckedEvent("not an event")).toBeNull();
  });

  test("a proxy with no address or an unknown reason is left out, and a count never falls below what is held", () => {
    const event: NormalizedSecurityEvent = onlyEvent(
      check(issueLine(), sayingSo()),
    );

    expect(
      readSecurityLogLineCheckResult({
        linesRead: 1,
        eventCount: 0,
        events: [checkedEventToJSON(event)],
        trustedProxies: [
          { address: "", source: TrustedProxySource.Private },
          { address: PRIVATE_PROXY, source: "the moon" },
          { address: PRIVATE_PROXY, source: TrustedProxySource.Private },
        ],
      }),
    ).toEqual({
      linesRead: 1,
      eventCount: 1,
      events: [event],
      trustedProxies: [
        {
          address: PRIVATE_PROXY,
          source: TrustedProxySource.Private,
          edgeName: "",
        },
      ],
    });
    expect(readSecurityLogLineCheckResult(undefined)).toEqual(
      NO_CHECKED_EVENTS,
    );
  });
});

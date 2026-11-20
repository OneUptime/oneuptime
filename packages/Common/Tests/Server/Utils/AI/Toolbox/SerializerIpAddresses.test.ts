import ToolResultSerializer, {
  REDACTION_PLACEHOLDERS,
  SECURITY_OBSERVABLE_RULE_NAMES,
  SerializedResult,
} from "../../../../../Server/Utils/AI/Toolbox/Serializer";
import {
  CodeFileValuesRestored,
  restoreCodeFileValuesHidden,
} from "../../../../../Server/Utils/AI/Toolbox/CodeFileValuesRestored";
import {
  formatCodeLinesWithNumbers,
  getCodeLinePrefixLength,
  splitCodeFileLines,
} from "../../../../../Server/Utils/AI/Toolbox/CodeFileLines";
import { ScrubRegExp } from "../../../../../Types/Telemetry/ScrubRule";
import ScrubIpAddress from "../../../../../Utils/Telemetry/ScrubIpAddress";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * ONEUPTIME AI IS SHOWN NO IP ADDRESS AN IP ADDRESS SCRUB RULE HIDES, IPv4 OR
 * IPv6 (#10417).
 *
 * Everything a tool returns passes through ToolResultSerializer before it
 * enters a prompt, so before it leaves for the model's provider and is kept
 * in AI Logs. Its only address rule was a dotted quad: "8.8.8.8" in a log
 * line was hidden and "2001:4860:4860::8888" in the same line was sent as it
 * is. Now it hides exactly what an IP Address scrub rule hides, found by the
 * same function (ScrubIpAddress.findRanges, Data Security's detectors), so
 * the two cannot drift apart:
 *
 *  - every public address, IPv4 or IPv6, however it is written: compressed,
 *    written out, in capitals, IPv4-mapped (hidden whole), in brackets with
 *    a port, with a zone, inside a URL or an attribute;
 *  - private, loopback and link-local addresses are kept, as the scrub rule
 *    keeps them: they point at no one, and a model needs them to read a
 *    project's own infrastructure;
 *  - what only looks like an address - a clock, a C++ scope, a MAC address,
 *    a trace id, a span id - is kept;
 *  - a security result (keepSecurityObservables) keeps IPv6 addresses as it
 *    keeps IPv4 ones;
 *  - a long, awkward text is read in time in line with its length.
 * ---------------------------------------------------------------------------
 */

const PLACEHOLDER: string = "[redacted-ip]";

const redactionOf: (text: string) => string = (text: string): string => {
  return ToolResultSerializer.redact(text).text;
};

const countOf: (text: string) => number = (text: string): number => {
  return ToolResultSerializer.redact(text).count;
};

// What an IP Address scrub rule leaves of a text, with the serializer's placeholder.
const scrubRule: ScrubRegExp = ScrubIpAddress.toScrubRegExp();

const asTheScrubRuleHidesIt: (text: string) => string = (
  text: string,
): string => {
  return scrubRule.replace(text, (): string => {
    return PLACEHOLDER;
  });
};

describe("a public address is hidden, however it is written", () => {
  test.each([
    ["IPv4", "8.8.8.8"],
    ["IPv4, documentation", "203.0.113.7"],
    ["IPv6, compressed", "2001:4860:4860::8888"],
    ["IPv6, documentation", "2001:db8::1"],
    ["IPv6, written out", "2001:0db8:0000:0000:0000:0000:0000:0001"],
    ["IPv6, every group", "2001:db8:85a3:0:0:8a2e:370:7334"],
    ["IPv6, in capitals", "2001:DB8:85A3::8A2E:370:7334"],
    ["IPv6, ending in ::", "2001:db8::"],
    ["IPv4-mapped, dotted", "::ffff:8.8.8.8"],
    ["IPv4-mapped, dotted, in capitals", "::FFFF:203.0.113.9"],
    ["IPv4-mapped, written in hex", "::ffff:808:808"],
    ["IPv4-mapped, written out", "0:0:0:0:0:ffff:8.8.8.8"],
    ["NAT64, an IPv4 address translated", "64:ff9b::192.0.2.33"],
  ])("%s: %s", (_form: string, address: string) => {
    const line: string = `request from ${address} refused`;

    expect(redactionOf(line)).toBe(`request from ${PLACEHOLDER} refused`);
    expect(countOf(line)).toBe(1);
  });

  test("an IPv4 address written as IPv6 is hidden whole, so neither half is left", () => {
    const out: string = redactionOf("peer=::ffff:203.0.113.7 closed");

    expect(out).toBe(`peer=${PLACEHOLDER} closed`);
    expect(out).not.toContain("ffff");
    expect(out).not.toContain("203.0.113");
  });

  test("in brackets with a port, the brackets and the port are kept", () => {
    expect(redactionOf("dial [2001:db8::1]:443 failed")).toBe(
      `dial [${PLACEHOLDER}]:443 failed`,
    );
    expect(redactionOf("dial [2001:db8::1] failed")).toBe(
      `dial [${PLACEHOLDER}] failed`,
    );
  });

  test("with a zone, the address is hidden and the zone left", () => {
    const out: string = redactionOf("bound 2001:db8::7%eth0 on start");

    expect(out).toBe(`bound ${PLACEHOLDER}%eth0 on start`);
    expect(out).not.toContain("2001:db8");
  });

  test("an IPv4 address with a port keeps its port", () => {
    expect(redactionOf("connect 198.51.100.4:5432 timed out")).toBe(
      `connect ${PLACEHOLDER}:5432 timed out`,
    );
  });

  test("the IPv4 address and the IPv6 one in the same line are both hidden", () => {
    const line: string =
      "resolver answered 8.8.8.8 and 2001:4860:4860::8888 for dns.google";

    expect(redactionOf(line)).toBe(
      `resolver answered ${PLACEHOLDER} and ${PLACEHOLDER} for dns.google`,
    );
    expect(countOf(line)).toBe(2);
  });
});

describe("inside a URL", () => {
  test.each([
    [
      "an IPv6 host with a port",
      "GET https://[2001:db8::2]:8443/login?next=/home",
      `GET https://[${PLACEHOLDER}]:8443/login?next=/home`,
    ],
    [
      "an IPv6 host without a port",
      "redirect to http://[2001:4860:4860::8844]/",
      `redirect to http://[${PLACEHOLDER}]/`,
    ],
    [
      "an IPv4 host",
      "POST http://203.0.113.50/admin/login",
      `POST http://${PLACEHOLDER}/admin/login`,
    ],
    [
      "an address in the query",
      "/api/lookup?ip=2001:db8::99&format=json",
      `/api/lookup?ip=${PLACEHOLDER}&format=json`,
    ],
    [
      "a mapped address in the query",
      "/api/lookup?ip=::ffff:203.0.113.8",
      `/api/lookup?ip=${PLACEHOLDER}`,
    ],
  ])("%s", (_case: string, url: string, expected: string) => {
    expect(redactionOf(url)).toBe(expected);
  });

  test("the cloud metadata address in a URL is kept, so a model can tell a request forgery", () => {
    const url: string =
      "GET http://169.254.169.254/latest/meta-data/iam/security-credentials/";

    expect(redactionOf(url)).toBe(url);
  });
});

describe("a private, loopback or link-local address is kept, as the scrub rule keeps it", () => {
  test.each([
    ["private IPv4, 10/8", "10.0.0.12"],
    ["private IPv4, 172.16/12", "172.16.4.2"],
    ["private IPv4, 192.168/16", "192.168.1.20"],
    ["loopback IPv4", "127.0.0.1"],
    ["link-local IPv4", "169.254.10.3"],
    ["carrier-grade NAT", "100.64.0.1"],
    ["the unspecified IPv4 address", "0.0.0.0"],
    ["loopback IPv6", "::1"],
    ["link-local IPv6", "fe80::1"],
    ["link-local IPv6 with a zone", "fe80::1%eth0"],
    ["unique-local IPv6", "fd00::12"],
    ["the cloud metadata address in IPv6", "fd00:ec2::254"],
    ["multicast IPv6", "ff02::1"],
    ["a private IPv4 address written as IPv6", "::ffff:10.0.0.1"],
    ["a loopback IPv4 address written as IPv6", "::ffff:127.0.0.1"],
  ])("%s: %s", (_kind: string, address: string) => {
    const line: string = `connect ${address}:5432 refused`;

    expect(redactionOf(line)).toBe(line);
    expect(countOf(line)).toBe(0);
  });

  test("a line with both keeps the private address and hides the public one", () => {
    expect(
      redactionOf("proxy 10.0.0.8 forwarded 2001:db8::5 to 192.168.0.9"),
    ).toBe(`proxy 10.0.0.8 forwarded ${PLACEHOLDER} to 192.168.0.9`);
  });
});

describe("what only looks like an address is kept", () => {
  test.each([
    ["a C++ scope", "std::vector<int>::iterator broke"],
    ["a Rust path", "tokio::runtime::Builder failed"],
    ["a clock", "fired at 12:34:56"],
    ["a clock with milliseconds", "fired at 12:34:56:789"],
    ["a timestamp", "at 2026-11-20T12:34:56.789Z"],
    ["a MAC address", "nic aa:bb:cc:dd:ee:ff up"],
    ["a MAC address in capitals", "nic AA:BB:CC:DD:EE:01 up"],
    ["a MAC address with dashes", "nic aa-bb-cc-dd-ee-ff up"],
    ["a trace id", "trace 4bf92f3577b34da6a3ce929d0e0e4736"],
    ["a span id", "span 00f067aa0ba902b7"],
    ["a UUID", "id 123e4567-e89b-12d3-a456-426614174000"],
    ["an OID", "oid 1.3.6.1.4.1.9.9.42"],
    ["a version with five parts", "build 20.2.3.4.5 shipped"],
    ["a key and value with colons", "a:b:c:d"],
    ["a lone ::", "split on :: here"],
    ["a dotted quad out of range", "value 999.888.777.666"],
  ])("%s", (_case: string, line: string) => {
    expect(redactionOf(line)).toBe(line);
    expect(countOf(line)).toBe(0);
  });
});

describe("rows of a tool's result", () => {
  test("an address in an attribute is hidden, IPv4 or IPv6, and the private one beside it kept", () => {
    const result: SerializedResult = ToolResultSerializer.serializeRows([
      {
        body: "login failed",
        attributes: {
          "client.address": "2001:db8::17",
          "network.peer.address": "::ffff:203.0.113.44",
          "http.url": "https://[2001:db8::18]:8443/login",
          "server.address": "10.0.0.12",
        },
      },
      { body: "login failed", "client.address": "198.51.100.23" },
    ]);

    expect(result.text).not.toContain("2001:db8");
    expect(result.text).not.toContain("203.0.113.44");
    expect(result.text).not.toContain("198.51.100.23");
    expect(result.text).toContain("10.0.0.12");
    expect(result.text).toContain(`"client.address":"${PLACEHOLDER}"`);
    expect(result.text).toContain(`"network.peer.address":"${PLACEHOLDER}"`);
    expect(result.text).toContain(
      `"http.url":"https://[${PLACEHOLDER}]:8443/login"`,
    );
    expect(result.text).toContain(`client.address=${PLACEHOLDER}`);
    expect(result.redactionCount).toBe(4);
  });

  test("a rendered text - a trace tree - hides IPv6 as it hides IPv4", () => {
    const tree: string = [
      "GET /checkout (120 ms) client.address=2001:4860:4860::8888",
      "  POST payments (80 ms) server.address=10.1.2.3 peer=8.8.4.4",
    ].join("\n");
    const result: SerializedResult = ToolResultSerializer.serializeText(
      tree,
      2,
    );

    expect(result.text).toBe(
      [
        `GET /checkout (120 ms) client.address=${PLACEHOLDER}`,
        `  POST payments (80 ms) server.address=10.1.2.3 peer=${PLACEHOLDER}`,
      ].join("\n"),
    );
    expect(result.redactionCount).toBe(2);
  });
});

describe("the serializer and an IP Address scrub rule hide the same addresses", () => {
  const TEXTS: Array<string> = [
    "8.8.8.8 2001:4860:4860::8888 10.0.0.1 fe80::1",
    "client=::ffff:8.8.8.8 server=::ffff:10.0.0.2",
    "GET http://[2001:db8::1]:443/a?ip=203.0.113.5&peer=192.168.1.1",
    "dial 64:ff9b::192.0.2.1 then 2001:db8::1%eth0 then [::1]:80",
    "std::vector 12:34:56 aa:bb:cc:dd:ee:ff 1.3.6.1.4.1",
    "2001:DB8:0:0:0:0:0:1 and 2001:db8:: and ::ffff:808:808",
    "169.254.169.254 fd00:ec2::254 100.64.0.1 172.31.255.255",
    "a,8.8.8.8;b=[2001:db8::9]|c:198.51.100.1",
  ];

  test.each(TEXTS)("%s", (text: string) => {
    expect(redactionOf(text)).toBe(asTheScrubRuleHidesIt(text));
  });

  test("each address hidden counts once, as the rule finds it", () => {
    for (const text of TEXTS) {
      expect({ text, count: countOf(text) }).toEqual({
        text,
        count: ScrubIpAddress.findRanges(text).length,
      });
    }
  });
});

describe("a security result keeps its addresses, IPv6 as IPv4", () => {
  test("the rule that hides addresses is one a security result leaves out", () => {
    expect(SECURITY_OBSERVABLE_RULE_NAMES).toContain("ip-address");
  });

  test("IPv4, IPv6, mapped and bracketed addresses are kept, and secrets still hidden", () => {
    const line: string =
      "sign-in from 2001:db8::4 (::ffff:203.0.113.7, [2001:db8::5]:443, 8.8.8.8) with password=hunter22";
    const kept: string = ToolResultSerializer.redact(line, {
      keepSecurityObservables: true,
    }).text;

    expect(kept).toBe(
      "sign-in from 2001:db8::4 (::ffff:203.0.113.7, [2001:db8::5]:443, 8.8.8.8) with password=[redacted]",
    );
  });

  test("the rows of a security tool keep the IPv6 address a triage is about", () => {
    const result: SerializedResult = ToolResultSerializer.serializeRows(
      [{ principalIp: "2001:db8::66", title: "Brute force" }],
      undefined,
      { keepSecurityObservables: true },
    );

    expect(result.text).toContain("principalIp=2001:db8::66");
    expect(result.redactionCount).toBe(0);
  });
});

describe("the placeholder", () => {
  test("is the one placeholder an address reads as, listed once", () => {
    expect(
      REDACTION_PLACEHOLDERS.filter((placeholder: string): boolean => {
        return placeholder === PLACEHOLDER;
      }),
    ).toHaveLength(1);
  });
});

// A file as a model writes it whole from a read of all of it: each line as shown, its number taken off.
const NUMBERED_LINE: RegExp = /^ *\d+\| /;

const asShown: (fileContent: string) => string = (
  fileContent: string,
): string => {
  const lines: Array<string> = splitCodeFileLines(fileContent);
  const prefixLength: number = getCodeLinePrefixLength(lines.length);
  const shown: string = ToolResultSerializer.serializeText(
    formatCodeLinesWithNumbers({ lines, startLine: 1 }),
    lines.length,
  ).text;

  return `${shown
    .split("\n")
    .map((line: string): string => {
      return NUMBERED_LINE.test(line) ? line.slice(prefixLength) : line;
    })
    .join("\n")}${fileContent.endsWith("\n") ? "\n" : ""}`;
};

describe("a source file's IPv6 address is hidden from the model and written back as the file has it", () => {
  const FILE: string = [
    'export const RESOLVER = "2001:4860:4860::8888";',
    'export const EDGE = "[2001:db8::10]:443";',
    'export const DATABASE = "10.0.0.12";',
    "export const RETRIES = 3;",
    "",
  ].join("\n");

  test("the model reads placeholders for the public addresses and the private one as it is", () => {
    const shown: string = asShown(FILE);

    expect(shown).toContain(`RESOLVER = "${PLACEHOLDER}";`);
    expect(shown).toContain(`EDGE = "[${PLACEHOLDER}]:443";`);
    expect(shown).toContain('DATABASE = "10.0.0.12";');
    expect(shown).not.toContain("2001:");
  });

  test("a line kept as shown is written back with its address", () => {
    const restored: CodeFileValuesRestored = restoreCodeFileValuesHidden({
      content: asShown(FILE).replace("RETRIES = 3;", "RETRIES = 5;"),
      fileContent: FILE,
    });

    expect(restored.content).toBe(FILE.replace("RETRIES = 3;", "RETRIES = 5;"));
    expect(restored.restoredLineCount).toBe(2);
  });
});

/*
 * Every tool result is read by this rule, and a log line is whatever the
 * project's application - or an attacker - wrote into it. 400,000
 * characters of each awkward text, under two seconds, through the whole
 * redaction (Tests/Helpers/FastestRun).
 */
const LENGTH: number = 400_000;
const LIMIT_IN_MS: number = 2000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

describe("a long, awkward text is read in time in line with its length", () => {
  test.each([
    ["colons and digits", repeat("1:", LENGTH)],
    ["colons alone", repeat(":", LENGTH)],
    ["double colons and digits", repeat("1::", LENGTH)],
    ["hex and colons without end", repeat("a:", LENGTH)],
    ["dotted digits", repeat("1.", LENGTH)],
    ["an IPv4 tail that never ends", repeat("::ffff:1.", LENGTH)],
    ["eight groups and one more", repeat("1:2:3:4:5:6:7:8:", LENGTH)],
    ["mapped addresses back to back", repeat("::ffff:8.8.8.8", LENGTH)],
    ["public addresses back to back", repeat("2001:db8::1 8.8.8.8 ", LENGTH)],
    ["bracketed addresses with ports", repeat("[2001:db8::1]:443,", LENGTH)],
    ["private addresses back to back", repeat("10.0.0.1 fe80::1 ", LENGTH)],
  ])("%s", (_label: string, text: string) => {
    const timed: FastestRun<{ text: string; count: number }> = fastestRun({
      run: (): { text: string; count: number } => {
        return ToolResultSerializer.redact(text);
      },
      limitInMs: LIMIT_IN_MS,
    });

    expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
    expect(typeof timed.result.text).toBe("string");
  });

  test("still hides every public address of a long text, and keeps the private ones", () => {
    const text: string = "2001:db8::1 10.0.0.1 ".repeat(1000);
    const out: { text: string; count: number } =
      ToolResultSerializer.redact(text);

    expect(out.text).toBe(`${PLACEHOLDER} 10.0.0.1 `.repeat(1000));
    expect(out.count).toBe(1000);
  });
});

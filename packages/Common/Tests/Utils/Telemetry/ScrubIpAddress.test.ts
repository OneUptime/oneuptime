import { describe, expect, test } from "@jest/globals";
import { ScrubRegExp } from "../../../Types/Telemetry/ScrubRule";
import { IP_ADDRESS_DETECTORS } from "../../../Utils/DataSecurity/Detectors/ContactDetectors";
import {
  findSensitiveValues,
  TextMatch,
} from "../../../Utils/DataSecurity/TextScanner";
import ScrubIpAddress, {
  IPV4_ADDRESS_MASK,
  IPV6_ADDRESS_MASK,
  ScrubIpAddressRange,
} from "../../../Utils/Telemetry/ScrubIpAddress";

/*
 * WHAT AN IP ADDRESS SCRUB RULE HIDES IS WHAT DATA SECURITY CALLS AN IP
 * ADDRESS (#10393).
 *
 * The rule's pattern was every dotted quad: an IPv6 address was stored as
 * it came while its finding said it was scrubbed, and a private, loopback
 * or link-local address - no one's personal data - was hidden, the cloud
 * metadata address in a request's URL with it. Now the rule's matches are
 * the IP address detectors' own: these tests read them, the scanner's
 * findings beside them, and what Mask and Hash make of a match.
 */

// The texts each range of a text covers.
function hidden(text: string): Array<string> {
  return ScrubIpAddress.findRanges(text).map(
    ([start, end]: ScrubIpAddressRange): string => {
      return text.slice(start, end);
    },
  );
}

// The text with each range replaced, as a Redact rule writes it.
function redacted(text: string): string {
  return ScrubIpAddress.toScrubRegExp().replace(text, (): string => {
    return "[REDACTED]";
  });
}

describe("an IP Address scrub rule hides what Data Security calls an IP address", () => {
  test.each([
    ["a public IPv4 address", "client 8.8.8.8 sent", "8.8.8.8"],
    ["another", "remote_addr=81.2.69.142", "81.2.69.142"],
    ["a documentation IPv4 address", "from 203.0.113.7", "203.0.113.7"],
    ["the other documentation ranges", "via 198.51.100.23", "198.51.100.23"],
    ["the first documentation range", "peer 192.0.2.1;", "192.0.2.1"],
    [
      "a compressed IPv6 address",
      "client 2001:4860:4860::8888 sent",
      "2001:4860:4860::8888",
    ],
    [
      "an IPv6 address written out",
      "src=2a00:1450:4001:081b:0000:0000:0000:200e",
      "2a00:1450:4001:081b:0000:0000:0000:200e",
    ],
    [
      "an IPv6 address in capitals",
      "src=2A00:1450:4001:81B::200E",
      "2A00:1450:4001:81B::200E",
    ],
    ["a documentation IPv6 address", "peer 2001:db8::1 up", "2001:db8::1"],
    [
      "a documentation IPv6 address with leading zeros",
      "2001:0db8:85a3::8a2e:370:7334",
      "2001:0db8:85a3::8a2e:370:7334",
    ],
    [
      "an IPv4 address written as IPv6, whole",
      "connection from ::ffff:8.8.8.8",
      "::ffff:8.8.8.8",
    ],
    ["an IPv4-mapped address in hex", "peer ::ffff:808:808", "::ffff:808:808"],
    [
      "an IPv4-mapped address in capitals",
      "peer ::FFFF:203.0.113.7",
      "::FFFF:203.0.113.7",
    ],
    [
      "an IPv4-mapped address written out",
      "peer 0:0:0:0:0:ffff:808:808",
      "0:0:0:0:0:ffff:808:808",
    ],
    [
      "a translated address, whole",
      "upstream 64:ff9b::192.0.2.1",
      "64:ff9b::192.0.2.1",
    ],
    [
      "an address that ends in its IPv4 address",
      "2001:db8::1.2.3.4",
      "2001:db8::1.2.3.4",
    ],
    // #10466: one group each side of "::".
    ["one group each side of ::", "client 2001::1 sent", "2001::1"],
    ["another", "remote_addr=2a00::1", "2a00::1"],
    ["a third", "via 2606::1;", "2606::1"],
    ["one in capitals", "peer 2A00::BEEF up", "2A00::BEEF"],
    ["the last global first group", "peer 3fff::ffff up", "3fff::ffff"],
    [
      "one group and an IPv4 address, whole",
      "upstream 2001::8.8.8.8",
      "2001::8.8.8.8",
    ],
  ])("%s: %s", (_label: string, text: string, address: string) => {
    expect(hidden(text)).toEqual([address]);
    expect(redacted(text)).toBe(text.replace(address, "[REDACTED]"));
  });

  test("an address in brackets with a port: the brackets and the port stay", () => {
    expect(redacted("dial [2001:db8::1]:443 failed")).toBe(
      "dial [[REDACTED]]:443 failed",
    );
    expect(redacted("dial [::ffff:8.8.8.8]:443 failed")).toBe(
      "dial [[REDACTED]]:443 failed",
    );
  });

  test("an address with a port and no brackets, as Node writes an IPv4 peer", () => {
    expect(redacted("from ::ffff:8.8.8.8:52344")).toBe("from [REDACTED]:52344");
    expect(redacted("from 8.8.8.8:53")).toBe("from [REDACTED]:53");
  });

  test("an address with a zone: the address is hidden, the interface kept", () => {
    expect(redacted("bound to 2001:db8::1%eth0")).toBe(
      "bound to [REDACTED]%eth0",
    );
  });

  test("one group each side of :: in brackets, with a zone, a prefix length and in JSON (#10466)", () => {
    expect(redacted("dial [2001::1]:443 failed")).toBe(
      "dial [[REDACTED]]:443 failed",
    );
    expect(redacted("bound to 2a00::1%eth0")).toBe("bound to [REDACTED]%eth0");
    expect(redacted("route 2606::1/64 via 2001::1.")).toBe(
      "route [REDACTED]/64 via [REDACTED].",
    );
    expect(
      redacted(JSON.stringify({ client: "2001::1", peer: "fe80::1" })),
    ).toBe(JSON.stringify({ client: "[REDACTED]", peer: "fe80::1" }));
    expect(
      redacted("x-forwarded-for: 2001::1, 10.0.0.1, 2606::1, fd00::1"),
    ).toBe("x-forwarded-for: [REDACTED], 10.0.0.1, [REDACTED], fd00::1");
  });

  test("addresses inside URLs, headers and JSON", () => {
    expect(redacted("GET http://8.8.8.8/health")).toBe(
      "GET http://[REDACTED]/health",
    );
    expect(redacted("GET http://[2001:db8::1]:8080/a?b=1")).toBe(
      "GET http://[[REDACTED]]:8080/a?b=1",
    );
    expect(redacted("ssh user@203.0.113.9")).toBe("ssh user@[REDACTED]");
    expect(
      redacted("x-forwarded-for: 203.0.113.7, 10.0.0.1, 2001:db8::5"),
    ).toBe("x-forwarded-for: [REDACTED], 10.0.0.1, [REDACTED]");
    expect(
      redacted(
        JSON.stringify({ client: "2001:4860:4860::8888", peer: "10.0.0.1" }),
      ),
    ).toBe(JSON.stringify({ client: "[REDACTED]", peer: "10.0.0.1" }));
  });
});

describe("it keeps what is no one's personal data", () => {
  test.each([
    ["a private address", "10.0.0.12"],
    ["another private range", "172.16.5.4"],
    ["a home network", "192.168.0.1"],
    ["loopback", "127.0.0.1"],
    ["the cloud metadata address", "169.254.169.254"],
    ["the container metadata address", "169.254.170.2"],
    ["carrier-grade NAT", "100.64.0.1"],
    ["a metadata address in shared space", "100.100.100.200"],
    ["the benchmark range", "198.18.0.1"],
    ["this network", "0.0.0.0"],
    ["multicast", "224.0.0.1"],
    ["broadcast", "255.255.255.255"],
    ["IPv6 loopback", "::1"],
    ["the unspecified IPv6 address", "::"],
    ["IPv6 link-local", "fe80::1"],
    ["IPv6 link-local with its zone", "fe80::1%eth0"],
    ["IPv6 unique-local", "fd00::1"],
    ["the IPv6 cloud metadata address", "fd00:ec2::254"],
    ["IPv6 multicast", "ff02::1"],
    ["a private address written as IPv6", "::ffff:10.0.0.1"],
    ["loopback written as IPv6", "::ffff:127.0.0.1"],
  ])("%s: %s", (_label: string, address: string) => {
    const text: string = `peer ${address} ok`;

    expect(hidden(text)).toEqual([]);
    expect(redacted(text)).toBe(text);
  });

  test("the cloud metadata address stays in a request's URL, where Security Events finds SSRF", () => {
    const query: string = "target=http://169.254.169.254/latest/meta-data/";

    expect(redacted(query)).toBe(query);
  });

  test.each([
    ["a clock", "at 12:30:45"],
    ["a clock with milliseconds", "at 10:15:02.123"],
    ["a timestamp", "2026-11-20T10:15:02.123Z"],
    ["a MAC address", "hwaddr 00:1a:2b:3c:4d:5e"],
    ["a C++ scope", "std::vector<int>"],
    ["a class path", "Foo::Bar"],
    ["a scope of hex letters", "Abc::Def"],
    ["a version", "version 1.2.3.4.5"],
    ["a version inside a longer token", "v81.2.69.142.1"],
    ["an octet out of range", "81.2.69.256"],
    ["a leading zero", "081.2.69.142"],
    ["a UUID", "0192f1a0-0000-7000-8000-0000000d5001"],
    ["nine groups", "1:2:3:4:5:6:7:8:9"],
    ["a hash", "sha 8c87b4891f2e7d3a"],
    // #10466: what one group each side of "::" is not.
    ["a scope of two hex letters", "a::b"],
    ["a scope of hex words", "dead::beef"],
    ["a nested scope", "Abc::Def::Fed"],
    ["a version in a module path", "v1::api"],
    ["a year inside an identifier", "Api2023::face"],
    ["a year after an underscore", "Release_2024::Beta"],
    ["a letter before the address", "x2001::1"],
    ["a letter after it", "2001::1x"],
    ["a dot before it", "a.2001::1"],
    ["a version after it", "2001::1.5"],
    ["a Rust type", "u32::MAX"],
    ["a C++ type", "Vec3d::Zero"],
    ["a first group outside the global range", "peer 4000::1"],
    ["a short first group", "peer 200::1"],
    ["one side alone", "peer 2001::"],
    ["a group too long", "peer 2001::12345"],
  ])("%s is no address: %s", (_label: string, text: string) => {
    expect(hidden(text)).toEqual([]);
  });

  test("an IPv4 address inside an IPv4-compatible one is still found, as the scanner finds it", () => {
    expect(hidden("peer ::8.8.8.8")).toEqual(["8.8.8.8"]);
  });

  test("a link-local address that ends in a public IPv4 address hides the IPv4 address", () => {
    expect(redacted("peer fe80::8.8.8.8")).toBe("peer fe80::[REDACTED]");
  });
});

/*
 * #10467: an address in a percent-encoded URL - a query string an app logs
 * as it arrived - has its colons written %3A, so neither the scanner nor
 * the rule saw one. Both read the text with its escapes read too, and the
 * rule hides exactly the characters the address is written with: the
 * escaped brackets, the port and the rest of the URL stay.
 */
describe("an address in a percent-encoded URL (#10467)", () => {
  test.each([
    [
      "an IPv6 address in an encoded URL",
      "target=http%3A%2F%2F%5B2001%3Adb8%3A%3A1%5D%2F",
      "target=http%3A%2F%2F%5B[REDACTED]%5D%2F",
    ],
    [
      "lower-case escapes",
      "target=http%3a%2f%2f%5b2001%3adb8%3a%3a1%5d%2f",
      "target=http%3a%2f%2f%5b[REDACTED]%5d%2f",
    ],
    [
      "a public address with a port",
      "redirect=https%3A%2F%2F%5B2606%3A4700%3A4700%3A%3A1111%5D%3A8443%2Fcb",
      "redirect=https%3A%2F%2F%5B[REDACTED]%5D%3A8443%2Fcb",
    ],
    [
      "one group each side of ::",
      "u=http%3A%2F%2F%5B2001%3A%3A1%5D",
      "u=http%3A%2F%2F%5B[REDACTED]%5D",
    ],
    [
      "an IPv4 address in an encoded URL",
      "u=http%3A%2F%2F8.8.8.8%2Fhealth",
      "u=http%3A%2F%2F[REDACTED]%2Fhealth",
    ],
    ["an IPv4 address with encoded dots", "u=8%2E8%2E8%2E8", "u=[REDACTED]"],
    [
      "an IPv4 address with encoded digits",
      "u=%38.%38.%38.%38",
      "u=[REDACTED]",
    ],
    ["every character encoded", "u=%32%30%30%31%3A%3A%31", "u=[REDACTED]"],
    ["some colons encoded, some not", "u=2001%3Adb8::1", "u=[REDACTED]"],
    ["the other colons encoded", "u=2001:db8%3A%3A1", "u=[REDACTED]"],
    [
      "brackets encoded and colons not",
      "u=%5B2001:db8::1%5D:443",
      "u=%5B[REDACTED]%5D:443",
    ],
    [
      "an IPv4 address written as IPv6, whole",
      "peer=%3A%3Affff%3A8.8.8.8",
      "peer=[REDACTED]",
    ],
    [
      "a URL inside a query string inside a URL",
      "next=https%3A%2F%2Fa.example%2Fcb%3Fto%3Dhttp%253A%252F%252F%255B2001%253Adb8%253A%253A1%255D",
      "next=https%3A%2F%2Fa.example%2Fcb%3Fto%3Dhttp%253A%252F%252F%255B[REDACTED]%255D",
    ],
    [
      "a zone written %25",
      "u=http%3A%2F%2F%5B2001%3Adb8%3A%3A1%25eth0%5D",
      "u=http%3A%2F%2F%5B[REDACTED]%25eth0%5D",
    ],
    [
      "a list of them",
      "ips=2001%3A%3A1%2C10.0.0.1%2C2606%3A%3A1%2C8.8.8.8",
      "ips=[REDACTED]%2C10.0.0.1%2C[REDACTED]%2C[REDACTED]",
    ],
  ])("hides %s: %s", (_label: string, text: string, scrubbed: string) => {
    expect(redacted(text)).toBe(scrubbed);
  });

  test.each([
    ["a link-local address", "u=http%3A%2F%2F%5Bfe80%3A%3A1%5D%2F"],
    ["a unique-local address", "u=http%3A%2F%2F%5Bfd00%3Aec2%3A%3A254%5D%2F"],
    [
      "the cloud metadata address, where Security Events finds SSRF",
      "target=http%3A%2F%2F169.254.169.254%2Flatest%2Fmeta-data%2F",
    ],
    ["a private address with encoded dots", "u=10%2E0%2E0%2E1"],
    ["a private address written as IPv6", "peer=%3A%3Affff%3A10.0.0.1"],
    ["loopback", "u=http%3A%2F%2F%5B%3A%3A1%5D%3A8080"],
    ["a scope of hex letters", "q=Abc%3A%3ADef"],
    ["a clock", "at=12%3A30%3A45"],
    ["a MAC address", "hw=00%3A1a%3A2b%3A3c%3A4d%3A5e"],
    ["a version", "v=1%2E2%2E3%2E4%2E5"],
  ])("keeps %s: %s", (_label: string, text: string) => {
    expect(hidden(text)).toEqual([]);
    expect(redacted(text)).toBe(text);
  });

  test.each([
    [
      "a percent sign that ends a number",
      "cpu 100% from 8.8.8.8",
      "cpu 100% from [REDACTED]",
    ],
    ["two percent signs", "50%% 2001::1", "50%% [REDACTED]"],
    ["a percent sign and no hex digits", "%zz2001:db8::1", "%zz[REDACTED]"],
    ["a percent sign at the very end", "8.8.8.8 100%", "[REDACTED] 100%"],
    [
      "an escape of a byte beyond ASCII",
      "caf%C3%A9 2001::1",
      "caf%C3%A9 [REDACTED]",
    ],
    // "%20" reads as a space, which leaves "01::1": as written, it is 2001::1, and hidden whole.
    [
      "a percent sign glued to an address",
      "load 99%2001::1",
      "load 99%[REDACTED]",
    ],
  ])(
    "reads %s as it is written: %s",
    (_label: string, text: string, scrubbed: string) => {
      expect(redacted(text)).toBe(scrubbed);
    },
  );

  test("an address found as it is written and as its escapes read is one range", () => {
    const text: string = "u=http%3A%2F%2F8.8.8.8%2F";

    expect(hidden(text)).toEqual(["8.8.8.8"]);
  });

  test("the range is the encoded address, its first character to its last", () => {
    expect(hidden("target=http%3A%2F%2F%5B2001%3Adb8%3A%3A1%5D%2F")).toEqual([
      "2001%3Adb8%3A%3A1",
    ]);
    expect(hidden("u=%32%30%30%31%3A%3A%31&n=1")).toEqual([
      "%32%30%30%31%3A%3A%31",
    ]);
    expect(hidden("to%3Dhttp%253A%252F%252F%255B2606%253A%253A1%255D")).toEqual(
      ["2606%253A%253A1"],
    );
  });

  test("a JSON text keeps its quotes and stays JSON", () => {
    const text: string = JSON.stringify({
      url: "http%3A%2F%2F%5B2001%3Adb8%3A%3A1%5D%2F",
      peer: "fe80%3A%3A1",
    });

    expect(JSON.parse(redacted(text))).toEqual({
      url: "http%3A%2F%2F%5B[REDACTED]%5D%2F",
      peer: "fe80%3A%3A1",
    });
  });

  test("an encoded address is read as the address it is: one spelling, one mask, one token", () => {
    expect(ScrubIpAddress.canonicalize("2001%3Adb8%3A%3A1")).toBe(
      "2001:db8::1",
    );
    expect(
      ScrubIpAddress.canonicalize("2001%3ADB8%3A0%3A0%3A0%3A0%3A0%3A1"),
    ).toBe("2001:db8::1");
    expect(ScrubIpAddress.canonicalize("8%2E8%2E8%2E8")).toBe("8.8.8.8");
    expect(ScrubIpAddress.canonicalize("%3A%3Affff%3A8.8.8.8")).toBe("8.8.8.8");
    expect(ScrubIpAddress.canonicalize("2001%253A%253A1")).toBe("2001::1");
    expect(ScrubIpAddress.mask("2001%3Adb8%3A%3A1")).toBe(IPV6_ADDRESS_MASK);
    expect(ScrubIpAddress.mask("8%2E8%2E8%2E8")).toBe(IPV4_ADDRESS_MASK);
    expect(ScrubIpAddress.mask("%3A%3Affff%3A8.8.8.8")).toBe(IPV4_ADDRESS_MASK);
  });

  test("text that is no address comes back as it is, escapes and all", () => {
    expect(ScrubIpAddress.canonicalize("not%20an%20address")).toBe(
      "not%20an%20address",
    );
  });
});

describe("what the scanner finds, the rule hides, and nothing else", () => {
  const TEXTS: Array<string> = [
    "client 8.8.8.8 and 10.0.0.12 talked to 2001:4860:4860::8888",
    "connection from ::ffff:8.8.8.8:52344 to fe80::1%eth0",
    "src=203.0.113.7 dst=169.254.169.254 via [2001:db8::1]:443",
    '{"ip":"81.2.69.142","peers":["::ffff:203.0.113.5","fd00::1"]}',
    "x-forwarded-for: 198.51.100.23, 192.168.0.1, 2a00:1450:4001:81b::200e",
    "at 12:30:45 std::vector 00:1a:2b:3c:4d:5e version 1.2.3.4.5",
    "upstream 64:ff9b::192.0.2.1 and ::ffff:808:808",
    "client 2001::1 and 2a00::1 talked to 2606::1 via 2001::8.8.8.8",
    "a::b dead::beef v1::api Api2023::face x2001::1 2001::1x 2001::1.5 4000::1",
    '{"ip":"2001::1","peers":["2606::1","fd00::1","Abc::Def"]}',
    // #10467: encoded addresses, and what encoded is still no address.
    "target=http%3A%2F%2F%5B2001%3Adb8%3A%3A1%5D%2F and http%3A%2F%2F8.8.8.8%2F",
    "u=%5B2001:db8::1%5D:443 v=8%2E8%2E8%2E8 w=%3A%3Affff%3A8.8.8.8",
    "u=http%3A%2F%2F%5Bfe80%3A%3A1%5D q=Abc%3A%3ADef at=12%3A30%3A45 x=10%2E0%2E0%2E1",
    "next=https%3A%2F%2Fa.example%2Fcb%3Fto%3Dhttp%253A%252F%252F%255B2606%253A%253A1%255D",
    "cpu 100% from 8.8.8.8 and caf%C3%A9 at 2001::1 load 99%2001::1",
  ];

  // The scanner's IP address findings, documentation addresses included.
  function findings(text: string): Array<TextMatch> {
    return findSensitiveValues(text, {
      detectors: IP_ADDRESS_DETECTORS,
    }).filter((match: TextMatch): boolean => {
      return match.dataTypeId === "ip-address";
    });
  }

  test.each(TEXTS)("%s", (text: string) => {
    const ranges: Array<ScrubIpAddressRange> = ScrubIpAddress.findRanges(text);
    const found: Array<TextMatch> = findings(text);

    // Every finding is inside what the rule hides...
    for (const match of found) {
      expect({
        finding: text.slice(match.start, match.end),
        covered: ranges.some(([start, end]: ScrubIpAddressRange): boolean => {
          return start <= match.start && match.end <= end;
        }),
      }).toEqual({
        finding: text.slice(match.start, match.end),
        covered: true,
      });
    }

    // ...and the rule hides nothing the scanner calls no address.
    for (const [start, end] of ranges) {
      expect({
        hidden: text.slice(start, end),
        found: found.some((match: TextMatch): boolean => {
          return start <= match.start && match.end <= end;
        }),
      }).toEqual({ hidden: text.slice(start, end), found: true });
    }
  });
});

describe("the pattern a rule runs with", () => {
  const regex: ScrubRegExp = ScrubIpAddress.toScrubRegExp();

  test("replace, matchRanges and test read the same matches", () => {
    const text: string =
      "a 8.8.8.8 b 10.0.0.1 c ::ffff:8.8.8.8 d 2001:db8::1 e fe80::1";

    expect(regex.matchRanges(text)).toEqual(ScrubIpAddress.findRanges(text));
    expect(regex.test(text)).toBe(true);
    expect(regex.test("only 10.0.0.1 and fe80::1")).toBe(false);
    expect(
      regex.replace(text, (match: string): string => {
        return `<${match}>`;
      }),
    ).toBe(
      "a <8.8.8.8> b 10.0.0.1 c <::ffff:8.8.8.8> d <2001:db8::1> e fe80::1",
    );
  });

  test("a text with no address comes back as it is, and an empty one too", () => {
    expect(
      regex.replace("nothing here", (): string => {
        return "x";
      }),
    ).toBe("nothing here");
    expect(regex.matchRanges("")).toEqual([]);
  });

  test("says what it finds: the two detectors' patterns, everywhere in a text", () => {
    expect(regex.flags).toBe("g");

    for (const detector of IP_ADDRESS_DETECTORS) {
      expect(regex.source).toContain(detector.pattern.source);
    }
  });

  test("ranges come left to right, none overlapping", () => {
    const ranges: Array<ScrubIpAddressRange> = ScrubIpAddress.findRanges(
      "::ffff:8.8.8.8 1.1.1.1 ::ffff:1.0.0.1 2606:4700::1111 9.9.9.9",
    );

    for (let index: number = 1; index < ranges.length; index++) {
      expect(ranges[index]![0]).toBeGreaterThanOrEqual(ranges[index - 1]![1]);
    }

    expect(ranges).toHaveLength(5);
  });
});

describe("one spelling for every way an address is written", () => {
  test.each([
    ["8.8.8.8", "8.8.8.8"],
    ["::ffff:8.8.8.8", "8.8.8.8"],
    ["::FFFF:808:808", "8.8.8.8"],
    ["0:0:0:0:0:ffff:808:808", "8.8.8.8"],
    ["2001:DB8:0:0:0:0:0:1", "2001:db8::1"],
    ["2001:0db8::0001", "2001:db8::1"],
    ["2a00:1450:4001:081b:0000:0000:0000:200e", "2a00:1450:4001:81b::200e"],
    ["64:ff9b::192.0.2.1", "64:ff9b::c000:201"],
    // #10466: one spelling however one group each side is written.
    ["2001::1", "2001::1"],
    ["2001:0:0:0:0:0:0:1", "2001::1"],
    ["2001::0001", "2001::1"],
    ["2A00::BEEF", "2a00::beef"],
    ["2001::8.8.8.8", "2001::808:808"],
  ])("%s is %s", (address: string, canonical: string) => {
    expect(ScrubIpAddress.canonicalize(address)).toBe(canonical);
  });

  test("text that is no address comes back as it is", () => {
    expect(ScrubIpAddress.canonicalize("not an address")).toBe(
      "not an address",
    );
    expect(ScrubIpAddress.canonicalize("1.2.3")).toBe("1.2.3");
  });
});

describe("what Mask leaves of an address", () => {
  test.each([
    ["8.8.8.8", IPV4_ADDRESS_MASK],
    ["203.0.113.7", IPV4_ADDRESS_MASK],
    // An IPv4 address written as IPv6 is an IPv4 address.
    ["::ffff:8.8.8.8", IPV4_ADDRESS_MASK],
    ["2001:4860:4860::8888", IPV6_ADDRESS_MASK],
    ["2001:db8::1", IPV6_ADDRESS_MASK],
    ["2001::1", IPV6_ADDRESS_MASK],
    ["2001::8.8.8.8", IPV6_ADDRESS_MASK],
  ])("%s becomes %s", (address: string, mask: string) => {
    expect(ScrubIpAddress.mask(address)).toBe(mask);
  });

  test("an IPv6 address has a shape of its own, and no digit of the address", () => {
    expect(IPV4_ADDRESS_MASK).toBe("***.***.***.***");
    expect(IPV6_ADDRESS_MASK).toBe("****:****:****:****:****:****:****:****");
    expect(IPV6_ADDRESS_MASK).not.toMatch(/[0-9a-f]/i);
  });
});

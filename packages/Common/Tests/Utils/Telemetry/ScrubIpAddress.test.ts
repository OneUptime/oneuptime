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

describe("what the scanner finds, the rule hides, and nothing else", () => {
  const TEXTS: Array<string> = [
    "client 8.8.8.8 and 10.0.0.12 talked to 2001:4860:4860::8888",
    "connection from ::ffff:8.8.8.8:52344 to fe80::1%eth0",
    "src=203.0.113.7 dst=169.254.169.254 via [2001:db8::1]:443",
    '{"ip":"81.2.69.142","peers":["::ffff:203.0.113.5","fd00::1"]}',
    "x-forwarded-for: 198.51.100.23, 192.168.0.1, 2a00:1450:4001:81b::200e",
    "at 12:30:45 std::vector 00:1a:2b:3c:4d:5e version 1.2.3.4.5",
    "upstream 64:ff9b::192.0.2.1 and ::ffff:808:808",
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
  ])("%s becomes %s", (address: string, mask: string) => {
    expect(ScrubIpAddress.mask(address)).toBe(mask);
  });

  test("an IPv6 address has a shape of its own, and no digit of the address", () => {
    expect(IPV4_ADDRESS_MASK).toBe("***.***.***.***");
    expect(IPV6_ADDRESS_MASK).toBe("****:****:****:****:****:****:****:****");
    expect(IPV6_ADDRESS_MASK).not.toMatch(/[0-9a-f]/i);
  });
});

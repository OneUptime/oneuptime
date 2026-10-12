import PacketCaptureFilterUtil, {
  getIPv4Network,
  getIPv6Network,
  PacketCaptureFilterBuild,
  PacketCaptureProtocol,
  SimplePacketCaptureFilter,
} from "../../../Types/PacketCapture/PacketCaptureFilter";
import { PACKET_CAPTURE_MAX_FILTER_LENGTH } from "../../../Types/PacketCapture/PacketCaptureLimits";
import { describe, expect, test } from "@jest/globals";

/*
 * Which packets a capture keeps. Most people fill in a host, a port and a
 * protocol and the expression is built for them; anyone else writes BPF,
 * checked before it is saved. The probe hands the expression to tcpdump as
 * one argument after "--", never through a shell - validate() is the second
 * line, refusing every character a filter never needs, so these tests pin
 * both what is built and what is refused.
 */

function build(filter: SimplePacketCaptureFilter): PacketCaptureFilterBuild {
  return PacketCaptureFilterUtil.buildFromSimple(filter);
}

function expression(filter: SimplePacketCaptureFilter): string {
  const built: PacketCaptureFilterBuild = build(filter);

  expect(built.error).toBeNull();

  return built.expression;
}

function errorOf(filter: SimplePacketCaptureFilter): string {
  const built: PacketCaptureFilterBuild = build(filter);

  expect(built.expression).toBe("");
  expect(built.error).not.toBeNull();

  return built.error as string;
}

describe("PacketCaptureFilterUtil.getProtocols", () => {
  test("offers any, TCP, UDP and ICMP, in that order", () => {
    expect(PacketCaptureFilterUtil.getProtocols()).toEqual([
      PacketCaptureProtocol.Any,
      PacketCaptureProtocol.TCP,
      PacketCaptureProtocol.UDP,
      PacketCaptureProtocol.ICMP,
    ]);
  });
});

describe("PacketCaptureFilterUtil.buildFromSimple", () => {
  test("nothing filled in keeps every packet: the empty expression", () => {
    expect(expression({})).toBe("");
    expect(expression({ host: "", port: "", protocol: "" })).toBe("");
    expect(
      expression({
        host: "   ",
        port: " ",
        protocol: PacketCaptureProtocol.Any,
      }),
    ).toBe("");
  });

  test("an IPv4 or IPv6 address is a host", () => {
    expect(expression({ host: "10.0.0.5" })).toBe("host 10.0.0.5");
    expect(expression({ host: "  10.0.0.5  " })).toBe("host 10.0.0.5");
    expect(expression({ host: "fe80::1" })).toBe("host fe80::1");
    expect(expression({ host: "2001:db8::42" })).toBe("host 2001:db8::42");
  });

  test("an address with a prefix length is a network", () => {
    expect(expression({ host: "10.0.0.0/24" })).toBe("net 10.0.0.0/24");
    expect(expression({ host: "0.0.0.0/0" })).toBe("net 0.0.0.0/0");
    expect(expression({ host: "2001:db8::/32" })).toBe("net 2001:db8::/32");
  });

  /*
   * tcpdump refuses "net 10.0.0.5/24" ("non-network bits set"), and a host's
   * address with its subnet's prefix length is how most people write their
   * subnet - so the network it is in is built instead.
   */
  test("an address with host bits set is built as the network it is in", () => {
    expect(expression({ host: "10.0.0.5/24" })).toBe("net 10.0.0.0/24");
    expect(expression({ host: "192.168.1.130/25" })).toBe(
      "net 192.168.1.128/25",
    );
    expect(expression({ host: "172.16.5.4/12" })).toBe("net 172.16.0.0/12");
    expect(expression({ host: "10.1.2.3/32" })).toBe("net 10.1.2.3/32");
    expect(expression({ host: "10.1.2.3/0" })).toBe("net 0.0.0.0/0");
    expect(expression({ host: "2001:db8::5/64" })).toBe("net 2001:db8::/64");
    expect(expression({ host: "2001:db8:1:2:3:4:5:6/48" })).toBe(
      "net 2001:db8:1::/48",
    );
    expect(expression({ host: "fe80::1/10" })).toBe("net fe80::/10");
  });

  test("a prefix length the address family cannot have is refused", () => {
    expect(errorOf({ host: "10.0.0.0/33" })).toBe(
      '"10.0.0.0/33" is not an IP address, a network such as 10.0.0.0/24, or a host name.',
    );
    expect(errorOf({ host: "2001:db8::/129" })).toContain("is not an IP");
    expect(errorOf({ host: "not-an-address/24" })).toContain("is not an IP");
  });

  test("a host name is a host", () => {
    expect(expression({ host: "db.internal.example.com" })).toBe(
      "host db.internal.example.com",
    );
    expect(expression({ host: "router-1" })).toBe("host router-1");
  });

  test("an IPv6 zone is refused with how to write the address instead", () => {
    expect(errorOf({ host: "fe80::1%eth0" })).toBe(
      'Leave the zone out of "fe80::1%eth0": write the address without "%".',
    );
  });

  test("a word of the filter language is not taken for a host", () => {
    for (const word of ["port", "TCP", "and", "not", "host", "icmp6"]) {
      expect(errorOf({ host: word })).toBe(
        `"${word}" is a word of the filter language, not a host. Write an IP address or a full host name.`,
      );
    }
  });

  test("anything that could be read as more than a host is refused", () => {
    for (const host of [
      "10.0.0.5; reboot",
      "$(reboot)",
      "`reboot`",
      "-i eth0",
      "10.0.0.5 or host 10.0.0.6",
      "host'",
      "a".repeat(254),
      "under_score.example.com",
    ]) {
      expect(errorOf({ host: host })).toBe(
        `"${host}" is not an IP address, a network such as 10.0.0.0/24, or a host name.`,
      );
    }
  });

  test("a port, alone or with TCP or UDP", () => {
    expect(expression({ port: "443" })).toBe("port 443");
    expect(
      expression({ port: "443", protocol: PacketCaptureProtocol.TCP }),
    ).toBe("tcp port 443");
    expect(
      expression({ port: "5060", protocol: PacketCaptureProtocol.UDP }),
    ).toBe("udp port 5060");
    expect(expression({ port: " 53 " })).toBe("port 53");
    expect(expression({ port: "1" })).toBe("port 1");
    expect(expression({ port: "65535" })).toBe("port 65535");
  });

  test("a range of ports is a portrange, and a range of one port is the port", () => {
    expect(expression({ port: "8000-8080" })).toBe("portrange 8000-8080");
    expect(expression({ port: "8000 - 8080" })).toBe("portrange 8000-8080");
    expect(
      expression({ port: "8000-8080", protocol: PacketCaptureProtocol.TCP }),
    ).toBe("tcp portrange 8000-8080");
    expect(expression({ port: "443-443" })).toBe("port 443");
  });

  test("a range that runs backwards says to write the lower port first", () => {
    expect(errorOf({ port: "8080-8000" })).toBe(
      "The port range 8080-8000 runs backwards. Write the lower port first.",
    );
  });

  test("anything that is not a port from 1 to 65535 is refused", () => {
    for (const port of [
      "0",
      "65536",
      "99999",
      "abc",
      "443,80",
      "443 80",
      "-1",
      "1.5",
      "0-80",
      "80-70000",
    ]) {
      expect(errorOf({ port: port })).toBe(
        "The port must be a number from 1 to 65535, or a range such as 8000-8080.",
      );
    }
  });

  test("a protocol on its own", () => {
    expect(expression({ protocol: PacketCaptureProtocol.TCP })).toBe("tcp");
    expect(expression({ protocol: PacketCaptureProtocol.UDP })).toBe("udp");
    expect(expression({ protocol: PacketCaptureProtocol.ICMP })).toBe(
      "icmp or icmp6",
    );
  });

  test("ICMP is bracketed when it follows a host, so the 'or' stays inside it", () => {
    expect(
      expression({ host: "10.0.0.5", protocol: PacketCaptureProtocol.ICMP }),
    ).toBe("host 10.0.0.5 and (icmp or icmp6)");
  });

  test("ICMP has no ports", () => {
    expect(errorOf({ port: "443", protocol: PacketCaptureProtocol.ICMP })).toBe(
      "ICMP has no ports. Clear the port, or pick TCP or UDP.",
    );
  });

  test("the protocol is read whatever its case", () => {
    expect(expression({ protocol: "tcp" })).toBe("tcp");
    expect(expression({ protocol: " Udp " })).toBe("udp");
  });

  test("a protocol that is not offered is refused", () => {
    expect(errorOf({ protocol: "SCTP" })).toBe(
      "Pick a protocol: any, TCP, UDP or ICMP.",
    );
  });

  test("host, port and protocol are joined with 'and'", () => {
    expect(
      expression({
        host: "10.0.0.5",
        port: "443",
        protocol: PacketCaptureProtocol.TCP,
      }),
    ).toBe("host 10.0.0.5 and tcp port 443");
    expect(expression({ host: "10.0.0.0/24", port: "53" })).toBe(
      "net 10.0.0.0/24 and port 53",
    );
    expect(
      expression({ host: "10.0.0.5", protocol: PacketCaptureProtocol.UDP }),
    ).toBe("host 10.0.0.5 and udp");
  });

  test("every expression it builds passes validate", () => {
    const hosts: Array<string> = [
      "",
      "10.0.0.5",
      "10.0.0.0/24",
      "fe80::1",
      "db",
    ];
    const ports: Array<string> = ["", "443", "8000-8080"];

    for (const host of hosts) {
      for (const port of ports) {
        for (const protocol of PacketCaptureFilterUtil.getProtocols()) {
          const built: PacketCaptureFilterBuild = build({
            host: host,
            port: port,
            protocol: protocol,
          });

          if (built.error) {
            // Only ICMP with a port is refused among these.
            expect(protocol).toBe(PacketCaptureProtocol.ICMP);
            expect(port).not.toBe("");
            continue;
          }

          expect(PacketCaptureFilterUtil.validate(built.expression)).toBeNull();
        }
      }
    }
  });
});

describe("PacketCaptureFilterUtil.validate", () => {
  test("no filter at all is fine: it keeps every packet", () => {
    expect(PacketCaptureFilterUtil.validate(undefined)).toBeNull();
    expect(PacketCaptureFilterUtil.validate(null)).toBeNull();
    expect(PacketCaptureFilterUtil.validate("")).toBeNull();
    expect(PacketCaptureFilterUtil.validate("    ")).toBeNull();
  });

  test("a filter that is not text is refused", () => {
    expect(PacketCaptureFilterUtil.validate(443)).toBe(
      "The filter must be text.",
    );
    expect(PacketCaptureFilterUtil.validate(["host", "a"])).toBe(
      "The filter must be text.",
    );
    expect(PacketCaptureFilterUtil.validate({})).toBe(
      "The filter must be text.",
    );
  });

  test("the filters people write pass", () => {
    for (const filter of [
      "host 10.0.0.5",
      "host 10.0.0.5 and (tcp port 443 or udp port 53)",
      "net 10.0.0.0/8 and not port 22",
      "tcp[tcpflags] & (tcp-syn|tcp-fin) != 0",
      "tcp[13] & 2 != 0",
      "vlan 20 and host 10.0.0.5",
      "ip6 and icmp6",
      "greater 1000",
      "ether host 00:11:22:33:44:55",
      "src host 10.0.0.5 && dst port 80",
      "udp portrange 5060-5070 || icmp",
      "! arp",
      "ip[2:2] > 576",
      "tcp port http and len <= 1500",
      "host fe80::1%eth0".replace("%eth0", ""),
      "ip proto 47 or ip proto 50",
    ]) {
      expect(PacketCaptureFilterUtil.validate(filter)).toBeNull();
    }
  });

  test("a line break, a tab or any other control character is refused", () => {
    for (const filter of [
      "host 10.0.0.5\nhost 10.0.0.6",
      "host 10.0.0.5\r",
      "host\t10.0.0.5",
      "host 10.0.0.5\u0000",
      "host 10.0.0.5\u007f",
    ]) {
      expect(PacketCaptureFilterUtil.validate(filter)).toBe(
        "Write the filter on one line.",
      );
    }
  });

  test("a filter longer than the maximum is refused, and one at it passes", () => {
    const atMaximum: string = `host ${"a".repeat(PACKET_CAPTURE_MAX_FILTER_LENGTH - 5)}`;

    expect(atMaximum).toHaveLength(PACKET_CAPTURE_MAX_FILTER_LENGTH);
    expect(PacketCaptureFilterUtil.validate(atMaximum)).toBeNull();
    expect(PacketCaptureFilterUtil.validate(`${atMaximum}a`)).toBe(
      `The filter is longer than ${PACKET_CAPTURE_MAX_FILTER_LENGTH} characters.`,
    );
  });

  test("the length is measured after spaces are tidied", () => {
    const spaced: string = `   host    10.0.0.5   `;

    expect(PacketCaptureFilterUtil.validate(spaced)).toBeNull();
  });

  /*
   * The characters a shell or an option parser would read: none of them is
   * ever part of a BPF filter, so each is refused by name.
   */
  test("every character a filter never needs is refused, by name", () => {
    for (const character of [
      ";",
      '"',
      "'",
      "`",
      "$",
      "\\",
      ",",
      "{",
      "}",
      "#",
      "@",
      "?",
      "~",
      "é",
    ]) {
      expect(
        PacketCaptureFilterUtil.validate(`host 10.0.0.5 ${character} reboot`),
      ).toBe(
        `The filter can't contain "${character}". A BPF filter is written with letters, numbers, spaces and . : / ( ) [ ] ! & | < > = + - * % ^ _`,
      );
    }
  });

  test("shell and option tricks never pass", () => {
    for (const filter of [
      "host 10.0.0.5; rm -rf /",
      "$(reboot)",
      "`reboot`",
      "host a && $(id)",
      "-w /tmp/capture",
      "--help",
      "-Z root",
    ]) {
      expect(PacketCaptureFilterUtil.validate(filter)).not.toBeNull();
    }
  });

  test("a filter that starts with a dash is refused, so it can never read as an option", () => {
    expect(PacketCaptureFilterUtil.validate("-w /tmp/x")).toBe(
      'The filter can\'t start with "-".',
    );
    expect(PacketCaptureFilterUtil.validate("  -i eth0")).toBe(
      'The filter can\'t start with "-".',
    );
  });

  test("brackets must open before they close, close in turn and hold something", () => {
    expect(PacketCaptureFilterUtil.validate("(host 10.0.0.5")).toBe(
      'The filter has a "(" that is never closed.',
    );
    expect(PacketCaptureFilterUtil.validate("tcp[13 & 2 != 0")).toBe(
      'The filter has a "[" that is never closed.',
    );
    expect(PacketCaptureFilterUtil.validate("host 10.0.0.5)")).toBe(
      'The filter closes a ")" that was never opened.',
    );
    expect(PacketCaptureFilterUtil.validate("tcp[13) & 2 != 0")).toBe(
      'The filter closes a ")" that was never opened.',
    );
    expect(PacketCaptureFilterUtil.validate("tcp]13[")).toBe(
      'The filter closes a "]" that was never opened.',
    );
    expect(PacketCaptureFilterUtil.validate("host 10.0.0.5 and ( )")).toBe(
      'The filter has an empty "()".',
    );
  });

  test("a filter cannot start with a word that joins two parts", () => {
    expect(PacketCaptureFilterUtil.validate("and host 10.0.0.5")).toBe(
      'The filter can\'t start with "and".',
    );
    expect(PacketCaptureFilterUtil.validate("OR port 53")).toBe(
      'The filter can\'t start with "OR".',
    );
    expect(PacketCaptureFilterUtil.validate("|| port 53")).toBe(
      'The filter can\'t start with "||".',
    );
    expect(PacketCaptureFilterUtil.validate("(and port 53)")).toBe(
      'The filter can\'t start with "and".',
    );
  });

  test("a filter cannot end with a word that needs something after it", () => {
    expect(PacketCaptureFilterUtil.validate("host 10.0.0.5 and")).toBe(
      'The filter ends with "and": add what should follow it.',
    );
    expect(PacketCaptureFilterUtil.validate("port 53 or")).toBe(
      'The filter ends with "or": add what should follow it.',
    );
    expect(PacketCaptureFilterUtil.validate("not")).toBe(
      'The filter ends with "not": add what should follow it.',
    );
    expect(PacketCaptureFilterUtil.validate("port 53 &&")).toBe(
      'The filter ends with "&&": add what should follow it.',
    );
    expect(PacketCaptureFilterUtil.validate("arp or !")).toBe(
      'The filter ends with "!": add what should follow it.',
    );
  });
});

describe("PacketCaptureFilterUtil.normalize", () => {
  test("trims and makes runs of spaces one, and changes nothing else", () => {
    expect(PacketCaptureFilterUtil.normalize("  host   10.0.0.5  ")).toBe(
      "host 10.0.0.5",
    );
    expect(
      PacketCaptureFilterUtil.normalize("tcp[tcpflags]  &  (tcp-syn|tcp-fin)"),
    ).toBe("tcp[tcpflags] & (tcp-syn|tcp-fin)");
    expect(PacketCaptureFilterUtil.normalize("HOST A")).toBe("HOST A");
  });

  test("no filter is the empty expression", () => {
    expect(PacketCaptureFilterUtil.normalize(null)).toBe("");
    expect(PacketCaptureFilterUtil.normalize(undefined)).toBe("");
    expect(PacketCaptureFilterUtil.normalize("")).toBe("");
  });
});

describe("PacketCaptureFilterUtil.parseProtocol", () => {
  test("nothing picked is any protocol", () => {
    expect(PacketCaptureFilterUtil.parseProtocol(undefined)).toBe(
      PacketCaptureProtocol.Any,
    );
    expect(PacketCaptureFilterUtil.parseProtocol(null)).toBe(
      PacketCaptureProtocol.Any,
    );
    expect(PacketCaptureFilterUtil.parseProtocol("")).toBe(
      PacketCaptureProtocol.Any,
    );
  });

  test("each protocol by its name, in any case", () => {
    expect(PacketCaptureFilterUtil.parseProtocol("Any")).toBe(
      PacketCaptureProtocol.Any,
    );
    expect(PacketCaptureFilterUtil.parseProtocol("tcp")).toBe(
      PacketCaptureProtocol.TCP,
    );
    expect(PacketCaptureFilterUtil.parseProtocol(" UDP ")).toBe(
      PacketCaptureProtocol.UDP,
    );
    expect(PacketCaptureFilterUtil.parseProtocol("Icmp")).toBe(
      PacketCaptureProtocol.ICMP,
    );
  });

  test("anything else is not a protocol", () => {
    expect(PacketCaptureFilterUtil.parseProtocol("sctp")).toBeUndefined();
    expect(PacketCaptureFilterUtil.parseProtocol(6)).toBeUndefined();
    expect(PacketCaptureFilterUtil.parseProtocol(true)).toBeUndefined();
  });
});

describe("getIPv4Network", () => {
  test("clears the host bits", () => {
    expect(getIPv4Network("10.0.0.5", 24)).toBe("10.0.0.0");
    expect(getIPv4Network("192.168.1.130", 25)).toBe("192.168.1.128");
    expect(getIPv4Network("192.168.1.127", 25)).toBe("192.168.1.0");
    expect(getIPv4Network("255.255.255.255", 1)).toBe("128.0.0.0");
    expect(getIPv4Network("10.20.30.40", 16)).toBe("10.20.0.0");
  });

  test("/32 is the address and /0 is every address", () => {
    expect(getIPv4Network("10.20.30.40", 32)).toBe("10.20.30.40");
    expect(getIPv4Network("10.20.30.40", 0)).toBe("0.0.0.0");
  });
});

describe("getIPv6Network", () => {
  test("clears the host bits and writes the result short", () => {
    expect(getIPv6Network("2001:db8::5", 64)).toBe("2001:db8::");
    expect(getIPv6Network("2001:db8:1:2:3:4:5:6", 48)).toBe("2001:db8:1::");
    expect(getIPv6Network("2001:db8:1:2:3:4:5:6", 56)).toBe("2001:db8:1::");
    expect(getIPv6Network("2001:db8:1:ff:3:4:5:6", 60)).toBe("2001:db8:1:f0::");
    expect(getIPv6Network("fe80::1", 10)).toBe("fe80::");
  });

  test("/128 is the address and /0 is every address", () => {
    expect(getIPv6Network("1:2:3:4:5:6:7:8", 128)).toBe("1:2:3:4:5:6:7:8");
    expect(getIPv6Network("1:2:3:4:5:6:7:8", 0)).toBe("::");
  });

  test("the longest run of zero groups is the one written '::'", () => {
    expect(getIPv6Network("1:0:0:2:0:0:0:3", 128)).toBe("1:0:0:2::3");
    expect(getIPv6Network("1:0:0:2:3:0:0:4", 128)).toBe("1::2:3:0:0:4");
    expect(getIPv6Network("1:0:2:3:4:5:6:7", 128)).toBe("1:0:2:3:4:5:6:7");
  });

  test("reads an IPv4 address at the end", () => {
    expect(getIPv6Network("::ffff:10.0.0.5", 128)).toBe("::ffff:a00:5");
    expect(getIPv6Network("::ffff:10.0.0.5", 120)).toBe("::ffff:a00:0");
  });

  test("null for what it cannot read", () => {
    expect(getIPv6Network("1::2::3", 64)).toBeNull();
    expect(getIPv6Network("1:2:3", 64)).toBeNull();
    expect(getIPv6Network("1:2:3:4:5:6:7:8:9", 64)).toBeNull();
    expect(getIPv6Network("1:2:3:4::5:6:7:8", 64)).toBeNull();
    expect(getIPv6Network("12345::", 64)).toBeNull();
    expect(getIPv6Network("::ffff:10.0.0.256", 64)).toBeNull();
  });
});

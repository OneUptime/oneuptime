import IP from "../IP/IP";
import { PACKET_CAPTURE_MAX_FILTER_LENGTH } from "./PacketCaptureLimits";

/*
 * Which packets a capture keeps, as a BPF filter expression - the language
 * tcpdump and Wireshark's capture filters speak ("host 10.0.0.5 and tcp port
 * 443"). Most people never write one: the dashboard asks for a host, a port
 * and a protocol and builds the expression here (buildFromSimple). Anyone who
 * knows BPF can write their own, and it is checked here before it is saved
 * (validate).
 *
 * The probe hands the expression to tcpdump as ONE argument, after "--",
 * through execFile - never through a shell - so it can only ever be read as a
 * filter. validate() is the second line: it refuses everything a BPF filter
 * never needs (quotes, semicolons, backticks, dollar signs, line breaks, a
 * leading dash) and catches the mistakes that are easy to spot before the
 * probe does (an unclosed bracket, a dangling "and"), so a person hears about
 * them while they are still looking at the form. tcpdump itself is the final
 * judge of the grammar: a filter it cannot compile fails the capture with
 * tcpdump's own words.
 */

export enum PacketCaptureProtocol {
  Any = "Any",
  TCP = "TCP",
  UDP = "UDP",
  ICMP = "ICMP",
}

export interface SimplePacketCaptureFilter {
  // An IP address, a network (10.0.0.0/24) or a host name. Empty: any host.
  host?: string | undefined;
  // A port (443) or a range of ports (8000-8080). Empty: any port.
  port?: string | undefined;
  protocol?: PacketCaptureProtocol | string | undefined;
}

export interface PacketCaptureFilterBuild {
  // The BPF expression; empty when the capture keeps every packet.
  expression: string;
  // What is wrong with the fields, in words; null when nothing is.
  error: string | null;
}

/*
 * Every character a BPF filter is written with: names and numbers, spaces,
 * the address separators (. : /), grouping ( ) [ ], and the operators
 * ! & | < > = + - * % ^. Anything else - a quote, a semicolon, a backtick,
 * a dollar sign, a backslash - has no place in one.
 */
const FILTER_CHARACTERS: RegExp = /^[A-Za-z0-9 .:/()[\]!&|<>=+*%^_-]*$/;
const NOT_A_FILTER_CHARACTER: RegExp = /[^A-Za-z0-9 .:/()[\]!&|<>=+*%^_-]/;
const WHITESPACE_RUN: RegExp = / +/g;
const TOKEN_SEPARATOR: RegExp = /[\s()]+/;

const PORT: RegExp = /^\d{1,5}$/;
const PORT_RANGE: RegExp = /^(\d{1,5})\s*-\s*(\d{1,5})$/;
const NETWORK: RegExp = /^([^/\s]+)\/(\d{1,3})$/;
const HOST_NAME: RegExp =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.?$/;

// Words that join two parts of a filter, so a filter cannot start with them.
const JOINING_WORDS: ReadonlyArray<string> = ["and", "or", "&&", "||"];

// Words that need something after them, so a filter cannot end with them.
const OPEN_ENDED_WORDS: ReadonlyArray<string> = [...JOINING_WORDS, "not", "!"];

/*
 * The words of the BPF language (pcap-filter(7)). A host typed into the host
 * box that is one of these would be read as the word, not a host - "host
 * port" is a syntax error, not a host named port - so it is refused there.
 */
const BPF_KEYWORDS: ReadonlyArray<string> = [
  "aarp",
  "ah",
  "and",
  "arp",
  "atalk",
  "broadcast",
  "decnet",
  "dst",
  "esp",
  "ether",
  "fddi",
  "gateway",
  "greater",
  "host",
  "icmp",
  "icmp6",
  "igmp",
  "igrp",
  "inbound",
  "ip",
  "ip6",
  "ipx",
  "iso",
  "len",
  "less",
  "link",
  "mpls",
  "multicast",
  "net",
  "netbeui",
  "not",
  "or",
  "outbound",
  "pim",
  "port",
  "portrange",
  "proto",
  "rarp",
  "sctp",
  "src",
  "stp",
  "tcp",
  "tr",
  "udp",
  "vlan",
  "vrrp",
  "wlan",
];

const BRACKET_PAIRS: Record<string, string> = { ")": "(", "]": "[" };

const IPV6_GROUP: RegExp = /^[0-9a-fA-F]{1,4}$/;

/*
 * The network an IPv4 address with a prefix length is in, its host bits
 * cleared: 10.0.0.5 with 24 is 10.0.0.0. The address is a valid IPv4 one.
 */
export function getIPv4Network(address: string, prefixLength: number): string {
  const octets: Array<number> = address.split(".").map(Number);
  const value: number =
    (((octets[0] || 0) << 24) >>> 0) +
    ((octets[1] || 0) << 16) +
    ((octets[2] || 0) << 8) +
    (octets[3] || 0);

  // A shift by 32 is a no-op in JavaScript, so /0 is the all-zero mask.
  const mask: number =
    prefixLength <= 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  const network: number = (value & mask) >>> 0;

  return [
    (network >>> 24) & 255,
    (network >>> 16) & 255,
    (network >>> 8) & 255,
    network & 255,
  ].join(".");
}

// An IPv6 address's eight 16-bit groups, or null when it cannot be read.
function readIPv6Groups(address: string): Array<number> | null {
  const halves: Array<string> = address.split("::");

  if (halves.length > 2) {
    return null;
  }

  const readHalf: (text: string) => Array<number> | null = (
    text: string,
  ): Array<number> | null => {
    if (!text) {
      return [];
    }

    const groups: Array<number> = [];
    const pieces: Array<string> = text.split(":");

    for (let index: number = 0; index < pieces.length; index++) {
      const piece: string = pieces[index] || "";

      // An IPv4 address may end one: ::ffff:10.0.0.5.
      if (piece.includes(".") && index === pieces.length - 1) {
        const octets: Array<number> = piece.split(".").map(Number);

        if (
          octets.length !== 4 ||
          octets.some((octet: number): boolean => {
            return !Number.isInteger(octet) || octet < 0 || octet > 255;
          })
        ) {
          return null;
        }

        groups.push(
          (octets[0]! << 8) | octets[1]!,
          (octets[2]! << 8) | octets[3]!,
        );
        continue;
      }

      if (!IPV6_GROUP.test(piece)) {
        return null;
      }

      groups.push(Number.parseInt(piece, 16));
    }

    return groups;
  };

  const head: Array<number> | null = readHalf(halves[0] || "");
  const tail: Array<number> | null =
    halves.length === 2 ? readHalf(halves[1] || "") : [];

  if (!head || !tail) {
    return null;
  }

  if (halves.length === 1) {
    return head.length === 8 ? head : null;
  }

  // "::" stands for at least one group of zeros.
  const missing: number = 8 - head.length - tail.length;

  if (missing < 1) {
    return null;
  }

  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

/*
 * The network an IPv6 address with a prefix length is in, its host bits
 * cleared and written short: 2001:db8::5 with 64 is 2001:db8::. Null when
 * the address cannot be read.
 */
export function getIPv6Network(
  address: string,
  prefixLength: number,
): string | null {
  const groups: Array<number> | null = readIPv6Groups(address);

  if (!groups) {
    return null;
  }

  const masked: Array<number> = groups.map(
    (group: number, index: number): number => {
      const bits: number = Math.max(0, Math.min(16, prefixLength - index * 16));

      return bits === 0 ? 0 : group & ((0xffff << (16 - bits)) & 0xffff);
    },
  );

  // The longest run of two or more zero groups is written "::" (RFC 5952).
  let bestStart: number = -1;
  let bestLength: number = 0;

  for (let index: number = 0; index < masked.length; ) {
    if (masked[index] !== 0) {
      index++;
      continue;
    }

    let end: number = index;

    while (end < masked.length && masked[end] === 0) {
      end++;
    }

    if (end - index > bestLength) {
      bestStart = index;
      bestLength = end - index;
    }

    index = end;
  }

  const hex: Array<string> = masked.map((group: number): string => {
    return group.toString(16);
  });

  if (bestLength < 2) {
    return hex.join(":");
  }

  return `${hex.slice(0, bestStart).join(":")}::${hex.slice(bestStart + bestLength).join(":")}`;
}

export default class PacketCaptureFilterUtil {
  public static getProtocols(): Array<PacketCaptureProtocol> {
    return [
      PacketCaptureProtocol.Any,
      PacketCaptureProtocol.TCP,
      PacketCaptureProtocol.UDP,
      PacketCaptureProtocol.ICMP,
    ];
  }

  /*
   * The expression a host, a port and a protocol stand for, joined with
   * "and": "host 10.0.0.5 and tcp port 443". Every field may be left empty;
   * all of them empty is the empty expression, which keeps every packet.
   */
  public static buildFromSimple(
    filter: SimplePacketCaptureFilter,
  ): PacketCaptureFilterBuild {
    const parts: Array<string> = [];

    const host: string = (filter.host || "").trim();

    if (host) {
      const hostPart: string | { error: string } =
        PacketCaptureFilterUtil.buildHostPart(host);

      if (typeof hostPart !== "string") {
        return { expression: "", error: hostPart.error };
      }

      parts.push(hostPart);
    }

    const protocol: PacketCaptureProtocol | undefined =
      PacketCaptureFilterUtil.parseProtocol(filter.protocol);

    if (!protocol) {
      return {
        expression: "",
        error: "Pick a protocol: any, TCP, UDP or ICMP.",
      };
    }

    const port: string = (filter.port || "").trim();
    let portPart: string = "";

    if (port) {
      const builtPort: string | { error: string } =
        PacketCaptureFilterUtil.buildPortPart(port);

      if (typeof builtPort !== "string") {
        return { expression: "", error: builtPort.error };
      }

      if (protocol === PacketCaptureProtocol.ICMP) {
        return {
          expression: "",
          error: "ICMP has no ports. Clear the port, or pick TCP or UDP.",
        };
      }

      portPart = builtPort;
    }

    if (protocol === PacketCaptureProtocol.TCP) {
      parts.push(portPart ? `tcp ${portPart}` : "tcp");
    } else if (protocol === PacketCaptureProtocol.UDP) {
      parts.push(portPart ? `udp ${portPart}` : "udp");
    } else if (protocol === PacketCaptureProtocol.ICMP) {
      parts.push(parts.length > 0 ? "(icmp or icmp6)" : "icmp or icmp6");
    } else if (portPart) {
      parts.push(portPart);
    }

    const expression: string = parts.join(" and ");

    return {
      expression: expression,
      error: PacketCaptureFilterUtil.validate(expression),
    };
  }

  /*
   * What is wrong with a BPF expression, in words, or null when nothing this
   * side of tcpdump can tell. The empty expression is fine: it keeps every
   * packet.
   */
  public static validate(expression: unknown): string | null {
    if (expression === undefined || expression === null) {
      return null;
    }

    if (typeof expression !== "string") {
      return "The filter must be text.";
    }

    if (PacketCaptureFilterUtil.hasControlCharacter(expression)) {
      return "Write the filter on one line.";
    }

    const filter: string = PacketCaptureFilterUtil.normalize(expression);

    if (!filter) {
      return null;
    }

    if (filter.length > PACKET_CAPTURE_MAX_FILTER_LENGTH) {
      return `The filter is longer than ${PACKET_CAPTURE_MAX_FILTER_LENGTH} characters.`;
    }

    if (!FILTER_CHARACTERS.test(filter)) {
      const character: string = NOT_A_FILTER_CHARACTER.exec(filter)?.[0] || "";

      return `The filter can't contain "${character}". A BPF filter is written with letters, numbers, spaces and . : / ( ) [ ] ! & | < > = + - * % ^ _`;
    }

    if (filter.startsWith("-")) {
      return 'The filter can\'t start with "-".';
    }

    const bracketError: string | null =
      PacketCaptureFilterUtil.findBracketError(filter);

    if (bracketError) {
      return bracketError;
    }

    const words: Array<string> = filter
      .split(TOKEN_SEPARATOR)
      .filter((word: string): boolean => {
        return word.length > 0;
      });

    const firstWord: string = (words[0] || "").toLowerCase();

    if (JOINING_WORDS.includes(firstWord)) {
      return `The filter can't start with "${words[0]}".`;
    }

    const lastWord: string = (words[words.length - 1] || "").toLowerCase();

    if (OPEN_ENDED_WORDS.includes(lastWord)) {
      return `The filter ends with "${words[words.length - 1]}": add what should follow it.`;
    }

    return null;
  }

  /*
   * The expression as it is stored and run: trimmed, with runs of spaces
   * made one. Nothing else changes, so what someone typed is what tcpdump
   * reads.
   */
  public static normalize(expression: string | null | undefined): string {
    return (expression || "").trim().replace(WHITESPACE_RUN, " ");
  }

  public static parseProtocol(
    value: unknown,
  ): PacketCaptureProtocol | undefined {
    if (value === undefined || value === null || value === "") {
      return PacketCaptureProtocol.Any;
    }

    if (typeof value !== "string") {
      return undefined;
    }

    return PacketCaptureFilterUtil.getProtocols().find(
      (protocol: PacketCaptureProtocol): boolean => {
        return protocol.toLowerCase() === value.trim().toLowerCase();
      },
    );
  }

  private static buildHostPart(host: string): string | { error: string } {
    const notAHost: { error: string } = {
      error: `"${host}" is not an IP address, a network such as 10.0.0.0/24, or a host name.`,
    };

    if (host.length > 253) {
      return notAHost;
    }

    if (host.includes("%")) {
      return {
        error: `Leave the zone out of "${host}": write the address without "%".`,
      };
    }

    const network: RegExpExecArray | null = NETWORK.exec(host);

    if (network) {
      const address: string = network[1] || "";
      const prefixLength: number = Number(network[2]);

      // new IP() throws on anything that is not an address.
      if (!IP.isIP(address)) {
        return notAHost;
      }

      const ip: IP = new IP(address);

      /*
       * tcpdump refuses a network with host bits set ("non-network bits set
       * in 10.0.0.5/24"), and an address with its subnet's prefix length is
       * the commonest way to write one: so the network it is in is what is
       * built, and the form shows it.
       */
      if (ip.isIPv4() && prefixLength >= 0 && prefixLength <= 32) {
        return `net ${getIPv4Network(address, prefixLength)}/${prefixLength}`;
      }

      if (ip.isIPv6() && prefixLength >= 0 && prefixLength <= 128) {
        return `net ${getIPv6Network(address, prefixLength) || address}/${prefixLength}`;
      }

      return notAHost;
    }

    if (IP.isIP(host)) {
      return `host ${host}`;
    }

    if (BPF_KEYWORDS.includes(host.toLowerCase())) {
      return {
        error: `"${host}" is a word of the filter language, not a host. Write an IP address or a full host name.`,
      };
    }

    if (HOST_NAME.test(host)) {
      return `host ${host}`;
    }

    return notAHost;
  }

  private static buildPortPart(port: string): string | { error: string } {
    const notAPort: { error: string } = {
      error:
        "The port must be a number from 1 to 65535, or a range such as 8000-8080.",
    };

    if (PORT.test(port)) {
      const value: number = Number(port);

      return PacketCaptureFilterUtil.isPortNumber(value)
        ? `port ${value}`
        : notAPort;
    }

    const range: RegExpExecArray | null = PORT_RANGE.exec(port);

    if (range) {
      const from: number = Number(range[1]);
      const to: number = Number(range[2]);

      if (
        !PacketCaptureFilterUtil.isPortNumber(from) ||
        !PacketCaptureFilterUtil.isPortNumber(to)
      ) {
        return notAPort;
      }

      if (from > to) {
        return {
          error: `The port range ${from}-${to} runs backwards. Write the lower port first.`,
        };
      }

      return from === to ? `port ${from}` : `portrange ${from}-${to}`;
    }

    return notAPort;
  }

  // A line break, a tab, a NUL or any other control character.
  private static hasControlCharacter(text: string): boolean {
    for (let index: number = 0; index < text.length; index++) {
      const code: number = text.charCodeAt(index);

      if (code < 32 || code === 127) {
        return true;
      }
    }

    return false;
  }

  private static isPortNumber(value: number): boolean {
    return Number.isInteger(value) && value >= 1 && value <= 65535;
  }

  // The first bracket that is not closed, closed twice or closed out of turn.
  private static findBracketError(filter: string): string | null {
    const open: Array<string> = [];

    for (let index: number = 0; index < filter.length; index++) {
      const character: string = filter.charAt(index);

      if (character === "(" || character === "[") {
        open.push(character);
        continue;
      }

      if (character !== ")" && character !== "]") {
        continue;
      }

      const expected: string | undefined = BRACKET_PAIRS[character];

      if (open.length === 0 || open[open.length - 1] !== expected) {
        return `The filter closes a "${character}" that was never opened.`;
      }

      open.pop();

      if (character === ")" && filter.slice(0, index).trimEnd().endsWith("(")) {
        return 'The filter has an empty "()".';
      }
    }

    if (open.length > 0) {
      return `The filter has a "${open[open.length - 1]}" that is never closed.`;
    }

    return null;
  }
}

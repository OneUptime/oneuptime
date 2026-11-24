import NetworkAddressBlockUtil from "../../Utils/NetworkTraffic/NetworkAddressBlock";
import { SecurityBlockValue, readSecurityBlockValue } from "./SecurityBlock";

/*
 * EVERY WAY A SOURCE MAY HAVE WRITTEN ONE ADDRESS.
 *
 * Telemetry keeps a client's address as the app or its proxy wrote it, so
 * a reader that looks for an address by one spelling misses the others:
 * 2001:db8::7 is also written 2001:0db8:0:0:0:0:0:7 or in capitals, and an
 * IPv4 client of a dual-stack server is often ::ffff:203.0.113.7. The
 * signed-in check (#10350) and a case's address step checks (#10744) look
 * for every spelling.
 */

/*
 * As blocks are written (IPv4 dotted, IPv6 compressed in lower case), IPv6
 * written out in full, either in capitals, and an IPv4 address an IPv6 one
 * maps. Empty for a value that is not one address.
 */
export function getSecurityAddressSpellings(address: string): Array<string> {
  const read: SecurityBlockValue | null = readSecurityBlockValue(address);

  if (!read || !NetworkAddressBlockUtil.isSingleAddress(read.block)) {
    return [];
  }

  const spellings: Set<string> = new Set([read.value]);

  if (read.block.family === 4) {
    spellings.add(`::ffff:${read.value}`);
  } else {
    const expanded: string = expandIpv6(read.value);

    spellings.add(expanded);
    spellings.add(read.value.toUpperCase());
    spellings.add(expanded.toUpperCase());
  }

  return Array.from(spellings);
}

// The largest port a value may name after an address.
const MAX_PORT: number = 65535;

// Whether text is ":" and a port: ":443".
function isPortSuffix(text: string): boolean {
  const port: string = text.slice(1);

  if (!text.startsWith(":") || !port || port.length > 5) {
    return false;
  }

  for (let index: number = 0; index < port.length; index++) {
    const code: number = port.charCodeAt(index);

    if (code < 48 || code > 57) {
      return false;
    }
  }

  return Number(port) <= MAX_PORT;
}

/*
 * The one address a value names, as blocks write it, however a source
 * wrote what is around it (#10744): in brackets ("[2001:db8::7]"), with the
 * client's port ("[2001:db8::7]:443", "203.0.113.7:51234" and
 * "::ffff:203.0.113.7:51234": nothing of an IPv6 address follows its
 * dotted part), or with a zone ("fe80::1%eth0", or "%25eth0" as a URL
 * writes it), which names a machine's interface, not the address. Null for
 * anything else - a range, a name - and an IPv6 address written bare is
 * never read as having a port: "2001:db8::7:443" is another address.
 */
export function readSecurityAddress(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  let address: string = value.trim();

  if (address.startsWith("[")) {
    const close: number = address.indexOf("]");
    const after: string = close === -1 ? "" : address.slice(close + 1);

    if (close < 2 || (after && !isPortSuffix(after))) {
      return null;
    }

    address = address.slice(1, close);
  } else {
    const lastDot: number = address.lastIndexOf(".");
    const colonAfterDot: number =
      lastDot === -1 ? -1 : address.indexOf(":", lastDot);

    if (colonAfterDot !== -1) {
      if (!isPortSuffix(address.slice(colonAfterDot))) {
        return null;
      }

      address = address.slice(0, colonAfterDot);
    }
  }

  const zone: number = address.indexOf("%");

  return NetworkAddressBlockUtil.canonicalAddress(
    zone === -1 ? address : address.slice(0, zone),
  );
}

// An IPv6 address written out in full: eight groups, each without leading zeros, as some sources write it.
export function expandIpv6(address: string): string {
  const halves: Array<string> = address.split("::");
  const head: Array<string> = halves[0] ? halves[0].split(":") : [];
  const tail: Array<string> =
    halves.length > 1 && halves[1] ? halves[1].split(":") : [];
  const missing: number =
    halves.length > 1 ? Math.max(0, 8 - head.length - tail.length) : 0;

  return [...head, ...new Array(missing).fill("0"), ...tail]
    .map((group: string): string => {
      return group.replace(/^0+(?=.)/, "");
    })
    .join(":");
}

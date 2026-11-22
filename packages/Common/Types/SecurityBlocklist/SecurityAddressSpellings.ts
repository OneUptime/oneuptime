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

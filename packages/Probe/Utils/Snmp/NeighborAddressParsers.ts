import {
  SnmpTableRows,
  toCellNumber,
  toIpAddressString,
} from "./EndpointTableParsers";

/*
 * Pure parsers for the MANAGEMENT ADDRESS a discovery-protocol neighbor
 * advertises about itself — the one thing LLDP and CDP report that the
 * topology could not previously read, and the only field that makes an
 * unmanaged peer on the map actionable rather than merely visible.
 *
 * Split out from SnmpMonitor for the same reason EndpointTableParsers was:
 * both addresses arrive in awkward shapes (a raw four-byte OctetString in
 * one protocol, an index suffix in the other) and every decoding rule here
 * is worth testing against canned tables rather than against live gear.
 *
 * The row shape is net-snmp's session.tableColumns output — rows keyed by
 * the composite row index, each row keyed by column number as a string.
 */

/*
 * CISCO-CDP-MIB cdpCacheTable columns carrying the neighbor's address.
 * cdpCacheAddress is an OctetString holding the raw address bytes, so
 * cdpCacheAddressType has to say what those bytes mean before they can be
 * read — the same four bytes are a v4 address or the first quarter of
 * something else depending on it.
 */
export const CDP_CACHE_ADDRESS_COLUMNS: {
  cdpCacheAddressType: number;
  cdpCacheAddress: number;
} = {
  cdpCacheAddressType: 3,
  cdpCacheAddress: 4,
};

// cdpCacheAddressType, from the CiscoNetworkProtocol textual convention.
const CDP_ADDRESS_TYPE_IP: number = 1;

/*
 * LLDP-MIB lldpRemManAddrTable — the neighbor's management addresses, one
 * row per address. It is a table of its own rather than a column on
 * lldpRemTable because a neighbor may advertise several, and the ADDRESS
 * ITSELF is part of the row index:
 *
 *   timeMark . localPortNum . remIndex . addrSubtype . addrLen . a.b.c.d
 *
 * so the value we want is read off the key, not out of a cell. Any column
 * will do to enumerate the rows; lldpRemManAddrIfSubtype is the first
 * accessible one.
 */
export const LLDP_REM_MAN_ADDR_TABLE_OID: string = "1.0.8802.1.1.2.1.4.2";
export const LLDP_REM_MAN_ADDR_COLUMNS: {
  lldpRemManAddrIfSubtype: number;
} = {
  lldpRemManAddrIfSubtype: 3,
};

/*
 * lldpRemManAddrSubtype, from the IANA address-family numbers: 1 is IPv4.
 * IPv6 (2) rows are skipped rather than decoded — everything downstream
 * (the device hostname, the probe's reachability check, the subnet rules)
 * is written for v4, and a v6 literal in a hostname column would fail at
 * the point of use rather than here.
 */
const LLDP_MAN_ADDR_SUBTYPE_IPV4: number = 1;
const IPV4_ADDRESS_LENGTH: number = 4;

// timeMark, localPortNum, remIndex, addrSubtype, addrLen — then the address.
const ADDRESS_OFFSET_IN_INDEX: number = 5;

const DECIMAL_OCTET_REGEX: RegExp = /^\d{1,3}$/;

/*
 * One rule for what counts as a usable IPv4 address, applied to BOTH
 * protocols.
 *
 * The two arrive by completely different routes — four raw bytes in a CDP
 * cell, decimal components off an LLDP row index — and the temptation is to
 * validate each where it is decoded. That is how they drifted in review:
 * the LLDP half refused the unset address and the CDP half handed it
 * straight on, so the same absent management address became an empty field
 * on one protocol and a hostname of "0.0.0.0" on the other.
 *
 * Refuses:
 *   - anything that is not four dotted decimal components,
 *   - an octet above 255 (net-snmp's IpAddress strings are not validated,
 *     and neither is a stringifying agent's),
 *   - 0.0.0.0, which is what an agent reports for an address it does not
 *     have. It is not somewhere a device can be monitored, and letting it
 *     through pre-fills a hostname guaranteed to fail — and, worse, gives
 *     every address-less neighbour on the estate the same one.
 */
export function normalizeIpv4(address: string | undefined): string | undefined {
  if (!address) {
    return undefined;
  }

  const parts: Array<string> = address.trim().split(".");
  if (parts.length !== IPV4_ADDRESS_LENGTH) {
    return undefined;
  }

  for (const part of parts) {
    if (!DECIMAL_OCTET_REGEX.test(part) || parseInt(part, 10) > 255) {
      return undefined;
    }
  }

  const normalized: string = parts.join(".");
  return normalized === "0.0.0.0" ? undefined : normalized;
}

/*
 * The neighbor's IPv4 address from one cdpCacheTable row, or undefined.
 *
 * Undefined is the common answer and not a failure: the column is optional,
 * plenty of agents leave it empty, and a neighbor reachable only over a
 * non-IP protocol has nothing to put here. A row whose type column says
 * something other than IP is refused outright rather than read hopefully —
 * decoding four bytes of an AppleTalk address as a v4 address would invent
 * an address that exists nowhere.
 */
export function cdpAddressFromRow(
  row: Record<string, unknown> | undefined,
): string | undefined {
  if (!row) {
    return undefined;
  }

  const addressType: number | undefined = toCellNumber(
    row[CDP_CACHE_ADDRESS_COLUMNS.cdpCacheAddressType.toString()],
  );

  /*
   * A missing type is treated as "unknown", not as "IP". Agents that
   * populate the address always populate the type alongside it, so a row
   * with one and not the other is malformed rather than terse.
   */
  if (addressType !== CDP_ADDRESS_TYPE_IP) {
    return undefined;
  }

  return normalizeIpv4(
    toIpAddressString(
      row[CDP_CACHE_ADDRESS_COLUMNS.cdpCacheAddress.toString()],
    ),
  );
}

/*
 * The join key between an lldpRemTable row and an lldpRemManAddrTable row:
 * "localPortNum.remIndex".
 *
 * The time mark is deliberately NOT part of it. It is the first index
 * component of both tables and it is a sysUpTime stamp, so an agent that
 * refreshed one table between the two walks reports the same neighbor under
 * two different marks — joining on it would silently drop every address on
 * exactly the busy devices that have the most of them.
 */
export function lldpNeighborJoinKey(rowKey: string): string | undefined {
  const parts: Array<string> = rowKey.split(".");
  if (parts.length < 3) {
    return undefined;
  }

  /*
   * Both tables put these two at the same offsets — lldpRemTable's index
   * stops there, lldpRemManAddrTable's runs on past them — so the caller
   * passes whichever key it holds and both land on the same string.
   */
  const localPortNum: string | undefined = parts[1];
  const remIndex: string | undefined = parts[2];

  if (!localPortNum || !remIndex) {
    return undefined;
  }

  return `${localPortNum}.${remIndex}`;
}

/*
 * Every neighbor's IPv4 management address, keyed by `lldpNeighborJoinKey`.
 *
 * Rows are read in sorted key order and the FIRST address for a neighbor
 * wins, so a device advertising several (a loopback and an SVI, say) always
 * resolves to the same one — an address that changed between polls would
 * churn the device's hostname and, through it, the map.
 */
export function parseLldpManagementAddresses(
  rows: SnmpTableRows,
): Map<string, string> {
  const addressByJoinKey: Map<string, string> = new Map<string, string>();

  for (const rowKey of Object.keys(rows).sort()) {
    const parts: Array<string> = rowKey.split(".");

    /*
     * timeMark . localPortNum . remIndex . addrSubtype . addrLen . <addr>
     * — five components before the address itself, so a shorter key is not
     * this table's.
     */
    if (parts.length < ADDRESS_OFFSET_IN_INDEX) {
      continue;
    }

    const addressSubtype: number | undefined = toCellNumber(parts[3]);
    const addressLength: number | undefined = toCellNumber(parts[4]);

    if (
      addressSubtype !== LLDP_MAN_ADDR_SUBTYPE_IPV4 ||
      addressLength !== IPV4_ADDRESS_LENGTH
    ) {
      continue;
    }

    /*
     * The key has to hold EXACTLY the four octets its own length component
     * promised. Slicing a fixed window out of a longer key instead would
     * read a malformed row into an address that looks perfectly valid.
     */
    if (parts.length !== ADDRESS_OFFSET_IN_INDEX + IPV4_ADDRESS_LENGTH) {
      continue;
    }

    const address: string | undefined = normalizeIpv4(
      parts.slice(ADDRESS_OFFSET_IN_INDEX).join("."),
    );
    if (!address) {
      continue;
    }

    const joinKey: string | undefined = lldpNeighborJoinKey(rowKey);
    if (!joinKey || addressByJoinKey.has(joinKey)) {
      continue;
    }

    addressByJoinKey.set(joinKey, address);
  }

  return addressByJoinKey;
}

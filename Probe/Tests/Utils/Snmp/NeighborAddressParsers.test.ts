import { describe, expect, test } from "@jest/globals";
import { SnmpTableRows } from "../../../Utils/Snmp/EndpointTableParsers";
import {
  CDP_CACHE_ADDRESS_COLUMNS,
  LLDP_REM_MAN_ADDR_COLUMNS,
  LLDP_REM_MAN_ADDR_TABLE_OID,
  cdpAddressFromRow,
  lldpNeighborJoinKey,
  normalizeIpv4,
  parseLldpManagementAddresses,
} from "../../../Utils/Snmp/NeighborAddressParsers";

/*
 * The management address a discovery-protocol neighbour advertises about
 * itself is the field that turns an unmanaged peer on the topology map from
 * something an operator can only look at into something they can monitor
 * (issue #3435). It arrives in two awkward shapes — four raw bytes in a CDP
 * cache cell, and a run of decimal components inside an LLDP row INDEX — so
 * every decoding rule is pinned here against canned tables rather than
 * against live gear.
 *
 * Fixtures mirror net-snmp's session.tableColumns output exactly: rows keyed
 * by the (composite) row index, each row keyed by column number as a string,
 * values raw varbind values.
 */

const ADDRESS_TYPE_COLUMN: string =
  CDP_CACHE_ADDRESS_COLUMNS.cdpCacheAddressType.toString();
const ADDRESS_COLUMN: string =
  CDP_CACHE_ADDRESS_COLUMNS.cdpCacheAddress.toString();

describe("LLDP management address table OID", () => {
  /*
   * The TABLE OID, never the Entry OID: the walker appends the ".1." Entry
   * subid itself. Including it here would walk one level too deep — a
   * subtree that resolves cleanly to zero rows — so every neighbour would
   * silently lose its address with no error at any log level.
   */
  test("is the lldpRemManAddrTable OID with no Entry subid", () => {
    expect(LLDP_REM_MAN_ADDR_TABLE_OID).toBe("1.0.8802.1.1.2.1.4.2");
    expect(LLDP_REM_MAN_ADDR_TABLE_OID.endsWith(".1")).toBe(false);
  });

  /*
   * Columns 1 and 2 (lldpRemManAddrSubtype, lldpRemManAddr) are index
   * objects and not-accessible, so asking for them returns nothing. Column 3
   * is the first readable one, and the walk only needs the rows to exist —
   * the value it wants is in the key.
   */
  test("enumerates rows through an accessible column", () => {
    expect(LLDP_REM_MAN_ADDR_COLUMNS.lldpRemManAddrIfSubtype).toBe(3);
  });
});

describe("cdpAddressFromRow", () => {
  test("decodes a four-byte address buffer when the type column says IP", () => {
    expect(
      cdpAddressFromRow({
        [ADDRESS_TYPE_COLUMN]: 1,
        [ADDRESS_COLUMN]: Buffer.from([10, 0, 12, 41]),
      }),
    ).toBe("10.0.12.41");
  });

  /*
   * Some agents hand IpAddress varbinds over already formatted. Both shapes
   * have to decode to the same string or a device would appear at two
   * different addresses depending on which agent described it.
   */
  test("accepts an address an agent has already formatted", () => {
    expect(
      cdpAddressFromRow({
        [ADDRESS_TYPE_COLUMN]: 1,
        [ADDRESS_COLUMN]: "192.168.4.7",
      }),
    ).toBe("192.168.4.7");
  });

  /*
   * cdpCacheAddress is an OctetString whose meaning is decided ENTIRELY by
   * cdpCacheAddressType. Reading four bytes of a non-IP address as an IPv4
   * address would invent an address that exists nowhere on the network, and
   * then pre-fill a device's hostname with it.
   */
  test("refuses an address whose type column is not IP", () => {
    expect(
      cdpAddressFromRow({
        [ADDRESS_TYPE_COLUMN]: 2,
        [ADDRESS_COLUMN]: Buffer.from([10, 0, 12, 41]),
      }),
    ).toBeUndefined();
  });

  test("refuses an address with no type column at all", () => {
    expect(
      cdpAddressFromRow({
        [ADDRESS_COLUMN]: Buffer.from([10, 0, 12, 41]),
      }),
    ).toBeUndefined();
  });

  test("returns undefined when the row carries a type but no address", () => {
    expect(
      cdpAddressFromRow({
        [ADDRESS_TYPE_COLUMN]: 1,
      }),
    ).toBeUndefined();
  });

  /*
   * A 16-byte IPv6 address arriving under an IP type code. Everything
   * downstream of this — the device hostname column, the probe's reach
   * check, the subnet assignment rules — is written for v4.
   */
  test("returns undefined for an address that is not four bytes", () => {
    expect(
      cdpAddressFromRow({
        [ADDRESS_TYPE_COLUMN]: 1,
        [ADDRESS_COLUMN]: Buffer.from(new Array(16).fill(1)),
      }),
    ).toBeUndefined();
  });

  test("an absent row is not an error", () => {
    expect(cdpAddressFromRow(undefined)).toBeUndefined();
    expect(cdpAddressFromRow({})).toBeUndefined();
  });

  /*
   * 0.0.0.0 is what an agent reports for a neighbour whose management
   * address is not set — an IP phone that has not taken a DHCP lease yet, a
   * neighbour whose management SVI is down. Pre-filling it would hand the
   * operator a hostname guaranteed to fail, and give EVERY address-less
   * neighbour on the estate the same one. The LLDP half of this module has
   * always refused it; this is the CDP half being held to the same rule.
   */
  test("refuses the unset address, the same way the LLDP path does", () => {
    expect(
      cdpAddressFromRow({
        [ADDRESS_TYPE_COLUMN]: 1,
        [ADDRESS_COLUMN]: Buffer.from([0, 0, 0, 0]),
      }),
    ).toBeUndefined();

    expect(
      parseLldpManagementAddresses({ "0.5.1.1.4.0.0.0.0": { "3": 2 } }).size,
    ).toBe(0);
  });

  /*
   * net-snmp hands IpAddress varbinds over as strings without validating
   * them, and a stringifying agent can put anything in the cell.
   */
  test("refuses an octet outside the byte range from a stringifying agent", () => {
    expect(
      cdpAddressFromRow({
        [ADDRESS_TYPE_COLUMN]: 1,
        [ADDRESS_COLUMN]: "999.999.999.999",
      }),
    ).toBeUndefined();
  });
});

describe("normalizeIpv4", () => {
  /*
   * One rule for both protocols. They decode by completely different routes
   * — four raw bytes on one, decimal index components on the other — and
   * validating each where it is decoded is how they drifted apart in the
   * first place.
   */
  test("accepts an ordinary address and trims it", () => {
    expect(normalizeIpv4("10.0.12.41")).toBe("10.0.12.41");
    expect(normalizeIpv4("  10.0.12.41 ")).toBe("10.0.12.41");
  });

  test("refuses the unset address", () => {
    expect(normalizeIpv4("0.0.0.0")).toBeUndefined();
  });

  test("refuses an octet outside the byte range", () => {
    expect(normalizeIpv4("10.0.300.41")).toBeUndefined();
    expect(normalizeIpv4("256.0.0.1")).toBeUndefined();
  });

  test("refuses anything that is not four dotted decimal components", () => {
    expect(normalizeIpv4("10.0.12")).toBeUndefined();
    expect(normalizeIpv4("10.0.12.41.7")).toBeUndefined();
    expect(normalizeIpv4("fe80::42")).toBeUndefined();
    expect(normalizeIpv4("switch-a.corp.local")).toBeUndefined();
    expect(normalizeIpv4("")).toBeUndefined();
    expect(normalizeIpv4(undefined)).toBeUndefined();
  });

  /*
   * 0.0.0.1 is a real address in the same shape as the unset one; only the
   * all-zero value is a sentinel.
   */
  test("does not mistake a low address for the unset one", () => {
    expect(normalizeIpv4("0.0.0.1")).toBe("0.0.0.1");
  });
});

describe("lldpNeighborJoinKey", () => {
  /*
   * The time mark is a sysUpTime stamp that changes whenever the agent
   * refreshes the entry. Joining on it would silently drop every address on
   * exactly the busy devices that have the most of them, so the key is the
   * (localPortNum, remIndex) pair the two tables share.
   */
  test("ignores the time mark so the two tables still join across a refresh", () => {
    expect(lldpNeighborJoinKey("0.5.1")).toBe("5.1");
    expect(lldpNeighborJoinKey("98765.5.1")).toBe("5.1");
  });

  test("reads the same pair out of a management-address row key", () => {
    expect(lldpNeighborJoinKey("0.5.1.1.4.10.0.12.41")).toBe("5.1");
  });

  test("a key with too few components has no join key", () => {
    expect(lldpNeighborJoinKey("5")).toBeUndefined();
    expect(lldpNeighborJoinKey("0.5")).toBeUndefined();
    expect(lldpNeighborJoinKey("")).toBeUndefined();
  });
});

describe("parseLldpManagementAddresses", () => {
  test("reads an IPv4 address out of the row index", () => {
    const rows: SnmpTableRows = {
      "0.5.1.1.4.10.0.12.41": { "3": 2 },
      "0.7.1.1.4.192.168.4.7": { "3": 2 },
    };

    const addresses: Map<string, string> = parseLldpManagementAddresses(rows);

    expect(addresses.get("5.1")).toBe("10.0.12.41");
    expect(addresses.get("7.1")).toBe("192.168.4.7");
    expect(addresses.size).toBe(2);
  });

  /*
   * Subtype 2 is IPv6 and its index carries sixteen components. Decoding
   * the first four of them would produce a plausible-looking v4 address
   * that is really the top quarter of a v6 one.
   */
  test("skips an IPv6 management address rather than decoding its first four octets", () => {
    const ipv6Index: string = `0.5.1.2.16.${new Array(16)
      .fill(0)
      .map((_unused: number, index: number) => {
        return index + 1;
      })
      .join(".")}`;

    expect(parseLldpManagementAddresses({ [ipv6Index]: { "3": 2 } }).size).toBe(
      0,
    );
  });

  /*
   * The length component promises how many octets follow. A key that does
   * not hold exactly that many is malformed, and slicing a fixed window out
   * of it would read the malformation as a perfectly valid address.
   */
  test("skips a row whose key does not hold exactly the octets its length promised", () => {
    expect(
      parseLldpManagementAddresses({
        "0.5.1.1.4.10.0.12": { "3": 2 },
        "0.5.1.1.4.10.0.12.41.99": { "3": 2 },
      }).size,
    ).toBe(0);
  });

  test("skips a row whose length component disagrees with IPv4", () => {
    expect(
      parseLldpManagementAddresses({ "0.5.1.1.6.10.0.12.41": { "3": 2 } }).size,
    ).toBe(0);
  });

  /*
   * 0.0.0.0 is what an agent reports for an address it does not have. It is
   * not somewhere a device can be monitored, and letting it through would
   * pre-fill a hostname guaranteed to fail.
   */
  test("treats the unset address as no address", () => {
    expect(
      parseLldpManagementAddresses({ "0.5.1.1.4.0.0.0.0": { "3": 2 } }).size,
    ).toBe(0);
  });

  test("skips an octet outside the byte range", () => {
    expect(
      parseLldpManagementAddresses({ "0.5.1.1.4.10.0.300.41": { "3": 2 } })
        .size,
    ).toBe(0);
  });

  /*
   * A device advertising a loopback and an SVI reports two rows for one
   * neighbour. Whichever wins has to win every time: an address that
   * alternated between polls would churn the peer's identity on the map and,
   * once adopted, the device's hostname.
   */
  test("a neighbour advertising several addresses resolves to the same one every time", () => {
    const first: Map<string, string> = parseLldpManagementAddresses({
      "0.5.1.1.4.10.0.12.41": { "3": 2 },
      "0.5.1.1.4.172.16.9.9": { "3": 2 },
    });

    const reversed: Map<string, string> = parseLldpManagementAddresses({
      "0.5.1.1.4.172.16.9.9": { "3": 2 },
      "0.5.1.1.4.10.0.12.41": { "3": 2 },
    });

    expect(first.get("5.1")).toBe(reversed.get("5.1"));
    expect(first.size).toBe(1);
  });

  test("an empty table produces an empty map rather than throwing", () => {
    expect(parseLldpManagementAddresses({}).size).toBe(0);
  });

  test("a key too short to be this table's is skipped, not read backwards", () => {
    expect(parseLldpManagementAddresses({ "0.5.1": { "3": 2 } }).size).toBe(0);
  });
});

import { describe, expect, test } from "@jest/globals";
import ArpEntry from "Common/Types/Monitor/SnmpMonitor/ArpEntry";
import FdbEntry from "Common/Types/Monitor/SnmpMonitor/FdbEntry";
import {
  SnmpTableRows,
  DOT1D_BASE_PORT_TABLE_OID,
  DOT1D_TP_FDB_TABLE_OID,
  DOT1Q_TP_FDB_TABLE_OID,
  IP_NET_TO_MEDIA_TABLE_OID,
  MAX_ARP_ENTRIES,
  MAX_BASE_PORT_ENTRIES,
  MAX_FDB_ENTRIES,
  applyBasePortMapping,
  parseArpRows,
  parseBasePortMap,
  parseFdbRowsDot1d,
  parseFdbRowsQBridge,
  toMacAddressString,
  toSixOctetMac,
} from "../../../Utils/Snmp/EndpointTableParsers";

/*
 * These parsers consume the exact row shape net-snmp's session.tableColumns
 * produces: rows keyed by the (possibly composite) row index, each row
 * keyed by column number as a string, values raw varbind values (Buffers
 * for OctetStrings, numbers for Integers). Every fixture below mirrors that
 * shape.
 */

const MAC_BUFFER: Buffer = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
const MAC_STRING: string = "aa:bb:cc:dd:ee:ff";

describe("endpoint table OIDs", () => {
  /*
   * These must be TABLE OIDs, never Entry OIDs. The walker appends the
   * ".1." Entry subid itself (as net-snmp's session.tableColumns does), so
   * a constant carrying the Entry subid walks one level too deep — a
   * subtree that resolves cleanly to zero rows, so endpoint discovery
   * silently finds nothing forever with no error at any log level. The
   * exact wire OIDs the walker builds from these are pinned in
   * Tests/Utils/Monitors/MonitorTypes/SnmpMonitorHelpers.test.ts.
   */
  test.each([
    ["ipNetToMediaTable", IP_NET_TO_MEDIA_TABLE_OID, "1.3.6.1.2.1.4.22"],
    ["dot1qTpFdbTable", DOT1Q_TP_FDB_TABLE_OID, "1.3.6.1.2.1.17.7.1.2.2"],
    ["dot1dTpFdbTable", DOT1D_TP_FDB_TABLE_OID, "1.3.6.1.2.1.17.4.3"],
    ["dot1dBasePortTable", DOT1D_BASE_PORT_TABLE_OID, "1.3.6.1.2.1.17.1.4"],
  ])(
    "%s is the table OID, not the entry OID",
    (_label: string, actual: string, expected: string) => {
      expect(actual).toBe(expected);
      // The Entry subid belongs to the walker, not to the constant.
      expect(actual.endsWith(".1")).toBe(false);
    },
  );
});

describe("toMacAddressString", () => {
  test("a 6-byte buffer renders lowercase colon-separated hex", () => {
    expect(toMacAddressString(MAC_BUFFER)).toBe(MAC_STRING);
  });

  test("single-digit bytes are zero-padded", () => {
    expect(
      toMacAddressString(Buffer.from([0x00, 0x0a, 0x1b, 0x02, 0x03, 0x04])),
    ).toBe("00:0a:1b:02:03:04");
  });

  test("empty and all-zero buffers yield undefined (no MAC)", () => {
    expect(toMacAddressString(Buffer.alloc(0))).toBeUndefined();
    expect(toMacAddressString(Buffer.alloc(6))).toBeUndefined();
  });

  test.each([
    ["a string", "aa:bb:cc:dd:ee:ff"],
    ["a number", 42],
    ["null", null],
    ["undefined", undefined],
    ["an object", {}],
  ])("%s (non-buffer) yields undefined", (_label: string, value: unknown) => {
    expect(toMacAddressString(value)).toBeUndefined();
  });

  test("non-6-byte buffers still format (ifPhysAddress may be EUI-64)", () => {
    expect(toMacAddressString(Buffer.from([0x01, 0x02, 0x03, 0x04]))).toBe(
      "01:02:03:04",
    );
  });
});

describe("toSixOctetMac", () => {
  test("accepts exactly six octets", () => {
    expect(toSixOctetMac(MAC_BUFFER)).toBe(MAC_STRING);
  });

  test.each([
    ["a short buffer", Buffer.from([0xaa, 0xbb, 0xcc])],
    ["a long buffer", Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])],
    ["an empty buffer", Buffer.alloc(0)],
    ["an all-zero 6-byte buffer", Buffer.alloc(6)],
    ["a non-buffer", "aa:bb:cc:dd:ee:ff"],
  ])("%s yields undefined", (_label: string, value: unknown) => {
    expect(toSixOctetMac(value)).toBeUndefined();
  });
});

describe("parseArpRows", () => {
  /*
   * ipNetToMediaTable columns: 1 = ifIndex, 2 = physAddress, 3 = netAddress,
   * 4 = type (other=1, invalid=2, dynamic=3, static=4). Row index is
   * "ifIndex.a.b.c.d".
   */

  function fullRow(
    overrides?: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      "1": 2,
      "2": MAC_BUFFER,
      "3": "10.0.0.5",
      "4": 3,
      ...overrides,
    };
  }

  test("a complete row maps every field, decoding dynamic(3)", () => {
    const entries: Array<ArpEntry> = parseArpRows({
      "2.10.0.0.5": fullRow(),
    });

    expect(entries).toEqual([
      {
        ipAddress: "10.0.0.5",
        macAddress: MAC_STRING,
        interfaceIndex: 2,
        entryType: "dynamic",
      },
    ]);
  });

  test('static(4) decodes to "static"', () => {
    const entries: Array<ArpEntry> = parseArpRows({
      "2.10.0.0.5": fullRow({ "4": 4 }),
    });

    expect(entries[0]!.entryType).toBe("static");
  });

  test("column values win over a disagreeing composite index", () => {
    // The index says ifIndex 9 / IP 192.168.9.9; the columns disagree.
    const entries: Array<ArpEntry> = parseArpRows({
      "9.192.168.9.9": fullRow(),
    });

    expect(entries[0]!.interfaceIndex).toBe(2);
    expect(entries[0]!.ipAddress).toBe("10.0.0.5");
  });

  test("missing ifIndex/netAddress columns fall back to the composite index", () => {
    const entries: Array<ArpEntry> = parseArpRows({
      "7.172.16.31.42": { "2": MAC_BUFFER, "4": 3 },
    });

    expect(entries).toEqual([
      {
        ipAddress: "172.16.31.42",
        macAddress: MAC_STRING,
        interfaceIndex: 7,
        entryType: "dynamic",
      },
    ]);
  });

  test("a missing type column keeps the entry with entryType undefined", () => {
    const entries: Array<ArpEntry> = parseArpRows({
      "2.10.0.0.5": { "1": 2, "2": MAC_BUFFER, "3": "10.0.0.5" },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.entryType).toBeUndefined();
  });

  test.each([
    ["other(1)", 1],
    ["invalid(2)", 2],
    ["an unknown code", 9],
  ])("rows typed %s are skipped", (_label: string, rawType: number) => {
    expect(parseArpRows({ "2.10.0.0.5": fullRow({ "4": rawType }) })).toEqual(
      [],
    );
  });

  test.each([
    ["an empty phys address", Buffer.alloc(0)],
    ["an all-zero phys address", Buffer.alloc(6)],
    ["a short phys address buffer", Buffer.from([0xaa, 0xbb])],
    ["an 8-byte phys address buffer", Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])],
    ["a non-buffer phys address", "aa:bb:cc:dd:ee:ff"],
    ["a missing phys address", undefined],
  ])(
    "rows with %s are skipped without throwing",
    (_label: string, phys: unknown) => {
      expect(parseArpRows({ "2.10.0.0.5": fullRow({ "2": phys }) })).toEqual(
        [],
      );
    },
  );

  test("the net address may arrive as a raw 4-byte buffer", () => {
    const entries: Array<ArpEntry> = parseArpRows({
      "2.10.0.0.5": fullRow({ "3": Buffer.from([10, 0, 0, 5]) }),
    });

    expect(entries[0]!.ipAddress).toBe("10.0.0.5");
  });

  test("the ifIndex column may arrive as a short buffer", () => {
    const entries: Array<ArpEntry> = parseArpRows({
      "2.10.0.0.5": fullRow({ "1": Buffer.from([0x0b]) }),
    });

    expect(entries[0]!.interfaceIndex).toBe(11);
  });

  test("a malformed row key with no usable columns is skipped, never thrown on", () => {
    const entries: Array<ArpEntry> = parseArpRows({
      bogus: { "2": MAC_BUFFER },
      "1.2": { "2": MAC_BUFFER },
      "": { "2": MAC_BUFFER },
    });

    expect(entries).toEqual([]);
  });

  test("an index with a non-octet IP component is skipped when columns are missing", () => {
    expect(parseArpRows({ "2.999.0.0.5": { "2": MAC_BUFFER } })).toEqual([]);
  });

  test("an empty table parses to an empty array", () => {
    expect(parseArpRows({})).toEqual([]);
  });

  test(`caps the result at ${MAX_ARP_ENTRIES} entries`, () => {
    const rows: SnmpTableRows = {};
    for (let i: number = 0; i < MAX_ARP_ENTRIES + 500; i++) {
      const thirdOctet: number = Math.floor(i / 256);
      const fourthOctet: number = i % 256;
      rows[`2.10.0.${thirdOctet}.${fourthOctet}`] = fullRow({
        "3": `10.0.${thirdOctet}.${fourthOctet}`,
      });
    }

    expect(parseArpRows(rows)).toHaveLength(MAX_ARP_ENTRIES);
  });
});

describe("parseFdbRowsQBridge", () => {
  /*
   * dot1qTpFdbTable columns: 2 = port, 3 = status (learned=3). Row index is
   * "fdbId.m1.m2.m3.m4.m5.m6" — fdbId is the VLAN's FDB id.
   */

  const ROW_KEY: string = "100.170.187.204.221.238.255";

  test("a learned row maps MAC (from index), port, vlan, and status", () => {
    const entries: Array<FdbEntry> = parseFdbRowsQBridge({
      [ROW_KEY]: { "2": 5, "3": 3 },
    });

    expect(entries).toEqual([
      {
        macAddress: MAC_STRING,
        bridgePort: 5,
        interfaceIndex: undefined,
        vlanId: 100,
        status: "learned",
      },
    ]);
  });

  test.each([
    ["other(1)", 1],
    ["invalid(2)", 2],
    ["self(4)", 4],
    ["mgmt(5)", 5],
    ["a missing status", undefined],
    ["a non-numeric status", "learned"],
  ])("rows with %s are filtered out", (_label: string, status: unknown) => {
    expect(parseFdbRowsQBridge({ [ROW_KEY]: { "2": 5, "3": status } })).toEqual(
      [],
    );
  });

  test.each([
    ["a missing port", undefined],
    ["a non-numeric port", "Gi1/0/5"],
    ["an object port", {}],
  ])(
    "rows with %s are skipped without throwing",
    (_label: string, port: unknown) => {
      expect(parseFdbRowsQBridge({ [ROW_KEY]: { "2": port, "3": 3 } })).toEqual(
        [],
      );
    },
  );

  test("the port may arrive as a short buffer or numeric string", () => {
    expect(
      parseFdbRowsQBridge({
        [ROW_KEY]: { "2": Buffer.from([0x00, 0x07]), "3": 3 },
      })[0]!.bridgePort,
    ).toBe(7);

    expect(
      parseFdbRowsQBridge({ [ROW_KEY]: { "2": "7", "3": 3 } })[0]!.bridgePort,
    ).toBe(7);
  });

  test.each([
    ["too few index components", "100.170.187.204"],
    ["a MAC octet above 255", "100.999.187.204.221.238.255"],
    ["a non-numeric MAC component", "100.aa.187.204.221.238.255"],
    ["an all-zero MAC", "100.0.0.0.0.0.0"],
  ])("rows keyed with %s are skipped", (_label: string, rowKey: string) => {
    expect(parseFdbRowsQBridge({ [rowKey]: { "2": 5, "3": 3 } })).toEqual([]);
  });

  test("a longer-than-expected index yields no vlanId guess but keeps the MAC", () => {
    const entries: Array<FdbEntry> = parseFdbRowsQBridge({
      "1.100.170.187.204.221.238.255": { "2": 5, "3": 3 },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.macAddress).toBe(MAC_STRING);
    expect(entries[0]!.vlanId).toBeUndefined();
  });

  test(`caps the result at ${MAX_FDB_ENTRIES} entries post-filter`, () => {
    const rows: SnmpTableRows = {};
    for (let i: number = 0; i < MAX_FDB_ENTRIES + 400; i++) {
      const secondOctet: number = Math.floor(i / 256);
      const firstOctet: number = i % 256;
      // Interleave non-learned rows: they must not consume cap budget.
      rows[`1.2.4.8.${secondOctet}.${firstOctet}.16`] = { "2": 5, "3": 3 };
      rows[`1.3.4.8.${secondOctet}.${firstOctet}.16`] = { "2": 5, "3": 4 };
    }

    const entries: Array<FdbEntry> = parseFdbRowsQBridge(rows);

    expect(entries).toHaveLength(MAX_FDB_ENTRIES);
    for (const entry of entries) {
      expect(entry.status).toBe("learned");
    }
  });
});

describe("parseFdbRowsDot1d", () => {
  /*
   * dot1dTpFdbTable columns: 1 = address, 2 = port, 3 = status (learned=3).
   * Row index is the six MAC octets in decimal.
   */

  const ROW_KEY: string = "170.187.204.221.238.255";

  test("a learned row maps MAC from the address column, with no vlanId", () => {
    const entries: Array<FdbEntry> = parseFdbRowsDot1d({
      [ROW_KEY]: { "1": MAC_BUFFER, "2": 9, "3": 3 },
    });

    expect(entries).toEqual([
      {
        macAddress: MAC_STRING,
        bridgePort: 9,
        interfaceIndex: undefined,
        vlanId: undefined,
        status: "learned",
      },
    ]);
  });

  test("a missing address column falls back to the 6-octet row index", () => {
    const entries: Array<FdbEntry> = parseFdbRowsDot1d({
      [ROW_KEY]: { "2": 9, "3": 3 },
    });

    expect(entries[0]!.macAddress).toBe(MAC_STRING);
  });

  test("a short address buffer falls back to the row index instead of a truncated MAC", () => {
    const entries: Array<FdbEntry> = parseFdbRowsDot1d({
      [ROW_KEY]: { "1": Buffer.from([0xaa, 0xbb]), "2": 9, "3": 3 },
    });

    expect(entries[0]!.macAddress).toBe(MAC_STRING);
  });

  test("a row with neither a usable address column nor a MAC-shaped index is skipped", () => {
    expect(
      parseFdbRowsDot1d({
        bogus: { "2": 9, "3": 3 },
        "1.2.3": { "2": 9, "3": 3 },
      }),
    ).toEqual([]);
  });

  test.each([
    ["self(4)", 4],
    ["mgmt(5)", 5],
    ["a missing status", undefined],
  ])("rows with %s are filtered out", (_label: string, status: unknown) => {
    expect(
      parseFdbRowsDot1d({
        [ROW_KEY]: { "1": MAC_BUFFER, "2": 9, "3": status },
      }),
    ).toEqual([]);
  });

  test("rows with a non-numeric port are skipped without throwing", () => {
    expect(
      parseFdbRowsDot1d({
        [ROW_KEY]: { "1": MAC_BUFFER, "2": "Fa0/9", "3": 3 },
      }),
    ).toEqual([]);
  });

  test(`caps the result at ${MAX_FDB_ENTRIES} entries`, () => {
    const rows: SnmpTableRows = {};
    for (let i: number = 0; i < MAX_FDB_ENTRIES + 100; i++) {
      const secondOctet: number = Math.floor(i / 256);
      const firstOctet: number = i % 256;
      rows[`2.4.8.${secondOctet}.${firstOctet}.16`] = { "2": 9, "3": 3 };
    }

    expect(parseFdbRowsDot1d(rows)).toHaveLength(MAX_FDB_ENTRIES);
  });
});

describe("parseBasePortMap", () => {
  // dot1dBasePortTable: index = bridge port, column 2 = dot1dBasePortIfIndex.

  test("maps each bridge port to its ifIndex", () => {
    const map: Map<number, number> = parseBasePortMap({
      "1": { "2": 10101 },
      "2": { "2": 10102 },
      "49": { "2": 10149 },
    });

    expect(map.get(1)).toBe(10101);
    expect(map.get(2)).toBe(10102);
    expect(map.get(49)).toBe(10149);
    expect(map.size).toBe(3);
  });

  test("the ifIndex may arrive as a short buffer", () => {
    const map: Map<number, number> = parseBasePortMap({
      "3": { "2": Buffer.from([0x27, 0x75]) },
    });

    expect(map.get(3)).toBe(10101);
  });

  test("rows with a non-numeric key or missing ifIndex are skipped", () => {
    const map: Map<number, number> = parseBasePortMap({
      bogus: { "2": 10101 },
      "4": {},
      "5": { "2": "not-a-number" },
    });

    expect(map.size).toBe(0);
  });

  test("an empty table produces an empty map", () => {
    expect(parseBasePortMap({}).size).toBe(0);
  });

  test("caps the map at MAX_BASE_PORT_ENTRIES", () => {
    const rows: SnmpTableRows = {};
    for (let i: number = 1; i <= MAX_BASE_PORT_ENTRIES + 100; i++) {
      rows[i.toString()] = { "2": 10000 + i };
    }

    expect(parseBasePortMap(rows).size).toBe(MAX_BASE_PORT_ENTRIES);
  });
});

describe("applyBasePortMapping", () => {
  function learnedEntry(bridgePort: number): FdbEntry {
    return {
      macAddress: MAC_STRING,
      bridgePort: bridgePort,
      interfaceIndex: undefined,
      vlanId: undefined,
      status: "learned",
    };
  }

  test("translates mapped bridge ports and leaves unmapped ones undefined", () => {
    const mapped: Array<FdbEntry> = applyBasePortMapping(
      [learnedEntry(1), learnedEntry(7)],
      new Map<number, number>([[1, 10101]]),
    );

    expect(mapped[0]!.interfaceIndex).toBe(10101);
    /*
     * Bridge ports and ifIndexes are different number spaces: with no
     * mapping row, inventing interfaceIndex 7 from bridge port 7 would
     * attach the endpoint to the wrong interface.
     */
    expect(mapped[1]!.interfaceIndex).toBeUndefined();
  });

  test("preserves every other field", () => {
    const entry: FdbEntry = {
      macAddress: MAC_STRING,
      bridgePort: 2,
      interfaceIndex: undefined,
      vlanId: 300,
      status: "learned",
    };

    const mapped: Array<FdbEntry> = applyBasePortMapping(
      [entry],
      new Map<number, number>([[2, 42]]),
    );

    expect(mapped[0]).toEqual({
      macAddress: MAC_STRING,
      bridgePort: 2,
      interfaceIndex: 42,
      vlanId: 300,
      status: "learned",
    });
  });

  test("does not mutate the input entries", () => {
    const entry: FdbEntry = learnedEntry(1);

    applyBasePortMapping([entry], new Map<number, number>([[1, 10101]]));

    expect(entry.interfaceIndex).toBeUndefined();
  });

  test("an empty map leaves every entry untranslated", () => {
    const mapped: Array<FdbEntry> = applyBasePortMapping(
      [learnedEntry(1)],
      new Map<number, number>(),
    );

    expect(mapped[0]!.interfaceIndex).toBeUndefined();
  });
});

// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { describe, expect, jest, test } from "@jest/globals";
import SnmpEntityInfo from "Common/Types/Monitor/SnmpMonitor/SnmpEntityInfo";
import SnmpSystemInfo from "Common/Types/Monitor/SnmpMonitor/SnmpSystemInfo";
import CdpNeighbor from "Common/Types/Monitor/SnmpMonitor/CdpNeighbor";

/*
 * Same seam as SnmpMonitorV3Session.test.ts: net-snmp keeps its real
 * constants and helpers (ObjectType, isVarbindError) so these tests assert
 * against the values the probe actually consumes; only the session factories
 * are stubbed so no UDP socket can ever be opened from a test.
 */
jest.mock("net-snmp", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "net-snmp",
  ) as Record<string, unknown>;

  return {
    ...actual,
    createSession: jest.fn(() => {
      return { close: jest.fn(), on: jest.fn() };
    }),
    createV3Session: jest.fn(() => {
      return { close: jest.fn(), on: jest.fn() };
    }),
  };
});

import snmp from "net-snmp";
import SnmpMonitor from "../../../../Utils/Monitors/MonitorTypes/SnmpMonitor";

/*
 * The helpers under test are private statics; this cast seam exposes them
 * without widening their production visibility.
 */
type TestVarbind = {
  oid?: string;
  type?: number;
  value?: unknown;
};

type SnmpMonitorHelpers = {
  parseVarbindValue: (varbind: TestVarbind) => string | number;
  toMacAddress: (value: unknown) => string | undefined;
  isPrintableBuffer: (value: Buffer) => boolean;
  toMetricNumber: (value: unknown) => number | undefined;
  walkEntityInfo: (session: unknown) => Promise<SnmpEntityInfo | undefined>;
  walkCdpNeighbors: (session: unknown) => Promise<Array<CdpNeighbor>>;
  readSystemInfo: (session: unknown) => Promise<SnmpSystemInfo>;
};

const Internal: SnmpMonitorHelpers = SnmpMonitor as any as SnmpMonitorHelpers;

/*
 * Row shape produced by net-snmp's session.tableColumns: rows keyed by the
 * row index (which may be composite, e.g. "ifIndex.deviceIndex"), each row
 * keyed by column number as a string.
 */
type SnmpTableRows = Record<string, Record<string, unknown>>;

type TableColumnsCall = {
  tableOid: string;
  columns: Array<number>;
};

type MockTableSession = {
  calls: Array<TableColumnsCall>;
  tableColumns: (
    tableOid: string,
    columns: Array<number>,
    callback: (error: Error | null, table?: unknown) => void,
  ) => void;
};

/*
 * Minimal stand-in for a net-snmp session whose tableColumns method returns
 * a canned table (or error), mirroring how getTableColumns drives it:
 * session.tableColumns(oid, columns, callback).
 */
function createTableSession(
  table: SnmpTableRows,
  error?: Error,
): MockTableSession {
  const calls: Array<TableColumnsCall> = [];

  return {
    calls,
    tableColumns: (
      tableOid: string,
      columns: Array<number>,
      callback: (err: Error | null, tbl?: unknown) => void,
    ): void => {
      calls.push({ tableOid, columns });
      if (error) {
        callback(error);
        return;
      }
      callback(null, table);
    },
  };
}

type MockGetSession = {
  requestedOids: Array<Array<string>>;
  get: (
    oids: Array<string>,
    callback: (
      error: Error | null,
      varbinds?: Array<TestVarbind> | undefined,
    ) => void,
  ) => void;
};

/*
 * Minimal stand-in for a net-snmp session whose get method returns canned
 * varbinds (or an error), mirroring how getOids drives it:
 * session.get(oids, callback).
 */
function createGetSession(
  varbinds: Array<TestVarbind>,
  error?: Error,
): MockGetSession {
  const requestedOids: Array<Array<string>> = [];

  return {
    requestedOids,
    get: (
      oids: Array<string>,
      callback: (
        err: Error | null,
        vbs?: Array<TestVarbind> | undefined,
      ) => void,
    ): void => {
      requestedOids.push(oids);
      if (error) {
        callback(error);
        return;
      }
      callback(null, varbinds);
    },
  };
}

// 8-byte big-endian buffer, the wire form net-snmp uses for Counter64.
function counter64Buffer(value: bigint): Buffer {
  const buffer: Buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(value);
  return buffer;
}

describe("SnmpMonitor.parseVarbindValue", () => {
  test("a Counter64 8-byte buffer above 2^32 decodes to the exact number", () => {
    // 10 billion — larger than any 32-bit counter can hold.
    const value: number | string = Internal.parseVarbindValue({
      oid: "1.3.6.1.2.1.31.1.1.1.6.1",
      type: snmp.ObjectType.Counter64,
      value: counter64Buffer(BigInt("10000000000")),
    });

    expect(value).toBe(10000000000);
    expect(typeof value).toBe("number");
  });

  test("a 7-byte Counter64 buffer decodes (net-snmp uses minimal-length encoding)", () => {
    // 0x01020304050607 — a value in the 2^48..2^56 range encodes to 7 bytes.
    const value: number | string = Internal.parseVarbindValue({
      type: snmp.ObjectType.Counter64,
      value: Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]),
    });

    expect(value).toBe(283686952306183);
    expect(typeof value).toBe("number");
  });

  test("a Counter64 buffer above the 64-bit range degrades to an empty string, not garbage", () => {
    const value: number | string = Internal.parseVarbindValue({
      type: snmp.ObjectType.Counter64,
      value: Buffer.from([
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
      ]),
    });

    expect(value).toBe("");
  });

  test("a binary OctetString (MAC address bytes) renders as colon-separated hex", () => {
    const value: number | string = Internal.parseVarbindValue({
      type: snmp.ObjectType.OctetString,
      value: Buffer.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]),
    });

    expect(value).toBe("aa:bb:cc:dd:ee:ff");
  });

  test("an all-zero binary OctetString becomes an empty string rather than a fake MAC", () => {
    const value: number | string = Internal.parseVarbindValue({
      type: snmp.ObjectType.OctetString,
      value: Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
    });

    expect(value).toBe("");
  });

  test("a printable OctetString buffer decodes as UTF-8 text", () => {
    const value: number | string = Internal.parseVarbindValue({
      type: snmp.ObjectType.OctetString,
      value: Buffer.from("GigabitEthernet0/1"),
    });

    expect(value).toBe("GigabitEthernet0/1");
  });

  test("a multi-line sysDescr stays text — tab/CR/LF do not force the hex path", () => {
    const descr: string = "Cisco IOS Software\r\n\tVersion 15.2(4)E10";

    const value: number | string = Internal.parseVarbindValue({
      type: snmp.ObjectType.OctetString,
      value: Buffer.from(descr),
    });

    expect(value).toBe(descr);
  });

  test("plain numbers pass through unchanged", () => {
    expect(
      Internal.parseVarbindValue({
        type: snmp.ObjectType.Integer,
        value: 42,
      }),
    ).toBe(42);

    expect(
      Internal.parseVarbindValue({
        type: snmp.ObjectType.TimeTicks,
        value: 0,
      }),
    ).toBe(0);
  });

  test("bigint values convert to plain numbers", () => {
    const value: number | string = Internal.parseVarbindValue({
      type: snmp.ObjectType.Counter64,
      value: BigInt("10000000000"),
    });

    expect(value).toBe(10000000000);
    expect(typeof value).toBe("number");
  });

  test("null and undefined values become empty strings", () => {
    expect(
      Internal.parseVarbindValue({
        type: snmp.ObjectType.Null,
        value: null,
      }),
    ).toBe("");

    expect(
      Internal.parseVarbindValue({
        type: snmp.ObjectType.Null,
        value: undefined,
      }),
    ).toBe("");
  });

  test("string values (e.g. OID varbinds) pass through as strings", () => {
    expect(
      Internal.parseVarbindValue({
        type: snmp.ObjectType.OID,
        value: "1.3.6.1.4.1.9.1.1208",
      }),
    ).toBe("1.3.6.1.4.1.9.1.1208");
  });
});

describe("SnmpMonitor.toMacAddress", () => {
  test("a 6-byte buffer renders lowercase colon-separated hex", () => {
    expect(
      Internal.toMacAddress(Buffer.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff])),
    ).toBe("aa:bb:cc:dd:ee:ff");
  });

  test("single-digit bytes are zero-padded", () => {
    expect(
      Internal.toMacAddress(Buffer.from([0x00, 0x0a, 0x1b, 0x02, 0x03, 0x04])),
    ).toBe("00:0a:1b:02:03:04");
  });

  test("an empty buffer (loopback/tunnel ifPhysAddress) yields undefined", () => {
    expect(Internal.toMacAddress(Buffer.alloc(0))).toBeUndefined();
  });

  test("an all-zero buffer yields undefined", () => {
    expect(Internal.toMacAddress(Buffer.alloc(6))).toBeUndefined();
  });

  test.each([
    ["a string", "aa:bb:cc:dd:ee:ff"],
    ["a number", 42],
    ["null", null],
    ["undefined", undefined],
    ["an object", {}],
  ])("%s (non-buffer) yields undefined", (_label: string, value: unknown) => {
    expect(Internal.toMacAddress(value)).toBeUndefined();
  });
});

describe("SnmpMonitor.isPrintableBuffer", () => {
  test("printable ASCII text is printable", () => {
    expect(
      Internal.isPrintableBuffer(Buffer.from("Hello, SNMP! (0-9) ~tilde~")),
    ).toBe(true);
  });

  test("a buffer containing control bytes is not printable", () => {
    expect(Internal.isPrintableBuffer(Buffer.from([0x48, 0x00, 0x49]))).toBe(
      false,
    );
    // ESC in the middle of otherwise-printable text.
    expect(Internal.isPrintableBuffer(Buffer.from([0x41, 0x1b, 0x42]))).toBe(
      false,
    );
  });

  test("tab, newline and carriage return are allowed", () => {
    expect(
      Internal.isPrintableBuffer(Buffer.from("line one\r\n\tline two")),
    ).toBe(true);
  });

  test("the printable range boundaries are exact: 0x20/0x7e in, 0x1f/0x7f out", () => {
    expect(Internal.isPrintableBuffer(Buffer.from([0x20, 0x7e]))).toBe(true);
    expect(Internal.isPrintableBuffer(Buffer.from([0x1f]))).toBe(false);
    expect(Internal.isPrintableBuffer(Buffer.from([0x7f]))).toBe(false);
  });

  test("high (non-ASCII) bytes are not printable", () => {
    expect(Internal.isPrintableBuffer(Buffer.from([0x80, 0xff]))).toBe(false);
  });
});

describe("SnmpMonitor.toMetricNumber", () => {
  test("finite numbers pass through unchanged", () => {
    expect(Internal.toMetricNumber(42)).toBe(42);
    expect(Internal.toMetricNumber(0)).toBe(0);
  });

  test("bigints convert to numbers", () => {
    expect(Internal.toMetricNumber(BigInt("10000000000"))).toBe(10000000000);
  });

  test("an 8-byte buffer decodes big-endian (Counter64 wire form)", () => {
    expect(
      Internal.toMetricNumber(counter64Buffer(BigInt("10000000000"))),
    ).toBe(10000000000);

    // Big-endian, not little-endian: 0x0000000000000100 is 256, not 2^56.
    const buffer: Buffer = Buffer.alloc(8);
    buffer[6] = 0x01;
    expect(Internal.toMetricNumber(buffer)).toBe(256);
  });

  test("buffers up to 6 bytes decode big-endian", () => {
    expect(Internal.toMetricNumber(Buffer.from([0x2a]))).toBe(42);
    expect(Internal.toMetricNumber(Buffer.from([0x01, 0x00]))).toBe(256);
    expect(
      Internal.toMetricNumber(
        Buffer.from([0x01, 0x00, 0x00, 0x00, 0x00, 0x00]),
      ),
    ).toBe(1099511627776);
  });

  test("a 7-byte buffer decodes big-endian (minimal-length Counter64)", () => {
    expect(
      Internal.toMetricNumber(
        Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]),
      ),
    ).toBe(283686952306183);
  });

  test("a 9-byte buffer with a leading zero pad decodes to its 64-bit value", () => {
    // 0x00 pad + eight 0xFF bytes = 2^64 - 1, the max Counter64.
    expect(
      Internal.toMetricNumber(
        Buffer.from([0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
      ),
    ).toBe(18446744073709551615);
  });

  test("empty and beyond-64-bit buffers yield undefined", () => {
    expect(Internal.toMetricNumber(Buffer.alloc(0))).toBeUndefined();
    // Nine 0xFF bytes exceed 2^64 - 1, so there is no valid counter value.
    expect(
      Internal.toMetricNumber(Buffer.from(new Array(9).fill(0xff))),
    ).toBeUndefined();
  });

  test.each([
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
  ])(
    "non-finite number %s yields undefined",
    (_label: string, value: number) => {
      expect(Internal.toMetricNumber(value)).toBeUndefined();
    },
  );

  test.each([
    ["a numeric string", "42"],
    ["null", null],
    ["undefined", undefined],
    ["an object", {}],
  ])("%s yields undefined", (_label: string, value: unknown) => {
    expect(Internal.toMetricNumber(value)).toBeUndefined();
  });
});

describe("SnmpMonitor.walkEntityInfo — chassis selection", () => {
  /*
   * entPhysicalTable column numbers (relative to entPhysicalEntry):
   * 5 = class, 8 = hardwareRev, 9 = firmwareRev, 10 = softwareRev,
   * 11 = serialNum, 12 = mfgName, 13 = modelName. Class 3 == chassis.
   */

  test("walks entPhysicalTable with the identity columns", async () => {
    const session: MockTableSession = createTableSession({});

    await Internal.walkEntityInfo(session);

    expect(session.calls).toEqual([
      {
        tableOid: "1.3.6.1.2.1.47.1.1.1",
        columns: [5, 8, 9, 10, 11, 12, 13],
      },
    ]);
  });

  test("the chassis row wins over lower-indexed non-chassis rows with serials", async () => {
    const session: MockTableSession = createTableSession({
      "1": {
        "5": 9, // module
        "11": Buffer.from("MODULE-SN"),
      },
      "3": {
        "5": 3, // chassis
        "11": Buffer.from("CHASSIS-SN"),
        "12": Buffer.from("Cisco"),
        "13": Buffer.from("C9300-24T"),
      },
    });

    const entityInfo: SnmpEntityInfo | undefined =
      await Internal.walkEntityInfo(session);

    expect(entityInfo).toEqual({
      manufacturer: "Cisco",
      model: "C9300-24T",
      serialNumber: "CHASSIS-SN",
    });
  });

  test("a chassis class arriving as a 1-byte buffer is still recognized", async () => {
    const session: MockTableSession = createTableSession({
      "1": {
        "5": 9,
        "11": Buffer.from("MODULE-SN"),
      },
      "2": {
        "5": Buffer.from([3]),
        "11": Buffer.from("CHASSIS-SN"),
      },
    });

    const entityInfo: SnmpEntityInfo | undefined =
      await Internal.walkEntityInfo(session);

    expect(entityInfo?.serialNumber).toBe("CHASSIS-SN");
  });

  test("with no chassis row, the lowest-indexed row carrying a serial wins", async () => {
    const session: MockTableSession = createTableSession({
      "2": {
        "5": 11, // stack — no serial at all
      },
      "10": {
        "5": 9,
        "11": Buffer.from("SN-10"),
      },
      "9": {
        "5": 9,
        "11": Buffer.from("SN-9"),
      },
    });

    const entityInfo: SnmpEntityInfo | undefined =
      await Internal.walkEntityInfo(session);

    // Numeric row ordering: 9 before 10; row 2 skipped for lacking a serial.
    expect(entityInfo?.serialNumber).toBe("SN-9");
  });

  test("rows with no useful identity fields produce undefined", async () => {
    const session: MockTableSession = createTableSession({
      "1": { "5": 9 },
      "2": { "5": 10 },
    });

    expect(await Internal.walkEntityInfo(session)).toBeUndefined();
  });

  test("a chassis row whose fields are all empty/whitespace produces undefined", async () => {
    const session: MockTableSession = createTableSession({
      "1": {
        "5": 3,
        "11": Buffer.from(""),
        "12": Buffer.from("   "),
      },
    });

    expect(await Internal.walkEntityInfo(session)).toBeUndefined();
  });

  test("an empty table produces undefined", async () => {
    expect(
      await Internal.walkEntityInfo(createTableSession({})),
    ).toBeUndefined();
  });

  test("all identity fields map from their ENTITY-MIB columns and are trimmed", async () => {
    const session: MockTableSession = createTableSession({
      "1": {
        "5": 3,
        "8": Buffer.from("V02"),
        "9": Buffer.from("12.2(50r)SG"),
        "10": Buffer.from("16.9.3"),
        "11": Buffer.from("FDO12345678"),
        "12": Buffer.from(" Cisco Systems Inc "),
        "13": Buffer.from("WS-C3850-48T"),
      },
    });

    const entityInfo: SnmpEntityInfo | undefined =
      await Internal.walkEntityInfo(session);

    expect(entityInfo).toEqual({
      manufacturer: "Cisco Systems Inc",
      model: "WS-C3850-48T",
      serialNumber: "FDO12345678",
      hardwareRevision: "V02",
      firmwareVersion: "12.2(50r)SG",
      softwareVersion: "16.9.3",
    });
  });

  test("a table walk error propagates to the caller", async () => {
    const session: MockTableSession = createTableSession(
      {},
      new Error("RequestTimedOutError"),
    );

    await expect(Internal.walkEntityInfo(session)).rejects.toThrow(
      "RequestTimedOutError",
    );
  });
});

describe("SnmpMonitor.walkCdpNeighbors", () => {
  test("walks cdpCacheTable with the deviceId/port/platform columns", async () => {
    const session: MockTableSession = createTableSession({});

    await Internal.walkCdpNeighbors(session);

    expect(session.calls).toEqual([
      {
        tableOid: "1.3.6.1.4.1.9.9.23.1.2.1",
        columns: [6, 7, 8],
      },
    ]);
  });

  test("rows keyed ifIndex.deviceIndex map to neighbors with the local ifIndex", async () => {
    const session: MockTableSession = createTableSession({
      "10101.1": {
        "6": Buffer.from("dist-sw-02.example.com"),
        "7": Buffer.from("GigabitEthernet1/0/24"),
        "8": Buffer.from("cisco WS-C3750X-48"),
      },
      "10102.3": {
        "6": Buffer.from("core-rtr-01"),
        "7": Buffer.from("TenGigabitEthernet1/1"),
        "8": Buffer.from("cisco ISR4451"),
      },
    });

    const neighbors: Array<CdpNeighbor> =
      await Internal.walkCdpNeighbors(session);

    expect(neighbors).toEqual([
      {
        localInterfaceIndex: 10101,
        remoteDeviceId: "dist-sw-02.example.com",
        remotePortId: "GigabitEthernet1/0/24",
        remotePlatform: "cisco WS-C3750X-48",
      },
      {
        localInterfaceIndex: 10102,
        remoteDeviceId: "core-rtr-01",
        remotePortId: "TenGigabitEthernet1/1",
        remotePlatform: "cisco ISR4451",
      },
    ]);
  });

  test("a non-numeric row key still yields the neighbor, without a local ifIndex", async () => {
    const session: MockTableSession = createTableSession({
      "bogus.1": {
        "6": Buffer.from("mystery-device"),
      },
    });

    const neighbors: Array<CdpNeighbor> =
      await Internal.walkCdpNeighbors(session);

    expect(neighbors).toEqual([
      {
        localInterfaceIndex: undefined,
        remoteDeviceId: "mystery-device",
        remotePortId: undefined,
        remotePlatform: undefined,
      },
    ]);
  });

  test("an empty CDP cache produces an empty array so stale neighbors are cleared", async () => {
    /*
     * Must be [] (a successful walk that found nothing), not undefined
     * (walk not attempted): the inventory writer only overwrites the stored
     * CDP snapshot when the value is defined, so returning undefined here
     * would fossilize stale neighbors as ghost topology edges forever.
     */
    expect(await Internal.walkCdpNeighbors(createTableSession({}))).toEqual([]);
  });
});

describe("SnmpMonitor.readSystemInfo", () => {
  const SYSTEM_OIDS: Array<string> = [
    "1.3.6.1.2.1.1.1.0", // sysDescr
    "1.3.6.1.2.1.1.2.0", // sysObjectID
    "1.3.6.1.2.1.1.3.0", // sysUpTime
    "1.3.6.1.2.1.1.4.0", // sysContact
    "1.3.6.1.2.1.1.5.0", // sysName
    "1.3.6.1.2.1.1.6.0", // sysLocation
  ];

  function buildVarbinds(): Array<TestVarbind> {
    return [
      {
        oid: SYSTEM_OIDS[0]!,
        type: snmp.ObjectType.OctetString,
        value: Buffer.from("Cisco IOS Software, Version 15.2"),
      },
      {
        oid: SYSTEM_OIDS[1]!,
        type: snmp.ObjectType.OID,
        value: "1.3.6.1.4.1.9.1.1208",
      },
      {
        oid: SYSTEM_OIDS[2]!,
        type: snmp.ObjectType.TimeTicks,
        value: 8640000, // exactly one day, in hundredths of a second
      },
      {
        oid: SYSTEM_OIDS[3]!,
        type: snmp.ObjectType.OctetString,
        value: Buffer.from("noc@example.com"),
      },
      {
        oid: SYSTEM_OIDS[4]!,
        type: snmp.ObjectType.OctetString,
        value: Buffer.from("core-sw-01"),
      },
      {
        oid: SYSTEM_OIDS[5]!,
        type: snmp.ObjectType.OctetString,
        value: Buffer.from("DC-1, Rack 42"),
      },
    ];
  }

  test("requests the six system group scalars in one GET, in order", async () => {
    const session: MockGetSession = createGetSession(buildVarbinds());

    await Internal.readSystemInfo(session);

    expect(session.requestedOids).toEqual([SYSTEM_OIDS]);
  });

  test("maps all six fields and converts sysUpTime ticks to whole seconds", async () => {
    const session: MockGetSession = createGetSession(buildVarbinds());

    const systemInfo: SnmpSystemInfo = await Internal.readSystemInfo(session);

    expect(systemInfo).toEqual({
      sysDescr: "Cisco IOS Software, Version 15.2",
      sysObjectId: "1.3.6.1.4.1.9.1.1208",
      sysUpTimeSeconds: 86400,
      sysContact: "noc@example.com",
      sysName: "core-sw-01",
      sysLocation: "DC-1, Rack 42",
    });
  });

  test("sysUpTime conversion floors partial seconds", async () => {
    const varbinds: Array<TestVarbind> = buildVarbinds();
    varbinds[2]!.value = 8640099; // one day plus 0.99s

    const systemInfo: SnmpSystemInfo = await Internal.readSystemInfo(
      createGetSession(varbinds),
    );

    expect(systemInfo.sysUpTimeSeconds).toBe(86400);
  });

  test("a varbind-level error blanks that field without failing the rest", async () => {
    const varbinds: Array<TestVarbind> = buildVarbinds();
    // The real snmp.isVarbindError flags NoSuchInstance-typed varbinds.
    varbinds[3] = {
      oid: SYSTEM_OIDS[3]!,
      type: snmp.ObjectType.NoSuchInstance,
      value: null,
    };

    const systemInfo: SnmpSystemInfo = await Internal.readSystemInfo(
      createGetSession(varbinds),
    );

    expect(systemInfo.sysContact).toBeUndefined();
    expect(systemInfo.sysDescr).toBe("Cisco IOS Software, Version 15.2");
    expect(systemInfo.sysName).toBe("core-sw-01");
    expect(systemInfo.sysUpTimeSeconds).toBe(86400);
  });

  test("an errored sysUpTime varbind leaves sysUpTimeSeconds undefined", async () => {
    const varbinds: Array<TestVarbind> = buildVarbinds();
    varbinds[2] = {
      oid: SYSTEM_OIDS[2]!,
      type: snmp.ObjectType.NoSuchObject,
      value: null,
    };

    const systemInfo: SnmpSystemInfo = await Internal.readSystemInfo(
      createGetSession(varbinds),
    );

    expect(systemInfo.sysUpTimeSeconds).toBeUndefined();
    expect(systemInfo.sysName).toBe("core-sw-01");
  });

  test("a truncated varbind list blanks the missing fields without throwing", async () => {
    const varbinds: Array<TestVarbind> = buildVarbinds().slice(0, 2);

    const systemInfo: SnmpSystemInfo = await Internal.readSystemInfo(
      createGetSession(varbinds),
    );

    expect(systemInfo.sysDescr).toBe("Cisco IOS Software, Version 15.2");
    expect(systemInfo.sysObjectId).toBe("1.3.6.1.4.1.9.1.1208");
    expect(systemInfo.sysUpTimeSeconds).toBeUndefined();
    expect(systemInfo.sysContact).toBeUndefined();
    expect(systemInfo.sysName).toBeUndefined();
    expect(systemInfo.sysLocation).toBeUndefined();
  });

  test("a GET-level error propagates to the caller", async () => {
    const session: MockGetSession = createGetSession(
      [],
      new Error("Request timed out"),
    );

    await expect(Internal.readSystemInfo(session)).rejects.toThrow(
      "Request timed out",
    );
  });
});

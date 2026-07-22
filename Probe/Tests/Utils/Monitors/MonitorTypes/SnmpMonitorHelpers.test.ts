// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { afterEach, describe, expect, jest, test } from "@jest/globals";
import SnmpEntityInfo from "Common/Types/Monitor/SnmpMonitor/SnmpEntityInfo";
import SnmpSystemInfo from "Common/Types/Monitor/SnmpMonitor/SnmpSystemInfo";
import CdpNeighbor from "Common/Types/Monitor/SnmpMonitor/CdpNeighbor";
import ArpEntry from "Common/Types/Monitor/SnmpMonitor/ArpEntry";
import FdbEntry from "Common/Types/Monitor/SnmpMonitor/FdbEntry";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";

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
import SnmpMonitor, {
  SnmpWalkResult,
} from "../../../../Utils/Monitors/MonitorTypes/SnmpMonitor";

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
  walkArpTable: (
    session: unknown,
    deadlineAt?: number,
  ) => Promise<Array<ArpEntry>>;
  walkFdb: (session: unknown, deadlineAt?: number) => Promise<Array<FdbEntry>>;
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
    /*
     * 0x00 pad + eight 0xFF bytes = 2^64 - 1, the max Counter64. IEEE-754 doubles
     * cannot represent 2^64 - 1, so the decoded value rounds up to exactly 2^64;
     * assert that rather than a literal JavaScript cannot express.
     */
    expect(
      Internal.toMetricNumber(
        Buffer.from([0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
      ),
    ).toBe(2 ** 64);
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

/*
 * Endpoint-discovery TABLE OIDs, as walked by walkArpTable/walkFdb. These
 * are the table OIDs, NOT the Entry OIDs: the walker appends the ".1."
 * Entry subid itself, exactly as net-snmp's session.tableColumns does, so a
 * constant that already carries the Entry subid walks one level too deep,
 * resolves cleanly to zero rows, and discovers nothing forever without
 * logging a thing.
 *
 * The fixtures below are therefore keyed by RAW instance OID as an agent
 * would actually return them, and the session stand-in only answers
 * varbinds that genuinely live under the subtree the walker asked for —
 * so an off-by-one-subid constant produces an empty result here too. The
 * parsing rules themselves are covered exhaustively in
 * Tests/Utils/Snmp/EndpointTableParsers.test.ts; these tests pin the OID
 * arithmetic, the walk orchestration (which tables are read, the
 * Q-BRIDGE -> dot1d fallback, best-effort base-port translation), and the
 * row/time bounds enforced DURING the walk.
 */
const ARP_TABLE_OID: string = "1.3.6.1.2.1.4.22";
const Q_BRIDGE_FDB_OID: string = "1.3.6.1.2.1.17.7.1.2.2";
const DOT1D_FDB_OID: string = "1.3.6.1.2.1.17.4.3";
const BASE_PORT_OID: string = "1.3.6.1.2.1.17.1.4";

const ENDPOINT_TABLE_OIDS: Array<string> = [
  ARP_TABLE_OID,
  Q_BRIDGE_FDB_OID,
  DOT1D_FDB_OID,
  BASE_PORT_OID,
];

// Row caps the walker enforces mid-walk; mirrored from the parsers module.
const MAX_ARP_ENTRIES: number = 2048;

const ENDPOINT_MAC_BUFFER: Buffer = Buffer.from([
  0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
]);

// GETBULK batch size the walker asks subtree for.
const EXPECTED_MAX_REPETITIONS: number = 20;

type MockVarbind = {
  oid: string;
  value: unknown;
};

// Canned varbinds (or a walk error) per endpoint TABLE oid.
type EndpointFixtures = Record<string, Array<MockVarbind> | Error>;

type MockSubtreeSession = {
  // Exact OIDs handed to session.subtree, in request order.
  subtreeOids: Array<string>;
  // How many varbinds the "device" actually shipped, across all columns.
  deliveredVarbinds: number;
  maxRepetitions: Array<number>;
  subtree: (
    oid: string,
    maxRepetitions: number,
    feedCb: (varbinds: Array<MockVarbind>) => boolean,
    doneCb: (error: Error | null) => void,
  ) => void;
};

/*
 * Stand-in for a net-snmp session's subtree walk. It resolves the fixture
 * whose "<table>.1." entry prefix contains the requested OID, ships only
 * the varbinds genuinely under that OID, and feeds them in maxRepetitions
 * batches — stopping as soon as the walker's feed callback returns true,
 * which is how a real GETBULK walk is aborted mid-flight.
 */
function createSubtreeSession(fixtures: EndpointFixtures): MockSubtreeSession {
  const session: MockSubtreeSession = {
    subtreeOids: [],
    deliveredVarbinds: 0,
    maxRepetitions: [],
    subtree: (
      oid: string,
      maxRepetitions: number,
      feedCb: (varbinds: Array<MockVarbind>) => boolean,
      doneCb: (error: Error | null) => void,
    ): void => {
      session.subtreeOids.push(oid);
      session.maxRepetitions.push(maxRepetitions);

      let fixture: Array<MockVarbind> | Error | undefined = undefined;
      for (const tableOid of Object.keys(fixtures)) {
        if (oid.startsWith(`${tableOid}.1.`)) {
          fixture = fixtures[tableOid];
          break;
        }
      }

      if (fixture instanceof Error) {
        doneCb(fixture);
        return;
      }

      const inSubtree: Array<MockVarbind> = (fixture || []).filter(
        (varbind: MockVarbind) => {
          return varbind.oid.startsWith(`${oid}.`);
        },
      );

      for (let i: number = 0; i < inSubtree.length; i += maxRepetitions) {
        const batch: Array<MockVarbind> = inSubtree.slice(
          i,
          i + maxRepetitions,
        );
        session.deliveredVarbinds += batch.length;
        if (feedCb(batch)) {
          // Walker aborted: row cap or time budget reached.
          break;
        }
      }

      doneCb(null);
    },
  };

  return session;
}

// The distinct endpoint tables a session was asked for, in request order.
function walkedTables(session: MockSubtreeSession): Array<string> {
  const tables: Array<string> = [];

  for (const oid of session.subtreeOids) {
    for (const tableOid of ENDPOINT_TABLE_OIDS) {
      if (oid.startsWith(`${tableOid}.1.`) && !tables.includes(tableOid)) {
        tables.push(tableOid);
      }
    }
  }

  return tables;
}

/*
 * One real ipNetToMediaTable row: ifIndex 2, 10.0.0.5 ->
 * aa:bb:cc:dd:ee:ff, dynamic(3). Row index is "<ifIndex>.<a.b.c.d>", so
 * every instance OID is "<table>.1.<column>.2.10.0.0.5".
 */
const ARP_VARBINDS: Array<MockVarbind> = [
  { oid: "1.3.6.1.2.1.4.22.1.1.2.10.0.0.5", value: 2 },
  { oid: "1.3.6.1.2.1.4.22.1.2.2.10.0.0.5", value: ENDPOINT_MAC_BUFFER },
  { oid: "1.3.6.1.2.1.4.22.1.3.2.10.0.0.5", value: "10.0.0.5" },
  { oid: "1.3.6.1.2.1.4.22.1.4.2.10.0.0.5", value: 3 },
];

/*
 * One dot1qTpFdbTable row: fdbId(vlan) 100, MAC aa:bb:cc:dd:ee:ff learned
 * on bridge port 5. Row index is "<fdbId>.<six MAC octets in decimal>".
 */
const Q_BRIDGE_VARBINDS: Array<MockVarbind> = [
  {
    oid: "1.3.6.1.2.1.17.7.1.2.2.1.2.100.170.187.204.221.238.255",
    value: 5,
  },
  {
    oid: "1.3.6.1.2.1.17.7.1.2.2.1.3.100.170.187.204.221.238.255",
    value: 3,
  },
];

// The same MAC in dot1dTpFdbTable, on bridge port 7. Index is the MAC.
const DOT1D_VARBINDS: Array<MockVarbind> = [
  {
    oid: "1.3.6.1.2.1.17.4.3.1.1.170.187.204.221.238.255",
    value: ENDPOINT_MAC_BUFFER,
  },
  { oid: "1.3.6.1.2.1.17.4.3.1.2.170.187.204.221.238.255", value: 7 },
  { oid: "1.3.6.1.2.1.17.4.3.1.3.170.187.204.221.238.255", value: 3 },
];

// dot1dBasePortTable: bridge port 5 -> ifIndex 10105, 7 -> 10107.
const BASE_PORT_VARBINDS: Array<MockVarbind> = [
  { oid: "1.3.6.1.2.1.17.1.4.1.2.5", value: 10105 },
  { oid: "1.3.6.1.2.1.17.1.4.1.2.7", value: 10107 },
];

/*
 * Builds `count` distinct ARP rows so the mid-walk row cap can be
 * exercised: row i is ifIndex 2, IP 10.0.<i/250>.<(i%250)+1>, MAC
 * 02:00:00:<i as three octets>, dynamic(3).
 */
function buildLargeArpVarbinds(count: number): Array<MockVarbind> {
  const varbinds: Array<MockVarbind> = [];

  for (let i: number = 0; i < count; i++) {
    const ip: string = `10.0.${Math.floor(i / 250)}.${(i % 250) + 1}`;
    const index: string = `2.${ip}`;
    const mac: Buffer = Buffer.from([
      0x02,
      0x00,
      0x00,
      (i >> 16) & 0xff,
      (i >> 8) & 0xff,
      i & 0xff,
    ]);

    varbinds.push({ oid: `1.3.6.1.2.1.4.22.1.1.${index}`, value: 2 });
    varbinds.push({ oid: `1.3.6.1.2.1.4.22.1.2.${index}`, value: mac });
    varbinds.push({ oid: `1.3.6.1.2.1.4.22.1.3.${index}`, value: ip });
    varbinds.push({ oid: `1.3.6.1.2.1.4.22.1.4.${index}`, value: 3 });
  }

  return varbinds;
}

describe("SnmpMonitor.walkArpTable", () => {
  test("walks the ipNetToMediaTable columns as raw entry subtrees", async () => {
    const session: MockSubtreeSession = createSubtreeSession({});

    await Internal.walkArpTable(session);

    /*
     * The exact wire OIDs: "<table>.1.<column>". If the table constant
     * carried the Entry subid these would each gain a spurious ".1",
     * landing under ipNetToMediaIfIndex instead of on the real columns.
     */
    expect(session.subtreeOids).toEqual([
      "1.3.6.1.2.1.4.22.1.1",
      "1.3.6.1.2.1.4.22.1.2",
      "1.3.6.1.2.1.4.22.1.3",
      "1.3.6.1.2.1.4.22.1.4",
    ]);
    expect(session.maxRepetitions).toEqual([
      EXPECTED_MAX_REPETITIONS,
      EXPECTED_MAX_REPETITIONS,
      EXPECTED_MAX_REPETITIONS,
      EXPECTED_MAX_REPETITIONS,
    ]);
  });

  test("merges raw varbinds into ArpEntry values", async () => {
    const session: MockSubtreeSession = createSubtreeSession({
      [ARP_TABLE_OID]: ARP_VARBINDS,
    });

    const entries: Array<ArpEntry> = await Internal.walkArpTable(session);

    expect(entries).toEqual([
      {
        ipAddress: "10.0.0.5",
        macAddress: "aa:bb:cc:dd:ee:ff",
        interfaceIndex: 2,
        entryType: "dynamic",
      },
    ]);
  });

  test("an empty ARP cache produces an empty array so stale entries are cleared", async () => {
    expect(await Internal.walkArpTable(createSubtreeSession({}))).toEqual([]);
  });

  test("a table walk error propagates to the caller", async () => {
    const session: MockSubtreeSession = createSubtreeSession({
      [ARP_TABLE_OID]: new Error("RequestTimedOutError"),
    });

    await expect(Internal.walkArpTable(session)).rejects.toThrow(
      "RequestTimedOutError",
    );
  });

  test("the row cap stops the walk mid-flight instead of buffering the whole cache", async () => {
    // 5000 rows x 4 columns = 20000 varbinds available from the "device".
    const session: MockSubtreeSession = createSubtreeSession({
      [ARP_TABLE_OID]: buildLargeArpVarbinds(5000),
    });

    const entries: Array<ArpEntry> = await Internal.walkArpTable(session);

    expect(entries).toHaveLength(MAX_ARP_ENTRIES);
    expect(entries[0]).toEqual({
      ipAddress: "10.0.0.1",
      macAddress: "02:00:00:00:00:00",
      interfaceIndex: 2,
      entryType: "dynamic",
    });
    // Row 2047 is the last one kept: 2047 = 0x7ff, 2047 % 250 = 47.
    expect(entries[MAX_ARP_ENTRIES - 1]).toEqual({
      ipAddress: "10.0.8.48",
      macAddress: "02:00:00:00:07:ff",
      interfaceIndex: 2,
      entryType: "dynamic",
    });

    /*
     * The bound is enforced DURING the walk, not after it: each of the 4
     * columns aborts in the GETBULK batch that crosses 2048 rows, i.e.
     * after 2060 varbinds (103 batches of 20), for 8240 in total — not the
     * 20000 the device was willing to ship.
     */
    expect(session.deliveredVarbinds).toBe(8240);
  });

  test("an already-exhausted time budget rejects before a single PDU is sent", async () => {
    const session: MockSubtreeSession = createSubtreeSession({
      [ARP_TABLE_OID]: ARP_VARBINDS,
    });

    await expect(
      Internal.walkArpTable(session, Date.now() - 1),
    ).rejects.toThrow("exceeded its time budget");

    /*
     * Rejecting (rather than returning a partial table) is what makes the
     * caller keep its stored snapshot instead of half-clearing it.
     */
    expect(session.subtreeOids).toEqual([]);
  });
});

describe("SnmpMonitor.walkFdb", () => {
  test("Q-BRIDGE rows win: dot1d is never walked and bridge ports are translated", async () => {
    const session: MockSubtreeSession = createSubtreeSession({
      [Q_BRIDGE_FDB_OID]: Q_BRIDGE_VARBINDS,
      [BASE_PORT_OID]: BASE_PORT_VARBINDS,
    });

    const entries: Array<FdbEntry> = await Internal.walkFdb(session);

    expect(entries).toEqual([
      {
        macAddress: "aa:bb:cc:dd:ee:ff",
        bridgePort: 5,
        interfaceIndex: 10105,
        vlanId: 100,
        status: "learned",
      },
    ]);
    expect(walkedTables(session)).toEqual([Q_BRIDGE_FDB_OID, BASE_PORT_OID]);
    // Exact wire OIDs for the Q-BRIDGE port/status columns and base-port map.
    expect(session.subtreeOids).toEqual([
      "1.3.6.1.2.1.17.7.1.2.2.1.2",
      "1.3.6.1.2.1.17.7.1.2.2.1.3",
      "1.3.6.1.2.1.17.1.4.1.2",
    ]);
  });

  test("an empty Q-BRIDGE table falls back to dot1dTpFdbTable", async () => {
    const session: MockSubtreeSession = createSubtreeSession({
      [DOT1D_FDB_OID]: DOT1D_VARBINDS,
      [BASE_PORT_OID]: BASE_PORT_VARBINDS,
    });

    const entries: Array<FdbEntry> = await Internal.walkFdb(session);

    expect(entries).toEqual([
      {
        macAddress: "aa:bb:cc:dd:ee:ff",
        bridgePort: 7,
        interfaceIndex: 10107,
        vlanId: undefined,
        status: "learned",
      },
    ]);
    expect(walkedTables(session)).toEqual([
      Q_BRIDGE_FDB_OID,
      DOT1D_FDB_OID,
      BASE_PORT_OID,
    ]);
    // The dot1d columns are read at "<table>.1.<column>", not one deeper.
    expect(session.subtreeOids).toContain("1.3.6.1.2.1.17.4.3.1.1");
    expect(session.subtreeOids).toContain("1.3.6.1.2.1.17.4.3.1.2");
    expect(session.subtreeOids).toContain("1.3.6.1.2.1.17.4.3.1.3");
  });

  test("a Q-BRIDGE walk error (table unimplemented) falls back to dot1d", async () => {
    const session: MockSubtreeSession = createSubtreeSession({
      [Q_BRIDGE_FDB_OID]: new Error("NoSuchName"),
      [DOT1D_FDB_OID]: DOT1D_VARBINDS,
      [BASE_PORT_OID]: BASE_PORT_VARBINDS,
    });

    const entries: Array<FdbEntry> = await Internal.walkFdb(session);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.bridgePort).toBe(7);
    expect(entries[0]!.interfaceIndex).toBe(10107);
  });

  test("rejects only when NEITHER FDB table is walkable", async () => {
    const session: MockSubtreeSession = createSubtreeSession({
      [Q_BRIDGE_FDB_OID]: new Error("NoSuchName"),
      [DOT1D_FDB_OID]: new Error("NoSuchName"),
    });

    await expect(Internal.walkFdb(session)).rejects.toThrow("NoSuchName");
  });

  test("an empty Q-BRIDGE answer with a failing dot1d walk resolves to [] (empty FDB, not an error)", async () => {
    const session: MockSubtreeSession = createSubtreeSession({
      [DOT1D_FDB_OID]: new Error("NoSuchName"),
    });

    expect(await Internal.walkFdb(session)).toEqual([]);
  });

  test("a failing base-port walk leaves entries untranslated instead of failing the FDB", async () => {
    const session: MockSubtreeSession = createSubtreeSession({
      [Q_BRIDGE_FDB_OID]: Q_BRIDGE_VARBINDS,
      [BASE_PORT_OID]: new Error("RequestTimedOutError"),
    });

    const entries: Array<FdbEntry> = await Internal.walkFdb(session);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.bridgePort).toBe(5);
    expect(entries[0]!.interfaceIndex).toBeUndefined();
  });

  test("a bridge port with no base-port mapping row keeps interfaceIndex undefined", async () => {
    const session: MockSubtreeSession = createSubtreeSession({
      [Q_BRIDGE_FDB_OID]: Q_BRIDGE_VARBINDS,
      [BASE_PORT_OID]: [{ oid: "1.3.6.1.2.1.17.1.4.1.2.9", value: 10109 }],
    });

    const entries: Array<FdbEntry> = await Internal.walkFdb(session);

    expect(entries[0]!.interfaceIndex).toBeUndefined();
  });
});

describe("SnmpMonitor.walkInterfaces — endpoint collection gating", () => {
  const config: MonitorStepSnmpMonitor = {
    snmpVersion: SnmpVersion.V2c,
    hostname: "10.0.0.1",
    port: 161,
    communityString: "public",
    oids: [],
    timeout: 1000,
    retries: 0,
    monitorInterfaces: true,
  };

  /*
   * A full-session stand-in: system-group GETs fail (best-effort, caught),
   * the IF-MIB/LLDP/CDP/entity walks answer with empty tables, and the
   * endpoint tables answer from the subtree fixtures. Installed via the
   * module-level createSession mock so walkInterfaces runs its real flow
   * end to end without a socket.
   */
  function installWalkSession(
    endpointFixtures: EndpointFixtures,
  ): MockSubtreeSession {
    const subtreeSession: MockSubtreeSession =
      createSubtreeSession(endpointFixtures);
    const session: Record<string, unknown> = {
      subtree: subtreeSession.subtree,
      tableColumns: (
        _tableOid: string,
        _columns: Array<number>,
        callback: (err: Error | null, tbl?: unknown) => void,
      ): void => {
        callback(null, {});
      },
      get: (
        _oids: Array<string>,
        callback: (error: Error | null) => void,
      ): void => {
        callback(new Error("system group unavailable"));
      },
      close: jest.fn(),
      on: jest.fn(),
    };

    (
      snmp.createSession as unknown as {
        mockReturnValue: (value: unknown) => void;
      }
    ).mockReturnValue(session);

    return subtreeSession;
  }

  afterEach(() => {
    // Restore the module-mock default so later tests get the plain stub.
    (
      snmp.createSession as unknown as {
        mockImplementation: (impl: () => unknown) => void;
      }
    ).mockImplementation(() => {
      return { close: jest.fn(), on: jest.fn() };
    });
  });

  test("collectEndpoints defaults OFF: an absent flag walks no endpoint table", async () => {
    const session: MockSubtreeSession = installWalkSession({});

    const result: SnmpWalkResult = await SnmpMonitor.walkInterfaces(config, {});

    /*
     * Endpoint collection is strictly opt-in — a monitor that never asked
     * for it must not start walking ARP/FDB (and writing an endpoint row
     * per MAC per poll) merely because the probe was upgraded.
     */
    expect(session.subtreeOids).toEqual([]);
    expect(result.arpEntries).toBeUndefined();
    expect(result.fdbEntries).toBeUndefined();
  });

  test("collectEndpoints: false skips the ARP and FDB walks entirely", async () => {
    const session: MockSubtreeSession = installWalkSession({});

    const result: SnmpWalkResult = await SnmpMonitor.walkInterfaces(config, {
      collectEndpoints: false,
    });

    expect(walkedTables(session)).toEqual([]);
    expect(result.arpEntries).toBeUndefined();
    expect(result.fdbEntries).toBeUndefined();
  });

  test("collectEndpoints: true opts in — ARP and FDB ride the interface walk", async () => {
    const session: MockSubtreeSession = installWalkSession({});

    const result: SnmpWalkResult = await SnmpMonitor.walkInterfaces(config, {
      collectEndpoints: true,
    });

    expect(walkedTables(session)).toEqual([
      ARP_TABLE_OID,
      Q_BRIDGE_FDB_OID,
      DOT1D_FDB_OID,
    ]);
    // Successful-but-empty walks report [], clearing stale snapshots.
    expect(result.arpEntries).toEqual([]);
    expect(result.fdbEntries).toEqual([]);
  });

  test("an ARP walk failure is best-effort: the interface walk still succeeds", async () => {
    installWalkSession({
      [ARP_TABLE_OID]: new Error("RequestTimedOutError"),
    });

    const result: SnmpWalkResult = await SnmpMonitor.walkInterfaces(config, {
      collectEndpoints: true,
    });

    // Undefined (walk failed, keep stored snapshot), not a thrown error.
    expect(result.arpEntries).toBeUndefined();
    expect(result.fdbEntries).toEqual([]);
    expect(result.interfaces).toEqual([]);
  });

  test("endpoint results thread through to the walk result", async () => {
    installWalkSession({
      [ARP_TABLE_OID]: ARP_VARBINDS,
      [Q_BRIDGE_FDB_OID]: Q_BRIDGE_VARBINDS,
      [BASE_PORT_OID]: BASE_PORT_VARBINDS,
    });

    const result: SnmpWalkResult = await SnmpMonitor.walkInterfaces(config, {
      collectEndpoints: true,
    });

    expect(result.arpEntries).toEqual([
      {
        ipAddress: "10.0.0.5",
        macAddress: "aa:bb:cc:dd:ee:ff",
        interfaceIndex: 2,
        entryType: "dynamic",
      },
    ]);
    expect(result.fdbEntries).toEqual([
      {
        macAddress: "aa:bb:cc:dd:ee:ff",
        bridgePort: 5,
        interfaceIndex: 10105,
        vlanId: 100,
        status: "learned",
      },
    ]);
  });
});

// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpMonitorResponse from "Common/Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import {
  SnmpTableResult,
  SnmpTableResultRow,
  SnmpTableWalkRequest,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";

/*
 * A fake agent: an ordered map of OID -> varbind that answers GETs and
 * subtree walks the way net-snmp's session does (feeding varbinds in
 * batches, stopping when the feed callback returns true). Only the session
 * factory is replaced; net-snmp's constants and helpers stay real, so the
 * value parsing under test is the production code.
 */
interface FakeVarbind {
  oid: string;
  type: number;
  value: unknown;
}

const agent: Map<string, FakeVarbind> = new Map();
const subtreeCalls: Array<string> = [];
// Column OIDs whose walk fails with this error.
const failingColumns: Map<string, Error> = new Map();
let createSessionError: Error | null = null;
let closeCallCount: number = 0;

function compareOids(a: string, b: string): number {
  const aParts: Array<number> = a.split(".").map(Number);
  const bParts: Array<number> = b.split(".").map(Number);

  for (let i: number = 0; i < Math.max(aParts.length, bParts.length); i++) {
    if (aParts[i] === undefined) {
      return -1;
    }
    if (bParts[i] === undefined) {
      return 1;
    }
    if (aParts[i] !== bParts[i]) {
      return aParts[i]! - bParts[i]!;
    }
  }

  return 0;
}

function buildSession(): Record<string, unknown> {
  return {
    close: jest.fn(() => {
      closeCallCount++;
    }),
    on: jest.fn(),
    get: jest.fn(
      (
        oids: Array<string>,
        callback: (error: Error | null, varbinds: Array<FakeVarbind>) => void,
      ) => {
        setImmediate(() => {
          callback(
            null,
            oids.map((oid: string) => {
              return agent.get(oid) || { oid: oid, type: 128, value: null };
            }),
          );
        });
      },
    ),
    subtree: jest.fn(
      (
        baseOid: string,
        _maxRepetitions: number,
        feedCb: (varbinds: Array<FakeVarbind>) => boolean,
        doneCb: (error: Error | null) => void,
      ) => {
        subtreeCalls.push(baseOid);

        setImmediate(() => {
          const failure: Error | undefined = failingColumns.get(baseOid);

          if (failure) {
            doneCb(failure);
            return;
          }

          const inSubtree: Array<FakeVarbind> = Array.from(agent.values())
            .filter((varbind: FakeVarbind) => {
              return varbind.oid.startsWith(`${baseOid}.`);
            })
            .sort((a: FakeVarbind, b: FakeVarbind) => {
              return compareOids(a.oid, b.oid);
            });

          // Batches of three, like GETBULK pages.
          for (let i: number = 0; i < inSubtree.length; i += 3) {
            if (feedCb(inSubtree.slice(i, i + 3))) {
              break;
            }
          }

          doneCb(null);
        });
      },
    ),
  };
}

jest.mock("net-snmp", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "net-snmp",
  ) as Record<string, unknown>;

  return {
    ...actual,
    createSession: jest.fn(() => {
      if (createSessionError) {
        throw createSessionError;
      }
      return buildSession();
    }),
    createV3Session: jest.fn(() => {
      return buildSession();
    }),
  };
});

import SnmpMonitor from "../../../../Utils/Monitors/MonitorTypes/SnmpMonitor";

// net-snmp ObjectType values.
const INTEGER: number = 2;
const OCTET_STRING: number = 4;
const COUNTER64: number = 70;

const IPSEC_ENTRY: string = "1.3.6.1.4.1.2604.5.1.6.1.1.1.1";
const IPSEC_NAME: string = `${IPSEC_ENTRY}.2`;
const IPSEC_STATUS: string = `${IPSEC_ENTRY}.9`;

const RADIO_ENTRY: string = "1.3.6.1.4.1.17713.22.1.2.1";
const RADIO_BAND: string = `${RADIO_ENTRY}.3`;
const RADIO_TX_BYTES: string = `${RADIO_ENTRY}.11`;

function put(oid: string, type: number, value: unknown): void {
  agent.set(oid, { oid: oid, type: type, value: value });
}

function seedSophosTunnels(): void {
  put(`${IPSEC_NAME}.1`, OCTET_STRING, Buffer.from("HQ-Branch1"));
  put(`${IPSEC_NAME}.2`, OCTET_STRING, Buffer.from("HQ-Branch2"));
  put(`${IPSEC_NAME}.10`, OCTET_STRING, Buffer.from("Branch-10"));
  put(`${IPSEC_STATUS}.1`, INTEGER, 1);
  put(`${IPSEC_STATUS}.2`, INTEGER, 0);
  put(`${IPSEC_STATUS}.10`, INTEGER, 2);
  // A neighbouring column that must not leak into the walk of .9.
  put(`${IPSEC_ENTRY}.10.1`, INTEGER, 1);
}

function config(tables: Array<SnmpTableWalkRequest>): MonitorStepSnmpMonitor {
  return {
    snmpVersion: SnmpVersion.V2c,
    hostname: "192.0.2.10",
    port: 161,
    communityString: "public",
    oids: [{ oid: "1.3.6.1.2.1.1.1.0", name: "sysDescr" }],
    timeout: 5000,
    retries: 0,
    monitorInterfaces: false,
    tables: tables,
  };
}

function rowsByIndex(
  result: SnmpTableResult,
): Record<string, SnmpTableResultRow["values"]> {
  const rows: Record<string, SnmpTableResultRow["values"]> = {};

  for (const row of result.rows) {
    rows[row.index] = row.values;
  }

  return rows;
}

describe("SnmpMonitor.walkTables", () => {
  beforeEach(() => {
    agent.clear();
    subtreeCalls.length = 0;
    failingColumns.clear();
    createSessionError = null;
    closeCallCount = 0;
  });

  test("joins the columns of a table into rows keyed by index", async () => {
    seedSophosTunnels();

    const [result] = await SnmpMonitor.walkTables(
      config([
        {
          key: "ipsec_tunnels",
          columnOids: [IPSEC_NAME, IPSEC_STATUS],
          maxRows: 100,
        },
      ]),
      {},
    );

    expect(result!.key).toBe("ipsec_tunnels");
    expect(result!.failureCause).toBeUndefined();
    expect(result!.isTruncated).toBeUndefined();
    expect(rowsByIndex(result!)).toEqual({
      "1": { [IPSEC_NAME]: "HQ-Branch1", [IPSEC_STATUS]: 1 },
      "2": { [IPSEC_NAME]: "HQ-Branch2", [IPSEC_STATUS]: 0 },
      "10": { [IPSEC_NAME]: "Branch-10", [IPSEC_STATUS]: 2 },
    });
    expect(subtreeCalls).toEqual([IPSEC_NAME, IPSEC_STATUS]);
    expect(closeCallCount).toBe(1);
  });

  test("decodes counters and binary strings the way health OIDs are decoded", async () => {
    put(`${RADIO_BAND}.1`, OCTET_STRING, Buffer.from("2.4GHz"));
    const counter: Buffer = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt("5000000000"));
    put(`${RADIO_TX_BYTES}.1`, COUNTER64, counter);
    // A binary OctetString (e.g. a MAC) renders as hex rather than mojibake.
    put(
      `${RADIO_BAND}.2`,
      OCTET_STRING,
      Buffer.from([0x00, 0x1a, 0x2b, 0x3c, 0x4d, 0x5e]),
    );

    const [result] = await SnmpMonitor.walkTables(
      config([
        {
          key: "wifi_radios",
          columnOids: [RADIO_BAND, RADIO_TX_BYTES],
          maxRows: 10,
        },
      ]),
      {},
    );

    const rows: Record<string, SnmpTableResultRow["values"]> = rowsByIndex(
      result!,
    );
    expect(rows["1"]).toEqual({
      [RADIO_BAND]: "2.4GHz",
      [RADIO_TX_BYTES]: 5000000000,
    });
    expect(String(rows["2"]![RADIO_BAND]).toLowerCase()).toBe(
      "00:1a:2b:3c:4d:5e",
    );
  });

  test("stops at the row limit and says so", async () => {
    for (let i: number = 1; i <= 7; i++) {
      put(`${IPSEC_STATUS}.${i}`, INTEGER, 1);
    }

    const [result] = await SnmpMonitor.walkTables(
      config([
        { key: "ipsec_tunnels", columnOids: [IPSEC_STATUS], maxRows: 4 },
      ]),
      {},
    );

    expect(result!.rows).toHaveLength(4);
    expect(result!.isTruncated).toBe(true);
  });

  test("caps the union of rows when columns have different indexes", async () => {
    put(`${IPSEC_NAME}.1`, OCTET_STRING, Buffer.from("A"));
    put(`${IPSEC_NAME}.2`, OCTET_STRING, Buffer.from("B"));
    put(`${IPSEC_STATUS}.3`, INTEGER, 1);
    put(`${IPSEC_STATUS}.4`, INTEGER, 1);

    const [result] = await SnmpMonitor.walkTables(
      config([
        {
          key: "ipsec_tunnels",
          columnOids: [IPSEC_NAME, IPSEC_STATUS],
          maxRows: 3,
        },
      ]),
      {},
    );

    expect(result!.rows).toHaveLength(3);
    expect(result!.isTruncated).toBe(true);
  });

  test("a column the device does not implement simply has no values", async () => {
    seedSophosTunnels();

    const [result] = await SnmpMonitor.walkTables(
      config([
        {
          key: "ipsec_tunnels",
          columnOids: [IPSEC_STATUS, `${IPSEC_ENTRY}.99`],
          maxRows: 100,
        },
      ]),
      {},
    );

    expect(result!.failureCause).toBeUndefined();
    expect(rowsByIndex(result!)["2"]).toEqual({ [IPSEC_STATUS]: 0 });
  });

  test("a failing column fails only its own table", async () => {
    seedSophosTunnels();
    put(`${RADIO_BAND}.1`, OCTET_STRING, Buffer.from("5GHz"));
    failingColumns.set(IPSEC_STATUS, new Error("Request timed out"));

    const results: Array<SnmpTableResult> = await SnmpMonitor.walkTables(
      config([
        {
          key: "ipsec_tunnels",
          columnOids: [IPSEC_NAME, IPSEC_STATUS],
          maxRows: 100,
        },
        { key: "wifi_radios", columnOids: [RADIO_BAND], maxRows: 100 },
      ]),
      {},
    );

    expect(results[0]).toEqual({
      key: "ipsec_tunnels",
      rows: [],
      failureCause: "Request timed out",
    });
    expect(results[1]!.failureCause).toBeUndefined();
    expect(results[1]!.rows).toHaveLength(1);
  });

  test("skips malformed and duplicate column OIDs", async () => {
    seedSophosTunnels();

    await SnmpMonitor.walkTables(
      config([
        {
          key: "ipsec_tunnels",
          columnOids: [`.${IPSEC_STATUS}`, IPSEC_STATUS, "not-an-oid", ""],
          maxRows: 100,
        },
      ]),
      {},
    );

    expect(subtreeCalls).toEqual([IPSEC_STATUS]);
  });

  test("ignores tables without a key and returns nothing for no tables", async () => {
    expect(await SnmpMonitor.walkTables(config([]), {})).toEqual([]);
    expect(
      await SnmpMonitor.walkTables(
        config([{ key: "", columnOids: [IPSEC_STATUS], maxRows: 5 }]),
        {},
      ),
    ).toEqual([]);
  });

  test("reports every table as failed when no session can be opened", async () => {
    createSessionError = new Error("SNMP v3 username is required");

    expect(
      await SnmpMonitor.walkTables(
        config([
          { key: "a", columnOids: [IPSEC_STATUS], maxRows: 5 },
          { key: "b", columnOids: [RADIO_BAND], maxRows: 5 },
        ]),
        {},
      ),
    ).toEqual([
      { key: "a", rows: [], failureCause: "SNMP v3 username is required" },
      { key: "b", rows: [], failureCause: "SNMP v3 username is required" },
    ]);
  });

  test("a table whose time budget has run out says so instead of returning half its rows", async () => {
    seedSophosTunnels();

    const session: Record<string, unknown> = buildSession();

    const result: SnmpTableResult = await SnmpMonitor.walkTable(
      session as never,
      { key: "ipsec_tunnels", columnOids: [IPSEC_STATUS], maxRows: 100 },
      Date.now() - 1,
    );

    expect(result.rows).toEqual([]);
    expect(result.failureCause).toContain("time budget");
  });

  test("defaults and clamps the row limit", async () => {
    for (let i: number = 1; i <= 300; i++) {
      put(`${IPSEC_STATUS}.${i}`, INTEGER, 1);
    }

    const [defaulted, clamped] = await SnmpMonitor.walkTables(
      config([
        { key: "a", columnOids: [IPSEC_STATUS], maxRows: 0 },
        { key: "b", columnOids: [IPSEC_STATUS], maxRows: 100000 },
      ]),
      {},
    );

    expect(defaulted!.rows).toHaveLength(100);
    expect(clamped!.rows).toHaveLength(250);
  });
});

describe("SnmpMonitor.query with tables", () => {
  beforeEach(() => {
    agent.clear();
    subtreeCalls.length = 0;
    failingColumns.clear();
    createSessionError = null;
    closeCallCount = 0;
    put("1.3.6.1.2.1.1.1.0", OCTET_STRING, Buffer.from("Sophos XGS2100"));
  });

  test("returns the walked tables alongside the OID responses", async () => {
    seedSophosTunnels();

    const response: SnmpMonitorResponse | null = await SnmpMonitor.query(
      config([
        {
          key: "ipsec_tunnels",
          columnOids: [IPSEC_NAME, IPSEC_STATUS],
          maxRows: 100,
        },
      ]),
      { isOnlineCheckRequest: true },
    );

    expect(response!.isOnline).toBe(true);
    expect(response!.oidResponses[0]!.value).toBe("Sophos XGS2100");
    expect(response!.tableResults).toHaveLength(1);
    expect(response!.tableResults![0]!.rows).toHaveLength(3);
  });

  test("a failing table never fails the check", async () => {
    failingColumns.set(IPSEC_STATUS, new Error("Request timed out"));

    const response: SnmpMonitorResponse | null = await SnmpMonitor.query(
      config([
        { key: "ipsec_tunnels", columnOids: [IPSEC_STATUS], maxRows: 100 },
      ]),
      { isOnlineCheckRequest: true },
    );

    expect(response!.isOnline).toBe(true);
    expect(response!.tableResults![0]!.failureCause).toBe("Request timed out");
  });

  test("sends no tableResults when the check asked for no tables", async () => {
    const response: SnmpMonitorResponse | null = await SnmpMonitor.query(
      config([]),
      { isOnlineCheckRequest: true },
    );

    expect(response!.isOnline).toBe(true);
    expect(response!.tableResults).toBeUndefined();
    expect(subtreeCalls).toEqual([]);
  });
});

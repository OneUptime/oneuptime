import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { TransceiverMibSource } from "Common/Types/Monitor/SnmpMonitor/SnmpTransceiver";
import { SnmpTableRows } from "../../../Utils/Snmp/EndpointTableParsers";
import {
  CISCO_ENT_SENSOR_THRESHOLD_TABLE_OID,
  CISCO_ENT_SENSOR_VALUE_TABLE_OID,
  ENT_ALIAS_MAPPING_TABLE_OID,
  ENT_PHYSICAL_TABLE_OID,
  ENT_PHY_SENSOR_TABLE_OID,
  JNX_DOM_CURRENT_TABLE_OID,
  JNX_DOM_LANE_TABLE_OID,
  MTXR_OPTICAL_TABLE_OID,
  TransceiverInterfaceCandidate,
} from "../../../Utils/Snmp/TransceiverParsers";
import TransceiverWalker, {
  MAX_SENSOR_ROWS,
  TRANSCEIVER_STATIC_CACHE_TTL_MS,
  TransceiverSnmpAccess,
  TransceiverStaticCache,
  TransceiverWalkError,
  TransceiverWalkResult,
  mergeTableRows,
} from "../../../Utils/Snmp/TransceiverWalker";

/*
 * The walker against a fake agent: an in-memory set of tables answering
 * column walks and cell GETs the way the probe's SNMP session does, every
 * request recorded. What is pinned is the cost and the honesty of a read:
 * a device is read in full once, then only its readings until an optic is
 * swapped or the hour is up; a device without a transceiver MIB costs one
 * request per source; and a read that could not finish throws rather than
 * passing a cut-off table off as optics gone.
 */

const CISCO: string = "1.3.6.1.4.1.9.1.2494";
const JUNIPER: string = "1.3.6.1.4.1.2636.1.1.1.2.63";
const MIKROTIK: string = "1.3.6.1.4.1.14988.1";
const GENERIC: string = "1.3.6.1.4.1.52642.2.1.45.22";

interface Request {
  kind: "walk" | "get";
  tableOid: string;
  columns: Array<number>;
}

class FakeAgent {
  public readonly tables: Map<string, SnmpTableRows> = new Map();
  public readonly requests: Array<Request> = [];
  public readonly failures: Map<string, Error> = new Map();

  public set(tableOid: string, rows: SnmpTableRows): this {
    this.tables.set(tableOid, rows);
    return this;
  }

  public access(): TransceiverSnmpAccess {
    return {
      walkColumns: async (
        tableOid: string,
        columns: Array<number>,
        maxRows: number,
      ): Promise<SnmpTableRows> => {
        this.requests.push({ kind: "walk", tableOid, columns });

        const failure: Error | undefined = this.failures.get(tableOid);
        if (failure) {
          throw failure;
        }

        const result: SnmpTableRows = {};
        let rows: number = 0;

        for (const [rowIndex, row] of Object.entries(
          this.tables.get(tableOid) || {},
        )) {
          const picked: Record<string, unknown> = {};

          for (const column of columns) {
            if (column.toString() in row) {
              picked[column.toString()] = row[column.toString()];
            }
          }

          if (Object.keys(picked).length > 0) {
            if (rows >= maxRows) {
              break;
            }
            result[rowIndex] = picked;
            rows++;
          }
        }

        return result;
      },
      getCells: async (
        tableOid: string,
        columns: Array<number>,
        rowIndexes: Array<string>,
      ): Promise<SnmpTableRows> => {
        this.requests.push({ kind: "get", tableOid, columns });

        const result: SnmpTableRows = {};
        const tableRows: SnmpTableRows = this.tables.get(tableOid) || {};

        for (const rowIndex of rowIndexes) {
          for (const column of columns) {
            const value: unknown = tableRows[rowIndex]?.[column.toString()];
            if (value !== undefined) {
              result[rowIndex] = {
                ...(result[rowIndex] || {}),
                [column.toString()]: value,
              };
            }
          }
        }

        return result;
      },
    };
  }

  public walksOf(tableOid: string): Array<Request> {
    return this.requests.filter((request: Request) => {
      return request.kind === "walk" && request.tableOid === tableOid;
    });
  }

  public clearRequests(): void {
    this.requests.length = 0;
  }
}

function text(value: string): Buffer {
  return Buffer.from(value, "latin1");
}

const INTERFACES: Array<TransceiverInterfaceCandidate> = [
  { interfaceIndex: 10152, names: ["Gi1/0/52", "GigabitEthernet1/0/52"] },
  { interfaceIndex: 10151, names: ["Gi1/0/51", "GigabitEthernet1/0/51"] },
];

// A Catalyst with one 1000BASE-SX SFP in Gi1/0/52.
function ciscoAgent(rxRaw: number = -47): FakeAgent {
  return new FakeAgent()
    .set(CISCO_ENT_SENSOR_VALUE_TABLE_OID, {
      "1006": { "1": 8, "2": 9, "3": 0, "4": 41, "5": 1 },
      "1063": { "1": 8, "2": 9, "3": 1, "4": 346, "5": 1 },
      "1066": { "1": 14, "2": 9, "3": 1, "4": -50, "5": 1 },
      "1067": { "1": 14, "2": 9, "3": 1, "4": rxRaw, "5": 1 },
    })
    .set(ENT_PHYSICAL_TABLE_OID, {
      "1001": {
        "2": text("WS-C2960X-48FPS-L"),
        "4": 1,
        "5": 3,
        "11": text("FCW1929B68S"),
      },
      "1006": { "2": text("Inlet Temperature"), "4": 1001, "5": 8 },
      "1062": {
        "2": text("1000BaseSX SFP"),
        "4": 1061,
        "5": 10,
        "7": text("GigabitEthernet1/0/52"),
        "11": text("FNS192717K1"),
        "13": text("GLC-SX-MMD"),
      },
      "1063": {
        "2": text("GigabitEthernet1/0/52 Module Temperature Sensor"),
        "4": 1062,
        "5": 8,
      },
      "1066": {
        "2": text("GigabitEthernet1/0/52 Transmit Power Sensor"),
        "4": 1062,
        "5": 8,
      },
      "1067": {
        "2": text("GigabitEthernet1/0/52 Receive Power Sensor"),
        "4": 1062,
        "5": 8,
      },
    })
    .set(CISCO_ENT_SENSOR_THRESHOLD_TABLE_OID, {
      "1067.1": { "2": 20, "3": 2, "4": -181 },
      "1067.2": { "2": 10, "3": 2, "4": -170 },
    })
    .set(ENT_ALIAS_MAPPING_TABLE_OID, {
      "1062.0": { "2": "1.3.6.1.2.1.2.2.1.1.10152" },
    });
}

// The identity rows the poll already walked (class, revisions, serial ...).
function identityRows(agent: FakeAgent): SnmpTableRows {
  const rows: SnmpTableRows = {};

  for (const [rowIndex, row] of Object.entries(
    agent.tables.get(ENT_PHYSICAL_TABLE_OID) || {},
  )) {
    rows[rowIndex] = {
      ...(row["5"] !== undefined ? { "5": row["5"] } : {}),
      ...(row["11"] !== undefined ? { "11": row["11"] } : {}),
      ...(row["13"] !== undefined ? { "13": row["13"] } : {}),
    };
  }

  return rows;
}

async function collect(
  agent: FakeAgent,
  options: {
    sysObjectId?: string | undefined;
    cacheKey?: string | undefined;
    nowMs?: number | undefined;
    entityRows?: SnmpTableRows | undefined;
  } = {},
): Promise<TransceiverWalkResult> {
  return TransceiverWalker.collect({
    sysObjectId: "sysObjectId" in options ? options.sysObjectId : CISCO,
    interfaces: INTERFACES,
    entityRows: options.entityRows,
    access: agent.access(),
    cacheKey: "cacheKey" in options ? options.cacheKey : "device-1@10.0.0.1",
    nowMs: options.nowMs ?? 1_000_000,
  });
}

beforeEach(() => {
  TransceiverWalker.cache.clear();
});

afterEach(() => {
  TransceiverWalker.cache.clear();
});

describe("TransceiverWalker - ENTITY-SENSOR flavors", () => {
  test("reads a Cisco device's optic in full on its first poll", async () => {
    const agent: FakeAgent = ciscoAgent();

    const walk: TransceiverWalkResult = await collect(agent, {
      entityRows: identityRows(agent),
    });

    expect(walk.source).toBe(TransceiverMibSource.CiscoEntitySensor);
    expect(walk.results).toHaveLength(1);
    expect(walk.results[0]).toMatchObject({
      interfaceIndex: 10152,
      partNumber: "GLC-SX-MMD",
      serialNumber: "FNS192717K1",
      measurements: {
        temperature: { readings: [{ value: 34.6 }] },
        txPower: { readings: [{ value: -5 }] },
        rxPower: {
          readings: [{ value: -4.7 }],
          thresholds: { lowAlarm: -18.1, lowWarning: -17 },
        },
      },
    });

    // The tree, the thresholds and the aliases - once.
    expect(
      agent.walksOf(ENT_PHYSICAL_TABLE_OID).map((request: Request) => {
        return request.columns;
      }),
    ).toEqual([[2, 4, 7]]);
    expect(agent.walksOf(CISCO_ENT_SENSOR_THRESHOLD_TABLE_OID)).toHaveLength(1);
    expect(agent.walksOf(ENT_ALIAS_MAPPING_TABLE_OID)).toHaveLength(1);
  });

  test("later polls read only the type column and GET the optical sensors' values", async () => {
    const agent: FakeAgent = ciscoAgent();
    const entityRows: SnmpTableRows = identityRows(agent);

    await collect(agent, { entityRows: entityRows });
    agent.clearRequests();

    // The light fell between polls.
    agent.tables.get(CISCO_ENT_SENSOR_VALUE_TABLE_OID)!["1067"]!["4"] = -92;

    const walk: TransceiverWalkResult = await collect(agent, {
      entityRows: entityRows,
      nowMs: 1_000_000 + 5 * 60 * 1000,
    });

    expect(walk.results[0]!.measurements.rxPower?.readings).toEqual([
      { value: -9.2 },
    ]);
    expect(agent.requests).toEqual([
      {
        kind: "walk",
        tableOid: CISCO_ENT_SENSOR_VALUE_TABLE_OID,
        columns: [1],
      },
      {
        kind: "get",
        tableOid: CISCO_ENT_SENSOR_VALUE_TABLE_OID,
        columns: [4, 5],
      },
    ]);
  });

  test("a swapped optic (a new serial in the entity tree) is read in full again", async () => {
    const agent: FakeAgent = ciscoAgent();

    await collect(agent, { entityRows: identityRows(agent) });
    agent.clearRequests();

    agent.tables.get(ENT_PHYSICAL_TABLE_OID)!["1062"]!["11"] =
      text("FNS000NEW01");

    const walk: TransceiverWalkResult = await collect(agent, {
      entityRows: identityRows(agent),
      nowMs: 1_000_000 + 60 * 1000,
    });

    expect(walk.results[0]!.serialNumber).toBe("FNS000NEW01");
    expect(agent.walksOf(ENT_PHYSICAL_TABLE_OID)).toHaveLength(1);
  });

  test("a new optical sensor is read in full again", async () => {
    const agent: FakeAgent = ciscoAgent();

    await collect(agent, { entityRows: identityRows(agent) });
    agent.clearRequests();

    agent.tables.get(CISCO_ENT_SENSOR_VALUE_TABLE_OID)!["1065"] = {
      "1": 5,
      "2": 8,
      "3": 1,
      "4": 61,
      "5": 1,
    };

    await collect(agent, {
      entityRows: identityRows(agent),
      nowMs: 1_000_000 + 60 * 1000,
    });

    expect(agent.walksOf(ENT_PHYSICAL_TABLE_OID)).toHaveLength(1);
  });

  test("after an hour the static part is read again, so a changed threshold is picked up", async () => {
    const agent: FakeAgent = ciscoAgent();
    const entityRows: SnmpTableRows = identityRows(agent);

    await collect(agent, { entityRows: entityRows });
    agent.clearRequests();

    await collect(agent, {
      entityRows: entityRows,
      nowMs: 1_000_000 + TRANSCEIVER_STATIC_CACHE_TTL_MS,
    });

    expect(agent.walksOf(CISCO_ENT_SENSOR_THRESHOLD_TABLE_OID)).toHaveLength(1);
  });

  test("without a device key nothing is cached", async () => {
    const agent: FakeAgent = ciscoAgent();

    await collect(agent, { cacheKey: undefined });
    await collect(agent, { cacheKey: undefined });

    expect(agent.walksOf(CISCO_ENT_SENSOR_THRESHOLD_TABLE_OID)).toHaveLength(2);
    expect(TransceiverWalker.cache.size).toBe(0);
  });

  test("without the poll's identity rows the walker reads them itself", async () => {
    const agent: FakeAgent = ciscoAgent();

    const walk: TransceiverWalkResult = await collect(agent, {
      entityRows: undefined,
    });

    expect(walk.results[0]!.serialNumber).toBe("FNS192717K1");
    expect(
      agent.walksOf(ENT_PHYSICAL_TABLE_OID).map((request: Request) => {
        return request.columns;
      }),
    ).toEqual([
      [2, 4, 7],
      [5, 8, 11, 12, 13],
    ]);
  });

  test("a Cisco agent without its own sensor table falls back to ENTITY-SENSOR-MIB", async () => {
    const agent: FakeAgent = ciscoAgent();
    agent.set(
      ENT_PHY_SENSOR_TABLE_OID,
      agent.tables.get(CISCO_ENT_SENSOR_VALUE_TABLE_OID)!,
    );
    agent.tables.delete(CISCO_ENT_SENSOR_VALUE_TABLE_OID);

    const walk: TransceiverWalkResult = await collect(agent);

    expect(walk.source).toBe(TransceiverMibSource.EntitySensor);
    // Standard ENTITY-SENSOR-MIB has no dBm type: only the temperature reads.
    expect(walk.results[0]!.measurements.temperature?.readings).toEqual([
      { value: 34.6 },
    ]);
    expect(walk.results[0]!.measurements.rxPower).toBeUndefined();
  });

  test("a sensor table with no optical sensor answered: no optics, from that source", async () => {
    const agent: FakeAgent = new FakeAgent().set(ENT_PHY_SENSOR_TABLE_OID, {
      // A fan's RPM and nothing else.
      "20": { "1": 10, "2": 9, "3": 0, "4": 9000, "5": 1 },
    });

    const walk: TransceiverWalkResult = await collect(agent, {
      sysObjectId: GENERIC,
    });

    expect(walk).toEqual({
      results: [],
      source: TransceiverMibSource.EntitySensor,
    });
    expect(agent.requests).toHaveLength(1);
  });
});

describe("TransceiverWalker - what a read costs and when it fails", () => {
  test("a device with no transceiver MIB costs one request per source", async () => {
    const agent: FakeAgent = new FakeAgent();

    expect(await collect(agent, { sysObjectId: JUNIPER })).toEqual({
      results: [],
    });
    expect(
      agent.requests.map((request: Request) => {
        return request.tableOid;
      }),
    ).toEqual([JNX_DOM_CURRENT_TABLE_OID, ENT_PHY_SENSOR_TABLE_OID]);
  });

  test("an SNMP error on a source's first column means it is not there", async () => {
    const agent: FakeAgent = ciscoAgent();
    agent.failures.set(
      CISCO_ENT_SENSOR_VALUE_TABLE_OID,
      new Error("NoSuchName"),
    );

    expect((await collect(agent)).source).toBeUndefined();
  });

  test("a timeout is a failed read - never 'no transceivers'", async () => {
    const agent: FakeAgent = ciscoAgent();
    const timeout: Error = new Error("Request timed out");
    timeout.name = "RequestTimedOutError";
    agent.failures.set(CISCO_ENT_SENSOR_VALUE_TABLE_OID, timeout);

    await expect(collect(agent)).rejects.toThrow("Request timed out");
    expect(agent.walksOf(ENT_PHY_SENSOR_TABLE_OID)).toHaveLength(0);
  });

  test("a timeout reading thresholds fails the read too", async () => {
    const agent: FakeAgent = ciscoAgent();
    agent.failures.set(
      CISCO_ENT_SENSOR_THRESHOLD_TABLE_OID,
      new Error("SNMP endpoint walk exceeded its time budget"),
    );

    await expect(collect(agent)).rejects.toThrow("time budget");
  });

  test("a missing threshold or alias table only costs what it would have added", async () => {
    const agent: FakeAgent = ciscoAgent();
    agent.failures.set(
      CISCO_ENT_SENSOR_THRESHOLD_TABLE_OID,
      new Error("NoSuchName"),
    );
    agent.failures.set(ENT_ALIAS_MAPPING_TABLE_OID, new Error("NoSuchName"));

    const walk: TransceiverWalkResult = await collect(agent);

    expect(walk.results[0]!.interfaceIndex).toBe(10152);
    expect(walk.results[0]!.measurements.rxPower?.thresholds).toBeUndefined();
  });

  test("a table longer than the cap is not trusted", async () => {
    const sensors: SnmpTableRows = {};
    for (let index: number = 1; index <= MAX_SENSOR_ROWS; index++) {
      sensors[index.toString()] = { "1": 8 };
    }

    await expect(
      collect(new FakeAgent().set(ENT_PHY_SENSOR_TABLE_OID, sensors), {
        sysObjectId: GENERIC,
      }),
    ).rejects.toBeInstanceOf(TransceiverWalkError);
  });

  test("isTimeout knows a timeout by name or by message", () => {
    const named: Error = new Error("x");
    named.name = "RequestTimedOutError";

    expect(TransceiverWalker.isTimeout(named)).toBe(true);
    expect(TransceiverWalker.isTimeout(new Error("Request timed out"))).toBe(
      true,
    );
    expect(
      TransceiverWalker.isTimeout(
        new Error("SNMP endpoint walk exceeded its time budget"),
      ),
    ).toBe(true);
    expect(TransceiverWalker.isTimeout(new Error("NoSuchName"))).toBe(false);
    expect(TransceiverWalker.isTimeout(undefined)).toBe(false);
  });
});

describe("TransceiverWalker - vendor tables indexed by ifIndex", () => {
  function juniperAgent(laneCount: number = 1): FakeAgent {
    return new FakeAgent()
      .set(JNX_DOM_CURRENT_TABLE_OID, {
        "10152": {
          "5": -473,
          "6": 6402,
          "7": -235,
          "8": 34,
          "10": -1801,
          "12": -1440,
          "25": 3291,
          "30": laneCount,
        },
      })
      .set(JNX_DOM_LANE_TABLE_OID, {
        "10152.0": { "6": -310, "7": 6500, "8": -100 },
        "10152.1": { "6": -320, "7": 6600, "8": -110 },
      });
  }

  test("the poll columns every time, the thresholds once", async () => {
    const agent: FakeAgent = juniperAgent();

    const first: TransceiverWalkResult = await collect(agent, {
      sysObjectId: JUNIPER,
    });

    expect(first.source).toBe(TransceiverMibSource.JuniperDom);
    expect(first.results[0]!.measurements.rxPower).toEqual({
      readings: [{ value: -4.73 }],
      thresholds: { lowAlarm: -18.01, lowWarning: -14.4 },
    });
    expect(agent.walksOf(JNX_DOM_CURRENT_TABLE_OID)).toHaveLength(3);
    // A single-lane optic: no lane table.
    expect(agent.walksOf(JNX_DOM_LANE_TABLE_OID)).toHaveLength(0);

    agent.clearRequests();
    const second: TransceiverWalkResult = await collect(agent, {
      sysObjectId: JUNIPER,
      nowMs: 1_000_000 + 60 * 1000,
    });

    // The thresholds came from the cache.
    expect(second.results[0]!.measurements.rxPower?.thresholds).toEqual({
      lowAlarm: -18.01,
      lowWarning: -14.4,
    });
    expect(agent.walksOf(JNX_DOM_CURRENT_TABLE_OID)).toHaveLength(2);
  });

  test("the lane table only when an optic has more than one lane", async () => {
    const agent: FakeAgent = juniperAgent(2);

    const walk: TransceiverWalkResult = await collect(agent, {
      sysObjectId: JUNIPER,
    });

    expect(agent.walksOf(JNX_DOM_LANE_TABLE_OID)).toHaveLength(1);
    expect(walk.results[0]!.measurements.rxPower?.readings).toEqual([
      { value: -3.1, lane: 0 },
      { value: -3.2, lane: 1 },
    ]);
  });

  test("a swapped optic (a new serial in the vendor table) re-reads the static columns", async () => {
    const agent: FakeAgent = new FakeAgent().set(MTXR_OPTICAL_TABLE_OID, {
      "25": {
        "2": text("sfp1"),
        "5": 85000,
        "7": 3302,
        "10": -5673,
        "12": text("F201"),
      },
    });
    const sfp: Array<TransceiverInterfaceCandidate> = [
      { interfaceIndex: 25, names: ["sfp1"] },
    ];

    const read: (nowMs: number) => Promise<TransceiverWalkResult> = (
      nowMs: number,
    ): Promise<TransceiverWalkResult> => {
      return TransceiverWalker.collect({
        sysObjectId: MIKROTIK,
        interfaces: sfp,
        access: agent.access(),
        cacheKey: "router-1",
        nowMs: nowMs,
      });
    };

    await read(1_000_000);
    agent.clearRequests();
    await read(1_060_000);
    // Name column, then the other poll columns: no static columns.
    expect(agent.walksOf(MTXR_OPTICAL_TABLE_OID)).toHaveLength(2);

    agent.tables.get(MTXR_OPTICAL_TABLE_OID)!["25"]!["12"] = text("F999");
    agent.clearRequests();
    const swapped: TransceiverWalkResult = await read(1_120_000);

    expect(agent.walksOf(MTXR_OPTICAL_TABLE_OID)).toHaveLength(3);
    expect(swapped.results[0]!.serialNumber).toBe("F999");
    expect(swapped.results[0]!.wavelengthNm).toBe(850);
  });
});

/*
 * A vendor table with no rows answers like a device without the MIB. Right
 * after it reported optics, though, it means they were pulled - and saying
 * so (no optics, from that source) is what lets the server mark them not
 * detected instead of keeping them as they were.
 */
describe("TransceiverWalker - every optic pulled", () => {
  test("an empty table right after it reported optics: no optics, from that source", async () => {
    const agent: FakeAgent = new FakeAgent().set(JNX_DOM_CURRENT_TABLE_OID, {
      "10152": { "5": -473, "8": 34, "30": 1 },
    });

    expect(
      (await collect(agent, { sysObjectId: JUNIPER })).results,
    ).toHaveLength(1);

    agent.set(JNX_DOM_CURRENT_TABLE_OID, {});

    expect(
      await collect(agent, {
        sysObjectId: JUNIPER,
        nowMs: 1_000_000 + 5 * 60 * 1000,
      }),
    ).toEqual({ results: [], source: TransceiverMibSource.JuniperDom });
  });

  test("an hour after the last optic, an empty table is no MIB again", async () => {
    const agent: FakeAgent = new FakeAgent().set(JNX_DOM_CURRENT_TABLE_OID, {
      "10152": { "5": -473, "8": 34, "30": 1 },
    });

    await collect(agent, { sysObjectId: JUNIPER });
    agent.set(JNX_DOM_CURRENT_TABLE_OID, {});

    expect(
      await collect(agent, {
        sysObjectId: JUNIPER,
        nowMs: 1_000_000 + TRANSCEIVER_STATIC_CACHE_TTL_MS,
      }),
    ).toEqual({ results: [] });
  });

  test("an empty sensor table right after it reported optics: no optics, from that source", async () => {
    const agent: FakeAgent = ciscoAgent();

    await collect(agent);
    agent.set(CISCO_ENT_SENSOR_VALUE_TABLE_OID, {});

    expect(await collect(agent, { nowMs: 1_000_000 + 60 * 1000 })).toEqual({
      results: [],
      source: TransceiverMibSource.CiscoEntitySensor,
    });
  });

  test("another device's optics say nothing about this one", async () => {
    const agent: FakeAgent = new FakeAgent().set(JNX_DOM_CURRENT_TABLE_OID, {
      "10152": { "5": -473, "8": 34, "30": 1 },
    });

    await collect(agent, { sysObjectId: JUNIPER, cacheKey: "device-a" });

    expect(
      await collect(new FakeAgent(), {
        sysObjectId: JUNIPER,
        cacheKey: "device-b",
      }),
    ).toEqual({ results: [] });
  });
});

describe("TransceiverStaticCache", () => {
  test("keeps the most recently used devices", () => {
    const cache: TransceiverStaticCache = new TransceiverStaticCache(2, 1000);
    const statics: Record<string, SnmpTableRows> = { columns: {} };

    for (const key of ["a", "b"]) {
      cache.set({
        key: key,
        source: TransceiverMibSource.JuniperDom,
        signature: "s",
        nowMs: 0,
        statics: statics,
      });
    }

    // Using "a" makes "b" the oldest.
    cache.get({
      key: "a",
      source: TransceiverMibSource.JuniperDom,
      signature: "s",
      nowMs: 1,
    });
    cache.set({
      key: "c",
      source: TransceiverMibSource.JuniperDom,
      signature: "s",
      nowMs: 2,
      statics: statics,
    });

    expect(cache.size).toBe(2);
    expect(
      cache.get({
        key: "b",
        source: TransceiverMibSource.JuniperDom,
        signature: "s",
        nowMs: 3,
      }),
    ).toBeUndefined();
    expect(
      cache.get({
        key: "a",
        source: TransceiverMibSource.JuniperDom,
        signature: "s",
        nowMs: 3,
      }),
    ).toBe(statics);
  });

  test("a different source, signature, an expired entry or a clock gone back is a miss", () => {
    const cache: TransceiverStaticCache = new TransceiverStaticCache(10, 1000);
    cache.set({
      key: "a",
      source: TransceiverMibSource.JuniperDom,
      signature: "s",
      nowMs: 500,
      statics: {},
    });

    for (const probe of [
      { source: TransceiverMibSource.MikroTik, signature: "s", nowMs: 600 },
      { source: TransceiverMibSource.JuniperDom, signature: "t", nowMs: 600 },
      { source: TransceiverMibSource.JuniperDom, signature: "s", nowMs: 1500 },
      { source: TransceiverMibSource.JuniperDom, signature: "s", nowMs: 100 },
    ]) {
      expect(cache.get({ key: "a", ...probe })).toBeUndefined();
    }

    expect(cache.getRecentSource({ key: "a", nowMs: 1499 })).toBe(
      TransceiverMibSource.JuniperDom,
    );
    expect(cache.getRecentSource({ key: "a", nowMs: 1500 })).toBeUndefined();
    expect(
      cache.getRecentSource({ key: undefined, nowMs: 600 }),
    ).toBeUndefined();
  });
});

describe("mergeTableRows", () => {
  test("joins columns read separately into one row per index", () => {
    expect(
      mergeTableRows({ "1": { "1": 8 }, "2": { "1": 4 } }, undefined, {
        "1": { "4": 346 },
      }),
    ).toEqual({ "1": { "1": 8, "4": 346 }, "2": { "1": 4 } });
  });
});

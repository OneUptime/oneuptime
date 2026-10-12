// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpMonitorResponse from "Common/Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import { TransceiverMibSource } from "Common/Types/Monitor/SnmpMonitor/SnmpTransceiver";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";

/*
 * Transceivers read during a device's interface walk, end to end through
 * SnmpMonitor against a fake agent: an ordered map of OID -> varbind that
 * answers GETs, table-column reads and subtree walks the way net-snmp's
 * session does. Only the session factory is replaced; the walk, the walker
 * and the parsers are the production code, and every request the agent
 * answers is counted - the cost of reading optics on every poll is the
 * point of the second half.
 */

interface FakeVarbind {
  oid: string;
  type: number;
  value: unknown;
}

// net-snmp ObjectType values.
const INTEGER: number = 2;
const OCTET_STRING: number = 4;
const OID: number = 6;
const NO_SUCH_INSTANCE: number = 129;

const agent: Map<string, FakeVarbind> = new Map();
const operations: Array<{ kind: string; oid: string; count: number }> = [];
let timeOutUnder: string | undefined = undefined;

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

function under(prefix: string): Array<FakeVarbind> {
  return Array.from(agent.values())
    .filter((varbind: FakeVarbind) => {
      return varbind.oid.startsWith(`${prefix}.`);
    })
    .sort((a: FakeVarbind, b: FakeVarbind) => {
      return compareOids(a.oid, b.oid);
    });
}

function timedOut(oid: string): Error | undefined {
  if (timeOutUnder && oid.startsWith(timeOutUnder)) {
    const error: Error = new Error("Request timed out");
    error.name = "RequestTimedOutError";
    return error;
  }
  return undefined;
}

function buildSession(): Record<string, unknown> {
  return {
    close: jest.fn(),
    on: jest.fn(),
    get: jest.fn(
      (
        oids: Array<string>,
        callback: (error: Error | null, varbinds?: Array<FakeVarbind>) => void,
      ) => {
        operations.push({
          kind: "get",
          oid: oids[0] || "",
          count: oids.length,
        });

        setImmediate(() => {
          const failure: Error | undefined = timedOut(oids[0] || "");
          if (failure) {
            callback(failure);
            return;
          }

          callback(
            null,
            oids.map((oid: string) => {
              return (
                agent.get(oid) || {
                  oid: oid,
                  type: NO_SUCH_INSTANCE,
                  value: null,
                }
              );
            }),
          );
        });
      },
    ),
    tableColumns: jest.fn(
      (
        tableOid: string,
        columns: Array<number>,
        callback: (error: Error | null, table?: unknown) => void,
      ) => {
        operations.push({
          kind: "table",
          oid: tableOid,
          count: columns.length,
        });

        setImmediate(() => {
          const table: Record<string, Record<string, unknown>> = {};

          for (const column of columns) {
            const columnOid: string = `${tableOid}.1.${column}`;

            for (const varbind of under(columnOid)) {
              const rowIndex: string = varbind.oid.substring(
                columnOid.length + 1,
              );
              table[rowIndex] = {
                ...(table[rowIndex] || {}),
                [column.toString()]: varbind.value,
              };
            }
          }

          callback(null, table);
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
        operations.push({ kind: "subtree", oid: baseOid, count: 1 });

        setImmediate(() => {
          const failure: Error | undefined = timedOut(baseOid);
          if (failure) {
            doneCb(failure);
            return;
          }

          const inSubtree: Array<FakeVarbind> = under(baseOid);

          for (let i: number = 0; i < inSubtree.length; i += 10) {
            if (feedCb(inSubtree.slice(i, i + 10))) {
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
      return buildSession();
    }),
    createV3Session: jest.fn(() => {
      return buildSession();
    }),
  };
});

import SnmpMonitor, {
  SnmpWalkResult,
} from "../../../../Utils/Monitors/MonitorTypes/SnmpMonitor";
import TransceiverWalker from "../../../../Utils/Snmp/TransceiverWalker";

function put(oid: string, type: number, value: unknown): void {
  agent.set(oid, { oid: oid, type: type, value: value });
}

function putText(oid: string, value: string): void {
  put(oid, OCTET_STRING, Buffer.from(value, "latin1"));
}

const ENT: string = "1.3.6.1.2.1.47.1.1.1.1";
const SENSOR: string = "1.3.6.1.4.1.9.9.91.1.1.1.1";
const THRESHOLD: string = "1.3.6.1.4.1.9.9.91.1.2.1.1";

// A Catalyst 2960-X with a 1000BASE-SX SFP in Gi1/0/52.
function catalyst(): void {
  putText("1.3.6.1.2.1.1.1.0", "Cisco IOS Software, C2960X Software");
  put("1.3.6.1.2.1.1.2.0", OID, "1.3.6.1.4.1.9.1.1208");
  putText("1.3.6.1.2.1.1.5.0", "access-1");

  // IF-MIB: ifDescr, ifAdminStatus, ifOperStatus; ifXTable ifName.
  for (const [index, descr, name] of [
    [10151, "GigabitEthernet1/0/51", "Gi1/0/51"],
    [10152, "GigabitEthernet1/0/52", "Gi1/0/52"],
  ] as Array<[number, string, string]>) {
    put(`1.3.6.1.2.1.2.2.1.1.${index}`, INTEGER, index);
    putText(`1.3.6.1.2.1.2.2.1.2.${index}`, descr);
    put(`1.3.6.1.2.1.2.2.1.7.${index}`, INTEGER, 1);
    put(`1.3.6.1.2.1.2.2.1.8.${index}`, INTEGER, 1);
    putText(`1.3.6.1.2.1.31.1.1.1.1.${index}`, name);
  }

  // entPhysicalTable.
  put(`${ENT}.5.1001`, INTEGER, 3);
  putText(`${ENT}.2.1001`, "WS-C2960X-48FPS-L");
  putText(`${ENT}.11.1001`, "FCW1929B68S");
  putText(`${ENT}.13.1001`, "WS-C2960X-48FPS-L");
  put(`${ENT}.4.1001`, INTEGER, 1);

  putText(`${ENT}.2.1062`, "1000BaseSX SFP");
  put(`${ENT}.4.1062`, INTEGER, 1061);
  put(`${ENT}.5.1062`, INTEGER, 10);
  putText(`${ENT}.7.1062`, "GigabitEthernet1/0/52");
  putText(`${ENT}.11.1062`, "FNS192717K1");
  putText(`${ENT}.13.1062`, "GLC-SX-MMD");

  for (const [index, label] of [
    [1063, "Module Temperature Sensor"],
    [1067, "Receive Power Sensor"],
  ] as Array<[number, string]>) {
    putText(`${ENT}.2.${index}`, `GigabitEthernet1/0/52 ${label}`);
    put(`${ENT}.4.${index}`, INTEGER, 1062);
    put(`${ENT}.5.${index}`, INTEGER, 8);
  }

  // entSensorValueTable: type, scale, precision, value, status.
  for (const [index, type, precision, value] of [
    [1063, 8, 1, 346],
    [1067, 14, 1, -47],
    // A fan, which is no optic: never read beyond its type.
    [2001, 10, 0, 9000],
  ] as Array<[number, number, number, number]>) {
    put(`${SENSOR}.1.${index}`, INTEGER, type);
    put(`${SENSOR}.2.${index}`, INTEGER, 9);
    put(`${SENSOR}.3.${index}`, INTEGER, precision);
    put(`${SENSOR}.4.${index}`, INTEGER, value);
    put(`${SENSOR}.5.${index}`, INTEGER, 1);
  }

  // entSensorThresholdTable: RX power low warning and alarm.
  put(`${THRESHOLD}.2.1067.1`, INTEGER, 10);
  put(`${THRESHOLD}.3.1067.1`, INTEGER, 2);
  put(`${THRESHOLD}.4.1067.1`, INTEGER, -170);
  put(`${THRESHOLD}.2.1067.2`, INTEGER, 20);
  put(`${THRESHOLD}.3.1067.2`, INTEGER, 2);
  put(`${THRESHOLD}.4.1067.2`, INTEGER, -181);

  // entAliasMappingTable: the optic's port is ifIndex 10152.
  put("1.3.6.1.2.1.47.1.3.2.1.2.1062.0", OID, "1.3.6.1.2.1.2.2.1.1.10152");
}

const CONFIG: MonitorStepSnmpMonitor = {
  snmpVersion: SnmpVersion.V2c,
  hostname: "10.0.0.5",
  port: 161,
  communityString: "public",
  oids: [],
  timeout: 1000,
  retries: 0,
  monitorInterfaces: true,
};

function transceiverOperations(): Array<{ kind: string; oid: string }> {
  return operations.filter((operation: { oid: string }) => {
    return (
      operation.oid.startsWith("1.3.6.1.4.1.9.9.91") ||
      operation.oid.startsWith("1.3.6.1.2.1.47.1.3.2") ||
      (operation.oid.startsWith("1.3.6.1.2.1.47.1.1.1") &&
        operation.oid !== "1.3.6.1.2.1.47.1.1.1")
    );
  });
}

beforeEach(() => {
  agent.clear();
  operations.length = 0;
  timeOutUnder = undefined;
  TransceiverWalker.cache.clear();
  catalyst();
});

afterEach(() => {
  TransceiverWalker.cache.clear();
});

describe("SnmpMonitor - transceivers during the interface walk", () => {
  test("reads the optic, matched to its port, with the device's thresholds", async () => {
    const walk: SnmpWalkResult = await SnmpMonitor.walkInterfaces(CONFIG, {
      collectTransceivers: true,
      transceiverCacheKey: "device-1@10.0.0.5",
    });

    expect(walk.interfaces).toHaveLength(2);
    expect(walk.transceiverSource).toBe(TransceiverMibSource.CiscoEntitySensor);
    expect(walk.transceiverWalkFailure).toBeUndefined();
    expect(walk.transceiverResults).toEqual([
      {
        interfaceIndex: 10152,
        partNumber: "GLC-SX-MMD",
        serialNumber: "FNS192717K1",
        type: "1000BaseSX SFP",
        measurements: {
          temperature: { readings: [{ value: 34.6 }] },
          rxPower: {
            readings: [{ value: -4.7 }],
            thresholds: { lowAlarm: -18.1, lowWarning: -17 },
          },
        },
        source: TransceiverMibSource.CiscoEntitySensor,
      },
    ]);
    // The chassis identity still comes from the same entity rows.
    expect(walk.entityInfo?.serialNumber).toBe("FCW1929B68S");
  });

  test("not asked, not read: no transceiver request at all", async () => {
    const walk: SnmpWalkResult = await SnmpMonitor.walkInterfaces(CONFIG, {});

    expect(walk.transceiverResults).toBeUndefined();
    expect(walk.transceiverSource).toBeUndefined();
    expect(transceiverOperations()).toEqual([]);
  });

  test("every later poll costs one column walk and one GET", async () => {
    const options: {
      collectTransceivers: boolean;
      transceiverCacheKey: string;
    } = {
      collectTransceivers: true,
      transceiverCacheKey: "device-1@10.0.0.5",
    };

    await SnmpMonitor.walkInterfaces(CONFIG, options);
    const firstPoll: number = transceiverOperations().length;
    operations.length = 0;

    // The light dropped between polls.
    put(`${SENSOR}.4.1067`, INTEGER, -92);

    const walk: SnmpWalkResult = await SnmpMonitor.walkInterfaces(
      CONFIG,
      options,
    );

    expect(walk.transceiverResults![0]!.measurements.rxPower?.readings).toEqual(
      [{ value: -9.2 }],
    );
    expect(
      transceiverOperations().map(
        (operation: { kind: string; oid: string }) => {
          return `${operation.kind} ${operation.oid}`;
        },
      ),
    ).toEqual([`subtree ${SENSOR}.1`, `get ${SENSOR}.4.1063`]);
    expect(firstPoll).toBeGreaterThan(2);
  });

  test("a read that times out is reported as failed, and the rest of the walk stands", async () => {
    timeOutUnder = SENSOR;

    const walk: SnmpWalkResult = await SnmpMonitor.walkInterfaces(CONFIG, {
      collectTransceivers: true,
    });

    expect(walk.transceiverResults).toBeUndefined();
    expect(walk.transceiverWalkFailure).toBe("Request timed out");
    expect(walk.interfaces).toHaveLength(2);
  });

  test("the poll's response carries the optics, the MIB and any failure to the server", async () => {
    const response: SnmpMonitorResponse | null = await SnmpMonitor.query(
      CONFIG,
      { collectTransceivers: true, transceiverCacheKey: "device-1@10.0.0.5" },
    );

    expect(response?.transceiverSource).toBe(
      TransceiverMibSource.CiscoEntitySensor,
    );
    expect(response?.transceiverResults?.[0]?.interfaceIndex).toBe(10152);
    expect(response).not.toHaveProperty("transceiverWalkFailure");
  });
});

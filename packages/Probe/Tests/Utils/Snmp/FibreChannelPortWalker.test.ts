import { describe, expect, test } from "@jest/globals";
import { FibreChannelCounter } from "Common/Types/Monitor/SnmpMonitor/SnmpFibreChannel";
import { SnmpTableRows } from "../../../Utils/Snmp/EndpointTableParsers";
import {
  CISCO_FC_IF_ERROR_TABLE_OID,
  CISCO_FC_IF_TABLE_OID,
  CONN_UNIT_PORT_STAT_TABLE_OID,
  SW_FC_PORT_TABLE_OID,
} from "../../../Utils/Snmp/FibreChannelParsers";
import FibreChannelPortWalker, {
  FibreChannelSource,
  FibreChannelWalkInput,
  FibreChannelWalkResult,
  MAX_FIBRE_CHANNEL_PORT_ROWS,
} from "../../../Utils/Snmp/FibreChannelPortWalker";
import { TransceiverSnmpAccess } from "../../../Utils/Snmp/TransceiverWalker";

/*
 * Which MIB a switch's Fibre Channel ports are read from, how few requests
 * a device without them costs, and what a walk that goes wrong does. The
 * SNMP side is a fake that answers per table and records what was asked.
 */

interface FakeAccess {
  access: TransceiverSnmpAccess;
  walked: Array<string>;
}

function fakeAccess(tables: Record<string, SnmpTableRows | Error>): FakeAccess {
  const walked: Array<string> = [];

  return {
    walked: walked,
    access: {
      walkColumns: async (tableOid: string): Promise<SnmpTableRows> => {
        walked.push(tableOid);
        const answer: SnmpTableRows | Error | undefined = tables[tableOid];

        if (answer instanceof Error) {
          throw answer;
        }

        return answer || {};
      },
      getCells: async (): Promise<SnmpTableRows> => {
        return {};
      },
    },
  };
}

const BROCADE: string = "1.3.6.1.4.1.1588.2.1.1.1";
const MDS: string = "1.3.6.1.4.1.9.12.3.1.3.1660";

const FC_PORTS: FibreChannelWalkInput["interfaces"] = [
  { interfaceIndex: 1, names: ["eth0"], interfaceType: 6 },
  { interfaceIndex: 0x40000000, names: ["0/0"], interfaceType: 56 },
];

const MDS_PORTS: FibreChannelWalkInput["interfaces"] = [
  { interfaceIndex: 0x1000000, names: ["fc1/1"], interfaceType: 56 },
  { interfaceIndex: 0x5000000, names: ["mgmt0"], interfaceType: 6 },
];

describe("getSource", () => {
  test.each([
    [BROCADE, FibreChannelSource.Brocade],
    ["1.3.6.1.4.1.1588.2.1.1.1.0", FibreChannelSource.Brocade],
    [".1.3.6.1.4.1.1588.2.1.1.1", FibreChannelSource.Brocade],
    [MDS, FibreChannelSource.Cisco],
    ["1.3.6.1.4.1.9.1.1208", FibreChannelSource.Cisco],
  ])("%s reads from %s", (sysObjectId: string, source: FibreChannelSource) => {
    expect(FibreChannelPortWalker.getSource(sysObjectId)).toBe(source);
  });

  test.each([
    undefined,
    "",
    // Brocade Network OS (VDX) and other 1588 arcs speak no SW-MIB ports.
    "1.3.6.1.4.1.1588.2.2.1.1.1.5",
    "1.3.6.1.4.1.1588.3.3.1.131",
    "1.3.6.1.4.1.15880.1",
    "1.3.6.1.4.1.90.1",
    "1.3.6.1.4.1.2636.1.1.1.2.29",
  ])("%s reads from nowhere", (sysObjectId: string | undefined) => {
    expect(FibreChannelPortWalker.getSource(sysObjectId)).toBeUndefined();
  });
});

describe("collect", () => {
  test("a device with no Fibre Channel interface costs no request at all", async () => {
    const fake: FakeAccess = fakeAccess({});
    const result: FibreChannelWalkResult = await FibreChannelPortWalker.collect(
      {
        sysObjectId: MDS,
        interfaces: [MDS_PORTS[1]!],
        access: fake.access,
      },
    );

    expect(result.ports.size).toBe(0);
    expect(result.source).toBeUndefined();
    expect(fake.walked).toEqual([]);
  });

  test("a maker with no Fibre Channel MIB costs none either", async () => {
    const fake: FakeAccess = fakeAccess({});
    const result: FibreChannelWalkResult = await FibreChannelPortWalker.collect(
      {
        sysObjectId: "1.3.6.1.4.1.2636.1.1.1.2.29",
        interfaces: FC_PORTS,
        access: fake.access,
      },
    );

    expect(result.ports.size).toBe(0);
    expect(fake.walked).toEqual([]);
  });

  test("Brocade: swFCPortTable, then FCMGMT's counters", async () => {
    const fake: FakeAccess = fakeAccess({
      [SW_FC_PORT_TABLE_OID]: {
        "1": { "4": 1, "37": Buffer.from("0"), "39": 4, "22": 5 },
      },
      [CONN_UNIT_PORT_STAT_TABLE_OID]: {
        "16.0.196.245.124.74.27.32.0.0.0.0.0.0.0.0.1": {
          "40": Buffer.from("000000000000000c", "hex"),
        },
      },
    });

    const result: FibreChannelWalkResult = await FibreChannelPortWalker.collect(
      { sysObjectId: BROCADE, interfaces: FC_PORTS, access: fake.access },
    );

    expect(result.source).toBe(FibreChannelSource.Brocade);
    expect(fake.walked).toEqual([
      SW_FC_PORT_TABLE_OID,
      CONN_UNIT_PORT_STAT_TABLE_OID,
    ]);
    expect(
      result.ports.get(0x40000000)?.counters?.[FibreChannelCounter.CrcErrors],
    ).toBe(12);
  });

  test("Brocade with no swFCPortTable stops there, one request in", async () => {
    const fake: FakeAccess = fakeAccess({});
    const result: FibreChannelWalkResult = await FibreChannelPortWalker.collect(
      { sysObjectId: BROCADE, interfaces: FC_PORTS, access: fake.access },
    );

    expect(result.ports.size).toBe(0);
    expect(fake.walked).toEqual([SW_FC_PORT_TABLE_OID]);
  });

  test("Brocade with the FA-MIB off: FCMGMT's refusal is no failure, SW-MIB's counters stand in", async () => {
    const fake: FakeAccess = fakeAccess({
      [SW_FC_PORT_TABLE_OID]: {
        "1": { "4": 1, "37": Buffer.from("0"), "22": 5 },
      },
      [CONN_UNIT_PORT_STAT_TABLE_OID]: new Error("noSuchName"),
    });

    const result: FibreChannelWalkResult = await FibreChannelPortWalker.collect(
      { sysObjectId: BROCADE, interfaces: FC_PORTS, access: fake.access },
    );

    expect(
      result.ports.get(0x40000000)?.counters?.[FibreChannelCounter.CrcErrors],
    ).toBe(5);
  });

  test("Brocade whose FCMGMT walk runs out of time: the read fails, rather than half-answering", async () => {
    const timedOut: Error = new Error("Request timed out");
    timedOut.name = "RequestTimedOutError";

    const fake: FakeAccess = fakeAccess({
      [SW_FC_PORT_TABLE_OID]: {
        "1": { "4": 1, "37": Buffer.from("0"), "22": 5 },
      },
      [CONN_UNIT_PORT_STAT_TABLE_OID]: timedOut,
    });

    await expect(
      FibreChannelPortWalker.collect({
        sysObjectId: BROCADE,
        interfaces: FC_PORTS,
        access: fake.access,
      }),
    ).rejects.toThrow("Request timed out");
  });

  test("Cisco: the error table first, and fcIfTable only where it answered", async () => {
    const fake: FakeAccess = fakeAccess({
      [CISCO_FC_IF_ERROR_TABLE_OID]: { "16777216": { "6": 3 } },
      [CISCO_FC_IF_TABLE_OID]: { "16777216": { "3": 2, "7": 2 } },
    });

    const result: FibreChannelWalkResult = await FibreChannelPortWalker.collect(
      { sysObjectId: MDS, interfaces: MDS_PORTS, access: fake.access },
    );

    expect(result.source).toBe(FibreChannelSource.Cisco);
    expect(fake.walked).toEqual([
      CISCO_FC_IF_ERROR_TABLE_OID,
      CISCO_FC_IF_TABLE_OID,
    ]);
    expect(
      result.ports.get(0x1000000)?.counters?.[FibreChannelCounter.CrcErrors],
    ).toBe(3);
  });

  test("a Cisco device with no CISCO-FC-FE-MIB (a Nexus with an FC port) stops one request in", async () => {
    const fake: FakeAccess = fakeAccess({});
    const result: FibreChannelWalkResult = await FibreChannelPortWalker.collect(
      { sysObjectId: MDS, interfaces: MDS_PORTS, access: fake.access },
    );

    expect(result.ports.size).toBe(0);
    expect(fake.walked).toEqual([CISCO_FC_IF_ERROR_TABLE_OID]);
  });

  test("a table past the row cap is refused whole, with a reason a person can read", async () => {
    const rows: SnmpTableRows = {};

    for (let index: number = 1; index <= MAX_FIBRE_CHANNEL_PORT_ROWS; index++) {
      rows[index.toString()] = { "6": 0 };
    }

    const fake: FakeAccess = fakeAccess({
      [CISCO_FC_IF_ERROR_TABLE_OID]: rows,
    });

    await expect(
      FibreChannelPortWalker.collect({
        sysObjectId: MDS,
        interfaces: MDS_PORTS,
        access: fake.access,
      }),
    ).rejects.toThrow(`more than ${MAX_FIBRE_CHANNEL_PORT_ROWS} rows`);
  });
});

describe("isTimeout", () => {
  test.each([
    ["RequestTimedOutError", "whatever", true],
    ["Error", "Request timed out", true],
    ["Error", "SNMP time budget exhausted", true],
    ["Error", "deadline passed", true],
    ["Error", "noSuchName", false],
    ["Error", "", false],
  ])("%s: %s", (name: string, message: string, isTimeout: boolean) => {
    const error: Error = new Error(message);
    error.name = name;
    expect(FibreChannelPortWalker.isTimeout(error)).toBe(isTimeout);
  });

  test("not an error at all", () => {
    expect(FibreChannelPortWalker.isTimeout(undefined)).toBe(false);
  });
});

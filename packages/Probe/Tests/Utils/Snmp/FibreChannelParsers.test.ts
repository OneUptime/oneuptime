import { describe, expect, test } from "@jest/globals";
import {
  FibreChannelCounter,
  FibreChannelPortType,
  SnmpFibreChannelPort,
} from "Common/Types/Monitor/SnmpMonitor/SnmpFibreChannel";
import { SnmpTableRows } from "../../../Utils/Snmp/EndpointTableParsers";
import {
  BROCADE_FC_PORT_IF_INDEX_OFFSET,
  FibreChannelInterfaceCandidate,
  brocadeDownReason,
  brocadePortKey,
  ciscoDownReason,
  mapBrocadePortsToInterfaces,
  parseBrocadeFibreChannelPorts,
  parseCiscoFibreChannelPorts,
  rowsOfMainConnUnit,
  splitConnUnitPortIndex,
} from "../../../Utils/Snmp/FibreChannelParsers";

/*
 * Each SAN switch's Fibre Channel ports, read from its maker's MIB and
 * joined to the IF-MIB interface they belong to. Rows are in net-snmp's
 * shape (column numbers as string keys; text as Buffers), with the MIBs'
 * own column numbers:
 *
 *   SW-MIB swFCPortTable: 3 phyState, 4 opStatus, 5 admStatus, 6 linkState,
 *     20 noTxCredits, 22 rxCrcs, 26 rxEncOutFrs, 28 c3Discards,
 *     37 specifier, 39 brcdType.
 *   FCMGMT-MIB connUnitPortStatTable: 8 BB credit zero, 28 class 3
 *     discards, 39 link failures, 40 invalid CRC, 41 invalid transmission
 *     words, 43 loss of signal, 44 loss of sync - 8-byte OCTET STRINGs.
 *   CISCO-FC-FE-MIB fcIfTable: 3 operMode, 7 operStatusCause, 8 its text;
 *     fcIfErrorTable: 1 link failures, 2 sync losses, 3 signal losses,
 *     5 invalid tx words, 6 invalid CRCs, 26 discards, 28 BB credit zero,
 *     35 timeout discards, 37 credit loss, 40 BB credit zero (64-bit).
 */

function text(value: string): Buffer {
  return Buffer.from(value, "latin1");
}

// An FCMGMT counter: eight bytes, big-endian.
function octets(value: number): Buffer {
  const buffer: Buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(value));
  return buffer;
}

function table(rows: Record<string, Record<number, unknown>>): SnmpTableRows {
  const result: SnmpTableRows = {};

  for (const rowIndex of Object.keys(rows)) {
    const row: Record<string, unknown> = {};

    for (const [columnNumber, value] of Object.entries(rows[rowIndex]!)) {
      row[columnNumber] = value;
    }

    result[rowIndex] = row;
  }

  return result;
}

function candidates(
  list: Array<[number, ...Array<string | undefined>]>,
): Array<FibreChannelInterfaceCandidate> {
  return list.map(
    ([interfaceIndex, ...names]: [number, ...Array<string | undefined>]) => {
      return { interfaceIndex: interfaceIndex, names: names };
    },
  );
}

// connUnitId: a WWN and eight zeros, as sixteen arcs.
const UNIT_A: string = "16.0.196.245.124.74.27.32.0.0.0.0.0.0.0.0";
const UNIT_B: string = "16.0.196.245.124.74.27.52.0.0.0.0.0.0.0.0";

// An online F-Port: inSync(6), online(1), online(1), enabled(1), f-port(4).
function onlinePort(
  specifier: string,
  extra: Record<number, unknown> = {},
): Record<number, unknown> {
  return { 3: 6, 4: 1, 5: 1, 6: 1, 37: text(specifier), 39: 4, ...extra };
}

describe("brocadePortKey", () => {
  test.each([
    ["FC port 3/15", "3/15"],
    ["fc port 3/15", "3/15"],
    ["3/15", "3/15"],
    ["FC port 0/0", "0/0"],
    ["03/007", "3/7"],
    // A fixed switch's specifier has no slot: its only slot is 0.
    ["15", "0/15"],
    ["FC port 15", "0/15"],
    ["  0/9  ", "0/9"],
  ])("%s is %s", (name: string, key: string) => {
    expect(brocadePortKey(name)).toBe(key);
  });

  test.each([undefined, "", "eth0", "Port0", "ge0/1", "1/2/3", "slot 1"])(
    "%s names no port",
    (name: string | undefined) => {
      expect(brocadePortKey(name)).toBeUndefined();
    },
  );
});

describe("splitConnUnitPortIndex", () => {
  test("the last arc is the port index, the rest the connUnitId", () => {
    expect(splitConnUnitPortIndex(`${UNIT_A}.12`)).toEqual({
      unit: UNIT_A,
      portIndex: "12",
    });
  });

  test.each(["", "12", `${UNIT_A}.0`, `${UNIT_A}.x`, `${UNIT_A}.`])(
    "%s is no port row",
    (index: string) => {
      expect(splitConnUnitPortIndex(index)).toBeUndefined();
    },
  );
});

describe("rowsOfMainConnUnit", () => {
  test("keys the rows by port index", () => {
    expect(
      rowsOfMainConnUnit(
        table({
          [`${UNIT_A}.1`]: { 40: octets(3) },
          [`${UNIT_A}.2`]: { 40: octets(4) },
        }),
      ),
    ).toEqual(
      table({
        "1": { 40: octets(3) },
        "2": { 40: octets(4) },
      }),
    );
  });

  test("of two units, keeps the one with more rows: one switch's port never overwrites another's", () => {
    const rows: SnmpTableRows = rowsOfMainConnUnit(
      table({
        [`${UNIT_B}.1`]: { 40: octets(900) },
        [`${UNIT_A}.1`]: { 40: octets(1) },
        [`${UNIT_A}.2`]: { 40: octets(2) },
      }),
    );

    expect(Object.keys(rows).sort()).toEqual(["1", "2"]);
    expect(rows["1"]?.["40"]).toEqual(octets(1));
  });

  test("two units of the same size: the same one every poll", () => {
    const one: SnmpTableRows = rowsOfMainConnUnit(
      table({
        [`${UNIT_B}.1`]: { 40: octets(900) },
        [`${UNIT_A}.1`]: { 40: octets(1) },
      }),
    );
    const other: SnmpTableRows = rowsOfMainConnUnit(
      table({
        [`${UNIT_A}.1`]: { 40: octets(1) },
        [`${UNIT_B}.1`]: { 40: octets(900) },
      }),
    );

    expect(one).toEqual(other);
  });

  test("rows that are no port rows are left out", () => {
    expect(rowsOfMainConnUnit(table({ "7": { 40: octets(1) } }))).toEqual({});
  });
});

describe("mapBrocadePortsToInterfaces", () => {
  test("by name: the specifier against 'FC port s/p' or 's/p'", () => {
    const mapped: Map<string, number> = mapBrocadePortsToInterfaces({
      portRows: table({
        "1": onlinePort("0"),
        "2": onlinePort("1"),
      }),
      interfaces: candidates([
        [900, "0/0", "FC port 0/0"],
        [901, undefined, "FC port 0/1"],
      ]),
    });

    expect(Array.from(mapped.entries())).toEqual([
      ["1", 900],
      ["2", 901],
    ]);
  });

  test("by Fabric OS's ifIndex numbering only where no name matched", () => {
    const mapped: Map<string, number> = mapBrocadePortsToInterfaces({
      // No specifier: Fabric OS before 7.0.
      portRows: table({ "1": { 4: 1 }, "2": { 4: 1 } }),
      interfaces: candidates([
        [BROCADE_FC_PORT_IF_INDEX_OFFSET + 1, "Port0"],
        [BROCADE_FC_PORT_IF_INDEX_OFFSET + 2, "Port1"],
      ]),
    });

    expect(mapped.get("1")).toBe(0x40000000);
    expect(mapped.get("2")).toBe(0x40000001);
  });

  test("never by numbering to an interface the device does not have", () => {
    const mapped: Map<string, number> = mapBrocadePortsToInterfaces({
      portRows: table({ "1": { 4: 1 } }),
      interfaces: candidates([[5, "eth0"]]),
    });

    expect(mapped.size).toBe(0);
  });

  test("a logical switch that numbers its ports from 1: the name wins over the arithmetic", () => {
    // Port index 1 is port 0/8; the arithmetic would say ifIndex ...824.
    const mapped: Map<string, number> = mapBrocadePortsToInterfaces({
      portRows: table({
        "1": onlinePort("8"),
        "2": onlinePort("9"),
      }),
      interfaces: candidates([
        [0x40000000, "0/0"],
        [0x40000008, "0/8"],
        [0x40000009, "0/9"],
      ]),
    });

    expect(mapped.get("1")).toBe(0x40000008);
    expect(mapped.get("2")).toBe(0x40000009);
  });

  test("an interface is claimed once: the numbering never takes one a name took", () => {
    const mapped: Map<string, number> = mapBrocadePortsToInterfaces({
      portRows: table({
        // Port index 1 has no specifier; port index 2's names ...824.
        "1": { 4: 1 },
        "2": onlinePort("0"),
      }),
      interfaces: candidates([[0x40000000, "0/0"]]),
    });

    expect(mapped.get("2")).toBe(0x40000000);
    expect(mapped.has("1")).toBe(false);
  });

  test("two ports naming the same interface: the first keeps it", () => {
    const mapped: Map<string, number> = mapBrocadePortsToInterfaces({
      portRows: table({
        "1": onlinePort("4"),
        "2": onlinePort("4"),
      }),
      interfaces: candidates([[0x40000004, "0/4"]]),
    });

    expect(mapped.get("1")).toBe(0x40000004);
    expect(mapped.has("2")).toBe(false);
  });

  test("rows whose index is no port index are skipped", () => {
    const mapped: Map<string, number> = mapBrocadePortsToInterfaces({
      portRows: table({ "0": onlinePort("0"), x: onlinePort("1") }),
      interfaces: candidates([
        [0x40000000, "0/0"],
        [0x40000001, "0/1"],
      ]),
    });

    expect(mapped.size).toBe(0);
  });
});

describe("brocadeDownReason", () => {
  test("an online port has none", () => {
    expect(brocadeDownReason({ 3: 6, 4: 1 })).toBeUndefined();
  });

  test("a port with no state reported has none", () => {
    expect(brocadeDownReason({})).toBeUndefined();
  });

  test.each([
    [1, "No card"],
    [2, "No module"],
    [3, "Laser fault"],
    [4, "No light"],
    [5, "No sync"],
    [7, "Port fault"],
    [8, "Diagnostics fault"],
    [9, "Locking to reference"],
    [10, "Validating"],
    [11, "Invalid module"],
    [14, "No signal detected"],
  ])("physical state %s reads %s", (phyState: number, reason: string) => {
    expect(brocadeDownReason({ 3: phyState, 4: 2, 5: 1, 6: 1 })).toBe(reason);
  });

  test("disabled by an admin says Disabled, whatever the light", () => {
    expect(brocadeDownReason({ 3: 4, 4: 2, 5: 2, 6: 1 })).toBe("Disabled");
    expect(brocadeDownReason({ 3: 2, 4: 2, 5: 1, 6: 2 })).toBe("Disabled");
  });

  test("a physical state that says nothing more falls back to the operational state", () => {
    // inSync(6) but faulty(4).
    expect(brocadeDownReason({ 3: 6, 4: 4, 5: 1, 6: 1 })).toBe("Faulty");
    expect(brocadeDownReason({ 4: 3 })).toBe("Testing");
    expect(brocadeDownReason({ 3: 255, 4: 2 })).toBe("Offline");
  });
});

describe("parseBrocadeFibreChannelPorts", () => {
  const interfaces: Array<FibreChannelInterfaceCandidate> = candidates([
    [0x40000000, "0/0", "FC port 0/0"],
    [0x40000001, "0/1", "FC port 0/1"],
    [0x40000002, "0/2", "FC port 0/2"],
  ]);

  test("FCMGMT's 64-bit counters, preferred, with the type and down reason from SW-MIB", () => {
    const ports: Map<number, SnmpFibreChannelPort> =
      parseBrocadeFibreChannelPorts({
        portRows: table({
          "1": onlinePort("0", { 22: 999, 39: 5 }),
          "2": { 3: 4, 4: 2, 5: 1, 6: 1, 37: text("1"), 39: 1 },
        }),
        statRows: table({
          [`${UNIT_A}.1`]: {
            8: octets(2211904),
            28: octets(7),
            39: octets(1),
            40: octets(12),
            41: octets(30),
            43: octets(2),
            44: octets(3),
          },
          [`${UNIT_A}.2`]: { 40: octets(0) },
        }),
        interfaces: interfaces,
      });

    expect(ports.get(0x40000000)).toEqual({
      portType: FibreChannelPortType.E,
      counters: {
        [FibreChannelCounter.CrcErrors]: 12,
        [FibreChannelCounter.InvalidTransmissionWords]: 30,
        [FibreChannelCounter.LinkFailures]: 1,
        [FibreChannelCounter.LossOfSync]: 3,
        [FibreChannelCounter.LossOfSignal]: 2,
        [FibreChannelCounter.Discards]: 7,
        [FibreChannelCounter.BbCreditZero]: 2211904,
      },
    });

    // unknown(1) is no type; noLight(4) is why it is down.
    expect(ports.get(0x40000001)).toEqual({
      downReason: "No light",
      counters: { [FibreChannelCounter.CrcErrors]: 0 },
    });
  });

  test("with the FA-MIB off, SW-MIB's Counter32s stand in, and say nothing of link failures or losses", () => {
    const ports: Map<number, SnmpFibreChannelPort> =
      parseBrocadeFibreChannelPorts({
        portRows: table({
          "3": onlinePort("2", { 20: 400, 22: 5, 26: 9, 28: 2 }),
        }),
        interfaces: interfaces,
      });

    expect(ports.get(0x40000002)?.counters).toEqual({
      [FibreChannelCounter.CrcErrors]: 5,
      [FibreChannelCounter.InvalidTransmissionWords]: 9,
      [FibreChannelCounter.Discards]: 2,
      [FibreChannelCounter.BbCreditZero]: 400,
    });
  });

  test("a port FCMGMT has no row for falls back on its own, beside ports it has", () => {
    const ports: Map<number, SnmpFibreChannelPort> =
      parseBrocadeFibreChannelPorts({
        portRows: table({
          "1": onlinePort("0", { 22: 999 }),
          "2": onlinePort("1", { 22: 5 }),
        }),
        statRows: table({ [`${UNIT_A}.1`]: { 40: octets(12) } }),
        interfaces: interfaces,
      });

    expect(
      ports.get(0x40000000)?.counters?.[FibreChannelCounter.CrcErrors],
    ).toBe(12);
    expect(
      ports.get(0x40000001)?.counters?.[FibreChannelCounter.CrcErrors],
    ).toBe(5);
  });

  test("an FCMGMT counter in any shape the probe may hand it: bytes, a number, separated hex", () => {
    const ports: Map<number, SnmpFibreChannelPort> =
      parseBrocadeFibreChannelPorts({
        portRows: table({ "1": onlinePort("0") }),
        statRows: table({
          [`${UNIT_A}.1`]: {
            39: 4,
            40: "00 00 00 00 00 00 01 00",
            41: octets(0),
          },
        }),
        interfaces: interfaces,
      });

    expect(ports.get(0x40000000)?.counters).toEqual({
      [FibreChannelCounter.CrcErrors]: 256,
      [FibreChannelCounter.InvalidTransmissionWords]: 0,
      [FibreChannelCounter.LinkFailures]: 4,
    });
  });

  test("a port joined to no interface is left out", () => {
    const ports: Map<number, SnmpFibreChannelPort> =
      parseBrocadeFibreChannelPorts({
        portRows: table({ "40": onlinePort("39") }),
        interfaces: interfaces,
      });

    expect(ports.size).toBe(0);
  });

  test("a port that reports nothing at all is left out", () => {
    const ports: Map<number, SnmpFibreChannelPort> =
      parseBrocadeFibreChannelPorts({
        portRows: table({ "1": { 37: text("0") } }),
        interfaces: interfaces,
      });

    expect(ports.size).toBe(0);
  });

  test.each([
    [2, FibreChannelPortType.Other],
    [3, FibreChannelPortType.FL],
    [4, FibreChannelPortType.F],
    [5, FibreChannelPortType.E],
    [6, FibreChannelPortType.G],
    [7, FibreChannelPortType.EX],
    [8, FibreChannelPortType.D],
  ])(
    "swFCPortBrcdType %s is %s",
    (brcdType: number, portType: FibreChannelPortType) => {
      expect(
        parseBrocadeFibreChannelPorts({
          portRows: table({ "1": onlinePort("0", { 39: brcdType }) }),
          interfaces: interfaces,
        }).get(0x40000000)?.portType,
      ).toBe(portType);
    },
  );
});

describe("ciscoDownReason", () => {
  test("the switch's own words first", () => {
    expect(
      ciscoDownReason({ 7: 7, 8: text("Link failure or not-connected") }),
    ).toBe("Link failure or not-connected");
  });

  test("none(2) is an interface that is not down", () => {
    expect(ciscoDownReason({ 7: 2, 8: text("none") })).toBeUndefined();
    expect(ciscoDownReason({})).toBeUndefined();
  });

  test("an empty or 'none' description falls back to the cause's name", () => {
    expect(ciscoDownReason({ 7: 29, 8: text("") })).toBe("SFP not present");
    expect(ciscoDownReason({ 7: 12, 8: text("none") })).toBe(
      "Administratively down",
    );
    expect(ciscoDownReason({ 7: 11 })).toBe("VSAN inactive");
  });

  test("a cause with no name and no words says nothing rather than guess", () => {
    expect(ciscoDownReason({ 7: 999 })).toBeUndefined();
  });
});

describe("parseCiscoFibreChannelPorts", () => {
  const FC1_1: number = 0x1000000;
  const FC1_2: number = 0x1001000;
  const MGMT0: number = 0x5000000;

  const interfaces: Array<FibreChannelInterfaceCandidate> = candidates([
    [FC1_1, "fc1/1"],
    [FC1_2, "fc1/2"],
    [MGMT0, "mgmt0"],
  ]);

  test("every counter, joined by ifIndex, with the mode and the cause", () => {
    const ports: Map<number, SnmpFibreChannelPort> =
      parseCiscoFibreChannelPorts({
        interfaceRows: table({
          [FC1_1.toString()]: { 3: 2, 7: 2, 8: text("none") },
          [FC1_2.toString()]: {
            3: 1,
            7: 7,
            8: text("Link failure or not-connected"),
          },
        }),
        errorRows: table({
          [FC1_1.toString()]: {
            1: 1,
            2: 2,
            3: 3,
            5: 5,
            6: 6,
            26: 26,
            28: 28,
            35: 35,
            37: 37,
            40: 4000,
          },
        }),
        interfaces: interfaces,
      });

    expect(ports.get(FC1_1)).toEqual({
      portType: FibreChannelPortType.F,
      counters: {
        [FibreChannelCounter.CrcErrors]: 6,
        [FibreChannelCounter.InvalidTransmissionWords]: 5,
        [FibreChannelCounter.LinkFailures]: 1,
        [FibreChannelCounter.LossOfSync]: 2,
        [FibreChannelCounter.LossOfSignal]: 3,
        [FibreChannelCounter.Discards]: 26,
        [FibreChannelCounter.TimeoutDiscards]: 35,
        [FibreChannelCounter.CreditLoss]: 37,
        // The 64-bit column, where the switch has it.
        [FibreChannelCounter.BbCreditZero]: 4000,
      },
    });

    // auto(1): a port that has not come up negotiated no mode.
    expect(ports.get(FC1_2)).toEqual({
      downReason: "Link failure or not-connected",
    });
  });

  test("the 32-bit BB credit counter where there is no 64-bit one", () => {
    expect(
      parseCiscoFibreChannelPorts({
        interfaceRows: {},
        errorRows: table({ [FC1_1.toString()]: { 28: 77 } }),
        interfaces: interfaces,
      }).get(FC1_1)?.counters,
    ).toEqual({ [FibreChannelCounter.BbCreditZero]: 77 });
  });

  test("only interfaces the walk found; never one IF-MIB did not list", () => {
    const ports: Map<number, SnmpFibreChannelPort> =
      parseCiscoFibreChannelPorts({
        interfaceRows: {},
        errorRows: table({
          [FC1_1.toString()]: { 6: 1 },
          "999": { 6: 1 },
          abc: { 6: 1 },
        }),
        interfaces: interfaces,
      });

    expect(Array.from(ports.keys())).toEqual([FC1_1]);
  });

  test.each([
    [2, FibreChannelPortType.F],
    [3, FibreChannelPortType.FL],
    [4, FibreChannelPortType.E],
    [7, FibreChannelPortType.SD],
    [9, FibreChannelPortType.N],
    [10, FibreChannelPortType.NL],
    [12, FibreChannelPortType.TE],
    [16, FibreChannelPortType.NP],
    [17, FibreChannelPortType.TF],
    [18, FibreChannelPortType.TNP],
  ])(
    "fcIfOperMode %s is %s",
    (mode: number, portType: FibreChannelPortType) => {
      expect(
        parseCiscoFibreChannelPorts({
          interfaceRows: table({ [FC1_1.toString()]: { 3: mode } }),
          errorRows: {},
          interfaces: interfaces,
        }).get(FC1_1)?.portType,
      ).toBe(portType);
    },
  );

  test("auto(1) and an unknown mode are no type", () => {
    for (const mode of [1, 99]) {
      expect(
        parseCiscoFibreChannelPorts({
          interfaceRows: table({ [FC1_1.toString()]: { 3: mode } }),
          errorRows: {},
          interfaces: interfaces,
        }).get(FC1_1),
      ).toBeUndefined();
    }
  });
});

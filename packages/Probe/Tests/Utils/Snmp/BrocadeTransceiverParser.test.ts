import { describe, expect, test } from "@jest/globals";
import {
  SnmpTransceiverResult,
  TransceiverMibSource,
  TransceiverReadingKind,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTransceiver";
import {
  parseBrocadeSfpTransceivers,
  readBrocadeSfpNumber,
} from "../../../Utils/Snmp/BrocadeTransceiverParser";
import { SnmpTableRows } from "../../../Utils/Snmp/EndpointTableParsers";
import { FibreChannelInterfaceCandidate } from "../../../Utils/Snmp/FibreChannelParsers";

/*
 * Brocade optics from FA-EXT-MIB's swSfpStatTable: text readings (degrees
 * C, millivolts, milliamps, dBm), "-inf" for an optic that sees no light
 * and "NA" for a cage with nothing in it. The table AUGMENTS FCMGMT's
 * connUnitPortEntry, so its rows are indexed by connUnitId and port index,
 * and each is joined to its interface through swFCPortSpecifier; FCMGMT's
 * connUnitPortTable says who made the optic and what it is.
 *
 * Columns: swSfpStatTable 1 temperature, 2 voltage, 3 current, 4 rx power,
 * 5 tx power; connUnitPortTable 8 transmitter type, 9 module type,
 * 12 serial, 13 revision, 14 vendor; swFCPortTable 37 specifier.
 */

function text(value: string): Buffer {
  return Buffer.from(value, "latin1");
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

const UNIT: string = "16.0.196.245.124.74.27.32.0.0.0.0.0.0.0.0";

const INTERFACES: Array<FibreChannelInterfaceCandidate> = [
  { interfaceIndex: 0x40000000, names: ["0/0", "FC port 0/0"] },
  { interfaceIndex: 0x40000001, names: ["0/1", "FC port 0/1"] },
  { interfaceIndex: 0x40000002, names: ["0/2", "FC port 0/2"] },
];

const PORTS: SnmpTableRows = table({
  "1": { 37: text("0") },
  "2": { 37: text("1") },
  "3": { 37: text("2") },
});

function sfp(
  readings: [string, string, string, string, string],
): Record<number, unknown> {
  return {
    1: text(readings[0]),
    2: text(readings[1]),
    3: text(readings[2]),
    4: text(readings[3]),
    5: text(readings[4]),
  };
}

function find(
  results: Array<SnmpTransceiverResult>,
  interfaceIndex: number,
): SnmpTransceiverResult | undefined {
  return results.find((result: SnmpTransceiverResult) => {
    return result.interfaceIndex === interfaceIndex;
  });
}

describe("readBrocadeSfpNumber", () => {
  test.each([
    ["36", 36],
    ["-2.9", -2.9],
    ["3291.6", 3291.6],
    ["0", 0],
    ["-0.0", -0],
  ])("%s reads %s", (value: string, reading: number) => {
    expect(readBrocadeSfpNumber(text(value))).toBe(reading);
    expect(readBrocadeSfpNumber(value)).toBe(reading);
  });

  test("-inf is no light at all: minus infinity, for the caller to floor", () => {
    expect(readBrocadeSfpNumber(text("-inf"))).toBe(-Infinity);
    expect(readBrocadeSfpNumber("-Inf")).toBe(-Infinity);
    expect(readBrocadeSfpNumber("-infinity")).toBe(-Infinity);
  });

  test.each(["NA", "N/A", "", "inf", "+inf", "abc", "1e3", "12 dBm", "--1"])(
    "%s is no reading",
    (value: string) => {
      expect(readBrocadeSfpNumber(text(value))).toBeUndefined();
    },
  );

  test("a number as a number, but never a non-finite one", () => {
    expect(readBrocadeSfpNumber(4.5)).toBe(4.5);
    expect(readBrocadeSfpNumber(NaN)).toBeUndefined();
    expect(readBrocadeSfpNumber(Infinity)).toBeUndefined();
    expect(readBrocadeSfpNumber(undefined)).toBeUndefined();
    expect(readBrocadeSfpNumber(null)).toBeUndefined();
  });
});

describe("parseBrocadeSfpTransceivers", () => {
  test("an SFP's five readings in display units, and who made it", () => {
    const results: Array<SnmpTransceiverResult> = parseBrocadeSfpTransceivers({
      sfpRows: table({
        [`${UNIT}.1`]: sfp(["36", "3291.6", "7.042", "-2.9", "-2.3"]),
      }),
      portRows: PORTS,
      unitPortRows: table({
        [`${UNIT}.1`]: {
          8: 4,
          9: 9,
          12: text("HAF31940000T4K1"),
          13: text("A"),
          14: text("BROCADE"),
        },
      }),
      interfaces: INTERFACES,
    });

    expect(results).toEqual([
      {
        interfaceIndex: 0x40000000,
        source: TransceiverMibSource.BrocadeSfpStat,
        vendor: "BROCADE",
        serialNumber: "HAF31940000T4K1",
        revision: "A",
        type: "SFP, short wave laser",
        measurements: {
          [TransceiverReadingKind.Temperature]: { readings: [{ value: 36 }] },
          // Millivolts, as volts.
          [TransceiverReadingKind.Voltage]: { readings: [{ value: 3.292 }] },
          [TransceiverReadingKind.BiasCurrent]: {
            readings: [{ value: 7.042 }],
          },
          [TransceiverReadingKind.RxPower]: { readings: [{ value: -2.9 }] },
          [TransceiverReadingKind.TxPower]: { readings: [{ value: -2.3 }] },
        },
      },
    ]);
  });

  test("no light: the receive power is the -40 dBm floor, the rest still read", () => {
    const [dark] = parseBrocadeSfpTransceivers({
      sfpRows: table({
        [`${UNIT}.2`]: sfp(["35", "3300", "7", "-inf", "-2.4"]),
      }),
      portRows: PORTS,
      interfaces: INTERFACES,
    });

    expect(dark?.interfaceIndex).toBe(0x40000001);
    expect(
      dark?.measurements[TransceiverReadingKind.RxPower]?.readings[0]?.value,
    ).toBe(-40);
    expect(
      dark?.measurements[TransceiverReadingKind.TxPower]?.readings[0]?.value,
    ).toBe(-2.4);
  });

  test("an empty cage - gbicNotInstalled, or every reading NA and no maker - is no optic", () => {
    const results: Array<SnmpTransceiverResult> = parseBrocadeSfpTransceivers({
      sfpRows: table({
        [`${UNIT}.1`]: sfp(["36", "3291.6", "7.042", "-2.9", "-2.3"]),
        [`${UNIT}.2`]: sfp(["NA", "NA", "NA", "NA", "NA"]),
        [`${UNIT}.3`]: sfp(["36", "3291.6", "7.042", "-2.9", "-2.3"]),
      }),
      portRows: PORTS,
      unitPortRows: table({
        // gbicNotInstalled(8): stale readings for a pulled module.
        [`${UNIT}.3`]: { 9: 8 },
      }),
      interfaces: INTERFACES,
    });

    expect(
      results.map((result: SnmpTransceiverResult) => {
        return result.interfaceIndex;
      }),
    ).toEqual([0x40000000]);
  });

  test("an optic that reports no readings but says who made it is still there", () => {
    const [copper] = parseBrocadeSfpTransceivers({
      sfpRows: table({
        [`${UNIT}.1`]: sfp(["NA", "NA", "NA", "NA", "NA"]),
      }),
      portRows: PORTS,
      unitPortRows: table({
        [`${UNIT}.1`]: { 8: 6, 9: 9, 14: text("BROCADE") },
      }),
      interfaces: INTERFACES,
    });

    expect(copper?.measurements).toEqual({});
    expect(copper?.type).toBe("SFP, copper");
  });

  test.each([
    [9, 9, "SFP, short wave laser"],
    [9, 5, "SFP, long wave laser"],
    [9, 8, "SFP, long wave laser"],
    [6, 10, "GBIC, long wave LED"],
    [4, 1, "Embedded"],
    [1, 6, "copper"],
  ])(
    "module type %s with transmitter %s is %s",
    (moduleType: number, transmitter: number, type: string) => {
      const [optic] = parseBrocadeSfpTransceivers({
        sfpRows: table({
          [`${UNIT}.1`]: sfp(["36", "3291.6", "7.042", "-2.9", "-2.3"]),
        }),
        portRows: PORTS,
        unitPortRows: table({
          [`${UNIT}.1`]: { 8: transmitter, 9: moduleType },
        }),
        interfaces: INTERFACES,
      });

      expect(optic?.type).toBe(type);
    },
  );

  test("joined through the port's specifier, not its index: a logical switch numbers its ports its own way", () => {
    const results: Array<SnmpTransceiverResult> = parseBrocadeSfpTransceivers({
      sfpRows: table({
        [`${UNIT}.1`]: sfp(["36", "3291.6", "7.042", "-2.9", "-2.3"]),
      }),
      // Port index 1 is the switch's port 2.
      portRows: table({ "1": { 37: text("2") } }),
      interfaces: INTERFACES,
    });

    expect(find(results, 0x40000002)).toBeDefined();
    expect(find(results, 0x40000000)).toBeUndefined();
  });

  test("a port swFCPortTable does not list is joined by Fabric OS's numbering", () => {
    const [optic] = parseBrocadeSfpTransceivers({
      sfpRows: table({
        [`${UNIT}.2`]: sfp(["36", "3291.6", "7.042", "-2.9", "-2.3"]),
      }),
      portRows: {},
      interfaces: INTERFACES,
    });

    expect(optic?.interfaceIndex).toBe(0x40000001);
  });

  test("an optic joined to no interface is left out", () => {
    expect(
      parseBrocadeSfpTransceivers({
        sfpRows: table({
          [`${UNIT}.9`]: sfp(["36", "3291.6", "7.042", "-2.9", "-2.3"]),
        }),
        portRows: table({ "9": { 37: text("40") } }),
        interfaces: INTERFACES,
      }),
    ).toEqual([]);
  });

  test("a reading that is no number is left out, not read as zero", () => {
    const [optic] = parseBrocadeSfpTransceivers({
      sfpRows: table({
        [`${UNIT}.1`]: sfp(["NA", "3291.6", "garbage", "-2.9", ""]),
      }),
      portRows: PORTS,
      interfaces: INTERFACES,
    });

    expect(Object.keys(optic?.measurements || {}).sort()).toEqual(
      [TransceiverReadingKind.RxPower, TransceiverReadingKind.Voltage].sort(),
    );
  });

  test("ordered by interface", () => {
    expect(
      parseBrocadeSfpTransceivers({
        sfpRows: table({
          [`${UNIT}.3`]: sfp(["36", "3291.6", "7.042", "-2.9", "-2.3"]),
          [`${UNIT}.1`]: sfp(["36", "3291.6", "7.042", "-2.9", "-2.3"]),
          [`${UNIT}.2`]: sfp(["36", "3291.6", "7.042", "-2.9", "-2.3"]),
        }),
        portRows: PORTS,
        interfaces: INTERFACES,
      }).map((result: SnmpTransceiverResult) => {
        return result.interfaceIndex;
      }),
    ).toEqual([0x40000000, 0x40000001, 0x40000002]);
  });
});

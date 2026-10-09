import { describe, expect, test } from "@jest/globals";
import {
  SnmpTransceiverResult,
  TransceiverFault,
  TransceiverMibSource,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTransceiver";
import { SnmpTableRows } from "../../../Utils/Snmp/EndpointTableParsers";
import {
  TransceiverInterfaceCandidate,
  TransceiverInterfaceIndex,
  canonicalInterfaceName,
  domSensorIndexes,
  hasOpticalPowerSensor,
  interfaceNameCandidates,
  isBitSet,
  parseCambiumTransceivers,
  parseEntitySensorTransceivers,
  parseH3cTransceivers,
  parseHpIcfTransceivers,
  parseJuniperDomTransceivers,
  parseMikroTikTransceivers,
  readNumber,
  readText,
} from "../../../Utils/Snmp/TransceiverParsers";

/*
 * Every transceiver MIB the probe reads, parsed from tables in the shape a
 * real walk returns - rows keyed by index, columns by number, text as
 * OCTET STRING buffers, RowPointers as dotted strings. The values follow
 * each MIB's own units (hundredths of a dBm, tenths of a microwatt, a
 * sensor's scale and precision ...) and every expectation is worked out by
 * hand in display units: degrees C, volts, milliamps and dBm.
 */

function text(value: string): Buffer {
  return Buffer.from(value, "latin1");
}

// Rows in net-snmp's shape: column numbers as string keys.
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

function interfaces(
  candidates: Array<[number, ...Array<string | undefined>]>,
): TransceiverInterfaceIndex {
  return new TransceiverInterfaceIndex(
    candidates.map(
      ([interfaceIndex, ...names]: [number, ...Array<string | undefined>]) => {
        return { interfaceIndex: interfaceIndex, names: names };
      },
    ) as Array<TransceiverInterfaceCandidate>,
  );
}

function byPort(
  results: Array<SnmpTransceiverResult>,
  interfaceIndex: number,
): SnmpTransceiverResult {
  const found: SnmpTransceiverResult | undefined = results.find(
    (result: SnmpTransceiverResult) => {
      return result.interfaceIndex === interfaceIndex;
    },
  );

  expect(found).toBeDefined();
  return found!;
}

describe("values", () => {
  test("readNumber takes integers, Counter64 buffers and numeric text", () => {
    expect(readNumber(-473)).toBe(-473);
    expect(readNumber(BigInt(85000))).toBe(85000);
    expect(readNumber(Buffer.from([0x01, 0x4c, 0x08]))).toBe(85000);
    expect(readNumber(" 3302 ")).toBe(3302);
    expect(readNumber("n/a")).toBeUndefined();
    expect(readNumber(Buffer.alloc(0))).toBeUndefined();
    expect(readNumber(NaN)).toBeUndefined();
    expect(readNumber(null)).toBeUndefined();
  });

  test("readText cleans EEPROM padding and binary noise", () => {
    expect(readText(text("FS              "))).toBe("FS");
    expect(readText(Buffer.from([0x46, 0x53, 0x00, 0x00, 0x20]))).toBe("FS");
    expect(readText(Buffer.from([0x00, 0xff, 0x01]))).toBeUndefined();
    expect(readText("x".repeat(300))).toHaveLength(100);
    expect(readText(undefined)).toBeUndefined();
  });

  test("isBitSet reads BITS the SNMP way: bit 0 is the top bit of the first octet", () => {
    // txFault(12) and rxLossOfSignal(16).
    const errors: Buffer = Buffer.from([0x00, 0x08, 0x80, 0x00]);

    expect(isBitSet(errors, 12)).toBe(true);
    expect(isBitSet(errors, 16)).toBe(true);
    expect(isBitSet(errors, 0)).toBe(false);
    expect(isBitSet(errors, 40)).toBe(false);
    expect(isBitSet(12, 0)).toBe(false);
  });
});

describe("matching an optic to its port", () => {
  test("one spelling for every way a port is named", () => {
    expect(canonicalInterfaceName("TenGigabitEthernet1/1/1")).toBe("te1/1/1");
    expect(canonicalInterfaceName("Te1/1/1")).toBe("te1/1/1");
    expect(canonicalInterfaceName("GigabitEthernet 0/49")).toBe("gi0/49");
    expect(canonicalInterfaceName("Ethernet49/1")).toBe("et49/1");
    expect(canonicalInterfaceName("Eth1/1")).toBe("et1/1");
    expect(canonicalInterfaceName("sfp-sfpplus1")).toBe("sfp-sfpplus1");
    expect(canonicalInterfaceName(undefined)).toBe("");
  });

  test("the names a label might point at", () => {
    expect(interfaceNameCandidates("Xcvr for Ethernet1")).toEqual([
      "Xcvr for Ethernet1",
      "Ethernet1",
      "Xcvr",
    ]);
    expect(
      interfaceNameCandidates("Gi1/0/52 Module Temperature Sensor"),
    ).toContain("Gi1/0/52");
    expect(interfaceNameCandidates("  ")).toEqual([]);
  });

  test("an index finds ports by any of their names, long or short", () => {
    const index: TransceiverInterfaceIndex = interfaces([
      [10151, "Gi1/0/51", "GigabitEthernet1/0/51", "Spare"],
      [10152, "Gi1/0/52", "GigabitEthernet1/0/52", "Uplink"],
    ]);

    expect(index.findByName("GigabitEthernet1/0/52")).toBe(10152);
    expect(index.findByName("Gi1/0/51 Transceiver")).toBe(10151);
    expect(index.findByName("uplink")).toBe(10152);
    expect(index.findByName("Gi1/0/5")).toBeUndefined();
    expect(index.hasInterface(10152)).toBe(true);
    expect(index.hasInterface(1)).toBe(false);
  });

  test("a cage split into breakout ports is the first of them", () => {
    const index: TransceiverInterfaceIndex = interfaces([
      [52, "Ethernet49/2"],
      [53, "Ethernet49/10"],
      [51, "Ethernet49/1"],
    ]);

    expect(index.findByName("Xcvr for Ethernet49")).toBe(51);
  });
});

/*
 * CISCO-ENTITY-SENSOR-MIB, as a Catalyst 2960-X reports a 1000BASE-SX SFP:
 * the optic is the port entity (GigabitEthernet1/0/52, mapped to its ifIndex
 * by entAliasMappingTable), its five sensors sit under it, and the
 * thresholds come one row per threshold.
 */
describe("CISCO-ENTITY-SENSOR-MIB", () => {
  const ENTITY: SnmpTableRows = table({
    "1001": {
      2: text("WS-C2960X-48FPS-L"),
      4: 1,
      5: 3,
      7: text("1"),
      11: text("FCW1929B68S"),
      13: text("WS-C2960X-48FPS-L"),
    },
    "1006": {
      2: text("Inlet Temperature Sensor"),
      4: 1001,
      5: 8,
      7: text("Inlet Temperature Sensor"),
    },
    "1060": {
      2: text("GigabitEthernet Container"),
      4: 1002,
      5: 5,
      7: text("GigabitEthernet1/0/51 Container"),
    },
    "1061": {
      2: text("GigabitEthernet Container"),
      4: 1002,
      5: 5,
      7: text("GigabitEthernet1/0/52 Container"),
    },
    "1062": {
      2: text("1000BaseSX SFP"),
      4: 1061,
      5: 10,
      7: text("GigabitEthernet1/0/52"),
      8: text("V01 "),
      11: text("FNS192717K1"),
      12: text(""),
      13: text("GLC-SX-MMD"),
    },
    "1063": {
      2: text("GigabitEthernet1/0/52 Module Temperature Sensor"),
      4: 1062,
      5: 8,
      7: text("Gi1/0/52 Module Temperature Sensor"),
    },
    "1064": {
      2: text("GigabitEthernet1/0/52 Supply Voltage Sensor"),
      4: 1062,
      5: 8,
      7: text("Gi1/0/52 Supply Voltage Sensor"),
    },
    "1065": {
      2: text("GigabitEthernet1/0/52 Bias Current Sensor"),
      4: 1062,
      5: 8,
      7: text("Gi1/0/52 Bias Current Sensor"),
    },
    "1066": {
      2: text("GigabitEthernet1/0/52 Transmit Power Sensor"),
      4: 1062,
      5: 8,
      7: text("Gi1/0/52 Transmit Power Sensor"),
    },
    "1067": {
      2: text("GigabitEthernet1/0/52 Receive Power Sensor"),
      4: 1062,
      5: 8,
      7: text("Gi1/0/52 Receive Power Sensor"),
    },
    // A copper SFP: detected, with no diagnostics.
    "1072": {
      2: text("1000BaseT SFP"),
      4: 1060,
      5: 10,
      7: text("GigabitEthernet1/0/51"),
      11: text("AGM1234X0Z"),
      13: text("GLC-T"),
    },
  });

  // type, scale, precision, value, status.
  const SENSORS: SnmpTableRows = table({
    "1006": { 1: 8, 2: 9, 3: 0, 4: 41, 5: 1 },
    "1063": { 1: 8, 2: 9, 3: 1, 4: 346, 5: 1 },
    "1064": { 1: 4, 2: 9, 3: 2, 4: 332, 5: 1 },
    "1065": { 1: 5, 2: 8, 3: 1, 4: 61, 5: 1 },
    "1066": { 1: 14, 2: 9, 3: 1, 4: -50, 5: 1 },
    "1067": { 1: 14, 2: 9, 3: 1, 4: -47, 5: 1 },
  });

  // severity (10 minor, 20 major, 30 critical), relation (2 <=, 4 >=), value.
  const THRESHOLDS: SnmpTableRows = table({
    "1063.1": { 2: 20, 3: 4, 4: 900 },
    "1063.2": { 2: 10, 3: 4, 4: 850 },
    "1063.3": { 2: 10, 3: 2, 4: -50 },
    "1063.4": { 2: 20, 3: 2, 4: -100 },
    "1067.1": { 2: 30, 3: 4, 4: 20 },
    "1067.2": { 2: 20, 3: 4, 4: 5 },
    "1067.3": { 2: 10, 3: 4, 4: -10 },
    "1067.4": { 2: 10, 3: 2, 4: -170 },
    "1067.5": { 2: 20, 3: 2, 4: -181 },
    "1067.6": { 2: 30, 3: 2, 4: -200 },
  });

  const ALIASES: SnmpTableRows = table({
    "1062.0": { 2: "1.3.6.1.2.1.2.2.1.1.10152" },
    "1072.0": { 2: "1.3.6.1.2.1.2.2.1.1.10151" },
  });

  const PORTS: TransceiverInterfaceIndex = interfaces([
    [10151, "Gi1/0/51", "GigabitEthernet1/0/51"],
    [10152, "Gi1/0/52", "GigabitEthernet1/0/52", "Uplink"],
  ]);

  function parse(
    overrides: {
      sensors?: SnmpTableRows;
      thresholds?: SnmpTableRows | undefined;
      aliases?: SnmpTableRows | undefined;
      ports?: TransceiverInterfaceIndex;
    } = {},
  ): Array<SnmpTransceiverResult> {
    return parseEntitySensorTransceivers({
      flavor: "cisco",
      sensorRows: overrides.sensors || SENSORS,
      entityRows: ENTITY,
      aliasRows: "aliases" in overrides ? overrides.aliases : ALIASES,
      thresholdRows:
        "thresholds" in overrides ? overrides.thresholds : THRESHOLDS,
      interfaces: overrides.ports || PORTS,
    });
  }

  test("an SFP with DOM: identity, five readings, the device's thresholds", () => {
    expect(byPort(parse(), 10152)).toEqual({
      interfaceIndex: 10152,
      partNumber: "GLC-SX-MMD",
      serialNumber: "FNS192717K1",
      revision: "V01",
      type: "1000BaseSX SFP",
      measurements: {
        temperature: {
          readings: [{ value: 34.6 }],
          thresholds: {
            lowAlarm: -10,
            lowWarning: -5,
            highWarning: 85,
            highAlarm: 90,
          },
        },
        voltage: { readings: [{ value: 3.32 }] },
        biasCurrent: { readings: [{ value: 6.1 }] },
        txPower: { readings: [{ value: -5 }] },
        rxPower: {
          readings: [{ value: -4.7 }],
          // Major and critical on one side: the first one crossed counts.
          thresholds: {
            lowAlarm: -18.1,
            lowWarning: -17,
            highWarning: -1,
            highAlarm: 0.5,
          },
        },
      },
      source: TransceiverMibSource.CiscoEntitySensor,
    });
  });

  test("a copper SFP is detected with nothing to read", () => {
    expect(byPort(parse(), 10151)).toEqual({
      interfaceIndex: 10151,
      partNumber: "GLC-T",
      serialNumber: "AGM1234X0Z",
      type: "1000BaseT SFP",
      measurements: {},
      source: TransceiverMibSource.CiscoEntitySensor,
    });
  });

  test("the chassis's own sensors are never an optic", () => {
    expect(
      parse().map((result: SnmpTransceiverResult) => {
        return result.interfaceIndex;
      }),
    ).toEqual([10151, 10152]);
  });

  test("a sensor the agent cannot read now is no reading, not a zero", () => {
    const unreadable: SnmpTableRows = table({
      ...SENSORS,
      // unavailable(2)
      "1067": { 1: 14, 2: 9, 3: 1, 4: 0, 5: 2 },
    });

    expect(
      byPort(parse({ sensors: unreadable }), 10152).measurements.rxPower,
    ).toBeUndefined();
  });

  test("without entAliasMappingTable, the sensor names find the port", () => {
    expect(byPort(parse({ aliases: undefined }), 10152).serialNumber).toBe(
      "FNS192717K1",
    );
  });

  test("without thresholds the readings stand alone", () => {
    expect(
      byPort(parse({ thresholds: undefined }), 10152).measurements.rxPower,
    ).toEqual({ readings: [{ value: -4.7 }] });
  });

  test("an optic in a port the interface walk did not find is not reported", () => {
    expect(
      parse({ ports: interfaces([[10151, "Gi1/0/51"]]) }).map(
        (result: SnmpTransceiverResult) => {
          return result.interfaceIndex;
        },
      ),
    ).toEqual([10151]);
  });

  test("dBm sensors are Cisco's alone; the DOM sensor list follows the flavor", () => {
    expect(domSensorIndexes(SENSORS, "cisco").sort()).toEqual([
      "1006",
      "1063",
      "1064",
      "1065",
      "1066",
      "1067",
    ]);
    expect(domSensorIndexes(SENSORS, "standard").sort()).toEqual([
      "1006",
      "1063",
      "1064",
      "1065",
    ]);
    expect(hasOpticalPowerSensor(SENSORS, "cisco")).toBe(true);
    expect(hasOpticalPowerSensor(SENSORS, "standard")).toBe(false);
  });
});

/*
 * RFC 3433 sensors with ARISTA-ENTITY-SENSOR-MIB thresholds, as EOS reports
 * them: the optic is a container named "Xcvr for Ethernet1" with no
 * entPhysicalName and no alias mapping, its per-lane sensors hang under
 * "Lane 0 for Xcvr for Ethernet1", and power is in watts with an SI prefix.
 */
describe("ENTITY-SENSOR-MIB with Arista thresholds", () => {
  const ENTITY: SnmpTableRows = table({
    "100301000": { 2: text("Xcvr Slot 1"), 4: 1100300000, 5: 5 },
    "100301100": {
      2: text("Xcvr for Ethernet1"),
      4: 100301000,
      5: 5,
      7: text(""),
      11: text("G1904016438"),
      12: text("Arista Networks"),
      13: text("SFP-10GLR-31"),
    },
    "100301201": {
      2: text("DOM Temperature Sensor for Ethernet1"),
      4: 100301100,
      5: 8,
    },
    "100301202": {
      2: text("DOM Voltage Sensor for Ethernet1"),
      4: 100301100,
      5: 8,
    },
    "100301210": {
      2: text("Lane 0 for Xcvr for Ethernet1"),
      4: 100301100,
      5: 9,
    },
    "100301211": {
      2: text("DOM TX Bias Sensor for Ethernet1"),
      4: 100301210,
      5: 8,
    },
    "100301212": {
      2: text("DOM TX Power Sensor for Ethernet1"),
      4: 100301210,
      5: 8,
    },
    "100301213": {
      2: text("DOM RX Power Sensor for Ethernet1"),
      4: 100301210,
      5: 8,
    },
  });

  const SENSORS: SnmpTableRows = table({
    "100301201": { 1: 8, 2: 9, 3: 1, 4: 258, 5: 1 },
    "100301202": { 1: 4, 2: 9, 3: 2, 4: 331, 5: 1 },
    "100301211": { 1: 5, 2: 8, 3: 2, 4: 3345, 5: 1 },
    "100301212": { 1: 6, 2: 8, 3: 4, 4: 6322, 5: 1 },
    // 0.0001 mW: no light at all.
    "100301213": { 1: 6, 2: 8, 3: 4, 4: 1, 5: 1 },
  });

  // lowWarning, lowCritical, highWarning, highCritical.
  const THRESHOLDS: SnmpTableRows = table({
    "100301201": { 1: -400, 2: -500, 3: 850, 4: 1000 },
    "100301202": { 1: 314, 2: 297, 3: 347, 4: 363 },
    "100301211": { 1: 100, 2: 100, 3: 10000, 4: 11000 },
    "100301212": { 1: 1514, 2: 955, 3: 17783, 4: 22387 },
    "100301213": { 1: 363, 2: 229, 3: 17783, 4: 22387 },
  });

  test("an SFP: watts to dBm, milliamps, and Arista's thresholds in the same units", () => {
    const results: Array<SnmpTransceiverResult> =
      parseEntitySensorTransceivers({
        flavor: "arista",
        sensorRows: SENSORS,
        entityRows: ENTITY,
        thresholdRows: THRESHOLDS,
        interfaces: interfaces([
          [1, "Ethernet1", "Ethernet1"],
          [2, "Ethernet2", "Ethernet2"],
        ]),
      });

    expect(results).toEqual([
      {
        interfaceIndex: 1,
        vendor: "Arista Networks",
        partNumber: "SFP-10GLR-31",
        serialNumber: "G1904016438",
        measurements: {
          temperature: {
            readings: [{ value: 25.8 }],
            thresholds: {
              lowAlarm: -50,
              lowWarning: -40,
              highWarning: 85,
              highAlarm: 100,
            },
          },
          voltage: {
            readings: [{ value: 3.31 }],
            thresholds: {
              lowAlarm: 2.97,
              lowWarning: 3.14,
              highWarning: 3.47,
              highAlarm: 3.63,
            },
          },
          // One lane: an SFP's "Lane 0" is no lane to name.
          biasCurrent: {
            readings: [{ value: 33.45 }],
            thresholds: {
              lowAlarm: 1,
              lowWarning: 1,
              highWarning: 100,
              highAlarm: 110,
            },
          },
          txPower: {
            readings: [{ value: -1.99 }],
            thresholds: {
              lowAlarm: -10.2,
              lowWarning: -8.2,
              highWarning: 2.5,
              highAlarm: 3.5,
            },
          },
          rxPower: {
            readings: [{ value: -40 }],
            thresholds: {
              lowAlarm: -16.4,
              lowWarning: -14.4,
              highWarning: 2.5,
              highAlarm: 3.5,
            },
          },
        },
        source: TransceiverMibSource.AristaEntitySensor,
      },
    ]);
  });

  test("a threshold the agent does not support (the EntitySensorValue extremes) is left out", () => {
    const unsupported: SnmpTableRows = table({
      ...THRESHOLDS,
      "100301201": { 1: -1000000000, 2: -1000000000, 3: 850, 4: 1000 },
    });

    const result: SnmpTransceiverResult = parseEntitySensorTransceivers({
      flavor: "arista",
      sensorRows: SENSORS,
      entityRows: ENTITY,
      thresholdRows: unsupported,
      interfaces: interfaces([[1, "Ethernet1"]]),
    })[0]!;

    expect(result.measurements.temperature?.thresholds).toEqual({
      highWarning: 85,
      highAlarm: 100,
    });
  });

  test("a QSFP: one reading per lane, on the first port of its breakout", () => {
    const qsfpEntity: SnmpTableRows = table({
      "100349100": {
        2: text("Xcvr for Ethernet49"),
        4: 100349000,
        5: 5,
        11: text("XQB1234"),
        12: text("FLEXOPTIX"),
        13: text("Q.1312.10"),
      },
      "100349201": {
        2: text("DOM Temperature Sensor for Ethernet49"),
        4: 100349100,
        5: 8,
      },
      ...Object.fromEntries(
        [1, 2, 3, 4].flatMap((lane: number) => {
          return [
            [
              `1003492${lane}0`,
              {
                2: text(`Lane ${lane} for Xcvr for Ethernet49`),
                4: 100349100,
                5: 9,
              },
            ],
            [
              `1003492${lane}3`,
              {
                2: text(`DOM RX Power Sensor for Ethernet49/${lane}`),
                4: Number(`1003492${lane}0`),
                5: 8,
              },
            ],
          ];
        }),
      ),
    });

    // 0.5, 0.45, 0.012 and 0.48 mW.
    const qsfpSensors: SnmpTableRows = table({
      "100349201": { 1: 8, 2: 9, 3: 1, 4: 312, 5: 1 },
      "100349213": { 1: 6, 2: 8, 3: 4, 4: 5000, 5: 1 },
      "100349223": { 1: 6, 2: 8, 3: 4, 4: 4500, 5: 1 },
      "100349233": { 1: 6, 2: 8, 3: 4, 4: 120, 5: 1 },
      "100349243": { 1: 6, 2: 8, 3: 4, 4: 4800, 5: 1 },
    });

    const results: Array<SnmpTransceiverResult> =
      parseEntitySensorTransceivers({
        flavor: "arista",
        sensorRows: qsfpSensors,
        entityRows: qsfpEntity,
        interfaces: interfaces([
          [491, "Ethernet49/1"],
          [492, "Ethernet49/2"],
          [493, "Ethernet49/3"],
          [494, "Ethernet49/4"],
        ]),
      });

    expect(results).toHaveLength(1);
    expect(results[0]!.interfaceIndex).toBe(491);
    expect(results[0]!.vendor).toBe("FLEXOPTIX");
    expect(results[0]!.measurements.rxPower?.readings).toEqual([
      { value: -3.01, lane: 1 },
      { value: -3.47, lane: 2 },
      { value: -19.21, lane: 3 },
      { value: -3.19, lane: 4 },
    ]);
    expect(results[0]!.measurements.temperature?.readings).toEqual([
      { value: 31.2 },
    ]);
  });
});

/*
 * Plain ENTITY-SENSOR-MIB, as many switches without a vendor DOM table
 * report it (FS.com, Dell, Extreme): the optic is a module mapped to its
 * port, and the device reports readings but no thresholds.
 */
describe("ENTITY-SENSOR-MIB, no thresholds", () => {
  const ENTITY: SnmpTableRows = table({
    "1": { 2: text("S5850-48S6Q"), 4: 0, 5: 3, 11: text("CH1234") },
    "2": { 2: text("Line Card 1"), 4: 1, 5: 9, 13: text("S5850-LC") },
    "49": {
      2: text("SFP+ 10GBASE-LR"),
      4: 2,
      5: 9,
      7: text("TenGigabitEthernet 0/49"),
      11: text("F2030411122"),
      12: text("FS"),
      13: text("SFP-10GLR-31"),
    },
    "4901": { 2: text("Temperature"), 4: 49, 5: 8 },
    "4902": { 2: text("Supply Voltage"), 4: 49, 5: 8 },
    "4903": { 2: text("Bias Current"), 4: 49, 5: 8 },
    "4904": { 2: text("Tx Power"), 4: 49, 5: 8 },
    "4905": { 2: text("Rx Power"), 4: 49, 5: 8 },
  });

  // Watts at micro (7) scale, precision 1: 6321 -> 632.1 uW.
  const SENSORS: SnmpTableRows = table({
    "4901": { 1: 8, 2: 9, 3: 2, 4: 3725, 5: 1 },
    "4902": { 1: 4, 2: 8, 3: 0, 4: 3287, 5: 1 },
    "4903": { 1: 5, 2: 7, 3: 0, 4: 6400, 5: 1 },
    "4904": { 1: 6, 2: 7, 3: 1, 4: 6321, 5: 1 },
    "4905": { 1: 6, 2: 7, 3: 1, 4: 3981, 5: 1 },
  });

  test("readings in display units, matched through the alias mapping", () => {
    expect(
      parseEntitySensorTransceivers({
        flavor: "standard",
        sensorRows: SENSORS,
        entityRows: ENTITY,
        aliasRows: table({ "49.0": { 2: ".1.3.6.1.2.1.2.2.1.1.49" } }),
        interfaces: interfaces([[49, "TenGigabitEthernet 0/49", "Te0/49"]]),
      }),
    ).toEqual([
      {
        interfaceIndex: 49,
        vendor: "FS",
        partNumber: "SFP-10GLR-31",
        serialNumber: "F2030411122",
        type: "SFP+ 10GBASE-LR",
        measurements: {
          temperature: { readings: [{ value: 37.25 }] },
          voltage: { readings: [{ value: 3.287 }] },
          biasCurrent: { readings: [{ value: 6.4 }] },
          txPower: { readings: [{ value: -1.99 }] },
          rxPower: { readings: [{ value: -4 }] },
        },
        source: TransceiverMibSource.EntitySensor,
      },
    ]);
  });
});

/*
 * What is not an optic, however much it looks like one: a line card that
 * holds many ports (with a temperature sensor, even with "SFP" in its model
 * name), a power supply's "Output Power", the chassis's own sensors.
 */
describe("the entity tree's other residents", () => {
  const PORTS: TransceiverInterfaceIndex = interfaces([
    [1, "Gi1/0/1"],
    [2, "Gi1/0/2"],
    [3, "Gi1/0/3"],
    [4, "Gi1/0/4"],
  ]);

  const ALIASES: SnmpTableRows = table({
    "11.0": { 2: "1.3.6.1.2.1.2.2.1.1.1" },
    "12.0": { 2: "1.3.6.1.2.1.2.2.1.1.2" },
    "13.0": { 2: "1.3.6.1.2.1.2.2.1.1.3" },
    "14.0": { 2: "1.3.6.1.2.1.2.2.1.1.4" },
  });

  function lineCard(model: string, descr: string): SnmpTableRows {
    return table({
      "1": { 2: text("Chassis"), 5: 3 },
      "10": {
        2: text(descr),
        4: 1,
        5: 9,
        7: text("Slot 1"),
        11: text("LC12345"),
        13: text(model),
      },
      "11": { 2: text("Gi1/0/1"), 4: 10, 5: 10, 7: text("Gi1/0/1") },
      "12": { 2: text("Gi1/0/2"), 4: 10, 5: 10, 7: text("Gi1/0/2") },
      "13": { 2: text("Gi1/0/3"), 4: 10, 5: 10, 7: text("Gi1/0/3") },
      "14": { 2: text("Gi1/0/4"), 4: 10, 5: 10, 7: text("Gi1/0/4") },
      "19": { 2: text("Slot 1 Temperature"), 4: 10, 5: 8 },
      "20": { 2: text("PS1 Output Power"), 4: 30, 5: 8 },
      "30": {
        2: text("Power Supply 1"),
        4: 1,
        5: 6,
        11: text("PSU123"),
        13: text("PWR-C1-715WAC"),
      },
    });
  }

  const SENSORS: SnmpTableRows = table({
    "19": { 1: 8, 2: 9, 3: 0, 4: 41, 5: 1 },
    // 350 W out of the power supply.
    "20": { 1: 6, 2: 9, 3: 0, 4: 350, 5: 1 },
  });

  test("a line card with SFP ports is not an optic in its first port", () => {
    expect(
      parseEntitySensorTransceivers({
        flavor: "standard",
        sensorRows: SENSORS,
        entityRows: lineCard("WS-X4748-SFP-E", "48-port 1000BaseX SFP line card"),
        aliasRows: ALIASES,
        interfaces: PORTS,
      }),
    ).toEqual([]);
  });

  test("a power supply's output power is not a transmitter", () => {
    expect(
      parseEntitySensorTransceivers({
        flavor: "standard",
        sensorRows: SENSORS,
        entityRows: lineCard("C9300-NM-8X", "8x10G Network Module"),
        aliasRows: ALIASES,
        interfaces: interfaces([
          [1, "Gi1/0/1"],
          [7, "PS1", "Power Supply 1"],
        ]),
      }),
    ).toEqual([]);
  });
});

describe("JUNIPER-DOM-MIB", () => {
  // Hundredths of a dBm, microamps, millivolts, degrees C.
  const ROWS: SnmpTableRows = table({
    "513": {
      5: -473,
      6: 6402,
      7: -235,
      8: 34,
      9: 50,
      10: -1801,
      11: -100,
      12: -1440,
      13: 10000,
      14: 2000,
      15: 9000,
      16: 3000,
      17: 300,
      18: -1100,
      19: -100,
      20: -820,
      21: 75,
      22: -5,
      23: 70,
      24: 0,
      25: 3291,
      26: 3630,
      27: 2970,
      28: 3465,
      29: 3135,
      30: 1,
    },
    "530": {
      5: -350,
      6: 7000,
      7: -120,
      8: 41,
      25: 3300,
      30: 4,
    },
    // A port the interface walk did not find.
    "999": { 5: -400, 8: 30, 30: 1 },
  });

  const LANES: SnmpTableRows = table({
    "530.0": { 6: -310, 7: 6500, 8: -100 },
    "530.1": { 6: -1955, 7: 7100, 8: -150 },
    "530.2": { 6: -290, 7: 6900, 8: -110 },
    "530.3": { 6: -330, 7: 7000, 8: -130 },
  });

  const PORTS: TransceiverInterfaceIndex = interfaces([
    [513, "xe-0/0/0"],
    [530, "et-0/0/49"],
  ]);

  test("an SFP+: every reading in display units, with its thresholds", () => {
    expect(
      byPort(parseJuniperDomTransceivers({ rows: ROWS, interfaces: PORTS }), 513),
    ).toEqual({
      interfaceIndex: 513,
      measurements: {
        rxPower: {
          readings: [{ value: -4.73 }],
          thresholds: {
            lowAlarm: -18.01,
            lowWarning: -14.4,
            highWarning: -1,
            highAlarm: 0.5,
          },
        },
        txPower: {
          readings: [{ value: -2.35 }],
          thresholds: {
            lowAlarm: -11,
            lowWarning: -8.2,
            highWarning: -1,
            highAlarm: 3,
          },
        },
        biasCurrent: {
          readings: [{ value: 6.402 }],
          thresholds: {
            lowAlarm: 2,
            lowWarning: 3,
            highWarning: 9,
            highAlarm: 10,
          },
        },
        temperature: {
          readings: [{ value: 34 }],
          thresholds: {
            lowAlarm: -5,
            lowWarning: 0,
            highWarning: 70,
            highAlarm: 75,
          },
        },
        voltage: {
          readings: [{ value: 3.291 }],
          thresholds: {
            lowAlarm: 2.97,
            lowWarning: 3.135,
            highWarning: 3.465,
            highAlarm: 3.63,
          },
        },
      },
      source: TransceiverMibSource.JuniperDom,
    });
  });

  test("a four-lane optic reads its powers and bias lane by lane", () => {
    const qsfp: SnmpTransceiverResult = byPort(
      parseJuniperDomTransceivers({
        rows: ROWS,
        laneRows: LANES,
        interfaces: PORTS,
      }),
      530,
    );

    expect(qsfp.measurements.rxPower?.readings).toEqual([
      { value: -3.1, lane: 0 },
      { value: -19.55, lane: 1 },
      { value: -2.9, lane: 2 },
      { value: -3.3, lane: 3 },
    ]);
    expect(qsfp.measurements.biasCurrent?.readings).toHaveLength(4);
    expect(qsfp.measurements.temperature?.readings).toEqual([{ value: 41 }]);
  });

  test("without the lane table a multi-lane optic keeps its module-wide readings", () => {
    expect(
      byPort(parseJuniperDomTransceivers({ rows: ROWS, interfaces: PORTS }), 530)
        .measurements.rxPower?.readings,
    ).toEqual([{ value: -3.5 }]);
  });

  test("only ports the interface walk found are reported", () => {
    expect(
      parseJuniperDomTransceivers({ rows: ROWS, interfaces: PORTS }).map(
        (result: SnmpTransceiverResult) => {
          return result.interfaceIndex;
        },
      ),
    ).toEqual([513, 530]);
  });
});

/*
 * MIKROTIK-MIB mtxrOpticalTable, as RouterOS reports an SFP: its index is
 * the interface's, or - when that is not one the walk found - its name is.
 */
describe("MIKROTIK-MIB", () => {
  const ROW: Record<number, unknown> = {
    2: text("sfp1"),
    3: 0,
    4: 0,
    5: 85000,
    6: 40,
    7: 3302,
    8: 7,
    9: -4879,
    10: -5673,
    11: text("FS"),
    12: text("F2010000001"),
  };

  test("an SFP: thousandths of a dBm, millivolts, the wavelength in hundredths of a nm", () => {
    expect(
      parseMikroTikTransceivers({
        rows: table({ "25": ROW }),
        interfaces: interfaces([[25, "sfp1"]]),
      }),
    ).toEqual([
      {
        interfaceIndex: 25,
        vendor: "FS",
        serialNumber: "F2010000001",
        wavelengthNm: 850,
        measurements: {
          rxPower: { readings: [{ value: -5.67 }] },
          txPower: { readings: [{ value: -4.88 }] },
          temperature: { readings: [{ value: 40 }] },
          voltage: { readings: [{ value: 3.302 }] },
          biasCurrent: { readings: [{ value: 7 }] },
        },
        source: TransceiverMibSource.MikroTik,
      },
    ]);
  });

  test("an index that is not an interface the walk found is matched by name", () => {
    expect(
      parseMikroTikTransceivers({
        rows: table({ "25": ROW }),
        interfaces: interfaces([[3, "sfp1"]]),
      })[0]!.interfaceIndex,
    ).toBe(3);
  });

  test("loss of signal and transmitter fault are faults", () => {
    expect(
      parseMikroTikTransceivers({
        rows: table({ "25": { ...ROW, 3: 1, 4: 1 } }),
        interfaces: interfaces([[25, "sfp1"]]),
      })[0]!.faults,
    ).toEqual([TransceiverFault.RxLossOfSignal, TransceiverFault.TxFault]);
  });

  test("an empty cage reports zeros and no vendor, and is no optic", () => {
    expect(
      parseMikroTikTransceivers({
        rows: table({
          "26": { 2: text("sfp2"), 3: 1, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0 },
        }),
        interfaces: interfaces([[26, "sfp2"]]),
      }),
    ).toEqual([]);
  });
});

/*
 * HH3C-TRANSCEIVER-INFO-MIB, as HPE Comware 5900 and H3C switches report
 * it: readings in hundredths, thresholds in their own units, zeros for
 * thresholds the optic does not support, 2147483647 for an unreadable
 * value, and errors as BITS.
 */
describe("HH3C-TRANSCEIVER-INFO-MIB", () => {
  const ROW: Record<number, unknown> = {
    1: text("MM"),
    2: text("10G_BASE_SR_SFP"),
    3: 850,
    4: text("AVAGO"),
    5: text("CN292K3425"),
    8: 1,
    9: -251,
    12: -373,
    15: 37,
    16: 329,
    17: 612,
    // thousandths of a degree
    18: 75000,
    19: -5000,
    20: 70000,
    21: 0,
    // hundreds of microvolts
    22: 36300,
    23: 29700,
    24: 34650,
    25: 31350,
    // microamps
    26: 12000,
    27: 1000,
    28: 11000,
    29: 2000,
    // tenths of a microwatt: 1 mW, 0.0631 mW, ...
    30: 17783,
    31: 631,
    32: 10000,
    33: 1259,
    34: 17783,
    35: 145,
    36: 10000,
    37: 363,
    38: Buffer.from([0x00, 0x00, 0x00, 0x00]),
    40: text("02"),
    49: text("0231A0A8"),
  };

  test("an SFP+: readings in hundredths, thresholds from tenths of a microwatt", () => {
    expect(
      parseH3cTransceivers({
        rows: table({ "49": ROW }),
        interfaces: interfaces([[49, "Ten-GigabitEthernet1/0/49"]]),
      }),
    ).toEqual([
      {
        interfaceIndex: 49,
        vendor: "AVAGO",
        partNumber: "0231A0A8",
        serialNumber: "CN292K3425",
        revision: "02",
        type: "10G_BASE_SR_SFP",
        wavelengthNm: 850,
        measurements: {
          rxPower: {
            readings: [{ value: -3.73 }],
            thresholds: {
              lowAlarm: -18.39,
              lowWarning: -14.4,
              highWarning: 0,
              highAlarm: 2.5,
            },
          },
          txPower: {
            readings: [{ value: -2.51 }],
            thresholds: {
              lowAlarm: -12,
              lowWarning: -9,
              highWarning: 0,
              highAlarm: 2.5,
            },
          },
          temperature: {
            readings: [{ value: 37 }],
            thresholds: {
              lowAlarm: -5,
              lowWarning: 0,
              highWarning: 70,
              highAlarm: 75,
            },
          },
          voltage: {
            readings: [{ value: 3.29 }],
            thresholds: {
              lowAlarm: 2.97,
              lowWarning: 3.135,
              highWarning: 3.465,
              highAlarm: 3.63,
            },
          },
          biasCurrent: {
            readings: [{ value: 6.12 }],
            thresholds: {
              lowAlarm: 1,
              lowWarning: 2,
              highWarning: 11,
              highAlarm: 12,
            },
          },
        },
        source: TransceiverMibSource.H3cTransceiver,
      },
    ]);
  });

  test("newer agents' dBm thresholds win over the microwatt ones", () => {
    const result: SnmpTransceiverResult = parseH3cTransceivers({
      rows: table({
        "49": { ...ROW, 56: 50, 57: -1840, 58: -100, 59: -1440 },
      }),
      interfaces: interfaces([[49, "XGE1/0/49"]]),
    })[0]!;

    expect(result.measurements.rxPower?.thresholds).toEqual({
      lowAlarm: -18.4,
      lowWarning: -14.4,
      highWarning: -1,
      highAlarm: 0.5,
    });
  });

  test("zeros for 'not supported' are no thresholds", () => {
    const zeros: Record<number, unknown> = { ...ROW };
    for (let column: number = 18; column <= 37; column++) {
      zeros[column] = 0;
    }

    const result: SnmpTransceiverResult = parseH3cTransceivers({
      rows: table({ "49": zeros }),
      interfaces: interfaces([[49, "XGE1/0/49"]]),
    })[0]!;

    expect(result.measurements.temperature).toEqual({
      readings: [{ value: 37 }],
    });
    expect(result.measurements.rxPower?.thresholds).toBeUndefined();
  });

  test("an unreadable optic (2147483647) is present with nothing to read", () => {
    const unreadable: Record<number, unknown> = { ...ROW };
    for (const column of [9, 12, 15, 16, 17]) {
      unreadable[column] = 2147483647;
    }

    const result: SnmpTransceiverResult = parseH3cTransceivers({
      rows: table({ "50": unreadable }),
      interfaces: interfaces([[50, "XGE1/0/50"]]),
    })[0]!;

    expect(result.serialNumber).toBe("CN292K3425");
    expect(result.measurements).toEqual({});
  });

  test("the error bits name the faults", () => {
    expect(
      parseH3cTransceivers({
        rows: table({
          "49": { ...ROW, 38: Buffer.from([0x00, 0x08, 0x80, 0x00]) },
        }),
        interfaces: interfaces([[49, "XGE1/0/49"]]),
      })[0]!.faults,
    ).toEqual([TransceiverFault.RxLossOfSignal, TransceiverFault.TxFault]);
  });
});

/*
 * HP-ICF-TRANSCEIVER-MIB, as ArubaOS-Switch (ProCurve) reports it: readings
 * only for an optic that does DOM, power in thousandths of a dBm with
 * -99999999 for no light, power thresholds in tenths of a microwatt.
 */
describe("HP-ICF-TRANSCEIVER-MIB", () => {
  const ROW: Record<number, unknown> = {
    3: text("J9151A"),
    4: text("CN12345678"),
    5: text("SFP+LR"),
    7: text("1310nm"),
    9: 1,
    11: 41250,
    12: 33120,
    13: 25300,
    14: -2104,
    15: -3982,
    18: 75000,
    19: -5000,
    20: 70000,
    21: 0,
    22: 36300,
    23: 29700,
    24: 34650,
    25: 31350,
    26: 70000,
    27: 4000,
    28: 65000,
    29: 6000,
    30: 22387,
    31: 1514,
    32: 17783,
    33: 2399,
    34: 22387,
    35: 145,
    36: 17783,
    37: 363,
  };

  test("an optic with DOM", () => {
    expect(
      parseHpIcfTransceivers({
        rows: table({ "25": ROW }),
        interfaces: interfaces([[25, "25"]]),
      }),
    ).toEqual([
      {
        interfaceIndex: 25,
        partNumber: "J9151A",
        serialNumber: "CN12345678",
        type: "SFP+LR",
        wavelengthNm: 1310,
        measurements: {
          rxPower: {
            readings: [{ value: -3.98 }],
            thresholds: {
              lowAlarm: -18.39,
              lowWarning: -14.4,
              highWarning: 2.5,
              highAlarm: 3.5,
            },
          },
          txPower: {
            readings: [{ value: -2.1 }],
            thresholds: {
              lowAlarm: -8.2,
              lowWarning: -6.2,
              highWarning: 2.5,
              highAlarm: 3.5,
            },
          },
          temperature: {
            readings: [{ value: 41.25 }],
            thresholds: {
              lowAlarm: -5,
              lowWarning: 0,
              highWarning: 70,
              highAlarm: 75,
            },
          },
          voltage: {
            readings: [{ value: 3.312 }],
            thresholds: {
              lowAlarm: 2.97,
              lowWarning: 3.135,
              highWarning: 3.465,
              highAlarm: 3.63,
            },
          },
          biasCurrent: {
            readings: [{ value: 25.3 }],
            thresholds: {
              lowAlarm: 4,
              lowWarning: 6,
              highWarning: 65,
              highAlarm: 70,
            },
          },
        },
        source: TransceiverMibSource.HpIcfTransceiver,
      },
    ]);
  });

  test("-99999999 is no light at all: the -40 dBm floor", () => {
    expect(
      parseHpIcfTransceivers({
        rows: table({ "25": { ...ROW, 15: -99999999 } }),
        interfaces: interfaces([[25, "25"]]),
      })[0]!.measurements.rxPower?.readings,
    ).toEqual([{ value: -40 }]);
  });

  test("an optic without DOM is detected with nothing to read; copper has no wavelength", () => {
    expect(
      parseHpIcfTransceivers({
        rows: table({
          "26": { 3: text("J8177C"), 4: text("CN0000001"), 7: text("n/a"), 9: 0 },
        }),
        interfaces: interfaces([[26, "26"]]),
      }),
    ).toEqual([
      {
        interfaceIndex: 26,
        partNumber: "J8177C",
        serialNumber: "CN0000001",
        measurements: {},
        source: TransceiverMibSource.HpIcfTransceiver,
      },
    ]);
  });

  test("a voltage of zero is 'not reported'", () => {
    expect(
      parseHpIcfTransceivers({
        rows: table({ "25": { ...ROW, 12: 0 } }),
        interfaces: interfaces([[25, "25"]]),
      })[0]!.measurements.voltage,
    ).toBeUndefined();
  });
});

/*
 * CAMBIUM-NETWORKS-TRANSCEIVER-MIB (cnMatrix 4.5 and later): microwatts,
 * millivolts and microamps, -32768 for unknown, and no thresholds.
 */
describe("CAMBIUM-NETWORKS-TRANSCEIVER-MIB", () => {
  const ROW: Record<number, unknown> = {
    3: 6,
    4: 1310,
    5: text("Cambium Networks"),
    7: text("SFP-10G-LR"),
    8: text("A"),
    9: text("CN2234000123"),
    11: 38,
    12: 3290,
    13: 30500,
    14: 501,
    15: 398,
  };

  test("an SFP+: microwatts to dBm, millivolts, microamps", () => {
    expect(
      parseCambiumTransceivers({
        rows: table({ "52": ROW }),
        interfaces: interfaces([[52, "Te1/0/52"]]),
      }),
    ).toEqual([
      {
        interfaceIndex: 52,
        vendor: "Cambium Networks",
        partNumber: "SFP-10G-LR",
        serialNumber: "CN2234000123",
        revision: "A",
        type: "10GBASE-LR",
        wavelengthNm: 1310,
        measurements: {
          rxPower: { readings: [{ value: -4 }] },
          txPower: { readings: [{ value: -3 }] },
          temperature: { readings: [{ value: 38 }] },
          voltage: { readings: [{ value: 3.29 }] },
          biasCurrent: { readings: [{ value: 30.5 }] },
        },
        source: TransceiverMibSource.CambiumTransceiver,
      },
    ]);
  });

  test("a copper SFP's zero microwatts is not a dark fibre", () => {
    expect(
      parseCambiumTransceivers({
        rows: table({
          "51": {
            3: 1,
            5: text("Cambium Networks"),
            9: text("CU0001"),
            11: -32768,
            12: 0,
            14: 0,
            15: 0,
          },
        }),
        interfaces: interfaces([[51, "Gi1/0/51"]]),
      })[0]!.measurements,
    ).toEqual({});
  });

  test("an empty port reports nothing", () => {
    expect(
      parseCambiumTransceivers({
        rows: table({ "50": { 11: -32768, 12: 0 } }),
        interfaces: interfaces([[50, "Gi1/0/50"]]),
      }),
    ).toEqual([]);
  });
});

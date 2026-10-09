import {
  SnmpTransceiverResult,
  TransceiverFault,
  TransceiverMeasurement,
  TransceiverMeasurements,
  TransceiverMibSource,
  TransceiverReading,
  TransceiverReadingKind,
  TransceiverThresholds,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTransceiver";
import TransceiverUnitUtil from "Common/Utils/NetworkDevice/TransceiverUnitUtil";
import { SnmpTableRows } from "./EndpointTableParsers";

/*
 * Pure parsers for transceiver (SFP/SFP+/QSFP) digital optical monitoring.
 *
 * They read the row shape net-snmp's table walks produce - rows keyed by
 * the row index, each row keyed by column number as a string - and turn
 * every vendor's units into the display units of TRANSCEIVER_READING_UNITS
 * (degrees C, volts, milliamps, dBm), with the device's own thresholds in
 * the same units. Nothing here talks to a device, so every MIB's quirks are
 * pinned by unit tests against tables in the shape a real walk returns.
 *
 * Every OID below is taken from the published MIB module it names. Like
 * EndpointTableParsers, the constants are TABLE OIDs: the walker appends
 * the ".1" entry and the column number.
 */

// --- ENTITY-MIB (RFC 6933) ---

export const ENT_PHYSICAL_TABLE_OID: string = "1.3.6.1.2.1.47.1.1.1";
export const ENT_PHYSICAL_COLUMNS: {
  entPhysicalDescr: number;
  entPhysicalContainedIn: number;
  entPhysicalClass: number;
  entPhysicalName: number;
  entPhysicalHardwareRev: number;
  entPhysicalSerialNum: number;
  entPhysicalMfgName: number;
  entPhysicalModelName: number;
} = {
  entPhysicalDescr: 2,
  entPhysicalContainedIn: 4,
  entPhysicalClass: 5,
  entPhysicalName: 7,
  entPhysicalHardwareRev: 8,
  entPhysicalSerialNum: 11,
  entPhysicalMfgName: 12,
  entPhysicalModelName: 13,
};

/*
 * entAliasMappingTable: INDEX { entPhysicalIndex, entAliasLogicalIndexOrZero },
 * and entAliasMappingIdentifier is a RowPointer - for a port, the ifIndex
 * instance "ifIndex.<n>" (1.3.6.1.2.1.2.2.1.1.<n>).
 */
export const ENT_ALIAS_MAPPING_TABLE_OID: string = "1.3.6.1.2.1.47.1.3.2";
export const ENT_ALIAS_MAPPING_COLUMNS: { entAliasMappingIdentifier: number } =
  {
    entAliasMappingIdentifier: 2,
  };
const IF_INDEX_ROW_POINTER_PREFIX: string = "1.3.6.1.2.1.2.2.1.1.";

// IANAPhysicalClass values the transceiver search cares about.
const PHYSICAL_CLASS: {
  other: number;
  chassis: number;
  container: number;
  sensor: number;
  module: number;
  port: number;
  stack: number;
} = {
  other: 1,
  chassis: 3,
  container: 5,
  sensor: 8,
  module: 9,
  port: 10,
  stack: 11,
};

// --- ENTITY-SENSOR-MIB (RFC 3433) ---

export const ENT_PHY_SENSOR_TABLE_OID: string = "1.3.6.1.2.1.99.1.1";
export const ENT_PHY_SENSOR_COLUMNS: {
  type: number;
  scale: number;
  precision: number;
  value: number;
  status: number;
} = {
  type: 1,
  scale: 2,
  precision: 3,
  value: 4,
  status: 5,
};

// --- CISCO-ENTITY-SENSOR-MIB ---

export const CISCO_ENT_SENSOR_VALUE_TABLE_OID: string =
  "1.3.6.1.4.1.9.9.91.1.1.1";
// Same column numbers and enumerations as the RFC 3433 table.
export const CISCO_ENT_SENSOR_VALUE_COLUMNS: {
  type: number;
  scale: number;
  precision: number;
  value: number;
  status: number;
} = {
  type: 1,
  scale: 2,
  precision: 3,
  value: 4,
  status: 5,
};

/*
 * entSensorThresholdTable: INDEX { entPhysicalIndex, entSensorThresholdIndex },
 * one row per threshold, in the raw units of the sensor's value.
 */
export const CISCO_ENT_SENSOR_THRESHOLD_TABLE_OID: string =
  "1.3.6.1.4.1.9.9.91.1.2.1";
export const CISCO_ENT_SENSOR_THRESHOLD_COLUMNS: {
  severity: number;
  relation: number;
  value: number;
} = {
  severity: 2,
  relation: 3,
  value: 4,
};

// CSensorThresholdSeverity and SensorThresholdRelation.
const CISCO_THRESHOLD_SEVERITY: {
  other: number;
  minor: number;
  major: number;
  critical: number;
} = {
  other: 1,
  minor: 10,
  major: 20,
  critical: 30,
};
const CISCO_THRESHOLD_RELATION: {
  lessThan: number;
  lessOrEqual: number;
  greaterThan: number;
  greaterOrEqual: number;
} = {
  lessThan: 1,
  lessOrEqual: 2,
  greaterThan: 3,
  greaterOrEqual: 4,
};

// --- ARISTA-ENTITY-SENSOR-MIB ---

/*
 * aristaEntSensorThresholdTable augments entPhySensorTable (INDEX
 * { entPhysicalIndex }), in the raw units of entPhySensorValue; an
 * unsupported threshold reads as the EntitySensorValue underflow/overflow.
 */
export const ARISTA_ENT_SENSOR_THRESHOLD_TABLE_OID: string =
  "1.3.6.1.4.1.30065.3.12.1.1";
export const ARISTA_ENT_SENSOR_THRESHOLD_COLUMNS: {
  lowWarning: number;
  lowCritical: number;
  highWarning: number;
  highCritical: number;
} = {
  lowWarning: 1,
  lowCritical: 2,
  highWarning: 3,
  highCritical: 4,
};

// EntitySensorDataType (RFC 3433) / SensorDataType (Cisco).
const SENSOR_TYPE: {
  voltsDC: number;
  amperes: number;
  watts: number;
  celsius: number;
  // CISCO-ENTITY-SENSOR-MIB only (revision 200301070000Z).
  dBm: number;
} = {
  voltsDC: 4,
  amperes: 5,
  watts: 6,
  celsius: 8,
  dBm: 14,
};

// EntitySensorStatus / SensorStatus: ok(1).
const SENSOR_STATUS_OK: number = 1;

// --- JUNIPER-DOM-MIB ---

export const JNX_DOM_CURRENT_TABLE_OID: string =
  "1.3.6.1.4.1.2636.3.60.1.1.1";
export const JNX_DOM_CURRENT_COLUMNS: {
  rxPower: number;
  txBias: number;
  txPower: number;
  temperature: number;
  rxPowerHighAlarm: number;
  rxPowerLowAlarm: number;
  rxPowerHighWarning: number;
  rxPowerLowWarning: number;
  txBiasHighAlarm: number;
  txBiasLowAlarm: number;
  txBiasHighWarning: number;
  txBiasLowWarning: number;
  txPowerHighAlarm: number;
  txPowerLowAlarm: number;
  txPowerHighWarning: number;
  txPowerLowWarning: number;
  temperatureHighAlarm: number;
  temperatureLowAlarm: number;
  temperatureHighWarning: number;
  temperatureLowWarning: number;
  voltage: number;
  voltageHighAlarm: number;
  voltageLowAlarm: number;
  voltageHighWarning: number;
  voltageLowWarning: number;
  laneCount: number;
} = {
  rxPower: 5,
  txBias: 6,
  txPower: 7,
  temperature: 8,
  rxPowerHighAlarm: 9,
  rxPowerLowAlarm: 10,
  rxPowerHighWarning: 11,
  rxPowerLowWarning: 12,
  txBiasHighAlarm: 13,
  txBiasLowAlarm: 14,
  txBiasHighWarning: 15,
  txBiasLowWarning: 16,
  txPowerHighAlarm: 17,
  txPowerLowAlarm: 18,
  txPowerHighWarning: 19,
  txPowerLowWarning: 20,
  temperatureHighAlarm: 21,
  temperatureLowAlarm: 22,
  temperatureHighWarning: 23,
  temperatureLowWarning: 24,
  voltage: 25,
  voltageHighAlarm: 26,
  voltageLowAlarm: 27,
  voltageHighWarning: 28,
  voltageLowWarning: 29,
  laneCount: 30,
};

// jnxDomModuleLaneTable: INDEX { ifIndex, jnxDomLaneIndex }.
export const JNX_DOM_LANE_TABLE_OID: string = "1.3.6.1.4.1.2636.3.60.1.2.1";
export const JNX_DOM_LANE_COLUMNS: {
  rxPower: number;
  txBias: number;
  txPower: number;
} = {
  rxPower: 6,
  txBias: 7,
  txPower: 8,
};

// --- MIKROTIK-MIB ---

// mtxrOpticalTable, indexed by the interface index.
export const MTXR_OPTICAL_TABLE_OID: string = "1.3.6.1.4.1.14988.1.1.19.1";
export const MTXR_OPTICAL_COLUMNS: {
  name: number;
  rxLoss: number;
  txFault: number;
  wavelength: number;
  temperature: number;
  supplyVoltage: number;
  txBiasCurrent: number;
  txPower: number;
  rxPower: number;
  vendorName: number;
  vendorSerial: number;
} = {
  name: 2,
  rxLoss: 3,
  txFault: 4,
  wavelength: 5,
  temperature: 6,
  supplyVoltage: 7,
  txBiasCurrent: 8,
  txPower: 9,
  rxPower: 10,
  vendorName: 11,
  vendorSerial: 12,
};

// --- HH3C-TRANSCEIVER-INFO-MIB (HPE Comware, H3C) ---

export const HH3C_TRANSCEIVER_INFO_TABLE_OID: string =
  "1.3.6.1.4.1.25506.2.70.1.1";
export const HH3C_TRANSCEIVER_COLUMNS: {
  hardwareType: number;
  type: number;
  waveLength: number;
  vendorName: number;
  serialNumber: number;
  diagnostic: number;
  curTxPower: number;
  curRxPower: number;
  temperature: number;
  voltage: number;
  biasCurrent: number;
  tempHiAlarm: number;
  tempLoAlarm: number;
  tempHiWarn: number;
  tempLoWarn: number;
  vccHiAlarm: number;
  vccLoAlarm: number;
  vccHiWarn: number;
  vccLoWarn: number;
  biasHiAlarm: number;
  biasLoAlarm: number;
  biasHiWarn: number;
  biasLoWarn: number;
  pwrOutHiAlarm: number;
  pwrOutLoAlarm: number;
  pwrOutHiWarn: number;
  pwrOutLoWarn: number;
  rcvPwrHiAlarm: number;
  rcvPwrLoAlarm: number;
  rcvPwrHiWarn: number;
  rcvPwrLoWarn: number;
  errors: number;
  revisionNumber: number;
  partNumber: number;
  pwrOutHiAlarmDbm: number;
  pwrOutLoAlarmDbm: number;
  pwrOutHiWarnDbm: number;
  pwrOutLoWarnDbm: number;
  rcvPwrHiAlarmDbm: number;
  rcvPwrLoAlarmDbm: number;
  rcvPwrHiWarnDbm: number;
  rcvPwrLoWarnDbm: number;
} = {
  hardwareType: 1,
  type: 2,
  waveLength: 3,
  vendorName: 4,
  serialNumber: 5,
  diagnostic: 8,
  curTxPower: 9,
  curRxPower: 12,
  temperature: 15,
  voltage: 16,
  biasCurrent: 17,
  tempHiAlarm: 18,
  tempLoAlarm: 19,
  tempHiWarn: 20,
  tempLoWarn: 21,
  vccHiAlarm: 22,
  vccLoAlarm: 23,
  vccHiWarn: 24,
  vccLoWarn: 25,
  biasHiAlarm: 26,
  biasLoAlarm: 27,
  biasHiWarn: 28,
  biasLoWarn: 29,
  pwrOutHiAlarm: 30,
  pwrOutLoAlarm: 31,
  pwrOutHiWarn: 32,
  pwrOutLoWarn: 33,
  rcvPwrHiAlarm: 34,
  rcvPwrLoAlarm: 35,
  rcvPwrHiWarn: 36,
  rcvPwrLoWarn: 37,
  errors: 38,
  revisionNumber: 40,
  partNumber: 49,
  pwrOutHiAlarmDbm: 52,
  pwrOutLoAlarmDbm: 53,
  pwrOutHiWarnDbm: 54,
  pwrOutLoWarnDbm: 55,
  rcvPwrHiAlarmDbm: 56,
  rcvPwrLoAlarmDbm: 57,
  rcvPwrHiWarnDbm: 58,
  rcvPwrLoWarnDbm: 59,
};

// hh3cTransceiverErrors BITS: txFault(12), rxLossOfSignal(16).
const HH3C_ERROR_BIT_TX_FAULT: number = 12;
const HH3C_ERROR_BIT_RX_LOSS_OF_SIGNAL: number = 16;

// --- HP-ICF-TRANSCEIVER-MIB (HPE Aruba ProCurve / ArubaOS-Switch) ---

export const HPICF_XCVR_INFO_TABLE_OID: string =
  "1.3.6.1.4.1.11.2.14.11.5.1.82.1.1.1";
export const HPICF_XCVR_COLUMNS: {
  model: number;
  serial: number;
  type: number;
  wavelength: number;
  diagnostics: number;
  temperature: number;
  voltage: number;
  bias: number;
  txPower: number;
  rxPower: number;
  tempHiAlarm: number;
  tempLoAlarm: number;
  tempHiWarn: number;
  tempLoWarn: number;
  vccHiAlarm: number;
  vccLoAlarm: number;
  vccHiWarn: number;
  vccLoWarn: number;
  biasHiAlarm: number;
  biasLoAlarm: number;
  biasHiWarn: number;
  biasLoWarn: number;
  pwrOutHiAlarm: number;
  pwrOutLoAlarm: number;
  pwrOutHiWarn: number;
  pwrOutLoWarn: number;
  rcvPwrHiAlarm: number;
  rcvPwrLoAlarm: number;
  rcvPwrHiWarn: number;
  rcvPwrLoWarn: number;
} = {
  model: 3,
  serial: 4,
  type: 5,
  wavelength: 7,
  diagnostics: 9,
  temperature: 11,
  voltage: 12,
  bias: 13,
  txPower: 14,
  rxPower: 15,
  tempHiAlarm: 18,
  tempLoAlarm: 19,
  tempHiWarn: 20,
  tempLoWarn: 21,
  vccHiAlarm: 22,
  vccLoAlarm: 23,
  vccHiWarn: 24,
  vccLoWarn: 25,
  biasHiAlarm: 26,
  biasLoAlarm: 27,
  biasHiWarn: 28,
  biasLoWarn: 29,
  pwrOutHiAlarm: 30,
  pwrOutLoAlarm: 31,
  pwrOutHiWarn: 32,
  pwrOutLoWarn: 33,
  rcvPwrHiAlarm: 34,
  rcvPwrLoAlarm: 35,
  rcvPwrHiWarn: 36,
  rcvPwrLoWarn: 37,
};

// hpicfXcvrDiagnostics: dom(1).
const HPICF_DIAGNOSTICS_DOM: number = 1;
// "-inf dBm (0 microwatts) will be reported as -99999999."
const HPICF_NO_LIGHT: number = -99999999;

// --- CAMBIUM-NETWORKS-TRANSCEIVER-MIB (cnMatrix) ---

// cnTransceiverPortTable, indexed by the interface index.
export const CN_TRANSCEIVER_PORT_TABLE_OID: string =
  "1.3.6.1.4.1.2076.81.18.1.1.11";
export const CN_TRANSCEIVER_COLUMNS: {
  type: number;
  wavelength: number;
  vendorName: number;
  vendorPartNo: number;
  vendorRevision: number;
  vendorSerial: number;
  temperature: number;
  voltage: number;
  txBias: number;
  txPower: number;
  rxPower: number;
} = {
  type: 3,
  wavelength: 4,
  vendorName: 5,
  vendorPartNo: 7,
  vendorRevision: 8,
  vendorSerial: 9,
  temperature: 11,
  voltage: 12,
  txBias: 13,
  txPower: 14,
  rxPower: 15,
};

// cnTransceiverType.
const CN_TRANSCEIVER_TYPES: Record<number, string> = {
  1: "1000BASE-T",
  2: "1000BASE-CX",
  3: "1000BASE-LX",
  4: "1000BASE-SX",
  5: "10GBASE-SR",
  6: "10GBASE-LR",
  7: "10GBASE-ER",
  8: "10GBASE-LRM",
  9: "10GBASE-SW",
  10: "10GBASE-LW",
  11: "10GBASE-EW",
};

// --- Values ---

const PRINTABLE_TEXT_REGEX: RegExp = /[^\x20-\x7e]/g;
const WHITESPACE_REGEX: RegExp = /\s+/;
const NUMBER_PREFIX_REGEX: RegExp = /-?\d+(\.\d+)?/;

export function readNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (Buffer.isBuffer(value)) {
    // Counter64 / Gauge values arrive as big-endian buffers.
    if (value.length === 0 || value.length > 6) {
      return undefined;
    }
    return value.readUIntBE(0, value.length);
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed: number = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

/*
 * A text column, cleaned: optic EEPROMs pad their vendor and part fields
 * with spaces and NULs, and a few agents return binary noise for an empty
 * field.
 */
export function readText(value: unknown): string | undefined {
  let text: string | undefined = undefined;

  if (Buffer.isBuffer(value)) {
    text = value.toString("latin1");
  } else if (typeof value === "string") {
    text = value;
  } else if (typeof value === "number") {
    text = value.toString();
  }

  if (text === undefined) {
    return undefined;
  }

  const cleaned: string = text.replace(PRINTABLE_TEXT_REGEX, " ").trim();

  return cleaned ? cleaned.substring(0, 100) : undefined;
}

// A RowPointer / OBJECT IDENTIFIER value as a dotted string.
function readOid(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim().replace(/^\./, "") || undefined;
  }

  if (Buffer.isBuffer(value)) {
    return readOid(value.toString("latin1"));
  }

  return undefined;
}

function rawOrUndefined(value: unknown): number | undefined {
  const raw: number | undefined = readNumber(value);

  return raw === undefined || TransceiverUnitUtil.isUnavailableRawValue(raw)
    ? undefined
    : raw;
}

function fixedPoint(value: unknown, decimals: number): number | undefined {
  const raw: number | undefined = rawOrUndefined(value);
  return raw === undefined
    ? undefined
    : TransceiverUnitUtil.fromFixedPoint(raw, decimals);
}

function dbmFixedPoint(value: unknown, decimals: number): number | undefined {
  const dbm: number | undefined = fixedPoint(value, decimals);
  return dbm === undefined ? undefined : TransceiverUnitUtil.clampDbm(dbm);
}

function thresholdsFrom(data: {
  lowAlarm?: number | undefined;
  lowWarning?: number | undefined;
  highWarning?: number | undefined;
  highAlarm?: number | undefined;
}): TransceiverThresholds | undefined {
  const thresholds: TransceiverThresholds = {};

  if (data.lowAlarm !== undefined) {
    thresholds.lowAlarm = data.lowAlarm;
  }
  if (data.lowWarning !== undefined) {
    thresholds.lowWarning = data.lowWarning;
  }
  if (data.highWarning !== undefined) {
    thresholds.highWarning = data.highWarning;
  }
  if (data.highAlarm !== undefined) {
    thresholds.highAlarm = data.highAlarm;
  }

  return Object.keys(thresholds).length > 0 ? thresholds : undefined;
}

function setMeasurement(
  measurements: TransceiverMeasurements,
  kind: TransceiverReadingKind,
  value: number | undefined,
  thresholds?: TransceiverThresholds | undefined,
): void {
  if (value === undefined) {
    return;
  }

  measurements[kind] = {
    readings: [{ value: value }],
    ...(thresholds ? { thresholds: thresholds } : {}),
  };
}

function column(row: Record<string, unknown>, columnNumber: number): unknown {
  return row[columnNumber.toString()];
}

// --- Interfaces ---

// A walked interface and every name it goes by: ifName, ifDescr, ifAlias.
export interface TransceiverInterfaceCandidate {
  interfaceIndex: number;
  names: Array<string | undefined>;
}

/*
 * Long interface-name prefixes and the short forms the same platforms use
 * elsewhere: Cisco's entPhysicalName says "TenGigabitEthernet1/1/1" while
 * its ifName says "Te1/1/1", and Arista's transceiver is "Xcvr for
 * Ethernet1" while a Nexus ifName is "Eth1/1".
 */
const INTERFACE_PREFIX_SHORT_FORMS: Record<string, string> = {
  fourhundredgige: "fh",
  twohundredgige: "th",
  hundredgigabitethernet: "hu",
  hundredgige: "hu",
  fiftygigabitethernet: "fi",
  fiftygige: "fi",
  fortygigabitethernet: "fo",
  fortygige: "fo",
  twentyfivegigabitethernet: "twe",
  twentyfivegige: "twe",
  tengigabitethernet: "te",
  tengige: "te",
  fivegigabitethernet: "fi",
  twogigabitethernet: "tw",
  appgigabitethernet: "ap",
  gigabitethernet: "gi",
  fastethernet: "fa",
  ethernet: "et",
  eth: "et",
};

const INTERFACE_NAME_PARTS_REGEX: RegExp = /^([a-z][a-z-]*?)-?\s*(\d.*)$/;
const NAME_FOR_SUFFIX_REGEX: RegExp = /\bfor\s+(\S+)\s*$/i;

/*
 * One spelling for every way a port is named: lower case, no spaces, and
 * the long Cisco-style prefixes folded to their short forms.
 */
export function canonicalInterfaceName(name: string | undefined): string {
  const compact: string = (name || "").trim().toLowerCase().replace(/\s+/g, "");

  if (!compact) {
    return "";
  }

  const parts: RegExpMatchArray | null = compact.match(
    INTERFACE_NAME_PARTS_REGEX,
  );

  if (!parts || !parts[1] || !parts[2]) {
    return compact;
  }

  const prefix: string = parts[1];
  const shortForm: string | undefined = INTERFACE_PREFIX_SHORT_FORMS[prefix];

  return shortForm ? `${shortForm}${parts[2]}` : compact;
}

// The names a transceiver's labels might be pointing at.
export function interfaceNameCandidates(text: string | undefined): Array<string> {
  const trimmed: string = (text || "").trim();

  if (!trimmed) {
    return [];
  }

  const candidates: Array<string> = [trimmed];

  // Arista: "Xcvr for Ethernet1", "DOM RX Power Sensor for Ethernet1".
  const forSuffix: RegExpMatchArray | null = trimmed.match(
    NAME_FOR_SUFFIX_REGEX,
  );
  if (forSuffix && forSuffix[1]) {
    candidates.push(forSuffix[1]);
  }

  // Cisco: "Gi1/0/52 Module Temperature Sensor", "Te1/1/1 Transceiver".
  const firstToken: string | undefined = trimmed.split(WHITESPACE_REGEX)[0];
  if (firstToken) {
    candidates.push(firstToken);
  }

  return Array.from(new Set(candidates));
}

export class TransceiverInterfaceIndex {
  private readonly indexes: Set<number> = new Set<number>();
  private readonly byCanonicalName: Map<string, number> = new Map();

  public constructor(interfaces: Array<TransceiverInterfaceCandidate>) {
    for (const candidate of interfaces) {
      this.indexes.add(candidate.interfaceIndex);

      for (const name of candidate.names) {
        const key: string = canonicalInterfaceName(name);

        if (key && !this.byCanonicalName.has(key)) {
          this.byCanonicalName.set(key, candidate.interfaceIndex);
        }
      }
    }
  }

  public hasInterface(interfaceIndex: number): boolean {
    return this.indexes.has(interfaceIndex);
  }

  /*
   * The interface a label names, if any. A QSFP split into breakout ports
   * (Ethernet49/1 ... Ethernet49/4) is reported once for the whole cage
   * ("Xcvr for Ethernet49"), and is attached to the first of its ports.
   */
  public findByName(text: string | undefined): number | undefined {
    for (const candidate of interfaceNameCandidates(text)) {
      const key: string = canonicalInterfaceName(candidate);

      if (!key) {
        continue;
      }

      const exact: number | undefined = this.byCanonicalName.get(key);

      if (exact !== undefined) {
        return exact;
      }

      const breakoutKeys: Array<string> = Array.from(
        this.byCanonicalName.keys(),
      )
        .filter((name: string) => {
          return name.startsWith(`${key}/`);
        })
        .sort((a: string, b: string) => {
          return a.localeCompare(b, undefined, { numeric: true });
        });

      if (breakoutKeys.length > 0) {
        return this.byCanonicalName.get(breakoutKeys[0]!);
      }
    }

    return undefined;
  }
}

// --- ENTITY-SENSOR-MIB / CISCO-ENTITY-SENSOR-MIB ---

export type EntitySensorFlavor = "standard" | "cisco" | "arista";

/*
 * What tells a transceiver apart from the line card or power controller
 * whose sensors sit next to it in the entity tree.
 */
const TRANSCEIVER_TEXT_REGEX: RegExp =
  /\b(sfp|sfp\+|sfp28|sfp56|xfp|qsfp|qsfp\+|qsfp28|qsfp56|qsfp-dd|osfp|cfp\d?|gbic|xcvr|transceiver)|(sfp|qsfp|xfp|gbic)\b|\b\d+(g|m)?base-?[a-z]/i;
const LANE_TEXT_REGEX: RegExp = /\blane\s*(\d+)\b/i;
const TX_TEXT_REGEX: RegExp = /(\btx|transmit|output)/i;
const RX_TEXT_REGEX: RegExp = /(\brx|receive|input)/i;
// A description that labels the module rather than saying what it is.
const LABEL_DESCRIPTION_REGEX: RegExp = /^(xcvr|transceiver|dom)\b|\bfor\s/i;

interface EntityRow {
  index: string;
  descr?: string | undefined;
  name?: string | undefined;
  containedIn?: string | undefined;
  physicalClass?: number | undefined;
  hardwareRev?: string | undefined;
  serial?: string | undefined;
  mfgName?: string | undefined;
  modelName?: string | undefined;
}

export interface EntitySensorTransceiverInput {
  flavor: EntitySensorFlavor;
  // The sensor table: entPhySensorTable or Cisco's entSensorValueTable.
  sensorRows: SnmpTableRows;
  // entPhysicalTable, with the columns of ENT_PHYSICAL_COLUMNS.
  entityRows: SnmpTableRows;
  // entAliasMappingTable, when it was walked.
  aliasRows?: SnmpTableRows | undefined;
  /*
   * Cisco's entSensorThresholdTable (rows "sensor.threshold") or Arista's
   * aristaEntSensorThresholdTable (rows "sensor"), per the flavor.
   */
  thresholdRows?: SnmpTableRows | undefined;
  interfaces: TransceiverInterfaceIndex;
}

function toEntityRows(rows: SnmpTableRows): Map<string, EntityRow> {
  const entities: Map<string, EntityRow> = new Map();

  for (const index of Object.keys(rows)) {
    const row: Record<string, unknown> = rows[index] || {};
    const containedIn: number | undefined = readNumber(
      column(row, ENT_PHYSICAL_COLUMNS.entPhysicalContainedIn),
    );

    entities.set(index, {
      index: index,
      descr: readText(column(row, ENT_PHYSICAL_COLUMNS.entPhysicalDescr)),
      name: readText(column(row, ENT_PHYSICAL_COLUMNS.entPhysicalName)),
      containedIn:
        containedIn !== undefined && containedIn > 0
          ? containedIn.toString()
          : undefined,
      physicalClass: readNumber(
        column(row, ENT_PHYSICAL_COLUMNS.entPhysicalClass),
      ),
      hardwareRev: readText(
        column(row, ENT_PHYSICAL_COLUMNS.entPhysicalHardwareRev),
      ),
      serial: readText(column(row, ENT_PHYSICAL_COLUMNS.entPhysicalSerialNum)),
      mfgName: readText(column(row, ENT_PHYSICAL_COLUMNS.entPhysicalMfgName)),
      modelName: readText(
        column(row, ENT_PHYSICAL_COLUMNS.entPhysicalModelName),
      ),
    });
  }

  return entities;
}

function entityText(entity: EntityRow | undefined): string {
  return [entity?.name, entity?.descr].filter(Boolean).join(" ");
}

function isLaneEntity(entity: EntityRow): boolean {
  return (
    LANE_TEXT_REGEX.test(entity.name || "") ||
    LANE_TEXT_REGEX.test(entity.descr || "")
  );
}

function laneNumberOf(text: string | undefined): number | undefined {
  const match: RegExpMatchArray | null = (text || "").match(LANE_TEXT_REGEX);
  return match && match[1] !== undefined ? parseInt(match[1], 10) : undefined;
}

function looksLikeTransceiver(entity: EntityRow): boolean {
  return TRANSCEIVER_TEXT_REGEX.test(
    [entity.name, entity.descr, entity.modelName].filter(Boolean).join(" "),
  );
}

/*
 * The entity a sensor belongs to: its nearest ancestor that is not a lane.
 * Arista hangs a QSFP's per-lane sensors under "Lane N for Xcvr for
 * EthernetX", and the lane, not the module, is their parent.
 */
function findOwner(
  sensorIndex: string,
  entities: Map<string, EntityRow>,
): { owner: EntityRow; lane?: number | undefined } | undefined {
  const sensor: EntityRow | undefined = entities.get(sensorIndex);
  let lane: number | undefined = laneNumberOf(entityText(sensor));
  let parentIndex: string | undefined = sensor?.containedIn;

  for (let depth: number = 0; parentIndex && depth < 8; depth++) {
    const parent: EntityRow | undefined = entities.get(parentIndex);

    if (!parent) {
      return undefined;
    }

    if (isLaneEntity(parent)) {
      if (lane === undefined) {
        lane = laneNumberOf(entityText(parent));
      }
      parentIndex = parent.containedIn;
      continue;
    }

    return { owner: parent, ...(lane !== undefined ? { lane: lane } : {}) };
  }

  return undefined;
}

function aliasMappings(
  aliasRows: SnmpTableRows | undefined,
): Map<string, number> {
  const byEntity: Map<string, number> = new Map();

  for (const rowIndex of Object.keys(aliasRows || {})) {
    const pointer: string | undefined = readOid(
      column(
        aliasRows![rowIndex] || {},
        ENT_ALIAS_MAPPING_COLUMNS.entAliasMappingIdentifier,
      ),
    );

    if (!pointer || !pointer.startsWith(IF_INDEX_ROW_POINTER_PREFIX)) {
      continue;
    }

    const interfaceIndex: number = parseInt(
      pointer.substring(IF_INDEX_ROW_POINTER_PREFIX.length),
      10,
    );
    const [entityIndex, logicalIndex] = rowIndex.split(".");

    if (!entityIndex || isNaN(interfaceIndex)) {
      continue;
    }

    /*
     * The zero logical index is the mapping for every logical entity; a
     * non-zero one only for its own. Prefer the general one.
     */
    if (!byEntity.has(entityIndex) || logicalIndex === "0") {
      byEntity.set(entityIndex, interfaceIndex);
    }
  }

  return byEntity;
}

/*
 * The port a transceiver plugs into: the alias mapping of the module
 * itself (Cisco models the optic as the port), of a port inside it or of
 * the port it sits in; otherwise the interface its labels name.
 */
function findInterfaceIndex(data: {
  owner: EntityRow;
  sensorTexts: Array<string>;
  entities: Map<string, EntityRow>;
  childrenByParent: Map<string, Array<EntityRow>>;
  aliases: Map<string, number>;
  interfaces: TransceiverInterfaceIndex;
}): number | undefined {
  const fromAlias: (entity: EntityRow | undefined) => number | undefined = (
    entity: EntityRow | undefined,
  ): number | undefined => {
    if (!entity) {
      return undefined;
    }
    const mapped: number | undefined = data.aliases.get(entity.index);
    return mapped !== undefined && data.interfaces.hasInterface(mapped)
      ? mapped
      : undefined;
  };

  const ownAlias: number | undefined = fromAlias(data.owner);
  if (ownAlias !== undefined) {
    return ownAlias;
  }

  for (const child of data.childrenByParent.get(data.owner.index) || []) {
    if (child.physicalClass === PHYSICAL_CLASS.port) {
      const childAlias: number | undefined = fromAlias(child);
      if (childAlias !== undefined) {
        return childAlias;
      }
    }
  }

  const parent: EntityRow | undefined = data.owner.containedIn
    ? data.entities.get(data.owner.containedIn)
    : undefined;

  if (parent && parent.physicalClass === PHYSICAL_CLASS.port) {
    const parentAlias: number | undefined = fromAlias(parent);
    if (parentAlias !== undefined) {
      return parentAlias;
    }
  }

  for (const text of [
    data.owner.name,
    data.owner.descr,
    parent?.physicalClass === PHYSICAL_CLASS.port ? parent.name : undefined,
    ...data.sensorTexts,
  ]) {
    const byName: number | undefined = data.interfaces.findByName(text);
    if (byName !== undefined) {
      return byName;
    }
  }

  return undefined;
}

function entitySensorKind(data: {
  type: number;
  flavor: EntitySensorFlavor;
  text: string;
}): TransceiverReadingKind | undefined {
  switch (data.type) {
    case SENSOR_TYPE.celsius:
      return TransceiverReadingKind.Temperature;
    case SENSOR_TYPE.voltsDC:
      return TransceiverReadingKind.Voltage;
    case SENSOR_TYPE.amperes:
      return TransceiverReadingKind.BiasCurrent;
    case SENSOR_TYPE.watts:
    case SENSOR_TYPE.dBm: {
      if (data.type === SENSOR_TYPE.dBm && data.flavor !== "cisco") {
        return undefined;
      }

      const isTx: boolean = TX_TEXT_REGEX.test(data.text);
      const isRx: boolean = RX_TEXT_REGEX.test(data.text);

      if (isTx === isRx) {
        return undefined;
      }

      return isTx
        ? TransceiverReadingKind.TxPower
        : TransceiverReadingKind.RxPower;
    }
    default:
      return undefined;
  }
}

/*
 * A raw sensor value (or a threshold, which shares its units) in display
 * units: degrees C, volts, milliamps, dBm. Watts become dBm through
 * milliwatts; Cisco's dBm sensors are dBm already.
 */
function entitySensorDisplayValue(data: {
  raw: number;
  type: number;
  scale: number | undefined;
  precision: number | undefined;
}): number | undefined {
  if (TransceiverUnitUtil.isUnavailableRawValue(data.raw)) {
    return undefined;
  }

  const si: number = TransceiverUnitUtil.fromEntitySensorValue({
    raw: data.raw,
    scale: data.scale,
    precision: data.precision,
  });

  switch (data.type) {
    case SENSOR_TYPE.celsius:
      return TransceiverUnitUtil.roundTo(si, 2);
    case SENSOR_TYPE.voltsDC:
      return TransceiverUnitUtil.roundTo(si, 3);
    case SENSOR_TYPE.amperes:
      return TransceiverUnitUtil.roundTo(si * 1000, 3);
    case SENSOR_TYPE.watts:
      return TransceiverUnitUtil.milliwattsToDbm(si * 1000);
    case SENSOR_TYPE.dBm:
      return TransceiverUnitUtil.clampDbm(si);
    default:
      return undefined;
  }
}

function ciscoThresholds(data: {
  sensorIndex: string;
  thresholdRows: SnmpTableRows | undefined;
  convert: (raw: number) => number | undefined;
}): TransceiverThresholds | undefined {
  const highs: { warning: Array<number>; alarm: Array<number> } = {
    warning: [],
    alarm: [],
  };
  const lows: { warning: Array<number>; alarm: Array<number> } = {
    warning: [],
    alarm: [],
  };

  for (const rowIndex of Object.keys(data.thresholdRows || {})) {
    if (!rowIndex.startsWith(`${data.sensorIndex}.`)) {
      continue;
    }

    const row: Record<string, unknown> = data.thresholdRows![rowIndex] || {};
    const severity: number | undefined = readNumber(
      column(row, CISCO_ENT_SENSOR_THRESHOLD_COLUMNS.severity),
    );
    const relation: number | undefined = readNumber(
      column(row, CISCO_ENT_SENSOR_THRESHOLD_COLUMNS.relation),
    );
    const raw: number | undefined = readNumber(
      column(row, CISCO_ENT_SENSOR_THRESHOLD_COLUMNS.value),
    );

    if (severity === undefined || relation === undefined || raw === undefined) {
      continue;
    }

    const value: number | undefined = data.convert(raw);

    if (value === undefined) {
      continue;
    }

    const level: "warning" | "alarm" | undefined =
      severity === CISCO_THRESHOLD_SEVERITY.minor
        ? "warning"
        : severity === CISCO_THRESHOLD_SEVERITY.major ||
            severity === CISCO_THRESHOLD_SEVERITY.critical
          ? "alarm"
          : undefined;

    if (!level) {
      continue;
    }

    if (
      relation === CISCO_THRESHOLD_RELATION.greaterThan ||
      relation === CISCO_THRESHOLD_RELATION.greaterOrEqual
    ) {
      highs[level].push(value);
    } else if (
      relation === CISCO_THRESHOLD_RELATION.lessThan ||
      relation === CISCO_THRESHOLD_RELATION.lessOrEqual
    ) {
      lows[level].push(value);
    }
  }

  /*
   * Two alarm thresholds on one side (major and critical) mean the first one
   * crossed is already an alarm: keep the one nearer to normal.
   */
  return thresholdsFrom({
    highAlarm: highs.alarm.length > 0 ? Math.min(...highs.alarm) : undefined,
    highWarning:
      highs.warning.length > 0 ? Math.min(...highs.warning) : undefined,
    lowAlarm: lows.alarm.length > 0 ? Math.max(...lows.alarm) : undefined,
    lowWarning: lows.warning.length > 0 ? Math.max(...lows.warning) : undefined,
  });
}

function aristaThresholds(data: {
  sensorIndex: string;
  thresholdRows: SnmpTableRows | undefined;
  convert: (raw: number) => number | undefined;
}): TransceiverThresholds | undefined {
  const row: Record<string, unknown> | undefined =
    data.thresholdRows?.[data.sensorIndex];

  if (!row) {
    return undefined;
  }

  const read: (columnNumber: number) => number | undefined = (
    columnNumber: number,
  ): number | undefined => {
    const raw: number | undefined = readNumber(column(row, columnNumber));
    return raw === undefined ? undefined : data.convert(raw);
  };

  return thresholdsFrom({
    lowWarning: read(ARISTA_ENT_SENSOR_THRESHOLD_COLUMNS.lowWarning),
    lowAlarm: read(ARISTA_ENT_SENSOR_THRESHOLD_COLUMNS.lowCritical),
    highWarning: read(ARISTA_ENT_SENSOR_THRESHOLD_COLUMNS.highWarning),
    highAlarm: read(ARISTA_ENT_SENSOR_THRESHOLD_COLUMNS.highCritical),
  });
}

/*
 * The sensor indexes that can be transceiver readings: the types a DOM
 * reading comes in. The walker uses this to decide whether the rest of the
 * entity tree is worth walking at all.
 */
export function domSensorIndexes(
  sensorRows: SnmpTableRows,
  flavor: EntitySensorFlavor,
): Array<string> {
  const types: Array<number> = [
    SENSOR_TYPE.celsius,
    SENSOR_TYPE.voltsDC,
    SENSOR_TYPE.amperes,
    SENSOR_TYPE.watts,
    ...(flavor === "cisco" ? [SENSOR_TYPE.dBm] : []),
  ];

  return Object.keys(sensorRows).filter((index: string) => {
    const type: number | undefined = readNumber(
      column(sensorRows[index] || {}, ENT_PHY_SENSOR_COLUMNS.type),
    );
    return type !== undefined && types.includes(type);
  });
}

// Whether any sensor could be an optical power reading.
export function hasOpticalPowerSensor(
  sensorRows: SnmpTableRows,
  flavor: EntitySensorFlavor,
): boolean {
  return Object.keys(sensorRows).some((index: string) => {
    const type: number | undefined = readNumber(
      column(sensorRows[index] || {}, ENT_PHY_SENSOR_COLUMNS.type),
    );
    return (
      type === SENSOR_TYPE.watts ||
      (flavor === "cisco" && type === SENSOR_TYPE.dBm)
    );
  });
}

interface OwnerAccumulator {
  owner: EntityRow;
  measurements: TransceiverMeasurements;
  sensorTexts: Array<string>;
  hasOpticalPower: boolean;
}

/*
 * Transceivers out of ENTITY-SENSOR-MIB (or Cisco's twin): every DOM sensor
 * is grouped under the module it belongs to, the module is matched to its
 * port, and modules with no sensors at all (a copper SFP, a direct-attach
 * cable) are still reported as present when the entity tree names them a
 * transceiver.
 */
export function parseEntitySensorTransceivers(
  input: EntitySensorTransceiverInput,
): Array<SnmpTransceiverResult> {
  const entities: Map<string, EntityRow> = toEntityRows(input.entityRows);
  const childrenByParent: Map<string, Array<EntityRow>> = new Map();

  for (const entity of entities.values()) {
    if (entity.containedIn) {
      const siblings: Array<EntityRow> =
        childrenByParent.get(entity.containedIn) || [];
      siblings.push(entity);
      childrenByParent.set(entity.containedIn, siblings);
    }
  }

  const aliases: Map<string, number> = aliasMappings(input.aliasRows);
  const owners: Map<string, OwnerAccumulator> = new Map();
  const source: TransceiverMibSource =
    input.flavor === "cisco"
      ? TransceiverMibSource.CiscoEntitySensor
      : input.flavor === "arista"
        ? TransceiverMibSource.AristaEntitySensor
        : TransceiverMibSource.EntitySensor;

  for (const sensorIndex of Object.keys(input.sensorRows)) {
    const row: Record<string, unknown> = input.sensorRows[sensorIndex] || {};
    const type: number | undefined = readNumber(
      column(row, ENT_PHY_SENSOR_COLUMNS.type),
    );

    if (type === undefined) {
      continue;
    }

    const sensorEntity: EntityRow | undefined = entities.get(sensorIndex);
    const text: string = entityText(sensorEntity);
    const kind: TransceiverReadingKind | undefined = entitySensorKind({
      type: type,
      flavor: input.flavor,
      text: text,
    });

    if (!kind) {
      continue;
    }

    const found: { owner: EntityRow; lane?: number | undefined } | undefined =
      findOwner(sensorIndex, entities);

    if (
      !found ||
      found.owner.physicalClass === PHYSICAL_CLASS.chassis ||
      found.owner.physicalClass === PHYSICAL_CLASS.stack
    ) {
      continue;
    }

    const accumulator: OwnerAccumulator = owners.get(found.owner.index) || {
      owner: found.owner,
      measurements: {},
      sensorTexts: [],
      hasOpticalPower: false,
    };
    owners.set(found.owner.index, accumulator);

    if (text) {
      accumulator.sensorTexts.push(text);
    }

    if (
      kind === TransceiverReadingKind.TxPower ||
      kind === TransceiverReadingKind.RxPower
    ) {
      accumulator.hasOpticalPower = true;
    }

    const status: number | undefined = readNumber(
      column(row, ENT_PHY_SENSOR_COLUMNS.status),
    );
    const raw: number | undefined = readNumber(
      column(row, ENT_PHY_SENSOR_COLUMNS.value),
    );

    // A sensor the agent cannot read right now is no reading, not a zero.
    if (
      raw === undefined ||
      (status !== undefined && status !== SENSOR_STATUS_OK)
    ) {
      continue;
    }

    const scale: number | undefined = readNumber(
      column(row, ENT_PHY_SENSOR_COLUMNS.scale),
    );
    const precision: number | undefined = readNumber(
      column(row, ENT_PHY_SENSOR_COLUMNS.precision),
    );
    const convert: (value: number) => number | undefined = (
      value: number,
    ): number | undefined => {
      return entitySensorDisplayValue({
        raw: value,
        type: type,
        scale: scale,
        precision: precision,
      });
    };

    const value: number | undefined = convert(raw);

    if (value === undefined) {
      continue;
    }

    const thresholds: TransceiverThresholds | undefined =
      input.flavor === "cisco"
        ? ciscoThresholds({
            sensorIndex: sensorIndex,
            thresholdRows: input.thresholdRows,
            convert: convert,
          })
        : input.flavor === "arista"
          ? aristaThresholds({
              sensorIndex: sensorIndex,
              thresholdRows: input.thresholdRows,
              convert: convert,
            })
          : undefined;

    const measurement: TransceiverMeasurement = accumulator.measurements[
      kind
    ] || { readings: [] };
    const reading: TransceiverReading = {
      value: value,
      ...(found.lane !== undefined ? { lane: found.lane } : {}),
    };

    measurement.readings.push(reading);

    if (!measurement.thresholds && thresholds) {
      measurement.thresholds = thresholds;
    }

    accumulator.measurements[kind] = measurement;
  }

  const results: Array<SnmpTransceiverResult> = [];
  const reportedInterfaces: Set<number> = new Set<number>();

  const addResult: (accumulator: OwnerAccumulator) => void = (
    accumulator: OwnerAccumulator,
  ): void => {
    const interfaceIndex: number | undefined = findInterfaceIndex({
      owner: accumulator.owner,
      sensorTexts: accumulator.sensorTexts,
      entities: entities,
      childrenByParent: childrenByParent,
      aliases: aliases,
      interfaces: input.interfaces,
    });

    if (interfaceIndex === undefined || reportedInterfaces.has(interfaceIndex)) {
      return;
    }

    reportedInterfaces.add(interfaceIndex);

    for (const measurement of Object.values(accumulator.measurements)) {
      measurement?.readings.sort(
        (a: TransceiverReading, b: TransceiverReading) => {
          return (a.lane ?? -1) - (b.lane ?? -1);
        },
      );
    }

    const owner: EntityRow = accumulator.owner;
    const type: string | undefined =
      owner.descr &&
      owner.descr !== owner.name &&
      !LABEL_DESCRIPTION_REGEX.test(owner.descr)
        ? owner.descr
        : undefined;

    results.push(
      withoutEmpty({
        interfaceIndex: interfaceIndex,
        vendor: owner.mfgName,
        partNumber: owner.modelName,
        serialNumber: owner.serial,
        revision: owner.hardwareRev,
        type: type,
        measurements: accumulator.measurements,
        source: source,
      }),
    );
  };

  for (const accumulator of owners.values()) {
    // A line card's temperature sensors are not an optic.
    if (!accumulator.hasOpticalPower && !looksLikeTransceiver(accumulator.owner)) {
      continue;
    }

    addResult(accumulator);
  }

  // Optics with no diagnostics: present, with nothing to read.
  for (const entity of entities.values()) {
    if (
      owners.has(entity.index) ||
      isLaneEntity(entity) ||
      !(entity.serial || entity.modelName) ||
      !looksLikeTransceiver(entity) ||
      ![
        PHYSICAL_CLASS.other,
        PHYSICAL_CLASS.container,
        PHYSICAL_CLASS.module,
        PHYSICAL_CLASS.port,
      ].includes(entity.physicalClass ?? -1)
    ) {
      continue;
    }

    addResult({
      owner: entity,
      measurements: {},
      sensorTexts: [],
      hasOpticalPower: false,
    });
  }

  return results.sort((a: SnmpTransceiverResult, b: SnmpTransceiverResult) => {
    return a.interfaceIndex - b.interfaceIndex;
  });
}

// --- Tables indexed by ifIndex ---

function rowInterfaceIndex(rowIndex: string): number | undefined {
  const parsed: number = parseInt(rowIndex.split(".")[0] || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/*
 * JUNIPER-DOM-MIB: one row per port with an optic. Received and transmitted
 * power in hundredths of a dBm, bias in microamps (thousandths of a mA),
 * voltage in millivolts, temperature in degrees C - and every threshold in
 * the same units as its reading. A multi-lane optic's per-lane powers and
 * bias come from the lane table when it was walked.
 */
export function parseJuniperDomTransceivers(data: {
  rows: SnmpTableRows;
  laneRows?: SnmpTableRows | undefined;
  interfaces: TransceiverInterfaceIndex;
}): Array<SnmpTransceiverResult> {
  const c: typeof JNX_DOM_CURRENT_COLUMNS = JNX_DOM_CURRENT_COLUMNS;
  const results: Array<SnmpTransceiverResult> = [];

  for (const rowIndex of Object.keys(data.rows)) {
    const interfaceIndex: number | undefined = rowInterfaceIndex(rowIndex);

    if (
      interfaceIndex === undefined ||
      !data.interfaces.hasInterface(interfaceIndex)
    ) {
      continue;
    }

    const row: Record<string, unknown> = data.rows[rowIndex] || {};
    const measurements: TransceiverMeasurements = {};

    setMeasurement(
      measurements,
      TransceiverReadingKind.RxPower,
      dbmFixedPoint(column(row, c.rxPower), 2),
      thresholdsFrom({
        highAlarm: dbmFixedPoint(column(row, c.rxPowerHighAlarm), 2),
        lowAlarm: dbmFixedPoint(column(row, c.rxPowerLowAlarm), 2),
        highWarning: dbmFixedPoint(column(row, c.rxPowerHighWarning), 2),
        lowWarning: dbmFixedPoint(column(row, c.rxPowerLowWarning), 2),
      }),
    );
    setMeasurement(
      measurements,
      TransceiverReadingKind.TxPower,
      dbmFixedPoint(column(row, c.txPower), 2),
      thresholdsFrom({
        highAlarm: dbmFixedPoint(column(row, c.txPowerHighAlarm), 2),
        lowAlarm: dbmFixedPoint(column(row, c.txPowerLowAlarm), 2),
        highWarning: dbmFixedPoint(column(row, c.txPowerHighWarning), 2),
        lowWarning: dbmFixedPoint(column(row, c.txPowerLowWarning), 2),
      }),
    );
    setMeasurement(
      measurements,
      TransceiverReadingKind.BiasCurrent,
      fixedPoint(column(row, c.txBias), 3),
      thresholdsFrom({
        highAlarm: fixedPoint(column(row, c.txBiasHighAlarm), 3),
        lowAlarm: fixedPoint(column(row, c.txBiasLowAlarm), 3),
        highWarning: fixedPoint(column(row, c.txBiasHighWarning), 3),
        lowWarning: fixedPoint(column(row, c.txBiasLowWarning), 3),
      }),
    );
    setMeasurement(
      measurements,
      TransceiverReadingKind.Temperature,
      rawOrUndefined(column(row, c.temperature)),
      thresholdsFrom({
        highAlarm: rawOrUndefined(column(row, c.temperatureHighAlarm)),
        lowAlarm: rawOrUndefined(column(row, c.temperatureLowAlarm)),
        highWarning: rawOrUndefined(column(row, c.temperatureHighWarning)),
        lowWarning: rawOrUndefined(column(row, c.temperatureLowWarning)),
      }),
    );
    setMeasurement(
      measurements,
      TransceiverReadingKind.Voltage,
      fixedPoint(column(row, c.voltage), 3),
      thresholdsFrom({
        highAlarm: fixedPoint(column(row, c.voltageHighAlarm), 3),
        lowAlarm: fixedPoint(column(row, c.voltageLowAlarm), 3),
        highWarning: fixedPoint(column(row, c.voltageHighWarning), 3),
        lowWarning: fixedPoint(column(row, c.voltageLowWarning), 3),
      }),
    );

    const laneCount: number | undefined = readNumber(
      column(row, c.laneCount),
    );

    if (laneCount !== undefined && laneCount > 1 && data.laneRows) {
      applyJuniperLanes({
        interfaceIndex: interfaceIndex,
        laneRows: data.laneRows,
        measurements: measurements,
      });
    }

    results.push({
      interfaceIndex: interfaceIndex,
      measurements: measurements,
      source: TransceiverMibSource.JuniperDom,
    });
  }

  return results.sort((a: SnmpTransceiverResult, b: SnmpTransceiverResult) => {
    return a.interfaceIndex - b.interfaceIndex;
  });
}

function applyJuniperLanes(data: {
  interfaceIndex: number;
  laneRows: SnmpTableRows;
  measurements: TransceiverMeasurements;
}): void {
  const perLane: Partial<Record<TransceiverReadingKind, Array<TransceiverReading>>> =
    {};

  const lanes: Array<string> = Object.keys(data.laneRows)
    .filter((rowIndex: string) => {
      return rowIndex.startsWith(`${data.interfaceIndex}.`);
    })
    .sort((a: string, b: string) => {
      return a.localeCompare(b, undefined, { numeric: true });
    });

  for (const rowIndex of lanes) {
    const lane: number = parseInt(rowIndex.split(".")[1] || "", 10);

    if (isNaN(lane)) {
      continue;
    }

    const row: Record<string, unknown> = data.laneRows[rowIndex] || {};
    const values: Array<[TransceiverReadingKind, number | undefined]> = [
      [
        TransceiverReadingKind.RxPower,
        dbmFixedPoint(column(row, JNX_DOM_LANE_COLUMNS.rxPower), 2),
      ],
      [
        TransceiverReadingKind.TxPower,
        dbmFixedPoint(column(row, JNX_DOM_LANE_COLUMNS.txPower), 2),
      ],
      [
        TransceiverReadingKind.BiasCurrent,
        fixedPoint(column(row, JNX_DOM_LANE_COLUMNS.txBias), 3),
      ],
    ];

    for (const [kind, value] of values) {
      if (value === undefined) {
        continue;
      }
      const readings: Array<TransceiverReading> = perLane[kind] || [];
      readings.push({ value: value, lane: lane });
      perLane[kind] = readings;
    }
  }

  for (const kind of Object.keys(perLane) as Array<TransceiverReadingKind>) {
    const readings: Array<TransceiverReading> | undefined = perLane[kind];

    if (!readings || readings.length === 0) {
      continue;
    }

    data.measurements[kind] = {
      readings: readings,
      ...(data.measurements[kind]?.thresholds
        ? { thresholds: data.measurements[kind]!.thresholds }
        : {}),
    };
  }
}

/*
 * MIKROTIK-MIB mtxrOpticalTable: indexed by the interface index, and named
 * after the interface too, which is used when the index does not match.
 * Power in thousandths of a dBm, voltage in millivolts, bias in mA. RouterOS
 * reports no thresholds, but flags loss of signal and transmitter faults.
 */
export function parseMikroTikTransceivers(data: {
  rows: SnmpTableRows;
  interfaces: TransceiverInterfaceIndex;
}): Array<SnmpTransceiverResult> {
  const c: typeof MTXR_OPTICAL_COLUMNS = MTXR_OPTICAL_COLUMNS;
  const results: Array<SnmpTransceiverResult> = [];
  const seen: Set<number> = new Set<number>();

  for (const rowIndex of Object.keys(data.rows)) {
    const row: Record<string, unknown> = data.rows[rowIndex] || {};
    const name: string | undefined = readText(column(row, c.name));
    const index: number | undefined = rowInterfaceIndex(rowIndex);
    const interfaceIndex: number | undefined =
      index !== undefined && data.interfaces.hasInterface(index)
        ? index
        : data.interfaces.findByName(name);

    if (interfaceIndex === undefined || seen.has(interfaceIndex)) {
      continue;
    }

    const vendor: string | undefined = readText(column(row, c.vendorName));
    const serialNumber: string | undefined = readText(
      column(row, c.vendorSerial),
    );
    const voltage: number | undefined = fixedPoint(
      column(row, c.supplyVoltage),
      3,
    );

    // An empty cage reports zeros and no vendor.
    if (!vendor && !serialNumber && !(voltage && voltage > 0)) {
      continue;
    }

    seen.add(interfaceIndex);

    const measurements: TransceiverMeasurements = {};
    setMeasurement(
      measurements,
      TransceiverReadingKind.RxPower,
      dbmFixedPoint(column(row, c.rxPower), 3),
    );
    setMeasurement(
      measurements,
      TransceiverReadingKind.TxPower,
      dbmFixedPoint(column(row, c.txPower), 3),
    );
    setMeasurement(
      measurements,
      TransceiverReadingKind.Temperature,
      rawOrUndefined(column(row, c.temperature)),
    );
    setMeasurement(
      measurements,
      TransceiverReadingKind.Voltage,
      voltage && voltage > 0 ? voltage : undefined,
    );
    setMeasurement(
      measurements,
      TransceiverReadingKind.BiasCurrent,
      rawOrUndefined(column(row, c.txBiasCurrent)),
    );

    const faults: Array<TransceiverFault> = [];
    if (readNumber(column(row, c.rxLoss)) === 1) {
      faults.push(TransceiverFault.RxLossOfSignal);
    }
    if (readNumber(column(row, c.txFault)) === 1) {
      faults.push(TransceiverFault.TxFault);
    }

    const wavelength: number | undefined = fixedPoint(
      column(row, c.wavelength),
      2,
    );

    results.push(
      withoutEmpty({
        interfaceIndex: interfaceIndex,
        vendor: vendor,
        serialNumber: serialNumber,
        wavelengthNm:
          wavelength && wavelength > 0
            ? TransceiverUnitUtil.roundTo(wavelength, 2)
            : undefined,
        measurements: measurements,
        faults: faults.length > 0 ? faults : undefined,
        source: TransceiverMibSource.MikroTik,
      }),
    );
  }

  return results.sort((a: SnmpTransceiverResult, b: SnmpTransceiverResult) => {
    return a.interfaceIndex - b.interfaceIndex;
  });
}

// One BITS value: bit 0 is the most significant bit of the first octet.
export function isBitSet(value: unknown, bit: number): boolean {
  if (!Buffer.isBuffer(value)) {
    return false;
  }

  const octet: number = Math.floor(bit / 8);

  if (octet >= value.length) {
    return false;
  }

  return ((value[octet]! >> (7 - (bit % 8))) & 1) === 1;
}

/*
 * HH3C-TRANSCEIVER-INFO-MIB: readings in hundredths (power in dBm, voltage
 * in V, bias in mA) and temperature in degrees C, but thresholds in other
 * units again - temperature in thousandths of a degree, supply voltage in
 * hundreds of microvolts, bias in microamps, and power either in hundredths
 * of a dBm (newer agents) or in tenths of a microwatt.
 */
export function parseH3cTransceivers(data: {
  rows: SnmpTableRows;
  interfaces: TransceiverInterfaceIndex;
}): Array<SnmpTransceiverResult> {
  const c: typeof HH3C_TRANSCEIVER_COLUMNS = HH3C_TRANSCEIVER_COLUMNS;
  const results: Array<SnmpTransceiverResult> = [];

  const tenthMicrowattsToDbm: (value: unknown) => number | undefined = (
    value: unknown,
  ): number | undefined => {
    const raw: number | undefined = rawOrUndefined(value);
    return raw === undefined
      ? undefined
      : TransceiverUnitUtil.microwattsToDbm(raw / 10);
  };

  for (const rowIndex of Object.keys(data.rows)) {
    const interfaceIndex: number | undefined = rowInterfaceIndex(rowIndex);

    if (
      interfaceIndex === undefined ||
      !data.interfaces.hasInterface(interfaceIndex)
    ) {
      continue;
    }

    const row: Record<string, unknown> = data.rows[rowIndex] || {};
    const vendor: string | undefined = readText(column(row, c.vendorName));
    const serialNumber: string | undefined = readText(
      column(row, c.serialNumber),
    );

    const measurements: TransceiverMeasurements = {};

    const powerThresholds: (
      dbmColumns: [number, number, number, number],
      microwattColumns: [number, number, number, number],
    ) => TransceiverThresholds | undefined = (
      dbmColumns: [number, number, number, number],
      microwattColumns: [number, number, number, number],
    ): TransceiverThresholds | undefined => {
      const fromDbm: TransceiverThresholds | undefined = thresholdsFrom({
        highAlarm: dbmFixedPoint(column(row, dbmColumns[0]), 2),
        lowAlarm: dbmFixedPoint(column(row, dbmColumns[1]), 2),
        highWarning: dbmFixedPoint(column(row, dbmColumns[2]), 2),
        lowWarning: dbmFixedPoint(column(row, dbmColumns[3]), 2),
      });

      if (fromDbm) {
        return fromDbm;
      }

      return thresholdsFrom({
        highAlarm: tenthMicrowattsToDbm(column(row, microwattColumns[0])),
        lowAlarm: tenthMicrowattsToDbm(column(row, microwattColumns[1])),
        highWarning: tenthMicrowattsToDbm(column(row, microwattColumns[2])),
        lowWarning: tenthMicrowattsToDbm(column(row, microwattColumns[3])),
      });
    };

    setMeasurement(
      measurements,
      TransceiverReadingKind.RxPower,
      dbmFixedPoint(column(row, c.curRxPower), 2),
      powerThresholds(
        [
          c.rcvPwrHiAlarmDbm,
          c.rcvPwrLoAlarmDbm,
          c.rcvPwrHiWarnDbm,
          c.rcvPwrLoWarnDbm,
        ],
        [c.rcvPwrHiAlarm, c.rcvPwrLoAlarm, c.rcvPwrHiWarn, c.rcvPwrLoWarn],
      ),
    );
    setMeasurement(
      measurements,
      TransceiverReadingKind.TxPower,
      dbmFixedPoint(column(row, c.curTxPower), 2),
      powerThresholds(
        [
          c.pwrOutHiAlarmDbm,
          c.pwrOutLoAlarmDbm,
          c.pwrOutHiWarnDbm,
          c.pwrOutLoWarnDbm,
        ],
        [c.pwrOutHiAlarm, c.pwrOutLoAlarm, c.pwrOutHiWarn, c.pwrOutLoWarn],
      ),
    );
    setMeasurement(
      measurements,
      TransceiverReadingKind.Temperature,
      rawOrUndefined(column(row, c.temperature)),
      thresholdsFrom({
        highAlarm: fixedPoint(column(row, c.tempHiAlarm), 3),
        lowAlarm: fixedPoint(column(row, c.tempLoAlarm), 3),
        highWarning: fixedPoint(column(row, c.tempHiWarn), 3),
        lowWarning: fixedPoint(column(row, c.tempLoWarn), 3),
      }),
    );
    setMeasurement(
      measurements,
      TransceiverReadingKind.Voltage,
      fixedPoint(column(row, c.voltage), 2),
      thresholdsFrom({
        highAlarm: fixedPoint(column(row, c.vccHiAlarm), 4),
        lowAlarm: fixedPoint(column(row, c.vccLoAlarm), 4),
        highWarning: fixedPoint(column(row, c.vccHiWarn), 4),
        lowWarning: fixedPoint(column(row, c.vccLoWarn), 4),
      }),
    );
    setMeasurement(
      measurements,
      TransceiverReadingKind.BiasCurrent,
      fixedPoint(column(row, c.biasCurrent), 2),
      thresholdsFrom({
        highAlarm: fixedPoint(column(row, c.biasHiAlarm), 3),
        lowAlarm: fixedPoint(column(row, c.biasLoAlarm), 3),
        highWarning: fixedPoint(column(row, c.biasHiWarn), 3),
        lowWarning: fixedPoint(column(row, c.biasLoWarn), 3),
      }),
    );

    if (!vendor && !serialNumber && Object.keys(measurements).length === 0) {
      continue;
    }

    const errors: unknown = column(row, c.errors);
    const faults: Array<TransceiverFault> = [];
    if (isBitSet(errors, HH3C_ERROR_BIT_RX_LOSS_OF_SIGNAL)) {
      faults.push(TransceiverFault.RxLossOfSignal);
    }
    if (isBitSet(errors, HH3C_ERROR_BIT_TX_FAULT)) {
      faults.push(TransceiverFault.TxFault);
    }

    const wavelength: number | undefined = rawOrUndefined(
      column(row, c.waveLength),
    );

    results.push(
      withoutEmpty({
        interfaceIndex: interfaceIndex,
        vendor: vendor,
        partNumber: readText(column(row, c.partNumber)),
        serialNumber: serialNumber,
        revision: readText(column(row, c.revisionNumber)),
        type: readText(column(row, c.type)),
        wavelengthNm: wavelength && wavelength > 0 ? wavelength : undefined,
        measurements: measurements,
        faults: faults.length > 0 ? faults : undefined,
        source: TransceiverMibSource.H3cTransceiver,
      }),
    );
  }

  return results.sort((a: SnmpTransceiverResult, b: SnmpTransceiverResult) => {
    return a.interfaceIndex - b.interfaceIndex;
  });
}

/*
 * HP-ICF-TRANSCEIVER-MIB: temperature in thousandths of a degree, voltage in
 * hundreds of microvolts, bias in microamps, power in thousandths of a dBm
 * (with -99999999 for no light at all), power thresholds in tenths of a
 * microwatt. Readings are only valid when the optic does DOM.
 */
export function parseHpIcfTransceivers(data: {
  rows: SnmpTableRows;
  interfaces: TransceiverInterfaceIndex;
}): Array<SnmpTransceiverResult> {
  const c: typeof HPICF_XCVR_COLUMNS = HPICF_XCVR_COLUMNS;
  const results: Array<SnmpTransceiverResult> = [];

  const tenthMicrowattsToDbm: (value: unknown) => number | undefined = (
    value: unknown,
  ): number | undefined => {
    const raw: number | undefined = rawOrUndefined(value);
    return raw === undefined
      ? undefined
      : TransceiverUnitUtil.microwattsToDbm(raw / 10);
  };

  const power: (value: unknown) => number | undefined = (
    value: unknown,
  ): number | undefined => {
    const raw: number | undefined = readNumber(value);

    if (raw === HPICF_NO_LIGHT) {
      return TransceiverUnitUtil.clampDbm(-Infinity);
    }

    return dbmFixedPoint(value, 3);
  };

  for (const rowIndex of Object.keys(data.rows)) {
    const interfaceIndex: number | undefined = rowInterfaceIndex(rowIndex);

    if (
      interfaceIndex === undefined ||
      !data.interfaces.hasInterface(interfaceIndex)
    ) {
      continue;
    }

    const row: Record<string, unknown> = data.rows[rowIndex] || {};
    const partNumber: string | undefined = readText(column(row, c.model));
    const serialNumber: string | undefined = readText(column(row, c.serial));

    if (!partNumber && !serialNumber) {
      continue;
    }

    const measurements: TransceiverMeasurements = {};

    if (readNumber(column(row, c.diagnostics)) === HPICF_DIAGNOSTICS_DOM) {
      const voltage: number | undefined = fixedPoint(column(row, c.voltage), 4);

      setMeasurement(
        measurements,
        TransceiverReadingKind.RxPower,
        power(column(row, c.rxPower)),
        thresholdsFrom({
          highAlarm: tenthMicrowattsToDbm(column(row, c.rcvPwrHiAlarm)),
          lowAlarm: tenthMicrowattsToDbm(column(row, c.rcvPwrLoAlarm)),
          highWarning: tenthMicrowattsToDbm(column(row, c.rcvPwrHiWarn)),
          lowWarning: tenthMicrowattsToDbm(column(row, c.rcvPwrLoWarn)),
        }),
      );
      setMeasurement(
        measurements,
        TransceiverReadingKind.TxPower,
        power(column(row, c.txPower)),
        thresholdsFrom({
          highAlarm: tenthMicrowattsToDbm(column(row, c.pwrOutHiAlarm)),
          lowAlarm: tenthMicrowattsToDbm(column(row, c.pwrOutLoAlarm)),
          highWarning: tenthMicrowattsToDbm(column(row, c.pwrOutHiWarn)),
          lowWarning: tenthMicrowattsToDbm(column(row, c.pwrOutLoWarn)),
        }),
      );
      setMeasurement(
        measurements,
        TransceiverReadingKind.Temperature,
        fixedPoint(column(row, c.temperature), 3),
        thresholdsFrom({
          highAlarm: fixedPoint(column(row, c.tempHiAlarm), 3),
          lowAlarm: fixedPoint(column(row, c.tempLoAlarm), 3),
          highWarning: fixedPoint(column(row, c.tempHiWarn), 3),
          lowWarning: fixedPoint(column(row, c.tempLoWarn), 3),
        }),
      );
      // "Will be zero if the transceiver does not report this object."
      setMeasurement(
        measurements,
        TransceiverReadingKind.Voltage,
        voltage && voltage > 0 ? voltage : undefined,
        thresholdsFrom({
          highAlarm: fixedPoint(column(row, c.vccHiAlarm), 4),
          lowAlarm: fixedPoint(column(row, c.vccLoAlarm), 4),
          highWarning: fixedPoint(column(row, c.vccHiWarn), 4),
          lowWarning: fixedPoint(column(row, c.vccLoWarn), 4),
        }),
      );
      setMeasurement(
        measurements,
        TransceiverReadingKind.BiasCurrent,
        fixedPoint(column(row, c.bias), 3),
        thresholdsFrom({
          highAlarm: fixedPoint(column(row, c.biasHiAlarm), 3),
          lowAlarm: fixedPoint(column(row, c.biasLoAlarm), 3),
          highWarning: fixedPoint(column(row, c.biasHiWarn), 3),
          lowWarning: fixedPoint(column(row, c.biasLoWarn), 3),
        }),
      );
    }

    const wavelengthText: string | undefined = readText(
      column(row, c.wavelength),
    );
    const wavelengthMatch: RegExpMatchArray | null = (
      wavelengthText || ""
    ).match(NUMBER_PREFIX_REGEX);
    const wavelength: number | undefined = wavelengthMatch
      ? parseFloat(wavelengthMatch[0])
      : undefined;

    results.push(
      withoutEmpty({
        interfaceIndex: interfaceIndex,
        partNumber: partNumber,
        serialNumber: serialNumber,
        type: readText(column(row, c.type)),
        wavelengthNm: wavelength && wavelength > 0 ? wavelength : undefined,
        measurements: measurements,
        source: TransceiverMibSource.HpIcfTransceiver,
      }),
    );
  }

  return results.sort((a: SnmpTransceiverResult, b: SnmpTransceiverResult) => {
    return a.interfaceIndex - b.interfaceIndex;
  });
}

/*
 * CAMBIUM-NETWORKS-TRANSCEIVER-MIB (cnMatrix 4.5 and later): temperature in
 * degrees C, voltage in millivolts, bias in microamps, power in microwatts,
 * -32768 for "unknown", and no thresholds.
 */
export function parseCambiumTransceivers(data: {
  rows: SnmpTableRows;
  interfaces: TransceiverInterfaceIndex;
}): Array<SnmpTransceiverResult> {
  const c: typeof CN_TRANSCEIVER_COLUMNS = CN_TRANSCEIVER_COLUMNS;
  const results: Array<SnmpTransceiverResult> = [];

  for (const rowIndex of Object.keys(data.rows)) {
    const interfaceIndex: number | undefined = rowInterfaceIndex(rowIndex);

    if (
      interfaceIndex === undefined ||
      !data.interfaces.hasInterface(interfaceIndex)
    ) {
      continue;
    }

    const row: Record<string, unknown> = data.rows[rowIndex] || {};
    const vendor: string | undefined = readText(column(row, c.vendorName));
    const serialNumber: string | undefined = readText(
      column(row, c.vendorSerial),
    );
    const temperature: number | undefined = rawOrUndefined(
      column(row, c.temperature),
    );
    const voltage: number | undefined = fixedPoint(column(row, c.voltage), 3);

    if (!vendor && !serialNumber && temperature === undefined) {
      continue;
    }

    const measurements: TransceiverMeasurements = {};

    /*
     * A module without diagnostics (a copper SFP) answers zero microwatts,
     * which would read as a dark fibre. Optical readings only count when
     * the module also reports its temperature or supply voltage.
     */
    if (temperature !== undefined || (voltage !== undefined && voltage > 0)) {
      const microwatts: (value: unknown) => number | undefined = (
        value: unknown,
      ): number | undefined => {
        const raw: number | undefined = rawOrUndefined(value);
        return raw === undefined
          ? undefined
          : TransceiverUnitUtil.microwattsToDbm(raw);
      };

      setMeasurement(
        measurements,
        TransceiverReadingKind.RxPower,
        microwatts(column(row, c.rxPower)),
      );
      setMeasurement(
        measurements,
        TransceiverReadingKind.TxPower,
        microwatts(column(row, c.txPower)),
      );
      setMeasurement(measurements, TransceiverReadingKind.Temperature, temperature);
      setMeasurement(
        measurements,
        TransceiverReadingKind.Voltage,
        voltage && voltage > 0 ? voltage : undefined,
      );
      setMeasurement(
        measurements,
        TransceiverReadingKind.BiasCurrent,
        fixedPoint(column(row, c.txBias), 3),
      );
    }

    const typeValue: number | undefined = readNumber(column(row, c.type));
    const wavelength: number | undefined = rawOrUndefined(
      column(row, c.wavelength),
    );

    results.push(
      withoutEmpty({
        interfaceIndex: interfaceIndex,
        vendor: vendor,
        partNumber: readText(column(row, c.vendorPartNo)),
        serialNumber: serialNumber,
        revision: readText(column(row, c.vendorRevision)),
        type:
          typeValue !== undefined ? CN_TRANSCEIVER_TYPES[typeValue] : undefined,
        wavelengthNm: wavelength && wavelength > 0 ? wavelength : undefined,
        measurements: measurements,
        source: TransceiverMibSource.CambiumTransceiver,
      }),
    );
  }

  return results.sort((a: SnmpTransceiverResult, b: SnmpTransceiverResult) => {
    return a.interfaceIndex - b.interfaceIndex;
  });
}

// Drops undefined fields so the payload carries only what was read.
function withoutEmpty(result: SnmpTransceiverResult): SnmpTransceiverResult {
  const record: Record<string, unknown> = {
    ...(result as unknown as Record<string, unknown>),
  };

  for (const key of Object.keys(record)) {
    if (record[key] === undefined || record[key] === "") {
      delete record[key];
    }
  }

  return record as unknown as SnmpTransceiverResult;
}

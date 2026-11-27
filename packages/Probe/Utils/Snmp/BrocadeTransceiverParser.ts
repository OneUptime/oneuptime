import { SnmpTableRows } from "./EndpointTableParsers";
import {
  FibreChannelInterfaceCandidate,
  mapBrocadePortsToInterfaces,
  rowsOfMainConnUnit,
} from "./FibreChannelParsers";
import { readNumber, readText } from "./TransceiverParsers";
import {
  SnmpTransceiverResult,
  TransceiverMeasurements,
  TransceiverMibSource,
  TransceiverReadingKind,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTransceiver";
import TransceiverUnitUtil from "Common/Utils/NetworkDevice/TransceiverUnitUtil";

/*
 * Brocade Fabric OS optics: FA-EXT-MIB's swSfpStatTable.
 *
 * The table AUGMENTS FCMGMT-MIB's connUnitPortEntry, so a row is indexed
 * by the switch's connUnitId and the port index - not by ifIndex - and is
 * joined to its interface the way the port statistics are
 * (mapBrocadePortsToInterfaces), by swFCPortSpecifier against IF-MIB's
 * "FC port 3/15". Its readings are text: temperature in degrees C, supply
 * voltage in millivolts, bias current in milliamps, power in dBm. "-inf"
 * is a dark receiver; "NA" is a port with no optic, or one that reports no
 * diagnostics. Fabric OS publishes no optic thresholds over SNMP (MAPS
 * judges them, and sends mapsTrapAM traps when they are crossed), so these
 * optics are judged by the trend of their received power and by reading
 * criteria.
 *
 * Who made the optic comes from connUnitPortTable on the same index.
 */

export const SW_SFP_STAT_TABLE_OID: string = "1.3.6.1.4.1.1588.2.1.1.1.28.1";

export const SW_SFP_STAT_COLUMNS: {
  temperature: number;
  voltage: number;
  current: number;
  rxPower: number;
  txPower: number;
} = {
  temperature: 1,
  voltage: 2,
  current: 3,
  rxPower: 4,
  txPower: 5,
};

export const CONN_UNIT_PORT_TABLE_OID: string = "1.3.6.1.3.94.1.10";

export const CONN_UNIT_PORT_COLUMNS: {
  transmitterType: number;
  moduleType: number;
  serialNumber: number;
  revision: number;
  vendor: number;
} = {
  transmitterType: 8,
  moduleType: 9,
  serialNumber: 12,
  revision: 13,
  vendor: 14,
};

// connUnitPortModuleType gbicNotInstalled(8): the cage is empty.
const MODULE_NOT_INSTALLED: number = 8;

const MODULE_TYPES: Record<number, string> = {
  3: "GBIC",
  4: "Embedded",
  5: "GLM",
  6: "GBIC",
  7: "GBIC",
  9: "SFP",
};

const TRANSMITTER_TYPES: Record<number, string> = {
  4: "short wave laser",
  5: "long wave laser",
  6: "copper",
  8: "long wave laser",
  9: "short wave laser",
  10: "long wave LED",
};

// "-inf", "-Inf", "inf".
const NO_LIGHT_TEXT: RegExp = /^-?inf(inity)?$/i;
const NUMBER_TEXT: RegExp = /^-?\d+(\.\d+)?$/;

/*
 * A reading as Fabric OS writes it, or undefined for "NA" and anything else
 * that is not a number. "-inf" is minus infinity, which only optical power
 * reports.
 */
export function readBrocadeSfpNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  const text: string | undefined = readText(value);

  if (!text) {
    return undefined;
  }

  if (NO_LIGHT_TEXT.test(text)) {
    return text.startsWith("-") ? -Infinity : undefined;
  }

  return NUMBER_TEXT.test(text) ? parseFloat(text) : undefined;
}

function opticalPower(value: unknown): number | undefined {
  const dbm: number | undefined = readBrocadeSfpNumber(value);
  return dbm === undefined ? undefined : TransceiverUnitUtil.clampDbm(dbm);
}

function finiteReading(value: unknown): number | undefined {
  const reading: number | undefined = readBrocadeSfpNumber(value);
  return reading !== undefined && Number.isFinite(reading)
    ? reading
    : undefined;
}

function setReading(
  measurements: TransceiverMeasurements,
  kind: TransceiverReadingKind,
  value: number | undefined,
): void {
  if (value !== undefined) {
    measurements[kind] = { readings: [{ value: value }] };
  }
}

function describeType(row: Record<string, unknown>): string | undefined {
  const module: number | undefined = readNumber(
    row[CONN_UNIT_PORT_COLUMNS.moduleType.toString()],
  );
  const transmitter: number | undefined = readNumber(
    row[CONN_UNIT_PORT_COLUMNS.transmitterType.toString()],
  );

  const moduleText: string | undefined =
    module !== undefined ? MODULE_TYPES[module] : undefined;
  const transmitterText: string | undefined =
    transmitter !== undefined ? TRANSMITTER_TYPES[transmitter] : undefined;

  if (moduleText && transmitterText) {
    return `${moduleText}, ${transmitterText}`;
  }

  return moduleText || transmitterText;
}

export function parseBrocadeSfpTransceivers(data: {
  sfpRows: SnmpTableRows;
  // swFCPortTable rows by port index, with swFCPortSpecifier.
  portRows: SnmpTableRows;
  // connUnitPortTable rows, by FCMGMT index (connUnitId.portIndex).
  unitPortRows?: SnmpTableRows | undefined;
  interfaces: Array<FibreChannelInterfaceCandidate>;
}): Array<SnmpTransceiverResult> {
  const sfpByPort: SnmpTableRows = rowsOfMainConnUnit(data.sfpRows);
  const identityByPort: SnmpTableRows = rowsOfMainConnUnit(
    data.unitPortRows || {},
  );
  const interfaceByPort: Map<string, number> = mapBrocadePortsToInterfaces({
    /*
     * A port the SFP table lists but swFCPortTable does not (it was not
     * walked, or the agent is older) is still joined by ifIndex numbering.
     */
    portRows: { ...sfpByPort, ...data.portRows },
    interfaces: data.interfaces,
  });
  const c: typeof SW_SFP_STAT_COLUMNS = SW_SFP_STAT_COLUMNS;
  const results: Array<SnmpTransceiverResult> = [];

  for (const portIndex of Object.keys(sfpByPort)) {
    const interfaceIndex: number | undefined = interfaceByPort.get(portIndex);

    if (interfaceIndex === undefined) {
      continue;
    }

    const row: Record<string, unknown> = sfpByPort[portIndex] || {};
    const identity: Record<string, unknown> = identityByPort[portIndex] || {};
    const moduleType: number | undefined = readNumber(
      identity[CONN_UNIT_PORT_COLUMNS.moduleType.toString()],
    );

    if (moduleType === MODULE_NOT_INSTALLED) {
      continue;
    }

    const measurements: TransceiverMeasurements = {};
    const voltageMillivolts: number | undefined = finiteReading(
      row[c.voltage.toString()],
    );

    setReading(
      measurements,
      TransceiverReadingKind.RxPower,
      opticalPower(row[c.rxPower.toString()]),
    );
    setReading(
      measurements,
      TransceiverReadingKind.TxPower,
      opticalPower(row[c.txPower.toString()]),
    );
    setReading(
      measurements,
      TransceiverReadingKind.Temperature,
      finiteReading(row[c.temperature.toString()]),
    );
    setReading(
      measurements,
      TransceiverReadingKind.Voltage,
      voltageMillivolts !== undefined
        ? TransceiverUnitUtil.roundTo(voltageMillivolts / 1000, 3)
        : undefined,
    );
    setReading(
      measurements,
      TransceiverReadingKind.BiasCurrent,
      finiteReading(row[c.current.toString()]),
    );

    const vendor: string | undefined = readText(
      identity[CONN_UNIT_PORT_COLUMNS.vendor.toString()],
    );
    const serialNumber: string | undefined = readText(
      identity[CONN_UNIT_PORT_COLUMNS.serialNumber.toString()],
    );

    // Every reading "NA" and nothing to say who made it: no optic here.
    if (Object.keys(measurements).length === 0 && !vendor && !serialNumber) {
      continue;
    }

    const result: SnmpTransceiverResult = {
      interfaceIndex: interfaceIndex,
      measurements: measurements,
      source: TransceiverMibSource.BrocadeSfpStat,
    };

    const revision: string | undefined = readText(
      identity[CONN_UNIT_PORT_COLUMNS.revision.toString()],
    );
    const type: string | undefined = describeType(identity);

    if (vendor) {
      result.vendor = vendor;
    }
    if (serialNumber) {
      result.serialNumber = serialNumber;
    }
    if (revision) {
      result.revision = revision;
    }
    if (type) {
      result.type = type;
    }

    results.push(result);
  }

  return results.sort((a: SnmpTransceiverResult, b: SnmpTransceiverResult) => {
    return a.interfaceIndex - b.interfaceIndex;
  });
}

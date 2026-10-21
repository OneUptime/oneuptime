/*
 * Optical transceivers - the SFP, SFP+, SFP28, QSFP and similar modules
 * plugged into a switch port - and their digital optical monitoring (DOM,
 * also called DDM): temperature, supply voltage, laser bias current, and the
 * transmitted and received optical power, each judged against the warning
 * and alarm thresholds the device itself reports.
 *
 * A failing optic, a dirty connector or a bent fibre shows up here first:
 * the received power drifts down for weeks before the link drops. So the
 * data travels in three shapes, one per stage, like SNMP tables do:
 *
 *   SnmpTransceiverResult    - what the probe read for one port, already
 *                              normalized to display units (degrees C,
 *                              volts, milliamps, dBm), whichever vendor MIB
 *                              it came from.
 *   NetworkDeviceTransceiver - what the server keeps per port: the latest
 *                              reading, whether the optic is still there,
 *                              its health and a month of daily received
 *                              power averages for the trend.
 *
 * Every value is in its display unit (TRANSCEIVER_READING_UNITS) from the
 * probe on, so nothing downstream converts again.
 */

import MonitorMetricType from "../MonitorMetricType";

export enum TransceiverReadingKind {
  Temperature = "temperature",
  Voltage = "voltage",
  BiasCurrent = "biasCurrent",
  TxPower = "txPower",
  RxPower = "rxPower",
}

// The order readings are shown in, most telling first.
export const TRANSCEIVER_READING_KINDS: Array<TransceiverReadingKind> = [
  TransceiverReadingKind.RxPower,
  TransceiverReadingKind.TxPower,
  TransceiverReadingKind.Temperature,
  TransceiverReadingKind.Voltage,
  TransceiverReadingKind.BiasCurrent,
];

export const TRANSCEIVER_READING_UNITS: Record<TransceiverReadingKind, string> =
  {
    [TransceiverReadingKind.Temperature]: "°C",
    [TransceiverReadingKind.Voltage]: "V",
    [TransceiverReadingKind.BiasCurrent]: "mA",
    [TransceiverReadingKind.TxPower]: "dBm",
    [TransceiverReadingKind.RxPower]: "dBm",
  };

// The device-scoped metric series each reading is charted as.
export const TRANSCEIVER_READING_METRIC_NAMES: Record<
  TransceiverReadingKind,
  MonitorMetricType
> = {
  [TransceiverReadingKind.Temperature]:
    MonitorMetricType.SnmpTransceiverTemperature,
  [TransceiverReadingKind.Voltage]: MonitorMetricType.SnmpTransceiverVoltage,
  [TransceiverReadingKind.BiasCurrent]:
    MonitorMetricType.SnmpTransceiverBiasCurrent,
  [TransceiverReadingKind.TxPower]: MonitorMetricType.SnmpTransceiverTxPower,
  [TransceiverReadingKind.RxPower]: MonitorMetricType.SnmpTransceiverRxPower,
};

export const TRANSCEIVER_READING_TITLES: Record<
  TransceiverReadingKind,
  string
> = {
  [TransceiverReadingKind.Temperature]: "Temperature",
  [TransceiverReadingKind.Voltage]: "Supply Voltage",
  [TransceiverReadingKind.BiasCurrent]: "Bias Current",
  [TransceiverReadingKind.TxPower]: "TX Power",
  [TransceiverReadingKind.RxPower]: "RX Power",
};

/*
 * The device's own limits for one reading. Any of the four may be missing:
 * plenty of devices report only alarms, and some report none at all.
 */
export interface TransceiverThresholds {
  lowAlarm?: number | undefined;
  lowWarning?: number | undefined;
  highWarning?: number | undefined;
  highAlarm?: number | undefined;
}

export interface TransceiverReading {
  value: number;
  /*
   * The lane, for a multi-lane optic (a QSFP has four lasers, each with its
   * own power and bias), numbered as the device numbers it. Absent for a
   * single-lane optic and for module-wide readings such as temperature.
   */
  lane?: number | undefined;
}

export interface TransceiverMeasurement {
  readings: Array<TransceiverReading>;
  thresholds?: TransceiverThresholds | undefined;
}

export type TransceiverMeasurements = Partial<
  Record<TransceiverReadingKind, TransceiverMeasurement>
>;

/*
 * Conditions a device flags for a module outright, beside its readings.
 * Either one means the link is not carrying light.
 */
export enum TransceiverFault {
  RxLossOfSignal = "rxLossOfSignal",
  TxFault = "txFault",
}

export const TRANSCEIVER_FAULT_DESCRIPTIONS: Record<TransceiverFault, string> =
  {
    [TransceiverFault.RxLossOfSignal]: "Loss of signal on receive",
    [TransceiverFault.TxFault]: "Transmitter fault",
  };

/*
 * Where the readings came from. Stored as a string, so adding a source
 * never breaks a stored snapshot.
 */
export enum TransceiverMibSource {
  // RFC 3433 sensors under their RFC 6933 entity tree - many vendors.
  EntitySensor = "ENTITY-SENSOR-MIB",
  // Cisco's sensor table, with the device's thresholds.
  CiscoEntitySensor = "CISCO-ENTITY-SENSOR-MIB",
  // RFC 3433 sensors with Arista's threshold table beside them.
  AristaEntitySensor = "ARISTA-ENTITY-SENSOR-MIB",
  JuniperDom = "JUNIPER-DOM-MIB",
  MikroTik = "MIKROTIK-MIB",
  // HPE Comware and H3C switches.
  H3cTransceiver = "HH3C-TRANSCEIVER-INFO-MIB",
  // HPE Aruba ProCurve / ArubaOS-Switch.
  HpIcfTransceiver = "HP-ICF-TRANSCEIVER-MIB",
  // Cambium Networks cnMatrix switches (firmware 4.5 and later).
  CambiumTransceiver = "CAMBIUM-NETWORKS-TRANSCEIVER-MIB",
}

// Who made the optic and what it is - all best effort, all optional.
export interface TransceiverIdentity {
  vendor?: string | undefined;
  partNumber?: string | undefined;
  serialNumber?: string | undefined;
  revision?: string | undefined;
  // What the device calls it: "SFP+ 10GBASE-LR", "1000BaseSX SFP".
  type?: string | undefined;
  wavelengthNm?: number | undefined;
}

// One port's optic, as the probe read it.
export interface SnmpTransceiverResult extends TransceiverIdentity {
  interfaceIndex: number;
  /*
   * Empty for an optic that reports no diagnostics at all - a copper SFP or
   * a direct-attach cable is still detected, it just has nothing to read.
   */
  measurements: TransceiverMeasurements;
  faults?: Array<TransceiverFault> | undefined;
  source: TransceiverMibSource;
}

export enum TransceiverHealth {
  // Every reading inside the device's thresholds.
  Healthy = "healthy",
  // A reading past a warning threshold.
  Warning = "warning",
  // A reading past an alarm threshold, or a fault flag.
  Alarm = "alarm",
  // The port had an optic and it is gone while the port is still enabled.
  NotDetected = "notDetected",
  /*
   * Present, but there is nothing to judge it by: the device reports no
   * thresholds for it, or the optic reports no readings.
   */
  NotJudged = "notJudged",
  /*
   * Present in a port that is administratively disabled. Its laser is off
   * by design, so its readings are not judged.
   */
  PortDisabled = "portDisabled",
}

/*
 * A month of daily received power averages, oldest first: the trend, and
 * the baseline the "RX power falling" rule measures against.
 *
 * Compact on purpose - it is stored for every optic of every device and
 * rewritten on every poll - so a day is one number rather than an object.
 */
export interface TransceiverRxPowerHistory {
  // UTC date (YYYY-MM-DD) of dailyAverageDbm[0].
  firstDay: string;
  /*
   * One entry per UTC day from firstDay on. The last entry is the current
   * day's running average; null marks a day with no reading.
   */
  dailyAverageDbm: Array<number | null>;
  // How many readings the last entry averages so far.
  lastDaySamples: number;
}

// One port's optic as the server keeps it.
export interface NetworkDeviceTransceiver extends TransceiverIdentity {
  interfaceIndex: number;
  interfaceName?: string | undefined;
  interfaceAlias?: string | undefined;
  isPresent: boolean;
  // The latest readings. Empty while the optic is not detected.
  measurements: TransceiverMeasurements;
  faults?: Array<TransceiverFault> | undefined;
  source?: TransceiverMibSource | undefined;
  health: TransceiverHealth;
  // ISO timestamps.
  firstSeenAt?: string | undefined;
  lastSeenAt?: string | undefined;
  missingSince?: string | undefined;
  // Consecutive polls the optic has been missing from an enabled port.
  missingPolls?: number | undefined;
  rxPowerHistory?: TransceiverRxPowerHistory | undefined;
}

import { SnmpTableRows } from "./EndpointTableParsers";
import { readNumber, readText } from "./TransceiverParsers";
import {
  FibreChannelCounter,
  FibreChannelCounterValues,
  FibreChannelPortType,
  SnmpFibreChannelPort,
} from "Common/Types/Monitor/SnmpMonitor/SnmpFibreChannel";
import SnmpOctetCounter from "Common/Utils/NetworkDevice/SnmpOctetCounter";

/*
 * What a SAN switch reports about each Fibre Channel port, read from the
 * vendor's own MIB and joined to the IF-MIB interface it belongs to.
 *
 *   Brocade Fabric OS - SW-MIB's swFCPortTable (state, type, a few
 *     Counter32s) and the Fibre Alliance FCMGMT-MIB's connUnitPortStatTable
 *     (every error counter, as 8-byte OCTET STRINGs). Both are indexed by
 *     the port index (port number + 1), not by ifIndex, so a port is joined
 *     to its interface by name: swFCPortSpecifier ("3/15") against IF-MIB's
 *     "FC port 3/15". A logical switch of a Virtual Fabric numbers its
 *     ifIndexes its own way, which is why the name, not arithmetic on the
 *     index, decides.
 *   Cisco MDS 9000 - CISCO-FC-FE-MIB's fcIfTable (operating mode, why an
 *     interface is down) and fcIfErrorTable (every error counter), both
 *     indexed by ifIndex.
 *
 * Column numbers are the MIBs' own, checked against SW-MIB, FCMGMT-MIB and
 * CISCO-FC-FE-MIB: they are not where they are often quoted (CRC errors are
 * swFCPortTable column 22, not 19).
 */

// --- Brocade SW-MIB ---

export const SW_FC_PORT_TABLE_OID: string = "1.3.6.1.4.1.1588.2.1.1.1.6.2";

export const SW_FC_PORT_COLUMNS: {
  phyState: number;
  opStatus: number;
  admStatus: number;
  linkState: number;
  noTxCredits: number;
  rxCrcs: number;
  rxEncOutFrs: number;
  c3Discards: number;
  name: number;
  specifier: number;
  brcdType: number;
} = {
  phyState: 3,
  opStatus: 4,
  admStatus: 5,
  linkState: 6,
  noTxCredits: 20,
  rxCrcs: 22,
  rxEncOutFrs: 26,
  c3Discards: 28,
  name: 36,
  specifier: 37,
  brcdType: 39,
};

// swFCPortOpStatus online(1).
const SW_FC_PORT_ONLINE: number = 1;
// swFCPortAdmStatus offline(2).
const SW_FC_PORT_ADMIN_OFFLINE: number = 2;
// swFCPortLinkState disabled(2).
const SW_FC_PORT_LINK_DISABLED: number = 2;

/*
 * swFCPortPhyState, in the words `switchshow` uses for it. swFCPortDisableReason
 * is not-accessible - it only travels inside swFCPortScn traps - so the
 * physical state is what says why a Brocade port is down.
 */
const SW_FC_PORT_PHY_STATE_TEXT: Record<number, string> = {
  1: "No card",
  2: "No module",
  3: "Laser fault",
  4: "No light",
  5: "No sync",
  7: "Port fault",
  8: "Diagnostics fault",
  9: "Locking to reference",
  10: "Validating",
  11: "Invalid module",
  14: "No signal detected",
};

// swFCPortOpStatus, for a port whose physical state says nothing more.
const SW_FC_PORT_OP_STATUS_TEXT: Record<number, string> = {
  2: "Offline",
  3: "Testing",
  4: "Faulty",
};

// swFCPortBrcdType.
const SW_FC_PORT_BROCADE_TYPES: Record<number, FibreChannelPortType> = {
  2: FibreChannelPortType.Other,
  3: FibreChannelPortType.FL,
  4: FibreChannelPortType.F,
  5: FibreChannelPortType.E,
  6: FibreChannelPortType.G,
  7: FibreChannelPortType.EX,
  8: FibreChannelPortType.D,
};

// --- FCMGMT-MIB (Fibre Alliance), as Brocade implements it ---

export const CONN_UNIT_PORT_STAT_TABLE_OID: string = "1.3.6.1.3.94.4.5";

export const CONN_UNIT_PORT_STAT_COLUMNS: {
  bbCreditZero: number;
  class3Discards: number;
  linkFailures: number;
  invalidCrc: number;
  invalidTxWords: number;
  lossOfSignal: number;
  lossOfSync: number;
} = {
  bbCreditZero: 8,
  class3Discards: 28,
  linkFailures: 39,
  invalidCrc: 40,
  invalidTxWords: 41,
  lossOfSignal: 43,
  lossOfSync: 44,
};

// --- Cisco CISCO-FC-FE-MIB ---

export const CISCO_FC_IF_TABLE_OID: string = "1.3.6.1.4.1.9.9.289.1.1.2";

export const CISCO_FC_IF_COLUMNS: {
  operMode: number;
  operStatusCause: number;
  operStatusCauseDescr: number;
} = {
  operMode: 3,
  operStatusCause: 7,
  operStatusCauseDescr: 8,
};

export const CISCO_FC_IF_ERROR_TABLE_OID: string = "1.3.6.1.4.1.9.9.289.1.2.1";

export const CISCO_FC_IF_ERROR_COLUMNS: {
  linkFailures: number;
  syncLosses: number;
  sigLosses: number;
  invalidTxWords: number;
  invalidCrcs: number;
  framesDiscard: number;
  txBbCreditZero: number;
  timeoutDiscards: number;
  creditLoss: number;
  txBbCreditZeroHc: number;
} = {
  linkFailures: 1,
  syncLosses: 2,
  sigLosses: 3,
  invalidTxWords: 5,
  invalidCrcs: 6,
  framesDiscard: 26,
  // fcIfBBCreditTransistionFromZero: "increments if the transmit b2b credit is zero".
  txBbCreditZero: 28,
  timeoutDiscards: 35,
  creditLoss: 37,
  // fcHCIfBBCreditTransistionFromZero, the same counter in 64 bits.
  txBbCreditZeroHc: 40,
};

// FcPortTypes (CISCO-ST-TC), as fcIfOperMode reports it.
const CISCO_FC_PORT_TYPES: Record<number, FibreChannelPortType> = {
  1: FibreChannelPortType.Auto,
  2: FibreChannelPortType.F,
  3: FibreChannelPortType.FL,
  4: FibreChannelPortType.E,
  5: FibreChannelPortType.Other,
  6: FibreChannelPortType.F,
  7: FibreChannelPortType.SD,
  8: FibreChannelPortType.Other,
  9: FibreChannelPortType.N,
  10: FibreChannelPortType.NL,
  11: FibreChannelPortType.N,
  12: FibreChannelPortType.TE,
  13: FibreChannelPortType.Other,
  15: FibreChannelPortType.Other,
  16: FibreChannelPortType.NP,
  17: FibreChannelPortType.TF,
  18: FibreChannelPortType.TNP,
};

// fcIfOperStatusCause none(2): the interface is not down.
const CISCO_FC_CAUSE_NONE: number = 2;

/*
 * FcIfOperStatusReason, for an agent that leaves fcIfOperStatusCauseDescr
 * empty: the common causes, in the words `show interface` prints them.
 */
const CISCO_FC_CAUSE_TEXT: Record<number, string> = {
  3: "Hardware failure",
  4: "Loopback diagnostics failure",
  5: "Error disabled",
  6: "Software failure",
  7: "Link failure or not-connected",
  8: "Offline",
  9: "Non-participating",
  10: "Initializing",
  11: "VSAN inactive",
  12: "Administratively down",
  13: "Port channel administratively down",
  14: "Suspended by port channel",
  24: "Zone merge failure",
  25: "VSAN mismatch",
  29: "SFP not present",
  30: "SFP vendor not supported",
  43: "Port channel members down",
};

// A port index (Brocade) is a positive 32-bit integer.
const PORT_INDEX: RegExp = /^[1-9]\d{0,9}$/;

// "FC port 3/15", "3/15", "port 15".
const FC_PORT_NAME: RegExp = /^(?:fc\s*port\s+)?(\d+)\/(\d+)$/i;
const BARE_PORT_NUMBER: RegExp = /^(?:fc\s*port\s+)?(\d+)$/i;

/*
 * On a switch that is not a logical switch of a Virtual Fabric, Fabric OS
 * gives port N (front-panel number, port index N + 1) the ifIndex
 * 0x40000000 + N - which is this offset plus the port index.
 */
export const BROCADE_FC_PORT_IF_INDEX_OFFSET: number = 0x3fffffff;

// A walked interface: its ifIndex and every name it goes by.
export interface FibreChannelInterfaceCandidate {
  interfaceIndex: number;
  names: Array<string | undefined>;
}

function column(row: Record<string, unknown>, columnNumber: number): unknown {
  return row[columnNumber.toString()];
}

function counterValue(value: unknown): number | undefined {
  return SnmpOctetCounter.decode(value);
}

function setCounter(
  counters: FibreChannelCounterValues,
  counter: FibreChannelCounter,
  value: number | undefined,
): void {
  if (value !== undefined) {
    counters[counter] = value;
  }
}

/*
 * The slot and port a name or a port specifier stands for, as "slot/port":
 * "FC port 3/15" and "3/15" are "3/15", and a fixed switch's "15" (or
 * "FC port 15") is "0/15", its only slot.
 */
export function brocadePortKey(text: string | undefined): string | undefined {
  const trimmed: string = (text || "").trim();

  const slotted: RegExpMatchArray | null = trimmed.match(FC_PORT_NAME);

  if (slotted && slotted[1] !== undefined && slotted[2] !== undefined) {
    return `${parseInt(slotted[1], 10)}/${parseInt(slotted[2], 10)}`;
  }

  const bare: RegExpMatchArray | null = trimmed.match(BARE_PORT_NUMBER);

  if (bare && bare[1] !== undefined) {
    return `0/${parseInt(bare[1], 10)}`;
  }

  return undefined;
}

/*
 * The last arc of an FCMGMT row index is the port index; everything before
 * it is the connUnitId - sixteen octets, which Fabric OS fills with the
 * switch's WWN and eight zeros. One switch - one logical switch - is one
 * connUnit.
 */
export function splitConnUnitPortIndex(
  rowIndex: string,
): { unit: string; portIndex: string } | undefined {
  const lastDot: number = rowIndex.lastIndexOf(".");

  if (lastDot <= 0) {
    return undefined;
  }

  const portIndex: string = rowIndex.substring(lastDot + 1);

  return PORT_INDEX.test(portIndex)
    ? { unit: rowIndex.substring(0, lastDot), portIndex: portIndex }
    : undefined;
}

/*
 * FCMGMT rows by port index, for one connUnit: the one with the most rows.
 * An agent answers for its own switch only; a walk that holds two units
 * (a capture stitched from two switches) keeps the fuller one rather than
 * letting one switch's port 5 overwrite the other's.
 */
export function rowsOfMainConnUnit(rows: SnmpTableRows): SnmpTableRows {
  const rowsByUnit: Map<string, SnmpTableRows> = new Map();

  for (const rowIndex of Object.keys(rows)) {
    const split: { unit: string; portIndex: string } | undefined =
      splitConnUnitPortIndex(rowIndex);

    if (!split) {
      continue;
    }

    const unitRows: SnmpTableRows = rowsByUnit.get(split.unit) || {};
    unitRows[split.portIndex] = {
      ...(unitRows[split.portIndex] || {}),
      ...(rows[rowIndex] || {}),
    };
    rowsByUnit.set(split.unit, unitRows);
  }

  let best: SnmpTableRows = {};
  let bestUnit: string | undefined = undefined;

  for (const [unit, unitRows] of rowsByUnit) {
    const size: number = Object.keys(unitRows).length;
    const bestSize: number = Object.keys(best).length;

    if (
      bestUnit === undefined ||
      size > bestSize ||
      (size === bestSize && unit < bestUnit)
    ) {
      best = unitRows;
      bestUnit = unit;
    }
  }

  return best;
}

/*
 * Which interface each Brocade port index is: by its specifier against the
 * interfaces' names first, and only for a port no name matched, by Fabric
 * OS's ifIndex numbering (BROCADE_FC_PORT_IF_INDEX_OFFSET) - when that
 * interface exists and no other port claimed it.
 */
export function mapBrocadePortsToInterfaces(data: {
  portRows: SnmpTableRows;
  interfaces: Array<FibreChannelInterfaceCandidate>;
}): Map<string, number> {
  const interfaceByPortKey: Map<string, number> = new Map();
  const interfaceIndexes: Set<number> = new Set();

  for (const candidate of data.interfaces) {
    interfaceIndexes.add(candidate.interfaceIndex);

    for (const name of candidate.names) {
      const key: string | undefined = brocadePortKey(name);

      if (key && !interfaceByPortKey.has(key)) {
        interfaceByPortKey.set(key, candidate.interfaceIndex);
      }
    }
  }

  const byPortIndex: Map<string, number> = new Map();
  const claimed: Set<number> = new Set();

  const portIndexes: Array<string> = Object.keys(data.portRows)
    .filter((portIndex: string) => {
      return PORT_INDEX.test(portIndex);
    })
    .sort((a: string, b: string) => {
      return parseInt(a, 10) - parseInt(b, 10);
    });

  for (const portIndex of portIndexes) {
    const specifier: string | undefined = readText(
      column(data.portRows[portIndex] || {}, SW_FC_PORT_COLUMNS.specifier),
    );
    const key: string | undefined = brocadePortKey(specifier);
    const byName: number | undefined = key
      ? interfaceByPortKey.get(key)
      : undefined;

    if (byName !== undefined && !claimed.has(byName)) {
      byPortIndex.set(portIndex, byName);
      claimed.add(byName);
    }
  }

  for (const portIndex of portIndexes) {
    if (byPortIndex.has(portIndex)) {
      continue;
    }

    const byNumbering: number =
      BROCADE_FC_PORT_IF_INDEX_OFFSET + parseInt(portIndex, 10);

    if (interfaceIndexes.has(byNumbering) && !claimed.has(byNumbering)) {
      byPortIndex.set(portIndex, byNumbering);
      claimed.add(byNumbering);
    }
  }

  return byPortIndex;
}

// Why a Brocade port is not online, when it is not.
export function brocadeDownReason(
  row: Record<string, unknown>,
): string | undefined {
  const opStatus: number | undefined = readNumber(
    column(row, SW_FC_PORT_COLUMNS.opStatus),
  );

  if (opStatus === undefined || opStatus === SW_FC_PORT_ONLINE) {
    return undefined;
  }

  const admStatus: number | undefined = readNumber(
    column(row, SW_FC_PORT_COLUMNS.admStatus),
  );
  const linkState: number | undefined = readNumber(
    column(row, SW_FC_PORT_COLUMNS.linkState),
  );

  if (
    admStatus === SW_FC_PORT_ADMIN_OFFLINE ||
    linkState === SW_FC_PORT_LINK_DISABLED
  ) {
    return "Disabled";
  }

  const phyState: number | undefined = readNumber(
    column(row, SW_FC_PORT_COLUMNS.phyState),
  );

  return (
    (phyState !== undefined
      ? SW_FC_PORT_PHY_STATE_TEXT[phyState]
      : undefined) || SW_FC_PORT_OP_STATUS_TEXT[opStatus]
  );
}

/*
 * The Brocade ports, by ifIndex. The FCMGMT counters are preferred - every
 * error counter, in 64 bits - and SW-MIB's Counter32s stand in for a port
 * FCMGMT has no row for (the FA-MIB is turned off), which then reports its
 * CRC errors, encoding errors outside frames, class 3 discards and credit
 * zero, and no link failures or losses of sync or signal.
 */
export function parseBrocadeFibreChannelPorts(data: {
  portRows: SnmpTableRows;
  statRows?: SnmpTableRows | undefined;
  interfaces: Array<FibreChannelInterfaceCandidate>;
}): Map<number, SnmpFibreChannelPort> {
  const byInterface: Map<number, SnmpFibreChannelPort> = new Map();
  const interfaceByPort: Map<string, number> = mapBrocadePortsToInterfaces({
    portRows: data.portRows,
    interfaces: data.interfaces,
  });
  const statRows: SnmpTableRows = rowsOfMainConnUnit(data.statRows || {});
  const s: typeof CONN_UNIT_PORT_STAT_COLUMNS = CONN_UNIT_PORT_STAT_COLUMNS;
  const p: typeof SW_FC_PORT_COLUMNS = SW_FC_PORT_COLUMNS;

  for (const [portIndex, interfaceIndex] of interfaceByPort) {
    const row: Record<string, unknown> = data.portRows[portIndex] || {};
    const stats: Record<string, unknown> | undefined = statRows[portIndex];
    const counters: FibreChannelCounterValues = {};

    if (stats && Object.keys(stats).length > 0) {
      setCounter(
        counters,
        FibreChannelCounter.CrcErrors,
        counterValue(column(stats, s.invalidCrc)),
      );
      setCounter(
        counters,
        FibreChannelCounter.InvalidTransmissionWords,
        counterValue(column(stats, s.invalidTxWords)),
      );
      setCounter(
        counters,
        FibreChannelCounter.LinkFailures,
        counterValue(column(stats, s.linkFailures)),
      );
      setCounter(
        counters,
        FibreChannelCounter.LossOfSync,
        counterValue(column(stats, s.lossOfSync)),
      );
      setCounter(
        counters,
        FibreChannelCounter.LossOfSignal,
        counterValue(column(stats, s.lossOfSignal)),
      );
      setCounter(
        counters,
        FibreChannelCounter.Discards,
        counterValue(column(stats, s.class3Discards)),
      );
      setCounter(
        counters,
        FibreChannelCounter.BbCreditZero,
        counterValue(column(stats, s.bbCreditZero)),
      );
    } else {
      setCounter(
        counters,
        FibreChannelCounter.CrcErrors,
        counterValue(column(row, p.rxCrcs)),
      );
      setCounter(
        counters,
        FibreChannelCounter.InvalidTransmissionWords,
        counterValue(column(row, p.rxEncOutFrs)),
      );
      setCounter(
        counters,
        FibreChannelCounter.Discards,
        counterValue(column(row, p.c3Discards)),
      );
      setCounter(
        counters,
        FibreChannelCounter.BbCreditZero,
        counterValue(column(row, p.noTxCredits)),
      );
    }

    const typeValue: number | undefined = readNumber(column(row, p.brcdType));
    const port: SnmpFibreChannelPort = {};
    const portType: FibreChannelPortType | undefined =
      typeValue !== undefined ? SW_FC_PORT_BROCADE_TYPES[typeValue] : undefined;
    const downReason: string | undefined = brocadeDownReason(row);

    if (portType) {
      port.portType = portType;
    }

    if (downReason) {
      port.downReason = downReason;
    }

    if (Object.keys(counters).length > 0) {
      port.counters = counters;
    }

    if (Object.keys(port).length > 0) {
      byInterface.set(interfaceIndex, port);
    }
  }

  return byInterface;
}

// Why an MDS interface is down: the switch's own words first.
export function ciscoDownReason(
  row: Record<string, unknown>,
): string | undefined {
  const cause: number | undefined = readNumber(
    column(row, CISCO_FC_IF_COLUMNS.operStatusCause),
  );

  if (cause === undefined || cause === CISCO_FC_CAUSE_NONE) {
    return undefined;
  }

  const description: string | undefined = readText(
    column(row, CISCO_FC_IF_COLUMNS.operStatusCauseDescr),
  );

  if (description && description.toLowerCase() !== "none") {
    return description;
  }

  return CISCO_FC_CAUSE_TEXT[cause];
}

/*
 * The MDS interfaces, by ifIndex: only those IF-MIB walked, and only those
 * the Fibre Channel tables have a row for (fc interfaces and Fibre Channel
 * port channels; never the Ethernet management port).
 */
export function parseCiscoFibreChannelPorts(data: {
  interfaceRows: SnmpTableRows;
  errorRows: SnmpTableRows;
  interfaces: Array<FibreChannelInterfaceCandidate>;
}): Map<number, SnmpFibreChannelPort> {
  const byInterface: Map<number, SnmpFibreChannelPort> = new Map();
  const walked: Set<number> = new Set(
    data.interfaces.map((candidate: FibreChannelInterfaceCandidate) => {
      return candidate.interfaceIndex;
    }),
  );
  const e: typeof CISCO_FC_IF_ERROR_COLUMNS = CISCO_FC_IF_ERROR_COLUMNS;

  const rowIndexes: Set<string> = new Set([
    ...Object.keys(data.interfaceRows),
    ...Object.keys(data.errorRows),
  ]);

  for (const rowIndex of rowIndexes) {
    if (!PORT_INDEX.test(rowIndex)) {
      continue;
    }

    const interfaceIndex: number = parseInt(rowIndex, 10);

    if (!walked.has(interfaceIndex)) {
      continue;
    }

    const row: Record<string, unknown> = data.interfaceRows[rowIndex] || {};
    const errors: Record<string, unknown> = data.errorRows[rowIndex] || {};
    const counters: FibreChannelCounterValues = {};

    setCounter(
      counters,
      FibreChannelCounter.CrcErrors,
      counterValue(column(errors, e.invalidCrcs)),
    );
    setCounter(
      counters,
      FibreChannelCounter.InvalidTransmissionWords,
      counterValue(column(errors, e.invalidTxWords)),
    );
    setCounter(
      counters,
      FibreChannelCounter.LinkFailures,
      counterValue(column(errors, e.linkFailures)),
    );
    setCounter(
      counters,
      FibreChannelCounter.LossOfSync,
      counterValue(column(errors, e.syncLosses)),
    );
    setCounter(
      counters,
      FibreChannelCounter.LossOfSignal,
      counterValue(column(errors, e.sigLosses)),
    );
    setCounter(
      counters,
      FibreChannelCounter.Discards,
      counterValue(column(errors, e.framesDiscard)),
    );
    setCounter(
      counters,
      FibreChannelCounter.TimeoutDiscards,
      counterValue(column(errors, e.timeoutDiscards)),
    );
    setCounter(
      counters,
      FibreChannelCounter.CreditLoss,
      counterValue(column(errors, e.creditLoss)),
    );
    // The 64-bit credit counter where the switch has it.
    setCounter(
      counters,
      FibreChannelCounter.BbCreditZero,
      counterValue(column(errors, e.txBbCreditZeroHc)) ??
        counterValue(column(errors, e.txBbCreditZero)),
    );

    const modeValue: number | undefined = readNumber(
      column(row, CISCO_FC_IF_COLUMNS.operMode),
    );
    const port: SnmpFibreChannelPort = {};
    const portType: FibreChannelPortType | undefined =
      modeValue !== undefined ? CISCO_FC_PORT_TYPES[modeValue] : undefined;
    const downReason: string | undefined = ciscoDownReason(row);

    if (portType) {
      port.portType = portType;
    }

    if (downReason) {
      port.downReason = downReason;
    }

    if (Object.keys(counters).length > 0) {
      port.counters = counters;
    }

    if (Object.keys(port).length > 0) {
      byInterface.set(interfaceIndex, port);
    }
  }

  return byInterface;
}

import { SnmpTableRows } from "./EndpointTableParsers";
import {
  ARISTA_ENT_SENSOR_THRESHOLD_COLUMNS,
  ARISTA_ENT_SENSOR_THRESHOLD_TABLE_OID,
  CISCO_ENT_SENSOR_THRESHOLD_COLUMNS,
  CISCO_ENT_SENSOR_THRESHOLD_TABLE_OID,
  CISCO_ENT_SENSOR_VALUE_TABLE_OID,
  CN_TRANSCEIVER_COLUMNS,
  CN_TRANSCEIVER_PORT_TABLE_OID,
  ENT_ALIAS_MAPPING_COLUMNS,
  ENT_ALIAS_MAPPING_TABLE_OID,
  ENT_PHYSICAL_COLUMNS,
  ENT_PHYSICAL_TABLE_OID,
  ENT_PHY_SENSOR_COLUMNS,
  ENT_PHY_SENSOR_TABLE_OID,
  EntitySensorFlavor,
  HH3C_TRANSCEIVER_COLUMNS,
  HH3C_TRANSCEIVER_INFO_TABLE_OID,
  HPICF_XCVR_COLUMNS,
  HPICF_XCVR_INFO_TABLE_OID,
  JNX_DOM_CURRENT_COLUMNS,
  JNX_DOM_CURRENT_TABLE_OID,
  JNX_DOM_LANE_COLUMNS,
  JNX_DOM_LANE_TABLE_OID,
  MTXR_OPTICAL_COLUMNS,
  MTXR_OPTICAL_TABLE_OID,
  TransceiverInterfaceCandidate,
  TransceiverInterfaceIndex,
  domSensorIndexes,
  parseCambiumTransceivers,
  parseEntitySensorTransceivers,
  parseH3cTransceivers,
  parseHpIcfTransceivers,
  parseJuniperDomTransceivers,
  parseMikroTikTransceivers,
  readNumber,
} from "./TransceiverParsers";
import {
  SnmpTransceiverResult,
  TransceiverMibSource,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTransceiver";
import TransceiverMibSourceUtil from "Common/Utils/NetworkDevice/TransceiverMibSourceUtil";
import crypto from "crypto";

/*
 * Reads a device's transceivers during its poll, as cheaply as the data
 * allows.
 *
 * Most of what a transceiver reports does not change between polls: who
 * made it, its thresholds, where it sits in the entity tree, which port it
 * is. Only its five readings do. So the first poll of a device reads
 * everything, and every later poll reads the readings alone - with GETs of
 * exactly the sensors that are optics, rather than walks of whole tables -
 * until something says the static part may have changed:
 *
 *   - an optic was inserted, removed or swapped: the set of optical
 *     sensors, the entity tree's serial numbers, or the vendor table's rows
 *     and serials no longer match what was cached;
 *   - an hour has passed (TRANSCEIVER_STATIC_CACHE_TTL_MS), so a threshold
 *     changed on the device is picked up within the hour;
 *   - the probe restarted.
 *
 * A device with no transceiver MIB at all costs one request per source it
 * is tried with: the first column of a table the agent does not implement
 * comes back as the next object outside it, and the walk ends there.
 *
 * Nothing is reported from a partial read. A table longer than its row cap,
 * a walk that runs out of time or a timeout throws, and the caller reports
 * the walk as failed - so the server keeps the device's last good optics
 * instead of reading a cut-off table as optics that disappeared.
 */

// Wall-clock budget for the whole transceiver phase of one poll.
export const TRANSCEIVER_WALK_BUDGET_MS: number = 20000;

// How long the static part of a device's transceivers is trusted.
export const TRANSCEIVER_STATIC_CACHE_TTL_MS: number = 60 * 60 * 1000;

// Devices whose static part one probe keeps (least recently used go first).
export const TRANSCEIVER_STATIC_CACHE_MAX_DEVICES: number = 2000;

// Row caps: far above a real device, and a read past them is not trusted.
export const MAX_SENSOR_ROWS: number = 4096;
export const MAX_ENTITY_ROWS: number = 8192;
export const MAX_ALIAS_ROWS: number = 8192;
export const MAX_THRESHOLD_ROWS: number = 16384;
export const MAX_PORT_TABLE_ROWS: number = 1024;
export const MAX_LANE_ROWS: number = 4096;

/*
 * How the walker reaches the device. Bound to one SNMP session and one
 * deadline by the caller, so the walker never sees net-snmp at all.
 */
export interface TransceiverSnmpAccess {
  /*
   * Walks columns of a table (the TABLE oid; ".1" is appended), at most
   * maxRows rows per column. Rejects on an SNMP error or once the deadline
   * has passed.
   */
  walkColumns: (
    tableOid: string,
    columns: Array<number>,
    maxRows: number,
  ) => Promise<SnmpTableRows>;
  /*
   * GETs exactly these cells. A cell the agent does not answer is missing
   * from the result.
   */
  getCells: (
    tableOid: string,
    columns: Array<number>,
    rowIndexes: Array<string>,
  ) => Promise<SnmpTableRows>;
}

export interface TransceiverWalkInput {
  sysObjectId?: string | undefined;
  interfaces: Array<TransceiverInterfaceCandidate>;
  /*
   * entPhysicalTable rows the poll already walked for the device's own
   * identity (class, revisions, serial, manufacturer, model). Reused rather
   * than walked twice; walked here when absent.
   */
  entityRows?: SnmpTableRows | undefined;
  access: TransceiverSnmpAccess;
  // The device, for the static cache. No key, no caching.
  cacheKey?: string | undefined;
  // Epoch milliseconds, for tests.
  nowMs?: number | undefined;
}

export interface TransceiverWalkResult {
  results: Array<SnmpTransceiverResult>;
  // The MIB that answered; undefined when none did.
  source?: TransceiverMibSource | undefined;
}

export class TransceiverWalkError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TransceiverWalkError";
  }
}

interface CacheEntry {
  source: TransceiverMibSource;
  signature: string;
  storedAtMs: number;
  // Rows read on a full walk and reused until the signature changes.
  statics: Record<string, SnmpTableRows>;
}

/*
 * The static part of each device's transceivers, per probe process. Bounded
 * by device count; a Map's insertion order doubles as the LRU order.
 */
export class TransceiverStaticCache {
  private readonly entries: Map<string, CacheEntry> = new Map();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  public constructor(
    maxEntries: number = TRANSCEIVER_STATIC_CACHE_MAX_DEVICES,
    ttlMs: number = TRANSCEIVER_STATIC_CACHE_TTL_MS,
  ) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  public get(data: {
    key: string | undefined;
    source: TransceiverMibSource;
    signature: string;
    nowMs: number;
  }): Record<string, SnmpTableRows> | undefined {
    if (!data.key) {
      return undefined;
    }

    const entry: CacheEntry | undefined = this.entries.get(data.key);

    if (
      !entry ||
      entry.source !== data.source ||
      entry.signature !== data.signature ||
      data.nowMs - entry.storedAtMs >= this.ttlMs ||
      data.nowMs < entry.storedAtMs
    ) {
      return undefined;
    }

    // Most recently used goes to the back.
    this.entries.delete(data.key);
    this.entries.set(data.key, entry);

    return entry.statics;
  }

  public set(data: {
    key: string | undefined;
    source: TransceiverMibSource;
    signature: string;
    nowMs: number;
    statics: Record<string, SnmpTableRows>;
  }): void {
    if (!data.key) {
      return;
    }

    this.entries.delete(data.key);
    this.entries.set(data.key, {
      source: data.source,
      signature: data.signature,
      storedAtMs: data.nowMs,
      statics: data.statics,
    });

    while (this.entries.size > this.maxEntries) {
      const oldest: string | undefined = this.entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.entries.delete(oldest);
    }
  }

  public delete(key: string | undefined): void {
    if (key) {
      this.entries.delete(key);
    }
  }

  public clear(): void {
    this.entries.clear();
  }

  public get size(): number {
    return this.entries.size;
  }
}

// --- Vendor tables indexed by ifIndex ---

interface PortTableSpec {
  source: TransceiverMibSource;
  tableOid: string;
  /*
   * Walked on every poll. The first column decides whether the table
   * answered at all, and with the rest it is what tells a swapped optic
   * apart (its serial number is one of them, where the MIB has one).
   */
  pollColumns: Array<number>;
  // Walked on a full read only: thresholds and identity.
  staticColumns: Array<number>;
  /*
   * The column that changes when an optic is swapped (its serial number),
   * so a swap re-reads the static columns. Absent when the MIB has none:
   * a row appearing or disappearing is then the only signal.
   */
  identityColumn?: number | undefined;
  parse: (data: {
    rows: SnmpTableRows;
    laneRows?: SnmpTableRows | undefined;
    interfaces: TransceiverInterfaceIndex;
  }) => Array<SnmpTransceiverResult>;
}

function columnRange(from: number, to: number): Array<number> {
  const columns: Array<number> = [];
  for (let value: number = from; value <= to; value++) {
    columns.push(value);
  }
  return columns;
}

const JUNIPER_SPEC: PortTableSpec = {
  source: TransceiverMibSource.JuniperDom,
  tableOid: JNX_DOM_CURRENT_TABLE_OID,
  pollColumns: [
    JNX_DOM_CURRENT_COLUMNS.rxPower,
    JNX_DOM_CURRENT_COLUMNS.txBias,
    JNX_DOM_CURRENT_COLUMNS.txPower,
    JNX_DOM_CURRENT_COLUMNS.temperature,
    JNX_DOM_CURRENT_COLUMNS.voltage,
    JNX_DOM_CURRENT_COLUMNS.laneCount,
  ],
  staticColumns: [
    ...columnRange(
      JNX_DOM_CURRENT_COLUMNS.rxPowerHighAlarm,
      JNX_DOM_CURRENT_COLUMNS.temperatureLowWarning,
    ),
    ...columnRange(
      JNX_DOM_CURRENT_COLUMNS.voltageHighAlarm,
      JNX_DOM_CURRENT_COLUMNS.voltageLowWarning,
    ),
  ],
  parse: parseJuniperDomTransceivers,
};

const MIKROTIK_SPEC: PortTableSpec = {
  source: TransceiverMibSource.MikroTik,
  tableOid: MTXR_OPTICAL_TABLE_OID,
  pollColumns: [
    MTXR_OPTICAL_COLUMNS.name,
    MTXR_OPTICAL_COLUMNS.vendorSerial,
    MTXR_OPTICAL_COLUMNS.vendorName,
    MTXR_OPTICAL_COLUMNS.rxLoss,
    MTXR_OPTICAL_COLUMNS.txFault,
    MTXR_OPTICAL_COLUMNS.temperature,
    MTXR_OPTICAL_COLUMNS.supplyVoltage,
    MTXR_OPTICAL_COLUMNS.txBiasCurrent,
    MTXR_OPTICAL_COLUMNS.txPower,
    MTXR_OPTICAL_COLUMNS.rxPower,
  ],
  staticColumns: [MTXR_OPTICAL_COLUMNS.wavelength],
  identityColumn: MTXR_OPTICAL_COLUMNS.vendorSerial,
  parse: parseMikroTikTransceivers,
};

const H3C_SPEC: PortTableSpec = {
  source: TransceiverMibSource.H3cTransceiver,
  tableOid: HH3C_TRANSCEIVER_INFO_TABLE_OID,
  pollColumns: [
    HH3C_TRANSCEIVER_COLUMNS.serialNumber,
    HH3C_TRANSCEIVER_COLUMNS.vendorName,
    HH3C_TRANSCEIVER_COLUMNS.curTxPower,
    HH3C_TRANSCEIVER_COLUMNS.curRxPower,
    HH3C_TRANSCEIVER_COLUMNS.temperature,
    HH3C_TRANSCEIVER_COLUMNS.voltage,
    HH3C_TRANSCEIVER_COLUMNS.biasCurrent,
    HH3C_TRANSCEIVER_COLUMNS.errors,
  ],
  staticColumns: [
    HH3C_TRANSCEIVER_COLUMNS.type,
    HH3C_TRANSCEIVER_COLUMNS.waveLength,
    ...columnRange(
      HH3C_TRANSCEIVER_COLUMNS.tempHiAlarm,
      HH3C_TRANSCEIVER_COLUMNS.rcvPwrLoWarn,
    ),
    HH3C_TRANSCEIVER_COLUMNS.revisionNumber,
    HH3C_TRANSCEIVER_COLUMNS.partNumber,
    ...columnRange(
      HH3C_TRANSCEIVER_COLUMNS.pwrOutHiAlarmDbm,
      HH3C_TRANSCEIVER_COLUMNS.rcvPwrLoWarnDbm,
    ),
  ],
  identityColumn: HH3C_TRANSCEIVER_COLUMNS.serialNumber,
  parse: parseH3cTransceivers,
};

const HP_ICF_SPEC: PortTableSpec = {
  source: TransceiverMibSource.HpIcfTransceiver,
  tableOid: HPICF_XCVR_INFO_TABLE_OID,
  pollColumns: [
    HPICF_XCVR_COLUMNS.serial,
    HPICF_XCVR_COLUMNS.model,
    HPICF_XCVR_COLUMNS.diagnostics,
    HPICF_XCVR_COLUMNS.temperature,
    HPICF_XCVR_COLUMNS.voltage,
    HPICF_XCVR_COLUMNS.bias,
    HPICF_XCVR_COLUMNS.txPower,
    HPICF_XCVR_COLUMNS.rxPower,
  ],
  staticColumns: [
    HPICF_XCVR_COLUMNS.type,
    HPICF_XCVR_COLUMNS.wavelength,
    ...columnRange(
      HPICF_XCVR_COLUMNS.tempHiAlarm,
      HPICF_XCVR_COLUMNS.rcvPwrLoWarn,
    ),
  ],
  identityColumn: HPICF_XCVR_COLUMNS.serial,
  parse: parseHpIcfTransceivers,
};

const CAMBIUM_SPEC: PortTableSpec = {
  source: TransceiverMibSource.CambiumTransceiver,
  tableOid: CN_TRANSCEIVER_PORT_TABLE_OID,
  pollColumns: [
    CN_TRANSCEIVER_COLUMNS.vendorSerial,
    CN_TRANSCEIVER_COLUMNS.vendorName,
    CN_TRANSCEIVER_COLUMNS.temperature,
    CN_TRANSCEIVER_COLUMNS.voltage,
    CN_TRANSCEIVER_COLUMNS.txBias,
    CN_TRANSCEIVER_COLUMNS.txPower,
    CN_TRANSCEIVER_COLUMNS.rxPower,
  ],
  staticColumns: [
    CN_TRANSCEIVER_COLUMNS.type,
    CN_TRANSCEIVER_COLUMNS.wavelength,
    CN_TRANSCEIVER_COLUMNS.vendorPartNo,
    CN_TRANSCEIVER_COLUMNS.vendorRevision,
  ],
  identityColumn: CN_TRANSCEIVER_COLUMNS.vendorSerial,
  parse: parseCambiumTransceivers,
};

const PORT_TABLE_SPECS: Partial<Record<TransceiverMibSource, PortTableSpec>> =
  {
    [TransceiverMibSource.JuniperDom]: JUNIPER_SPEC,
    [TransceiverMibSource.MikroTik]: MIKROTIK_SPEC,
    [TransceiverMibSource.H3cTransceiver]: H3C_SPEC,
    [TransceiverMibSource.HpIcfTransceiver]: HP_ICF_SPEC,
    [TransceiverMibSource.CambiumTransceiver]: CAMBIUM_SPEC,
  };

// Columns of entPhysicalTable the tree needs, beyond the identity walk.
const ENTITY_TREE_COLUMNS: Array<number> = [
  ENT_PHYSICAL_COLUMNS.entPhysicalDescr,
  ENT_PHYSICAL_COLUMNS.entPhysicalContainedIn,
  ENT_PHYSICAL_COLUMNS.entPhysicalName,
];

// The identity columns, when the poll did not already walk them.
const ENTITY_IDENTITY_COLUMNS: Array<number> = [
  ENT_PHYSICAL_COLUMNS.entPhysicalClass,
  ENT_PHYSICAL_COLUMNS.entPhysicalHardwareRev,
  ENT_PHYSICAL_COLUMNS.entPhysicalSerialNum,
  ENT_PHYSICAL_COLUMNS.entPhysicalMfgName,
  ENT_PHYSICAL_COLUMNS.entPhysicalModelName,
];

const TIMEOUT_TEXT_REGEX: RegExp = /time(d)?\s?out|time budget|deadline/i;

export function mergeTableRows(
  ...tables: Array<SnmpTableRows | undefined>
): SnmpTableRows {
  const merged: SnmpTableRows = {};

  for (const table of tables) {
    for (const rowIndex of Object.keys(table || {})) {
      merged[rowIndex] = { ...(merged[rowIndex] || {}), ...table![rowIndex] };
    }
  }

  return merged;
}

function rowCount(rows: SnmpTableRows): number {
  return Object.keys(rows).length;
}

function fingerprint(parts: Array<string>): string {
  return crypto.createHash("sha1").update(parts.join("\n")).digest("hex");
}

function textOf(value: unknown): string {
  if (Buffer.isBuffer(value)) {
    return value.toString("hex");
  }
  return value === undefined || value === null ? "" : String(value);
}

export default class TransceiverWalker {
  // One cache per probe process.
  public static readonly cache: TransceiverStaticCache =
    new TransceiverStaticCache();

  /*
   * The device's transceivers from the first source that answers. Throws
   * (TransceiverWalkError, or the SNMP error itself) when the read could
   * not be completed; resolves with no results and no source when no
   * source answered at all.
   */
  public static async collect(
    input: TransceiverWalkInput,
  ): Promise<TransceiverWalkResult> {
    const interfaces: TransceiverInterfaceIndex = new TransceiverInterfaceIndex(
      input.interfaces,
    );

    for (const source of TransceiverMibSourceUtil.getSourcesForDevice(
      input.sysObjectId,
    )) {
      const results: Array<SnmpTransceiverResult> | undefined =
        await TransceiverWalker.collectFrom({
          source: source,
          input: input,
          interfaces: interfaces,
        });

      if (results) {
        return { results: results, source: source };
      }
    }

    return { results: [] };
  }

  private static async collectFrom(data: {
    source: TransceiverMibSource;
    input: TransceiverWalkInput;
    interfaces: TransceiverInterfaceIndex;
  }): Promise<Array<SnmpTransceiverResult> | undefined> {
    switch (data.source) {
      case TransceiverMibSource.CiscoEntitySensor:
        return TransceiverWalker.collectEntitySensors({ ...data, flavor: "cisco" });
      case TransceiverMibSource.AristaEntitySensor:
        return TransceiverWalker.collectEntitySensors({
          ...data,
          flavor: "arista",
        });
      case TransceiverMibSource.EntitySensor:
        return TransceiverWalker.collectEntitySensors({
          ...data,
          flavor: "standard",
        });
      default: {
        const spec: PortTableSpec | undefined = PORT_TABLE_SPECS[data.source];
        return spec
          ? TransceiverWalker.collectPortTable({ ...data, spec: spec })
          : undefined;
      }
    }
  }

  /*
   * The first walk of a source: undefined when the source is simply not
   * there (an SNMP error such as noSuchName from a v1 agent), so the next
   * source is tried. A timeout is not "not there" - it is a failed read,
   * and the caller must not take the empty answer of the next source as
   * every optic being gone.
   */
  private static async probeColumn(data: {
    input: TransceiverWalkInput;
    tableOid: string;
    column: number;
    maxRows: number;
  }): Promise<SnmpTableRows | undefined> {
    let rows: SnmpTableRows;

    try {
      rows = await data.input.access.walkColumns(
        data.tableOid,
        [data.column],
        data.maxRows,
      );
    } catch (err) {
      if (TransceiverWalker.isTimeout(err)) {
        throw err;
      }
      return undefined;
    }

    TransceiverWalker.assertUnderCap(rows, data.maxRows, data.tableOid);

    return rowCount(rows) > 0 ? rows : undefined;
  }

  private static async collectEntitySensors(data: {
    source: TransceiverMibSource;
    flavor: EntitySensorFlavor;
    input: TransceiverWalkInput;
    interfaces: TransceiverInterfaceIndex;
  }): Promise<Array<SnmpTransceiverResult> | undefined> {
    const access: TransceiverSnmpAccess = data.input.access;
    const sensorTableOid: string =
      data.flavor === "cisco"
        ? CISCO_ENT_SENSOR_VALUE_TABLE_OID
        : ENT_PHY_SENSOR_TABLE_OID;

    // Always read: it is how a new or removed optic is noticed.
    const typeRows: SnmpTableRows | undefined =
      await TransceiverWalker.probeColumn({
        input: data.input,
        tableOid: sensorTableOid,
        column: ENT_PHY_SENSOR_COLUMNS.type,
        maxRows: MAX_SENSOR_ROWS,
      });

    if (!typeRows) {
      return undefined;
    }

    const domIndexes: Array<string> = domSensorIndexes(
      typeRows,
      data.flavor,
    ).sort((a: string, b: string) => {
      return a.localeCompare(b, undefined, { numeric: true });
    });

    // The table answered; it just has no sensor an optic reports through.
    if (domIndexes.length === 0) {
      return [];
    }

    const signature: string = fingerprint([
      data.flavor,
      ...domIndexes,
      ...Object.keys(data.input.entityRows || {})
        .sort()
        .map((rowIndex: string) => {
          const row: Record<string, unknown> =
            data.input.entityRows![rowIndex] || {};
          return `${rowIndex}:${textOf(
            row[ENT_PHYSICAL_COLUMNS.entPhysicalClass.toString()],
          )}:${textOf(row[ENT_PHYSICAL_COLUMNS.entPhysicalSerialNum.toString()])}`;
        }),
    ]);

    const nowMs: number = data.input.nowMs ?? Date.now();

    let statics: Record<string, SnmpTableRows> | undefined =
      TransceiverWalker.cache.get({
        key: data.input.cacheKey,
        source: data.source,
        signature: signature,
        nowMs: nowMs,
      });

    if (!statics) {
      statics = await TransceiverWalker.readEntitySensorStatics({
        access: access,
        flavor: data.flavor,
        sensorTableOid: sensorTableOid,
        domIndexes: domIndexes,
        hasEntityRows: Boolean(data.input.entityRows),
      });

      TransceiverWalker.cache.set({
        key: data.input.cacheKey,
        source: data.source,
        signature: signature,
        nowMs: nowMs,
        statics: statics,
      });
    }

    // The readings: GETs of exactly the optical sensors.
    const valueRows: SnmpTableRows = await access.getCells(
      sensorTableOid,
      [ENT_PHY_SENSOR_COLUMNS.value, ENT_PHY_SENSOR_COLUMNS.status],
      domIndexes,
    );

    return parseEntitySensorTransceivers({
      flavor: data.flavor,
      sensorRows: mergeTableRows(typeRows, statics["sensorStatics"], valueRows),
      entityRows: mergeTableRows(
        data.input.entityRows,
        statics["entityIdentity"],
        statics["entityTree"],
      ),
      aliasRows: statics["aliases"],
      thresholdRows: statics["thresholds"],
      interfaces: data.interfaces,
    });
  }

  private static async readEntitySensorStatics(data: {
    access: TransceiverSnmpAccess;
    flavor: EntitySensorFlavor;
    sensorTableOid: string;
    domIndexes: Array<string>;
    hasEntityRows: boolean;
  }): Promise<Record<string, SnmpTableRows>> {
    const entityTree: SnmpTableRows = await data.access.walkColumns(
      ENT_PHYSICAL_TABLE_OID,
      ENTITY_TREE_COLUMNS,
      MAX_ENTITY_ROWS,
    );
    TransceiverWalker.assertUnderCap(
      entityTree,
      MAX_ENTITY_ROWS,
      ENT_PHYSICAL_TABLE_OID,
    );

    let entityIdentity: SnmpTableRows = {};

    if (!data.hasEntityRows) {
      entityIdentity = await data.access.walkColumns(
        ENT_PHYSICAL_TABLE_OID,
        ENTITY_IDENTITY_COLUMNS,
        MAX_ENTITY_ROWS,
      );
      TransceiverWalker.assertUnderCap(
        entityIdentity,
        MAX_ENTITY_ROWS,
        ENT_PHYSICAL_TABLE_OID,
      );
    }

    const sensorStatics: SnmpTableRows = await data.access.getCells(
      data.sensorTableOid,
      [ENT_PHY_SENSOR_COLUMNS.scale, ENT_PHY_SENSOR_COLUMNS.precision],
      data.domIndexes,
    );

    // Thresholds and alias mappings are optional: a device without them still reports readings.
    const thresholds: SnmpTableRows = await TransceiverWalker.optionalWalk({
      access: data.access,
      tableOid:
        data.flavor === "cisco"
          ? CISCO_ENT_SENSOR_THRESHOLD_TABLE_OID
          : data.flavor === "arista"
            ? ARISTA_ENT_SENSOR_THRESHOLD_TABLE_OID
            : undefined,
      columns:
        data.flavor === "cisco"
          ? [
              CISCO_ENT_SENSOR_THRESHOLD_COLUMNS.severity,
              CISCO_ENT_SENSOR_THRESHOLD_COLUMNS.relation,
              CISCO_ENT_SENSOR_THRESHOLD_COLUMNS.value,
            ]
          : [
              ARISTA_ENT_SENSOR_THRESHOLD_COLUMNS.lowWarning,
              ARISTA_ENT_SENSOR_THRESHOLD_COLUMNS.lowCritical,
              ARISTA_ENT_SENSOR_THRESHOLD_COLUMNS.highWarning,
              ARISTA_ENT_SENSOR_THRESHOLD_COLUMNS.highCritical,
            ],
      maxRows: MAX_THRESHOLD_ROWS,
    });

    const aliases: SnmpTableRows = await TransceiverWalker.optionalWalk({
      access: data.access,
      tableOid: ENT_ALIAS_MAPPING_TABLE_OID,
      columns: [ENT_ALIAS_MAPPING_COLUMNS.entAliasMappingIdentifier],
      maxRows: MAX_ALIAS_ROWS,
    });

    return {
      entityTree: entityTree,
      entityIdentity: entityIdentity,
      sensorStatics: sensorStatics,
      thresholds: thresholds,
      aliases: aliases,
    };
  }

  private static async collectPortTable(data: {
    source: TransceiverMibSource;
    spec: PortTableSpec;
    input: TransceiverWalkInput;
    interfaces: TransceiverInterfaceIndex;
  }): Promise<Array<SnmpTransceiverResult> | undefined> {
    const spec: PortTableSpec = data.spec;
    const access: TransceiverSnmpAccess = data.input.access;
    const [keyColumn, ...otherPollColumns] = spec.pollColumns;

    const keyRows: SnmpTableRows | undefined =
      await TransceiverWalker.probeColumn({
        input: data.input,
        tableOid: spec.tableOid,
        column: keyColumn!,
        maxRows: MAX_PORT_TABLE_ROWS,
      });

    if (!keyRows) {
      return undefined;
    }

    const pollRows: SnmpTableRows = mergeTableRows(
      keyRows,
      otherPollColumns.length > 0
        ? await access.walkColumns(
            spec.tableOid,
            otherPollColumns,
            MAX_PORT_TABLE_ROWS,
          )
        : {},
    );
    TransceiverWalker.assertUnderCap(
      pollRows,
      MAX_PORT_TABLE_ROWS,
      spec.tableOid,
    );

    const signature: string = fingerprint(
      Object.keys(pollRows)
        .sort()
        .map((rowIndex: string) => {
          return spec.identityColumn !== undefined
            ? `${rowIndex}:${textOf(
                pollRows[rowIndex]?.[spec.identityColumn.toString()],
              )}`
            : rowIndex;
        }),
    );

    const nowMs: number = data.input.nowMs ?? Date.now();

    let statics: Record<string, SnmpTableRows> | undefined =
      TransceiverWalker.cache.get({
        key: data.input.cacheKey,
        source: data.source,
        signature: signature,
        nowMs: nowMs,
      });

    if (!statics) {
      statics = {
        columns: await TransceiverWalker.optionalWalk({
          access: access,
          tableOid: spec.tableOid,
          columns: spec.staticColumns,
          maxRows: MAX_PORT_TABLE_ROWS,
        }),
      };

      TransceiverWalker.cache.set({
        key: data.input.cacheKey,
        source: data.source,
        signature: signature,
        nowMs: nowMs,
        statics: statics,
      });
    }

    let laneRows: SnmpTableRows | undefined = undefined;

    // Juniper's per-lane readings, only when some optic has more than one lane.
    if (
      data.source === TransceiverMibSource.JuniperDom &&
      Object.values(pollRows).some((row: Record<string, unknown>) => {
        const lanes: number | undefined = readNumber(
          row[JNX_DOM_CURRENT_COLUMNS.laneCount.toString()],
        );
        return lanes !== undefined && lanes > 1;
      })
    ) {
      laneRows = await TransceiverWalker.optionalWalk({
        access: access,
        tableOid: JNX_DOM_LANE_TABLE_OID,
        columns: [
          JNX_DOM_LANE_COLUMNS.rxPower,
          JNX_DOM_LANE_COLUMNS.txBias,
          JNX_DOM_LANE_COLUMNS.txPower,
        ],
        maxRows: MAX_LANE_ROWS,
      });
    }

    return spec.parse({
      rows: mergeTableRows(pollRows, statics["columns"]),
      laneRows: laneRows,
      interfaces: data.interfaces,
    });
  }

  // A walk whose failure only costs the extras it would have added.
  private static async optionalWalk(data: {
    access: TransceiverSnmpAccess;
    tableOid: string | undefined;
    columns: Array<number>;
    maxRows: number;
  }): Promise<SnmpTableRows> {
    if (!data.tableOid || data.columns.length === 0) {
      return {};
    }

    try {
      const rows: SnmpTableRows = await data.access.walkColumns(
        data.tableOid,
        data.columns,
        data.maxRows,
      );
      return rowCount(rows) >= data.maxRows ? {} : rows;
    } catch (err) {
      if (TransceiverWalker.isTimeout(err)) {
        throw err;
      }
      return {};
    }
  }

  private static assertUnderCap(
    rows: SnmpTableRows,
    maxRows: number,
    tableOid: string,
  ): void {
    if (rowCount(rows) >= maxRows) {
      throw new TransceiverWalkError(
        `The device reports more than ${maxRows} rows in ${tableOid}, more than OneUptime reads for transceivers; its transceivers were not read this poll.`,
      );
    }
  }

  public static isTimeout(err: unknown): boolean {
    const error: Error | undefined = err as Error | undefined;
    return (
      error?.name === "RequestTimedOutError" ||
      TIMEOUT_TEXT_REGEX.test(error?.message || "")
    );
  }
}

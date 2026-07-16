import OnlineCheck from "../../OnlineCheck";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import Sleep from "Common/Types/Sleep";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpMonitorResponse, {
  SnmpOidResponse,
} from "Common/Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import SnmpDataType from "Common/Types/Monitor/SnmpMonitor/SnmpDataType";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpInterface from "Common/Types/Monitor/SnmpMonitor/SnmpInterface";
import LldpNeighbor from "Common/Types/Monitor/SnmpMonitor/LldpNeighbor";
import CdpNeighbor from "Common/Types/Monitor/SnmpMonitor/CdpNeighbor";
import SnmpSystemInfo from "Common/Types/Monitor/SnmpMonitor/SnmpSystemInfo";
import SnmpEntityInfo from "Common/Types/Monitor/SnmpMonitor/SnmpEntityInfo";
import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import SnmpV3Auth from "Common/Types/Monitor/SnmpMonitor/SnmpV3Auth";
import snmp from "net-snmp";

/*
 * SNMPv2 system group scalars (1.3.6.1.2.1.1). Read in one GET; sysUpTime is
 * TimeTicks (hundredths of a second) and sysObjectID arrives as an OID
 * string.
 */
const SYSTEM_GROUP_OIDS: {
  sysDescr: string;
  sysObjectId: string;
  sysUpTime: string;
  sysContact: string;
  sysName: string;
  sysLocation: string;
} = {
  sysDescr: "1.3.6.1.2.1.1.1.0",
  sysObjectId: "1.3.6.1.2.1.1.2.0",
  sysUpTime: "1.3.6.1.2.1.1.3.0",
  sysContact: "1.3.6.1.2.1.1.4.0",
  sysName: "1.3.6.1.2.1.1.5.0",
  sysLocation: "1.3.6.1.2.1.1.6.0",
};

/*
 * IF-MIB table OIDs and the column numbers walked for interface monitoring.
 * ifXTable carries the 64-bit HC counters and human-friendly names; it is
 * optional — very old devices only implement ifTable.
 */
const IF_TABLE_OID: string = "1.3.6.1.2.1.2.2";
const IF_TABLE_COLUMNS: {
  ifDescr: number;
  ifType: number;
  ifSpeed: number;
  ifPhysAddress: number;
  ifAdminStatus: number;
  ifOperStatus: number;
  ifInOctets: number;
  ifInDiscards: number;
  ifInErrors: number;
  ifOutOctets: number;
  ifOutDiscards: number;
  ifOutErrors: number;
} = {
  ifDescr: 2,
  ifType: 3,
  ifSpeed: 5,
  ifPhysAddress: 6,
  ifAdminStatus: 7,
  ifOperStatus: 8,
  ifInOctets: 10,
  ifInDiscards: 13,
  ifInErrors: 14,
  ifOutOctets: 16,
  ifOutDiscards: 19,
  ifOutErrors: 20,
};

const IF_X_TABLE_OID: string = "1.3.6.1.2.1.31.1.1";
const IF_X_TABLE_COLUMNS: {
  ifName: number;
  ifHCInOctets: number;
  ifHCOutOctets: number;
  ifHighSpeed: number;
  ifAlias: number;
} = {
  ifName: 1,
  ifHCInOctets: 6,
  ifHCOutOctets: 10,
  ifHighSpeed: 15,
  ifAlias: 18,
};

/*
 * LLDP-MIB lldpRemTable — one row per discovered neighbor. The row index is
 * a composite "timeMark.localPortNum.remIndex", so the local port number is
 * the second-to-last component of the row key. Columns are relative to
 * lldpRemEntry (1.0.8802.1.1.2.1.4.1).
 */
const LLDP_REM_TABLE_OID: string = "1.0.8802.1.1.2.1.4.1";
const LLDP_REM_COLUMNS: {
  lldpRemChassisId: number;
  lldpRemPortId: number;
  lldpRemSysName: number;
} = {
  lldpRemChassisId: 5,
  lldpRemPortId: 7,
  lldpRemSysName: 9,
};

/*
 * CISCO-CDP-MIB cdpCacheTable — one row per CDP neighbor. The row index is
 * "cdpCacheIfIndex.cdpCacheDeviceIndex", so the local ifIndex is the first
 * component of the row key. Walked as an LLDP complement: CDP-only Cisco
 * estates otherwise produce an empty topology.
 */
const CDP_CACHE_TABLE_OID: string = "1.3.6.1.4.1.9.9.23.1.2.1";
const CDP_CACHE_COLUMNS: {
  cdpCacheDeviceId: number;
  cdpCacheDevicePort: number;
  cdpCachePlatform: number;
} = {
  cdpCacheDeviceId: 6,
  cdpCacheDevicePort: 7,
  cdpCachePlatform: 8,
};

/*
 * ENTITY-MIB entPhysicalTable — hardware inventory. The chassis row
 * (entPhysicalClass == 3) carries the device's manufacturer, model, serial
 * number, and firmware/software revisions; modular devices expose one row
 * per component.
 */
const ENT_PHYSICAL_TABLE_OID: string = "1.3.6.1.2.1.47.1.1.1";
const ENT_PHYSICAL_COLUMNS: {
  entPhysicalClass: number;
  entPhysicalHardwareRev: number;
  entPhysicalFirmwareRev: number;
  entPhysicalSoftwareRev: number;
  entPhysicalSerialNum: number;
  entPhysicalMfgName: number;
  entPhysicalModelName: number;
} = {
  entPhysicalClass: 5,
  entPhysicalHardwareRev: 8,
  entPhysicalFirmwareRev: 9,
  entPhysicalSoftwareRev: 10,
  entPhysicalSerialNum: 11,
  entPhysicalMfgName: 12,
  entPhysicalModelName: 13,
};

const ENT_PHYSICAL_CLASS_CHASSIS: number = 3;

type SnmpTableRows = Record<string, Record<string, unknown>>;

export interface SnmpWalkResult {
  interfaces: Array<SnmpInterface>;
  systemInfo?: SnmpSystemInfo | undefined;
  entityInfo?: SnmpEntityInfo | undefined;
  lldpNeighbors?: Array<LldpNeighbor> | undefined;
  cdpNeighbors?: Array<CdpNeighbor> | undefined;
}

export interface SnmpQueryOptions {
  timeout?: number | undefined;
  retry?: number | undefined;
  currentRetryCount?: number | undefined;
  monitorId?: ObjectID | undefined;
  isOnlineCheckRequest?: boolean | undefined;
  attempts?: Array<ProbeAttempt> | undefined;
}

export default class SnmpMonitor {
  public static async query(
    config: MonitorStepSnmpMonitor,
    options?: SnmpQueryOptions,
  ): Promise<SnmpMonitorResponse | null> {
    if (!options) {
      options = {};
    }

    if (options?.currentRetryCount === undefined) {
      options.currentRetryCount = 1;
    }

    if (!options.attempts) {
      options.attempts = [];
    }

    logger.debug(
      `SNMP Query: ${options?.monitorId?.toString()} ${config.hostname}:${config.port} - Retry: ${options?.currentRetryCount}`,
    );

    const startTime: [number, number] = process.hrtime();
    const attemptedAt: Date = new Date();

    try {
      const shouldWalkInterfaces: boolean = Boolean(config.monitorInterfaces);

      /*
       * The OID GET is skipped when the user configured no OIDs and enabled
       * interface monitoring — the interface walk is the check then. With
       * neither configured, executeSnmpQuery keeps its "No OIDs configured"
       * error.
       */
      let oidResponses: Array<SnmpOidResponse> = [];
      if (config.oids.length > 0 || !shouldWalkInterfaces) {
        oidResponses = await SnmpMonitor.executeSnmpQuery(config, options);
      }

      let interfaces: Array<SnmpInterface> | undefined = undefined;
      let systemInfo: SnmpSystemInfo | undefined = undefined;
      let entityInfo: SnmpEntityInfo | undefined = undefined;
      let lldpNeighbors: Array<LldpNeighbor> | undefined = undefined;
      let cdpNeighbors: Array<CdpNeighbor> | undefined = undefined;
      let interfaceWalkFailure: string | undefined = undefined;

      if (shouldWalkInterfaces) {
        try {
          const walkResult: SnmpWalkResult = await SnmpMonitor.walkInterfaces(
            config,
            options,
          );
          interfaces = walkResult.interfaces;
          systemInfo = walkResult.systemInfo;
          entityInfo = walkResult.entityInfo;
          lldpNeighbors = walkResult.lldpNeighbors;
          cdpNeighbors = walkResult.cdpNeighbors;
        } catch (err: unknown) {
          if (config.oids.length === 0) {
            // The walk was the only check — treat as device unreachable.
            throw err;
          }

          /*
           * OID GET succeeded, so the device is up; record why interface
           * data is missing without failing the check.
           */
          interfaceWalkFailure =
            (err as Error).message || (err as Error).toString();
          logger.debug(
            `SNMP interface walk failed for ${options?.monitorId?.toString()} ${config.hostname}:${config.port}: ${interfaceWalkFailure}`,
          );
        }
      }

      const endTime: [number, number] = process.hrtime(startTime);
      const responseTimeInMs: number = Math.ceil(
        (endTime[0] * 1000000000 + endTime[1]) / 1000000,
      );

      logger.debug(
        `SNMP Query success: ${options?.monitorId?.toString()} ${config.hostname}:${config.port} - Response Time: ${responseTimeInMs}ms`,
      );

      const responseReceivedAt: Date = new Date();
      options.attempts.push({
        attemptNumber: options.currentRetryCount,
        attemptedAt,
        responseReceivedAt,
        responseTimeInMs,
        isOnline: true,
      });

      return {
        isOnline: true,
        responseTimeInMs: responseTimeInMs,
        failureCause: "",
        oidResponses: oidResponses,
        probeAttempts: options.attempts,
        totalAttempts: options.attempts.length,
        interfaces: interfaces,
        interfaceWalkFailure: interfaceWalkFailure,
        systemInfo: systemInfo,
        entityInfo: entityInfo,
        lldpNeighbors: lldpNeighbors,
        cdpNeighbors: cdpNeighbors,
      };
    } catch (err: unknown) {
      logger.debug(
        `SNMP Query error: ${options?.monitorId?.toString()} ${config.hostname}:${config.port}`,
      );
      logger.debug(err);

      if (!options) {
        options = {};
      }

      if (!options.currentRetryCount) {
        options.currentRetryCount = 0;
      }

      if (!options.attempts) {
        options.attempts = [];
      }

      const endTime: [number, number] = process.hrtime(startTime);
      const responseTimeInMs: number = Math.ceil(
        (endTime[0] * 1000000000 + endTime[1]) / 1000000,
      );

      const responseReceivedAt: Date = new Date();
      options.attempts.push({
        attemptNumber: options.currentRetryCount || 1,
        attemptedAt,
        responseReceivedAt,
        responseTimeInMs,
        isOnline: false,
        failureCause: (err as Error).message || (err as Error).toString(),
      });

      if (options.currentRetryCount < (options.retry ?? config.retries ?? 3)) {
        options.currentRetryCount++;
        await Sleep.sleep(1000);
        return await SnmpMonitor.query(config, options);
      }

      // Check if the probe is online
      if (!options.isOnlineCheckRequest) {
        if (!(await OnlineCheck.canProbeMonitorPortMonitors())) {
          logger.error(
            `SnmpMonitor - Probe is not online. Cannot query ${options?.monitorId?.toString()} ${config.hostname}:${config.port} - ERROR: ${err}`,
          );
          return null;
        }
      }

      // Check if timeout
      const isTimeout: boolean =
        (err as Error).message?.toLowerCase().includes("timeout") ||
        (err as Error).message?.toLowerCase().includes("timed out");

      if (isTimeout) {
        return {
          isOnline: false,
          isTimeout: true,
          responseTimeInMs: responseTimeInMs,
          failureCause:
            "Request was tried " +
            options.currentRetryCount +
            " times and it timed out.",
          oidResponses: [],
          probeAttempts: options.attempts,
          totalAttempts: options.attempts.length,
        };
      }

      return {
        isOnline: false,
        isTimeout: false,
        responseTimeInMs: responseTimeInMs,
        failureCause: (err as Error).message || (err as Error).toString(),
        oidResponses: [],
        probeAttempts: options.attempts,
        totalAttempts: options.attempts.length,
      };
    }
  }

  /*
   * Single-host system-group probe used by subnet discovery. Returns null
   * when the host does not answer SNMP within the timeout — the normal
   * case for most addresses in a swept subnet, so no retries and no logs.
   */
  public static async probeSystemInfo(
    config: MonitorStepSnmpMonitor,
  ): Promise<SnmpSystemInfo | null> {
    const session: snmp.Session = SnmpMonitor.createSnmpSession(config, {});

    try {
      return await SnmpMonitor.readSystemInfo(session);
    } catch {
      return null;
    } finally {
      session.close();
    }
  }

  /*
   * Reads the full system group in one GET. Some agents fail the whole GET
   * when any single scalar is unsupported, so a varbind-level error just
   * blanks that field rather than failing the read.
   */
  private static async readSystemInfo(
    session: snmp.Session,
  ): Promise<SnmpSystemInfo> {
    const varbinds: Array<snmp.Varbind> = await SnmpMonitor.getOids(session, [
      SYSTEM_GROUP_OIDS.sysDescr,
      SYSTEM_GROUP_OIDS.sysObjectId,
      SYSTEM_GROUP_OIDS.sysUpTime,
      SYSTEM_GROUP_OIDS.sysContact,
      SYSTEM_GROUP_OIDS.sysName,
      SYSTEM_GROUP_OIDS.sysLocation,
    ]);

    const valueAt: (index: number) => unknown = (index: number) => {
      const varbind: snmp.Varbind | undefined = varbinds[index];
      if (!varbind || snmp.isVarbindError(varbind)) {
        return undefined;
      }
      return varbind.value;
    };

    const sysUpTimeTicks: number | undefined = SnmpMonitor.toMetricNumber(
      valueAt(2),
    );

    return {
      sysDescr: SnmpMonitor.toDisplayString(valueAt(0)),
      // OID varbind values arrive as dotted strings from net-snmp.
      sysObjectId: SnmpMonitor.toDisplayString(valueAt(1)),
      sysUpTimeSeconds:
        sysUpTimeTicks !== undefined
          ? Math.floor(sysUpTimeTicks / 100)
          : undefined,
      sysContact: SnmpMonitor.toDisplayString(valueAt(3)),
      sysName: SnmpMonitor.toDisplayString(valueAt(4)),
      sysLocation: SnmpMonitor.toDisplayString(valueAt(5)),
    };
  }

  private static createSnmpSession(
    config: MonitorStepSnmpMonitor,
    options: SnmpQueryOptions,
  ): snmp.Session {
    if (config.snmpVersion === SnmpVersion.V3) {
      /*
       * A v3 device MUST have auth configured. Falling through to the v2c
       * branch would silently poll it as v2c with community "public" — a
       * false success/failure and an unexpected cleartext community on the
       * wire — so fail loudly instead.
       */
      if (!config.snmpV3Auth || !config.snmpV3Auth.username) {
        throw new Error(
          `SNMP v3 is selected for ${config.hostname} but no v3 credentials (username) are configured.`,
        );
      }
      const sessionOptionsV3: snmp.SessionOptionsV3 = {
        port: config.port || 161,
        timeout: options.timeout || config.timeout || 5000,
        retries: 0, // We handle retries ourselves
        version: snmp.Version3,
      };
      const user: snmp.User = SnmpMonitor.buildV3User(config);
      return snmp.createV3Session(config.hostname, user, sessionOptionsV3);
    }

    const sessionOptions: snmp.SessionOptions = {
      port: config.port || 161,
      timeout: options.timeout || config.timeout || 5000,
      retries: 0, // We handle retries ourselves
      version:
        config.snmpVersion === SnmpVersion.V1 ? snmp.Version1 : snmp.Version2c,
    };
    return snmp.createSession(
      config.hostname,
      config.communityString || "public",
      sessionOptions,
    );
  }

  /*
   * Walks the IF-MIB interface tables and returns one entry per interface.
   * ifXTable (64-bit counters, names, aliases) is best-effort — devices
   * without it fall back to the 32-bit ifTable counters.
   */
  public static async walkInterfaces(
    config: MonitorStepSnmpMonitor,
    options: SnmpQueryOptions,
  ): Promise<SnmpWalkResult> {
    const session: snmp.Session = SnmpMonitor.createSnmpSession(
      config,
      options,
    );

    try {
      // Best-effort system identity (system group scalars).
      let systemInfo: SnmpSystemInfo | undefined = undefined;
      try {
        systemInfo = await SnmpMonitor.readSystemInfo(session);
      } catch (err) {
        logger.debug(
          `SNMP system group read failed for ${config.hostname}: ${err}`,
        );
      }

      // Best-effort hardware identity (ENTITY-MIB chassis row).
      let entityInfo: SnmpEntityInfo | undefined = undefined;
      try {
        entityInfo = await SnmpMonitor.walkEntityInfo(session);
      } catch (err) {
        logger.debug(
          `SNMP ENTITY-MIB walk failed for ${config.hostname} (device may not implement it): ${err}`,
        );
      }

      const ifTable: SnmpTableRows = await SnmpMonitor.getTableColumns(
        session,
        IF_TABLE_OID,
        Object.values(IF_TABLE_COLUMNS),
      );

      let ifXTable: SnmpTableRows = {};
      try {
        ifXTable = await SnmpMonitor.getTableColumns(
          session,
          IF_X_TABLE_OID,
          Object.values(IF_X_TABLE_COLUMNS),
        );
      } catch (err) {
        logger.debug(
          `SNMP ifXTable walk failed for ${config.hostname} (falling back to 32-bit ifTable counters): ${err}`,
        );
      }

      const interfaces: Array<SnmpInterface> = [];

      for (const interfaceIndex of Object.keys(ifTable)) {
        const row: Record<string, unknown> = ifTable[interfaceIndex]!;
        const extendedRow: Record<string, unknown> =
          ifXTable[interfaceIndex] || {};

        const column: (columnNumber: number) => unknown = (
          columnNumber: number,
        ) => {
          return row[columnNumber.toString()];
        };
        const extendedColumn: (columnNumber: number) => unknown = (
          columnNumber: number,
        ) => {
          return extendedRow[columnNumber.toString()];
        };

        /*
         * Speed: ifHighSpeed is in Mbps and required for links >= 4.3 Gbps
         * where the 32-bit ifSpeed (bps) saturates; 0 means "not reported".
         */
        const highSpeedInMbps: number | undefined = SnmpMonitor.toMetricNumber(
          extendedColumn(IF_X_TABLE_COLUMNS.ifHighSpeed),
        );
        const speedInBitsPerSecond: number | undefined =
          highSpeedInMbps && highSpeedInMbps > 0
            ? highSpeedInMbps * 1000000
            : SnmpMonitor.toMetricNumber(column(IF_TABLE_COLUMNS.ifSpeed));

        interfaces.push({
          interfaceIndex: parseInt(interfaceIndex, 10),
          name:
            SnmpMonitor.toDisplayString(
              extendedColumn(IF_X_TABLE_COLUMNS.ifName),
            ) ||
            SnmpMonitor.toDisplayString(column(IF_TABLE_COLUMNS.ifDescr)) ||
            `Interface ${interfaceIndex}`,
          alias: SnmpMonitor.toDisplayString(
            extendedColumn(IF_X_TABLE_COLUMNS.ifAlias),
          ),
          macAddress: SnmpMonitor.toMacAddress(
            column(IF_TABLE_COLUMNS.ifPhysAddress),
          ),
          interfaceType: SnmpMonitor.toMetricNumber(
            column(IF_TABLE_COLUMNS.ifType),
          ),
          isOperationallyUp:
            SnmpMonitor.toMetricNumber(
              column(IF_TABLE_COLUMNS.ifOperStatus),
            ) === 1,
          isAdministrativelyUp:
            SnmpMonitor.toMetricNumber(
              column(IF_TABLE_COLUMNS.ifAdminStatus),
            ) === 1,
          speedInBitsPerSecond:
            speedInBitsPerSecond && speedInBitsPerSecond > 0
              ? speedInBitsPerSecond
              : undefined,
          inOctets:
            SnmpMonitor.toMetricNumber(
              extendedColumn(IF_X_TABLE_COLUMNS.ifHCInOctets),
            ) ??
            SnmpMonitor.toMetricNumber(column(IF_TABLE_COLUMNS.ifInOctets)),
          outOctets:
            SnmpMonitor.toMetricNumber(
              extendedColumn(IF_X_TABLE_COLUMNS.ifHCOutOctets),
            ) ??
            SnmpMonitor.toMetricNumber(column(IF_TABLE_COLUMNS.ifOutOctets)),
          inErrors: SnmpMonitor.toMetricNumber(
            column(IF_TABLE_COLUMNS.ifInErrors),
          ),
          outErrors: SnmpMonitor.toMetricNumber(
            column(IF_TABLE_COLUMNS.ifOutErrors),
          ),
          inDiscards: SnmpMonitor.toMetricNumber(
            column(IF_TABLE_COLUMNS.ifInDiscards),
          ),
          outDiscards: SnmpMonitor.toMetricNumber(
            column(IF_TABLE_COLUMNS.ifOutDiscards),
          ),
        });
      }

      interfaces.sort((a: SnmpInterface, b: SnmpInterface) => {
        return a.interfaceIndex - b.interfaceIndex;
      });

      // Best-effort LLDP neighbor discovery for the topology graph.
      let lldpNeighbors: Array<LldpNeighbor> | undefined = undefined;
      try {
        lldpNeighbors = await SnmpMonitor.walkLldpNeighbors(session);
      } catch (err) {
        logger.debug(
          `SNMP LLDP walk failed for ${config.hostname} (device may not run LLDP): ${err}`,
        );
      }

      /*
       * Best-effort CDP neighbors. Only attempted on devices that plausibly
       * speak CDP (Cisco sysObjectID or empty LLDP result) — walking a
       * Cisco-enterprise table on every vendor's gear wastes a round-trip
       * per poll.
       */
      let cdpNeighbors: Array<CdpNeighbor> | undefined = undefined;
      const isLikelyCisco: boolean = Boolean(
        systemInfo?.sysObjectId?.replace(/^\./, "").startsWith("1.3.6.1.4.1.9."),
      );
      if (isLikelyCisco || !lldpNeighbors || lldpNeighbors.length === 0) {
        try {
          cdpNeighbors = await SnmpMonitor.walkCdpNeighbors(session);
        } catch (err) {
          logger.debug(
            `SNMP CDP walk failed for ${config.hostname} (device may not run CDP): ${err}`,
          );
        }
      }

      return { interfaces, systemInfo, entityInfo, lldpNeighbors, cdpNeighbors };
    } finally {
      session.close();
    }
  }

  /*
   * Picks the device's hardware identity out of entPhysicalTable: the
   * chassis row when present, otherwise the lowest-indexed row that carries
   * a serial number (some devices only serialize their supervisor module).
   */
  private static async walkEntityInfo(
    session: snmp.Session,
  ): Promise<SnmpEntityInfo | undefined> {
    const table: SnmpTableRows = await SnmpMonitor.getTableColumns(
      session,
      ENT_PHYSICAL_TABLE_OID,
      Object.values(ENT_PHYSICAL_COLUMNS),
    );

    const rowKeys: Array<string> = Object.keys(table).sort(
      (a: string, b: string) => {
        return parseInt(a, 10) - parseInt(b, 10);
      },
    );

    let chosenRow: Record<string, unknown> | undefined = undefined;

    for (const rowKey of rowKeys) {
      const row: Record<string, unknown> = table[rowKey]!;
      const physicalClass: number | undefined = SnmpMonitor.toMetricNumber(
        row[ENT_PHYSICAL_COLUMNS.entPhysicalClass.toString()],
      );

      if (physicalClass === ENT_PHYSICAL_CLASS_CHASSIS) {
        chosenRow = row;
        break;
      }

      if (
        !chosenRow &&
        SnmpMonitor.toDisplayString(
          row[ENT_PHYSICAL_COLUMNS.entPhysicalSerialNum.toString()],
        )
      ) {
        chosenRow = row;
      }
    }

    if (!chosenRow) {
      return undefined;
    }

    const field: (columnNumber: number) => string | undefined = (
      columnNumber: number,
    ) => {
      return SnmpMonitor.toDisplayString(chosenRow![columnNumber.toString()]);
    };

    const entityInfo: SnmpEntityInfo = {
      manufacturer: field(ENT_PHYSICAL_COLUMNS.entPhysicalMfgName),
      model: field(ENT_PHYSICAL_COLUMNS.entPhysicalModelName),
      serialNumber: field(ENT_PHYSICAL_COLUMNS.entPhysicalSerialNum),
      hardwareRevision: field(ENT_PHYSICAL_COLUMNS.entPhysicalHardwareRev),
      firmwareVersion: field(ENT_PHYSICAL_COLUMNS.entPhysicalFirmwareRev),
      softwareVersion: field(ENT_PHYSICAL_COLUMNS.entPhysicalSoftwareRev),
    };

    const hasAnyField: boolean = Object.values(entityInfo).some(
      (value: string | undefined) => {
        return Boolean(value);
      },
    );

    return hasAnyField ? entityInfo : undefined;
  }

  private static async walkCdpNeighbors(
    session: snmp.Session,
  ): Promise<Array<CdpNeighbor> | undefined> {
    const table: SnmpTableRows = await SnmpMonitor.getTableColumns(
      session,
      CDP_CACHE_TABLE_OID,
      Object.values(CDP_CACHE_COLUMNS),
    );

    const neighbors: Array<CdpNeighbor> = [];

    for (const rowKey of Object.keys(table)) {
      const row: Record<string, unknown> = table[rowKey]!;

      // Row key is "cdpCacheIfIndex.cdpCacheDeviceIndex".
      const localPart: string | undefined = rowKey.split(".")[0];
      const localInterfaceIndex: number = parseInt(localPart || "", 10);

      neighbors.push({
        localInterfaceIndex: isNaN(localInterfaceIndex)
          ? undefined
          : localInterfaceIndex,
        remoteDeviceId: SnmpMonitor.toDisplayString(
          row[CDP_CACHE_COLUMNS.cdpCacheDeviceId.toString()],
        ),
        remotePortId: SnmpMonitor.toDisplayString(
          row[CDP_CACHE_COLUMNS.cdpCacheDevicePort.toString()],
        ),
        remotePlatform: SnmpMonitor.toDisplayString(
          row[CDP_CACHE_COLUMNS.cdpCachePlatform.toString()],
        ),
      });
    }

    return neighbors.length > 0 ? neighbors : undefined;
  }

  private static async walkLldpNeighbors(
    session: snmp.Session,
  ): Promise<Array<LldpNeighbor>> {
    const table: SnmpTableRows = await SnmpMonitor.getTableColumns(
      session,
      LLDP_REM_TABLE_OID,
      Object.values(LLDP_REM_COLUMNS),
    );

    const neighbors: Array<LldpNeighbor> = [];

    for (const rowKey of Object.keys(table)) {
      const row: Record<string, unknown> = table[rowKey]!;

      /*
       * Row key is "timeMark.localPortNum.remIndex"; the local port number
       * (which equals ifIndex on most gear) is the second-to-last part.
       */
      const parts: Array<string> = rowKey.split(".");
      const localPortPart: string | undefined =
        parts.length >= 2 ? parts[parts.length - 2] : undefined;
      const localInterfaceIndex: number | undefined = localPortPart
        ? parseInt(localPortPart, 10)
        : undefined;

      neighbors.push({
        localInterfaceIndex:
          localInterfaceIndex !== undefined && !isNaN(localInterfaceIndex)
            ? localInterfaceIndex
            : undefined,
        remoteChassisId: SnmpMonitor.toDisplayString(
          row[LLDP_REM_COLUMNS.lldpRemChassisId.toString()],
        ),
        remotePortId: SnmpMonitor.toDisplayString(
          row[LLDP_REM_COLUMNS.lldpRemPortId.toString()],
        ),
        remoteSysName: SnmpMonitor.toDisplayString(
          row[LLDP_REM_COLUMNS.lldpRemSysName.toString()],
        ),
      });
    }

    return neighbors;
  }

  private static getOids(
    session: snmp.Session,
    oids: Array<string>,
  ): Promise<Array<snmp.Varbind>> {
    return new Promise(
      (
        resolve: (value: Array<snmp.Varbind>) => void,
        reject: (reason?: Error) => void,
      ) => {
        session.get(
          oids,
          (error: Error | null, varbinds: Array<snmp.Varbind> | undefined) => {
            if (error || !varbinds) {
              reject(error || new Error("No varbinds returned"));
              return;
            }
            resolve(varbinds);
          },
        );
      },
    );
  }

  private static getTableColumns(
    session: snmp.Session,
    tableOid: string,
    columns: Array<number>,
  ): Promise<SnmpTableRows> {
    return new Promise(
      (
        resolve: (value: SnmpTableRows) => void,
        reject: (reason?: Error) => void,
      ) => {
        (session as any).tableColumns(
          tableOid,
          columns,
          (error: Error | null, table?: unknown) => {
            if (error) {
              reject(error);
              return;
            }

            resolve((table as SnmpTableRows) || {});
          },
        );
      },
    );
  }

  /*
   * net-snmp returns Counter64 values as 8-byte big-endian Buffers (there is
   * no native 64-bit varbind decoding); smaller integer types come through
   * as plain numbers.
   */
  private static toMetricNumber(value: unknown): number | undefined {
    if (typeof value === "number" && isFinite(value)) {
      return value;
    }

    if (typeof value === "bigint") {
      return Number(value);
    }

    if (Buffer.isBuffer(value)) {
      if (value.length === 8) {
        return Number(value.readBigUInt64BE());
      }
      if (value.length > 0 && value.length <= 6) {
        return value.readUIntBE(0, value.length);
      }
      return undefined;
    }

    return undefined;
  }

  private static toDisplayString(value: unknown): string | undefined {
    if (Buffer.isBuffer(value)) {
      return value.toString("utf8").trim() || undefined;
    }

    if (typeof value === "string") {
      return value.trim() || undefined;
    }

    return undefined;
  }

  /*
   * ifPhysAddress arrives as a raw octet buffer. Loopbacks/tunnels report an
   * empty or all-zero address — treat those as "no MAC".
   */
  private static toMacAddress(value: unknown): string | undefined {
    if (!Buffer.isBuffer(value) || value.length === 0) {
      return undefined;
    }

    const isAllZero: boolean = value.every((byte: number) => {
      return byte === 0;
    });
    if (isAllZero) {
      return undefined;
    }

    return Array.from(value)
      .map((byte: number) => {
        return byte.toString(16).padStart(2, "0");
      })
      .join(":");
  }

  private static isPrintableBuffer(value: Buffer): boolean {
    return value.every((byte: number) => {
      return (
        (byte >= 0x20 && byte <= 0x7e) ||
        byte === 0x09 ||
        byte === 0x0a ||
        byte === 0x0d
      );
    });
  }

  private static async executeSnmpQuery(
    config: MonitorStepSnmpMonitor,
    options: SnmpQueryOptions,
  ): Promise<Array<SnmpOidResponse>> {
    return new Promise(
      (
        resolve: (value: Array<SnmpOidResponse>) => void,
        reject: (reason?: Error) => void,
      ) => {
        let session: snmp.Session | undefined;

        try {
          session = SnmpMonitor.createSnmpSession(config, options);

          const oids: Array<string> = config.oids.map((oid: SnmpOid) => {
            return oid.oid;
          });

          if (oids.length === 0) {
            session.close();
            reject(new Error("No OIDs configured for SNMP monitor"));
            return;
          }

          session.get(
            oids,
            (
              error: Error | null,
              varbinds: Array<snmp.Varbind> | undefined,
            ) => {
              if (error || !varbinds) {
                session!.close();
                reject(error || new Error("No varbinds returned"));
                return;
              }

              const oidResponses: Array<SnmpOidResponse> = [];

              for (let i: number = 0; i < varbinds.length; i++) {
                const varbind: snmp.Varbind = varbinds[i]!;
                const configOid: SnmpOid | undefined = config.oids[i];

                if (snmp.isVarbindError(varbind)) {
                  oidResponses.push({
                    oid: varbind.oid,
                    name: configOid?.name,
                    value: null,
                    type: SnmpMonitor.mapSnmpErrorType(varbind.type),
                  });
                } else {
                  oidResponses.push({
                    oid: varbind.oid,
                    name: configOid?.name,
                    value: SnmpMonitor.parseVarbindValue(varbind),
                    type: SnmpMonitor.mapSnmpDataType(varbind.type),
                  });
                }
              }

              session!.close();
              resolve(oidResponses);
            },
          );
        } catch (err) {
          /*
           * Close the session if it was created before the throw (e.g. a
           * synchronous throw from session.get) so we don't leak the socket.
           */
          try {
            session?.close();
          } catch {
            // ignore close errors on an already-broken session
          }
          reject(err as Error);
        }
      },
    );
  }

  private static buildV3User(config: MonitorStepSnmpMonitor): snmp.User {
    const v3Auth: SnmpV3Auth = config.snmpV3Auth!;
    const user: snmp.User = {
      name: v3Auth.username,
      level: SnmpMonitor.mapSecurityLevel(v3Auth.securityLevel),
    };

    if (
      v3Auth.securityLevel === SnmpSecurityLevel.AuthNoPriv ||
      v3Auth.securityLevel === SnmpSecurityLevel.AuthPriv
    ) {
      user.authProtocol = SnmpMonitor.mapAuthProtocol(v3Auth.authProtocol);
      user.authKey = v3Auth.authKey || "";
    }

    if (v3Auth.securityLevel === SnmpSecurityLevel.AuthPriv) {
      user.privProtocol = SnmpMonitor.mapPrivProtocol(v3Auth.privProtocol);
      user.privKey = v3Auth.privKey || "";
    }

    return user;
  }

  private static mapSecurityLevel(
    level: SnmpSecurityLevel,
  ): snmp.SecurityLevel {
    switch (level) {
      case SnmpSecurityLevel.NoAuthNoPriv:
        return snmp.SecurityLevel.noAuthNoPriv;
      case SnmpSecurityLevel.AuthNoPriv:
        return snmp.SecurityLevel.authNoPriv;
      case SnmpSecurityLevel.AuthPriv:
        return snmp.SecurityLevel.authPriv;
      default:
        return snmp.SecurityLevel.noAuthNoPriv;
    }
  }

  private static mapAuthProtocol(
    protocol: SnmpAuthProtocol | undefined,
  ): snmp.AuthProtocols {
    switch (protocol) {
      case SnmpAuthProtocol.MD5:
        return snmp.AuthProtocols.md5;
      case SnmpAuthProtocol.SHA:
        return snmp.AuthProtocols.sha;
      case SnmpAuthProtocol.SHA256:
        return snmp.AuthProtocols.sha256;
      case SnmpAuthProtocol.SHA512:
        return snmp.AuthProtocols.sha512;
      default:
        return snmp.AuthProtocols.md5;
    }
  }

  private static mapPrivProtocol(
    protocol: SnmpPrivProtocol | undefined,
  ): snmp.PrivProtocols {
    switch (protocol) {
      case SnmpPrivProtocol.DES:
        return snmp.PrivProtocols.des;
      case SnmpPrivProtocol.AES:
        return snmp.PrivProtocols.aes;
      case SnmpPrivProtocol.AES256:
        return snmp.PrivProtocols.aes256b;
      default:
        return snmp.PrivProtocols.des;
    }
  }

  private static parseVarbindValue(varbind: snmp.Varbind): string | number {
    if (varbind.value === null || varbind.value === undefined) {
      return "";
    }

    if (Buffer.isBuffer(varbind.value)) {
      /*
       * net-snmp hands Counter64 values over as raw 8-byte buffers — decode
       * them numerically so user-configured HC-counter OIDs (ifHCInOctets
       * and friends) produce values criteria can compare, not mojibake.
       */
      if (varbind.type === snmp.ObjectType.Counter64) {
        return SnmpMonitor.toMetricNumber(varbind.value) ?? "";
      }

      /*
       * Binary OctetStrings (MAC addresses, vendor blobs) are unreadable as
       * UTF-8 — render them as colon-separated hex instead.
       */
      if (!SnmpMonitor.isPrintableBuffer(varbind.value)) {
        return SnmpMonitor.toMacAddress(varbind.value) || "";
      }

      return varbind.value.toString();
    }

    // Handle numeric values
    if (
      typeof varbind.value === "number" ||
      typeof varbind.value === "bigint"
    ) {
      return Number(varbind.value);
    }

    // Default to string conversion
    return String(varbind.value);
  }

  private static mapSnmpDataType(
    type: snmp.ObjectType | undefined,
  ): SnmpDataType {
    switch (type) {
      case snmp.ObjectType.Integer:
        return SnmpDataType.Integer;
      case snmp.ObjectType.OctetString:
        return SnmpDataType.OctetString;
      case snmp.ObjectType.OID:
        return SnmpDataType.ObjectIdentifier;
      case snmp.ObjectType.IpAddress:
        return SnmpDataType.IpAddress;
      case snmp.ObjectType.Counter:
        return SnmpDataType.Counter;
      case snmp.ObjectType.Counter32:
        return SnmpDataType.Counter32;
      case snmp.ObjectType.Gauge:
        return SnmpDataType.Gauge;
      case snmp.ObjectType.Gauge32:
        return SnmpDataType.Gauge32;
      case snmp.ObjectType.TimeTicks:
        return SnmpDataType.TimeTicks;
      case snmp.ObjectType.Opaque:
        return SnmpDataType.Opaque;
      case snmp.ObjectType.Counter64:
        return SnmpDataType.Counter64;
      case snmp.ObjectType.Null:
        return SnmpDataType.Null;
      case snmp.ObjectType.Boolean:
        return SnmpDataType.Boolean;
      default:
        return SnmpDataType.Unknown;
    }
  }

  private static mapSnmpErrorType(
    type: snmp.ObjectType | undefined,
  ): SnmpDataType {
    switch (type) {
      case snmp.ObjectType.NoSuchObject:
        return SnmpDataType.NoSuchObject;
      case snmp.ObjectType.NoSuchInstance:
        return SnmpDataType.NoSuchInstance;
      case snmp.ObjectType.EndOfMibView:
        return SnmpDataType.EndOfMibView;
      default:
        return SnmpDataType.Unknown;
    }
  }
}

import OnlineCheck from "../../OnlineCheck";
import logger from "Common/Server/Utils/Logger";
import IP from "Common/Types/IP/IP";
import ObjectID from "Common/Types/ObjectID";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import Sleep from "Common/Types/Sleep";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpMonitorResponse, {
  SnmpOidResponse,
} from "Common/Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import SnmpDataType from "Common/Types/Monitor/SnmpMonitor/SnmpDataType";
import SnmpSecurityLevel, {
  SnmpSecurityLevelUtil,
} from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpAuthProtocol, {
  SnmpAuthProtocolUtil,
} from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol, {
  SnmpPrivProtocolUtil,
} from "Common/Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpInterface from "Common/Types/Monitor/SnmpMonitor/SnmpInterface";
import LldpNeighbor from "Common/Types/Monitor/SnmpMonitor/LldpNeighbor";
import CdpNeighbor from "Common/Types/Monitor/SnmpMonitor/CdpNeighbor";
import ArpEntry from "Common/Types/Monitor/SnmpMonitor/ArpEntry";
import FdbEntry from "Common/Types/Monitor/SnmpMonitor/FdbEntry";
import SnmpSystemInfo from "Common/Types/Monitor/SnmpMonitor/SnmpSystemInfo";
import SnmpEntityInfo from "Common/Types/Monitor/SnmpMonitor/SnmpEntityInfo";
import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import SnmpV3Auth from "Common/Types/Monitor/SnmpMonitor/SnmpV3Auth";
// Repairs net-snmp's DES privacy on OpenSSL 3 — must load with net-snmp.
import "../../Snmp/SnmpDesPrivacyCompat";
import {
  SnmpTableRows,
  IP_NET_TO_MEDIA_TABLE_OID,
  IP_NET_TO_MEDIA_COLUMNS,
  DOT1Q_TP_FDB_TABLE_OID,
  DOT1Q_TP_FDB_COLUMNS,
  DOT1D_TP_FDB_TABLE_OID,
  DOT1D_TP_FDB_COLUMNS,
  DOT1D_BASE_PORT_TABLE_OID,
  DOT1D_BASE_PORT_COLUMNS,
  MAX_ARP_ENTRIES,
  MAX_FDB_ENTRIES,
  MAX_BASE_PORT_ENTRIES,
  parseArpRows,
  parseFdbRowsQBridge,
  parseFdbRowsDot1d,
  parseBasePortMap,
  applyBasePortMapping,
  toMacAddressString,
} from "../../Snmp/EndpointTableParsers";
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

/*
 * GETBULK max-repetitions for the row-bounded endpoint walks; matches
 * net-snmp's own default so the on-wire behavior is unchanged and only the
 * stopping rule differs.
 */
const SNMP_TABLE_MAX_REPETITIONS: number = 20;

/*
 * Wall-clock budget for the WHOLE endpoint phase (ARP + both FDB tables +
 * the base-port map) of a single poll. The row caps bound how many PDUs a
 * walk issues, but not how slow each one is; without a deadline a device
 * that answers just inside the per-PDU timeout can still hold the session
 * open for far longer than the check interval.
 */
const ENDPOINT_WALK_BUDGET_MS: number = 30000;

export interface SnmpWalkResult {
  interfaces: Array<SnmpInterface>;
  systemInfo?: SnmpSystemInfo | undefined;
  entityInfo?: SnmpEntityInfo | undefined;
  lldpNeighbors?: Array<LldpNeighbor> | undefined;
  cdpNeighbors?: Array<CdpNeighbor> | undefined;
  arpEntries?: Array<ArpEntry> | undefined;
  fdbEntries?: Array<FdbEntry> | undefined;
}

export interface SnmpQueryOptions {
  timeout?: number | undefined;
  retry?: number | undefined;
  currentRetryCount?: number | undefined;
  monitorId?: ObjectID | undefined;
  isOnlineCheckRequest?: boolean | undefined;
  attempts?: Array<ProbeAttempt> | undefined;
  /*
   * ARP + FDB endpoint collection during the interface walk. Defaults OFF
   * (only an explicit true collects) to mirror the monitor step's
   * strictly-opt-in collectEndpoints flag; only meaningful when
   * monitorInterfaces is on, exactly like the LLDP/CDP walks it rides
   * alongside.
   */
  collectEndpoints?: boolean | undefined;
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
      let arpEntries: Array<ArpEntry> | undefined = undefined;
      let fdbEntries: Array<FdbEntry> | undefined = undefined;
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
          arpEntries = walkResult.arpEntries;
          fdbEntries = walkResult.fdbEntries;
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
        arpEntries: arpEntries,
        fdbEntries: fdbEntries,
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

  /*
   * net-snmp defaults to udp4 and never falls back to the other family, so
   * an IPv6-literal target needs an explicit udp6 transport. DNS hostnames
   * keep the udp4 default — net-snmp resolves A records only, so a device
   * reachable solely over AAAA must be configured by its IPv6 literal.
   */
  private static getTransportForHost(hostname: string): "udp4" | "udp6" {
    if (IP.isIP(hostname) && new IP(hostname).isIPv6()) {
      return "udp6";
    }

    return "udp4";
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
        transport: SnmpMonitor.getTransportForHost(config.hostname),
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
      transport: SnmpMonitor.getTransportForHost(config.hostname),
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
        systemInfo?.sysObjectId
          ?.replace(/^\./, "")
          .startsWith("1.3.6.1.4.1.9."),
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

      /*
       * Best-effort ARP + FDB endpoint collection, gated on the step's
       * collectEndpoints flag. STRICTLY OPT-IN: only an explicit true turns
       * it on, so no existing monitor starts walking extra tables (and
       * writing an endpoint row per MAC per poll) just because it was
       * upgraded. Each walk fails independently — a router with no bridge
       * tables still ships its ARP cache, and vice versa — matching
       * ifXTable's best-effort pattern: a failure leaves the field
       * undefined so the server keeps its stored snapshot.
       */
      let arpEntries: Array<ArpEntry> | undefined = undefined;
      let fdbEntries: Array<FdbEntry> | undefined = undefined;

      if (options.collectEndpoints === true) {
        // One budget for the whole endpoint phase, not one per table.
        const endpointDeadlineAt: number = Date.now() + ENDPOINT_WALK_BUDGET_MS;

        try {
          arpEntries = await SnmpMonitor.walkArpTable(
            session,
            endpointDeadlineAt,
          );
        } catch (err) {
          logger.debug(
            `SNMP ARP walk failed for ${config.hostname} (device may not expose ipNetToMediaTable): ${err}`,
          );
        }

        try {
          fdbEntries = await SnmpMonitor.walkFdb(session, endpointDeadlineAt);
        } catch (err) {
          logger.debug(
            `SNMP FDB walk failed for ${config.hostname} (device may not be a bridge): ${err}`,
          );
        }
      }

      return {
        interfaces,
        systemInfo,
        entityInfo,
        lldpNeighbors,
        cdpNeighbors,
        arpEntries,
        fdbEntries,
      };
    } finally {
      session.close();
    }
  }

  /*
   * Walks IP-MIB ipNetToMediaTable — the device's ARP cache. Returns an
   * EMPTY array (not undefined) when the walk succeeds but the cache has no
   * rows, for the same stale-snapshot reason as walkCdpNeighbors.
   */
  private static async walkArpTable(
    session: snmp.Session,
    deadlineAt: number = Date.now() + ENDPOINT_WALK_BUDGET_MS,
  ): Promise<Array<ArpEntry>> {
    const table: SnmpTableRows = await SnmpMonitor.getBoundedTableColumns(
      session,
      IP_NET_TO_MEDIA_TABLE_OID,
      Object.values(IP_NET_TO_MEDIA_COLUMNS),
      MAX_ARP_ENTRIES,
      deadlineAt,
    );

    return parseArpRows(table);
  }

  /*
   * Walks the bridge forwarding database: Q-BRIDGE-MIB dot1qTpFdbTable
   * first (per-VLAN, so it carries vlanIds), falling back to BRIDGE-MIB
   * dot1dTpFdbTable when the Q-BRIDGE walk yields nothing. Bridge ports are
   * then translated to ifIndexes via dot1dBasePortTable — a DIFFERENT
   * number space, so entries without a mapping row keep interfaceIndex
   * undefined. Throws only when NEITHER FDB table is walkable; an empty
   * result from a successful walk is returned as [] (stale-snapshot rule).
   */
  private static async walkFdb(
    session: snmp.Session,
    deadlineAt: number = Date.now() + ENDPOINT_WALK_BUDGET_MS,
  ): Promise<Array<FdbEntry>> {
    let entries: Array<FdbEntry> = [];
    let qBridgeError: unknown = undefined;

    try {
      const qBridgeTable: SnmpTableRows =
        await SnmpMonitor.getBoundedTableColumns(
          session,
          DOT1Q_TP_FDB_TABLE_OID,
          Object.values(DOT1Q_TP_FDB_COLUMNS),
          MAX_FDB_ENTRIES,
          deadlineAt,
        );
      entries = parseFdbRowsQBridge(qBridgeTable);
    } catch (err) {
      qBridgeError = err;
    }

    if (entries.length === 0) {
      try {
        const dot1dTable: SnmpTableRows =
          await SnmpMonitor.getBoundedTableColumns(
            session,
            DOT1D_TP_FDB_TABLE_OID,
            Object.values(DOT1D_TP_FDB_COLUMNS),
            MAX_FDB_ENTRIES,
            deadlineAt,
          );
        entries = parseFdbRowsDot1d(dot1dTable);
      } catch (err) {
        if (qBridgeError !== undefined) {
          // Neither table walkable — the device has no readable FDB.
          throw err;
        }
        // Q-BRIDGE answered (empty); treat the FDB as genuinely empty.
        logger.debug(
          `SNMP dot1dTpFdbTable walk failed after an empty Q-BRIDGE result: ${err}`,
        );
      }
    }

    if (entries.length === 0) {
      return entries;
    }

    // Best-effort bridgePort -> ifIndex translation.
    try {
      const basePortTable: SnmpTableRows =
        await SnmpMonitor.getBoundedTableColumns(
          session,
          DOT1D_BASE_PORT_TABLE_OID,
          Object.values(DOT1D_BASE_PORT_COLUMNS),
          MAX_BASE_PORT_ENTRIES,
          deadlineAt,
        );
      entries = applyBasePortMapping(entries, parseBasePortMap(basePortTable));
    } catch (err) {
      logger.debug(
        `SNMP dot1dBasePortTable walk failed (FDB bridge ports left untranslated): ${err}`,
      );
    }

    return entries;
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

  /*
   * Returns an EMPTY array (not undefined) when the walk succeeds but the
   * cache has no rows: the inventory writer treats undefined as "walk did
   * not run, keep the stored snapshot", so returning undefined here would
   * fossilize stale CDP neighbors as ghost topology edges after a link is
   * unplugged or CDP is disabled. A failed walk still surfaces as the
   * caller's catch → undefined → snapshot kept.
   */
  private static async walkCdpNeighbors(
    session: snmp.Session,
  ): Promise<Array<CdpNeighbor>> {
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

    return neighbors;
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
   * Row-bounded alternative to getTableColumns, used for the endpoint
   * tables. net-snmp's session.tableColumns buffers the ENTIRE subtree
   * before it calls back and exposes no way to stop early — fine for
   * ifTable/ifXTable/LLDP/CDP/entPhysicalTable, which are bounded by port
   * and neighbor count, but not for ARP caches and forwarding databases,
   * which are bounded by adjacent-host and learned-MAC count and routinely
   * run to five figures on aggregation gear (or on any switch someone
   * MAC-floods). Capping the parsed output cannot help: by then the probe
   * has already buffered every row and spent thousands of sequential
   * GETBULKs fetching them.
   *
   * So drive session.subtree per column instead, whose feed callback can
   * return true to abort the walk, and stop at maxRows rows per column. The
   * caller passes the TABLE oid; the ".1." Entry subid is appended here and
   * the OID -> row/column split mirrors net-snmp's own tableColumnsFeedCb,
   * so the produced SnmpTableRows is identical in shape to what
   * tableColumns would have returned.
   *
   * Exceeding deadlineAt rejects rather than returning a partial table: a
   * truncated-by-cap walk is intentional, but a truncated-by-slowness walk
   * is degraded data, and the callers' best-effort catch turns a rejection
   * into "keep the stored snapshot" instead of half-clearing it.
   */
  private static async getBoundedTableColumns(
    session: snmp.Session,
    tableOid: string,
    columns: Array<number>,
    maxRows: number,
    deadlineAt: number,
  ): Promise<SnmpTableRows> {
    const rowOid: string = `${tableOid}.1.`;
    const table: SnmpTableRows = {};

    for (const column of columns) {
      await SnmpMonitor.walkTableColumn(
        session,
        rowOid,
        column,
        maxRows,
        deadlineAt,
        table,
      );
    }

    return table;
  }

  // Walks one column of a table into `table`, stopping at maxRows rows.
  private static walkTableColumn(
    session: snmp.Session,
    rowOid: string,
    column: number,
    maxRows: number,
    deadlineAt: number,
    table: SnmpTableRows,
  ): Promise<void> {
    return new Promise(
      (resolve: () => void, reject: (reason?: Error) => void) => {
        if (Date.now() > deadlineAt) {
          reject(
            new Error(
              "SNMP endpoint walk exceeded its time budget before the table was read",
            ),
          );
          return;
        }

        let rowsForColumn: number = 0;
        let failure: Error | undefined = undefined;

        const feedCb: (varbinds: Array<snmp.Varbind>) => boolean = (
          varbinds: Array<snmp.Varbind>,
        ): boolean => {
          if (Date.now() > deadlineAt) {
            failure = new Error(
              "SNMP endpoint walk exceeded its time budget before the table was read",
            );
            return true;
          }

          for (const varbind of varbinds) {
            if (snmp.isVarbindError(varbind)) {
              failure = new Error(snmp.varbindError(varbind));
              return true;
            }

            /*
             * Residue of "<rowOid><column>.<rowIndex>" is
             * "<column>.<rowIndex>"; the row index may itself be composite.
             */
            const residue: string = varbind.oid.replace(rowOid, "");
            if (!residue || residue === varbind.oid) {
              continue;
            }

            const match: RegExpMatchArray | null =
              residue.match(/^(\d+)\.(.+)$/);
            if (!match || !match[1] || !match[2]) {
              continue;
            }

            const columnKey: string = match[1];
            const rowKey: string = match[2];
            if (parseInt(columnKey, 10) <= 0) {
              continue;
            }

            if (!table[rowKey]) {
              table[rowKey] = {};
            }
            table[rowKey]![columnKey] = varbind.value;

            rowsForColumn++;
            if (rowsForColumn >= maxRows) {
              // Cap reached mid-walk: stop asking the device for more rows.
              return true;
            }
          }

          return false;
        };

        (session as any).subtree(
          `${rowOid}${column}`,
          SNMP_TABLE_MAX_REPETITIONS,
          feedCb,
          (error: Error | null) => {
            if (error) {
              reject(error);
              return;
            }
            if (failure) {
              reject(failure);
              return;
            }
            resolve();
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
      if (value.length === 0) {
        return undefined;
      }

      // Native fast paths.
      if (value.length <= 6) {
        return value.readUIntBE(0, value.length);
      }
      if (value.length === 8) {
        return Number(value.readBigUInt64BE());
      }

      /*
       * net-snmp hands Counter64 varbinds over as minimal-length big-endian
       * buffers, so 7-byte (2^48..2^56-1) and 9-byte (a leading 0x00 pad on
       * values >= 2^63) encodings both occur. Accumulate as BigInt over all
       * bytes so those aren't dropped; >8 significant bytes can't fit a
       * Counter64, so bail rather than return a wrong number.
       */
      let accumulator: bigint = BigInt(0);
      const eight: bigint = BigInt(8);
      for (const byte of value) {
        accumulator = (accumulator << eight) | BigInt(byte);
      }
      // Max Counter64 is 2^64 - 1; anything larger can't be a valid counter.
      if (accumulator > BigInt("18446744073709551615")) {
        return undefined;
      }
      return Number(accumulator);
    }

    return undefined;
  }

  private static toDisplayString(value: unknown): string | undefined {
    if (Buffer.isBuffer(value)) {
      /*
       * Binary OctetStrings (LLDP/CDP chassis and port IDs are usually raw
       * MAC addresses) decode to NUL bytes and mojibake as UTF-8. Postgres
       * cannot store a NUL inside a jsonb column, so the neighbor snapshot
       * write fails with "unsupported Unicode escape sequence" and takes
       * the whole NetworkDevice inventory update down with it - leaving the
       * device stuck without sysName/lastSeenAt and with no interface rows.
       * Render them as colon-separated hex, the same as parseVarbindValue.
       */
      if (!SnmpMonitor.isPrintableBuffer(value)) {
        return SnmpMonitor.toMacAddress(value);
      }

      return value.toString("utf8").trim() || undefined;
    }

    if (typeof value === "string") {
      return value.trim() || undefined;
    }

    return undefined;
  }

  /*
   * ifPhysAddress arrives as a raw octet buffer. Loopbacks/tunnels report an
   * empty or all-zero address — treat those as "no MAC". Shared with the
   * endpoint-table parsers so ARP/FDB MACs format identically and join
   * cleanly server-side.
   */
  private static toMacAddress(value: unknown): string | undefined {
    return toMacAddressString(value);
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

    /*
     * Resolved once and reused: the level decides which credentials go on the
     * wire, so the branches below and the level handed to net-snmp must agree.
     * Comparing the raw stored string against the enum here would let a
     * differently-spelled "AuthPriv" take the noAuthNoPriv branch and strip
     * the device's credentials.
     */
    const securityLevel: SnmpSecurityLevel = SnmpMonitor.resolveSecurityLevel(
      v3Auth.securityLevel,
      config.hostname,
    );

    const user: snmp.User = {
      name: v3Auth.username,
      level: SnmpMonitor.mapSecurityLevel(securityLevel),
    };

    if (
      securityLevel === SnmpSecurityLevel.AuthNoPriv ||
      securityLevel === SnmpSecurityLevel.AuthPriv
    ) {
      user.authProtocol = SnmpMonitor.mapAuthProtocol(
        v3Auth.authProtocol,
        config.hostname,
      );
      user.authKey = v3Auth.authKey || "";
    }

    if (securityLevel === SnmpSecurityLevel.AuthPriv) {
      user.privProtocol = SnmpMonitor.mapPrivProtocol(
        v3Auth.privProtocol,
        config.hostname,
      );
      user.privKey = v3Auth.privKey || "";
    }

    return user;
  }

  /*
   * The three resolvers below share one rule, and the distinction they draw is
   * the point of them.
   *
   * An UNSET protocol keeps the historical default — plenty of devices were
   * configured before these columns were mandatory, and silently breaking them
   * would be a worse bug than the one being fixed.
   *
   * A protocol that is SET but matches nothing is refused. There is no safe
   * guess available: the stored value says the operator intended *something*,
   * and quietly substituting the weakest algorithm is how a device meant for
   * AES ends up encrypted with DES, or an authPriv device ends up polled with
   * no credentials at all. Throwing here is caught by SnmpMonitor.query and
   * surfaces as the monitor's failure cause, so the operator sees the bad
   * value instead of an unexplained timeout — the same treatment the missing
   * v3 username already gets.
   */
  private static resolveSecurityLevel(
    level: SnmpSecurityLevel | undefined,
    hostname: string,
  ): SnmpSecurityLevel {
    if (SnmpSecurityLevelUtil.isUnrecognized(level)) {
      throw new Error(
        `SNMP v3 security level "${level}" configured for ${hostname} is not a recognized value. Expected one of: ${Object.values(
          SnmpSecurityLevel,
        ).join(", ")}.`,
      );
    }

    return SnmpSecurityLevelUtil.parse(level) || SnmpSecurityLevel.NoAuthNoPriv;
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
    hostname: string,
  ): snmp.AuthProtocols {
    if (SnmpAuthProtocolUtil.isUnrecognized(protocol)) {
      throw new Error(
        `SNMP v3 authentication protocol "${protocol}" configured for ${hostname} is not a recognized value. Expected one of: ${Object.values(
          SnmpAuthProtocol,
        ).join(", ")}.`,
      );
    }

    switch (SnmpAuthProtocolUtil.parse(protocol)) {
      case SnmpAuthProtocol.MD5:
        return snmp.AuthProtocols.md5;
      case SnmpAuthProtocol.SHA:
        return snmp.AuthProtocols.sha;
      case SnmpAuthProtocol.SHA256:
        return snmp.AuthProtocols.sha256;
      case SnmpAuthProtocol.SHA512:
        return snmp.AuthProtocols.sha512;
      default:
        // Unset only — anything unrecognized threw above.
        return snmp.AuthProtocols.md5;
    }
  }

  private static mapPrivProtocol(
    protocol: SnmpPrivProtocol | undefined,
    hostname: string,
  ): snmp.PrivProtocols {
    if (SnmpPrivProtocolUtil.isUnrecognized(protocol)) {
      throw new Error(
        `SNMP v3 privacy protocol "${protocol}" configured for ${hostname} is not a recognized value. Expected one of: ${Object.values(
          SnmpPrivProtocol,
        ).join(", ")}.`,
      );
    }

    switch (SnmpPrivProtocolUtil.parse(protocol)) {
      case SnmpPrivProtocol.DES:
        return snmp.PrivProtocols.des;
      case SnmpPrivProtocol.AES:
        return snmp.PrivProtocols.aes;
      case SnmpPrivProtocol.AES256:
        return snmp.PrivProtocols.aes256b;
      default:
        // Unset only — anything unrecognized threw above.
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

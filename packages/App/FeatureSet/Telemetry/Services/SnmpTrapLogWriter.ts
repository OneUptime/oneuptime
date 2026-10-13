import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import LogSeverity from "Common/Types/Log/LogSeverity";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import SnmpTrap from "Common/Types/Monitor/SnmpMonitor/SnmpTrap";
import {
  getSnmpTrapEventAttributes,
  getSnmpTrapInterfaceIndex,
} from "Common/Utils/NetworkEvent/SnmpTrapEvent";
import { resolveTelemetryRetentionInDays } from "Common/Types/Telemetry/TelemetryRetentionConfig";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkInterface from "Common/Models/DatabaseModels/NetworkInterface";
import LogService from "Common/Server/Services/LogService";
import NetworkInterfaceService from "Common/Server/Services/NetworkInterfaceService";
import OTelIngestService, {
  TelemetryServiceMetadata,
  getScalarEntityKeyColumns,
} from "Common/Server/Services/OpenTelemetryIngestService";
import TelemetryUtil, {
  AttributeType,
} from "Common/Server/Utils/Telemetry/Telemetry";
import logger from "Common/Server/Utils/Logger";

/*
 * Persists SNMP traps as device-attributed rows in the telemetry Log table
 * — the same treatment probe-forwarded syslog gets. Before this, a trap
 * survived only inside MonitorLog JSON (default 1-day retention) and only
 * when a monitor matched it; there was no queryable trap history at all.
 *
 * One row per matched device, in that device's project, under a telemetry
 * service named after the device — so traps and syslog for a device land
 * on the same service and the device's Logs page shows both.
 */

const DEFAULT_SERVICE_NAME: string = "network-devices";

// Standard trap OIDs → readable names for the log body.
const WELL_KNOWN_TRAPS: Dictionary<string> = {
  "1.3.6.1.6.3.1.1.5.1": "coldStart",
  "1.3.6.1.6.3.1.1.5.2": "warmStart",
  "1.3.6.1.6.3.1.1.5.3": "linkDown",
  "1.3.6.1.6.3.1.1.5.4": "linkUp",
  "1.3.6.1.6.3.1.1.5.5": "authenticationFailure",
  "1.3.6.1.6.3.1.1.5.6": "egpNeighborLoss",
};

export default class SnmpTrapLogWriter {
  /*
   * Writes one log row per (device, project) for a trap. Failures are
   * logged and swallowed — trap persistence must never break the
   * monitor-criteria evaluation path that runs alongside it.
   */
  public static async writeTrapLogRows(data: {
    snmpTrap: SnmpTrap;
    probeId: ObjectID;
    devices: Array<NetworkDevice>;
  }): Promise<void> {
    try {
      const dbLogs: Array<JSONObject> = [];
      const serviceCache: Dictionary<TelemetryServiceMetadata> = {};

      for (const device of data.devices) {
        if (!device.id || !device.projectId) {
          continue;
        }

        const row: JSONObject | null = await SnmpTrapLogWriter.buildTrapLogRow({
          snmpTrap: data.snmpTrap,
          probeId: data.probeId,
          projectId: device.projectId,
          device: device,
          serviceCache: serviceCache,
        });

        if (row) {
          dbLogs.push(row);
        }
      }

      if (dbLogs.length > 0) {
        await LogService.insertJsonRows(dbLogs);
      }
    } catch (err) {
      logger.error("SNMP trap log writer: error persisting trap:");
      logger.error(err);
    }
  }

  /*
   * A trap whose source matched no device still gets recorded when the
   * receiving probe is project-scoped — attributed to the shared
   * "network-devices" service with snmpTrap.unmatched=true, so operators
   * can see traps arriving from gear they have not registered yet. Global
   * probes have no project to attribute to; those traps stay dropped.
   */
  public static async writeUnmatchedTrapLogRow(data: {
    snmpTrap: SnmpTrap;
    probeId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    try {
      const row: JSONObject | null = await SnmpTrapLogWriter.buildTrapLogRow({
        snmpTrap: data.snmpTrap,
        probeId: data.probeId,
        projectId: data.projectId,
        device: null,
        serviceCache: {},
      });

      if (row) {
        await LogService.insertJsonRows([row]);
      }
    } catch (err) {
      logger.error("SNMP trap log writer: error persisting unmatched trap:");
      logger.error(err);
    }
  }

  /*
   * The name of the interface a link trap is about, when the trap gives
   * only its index (all RFC 2863 asks of it): the name the device's last
   * walk recorded for that index. Undefined when the trap names its
   * interface itself, when it is not a link trap, and when the device has
   * no such interface on record - the event then says "ifIndex N".
   *
   * A lookup that fails leaves the name out; it never loses the trap.
   */
  private static async findInterfaceName(
    snmpTrap: SnmpTrap,
    device: NetworkDevice | null,
  ): Promise<string | undefined> {
    if (!device?.id) {
      return undefined;
    }

    const interfaceIndex: number | null = getSnmpTrapInterfaceIndex(snmpTrap);

    if (interfaceIndex === null) {
      return undefined;
    }

    try {
      const networkInterface: NetworkInterface | null =
        await NetworkInterfaceService.findOneBy({
          query: {
            networkDeviceId: device.id,
            interfaceIndex: interfaceIndex,
          },
          select: {
            name: true,
          },
          props: {
            isRoot: true,
          },
        });

      return networkInterface?.name?.trim() || undefined;
    } catch (err) {
      logger.error("SNMP trap log writer: error reading the interface:");
      logger.error(err);

      return undefined;
    }
  }

  private static async buildTrapLogRow(data: {
    snmpTrap: SnmpTrap;
    probeId: ObjectID;
    projectId: ObjectID;
    device: NetworkDevice | null;
    serviceCache: Dictionary<TelemetryServiceMetadata>;
  }): Promise<JSONObject | null> {
    const snmpTrap: SnmpTrap = data.snmpTrap;

    const serviceName: string =
      data.device?.name?.trim() || DEFAULT_SERVICE_NAME;
    const serviceCacheKey: string = `${data.projectId.toString()}:${serviceName}`;

    if (!data.serviceCache[serviceCacheKey]) {
      data.serviceCache[serviceCacheKey] =
        await OTelIngestService.telemetryServiceFromName({
          serviceName: serviceName,
          projectId: data.projectId,
        });
    }

    const serviceMetadata: TelemetryServiceMetadata =
      data.serviceCache[serviceCacheKey]!;

    const attributes: Dictionary<AttributeType | Array<AttributeType>> = {
      /*
       * linkDown, linkUp, coldStart and warmStart are the same events a
       * device also reports over syslog: stored under the same name, so
       * what is built on the event finds them either way.
       */
      ...getSnmpTrapEventAttributes(snmpTrap, {
        interfaceName: await SnmpTrapLogWriter.findInterfaceName(
          snmpTrap,
          data.device,
        ),
      }),
      ...TelemetryUtil.getAttributesForServiceIdAndServiceName({
        serviceId: serviceMetadata.primaryEntityId,
        serviceName: serviceName,
      }),
      "snmpTrap.oid": snmpTrap.trapOid,
      "snmpTrap.sourceIp": snmpTrap.sourceIpAddress,
      "snmpTrap.version": snmpTrap.snmpVersion,
      "snmpTrap.varbindCount": snmpTrap.varbinds?.length || 0,
      "probe.id": data.probeId.toString(),
    };

    const trapName: string | undefined = WELL_KNOWN_TRAPS[snmpTrap.trapOid];
    if (trapName) {
      attributes["snmpTrap.name"] = trapName;
    }

    if (!data.device) {
      attributes["snmpTrap.unmatched"] = true;
    }

    if (data.device?.id) {
      attributes["networkDevice.id"] = data.device.id.toString();
    }

    if (data.device?.name) {
      attributes["networkDevice.name"] = data.device.name;
    }

    /*
     * Varbinds land as a JSON attribute (queryable, bounded) and the body
     * stays a human-readable one-liner. Cap serialized varbinds so a
     * hostile datagram cannot bloat rows.
     */
    if (snmpTrap.varbinds && snmpTrap.varbinds.length > 0) {
      attributes["snmpTrap.varbinds"] = JSON.stringify(
        snmpTrap.varbinds,
      ).substring(0, 8192);
    }

    // linkDown/linkUp traps carry ifIndex as the first varbind by RFC.
    const ingestionDate: Date = OneUptimeDate.getCurrentDate();

    const receivedAt: Date = snmpTrap.receivedAt
      ? OneUptimeDate.fromString(snmpTrap.receivedAt)
      : ingestionDate;

    const retentionDays: number = resolveTelemetryRetentionInDays({
      pillar: "logs",
      bucketKey: LogSeverity.Information,
      serviceConfig: serviceMetadata.serviceRetentionConfig,
      serviceRetentionInDays: serviceMetadata.serviceRetentionInDays,
      projectConfig: serviceMetadata.projectRetentionConfig,
      projectRetentionInDays: serviceMetadata.projectRetentionInDays,
    });

    const retentionDate: Date = OneUptimeDate.addRemoveDays(
      ingestionDate,
      retentionDays,
    );

    const bodyName: string = trapName ? ` (${trapName})` : "";

    return {
      _id: ObjectID.generateTimeOrdered().toString(),
      createdAt: OneUptimeDate.toClickhouseDateTime(ingestionDate),
      projectId: data.projectId.toString(),
      primaryEntityId: serviceMetadata.primaryEntityId.toString(),
      primaryEntityType: serviceMetadata.primaryEntityType,
      entityKeys: serviceMetadata.entityKeys || [],
      ...getScalarEntityKeyColumns(serviceMetadata),
      time: OneUptimeDate.toClickhouseDateTime64(receivedAt),
      timeUnixNano: Math.trunc(OneUptimeDate.toUnixNano(receivedAt)).toString(),
      severityNumber: 9,
      severityText: LogSeverity.Information,
      attributes: attributes,
      attributeKeys: TelemetryUtil.getAttributeKeys(attributes),
      traceId: "",
      spanId: "",
      body: `SNMP trap ${snmpTrap.trapOid}${bodyName} received from ${snmpTrap.sourceIpAddress}`,
      retentionDate: OneUptimeDate.toClickhouseDateTime(retentionDate),
    } satisfies JSONObject;
  }
}

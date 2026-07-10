import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import QueryHelper from "../../Types/Database/QueryHelper";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import MonitorType from "../../../Types/Monitor/MonitorType";
import SnmpVersion from "../../../Types/Monitor/SnmpMonitor/SnmpVersion";
import SnmpV3Auth from "../../../Types/Monitor/SnmpMonitor/SnmpV3Auth";
import ObjectID from "../../../Types/ObjectID";
import logger from "../Logger";

/*
 * Network Device monitor steps reference a NetworkDevice resource instead of
 * carrying SNMP connection details. Probes are stateless and only understand
 * concrete SNMP config, so before work is handed out the referenced device's
 * hostname/credentials are hydrated into each step's `snmpMonitor` field.
 */
export interface HydratableMonitor {
  id?: ObjectID | null | undefined;
  monitorType?: MonitorType | undefined;
  monitorSteps?: MonitorSteps | undefined;
}

export default class NetworkDeviceHydrationUtil {
  // Accepts Monitor and MonitorTest alike (structural: monitorType + monitorSteps).
  public static async hydrateNetworkDeviceMonitors(
    monitors: Array<HydratableMonitor>,
  ): Promise<void> {
    const deviceIds: Set<string> = new Set();

    for (const monitor of monitors) {
      if (monitor.monitorType !== MonitorType.NetworkDevice) {
        continue;
      }

      for (const step of monitor.monitorSteps?.data
        ?.monitorStepsInstanceArray || []) {
        const deviceId: string | undefined =
          step.data?.networkDeviceMonitor?.networkDeviceId;
        if (deviceId) {
          deviceIds.add(deviceId);
        }
      }
    }

    if (deviceIds.size === 0) {
      return;
    }

    const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
      query: {
        _id: QueryHelper.any(Array.from(deviceIds)),
      },
      select: {
        _id: true,
        hostname: true,
        snmpVersion: true,
        snmpCommunityString: true,
        snmpPort: true,
        snmpV3Auth: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const devicesById: Map<string, NetworkDevice> = new Map();
    for (const device of devices) {
      if (device.id) {
        devicesById.set(device.id.toString(), device);
      }
    }

    for (const monitor of monitors) {
      if (monitor.monitorType !== MonitorType.NetworkDevice) {
        continue;
      }

      for (const step of monitor.monitorSteps?.data
        ?.monitorStepsInstanceArray || []) {
        const deviceId: string | undefined =
          step.data?.networkDeviceMonitor?.networkDeviceId;

        if (!deviceId || !step.data) {
          continue;
        }

        const device: NetworkDevice | undefined = devicesById.get(deviceId);

        if (!device || !device.hostname) {
          logger.warn(
            `Network Device monitor ${monitor.id?.toString()} references missing device ${deviceId}. Step will not be executable.`,
          );
          continue;
        }

        step.data.snmpMonitor = {
          snmpVersion: NetworkDeviceHydrationUtil.parseSnmpVersion(
            device.snmpVersion,
          ),
          hostname: device.hostname,
          port: device.snmpPort || 161,
          communityString: device.snmpCommunityString || undefined,
          snmpV3Auth:
            (device.snmpV3Auth as SnmpV3Auth | undefined) || undefined,
          oids: step.data.networkDeviceMonitor?.oids || [],
          timeout: 5000,
          retries: 3,
          monitorInterfaces:
            step.data.networkDeviceMonitor?.monitorInterfaces !== false,
        };
      }
    }
  }

  // Tolerates both enum values ("2c") and enum keys ("V2c") in stored config.
  private static parseSnmpVersion(value: string | undefined): SnmpVersion {
    switch ((value || "").toLowerCase()) {
      case "1":
      case "v1":
        return SnmpVersion.V1;
      case "3":
      case "v3":
        return SnmpVersion.V3;
      default:
        return SnmpVersion.V2c;
    }
  }

  /*
   * Resolves which NetworkDevices (polled by the given probe) match a trap
   * source IP. Used by the trap ingest to fan traps out to device monitors.
   */
  public static async findDevicesByProbeAndSource(data: {
    probeId: ObjectID;
    sourceIpAddress: string;
  }): Promise<Array<NetworkDevice>> {
    return NetworkDeviceService.findBy({
      query: {
        probeId: data.probeId,
        hostname: data.sourceIpAddress,
      },
      select: {
        _id: true,
        projectId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }
}

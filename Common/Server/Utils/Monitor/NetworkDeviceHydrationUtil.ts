import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import QueryHelper from "../../Types/Database/QueryHelper";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import MonitorType from "../../../Types/Monitor/MonitorType";
import SnmpVersion, {
  SnmpVersionUtil,
} from "../../../Types/Monitor/SnmpMonitor/SnmpVersion";
import SnmpV3Auth from "../../../Types/Monitor/SnmpMonitor/SnmpV3Auth";
import SnmpSecurityLevel from "../../../Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpAuthProtocol from "../../../Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "../../../Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
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
  /*
   * Parses which NetworkDevice IDs a batch of Network Device monitors
   * reference in their steps (step.data.networkDeviceMonitor.networkDeviceId).
   * Non-NetworkDevice monitors are skipped. Shared by hydration below and by
   * the site rollup engine, which stamps device status on monitor status
   * changes - keep this the single copy of the step-parsing logic.
   */
  public static getReferencedNetworkDeviceIds(
    monitors: Array<HydratableMonitor>,
  ): Array<string> {
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

    return Array.from(deviceIds);
  }

  // Accepts Monitor and MonitorTest alike (structural: monitorType + monitorSteps).
  public static async hydrateNetworkDeviceMonitors(
    monitors: Array<HydratableMonitor>,
  ): Promise<void> {
    const deviceIds: Array<string> =
      NetworkDeviceHydrationUtil.getReferencedNetworkDeviceIds(monitors);

    if (deviceIds.length === 0) {
      return;
    }

    const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
      query: {
        _id: QueryHelper.any(deviceIds),
      },
      select: {
        _id: true,
        hostname: true,
        snmpVersion: true,
        snmpCommunityString: true,
        snmpPort: true,
        snmpV3Auth: true,
        snmpV3SecurityLevel: true,
        snmpV3Username: true,
        snmpV3AuthProtocol: true,
        snmpV3AuthKey: true,
        snmpV3PrivProtocol: true,
        snmpV3PrivKey: true,
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
          snmpV3Auth: NetworkDeviceHydrationUtil.buildSnmpV3Auth(device),
          oids: step.data.networkDeviceMonitor?.oids || [],
          timeout: 5000,
          retries: 3,
          monitorInterfaces:
            step.data.networkDeviceMonitor?.monitorInterfaces !== false,
        };
      }
    }
  }

  /*
   * Assembles the SnmpV3Auth object the probe expects. Prefers the flattened
   * snmpV3* columns (the current storage), falling back to the deprecated
   * snmpV3Auth JSON column so devices created before the columns existed keep
   * working. Returns undefined when no v3 username is configured.
   *
   * The protocol columns are passed through as stored, on purpose. It is
   * tempting to validate them here with SnmpSecurityLevelUtil /
   * SnmpAuthProtocolUtil / SnmpPrivProtocolUtil, but this runs server-side
   * inside the probe's monitor-list request, and that request claims its
   * monitors — advancing nextPingAt — before hydration runs. A throw here
   * would 500 the whole batch, so one malformed row would stall up to a
   * hundred unrelated monitors of every type, every cycle, with nothing
   * recorded against them.
   *
   * The probe validates instead, in SnmpMonitor.buildV3User, where a bad value
   * fails exactly one monitor and shows up as its failure cause. Parsing here
   * would defeat that by folding an unreadable value into undefined, which the
   * probe cannot tell from "never configured" — and would therefore poll with
   * a silently defaulted algorithm.
   */
  private static buildSnmpV3Auth(
    device: NetworkDevice,
  ): SnmpV3Auth | undefined {
    if (device.snmpV3Username) {
      return {
        securityLevel:
          (device.snmpV3SecurityLevel as SnmpSecurityLevel) ||
          SnmpSecurityLevel.NoAuthNoPriv,
        username: device.snmpV3Username,
        authProtocol:
          (device.snmpV3AuthProtocol as SnmpAuthProtocol | undefined) ||
          undefined,
        authKey: device.snmpV3AuthKey || undefined,
        privProtocol:
          (device.snmpV3PrivProtocol as SnmpPrivProtocol | undefined) ||
          undefined,
        privKey: device.snmpV3PrivKey || undefined,
      };
    }

    // Legacy devices stored the whole object in the snmpV3Auth JSON column.
    const legacy: SnmpV3Auth | undefined = device.snmpV3Auth as
      | SnmpV3Auth
      | undefined;
    if (legacy && legacy.username) {
      return legacy;
    }

    return undefined;
  }

  // Tolerates both enum values ("2c") and enum keys ("V2c") in stored config.
  private static parseSnmpVersion(value: string | undefined): SnmpVersion {
    return SnmpVersionUtil.parse(value);
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

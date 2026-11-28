import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import GlobalProbeSnmpTrapReportService from "../../Services/GlobalProbeSnmpTrapReportService";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import ProbeService from "../../Services/ProbeService";
import ObjectID from "../../../Types/ObjectID";
import {
  SnmpTrapReceiverReport,
  SnmpTrapReceiverUser,
  SnmpTrapRefusal,
} from "../../../Types/Probe/SnmpTrapReceiver";
import SnmpTrapRefusalShares, {
  SnmpTrapRefusalShareDevice,
} from "../../../Types/Probe/SnmpTrapRefusalShares";
import NetworkDeviceHydrationUtil from "./NetworkDeviceHydrationUtil";
import SnmpTrapReceiverUsers from "./SnmpTrapReceiverUsers";

/*
 * WHERE A PROBE'S SNMP TRAP RECEIVER REPORT IS KEPT, AND FOR WHOM
 * (OneUptime issues #11005, #11173, #11406).
 *
 *   - A project's own probe: whole, on the probe (Probe.snmpTrapReceiver),
 *     read by the probe's readers on its page and on its devices' pages,
 *     each refusal naming the devices it came from.
 *   - A global probe: what belongs to no project on the probe - whether its
 *     receiver is on, its port and its engine ID, which every project that
 *     uses it may read - and its refused SNMPv3 traps split by project as
 *     they arrive, each project's in a row of its own
 *     (GlobalProbeSnmpTrapReport): the refusals from its own devices'
 *     addresses, worded as that project would see them and naming its own
 *     devices (SnmpTrapRefusalShares). No project ever reads another's
 *     addresses, user names or devices.
 *
 * Which devices a refusal came from is worked out here, the way a trap is
 * matched to its device (#11406): the devices on the probe that have its
 * source address as their hostname or one of their Other Addresses
 * (NetworkDeviceService.findDevicesAtAddressesOnProbe), and those whose DNS
 * name resolves to it (findDnsNamedDevicesOnProbe, resolved through trap
 * matching's own cache: NetworkDeviceHydrationUtil.resolveHostnames). Both
 * reads are held to the tenancy the users a probe is handed are. The user
 * names each project is read against are those of the users it was handed
 * in the same report (SnmpTrapReceiverUsers.getUserNamesByProject).
 */

/*
 * The most devices registered by a DNS name one report's refusals are
 * matched against: past it, the first in a stable order. Each name is
 * resolved at most once in five minutes (resolveHostnames).
 */
export const MAX_DNS_NAMED_DEVICES_PER_REPORT: number = 5000;

export default class SnmpTrapReceiverReports {
  // Returns whether the probe keeps reports at all.
  public static async record(data: {
    probeId: ObjectID;
    report: SnmpTrapReceiverReport;
    users: Array<SnmpTrapReceiverUser>;
  }): Promise<boolean> {
    const devices: Array<SnmpTrapRefusalShareDevice> =
      await SnmpTrapReceiverReports.findRefusalDevices({
        probeId: data.probeId,
        refusals: data.report.refusals,
      });

    /*
     * Kept whole only on a project's own probe, whose devices are all its
     * project's (the reads' tenancy); a global probe keeps none of its
     * refusals on itself (SnmpTrapReceiverUtil.toSharedReport).
     */
    const kept: { isKept: boolean; isGlobalProbe: boolean } =
      await ProbeService.recordSnmpTrapReceiverReport({
        probeId: data.probeId,
        report: {
          ...data.report,
          refusals: SnmpTrapRefusalShares.attributeToDevices({
            refusals: data.report.refusals,
            devices: devices,
          }),
        },
      });

    if (kept.isKept && kept.isGlobalProbe) {
      await GlobalProbeSnmpTrapReportService.recordShares({
        probeId: data.probeId,
        sharesByProject: SnmpTrapReceiverReports.split({
          report: data.report,
          users: data.users,
          devices: devices,
        }),
      });
    }

    return kept.isKept;
  }

  // Each project's share of a global probe's refused SNMPv3 traps.
  public static async splitByProject(data: {
    probeId: ObjectID;
    report: SnmpTrapReceiverReport;
    users: Array<SnmpTrapReceiverUser>;
  }): Promise<Map<string, Array<SnmpTrapRefusal>>> {
    return SnmpTrapReceiverReports.split({
      report: data.report,
      users: data.users,
      devices: await SnmpTrapReceiverReports.findRefusalDevices({
        probeId: data.probeId,
        refusals: data.report.refusals,
      }),
    });
  }

  /*
   * The devices on a probe a report's refusals may have come from, each with
   * the addresses it has among the refusals' sources: its hostname when
   * that is an address, its Other Addresses, and what its DNS name resolves
   * to. None when nothing was refused, without a read.
   */
  public static async findRefusalDevices(data: {
    probeId: ObjectID;
    refusals: Array<SnmpTrapRefusal>;
  }): Promise<Array<SnmpTrapRefusalShareDevice>> {
    if (data.refusals.length === 0) {
      return [];
    }

    const sources: Array<string> = Array.from(
      new Set(
        data.refusals.map((refusal: SnmpTrapRefusal): string => {
          return refusal.sourceAddress;
        }),
      ),
    );

    const [atAddresses, dnsNamed]: [
      Array<NetworkDevice>,
      Array<NetworkDevice>,
    ] = await Promise.all([
      NetworkDeviceService.findDevicesAtAddressesOnProbe({
        probeId: data.probeId,
        addresses: sources,
      }),
      NetworkDeviceService.findDnsNamedDevicesOnProbe({
        probeId: data.probeId,
        limit: MAX_DNS_NAMED_DEVICES_PER_REPORT,
      }),
    ]);

    const addressesByHostname: Map<string, Array<string>> = dnsNamed.length > 0
      ? await NetworkDeviceHydrationUtil.resolveHostnames({
          hostnames: dnsNamed.map((device: NetworkDevice): string => {
            return device.hostname || "";
          }),
        })
      : new Map();

    const sourceSet: Set<string> = new Set(sources);
    const devicesById: Map<string, SnmpTrapRefusalShareDevice> = new Map();

    const add: (device: NetworkDevice, resolved: Array<string>) => void = (
      device: NetworkDevice,
      resolved: Array<string>,
    ): void => {
      const id: string = device.id?.toString().toLowerCase() || "";
      const projectId: string =
        device.projectId?.toString().toLowerCase() || "";

      if (!id || !projectId) {
        return;
      }

      const known: SnmpTrapRefusalShareDevice = devicesById.get(id) || {
        id: id,
        projectId: projectId,
        addresses: [],
      };

      for (const address of [
        ...SnmpTrapReceiverUsers.getDeviceAddresses(device),
        ...resolved,
      ]) {
        if (!known.addresses.includes(address)) {
          known.addresses.push(address);
        }
      }

      devicesById.set(id, known);
    };

    for (const device of atAddresses) {
      add(device, []);
    }

    for (const device of dnsNamed) {
      const resolved: Array<string> = (
        addressesByHostname.get((device.hostname || "").trim().toLowerCase()) ||
        []
      ).filter((address: string): boolean => {
        return sourceSet.has(address);
      });

      // Only a name that resolves to a refusal's source concerns the report.
      if (resolved.length > 0) {
        add(device, resolved);
      }
    }

    return Array.from(devicesById.values());
  }

  private static split(data: {
    report: SnmpTrapReceiverReport;
    users: Array<SnmpTrapReceiverUser>;
    devices: Array<SnmpTrapRefusalShareDevice>;
  }): Map<string, Array<SnmpTrapRefusal>> {
    if (data.report.refusals.length === 0) {
      return new Map();
    }

    return SnmpTrapRefusalShares.split({
      refusals: data.report.refusals,
      devices: data.devices,
      userNamesByProject: SnmpTrapReceiverUsers.getUserNamesByProject(
        data.users,
      ),
    });
  }
}

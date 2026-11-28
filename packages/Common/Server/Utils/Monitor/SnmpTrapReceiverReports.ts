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
import SnmpTrapRefusalShares from "../../../Types/Probe/SnmpTrapRefusalShares";
import SnmpTrapReceiverUsers from "./SnmpTrapReceiverUsers";

/*
 * WHERE A PROBE'S SNMP TRAP RECEIVER REPORT IS KEPT, AND FOR WHOM
 * (OneUptime issues #11005, #11173).
 *
 *   - A project's own probe: whole, on the probe (Probe.snmpTrapReceiver),
 *     read by the probe's readers on its page and on its devices' pages.
 *   - A global probe: what belongs to no project on the probe - whether its
 *     receiver is on, its port and its engine ID, which every project that
 *     uses it may read - and its refused SNMPv3 traps split by project as
 *     they arrive, each project's in a row of its own
 *     (GlobalProbeSnmpTrapReport): the refusals from its own devices'
 *     addresses, worded as that project would see them
 *     (SnmpTrapRefusalShares). No project ever reads another's addresses or
 *     user names.
 *
 * The devices a refusal is matched to are the probe's own, held to the
 * tenancy the users it is handed are (NetworkDeviceService
 * .findDevicesAtAddressesOnProbe), and the user names each project is read
 * against are those of the users it was handed in the same report
 * (SnmpTrapReceiverUsers.getUserNamesByProject).
 */
export default class SnmpTrapReceiverReports {
  // Returns whether the probe keeps reports at all.
  public static async record(data: {
    probeId: ObjectID;
    report: SnmpTrapReceiverReport;
    users: Array<SnmpTrapReceiverUser>;
  }): Promise<boolean> {
    const kept: { isKept: boolean; isGlobalProbe: boolean } =
      await ProbeService.recordSnmpTrapReceiverReport({
        probeId: data.probeId,
        report: data.report,
      });

    if (kept.isKept && kept.isGlobalProbe) {
      await GlobalProbeSnmpTrapReportService.recordShares({
        probeId: data.probeId,
        sharesByProject: await SnmpTrapReceiverReports.splitByProject(data),
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
    if (data.report.refusals.length === 0) {
      return new Map();
    }

    const devices: Array<NetworkDevice> =
      await NetworkDeviceService.findDevicesAtAddressesOnProbe({
        probeId: data.probeId,
        addresses: data.report.refusals.map(
          (refusal: SnmpTrapRefusal): string => {
            return refusal.sourceAddress;
          },
        ),
      });

    return SnmpTrapRefusalShares.split({
      refusals: data.report.refusals,
      devices: devices.flatMap(
        (
          device: NetworkDevice,
        ): Array<{ projectId: string; addresses: Array<string> }> => {
          return device.projectId
            ? [
                {
                  projectId: device.projectId.toString().toLowerCase(),
                  addresses: SnmpTrapReceiverUsers.getDeviceAddresses(device),
                },
              ]
            : [];
        },
      ),
      userNamesByProject: SnmpTrapReceiverUsers.getUserNamesByProject(
        data.users,
      ),
    });
  }
}

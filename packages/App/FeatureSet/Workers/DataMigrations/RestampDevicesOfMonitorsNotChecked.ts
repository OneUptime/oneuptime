import DataMigrationBase from "./DataMigrationBase";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import MonitorService from "Common/Server/Services/MonitorService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import { NetworkDeviceMonitoringMethodUtil } from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "Common/Types/ObjectID";
import MonitoringOff, {
  MONITORED_SELECT,
} from "Common/Utils/Monitor/MonitoringOff";

/*
 * Takes the frozen status off every monitor-backed network device whose
 * bound monitor is not checked - its monitoring turned off, or archived
 * (issue #6965).
 *
 * A device takes no status from such a monitor any more
 * (NetworkDeviceService.refreshStampedMonitorStatus, and the re-stamp
 * MonitorService runs when a monitor is turned off, on, archived or
 * unarchived). That holds for every switch from now on. A monitor that was
 * turned off or archived before it did left its last status - "Offline",
 * say - on its devices, and nothing would ever move it: so their sites
 * still roll up from it, and their site alerts stay open. This walks those
 * devices once and stamps them again.
 *
 * Only the devices that need it are re-stamped: each page of devices that
 * point at a monitor is matched against one read of those monitors'
 * switches, and a device whose monitor is checked, or that already has no
 * status, is left alone. The re-stamp itself refreshes the device's site
 * chain, which clears a site nothing else reports on and resolves its
 * alert (NetworkSiteService.recomputeRollupForSite).
 *
 * Idempotent, and safe to run twice at once as this runner requires (see
 * Workers/Utils/DataMigration.ts): refreshStampedMonitorStatus derives the
 * stamp from the binding, not from anything written before, and writes
 * nothing when the row already agrees.
 */
export default class RestampDevicesOfMonitorsNotChecked extends DataMigrationBase {
  public constructor() {
    super("RestampDevicesOfMonitorsNotChecked");
  }

  public override async migrate(): Promise<void> {
    let skip: number = 0;
    let restamped: number = 0;

    /*
     * Paged on a stable id order: a fleet larger than one page would
     * otherwise have its tail skipped. The re-stamp writes the stamp
     * columns only, never monitorId, so no row leaves the query under the
     * walk and the page boundaries stay put.
     */
    while (true) {
      const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
        query: {
          monitorId: QueryHelper.notNull(),
        },
        select: {
          _id: true,
          monitorId: true,
          monitoringMethod: true,
          currentMonitorStatusId: true,
          isReachable: true,
        },
        sort: {
          _id: SortOrder.Ascending,
        },
        skip: skip,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

      const devicesToRestamp: Array<NetworkDevice> =
        await this.getDevicesBoundToMonitorsNotChecked(devices);

      for (const device of devicesToRestamp) {
        try {
          await NetworkDeviceService.refreshStampedMonitorStatus({
            deviceId: device.id!,
            clearWhenNotMonitorBacked: false,
          });
          restamped++;
        } catch (err) {
          /*
           * One unreadable device must not cost the rest of the fleet its
           * repair, nor halt every migration queued behind this one.
           */
          logger.error(
            `Failed to stamp network device ${device.id!.toString()} again, whose monitor is not checked:`,
          );
          logger.error(err);
        }
      }

      if (devices.length < LIMIT_MAX) {
        break;
      }

      skip += devices.length;
    }

    logger.info(
      `RestampDevicesOfMonitorsNotChecked: stamped ${restamped} network device(s) whose monitor is not checked again.`,
    );
  }

  /*
   * The devices of one page that hold a status - or a reachability - from a
   * monitor that is not checked. Monitor-backed only: a probe-polled
   * device's poll decides its health, and its stamp comes from the Network
   * Device monitors that watch its walk, not from monitorId.
   */
  private async getDevicesBoundToMonitorsNotChecked(
    devices: Array<NetworkDevice>,
  ): Promise<Array<NetworkDevice>> {
    const candidates: Array<NetworkDevice> = devices.filter(
      (device: NetworkDevice): boolean => {
        return (
          Boolean(device.id) &&
          Boolean(device.monitorId) &&
          NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
            device.monitoringMethod,
          ) &&
          (Boolean(device.currentMonitorStatusId) ||
            typeof device.isReachable === "boolean")
        );
      },
    );

    if (candidates.length === 0) {
      return [];
    }

    const monitorIds: Array<ObjectID> = Array.from(
      new Map<string, ObjectID>(
        candidates.map((device: NetworkDevice): [string, ObjectID] => {
          return [device.monitorId!.toString(), device.monitorId!];
        }),
      ).values(),
    );

    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: {
        _id: QueryHelper.any(monitorIds),
      },
      select: {
        _id: true,
        ...MONITORED_SELECT,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const notCheckedMonitorIds: Set<string> = new Set<string>(
      monitors
        .filter((monitor: Monitor): boolean => {
          return Boolean(monitor.id) && !MonitoringOff.isMonitored(monitor);
        })
        .map((monitor: Monitor): string => {
          return monitor.id!.toString();
        }),
    );

    return candidates.filter((device: NetworkDevice): boolean => {
      return notCheckedMonitorIds.has(device.monitorId!.toString());
    });
  }

  public override async rollback(): Promise<void> {
    return;
  }
}

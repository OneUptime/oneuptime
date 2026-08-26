import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import { NetworkDeviceMonitoringMethodUtil } from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import logger from "Common/Server/Utils/Logger";

/*
 * Stamps the bound monitor's CURRENT status onto every monitor-backed
 * NetworkDevice that never got one.
 *
 * A monitor-backed device (monitoringMethod "Monitor") is never polled, so
 * `currentMonitorStatusId` is the only thing that can say whether it is up —
 * the device list pill, the site rollup and the topology node all read it.
 * Until NetworkDeviceService.refreshStampedMonitorStatus existed, the ONLY
 * writer of that column was NetworkSiteService.onMonitorStatusChanged, which
 * fires on a monitor's next status CHANGE. Bind a device to a Ping monitor
 * that is already Up and stays Up and nothing ever writes it, so the device
 * reads "Pending" indefinitely — OneUptime/oneuptime#3392.
 *
 * The service fix stamps at bind time, which repairs every future binding
 * but not the ones already saved: those devices are waiting on a status
 * change that may be weeks away, on a healthy network may never come, and
 * would in any case mean the operator only learns the device exists at the
 * moment it breaks. This walks them once on upgrade.
 *
 * Idempotent, and safe to run twice CONCURRENTLY as this runner requires
 * (see Workers/Utils/DataMigration.ts): refreshStampedMonitorStatus derives
 * the stamp from the binding rather than from anything it just wrote, and
 * writes nothing when it already agrees. Two runners racing therefore
 * compute the same value, and the loser writes what the winner already
 * wrote. A device whose monitor has since moved on is simply brought up to
 * date.
 */
export default class BackfillMonitorBackedDeviceStatus extends DataMigrationBase {
  public constructor() {
    super("BackfillMonitorBackedDeviceStatus");
  }

  public override async migrate(): Promise<void> {
    /*
     * Only devices that actually point at a monitor. A monitor-backed
     * device with nothing bound has no status to adopt (discovery import
     * creates them that way on purpose) and "Pending" is the true answer
     * for it, so it is left alone rather than walked.
     */
    const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
      query: {
        monitorId: QueryHelper.notNull(),
      },
      select: {
        _id: true,
        monitoringMethod: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const device of devices) {
      if (!device.id) {
        continue;
      }

      /*
       * Filtered here rather than in the query because monitoringMethod is
       * free text: NULL, "" and anything unrecognised all read as SNMP (see
       * NetworkDeviceMonitoringMethodUtil.parse), and an SNMP device's
       * stamp comes from the Network Device monitor watching it — which is
       * not this column, and must not be rewritten from it.
       */
      if (
        !NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
          device.monitoringMethod,
        )
      ) {
        continue;
      }

      try {
        await NetworkDeviceService.refreshStampedMonitorStatus({
          deviceId: device.id,
          clearWhenNotMonitorBacked: false,
        });
      } catch (err) {
        /*
         * One unreadable device must not cost the rest of the fleet its
         * status, nor halt every migration queued behind this one.
         */
        logger.error(
          `Failed to backfill the monitor status of network device ${device.id.toString()}:`,
        );
        logger.error(err);
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}

import DataMigrationBase from "./DataMigrationBase";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import logger from "Common/Server/Utils/Logger";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import { NetworkDeviceMonitoringMethodUtil } from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";

/*
 * Brings every monitor-backed NetworkDevice's `isReachable` in line with its
 * bound monitor, and clears the poll residue such a device may still carry.
 *
 * The device list's summary tiles and its Status facet count and filter in
 * SQL over `isReachable` alone — they cannot walk the stamped MonitorStatus
 * ladder per row — so a monitor-backed device (monitoringMethod "Monitor",
 * which nothing polls) counted as "Pending" there forever, even while its
 * pill, reading the stamp, said Up. NetworkDeviceService now keeps
 * `isReachable` on such a device in sync with the monitor (`!isOfflineState`,
 * NULL when nothing is bound) on every binding and status change. That
 * repairs every device from now on; this repairs the ones already saved.
 *
 * The same walk clears the poll columns on those rows. A device switched over
 * from SNMP kept the last thing its probe found — lastSeenAt, lastPolledAt,
 * the interface counts — and those keep describing a device nothing polls:
 * DeviceReachabilityUtil's legacy branch judges a row with lastSeenAt and no
 * isReachable by freshness, and the network summary's "degraded" query is
 * `isReachable = true AND interfacesDown > 0`. The transition itself clears
 * them from now on (NetworkDeviceService.onUpdateSuccess); this clears the
 * ones that transitioned before it did.
 *
 * Every monitor-backed device is walked, bound or not: an unbound one must
 * land on isReachable NULL too (its true "Pending"), and its residue is no
 * less stale for having nothing bound. That is the one place this differs
 * from BackfillMonitorBackedDeviceStatus, which it is otherwise modelled on.
 *
 * Idempotent, and safe to run twice CONCURRENTLY as this runner requires
 * (see Workers/Utils/DataMigration.ts): the residue reset writes NULLs that
 * a second runner would write identically, and refreshStampedMonitorStatus
 * derives the stamp and isReachable from the binding rather than from
 * anything it just wrote, and writes nothing when the row already agrees.
 */
export default class BackfillMonitorBackedDeviceReachability extends DataMigrationBase {
  public constructor() {
    super("BackfillMonitorBackedDeviceReachability");
  }

  public override async migrate(): Promise<void> {
    let skip: number = 0;

    /*
     * Paged on a stable id order rather than read once at LIMIT_MAX: a fleet
     * larger than one page would otherwise have its tail silently skipped.
     * Nothing here deletes or re-orders rows, so the page boundaries stay
     * put under the walk.
     *
     * The whole fleet, not `monitoringMethod = 'Monitor'`: the column is
     * free text with no write-side normalisation, and a SQL equality on the
     * enum value would skip a row stored as "monitor" that every runtime
     * reader (they all go through NetworkDeviceMonitoringMethodUtil.parse)
     * treats as monitor-backed. The parse below is the contract, the same
     * way the sibling BackfillMonitorBackedDeviceStatus filters.
     */
    while (true) {
      const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
        query: {},
        select: {
          _id: true,
          monitoringMethod: true,
          lastSeenAt: true,
          lastPolledAt: true,
          isReachable: true,
          interfacesUp: true,
          interfacesDown: true,
        },
        sort: { _id: SortOrder.Ascending },
        skip,
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
         * free text: the parse is the contract (NULL, "" and anything
         * unrecognised read as SNMP; case and whitespace variants read as
         * Monitor). An SNMP device's isReachable belongs to its walk and
         * must never be rewritten from a monitor binding.
         */
        if (
          !NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
            device.monitoringMethod,
          )
        ) {
          continue;
        }

        try {
          /*
           * Residue first, only when there is some — most monitor-backed
           * devices were created that way and have nothing to clear.
           * `isReachable` is deliberately not in this write: the re-stamp
           * below owns it, and derives it from the monitor.
           */
          if (hasPollResidue(device)) {
            await NetworkDeviceService.updateColumnsByIdWithoutHooks({
              id: device.id,
              data: {
                lastSeenAt: null,
                lastPolledAt: null,
                interfacesUp: null,
                interfacesDown: null,
              },
            });
          }

          /*
           * Derives the stamp AND isReachable from the monitor's CURRENT
           * status, or NULLs both when nothing is bound. Never asked to
           * clear: every row here is monitor-backed, and the flag is for
           * the write that moves a device off it.
           */
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
            `Failed to backfill the reachability of network device ${device.id.toString()}:`,
          );
          logger.error(err);
        }
      }

      if (devices.length < LIMIT_MAX) {
        break;
      }

      skip += devices.length;
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}

/*
 * True when the row still carries anything a poll wrote. Zero counts: an
 * `interfacesDown` of 0 is a finding, not an absence, and only NULL means
 * "nothing polls this".
 */
function hasPollResidue(device: NetworkDevice): boolean {
  return [
    device.lastSeenAt,
    device.lastPolledAt,
    device.interfacesUp,
    device.interfacesDown,
  ].some((value: unknown) => {
    return value !== null && value !== undefined;
  });
}

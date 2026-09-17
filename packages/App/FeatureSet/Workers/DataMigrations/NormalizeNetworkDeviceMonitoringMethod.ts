import DataMigrationBase from "./DataMigrationBase";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import logger from "Common/Server/Utils/Logger";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import NetworkDeviceMonitoringMethod, {
  NetworkDeviceMonitoringMethodUtil,
} from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";

/*
 * Makes every NetworkDevice's `monitoringMethod` column SAY what it means.
 *
 * Ping-first polling renamed the probe-polled method from "SNMP" to "Probe":
 * the assigned probe pings every device it is given and walks it over SNMP
 * only when credentials exist, so "SNMP" stopped describing what happens.
 * Rows written before that hold "SNMP", NULL (from before the column
 * existed), "" or the odd free-text variant, and every runtime reader
 * already goes through NetworkDeviceMonitoringMethodUtil.parse, which reads
 * all of them as Probe — so nothing misbehaves on the old rows. What is
 * wrong is the column itself: the raw SQL that filters on it
 * (claimDevicesForPolling's `<> 'Monitor'`, the device facets) has to keep
 * carrying the NULL-and-legacy special cases for as long as the rows do, and
 * anyone reading the table sees a method the product no longer has.
 *
 * So: rows that parse as Probe but are not spelled "Probe" become "Probe";
 * rows that parse as Monitor but are not spelled "Monitor" ("monitor",
 * "  MONITOR ") become "Monitor". Canonical rows are never written.
 *
 * What this deliberately does NOT do is turn a monitor-backed device into a
 * Probe one. A monitor-backed device never had its probeId set, so switched
 * blindly it would sit "Pending" with nothing to poll it; the Devices page
 * offers a "Switch to probe polling" bulk action that asks for the probe
 * instead, and the service restores polling on that transition.
 *
 * The parse is the contract, not a SQL predicate: the column is free text
 * and the same util decides the method everywhere else, so a row this
 * migration rewrites is exactly a row the runtime already read that way.
 *
 * Idempotent, and safe to run twice CONCURRENTLY as this runner requires
 * (see Workers/Utils/DataMigration.ts): a second pass finds the canonical
 * spelling and writes nothing, and two passes writing the same value to the
 * same row cannot disagree. Written as a root column write without hooks so
 * the spelling change is never mistaken for a method TRANSITION by
 * NetworkDeviceService.onUpdateSuccess — the device's method is not
 * changing, only how the row spells it.
 */
export default class NormalizeNetworkDeviceMonitoringMethod extends DataMigrationBase {
  public constructor() {
    super("NormalizeNetworkDeviceMonitoringMethod");
  }

  public override async migrate(): Promise<void> {
    let skip: number = 0;

    /*
     * Paged on a stable id order rather than read once at LIMIT_MAX: a fleet
     * larger than one page would otherwise have its tail silently skipped.
     * The write never moves a row within that order, so the page boundaries
     * stay put under the walk.
     */
    while (true) {
      const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
        query: {},
        select: {
          _id: true,
          monitoringMethod: true,
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

        const canonicalMethod: NetworkDeviceMonitoringMethod =
          NetworkDeviceMonitoringMethodUtil.parse(device.monitoringMethod);

        // A NULL column reads back as undefined; neither is the canonical spelling.
        if (device.monitoringMethod === canonicalMethod) {
          continue;
        }

        try {
          await NetworkDeviceService.updateColumnsByIdWithoutHooks({
            id: device.id,
            data: {
              monitoringMethod: canonicalMethod,
            },
          });
        } catch (err) {
          /*
           * One unwritable device must not cost the rest of the fleet its
           * spelling, nor halt every migration queued behind this one — the
           * runtime reads the old value correctly either way.
           */
          logger.error(
            `Failed to normalise the monitoring method of network device ${device.id.toString()}:`,
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

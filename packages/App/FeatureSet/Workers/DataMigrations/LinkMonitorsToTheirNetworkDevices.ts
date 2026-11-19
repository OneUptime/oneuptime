import DataMigrationBase from "./DataMigrationBase";
import MonitorDeviceLinkBackfill, {
  MonitorDeviceLinkBackfillResult,
} from "Common/Server/Utils/NetworkDevice/MonitorDeviceLinkBackfill";
import logger from "Common/Server/Utils/Logger";

/*
 * Ties the Ping, IP, Port, NTP, Website, API and SSL Certificate monitors
 * people made before issue #9545 to the network device they check
 * (Monitor.networkDeviceId), by the rule a monitor created today is tied by:
 * every step checks one host, and exactly one device in the project is at
 * that host. A host two devices share ties nothing, nor does a monitor an
 * import made for a device, or one already tied. See
 * MonitorDeviceLinkBackfill, which holds the rule and its reasons.
 *
 * Without it, the duplicate check imports and auto import rules run would
 * still not see those monitors, and the devices' pages would not list them,
 * until someone tied each one by hand.
 *
 * Postgres only. Safe to run twice at once: each write sets the tie the rule
 * reads from the rows as they are, and a monitor tied meanwhile is not read
 * again. One project that cannot be read or written is logged and skipped,
 * and its monitors stay untied, as they were.
 */
export default class LinkMonitorsToTheirNetworkDevices extends DataMigrationBase {
  public constructor() {
    super("LinkMonitorsToTheirNetworkDevices");
  }

  public override async migrate(): Promise<void> {
    const result: MonitorDeviceLinkBackfillResult =
      await MonitorDeviceLinkBackfill.run();

    logger.info(
      `LinkMonitorsToTheirNetworkDevices: read ${result.monitorsRead} monitor(s) in ${result.projects} project(s) with network devices, and tied ${result.monitorsTied} to the one device at the address each checks.`,
    );
  }

  public override async rollback(): Promise<void> {
    // The column goes with the schema migration's down(); nothing to undo here.
    return;
  }
}

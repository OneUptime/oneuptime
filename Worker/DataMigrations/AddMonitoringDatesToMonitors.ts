import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import MonitorProbeService from "Common/Server/Services/MonitorProbeService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import MonitorProbe from "Common/Models/DatabaseModels/MonitorProbe";

export default class AddMonitoringDatesToMonitor extends DataMigrationBase {
  public constructor() {
    super("AddMonitoringDatesToMonitor");
  }

  public override async migrate(): Promise<void> {
    // Find all monitor probes where nextPingAt is null
    let probeMonitors: Array<MonitorProbe> = await MonitorProbeService.findBy({
      query: {
        nextPingAt: QueryHelper.isNull(),
      },
      select: {
        _id: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    // Update each monitor probe to set nextPingAt to the current date
    for (const probeMonitor of probeMonitors) {
      await MonitorProbeService.updateOneById({
        id: probeMonitor.id!,
        data: {
          nextPingAt: OneUptimeDate.getCurrentDate(),
        },
        props: {
          isRoot: true,
        },
      });
    }

    // Find all monitor probes where lastPingAt is null
    probeMonitors = await MonitorProbeService.findBy({
      query: {
        lastPingAt: QueryHelper.isNull(),
      },
      select: {
        _id: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    // Update each monitor probe to set lastPingAt to the current date
    for (const probeMonitor of probeMonitors) {
      await MonitorProbeService.updateOneById({
        id: probeMonitor.id!,
        data: {
          lastPingAt: OneUptimeDate.getCurrentDate(),
        },
        props: {
          isRoot: true,
        },
      });
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}

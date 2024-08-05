import OneUptimeDate from "Common/Types/Date";
import RunCron from "../../Utils/Cron";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import MonitorService from "CommonServer/Services/MonitorService";
import QueryHelper from "CommonServer/Types/Database/QueryHelper";
import logger from "CommonServer/Utils/Logger";
import MonitorResourceUtil from "CommonServer/Utils/Monitor/MonitorResource";
import Monitor from "Common/AppModels/Models/Monitor";
import CronTab from "CommonServer/Utils/CronTab";

RunCron(
  "LogMonitor:MonitorLogMonitor",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    logger.debug("Checking LogMonitor:MonitorLogMonitor");

    const telemetryMonitors: Array<Monitor> = await MonitorService.findBy({
      query: {
        monitorType: QueryHelper.any([
          MonitorType.Logs,
          MonitorType.Traces,
          MonitorType.Metrics,
        ]),
        telemetryMonitorNextMonitorAt: QueryHelper.lessThanEqualToOrNull(
          OneUptimeDate.getCurrentDate(),
        ),
      },
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        monitorSteps: true,
        createdAt: true,
        monitoringInterval: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
    });

    const updatePromises: Array<Promise<void>> = [];

    for (const telemetryMonitor of telemetryMonitors) {
      if (!telemetryMonitor.monitoringInterval) {
        continue;
      }

      let nextPing: Date = OneUptimeDate.addRemoveMinutes(
        OneUptimeDate.getCurrentDate(),
        1,
      );

      try {
        nextPing = CronTab.getNextExecutionTime(
          telemetryMonitor?.monitoringInterval as string,
        );
      } catch (err) {
        logger.error(err);
      }

      updatePromises.push(
        MonitorService.updateOneById({
          id: telemetryMonitor.id!,
          data: {
            telemetryMonitorLastMonitorAt: OneUptimeDate.getCurrentDate(),
            telemetryMonitorNextMonitorAt: nextPing,
          },
          props: {
            isRoot: true,
          },
        }),
      );
    }

    await Promise.all(updatePromises);

    logger.debug(`Found ${telemetryMonitors.length} telemetry monitors`);

    logger.debug(telemetryMonitors);

    for (const monitor of telemetryMonitors) {
      try {
        if (!monitor.monitorSteps) {
          logger.debug("Monitor has no steps. Skipping...");
          continue;
        }

        const incomingRequest: IncomingMonitorRequest = {
          monitorId: monitor.id!,
          requestHeaders: undefined,
          requestBody: undefined,
          requestMethod: undefined,
          incomingRequestReceivedAt:
            monitor.incomingRequestReceivedAt || monitor.createdAt!,
          onlyCheckForIncomingRequestReceivedAt: true,
        };

        await MonitorResourceUtil.monitorResource(incomingRequest);
      } catch (error) {
        logger.error(
          `Error while processing incoming request monitor: ${monitor.id?.toString()}`,
        );
        logger.error(error);
      }
    }
  },
);

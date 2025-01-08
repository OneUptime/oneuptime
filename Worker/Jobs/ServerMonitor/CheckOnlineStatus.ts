import RunCron from "../../Utils/Cron";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import { CheckOn } from "Common/Types/Monitor/CriteriaFilter";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ServerMonitorResponse from "Common/Types/Monitor/ServerMonitor/ServerMonitorResponse";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import MonitorService from "Common/Server/Services/MonitorService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import Monitor from "Common/Models/DatabaseModels/Monitor";

RunCron(
  "ServerMonitor:CheckOnlineStatus",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    try {
      const threeMinsAgo: Date = OneUptimeDate.getSomeMinutesAgo(2);

      const serverMonitors: Array<Monitor> = await MonitorService.findBy({
        query: {
          monitorType: MonitorType.Server,
          serverMonitorRequestReceivedAt:
            QueryHelper.lessThanEqualToOrNull(threeMinsAgo),
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          monitorSteps: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
      });

      for (const monitor of serverMonitors) {
        try {
          if (!monitor.monitorSteps) {
            continue;
          }

          const serverMonitor: Monitor | null = await MonitorService.findOneBy({
            query: {
              _id: monitor.id!,
              serverMonitorRequestReceivedAt:
                QueryHelper.lessThanEqualToOrNull(threeMinsAgo),
            },
            props: {
              isRoot: true,
            },
            select: {
              _id: true,
              monitorSteps: true,
              serverMonitorRequestReceivedAt: true,
              createdAt: true,
              serverMonitorResponse: true,
            },
          });

          if (!serverMonitor) {
            // server monitor may have receievd a response in the last 2 minutes
            continue;
          }

          const processRequest: boolean = shouldProcessRequest(serverMonitor);

          if (!processRequest) {
            continue;
          }

          const serverMonitorResponse: ServerMonitorResponse = {
            monitorId: serverMonitor.id!,
            onlyCheckRequestReceivedAt: true,
            requestReceivedAt:
              serverMonitor.serverMonitorRequestReceivedAt ||
              serverMonitor.serverMonitorResponse?.requestReceivedAt ||
              serverMonitor.createdAt!,
            hostname: serverMonitor.serverMonitorResponse?.hostname || "",
          };

          await MonitorResourceUtil.monitorResource(serverMonitorResponse);
        } catch (error) {
          logger.error(
            `Error in ServerMonitor:CheckOnlineStatus for monitorId: ${monitor.id}`,
          );
          logger.error(error);
        }
      }
    } catch (error) {
      logger.error("Error in ServerMonitor:CheckOnlineStatus");
      logger.error(error);
    }
  },
);

type ShouldProcessRequestFunction = (monitor: Monitor) => boolean;

const shouldProcessRequest: ShouldProcessRequestFunction = (
  monitor: Monitor,
): boolean => {
  // check if any criteria has Is Online step. If yes, then process the request. If no then skip the request.

  let shouldWeProcessRequest: boolean = false;

  for (const steps of monitor.monitorSteps?.data?.monitorStepsInstanceArray ||
    []) {
    if (steps.data?.monitorCriteria.data?.monitorCriteriaInstanceArray) {
      for (const criteria of steps.data?.monitorCriteria.data
        ?.monitorCriteriaInstanceArray || []) {
        for (const filters of criteria.data?.filters || []) {
          if (filters.checkOn === CheckOn.IsOnline) {
            shouldWeProcessRequest = true;
            break;
          }
        }

        if (shouldWeProcessRequest) {
          break;
        }
      }
    }

    if (shouldWeProcessRequest) {
      break;
    }
  }

  return shouldWeProcessRequest;
};

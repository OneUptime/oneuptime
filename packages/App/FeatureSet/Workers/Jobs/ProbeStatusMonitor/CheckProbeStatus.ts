import RunCron from "../../Utils/Cron";
import runMonitorSweep from "../../Utils/MonitorSweep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import MonitorService from "Common/Server/Services/MonitorService";
import ProjectService from "Common/Server/Services/ProjectService";
import logger from "Common/Server/Utils/Logger";
import ProbeStatusMonitorEvaluator from "Common/Server/Utils/Monitor/ProbeStatusMonitorEvaluator";
import Monitor from "Common/Models/DatabaseModels/Monitor";

/*
 * Evaluates every Probe Status monitor once a minute, from the connection
 * status Probe:UpdateConnectionStatus keeps (every minute too). A probe's
 * flip already evaluates the monitors watching it as it happens
 * (ProbeService.onUpdateSuccess); this sweep is what makes the monitor right
 * whatever happened in between: a monitor just created or edited, a probe
 * deleted, an evaluation that failed, a flip from no status at all.
 *
 * Unchanged evaluations change nothing: the monitor keeps its status and its
 * open incident, so a probe that stays down is one incident, not one a
 * minute.
 */
RunCron(
  "ProbeStatusMonitor:CheckProbeStatus",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    logger.debug("Checking ProbeStatusMonitor:CheckProbeStatus", {
      service: "workers",
    });

    await runMonitorSweep({
      jobName: "ProbeStatusMonitor:CheckProbeStatus",
      queries: [
        {
          ...MonitorService.getEnabledMonitorQuery(),
          monitorType: MonitorType.ProbeStatus,
          project: { ...ProjectService.getActiveProjectStatusQuery() },
        },
      ],
      select: ProbeStatusMonitorEvaluator.MONITOR_SELECT,
      processMonitor: async (monitor: Monitor): Promise<void> => {
        await ProbeStatusMonitorEvaluator.evaluateMonitor(monitor);
      },
    });
  },
);

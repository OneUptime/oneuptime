import RunCron from "../../Utils/Cron";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import MonitorMetricsByMinuteService from "Common/Server/Services/MonitorMetricsByMinuteService";

// Schedule a cron job to run every minute
RunCron(
  "MonitorMetrics:HardDeleteMonitorMetricsByMinute",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // Calculate the timestamp for one hour ago
    const oneHourAgo: Date = OneUptimeDate.getSomeMinutesAgo(60);

    // Delete all monitor metrics older than one hour
    await MonitorMetricsByMinuteService.deleteBy({
      query: {
        createdAt: new LessThan(oneHourAgo),
      },
      props: {
        isRoot: true,
      },
    });
  },
);

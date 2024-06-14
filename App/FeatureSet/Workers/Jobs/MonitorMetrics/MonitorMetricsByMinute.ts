import RunCron from "../../Utils/Cron";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import MonitorMetricsByMinuteService from "CommonServer/Services/MonitorMetricsByMinuteService";

RunCron(
  "MonitorMetrics:HardDeleteMonitorMetricsByMinute",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
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

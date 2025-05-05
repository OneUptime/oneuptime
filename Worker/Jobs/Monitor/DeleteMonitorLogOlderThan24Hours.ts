import OneUptimeDate from "Common/Types/Date";
import RunCron from "../../Utils/Cron";
import { EVERY_DAY } from "Common/Utils/CronTime";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import MonitorLogService from "Common/Server/Services/MonitorLogService";

RunCron(
  "Monitor:DeleteMonitorLogOlderThan24Hours",
  { schedule: EVERY_DAY, runOnStartup: true },
  async () => {
    const olderThanDays: number = 1; // store for 1 day.
    await MonitorLogService.deleteBy({
      query: {
        time: new LessThan(OneUptimeDate.getSomeDaysAgo(olderThanDays)),
      },
      props: {
        isRoot: true,
      },
    });
  },
);

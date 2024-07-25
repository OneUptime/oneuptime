import RunCron from "../../Utils/Cron";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import Recurring from "Common/Types/Events/Recurring";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import StatusPageService from "CommonServer/Services/StatusPageService";
import QueryHelper from "CommonServer/Types/Database/QueryHelper";
import StatusPage from "Model/Models/StatusPage";

RunCron(
  "StatusPage:SendReportToSubscribers",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // get all scheduled events of all the projects.
    const statusPageToSendReports: Array<StatusPage> =
      await StatusPageService.findBy({
        query: {
          isReportEnabled: true,
          sendNextReportBy: QueryHelper.greaterThan(
            OneUptimeDate.getCurrentDate(),
          ),
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        select: {
          _id: true,
          sendNextReportBy: true,
          reportRecurringInterval: true,
        },
      });

    for (const statusPageToSendReport of statusPageToSendReports) {
      const nextReportBy: Date = Recurring.getNextDate(
        statusPageToSendReport.sendNextReportBy!,
        statusPageToSendReport.reportRecurringInterval!,
      );

      // updte this date in the status page

      await StatusPageService.updateOneById({
        id: statusPageToSendReport.id!,
        data: {
          sendNextReportBy: nextReportBy,
        },
        props: {
          isRoot: true,
        },
      });

      await StatusPageService.sendEmailReport({
        statusPageId: statusPageToSendReport.id!,
      });
    }
  },
);

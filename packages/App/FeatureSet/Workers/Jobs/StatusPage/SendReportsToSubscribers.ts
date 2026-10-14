import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import Recurring from "Common/Types/Events/Recurring";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import StatusPageService from "Common/Server/Services/StatusPageService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";
import BlockedProjectStatusPages from "Common/Server/Utils/StatusPage/BlockedProjectStatusPages";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageReportPeriodUtil from "Common/Utils/StatusPage/ReportPeriod";

RunCron(
  "StatusPage:SendReportToSubscribers",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    // get all scheduled events of all the projects.
    const statusPagesWithReportDue: Array<StatusPage> =
      await StatusPageService.findAllBy({
        query: {
          isReportEnabled: true,
          // An archived page sends nothing; its next report goes out once it is unarchived.
          isArchived: false,
          sendNextReportBy: QueryHelper.lessThan(
            OneUptimeDate.getCurrentDate(),
          ),
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          projectId: true,
          sendNextReportBy: true,
          reportRecurringInterval: true,
          reportTimezone: true,
        },
      });

    /*
     * Nor does a page of a blocked project, and it is left as an archived
     * one is: its next report goes out once the project is unblocked. Moving
     * its report on would only fail the send every period, since
     * sendEmailReport finds no page to send from.
     */
    const statusPageToSendReports: Array<StatusPage> =
      await BlockedProjectStatusPages.leaveOutStatusPagesOfBlockedProjects(
        statusPagesWithReportDue,
      );

    for (const statusPageToSendReport of statusPageToSendReports) {
      /*
       * Calendar-correct so a monthly schedule keeps landing on the same day of
       * the month. The old fixed-millisecond arithmetic treated a month as
       * 30.4375 days, so a report anchored to the 1st drifted to the 31st, then
       * the 30th, and eventually skipped a month entirely.
       */
      const nextReportBy: Date = Recurring.getNextDateAfter({
        startDate: statusPageToSendReport.sendNextReportBy!,
        recurring: statusPageToSendReport.reportRecurringInterval!,
        afterDate: OneUptimeDate.getCurrentDate(),
        timezone:
          statusPageToSendReport.reportTimezone ||
          StatusPageReportPeriodUtil.DEFAULT_TIMEZONE,
      });

      // update this date in the status page

      await StatusPageService.updateOneById({
        id: statusPageToSendReport.id!,
        data: {
          sendNextReportBy: nextReportBy,
        },
        props: {
          isRoot: true,
        },
      });

      try {
        await StatusPageService.sendEmailReport({
          statusPageId: statusPageToSendReport.id!,
        });
      } catch (err) {
        logger.error("Error sending report to subscribers", {
          service: "workers",
        });
        logger.error(err, { service: "workers" });
      }
    }
  },
);

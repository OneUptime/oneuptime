import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import Recurring from "Common/Types/Events/Recurring";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import WorkspaceNotificationSummaryService from "Common/Server/Services/WorkspaceNotificationSummaryService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";
import WorkspaceNotificationSummary from "Common/Models/DatabaseModels/WorkspaceNotificationSummary";

RunCron(
  "WorkspaceNotificationSummary:SendSummary",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    const summariesToSend: Array<WorkspaceNotificationSummary> =
      await WorkspaceNotificationSummaryService.findAllBy({
        query: {
          isEnabled: true,
          nextSendAt: QueryHelper.lessThan(OneUptimeDate.getCurrentDate()),
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          nextSendAt: true,
          recurringInterval: true,
        },
      });

    for (const summary of summariesToSend) {
      try {
        // Update nextSendAt first to prevent double-sends
        const nextSendAt: Date = Recurring.getNextDate(
          summary.nextSendAt!,
          summary.recurringInterval!,
        );

        await WorkspaceNotificationSummaryService.updateOneById({
          id: summary.id!,
          data: {
            nextSendAt: nextSendAt,
          },
          props: {
            isRoot: true,
          },
        });

        await WorkspaceNotificationSummaryService.sendSummary({
          summaryId: summary.id!,
        });

        logger.debug(
          `WorkspaceNotificationSummary:SendSummary: Sent summary ${summary.id?.toString()}`,
        );
      } catch (err) {
        logger.error(
          `WorkspaceNotificationSummary:SendSummary: Error sending summary ${summary.id?.toString()}`,
        );
        logger.error(err);
      }
    }
  },
);

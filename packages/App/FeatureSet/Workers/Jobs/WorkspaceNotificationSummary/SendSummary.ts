import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import WorkspaceSummaryScheduleUtil from "Common/Utils/Workspace/WorkspaceSummarySchedule";
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
        /*
         * The schedule's first occurrence after now, counted from the send
         * that was due (WorkspaceSummaryScheduleUtil) - one interval on,
         * normally. Moving on by one interval from a send long past (a
         * worker that was down) left it in the past, and the summary went
         * out once a minute until it caught up.
         */
        const nextSendAt: Date =
          WorkspaceSummaryScheduleUtil.getNextSendAfterDue({
            dueAt: summary.nextSendAt!,
            recurringInterval: summary.recurringInterval!,
            now: OneUptimeDate.getCurrentDate(),
          });

        // Update nextSendAt first to prevent double-sends
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

        // Roll back nextSendAt so it will be retried on the next cron run
        try {
          await WorkspaceNotificationSummaryService.updateOneById({
            id: summary.id!,
            data: {
              nextSendAt: summary.nextSendAt!,
            },
            props: {
              isRoot: true,
            },
          });

          logger.debug(
            `WorkspaceNotificationSummary:SendSummary: Rolled back nextSendAt for summary ${summary.id?.toString()} — will retry on next cron run`,
          );
        } catch (rollbackErr) {
          logger.error(
            `WorkspaceNotificationSummary:SendSummary: Failed to roll back nextSendAt for summary ${summary.id?.toString()}`,
          );
          logger.error(rollbackErr);
        }
      }
    }
  },
);

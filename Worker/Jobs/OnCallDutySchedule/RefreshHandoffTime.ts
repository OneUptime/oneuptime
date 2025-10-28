import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleService from "Common/Server/Services/OnCallDutyPolicyScheduleService";

RunCron(
  "OnCallDutySchedule:RefreshHandoffTime",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    logger.debug("Starting cron job: OnCallDutySchedule:RefreshHandoffTime");

    const onCallScheduleWithHandoffTimeInPast: Array<OnCallDutyPolicySchedule> =
      await OnCallDutyPolicyScheduleService.findAllBy({
        query: {
          rosterHandoffAt: QueryHelper.lessThanEqualTo(
            OneUptimeDate.getCurrentDate(),
          ),
        },
        select: {
          _id: true,
          name: true,
          currentUserIdOnRoster: true,
          rosterStartAt: true,
          rosterHandoffAt: true,
          rosterNextStartAt: true,
          rosterNextHandoffAt: true,
          nextUserIdOnRoster: true,
        },
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    logger.debug(
      `Fetched ${onCallScheduleWithHandoffTimeInPast.length} schedules with handoff time in the past.`,
    );

    const nextRosterStartTimeInPastSchedules: Array<OnCallDutyPolicySchedule> =
      await OnCallDutyPolicyScheduleService.findAllBy({
        query: {
          rosterNextStartAt: QueryHelper.lessThanEqualTo(
            OneUptimeDate.getCurrentDate(),
          ),
          rosterHandoffAt: QueryHelper.isNull(),
        },
        select: {
          _id: true,
          name: true,
          currentUserIdOnRoster: true,
          rosterStartAt: true,
          rosterHandoffAt: true,
          rosterNextStartAt: true,
          rosterNextHandoffAt: true,
          nextUserIdOnRoster: true,
        },
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    logger.debug(
      `Fetched ${nextRosterStartTimeInPastSchedules.length} schedules with next roster start time in the past.`,
    );

    const totalSchedules: Array<OnCallDutyPolicySchedule> = [
      ...onCallScheduleWithHandoffTimeInPast,
      ...nextRosterStartTimeInPastSchedules,
    ];

    logger.debug(`Total schedules to process: ${totalSchedules.length}`);

    for (const onCallSchedule of totalSchedules) {
      try {
        logger.debug(
          `Processing schedule with ID: ${onCallSchedule.id?.toString()}`,
        );
        await OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule(
          onCallSchedule.id!,
        );
        logger.debug(
          `Successfully refreshed schedule with ID: ${onCallSchedule.id?.toString()}`,
        );
      } catch (err) {
        logger.error(
          `Error refreshing current user and handoff time for schedule: ${onCallSchedule.id?.toString()}`,
        );
        logger.error(err);
      }
    }

    logger.debug("Completed cron job: OnCallDutySchedule:RefreshHandoffTime");
  },
);

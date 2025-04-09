import RunCron from "../../Utils/Cron";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
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
    const onCallScheduleWithHandoffTimeInPast: Array<OnCallDutyPolicySchedule> =
      await OnCallDutyPolicyScheduleService.findBy({
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
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

    const nextRosterStartTimeInPastSchedules: Array<OnCallDutyPolicySchedule> =
      await OnCallDutyPolicyScheduleService.findBy({
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
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

    const totalSchedules: Array<OnCallDutyPolicySchedule> = [
      ...onCallScheduleWithHandoffTimeInPast,
      ...nextRosterStartTimeInPastSchedules,
    ];

    for (const onCallSchedule of totalSchedules) {
      try {
        await OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule(
          onCallSchedule.id!,
        );
      } catch (err) {
        logger.error(
          `Error refreshing current user and handoff time for schedule: ${onCallSchedule.id}`,
        );
      }
    }
  },
);

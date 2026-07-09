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

    /*
     * Schedules whose roster resolved to all-null (no events within the
     * resolution window — e.g. a layer that starts more than the window into
     * the future, or a schedule created before any on-call event) can never be
     * re-selected by the two predicates above, because SQL `NULL <= x` is
     * UNKNOWN. Without this third predicate they would stay stuck with no
     * on-call user forever (no handoff notification, time-log, or dashboard
     * roster) even once their start date arrives. Re-refreshing them is cheap:
     * schedules with no layers return early, and once a roster is established
     * currentUserIdOnRoster becomes non-null and they drop out of this set.
     */
    const schedulesWithNoRoster: Array<OnCallDutyPolicySchedule> =
      await OnCallDutyPolicyScheduleService.findAllBy({
        query: {
          currentUserIdOnRoster: QueryHelper.isNull(),
          rosterHandoffAt: QueryHelper.isNull(),
          rosterNextStartAt: QueryHelper.isNull(),
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
      `Fetched ${schedulesWithNoRoster.length} schedules with no resolved roster.`,
    );

    const combinedSchedules: Array<OnCallDutyPolicySchedule> = [
      ...onCallScheduleWithHandoffTimeInPast,
      ...nextRosterStartTimeInPastSchedules,
      ...schedulesWithNoRoster,
    ];

    /*
     * Dedup by id: a single schedule can satisfy more than one of the three
     * predicate sets above, so the concatenation can list it multiple times.
     * Refreshing the same schedule twice in one tick re-diffs its roster and
     * could emit duplicate handoff notifications and duplicate on-call
     * time-log rows. Process each schedule at most once per tick.
     */
    const seenScheduleIds: Set<string> = new Set<string>();
    const totalSchedules: Array<OnCallDutyPolicySchedule> = [];
    for (const schedule of combinedSchedules) {
      const scheduleId: string | undefined = schedule.id?.toString();
      if (!scheduleId || seenScheduleIds.has(scheduleId)) {
        continue;
      }
      seenScheduleIds.add(scheduleId);
      totalSchedules.push(schedule);
    }

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

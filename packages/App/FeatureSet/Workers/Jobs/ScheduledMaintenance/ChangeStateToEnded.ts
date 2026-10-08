import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "Common/Server/Services/ScheduledMaintenanceStateService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Query from "Common/Server/Types/Database/Query";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";

/*
 * Ends every event in progress whose end time has passed: moves it into its
 * project's ended state. In progress is the one rule
 * (Common/Utils/ScheduledMaintenanceStart): in the project's ongoing state,
 * or in a state of the project's own placed between Ongoing and Ended, such
 * as "Verifying" - an event moved on to one of those is ended at its end
 * time as much as one left ongoing. The state service names the states to
 * ask for (getInProgressEventQueriesOfEveryProject).
 *
 * The move does the rest, as any end does
 * (ScheduledMaintenanceStateTimelineService): it puts the monitors the event
 * holds back to operational and probes them again, reading them as they are
 * stored at that moment. So the job reads only what the move needs - not
 * the event's monitors, nor the status it changed them to.
 */
RunCron(
  "ScheduledMaintenance:ChangeStateToEnded",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const inProgressQueries: Array<Query<ScheduledMaintenance>> =
      await ScheduledMaintenanceStateService.getInProgressEventQueriesOfEveryProject();

    const now: Date = OneUptimeDate.getCurrentDate();

    // Every event in progress past its end, of every project, once each.
    const events: Array<ScheduledMaintenance> = [];
    const eventIdsRead: Set<string> = new Set<string>();

    for (const inProgressQuery of inProgressQueries) {
      const overdueEvents: Array<ScheduledMaintenance> =
        await ScheduledMaintenanceService.findAllBy({
          query: {
            ...inProgressQuery,
            endsAt: QueryHelper.lessThan(now),
          },
          props: {
            isRoot: true,
          },
          select: {
            _id: true,
            projectId: true,
            shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: true,
          },
        });

      for (const event of overdueEvents) {
        const eventId: string = event.id?.toString() || "";

        if (!eventId || eventIdsRead.has(eventId)) {
          continue;
        }

        eventIdsRead.add(eventId);
        events.push(event);
      }
    }

    // change their state to Ended.

    for (const event of events) {
      const scheduledMaintenanceState: ScheduledMaintenanceState | null =
        await ScheduledMaintenanceStateService.findOneBy({
          query: {
            projectId: event.projectId!,
            isEndedState: true,
          },
          select: {
            _id: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!scheduledMaintenanceState || !scheduledMaintenanceState.id) {
        continue;
      }

      await ScheduledMaintenanceService.changeScheduledMaintenanceState({
        projectId: event.projectId!,
        scheduledMaintenanceId: event.id!,
        scheduledMaintenanceStateId: scheduledMaintenanceState.id,
        shouldNotifyStatusPageSubscribers: Boolean(
          event.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded,
        ),
        isSubscribersNotified: false,
        notifyOwners: true,
        props: {
          isRoot: true,
        },
      });
    }
  },
);

import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "Common/Server/Services/ScheduledMaintenanceStateService";
import Query from "Common/Server/Types/Database/Query";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStartUtil from "Common/Utils/ScheduledMaintenanceStart";

/*
 * Starts every event waiting for its start time once that time has passed:
 * moves it into its project's ongoing state. Waiting is the one rule
 * (Common/Utils/ScheduledMaintenanceStart.isWaitingToStart): in the
 * project's scheduled state, or in a state of the project's own placed after
 * Scheduled and before Ongoing, such as "Confirmed" - an event moved on to
 * one of those is started at its time as much as one left scheduled. A
 * state placed before Scheduled, a draft or an approval step, waits for a
 * person instead. The state service names the states to ask for
 * (getWaitingToStartEventQueriesOfEveryProject).
 *
 * The move does the rest, as any start does
 * (ScheduledMaintenanceStateTimelineService): it stops probing the event's
 * monitors and changes them to the event's Change Monitor Status to, read
 * as it is stored at that moment. That status can be changed until the
 * event starts, so it is not read here, up to a minute before.
 *
 * The ongoing state is the project's - the first from the top flagged
 * ongoing (ScheduledMaintenanceStartUtil.getOngoingState) - read once per
 * project on each run.
 */
RunCron(
  "ScheduledMaintenance:ChangeStateToOngoing",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const waitingQueries: Array<Query<ScheduledMaintenance>> =
      await ScheduledMaintenanceStateService.getWaitingToStartEventQueriesOfEveryProject();

    const now: Date = OneUptimeDate.getCurrentDate();

    // Every waiting event past its start, of every project, once each.
    const events: Array<ScheduledMaintenance> = [];
    const eventIdsRead: Set<string> = new Set<string>();

    for (const waitingQuery of waitingQueries) {
      const dueEvents: Array<ScheduledMaintenance> =
        await ScheduledMaintenanceService.findAllBy({
          query: {
            ...waitingQuery,
            startsAt: QueryHelper.lessThan(now),
          },
          props: {
            isRoot: true,
          },
          select: {
            _id: true,
            projectId: true,
            shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing:
              true,
          },
        });

      for (const event of dueEvents) {
        const eventId: string = event.id?.toString() || "";

        if (!eventId || eventIdsRead.has(eventId)) {
          continue;
        }

        eventIdsRead.add(eventId);
        events.push(event);
      }
    }

    // change their state to Ongoing.

    const ongoingStateByProjectId: Map<
      string,
      ScheduledMaintenanceState | null
    > = new Map<string, ScheduledMaintenanceState | null>();

    for (const event of events) {
      const projectKey: string = event.projectId?.toString() || "";

      if (!ongoingStateByProjectId.has(projectKey)) {
        ongoingStateByProjectId.set(
          projectKey,
          ScheduledMaintenanceStartUtil.getOngoingState({
            states:
              await ScheduledMaintenanceStateService.getAllScheduledMaintenanceStates(
                {
                  projectId: event.projectId!,
                  props: {
                    isRoot: true,
                  },
                },
              ),
          }),
        );
      }

      const scheduledMaintenanceState: ScheduledMaintenanceState | null =
        ongoingStateByProjectId.get(projectKey) || null;

      if (!scheduledMaintenanceState || !scheduledMaintenanceState.id) {
        continue;
      }

      await ScheduledMaintenanceService.changeScheduledMaintenanceState({
        projectId: event.projectId!,
        scheduledMaintenanceId: event.id!,
        scheduledMaintenanceStateId: scheduledMaintenanceState.id,
        shouldNotifyStatusPageSubscribers: Boolean(
          event.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing,
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

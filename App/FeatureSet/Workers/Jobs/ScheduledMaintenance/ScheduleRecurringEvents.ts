import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import ScheduledMaintenanceTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplate";
import ScheduledMaintenanceTemplateService from "Common/Server/Services/ScheduledMaintenanceTemplateService";
import ScheduledMaintenanceTemplateOwnerUserService from "Common/Server/Services/ScheduledMaintenanceTemplateOwnerUserService";
import ScheduledMaintenanceOwnerUser from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerUser";
import ScheduledMaintenanceTemplateOwnerUser from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplateOwnerUser";
import ScheduledMaintenanceOwnerTeamService from "Common/Server/Services/ScheduledMaintenanceOwnerTeamService";
import ScheduledMaintenanceTemplateOwnerTeamService from "Common/Server/Services/ScheduledMaintenanceTemplateOwnerTeamService";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceOwnerUserService from "Common/Server/Services/ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenanceOwnerTeam from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerTeam";
import logger from "Common/Server/Utils/Logger";
import Recurring from "Common/Types/Events/Recurring";

RunCron(
  "ScheduledMaintenance:ScheduleRecurringEvents",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    logger.debug("ScheduledMaintenance:ScheduleRecurringEvents  Running");

    // get all scheduled events of all the projects.
    const recurringTemplates: Array<ScheduledMaintenanceTemplate> =
      await ScheduledMaintenanceTemplateService.findAllBy({
        query: {
          isRecurringEvent: true,
          scheduleNextEventAt: QueryHelper.lessThanEqualTo(
            OneUptimeDate.getCurrentDate(),
          ),
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          projectId: true,
          changeMonitorStatusToId: true,
          shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: true,
          shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
          shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: true,
          monitors: true,
          /*
           * The rest of the affected resources. Without these the
           * recurrence silently drops every host / cluster / service the
           * user attached to the template, so only the first event was
           * ever scoped correctly.
           */
          hosts: true,
          kubernetesClusters: true,
          dockerHosts: true,
          podmanHosts: true,
          services: true,
          statusPages: true,
          scheduleNextEventAt: true,
          firstEventStartsAt: true,
          firstEventEndsAt: true,
          firstEventScheduledAt: true,
          title: true,
          description: true,
          labels: true,
          isRecurringEvent: true,
          recurringInterval: true,
          sendSubscriberNotificationsOnBeforeTheEvent: true,
        },
      });

    // change their state to Ongoing.

    for (const recurringTemplate of recurringTemplates) {
      try {
        logger.debug(
          `ScheduledMaintenance:ScheduleRecurringEvents: Updating event: ${recurringTemplate.id}`,
        );

        if (recurringTemplate.recurringInterval === undefined) {
          continue;
        }

        // update the next scheduled time for this event.
        const recurringInterval: Recurring =
          recurringTemplate.recurringInterval!;
        const nextScheduledTime: Date =
          ScheduledMaintenanceTemplateService.getNextEventTime({
            dateAndTime: recurringTemplate.scheduleNextEventAt!,
            recurringInterval,
          });

        await ScheduledMaintenanceTemplateService.updateOneById({
          id: recurringTemplate.id!,
          data: {
            scheduleNextEventAt: nextScheduledTime,
          },
          props: {
            isRoot: true,
          },
        });

        // get owner users for this template.
        const ownerUsers: Array<ScheduledMaintenanceTemplateOwnerUser> =
          await ScheduledMaintenanceTemplateOwnerUserService.findAllBy({
            query: {
              scheduledMaintenanceTemplateId: recurringTemplate.id!,
            },
            props: {
              isRoot: true,
            },
            select: {
              userId: true,
            },
          });

        // owner teams.
        const ownerTeams: Array<ScheduledMaintenanceOwnerTeam> =
          await ScheduledMaintenanceTemplateOwnerTeamService.findAllBy({
            query: {
              scheduledMaintenanceTemplateId: recurringTemplate.id!,
            },
            props: {
              isRoot: true,
            },
            select: {
              teamId: true,
            },
          });

        // now create a new scheduled maintenance event for this template.
        let scheduledMaintenanceEvent: ScheduledMaintenance =
          new ScheduledMaintenance();
        scheduledMaintenanceEvent.projectId = recurringTemplate.projectId!;
        scheduledMaintenanceEvent.changeMonitorStatusToId =
          recurringTemplate.changeMonitorStatusToId!;
        scheduledMaintenanceEvent.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded =
          recurringTemplate.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded!;
        scheduledMaintenanceEvent.shouldStatusPageSubscribersBeNotifiedOnEventCreated =
          recurringTemplate.shouldStatusPageSubscribersBeNotifiedOnEventCreated!;
        scheduledMaintenanceEvent.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing =
          recurringTemplate.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing!;
        scheduledMaintenanceEvent.monitors = recurringTemplate.monitors!;
        scheduledMaintenanceEvent.hosts = recurringTemplate.hosts!;
        scheduledMaintenanceEvent.kubernetesClusters =
          recurringTemplate.kubernetesClusters!;
        scheduledMaintenanceEvent.dockerHosts = recurringTemplate.dockerHosts!;
        scheduledMaintenanceEvent.podmanHosts = recurringTemplate.podmanHosts!;
        scheduledMaintenanceEvent.services = recurringTemplate.services!;
        scheduledMaintenanceEvent.statusPages = recurringTemplate.statusPages!;
        scheduledMaintenanceEvent.title = recurringTemplate.title!;
        scheduledMaintenanceEvent.description = recurringTemplate.description!;
        scheduledMaintenanceEvent.labels = recurringTemplate.labels!;
        scheduledMaintenanceEvent.sendSubscriberNotificationsOnBeforeTheEvent =
          recurringTemplate.sendSubscriberNotificationsOnBeforeTheEvent!;

        const eventscheduledTime: Date = recurringTemplate.scheduleNextEventAt!;

        const firstScheduledTime: Date =
          recurringTemplate.firstEventScheduledAt!;
        const firstStartTime: Date = recurringTemplate.firstEventStartsAt!;
        const firstEndTime: Date = recurringTemplate.firstEventEndsAt!;

        const minutesBetwenScheduledAndStartTime: number =
          OneUptimeDate.getMinutesBetweenTwoDates(
            firstScheduledTime,
            firstStartTime,
          );
        const minutesBetweenScheduledAndEndTime: number =
          OneUptimeDate.getMinutesBetweenTwoDates(
            firstScheduledTime,
            firstEndTime,
          );

        // set the scheduled time for this event.
        scheduledMaintenanceEvent.createdAt = eventscheduledTime!;
        scheduledMaintenanceEvent.startsAt = OneUptimeDate.addRemoveMinutes(
          eventscheduledTime,
          minutesBetwenScheduledAndStartTime,
        );
        scheduledMaintenanceEvent.endsAt = OneUptimeDate.addRemoveMinutes(
          eventscheduledTime,
          minutesBetweenScheduledAndEndTime,
        );

        // now create this event.

        scheduledMaintenanceEvent = await ScheduledMaintenanceService.create({
          data: scheduledMaintenanceEvent,
          props: {
            isRoot: true,
          },
        });

        // now add owners and teams to this event.

        for (const ownerUser of ownerUsers) {
          const scheduledMaintenanceOwnerUser: ScheduledMaintenanceOwnerUser =
            new ScheduledMaintenanceOwnerUser();
          scheduledMaintenanceOwnerUser.scheduledMaintenanceId =
            scheduledMaintenanceEvent.id!;
          scheduledMaintenanceOwnerUser.projectId =
            scheduledMaintenanceEvent.projectId!;
          scheduledMaintenanceOwnerUser.userId = ownerUser.userId!;
          await ScheduledMaintenanceOwnerUserService.create({
            data: scheduledMaintenanceOwnerUser,
            props: {
              isRoot: true,
            },
          });
        }

        // now do the same for owner teams.

        for (const ownerTeam of ownerTeams) {
          const scheduledMaintenanceOwnerTeam: ScheduledMaintenanceOwnerTeam =
            new ScheduledMaintenanceOwnerTeam();
          scheduledMaintenanceOwnerTeam.scheduledMaintenanceId =
            scheduledMaintenanceEvent.id!;
          scheduledMaintenanceOwnerTeam.projectId =
            scheduledMaintenanceEvent.projectId!;
          scheduledMaintenanceOwnerTeam.teamId = ownerTeam.teamId!;
          await ScheduledMaintenanceOwnerTeamService.create({
            data: scheduledMaintenanceOwnerTeam,
            props: {
              isRoot: true,
            },
          });
        }

        logger.debug(
          `ScheduledMaintenance:ScheduleRecurringEvents: Created event: ${scheduledMaintenanceEvent.id}`,
        );
      } catch (e) {
        logger.error(
          `ScheduledMaintenance:ScheduleRecurringEvents: Error creating event for template: ${recurringTemplate.id}`,
        );
        logger.error(e);
      }
    }
  },
);

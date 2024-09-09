import RunCron from "../../Utils/Cron";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
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

RunCron(
  "ScheduledMaintenance:ScheduleRecurringEvents",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // get all scheduled events of all the projects.
    const recurringTemplates: Array<ScheduledMaintenanceTemplate> =
      await ScheduledMaintenanceTemplateService.findBy({
        query: {
          isRecurringEvent: true,
          scheduleNextEventAt: QueryHelper.lessThanEqualTo(
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
          projectId: true,
          changeMonitorStatusToId: true,
          shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: true,
          shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
          shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: true,
          monitors: true,
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
        },
      });

    // change their state to Ongoing.

    for (const recurringTemplate of recurringTemplates) {
      // get owner users for this template.
      const ownerUsers: Array<ScheduledMaintenanceTemplateOwnerUser> =
        await ScheduledMaintenanceTemplateOwnerUserService.findBy({
          query: {
            scheduledMaintenanceTemplateId: recurringTemplate.id!,
          },
          props: {
            isRoot: true,
          },
          limit: LIMIT_MAX,
          skip: 0,
          select: {
            userId: true,
          },
        });

      // owner teams.
      const ownerTeams: Array<ScheduledMaintenanceOwnerTeam> =
        await ScheduledMaintenanceTemplateOwnerTeamService.findBy({
          query: {
            scheduledMaintenanceTemplateId: recurringTemplate.id!,
          },
          props: {
            isRoot: true,
          },
          limit: LIMIT_MAX,
          skip: 0,
          select: {
            teamId: true,
          },
        });

      // now create a new scheduled maintenance event for this template.
      let scheduledMaintenanceEvent = new ScheduledMaintenance();
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
      scheduledMaintenanceEvent.statusPages = recurringTemplate.statusPages!;
      scheduledMaintenanceEvent.title = recurringTemplate.title!;
      scheduledMaintenanceEvent.description = recurringTemplate.description!;
      scheduledMaintenanceEvent.labels = recurringTemplate.labels!;

      const eventscheduledTime = recurringTemplate.scheduleNextEventAt!;

      const firstScheduledTime = recurringTemplate.firstEventScheduledAt!;
      const firstStartTime = recurringTemplate.firstEventStartsAt!;
      const firstEndTime = recurringTemplate.firstEventEndsAt!;

      const minutesBetwenScheduledAndStartTime =
        OneUptimeDate.getMinutesBetweenTwoDates(
          eventscheduledTime,
          firstStartTime,
        );
      const minutesBetweenScheduledAndEndTime =
        OneUptimeDate.getMinutesBetweenTwoDates(
          eventscheduledTime,
          firstEndTime,
        );

      // set the scheduled time for this event.
      scheduledMaintenanceEvent.createdAt = eventscheduledTime!;
      scheduledMaintenanceEvent.startsAt = OneUptimeDate.addRemoveMinutes(
        firstScheduledTime,
        minutesBetwenScheduledAndStartTime,
      );
      scheduledMaintenanceEvent.endsAt = OneUptimeDate.addRemoveMinutes(
        firstScheduledTime,
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
        const scheduledMaintenanceOwnerUser =
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
        const scheduledMaintenanceOwnerTeam =
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
    }
  },
);

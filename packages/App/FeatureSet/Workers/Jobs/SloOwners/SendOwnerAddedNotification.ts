import RunCron from "../../Utils/Cron";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import { SMSMessage } from "Common/Types/SMS/SMS";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ServiceLevelObjectiveOwnerTeamService from "Common/Server/Services/ServiceLevelObjectiveOwnerTeamService";
import ServiceLevelObjectiveOwnerUserService from "Common/Server/Services/ServiceLevelObjectiveOwnerUserService";
import ServiceLevelObjectiveService from "Common/Server/Services/ServiceLevelObjectiveService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import logger, { LogAttributes } from "Common/Server/Utils/Logger";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveOwnerTeam from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import User from "Common/Models/DatabaseModels/User";

/**
 * Notifies users who were just added as owners of a Service Level Objective —
 * directly (ServiceLevelObjectiveOwnerUser) or through a team
 * (ServiceLevelObjectiveOwnerTeam). Clones the MonitorOwners job.
 *
 * Ordering discipline (same as every other owner-added job): the
 * isOwnerNotified marker is flipped to TRUE while the owner rows are being
 * collected, i.e. BEFORE anything is sent. A send that fails is therefore
 * dropped rather than retried forever — the alternative (flip after send) turns
 * any persistent failure, e.g. a user with an unroutable channel, into an
 * infinite re-notification loop that re-sends every minute.
 */
RunCron(
  "SloOwners:SendOwnerAddedNotification",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const sloOwnerTeams: Array<ServiceLevelObjectiveOwnerTeam> =
      await ServiceLevelObjectiveOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          serviceLevelObjectiveId: true,
          teamId: true,
        },
      });

    const sloOwnersMap: Dictionary<Array<User>> = {};

    for (const sloOwnerTeam of sloOwnerTeams) {
      const sloId: ObjectID = sloOwnerTeam.serviceLevelObjectiveId!;
      const teamId: ObjectID = sloOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (sloOwnersMap[sloId.toString()] === undefined) {
        sloOwnersMap[sloId.toString()] = [];
      }

      for (const user of users) {
        (sloOwnersMap[sloId.toString()] as Array<User>).push(user);
      }

      // mark this as notified.
      await ServiceLevelObjectiveOwnerTeamService.updateOneById({
        id: sloOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const sloOwnerUsers: Array<ServiceLevelObjectiveOwnerUser> =
      await ServiceLevelObjectiveOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          serviceLevelObjectiveId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const sloOwnerUser of sloOwnerUsers) {
      const sloId: ObjectID = sloOwnerUser.serviceLevelObjectiveId!;
      const user: User = sloOwnerUser.user!;

      if (sloOwnersMap[sloId.toString()] === undefined) {
        sloOwnersMap[sloId.toString()] = [];
      }

      (sloOwnersMap[sloId.toString()] as Array<User>).push(user);

      // mark this as notified.
      await ServiceLevelObjectiveOwnerUserService.updateOneById({
        id: sloOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send notifications to all of these users.

    for (const sloId in sloOwnersMap) {
      if (!sloOwnersMap[sloId]) {
        continue;
      }

      if ((sloOwnersMap[sloId] as Array<User>).length === 0) {
        continue;
      }

      const users: Array<User> = sloOwnersMap[sloId] as Array<User>;

      const slo: ServiceLevelObjective | null =
        await ServiceLevelObjectiveService.findOneById({
          id: new ObjectID(sloId),
          props: {
            isRoot: true,
          },

          select: {
            _id: true,
            name: true,
            projectId: true,
            project: {
              name: true,
            },
            targetPercentage: true,
            windowType: true,
            windowDays: true,
          },
        });

      if (!slo || !slo.projectId) {
        continue;
      }

      const sloName: string = slo.name || "SLO";
      const projectName: string = slo.project?.name || "OneUptime";

      const sloViewLink: string = (
        await ServiceLevelObjectiveService.getSloLinkInDashboard(
          slo.projectId,
          slo.id!,
        )
      ).toString();

      /*
       * "99.9% over a rolling 30 days" / "99.9% over the calendar month" —
       * windowDays is meaningless for a CalendarMonth window (the model
       * documents it as ignored), so it is only rendered for Rolling.
       */
      const windowDescription: string =
        slo.windowType === SloWindowType.CalendarMonth
          ? "the calendar month"
          : `a rolling ${slo.windowDays || 30} days`;

      const objectiveDescription: string = slo.targetPercentage
        ? `${slo.targetPercentage}% over ${windowDescription}`
        : `measured over ${windowDescription}`;

      const emailSubject: string =
        "You have been added as the owner of the service level objective.";

      /*
       * SimpleMessage is the generic owner-added email path (the same one the
       * NetworkDeviceOwners job uses): every dedicated *OwnerAdded.hbs template
       * hardcodes its resource's labels and detail fields, so reusing one would
       * mean an email that calls this SLO a monitor. A near-duplicate
       * SloOwnerAdded.hbs would add a template for one sentence of copy.
       */
      const vars: Dictionary<string> = {
        subject: emailSubject,
        message: `You have been added as the owner of the service level objective ${sloName} in the project ${projectName}. Its objective is ${objectiveDescription}. You can view the SLO here: ${sloViewLink}`,
      };

      const eventType: NotificationSettingEventType =
        NotificationSettingEventType.SEND_SLO_OWNER_ADDED_NOTIFICATION;

      for (const user of users) {
        if (!user.id) {
          continue;
        }

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.SimpleMessage,
          vars: vars,
          subject: emailSubject,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the service level objective - ${sloName}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the service level objective ${sloName}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as SLO Owner",
            body: `You have been added as the owner of the service level objective: ${sloName}. Click to view details.`,
            clickAction: sloViewLink,
            tag: "slo-owner-added",
            requireInteraction: false,
          });

        /*
         * WhatsApp: there is no registered WhatsApp template for any SLO event
         * type, so createWhatsAppMessageFromTemplate would throw here. A plain
         * body payload is sent instead — the same thing Slo/EvaluateSlos does.
         */
        const whatsAppMessage: WhatsAppMessagePayload = {
          body: sms.message,
        };

        /*
         * Per-owner isolation: one owner with a broken notification setting must
         * not cost the remaining owners of this SLO their notification. The
         * markers are already flipped, so there is nothing to roll back.
         */
        try {
          /*
           * SEND_SLO_OWNER_ADDED_NOTIFICATION is newer than most existing
           * users, and sendUserNotification silently no-ops when no setting row
           * exists — seed the default row first so owners added today are
           * actually reached.
           */
          await UserNotificationSettingService.ensureSettingExistsForUser({
            userId: user.id,
            projectId: slo.projectId,
            eventType: eventType,
          });

          await UserNotificationSettingService.sendUserNotification({
            userId: user.id,
            projectId: slo.projectId,
            emailEnvelope: emailMessage,
            smsMessage: sms,
            callRequestMessage: callMessage,
            pushNotificationMessage: pushMessage,
            whatsAppMessage: whatsAppMessage,
            eventType: eventType,
          });
        } catch (err) {
          logger.error(
            `SloOwners:SendOwnerAddedNotification - Error notifying user ${user.id.toString()} that they were added as an owner of SLO ${slo.id?.toString()}: ${err}`,
            {
              projectId: slo.projectId.toString(),
              sloId: slo.id?.toString(),
            } as LogAttributes,
          );
        }
      }
    }
  },
);

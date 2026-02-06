import RunCron from "../../Utils/Cron";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ScheduledMaintenanceOwnerTeamService from "Common/Server/Services/ScheduledMaintenanceOwnerTeamService";
import ScheduledMaintenanceOwnerUserService from "Common/Server/Services/ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceOwnerTeam from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerTeam";
import ScheduledMaintenanceOwnerUser from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerUser";
import User from "Common/Models/DatabaseModels/User";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

RunCron(
  "ScheduledMaintenanceOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const scheduledMaintenanceOwnerTeams: Array<ScheduledMaintenanceOwnerTeam> =
      await ScheduledMaintenanceOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          scheduledMaintenanceId: true,
          teamId: true,
        },
      });

    const scheduledMaintenanceOwnersMap: Dictionary<Array<User>> = {};

    for (const scheduledMaintenanceOwnerTeam of scheduledMaintenanceOwnerTeams) {
      const scheduledMaintenanceId: ObjectID =
        scheduledMaintenanceOwnerTeam.scheduledMaintenanceId!;
      const teamId: ObjectID = scheduledMaintenanceOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (
        scheduledMaintenanceOwnersMap[scheduledMaintenanceId.toString()] ===
        undefined
      ) {
        scheduledMaintenanceOwnersMap[scheduledMaintenanceId.toString()] = [];
      }

      for (const user of users) {
        (
          scheduledMaintenanceOwnersMap[
            scheduledMaintenanceId.toString()
          ] as Array<User>
        ).push(user);
      }

      // mark this as notified.
      await ScheduledMaintenanceOwnerTeamService.updateOneById({
        id: scheduledMaintenanceOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const scheduledMaintenanceOwnerUsers: Array<ScheduledMaintenanceOwnerUser> =
      await ScheduledMaintenanceOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          scheduledMaintenanceId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const scheduledMaintenanceOwnerUser of scheduledMaintenanceOwnerUsers) {
      const scheduledMaintenanceId: ObjectID =
        scheduledMaintenanceOwnerUser.scheduledMaintenanceId!;
      const user: User = scheduledMaintenanceOwnerUser.user!;

      if (
        scheduledMaintenanceOwnersMap[scheduledMaintenanceId.toString()] ===
        undefined
      ) {
        scheduledMaintenanceOwnersMap[scheduledMaintenanceId.toString()] = [];
      }

      (
        scheduledMaintenanceOwnersMap[
          scheduledMaintenanceId.toString()
        ] as Array<User>
      ).push(user);

      // mark this as notified.
      await ScheduledMaintenanceOwnerUserService.updateOneById({
        id: scheduledMaintenanceOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const scheduledMaintenanceId in scheduledMaintenanceOwnersMap) {
      if (!scheduledMaintenanceOwnersMap[scheduledMaintenanceId]) {
        continue;
      }

      if (
        (scheduledMaintenanceOwnersMap[scheduledMaintenanceId] as Array<User>)
          .length === 0
      ) {
        continue;
      }

      const users: Array<User> = scheduledMaintenanceOwnersMap[
        scheduledMaintenanceId
      ] as Array<User>;

      // get all scheduled events of all the projects.
      const scheduledMaintenance: ScheduledMaintenance | null =
        await ScheduledMaintenanceService.findOneById({
          id: new ObjectID(scheduledMaintenanceId),
          props: {
            isRoot: true,
          },

          select: {
            _id: true,
            title: true,
            description: true,
            projectId: true,
            project: {
              name: true,
            },
            currentScheduledMaintenanceState: {
              name: true,
            },
            scheduledMaintenanceNumber: true,
            scheduledMaintenanceNumberWithPrefix: true,
          },
        });

      if (!scheduledMaintenance) {
        continue;
      }

      const scheduledMaintenanceNumber: string =
        scheduledMaintenance.scheduledMaintenanceNumberWithPrefix
          || (scheduledMaintenance.scheduledMaintenanceNumber
            ? `#${scheduledMaintenance.scheduledMaintenanceNumber}`
            : "");

      const vars: Dictionary<string> = {
        scheduledMaintenanceTitle: scheduledMaintenance.title!,
        scheduledMaintenanceNumber: scheduledMaintenanceNumber,
        projectName: scheduledMaintenance.project!.name!,
        currentState:
          scheduledMaintenance.currentScheduledMaintenanceState!.name!,
        scheduledMaintenanceDescription: await Markdown.convertToHTML(
          scheduledMaintenance.description! || "",
          MarkdownContentType.Email,
        ),
        scheduledMaintenanceViewLink: (
          await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
            scheduledMaintenance.projectId!,
            scheduledMaintenance.id!,
          )
        ).toString(),
      };

      for (const user of users) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.ScheduledMaintenanceOwnerAdded,
          vars: vars,
          subject: `You have been added as the owner of Scheduled Maintenance ${scheduledMaintenanceNumber} - ${scheduledMaintenance.title}`,
        };

        const scheduledMaintenanceIdentifier: string =
          scheduledMaintenance.scheduledMaintenanceNumber !== undefined
            ? `${scheduledMaintenanceNumber} (${scheduledMaintenance.title})`
            : scheduledMaintenance.title!;

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the scheduled maintenance event - ${scheduledMaintenanceIdentifier}. To view this event, go to OneUptime Dashboard. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the scheduled maintenance event ${scheduledMaintenanceIdentifier}. To view this event, go to OneUptime Dashboard. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: `Added as Scheduled Maintenance ${scheduledMaintenanceNumber} Owner`,
            body: `You have been added as the owner of the scheduled maintenance: ${scheduledMaintenanceIdentifier}. Click to view details.`,
            clickAction: (
              await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
                scheduledMaintenance.projectId!,
                scheduledMaintenance.id!,
              )
            ).toString(),
            tag: "scheduled-maintenance-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              event_title: scheduledMaintenance.title!,
              maintenance_link: vars["scheduledMaintenanceViewLink"] || "",
              event_number:
                scheduledMaintenance.scheduledMaintenanceNumberWithPrefix ||
                (scheduledMaintenance.scheduledMaintenanceNumber?.toString() ??
                "N/A"),
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: scheduledMaintenance.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          whatsAppMessage,
          scheduledMaintenanceId: scheduledMaintenance.id!,
          eventType,
        });
      }
    }
  },
);

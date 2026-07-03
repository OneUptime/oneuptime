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
import MonitorGroupOwnerTeamService from "Common/Server/Services/MonitorGroupOwnerTeamService";
import MonitorGroupOwnerUserService from "Common/Server/Services/MonitorGroupOwnerUserService";
import MonitorGroupService from "Common/Server/Services/MonitorGroupService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import MonitorGroup from "Common/Models/DatabaseModels/MonitorGroup";
import MonitorGroupOwnerTeam from "Common/Models/DatabaseModels/MonitorGroupOwnerTeam";
import MonitorGroupOwnerUser from "Common/Models/DatabaseModels/MonitorGroupOwnerUser";
import User from "Common/Models/DatabaseModels/User";

RunCron(
  "MonitorGroupOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const monitorGroupOwnerTeams: Array<MonitorGroupOwnerTeam> =
      await MonitorGroupOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          monitorGroupId: true,
          teamId: true,
        },
      });

    const monitorGroupOwnersMap: Dictionary<Array<User>> = {};

    for (const monitorGroupOwnerTeam of monitorGroupOwnerTeams) {
      const monitorGroupId: ObjectID = monitorGroupOwnerTeam.monitorGroupId!;
      const teamId: ObjectID = monitorGroupOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (monitorGroupOwnersMap[monitorGroupId.toString()] === undefined) {
        monitorGroupOwnersMap[monitorGroupId.toString()] = [];
      }

      for (const user of users) {
        (monitorGroupOwnersMap[monitorGroupId.toString()] as Array<User>).push(user);
      }

      // mark this as notified.
      await MonitorGroupOwnerTeamService.updateOneById({
        id: monitorGroupOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const monitorGroupOwnerUsers: Array<MonitorGroupOwnerUser> =
      await MonitorGroupOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          monitorGroupId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const monitorGroupOwnerUser of monitorGroupOwnerUsers) {
      const monitorGroupId: ObjectID = monitorGroupOwnerUser.monitorGroupId!;
      const user: User = monitorGroupOwnerUser.user!;

      if (monitorGroupOwnersMap[monitorGroupId.toString()] === undefined) {
        monitorGroupOwnersMap[monitorGroupId.toString()] = [];
      }

      (monitorGroupOwnersMap[monitorGroupId.toString()] as Array<User>).push(user);

      // mark this as notified.
      await MonitorGroupOwnerUserService.updateOneById({
        id: monitorGroupOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const monitorGroupId in monitorGroupOwnersMap) {
      if (!monitorGroupOwnersMap[monitorGroupId]) {
        continue;
      }

      if ((monitorGroupOwnersMap[monitorGroupId] as Array<User>).length === 0) {
        continue;
      }

      const users: Array<User> = monitorGroupOwnersMap[monitorGroupId] as Array<User>;

      const monitorGroup: MonitorGroup | null = await MonitorGroupService.findOneById({
        id: new ObjectID(monitorGroupId),
        props: {
          isRoot: true,
        },

        select: {
          _id: true,
          name: true,
          description: true,
          projectId: true,
          project: {
            name: true,
          },
        },
      });

      if (!monitorGroup) {
        continue;
      }

      const viewGroupLink: string = (
        await MonitorGroupService.getLinkInDashboard(monitorGroup.projectId!, monitorGroup.id!)
      ).toString();

      const vars: Dictionary<string> = {
        groupName: monitorGroup.name!,
        groupDescription: monitorGroup.description || "No description provided",
        projectName: monitorGroup.project!.name!,
        viewGroupLink: viewGroupLink,
      };

      for (const user of users) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.MonitorGroupOwnerAdded,
          vars: vars,
          subject: "[Monitor Group] Owner of " + monitorGroup.name,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the monitor group: ${monitorGroup.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the monitor group: ${monitorGroup.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as Monitor Group Owner",
            body: `You have been added as the owner of the monitor group: ${monitorGroup.name!}. Click to view details.`,
            clickAction: viewGroupLink,
            tag: "monitor-group-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_MONITOR_GROUP_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              group_name: monitorGroup.name!,
              group_link: viewGroupLink,
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: monitorGroup.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          whatsAppMessage,
          eventType,
        });
      }
    }
  },
);

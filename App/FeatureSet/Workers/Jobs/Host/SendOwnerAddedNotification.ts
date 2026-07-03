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
import HostOwnerTeamService from "Common/Server/Services/HostOwnerTeamService";
import HostOwnerUserService from "Common/Server/Services/HostOwnerUserService";
import HostService from "Common/Server/Services/HostService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import Host from "Common/Models/DatabaseModels/Host";
import HostOwnerTeam from "Common/Models/DatabaseModels/HostOwnerTeam";
import HostOwnerUser from "Common/Models/DatabaseModels/HostOwnerUser";
import User from "Common/Models/DatabaseModels/User";

RunCron(
  "HostOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const hostOwnerTeams: Array<HostOwnerTeam> =
      await HostOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          hostId: true,
          teamId: true,
        },
      });

    const hostOwnersMap: Dictionary<Array<User>> = {};

    for (const hostOwnerTeam of hostOwnerTeams) {
      const hostId: ObjectID = hostOwnerTeam.hostId!;
      const teamId: ObjectID = hostOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (hostOwnersMap[hostId.toString()] === undefined) {
        hostOwnersMap[hostId.toString()] = [];
      }

      for (const user of users) {
        (hostOwnersMap[hostId.toString()] as Array<User>).push(user);
      }

      // mark this as notified.
      await HostOwnerTeamService.updateOneById({
        id: hostOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const hostOwnerUsers: Array<HostOwnerUser> =
      await HostOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          hostId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const hostOwnerUser of hostOwnerUsers) {
      const hostId: ObjectID = hostOwnerUser.hostId!;
      const user: User = hostOwnerUser.user!;

      if (hostOwnersMap[hostId.toString()] === undefined) {
        hostOwnersMap[hostId.toString()] = [];
      }

      (hostOwnersMap[hostId.toString()] as Array<User>).push(user);

      // mark this as notified.
      await HostOwnerUserService.updateOneById({
        id: hostOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const hostId in hostOwnersMap) {
      if (!hostOwnersMap[hostId]) {
        continue;
      }

      if ((hostOwnersMap[hostId] as Array<User>).length === 0) {
        continue;
      }

      const users: Array<User> = hostOwnersMap[hostId] as Array<User>;

      const host: Host | null = await HostService.findOneById({
        id: new ObjectID(hostId),
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

      if (!host) {
        continue;
      }

      const viewHostLink: string = (
        await HostService.getLinkInDashboard(host.projectId!, host.id!)
      ).toString();

      const vars: Dictionary<string> = {
        hostName: host.name!,
        hostDescription: host.description || "No description provided",
        projectName: host.project!.name!,
        viewHostLink: viewHostLink,
      };

      for (const user of users) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.HostOwnerAdded,
          vars: vars,
          subject: "[Host] Owner of " + host.name,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the host: ${host.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the host: ${host.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as Host Owner",
            body: `You have been added as the owner of the host: ${host.name!}. Click to view details.`,
            clickAction: viewHostLink,
            tag: "host-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_HOST_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              host_name: host.name!,
              host_link: viewHostLink,
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: host.projectId!,
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

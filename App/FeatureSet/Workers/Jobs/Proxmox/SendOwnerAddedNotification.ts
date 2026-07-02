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
import ProxmoxClusterOwnerTeamService from "Common/Server/Services/ProxmoxClusterOwnerTeamService";
import ProxmoxClusterOwnerUserService from "Common/Server/Services/ProxmoxClusterOwnerUserService";
import ProxmoxClusterService from "Common/Server/Services/ProxmoxClusterService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import ProxmoxClusterOwnerTeam from "Common/Models/DatabaseModels/ProxmoxClusterOwnerTeam";
import ProxmoxClusterOwnerUser from "Common/Models/DatabaseModels/ProxmoxClusterOwnerUser";
import User from "Common/Models/DatabaseModels/User";

RunCron(
  "ProxmoxClusterOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const proxmoxClusterOwnerTeams: Array<ProxmoxClusterOwnerTeam> =
      await ProxmoxClusterOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          proxmoxClusterId: true,
          teamId: true,
        },
      });

    const proxmoxClusterOwnersMap: Dictionary<Array<User>> = {};

    for (const proxmoxClusterOwnerTeam of proxmoxClusterOwnerTeams) {
      const proxmoxClusterId: ObjectID =
        proxmoxClusterOwnerTeam.proxmoxClusterId!;
      const teamId: ObjectID = proxmoxClusterOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (proxmoxClusterOwnersMap[proxmoxClusterId.toString()] === undefined) {
        proxmoxClusterOwnersMap[proxmoxClusterId.toString()] = [];
      }

      for (const user of users) {
        (
          proxmoxClusterOwnersMap[proxmoxClusterId.toString()] as Array<User>
        ).push(user);
      }

      // mark this as notified.
      await ProxmoxClusterOwnerTeamService.updateOneById({
        id: proxmoxClusterOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const proxmoxClusterOwnerUsers: Array<ProxmoxClusterOwnerUser> =
      await ProxmoxClusterOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          proxmoxClusterId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const proxmoxClusterOwnerUser of proxmoxClusterOwnerUsers) {
      const proxmoxClusterId: ObjectID =
        proxmoxClusterOwnerUser.proxmoxClusterId!;
      const user: User = proxmoxClusterOwnerUser.user!;

      if (proxmoxClusterOwnersMap[proxmoxClusterId.toString()] === undefined) {
        proxmoxClusterOwnersMap[proxmoxClusterId.toString()] = [];
      }

      (
        proxmoxClusterOwnersMap[proxmoxClusterId.toString()] as Array<User>
      ).push(user);

      // mark this as notified.
      await ProxmoxClusterOwnerUserService.updateOneById({
        id: proxmoxClusterOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const proxmoxClusterId in proxmoxClusterOwnersMap) {
      if (!proxmoxClusterOwnersMap[proxmoxClusterId]) {
        continue;
      }

      if (
        (proxmoxClusterOwnersMap[proxmoxClusterId] as Array<User>).length === 0
      ) {
        continue;
      }

      const users: Array<User> = proxmoxClusterOwnersMap[
        proxmoxClusterId
      ] as Array<User>;

      const proxmoxCluster: ProxmoxCluster | null =
        await ProxmoxClusterService.findOneById({
          id: new ObjectID(proxmoxClusterId),
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

      if (!proxmoxCluster) {
        continue;
      }

      const viewClusterLink: string = (
        await ProxmoxClusterService.getLinkInDashboard(
          proxmoxCluster.projectId!,
          proxmoxCluster.id!,
        )
      ).toString();

      const vars: Dictionary<string> = {
        clusterName: proxmoxCluster.name!,
        clusterDescription:
          proxmoxCluster.description || "No description provided",
        projectName: proxmoxCluster.project!.name!,
        viewClusterLink: viewClusterLink,
      };

      for (const user of users) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.ProxmoxClusterOwnerAdded,
          vars: vars,
          subject: "[Proxmox Cluster] Owner of " + proxmoxCluster.name,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the Proxmox cluster: ${proxmoxCluster.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the Proxmox cluster: ${proxmoxCluster.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as Proxmox Cluster Owner",
            body: `You have been added as the owner of the Proxmox cluster: ${proxmoxCluster.name!}. Click to view details.`,
            clickAction: viewClusterLink,
            tag: "proxmox-cluster-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_PROXMOX_CLUSTER_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              cluster_name: proxmoxCluster.name!,
              cluster_link: viewClusterLink,
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: proxmoxCluster.projectId!,
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

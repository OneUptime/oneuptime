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
import CephClusterOwnerTeamService from "Common/Server/Services/CephClusterOwnerTeamService";
import CephClusterOwnerUserService from "Common/Server/Services/CephClusterOwnerUserService";
import CephClusterService from "Common/Server/Services/CephClusterService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import CephClusterOwnerTeam from "Common/Models/DatabaseModels/CephClusterOwnerTeam";
import CephClusterOwnerUser from "Common/Models/DatabaseModels/CephClusterOwnerUser";
import User from "Common/Models/DatabaseModels/User";

RunCron(
  "CephClusterOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const cephClusterOwnerTeams: Array<CephClusterOwnerTeam> =
      await CephClusterOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          cephClusterId: true,
          teamId: true,
        },
      });

    const cephClusterOwnersMap: Dictionary<Array<User>> = {};

    for (const cephClusterOwnerTeam of cephClusterOwnerTeams) {
      const cephClusterId: ObjectID = cephClusterOwnerTeam.cephClusterId!;
      const teamId: ObjectID = cephClusterOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (cephClusterOwnersMap[cephClusterId.toString()] === undefined) {
        cephClusterOwnersMap[cephClusterId.toString()] = [];
      }

      for (const user of users) {
        (cephClusterOwnersMap[cephClusterId.toString()] as Array<User>).push(
          user,
        );
      }

      // mark this as notified.
      await CephClusterOwnerTeamService.updateOneById({
        id: cephClusterOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const cephClusterOwnerUsers: Array<CephClusterOwnerUser> =
      await CephClusterOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          cephClusterId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const cephClusterOwnerUser of cephClusterOwnerUsers) {
      const cephClusterId: ObjectID = cephClusterOwnerUser.cephClusterId!;
      const user: User = cephClusterOwnerUser.user!;

      if (cephClusterOwnersMap[cephClusterId.toString()] === undefined) {
        cephClusterOwnersMap[cephClusterId.toString()] = [];
      }

      (cephClusterOwnersMap[cephClusterId.toString()] as Array<User>).push(
        user,
      );

      // mark this as notified.
      await CephClusterOwnerUserService.updateOneById({
        id: cephClusterOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const cephClusterId in cephClusterOwnersMap) {
      if (!cephClusterOwnersMap[cephClusterId]) {
        continue;
      }

      if ((cephClusterOwnersMap[cephClusterId] as Array<User>).length === 0) {
        continue;
      }

      const users: Array<User> = cephClusterOwnersMap[
        cephClusterId
      ] as Array<User>;

      const cephCluster: CephCluster | null =
        await CephClusterService.findOneById({
          id: new ObjectID(cephClusterId),
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

      if (!cephCluster) {
        continue;
      }

      const viewClusterLink: string = (
        await CephClusterService.getLinkInDashboard(
          cephCluster.projectId!,
          cephCluster.id!,
        )
      ).toString();

      const vars: Dictionary<string> = {
        clusterName: cephCluster.name!,
        clusterDescription:
          cephCluster.description || "No description provided",
        projectName: cephCluster.project!.name!,
        viewClusterLink: viewClusterLink,
      };

      for (const user of users) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.CephClusterOwnerAdded,
          vars: vars,
          subject: "[Ceph Cluster] Owner of " + cephCluster.name,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the Ceph cluster: ${cephCluster.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the Ceph cluster: ${cephCluster.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as Ceph Cluster Owner",
            body: `You have been added as the owner of the Ceph cluster: ${cephCluster.name!}. Click to view details.`,
            clickAction: viewClusterLink,
            tag: "ceph-cluster-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_CEPH_CLUSTER_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              cluster_name: cephCluster.name!,
              cluster_link: viewClusterLink,
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: cephCluster.projectId!,
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

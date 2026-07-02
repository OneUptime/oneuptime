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
import KubernetesClusterOwnerTeamService from "Common/Server/Services/KubernetesClusterOwnerTeamService";
import KubernetesClusterOwnerUserService from "Common/Server/Services/KubernetesClusterOwnerUserService";
import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import KubernetesClusterOwnerTeam from "Common/Models/DatabaseModels/KubernetesClusterOwnerTeam";
import KubernetesClusterOwnerUser from "Common/Models/DatabaseModels/KubernetesClusterOwnerUser";
import User from "Common/Models/DatabaseModels/User";

RunCron(
  "KubernetesClusterOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const kubernetesClusterOwnerTeams: Array<KubernetesClusterOwnerTeam> =
      await KubernetesClusterOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          kubernetesClusterId: true,
          teamId: true,
        },
      });

    const kubernetesClusterOwnersMap: Dictionary<Array<User>> = {};

    for (const kubernetesClusterOwnerTeam of kubernetesClusterOwnerTeams) {
      const kubernetesClusterId: ObjectID =
        kubernetesClusterOwnerTeam.kubernetesClusterId!;
      const teamId: ObjectID = kubernetesClusterOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (
        kubernetesClusterOwnersMap[kubernetesClusterId.toString()] === undefined
      ) {
        kubernetesClusterOwnersMap[kubernetesClusterId.toString()] = [];
      }

      for (const user of users) {
        (
          kubernetesClusterOwnersMap[
            kubernetesClusterId.toString()
          ] as Array<User>
        ).push(user);
      }

      // mark this as notified.
      await KubernetesClusterOwnerTeamService.updateOneById({
        id: kubernetesClusterOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const kubernetesClusterOwnerUsers: Array<KubernetesClusterOwnerUser> =
      await KubernetesClusterOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          kubernetesClusterId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const kubernetesClusterOwnerUser of kubernetesClusterOwnerUsers) {
      const kubernetesClusterId: ObjectID =
        kubernetesClusterOwnerUser.kubernetesClusterId!;
      const user: User = kubernetesClusterOwnerUser.user!;

      if (
        kubernetesClusterOwnersMap[kubernetesClusterId.toString()] === undefined
      ) {
        kubernetesClusterOwnersMap[kubernetesClusterId.toString()] = [];
      }

      (
        kubernetesClusterOwnersMap[
          kubernetesClusterId.toString()
        ] as Array<User>
      ).push(user);

      // mark this as notified.
      await KubernetesClusterOwnerUserService.updateOneById({
        id: kubernetesClusterOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const kubernetesClusterId in kubernetesClusterOwnersMap) {
      if (!kubernetesClusterOwnersMap[kubernetesClusterId]) {
        continue;
      }

      if (
        (kubernetesClusterOwnersMap[kubernetesClusterId] as Array<User>)
          .length === 0
      ) {
        continue;
      }

      const users: Array<User> = kubernetesClusterOwnersMap[
        kubernetesClusterId
      ] as Array<User>;

      const kubernetesCluster: KubernetesCluster | null =
        await KubernetesClusterService.findOneById({
          id: new ObjectID(kubernetesClusterId),
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

      if (!kubernetesCluster) {
        continue;
      }

      const viewClusterLink: string = (
        await KubernetesClusterService.getLinkInDashboard(
          kubernetesCluster.projectId!,
          kubernetesCluster.id!,
        )
      ).toString();

      const vars: Dictionary<string> = {
        clusterName: kubernetesCluster.name!,
        clusterDescription:
          kubernetesCluster.description || "No description provided",
        projectName: kubernetesCluster.project!.name!,
        viewClusterLink: viewClusterLink,
      };

      for (const user of users) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.KubernetesClusterOwnerAdded,
          vars: vars,
          subject: "[Kubernetes Cluster] Owner of " + kubernetesCluster.name,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the Kubernetes cluster: ${kubernetesCluster.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the Kubernetes cluster: ${kubernetesCluster.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as Kubernetes Cluster Owner",
            body: `You have been added as the owner of the Kubernetes cluster: ${kubernetesCluster.name!}. Click to view details.`,
            clickAction: viewClusterLink,
            tag: "kubernetes-cluster-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_KUBERNETES_CLUSTER_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              cluster_name: kubernetesCluster.name!,
              cluster_link: viewClusterLink,
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: kubernetesCluster.projectId!,
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

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
import DockerSwarmClusterOwnerTeamService from "Common/Server/Services/DockerSwarmClusterOwnerTeamService";
import DockerSwarmClusterOwnerUserService from "Common/Server/Services/DockerSwarmClusterOwnerUserService";
import DockerSwarmClusterService from "Common/Server/Services/DockerSwarmClusterService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import DockerSwarmClusterOwnerTeam from "Common/Models/DatabaseModels/DockerSwarmClusterOwnerTeam";
import DockerSwarmClusterOwnerUser from "Common/Models/DatabaseModels/DockerSwarmClusterOwnerUser";
import User from "Common/Models/DatabaseModels/User";

RunCron(
  "DockerSwarmClusterOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const dockerSwarmClusterOwnerTeams: Array<DockerSwarmClusterOwnerTeam> =
      await DockerSwarmClusterOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          dockerSwarmClusterId: true,
          teamId: true,
        },
      });

    const dockerSwarmClusterOwnersMap: Dictionary<Array<User>> = {};

    for (const dockerSwarmClusterOwnerTeam of dockerSwarmClusterOwnerTeams) {
      const dockerSwarmClusterId: ObjectID =
        dockerSwarmClusterOwnerTeam.dockerSwarmClusterId!;
      const teamId: ObjectID = dockerSwarmClusterOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (
        dockerSwarmClusterOwnersMap[dockerSwarmClusterId.toString()] ===
        undefined
      ) {
        dockerSwarmClusterOwnersMap[dockerSwarmClusterId.toString()] = [];
      }

      for (const user of users) {
        (
          dockerSwarmClusterOwnersMap[
            dockerSwarmClusterId.toString()
          ] as Array<User>
        ).push(user);
      }

      // mark this as notified.
      await DockerSwarmClusterOwnerTeamService.updateOneById({
        id: dockerSwarmClusterOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const dockerSwarmClusterOwnerUsers: Array<DockerSwarmClusterOwnerUser> =
      await DockerSwarmClusterOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          dockerSwarmClusterId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const dockerSwarmClusterOwnerUser of dockerSwarmClusterOwnerUsers) {
      const dockerSwarmClusterId: ObjectID =
        dockerSwarmClusterOwnerUser.dockerSwarmClusterId!;
      const user: User = dockerSwarmClusterOwnerUser.user!;

      if (
        dockerSwarmClusterOwnersMap[dockerSwarmClusterId.toString()] ===
        undefined
      ) {
        dockerSwarmClusterOwnersMap[dockerSwarmClusterId.toString()] = [];
      }

      (
        dockerSwarmClusterOwnersMap[
          dockerSwarmClusterId.toString()
        ] as Array<User>
      ).push(user);

      // mark this as notified.
      await DockerSwarmClusterOwnerUserService.updateOneById({
        id: dockerSwarmClusterOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const dockerSwarmClusterId in dockerSwarmClusterOwnersMap) {
      if (!dockerSwarmClusterOwnersMap[dockerSwarmClusterId]) {
        continue;
      }

      if (
        (dockerSwarmClusterOwnersMap[dockerSwarmClusterId] as Array<User>)
          .length === 0
      ) {
        continue;
      }

      const users: Array<User> = dockerSwarmClusterOwnersMap[
        dockerSwarmClusterId
      ] as Array<User>;

      const dockerSwarmCluster: DockerSwarmCluster | null =
        await DockerSwarmClusterService.findOneById({
          id: new ObjectID(dockerSwarmClusterId),
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

      if (!dockerSwarmCluster) {
        continue;
      }

      const viewClusterLink: string = (
        await DockerSwarmClusterService.getLinkInDashboard(
          dockerSwarmCluster.projectId!,
          dockerSwarmCluster.id!,
        )
      ).toString();

      const vars: Dictionary<string> = {
        clusterName: dockerSwarmCluster.name!,
        clusterDescription:
          dockerSwarmCluster.description || "No description provided",
        projectName: dockerSwarmCluster.project!.name!,
        viewClusterLink: viewClusterLink,
      };

      for (const user of users) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.DockerSwarmClusterOwnerAdded,
          vars: vars,
          subject: "[Docker Swarm Cluster] Owner of " + dockerSwarmCluster.name,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the Docker Swarm cluster: ${dockerSwarmCluster.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the Docker Swarm cluster: ${dockerSwarmCluster.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as Docker Swarm Cluster Owner",
            body: `You have been added as the owner of the Docker Swarm cluster: ${dockerSwarmCluster.name!}. Click to view details.`,
            clickAction: viewClusterLink,
            tag: "docker-swarm-cluster-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_DOCKER_SWARM_CLUSTER_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              cluster_name: dockerSwarmCluster.name!,
              cluster_link: viewClusterLink,
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: dockerSwarmCluster.projectId!,
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

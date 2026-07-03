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
import DockerHostOwnerTeamService from "Common/Server/Services/DockerHostOwnerTeamService";
import DockerHostOwnerUserService from "Common/Server/Services/DockerHostOwnerUserService";
import DockerHostService from "Common/Server/Services/DockerHostService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import DockerHostOwnerTeam from "Common/Models/DatabaseModels/DockerHostOwnerTeam";
import DockerHostOwnerUser from "Common/Models/DatabaseModels/DockerHostOwnerUser";
import User from "Common/Models/DatabaseModels/User";

RunCron(
  "DockerHostOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const dockerHostOwnerTeams: Array<DockerHostOwnerTeam> =
      await DockerHostOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          dockerHostId: true,
          teamId: true,
        },
      });

    const dockerHostOwnersMap: Dictionary<Array<User>> = {};

    for (const dockerHostOwnerTeam of dockerHostOwnerTeams) {
      const dockerHostId: ObjectID = dockerHostOwnerTeam.dockerHostId!;
      const teamId: ObjectID = dockerHostOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (dockerHostOwnersMap[dockerHostId.toString()] === undefined) {
        dockerHostOwnersMap[dockerHostId.toString()] = [];
      }

      for (const user of users) {
        (dockerHostOwnersMap[dockerHostId.toString()] as Array<User>).push(
          user,
        );
      }

      // mark this as notified.
      await DockerHostOwnerTeamService.updateOneById({
        id: dockerHostOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const dockerHostOwnerUsers: Array<DockerHostOwnerUser> =
      await DockerHostOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          dockerHostId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const dockerHostOwnerUser of dockerHostOwnerUsers) {
      const dockerHostId: ObjectID = dockerHostOwnerUser.dockerHostId!;
      const user: User = dockerHostOwnerUser.user!;

      if (dockerHostOwnersMap[dockerHostId.toString()] === undefined) {
        dockerHostOwnersMap[dockerHostId.toString()] = [];
      }

      (dockerHostOwnersMap[dockerHostId.toString()] as Array<User>).push(user);

      // mark this as notified.
      await DockerHostOwnerUserService.updateOneById({
        id: dockerHostOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const dockerHostId in dockerHostOwnersMap) {
      if (!dockerHostOwnersMap[dockerHostId]) {
        continue;
      }

      if ((dockerHostOwnersMap[dockerHostId] as Array<User>).length === 0) {
        continue;
      }

      const users: Array<User> = dockerHostOwnersMap[
        dockerHostId
      ] as Array<User>;

      const dockerHost: DockerHost | null = await DockerHostService.findOneById(
        {
          id: new ObjectID(dockerHostId),
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
        },
      );

      if (!dockerHost) {
        continue;
      }

      const viewHostLink: string = (
        await DockerHostService.getLinkInDashboard(
          dockerHost.projectId!,
          dockerHost.id!,
        )
      ).toString();

      const vars: Dictionary<string> = {
        hostName: dockerHost.name!,
        hostDescription: dockerHost.description || "No description provided",
        projectName: dockerHost.project!.name!,
        viewHostLink: viewHostLink,
      };

      for (const user of users) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.DockerHostOwnerAdded,
          vars: vars,
          subject: "[Docker Host] Owner of " + dockerHost.name,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the Docker host: ${dockerHost.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the Docker host: ${dockerHost.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as Docker Host Owner",
            body: `You have been added as the owner of the Docker host: ${dockerHost.name!}. Click to view details.`,
            clickAction: viewHostLink,
            tag: "docker-host-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_DOCKER_HOST_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              host_name: dockerHost.name!,
              host_link: viewHostLink,
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: dockerHost.projectId!,
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

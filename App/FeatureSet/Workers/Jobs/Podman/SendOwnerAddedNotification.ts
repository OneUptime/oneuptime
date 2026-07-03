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
import PodmanHostOwnerTeamService from "Common/Server/Services/PodmanHostOwnerTeamService";
import PodmanHostOwnerUserService from "Common/Server/Services/PodmanHostOwnerUserService";
import PodmanHostService from "Common/Server/Services/PodmanHostService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import PodmanHostOwnerTeam from "Common/Models/DatabaseModels/PodmanHostOwnerTeam";
import PodmanHostOwnerUser from "Common/Models/DatabaseModels/PodmanHostOwnerUser";
import User from "Common/Models/DatabaseModels/User";

RunCron(
  "PodmanHostOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const podmanHostOwnerTeams: Array<PodmanHostOwnerTeam> =
      await PodmanHostOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          podmanHostId: true,
          teamId: true,
        },
      });

    const podmanHostOwnersMap: Dictionary<Array<User>> = {};

    for (const podmanHostOwnerTeam of podmanHostOwnerTeams) {
      const podmanHostId: ObjectID = podmanHostOwnerTeam.podmanHostId!;
      const teamId: ObjectID = podmanHostOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (podmanHostOwnersMap[podmanHostId.toString()] === undefined) {
        podmanHostOwnersMap[podmanHostId.toString()] = [];
      }

      for (const user of users) {
        (podmanHostOwnersMap[podmanHostId.toString()] as Array<User>).push(
          user,
        );
      }

      // mark this as notified.
      await PodmanHostOwnerTeamService.updateOneById({
        id: podmanHostOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const podmanHostOwnerUsers: Array<PodmanHostOwnerUser> =
      await PodmanHostOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          podmanHostId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const podmanHostOwnerUser of podmanHostOwnerUsers) {
      const podmanHostId: ObjectID = podmanHostOwnerUser.podmanHostId!;
      const user: User = podmanHostOwnerUser.user!;

      if (podmanHostOwnersMap[podmanHostId.toString()] === undefined) {
        podmanHostOwnersMap[podmanHostId.toString()] = [];
      }

      (podmanHostOwnersMap[podmanHostId.toString()] as Array<User>).push(user);

      // mark this as notified.
      await PodmanHostOwnerUserService.updateOneById({
        id: podmanHostOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const podmanHostId in podmanHostOwnersMap) {
      if (!podmanHostOwnersMap[podmanHostId]) {
        continue;
      }

      if ((podmanHostOwnersMap[podmanHostId] as Array<User>).length === 0) {
        continue;
      }

      const users: Array<User> = podmanHostOwnersMap[
        podmanHostId
      ] as Array<User>;

      const podmanHost: PodmanHost | null = await PodmanHostService.findOneById(
        {
          id: new ObjectID(podmanHostId),
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

      if (!podmanHost) {
        continue;
      }

      const viewHostLink: string = (
        await PodmanHostService.getLinkInDashboard(
          podmanHost.projectId!,
          podmanHost.id!,
        )
      ).toString();

      const vars: Dictionary<string> = {
        hostName: podmanHost.name!,
        hostDescription: podmanHost.description || "No description provided",
        projectName: podmanHost.project!.name!,
        viewHostLink: viewHostLink,
      };

      for (const user of users) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.PodmanHostOwnerAdded,
          vars: vars,
          subject: "[Podman Host] Owner of " + podmanHost.name,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the Podman host: ${podmanHost.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the Podman host: ${podmanHost.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as Podman Host Owner",
            body: `You have been added as the owner of the Podman host: ${podmanHost.name!}. Click to view details.`,
            clickAction: viewHostLink,
            tag: "podman-host-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_PODMAN_HOST_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              host_name: podmanHost.name!,
              host_link: viewHostLink,
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: podmanHost.projectId!,
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

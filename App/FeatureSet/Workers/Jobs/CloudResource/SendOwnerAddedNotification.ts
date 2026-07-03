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
import CloudResourceOwnerTeamService from "Common/Server/Services/CloudResourceOwnerTeamService";
import CloudResourceOwnerUserService from "Common/Server/Services/CloudResourceOwnerUserService";
import CloudResourceService from "Common/Server/Services/CloudResourceService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import CloudResourceOwnerTeam from "Common/Models/DatabaseModels/CloudResourceOwnerTeam";
import CloudResourceOwnerUser from "Common/Models/DatabaseModels/CloudResourceOwnerUser";
import User from "Common/Models/DatabaseModels/User";

RunCron(
  "CloudResourceOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const cloudResourceOwnerTeams: Array<CloudResourceOwnerTeam> =
      await CloudResourceOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          cloudResourceId: true,
          teamId: true,
        },
      });

    const cloudResourceOwnersMap: Dictionary<Array<User>> = {};

    for (const cloudResourceOwnerTeam of cloudResourceOwnerTeams) {
      const cloudResourceId: ObjectID = cloudResourceOwnerTeam.cloudResourceId!;
      const teamId: ObjectID = cloudResourceOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (cloudResourceOwnersMap[cloudResourceId.toString()] === undefined) {
        cloudResourceOwnersMap[cloudResourceId.toString()] = [];
      }

      for (const user of users) {
        (
          cloudResourceOwnersMap[cloudResourceId.toString()] as Array<User>
        ).push(user);
      }

      // mark this as notified.
      await CloudResourceOwnerTeamService.updateOneById({
        id: cloudResourceOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const cloudResourceOwnerUsers: Array<CloudResourceOwnerUser> =
      await CloudResourceOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          cloudResourceId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const cloudResourceOwnerUser of cloudResourceOwnerUsers) {
      const cloudResourceId: ObjectID = cloudResourceOwnerUser.cloudResourceId!;
      const user: User = cloudResourceOwnerUser.user!;

      if (cloudResourceOwnersMap[cloudResourceId.toString()] === undefined) {
        cloudResourceOwnersMap[cloudResourceId.toString()] = [];
      }

      (cloudResourceOwnersMap[cloudResourceId.toString()] as Array<User>).push(
        user,
      );

      // mark this as notified.
      await CloudResourceOwnerUserService.updateOneById({
        id: cloudResourceOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const cloudResourceId in cloudResourceOwnersMap) {
      if (!cloudResourceOwnersMap[cloudResourceId]) {
        continue;
      }

      if (
        (cloudResourceOwnersMap[cloudResourceId] as Array<User>).length === 0
      ) {
        continue;
      }

      const users: Array<User> = cloudResourceOwnersMap[
        cloudResourceId
      ] as Array<User>;

      const cloudResource: CloudResource | null =
        await CloudResourceService.findOneById({
          id: new ObjectID(cloudResourceId),
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

      if (!cloudResource) {
        continue;
      }

      const viewResourceLink: string = (
        await CloudResourceService.getLinkInDashboard(
          cloudResource.projectId!,
          cloudResource.id!,
        )
      ).toString();

      const vars: Dictionary<string> = {
        resourceName: cloudResource.name!,
        resourceDescription:
          cloudResource.description || "No description provided",
        projectName: cloudResource.project!.name!,
        viewResourceLink: viewResourceLink,
      };

      for (const user of users) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.CloudResourceOwnerAdded,
          vars: vars,
          subject: "[Cloud Resource] Owner of " + cloudResource.name,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the cloud resource: ${cloudResource.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the cloud resource: ${cloudResource.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as Cloud Resource Owner",
            body: `You have been added as the owner of the cloud resource: ${cloudResource.name!}. Click to view details.`,
            clickAction: viewResourceLink,
            tag: "cloud-resource-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_CLOUD_RESOURCE_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              resource_name: cloudResource.name!,
              resource_link: viewResourceLink,
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: cloudResource.projectId!,
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

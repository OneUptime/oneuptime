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
import RunbookOwnerTeamService from "Common/Server/Services/RunbookOwnerTeamService";
import RunbookOwnerUserService from "Common/Server/Services/RunbookOwnerUserService";
import RunbookService from "Common/Server/Services/RunbookService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import RunbookOwnerTeam from "Common/Models/DatabaseModels/RunbookOwnerTeam";
import RunbookOwnerUser from "Common/Models/DatabaseModels/RunbookOwnerUser";
import User from "Common/Models/DatabaseModels/User";

RunCron(
  "RunbookOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const runbookOwnerTeams: Array<RunbookOwnerTeam> =
      await RunbookOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          runbookId: true,
          teamId: true,
        },
      });

    const runbookOwnersMap: Dictionary<Array<User>> = {};

    for (const runbookOwnerTeam of runbookOwnerTeams) {
      const runbookId: ObjectID = runbookOwnerTeam.runbookId!;
      const teamId: ObjectID = runbookOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (runbookOwnersMap[runbookId.toString()] === undefined) {
        runbookOwnersMap[runbookId.toString()] = [];
      }

      for (const user of users) {
        (runbookOwnersMap[runbookId.toString()] as Array<User>).push(user);
      }

      // mark this as notified.
      await RunbookOwnerTeamService.updateOneById({
        id: runbookOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const runbookOwnerUsers: Array<RunbookOwnerUser> =
      await RunbookOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          runbookId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const runbookOwnerUser of runbookOwnerUsers) {
      const runbookId: ObjectID = runbookOwnerUser.runbookId!;
      const user: User = runbookOwnerUser.user!;

      if (runbookOwnersMap[runbookId.toString()] === undefined) {
        runbookOwnersMap[runbookId.toString()] = [];
      }

      (runbookOwnersMap[runbookId.toString()] as Array<User>).push(user);

      // mark this as notified.
      await RunbookOwnerUserService.updateOneById({
        id: runbookOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const runbookId in runbookOwnersMap) {
      if (!runbookOwnersMap[runbookId]) {
        continue;
      }

      if ((runbookOwnersMap[runbookId] as Array<User>).length === 0) {
        continue;
      }

      const users: Array<User> = runbookOwnersMap[runbookId] as Array<User>;

      const runbook: Runbook | null = await RunbookService.findOneById({
        id: new ObjectID(runbookId),
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

      if (!runbook) {
        continue;
      }

      const viewRunbookLink: string = (
        await RunbookService.getLinkInDashboard(runbook.projectId!, runbook.id!)
      ).toString();

      const vars: Dictionary<string> = {
        runbookName: runbook.name!,
        runbookDescription: runbook.description || "No description provided",
        projectName: runbook.project!.name!,
        viewRunbookLink: viewRunbookLink,
      };

      for (const user of users) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.RunbookOwnerAdded,
          vars: vars,
          subject: "[Runbook] Owner of " + runbook.name,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the runbook: ${runbook.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the runbook: ${runbook.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as Runbook Owner",
            body: `You have been added as the owner of the runbook: ${runbook.name!}. Click to view details.`,
            clickAction: viewRunbookLink,
            tag: "runbook-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_RUNBOOK_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              runbook_name: runbook.name!,
              runbook_link: viewRunbookLink,
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: runbook.projectId!,
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

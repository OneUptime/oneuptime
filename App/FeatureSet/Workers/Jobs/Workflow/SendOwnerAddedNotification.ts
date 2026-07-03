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
import WorkflowOwnerTeamService from "Common/Server/Services/WorkflowOwnerTeamService";
import WorkflowOwnerUserService from "Common/Server/Services/WorkflowOwnerUserService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowOwnerTeam from "Common/Models/DatabaseModels/WorkflowOwnerTeam";
import WorkflowOwnerUser from "Common/Models/DatabaseModels/WorkflowOwnerUser";
import User from "Common/Models/DatabaseModels/User";

RunCron(
  "WorkflowOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const workflowOwnerTeams: Array<WorkflowOwnerTeam> =
      await WorkflowOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          workflowId: true,
          teamId: true,
        },
      });

    const workflowOwnersMap: Dictionary<Array<User>> = {};

    for (const workflowOwnerTeam of workflowOwnerTeams) {
      const workflowId: ObjectID = workflowOwnerTeam.workflowId!;
      const teamId: ObjectID = workflowOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (workflowOwnersMap[workflowId.toString()] === undefined) {
        workflowOwnersMap[workflowId.toString()] = [];
      }

      for (const user of users) {
        (workflowOwnersMap[workflowId.toString()] as Array<User>).push(user);
      }

      // mark this as notified.
      await WorkflowOwnerTeamService.updateOneById({
        id: workflowOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const workflowOwnerUsers: Array<WorkflowOwnerUser> =
      await WorkflowOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          workflowId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const workflowOwnerUser of workflowOwnerUsers) {
      const workflowId: ObjectID = workflowOwnerUser.workflowId!;
      const user: User = workflowOwnerUser.user!;

      if (workflowOwnersMap[workflowId.toString()] === undefined) {
        workflowOwnersMap[workflowId.toString()] = [];
      }

      (workflowOwnersMap[workflowId.toString()] as Array<User>).push(user);

      // mark this as notified.
      await WorkflowOwnerUserService.updateOneById({
        id: workflowOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const workflowId in workflowOwnersMap) {
      if (!workflowOwnersMap[workflowId]) {
        continue;
      }

      if ((workflowOwnersMap[workflowId] as Array<User>).length === 0) {
        continue;
      }

      const users: Array<User> = workflowOwnersMap[workflowId] as Array<User>;

      const workflow: Workflow | null = await WorkflowService.findOneById({
        id: new ObjectID(workflowId),
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

      if (!workflow) {
        continue;
      }

      const viewWorkflowLink: string = (
        await WorkflowService.getLinkInDashboard(
          workflow.projectId!,
          workflow.id!,
        )
      ).toString();

      const vars: Dictionary<string> = {
        workflowName: workflow.name!,
        workflowDescription: workflow.description || "No description provided",
        projectName: workflow.project!.name!,
        viewWorkflowLink: viewWorkflowLink,
      };

      for (const user of users) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.WorkflowOwnerAdded,
          vars: vars,
          subject: "[Workflow] Owner of " + workflow.name,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the workflow: ${workflow.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the workflow: ${workflow.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as Workflow Owner",
            body: `You have been added as the owner of the workflow: ${workflow.name!}. Click to view details.`,
            clickAction: viewWorkflowLink,
            tag: "workflow-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_WORKFLOW_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              workflow_name: workflow.name!,
              workflow_link: viewWorkflowLink,
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: workflow.projectId!,
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

import RunCron from "../../Utils/Cron";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ProjectService from "Common/Server/Services/ProjectService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import User from "Common/Models/DatabaseModels/User";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

const STATUS_PAGE_OWNER_BATCH_SIZE: number = 100;

RunCron(
  "StatusPageOwner:SendCreatedResourceEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // get all scheduled events of all the projects.
    const statusPages: Array<StatusPage> = await StatusPageService.findAllBy({
      query: {
        isOwnerNotifiedOfResourceCreation: false,
      },
      props: {
        isRoot: true,
      },
      skip: 0,
      select: {
        _id: true,
        name: true,
        description: true,
        projectId: true,
        project: {
          name: true,
        },
      },
      batchSize: STATUS_PAGE_OWNER_BATCH_SIZE,
    });

    for (const statusPage of statusPages) {
      await StatusPageService.updateOneById({
        id: statusPage.id!,
        data: {
          isOwnerNotifiedOfResourceCreation: true,
        },
        props: {
          isRoot: true,
        },
      });

      // now find owners.

      let doesResourceHasOwners: boolean = true;

      let owners: Array<User> = await StatusPageService.findOwners(
        statusPage.id!,
      );

      if (owners.length === 0) {
        doesResourceHasOwners = false;

        // find project owners.
        owners = await ProjectService.getOwners(statusPage.projectId!);
      }

      if (owners.length === 0) {
        continue;
      }

      const vars: Dictionary<string> = {
        statusPageName: statusPage.name!,
        projectName: statusPage.project!.name!,
        statusPageDescription: await Markdown.convertToHTML(
          statusPage.description! || "",
          MarkdownContentType.Email,
        ),
        statusPageViewLink: (
          await StatusPageService.getStatusPageLinkInDashboard(
            statusPage.projectId!,
            statusPage.id!,
          )
        ).toString(),
      };

      if (doesResourceHasOwners === true) {
        vars["isOwner"] = "true";
      }

      for (const user of owners) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.StatusPageOwnerResourceCreated,
          vars: vars,
          subject: "[Status Page Created]" + statusPage.name!,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. New status page created - ${statusPage.name}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime.  New status page created ${statusPage.name}.  To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Status Page Created",
            body: `New status page created: ${statusPage.name}. Click to view details.`,
            clickAction: (
              await StatusPageService.getStatusPageLinkInDashboard(
                statusPage.projectId!,
                statusPage.id!,
              )
            ).toString(),
            tag: "status-page-created",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_STATUS_PAGE_CREATED_OWNER_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              status_page_name: statusPage.name!,
              status_page_link: vars["statusPageViewLink"] || "",
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: statusPage.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          whatsAppMessage,
          statusPageId: statusPage.id!,
          eventType,
        });
      }
    }
  },
);

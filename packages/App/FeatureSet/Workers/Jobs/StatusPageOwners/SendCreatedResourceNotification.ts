import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "../../Utils/Cron";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import StatusPageService from "Common/Server/Services/StatusPageService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import Select from "Common/Server/Types/Database/Select";
import logger from "Common/Server/Utils/Logger";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";

// What a status page is read with.
const STATUS_PAGE_SELECT: Select<StatusPage> = {
  _id: true,
  name: true,
  description: true,
  projectId: true,
  project: {
    name: true,
  },
};

RunCron(
  "StatusPageOwner:SendCreatedResourceEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.StatusPageCreated],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const statusPage: StatusPage | null =
          await StatusPageService.findOneById({
            id: delivery.notification.resourceId,
            select: STATUS_PAGE_SELECT,
            props: {
              isRoot: true,
            },
          });

        if (!statusPage) {
          await delivery.giveUp("the status page is gone");
          return;
        }

        await notifyOwnersOfStatusPageCreated(statusPage, delivery);
      },
    });

    // get all scheduled events of all the projects.
    const statusPages: Array<StatusPage> = await StatusPageService.findAllBy({
      query: {
        isOwnerNotifiedOfResourceCreation: false,
      },
      props: {
        isRoot: true,
      },
      skip: 0,
      select: STATUS_PAGE_SELECT,
    });

    for (const statusPage of statusPages) {
      /*
       * Whom it is to tell - its owners, or the project's when it has none -
       * written before the take: a worker stopped from here on leaves them to
       * be told by a later run, and one stopped before the take leaves the
       * status page to be read again.
       */
      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.planForOwnersOf({
          notification: {
            kind: OwnerNotificationKind.StatusPageCreated,
            projectId: statusPage.projectId!,
            resourceId: statusPage.id!,
            eventId: statusPage.id!,
          },
          findOwners: () => {
            return StatusPageService.findOwners(statusPage.id!);
          },
          writesFeedItem: false,
        });

      await StatusPageService.updateOneById({
        id: statusPage.id!,
        data: {
          isOwnerNotifiedOfResourceCreation: true,
        },
        props: {
          isRoot: true,
        },
      });

      try {
        await notifyOwnersOfStatusPageCreated(statusPage, delivery);
      } catch (e) {
        logger.error("Error in sending status page created notification", {
          projectId: statusPage.projectId?.toString(),
          statusPageId: statusPage.id?.toString(),
        });
        logger.error(e, {
          projectId: statusPage.projectId?.toString(),
          statusPageId: statusPage.id?.toString(),
        });
      }
    }
  },
);

/*
 * Tells the delivery's owners that the status page was created, each once
 * (OwnerNotificationDelivery.tell).
 */
async function notifyOwnersOfStatusPageCreated(
  statusPage: StatusPage,
  delivery: OwnerNotificationDelivery,
): Promise<void> {
  if (!delivery.hasWorkToDo) {
    return;
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

  if (!delivery.isProjectOwners) {
    vars["isOwner"] = "true";
  }

  for (const user of delivery.owners) {
    await delivery.tell(user, async (): Promise<void> => {
      const emailMessage: EmailEnvelope = {
        templateType: EmailTemplateType.StatusPageOwnerResourceCreated,
        vars: vars,
        subject: "[Created Status Page] " + statusPage.name!,
        isSubjectLiteral: true,
      };

      const sms: SMSMessage = {
        message: buildNotificationSms(
          `New status page created - ${statusPage.name}.`,
        ),
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
    });
  }
}

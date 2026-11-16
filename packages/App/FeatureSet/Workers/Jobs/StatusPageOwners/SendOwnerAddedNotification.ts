import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "../../Utils/Cron";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import Select from "Common/Server/Types/Database/Select";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import StatusPageOwnerTeamService from "Common/Server/Services/StatusPageOwnerTeamService";
import StatusPageOwnerUserService from "Common/Server/Services/StatusPageOwnerUserService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import { ownersToTell, tellOwnersAdded } from "../../Utils/OwnersAdded";

// What the statusPage the owners were added to is read with.
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
  "StatusPageOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, from the status page as it is now (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.StatusPageOwnerAdded],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const statusPage: StatusPage | null = await readStatusPage(
          delivery.notification.resourceId,
        );

        if (!statusPage) {
          await delivery.giveUp("the status page is gone");
          return;
        }

        await notifyOwnersAdded({
          statusPage: statusPage,
          deliveries: [delivery],
        });
      },
    });

    /*
     * Every record's new owner rows, a page at a time, oldest first: its
     * team rows and user rows told of together, each person once, each row
     * taken by one run alone; the run stops between records at its deadline
     * and the next carries on (OwnersAdded, issue #8862).
     */
    await tellOwnersAdded<StatusPage>({
      jobName: "StatusPageOwner:SendOwnerAddedEmail",
      kind: OwnerNotificationKind.StatusPageOwnerAdded,
      recordIdColumn: "statusPageId",
      teamService: StatusPageOwnerTeamService,
      userService: StatusPageOwnerUserService,
      recordService: StatusPageService,
      recordSelect: STATUS_PAGE_SELECT,
      deadline: deadline,
      tell: async (
        record: StatusPage,
        deliveries: Array<OwnerNotificationDelivery>,
      ): Promise<void> => {
        await notifyOwnersAdded({
          statusPage: record,
          deliveries: deliveries,
        });
      },
    });
  },
);

async function readStatusPage(
  statusPageId: ObjectID,
): Promise<StatusPage | null> {
  return await StatusPageService.findOneById({
    id: statusPageId,
    props: {
      isRoot: true,
    },
    select: STATUS_PAGE_SELECT,
  });
}

/*
 * Tells each delivery's owners that they were added as owners of the
 * status page, each once (OwnerNotificationDelivery.tell).
 */
async function notifyOwnersAdded(data: {
  statusPage: StatusPage;
  deliveries: Array<OwnerNotificationDelivery>;
}): Promise<void> {
  const statusPage: StatusPage = data.statusPage;

  if (ownersToTell(data.deliveries).length === 0) {
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

  for (const delivery of data.deliveries) {
    for (const user of delivery.owners) {
      await delivery.tell(user, async (): Promise<void> => {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.StatusPageOwnerAdded,
          vars: vars,
          subject: "You have been added as the owner of the status page.",
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `You have been added as the owner of the status page. Status Page Name: ${statusPage.name}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the status page. Status Page ${statusPage.name}.  To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as Status Page Owner",
            body: `You have been added as the owner of the status page: ${statusPage.name}. Click to view details.`,
            clickAction: (
              await StatusPageService.getStatusPageLinkInDashboard(
                statusPage.projectId!,
                statusPage.id!,
              )
            ).toString(),
            tag: "status-page-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_STATUS_PAGE_OWNER_ADDED_NOTIFICATION;

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
}

import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "../../Utils/Cron";
import OwnerNotificationBacklog, {
  OwnerNotificationPage,
} from "../../Utils/OwnerNotificationBacklog";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ProjectService from "Common/Server/Services/ProjectService";
import StatusPageAnnouncementService from "Common/Server/Services/StatusPageAnnouncementService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
// (no direct sends here; we will pass context through notification settings)
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import User from "Common/Models/DatabaseModels/User";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import Select from "Common/Server/Types/Database/Select";
import logger from "Common/Server/Utils/Logger";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";

// What an announcement is read with.
const ANNOUNCEMENT_SELECT: Select<StatusPageAnnouncement> = {
  _id: true,
  title: true,
  description: true,
  projectId: true,
  statusPages: {
    _id: true,
    name: true,
    projectId: true,
  },
};

/*
 * Whom an announcement tells, and of which of its status pages: each owner
 * of each page, or the project's owners for a page that has none. An owner
 * of several of its pages is told once, of the first.
 */
interface AnnouncementRecipient {
  user: User;
  statusPage: StatusPage;
  // Told as an owner of the page, not in its place as one of the project's.
  isOwner: boolean;
}

RunCron(
  "StatusPageOwner:SendAnnouncementCreatedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.StatusPageAnnouncementCreated],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const announcement: StatusPageAnnouncement | null =
          await StatusPageAnnouncementService.findOneById({
            id: delivery.notification.eventId,
            select: ANNOUNCEMENT_SELECT,
            props: {
              isRoot: true,
            },
          });

        if (!announcement) {
          await delivery.giveUp("the announcement is gone");
          return;
        }

        await notifyOwnersOfAnnouncement({
          announcement: announcement,
          recipients: await readRecipients(announcement),
          delivery: delivery,
        });
      },
    });

    /*
     * Every announcement whose owners have not been told of it, a page at a
     * time, oldest first, each taken by one run alone and told by the run
     * that took it; the run stops at its deadline and the next carries on
     * (OwnerNotificationBacklog, issue #8862).
     */
    await OwnerNotificationBacklog.forEachToNotify<StatusPageAnnouncement>({
      jobName: "StatusPageOwner:SendAnnouncementCreatedEmail",
      service: StatusPageAnnouncementService,
      notYetNotified: {
        isOwnerNotified: false,
      },
      notified: {
        isOwnerNotified: true,
      },
      select: ANNOUNCEMENT_SELECT,
      deadline: deadline,
      notify: async (input: {
        record: StatusPageAnnouncement;
        page: OwnerNotificationPage;
        take: () => Promise<boolean>;
      }): Promise<void> => {
        const announcement: StatusPageAnnouncement = input.record;
        /*
         * Whom it is to tell, written before the take: a worker stopped from
         * here on leaves them to be told by a later run, and one stopped before
         * the take leaves the announcement to be read again. A failure to read
         * them tells nobody, as it did when it came after the take.
         */
        let recipients: Array<AnnouncementRecipient> = [];

        try {
          recipients = await readRecipients(announcement, input.page);
        } catch (e) {
          logger.error("Error in reading the owners of an announcement", {
            projectId: announcement.projectId?.toString(),
            statusPageAnnouncementId: announcement.id?.toString(),
          });
          logger.error(e);
        }

        const delivery: OwnerNotificationDelivery =
          await OwnerNotificationDeliveries.plan({
            notification: {
              kind: OwnerNotificationKind.StatusPageAnnouncementCreated,
              projectId: announcement.projectId!,
              resourceId: announcement.id!,
              eventId: announcement.id!,
            },
            owners: recipients.map((recipient: AnnouncementRecipient): User => {
              return recipient.user;
            }),
            isProjectOwners:
              recipients.length > 0 &&
              recipients.every((recipient: AnnouncementRecipient): boolean => {
                return !recipient.isOwner;
              }),
            writesFeedItem: false,
          });

        /*
         * Taken - marked notified, by one hook-free compare-and-set - before
         * its owners are told, so one whose notification keeps failing is
         * never read again on every run. Taken by another run first: that run
         * tells them.
         */
        if (!(await input.take())) {
          return;
        }

        try {
          await notifyOwnersOfAnnouncement({
            announcement: announcement,
            recipients: recipients,
            delivery: delivery,
          });
        } catch (e) {
          logger.error("Error in sending announcement created notification", {
            projectId: announcement.projectId?.toString(),
            statusPageAnnouncementId: announcement.id?.toString(),
          });
          logger.error(e, {
            projectId: announcement.projectId?.toString(),
            statusPageAnnouncementId: announcement.id?.toString(),
          });
        }
      },
    });
  },
);

/*
 * Each owner of each of the announcement's status pages - or the project's
 * owners for a page that has none - with the first of its pages they are
 * told of.
 */
async function readRecipients(
  announcement: StatusPageAnnouncement,
  // Each page's owners, and the project's, read once for a page of them.
  page?: OwnerNotificationPage | undefined,
): Promise<Array<AnnouncementRecipient>> {
  const recipients: Array<AnnouncementRecipient> = [];
  const seen: Set<string> = new Set<string>();

  const once: (
    key: string,
    read: () => Promise<Array<User>>,
  ) => Promise<Array<User>> = (
    key: string,
    read: () => Promise<Array<User>>,
  ): Promise<Array<User>> => {
    return page ? page.once(key, read) : read();
  };

  for (const statusPage of announcement.statusPages || []) {
    let isOwner: boolean = true;

    let owners: Array<User> = await once(
      `owners:${statusPage.id!.toString()}`,
      (): Promise<Array<User>> => {
        return StatusPageService.findOwners(statusPage.id!);
      },
    );

    if (owners.length === 0) {
      isOwner = false;

      // find project owners.
      owners = await once(
        `projectOwners:${announcement.projectId!.toString()}`,
        (): Promise<Array<User>> => {
          return ProjectService.getOwners(announcement.projectId!);
        },
      );
    }

    for (const user of owners) {
      const userId: string = user.id?.toString() || "";

      if (!userId || seen.has(userId)) {
        continue;
      }

      seen.add(userId);
      recipients.push({ user: user, statusPage: statusPage, isOwner: isOwner });
    }
  }

  return recipients;
}

/*
 * Tells the delivery's owners that the announcement was posted on their
 * status page, each once (OwnerNotificationDelivery.tell).
 */
async function notifyOwnersOfAnnouncement(data: {
  announcement: StatusPageAnnouncement;
  recipients: Array<AnnouncementRecipient>;
  delivery: OwnerNotificationDelivery;
}): Promise<void> {
  const announcement: StatusPageAnnouncement = data.announcement;
  const delivery: OwnerNotificationDelivery = data.delivery;

  if (!delivery.hasWorkToDo) {
    return;
  }

  const statusPages: Array<StatusPage> = announcement.statusPages || [];

  for (const user of delivery.owners) {
    /*
     * The page they are told of. One no longer among the announcement's
     * pages' owners since the run that wrote them down is told of its first.
     */
    const recipient: AnnouncementRecipient | undefined = data.recipients.find(
      (each: AnnouncementRecipient): boolean => {
        return each.user.id?.toString() === user.id?.toString();
      },
    );

    const statusPage: StatusPage | undefined =
      recipient?.statusPage || statusPages[0];

    if (!statusPage) {
      continue;
    }

    await delivery.tell(user, async (): Promise<void> => {
      const vars: Dictionary<string> = {
        statusPageName: statusPage.name!,
        announcementTitle: announcement.title!,
        announcementDescription: await Markdown.convertToHTML(
          announcement.description!,
          MarkdownContentType.Email,
        ),
      };

      if (recipient ? recipient.isOwner : !delivery.isProjectOwners) {
        vars["isOwner"] = "true";
      }

      const emailMessage: EmailEnvelope = {
        templateType: EmailTemplateType.StatusPageOwnerAnnouncementPosted,
        vars: vars,
        subject: `[Announcement] ${announcement.title!}`,
        isSubjectLiteral: true,
      };

      const sms: SMSMessage = {
        message: buildNotificationSms(
          `New announcement posted on Status Page ${statusPage.name} - ${announcement.title}.`,
        ),
      };

      const callMessage: CallRequestMessage = {
        data: [
          {
            sayMessage: `This is a message from OneUptime.  New announcement posted on Status Page ${statusPage.name}, ${announcement.title}.  To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
          },
        ],
      };

      const statusPageLink: string = (
        await StatusPageService.getStatusPageLinkInDashboard(
          announcement.projectId!,
          statusPage.id!,
        )
      ).toString();

      const pushMessage: PushNotificationMessage =
        PushNotificationUtil.createGenericNotification({
          title: "Status Page Announcement Created",
          body: `New announcement posted on status page ${statusPage.name}: ${announcement.title}. Click to view details.`,
          clickAction: statusPageLink,
          tag: "status-page-announcement-created",
          requireInteraction: false,
        });

      const eventType: NotificationSettingEventType =
        NotificationSettingEventType.SEND_STATUS_PAGE_ANNOUNCEMENT_CREATED_OWNER_NOTIFICATION;

      const whatsAppMessage: WhatsAppMessagePayload =
        createWhatsAppMessageFromTemplate({
          eventType,
          templateVariables: {
            status_page_name: statusPage.name!,
            announcement_title: announcement.title!,
            status_page_link: statusPageLink || "",
          },
        });

      // Send notifications via settings service with context for logs
      await UserNotificationSettingService.sendUserNotification({
        userId: user.id!,
        projectId: announcement.projectId!,
        emailEnvelope: emailMessage,
        smsMessage: sms,
        whatsAppMessage,
        callRequestMessage: callMessage,
        pushNotificationMessage: pushMessage,
        eventType,
        statusPageAnnouncementId: announcement.id!,
      } as any);
    });
  }
}

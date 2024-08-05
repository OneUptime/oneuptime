import RunCron from "../../Utils/Cron";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import { SMSMessage } from "Common/Types/SMS/SMS";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ProjectService from "CommonServer/Services/ProjectService";
import StatusPageAnnouncementService from "CommonServer/Services/StatusPageAnnouncementService";
import StatusPageService from "CommonServer/Services/StatusPageService";
import UserNotificationSettingService from "CommonServer/Services/UserNotificationSettingService";
import Markdown, { MarkdownContentType } from "CommonServer/Types/Markdown";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import User from "Common/Models/DatabaseModels/User";

RunCron(
  "StatusPageOwner:SendAnnouncementCreatedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const announcements: Array<StatusPageAnnouncement> =
      await StatusPageAnnouncementService.findBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        select: {
          _id: true,
          title: true,
          description: true,
          projectId: true,
          statusPages: {
            _id: true,
            name: true,
          },
        },
      });

    for (const announcement of announcements) {
      await StatusPageAnnouncementService.updateOneById({
        id: announcement.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });

      const statusPages: Array<StatusPage> = announcement.statusPages || [];

      for (const statusPage of statusPages) {
        // now find owners.

        let doesResourceHasOwners: boolean = true;

        let owners: Array<User> = await StatusPageService.findOwners(
          statusPage.id!,
        );

        if (owners.length === 0) {
          doesResourceHasOwners = false;

          // find project owners.
          owners = await ProjectService.getOwners(announcement.projectId!);
        }

        if (owners.length === 0) {
          continue;
        }

        const vars: Dictionary<string> = {
          statusPageName: statusPage.name!,
          announcementTitle: announcement.title!,
          announcementDescription: await Markdown.convertToHTML(
            announcement.description!,
            MarkdownContentType.Email,
          ),
        };

        if (doesResourceHasOwners === true) {
          vars["isOwner"] = "true";
        }

        for (const user of owners) {
          const emailMessage: EmailEnvelope = {
            templateType: EmailTemplateType.StatusPageOwnerAnnouncementPosted,
            vars: vars,
            subject: `[Announcement] ${announcement.title!}`,
          };

          const sms: SMSMessage = {
            message: `This is a message from OneUptime. New announcement posted on Status Page ${statusPage.name} - ${announcement.title}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
          };

          const callMessage: CallRequestMessage = {
            data: [
              {
                sayMessage: `This is a message from OneUptime.  New announcement posted on Status Page ${statusPage.name}, ${announcement.title}.  To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
              },
            ],
          };

          await UserNotificationSettingService.sendUserNotification({
            userId: user.id!,
            projectId: announcement.projectId!,
            emailEnvelope: emailMessage,
            smsMessage: sms,
            callRequestMessage: callMessage,
            eventType:
              NotificationSettingEventType.SEND_STATUS_PAGE_ANNOUNCEMENT_CREATED_OWNER_NOTIFICATION,
          });
        }
      }
    }
  },
);

import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
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
import StatusPageOwnerTeamService from "Common/Server/Services/StatusPageOwnerTeamService";
import StatusPageOwnerUserService from "Common/Server/Services/StatusPageOwnerUserService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageOwnerTeam from "Common/Models/DatabaseModels/StatusPageOwnerTeam";
import StatusPageOwnerUser from "Common/Models/DatabaseModels/StatusPageOwnerUser";
import User from "Common/Models/DatabaseModels/User";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import logger from "Common/Server/Utils/Logger";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import {
  OwnerRowAdded,
  ownersToTell,
  planOwnersAdded,
} from "../../Utils/OwnersAdded";

RunCron(
  "StatusPageOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
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

    const statusPageOwnerTeams: Array<StatusPageOwnerTeam> =
      await StatusPageOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          statusPageId: true,
          teamId: true,
        },
      });

    const statusPageOwnersMap: Dictionary<Array<OwnerRowAdded>> = {};

    for (const statusPageOwnerTeam of statusPageOwnerTeams) {
      const statusPageId: ObjectID = statusPageOwnerTeam.statusPageId!;
      const teamId: ObjectID = statusPageOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (statusPageOwnersMap[statusPageId.toString()] === undefined) {
        statusPageOwnersMap[statusPageId.toString()] = [];
      }

      (
        statusPageOwnersMap[statusPageId.toString()] as Array<OwnerRowAdded>
      ).push({
        ownerRowId: statusPageOwnerTeam.id!,
        isTeam: true,
        users: users,
      });
    }

    const statusPageOwnerUsers: Array<StatusPageOwnerUser> =
      await StatusPageOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          statusPageId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const statusPageOwnerUser of statusPageOwnerUsers) {
      const statusPageId: ObjectID = statusPageOwnerUser.statusPageId!;
      const user: User = statusPageOwnerUser.user!;

      if (statusPageOwnersMap[statusPageId.toString()] === undefined) {
        statusPageOwnersMap[statusPageId.toString()] = [];
      }

      (
        statusPageOwnersMap[statusPageId.toString()] as Array<OwnerRowAdded>
      ).push({
        ownerRowId: statusPageOwnerUser.id!,
        isTeam: false,
        users: [user],
      });
    }

    // send email to all of these users.

    for (const statusPageId in statusPageOwnersMap) {
      const ownerRows: Array<OwnerRowAdded> =
        statusPageOwnersMap[statusPageId] || [];

      if (ownerRows.length === 0) {
        continue;
      }

      const statusPage: StatusPage | null = await readStatusPage(
        new ObjectID(statusPageId),
      );

      /*
       * Whom each owner row is to tell, written before the rows are taken:
       * a worker stopped from here on leaves them to be told by a later
       * run, and one stopped before the take leaves the rows to be read
       * again.
       */
      const deliveries: Array<OwnerNotificationDelivery> = statusPage
        ? await planOwnersAdded({
            kind: OwnerNotificationKind.StatusPageOwnerAdded,
            projectId: statusPage.projectId!,
            resourceId: statusPage.id!,
            ownerRows: ownerRows,
          })
        : [];

      /*
       * Marked as notified before the owners are told, so an owner row
       * whose notification keeps failing is never read again on every run -
       * one whose status page is gone too.
       */
      for (const ownerRow of ownerRows) {
        if (ownerRow.isTeam) {
          await StatusPageOwnerTeamService.updateOneById({
            id: ownerRow.ownerRowId,
            data: {
              isOwnerNotified: true,
            },
            props: {
              isRoot: true,
            },
          });
        } else {
          await StatusPageOwnerUserService.updateOneById({
            id: ownerRow.ownerRowId,
            data: {
              isOwnerNotified: true,
            },
            props: {
              isRoot: true,
            },
          });
        }
      }

      if (!statusPage) {
        continue;
      }

      try {
        await notifyOwnersAdded({
          statusPage: statusPage,
          deliveries: deliveries,
        });
      } catch (e) {
        logger.error("Error in sending status page owner added notification", {
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

async function readStatusPage(
  statusPageId: ObjectID,
): Promise<StatusPage | null> {
  return await StatusPageService.findOneById({
    id: statusPageId,
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

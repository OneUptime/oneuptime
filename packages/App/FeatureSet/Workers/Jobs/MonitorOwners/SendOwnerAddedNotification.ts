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
import MonitorOwnerTeamService from "Common/Server/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "Common/Server/Services/MonitorOwnerUserService";
import MonitorService, {
  MonitorDestinationInfo,
} from "Common/Server/Services/MonitorService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorOwnerTeam from "Common/Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "Common/Models/DatabaseModels/MonitorOwnerUser";
import User from "Common/Models/DatabaseModels/User";
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
  "MonitorOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, from the monitor as it is now (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.MonitorOwnerAdded],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const monitor: Monitor | null = await readMonitor(
          delivery.notification.resourceId,
        );

        if (!monitor) {
          await delivery.giveUp("the monitor is gone");
          return;
        }

        await notifyOwnersAdded({
          monitor: monitor,
          deliveries: [delivery],
        });
      },
    });

    const monitorOwnerTeams: Array<MonitorOwnerTeam> =
      await MonitorOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          monitorId: true,
          teamId: true,
        },
      });

    const monitorOwnersMap: Dictionary<Array<OwnerRowAdded>> = {};

    for (const monitorOwnerTeam of monitorOwnerTeams) {
      const monitorId: ObjectID = monitorOwnerTeam.monitorId!;
      const teamId: ObjectID = monitorOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (monitorOwnersMap[monitorId.toString()] === undefined) {
        monitorOwnersMap[monitorId.toString()] = [];
      }

      (monitorOwnersMap[monitorId.toString()] as Array<OwnerRowAdded>).push({
        ownerRowId: monitorOwnerTeam.id!,
        isTeam: true,
        users: users,
      });
    }

    const monitorOwnerUsers: Array<MonitorOwnerUser> =
      await MonitorOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          monitorId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const monitorOwnerUser of monitorOwnerUsers) {
      const monitorId: ObjectID = monitorOwnerUser.monitorId!;
      const user: User = monitorOwnerUser.user!;

      if (monitorOwnersMap[monitorId.toString()] === undefined) {
        monitorOwnersMap[monitorId.toString()] = [];
      }

      (monitorOwnersMap[monitorId.toString()] as Array<OwnerRowAdded>).push({
        ownerRowId: monitorOwnerUser.id!,
        isTeam: false,
        users: [user],
      });
    }

    // send email to all of these users.

    for (const monitorId in monitorOwnersMap) {
      const ownerRows: Array<OwnerRowAdded> = monitorOwnersMap[monitorId] || [];

      if (ownerRows.length === 0) {
        continue;
      }

      const monitor: Monitor | null = await readMonitor(
        new ObjectID(monitorId),
      );

      /*
       * Whom each owner row is to tell, written before the rows are taken:
       * a worker stopped from here on leaves them to be told by a later
       * run, and one stopped before the take leaves the rows to be read
       * again.
       */
      const deliveries: Array<OwnerNotificationDelivery> = monitor
        ? await planOwnersAdded({
            kind: OwnerNotificationKind.MonitorOwnerAdded,
            projectId: monitor.projectId!,
            resourceId: monitor.id!,
            ownerRows: ownerRows,
          })
        : [];

      /*
       * Marked as notified before the owners are told, so an owner row
       * whose notification keeps failing is never read again on every run -
       * one whose monitor is gone too.
       */
      for (const ownerRow of ownerRows) {
        if (ownerRow.isTeam) {
          await MonitorOwnerTeamService.updateOneById({
            id: ownerRow.ownerRowId,
            data: {
              isOwnerNotified: true,
            },
            props: {
              isRoot: true,
            },
          });
        } else {
          await MonitorOwnerUserService.updateOneById({
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

      if (!monitor) {
        continue;
      }

      try {
        await notifyOwnersAdded({
          monitor: monitor,
          deliveries: deliveries,
        });
      } catch (e) {
        logger.error("Error in sending monitor owner added notification", {
          projectId: monitor.projectId?.toString(),
          monitorId: monitor.id?.toString(),
        });
        logger.error(e, {
          projectId: monitor.projectId?.toString(),
          monitorId: monitor.id?.toString(),
        });
      }
    }
  },
);

async function readMonitor(monitorId: ObjectID): Promise<Monitor | null> {
  return await MonitorService.findOneById({
    id: monitorId,
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
      currentMonitorStatus: {
        name: true,
        color: true,
      },
      monitorType: true,
      monitorSteps: true,
    },
  });
}

/*
 * Tells each delivery's owners that they were added as owners of the
 * monitor, each once (OwnerNotificationDelivery.tell).
 */
async function notifyOwnersAdded(data: {
  monitor: Monitor;
  deliveries: Array<OwnerNotificationDelivery>;
}): Promise<void> {
  const monitor: Monitor = data.monitor;

  if (ownersToTell(data.deliveries).length === 0) {
    return;
  }

  // Get monitor destination info using the helper function
  const destinationInfo: MonitorDestinationInfo =
    MonitorService.getMonitorDestinationInfo(monitor);

  const vars: Dictionary<string> = {
    monitorName: monitor.name!,
    projectName: monitor.project!.name!,
    currentStatus: monitor.currentMonitorStatus!.name!,
    ...EmailColorUtil.getTemplateVariables(
      "currentStatus",
      monitor.currentMonitorStatus?.color,
    ),
    monitorDescription: await Markdown.convertToHTML(
      monitor.description! || "",
      MarkdownContentType.Email,
    ),
    monitorViewLink: (
      await MonitorService.getMonitorLinkInDashboard(
        monitor.projectId!,
        monitor.id!,
      )
    ).toString(),
    monitorDestination: destinationInfo.monitorDestination,
    requestType: destinationInfo.requestType,
    monitorType: destinationInfo.monitorType,
  };

  for (const delivery of data.deliveries) {
    for (const user of delivery.owners) {
      await delivery.tell(user, async (): Promise<void> => {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.MonitorOwnerAdded,
          vars: vars,
          subject: "You have been added as the owner of the monitor.",
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `You have been added as the owner of the monitor - ${monitor.name}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the monitor ${monitor.name}.  To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as Monitor Owner",
            body: `You have been added as the owner of the monitor: ${monitor.name}. Click to view details.`,
            clickAction: (
              await MonitorService.getMonitorLinkInDashboard(
                monitor.projectId!,
                monitor.id!,
              )
            ).toString(),
            tag: "monitor-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_MONITOR_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              monitor_name: monitor.name!,
              monitor_link: vars["monitorViewLink"] || "",
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: monitor.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          whatsAppMessage,
          eventType,
          monitorId: monitor.id!,
        });
      });
    }
  }
}

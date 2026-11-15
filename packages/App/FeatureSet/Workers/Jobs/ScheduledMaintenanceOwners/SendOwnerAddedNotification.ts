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
import ScheduledMaintenanceOwnerTeamService from "Common/Server/Services/ScheduledMaintenanceOwnerTeamService";
import ScheduledMaintenanceOwnerUserService from "Common/Server/Services/ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceOwnerTeam from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerTeam";
import ScheduledMaintenanceOwnerUser from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerUser";
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
  "ScheduledMaintenanceOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, from the scheduled maintenance event as it is now (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.ScheduledMaintenanceOwnerAdded],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const scheduledMaintenance: ScheduledMaintenance | null =
          await readScheduledMaintenance(delivery.notification.resourceId);

        if (!scheduledMaintenance) {
          await delivery.giveUp("the scheduled maintenance event is gone");
          return;
        }

        await notifyOwnersAdded({
          scheduledMaintenance: scheduledMaintenance,
          deliveries: [delivery],
        });
      },
    });

    const scheduledMaintenanceOwnerTeams: Array<ScheduledMaintenanceOwnerTeam> =
      await ScheduledMaintenanceOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          scheduledMaintenanceId: true,
          teamId: true,
        },
      });

    const scheduledMaintenanceOwnersMap: Dictionary<Array<OwnerRowAdded>> = {};

    for (const scheduledMaintenanceOwnerTeam of scheduledMaintenanceOwnerTeams) {
      const scheduledMaintenanceId: ObjectID =
        scheduledMaintenanceOwnerTeam.scheduledMaintenanceId!;
      const teamId: ObjectID = scheduledMaintenanceOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (
        scheduledMaintenanceOwnersMap[scheduledMaintenanceId.toString()] ===
        undefined
      ) {
        scheduledMaintenanceOwnersMap[scheduledMaintenanceId.toString()] = [];
      }

      (
        scheduledMaintenanceOwnersMap[
          scheduledMaintenanceId.toString()
        ] as Array<OwnerRowAdded>
      ).push({
        ownerRowId: scheduledMaintenanceOwnerTeam.id!,
        isTeam: true,
        users: users,
      });
    }

    const scheduledMaintenanceOwnerUsers: Array<ScheduledMaintenanceOwnerUser> =
      await ScheduledMaintenanceOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          scheduledMaintenanceId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const scheduledMaintenanceOwnerUser of scheduledMaintenanceOwnerUsers) {
      const scheduledMaintenanceId: ObjectID =
        scheduledMaintenanceOwnerUser.scheduledMaintenanceId!;
      const user: User = scheduledMaintenanceOwnerUser.user!;

      if (
        scheduledMaintenanceOwnersMap[scheduledMaintenanceId.toString()] ===
        undefined
      ) {
        scheduledMaintenanceOwnersMap[scheduledMaintenanceId.toString()] = [];
      }

      (
        scheduledMaintenanceOwnersMap[
          scheduledMaintenanceId.toString()
        ] as Array<OwnerRowAdded>
      ).push({
        ownerRowId: scheduledMaintenanceOwnerUser.id!,
        isTeam: false,
        users: [user],
      });
    }

    // send email to all of these users.

    for (const scheduledMaintenanceId in scheduledMaintenanceOwnersMap) {
      const ownerRows: Array<OwnerRowAdded> =
        scheduledMaintenanceOwnersMap[scheduledMaintenanceId] || [];

      if (ownerRows.length === 0) {
        continue;
      }

      const scheduledMaintenance: ScheduledMaintenance | null =
        await readScheduledMaintenance(new ObjectID(scheduledMaintenanceId));

      /*
       * Whom each owner row is to tell, written before the rows are taken:
       * a worker stopped from here on leaves them to be told by a later
       * run, and one stopped before the take leaves the rows to be read
       * again.
       */
      const deliveries: Array<OwnerNotificationDelivery> = scheduledMaintenance
        ? await planOwnersAdded({
            kind: OwnerNotificationKind.ScheduledMaintenanceOwnerAdded,
            projectId: scheduledMaintenance.projectId!,
            resourceId: scheduledMaintenance.id!,
            ownerRows: ownerRows,
          })
        : [];

      /*
       * Marked as notified before the owners are told, so an owner row
       * whose notification keeps failing is never read again on every run -
       * one whose scheduled maintenance event is gone too.
       */
      for (const ownerRow of ownerRows) {
        if (ownerRow.isTeam) {
          await ScheduledMaintenanceOwnerTeamService.updateOneById({
            id: ownerRow.ownerRowId,
            data: {
              isOwnerNotified: true,
            },
            props: {
              isRoot: true,
            },
          });
        } else {
          await ScheduledMaintenanceOwnerUserService.updateOneById({
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

      if (!scheduledMaintenance) {
        continue;
      }

      try {
        await notifyOwnersAdded({
          scheduledMaintenance: scheduledMaintenance,
          deliveries: deliveries,
        });
      } catch (e) {
        logger.error(
          "Error in sending scheduled maintenance event owner added notification",
          {
            projectId: scheduledMaintenance.projectId?.toString(),
            scheduledMaintenanceId: scheduledMaintenance.id?.toString(),
          },
        );
        logger.error(e, {
          projectId: scheduledMaintenance.projectId?.toString(),
          scheduledMaintenanceId: scheduledMaintenance.id?.toString(),
        });
      }
    }
  },
);

async function readScheduledMaintenance(
  scheduledMaintenanceId: ObjectID,
): Promise<ScheduledMaintenance | null> {
  return await ScheduledMaintenanceService.findOneById({
    id: scheduledMaintenanceId,
    props: {
      isRoot: true,
    },
    select: {
      _id: true,
      title: true,
      description: true,
      projectId: true,
      project: {
        name: true,
      },
      currentScheduledMaintenanceState: {
        name: true,
        color: true,
      },
      scheduledMaintenanceNumber: true,
      scheduledMaintenanceNumberWithPrefix: true,
    },
  });
}

/*
 * Tells each delivery's owners that they were added as owners of the
 * scheduled maintenance event, each once (OwnerNotificationDelivery.tell).
 */
async function notifyOwnersAdded(data: {
  scheduledMaintenance: ScheduledMaintenance;
  deliveries: Array<OwnerNotificationDelivery>;
}): Promise<void> {
  const scheduledMaintenance: ScheduledMaintenance = data.scheduledMaintenance;

  if (ownersToTell(data.deliveries).length === 0) {
    return;
  }

  const scheduledMaintenanceNumber: string =
    scheduledMaintenance.scheduledMaintenanceNumberWithPrefix ||
    (scheduledMaintenance.scheduledMaintenanceNumber
      ? `#${scheduledMaintenance.scheduledMaintenanceNumber}`
      : "");

  const vars: Dictionary<string> = {
    scheduledMaintenanceTitle: scheduledMaintenance.title!,
    scheduledMaintenanceNumber: scheduledMaintenanceNumber,
    projectName: scheduledMaintenance.project!.name!,
    currentState: scheduledMaintenance.currentScheduledMaintenanceState!.name!,
    ...EmailColorUtil.getTemplateVariables(
      "currentState",
      scheduledMaintenance.currentScheduledMaintenanceState?.color,
    ),
    scheduledMaintenanceDescription: await Markdown.convertToHTML(
      scheduledMaintenance.description! || "",
      MarkdownContentType.Email,
    ),
    scheduledMaintenanceViewLink: (
      await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
        scheduledMaintenance.projectId!,
        scheduledMaintenance.id!,
      )
    ).toString(),
  };

  for (const delivery of data.deliveries) {
    for (const user of delivery.owners) {
      await delivery.tell(user, async (): Promise<void> => {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.ScheduledMaintenanceOwnerAdded,
          vars: vars,
          subject: `You have been added as the owner of Scheduled Maintenance ${scheduledMaintenanceNumber} - ${scheduledMaintenance.title}`,
          isSubjectLiteral: true,
        };

        const scheduledMaintenanceIdentifier: string =
          scheduledMaintenance.scheduledMaintenanceNumber !== undefined
            ? `${scheduledMaintenanceNumber} (${scheduledMaintenance.title})`
            : scheduledMaintenance.title!;

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `You have been added as the owner of the maintenance event - ${scheduledMaintenanceIdentifier}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the maintenance event ${scheduledMaintenanceIdentifier}. To view this event, go to OneUptime Dashboard. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: `Added as Scheduled Maintenance ${scheduledMaintenanceNumber} Owner`,
            body: `You have been added as the owner of the maintenance event: ${scheduledMaintenanceIdentifier}. Click to view details.`,
            clickAction: (
              await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
                scheduledMaintenance.projectId!,
                scheduledMaintenance.id!,
              )
            ).toString(),
            tag: "scheduled-maintenance-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              event_title: scheduledMaintenance.title!,
              maintenance_link: vars["scheduledMaintenanceViewLink"] || "",
              event_number:
                scheduledMaintenance.scheduledMaintenanceNumberWithPrefix ||
                (scheduledMaintenance.scheduledMaintenanceNumber?.toString() ??
                  "N/A"),
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: scheduledMaintenance.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          whatsAppMessage,
          scheduledMaintenanceId: scheduledMaintenance.id!,
          eventType,
        });
      });
    }
  }
}

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
import AlertOwnerTeamService from "Common/Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "Common/Server/Services/AlertOwnerUserService";
import AlertService from "Common/Server/Services/AlertService";
import LinkedAffectedResources from "Common/Server/Utils/AffectedResources/LinkedAffectedResources";
import SeriesLabelDisplay from "Common/Types/Monitor/SeriesContext/SeriesLabelDisplay";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertOwnerTeam from "Common/Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "Common/Models/DatabaseModels/AlertOwnerUser";
import User from "Common/Models/DatabaseModels/User";
import Select from "Common/Server/Types/Database/Select";
import logger from "Common/Server/Utils/Logger";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";

// What the alert the owners were added to is read with.
const ALERT_SELECT: Select<Alert> = {
  _id: true,
  title: true,
  description: true,
  projectId: true,
  project: {
    name: true,
  },
  currentAlertState: {
    name: true,
    color: true,
  },
  alertSeverity: {
    name: true,
    color: true,
  },
  /*
   * The series a grouped monitor raised this alert for, named in the
   * monitor's place under Resources Affected, as the created email does.
   */
  seriesLabels: true,
  alertNumber: true,
  alertNumberWithPrefix: true,
};

// An owner row not told of yet, and the people it made owners.
interface OwnerRowAdded {
  ownerRowId: ObjectID;
  isTeam: boolean;
  users: Array<User>;
}

RunCron(
  "AlertOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8199) - told first, exactly
     * them, from the alert as it is now (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.AlertOwnerAdded],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const alert: Alert | null = await readAlert(
          delivery.notification.resourceId,
        );

        if (!alert) {
          await delivery.giveUp("the alert is gone");
          return;
        }

        await notifyOwnersAdded({
          alert: alert,
          deliveries: [delivery],
        });
      },
    });

    const alertOwnerTeams: Array<AlertOwnerTeam> =
      await AlertOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          alertId: true,
          teamId: true,
        },
      });

    const alertOwnersMap: Dictionary<Array<OwnerRowAdded>> = {};

    for (const alertOwnerTeam of alertOwnerTeams) {
      const alertId: ObjectID = alertOwnerTeam.alertId!;
      const teamId: ObjectID = alertOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (alertOwnersMap[alertId.toString()] === undefined) {
        alertOwnersMap[alertId.toString()] = [];
      }

      (alertOwnersMap[alertId.toString()] as Array<OwnerRowAdded>).push({
        ownerRowId: alertOwnerTeam.id!,
        isTeam: true,
        users: users,
      });
    }

    const alertOwnerUsers: Array<AlertOwnerUser> =
      await AlertOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          alertId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const alertOwnerUser of alertOwnerUsers) {
      const alertId: ObjectID = alertOwnerUser.alertId!;
      const user: User = alertOwnerUser.user!;

      if (alertOwnersMap[alertId.toString()] === undefined) {
        alertOwnersMap[alertId.toString()] = [];
      }

      (alertOwnersMap[alertId.toString()] as Array<OwnerRowAdded>).push({
        ownerRowId: alertOwnerUser.id!,
        isTeam: false,
        users: [user],
      });
    }

    // send email to all of these users.

    for (const alertId in alertOwnersMap) {
      const ownerRows: Array<OwnerRowAdded> = alertOwnersMap[alertId] || [];

      if (ownerRows.length === 0) {
        continue;
      }

      // get all scheduled events of all the projects.
      const alert: Alert | null = await readAlert(new ObjectID(alertId));

      /*
       * Whom each owner row is to tell, written before the rows are taken:
       * a worker stopped from here on leaves them to be told by a later
       * run, and one stopped before the take leaves the rows to be read
       * again.
       */
      const deliveries: Array<OwnerNotificationDelivery> = alert
        ? await planOwnersAdded({ alert: alert, ownerRows: ownerRows })
        : [];

      /*
       * Marked as notified before the owners are told, so an owner row
       * whose notification keeps failing is never read again on every run -
       * one whose alert is gone too.
       */
      for (const ownerRow of ownerRows) {
        if (ownerRow.isTeam) {
          await AlertOwnerTeamService.updateOneById({
            id: ownerRow.ownerRowId,
            data: {
              isOwnerNotified: true,
            },
            props: {
              isRoot: true,
            },
          });
        } else {
          await AlertOwnerUserService.updateOneById({
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

      if (!alert) {
        continue;
      }

      try {
        await notifyOwnersAdded({
          alert: alert,
          deliveries: deliveries,
        });
      } catch (e) {
        logger.error("Error in sending alert owner added notification", {
          projectId: alert.projectId?.toString(),
          alertId: alert.id?.toString(),
        });
        logger.error(e, {
          projectId: alert.projectId?.toString(),
          alertId: alert.id?.toString(),
        });
      }
    }
  },
);

async function readAlert(alertId: ObjectID): Promise<Alert | null> {
  return await AlertService.findOneById({
    id: alertId,
    props: {
      isRoot: true,
    },
    select: ALERT_SELECT,
  });
}

/*
 * Whom each owner row tells it made them an owner of the alert, written
 * down before the rows are taken (OwnerNotificationDeliveries.plan): the
 * accepted members of the project among the people it names, each person
 * once for the alert - by the first row that names them - however many of
 * its new rows do. A failure to read them tells nobody, as it did when it
 * came after the take.
 */
async function planOwnersAdded(data: {
  alert: Alert;
  ownerRows: Array<OwnerRowAdded>;
}): Promise<Array<OwnerNotificationDelivery>> {
  let members: Set<string> = new Set<string>();

  try {
    /*
     * A team row expands to every member row, pending invitations included,
     * and a pending invitee has no notification settings yet (the defaults
     * are added on accept). Tell only the accepted members of the project -
     * the same people findOwners reports as owners.
     */
    const users: Array<User> =
      await TeamMemberService.filterUsersToProjectMembers({
        projectId: data.alert.projectId!,
        users: data.ownerRows.flatMap((ownerRow: OwnerRowAdded) => {
          return ownerRow.users;
        }),
      });

    members = new Set<string>(
      users.map((user: User): string => {
        return user.id?.toString() || "";
      }),
    );
  } catch (e) {
    logger.error("Error in reading the owners added to an alert", {
      projectId: data.alert.projectId?.toString(),
      alertId: data.alert.id?.toString(),
    });
    logger.error(e);
  }

  const deliveries: Array<OwnerNotificationDelivery> = [];
  const planned: Set<string> = new Set<string>();

  for (const ownerRow of data.ownerRows) {
    const owners: Array<User> = ownerRow.users.filter((user: User): boolean => {
      const userId: string = user?.id?.toString() || "";

      if (!userId || !members.has(userId) || planned.has(userId)) {
        return false;
      }

      planned.add(userId);
      return true;
    });

    if (owners.length === 0) {
      continue;
    }

    deliveries.push(
      await OwnerNotificationDeliveries.plan({
        notification: {
          kind: OwnerNotificationKind.AlertOwnerAdded,
          projectId: data.alert.projectId!,
          resourceId: data.alert.id!,
          eventId: ownerRow.ownerRowId,
        },
        owners: owners,
        isProjectOwners: false,
        writesFeedItem: false,
      }),
    );
  }

  return deliveries;
}

/*
 * Tells each delivery's owners that they were added as owners of the
 * alert, each once (OwnerNotificationDelivery.tell).
 */
async function notifyOwnersAdded(data: {
  alert: Alert;
  deliveries: Array<OwnerNotificationDelivery>;
}): Promise<void> {
  const alert: Alert = data.alert;

  const users: Array<User> = data.deliveries.flatMap(
    (delivery: OwnerNotificationDelivery) => {
      return delivery.owners;
    },
  );

  if (users.length === 0) {
    return;
  }

  const alertNumber: string =
    alert.alertNumberWithPrefix ||
    (alert.alertNumber ? `#${alert.alertNumber}` : "");

  const vars: Dictionary<string> = {
    alertTitle: alert.title!,
    alertNumber: alertNumber,
    projectName: alert.project!.name!,
    currentState: alert.currentAlertState!.name!,
    ...EmailColorUtil.getTemplateVariables(
      "currentState",
      alert.currentAlertState?.color,
    ),
    alertDescription: await Markdown.convertToHTML(
      alert.description! || "",
      MarkdownContentType.Email,
    ),
    // Every resource the alert's Affected Resources card lists.
    resourcesAffected: LinkedAffectedResources.getText({
      resources: await LinkedAffectedResources.readForAlert({
        service: AlertService,
        projectId: alert.projectId!,
        alertId: alert.id!,
      }),
      seriesSummary: SeriesLabelDisplay.buildInlineSummary(alert.seriesLabels),
      fallback: "None",
    }),
    alertSeverity: alert.alertSeverity!.name!,
    ...EmailColorUtil.getTemplateVariables(
      "alertSeverity",
      alert.alertSeverity?.color,
    ),
    alertViewLink: (
      await AlertService.getAlertLinkInDashboard(alert.projectId!, alert.id!)
    ).toString(),
  };

  for (const delivery of data.deliveries) {
    for (const user of delivery.owners) {
      await delivery.tell(user, async (): Promise<void> => {
        const alertIdentifier: string =
          alert.alertNumber !== undefined
            ? `${alert.alertNumberWithPrefix || "#" + alert.alertNumber} (${alert.title})`
            : alert.title!;

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.AlertOwnerAdded,
          vars: vars,
          subject: `You have been added as the owner of Alert ${alertNumber} - ${alert.title}`,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `You have been added as the owner of the alert ${alertIdentifier}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the alert ${alertIdentifier}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as Alert Owner",
            body: `You have been added as the owner of the alert ${alertIdentifier}. Click to view details.`,
            clickAction: (
              await AlertService.getAlertLinkInDashboard(
                alert.projectId!,
                alert.id!,
              )
            ).toString(),
            tag: "alert-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_ALERT_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              alert_title: alert.title!,
              alert_link: vars["alertViewLink"] || "",
              alert_number:
                alert.alertNumber !== undefined
                  ? alert.alertNumber.toString()
                  : "",
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: alert.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          whatsAppMessage,
          alertId: alert.id!,
          eventType,
        });
      });
    }
  }
}

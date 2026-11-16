import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "../../Utils/Cron";
import { tellOwnersAdded } from "../../Utils/OwnersAdded";
import JobDeadline from "Common/Server/Utils/JobDeadline";
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
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import Alert from "Common/Models/DatabaseModels/Alert";
import User from "Common/Models/DatabaseModels/User";
import Select from "Common/Server/Types/Database/Select";
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

RunCron(
  "AlertOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
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

    /*
     * Every record's new owner rows, a page at a time, oldest first: its
     * team rows and user rows told of together, each person once, each row
     * taken by one run alone; the run stops between records at its deadline
     * and the next carries on (OwnersAdded, issue #8862).
     */
    await tellOwnersAdded<Alert>({
      jobName: "AlertOwner:SendOwnerAddedEmail",
      kind: OwnerNotificationKind.AlertOwnerAdded,
      recordIdColumn: "alertId",
      teamService: AlertOwnerTeamService,
      userService: AlertOwnerUserService,
      recordService: AlertService,
      recordSelect: ALERT_SELECT,
      deadline: deadline,
      tell: async (
        record: Alert,
        deliveries: Array<OwnerNotificationDelivery>,
      ): Promise<void> => {
        await notifyOwnersAdded({
          alert: record,
          deliveries: deliveries,
        });
      },
    });
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

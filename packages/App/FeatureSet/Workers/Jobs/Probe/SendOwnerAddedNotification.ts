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
import ProbeOwnerTeamService from "Common/Server/Services/ProbeOwnerTeamService";
import ProbeOwnerUserService from "Common/Server/Services/ProbeOwnerUserService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import Probe from "Common/Models/DatabaseModels/Probe";
import ProbeService from "Common/Server/Services/ProbeService";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import { ownersToTell, tellOwnersAdded } from "../../Utils/OwnersAdded";

// What the probe the owners were added to is read with.
const PROBE_SELECT: Select<Probe> = {
  _id: true,
  name: true,
  description: true,
  projectId: true,
  project: {
    name: true,
  },
};

RunCron(
  "ProbeOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, from the probe as it is now (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.ProbeOwnerAdded],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const probe: Probe | null = await readProbe(
          delivery.notification.resourceId,
        );

        if (!probe) {
          await delivery.giveUp("the probe is gone");
          return;
        }

        await notifyOwnersAdded({
          probe: probe,
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
    await tellOwnersAdded<Probe>({
      jobName: "ProbeOwner:SendOwnerAddedEmail",
      kind: OwnerNotificationKind.ProbeOwnerAdded,
      recordIdColumn: "probeId",
      teamService: ProbeOwnerTeamService,
      userService: ProbeOwnerUserService,
      recordService: ProbeService,
      recordSelect: PROBE_SELECT,
      deadline: deadline,
      tell: async (
        record: Probe,
        deliveries: Array<OwnerNotificationDelivery>,
      ): Promise<void> => {
        await notifyOwnersAdded({
          probe: record,
          deliveries: deliveries,
        });
      },
    });
  },
);

async function readProbe(probeId: ObjectID): Promise<Probe | null> {
  return await ProbeService.findOneById({
    id: probeId,
    props: {
      isRoot: true,
    },
    select: PROBE_SELECT,
  });
}

/*
 * Tells each delivery's owners that they were added as owners of the
 * probe, each once (OwnerNotificationDelivery.tell).
 */
async function notifyOwnersAdded(data: {
  probe: Probe;
  deliveries: Array<OwnerNotificationDelivery>;
}): Promise<void> {
  const probe: Probe = data.probe;

  if (ownersToTell(data.deliveries).length === 0) {
    return;
  }

  const vars: Dictionary<string> = {
    probeName: probe.name!,
    probeDescription: probe.description || "No description provided",
    projectName: probe.project!.name!,
    viewProbeLink: (
      await ProbeService.getLinkInDashboard(probe.projectId!, probe.id!)
    ).toString(),
  };

  for (const delivery of data.deliveries) {
    for (const user of delivery.owners) {
      await delivery.tell(user, async (): Promise<void> => {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.ProbeOwnerAdded,
          vars: vars,
          subject: "[Probe] Owner of " + probe.name,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `You have been added as the owner of the probe: ${probe.name!}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the probe: ${probe.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as Probe Owner",
            body: `You have been added as the owner of the probe: ${probe.name!}. Click to view details.`,
            clickAction: (
              await ProbeService.getLinkInDashboard(probe.projectId!, probe.id!)
            ).toString(),
            tag: "probe-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_PROBE_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              probe_name: probe.name!,
              probe_link: vars["viewProbeLink"] || "",
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: probe.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          whatsAppMessage,
          eventType,
        });
      });
    }
  }
}

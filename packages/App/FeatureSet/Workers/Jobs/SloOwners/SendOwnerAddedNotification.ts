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
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import { SMSMessage } from "Common/Types/SMS/SMS";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ServiceLevelObjectiveOwnerTeamService from "Common/Server/Services/ServiceLevelObjectiveOwnerTeamService";
import ServiceLevelObjectiveOwnerUserService from "Common/Server/Services/ServiceLevelObjectiveOwnerUserService";
import ServiceLevelObjectiveService from "Common/Server/Services/ServiceLevelObjectiveService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";

/**
 * Notifies users who were just added as owners of a Service Level Objective —
 * directly (ServiceLevelObjectiveOwnerUser) or through a team
 * (ServiceLevelObjectiveOwnerTeam). Clones the MonitorOwners job.
 *
 * Ordering discipline (same as every other owner-added job): the
 * isOwnerNotified marker is flipped to TRUE while the owner rows are being
 * collected, i.e. BEFORE anything is sent. A send that fails is therefore
 * dropped rather than retried forever — the alternative (flip after send) turns
 * any persistent failure, e.g. a user with an unroutable channel, into an
 * infinite re-notification loop that re-sends every minute.
 */
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import { ownersToTell, tellOwnersAdded } from "../../Utils/OwnersAdded";

// What the slo the owners were added to is read with.
const SLO_SELECT: Select<ServiceLevelObjective> = {
  _id: true,
  name: true,
  projectId: true,
  project: {
    name: true,
  },
  targetPercentage: true,
  windowType: true,
  windowDays: true,
};

RunCron(
  "SloOwners:SendOwnerAddedNotification",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, from the SLO as it is now (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.ServiceLevelObjectiveOwnerAdded],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const slo: ServiceLevelObjective | null =
          await readServiceLevelObjective(delivery.notification.resourceId);

        if (!slo) {
          await delivery.giveUp("the SLO is gone");
          return;
        }

        await notifyOwnersAdded({
          slo: slo,
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
    await tellOwnersAdded<ServiceLevelObjective>({
      jobName: "SloOwners:SendOwnerAddedNotification",
      kind: OwnerNotificationKind.ServiceLevelObjectiveOwnerAdded,
      recordIdColumn: "serviceLevelObjectiveId",
      teamService: ServiceLevelObjectiveOwnerTeamService,
      userService: ServiceLevelObjectiveOwnerUserService,
      recordService: ServiceLevelObjectiveService,
      recordSelect: SLO_SELECT,
      deadline: deadline,
      tell: async (
        record: ServiceLevelObjective,
        deliveries: Array<OwnerNotificationDelivery>,
      ): Promise<void> => {
        await notifyOwnersAdded({
          slo: record,
          deliveries: deliveries,
        });
      },
    });
  },
);

async function readServiceLevelObjective(
  serviceLevelObjectiveId: ObjectID,
): Promise<ServiceLevelObjective | null> {
  return await ServiceLevelObjectiveService.findOneById({
    id: serviceLevelObjectiveId,
    props: {
      isRoot: true,
    },
    select: SLO_SELECT,
  });
}

/*
 * Tells each delivery's owners that they were added as owners of the
 * SLO, each once (OwnerNotificationDelivery.tell).
 */
async function notifyOwnersAdded(data: {
  slo: ServiceLevelObjective;
  deliveries: Array<OwnerNotificationDelivery>;
}): Promise<void> {
  const slo: ServiceLevelObjective = data.slo;
  const projectId: ObjectID | undefined = slo.projectId;

  if (!projectId || ownersToTell(data.deliveries).length === 0) {
    return;
  }

  const sloName: string = slo.name || "SLO";
  const projectName: string = slo.project?.name || "OneUptime";

  const sloViewLink: string = (
    await ServiceLevelObjectiveService.getSloLinkInDashboard(projectId, slo.id!)
  ).toString();

  /*
   * "99.9% over a rolling 30 days" / "99.9% over the calendar month" —
   * windowDays is meaningless for a CalendarMonth window (the model
   * documents it as ignored), so it is only rendered for Rolling.
   */
  const windowDescription: string =
    slo.windowType === SloWindowType.CalendarMonth
      ? "the calendar month"
      : `a rolling ${slo.windowDays || 30} days`;

  const objectiveDescription: string = slo.targetPercentage
    ? `${slo.targetPercentage}% over ${windowDescription}`
    : `measured over ${windowDescription}`;

  const emailSubject: string =
    "You have been added as the owner of the service level objective.";

  /*
   * SimpleMessage is the generic owner-added email path (the same one the
   * NetworkDeviceOwners job uses): every dedicated *OwnerAdded.hbs template
   * hardcodes its resource's labels and detail fields, so reusing one would
   * mean an email that calls this SLO a monitor. A near-duplicate
   * SloOwnerAdded.hbs would add a template for one sentence of copy.
   */
  const vars: Dictionary<string> = {
    subject: emailSubject,
    message: `You have been added as the owner of the service level objective ${sloName} in the project ${projectName}. Its objective is ${objectiveDescription}. You can view the SLO here: ${sloViewLink}`,
  };

  const eventType: NotificationSettingEventType =
    NotificationSettingEventType.SEND_SLO_OWNER_ADDED_NOTIFICATION;

  for (const delivery of data.deliveries) {
    for (const user of delivery.owners) {
      await delivery.tell(user, async (): Promise<void> => {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.SimpleMessage,
          vars: vars,
          subject: emailSubject,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `You have been added as the owner of the service level objective - ${sloName}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the service level objective ${sloName}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as SLO Owner",
            body: `You have been added as the owner of the service level objective: ${sloName}. Click to view details.`,
            clickAction: sloViewLink,
            tag: "slo-owner-added",
            requireInteraction: false,
          });

        /*
         * A send that fails is the owner's alone: tell() says so and goes
         * on to the next owner, who is told all the same.
         */

        /*
         * SEND_SLO_OWNER_ADDED_NOTIFICATION is newer than most existing
         * users, and sendUserNotification silently no-ops when no setting row
         * exists — seed the default row first so owners added today are
         * actually reached.
         */
        await UserNotificationSettingService.ensureSettingExistsForUser({
          userId: user.id!,
          projectId: projectId,
          eventType: eventType,
        });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: projectId,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          /*
           * No WhatsApp message: WhatsApp delivers only Meta-approved
           * templates and none is approved for an SLO's new owners
           * (Types/WhatsApp/WhatsAppEventTemplates), so none is handed over
           * and the channel is skipped. The plain body it used to hand over
           * was refused, a failed WhatsApp log each time (#9715).
           */
          eventType: eventType,
        });
      });
    }
  }
}

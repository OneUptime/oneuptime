import User from "Common/Models/DatabaseModels/User";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import ServerProducts from "Common/Server/Utils/ServerProducts/ServerProducts";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { SMSMessage } from "Common/Types/SMS/SMS";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";

/*
 * THE "YOU WERE ADDED AS AN OWNER" JOBS OF DATA OBSERVABILITY'S TABLES AND
 * PIPELINES, AND OF THE DATA STORES IT SHARES WITH DATA SECURITY (#9681).
 *
 * An owner rule whose Notify Owners is on writes each owner it adds not
 * notified yet, and so does a person adding an owner on an Owners page, as
 * for every other record. No job read those rows, so nobody was told. Three
 * jobs now tell them as every other record's new owners are told
 * (OwnersAdded): DataAssetOwners, DataPipelineOwners and DataStoreOwners.
 * What they share is here:
 *
 *   - Each waits while every product its owner rows serve is switched off
 *     on the server (ServerProducts.getOffProductOfServerWorkTable): a
 *     table's or a pipeline's while Data Observability is off, a data
 *     store's while Data Observability and Data Security both are. The rows
 *     stay not notified, and are told once the product is on again.
 *   - The events are newer than most members, and sendUserNotification
 *     sends nothing to a person with no setting for one, so each person's
 *     setting is seeded (email on) before the send. A person who switched it
 *     off keeps it off.
 *   - No WhatsApp template is approved for these events, so WhatsApp gets
 *     the text message's body, as the SLO owner job sends it.
 *
 * The owner rows that were already not notified when the jobs came were
 * marked told by a migration (MarkDataOwnersAddedBeforeNotificationsAsTold),
 * so the first run sends no old news.
 */

// Whether a data owner job waits this run: every product of its owner rows is off.
export async function isDataOwnerWorkOff(
  ownerTableName: string,
): Promise<boolean> {
  return Boolean(
    await ServerProducts.getOffProductOfServerWorkTable(ownerTableName),
  );
}

// A table as its page names it: "analytics.orders", or its name alone.
export function getDataTableName(data: {
  name?: string | undefined;
  schemaName?: string | undefined;
}): string {
  const name: string = data.name || "table";

  return data.schemaName ? `${data.schemaName}.${name}` : name;
}

// A pipeline as its page names it: its job's name, else its namespace.
export function getDataPipelineName(data: {
  jobName?: string | undefined;
  jobNamespace?: string | undefined;
}): string {
  return data.jobName || data.jobNamespace || "pipeline";
}

// What a data owner job says about its record, in its words.
export interface DataOwnerAdded {
  // The record, as the sentences name it: "table", "pipeline", "data store".
  noun: string;
  // The record's own name, as its page writes it.
  name: string;
  // Its page in the Dashboard.
  link: string;
  emailTemplateType: EmailTemplateType;
  emailVars: Dictionary<string>;
  // The push notification's title: "Added as Table Owner".
  pushTitle: string;
  pushTag: string;
}

// The sentence every channel says: "You have been added as an owner of the table orders."
export function getDataOwnerAddedSentence(added: DataOwnerAdded): string {
  return `You have been added as an owner of the ${added.noun} ${added.name}`;
}

// Each channel's message, as every owner-added job sends them.
export function buildDataOwnerAddedMessages(added: DataOwnerAdded): {
  emailEnvelope: EmailEnvelope;
  smsMessage: SMSMessage;
  callRequestMessage: CallRequestMessage;
  pushNotificationMessage: PushNotificationMessage;
  whatsAppMessage: WhatsAppMessagePayload;
} {
  const sentence: string = getDataOwnerAddedSentence(added);

  const sms: SMSMessage = {
    message: buildNotificationSms(`${sentence}.`),
  };

  return {
    emailEnvelope: {
      templateType: added.emailTemplateType,
      vars: added.emailVars,
      // The name is the record's own, as written: never read as a template.
      subject: sentence,
      isSubjectLiteral: true,
    },
    smsMessage: sms,
    callRequestMessage: {
      data: [
        {
          sayMessage: `This is a message from OneUptime. ${sentence}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
        },
      ],
    },
    pushNotificationMessage: PushNotificationUtil.createGenericNotification({
      title: added.pushTitle,
      body: `You have been added as an owner of the ${added.noun}: ${added.name}. Click to view details.`,
      clickAction: added.link,
      tag: added.pushTag,
      requireInteraction: false,
    }),
    // No WhatsApp template is approved for these events: the text's body.
    whatsAppMessage: {
      body: sms.message,
    },
  };
}

/*
 * Tells one owner, through their own setting for the event: seeded first,
 * as the event is newer than most members (see the top of this file).
 */
export async function tellDataOwnerAdded(data: {
  user: User;
  projectId: ObjectID;
  eventType: NotificationSettingEventType;
  added: DataOwnerAdded;
}): Promise<void> {
  await UserNotificationSettingService.ensureSettingExistsForUser({
    userId: data.user.id!,
    projectId: data.projectId,
    eventType: data.eventType,
  });

  await UserNotificationSettingService.sendUserNotification({
    userId: data.user.id!,
    projectId: data.projectId,
    eventType: data.eventType,
    ...buildDataOwnerAddedMessages(data.added),
  });
}

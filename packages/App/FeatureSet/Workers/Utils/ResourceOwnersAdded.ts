import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import User from "Common/Models/DatabaseModels/User";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import DatabaseService from "Common/Server/Services/DatabaseService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import Select from "Common/Server/Types/Database/Select";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import ServerProducts from "Common/Server/Utils/ServerProducts/ServerProducts";
import URL from "Common/Types/API/URL";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { SMSMessage } from "Common/Types/SMS/SMS";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "./Cron";
import { ownersToTell, tellOwnersAdded } from "./OwnersAdded";

/*
 * THE "YOU WERE ADDED AS AN OWNER" JOBS OF EVERY RECORD WHOSE NEW OWNERS
 * WERE NEVER TOLD (#9681, #9700).
 *
 * An owner rule whose Notify Owners is on writes each owner it adds not
 * notified yet, and so does a person adding an owner on an Owners page. For
 * services, apps and infrastructure (hosts, clusters, databases, queues,
 * cloud resources and the rest), dashboards, workflows, runbooks, on-call
 * policies, schedules and incoming call policies, no job read those rows,
 * so nobody was told, whatever Notify Owners said. Each now has a job of
 * its own (Workers/Jobs/<Record>Owners/SendOwnerAddedNotification), every
 * one a ResourceOwnerAddedJob run here, on the backlog every owner-added job
 * runs on (OwnersAdded):
 *
 *   - each record's new owner rows, team rows and user rows together, each
 *     person once, each row taken by one run alone, and a worker stopped
 *     part way leaves nobody untold or told twice (OwnerNotificationDeliveries);
 *   - while every product its owner rows serve is switched off on the
 *     server (ServerProducts.getOffProductOfServerWorkTable) the job reads
 *     and sends nothing: the rows stay not notified, and are told once the
 *     product is on again;
 *   - each person is told through their own setting for the job's event,
 *     seeded first (email on): the events are newer than most members, and
 *     sendUserNotification sends nothing to a person with no setting. A
 *     person who switched one off keeps it off;
 *   - the email (ResourceOwnerAdded, named by the kind of record), a text, a
 *     call, a push notification, and Slack, Microsoft Teams, Mattermost and
 *     Telegram messages made from the email's subject and the text. No
 *     WhatsApp message: WhatsApp delivers only Meta-approved templates and
 *     none is approved for these events, so none is handed over and
 *     sendUserNotification skips the channel, as it is written to.
 *
 * The owner rows already waiting when the jobs came were marked told by a
 * migration (MarkOwnersAddedBeforeNotificationsAsTold), so the first run
 * sends no old news. Data Observability's tables, pipelines and data stores
 * have jobs of their own (DataAssetOwners, DataPipelineOwners,
 * DataStoreOwners) that say the same thing in emails of their own, through
 * the messages built here.
 */

// Whether an owner job waits this run: every product of its owner rows is off.
export async function isOwnerWorkOff(ownerTableName: string): Promise<boolean> {
  return Boolean(
    await ServerProducts.getOffProductOfServerWorkTable(ownerTableName),
  );
}

// What an owner-added job says about its record, in its words.
export interface OwnerAddedMessage {
  // The record, as the sentences name it: "host", "Kubernetes cluster".
  noun: string;
  // The record's own name, as its page writes it.
  name: string;
  // Its page in the Dashboard.
  link: string;
  emailTemplateType: EmailTemplateType;
  emailVars: Dictionary<string>;
  // The push notification's title: "Added as Host Owner".
  pushTitle: string;
  pushTag: string;
}

// The sentence every channel says: "You have been added as an owner of the host web-1".
export function getOwnerAddedSentence(added: OwnerAddedMessage): string {
  return `You have been added as an owner of the ${added.noun} ${added.name}`;
}

// Each channel's message, as every owner-added job sends them.
export function buildOwnerAddedMessages(added: OwnerAddedMessage): {
  emailEnvelope: EmailEnvelope;
  smsMessage: SMSMessage;
  callRequestMessage: CallRequestMessage;
  pushNotificationMessage: PushNotificationMessage;
} {
  const sentence: string = getOwnerAddedSentence(added);

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
  };
}

/*
 * Tells one owner, through their own setting for the event: seeded first,
 * as the event is newer than most members (see the top of this file).
 */
export async function tellOwnerAdded(data: {
  user: User;
  projectId: ObjectID;
  eventType: NotificationSettingEventType;
  added: OwnerAddedMessage;
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
    ...buildOwnerAddedMessages(data.added),
  });
}

/*
 * A record's page in the Dashboard, by its path in the project: for a
 * record whose service has no link of its own ("workflows/<id>").
 */
export async function getRecordLinkInDashboard(
  projectId: ObjectID,
  path: string,
): Promise<URL> {
  const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

  return URL.fromString(dashboardUrl.toString()).addRoute(
    `/${projectId.toString()}/${path}`,
  );
}

// What every record these jobs tell of has: a name, a description, a project.
export type OwnedRecord = BaseModel & {
  name?: string | undefined;
  description?: string | undefined;
  projectId?: ObjectID | undefined;
  project?: { name?: string | undefined } | undefined;
};

// What a record is, in a sentence ("Kubernetes cluster") or as a title ("Kubernetes Cluster").
export type RecordWords<TRecord> = string | ((record: TRecord) => string);

// One record's owner-added job: what it reads, how it names it, whom it tells through.
export interface ResourceOwnerAddedJob<TRecord extends OwnedRecord> {
  // The job's name: "HostOwner:SendOwnerAddedNotification".
  jobName: string;
  kind: OwnerNotificationKind;
  // The setting each owner is told through.
  eventType: NotificationSettingEventType;
  /*
   * The owner table whose products it waits for while they are switched
   * off on the server: "HostOwnerUser" (the user and team tables of a
   * record serve the same products).
   */
  ownerTableName: string;
  // The column each owner row names its record by: "hostId".
  recordIdColumn: string;
  teamService: DatabaseService<BaseModel>;
  userService: DatabaseService<BaseModel>;
  recordService: DatabaseService<TRecord>;
  // Columns the record is read with besides its name, description and project.
  recordSelect?: Select<TRecord> | undefined;
  // "host": "You have been added as an owner of the host web-1".
  noun: RecordWords<TRecord>;
  // "Host": the email's title, "Host: web-1", and the push notification's.
  title: RecordWords<TRecord>;
  // The record's page in the Dashboard.
  getLink: (projectId: ObjectID, record: TRecord) => Promise<URL>;
  // What owning it means, closing the email; none when it changes nothing to say.
  ownershipNote?: string | undefined;
}

function wordsOf<TRecord>(
  words: RecordWords<TRecord>,
  record: TRecord,
): string {
  return typeof words === "string" ? words : words(record);
}

// The push notification's tag: "kubernetes-cluster-owner-added".
export function getOwnerAddedPushTag(noun: string): string {
  const words: string = noun
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${words}-owner-added`;
}

// What every record is read with, and what the job adds.
export function getOwnedRecordSelect<TRecord extends OwnedRecord>(
  job: Pick<ResourceOwnerAddedJob<TRecord>, "recordSelect">,
): Select<TRecord> {
  return {
    ...(job.recordSelect || {}),
    _id: true,
    name: true,
    description: true,
    projectId: true,
    project: {
      name: true,
    },
  } as Select<TRecord>;
}

/*
 * Registers one record's owner-added job: every minute, the owners a stopped
 * run left untold first, then every new owner row (see the top of this
 * file).
 */
export function runResourceOwnerAddedJob<TRecord extends OwnedRecord>(
  job: ResourceOwnerAddedJob<TRecord>,
): void {
  const recordSelect: Select<TRecord> = getOwnedRecordSelect(job);

  RunCron(
    job.jobName,
    { schedule: EVERY_MINUTE, runOnStartup: false },
    async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
      if (await isOwnerWorkOff(job.ownerTableName)) {
        return;
      }

      /*
       * The owners a run that stopped part way left untold - a worker killed
       * between the take and the last owner (#8509) - told first, exactly
       * them, from the record as it is now (OwnerNotificationDeliveries).
       */
      await OwnerNotificationDeliveries.resume({
        kinds: [job.kind],
        notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
          const record: TRecord | null = await job.recordService.findOneById({
            id: delivery.notification.resourceId,
            select: recordSelect,
            props: {
              isRoot: true,
            },
          });

          if (!record) {
            await delivery.giveUp(
              `the ${typeof job.noun === "string" ? job.noun : "record"} is gone`,
            );
            return;
          }

          await notifyOwnersAdded({
            job: job,
            record: record,
            deliveries: [delivery],
          });
        },
      });

      /*
       * Every record's new owner rows, a page at a time, oldest first: its
       * team rows and user rows told of together, each person once, each
       * row taken by one run alone; the run stops between records at its
       * deadline and the next carries on (OwnersAdded, issue #8862).
       */
      await tellOwnersAdded<TRecord>({
        jobName: job.jobName,
        kind: job.kind,
        recordIdColumn: job.recordIdColumn,
        teamService: job.teamService,
        userService: job.userService,
        recordService: job.recordService,
        recordSelect: recordSelect,
        deadline: deadline,
        tell: async (
          record: TRecord,
          deliveries: Array<OwnerNotificationDelivery>,
        ): Promise<void> => {
          await notifyOwnersAdded({
            job: job,
            record: record,
            deliveries: deliveries,
          });
        },
      });
    },
  );
}

/*
 * Tells each delivery's owners that they were added as owners of the
 * record, each once (OwnerNotificationDelivery.tell).
 */
async function notifyOwnersAdded<TRecord extends OwnedRecord>(data: {
  job: ResourceOwnerAddedJob<TRecord>;
  record: TRecord;
  deliveries: Array<OwnerNotificationDelivery>;
}): Promise<void> {
  const record: TRecord = data.record;
  const projectId: ObjectID | undefined = record.projectId;

  if (!projectId || ownersToTell(data.deliveries).length === 0) {
    return;
  }

  const noun: string = wordsOf(data.job.noun, record);
  const title: string = wordsOf(data.job.title, record);
  const name: string = record.name || noun;
  const link: string = (await data.job.getLink(projectId, record)).toString();

  const vars: Dictionary<string> = {
    resourceType: title,
    resourceNoun: noun,
    resourceName: name,
    resourceDescription: await Markdown.convertToHTML(
      record.description || "",
      MarkdownContentType.Email,
    ),
    projectName: record.project?.name || "",
    resourceViewLink: link,
  };

  if (data.job.ownershipNote) {
    vars["ownershipNote"] = data.job.ownershipNote;
  }

  const added: OwnerAddedMessage = {
    noun: noun,
    name: name,
    link: link,
    emailTemplateType: EmailTemplateType.ResourceOwnerAdded,
    emailVars: vars,
    pushTitle: `Added as ${title} Owner`,
    pushTag: getOwnerAddedPushTag(noun),
  };

  for (const delivery of data.deliveries) {
    for (const user of delivery.owners) {
      /*
       * A send that fails is the owner's alone: tell() says so and goes on
       * to the next owner, who is told all the same.
       */
      await delivery.tell(user, async (): Promise<void> => {
        await tellOwnerAdded({
          user: user,
          projectId: projectId,
          eventType: data.job.eventType,
          added: added,
        });
      });
    }
  }
}

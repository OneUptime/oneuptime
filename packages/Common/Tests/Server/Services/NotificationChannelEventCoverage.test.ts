import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import IncidentService from "../../../Server/Services/IncidentService";
import AlertService from "../../../Server/Services/AlertService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import MailService from "../../../Server/Services/MailService";
import SmsService from "../../../Server/Services/SmsService";
import CallService from "../../../Server/Services/CallService";
import WhatsAppService from "../../../Server/Services/WhatsAppService";
import TelegramService from "../../../Server/Services/TelegramService";
import WorkspaceUserNotificationService from "../../../Server/Services/WorkspaceUserNotificationService";
import WebhookService from "../../../Server/Services/WebhookService";
import PushNotificationService from "../../../Server/Services/PushNotificationService";
import logger from "../../../Server/Utils/Logger";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import URL from "../../../Types/API/URL";
import Email from "../../../Types/Email";
import Phone from "../../../Types/Phone";
import ObjectID from "../../../Types/ObjectID";
import BadDataException from "../../../Types/Exception/BadDataException";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE SHAPE OF THE BUG THIS FILE EXISTS TO CATCH.
 *
 * `deliverNotificationForRule` is nine independent channel blocks stacked one
 * after another - email, SMS, WhatsApp, Telegram, Slack, Microsoft Teams,
 * webhook, call, push - and each block is itself a stack of
 * `if (eventType === X && entity)` branches, one per UserNotificationEventType
 * (the two workspace channels share one such ladder inside
 * deliverWorkspaceDirectMessageForRule, but each still opens its own gate).
 * That is a 9 x 4 grid written out by hand, thirty six times, with no compiler
 * anywhere insisting the grid is full.
 *
 * It was not full. Gap F: `IncidentEpisodeCreated` was wired into the webhook
 * and push blocks and nowhere else, so a responder whose rule pointed at their
 * email, phone, WhatsApp, Telegram or a voice call was told NOTHING when an
 * incident episode paged them. Not a failed send - no send at all, and no error
 * row either. Every gate the delivery path has (is the method verified? did the
 * entity load? did the send throw?) passed. The page simply evaporated between
 * the last matching `if` and the end of the function, and the on-call log went
 * on believing the human had been contacted and had chosen not to acknowledge.
 *
 * A test that checked "email works" and "SMS works" would not have caught it,
 * because email and SMS did work - for three of the four event types. Only the
 * CARTESIAN PRODUCT catches a hole in a grid. So this file is table-driven on
 * purpose: it builds {nine channels} x {every member of UserNotificationEventType}
 * and asserts every single cell hands a page to its provider and writes a
 * timeline row. Adding a tenth channel or a fifth event type without filling
 * in the new row or column fails here, loudly, in the cell that is missing.
 *
 * Two canaries keep the table honest, because a table that quietly stops
 * covering the thing it is a table OF is worse than no table:
 *   - the event axis is checked against UserNotificationEventType itself, so a
 *     new enum member fails until the matrix is extended;
 *   - the channel axis is checked against getContactableChannelNames, which is
 *     the production code's own answer to "what can we reach this user on".
 *
 * Beyond the grid, three behaviours the grid depends on are pinned:
 *
 *   1. THE FELL-THROUGH GUARD. Phase 1 added a backstop after the channel blocks:
 *      if the rule could contact somebody and no branch claimed the event, write
 *      an Error row naming the event type and the channels. That converts the
 *      next Gap F from a silent hole into a visible failure - but only if it
 *      actually fires, and only if it builds a FRESH timeline row (the one the
 *      blocks share carries an _id after its first create, so reusing it would
 *      UPDATE the earlier row instead of recording the miss).
 *
 *   2. THE UNVERIFIED PATH. An unverified method must produce exactly one Error
 *      row saying so and must not send. Both halves matter: no row is a silent
 *      drop, and a send would page a number nobody proved they own.
 *
 *   3. THE ROW COMES BEFORE THE BODY. The acknowledge deep-link is derived from
 *      the timeline row's id, so the row has to be created BEFORE the message is
 *      generated (PHASE1_SPEC constraint 6). Hoisting template generation out of
 *      the per-attempt path - an obvious-looking optimisation, since the body is
 *      identical for every recipient - would ship a page whose "acknowledge"
 *      button points at nothing. Every generator call is therefore asserted to
 *      happen after the create AND to receive that create's id.
 *
 * Nothing here touches a database or renders a template: the senders, the
 * generators, the entity lookups and the timeline writes are all stubbed, so
 * what is under test is purely which branch runs and in what order.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RULE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const LOG_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const METHOD_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const POLICY_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const ALERT_ID: ObjectID = new ObjectID("99999999-9999-4999-8999-999999999999");
const ALERT_EPISODE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const INCIDENT_EPISODE_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);

const RESPONDER_EMAIL: string = "responder@company.com";
const RESPONDER_PHONE: string = "+11234567890";
const TELEGRAM_CHAT_ID: string = "987654321";
const WEBHOOK_URL: string = "https://hooks.example.com/on-call";
const DEVICE_TOKEN: string = "device-token";
const TELEGRAM_BODY: string = "<b>telegram body</b>";
const SLACK_USER_ID: string = "U0123ABCD";
const SLACK_USER_NAME: string = "alice";
const TEAMS_USER_ID: string = "aad-object-0123";
const TEAMS_USER_NAME: string = "Alice Example";
const WORKSPACE_BLOCKS: Array<Record<string, unknown>> = [
  { _type: "WorkspacePayloadMarkdown", text: "**workspace body**" },
];

/* The options bag `executeNotificationRuleItem` takes, without re-declaring it. */
type ExecuteOptions = Parameters<
  typeof UserNotificationRuleService.executeNotificationRuleItem
>[1];

/*
 * The service mutates ONE UserOnCallLogTimeline instance and hands that same
 * instance to create() over and over, so mock.calls all alias its final state.
 * Snapshot the fields at call time instead. The instance itself is kept
 * alongside, because "did the guard build a fresh row?" is a question about
 * object identity and cannot be answered from a snapshot.
 */
interface TimelineRow {
  status: UserNotificationStatus | undefined;
  statusMessage: string | undefined;
  userId: ObjectID | undefined;
  userNotificationRuleId: ObjectID | undefined;
  userNotificationLogId: ObjectID | undefined;
  projectId: ObjectID | undefined;
  userNotificationEventType: UserNotificationEventType | undefined;
  methodIds: Record<string, ObjectID | undefined>;
}

/* Everything the options bag handed to every sender has in common. */
interface SenderOptions {
  projectId?: ObjectID | undefined;
  userId?: ObjectID | undefined;
  userOnCallLogTimelineId?: ObjectID | undefined;
  alertEpisodeId?: ObjectID | undefined;
  incidentEpisodeId?: ObjectID | undefined;
  /*
   * Only the shared workspace sender carries this: it is the ONE thing that
   * says whether a call was a Slack page or a Microsoft Teams page.
   */
  workspaceType?: WorkspaceType | undefined;
}

interface DeliverySpies {
  claim: jest.SpyInstance;
  findRule: jest.SpyInstance;
  twilio: jest.SpyInstance;
  timelineCreate: jest.SpyInstance;
  timelineUpdate: jest.SpyInstance;
  incidentFind: jest.SpyInstance;
  alertFind: jest.SpyInstance;
  alertEpisodeFind: jest.SpyInstance;
  incidentEpisodeFind: jest.SpyInstance;
  incidentLink: jest.SpyInstance;
  alertLink: jest.SpyInstance;
  alertEpisodeLink: jest.SpyInstance;
  incidentEpisodeLink: jest.SpyInstance;
  mail: jest.SpyInstance;
  sms: jest.SpyInstance;
  call: jest.SpyInstance;
  whatsApp: jest.SpyInstance;
  telegram: jest.SpyInstance;
  workspace: jest.SpyInstance;
  webhook: jest.SpyInstance;
  push: jest.SpyInstance;
  loggerError: jest.SpyInstance;
}

let spies: DeliverySpies;
let generators: Record<string, jest.SpyInstance>;
let timelineRows: Array<TimelineRow>;
let timelineInstances: Array<UserOnCallLogTimeline>;

function flushMicrotasks(): Promise<void> {
  return Promise.resolve()
    .then((): Promise<void> => {
      return Promise.resolve();
    })
    .then((): Promise<void> => {
      return Promise.resolve();
    });
}

function ruleItem(
  channels: Record<string, unknown> = {},
): UserNotificationRule {
  return {
    id: RULE_ID,
    _id: RULE_ID.toString(),
    userId: USER_ID,
    ...channels,
  } as unknown as UserNotificationRule;
}

function fakeIncident(): Incident {
  return {
    id: INCIDENT_ID,
    projectId: PROJECT_ID,
    title: "Checkout is down",
    description: "Checkout returns 500 for every request.",
    incidentNumber: 42,
    incidentNumberWithPrefix: "INC-42",
    project: { name: "Acme" },
    incidentSeverity: { name: "Sev1" },
    currentIncidentState: { name: "Created" },
  } as unknown as Incident;
}

function fakeAlert(): Alert {
  return {
    id: ALERT_ID,
    projectId: PROJECT_ID,
    title: "Disk almost full",
    description: "94% used on node-3.",
    alertNumber: 7,
    alertNumberWithPrefix: "ALR-7",
    project: { name: "Acme" },
    alertSeverity: { name: "Sev2" },
    currentAlertState: { name: "Created" },
  } as unknown as Alert;
}

function fakeAlertEpisode(): AlertEpisode {
  return {
    id: ALERT_EPISODE_ID,
    projectId: PROJECT_ID,
    title: "Node-3 is flapping",
    description: "Six alerts in ten minutes.",
    episodeNumber: 3,
    episodeNumberWithPrefix: "AEP-3",
    project: { name: "Acme" },
    alertSeverity: { name: "Sev2" },
    currentAlertState: { name: "Created" },
  } as unknown as AlertEpisode;
}

function fakeIncidentEpisode(): IncidentEpisode {
  return {
    id: INCIDENT_EPISODE_ID,
    projectId: PROJECT_ID,
    title: "Checkout degradation",
    description: "Three incidents share a root cause.",
    episodeNumber: 9,
    episodeNumberWithPrefix: "IEP-9",
    project: { name: "Acme" },
    incidentSeverity: { name: "Sev1" },
    currentIncidentState: { name: "Created" },
  } as unknown as IncidentEpisode;
}

/*
 * One channel of the matrix: how to make a rule that can only reach the user
 * that way, which provider must end up holding the page, and how the timeline
 * row and the generator are supposed to be stamped.
 */
interface ChannelSpec {
  /* The display name getContactableChannelNames gives this channel. */
  channel: string;
  /* A rule relation, verified, so the channel's send gate opens. */
  verifiedMethod: () => Record<string, unknown>;
  /* The same relation unverified. Null for Webhook, which has no such concept. */
  unverifiedMethod: (() => Record<string, unknown>) | null;
  /* Fragment of the Sending row this channel writes before handing over. */
  sendingMessage: string;
  /* Fragment of the Error row an unverified method must produce. */
  unverifiedMessage: string;
  /* The provider function the block must call. Read lazily: spies are per-test. */
  sender: () => jest.SpyInstance;
  /*
   * Where the options bag sits in the sender's arguments. Every legacy
   * provider takes (message, options); the workspace sender takes a single
   * options bag as its only argument.
   */
  senderOptionsArgIndex: number;
  /*
   * Slack and Microsoft Teams share ONE sender -
   * WorkspaceUserNotificationService.sendDirectMessageToUser - so the spy
   * alone cannot say which channel a call was for; the workspaceType argument
   * can, and is asserted wherever the spec's is non-null. Null for channels
   * with a provider of their own.
   */
  workspaceType: WorkspaceType | null;
  /* The timeline column that attributes the row to this method. */
  timelineMethodIdField: string;
  /*
   * The generator family that renders the body, plus where the timeline row id
   * sits in its arguments. Null for Webhook and Push, which build their payload
   * inline rather than through a generator.
   */
  generatorPrefix: string | null;
  generatorTimelineIdArgIndex: number;
}

const CHANNEL_SPECS: Record<string, ChannelSpec> = {
  Email: {
    channel: "Email",
    verifiedMethod: (): Record<string, unknown> => {
      return {
        userEmail: {
          id: METHOD_ID,
          email: new Email(RESPONDER_EMAIL),
          isVerified: true,
        },
      };
    },
    unverifiedMethod: (): Record<string, unknown> => {
      return {
        userEmail: {
          id: METHOD_ID,
          email: new Email(RESPONDER_EMAIL),
          isVerified: false,
        },
      };
    },
    sendingMessage: "Sending email to",
    unverifiedMessage: "Email notification not sent because email",
    sender: (): jest.SpyInstance => {
      return spies.mail;
    },
    senderOptionsArgIndex: 1,
    workspaceType: null,
    timelineMethodIdField: "userEmailId",
    generatorPrefix: "generateEmailTemplateFor",
    generatorTimelineIdArgIndex: 2,
  },
  SMS: {
    channel: "SMS",
    verifiedMethod: (): Record<string, unknown> => {
      return {
        userSms: {
          id: METHOD_ID,
          phone: new Phone(RESPONDER_PHONE),
          isVerified: true,
        },
      };
    },
    unverifiedMethod: (): Record<string, unknown> => {
      return {
        userSms: {
          id: METHOD_ID,
          phone: new Phone(RESPONDER_PHONE),
          isVerified: false,
        },
      };
    },
    sendingMessage: "Sending SMS to",
    unverifiedMessage: "SMS not sent because phone",
    sender: (): jest.SpyInstance => {
      return spies.sms;
    },
    senderOptionsArgIndex: 1,
    workspaceType: null,
    timelineMethodIdField: "userSmsId",
    generatorPrefix: "generateSmsTemplateFor",
    generatorTimelineIdArgIndex: 2,
  },
  WhatsApp: {
    channel: "WhatsApp",
    verifiedMethod: (): Record<string, unknown> => {
      return {
        userWhatsApp: {
          id: METHOD_ID,
          phone: new Phone(RESPONDER_PHONE),
          isVerified: true,
        },
      };
    },
    unverifiedMethod: (): Record<string, unknown> => {
      return {
        userWhatsApp: {
          id: METHOD_ID,
          phone: new Phone(RESPONDER_PHONE),
          isVerified: false,
        },
      };
    },
    sendingMessage: "Sending WhatsApp message to",
    unverifiedMessage: "WhatsApp message not sent because phone",
    sender: (): jest.SpyInstance => {
      return spies.whatsApp;
    },
    senderOptionsArgIndex: 1,
    workspaceType: null,
    timelineMethodIdField: "userWhatsAppId",
    generatorPrefix: "generateWhatsAppTemplateFor",
    generatorTimelineIdArgIndex: 2,
  },
  Telegram: {
    channel: "Telegram",
    verifiedMethod: (): Record<string, unknown> => {
      return {
        userTelegram: {
          id: METHOD_ID,
          telegramChatId: TELEGRAM_CHAT_ID,
          isVerified: true,
        },
      };
    },
    unverifiedMethod: (): Record<string, unknown> => {
      return {
        userTelegram: {
          id: METHOD_ID,
          telegramChatId: TELEGRAM_CHAT_ID,
          isVerified: false,
        },
      };
    },
    sendingMessage: "Sending Telegram message",
    unverifiedMessage: "Telegram message not sent because",
    sender: (): jest.SpyInstance => {
      return spies.telegram;
    },
    senderOptionsArgIndex: 1,
    workspaceType: null,
    timelineMethodIdField: "userTelegramId",
    /* Telegram's generator takes (entity, timelineId) - no `to` argument. */
    generatorPrefix: "generateTelegramBodyFor",
    generatorTimelineIdArgIndex: 1,
  },
  Slack: {
    channel: "Slack",
    verifiedMethod: (): Record<string, unknown> => {
      return {
        userSlack: {
          id: METHOD_ID,
          slackUserId: SLACK_USER_ID,
          slackUserName: SLACK_USER_NAME,
          isVerified: true,
        },
      };
    },
    unverifiedMethod: (): Record<string, unknown> => {
      return {
        userSlack: {
          id: METHOD_ID,
          slackUserId: SLACK_USER_ID,
          slackUserName: SLACK_USER_NAME,
          isVerified: false,
        },
      };
    },
    sendingMessage: "Sending Slack message.",
    unverifiedMessage:
      "Slack message not sent because the Slack account is not verified.",
    sender: (): jest.SpyInstance => {
      return spies.workspace;
    },
    /* The workspace sender takes ONE options bag, not (message, options). */
    senderOptionsArgIndex: 0,
    workspaceType: WorkspaceType.Slack,
    timelineMethodIdField: "userSlackId",
    /*
     * One generator family serves BOTH workspace channels: the blocks are
     * plain markdown, slackified or adaptive-carded by the send side. Like
     * Telegram's, the generators take (entity, timelineId).
     */
    generatorPrefix: "generateWorkspaceMessageBlocksFor",
    generatorTimelineIdArgIndex: 1,
  },
  "Microsoft Teams": {
    channel: "Microsoft Teams",
    verifiedMethod: (): Record<string, unknown> => {
      return {
        userMicrosoftTeams: {
          id: METHOD_ID,
          microsoftTeamsUserId: TEAMS_USER_ID,
          microsoftTeamsUserName: TEAMS_USER_NAME,
          isVerified: true,
        },
      };
    },
    unverifiedMethod: (): Record<string, unknown> => {
      return {
        userMicrosoftTeams: {
          id: METHOD_ID,
          microsoftTeamsUserId: TEAMS_USER_ID,
          microsoftTeamsUserName: TEAMS_USER_NAME,
          isVerified: false,
        },
      };
    },
    sendingMessage: "Sending Microsoft Teams message.",
    unverifiedMessage:
      "Microsoft Teams message not sent because the Microsoft Teams account is not verified.",
    sender: (): jest.SpyInstance => {
      return spies.workspace;
    },
    senderOptionsArgIndex: 0,
    workspaceType: WorkspaceType.MicrosoftTeams,
    timelineMethodIdField: "userMicrosoftTeamsId",
    /* Shared with Slack - see the note on that spec. */
    generatorPrefix: "generateWorkspaceMessageBlocksFor",
    generatorTimelineIdArgIndex: 1,
  },
  Webhook: {
    channel: "Webhook",
    verifiedMethod: (): Record<string, unknown> => {
      return {
        userWebhook: {
          id: METHOD_ID,
          webhookUrl: WEBHOOK_URL,
          name: "Pager bridge",
          secret: "s3cr3t",
        },
      };
    },
    /*
     * UserWebhook has no isVerified column at all, so there is no unverified
     * shape to build and no "not verified" row to expect.
     */
    unverifiedMethod: null,
    sendingMessage: "Sending webhook to",
    unverifiedMessage: "",
    sender: (): jest.SpyInstance => {
      return spies.webhook;
    },
    senderOptionsArgIndex: 1,
    workspaceType: null,
    timelineMethodIdField: "userWebhookId",
    generatorPrefix: null,
    generatorTimelineIdArgIndex: -1,
  },
  Call: {
    channel: "Call",
    verifiedMethod: (): Record<string, unknown> => {
      return {
        userCall: {
          id: METHOD_ID,
          phone: new Phone(RESPONDER_PHONE),
          isVerified: true,
        },
      };
    },
    unverifiedMethod: (): Record<string, unknown> => {
      return {
        userCall: {
          id: METHOD_ID,
          phone: new Phone(RESPONDER_PHONE),
          isVerified: false,
        },
      };
    },
    sendingMessage: "Making a call to",
    unverifiedMessage: "Call not sent because phone",
    sender: (): jest.SpyInstance => {
      return spies.call;
    },
    senderOptionsArgIndex: 1,
    workspaceType: null,
    timelineMethodIdField: "userCallId",
    generatorPrefix: "generateCallTemplateFor",
    generatorTimelineIdArgIndex: 2,
  },
  Push: {
    channel: "Push",
    verifiedMethod: (): Record<string, unknown> => {
      return {
        userPush: {
          id: METHOD_ID,
          deviceToken: DEVICE_TOKEN,
          deviceType: PushDeviceType.iOS,
          isVerified: true,
        },
      };
    },
    unverifiedMethod: (): Record<string, unknown> => {
      return {
        userPush: {
          id: METHOD_ID,
          deviceToken: DEVICE_TOKEN,
          deviceType: PushDeviceType.iOS,
          isVerified: false,
        },
      };
    },
    sendingMessage: "Sending push notification",
    unverifiedMessage: "Push notification not sent because device is not",
    sender: (): jest.SpyInstance => {
      return spies.push;
    },
    senderOptionsArgIndex: 1,
    workspaceType: null,
    timelineMethodIdField: "userPushId",
    /* Push builds its payload through PushNotificationUtil, not a generator. */
    generatorPrefix: null,
    generatorTimelineIdArgIndex: -1,
  },
};

/*
 * One event type of the matrix: the options that make the delivery path resolve
 * its triggering entity, and the names the channel blocks derive from it.
 */
interface EventSpec {
  eventType: UserNotificationEventType;
  makeOptions: () => ExecuteOptions;
  /* Point this event's finder at a real entity; the other three stay null. */
  arm: () => void;
  /* Appended to a channel's generatorPrefix to name the generator for this cell. */
  generatorSuffix: string;
  /* The eventType string the webhook block puts on the wire. */
  webhookEventType: string;
}

const EVENT_SPECS: Record<string, EventSpec> = {
  IncidentCreated: {
    eventType: UserNotificationEventType.IncidentCreated,
    makeOptions: (): ExecuteOptions => {
      return {
        projectId: PROJECT_ID,
        userNotificationEventType: UserNotificationEventType.IncidentCreated,
        triggeredByIncidentId: INCIDENT_ID,
        onCallPolicyId: POLICY_ID,
        userNotificationLogId: LOG_ID,
      };
    },
    arm: (): void => {
      spies.incidentFind.mockResolvedValue(fakeIncident() as never);
    },
    generatorSuffix: "IncidentCreated",
    webhookEventType: "on-call.incident.created",
  },
  AlertCreated: {
    eventType: UserNotificationEventType.AlertCreated,
    makeOptions: (): ExecuteOptions => {
      return {
        projectId: PROJECT_ID,
        userNotificationEventType: UserNotificationEventType.AlertCreated,
        triggeredByAlertId: ALERT_ID,
        onCallPolicyId: POLICY_ID,
        userNotificationLogId: LOG_ID,
      };
    },
    arm: (): void => {
      spies.alertFind.mockResolvedValue(fakeAlert() as never);
    },
    generatorSuffix: "AlertCreated",
    webhookEventType: "on-call.alert.created",
  },
  AlertEpisodeCreated: {
    eventType: UserNotificationEventType.AlertEpisodeCreated,
    makeOptions: (): ExecuteOptions => {
      return {
        projectId: PROJECT_ID,
        userNotificationEventType:
          UserNotificationEventType.AlertEpisodeCreated,
        triggeredByAlertEpisodeId: ALERT_EPISODE_ID,
        onCallPolicyId: POLICY_ID,
        userNotificationLogId: LOG_ID,
      };
    },
    arm: (): void => {
      spies.alertEpisodeFind.mockResolvedValue(fakeAlertEpisode() as never);
    },
    generatorSuffix: "AlertEpisodeCreated",
    webhookEventType: "on-call.alertEpisode.created",
  },
  IncidentEpisodeCreated: {
    eventType: UserNotificationEventType.IncidentEpisodeCreated,
    makeOptions: (): ExecuteOptions => {
      return {
        projectId: PROJECT_ID,
        userNotificationEventType:
          UserNotificationEventType.IncidentEpisodeCreated,
        triggeredByIncidentEpisodeId: INCIDENT_EPISODE_ID,
        onCallPolicyId: POLICY_ID,
        userNotificationLogId: LOG_ID,
      };
    },
    arm: (): void => {
      spies.incidentEpisodeFind.mockResolvedValue(
        fakeIncidentEpisode() as never,
      );
    },
    generatorSuffix: "IncidentEpisodeCreated",
    webhookEventType: "on-call.incidentEpisode.created",
  },
};

/*
 * The two axes. Both are asserted against the production code below, so they
 * cannot silently fall behind a newly added channel or event type.
 */
const CHANNEL_NAMES: Array<string> = [
  "Email",
  "SMS",
  "WhatsApp",
  "Telegram",
  "Slack",
  "Microsoft Teams",
  "Webhook",
  "Call",
  "Push",
];

const EVENT_NAMES: Array<string> = [
  "IncidentCreated",
  "AlertCreated",
  "AlertEpisodeCreated",
  "IncidentEpisodeCreated",
];

/* Channels whose body comes from a generator that takes the timeline row id. */
const GENERATOR_CHANNEL_NAMES: Array<string> = [
  "Email",
  "SMS",
  "WhatsApp",
  "Telegram",
  "Slack",
  "Microsoft Teams",
  "Call",
];

/* Channels that have a verification concept at all (everything but Webhook). */
const VERIFIABLE_CHANNEL_NAMES: Array<string> = [
  "Email",
  "SMS",
  "WhatsApp",
  "Telegram",
  "Slack",
  "Microsoft Teams",
  "Call",
  "Push",
];

function buildMatrix(channelNames: Array<string>): Array<[string, string]> {
  const rows: Array<[string, string]> = [];

  for (const channelName of channelNames) {
    for (const eventName of EVENT_NAMES) {
      rows.push([channelName, eventName]);
    }
  }

  return rows;
}

const FULL_MATRIX: Array<[string, string]> = buildMatrix(CHANNEL_NAMES);
const GENERATOR_MATRIX: Array<[string, string]> = buildMatrix(
  GENERATOR_CHANNEL_NAMES,
);
const UNVERIFIED_MATRIX: Array<[string, string]> = buildMatrix(
  VERIFIABLE_CHANNEL_NAMES,
);

function channelSpec(channelName: string): ChannelSpec {
  return CHANNEL_SPECS[channelName]!;
}

function eventSpec(eventName: string): EventSpec {
  return EVENT_SPECS[eventName]!;
}

/* Every verified method at once - used to interrogate the channel census. */
function everyVerifiedMethod(): Record<string, unknown> {
  const methods: Record<string, unknown> = {};

  for (const channelName of CHANNEL_NAMES) {
    Object.assign(methods, channelSpec(channelName).verifiedMethod());
  }

  return methods;
}

/*
 * getContactableChannelNames is private. Call it through a cast rather than
 * widening the service's public surface, as the neighbouring characterisation
 * tests do for protected hooks.
 */
function contactableChannelNames(rule: UserNotificationRule): Array<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (UserNotificationRuleService as any).getContactableChannelNames(rule);
}

function everySender(): Array<jest.SpyInstance> {
  return [
    spies.mail,
    spies.sms,
    spies.call,
    spies.whatsApp,
    spies.telegram,
    spies.workspace,
    spies.webhook,
    spies.push,
  ];
}

function otherSenders(channel: ChannelSpec): Array<jest.SpyInstance> {
  const own: jest.SpyInstance = channel.sender();

  return everySender().filter((sender: jest.SpyInstance): boolean => {
    return sender !== own;
  });
}

/* The options bag a sender was handed - the spec says which argument it is. */
function senderOptions(channel: ChannelSpec): SenderOptions {
  return channel.sender().mock.calls[0][
    channel.senderOptionsArgIndex
  ] as SenderOptions;
}

describe("UserNotificationRuleService channel x event coverage", () => {
  beforeEach(() => {
    timelineRows = [];
    timelineInstances = [];

    const timelineCreate: jest.SpyInstance = jest.spyOn(
      UserOnCallLogTimelineService,
      "create",
    );
    timelineCreate.mockImplementation(
      (createBy: unknown): Promise<UserOnCallLogTimeline> => {
        const data: UserOnCallLogTimeline = (
          createBy as { data: UserOnCallLogTimeline }
        ).data;

        timelineInstances.push(data);
        timelineRows.push({
          status: data.status,
          statusMessage: data.statusMessage,
          userId: data.userId,
          userNotificationRuleId: data.userNotificationRuleId,
          userNotificationLogId: data.userNotificationLogId,
          projectId: data.projectId,
          userNotificationEventType: data.userNotificationEventType,
          methodIds: {
            userEmailId: data.userEmailId,
            userSmsId: data.userSmsId,
            userCallId: data.userCallId,
            userWhatsAppId: data.userWhatsAppId,
            userTelegramId: data.userTelegramId,
            userSlackId: data.userSlackId,
            userMicrosoftTeamsId: data.userMicrosoftTeamsId,
            userPushId: data.userPushId,
            userWebhookId: data.userWebhookId,
          },
        });

        return Promise.resolve({
          id: TIMELINE_ID,
        } as unknown as UserOnCallLogTimeline);
      },
    );

    spies = {
      /*
       * claimNotificationRuleExecution issues raw SQL through the repository
       * manager and swallows failures into a non-atomic fallback, so it is
       * stubbed whole rather than at the database boundary.
       */
      claim: jest
        .spyOn(UserOnCallLogService, "claimNotificationRuleExecution")
        .mockResolvedValue(true as never),
      findRule: jest
        .spyOn(UserNotificationRuleService, "findOneById")
        .mockResolvedValue(ruleItem() as never),
      twilio: jest
        .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
        .mockResolvedValue(undefined as never),
      timelineCreate: timelineCreate,
      timelineUpdate: jest
        .spyOn(UserOnCallLogTimelineService, "updateOneById")
        .mockResolvedValue(undefined as never),
      /*
       * All four finders start at null. Each test arms exactly the one its
       * event type resolves through, which is also what proves the other three
       * are never consulted.
       */
      incidentFind: jest
        .spyOn(IncidentService, "findOneById")
        .mockResolvedValue(null as never),
      alertFind: jest
        .spyOn(AlertService, "findOneById")
        .mockResolvedValue(null as never),
      alertEpisodeFind: jest
        .spyOn(AlertEpisodeService, "findOneById")
        .mockResolvedValue(null as never),
      incidentEpisodeFind: jest
        .spyOn(IncidentEpisodeService, "findOneById")
        .mockResolvedValue(null as never),
      /* The push blocks build a dashboard deep-link before sending. */
      incidentLink: jest
        .spyOn(IncidentService, "getIncidentLinkInDashboard")
        .mockResolvedValue(
          URL.fromString("https://oneuptime.test/incident") as never,
        ),
      alertLink: jest
        .spyOn(AlertService, "getAlertLinkInDashboard")
        .mockResolvedValue(
          URL.fromString("https://oneuptime.test/alert") as never,
        ),
      alertEpisodeLink: jest
        .spyOn(AlertEpisodeService, "getEpisodeLinkInDashboard")
        .mockResolvedValue(
          URL.fromString("https://oneuptime.test/alert-episode") as never,
        ),
      incidentEpisodeLink: jest
        .spyOn(IncidentEpisodeService, "getEpisodeLinkInDashboard")
        .mockResolvedValue(
          URL.fromString("https://oneuptime.test/incident-episode") as never,
        ),
      mail: jest
        .spyOn(MailService, "sendMail")
        .mockResolvedValue(undefined as never),
      sms: jest
        .spyOn(SmsService, "sendSms")
        .mockResolvedValue(undefined as never),
      call: jest
        .spyOn(CallService, "makeCall")
        .mockResolvedValue(undefined as never),
      whatsApp: jest
        .spyOn(WhatsAppService, "sendWhatsAppMessage")
        .mockResolvedValue(undefined as never),
      telegram: jest
        .spyOn(TelegramService, "sendTelegramMessage")
        .mockResolvedValue(undefined as never),
      /* ONE sender for BOTH workspace channels - see ChannelSpec.workspaceType. */
      workspace: jest
        .spyOn(WorkspaceUserNotificationService, "sendDirectMessageToUser")
        .mockResolvedValue(undefined as never),
      webhook: jest
        .spyOn(WebhookService, "sendWebhook")
        .mockResolvedValue(undefined as never),
      push: jest
        .spyOn(PushNotificationService, "sendPushNotification")
        .mockResolvedValue(undefined as never),
      loggerError: jest.spyOn(logger, "error").mockImplementation((): void => {
        return undefined;
      }),
    };

    /*
     * Every template generator is stubbed. They render Handlebars, shorten
     * links and read DatabaseConfig; none of that is what this file is about,
     * and a real one would drag a database into the test. Stubbing them also
     * makes them observable, which is how the "row before body" ordering is
     * asserted.
     */
    generators = {
      generateEmailTemplateForIncidentCreated: jest
        .spyOn(
          UserNotificationRuleService,
          "generateEmailTemplateForIncidentCreated",
        )
        .mockResolvedValue({} as never),
      generateEmailTemplateForAlertCreated: jest
        .spyOn(
          UserNotificationRuleService,
          "generateEmailTemplateForAlertCreated",
        )
        .mockResolvedValue({} as never),
      generateEmailTemplateForAlertEpisodeCreated: jest
        .spyOn(
          UserNotificationRuleService,
          "generateEmailTemplateForAlertEpisodeCreated",
        )
        .mockResolvedValue({} as never),
      generateEmailTemplateForIncidentEpisodeCreated: jest
        .spyOn(
          UserNotificationRuleService,
          "generateEmailTemplateForIncidentEpisodeCreated",
        )
        .mockResolvedValue({} as never),
      generateSmsTemplateForIncidentCreated: jest
        .spyOn(
          UserNotificationRuleService,
          "generateSmsTemplateForIncidentCreated",
        )
        .mockResolvedValue({} as never),
      generateSmsTemplateForAlertCreated: jest
        .spyOn(
          UserNotificationRuleService,
          "generateSmsTemplateForAlertCreated",
        )
        .mockResolvedValue({} as never),
      generateSmsTemplateForAlertEpisodeCreated: jest
        .spyOn(
          UserNotificationRuleService,
          "generateSmsTemplateForAlertEpisodeCreated",
        )
        .mockResolvedValue({} as never),
      generateSmsTemplateForIncidentEpisodeCreated: jest
        .spyOn(
          UserNotificationRuleService,
          "generateSmsTemplateForIncidentEpisodeCreated",
        )
        .mockResolvedValue({} as never),
      generateWhatsAppTemplateForIncidentCreated: jest
        .spyOn(
          UserNotificationRuleService,
          "generateWhatsAppTemplateForIncidentCreated",
        )
        .mockResolvedValue({} as never),
      generateWhatsAppTemplateForAlertCreated: jest
        .spyOn(
          UserNotificationRuleService,
          "generateWhatsAppTemplateForAlertCreated",
        )
        .mockResolvedValue({} as never),
      generateWhatsAppTemplateForAlertEpisodeCreated: jest
        .spyOn(
          UserNotificationRuleService,
          "generateWhatsAppTemplateForAlertEpisodeCreated",
        )
        .mockResolvedValue({} as never),
      generateWhatsAppTemplateForIncidentEpisodeCreated: jest
        .spyOn(
          UserNotificationRuleService,
          "generateWhatsAppTemplateForIncidentEpisodeCreated",
        )
        .mockResolvedValue({} as never),
      generateTelegramBodyForIncidentCreated: jest
        .spyOn(
          UserNotificationRuleService,
          "generateTelegramBodyForIncidentCreated",
        )
        .mockResolvedValue(TELEGRAM_BODY as never),
      generateTelegramBodyForAlertCreated: jest
        .spyOn(
          UserNotificationRuleService,
          "generateTelegramBodyForAlertCreated",
        )
        .mockResolvedValue(TELEGRAM_BODY as never),
      generateTelegramBodyForAlertEpisodeCreated: jest
        .spyOn(
          UserNotificationRuleService,
          "generateTelegramBodyForAlertEpisodeCreated",
        )
        .mockResolvedValue(TELEGRAM_BODY as never),
      generateTelegramBodyForIncidentEpisodeCreated: jest
        .spyOn(
          UserNotificationRuleService,
          "generateTelegramBodyForIncidentEpisodeCreated",
        )
        .mockResolvedValue(TELEGRAM_BODY as never),
      generateWorkspaceMessageBlocksForIncidentCreated: jest
        .spyOn(
          UserNotificationRuleService,
          "generateWorkspaceMessageBlocksForIncidentCreated",
        )
        .mockResolvedValue(WORKSPACE_BLOCKS as never),
      generateWorkspaceMessageBlocksForAlertCreated: jest
        .spyOn(
          UserNotificationRuleService,
          "generateWorkspaceMessageBlocksForAlertCreated",
        )
        .mockResolvedValue(WORKSPACE_BLOCKS as never),
      generateWorkspaceMessageBlocksForAlertEpisodeCreated: jest
        .spyOn(
          UserNotificationRuleService,
          "generateWorkspaceMessageBlocksForAlertEpisodeCreated",
        )
        .mockResolvedValue(WORKSPACE_BLOCKS as never),
      generateWorkspaceMessageBlocksForIncidentEpisodeCreated: jest
        .spyOn(
          UserNotificationRuleService,
          "generateWorkspaceMessageBlocksForIncidentEpisodeCreated",
        )
        .mockResolvedValue(WORKSPACE_BLOCKS as never),
      generateCallTemplateForIncidentCreated: jest
        .spyOn(
          UserNotificationRuleService,
          "generateCallTemplateForIncidentCreated",
        )
        .mockResolvedValue({} as never),
      generateCallTemplateForAlertCreated: jest
        .spyOn(
          UserNotificationRuleService,
          "generateCallTemplateForAlertCreated",
        )
        .mockResolvedValue({} as never),
      generateCallTemplateForAlertEpisodeCreated: jest
        .spyOn(
          UserNotificationRuleService,
          "generateCallTemplateForAlertEpisodeCreated",
        )
        .mockResolvedValue({} as never),
      generateCallTemplateForIncidentEpisodeCreated: jest
        .spyOn(
          UserNotificationRuleService,
          "generateCallTemplateForIncidentEpisodeCreated",
        )
        .mockResolvedValue({} as never),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * Drive one cell of the matrix: a rule carrying exactly one verified method,
   * an event type, and nothing else.
   */
  async function deliverCell(
    channel: ChannelSpec,
    event: EventSpec,
  ): Promise<void> {
    event.arm();
    spies.findRule.mockResolvedValue(
      ruleItem(channel.verifiedMethod()) as never,
    );

    await UserNotificationRuleService.executeNotificationRuleItem(
      RULE_ID,
      event.makeOptions(),
    );

    /*
     * Sends are never awaited: executeNotificationRuleItem resolves while the
     * provider promises are still in flight, and the .catch that flips a row to
     * Error runs a microtask later. Flush before asserting on anything the
     * post-send path touches.
     */
    await flushMicrotasks();
  }

  /*
   * ----------------------------------------------------------------------- *
   * (A) The axes themselves. If either of these fails, the matrix below has
   * stopped covering the thing it claims to cover.
   * -----------------------------------------------------------------------
   */

  describe("the matrix axes track the production code", () => {
    test("the event axis covers EVERY UserNotificationEventType member", () => {
      /*
       * The canary for the next Gap F. Adding a fifth event type to the enum
       * fails here until it is added to EVENT_SPECS, at which point the matrix
       * grows by nine cells and any channel that forgot the new branch fails.
       */
      const members: Array<string> = Object.values(UserNotificationEventType);

      expect(EVENT_NAMES).toHaveLength(members.length);

      const covered: Array<string> = EVENT_NAMES.map(
        (eventName: string): string => {
          return eventSpec(eventName).eventType;
        },
      );

      for (const member of members) {
        expect(covered).toContain(member);
      }
    });

    test("the channel axis covers every channel getContactableChannelNames knows about", () => {
      /*
       * getContactableChannelNames is the delivery path's own answer to "what
       * can this rule reach the user on", and the fell-through guard names
       * those channels. Anything it can return must have a row in the matrix.
       */
      const allChannels: Array<string> = contactableChannelNames(
        ruleItem(everyVerifiedMethod()),
      );

      expect([...allChannels].sort()).toEqual([...CHANNEL_NAMES].sort());
    });

    test("the matrix is the full cartesian product", () => {
      expect(FULL_MATRIX).toHaveLength(
        CHANNEL_NAMES.length * EVENT_NAMES.length,
      );
      expect(FULL_MATRIX).toHaveLength(36);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (B) The grid. One test per cell.
   * -----------------------------------------------------------------------
   */

  describe("every channel dispatches for every event type", () => {
    test.each<[string, string]>(FULL_MATRIX)(
      "%s hands the page to its provider for %s",
      async (channelName: string, eventName: string): Promise<void> => {
        const channel: ChannelSpec = channelSpec(channelName);
        const event: EventSpec = eventSpec(eventName);

        await deliverCell(channel, event);

        /*
         * The Gap F assertion. Before Phase 1 five of these cells reached this
         * line with the provider untouched and the timeline empty.
         */
        expect(channel.sender()).toHaveBeenCalledTimes(1);

        /*
         * Slack and Microsoft Teams share that sender, so "the spy was called"
         * alone cannot tell a Slack page from a Teams page. The workspaceType
         * argument can, and must name THIS channel.
         */
        if (channel.workspaceType) {
          expect(senderOptions(channel).workspaceType).toBe(
            channel.workspaceType,
          );
        }
      },
    );

    test.each<[string, string]>(FULL_MATRIX)(
      "%s contacts NO other channel for %s",
      async (channelName: string, eventName: string): Promise<void> => {
        const channel: ChannelSpec = channelSpec(channelName);
        const event: EventSpec = eventSpec(eventName);

        await deliverCell(channel, event);

        for (const sender of otherSenders(channel)) {
          expect(sender).not.toHaveBeenCalled();
        }

        /*
         * otherSenders cannot separate the two channels that share the
         * workspace sender, so for those the "no other channel" claim is
         * finished by checking every call on the shared spy was for THIS
         * workspace and not its sibling.
         */
        if (channel.workspaceType) {
          for (const call of channel.sender().mock.calls) {
            expect((call[0] as SenderOptions).workspaceType).toBe(
              channel.workspaceType,
            );
          }
        }
      },
    );

    test.each<[string, string]>(FULL_MATRIX)(
      "%s writes exactly one Sending timeline row for %s",
      async (channelName: string, eventName: string): Promise<void> => {
        const channel: ChannelSpec = channelSpec(channelName);
        const event: EventSpec = eventSpec(eventName);

        await deliverCell(channel, event);

        expect(timelineRows).toHaveLength(1);
        expect(timelineRows[0]?.status).toBe(UserNotificationStatus.Sending);
        /*
         * statusMessage is nullable: false on the model, and it is the only
         * thing an operator reading the timeline sees. A block that copied its
         * neighbour's message would name the wrong channel here.
         */
        expect(timelineRows[0]?.statusMessage).toContain(
          channel.sendingMessage,
        );
        /* The guard row would be an Error. Delivery happened, so it stays quiet. */
        expect(timelineRows[0]?.status).not.toBe(UserNotificationStatus.Error);
      },
    );

    test.each<[string, string]>(FULL_MATRIX)(
      "%s stamps the timeline row with the page's identifiers for %s",
      async (channelName: string, eventName: string): Promise<void> => {
        const channel: ChannelSpec = channelSpec(channelName);
        const event: EventSpec = eventSpec(eventName);

        await deliverCell(channel, event);

        const row: TimelineRow | undefined = timelineRows[0];

        expect(row?.userId?.toString()).toBe(USER_ID.toString());
        expect(row?.userNotificationRuleId?.toString()).toBe(
          RULE_ID.toString(),
        );
        expect(row?.userNotificationLogId?.toString()).toBe(LOG_ID.toString());
        expect(row?.projectId?.toString()).toBe(PROJECT_ID.toString());
        expect(row?.userNotificationEventType).toBe(event.eventType);
        /* ...and with the method it was delivered on, so the row is attributable. */
        expect(row?.methodIds[channel.timelineMethodIdField]?.toString()).toBe(
          METHOD_ID.toString(),
        );
      },
    );

    test.each<[string, string]>(FULL_MATRIX)(
      "%s hands the sender the created row id, the project and the user for %s",
      async (channelName: string, eventName: string): Promise<void> => {
        const channel: ChannelSpec = channelSpec(channelName);
        const event: EventSpec = eventSpec(eventName);

        await deliverCell(channel, event);

        const options: SenderOptions = senderOptions(channel);

        /*
         * userOnCallLogTimelineId is how the provider's delivery callback finds
         * the row to update, and how an acknowledgement is matched back to this
         * attempt. A cell that passed the wrong id would look delivered and
         * never reconcile.
         */
        expect(options.userOnCallLogTimelineId?.toString()).toBe(
          TIMELINE_ID.toString(),
        );
        expect(options.projectId?.toString()).toBe(PROJECT_ID.toString());
        expect(options.userId?.toString()).toBe(USER_ID.toString());
      },
    );

    test.each<[string, string]>(FULL_MATRIX)(
      "%s consults only the finder for %s",
      async (channelName: string, eventName: string): Promise<void> => {
        const channel: ChannelSpec = channelSpec(channelName);
        const event: EventSpec = eventSpec(eventName);

        await deliverCell(channel, event);

        const finders: Array<jest.SpyInstance> = [
          spies.incidentFind,
          spies.alertFind,
          spies.alertEpisodeFind,
          spies.incidentEpisodeFind,
        ];

        const called: Array<jest.SpyInstance> = finders.filter(
          (finder: jest.SpyInstance): boolean => {
            return finder.mock.calls.length > 0;
          },
        );

        // The event type, not the ids on the options bag, picks the entity.
        expect(called).toHaveLength(1);
      },
    );
  });

  /*
   * ----------------------------------------------------------------------- *
   * (C) The row must exist before the body is written (constraint 6).
   * -----------------------------------------------------------------------
   */

  describe("the timeline row is created BEFORE the message body", () => {
    test.each<[string, string]>(GENERATOR_MATRIX)(
      "%s generates its %s body only after the row exists",
      async (channelName: string, eventName: string): Promise<void> => {
        const channel: ChannelSpec = channelSpec(channelName);
        const event: EventSpec = eventSpec(eventName);

        await deliverCell(channel, event);

        const generator: jest.SpyInstance =
          generators[channel.generatorPrefix! + event.generatorSuffix]!;

        expect(generator).toHaveBeenCalledTimes(1);
        expect(spies.timelineCreate.mock.invocationCallOrder[0]).toBeLessThan(
          generator.mock.invocationCallOrder[0] as number,
        );
      },
    );

    test.each<[string, string]>(GENERATOR_MATRIX)(
      "%s derives its %s acknowledge link from the created row id",
      async (channelName: string, eventName: string): Promise<void> => {
        const channel: ChannelSpec = channelSpec(channelName);
        const event: EventSpec = eventSpec(eventName);

        await deliverCell(channel, event);

        const generator: jest.SpyInstance =
          generators[channel.generatorPrefix! + event.generatorSuffix]!;

        /*
         * This is why the ordering is load-bearing rather than incidental: the
         * generator turns this id into the acknowledge deep-link that is baked
         * into the message. Hoisting generation above the create - the obvious
         * "render once, send to many" optimisation - would produce a page whose
         * acknowledge button points at a row that does not exist.
         */
        const timelineIdArgument: ObjectID = generator.mock.calls[0][
          channel.generatorTimelineIdArgIndex
        ] as ObjectID;

        expect(timelineIdArgument.toString()).toBe(TIMELINE_ID.toString());
      },
    );

    test.each<[string, string]>(GENERATOR_MATRIX)(
      "%s generates the %s body before handing the page to the provider",
      async (channelName: string, eventName: string): Promise<void> => {
        const channel: ChannelSpec = channelSpec(channelName);
        const event: EventSpec = eventSpec(eventName);

        await deliverCell(channel, event);

        const generator: jest.SpyInstance =
          generators[channel.generatorPrefix! + event.generatorSuffix]!;

        expect(generator.mock.invocationCallOrder[0]).toBeLessThan(
          channel.sender().mock.invocationCallOrder[0] as number,
        );
      },
    );

    test.each<[string, string]>(GENERATOR_MATRIX)(
      "%s uses no OTHER generator for %s",
      async (channelName: string, eventName: string): Promise<void> => {
        const channel: ChannelSpec = channelSpec(channelName);
        const event: EventSpec = eventSpec(eventName);

        await deliverCell(channel, event);

        const expectedName: string =
          channel.generatorPrefix! + event.generatorSuffix;

        for (const generatorName of Object.keys(generators)) {
          if (generatorName === expectedName) {
            continue;
          }

          /*
           * A cell that fell through to a neighbour's template would still send
           * something - the wrong thing, describing the wrong entity. Pin that
           * exactly one generator runs, and that it is this cell's.
           */
          expect(generators[generatorName]).not.toHaveBeenCalled();
        }
      },
    );
  });

  /*
   * ----------------------------------------------------------------------- *
   * (D) Channels with no generator still carry the row id.
   * -----------------------------------------------------------------------
   */

  describe("the webhook block", () => {
    test.each<[string, string]>(buildMatrix(["Webhook"]))(
      "%s puts the right eventType on the wire for %s",
      async (channelName: string, eventName: string): Promise<void> => {
        const channel: ChannelSpec = channelSpec(channelName);
        const event: EventSpec = eventSpec(eventName);

        await deliverCell(channel, event);

        const request: { url: string; eventType: string; payload: unknown } =
          spies.webhook.mock.calls[0][0] as {
            url: string;
            eventType: string;
            payload: unknown;
          };

        expect(request.url).toBe(WEBHOOK_URL);
        expect(request.eventType).toBe(event.webhookEventType);
      },
    );

    test.each<[string, string]>(buildMatrix(["Webhook"]))(
      "%s repeats the eventType inside the payload for %s",
      async (channelName: string, eventName: string): Promise<void> => {
        const channel: ChannelSpec = channelSpec(channelName);
        const event: EventSpec = eventSpec(eventName);

        await deliverCell(channel, event);

        const request: { payload: Record<string, unknown> } = spies.webhook.mock
          .calls[0][0] as { payload: Record<string, unknown> };

        expect(request.payload["eventType"]).toBe(event.webhookEventType);
        expect(request.payload["userId"]).toBe(USER_ID.toString());
      },
    );

    test("a webhook is dispatched on webhookUrl alone - there is no verification gate", async () => {
      /*
       * UserWebhook has no isVerified column, so the presence of a URL is the
       * whole gate. That is why Webhook is absent from the unverified matrix
       * below rather than missing from it by oversight.
       */
      await deliverCell(
        channelSpec("Webhook"),
        eventSpec("IncidentEpisodeCreated"),
      );

      expect(spies.webhook).toHaveBeenCalledTimes(1);
      expect(timelineRows).toHaveLength(1);
      expect(timelineRows[0]?.status).toBe(UserNotificationStatus.Sending);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (E) Episode linkage - what the sender is told the page is about.
   * -----------------------------------------------------------------------
   */

  describe("episode ids on the sender options", () => {
    test.each<[string, string]>(
      buildMatrix([
        "Email",
        "SMS",
        "WhatsApp",
        "Telegram",
        "Slack",
        "Microsoft Teams",
        "Call",
        "Push",
      ]),
    )(
      "%s links the alert episode it is paging about (%s is ignored unless it is the alert episode)",
      async (channelName: string, eventName: string): Promise<void> => {
        const channel: ChannelSpec = channelSpec(channelName);
        const event: EventSpec = eventSpec(eventName);

        await deliverCell(channel, event);

        const options: SenderOptions = senderOptions(channel);

        if (event.eventType === UserNotificationEventType.AlertEpisodeCreated) {
          expect(options.alertEpisodeId?.toString()).toBe(
            ALERT_EPISODE_ID.toString(),
          );
        } else {
          expect(options.alertEpisodeId).toBeUndefined();
        }
      },
    );

    test.each<[string, string]>(
      buildMatrix(["Email", "SMS", "WhatsApp", "Telegram", "Call", "Push"]),
    )(
      "%s never passes an incidentEpisodeId for %s",
      async (channelName: string, eventName: string): Promise<void> => {
        const channel: ChannelSpec = channelSpec(channelName);
        const event: EventSpec = eventSpec(eventName);

        await deliverCell(channel, event);

        /*
         * Deliberate, and pinned so it does not get "fixed" by adding the key
         * without fixing the transport: every one of these services accepts
         * incidentEpisodeId in its options type and then never serialises it
         * onto the request body. Passing it would read as a link that exists.
         * Contrast with alertEpisodeId above, which does travel - and with the
         * workspace channels below, which send in-process and DO carry it.
         */
        expect(senderOptions(channel).incidentEpisodeId).toBeUndefined();
      },
    );

    test.each<[string, string]>(buildMatrix(["Slack", "Microsoft Teams"]))(
      "%s links the incident episode it is paging about (%s is ignored unless it is the incident episode)",
      async (channelName: string, eventName: string): Promise<void> => {
        const channel: ChannelSpec = channelSpec(channelName);
        const event: EventSpec = eventSpec(eventName);

        await deliverCell(channel, event);

        /*
         * The workspace sender is not an HTTP transport with a lossy request
         * body: it runs in-process and stamps whatever ids it is handed onto
         * the workspace notification log. So unlike the six channels above it
         * is given the incident episode id - and only when the incident
         * episode is what fired.
         */
        const options: SenderOptions = senderOptions(channel);

        if (
          event.eventType === UserNotificationEventType.IncidentEpisodeCreated
        ) {
          expect(options.incidentEpisodeId?.toString()).toBe(
            INCIDENT_EPISODE_ID.toString(),
          );
        } else {
          expect(options.incidentEpisodeId).toBeUndefined();
        }
      },
    );
  });

  /*
   * ----------------------------------------------------------------------- *
   * (F) The unverified path: an Error row, and nothing sent.
   * -----------------------------------------------------------------------
   */

  describe("an unverified method is never contacted", () => {
    async function deliverUnverifiedCell(
      channel: ChannelSpec,
      event: EventSpec,
    ): Promise<void> {
      event.arm();
      spies.findRule.mockResolvedValue(
        ruleItem(channel.unverifiedMethod!()) as never,
      );

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        event.makeOptions(),
      );
      await flushMicrotasks();
    }

    test.each<[string, string]>(UNVERIFIED_MATRIX)(
      "an unverified %s sends nothing for %s",
      async (channelName: string, eventName: string): Promise<void> => {
        const channel: ChannelSpec = channelSpec(channelName);
        const event: EventSpec = eventSpec(eventName);

        await deliverUnverifiedCell(channel, event);

        for (const sender of everySender()) {
          expect(sender).not.toHaveBeenCalled();
        }
      },
    );

    test.each<[string, string]>(UNVERIFIED_MATRIX)(
      "an unverified %s writes exactly one Error row saying so for %s",
      async (channelName: string, eventName: string): Promise<void> => {
        const channel: ChannelSpec = channelSpec(channelName);
        const event: EventSpec = eventSpec(eventName);

        await deliverUnverifiedCell(channel, event);

        /*
         * Exactly one: the not-verified row. The fell-through guard must NOT
         * also fire here - an unverified method is not a contactable channel,
         * so there is no missing template to report and a second row would tell
         * the operator a second, wrong story.
         */
        expect(timelineRows).toHaveLength(1);
        expect(timelineRows[0]?.status).toBe(UserNotificationStatus.Error);
        expect(timelineRows[0]?.statusMessage).toContain(
          channel.unverifiedMessage,
        );
        expect(timelineRows[0]?.statusMessage).toContain("not verified");
        expect(timelineRows[0]?.statusMessage).not.toContain(
          "No notification template",
        );
      },
    );

    test.each<[string, string]>(UNVERIFIED_MATRIX)(
      "an unverified %s never reaches a generator for %s",
      async (channelName: string, eventName: string): Promise<void> => {
        const channel: ChannelSpec = channelSpec(channelName);
        const event: EventSpec = eventSpec(eventName);

        await deliverUnverifiedCell(channel, event);

        for (const generatorName of Object.keys(generators)) {
          expect(generators[generatorName]).not.toHaveBeenCalled();
        }
      },
    );

    test("an unverified method is not a contactable channel", () => {
      for (const channelName of VERIFIABLE_CHANNEL_NAMES) {
        const channel: ChannelSpec = channelSpec(channelName);

        expect(
          contactableChannelNames(ruleItem(channel.unverifiedMethod!())),
        ).toEqual([]);
      }
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (G) The fell-through guard.
   *
   * With all thirty six cells wired, no rule reaches this guard today - which
   * is exactly the state it is meant to police, and exactly why it needs a test
   * of its own rather than incidental coverage. The precondition it fires on is
   * "the channel census found somebody reachable, and then no block claimed the
   * event". The census is taken before the triggering entity is loaded, so
   * dropping the relation inside the entity finder's stub reproduces that
   * precondition exactly, standing in for a future event type that is wired
   * into entity resolution but not into the channel blocks - which is precisely
   * the shape Gap F had.
   * -----------------------------------------------------------------------
   */

  describe("the fell-through guard", () => {
    function ruleThatLosesItsChannelsAfterTheCensus(
      methods: Record<string, unknown>,
      relationsToDrop: Array<string>,
    ): UserNotificationRule {
      const rule: UserNotificationRule = ruleItem(methods);

      spies.alertEpisodeFind.mockImplementation((): Promise<AlertEpisode> => {
        for (const relation of relationsToDrop) {
          (rule as unknown as Record<string, unknown>)[relation] = undefined;
        }

        return Promise.resolve(fakeAlertEpisode());
      });

      spies.findRule.mockResolvedValue(rule as never);

      return rule;
    }

    async function runGuardScenario(
      methods: Record<string, unknown>,
      relationsToDrop: Array<string>,
    ): Promise<void> {
      ruleThatLosesItsChannelsAfterTheCensus(methods, relationsToDrop);

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        eventSpec("AlertEpisodeCreated").makeOptions(),
      );
      await flushMicrotasks();
    }

    test("a contactable channel that no block claimed writes an Error row", async () => {
      await runGuardScenario(channelSpec("SMS").verifiedMethod(), ["userSms"]);

      for (const sender of everySender()) {
        expect(sender).not.toHaveBeenCalled();
      }

      /*
       * The whole point. Before the guard existed this execution produced no
       * message AND no row: the page was simply gone, and the on-call log went
       * on waiting for an acknowledgement that could never come.
       */
      expect(timelineRows).toHaveLength(1);
      expect(timelineRows[0]?.status).toBe(UserNotificationStatus.Error);
    });

    test("the guard's row names the event type and the channel that had no template", async () => {
      await runGuardScenario(channelSpec("SMS").verifiedMethod(), ["userSms"]);

      expect(timelineRows[0]?.statusMessage).toBe(
        "No notification template for Alert Episode Created on SMS.",
      );
    });

    test("the guard names EVERY channel the rule could have reached", async () => {
      const methods: Record<string, unknown> = {
        ...channelSpec("Email").verifiedMethod(),
        ...channelSpec("SMS").verifiedMethod(),
      };

      await runGuardScenario(methods, ["userEmail", "userSms"]);

      // In getContactableChannelNames order: Email before SMS.
      expect(timelineRows[0]?.statusMessage).toBe(
        "No notification template for Alert Episode Created on Email, SMS.",
      );
    });

    test("the guard's row carries the same identifiers a delivery row would", async () => {
      await runGuardScenario(channelSpec("SMS").verifiedMethod(), ["userSms"]);

      const row: TimelineRow | undefined = timelineRows[0];

      expect(row?.userId?.toString()).toBe(USER_ID.toString());
      expect(row?.userNotificationRuleId?.toString()).toBe(RULE_ID.toString());
      expect(row?.userNotificationLogId?.toString()).toBe(LOG_ID.toString());
      expect(row?.projectId?.toString()).toBe(PROJECT_ID.toString());
      expect(row?.userNotificationEventType).toBe(
        UserNotificationEventType.AlertEpisodeCreated,
      );
    });

    test("the guard also logs, so the miss is visible outside the timeline", async () => {
      await runGuardScenario(channelSpec("SMS").verifiedMethod(), ["userSms"]);

      expect(spies.loggerError).toHaveBeenCalled();
      expect(String(spies.loggerError.mock.calls[0][0])).toContain(
        "No notification template for Alert Episode Created on SMS.",
      );
      // The on-call log id is what lets an operator find the dropped page.
      expect(String(spies.loggerError.mock.calls[0][0])).toContain(
        LOG_ID.toString(),
      );
    });

    test("the guard builds a FRESH row rather than reusing the one the blocks write", async () => {
      /*
       * Constraint 1: the channel blocks share one UserOnCallLogTimeline
       * instance, and after its first create() it carries an _id, so a second
       * create() with it UPDATEs that row instead of inserting. Here an
       * unverified email writes the first row and a vanishing SMS trips the
       * guard; if the guard reused the shared instance it would overwrite the
       * "email not verified" row and the operator would lose one of the two
       * reasons this page failed.
       */
      const methods: Record<string, unknown> = {
        ...channelSpec("Email").unverifiedMethod!(),
        ...channelSpec("SMS").verifiedMethod(),
      };

      await runGuardScenario(methods, ["userSms"]);

      expect(timelineRows).toHaveLength(2);
      expect(timelineRows[0]?.statusMessage).toContain("not verified");
      expect(timelineRows[1]?.statusMessage).toContain(
        "No notification template",
      );
      // Two rows, two distinct instances - not one instance created twice.
      expect(timelineInstances[0]).not.toBe(timelineInstances[1]);
    });

    test("a rule with no contactable channel at all stays silent", async () => {
      /*
       * The guard is gated on the census being non-empty. A rule whose method
       * was cascade-deleted can contact nobody, so there is no missing template
       * to report - it writes nothing, which is pinned here as the deliberate
       * boundary of the guard rather than a second silent hole.
       */
      eventSpec("AlertEpisodeCreated").arm();
      spies.findRule.mockResolvedValue(ruleItem() as never);

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE_ID,
        eventSpec("AlertEpisodeCreated").makeOptions(),
      );
      await flushMicrotasks();

      for (const sender of everySender()) {
        expect(sender).not.toHaveBeenCalled();
      }
      expect(timelineRows).toHaveLength(0);
    });

    test.each<[string, string]>(FULL_MATRIX)(
      "the guard stays quiet when %s delivered for %s",
      async (channelName: string, eventName: string): Promise<void> => {
        const channel: ChannelSpec = channelSpec(channelName);
        const event: EventSpec = eventSpec(eventName);

        await deliverCell(channel, event);

        for (const row of timelineRows) {
          expect(row.statusMessage).not.toContain("No notification template");
        }
        expect(spies.loggerError).not.toHaveBeenCalled();
      },
    );

    test("an event type nothing is wired for throws before the guard can speak", async () => {
      /*
       * The guard's blind spot, recorded rather than asserted as desirable: it
       * sits AFTER the entity resolution that throws when no event branch
       * matched, so it can only ever report a channel gap for an event type
       * that already resolves an entity. A brand new event type with no
       * resolution block at all fails as a BadDataException instead - still
       * loud (the worker marks the log Error), but it never produces the
       * per-channel row the guard was written to produce.
       */
      spies.findRule.mockResolvedValue(
        ruleItem(channelSpec("SMS").verifiedMethod()) as never,
      );
      spies.incidentFind.mockResolvedValue(fakeIncident() as never);

      await expect(
        UserNotificationRuleService.executeNotificationRuleItem(RULE_ID, {
          projectId: PROJECT_ID,
          userNotificationEventType:
            "Maintenance Started" as unknown as UserNotificationEventType,
          triggeredByIncidentId: INCIDENT_ID,
          onCallPolicyId: POLICY_ID,
          userNotificationLogId: LOG_ID,
        }),
      ).rejects.toThrow(BadDataException);

      expect(spies.incidentFind).not.toHaveBeenCalled();
      expect(timelineRows).toHaveLength(0);
      expect(spies.sms).not.toHaveBeenCalled();
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (H) A send that fails still flips its row - the matrix cells above all
   * resolve, so the failure half is pinned once per channel here.
   * -----------------------------------------------------------------------
   */

  describe("a provider rejection flips the row it created", () => {
    test.each<[string]>([
      ["Email"],
      ["SMS"],
      ["WhatsApp"],
      ["Telegram"],
      ["Slack"],
      ["Microsoft Teams"],
      ["Webhook"],
      ["Call"],
      ["Push"],
    ])(
      "%s marks its incident-episode row Error when the provider rejects",
      async (channelName: string): Promise<void> => {
        const channel: ChannelSpec = channelSpec(channelName);
        const event: EventSpec = eventSpec("IncidentEpisodeCreated");

        channel.sender().mockRejectedValue(new Error("provider down") as never);

        await deliverCell(channel, event);

        /*
         * Nothing is awaited, so this update lands a microtask after
         * executeNotificationRuleItem resolved - which is why deliverCell
         * flushes. Without the flush this assertion races and passes or fails
         * depending on how many awaits the block happened to contain.
         */
        expect(spies.timelineUpdate).toHaveBeenCalledTimes(1);

        const update: {
          id: ObjectID;
          data: { status: UserNotificationStatus; statusMessage: string };
        } = spies.timelineUpdate.mock.calls[0][0] as {
          id: ObjectID;
          data: { status: UserNotificationStatus; statusMessage: string };
        };

        expect(update.id.toString()).toBe(TIMELINE_ID.toString());
        expect(update.data.status).toBe(UserNotificationStatus.Error);
        expect(update.data.statusMessage).toBe("provider down");
      },
    );
  });
});

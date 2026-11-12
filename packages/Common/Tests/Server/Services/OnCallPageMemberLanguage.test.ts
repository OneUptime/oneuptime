/*
 * The alert/incident services reach the isolated-vm native addon through the
 * template renderer they import. Nothing here runs a sandbox.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import AlertEpisodeMemberService from "../../../Server/Services/AlertEpisodeMemberService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../Server/Services/AlertService";
import CallService from "../../../Server/Services/CallService";
import IncidentEpisodeMemberService from "../../../Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../Server/Services/IncidentService";
import MailService from "../../../Server/Services/MailService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import PushNotificationService from "../../../Server/Services/PushNotificationService";
import ShortLinkService from "../../../Server/Services/ShortLinkService";
import SmsService from "../../../Server/Services/SmsService";
import TelegramService from "../../../Server/Services/TelegramService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import UserService from "../../../Server/Services/UserService";
import WebhookService from "../../../Server/Services/WebhookService";
import WhatsAppService from "../../../Server/Services/WhatsAppService";
import WorkspaceUserNotificationService from "../../../Server/Services/WorkspaceUserNotificationService";
import LinkedAffectedResources from "../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import logger from "../../../Server/Utils/Logger";
import OnCallPageLinkToken from "../../../Server/Utils/OnCall/OnCallPageLinkToken";
import UserLanguage from "../../../Server/Utils/Notification/UserLanguage";
import PushNotificationUtil from "../../../Server/Utils/PushNotificationUtil";
import {
  FIRST_STRONG_ISOLATE,
  getServerTranslator,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Server/Utils/ServerTranslation";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import URL from "../../../Types/API/URL";
import CallRequest from "../../../Types/Call/CallRequest";
import Email from "../../../Types/Email";
import EmailMessage from "../../../Types/Email/EmailMessage";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPersonPageNotice } from "../../../Types/OnCallDutyPolicy/OnCallPersonPage";
import Phone from "../../../Types/Phone";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import { READER_LANGUAGE_CODES } from "../../../Types/ReaderLanguage";
import SMS from "../../../Types/SMS/SMS";
import TelegramMessage from "../../../Types/Telegram/TelegramMessage";
import { Translator } from "../../../Types/Translator";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import WhatsAppMessage from "../../../Types/WhatsApp/WhatsAppMessage";
import {
  WhatsAppTemplateIds,
  WhatsAppTemplateLanguage,
} from "../../../Types/WhatsApp/WhatsAppTemplates";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A PAGE IN THE LANGUAGE OF THE PERSON IT PAGES (fu-i18n-larger).
 *
 * A person who picked a language - User Profile's Language, or the
 * Dashboard's language menu - is paged in it: the delivery reads it once
 * (UserLanguage) and every channel's message takes its words from it:
 *
 *   email      the subject, the template's words (the envelope's language)
 *              and the values the service words - a default state or
 *              severity, "No root cause identified", "No resources";
 *   SMS        "Vorfall INC-42 im Projekt Acme: <title>. Bestätigen oder
 *              eskalieren: <link>", fitted as an English one is;
 *   push       "Neuer Vorfall INC-42: <title>";
 *   Telegram,  the headline, why they get it, the record's link,
 *   Slack,     acknowledge and "Can't take it? Escalate".
 *   Teams and
 *   Mattermost
 *
 * A call's words are spoken by a voice that reads English, and WhatsApp's
 * are a template Meta approved in English: both stay as they are. The
 * record's own values - its number, its title, the project's name - are
 * kept as written. A person who picked none, or whose language cannot be
 * read, is paged in English, word for word as before.
 */

const NOTIFICATION: ObjectID = new ObjectID(
  "1a700000-0000-4000-8000-000000000001",
);
const PROJECT: ObjectID = new ObjectID("1a700000-0000-4000-8000-000000000002");
const RECORD: ObjectID = new ObjectID("1a700000-0000-4000-8000-000000000003");
const RUN: ObjectID = new ObjectID("1a700000-0000-4000-8000-000000000004");
const RULE: ObjectID = new ObjectID("1a700000-0000-4000-8000-000000000005");
const USER: ObjectID = new ObjectID("1a700000-0000-4000-8000-000000000006");
const LOG: ObjectID = new ObjectID("1a700000-0000-4000-8000-000000000007");
const POLICY: ObjectID = new ObjectID("1a700000-0000-4000-8000-000000000008");
const TO_PHONE: Phone = new Phone("+15555550101");
const TO_EMAIL: Email = new Email("ana@example.com");
const VIEW: string = "https://oneuptime.example.com/dashboard/record";

const service: typeof UserNotificationRuleService = UserNotificationRuleService;

// The real signer of a page's links, before any test stands in for it.
const signLinkToken: typeof OnCallPageLinkToken.sign =
  OnCallPageLinkToken.sign.bind(OnCallPageLinkToken);

// The token every link of one notification carries here.
function linkTokenOf(userOnCallLogTimelineId: ObjectID): string {
  return `page-token-of-${userOnCallLogTimelineId.toString()}`;
}

beforeEach(() => {
  /*
   * A page's links carry a token signed with the second it was signed in
   * (OnCallPageLinkToken, a JSON web token's iat), so two renders of one
   * page that straddle a second read differently - one link's short id
   * differs - and a test comparing them failed now and then under load
   * (issue #7084). Here each notification's token is its own, whenever it
   * is signed.
   */
  jest
    .spyOn(OnCallPageLinkToken, "sign")
    .mockImplementation(
      (data: { userOnCallLogTimelineId: ObjectID }): string => {
        return linkTokenOf(data.userOnCallLogTimelineId);
      },
    );

  // One short link per long one, so two messages for one page read alike.
  const shortIds: Map<string, string> = new Map<string, string>();

  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.example.com"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);
  jest.spyOn(ShortLinkService, "saveShortLinkFor").mockImplementation((async (
    link: URL,
  ) => {
    const key: string = link.toString();

    if (!shortIds.has(key)) {
      shortIds.set(key, String(shortIds.size + 1));
    }

    return { shortId: shortIds.get(key) };
  }) as never);
  jest
    .spyOn(ShortLinkService, "getShortenedUrl")
    .mockImplementation((async (link: { shortId: string }) => {
      return URL.fromString(`https://oneuptime.example.com/l/${link.shortId}`);
    }) as never);

  const dashboard: URL = URL.fromString(VIEW);

  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(dashboard);
  jest
    .spyOn(AlertService, "getAlertLinkInDashboard")
    .mockResolvedValue(dashboard);
  jest
    .spyOn(IncidentEpisodeService, "getEpisodeLinkInDashboard")
    .mockResolvedValue(dashboard);
  jest
    .spyOn(AlertEpisodeService, "getEpisodeLinkInDashboard")
    .mockResolvedValue(dashboard);
  jest
    .spyOn(LinkedAffectedResources, "readForIncident")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LinkedAffectedResources, "readForAlert")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LinkedAffectedResources, "readForAlerts")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LinkedAffectedResources, "readForIncidents")
    .mockResolvedValue([] as never);
  jest.spyOn(AlertEpisodeMemberService, "findBy").mockResolvedValue([]);
  jest.spyOn(IncidentEpisodeMemberService, "findBy").mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function project(): Project {
  const model: Project = new Project();
  model.name = "Acme";
  return model;
}

function incident(): Incident {
  const model: Incident = new Incident();
  model.id = RECORD;
  model.projectId = PROJECT;
  model.project = project();
  model.title = "Checkout is down";
  model.incidentNumber = 42;
  model.incidentNumberWithPrefix = "INC-42";
  const state: IncidentState = new IncidentState();
  state.name = "Identified";
  model.currentIncidentState = state;
  const severity: IncidentSeverity = new IncidentSeverity();
  // A project's own name for its severity: kept as written.
  severity.name = "Sev 1";
  model.incidentSeverity = severity;
  return model;
}

function alert(): Alert {
  const model: Alert = new Alert();
  model.id = RECORD;
  model.projectId = PROJECT;
  model.project = project();
  model.title = "CPU above 90%";
  model.alertNumber = 12;
  model.alertNumberWithPrefix = "ALR-12";
  const state: AlertState = new AlertState();
  state.name = "Identified";
  model.currentAlertState = state;
  const severity: AlertSeverity = new AlertSeverity();
  // OneUptime's own default name: in the person's language.
  severity.name = "High";
  model.alertSeverity = severity;
  return model;
}

function incidentEpisode(): IncidentEpisode {
  const model: IncidentEpisode = new IncidentEpisode();
  model.id = RECORD;
  model.projectId = PROJECT;
  model.project = project();
  model.title = "Payments degraded";
  model.episodeNumber = 7;
  model.episodeNumberWithPrefix = "EP-7";
  const state: IncidentState = new IncidentState();
  state.name = "Identified";
  model.currentIncidentState = state;
  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Sev 1";
  model.incidentSeverity = severity;
  return model;
}

function alertEpisode(): AlertEpisode {
  const model: AlertEpisode = new AlertEpisode();
  model.id = RECORD;
  model.projectId = PROJECT;
  model.project = project();
  model.title = "Disk filling up";
  model.episodeNumber = 3;
  model.episodeNumberWithPrefix = "AEP-3";
  const state: AlertState = new AlertState();
  state.name = "Identified";
  model.currentAlertState = state;
  const severity: AlertSeverity = new AlertSeverity();
  severity.name = "High";
  model.alertSeverity = severity;
  return model;
}

function markdown(blocks: Array<WorkspaceMessageBlock>): string {
  return blocks
    .map((block: WorkspaceMessageBlock): string => {
      return (block as WorkspacePayloadMarkdown).text || "";
    })
    .join("\n");
}

function sayMessages(call: CallRequest): Array<string> {
  return call.data
    .map((step: unknown): string => {
      return String((step as { sayMessage?: string }).sayMessage || "");
    })
    .filter((text: string): boolean => {
      return text.length > 0;
    });
}

// A message's text without the marks that set a value apart in Persian.
function withoutIsolates(text: string): string {
  return text
    .split(FIRST_STRONG_ISOLATE)
    .join("")
    .split(POP_DIRECTIONAL_ISOLATE)
    .join("");
}

// What a channel's sender was handed, the first time it was called.
function sent<T>(sender: unknown): T {
  const calls: Array<Array<unknown>> = (
    sender as { mock: { calls: Array<Array<unknown>> } }
  ).mock.calls;

  expect(calls.length).toBeGreaterThan(0);

  return calls[0]![0] as T;
}

/*
 * ---------------------------------------------------------------------------
 * A delivery, end to end: the rule of a person who has every channel.
 * ---------------------------------------------------------------------------
 */

type ExecuteOptions = Parameters<
  typeof UserNotificationRuleService.executeNotificationRuleItem
>[1];

function executeOptions(): ExecuteOptions {
  return {
    projectId: PROJECT,
    userNotificationEventType: UserNotificationEventType.IncidentCreated,
    triggeredByIncidentId: RECORD,
    onCallPolicyId: POLICY,
    onCallPolicyExecutionLogId: RUN,
    userNotificationLogId: LOG,
  };
}

function run(pageAgainNumber?: number): OnCallDutyPolicyExecutionLog {
  const model: OnCallDutyPolicyExecutionLog =
    new OnCallDutyPolicyExecutionLog();
  model.id = RUN;

  if (pageAgainNumber !== undefined) {
    model.pageAgainNumber = pageAgainNumber;
  }

  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.acknowledgementTimeoutInMinutes = 30;
  model.onCallDutyPolicy = policy;
  return model;
}

interface Delivered {
  email: EmailMessage;
  sms: SMS;
  push: PushNotificationMessage;
  telegram: string;
  slack: {
    messageBlocks: Array<WorkspaceMessageBlock>;
    notificationText?: string | undefined;
    messageSummary: string;
  };
  call: CallRequest;
  whatsApp: WhatsAppMessage;
}

describe("a delivery writes each channel in the language of the person it pages", () => {
  let runs: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "debug").mockImplementation((): void => {
      return undefined;
    });
    jest
      .spyOn(UserOnCallLogService, "claimNotificationRuleExecution")
      .mockResolvedValue(true as never);
    jest.spyOn(UserNotificationRuleService, "findOneById").mockResolvedValue({
      id: RULE,
      _id: RULE.toString(),
      userId: USER,
      userEmail: { id: RULE, email: TO_EMAIL, isVerified: true },
      userCall: { id: RULE, phone: TO_PHONE, isVerified: true },
      userSms: { id: RULE, phone: TO_PHONE, isVerified: true },
      userWhatsApp: { id: RULE, phone: TO_PHONE, isVerified: true },
      userTelegram: { id: RULE, telegramChatId: "42", isVerified: true },
      userSlack: { id: RULE, slackUserId: "U042", isVerified: true },
      userPush: {
        id: RULE,
        deviceToken: "device-token",
        deviceType: "Web",
        isVerified: true,
      },
    } as unknown as UserNotificationRule as never);
    jest
      .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
      .mockResolvedValue(undefined as never);
    jest.spyOn(UserOnCallLogTimelineService, "create").mockResolvedValue({
      id: NOTIFICATION,
    } as UserOnCallLogTimeline as never);
    jest
      .spyOn(UserOnCallLogTimelineService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident() as never);
    jest.spyOn(MailService, "sendMail").mockResolvedValue(undefined as never);
    jest.spyOn(SmsService, "sendSms").mockResolvedValue(undefined as never);
    jest.spyOn(CallService, "makeCall").mockResolvedValue(undefined as never);
    jest
      .spyOn(TelegramService, "sendTelegramMessage")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(WhatsAppService, "sendWhatsAppMessage")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(WorkspaceUserNotificationService, "sendDirectMessageToUser")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(WebhookService, "sendWebhook")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(PushNotificationService, "sendPushNotification")
      .mockResolvedValue(undefined as never);

    runs = jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(run() as never);
  });

  const deliver: () => Promise<Delivered> = async (): Promise<Delivered> => {
    await UserNotificationRuleService.executeNotificationRuleItem(
      RULE,
      executeOptions(),
    );

    return {
      email: sent<EmailMessage>(MailService.sendMail),
      sms: sent<SMS>(SmsService.sendSms),
      push: sent<{ message: PushNotificationMessage }>(
        PushNotificationService.sendPushNotification,
      ).message,
      telegram: sent<TelegramMessage>(TelegramService.sendTelegramMessage).body,
      slack: sent<Delivered["slack"]>(
        WorkspaceUserNotificationService.sendDirectMessageToUser,
      ),
      call: sent<CallRequest>(CallService.makeCall),
      whatsApp: sent<WhatsAppMessage>(WhatsAppService.sendWhatsAppMessage),
    };
  };

  test("German: the email, the text, the push, Telegram and Slack are in German", async () => {
    const language: jest.SpyInstance = jest
      .spyOn(UserLanguage, "getLanguage")
      .mockResolvedValue("de");

    const delivered: Delivered = await deliver();

    // Read once for the whole delivery, for the person the rule is theirs.
    expect(language).toHaveBeenCalledTimes(1);
    expect(String(language.mock.calls[0]![0])).toBe(USER.toString());

    // The email: its envelope says German, so the template's words follow.
    expect(delivered.email.language).toBe("de");
    expect(delivered.email.subject).toBe(
      "HANDLUNG ERFORDERLICH: Vorfall INC-42 erstellt - Checkout is down",
    );
    expect(delivered.email.vars["incidentTitle"]).toBe("Checkout is down");
    expect(delivered.email.vars["projectName"]).toBe("Acme");
    // OneUptime's own state name in German; the project's severity as written.
    expect(delivered.email.vars["currentState"]).toBe("Identifiziert");
    expect(delivered.email.vars["incidentSeverity"]).toBe("Sev 1");
    expect(delivered.email.vars["resourcesAffected"]).toBe(
      "Keine Ressourcen ermittelt",
    );
    expect(delivered.email.vars["rootCause"]).toContain(
      "Für diesen Vorfall wurde keine Grundursache ermittelt",
    );

    // The text message, in one GSM-7 part as ever.
    expect(delivered.sms.message).toBe(
      "OneUptime: Vorfall INC-42 (Sev 1) im Projekt Acme: Checkout is down. Bestätigen oder eskalieren: https://oneuptime.example.com/l/1",
    );

    // The push: its words in German, what the app routes a tap by unchanged.
    expect(delivered.push.title).toBe("Neuer Vorfall INC-42: Checkout is down");
    expect(delivered.push.body).toBe(
      "Neuer Vorfall: INC-42 (Checkout is down) in Acme. Tippen Sie für Details.",
    );
    expect(delivered.push.data).toEqual({
      type: "incident-created",
      entityType: "incident",
      entityId: RECORD.toString(),
      projectId: PROJECT.toString(),
      incidentTitle: "Checkout is down",
      projectName: "Acme",
      url: VIEW,
    });

    // Telegram.
    expect(delivered.telegram).toContain("<b>Neuer Vorfall für Sie</b>");
    expect(delivered.telegram).toContain(
      "Sie erhalten diese Nachricht, weil Sie Bereitschaft haben.",
    );
    expect(delivered.telegram).toContain(">Vorfall in OneUptime ansehen</a>");
    expect(delivered.telegram).toContain(">Zum Bestätigen tippen</a>");
    expect(delivered.telegram).toContain(">Keine Zeit? Eskalieren</a>");

    // Slack, and the notification a locked phone shows.
    const slack: string = markdown(delivered.slack.messageBlocks);

    expect(slack).toContain("**Neuer Vorfall für Sie**");
    expect(slack).toContain("INC-42 — Checkout is down");
    expect(slack).toContain("[Bestätigen](");
    expect(slack).toContain("[Keine Zeit? Eskalieren](");
    expect(slack).toContain("[Vorfall in OneUptime ansehen](");
    expect(delivered.slack.notificationText).toContain("Neuer Vorfall für Sie");
    // The on-call log's own line is for the project's admins: English.
    expect(delivered.slack.messageSummary).toBe(
      "On-call notification: incident created.",
    );

    // The call is spoken in English, and WhatsApp's template is Meta's.
    expect(sayMessages(delivered.call)[1]).toBe(
      "A new incident has been created",
    );
    expect(delivered.whatsApp.templateLanguageCode).toBe(
      WhatsAppTemplateLanguage[WhatsAppTemplateIds.IncidentCreated],
    );
  });

  /*
   * A person whose language is Arabic: every channel OneUptime words is in
   * Arabic, read from the right, its figures in Latin digits, and the
   * record's own values as the team wrote them.
   */
  test("Arabic: the email, the text, the push, Telegram and Slack are in Arabic", async () => {
    const language: jest.SpyInstance = jest
      .spyOn(UserLanguage, "getLanguage")
      .mockResolvedValue("ar");

    const delivered: Delivered = await deliver();
    // A value set apart, so it reads its own way inside the Arabic line.
    const own: (value: string) => string = (value: string): string => {
      return `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`;
    };

    expect(language).toHaveBeenCalledTimes(1);
    expect(String(language.mock.calls[0]![0])).toBe(USER.toString());
    expect(delivered.email.language).toBe("ar");
    expect({
      subject: delivered.email.subject,
      currentState: delivered.email.vars["currentState"],
      incidentSeverity: delivered.email.vars["incidentSeverity"],
      incidentTitle: delivered.email.vars["incidentTitle"],
      resourcesAffected: delivered.email.vars["resourcesAffected"],
      sms: delivered.sms.message,
      pushTitle: delivered.push.title,
      pushBody: delivered.push.body,
    }).toEqual({
      subject: `إجراء مطلوب: أُنشئت الحادثة ${own("INC-42")} - ${own("Checkout is down")}`,
      // OneUptime's own state name in Arabic; the project's severity as written.
      currentState: "تم التحديد",
      incidentSeverity: "Sev 1",
      incidentTitle: "Checkout is down",
      resourcesAffected: "لم تُحدَّد أي موارد",
      sms: `OneUptime: ${own(`الحادثة ${own("INC-42")} (Sev 1)`)} في ${own("Acme")}: Checkout is down. أقِرّ أو صعّد: https://oneuptime.example.com/l/1`,
      pushTitle: `حادثة جديدة ${own("INC-42")}: ${own("Checkout is down")}`,
      pushBody: `أُنشئت حادثة جديدة: ${own("INC-42 (Checkout is down)")} في ${own("Acme")}. انقر لعرض التفاصيل.`,
    });

    // What the app routes a tap by is unchanged.
    expect(delivered.push.data).toEqual({
      type: "incident-created",
      entityType: "incident",
      entityId: RECORD.toString(),
      projectId: PROJECT.toString(),
      incidentTitle: "Checkout is down",
      projectName: "Acme",
      url: VIEW,
    });

    // Telegram and Slack are in Arabic, with no Persian or Arabic-Indic digit.
    const slack: string = markdown(delivered.slack.messageBlocks);

    for (const text of [delivered.telegram, slack]) {
      expect(text).toMatch(/[ء-ي]/);
      expect(text).not.toMatch(/[٠-٩۰-۹]/);
      expect(text).toContain("Checkout is down");
    }

    // The call is spoken in English, as every page's call is.
    expect(sayMessages(delivered.call)[1]).toBe(
      "A new incident has been created",
    );
  });

  test("German, paged again: every message says it is still not resolved, in German", async () => {
    jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue("de");
    runs.mockResolvedValue(run(1) as never);

    const delivered: Delivered = await deliver();

    expect(delivered.email.subject).toBe(
      "HANDLUNG ERFORDERLICH: Vorfall INC-42 noch nicht behoben - Checkout is down",
    );
    expect(delivered.email.vars["pageAgainInfo"]).toBe(
      "Dieser Vorfall im Projekt Acme ist 30 Minuten nach der Bestätigung noch immer nicht behoben.",
    );
    expect(delivered.sms.message).toContain(
      "Vorfall INC-42 (Sev 1) im Projekt Acme ist noch nicht behoben: Checkout is down.",
    );
    expect(delivered.push.title).toBe(
      "Vorfall INC-42 noch nicht behoben: Checkout is down",
    );
    expect(delivered.telegram).toContain(
      "Sie erhalten diese Nachricht, weil das Problem 30 Minuten nach der Bestätigung noch immer nicht behoben ist.",
    );
    // The call says so in English, as a call always has.
    expect(sayMessages(delivered.call)[1]).toBe(
      "An incident is still not resolved 30 minutes after it was acknowledged",
    );
  });

  test("a person who picked none is paged in English, word for word as before", async () => {
    jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue("en");

    const delivered: Delivered = await deliver();

    // No language on an English email's envelope: it is as it was.
    expect("language" in delivered.email).toBe(false);
    expect(delivered.email.subject).toBe(
      "ACTION REQUIRED: Incident INC-42 created - Checkout is down",
    );
    expect(delivered.email.vars["currentState"]).toBe("Identified");
    expect(delivered.email.vars["resourcesAffected"]).toBe(
      "No resources identified",
    );
    expect(delivered.sms.message).toBe(
      "OneUptime: Sev 1 incident INC-42 in Acme: Checkout is down. Ack or escalate: https://oneuptime.example.com/l/1",
    );
    expect(delivered.push.title).toBe("New Incident INC-42: Checkout is down");
    expect(delivered.push.body).toBe(
      "A new incident has been created: INC-42 (Checkout is down) in Acme. Click to view details.",
    );
    expect(delivered.telegram).toContain("<b>New incident assigned to you</b>");
    expect(delivered.telegram).toContain(">Tap to acknowledge</a>");
    expect(markdown(delivered.slack.messageBlocks)).toContain(
      "[Can't take it? Escalate](",
    );
  });

  test("a person whose language cannot be read is paged in English, and the page goes out", async () => {
    // The real UserLanguage, over a read that fails.
    jest
      .spyOn(UserService, "findOneById")
      .mockRejectedValue(new Error("database is gone") as never);

    const delivered: Delivered = await deliver();

    expect(delivered.email.subject).toBe(
      "ACTION REQUIRED: Incident INC-42 created - Checkout is down",
    );
    expect(delivered.sms.message).toContain("Ack or escalate: ");
    expect(delivered.push.title).toBe("New Incident INC-42: Checkout is down");
    expect(CallService.makeCall).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendWhatsAppMessage).toHaveBeenCalledTimes(1);
    // Said where an operator reads the page's best-effort reads.
    expect(
      (logger.debug as unknown as jest.SpyInstance).mock.calls.some(
        (call: Array<unknown>): boolean => {
          return String(call[0]).startsWith(
            `Could not read the language of user ${USER.toString()}`,
          );
        },
      ),
    ).toBe(true);
  });

  test("the language is read with the person's own id, as OneUptime, never their name or email", async () => {
    const read: jest.SpyInstance = jest
      .spyOn(UserService, "findOneById")
      .mockImplementation((async () => {
        const user: User = new User(USER);
        user.language = "fr";
        return user;
      }) as never);

    const delivered: Delivered = await deliver();

    expect(read).toHaveBeenCalledTimes(1);

    const options: { id: ObjectID; select: unknown; props: unknown } = read.mock
      .calls[0]![0] as { id: ObjectID; select: unknown; props: unknown };

    expect(options.id.toString()).toBe(USER.toString());
    expect(options.select).toEqual({ language: true });
    expect(options.props).toEqual({ isRoot: true });
    expect(delivered.email.language).toBe("fr");
    expect(delivered.push.title).not.toContain("New Incident");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Every kind of record, every channel, every language OneUptime writes in.
 * ---------------------------------------------------------------------------
 */

interface Messages {
  email: EmailMessage;
  sms: SMS;
  telegram: string;
  workspace: string;
  push: PushNotificationMessage;
}

interface Kind {
  name: string;
  number: string;
  title: string;
  messages: (
    translator?: Translator,
    isObserverPage?: boolean,
  ) => Promise<Messages>;
}

const KINDS: Array<Kind> = [
  {
    name: "an incident",
    number: "INC-42",
    title: "Checkout is down",
    messages: async (
      translator?: Translator,
      isObserverPage?: boolean,
    ): Promise<Messages> => {
      return {
        email: await service.generateEmailTemplateForIncidentCreated(
          TO_EMAIL,
          incident(),
          NOTIFICATION,
          undefined,
          undefined,
          isObserverPage,
          translator,
        ),
        sms: await service.generateSmsTemplateForIncidentCreated(
          TO_PHONE,
          incident(),
          NOTIFICATION,
          undefined,
          undefined,
          isObserverPage,
          translator,
        ),
        telegram: await service.generateTelegramBodyForIncidentCreated(
          incident(),
          NOTIFICATION,
          undefined,
          undefined,
          isObserverPage,
          translator,
        ),
        workspace: markdown(
          await service.generateWorkspaceMessageBlocksForIncidentCreated(
            incident(),
            NOTIFICATION,
            undefined,
            undefined,
            isObserverPage,
            translator,
          ),
        ),
        push: PushNotificationUtil.createIncidentCreatedNotification({
          incidentTitle: "Checkout is down",
          projectName: "Acme",
          incidentViewLink: VIEW,
          incidentNumberWithPrefix: "INC-42",
          isObserverPage: isObserverPage,
          translator: translator,
        }),
      };
    },
  },
  {
    name: "an alert",
    number: "ALR-12",
    title: "CPU above 90%",
    messages: async (
      translator?: Translator,
      isObserverPage?: boolean,
    ): Promise<Messages> => {
      return {
        email: await service.generateEmailTemplateForAlertCreated(
          TO_EMAIL,
          alert(),
          NOTIFICATION,
          undefined,
          undefined,
          isObserverPage,
          translator,
        ),
        sms: await service.generateSmsTemplateForAlertCreated(
          TO_PHONE,
          alert(),
          NOTIFICATION,
          undefined,
          undefined,
          isObserverPage,
          translator,
        ),
        telegram: await service.generateTelegramBodyForAlertCreated(
          alert(),
          NOTIFICATION,
          undefined,
          undefined,
          isObserverPage,
          translator,
        ),
        workspace: markdown(
          await service.generateWorkspaceMessageBlocksForAlertCreated(
            alert(),
            NOTIFICATION,
            undefined,
            undefined,
            isObserverPage,
            translator,
          ),
        ),
        push: PushNotificationUtil.createAlertCreatedNotification({
          alertTitle: "CPU above 90%",
          projectName: "Acme",
          alertViewLink: VIEW,
          alertNumberWithPrefix: "ALR-12",
          isObserverPage: isObserverPage,
          translator: translator,
        }),
      };
    },
  },
  {
    name: "an incident episode",
    number: "EP-7",
    title: "Payments degraded",
    messages: async (
      translator?: Translator,
      isObserverPage?: boolean,
    ): Promise<Messages> => {
      return {
        email: await service.generateEmailTemplateForIncidentEpisodeCreated(
          TO_EMAIL,
          incidentEpisode(),
          NOTIFICATION,
          undefined,
          isObserverPage,
          translator,
        ),
        sms: await service.generateSmsTemplateForIncidentEpisodeCreated(
          TO_PHONE,
          incidentEpisode(),
          NOTIFICATION,
          undefined,
          isObserverPage,
          translator,
        ),
        telegram: await service.generateTelegramBodyForIncidentEpisodeCreated(
          incidentEpisode(),
          NOTIFICATION,
          undefined,
          isObserverPage,
          translator,
        ),
        workspace: markdown(
          await service.generateWorkspaceMessageBlocksForIncidentEpisodeCreated(
            incidentEpisode(),
            NOTIFICATION,
            undefined,
            isObserverPage,
            translator,
          ),
        ),
        push: PushNotificationUtil.createIncidentEpisodeCreatedNotification({
          incidentEpisodeTitle: "Payments degraded",
          projectName: "Acme",
          incidentEpisodeViewLink: VIEW,
          episodeNumberWithPrefix: "EP-7",
          isObserverPage: isObserverPage,
          translator: translator,
        }),
      };
    },
  },
  {
    name: "an alert episode",
    number: "AEP-3",
    title: "Disk filling up",
    messages: async (
      translator?: Translator,
      isObserverPage?: boolean,
    ): Promise<Messages> => {
      return {
        email: await service.generateEmailTemplateForAlertEpisodeCreated(
          TO_EMAIL,
          alertEpisode(),
          NOTIFICATION,
          undefined,
          isObserverPage,
          translator,
        ),
        sms: await service.generateSmsTemplateForAlertEpisodeCreated(
          TO_PHONE,
          alertEpisode(),
          NOTIFICATION,
          undefined,
          isObserverPage,
          translator,
        ),
        telegram: await service.generateTelegramBodyForAlertEpisodeCreated(
          alertEpisode(),
          NOTIFICATION,
          undefined,
          isObserverPage,
          translator,
        ),
        workspace: markdown(
          await service.generateWorkspaceMessageBlocksForAlertEpisodeCreated(
            alertEpisode(),
            NOTIFICATION,
            undefined,
            isObserverPage,
            translator,
          ),
        ),
        push: PushNotificationUtil.createAlertEpisodeCreatedNotification({
          alertEpisodeTitle: "Disk filling up",
          projectName: "Acme",
          alertEpisodeViewLink: VIEW,
          episodeNumberWithPrefix: "AEP-3",
          isObserverPage: isObserverPage,
          translator: translator,
        }),
      };
    },
  },
];

/*
 * Sentences only an English page says: a page in another language says
 * none of them. (Whole sentences, not words: "Incident" is French too.)
 */
const ENGLISH_ONLY: ReadonlyArray<string> = [
  "ACTION REQUIRED",
  "Ack or escalate",
  "assigned to you",
  "You're getting this because",
  "Tap to acknowledge",
  "Can't take it? Escalate",
  "[Acknowledge](",
  // "View incident in OneUptime", as Telegram's and chat's links read.
  ">View ",
  "[View ",
  "has been created",
  "Click to view details",
  "No resources identified",
  "No root cause identified",
];

const OTHER_LANGUAGES: Array<string> = READER_LANGUAGE_CODES.filter(
  (code: string): boolean => {
    return code !== "en";
  },
);

describe("every channel's message for every kind of record", () => {
  test.each(OTHER_LANGUAGES)(
    "%s: no English sentence is left, and the record's values are kept as written",
    async (code: string) => {
      const translator: Translator = getServerTranslator(code);

      for (const kind of KINDS) {
        const messages: Messages = await kind.messages(translator);
        const texts: Record<string, string> = {
          subject: messages.email.subject,
          vars: Object.values(messages.email.vars).join("\n"),
          sms: messages.sms.message,
          telegram: messages.telegram,
          workspace: messages.workspace,
          push: `${messages.push.title}\n${messages.push.body}`,
        };

        expect([kind.name, messages.email.language]).toEqual([kind.name, code]);

        for (const [channel, text] of Object.entries(texts)) {
          for (const sentence of ENGLISH_ONLY) {
            expect([
              kind.name,
              channel,
              sentence,
              text.includes(sentence),
            ]).toEqual([kind.name, channel, sentence, false]);
          }
        }

        for (const [channel, text] of Object.entries(texts)) {
          if (channel === "vars") {
            continue;
          }

          const plain: string = withoutIsolates(text);

          expect([kind.name, channel, plain.includes(kind.number)]).toEqual([
            kind.name,
            channel,
            true,
          ]);
        }

        // The title is the record's own: kept as written wherever it goes.
        for (const channel of ["subject", "sms", "telegram", "push"]) {
          const plain: string = withoutIsolates(texts[channel] as string);

          expect([kind.name, channel, plain.includes(kind.title)]).toEqual([
            kind.name,
            channel,
            true,
          ]);
        }
      }
    },
  );

  test("English, named or not, writes every message exactly as before", async () => {
    for (const kind of KINDS) {
      const withoutLanguage: Messages = await kind.messages();
      const inEnglish: Messages = await kind.messages(
        getServerTranslator("en"),
      );

      expect([kind.name, inEnglish]).toEqual([kind.name, withoutLanguage]);
      expect("language" in withoutLanguage.email).toBe(false);
      expect(
        withoutLanguage.email.subject.startsWith("ACTION REQUIRED: "),
      ).toBe(true);
      expect(withoutLanguage.sms.message).toContain("Ack or escalate: ");
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * A page's links, whenever they are signed (issue #7084).
 * ---------------------------------------------------------------------------
 */

describe("a page's links read alike whenever they are signed", () => {
  // Just before a second ends: the next render signs in the next second.
  const JUST_BEFORE_A_SECOND_ENDS: number = Date.UTC(
    2026,
    10,
    12,
    9,
    30,
    0,
    999,
  );

  test("the real signer's token moves with its clock: two signings a second apart differ", () => {
    let now: number = JUST_BEFORE_A_SECOND_ENDS;
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return now;
    });

    const first: string = signLinkToken({
      userOnCallLogTimelineId: NOTIFICATION,
    });
    now += 1000;
    const second: string = signLinkToken({
      userOnCallLogTimelineId: NOTIFICATION,
    });

    expect(second).not.toBe(first);

    // Both are good for the notification: only the second they carry differs.
    for (const token of [first, second]) {
      expect(
        OnCallPageLinkToken.isValid({
          token: token,
          userOnCallLogTimelineId: NOTIFICATION,
        }),
      ).toBe(true);
    }
  });

  test("every message's links carry the notification's own token here", async () => {
    const saved: Array<string> = [];

    (
      ShortLinkService.saveShortLinkFor as unknown as jest.Mock
    ).mockImplementation((async (link: URL) => {
      saved.push(link.toString());
      return { shortId: String(saved.length) };
    }) as never);

    for (const kind of KINDS) {
      await kind.messages();
    }

    const pageLinks: Array<string> = saved.filter((link: string): boolean => {
      return link.includes("pageToken=");
    });

    expect(pageLinks.length).toBeGreaterThan(0);

    for (const link of pageLinks) {
      expect(link).toContain(`pageToken=${linkTokenOf(NOTIFICATION)}`);
    }
  });

  test("a responder's messages, rendered twice with the clock a second on between the two, read alike", async () => {
    let now: number = JUST_BEFORE_A_SECOND_ENDS;
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return now;
    });

    for (const kind of KINDS) {
      const first: Messages = await kind.messages();
      now += 1000;
      const second: Messages = await kind.messages(getServerTranslator("en"));

      expect([kind.name, second]).toEqual([kind.name, first]);
    }
  });

  test("an observer's messages, rendered twice with the clock a second on between the two, read alike", async () => {
    let now: number = JUST_BEFORE_A_SECOND_ENDS;
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return now;
    });

    for (const kind of KINDS) {
      const first: Messages = await kind.messages(undefined, true);
      now += 1000;
      const second: Messages = await kind.messages(
        getServerTranslator("en"),
        true,
      );

      expect([kind.name, second]).toEqual([kind.name, first]);
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * A person's page (OnCallPersonPage), in the language of the person paged.
 * ---------------------------------------------------------------------------
 */

describe("a person's page, in the language of the person it pages", () => {
  const NOTICE: OnCallPersonPageNotice = {
    pagedByName: "Alice Kim",
    teamName: "Platform",
    message: "Can you check the database?",
  };
  const GERMAN: Translator = getServerTranslator("de");

  test("the email says who paged whom, in German", async () => {
    const email: EmailMessage =
      await service.generateEmailTemplateForIncidentCreated(
        TO_EMAIL,
        incident(),
        NOTIFICATION,
        undefined,
        NOTICE,
        undefined,
        GERMAN,
      );

    expect(email.language).toBe("de");
    expect(email.subject).toBe(
      "HANDLUNG ERFORDERLICH: Alice Kim hat Platform alarmiert, wegen Vorfall INC-42 - Checkout is down",
    );
  });

  test("the text message says it in German, the message as it was written", async () => {
    const sms: SMS = await service.generateSmsTemplateForAlertCreated(
      TO_PHONE,
      alert(),
      NOTIFICATION,
      undefined,
      NOTICE,
      undefined,
      GERMAN,
    );

    expect(sms.message).toContain(
      "Alice Kim hat Platform alarmiert, wegen Warnung ALR-12 (Hoch)",
    );
    expect(sms.message).toContain("Bestätigen oder eskalieren: ");
  });

  test("the push says it in German, with what they wrote", () => {
    const push: PushNotificationMessage =
      PushNotificationUtil.createIncidentCreatedNotification({
        incidentTitle: "Checkout is down",
        projectName: "Acme",
        incidentViewLink: VIEW,
        incidentNumberWithPrefix: "INC-42",
        personPage: NOTICE,
        translator: GERMAN,
      });

    expect(push.title).toBe("Alice Kim hat Platform alarmiert: Vorfall INC-42");
    expect(push.body).toContain("„Can you check the database?“");
  });

  test("Telegram and Slack say why this person, in German", async () => {
    const telegram: string =
      await service.generateTelegramBodyForIncidentCreated(
        incident(),
        NOTIFICATION,
        undefined,
        NOTICE,
        undefined,
        GERMAN,
      );
    const slack: string = markdown(
      await service.generateWorkspaceMessageBlocksForIncidentCreated(
        incident(),
        NOTIFICATION,
        undefined,
        NOTICE,
        undefined,
        GERMAN,
      ),
    );

    for (const text of [telegram, slack]) {
      expect(text).toContain("Alice Kim hat Platform alarmiert");
      expect(text).toContain(
        "Sie erhalten diese Nachricht, weil Sie Mitglied von Platform sind.",
      );
      // What they wrote, quoted as German quotes it.
      expect(text).toContain("💬 „Can you check the database?“");
    }
  });

  test("Persian quotes the message in its own marks, set apart to read its own way", async () => {
    const PERSIAN: Translator = getServerTranslator("fa");
    const quoted: string = `💬 «${FIRST_STRONG_ISOLATE}Can you check the database?${POP_DIRECTIONAL_ISOLATE}»`;

    const telegram: string =
      await service.generateTelegramBodyForIncidentCreated(
        incident(),
        NOTIFICATION,
        undefined,
        NOTICE,
        undefined,
        PERSIAN,
      );
    const slack: string = markdown(
      await service.generateWorkspaceMessageBlocksForIncidentCreated(
        incident(),
        NOTIFICATION,
        undefined,
        NOTICE,
        undefined,
        PERSIAN,
      ),
    );

    expect(telegram).toContain(quoted);
    expect(slack).toContain(quoted);
  });
});

/*
 * ---------------------------------------------------------------------------
 * An observer's page (OnCallObserverPage), in the language of the person
 * it pages: kept informed while others respond, and its one answer says
 * they have seen it - in their words, around the record's own values.
 * ---------------------------------------------------------------------------
 */

// Phrases only an English observer's page says.
const OBSERVER_ENGLISH_ONLY: ReadonlyArray<string> = [
  "FYI",
  "paged as an observer",
  "as observers",
  "keep you informed",
  "people responding",
  "I've seen it",
  "Mark seen",
  "Tap to view",
  "Seen it?",
];

describe("an observer's page, in the language of the person it pages", () => {
  test.each(OTHER_LANGUAGES)(
    "%s: every channel says it in the person's words, with nothing to escalate",
    async (code: string) => {
      const translator: Translator = getServerTranslator(code);

      for (const kind of KINDS) {
        const messages: Messages = await kind.messages(translator, true);
        const texts: Record<string, string> = {
          subject: messages.email.subject,
          vars: Object.values(messages.email.vars).join("\n"),
          sms: messages.sms.message,
          telegram: messages.telegram,
          workspace: messages.workspace,
          push: `${messages.push.title}\n${messages.push.body}`,
        };

        expect([kind.name, messages.email.language]).toEqual([kind.name, code]);
        // The email says what an observer's page is, and why they get it.
        expect([
          kind.name,
          Boolean(messages.email.vars["observerPageInfo"]),
          Boolean(messages.email.vars["observerPageWhy"]),
        ]).toEqual([kind.name, true, true]);
        // Nothing to escalate.
        expect([kind.name, "passOnLink" in messages.email.vars]).toEqual([
          kind.name,
          false,
        ]);

        for (const [channel, text] of Object.entries(texts)) {
          for (const phrase of [...ENGLISH_ONLY, ...OBSERVER_ENGLISH_ONLY]) {
            expect([kind.name, channel, phrase, text.includes(phrase)]).toEqual(
              [kind.name, channel, phrase, false],
            );
          }
        }

        // The record's number and title, kept as written.
        for (const channel of ["subject", "sms", "telegram", "push"]) {
          const plain: string = withoutIsolates(texts[channel] as string);

          expect([
            kind.name,
            channel,
            plain.includes(kind.number),
            plain.includes(kind.title),
          ]).toEqual([kind.name, channel, true, true]);
        }
      }
    },
  );

  test("English, named or not, writes every observer message exactly as before", async () => {
    for (const kind of KINDS) {
      const withoutLanguage: Messages = await kind.messages(undefined, true);
      const inEnglish: Messages = await kind.messages(
        getServerTranslator("en"),
        true,
      );

      expect([kind.name, inEnglish]).toEqual([kind.name, withoutLanguage]);
      expect(withoutLanguage.email.subject.startsWith("FYI (observer): ")).toBe(
        true,
      );
      expect(withoutLanguage.sms.message).toContain("Mark seen: ");
      expect(withoutLanguage.telegram).toContain(">I've seen it</a>");
      expect(withoutLanguage.workspace).toContain("[I've seen it](");
    }
  });

  const GERMAN: Translator = getServerTranslator("de");

  test("German: the email, the text, the push, Telegram and Slack, word for word", async () => {
    const email: EmailMessage =
      await service.generateEmailTemplateForIncidentCreated(
        TO_EMAIL,
        incident(),
        NOTIFICATION,
        undefined,
        undefined,
        true,
        GERMAN,
      );

    expect(email.subject).toBe(
      "Zur Info (Beobachter): Vorfall INC-42 - Checkout is down",
    );
    expect(email.vars["observerPageInfo"]).toBe(
      "Sie wurden als Beobachter alarmiert, damit Sie informiert bleiben: Die Zuständigen kümmern sich weiter um diesen Vorfall. Wenn Sie diesen Alarm bestätigen, heißt das nur, dass Sie ihn gesehen haben. Der Vorfall wird dadurch nicht bestätigt.",
    );
    expect(email.vars["observerPageWhy"]).toBe(
      "Sie erhalten diese E-Mail, weil Sie als Beobachter alarmiert wurden: Sie bleiben über diesen Vorfall informiert, während sich die Zuständigen darum kümmern.",
    );

    const sms: SMS = await service.generateSmsTemplateForAlertCreated(
      TO_PHONE,
      alert(),
      NOTIFICATION,
      undefined,
      undefined,
      true,
      GERMAN,
    );

    // One GSM-7 part, as an English observer's text.
    expect(sms.message).toBe(
      "OneUptime Zur Info (Beobachter): Warnung ALR-12 (Hoch) im Projekt Acme: CPU above 90%. Als gesehen markieren: https://oneuptime.example.com/l/1",
    );

    const push: PushNotificationMessage =
      PushNotificationUtil.createIncidentCreatedNotification({
        incidentTitle: "Checkout is down",
        projectName: "Acme",
        incidentViewLink: VIEW,
        incidentNumberWithPrefix: "INC-42",
        isObserverPage: true,
        translator: GERMAN,
      });

    expect(push.title).toBe("Zur Info: Vorfall INC-42: Checkout is down");
    expect(push.body).toBe(
      "Sie wurden als Beobachter alarmiert, im Projekt Acme: Die Zuständigen kümmern sich weiter um diesen Vorfall. Tippen Sie zum Ansehen.",
    );

    const telegram: string =
      await service.generateTelegramBodyForIncidentCreated(
        incident(),
        NOTIFICATION,
        undefined,
        undefined,
        true,
        GERMAN,
      );
    const slack: string = markdown(
      await service.generateWorkspaceMessageBlocksForIncidentCreated(
        incident(),
        NOTIFICATION,
        undefined,
        undefined,
        true,
        GERMAN,
      ),
    );

    expect(telegram).toContain("<b>Sie wurden als Beobachter alarmiert</b>");
    expect(telegram).toContain(">Ich habe es gesehen</a>");
    expect(slack).toContain("**Sie wurden als Beobachter alarmiert**");
    expect(slack).toContain("[Ich habe es gesehen](");

    for (const text of [telegram, slack]) {
      expect(text).toContain(
        "Die Zuständigen kümmern sich weiter um diesen Vorfall.",
      );
      // Nothing to escalate, in any language.
      expect(text).not.toContain("Eskalieren");
      expect(text).not.toContain("Zum Bestätigen tippen");
    }
  });

  test("a person's observer page says who paged them as an observer, in German", async () => {
    const NOTICE: OnCallPersonPageNotice = {
      pagedByName: "Alice Kim",
      teamName: "Platform",
    };

    const sms: SMS = await service.generateSmsTemplateForIncidentCreated(
      TO_PHONE,
      incident(),
      NOTIFICATION,
      undefined,
      NOTICE,
      true,
      GERMAN,
    );
    const push: PushNotificationMessage =
      PushNotificationUtil.createIncidentCreatedNotification({
        incidentTitle: "Checkout is down",
        projectName: "Acme",
        incidentViewLink: VIEW,
        incidentNumberWithPrefix: "INC-42",
        personPage: NOTICE,
        isObserverPage: true,
        translator: GERMAN,
      });
    const email: EmailMessage =
      await service.generateEmailTemplateForIncidentCreated(
        TO_EMAIL,
        incident(),
        NOTIFICATION,
        undefined,
        NOTICE,
        true,
        GERMAN,
      );
    const telegram: string =
      await service.generateTelegramBodyForIncidentCreated(
        incident(),
        NOTIFICATION,
        undefined,
        NOTICE,
        true,
        GERMAN,
      );

    expect(sms.message).toContain(
      "OneUptime: Alice Kim hat Platform als Beobachter alarmiert, wegen Vorfall INC-42 (Sev 1)",
    );
    expect(sms.message).toContain("Als gesehen markieren: ");
    expect(push.body).toBe(
      "Alice Kim hat Platform als Beobachter alarmiert, im Projekt Acme: Die Zuständigen kümmern sich weiter um diesen Vorfall. Tippen Sie zum Ansehen.",
    );
    expect(email.subject).toBe(
      "Zur Info (Beobachter): Alice Kim hat Platform alarmiert, wegen Vorfall INC-42 - Checkout is down",
    );
    // Why this person, then what an observer's page is: two sentences.
    expect(telegram).toContain(
      "Sie erhalten diese Nachricht, weil Sie Mitglied von Platform sind. Sie wurden als Beobachter alarmiert",
    );
  });

  test("a call stays in English, as every page's call does", async () => {
    const call: CallRequest =
      await service.generateCallTemplateForIncidentCreated(
        TO_PHONE,
        incident(),
        NOTIFICATION,
        undefined,
        undefined,
        true,
      );

    expect(sayMessages(call)[1]).toBe(
      "You are paged as an observer about an incident",
    );
  });
});

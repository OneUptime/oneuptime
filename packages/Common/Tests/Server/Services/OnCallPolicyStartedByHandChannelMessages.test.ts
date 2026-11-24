/*
 * The record services reach the isolated-vm native addon through the
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
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
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
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import PushNotificationService from "../../../Server/Services/PushNotificationService";
import ShortLinkService from "../../../Server/Services/ShortLinkService";
import SmsService from "../../../Server/Services/SmsService";
import TeamService from "../../../Server/Services/TeamService";
import TelegramService from "../../../Server/Services/TelegramService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import WebhookService from "../../../Server/Services/WebhookService";
import WhatsAppService from "../../../Server/Services/WhatsAppService";
import WorkspaceUserNotificationService from "../../../Server/Services/WorkspaceUserNotificationService";
import LinkedAffectedResources from "../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import logger from "../../../Server/Utils/Logger";
import PushNotificationUtil from "../../../Server/Utils/PushNotificationUtil";
import { getServerTranslator } from "../../../Server/Utils/ServerTranslation";
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
import { Translator } from "../../../Types/Translator";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A POLICY A PERSON STARTED BY HAND SAYS WHO STARTED IT, AND CARRIES THEIR
 * MESSAGE (#7838).
 *
 * Execute On-Call Policy - in the Dashboard, Slack, Microsoft Teams or
 * Mattermost - or a page that names a policy starts the policy for a record
 * that is there already, mostly acknowledged by somebody hours before.
 * Since #7596 such a run pages level by level until somebody it paged
 * answers, and every notification it sent said what an automatic run says:
 * "A new incident has been created", "New incident assigned to you",
 * "because you're on call" - at every level and every repeat, from nobody.
 * The message a page that names a policy carries was kept on the run and
 * quoted in its channel's message, and told to none of the people paged.
 *
 * Every notification that is OneUptime's own words now says who started
 * which policy, the level that pages this person, and the message:
 *
 *   call       "Alice Kim started the on-call policy Database escalation
 *              for an incident", the record, "Alice Kim says: <message>";
 *   email      subject "Alice Kim started Database escalation for Incident
 *              INC-42 - <title>", the line that says so and why this
 *              person, and the message;
 *   push       "Alice Kim started Database escalation: Incident INC-42",
 *              the title, project and message;
 *   Telegram,  "Alice Kim started Database escalation", the message, and
 *   Slack and  the level, team or schedule it pages them through;
 *   Teams DMs
 *   SMS        "OneUptime: Alice Kim started Database escalation for
 *              Critical incident INC-42 ...", in its one part.
 *
 * WhatsApp's words are a template Meta approved, and stay as they are, as
 * a person's page's do. A run OneUptime, a workflow or an API key started,
 * and a page again of a policy started by hand, read exactly as before.
 */

const NOTIFICATION: ObjectID = new ObjectID(
  "07838000-0000-4000-8000-000000000001",
);
const PROJECT: ObjectID = new ObjectID("07838000-0000-4000-8000-000000000002");
const RECORD: ObjectID = new ObjectID("07838000-0000-4000-8000-000000000003");
const RUN: ObjectID = new ObjectID("07838000-0000-4000-8000-000000000004");
const RULE: ObjectID = new ObjectID("07838000-0000-4000-8000-000000000005");
const USER: ObjectID = new ObjectID("07838000-0000-4000-8000-000000000006");
const LOG: ObjectID = new ObjectID("07838000-0000-4000-8000-000000000007");
const ALICE: ObjectID = new ObjectID("07838000-0000-4000-8000-000000000008");
const PLATFORM: ObjectID = new ObjectID("07838000-0000-4000-8000-000000000009");
const PRIMARY: ObjectID = new ObjectID("07838000-0000-4000-8000-00000000000a");
const WORKFLOW: ObjectID = new ObjectID("07838000-0000-4000-8000-00000000000b");
const POLICY: ObjectID = new ObjectID("07838000-0000-4000-8000-00000000000c");
const LEVEL: ObjectID = new ObjectID("07838000-0000-4000-8000-00000000000d");
const TO_PHONE: Phone = new Phone("+15555550101");
const TO_EMAIL: Email = new Email("ana@example.com");
const VIEW: string = "https://oneuptime.example.com/dashboard/record";

const MESSAGE: string = "Can you check the database?";

const BY_LEVEL: OnCallPersonPageNotice = {
  pagedByName: "Alice Kim",
  policyName: "Database escalation",
  policyLevel: 1,
};
const AS_TEAM: OnCallPersonPageNotice = {
  pagedByName: "Alice Kim",
  teamName: "Platform",
  policyName: "Database escalation",
  policyLevel: 2,
  message: MESSAGE,
};

beforeEach(() => {
  let shortened: number = 0;

  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.example.com"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);
  jest
    .spyOn(ShortLinkService, "saveShortLinkFor")
    .mockImplementation((async () => {
      shortened++;
      return { shortId: String(shortened) };
    }) as never);
  jest
    .spyOn(ShortLinkService, "getShortenedUrl")
    .mockImplementation((async (link: { shortId: string }) => {
      return URL.fromString(`https://oneuptime.example.com/l/${link.shortId}`);
    }) as never);
  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(URL.fromString(VIEW));
  jest
    .spyOn(AlertService, "getAlertLinkInDashboard")
    .mockResolvedValue(URL.fromString(VIEW));
  jest
    .spyOn(IncidentEpisodeService, "getEpisodeLinkInDashboard")
    .mockResolvedValue(URL.fromString(VIEW));
  jest
    .spyOn(AlertEpisodeService, "getEpisodeLinkInDashboard")
    .mockResolvedValue(URL.fromString(VIEW));
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
  state.name = "Acknowledged";
  model.currentIncidentState = state;
  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical";
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
  state.name = "Acknowledged";
  model.currentAlertState = state;
  const severity: AlertSeverity = new AlertSeverity();
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
  state.name = "Acknowledged";
  model.currentIncidentState = state;
  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical";
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
  state.name = "Acknowledged";
  model.currentAlertState = state;
  const severity: AlertSeverity = new AlertSeverity();
  severity.name = "High";
  model.alertSeverity = severity;
  return model;
}

type Notice = OnCallPersonPageNotice | undefined;

interface Kind {
  name: string;
  noun: string;
  // As a subject and a push name it: "Incident", "Alert Episode".
  label: string;
  number: string;
  title: string;
  emoji: string;
  // The SMS's words for it, after who started what.
  smsRecord: string;
  // What its first page's call, Telegram headline and push title say.
  firstCallSentence: string;
  // The record as a call says it after who started what: severity, kind, number.
  callRecord: string;
  firstHeadline: string;
  firstPushTitle: string;
  call: (notice: Notice) => Promise<CallRequest>;
  email: (notice: Notice, translator?: Translator) => Promise<EmailMessage>;
  telegram: (notice: Notice) => Promise<string>;
  workspace: (notice: Notice) => Promise<Array<WorkspaceMessageBlock>>;
  sms: (notice: Notice) => Promise<{ message: string }>;
  push: (notice: Notice, translator?: Translator) => PushNotificationMessage;
}

const service: typeof UserNotificationRuleService = UserNotificationRuleService;

const KINDS: Array<Kind> = [
  {
    name: "an incident",
    noun: "incident",
    label: "Incident",
    number: "INC-42",
    title: "Checkout is down",
    emoji: "🔥",
    smsRecord: "Critical incident INC-42",
    firstCallSentence: "A new Critical incident has been created: INC-42.",
    callRecord: "Critical incident INC-42",
    firstHeadline: "New incident assigned to you",
    firstPushTitle: "New Incident INC-42: Checkout is down",
    call: (notice: Notice) => {
      return service.generateCallTemplateForIncidentCreated(
        TO_PHONE,
        incident(),
        NOTIFICATION,
        undefined,
        notice,
      );
    },
    email: (notice: Notice, translator?: Translator) => {
      return service.generateEmailTemplateForIncidentCreated(
        TO_EMAIL,
        incident(),
        NOTIFICATION,
        undefined,
        notice,
        undefined,
        translator,
      );
    },
    telegram: (notice: Notice) => {
      return service.generateTelegramBodyForIncidentCreated(
        incident(),
        NOTIFICATION,
        undefined,
        notice,
      );
    },
    workspace: (notice: Notice) => {
      return service.generateWorkspaceMessageBlocksForIncidentCreated(
        incident(),
        NOTIFICATION,
        undefined,
        notice,
      );
    },
    sms: (notice: Notice) => {
      return service.generateSmsTemplateForIncidentCreated(
        TO_PHONE,
        incident(),
        NOTIFICATION,
        undefined,
        notice,
      );
    },
    push: (notice: Notice, translator?: Translator) => {
      return PushNotificationUtil.createIncidentCreatedNotification({
        incidentTitle: "Checkout is down",
        projectName: "Acme",
        incidentViewLink: VIEW,
        incidentNumberWithPrefix: "INC-42",
        personPage: notice,
        translator: translator,
      });
    },
  },
  {
    name: "an alert",
    noun: "alert",
    label: "Alert",
    number: "ALR-12",
    title: "CPU above 90%",
    emoji: "🚨",
    smsRecord: "High alert ALR-12",
    firstCallSentence: "A new High alert has been created: ALR-12.",
    callRecord: "High alert ALR-12",
    firstHeadline: "New alert assigned to you",
    firstPushTitle: "New Alert ALR-12: CPU above 90%",
    call: (notice: Notice) => {
      return service.generateCallTemplateForAlertCreated(
        TO_PHONE,
        alert(),
        NOTIFICATION,
        undefined,
        notice,
      );
    },
    email: (notice: Notice, translator?: Translator) => {
      return service.generateEmailTemplateForAlertCreated(
        TO_EMAIL,
        alert(),
        NOTIFICATION,
        undefined,
        notice,
        undefined,
        translator,
      );
    },
    telegram: (notice: Notice) => {
      return service.generateTelegramBodyForAlertCreated(
        alert(),
        NOTIFICATION,
        undefined,
        notice,
      );
    },
    workspace: (notice: Notice) => {
      return service.generateWorkspaceMessageBlocksForAlertCreated(
        alert(),
        NOTIFICATION,
        undefined,
        notice,
      );
    },
    sms: (notice: Notice) => {
      return service.generateSmsTemplateForAlertCreated(
        TO_PHONE,
        alert(),
        NOTIFICATION,
        undefined,
        notice,
      );
    },
    push: (notice: Notice, translator?: Translator) => {
      return PushNotificationUtil.createAlertCreatedNotification({
        alertTitle: "CPU above 90%",
        projectName: "Acme",
        alertViewLink: VIEW,
        alertNumberWithPrefix: "ALR-12",
        personPage: notice,
        translator: translator,
      });
    },
  },
  {
    name: "an incident episode",
    noun: "incident episode",
    label: "Incident Episode",
    number: "EP-7",
    title: "Payments degraded",
    emoji: "🔥",
    smsRecord: "Critical incident episode EP-7",
    firstCallSentence:
      "A new Critical incident episode has been created: EP-7.",
    callRecord: "Critical incident episode EP-7",
    firstHeadline: "New incident episode assigned to you",
    firstPushTitle: "New Incident Episode EP-7: Payments degraded",
    call: (notice: Notice) => {
      return service.generateCallTemplateForIncidentEpisodeCreated(
        TO_PHONE,
        incidentEpisode(),
        NOTIFICATION,
        undefined,
        undefined,
        notice,
      );
    },
    email: (notice: Notice, translator?: Translator) => {
      return service.generateEmailTemplateForIncidentEpisodeCreated(
        TO_EMAIL,
        incidentEpisode(),
        NOTIFICATION,
        undefined,
        undefined,
        translator,
        notice,
      );
    },
    telegram: (notice: Notice) => {
      return service.generateTelegramBodyForIncidentEpisodeCreated(
        incidentEpisode(),
        NOTIFICATION,
        undefined,
        undefined,
        undefined,
        notice,
      );
    },
    workspace: (notice: Notice) => {
      return service.generateWorkspaceMessageBlocksForIncidentEpisodeCreated(
        incidentEpisode(),
        NOTIFICATION,
        undefined,
        undefined,
        undefined,
        notice,
      );
    },
    sms: (notice: Notice) => {
      return service.generateSmsTemplateForIncidentEpisodeCreated(
        TO_PHONE,
        incidentEpisode(),
        NOTIFICATION,
        undefined,
        undefined,
        undefined,
        notice,
      );
    },
    push: (notice: Notice, translator?: Translator) => {
      return PushNotificationUtil.createIncidentEpisodeCreatedNotification({
        incidentEpisodeTitle: "Payments degraded",
        projectName: "Acme",
        incidentEpisodeViewLink: VIEW,
        episodeNumberWithPrefix: "EP-7",
        personPage: notice,
        translator: translator,
      });
    },
  },
  {
    name: "an alert episode",
    noun: "alert episode",
    label: "Alert Episode",
    number: "AEP-3",
    title: "Disk filling up",
    emoji: "🔔",
    smsRecord: "High alert episode AEP-3",
    firstCallSentence: "A new High alert episode has been created: AEP-3.",
    callRecord: "High alert episode AEP-3",
    firstHeadline: "New alert episode assigned to you",
    firstPushTitle: "New Alert Episode AEP-3: Disk filling up",
    call: (notice: Notice) => {
      return service.generateCallTemplateForAlertEpisodeCreated(
        TO_PHONE,
        alertEpisode(),
        NOTIFICATION,
        undefined,
        undefined,
        notice,
      );
    },
    email: (notice: Notice, translator?: Translator) => {
      return service.generateEmailTemplateForAlertEpisodeCreated(
        TO_EMAIL,
        alertEpisode(),
        NOTIFICATION,
        undefined,
        undefined,
        translator,
        notice,
      );
    },
    telegram: (notice: Notice) => {
      return service.generateTelegramBodyForAlertEpisodeCreated(
        alertEpisode(),
        NOTIFICATION,
        undefined,
        undefined,
        undefined,
        notice,
      );
    },
    workspace: (notice: Notice) => {
      return service.generateWorkspaceMessageBlocksForAlertEpisodeCreated(
        alertEpisode(),
        NOTIFICATION,
        undefined,
        undefined,
        undefined,
        notice,
      );
    },
    sms: (notice: Notice) => {
      return service.generateSmsTemplateForAlertEpisodeCreated(
        TO_PHONE,
        alertEpisode(),
        NOTIFICATION,
        undefined,
        undefined,
        undefined,
        notice,
      );
    },
    push: (notice: Notice, translator?: Translator) => {
      return PushNotificationUtil.createAlertEpisodeCreatedNotification({
        alertEpisodeTitle: "Disk filling up",
        projectName: "Acme",
        alertEpisodeViewLink: VIEW,
        episodeNumberWithPrefix: "AEP-3",
        personPage: notice,
        translator: translator,
      });
    },
  },
];

function sayMessages(call: CallRequest): Array<string> {
  return call.data
    .map((step: unknown): string => {
      return String((step as { sayMessage?: string }).sayMessage || "");
    })
    .filter((text: string): boolean => {
      return text.length > 0;
    });
}

function markdown(blocks: Array<WorkspaceMessageBlock>): string {
  return blocks
    .map((block: WorkspaceMessageBlock): string => {
      return (block as WorkspacePayloadMarkdown).text || "";
    })
    .join("\n");
}

describe.each(KINDS)("a policy started by hand about $name", (kind: Kind) => {
  test("the call says who started which on-call policy for it, which one, then what they said - and asks for 1 or 2 as ever", async () => {
    const call: CallRequest = await kind.call(AS_TEAM);
    const said: Array<string> = sayMessages(call);

    expect(said[1]).toBe(
      `Alice Kim started the on-call policy Database escalation for an ${kind.noun}: ${kind.callRecord}.`,
    );
    expect(said[2]).toContain(kind.title);
    expect(said[3]).toBe(`Alice Kim says: ${MESSAGE}`);
    expect(said.join(" ")).not.toContain("has been created");

    const gather: { introMessage?: string } = call.data.find(
      (step: unknown): boolean => {
        return Boolean((step as { introMessage?: string }).introMessage);
      },
    ) as { introMessage?: string };

    expect(gather.introMessage).toBe(
      "Press 1 to acknowledge, or 2 to escalate.",
    );
  });

  test("a call for a policy started with no message says nothing more", async () => {
    const said: Array<string> = sayMessages(await kind.call(BY_LEVEL));

    expect(said[1]).toBe(
      `Alice Kim started the on-call policy Database escalation for an ${kind.noun}: ${kind.callRecord}.`,
    );
    expect(
      said.some((text: string): boolean => {
        return text.includes("says:");
      }),
    ).toBe(false);
  });

  test("the email's subject and first lines say who started which policy, why this person, and the message", async () => {
    const email: EmailMessage = await kind.email(AS_TEAM);

    expect(email.subject).toBe(
      `ACTION REQUIRED: Alice Kim started Database escalation for ${kind.label} ${kind.number} - ${kind.title}`,
    );
    expect(email.isSubjectLiteral).toBe(true);
    expect(email.vars["personPageInfo"]).toBe(
      `Alice Kim started Database escalation for ${kind.label} ${kind.number} in the project Acme. You're getting this because you're a member of Platform, on level 2 of Database escalation.`,
    );
    expect(email.vars["personPageMessage"]).toBe(
      `Alice Kim wrote: “${MESSAGE}”`,
    );
    expect(email.vars["pageAgainInfo"]).toBeUndefined();
    expect(email.vars["passOnLink"]).toBeTruthy();
  });

  test("an email for a policy started with no message has no message line, and names the level", async () => {
    const email: EmailMessage = await kind.email(BY_LEVEL);

    expect(email.vars["personPageInfo"]).toBe(
      `Alice Kim started Database escalation for ${kind.label} ${kind.number} in the project Acme. You're getting this because you're on level 1 of Database escalation.`,
    );
    expect(email.vars["personPageMessage"]).toBeUndefined();
  });

  test("an email to a person who reads German is in German", async () => {
    const email: EmailMessage = await kind.email(
      AS_TEAM,
      getServerTranslator("de"),
    );

    expect(email.subject).toContain(
      "HANDLUNG ERFORDERLICH: Alice Kim hat Database escalation gestartet, für ",
    );
    expect(email.vars["personPageInfo"]).toContain(
      "Sie erhalten diese Nachricht, weil Sie Mitglied von Platform sind, auf Stufe 2 von Database escalation.",
    );
    expect(email.vars["personPageMessage"]).toContain(MESSAGE);
    expect(email.language).toBe("de");
  });

  test("Telegram heads it with who started which policy, quotes the message, says why, keeping both links", async () => {
    const body: string = await kind.telegram(AS_TEAM);
    const lines: Array<string> = body.split("\n");

    expect(lines[0]).toBe(
      `${kind.emoji} <b>Alice Kim started Database escalation</b>`,
    );
    expect(body).toContain(`💬 “${MESSAGE}”`);
    expect(body).toContain(
      "👤 You're getting this because you're a member of Platform, on level 2 of Database escalation.",
    );
    expect(body).not.toContain("assigned to you");
    expect(body).not.toContain("because you're on call.");
    expect(body).not.toContain("by name");
    expect(body).toContain("Tap to acknowledge");
    expect(body).toContain("Can't take it? Escalate");
  });

  test("Telegram escapes what people wrote: the policy's name and the message are text", async () => {
    const body: string = await kind.telegram({
      pagedByName: "<b>Eve</b>",
      policyName: "R&D <i>escalation</i>",
      policyLevel: 1,
      message: '<a href="https://evil.example">x</a>',
    });

    expect(body).toContain(
      "&lt;b&gt;Eve&lt;/b&gt; started R&amp;D &lt;i&gt;escalation&lt;/i&gt;",
    );
    expect(body).toContain(
      "“&lt;a href=&quot;https://evil.example&quot;&gt;x&lt;/a&gt;”",
    );
    expect(body).not.toContain('<a href="https://evil.example">');
  });

  test("a Slack, Microsoft Teams or Mattermost message heads it with who started which policy, quotes the message, and says why", async () => {
    const text: string = markdown(await kind.workspace(AS_TEAM));

    expect(text.split("\n")[0]).toBe(
      "🚨 **Alice Kim started Database escalation**",
    );
    expect(text).toContain(`💬 “${MESSAGE}”`);
    expect(text).toContain(
      "👤 You're getting this because you're a member of Platform, on level 2 of Database escalation.",
    );
    expect(text).not.toContain("assigned to you");
    expect(text).toContain("[Acknowledge](");
  });

  test("names in a chat message are text: never a link or formatting", async () => {
    const text: string = markdown(
      await kind.workspace({
        pagedByName: "[Eve](https://evil.example)",
        policyName: "**Database** escalation",
        message: "**now**",
      }),
    );

    expect(text).toContain(
      "\\[Eve\\](https://evil.example) started \\*\\*Database\\*\\* escalation",
    );
    expect(text).toContain("“\\*\\*now\\*\\*”");
  });

  test("the text message says who started which policy, for what, in one part", async () => {
    const sms: { message: string } = await kind.sms(AS_TEAM);

    /*
     * Then the project and the title, as they fit: the project is left out
     * first (OnCallPageSms).
     */
    const head: string = `OneUptime: Alice Kim started Database escalation for ${kind.smsRecord}`;

    expect(sms.message.slice(0, head.length)).toBe(head);
    expect([" ", ":"]).toContain(sms.message.charAt(head.length));
    expect(sms.message).toContain("Ack or escalate: ");
    expect(sms.message).not.toContain(" about ");
    expect(sms.message.length).toBeLessThanOrEqual(160);
  });

  test("the push says who started which policy, carries the message, and opens the record as ever", () => {
    const started: PushNotificationMessage = kind.push(AS_TEAM);
    const first: PushNotificationMessage = kind.push(undefined);

    expect(started.title).toBe(
      `Alice Kim started Database escalation: ${kind.label} ${kind.number}`,
    );
    expect(started.body).toBe(
      `${kind.title}, in Acme. “${MESSAGE}” Click to view details.`,
    );
    // The app routes a tap by these: unchanged, so it opens the record.
    expect(started.data).toEqual(first.data);
    expect(started.tag).toBe(first.tag);
    expect(started.url).toBe(VIEW);
    expect(started.requireInteraction).toBe(true);
  });

  test("a push to a person who reads Japanese is in Japanese", () => {
    const started: PushNotificationMessage = kind.push(
      AS_TEAM,
      getServerTranslator("ja"),
    );

    expect(started.title).toContain(
      "Alice Kim さんが Database escalation を開始しました",
    );
    expect(started.body).toContain(MESSAGE);
  });

  test("a run started by OneUptime, a workflow or an API key reads exactly as before", async () => {
    expect(sayMessages(await kind.call(undefined))[1]).toBe(
      kind.firstCallSentence,
    );
    expect((await kind.email(undefined)).subject).toBe(
      `ACTION REQUIRED: ${kind.label} ${kind.number} created - ${kind.title}`,
    );
    expect(
      (await kind.email(undefined)).vars["personPageInfo"],
    ).toBeUndefined();
    expect((await kind.telegram(undefined)).split("\n")[0]).toBe(
      `${kind.emoji} <b>${kind.firstHeadline}</b>`,
    );
    expect(markdown(await kind.workspace(undefined))).toContain(
      "👤 You're getting this because you're on call.",
    );
    expect((await kind.sms(undefined)).message).not.toContain("started");
    expect(kind.push(undefined).title).toBe(kind.firstPushTitle);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Whether a delivery is a policy started by hand, and what its notice says.
 * ---------------------------------------------------------------------------
 */

type ExecuteOptions = Parameters<
  typeof UserNotificationRuleService.executeNotificationRuleItem
>[1];

interface Readable {
  readPersonPageNotice: (options: ExecuteOptions) => Promise<Notice>;
}

const readable: Readable = UserNotificationRuleService as unknown as Readable;

function executeOptions(
  overrides: Partial<ExecuteOptions> = {},
): ExecuteOptions {
  return {
    projectId: PROJECT,
    userNotificationEventType: UserNotificationEventType.IncidentCreated,
    triggeredByIncidentId: RECORD,
    onCallPolicyId: POLICY,
    onCallPolicyEscalationRuleId: LEVEL,
    onCallPolicyExecutionLogId: RUN,
    userNotificationLogId: LOG,
    ...overrides,
  };
}

function policyRun(fields?: {
  name?: string;
  userName?: string;
  email?: string;
  pageMessage?: string;
  workflow?: boolean;
  noUser?: boolean;
  pageAgainNumber?: number;
  isObserverPage?: boolean;
  isTestPage?: boolean;
  policyName?: string | null;
  noPolicy?: boolean;
}): OnCallDutyPolicyExecutionLog {
  const model: OnCallDutyPolicyExecutionLog =
    new OnCallDutyPolicyExecutionLog();
  model.id = RUN;

  if (!fields?.noPolicy) {
    model.onCallDutyPolicyId = POLICY;

    if (fields?.policyName !== null) {
      const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
      policy.name =
        fields?.policyName === undefined
          ? "Database escalation"
          : fields.policyName;
      model.onCallDutyPolicy = policy;
    }
  }

  if (!fields?.noUser) {
    model.triggeredByUserId = ALICE;
    const user: User = new User();
    user.id = ALICE;
    user.name = (fields?.userName ?? "Alice Kim") as never;

    if (fields?.email) {
      user.email = new Email(fields.email);
    }

    model.triggeredByUser = user;
  }

  if (fields?.pageMessage) {
    model.pageMessage = fields.pageMessage;
  }

  if (fields?.workflow) {
    model.triggeredByWorkflowId = WORKFLOW;
  }

  if (fields?.pageAgainNumber) {
    model.pageAgainNumber = fields.pageAgainNumber;
  }

  if (fields?.isObserverPage) {
    model.isObserverPage = true;
  }

  model.userNotificationEventType = fields?.isTestPage
    ? UserNotificationEventType.TestPage
    : UserNotificationEventType.IncidentCreated;

  return model;
}

function level(order: number | undefined): OnCallDutyPolicyEscalationRule {
  const model: OnCallDutyPolicyEscalationRule =
    new OnCallDutyPolicyEscalationRule();
  model.id = LEVEL;

  if (order !== undefined) {
    model.order = order;
  }

  return model;
}

describe("reading whether a delivery is a policy started by hand", () => {
  let levelRead: jest.SpyInstance;

  beforeEach(() => {
    levelRead = jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneById")
      .mockResolvedValue(level(2) as never);
  });

  test("a policy a person started: who started it, the policy, its level that pages this person, and the message", async () => {
    const find: jest.SpyInstance = jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(policyRun({ pageMessage: ` ${MESSAGE} ` }) as never);

    await expect(
      readable.readPersonPageNotice(executeOptions()),
    ).resolves.toEqual({
      pagedByName: "Alice Kim",
      policyName: "Database escalation",
      policyLevel: 2,
      message: MESSAGE,
    });

    const arg: { id: ObjectID; select: Record<string, unknown> } = find.mock
      .calls[0]![0] as { id: ObjectID; select: Record<string, unknown> };

    expect(arg.id.toString()).toBe(RUN.toString());
    // Read with every column that tells a policy started by hand apart.
    expect(arg.select).toMatchObject({
      onCallDutyPolicyId: true,
      onCallDutyPolicy: { name: true },
      triggeredByUserId: true,
      triggeredByWorkflowId: true,
      pageMessage: true,
      pageAgainNumber: true,
      isObserverPage: true,
      userNotificationEventType: true,
    });

    expect((levelRead.mock.calls[0]![0] as { id: ObjectID }).id).toEqual(LEVEL);
  });

  test("paged as a member of a team: the team, by name", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(policyRun() as never);
    const team: Team = new Team();
    team.name = "Platform";
    jest.spyOn(TeamService, "findOneById").mockResolvedValue(team as never);

    await expect(
      readable.readPersonPageNotice(
        executeOptions({ userBelongsToTeamId: PLATFORM }),
      ),
    ).resolves.toEqual({
      pagedByName: "Alice Kim",
      teamName: "Platform",
      policyName: "Database escalation",
      policyLevel: 2,
    });
  });

  test("paged as on call in a schedule: the schedule, by name", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(policyRun() as never);
    const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
    schedule.name = "Primary";
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "findOneById")
      .mockResolvedValue(schedule as never);

    await expect(
      readable.readPersonPageNotice(
        executeOptions({ onCallScheduleId: PRIMARY }),
      ),
    ).resolves.toEqual({
      pagedByName: "Alice Kim",
      scheduleName: "Primary",
      policyName: "Database escalation",
      policyLevel: 2,
    });
  });

  test("somebody with no name is named by their email address", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(
        policyRun({ userName: "", email: "alice@example.com" }) as never,
      );

    expect(
      (await readable.readPersonPageNotice(executeOptions()))!.pagedByName,
    ).toBe("alice@example.com");
  });

  test.each<[string, string | undefined]>([
    ["no level was named", undefined],
    ["the level cannot be read", "throws"],
    ["the level is gone", "gone"],
    ["the level has no order", "no order"],
  ])(
    "%s: the notice names the policy without a level",
    async (_name: string, setup: string | undefined) => {
      jest
        .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
        .mockResolvedValue(policyRun() as never);

      if (setup === "throws") {
        levelRead.mockRejectedValue(new Error("database is gone"));
      } else if (setup === "gone") {
        levelRead.mockResolvedValue(null as never);
      } else if (setup === "no order") {
        levelRead.mockResolvedValue(level(undefined) as never);
      }

      const notice: Notice = await readable.readPersonPageNotice(
        executeOptions(
          setup === undefined
            ? { onCallPolicyEscalationRuleId: undefined }
            : {},
        ),
      );

      expect(notice).toEqual({
        pagedByName: "Alice Kim",
        policyName: "Database escalation",
      });

      if (setup === undefined) {
        expect(levelRead).not.toHaveBeenCalled();
      }
    },
  );

  test.each([
    ["a run a workflow started", { workflow: true }],
    [
      "a run OneUptime or an API key started: nobody is on it",
      { noUser: true },
    ],
    ["a page again of a policy started by hand", { pageAgainNumber: 1 }],
    ["an observer's page", { isObserverPage: true }],
    ["a test page", { isTestPage: true }],
    ["a run whose policy has no name left to read", { policyName: "  " }],
    ["a run read without its policy", { policyName: null }],
  ])(
    "%s keeps today's words",
    async (_name: string, fields: Parameters<typeof policyRun>[0]) => {
      jest
        .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
        .mockResolvedValue(policyRun(fields) as never);

      await expect(
        readable.readPersonPageNotice(executeOptions()),
      ).resolves.toBeUndefined();
      expect(levelRead).not.toHaveBeenCalled();
    },
  );

  test("a page a person sent to people names no policy and reads no level", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(
        policyRun({ noPolicy: true, pageMessage: MESSAGE }) as never,
      );

    await expect(
      readable.readPersonPageNotice(
        executeOptions({ onCallPolicyId: undefined }),
      ),
    ).resolves.toEqual({ pagedByName: "Alice Kim", message: MESSAGE });
    expect(levelRead).not.toHaveBeenCalled();
  });

  test("a run that cannot be read is worded as a page OneUptime starts, and the page still goes out", async () => {
    const error: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockRejectedValue(new Error("database is gone") as never);

    await expect(
      readable.readPersonPageNotice(executeOptions()),
    ).resolves.toBeUndefined();
    expect(error).not.toHaveBeenCalled();
  });
});

/*
 * ---------------------------------------------------------------------------
 * The delivery hands the notice to every channel's message: for every kind
 * of record, at every level, and for every repeat of a push.
 * ---------------------------------------------------------------------------
 */

describe("a delivery hands a policy started by hand to every channel's message", () => {
  interface Spies {
    run: jest.SpyInstance;
    push: jest.SpyInstance;
    mail: jest.SpyInstance;
    sms: jest.SpyInstance;
    call: jest.SpyInstance;
    telegram: jest.SpyInstance;
    workspace: jest.SpyInstance;
  }

  let spies: Spies;

  function useRule(methods: Record<string, unknown>): void {
    jest.spyOn(UserNotificationRuleService, "findOneById").mockResolvedValue({
      id: RULE,
      _id: RULE.toString(),
      userId: USER,
      ...methods,
    } as unknown as UserNotificationRule as never);
  }

  const EVERY_METHOD: Record<string, unknown> = {
    userEmail: { id: RULE, email: TO_EMAIL, isVerified: true },
    userCall: { id: RULE, phone: TO_PHONE, isVerified: true },
    userSms: { id: RULE, phone: TO_PHONE, isVerified: true },
    userTelegram: { id: RULE, telegramChatId: "42", isVerified: true },
    userSlack: { id: RULE, slackUserId: "U0123456789", isVerified: true },
  };

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest
      .spyOn(UserOnCallLogService, "claimNotificationRuleExecution")
      .mockResolvedValue(true as never);
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
    jest.spyOn(AlertService, "findOneById").mockResolvedValue(alert() as never);
    jest
      .spyOn(IncidentEpisodeService, "findOneById")
      .mockResolvedValue(incidentEpisode() as never);
    jest
      .spyOn(AlertEpisodeService, "findOneById")
      .mockResolvedValue(alertEpisode() as never);
    jest
      .spyOn(WhatsAppService, "sendWhatsAppMessage")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(WebhookService, "sendWebhook")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneById")
      .mockResolvedValue(level(2) as never);

    const team: Team = new Team();
    team.name = "Platform";
    jest.spyOn(TeamService, "findOneById").mockResolvedValue(team as never);

    spies = {
      run: jest.spyOn(OnCallDutyPolicyExecutionLogService, "findOneById"),
      push: jest
        .spyOn(PushNotificationService, "sendPushNotification")
        .mockResolvedValue(undefined as never),
      mail: jest
        .spyOn(MailService, "sendMail")
        .mockResolvedValue(undefined as never),
      sms: jest
        .spyOn(SmsService, "sendSms")
        .mockResolvedValue(undefined as never),
      call: jest
        .spyOn(CallService, "makeCall")
        .mockResolvedValue(undefined as never),
      telegram: jest
        .spyOn(TelegramService, "sendTelegramMessage")
        .mockResolvedValue(undefined as never),
      workspace: jest
        .spyOn(WorkspaceUserNotificationService, "sendDirectMessageToUser")
        .mockResolvedValue(undefined as never),
    };
  });

  interface DeliveredKind {
    name: string;
    eventType: UserNotificationEventType;
    ids: Partial<ExecuteOptions>;
    label: string;
    number: string;
    noun: string;
    // The record as its call says it: severity, kind, number.
    callRecord: string;
    // What its call's headline says it is, severity first.
    callKind: string;
  }

  const DELIVERED: Array<DeliveredKind> = [
    {
      name: "an incident",
      eventType: UserNotificationEventType.IncidentCreated,
      ids: { triggeredByIncidentId: RECORD },
      label: "Incident",
      number: "INC-42",
      noun: "incident",
      callRecord: "Critical incident INC-42",
      callKind: "Critical incident",
    },
    {
      name: "an alert",
      eventType: UserNotificationEventType.AlertCreated,
      ids: { triggeredByAlertId: RECORD },
      label: "Alert",
      number: "ALR-12",
      noun: "alert",
      callRecord: "High alert ALR-12",
      callKind: "High alert",
    },
    {
      name: "an incident episode",
      eventType: UserNotificationEventType.IncidentEpisodeCreated,
      ids: { triggeredByIncidentEpisodeId: RECORD },
      label: "Incident Episode",
      number: "EP-7",
      noun: "incident episode",
      callRecord: "Critical incident episode EP-7",
      callKind: "Critical incident episode",
    },
    {
      name: "an alert episode",
      eventType: UserNotificationEventType.AlertEpisodeCreated,
      ids: { triggeredByAlertEpisodeId: RECORD },
      label: "Alert Episode",
      number: "AEP-3",
      noun: "alert episode",
      callRecord: "High alert episode AEP-3",
      callKind: "High alert episode",
    },
  ];

  function deliveredOptions(
    kind: DeliveredKind,
    overrides: Partial<ExecuteOptions> = {},
  ): ExecuteOptions {
    return executeOptions({
      userNotificationEventType: kind.eventType,
      triggeredByIncidentId: undefined,
      userBelongsToTeamId: PLATFORM,
      ...kind.ids,
      ...overrides,
    });
  }

  describe.each(DELIVERED)("about $name", (kind: DeliveredKind) => {
    test("every channel says who started which policy, why this person, and the message", async () => {
      useRule(EVERY_METHOD);
      spies.run.mockResolvedValue(policyRun({ pageMessage: MESSAGE }) as never);

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE,
        deliveredOptions(kind),
      );

      const call: CallRequest = spies.call.mock.calls[0]![0] as CallRequest;
      expect(sayMessages(call)[1]).toBe(
        `Alice Kim started the on-call policy Database escalation for an ${kind.noun}: ${kind.callRecord}.`,
      );
      expect(sayMessages(call)).toContain(`Alice Kim says: ${MESSAGE}`);

      const email: EmailMessage = spies.mail.mock.calls[0]![0] as EmailMessage;
      expect(email.subject).toContain(
        `ACTION REQUIRED: Alice Kim started Database escalation for ${kind.label} ${kind.number}`,
      );
      expect(email.vars["personPageInfo"]).toContain(
        "You're getting this because you're a member of Platform, on level 2 of Database escalation.",
      );
      expect(email.vars["personPageMessage"]).toBe(
        `Alice Kim wrote: “${MESSAGE}”`,
      );

      const sms: { message: string } = spies.sms.mock.calls[0]![0] as {
        message: string;
      };
      expect(sms.message).toContain(
        "OneUptime: Alice Kim started Database escalation for ",
      );

      const telegram: { body: string } = spies.telegram.mock.calls[0]![0] as {
        body: string;
      };
      expect(telegram.body).toContain(
        "<b>Alice Kim started Database escalation</b>",
      );
      expect(telegram.body).toContain(`💬 “${MESSAGE}”`);

      const chat: {
        messageBlocks: Array<WorkspaceMessageBlock>;
        messageSummary: string;
      } = spies.workspace.mock.calls[0]![0] as {
        messageBlocks: Array<WorkspaceMessageBlock>;
        messageSummary: string;
      };
      expect(markdown(chat.messageBlocks)).toContain(
        "**Alice Kim started Database escalation**",
      );
      expect(markdown(chat.messageBlocks)).toContain(`💬 “${MESSAGE}”`);
      expect(chat.messageSummary).toBe(
        `Alice Kim started the on-call policy Database escalation for an ${kind.noun}.`,
      );
    });

    test("a push, and every repeat of it, says who started which policy and carries the message", async () => {
      useRule({
        userPush: {
          id: RULE,
          deviceToken: "device-token",
          deviceType: "ios",
          isVerified: true,
        },
      });
      spies.run.mockResolvedValue(policyRun({ pageMessage: MESSAGE }) as never);

      // Its first push, then a repeat of it (Repeat until acknowledged).
      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE,
        deliveredOptions(kind),
      );
      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE,
        deliveredOptions(kind, { repeatNumber: 1 }),
      );

      expect(spies.push).toHaveBeenCalledTimes(2);

      for (const [request] of spies.push.mock.calls) {
        const message: PushNotificationMessage = (
          request as { message: PushNotificationMessage }
        ).message;

        expect(message.title).toBe(
          `Alice Kim started Database escalation: ${kind.label} ${kind.number}`,
        );
        expect(message.body).toContain(`“${MESSAGE}”`);
        expect(message.body).not.toContain("has been created");
      }
    });

    test("a run a workflow started keeps today's words", async () => {
      useRule(EVERY_METHOD);
      spies.run.mockResolvedValue(policyRun({ workflow: true }) as never);

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE,
        deliveredOptions(kind),
      );

      expect(sayMessages(spies.call.mock.calls[0]![0] as CallRequest)[1]).toBe(
        `A new ${kind.callKind} has been created: ${kind.number}.`,
      );
      expect((spies.mail.mock.calls[0]![0] as EmailMessage).subject).toBe(
        `ACTION REQUIRED: ${kind.label} ${kind.number} created - ${
          {
            incident: "Checkout is down",
            alert: "CPU above 90%",
            "incident episode": "Payments degraded",
            "alert episode": "Disk filling up",
          }[kind.noun]
        }`,
      );
      expect(
        (spies.sms.mock.calls[0]![0] as { message: string }).message,
      ).not.toContain("started");
      expect(
        (spies.telegram.mock.calls[0]![0] as { body: string }).body,
      ).toContain("assigned to you");
    });

    test("a run nobody started by hand - OneUptime's own, or an API key's - keeps today's words", async () => {
      useRule(EVERY_METHOD);
      spies.run.mockResolvedValue(policyRun({ noUser: true }) as never);

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE,
        deliveredOptions(kind),
      );

      expect(sayMessages(spies.call.mock.calls[0]![0] as CallRequest)[1]).toBe(
        `A new ${kind.callKind} has been created: ${kind.number}.`,
      );
      expect(
        (spies.mail.mock.calls[0]![0] as EmailMessage).vars["personPageInfo"],
      ).toBeUndefined();
    });

    test("a page again of a policy started by hand keeps the page-again words", async () => {
      useRule(EVERY_METHOD);
      spies.run.mockResolvedValue(
        policyRun({ pageAgainNumber: 1, pageMessage: MESSAGE }) as never,
      );

      await UserNotificationRuleService.executeNotificationRuleItem(
        RULE,
        deliveredOptions(kind),
      );

      const said: Array<string> = sayMessages(
        spies.call.mock.calls[0]![0] as CallRequest,
      );

      expect(said[1]).toContain("still not resolved");
      expect(said.join(" ")).not.toContain("started");

      const email: EmailMessage = spies.mail.mock.calls[0]![0] as EmailMessage;
      expect(email.subject).toContain("still not resolved");
      expect(email.vars["personPageInfo"]).toBeUndefined();
      expect(email.vars["pageAgainInfo"]).toBeTruthy();
    });
  });
});

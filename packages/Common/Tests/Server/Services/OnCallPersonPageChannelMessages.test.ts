/*
 * The alert/incident services reach the isolated-vm native addon through the
 * template renderer they import. Nothing here runs a sandbox.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import AlertService from "../../../Server/Services/AlertService";
import CallService from "../../../Server/Services/CallService";
import IncidentService from "../../../Server/Services/IncidentService";
import MailService from "../../../Server/Services/MailService";
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
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A PAGE A PERSON ASKED FOR SAYS WHO PAGED, AND WHY YOU (block 31).
 *
 * Paging somebody from an incident's own Slack or Teams channel is a page
 * about that incident - often declared an hour before. Worded as a page
 * OneUptime starts, it told the person paged "A new incident has been
 * created", "New incident assigned to you" and "because you're on call",
 * from nobody, about an incident that was not new - and a paged team showed
 * nowhere. Every notification that is OneUptime's own words now says it:
 *
 *   call       "Alice Kim paged Platform about an incident", the incident,
 *              and "Alice Kim says: <message>";
 *   email      subject "Alice Kim paged Platform about Incident INC-42 -
 *              <title>", that line where "A new incident has been created"
 *              was, why this person, and the message;
 *   push       "Alice Kim paged Platform: Incident INC-42", the title,
 *              project and message;
 *   Telegram,  "Alice Kim paged Platform", the message, and why they get it;
 *   Slack and
 *   Teams DMs
 *   SMS        "OneUptime: Alice Kim paged Platform about Critical incident
 *              INC-42 ...", in its one 160-character part.
 *
 * WhatsApp's words are a template Meta approved, and stay as they are.
 * Every other page reads exactly as before.
 */

const NOTIFICATION: ObjectID = new ObjectID(
  "0fc00000-0000-4000-8000-000000000001",
);
const PROJECT: ObjectID = new ObjectID("0fc00000-0000-4000-8000-000000000002");
const RECORD: ObjectID = new ObjectID("0fc00000-0000-4000-8000-000000000003");
const RUN: ObjectID = new ObjectID("0fc00000-0000-4000-8000-000000000004");
const RULE: ObjectID = new ObjectID("0fc00000-0000-4000-8000-000000000005");
const USER: ObjectID = new ObjectID("0fc00000-0000-4000-8000-000000000006");
const LOG: ObjectID = new ObjectID("0fc00000-0000-4000-8000-000000000007");
const ALICE: ObjectID = new ObjectID("0fc00000-0000-4000-8000-000000000008");
const PLATFORM: ObjectID = new ObjectID("0fc00000-0000-4000-8000-000000000009");
const PRIMARY: ObjectID = new ObjectID("0fc00000-0000-4000-8000-00000000000a");
const WORKFLOW: ObjectID = new ObjectID("0fc00000-0000-4000-8000-00000000000b");
const POLICY: ObjectID = new ObjectID("0fc00000-0000-4000-8000-00000000000c");
const TO_PHONE: Phone = new Phone("+15555550101");
const TO_EMAIL: Email = new Email("ana@example.com");
const VIEW: string = "https://oneuptime.example.com/dashboard/record";

const BY_NAME: OnCallPersonPageNotice = { pagedByName: "Alice Kim" };
const AS_TEAM: OnCallPersonPageNotice = {
  pagedByName: "Alice Kim",
  teamName: "Platform",
  message: "Can you check the database?",
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
    .spyOn(LinkedAffectedResources, "readForIncident")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LinkedAffectedResources, "readForAlert")
    .mockResolvedValue([] as never);
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

interface Kind {
  name: string;
  noun: string;
  label: string;
  number: string;
  title: string;
  emoji: string;
  severity: string;
  call: (personPage?: OnCallPersonPageNotice) => Promise<CallRequest>;
  email: (personPage?: OnCallPersonPageNotice) => Promise<EmailMessage>;
  telegram: (personPage?: OnCallPersonPageNotice) => Promise<string>;
  workspace: (
    personPage?: OnCallPersonPageNotice,
  ) => Promise<Array<WorkspaceMessageBlock>>;
  sms: (personPage?: OnCallPersonPageNotice) => Promise<{ message: string }>;
  push: (personPage?: OnCallPersonPageNotice) => PushNotificationMessage;
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
    severity: "Critical incident",
    call: (personPage?: OnCallPersonPageNotice) => {
      return service.generateCallTemplateForIncidentCreated(
        TO_PHONE,
        incident(),
        NOTIFICATION,
        undefined,
        personPage,
      );
    },
    email: (personPage?: OnCallPersonPageNotice) => {
      return service.generateEmailTemplateForIncidentCreated(
        TO_EMAIL,
        incident(),
        NOTIFICATION,
        undefined,
        personPage,
      );
    },
    telegram: (personPage?: OnCallPersonPageNotice) => {
      return service.generateTelegramBodyForIncidentCreated(
        incident(),
        NOTIFICATION,
        undefined,
        personPage,
      );
    },
    workspace: (personPage?: OnCallPersonPageNotice) => {
      return service.generateWorkspaceMessageBlocksForIncidentCreated(
        incident(),
        NOTIFICATION,
        undefined,
        personPage,
      );
    },
    sms: (personPage?: OnCallPersonPageNotice) => {
      return service.generateSmsTemplateForIncidentCreated(
        TO_PHONE,
        incident(),
        NOTIFICATION,
        undefined,
        personPage,
      );
    },
    push: (personPage?: OnCallPersonPageNotice) => {
      return PushNotificationUtil.createIncidentCreatedNotification({
        incidentTitle: "Checkout is down",
        projectName: "Acme",
        incidentViewLink: VIEW,
        incidentNumberWithPrefix: "INC-42",
        personPage: personPage,
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
    severity: "High alert",
    call: (personPage?: OnCallPersonPageNotice) => {
      return service.generateCallTemplateForAlertCreated(
        TO_PHONE,
        alert(),
        NOTIFICATION,
        undefined,
        personPage,
      );
    },
    email: (personPage?: OnCallPersonPageNotice) => {
      return service.generateEmailTemplateForAlertCreated(
        TO_EMAIL,
        alert(),
        NOTIFICATION,
        undefined,
        personPage,
      );
    },
    telegram: (personPage?: OnCallPersonPageNotice) => {
      return service.generateTelegramBodyForAlertCreated(
        alert(),
        NOTIFICATION,
        undefined,
        personPage,
      );
    },
    workspace: (personPage?: OnCallPersonPageNotice) => {
      return service.generateWorkspaceMessageBlocksForAlertCreated(
        alert(),
        NOTIFICATION,
        undefined,
        personPage,
      );
    },
    sms: (personPage?: OnCallPersonPageNotice) => {
      return service.generateSmsTemplateForAlertCreated(
        TO_PHONE,
        alert(),
        NOTIFICATION,
        undefined,
        personPage,
      );
    },
    push: (personPage?: OnCallPersonPageNotice) => {
      return PushNotificationUtil.createAlertCreatedNotification({
        alertTitle: "CPU above 90%",
        projectName: "Acme",
        alertViewLink: VIEW,
        alertNumberWithPrefix: "ALR-12",
        personPage: personPage,
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

describe.each(KINDS)("a person's page about $name", (kind: Kind) => {
  test("the call says who paged whom about it, which one, then what they said - and asks for 1 or 2 as ever", async () => {
    const call: CallRequest = await kind.call(AS_TEAM);
    const said: Array<string> = sayMessages(call);

    expect(said[1]).toBe(`Alice Kim paged Platform about an ${kind.noun}`);
    expect(said[2]).toContain(kind.title);
    expect(said[3]).toBe("Alice Kim says: Can you check the database?");
    expect(said.join(" ")).not.toContain("has been created");

    const gather: { introMessage?: string } = call.data.find(
      (step: unknown): boolean => {
        return Boolean((step as { introMessage?: string }).introMessage);
      },
    ) as { introMessage?: string };

    expect(gather.introMessage).toContain(
      `To acknowledge this ${kind.noun}, press 1.`,
    );
  });

  test("a call for a page with no message says nothing more", async () => {
    const said: Array<string> = sayMessages(await kind.call(BY_NAME));

    expect(said[1]).toBe(`Alice Kim paged you about an ${kind.noun}`);
    expect(said.some((text: string) => text.includes("says:"))).toBe(false);
  });

  test("the email's subject and first lines say who paged, why this person, and the message", async () => {
    const email: EmailMessage = await kind.email(AS_TEAM);

    expect(email.subject).toBe(
      `ACTION REQUIRED: Alice Kim paged Platform about ${kind.label} ${kind.number} - ${kind.title}`,
    );
    expect(email.isSubjectLiteral).toBe(true);
    expect(email.vars["personPageInfo"]).toBe(
      `Alice Kim paged Platform about this ${kind.noun} in the project Acme. You're a member of Platform.`,
    );
    expect(email.vars["personPageMessage"]).toBe(
      "Alice Kim wrote: “Can you check the database?”",
    );
    expect(email.vars["pageAgainInfo"]).toBeUndefined();
    expect(email.vars["passOnLink"]).toBeTruthy();
  });

  test("an email for a page with no message has no message line", async () => {
    const email: EmailMessage = await kind.email(BY_NAME);

    expect(email.vars["personPageInfo"]).toBe(
      `Alice Kim paged you about this ${kind.noun} in the project Acme.`,
    );
    expect(email.vars["personPageMessage"]).toBeUndefined();
  });

  test("Telegram heads it with who paged whom, quotes the message, says why, keeping both links", async () => {
    const body: string = await kind.telegram(AS_TEAM);
    const lines: Array<string> = body.split("\n");

    expect(lines[0]).toBe(`${kind.emoji} <b>Alice Kim paged Platform</b>`);
    expect(body).toContain("💬 “Can you check the database?”");
    expect(body).toContain(
      "👤 You're getting this because you're a member of Platform.",
    );
    expect(body).not.toContain("assigned to you");
    expect(body).not.toContain("because you're on call.");
    expect(body).toContain("Tap to acknowledge");
  });

  test("Telegram escapes what people wrote: names and the message are text", async () => {
    const body: string = await kind.telegram({
      pagedByName: "<b>Eve</b>",
      teamName: "R&D",
      message: '<a href="https://evil.example">x</a>',
    });

    expect(body).toContain("&lt;b&gt;Eve&lt;/b&gt; paged R&amp;D");
    expect(body).toContain(
      "“&lt;a href=&quot;https://evil.example&quot;&gt;x&lt;/a&gt;”",
    );
    expect(body).not.toContain('<a href="https://evil.example">');
  });

  test("a Slack or Teams message heads it with who paged whom, quotes the message, and says why", async () => {
    const text: string = markdown(await kind.workspace(AS_TEAM));

    expect(text.split("\n")[0]).toBe("🚨 **Alice Kim paged Platform**");
    expect(text).toContain("💬 “Can you check the database?”");
    expect(text).toContain(
      "👤 You're getting this because you're a member of Platform.",
    );
    expect(text).not.toContain("assigned to you");
    expect(text).toContain("[Acknowledge](");
  });

  test("names in a Slack or Teams message are text: never a link or formatting", async () => {
    const text: string = markdown(
      await kind.workspace({
        pagedByName: "[Eve](https://evil.example)",
        message: "**now**",
      }),
    );

    expect(text).toContain("\\[Eve\\](https://evil.example) paged you");
    expect(text).toContain("“\\*\\*now\\*\\*”");
  });

  test("the text message says who paged whom, after the product, in one part", async () => {
    const sms: { message: string } = await kind.sms(AS_TEAM);

    const head: string = `OneUptime: Alice Kim paged Platform about ${kind.severity} ${kind.number} `;

    expect(sms.message.slice(0, head.length)).toBe(head);
    expect(sms.message).toContain("Ack or escalate: ");
    expect(sms.message.length).toBeLessThanOrEqual(160);
  });

  test("the push says who paged whom and opens the record as ever", () => {
    const person: PushNotificationMessage = kind.push(AS_TEAM);
    const first: PushNotificationMessage = kind.push();

    expect(person.title).toBe(
      `Alice Kim paged Platform: ${kind.label} ${kind.number}`,
    );
    expect(person.body).toBe(
      `${kind.title}, in Acme. “Can you check the database?” Click to view details.`,
    );
    // The app routes a tap by these: unchanged, so it opens the record.
    expect(person.data).toEqual(first.data);
    expect(person.tag).toBe(first.tag);
    expect(person.url).toBe(VIEW);
    expect(person.requireInteraction).toBe(true);
  });

  test("every other page reads exactly as before", async () => {
    expect(sayMessages(await kind.call())[1]).toBe(
      `A new ${kind.noun} has been created`,
    );
    expect((await kind.email()).subject).toBe(
      `ACTION REQUIRED: ${kind.label} ${kind.number} created - ${kind.title}`,
    );
    expect((await kind.telegram()).split("\n")[0]).toBe(
      `${kind.emoji} <b>New ${kind.noun} assigned to you</b>`,
    );
    expect(markdown(await kind.workspace())).toContain(
      "👤 You're getting this because you're on call.",
    );
    expect((await kind.sms()).message).not.toContain("paged");
    expect(kind.push().title).toBe(
      `New ${kind.label} ${kind.number}: ${kind.title}`,
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Whether a delivery is a person's page, and the delivery handing that to
 * every channel's message.
 * ---------------------------------------------------------------------------
 */

type ExecuteOptions = Parameters<
  typeof UserNotificationRuleService.executeNotificationRuleItem
>[1];

interface Readable {
  readPersonPageNotice: (
    options: ExecuteOptions,
  ) => Promise<OnCallPersonPageNotice | undefined>;
}

function executeOptions(
  overrides: Partial<ExecuteOptions> = {},
): ExecuteOptions {
  return {
    projectId: PROJECT,
    userNotificationEventType: UserNotificationEventType.IncidentCreated,
    triggeredByIncidentId: RECORD,
    onCallPolicyId: undefined,
    onCallPolicyExecutionLogId: RUN,
    userNotificationLogId: LOG,
    ...overrides,
  };
}

function personRun(fields?: {
  name?: string;
  email?: string;
  pageMessage?: string;
  workflow?: boolean;
  policy?: boolean;
}): OnCallDutyPolicyExecutionLog {
  const model: OnCallDutyPolicyExecutionLog =
    new OnCallDutyPolicyExecutionLog();
  model.id = RUN;
  model.triggeredByUserId = ALICE;

  const user: User = new User();
  user.id = ALICE;

  if (fields?.name !== undefined) {
    user.name = fields.name as never;
  } else {
    user.name = "Alice Kim" as never;
  }

  if (fields?.email) {
    user.email = new Email(fields.email);
  }

  model.triggeredByUser = user;

  if (fields?.pageMessage) {
    model.pageMessage = fields.pageMessage;
  }

  if (fields?.workflow) {
    model.triggeredByWorkflowId = WORKFLOW;
  }

  if (fields?.policy) {
    model.onCallDutyPolicyId = POLICY;
  }

  return model;
}

describe("reading whether a delivery is a person's page", () => {
  const readable: Readable = UserNotificationRuleService as unknown as Readable;

  test("a person's page by name: who paged, and their message", async () => {
    const find: jest.SpyInstance = jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(
        personRun({ pageMessage: "Can you check the database?" }) as never,
      );

    await expect(
      readable.readPersonPageNotice(executeOptions()),
    ).resolves.toEqual({
      pagedByName: "Alice Kim",
      message: "Can you check the database?",
    });

    const arg: { id: ObjectID; props: unknown } = find.mock.calls[0]![0] as {
      id: ObjectID;
      props: unknown;
    };
    expect(arg.id.toString()).toBe(RUN.toString());
    expect(arg.props).toEqual({ isRoot: true });
  });

  test("paged as a member of a team: the team, by name", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(personRun() as never);
    const team: Team = new Team();
    team.name = "Platform";
    const teamRead: jest.SpyInstance = jest
      .spyOn(TeamService, "findOneById")
      .mockResolvedValue(team as never);

    await expect(
      readable.readPersonPageNotice(
        executeOptions({ userBelongsToTeamId: PLATFORM }),
      ),
    ).resolves.toEqual({ pagedByName: "Alice Kim", teamName: "Platform" });
    expect((teamRead.mock.calls[0]![0] as { id: ObjectID }).id).toEqual(
      PLATFORM,
    );
  });

  test("paged as on call in a schedule: the schedule, by name", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(personRun() as never);
    const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
    schedule.name = "Primary";
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "findOneById")
      .mockResolvedValue(schedule as never);

    await expect(
      readable.readPersonPageNotice(
        executeOptions({ onCallScheduleId: PRIMARY }),
      ),
    ).resolves.toEqual({ pagedByName: "Alice Kim", scheduleName: "Primary" });
  });

  test("somebody with no name is named by their email address, else as somebody", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValueOnce(
        personRun({ name: "", email: "alice@example.com" }) as never,
      )
      .mockResolvedValueOnce(personRun({ name: "" }) as never);

    expect(
      (await readable.readPersonPageNotice(executeOptions()))!.pagedByName,
    ).toBe("alice@example.com");
    expect(
      (await readable.readPersonPageNotice(executeOptions()))!.pagedByName,
    ).toBe("Someone");
  });

  test.each([
    ["a workflow's direct page", { workflow: true }],
    ["an on-call policy's run a person started", { policy: true }],
  ])("%s is no person's page", async (_name: string, fields: object) => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(personRun(fields) as never);

    await expect(
      readable.readPersonPageNotice(executeOptions()),
    ).resolves.toBeUndefined();
  });

  test("a delivery with no run is never read", async () => {
    const find: jest.SpyInstance = jest.spyOn(
      OnCallDutyPolicyExecutionLogService,
      "findOneById",
    );

    await expect(
      readable.readPersonPageNotice(
        executeOptions({ onCallPolicyExecutionLogId: undefined }),
      ),
    ).resolves.toBeUndefined();
    expect(find).not.toHaveBeenCalled();
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

describe("a delivery hands a person's page to every channel's message", () => {
  interface Spies {
    call: jest.SpyInstance;
    email: jest.SpyInstance;
    telegram: jest.SpyInstance;
    sms: jest.SpyInstance;
    run: jest.SpyInstance;
  }

  let spies: Spies;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
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
      userTelegram: { id: RULE, telegramChatId: "42", isVerified: true },
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

    const team: Team = new Team();
    team.name = "Platform";
    jest.spyOn(TeamService, "findOneById").mockResolvedValue(team as never);

    spies = {
      call: jest.spyOn(
        UserNotificationRuleService,
        "generateCallTemplateForIncidentCreated",
      ),
      email: jest.spyOn(
        UserNotificationRuleService,
        "generateEmailTemplateForIncidentCreated",
      ),
      telegram: jest.spyOn(
        UserNotificationRuleService,
        "generateTelegramBodyForIncidentCreated",
      ),
      sms: jest.spyOn(
        UserNotificationRuleService,
        "generateSmsTemplateForIncidentCreated",
      ),
      run: jest.spyOn(OnCallDutyPolicyExecutionLogService, "findOneById"),
    };
  });

  test("a person's page through a team: the call, the email, Telegram and the text are told who paged, and say so", async () => {
    spies.run.mockResolvedValue(
      personRun({ pageMessage: "Can you check the database?" }) as never,
    );

    await UserNotificationRuleService.executeNotificationRuleItem(
      RULE,
      executeOptions({ userBelongsToTeamId: PLATFORM }),
    );

    const notice: OnCallPersonPageNotice = {
      pagedByName: "Alice Kim",
      teamName: "Platform",
      message: "Can you check the database?",
    };

    for (const generator of [spies.call, spies.email, spies.sms]) {
      expect(generator).toHaveBeenCalledTimes(1);
      expect(generator.mock.calls[0]![3]).toBeUndefined();
      expect(generator.mock.calls[0]![4]).toEqual(notice);
    }

    expect(spies.telegram.mock.calls[0]![3]).toEqual(notice);

    const callRequest: CallRequest = (await spies.call.mock.results[0]!
      .value) as CallRequest;
    expect(sayMessages(callRequest)[1]).toBe(
      "Alice Kim paged Platform about an incident",
    );

    const email: EmailMessage = (await spies.email.mock.results[0]!
      .value) as EmailMessage;
    expect(email.subject).toBe(
      "ACTION REQUIRED: Alice Kim paged Platform about Incident INC-42 - Checkout is down",
    );

    const sms: { message: string } = (await spies.sms.mock.results[0]!
      .value) as { message: string };
    expect(sms.message).toContain("Alice Kim paged Platform about");
  });

  test("a workflow's page: nobody is told a person paged", async () => {
    spies.run.mockResolvedValue(personRun({ workflow: true }) as never);

    await UserNotificationRuleService.executeNotificationRuleItem(
      RULE,
      executeOptions(),
    );

    expect(spies.call.mock.calls[0]![4]).toBeUndefined();
    expect(spies.email.mock.calls[0]![4]).toBeUndefined();
    expect(spies.sms.mock.calls[0]![4]).toBeUndefined();
    expect(spies.telegram.mock.calls[0]![3]).toBeUndefined();
  });

  test("a page again is never worded as a person's page", async () => {
    const pageAgainRun: OnCallDutyPolicyExecutionLog = personRun({
      policy: true,
    });
    pageAgainRun.pageAgainNumber = 1;
    spies.run.mockResolvedValue(pageAgainRun as never);

    await UserNotificationRuleService.executeNotificationRuleItem(
      RULE,
      executeOptions({ onCallPolicyId: POLICY }),
    );

    expect(spies.call.mock.calls[0]![3]).toEqual({ pageAgainNumber: 1 });
    expect(spies.call.mock.calls[0]![4]).toBeUndefined();
  });
});

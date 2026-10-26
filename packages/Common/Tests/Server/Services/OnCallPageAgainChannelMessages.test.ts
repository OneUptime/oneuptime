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
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  OnCallPageAgainNotice,
  getOnCallPageAgainCallSentence,
  getOnCallPageAgainEmailLine,
  getOnCallPageAgainHeadline,
  getOnCallPageAgainNoticeReason,
  getOnCallPageAgainWhyLine,
} from "../../../Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
import Phone from "../../../Types/Phone";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A PAGE AGAIN SAYS WHAT IT IS (issue #5123, UI review).
 *
 * A page again (OnCallAcknowledgementTimeout) reaches people the way every
 * page does: their own notification rules. Worded as a first page, it told
 * the person who acknowledged an incident half an hour ago - on the phone,
 * at night - "A new incident has been created", and their push said "New
 * Incident". Now every channel says what it is: still not resolved, so long
 * after it was acknowledged.
 *
 *   call       "An incident is still not resolved 30 minutes after it was
 *              acknowledged", then the incident, then press 1 or 2 as ever;
 *   email      subject "... still not resolved - <title>", and that line
 *              where "A new incident has been created" was;
 *   push       "Incident INC-42 still not resolved: <title>";
 *   Telegram,  "Incident still not resolved", and why they get it;
 *   Slack and
 *   Teams DMs
 *
 *   SMS        "... INC-42 in Acme is still not resolved: <title>. Ack or
 *              escalate: <link>", in its one 160-character part.
 *
 * WhatsApp's words are a template Meta approved, and stay as they are. A
 * first page reads exactly as before.
 */

const NOTIFICATION: ObjectID = new ObjectID(
  "0fb00000-0000-4000-8000-000000000001",
);
const PROJECT: ObjectID = new ObjectID("0fb00000-0000-4000-8000-000000000002");
const RECORD: ObjectID = new ObjectID("0fb00000-0000-4000-8000-000000000003");
const RUN: ObjectID = new ObjectID("0fb00000-0000-4000-8000-000000000004");
const RULE: ObjectID = new ObjectID("0fb00000-0000-4000-8000-000000000005");
const USER: ObjectID = new ObjectID("0fb00000-0000-4000-8000-000000000006");
const LOG: ObjectID = new ObjectID("0fb00000-0000-4000-8000-000000000007");
const POLICY: ObjectID = new ObjectID("0fb00000-0000-4000-8000-000000000008");
const TO_PHONE: Phone = new Phone("+15555550101");
const TO_EMAIL: Email = new Email("ana@example.com");

const NOTICE: OnCallPageAgainNotice = { pageAgainNumber: 1, minutes: 30 };

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

  const dashboard: URL = URL.fromString(
    "https://oneuptime.example.com/dashboard/record",
  );

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

interface Kind {
  name: string;
  noun: string;
  // As the email's subject names it: "Incident", "Alert Episode".
  label: string;
  number: string;
  title: string;
  emoji: string;
  call: (pageAgain?: OnCallPageAgainNotice) => Promise<CallRequest>;
  email: (pageAgain?: OnCallPageAgainNotice) => Promise<EmailMessage>;
  telegram: (pageAgain?: OnCallPageAgainNotice) => Promise<string>;
  workspace: (
    pageAgain?: OnCallPageAgainNotice,
  ) => Promise<Array<WorkspaceMessageBlock>>;
  push: (pageAgain?: OnCallPageAgainNotice) => PushNotificationMessage;
}

const service: typeof UserNotificationRuleService = UserNotificationRuleService;
const VIEW: string = "https://oneuptime.example.com/dashboard/record";

const KINDS: Array<Kind> = [
  {
    name: "an incident",
    noun: "incident",
    label: "Incident",
    number: "INC-42",
    title: "Checkout is down",
    emoji: "🔥",
    call: (pageAgain?: OnCallPageAgainNotice) => {
      return service.generateCallTemplateForIncidentCreated(
        TO_PHONE,
        incident(),
        NOTIFICATION,
        pageAgain,
      );
    },
    email: (pageAgain?: OnCallPageAgainNotice) => {
      return service.generateEmailTemplateForIncidentCreated(
        TO_EMAIL,
        incident(),
        NOTIFICATION,
        pageAgain,
      );
    },
    telegram: (pageAgain?: OnCallPageAgainNotice) => {
      return service.generateTelegramBodyForIncidentCreated(
        incident(),
        NOTIFICATION,
        pageAgain,
      );
    },
    workspace: (pageAgain?: OnCallPageAgainNotice) => {
      return service.generateWorkspaceMessageBlocksForIncidentCreated(
        incident(),
        NOTIFICATION,
        pageAgain,
      );
    },
    push: (pageAgain?: OnCallPageAgainNotice) => {
      return PushNotificationUtil.createIncidentCreatedNotification({
        incidentTitle: "Checkout is down",
        projectName: "Acme",
        incidentViewLink: VIEW,
        incidentNumberWithPrefix: "INC-42",
        pageAgain: pageAgain,
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
    call: (pageAgain?: OnCallPageAgainNotice) => {
      return service.generateCallTemplateForAlertCreated(
        TO_PHONE,
        alert(),
        NOTIFICATION,
        pageAgain,
      );
    },
    email: (pageAgain?: OnCallPageAgainNotice) => {
      return service.generateEmailTemplateForAlertCreated(
        TO_EMAIL,
        alert(),
        NOTIFICATION,
        pageAgain,
      );
    },
    telegram: (pageAgain?: OnCallPageAgainNotice) => {
      return service.generateTelegramBodyForAlertCreated(
        alert(),
        NOTIFICATION,
        pageAgain,
      );
    },
    workspace: (pageAgain?: OnCallPageAgainNotice) => {
      return service.generateWorkspaceMessageBlocksForAlertCreated(
        alert(),
        NOTIFICATION,
        pageAgain,
      );
    },
    push: (pageAgain?: OnCallPageAgainNotice) => {
      return PushNotificationUtil.createAlertCreatedNotification({
        alertTitle: "CPU above 90%",
        projectName: "Acme",
        alertViewLink: VIEW,
        alertNumberWithPrefix: "ALR-12",
        pageAgain: pageAgain,
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
    call: (pageAgain?: OnCallPageAgainNotice) => {
      return service.generateCallTemplateForIncidentEpisodeCreated(
        TO_PHONE,
        incidentEpisode(),
        NOTIFICATION,
        pageAgain,
      );
    },
    email: (pageAgain?: OnCallPageAgainNotice) => {
      return service.generateEmailTemplateForIncidentEpisodeCreated(
        TO_EMAIL,
        incidentEpisode(),
        NOTIFICATION,
        pageAgain,
      );
    },
    telegram: (pageAgain?: OnCallPageAgainNotice) => {
      return service.generateTelegramBodyForIncidentEpisodeCreated(
        incidentEpisode(),
        NOTIFICATION,
        pageAgain,
      );
    },
    workspace: (pageAgain?: OnCallPageAgainNotice) => {
      return service.generateWorkspaceMessageBlocksForIncidentEpisodeCreated(
        incidentEpisode(),
        NOTIFICATION,
        pageAgain,
      );
    },
    push: (pageAgain?: OnCallPageAgainNotice) => {
      return PushNotificationUtil.createIncidentEpisodeCreatedNotification({
        incidentEpisodeTitle: "Payments degraded",
        projectName: "Acme",
        incidentEpisodeViewLink: VIEW,
        episodeNumberWithPrefix: "EP-7",
        pageAgain: pageAgain,
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
    call: (pageAgain?: OnCallPageAgainNotice) => {
      return service.generateCallTemplateForAlertEpisodeCreated(
        TO_PHONE,
        alertEpisode(),
        NOTIFICATION,
        pageAgain,
      );
    },
    email: (pageAgain?: OnCallPageAgainNotice) => {
      return service.generateEmailTemplateForAlertEpisodeCreated(
        TO_EMAIL,
        alertEpisode(),
        NOTIFICATION,
        pageAgain,
      );
    },
    telegram: (pageAgain?: OnCallPageAgainNotice) => {
      return service.generateTelegramBodyForAlertEpisodeCreated(
        alertEpisode(),
        NOTIFICATION,
        pageAgain,
      );
    },
    workspace: (pageAgain?: OnCallPageAgainNotice) => {
      return service.generateWorkspaceMessageBlocksForAlertEpisodeCreated(
        alertEpisode(),
        NOTIFICATION,
        pageAgain,
      );
    },
    push: (pageAgain?: OnCallPageAgainNotice) => {
      return PushNotificationUtil.createAlertEpisodeCreatedNotification({
        alertEpisodeTitle: "Disk filling up",
        projectName: "Acme",
        alertEpisodeViewLink: VIEW,
        episodeNumberWithPrefix: "AEP-3",
        pageAgain: pageAgain,
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

describe("the words a page again says", () => {
  test("why: still not resolved, so long after it was acknowledged", () => {
    expect(getOnCallPageAgainNoticeReason(NOTICE)).toBe(
      "still not resolved 30 minutes after it was acknowledged",
    );
    expect(
      getOnCallPageAgainNoticeReason({ pageAgainNumber: 2, minutes: 90 }),
    ).toBe("still not resolved 1 hour 30 minutes after it was acknowledged");
    expect(
      getOnCallPageAgainNoticeReason({ pageAgainNumber: 2, minutes: 1440 }),
    ).toBe("still not resolved 24 hours after it was acknowledged");
  });

  test.each([[undefined], [0], [Number.NaN]])(
    "without minutes it could read (%s), it still says why",
    (minutes: number | undefined) => {
      expect(
        getOnCallPageAgainNoticeReason({
          pageAgainNumber: 1,
          ...(minutes === undefined ? {} : { minutes: minutes }),
        }),
      ).toBe("still not resolved after it was acknowledged");
    },
  );

  test("each kind of record by its name", () => {
    expect(getOnCallPageAgainHeadline("incident")).toBe(
      "Incident still not resolved",
    );
    expect(getOnCallPageAgainHeadline("alert episode")).toBe(
      "Alert episode still not resolved",
    );
    expect(
      getOnCallPageAgainCallSentence({ recordNoun: "alert", notice: NOTICE }),
    ).toBe(
      "An alert is still not resolved 30 minutes after it was acknowledged",
    );
    expect(
      getOnCallPageAgainEmailLine({
        recordNoun: "incident episode",
        projectName: "Acme",
        notice: NOTICE,
      }),
    ).toBe(
      "This incident episode in the project Acme is still not resolved 30 minutes after it was acknowledged.",
    );
    // A project with no name is left out, not written as "in the project ".
    expect(
      getOnCallPageAgainEmailLine({
        recordNoun: "incident",
        projectName: "  ",
        notice: NOTICE,
      }),
    ).toBe(
      "This incident is still not resolved 30 minutes after it was acknowledged.",
    );
    expect(getOnCallPageAgainWhyLine(NOTICE)).toBe(
      "You're getting this because it is still not resolved 30 minutes after it was acknowledged.",
    );
  });
});

describe.each(KINDS)("a page again about $name", (kind: Kind) => {
  const Noun: string = `${kind.noun.charAt(0).toUpperCase()}${kind.noun.slice(1)}`;

  test("the call says it is still not resolved, then which one, then asks for 1 or 2 as ever", async () => {
    const said: Array<string> = sayMessages(await kind.call(NOTICE));

    expect(said[1]).toBe(
      `An ${kind.noun} is still not resolved 30 minutes after it was acknowledged`,
    );
    expect(said.join(" ")).not.toContain("has been created");

    const gather: { introMessage?: string } = (
      await kind.call(NOTICE)
    ).data.find((step: unknown): boolean => {
      return Boolean((step as { introMessage?: string }).introMessage);
    }) as { introMessage?: string };

    expect(gather.introMessage).toContain(
      `To acknowledge this ${kind.noun}, press 1.`,
    );
    expect(gather.introMessage).toContain("press 2 to escalate");
  });

  test("a first page's call reads as it always did", async () => {
    expect(sayMessages(await kind.call())[1]).toBe(
      `A new ${kind.noun} has been created`,
    );
  });

  test("the email's subject and first line say it is still not resolved", async () => {
    const email: EmailMessage = await kind.email(NOTICE);

    expect(email.subject).toBe(
      `ACTION REQUIRED: ${kind.label} ${kind.number} still not resolved - ${kind.title}`,
    );
    expect(email.isSubjectLiteral).toBe(true);
    expect(email.vars["pageAgainInfo"]).toBe(
      `This ${kind.noun} in the project Acme is still not resolved 30 minutes after it was acknowledged.`,
    );
    // Its Acknowledge and Escalate are the page's own, as on every page.
    expect(email.vars["passOnLink"]).toBeTruthy();
  });

  test("a first page's email reads as it always did", async () => {
    const email: EmailMessage = await kind.email();

    expect(email.subject).toBe(
      `ACTION REQUIRED: ${kind.label} ${kind.number} created - ${kind.title}`,
    );
    expect(email.vars["pageAgainInfo"]).toBeUndefined();
  });

  test("Telegram heads it 'still not resolved' and says why, keeping both links", async () => {
    const body: string = await kind.telegram(NOTICE);
    const lines: Array<string> = body.split("\n");

    expect(lines[0]).toBe(`${kind.emoji} <b>${Noun} still not resolved</b>`);
    expect(body).toContain(
      "👤 You're getting this because it is still not resolved 30 minutes after it was acknowledged.",
    );
    expect(body).not.toContain("assigned to you");
    expect(body).toContain("Tap to acknowledge");
    expect(body).toContain("Escalate");
  });

  test("a first page's Telegram message reads as it always did", async () => {
    const body: string = await kind.telegram();

    expect(body.split("\n")[0]).toBe(
      `${kind.emoji} <b>New ${kind.noun} assigned to you</b>`,
    );
    expect(body).toContain("👤 You're getting this because you're on call.");
  });

  test("a Slack or Teams message heads it 'still not resolved' and says why", async () => {
    const text: string = markdown(await kind.workspace(NOTICE));

    expect(text.split("\n")[0]).toBe(`🚨 **${Noun} still not resolved**`);
    expect(text).toContain(
      "👤 You're getting this because it is still not resolved 30 minutes after it was acknowledged.",
    );
    expect(text).not.toContain("assigned to you");
    expect(text).toContain("[Acknowledge](");
  });

  test("a first page's Slack or Teams message reads as it always did", async () => {
    const text: string = markdown(await kind.workspace());

    expect(text.split("\n")[0]).toBe(`🚨 **New ${kind.noun} assigned to you**`);
    expect(text).toContain("👤 You're getting this because you're on call.");
  });

  test("the push says it is still not resolved, and opens the record as ever", () => {
    const again: PushNotificationMessage = kind.push(NOTICE);
    const first: PushNotificationMessage = kind.push();

    expect(again.title).toBe(
      `${kind.label} ${kind.number} still not resolved: ${kind.title}`,
    );
    expect(again.body).toBe(
      `${kind.label} ${kind.number} (${kind.title}) in Acme is still not resolved 30 minutes after it was acknowledged. Click to view details.`,
    );
    // The app routes a tap by these: unchanged, so it opens the record.
    expect(again.data).toEqual(first.data);
    expect(again.tag).toBe(first.tag);
    expect(again.url).toBe(VIEW);
    expect(first.title).toBe(`New ${kind.label} ${kind.number}: ${kind.title}`);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Whether a delivery is part of a page again, and the delivery handing that
 * to every channel's message.
 * ---------------------------------------------------------------------------
 */

type ExecuteOptions = Parameters<
  typeof UserNotificationRuleService.executeNotificationRuleItem
>[1];

interface Readable {
  readPageAgainNotice: (
    options: ExecuteOptions,
  ) => Promise<OnCallPageAgainNotice | undefined>;
}

function executeOptions(
  overrides: Partial<ExecuteOptions> = {},
): ExecuteOptions {
  return {
    projectId: PROJECT,
    userNotificationEventType: UserNotificationEventType.IncidentCreated,
    triggeredByIncidentId: RECORD,
    onCallPolicyId: POLICY,
    onCallPolicyExecutionLogId: RUN,
    userNotificationLogId: LOG,
    ...overrides,
  };
}

function run(fields: {
  pageAgainNumber?: number;
  minutes?: number | null;
}): OnCallDutyPolicyExecutionLog {
  const model: OnCallDutyPolicyExecutionLog =
    new OnCallDutyPolicyExecutionLog();
  model.id = RUN;

  if (fields.pageAgainNumber !== undefined) {
    model.pageAgainNumber = fields.pageAgainNumber;
  }

  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();

  if (fields.minutes !== undefined && fields.minutes !== null) {
    policy.acknowledgementTimeoutInMinutes = fields.minutes;
  }

  model.onCallDutyPolicy = policy;
  return model;
}

describe("reading whether a delivery is part of a page again", () => {
  const readable: Readable = UserNotificationRuleService as unknown as Readable;

  test("a page again, with the policy's timeout", async () => {
    const find: jest.SpyInstance = jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(run({ pageAgainNumber: 2, minutes: 45 }) as never);

    await expect(
      readable.readPageAgainNotice(executeOptions()),
    ).resolves.toEqual({ pageAgainNumber: 2, minutes: 45 });

    const arg: { id: ObjectID; select: JSONObject } = find.mock
      .calls[0]![0] as { id: ObjectID; select: JSONObject };

    expect(arg.id.toString()).toBe(RUN.toString());
    expect(arg.select).toEqual({
      pageAgainNumber: true,
      onCallDutyPolicy: { acknowledgementTimeoutInMinutes: true },
    });
  });

  test("a page again whose policy has no timeout any more says why without the minutes", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(run({ pageAgainNumber: 1, minutes: null }) as never);

    await expect(
      readable.readPageAgainNotice(executeOptions()),
    ).resolves.toEqual({ pageAgainNumber: 1 });
  });

  test("a first run is a first page", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(run({ minutes: 30 }) as never);

    await expect(
      readable.readPageAgainNotice(executeOptions()),
    ).resolves.toBeUndefined();
  });

  test("a page with no policy run - a direct page - is never read", async () => {
    const find: jest.SpyInstance = jest.spyOn(
      OnCallDutyPolicyExecutionLogService,
      "findOneById",
    );

    await expect(
      readable.readPageAgainNotice(
        executeOptions({ onCallPolicyExecutionLogId: undefined }),
      ),
    ).resolves.toBeUndefined();
    expect(find).not.toHaveBeenCalled();
  });

  test("a run that cannot be read is worded as a first page, and the page still goes out", async () => {
    const error: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockRejectedValue(new Error("database is gone") as never);

    await expect(
      readable.readPageAgainNotice(executeOptions()),
    ).resolves.toBeUndefined();
    // Wording is not worth an error: the page itself matters.
    expect(error).not.toHaveBeenCalled();
  });
});

describe("a delivery hands the page again to every channel's message", () => {
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

  test("a page again: the call, the email and Telegram are told, and say so", async () => {
    spies.run.mockResolvedValue(
      run({ pageAgainNumber: 1, minutes: 30 }) as never,
    );

    await UserNotificationRuleService.executeNotificationRuleItem(
      RULE,
      executeOptions(),
    );

    // Read once, for every channel of the delivery.
    expect(spies.run).toHaveBeenCalledTimes(1);

    for (const generator of [spies.call, spies.email]) {
      expect(generator).toHaveBeenCalledTimes(1);
      expect(generator.mock.calls[0]![3]).toEqual(NOTICE);
    }

    expect(spies.telegram.mock.calls[0]![2]).toEqual(NOTICE);

    const callRequest: CallRequest = (await spies.call.mock.results[0]!
      .value) as CallRequest;

    expect(sayMessages(callRequest)[1]).toBe(
      "An incident is still not resolved 30 minutes after it was acknowledged",
    );

    const email: EmailMessage = (await spies.email.mock.results[0]!
      .value) as EmailMessage;

    expect(email.subject).toBe(
      "ACTION REQUIRED: Incident INC-42 still not resolved - Checkout is down",
    );

    // The text message says it too, after the number and the project.
    expect(spies.sms).toHaveBeenCalledTimes(1);
    expect(spies.sms.mock.calls[0]![3]).toEqual(NOTICE);

    const sms: { message: string } = (await spies.sms.mock.results[0]!
      .value) as { message: string };

    expect(sms.message).toContain(" INC-42 ");
    expect(sms.message).toContain(" is still not resolved: Checkout is down.");
    expect(sms.message).toContain("Ack or escalate: ");
  });

  test("a first page: nobody is told it pages again", async () => {
    spies.run.mockResolvedValue(run({ minutes: 30 }) as never);

    await UserNotificationRuleService.executeNotificationRuleItem(
      RULE,
      executeOptions(),
    );

    expect(spies.call.mock.calls[0]![3]).toBeUndefined();
    expect(spies.email.mock.calls[0]![3]).toBeUndefined();
    expect(spies.telegram.mock.calls[0]![2]).toBeUndefined();
    expect(spies.sms.mock.calls[0]![3]).toBeUndefined();

    const callRequest: CallRequest = (await spies.call.mock.results[0]!
      .value) as CallRequest;

    expect(sayMessages(callRequest)[1]).toBe("A new incident has been created");

    const sms: { message: string } = (await spies.sms.mock.results[0]!
      .value) as { message: string };

    expect(sms.message).not.toContain("still not resolved");
  });

  test("a run that cannot be read still pages, worded as a first page", async () => {
    spies.run.mockRejectedValue(new Error("database is gone") as never);

    await UserNotificationRuleService.executeNotificationRuleItem(
      RULE,
      executeOptions(),
    );

    expect(spies.call).toHaveBeenCalledTimes(1);
    expect(spies.call.mock.calls[0]![3]).toBeUndefined();
    expect(CallService.makeCall).toHaveBeenCalledTimes(1);
  });
});

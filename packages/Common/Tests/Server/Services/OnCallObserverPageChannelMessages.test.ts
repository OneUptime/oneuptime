/*
 * WHAT AN OBSERVER'S PAGE SAYS, IN EVERY CHANNEL (OnCallObserverPage).
 *
 * Somebody paged as an observer is kept informed while the people
 * responding stay on the record. Every notification of the page says so in
 * OneUptime's own words - a call, an email, Telegram, Slack and Microsoft
 * Teams, a text, a push - asks only whether they have seen it, and offers no
 * escalation: there is nothing for them to take, or to pass on. A
 * responder's page reads exactly as before.
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
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import AlertService from "../../../Server/Services/AlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import ShortLinkService from "../../../Server/Services/ShortLinkService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import LinkedAffectedResources from "../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import PushNotificationUtil from "../../../Server/Utils/PushNotificationUtil";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import URL from "../../../Types/API/URL";
import CallRequest, { GatherInput } from "../../../Types/Call/CallRequest";
import {
  ON_CALL_OBSERVER_PAGE_CALL_ANSWERED,
  OnCallObserverPageRecordKind,
  getOnCallObserverPageEmailWhy,
  getOnCallObserverPageNotice,
} from "../../../Types/OnCallDutyPolicy/OnCallObserverPage";
import Email from "../../../Types/Email";
import EmailMessage from "../../../Types/Email/EmailMessage";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPersonPageNotice } from "../../../Types/OnCallDutyPolicy/OnCallPersonPage";
import Phone from "../../../Types/Phone";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
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
const TO_PHONE: Phone = new Phone("+15555550101");
const TO_EMAIL: Email = new Email("ana@example.com");
const VIEW: string = "https://oneuptime.example.com/dashboard/record";

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
  call: (
    personPage?: OnCallPersonPageNotice,
    isObserverPage?: boolean,
  ) => Promise<CallRequest>;
  email: (
    personPage?: OnCallPersonPageNotice,
    isObserverPage?: boolean,
  ) => Promise<EmailMessage>;
  telegram: (
    personPage?: OnCallPersonPageNotice,
    isObserverPage?: boolean,
  ) => Promise<string>;
  workspace: (
    personPage?: OnCallPersonPageNotice,
    isObserverPage?: boolean,
  ) => Promise<Array<WorkspaceMessageBlock>>;
  sms: (
    personPage?: OnCallPersonPageNotice,
    isObserverPage?: boolean,
  ) => Promise<{ message: string }>;
  push: (
    personPage?: OnCallPersonPageNotice,
    isObserverPage?: boolean,
  ) => PushNotificationMessage;
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
    call: (personPage?: OnCallPersonPageNotice, isObserverPage?: boolean) => {
      return service.generateCallTemplateForIncidentCreated(
        TO_PHONE,
        incident(),
        NOTIFICATION,
        undefined,
        personPage,
        isObserverPage,
      );
    },
    email: (personPage?: OnCallPersonPageNotice, isObserverPage?: boolean) => {
      return service.generateEmailTemplateForIncidentCreated(
        TO_EMAIL,
        incident(),
        NOTIFICATION,
        undefined,
        personPage,
        isObserverPage,
      );
    },
    telegram: (
      personPage?: OnCallPersonPageNotice,
      isObserverPage?: boolean,
    ) => {
      return service.generateTelegramBodyForIncidentCreated(
        incident(),
        NOTIFICATION,
        undefined,
        personPage,
        isObserverPage,
      );
    },
    workspace: (
      personPage?: OnCallPersonPageNotice,
      isObserverPage?: boolean,
    ) => {
      return service.generateWorkspaceMessageBlocksForIncidentCreated(
        incident(),
        NOTIFICATION,
        undefined,
        personPage,
        isObserverPage,
      );
    },
    sms: (personPage?: OnCallPersonPageNotice, isObserverPage?: boolean) => {
      return service.generateSmsTemplateForIncidentCreated(
        TO_PHONE,
        incident(),
        NOTIFICATION,
        undefined,
        personPage,
        isObserverPage,
      );
    },
    push: (personPage?: OnCallPersonPageNotice, isObserverPage?: boolean) => {
      return PushNotificationUtil.createIncidentCreatedNotification({
        incidentTitle: "Checkout is down",
        projectName: "Acme",
        incidentViewLink: VIEW,
        incidentNumberWithPrefix: "INC-42",
        personPage: personPage,
        isObserverPage: isObserverPage,
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
    call: (personPage?: OnCallPersonPageNotice, isObserverPage?: boolean) => {
      return service.generateCallTemplateForAlertCreated(
        TO_PHONE,
        alert(),
        NOTIFICATION,
        undefined,
        personPage,
        isObserverPage,
      );
    },
    email: (personPage?: OnCallPersonPageNotice, isObserverPage?: boolean) => {
      return service.generateEmailTemplateForAlertCreated(
        TO_EMAIL,
        alert(),
        NOTIFICATION,
        undefined,
        personPage,
        isObserverPage,
      );
    },
    telegram: (
      personPage?: OnCallPersonPageNotice,
      isObserverPage?: boolean,
    ) => {
      return service.generateTelegramBodyForAlertCreated(
        alert(),
        NOTIFICATION,
        undefined,
        personPage,
        isObserverPage,
      );
    },
    workspace: (
      personPage?: OnCallPersonPageNotice,
      isObserverPage?: boolean,
    ) => {
      return service.generateWorkspaceMessageBlocksForAlertCreated(
        alert(),
        NOTIFICATION,
        undefined,
        personPage,
        isObserverPage,
      );
    },
    sms: (personPage?: OnCallPersonPageNotice, isObserverPage?: boolean) => {
      return service.generateSmsTemplateForAlertCreated(
        TO_PHONE,
        alert(),
        NOTIFICATION,
        undefined,
        personPage,
        isObserverPage,
      );
    },
    push: (personPage?: OnCallPersonPageNotice, isObserverPage?: boolean) => {
      return PushNotificationUtil.createAlertCreatedNotification({
        alertTitle: "CPU above 90%",
        projectName: "Acme",
        alertViewLink: VIEW,
        alertNumberWithPrefix: "ALR-12",
        personPage: personPage,
        isObserverPage: isObserverPage,
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

describe.each(KINDS)("an observer's page about $name", (kind: Kind) => {
  test("the call says they are paged as an observer, which one, who stays on it - and asks only for 1, which acknowledges nothing", async () => {
    const call: CallRequest = await kind.call(undefined, true);

    expect(sayMessages(call)).toEqual([
      "This is a call from One Uptime",
      `You are paged as an observer about an ${kind.noun}`,
      expect.stringContaining(kind.title),
      `You are kept informed: the people responding stay on this ${kind.noun}.`,
    ]);

    const prompt: GatherInput = call.data.find((step: unknown): boolean => {
      return Boolean((step as { introMessage?: string }).introMessage);
    }) as GatherInput;

    expect(prompt.introMessage).toBe(
      `To say you have heard this, press 1. This does not acknowledge the ${kind.noun}.`,
    );
    expect(prompt.introMessage).not.toContain("press 2");
    expect(prompt.onInputCallRequest["1"]!.sayMessage).toBe(
      ON_CALL_OBSERVER_PAGE_CALL_ANSWERED,
    );
    // Still answered through the page's own link.
    expect(prompt.responseUrl).toBeDefined();
  });

  test("a person's page as observers: the call says who paged whom, as observers, and what they wrote", async () => {
    const call: CallRequest = await kind.call(AS_TEAM, true);
    const said: Array<string> = sayMessages(call);

    expect(said[1]).toBe(
      `Alice Kim paged Platform about an ${kind.noun}, as an observer`,
    );
    expect(said).toContain("Alice Kim says: Can you check the database?");
  });

  test("the email asks nothing of them: FYI in its subject, the notice, I've seen it, no Escalate - and why it came", async () => {
    const email: EmailMessage = await kind.email(undefined, true);

    expect(email.subject).toBe(
      `FYI (observer): ${kind.label} ${kind.number} - ${kind.title}`,
    );
    expect(email.vars["observerPageInfo"]).toBe(
      getOnCallObserverPageNotice(kind.noun as OnCallObserverPageRecordKind),
    );
    expect(email.vars["observerPageWhy"]).toBe(
      getOnCallObserverPageEmailWhy(kind.noun as OnCallObserverPageRecordKind),
    );
    expect(email.vars["passOnLink"]).toBeUndefined();
  });

  test("a person's page as observers: the email says who paged, and still asks nothing", async () => {
    const email: EmailMessage = await kind.email(AS_TEAM, true);

    expect(email.subject).toBe(
      `FYI (observer): Alice Kim paged Platform about ${kind.label} ${kind.number} - ${kind.title}`,
    );
    expect(email.vars["personPageInfo"]).toBeDefined();
    expect(email.vars["observerPageInfo"]).toBeDefined();
  });

  test("Telegram heads it as an observer's page, says what answering does, and links only to I've seen it", async () => {
    const body: string = await kind.telegram(undefined, true);

    expect(body).toContain("<b>You're paged as an observer</b>");
    expect(body).toContain("only says you've seen it");
    expect(body).toContain("I've seen it</a>");
    expect(body).not.toContain("Tap to acknowledge");
    expect(body).not.toContain("Escalate");
  });

  test("a Slack or Teams message heads it as an observer's page, and its one link says I've seen it", async () => {
    const text: string = markdown(await kind.workspace(undefined, true));

    expect(text).toContain("**You're paged as an observer**");
    expect(text).toContain(
      getOnCallObserverPageNotice(kind.noun as OnCallObserverPageRecordKind),
    );
    expect(text).toContain("[I've seen it](");
    expect(text).not.toContain("[Acknowledge](");
    expect(text).not.toContain("Escalate");
  });

  test("the text message says FYI (observer), and its link marks the page seen", async () => {
    const sms: { message: string } = await kind.sms(undefined, true);

    expect(sms.message.startsWith("OneUptime FYI (observer): ")).toBe(true);
    expect(sms.message).toContain(
      "Mark seen: https://oneuptime.example.com/l/",
    );
    expect(sms.message).not.toContain("Ack or escalate");
  });

  test("a person's page as observers: the text message names who paged them as observers", async () => {
    const sms: { message: string } = await kind.sms(AS_TEAM, true);

    expect(sms.message).toContain(
      "OneUptime: Alice Kim paged Platform as observers about",
    );
  });

  test("the push says FYI, and that they are kept informed - and opens the record as ever", () => {
    const push: PushNotificationMessage = kind.push(undefined, true);

    expect(push.title).toBe(`FYI: ${kind.label} ${kind.number}: ${kind.title}`);
    expect(push.body).toBe(
      `You're paged as an observer, in Acme: the people responding stay on this ${kind.noun}. Tap to view.`,
    );
    expect(push.url).toBe(VIEW);
  });

  test("a responder's page reads exactly as before", async () => {
    const call: CallRequest = await kind.call(undefined, false);
    const prompt: GatherInput = call.data.find((step: unknown): boolean => {
      return Boolean((step as { introMessage?: string }).introMessage);
    }) as GatherInput;

    expect(prompt.introMessage).toContain(
      `To acknowledge this ${kind.noun}, press 1.`,
    );
    expect((await kind.email(undefined, false)).subject).toBe(
      (await kind.email()).subject,
    );
    expect(
      (await kind.email(undefined, false)).vars["passOnLink"],
    ).toBeDefined();
    expect(markdown(await kind.workspace(undefined, false))).toContain(
      "[Acknowledge](",
    );
    expect(kind.push(undefined, false).title).toBe(kind.push().title);
  });
});

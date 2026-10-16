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
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import AlertEpisodeMemberService from "../../../Server/Services/AlertEpisodeMemberService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentEpisodeMemberService from "../../../Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../Server/Services/IncidentService";
import ShortLinkService from "../../../Server/Services/ShortLinkService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import LinkedAffectedResources from "../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import OnCallPageLinkToken, {
  ON_CALL_PAGE_LINK_TOKEN_PARAM,
} from "../../../Server/Utils/OnCall/OnCallPageLinkToken";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import URL from "../../../Types/API/URL";
import CallRequest, { GatherInput } from "../../../Types/Call/CallRequest";
import Email from "../../../Types/Email";
import EmailMessage from "../../../Types/Email/EmailMessage";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import SMS from "../../../Types/SMS/SMS";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import WhatsAppMessage from "../../../Types/WhatsApp/WhatsAppMessage";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * EVERY MESSAGE A PAGE SENDS LETS THE PERSON PASS IT ON.
 *
 * Woken by a page they cannot take, a person passes it on from the message
 * itself. These read what each channel's message says, for each of the four
 * things that page - an incident, an alert and both kinds of episode:
 *
 *   call       "If you can't take it, press 2 to pass it on.", and the
 *              address the key press goes to carries the page's token;
 *   text       "or pass it on if you can't take it", with the one link,
 *              which opens a page that offers both;
 *   WhatsApp   the approved template as it is: its acknowledge link opens
 *              that same page, so it carries the token;
 *   Telegram,  a "Can't take it? Pass it on" link under Acknowledge;
 *   Slack and
 *   Teams DMs
 *   email      a Pass it on button under Acknowledge (its template draws it
 *              from passOnLink), and an Acknowledge link with the token.
 *
 * Every link that can pass the page on carries a token signed for this one
 * notification (OnCallPageLinkToken) - checked here by verifying it.
 */

const NOTIFICATION: ObjectID = new ObjectID(
  "0fa00000-0000-4000-8000-000000000001",
);
const PROJECT: ObjectID = new ObjectID("0fa00000-0000-4000-8000-000000000002");
const RECORD: ObjectID = new ObjectID("0fa00000-0000-4000-8000-000000000003");
const TO_PHONE: Phone = new Phone("+15555550101");

// Every URL a message's text was made from, in order.
let shortened: Array<string>;

beforeEach(() => {
  shortened = [];

  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.example.com"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);

  // A short link stands for the URL it was made for: /l/<n>.
  jest
    .spyOn(ShortLinkService, "saveShortLinkFor")
    .mockImplementation((async (url: URL) => {
      shortened.push(url.toString());
      return { shortId: String(shortened.length) };
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
  jest.spyOn(AlertService, "getAlertLinkInDashboard").mockResolvedValue(dashboard);
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
  const state: AlertState = new AlertState();
  state.name = "Identified";
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
  state.name = "Identified";
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
  const state: AlertState = new AlertState();
  state.name = "Identified";
  model.currentAlertState = state;
  const severity: AlertSeverity = new AlertSeverity();
  severity.name = "High";
  model.alertSeverity = severity;
  return model;
}

interface Kind {
  name: string;
  noun: string;
  call: () => Promise<CallRequest>;
  sms: () => Promise<SMS>;
  telegram: () => Promise<string>;
  whatsApp: () => Promise<WhatsAppMessage>;
  workspace: () => Promise<Array<WorkspaceMessageBlock>>;
  email: () => Promise<EmailMessage>;
  acknowledgeVar: string;
}

const service: typeof UserNotificationRuleService = UserNotificationRuleService;
const TO_EMAIL: Email = new Email("ana@example.com");

const KINDS: Array<Kind> = [
  {
    name: "an incident",
    noun: "incident",
    call: () => {
      return service.generateCallTemplateForIncidentCreated(
        TO_PHONE,
        incident(),
        NOTIFICATION,
      );
    },
    sms: () => {
      return service.generateSmsTemplateForIncidentCreated(
        TO_PHONE,
        incident(),
        NOTIFICATION,
      );
    },
    telegram: () => {
      return service.generateTelegramBodyForIncidentCreated(
        incident(),
        NOTIFICATION,
      );
    },
    whatsApp: () => {
      return service.generateWhatsAppTemplateForIncidentCreated(
        TO_PHONE,
        incident(),
        NOTIFICATION,
      );
    },
    workspace: () => {
      return service.generateWorkspaceMessageBlocksForIncidentCreated(
        incident(),
        NOTIFICATION,
      );
    },
    email: () => {
      return service.generateEmailTemplateForIncidentCreated(
        TO_EMAIL,
        incident(),
        NOTIFICATION,
      );
    },
    acknowledgeVar: "acknowledgeIncidentLink",
  },
  {
    name: "an alert",
    noun: "alert",
    call: () => {
      return service.generateCallTemplateForAlertCreated(
        TO_PHONE,
        alert(),
        NOTIFICATION,
      );
    },
    sms: () => {
      return service.generateSmsTemplateForAlertCreated(
        TO_PHONE,
        alert(),
        NOTIFICATION,
      );
    },
    telegram: () => {
      return service.generateTelegramBodyForAlertCreated(alert(), NOTIFICATION);
    },
    whatsApp: () => {
      return service.generateWhatsAppTemplateForAlertCreated(
        TO_PHONE,
        alert(),
        NOTIFICATION,
      );
    },
    workspace: () => {
      return service.generateWorkspaceMessageBlocksForAlertCreated(
        alert(),
        NOTIFICATION,
      );
    },
    email: () => {
      return service.generateEmailTemplateForAlertCreated(
        TO_EMAIL,
        alert(),
        NOTIFICATION,
      );
    },
    acknowledgeVar: "acknowledgeAlertLink",
  },
  {
    name: "an incident episode",
    noun: "incident episode",
    call: () => {
      return service.generateCallTemplateForIncidentEpisodeCreated(
        TO_PHONE,
        incidentEpisode(),
        NOTIFICATION,
      );
    },
    sms: () => {
      return service.generateSmsTemplateForIncidentEpisodeCreated(
        TO_PHONE,
        incidentEpisode(),
        NOTIFICATION,
      );
    },
    telegram: () => {
      return service.generateTelegramBodyForIncidentEpisodeCreated(
        incidentEpisode(),
        NOTIFICATION,
      );
    },
    whatsApp: () => {
      return service.generateWhatsAppTemplateForIncidentEpisodeCreated(
        TO_PHONE,
        incidentEpisode(),
        NOTIFICATION,
      );
    },
    workspace: () => {
      return service.generateWorkspaceMessageBlocksForIncidentEpisodeCreated(
        incidentEpisode(),
        NOTIFICATION,
      );
    },
    email: () => {
      return service.generateEmailTemplateForIncidentEpisodeCreated(
        TO_EMAIL,
        incidentEpisode(),
        NOTIFICATION,
      );
    },
    acknowledgeVar: "acknowledgeIncidentEpisodeLink",
  },
  {
    name: "an alert episode",
    noun: "alert episode",
    call: () => {
      return service.generateCallTemplateForAlertEpisodeCreated(
        TO_PHONE,
        alertEpisode(),
        NOTIFICATION,
      );
    },
    sms: () => {
      return service.generateSmsTemplateForAlertEpisodeCreated(
        TO_PHONE,
        alertEpisode(),
        NOTIFICATION,
      );
    },
    telegram: () => {
      return service.generateTelegramBodyForAlertEpisodeCreated(
        alertEpisode(),
        NOTIFICATION,
      );
    },
    whatsApp: () => {
      return service.generateWhatsAppTemplateForAlertEpisodeCreated(
        TO_PHONE,
        alertEpisode(),
        NOTIFICATION,
      );
    },
    workspace: () => {
      return service.generateWorkspaceMessageBlocksForAlertEpisodeCreated(
        alertEpisode(),
        NOTIFICATION,
      );
    },
    email: () => {
      return service.generateEmailTemplateForAlertEpisodeCreated(
        TO_EMAIL,
        alertEpisode(),
        NOTIFICATION,
      );
    },
    acknowledgeVar: "acknowledgeAlertEpisodeLink",
  },
];

// The page a link opens, and whether it carries this notification's token.
function readLink(url: string): { path: string; hasToken: boolean } {
  const parsed: globalThis.URL = new globalThis.URL(url);

  return {
    path: parsed.pathname,
    hasToken: OnCallPageLinkToken.isValid({
      token: parsed.searchParams.get(ON_CALL_PAGE_LINK_TOKEN_PARAM),
      userOnCallLogTimelineId: NOTIFICATION,
    }),
  };
}

const ACKNOWLEDGE_PAGE: string = `/api/user-notification-log-timeline/acknowledge-page/${NOTIFICATION.toString()}`;
const PASS_ON_PAGE: string = `/api/user-notification-log-timeline/pass-on-page/${NOTIFICATION.toString()}`;

describe.each(KINDS)("the messages that page about $name", (kind: Kind) => {
  test("a call asks for 2 to pass it on, after 1 to acknowledge", async () => {
    const request: CallRequest = await kind.call();
    const gather: GatherInput = request.data.find((item: unknown) => {
      return Boolean((item as GatherInput).introMessage);
    }) as GatherInput;

    expect(gather.introMessage).toBe(
      `To acknowledge this ${kind.noun}, press 1. If you can't take it, press 2 to pass it on.`,
    );
    expect(gather.numDigits).toBe(1);
  });

  test("a call's key press goes to an address with the page's token", async () => {
    const request: CallRequest = await kind.call();
    const gather: GatherInput = request.data.find((item: unknown) => {
      return Boolean((item as GatherInput).introMessage);
    }) as GatherInput;

    expect(readLink(gather.responseUrl.toString())).toEqual({
      path: `/api/user-notification-log-timeline/call/gather-input/${NOTIFICATION.toString()}`,
      hasToken: true,
    });
  });

  test("a call answers the second key from what happened, so the call itself carries no answer for it", async () => {
    const request: CallRequest = await kind.call();
    const gather: GatherInput = request.data.find((item: unknown) => {
      return Boolean((item as GatherInput).introMessage);
    }) as GatherInput;

    expect(Object.keys(gather.onInputCallRequest).sort()).toEqual([
      "1",
      "default",
    ]);
  });

  test("a text says it can be passed on, behind its one link, which carries the token", async () => {
    const sms: SMS = await kind.sms();

    expect(sms.message).toContain(
      `To acknowledge this ${kind.noun}, or pass it on if you can't take it, please click on the following link https://oneuptime.example.com/l/1`,
    );
    expect(shortened.map(readLink)).toEqual([
      { path: ACKNOWLEDGE_PAGE, hasToken: true },
    ]);
  });

  test("a Telegram message has a 'Can't take it? Pass it on' link under Acknowledge", async () => {
    const body: string = await kind.telegram();

    expect(body).toContain(
      '✅ <a href="https://oneuptime.example.com/l/1">Tap to acknowledge</a>',
    );
    expect(body).toContain(
      `⏭️ <a href="https://oneuptime.example.com/l/2">Can't take it? Pass it on</a>`,
    );
    expect(body.indexOf("Tap to acknowledge")).toBeLessThan(
      body.indexOf("Pass it on"),
    );
    expect(shortened.map(readLink)).toEqual([
      { path: ACKNOWLEDGE_PAGE, hasToken: true },
      { path: PASS_ON_PAGE, hasToken: true },
    ]);
  });

  test("a WhatsApp message keeps its approved template; its link opens the page that offers passing on", async () => {
    const message: WhatsAppMessage = await kind.whatsApp();

    expect(message.templateVariables?.["acknowledge_url"]).toBe(
      "https://oneuptime.example.com/l/1",
    );
    expect(Object.keys(message.templateVariables || {})).not.toContain(
      "pass_on_url",
    );
    expect(shortened.map(readLink)).toEqual([
      { path: ACKNOWLEDGE_PAGE, hasToken: true },
    ]);
  });

  test("a Slack or Microsoft Teams direct message has a 'Can't take it? Pass it on' link under Acknowledge", async () => {
    const markdown: string = (await kind.workspace())
      .map((block: WorkspaceMessageBlock): string => {
        return (block as WorkspacePayloadMarkdown).text || "";
      })
      .join("\n");

    expect(markdown).toContain("✅ [Acknowledge](https://oneuptime.example.com/l/1)");
    expect(markdown).toContain(
      "⏭️ [Can't take it? Pass it on](https://oneuptime.example.com/l/2)",
    );
    expect(markdown.indexOf("[Acknowledge]")).toBeLessThan(
      markdown.indexOf("Pass it on"),
    );
    expect(shortened.map(readLink)).toEqual([
      { path: ACKNOWLEDGE_PAGE, hasToken: true },
      { path: PASS_ON_PAGE, hasToken: true },
    ]);
  });

  test("an email gets a Pass it on button, and its Acknowledge button's page offers it too", async () => {
    const email: EmailMessage = await kind.email();

    expect(readLink(String(email.vars[kind.acknowledgeVar]))).toEqual({
      path: ACKNOWLEDGE_PAGE,
      hasToken: true,
    });
    expect(readLink(String(email.vars["passOnLink"]))).toEqual({
      path: PASS_ON_PAGE,
      hasToken: true,
    });
  });
});

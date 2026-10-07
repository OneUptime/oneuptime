/*
 * The alert and incident creation paths pull the native isolated-vm addon
 * through their template renderer (MonitorAlert / MonitorIncident →
 * MonitorTemplateUtil → VMAPI → VMRunner). Nothing under test here touches
 * the sandbox, so stub the module out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AlertService from "../../../../Server/Services/AlertService";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import NetworkDeviceOwnerUserService from "../../../../Server/Services/NetworkDeviceOwnerUserService";
import logger from "../../../../Server/Utils/Logger";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorResourceContextUtil from "../../../../Server/Utils/Monitor/MonitorResourceContext";
import MonitorTemplateUtil, {
  MarkdownTemplateStorageMapKeys,
} from "../../../../Server/Utils/Monitor/MonitorTemplateUtil";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import IncomingEmailMonitorRequest from "../../../../Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { WORD_JOINER } from "../../../../Utils/Markdown/MarkdownEscape";
import {
  hrefsOf,
  renderAsDashboard,
} from "../../../Utils/Markdown/DashboardMarkdownRenderer";
import { mockProjectStates } from "../../TestingUtils/Services/ProjectStatesHelper";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { Lexer, Token, marked } from "marked";

// Where an HTML tag starts.
const HTML_TAG_START_PATTERN: RegExp = /<\/?[A-Za-z]/;
// An image the dashboard would draw.
const DASHBOARD_IMAGE_PATTERN: RegExp = /<img/;
// A diagram the dashboard would draw.
const MERMAID_CLASS_PATTERN: RegExp = /language-mermaid/i;

/*
 * TEXT A MONITORED SYSTEM SENT, IN AN ALERT'S OR AN INCIDENT'S DESCRIPTION.
 *
 * A monitor's description and remediation notes templates place what the
 * monitored system sent - an incoming email's subject and body, an API's
 * response body - into Markdown that the dashboard, email, and the record's
 * Slack and Microsoft Teams channels all show. Whatever that text holds, it
 * reads there exactly as it was sent, and acts on nothing: no mention
 * notifies anybody, no image is fetched, no link hides where it goes, and no
 * HTML tag or diagram is drawn. The template's own Markdown - what the
 * project's people wrote - renders as before.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const RECEIVED_AT: Date = new Date("2026-10-05T09:55:00.000Z");

// What a sender can put in an email a monitor watches.
const SUBJECT: string =
  "<!channel> [Verify your account](https://evil.example/login)";
const BODY: string = [
  "Backup failed. <@U0123ABC> <!here>",
  "",
  "![](https://tracker.example/p.png)",
  "",
  '<a href="https://evil.example/a">Open the dashboard</a> <img src="https://tracker.example/q.png">',
  "",
  "[ref]: https://evil.example/ref",
  "",
  "See [the details][ref].",
  "",
  "```mermaid",
  "flowchart TD",
  '  A@{ img: "https://tracker.example/m.png" }',
  "```",
].join("\n");

const WORD_JOINER_PATTERN: RegExp = new RegExp(WORD_JOINER, "g");
const SLACK_MENTION_PATTERN: RegExp = /<[!@#][A-Za-z0-9]/;
const SLACK_LINK_PATTERN: RegExp = /<(https?:\/\/[^|>]+)\|([^>]*)>/g;
const HTML_ANCHOR_PATTERN: RegExp = /<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
const HTML_TAG_PATTERN: RegExp = /<[^>]+>/g;
// The addresses the sent text brings.
const SENT_ADDRESS_PATTERN: RegExp = /^https:\/\/(?:evil|tracker)\.example/;

function withoutJoiners(text: string): string {
  return text.replace(WORD_JOINER_PATTERN, "");
}

function tokensOf(markdown: string): Array<Token> {
  const tokens: Array<Token> = [];

  marked.walkTokens(
    new Lexer({ gfm: true, breaks: false, pedantic: false }).lex(markdown),
    (token: Token): void => {
      tokens.push(token);
    },
  );

  return tokens;
}

function withoutHtmlEscapes(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// A link to an address the sent text brought, whose words are not that address.
function hidesWhereItGoes(words: string, href: string): boolean {
  let address: string = withoutHtmlEscapes(href);

  try {
    address = decodeURI(address);
  } catch {
    // Compared as it is.
  }

  return (
    SENT_ADDRESS_PATTERN.test(address) && withoutHtmlEscapes(words) !== address
  );
}

/*
 * Each text as marked (the emails), the dashboard's parser and Slack read
 * it: no image, no HTML tag, no diagram, no mention, and no link to an
 * address the sent text brought whose words hide where it goes.
 */
function expectInert(markdowns: Array<string>): void {
  const htmls: Array<string> = renderAsDashboard(markdowns);

  markdowns.forEach((markdown: string, index: number): void => {
    const tokens: Array<Token> = tokensOf(markdown);
    const html: string = htmls[index]!;
    const slack: string = SlackUtil.convertMarkdownToSlackRichText(markdown);

    expect({
      markdown: markdown,
      images: tokens.filter((token: Token): boolean => {
        return token.type === "image";
      }).length,
      htmlTags: tokens.filter((token: Token): boolean => {
        return token.type === "html" && HTML_TAG_START_PATTERN.test(token.raw);
      }).length,
      hidingLinks: [
        ...tokens
          .filter((token: Token): boolean => {
            return (
              token.type === "link" &&
              hidesWhereItGoes(
                (token as { text: string }).text,
                (token as { href: string }).href,
              )
            );
          })
          .map((token: Token): string => {
            return token.raw;
          }),
        ...Array.from(html.matchAll(HTML_ANCHOR_PATTERN))
          .filter((match: RegExpMatchArray): boolean => {
            return hidesWhereItGoes(
              match[2]!.replace(HTML_TAG_PATTERN, ""),
              hrefsOf(match[0])[0]!,
            );
          })
          .map((match: RegExpMatchArray): string => {
            return match[0];
          }),
        ...Array.from(slack.matchAll(SLACK_LINK_PATTERN))
          .filter((match: RegExpMatchArray): boolean => {
            return hidesWhereItGoes(match[2]!, match[1]!);
          })
          .map((match: RegExpMatchArray): string => {
            return match[0];
          }),
      ],
      dashboardImage: DASHBOARD_IMAGE_PATTERN.test(html),
      diagram: MERMAID_CLASS_PATTERN.test(html),
      slackMention: SLACK_MENTION_PATTERN.test(slack),
    }).toEqual({
      markdown: markdown,
      images: 0,
      htmlTags: 0,
      hidingLinks: [],
      dashboardImage: false,
      diagram: false,
      slackMention: false,
    });
  });
}

function monitor(monitorType: MonitorType): Monitor {
  const model: Monitor = new Monitor();
  model._id = MONITOR_ID.toString();
  model.projectId = PROJECT_ID;
  model.monitorType = monitorType;
  model.name = "Nightly backups";
  model.incomingEmailSecretKey = ObjectID.generate();
  return model;
}

function receivedEmail(sent: {
  subject: string;
  body: string;
}): IncomingEmailMonitorRequest {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    emailFrom: "backups@acme.example",
    emailTo: "monitor-[REDACTED]@inbound.oneuptime.example",
    emailSubject: sent.subject,
    emailBody: sent.body,
    emailHeaders: {},
    emailReceivedAt: RECEIVED_AT,
    checkedAt: RECEIVED_AT,
    onlyCheckForIncomingEmailReceivedAt: false,
  };
}

function apiResponse(body: string): ProbeMonitorResponse {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitoredAt: RECEIVED_AT,
    isOnline: false,
    responseCode: 503,
    responseBody: body,
    responseHeaders: { "content-type": "application/json" },
  } as unknown as ProbeMonitorResponse;
}

interface Template {
  title: string;
  description: string;
  remediationNotes?: string | undefined;
}

function alertCriteria(template: Template): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = "criteria-1";
  instance.data!.name = "Backup failed";
  instance.data!.createIncidents = false;
  instance.data!.createAlerts = true;
  instance.data!.alerts = [
    {
      id: "alert-template-1",
      title: template.title,
      description: template.description,
      remediationNotes: template.remediationNotes,
      alertSeverityId: ALERT_SEVERITY_ID,
      autoResolveAlert: false,
    },
  ];
  return instance;
}

function incidentCriteria(template: Template): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = "criteria-1";
  instance.data!.name = "Backup failed";
  instance.data!.createIncidents = true;
  instance.data!.createAlerts = false;
  instance.data!.incidents = [
    {
      id: "incident-template-1",
      title: template.title,
      description: template.description,
      remediationNotes: template.remediationNotes,
      incidentSeverityId: INCIDENT_SEVERITY_ID,
      autoResolveIncident: false,
    },
  ];
  return instance;
}

const NO_AUTO_RESOLVE: Dictionary<Array<string>> = {};

function registerSeverity(
  service: { findOneBy: unknown },
  severity: DatabaseBaseModel,
  id: ObjectID,
): void {
  severity._id = id.toString();
  severity.setValue("projectId", PROJECT_ID);

  jest
    .spyOn(service as never, "findOneBy" as never)
    .mockImplementation((async (): Promise<DatabaseBaseModel> => {
      return severity;
    }) as never);
}

let createdAlerts: Array<Alert> = [];
let createdIncidents: Array<Incident> = [];

beforeEach(() => {
  mockProjectStates();
  createdAlerts = [];
  createdIncidents = [];

  jest.spyOn(AlertService, "findBy").mockResolvedValue([]);
  jest.spyOn(IncidentService, "findBy").mockResolvedValue([]);

  registerSeverity(
    AlertSeverityService,
    new AlertSeverity(),
    ALERT_SEVERITY_ID,
  );
  registerSeverity(
    IncidentSeverityService,
    new IncidentSeverity(),
    INCIDENT_SEVERITY_ID,
  );

  jest
    .spyOn(MonitorResourceContextUtil, "resolveResourceContextForMonitor")
    .mockResolvedValue(MonitorResourceContextUtil.emptyContext());
  jest
    .spyOn(MonitorResourceContextUtil, "resolveLinkedResourcesForMonitor")
    .mockResolvedValue(MonitorResourceContextUtil.emptyContext());
  jest
    .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
    .mockResolvedValue({ ownerUserIds: [], ownerTeamIds: [] });

  jest
    .spyOn(AlertService, "create")
    .mockImplementation(async (createBy: unknown): Promise<Alert> => {
      const alert: Alert = (createBy as { data: Alert }).data;
      createdAlerts.push(alert);
      alert._id = ObjectID.generate().toString();
      return alert;
    });
  jest
    .spyOn(IncidentService, "create")
    .mockImplementation(async (createBy: unknown): Promise<Incident> => {
      const incident: Incident = (createBy as { data: Incident }).data;
      createdIncidents.push(incident);
      incident._id = ObjectID.generate().toString();
      return incident;
    });

  jest.spyOn(AlertService, "addOwners").mockResolvedValue(undefined);
  jest.spyOn(IncidentService, "addOwners").mockResolvedValue(undefined);

  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function openAlert(
  template: Template,
  data: DataToProcess,
  monitorType: MonitorType,
): Promise<Alert> {
  await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
    criteriaInstance: alertCriteria(template),
    monitor: monitor(monitorType),
    dataToProcess: data,
    rootCause: "The check failed.",
    autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
    props: {},
  });

  expect(createdAlerts).toHaveLength(1);
  return createdAlerts[0]!;
}

async function openIncident(
  template: Template,
  data: DataToProcess,
  monitorType: MonitorType,
): Promise<Incident> {
  await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
    criteriaInstance: incidentCriteria(template),
    monitor: monitor(monitorType),
    dataToProcess: data,
    rootCause: "The check failed.",
    autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
    props: {},
  });

  expect(createdIncidents).toHaveLength(1);
  return createdIncidents[0]!;
}

/*
 * A description template the project's people wrote, with Markdown of its
 * own, placing the email in a sentence, a list, a code span and a fenced
 * block. (A value can end the author's fenced block early - it is text the
 * sender chose - but what follows it still acts on nothing.)
 */
const EMAIL_TEMPLATE: Template = {
  title: "{{emailSubject}}",
  description: [
    "## Backup alert",
    "",
    "**Subject:** {{emailSubject}}",
    "",
    "[Runbook](https://wiki.acme.example/backups)",
    "",
    "- Body: {{emailBody}}",
    "",
    "`{{emailSubject}}`",
    "",
    "```",
    "{{emailBody}}",
    "```",
  ].join("\n"),
  remediationNotes: "Reply to the sender of {{emailSubject}}:\n\n{{emailBody}}",
};

describe("An alert's description and remediation notes show an email's text as text", () => {
  it("nothing the email holds acts on its own, wherever the template places it", async () => {
    const alert: Alert = await openAlert(
      EMAIL_TEMPLATE,
      receivedEmail({ subject: SUBJECT, body: BODY }),
      MonitorType.IncomingEmail,
    );

    expectInert([alert.description!, alert.remediationNotes!]);
  });

  it("the email reads exactly as it was sent", async () => {
    const alert: Alert = await openAlert(
      EMAIL_TEMPLATE,
      receivedEmail({ subject: SUBJECT, body: BODY }),
      MonitorType.IncomingEmail,
    );

    expect(withoutJoiners(alert.description!)).toBe(
      EMAIL_TEMPLATE.description
        .split("{{emailSubject}}")
        .join(SUBJECT)
        .split("{{emailBody}}")
        .join(BODY),
    );
    expect(withoutJoiners(alert.remediationNotes!)).toBe(
      `Reply to the sender of ${SUBJECT}:\n\n${BODY}`,
    );
  });

  it("the template's own Markdown still renders: its heading, emphasis and link", async () => {
    const alert: Alert = await openAlert(
      EMAIL_TEMPLATE,
      receivedEmail({ subject: SUBJECT, body: BODY }),
      MonitorType.IncomingEmail,
    );

    const tokens: Array<Token> = tokensOf(alert.description!);

    expect(
      tokens.some((token: Token): boolean => {
        return token.type === "heading" && token.raw.includes("Backup alert");
      }),
    ).toBe(true);
    expect(
      tokens.some((token: Token): boolean => {
        return token.type === "strong";
      }),
    ).toBe(true);
    expect(
      tokens
        .filter((token: Token): boolean => {
          return token.type === "link";
        })
        .map((token: Token): string => {
          return (token as { href: string }).href;
        }),
    ).toContain("https://wiki.acme.example/backups");
  });

  it("the title keeps the subject as written: a title is plain text, escaped wherever it is shown", async () => {
    const alert: Alert = await openAlert(
      EMAIL_TEMPLATE,
      receivedEmail({ subject: SUBJECT, body: BODY }),
      MonitorType.IncomingEmail,
    );

    expect(alert.title).toBe(SUBJECT);
  });
});

describe("An incident's description and remediation notes show an email's text as text", () => {
  it("nothing the email holds acts on its own, and it reads as sent", async () => {
    const incident: Incident = await openIncident(
      EMAIL_TEMPLATE,
      receivedEmail({ subject: SUBJECT, body: BODY }),
      MonitorType.IncomingEmail,
    );

    expectInert([incident.description!, incident.remediationNotes!]);
    expect(withoutJoiners(incident.remediationNotes!)).toBe(
      `Reply to the sender of ${SUBJECT}:\n\n${BODY}`,
    );
    expect(incident.title).toBe(SUBJECT);
  });
});

describe("An API monitor's response body in a description", () => {
  const RESPONSE: JSONObject = {
    message: "<!channel> [Reset your password](https://evil.example/login)",
    detail:
      '<img src="https://tracker.example/p.png"> ![](https://tracker.example/q.png)',
    "<b>key</b>": "value",
    count: 3,
    healthy: false,
  };

  it("a value read by its path acts on nothing and reads as sent; numbers and booleans stay what they are", async () => {
    const alert: Alert = await openAlert(
      {
        title: "API down",
        description:
          "Status {{responseStatusCode}}: {{responseBody.message}}\n\n- {{responseBody.detail}}\n- count {{responseBody.count}}, healthy {{responseBody.healthy}}",
      },
      apiResponse(JSON.stringify(RESPONSE)),
      MonitorType.API,
    );

    expectInert([alert.description!]);
    expect(withoutJoiners(alert.description!)).toBe(
      `Status 503: ${RESPONSE["message"]}\n\n- ${RESPONSE["detail"]}\n- count 3, healthy false`,
    );
  });

  it("the whole body placed at once - keys too - acts on nothing", async () => {
    const alert: Alert = await openAlert(
      { title: "API down", description: "Body: {{responseBody}}" },
      apiResponse(JSON.stringify(RESPONSE)),
      MonitorType.API,
    );

    expectInert([alert.description!]);
    expect(withoutJoiners(alert.description!)).toContain("<b>key</b>");
    expect(alert.description!).not.toContain("<b>");
  });

  it("an HTML page a website answered with reads as its source, and draws nothing", async () => {
    const page: string =
      '<html><body><a href="https://evil.example/login">Sign in</a><img src="https://tracker.example/p.png"></body></html>';

    const alert: Alert = await openAlert(
      {
        title: "Site down",
        description: "The site answered:\n\n{{responseBody}}",
      },
      apiResponse(page),
      MonitorType.Website,
    );

    expectInert([alert.description!]);
    expect(withoutJoiners(alert.description!)).toBe(
      `The site answered:\n\n${page}`,
    );
  });
});

describe("MonitorTemplateUtil.buildMarkdownStorageMap", () => {
  it("neutralizes every string a monitored system reported, nested ones and object keys included", () => {
    const map: JSONObject = MonitorTemplateUtil.buildMarkdownStorageMap({
      storageMap: {
        responseBody: {
          items: [{ name: "<!here>" }, "[x](https://evil.example)"],
          "<i>k</i>": { deeper: "![](https://tracker.example/p.png)" },
        },
        responseHeaders: { server: '<a href="https://evil.example">x</a>' },
      },
    });

    expect(JSON.stringify(map)).not.toMatch(/<[A-Za-z!@#/]/);
    expect(JSON.stringify(map)).not.toContain("](https://");
    expect(JSON.stringify(map)).not.toContain("![](");
    expect(withoutJoiners(JSON.stringify(map))).toBe(
      JSON.stringify({
        responseBody: {
          items: [{ name: "<!here>" }, "[x](https://evil.example)"],
          "<i>k</i>": { deeper: "![](https://tracker.example/p.png)" },
        },
        responseHeaders: { server: '<a href="https://evil.example">x</a>' },
      }),
    );
  });

  it("keeps numbers, booleans and null as they are, and a date as its ISO text", () => {
    const map: JSONObject = MonitorTemplateUtil.buildMarkdownStorageMap({
      storageMap: {
        responseStatusCode: 503,
        isOnline: false,
        nothing: null,
        incomingRequestReceivedAt: RECEIVED_AT,
      },
    });

    expect(map).toEqual({
      responseStatusCode: 503,
      isOnline: false,
      nothing: null,
      incomingRequestReceivedAt: RECEIVED_AT.toISOString(),
    });
  });

  it.each(Array.from(MarkdownTemplateStorageMapKeys))(
    "places %s - Markdown OneUptime or the project's people wrote - as it is",
    (key: string) => {
      const markdown: string =
        "**Affected resource**\n- **Pod:** `web-1`\n\n[Runbook](https://wiki.acme.example)";

      const map: JSONObject = MonitorTemplateUtil.buildMarkdownStorageMap({
        storageMap: { [key]: markdown },
      });

      expect(map[key]).toBe(markdown);
    },
  );

  it("leaves the map it was given as it was", () => {
    const storageMap: JSONObject = {
      responseBody: { message: "<!channel>" },
    };

    MonitorTemplateUtil.buildMarkdownStorageMap({ storageMap });

    expect(storageMap).toEqual({ responseBody: { message: "<!channel>" } });
  });

  it("is what descriptions render against, while a title renders against the map as reported", () => {
    const storageMap: JSONObject = { emailSubject: SUBJECT };

    expect(
      withoutJoiners(
        MonitorTemplateUtil.processTemplateString({
          value: "{{emailSubject}}",
          storageMap: MonitorTemplateUtil.buildMarkdownStorageMap({
            storageMap,
          }),
        }),
      ),
    ).toBe(SUBJECT);
    expect(
      MonitorTemplateUtil.processTemplateString({
        value: "{{emailSubject}}",
        storageMap: MonitorTemplateUtil.buildTitleStorageMap({
          monitorType: MonitorType.IncomingEmail,
          storageMap,
        }),
      }),
    ).toBe(SUBJECT);
  });
});

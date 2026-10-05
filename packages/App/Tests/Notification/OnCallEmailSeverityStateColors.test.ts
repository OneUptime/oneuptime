import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Project from "Common/Models/DatabaseModels/Project";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import AlertEpisodeMemberService from "Common/Server/Services/AlertEpisodeMemberService";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import AlertService from "Common/Server/Services/AlertService";
import IncidentEpisodeMemberService from "Common/Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentService from "Common/Server/Services/IncidentService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import Color from "Common/Types/Color";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import ObjectID from "Common/Types/ObjectID";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";

/*
 * Registers the product's real Handlebars helpers as an import side effect.
 */
import "../../FeatureSet/Notification/Utils/Handlebars";

/*
 * THE ON-CALL PAGE EMAILS - the ones a responder is woken up by - paint the
 * state and the severity of what they are being paged for in the colours the
 * project gave them, the same way the dashboard does.
 *
 * The builders in UserNotificationRuleService are real; only the database
 * reads and link lookups are stubbed. Each email is built AND rendered
 * through its real template, so the handshake between the variable names the
 * builder sets and the ones the template reads is what is under test.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-ffff-4aaa-8bbb-000000000101",
);
const RECORD_ID: ObjectID = new ObjectID(
  "0193c0de-ffff-4aaa-8bbb-000000000102",
);
const LOG_TIMELINE_ID: ObjectID = new ObjectID(
  "0193c0de-ffff-4aaa-8bbb-000000000103",
);
const RESPONDER: Email = new Email("responder@acme.test");

const STATE_COLOR: string = "#ef4444";
const PALE_SEVERITY_COLOR: string = "#facc15";

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

function render(message: EmailMessage): string {
  return Handlebars.compile(
    fs.readFileSync(Path.resolve(TEMPLATES_DIR, message.templateType!), "utf8"),
  )(message.vars);
}

function project(): Project {
  const acme: Project = new Project();
  acme.name = "Acme";
  return acme;
}

interface Colours {
  state?: string | undefined;
  severity?: string | undefined;
}

function alertState(colours: Colours): AlertState {
  const state: AlertState = new AlertState();
  state.name = "Firing";
  if (colours.state !== undefined) {
    state.color = new Color(colours.state);
  }
  return state;
}

function alertSeverity(colours: Colours): AlertSeverity {
  const severity: AlertSeverity = new AlertSeverity();
  severity.name = "Low";
  if (colours.severity !== undefined) {
    severity.color = new Color(colours.severity);
  }
  return severity;
}

function incidentState(colours: Colours): IncidentState {
  const state: IncidentState = new IncidentState();
  state.name = "Identified";
  if (colours.state !== undefined) {
    state.color = new Color(colours.state);
  }
  return state;
}

function incidentSeverity(colours: Colours): IncidentSeverity {
  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Low";
  if (colours.severity !== undefined) {
    severity.color = new Color(colours.severity);
  }
  return severity;
}

interface OnCallCase {
  name: string;
  severityVariable: string;
  stateName: string;
  build: (colours: Colours) => Promise<EmailMessage>;
}

const CASES: Array<OnCallCase> = [
  {
    name: "alert",
    severityVariable: "alertSeverity",
    stateName: "Firing",
    build: async (colours: Colours): Promise<EmailMessage> => {
      const model: Alert = new Alert(RECORD_ID);
      model.projectId = PROJECT_ID;
      model.project = project();
      model.title = "Checkout latency";
      model.alertNumber = 12;
      model.currentAlertState = alertState(colours);
      model.alertSeverity = alertSeverity(colours);

      return await UserNotificationRuleService.generateEmailTemplateForAlertCreated(
        RESPONDER,
        model,
        LOG_TIMELINE_ID,
      );
    },
  },
  {
    name: "incident",
    severityVariable: "incidentSeverity",
    stateName: "Identified",
    build: async (colours: Colours): Promise<EmailMessage> => {
      const model: Incident = new Incident(RECORD_ID);
      model.projectId = PROJECT_ID;
      model.project = project();
      model.title = "Checkout is down";
      model.incidentNumber = 7;
      model.currentIncidentState = incidentState(colours);
      model.incidentSeverity = incidentSeverity(colours);

      return await UserNotificationRuleService.generateEmailTemplateForIncidentCreated(
        RESPONDER,
        model,
        LOG_TIMELINE_ID,
      );
    },
  },
  {
    name: "alert episode",
    severityVariable: "alertEpisodeSeverity",
    stateName: "Firing",
    build: async (colours: Colours): Promise<EmailMessage> => {
      const model: AlertEpisode = new AlertEpisode(RECORD_ID);
      model.projectId = PROJECT_ID;
      model.project = project();
      model.title = "Checkout alerts";
      model.episodeNumber = 3;
      model.currentAlertState = alertState(colours);
      model.alertSeverity = alertSeverity(colours);

      return await UserNotificationRuleService.generateEmailTemplateForAlertEpisodeCreated(
        RESPONDER,
        model,
        LOG_TIMELINE_ID,
      );
    },
  },
  {
    name: "incident episode",
    severityVariable: "incidentEpisodeSeverity",
    stateName: "Identified",
    build: async (colours: Colours): Promise<EmailMessage> => {
      const model: IncidentEpisode = new IncidentEpisode(RECORD_ID);
      model.projectId = PROJECT_ID;
      model.project = project();
      model.title = "Checkout incidents";
      model.episodeNumber = 4;
      model.currentIncidentState = incidentState(colours);
      model.incidentSeverity = incidentSeverity(colours);

      return await UserNotificationRuleService.generateEmailTemplateForIncidentEpisodeCreated(
        RESPONDER,
        model,
        LOG_TIMELINE_ID,
      );
    },
  },
];

beforeAll(() => {
  const partialsDir: string = Path.resolve(TEMPLATES_DIR, "Partials");

  for (const filename of fs.readdirSync(partialsDir)) {
    const matches: RegExpMatchArray | null = filename.match(/^(.*)\.hbs$/u);

    if (matches) {
      Handlebars.registerPartial(
        matches[1]!,
        fs.readFileSync(Path.resolve(partialsDir, filename), "utf8"),
      );
    }
  }
});

beforeEach(() => {
  const link: URL = URL.fromString("https://oneuptime.test/dashboard/r1");

  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.test"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);
  jest.spyOn(AlertService, "getAlertLinkInDashboard").mockResolvedValue(link);
  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(link);
  jest
    .spyOn(AlertEpisodeService, "getEpisodeLinkInDashboard")
    .mockResolvedValue(link);
  jest
    .spyOn(IncidentEpisodeService, "getEpisodeLinkInDashboard")
    .mockResolvedValue(link);
  // No linked resources and no members: only the colours are under test.
  jest.spyOn(AlertService, "findAllBy").mockResolvedValue([] as never);
  jest.spyOn(IncidentService, "findAllBy").mockResolvedValue([] as never);
  jest
    .spyOn(AlertEpisodeMemberService, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(IncidentEpisodeMemberService, "findBy")
    .mockResolvedValue([] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(CASES)("the $name on-call email", (entry: OnCallCase) => {
  test("carries the state's and the severity's dot and name colours", async () => {
    const message: EmailMessage = await entry.build({
      state: STATE_COLOR,
      severity: PALE_SEVERITY_COLOR,
    });

    expect(message.vars).toMatchObject({
      currentState: entry.stateName,
      ...EmailColorUtil.getTemplateVariables("currentState", STATE_COLOR),
      [entry.severityVariable]: "Low",
      ...EmailColorUtil.getTemplateVariables(
        entry.severityVariable,
        PALE_SEVERITY_COLOR,
      ),
    });
  });

  test("renders a dot and a coloured name for both, with neutral labels", async () => {
    const html: string = render(
      await entry.build({
        state: STATE_COLOR,
        severity: PALE_SEVERITY_COLOR,
      }),
    );
    const paleText: string =
      EmailColorUtil.getColorPair(PALE_SEVERITY_COLOR)!.textColor;
    const stateText: string =
      EmailColorUtil.getColorPair(STATE_COLOR)!.textColor;

    expect(html).toContain(`background-color: ${STATE_COLOR};`);
    expect(html).toContain(`background-color: ${PALE_SEVERITY_COLOR};`);
    expect(html).toMatch(
      new RegExp(
        `<span class="st-ColorText" style="color: ${stateText}; [^"]*">${entry.stateName}</span>`,
      ),
    );
    expect(html).toMatch(
      new RegExp(
        `<span class="st-ColorText" style="color: ${paleText}; [^"]*">Low</span>`,
      ),
    );
    expect(html.match(/class="st-ColorDot"/g)).toHaveLength(2);
    expect(html).toMatch(/color: #64748b; font-weight: 600;">Severity:/);
  });

  test("an unusable colour is left out and the names render plain", async () => {
    const message: EmailMessage = await entry.build({
      state: "#fff; background: url(https://evil.example/t.gif)",
      severity: "tomato",
    });
    const html: string = render(message);

    for (const name of [
      "currentStateColor",
      "currentStateTextColor",
      `${entry.severityVariable}Color`,
      `${entry.severityVariable}TextColor`,
    ]) {
      expect(message.vars).not.toHaveProperty(name);
    }

    expect(html).not.toContain("st-ColorDot");
    expect(html).not.toContain("evil.example");
    expect(html).toContain(`>${entry.stateName}</div>`);
    expect(html).toContain(">Low</div>");
  });

  test("a state and severity without colours render as they always did", async () => {
    const html: string = render(await entry.build({}));

    expect(html).not.toContain("st-ColorDot");
    expect(html).not.toMatch(/color: ;|solid ;/);
  });
});

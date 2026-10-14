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
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Project from "Common/Models/DatabaseModels/Project";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import AlertService from "Common/Server/Services/AlertService";
import IncidentService from "Common/Server/Services/IncidentService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import ObjectID from "Common/Types/ObjectID";
// Registers the product's real Handlebars helpers as an import side effect.
import "../../FeatureSet/Notification/Utils/Handlebars";
import { EmailMarkupTree, readEmailMarkup } from "./Fixtures/EmailMarkupTree";
import {
  DetailCard,
  DetailCardRow,
  detailCards,
  misplacedDividers,
} from "./Fixtures/EmailDividers";

/*
 * THE PAGE-OUT EMAILS END THEIR DETAIL CARD WITH THE LAST ROW THAT HAS
 * SOMETHING TO SHOW.
 *
 * AcknowledgeAlert and AcknowledgeIncident are what an on-call responder is
 * paged with. Their card lists the title, state, resources, severity, root
 * cause and description. An alert or incident without a description ended
 * the card with a bare "Description:" label - the last thing above the
 * card's bottom border, with nothing under it. A row with no value is left
 * out now (Partials/DetailBoxField.hbs), so the card ends with the root
 * cause, which the generators always fill: "No root cause identified" when
 * there is none.
 *
 * The generators are real; only the database reads and link lookups are
 * stubbed. Each email is built AND rendered through its real template.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-ffff-4aaa-8bbb-000000000401",
);
const RECORD_ID: ObjectID = new ObjectID(
  "0193c0de-ffff-4aaa-8bbb-000000000402",
);
const LOG_TIMELINE_ID: ObjectID = new ObjectID(
  "0193c0de-ffff-4aaa-8bbb-000000000403",
);
const RESPONDER: Email = new Email("responder@acme.test");

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);

const render: (message: EmailMessage) => string = (
  message: EmailMessage,
): string => {
  return Handlebars.compile(
    fs.readFileSync(Path.join(TEMPLATES_DIR, message.templateType!), "utf8"),
  )(message.vars);
};

const project: () => Project = (): Project => {
  const acme: Project = new Project();
  acme.name = "Acme";
  return acme;
};

interface Fields {
  description?: string | undefined;
  rootCause?: string | undefined;
}

interface PageOutCase {
  name: string;
  titleLabel: string;
  missingRootCause: string;
  build: (fields: Fields) => Promise<EmailMessage>;
}

const CASES: Array<PageOutCase> = [
  {
    name: "alert",
    titleLabel: "Alert Title:",
    missingRootCause: "No root cause identified for this alert",
    build: async (fields: Fields): Promise<EmailMessage> => {
      const state: AlertState = new AlertState();
      state.name = "Created";
      const severity: AlertSeverity = new AlertSeverity();
      severity.name = "Critical";

      const alert: Alert = new Alert(RECORD_ID);
      alert.projectId = PROJECT_ID;
      alert.project = project();
      alert.title = "API: Status Page is currently offline";
      alert.alertNumber = 42;
      alert.alertNumberWithPrefix = "ALT-42";
      alert.currentAlertState = state;
      alert.alertSeverity = severity;

      if (fields.description !== undefined) {
        alert.description = fields.description;
      }

      if (fields.rootCause !== undefined) {
        alert.rootCause = fields.rootCause;
      }

      return await UserNotificationRuleService.generateEmailTemplateForAlertCreated(
        RESPONDER,
        alert,
        LOG_TIMELINE_ID,
      );
    },
  },
  {
    name: "incident",
    titleLabel: "Incident Title:",
    missingRootCause: "No root cause identified for this incident",
    build: async (fields: Fields): Promise<EmailMessage> => {
      const state: IncidentState = new IncidentState();
      state.name = "Identified";
      const severity: IncidentSeverity = new IncidentSeverity();
      severity.name = "Critical";

      const incident: Incident = new Incident(RECORD_ID);
      incident.projectId = PROJECT_ID;
      incident.project = project();
      incident.title = "API: Status Page is currently offline";
      incident.incidentNumber = 184;
      incident.incidentNumberWithPrefix = "INC-184";
      incident.currentIncidentState = state;
      incident.incidentSeverity = severity;

      if (fields.description !== undefined) {
        incident.description = fields.description;
      }

      if (fields.rootCause !== undefined) {
        incident.rootCause = fields.rootCause;
      }

      return await UserNotificationRuleService.generateEmailTemplateForIncidentCreated(
        RESPONDER,
        incident,
        LOG_TIMELINE_ID,
      );
    },
  },
];

beforeAll(() => {
  const partialsDir: string = Path.join(TEMPLATES_DIR, "Partials");

  for (const file of fs.readdirSync(partialsDir)) {
    if (file.endsWith(".hbs")) {
      Handlebars.registerPartial(
        file.slice(0, -4),
        fs.readFileSync(Path.join(partialsDir, file), "utf8"),
      );
    }
  }
});

beforeEach(() => {
  const link: URL = URL.fromString("https://oneuptime.test/dashboard/item");

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
  // No linked resources: the card reads "No resources identified".
  jest.spyOn(AlertService, "findAllBy").mockResolvedValue([] as never);
  jest.spyOn(IncidentService, "findAllBy").mockResolvedValue([] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const labelsOf: (detailCard: DetailCard) => Array<string> = (
  detailCard: DetailCard,
): Array<string> => {
  return detailCard.rows.map((row: DetailCardRow): string => {
    return row.label;
  });
};

const cardOf: (html: string) => DetailCard = (html: string): DetailCard => {
  const cards: Array<DetailCard> = detailCards(readEmailMarkup(html));

  expect(cards).toHaveLength(1);

  return cards[0]!;
};

describe.each(CASES)("the $name page-out email", (entry: PageOutCase) => {
  test.each([
    ["no description", {}],
    ["an empty description", { description: "" }],
    ["a description of blank lines", { description: "\n\n   \n" }],
  ])(
    "with %s, ends its card with the root cause",
    async (_name: string, fields: Fields) => {
      const html: string = render(
        await entry.build({ ...fields, rootCause: "**Cause**: Timed out" }),
      );
      const detailCard: DetailCard = cardOf(html);

      expect(labelsOf(detailCard)).toEqual([
        entry.titleLabel,
        "Current State:",
        "Resources Affected:",
        "Severity:",
        "Root Cause:",
      ]);
      expect(html).not.toContain("Description:");
      expect(
        detailCard.rows.every((row: DetailCardRow): boolean => {
          return row.showsValue;
        }),
      ).toBe(true);
      expect(misplacedDividers(readEmailMarkup(html))).toEqual([]);
    },
  );

  test("with neither a root cause nor a description, still says why it fired: there is no known root cause", async () => {
    const message: EmailMessage = await entry.build({});
    const tree: EmailMarkupTree = readEmailMarkup(render(message));
    const detailCard: DetailCard = detailCards(tree)[0]!;
    const last: DetailCardRow = detailCard.rows[detailCard.rows.length - 1]!;

    expect(String(message.vars["rootCause"])).toContain(entry.missingRootCause);
    expect(last.label).toBe("Root Cause:");
    expect(last.showsValue).toBe(true);
    expect(last.dividerBelow).toBe(false);
    expect(misplacedDividers(tree)).toEqual([]);
  });

  test("with a description, ends its card with it", async () => {
    const html: string = render(
      await entry.build({
        description: "API: Status Page is currently offline.",
        rootCause: "**Probes in Agreement**: US, EU",
      }),
    );
    const labels: Array<string> = labelsOf(cardOf(html));

    expect(labels.slice(-2)).toEqual(["Root Cause:", "Description:"]);
    expect(html).toContain("<p>API: Status Page is currently offline.</p>");
    expect(misplacedDividers(readEmailMarkup(html))).toEqual([]);
  });
});

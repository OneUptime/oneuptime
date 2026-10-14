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
import AlertEpisodeMember from "Common/Models/DatabaseModels/AlertEpisodeMember";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "Common/Models/DatabaseModels/IncidentEpisodeMember";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import AlertEpisodeMemberService from "Common/Server/Services/AlertEpisodeMemberService";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import AlertService from "Common/Server/Services/AlertService";
import IncidentEpisodeMemberService from "Common/Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentService from "Common/Server/Services/IncidentService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import { EPISODE_MEMBER_ROW_DIVIDER } from "Common/Server/Utils/Mail/EpisodeMemberEmailList";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import ObjectID from "Common/Types/ObjectID";
// Registers the product's real Handlebars helpers as an import side effect.
import "../../FeatureSet/Notification/Utils/Handlebars";
import {
  childElements,
  EmailElement,
  EmailMarkupTree,
  findElements,
  readEmailMarkup,
  textOf,
} from "./Fixtures/EmailMarkupTree";
import {
  detailCards,
  dividerSides,
  dividersOnlyBetweenRows,
  drawsBox,
  misplacedDividers,
} from "./Fixtures/EmailDividers";

/*
 * THE EPISODE PAGE-OUT EMAILS LIST THEIR ALERTS OR INCIDENTS WITH DIVIDERS
 * ONLY BETWEEN THEM.
 *
 * AcknowledgeAlertEpisode and AcknowledgeIncidentEpisode - what a responder
 * is paged with for an episode - list the episode's members under "Alerts
 * in this Episode" / "Incidents in this Episode". UserNotificationRuleService
 * built each row with a divider under it, so the last one doubled the
 * list's bottom border. It builds them with EpisodeMemberEmailList now,
 * which draws a divider above every row but the first.
 *
 * The builders are real; only the database reads and link lookups are
 * stubbed. Each email is built AND rendered through its real template.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-ffff-4aaa-8bbb-000000000201",
);
const EPISODE_ID: ObjectID = new ObjectID(
  "0193c0de-ffff-4aaa-8bbb-000000000202",
);
const LOG_TIMELINE_ID: ObjectID = new ObjectID(
  "0193c0de-ffff-4aaa-8bbb-000000000203",
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

const memberId: (index: number) => ObjectID = (index: number): ObjectID => {
  return new ObjectID(
    `0193c0de-ffff-4aaa-8bbb-${String(300 + index).padStart(12, "0")}`,
  );
};

const project: () => Project = (): Project => {
  const acme: Project = new Project();
  acme.name = "Acme";
  return acme;
};

interface EpisodeCase {
  name: string;
  heading: string;
  // Stubs the episode's members and builds its page-out email.
  build: (members: number, title?: string) => Promise<EmailMessage>;
}

const CASES: Array<EpisodeCase> = [
  {
    name: "alert episode",
    heading: "Alerts in this Episode",
    build: async (members: number, title?: string): Promise<EmailMessage> => {
      const ids: Array<ObjectID> = Array.from(
        { length: members },
        (_: unknown, index: number): ObjectID => {
          return memberId(index + 1);
        },
      );

      jest.spyOn(AlertEpisodeMemberService, "findBy").mockResolvedValue(
        ids.map((id: ObjectID): AlertEpisodeMember => {
          const member: AlertEpisodeMember = new AlertEpisodeMember();
          member.alertId = id;
          return member;
        }) as never,
      );
      jest.spyOn(AlertService, "findBy").mockResolvedValue(
        ids.map((id: ObjectID, index: number): Alert => {
          const alert: Alert = new Alert(id);
          alert.title = title || `Checkout latency ${index + 1}`;
          alert.alertNumber = index + 1;
          alert.alertNumberWithPrefix = `ALT-${index + 1}`;
          const monitor: Monitor = new Monitor();
          monitor.name = `Checkout API ${index + 1}`;
          alert.monitor = monitor;
          return alert;
        }) as never,
      );

      const state: AlertState = new AlertState();
      state.name = "Firing";
      const severity: AlertSeverity = new AlertSeverity();
      severity.name = "Critical";

      const episode: AlertEpisode = new AlertEpisode(EPISODE_ID);
      episode.projectId = PROJECT_ID;
      episode.project = project();
      episode.title = "Checkout alerts";
      episode.episodeNumber = 3;
      episode.currentAlertState = state;
      episode.alertSeverity = severity;

      return await UserNotificationRuleService.generateEmailTemplateForAlertEpisodeCreated(
        RESPONDER,
        episode,
        LOG_TIMELINE_ID,
      );
    },
  },
  {
    name: "incident episode",
    heading: "Incidents in this Episode",
    build: async (members: number, title?: string): Promise<EmailMessage> => {
      const ids: Array<ObjectID> = Array.from(
        { length: members },
        (_: unknown, index: number): ObjectID => {
          return memberId(index + 1);
        },
      );

      jest.spyOn(IncidentEpisodeMemberService, "findBy").mockResolvedValue(
        ids.map((id: ObjectID): IncidentEpisodeMember => {
          const member: IncidentEpisodeMember = new IncidentEpisodeMember();
          member.incidentId = id;
          return member;
        }) as never,
      );
      jest.spyOn(IncidentService, "findBy").mockResolvedValue(
        ids.map((id: ObjectID, index: number): Incident => {
          const incident: Incident = new Incident(id);
          incident.title = title || `Checkout is down ${index + 1}`;
          incident.incidentNumber = index + 1;
          incident.incidentNumberWithPrefix = `INC-${index + 1}`;
          const monitor: Monitor = new Monitor();
          monitor.name = `Checkout API ${index + 1}`;
          incident.monitors = [monitor];
          return incident;
        }) as never,
      );

      const state: IncidentState = new IncidentState();
      state.name = "Identified";
      const severity: IncidentSeverity = new IncidentSeverity();
      severity.name = "Critical";

      const episode: IncidentEpisode = new IncidentEpisode(EPISODE_ID);
      episode.projectId = PROJECT_ID;
      episode.project = project();
      episode.title = "Checkout incidents";
      episode.episodeNumber = 4;
      episode.currentIncidentState = state;
      episode.incidentSeverity = severity;

      return await UserNotificationRuleService.generateEmailTemplateForIncidentEpisodeCreated(
        RESPONDER,
        episode,
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
  jest
    .spyOn(AlertEpisodeService, "getEpisodeLinkInDashboard")
    .mockResolvedValue(link);
  jest
    .spyOn(IncidentEpisodeService, "getEpisodeLinkInDashboard")
    .mockResolvedValue(link);
  // No linked resources: only the member list is under test.
  jest.spyOn(AlertService, "findAllBy").mockResolvedValue([] as never);
  jest.spyOn(IncidentService, "findAllBy").mockResolvedValue([] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The list's rows: the cells of the bordered table under the list's heading.
const listRows: (html: string, heading: string) => Array<EmailElement> = (
  html: string,
  heading: string,
): Array<EmailElement> => {
  const afterHeading: string = html.slice(html.indexOf(heading));
  const tree: EmailMarkupTree = readEmailMarkup(afterHeading);
  const box: EmailElement | undefined = findElements(
    tree.root,
    (element: EmailElement): boolean => {
      return element.name === "table" && drawsBox(element);
    },
  )[0];

  expect(box).toBeDefined();

  const body: EmailElement = childElements(box!).find(
    (element: EmailElement): boolean => {
      return element.name === "tbody";
    },
  )!;

  return childElements(body).map((row: EmailElement): EmailElement => {
    return childElements(row)[0]!;
  });
};

describe.each(CASES)("the $name page-out email", (entry: EpisodeCase) => {
  test.each([1, 2, 5])(
    "with %d member(s), lists each with a divider above every row but the first",
    async (members: number) => {
      const message: EmailMessage = await entry.build(members);
      const html: string = render(message);
      const rows: Array<EmailElement> = listRows(html, entry.heading);

      expect(html).toContain(`${entry.heading} (${members})`);
      expect(rows).toHaveLength(members);
      rows.forEach((row: EmailElement, index: number): void => {
        expect(textOf(row)).toContain(` ${index + 1}`);
        expect(dividerSides(row)).toEqual(index === 0 ? [] : ["top"]);
      });
      expect(
        String(message.vars["alertsList"] || message.vars["incidentsList"]),
      ).not.toContain("border-bottom");
    },
  );

  test("draws no divider on the edge of any box, the detail card's included", async () => {
    const tree: EmailMarkupTree = readEmailMarkup(render(await entry.build(3)));

    expect(misplacedDividers(tree)).toEqual([]);
    expect(detailCards(tree)).toHaveLength(1);
    expect(dividersOnlyBetweenRows(detailCards(tree)[0]!)).toBe(true);
  });

  test("with no members, leaves the whole section out", async () => {
    const message: EmailMessage = await entry.build(0);
    const list: unknown =
      message.vars["alertsList"] ?? message.vars["incidentsList"];

    expect(list).toBe("");
    expect(render(message)).not.toContain(entry.heading);
  });

  test("the list's rows are the only ones drawn with the list's divider", async () => {
    const message: EmailMessage = await entry.build(4);
    const list: string = String(
      message.vars["alertsList"] ?? message.vars["incidentsList"],
    );

    expect(list.split(EPISODE_MEMBER_ROW_DIVIDER)).toHaveLength(4);
  });

  test("a member's title is text, never markup", async () => {
    const html: string = render(
      await entry.build(2, '<img src=x onerror="alert(1)">'),
    );

    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});

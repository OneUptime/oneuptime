import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import { describe, expect, test } from "@jest/globals";
import { registerEmailDetailCardHelpers } from "../../FeatureSet/Notification/Utils/EmailDetailCard";
import { readEmailMarkup } from "./Fixtures/EmailMarkupTree";
import {
  DetailCard,
  DetailCardRow,
  detailCards,
} from "./Fixtures/EmailDividers";
import {
  SecurityHuntFoundFacts,
  SecurityHuntMessage,
  buildHuntFoundMessage,
} from "Common/Server/Utils/SecurityEvent/Hunts/SecurityHuntNotifications";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";

/*
 * THE EMAIL A SCHEDULED HUNT SENDS WHEN IT FINDS EVENTS.
 *
 * It says the hunt, how many events its run found, when those events
 * arrived, what the hunt searches for and in which project, with one
 * button to the hunt's page on the run's window - and why the person is
 * getting it. Every value comes from the message SecurityHuntNotifications
 * builds, so a variable the message stops setting, or the template stops
 * reading, is caught. A hunt's name and search are a person's words:
 * escaped. No event's own words are in it.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);
const PARTIALS_DIR: string = Path.join(TEMPLATES_DIR, "Partials");
// The template's file, as the mail service reads it: the type names it.
const TEMPLATE: string = Path.join(
  TEMPLATES_DIR,
  EmailTemplateType.SecurityHuntFound,
);

const engine: typeof Handlebars = Handlebars.create();

for (const name of fs.readdirSync(PARTIALS_DIR)) {
  if (name.endsWith(".hbs")) {
    engine.registerPartial(
      name.slice(0, -4),
      fs.readFileSync(Path.join(PARTIALS_DIR, name), "utf8"),
    );
  }
}

registerEmailDetailCardHelpers(engine);

const FACTS: SecurityHuntFoundFacts = {
  huntId: new ObjectID("3b000000-0000-4000-8000-000000000001"),
  projectId: new ObjectID("10000000-0000-4000-8000-000000000001"),
  huntName: "Encoded PowerShell",
  searchQuery: "processname:powershell.exe commandline:-enc",
  filterCount: 2,
  projectName: "Acme Commerce",
  url: "https://oneuptime.acme-commerce.example/dashboard/10000000-0000-4000-8000-000000000001/security-events/hunts/3b000000-0000-4000-8000-000000000001?range=Custom",
  eventCount: 3,
  startTime: new Date("2026-10-28T10:00:00.000Z"),
  endTime: new Date("2026-10-29T10:00:00.000Z"),
};

function render(facts: SecurityHuntFoundFacts = FACTS): string {
  const message: SecurityHuntMessage = buildHuntFoundMessage({ facts });

  return engine.compile(fs.readFileSync(TEMPLATE, "utf8"))(message.emailVars);
}

function rows(html: string): Array<DetailCardRow> {
  const cards: Array<DetailCard> = detailCards(readEmailMarkup(html));

  expect(cards).toHaveLength(1);

  return cards[0]!.rows;
}

describe("the email a scheduled hunt sends", () => {
  test("is the template the message names", () => {
    expect(buildHuntFoundMessage({ facts: FACTS }).templateType).toBe(
      EmailTemplateType.SecurityHuntFound,
    );
    expect(fs.existsSync(TEMPLATE)).toBe(true);
  });

  test("says the hunt, what it found, the time range it read, its search and its project, in that order", () => {
    expect(
      rows(render()).map((row: DetailCardRow): string => {
        return row.label;
      }),
    ).toEqual(["Hunt:", "Found:", "Time Range:", "Search:", "Project:"]);

    const html: string = render();

    expect(html).toContain("Hunt found 3 security events");
    /*
     * The time range is said once, in its row: the lead says what was
     * found in one short sentence (it named both dates too).
     */
    expect(html).toContain(
      "The scheduled hunt Encoded PowerShell found 3 security events.",
    );
    expect(html.split("Oct 28 2026").length - 1).toBe(1);
    expect(html).toContain(
      "processname:powershell.exe commandline:-enc (and 2 filters)",
    );
    expect(html).toContain("Acme Commerce");
  });

  test("opens the hunt's page on the run's window, from its button and its link", () => {
    const html: string = render();
    const link: string = Handlebars.escapeExpression(FACTS.url);

    expect(html).toContain("See What It Found");
    expect(html.split(link).length - 1).toBeGreaterThanOrEqual(2);
  });

  test("says why the person is getting it, and where to change it", () => {
    expect(render()).toContain(
      "This scheduled hunt tells you, or a team you are on, when it finds security events.",
    );
  });

  test("escapes the hunt's name and search, which a person wrote", () => {
    const name: string = '<img src="x" onerror="alert(1)">';
    const html: string = render({
      ...FACTS,
      huntName: name,
      searchQuery: "<script>alert(1)</script>",
    });

    expect(html).not.toContain(name);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain(Handlebars.escapeExpression(name));
  });
});

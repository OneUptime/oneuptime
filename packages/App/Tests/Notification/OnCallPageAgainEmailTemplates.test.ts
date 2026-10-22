import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import { beforeAll, describe, expect, test } from "@jest/globals";
import { visibleText } from "Common/Tests/Helpers/HtmlText";

/*
 * Registers the product's real `concat` / `ifCond` helpers as an import
 * side effect, so this suite renders with the helpers the product ships.
 */
import "../../FeatureSet/Notification/Utils/Handlebars";

/*
 * A PAGE AGAIN'S EMAIL OPENS WITH WHY (issue #5123, UI review).
 *
 * The four page emails opened with "A new incident has been created in the
 * project - Acme". A page again (OnCallAcknowledgementTimeout) is about an
 * incident somebody acknowledged half an hour ago, so its generator hands
 * the template the line to open with instead (pageAgainInfo): "This
 * incident in the project Acme is still not resolved 30 minutes after it
 * was acknowledged." A first page's email has no such line, and opens as it
 * always did. Everything else - the details, Acknowledge, Escalate - is the
 * same page email.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

function render(name: string, vars: Record<string, unknown>): string {
  return Handlebars.compile(
    fs.readFileSync(Path.resolve(TEMPLATES_DIR, name), { encoding: "utf8" }),
  )(vars);
}

beforeAll(() => {
  const partialsDir: string = Path.resolve(TEMPLATES_DIR, "Partials");

  for (const filename of fs.readdirSync(partialsDir)) {
    if (!filename.endsWith(".hbs")) {
      continue;
    }

    Handlebars.registerPartial(
      filename.slice(0, -".hbs".length),
      fs.readFileSync(Path.resolve(partialsDir, filename), {
        encoding: "utf8",
      }),
    );
  }
});

interface PageEmail {
  file: string;
  noun: string;
  titleVar: string;
}

const PAGE_EMAILS: Array<PageEmail> = [
  {
    file: "AcknowledgeIncident.hbs",
    noun: "incident",
    titleVar: "incidentTitle",
  },
  { file: "AcknowledgeAlert.hbs", noun: "alert", titleVar: "alertTitle" },
  {
    file: "AcknowledgeIncidentEpisode.hbs",
    noun: "incident episode",
    titleVar: "incidentEpisodeTitle",
  },
  {
    file: "AcknowledgeAlertEpisode.hbs",
    noun: "alert episode",
    titleVar: "alertEpisodeTitle",
  },
];

function varsFor(
  email: PageEmail,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    [email.titleVar]: "Checkout is down",
    currentState: "Acknowledged",
    resourcesAffected: "checkout-api",
    projectName: "Acme",
    rootCause: "<p>Pool exhausted.</p>",
    incidentNumber: "INC-42",
    alertNumber: "ALR-12",
    episodeNumber: "EP-7",
    alertsCount: "1",
    incidentsCount: "1",
    alertsList: "",
    incidentsList: "",
    acknowledgeIncidentLink: "https://oneuptime.example.com/ack",
    acknowledgeAlertLink: "https://oneuptime.example.com/ack",
    acknowledgeAlertEpisodeLink: "https://oneuptime.example.com/ack",
    acknowledgeIncidentEpisodeLink: "https://oneuptime.example.com/ack",
    passOnLink: "https://oneuptime.example.com/escalate",
    ...overrides,
  };
}

describe.each(PAGE_EMAILS)("$file", (email: PageEmail) => {
  test("a page again opens with why it pages again, not with a new record", () => {
    const line: string = `This ${email.noun} in the project Acme is still not resolved 30 minutes after it was acknowledged.`;
    const text: string = visibleText(
      render(email.file, varsFor(email, { pageAgainInfo: line })),
    );

    expect(text).toContain(line);
    expect(text).not.toContain(`A new ${email.noun} has been created`);
    // The rest is the page email it always was.
    expect(text).toContain("Checkout is down");
    expect(text).toContain("Escalate");
  });

  test("a first page opens as it always did", () => {
    const text: string = visibleText(render(email.file, varsFor(email)));

    expect(text).toContain(
      `A new ${email.noun} has been created in the project - Acme`,
    );
    expect(text).not.toContain("still not resolved");
  });

  test("the line is text: what a project member typed never becomes markup", () => {
    const html: string = render(
      email.file,
      varsFor(email, {
        pageAgainInfo:
          'This incident in the project <img src=x onerror="alert(1)"> is still not resolved.',
      }),
    );

    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(visibleText(html)).toContain("still not resolved");
  });
});

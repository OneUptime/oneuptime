import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import IncidentSlaBreachNotice, {
  IncidentSlaBreachFacts,
  IncidentSlaBreachMessages,
} from "Common/Server/Utils/Incident/IncidentSlaBreachNotice";
import Color from "Common/Types/Color";
import Dictionary from "Common/Types/Dictionary";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import Timezone from "Common/Types/Timezone";
import { htmlAsText, visibleText } from "Common/Tests/Helpers/HtmlText";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * Registers the product's real `ifCond` / `ifNotCond` / `concat` helpers on
 * the shared Handlebars instance as a side effect of import, so this suite
 * renders with the helpers MailService renders with. The partials are
 * registered from disk below.
 */
import "../../FeatureSet/Notification/Utils/Handlebars";

/*
 * THE EMAIL AN INCIDENT'S OWNERS GET WHEN ITS SLA IS BREACHED
 * (IncidentOwnerSlaBreached.hbs). It used to be the "incident created"
 * email, which opened "A new incident has been created in the project" and
 * never said which deadline was missed. The vars come from the real builder
 * (IncidentSlaBreachNotice) and are rendered the way MailService renders
 * them: the template the envelope names, with the real partials and helpers.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

const NOW: Date = new Date("2026-10-26T12:00:00.000Z");
const DEADLINE: Date = new Date("2026-10-26T11:59:00.000Z");
const LINK: string =
  "https://oneuptime.example.com/dashboard/5ab1ead0-0000-4000-8000-000000000001/incidents/5ab1ead0-0000-4000-8000-000000000002";

const XSS_TITLE: string = '<img src=x onerror="alert(1)">Checkout';
const XSS_RULE: string = '<a href="https://evil.example">P1</a>';

const facts: (
  overrides?: Partial<IncidentSlaBreachFacts>,
) => IncidentSlaBreachFacts = (
  overrides?: Partial<IncidentSlaBreachFacts>,
): IncidentSlaBreachFacts => {
  return {
    breachType: "resolution",
    deadline: DEADLINE,
    slaRuleName: "P1 customer SLA",
    incidentTitle: "Checkout API is down",
    incidentNumber: 42,
    incidentNumberWithPrefix: "INC-42",
    projectName: "Acme Prod",
    currentStateName: "Investigating",
    currentStateColor: new Color("#f59e0b"),
    severityName: "Critical",
    severityColor: new Color("#dc2626"),
    openedAt: new Date("2026-10-26T09:30:00.000Z"),
    incidentViewLink: LINK,
    now: NOW,
    ...overrides,
  };
};

const templateSource: (name: string) => string = (name: string): string => {
  return fs.readFileSync(Path.resolve(TEMPLATES_DIR, name), {
    encoding: "utf8",
  });
};

// What MailService.compileEmailBody does with the envelope.
const render: (
  overrides?: Partial<IncidentSlaBreachFacts>,
  recipient?: { isOwner?: boolean; timezone?: Timezone },
) => string = (
  overrides?: Partial<IncidentSlaBreachFacts>,
  recipient?: { isOwner?: boolean; timezone?: Timezone },
): string => {
  const messages: IncidentSlaBreachMessages =
    IncidentSlaBreachNotice.getMessages({
      facts: facts(overrides),
      recipient: {
        isOwner: recipient?.isOwner ?? true,
        timezone: recipient?.timezone,
      },
    });

  const vars: Dictionary<string | JSONObject> = {
    year: "2026",
    ...messages.emailEnvelope.vars,
  };

  return Handlebars.compile(
    templateSource(messages.emailEnvelope.templateType!),
  )(vars).toString();
};

// The email's one heading, as text.
const heading: (html: string) => string = (html: string): string => {
  const start: number = html.indexOf("<h1");
  const end: number = html.indexOf("</h1>", start);

  return htmlAsText(html.slice(start, end + "</h1>".length)).trim();
};

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

describe("the SLA breached email", () => {
  test("is a template of its own, never the incident created one", () => {
    expect(
      fs.existsSync(
        Path.resolve(TEMPLATES_DIR, EmailTemplateType.IncidentOwnerSlaBreached),
      ),
    ).toBe(true);
    expect(EmailTemplateType.IncidentOwnerSlaBreached).not.toBe(
      EmailTemplateType.IncidentOwnerResourceCreated,
    );
  });

  test("is headed with the breach and the incident", () => {
    expect(heading(render())).toBe(
      "SLA breached - Incident INC-42: Checkout API is down",
    );
  });

  test("says what missing the deadline means, and never that the incident was created", () => {
    const text: string = visibleText(render());

    expect(text).toContain(
      "This incident was not resolved before its SLA resolution deadline.",
    );
    expect(text).not.toContain("has been created");
    expect(visibleText(render({ breachType: "response" }))).toContain(
      "Nobody acknowledged this incident before its SLA response deadline.",
    );
  });

  test("lists the deadline missed and when it was, the rule, the state, how long it is open, the severity and the project", () => {
    const text: string = visibleText(
      render(undefined, { timezone: Timezone.EuropeLondon }),
    );

    for (const row of [
      "Incident Title: Checkout API is down",
      "Resolution Deadline: Oct 26 2026, 11:59 AM GMT",
      "SLA Rule: P1 customer SLA",
      "Current State: Investigating",
      "Open For: 2 hours, 30 minutes",
      "Severity: Critical",
      "Project: Acme Prod",
    ]) {
      expect(text).toContain(row);
    }
  });

  /*
   * One row says which deadline and when: the sentence above the card has
   * said it was missed. Two rows - "Deadline Missed: Resolution" over
   * "Deadline Was: ..." - said it at greater length.
   */
  test("the missed deadline is one row, named after the deadline it was", () => {
    const london: { timezone: Timezone } = {
      timezone: Timezone.EuropeLondon,
    };
    const resolution: string = visibleText(render(undefined, london));
    const response: string = visibleText(
      render({ breachType: "response" }, london),
    );

    expect(resolution).toContain("Resolution Deadline:");
    expect(resolution).not.toContain("Response Deadline:");
    expect(response).toContain("Response Deadline: Oct 26 2026, 11:59 AM GMT");
    expect(response).not.toContain("Resolution Deadline:");

    for (const text of [resolution, response]) {
      expect(text).not.toContain("Deadline Missed");
      expect(text).not.toContain("Deadline Was");
      expect(text.split("Deadline:").length).toBe(2);
    }
  });

  test("shows the deadline in the reader's own time zone", () => {
    expect(
      visibleText(render(undefined, { timezone: Timezone.AsiaKolkata })),
    ).toContain("IST");
  });

  test("leaves a row out when it has nothing to say", () => {
    const text: string = visibleText(
      render({ slaRuleName: undefined, deadline: undefined }),
    );

    expect(text).not.toContain("SLA Rule:");
    expect(text).not.toContain("Deadline:");
    // The sentence above the card still says which deadline was missed.
    expect(text).toContain(
      "This incident was not resolved before its SLA resolution deadline.",
    );
  });

  test("links to the incident with its button and its address", () => {
    const html: string = render();

    expect(html).toContain(`href="${LINK}"`);
    expect(visibleText(html)).toContain("View on Dashboard");
  });

  test("says why it came: as an owner, or as a project owner of an incident with none", () => {
    expect(visibleText(render())).toContain(
      "You are receiving this email because you are the owner of this resource.",
    );
    expect(visibleText(render(undefined, { isOwner: false }))).toContain(
      "no owners have been added to this resource",
    );
  });

  test("a title, a rule name or a project name with markup is shown as text, never run", () => {
    const html: string = render({
      incidentTitle: XSS_TITLE,
      slaRuleName: XSS_RULE,
      projectName: XSS_TITLE,
    });

    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('href="https://evil.example"');
    expect(visibleText(html)).toContain(XSS_TITLE);
    expect(visibleText(html)).toContain(XSS_RULE);
  });
});

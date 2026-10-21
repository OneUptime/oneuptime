import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * Registers the product's real `concat` / `ifCond` / `ifNotCond` helpers as
 * an import side effect, so every template renders with what ships.
 */
import "../../FeatureSet/Notification/Utils/Handlebars";

/*
 * THE 'NOTE POSTED' EMAIL OF A STATE CHANGE SAYS WHAT THE EVENT IS NOW.
 *
 * With "Notify Status Page Subscribers" on, the public note posted with a
 * state change is the one message subscribers get about the change, so its
 * email names the state the event moved to: a Status row right under the
 * title, in the state's colour (the jobs set incidentState / eventState, and
 * their colour pair, only for such a note). A note posted on its own sets
 * neither, and its email has no Status row - exactly the email it always
 * was. The 'note updated' emails are left as they are.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

function templateSource(name: string): string {
  return fs.readFileSync(Path.resolve(TEMPLATES_DIR, name), {
    encoding: "utf8",
  });
}

function render(name: string, vars: Record<string, unknown>): string {
  return Handlebars.compile(templateSource(name))(vars);
}

beforeAll(() => {
  const partialsDir: string = Path.resolve(TEMPLATES_DIR, "Partials");

  for (const filename of fs.readdirSync(partialsDir)) {
    const matches: RegExpMatchArray | null = filename.match(/^(.*)\.hbs$/u);

    if (!matches) {
      continue;
    }

    Handlebars.registerPartial(
      matches[1]!,
      fs.readFileSync(Path.resolve(partialsDir, filename), {
        encoding: "utf8",
      }),
    );
  }
});

// The labels of the detail rows, in the order the email shows them.
function rowLabels(html: string): Array<string> {
  return Array.from(
    html.matchAll(/<p class="st-DetailCard-label"[^>]*>([^<]*?)\s*<\/p>/g),
  ).map((match: RegExpMatchArray): string => {
    return match[1]!.trim();
  });
}

interface NoteTemplateCase {
  template: string;
  stateVariable: string;
  title: { label: string; variable: string; value: string };
  // The row the Status row comes before.
  nextLabel: string;
  base: Record<string, unknown>;
}

const NOTE_TEMPLATES: Array<NoteTemplateCase> = [
  {
    template: "SubscriberIncidentNoteCreated.hbs",
    stateVariable: "incidentState",
    title: {
      label: "Incident Title:",
      variable: "incidentTitle",
      value: "Checkout requests failing",
    },
    nextLabel: "Resources Affected:",
    base: {
      incidentTitle: "Checkout requests failing",
      resourcesAffected: "Checkout API",
      incidentSeverity: "Critical",
      note: "<p>Rolled back.</p>",
      statusPageName: "Acme Status",
      statusPageUrl: "https://status.acme.com",
      detailsUrl: "https://status.acme.com/incidents/1",
      unsubscribeUrl: "https://status.acme.com/unsubscribe/1",
    },
  },
  {
    template: "SubscriberScheduledMaintenanceEventNoteCreated.hbs",
    stateVariable: "eventState",
    title: {
      label: "Event Title:",
      variable: "eventTitle",
      value: "Database upgrade",
    },
    nextLabel: "Event Description:",
    base: {
      eventTitle: "Database upgrade",
      eventDescription: "<p>The primary database is upgraded.</p>",
      resourcesAffected: "Primary database",
      note: "<p>The upgrade has started.</p>",
      statusPageName: "Acme Status",
      statusPageUrl: "https://status.acme.com",
      detailsUrl: "https://status.acme.com/scheduled-events/1",
      unsubscribeUrl: "https://status.acme.com/unsubscribe/1",
    },
  },
];

describe.each(NOTE_TEMPLATES)("$template", (noteCase: NoteTemplateCase) => {
  test("posted with a state change: a Status row right under the title, naming the state", () => {
    const html: string = render(noteCase.template, {
      ...noteCase.base,
      [noteCase.stateVariable]: "Resolved",
      ...EmailColorUtil.getTemplateVariables(noteCase.stateVariable, "#16a34a"),
    });

    const labels: Array<string> = rowLabels(html);
    const titleAt: number = labels.indexOf(noteCase.title.label);

    expect(titleAt).toBeGreaterThanOrEqual(0);
    expect(labels[titleAt + 1]).toBe("Status:");
    expect(labels[titleAt + 2]).toBe(noteCase.nextLabel);
    expect(html).toContain("Resolved");
    // In its own colour: the dot beside the name.
    expect(html).toContain("st-ColorDot");
  });

  test("posted on its own: no Status row, the email it always was", () => {
    const html: string = render(noteCase.template, noteCase.base);

    expect(rowLabels(html)).not.toContain("Status:");

    const labels: Array<string> = rowLabels(html);
    const titleAt: number = labels.indexOf(noteCase.title.label);
    expect(labels[titleAt + 1]).toBe(noteCase.nextLabel);
  });

  test("a state name is escaped, never markup", () => {
    const html: string = render(noteCase.template, {
      ...noteCase.base,
      [noteCase.stateVariable]: '<img src="https://evil.example/x.png">',
    });

    expect(html).not.toContain('<img src="https://evil.example/x.png">');
    expect(html).toContain("&lt;img");
  });

  test("the row is drawn only when the state is set", () => {
    expect(templateSource(noteCase.template)).toContain(
      `{{#if ${noteCase.stateVariable}}}`,
    );
  });
});

describe("the 'note updated' emails have no Status row", () => {
  test.each([
    "SubscriberIncidentNoteUpdated.hbs",
    "SubscriberScheduledMaintenanceEventNoteUpdated.hbs",
  ])("%s", (template: string) => {
    expect(templateSource(template)).not.toContain('title="Status: "');
  });
});

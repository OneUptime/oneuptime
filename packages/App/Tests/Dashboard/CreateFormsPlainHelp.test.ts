import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Declare Incident, Create Alert, the two Create Episode forms and Create
 * Scheduled Maintenance Event say what a field is for in plain words, once:
 *
 *   - Title shows no line under it. A field with no description of its own
 *     shows its column's, and the column says only "Title of this incident"
 *     (Field.hideColumnDescription).
 *   - Severity asks "How serious is it?", where it asked "What type of
 *     incident is this?" - a severity is not a type.
 *   - On-Call Policies says when they are paged: "The on-call policies to
 *     page as soon as the incident is declared", not "Select on-call duty
 *     policy to execute when this incident is created".
 *   - Create Scheduled Maintenance Event's card says what the page is for in
 *     one sentence, where it said "scheduled maintenance events are planned
 *     maintenance events".
 *   - Private Incident / Private Alert read the same wherever they are asked
 *     or shown: who can see it, without "(users + members of owner teams)".
 *
 * App has no renderer, so the pages are read as text. Common's
 * EventRuleFormsInLocale holds every sentence below in all sixteen languages,
 * and RadioButtonFieldAnswers draws a field that leaves its column's line out.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

function read(relative: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8");
}

function countOf(text: string, part: string): number {
  return text.split(part).length - 1;
}

const CREATE_PAGES: Array<string> = [
  "Pages/Incidents/Create.tsx",
  "Pages/Alerts/Create.tsx",
  "Pages/Incidents/EpisodeCreate.tsx",
  "Pages/Alerts/EpisodeCreate.tsx",
  "Pages/ScheduledMaintenanceEvents/Create.tsx",
];

// Every page that asks for a severity or on-call policies on create or edit.
const SEVERITY_PAGES: Array<string> = [
  "Pages/Incidents/Create.tsx",
  "Pages/Alerts/Create.tsx",
  "Pages/Incidents/EpisodeCreate.tsx",
  "Pages/Alerts/EpisodeCreate.tsx",
  "Pages/Incidents/Settings/IncidentTemplates.tsx",
  "Pages/Incidents/Settings/IncidentTemplatesView.tsx",
  "Pages/Incidents/View/Index.tsx",
];

const ON_CALL_SENTENCES: Record<string, string> = {
  "Pages/Incidents/Create.tsx":
    "The on-call policies to page as soon as the incident is declared.",
  "Pages/Incidents/Settings/IncidentTemplates.tsx":
    "The on-call policies to page as soon as the incident is declared.",
  "Pages/Incidents/Settings/IncidentTemplatesView.tsx":
    "The on-call policies to page as soon as the incident is declared.",
  "Pages/Alerts/Create.tsx":
    "The on-call policies to page as soon as the alert is created.",
  "Pages/Incidents/EpisodeCreate.tsx":
    "The on-call policies to page as soon as the episode is created.",
  "Pages/Alerts/EpisodeCreate.tsx":
    "The on-call policies to page as soon as the episode is created.",
};

const RETIRED: Array<string> = [
  "What type of incident is this?",
  "What is the severity of this alert?",
  "What severity level is this episode?",
  "Select on-call duty policy to execute",
  "Scheduled maintenance events are planned maintenance events",
  "users + members of owner teams",
  "If checked, only the alert's owner users",
  "If enabled, only the alert's owner users",
];

describe("the create forms' Title", () => {
  test.each(CREATE_PAGES)(
    "%s leaves out its column's line, which only says the title again",
    (file: string) => {
      const source: string = read(file);

      expect(countOf(source, 'title: "Title",')).toBe(1);

      const start: number = source.indexOf('title: "Title",');
      // The Title field ends where the next field starts.
      const end: number = source.indexOf("field: {", start);
      const titleField: string = source.slice(start, end);

      expect(end).toBeGreaterThan(start);

      expect(titleField).toContain("hideColumnDescription: true");
      expect(titleField).not.toContain("description:");
    },
  );
});

describe("severity and on-call policies", () => {
  test.each(SEVERITY_PAGES)("%s asks how serious it is", (file: string) => {
    expect(read(file)).toContain('description: "How serious is it?"');
  });

  test.each(Object.entries(ON_CALL_SENTENCES))(
    "%s says when its on-call policies are paged",
    (file: string, sentence: string) => {
      expect(read(file)).toContain(`"${sentence}"`);
    },
  );
});

describe("the retired wording", () => {
  const pages: Array<string> = Array.from(
    new Set([
      ...CREATE_PAGES,
      ...SEVERITY_PAGES,
      "Pages/Incidents/View/Settings.tsx",
      "Pages/Alerts/View/Index.tsx",
    ]),
  );

  test.each(pages)("is gone from %s", (file: string) => {
    const source: string = read(file);

    for (const retired of RETIRED) {
      expect({ file, retired, found: source.includes(retired) }).toEqual({
        file,
        retired,
        found: false,
      });
    }
  });
});

describe("a private record reads the same where it is asked and shown", () => {
  test("Private Incident: the Edit Settings switch, its detail and Declare Incident", () => {
    const sentence: string =
      "Only the incident's owners, project admins and project owners can see it. It never shows on status pages and takes no public notes.";

    // The switch on Edit Settings, and the detail it saves into.
    expect(countOf(read("Pages/Incidents/View/Settings.tsx"), sentence)).toBe(
      2,
    );
    expect(read("Pages/Incidents/Create.tsx")).toContain(sentence);
  });

  test("Private Alert: Create Alert and the alert's Edit", () => {
    const sentence: string =
      "Only the alert's owners, project admins and project owners can see it.";

    expect(read("Pages/Alerts/Create.tsx")).toContain(sentence);
    expect(read("Pages/Alerts/View/Index.tsx")).toContain(sentence);
  });
});

describe("Create Scheduled Maintenance Event's card", () => {
  test("says what the page is for in one sentence", () => {
    expect(read("Pages/ScheduledMaintenanceEvents/Create.tsx")).toContain(
      '"Plan maintenance ahead, and tell your team and your status page subscribers when it happens."',
    );
  });
});

import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * CHANGING A STATE TAKES THE STATE TIMELINE'S CREATE PERMISSION, AND NOTHING
 * MORE (Common/Server/Utils/StateChangeFollowOn): a state change is a new
 * row on the record's state timeline, and once that row is allowed the
 * record takes its new state from OneUptime itself. A custom role with
 * Create Incident State Timeline but not Edit Incident changes states; a
 * block on Edit Incident no longer stops them, and a block on the timeline's
 * create permission does.
 *
 * Users, Teams & Permissions says so in every docs language, with the
 * permission for each kind of record; the incident state and linked-alert
 * pages point to it, and the upgrade notes say what changes for custom roles.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

// The create permission that changes each kind of record's state.
const STATE_TIMELINE_PERMISSIONS: Array<string> = [
  "**Create Incident State Timeline**",
  "**Create Alert State Timeline**",
  "**Create Alert Episode State Timeline**",
  "**Create Incident Episode State Timeline**",
  "**Create Scheduled Maintenance State Timeline**",
  "**Create Monitor Status Timeline**",
];

function read(language: string, page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
}

/*
 * The section that names the six permissions in a table: from the level-3
 * heading before the table to the next heading.
 */
function stateChangeSection(markdown: string): {
  heading: string;
  body: string;
  nextHeading: string;
} {
  const lines: Array<string> = markdown.split("\n");
  const firstRow: number = lines.findIndex((line: string): boolean => {
    return line.includes(STATE_TIMELINE_PERMISSIONS[0]!) && line.startsWith("|");
  });

  expect(firstRow).toBeGreaterThan(0);

  let start: number = firstRow;

  while (start > 0 && !lines[start]!.startsWith("#")) {
    start--;
  }

  let end: number = firstRow;

  while (end < lines.length && !lines[end]!.startsWith("#")) {
    end++;
  }

  return {
    heading: lines[start]!,
    body: lines.slice(start + 1, end).join("\n"),
    nextHeading: lines[end] || "",
  };
}

describe("Docs: changing a state takes the state timeline's create permission", () => {
  const english: string = read("en", "permissions/index.md");

  test("every docs language is checked", () => {
    expect(LANGUAGES).toHaveLength(17);
  });

  test("Users, Teams & Permissions has a Changing a state section, before the scope rules", () => {
    const section: {
      heading: string;
      body: string;
      nextHeading: string;
    } = stateChangeSection(english);

    expect(section.heading).toBe("### Changing a state");
    expect(section.nextHeading).toBe(
      "## Scope: how far an allow permission reaches",
    );
  });

  test("it names the create permission for each kind of record, with the read", () => {
    const { body } = stateChangeSection(english);

    for (const [record, permission] of [
      ["An incident", STATE_TIMELINE_PERMISSIONS[0]],
      ["An alert", STATE_TIMELINE_PERMISSIONS[1]],
      ["An alert episode", STATE_TIMELINE_PERMISSIONS[2]],
      ["An incident episode", STATE_TIMELINE_PERMISSIONS[3]],
      ["A scheduled maintenance event", STATE_TIMELINE_PERMISSIONS[4]],
      ["A monitor (its status)", STATE_TIMELINE_PERMISSIONS[5]],
    ]) {
      expect(body).toContain(`| ${record} | ${permission} |`);
    }

    expect(body).toContain(
      "Adding it takes the timeline's own create permission, with a permission to read the record it changes",
    );
  });

  test("it says a change takes no edit permission, and what to block instead", () => {
    const { body } = stateChangeSection(english);

    for (const sentence of [
      "The record then takes the new state from OneUptime itself",
      "So a change does not also take a permission to edit the record: a custom role with **Create Incident State Timeline** but not **Edit Incident** changes an incident's state.",
      "To keep a team from changing states, block the timeline's create permission; a block on **Edit Incident** leaves state changes alone.",
      "Labels, owners and private records narrow the timeline's create permission as they narrow any other",
    ]) {
      expect([sentence, body.includes(sentence)]).toEqual([sentence, true]);
    }
  });

  test("it keeps the note a change posts, and acknowledging alerts on declare, to their own permissions", () => {
    const { body } = stateChangeSection(english);

    expect(body).toContain(
      "Only the state is written for you. A note posted with a change is posted as you and takes the note's own permission",
    );
    expect(body).toContain(
      "Acknowledging the alerts of an incident as you declare it still also takes **Edit Alert**",
    );
    expect(body).toContain(
      "(/docs/incidents/linked-alerts#acknowledging-the-alerts-as-you-declare)",
    );
  });

  test.each(LANGUAGES)(
    "%s has the section, translated, with the six permission names kept, before its scope rules",
    (language: string) => {
      const page: string = read(language, "permissions/index.md");
      const section: {
        heading: string;
        body: string;
        nextHeading: string;
      } = stateChangeSection(page);

      expect([language, section.heading.startsWith("### ")]).toEqual([
        language,
        true,
      ]);

      for (const permission of STATE_TIMELINE_PERMISSIONS) {
        expect([language, permission, section.body.includes(permission)]).toEqual(
          [language, permission, true],
        );
      }

      // The two permissions the change no longer needs, and the one it still does on declare.
      for (const permission of ["**Edit Incident**", "**Edit Alert**"]) {
        expect([language, permission, section.body.includes(permission)]).toEqual(
          [language, permission, true],
        );
      }

      // Right before the section on scope, as in English.
      const englishPage: string = read("en", "permissions/index.md");
      const englishHeadings: Array<string> = englishPage
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("## ") || line.startsWith("### ");
        });
      const headings: Array<string> = page
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("## ") || line.startsWith("### ");
        });

      expect([language, headings.indexOf(section.heading)]).toEqual([
        language,
        englishHeadings.indexOf("### Changing a state"),
      ]);
      expect([language, section.nextHeading.startsWith("## ")]).toEqual([
        language,
        true,
      ]);

      // In-page anchors do not survive translation on this page.
      expect([language, /\]\(#/.test(section.body)]).toEqual([language, false]);

      if (language !== "en") {
        expect([language, section.body === stateChangeSection(english).body]).toEqual([
          language,
          false,
        ]);
        expect([language, section.heading === "### Changing a state"]).toEqual([
          language,
          false,
        ]);
      }
    },
  );

  test("the incident state page says changing the state takes no edit permission", () => {
    const page: string = read("en", "incidents/states-and-severities.md");

    expect(page).toContain(
      "Changing the state takes no permission to edit the incident: see [Changing a state](/docs/permissions/index#changing-a-state).",
    );
  });

  test("the linked alerts page says acknowledging on declare takes more than on the alert's own page", () => {
    const page: string = read("en", "incidents/linked-alerts.md");

    expect(page).toContain(
      "Acknowledging them as you declare takes **Create Alert State Timeline** and **Edit Alert** (acknowledging an alert on its own page takes only the first: see [Changing a state](/docs/permissions/index#changing-a-state))",
    );
  });

  test("the upgrade notes say what changes for custom roles and blocks", () => {
    const page: string = read("en", "installation/upgrading.md");

    for (const sentence of [
      "- **Changing a state takes the state timeline's permission, and nothing",
      "**Create Incident State Timeline** but not **Edit Incident** - or a",
      "OneUptime now writes the record's state itself once the timeline row is",
      "keep a team from changing states, block the state timeline's create",
      "longer holds up the next change to the same record: the next one goes",
      "[Changing a state](/docs/permissions/index#changing-a-state).",
    ]) {
      expect([sentence, page.includes(sentence)]).toEqual([sentence, true]);
    }
  });
});

import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The incident docs list the pages of the Incidents side menu's Settings
 * section twice: the overview's "Where incidents live in the dashboard" row
 * and the settings page's "Where incident settings live" table. Markdown is
 * not compiled, so nothing else notices when a page is added to the menu,
 * moved, or taken out: the overview went without Measurements, and the
 * settings table listed it before Incident Roles, while the menu did not.
 *
 * Both lists must name exactly the menu's Settings pages, in the menu's
 * order, in English and in Persian (the one translated corpus of the
 * incident pages; every other language falls back to English).
 *
 * The AI section is listed the same way: the overview's AI row names the
 * section's pages in the menu's order, and none of them is in Settings.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const INCIDENTS_SIDE_MENU_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Pages/Incidents/SideMenu.tsx",
);

const LANGUAGES: ReadonlyArray<string> = ["en", "fa"];

const OVERVIEW_PAGE: string = "incidents/index";
const SETTINGS_PAGE: string = "incidents/settings";

/*
 * The settings page's table of Settings pages, by its heading in each language.
 * The overview's row for the Settings section, and the settings table's Linked Alerts row.
 */
const OVERVIEW_SETTINGS_ROW: RegExp = /^\|\s*\*\*Settings\*\*\s*\|/;
const OVERVIEW_AI_ROW: RegExp = /^\|\s*\*\*AI\*\*\s*\|/;
const LINKED_ALERTS_ROW: RegExp = /^\|\s*\*\*Linked Alerts\*\*\s*\|/;

const SETTINGS_TABLE_HEADING: Record<string, string> = {
  en: "## Where incident settings live",
  fa: "## تنظیمات حادثه کجا زندگی می‌کنند",
};

function readPage(relative: string, language: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${relative}.md`),
    "utf8",
  );
}

// The cells of a markdown table row, trimmed, without the empty outer ones.
function tableCells(row: string): Array<string> {
  return row
    .split("|")
    .slice(1, -1)
    .map((cell: string): string => {
      return cell.trim();
    });
}

// Every **bold** name in a piece of markdown, in order.
function boldNames(markdown: string): Array<string> {
  return Array.from(markdown.matchAll(/\*\*([^*]+)\*\*/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

/*
 * The link titles of one section of the Incidents side menu, in order, read
 * from source: the menu is a React component, which an App test must not
 * import. A section's own title is indented six spaces, its links' titles
 * twelve - so the AI section's "Settings" link is never taken for the
 * Settings section.
 */
function sectionMenuTitles(section: string): Array<string> {
  const menu: string = fs.readFileSync(INCIDENTS_SIDE_MENU_FILE, "utf8");
  const sectionTitle: RegExp = new RegExp(`\\n {6}title: "${section}",\\n`);
  const match: RegExpExecArray | null = sectionTitle.exec(menu);

  expect({ section: section, found: Boolean(match) }).toEqual({
    section: section,
    found: true,
  });

  const start: number = (match?.index || 0) + (match?.[0].length || 0);
  const rest: string = menu.slice(start);
  // The section ends where the next one starts, or at the Developer section.
  const ends: Array<number> = [
    rest.search(/\n {6}title: "/),
    rest.indexOf("addDeveloperSideMenuSection("),
  ].filter((index: number): boolean => {
    return index >= 0;
  });
  const end: number = Math.min(...ends);

  return Array.from(
    rest.slice(0, end).matchAll(/\n {12}title:\s*"([^"]+)"/g),
  ).map((match: RegExpMatchArray): string => {
    return match[1] as string;
  });
}

function settingsMenuTitles(): Array<string> {
  return sectionMenuTitles("Settings");
}

function aiMenuTitles(): Array<string> {
  return sectionMenuTitles("AI");
}

// The first column of the table under the settings page's heading.
function settingsTablePages(language: string): Array<string> {
  const markdown: string = readPage(SETTINGS_PAGE, language);
  const heading: string = SETTINGS_TABLE_HEADING[language] as string;
  const start: number = markdown.indexOf(`${heading}\n`);

  expect({ language: language, heading: start >= 0 }).toEqual({
    language: language,
    heading: true,
  });

  const section: string = markdown.slice(start + heading.length);
  const nextHeading: number = section.search(/\n## /);
  const lines: Array<string> = (
    nextHeading >= 0 ? section.slice(0, nextHeading) : section
  ).split("\n");

  return lines
    .filter((line: string): boolean => {
      return line.startsWith("| **");
    })
    .map((line: string): string => {
      return boldNames(tableCells(line)[0] || "")[0] || "";
    });
}

// The names one of the overview's side menu rows lists.
function overviewRow(language: string, pattern: RegExp): Array<string> {
  const row: string | undefined = readPage(OVERVIEW_PAGE, language)
    .split("\n")
    .find((line: string): boolean => {
      return pattern.test(line);
    });

  expect({ language: language, row: Boolean(row) }).toEqual({
    language: language,
    row: true,
  });

  return boldNames(tableCells(row || "")[1] || "");
}

function overviewSettingsRow(language: string): Array<string> {
  return overviewRow(language, OVERVIEW_SETTINGS_ROW);
}

describe("Incident docs list the Settings menu's pages", () => {
  it("reads the menu's Settings pages, Linked Alerts among them and the AI settings not", () => {
    const titles: Array<string> = settingsMenuTitles();

    expect(titles.length).toBeGreaterThan(5);
    expect(titles[0]).toBe("Incident State");
    expect(titles[titles.length - 1]).toBe("Number Prefix");
    expect(titles).toContain("Linked Alerts");
    expect(titles).not.toContain("AI");
    expect(titles).not.toContain("Auto Remediation Rules");
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("reads the menu's AI pages: Insights, Logs, Settings and Auto Remediation Rules", () => {
    expect(aiMenuTitles()).toEqual([
      "Insights",
      "Logs",
      "Settings",
      "Auto Remediation Rules",
    ]);
  });

  it.each(LANGUAGES)(
    "%s: the overview's AI row names every page of the AI section, in menu order",
    (language: string) => {
      expect({
        language: language,
        pages: overviewRow(language, OVERVIEW_AI_ROW),
      }).toEqual({ language: language, pages: aiMenuTitles() });
    },
  );

  it.each(LANGUAGES)(
    "%s: the overview's Settings row names every page, in menu order",
    (language: string) => {
      expect({
        language: language,
        pages: overviewSettingsRow(language),
      }).toEqual({ language: language, pages: settingsMenuTitles() });
    },
  );

  it.each(LANGUAGES)(
    "%s: the settings page's table has a row per page, in menu order",
    (language: string) => {
      expect({
        language: language,
        pages: settingsTablePages(language),
      }).toEqual({ language: language, pages: settingsMenuTitles() });
    },
  );

  it.each(LANGUAGES)(
    "%s: the Linked Alerts row says what the page is for",
    (language: string) => {
      const row: string | undefined = readPage(SETTINGS_PAGE, language)
        .split("\n")
        .find((line: string): boolean => {
          return LINKED_ALERTS_ROW.test(line);
        });

      expect(row).toBeDefined();
      expect((tableCells(row || "")[1] || "").length).toBeGreaterThan(20);
    },
  );
});

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
 * The link titles of the Incidents side menu's Settings section, in order,
 * read from source: the menu is a React component, which an App test must
 * not import.
 */
function settingsMenuTitles(): Array<string> {
  const menu: string = fs.readFileSync(INCIDENTS_SIDE_MENU_FILE, "utf8");
  const sectionTitle: string = 'title: "Settings",';
  const start: number = menu.indexOf(sectionTitle);
  const end: number = menu.indexOf("addDeveloperSideMenuSection(", start);

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  return Array.from(
    menu
      .slice(start + sectionTitle.length, end)
      .matchAll(/title:\s*"([^"]+)"/g),
  ).map((match: RegExpMatchArray): string => {
    return match[1] as string;
  });
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

// The names the overview's Settings row lists.
function overviewSettingsRow(language: string): Array<string> {
  const row: string | undefined = readPage(OVERVIEW_PAGE, language)
    .split("\n")
    .find((line: string): boolean => {
      return OVERVIEW_SETTINGS_ROW.test(line);
    });

  expect({ language: language, row: Boolean(row) }).toEqual({
    language: language,
    row: true,
  });

  return boldNames(tableCells(row || "")[1] || "");
}

describe("Incident docs list the Settings menu's pages", () => {
  it("reads the menu's Settings pages, Linked Alerts among them", () => {
    const titles: Array<string> = settingsMenuTitles();

    expect(titles.length).toBeGreaterThan(5);
    expect(titles[0]).toBe("AI");
    expect(titles).toContain("Linked Alerts");
    expect(new Set(titles).size).toBe(titles.length);
  });

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

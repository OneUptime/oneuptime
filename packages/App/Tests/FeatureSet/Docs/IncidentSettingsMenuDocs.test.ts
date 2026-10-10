import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { dashboardLabel } from "./DocsDashboardLabels";
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
 * order, in every docs language - each page named as that language's
 * Dashboard draws it (DocsDashboardLabels).
 *
 * The AI section is listed the same way: the overview's AI row names the
 * section's pages in the menu's order, and none of them is in Settings.
 * So are the Rules section and the Integrations section, which holds the
 * tools that open incidents on their own.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const INCIDENTS_SIDE_MENU_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Pages/Incidents/SideMenu.tsx",
);

const LANGUAGES: ReadonlyArray<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

const OVERVIEW_PAGE: string = "incidents/index";
const SETTINGS_PAGE: string = "incidents/settings";

// A table row whose first cell is this bold name.
function rowPattern(name: string): RegExp {
  const escaped: string = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return new RegExp(`^\\|\\s*\\*\\*${escaped}\\*\\*\\s*\\|`);
}

// The overview's row for a section of the menu, as this language names it.
function sectionRow(language: string, section: string): RegExp {
  return rowPattern(dashboardLabel(language, section));
}

// The menu's titles, as this language's Dashboard draws them.
function named(language: string, titles: Array<string>): Array<string> {
  return titles.map((title: string): string => {
    return dashboardLabel(language, title);
  });
}

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

/*
 * The first column of the table under the settings page's first section -
 * "Where incident settings live", in whatever words the language uses.
 */
function settingsTablePages(language: string): Array<string> {
  const markdown: string = readPage(SETTINGS_PAGE, language);
  const start: number = markdown.search(/\n## /);

  expect({ language: language, heading: start >= 0 }).toEqual({
    language: language,
    heading: true,
  });

  const section: string = markdown.slice(markdown.indexOf("\n", start + 1));
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
  return overviewRow(language, sectionRow(language, "Settings"));
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

  /*
   * The auto remediation rules had a page of their own here; they are under
   * the Settings page's More settings now, with the investigation rules.
   */
  it("reads the menu's AI pages: Insights, Logs and Settings", () => {
    expect(aiMenuTitles()).toEqual(["Insights", "Logs", "Settings"]);
  });

  it("reads the menu's Rules and Integrations pages", () => {
    const rules: Array<string> = sectionMenuTitles("Rules");

    expect(rules).toHaveLength(8);
    expect(rules).toContain("On-Call Rules");
    expect(rules).not.toContain("Auto Remediation Rules");
    expect(sectionMenuTitles("Integrations")).toEqual(["Huntress"]);
  });

  it("checks every docs language", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(LANGUAGES).toContain("en");
    expect(LANGUAGES).toContain("hi");
  });

  it.each(LANGUAGES)(
    "%s: the overview's AI row names every page of the AI section, in menu order",
    (language: string) => {
      expect({
        language: language,
        pages: overviewRow(language, sectionRow(language, "AI")),
      }).toEqual({
        language: language,
        pages: named(language, aiMenuTitles()),
      });
    },
  );

  it.each(LANGUAGES)(
    "%s: the overview's Settings row names every page, in menu order",
    (language: string) => {
      expect({
        language: language,
        pages: overviewSettingsRow(language),
      }).toEqual({
        language: language,
        pages: named(language, settingsMenuTitles()),
      });
    },
  );

  it.each(LANGUAGES)(
    "%s: the overview's Rules row names every rule page, in menu order",
    (language: string) => {
      expect({
        language: language,
        pages: overviewRow(language, sectionRow(language, "Rules")),
      }).toEqual({
        language: language,
        pages: named(language, sectionMenuTitles("Rules")),
      });
    },
  );

  it.each(LANGUAGES)(
    "%s: the overview's Integrations row names every integration, in menu order",
    (language: string) => {
      expect({
        language: language,
        pages: overviewRow(language, sectionRow(language, "Integrations")),
      }).toEqual({
        language: language,
        pages: named(language, sectionMenuTitles("Integrations")),
      });
    },
  );

  it.each(LANGUAGES)(
    "%s: the settings page's table has a row per page, in menu order",
    (language: string) => {
      expect({
        language: language,
        pages: settingsTablePages(language),
      }).toEqual({
        language: language,
        pages: named(language, settingsMenuTitles()),
      });
    },
  );

  it.each(LANGUAGES)(
    "%s: the Linked Alerts row says what the page is for",
    (language: string) => {
      const pattern: RegExp = rowPattern(
        dashboardLabel(language, "Linked Alerts"),
      );
      const row: string | undefined = readPage(SETTINGS_PAGE, language)
        .split("\n")
        .find((line: string): boolean => {
          return pattern.test(line);
        });

      expect(row).toBeDefined();
      expect((tableCells(row || "")[1] || "").length).toBeGreaterThan(20);
    },
  );

  it("finds a row only by its own bold name", () => {
    expect(rowPattern("AI").test("| **AI**        | Insights |")).toBe(true);
    expect(rowPattern("AI").test("| **AI Logs** | x |")).toBe(false);
    expect(rowPattern("SLA Rules").test("| **SLA Rules** | x |")).toBe(true);
  });
});

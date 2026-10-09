import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #4571: a widget that cannot be drawn shows "This widget could not be
 * shown" in its own place instead of taking the dashboard down, and someone
 * who may edit the dashboard gets Edit widget (its settings, where Delete
 * Widget is). The Widgets page says so, in every language, naming the note
 * and the buttons exactly as the dashboard shows them: the English names are
 * read from the components that draw them, and every translation's from that
 * language's Dashboard locale file.
 */

const APP_ROOT: string = path.join(__dirname, "..", "..", "..");
const DOCS_CONTENT: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Docs",
  "Content",
);
const DASHBOARD_SOURCE: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Dashboard",
  "src",
);
const LOCALES: string = path.join(DASHBOARD_SOURCE, "Locales");

const PAGE: string = "dashboards/widgets.md";

const TRANSLATIONS: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// The note's title and the buttons the section names, in English.
const NAMES: Array<string> = [
  "This widget could not be shown",
  "Edit widget",
  "Delete Widget",
  "Save Changes",
  "Try again",
];

function readPage(language: string): string {
  return fs.readFileSync(path.join(DOCS_CONTENT, language, PAGE), "utf8");
}

function readSource(...parts: Array<string>): string {
  return fs.readFileSync(path.join(DASHBOARD_SOURCE, ...parts), "utf8");
}

function localeOf(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

// The section of a page that starts at `heading` and runs to the next "## ".
function sectionOf(page: string, heading: string): string {
  const start: number = page.indexOf(heading);

  if (start === -1) {
    return "";
  }

  const next: number = page.indexOf("\n## ", start + heading.length);

  return page.slice(start, next === -1 ? undefined : next);
}

const ENGLISH_HEADING: string = "## When a widget can't be shown";

describe("the Widgets page: when a widget can't be shown (issue #4571)", () => {
  const section: string = sectionOf(readPage("en"), ENGLISH_HEADING);

  test("has the section, before Where to read next", () => {
    const page: string = readPage("en");

    expect(section).not.toBe("");
    expect(page.indexOf(ENGLISH_HEADING)).toBeLessThan(
      page.indexOf("## Where to read next"),
    );
  });

  test("names the note and every button as the dashboard draws them", () => {
    const fallback: string = readSource(
      "Components",
      "Dashboard",
      "Components",
      "DashboardWidgetFallback.tsx",
    );
    const settings: string = readSource(
      "Components",
      "Dashboard",
      "Canvas",
      "ComponentSettingsModal.tsx",
    );
    const toolbar: string = readSource(
      "Components",
      "Dashboard",
      "Toolbar",
      "DashboardToolbar.tsx",
    );

    expect(fallback).toContain('"This widget could not be shown"');
    expect(fallback).toContain('title="Edit widget"');
    expect(fallback).toContain('title="Try again"');
    expect(settings).toContain("`Delete Widget`");
    expect(toolbar).toContain('"Save Changes"');

    for (const name of NAMES) {
      expect(section).toContain(`**${name}**`);
    }
  });

  test("says what the note is for and who sees what", () => {
    expect(section).toContain("the rest of the dashboard keeps working");
    expect(section).toContain(
      "is drawn again at the next auto-refresh or when you change the time range",
    );
    expect(section).toContain(
      "Visitors to a public dashboard are only told that the widget could not be shown.",
    );
  });

  test.each(TRANSLATIONS)(
    "the %s page has it too, naming everything as its Dashboard does",
    (language: string) => {
      const page: string = readPage(language);
      const locale: Record<string, string> = localeOf(language);

      for (const name of NAMES) {
        const translated: string | undefined = locale[name];

        expect({ language, name, translated: Boolean(translated) }).toEqual({
          language,
          name,
          translated: true,
        });
        expect({
          language,
          name,
          named: page.includes(`**${translated}**`),
        }).toEqual({ language, name, named: true });
      }
    },
  );

  test.each(TRANSLATIONS)(
    "the %s page keeps the section where English has it: before its last heading",
    (language: string) => {
      const page: string = readPage(language);
      const headingsOf: (text: string) => Array<string> = (
        text: string,
      ): Array<string> => {
        return text.split("\n").filter((line: string) => {
          return line.startsWith("## ");
        });
      };
      const headings: Array<string> = headingsOf(page);
      const english: Array<string> = headingsOf(readPage("en"));

      expect(headings).toHaveLength(english.length);

      const noteTitle: string = localeOf(language)[NAMES[0]!]!;
      const sectionIndex: number = headings.findIndex((heading: string) => {
        return sectionOf(page, heading).includes(`**${noteTitle}**`);
      });

      expect(sectionIndex).toBe(english.indexOf(ENGLISH_HEADING));
      expect(sectionIndex).toBe(english.length - 2);
    },
  );
});

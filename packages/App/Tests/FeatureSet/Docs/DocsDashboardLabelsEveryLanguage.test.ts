import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  dashboardLabel,
  drawnDashboardLabel,
  isDashboardLabel,
} from "./DocsDashboardLabels";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every docs language names the Dashboard as that language's Dashboard
 * draws it (#7100).
 *
 * The Persian incident pages used to quote about 750 Dashboard labels in
 * English: DocsDashboardLabels held a list of languages whose pages kept the
 * Dashboard's English names, and several suites had a copy of it, while the
 * Persian Dashboard draws those labels in Persian. A reader matching the
 * page to the screen found words the screen does not have. These tests keep
 * that exception gone:
 *
 *   - dashboardLabel, which the suites check the pages with, is the drawn
 *     label in every docs language, Persian included;
 *   - no docs suite declares a list of languages whose pages keep the
 *     English names, with Persian on it;
 *   - the Persian incident pages and the IRC page (the pages the exception
 *     covered) quote in English only the names kept on purpose, each with
 *     the reason, and each still quoted - a label the Persian locale has in
 *     English stays English, and is not counted.
 */

const DOCS_TESTS_DIR: string = __dirname;
const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const PERSIAN: string = "fa";

// Arabic-script letters, which every Persian word contains.
const PERSIAN_LETTER: RegExp = /[؀-ۿ]/;

// Text with no letter outside printable ASCII, a dash and an ellipsis.
const LATIN_ONLY: RegExp = /^[ -~—…]+$/;

const BOLD: RegExp = /\*\*([^*\n]+?)\*\*/g;
const MENU_PATH_SEPARATOR: string = "→";

interface KeptName {
  name: string;
  why: string;
}

const PERMISSION_NAME: string =
  "A permission's name, as a custom role lists it, which every language keeps in English.";
const WORKFLOW_STEP_SETTING: string =
  "The workflow step's setting, which the workflow docs name in English.";
const WORKFLOW_BUILDER_NAME: string =
  "The workflow builder's name, which IncidentDocsTranslations keeps in English for every language (KEPT_IN_ENGLISH).";
const CHAT_NOTE_MODAL: string =
  "The Slack and Microsoft Teams note modal, which is not translated.";
const IRC_STEP_ARGUMENT: string =
  "The Send Message to IRC step's argument, which the builder shows by the component's own English name.";

/*
 * The pages the exception covered, and the bold names each keeps in English
 * although the Persian Dashboard words them.
 */
const KEPT_ON_PERSIAN_PAGES: Record<string, ReadonlyArray<KeptName>> = {
  "incidents/index": [],
  "incidents/declaring-incidents": [
    { name: "Incident Template", why: WORKFLOW_STEP_SETTING },
    {
      name: "Primary",
      why: "An on-call policy's name inside the feed line, which the server writes in English.",
    },
  ],
  "incidents/states-and-severities": [
    {
      name: "Investigating",
      why: "A custom state a project might add: a name people give.",
    },
    {
      name: "Closed",
      why: "A custom state a project might add: a name people give.",
    },
    {
      name: "Time to Acknowledge",
      why: "The metric's name, as the metrics explorer lists it.",
    },
    {
      name: "Status",
      why: "The subscriber email's row, quoted as the email shows it.",
    },
    { name: "Create Incident State Timeline", why: PERMISSION_NAME },
    { name: "Create Alert Internal Note", why: PERMISSION_NAME },
    { name: "Create Alert Episode Internal Note", why: PERMISSION_NAME },
    { name: "Create Incident Episode Internal Note", why: PERMISSION_NAME },
  ],
  "incidents/notes-owners-and-feed": [
    { name: "Public Note", why: CHAT_NOTE_MODAL },
    { name: "Private Note", why: CHAT_NOTE_MODAL },
    { name: "Note", why: CHAT_NOTE_MODAL },
    { name: "Incident Template", why: WORKFLOW_STEP_SETTING },
  ],
  "incidents/linked-alerts": [
    { name: "Create Alert State Timeline", why: PERMISSION_NAME },
    { name: "Edit Alert", why: PERMISSION_NAME },
    { name: "Create Incident Alert", why: PERMISSION_NAME },
    {
      name: "Incident",
      why: "The permission group the linking permissions are listed under, named in English as they are.",
    },
  ],
  "incidents/settings": [
    { name: "Incident Template", why: WORKFLOW_STEP_SETTING },
    { name: "Add Trigger", why: WORKFLOW_BUILDER_NAME },
    { name: "Incident", why: WORKFLOW_BUILDER_NAME },
    { name: "Success", why: WORKFLOW_BUILDER_NAME },
  ],
  "integrations/irc": [
    { name: "Message Text", why: IRC_STEP_ARGUMENT },
    { name: "Port", why: IRC_STEP_ARGUMENT },
    { name: "Channel", why: IRC_STEP_ARGUMENT },
  ],
};

const PERSIAN_PAGES: Array<string> = Object.keys(KEPT_ON_PERSIAN_PAGES);

function readPersianPage(page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, PERSIAN, `${page}.md`), "utf8");
}

/*
 * The bold names, and the segments of bold menu paths, a Persian page writes
 * in English although the Persian Dashboard draws them in other words.
 */
function englishDashboardLabels(markdown: string): Array<string> {
  const found: Set<string> = new Set<string>();

  for (const match of markdown.matchAll(BOLD)) {
    for (const segment of (match[1] as string).split(MENU_PATH_SEPARATOR)) {
      const name: string = segment.trim();

      if (
        LATIN_ONLY.test(name) &&
        isDashboardLabel(name) &&
        drawnDashboardLabel(PERSIAN, name) !== name
      ) {
        found.add(name);
      }
    }
  }

  return Array.from(found).sort();
}

// A list of languages, named for keeping English, with Persian on it.
const ENGLISH_LANGUAGE_LIST: RegExp =
  /const\s+(\w*ENGLISH\w*)\s*:[^=;]*=\s*([^;]*);/g;

// The lists a docs suite's source declares that keep Persian in English.
function persianKeptInEnglish(source: string): Array<string> {
  return Array.from(source.matchAll(ENGLISH_LANGUAGE_LIST))
    .filter((match: RegExpMatchArray): boolean => {
      const value: string = match[2] as string;

      return value.includes(`"${PERSIAN}"`) || value.includes("PERSIAN");
    })
    .map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });
}

describe("every docs language names the Dashboard as it draws it", () => {
  it("checks every docs language, Persian among them", () => {
    expect(SUPPORTED_DOCS_LANGUAGE_CODES).toContain(PERSIAN);
    expect(SUPPORTED_DOCS_LANGUAGE_CODES.length).toBe(17);
  });

  it("dashboardLabel is the label as drawn, in every docs language", () => {
    expect(dashboardLabel).toBe(drawnDashboardLabel);

    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      for (const english of [
        "Owners",
        "Save",
        "Incident Template",
        "Chart summary",
        "Average",
        "Create Incident Role",
      ]) {
        expect({
          language: language,
          english: english,
          named: dashboardLabel(language, english),
        }).toEqual({
          language: language,
          english: english,
          named: drawnDashboardLabel(language, english),
        });
      }
    }
  });

  it("names a label in Persian as the Persian Dashboard draws it, not in English", () => {
    for (const english of [
      "Owners",
      "Save",
      "Incident Template",
      "Chart summary",
      "Average",
      "Create Incident Role",
    ]) {
      const named: string = dashboardLabel(PERSIAN, english);

      expect({ english: english, persian: PERSIAN_LETTER.test(named) }).toEqual(
        { english: english, persian: true },
      );
    }

    // A label the Persian locale has in English stays English.
    expect(dashboardLabel(PERSIAN, "Markdown")).toBe("Markdown");
  });

  it("no docs suite keeps a list of languages whose pages name the Dashboard in English, with Persian on it", () => {
    const sources: Array<string> = fs
      .readdirSync(DOCS_TESTS_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".ts") && file !== path.basename(__filename);
      });

    expect(sources.length).toBeGreaterThan(100);

    const lists: Array<string> = sources.flatMap(
      (file: string): Array<string> => {
        return persianKeptInEnglish(
          fs.readFileSync(path.join(DOCS_TESTS_DIR, file), "utf8"),
        ).map((name: string): string => {
          return `${file}: ${name}`;
        });
      },
    );

    expect(lists).toEqual([]);
  });

  it("would find such a list again", () => {
    expect(
      persianKeptInEnglish(
        'const ENGLISH_UI_NAME_LANGUAGES: ReadonlyArray<string> = ["en", "fa"];',
      ),
    ).toEqual(["ENGLISH_UI_NAME_LANGUAGES"]);
    expect(
      persianKeptInEnglish(
        'const ENGLISH_UI_LANGUAGES: ReadonlySet<string> = new Set<string>(["en", PERSIAN]);',
      ),
    ).toEqual(["ENGLISH_UI_LANGUAGES"]);
    // A list of English names, or a list without Persian, is not one.
    expect(
      persianKeptInEnglish(
        'const ENGLISH_HEADING: Record<string, string> = { en: "A", fa: "ب" };',
      ),
    ).toEqual([]);
    expect(
      persianKeptInEnglish(
        'const ENGLISH_ONLY_LANGUAGES: Array<string> = ["en"];',
      ),
    ).toEqual([]);
  });
});

describe("the Persian pages the exception covered", () => {
  it("give each name they keep in English a reason, once", () => {
    for (const page of PERSIAN_PAGES) {
      const names: Array<string> = (KEPT_ON_PERSIAN_PAGES[page] || []).map(
        (kept: KeptName): string => {
          return kept.name;
        },
      );

      expect({ page: page, names: new Set<string>(names).size }).toEqual({
        page: page,
        names: names.length,
      });

      for (const kept of KEPT_ON_PERSIAN_PAGES[page] || []) {
        expect({ name: kept.name, reason: kept.why.length > 20 }).toEqual({
          name: kept.name,
          reason: true,
        });
      }
    }
  });

  it.each(PERSIAN_PAGES)(
    "fa/%s quotes in English only the Dashboard labels it keeps on purpose, and still quotes each",
    (page: string) => {
      expect(englishDashboardLabels(readPersianPage(page))).toEqual(
        (KEPT_ON_PERSIAN_PAGES[page] || [])
          .map((kept: KeptName): string => {
            return kept.name;
          })
          .sort(),
      );
    },
  );

  it("would find an English label put back, in prose or in a menu path", () => {
    expect(
      englishDashboardLabels(
        "**مالکان** and **Owners**, then **حوادث → Settings → قالب‌های حادثه**",
      ),
    ).toEqual(["Owners", "Settings"]);
    // Not a product name, nor a label the Persian locale has in English.
    expect(englishDashboardLabels("**OneUptime** and **Markdown**")).toEqual(
      [],
    );
  });
});

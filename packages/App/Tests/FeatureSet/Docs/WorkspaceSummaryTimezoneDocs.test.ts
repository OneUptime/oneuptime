import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import WorkspaceSummaryScheduleUtil from "Common/Utils/Workspace/WorkspaceSummarySchedule";
import Timezone from "Common/Types/Timezone";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Summaries section of the Slack and Microsoft Teams guides, in every
 * docs language, against the form and the server it describes.
 *
 * A workspace summary - the recurring incident or alert roundup posted to a
 * channel - goes out on its own time zone's clock, so it keeps its time of
 * day when the clocks change. Stepped in UTC, a summary set for 09:00 in
 * Berlin went out at 08:00 there once they went back. The form's Timezone
 * field starts on the creator's own, and a summary created through the API
 * without one takes the time zone in its creator's profile, or UTC for an
 * API key (WorkspaceNotificationSummaryService). Markdown is not compiled,
 * so these tests read the sources of truth - the form, the schedule's
 * defaults and the dashboard's own words in each language - and check every
 * page tells the same story.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const DASHBOARD_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Locales",
);

const FORM_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceSummaryTable.tsx";

const PAGES: ReadonlyArray<[string, string]> = [
  ["workspace-connections/slack.md", "Slack"],
  ["workspace-connections/microsoft-teams.md", "Microsoft Teams"],
];

// The form's own words, as the dashboard draws them in English.
const TIMEZONE_FIELD: string = "Timezone";
const FIRST_SEND_FIELD: string = "Send First Report At";

const PERSIAN_DIGITS: string = "۰۱۲۳۴۵۶۷۸۹";

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

function readPage(lang: string, page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, lang, page), "utf8");
}

// The words a language's dashboard shows: English where it has none.
function readDashboardLocale(lang: string): Record<string, string> {
  const file: string = path.join(DASHBOARD_LOCALES_DIR, `${lang}.json`);
  const locale: Record<string, string> = JSON.parse(
    fs.readFileSync(file, "utf8"),
  );

  return new Proxy(locale, {
    get: (target: Record<string, string>, key: string): string => {
      return target[key] || key;
    },
  });
}

// Persian pages write their numbers in Persian digits.
function toLatinDigits(text: string): string {
  return text.replace(/[۰-۹]/g, (digit: string): string => {
    return String(PERSIAN_DIGITS.indexOf(digit));
  });
}

/*
 * The section that says what summaries are: the "## " section after the
 * page's "Testing a rule" one, which is the page's first.
 */
function findSummariesSection(lang: string, page: string): string {
  const sections: Array<string> = readPage(lang, page).split(/\n(?=## )/);
  const summaries: Array<string> = sections.filter(
    (section: string): boolean => {
      return section.includes("`timezone`");
    },
  );

  expect(summaries).toHaveLength(1);

  return summaries[0]!;
}

describe("the sources the pages are checked against", () => {
  it("covers every docs language", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(LANGUAGES).toContain("en");
  });

  it("the form still asks Timezone and Send First Report At on the Schedule step", () => {
    const form: string = readRepoFile(FORM_FILE);

    expect(form).toContain(`title: "${TIMEZONE_FIELD}"`);
    expect(form).toContain(`title: "${FIRST_SEND_FIELD}"`);
    expect(form).toContain("TimezoneUtil.getTimezoneDropdownOptions()");
  });

  it("a summary still starts weekly, at 09:00, read in UTC when it names no time zone", () => {
    expect(WorkspaceSummaryScheduleUtil.DEFAULT_SEND_HOUR).toBe(9);
    expect(WorkspaceSummaryScheduleUtil.DEFAULT_INTERVAL_COUNT).toBe(1);
    expect(WorkspaceSummaryScheduleUtil.DEFAULT_TIMEZONE).toBe(Timezone.UTC);
  });
});

describe.each(PAGES)("the English %s page", (page: string, workspace: string) => {
  const section: string = findSummariesSection("en", page);

  it("is headed Summaries and says where the summaries are", () => {
    expect(section.startsWith("## Summaries\n")).toBe(true);
    expect(section).toContain(
      `The **Summary** tab of **Incidents** > **Workspace** > **${workspace}** (and of **Alerts**)`,
    );
  });

  it("says what a new summary does by default", () => {
    expect(section).toContain(
      "A new summary goes out every week and covers the last 7 days.",
    );
    expect(section).toContain(
      "Leave **Send First Report At** empty, and the first one goes out at 09:00 at the start of the next week, day or month; the form says when.",
    );
  });

  it("says the summary keeps its time of day on its Timezone's clock, which starts on yours", () => {
    expect(section).toContain(
      "A summary goes out on the clock of its **Timezone**, which starts on yours.",
    );
    expect(section).toContain(
      "one set for 09:00 in Berlin still goes out at 09:00 in Berlin after the clocks change for daylight saving time",
    );
  });

  it("tells API users how to send one, and what a summary without one gets", () => {
    expect(section).toContain(
      "Through the API, send `timezone` as an IANA time zone name, such as `Europe/Berlin`.",
    );
    expect(section).toContain(
      "A summary created without one takes the time zone in its creator's profile, or UTC when an API key creates it.",
    );
  });

  it("sits between Testing a rule and the plan note", () => {
    const headings: Array<string> = readPage("en", page)
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("## ");
      });

    expect(headings.indexOf("## Summaries")).toBe(
      headings.indexOf("## Testing a rule") + 1,
    );
  });
});

describe.each(LANGUAGES)("the %s pages", (lang: string) => {
  const locale: Record<string, string> = readDashboardLocale(lang);

  it.each(PAGES)(
    "%s has one Summaries section, right after Testing a rule",
    (page: string) => {
      const headings: Array<string> = readPage(lang, page)
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("## ");
        });

      const section: string = findSummariesSection(lang, page);
      const heading: string = section.split("\n")[0]!;

      // The page's first section is Testing a rule; Summaries is the second.
      expect(headings.indexOf(heading)).toBe(1);
    },
  );

  it.each(PAGES)(
    "%s names the fields as that language's dashboard does",
    (page: string) => {
      const section: string = findSummariesSection(lang, page);

      expect(section).toContain(`**${locale[TIMEZONE_FIELD]}**`);
      expect(section).toContain(`**${locale[FIRST_SEND_FIELD]}**`);
    },
  );

  it.each(PAGES)(
    "%s names its own workspace, the API field and an IANA example",
    (page: string, workspace: string) => {
      const section: string = findSummariesSection(lang, page);

      expect(section).toContain(`**${workspace}**`);
      expect(section).toContain("`timezone`");
      expect(section).toContain("`Europe/Berlin`");
      expect(section).toContain("UTC");
    },
  );

  it.each(PAGES)(
    "%s gives the same numbers: 7 days, and 09:00",
    (page: string) => {
      const section: string = toLatinDigits(findSummariesSection(lang, page));

      expect(section).toContain("7");
      expect(section).toContain("09:00");
      // No other hour of the day: the default, and Berlin's 09:00, only.
      expect(
        [...new Set(section.match(/\d{2}:\d{2}/g) || [])].sort(),
      ).toEqual(["09:00"]);
    },
  );
});

describe("the upgrade notes", () => {
  const upgrading: string = readPage("en", "installation/upgrading.md");

  it("say what changes for existing summaries", () => {
    expect(upgrading).toContain(
      "**Slack and Microsoft Teams summaries keep their time of day when the\n  clocks change.**",
    );
    expect(upgrading).toContain(
      "gives each existing summary the time zone in its creator's profile",
    );
    expect(upgrading).toContain("No next\n  send moves during the upgrade");
    expect(upgrading).toContain(
      "See [Summaries](/docs/workspace-connections/slack#summaries).",
    );
  });
});

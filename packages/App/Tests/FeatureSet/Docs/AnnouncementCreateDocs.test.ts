import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  ANNOUNCEMENT_SCHEDULE_SUMMARIES,
  ANNOUNCEMENT_SUBSCRIBERS_NOTIFIED_SUMMARY,
  SCHEDULE_AND_NOTIFICATIONS_SECTION_TITLE,
  SCHEDULE_SECTION_TITLE,
} from "../../../FeatureSet/Dashboard/src/Components/Announcement/AnnouncementForm";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Creating an announcement takes two steps. The subscribers guide
 * (status-pages/subscribers.md) walks them in every language: it names the
 * steps and the folded section as the reader's dashboard does (each
 * language's own translation, from the Dashboard's locale file - English
 * and Persian keep the English labels), quotes the line the folded section
 * shows, and says a status page's own Create picks that page. Markdown is
 * not compiled, so this reads the create form's fields and checks the
 * guides still tell the same story, and that none of them, in any
 * language, still walks the old four-step form.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const DASHBOARD: string = "App/FeatureSet/Dashboard/src";
const FIELDS_FILE: string = `${DASHBOARD}/Components/Announcement/AnnouncementFormFields.tsx`;
const LOCALES_DIR: string = path.join(REPO_ROOT, DASHBOARD, "Locales");

const GUIDE: string = "status-pages/subscribers.md";

// The guides that keep the dashboard's English labels.
const ENGLISH_LABEL_LANGUAGES: Array<string> = ["en", "fa"];

function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

function readGuide(language: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, GUIDE), "utf8");
}

function guideLanguages(): Array<string> {
  return SUPPORTED_DOCS_LANGUAGE_CODES.filter((language: string): boolean => {
    return fs.existsSync(path.join(CONTENT_DIR, language, GUIDE));
  });
}

const locales: Map<string, Record<string, string>> = new Map();

function localeOf(language: string): Record<string, string> {
  let locale: Record<string, string> | undefined = locales.get(language);

  if (!locale) {
    locale = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
    ) as Record<string, string>;
    locales.set(language, locale);
  }

  return locale;
}

// A label as the reader's dashboard shows it, in the guide's language.
function labelIn(language: string, english: string): string {
  if (ENGLISH_LABEL_LANGUAGES.includes(language)) {
    return english;
  }

  const locale: Record<string, string> = localeOf(language);

  expect(`${language} ${english}: ${typeof locale[english]}`).toBe(
    `${language} ${english}: string`,
  );

  return locale[english]!;
}

const FIELDS: string = readRepoFile(FIELDS_FILE);
const ENGLISH_GUIDE: string = readGuide("en");

// The step titles, in order, as the announcement's forms declare them.
function stepTitles(): Array<string> {
  const stepsBlock: string | undefined = FIELDS.match(
    /ANNOUNCEMENT_FORM_STEPS: Array<FormStep<StatusPageAnnouncement>> =\s*\[([\s\S]*?)\];/,
  )?.[1];

  expect(stepsBlock).toBeDefined();

  return Array.from(stepsBlock!.matchAll(/title: "([^"]+)"/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

describe("the announcement forms in the docs", () => {
  test("the guide exists in every language", () => {
    expect(guideLanguages().length).toBe(SUPPORTED_DOCS_LANGUAGE_CODES.length);
  });

  test("walks the form's two steps, in its order, in every language", () => {
    const steps: Array<string> = stepTitles();

    expect(steps).toEqual(["Announcement", "Status Pages"]);

    for (const language of guideLanguages()) {
      const guide: string = readGuide(language);
      let from: number = 0;

      for (const [index, step] of steps.entries()) {
        const item: string = `${index + 1}. **${labelIn(language, step)}**`;
        const at: number = guide.indexOf(item, from);

        expect(`${language} ${item}: ${at >= 0}`).toBe(
          `${language} ${item}: true`,
        );
        from = at;
      }
    }
  });

  test("names the folded sections and the fields in them as the form does, in every language", () => {
    expect(SCHEDULE_AND_NOTIFICATIONS_SECTION_TITLE).toBe(
      "Schedule & Notifications",
    );
    expect(SCHEDULE_SECTION_TITLE).toBe("Schedule");

    const titles: Array<string> = [
      "Start Showing Announcement At",
      "End Showing Announcement At",
      "Notify Status Page Subscribers",
      "Monitors Affected",
      "Show announcement on these status pages",
      "Attachments",
      "Notify subscribers about this update",
    ];

    for (const title of titles) {
      if (title !== "Notify subscribers about this update") {
        expect(FIELDS).toContain(`title: "${title}"`);
      }

      for (const language of guideLanguages()) {
        const label: string = labelIn(language, title);

        expect(
          `${language} ${label}: ${readGuide(language).includes(`**${label}**`)}`,
        ).toBe(`${language} ${label}: true`);
      }
    }

    for (const language of guideLanguages()) {
      const guide: string = readGuide(language);

      for (const section of [
        SCHEDULE_AND_NOTIFICATIONS_SECTION_TITLE,
        SCHEDULE_SECTION_TITLE,
        "Advanced",
      ]) {
        const label: string = labelIn(language, section);

        expect(`${language} ${label}: ${guide.includes(`**${label}**`)}`).toBe(
          `${language} ${label}: true`,
        );
      }
    }
  });

  test("quotes the folded section's line word for word, in every language", () => {
    for (const language of guideLanguages()) {
      const line: string = [
        ANNOUNCEMENT_SCHEDULE_SUMMARIES.nowUntilEnded,
        ANNOUNCEMENT_SUBSCRIBERS_NOTIFIED_SUMMARY,
      ]
        .map((sentence: string): string => {
          return labelIn(language, sentence);
        })
        .join(" ");

      // Persian describes the line in its own words around English labels.
      if (language === "fa") {
        continue;
      }

      expect(`${language}: ${readGuide(language).includes(line)}`).toBe(
        `${language}: true`,
      );
    }
  });

  test("says a status page's own Create picks that page and comes back to it", () => {
    expect(ENGLISH_GUIDE).toContain(
      "Created from a status page, that page is already picked",
    );
    expect(ENGLISH_GUIDE).toContain(
      "**Create Announcement** brings you back to the page's **Announcements** list (or to the project's list, if you unpicked that page on the way)",
    );
  });

  test("says the description is required, and when an end is refused", () => {
    expect(ENGLISH_GUIDE).toContain(
      "**Description** (Markdown, required: it is the text people read on the status page)",
    );
    expect(ENGLISH_GUIDE).toContain(
      "The end has to come after the start and, on a new announcement, still be to come",
    );
    expect(ENGLISH_GUIDE).toContain(
      "Setting an end that has passed is how you take an announcement down.",
    );
  });

  test("puts the Edit's update box under the description", () => {
    expect(ENGLISH_GUIDE).toContain(
      "On an announcement it is on the **Announcement** step, right under the description.",
    );
    expect(ENGLISH_GUIDE).toContain(
      "**Notify subscribers about this update** sits under the description",
    );
  });

  test("walks a template's steps as its form does", () => {
    for (const step of ["Template Info", "Announcement", "Status Pages"]) {
      expect(FIELDS).toContain(`title: "${step}"`);
    }

    expect(ENGLISH_GUIDE).toContain(
      "Its form walks **Template Info** (**Template Name**, **Template Description**), then the announcement's own steps: **Announcement** (**Title**, **Description**) and **Status Pages**",
    );

    for (const language of guideLanguages()) {
      const label: string = labelIn(language, "Template Info");

      expect(
        `${language} ${label}: ${readGuide(language).includes(`**${label}**`)}`,
      ).toBe(`${language} ${label}: true`);
    }
  });

  test("no guide, in any language, walks the old four-step form", () => {
    const problems: Array<string> = [];

    for (const language of guideLanguages()) {
      const guide: string = readGuide(language);
      const retired: Array<string> = [
        `1. **${labelIn(language, "Basic Information")}**`,
        `3. **${labelIn(language, "Resources Affected")}**`,
        `4. **${labelIn(language, "Schedule & Settings")}**`,
        `**${labelIn(language, "Monitors affected (Optional)")}**`,
      ];

      if (ENGLISH_LABEL_LANGUAGES.includes(language)) {
        retired.push("**Notify Subscribers**", "four-step wizard");
      }

      for (const text of retired) {
        if (guide.includes(text)) {
          problems.push(`${language}/${GUIDE}: ${text}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });
});

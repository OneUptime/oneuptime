import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  ANNOUNCEMENT_SCHEDULE_SUMMARIES,
  ANNOUNCEMENT_SUBSCRIBERS_NOTIFIED_SUMMARY,
  SCHEDULE_AND_NOTIFICATIONS_SECTION_TITLE,
} from "../../../FeatureSet/Dashboard/src/Components/Announcement/AnnouncementForm";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Creating an announcement takes two steps. The subscribers guide
 * (status-pages/subscribers.md) walks them, quotes the line the folded
 * Schedule & Notifications section shows, names the fields inside it as the
 * form does, and says a status page's own Create picks that page. Markdown
 * is not compiled, so this reads the create form's source and checks the
 * guide still tells the same story - in English and in Persian, the two
 * languages whose guide describes the form - and that no guide, in any
 * language, still sends readers to the old four-step form.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const DASHBOARD: string = "App/FeatureSet/Dashboard/src";
const CREATE_FORM_FILE: string = `${DASHBOARD}/Pages/StatusPages/AnnouncementCreate.tsx`;
const TEMPLATES_FILE: string = `${DASHBOARD}/Pages/StatusPages/Settings/StatusPageAnnouncementTemplates.tsx`;

const GUIDE: string = "status-pages/subscribers.md";

// The guides that describe the form, step by step.
const DESCRIBING_LANGUAGES: Array<string> = ["en", "fa"];

function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

function readGuide(language: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, GUIDE), "utf8");
}

const CREATE_FORM: string = readRepoFile(CREATE_FORM_FILE);
const TEMPLATES_FORM: string = readRepoFile(TEMPLATES_FILE);
const ENGLISH_GUIDE: string = readGuide("en");

// The step titles, in order, as the create form declares them.
function stepTitles(): Array<string> {
  const stepsBlock: string | undefined = CREATE_FORM.match(
    /steps=\{\[([\s\S]*?)\]\}/,
  )?.[1];

  expect(stepsBlock).toBeDefined();

  return Array.from(stepsBlock!.matchAll(/title: "([^"]+)"/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

describe("the announcement create form in the docs", () => {
  test("walks the form's two steps, in its order", () => {
    const steps: Array<string> = stepTitles();

    expect(steps).toEqual(["Announcement", "Status Pages"]);

    for (const language of DESCRIBING_LANGUAGES) {
      const guide: string = readGuide(language);
      let from: number = 0;

      for (const [index, step] of steps.entries()) {
        const item: string = `${index + 1}. **${step}**`;
        const at: number = guide.indexOf(item, from);

        expect(`${language} ${item}: ${at >= 0}`).toBe(
          `${language} ${item}: true`,
        );
        from = at;
      }

      // Two steps, no third.
      expect(guide).not.toContain("3. **Resources Affected**");
    }
  });

  test("names the folded section and the fields in it as the form does", () => {
    expect(SCHEDULE_AND_NOTIFICATIONS_SECTION_TITLE).toBe(
      "Schedule & Notifications",
    );

    for (const title of [
      "Start Showing Announcement At",
      "End Showing Announcement At",
      "Notify Status Page Subscribers",
      "Monitors Affected",
      "Show announcement on these status pages",
      "Attachments",
    ]) {
      expect(CREATE_FORM).toContain(`title: "${title}"`);

      for (const language of DESCRIBING_LANGUAGES) {
        expect(`${language}: ${readGuide(language).includes(`**${title}**`)}`).toBe(
          `${language}: true`,
        );
      }
    }

    for (const language of DESCRIBING_LANGUAGES) {
      expect(readGuide(language)).toContain(
        `**${SCHEDULE_AND_NOTIFICATIONS_SECTION_TITLE}**`,
      );
      expect(readGuide(language)).toContain("**Advanced**");
    }
  });

  test("quotes the folded section's line word for word", () => {
    expect(ENGLISH_GUIDE).toContain(
      `"${ANNOUNCEMENT_SCHEDULE_SUMMARIES.nowUntilEnded} ${ANNOUNCEMENT_SUBSCRIBERS_NOTIFIED_SUMMARY}"`,
    );
  });

  test("says a status page's own Create picks that page and comes back to it", () => {
    expect(ENGLISH_GUIDE).toContain(
      "Created from a status page, that page is already picked",
    );
    expect(ENGLISH_GUIDE).toContain(
      "**Create Announcement** brings you back to the page's **Announcements** list",
    );
  });

  test("says the description is required, as the server requires it", () => {
    expect(ENGLISH_GUIDE).toContain(
      "**Description** (Markdown, required: it is the text people read on the status page)",
    );
  });

  test("walks a template's steps as its form does", () => {
    for (const step of ["Template Info", "Announcement", "Status Pages"]) {
      expect(TEMPLATES_FORM).toContain(`title: "${step}"`);
    }

    expect(ENGLISH_GUIDE).toContain(
      "Its form walks **Template Info** (**Template Name**, **Template Description**), then the announcement's own steps: **Announcement** (**Title**, **Description**) and **Status Pages**",
    );
  });

  test("no guide sends readers to the old form's steps or labels", () => {
    const retired: Array<string> = [
      "**Schedule & Settings**",
      "**Monitors affected (Optional)**",
      "1. **Basic Information**",
      "**Notify Subscribers**",
      "four-step wizard",
    ];
    const problems: Array<string> = [];

    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const file: string = path.join(CONTENT_DIR, language, GUIDE);

      if (!fs.existsSync(file)) {
        continue;
      }

      const guide: string = readGuide(language);

      for (const text of retired) {
        if (guide.includes(text)) {
          problems.push(`${language}/${GUIDE}: ${text}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });
});

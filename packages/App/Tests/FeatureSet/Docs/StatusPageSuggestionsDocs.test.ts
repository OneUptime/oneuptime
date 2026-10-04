import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  ADD_ALL_SUGGESTED_STATUS_PAGES,
  STATUS_PAGE_SUGGESTIONS_LABEL,
} from "../../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageSuggestionRules";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The subscribers guide (status-pages/subscribers.md) says that scheduling
 * maintenance and announcing suggest the status pages that show the
 * affected monitors, one click to add, and that nothing is picked by
 * itself. Markdown is not compiled, so this holds the guides to the line
 * the dashboard draws: the English guide quotes it for both forms, and the
 * guide in every other language quotes it as that language's dashboard
 * shows it, with its own Add all (Persian keeps the English labels, as its
 * guide does throughout).
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LOCALES_DIR: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Locales",
);

const GUIDE: string = "status-pages/subscribers.md";

const ENGLISH_LABEL_LANGUAGES: Array<string> = ["en", "fa"];

function readGuide(language: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, GUIDE), "utf8");
}

function labelIn(language: string, english: string): string {
  if (ENGLISH_LABEL_LANGUAGES.includes(language)) {
    return english;
  }

  const locale: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;

  expect(`${language} ${english}: ${typeof locale[english]}`).toBe(
    `${language} ${english}: string`,
  );

  return locale[english]!;
}

const ENGLISH_GUIDE: string = readGuide("en");

describe("the status page suggestions in the docs", () => {
  test("the scheduled maintenance section says what is suggested, and that nothing is picked by itself", () => {
    const paragraph: string | undefined = ENGLISH_GUIDE.split("\n").find(
      (line: string): boolean => {
        return line.startsWith("**Which status pages?**");
      },
    );

    expect(paragraph).toBeDefined();
    expect(paragraph).toContain("**Show event on these status pages**");
    expect(paragraph).toContain(`"${STATUS_PAGE_SUGGESTIONS_LABEL.other}"`);
    expect(paragraph).toContain(`**${ADD_ALL_SUGGESTED_STATUS_PAGES}**`);
    expect(paragraph).toContain("through a monitor group");
    expect(paragraph).toContain("Only the status pages you can see");
    expect(paragraph).toContain("archived pages");
    expect(paragraph).toContain("Nothing is picked for you");
    // The Edit dialog and the templates suggest too.
    expect(paragraph).toContain("**Edit**");
    expect(paragraph).toContain("scheduled maintenance template");

    // It comes after the create form's steps, in the maintenance section.
    expect(ENGLISH_GUIDE.indexOf("**Which status pages?**")).toBeGreaterThan(
      ENGLISH_GUIDE.indexOf(
        "**Create Scheduled Maintenance Event** walks two steps",
      ),
    );
    expect(ENGLISH_GUIDE.indexOf("**Which status pages?**")).toBeLessThan(
      ENGLISH_GUIDE.indexOf("## Announcements"),
    );
  });

  test("every language's announcement steps quote the line as its dashboard draws it", () => {
    const problems: Array<string> = [];

    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const guide: string = readGuide(language);
      const announcements: string = guide.slice(
        Math.max(0, guide.lastIndexOf("\n2. **")),
      );

      const label: string = labelIn(
        language,
        STATUS_PAGE_SUGGESTIONS_LABEL.other,
      );
      const addAll: string = labelIn(language, ADD_ALL_SUGGESTED_STATUS_PAGES);

      if (!announcements.includes(label)) {
        problems.push(`${language}: does not quote "${label}"`);
      }

      if (!announcements.includes(`**${addAll}**`)) {
        problems.push(`${language}: does not name **${addAll}**`);
      }
    }

    expect(problems).toEqual([]);
  });
});

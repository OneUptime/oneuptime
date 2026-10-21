import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The note template form and the subscriber notification template forms no
 * longer show a yellow "Internal data" warning ("Please remove this yellow
 * warning. We don't need it." - Tests/Dashboard/InternalDataWarningRemoved
 * keeps it out of the Dashboard). The docs said both forms warn, in English
 * and in Persian, the one translated corpus of these pages; they must not
 * promise a warning the forms do not show.
 *
 * What the warning said stays in the docs as plain fact, where a reader who
 * wants it finds it: the custom field, label and status page placeholders
 * read the team's own records, and a public note goes to the incident's
 * status pages and their subscribers.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const FENCE_LINE: RegExp = /^\s*```/;
const ANY_HEADING: RegExp = /^(#{1,6}) (.*)$/;

interface DocsCase {
  language: string;
  page: string;
  section: string;
  // Words that would promise a warning in the form.
  promisesAWarning: RegExp;
  // The words the docs used to promise it with.
  removedSentence: string;
}

const CASES: Array<DocsCase> = [
  {
    language: "en",
    page: "incidents/settings",
    section: "Note templates",
    promisesAWarning: /\bwarn(?:s|ing|ings)?\b/i,
    removedSentence: "lists these placeholders under the note, with a warning",
  },
  {
    language: "fa",
    page: "incidents/settings",
    section: "قالب‌های یادداشت",
    // "a warning" and "warns": the bare word also names OneUptime's Alerts.
    promisesAWarning: /یک هشدار|هشدار می‌دهد/,
    removedSentence: "همراه با یک هشدار",
  },
  {
    language: "en",
    page: "status-pages/subscribers",
    section: "Incident variables",
    promisesAWarning: /\bwarn(?:s|ing|ings)?\b/i,
    removedSentence: "The template form warns about both.",
  },
  {
    language: "fa",
    page: "status-pages/subscribers",
    section: "متغیرهای حادثه",
    promisesAWarning: /یک هشدار|هشدار می‌دهد/,
    removedSentence: "فرم قالب درباره هر دو هشدار می‌دهد.",
  },
];

function readPage(language: string, page: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${page}.md`),
    "utf8",
  );
}

/*
 * The heading with this text and everything under it, up to the next heading
 * of the same or a higher level, outside code fences. A leading right-to-left
 * mark, which the Persian pages put before some headings, is ignored.
 */
function sectionOf(markdown: string, headingText: string): string {
  const lines: Array<string> = markdown.split("\n");
  const section: Array<string> = [];
  let level: number = 0;
  let inFence: boolean = false;

  for (const line of lines) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
    }

    const match: RegExpMatchArray | null = inFence
      ? null
      : line.match(ANY_HEADING);

    if (match) {
      const lineLevel: number = (match[1] as string).length;
      const text: string = (match[2] as string).replace(/^‏/, "").trim();

      if (level === 0) {
        if (text === headingText) {
          level = lineLevel;
          section.push(line);
        }
        continue;
      }

      if (lineLevel <= level) {
        break;
      }
    }

    if (level > 0) {
      section.push(line);
    }
  }

  return section.join("\n");
}

describe("the docs no longer promise an 'Internal data' warning", () => {
  test.each(CASES)(
    "$language $page: the $section section says nothing about a warning",
    (docsCase: DocsCase) => {
      const section: string = sectionOf(
        readPage(docsCase.language, docsCase.page),
        docsCase.section,
      );

      // The section was found, with the placeholders it documents.
      expect(section.length).toBeGreaterThan(500);
      expect(section).toContain("{{");

      expect(section).not.toMatch(docsCase.promisesAWarning);
    },
  );

  test.each(CASES)(
    "$language $page: the sentence that promised it is gone from the page",
    (docsCase: DocsCase) => {
      expect(readPage(docsCase.language, docsCase.page)).not.toContain(
        docsCase.removedSentence,
      );
    },
  );
});

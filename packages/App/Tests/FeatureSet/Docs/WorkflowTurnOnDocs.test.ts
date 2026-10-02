import {
  DEFAULT_DOCS_LANGUAGE,
  SUPPORTED_DOCS_LANGUAGE_CODES,
} from "../../../FeatureSet/Docs/Utils/I18n";
import { WORKFLOW_TURNED_OFF_MESSAGE } from "Common/Types/Workflow/WorkflowEnabled";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Turning a workflow on, as the docs describe it, in all seventeen languages.
 *
 * The maintainer could not find out how to turn a workflow on: the Builder
 * only said "This workflow is not enabled". The pages said the switch was on
 * the Overview page, behind Edit Workflow - except the configuration page,
 * which said it was in Settings - and told readers to test with Run Workflow
 * before turning the workflow on, which a workflow that is off refuses.
 *
 * The Builder now has the Enabled switch at the top, a notice while the
 * workflow is off, and a "Turn on this workflow?" dialog when something is
 * run while it is off. Every language's pages have to say so in that
 * language's own Dashboard words (Aktiviert, 有効, Включено...), or they point
 * at controls nobody can find. Most of these pages nobody on the team can
 * proofread, so this reads all of them.
 */

const DOCS_DIR: string = path.resolve(__dirname, "../../../FeatureSet/Docs");
const CONTENT_DIR: string = path.join(DOCS_DIR, "Content");
const DASHBOARD_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

// The Persian pages name the Dashboard's labels in English.
const ENGLISH_UI_LABELS: Set<string> = new Set(["en", "fa"]);

interface DashboardWords {
  enabled: string;
  builder: string;
  overview: string;
  editWorkflow: string;
  settings: string;
  turnOnWorkflow: string;
  turnOnThisWorkflow: string;
  turnOnAndRun: string;
  turnOnAndRunStep: string;
}

const ENGLISH_WORDS: DashboardWords = {
  enabled: "Enabled",
  builder: "Builder",
  overview: "Overview",
  editWorkflow: "Edit Workflow",
  settings: "Settings",
  turnOnWorkflow: "Turn on workflow",
  turnOnThisWorkflow: "Turn on this workflow?",
  turnOnAndRun: "Turn on and run",
  turnOnAndRunStep: "Turn on and run step",
};

type DashboardWordsFunction = (language: string) => DashboardWords;

// The words the reader sees in the Dashboard, in their language.
const dashboardWords: DashboardWordsFunction = (
  language: string,
): DashboardWords => {
  if (ENGLISH_UI_LABELS.has(language)) {
    return ENGLISH_WORDS;
  }

  const strings: Record<string, unknown> = JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD_LOCALES_DIR, `${language}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;

  const words: Record<string, string> = {};

  for (const [key, english] of Object.entries(ENGLISH_WORDS)) {
    words[key] = String(strings[english] || "");
  }

  return words as unknown as DashboardWords;
};

type ReadPageFunction = (language: string, page: string) => string;

const readPage: ReadPageFunction = (language: string, page: string): string => {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, "workflows", page),
    "utf8",
  );
};

type SectionFunction = (
  language: string,
  page: string,
  englishHeading: string,
) => string;

/*
 * A section of a page, found where the English page has it: the translated
 * pages keep the English pages' sections in the same order.
 */
const section: SectionFunction = (
  language: string,
  page: string,
  englishHeading: string,
): string => {
  const split: (text: string) => Array<string> = (
    text: string,
  ): Array<string> => {
    return text.split(/^(?=## )/m);
  };

  const englishSections: Array<string> = split(
    readPage(DEFAULT_DOCS_LANGUAGE, page),
  );
  const index: number = englishSections.findIndex((body: string) => {
    return body.startsWith(`${englishHeading}\n`);
  });

  if (index < 0) {
    throw new Error(`English ${page} has no "${englishHeading}" section.`);
  }

  return split(readPage(language, page))[index] || "";
};

type LineFunction = (
  text: string,
  predicate: (line: string) => boolean,
) => string;

const lineWhere: LineFunction = (
  text: string,
  predicate: (line: string) => boolean,
): string => {
  return (
    text.split("\n").find((line: string) => {
      return predicate(line);
    }) || ""
  );
};

// Bold, as a label is written; a prefix, so an inflected Конструктора counts.
type BoldFunction = (word: string) => string;

const bold: BoldFunction = (word: string): string => {
  return `**${word}`;
};

describe("the suite reads the docs it claims to", () => {
  test("there are seventeen languages, English among them", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(LANGUAGES).toContain(DEFAULT_DOCS_LANGUAGE);
  });

  test.each(LANGUAGES)(
    "%s has every Dashboard word this reads for",
    (language: string) => {
      for (const [key, word] of Object.entries(dashboardWords(language))) {
        expect({ language, key, word: word.length > 0 }).toEqual({
          language,
          key,
          word: true,
        });
      }
    },
  );
});

describe("turning a workflow on, in every language", () => {
  test.each(LANGUAGES)(
    "%s no longer quotes the old refusal on any workflow page",
    (language: string) => {
      const pages: Array<string> = fs
        .readdirSync(path.join(CONTENT_DIR, language, "workflows"))
        .filter((file: string) => {
          return file.endsWith(".md");
        });

      expect(pages.length).toBeGreaterThan(3);

      for (const page of pages) {
        expect({
          page,
          quotesOldMessage: readPage(language, page).includes(
            "This workflow is not enabled",
          ),
        }).toEqual({ page, quotesOldMessage: false });
      }
    },
  );

  test.each(LANGUAGES)(
    "%s quotes the server's refusal exactly, as a webhook caller reads it",
    (language: string) => {
      // API answers are English everywhere, so every language quotes it so.
      expect(readPage(language, "authoring.md")).toContain(
        WORKFLOW_TURNED_OFF_MESSAGE,
      );
    },
  );

  test.each(LANGUAGES)(
    "%s puts the Enabled switch at the top of the Builder, with the notice and the dialog",
    (language: string) => {
      const words: DashboardWords = dashboardWords(language);
      const turningItOn: string = section(
        language,
        "authoring.md",
        "## Turning it on",
      );

      for (const word of [
        words.enabled,
        words.builder,
        words.turnOnWorkflow,
        words.turnOnThisWorkflow,
        words.turnOnAndRun,
        words.turnOnAndRunStep,
      ]) {
        expect({
          language,
          mentions: word,
          found: turningItOn.includes(bold(word)),
        }).toEqual({ language, mentions: word, found: true });
      }
    },
  );

  test.each(LANGUAGES)(
    "%s's first workflow turns the switch on in the Builder, not behind Overview's Edit",
    (language: string) => {
      const words: DashboardWords = dashboardWords(language);
      const step: string = lineWhere(
        section(language, "authoring.md", "## Your first workflow"),
        (line: string) => {
          return line.startsWith("4. ");
        },
      );

      expect(step).toContain(bold(words.enabled));
      expect(step).not.toContain(bold(words.editWorkflow));
      expect(step).not.toContain(bold(words.overview));
    },
  );

  test.each(LANGUAGES)(
    "%s's overview page says to turn it on in the Builder",
    (language: string) => {
      const words: DashboardWords = dashboardWords(language);
      const step: string = lineWhere(
        readPage(language, "index.md"),
        (line: string) => {
          return line.startsWith("4. ") && line.includes(bold(words.enabled));
        },
      );

      expect(step).toContain(bold(words.builder));
      expect(step).not.toContain(bold(words.overview));
    },
  );

  test.each(LANGUAGES)(
    "%s's configuration page no longer puts the switch in Settings, and tests with Turn on and run",
    (language: string) => {
      const words: DashboardWords = dashboardWords(language);
      const onOrOff: string = section(
        language,
        "configuration.md",
        "## Turning a workflow on or off",
      );
      const firstParagraph: string = lineWhere(onOrOff, (line: string) => {
        return line.includes(bold(words.enabled));
      });

      expect(firstParagraph).toContain(bold(words.builder));
      expect(firstParagraph).not.toContain(`**${words.settings}**`);
      expect(onOrOff).toContain(`**${words.turnOnAndRun}**`);
    },
  );

  test.each(LANGUAGES)(
    "%s's troubleshooting points at the switch in the Builder",
    (language: string) => {
      const words: DashboardWords = dashboardWords(language);
      const step: string = lineWhere(
        readPage(language, "runs-and-logs.md"),
        (line: string) => {
          return line.startsWith("1. ") && line.includes(bold(words.enabled));
        },
      );

      expect(step).toContain(bold(words.builder));
      expect(step).toContain("HTTP 400");
    },
  );
});

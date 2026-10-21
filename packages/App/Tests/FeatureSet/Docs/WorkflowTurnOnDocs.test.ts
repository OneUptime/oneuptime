import {
  DEFAULT_DOCS_LANGUAGE,
  SUPPORTED_DOCS_LANGUAGE_CODES,
} from "../../../FeatureSet/Docs/Utils/I18n";
import { WORKFLOW_TURNED_OFF_MESSAGE } from "Common/Types/Workflow/WorkflowEnabled";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Testing a workflow while it is off, and turning it on, as the docs describe
 * it, in all seventeen languages.
 *
 * "Run - Why do I have to enable a workflow in order to test run it? Can you
 * please fix it?" - the maintainer. The pages used to say a workflow that is
 * off can't run at all, not even by hand, and that Run Workflow asks "Turn on
 * this workflow?" first. Off now pauses the workflow's trigger, not a person
 * testing it: Run Workflow and Run just this step run it as a test run, and
 * the pages say so - build it, test it while it is off, then turn it on.
 *
 * Every language's pages have to say so in that language's own Dashboard
 * words (Aktiviert, 有効, Testlauf, テスト実行...), or they point at controls
 * nobody can find. Most of these pages nobody on the team can proofread, so
 * this reads all of them.
 */

const DOCS_DIR: string = path.resolve(__dirname, "../../../FeatureSet/Docs");
const CONTENT_DIR: string = path.join(DOCS_DIR, "Content");
const DASHBOARD_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

/*
 * Only the English pages name the Dashboard's labels in English. The Persian
 * workflow pages name them as the Persian Dashboard draws them (فعال,
 * سازنده...), like the on-call and runbook pages
 * (WorkflowDocsTranslations).
 */
const ENGLISH_UI_LABELS: Set<string> = new Set(["en"]);

interface DashboardWords {
  enabled: string;
  builder: string;
  overview: string;
  editWorkflow: string;
  settings: string;
  turnOnWorkflow: string;
  runWorkflow: string;
  runJustThisStep: string;
  testRun: string;
}

const ENGLISH_WORDS: DashboardWords = {
  enabled: "Enabled",
  builder: "Builder",
  overview: "Overview",
  editWorkflow: "Edit Workflow",
  settings: "Settings",
  turnOnWorkflow: "Turn on workflow",
  runWorkflow: "Run Workflow",
  runJustThisStep: "Run just this step",
  testRun: "Test run",
};

/*
 * The dialog that used to ask to turn the workflow on before Run Workflow
 * would go, as each language's Dashboard drew it. Its strings are gone from
 * the locale files, so they are spelled out here.
 */
const RETIRED_DIALOG_LABELS: Record<string, Array<string>> = {
  en: ["Turn on this workflow?", "Turn on and run", "Turn on and run step"],
  de: [
    "Diesen Arbeitsablauf einschalten?",
    "Einschalten und ausführen",
    "Einschalten und Schritt ausführen",
  ],
  fr: [
    "Activer ce flux de travail ?",
    "Activer et exécuter",
    "Activer et exécuter l'étape",
  ],
  es: [
    "¿Activar este flujo de trabajo?",
    "Activar y ejecutar",
    "Activar y ejecutar paso",
  ],
  it: [
    "Attivare questo flusso di lavoro?",
    "Attiva ed esegui",
    "Attiva ed esegui il passaggio",
  ],
  pt: [
    "Ativar este fluxo de trabalho?",
    "Ativar e executar",
    "Ativar e executar etapa",
  ],
  nl: [
    "Deze workflow inschakelen?",
    "Inschakelen en uitvoeren",
    "Inschakelen en stap uitvoeren",
  ],
  da: ["Slå denne arbejdsgang til?", "Slå til og kør", "Slå til og kør trin"],
  no: ["Slå på denne arbeidsflyten?", "Slå på og kjør", "Slå på og kjør trinn"],
  sv: [
    "Slå på det här arbetsflödet?",
    "Slå på och kör",
    "Slå på och kör steget",
  ],
  ru: [
    "Включить этот рабочий процесс?",
    "Включить и запустить",
    "Включить и выполнить шаг",
  ],
  ja: [
    "このワークフローをオンにしますか？",
    "オンにして実行",
    "オンにしてステップを実行",
  ],
  ko: ["이 워크플로를 켜시겠습니까?", "켜고 실행", "켜고 단계 실행"],
  "zh-CN": ["开启此工作流？", "开启并运行", "开启并运行步骤"],
  "zh-TW": ["開啟此工作流程？", "開啟並執行", "開啟並執行步驟"],
  hi: [
    "यह वर्कफ़्लो चालू करें?",
    "चालू करें और चलाएं",
    "चालू करें और चरण चलाएं",
  ],
  fa: [
    "این گردش کاری روشن شود؟",
    "روشن کردن و اجرا",
    "روشن کردن و اجرای مرحله",
  ],
};

// The refusals the server used to give, which no page may quote any more.
const RETIRED_REFUSALS: Array<string> = [
  "This workflow is not enabled",
  "This workflow is turned off, so it can't run.",
];

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

type WorkflowPagesFunction = (language: string) => Array<string>;

const workflowPages: WorkflowPagesFunction = (
  language: string,
): Array<string> => {
  return fs
    .readdirSync(path.join(CONTENT_DIR, language, "workflows"))
    .filter((file: string) => {
      return file.endsWith(".md");
    });
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

type LinesFunction = (
  text: string,
  predicate: (line: string) => boolean,
) => Array<string>;

const linesWhere: LinesFunction = (
  text: string,
  predicate: (line: string) => boolean,
): Array<string> => {
  return text.split("\n").filter((line: string) => {
    return predicate(line);
  });
};

type LineFunction = (
  text: string,
  predicate: (line: string) => boolean,
) => string;

const lineWhere: LineFunction = (
  text: string,
  predicate: (line: string) => boolean,
): string => {
  return linesWhere(text, predicate)[0] || "";
};

// Bold, as a label is written; a prefix, so an inflected Конструктора counts.
type BoldFunction = (word: string) => string;

const bold: BoldFunction = (word: string): string => {
  return `**${word}`;
};

const NUMBERED_STEP: RegExp = /^\d+\. /;

// What the pages used to say about a workflow that is off, in English.
const CANT_RUN_BY_HAND: RegExp =
  /not even by hand|can'?t (?:be )?run[^.]*by hand|cannot run[^.]*by hand/;

describe("the suite reads the docs it claims to", () => {
  test("there are seventeen languages, English among them", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(LANGUAGES).toContain(DEFAULT_DOCS_LANGUAGE);
    expect(Object.keys(RETIRED_DIALOG_LABELS).sort()).toEqual(
      [...LANGUAGES].sort(),
    );
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

  test.each(
    LANGUAGES.filter((language: string) => {
      return !ENGLISH_UI_LABELS.has(language);
    }),
  )(
    "%s's Dashboard has a word of its own for a test run",
    (language: string) => {
      expect(dashboardWords(language).testRun).not.toBe("Test run");
    },
  );
});

describe("testing a workflow while it is off, in every language", () => {
  test.each(LANGUAGES)(
    "%s no longer quotes a refusal the server stopped giving, on any workflow page",
    (language: string) => {
      const pages: Array<string> = workflowPages(language);

      expect(pages.length).toBeGreaterThan(3);

      for (const page of pages) {
        for (const refusal of RETIRED_REFUSALS) {
          expect({
            page,
            refusal,
            quoted: readPage(language, page).includes(refusal),
          }).toEqual({ page, refusal, quoted: false });
        }
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
    "%s no longer names the dialog that asked to turn the workflow on first",
    (language: string) => {
      const retired: Array<string> = [
        ...(RETIRED_DIALOG_LABELS["en"] as Array<string>),
        ...(RETIRED_DIALOG_LABELS[language] || []),
      ];

      for (const page of workflowPages(language)) {
        const text: string = readPage(language, page);

        for (const label of retired) {
          expect({ page, label, named: text.includes(`**${label}**`) }).toEqual(
            { page, label, named: false },
          );
        }
      }
    },
  );

  test.each(LANGUAGES)(
    "%s's Turning it on section: the switch at the top of the Builder, the notice, and Run Workflow as a test run",
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
        words.runWorkflow,
        words.runJustThisStep,
        words.testRun,
      ]) {
        expect({
          language,
          mentions: word,
          found: turningItOn.includes(bold(word)),
        }).toEqual({ language, mentions: word, found: true });
      }

      // The table's Run Workflow row says it runs, as a test run.
      const runRow: string = lineWhere(turningItOn, (line: string) => {
        return line.startsWith(`| **${words.runWorkflow}**`);
      });

      expect(runRow).toContain(`**${words.testRun}**`);
    },
  );

  test.each(LANGUAGES)(
    "%s's first workflow runs it without turning it on, and says the run is a test run",
    (language: string) => {
      const words: DashboardWords = dashboardWords(language);
      const firstWorkflow: string = section(
        language,
        "authoring.md",
        "## Your first workflow",
      );
      const steps: Array<string> = linesWhere(firstWorkflow, (line: string) => {
        return NUMBERED_STEP.test(line);
      });

      expect(steps).toHaveLength(5);

      const run: string = steps[3] || "";

      expect(run.startsWith("4. ")).toBe(true);
      expect(run).toContain(bold(words.runWorkflow));
      expect(run).toContain(bold(words.testRun));

      // No step turns the workflow on, here or behind Overview's Edit.
      for (const step of steps) {
        expect({ step, turnsItOn: step.includes(bold(words.enabled)) }).toEqual(
          { step, turnsItOn: false },
        );
        expect(step).not.toContain(bold(words.editWorkflow));
      }

      // The run it opens says it is a test run.
      expect(steps[4]).toContain(bold(words.testRun));
    },
  );

  test.each(LANGUAGES)(
    "%s's overview page tests with Run Workflow before it turns the workflow on in the Builder",
    (language: string) => {
      const words: DashboardWords = dashboardWords(language);
      const page: string = readPage(language, "index.md");
      const test: string = lineWhere(page, (line: string) => {
        return line.startsWith("4. ") && line.includes(bold(words.runWorkflow));
      });
      const turnOn: string = lineWhere(page, (line: string) => {
        return line.startsWith("5. ") && line.includes(bold(words.enabled));
      });

      expect(test).toContain(bold(words.testRun));
      expect(turnOn).toContain(bold(words.builder));
      expect(turnOn).not.toContain(bold(words.overview));
    },
  );

  test.each(LANGUAGES)(
    "%s's worked example tests the workflow while it is off, and turns it on last",
    (language: string) => {
      const words: DashboardWords = dashboardWords(language);
      const example: Array<string> = section(
        language,
        "index.md",
        "## Example: send new incidents to a webhook",
      ).split("\n");

      const closing: number = example.lastIndexOf(":::");
      const lastStep: Array<string> = example
        .slice(0, closing)
        .filter((line: string) => {
          return line.trim().length > 0;
        });
      const testRun: number = example.findIndex((line: string) => {
        return line.includes(bold(words.testRun));
      });

      expect(closing).toBeGreaterThan(0);
      // The example's last step switches the workflow on...
      expect(lastStep[lastStep.length - 1]).toContain(bold(words.enabled));
      expect(lastStep[lastStep.length - 2]?.startsWith("### ")).toBe(true);
      // ...after the step that tests it, as a test run.
      expect(testRun).toBeGreaterThan(-1);
      expect(testRun).toBeLessThan(closing);
    },
  );

  test.each(LANGUAGES)(
    "%s's configuration page: the switch in the Builder, not Settings, and testing as a test run before going live",
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
      const testStep: string = lineWhere(onOrOff, (line: string) => {
        return line.startsWith("2. ");
      });

      expect(firstParagraph).toContain(bold(words.builder));
      expect(firstParagraph).not.toContain(`**${words.settings}**`);
      expect(firstParagraph).toContain(bold(words.testRun));
      expect(testStep).toContain(bold(words.runWorkflow));
      expect(testStep).toContain(bold(words.testRun));
    },
  );

  test.each(LANGUAGES)(
    "%s's troubleshooting points at the switch in the Builder, and at Run Workflow",
    (language: string) => {
      const words: DashboardWords = dashboardWords(language);
      const step: string = lineWhere(
        readPage(language, "runs-and-logs.md"),
        (line: string) => {
          return line.startsWith("1. ") && line.includes(bold(words.enabled));
        },
      );

      expect(step).toContain(bold(words.builder));
      expect(step).toContain(bold(words.runWorkflow));
      expect(step).toContain("HTTP 400");
    },
  );

  test.each(LANGUAGES)(
    "%s's runs page says how a test run reads, among the runs that read differently",
    (language: string) => {
      const words: DashboardWords = dashboardWords(language);
      const item: string = lineWhere(
        readPage(language, "runs-and-logs.md"),
        (line: string) => {
          return line.startsWith("- **") && line.includes(bold(words.testRun));
        },
      );

      expect(item).toContain(bold(words.runWorkflow));
      expect(item).toContain(bold(words.runJustThisStep));
    },
  );
});

describe("the English pages", () => {
  test("no page says a workflow that is off can't run even by hand", () => {
    for (const page of workflowPages("en")) {
      expect({
        page,
        says: CANT_RUN_BY_HAND.test(readPage("en", page)),
      }).toEqual({ page, says: false });
    }

    const jira: string = fs.readFileSync(
      path.join(CONTENT_DIR, "en", "integrations", "jira.md"),
      "utf8",
    );

    expect(CANT_RUN_BY_HAND.test(jira)).toBe(false);

    // And the check does catch what the pages used to say.
    for (const old of [
      "A disabled workflow can't run at all, not even by hand.",
      "A disabled workflow can't be run at all, not even by hand;",
      "a disabled workflow cannot run at all, not even by hand.",
    ]) {
      expect(CANT_RUN_BY_HAND.test(old)).toBe(true);
    }
  });

  test("the create dialog's note is quoted where the page describes it", () => {
    expect(readPage("en", "authoring.md")).toContain(
      "Workflows are created switched off, so their trigger doesn't start them until you turn them on.",
    );
  });
});

import {
  PROJECT_AI_RUN_LIMIT_FIELDS,
  PROJECT_AI_RUN_LIMITS_FORM_STEPS,
  ProjectAiDailyLimitsCopy,
  ProjectAiRunLimitField,
  ProjectAiRunLimitsCopy,
  ProjectAiRunLimitsFormStep,
} from "../../FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import {
  ExtractedString,
  scanSourceRoots,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  LOCALES_DIRECTORY,
  TRANSLATED_LOCALES,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import { DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES } from "Common/Types/AI/AIAgentRunLimits";
import {
  PROJECT_AI_RUN_LIMIT_COLUMNS,
  ProjectAiRunLimitColumn,
} from "Common/Types/AI/ProjectAiRunLimits";
import Project from "Common/Models/DatabaseModels/Project";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE LIMITS PER RUN IN THE READER'S LANGUAGE (issue #6440: "Why is there a
 * budget? Can we remove all of the artificial limits by default, customers
 * can add them if they need it").
 *
 * A OneUptime AI run is limited only by its time limit unless the project
 * sets a limit of its own, on one card: Project Settings → AI → AI Features
 * → More settings → Limits per run. Its words, the More settings line that
 * now names it, and the incident and alert AI pages' time limit - whose
 * empty value is the project's time limit per run, no longer "No time
 * limit" - are worded in each of the seventeen languages besides English:
 * every placeholder kept, and the default time limit named as runs have
 * it.
 */

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const ENGLISH: Record<string, unknown> = readLocale("en");

// The incident and alert AI pages, written on the pages themselves.
const LANE_WORDS: ReadonlyArray<string> = [
  "Investigations start right away and run until they are done, within the project's time limit per run, unless you set a limit here.",
  "Stop an incident investigation after this many minutes and report what it found. Leave empty to use the project's time limit per run: 120 minutes, unless the project set its own.",
  "Stop an alert investigation after this many minutes and report what it found. Leave empty to use the project's time limit per run: 120 minutes, unless the project set its own.",
  "The project's time limit",
];

// Every sentence this change wrote, each once.
const WORDS: ReadonlyArray<string> = Array.from(
  new Set<string>([
    ProjectAiDailyLimitsCopy.sectionDescription,
    ProjectAiRunLimitsCopy.cardTitle,
    ProjectAiRunLimitsCopy.cardDescription,
    ProjectAiRunLimitsCopy.defaultTimeLimitPlaceholder,
    ProjectAiRunLimitsCopy.timeLimitFieldError,
    ...PROJECT_AI_RUN_LIMIT_FIELDS.flatMap(
      (field: ProjectAiRunLimitField): Array<string> => {
        return [field.title, field.description];
      },
    ),
    // The edit dialog's step list.
    ...PROJECT_AI_RUN_LIMITS_FORM_STEPS.map(
      (step: ProjectAiRunLimitsFormStep): string => {
        return step.title;
      },
    ),
    ...LANE_WORDS,
  ]),
);

// The words they replaced, which no locale keeps.
const RETIRED: ReadonlyArray<string> = [
  "Limits on how much OneUptime AI uses across the whole project each day, and how many people approve its riskier fixes.",
  "Investigations start right away and run until they are done unless you set a limit here.",
  "Stop an incident investigation after this many minutes and report what it found. Leave empty for no limit.",
  "Stop an alert investigation after this many minutes and report what it found. Leave empty for no limit.",
  "No time limit",
  /*
   * The lane pages' first wording of their empty time limit, whose "it"
   * could be read as the investigation: "the project set its own" now.
   */
  "Stop an incident investigation after this many minutes and report what it found. Leave empty for the project's time limit per run, 120 minutes unless it set its own.",
  "Stop an alert investigation after this many minutes and report what it found. Leave empty for the project's time limit per run, 120 minutes unless it set its own.",
];

const PLACEHOLDER: RegExp = /\{\{\s*[\w.]+\s*\}\}/g;
const BUDGET_WORD: RegExp = /budget/i;

function placeholdersOf(text: string): Array<string> {
  return Array.from(new Set(text.match(PLACEHOLDER) || [])).sort();
}

// A number as a language writes it: Persian with its own digits.
function digitsIn(language: string, value: number): string {
  if (language !== "fa") {
    return String(value);
  }

  return String(value).replace(/\d/g, (digit: string): string => {
    return String.fromCharCode(0x06f0 + Number(digit));
  });
}

describe("the limits per run in every language", () => {
  test("the words are the card's, its dialog's steps, the More settings line's and the lane pages'", () => {
    expect(WORDS.length).toBe(19);
    expect(WORDS).toContain("Limits per run");
    expect(WORDS).toContain("Time Limit per Run (Minutes)");
    expect(WORDS).toContain("120 minutes (the default)");
    expect(WORDS).toContain("Calls and Tokens");
    expect(WORDS).toContain("Time Limit");
  });

  test("en.json maps every one of them to itself", () => {
    for (const text of WORDS) {
      expect([text, ENGLISH[text]]).toEqual([text, text]);
    }
  });

  /*
   * The extractor finds each where the pages write it, so `npm run
   * i18n:check` counts it: a sentence it could not see would never be
   * translated again when it changes.
   */
  test("the extractor finds every one of them in the pages that draw them", () => {
    const found: Set<string> = new Set<string>(
      scanSourceRoots([
        {
          directory:
            "packages/App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy.ts",
          kind: "ui",
        },
        {
          directory:
            "packages/App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentAISettings.tsx",
          kind: "ui",
        },
        {
          directory:
            "packages/App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertAISettings.tsx",
          kind: "ui",
        },
      ]).strings.map((entry: ExtractedString): string => {
        return entry.text;
      }),
    );

    expect(
      WORDS.filter((text: string): boolean => {
        return !found.has(text);
      }),
    ).toEqual([]);
  });

  test("the words they replaced are gone from every locale", () => {
    for (const language of ["en", ...TRANSLATED_LOCALES]) {
      const locale: Record<string, unknown> = readLocale(language);

      expect({
        language,
        kept: RETIRED.filter((text: string): boolean => {
          return text in locale;
        }),
      }).toEqual({ language, kept: [] });
    }
  });

  test.each(TRANSLATED_LOCALES)(
    "%s has its own words for every one of them",
    (language: string) => {
      const locale: Record<string, unknown> = readLocale(language);

      for (const text of WORDS) {
        const value: unknown = locale[text];

        expect([text, typeof value]).toEqual([text, "string"]);
        expect([text, (value as string).trim().length > 0]).toEqual([
          text,
          true,
        ]);
        expect([text, value]).not.toEqual([text, text]);
      }
    },
  );

  test.each(TRANSLATED_LOCALES)(
    "%s keeps every placeholder of the field error",
    (language: string) => {
      const locale: Record<string, unknown> = readLocale(language);

      for (const text of WORDS) {
        expect([text, placeholdersOf(locale[text] as string)]).toEqual([
          text,
          placeholdersOf(text),
        ]);
      }
      expect(
        placeholdersOf(ProjectAiRunLimitsCopy.timeLimitFieldError),
      ).toEqual(["{{field}}", "{{max}}", "{{min}}"]);
    },
  );

  /*
   * Where English names the default time limit, every language names the
   * same number of minutes: the one runs have. Were the default changed,
   * this fails until each sentence says the new number.
   */
  test.each(TRANSLATED_LOCALES)(
    "%s names the default time limit as runs have it",
    (language: string) => {
      const locale: Record<string, unknown> = readLocale(language);
      const naming: Array<string> = WORDS.filter((text: string): boolean => {
        return text.includes(`${DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES} minutes`);
      });

      // The card, its placeholder, its time field and both lane fields.
      expect(naming.length).toBe(5);

      for (const text of naming) {
        expect([
          text,
          (locale[text] as string).includes(
            digitsIn(language, DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES),
          ),
        ]).toEqual([text, true]);
      }
    },
  );

  test("Persian writes the minutes in its own digits, Arabic and German in Latin ones", () => {
    expect(
      readLocale("fa")[ProjectAiRunLimitsCopy.defaultTimeLimitPlaceholder],
    ).toBe("۱۲۰ دقیقه (پیش‌فرض)");
    // Arabic in OneUptime writes Latin digits (Locales/ARABIC.md).
    expect(
      readLocale("ar")[ProjectAiRunLimitsCopy.defaultTimeLimitPlaceholder],
    ).toBe("120 دقيقة (القيمة الافتراضية)");
    expect(
      readLocale("de")[ProjectAiRunLimitsCopy.defaultTimeLimitPlaceholder],
    ).toBe("120 Minuten (Standard)");
  });

  /*
   * Arabic arrived after these words were written, as the eighteenth
   * language. Its incident and alert AI pages were already in Arabic, so the
   * words that replaced theirs are Arabic too, in its glossary's terms
   * (التحقيق, المهلة الزمنية, الرموز): no English line among Arabic ones.
   */
  test("Arabic is one of the languages, with its own words for the lane pages", () => {
    expect(TRANSLATED_LOCALES).toContain("ar");

    const arabic: Record<string, unknown> = readLocale("ar");

    expect(arabic["The project's time limit"]).toBe("المهلة الزمنية للمشروع");
    expect(arabic[ProjectAiRunLimitsCopy.cardTitle]).toBe("الحدود لكل تشغيل");
    expect(arabic[ProjectAiRunLimitsCopy.timeLimitFieldError]).toBe(
      "يجب أن تكون قيمة «{{field}}» عددًا صحيحًا من {{min}} إلى {{max}}. اترك الحقل فارغًا لاستخدام القيمة الافتراضية.",
    );

    for (const text of LANE_WORDS.slice(1, 3)) {
      expect([text, arabic[text]]).toEqual([
        text,
        expect.stringContaining("120 دقيقة، ما لم يضبط المشروع مهلة خاصة به."),
      ]);
    }
  });

  test("no language speaks of a budget where English does not", () => {
    for (const text of WORDS) {
      expect(text).not.toMatch(/budget/i);
    }
    for (const language of TRANSLATED_LOCALES) {
      const locale: Record<string, unknown> = readLocale(language);

      for (const text of WORDS) {
        expect([
          language,
          text,
          BUDGET_WORD.test(String(locale[text])),
        ]).toEqual([language, text, false]);
      }
    }
  });
});

/*
 * THE PROJECT'S COLUMNS OF THE LIMITS PER RUN (issue #6511). The four
 * limits are columns of the Project, and wherever the Dashboard names a
 * Project column by its title - a table, a filter, what an audit says
 * changed - it draws the title in the reader's language. Each language
 * words a title as its card words the field above, with the word for AI it
 * names AI Features with added to the run: the card and the column never
 * disagree.
 */
interface AiRunWords {
  // The language's word for AI, as it names AI Features.
  ai: string;
  // What it adds to the card's word for a run, to make it an AI run.
  added: string;
}

const AI_RUN_WORDS: Record<string, AiRunWords> = {
  ar: { ai: "الذكاء الاصطناعي", added: " للذكاء الاصطناعي" },
  da: { ai: "AI", added: "AI-" },
  de: { ai: "KI", added: "KI-" },
  es: { ai: "IA", added: " de IA" },
  fa: { ai: "هوش مصنوعی", added: "ی هوش مصنوعی" },
  fr: { ai: "IA", added: " IA" },
  hi: { ai: "AI", added: "AI " },
  it: { ai: "IA", added: " IA" },
  ja: { ai: "AI", added: "AI " },
  ko: { ai: "AI", added: "AI " },
  nl: { ai: "AI", added: "AI-" },
  no: { ai: "AI", added: "AI-" },
  pt: { ai: "IA", added: " de IA" },
  ru: { ai: "ИИ", added: " ИИ" },
  sv: { ai: "AI", added: "AI-" },
  "zh-CN": { ai: "AI", added: " AI " },
  "zh-TW": { ai: "AI", added: " AI " },
};

function columnTitle(column: ProjectAiRunLimitColumn): string {
  return new Project().getTableColumnMetadata(column).title as string;
}

function occurrencesOf(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe("the Project's columns of the limits per run, in every language", () => {
  const TITLES: Array<string> = PROJECT_AI_RUN_LIMIT_COLUMNS.map(columnTitle);

  test("the four columns are titled as an AI run's limits, each with its card field", () => {
    expect(TITLES).toEqual([
      "Model Calls per AI Run",
      "Tool Calls per AI Run",
      "Tokens per AI Run",
      "AI Run Time Limit (Minutes)",
    ]);
    expect(
      PROJECT_AI_RUN_LIMIT_FIELDS.map(
        (field: ProjectAiRunLimitField): ProjectAiRunLimitColumn => {
          return field.column;
        },
      ),
    ).toEqual([...PROJECT_AI_RUN_LIMIT_COLUMNS]);
  });

  test("en.json maps each title to itself, and the extractor finds it in the Project model", () => {
    const found: Set<string> = new Set<string>(
      scanSourceRoots([
        {
          directory: "packages/Common/Models/DatabaseModels/Project.ts",
          kind: "models",
        },
      ]).strings.map((entry: ExtractedString): string => {
        return entry.text;
      }),
    );

    for (const title of TITLES) {
      expect([title, ENGLISH[title]]).toEqual([title, title]);
      expect([title, found.has(title)]).toEqual([title, true]);
    }
  });

  test("every language besides English has its words for an AI run", () => {
    expect(Object.keys(AI_RUN_WORDS).sort()).toEqual(
      [...TRANSLATED_LOCALES].sort(),
    );
  });

  test.each(TRANSLATED_LOCALES)(
    "%s titles each column as its card words the field, the run an AI run",
    (language: string) => {
      const locale: Record<string, unknown> = readLocale(language);
      const words: AiRunWords = AI_RUN_WORDS[language]!;

      /*
       * The word for AI is the one the language names AI Features with.
       * Arabic's "ل" (for) takes the article's alef: ل + الذكاء is للذكاء.
       */
      expect(words.added.replace("للذكاء", "الذكاء")).toContain(words.ai);
      expect(String(locale["AI Features"])).toContain(words.ai);

      for (const field of PROJECT_AI_RUN_LIMIT_FIELDS) {
        const title: string = columnTitle(field.column);
        const worded: unknown = locale[title];
        const card: unknown = locale[field.title];

        expect([title, typeof worded]).toEqual([title, "string"]);
        expect([title, worded]).not.toEqual([title, title]);
        expect([title, typeof card]).toEqual([title, "string"]);
        expect([title, occurrencesOf(worded as string, words.added)]).toEqual([
          title,
          1,
        ]);
        expect([title, (worded as string).replace(words.added, "")]).toEqual([
          title,
          card,
        ]);
      }
    },
  );

  test("Arabic and German, word for word", () => {
    expect(
      TITLES.map((title: string): unknown => {
        return readLocale("ar")[title];
      }),
    ).toEqual([
      "استدعاءات النموذج لكل تشغيل للذكاء الاصطناعي",
      "استدعاءات الأدوات لكل تشغيل للذكاء الاصطناعي",
      "الرموز لكل تشغيل للذكاء الاصطناعي",
      "المهلة الزمنية لكل تشغيل للذكاء الاصطناعي (بالدقائق)",
    ]);
    expect(
      TITLES.map((title: string): unknown => {
        return readLocale("de")[title];
      }),
    ).toEqual([
      "Modellaufrufe pro KI-Ausführung",
      "Tool-Aufrufe pro KI-Ausführung",
      "Tokens pro KI-Ausführung",
      "Zeitlimit pro KI-Ausführung (Minuten)",
    ]);
  });
});

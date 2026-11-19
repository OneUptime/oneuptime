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
import {
  DEFAULT_AI_RUN_COMMAND_TIME_LIMIT_IN_MINUTES,
  DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES,
  MAX_AI_RUN_COMMAND_TIME_LIMIT_IN_MINUTES,
} from "Common/Types/AI/AIAgentRunLimits";
import {
  PROJECT_AI_RUN_COMMAND_TIME_LIMIT_COLUMN,
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
  "An incident investigation stops after this many minutes and reports what it found. Leave empty for the project's time limit: 120 minutes by default.",
  "An alert investigation stops after this many minutes and reports what it found. Leave empty for the project's time limit: 120 minutes by default.",
  "The project's time limit",
];

// Every sentence this change wrote, each once.
const WORDS: ReadonlyArray<string> = Array.from(
  new Set<string>([
    ProjectAiDailyLimitsCopy.sectionDescription,
    ProjectAiRunLimitsCopy.cardTitle,
    ProjectAiRunLimitsCopy.cardDescription,
    ProjectAiRunLimitsCopy.defaultTimeLimitPlaceholder,
    ProjectAiRunLimitsCopy.defaultCommandTimeLimitPlaceholder,
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
  /*
   * Their next wording, and the card's and the time field's first, each
   * longer than a description may be (ShortDescriptionsGuard).
   */
  "Stop an incident investigation after this many minutes and report what it found. Leave empty to use the project's time limit per run: 120 minutes, unless the project set its own.",
  "Stop an alert investigation after this many minutes and report what it found. Leave empty to use the project's time limit per run: 120 minutes, unless the project set its own.",
  "How far one OneUptime AI run may go: an investigation, an Ask AI or chat answer, a triage, a fix or a code task. With nothing set, a run makes as many calls as its work needs, for up to 120 minutes. A run that reaches a limit answers with what it found, and says which limit stopped it.",
  "How long one run may take before it answers with what it found. Leave empty for the default, 120 minutes. An incident or alert investigation time limit, where one is set, comes first.",
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
    expect(WORDS.length).toBe(22);
    expect(WORDS).toContain("Limits per run");
    expect(WORDS).toContain("Time Limit per Run (Minutes)");
    expect(WORDS).toContain("120 minutes (the default)");
    expect(WORDS).toContain("Calls and Tokens");
    // The second step holds the run's time limit and a command's (issue #6532).
    expect(WORDS).toContain("Time Limits");
    expect(WORDS).toContain("Time Limit per Command (Minutes)");
    expect(WORDS).toContain("10 minutes (the default)");
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
   * this fails until each sentence says the new number. (The time limit
   * per command's ceiling is 120 minutes too, and its field names it.)
   */
  test.each(TRANSLATED_LOCALES)(
    "%s names the default time limit as runs have it",
    (language: string) => {
      const locale: Record<string, unknown> = readLocale(language);
      const naming: Array<string> = WORDS.filter((text: string): boolean => {
        return text.includes(`${DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES} minutes`);
      });

      // The card, its placeholder, its time field, both lane fields, and the command field's ceiling.
      expect(MAX_AI_RUN_COMMAND_TIME_LIMIT_IN_MINUTES).toBe(
        DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES,
      );
      expect(naming.length).toBe(6);

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

  /*
   * The time limit per command (issue #6532): its field and placeholder
   * name the default a command has, ten minutes, and the field the most a
   * project may give it, 120 - in every language, as each writes numbers.
   */
  test.each(TRANSLATED_LOCALES)(
    "%s names a command's default and its ceiling as the code has them",
    (language: string) => {
      const locale: Record<string, unknown> = readLocale(language);
      const field: ProjectAiRunLimitField = PROJECT_AI_RUN_LIMIT_FIELDS.find(
        (candidate: ProjectAiRunLimitField): boolean => {
          return candidate.column === PROJECT_AI_RUN_COMMAND_TIME_LIMIT_COLUMN;
        },
      )!;

      expect(field.description).toContain(
        `at most ${MAX_AI_RUN_COMMAND_TIME_LIMIT_IN_MINUTES} minutes`,
      );
      expect(field.description).toContain(
        `the default, ${DEFAULT_AI_RUN_COMMAND_TIME_LIMIT_IN_MINUTES} minutes`,
      );
      expect(
        ProjectAiRunLimitsCopy.defaultCommandTimeLimitPlaceholder,
      ).toContain(`${DEFAULT_AI_RUN_COMMAND_TIME_LIMIT_IN_MINUTES} minutes`);

      const description: string = locale[field.description] as string;
      const placeholder: string = locale[
        ProjectAiRunLimitsCopy.defaultCommandTimeLimitPlaceholder
      ] as string;

      expect([language, description]).toEqual([
        language,
        expect.stringContaining(
          digitsIn(language, MAX_AI_RUN_COMMAND_TIME_LIMIT_IN_MINUTES),
        ),
      ]);
      expect([language, description]).toEqual([
        language,
        expect.stringContaining(
          digitsIn(language, DEFAULT_AI_RUN_COMMAND_TIME_LIMIT_IN_MINUTES),
        ),
      ]);
      expect([language, placeholder]).toEqual([
        language,
        expect.stringContaining(
          digitsIn(language, DEFAULT_AI_RUN_COMMAND_TIME_LIMIT_IN_MINUTES),
        ),
      ]);
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
        expect.stringContaining("المهلة الزمنية للمشروع: 120 دقيقة افتراضيًا."),
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

// The four limits on a run, whose columns name an AI run.
const RUN_LIMIT_FIELDS: ReadonlyArray<ProjectAiRunLimitField> =
  PROJECT_AI_RUN_LIMIT_FIELDS.filter(
    (field: ProjectAiRunLimitField): boolean => {
      return field.column !== PROJECT_AI_RUN_COMMAND_TIME_LIMIT_COLUMN;
    },
  );

function columnTitle(column: ProjectAiRunLimitColumn): string {
  return new Project().getTableColumnMetadata(column).title as string;
}

function occurrencesOf(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe("the Project's columns of the limits per run, in every language", () => {
  const TITLES: Array<string> = PROJECT_AI_RUN_LIMIT_COLUMNS.map(columnTitle);

  test("the four columns are titled as an AI run's limits, each with its card field, and the command's as an AI command's", () => {
    expect(TITLES).toEqual([
      "Model Calls per AI Run",
      "Tool Calls per AI Run",
      "Tokens per AI Run",
      "AI Run Time Limit (Minutes)",
      "AI Command Time Limit (Minutes)",
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

      // The four run limits; the command's is held below.
      for (const field of RUN_LIMIT_FIELDS) {
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

  /*
   * The time limit per command (issue #6532) is a command's, not a run's:
   * its column names the language's word for AI with the card's field, in
   * the order that language puts them - Persian's command takes no ezafe
   * "ی", so it is not the run's pattern there.
   */
  test.each(TRANSLATED_LOCALES)(
    "%s titles the time limit per command as an AI command's",
    (language: string) => {
      const locale: Record<string, unknown> = readLocale(language);
      const words: AiRunWords = AI_RUN_WORDS[language]!;
      const title: string = columnTitle(
        PROJECT_AI_RUN_COMMAND_TIME_LIMIT_COLUMN,
      );
      const worded: unknown = locale[title];
      const card: unknown =
        locale[
          PROJECT_AI_RUN_LIMIT_FIELDS.find(
            (field: ProjectAiRunLimitField): boolean => {
              return field.column === PROJECT_AI_RUN_COMMAND_TIME_LIMIT_COLUMN;
            },
          )!.title
        ];

      expect([language, typeof worded]).toEqual([language, "string"]);
      expect([language, worded]).not.toEqual([language, title]);
      expect([language, worded]).not.toEqual([language, card]);
      // Arabic's "ل" (for) takes the article's alef, as above.
      expect([
        language,
        (worded as string).replace("للذكاء", "الذكاء").includes(words.ai),
      ]).toEqual([language, true]);
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
      "المهلة الزمنية لكل أمر للذكاء الاصطناعي (بالدقائق)",
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
      "Zeitlimit pro KI-Befehl (Minuten)",
    ]);
  });
});

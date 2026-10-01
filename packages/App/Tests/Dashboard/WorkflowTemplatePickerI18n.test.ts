import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  WorkflowTemplateCategories,
  WorkflowTemplateCategory,
  getWorkflowTemplateCategoryInfo,
  getWorkflowTemplates,
} from "Common/Types/Workflow/Templates";
import {
  WorkflowTemplatePickerViewInfo,
  getWorkflowTemplatePickerViews,
} from "../../FeatureSet/Dashboard/src/Utils/Workflow/WorkflowTemplatePickerUtil";
import { workflowTemplateCountText } from "../../FeatureSet/Dashboard/src/Components/Workflow/WorkflowTemplatePicker";

/*
 * The workflow template picker looks every word it draws up in the Dashboard
 * locale files, by its English text, so a string it renders that no locale
 * carries stays English for everyone. This pins both halves: the strings the
 * picker translates, and a translation of each in all seventeen locales. It
 * also walks the picker's source for every literal it hands to translation,
 * so a new one cannot ship without being listed here.
 *
 * The templates themselves - their names, descriptions and settings - are
 * catalog content, written in English in Common like the builder's own
 * component names, and are not translated here.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const PICKER_PATH: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "Workflow",
  "WorkflowTemplatePicker.tsx",
);

const MODAL_PATH: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "Workflow",
  "CreateWorkflowModal.tsx",
);

/** Every string the picker translates that it writes out itself. */
const PICKER_STRINGS: Array<string> = [
  "Search templates…",
  "Clear search",
  "Start from scratch",
  "Template categories",
  "1 result",
  "{count} results",
  "1 block",
  "{count} blocks",
  "No templates match your search.",
  "Try other words, or start from scratch.",
  "Search all templates",
  "to move",
  "to use",
  "Back to templates",
  "How It Works",
  "Trigger",
  "Steps",
  "What you'll need",
  "Secret",
  "Optional",
  "Nothing to fill in.",
];

// The wizard's button for the picker's step, which the dialog translates.
const MODAL_STRINGS: Array<string> = ["Use this template"];

/*
 * The names and descriptions of the picker's views - Recommended, each
 * category, All templates - and the two parts of the Jira category. The
 * picker translates them as it draws them; they are declared elsewhere.
 */
const VIEW_STRINGS: Array<string> = getWorkflowTemplatePickerViews().flatMap(
  (info: WorkflowTemplatePickerViewInfo): Array<string> => {
    return [info.label, info.description];
  },
);

const SUBCATEGORY_STRINGS: Array<string> = Array.from(
  new Set(
    getWorkflowTemplates()
      .map((template: { subcategory?: string | undefined }) => {
        return template.subcategory || "";
      })
      .filter((subcategory: string) => {
        return subcategory.length > 0;
      }),
  ),
);

const STRINGS: Array<string> = Array.from(
  new Set([
    ...PICKER_STRINGS,
    ...MODAL_STRINGS,
    ...VIEW_STRINGS,
    ...SUBCATEGORY_STRINGS,
  ]),
);

/*
 * Keys this change added. The rest were in the locales already ("Clear
 * search", "Incidents", "How It Works", ...) and keep the translations they
 * had.
 */
const NEW_STRINGS: Array<string> = [
  "Search templates…",
  "Start from scratch",
  "Use this template",
  "Recommended",
  "A few good places to start.",
  "All templates",
  "Every template, grouped by what it is for.",
  "Template categories",
  "{count} results",
  "1 result",
  "{count} blocks",
  "1 block",
  "No templates match your search.",
  "Try other words, or start from scratch.",
  "Search all templates",
  "to move",
  "to use",
  "Back to templates",
  "Trigger",
  "Nothing to fill in.",
  "Learn the basics",
  "Maintenance",
  "On a Schedule",
  "Jira",
  "Integrations",
  ...WorkflowTemplateCategories.map(
    (category: WorkflowTemplateCategory): string => {
      return getWorkflowTemplateCategoryInfo(category).description;
    },
  ),
];

/*
 * A new key that reads the same as English in a locale, and why it is right
 * there. Anything else identical to English is a copy someone forgot to
 * translate.
 */
const IDENTICAL_TO_ENGLISH: Record<string, Array<string>> = {
  // A product name.
  Jira: [
    "da",
    "de",
    "es",
    "fa",
    "fr",
    "hi",
    "it",
    "ja",
    "ko",
    "nl",
    "no",
    "pt",
    "ru",
    "sv",
    "zh-CN",
    "zh-TW",
  ],
  // The word these languages' workflow docs and tools already use for it.
  Trigger: ["da", "de", "it", "nl", "no", "pt"],
  // French spells it the same.
  Maintenance: ["fr"],
  // So does Swedish: one block, "1 block".
  "1 block": ["sv"],
};

/*
 * Old strings the picker used to draw, or that an earlier draft of this one
 * did. None should be in the source, and none was added to the locales.
 */
const RETIRED_STRINGS: Array<string> = [
  "Pick a template to see what it does.",
  "What you'll learn",
  "You'll need",
  "How it works",
  "Blank",
];

const SENTENCE_ENDINGS: Array<string> = [".", "。", "।"];

type ReadLocaleFunction = (file: string) => Record<string, unknown>;

const readLocale: ReadLocaleFunction = (
  file: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
  ) as Record<string, unknown>;
};

const LOCALE_FILES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string) => {
    return file.endsWith(".json");
  })
  .sort();

const NON_ENGLISH_FILES: Array<string> = LOCALE_FILES.filter((file: string) => {
  return file !== "en.json";
});

type StripCommentsFunction = (source: string) => string;

const stripComments: StripCommentsFunction = (source: string): string => {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
};

const PICKER_CODE: string = stripComments(fs.readFileSync(PICKER_PATH, "utf8"));
const MODAL_CODE: string = stripComments(fs.readFileSync(MODAL_PATH, "utf8"));

type LiteralArgumentsFunction = (code: string, callee: string) => Array<string>;

/** The string literal passed straight to every `callee("...")` call. */
const literalArguments: LiteralArgumentsFunction = (
  code: string,
  callee: string,
): Array<string> => {
  return Array.from(
    code.matchAll(
      new RegExp(`\\b${callee}\\(\\s*"((?:[^"\\\\]|\\\\.)*)"`, "g"),
    ),
    (match: RegExpMatchArray): string => {
      return match[1]!.replace(/\\"/g, '"');
    },
  );
};

describe("the workflow template picker's strings", () => {
  test("seventeen locales are checked", () => {
    expect(LOCALE_FILES).toHaveLength(17);
    expect(LOCALE_FILES).toContain("en.json");
  });

  test("every literal the picker translates is listed here", () => {
    const translated: Array<string> = literalArguments(PICKER_CODE, "tx");

    expect(translated.length).toBeGreaterThan(10);

    for (const text of translated) {
      expect({ text: text, listed: STRINGS.includes(text) }).toEqual({
        text: text,
        listed: true,
      });
    }
  });

  test("the count phrases are passed to translation whole", () => {
    expect(PICKER_CODE).toContain('"1 result"');
    expect(PICKER_CODE).toContain('"{count} results"');
    expect(PICKER_CODE).toContain('"1 block"');
    expect(PICKER_CODE).toContain('"{count} blocks"');
    // No number glued to a word translated on its own.
    expect(PICKER_CODE).not.toMatch(/tx\("results?"\)/);
    expect(PICKER_CODE).not.toMatch(/tx\("blocks?"\)/);
  });

  test("the wizard's button for the picker's step is the one listed", () => {
    expect(MODAL_CODE).toContain('"Use this template"');
  });

  test("none of the retired strings is drawn", () => {
    for (const text of RETIRED_STRINGS) {
      expect({
        text: text,
        inPicker: PICKER_CODE.includes(`"${text}"`),
      }).toEqual({
        text: text,
        inPicker: false,
      });
    }
  });

  test("English carries every string as itself", () => {
    const english: Record<string, unknown> = readLocale("en.json");

    for (const text of STRINGS) {
      expect({ text: text, value: english[text] }).toEqual({
        text: text,
        value: text,
      });
    }
  });

  test.each(NON_ENGLISH_FILES)("%s translates every string", (file: string) => {
    const locale: Record<string, unknown> = readLocale(file);

    for (const text of STRINGS) {
      const value: unknown = locale[text];

      expect({
        file: file,
        text: text,
        isText: typeof value === "string",
      }).toEqual({
        file: file,
        text: text,
        isText: true,
      });
      expect((value as string).trim().length).toBeGreaterThan(0);
    }
  });

  test.each(NON_ENGLISH_FILES)(
    "%s does not leave a new string in English, except where English is right",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(file);
      const language: string = file.replace(/\.json$/, "");

      for (const text of NEW_STRINGS) {
        const allowed: boolean = (IDENTICAL_TO_ENGLISH[text] || []).includes(
          language,
        );

        expect({
          file: file,
          text: text,
          identical: locale[text] === text,
        }).toEqual({ file: file, text: text, identical: allowed });
      }
    },
  );

  test.each(NON_ENGLISH_FILES)(
    "%s keeps the {count} each count phrase fills in",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(file);

      for (const text of ["{count} results", "{count} blocks"]) {
        expect(locale[text]).toEqual(expect.stringContaining("{count}"));
        expect(String(locale[text]).split("{count}")).toHaveLength(2);
      }
    },
  );

  test.each(NON_ENGLISH_FILES)("%s keeps the name Jira", (file: string) => {
    const locale: Record<string, unknown> = readLocale(file);

    for (const text of STRINGS.filter((candidate: string) => {
      return candidate.includes("Jira");
    })) {
      expect({ text: text, value: locale[text] }).toEqual({
        text: text,
        value: expect.stringContaining("Jira"),
      });
    }
  });

  test.each(LOCALE_FILES)(
    "%s ends each category's description as a sentence",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(file);

      for (const category of WorkflowTemplateCategories) {
        const value: string = String(
          locale[getWorkflowTemplateCategoryInfo(category).description],
        );

        expect({
          category: category,
          ends: SENTENCE_ENDINGS.some((ending: string) => {
            return value.endsWith(ending);
          }),
        }).toEqual({ category: category, ends: true });
      }
    },
  );

  test("no retired string was added to the locales", () => {
    const english: Record<string, unknown> = readLocale("en.json");

    for (const text of [
      "Pick a template to see what it does.",
      "What you'll learn",
      "You'll need",
    ]) {
      expect(english[text]).toBeUndefined();
    }
  });

  /*
   * "Basics" is a form step's key, and reads "basic information" in several
   * locales ("Datos básicos", "基本信息"). The category of first workflows
   * has a key of its own.
   */
  test("the beginners' category is not labelled with the form step's Basics", () => {
    expect(
      getWorkflowTemplateCategoryInfo(WorkflowTemplateCategory.Basics).label,
    ).toBe("Learn the basics");
    expect(STRINGS).not.toContain("Basics");
  });
});

describe("a count and its noun, translated whole", () => {
  type FakeTranslateFunction = (value: string) => string;

  type TranslatorForFunction = (file: string) => FakeTranslateFunction;

  const translatorFor: TranslatorForFunction = (
    file: string,
  ): FakeTranslateFunction => {
    const locale: Record<string, unknown> = readLocale(file);

    return (value: string): string => {
      return typeof locale[value] === "string"
        ? (locale[value] as string)
        : value;
    };
  };

  test("one is its own phrase", () => {
    expect(
      workflowTemplateCountText(
        translatorFor("en.json"),
        1,
        "1 result",
        "{count} results",
      ),
    ).toBe("1 result");
    expect(
      workflowTemplateCountText(
        translatorFor("de.json"),
        1,
        "1 result",
        "{count} results",
      ),
    ).toBe("1 Ergebnis");
  });

  test("any other number is put where the language puts it", () => {
    expect(
      workflowTemplateCountText(
        translatorFor("en.json"),
        12,
        "1 result",
        "{count} results",
      ),
    ).toBe("12 results");
    expect(
      workflowTemplateCountText(
        translatorFor("ru.json"),
        3,
        "1 block",
        "{count} blocks",
      ),
    ).toBe("Блоков: 3");
    expect(
      workflowTemplateCountText(
        translatorFor("ko.json"),
        0,
        "1 result",
        "{count} results",
      ),
    ).toBe("결과 0개");
  });
});

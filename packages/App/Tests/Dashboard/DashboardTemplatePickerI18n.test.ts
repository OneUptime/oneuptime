import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DashboardTemplateCategory } from "Common/Types/Dashboard/DashboardTemplates";
import {
  DASHBOARD_PICKER_CATEGORIES,
  DASHBOARD_TEMPLATE_PICKER_RULES,
  getDashboardTemplateCategoryLabel,
} from "../../FeatureSet/Dashboard/src/Utils/Dashboard/DashboardTemplatePickerUtil";
import { TemplatePickerViewInfo } from "../../FeatureSet/Dashboard/src/Utils/TemplatePicker/TemplatePickerUtil";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";

/*
 * Create a dashboard - the template picker and the wizard around it - looks
 * every word it draws up in the Dashboard locale files, by its English
 * text, so a string it renders that no locale carries stays English for
 * everyone. This pins both halves: the strings the dialog translates, and a
 * translation of each in all seventeen locales. It also walks the picker's
 * and the wizard's source for every literal they hand to translation, so a
 * new one cannot ship without being listed here.
 *
 * The step is the shared template picker, which Create a workflow draws
 * too, so most of its words are the workflow picker's and were translated
 * with it (WorkflowTemplatePickerI18n.test.ts). The templates themselves -
 * their names, descriptions and variables - are catalog content, written in
 * English in Common like the workflow templates, and are not translated
 * here. The old dialog, Create from Template, drew its category headings
 * untranslated; the category select now looks them up.
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
  "Dashboard",
  "DashboardTemplatePicker.tsx",
);

const SHARED_PICKER_PATH: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "TemplatePicker",
  "TemplatePicker.tsx",
);

const MODAL_PATH: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "Dashboard",
  "CreateDashboardModal.tsx",
);

const PAGE_PATH: string = path.join(
  DASHBOARD_SRC,
  "Pages",
  "Dashboards",
  "Dashboards.tsx",
);

/** Every string the step translates that the picker, or the shared step, writes out itself. */
const PICKER_STRINGS: Array<string> = [
  "Start from scratch",
  "Begin with an empty dashboard and add your own widgets.",
  "Or start from a template",
  "Search templates…",
  "Clear search",
  "Template categories",
  "1 result",
  "{count} results",
  "No templates match your search.",
  "Try other words, or start from scratch.",
  "Search all templates",
  "Widgets",
  "Variables",
];

/*
 * What the wizard around the picker draws: the dialog's title and buttons,
 * which the dialog translates, and the Name step's field help, prompts and
 * message.
 */
const MODAL_STRINGS: Array<string> = [
  "Create a dashboard",
  "Use this template",
  "Create Dashboard",
  "Name",
  "Dashboard names are unique within a project.",
  "What should this dashboard be called?",
  "Please give this dashboard a name of at least 2 letters.",
  "Description",
  "What is this dashboard for?",
  "Back",
];

// The category select's options: Recommended, each category, All templates.
const VIEW_STRINGS: Array<string> =
  DASHBOARD_TEMPLATE_PICKER_RULES.getViews().map(
    (info: TemplatePickerViewInfo<DashboardTemplateCategory>): string => {
      return info.label;
    },
  );

/*
 * The Name step's fold, named as every form's More fields is: by the shared
 * title (FoldedSectionTitles), never written out (FoldedSectionsGuard).
 */
const FOLD_STRINGS: Array<string> = [MORE_FIELDS_SECTION_TITLE];

const STRINGS: Array<string> = Array.from(
  new Set([
    ...PICKER_STRINGS,
    ...MODAL_STRINGS,
    ...VIEW_STRINGS,
    ...FOLD_STRINGS,
  ]),
);

/*
 * Keys this dialog brought. The rest were in the locales already, from
 * Create a workflow and the rest of the Dashboard, and keep the
 * translations they had.
 */
const NEW_STRINGS: Array<string> = [
  "Begin with an empty dashboard and add your own widgets.",
  "Create a dashboard",
  "Create Dashboard",
  "Dashboard names are unique within a project.",
  "What should this dashboard be called?",
  "Please give this dashboard a name of at least 2 letters.",
  "What is this dashboard for?",
  "Monitoring & APM",
  "Incident Response",
];

/*
 * What the old dialog drew and no part of the Dashboard draws now, so no
 * locale keeps it.
 */
const RETIRED_KEYS: Array<string> = [
  "Choose a template to quickly get started with a pre-configured dashboard.",
];

/*
 * The languages whose Dashboard writes "Widgets" as English does, in the
 * word their own interfaces use for one. Everywhere else it is translated.
 */
const WIDGETS_AS_ENGLISH: Array<string> = [
  "da",
  "de",
  "es",
  "fr",
  "nl",
  "no",
  "pt",
];

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

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /^\s*\/\/.*$/gm;

type StripCommentsFunction = (source: string) => string;

const stripComments: StripCommentsFunction = (source: string): string => {
  return source.replace(BLOCK_COMMENT, " ").replace(LINE_COMMENT, " ");
};

type ReadCodeFunction = (files: Array<string>) => string;

const readCode: ReadCodeFunction = (files: Array<string>): string => {
  return files
    .map((file: string): string => {
      return stripComments(fs.readFileSync(file, "utf8"));
    })
    .join("\n");
};

const PICKER_CODE: string = readCode([PICKER_PATH, SHARED_PICKER_PATH]);
const MODAL_CODE: string = readCode([MODAL_PATH]);
const PAGE_CODE: string = readCode([PAGE_PATH]);

const ESCAPED_QUOTE: RegExp = /\\"/g;

// What may stand right before a call's name: a call of this name, not of one ending with it.
const NAME_CHARACTER: RegExp = /[\w$.]/;
const SPACE: RegExp = /\s/;

// A sentence's end: a full stop, or the stop of the language's own script.
const SENTENCE_END: RegExp = /[.。।]$/;

// A question's end: Japanese and Chinese write the full-width mark, Persian its own.
const QUESTION_END: RegExp = /[?？؟]$/;

type LiteralArgumentsFunction = (code: string, callee: string) => Array<string>;

/** The string literal passed straight to every `callee("...")` call. */
const literalArguments: LiteralArgumentsFunction = (
  code: string,
  callee: string,
): Array<string> => {
  const found: Array<string> = [];
  const opening: string = `${callee}(`;
  let from: number = code.indexOf(opening);

  while (from !== -1) {
    const before: string = code[from - 1] || " ";
    let at: number = from + opening.length;

    if (!NAME_CHARACTER.test(before)) {
      while (at < code.length && SPACE.test(code[at]!)) {
        at++;
      }

      if (code[at] === '"') {
        let end: number = at + 1;

        while (end < code.length && code[end] !== '"') {
          end += code[end] === "\\" ? 2 : 1;
        }

        found.push(code.slice(at + 1, end).replace(ESCAPED_QUOTE, '"'));
      }
    }

    from = code.indexOf(opening, from + opening.length);
  }

  return found;
};

describe("Create a dashboard's strings", () => {
  test("seventeen locales are checked", () => {
    expect(LOCALE_FILES).toHaveLength(17);
    expect(LOCALE_FILES).toContain("en.json");
  });

  test("every literal the picker and the shared step translate is listed here", () => {
    const translated: Array<string> = literalArguments(PICKER_CODE, "tx");

    expect(translated.length).toBeGreaterThan(10);

    for (const text of translated) {
      expect({ text: text, listed: STRINGS.includes(text) }).toEqual({
        text: text,
        listed: true,
      });
    }
  });

  test("everything listed for the picker is drawn by it", () => {
    for (const text of PICKER_STRINGS) {
      expect({
        text: text,
        drawn: PICKER_CODE.includes(`"${text}"`),
      }).toEqual({ text: text, drawn: true });
    }
  });

  test("everything listed for the wizard is in its source", () => {
    for (const text of MODAL_STRINGS) {
      expect({
        text: text,
        inWizard: MODAL_CODE.includes(`"${text}"`),
      }).toEqual({ text: text, inWizard: true });
    }

    // Its fold is every form's More fields, by the shared title.
    expect(MODAL_CODE).toContain("title={MORE_FIELDS_SECTION_TITLE}");
    expect(MORE_FIELDS_SECTION_TITLE).toBe("More fields");
  });

  test("the category select names its categories by keys the extractor reads", () => {
    const util: string = fs.readFileSync(
      path.join(
        DASHBOARD_SRC,
        "Utils",
        "Dashboard",
        "DashboardTemplatePickerUtil.ts",
      ),
      "utf8",
    );

    for (const category of DASHBOARD_PICKER_CATEGORIES) {
      const label: string = getDashboardTemplateCategoryLabel(category);

      expect(util).toContain(`translationKey("${label}")`);
    }
  });

  test("the old dialog's words are drawn no more, on the page or in the wizard", () => {
    for (const code of [PAGE_CODE, MODAL_CODE, PICKER_CODE]) {
      expect(code).not.toContain('"Create from Template"');
      expect(code).not.toContain(
        '"Choose a template to quickly get started with a pre-configured dashboard."',
      );
      expect(code).not.toContain("DashboardTemplateCard");
    }
  });

  test.each(LOCALE_FILES)(
    "%s keeps none of the strings only the old dialog drew",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(file);

      for (const text of RETIRED_KEYS) {
        expect({ file: file, text: text, kept: text in locale }).toEqual({
          file: file,
          text: text,
          kept: false,
        });
      }
    },
  );

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
      }).toEqual({ file: file, text: text, isText: true });
      expect((value as string).trim().length).toBeGreaterThan(0);
    }
  });

  test.each(NON_ENGLISH_FILES)(
    "%s does not leave a new string in English",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(file);

      for (const text of NEW_STRINGS) {
        expect({
          file: file,
          text: text,
          identical: locale[text] === text,
        }).toEqual({ file: file, text: text, identical: false });
      }
    },
  );

  test.each(NON_ENGLISH_FILES)(
    "%s keeps APM, the product's name for it, in Monitoring & APM",
    (file: string) => {
      expect(readLocale(file)["Monitoring & APM"]).toEqual(
        expect.stringContaining("APM"),
      );
    },
  );

  test.each(NON_ENGLISH_FILES)(
    "%s names the details' Widgets row in its own word",
    (file: string) => {
      const language: string = file.replace(".json", "");
      const value: unknown = readLocale(file)["Widgets"];

      expect({ language: language, english: value === "Widgets" }).toEqual({
        language: language,
        english: WIDGETS_AS_ENGLISH.includes(language),
      });
    },
  );

  /*
   * The dialog's Create Dashboard and the list's own Create button are one
   * key: a named action looks its whole phrase up first
   * (translateNamedAction), so the two read the same in every language.
   */
  test.each(NON_ENGLISH_FILES)(
    "%s words the dialog's Create Dashboard as a phrase, not a label glued to a noun",
    (file: string) => {
      const value: string = String(readLocale(file)["Create Dashboard"]);

      expect(value).not.toContain(":");
      expect(value.length).toBeGreaterThan(0);
    },
  );

  test("the Name step's sentences end as English ends them", () => {
    for (const file of NON_ENGLISH_FILES) {
      const locale: Record<string, unknown> = readLocale(file);

      for (const text of [
        "Dashboard names are unique within a project.",
        "Please give this dashboard a name of at least 2 letters.",
        "Begin with an empty dashboard and add your own widgets.",
      ]) {
        expect({
          file: file,
          text: text,
          ends: SENTENCE_END.test(String(locale[text])),
        }).toEqual({ file: file, text: text, ends: true });
      }

      for (const text of [
        "What should this dashboard be called?",
        "What is this dashboard for?",
      ]) {
        expect({
          file: file,
          text: text,
          ends: QUESTION_END.test(String(locale[text])),
        }).toEqual({ file: file, text: text, ends: true });
      }
    }
  });

  test("the two-letter minimum is kept as a figure in every language", () => {
    for (const file of NON_ENGLISH_FILES) {
      expect(
        String(
          readLocale(file)[
            "Please give this dashboard a name of at least 2 letters."
          ],
        ),
      ).toContain("2");
    }
  });
});

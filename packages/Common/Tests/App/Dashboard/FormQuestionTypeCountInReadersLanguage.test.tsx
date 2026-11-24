import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import QuestionPalette from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Builder/QuestionPalette";
import { getFormPaletteState } from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormBuilderState";
import {
  FORM_QUESTION_TYPE_TEXT,
  getFormQuestionTypeDescription,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { setDateDisplayLanguage } from "../../../Types/DateLanguage";
import { FORM_FILE_QUESTION_MAX_FILES } from "../../../Types/Form/FormFileAnswer";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { PluralTemplate, Translator } from "../../../Types/Translator";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * THE FORM BUILDER'S MULTIPLE FILES TYPE SAYS ITS COUNT AS A VALUE (#8039).
 *
 * The builder's list of question types described Multiple Files as "Up to
 * 10 files, such as screenshots and logs.", 10 written into the words in
 * English and every language, with nothing tying it to how many files a
 * question takes (FORM_FILE_QUESTION_MAX_FILES): change that, and the list
 * would go on saying 10 beside a picker that says its own count, as the
 * picker's hint once did (#7421). The count is the plural's {{count}} now,
 * in the reader's digits ("۱۰" in Persian, where the sentence wrote a Latin
 * 10) and in the form of the noun their language takes for it, and Russian
 * and Arabic, which say their general sentence for most counts, name it as
 * a label's value.
 */

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: any = jest.requireActual(
          "../../../Types/ObjectID",
        ) as any;
        return new ObjectIDClass.default(
          "11111111-1111-4111-8111-111111111111",
        );
      },
    },
  };
});

const MULTIPLE_FILES: PluralTemplate = FORM_QUESTION_TYPE_TEXT[
  CustomFieldType.MultipleFiles
].description as PluralTemplate;

const RENDERED_LANGUAGES: Array<string> = ["en", "de", "ru", "ar", "fa"];

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of RENDERED_LANGUAGES) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        [language]: { translation: readDashboardLocale(language) },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
  setDateDisplayLanguage("en");
});

// What the palette says a Multiple Files question takes, on a page in `language`.
function drawnDescription(language: string): string {
  setDateDisplayLanguage(language);
  render(
    <I18nextProvider i18n={instances[language]!}>
      <MemoryRouter>
        <QuestionPalette
          targetType={FormTargetType.Incident}
          palette={getFormPaletteState({
            fields: [],
            targetType: FormTargetType.Incident,
            customFields: [],
          })}
          onAdd={() => {}}
        />
      </MemoryRouter>
    </I18nextProvider>,
  );

  const entry: HTMLElement = screen.getByTestId(
    `form-palette-question-${CustomFieldType.MultipleFiles}`,
  );
  const title: string = readDashboardLocale(language)["Multiple Files"] || "";

  // The entry's words after its title: its description.
  return withoutIsolateMarks(entry.textContent || "").replace(title, "");
}

// The description in `language`, for a question that takes `maxFiles`.
function describedIn(language: string, maxFiles?: number): string {
  const translator: Translator = dashboardTranslator(language);

  return withoutIsolateMarks(
    getFormQuestionTypeDescription({
      type: CustomFieldType.MultipleFiles,
      translateText: (text: string): string => {
        return translator.translateText(text) || text;
      },
      translatePlural: translator.translatePlural,
      maxFiles,
    }),
  ).replace(/\u00A0/g, " ");
}

describe("the palette's Multiple Files type", () => {
  test("the count it says is the one every Multiple Files question takes", () => {
    expect(FORM_FILE_QUESTION_MAX_FILES).toBe(10);
  });

  test.each([
    ["en", "Up to 10 files, such as screenshots and logs."],
    ["de", "Bis zu 10 Dateien, etwa Screenshots und Logs."],
    ["ru", "Максимум файлов: 10, например снимки экрана и журналы."],
    // Arabic writes Latin digits; a label's value reads right for any count.
    ["ar", "الحد الأقصى للملفات: 10، مثل لقطات الشاشة والسجلات."],
    // Persian writes its own digits: the words wrote a Latin 10.
    ["fa", "حداکثر ۱۰ فایل، مانند تصویر صفحه و لاگ."],
  ])(
    "%s: says it in the reader's words and digits",
    (language: string, words: string) => {
      expect(drawnDescription(language).replace(/\u00A0/g, " ")).toBe(words);
    },
  );

  test("fa: no Latin digit", () => {
    expect(drawnDescription("fa")).not.toMatch(/[0-9]/);
  });
});

/*
 * The number is the count's, never the words': a question that took 3 or
 * 21 would say 3 or 21, and one that took a single file the words for one.
 */
describe("the sentence follows the count", () => {
  test.each([
    ["en", 3, "Up to 3 files, such as screenshots and logs."],
    ["en", 1, "One file, such as a screenshot or a log."],
    ["de", 3, "Bis zu 3 Dateien, etwa Screenshots und Logs."],
    ["de", 1, "Eine Datei, etwa ein Screenshot oder ein Log."],
    // 21 is a count Russian calls "one": the general sentence names it.
    ["ru", 21, "Максимум файлов: 21, например снимки экрана и журналы."],
    ["ru", 1, "Один файл, например снимок экрана или журнал."],
    ["ar", 2, "الحد الأقصى للملفات: 2، مثل لقطات الشاشة والسجلات."],
    ["ar", 11, "الحد الأقصى للملفات: 11، مثل لقطات الشاشة والسجلات."],
    ["ar", 1, "ملف واحد، مثل لقطة شاشة أو سجل."],
    ["fa", 3, "حداکثر ۳ فایل، مانند تصویر صفحه و لاگ."],
    ["fa", 1, "یک فایل، مانند تصویر صفحه یا لاگ."],
  ] as Array<[string, number, string]>)(
    "%s: a question of %p files",
    (language: string, maxFiles: number, words: string) => {
      expect(describedIn(language, maxFiles)).toBe(words);
    },
  );

  // Negative control: the drawn sentence differs whenever the count does.
  test("no two counts read alike", () => {
    for (const language of RENDERED_LANGUAGES) {
      const sentences: Set<string> = new Set<string>(
        [1, 2, 3, 5, 10, 21, 100].map((maxFiles: number): string => {
          return describedIn(language, maxFiles);
        }),
      );

      expect({ language, distinct: sentences.size }).toEqual({
        language,
        distinct: 7,
      });
    }
  });

  test("its plural keeps the count where English names it, and its one form names none", () => {
    expect(MULTIPLE_FILES.other.split("{{count}}")).toHaveLength(2);
    expect(MULTIPLE_FILES.one).not.toContain("{{");
    expect(`${MULTIPLE_FILES.one} ${MULTIPLE_FILES.other}`).not.toMatch(
      /[0-9]/,
    );
  });
});

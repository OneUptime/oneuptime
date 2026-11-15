// UX rule: Docs/ux/README.md#in-every-language
import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import {
  DICTIONARY_FILTER_OPERATOR_OPTIONS,
  DictionaryFilterOperator,
  DictionaryFilterOperatorOption,
} from "../../../UI/Components/Dictionary/DictionaryFilterOperator";
import {
  DICTIONARY_FILTER_SENTENCES,
  formatDictionaryFilterSentence,
  readDictionaryFilter,
} from "../../../UI/Components/Dictionary/DictionaryFilterSentence";
import FilterViewer from "../../../UI/Components/Filters/FilterViewer";
import Filter from "../../../UI/Components/Filters/Types/Filter";
import FieldType from "../../../UI/Components/Types/FieldType";
import EndsWith from "../../../Types/BaseDatabase/EndsWith";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import NotContains from "../../../Types/BaseDatabase/NotContains";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import NotWildcard from "../../../Types/BaseDatabase/NotWildcard";
import Search from "../../../Types/BaseDatabase/Search";
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import GenericObject from "../../../Types/GenericObject";
import { getListSeparator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * AN ATTRIBUTE FILTER'S CHIP SAYS ITS OPERATOR IN THE READER'S LANGUAGE (#7931).
 *
 * "Filter by Attributes" - a log or trace monitor's criteria, the metric
 * query form, a dashboard table widget - words every operator in its
 * picker: German "stimmt überein", Persian «مطابقت دارد با». The places
 * that sum a picked filter up drew the operator's English symbol between
 * the key and the value instead: the filter bar's chip read "http.route
 * matches /api/*" under a German form, and an English word sat in the
 * middle of a Persian line.
 *
 * Each operator is one sentence now (DictionaryFilterSentence), its key and
 * value set apart as typed, so a language orders it ("http.route stimmt
 * mit /api/* überein") and a right-to-left line keeps the key and the
 * value readable. An operator drawn as a symbol (=, !=, >) has no words,
 * and reads as the symbol between the two in every language.
 *
 * Rendered through i18next with the Dashboard's own locale files.
 */

const LETTER: RegExp = /\p{L}/u;

// A stored filter of every operator, with what its English sentence says.
const EVERY_OPERATOR: Array<{
  operator: DictionaryFilterOperator;
  attributeKey: string;
  value: unknown;
  english: string;
}> = [
  {
    operator: DictionaryFilterOperator.EqualTo,
    attributeKey: "service.name",
    value: "checkout",
    english: "service.name = checkout",
  },
  {
    operator: DictionaryFilterOperator.NotEqual,
    attributeKey: "host.name",
    value: new NotEqual("prod-1"),
    english: "host.name != prod-1",
  },
  {
    operator: DictionaryFilterOperator.IsAnyOf,
    attributeKey: "role",
    value: new Includes(["system", "user"]),
    english: "role is any of: system, user",
  },
  {
    operator: DictionaryFilterOperator.IsNoneOf,
    attributeKey: "role",
    value: new IncludesNone(["system", "user"]),
    english: "role is none of: system, user",
  },
  {
    operator: DictionaryFilterOperator.Contains,
    attributeKey: "path",
    value: new Search("api"),
    english: "path contains api",
  },
  {
    operator: DictionaryFilterOperator.NotContains,
    attributeKey: "path",
    value: new NotContains("health"),
    english: "path does not contain health",
  },
  {
    operator: DictionaryFilterOperator.StartsWith,
    attributeKey: "path",
    value: new StartsWith("/api"),
    english: "path starts with /api",
  },
  {
    operator: DictionaryFilterOperator.EndsWith,
    attributeKey: "path",
    value: new EndsWith(".json"),
    english: "path ends with .json",
  },
  {
    operator: DictionaryFilterOperator.Matches,
    attributeKey: "http.route",
    value: new Wildcard(["/api/*"]),
    english: "http.route matches /api/*",
  },
  {
    operator: DictionaryFilterOperator.NotMatches,
    attributeKey: "service.name",
    value: new NotWildcard(["test-*"]),
    english: "service.name does not match test-*",
  },
  {
    operator: DictionaryFilterOperator.GreaterThan,
    attributeKey: "retries",
    value: new GreaterThan(3),
    english: "retries > 3",
  },
  {
    operator: DictionaryFilterOperator.GreaterThanOrEqual,
    attributeKey: "retries",
    value: new GreaterThanOrEqual(3),
    english: "retries >= 3",
  },
  {
    operator: DictionaryFilterOperator.LessThan,
    attributeKey: "retries",
    value: new LessThan(3),
    english: "retries < 3",
  },
  {
    operator: DictionaryFilterOperator.LessThanOrEqual,
    attributeKey: "retries",
    value: new LessThanOrEqual(3),
    english: "retries <= 3",
  },
  {
    operator: DictionaryFilterOperator.IsEmpty,
    attributeKey: "trace.id",
    value: new IsNull(),
    english: "trace.id is empty",
  },
  {
    operator: DictionaryFilterOperator.IsNotEmpty,
    attributeKey: "trace.id",
    value: new NotNull(),
    english: "trace.id is not empty",
  },
];

// The operators' sentences that hold words: each one a key to look up.
const WORDED_SENTENCES: Array<string> = Object.values(
  DICTIONARY_FILTER_SENTENCES,
).filter((template: string): boolean => {
  return LETTER.test(template.replace(/\{\{\s*\w+\s*\}\}/g, ""));
});

// A sentence of the locale file, filled as the page fills it.
function fill(template: string, values: Record<string, string>): string {
  return template.replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (whole: string, name: string): string => {
      return values[name] ?? whole;
    },
  );
}

describe("each operator is one sentence", () => {
  test("every operator has one, with the key and the value as its slots", () => {
    for (const option of DICTIONARY_FILTER_OPERATOR_OPTIONS) {
      const template: string = DICTIONARY_FILTER_SENTENCES[option.operator];

      expect({
        operator: option.operator,
        hasKey: template.includes("{{field}}"),
      }).toEqual({
        operator: option.operator,
        hasKey: true,
      });
      expect({
        operator: option.operator,
        hasValue: template.includes("{{value}}"),
      }).toEqual({
        operator: option.operator,
        hasValue: !option.hidesValueInput,
      });
    }
  });

  test("an operator with words says them in its sentence; a symbol is the sentence's whole word", () => {
    for (const option of DICTIONARY_FILTER_OPERATOR_OPTIONS) {
      const template: string = DICTIONARY_FILTER_SENTENCES[option.operator];

      if (LETTER.test(option.symbol)) {
        expect(template).toContain(` ${option.label}`);
      } else {
        expect(template).toBe(
          option.hidesValueInput
            ? `{{field}} ${option.symbol}`
            : `{{field}} ${option.symbol} {{value}}`,
        );
      }
    }

    expect(WORDED_SENTENCES.length).toBe(10);
  });

  test("in English each reads as the chip always did, its operator in words", () => {
    const english: ReturnType<typeof dashboardTranslator> =
      dashboardTranslator("en");

    for (const entry of EVERY_OPERATOR) {
      expect(readDictionaryFilter(entry.value).operator).toBe(entry.operator);
      expect(
        formatDictionaryFilterSentence({
          attributeKey: entry.attributeKey,
          value: entry.value,
          translator: english,
        }),
      ).toBe(entry.english);
    }

    // A yes or no is said in words, not as the stored true.
    expect(
      formatDictionaryFilterSentence({
        attributeKey: "cache.hit",
        value: true,
        translator: english,
      }),
    ).toBe("cache.hit = True");
  });

  test("the worded sentences are keys of the English locale; a symbol's is not", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const template of WORDED_SENTENCES) {
      expect(english[template]).toBe(template);
    }

    expect(english["{{field}} = {{value}}"]).toBeUndefined();
    expect(english["{{field}} != {{value}}"]).toBeUndefined();
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words every operator's sentence its own way",
    (language: string) => {
      expect(
        WORDED_SENTENCES.filter((template: string): boolean => {
          return !isWordedInDashboardLocale(template, language);
        }),
      ).toEqual([]);
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s's sentence never says the English operator",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const english: Array<string> = DICTIONARY_FILTER_OPERATOR_OPTIONS.map(
        (option: DictionaryFilterOperatorOption): string => {
          return option.label;
        },
      ).filter((label: string): boolean => {
        return LETTER.test(label);
      });

      for (const template of WORDED_SENTENCES) {
        const said: string = words[template] || "";

        expect({
          language,
          template,
          saysEnglish: english.some((label: string): boolean => {
            return new RegExp(`(^|\\s)${label}(\\s|:|$)`).test(said);
          }),
        }).toEqual({ language, template, saysEnglish: false });
      }
    },
  );

  test("a sentence put back to English is caught (control)", () => {
    const words: Record<string, string> = readDashboardLocale("de");
    const template: string =
      DICTIONARY_FILTER_SENTENCES[DictionaryFilterOperator.Matches];
    const worded: string = words[template] as string;

    words[template] = template;

    try {
      expect(isWordedInDashboardLocale(template, "de")).toBe(false);
    } finally {
      words[template] = worded;
    }

    expect(isWordedInDashboardLocale(template, "de")).toBe(true);
  });
});

/*
 * The filter bar's chip of a table filtered by its attributes (a logs or
 * traces table, a dashboard table widget).
 */
type Row = GenericObject & { attributes?: Record<string, unknown> };

const FILTERS: Array<Filter<Row>> = [
  { key: "attributes", title: "Attributes", type: FieldType.JSON },
] as unknown as Array<Filter<Row>>;

const RENDERED: ReadonlyArray<string> = ["en", "de", "fa", "ar"];

const languages: Record<string, i18n> = {};

beforeAll(async () => {
  for (const code of RENDERED) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: code,
      fallbackLng: "en",
      resources: { [code]: { translation: readDashboardLocale(code) } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    languages[code] = instance;
  }
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
});

function renderChips(code: string, attributes: Record<string, unknown>): void {
  if (code === "fa" || code === "ar") {
    document.documentElement.setAttribute("dir", "rtl");
  }

  render(
    <I18nextProvider i18n={languages[code] as i18n}>
      <FilterViewer<Row>
        id="logs"
        filters={FILTERS}
        filterData={{ attributes } as Row}
        showFilterModal={false}
        pluralLabel="Logs"
      />
    </I18nextProvider>,
  );
}

function chipTexts(): Array<string> {
  return screen
    .getAllByTestId("filter-attribute-chip")
    .map((chip: HTMLElement): string => {
      return withoutIsolateMarks(chip.textContent || "");
    });
}

describe("the filter bar's chip, in the reader's language", () => {
  test("in English it reads as before, the operator in words", () => {
    renderChips("en", {
      "http.route": new Wildcard(["/api/*"]),
      role: new Includes(["system", "user"]),
      "host.name": new NotEqual("prod-1"),
    });

    expect(chipTexts()).toEqual([
      "http.route matches /api/*",
      "role is any of: system, user",
      "host.name != prod-1",
    ]);
  });

  test.each(["de", "fa", "ar"])(
    "in %s it says the language's sentence, never the English operator",
    (code: string) => {
      const words: Record<string, string> = readDashboardLocale(code);
      const separator: string = getListSeparator(code);

      renderChips(code, {
        "http.route": new Wildcard(["/api/*"]),
        role: new Includes(["system", "user"]),
        "trace.id": new IsNull(),
        "host.name": new NotEqual("prod-1"),
      });

      expect(chipTexts()).toEqual([
        fill(words["{{field}} matches {{value}}"]!, {
          field: "http.route",
          value: "/api/*",
        }),
        fill(words["{{field}} is any of: {{value}}"]!, {
          field: "role",
          value: `system${separator}user`,
        }),
        fill(words["{{field}} is empty"]!, { field: "trace.id" }),
        // A symbol has no words: the same in every language.
        "host.name != prod-1",
      ]);

      for (const text of chipTexts()) {
        expect(text).not.toMatch(/\b(matches|is any of|is empty)\b/);
      }
    },
  );

  test("German says the verb its picker says, in German order", () => {
    renderChips("de", { "http.route": new Wildcard(["/api/*"]) });

    expect(chipTexts()).toEqual(["http.route stimmt mit /api/* überein"]);
  });

  test.each(["fa", "ar"])(
    "in %s the key and the value read as typed, each set apart",
    (code: string) => {
      renderChips(code, {
        "http.route": new Wildcard(["/api/checkout/*"]),
      });

      const chip: HTMLElement = screen.getByTestId("filter-attribute-chip");
      const isolates: Array<HTMLElement> = Array.from(
        chip.querySelectorAll<HTMLElement>("bdi"),
      );

      expect(
        isolates.map((isolate: HTMLElement): string => {
          return isolate.textContent || "";
        }),
      ).toEqual(["http.route", "/api/checkout/*"]);

      // Latin letters read from the left, whatever the page's direction.
      for (const isolate of isolates) {
        expect(isolate).toHaveAttribute("dir", "ltr");
      }

      expect(chip.textContent).toMatch(/[؀-ۿ]/u);
    },
  );

  test("a yes or no is said in the reader's words", () => {
    renderChips("de", { "cache.hit": true });

    expect(chipTexts()).toEqual(["cache.hit = Wahr"]);
  });
});

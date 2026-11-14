import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import DictionaryForm, {
  ValueType,
} from "../../../UI/Components/Dictionary/Dictionary";
import {
  DICTIONARY_FILTER_OPERATOR_OPTIONS,
  DictionaryEntryValue,
  DictionaryFilterOperator,
  DictionaryFilterOperatorOption,
} from "../../../UI/Components/Dictionary/DictionaryFilterOperator";
import NotWildcard from "../../../Types/BaseDatabase/NotWildcard";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import Dictionary from "../../../Types/Dictionary";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * THE FILTER OPERATORS, AS VERBS IN EVERY LANGUAGE (#7282).
 *
 * "Filter by Attributes" - a log or trace monitor's criteria, the metric
 * query form, a dashboard table widget - lets each row pick an operator:
 * "matches", "does not match", "is any of". The picker translates each by
 * its English, and "matches" was read as the plural noun: German offered
 * "Treffer" (hits) beside "stimmt nicht überein", Persian "تطابق‌ها". The
 * count of an explorer's search results is a plural sentence of its own
 * ("{{count}} matches"), so the bare word is the operator's alone, and
 * every language words it as the verb its "does not match" negates. The
 * rest of the operators are worded in every language too: twelve of them
 * read "is any of" and "greater than or equal" in English.
 *
 * Read from the shipped locale files, and rendered through the real
 * i18next and the real picker.
 */

const LETTER: RegExp = /\p{L}/u;

// What a count sentence says around its number: "{{count}} Treffer" is "treffer".
function nounOf(countSentence: string | undefined): string {
  return (countSentence || "")
    .replace("{{count}}", "")
    .replace(/[:：]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Whether a word for "matches" is the plural noun its count sentences use.
function isTheCountNoun(word: string, language: string): boolean {
  const words: Record<string, string> = readDashboardLocale(language);
  const said: string = word.trim().toLowerCase();

  return (
    said === nounOf(words["{{count}} matches"]) ||
    said === nounOf(words["{{count}} matches_one"])
  );
}

function optionOf(
  operator: DictionaryFilterOperator,
): DictionaryFilterOperatorOption {
  return DICTIONARY_FILTER_OPERATOR_OPTIONS.find(
    (option: DictionaryFilterOperatorOption): boolean => {
      return option.operator === operator;
    },
  )!;
}

const LABELS: Array<string> = DICTIONARY_FILTER_OPERATOR_OPTIONS.map(
  (option: DictionaryFilterOperatorOption): string => {
    return option.label;
  },
);

// What the picker draws: a symbol (=, >) or the label's words.
const DRAWN_WORDS: Array<string> = DICTIONARY_FILTER_OPERATOR_OPTIONS.map(
  (option: DictionaryFilterOperatorOption): string => {
    return option.symbol;
  },
).filter((symbol: string): boolean => {
  return LETTER.test(symbol);
});

// Each operator beside the one that negates it.
const PAIRS: Array<[DictionaryFilterOperator, DictionaryFilterOperator]> = [
  [DictionaryFilterOperator.EqualTo, DictionaryFilterOperator.NotEqual],
  [DictionaryFilterOperator.IsAnyOf, DictionaryFilterOperator.IsNoneOf],
  [DictionaryFilterOperator.Contains, DictionaryFilterOperator.NotContains],
  [DictionaryFilterOperator.Matches, DictionaryFilterOperator.NotMatches],
  [DictionaryFilterOperator.IsEmpty, DictionaryFilterOperator.IsNotEmpty],
];

describe("the operators are keys of the Dashboard's locale files", () => {
  test("each label is an English key, and the picker draws the label wherever it draws words", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    expect(LABELS.length).toBeGreaterThan(10);
    expect(
      LABELS.filter((label: string): boolean => {
        return english[label] !== label;
      }),
    ).toEqual([]);
    for (const word of DRAWN_WORDS) {
      expect(LABELS).toContain(word);
    }
    expect(DRAWN_WORDS).toContain("matches");
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words every operator its own way",
    (language: string) => {
      expect(
        LABELS.filter((label: string): boolean => {
          return !isWordedInDashboardLocale(label, language);
        }),
      ).toEqual([]);
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s words each operator apart from the one that negates it",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const [affirmative, negative] of PAIRS) {
        const said: string = words[optionOf(affirmative).label] || "";
        const negated: string = words[optionOf(negative).label] || "";

        expect({ language, affirmative, same: said === negated }).toEqual({
          language,
          affirmative,
          same: false,
        });
      }
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s gives every operator a word of its own",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const said: Array<string> = LABELS.map((label: string): string => {
        return words[label] || "";
      });

      expect(new Set(said).size).toBe(said.length);
    },
  );
});

describe("matches is the verb, never the count's noun (#7282)", () => {
  test.each(DASHBOARD_LANGUAGES)("%s", (language: string) => {
    const word: string = readDashboardLocale(language)["matches"] || "";

    expect(word.length).toBeGreaterThan(0);
    expect({ language, word, isNoun: isTheCountNoun(word, language) }).toEqual({
      language,
      word,
      isNoun: false,
    });
  });

  test("the check knows the noun when it sees it (control)", () => {
    // What German and Spanish offered before #7282.
    expect(isTheCountNoun("Treffer", "de")).toBe(true);
    expect(isTheCountNoun("coincidencias", "es")).toBe(true);
    expect(isTheCountNoun("coincidencia", "es")).toBe(true);
    // English writes the verb and the plural alike: the bare word is the verb.
    expect(isTheCountNoun("matches", "en")).toBe(true);
  });

  test("the count of a search's results keeps its noun", () => {
    expect(readDashboardLocale("de")["{{count}} matches"]).toBe(
      "{{count}} Treffer",
    );
    expect(readDashboardLocale("en")["{{count}} matches_one"]).toBe(
      "{{count}} match",
    );
  });

  test("the bare noun the picker never drew is no key any more", () => {
    expect("match" in readDashboardLocale("en")).toBe(false);
  });

  test("the infrastructure explorer counts its search's results in the plural sentence, never the bare word", () => {
    const explorer: string = fs
      .readFileSync(
        path.join(
          __dirname,
          "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureExplorer.tsx",
        ),
        "utf8",
      )
      .replace(/\s+/g, " ");

    expect(
      explorer.match(
        /translatePlural\( ?\{ ?one: "\{\{count\}\} match", ?other: "\{\{count\}\} matches",? ?\}/g,
      )?.length,
    ).toBeGreaterThanOrEqual(2);
    expect(explorer).not.toMatch(/\bt\(\s*"matches"\s*\)/);
    expect(explorer).not.toMatch(/"match"\s*:\s*"matches"/);
    expect(explorer).not.toMatch(/\? "match" : "matches"/);
  });

  test.each([
    ["de", "stimmt überein", "stimmt nicht überein"],
    ["fr", "correspond à", "ne correspond pas à"],
    ["es", "coincide con", "no coincide con"],
    ["ja", "に一致する", "に一致しない"],
    ["fa", "مطابقت دارد با", "مطابقت ندارد با"],
    ["ar", "يطابق", "لا يطابق"],
  ])(
    "%s reads %s, and %s",
    (language: string, matches: string, doesNotMatch: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      expect(words["matches"]).toBe(matches);
      expect(words["does not match"]).toBe(doesNotMatch);
    },
  );
});

describe("the picker, rendered in the reader's language", () => {
  const RENDERED: ReadonlyArray<string> = ["de", "fa", "ja"];

  beforeAll(async () => {
    const resources: Record<string, { translation: Record<string, string> }> =
      {};
    for (const language of RENDERED) {
      resources[language] = { translation: readDashboardLocale(language) };
    }
    await i18next.use(initReactI18next).init({
      lng: "en",
      fallbackLng: "en",
      resources: resources,
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("en");
    });
  });

  function renderFilter(initialValue: Dictionary<DictionaryEntryValue>): void {
    render(
      <DictionaryForm
        keys={["http.route"]}
        enableOperators={true}
        valueTypes={[ValueType.Text, ValueType.Number, ValueType.Boolean]}
        addButtonSuffix="Filter by Attributes"
        keyPlaceholder="Key"
        valuePlaceholder="Value"
        initialValue={initialValue}
        onChange={() => {
          return undefined;
        }}
      />,
    );
  }

  test.each(RENDERED)(
    "in %s, a stored matches row shows the verb, and the menu every operator in the language",
    async (language: string) => {
      await act(async (): Promise<void> => {
        await i18next.changeLanguage(language);
      });
      const words: Record<string, string> = readDashboardLocale(language);

      renderFilter({
        "http.route": new Wildcard("/api/*"),
        "service.name": new NotWildcard("test-*"),
      });

      expect(screen.getByText(words["matches"]!)).toBeInTheDocument();
      expect(screen.getByText(words["does not match"]!)).toBeInTheDocument();
      expect(screen.queryByText("matches")).not.toBeInTheDocument();

      // The first row's operator picker: key, operator, type, value.
      fireEvent.keyDown(screen.getAllByRole("combobox")[1]!, {
        key: "ArrowDown",
      });
      const offered: Array<string> = screen
        .getAllByRole("option")
        .map((option: HTMLElement): string => {
          return option.textContent || "";
        });

      expect(offered).toEqual(
        DICTIONARY_FILTER_OPERATOR_OPTIONS.map(
          (option: DictionaryFilterOperatorOption): string => {
            return LETTER.test(option.symbol)
              ? words[option.symbol]!
              : option.symbol;
          },
        ),
      );
      expect(offered).not.toContain(
        nounOf(words["{{count}} matches"]) || "never",
      );
    },
  );

  /*
   * The picker is searchable: a reader types the operator as the menu
   * words it. It searched only the English, so "stimmt nicht" found
   * nothing in German, and the menu said "No options".
   */
  test.each(RENDERED)(
    "in %s, typing an operator as the menu words it finds it, and the English still does",
    async (language: string) => {
      await act(async (): Promise<void> => {
        await i18next.changeLanguage(language);
      });
      const words: Record<string, string> = readDashboardLocale(language);

      renderFilter({ "http.route": new Wildcard("/api/*") });

      const operatorPicker: HTMLElement = screen.getAllByRole("combobox")[1]!;
      const listed: () => Array<string> = (): Array<string> => {
        return Array.from(
          document.querySelectorAll<HTMLElement>(".ou-select__option"),
        ).map((option: HTMLElement): string => {
          return option.textContent || "";
        });
      };

      act(() => {
        fireEvent.change(operatorPicker, {
          target: { value: words["does not match"] },
        });
      });
      expect(listed()).toEqual([words["does not match"]]);

      act(() => {
        fireEvent.change(operatorPicker, { target: { value: "is any of" } });
      });
      expect(listed()).toEqual([words["is any of"]]);
    },
  );
});

/*
 * THE ADMIN DASHBOARD DRAWS THE SAME PICKER.
 *
 * Its locale files keep their own copy of each operator, and its copy of
 * "matches" was the count's noun in every language ("Treffer",
 * "résultats", "مورد منطبق"), with half the list still in English in
 * twelve of them. Each copy is worded as the Dashboard words it.
 */
describe("the Admin Dashboard words each operator as the Dashboard does", () => {
  function readAdminLocale(language: string): Record<string, string> {
    return JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          `../../../../App/FeatureSet/AdminDashboard/src/Locales/${language}.json`,
        ),
        "utf8",
      ),
    ) as Record<string, string>;
  }

  test.each(DASHBOARD_LANGUAGES)("%s", (language: string) => {
    const admin: Record<string, string> = readAdminLocale(language);
    const dashboard: Record<string, string> = readDashboardLocale(language);
    const differ: Array<string> = LABELS.filter((label: string): boolean => {
      return label in admin && admin[label] !== dashboard[label];
    });

    expect({ language, differ }).toEqual({ language, differ: [] });
  });

  test("the Admin Dashboard's files hold the operators the picker draws (control)", () => {
    const english: Record<string, string> = readAdminLocale("en");

    for (const label of ["matches", "does not match", "is any of"]) {
      expect(english[label]).toBe(label);
    }
  });

  test.each(["de", "fr", "fa", "ar"])(
    "in %s, the Admin Dashboard's matches is the verb, never the count's noun",
    (language: string) => {
      const word: string = readAdminLocale(language)["matches"] || "";

      expect(word.length).toBeGreaterThan(0);
      expect(isTheCountNoun(word, language)).toBe(false);
    },
  );
});

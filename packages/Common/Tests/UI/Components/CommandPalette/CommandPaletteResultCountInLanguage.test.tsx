import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import CommandPalette, {
  COMMAND_PALETTE_RESULT_COUNT,
} from "../../../../UI/Components/CommandPalette/CommandPalette";
import { PaletteCommand } from "../../../../UI/Components/CommandPalette/Types";
import { resetPageScrollLockForTesting } from "../../../../UI/Utils/PageScrollLock";
import { DASHBOARD_LANGUAGES } from "../../../Helpers/TranslatedLanguages";

/*
 * WHAT A SCREEN READER HEARS AFTER EVERY KEYSTROKE IN SEARCH, IN THE
 * READER'S LANGUAGE'S OWN PLURAL (#7485).
 *
 * Search's live region says how many rows the query found. It was built as
 * English builds it, one form for 1 and the other for every other count, so
 * Russian, which counts 1, 21 and 31 in one form, heard "Результатов: 21"
 * for "21 результат". It is one plural now ({{count}} result / results),
 * which i18next words by the language's own rule: Russian's general form
 * for 2-4, 5-20 and 22-24, its one form for 21; Arabic its general form for
 * every count, as its locale words it.
 *
 * This types into the palette until it finds 0, 1, 2, 5, 11, 21 and 22
 * rows, in English, Russian, Arabic and German, with the Dashboard's real locale
 * files behind a real i18next instance. A negative control words the counts
 * as the palette used to, and shows Russian's 21 come out wrong that way.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../../App/FeatureSet/Dashboard/src/Locales",
);

type LocaleTree = { [key: string]: string | LocaleTree };

function readLocale(language: string): LocaleTree {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as LocaleTree;
}

async function instanceFor(language: string): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      [language]: { translation: readLocale(language) },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
}

// Commands named "Widget 1" to "Widget <count>", in a category of their own.
function widgets(count: number): Array<PaletteCommand> {
  return Array.from(
    { length: count },
    (_: unknown, index: number): PaletteCommand => {
      return {
        id: `widget-${index + 1}`,
        title: `Widget ${index + 1}`,
        category: "Widgets",
        onSelect: (): void => {},
      };
    },
  );
}

// What the palette says once a query finds every widget (or none, for 0).
function heardFor(count: number): string {
  fireEvent.change(screen.getByTestId("command-palette-input"), {
    target: { value: count === 0 ? "zqxwv" : "Widget" },
  });

  expect(screen.queryAllByRole("option")).toHaveLength(count);

  return screen.getByTestId("command-palette-result-count").textContent || "";
}

async function renderIn(
  language: string,
  commands: Array<PaletteCommand>,
): Promise<void> {
  const instance: i18n = await instanceFor(language);

  await act(async () => {
    render(
      <I18nextProvider i18n={instance}>
        <CommandPalette commands={commands} isOpen={true} onClose={() => {}} />
      </I18nextProvider>,
    );
  });
}

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
});

afterEach(() => {
  cleanup();
  resetPageScrollLockForTesting();
});

describe("Search's result count", () => {
  test("is one plural of English's two forms, so every language words it by its own rule", () => {
    expect(COMMAND_PALETTE_RESULT_COUNT).toEqual({
      one: "{{count}} result",
      other: "{{count}} results",
    });

    const english: LocaleTree = readLocale("en");
    expect(english["{{count}} results"]).toBe("{{count}} results");
    expect(english["{{count}} results_one"]).toBe("{{count}} result");
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words both forms, and only those (no _few or _many, Locales/README.md)",
    (language: string) => {
      const locale: LocaleTree = readLocale(language);

      for (const key of ["{{count}} results", "{{count}} results_one"]) {
        expect(locale[key]).toEqual(expect.stringContaining("{{count}}"));
        expect(locale[key]).not.toBe(readLocale("en")[key]);
      }

      for (const form of ["zero", "two", "few", "many"]) {
        expect(locale[`{{count}} results_${form}`]).toBeUndefined();
      }
    },
  );
});

// The count as each language says it.
const COUNTS: Array<number> = [0, 1, 2, 5, 11, 21, 22];

const HEARD: Record<string, Record<number, string>> = {
  en: {
    0: "0 results",
    1: "1 result",
    2: "2 results",
    5: "5 results",
    11: "11 results",
    21: "21 results",
    22: "22 results",
  },
  // One form for 1 and 21 (one), the general form for 0, 2-4, 5-20 and 22.
  ru: {
    0: "Результатов: 0",
    1: "1 результат",
    2: "Результатов: 2",
    5: "Результатов: 5",
    11: "Результатов: 11",
    21: "21 результат",
    22: "Результатов: 22",
  },
  // Arabic words both forms alike, as a label and its count.
  ar: {
    0: "النتائج: 0",
    1: "النتائج: 1",
    2: "النتائج: 2",
    5: "النتائج: 5",
    11: "النتائج: 11",
    21: "النتائج: 21",
    22: "النتائج: 22",
  },
  de: {
    0: "0 Ergebnisse",
    1: "1 Ergebnis",
    2: "2 Ergebnisse",
    5: "5 Ergebnisse",
    11: "11 Ergebnisse",
    21: "21 Ergebnisse",
    22: "22 Ergebnisse",
  },
};

describe.each(Object.keys(HEARD))(
  "Search's result count in %s",
  (language: string) => {
    test.each(COUNTS)("said right for %s rows", async (count: number) => {
      await renderIn(language, widgets(count));

      expect(heardFor(count)).toBe(HEARD[language]![count]);
    });
  },
);

describe("the check itself (negative control)", () => {
  /*
   * The count as the palette used to word it: English's rule (one form for
   * 1, the other for every other count), each form looked up on its own.
   */
  function asEnglishWordsIt(language: string, count: number): string {
    const locale: LocaleTree = readLocale(language);
    const form: string =
      count === 1
        ? (locale["{{count}} results_one"] as string)
        : (locale["{{count}} results"] as string);

    return form.replace("{{count}}", String(count));
  }

  test("English's rule says Russian's 21 in the wrong form, and the palette does not", async () => {
    expect(asEnglishWordsIt("ru", 21)).toBe("Результатов: 21");
    expect(asEnglishWordsIt("ru", 21)).not.toBe(HEARD["ru"]![21]);

    await renderIn("ru", widgets(21));
    expect(heardFor(21)).not.toBe(asEnglishWordsIt("ru", 21));
  });

  test("for the counts English's rule gets right, the palette says the same", () => {
    for (const count of [1, 2, 5, 11, 22]) {
      expect(asEnglishWordsIt("ru", count)).toBe(HEARD["ru"]![count]);
      expect(asEnglishWordsIt("en", count)).toBe(HEARD["en"]![count]);
    }
  });
});

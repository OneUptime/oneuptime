import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { TableHeaderSearchSlot } from "../../../../UI/Components/Table/TableHeaderControls";
import {
  ExtractedString,
  scanSourceText,
} from "../../../../../App/FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
  readDashboardLocaleAsDrawn,
} from "../../../Helpers/DashboardLocales";

/*
 * EVERY WORD A LIST'S OWN CONTROLS SAY, IN EVERY LANGUAGE (#8148).
 *
 * Every list's search button is named "Open search" for a screen reader,
 * and 11 of the Dashboard's 17 languages held the English as its wording
 * (da, hi, it, ko, nl, no, pt, ru, sv, zh-CN, zh-TW): it is no text on the
 * screen, so the guards that read the screen never saw it. The same lists
 * of languages said the search's tooltip, the label filter's "Refine
 * search…", its keyboard hints, the column picker's "Add column" and every
 * saved view's dialog in English, on every list.
 *
 * Here every string the shared list draws - the table, its header controls,
 * the model table, its column picker and saved views, pagination, the
 * filters and the bulk actions - read as the extraction reads it, is worded
 * in every language: a value other than the English, or English the
 * language keeps on purpose (its same-as-English list). And the search
 * button is read as a screen reader names it, in English, German, Arabic
 * and Persian.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../../..");

const LIST_FOLDERS: ReadonlyArray<string> = [
  "packages/Common/UI/Components/Table",
  "packages/Common/UI/Components/ModelTable",
  "packages/Common/UI/Components/Pagination",
  "packages/Common/UI/Components/Filters",
  "packages/Common/UI/Components/BulkUpdate",
  "packages/Common/UI/Components/ActionButton",
];

const SOURCE_FILE: RegExp = /\.tsx?$/;

function listFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listFiles(full));
    } else if (SOURCE_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

// Every string the shared list's files draw, once each, with where it is.
function listStrings(): Array<ExtractedString> {
  const seen: Set<string> = new Set<string>();
  const strings: Array<ExtractedString> = [];

  for (const folder of LIST_FOLDERS) {
    for (const file of listFiles(path.join(REPOSITORY_ROOT, folder))) {
      const relative: string = path
        .relative(REPOSITORY_ROOT, file)
        .split(path.sep)
        .join("/");

      for (const entry of scanSourceText(
        relative,
        fs.readFileSync(file, "utf8"),
        { kind: "ui" },
      ).strings) {
        if (entry.nestedPath || seen.has(entry.text)) {
          continue;
        }

        seen.add(entry.text);
        strings.push(entry);
      }
    }
  }

  return strings;
}

// The 11 languages that named the search button in English, as each says it now.
const OPEN_SEARCH: Record<string, string> = {
  da: "Åbn søgning",
  hi: "खोज खोलें",
  it: "Apri ricerca",
  ko: "검색 열기",
  nl: "Zoeken openen",
  no: "Åpne søk",
  pt: "Abrir pesquisa",
  ru: "Открыть поиск",
  sv: "Öppna sökning",
  "zh-CN": "打开搜索",
  "zh-TW": "開啟搜尋",
};

describe("the shared list's words", () => {
  const STRINGS: Array<ExtractedString> = listStrings();

  test("the scan reads the list's controls", () => {
    expect(STRINGS.length).toBeGreaterThan(200);
    expect(
      STRINGS.map((entry: ExtractedString): string => {
        return entry.text;
      }),
    ).toEqual(
      expect.arrayContaining([
        "Open search",
        "Search (/)",
        "Refine search…",
        "Add column",
        "Save as New View",
        "Clear saved view",
      ]),
    );
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s: every one is worded, none left in English",
    (language: string) => {
      const english: Array<string> = STRINGS.filter(
        (entry: ExtractedString): boolean => {
          return !isWordedInDashboardLocale(entry.text, language);
        },
      ).map((entry: ExtractedString): string => {
        return `${entry.file}:${entry.line} ${entry.text}`;
      });

      expect(english).toEqual([]);
    },
  );

  test("the search button's name, in the 11 languages that said it in English", () => {
    expect(Object.keys(OPEN_SEARCH).sort()).toEqual(
      [
        "da",
        "hi",
        "it",
        "ko",
        "nl",
        "no",
        "pt",
        "ru",
        "sv",
        "zh-CN",
        "zh-TW",
      ].sort(),
    );

    for (const language of Object.keys(OPEN_SEARCH)) {
      expect({
        language,
        openSearch: readDashboardLocale(language)["Open search"],
      }).toEqual({ language, openSearch: OPEN_SEARCH[language] });
    }
  });

  test("the Admin Dashboard, which draws the same lists, names it alike", () => {
    for (const language of Object.keys(OPEN_SEARCH)) {
      const admin: Record<string, string> = JSON.parse(
        fs.readFileSync(
          path.join(
            REPOSITORY_ROOT,
            "packages/App/FeatureSet/AdminDashboard/src/Locales",
            `${language}.json`,
          ),
          "utf8",
        ),
      ) as Record<string, string>;

      expect({ language, openSearch: admin["Open search"] }).toEqual({
        language,
        openSearch: OPEN_SEARCH[language],
      });
    }
  });
});

const RENDERED: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const code of RENDERED) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: code,
      fallbackLng: "en",
      resources: {
        [code]: { translation: readDashboardLocaleAsDrawn(code) },
        en: { translation: readDashboardLocale("en") },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[code] = instance;
  }
});

afterEach(() => {
  cleanup();
});

describe.each(RENDERED)("a list's search, folded, in %s", (code: string) => {
  test("a screen reader names its button, and its tooltip, in the reader's words", () => {
    render(
      <I18nextProvider i18n={instances[code] as i18n}>
        <TableHeaderSearchSlot isOpen={false} onOpen={() => {}}>
          <input aria-label="search field" />
        </TableHeaderSearchSlot>
      </I18nextProvider>,
    );

    const words: Record<string, string> = readDashboardLocaleAsDrawn(code);
    const openSearch: string =
      code === "en" ? "Open search" : (words["Open search"] as string);
    const button: HTMLElement = screen.getByRole("button", {
      name: openSearch,
    });

    expect(button).toHaveAttribute(
      "title",
      code === "en" ? "Search (/)" : words["Search (/)"],
    );
  });
});

describe("the words, word for word", () => {
  test("German, Arabic and Persian name the search button", () => {
    expect(readDashboardLocale("de")["Open search"]).toBe("Suche öffnen");
    expect(readDashboardLocale("ar")["Open search"]).toBe("فتح البحث");
    expect(readDashboardLocale("fa")["Open search"]).toBe("باز کردن جستجو");
  });
});

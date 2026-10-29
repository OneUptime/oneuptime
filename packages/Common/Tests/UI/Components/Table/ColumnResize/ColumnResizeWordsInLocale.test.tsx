import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import ColumnResizeHandle, {
  COLUMN_RESIZE_HINT,
  COLUMN_RESIZE_NAME_TEMPLATE,
  COLUMN_RESIZE_WIDTH_TEMPLATE,
} from "../../../../../UI/Components/Table/ColumnResize/ColumnResizeHandle";
import { ColumnWidthKind } from "../../../../../UI/Components/Table/ColumnResize/ColumnWidths";
import ResetColumnWidthsButton, {
  RESET_COLUMN_WIDTHS_TEXT,
} from "../../../../../UI/Components/Table/ColumnResize/ResetColumnWidthsButton";

/*
 * What a column's edge and a table's reset say, in every language: the
 * edge's name ("Resize the Status column"), its hint under the pointer, its
 * width as a screen reader hears it, and "Reset column widths". Tables size
 * their columns in the Dashboard and in the Admin Dashboard, each of which
 * looks its words up in its own locale files - a word missing from one stays
 * English there - so both carry them, translated, with their placeholders.
 * Then the edge and the reset are drawn in German and in Persian, read from
 * the Dashboard's own files.
 */

const LOCALE_DIRECTORIES: Array<[string, string]> = [
  [
    "Dashboard",
    path.resolve(
      __dirname,
      "../../../../../../App/FeatureSet/Dashboard/src/Locales",
    ),
  ],
  [
    "Admin Dashboard",
    path.resolve(
      __dirname,
      "../../../../../../App/FeatureSet/AdminDashboard/src/Locales",
    ),
  ],
];

const OTHER_LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// Each key with the English it stands for.
const KEYS: Array<[string, string]> = [
  [COLUMN_RESIZE_NAME_TEMPLATE, COLUMN_RESIZE_NAME_TEMPLATE],
  [COLUMN_RESIZE_HINT, COLUMN_RESIZE_HINT],
  [COLUMN_RESIZE_WIDTH_TEMPLATE.other, COLUMN_RESIZE_WIDTH_TEMPLATE.other],
  [
    `${COLUMN_RESIZE_WIDTH_TEMPLATE.other}_one`,
    COLUMN_RESIZE_WIDTH_TEMPLATE.one,
  ],
  [RESET_COLUMN_WIDTHS_TEXT, RESET_COLUMN_WIDTHS_TEXT],
];

const PLACEHOLDER: RegExp = /{{\s*(\w+)\s*}}/g;

const placeholdersOf: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return (text.match(PLACEHOLDER) || []).sort();
};

const localeCache: Map<string, Record<string, unknown>> = new Map<
  string,
  Record<string, unknown>
>();

const readLocale: (
  directory: string,
  language: string,
) => Record<string, unknown> = (
  directory: string,
  language: string,
): Record<string, unknown> => {
  const file: string = path.join(directory, `${language}.json`);

  if (!localeCache.has(file)) {
    localeCache.set(
      file,
      JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>,
    );
  }

  return localeCache.get(file)!;
};

describe("the words of a column's edge in every language", () => {
  test("the words are the ones the edge and the reset look up", () => {
    expect(COLUMN_RESIZE_NAME_TEMPLATE).toBe("Resize the {{column}} column");
    expect(COLUMN_RESIZE_HINT).toBe("Drag to resize. Double-click to fit.");
    expect(COLUMN_RESIZE_WIDTH_TEMPLATE).toEqual({
      one: "{{count}} pixel wide",
      other: "{{count}} pixels wide",
    });
    expect(RESET_COLUMN_WIDTHS_TEXT).toBe("Reset column widths");
  });

  test.each(LOCALE_DIRECTORIES)(
    "the %s has each in English and translated in every other language, with its placeholders",
    (_name: string, directory: string) => {
      const english: Record<string, unknown> = readLocale(directory, "en");

      for (const [key, text] of KEYS) {
        expect([key, english[key]]).toEqual([key, text]);
      }

      for (const language of OTHER_LANGUAGES) {
        const locale: Record<string, unknown> = readLocale(directory, language);

        for (const [key, text] of KEYS) {
          const value: unknown = locale[key];

          expect([language, key, typeof value]).toEqual([
            language,
            key,
            "string",
          ]);
          expect([language, key, value === text]).toEqual([
            language,
            key,
            false,
          ]);
          expect([language, key, placeholdersOf(value as string)]).toEqual([
            language,
            key,
            placeholdersOf(text),
          ]);
        }
      }
    },
  );

  test.each(OTHER_LANGUAGES)(
    "%s words them the same in the Dashboard and the Admin Dashboard",
    (language: string) => {
      const dashboard: Record<string, unknown> = readLocale(
        LOCALE_DIRECTORIES[0]![1],
        language,
      );
      const admin: Record<string, unknown> = readLocale(
        LOCALE_DIRECTORIES[1]![1],
        language,
      );

      for (const [key] of KEYS) {
        expect([language, key, admin[key]]).toEqual([
          language,
          key,
          dashboard[key],
        ]);
      }
    },
  );
});

describe("a column's edge drawn in the reader's language", () => {
  const instances: Map<string, i18n> = new Map<string, i18n>();

  beforeAll(async () => {
    for (const language of ["de", "fa"]) {
      const locale: Record<string, unknown> = readLocale(
        LOCALE_DIRECTORIES[0]![1],
        language,
      );
      const translations: Record<string, string> = {};

      for (const [key] of KEYS) {
        translations[key] = locale[key] as string;
      }

      const instance: i18n = createInstance();

      await instance.init({
        lng: language,
        resources: { [language]: { translation: translations } },
        interpolation: { escapeValue: false },
        keySeparator: false,
        nsSeparator: false,
      });

      instances.set(language, instance);
    }
  });

  afterEach(() => {
    cleanup();
  });

  const drawEdge: (language: string) => void = (language: string): void => {
    const table: ReactElement = (
      <table>
        <thead>
          <tr>
            <th className="relative">
              Status
              <ColumnResizeHandle
                columnId="status"
                columnTitle="Status"
                kind={ColumnWidthKind.Text}
                width={240}
                onWidthChange={() => {}}
              />
            </th>
          </tr>
        </thead>
      </table>
    );

    render(
      <I18nextProvider i18n={instances.get(language)!}>
        {table}
        <ResetColumnWidthsButton onClick={() => {}} />
      </I18nextProvider>,
    );
  };

  test("in German: named after its column, with its hint, its width and the reset", () => {
    drawEdge("de");

    const edge: HTMLElement = screen.getByRole("separator", {
      name: "Breite der Spalte Status ändern",
    });

    expect(edge).toHaveAttribute(
      "title",
      "Zum Ändern der Breite ziehen. Zum Anpassen an den Inhalt doppelklicken.",
    );
    expect(edge).toHaveAttribute("aria-valuetext", "240 Pixel breit");
    expect(
      screen.getByRole("button", { name: "Spaltenbreiten zurücksetzen" }),
    ).toBeInTheDocument();
  });

  test("in Persian: the same, in its words", () => {
    drawEdge("fa");

    const edge: HTMLElement = screen.getByRole("separator", {
      name: "تغییر عرض ستون Status",
    });

    expect(edge.getAttribute("title")).toBe(
      "برای تغییر عرض بکشید. برای تنظیم عرض بر اساس محتوا دوبار کلیک کنید.",
    );
    expect(edge.getAttribute("aria-valuetext")).toContain("پیکسل");
    expect(
      screen.getByRole("button", { name: "بازنشانی عرض ستون‌ها" }),
    ).toBeInTheDocument();
  });
});

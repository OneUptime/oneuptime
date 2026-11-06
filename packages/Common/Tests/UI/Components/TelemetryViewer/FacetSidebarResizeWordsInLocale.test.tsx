import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import FacetSidebarResizeHandle, {
  FACET_SIDEBAR_RESIZE_HANDLE_TEST_ID,
  FACET_SIDEBAR_RESIZE_HINT,
  FACET_SIDEBAR_RESIZE_NAME,
  FACET_SIDEBAR_RESIZE_WIDTH_TEMPLATE,
} from "../../../../UI/Components/TelemetryViewer/components/FacetSidebarResizeHandle";
import {
  COLUMN_RESIZE_HINT,
  COLUMN_RESIZE_WIDTH_TEMPLATE,
} from "../../../../UI/Components/Table/ColumnResize/ColumnResizeHandle";

/*
 * What the filters sidebar's edge says, in every language: its name
 * ("Resize the filters"), its hint under the pointer, and its width as a
 * screen reader hears it. The telemetry explorers are the Dashboard's, which
 * looks its words up in its own locale files - a word missing from one
 * stays English there - so each carries them, translated, with their
 * placeholders. The hint and the width are a table column edge's own words,
 * so the two edges say the same thing in every language. Then the edge is
 * drawn in German and in Persian, read from the Dashboard's own files.
 */

const LOCALE_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../../../App/FeatureSet/Dashboard/src/Locales",
);

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
  [FACET_SIDEBAR_RESIZE_NAME, FACET_SIDEBAR_RESIZE_NAME],
  [FACET_SIDEBAR_RESIZE_HINT, FACET_SIDEBAR_RESIZE_HINT],
  [
    FACET_SIDEBAR_RESIZE_WIDTH_TEMPLATE.other,
    FACET_SIDEBAR_RESIZE_WIDTH_TEMPLATE.other,
  ],
  [
    `${FACET_SIDEBAR_RESIZE_WIDTH_TEMPLATE.other}_one`,
    FACET_SIDEBAR_RESIZE_WIDTH_TEMPLATE.one,
  ],
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

const readLocale: (language: string) => Record<string, unknown> = (
  language: string,
): Record<string, unknown> => {
  if (!localeCache.has(language)) {
    localeCache.set(
      language,
      JSON.parse(
        fs.readFileSync(
          path.join(LOCALE_DIRECTORY, `${language}.json`),
          "utf8",
        ),
      ) as Record<string, unknown>,
    );
  }

  return localeCache.get(language)!;
};

describe("the words of the filters sidebar's edge in every language", () => {
  test("the words are the ones the edge looks up", () => {
    expect(FACET_SIDEBAR_RESIZE_NAME).toBe("Resize the filters");
    expect(FACET_SIDEBAR_RESIZE_HINT).toBe(
      "Drag to resize. Double-click to fit.",
    );
    expect(FACET_SIDEBAR_RESIZE_WIDTH_TEMPLATE).toEqual({
      one: "{{count}} pixel wide",
      other: "{{count}} pixels wide",
    });
  });

  test("its hint and its width are a table column edge's own words", () => {
    expect(FACET_SIDEBAR_RESIZE_HINT).toBe(COLUMN_RESIZE_HINT);
    expect(FACET_SIDEBAR_RESIZE_WIDTH_TEMPLATE).toEqual(
      COLUMN_RESIZE_WIDTH_TEMPLATE,
    );
  });

  test("the Dashboard has each in English", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const [key, text] of KEYS) {
      expect([key, english[key]]).toEqual([key, text]);
    }
  });

  test.each(OTHER_LANGUAGES)(
    "%s has each translated, with its placeholders",
    (language: string) => {
      const locale: Record<string, unknown> = readLocale(language);

      for (const [key, text] of KEYS) {
        const value: unknown = locale[key];

        expect([language, key, typeof value]).toEqual([
          language,
          key,
          "string",
        ]);
        expect([language, key, value === text]).toEqual([language, key, false]);
        expect([language, key, placeholdersOf(value as string)]).toEqual([
          language,
          key,
          placeholdersOf(text),
        ]);
      }
    },
  );
});

describe("the filters sidebar's edge drawn in the reader's language", () => {
  const instances: Map<string, i18n> = new Map<string, i18n>();

  beforeAll(async () => {
    for (const language of ["de", "fa"]) {
      const locale: Record<string, unknown> = readLocale(language);
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

  const drawEdge: (language: string, width: number | null) => HTMLElement = (
    language: string,
    width: number | null,
  ): HTMLElement => {
    const edge: ReactElement = (
      <FacetSidebarResizeHandle
        panelRef={React.createRef<HTMLElement>()}
        width={width}
        onWidthChange={(): void => {}}
      />
    );

    render(
      <I18nextProvider i18n={instances.get(language)!}>{edge}</I18nextProvider>,
    );

    return screen.getByTestId(FACET_SIDEBAR_RESIZE_HANDLE_TEST_ID);
  };

  test("in German: its name, the column edge's hint, and its width", () => {
    const handle: HTMLElement = drawEdge("de", 320);

    expect(
      screen.getByRole("separator", { name: "Breite der Filter ändern" }),
    ).toBe(handle);
    expect(handle).toHaveAttribute(
      "title",
      "Zum Ändern der Breite ziehen. Zum Anpassen an den Inhalt doppelklicken.",
    );
    expect(handle).toHaveAttribute("aria-valuetext", "320 Pixel breit");
  });

  test("in Persian: the same, in its words", () => {
    const handle: HTMLElement = drawEdge("fa", 224);

    expect(screen.getByRole("separator", { name: "تغییر عرض فیلترها" })).toBe(
      handle,
    );
    expect(handle.getAttribute("title")).toBe(
      "برای تغییر عرض بکشید. برای تنظیم عرض بر اساس محتوا دوبار کلیک کنید.",
    );
    expect(handle.getAttribute("aria-valuetext")).toContain("پیکسل");
  });
});

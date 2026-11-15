import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, RenderResult } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import {
  DASH_PLACEHOLDERS,
  EMPTY_VALUE_MARK,
  isNoValue,
} from "../../../../UI/Components/Detail/EmptyValue";
import TableEmptyValue, {
  getValueOrQuietDash,
  isEmptyValueElement,
  TABLE_EMPTY_VALUE_SMALL_CLASS_NAME,
  TABLE_EMPTY_VALUE_TEST_ID,
} from "../../../../UI/Components/Table/TableEmptyValue";
import { isEmptyFigure } from "../../../../UI/Components/EmptyFigure/EmptyFigure";
import InfoCard from "../../../../UI/Components/InfoCard/InfoCard";
import { readDashboardLocale } from "../../../Helpers/DashboardLocales";

/*
 * A FORMATTER'S MARK FOR NOTHING, DRAWN AS THE QUIET DASH (#8262).
 *
 * Formatters wrote a dash of their own for a value that was not there -
 * `return "—"`, `return "-"`, `return "–"`, `x || "—"` - about five hundred
 * of them, and pages drew the text straight into their own elements, out
 * of HandWrittenEmptyValueGuard's sight: a bare dash with nothing for a
 * screen reader, in three different widths. A formatter now writes the one
 * shared mark (EMPTY_VALUE_MARK), which a plain-text consumer shows as it
 * is, and a page draws its text through getValueOrQuietDash, which draws
 * the quiet dash for the mark.
 */

type Language = "en" | "de" | "ar" | "fa";

const LANGUAGES: ReadonlyArray<Language> = ["en", "de", "ar", "fa"];

const NOT_SET: Record<Language, string> = {
  en: "Not set",
  de: "Nicht festgelegt",
  ar: "غير معيّن",
  fa: "تنظیم نشده",
};

const instances: Partial<Record<Language, i18n>> = {};

beforeAll(async () => {
  for (const language of LANGUAGES) {
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
});

function renderIn(
  language: Language,
  element: React.ReactElement,
): RenderResult {
  return render(
    <I18nextProvider i18n={instances[language]!}>{element}</I18nextProvider>,
  );
}

// What a screen reader hears: the text outside aria-hidden.
function spokenText(element: Element): string {
  const copy: Element = element.cloneNode(true) as Element;

  copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden: Element) => {
    hidden.remove();
  });

  return (copy.textContent || "").trim();
}

describe("the shared plain-text mark", () => {
  test("is the em dash every quiet dash draws, one of the marks read as nothing", () => {
    expect(EMPTY_VALUE_MARK).toBe("—");
    expect(DASH_PLACEHOLDERS).toContain(EMPTY_VALUE_MARK);
  });
});

describe("isNoValue", () => {
  test.each([
    [undefined],
    [null],
    [""],
    ["  "],
    ["-"],
    ["–"],
    ["—"],
    [EMPTY_VALUE_MARK],
    [` ${EMPTY_VALUE_MARK} `],
  ])("a value a component does not have: %p", (value: unknown) => {
    expect(isNoValue(value)).toBe(true);
  });

  test.each([
    ["0"],
    [0],
    ["0 B"],
    ["-1"],
    ["-12 ms"],
    ["--"],
    ["e-mail"],
    ["Never"],
    [false],
  ])("a value it has, a zero and a minus among them: %p", (value: unknown) => {
    expect(isNoValue(value)).toBe(false);
  });

  test("an element is a value it has", () => {
    expect(isNoValue(<span>{EMPTY_VALUE_MARK}</span>)).toBe(false);
  });

  test("is what a tile reads as no reading, too", () => {
    for (const value of [undefined, null, "", "-", EMPTY_VALUE_MARK, "0"]) {
      expect([value, isEmptyFigure(value)]).toEqual([value, isNoValue(value)]);
    }
  });
});

describe("getValueOrQuietDash", () => {
  test.each(
    LANGUAGES.flatMap((language: Language) => {
      return [undefined, null, "", "-", "–", EMPTY_VALUE_MARK].map(
        (
          value: string | null | undefined,
        ): [Language, string | null | undefined] => {
          return [language, value];
        },
      );
    }),
  )(
    "in %s, draws the quiet dash for %p, read out as 'Not set'",
    (language: Language, value: string | null | undefined) => {
      const { container, getByTestId } = renderIn(
        language,
        <td>{getValueOrQuietDash(value)}</td>,
      );

      expect(getByTestId(TABLE_EMPTY_VALUE_TEST_ID)).toBeInTheDocument();
      expect(spokenText(container)).toBe(NOT_SET[language]);
      expect(container.textContent).toBe(
        `${EMPTY_VALUE_MARK}${NOT_SET[language]}`,
      );
    },
  );

  test("a line of small text draws the small quiet dash", () => {
    const { getByTestId } = renderIn(
      "en",
      <td>{getValueOrQuietDash(EMPTY_VALUE_MARK, { isSmall: true })}</td>,
    );

    expect(getByTestId(TABLE_EMPTY_VALUE_TEST_ID).className).toBe(
      TABLE_EMPTY_VALUE_SMALL_CLASS_NAME,
    );
  });

  test("hands its words to the quiet dash", () => {
    const { container } = renderIn(
      "de",
      <td>
        {getValueOrQuietDash(undefined, { screenReaderText: "No data" })}
      </td>,
    );

    expect(spokenText(container)).toBe(readDashboardLocale("de")["No data"]);
  });

  test("draws a value it has as given", () => {
    const { container, queryByTestId } = renderIn(
      "fa",
      <td>
        {getValueOrQuietDash("۱۲ GiB")}
        {getValueOrQuietDash(0)}
        {getValueOrQuietDash("-3 ms")}
        {getValueOrQuietDash(<b>7</b>)}
      </td>,
    );

    expect(container.textContent).toBe("۱۲ GiB0-3 ms7");
    expect(queryByTestId(TABLE_EMPTY_VALUE_TEST_ID)).toBeNull();
  });

  test("is the quiet dash a phone's card leaves out", () => {
    expect(isEmptyValueElement(getValueOrQuietDash(EMPTY_VALUE_MARK))).toBe(
      true,
    );
    expect(isEmptyValueElement(<p>{getValueOrQuietDash(undefined)}</p>)).toBe(
      true,
    );
    expect(isEmptyValueElement(getValueOrQuietDash("12"))).toBe(false);
    expect(
      React.isValidElement(getValueOrQuietDash("")) &&
        (getValueOrQuietDash("") as React.ReactElement).type ===
          TableEmptyValue,
    ).toBe(true);
  });
});

describe("InfoCard", () => {
  test.each(
    LANGUAGES.map((language: Language) => {
      return [language];
    }),
  )(
    "in %s, a card handed no value draws the figure's quiet dash",
    (language: Language) => {
      const { getByTestId } = renderIn(language, <InfoCard title="Pods" />);

      expect(spokenText(getByTestId("info-card-value"))).toBe(
        NOT_SET[language],
      );
    },
  );
});

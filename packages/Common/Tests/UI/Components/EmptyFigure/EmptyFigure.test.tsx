import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, RenderResult } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import EmptyFigure, {
  EMPTY_FIGURE_CLASS_NAME,
  EMPTY_FIGURE_DEFAULT_WORDS,
  EMPTY_FIGURE_TEST_ID,
  getFigure,
  isEmptyFigure,
} from "../../../../UI/Components/EmptyFigure/EmptyFigure";
import { EMPTY_VALUE_MARK } from "../../../../UI/Components/Detail/EmptyValue";
import { TABLE_EMPTY_VALUE_CLASS_NAME } from "../../../../UI/Components/Table/TableEmptyValue";
import InfoCard from "../../../../UI/Components/InfoCard/InfoCard";
import { readDashboardLocale } from "../../../Helpers/DashboardLocales";

/*
 * A STAT TILE'S FIGURE WITH NO READING: THE QUIET DASH AT THE FIGURE'S
 * SIZE (#8264).
 *
 * Tiles drew a bare em dash of their own for a reading they did not have,
 * in whatever grey the page picked (grey-300 beside grey-400 beside the
 * figure's own grey-900), and a screen reader heard "dash", or nothing,
 * where the table beside them said "Not set". EmptyFigure is one mark for
 * every figure: the em dash, hidden from a screen reader, in the grey of
 * every other empty value, at the size of the figure it sits in, with
 * "Not set" read out in the reader's language.
 */

type Language = "en" | "de" | "ar" | "fa";

const LANGUAGES: ReadonlyArray<Language> = ["en", "de", "ar", "fa"];

// "Not set" as each language words it, from the Dashboard's locale files.
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

describe("EmptyFigure", () => {
  test("the locale files word 'Not set' as these tests read it", () => {
    for (const language of LANGUAGES) {
      expect([language, readDashboardLocale(language)["Not set"]]).toEqual([
        language,
        NOT_SET[language],
      ]);
    }
  });

  test.each(
    LANGUAGES.map((language: Language) => {
      return [language];
    }),
  )(
    "draws the em dash for the eye and 'Not set' for a screen reader, in %s",
    (language: Language) => {
      const { getByTestId } = renderIn(language, <EmptyFigure />);
      const figure: HTMLElement = getByTestId(EMPTY_FIGURE_TEST_ID);

      // The mark is the em dash every empty value is drawn as, hidden.
      const mark: Element = figure.querySelector('[aria-hidden="true"]')!;
      expect(mark.textContent).toBe(EMPTY_VALUE_MARK);
      expect(EMPTY_VALUE_MARK).toBe("—");

      // The words are the reader's, and only a screen reader reads them.
      const words: Element = figure.querySelector(".sr-only")!;
      expect(words.textContent).toBe(NOT_SET[language]);
      expect(spokenText(figure)).toBe(NOT_SET[language]);

      // Never a hyphen, nor a dash a screen reader would read out.
      expect(spokenText(figure)).not.toMatch(/[-–—]/);
    },
  );

  test("one grey for every figure, the grey of the table's quiet dash, at the figure's own size", () => {
    const { getByTestId } = renderIn("en", <EmptyFigure />);
    const figure: HTMLElement = getByTestId(EMPTY_FIGURE_TEST_ID);
    const classes: Array<string> = EMPTY_FIGURE_CLASS_NAME.split(" ");

    expect(figure.className).toBe(EMPTY_FIGURE_CLASS_NAME);
    // The table's grey, so a tile and the table under it draw one nothing.
    expect(classes).toContain("text-gray-400");
    expect(TABLE_EMPTY_VALUE_CLASS_NAME.split(" ")).toContain("text-gray-400");
    // No size and no line of its own: the figure's, which it is drawn in.
    const sizeOrLine: RegExp =
      /^(text-(xs|sm|base|lg|[0-9]?xl)|leading-|font-)/;
    expect(
      classes.filter((name: string): boolean => {
        return sizeOrLine.test(name);
      }),
    ).toEqual([]);
    // The sr-only words stay inside its own box (position: absolute).
    expect(classes).toContain("relative");
  });

  test("a figure's dash takes its figure's size", () => {
    const { container } = renderIn(
      "en",
      <div className="text-2xl font-semibold" data-testid="figure">
        <EmptyFigure />
      </div>,
    );

    const figure: Element = container.querySelector(
      `[data-testid="${EMPTY_FIGURE_TEST_ID}"]`,
    )!;
    expect(figure.parentElement!.className).toBe("text-2xl font-semibold");
  });

  test.each(
    LANGUAGES.map((language: Language) => {
      return [language];
    }),
  )("a tile's own words for a screen reader, in %s", (language: Language) => {
    const { getByTestId } = renderIn(
      language,
      <EmptyFigure screenReaderText="No data" />,
    );

    const words: string = readDashboardLocale(language)["No data"] || "";
    expect(words.length).toBeGreaterThan(0);
    expect(spokenText(getByTestId(EMPTY_FIGURE_TEST_ID))).toBe(words);
  });

  test.each([["-"], ["—"], ["–"], [" "], [""]])(
    "words that are only a dash, or blank, are 'Not set': %p",
    (words: string) => {
      const { getByTestId } = renderIn(
        "de",
        <EmptyFigure screenReaderText={words} />,
      );

      expect(spokenText(getByTestId(EMPTY_FIGURE_TEST_ID))).toBe(NOT_SET.de);
    },
  );

  test("its default words are the shared quiet dash's", () => {
    expect(EMPTY_FIGURE_DEFAULT_WORDS).toBe("Not set");
  });
});

describe("isEmptyFigure", () => {
  test.each([[undefined], [null], [""], ["   "], ["-"], ["–"], ["—"], [" — "]])(
    "a figure the tile does not have: %p",
    (value: unknown) => {
      expect(isEmptyFigure(value)).toBe(true);
    },
  );

  test.each([
    ["0"],
    [0],
    ["0%"],
    ["-1"],
    ["-12 ms"],
    ["--"],
    ["12 / 40"],
    ["Covered"],
    [false],
  ])(
    "a figure the tile has, a zero and a negative among them: %p",
    (value: unknown) => {
      expect(isEmptyFigure(value)).toBe(false);
    },
  );

  test("an element is a figure the tile has", () => {
    expect(isEmptyFigure(<span>12</span>)).toBe(false);
  });
});

describe("getFigure", () => {
  test.each([[undefined], [null], [""], ["-"], ["—"]])(
    "draws EmptyFigure for %p",
    (value: string | null | undefined) => {
      const { getByTestId, container } = renderIn(
        "fa",
        <div>{getFigure(value)}</div>,
      );

      expect(getByTestId(EMPTY_FIGURE_TEST_ID)).toBeInTheDocument();
      expect(spokenText(container)).toBe(NOT_SET.fa);
    },
  );

  test("hands its words to EmptyFigure", () => {
    const { container } = renderIn(
      "ar",
      <div>{getFigure(undefined, { screenReaderText: "No data" })}</div>,
    );

    expect(spokenText(container)).toBe(readDashboardLocale("ar")["No data"]);
  });

  test("draws a figure it has as given", () => {
    const { container, queryByTestId } = renderIn(
      "en",
      <div>
        {getFigure("42 ms")}
        {getFigure(<b>7</b>)}
      </div>,
    );

    expect(container.textContent).toBe("42 ms7");
    expect(queryByTestId(EMPTY_FIGURE_TEST_ID)).toBeNull();
  });
});

describe("InfoCard", () => {
  test.each(
    LANGUAGES.map((language: Language) => {
      return [language];
    }),
  )(
    "a value it does not have is the figure's quiet dash, in %s",
    (language: Language) => {
      for (const value of ["", "-", "—"]) {
        const { getByTestId, unmount } = renderIn(
          language,
          <InfoCard title="Pods" value={value} />,
        );

        const drawn: HTMLElement = getByTestId("info-card-value");
        expect(
          drawn.querySelector(`[data-testid="${EMPTY_FIGURE_TEST_ID}"]`),
        ).not.toBeNull();
        expect(spokenText(drawn)).toBe(NOT_SET[language]);
        unmount();
      }
    },
  );

  test("a value it has reads as before", () => {
    const { getByTestId } = renderIn(
      "en",
      <InfoCard title="Pods" value="12" />,
    );

    expect(getByTestId("info-card-value")).toHaveTextContent("12");
    expect(
      getByTestId("info-card-value").querySelector(
        `[data-testid="${EMPTY_FIGURE_TEST_ID}"]`,
      ),
    ).toBeNull();
  });

  test("a clickable card with no value is named by its title, not by a dash", () => {
    const { getByRole } = renderIn(
      "en",
      <InfoCard
        title="Pods"
        value="—"
        tooltip="Pods in the cluster."
        onClick={() => {}}
      />,
    );

    expect(getByRole("button", { name: "Pods" })).toBeInTheDocument();
  });
});

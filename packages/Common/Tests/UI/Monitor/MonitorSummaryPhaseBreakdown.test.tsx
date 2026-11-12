import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, RenderResult } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import HttpTimingsView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/HttpTimingsView";
import PortTimingsView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/PortTimingsView";
import {
  SUMMARY_FACT_SHARE_CLASS_NAME,
  TIMING_BAR_TRACK_CLASS_NAME,
  TIMING_LABEL_CLASS_NAME,
  TIMING_ROW_TEST_ID,
  TIMING_ROWS_CLASS_NAME,
  TIMING_VALUE_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryFacts";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A CHECK'S PHASE BREAKDOWN, IN EVERY LANGUAGE AND AT EVERY WIDTH.
 *
 * A Website or API check's Request Phase Breakdown and a Port check's
 * Connection Phase Breakdown draw a row a phase: its name, a bar for its
 * share of the time, and its time. The times sat in a fixed column 80px
 * wide (96px from 32rem), in a monospace font, and the names in one 96px
 * wide (144px from 32rem). Once each time was written in the reader's
 * language (#7224), a Persian "۱۲٫۳ میلی‌ثانیه" broke onto two lines in
 * it, and the monospace font drew its Persian and Arabic letters apart,
 * unjoined; a German "TCP-Verbindungsaufbau" broke mid-word.
 *
 * Now the rows are one grid, each row a subgrid of it, so every bar
 * starts and ends where the others do: the names as wide as the longest
 * name (at most two fifths of the row unless one word is longer), the
 * times as wide as the longest time, each on one line in the page's own
 * font, and the bars what is left. On a phone (below 22rem, where the
 * summary's facts go one to a row) the name and the time share a line and
 * the bar runs the whole row under them.
 *
 * jsdom lays nothing out: these tests hold the classes that ask the
 * browser for it. The UI review measured it in Chromium at 320, 360, 390,
 * 768, 1024 and 1280 in English, German, Japanese, Arabic and Persian.
 */

type Language = "en" | "de" | "ar" | "fa";

const WIDE: string = "[@container(min-width:22rem)]";
const ZWNJ: string = "\u{200C}";

// A whole Persian time: Persian digits and separators, then the unit.
const PERSIAN_TIME: RegExp = new RegExp(
  `^[\u{06F0}-\u{06F9}\u{066B}\u{066C}]+ میلی${ZWNJ}ثانیه$`,
  "u",
);

// A whole Arabic time: Latin digits, as Arabic pages write them, then the unit.
const ARABIC_TIME: RegExp = /^[0-9.,]+ ملي ث$/;

const ARABIC_LETTER: RegExp = /[\u{0600}-\u{06FF}]/u;

// A fixed width, at any container width: w-20, [@container(...)]:w-24.
const FIXED_WIDTH_CLASS: RegExp = /^(?:\[@container[^\]]*\]:)?w-/;

const WHITESPACE: RegExp = /\s+/;

const instances: Partial<Record<Language, i18n>> = {};

beforeAll(async () => {
  for (const language of ["en", "de", "ar", "fa"] as Array<Language>) {
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

const classesOf: (className: string) => Array<string> = (
  className: string,
): Array<string> => {
  return className.split(WHITESPACE).filter(Boolean);
};

const drawHttp: (language: Language) => RenderResult = (
  language: Language,
): RenderResult => {
  return render(
    <I18nextProvider i18n={instances[language]!}>
      <HttpTimingsView
        httpTimings={{
          dnsLookupInMs: 12.3,
          tcpConnectInMs: 31.2749,
          tlsHandshakeInMs: 45,
          timeToFirstByteInMs: 11234.5,
          downloadInMs: 8.125,
        }}
      />
    </I18nextProvider>,
  );
};

const drawPort: (language: Language) => RenderResult = (
  language: Language,
): RenderResult => {
  return render(
    <I18nextProvider i18n={instances[language]!}>
      <PortTimingsView
        portTimings={{
          dnsLookupInMs: 1203.456,
          tcpConnectInMs: 42.2,
          totalConnectionInMs: 1245.678,
        }}
      />
    </I18nextProvider>,
  );
};

const BREAKDOWNS: Array<[string, (language: Language) => RenderResult]> = [
  ["a request's phases (HttpTimingsView)", drawHttp],
  ["a connection's phases (PortTimingsView)", drawPort],
];

// A breakdown's rows: each phase's row, under one grid.
const rowsOf: (container: HTMLElement) => Array<HTMLElement> = (
  container: HTMLElement,
): Array<HTMLElement> => {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      `[data-testid="${TIMING_ROW_TEST_ID}"]`,
    ),
  );
};

describe.each(BREAKDOWNS)(
  "%s",
  (_name: string, draw: (language: Language) => RenderResult) => {
    test("its rows are one grid, each row a subgrid of it, so the bars line up", () => {
      const { container } = draw("en");
      const rows: Array<HTMLElement> = rowsOf(container);

      expect(rows.length).toBeGreaterThan(1);

      const grid: HTMLElement = rows[0]!.parentElement!;

      expect(grid).toHaveClass(...classesOf(TIMING_ROWS_CLASS_NAME));
      expect(grid).toHaveClass("grid");

      for (const row of rows) {
        // Every row sits straight in the one grid.
        expect(row.parentElement).toBe(grid);
        expect(row).toHaveClass("col-span-full", "grid", "grid-cols-subgrid");
        // Name, bar, time, in that order.
        expect(row.children).toHaveLength(3);
        expect(row.children[0]).toHaveClass(
          ...classesOf(TIMING_LABEL_CLASS_NAME),
        );
        expect(row.children[1]).toHaveClass(
          ...classesOf(TIMING_BAR_TRACK_CLASS_NAME),
        );
        expect(row.children[2]).toHaveClass(
          ...classesOf(TIMING_VALUE_CLASS_NAME),
        );
      }
    });

    test("no part of it is drawn in a monospace font, which would draw Arabic and Persian letters unjoined", () => {
      const { container } = draw("fa");

      expect(container.innerHTML).not.toContain("font-mono");
    });

    test("in Persian, each time reads whole, in Persian digits and the Persian unit", () => {
      const { container } = draw("fa");

      for (const row of rowsOf(container)) {
        const time: string = withoutIsolateMarks(
          row.children[2]!.textContent || "",
        );

        expect(time).toMatch(PERSIAN_TIME);
      }
    });

    test("in Arabic, each name is worded and each time ends in the Arabic unit", () => {
      const { container } = draw("ar");

      for (const row of rowsOf(container)) {
        expect(row.children[0]!.textContent).toMatch(ARABIC_LETTER);
        expect(withoutIsolateMarks(row.children[2]!.textContent || "")).toMatch(
          ARABIC_TIME,
        );
      }
    });
  },
);

describe("a phase's time", () => {
  test("stays on one line, its digits of one width, at the end of its row", () => {
    expect(classesOf(TIMING_VALUE_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        "whitespace-nowrap",
        "tabular-nums",
        // Left and right follow the reading direction: the row's end.
        "text-right",
      ]),
    );
  });

  test("never a fixed width a longer language's time cannot fit", () => {
    for (const className of classesOf(TIMING_VALUE_CLASS_NAME)) {
      expect(className).not.toMatch(FIXED_WIDTH_CLASS);
      expect(className).not.toBe("font-mono");
    }
  });

  test("its column is as wide as the longest time ('auto'), the bars the rest", () => {
    expect(TIMING_ROWS_CLASS_NAME).toContain("grid-cols-[minmax(0,1fr)_auto]");
    expect(TIMING_ROWS_CLASS_NAME).toContain(
      `${WIDE}:grid-cols-[fit-content(40%)_minmax(0,1fr)_auto]`,
    );
  });
});

describe("a phase's name", () => {
  test("breaks between words, never inside one, and takes no fixed width", () => {
    const classes: Array<string> = classesOf(TIMING_LABEL_CLASS_NAME);

    expect(classes).toContain("break-words");
    expect(classes).not.toContain("[overflow-wrap:anywhere]");
    expect(classes).not.toContain("break-all");

    for (const className of classes) {
      expect(className).not.toMatch(FIXED_WIDTH_CLASS);
    }
  });

  test("in German, the long name is the language's whole word", () => {
    const { container } = drawPort("de");
    const names: Array<string> = rowsOf(container).map(
      (row: HTMLElement): string => {
        return row.children[0]!.textContent || "";
      },
    );

    expect(names).toEqual([
      readDashboardLocale("de")["DNS Lookup"],
      readDashboardLocale("de")["TCP Connect"],
    ]);
  });
});

describe("on a phone and wider", () => {
  test("below 22rem, the name and the time share the first line and the bar runs the whole row under them", () => {
    expect(classesOf(TIMING_LABEL_CLASS_NAME)).toEqual(
      expect.arrayContaining(["col-start-1", "row-start-1"]),
    );
    expect(classesOf(TIMING_VALUE_CLASS_NAME)).toEqual(
      expect.arrayContaining(["col-start-2", "row-start-1"]),
    );
    expect(classesOf(TIMING_BAR_TRACK_CLASS_NAME)).toEqual(
      expect.arrayContaining(["col-span-full", "row-start-2", "min-w-0"]),
    );
  });

  test("from 22rem, a row reads name, bar, time on one line", () => {
    expect(classesOf(TIMING_BAR_TRACK_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        `${WIDE}:col-span-1`,
        `${WIDE}:col-start-2`,
        `${WIDE}:row-start-1`,
      ]),
    );
    expect(classesOf(TIMING_VALUE_CLASS_NAME)).toContain(`${WIDE}:col-start-3`);
  });

  test("the width it changes at is the one where the summary's facts go two to a row", () => {
    expect(SUMMARY_FACT_SHARE_CLASS_NAME).toContain(`${WIDE}:`);
    expect(TIMING_ROWS_CLASS_NAME).toContain(`${WIDE}:`);
  });

  test("each bar is its phase's share of the total, at least a sliver", () => {
    const { container } = drawPort("en");
    const widths: Array<string> = rowsOf(container).map(
      (row: HTMLElement): string => {
        return (row.children[1]!.firstElementChild as HTMLElement).style.width;
      },
    );

    // 1203.456 and 42.2 of 1245.678 ms.
    expect(parseFloat(widths[0]!)).toBeCloseTo(96.61, 1);
    expect(parseFloat(widths[1]!)).toBeCloseTo(3.39, 1);
  });
});

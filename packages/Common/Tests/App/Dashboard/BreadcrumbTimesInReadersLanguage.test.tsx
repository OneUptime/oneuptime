import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import BreadcrumbTimeline, {
  BreadcrumbEvent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/BreadcrumbTimeline";
import {
  AT_EXCEPTION_TEXT,
  describeBreadcrumbWindow,
  EVENTS_AROUND_THE_EXCEPTION_TEMPLATE,
  EVENTS_BEFORE_THE_EXCEPTION_TEMPLATE,
  EVENTS_MATCHING_THE_FILTERS_TEMPLATE,
  EVENTS_TEMPLATE,
  formatBreadcrumbOffset,
  formatBreadcrumbSpan,
  LATEST_OF_TOTAL_TEMPLATE,
  MINUTES_AND_SECONDS_TEMPLATE,
  MINUTES_TEMPLATE,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/BreadcrumbTimelinePresentation";
import { JSONObject } from "../../../Types/JSON";
import { PluralTemplate, Translator } from "../../../Types/Translator";
import { drawLine, getDrawnText } from "../../Helpers/BidiLayout";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * THE EXCEPTION BREADCRUMBS' TIMES AND COUNTS, IN THE READER'S LANGUAGE
 * (#7726).
 *
 * The Breadcrumbs card on an exception's page wrote its own English: the
 * exception's row "at exception", the rows around it "-1.2 s" and "-2 m
 * 5 s" (an English decimal point, Latin digits and English units on every
 * page), and its description "8 events in the 12 s before the exception",
 * with "event" or "events" chosen in code. Each is now a key every
 * language words, its figures written the reader's way and its count in
 * the language's plural. With no reader's translator, or with the English
 * one, each reads word for word as before. The milliseconds ("-880 ms")
 * are #7418's and stay as they were.
 */

const EXCEPTION_TIME: Date = new Date("2026-09-14T11:56:00.000Z");

// The left-to-right mark Intl writes before a Persian sign, and Persian's minus.
const LRM: string = String.fromCodePoint(0x200e);
const MINUS: string = String.fromCodePoint(0x2212);

const LATIN_DIGIT: RegExp = /[0-9]/;
const LATIN_LETTER: RegExp = /[A-Za-z]/;

const english: Translator = dashboardTranslator("en");
const german: Translator = dashboardTranslator("de");
const persian: Translator = dashboardTranslator("fa");
const arabic: Translator = dashboardTranslator("ar");

// An event's time `ms` from the exception, as the Relative format writes it.
const offset: (ms: number, translator?: Translator) => string = (
  ms: number,
  translator?: Translator,
): string => {
  return (
    formatBreadcrumbOffset(
      new Date(EXCEPTION_TIME.getTime() + ms),
      EXCEPTION_TIME,
      translator,
    ) || ""
  );
};

interface EventWindow {
  shownCount: number;
  totalCount?: number;
  filteredCount?: number;
  // How long before the exception the first event is; left out: no exception time.
  msBefore?: number;
}

// The card's description of a window of events.
const describeWindow: (
  window: EventWindow,
  translator?: Translator,
) => string = (window: EventWindow, translator?: Translator): string => {
  const hasTimes: boolean = window.msBefore !== undefined;

  return describeBreadcrumbWindow({
    shownCount: window.shownCount,
    totalCount: window.totalCount ?? window.shownCount,
    filteredCount: window.filteredCount,
    firstTime: hasTimes
      ? new Date(EXCEPTION_TIME.getTime() - (window.msBefore as number))
      : undefined,
    exceptionTime: hasTimes ? EXCEPTION_TIME : undefined,
    translator: translator,
  });
};

// How a page read from the right draws `text`, from left to right.
const drawnFromTheRight: (text: string) => string = (text: string): string => {
  return getDrawnText(drawLine(text, "rtl"));
};

describe.each([
  ["handed no translator", undefined],
  ["handed the English one", english],
])(
  "in English, %s: word for word as before",
  (_handed: string, translator: Translator | undefined) => {
    test.each([
      [0, "at exception"],
      [-9, "at exception"],
      [-880, "-880 ms"],
      [40, "+40 ms"],
      [-1234, "-1.2 s"],
      [3000, "+3.0 s"],
      [9999, "+10.0 s"],
      [-12500, "-12 s"],
      [-60000, "-1 m"],
      [-125000, "-2 m 5 s"],
      [200000, "+3 m 20 s"],
    ])("%d ms from the exception reads %s", (ms: number, expected: string) => {
      expect(offset(ms, translator)).toBe(expected);
    });

    test.each([
      [0, "0 ms"],
      [880, "880 ms"],
      [1500, "1.5 s"],
      [45000, "45 s"],
      [120000, "2 m"],
      [200000, "3 m 20 s"],
    ])("a span of %d ms reads %s", (ms: number, expected: string) => {
      expect(formatBreadcrumbSpan(ms, translator)).toBe(expected);
    });

    test.each([
      ["three events", { shownCount: 3 }, "3 events"],
      ["one event", { shownCount: 1 }, "1 event"],
      [
        "events in milliseconds",
        { shownCount: 8, msBefore: 880 },
        "8 events in the 880 ms before the exception",
      ],
      [
        "events in seconds",
        { shownCount: 8, msBefore: 12000 },
        "8 events in the 12 s before the exception",
      ],
      [
        "one event in seconds",
        { shownCount: 1, msBefore: 1500 },
        "1 event in the 1.5 s before the exception",
      ],
      [
        "events in minutes",
        { shownCount: 1234, msBefore: 200000 },
        "1234 events in the 3 m 20 s before the exception",
      ],
      [
        "one event at the exception",
        { shownCount: 1, msBefore: 0 },
        "1 event around the exception",
      ],
      [
        "events at the exception",
        { shownCount: 4, msBefore: 0 },
        "4 events around the exception",
      ],
      [
        "the latest of more",
        { shownCount: 50, totalCount: 72, msBefore: 12000 },
        "50 events in the 12 s before the exception (latest 50 of 72)",
      ],
      [
        "a filter",
        { shownCount: 8, filteredCount: 2 },
        "2 of 8 events match the filters",
      ],
      [
        "a filter on one event",
        { shownCount: 1, filteredCount: 0 },
        "0 of 1 event match the filters",
      ],
    ])(
      "the description of %s",
      (_name: string, window: EventWindow, expected: string) => {
        expect(describeWindow(window, translator)).toBe(expected);
      },
    );
  },
);

describe("in German", () => {
  test("the exception's own row: 'bei der Ausnahme'", () => {
    expect(offset(0, german)).toBe("bei der Ausnahme");
    expect(offset(-9, german)).toBe("bei der Ausnahme");
  });

  test.each([
    [-1234, "-1,2 s"],
    [3000, "+3,0 s"],
    [-12500, "-12 s"],
    [-60000, "-1 Min."],
    [-125000, "-2 Min. 5 s"],
    [200000, "+3 Min. 20 s"],
  ])(
    "%d ms from the exception reads %s: a decimal comma, German's minutes",
    (ms: number, expected: string) => {
      expect(offset(ms, german)).toBe(expected);
    },
  );

  test.each([
    [1500, "1,5 s"],
    [120000, "2 Min."],
    [200000, "3 Min. 20 s"],
  ])("a span of %d ms reads %s", (ms: number, expected: string) => {
    expect(formatBreadcrumbSpan(ms, german)).toBe(expected);
  });

  test.each([
    ["three events", { shownCount: 3 }, "3 Ereignisse"],
    ["one event", { shownCount: 1 }, "1 Ereignis"],
    [
      "events in seconds",
      { shownCount: 8, msBefore: 12000 },
      "8 Ereignisse in 12 s vor der Ausnahme",
    ],
    [
      "one event in seconds",
      { shownCount: 1, msBefore: 1500 },
      "1 Ereignis in 1,5 s vor der Ausnahme",
    ],
    [
      "events in minutes",
      { shownCount: 1234, msBefore: 200000 },
      "1.234 Ereignisse in 3 Min. 20 s vor der Ausnahme",
    ],
    [
      "one event at the exception",
      { shownCount: 1, msBefore: 0 },
      "1 Ereignis rund um die Ausnahme",
    ],
    [
      "the latest of more",
      { shownCount: 50, totalCount: 72, msBefore: 12000 },
      "50 Ereignisse in 12 s vor der Ausnahme (die neuesten 50 von 72)",
    ],
    [
      "a filter",
      { shownCount: 8, filteredCount: 2 },
      "2 von 8 Ereignissen entsprechen den Filtern",
    ],
  ])(
    "the description of %s, in German's plural",
    (_name: string, window: EventWindow, expected: string) => {
      expect(describeWindow(window, german)).toBe(expected);
    },
  );
});

describe("in Persian", () => {
  test("the exception's own row", () => {
    expect(offset(0, persian)).toBe("هنگام استثنا");
  });

  test.each([
    [-1234, `${LRM}${MINUS}۱٫۲ ثانیه`],
    [3000, `${LRM}+۳٫۰ ثانیه`],
    [-12500, `${LRM}${MINUS}۱۲ ثانیه`],
    [-125000, `${LRM}${MINUS}۲ دقیقه ۵ ثانیه`],
    [200000, `${LRM}+۳ دقیقه ۲۰ ثانیه`],
  ])(
    "%d ms from the exception: Persian digits, decimal sign and units",
    (ms: number, expected: string) => {
      const time: string = offset(ms, persian);

      expect(time).toBe(expected);
      expect(LATIN_DIGIT.test(time)).toBe(false);
      expect(LATIN_LETTER.test(time)).toBe(false);
    },
  );

  test.each([
    [-1234, 1234, `${MINUS}۱٫۲`, "+۱٫۲"],
    [-12500, 12500, `${MINUS}۱۲`, "+۱۲"],
    [-125000, 125000, `${MINUS}۲`, "+۲"],
  ])(
    "on a page read from the right, %d and %d ms carry their signs on the same side of the figure",
    (
      before: number,
      after: number,
      drawnBefore: string,
      drawnAfter: string,
    ) => {
      expect(drawnFromTheRight(offset(before, persian))).toContain(drawnBefore);
      expect(drawnFromTheRight(offset(after, persian))).toContain(drawnAfter);
    },
  );

  test.each([
    ["three events", { shownCount: 3 }, "۳ رویداد"],
    [
      "events in seconds",
      { shownCount: 8, msBefore: 12000 },
      "۸ رویداد در ۱۲ ثانیه پیش از استثنا",
    ],
    [
      "events in minutes",
      { shownCount: 8, msBefore: 125000 },
      "۸ رویداد در ۲ دقیقه ۵ ثانیه پیش از استثنا",
    ],
    [
      "the latest of more",
      { shownCount: 50, totalCount: 72, msBefore: 12000 },
      "۵۰ رویداد در ۱۲ ثانیه پیش از استثنا (آخرین ۵۰ مورد از ۷۲)",
    ],
    [
      "a filter",
      { shownCount: 8, filteredCount: 2 },
      "۲ از ۸ رویداد با فیلترها مطابقت دارند",
    ],
  ])(
    "the description of %s, in Persian digits",
    (_name: string, window: EventWindow, expected: string) => {
      const description: string = describeWindow(window, persian);

      expect(withoutIsolateMarks(description)).toBe(expected);
      expect(LATIN_DIGIT.test(description)).toBe(false);
    },
  );
});

describe("in Arabic, whose figures are Latin", () => {
  test.each([
    [-1234, 1234, "-1.2", "+1.2"],
    [-125000, 125000, "-2", "+2"],
  ])(
    "on a page read from the right, %d and %d ms carry their signs on the same side of the figure",
    (
      before: number,
      after: number,
      drawnBefore: string,
      drawnAfter: string,
    ) => {
      expect(drawnFromTheRight(offset(before, arabic))).toContain(drawnBefore);
      expect(drawnFromTheRight(offset(after, arabic))).toContain(drawnAfter);
    },
  );
});

describe("every language words the card's times and counts", () => {
  const PLURALS: ReadonlyArray<PluralTemplate> = [
    EVENTS_TEMPLATE,
    EVENTS_BEFORE_THE_EXCEPTION_TEMPLATE,
    EVENTS_AROUND_THE_EXCEPTION_TEMPLATE,
    EVENTS_MATCHING_THE_FILTERS_TEMPLATE,
  ];

  const KEYS: ReadonlyArray<string> = [
    AT_EXCEPTION_TEXT,
    MINUTES_TEMPLATE,
    MINUTES_AND_SECONDS_TEMPLATE,
    LATEST_OF_TOTAL_TEMPLATE,
    ...PLURALS.flatMap((template: PluralTemplate): Array<string> => {
      return [template.other, `${template.other}_one`];
    }),
  ];

  test("the English file says what the code says", () => {
    const words: Record<string, string> = readDashboardLocale("en");

    for (const template of PLURALS) {
      expect(words[template.other]).toBe(template.other);
      expect(words[`${template.other}_one`]).toBe(template.one);
    }

    for (const key of [
      AT_EXCEPTION_TEXT,
      MINUTES_TEMPLATE,
      MINUTES_AND_SECONDS_TEMPLATE,
      LATEST_OF_TOTAL_TEMPLATE,
    ]) {
      expect(words[key]).toBe(key);
    }
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words each in its own way, with the English placeholders",
    (language: string) => {
      const englishWords: Record<string, string> = readDashboardLocale("en");
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of KEYS) {
        expect({
          key: key,
          worded: isWordedInDashboardLocale(key, language),
          placeholders: placeholdersOf(words[key] || ""),
        }).toEqual({
          key: key,
          worded: true,
          placeholders: placeholdersOf(englishWords[key] || ""),
        });
      }
    },
  );
});

describe("the Breadcrumbs card, drawn in the reader's language", () => {
  const event: (
    name: string,
    offsetMs: number,
    attributes?: JSONObject,
  ) => BreadcrumbEvent = (
    name: string,
    offsetMs: number,
    attributes: JSONObject = {},
  ): BreadcrumbEvent => {
    const time: Date = new Date(EXCEPTION_TIME.getTime() + offsetMs);

    return { name, time, timeUnixNano: time.getTime() * 1000000, attributes };
  };

  const EVENTS: Array<BreadcrumbEvent> = [
    event("http.request", -125000, {
      "http.method": "POST",
      "http.url": "https://shop.example.com/api/checkout",
    }),
    event("db.query", -12500, {
      "db.system": "postgresql",
      "db.statement": "SELECT * FROM stock WHERE sku = $1",
    }),
    event("cart.loaded", -1234),
    event("exception", 0, {
      "exception.type": "InventoryReservationError",
      "exception.message": "Could not reserve stock",
    }),
  ];

  // Each row's time, top to bottom.
  const times: () => Array<string> = (): Array<string> => {
    return screen
      .getAllByTestId("breadcrumb-time")
      .map((cell: HTMLElement): string => {
        return withoutIsolateMarks(cell.textContent || "");
      });
  };

  const renderIn: (language: string) => Promise<void> = async (
    language: string,
  ): Promise<void> => {
    await act(async () => {
      await i18next.changeLanguage(language);
    });

    render(
      <BreadcrumbTimeline events={EVENTS} exceptionTime={EXCEPTION_TIME} />,
    );
  };

  beforeAll(async () => {
    await i18next.use(initReactI18next).init({
      lng: "en",
      fallbackLng: "en",
      resources: {
        en: { translation: readDashboardLocale("en") },
        de: { translation: readDashboardLocale("de") },
        fa: { translation: readDashboardLocale("fa") },
      },
      interpolation: { escapeValue: false },
    });
  });

  afterEach(() => {
    cleanup();
  });

  test("English: as it always read", async () => {
    await renderIn("en");

    expect(times()).toEqual(["-2 m 5 s", "-12 s", "-1.2 s", "at exception"]);
    expect(
      screen.getByText("4 events in the 2 m 5 s before the exception"),
    ).toBeInTheDocument();
  });

  test("German: each row's time and the card's description", async () => {
    await renderIn("de");

    expect(times()).toEqual([
      "-2 Min. 5 s",
      "-12 s",
      "-1,2 s",
      "bei der Ausnahme",
    ]);
    expect(
      screen.getByText("4 Ereignisse in 2 Min. 5 s vor der Ausnahme"),
    ).toBeInTheDocument();
  });

  test("Persian: each row's time and the card's description", async () => {
    await renderIn("fa");

    expect(times()).toEqual([
      `${LRM}${MINUS}۲ دقیقه ۵ ثانیه`,
      `${LRM}${MINUS}۱۲ ثانیه`,
      `${LRM}${MINUS}۱٫۲ ثانیه`,
      "هنگام استثنا",
    ]);
    expect(
      screen.getByText((content: string): boolean => {
        return (
          withoutIsolateMarks(content) ===
          "۴ رویداد در ۲ دقیقه ۵ ثانیه پیش از استثنا"
        );
      }),
    ).toBeInTheDocument();
  });
});

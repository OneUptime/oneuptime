import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import {
  getNumberLocale,
  setDateDisplayLanguage,
} from "../../../../Types/DateLanguage";
import { getInlineSeparator, Translator } from "../../../../Types/Translator";
import StatusTimelineLegend from "../../../../UI/Components/StatusTimeline/StatusTimelineLegend";
import {
  formatStatusTimelineShare,
  STATUS_TIMELINE_SHARE_LESS_THAN,
  StatusTimelineSummary,
} from "../../../../UI/Components/StatusTimeline/StatusTimelineLayout";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../../Helpers/IsolateMarks";

/*
 * THE STATUS TIMELINE LEGEND'S SHARES, IN THE READER'S DIGITS (issue #7113).
 *
 * Every status and state timeline's legend says each status's share of the
 * time. The share was built by hand - `${n.toFixed(2)}%` - so it was always
 * Latin digits, a point and an ASCII percent sign: "%99.81" on a Persian
 * page beside durations in Persian digits, "99.81%" in German where German
 * writes "99,81 %". It is written the reader's way now (Intl's percent, as
 * the Dashboard's other shares), keeping its own rules: never rounded up to
 * 100%, and "<0.01%" for a sliver - in Persian "کمتر از ۰٫۰۱٪", the
 * Dashboard's own "less than" sentence. English reads exactly as before.
 */

const LATIN_DIGIT: RegExp = /[0-9]/;

const PERSIAN_DIGIT: RegExp = /[\u06F0-\u06F9]/;

const PERSIAN_PERCENT_SIGN: string = "\u066A";

// The shares the legend's English always read, and the cases that pin its rules.
const ENGLISH_SHARES: Array<[number, string]> = [
  [0, "0%"],
  [-1, "0%"],
  [Number.NaN, "0%"],
  [1, "100%"],
  [1.2, "100%"],
  [0.5, "50%"],
  [0.1234, "12.34%"],
  [0.12345, "12.35%"],
  [0.9991, "99.91%"],
  [0.0009, "0.09%"],
  [0.00004, "<0.01%"],
  [0.99996, "99.99%"],
  [0.999999, "99.99%"],
  [0.9981, "99.81%"],
  [0.123, "12.3%"],
];

// What Intl writes for a percent in `language`, at most two decimals.
const intlPercent: (percent: number, language: string) => string = (
  percent: number,
  language: string,
): string => {
  return new Intl.NumberFormat(getNumberLocale(language), {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(percent / 100);
};

describe("formatStatusTimelineShare in English", () => {
  test.each(ENGLISH_SHARES)(
    "%p reads %p, with or without an English translator",
    (share: number, text: string) => {
      expect(formatStatusTimelineShare(share)).toBe(text);
      expect(formatStatusTimelineShare(share, dashboardTranslator("en"))).toBe(
        text,
      );
    },
  );
});

describe("formatStatusTimelineShare in the reader's language", () => {
  test.each([
    ["fa", 0.9981, "۹۹٫۸۱٪"],
    ["fa", 0.5, "۵۰٪"],
    ["fa", 0.1234, "۱۲٫۳۴٪"],
    ["fa", 0, "۰٪"],
    ["fa", 1, "۱۰۰٪"],
    ["de", 0.9981, "99,81\u{00A0}%"],
    ["de", 0.5, "50\u{00A0}%"],
    ["ja", 0.9981, "99.81%"],
  ])("%s: %p reads %p", (language: string, share: number, text: string) => {
    expect(
      formatStatusTimelineShare(share, dashboardTranslator(language)),
    ).toBe(text);
  });

  test("Arabic keeps Latin digits by its own rule, with Intl's percent sign", () => {
    const arabic: string = formatStatusTimelineShare(
      0.9981,
      dashboardTranslator("ar"),
    );

    expect(arabic).toBe(intlPercent(99.81, "ar"));
    expect(arabic).toContain("99.81");
    expect(arabic).not.toMatch(PERSIAN_DIGIT);
    // Intl sets Arabic's percent sign apart with marks: not the bare "%" of old.
    expect(arabic).not.toBe("99.81%");
  });

  test("each language writes the same figure Intl writes for it", () => {
    for (const language of ["fa", "de", "ar", "fr", "ru", "es", "ja", "hi"]) {
      const translator: Translator = dashboardTranslator(language);

      for (const [share, percent] of [
        [0.1234, 12.34],
        [0.12345, 12.35],
        [0.9991, 99.91],
        [0.0009, 0.09],
        [0.5, 50],
      ] as Array<[number, number]>) {
        expect({
          language,
          share,
          text: formatStatusTimelineShare(share, translator),
        }).toEqual({ language, share, text: intlPercent(percent, language) });
      }
    }
  });

  test("Persian is never rounded up to 100%: 99.996% stays 99.99%", () => {
    const persian: Translator = dashboardTranslator("fa");

    expect(formatStatusTimelineShare(0.99996, persian)).toBe("۹۹٫۹۹٪");
    expect(formatStatusTimelineShare(0.999999, persian)).toBe("۹۹٫۹۹٪");
    expect(formatStatusTimelineShare(0.99996, persian)).not.toContain("۱۰۰");
  });

  test("a sliver is 'less than 0.01%' in the reader's words and digits", () => {
    expect(
      withoutIsolateMarks(
        formatStatusTimelineShare(0.00004, dashboardTranslator("fa")),
      ),
    ).toBe("کمتر از ۰٫۰۱٪");
    expect(formatStatusTimelineShare(0.00004, dashboardTranslator("de"))).toBe(
      "<0,01\u{00A0}%",
    );
    expect(
      withoutIsolateMarks(
        formatStatusTimelineShare(0.00004, dashboardTranslator("ja")),
      ),
    ).toBe("0.01%未満");
    // English keeps its sign.
    expect(formatStatusTimelineShare(0.00004, dashboardTranslator("en"))).toBe(
      "<0.01%",
    );
  });

  test("the 'less than' sentence is the Dashboard's own, worded in every language", () => {
    expect(STATUS_TIMELINE_SHARE_LESS_THAN).toBe("less than {{percent}}");

    for (const language of ["fa", "ar", "de", "ja", "ko", "hi", "zh-CN"]) {
      const words: string | undefined =
        readDashboardLocale(language)[STATUS_TIMELINE_SHARE_LESS_THAN];

      expect({ language, words: Boolean(words) }).toEqual({
        language,
        words: true,
      });
      expect(words).not.toBe(STATUS_TIMELINE_SHARE_LESS_THAN);
    }
  });

  test("no Persian share holds a Latin digit or an ASCII percent sign", () => {
    const persian: Translator = dashboardTranslator("fa");

    for (const [share] of ENGLISH_SHARES) {
      const text: string = withoutIsolateMarks(
        formatStatusTimelineShare(share, persian),
      );

      expect({ share, text, latin: LATIN_DIGIT.test(text) }).toEqual({
        share,
        text,
        latin: false,
      });
      expect(text.includes("%")).toBe(false);
      expect(text).toContain(PERSIAN_PERCENT_SIGN);
    }
  });
});

/*
 * The legend drawn on a Persian page: its shares, durations and counts in
 * Persian digits, with no Latin digit anywhere.
 */
const summary: StatusTimelineSummary = {
  items: [
    {
      statusKey: "operational",
      name: "عملیاتی",
      color: "#10b981",
      durationMs: 29 * 24 * 3600 * 1000,
      share: 0.9981,
      count: 1,
    },
    {
      statusKey: "offline",
      name: "آفلاین",
      color: "#ef4444",
      durationMs: 83 * 60 * 1000,
      share: 0.0019,
      count: 31,
    },
    {
      statusKey: "degraded",
      name: "کاهش‌یافته",
      color: "#f59e0b",
      durationMs: 1000,
      share: 0.0000004,
      count: 2,
    },
  ],
  measuredMs: 30 * 24 * 3600 * 1000,
  monitoringOffMs: 0,
  monitoringOffCount: 0,
};

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "de", "fa", "ar"]) {
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
  setDateDisplayLanguage("en");
});

const drawLegend: (language: string) => Array<string> = (
  language: string,
): Array<string> => {
  // The page's dates and durations follow its language (followLanguageForDates).
  setDateDisplayLanguage(language);
  render(
    <I18nextProvider i18n={instances[language]!}>
      <StatusTimelineLegend summary={summary} showShare={true} />
    </I18nextProvider>,
  );

  return screen
    .getAllByTestId("status-timeline-legend-item")
    .map((item: HTMLElement): string => {
      return withoutIsolateMarks(item.textContent || "");
    });
};

describe("the legend, drawn", () => {
  test("on a Persian page, every share, duration and count is in Persian digits", () => {
    const items: Array<string> = drawLegend("fa");

    expect(items).toHaveLength(3);
    expect(items[0]).toContain("۹۹٫۸۱٪");
    expect(items[1]).toContain("۰٫۱۹٪");
    expect(items[2]).toContain("کمتر از ۰٫۰۱٪");

    for (const item of items) {
      expect({ item, latin: LATIN_DIGIT.test(item) }).toEqual({
        item,
        latin: false,
      });
      expect(item).toMatch(PERSIAN_DIGIT);
    }
  });

  test("on a German page, with the decimal comma and German's percent", () => {
    const items: Array<string> = drawLegend("de");

    expect(items[0]).toContain("99,81\u{00A0}%");
    expect(items[0]).not.toContain("99.81%");
  });

  test("on an English page, as it always read", () => {
    const items: Array<string> = drawLegend("en");

    expect(items[0]).toContain("99.81%");
    expect(items[1]).toContain("0.19%");
    expect(items[2]).toContain("<0.01%");
  });

  test("the guard's negative control: the share built by hand holds Latin digits", () => {
    // What the legend wrote before issue #7113, on any page.
    const handBuilt: string = `${Number((99.81).toFixed(2)).toString()}%`;

    expect(LATIN_DIGIT.test(handBuilt)).toBe(true);
    expect(formatStatusTimelineShare(0.9981)).toBe(handBuilt);
    expect(
      formatStatusTimelineShare(0.9981, dashboardTranslator("fa")),
    ).not.toBe(handBuilt);
  });
});

/*
 * THE LEGEND'S READING ORDER.
 *
 * A status's figures were one line of text: an Arabic share ("99.96%",
 * which Intl writes with left-to-right marks to keep its sign after the
 * number) took the duration's first number with it, drawing "99.96% · 30"
 * beside the name and "يومًا و23 س" after it, the 30 days cut from their
 * days. An English status name in an Arabic or Persian legend did the same.
 * Each part is an isolate of its own now, the name too, with the
 * separator between them, outside every isolate.
 */
describe("the legend's reading order", () => {
  const NAMED_IN_ENGLISH: StatusTimelineSummary = {
    ...summary,
    items: summary.items.map(
      (
        item: StatusTimelineSummary["items"][number],
        index: number,
      ): StatusTimelineSummary["items"][number] => {
        return {
          ...item,
          name: ["Operational", "Offline", "Degraded"][index] as string,
        };
      },
    ),
  };

  const drawItems: (
    language: string,
    legend: StatusTimelineSummary,
  ) => Array<HTMLElement> = (
    language: string,
    legend: StatusTimelineSummary,
  ): Array<HTMLElement> => {
    setDateDisplayLanguage(language);
    render(
      <I18nextProvider i18n={instances[language]!}>
        <StatusTimelineLegend summary={legend} showShare={true} />
      </I18nextProvider>,
    );

    return screen.getAllByTestId("status-timeline-legend-item");
  };

  // Each isolate's words, without Intl's left-to-right marks.
  const partsOf: (item: HTMLElement) => Array<string> = (
    item: HTMLElement,
  ): Array<string> => {
    return Array.from(item.querySelectorAll("bdi")).map(
      (part: Element): string => {
        return withoutIsolateMarks(part.textContent || "").replace(
          /\u200E/g,
          "",
        );
      },
    );
  };

  test("on an Arabic page, the name, the share, the duration and the count are each set apart", () => {
    const items: Array<HTMLElement> = drawItems("ar", NAMED_IN_ENGLISH);
    const offline: Array<string> = partsOf(items[1]!);

    expect(offline).toHaveLength(4);
    expect(offline[0]).toBe("Offline");
    expect(offline[1]).toBe("0.19%");
    // The duration whole, its first number with its unit.
    expect(offline[2]).toMatch(/^1 /);
    expect(offline[3]).toBe(
      dashboardTranslator("ar").translatePlural(
        { one: "{{count}} time", other: "{{count}} times" },
        31,
      ),
    );

    // The status the record spent most of the period in: no count.
    const operational: Array<string> = partsOf(items[0]!);
    expect(operational).toHaveLength(3);
    expect(operational[0]).toBe("Operational");
    expect(operational[1]).toBe("99.81%");
    expect(operational[2]).toMatch(/^29 /);
  });

  test("an English name reads left to right in an Arabic legend, an Arabic name right to left", () => {
    expect(
      drawItems("ar", NAMED_IN_ENGLISH)[1]!.querySelector("bdi"),
    ).toHaveAttribute("dir", "ltr");

    cleanup();

    expect(drawItems("fa", summary)[1]!.querySelector("bdi")).toHaveAttribute(
      "dir",
      "rtl",
    );
  });

  test("the separator sits between the figures, outside their isolates", () => {
    const item: HTMLElement = drawItems("fa", summary)[1]!;
    const separator: string = getInlineSeparator("fa");
    const figures: Element = item.lastElementChild!;

    // The share, the duration and the count: three isolates, two separators.
    expect(figures.querySelectorAll("bdi")).toHaveLength(3);
    expect(
      Array.from(figures.childNodes)
        .filter((node: ChildNode): boolean => {
          return node.nodeType === 3 && Boolean(node.textContent);
        })
        .map((node: ChildNode): string => {
          return node.textContent || "";
        }),
    ).toEqual([separator, separator]);

    for (const part of Array.from(figures.querySelectorAll("bdi"))) {
      expect(part.textContent).not.toContain(separator.trim());
    }
  });
});

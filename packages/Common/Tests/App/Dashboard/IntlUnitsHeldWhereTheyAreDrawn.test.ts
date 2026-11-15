import { describe, expect, test } from "@jest/globals";
import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";
import { createTranslator, Translator } from "../../../Types/Translator";
import { FeedClock } from "../../../UI/Components/Feed/FeedTime";
import { formatFormRetryAfter } from "../../../../App/FeatureSet/Accounts/src/Utils/Form";
import { formatCompactDurationInMinutes } from "../../../../App/FeatureSet/Dashboard/src/Utils/CompactDuration";
import {
  formatScanBytes,
  formatScanDuration,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/ScanDetail";
import {
  formatShowcaseFigure,
  formatShowcaseFigureParts,
  ShowcaseFigure,
  ShowcaseFigureParts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceShowcase/ResourceShowcase";
import {
  formatShiftLength,
  getShiftDayLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/UpcomingShiftTime";
import {
  formatRelativeTime as formatHomeRelativeTime,
  formatRelativeTimeParts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/HomeRelativeTime";
import { formatRunRelativeTime } from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/Triggers/RunbookTriggersCopy";
import { getMerakiReadTime } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkTraffic/Meraki/MerakiWords";
import { formatRelativeTime as formatExceptionRelativeTime } from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionDetailPresentation";
import { formatEventDurationParts } from "../../../../App/FeatureSet/Dashboard/src/Utils/EventDuration";
import { formatPlaylistInterval } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Playlist/PlaylistDashboards";
import StatusPageLiveRefreshUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/LiveRefresh";
import { DASHBOARD_LANGUAGES } from "../../Helpers/DashboardLocales";

/*
 * THE DURATIONS AND RELATIVE TIMES INTL WRITES, WHERE THEY ARE DRAWN (#8456).
 *
 * These asked Intl for a unit or a relative time themselves - a stat
 * tile's figure, a security case's response target, a data security
 * scan's size and run time, a shift's length and day, Home's and a status
 * page's "2 hours ago", a runbook's next run, a Meraki read, an exception's
 * age, a sign-in form's "try again in 5 minutes" - and got Intl's plain
 * space between the number and its unit. Each goes through DateLanguage
 * now (NumbersKeepTheirUnitsInCodeGuard refuses another way), which holds
 * them, in English and every language the Dashboard ships. A figure with
 * no unit, and a word with no number ("heute", "now"), are as they were.
 */

const LANGUAGES: ReadonlyArray<string> = ["en", ...DASHBOARD_LANGUAGES];

const BREAKING_SPACE: RegExp = /[ \u2000-\u2006\u2008-\u200A\u205F]/;

// A digit, in any script, whose next character is not part of its number.
const FIGURE_END: RegExp = /\p{Nd}(?=[^\p{Nd}.,٫٬\u00A0\u202F]|$)/gu;

// A figure with a decimal sign in it: "5.0", "4,2", "۴٫۲".
const DECIMAL_FIGURE: RegExp = /\p{Nd}[.,٫]\p{Nd}/u;

const NOW: Date = new Date("2026-11-15T12:00:00Z");

const minutesAgo: (minutes: number) => Date = (minutes: number): Date => {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
};

const minutesAhead: (minutes: number) => Date = (minutes: number): Date => {
  return new Date(NOW.getTime() + minutes * 60 * 1000);
};

// The figures of `text` a line could part from the unit after them.
const brokenAfterFigures: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  const broken: Array<string> = [];

  for (const match of text.matchAll(FIGURE_END)) {
    const next: string = text.charAt((match.index ?? 0) + match[0].length);

    if (BREAKING_SPACE.test(next)) {
      broken.push(`${match[0]}${next}`);
    }
  }

  return broken;
};

// Every text in `texts` whose figures a line could part from their units.
const brokenTexts: (
  texts: Array<string | null | undefined>,
) => Array<string> = (
  texts: Array<string | null | undefined>,
): Array<string> => {
  return texts
    .map((text: string | null | undefined): string => {
      return text || "";
    })
    .filter((text: string): boolean => {
      return brokenAfterFigures(text).length > 0;
    });
};

const clockIn: (language: string) => FeedClock = (
  language: string,
): FeedClock => {
  return { timezone: "UTC", language, use12HourClock: false, now: NOW };
};

describe("every language: a figure a caller draws stays with its unit", () => {
  test.each(LANGUAGES)(
    "%s: a security case's response target",
    (language: string) => {
      expect(
        brokenTexts(
          [5, 51, 60, 264, 1440, 4620, 30 * 24 * 60].map(
            (minutes: number): string => {
              return formatCompactDurationInMinutes(minutes, language);
            },
          ),
        ),
      ).toEqual([]);
    },
  );

  test.each(LANGUAGES)(
    "%s: a data security scan's size and run time",
    (language: string) => {
      expect(
        brokenTexts([
          ...[0, 512, 4200, 4_200_000, 12_500_000_000, 3e15].map(
            (bytes: number): string => {
              return formatScanBytes(bytes, language);
            },
          ),
          ...[0, 1, 850, 999, 1000, 65_000, 3_725_000].map(
            (ms: number): string => {
              return formatScanDuration(ms, language);
            },
          ),
        ]),
      ).toEqual([]);
    },
  );

  test.each(LANGUAGES)("%s: a stat tile's figures", (language: string) => {
    const translator: Translator = createTranslator(undefined, language);
    const figures: Array<ShowcaseFigure> = [
      { milliseconds: 184 },
      { seconds: 1.24 },
      { megabytes: 412 },
      { gigabytes: 6.4 },
      { gigabitsPerSecond: 1.2 },
      { dBm: -67 },
    ];

    expect(
      brokenTexts(
        figures.map((figure: ShowcaseFigure): string => {
          return formatShowcaseFigure(figure, translator);
        }),
      ),
    ).toEqual([]);

    for (const figure of figures) {
      const parts: ShowcaseFigureParts = formatShowcaseFigureParts(
        figure,
        translator,
      );

      // Drawn apart, the space between them is still a no-break one.
      expect({
        figure,
        separator: BREAKING_SPACE.test(parts.separator),
      }).toEqual({ figure, separator: false });
    }
  });

  test.each(LANGUAGES)(
    "%s: a shift's length and its day",
    (language: string) => {
      expect(
        brokenTexts([
          formatShiftLength({ days: 30, hours: 0, minutes: 0 }, language),
          formatShiftLength({ days: 1, hours: 6, minutes: 0 }, language),
          formatShiftLength({ days: 0, hours: 8, minutes: 45 }, language),
          formatShiftLength({ days: 0, hours: 0, minutes: 21 }, language),
          formatShiftLength({ days: 2, hours: 1, minutes: 0 }, language),
        ]),
      ).toEqual([]);

      const today: string = getShiftDayLabel(NOW, clockIn(language));
      const tomorrow: string = getShiftDayLabel(
        minutesAhead(24 * 60),
        clockIn(language),
      );

      // A day's own word has no number, and is capitalized.
      expect(today).not.toMatch(/\p{Nd}/u);
      expect(tomorrow).not.toMatch(/\p{Nd}/u);
      expect(today).not.toBe(tomorrow);
    },
  );

  test.each(LANGUAGES)(
    "%s: Home's, a status page's and a note's relative times",
    (language: string) => {
      expect(
        brokenTexts([
          ...[2, 50, 3 * 60, 3 * 24 * 60, 70 * 24 * 60, 800 * 24 * 60].map(
            (minutes: number): string => {
              return formatHomeRelativeTime({
                date: minutesAgo(minutes),
                now: NOW,
                language,
              });
            },
          ),
          formatHomeRelativeTime({
            date: minutesAhead(3 * 24 * 60),
            now: NOW,
            language,
          }),
          formatRelativeTimeParts({
            parts: { value: -20, unit: "minute" },
            language,
          }),
          ...[12, 125, 7200, 3 * 86400].map((secondsAgo: number): string => {
            return StatusPageLiveRefreshUtil.formatRelativeTime({
              secondsAgo,
              locale: language,
            });
          }),
        ]),
      ).toEqual([]);
    },
  );

  test.each(LANGUAGES)(
    "%s: a runbook's next run, a Meraki read, an exception's age, a form's wait",
    (language: string) => {
      expect(
        brokenTexts([
          ...[25, 5 * 60, 23 * 60, 4 * 24 * 60].map(
            (minutes: number): string => {
              return formatRunRelativeTime({
                date: minutesAhead(minutes),
                now: NOW,
                language,
                timezone: "UTC",
              });
            },
          ),
          formatRunRelativeTime({
            date: minutesAgo(120),
            now: NOW,
            language,
            timezone: "UTC",
          }),
          getMerakiReadTime(new Date(NOW.getTime() - 12_000).toISOString(), {
            language,
            now: NOW,
          }),
          getMerakiReadTime(minutesAgo(3).toISOString(), {
            language,
            now: NOW,
          }),
          // An exception's English is its own words, from code (#8457 holds them).
          ...(language === "en"
            ? []
            : [4, 3 * 60, 5 * 24 * 60, 400 * 24 * 60]
          ).map((minutes: number): string | null => {
            return formatExceptionRelativeTime(
              minutesAgo(minutes),
              NOW,
              language,
            );
          }),
          ...[30, 300, 5400].map((seconds: number): string | null => {
            return formatFormRetryAfter(seconds, language);
          }),
        ]),
      ).toEqual([]);
    },
  );

  test.each(LANGUAGES)(
    "%s: an incident's duration and a playlist's interval",
    (language: string) => {
      expect(
        brokenTexts([
          formatEventDurationParts(
            [
              { count: 10, unit: "day" },
              { count: 23, unit: "hour" },
            ],
            language,
          ),
          formatEventDurationParts([{ count: 1, unit: "minute" }], language),
          formatPlaylistInterval(90, language),
          formatPlaylistInterval(3600 + 1800, language),
        ]),
      ).toEqual([]);
    },
  );
});

describe("as German and English read them", () => {
  test("a security case's response target", () => {
    expect(formatCompactDurationInMinutes(264, "de")).toBe(
      `4${NO_BREAK_SPACE}Std. 24${NO_BREAK_SPACE}Min.`,
    );
    // English is the hand-written text, held already (#8303).
    expect(formatCompactDurationInMinutes(264, "en")).toBe(
      `4${NO_BREAK_SPACE}h 24${NO_BREAK_SPACE}min`,
    );
  });

  test("a scan's size and its run time", () => {
    expect(formatScanBytes(4_200_000, "de")).toBe(`4,2${NO_BREAK_SPACE}MB`);
    expect(formatScanBytes(4_200_000, "en")).toBe(`4.2${NO_BREAK_SPACE}MB`);
    expect(formatScanDuration(850, "de")).toBe(`850${NO_BREAK_SPACE}ms`);
    expect(formatScanDuration(850, "ar")).toBe(
      `850${NO_BREAK_SPACE}ملي${NO_BREAK_SPACE}ث`,
    );
    // A second and more is a compact duration, as before.
    expect(formatScanDuration(125_000, "en")).toBe("2m 5s");
  });

  test("a scan's plain bytes are whole, in every language (PlainBytesAreWhole)", () => {
    for (const language of LANGUAGES) {
      for (const bytes of [0, 1, 5, 9, 42, 512, 999]) {
        const written: string = formatScanBytes(bytes, language);

        expect({
          language,
          bytes,
          decimal: DECIMAL_FIGURE.test(written),
        }).toEqual({ language, bytes, decimal: false });
      }
    }

    expect(formatScanBytes(5, "en")).toBe(`5${NO_BREAK_SPACE}byte`);
    // From a kilobyte up, one decimal under ten.
    expect(formatScanBytes(4_200, "en")).toBe(`4.2${NO_BREAK_SPACE}kB`);
    expect(formatScanBytes(42_000, "en")).toBe(`42${NO_BREAK_SPACE}kB`);
  });

  test("an engine without Intl's unit style: the figure and the unit's symbol, held", () => {
    const realNumberFormat: typeof Intl.NumberFormat = Intl.NumberFormat;
    /*
     * An older engine ignores style: "unit" and writes the bare number. A
     * function, not an arrow, so the code under test can construct it.
     */
    const bareNumberFormat: unknown = function (
      locale?: string | Array<string>,
      options?: Intl.NumberFormatOptions,
    ): Intl.NumberFormat {
      return new realNumberFormat(locale, {
        maximumFractionDigits: options?.maximumFractionDigits,
      });
    };

    Object.defineProperty(Intl, "NumberFormat", {
      value: bareNumberFormat,
      configurable: true,
      writable: true,
    });

    try {
      expect(formatScanBytes(4_200_000, "en")).toBe(`4.2${NO_BREAK_SPACE}MB`);
      expect(formatScanDuration(850, "en")).toBe(`850${NO_BREAK_SPACE}ms`);
      expect(formatCompactDurationInMinutes(264, "de")).toBe(
        `4${NO_BREAK_SPACE}h 24${NO_BREAK_SPACE}min`,
      );
      expect(
        formatShowcaseFigureParts(
          { seconds: 1.24 },
          createTranslator(undefined, "de"),
        ).separator,
      ).toBe(NO_BREAK_SPACE);
    } finally {
      Object.defineProperty(Intl, "NumberFormat", {
        value: realNumberFormat,
        configurable: true,
        writable: true,
      });
    }
  });

  test("a stat tile's figure, in English and German", () => {
    const english: Translator = createTranslator(undefined, "en");
    const german: Translator = createTranslator(undefined, "de");

    expect(formatShowcaseFigure({ milliseconds: 184 }, english)).toBe(
      `184${NO_BREAK_SPACE}ms`,
    );
    expect(formatShowcaseFigure({ dBm: -67 }, english)).toBe(
      `-67${NO_BREAK_SPACE}dBm`,
    );
    expect(formatShowcaseFigureParts({ seconds: 1.24 }, german)).toEqual({
      amount: "1,24",
      separator: NO_BREAK_SPACE,
      unit: "Sek.",
    });
    // A figure with no unit has no separator to hold.
    expect(formatShowcaseFigureParts(1284, german)).toEqual({
      amount: "1.284",
      separator: "",
      unit: "",
    });
  });

  test("a shift's length, its day, and a feed's word for it", () => {
    expect(formatShiftLength({ days: 1, hours: 6, minutes: 0 }, "de")).toBe(
      `1${NO_BREAK_SPACE}Tag, 6${NO_BREAK_SPACE}Stunden`,
    );
    expect(formatShiftLength({ days: 30, hours: 0, minutes: 0 }, "en")).toBe(
      `30${NO_BREAK_SPACE}days`,
    );
    expect(getShiftDayLabel(NOW, clockIn("de"))).toBe("Heute");
    expect(getShiftDayLabel(minutesAhead(24 * 60), clockIn("en"))).toBe(
      "Tomorrow",
    );
  });

  test("relative times, with the word before the number still apart", () => {
    expect(
      formatHomeRelativeTime({
        date: minutesAgo(120),
        now: NOW,
        language: "de",
      }),
    ).toBe(`vor 2${NO_BREAK_SPACE}Stunden`);
    expect(
      formatHomeRelativeTime({
        date: minutesAgo(120),
        now: NOW,
        language: "en",
      }),
    ).toBe(`2${NO_BREAK_SPACE}hours ago`);
    expect(
      formatHomeRelativeTime({ date: NOW, now: NOW, language: "de" }),
    ).toBe("jetzt");
    expect(
      StatusPageLiveRefreshUtil.formatRelativeTime({
        secondsAgo: 12,
        locale: "fr",
      }),
    ).toBe(`il y a 12${NO_BREAK_SPACE}secondes`);
    expect(
      formatRunRelativeTime({
        date: minutesAhead(23 * 60),
        now: NOW,
        language: "en",
        timezone: "UTC",
      }),
    ).toBe(`in 23${NO_BREAK_SPACE}hours`);
    expect(
      getMerakiReadTime(new Date(NOW.getTime() - 12_000).toISOString(), {
        language: "de",
        now: NOW,
      }),
    ).toBe(`vor 12${NO_BREAK_SPACE}Sekunden`);
    expect(formatExceptionRelativeTime(minutesAgo(4), NOW, "de")).toBe(
      `vor 4${NO_BREAK_SPACE}Minuten`,
    );
    // An exception's English is its own words, from code.
    expect(formatExceptionRelativeTime(minutesAgo(4), NOW, "en")).toBe(
      "4\u00A0minutes ago",
    );
    expect(formatFormRetryAfter(300, "en")).toBe(
      `in 5${NO_BREAK_SPACE}minutes`,
    );
    expect(formatFormRetryAfter(300, "de")).toBe(
      `in 5${NO_BREAK_SPACE}Minuten`,
    );
    expect(formatFormRetryAfter(0, "de")).toBeNull();
  });
});

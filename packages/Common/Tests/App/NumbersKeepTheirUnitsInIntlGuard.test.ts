// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import { describe, expect, test } from "@jest/globals";
import {
  DurationTextPart,
  DurationTextUnit,
  formatDecimal,
  formatDurationText,
  formatDurationUnit,
  formatRelativeAmount,
  formatRelativeDate,
  formatUnitAmount,
  getDateLocale,
  getNumberLocale,
  getUnitAmountParts,
  holdRelativeUnitToNumber,
  holdUnitToNumber,
  IntlTextPart,
  RelativeDateStyle,
  RelativeDateUnit,
  withDateDisplayLanguage,
} from "../../Types/DateLanguage";
import OneUptimeDate from "../../Types/Date";
import {
  NARROW_NO_BREAK_SPACE,
  NO_BREAK_SPACE,
} from "../../Types/NoBreakSpaces";
import { createTranslator, Translator } from "../../Types/Translator";
import { DurationInUnit, formatDurationInUnit } from "../../Utils/Milliseconds";
import { formatDurationCompactInLanguage } from "../../Utils/Slo/SloDuration";
import {
  FeedClock,
  formatFeedTimeAgo,
  getFeedRelativeDay,
  getFeedRelativeHint,
} from "../../UI/Components/Feed/FeedTime";
import { DASHBOARD_LANGUAGES } from "../Helpers/DashboardLocales";

/*
 * A NUMBER INTL WRITES KEEPS ITS UNIT ON ITS LINE, IN EVERY LANGUAGE (#8456).
 *
 * A line may break at any plain space, and Intl writes one between a number
 * and its unit in most languages: "5 Min.", "vor 5 Minuten", "2 Tage, 3
 * Stunden", Arabic's "5 ملي ث" with two. NumbersKeepTheirUnitsGuard holds
 * the Translator's sentences and NumbersKeepTheirUnitsInCodeGuard the
 * figures code joins to a unit; this holds what Common/Types/DateLanguage
 * asks Intl for, in English and in every language the Dashboard ships:
 * every unit of a duration, long, short and narrow, at counts that reach
 * every plural form; compound durations; relative times past and future;
 * and the helpers built on them. After each figure comes no space a line
 * breaks at, and nothing else Intl wrote is changed: French keeps its own
 * U+202F and U+00A0, a line may still break between two units and before
 * a relative time's number ("vor" | "5 Minuten"), and a text without a
 * number is as Intl wrote it.
 */

// English, then every language the Dashboard ships.
const LANGUAGES: ReadonlyArray<string> = ["en", ...DASHBOARD_LANGUAGES];

// A space a line may break at: the space and the fixed-width ones.
const BREAKING_SPACE: RegExp = /[ \u2000-\u2006\u2008-\u200A\u205F]/;

const BREAKING_SPACES: RegExp = /[ \u2000-\u2006\u2008-\u200A\u205F]/g;

const NO_BREAK_SPACES: RegExp = /\u00A0/g;

// A digit, in any script, and what follows it if that is no digit.
const FIGURE_END: RegExp = /\p{Nd}(?=[^\p{Nd}.,٫٬\u00A0\u202F]|$)/gu;

const DURATION_UNITS: ReadonlyArray<DurationTextUnit> = [
  "year",
  "month",
  "week",
  "day",
  "hour",
  "minute",
  "second",
  "millisecond",
  "microsecond",
  "nanosecond",
];

const RELATIVE_UNITS: ReadonlyArray<RelativeDateUnit> = [
  "second",
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "year",
];

const DISPLAYS: ReadonlyArray<"long" | "short" | "narrow"> = [
  "long",
  "short",
  "narrow",
];

const STYLES: ReadonlyArray<RelativeDateStyle> = ["long", "short", "narrow"];

/*
 * Counts that reach every plural form the languages have: Arabic's zero,
 * one, two, few (3), many (11) and other (100); Russian's one (1, 21), few
 * (2, 22) and many (5, 11); a thousand and more, with its separator.
 */
const COUNTS: ReadonlyArray<number> = [0, 1, 2, 3, 5, 11, 21, 22, 100, 1234];

// What follows each figure in `text`: "" at its end.
const afterEachFigure: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  const after: Array<string> = [];

  for (const match of text.matchAll(FIGURE_END)) {
    const at: number = (match.index ?? 0) + match[0].length;

    after.push(text.charAt(at));
  }

  return after;
};

// The figures of `text` a line could part from what follows them.
const brokenAfterFigures: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return afterEachFigure(text).filter((next: string): boolean => {
    return BREAKING_SPACE.test(next);
  });
};

// `text` with its no-break spaces read as plain ones: what Intl wrote, spaced.
const spaced: (text: string) => string = (text: string): string => {
  return text.replace(NO_BREAK_SPACES, " ");
};

// What Intl itself writes for an amount of a unit.
const intlUnit: (data: {
  language: string;
  unit: string;
  display: "long" | "short" | "narrow";
  value: number;
  maximumFractionDigits?: number;
}) => string = (data: {
  language: string;
  unit: string;
  display: "long" | "short" | "narrow";
  value: number;
  maximumFractionDigits?: number;
}): string => {
  return new Intl.NumberFormat(getNumberLocale(data.language), {
    style: "unit",
    unit: data.unit,
    unitDisplay: data.display,
    maximumFractionDigits: data.maximumFractionDigits ?? 0,
  }).format(data.value);
};

// What Intl itself writes for a relative time.
const intlRelative: (data: {
  language: string;
  value: number;
  unit: RelativeDateUnit;
  style: RelativeDateStyle;
  numeric: "auto" | "always";
}) => string = (data: {
  language: string;
  value: number;
  unit: RelativeDateUnit;
  style: RelativeDateStyle;
  numeric: "auto" | "always";
}): string => {
  return new Intl.RelativeTimeFormat(getNumberLocale(data.language), {
    numeric: data.numeric,
    style: data.style,
  }).format(data.value, data.unit);
};

/*
 * Intl's list of units, typed structurally: Common compiles against the
 * ES2017 library, which does not declare Intl.ListFormat.
 */
type UnitList = new (
  locale: string,
  options: { type: "unit"; style: "long" | "short" | "narrow" },
) => { format: (items: Array<string>) => string };

const listUnits: (
  language: string,
  style: "long" | "short" | "narrow",
  items: Array<string>,
) => string = (
  language: string,
  style: "long" | "short" | "narrow",
  items: Array<string>,
): string => {
  const ListFormat: UnitList = (Intl as unknown as { ListFormat: UnitList })
    .ListFormat;

  return new ListFormat(language, { type: "unit", style }).format(items);
};

// What Intl's unit list puts between two units: ", ", " und ", " ", "".
const listJoin: (
  language: string,
  style: "long" | "short" | "narrow",
) => string = (
  language: string,
  style: "long" | "short" | "narrow",
): string => {
  return listUnits(language, style, ["A", "B"]).slice(1, -1);
};

describe("an amount of a unit Intl writes holds its number to its unit", () => {
  test.each(LANGUAGES)(
    "%s: every unit of a duration, long, short and narrow, at every plural form",
    (language: string) => {
      const problems: Array<string> = [];

      for (const unit of DURATION_UNITS) {
        for (const display of DISPLAYS) {
          for (const count of COUNTS) {
            const written: string | null = formatDurationUnit({
              part: { count, unit },
              locale: language,
              unitDisplay: display,
            });
            const intl: string = intlUnit({
              language,
              unit,
              display,
              value: count,
            });
            // Every space a line breaks at in one amount is the number's or its unit's.
            const expected: string = intl.replace(
              BREAKING_SPACES,
              NO_BREAK_SPACE,
            );

            if (written !== expected || BREAKING_SPACE.test(written)) {
              problems.push(
                `${unit} ${display} ${count}: ${JSON.stringify(written)} (Intl ${JSON.stringify(intl)})`,
              );
            }
          }
        }
      }

      expect(problems).toEqual([]);
    },
  );

  test.each(LANGUAGES)(
    "%s: a figure with decimals and thousands, and a size and a rate",
    (language: string) => {
      const problems: Array<string> = [];

      for (const unit of [
        "second",
        "millisecond",
        "byte",
        "kilobyte",
        "megabyte",
        "gigabyte",
        "gigabit-per-second",
      ]) {
        for (const display of DISPLAYS) {
          for (const value of [1.5, 2.25, 1234.5, 98765.4]) {
            const written: string | null = formatUnitAmount({
              value,
              unit,
              locale: language,
              unitDisplay: display,
              maximumFractionDigits: 2,
            });
            const intl: string = intlUnit({
              language,
              unit,
              display,
              value,
              maximumFractionDigits: 2,
            });

            if (
              written !== intl.replace(BREAKING_SPACES, NO_BREAK_SPACE) ||
              brokenAfterFigures(written).length > 0
            ) {
              problems.push(`${unit} ${display} ${value}: ${written}`);
            }
          }
        }
      }

      expect(problems).toEqual([]);
    },
  );

  test("German, Arabic and Persian, as the issue found them", () => {
    expect(
      formatDurationUnit({
        part: { count: 5, unit: "minute" },
        locale: "de",
        unitDisplay: "short",
      }),
    ).toBe(`5${NO_BREAK_SPACE}Min.`);
    // Two spaces in Arabic's milliseconds, both held.
    expect(
      formatDurationUnit({
        part: { count: 5, unit: "millisecond" },
        locale: "ar",
        unitDisplay: "short",
      }),
    ).toBe(`5${NO_BREAK_SPACE}ملي${NO_BREAK_SPACE}ث`);
    expect(
      formatDurationUnit({
        part: { count: 12, unit: "minute" },
        locale: "fa",
        unitDisplay: "long",
      }),
    ).toBe(`۱۲${NO_BREAK_SPACE}دقیقه`);
    // Hindi's nanoseconds, a unit of two words.
    expect(
      formatDurationUnit({
        part: { count: 3, unit: "nanosecond" },
        locale: "hi",
        unitDisplay: "short",
      }),
    ).toBe(`3${NO_BREAK_SPACE}नैनो${NO_BREAK_SPACE}से॰`);
  });

  test("English is held too, as its sentences are (#8302)", () => {
    expect(
      formatDurationUnit({
        part: { count: 5, unit: "minute" },
        locale: "en",
        unitDisplay: "long",
      }),
    ).toBe(`5${NO_BREAK_SPACE}minutes`);
    expect(
      formatDurationUnit({
        part: { count: 1, unit: "hour" },
        locale: "en",
        unitDisplay: "long",
      }),
    ).toBe(`1${NO_BREAK_SPACE}hour`);
    // Narrow English writes no space at all, and none is added.
    expect(
      formatDurationUnit({
        part: { count: 5, unit: "minute" },
        locale: "en",
        unitDisplay: "narrow",
      }),
    ).toBe("5m");
  });

  test("French keeps its own no-break spaces, the narrow one too", () => {
    const short: string | null = formatDurationUnit({
      part: { count: 5, unit: "hour" },
      locale: "fr",
      unitDisplay: "short",
    });
    const long: string | null = formatDurationUnit({
      part: { count: 5, unit: "minute" },
      locale: "fr",
      unitDisplay: "long",
    });

    expect(short).toBe(
      intlUnit({ language: "fr", unit: "hour", display: "short", value: 5 }),
    );
    expect(short).toContain(NARROW_NO_BREAK_SPACE);
    // French writes a plain space before "minutes": that one is held.
    expect(long).toBe(`5${NO_BREAK_SPACE}minutes`);
    // Its thousands separator is its narrow no-break space, as it wrote it.
    expect(
      formatUnitAmount({
        value: 1234,
        unit: "second",
        locale: "fr",
        unitDisplay: "long",
      }),
    ).toBe(`1${NARROW_NO_BREAK_SPACE}234${NO_BREAK_SPACE}secondes`);
  });

  test("a stat tile's parts: the number, the held space, the unit", () => {
    expect(
      getUnitAmountParts({
        value: 4.2,
        unit: "megabyte",
        locale: "de",
        unitDisplay: "short",
        maximumFractionDigits: 1,
      }),
    ).toEqual([
      { type: "integer", value: "4" },
      { type: "decimal", value: "," },
      { type: "fraction", value: "2" },
      { type: "literal", value: NO_BREAK_SPACE },
      { type: "unit", value: "MB" },
    ]);
    // Persian's rate is a unit of three words, held whole.
    expect(
      formatUnitAmount({
        value: 1.2,
        unit: "gigabit-per-second",
        locale: "fa",
        unitDisplay: "short",
        maximumFractionDigits: 1,
      }),
    ).toBe(`۱٫۲${NO_BREAK_SPACE}Gb${NO_BREAK_SPACE}در${NO_BREAK_SPACE}ثانیه`);
  });

  test("a unit Intl does not know, or a locale it cannot read, is null", () => {
    expect(
      formatUnitAmount({
        value: 5,
        unit: "parsec",
        locale: "de",
        unitDisplay: "short",
      }),
    ).toBeNull();
    expect(
      formatUnitAmount({
        value: 5,
        unit: "minute",
        locale: "not a language tag",
        unitDisplay: "short",
      }),
    ).toBeNull();
  });
});

describe("a duration of several units holds each number to its unit", () => {
  const DURATIONS: ReadonlyArray<Array<DurationTextPart>> = [
    [
      { count: 2, unit: "day" },
      { count: 3, unit: "hour" },
    ],
    [
      { count: 1, unit: "hour" },
      { count: 30, unit: "minute" },
    ],
    [
      { count: 10, unit: "day" },
      { count: 23, unit: "hour" },
    ],
    [
      { count: 5, unit: "minute" },
      { count: 12, unit: "second" },
    ],
    [
      { count: 1, unit: "year" },
      { count: 2, unit: "month" },
      { count: 3, unit: "week" },
    ],
    [
      { count: 21, unit: "day" },
      { count: 22, unit: "hour" },
      { count: 0, unit: "minute" },
    ],
  ];

  test.each(LANGUAGES)(
    "%s: long, short and narrow units, in each list style",
    (language: string) => {
      const problems: Array<string> = [];

      for (const parts of DURATIONS) {
        for (const display of DISPLAYS) {
          for (const listStyle of DISPLAYS) {
            const written: string | null = formatDurationText({
              parts,
              locale: language,
              unitDisplay: display,
              listStyle,
            });
            const words: Array<string> = parts.map(
              (part: DurationTextPart): string => {
                return intlUnit({
                  language,
                  unit: part.unit,
                  display,
                  value: part.count,
                });
              },
            );
            const intl: string = listUnits(language, listStyle, words);
            // A line may still break between two units where the list breaks.
            const listBreaks: boolean = BREAKING_SPACE.test(
              listJoin(language, listStyle),
            );

            if (
              written === null ||
              spaced(written) !== spaced(intl) ||
              brokenAfterFigures(written).length > 0 ||
              BREAKING_SPACE.test(written) !== listBreaks
            ) {
              problems.push(
                `${JSON.stringify(parts)} ${display}/${listStyle}: ${JSON.stringify(written)} (Intl ${JSON.stringify(intl)})`,
              );
            }
          }
        }
      }

      expect(problems).toEqual([]);
    },
  );

  test("German and English, as a table's Duration column reads them", () => {
    expect(
      formatDurationText({
        parts: [
          { count: 2, unit: "day" },
          { count: 3, unit: "hour" },
        ],
        locale: "de",
        unitDisplay: "long",
        listStyle: "long",
      }),
    ).toBe(`2${NO_BREAK_SPACE}Tage, 3${NO_BREAK_SPACE}Stunden`);
    expect(
      formatDurationText({
        parts: [
          { count: 1, unit: "hour" },
          { count: 30, unit: "minute" },
        ],
        locale: "en",
        unitDisplay: "long",
        listStyle: "long",
      }),
    ).toBe(`1${NO_BREAK_SPACE}hour, 30${NO_BREAK_SPACE}minutes`);
    expect(
      formatDurationText({
        parts: [
          { count: 2, unit: "hour" },
          { count: 5, unit: "minute" },
        ],
        locale: "de",
        unitDisplay: "short",
        listStyle: "narrow",
      }),
    ).toBe(`2${NO_BREAK_SPACE}Std., 5${NO_BREAK_SPACE}Min.`);
  });
});

describe("a relative time holds its number to its unit, and only that", () => {
  test.each(LANGUAGES)(
    "%s: every unit, past and future, long, short and narrow",
    (language: string) => {
      const problems: Array<string> = [];

      for (const unit of RELATIVE_UNITS) {
        for (const style of STYLES) {
          for (const count of COUNTS.filter((value: number): boolean => {
            return value > 0;
          })) {
            for (const isFuture of [false, true]) {
              const written: string | null = formatRelativeAmount({
                count,
                unit,
                isFuture,
                locale: language,
                style,
              });
              const intl: string = intlRelative({
                language,
                value: isFuture ? count : -count,
                unit,
                style,
                numeric: "always",
              });
              const before: (text: string) => string = (
                text: string,
              ): string => {
                const at: number = text.search(/\p{Nd}/u);

                return at > 0 ? text.charAt(at - 1) : "";
              };

              if (
                written === null ||
                spaced(written) !== spaced(intl) ||
                written.length !== intl.length ||
                brokenAfterFigures(written).length > 0 ||
                // The word before the number stays apart: "vor" | "5 Minuten".
                before(written) !== before(intl)
              ) {
                problems.push(
                  `${unit} ${style} ${isFuture ? "+" : "-"}${count}: ${JSON.stringify(written)} (Intl ${JSON.stringify(intl)})`,
                );
              }
            }
          }
        }
      }

      expect(problems).toEqual([]);
    },
  );

  test("German, Arabic, Persian and English, as the issue found them", () => {
    expect(
      formatRelativeAmount({
        count: 5,
        unit: "minute",
        isFuture: false,
        locale: "de",
      }),
    ).toBe(`vor 5${NO_BREAK_SPACE}Minuten`);
    expect(
      formatRelativeAmount({
        count: 5,
        unit: "minute",
        isFuture: false,
        locale: "de",
        style: "short",
      }),
    ).toBe(`vor 5${NO_BREAK_SPACE}Min.`);
    expect(
      formatRelativeAmount({
        count: 3,
        unit: "day",
        isFuture: true,
        locale: "ar",
      }),
    ).toBe(`خلال 3${NO_BREAK_SPACE}أيام`);
    expect(
      formatRelativeAmount({
        count: 12,
        unit: "second",
        isFuture: false,
        locale: "fa",
        style: "short",
      }),
    ).toBe(`۱۲${NO_BREAK_SPACE}ثانیه پیش`);
    expect(
      formatRelativeAmount({
        count: 5,
        unit: "minute",
        isFuture: true,
        locale: "en",
      }),
    ).toBe(`in 5${NO_BREAK_SPACE}minutes`);
    expect(
      formatRelativeAmount({
        count: 4,
        unit: "hour",
        isFuture: false,
        locale: "en",
      }),
    ).toBe(`4${NO_BREAK_SPACE}hours ago`);
  });

  test("a language that writes its unit before the number holds that side: Swahili", () => {
    const written: string | null = formatRelativeAmount({
      count: 5,
      unit: "minute",
      isFuture: false,
      locale: "sw",
    });

    expect(written).toBe(
      intlRelative({
        language: "sw",
        value: -5,
        unit: "minute",
        style: "long",
        numeric: "always",
      }).replace(/ (?=5)/, NO_BREAK_SPACE),
    );
    expect(written).toMatch(/^\S+\u00A05 /);
  });

  test.each(LANGUAGES)(
    "%s: the words a language has for a day or now are as Intl wrote them",
    (language: string) => {
      for (const [count, isFuture] of [
        [0, false],
        [1, false],
        [1, true],
      ] as Array<[number, boolean]>) {
        expect(
          formatRelativeAmount({
            count,
            unit: "day",
            isFuture,
            locale: language,
            numeric: "auto",
          }),
        ).toBe(
          intlRelative({
            language,
            value: isFuture ? count : -count,
            unit: "day",
            style: "long",
            numeric: "auto",
          }),
        );
      }

      expect(
        formatRelativeAmount({
          count: 0,
          unit: "second",
          isFuture: false,
          locale: language,
          numeric: "auto",
        }),
      ).toBe(
        intlRelative({
          language,
          value: -0,
          unit: "second",
          style: "long",
          numeric: "auto",
        }),
      );
    },
  );

  test.each(LANGUAGES)(
    "%s: how long ago a date was (formatRelativeDate, fromNow)",
    (language: string) => {
      const now: Date = new Date("2026-11-15T12:00:00Z");

      for (const minutesAgo of [5, 3 * 60, 3 * 24 * 60, 90 * 24 * 60]) {
        const written: string | null = formatRelativeDate({
          date: new Date(now.getTime() - minutesAgo * 60 * 1000),
          now,
          locale: getDateLocale(language),
        });

        expect({
          minutesAgo,
          broken: brokenAfterFigures(written || ""),
        }).toEqual({ minutesAgo, broken: [] });
      }

      // "now" has no number to hold.
      expect(
        formatRelativeDate({ date: now, now, locale: getDateLocale(language) }),
      ).toBe(
        intlRelative({
          language: getDateLocale(language),
          value: 0,
          unit: "second",
          style: "long",
          numeric: "auto",
        }),
      );
    },
  );

  test("no locale is the runtime's own", () => {
    expect(
      formatRelativeAmount({
        count: 2,
        unit: "hour",
        isFuture: false,
        locale: undefined,
      }),
    ).toBe(
      new Intl.RelativeTimeFormat(undefined, { numeric: "always" })
        .format(-2, "hour")
        .replace(/ (?=\D)/, NO_BREAK_SPACE),
    );
  });
});

describe("the helpers built on DateLanguage hold their numbers in every language", () => {
  test.each(LANGUAGES)(
    "%s: a compact duration in a sentence (formatDurationCompactInLanguage)",
    (language: string) => {
      for (const seconds of [
        0,
        45,
        3 * 3600 + 12 * 60,
        2 * 86400 + 5 * 3600,
        90061,
      ]) {
        const written: string = formatDurationCompactInLanguage(
          seconds,
          language,
        );

        expect({
          seconds,
          written,
          broken: brokenAfterFigures(written),
        }).toEqual({ seconds, written, broken: [] });
      }
    },
  );

  test("English compact durations are as they were: no space to hold", () => {
    expect(formatDurationCompactInLanguage(45, "en")).toBe("45s");
    expect(formatDurationCompactInLanguage(3 * 3600 + 12 * 60, "en")).toBe(
      "3h 12m",
    );
    expect(formatDurationCompactInLanguage(2 * 86400 + 5 * 3600, "en")).toBe(
      "2d 5h",
    );
    expect(formatDurationCompactInLanguage(3 * 3600 + 12 * 60, "de")).toBe(
      `3${NO_BREAK_SPACE}Std., 12${NO_BREAK_SPACE}Min.`,
    );
  });

  test.each(LANGUAGES)(
    "%s: OneUptimeDate's durations and how long ago (getHoursAndMinutesFromMinutes, fromNow)",
    (language: string) => {
      withDateDisplayLanguage(language, () => {
        const now: Date = new Date("2026-11-15T12:00:00Z");

        for (const minutes of [0, 1, 5, 65, 125, 1500]) {
          const written: string =
            OneUptimeDate.getHoursAndMinutesFromMinutes(minutes);

          // English writes its own words, from code: "2 hours 5 minutes".
          if (language !== "en") {
            expect({ minutes, broken: brokenAfterFigures(written) }).toEqual({
              minutes,
              broken: [],
            });
          }
        }

        const ago: string = OneUptimeDate.fromNow(
          new Date(now.getTime() - 5 * 60 * 60 * 1000),
          now,
        );

        if (language !== "en") {
          expect({ ago, broken: brokenAfterFigures(ago) }).toEqual({
            ago,
            broken: [],
          });
        }
      });
    },
  );

  test.each(LANGUAGES)(
    "%s: a duration in another unit (formatDurationInUnit)",
    (language: string) => {
      const translator: Translator = createTranslator(undefined, language);

      for (const unit of [
        "nanosecond",
        "microsecond",
        "second",
        "minute",
        "hour",
        "day",
      ] as Array<DurationInUnit>) {
        for (const value of [1, 1.5, 1234.25]) {
          const written: string = formatDurationInUnit(
            translator,
            value,
            unit,
            { decimals: 2 },
          );

          expect({
            unit,
            value,
            written,
            breaks: BREAKING_SPACE.test(written),
          }).toEqual({ unit, value, written, breaks: false });
        }
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: a feed's day, its last hour's hint and how long ago (FeedTime)",
    (language: string) => {
      const now: Date = new Date("2026-11-15T12:00:00Z");
      const clock: FeedClock = {
        timezone: "UTC",
        language,
        use12HourClock: false,
        now,
      };
      const minutesAgo: (minutes: number) => Date = (minutes: number): Date => {
        return new Date(now.getTime() - minutes * 60 * 1000);
      };

      for (const text of [
        getFeedRelativeHint(minutesAgo(12), clock),
        getFeedRelativeHint(minutesAgo(1), clock),
        formatFeedTimeAgo(minutesAgo(7), clock),
        formatFeedTimeAgo(minutesAgo(3 * 60), clock),
        formatFeedTimeAgo(minutesAgo(3 * 24 * 60), clock),
        formatFeedTimeAgo(minutesAgo(90 * 24 * 60), clock),
      ]) {
        expect({ text, broken: brokenAfterFigures(text || "") }).toEqual({
          text,
          broken: [],
        });
      }

      // Today and yesterday name no number.
      expect(getFeedRelativeDay(now, clock)).toBeDefined();
      expect(getFeedRelativeDay(minutesAgo(24 * 60), clock)).toBeDefined();
    },
  );
});

describe("negative controls: what holds no unit is as Intl wrote it", () => {
  test("a number without a unit keeps its spaces", () => {
    // Russian groups its thousands with a no-break space, Intl's own.
    expect(
      formatDecimal({ value: 1234.5, locale: "ru", maximumFractionDigits: 1 }),
    ).toBe("1234,5");
    expect(
      holdUnitToNumber([
        { type: "integer", value: "1" },
        { type: "group", value: " " },
        { type: "integer", value: "234" },
      ]),
    ).toEqual([
      { type: "integer", value: "1" },
      { type: "group", value: " " },
      { type: "integer", value: "234" },
    ]);
  });

  test("only the literal between the number and its unit is held", () => {
    const parts: Array<IntlTextPart> = [
      { type: "literal", value: "about " },
      { type: "integer", value: "5" },
      { type: "literal", value: " " },
      { type: "unit", value: "ملي ث" },
      { type: "literal", value: " left" },
    ];

    expect(holdUnitToNumber(parts)).toEqual([
      { type: "literal", value: "about " },
      { type: "integer", value: "5" },
      { type: "literal", value: NO_BREAK_SPACE },
      { type: "unit", value: `ملي${NO_BREAK_SPACE}ث` },
      { type: "literal", value: " left" },
    ]);
    // A unit written first is held to the number after it.
    expect(
      holdUnitToNumber([
        { type: "unit", value: "dakika" },
        { type: "literal", value: " " },
        { type: "integer", value: "5" },
      ]),
    ).toEqual([
      { type: "unit", value: "dakika" },
      { type: "literal", value: NO_BREAK_SPACE },
      { type: "integer", value: "5" },
    ]);
    // The figure space, and a no-break space, are left as they are.
    expect(
      holdUnitToNumber([
        { type: "integer", value: "5" },
        { type: "literal", value: "\u202F" },
        { type: "unit", value: "h" },
      ]),
    ).toEqual([
      { type: "integer", value: "5" },
      { type: "literal", value: "\u202F" },
      { type: "unit", value: "h" },
    ]);
  });

  test("a relative time holds the space on its unit's side, and a text with no number is untouched", () => {
    const vorFünfMinuten: Array<IntlTextPart> = [
      { type: "literal", value: "vor " },
      { type: "integer", value: "5" },
      { type: "literal", value: " Minuten" },
    ];

    expect(holdRelativeUnitToNumber(vorFünfMinuten, false)).toBe(
      `vor 5${NO_BREAK_SPACE}Minuten`,
    );
    expect(holdRelativeUnitToNumber(vorFünfMinuten, true)).toBe(
      `vor${NO_BREAK_SPACE}5 Minuten`,
    );
    expect(
      holdRelativeUnitToNumber(
        [{ type: "literal", value: "vor 2 Tagen" }],
        false,
      ),
    ).toBe("vor 2 Tagen");
    expect(
      holdRelativeUnitToNumber([{ type: "literal", value: "gestern" }], false),
    ).toBe("gestern");
    // A number at the very end has nothing after it to hold.
    expect(
      holdRelativeUnitToNumber(
        [
          { type: "literal", value: "baada ya dakika " },
          { type: "integer", value: "5" },
        ],
        false,
      ),
    ).toBe("baada ya dakika 5");
    // A thousands separator inside the number is the number's.
    expect(
      holdRelativeUnitToNumber(
        [
          { type: "integer", value: "1" },
          { type: "group", value: "," },
          { type: "integer", value: "234" },
          { type: "literal", value: " seconds ago" },
        ],
        false,
      ),
    ).toBe(`1,234${NO_BREAK_SPACE}seconds ago`);
  });

  test("the check finds a figure a line could part from its unit", () => {
    expect(brokenAfterFigures("vor 5 Minuten")).toEqual([" "]);
    expect(brokenAfterFigures(`vor 5${NO_BREAK_SPACE}Minuten`)).toEqual([]);
    expect(brokenAfterFigures("2 Tage, 3 Stunden")).toEqual([" ", " "]);
    expect(brokenAfterFigures(`1${NO_BREAK_SPACE}234 Sek.`)).toEqual([" "]);
    expect(brokenAfterFigures("۱۲ ثانیه پیش")).toEqual([" "]);
    expect(brokenAfterFigures("5分前")).toEqual([]);
  });
});

/** @timezone UTC */

import { afterEach, describe, expect, test } from "@jest/globals";
import moment from "moment-timezone";
import {
  ENGLISH_DATE_LANGUAGE,
  MAX_REMEMBERED_DATE_TEXTS,
  RelativeDistance,
  forgetRememberedDateTexts,
  formatDecimal,
  formatDurationText,
  formatRelativeDate,
  getDateDisplayLanguage,
  getDateLocale,
  getDigitsOf,
  getEnglishOf,
  getRelativeDistance,
  inEnglishDates,
  isEnglishDateLanguage,
  rememberEnglishOf,
  setDateDisplayLanguage,
  withDateDisplayLanguage,
  writeDigitsInLocale,
  writeInDateDisplayLanguage,
} from "../../Types/DateLanguage";
import { SeededRandom, seededRandom } from "../Helpers/SeededRandom";

/*
 * Common/Types/DateLanguage: the language OneUptimeDate writes dates in, the
 * Intl pieces it writes them with, and the English every date written in
 * another language is remembered with - what a sentence still in English
 * puts back.
 */

const NOW: Date = new Date("2026-10-06T09:05:07Z");

// A space, a no-break space or a narrow one: the same to a reader.
const ANY_SPACE: RegExp = /\s/g;

afterEach(() => {
  setDateDisplayLanguage(null);
  forgetRememberedDateTexts();
});

describe("the display language", () => {
  test("is English until a frontend sets one, and the zone is UTC here", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("UTC");
    expect(getDateDisplayLanguage()).toBe(ENGLISH_DATE_LANGUAGE);
  });

  test.each([
    ["de", "de"],
    ["zh-CN", "zh-CN"],
    [" fa ", "fa"],
    ["en", "en"],
    ["en-GB", "en"],
    ["EN-us", "en"],
    ["", "en"],
    [null, "en"],
    [undefined, "en"],
  ])("%p reads as %p", (language: string | null | undefined, read: string) => {
    setDateDisplayLanguage(language);

    expect(getDateDisplayLanguage()).toBe(read);
    expect(isEnglishDateLanguage(language)).toBe(read === "en");
  });

  test("a sentence's language holds for the work only, even when it throws", () => {
    setDateDisplayLanguage("de");

    expect(
      withDateDisplayLanguage("ja", (): string => {
        return getDateDisplayLanguage();
      }),
    ).toBe("ja");
    expect(getDateDisplayLanguage()).toBe("de");

    expect(() => {
      withDateDisplayLanguage("fr", (): void => {
        throw new Error("boom");
      });
    }).toThrow("boom");
    expect(getDateDisplayLanguage()).toBe("de");

    expect(
      inEnglishDates((): string => {
        return getDateDisplayLanguage();
      }),
    ).toBe("en");
    expect(getDateDisplayLanguage()).toBe("de");
  });
});

describe("the Intl locale a language writes dates in", () => {
  test.each([
    ["de", "de-u-ca-gregory"],
    ["fa", "fa-u-ca-gregory"],
    ["zh-CN", "zh-CN-u-ca-gregory"],
    ["en", "en-u-ca-gregory"],
    // A language Intl does not know reads English, never the browser's own.
    ["xx-notalanguage", "en-u-ca-gregory"],
  ])("%s -> %s", (language: string, locale: string) => {
    expect(getDateLocale(language)).toBe(locale);
  });

  /*
   * Persian's counts and sentences are written in its own digits (the
   * translator's formatNumber, and the translations themselves): its dates
   * are too, so a Persian page no longer mixes "۲ حادثه" with "26 Oct".
   * The calendar stays the Gregorian one every timestamp is written in.
   */
  test("Persian is written with the Gregorian calendar and its own digits", () => {
    const text: string = new Intl.DateTimeFormat(getDateLocale("fa"), {
      year: "numeric",
      month: "short",
      day: "2-digit",
      timeZone: "UTC",
    }).format(NOW);

    expect(text).toContain("۲۰۲۶");
    expect(text).toContain("۰۶");
    expect(text).toContain("اکتبر");
    expect(text).not.toMatch(/[0-9]/);
  });

  test("every other language OneUptime is translated into keeps Latin digits", () => {
    for (const language of [
      "en",
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
    ]) {
      const text: string = new Intl.DateTimeFormat(getDateLocale(language), {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: "UTC",
      }).format(NOW);

      expect({ language, hasLatinDigits: text.includes("2026") }).toEqual({
        language,
        hasLatinDigits: true,
      });
    }
  });
});

describe("the English a date written in another language is remembered with", () => {
  test("English writes English and remembers nothing", () => {
    const text: string = writeInDateDisplayLanguage(
      (): string => {
        return "5 hours ago";
      },
      (): string => {
        return "vor 5 Stunden";
      },
    );

    expect(text).toBe("5 hours ago");
    expect(getEnglishOf("5 hours ago")).toBeUndefined();
    expect(getEnglishOf("vor 5 Stunden")).toBeUndefined();
  });

  test("another language writes its own text and remembers the English", () => {
    setDateDisplayLanguage("de");

    const text: string = writeInDateDisplayLanguage(
      (): string => {
        return "5 hours ago";
      },
      (language: string, locale: string): string => {
        expect(language).toBe("de");
        expect(locale).toBe("de-u-ca-gregory");

        return "vor 5 Stunden";
      },
    );

    expect(text).toBe("vor 5 Stunden");
    expect(getEnglishOf("vor 5 Stunden")).toBe("5 hours ago");
    // Anything else is no date of ours.
    expect(getEnglishOf("Maya Chen")).toBeUndefined();
  });

  test("the English is worked out in English, whatever the language is then", () => {
    setDateDisplayLanguage("de");

    writeInDateDisplayLanguage(
      (): string => {
        return `in ${getDateDisplayLanguage()}`;
      },
      (): string => {
        return "auf Deutsch";
      },
    );

    expect(getDateDisplayLanguage()).toBe("de");
    expect(getEnglishOf("auf Deutsch")).toBe("in en");
  });

  test("a language whose text cannot be written reads English", () => {
    setDateDisplayLanguage("de");

    for (const localized of [
      (): null => {
        return null;
      },
      (): string => {
        return "";
      },
      (): string => {
        throw new Error("no Intl");
      },
    ]) {
      expect(
        writeInDateDisplayLanguage((): string => {
          return "Oct 06 2026";
        }, localized),
      ).toBe("Oct 06 2026");
    }
  });

  test("only the newest texts are kept, the oldest go first", () => {
    for (let index: number = 0; index <= MAX_REMEMBERED_DATE_TEXTS; index++) {
      rememberEnglishOf(`Text ${index}`, (): string => {
        return `English ${index}`;
      });
    }

    expect(getEnglishOf("Text 0")).toBeUndefined();
    expect(getEnglishOf("Text 1")).toBe("English 1");
    expect(getEnglishOf(`Text ${MAX_REMEMBERED_DATE_TEXTS}`)).toBe(
      `English ${MAX_REMEMBERED_DATE_TEXTS}`,
    );

    // Written again, a text is the newest: it outlives the next one in.
    rememberEnglishOf("Text 1", (): string => {
      return "English 1";
    });
    rememberEnglishOf("Text again", (): string => {
      return "English again";
    });

    expect(getEnglishOf("Text 1")).toBe("English 1");
    expect(getEnglishOf("Text 2")).toBeUndefined();
  });
});

describe("how far a date is from now, rounded as moment's fromNow rounds", () => {
  type MomentReading = { isNow: boolean; count: number; unit: string };

  const UNITS: Record<string, string> = {
    second: "second",
    seconds: "second",
    minute: "minute",
    minutes: "minute",
    hour: "hour",
    hours: "hour",
    day: "day",
    days: "day",
    month: "month",
    months: "month",
    year: "year",
    years: "year",
  };

  // "a few seconds ago", "in 5 minutes", "an hour ago" as numbers.
  const readMoment: (text: string) => MomentReading = (
    text: string,
  ): MomentReading => {
    const words: Array<string> = text
      .replace(" ago", "")
      .replace("in ", "")
      .split(" ");

    if (text.includes("few seconds")) {
      return { isNow: true, count: 0, unit: "second" };
    }

    const count: number =
      words[0] === "a" || words[0] === "an" ? 1 : Number(words[0]);

    return { isNow: false, count, unit: UNITS[words[1] as string] as string };
  };

  test("every age agrees with moment, in the past and the future", () => {
    const random: SeededRandom = seededRandom(5112);
    const ages: Array<number> = [
      0,
      1000,
      44000,
      44999,
      45000,
      89000,
      90000,
      44 * 60000,
      45 * 60000,
      89 * 60000,
      90 * 60000,
      21 * 3600000,
      22 * 3600000,
      35 * 3600000,
      36 * 3600000,
      25 * 86400000,
      26 * 86400000,
      45 * 86400000,
      320 * 86400000,
      547 * 86400000,
      548 * 86400000,
    ];

    for (let index: number = 0; index < 4000; index++) {
      // Spread over five years, most of them short.
      const scale: number = [60000, 3600000, 86400000, 5 * 365 * 86400000][
        random(4)
      ] as number;

      ages.push(Math.floor(random() * scale));
    }

    for (const age of ages) {
      for (const sign of [-1, 1]) {
        const date: Date = new Date(NOW.getTime() + sign * age);
        const english: MomentReading = readMoment(
          moment(date).from(moment(NOW)),
        );
        const distance: RelativeDistance = getRelativeDistance(date, NOW);

        expect({ age, sign, isNow: distance.isNow }).toEqual({
          age,
          sign,
          isNow: english.isNow,
        });

        if (!english.isNow) {
          expect({
            age,
            sign,
            count: distance.count,
            unit: distance.unit,
          }).toEqual({
            age,
            sign,
            count: english.count,
            unit: english.unit,
          });
          expect(distance.isFuture).toBe(sign > 0);
        }
      }
    }
  });

  test.each([
    ["de", -5 * 3600000, "vor 5 Stunden"],
    ["de", 3 * 86400000 + 1000, "in 3 Tagen"],
    ["de", -10000, "jetzt"],
    ["de", -60000, "vor 1 Minute"],
    ["fr", -5 * 3600000, "il y a 5 heures"],
    ["ja", -5 * 3600000, "5 時間前"],
    ["ru", 3 * 86400000 + 1000, "через 3 дня"],
    ["fa", -5 * 3600000, "۵ ساعت پیش"],
  ])(
    "in %s, %i ms from now reads %s",
    (language: string, offset: number, text: string) => {
      expect(
        formatRelativeDate({
          date: new Date(NOW.getTime() + offset),
          now: NOW,
          locale: getDateLocale(language),
        }),
      ).toBe(text);
    },
  );

  test("an invalid date is not written", () => {
    expect(
      formatRelativeDate({
        date: new Date("not a date"),
        now: NOW,
        locale: getDateLocale("de"),
      }),
    ).toBeNull();
  });
});

describe("durations and figures", () => {
  test.each([
    ["de", "long", "long", "2 Tage, 3 Stunden und 5 Minuten"],
    ["fr", "long", "long", "2 jours, 3 heures et 5 minutes"],
    ["ja", "long", "long", "2 日 3 時間 5 分"],
    ["ru", "long", "long", "2 дня 3 часа 5 минут"],
  ])(
    "%s writes a duration's units in its own words",
    (
      language: string,
      unitDisplay: string,
      listStyle: string,
      text: string,
    ) => {
      // French puts no-break spaces between a figure and its unit.
      expect(
        (
          formatDurationText({
            parts: [
              { count: 2, unit: "day" },
              { count: 3, unit: "hour" },
              { count: 5, unit: "minute" },
            ],
            locale: getDateLocale(language),
            unitDisplay: unitDisplay as "long",
            listStyle: listStyle as "long",
          }) || ""
        ).replace(ANY_SPACE, " "),
      ).toBe(text);
    },
  );

  test("one unit is written alone, and no units is nothing", () => {
    expect(
      formatDurationText({
        parts: [{ count: 1, unit: "hour" }],
        locale: getDateLocale("de"),
        unitDisplay: "long",
        listStyle: "long",
      }),
    ).toBe("1 Stunde");
    expect(
      formatDurationText({
        parts: [],
        locale: getDateLocale("de"),
        unitDisplay: "long",
        listStyle: "long",
      }),
    ).toBeNull();
  });

  test("an engine without Intl's unit style writes no duration", () => {
    const original: typeof Intl.NumberFormat = Intl.NumberFormat;

    // Such an engine ignores the unit and writes the bare number.
    (Intl as unknown as { NumberFormat: unknown }).NumberFormat = function (
      locale: string,
    ): { format: (value: number) => string } {
      return {
        format: (value: number): string => {
          return value.toLocaleString(locale);
        },
      };
    };

    try {
      expect(
        formatDurationText({
          parts: [{ count: 2, unit: "hour" }],
          locale: getDateLocale("de"),
          unitDisplay: "long",
          listStyle: "long",
        }),
      ).toBeNull();
    } finally {
      (Intl as unknown as { NumberFormat: unknown }).NumberFormat = original;
    }

    // The real one is read again.
    expect(
      formatDurationText({
        parts: [{ count: 2, unit: "hour" }],
        locale: getDateLocale("de"),
        unitDisplay: "long",
        listStyle: "long",
      }),
    ).toBe("2 Stunden");
  });

  test.each([
    ["de", 1.72, "1,72"],
    ["fr", 1.72, "1,72"],
    ["ja", 1.72, "1.72"],
    ["fa", 1.72, "۱٫۷۲"],
    // No thousands separator: a duration's figure is read as one number.
    ["de", 1234.5, "1234,5"],
  ])("%s writes %p as %p", (language: string, value: number, text: string) => {
    expect(
      formatDecimal({
        value,
        locale: getDateLocale(language),
        maximumFractionDigits: 2,
      }),
    ).toBe(text);
  });
});

describe("the digits a language writes", () => {
  test("Persian writes its own, 0 to 9", () => {
    expect(getDigitsOf(getDateLocale("fa"))).toEqual([
      "۰",
      "۱",
      "۲",
      "۳",
      "۴",
      "۵",
      "۶",
      "۷",
      "۸",
      "۹",
    ]);
  });

  test("every other language OneUptime is translated into writes Latin ones", () => {
    for (const language of ["en", "de", "fr", "ja", "zh-CN", "hi", "ru"]) {
      expect({
        language,
        digits: getDigitsOf(getDateLocale(language)),
      }).toEqual({
        language,
        digits: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
      });
    }
  });

  test("a locale Intl cannot read writes Latin ones", () => {
    expect(getDigitsOf("not a locale!")).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
    ]);
  });

  test("a figure OneUptime wrote is written in the reader's digits", () => {
    const persian: string = getDateLocale("fa");

    expect(writeDigitsInLocale("09:00", persian)).toBe("۰۹:۰۰");
    expect(writeDigitsInLocale("every 15 minutes", persian)).toBe(
      "every ۱۵ minutes",
    );
    expect(writeDigitsInLocale("2026-10-26", persian)).toBe("۲۰۲۶-۱۰-۲۶");
  });

  test("a language that writes Latin digits gets the text back as it was", () => {
    for (const language of ["en", "de", "ja"]) {
      expect(writeDigitsInLocale("09:05", getDateLocale(language))).toBe(
        "09:05",
      );
    }
  });

  test("text with no figures, or in Persian digits already, is unchanged", () => {
    const persian: string = getDateLocale("fa");

    expect(writeDigitsInLocale("", persian)).toBe("");
    expect(writeDigitsInLocale("ساعت", persian)).toBe("ساعت");
    expect(writeDigitsInLocale("۰۹:۰۰", persian)).toBe("۰۹:۰۰");
  });
});

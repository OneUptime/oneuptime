/** @timezone UTC */

import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import OneUptimeDate from "../../Types/Date";
import {
  forgetRememberedDateTexts,
  getEnglishOf,
  setDateDisplayLanguage,
  withDateDisplayLanguage,
} from "../../Types/DateLanguage";
import Timezone from "../../Types/Timezone";
import { DASHBOARD_LANGUAGES } from "../Helpers/TranslatedLanguages";

/*
 * "Oct 06 2026, 10:05 BST", "5 hours ago", "2 days, 3 hours" were written
 * in English under every page. Once a frontend sets the reader's language,
 * OneUptimeDate writes them in it - the words of the date, its order and
 * its figures - and remembers each with its English, which a sentence
 * still in English puts back (TranslateTemplate). English, which is what
 * nothing has set, reads word for word as before.
 *
 * The instant is 09:05:07 UTC, 10:05:07 in London (BST); the runtime's own
 * zone is UTC.
 */

const INSTANT: Date = new Date("2026-10-06T09:05:07Z");

// A space, a no-break space or a narrow one: the same to a reader.
const ANY_SPACE: RegExp = /\s/g;

// Persian (U+06F0-U+06F9) and Arabic-Indic (U+0660-U+0669) digits.
const NON_LATIN_DIGITS: RegExp = /[\u{06F0}-\u{06F9}\u{0660}-\u{0669}]/u;

const spaced: (text: string) => string = (text: string): string => {
  return text.replace(ANY_SPACE, " ");
};

beforeEach(() => {
  OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);
});

afterEach(() => {
  setDateDisplayLanguage(null);
  OneUptimeDate.setUserTimezone(null);
  forgetRememberedDateTexts();
});

interface Reading {
  name: string;
  read: () => string;
}

// Every helper that writes a date's, a time's or a duration's words.
const READINGS: Array<Reading> = [
  {
    name: "local date and time",
    read: (): string => {
      return OneUptimeDate.getDateAsLocalFormattedString(INSTANT);
    },
  },
  {
    name: "local date",
    read: (): string => {
      return OneUptimeDate.getDateAsLocalFormattedString(INSTANT, true);
    },
  },
  {
    name: "local 12-hour time with seconds",
    read: (): string => {
      return OneUptimeDate.getDateAsLocalFormattedString(
        INSTANT,
        false,
        true,
        true,
      );
    },
  },
  {
    name: "date in the runtime's zone",
    read: (): string => {
      return OneUptimeDate.getDateAsFormattedString(INSTANT);
    },
  },
  {
    name: "short date and time",
    read: (): string => {
      return OneUptimeDate.getDateAsLocalShortDateTimeString(INSTANT, {
        use12HourFormat: false,
      });
    },
  },
  {
    name: "day and month",
    read: (): string => {
      return OneUptimeDate.getDateAsLocalDayMonthString(INSTANT);
    },
  },
  {
    // A date in a list's cell (Table/TableDate): this year's, no zone.
    name: "a list's date",
    read: (): string => {
      return OneUptimeDate.getDateAsCompactLocalString(INSTANT, {
        now: INSTANT,
        use12HourFormat: false,
      });
    },
  },
  {
    // ...and one of another year: the date alone, with its year.
    name: "a list's date of another year",
    read: (): string => {
      return OneUptimeDate.getDateAsCompactLocalString(INSTANT, {
        now: new Date("2027-02-01T00:00:00Z"),
        use12HourFormat: false,
      });
    },
  },
  {
    name: "month and year",
    read: (): string => {
      return OneUptimeDate.getDateAsLocalMonthYearString(INSTANT);
    },
  },
  {
    name: "a weekday in another zone",
    read: (): string => {
      return OneUptimeDate.getDateAsFormattedStringInTimezone({
        date: INSTANT,
        timezone: Timezone.AmericaNew_York,
        showWeekday: true,
        use12HourFormat: false,
      });
    },
  },
  {
    name: "several zones",
    read: (): string => {
      return OneUptimeDate.getDateAsFormattedArrayInMultipleTimezones({
        date: INSTANT,
        timezones: [Timezone.UTC, Timezone.AsiaKolkata],
        use12HourFormat: false,
      }).join(" | ");
    },
  },
  {
    name: "a status page report's month",
    read: (): string => {
      return OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
        date: INSTANT,
        format: "MMMM YYYY",
        timezone: Timezone.EuropeLondon,
      });
    },
  },
  {
    name: "hours and minutes",
    read: (): string => {
      return OneUptimeDate.getHoursAndMinutesFromMinutes(125);
    },
  },
  {
    name: "days, hours, minutes and seconds",
    read: (): string => {
      return OneUptimeDate.convertSecondsToDaysHoursMinutesAndSeconds(
        2 * 86400 + 3 * 3600 + 4 * 60 + 5,
      );
    },
  },
  {
    name: "days, hours and minutes",
    read: (): string => {
      return OneUptimeDate.convertMinutesToDaysHoursAndMinutes(2 * 1440 + 180);
    },
  },
  {
    name: "a friendly time",
    read: (): string => {
      return OneUptimeDate.secondsToFormattedFriendlyTimeString(
        400 * 86400 + 3 * 3600 + 5 * 60 + 6,
      );
    },
  },
  {
    name: "a span's duration",
    read: (): string => {
      return OneUptimeDate.getHumanizedDurationFromNanoseconds({
        nanoseconds: 1.72e9,
      });
    },
  },
];

const ENGLISH: Record<string, string> = {
  "local date and time": "Oct 06 2026, 10:05 BST",
  "local date": "Oct 06, 2026",
  "local 12-hour time with seconds": "Oct 06 2026, 10:05:07 AM BST",
  "date in the runtime's zone": "Oct 06 2026, 09:05 GMT",
  "short date and time": "Oct 6, 10:05",
  "day and month": "06 Oct",
  "a list's date": "Oct 6, 10:05",
  "a list's date of another year": "Oct 6, 2026",
  "month and year": "Oct 2026",
  "a weekday in another zone": "Tue, Oct 6, 2026, 05:05 EDT",
  "several zones": "Oct 06 2026, 09:05 UTC | Oct 06 2026, 14:35 IST",
  "a status page report's month": "October 2026",
  "hours and minutes": "2 hours 5 minutes",
  "days, hours, minutes and seconds": "2 days, 3 hours, 4 minutes, 5 seconds",
  "days, hours and minutes": "2 days, 3 hours, 0 minutes",
  "a friendly time": "1 year 1 month 4 days 3 hours 5 mins 6 secs",
  "a span's duration": "1.72 s",
};

const GERMAN: Record<string, string> = {
  "local date and time": "06. Okt. 2026, 10:05 BST",
  "local date": "06. Okt. 2026",
  "local 12-hour time with seconds": "06. Okt. 2026, 10:05:07 AM BST",
  "date in the runtime's zone": "06. Okt. 2026, 09:05 GMT",
  "short date and time": "6. Okt., 10:05",
  "day and month": "6. Okt.",
  "a list's date": "6. Okt., 10:05",
  "a list's date of another year": "6. Okt. 2026",
  "month and year": "Okt. 2026",
  "a weekday in another zone": "Di., 6. Okt. 2026, 05:05 EDT",
  "several zones": "06. Okt. 2026, 09:05 UTC | 06. Okt. 2026, 14:35 IST",
  "a status page report's month": "Oktober 2026",
  "hours and minutes": "2 Stunden, 5 Minuten",
  "days, hours, minutes and seconds":
    "2 Tage, 3 Stunden, 4 Minuten und 5 Sekunden",
  "days, hours and minutes": "2 Tage, 3 Stunden und 0 Minuten",
  "a friendly time": "1 J, 1 Mon., 4 Tg., 3 Std., 5 Min. und 6 Sek.",
  "a span's duration": "1,72 s",
};

const JAPANESE: Record<string, string> = {
  "local date and time": "2026年10月06日 10:05 BST",
  "local date": "2026年10月06日",
  "local 12-hour time with seconds": "2026年10月06日 午前10:05:07 BST",
  "date in the runtime's zone": "2026年10月06日 09:05 GMT",
  "short date and time": "10月6日 10:05",
  "day and month": "10月6日",
  "a list's date": "10月6日 10:05",
  "a list's date of another year": "2026年10月6日",
  "month and year": "2026年10月",
  "a weekday in another zone": "2026年10月6日(火) 05:05 EDT",
  "several zones": "2026年10月06日 09:05 UTC | 2026年10月06日 14:35 IST",
  "a status page report's month": "2026年10月",
  "a span's duration": "1.72 s",
};

describe("English, as it always read", () => {
  test.each(
    READINGS.map((reading: Reading): [string, Reading] => {
      return [reading.name, reading];
    }),
  )("%s", (name: string, reading: Reading) => {
    expect(reading.read()).toBe(ENGLISH[name]);
    // English is never remembered: there is nothing to put back.
    expect(getEnglishOf(reading.read())).toBeUndefined();
  });

  test("en-GB and en-US read the same English", () => {
    for (const language of ["en-GB", "en-US"]) {
      setDateDisplayLanguage(language);

      for (const reading of READINGS) {
        expect(reading.read()).toBe(ENGLISH[reading.name]);
      }
    }
  });
});

describe("German", () => {
  test.each(
    READINGS.map((reading: Reading): [string, Reading] => {
      return [reading.name, reading];
    }),
  )("%s", (name: string, reading: Reading) => {
    setDateDisplayLanguage("de");

    const text: string = reading.read();

    expect(spaced(text)).toBe(GERMAN[name]);
    // Remembered with the English a sentence still in English reads.
    if (name !== "several zones") {
      expect(getEnglishOf(text)).toBe(ENGLISH[name]);
    }
  });

  test("each zone of several is remembered with its own English", () => {
    setDateDisplayLanguage("de");

    const zones: Array<string> =
      OneUptimeDate.getDateAsFormattedArrayInMultipleTimezones({
        date: INSTANT,
        timezones: [Timezone.UTC, Timezone.AsiaKolkata],
        use12HourFormat: false,
      });

    expect(zones.map(getEnglishOf)).toEqual([
      "Oct 06 2026, 09:05 UTC",
      "Oct 06 2026, 14:35 IST",
    ]);
  });

  test("a shape with no words reads the same, and is not remembered", () => {
    setDateDisplayLanguage("de");

    const year: string = OneUptimeDate.getDateAsCustomFormattedStringInTimezone(
      {
        date: INSTANT,
        format: "YYYY",
        timezone: Timezone.EuropeLondon,
      },
    );

    expect(year).toBe("2026");
    expect(getEnglishOf(year)).toBeUndefined();
    // A shape the table does not list is moment's English.
    expect(
      OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
        date: INSTANT,
        format: "dddd [the] Do",
        timezone: Timezone.EuropeLondon,
      }),
    ).toBe("Tuesday the 6th");
  });
});

describe("Japanese, Persian and the other languages", () => {
  test.each(
    READINGS.filter((reading: Reading) => {
      return JAPANESE[reading.name] !== undefined;
    }).map((reading: Reading): [string, Reading] => {
      return [reading.name, reading];
    }),
  )("Japanese: %s", (name: string, reading: Reading) => {
    setDateDisplayLanguage("ja");

    expect(spaced(reading.read())).toBe(JAPANESE[name]);
  });

  test("Persian writes the Gregorian calendar in its own digits, as its counts", () => {
    setDateDisplayLanguage("fa");

    const text: string = OneUptimeDate.getDateAsLocalFormattedString(INSTANT);

    expect(text).toContain("اکتبر");
    expect(text).toContain("۲۰۲۶");
    expect(text).toContain("۱۰:۰۵");
    expect(text).toContain("BST");
    // Persian digits only: no Latin ones beside them.
    expect(NON_LATIN_DIGITS.test(text)).toBe(true);
    expect(text).not.toMatch(/[0-9]/);
  });

  test.each([
    ["fr", "06 oct. 2026, 10:05 BST"],
    ["es", "06 oct 2026, 10:05 BST"],
    ["ru", "06 окт. 2026 г., 10:05 BST"],
    ["zh-CN", "2026年10月06日 10:05 BST"],
    ["ko", "2026년 10월 06일 10:05 BST"],
    ["hi", "06 अक्टू॰ 2026, 10:05 BST"],
  ])("%s: %s", (language: string, text: string) => {
    setDateDisplayLanguage(language);

    expect(spaced(OneUptimeDate.getDateAsLocalFormattedString(INSTANT))).toBe(
      text,
    );
  });

  test("a language Intl does not know reads English", () => {
    setDateDisplayLanguage("xx-notalanguage");

    expect(OneUptimeDate.getDateAsLocalFormattedString(INSTANT)).toBe(
      ENGLISH["local date and time"],
    );
  });
});

/*
 * The times moment writes itself - a chart's axis, "Refreshed at", a
 * shift's hand-off - are in the reader's digits too, so a Persian page
 * never puts "21:16" beside "۲۶ اکتبر".
 */
describe("times in the reader's digits", () => {
  const TIMES: Array<Reading> = [
    {
      name: "time",
      read: (): string => {
        return OneUptimeDate.getLocalTimeString(INSTANT);
      },
    },
    {
      name: "time with seconds, 12-hour",
      read: (): string => {
        return OneUptimeDate.getLocalTimeString(INSTANT, {
          includeSeconds: true,
          use12HourFormat: true,
        });
      },
    },
    {
      name: "day, month and hour",
      read: (): string => {
        return OneUptimeDate.getDateAsLocalDayMonthHourString(INSTANT);
      },
    },
    {
      name: "day, month and time",
      read: (): string => {
        return OneUptimeDate.getDateAsLocalDayMonthTimeString(INSTANT);
      },
    },
    {
      name: "hour and minute in a zone",
      read: (): string => {
        return OneUptimeDate.getHourAndMinuteInTimezoneString(
          INSTANT,
          "Asia/Tehran",
        );
      },
    },
    {
      // The time an incident's Declared tile writes beside its date.
      name: "a 24-hour time of day written to a pattern",
      read: (): string => {
        return OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
          date: INSTANT,
          format: "HH:mm",
        });
      },
    },
  ];

  test.each(
    TIMES.map((reading: Reading): [string, Reading] => {
      return [reading.name, reading];
    }),
  )(
    "Persian: %s, in Persian digits alone",
    (_name: string, reading: Reading) => {
      setDateDisplayLanguage("fa");

      const text: string = reading.read();

      expect(NON_LATIN_DIGITS.test(text)).toBe(true);
      expect(text).not.toMatch(/[0-9]/);
    },
  );

  test("Persian writes the time of day as English does, in its own digits", () => {
    setDateDisplayLanguage("fa");

    const time: string = OneUptimeDate.getLocalTimeString(INSTANT);

    expect(time).toBe("۱۰:۰۵");
    expect(
      OneUptimeDate.getHourAndMinuteInTimezoneString(INSTANT, "Asia/Tehran"),
    ).toContain("۱۲:۳۵");
    expect(
      OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
        date: INSTANT,
        format: "HH:mm",
      }),
    ).toBe("۱۰:۰۵");

    // Remembered with its English, which a sentence in English puts back.
    expect(getEnglishOf(time)).toBe("10:05");
  });

  test.each(["en", "de", "ja"])(
    "%s keeps Latin digits, as written",
    (language: string) => {
      setDateDisplayLanguage(language);

      expect(OneUptimeDate.getLocalTimeString(INSTANT)).toBe("10:05");
      expect(
        OneUptimeDate.getHourAndMinuteInTimezoneString(INSTANT, "Asia/Tehran"),
      ).toContain("12:35");
      expect(
        OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
          date: INSTANT,
          format: "HH:mm",
        }),
      ).toBe("10:05");
    },
  );

  test("nothing set: English, as it always read", () => {
    expect(OneUptimeDate.getLocalTimeString(INSTANT)).toBe("10:05");
    expect(
      OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
        date: INSTANT,
        format: "HH:mm",
      }),
    ).toBe("10:05");
  });
});

/*
 * A time of day to the millisecond ("HH:mm:ss.SSS"), the Clock time of an
 * exception's breadcrumbs, was moment's in every language: "10:05:07.120"
 * in Latin digits on a Persian page, beside "۱۰:۰۵" (#7856). It is now
 * written in the digits "HH:mm" is written in - Persian's own, Latin ones
 * in Arabic - and only its digits change: its marks are ":" and "." in
 * every language, where Intl writes "10:05:07,120" in German and
 * "10.05.07,120" in Danish.
 */
describe("a time of day to the millisecond", () => {
  // 10:05:07.120 in London.
  const MOMENT: Date = new Date("2026-10-06T09:05:07.120Z");

  // A digit of any script, and anything else.
  const DIGIT: RegExp = /\p{Nd}/gu;
  const NOT_A_DIGIT: RegExp = /\P{Nd}/gu;

  const clockTime: () => string = (): string => {
    return OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
      date: MOMENT,
      format: "HH:mm:ss.SSS",
    });
  };

  const hourAndMinute: () => string = (): string => {
    return OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
      date: MOMENT,
      format: "HH:mm",
    });
  };

  test("nothing set, or English: as it always read", () => {
    expect(clockTime()).toBe("10:05:07.120");

    setDateDisplayLanguage("en");

    expect(clockTime()).toBe("10:05:07.120");
    expect(getEnglishOf(clockTime())).toBeUndefined();
  });

  test("Persian: in Persian digits, as its hour and minute are, and remembered with its English", () => {
    setDateDisplayLanguage("fa");

    const time: string = clockTime();

    expect(hourAndMinute()).toBe("۱۰:۰۵");
    expect(time).toBe("۱۰:۰۵:۰۷.۱۲۰");
    expect(time).not.toMatch(/[0-9]/);
    // A sentence in English puts the English back.
    expect(getEnglishOf(time)).toBe("10:05:07.120");
  });

  test("Arabic: in Latin digits, as its hour and minute are", () => {
    setDateDisplayLanguage("ar");

    expect(hourAndMinute()).toBe("10:05");
    expect(clockTime()).toBe("10:05:07.120");
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s: in the digits its hour and minute are written in, with English's marks",
    (language: string) => {
      setDateDisplayLanguage(language);

      const time: string = clockTime();
      const hourAndMinuteDigits: string = hourAndMinute().replace(
        NOT_A_DIGIT,
        "",
      );

      expect(time.replace(DIGIT, "0")).toBe("00:00:00.000");
      expect(
        time.replace(NOT_A_DIGIT, "").slice(0, hourAndMinuteDigits.length),
      ).toBe(hourAndMinuteDigits);
    },
  );
});

/*
 * A 12-hour clock's half of the day was moment's English "AM" and "PM" in
 * every language: the one English word in an Arabic monitor's "Refreshed
 * at" and under a histogram's bars. It is the reader's word now, as Intl
 * writes it, and the English "AM" is remembered for a sentence in English.
 */
describe("a 12-hour time's half of the day", () => {
  test.each([
    ["ar", "10:05 ص", "10:05:07 ص"],
    ["ja", "午前10:05", "午前10:05:07"],
    ["fa", "۱۰:۰۵ ق.ظ.", "۱۰:۰۵:۰۷ ق.ظ."],
  ])(
    "is %s's own word",
    (language: string, time: string, withSeconds: string) => {
      setDateDisplayLanguage(language);

      const written: string = OneUptimeDate.getLocalTimeString(INSTANT, {
        use12HourFormat: true,
      });

      expect(spaced(written)).toBe(time);
      expect(
        spaced(
          OneUptimeDate.getLocalTimeString(INSTANT, {
            includeSeconds: true,
            use12HourFormat: true,
          }),
        ),
      ).toBe(withSeconds);
      expect(getEnglishOf(written)).toBe("10:05 AM");
    },
  );

  test("an afternoon in Arabic is م, and the 24-hour clock is as it was", () => {
    setDateDisplayLanguage("ar");

    const afternoon: Date = new Date("2026-10-06T13:30:00Z");

    expect(
      spaced(
        OneUptimeDate.getLocalTimeString(afternoon, { use12HourFormat: true }),
      ),
    ).toBe("2:30 م");
    expect(OneUptimeDate.getLocalTimeString(afternoon)).toBe("14:30");
  });

  test("English keeps moment's AM and PM, word for word", () => {
    expect(
      OneUptimeDate.getLocalTimeString(INSTANT, { use12HourFormat: true }),
    ).toBe("10:05 AM");
    expect(
      OneUptimeDate.getLocalTimeString(INSTANT, {
        includeMinutes: false,
        use12HourFormat: true,
      }),
    ).toBe("10 AM");
  });
});

describe("how long ago", () => {
  test.each([
    ["en", -5 * 3600000, "5 hours ago"],
    ["en", -10000, "a few seconds ago"],
    ["de", -5 * 3600000, "vor 5 Stunden"],
    ["de", 3 * 86400000 + 1000, "in 3 Tagen"],
    ["de", -10000, "jetzt"],
    ["ja", -5 * 3600000, "5 時間前"],
    ["fr", -60000, "il y a 1 minute"],
  ])(
    "in %s, %i ms from now reads %s",
    (language: string, offset: number, text: string) => {
      setDateDisplayLanguage(language);

      expect(spaced(OneUptimeDate.fromNow(new Date(Date.now() + offset)))).toBe(
        text,
      );
    },
  );

  test("German is remembered with moment's English", () => {
    setDateDisplayLanguage("de");

    const text: string = OneUptimeDate.fromNow(
      new Date(Date.now() - 5 * 3600000),
    );

    expect(getEnglishOf(text)).toBe("5 hours ago");
  });
});

describe("a sentence's language", () => {
  test("holds a date in English while the reader's language is German", () => {
    setDateDisplayLanguage("de");

    expect(
      withDateDisplayLanguage("en", (): string => {
        return OneUptimeDate.getDateAsLocalFormattedString(INSTANT);
      }),
    ).toBe(ENGLISH["local date and time"]);
    expect(spaced(OneUptimeDate.getDateAsLocalFormattedString(INSTANT))).toBe(
      GERMAN["local date and time"],
    );
  });
});

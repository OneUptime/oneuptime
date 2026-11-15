/** @timezone UTC */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import OneUptimeDate from "../../../Types/Date";
import {
  forgetRememberedDateTexts,
  setDateDisplayLanguage,
} from "../../../Types/DateLanguage";
import Timezone from "../../../Types/Timezone";
import {
  FeedClock,
  formatFeedFullTime,
  formatFeedTime,
} from "../../../UI/Components/Feed/FeedTime";
import {
  formatStatusTimelineEnd,
  formatStatusTimelineFullTime,
  formatStatusTimelineShortDateTime,
  formatStatusTimelineShortDateTimeWithSeconds,
  formatStatusTimelineTime,
  formatStatusTimelineTimeWithSeconds,
} from "../../../UI/Components/StatusTimeline/StatusTimelineTime";
import {
  formatShiftDateTime,
  formatShiftEnd,
  formatShiftFullDateTime,
  formatShiftTime,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/UpcomingShiftTime";
import { formatRunTime } from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/Triggers/RunbookTriggersCopy";
import { formatToolImportDateTime } from "../../../../App/FeatureSet/Dashboard/src/Components/ToolImport/ToolImportText";
import { formatInvestigationCheckedAt } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationNotStarted";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * ONE WAY TO WRITE A TIME, ON A 12-HOUR CLOCK AND ON A 24-HOUR ONE (#7649).
 *
 * On a 24-hour clock a table, its tooltips and the time range button wrote
 * a morning time "05:14", but the components that wrote their times on
 * their own asked Intl for a numeric hour, and Intl drops the zero in
 * German, French, Japanese, Russian, Persian, Danish and most others: an
 * incident's feed and its status timeline, the upcoming shifts card, a
 * runbook's next run, a tool import's times and the AI card's "checked at"
 * read "5:14" beside the table's "05:14". Each asks getHourOption for its
 * hour now (Common/Types/DateLanguage), or writes through OneUptimeDate as
 * the tables do, and its twin guard (TwentyFourHourClockLeadingZeroGuard)
 * keeps a component from asking for a numeric hour on its own again.
 *
 * Every writer is read in every Dashboard language and in English, on both
 * clocks, before noon and after it, and set beside the tables' own writer
 * (getDateAsLocalShortDateTimeString): their times of day are written the
 * same way. The reader's zone is UTC.
 */

// The issue's time: 5:14 in the morning, and the same in the afternoon.
const MORNING: Date = new Date("2026-11-05T05:14:00.000Z");
const AFTERNOON: Date = new Date("2026-11-05T17:14:00.000Z");

// The moment the page is read at: the same day, so nothing names a weekday.
const NOW: Date = new Date("2026-11-05T20:00:00.000Z");

// Each time of day a text holds: its hour and its minutes, as written.
const TIME_OF_DAY: RegExp = /(\d{1,2})[:.](\d{2})/g;
const DIGIT: RegExp = /\p{Nd}/gu;

// A space, a no-break space or a narrow one: the same to a reader.
const ANY_SPACE: RegExp = /\s/g;

const spaced: (text: string) => string = (text: string): string => {
  return text.replace(ANY_SPACE, " ");
};

// Persian's and Arabic's digits as Latin ones, so one pattern reads them all.
const inLatinDigits: (text: string) => string = (text: string): string => {
  return text.replace(DIGIT, (digit: string): string => {
    const code: number = digit.codePointAt(0) || 0;

    // EXTENDED ARABIC-INDIC DIGIT ZERO (Persian) to NINE.
    if (code >= 0x06f0 && code <= 0x06f9) {
      return String(code - 0x06f0);
    }

    // ARABIC-INDIC DIGIT ZERO to NINE.
    if (code >= 0x0660 && code <= 0x0669) {
      return String(code - 0x0660);
    }

    return digit;
  });
};

// The times of day a text holds, as written: ["05:14"] or ["5:14"].
const timesOf: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return Array.from(inLatinDigits(text).matchAll(TIME_OF_DAY)).map(
    (match: RegExpMatchArray): string => {
      return match[0];
    },
  );
};

// The hours of a text's times of day: ["05"] or ["5"].
const hoursOf: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return Array.from(inLatinDigits(text).matchAll(TIME_OF_DAY)).map(
    (match: RegExpMatchArray): string => {
      return match[1] || "";
    },
  );
};

const feedClock: (language: string, use12HourClock: boolean) => FeedClock = (
  language: string,
  use12HourClock: boolean,
): FeedClock => {
  return {
    timezone: "UTC",
    language: language,
    use12HourClock: use12HourClock,
    now: NOW,
  };
};

interface Writer {
  name: string;
  write: (date: Date, language: string, use12HourClock: boolean) => string;
}

// The tables' writer: what every other time on the page is set beside.
const writeAsTheTablesDo: (
  date: Date,
  language: string,
  use12HourClock: boolean,
) => string = (
  date: Date,
  language: string,
  use12HourClock: boolean,
): string => {
  setDateDisplayLanguage(language);

  return OneUptimeDate.getDateAsLocalShortDateTimeString(date, {
    use12HourFormat: use12HourClock,
  });
};

// A writer that reads the reader's clock from their profile (OneUptimeDate).
const onTheReadersClock: (
  use12HourClock: boolean,
  write: () => string,
) => string = (use12HourClock: boolean, write: () => string): string => {
  const prefers: jest.SpiedFunction<() => boolean> = jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(use12HourClock);

  try {
    return write();
  } finally {
    prefers.mockRestore();
  }
};

const WRITERS: Array<Writer> = [
  {
    // An incident's, an alert's or a monitor's feed: an entry's time.
    name: "formatFeedTime",
    write: (date: Date, language: string, use12HourClock: boolean): string => {
      return formatFeedTime(date, feedClock(language, use12HourClock));
    },
  },
  {
    // A feed entry's tooltip and <time> element.
    name: "formatFeedFullTime",
    write: (date: Date, language: string, use12HourClock: boolean): string => {
      return formatFeedFullTime(date, feedClock(language, use12HourClock));
    },
  },
  {
    name: "formatStatusTimelineTime",
    write: (date: Date, language: string, use12HourClock: boolean): string => {
      return formatStatusTimelineTime(
        date,
        feedClock(language, use12HourClock),
      );
    },
  },
  {
    name: "formatStatusTimelineTimeWithSeconds",
    write: (date: Date, language: string, use12HourClock: boolean): string => {
      return formatStatusTimelineTimeWithSeconds(
        date,
        feedClock(language, use12HourClock),
      );
    },
  },
  {
    name: "formatStatusTimelineShortDateTime",
    write: (date: Date, language: string, use12HourClock: boolean): string => {
      return formatStatusTimelineShortDateTime(
        date,
        feedClock(language, use12HourClock),
      );
    },
  },
  {
    name: "formatStatusTimelineShortDateTimeWithSeconds",
    write: (date: Date, language: string, use12HourClock: boolean): string => {
      return formatStatusTimelineShortDateTimeWithSeconds(
        date,
        feedClock(language, use12HourClock),
      );
    },
  },
  {
    name: "formatStatusTimelineFullTime",
    write: (date: Date, language: string, use12HourClock: boolean): string => {
      return formatStatusTimelineFullTime(
        date,
        feedClock(language, use12HourClock),
      );
    },
  },
  {
    // An entry that ended on another day than it began.
    name: "formatStatusTimelineEnd",
    write: (date: Date, language: string, use12HourClock: boolean): string => {
      return formatStatusTimelineEnd({
        startsAt: new Date(date.getTime() - 3 * 24 * 60 * 60 * 1000),
        endsAt: date,
        clock: feedClock(language, use12HourClock),
      });
    },
  },
  {
    // The upcoming shifts card: a row's start.
    name: "formatShiftTime",
    write: (date: Date, language: string, use12HourClock: boolean): string => {
      return formatShiftTime(date, feedClock(language, use12HourClock));
    },
  },
  {
    name: "formatShiftDateTime",
    write: (date: Date, language: string, use12HourClock: boolean): string => {
      return formatShiftDateTime(date, feedClock(language, use12HourClock));
    },
  },
  {
    name: "formatShiftFullDateTime",
    write: (date: Date, language: string, use12HourClock: boolean): string => {
      return formatShiftFullDateTime(date, feedClock(language, use12HourClock));
    },
  },
  {
    // A span that ends on a later day than it starts.
    name: "formatShiftEnd",
    write: (date: Date, language: string, use12HourClock: boolean): string => {
      return formatShiftEnd({
        start: new Date(date.getTime() - 2 * 24 * 60 * 60 * 1000),
        end: date,
        clock: feedClock(language, use12HourClock),
      });
    },
  },
  {
    // A runbook's next and last scheduled run.
    name: "formatRunTime",
    write: (date: Date, language: string, use12HourClock: boolean): string => {
      return formatRunTime({
        date: date,
        timezone: "UTC",
        language: language,
        now: NOW,
        use12HourClock: use12HourClock,
      }).when;
    },
  },
  {
    // When a tool import read the tool, and when a run finished.
    name: "formatToolImportDateTime",
    write: (date: Date, language: string, use12HourClock: boolean): string => {
      return onTheReadersClock(use12HourClock, (): string => {
        return formatToolImportDateTime(date.toISOString(), language);
      });
    },
  },
  {
    // The AI card: when it was decided not to investigate.
    name: "formatInvestigationCheckedAt",
    write: (date: Date, language: string, use12HourClock: boolean): string => {
      setDateDisplayLanguage(language);

      return onTheReadersClock(use12HourClock, (): string => {
        return formatInvestigationCheckedAt(date.toISOString()) || "";
      });
    },
  },
];

const LANGUAGES: Array<string> = ["en", ...DASHBOARD_LANGUAGES];

beforeEach(() => {
  OneUptimeDate.setUserTimezone(Timezone.UTC);
});

afterEach(() => {
  OneUptimeDate.setUserTimezone(null);
  setDateDisplayLanguage(null);
  forgetRememberedDateTexts();
  jest.restoreAllMocks();
});

describe.each(
  LANGUAGES.map((code: string): [string] => {
    return [code];
  }),
)("in %s", (language: string) => {
  test.each(
    WRITERS.map((writer: Writer): [string, Writer] => {
      return [writer.name, writer];
    }),
  )(
    "%s: the zero on a 24-hour clock, none on a 12-hour one, as the tables write it",
    (_name: string, writer: Writer) => {
      const read: (date: Date, use12HourClock: boolean) => string = (
        date: Date,
        use12HourClock: boolean,
      ): string => {
        return writer.write(date, language, use12HourClock);
      };

      const morning24: string = read(MORNING, false);
      const afternoon24: string = read(AFTERNOON, false);
      const morning12: string = read(MORNING, true);
      const afternoon12: string = read(AFTERNOON, true);

      // A 24-hour time keeps its zero: "05:14", "17:14".
      expect({ morning24, hours: hoursOf(morning24) }).toEqual({
        morning24,
        hours: ["05"],
      });
      expect({ afternoon24, hours: hoursOf(afternoon24) }).toEqual({
        afternoon24,
        hours: ["17"],
      });

      // A 12-hour one has none, either side of noon: "5:14 AM", "5:14 PM".
      expect({ morning12, hours: hoursOf(morning12) }).toEqual({
        morning12,
        hours: ["5"],
      });
      expect({ afternoon12, hours: hoursOf(afternoon12) }).toEqual({
        afternoon12,
        hours: ["5"],
      });

      // Its day period tells the two apart.
      expect(morning12).not.toBe(afternoon12);

      // The same time of day the tables write, on each clock.
      for (const [date, use12HourClock, written] of [
        [MORNING, false, morning24],
        [AFTERNOON, false, afternoon24],
        [MORNING, true, morning12],
        [AFTERNOON, true, afternoon12],
      ] as Array<[Date, boolean, string]>) {
        expect({ written, times: timesOf(written) }).toEqual({
          written,
          times: timesOf(writeAsTheTablesDo(date, language, use12HourClock)),
        });
      }
    },
  );
});

/*
 * The brief's languages on their own clocks, word for word: US English,
 * Korean and Arabic read a 12-hour clock, German, French and Russian a
 * 24-hour one.
 */
describe("each language on its own clock, word for word", () => {
  const shapes: Record<string, (date: Date, clock: FeedClock) => string> = {
    formatFeedTime: formatFeedTime,
    formatStatusTimelineShortDateTime: formatStatusTimelineShortDateTime,
    formatShiftDateTime: formatShiftDateTime,
  };

  test.each<[string, string, boolean, Record<string, [string, string]>]>([
    [
      "en",
      "US English",
      true,
      {
        formatFeedTime: ["5:14 AM", "5:14 PM"],
        formatStatusTimelineShortDateTime: ["Nov 5, 5:14 AM", "Nov 5, 5:14 PM"],
        formatShiftDateTime: ["Thu, Nov 5, 5:14 AM", "Thu, Nov 5, 5:14 PM"],
      },
    ],
    [
      "ko",
      "Korean",
      true,
      {
        formatFeedTime: ["오전 5:14", "오후 5:14"],
        formatStatusTimelineShortDateTime: [
          "11월 5일 오전 5:14",
          "11월 5일 오후 5:14",
        ],
        formatShiftDateTime: [
          "11월 5일 (목) 오전 5:14",
          "11월 5일 (목) 오후 5:14",
        ],
      },
    ],
    [
      "ar",
      "Arabic",
      true,
      {
        formatFeedTime: ["5:14 ص", "5:14 م"],
        formatStatusTimelineShortDateTime: [
          "5 نوفمبر، 5:14 ص",
          "5 نوفمبر، 5:14 م",
        ],
        formatShiftDateTime: [
          "الخميس، 5 نوفمبر، 5:14 ص",
          "الخميس، 5 نوفمبر، 5:14 م",
        ],
      },
    ],
    [
      "de",
      "German",
      false,
      {
        formatFeedTime: ["05:14", "17:14"],
        formatStatusTimelineShortDateTime: ["5. Nov., 05:14", "5. Nov., 17:14"],
        formatShiftDateTime: ["Do., 5. Nov., 05:14", "Do., 5. Nov., 17:14"],
      },
    ],
    [
      "fr",
      "French",
      false,
      {
        formatFeedTime: ["05:14", "17:14"],
        formatStatusTimelineShortDateTime: ["5 nov., 05:14", "5 nov., 17:14"],
        formatShiftDateTime: ["jeu. 5 nov., 05:14", "jeu. 5 nov., 17:14"],
      },
    ],
    [
      "ru",
      "Russian",
      false,
      {
        formatFeedTime: ["05:14", "17:14"],
        formatStatusTimelineShortDateTime: ["5 нояб., 05:14", "5 нояб., 17:14"],
        formatShiftDateTime: ["чт, 5 нояб., 05:14", "чт, 5 нояб., 17:14"],
      },
    ],
  ])(
    "%s (%s)",
    (
      language: string,
      _name: string,
      use12HourClock: boolean,
      expected: Record<string, [string, string]>,
    ) => {
      const written: Record<string, [string, string]> = {};

      for (const [name, write] of Object.entries(shapes)) {
        written[name] = [
          spaced(write(MORNING, feedClock(language, use12HourClock))),
          spaced(write(AFTERNOON, feedClock(language, use12HourClock))),
        ];
      }

      expect(written).toEqual(expected);
    },
  );

  test("the zero the issue's languages dropped is back: German, French, Japanese, Persian, Danish, Spanish, Russian", () => {
    const morning: Record<string, string> = {};

    for (const language of ["de", "fr", "ja", "fa", "da", "es", "ru"]) {
      morning[language] = formatFeedTime(MORNING, feedClock(language, false));
    }

    expect(morning).toEqual({
      de: "05:14",
      fr: "05:14",
      ja: "05:14",
      fa: "۰۵:۱۴",
      da: "05.14",
      es: "05:14",
      ru: "05:14",
    });
  });
});

describe("a feed's time when Intl cannot write the zone", () => {
  /*
   * FeedTime falls back to moment's English where Intl cannot work in the
   * reader's zone. Its "HH:mm" always kept the zero, so a feed disagreed
   * with itself: "05:14" from moment, "5:14" from Intl in German. The two
   * write a time of day the same way now, in every language.
   */
  const viaMoment: (date: Date, clock: FeedClock) => string = (
    date: Date,
    clock: FeedClock,
  ): string => {
    let written: string = "";

    jest.isolateModules(() => {
      // A fresh FeedTime, whose formatters are not built yet.
      const isolated: { formatFeedTime: typeof formatFeedTime } =
        jest.requireActual("../../../UI/Components/Feed/FeedTime");
      const RealDateTimeFormat: typeof Intl.DateTimeFormat =
        Intl.DateTimeFormat;

      const refusing: jest.SpiedFunction<typeof Intl.DateTimeFormat> = jest
        .spyOn(Intl, "DateTimeFormat")
        .mockImplementation(
          (
            locales?: string | Array<string>,
            options?: Intl.DateTimeFormatOptions,
          ): Intl.DateTimeFormat => {
            if (options?.timeZone) {
              throw new RangeError("Invalid time zone specified");
            }

            return new RealDateTimeFormat(locales, options);
          },
        );

      try {
        written = isolated.formatFeedTime(date, clock);
      } finally {
        refusing.mockRestore();
      }
    });

    return spaced(written);
  };

  test("moment writes the English it always did", () => {
    expect(viaMoment(MORNING, feedClock("de", false))).toBe("05:14");
    expect(viaMoment(AFTERNOON, feedClock("de", false))).toBe("17:14");
    expect(viaMoment(MORNING, feedClock("de", true))).toBe("5:14 AM");
    expect(viaMoment(AFTERNOON, feedClock("de", true))).toBe("5:14 PM");
  });

  test.each<[string, boolean]>([
    ["en", false],
    ["en", true],
    ["de", false],
    ["de", true],
    ["fr", false],
    ["ja", false],
    ["ru", false],
    ["ko", true],
    ["ar", true],
  ])(
    "in %s, 12-hour %p: Intl and moment write one time of day",
    (language: string, use12HourClock: boolean) => {
      for (const date of [MORNING, AFTERNOON]) {
        const intl: string = spaced(
          formatFeedTime(date, feedClock(language, use12HourClock)),
        );
        const moment: string = viaMoment(
          date,
          feedClock(language, use12HourClock),
        );

        expect({ intl, times: timesOf(intl) }).toEqual({
          intl,
          times: timesOf(moment),
        });
      }
    },
  );
});

describe("the tool import and the AI card follow the reader's profile", () => {
  test("a tool import's time is in the reader's zone, not the browser's", () => {
    OneUptimeDate.setUserTimezone("Asia/Tokyo" as Timezone);

    expect(
      spaced(
        onTheReadersClock(false, (): string => {
          return formatToolImportDateTime("2026-11-05T05:14:00.000Z", "de");
        }),
      ),
    ).toBe("5. Nov. 2026, 14:14");
    expect(
      spaced(
        onTheReadersClock(true, (): string => {
          return formatToolImportDateTime("2026-11-05T05:14:00.000Z", "en");
        }),
      ),
    ).toBe("Nov 5, 2026, 2:14 PM");
  });

  test("a tool import's time is in the language it is asked for, whatever the page's", () => {
    setDateDisplayLanguage("fr");

    expect(
      spaced(
        onTheReadersClock(false, (): string => {
          return formatToolImportDateTime("2026-11-05T05:14:00.000Z", "de");
        }),
      ),
    ).toBe("5. Nov. 2026, 05:14");
    expect(
      spaced(
        onTheReadersClock(false, (): string => {
          return formatToolImportDateTime("2026-11-05T05:14:00.000Z", "");
        }),
      ),
    ).toBe("Nov 5, 2026, 05:14");
  });

  test("what the server did not send as a time is kept as sent", () => {
    expect(formatToolImportDateTime("soon", "de")).toBe("soon");
    expect(formatInvestigationCheckedAt("not a date")).toBeNull();
    expect(formatInvestigationCheckedAt("")).toBeNull();
  });

  test("the AI card's time is the reader's zone, clock and language", () => {
    OneUptimeDate.setUserTimezone("America/New_York" as Timezone);
    setDateDisplayLanguage("ko");

    expect(
      spaced(
        onTheReadersClock(true, (): string => {
          return formatInvestigationCheckedAt("2026-11-05T17:14:00.000Z") || "";
        }),
      ),
    ).toBe("2026년 11월 5일 오후 12:14");

    setDateDisplayLanguage("en");

    expect(
      spaced(
        onTheReadersClock(false, (): string => {
          return formatInvestigationCheckedAt("2026-11-05T10:14:00.000Z") || "";
        }),
      ),
    ).toBe("Nov 5, 2026, 05:14");
  });
});

describe("every writer is read", () => {
  test("the writers #7649 named, and the ones that wrote a time on their own", () => {
    expect(
      WRITERS.map((writer: Writer): string => {
        return writer.name;
      }),
    ).toEqual(
      expect.arrayContaining([
        "formatFeedTime",
        "formatFeedFullTime",
        "formatStatusTimelineTimeWithSeconds",
        "formatStatusTimelineShortDateTime",
        "formatStatusTimelineShortDateTimeWithSeconds",
        "formatShiftDateTime",
        "formatShiftFullDateTime",
        "formatRunTime",
        "formatToolImportDateTime",
        "formatInvestigationCheckedAt",
      ]),
    );
    expect(LANGUAGES).toEqual(
      expect.arrayContaining(["en", "ko", "ar", "de", "fr", "ru", "ja", "fa"]),
    );
  });

  test("the time-of-day reader tells a zero from none", () => {
    expect(hoursOf("05:14")).toEqual(["05"]);
    expect(hoursOf("5:14 AM")).toEqual(["5"]);
    expect(hoursOf("۰۵:۱۴")).toEqual(["05"]);
    expect(hoursOf("5.14")).toEqual(["5"]);
    expect(hoursOf("Thursday, November 5, 2026")).toEqual([]);
  });
});

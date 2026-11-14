/** @timezone UTC */
/**
 * The sentence the logs explorer shows when a search comes back empty repeats
 * the window that was searched, so the reader can tell "nothing matched" apart
 * from "you are looking at the wrong hour".
 *
 * It had the same defect as the picker button above it, in mirror image: the
 * window was formatted with a hardcoded `toLocaleString("en-US", ...)`, so it
 * always came out on a 12-hour clock even for a user whose machine is set to
 * 24-hour, and always in the browser's own zone rather than the one configured
 * in User Settings. The picker meanwhile always said 24-hour. One screen, one
 * window, two disagreeing renderings, neither of them the user's.
 *
 * And it was English on every page (issue #7280): built as one English
 * sentence with the dates inside it, it had no wording in any language, and
 * a preset was named by its English name in lower case. It is one sentence
 * with the window as its value now ("Time range: {{range}}. ..."), worded in
 * all 18 Dashboard languages, with the window written in the language the
 * sentence comes out in - a preset by the name the picker gives it, a custom
 * window in the reader's words and digits.
 */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Declared before jest.mock but dereferenced inside the factories: ts-jest
 * hoists the jest.mock calls above these initializers, so naming the mocks
 * directly in a factory would capture undefined.
 */
const getListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyErrorMessage: (error: Error) => {
        return error.message;
      },
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

getListMock.mockImplementation(() => {
  return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
});

postMock.mockImplementation(() => {
  return Promise.resolve({ data: {} });
});

// Imported after the mocks so the module picks the mocked API surfaces up.
import {
  getEmptyMessageWithTimeRange,
  LOGS_TIME_RANGE_EMPTY_HINT,
} from "../../../UI/Components/LogsViewer/LogsViewer";
import {
  LOGS_TABLE_EMPTY_HINT,
  LogsEmptyMessage,
  writeLogsEmptyMessage,
} from "../../../UI/Components/LogsViewer/components/LogsTable";
import {
  getTimeRangeButtonLabel,
  getTimeRangeLabel,
  TIME_RANGE_PRESET_OPTIONS,
  TimeRangePickerPresetOption,
} from "../../../UI/Components/Date/TimeRangePickerDropdown";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import {
  forgetRememberedDateTexts,
  setDateDisplayLanguage,
} from "../../../Types/DateLanguage";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import Timezone from "../../../Types/Timezone";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const AFTERNOON: InBetween<Date> = new InBetween<Date>(
  new Date("2024-03-01T14:30:00.000Z"),
  new Date("2024-03-01T18:45:00.000Z"),
);

const CUSTOM_AFTERNOON: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: AFTERNOON,
};

const NO_BREAK_SPACE: string = String.fromCharCode(0x00a0);

// Persian's half space, inside a word: "بزرگ" + it + "تر".
const ZERO_WIDTH_NON_JOINER: string = String.fromCharCode(0x200c);

// A space, a no-break space or a narrow one: the same to a reader.
const ANY_SPACE: RegExp = /\s/g;
const LATIN_DIGIT: RegExp = /[0-9]/;
const PERSIAN_DIGIT: RegExp = /[۰-۹]/;

function spaced(text: string): string {
  return text.replace(ANY_SPACE, " ");
}

// The sentence in English, as a reader sees it.
function english(message: LogsEmptyMessage): string {
  return spaced(writeLogsEmptyMessage(message));
}

// The sentence as `language`'s Dashboard draws it: its values set apart.
function drawnIn(language: string, message: LogsEmptyMessage): string {
  return writeLogsEmptyMessage(message, dashboardTranslator(language), {
    setsValuesApart: true,
  });
}

// What a reader of `language` reads: no isolate marks, any space a space.
function readIn(language: string, message: LogsEmptyMessage): string {
  return spaced(withoutIsolateMarks(drawnIn(language, message)));
}

// The custom window's two ends as the picker button writes them in `language`.
function buttonLabelIn(
  language: string,
  value: RangeStartAndEndDateTime,
  now?: Date,
): string {
  setDateDisplayLanguage(language);

  try {
    return spaced(getTimeRangeButtonLabel(value, now));
  } finally {
    setDateDisplayLanguage(null);
  }
}

function pin(use12HourFormat: boolean): void {
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(use12HourFormat);
}

afterEach(() => {
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
  setDateDisplayLanguage(null);
  forgetRememberedDateTexts();
});

/*
 * The window here is in 2024, and a window that is not all in the current
 * year names its years (issue #7124; "the years" below). The rest of these
 * are about the clock and the zone, so "now" is pinned into 2024, where the
 * window is written short.
 */
beforeEach(() => {
  jest
    .spyOn(OneUptimeDate, "getCurrentDate")
    .mockReturnValue(new Date("2024-06-15T12:00:00.000Z"));
});

describe("getEmptyMessageWithTimeRange", () => {
  describe("a custom window", () => {
    test("is written with AM/PM on a 12-hour machine", () => {
      pin(true);

      expect(english(getEmptyMessageWithTimeRange(CUSTOM_AFTERNOON))).toBe(
        "Time range: Mar 1, 2:30 PM – Mar 1, 6:45 PM. Try adjusting filters or expanding the time range.",
      );
    });

    test("is written on a 24-hour clock on a 24-hour machine", () => {
      pin(false);

      const message: string = english(
        getEmptyMessageWithTimeRange(CUSTOM_AFTERNOON),
      );

      expect(message).toBe(
        "Time range: Mar 1, 14:30 – Mar 1, 18:45. Try adjusting filters or expanding the time range.",
      );
      expect(message).not.toMatch(/AM|PM/);
    });

    test("no longer forces AM/PM on a 24-hour machine", () => {
      /*
       * The exact regression: `toLocaleString("en-US", ...)` pinned the locale,
       * so this sentence said "02:30 PM" to a reader whose whole machine - and
       * whose picker button - was on a 24-hour clock.
       */
      pin(false);

      expect(
        english(getEmptyMessageWithTimeRange(CUSTOM_AFTERNOON)),
      ).not.toContain("02:30 PM");
    });

    test("is read in the timezone configured in User Settings", () => {
      pin(true);
      OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);

      expect(english(getEmptyMessageWithTimeRange(CUSTOM_AFTERNOON))).toContain(
        "Mar 1, 8:00 PM – Mar 2, 12:15 AM",
      );
    });

    test("matches the label the picker button puts on the same window", () => {
      /*
       * The two sit on the same screen describing the same window, so they must
       * not disagree. Both now go through one formatter - this pins that they
       * still do.
       */
      pin(true);
      OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

      const start: string = OneUptimeDate.getDateAsLocalShortDateTimeString(
        AFTERNOON.startValue,
      );
      const end: string = OneUptimeDate.getDateAsLocalShortDateTimeString(
        AFTERNOON.endValue,
      );

      expect(english(getEmptyMessageWithTimeRange(CUSTOM_AFTERNOON))).toContain(
        `${start} – ${end}`,
      );
    });

    test("each end is kept on one line, with the one break after the dash", () => {
      /*
       * As the picker's list writes a window (renderTimeRangeDetail): on a
       * phone's narrow line a time or an "AM" was left alone on the next
       * one. The only breaking space inside the window is the one after the
       * dash; the rest are no-break spaces.
       */
      pin(true);

      const written: string = writeLogsEmptyMessage(
        getEmptyMessageWithTimeRange(CUSTOM_AFTERNOON),
      );

      const start: string = ["Mar", "1,", "2:30", "PM", "–"].join(
        NO_BREAK_SPACE,
      );
      const end: string = ["Mar", "1,", "6:45", "PM."].join(NO_BREAK_SPACE);

      expect(written).toContain(`Time range: ${start} ${end} Try adjusting`);
      // A negative control: spaces a reader cannot tell apart, all but one no-break.
      expect(spaced(written)).toContain("Mar 1, 2:30 PM – Mar 1, 6:45 PM.");
      expect(written).not.toContain("Mar 1, 2:30 PM – Mar 1, 6:45 PM.");
    });
  });

  describe("a preset window", () => {
    test("names the preset rather than any clock time", () => {
      pin(true);

      const message: string = english(
        getEmptyMessageWithTimeRange({ range: TimeRange.PAST_ONE_HOUR }),
      );

      expect(message).toBe(
        "Time range: past 1 hour. Try adjusting filters or expanding the time range.",
      );
      expect(message).not.toMatch(/\d{1,2}:\d{2}/);
    });

    test("by the name the picker gives it, as a sentence holds a name: past 30 minutes", () => {
      /*
       * It was the range's own value lowered ("past 30 mins") while the
       * picker above it said "Past 30 Minutes".
       */
      expect(
        english(
          getEmptyMessageWithTimeRange({ range: TimeRange.PAST_THIRTY_MINS }),
        ),
      ).toBe(
        "Time range: past 30 minutes. Try adjusting filters or expanding the time range.",
      );
    });

    test("reads the same on either clock", () => {
      pin(true);
      const on12Hour: string = english(
        getEmptyMessageWithTimeRange({ range: TimeRange.PAST_THIRTY_MINS }),
      );

      pin(false);
      const on24Hour: string = english(
        getEmptyMessageWithTimeRange({ range: TimeRange.PAST_THIRTY_MINS }),
      );

      expect(on12Hour).toBe(on24Hour);
    });
  });

  describe("no window at all", () => {
    test("falls back to a message with no range in it", () => {
      expect(getEmptyMessageWithTimeRange(undefined)).toBe(
        LOGS_TABLE_EMPTY_HINT,
      );
      expect(english(getEmptyMessageWithTimeRange(undefined))).toBe(
        "Adjust filters or check again later.",
      );
    });

    test("falls back when a custom range carries no dates", () => {
      /*
       * There is no window to name: "Time range: custom." said a word, not
       * a window, and Russian's word for the picker's Custom is "other".
       */
      const message: LogsEmptyMessage = getEmptyMessageWithTimeRange({
        range: TimeRange.CUSTOM,
      });

      expect(message).toBe(LOGS_TABLE_EMPTY_HINT);
      expect(english(message)).toBe("Adjust filters or check again later.");
      expect(readIn("ru", message)).not.toContain("другое");
      expect(readIn("ru", message)).toBe(
        readDashboardLocale("ru")[LOGS_TABLE_EMPTY_HINT],
      );
    });
  });

  /*
   * The same years as the picker button above it (issue #7124): a window
   * not all in this year names its years at both ends, and one in this year
   * does not.
   */
  describe("the years", () => {
    const NOW: Date = new Date("2026-11-12T10:00:00.000Z");

    test("a window of exactly a year names both years", () => {
      pin(true);

      expect(
        english(
          getEmptyMessageWithTimeRange(
            {
              range: TimeRange.CUSTOM,
              startAndEndDate: new InBetween<Date>(
                new Date("2025-11-12T09:49:00.000Z"),
                new Date("2026-11-12T09:49:00.000Z"),
              ),
            },
            NOW,
          ),
        ),
      ).toBe(
        "Time range: Nov 12, 2025, 9:49 AM – Nov 12, 2026, 9:49 AM. Try adjusting filters or expanding the time range.",
      );
    });

    test("a window in an earlier year names it at both ends", () => {
      pin(false);

      expect(english(getEmptyMessageWithTimeRange(CUSTOM_AFTERNOON, NOW))).toBe(
        "Time range: Mar 1, 2024, 14:30 – Mar 1, 2024, 18:45. Try adjusting filters or expanding the time range.",
      );
    });

    test("a window in this year names none, as before", () => {
      pin(false);

      expect(
        english(
          getEmptyMessageWithTimeRange(
            CUSTOM_AFTERNOON,
            new Date("2024-11-12T10:00:00.000Z"),
          ),
        ),
      ).toBe(
        "Time range: Mar 1, 14:30 – Mar 1, 18:45. Try adjusting filters or expanding the time range.",
      );
    });

    test("it says what the picker button says about the same window", () => {
      pin(true);

      const window: RangeStartAndEndDateTime = {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date("2025-12-20T09:00:00.000Z"),
          new Date("2026-01-05T17:00:00.000Z"),
        ),
      };

      expect(english(getEmptyMessageWithTimeRange(window, NOW))).toContain(
        spaced(getTimeRangeButtonLabel(window, NOW)),
      );
    });
  });
});

describe("the sentence in the reader's language (issue #7280)", () => {
  test("is one key with the window as its value, worded in every Dashboard language", () => {
    expect(LOGS_TIME_RANGE_EMPTY_HINT).toBe(
      "Time range: {{range}}. Try adjusting filters or expanding the time range.",
    );

    const message: LogsEmptyMessage =
      getEmptyMessageWithTimeRange(CUSTOM_AFTERNOON);

    expect(typeof message).toBe("object");
    expect((message as { template: string }).template).toBe(
      LOGS_TIME_RANGE_EMPTY_HINT,
    );

    for (const language of DASHBOARD_LANGUAGES) {
      const words: string | undefined =
        readDashboardLocale(language)[LOGS_TIME_RANGE_EMPTY_HINT];

      expect({
        language,
        worded: words !== LOGS_TIME_RANGE_EMPTY_HINT,
      }).toEqual({ language, worded: true });
      expect({ language, keepsRange: words?.includes("{{range}}") }).toEqual({
        language,
        keepsRange: true,
      });
    }
  });

  test("German, on a 24-hour clock: the sentence and the window in German", () => {
    pin(false);

    expect(readIn("de", getEmptyMessageWithTimeRange(CUSTOM_AFTERNOON))).toBe(
      "Zeitraum: 1. März, 14:30 – 1. März, 18:45. Passen Sie die Filter an oder erweitern Sie den Zeitraum.",
    );
  });

  test("German, on a 12-hour clock: no leading zero on the hour", () => {
    pin(true);

    expect(readIn("de", getEmptyMessageWithTimeRange(CUSTOM_AFTERNOON))).toBe(
      "Zeitraum: 1. März, 2:30 PM – 1. März, 6:45 PM. Passen Sie die Filter an oder erweitern Sie den Zeitraum.",
    );
  });

  test("German, a window across two years: both years, where German writes them", () => {
    pin(false);

    expect(
      readIn(
        "de",
        getEmptyMessageWithTimeRange(
          {
            range: TimeRange.CUSTOM,
            startAndEndDate: new InBetween<Date>(
              new Date("2025-11-12T09:49:00.000Z"),
              new Date("2026-11-12T09:49:00.000Z"),
            ),
          },
          new Date("2026-11-12T10:00:00.000Z"),
        ),
      ),
    ).toBe(
      "Zeitraum: 12. Nov. 2025, 09:49 – 12. Nov. 2026, 09:49. Passen Sie die Filter an oder erweitern Sie den Zeitraum.",
    );
  });

  test("Persian: the sentence in Persian, the window in Persian digits, and no Latin digit left", () => {
    pin(false);

    const read: string = readIn(
      "fa",
      getEmptyMessageWithTimeRange(CUSTOM_AFTERNOON),
    );

    expect(read).toBe(
      `${readDashboardLocale("fa")[LOGS_TIME_RANGE_EMPTY_HINT]!.replace(
        "{{range}}",
        buttonLabelIn("fa", CUSTOM_AFTERNOON),
      )}`,
    );
    expect(read).toContain("۱۴:۳۰");
    expect(read).toContain("۱۸:۴۵");
    expect(read).toMatch(PERSIAN_DIGIT);
    expect(read).not.toMatch(LATIN_DIGIT);
    expect(read.startsWith("بازهٔ زمانی: ")).toBe(true);
  });

  test("Persian: the window is set apart in the right-to-left sentence, start then end", () => {
    /*
     * A value with digits in a sentence read right to left is set apart in
     * an isolate (FSI ... PDI): the browser draws it as one piece where the
     * sentence puts it, its own first letter reading it right to left, so
     * the start is read first and the end after it.
     */
    pin(false);

    const drawn: string = drawnIn(
      "fa",
      getEmptyMessageWithTimeRange(CUSTOM_AFTERNOON),
    );
    const window: string = getTimeRangeWindowAsWritten("fa");

    expect(drawn).toContain(isolated(window));
    expect(withoutIsolateMarks(drawn).indexOf("۱۴:۳۰")).toBeLessThan(
      withoutIsolateMarks(drawn).indexOf("۱۸:۴۵"),
    );
  });

  test("Arabic, on a 12-hour clock: the sentence in Arabic, Latin digits, no leading zero, the window set apart", () => {
    pin(true);

    const drawn: string = drawnIn(
      "ar",
      getEmptyMessageWithTimeRange(CUSTOM_AFTERNOON),
    );

    expect(spaced(withoutIsolateMarks(drawn))).toBe(
      "النطاق الزمني: 1 مارس، 2:30 م – 1 مارس، 6:45 م. جرّب تعديل عوامل التصفية أو توسيع النطاق الزمني.",
    );
    expect(drawn).toContain(isolated(getTimeRangeWindowAsWritten("ar")));
    expect(drawn).not.toContain("02:30");
  });

  test("Japanese: the window as Japanese writes it", () => {
    pin(false);

    expect(readIn("ja", getEmptyMessageWithTimeRange(CUSTOM_AFTERNOON))).toBe(
      "時間範囲: 3月1日 14:30 – 3月1日 18:45。フィルターを調整するか、時間範囲を広げてみてください。",
    );
  });

  /*
   * On a 12-hour clock Spanish writes a morning "a. m.", Dutch and Norwegian
   * "a.m.", Persian "ق.ظ.": the window's last time ends in its
   * abbreviation's full stop, and the sentence ends there with it, as a
   * sentence ending in an abbreviation does. With the sentence's own full
   * stop after it, the line read "9:49 a. m.. Prueba ..." and "ق.ظ..".
   */
  describe("a window that ends in an abbreviation's full stop", () => {
    const MORNING: RangeStartAndEndDateTime = {
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(
        new Date("2024-03-01T05:14:00.000Z"),
        new Date("2024-03-01T09:49:00.000Z"),
      ),
    };

    const DOUBLE_FULL_STOP: RegExp = /\.\s*\./;

    test("Spanish, on a 12-hour clock: one full stop after a. m., then the next sentence", () => {
      pin(true);

      expect(readIn("es", getEmptyMessageWithTimeRange(MORNING))).toBe(
        "Intervalo de tiempo: 1 mar, 5:14 a. m. – 1 mar, 9:49 a. m. Prueba a ajustar los filtros o a ampliar el intervalo de tiempo.",
      );
    });

    test("Dutch and Norwegian, on a 12-hour clock: one full stop after a.m.", () => {
      pin(true);

      expect(readIn("nl", getEmptyMessageWithTimeRange(MORNING))).toBe(
        "Periode: 1 mrt, 5:14 a.m. – 1 mrt, 9:49 a.m. Pas de filters aan of kies een ruimere periode.",
      );
      expect(readIn("no", getEmptyMessageWithTimeRange(MORNING))).toBe(
        "Tidsrom: 1. mars, 5:14 a.m. – 1. mars, 9:49 a.m. Prøv å justere filtrene eller utvide tidsrommet.",
      );
    });

    test("Persian, on a 12-hour clock: ق.ظ. ends the sentence once, outside the window set apart", () => {
      pin(true);

      const drawn: string = drawnIn(
        "fa",
        getEmptyMessageWithTimeRange(MORNING),
      );
      const read: string = spaced(withoutIsolateMarks(drawn));

      expect(read).toBe(
        `بازهٔ زمانی: ۱ مارس، ۵:۱۴ ق.ظ. – ۱ مارس، ۹:۴۹ ق.ظ. فیلترها را تغییر دهید یا بازهٔ زمانی را بزرگ${ZERO_WIDTH_NON_JOINER}تر کنید.`,
      );
      expect(read).not.toMatch(DOUBLE_FULL_STOP);
      // The window keeps its own letters; the sentence's full stop follows it.
      expect(withoutIsolateMarks(drawn)).toContain(
        `۹:۴۹${NO_BREAK_SPACE}ق.ظ. فیلترها`,
      );
    });

    test("the window keeps its full stop where the sentence puts none after it", () => {
      pin(true);

      // A sentence that goes on after the window: the window as written.
      const goesOn: Translator = createTranslator((text: string) => {
        return text === LOGS_TIME_RANGE_EMPTY_HINT
          ? "Intervalo de tiempo: {{range}} (prueba a ampliarlo)"
          : undefined;
      }, "es");

      expect(
        spaced(
          writeLogsEmptyMessage(getEmptyMessageWithTimeRange(MORNING), goesOn),
        ),
      ).toBe(
        "Intervalo de tiempo: 1 mar, 5:14 a. m. – 1 mar, 9:49 a. m. (prueba a ampliarlo)",
      );
    });

    test("no Dashboard language reads two full stops after the window, on either clock", () => {
      for (const use12HourFormat of [true, false]) {
        pin(use12HourFormat);

        for (const language of DASHBOARD_LANGUAGES) {
          const read: string = readIn(
            language,
            getEmptyMessageWithTimeRange(MORNING),
          );

          expect({
            language,
            use12HourFormat,
            twoFullStops: DOUBLE_FULL_STOP.test(read),
          }).toEqual({ language, use12HourFormat, twoFullStops: false });
        }
      }
    });
  });

  test("a preset is named in the reader's language: German, Persian, Arabic", () => {
    const hour: LogsEmptyMessage = getEmptyMessageWithTimeRange({
      range: TimeRange.PAST_ONE_HOUR,
    });

    expect(readIn("de", hour)).toBe(
      "Zeitraum: Letzte Stunde. Passen Sie die Filter an oder erweitern Sie den Zeitraum.",
    );
    expect(readIn("fa", hour)).toBe(
      `بازهٔ زمانی: ۱ ساعت گذشته. فیلترها را تغییر دهید یا بازهٔ زمانی را بزرگ${ZERO_WIDTH_NON_JOINER}تر کنید.`,
    );
    expect(readIn("ar", hour)).toBe(
      "النطاق الزمني: آخر ساعة. جرّب تعديل عوامل التصفية أو توسيع النطاق الزمني.",
    );
  });

  test("every preset, in every Dashboard language, is named by the word the picker shows, in a worded sentence", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const translator: Translator = dashboardTranslator(language);

      for (const option of TIME_RANGE_PRESET_OPTIONS) {
        const read: string = readIn(
          language,
          getEmptyMessageWithTimeRange({ range: option.range }),
        );
        const name: string = translator.translateTerm(option.label, {
          inSentence: true,
        });

        expect({
          language,
          preset: option.label,
          named: read.includes(name),
        }).toEqual({ language, preset: option.label, named: true });
        // The sentence's own words, not English's.
        expect({
          language,
          preset: option.label,
          english: read.includes("Try adjusting filters"),
        }).toEqual({ language, preset: option.label, english: false });
      }
    }
  });

  test("the presets the sentence names are the picker's, each a worded key", () => {
    // Every preset the picker offers is named by its label, never its value.
    for (const option of TIME_RANGE_PRESET_OPTIONS) {
      expect(getTimeRangeLabel(option.range)).toBe(option.label);
    }

    const untranslated: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      for (const option of TIME_RANGE_PRESET_OPTIONS) {
        if (readDashboardLocale(language)[option.label] === option.label) {
          untranslated.push(`${language}: ${option.label}`);
        }
      }
    }

    expect(untranslated).toEqual([]);
    expect(
      TIME_RANGE_PRESET_OPTIONS.map((option: TimeRangePickerPresetOption) => {
        return option.range;
      }),
    ).toContain(TimeRange.PAST_ONE_HOUR);
  });

  test("a language with no wording of the sentence yet reads it in English, dates and all", () => {
    /*
     * A negative control for the language of the values: German's words
     * for everything but this sentence. The sentence falls back to English,
     * and so does its window - never a German date in an English sentence.
     */
    pin(false);

    const german: Record<string, string> = readDashboardLocale("de");
    const withoutTheSentence: Translator = createTranslator(
      (text: string): string | undefined => {
        return text === LOGS_TIME_RANGE_EMPTY_HINT ? undefined : german[text];
      },
      "de",
    );

    const read: string = spaced(
      withoutIsolateMarks(
        writeLogsEmptyMessage(
          getEmptyMessageWithTimeRange(CUSTOM_AFTERNOON),
          withoutTheSentence,
          { setsValuesApart: true },
        ),
      ),
    );

    expect(read).toBe(
      "Time range: Mar 1, 14:30 – Mar 1, 18:45. Try adjusting filters or expanding the time range.",
    );
    expect(read).not.toContain("März");

    // A preset too: its English name in an English sentence.
    expect(
      spaced(
        writeLogsEmptyMessage(
          getEmptyMessageWithTimeRange({ range: TimeRange.PAST_ONE_HOUR }),
          withoutTheSentence,
        ),
      ),
    ).toBe(
      "Time range: past 1 hour. Try adjusting filters or expanding the time range.",
    );
  });

  test("English is unchanged with the English Dashboard's words, and holds no isolate marks", () => {
    pin(true);

    const drawn: string = drawnIn(
      "en",
      getEmptyMessageWithTimeRange(CUSTOM_AFTERNOON),
    );

    expect(spaced(drawn)).toBe(
      "Time range: Mar 1, 2:30 PM – Mar 1, 6:45 PM. Try adjusting filters or expanding the time range.",
    );
    expect(drawn).toBe(withoutIsolateMarks(drawn));
  });

  test("the window in every language is what that language's picker button says", () => {
    pin(true);

    for (const language of DASHBOARD_LANGUAGES) {
      expect({
        language,
        holdsButton: readIn(
          language,
          getEmptyMessageWithTimeRange(CUSTOM_AFTERNOON),
        ).includes(buttonLabelIn(language, CUSTOM_AFTERNOON)),
      }).toEqual({ language, holdsButton: true });
    }
  });

  test("a host's own line is still looked up as it is", () => {
    expect(
      writeLogsEmptyMessage(LOGS_TABLE_EMPTY_HINT, dashboardTranslator("de")),
    ).toBe(readDashboardLocale("de")[LOGS_TABLE_EMPTY_HINT]);
    expect(
      writeLogsEmptyMessage(
        "A line no locale words.",
        dashboardTranslator("de"),
      ),
    ).toBe("A line no locale words.");
  });
});

// The window as the sentence holds it in `language`: each end kept whole.
function getTimeRangeWindowAsWritten(language: string): string {
  setDateDisplayLanguage(language);

  try {
    const label: string = getTimeRangeButtonLabel(CUSTOM_AFTERNOON);
    const [start, end] = label.split(" – ") as [string, string];
    const whole: (text: string) => string = (text: string): string => {
      return text.split(" ").join(NO_BREAK_SPACE);
    };

    return `${whole(start)}${NO_BREAK_SPACE}– ${whole(end)}`;
  } finally {
    setDateDisplayLanguage(null);
  }
}

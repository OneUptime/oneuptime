import {
  formatHandOffInstant,
  formatHeadlineHandOffInstant,
  formatShiftInstant,
  summarizeHandOff,
  summarizeStartsAt,
} from "../../FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerSummary";
import OneUptimeDate from "Common/Types/Date";
import {
  ENGLISH_DATE_LANGUAGE,
  setDateDisplayLanguage,
} from "Common/Types/DateLanguage";
import Timezone from "Common/Types/Timezone";

/*
 * A SCHEDULE'S TIMES, AS THE PAGES READ THEM, CARRY NO SECONDS (issue #7593).
 *
 * The pickers now take hours and minutes, but a layer saved before can
 * still start at 08:00:17 - nothing rewrites a stored time. What the pages
 * print about it - the layer's "Starts ..." and "Hands off at ...", the
 * shifts and hand-offs of the schedule, an override's Starts and Ends in the
 * User Overrides table - reads 08:00, in English and in the languages
 * people read the product in. Seconds stay where they mean something: a
 * telemetry timestamp, which asks for them (the control below).
 */

const NEW_YORK: string = "America/New_York";

// 08:00:17 in New York (EST).
const SAVED_WITH_SECONDS: Date = new Date("2026-11-11T13:00:17.000Z");
const NOW: Date = new Date("2026-11-10T12:00:00.000Z");

// A clock reading with seconds: "08:00:17", "8:00:17".
const CLOCK_WITH_SECONDS: RegExp = /\d{1,2}:\d{2}:\d{2}/;

// The hour and minute it reads, 12- or 24-hour: "08:00", "8:00".
const EIGHT_O_CLOCK: RegExp = /(^|\D)0?8:00(\D|$)/;

type Formatter = [string, () => string];

// Every read-only time of a schedule, as its page formats it.
function scheduleTimes(): Array<Formatter> {
  return [
    [
      "a shift's start or end",
      (): string => {
        return formatShiftInstant(SAVED_WITH_SECONDS, NEW_YORK);
      },
    ],
    [
      "a hand-off in the list of hand-offs",
      (): string => {
        return formatHandOffInstant(SAVED_WITH_SECONDS, NEW_YORK, NOW);
      },
    ],
    [
      "the hand-off a final schedule's headline names",
      (): string => {
        return formatHeadlineHandOffInstant(SAVED_WITH_SECONDS, NEW_YORK, NOW);
      },
    ],
    [
      "an override's Starts or Ends in the table, and a date on a detail page",
      (): string => {
        return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          SAVED_WITH_SECONDS,
        );
      },
    ],
    [
      "a layer's start, in its summary",
      (): string => {
        return OneUptimeDate.getDateAsLocalFormattedString(
          SAVED_WITH_SECONDS,
          false,
        );
      },
    ],
    [
      "a layer's hand-off time of day, in its summary",
      (): string => {
        return OneUptimeDate.getLocalHourAndMinuteFromDate(SAVED_WITH_SECONDS);
      },
    ],
  ];
}

beforeEach(() => {
  OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);
});

afterEach(() => {
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
  setDateDisplayLanguage(ENGLISH_DATE_LANGUAGE);
});

describe.each([
  // With the word for November each writes, so a date left in English cannot pass.
  ["English", "en", "Nov 11"],
  ["German", "de", "11. Nov."],
  ["Arabic", "ar", "11 نوفمبر"],
])(
  "a schedule's times, read in %s",
  (_name: string, language: string, november: string) => {
    test("are written in that language", () => {
      setDateDisplayLanguage(language);

      expect(formatShiftInstant(SAVED_WITH_SECONDS, NEW_YORK)).toContain(
        november,
      );
      expect(
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          SAVED_WITH_SECONDS,
        ),
      ).toContain(november);
    });

    describe.each([
      ["24-hour", false],
      ["12-hour", true],
    ])("on a %s clock", (_clock: string, twelveHour: boolean) => {
      beforeEach(() => {
        setDateDisplayLanguage(language);
        jest
          .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
          .mockReturnValue(twelveHour);
      });

      test.each(scheduleTimes())(
        "%s reads the minute, with no seconds",
        (_what: string, format: () => string) => {
          const text: string = format();

          expect({ text, seconds: CLOCK_WITH_SECONDS.test(text) }).toEqual({
            text,
            seconds: false,
          });
          expect(text).toMatch(EIGHT_O_CLOCK);
        },
      );

      test("a telemetry timestamp, which asks for its seconds, still shows them", () => {
        const text: string =
          OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            SAVED_WITH_SECONDS,
            false,
            true,
          );

        expect(text).toMatch(CLOCK_WITH_SECONDS);
        expect(text).toContain(":17");
      });
    });
  },
);

describe("a layer's summary sentences", () => {
  beforeEach(() => {
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(false);
  });

  test("Starts ... names the minute a layer saved with seconds starts in", () => {
    const sentence: string = summarizeStartsAt(SAVED_WITH_SECONDS);

    expect(sentence).toBe("Starts Nov 11 2026, 08:00 EST");
  });

  test("Hands off at ... names the minute too", () => {
    expect(summarizeHandOff(SAVED_WITH_SECONDS)).toBe("Hands off at 08:00");
  });
});

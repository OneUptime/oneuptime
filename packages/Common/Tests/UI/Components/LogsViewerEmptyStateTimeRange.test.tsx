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
import { getEmptyMessageWithTimeRange } from "../../../UI/Components/LogsViewer/LogsViewer";
import { getTimeRangeButtonLabel } from "../../../UI/Components/Date/TimeRangePickerDropdown";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import TimeRange from "../../../Types/Time/TimeRange";
import Timezone from "../../../Types/Timezone";

const AFTERNOON: InBetween<Date> = new InBetween<Date>(
  new Date("2024-03-01T14:30:00.000Z"),
  new Date("2024-03-01T18:45:00.000Z"),
);

function pin(use12HourFormat: boolean): void {
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(use12HourFormat);
}

afterEach(() => {
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
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

      expect(
        getEmptyMessageWithTimeRange({
          range: TimeRange.CUSTOM,
          startAndEndDate: AFTERNOON,
        }),
      ).toBe(
        "Time range: Mar 1, 2:30 PM – Mar 1, 6:45 PM. Try adjusting filters or expanding the time range.",
      );
    });

    test("is written on a 24-hour clock on a 24-hour machine", () => {
      pin(false);

      const message: string = getEmptyMessageWithTimeRange({
        range: TimeRange.CUSTOM,
        startAndEndDate: AFTERNOON,
      });

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
        getEmptyMessageWithTimeRange({
          range: TimeRange.CUSTOM,
          startAndEndDate: AFTERNOON,
        }),
      ).not.toContain("02:30 PM");
    });

    test("is read in the timezone configured in User Settings", () => {
      pin(true);
      OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);

      expect(
        getEmptyMessageWithTimeRange({
          range: TimeRange.CUSTOM,
          startAndEndDate: AFTERNOON,
        }),
      ).toContain("Mar 1, 8:00 PM – Mar 2, 12:15 AM");
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

      expect(
        getEmptyMessageWithTimeRange({
          range: TimeRange.CUSTOM,
          startAndEndDate: AFTERNOON,
        }),
      ).toContain(`${start} – ${end}`);
    });
  });

  describe("a preset window", () => {
    test("names the preset rather than any clock time", () => {
      pin(true);

      const message: string = getEmptyMessageWithTimeRange({
        range: TimeRange.PAST_ONE_HOUR,
      });

      expect(message).toBe(
        "Time range: past 1 hour. Try adjusting filters or expanding the time range.",
      );
      expect(message).not.toMatch(/\d{1,2}:\d{2}/);
    });

    test("reads the same on either clock", () => {
      pin(true);
      const on12Hour: string = getEmptyMessageWithTimeRange({
        range: TimeRange.PAST_THIRTY_MINS,
      });

      pin(false);
      const on24Hour: string = getEmptyMessageWithTimeRange({
        range: TimeRange.PAST_THIRTY_MINS,
      });

      expect(on12Hour).toBe(on24Hour);
    });
  });

  describe("no window at all", () => {
    test("falls back to a message with no range in it", () => {
      expect(getEmptyMessageWithTimeRange(undefined)).toBe(
        "Adjust filters or check again later.",
      );
    });

    test("falls back when a custom range carries no dates", () => {
      expect(getEmptyMessageWithTimeRange({ range: TimeRange.CUSTOM })).toBe(
        "Time range: custom. Try adjusting filters or expanding the time range.",
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
      ).toBe(
        "Time range: Nov 12, 2025, 9:49 AM – Nov 12, 2026, 9:49 AM. Try adjusting filters or expanding the time range.",
      );
    });

    test("a window in an earlier year names it at both ends", () => {
      pin(false);

      expect(
        getEmptyMessageWithTimeRange(
          { range: TimeRange.CUSTOM, startAndEndDate: AFTERNOON },
          NOW,
        ),
      ).toBe(
        "Time range: Mar 1, 2024, 14:30 – Mar 1, 2024, 18:45. Try adjusting filters or expanding the time range.",
      );
    });

    test("a window in this year names none, as before", () => {
      pin(false);

      expect(
        getEmptyMessageWithTimeRange(
          { range: TimeRange.CUSTOM, startAndEndDate: AFTERNOON },
          new Date("2024-11-12T10:00:00.000Z"),
        ),
      ).toBe(
        "Time range: Mar 1, 14:30 – Mar 1, 18:45. Try adjusting filters or expanding the time range.",
      );
    });

    test("it says what the picker button says about the same window", () => {
      pin(true);

      const window: InBetween<Date> = new InBetween<Date>(
        new Date("2025-12-20T09:00:00.000Z"),
        new Date("2026-01-05T17:00:00.000Z"),
      );

      expect(
        getEmptyMessageWithTimeRange(
          { range: TimeRange.CUSTOM, startAndEndDate: window },
          NOW,
        ),
      ).toContain(
        getTimeRangeButtonLabel(
          { range: TimeRange.CUSTOM, startAndEndDate: window },
          NOW,
        ),
      );
    });
  });
});

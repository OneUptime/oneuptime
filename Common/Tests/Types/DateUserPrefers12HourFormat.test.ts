/**
 * How OneUptime decides whether to write times on a 12- or a 24-hour clock.
 *
 * The answer has to come from the machine the person is sitting at: a browser
 * resolves its default locale against the operating system's own clock setting,
 * so toggling macOS's "24-Hour Time" (or the Windows/Linux equivalent) is meant
 * to flip every time in the product.
 *
 * The bug these lock in: the check used to format a time and look for the
 * letters "am"/"pm" in it. That is only how Latin-script locales mark the day
 * period - ko-KR writes 오후, ar-EG writes م - so 12-hour machines in those
 * locales were misread as 24-hour and got 24-hour times back. Intl reports the
 * hour cycle directly, so it is asked first and the string probe is kept only
 * as a fallback for an engine without a usable Intl.
 */
import OneUptimeDate from "../../Types/Date";
import Timezone from "../../Types/Timezone";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

type ResolvedOptionsStub = {
  hour12?: boolean | undefined;
  hourCycle?: string | undefined;
};

/*
 * Stand in for the browser's resolved locale. `locales` records what the probe
 * asked for so a test can assert it requested an hour at all - Intl only
 * reports `hour12` when the format includes one, so a probe that forgot to ask
 * would silently fall through to the string check on every engine.
 */
type IntlProbeCall = {
  locales: Intl.LocalesArgument;
  options: Intl.DateTimeFormatOptions | undefined;
};

const probeCalls: Array<IntlProbeCall> = [];

type StubIntlFunction = (resolved: ResolvedOptionsStub | (() => never)) => void;

const stubIntl: StubIntlFunction = (
  resolved: ResolvedOptionsStub | (() => never),
): void => {
  jest
    .spyOn(Intl, "DateTimeFormat")
    .mockImplementation(
      (
        locales?: Intl.LocalesArgument,
        options?: Intl.DateTimeFormatOptions,
      ) => {
        probeCalls.push({ locales: locales, options: options });

        if (typeof resolved === "function") {
          resolved();
        }

        return {
          resolvedOptions: () => {
            return resolved as Intl.ResolvedDateTimeFormatOptions;
          },
        } as unknown as Intl.DateTimeFormat;
      },
    );
};

type StubFormattedTimeFunction = (formatted: string) => void;

const stubFormattedTime: StubFormattedTimeFunction = (
  formatted: string,
): void => {
  jest.spyOn(Date.prototype, "toLocaleTimeString").mockImplementation(() => {
    return formatted;
  });
};

/*
 * Delegate to the real Intl but pin the locale, so a case can assert what a
 * machine actually configured to that locale reports rather than a hand-made
 * stub of it.
 */
type StubIntlWithLocaleFunction = (locale: string) => void;

const stubIntlWithLocale: StubIntlWithLocaleFunction = (
  locale: string,
): void => {
  const realDateTimeFormat: typeof Intl.DateTimeFormat = Intl.DateTimeFormat;

  jest
    .spyOn(Intl, "DateTimeFormat")
    .mockImplementation(
      (
        _locales?: Intl.LocalesArgument,
        options?: Intl.DateTimeFormatOptions,
      ) => {
        return new realDateTimeFormat(locale, options);
      },
    );

  /*
   * Hold the legacy string probe to a bare 24-hour reading. Without this the
   * fallback still sees the HOST's locale, so on a US runner the old am/pm
   * substring check would answer "12-hour" by luck and the cases below would
   * pass against the very implementation they exist to rule out.
   */
  stubFormattedTime("14:30:00");
};

describe("OneUptimeDate.getUserPrefers12HourFormat", () => {
  afterEach(() => {
    probeCalls.length = 0;
    jest.restoreAllMocks();
    OneUptimeDate.setUserTimezone(null);
  });

  describe("reading the machine's clock setting from Intl", () => {
    it("reports a 12-hour machine as 12-hour", () => {
      stubIntl({ hour12: true, hourCycle: "h12" });

      expect(OneUptimeDate.getUserPrefers12HourFormat()).toBe(true);
    });

    it("reports a 24-hour machine as 24-hour", () => {
      stubIntl({ hour12: false, hourCycle: "h23" });

      expect(OneUptimeDate.getUserPrefers12HourFormat()).toBe(false);
    });

    it("asks for an hour, without which Intl reports no clock at all", () => {
      stubIntl({ hour12: true });

      OneUptimeDate.getUserPrefers12HourFormat();

      expect(probeCalls).toHaveLength(1);
      expect(probeCalls[0]?.options?.hour).toBeDefined();
    });

    it("asks for the machine's own locale rather than pinning one", () => {
      stubIntl({ hour12: true });

      OneUptimeDate.getUserPrefers12HourFormat();

      /*
       * Assert the probe ran before reading what it asked for - without this,
       * an implementation that never called Intl would satisfy the line below
       * on an empty array.
       */
      expect(probeCalls).toHaveLength(1);
      // `undefined` is what makes Intl resolve the browser's default locale.
      expect(probeCalls[0]?.locales).toBeUndefined();
    });
  });

  describe("engines that report the cycle but not the boolean", () => {
    it("treats h12 as a 12-hour clock", () => {
      stubIntl({ hourCycle: "h12" });

      expect(OneUptimeDate.getUserPrefers12HourFormat()).toBe(true);
    });

    it("treats h11 as a 12-hour clock", () => {
      stubIntl({ hourCycle: "h11" });

      expect(OneUptimeDate.getUserPrefers12HourFormat()).toBe(true);
    });

    it("treats h23 as a 24-hour clock", () => {
      stubIntl({ hourCycle: "h23" });

      expect(OneUptimeDate.getUserPrefers12HourFormat()).toBe(false);
    });

    it("treats h24 as a 24-hour clock", () => {
      stubIntl({ hourCycle: "h24" });

      expect(OneUptimeDate.getUserPrefers12HourFormat()).toBe(false);
    });

    it("prefers the boolean when both are reported and they disagree", () => {
      /*
       * hour12 is the value the spec says to honour; hourCycle is only read
       * because older engines omit hour12 entirely.
       */
      stubIntl({ hour12: false, hourCycle: "h12" });

      expect(OneUptimeDate.getUserPrefers12HourFormat()).toBe(false);
    });
  });

  describe("real locales", () => {
    it("reads en-US as a 12-hour machine", () => {
      stubIntlWithLocale("en-US");

      expect(OneUptimeDate.getUserPrefers12HourFormat()).toBe(true);
    });

    it("reads en-GB as a 24-hour machine", () => {
      stubIntlWithLocale("en-GB");

      expect(OneUptimeDate.getUserPrefers12HourFormat()).toBe(false);
    });

    it("reads de-DE as a 24-hour machine", () => {
      stubIntlWithLocale("de-DE");

      expect(OneUptimeDate.getUserPrefers12HourFormat()).toBe(false);
    });

    it("honours an explicit 24-hour override on a 12-hour locale", () => {
      // What a US machine with "24-Hour Time" switched on resolves to.
      stubIntlWithLocale("en-US-u-hc-h23");

      expect(OneUptimeDate.getUserPrefers12HourFormat()).toBe(false);
    });

    it("honours an explicit 12-hour override on a 24-hour locale", () => {
      stubIntlWithLocale("de-DE-u-hc-h12");

      expect(OneUptimeDate.getUserPrefers12HourFormat()).toBe(true);
    });

    it("reads ko-KR as a 12-hour machine even though it writes 오후, not PM", () => {
      /*
       * The regression this whole change exists for: the old string probe saw
       * "오후 2:30:00", found no "am"/"pm", and told a Korean user on a
       * 12-hour machine they were on a 24-hour one.
       */
      stubIntlWithLocale("ko-KR");

      expect(OneUptimeDate.getUserPrefers12HourFormat()).toBe(true);
    });

    it("reads ar-EG as a 12-hour machine even though it writes م, not PM", () => {
      stubIntlWithLocale("ar-EG");

      expect(OneUptimeDate.getUserPrefers12HourFormat()).toBe(true);
    });
  });

  describe("falling back when Intl cannot answer", () => {
    it("reads a Latin AM/PM out of a formatted time when Intl throws", () => {
      stubIntl(() => {
        throw new Error("Intl unavailable");
      });
      stubFormattedTime("2:30:00 PM");

      expect(OneUptimeDate.getUserPrefers12HourFormat()).toBe(true);
    });

    it("reads a bare 24-hour time out of a formatted time when Intl throws", () => {
      stubIntl(() => {
        throw new Error("Intl unavailable");
      });
      stubFormattedTime("14:30:00");

      expect(OneUptimeDate.getUserPrefers12HourFormat()).toBe(false);
    });

    it("falls back when Intl answers with neither a boolean nor a cycle", () => {
      stubIntl({});
      stubFormattedTime("2:30:00 AM");

      expect(OneUptimeDate.getUserPrefers12HourFormat()).toBe(true);
    });

    it("matches a lowercase day period", () => {
      stubIntl({});
      stubFormattedTime("2:30:00 pm");

      expect(OneUptimeDate.getUserPrefers12HourFormat()).toBe(true);
    });

    it("does not throw when Intl is broken and the time has no day period", () => {
      stubIntl(() => {
        throw new Error("Intl unavailable");
      });
      stubFormattedTime("14:30:00");

      expect(() => {
        return OneUptimeDate.getUserPrefers12HourFormat();
      }).not.toThrow();
    });
  });

  describe("as a decision the rest of the product reads", () => {
    it("drives the clock of the time range picker's custom label", () => {
      /*
       * The user-visible consequence, end to end: the same instant is written
       * two different ways purely on the strength of this one answer.
       */
      /*
       * Pin the zone: without it this reads 2:30 PM on a UTC runner and 6:30 AM
       * on a Los Angeles one, and the assertion is about the clock, not the
       * zone.
       */
      OneUptimeDate.setUserTimezone(Timezone.UTC);

      stubIntlWithLocale("en-US");
      const on12HourMachine: string =
        OneUptimeDate.getDateAsLocalShortDateTimeString(
          new Date("2024-03-01T14:30:00.000Z"),
          { use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat() },
        );

      jest.restoreAllMocks();

      stubIntlWithLocale("en-GB");
      const on24HourMachine: string =
        OneUptimeDate.getDateAsLocalShortDateTimeString(
          new Date("2024-03-01T14:30:00.000Z"),
          { use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat() },
        );

      expect(on12HourMachine).toBe("Mar 1, 2:30 PM");
      expect(on24HourMachine).toBe("Mar 1, 14:30");
    });
  });
});

/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import RestrictionTimesFieldElement from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/RestrictionTimesFieldElement";
import OneUptimeDate from "../../../Types/Date";
import DayOfWeek from "../../../Types/Day/DayOfWeek";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";

/*
 * A layer's restriction hours read hours first in Arabic and Persian
 * (#7593).
 *
 * The From and To clocks over a layer's active hours (and an on-call rule's
 * working hours) are the shared time picker. On a page read right to left
 * its row ran from the right, and a window from 00:00 to 01:00 read "00 : 00"
 * to "00 : 01": one minute past midnight. Each clock's hours, colon and
 * minutes now read left to right, hours first, as a time is written on those
 * pages and as the date and time fields over them write it. jsdom lays
 * nothing out, so this reads the direction each clock is drawn in and the
 * order its numbers are written in, which the browser lays out from; the
 * pull request's screenshots show the result.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const STRINGS: Record<string, Record<string, string>> = {
  ar: readLocale("ar"),
  fa: readLocale("fa"),
  en: readLocale("en"),
};

function inLanguage(locale: string, english: string): string {
  const worded: string | undefined = STRINGS[locale]![english];

  if (!worded) {
    throw new Error(`${locale} does not word "${english}".`);
  }

  return worded;
}

function dailyWindow(from: string, to: string): RestrictionTimes {
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.Daily;
  restrictionTimes.dayRestrictionTimes = {
    startTime: new Date(`2026-11-13T${from}:00.000Z`),
    endTime: new Date(`2026-11-13T${to}:00.000Z`),
  };
  restrictionTimes.weeklyRestrictionTimes = [];
  return restrictionTimes;
}

function weeklyWindow(): RestrictionTimes {
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.Weekly;
  restrictionTimes.dayRestrictionTimes = null;
  restrictionTimes.weeklyRestrictionTimes = [
    {
      startDay: DayOfWeek.Monday,
      endDay: DayOfWeek.Friday,
      startTime: new Date("2026-11-09T09:00:00.000Z"),
      endTime: new Date("2026-11-13T17:30:00.000Z"),
    },
  ];
  return restrictionTimes;
}

interface ClockReading {
  // The direction the clock's numbers are drawn in.
  direction: string | null;
  // Its numbers, in the order they are written - left to right when ltr.
  numbers: Array<string>;
  // What the clock's group holds besides them: AM/PM, read by the page.
  amOrPm: string | null;
}

// Each From and To clock on the page, in order, as its numbers read.
function readClocks(locale: string): Array<ClockReading> {
  return screen
    .getAllByRole("group", { name: inLanguage(locale, "Time input") })
    .map((clock: HTMLElement): ClockReading => {
      const time: Element | null =
        clock.querySelector("input")?.closest("[dir]") || null;

      const amOrPm: HTMLElement | null = clock.querySelector(
        '[role="group"]',
      ) as HTMLElement | null;

      return {
        direction:
          time && clock.contains(time) ? time.getAttribute("dir") : null,
        numbers: time
          ? Array.from(time.querySelectorAll("input")).map(
              (input: HTMLInputElement) => {
                return input.value;
              },
            )
          : [],
        amOrPm:
          amOrPm && time && !time.contains(amOrPm)
            ? amOrPm.getAttribute("aria-label")
            : null,
      };
    });
}

// A 24-hour clock unless a test asks for a 12-hour one.
function pickClock(hours: 12 | 24): void {
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(hours === 12);
}

function renderOnAPage(
  direction: "rtl" | "ltr",
  restrictionTimes: RestrictionTimes,
): void {
  render(
    <div dir={direction}>
      <RestrictionTimesFieldElement value={restrictionTimes} timezone="UTC" />
    </div>,
  );
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      ar: { translation: STRINGS["ar"]! },
      fa: { translation: STRINGS["fa"]! },
      en: { translation: STRINGS["en"]! },
    },
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

describe("restriction hours read hours first on a page read right to left", () => {
  test("the zone of the docblock took", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("UTC");
  });

  test.each(["ar", "fa"])(
    "%s: a window from 00:00 to 01:00 reads 00:00 and 01:00, not 00:01",
    async (locale: string) => {
      await act(async () => {
        await i18next.changeLanguage(locale);
      });

      pickClock(24);
      renderOnAPage("rtl", dailyWindow("00:00", "01:00"));

      // The window is drawn in the reader's language.
      expect(
        screen.getByText(inLanguage(locale, "Specific Times of the Day")),
      ).toBeInTheDocument();

      expect(readClocks(locale)).toEqual([
        { direction: "ltr", numbers: ["00", "00"], amOrPm: null },
        { direction: "ltr", numbers: ["01", "00"], amOrPm: null },
      ]);
    },
  );

  test.each(["ar", "fa"])(
    "%s on a 12-hour clock: 12:00 and 01:00, with AM/PM read after the time, the page's way",
    async (locale: string) => {
      pickClock(12);

      await act(async () => {
        await i18next.changeLanguage(locale);
      });

      renderOnAPage("rtl", dailyWindow("00:00", "01:00"));

      const amOrPm: string = inLanguage(locale, "AM or PM");

      expect(readClocks(locale)).toEqual([
        { direction: "ltr", numbers: ["12", "00"], amOrPm },
        { direction: "ltr", numbers: ["01", "00"], amOrPm },
      ]);
    },
  );

  test.each(["ar", "fa"])(
    "%s: a weekly window from Monday 09:00 to Friday 17:30 reads 09:00 and 17:30",
    async (locale: string) => {
      await act(async () => {
        await i18next.changeLanguage(locale);
      });

      pickClock(24);
      renderOnAPage("rtl", weeklyWindow());

      expect(readClocks(locale)).toEqual([
        { direction: "ltr", numbers: ["09", "00"], amOrPm: null },
        { direction: "ltr", numbers: ["17", "30"], amOrPm: null },
      ]);
    },
  );

  test("English, read left to right, reads the same clocks the same way", () => {
    pickClock(24);
    renderOnAPage("ltr", dailyWindow("09:00", "17:30"));

    expect(readClocks("en")).toEqual([
      { direction: "ltr", numbers: ["09", "00"], amOrPm: null },
      { direction: "ltr", numbers: ["17", "30"], amOrPm: null },
    ]);
  });
});

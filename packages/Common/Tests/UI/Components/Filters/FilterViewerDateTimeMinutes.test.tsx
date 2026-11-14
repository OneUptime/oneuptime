import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import FilterViewer from "../../../../UI/Components/Filters/FilterViewer";
import Filter from "../../../../UI/Components/Filters/Types/Filter";
import FilterData from "../../../../UI/Components/Filters/Types/FilterData";
import FieldType from "../../../../UI/Components/Types/FieldType";
import EqualTo from "../../../../Types/BaseDatabase/EqualTo";
import GreaterThan from "../../../../Types/BaseDatabase/GreaterThan";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import LessThan from "../../../../Types/BaseDatabase/LessThan";
import OneUptimeDate from "../../../../Types/Date";
import {
  ENGLISH_DATE_LANGUAGE,
  setDateDisplayLanguage,
} from "../../../../Types/DateLanguage";
import GenericObject from "../../../../Types/GenericObject";
import Timezone from "../../../../Types/Timezone";

/*
 * A DATE AND TIME FILTER'S CHIP READS HOURS AND MINUTES (issue #7593).
 *
 * A list filtered by a date and time - a maintenance event's state
 * timeline by Starts At, your on-call notifications by Notification Sent
 * At, a status page's subscribers by Subscribed At - said "Starts At is
 * after Nov 13 2026, 11:15:00 AM" over the list: seconds the filter's own
 * field neither shows nor takes, always :00 for a time picked to the
 * minute. (User Overrides and the maintenance events list filter by day,
 * and read a day, as before.) The chip now
 * reads the time as the field does, "11:15", whatever the operator, in
 * English and in the reader's language; a date filter reads its day as it
 * always did.
 */

type Row = GenericObject & {
  startsAt?: Date;
  day?: Date;
};

const FILTERS: Array<Filter<Row>> = [
  { key: "startsAt", title: "Starts", type: FieldType.DateTime },
  { key: "day", title: "Day", type: FieldType.Date },
] as unknown as Array<Filter<Row>>;

// 11:15:52 and 12:40:07 in New York (EST); the date is November 13.
const WITH_SECONDS: Date = new Date("2026-11-13T16:15:52.000Z");
const LATER_WITH_SECONDS: Date = new Date("2026-11-13T17:40:07.000Z");
const ON_THE_MINUTE: Date = new Date("2026-11-13T16:15:00.000Z");

// A clock reading with seconds: "11:15:52", "11:15:00".
const CLOCK_WITH_SECONDS: RegExp = /\d{1,2}:\d{2}:\d{2}/;

const languages: Record<string, i18n> = {};

beforeAll(async () => {
  for (const code of ["en", "de", "ar"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: code,
      resources: { [code]: { translation: {} } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    languages[code] = instance;
  }
});

beforeEach(() => {
  OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
  setDateDisplayLanguage(ENGLISH_DATE_LANGUAGE);
});

function renderFilters(code: string, filterData: FilterData<Row>): void {
  setDateDisplayLanguage(code);

  render(
    <I18nextProvider i18n={languages[code] as i18n}>
      <FilterViewer<Row>
        id="user-overrides"
        filters={FILTERS}
        filterData={filterData}
        showFilterModal={false}
        pluralLabel="User Overrides"
      />
    </I18nextProvider>,
  );
}

// The chip a filter's title is in.
function chipOf(title: string): HTMLElement {
  const chip: HTMLElement | null = screen
    .getByText(title)
    .closest(".rounded-full");

  if (!chip) {
    throw new Error(`No chip for ${title}`);
  }

  return chip as HTMLElement;
}

function chipText(title: string): string {
  return (chipOf(title).textContent || "").replace(/\s+/g, " ").trim();
}

describe("a date and time filter's chip", () => {
  test.each([
    ["is after", new GreaterThan(WITH_SECONDS), "11:15"],
    ["is before", new LessThan(WITH_SECONDS), "11:15"],
    ["is", new EqualTo(WITH_SECONDS), "11:15"],
    ["is on the minute", new EqualTo(ON_THE_MINUTE), "11:15"],
  ])(
    "%s: reads the hour and the minute, with no seconds",
    (_operator: string, value: unknown, clock: string) => {
      renderFilters("en", { startsAt: value } as FilterData<Row>);

      const text: string = chipText("Starts");

      expect({ text, seconds: CLOCK_WITH_SECONDS.test(text) }).toEqual({
        text,
        seconds: false,
      });
      expect(text).toContain(clock);
      expect(text).toContain("Nov 13 2026");
    },
  );

  test("is after: says so, with the minute", () => {
    renderFilters("en", {
      startsAt: new GreaterThan(WITH_SECONDS),
    } as FilterData<Row>);

    expect(chipText("Starts")).toBe("Starts is after Nov 13 2026, 11:15 EST");
  });

  test("is between: both ends to the minute", () => {
    renderFilters("en", {
      startsAt: new InBetween(WITH_SECONDS, LATER_WITH_SECONDS),
    } as FilterData<Row>);

    expect(chipText("Starts")).toBe(
      "Starts is between Nov 13 2026, 11:15 EST and Nov 13 2026, 12:40 EST",
    );
  });

  test("a range inside one minute reads as that minute", () => {
    renderFilters("en", {
      startsAt: new InBetween(ON_THE_MINUTE, WITH_SECONDS),
    } as FilterData<Row>);

    expect(chipText("Starts")).toBe("Starts is Nov 13 2026, 11:15 EST");
  });

  test("on a 12-hour clock too", () => {
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(true);

    renderFilters("en", {
      startsAt: new GreaterThan(WITH_SECONDS),
    } as FilterData<Row>);

    expect(chipText("Starts")).toBe(
      "Starts is after Nov 13 2026, 11:15 AM EST",
    );
  });

  test.each([
    // With the word for November each writes, so a date left in English cannot pass.
    ["German", "de", "Nov."],
    ["Arabic", "ar", "نوفمبر"],
  ])(
    "read in %s, the date is that language's and the time has no seconds",
    (_language: string, code: string, november: string) => {
      renderFilters(code, {
        startsAt: new InBetween(WITH_SECONDS, LATER_WITH_SECONDS),
      } as FilterData<Row>);

      const text: string = chipText("Starts");

      expect(text).toContain(november);
      expect({ text, seconds: CLOCK_WITH_SECONDS.test(text) }).toEqual({
        text,
        seconds: false,
      });
      expect(text).toMatch(/11:15/);
      expect(text).toMatch(/12:40/);
    },
  );

  test("a date filter reads its day, as it always did", () => {
    renderFilters("en", {
      day: new GreaterThan(WITH_SECONDS),
    } as FilterData<Row>);

    expect(chipText("Day")).toBe("Day is after Nov 13, 2026");
  });
});

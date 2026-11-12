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
import { cleanup, render } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import ChartCard from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ChartCard";
import {
  forgetRememberedDateTexts,
  setDateDisplayLanguage,
} from "../../../Types/DateLanguage";
import IconProp from "../../../Types/Icon/IconProp";
import SeriesPoint from "../../../UI/Components/Charts/Types/SeriesPoints";
import XAxisPrecision from "../../../UI/Components/Charts/Types/XAxis/XAxisPrecision";

/*
 * CHARTCARD'S DAY AXIS AND ITS LEGEND, DRAWN BY REAL RECHARTS.
 *
 * Product Analytics charts one point a day through ChartCard (issue #6564).
 * The card's time axis guessed its step from the window's length, so an
 * application counted for two days read "07 Nov, 00:00" under its charts.
 * A card handed xAxisPrecision={EVERY_DAY} names its ticks as days; every
 * other card keeps the axis it had.
 *
 * Its legend names the lines in the order the page hands them (issue
 * #6562): Daily, Weekly and Monthly active users, in every language - not
 * "Daily, Monthly, Weekly", as recharts' alphabetical default had it.
 *
 * Only ResponsiveContainer is stood in for: jsdom measures every box at 0x0.
 */

jest.mock("recharts", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "recharts",
  ) as Record<string, unknown>;
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => {
      return React.cloneElement(children, {
        width: 600,
        height: 300,
      } as Record<string, unknown>);
    },
  };
});

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const DAY_MS: number = 24 * 60 * 60 * 1000;
const CLOCK: RegExp = /\d:\d\d/;
const A_YEAR: RegExp = /20\d\d/;
// A space, a no-break space or a narrow one: the same to a reader.
const ANY_SPACE: RegExp = /\s/g;

const ACTIVE_USERS: Array<string> = [
  "Daily active users",
  "Weekly active users",
  "Monthly active users",
];

const instances: Record<string, i18n> = {};

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

beforeAll(async () => {
  const english: Record<string, unknown> = readLocale("en");

  for (const language of ["en", "de"]) {
    const instance: i18n = createInstance();

    // The Dashboard's own configuration (Utils/i18n.ts).
    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: english },
        [language]: { translation: readLocale(language) },
      },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
  setDateDisplayLanguage(null);
  forgetRememberedDateTexts();
});

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

// One point a day from `first` to `last` for each series, as the pages make them.
function activeUsers(first: Date, last: Date): Array<SeriesPoint> {
  return ACTIVE_USERS.map((name: string, place: number): SeriesPoint => {
    const data: Array<{ x: Date; y: number }> = [];

    for (
      let instant: number = first.getTime();
      instant <= last.getTime();
      instant += DAY_MS
    ) {
      data.push({ x: new Date(instant), y: (place + 1) * 10 });
    }

    return { seriesName: name, data: data };
  });
}

function drawCard(data: {
  first: Date;
  last: Date;
  precision?: XAxisPrecision | undefined;
  language?: string | undefined;
}): HTMLElement {
  const language: string = data.language || "en";

  setDateDisplayLanguage(language);

  const { container } = render(
    <I18nextProvider i18n={instances[language]!}>
      <ChartCard
        title="Active users"
        icon={IconProp.UserGroup}
        iconColor="blue"
        series={activeUsers(data.first, data.last)}
        windowStart={data.first}
        windowEnd={data.last}
        syncId="product-analytics-users"
        showLegend={true}
        yAllowDecimals={false}
        xAxisPrecision={data.precision}
      />
    </I18nextProvider>,
  );

  return container;
}

// The labels under the time axis, first to last.
function timeTicks(container: HTMLElement): Array<string> {
  return Array.from(
    container.querySelectorAll(
      ".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value",
    ),
  ).map((tick: Element): string => {
    return (tick.textContent || "").replace(ANY_SPACE, " ");
  });
}

// The legend's names, first to last.
function legendNames(container: HTMLElement): Array<string> {
  return Array.from(container.querySelectorAll("li")).map(
    (item: Element): string => {
      return item.textContent || "";
    },
  );
}

describe("a card of one point a day", () => {
  test("an application counted for two days: its ticks are the three days", () => {
    const container: HTMLElement = drawCard({
      first: day("2026-11-07"),
      last: day("2026-11-09"),
      precision: XAxisPrecision.EVERY_DAY,
    });

    expect(timeTicks(container)).toEqual(["07 Nov", "08 Nov", "09 Nov"]);
  });

  test("no tick names a clock time", () => {
    const container: HTMLElement = drawCard({
      first: day("2026-11-07"),
      last: day("2026-11-09"),
      precision: XAxisPrecision.EVERY_DAY,
    });

    expect(timeTicks(container).length).toBeGreaterThan(0);
    for (const tick of timeTicks(container)) {
      expect(tick).not.toMatch(CLOCK);
    }
  });

  test("Past 1 Year: each day its own tick, named with its year", () => {
    const container: HTMLElement = drawCard({
      first: day("2025-11-12"),
      last: day("2026-11-12"),
      precision: XAxisPrecision.EVERY_DAY,
    });
    const ticks: Array<string> = timeTicks(container);

    expect(ticks[0]).toBe("12 Nov 2025");
    expect(new Set(ticks).size).toBe(ticks.length);
    for (const tick of ticks) {
      expect(tick).toMatch(A_YEAR);
      expect(tick).not.toMatch(CLOCK);
    }
  });

  test("in German, the days as German writes them", () => {
    const container: HTMLElement = drawCard({
      first: day("2026-11-07"),
      last: day("2026-11-09"),
      precision: XAxisPrecision.EVERY_DAY,
      language: "de",
    });

    expect(timeTicks(container)).toEqual(["7. Nov.", "8. Nov.", "9. Nov."]);
  });
});

describe("every other card keeps the axis it had", () => {
  test("left unset, a two-day window still reads clock times", () => {
    const container: HTMLElement = drawCard({
      first: day("2026-11-07"),
      last: day("2026-11-09"),
    });
    const ticks: Array<string> = timeTicks(container);

    expect(ticks[0]).toBe("07 Nov, 00:00");
    expect(
      ticks.every((tick: string): boolean => {
        return CLOCK.test(tick);
      }),
    ).toBe(true);
  });
});

describe("the card's legend", () => {
  test("names Daily, Weekly and Monthly active users in that order", () => {
    const container: HTMLElement = drawCard({
      first: day("2026-11-07"),
      last: day("2026-11-09"),
      precision: XAxisPrecision.EVERY_DAY,
    });

    expect(legendNames(container)).toEqual(ACTIVE_USERS);
  });

  test("in German, the same order in German words", () => {
    const container: HTMLElement = drawCard({
      first: day("2026-11-07"),
      last: day("2026-11-09"),
      precision: XAxisPrecision.EVERY_DAY,
      language: "de",
    });

    const german: Record<string, unknown> = readLocale("de");

    expect(legendNames(container)).toEqual(
      ACTIVE_USERS.map((name: string): string => {
        return german[name] as string;
      }),
    );
    // The German words would sort M, T, W: the page's order is not the alphabet's.
    expect(legendNames(container)).toEqual([
      "Täglich aktive Benutzer",
      "Wöchentlich aktive Benutzer",
      "Monatlich aktive Benutzer",
    ]);
  });
});

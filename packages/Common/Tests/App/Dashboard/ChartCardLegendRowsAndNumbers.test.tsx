/** @timezone UTC */

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
 * CHARTCARD: A LEGEND THAT WRAPS NEVER SQUEEZES THE PLOT, THE CHART SITS AT
 * THE CARD'S FOOT, AND ITS NUMBERS READ AS THE PAGE'S DO.
 *
 * Product Analytics' Active users card names three long series. On a phone,
 * beside the side menu at 1024px, or in German, its legend wraps onto three
 * lines inside the card's 176px chart, and the plot under it fell from 78px
 * to 30px. The card now grows by the legend's extra lines, and its chart sits
 * at the foot of the card, so two cards side by side - one legend on three
 * lines, one on one - still line up their plots and time axes.
 *
 * Its value axis wrote a count as a bare "20000" beside tiles that read
 * "12,480", and in Persian in Latin digits under a time axis in Persian
 * ones. A card with no formatter of its own now writes numbers in the
 * reader's language: "20,000", "20.000", "۲۰٬۰۰۰".
 *
 * jsdom lays nothing out: the legend's box measures LINE_HEIGHT for each of
 * `legendLines`, and only recharts' ResponsiveContainer is stood in for.
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

const LINE_HEIGHT: number = 24;
const DAY_MS: number = 24 * 60 * 60 * 1000;
// Four digits or more with nothing between them: a count no reader groups so.
const UNGROUPED: RegExp = /^\d{4,}$/;
// A count under a thousand: no separator to write.
const UNDER_A_THOUSAND: RegExp = /^\d{1,3}$/;

const ACTIVE_USERS: Array<string> = [
  "Daily active users",
  "Weekly active users",
  "Monthly active users",
];

let legendLines: number = 1;

const CLIENT_HEIGHT: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight");
const OFFSET_HEIGHT: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");

const instances: Record<string, i18n> = {};

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

beforeAll(async () => {
  const english: Record<string, unknown> = readLocale("en");

  for (const language of ["en", "de", "fa"]) {
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

beforeEach(() => {
  legendLines = 1;

  // The legend's box: the element that holds its list (ChartLegend).
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement): number {
      if (this.firstElementChild?.tagName === "OL") {
        return legendLines * LINE_HEIGHT;
      }

      return CLIENT_HEIGHT?.get ? (CLIENT_HEIGHT.get.call(this) as number) : 0;
    },
  });

  // Each legend item is one line tall.
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement): number {
      if (this.tagName === "LI") {
        return LINE_HEIGHT;
      }

      return OFFSET_HEIGHT?.get ? (OFFSET_HEIGHT.get.call(this) as number) : 0;
    },
  });
});

afterEach(() => {
  cleanup();
  setDateDisplayLanguage(null);
  forgetRememberedDateTexts();
  Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
  if (OFFSET_HEIGHT) {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", OFFSET_HEIGHT);
  }
});

const FIRST_DAY: Date = new Date("2026-11-07T00:00:00.000Z");
const LAST_DAY: Date = new Date("2026-11-09T00:00:00.000Z");

// Three days of each series; the last series peaks at `peak`.
function activeUsers(peak: number): Array<SeriesPoint> {
  return ACTIVE_USERS.map((name: string, place: number): SeriesPoint => {
    return {
      seriesName: name,
      data: [0, 1, 2].map((offset: number): { x: Date; y: number } => {
        return {
          x: new Date(FIRST_DAY.getTime() + offset * DAY_MS),
          y: Math.round((peak * (place + 1)) / ACTIVE_USERS.length),
        };
      }),
    };
  });
}

function drawCard(data: {
  language?: string | undefined;
  peak?: number | undefined;
  yFormatter?: ((value: number) => string) | undefined;
}): HTMLElement {
  const language: string = data.language || "en";

  setDateDisplayLanguage(language);

  const { container } = render(
    <I18nextProvider i18n={instances[language]!}>
      <ChartCard
        title="Active users"
        icon={IconProp.UserGroup}
        iconColor="blue"
        series={activeUsers(data.peak ?? 30)}
        windowStart={FIRST_DAY}
        windowEnd={LAST_DAY}
        syncId="product-analytics-users"
        showLegend={true}
        yAllowDecimals={false}
        yFormatter={data.yFormatter}
        xAxisPrecision={XAxisPrecision.EVERY_DAY}
      />
    </I18nextProvider>,
  );

  return container;
}

function chartBlock(container: HTMLElement): HTMLElement {
  return container.querySelector(
    '[data-testid="chart-card-chart"]',
  ) as HTMLElement;
}

// The height the card's chart was given, in px (its box's inline style).
function chartHeight(container: HTMLElement): string {
  return (chartBlock(container).firstElementChild as HTMLElement).style.height;
}

// The labels beside the value axis, bottom to top.
function valueTicks(container: HTMLElement): Array<string> {
  return Array.from(
    container.querySelectorAll(
      ".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value",
    ),
  ).map((tick: Element): string => {
    return tick.textContent || "";
  });
}

describe("a legend that wraps", () => {
  test("on one line: the card's chart is 176px, as it always was", () => {
    legendLines = 1;

    expect(chartHeight(drawCard({}))).toBe("176px");
  });

  test("on three lines (a phone, or 1024px beside the side menu): two lines taller, so the plot keeps its height", () => {
    legendLines = 3;

    const container: HTMLElement = drawCard({});

    expect(container.querySelectorAll("li")).toHaveLength(3);
    expect(chartHeight(container)).toBe(`${176 + 2 * LINE_HEIGHT}px`);
  });

  test("in German, on two lines: one line taller", () => {
    legendLines = 2;

    expect(chartHeight(drawCard({ language: "de" }))).toBe(
      `${176 + LINE_HEIGHT}px`,
    );
  });
});

describe("the chart sits at the foot of the card", () => {
  test("the card is a column, and its chart takes the space left above it", () => {
    const container: HTMLElement = drawCard({});
    const card: HTMLElement = container.firstElementChild as HTMLElement;
    const chart: HTMLElement = chartBlock(container);

    expect(card).toHaveClass("flex", "flex-col");
    expect(chart).toHaveClass("mt-auto");
    // The header first, then the chart: the last thing in the card.
    expect(card.lastElementChild).toBe(chart);
    expect(chart.querySelector(".recharts-wrapper")).not.toBeNull();
  });
});

describe("the value axis writes numbers as the page does", () => {
  test("in English, thousands grouped: 20,000", () => {
    const ticks: Array<string> = valueTicks(drawCard({ peak: 20000 }));

    expect(ticks).toContain("20,000");
    expect(
      ticks.filter((tick: string): boolean => {
        return UNGROUPED.test(tick);
      }),
    ).toEqual([]);
  });

  test("in German: 20.000", () => {
    const ticks: Array<string> = valueTicks(
      drawCard({ peak: 20000, language: "de" }),
    );

    expect(ticks).toContain("20.000");
    expect(ticks).not.toContain("20000");
  });

  test("in Persian, in Persian digits as its time axis and tiles are: ۲۰٬۰۰۰", () => {
    const ticks: Array<string> = valueTicks(
      drawCard({ peak: 20000, language: "fa" }),
    );

    expect(ticks).toContain("۲۰٬۰۰۰");
    expect(ticks).toContain("۰");
    expect(ticks).not.toContain("20000");
  });

  test("small counts read as they did", () => {
    const ticks: Array<string> = valueTicks(drawCard({ peak: 36 }));

    expect(ticks[0]).toBe("0");
    expect(ticks.length).toBeGreaterThan(1);
    for (const tick of ticks) {
      expect(tick).toMatch(UNDER_A_THOUSAND);
    }
  });

  test("a page's own formatter still wins", () => {
    const ticks: Array<string> = valueTicks(
      drawCard({
        peak: 20000,
        yFormatter: (value: number): string => {
          return `${value / 1000}k`;
        },
      }),
    );

    expect(ticks).toContain("20k");
    expect(ticks).not.toContain("20,000");
  });
});

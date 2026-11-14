import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import React from "react";
import { getLegendExtraRowsHeight } from "../../../../UI/Components/Charts/ChartLibrary/LineChart/LineChart";
import LineChartElement from "../../../../UI/Components/Charts/Line/LineChart";
import ChartCurve from "../../../../UI/Components/Charts/Types/ChartCurve";
import SeriesPoint from "../../../../UI/Components/Charts/Types/SeriesPoints";
import {
  XAxis,
  XAxisAggregateType,
} from "../../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisPrecision from "../../../../UI/Components/Charts/Types/XAxis/XAxisPrecision";
import XAxisType from "../../../../UI/Components/Charts/Types/XAxis/XAxisType";
import YAxis, {
  YAxisPrecision,
} from "../../../../UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "../../../../UI/Components/Charts/Types/YAxis/YAxisType";

/*
 * A LEGEND THAT WRAPS GROWS THE CHART INSTEAD OF SQUEEZING ITS PLOT.
 *
 * A line chart draws its legend inside the height it is given. Product
 * Analytics' Active users card (176px) names three long series - Daily,
 * Weekly and Monthly active users - and on a phone, beside the side menu
 * at 1024px, or in German, the legend wraps onto three lines: the plot
 * under it went from 78px to 30px, too short to read. A chart that asks for
 * it (growsWhenLegendWraps, which ChartCard sets) now grows by the lines
 * past the first, so its plot keeps its height; one that has to fit a box
 * of its own (a dashboard widget) keeps the height it is given.
 *
 * jsdom lays nothing out, so each legend line is stood in for: the legend
 * box measures LINE_HEIGHT for each of `legendLines`, and each item one
 * line. Only ResponsiveContainer is stood in for in recharts.
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

// A legend line: an item's py-1 and its text-xs line.
const LINE_HEIGHT: number = 24;

let legendLines: number = 1;

const CLIENT_HEIGHT: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight");
const OFFSET_HEIGHT: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");

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
  Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
  if (OFFSET_HEIGHT) {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", OFFSET_HEIGHT);
  }
});

const ACTIVE_USERS: Array<string> = [
  "Daily active users",
  "Weekly active users",
  "Monthly active users",
];

const FIRST_DAY: Date = new Date("2026-11-07T00:00:00.000Z");
const LAST_DAY: Date = new Date("2026-11-09T00:00:00.000Z");
const DAY_MS: number = 24 * 60 * 60 * 1000;

function series(): Array<SeriesPoint> {
  return ACTIVE_USERS.map((name: string, place: number): SeriesPoint => {
    return {
      seriesName: name,
      data: [0, 1, 2].map((offset: number): { x: Date; y: number } => {
        return {
          x: new Date(FIRST_DAY.getTime() + offset * DAY_MS),
          y: (place + 1) * 10,
        };
      }),
    };
  });
}

const X_AXIS: XAxis = {
  legend: "Time",
  options: {
    type: XAxisType.Time,
    min: FIRST_DAY,
    max: LAST_DAY,
    aggregateType: XAxisAggregateType.Average,
    precision: XAxisPrecision.EVERY_DAY,
  },
};

const Y_AXIS: YAxis = {
  legend: "",
  options: {
    type: YAxisType.Number,
    min: 0,
    max: "auto",
    precision: YAxisPrecision.NoDecimals,
    formatter: (value: number): string => {
      return String(value);
    },
  },
};

function drawChart(props: {
  growsWhenLegendWraps?: boolean | undefined;
  showLegend?: boolean | undefined;
  heightInPx?: number | undefined;
}): HTMLElement {
  const { container } = render(
    <LineChartElement
      data={series()}
      xAxis={X_AXIS}
      yAxis={Y_AXIS}
      curve={ChartCurve.MONOTONE}
      sync={false}
      syncid=""
      heightInPx={props.heightInPx ?? 176}
      showLegend={props.showLegend ?? true}
      growsWhenLegendWraps={props.growsWhenLegendWraps}
    />,
  );

  return container;
}

// The height the chart's box was given, in px (its inline style).
function chartHeight(container: HTMLElement): string {
  return (container.firstElementChild as HTMLElement).style.height;
}

function resizeWindow(): void {
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

describe("getLegendExtraRowsHeight", () => {
  function legendBox(items: number): HTMLElement {
    const box: HTMLElement = document.createElement("div");
    const list: HTMLElement = document.createElement("ol");

    for (let index: number = 0; index < items; index++) {
      list.appendChild(document.createElement("li"));
    }

    box.appendChild(list);

    return box;
  }

  test("no legend measured yet: nothing to add", () => {
    expect(getLegendExtraRowsHeight(null)).toBe(0);
    expect(getLegendExtraRowsHeight(undefined)).toBe(0);
  });

  test("a legend with no items: nothing to add", () => {
    legendLines = 2;

    expect(getLegendExtraRowsHeight(legendBox(0))).toBe(0);
  });

  test("items on one line: nothing to add", () => {
    legendLines = 1;

    expect(getLegendExtraRowsHeight(legendBox(3))).toBe(0);
  });

  test("items on three lines: the two lines past the first", () => {
    legendLines = 3;

    expect(getLegendExtraRowsHeight(legendBox(3))).toBe(2 * LINE_HEIGHT);
  });

  test("a box shorter than its first item never gives a negative height", () => {
    legendLines = 0;

    expect(getLegendExtraRowsHeight(legendBox(3))).toBe(0);
  });
});

describe("a chart that grows when its legend wraps", () => {
  test("its legend on one line: the height it was given", () => {
    legendLines = 1;

    const container: HTMLElement = drawChart({ growsWhenLegendWraps: true });

    expect(container.querySelectorAll("li")).toHaveLength(3);
    expect(chartHeight(container)).toBe("176px");
  });

  test("its legend on three lines: two lines taller, so the plot keeps its height", () => {
    legendLines = 3;

    const container: HTMLElement = drawChart({ growsWhenLegendWraps: true });

    expect(chartHeight(container)).toBe(`${176 + 2 * LINE_HEIGHT}px`);
  });

  test("its legend on two lines: one line taller", () => {
    legendLines = 2;

    const container: HTMLElement = drawChart({ growsWhenLegendWraps: true });

    expect(chartHeight(container)).toBe(`${176 + LINE_HEIGHT}px`);
  });

  test("grows from the height it was given, whatever that is", () => {
    legendLines = 3;

    const container: HTMLElement = drawChart({
      growsWhenLegendWraps: true,
      heightInPx: 300,
    });

    expect(chartHeight(container)).toBe(`${300 + 2 * LINE_HEIGHT}px`);
  });

  test("a window made wider, so the legend fits one line: back to the height it was given", () => {
    legendLines = 3;

    const container: HTMLElement = drawChart({ growsWhenLegendWraps: true });

    expect(chartHeight(container)).toBe(`${176 + 2 * LINE_HEIGHT}px`);

    legendLines = 2;
    resizeWindow();
    expect(chartHeight(container)).toBe(`${176 + LINE_HEIGHT}px`);

    legendLines = 1;
    resizeWindow();
    expect(chartHeight(container)).toBe("176px");
  });

  test("a window made narrower, so the legend wraps: it grows", () => {
    legendLines = 1;

    const container: HTMLElement = drawChart({ growsWhenLegendWraps: true });

    expect(chartHeight(container)).toBe("176px");

    legendLines = 3;
    resizeWindow();
    expect(chartHeight(container)).toBe(`${176 + 2 * LINE_HEIGHT}px`);
  });

  test("with no legend drawn, nothing to grow by", () => {
    legendLines = 3;

    const container: HTMLElement = drawChart({
      growsWhenLegendWraps: true,
      showLegend: false,
    });

    expect(container.querySelectorAll("li")).toHaveLength(0);
    expect(chartHeight(container)).toBe("176px");
  });
});

describe("every other chart keeps the height it was given", () => {
  test("a legend on three lines comes out of its height, as before (a dashboard widget's box)", () => {
    legendLines = 3;

    const container: HTMLElement = drawChart({});

    expect(container.querySelectorAll("li")).toHaveLength(3);
    expect(chartHeight(container)).toBe("176px");
  });

  test("growsWhenLegendWraps={false} reads as unset", () => {
    legendLines = 3;

    const container: HTMLElement = drawChart({ growsWhenLegendWraps: false });

    expect(chartHeight(container)).toBe("176px");
  });
});

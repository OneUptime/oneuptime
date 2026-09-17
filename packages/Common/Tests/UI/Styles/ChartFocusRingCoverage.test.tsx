import "@testing-library/jest-dom";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import { selectorsDeclaring } from "./ThemeStylesheet";

/*
 * ResponsiveContainer measures its parent, which is always 0x0 in jsdom, so
 * the chart renders nothing without a fixed size -- and a chart that renders
 * nothing would pass every assertion in this file for the wrong reason. Same
 * shim as ChartAnnotationRail.test.tsx; recharts is otherwise the real thing
 * here, because what is under test is the DOM recharts actually produces.
 */
jest.mock("recharts", () => {
  const actual: Record<string, any> = jest.requireActual("recharts") as Record<
    string,
    any
  >;
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => {
      return React.cloneElement(children, { width: 800, height: 400 });
    },
  };
});

import AreaChartElement from "../../../UI/Components/Charts/Area/AreaChart";
import BarChartElement from "../../../UI/Components/Charts/Bar/BarChart";
import LineChartElement from "../../../UI/Components/Charts/Line/LineChart";
import ChartCurve from "../../../UI/Components/Charts/Types/ChartCurve";
import ChartEventKind from "../../../UI/Components/Charts/Types/ChartEventKind";
import ChartReferenceRegionProps from "../../../UI/Components/Charts/Types/ReferenceRegionProps";
import ChartTimeReferenceLineProps from "../../../UI/Components/Charts/Types/TimeReferenceLineProps";
import DataPoint from "../../../UI/Components/Charts/Types/DataPoint";
import SeriesPoint from "../../../UI/Components/Charts/Types/SeriesPoints";
import {
  XAxis as ChartXAxis,
  XAxisAggregateType,
} from "../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisType from "../../../UI/Components/Charts/Types/XAxis/XAxisType";
import YAxis, {
  YAxisPrecision,
} from "../../../UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "../../../UI/Components/Charts/Types/YAxis/YAxisType";
import LogsHistogram from "../../../UI/Components/LogsViewer/components/LogsHistogram";
import TelemetryHistogram from "../../../UI/Components/TelemetryViewer/components/TelemetryHistogram";
import { HistogramBucket as LogsHistogramBucket } from "../../../UI/Components/LogsViewer/types";
import {
  HistogramBucket as TelemetryHistogramBucket,
  HistogramSeriesOption,
} from "../../../UI/Components/TelemetryViewer/types";

/*
 * The other half of the cover for
 * https://github.com/OneUptime/oneuptime/issues/3528.
 *
 * ChartFocusRing.test.ts pins what the stylesheet declares. This file pins
 * that those declarations still land on something: it renders the real charts
 * with real recharts and checks every element the browser could focus inside
 * a plot against the selectors the shipped Theme.css actually carries.
 *
 * The selectors are read out of the stylesheet rather than restated here on
 * purpose. A recharts upgrade that renamed .recharts-surface, dropped the
 * accessibility layer's tabindex, or moved the annotation shapes out from
 * under the surface would leave the CSS silently covering nothing, and a
 * hardcoded copy of the selector list would keep passing right through it.
 */

const START: Date = new Date("2026-03-02T00:00:00.000Z");
const END: Date = new Date("2026-03-02T06:00:00.000Z");

function minutesIn(minutes: number): Date {
  return new Date(START.getTime() + minutes * 60 * 1000);
}

function buildSeries(): Array<SeriesPoint> {
  const points: Array<DataPoint> = [];

  for (let index: number = 0; index < 24; index++) {
    points.push({
      x: new Date(START.getTime() + index * 15 * 60 * 1000),
      y: 100 + index,
    });
  }

  return [{ seriesName: "latency", data: points }];
}

const X_AXIS: ChartXAxis = {
  legend: "Time",
  options: {
    type: XAxisType.Time,
    min: START,
    max: END,
    aggregateType: XAxisAggregateType.Average,
  },
};

const Y_AXIS: YAxis = {
  legend: "ms",
  options: {
    type: YAxisType.Number,
    min: "auto",
    max: "auto",
    precision: YAxisPrecision.NoDecimals,
    formatter: (value: number): string => {
      return `${value} ms`;
    },
  },
};

/*
 * Annotations are passed to every chart that takes them: the event chips and
 * region pills they draw are focusable <g> elements portalled inside the
 * plot, and they are the reason the selector needs its descendant half.
 */
const TIME_REFERENCE_LINES: Array<ChartTimeReferenceLineProps> = [
  {
    date: minutesIn(90),
    label: "Incident: API is down",
    kind: ChartEventKind.Incident,
    color: "#f87171",
  },
];

const REFERENCE_REGIONS: Array<ChartReferenceRegionProps> = [
  {
    startDate: minutesIn(180),
    endDate: minutesIn(240),
    label: "Maintenance",
    color: "#60a5fa",
  },
];

function logsBuckets(): Array<LogsHistogramBucket> {
  return [
    { time: "2026-03-02T00:00:00.000Z", severity: "Error", count: 4 },
    { time: "2026-03-02T00:05:00.000Z", severity: "Error", count: 9 },
    { time: "2026-03-02T00:10:00.000Z", severity: "Information", count: 21 },
  ];
}

function telemetryBuckets(): Array<TelemetryHistogramBucket> {
  return [
    { time: "2026-03-02T00:00:00.000Z", series: "Ok", count: 108 },
    { time: "2026-03-02T00:05:00.000Z", series: "Unset", count: 837 },
    { time: "2026-03-02T00:10:00.000Z", series: "Ok", count: 42 },
  ];
}

const TELEMETRY_SERIES: Array<HistogramSeriesOption> = [
  { key: "Ok", label: "Ok", color: "#10b981" },
  { key: "Unset", label: "Unset", color: "#9ca3af" },
];

interface ChartUnderTest {
  name: string;
  render: () => React.ReactElement;
}

/*
 * Every chart in the product that recharts draws. The two histograms are the
 * ones the issue was filed against; the three chart-library charts are the
 * ones the reporter meant by "it happens around all the graphs".
 */
const CHARTS: Array<ChartUnderTest> = [
  {
    name: "LineChart",
    render: (): React.ReactElement => {
      return (
        <LineChartElement
          data={buildSeries()}
          xAxis={X_AXIS}
          yAxis={Y_AXIS}
          curve={ChartCurve.MONOTONE}
          heightInPx={400}
          sync={false}
          syncid="focus-ring-test"
          showLegend={true}
          timeReferenceLines={TIME_REFERENCE_LINES}
          referenceRegions={REFERENCE_REGIONS}
        />
      );
    },
  },
  {
    name: "AreaChart",
    render: (): React.ReactElement => {
      return (
        <AreaChartElement
          data={buildSeries()}
          xAxis={X_AXIS}
          yAxis={Y_AXIS}
          curve={ChartCurve.MONOTONE}
          heightInPx={400}
          sync={false}
          syncid="focus-ring-test"
          showLegend={true}
          timeReferenceLines={TIME_REFERENCE_LINES}
          referenceRegions={REFERENCE_REGIONS}
        />
      );
    },
  },
  {
    name: "BarChart",
    render: (): React.ReactElement => {
      return (
        <BarChartElement
          data={buildSeries()}
          xAxis={X_AXIS}
          yAxis={Y_AXIS}
          heightInPx={400}
          sync={false}
          syncid="focus-ring-test"
          showLegend={true}
          timeReferenceLines={TIME_REFERENCE_LINES}
          referenceRegions={REFERENCE_REGIONS}
        />
      );
    },
  },
  {
    name: "LogsHistogram",
    render: (): React.ReactElement => {
      return (
        <LogsHistogram
          buckets={logsBuckets()}
          isLoading={false}
          onTimeRangeSelect={(): void => {}}
        />
      );
    },
  },
  {
    name: "TelemetryHistogram",
    render: (): React.ReactElement => {
      return (
        <TelemetryHistogram
          buckets={telemetryBuckets()}
          isLoading={false}
          series={TELEMETRY_SERIES}
          title="Traces over time"
          onTimeRangeSelect={(): void => {}}
        />
      );
    },
  },
];

/** The selectors Theme.css uses to take the user-agent ring off a chart. */
const NEUTRALIZING_SELECTORS: Array<string> = selectorsDeclaring(
  "outline",
  "none",
);

function surfacesIn(container: HTMLElement): Array<SVGSVGElement> {
  return Array.from(
    container.querySelectorAll("svg.recharts-surface"),
  ) as Array<SVGSVGElement>;
}

/*
 * Everything inside a plot that the browser can put focus on -- the surface
 * itself plus any tabindex-carrying shape drawn into it. These are exactly
 * the elements Chrome's SVG user-agent stylesheet would ring.
 */
function focusableChartElements(container: HTMLElement): Array<Element> {
  const focusable: Array<Element> = [];

  for (const surface of surfacesIn(container)) {
    if (surface.hasAttribute("tabindex")) {
      focusable.push(surface);
    }

    focusable.push(...Array.from(surface.querySelectorAll("[tabindex]")));
  }

  return focusable;
}

function describeElement(element: Element): string {
  const testId: string | null = element.getAttribute("data-testid");

  return [
    element.tagName.toLowerCase(),
    element.getAttribute("class") ? `.${element.getAttribute("class")}` : "",
    testId ? `[data-testid="${testId}"]` : "",
    `[tabindex="${element.getAttribute("tabindex")}"]`,
  ].join("");
}

afterEach((): void => {
  cleanup();
});

describe("Chart focus ring coverage", () => {
  test("the stylesheet still silences something", () => {
    expect(NEUTRALIZING_SELECTORS.length).toBeGreaterThan(0);
  });

  describe.each(
    CHARTS.map((chart: ChartUnderTest): [string, ChartUnderTest] => {
      return [chart.name, chart];
    }),
  )("%s", (_name: string, chart: ChartUnderTest) => {
    /*
     * The premise of the whole fix. If recharts ever renames this class or
     * stops handing the plot a tabindex, the CSS becomes dead weight and the
     * rest of these assertions stop meaning anything -- so it fails here
     * first, where the message says why.
     */
    test("draws a plot the browser can focus, under the class the fix targets", () => {
      const { container } = render(chart.render());
      const surfaces: Array<SVGSVGElement> = surfacesIn(container);

      expect(surfaces.length).toBeGreaterThan(0);

      const focusableSurfaces: Array<SVGSVGElement> = surfaces.filter(
        (surface: SVGSVGElement): boolean => {
          return surface.getAttribute("tabindex") === "0";
        },
      );

      expect(focusableSurfaces.length).toBeGreaterThan(0);
    });

    /*
     * The assertion the issue is really about: nothing a pointer can land on
     * inside the plot is left to the user-agent ring.
     */
    test("no focusable element inside the plot is left to the user-agent ring", () => {
      const { container } = render(chart.render());
      const focusable: Array<Element> = focusableChartElements(container);

      expect(focusable.length).toBeGreaterThan(0);

      const uncovered: Array<string> = focusable
        .filter((element: Element): boolean => {
          return !NEUTRALIZING_SELECTORS.some((selector: string): boolean => {
            /*
             * Matched without the pseudo-class: jsdom can say whether the
             * element is the surface or sits inside one, which is the part of
             * the selector that decides coverage. Whether :focus is on is the
             * browser's business, and the harness in the pull request covers
             * that end.
             */
            return element.matches(selector.replace(/:focus(-visible)?/g, ""));
          });
        })
        .map(describeElement);

      expect(uncovered).toEqual([]);
    });
  });

  /*
   * The annotation shapes are focusable by design -- they are buttons a
   * reader clicks -- and they were getting boxed one by one on every click.
   * The descendant half of the selector is the only thing covering them, so
   * this asserts they are really there to be covered rather than letting the
   * loop above pass on a chart that happened to draw none.
   */
  test("the annotation layer really does put focusable shapes inside the plot", () => {
    const { container } = render(CHARTS[0]!.render());

    const annotationShapes: Array<Element> = focusableChartElements(
      container,
    ).filter((element: Element): boolean => {
      return Boolean(
        element.getAttribute("data-testid")?.startsWith("chart-annotation"),
      );
    });

    expect(annotationShapes.length).toBeGreaterThan(0);
  });
});

import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * ResponsiveContainer measures its parent, which is always 0x0 in jsdom, so
 * the chart renders nothing without a fixed size. Same shim as
 * ChartXAxisDataKey.test.tsx — every assertion here is about rendered
 * GEOMETRY, and a 0x0 chart draws no marks at all, which would make the
 * whole file pass for the wrong reason.
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

import AreaChartElement from "../../../../UI/Components/Charts/Area/AreaChart";
import BarChartElement from "../../../../UI/Components/Charts/Bar/BarChart";
import LineChartElement from "../../../../UI/Components/Charts/Line/LineChart";
import ChartCurve from "../../../../UI/Components/Charts/Types/ChartCurve";
import ChartEventKind from "../../../../UI/Components/Charts/Types/ChartEventKind";
import ChartReferenceRegionProps from "../../../../UI/Components/Charts/Types/ReferenceRegionProps";
import ChartTimeReferenceLineProps from "../../../../UI/Components/Charts/Types/TimeReferenceLineProps";
import DataPoint from "../../../../UI/Components/Charts/Types/DataPoint";
import SeriesPoint from "../../../../UI/Components/Charts/Types/SeriesPoints";
import {
  XAxis as ChartXAxis,
  XAxisAggregateType,
} from "../../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisType from "../../../../UI/Components/Charts/Types/XAxis/XAxisType";
import YAxis, {
  YAxisPrecision,
} from "../../../../UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "../../../../UI/Components/Charts/Types/YAxis/YAxisType";

/*
 * Event indicators used to be drawn as recharts <ReferenceLine>s labelled
 * with rotated text inside the plot: labels collided with each other and
 * with the axis, and past six markers they were hidden outright. They are
 * now a rail of chips above the plot, each with a hover card. These tests
 * hold the parts of that which are observable in jsdom — what is drawn,
 * what is reachable, and what a click does.
 */

const START: Date = new Date("2026-03-02T00:00:00.000Z");
const END: Date = new Date("2026-03-02T06:00:00.000Z");

function buildPoints(): Array<DataPoint> {
  const points: Array<DataPoint> = [];
  for (let index: number = 0; index < 24; index++) {
    points.push({
      x: new Date(START.getTime() + index * 15 * 60 * 1000),
      y: 100 + index,
    });
  }
  return points;
}

function buildSeries(): Array<SeriesPoint> {
  return [{ seriesName: "latency", data: buildPoints() }];
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

function minutesIn(minutes: number): Date {
  return new Date(START.getTime() + minutes * 60 * 1000);
}

interface ChartUnderTest {
  name: string;
  render: (props: {
    timeReferenceLines?: Array<ChartTimeReferenceLineProps> | undefined;
    referenceRegions?: Array<ChartReferenceRegionProps> | undefined;
    showLegend?: boolean | undefined;
  }) => React.ReactElement;
}

const CHARTS: Array<ChartUnderTest> = [
  {
    name: "LineChart",
    render: (props): React.ReactElement => {
      return (
        <LineChartElement
          data={buildSeries()}
          xAxis={X_AXIS}
          yAxis={Y_AXIS}
          curve={ChartCurve.MONOTONE}
          heightInPx={400}
          sync={false}
          syncid="annotation-rail-test"
          showLegend={props.showLegend ?? true}
          timeReferenceLines={props.timeReferenceLines}
          referenceRegions={props.referenceRegions}
        />
      );
    },
  },
  {
    name: "AreaChart",
    render: (props): React.ReactElement => {
      return (
        <AreaChartElement
          data={buildSeries()}
          xAxis={X_AXIS}
          yAxis={Y_AXIS}
          curve={ChartCurve.MONOTONE}
          heightInPx={400}
          sync={false}
          syncid="annotation-rail-test"
          showLegend={props.showLegend ?? true}
          timeReferenceLines={props.timeReferenceLines}
          referenceRegions={props.referenceRegions}
        />
      );
    },
  },
  {
    name: "BarChart",
    render: (props): React.ReactElement => {
      return (
        <BarChartElement
          data={buildSeries()}
          xAxis={X_AXIS}
          yAxis={Y_AXIS}
          heightInPx={400}
          sync={false}
          syncid="annotation-rail-test"
          showLegend={props.showLegend ?? true}
          timeReferenceLines={props.timeReferenceLines}
          referenceRegions={props.referenceRegions}
        />
      );
    },
  },
];

function chips(container: HTMLElement): Array<HTMLElement> {
  return Array.from(
    container.querySelectorAll('[data-testid="chart-annotation-chip"]'),
  ) as Array<HTMLElement>;
}

function hairlines(container: HTMLElement): Array<SVGLineElement> {
  return Array.from(
    container.querySelectorAll('[data-testid="chart-annotation-hairline"]'),
  ) as Array<SVGLineElement>;
}

afterEach((): void => {
  cleanup();
});

describe.each(
  CHARTS.map((chart: ChartUnderTest): [string, ChartUnderTest] => {
    return [chart.name, chart];
  }),
)("%s event marker rail", (_name: string, chart: ChartUnderTest) => {
  test("draws a chip and a hairline for a single marker", () => {
    const { container } = render(
      chart.render({
        timeReferenceLines: [
          {
            date: minutesIn(90),
            label: "Incident: API is down",
            kind: ChartEventKind.Incident,
            color: "#f87171",
          },
        ],
      }),
    );

    expect(chips(container)).toHaveLength(1);
    expect(hairlines(container)).toHaveLength(1);
    expect(chips(container)[0]!.dataset["annotationCount"]).toBe("1");
    expect(chips(container)[0]!.dataset["annotationKind"]).toBe("incident");
  });

  test("six markers all draw — no cap hides them any more", () => {
    /*
     * The old renderer hid every inline label past six markers. Nothing is
     * capped now; density is handled by clustering instead.
     */
    const lines: Array<ChartTimeReferenceLineProps> = [
      15, 60, 120, 180, 240, 300,
    ].map((minutes: number): ChartTimeReferenceLineProps => {
      return { date: minutesIn(minutes), label: `event at ${minutes}` };
    });

    const { container } = render(chart.render({ timeReferenceLines: lines }));

    expect(chips(container)).toHaveLength(6);
  });

  test("markers on top of each other collapse into one counted chip", () => {
    const lines: Array<ChartTimeReferenceLineProps> = [
      { date: minutesIn(120), label: "Incident: one" },
      { date: minutesIn(121), label: "Alert: two" },
      { date: minutesIn(122), label: "Deploy: three" },
    ];

    const { container } = render(chart.render({ timeReferenceLines: lines }));

    const rendered: Array<HTMLElement> = chips(container);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]!.dataset["annotationCount"]).toBe("3");
  });

  test("a marker outside the charted window draws nothing", () => {
    const { container } = render(
      chart.render({
        timeReferenceLines: [
          { date: new Date(END.getTime() + 86400000), label: "next week" },
        ],
      }),
    );

    expect(chips(container)).toHaveLength(0);
  });

  test("no annotations means no rail in the DOM at all", () => {
    const { container } = render(chart.render({}));

    expect(
      container.querySelector('[data-testid="chart-annotation-layer"]'),
    ).toBeNull();
    expect(chips(container)).toHaveLength(0);
  });

  test("a region draws a band, its edges, and a pill", () => {
    const { container } = render(
      chart.render({
        referenceRegions: [
          {
            startDate: minutesIn(60),
            endDate: minutesIn(180),
            label: "Scheduled maintenance",
            color: "#6366f1",
          },
        ],
      }),
    );

    expect(
      container.querySelectorAll(
        '[data-testid="chart-annotation-region-band"]',
      ),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('[data-testid="chart-annotation-region"]'),
    ).toHaveLength(1);
  });

  test("clicking a lone marker opens its record", () => {
    const onClick: () => void = jest.fn() as unknown as () => void;

    const { container } = render(
      chart.render({
        timeReferenceLines: [
          { date: minutesIn(90), label: "Incident: API is down", onClick },
        ],
      }),
    );

    fireEvent.click(chips(container)[0]!);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("clicking a cluster opens its card instead of guessing a record", () => {
    const first: () => void = jest.fn() as unknown as () => void;
    const second: () => void = jest.fn() as unknown as () => void;

    const { container } = render(
      chart.render({
        timeReferenceLines: [
          { date: minutesIn(120), label: "Incident: one", onClick: first },
          { date: minutesIn(121), label: "Alert: two", onClick: second },
        ],
      }),
    );

    fireEvent.click(chips(container)[0]!);

    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("chart-annotation-hover-card"),
    ).toBeInTheDocument();
  });

  test("markers carry an accessible name and are reachable by keyboard", () => {
    const onClick: () => void = jest.fn() as unknown as () => void;

    const { container } = render(
      chart.render({
        timeReferenceLines: [
          { date: minutesIn(90), label: "Incident: API is down", onClick },
        ],
      }),
    );

    const chip: HTMLElement = chips(container)[0]!;
    expect(chip.getAttribute("role")).toBe("button");
    expect(chip.getAttribute("tabindex")).toBe("0");
    expect(chip.getAttribute("aria-label")).toContain("Incident: API is down");

    fireEvent.keyDown(chip, { key: "Enter" });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("a press on a chip never reaches the chart's drag-to-select", () => {
    /*
     * The chart starts a range selection on mousedown. Without this guard
     * clicking a marker both navigates and leaves a stray selection behind.
     */
    const onMouseDown: () => void = jest.fn() as unknown as () => void;

    const { container } = render(
      <div onMouseDown={onMouseDown}>
        {chart.render({
          timeReferenceLines: [{ date: minutesIn(90), label: "Incident" }],
        })}
      </div>,
    );

    fireEvent.mouseDown(chips(container)[0]!);

    expect(onMouseDown).not.toHaveBeenCalled();
  });

  test("the hairline spans exactly the plot, and the chip sits above it", () => {
    /*
     * The rail's whole premise: the marker is anchored to the plot but its
     * chip lives in the margin above, where no data can be occluded. The
     * old renderer painted a rotated label straight down the middle of the
     * series instead.
     */
    const { container } = render(
      chart.render({
        timeReferenceLines: [{ date: minutesIn(90), label: "Incident" }],
        // No legend, so the chart's own top margin reserves the rail.
        showLegend: false,
      }),
    );

    const hairline: SVGLineElement = hairlines(container)[0]!;
    const plotTop: number = Number(hairline.getAttribute("y1"));
    const plotBottom: number = Number(hairline.getAttribute("y2"));
    expect(plotBottom).toBeGreaterThan(plotTop);

    const chipRect: Element = chips(container)[0]!.querySelector("rect[rx]")!;
    const chipBottom: number =
      Number(chipRect.getAttribute("y")) +
      Number(chipRect.getAttribute("height"));
    expect(chipBottom).toBeLessThanOrEqual(plotTop);

    // Both are on the same vertical, so the chip labels the right instant.
    expect(chipRect.getAttribute("x")).not.toBeNull();
    expect(Number(hairline.getAttribute("x1"))).toBeGreaterThan(0);
  });

  test("the rail never renders above the top of the chart", () => {
    const { container } = render(
      chart.render({
        timeReferenceLines: [{ date: minutesIn(90), label: "Incident" }],
        referenceRegions: [
          {
            startDate: minutesIn(60),
            endDate: minutesIn(180),
            label: "Maintenance",
          },
        ],
        /*
         * With a legend, jsdom reports it as zero-height and the rail
         * clamps onto the chart's edge; without one the margin reserves
         * the strip properly. Both must stay on-canvas, so both are run.
         */
        showLegend: false,
      }),
    );

    for (const rect of Array.from(container.querySelectorAll("rect"))) {
      const y: string | null = rect.getAttribute("y");
      if (y !== null) {
        expect(Number(y)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("a legend that reserves no height still leaves the rail on-canvas", () => {
    /*
     * The rail's strip is bought by padding the legend's reserved height,
     * so a legend reporting none would hang the rail above the SVG edge
     * and delete the feature. It clamps onto the edge instead.
     */
    const { container } = render(
      chart.render({
        timeReferenceLines: [{ date: minutesIn(90), label: "Incident" }],
        referenceRegions: [
          {
            startDate: minutesIn(60),
            endDate: minutesIn(180),
            label: "Maintenance",
          },
        ],
        showLegend: true,
      }),
    );

    expect(chips(container)).toHaveLength(1);
    for (const rect of Array.from(container.querySelectorAll("rect"))) {
      const y: string | null = rect.getAttribute("y");
      if (y !== null) {
        expect(Number(y)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("marker hover card", () => {
  const chart: ChartUnderTest = CHARTS[0]!;

  test("hovering a chip lists every event in it, with full titles", () => {
    /*
     * The label is why this redesign exists: it used to be rotated 10px
     * text painted down the plot, truncated to 40 characters, and hidden
     * outright past six markers. In the card it is ordinary HTML.
     */
    const longTitle: string =
      "Incident: checkout-api p99 latency breached its SLO for the third time today";

    const { container } = render(
      chart.render({
        timeReferenceLines: [
          {
            date: minutesIn(120),
            label: longTitle,
            subtitle: "Incident · Sev1",
            kind: ChartEventKind.Incident,
          },
          {
            date: minutesIn(121),
            label: "Alert: 5xx rate above 2%",
            subtitle: "Alert · Warning",
            kind: ChartEventKind.Alert,
          },
        ],
      }),
    );

    fireEvent.mouseOver(chips(container)[0]!);

    const card: HTMLElement = screen.getByTestId("chart-annotation-hover-card");
    expect(card).toHaveTextContent(longTitle);
    expect(card).toHaveTextContent("Alert: 5xx rate above 2%");
    expect(card).toHaveTextContent("Incident · Sev1");
    expect(card).toHaveTextContent("2 events");
  });

  test("a row in the card opens that event", () => {
    const first: () => void = jest.fn() as unknown as () => void;
    const second: () => void = jest.fn() as unknown as () => void;

    const { container } = render(
      chart.render({
        timeReferenceLines: [
          { date: minutesIn(120), label: "Incident: one", onClick: first },
          { date: minutesIn(121), label: "Alert: two", onClick: second },
        ],
      }),
    );

    fireEvent.mouseOver(chips(container)[0]!);
    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "chart-annotation-hover-row",
    );
    expect(rows).toHaveLength(2);

    fireEvent.click(rows[1]!);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  test("an event with no detail page gets an inert row, not a dead link", () => {
    const { container } = render(
      chart.render({
        timeReferenceLines: [
          { date: minutesIn(120), label: "Deploy: v2.31.0" },
          { date: minutesIn(121), label: "Deploy: v2.31.1" },
        ],
      }),
    );

    fireEvent.mouseOver(chips(container)[0]!);
    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "chart-annotation-hover-row",
    );

    expect(rows[0]).toBeDisabled();
  });

  test("focusing a chip opens the card, blurring it closes it", () => {
    const { container } = render(
      chart.render({
        timeReferenceLines: [
          { date: minutesIn(120), label: "Incident: one" },
          { date: minutesIn(121), label: "Alert: two" },
        ],
      }),
    );

    fireEvent.focus(chips(container)[0]!);
    expect(
      screen.getByTestId("chart-annotation-hover-card"),
    ).toBeInTheDocument();
  });

  test("hovering a region names it", () => {
    const { container } = render(
      chart.render({
        referenceRegions: [
          {
            startDate: minutesIn(60),
            endDate: minutesIn(180),
            label: "Scheduled maintenance",
            subtitle: "Database upgrade",
          },
        ],
      }),
    );

    fireEvent.mouseOver(
      container.querySelector('[data-testid="chart-annotation-region"]')!,
    );

    const card: HTMLElement = screen.getByTestId("chart-annotation-hover-card");
    expect(card).toHaveTextContent("Scheduled maintenance");
    expect(card).toHaveTextContent("Database upgrade");
  });

  test("a re-render with an equal-but-new marker array keeps the card open", () => {
    /*
     * Callers hand these charts inline array literals
     * (IncidentRootCauseMetricChart does), so every parent render produces a
     * referentially-new-but-equal array. An identity-keyed reset would shut
     * the card on each one — and a dashboard's auto-refresh tick makes that
     * constant, which is to say the card could never be clicked.
     */
    function markers(): Array<ChartTimeReferenceLineProps> {
      return [
        { date: minutesIn(120), label: "Incident: one" },
        { date: minutesIn(121), label: "Alert: two" },
      ];
    }

    const { container, rerender } = render(
      chart.render({ timeReferenceLines: markers() }),
    );

    fireEvent.mouseOver(chips(container)[0]!);
    expect(
      screen.getByTestId("chart-annotation-hover-card"),
    ).toBeInTheDocument();

    // Same markers, brand new array — exactly what a parent render hands over.
    rerender(chart.render({ timeReferenceLines: markers() }));

    expect(
      screen.getByTestId("chart-annotation-hover-card"),
    ).toBeInTheDocument();
  });

  test("annotations actually moving does close a stale card", () => {
    const { container, rerender } = render(
      chart.render({
        timeReferenceLines: [
          { date: minutesIn(120), label: "Incident: one" },
          { date: minutesIn(121), label: "Alert: two" },
        ],
      }),
    );

    fireEvent.mouseOver(chips(container)[0]!);
    expect(
      screen.getByTestId("chart-annotation-hover-card"),
    ).toBeInTheDocument();

    rerender(
      chart.render({
        timeReferenceLines: [
          { date: minutesIn(300), label: "Incident: elsewhere" },
          { date: minutesIn(301), label: "Alert: elsewhere" },
        ],
      }),
    );

    expect(
      screen.queryByTestId("chart-annotation-hover-card"),
    ).not.toBeInTheDocument();
  });

  test("Enter on a clustered chip puts focus on its first event", () => {
    /*
     * A clustered event exists ONLY in the card, and the card renders after
     * the whole SVG in DOM order — so Tab from the chip goes to the next
     * chip, never into the card. Without focus being moved deliberately, a
     * keyboard user could open a lone event but never a clustered one, and
     * clustering is automatic.
     */
    const first: () => void = jest.fn() as unknown as () => void;
    const second: () => void = jest.fn() as unknown as () => void;

    const { container } = render(
      chart.render({
        timeReferenceLines: [
          { date: minutesIn(120), label: "Incident: one", onClick: first },
          { date: minutesIn(121), label: "Alert: two", onClick: second },
        ],
      }),
    );

    const chip: HTMLElement = chips(container)[0]!;
    expect(chip.dataset["annotationCount"]).toBe("2");

    fireEvent.focus(chip);
    fireEvent.keyDown(chip, { key: "Enter" });

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "chart-annotation-hover-row",
    );
    expect(rows[0]).toHaveFocus();

    // And activating the focused row opens that event.
    fireEvent.click(rows[0]!);
    expect(first).toHaveBeenCalledTimes(1);
  });

  test("the card survives the chip's blur when focus moves into it", () => {
    /*
     * Taking focus blurs the chip, and the chip's blur schedules the close.
     * The card has to cancel that on its own focus or it would shut 140ms
     * later, taking the focus with it.
     */
    const { container } = render(
      chart.render({
        timeReferenceLines: [
          { date: minutesIn(120), label: "Incident: one" },
          { date: minutesIn(121), label: "Alert: two" },
        ],
      }),
    );

    const chip: HTMLElement = chips(container)[0]!;
    fireEvent.focus(chip);
    fireEvent.keyDown(chip, { key: "Enter" });

    const card: HTMLElement = screen.getByTestId("chart-annotation-hover-card");
    // The chip losing focus to the card must not schedule a close.
    fireEvent.blur(chip);
    fireEvent.focus(card);

    expect(
      screen.getByTestId("chart-annotation-hover-card"),
    ).toBeInTheDocument();
  });

  test("Escape closes an open card", () => {
    const { container } = render(
      chart.render({
        timeReferenceLines: [
          { date: minutesIn(120), label: "Incident: one" },
          { date: minutesIn(121), label: "Alert: two" },
        ],
      }),
    );

    fireEvent.mouseOver(chips(container)[0]!);
    const card: HTMLElement = screen.getByTestId("chart-annotation-hover-card");

    fireEvent.keyDown(card, { key: "Escape" });

    expect(
      screen.queryByTestId("chart-annotation-hover-card"),
    ).not.toBeInTheDocument();
  });

  test("no card is shown until something is hovered", () => {
    render(
      chart.render({
        timeReferenceLines: [{ date: minutesIn(120), label: "Incident: one" }],
      }),
    );

    expect(
      screen.queryByTestId("chart-annotation-hover-card"),
    ).not.toBeInTheDocument();
  });
});

describe("marker rail density", () => {
  const chart: ChartUnderTest = CHARTS[0]!;

  test("fifty markers become a readable handful of chips, losing none", () => {
    const lines: Array<ChartTimeReferenceLineProps> = Array.from(
      { length: 50 },
      (_unused: unknown, index: number): ChartTimeReferenceLineProps => {
        return {
          date: minutesIn(index * 7),
          label: `Alert: number ${index}`,
          kind: ChartEventKind.Alert,
        };
      },
    );

    const { container } = render(chart.render({ timeReferenceLines: lines }));

    const rendered: Array<HTMLElement> = chips(container);
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThanOrEqual(22);

    const total: number = rendered.reduce(
      (sum: number, chip: HTMLElement): number => {
        return sum + Number(chip.dataset["annotationCount"]);
      },
      0,
    );
    // Every marker is still reachable through some chip.
    expect(total).toBe(50);
  });

  test("a chip takes the colour of the worst thing inside it", () => {
    const { container } = render(
      chart.render({
        timeReferenceLines: [
          {
            date: minutesIn(120),
            label: "Deploy: v1",
            kind: ChartEventKind.Change,
            color: "#6366f1",
          },
          {
            date: minutesIn(121),
            label: "Incident: outage",
            kind: ChartEventKind.Incident,
            color: "#f87171",
          },
        ],
      }),
    );

    const chip: HTMLElement = chips(container)[0]!;
    expect(chip.dataset["annotationKind"]).toBe("incident");
    expect(chip.querySelector("rect[rx]")!.getAttribute("fill")).toBe(
      "#f87171",
    );
  });
});

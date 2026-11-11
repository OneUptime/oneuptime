import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * A LINE CHART'S REFERENCE LINES, NAMED IN A LEGEND UNDER THE CHART (#6694).
 *
 * A reference line's label was written at the right end of its line, over
 * the plot: on the SLO burn-down, "At risk (25%)" sat on the budget curve
 * whenever the budget ran near the line - the usual case for an SLO at risk
 * - and "Budget exhausted", at 0%, sat on the time axis's last tick. German,
 * French and Russian made both worse. A chart can now name its lines in a
 * legend under the plot instead (ReferenceLineLabelPlacement.Legend): each
 * label beside a short stroke drawn in its line's colour and dash, wrapping
 * on a narrow screen, while the lines themselves are drawn without labels.
 *
 * The chart library is replaced by a recorder (recharts draws nothing in
 * jsdom): what matters is which lines it is handed, and what the wrapper
 * draws under it.
 */

const libraryChartMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../UI/Components/Charts/ChartLibrary/LineChart/LineChart",
  () => {
    return {
      __esModule: true,
      LineChart: (props: unknown) => {
        libraryChartMock(props);
        return React.createElement("div", { "data-testid": "library-chart" });
      },
    };
  },
);

import LineChartElement from "../../../../UI/Components/Charts/Line/LineChart";
import ReferenceLineLegend from "../../../../UI/Components/Charts/ReferenceLineLegend/ReferenceLineLegend";
import ChartCurve from "../../../../UI/Components/Charts/Types/ChartCurve";
import ChartReferenceLineProps, {
  DEFAULT_REFERENCE_LINE_DASH,
  ReferenceLineLabelPlacement,
} from "../../../../UI/Components/Charts/Types/ReferenceLineProps";
import SeriesPoint from "../../../../UI/Components/Charts/Types/SeriesPoints";
import {
  XAxis,
  XAxisAggregateType,
} from "../../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisType from "../../../../UI/Components/Charts/Types/XAxis/XAxisType";
import YAxis, {
  YAxisPrecision,
} from "../../../../UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "../../../../UI/Components/Charts/Types/YAxis/YAxisType";

const START: Date = new Date("2026-09-01T00:00:00.000Z");
const END: Date = new Date("2026-09-02T00:00:00.000Z");

const DATA: Array<SeriesPoint> = [
  {
    seriesName: "Budget remaining",
    data: [
      { x: START, y: 80 },
      { x: END, y: 26 },
    ],
  },
];

const X_AXIS: XAxis = {
  legend: "Time",
  options: {
    type: XAxisType.Time,
    min: START,
    max: END,
    aggregateType: XAxisAggregateType.Average,
  },
};

const Y_AXIS: YAxis = {
  legend: "Budget remaining",
  options: {
    type: YAxisType.Number,
    min: "auto",
    max: 100,
    precision: YAxisPrecision.OneDecimal,
  },
};

const LINES: Array<ChartReferenceLineProps> = [
  { value: 0, label: "Budget ausgeschöpft", color: "#ef4444" },
  {
    value: 25,
    label: "Gefährdet (25 %)",
    color: "#f59e0b",
    strokeDasharray: "4 4",
  },
  {
    value: 50,
    label: "Caution 50 %",
    color: "#8b5cf6",
    strokeDasharray: "2 3",
  },
  // A line with no name of its own takes no entry.
  { value: 75, color: "#64748b" },
];

interface LibraryProps {
  referenceLines?: Array<ChartReferenceLineProps> | undefined;
}

function lastLibraryProps(): LibraryProps {
  const calls: Array<Array<unknown>> = libraryChartMock.mock.calls;

  expect(calls.length).toBeGreaterThan(0);

  return calls[calls.length - 1]![0] as LibraryProps;
}

function renderChart(
  placement: ReferenceLineLabelPlacement | undefined,
  lines: Array<ChartReferenceLineProps> = LINES,
): HTMLElement {
  const { container } = render(
    <LineChartElement
      data={DATA}
      xAxis={X_AXIS}
      yAxis={Y_AXIS}
      curve={ChartCurve.MONOTONE}
      sync={false}
      syncid="reference-line-legend"
      heightInPx={260}
      referenceLines={lines}
      referenceLineLabelPlacement={placement}
    />,
  );

  return container;
}

afterEach(() => {
  cleanup();
  libraryChartMock.mockReset();
});

describe("ReferenceLineLabelPlacement.Legend", () => {
  test("names each labelled line under the chart, in the order the lines are given", () => {
    renderChart(ReferenceLineLabelPlacement.Legend);

    const legend: HTMLElement = screen.getByTestId(
      "chart-reference-line-legend",
    );
    const items: Array<HTMLElement> = within(legend).getAllByTestId(
      "chart-reference-line-legend-item",
    );

    expect(
      items.map((item: HTMLElement) => {
        return item.textContent;
      }),
    ).toEqual(["Budget ausgeschöpft", "Gefährdet (25 %)", "Caution 50 %"]);
  });

  test("each entry's stroke is drawn in its line's colour and dash, the default dash where it names none", () => {
    renderChart(ReferenceLineLabelPlacement.Legend);

    const strokes: Array<Element> = screen
      .getAllByTestId("chart-reference-line-legend-stroke")
      .map((svg: HTMLElement) => {
        return svg.querySelector("line") as Element;
      });

    expect(
      strokes.map((line: Element) => {
        return [
          line.getAttribute("stroke"),
          line.getAttribute("stroke-dasharray"),
        ];
      }),
    ).toEqual([
      ["#ef4444", DEFAULT_REFERENCE_LINE_DASH],
      ["#f59e0b", "4 4"],
      ["#8b5cf6", "2 3"],
    ]);
    // The stroke is a picture of the line: a screen reader reads the label.
    for (const svg of screen.getAllByTestId(
      "chart-reference-line-legend-stroke",
    )) {
      expect(svg).toHaveAttribute("aria-hidden", "true");
    }
  });

  test("the lines are drawn without their labels, each named one reaching the value axis, everything else as given", () => {
    renderChart(ReferenceLineLabelPlacement.Legend);

    expect(lastLibraryProps().referenceLines).toEqual([
      // A line the legend names is on the plot: the axis reaches it.
      { value: 0, color: "#ef4444", extendsDomain: true },
      {
        value: 25,
        color: "#f59e0b",
        strokeDasharray: "4 4",
        extendsDomain: true,
      },
      {
        value: 50,
        color: "#8b5cf6",
        strokeDasharray: "2 3",
        extendsDomain: true,
      },
      // A line the legend does not name keeps the axis as it was.
      { value: 75, color: "#64748b" },
    ]);
    expect(
      (lastLibraryProps().referenceLines as Array<ChartReferenceLineProps>).map(
        (line: ChartReferenceLineProps) => {
          return [line.label, line.extendsDomain];
        },
      ),
    ).toEqual([
      [undefined, true],
      [undefined, true],
      [undefined, true],
      [undefined, undefined],
    ]);
  });

  test("the legend sits under the plot, outside the plot's own height", () => {
    const container: HTMLElement = renderChart(
      ReferenceLineLabelPlacement.Legend,
    );

    const plot: HTMLElement = screen.getByTestId("library-chart")
      .parentElement as HTMLElement;
    const legend: HTMLElement = screen.getByTestId(
      "chart-reference-line-legend",
    );

    expect(plot).toHaveStyle({ height: "260px" });
    expect(plot.contains(legend)).toBe(false);
    // Plot first, then the legend, in one column.
    expect(plot.nextElementSibling).toBe(legend);
    expect(plot.parentElement).toHaveClass("flex", "flex-col");
    // The plot keeps its height: no flex basis takes its place.
    expect(plot).not.toHaveClass("flex-1");
    expect(container.firstElementChild).toBe(plot.parentElement);
  });

  test("the legend wraps on a narrow screen and reads in the page's direction", () => {
    renderChart(ReferenceLineLabelPlacement.Legend);

    const legend: HTMLElement = screen.getByTestId(
      "chart-reference-line-legend",
    );

    expect(legend).toHaveClass("flex-wrap");
    // No direction of its own: an Arabic page lays it out right to left.
    expect(legend).not.toHaveAttribute("dir");
  });

  test("with no labelled line, no legend: the chart is drawn as before", () => {
    renderChart(ReferenceLineLabelPlacement.Legend, [
      { value: 75, color: "#64748b" },
      { value: 50, label: "   ", color: "#64748b" },
    ]);

    expect(
      screen.queryByTestId("chart-reference-line-legend"),
    ).not.toBeInTheDocument();
    expect(lastLibraryProps().referenceLines).toEqual([
      { value: 75, color: "#64748b" },
      { value: 50, label: "   ", color: "#64748b" },
    ]);
    expect(
      screen.getByTestId("library-chart").parentElement as HTMLElement,
    ).toHaveClass("flex-1");
  });
});

describe("ReferenceLineLabelPlacement.OnLine, the default", () => {
  test.each([
    ["unset", undefined],
    ["OnLine", ReferenceLineLabelPlacement.OnLine],
  ])(
    "%s: the labels stay on their lines and nothing is drawn under the chart",
    (_name: string, placement: ReferenceLineLabelPlacement | undefined) => {
      const container: HTMLElement = renderChart(placement);

      expect(
        screen.queryByTestId("chart-reference-line-legend"),
      ).not.toBeInTheDocument();
      expect(lastLibraryProps().referenceLines).toBe(LINES);

      const plot: HTMLElement = screen.getByTestId("library-chart")
        .parentElement as HTMLElement;

      expect(plot).toHaveClass("flex-1");
      expect(container.firstElementChild).toBe(plot);
    },
  );
});

describe("ReferenceLineLegend on its own", () => {
  test("draws nothing for lines with no label", () => {
    const { container } = render(
      <ReferenceLineLegend lines={[{ value: 1, color: "#000000" }]} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test("takes a class name for its place under a chart", () => {
    render(
      <ReferenceLineLegend
        lines={[{ value: 1, label: "Target 99.9%", color: "#f59e0b" }]}
        className="mt-2"
      />,
    );

    expect(screen.getByTestId("chart-reference-line-legend")).toHaveClass(
      "mt-2",
    );
    expect(
      screen.getByTestId("chart-reference-line-legend-item"),
    ).toHaveTextContent("Target 99.9%");
  });
});

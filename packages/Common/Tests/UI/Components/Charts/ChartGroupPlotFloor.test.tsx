import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * The chart elements measure their parent, which jsdom cannot do; the
 * layout around them is what is under test here, so they are stubbed.
 */
jest.mock("../../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return React.createElement("div", { "data-testid": "line-chart" });
    },
  };
});

import ChartGroup, {
  ChartType,
} from "../../../../UI/Components/Charts/ChartGroup/ChartGroup";
import { ComponentProps as LineChartProps } from "../../../../UI/Components/Charts/Line/LineChart";

const chartProps: LineChartProps = {} as unknown as LineChartProps;

// Any Tailwind min-height class other than the zero reset.
const MIN_HEIGHT_FLOOR: RegExp = /(?:^|\s)min-h-(?!0(?:\s|$))/;

afterEach(() => {
  cleanup();
});

describe("ChartGroup plot floor", () => {
  test("a host that opts in keeps a minimum plot height above its series controls", () => {
    render(
      <ChartGroup
        hideCard={true}
        minPlotHeight={true}
        charts={[
          {
            id: "response-time",
            title: "Response Time",
            type: ChartType.LINE,
            props: chartProps,
            seriesControls: <div data-testid="series-controls" />,
          },
        ]}
      />,
    );

    const plot: HTMLElement = screen.getByTestId("chart-group-plot");

    /*
     * Without the floor the series controls under the plot took its
     * height, which left a few pixels of chart in a narrow column.
     */
    expect(plot).toHaveClass("min-h-48", "flex-1", "flex");
    expect(plot).not.toHaveClass("min-h-0");
    expect(plot).toContainElement(screen.getByTestId("line-chart"));

    // The controls stay outside the plot, so they add height instead.
    expect(plot).not.toContainElement(screen.getByTestId("series-controls"));
    expect(
      plot.compareDocumentPosition(screen.getByTestId("series-controls")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("by default the plot has no floor, so it shrinks to fit a fixed-height widget", () => {
    /*
     * A dashboard widget is a fixed height and clips what overflows it. A
     * floor there pushed the series controls (the chart's only legend) and
     * then the x-axis out of the widget, which is why the floor is opt-in.
     */
    render(
      <ChartGroup
        hideCard={true}
        charts={[
          {
            id: "a",
            title: "A",
            type: ChartType.LINE,
            props: chartProps,
            seriesControls: <div data-testid="series-controls" />,
          },
        ]}
      />,
    );

    const plot: HTMLElement = screen.getByTestId("chart-group-plot");

    expect(plot).toHaveClass("min-h-0", "flex-1", "flex");
    expect(plot).not.toHaveClass("min-h-48");
    expect(plot.className).not.toMatch(MIN_HEIGHT_FLOOR);
    expect(plot).toContainElement(screen.getByTestId("line-chart"));
    expect(plot).not.toContainElement(screen.getByTestId("series-controls"));
  });

  test("minPlotHeight={false} is the same as leaving it off", () => {
    render(
      <ChartGroup
        hideCard={true}
        minPlotHeight={false}
        charts={[
          {
            id: "a",
            title: "A",
            type: ChartType.LINE,
            props: chartProps,
          },
        ]}
      />,
    );

    const plot: HTMLElement = screen.getByTestId("chart-group-plot");

    expect(plot).toHaveClass("min-h-0");
    expect(plot.className).not.toMatch(MIN_HEIGHT_FLOOR);
  });

  test("every chart in the stack gets its own floor when the host opts in", () => {
    render(
      <ChartGroup
        hideCard={true}
        minPlotHeight={true}
        charts={[
          {
            id: "a",
            title: "A",
            type: ChartType.LINE,
            props: chartProps,
          },
          {
            id: "b",
            title: "B",
            type: ChartType.LINE,
            props: chartProps,
          },
        ]}
      />,
    );

    const plots: Array<HTMLElement> = screen.getAllByTestId("chart-group-plot");

    expect(plots).toHaveLength(2);

    for (const plot of plots) {
      expect(plot).toHaveClass("min-h-48");
    }
  });

  test("the card layout is unchanged", () => {
    render(
      <ChartGroup
        minPlotHeight={true}
        charts={[
          {
            id: "a",
            title: "A",
            type: ChartType.LINE,
            props: chartProps,
          },
        ]}
      />,
    );

    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("chart-group-plot")).not.toBeInTheDocument();
  });
});

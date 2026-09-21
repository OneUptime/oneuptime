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

afterEach(() => {
  cleanup();
});

describe("ChartGroup plot floor", () => {
  test("a chart without its card keeps a minimum plot height above its series controls", () => {
    render(
      <ChartGroup
        hideCard={true}
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
    expect(plot).toContainElement(screen.getByTestId("line-chart"));

    // The controls stay outside the plot, so they add height instead.
    expect(plot).not.toContainElement(screen.getByTestId("series-controls"));
    expect(
      plot.compareDocumentPosition(screen.getByTestId("series-controls")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("every chart in the stack gets its own floor", () => {
    render(
      <ChartGroup
        hideCard={true}
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

    expect(screen.getAllByTestId("chart-group-plot")).toHaveLength(2);
  });

  test("the card layout is unchanged", () => {
    render(
      <ChartGroup
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

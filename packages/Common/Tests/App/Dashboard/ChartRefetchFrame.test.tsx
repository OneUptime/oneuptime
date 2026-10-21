import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import ChartRefetchFrame, {
  CHART_LOADING_SKELETON_TEST_ID,
  CHART_REFETCHING_TEST_ID,
  ChartLoadingSkeleton,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/ChartRefetchFrame";

/*
 * The loading states of a self-loading chart (issue #4105 review: a drag or
 * a double-click on a rate chart reloads it, and swapping it for a short
 * skeleton moved the page under the pointer). Only the first load is a
 * skeleton, at the chart's height; later loads keep the chart, dimmed and
 * marked, and a failed one keeps it with the error above.
 */

afterEach(() => {
  cleanup();
});

// A chart that counts its own mounts, to tell a remount from a re-render.
let mounts: number = 0;

const CountingChart: React.FunctionComponent = (): React.ReactElement => {
  React.useEffect(() => {
    mounts += 1;
  }, []);
  return <div data-testid="counting-chart">chart</div>;
};

function frame(
  isRefetching: boolean,
  refetchError?: string,
): React.ReactElement {
  return (
    <ChartRefetchFrame
      isRefetching={isRefetching}
      {...(refetchError !== undefined ? { refetchError: refetchError } : {})}
    >
      <CountingChart />
    </ChartRefetchFrame>
  );
}

describe("ChartLoadingSkeleton", () => {
  test("holds the height the chart will be drawn at", () => {
    render(<ChartLoadingSkeleton heightInPx={220} />);

    const skeleton: HTMLElement = screen.getByTestId(
      CHART_LOADING_SKELETON_TEST_ID,
    );
    expect(skeleton).toHaveStyle({ height: "220px" });
    expect(skeleton).toHaveClass("animate-pulse");
    // No fixed-height class to fight the chart's own height.
    expect(skeleton.className).not.toMatch(/\bh-\d/);
  });

  test("follows whatever height it is given", () => {
    render(<ChartLoadingSkeleton heightInPx={300} />);

    expect(screen.getByTestId(CHART_LOADING_SKELETON_TEST_ID)).toHaveStyle({
      height: "300px",
    });
  });
});

describe("ChartRefetchFrame", () => {
  test("idle: the chart as it is, no marker, not dimmed, no error", () => {
    render(frame(false));

    const chart: HTMLElement = screen.getByTestId("counting-chart");
    expect(chart).toBeInTheDocument();
    expect(screen.queryByTestId(CHART_REFETCHING_TEST_ID)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(chart.parentElement).not.toHaveClass("opacity-75");
    expect(chart.parentElement?.parentElement).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });

  test("while a load is in flight the chart stays, dimmed, marked Refreshing", () => {
    render(frame(true));

    const chart: HTMLElement = screen.getByTestId("counting-chart");
    expect(chart).toBeInTheDocument();
    expect(chart.parentElement).toHaveClass("opacity-75");
    expect(chart.parentElement?.parentElement).toHaveAttribute(
      "aria-busy",
      "true",
    );
    const marker: HTMLElement = screen.getByTestId(CHART_REFETCHING_TEST_ID);
    expect(marker).toHaveTextContent("Refreshing");
    // The marker never takes the pointer: a drag over it still reaches the chart.
    expect(marker).toHaveClass("pointer-events-none");
  });

  test("a failed load shows its error above the chart, and the chart stays", () => {
    render(frame(false, "The metrics service is unavailable."));

    const alert: HTMLElement = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "Couldn't refresh — showing previously loaded data. The metrics service is unavailable.",
    );
    expect(screen.getByTestId("counting-chart")).toBeInTheDocument();
    // The error comes first, the chart after it.
    expect(
      alert.compareDocumentPosition(screen.getByTestId("counting-chart")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("an empty error string shows no error", () => {
    render(frame(false, ""));

    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a retry keeps the error up while it is in flight", () => {
    render(frame(true, "Timed out."));

    expect(screen.getByRole("alert")).toHaveTextContent("Timed out.");
    expect(screen.getByTestId(CHART_REFETCHING_TEST_ID)).toBeInTheDocument();
  });

  test("going in and out of a reload, and through an error, never remounts the chart", () => {
    mounts = 0;
    const { rerender } = render(frame(false));
    const chart: HTMLElement = screen.getByTestId("counting-chart");

    rerender(frame(true));
    rerender(frame(false, "Timed out."));
    rerender(frame(true, "Timed out."));
    rerender(frame(false));

    expect(screen.getByTestId("counting-chart")).toBe(chart);
    expect(mounts).toBe(1);
  });
});

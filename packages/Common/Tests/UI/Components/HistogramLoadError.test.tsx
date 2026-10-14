/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The explorers' charts when their read did not come back (issue #4707).
 *
 * A histogram whose read was stopped at the query time limit used to vanish
 * — the Log Volume card rendered nothing, as for a window with no logs — so a
 * reader could not tell "nothing happened" from "we could not tell". The
 * card now stays, says why where the bars go, and offers Try again:
 *
 *   - LogsHistogram (the logs explorer's Log Volume);
 *   - TelemetryHistogram (the traces and exceptions explorers' charts),
 *     which keeps its title and header controls too.
 */
jest.mock("recharts", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    BarChart: (props: { children?: React.ReactNode }) => {
      return react.createElement(
        "div",
        { "data-testid": "bar-chart" },
        props.children,
      );
    },
    Bar: nothing,
    XAxis: nothing,
    YAxis: nothing,
    CartesianGrid: nothing,
    Tooltip: nothing,
    ReferenceArea: nothing,
  };
});

import LogsHistogram from "../../../UI/Components/LogsViewer/components/LogsHistogram";
import TelemetryHistogram from "../../../UI/Components/TelemetryViewer/components/TelemetryHistogram";
import { HistogramSeriesOption } from "../../../UI/Components/TelemetryViewer/types";
import {
  TELEMETRY_LOAD_ERROR_RETRY_TEST_ID,
  TELEMETRY_LOAD_ERROR_TEST_ID,
} from "../../../UI/Components/TelemetryViewer/components/TelemetryLoadErrorMessage";
import {
  TelemetryLoadError,
  TelemetryLoadErrorKind,
} from "../../../UI/Utils/Telemetry/TelemetryLoadError";

const TIMED_OUT: TelemetryLoadError = {
  kind: TelemetryLoadErrorKind.TimedOut,
  message:
    "This query took longer than 45 seconds and was stopped before it finished. Try a shorter time range or more specific filters.",
};

const FAILED: TelemetryLoadError = {
  kind: TelemetryLoadErrorKind.Failed,
  message: "Invalid attribute key: http.route!",
};

const SERIES: Array<HistogramSeriesOption> = [
  { key: "ok", label: "Ok", color: "#10b981" },
  { key: "error", label: "Error", color: "#ef4444" },
];

function message(): HTMLElement {
  return screen.getByTestId(TELEMETRY_LOAD_ERROR_TEST_ID);
}

afterEach(() => {
  cleanup();
});

describe("LogsHistogram (Log Volume)", () => {
  test("REGRESSION: a chart that took too long keeps its card and says so, instead of vanishing", () => {
    const { container } = render(
      <LogsHistogram buckets={[]} isLoading={false} error={TIMED_OUT} />,
    );

    expect(container.innerHTML).not.toBe("");
    expect(screen.getByText("Log Volume")).toBeInTheDocument();
    expect(message()).toHaveTextContent("This chart took too long to load");
    expect(message()).toHaveTextContent(
      "It was stopped before it finished. Try a shorter time range or more specific filters.",
    );
    expect(screen.queryByTestId("bar-chart")).not.toBeInTheDocument();
  });

  test("any other failure says the chart could not load, in the server's words", () => {
    render(<LogsHistogram buckets={[]} isLoading={false} error={FAILED} />);

    expect(message()).toHaveTextContent("This chart could not load");
    expect(message()).toHaveTextContent("Invalid attribute key: http.route!");
  });

  test("Try again runs the chart's read again, once", () => {
    const onRetry: MockFunction = getJestMockFunction();

    render(
      <LogsHistogram
        buckets={[]}
        isLoading={false}
        error={TIMED_OUT}
        onRetry={() => {
          onRetry();
        }}
      />,
    );

    fireEvent.click(
      within(message()).getByTestId(TELEMETRY_LOAD_ERROR_RETRY_TEST_ID),
    );

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("while it loads again, the loader stands in for the message", () => {
    render(<LogsHistogram buckets={[]} isLoading={true} error={TIMED_OUT} />);

    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    expect(
      screen.queryByTestId(TELEMETRY_LOAD_ERROR_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("a window with no logs and no failure still renders nothing", () => {
    const { container } = render(
      <LogsHistogram buckets={[]} isLoading={false} />,
    );

    expect(container.innerHTML).toBe("");
  });
});

describe("TelemetryHistogram (the traces and exceptions charts)", () => {
  test("REGRESSION: a chart that took too long keeps its card, title and header controls, and says so", () => {
    render(
      <TelemetryHistogram
        buckets={[]}
        isLoading={false}
        series={SERIES}
        title="Traces over time"
        headerActions={<button type="button">Latency</button>}
        error={TIMED_OUT}
      />,
    );

    expect(screen.getByText("Traces over time")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Latency" })).toBeInTheDocument();
    expect(message()).toHaveTextContent("This chart took too long to load");
    expect(screen.queryByTestId("bar-chart")).not.toBeInTheDocument();
  });

  test("any other failure says the chart could not load, in the server's words", () => {
    render(
      <TelemetryHistogram
        buckets={[]}
        isLoading={false}
        series={SERIES}
        error={FAILED}
      />,
    );

    expect(message()).toHaveTextContent("This chart could not load");
    expect(message()).toHaveTextContent("Invalid attribute key: http.route!");
  });

  test("Try again runs the chart's read again, once", () => {
    const onRetry: MockFunction = getJestMockFunction();

    render(
      <TelemetryHistogram
        buckets={[]}
        isLoading={false}
        series={SERIES}
        error={TIMED_OUT}
        onRetry={() => {
          onRetry();
        }}
      />,
    );

    fireEvent.click(
      within(message()).getByTestId(TELEMETRY_LOAD_ERROR_RETRY_TEST_ID),
    );

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

/*
 * A zoomed chart card whose read did not come back (found in the UI review
 * of #4824). The box where the bars go takes a double-click as "zoom out",
 * as it does over bars, a loader or an empty window, and the message sits in
 * that box:
 *
 *   - the header still says "Double-click to reset", as it does over bars;
 *   - a double-click on Try again (readers double-click buttons out of
 *     habit) is two tries, and never widens the range under the reader;
 *   - a double-click anywhere else in the box still zooms out.
 */
type ZoomedCard = {
  name: string;
  render: (props: {
    onZoomOut?: (() => void) | undefined;
    onRetry: () => void;
  }) => React.ReactElement;
};

const ZOOMED_CARDS: Array<ZoomedCard> = [
  {
    name: "LogsHistogram",
    render: (props: {
      onZoomOut?: (() => void) | undefined;
      onRetry: () => void;
    }): React.ReactElement => {
      return (
        <LogsHistogram
          buckets={[]}
          isLoading={false}
          error={TIMED_OUT}
          onRetry={props.onRetry}
          onTimeRangeSelect={jest.fn()}
          onZoomOut={props.onZoomOut}
        />
      );
    },
  },
  {
    name: "TelemetryHistogram",
    render: (props: {
      onZoomOut?: (() => void) | undefined;
      onRetry: () => void;
    }): React.ReactElement => {
      return (
        <TelemetryHistogram
          buckets={[]}
          isLoading={false}
          series={SERIES}
          title="Spans over time"
          error={TIMED_OUT}
          onRetry={props.onRetry}
          onTimeRangeSelect={jest.fn()}
          onZoomOut={props.onZoomOut}
        />
      );
    },
  },
];

// The events a real double-click fires, in order, each press counted.
function doubleClick(element: HTMLElement): void {
  for (const detail of [1, 2]) {
    fireEvent.mouseDown(element, { detail: detail, button: 0 });
    fireEvent.mouseUp(element, { detail: detail, button: 0 });
    fireEvent.click(element, { detail: detail, button: 0 });
  }

  fireEvent.doubleClick(element, { detail: 2, button: 0 });
}

describe.each(ZOOMED_CARDS)(
  "$name: a zoomed card that could not load",
  (card: ZoomedCard) => {
    test("still says how to go back: 'Double-click to reset'", () => {
      render(
        card.render({
          onZoomOut: () => {},
          onRetry: () => {},
        }),
      );

      expect(screen.getByText("Double-click to reset")).toBeInTheDocument();
      expect(message()).toHaveTextContent("This chart took too long to load");
    });

    test("a card that was not zoomed has no such hint", () => {
      render(card.render({ onRetry: () => {} }));

      expect(
        screen.queryByText("Double-click to reset"),
      ).not.toBeInTheDocument();
    });

    test("REGRESSION: a double-click on Try again is two tries, and never zooms out", () => {
      const onZoomOut: MockFunction = getJestMockFunction();
      const onRetry: MockFunction = getJestMockFunction();

      render(
        card.render({
          onZoomOut: () => {
            onZoomOut();
          },
          onRetry: () => {
            onRetry();
          },
        }),
      );

      doubleClick(
        within(message()).getByTestId(TELEMETRY_LOAD_ERROR_RETRY_TEST_ID),
      );

      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onZoomOut).not.toHaveBeenCalled();
    });

    test("a double-click elsewhere in the box zooms out, as over the bars", () => {
      const onZoomOut: MockFunction = getJestMockFunction();
      const onRetry: MockFunction = getJestMockFunction();

      render(
        card.render({
          onZoomOut: () => {
            onZoomOut();
          },
          onRetry: () => {
            onRetry();
          },
        }),
      );

      doubleClick(
        within(message()).getByText("This chart took too long to load"),
      );

      expect(onZoomOut).toHaveBeenCalledTimes(1);
      expect(onRetry).not.toHaveBeenCalled();
    });
  },
);

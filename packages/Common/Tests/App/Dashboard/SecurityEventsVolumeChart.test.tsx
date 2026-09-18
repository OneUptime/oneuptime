/** @timezone UTC */

import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Security Events volume chart: a totals row (how many events, split by
 * severity) over a severity-stacked histogram, plus its three other states -
 * first load, an empty window and a failed count.
 */

jest.mock("recharts", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  interface StubRow {
    time: string;
  }

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    BarChart: (props: { data: Array<StubRow>; children?: React.ReactNode }) => {
      return react.createElement(
        "div",
        { "data-testid": "bar-chart" },
        props.data.map((row: StubRow) => {
          return react.createElement("div", {
            key: row.time,
            "data-testid": "chart-row",
          });
        }),
        props.children,
      );
    },
    Bar: (props: { dataKey: string; fill: string }) => {
      return react.createElement("div", {
        "data-testid": "bar",
        "data-key": props.dataKey,
        "data-fill": props.fill,
      });
    },
    XAxis: () => {
      return null;
    },
    YAxis: () => {
      return null;
    },
    Tooltip: () => {
      return null;
    },
    ReferenceArea: () => {
      return null;
    },
  };
});

import SecurityEventsVolumeChart, {
  SECURITY_EVENTS_VOLUME_TEST_ID,
  SECURITY_EVENTS_VOLUME_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsVolumeChart";
import {
  SECURITY_EVENT_VOLUME_COLORS,
  SecurityEventVolume,
  buildSecurityEventVolume,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventVolume";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";

const START: Date = new Date("2026-09-17T12:00:00.000Z");
const END: Date = new Date("2026-09-17T13:00:00.000Z");

function volumeOf(
  rows: Array<[string, OcsfSeverity | string, number]>,
): SecurityEventVolume {
  return buildSecurityEventVolume({
    rows: rows.map(
      ([timestamp, severityName, value]: [
        string,
        OcsfSeverity | string,
        number,
      ]): AggregatedModel => {
        return {
          timestamp: timestamp as unknown as Date,
          value: value,
          severityName: severityName,
        };
      },
    ),
    startDate: START,
    endDate: END,
  });
}

const VOLUME: SecurityEventVolume = volumeOf([
  ["2026-09-17T12:05:00.000Z", OcsfSeverity.Critical, 2],
  ["2026-09-17T12:05:00.000Z", OcsfSeverity.Low, 40],
  ["2026-09-17T12:40:00.000Z", OcsfSeverity.High, 1],
  ["2026-09-17T12:41:00.000Z", OcsfSeverity.Informational, 1200],
]);

function renderChart(
  props: Partial<React.ComponentProps<typeof SecurityEventsVolumeChart>> = {},
): void {
  render(
    <SecurityEventsVolumeChart volume={VOLUME} isLoading={false} {...props} />,
  );
}

function totalText(): string {
  return (
    screen.getByTestId(`${SECURITY_EVENTS_VOLUME_TEST_ID}-total`).textContent ||
    ""
  );
}

function severityItems(): Array<HTMLElement> {
  return within(
    screen.getByRole("list", { name: "Events by severity" }),
  ).getAllByRole("listitem");
}

function barKeys(): Array<string> {
  return screen.queryAllByTestId("bar").map((bar: HTMLElement): string => {
    return bar.getAttribute("data-key") || "";
  });
}

afterEach(() => {
  cleanup();
});

describe("SecurityEventsVolumeChart totals", () => {
  test("states the window's total with thousands separators", () => {
    renderChart();

    expect(totalText()).toBe("1,243 events");
  });

  test("uses the singular for a single event", () => {
    renderChart({
      volume: volumeOf([["2026-09-17T12:05:00.000Z", OcsfSeverity.High, 1]]),
    });

    expect(totalText()).toBe("1 event");
  });

  test("splits the total by severity, most severe first, skipping severities with none", () => {
    renderChart();

    expect(
      severityItems().map((item: HTMLElement): string => {
        return item.textContent || "";
      }),
    ).toEqual(["Critical2", "High1", "Low40", "Informational1,200"]);
  });

  test("each severity's swatch is the colour of its bars", () => {
    renderChart();

    const critical: HTMLElement = screen.getByTestId(
      `${SECURITY_EVENTS_VOLUME_TEST_ID}-severity-${OcsfSeverity.Critical}`,
    );
    const swatch: HTMLElement = critical.querySelector(
      "[aria-hidden='true']",
    ) as HTMLElement;

    expect(swatch).toHaveStyle({
      backgroundColor: SECURITY_EVENT_VOLUME_COLORS[OcsfSeverity.Critical],
    });
  });

  test("says it is counting before the first count arrives", () => {
    renderChart({ volume: null, isLoading: true });

    expect(totalText()).toBe("Counting events...");
    expect(
      screen.queryByRole("list", { name: "Events by severity" }),
    ).toBeNull();
  });

  test("keeps the last totals on screen while a recount runs", () => {
    renderChart({ isLoading: true });

    expect(totalText()).toBe("1,243 events");
    expect(screen.getByTestId(SECURITY_EVENTS_VOLUME_TEST_ID)).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  test("renders the toolbar at the end of the totals row", () => {
    renderChart({
      toolbar: <button type="button">Past 1 Day</button>,
    });

    expect(
      screen.getByRole("button", { name: "Past 1 Day" }),
    ).toBeInTheDocument();
  });
});

describe("SecurityEventsVolumeChart histogram", () => {
  test("is titled Security Event Volume", () => {
    renderChart();

    expect(SECURITY_EVENTS_VOLUME_TITLE).toBe("Security Event Volume");
    expect(screen.getByText(SECURITY_EVENTS_VOLUME_TITLE)).toBeInTheDocument();
  });

  test("stacks one bar series per severity present, most severe at the bottom", () => {
    renderChart();

    expect(barKeys()).toEqual([
      OcsfSeverity.Critical,
      OcsfSeverity.High,
      OcsfSeverity.Low,
      OcsfSeverity.Informational,
    ]);
  });

  test("paints each severity in its own colour", () => {
    renderChart();

    for (const bar of screen.getAllByTestId("bar")) {
      expect(bar.getAttribute("data-fill")).toBe(
        SECURITY_EVENT_VOLUME_COLORS[
          bar.getAttribute("data-key") as OcsfSeverity
        ],
      );
    }
  });

  test("gives every minute of the hour its place on the axis", () => {
    renderChart();

    expect(screen.getAllByTestId("chart-row")).toHaveLength(61);
  });

  test("offers drag-to-zoom when it can zoom, and zoom-out once it has", () => {
    renderChart({
      onTimeRangeSelect: getJestMockFunction(),
      onZoomOut: getJestMockFunction(),
    });

    expect(screen.getByText("Drag to zoom")).toBeInTheDocument();
    expect(screen.getByText("Double-click to zoom out")).toBeInTheDocument();
  });

  test("offers neither without the handlers", () => {
    renderChart();

    expect(screen.queryByText("Drag to zoom")).toBeNull();
    expect(screen.queryByText("Double-click to zoom out")).toBeNull();
  });
});

describe("SecurityEventsVolumeChart other states", () => {
  test("an empty window says so rather than drawing an empty axis", () => {
    renderChart({ volume: volumeOf([]) });

    expect(
      screen.getByTestId(`${SECURITY_EVENTS_VOLUME_TEST_ID}-empty`),
    ).toHaveTextContent("No security events in this time range.");
    expect(screen.queryByTestId("bar-chart")).toBeNull();
    expect(totalText()).toBe("0 events");
    expect(
      screen.queryByRole("list", { name: "Events by severity" }),
    ).toBeNull();
  });

  test("an empty window that is being recounted keeps the chart frame rather than flashing empty", () => {
    renderChart({ volume: volumeOf([]), isLoading: true });

    expect(
      screen.queryByTestId(`${SECURITY_EVENTS_VOLUME_TEST_ID}-empty`),
    ).toBeNull();
  });

  test("a failed count shows the error, under the chart's title, with a retry", () => {
    const onRetry: MockFunction = getJestMockFunction();

    renderChart({ error: "Could not reach ClickHouse", onRetry: onRetry });

    const error: HTMLElement = screen.getByTestId(
      `${SECURITY_EVENTS_VOLUME_TEST_ID}-error`,
    );
    expect(error).toHaveTextContent(SECURITY_EVENTS_VOLUME_TITLE);
    expect(error).toHaveTextContent("Could not reach ClickHouse");
    expect(screen.queryByTestId("bar-chart")).toBeNull();

    fireEvent.click(within(error).getByTestId("refresh-button"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("a failed count does not leave stale totals claiming to describe the window", () => {
    renderChart({ error: "Could not reach ClickHouse" });

    expect(totalText()).toBe("");
    expect(
      screen.queryByRole("list", { name: "Events by severity" }),
    ).toBeNull();
  });

  test("the first load shows the chart's loader", () => {
    renderChart({ volume: null, isLoading: true });

    expect(screen.queryByTestId("bar-chart")).toBeNull();
    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
  });
});

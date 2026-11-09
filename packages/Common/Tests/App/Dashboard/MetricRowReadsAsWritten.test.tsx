import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import MetricRow from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricRow";
import { SparklinePoint } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricSparkline";
import MetricType from "../../../Models/DatabaseModels/MetricType";

/*
 * #6410's UI review: on a Persian page a Service Bus namespace's Metrics
 * tab read "Count 65" beside "4.95K Count" - a number, a space and a Latin
 * unit in a right-to-left line put the unit first - and each provider's
 * English description put its full stop at its start (".Count of active
 * messages in a Queue/Topic"). A row's value reads left to right on every
 * page now, and its description the way most of its letters do. jsdom lays
 * out no text, so this holds the row to the marks a browser orders them by.
 */

const POINTS: Array<SparklinePoint> = [
  { time: "2026-11-09T11:00:00.000Z", value: 60 },
  { time: "2026-11-09T11:15:00.000Z", value: 65 },
];

const ACTIVE_MESSAGES: MetricType = {
  name: "azure_activemessages_average",
  unit: "Count",
  description: "Count of active messages in a Queue/Topic.",
} as MetricType;

afterEach(() => {
  cleanup();
});

describe("a metric row on any page", () => {
  test("its value and unit read left to right, in an isolate of their own", () => {
    render(
      <MetricRow
        metric={ACTIVE_MESSAGES}
        sparklinePoints={POINTS}
        lastValue={65}
        valueCaption="total of series"
      />,
    );

    const value: HTMLElement = screen.getByTestId("metric-row-value-number");
    expect(value.tagName).toBe("BDI");
    expect(value).toHaveAttribute("dir", "ltr");
    expect(value).toHaveTextContent("65");
    expect(value).toHaveTextContent("Count");
    /*
     * Its own font-mono: every page's `* { font-family: Inter }` (index.ejs)
     * outranks the one it would inherit, and the isolate was drawn in Inter.
     */
    expect(value).toHaveClass("font-mono");
    // The caption under it is the page's words, read the page's way.
    expect(
      screen.getByTestId("metric-row-value-caption").closest("bdi"),
    ).toBeNull();
  });

  test("a value with a suffix keeps it in the same isolate", () => {
    render(
      <MetricRow
        metric={{ name: "http.server.requests", unit: "" } as MetricType}
        sparklinePoints={POINTS}
        lastValue={12}
        valueSuffix="/s"
      />,
    );

    const value: HTMLElement = screen.getByTestId("metric-row-value-number");
    expect(value).toHaveAttribute("dir", "ltr");
    expect(value.textContent?.endsWith("/s")).toBe(true);
  });

  test.each([
    ["an English description", ACTIVE_MESSAGES.description!, "ltr"],
    ["a Persian description", "تعداد پیام‌های فعال در صف.", "rtl"],
  ])(
    "%s reads the way it is written",
    (_kind: string, description: string, direction: string) => {
      render(
        <MetricRow
          metric={{ ...ACTIVE_MESSAGES, description } as MetricType}
          sparklinePoints={POINTS}
          lastValue={65}
        />,
      );

      const text: HTMLElement = screen.getByText(description);
      expect(text.tagName).toBe("BDI");
      expect(text).toHaveAttribute("dir", direction);
      expect(text.closest("p")).not.toBeNull();
    },
  );
});

import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import MetricRow from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricRow";
import {
  METRIC_ROW_CONTAINER_CLASS_NAME,
  METRIC_ROW_DESCRIPTION_CLASS_NAME,
  METRIC_ROW_INFO_CLASS_NAME,
  METRIC_ROW_LAYOUT_CLASS_NAME,
  METRIC_ROW_NAME_CLASS_NAME,
  METRIC_ROW_SIDE_BY_SIDE_MIN_WIDTH_REM,
  METRIC_ROW_VALUE_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricRowLayout";
import { SparklinePoint } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricSparkline";
import MetricType from "../../../Models/DatabaseModels/MetricType";

/*
 * Follow-up of #5076: on a phone - and in a card beside a resource's side
 * menu - a metrics list row gave its value and sparkline about 15rem and
 * left the metric's name a few letters ("conta…"). The row is a container
 * now: stacked (the name over its value) until it is wide enough for both
 * side by side. jsdom cannot measure, so this holds the row's parts to the
 * layout's classes; the offline browser suite measures it.
 */

const METRIC: MetricType = {
  name: "container.memory.usage.total",
  unit: "By",
  description:
    "Memory in use as a percent of the container's limit, or of host memory if it has none.",
} as MetricType;

const POINTS: Array<SparklinePoint> = [
  { time: "2026-10-26T11:00:00.000Z", value: 12 },
  { time: "2026-10-26T11:15:00.000Z", value: 18 },
];

// A Tailwind variant keyed to the window's width.
const WINDOW_BREAKPOINT: RegExp = /^(sm|md|lg|xl):/;

function classesOf(element: HTMLElement): Array<string> {
  return element.className.split(" ").filter(Boolean);
}

function expectClasses(element: HTMLElement, classNames: string): void {
  for (const className of classNames.split(" ")) {
    expect(classesOf(element)).toContain(className);
  }
}

afterEach(() => {
  cleanup();
});

describe("a metrics list row lays itself out by its own width", () => {
  test.each([
    ["a row that opens the explorer", true],
    ["a row that opens nothing", false],
  ])(
    "%s is a container its parts measure",
    (_name: string, clickable: boolean) => {
      render(
        <MetricRow
          metric={METRIC}
          sparklinePoints={POINTS}
          lastValue={1536}
          onClick={clickable ? (): void => {} : undefined}
        />,
      );

      const row: HTMLElement = screen.getByTestId("metric-row");
      expect(row.tagName).toBe(clickable ? "BUTTON" : "DIV");
      expectClasses(row, METRIC_ROW_CONTAINER_CLASS_NAME);
      expectClasses(
        screen.getByTestId("metric-row-layout"),
        METRIC_ROW_LAYOUT_CLASS_NAME,
      );
    },
  );

  test("stacked by default, the name and its description first, then the value and sparkline", () => {
    render(
      <MetricRow metric={METRIC} sparklinePoints={POINTS} lastValue={1536} />,
    );

    const layout: HTMLElement = screen.getByTestId("metric-row-layout");
    const [info, value] = Array.from(layout.children) as Array<HTMLElement>;

    expect(info).toContainElement(screen.getByTestId("metric-row-name"));
    expect(value).toBe(screen.getByTestId("metric-row-value"));
    expectClasses(info!, METRIC_ROW_INFO_CLASS_NAME);
    expectClasses(value!, METRIC_ROW_VALUE_CLASS_NAME);
    // Stacked unless the row is wide: no window breakpoint decides it.
    expect(classesOf(layout)).toContain("flex-col");
    expect(classesOf(layout)).not.toContain("flex-row");
  });

  test("stacked, a long name wraps; side by side, it keeps to one line", () => {
    render(
      <MetricRow metric={METRIC} sparklinePoints={POINTS} lastValue={1536} />,
    );

    const name: HTMLElement = screen.getByTestId("metric-row-name");
    expect(name).toHaveTextContent("container.memory.usage.total");
    expectClasses(name, METRIC_ROW_NAME_CLASS_NAME);
    expect(classesOf(name)).toContain("break-all");
    // Truncated only from the side-by-side width up, never on a phone.
    expect(classesOf(name)).not.toContain("truncate");
    expect(classesOf(name)).toContain(
      `[@container(min-width:${METRIC_ROW_SIDE_BY_SIDE_MIN_WIDTH_REM}rem)]:truncate`,
    );
  });

  test("the description gets two lines stacked and one side by side", () => {
    render(
      <MetricRow metric={METRIC} sparklinePoints={POINTS} lastValue={1536} />,
    );

    const description: HTMLElement = screen.getByText(METRIC.description!);
    expectClasses(description, METRIC_ROW_DESCRIPTION_CLASS_NAME);
    expect(classesOf(description)).toContain("line-clamp-2");
    expect(classesOf(description)).not.toContain("truncate");
  });

  test("the value and sparkline are never squeezed", () => {
    render(
      <MetricRow metric={METRIC} sparklinePoints={POINTS} lastValue={1536} />,
    );

    const value: HTMLElement = screen.getByTestId("metric-row-value");
    expect(classesOf(value)).toContain("flex-shrink-0");
    // The sparkline keeps its own box inside it.
    expect(value.querySelector(".w-40.h-10")).not.toBeNull();
  });
});

describe("the layout's classes", () => {
  test("switch to side by side at one width of the row, in whole rems", () => {
    const threshold: string = `[@container(min-width:${METRIC_ROW_SIDE_BY_SIDE_MIN_WIDTH_REM}rem)]`;

    expect(Number.isInteger(METRIC_ROW_SIDE_BY_SIDE_MIN_WIDTH_REM)).toBe(true);
    expect(METRIC_ROW_SIDE_BY_SIDE_MIN_WIDTH_REM).toBeGreaterThanOrEqual(10);
    expect(METRIC_ROW_SIDE_BY_SIDE_MIN_WIDTH_REM).toBeLessThan(100);
    expect(METRIC_ROW_LAYOUT_CLASS_NAME).toContain(`${threshold}:flex-row`);
    expect(METRIC_ROW_INFO_CLASS_NAME).toContain(`${threshold}:flex-1`);
    expect(METRIC_ROW_NAME_CLASS_NAME).toContain(`${threshold}:truncate`);
    expect(METRIC_ROW_DESCRIPTION_CLASS_NAME).toContain(
      `${threshold}:line-clamp-1`,
    );
    expect(METRIC_ROW_CONTAINER_CLASS_NAME).toBe(
      "[container-type:inline-size]",
    );
  });

  test("no part of the row answers to the window's width", () => {
    for (const classNames of [
      METRIC_ROW_LAYOUT_CLASS_NAME,
      METRIC_ROW_INFO_CLASS_NAME,
      METRIC_ROW_NAME_CLASS_NAME,
      METRIC_ROW_DESCRIPTION_CLASS_NAME,
      METRIC_ROW_VALUE_CLASS_NAME,
    ]) {
      for (const className of classNames.split(" ")) {
        expect({
          className,
          windowKeyed: WINDOW_BREAKPOINT.test(className),
        }).toEqual({
          className,
          windowKeyed: false,
        });
      }
    }
  });
});

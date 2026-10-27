import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import MetricRow from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricRow";
import {
  METRIC_ROW_CONTAINER_CLASS_NAME,
  METRIC_ROW_DESCRIPTION_CLASS_NAME,
  METRIC_ROW_INFO_CLASS_NAME,
  METRIC_ROW_LAYOUT_CLASS_NAME,
  METRIC_ROW_NAME_CLASS_NAME,
  METRIC_ROW_SIDE_BY_SIDE_MIN_WIDTH_REM,
  METRIC_ROW_SPARKLINE_CLASS_NAME,
  METRIC_ROW_VALUE_CLASS_NAME,
  METRIC_ROW_VALUE_TEXT_CLASS_NAME,
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
 *
 * #5298's UI review: stacked, a long name broke at whatever letter filled
 * the line ("io_service_b" / "ytes") - it breaks after its own dots first
 * now (BreakableName) - and each row's sparkline started wherever its
 * number ended, then moved out from under the pointer when hovering a
 * point widened the number with its time. Stacked, the sparkline comes
 * first and the value follows it.
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

const LONG_METRIC: MetricType = {
  name: "container.blockio.io_service_bytes_recursive",
  unit: "By",
  description: "Bytes read and written by the container's block devices.",
} as MetricType;

// A Tailwind variant keyed to the window's width.
const WINDOW_BREAKPOINT: RegExp = /^(sm|md|lg|xl):/;

const SIDE_BY_SIDE: string = `[@container(min-width:${METRIC_ROW_SIDE_BY_SIDE_MIN_WIDTH_REM}rem)]`;

// The text between the <wbr>s of an element's own children.
function partsOf(holder: HTMLElement): Array<string> {
  const parts: Array<string> = [""];

  for (const node of Array.from(holder.childNodes)) {
    if (node.nodeName === "WBR") {
      parts.push("");
      continue;
    }
    parts[parts.length - 1] += node.textContent || "";
  }

  return parts;
}

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
    /*
     * Anywhere only where a part is too long for the line: break-all broke
     * at whatever letter filled it, past the <wbr>s.
     */
    expect(classesOf(name)).toContain("[overflow-wrap:anywhere]");
    expect(classesOf(name)).not.toContain("break-all");
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

  test("a long name may break after its own dots, and reads as written", () => {
    render(
      <MetricRow
        metric={LONG_METRIC}
        sparklinePoints={POINTS}
        lastValue={12500000}
      />,
    );

    const name: HTMLElement = screen.getByTestId("metric-row-name");
    expect(name.textContent).toBe(
      "container.blockio.io_service_bytes_recursive",
    );
    expect(partsOf(name)).toEqual([
      "container.",
      "blockio.",
      "io_service_bytes_recursive",
    ]);
  });

  test("a short name is drawn whole, and a nameless metric says so", () => {
    render(
      <MetricRow
        metric={{ name: "up", unit: "1" } as MetricType}
        sparklinePoints={POINTS}
        lastValue={1}
      />,
    );
    expect(screen.getByTestId("metric-row-name").textContent).toBe("up");
    expect(
      screen.getByTestId("metric-row-name").querySelectorAll("wbr"),
    ).toHaveLength(0);
    cleanup();

    render(<MetricRow metric={{} as MetricType} lastValue={1} />);
    expect(screen.getByTestId("metric-row-name").textContent).toBe("(unnamed)");
  });

  test("stacked, the sparkline comes first and the value follows it; side by side, the value is before it", () => {
    render(
      <MetricRow metric={METRIC} sparklinePoints={POINTS} lastValue={1536} />,
    );

    const valueText: HTMLElement = screen.getByTestId("metric-row-value-text");
    const sparkline: HTMLElement = screen.getByTestId("metric-row-sparkline");

    expectClasses(valueText, METRIC_ROW_VALUE_TEXT_CLASS_NAME);
    expectClasses(sparkline, METRIC_ROW_SPARKLINE_CLASS_NAME);

    // Stacked: drawn first, whatever the value reads.
    expect(classesOf(sparkline)).toContain("order-first");
    expect(classesOf(sparkline)).toContain(`${SIDE_BY_SIDE}:order-none`);
    expect(classesOf(sparkline)).toContain("flex-shrink-0");

    /*
     * Stacked: the rest of the line, from its start; side by side: its own
     * width, against the sparkline at its end. Start and end, so a
     * right-to-left page keeps the value beside its sparkline too.
     */
    expect(classesOf(valueText)).toEqual(
      expect.arrayContaining([
        "min-w-0",
        "flex-1",
        "text-start",
        `${SIDE_BY_SIDE}:flex-none`,
        `${SIDE_BY_SIDE}:text-end`,
      ]),
    );
    for (const physical of ["text-left", "text-right"]) {
      expect(
        classesOf(valueText).filter((className: string): boolean => {
          return className.endsWith(physical);
        }),
      ).toEqual([]);
    }
    // No width of its own that a long value or a hovered time would outgrow.
    expect(
      classesOf(valueText).filter((className: string): boolean => {
        return className.startsWith("min-w-[") || className.startsWith("w-");
      }),
    ).toEqual([]);

    // A screen reader still meets the value before the sparkline.
    const value: HTMLElement = screen.getByTestId("metric-row-value");
    expect(Array.from(value.children).indexOf(valueText)).toBeLessThan(
      Array.from(value.children).indexOf(sparkline),
    );
  });

  test("hovering a point shows its value and time beside the sparkline, and nothing about the sparkline changes", () => {
    render(
      <MetricRow
        metric={METRIC}
        sparklinePoints={POINTS}
        lastValue={1536}
        onClick={(): void => {}}
      />,
    );

    const sparkline: HTMLElement = screen.getByTestId("metric-row-sparkline");
    const classesBefore: string = sparkline.className;
    const valueClassesBefore: string = screen.getByTestId(
      "metric-row-value-text",
    ).className;

    const chart: HTMLElement = sparkline.firstElementChild as HTMLElement;
    chart.getBoundingClientRect = (): DOMRect => {
      return {
        left: 0,
        right: 160,
        top: 0,
        bottom: 40,
        width: 160,
        height: 40,
        x: 0,
        y: 0,
        toJSON: (): unknown => {
          return {};
        },
      } as DOMRect;
    };
    fireEvent.mouseMove(chart, { clientX: 1, clientY: 20 });

    const valueText: HTMLElement = screen.getByTestId("metric-row-value-text");
    // The first point's value and its time, in the same place.
    expect(valueText.textContent).toContain("12");
    expect(valueText.textContent).toMatch(/2026/);
    expect(valueText.className).toBe(valueClassesBefore);
    expect(screen.getByTestId("metric-row-sparkline")).toBe(sparkline);
    expect(sparkline.className).toBe(classesBefore);

    fireEvent.mouseLeave(chart);
    expect(screen.getByTestId("metric-row-value-text").textContent).not.toMatch(
      /2026/,
    );
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
      METRIC_ROW_SPARKLINE_CLASS_NAME,
      METRIC_ROW_VALUE_TEXT_CLASS_NAME,
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

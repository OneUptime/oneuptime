import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { AIChatWidget, AIChatWidgetType } from "../../../Types/AI/AIChatTypes";
import { formatChartValue } from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/ChartWidget";
import DataTableWidget from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/DataTableWidget";
import StatCardsWidget from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/StatCardsWidget";

/*
 * THE CARDS AND CHARTS UNDER AN ANSWER FIT WHERE THEY ARE DRAWN.
 *
 * Ask AI's answers carry what their tools returned: a chart, a table, a
 * row of figures. In the dialog's column (and on a phone's whole screen)
 * the UI review of #5349 found each of them out of shape:
 *
 *   - a latency chart's axis wrote "2,600 ms", too wide for its 64 px, so
 *     every label broke into "2,600" over "ms";
 *   - a table cut each cell at one line 22rem wide, so on a phone its
 *     first column filled the card and pushed the others out of sight,
 *     with nothing to say they were there;
 *   - four figures sat three to a row, the fourth alone on a row of its
 *     own.
 *
 * These hold what replaced each: values scaled as the dashboards write
 * them, cells that wrap so every column is on screen, and as many tiles to
 * a row as fit. Real Chromium measures the same in packages/E2E/AskAi
 * (thread=rich).
 */

afterEach(() => {
  cleanup();
});

describe("a chart's axis writes each value short enough for one line", () => {
  test("a latency series: milliseconds, then seconds, as the dashboards write them", () => {
    expect(formatChartValue(0, "ms")).toBe("0\u00A0ms");
    expect(formatChartValue(650, "ms")).toBe("650\u00A0ms");
    expect(formatChartValue(1300, "ms")).toBe("1.3\u00A0s");
    expect(formatChartValue(1950, "ms")).toBe("1.95\u00A0s");
    expect(formatChartValue(2600, "ms")).toBe("2.6\u00A0s");
  });

  test("bytes and big bare numbers are scaled too; a percent joins its number", () => {
    expect(formatChartValue(1500000, "bytes")).toBe("1.5\u00A0MB");
    expect(formatChartValue(1204331)).toBe("1.2M");
    expect(formatChartValue(1204331, "")).toBe("1.2M");
    expect(formatChartValue(42, "%")).toBe("42.00%");
  });

  test("on the axis, each tick to the figures its round step needs (#10117)", () => {
    const halfSecond: { step: number; largestTick: number } = {
      step: 500,
      largestTick: 2500,
    };
    const ticks: Array<string> = [0, 500, 1000, 1500, 2000, 2500].map(
      (value: number): string => {
        return formatChartValue(value, "ms", halfSecond);
      },
    );

    expect(ticks).toEqual(
      ["0 ms", "500 ms", "1.0 s", "1.5 s", "2.0 s", "2.5 s"].map(
        (label: string): string => {
          return label.replace(/ /g, String.fromCharCode(0xa0));
        },
      ),
    );
  });

  test("a span of time on the axis in units of time, never in decimal hours (#10118)", () => {
    expect(formatChartValue(5401, "s", { step: 1, largestTick: 5402 })).toBe(
      "1:30:01",
    );
    expect(formatChartValue(5400, "s", { step: 1800, largestTick: 7200 })).toBe(
      ["1", "h", "30", "min"].join(String.fromCharCode(0xa0)),
    );
    // Its own figures, without a step: as before.
    expect(formatChartValue(5401, "s")).toBe("1.5\u00A0h");
  });

  test.each([
    ["ms", [0, 650, 1300, 1950, 2600, 12500, 95000, 3600000]],
    ["bytes", [0, 512, 64000, 1500000, 7.5e9]],
    ["", [0, 7, 999, 4812, 1204331, 3.2e9]],
  ] as Array<[string, Array<number>]>)(
    "no %p label is longer than the 64 px axis holds on one line (8 characters)",
    (unit: string, values: Array<number>) => {
      for (const value of values) {
        expect(formatChartValue(value, unit).length).toBeLessThanOrEqual(8);
      }
    },
  );
});

function tableWidget(): AIChatWidget {
  return {
    id: "W1",
    type: AIChatWidgetType.Table,
    title: "Slowest endpoints",
    data: {
      columns: [
        { key: "endpoint", title: "Endpoint" },
        { key: "p95", title: "p95 (ms)", type: "number" },
        { key: "calls", title: "Calls", type: "number" },
        { key: "service", title: "Service" },
      ],
      rows: [
        {
          endpoint: "POST /api/v2/checkout/sessions/{sessionId}/confirm",
          p95: 2412,
          calls: 120443,
          service: "payments-worker-eu-west-1-production",
        },
      ],
    },
  };
}

describe("a table keeps every column on screen", () => {
  test("text wraps - a word whole, an endpoint (no spaces to wrap at) anywhere - up to three lines, the whole value on hover", () => {
    render(<DataTableWidget widget={tableWidget()} />);

    const cells: Array<HTMLElement> =
      screen.getAllByTestId("ai-chat-table-cell");
    const endpoint: HTMLElement = cells[0]!;

    expect(endpoint).toHaveAttribute(
      "title",
      "POST /api/v2/checkout/sessions/{sessionId}/confirm",
    );
    const text: HTMLElement = endpoint.firstElementChild as HTMLElement;
    expect(text.textContent).toBe(
      "POST /api/v2/checkout/sessions/{sessionId}/confirm",
    );
    // Up to three lines, a word broken only when it is wider than the column...
    expect(text).toHaveClass("line-clamp-3", "break-words");
    expect(text).not.toHaveClass("[overflow-wrap:anywhere]");
    // ...and the endpoint's path, with no spaces to wrap at, anywhere (#6969).
    const path: HTMLElement = within(endpoint).getByTestId(
      "ai-chat-table-cell-long-word",
    );
    expect(path.textContent).toBe(
      "/api/v2/checkout/sessions/{sessionId}/confirm",
    );
    expect(path).toHaveClass("[overflow-wrap:anywhere]");
    // A floor, so a wrapped column never shrinks to a letter a line.
    expect(endpoint).toHaveClass("min-w-[5rem]");
  });

  test("a number keeps its one line, at the end of its column", () => {
    render(<DataTableWidget widget={tableWidget()} />);

    const p95: HTMLElement = screen.getAllByTestId("ai-chat-table-cell")[1]!;

    expect(p95).toHaveTextContent("2,412");
    expect(p95).toHaveClass("whitespace-nowrap", "text-right", "tabular-nums");
  });

  test("no cell is cut at one line any more", () => {
    render(<DataTableWidget widget={tableWidget()} />);

    for (const cell of screen.getAllByTestId("ai-chat-table-cell")) {
      expect(cell).not.toHaveClass("truncate");
      expect(cell.className).not.toContain("max-w-[22rem]");
    }
  });
});

describe("figures fill their row", () => {
  test("as many tiles to a row as the card has room for, all the same width", () => {
    render(
      <StatCardsWidget
        widget={{
          id: "W1",
          type: AIChatWidgetType.StatCards,
          title: "This week",
          data: {
            stats: [
              { label: "Requests", value: "1.36M" },
              { label: "Error rate", value: "0.36", unit: "%" },
              { label: "p95 latency", value: "412", unit: "ms" },
              { label: "Incidents", value: 2 },
            ],
          },
        }}
      />,
    );

    const grid: HTMLElement = screen.getByTestId("ai-chat-stat-cards");
    expect(grid).toHaveClass(
      "grid",
      "grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))]",
    );
    // Not a fixed three: a fourth tile no longer stands alone.
    expect(grid.className).not.toContain("grid-cols-3");
    expect(grid.children).toHaveLength(4);
  });
});

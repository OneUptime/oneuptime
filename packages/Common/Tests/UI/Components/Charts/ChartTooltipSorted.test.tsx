import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { ChartTooltip as AreaChartTooltip } from "../../../../UI/Components/Charts/ChartLibrary/AreaChart/AreaChart";
import { ChartTooltip as BarChartTooltip } from "../../../../UI/Components/Charts/ChartLibrary/BarChart/BarChart";
import { ChartTooltip as LineChartTooltip } from "../../../../UI/Components/Charts/ChartLibrary/LineChart/LineChart";

/*
 * The rendered tooltip is where "which host is this spike?" gets answered:
 * with a 20-series group-by chart the entries must arrive highest-value
 * first (recharts hands them over in series-mount order, effectively
 * alphabetical) and the tail past the cap must be summarized, not
 * silently dropped. All three chart types ship their own ChartTooltip, so
 * all three are pinned to the same contract here.
 */

type TooltipComponent =
  | typeof AreaChartTooltip
  | typeof LineChartTooltip
  | typeof BarChartTooltip;

interface TooltipCase {
  name: string;
  Tooltip: TooltipComponent;
}

const TOOLTIP_CASES: Array<TooltipCase> = [
  { name: "AreaChart", Tooltip: AreaChartTooltip },
  { name: "LineChart", Tooltip: LineChartTooltip },
  { name: "BarChart", Tooltip: BarChartTooltip },
];

function buildPayload(count: number): Array<{
  category: string;
  value: number;
  index: string;
  color: string;
  payload: Record<string, unknown>;
}> {
  return Array.from({ length: count }, (_: unknown, index: number) => {
    return {
      /*
       * Alphabetical categories with ASCENDING values — exactly the shape
       * where mount order (host-00 first) and value order (host-NN first)
       * disagree, so a pass proves the sort actually ran.
       */
      category: `host-${String(index).padStart(2, "0")}`,
      value: index,
      index: "10:00",
      color: "blue",
      payload: {},
    };
  });
}

afterEach(() => {
  cleanup();
});

describe.each(TOOLTIP_CASES)("$name tooltip", ({ Tooltip }: TooltipCase) => {
  test("renders entries highest-value first with an overflow summary", () => {
    const { container } = render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <Tooltip
        active={true}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payload={buildPayload(14) as any}
        label="10:00"
        valueFormatter={(value: number): string => {
          return `${value}%`;
        }}
      />,
    );

    const text: string = container.textContent || "";

    // The top-valued series leads; the lowest-valued ones are elided.
    expect(text.indexOf("host-13")).toBeGreaterThan(-1);
    expect(text.indexOf("host-13")).toBeLessThan(text.indexOf("host-12"));
    expect(text.indexOf("host-12")).toBeLessThan(text.indexOf("host-04"));
    expect(text).not.toContain("host-03");
    expect(text).not.toContain("host-00");

    // 14 series, 10 shown → 4 summarized.
    expect(
      screen.getByText(/\+4 more series — highest values shown/),
    ).toBeInTheDocument();

    // Values run through the caller's formatter.
    expect(text).toContain("13%");
  });

  test("shows no overflow line when everything fits", () => {
    const { container } = render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <Tooltip
        active={true}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payload={buildPayload(3) as any}
        label="10:00"
        valueFormatter={(value: number): string => {
          return String(value);
        }}
      />,
    );

    expect(container.textContent).not.toContain("more series");
    expect(container.textContent).toContain("host-02");
    expect(container.textContent).toContain("host-00");
  });

  test("renders nothing when inactive", () => {
    const { container } = render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <Tooltip
        active={false}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payload={buildPayload(3) as any}
        label="10:00"
        valueFormatter={(value: number): string => {
          return String(value);
        }}
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});

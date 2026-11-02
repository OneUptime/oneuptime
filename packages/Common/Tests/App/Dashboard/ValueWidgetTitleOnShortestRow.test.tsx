import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import ValueWidgetView, {
  TREND_TEST_ID,
  ValueWidgetViewProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/ValueWidgetView";
import {
  getMeanOfValues,
  getValueWidgetTrend,
  ValueWidgetPoint,
  ValueWidgetTrend,
} from "../../../Utils/Dashboard/ValueWidgetSeries";

/*
 * A Value widget one row high - the size every template's numbers are - on
 * the board's shortest row. Rows are 70px on every board 500 to 950px wide
 * (a laptop beside the side menu, a tablet) and on a phone, where the
 * widgets are one under another, each the board's width
 * (Common/Utils/Dashboard/DashboardBoardLayout). The widget gave its title
 * up there by half a pixel, so the numbers were bare; and a title is words
 * someone wrote, which reads its own way on a page of the other direction.
 */

const HOUR_MS: number = 60 * 60 * 1000;
const WEEK_START_MS: number = Date.UTC(2026, 9, 15, 10, 0, 0);

// The board's shortest row, and a 3x1 tile's width beside the side menu at 1280.
const SHORTEST_ROW_IN_PX: number = 70;
const THREE_BY_ONE_AT_1280_IN_PX: number = 199;

// A phone's stacked board, in production: 390 less the page's and the board's insets.
const PHONE_BOARD_WIDTH_IN_PX: number = 332;

const PERSIAN_TITLE: string = "درخواست‌های فعال";

function risingWeek(): Array<ValueWidgetPoint> {
  return Array.from({ length: 168 }, (_unused: unknown, hour: number) => {
    return {
      timestamp: new Date(WEEK_START_MS + hour * HOUR_MS),
      value: hour < 84 ? 40 : 44,
    };
  });
}

function trendOf(points: Array<ValueWidgetPoint>): ValueWidgetTrend {
  return getValueWidgetTrend({
    points: points,
    reduce: getMeanOfValues,
    windowStart: new Date(WEEK_START_MS),
    windowEnd: new Date(WEEK_START_MS + 168 * HOUR_MS),
    bucketWidthMs: HOUR_MS,
  })!;
}

function viewProps(data: {
  title: string;
  widthInPx: number;
}): ValueWidgetViewProps {
  const points: Array<ValueWidgetPoint> = risingWeek();

  return {
    widthInPx: data.widthInPx,
    heightInPx: SHORTEST_ROW_IN_PX,
    isEditMode: false,
    isLoading: false,
    hasEverLoaded: true,
    error: null,
    value: 44,
    points: points,
    trend: trendOf(points),
    noDataMessage: "No data for the selected time range",
    isConfigured: true,
    setupTitle: "Value Widget",
    setupMessage: "Click to configure metric",
    title: data.title,
    rawUnit: "",
    metricName: "http.server.active_requests",
    hideUnit: false,
    warningThreshold: undefined,
    criticalThreshold: undefined,
    trendDirection: undefined,
  };
}

afterEach(() => {
  cleanup();
});

describe("a Value widget one row high, on the board's 70px row", () => {
  test("keeps its title over its number in a 1280 window's 3x1 tile", () => {
    render(
      <ValueWidgetView
        {...viewProps({
          title: "Active Requests",
          widthInPx: THREE_BY_ONE_AT_1280_IN_PX,
        })}
      />,
    );

    expect(screen.getByText("Active Requests")).toBeVisible();
    expect(screen.getByText("44")).toBeVisible();
  });

  test("on a phone, as wide as the board, its title and its trend share the line above the number", () => {
    render(
      <ValueWidgetView
        {...viewProps({
          title: "Active Requests",
          widthInPx: PHONE_BOARD_WIDTH_IN_PX,
        })}
      />,
    );

    const title: HTMLElement = screen.getByText("Active Requests");
    const trend: HTMLElement = screen.getByTestId(TREND_TEST_ID);

    // One header line holds both.
    expect(title.parentElement).toBe(trend.parentElement);
  });

  test("an English title reads left to right, cut at its own end, whole under the pointer", () => {
    render(
      <ValueWidgetView
        {...viewProps({
          title: "Active Requests",
          widthInPx: THREE_BY_ONE_AT_1280_IN_PX,
        })}
      />,
    );

    const title: HTMLElement = screen.getByText("Active Requests");

    expect(title.tagName).toBe("BDI");
    expect(title).toHaveAttribute("dir", "ltr");
    expect(title).toHaveAttribute("title", "Active Requests");
    expect(title.className.split(" ")).toContain("truncate");
  });

  test("a Persian title reads right to left, on any page", () => {
    render(
      <ValueWidgetView
        {...viewProps({
          title: PERSIAN_TITLE,
          widthInPx: THREE_BY_ONE_AT_1280_IN_PX,
        })}
      />,
    );

    expect(screen.getByText(PERSIAN_TITLE)).toHaveAttribute("dir", "rtl");
  });
});

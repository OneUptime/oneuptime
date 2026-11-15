// UX rule: Docs/ux/README.md#cards-and-the-look-of-a-page
import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";

/*
 * A CHART'S TITLE ROW ON A PHONE (#8048).
 *
 * Every metric chart in a ChartGroup drew, on its title row, the title
 * (min-w-0 truncate), its (i) and explorer icons and the zoom hint, which
 * was `ml-auto shrink-0 whitespace-nowrap`: it never gave way, so the title
 * took whatever was left. On a 390px phone in Russian the hint ("Выделите
 * область, чтобы приблизить") was wider than the title's room, and the
 * Kubernetes Control Plane's etcd charts read "Размер…", "Использ…",
 * "Всего к…": nobody could tell the charts apart. And a finger neither
 * drags a zoom box nor double-clicks, so on a phone the words named a
 * gesture the reader could not make.
 *
 * Now the hint is the shared TimeRangeZoomHint, as every chart card's is:
 * never drawn on a phone's width or on a screen that is only touched, and
 * on a wider card the row wraps, so a hint that does not fit beside the
 * title goes under it instead of taking the title's room. (The CSS those
 * classes become is read in ChartTitleRowTailwind.test.tsx; a real browser
 * measures the row in packages/E2E/SharedUi, ?section=charts.)
 */

jest.mock("recharts", () => {
  const actual: Record<string, any> = jest.requireActual("recharts") as Record<
    string,
    any
  >;
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => {
      return React.cloneElement(children, { width: 600, height: 300 });
    },
  };
});

import ChartGroup, {
  Chart,
  CHART_TITLE_GROUP_CLASS_NAME,
  CHART_TITLE_ROW_CLASS_NAME,
  CHART_TITLE_ROW_HINT_CLASS_NAME,
  CHART_TITLE_ROW_TEST_ID,
  ChartType,
} from "../../../../UI/Components/Charts/ChartGroup/ChartGroup";
import TimeRangeZoomHint, {
  TIME_RANGE_ZOOM_HINT_BOTH_TEXT,
  TIME_RANGE_ZOOM_HINT_CLASSES,
  TIME_RANGE_ZOOM_HINT_NOT_ON_PHONES_CLASSES,
  TIME_RANGE_ZOOM_HINT_RESET_TEXT,
  TIME_RANGE_ZOOM_HINT_TEST_ID,
  TIME_RANGE_ZOOM_HINT_TEXT,
} from "../../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import { TimeRangeZoomProvider } from "../../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "../../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import ChartCurve from "../../../../UI/Components/Charts/Types/ChartCurve";
import SeriesPoint from "../../../../UI/Components/Charts/Types/SeriesPoints";
import {
  XAxis as ChartXAxis,
  XAxisAggregateType,
} from "../../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisType from "../../../../UI/Components/Charts/Types/XAxis/XAxisType";
import YAxis, {
  YAxisPrecision,
} from "../../../../UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "../../../../UI/Components/Charts/Types/YAxis/YAxisType";
import TimeRange from "../../../../Types/Time/TimeRange";

const START: Date = new Date("2026-11-15T10:00:00.000Z");
const END: Date = new Date("2026-11-15T10:30:00.000Z");

const X_AXIS: ChartXAxis = {
  legend: "Time",
  options: {
    type: XAxisType.Time,
    min: START,
    max: END,
    aggregateType: XAxisAggregateType.Average,
  },
};

const Y_AXIS: YAxis = {
  legend: "Bytes",
  options: {
    type: YAxisType.Number,
    min: 0,
    max: "auto",
    precision: YAxisPrecision.NoDecimals,
    formatter: (value: number): string => {
      return String(value);
    },
  },
};

const SERIES: Array<SeriesPoint> = [
  {
    seriesName: "Size",
    data: [
      { x: new Date("2026-11-15T10:01:00.000Z"), y: 3 },
      { x: new Date("2026-11-15T10:02:00.000Z"), y: 5 },
    ],
  },
];

// The etcd charts the issue saw cut to a word, in Russian.
const TITLES: Array<string> = [
  "Размер базы данных",
  "Использование хранилища",
  "Всего ключей",
];

function chartTitled(
  title: string,
  extra: Record<string, unknown> = {},
): Chart {
  return {
    id: title,
    title: title,
    description: "Размер базы данных etcd на диске.",
    type: ChartType.LINE,
    metricInfo: {
      metricName: "etcd_mvcc_db_total_size_in_bytes",
      aggregationType: "Avg",
    },
    onOpenInExplorer: (): void => {},
    props: {
      data: SERIES,
      xAxis: X_AXIS,
      yAxis: Y_AXIS,
      sync: false,
      curve: ChartCurve.MONOTONE,
      ...extra,
    } as unknown as Chart["props"],
  };
}

function pageZoom(isZoomed: boolean): TimeRangeZoom {
  return {
    isZoomed: isZoomed,
    rangeBeforeZoom: isZoomed ? { range: TimeRange.PAST_ONE_HOUR } : null,
    timeRange: { range: TimeRange.PAST_ONE_HOUR },
    zoomToTimeRange: (): void => {},
    resetZoom: (): void => {},
  };
}

function classesOf(element: Element): Array<string> {
  return (element.getAttribute("class") || "").split(/\s+/).filter(Boolean);
}

function rows(): Array<HTMLElement> {
  return screen.getAllByTestId(CHART_TITLE_ROW_TEST_ID);
}

afterEach(() => {
  cleanup();
});

describe.each([
  ["a chart card", false],
  ["the card-less stack", true],
])("%s's title row", (_where: string, hideCard: boolean) => {
  function renderGroup(isZoomed: boolean = false): void {
    render(
      <TimeRangeZoomProvider zoom={pageZoom(isZoomed)}>
        <ChartGroup
          hideCard={hideCard}
          charts={TITLES.map((title: string) => {
            return chartTitled(title);
          })}
        />
      </TimeRangeZoomProvider>,
    );
  }

  test("every chart has one, holding its whole title", () => {
    renderGroup();

    expect(rows()).toHaveLength(TITLES.length);
    rows().forEach((row: HTMLElement, index: number) => {
      const heading: HTMLElement = within(row).getByRole("heading");

      expect(heading).toHaveTextContent(TITLES[index]!);
      // Its whole title on hover too, where it is cut at the row's end.
      expect(heading).toHaveAttribute("title", TITLES[index]);
    });
  });

  test("the row wraps: the title and its icons are one group, the hint is the row's last item", () => {
    renderGroup();

    for (const row of rows()) {
      expect(classesOf(row)).toEqual(
        expect.arrayContaining(CHART_TITLE_ROW_CLASS_NAME.split(" ")),
      );
      expect(classesOf(row)).toContain("flex-wrap");

      const items: Array<Element> = Array.from(row.children);
      expect(items).toHaveLength(2);

      const [group, hint] = items as [Element, Element];
      expect(classesOf(group)).toEqual(
        expect.arrayContaining(CHART_TITLE_GROUP_CLASS_NAME.split(" ")),
      );
      // The title, then its (i) and explorer buttons, in the group.
      expect(group.querySelector("h2, h3")).not.toBeNull();
      expect(group.querySelectorAll("button")).toHaveLength(2);
      // The hint is not in the group: it can go on a line of its own.
      expect(hint).toHaveAttribute("data-testid", TIME_RANGE_ZOOM_HINT_TEST_ID);
      expect(group.contains(hint)).toBe(false);
    }
  });

  test("regression: the hint no longer sits in the title's own line, unable to give way", () => {
    renderGroup();

    for (const row of rows()) {
      const heading: HTMLElement = within(row).getByRole("heading");
      const hint: HTMLElement = within(row).getByTestId(
        TIME_RANGE_ZOOM_HINT_TEST_ID,
      );

      // The old row: title and hint siblings in one flex line that never wraps.
      expect(heading.parentElement).not.toBe(hint.parentElement);
      expect(classesOf(heading.parentElement!)).not.toContain("flex-wrap");
      expect(classesOf(hint.parentElement!)).toContain("flex-wrap");
    }
  });

  test("the hint is never drawn on a phone, nor on a screen that is only touched", () => {
    renderGroup();

    for (const hint of screen.getAllByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)) {
      expect(classesOf(hint)).toContain("max-sm:hidden");
      expect(classesOf(hint)).toContain("[@media(hover:none)]:hidden");
      // Media variants only: never a bare `hidden` shown again by one.
      expect(classesOf(hint)).not.toContain("hidden");
      expect(classesOf(hint)).not.toContain("sm:inline");
    }
  });

  test("on its own line the hint keeps to the row's end, and is cut there rather than overflow", () => {
    renderGroup();

    for (const hint of screen.getAllByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)) {
      expect(classesOf(hint)).toEqual(
        expect.arrayContaining(CHART_TITLE_ROW_HINT_CLASS_NAME.split(" ")),
      );
    }
  });

  test("it says what it always said: the drag, and the way back while zoomed", () => {
    renderGroup(false);
    expect(screen.getAllByText("Drag to zoom")).toHaveLength(TITLES.length);
    cleanup();

    renderGroup(true);
    expect(
      screen.getAllByText("Drag to zoom · double-click to reset"),
    ).toHaveLength(TITLES.length);
  });

  test("a chart that keeps out of the page's zoom has no hint, and its row only its title group", () => {
    render(
      <TimeRangeZoomProvider zoom={pageZoom(false)}>
        <ChartGroup
          hideCard={hideCard}
          charts={[chartTitled(TITLES[0]!, { disableTimeRangeZoom: true })]}
        />
      </TimeRangeZoomProvider>,
    );

    expect(screen.queryByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toBeNull();
    expect(rows()[0]!.children).toHaveLength(1);
  });
});

describe("TimeRangeZoomHint: one hint for the chart cards and the metric charts", () => {
  test("the phone rule is part of every hint's look", () => {
    expect(TIME_RANGE_ZOOM_HINT_CLASSES).toContain(
      TIME_RANGE_ZOOM_HINT_NOT_ON_PHONES_CLASSES,
    );
    expect(TIME_RANGE_ZOOM_HINT_NOT_ON_PHONES_CLASSES.split(" ")).toEqual([
      "max-sm:hidden",
      "[@media(hover:none)]:hidden",
    ]);
  });

  test("a chart card's hint, from the page's zoom, never on a phone either", () => {
    render(
      <TimeRangeZoomProvider zoom={pageZoom(false)}>
        <TimeRangeZoomHint revealOnHover={true} />
      </TimeRangeZoomProvider>,
    );

    const hint: HTMLElement = screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID);
    expect(hint).toHaveTextContent(TIME_RANGE_ZOOM_HINT_TEXT);
    expect(classesOf(hint)).toContain("max-sm:hidden");
    expect(classesOf(hint)).toContain("[@media(hover:none)]:hidden");
  });

  test("a zoomed card names the way back alone; a chart with a row of its own names both", () => {
    render(
      <TimeRangeZoomProvider zoom={pageZoom(true)}>
        <TimeRangeZoomHint />
      </TimeRangeZoomProvider>,
    );
    expect(screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toHaveTextContent(
      TIME_RANGE_ZOOM_HINT_RESET_TEXT,
    );
    cleanup();

    render(
      <TimeRangeZoomProvider zoom={pageZoom(true)}>
        <TimeRangeZoomHint namesDragWhileZoomed={true} />
      </TimeRangeZoomProvider>,
    );
    expect(screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toHaveTextContent(
      TIME_RANGE_ZOOM_HINT_BOTH_TEXT,
    );
  });

  test("a chart's own zoom wins over the page's, as the chart resolves it", () => {
    // A host that zooms its own way, with nothing to reset, on a zoomed page.
    render(
      <TimeRangeZoomProvider zoom={pageZoom(true)}>
        <TimeRangeZoomHint
          zoom={{
            onTimeRangeSelect: (): void => {},
            onTimeRangeReset: undefined,
          }}
          namesDragWhileZoomed={true}
        />
      </TimeRangeZoomProvider>,
    );
    expect(screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toHaveTextContent(
      /^Drag to zoom$/,
    );
    cleanup();

    // Off any zoomable page, a chart with its own handlers still says it.
    render(
      <TimeRangeZoomHint
        zoom={{
          onTimeRangeSelect: (): void => {},
          onTimeRangeReset: (): void => {},
        }}
      />,
    );
    expect(screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toHaveTextContent(
      TIME_RANGE_ZOOM_HINT_RESET_TEXT,
    );
  });

  test("a chart that cannot be dragged says nothing, whatever the page offers", () => {
    const { container } = render(
      <TimeRangeZoomProvider zoom={pageZoom(true)}>
        <TimeRangeZoomHint
          zoom={{ onTimeRangeSelect: undefined, onTimeRangeReset: undefined }}
        />
      </TimeRangeZoomProvider>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

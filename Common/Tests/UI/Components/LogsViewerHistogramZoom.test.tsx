/** @timezone UTC */

import { HistogramBucket } from "../../../UI/Components/LogsViewer/types";
import LogSeverity from "../../../Types/Log/LogSeverity";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * LogsViewer is the piece that makes double-click-to-zoom-out possible at
 * all: the chart only reports the window a reader dragged out, and only the
 * viewer knows which window they were on before they dragged it. This file
 * covers that link — the chart's own behaviour is in
 * LogsHistogramDragTooltip.test.tsx and the bookkeeping in
 * UseHistogramZoom.test.tsx, and both stay green while this wiring is cut.
 *
 * The container loads services and log attributes on mount, so both API
 * surfaces are mocked out; nothing here depends on what they return.
 */

const getListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyErrorMessage: (error: Error) => {
        return error.message;
      },
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

// See LogsHistogramDragTooltip.test.tsx for why recharts is stood in for.
jest.mock("recharts", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  interface StubRow {
    time: string;
  }

  interface StubChartProps {
    data: Array<StubRow>;
    children?: React.ReactNode;
    onMouseDown?: (state: { activeLabel: string }) => void;
    onMouseMove?: (state: { activeLabel: string }) => void;
    onMouseUp?: (state: { activeLabel: string }) => void;
  }

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    BarChart: (props: StubChartProps) => {
      return react.createElement(
        "div",
        { "data-testid": "bar-chart" },
        props.data.map((row: StubRow) => {
          return react.createElement("div", {
            key: row.time,
            "data-testid": `bucket-${row.time}`,
            onMouseDown: () => {
              props.onMouseDown?.({ activeLabel: row.time });
            },
            onMouseMove: () => {
              props.onMouseMove?.({ activeLabel: row.time });
            },
            onMouseUp: () => {
              props.onMouseUp?.({ activeLabel: row.time });
            },
          });
        }),
        props.children,
      );
    },
    Bar: () => {
      return null;
    },
    XAxis: () => {
      return null;
    },
    YAxis: () => {
      return null;
    },
    Tooltip: (props: { active?: boolean }) => {
      return react.createElement("div", {
        "data-testid": "tooltip",
        "data-active": String(props.active),
      });
    },
    ReferenceArea: () => {
      return null;
    },
  };
});

getListMock.mockImplementation(() => {
  return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
});

postMock.mockImplementation(() => {
  return Promise.resolve({ data: {} });
});

// Imported after the mocks so the container picks them up.
import LogsViewer from "../../../UI/Components/LogsViewer/LogsViewer";

const FIRST_BUCKET: string = "2026-08-05T11:58:00Z";
const LAST_BUCKET: string = "2026-08-05T12:00:00Z";

const BUCKETS: Array<HistogramBucket> = [
  { time: FIRST_BUCKET, severity: LogSeverity.Error, count: 3 },
  { time: "2026-08-05T11:59:00Z", severity: LogSeverity.Error, count: 5 },
  { time: LAST_BUCKET, severity: LogSeverity.Error, count: 7 },
];

const PAST_DAY: RangeStartAndEndDateTime = { range: TimeRange.PAST_ONE_DAY };
const ZOOM_OUT_HINT: string = "Double-click to zoom out";

interface RenderedViewer {
  onHistogramTimeRangeSelect: MockFunction;
  onTimeRangeChange: MockFunction;
}

async function renderViewer(): Promise<RenderedViewer> {
  const onHistogramTimeRangeSelect: MockFunction = getJestMockFunction();
  const onTimeRangeChange: MockFunction = getJestMockFunction();

  render(
    <LogsViewer
      logs={[]}
      isLoading={false}
      filterData={{}}
      onFilterChanged={getJestMockFunction()}
      histogramBuckets={BUCKETS}
      histogramLoading={false}
      onHistogramTimeRangeSelect={onHistogramTimeRangeSelect}
      timeRange={PAST_DAY}
      onTimeRangeChange={onTimeRangeChange}
    />,
  );

  await waitFor(() => {
    expect(screen.queryByTestId("bar-chart")).not.toBeNull();
  });

  return {
    onHistogramTimeRangeSelect: onHistogramTimeRangeSelect,
    onTimeRangeChange: onTimeRangeChange,
  };
}

function dragAcrossHistogram(): void {
  fireEvent.mouseDown(screen.getByTestId(`bucket-${FIRST_BUCKET}`));
  fireEvent.mouseMove(screen.getByTestId(`bucket-${LAST_BUCKET}`));
  fireEvent.mouseUp(screen.getByTestId(`bucket-${LAST_BUCKET}`));
}

describe("LogsViewer wires the histogram's zoom to the window it came from", () => {
  afterEach(() => {
    cleanup();
  });

  test("a drag still reaches the host that applies the window", async () => {
    const { onHistogramTimeRangeSelect } = await renderViewer();

    dragAcrossHistogram();

    expect(onHistogramTimeRangeSelect).toHaveBeenCalledTimes(1);
    const [start, end] = onHistogramTimeRangeSelect.mock.calls[0] as [
      Date,
      Date,
    ];
    expect(start.toISOString()).toBe(new Date(FIRST_BUCKET).toISOString());
    expect(end.toISOString()).toBe(new Date(LAST_BUCKET).toISOString());
  });

  test("the way back out only appears once a drag has zoomed in", async () => {
    await renderViewer();

    expect(screen.queryByText(ZOOM_OUT_HINT)).toBeNull();

    dragAcrossHistogram();

    expect(screen.queryByText(ZOOM_OUT_HINT)).not.toBeNull();
  });

  test("double-clicking the chart restores the window the reader was on", async () => {
    const { onTimeRangeChange } = await renderViewer();

    dragAcrossHistogram();
    fireEvent.doubleClick(screen.getByTestId("bar-chart"));

    expect(onTimeRangeChange).toHaveBeenCalledTimes(1);
    expect(onTimeRangeChange).toHaveBeenCalledWith(PAST_DAY);
  });

  test("double-clicking before any zoom leaves the window alone", async () => {
    const { onTimeRangeChange } = await renderViewer();

    fireEvent.doubleClick(screen.getByTestId("bar-chart"));

    expect(onTimeRangeChange).not.toHaveBeenCalled();
  });

  test("the way back out is spent once it has been taken", async () => {
    const { onTimeRangeChange } = await renderViewer();

    dragAcrossHistogram();
    fireEvent.doubleClick(screen.getByTestId("bar-chart"));
    fireEvent.doubleClick(screen.getByTestId("bar-chart"));

    expect(onTimeRangeChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(ZOOM_OUT_HINT)).toBeNull();
  });
});

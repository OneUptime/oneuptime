import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 on a database's in-place metric chart (the modal a row of the
 * Metrics tab opens). The modal has a range of its own, seeded from the list
 * behind it, so its chart zooms THAT range:
 *
 *   - a drag narrows the modal's range - the chart re-fetches the dragged
 *     window, the modal's picker reads Custom and offers "Reset zoom", and
 *     "Create monitor" and the id check follow the zoomed window;
 *   - a double-click (or "Reset zoom") puts back the range the modal had
 *     before the first zoom;
 *   - the page around the modal is never retimed, even when it offers a
 *     zoom of its own: the modal's scope shadows it.
 *
 * The network is replaced (the chart's series fetch, the id check); the
 * modal, its ChartCard and the real time picker render. The line chart is
 * ChartZoomStandIn, which resolves its zoom as the real wrapper does.
 */

const DATABASE_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const KEY: string = "0123456789abcdef";
const MINUTE: number = 60 * 1000;
const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const ZOOM_START: Date = new Date("2026-09-28T10:00:00.000Z");
const ZOOM_END: Date = new Date("2026-09-28T10:30:00.000Z");
const INNER_ZOOM_START: Date = new Date("2026-09-28T10:10:00.000Z");
const INNER_ZOOM_END: Date = new Date("2026-09-28T10:20:00.000Z");
// postgresql.backends is a curated gauge, charted under its catalog title.
const CHART: string = "Connections";
const PICKER_BUTTON_TEST_ID: string = "telemetry-time-range-picker-button";

const chartSeriesMock: MockFunction = getJestMockFunction();
const carriesServerIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    ...(jest.requireActual(
      "../../../UI/Components/Charts/Line/LineChart",
    ) as Record<string, unknown>),
    __esModule: true,
    default: (jest.requireActual("./ChartZoomStandIn") as { default: unknown })
      .default,
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerTelemetryQueries",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerTelemetryQueries",
    ) as Record<string, unknown>;
    return {
      ...actual,
      __esModule: true,
      fetchDatabaseMetricChartSeries: (...args: Array<unknown>): unknown => {
        return chartSeriesMock(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseMetricMonitorLink",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseMetricMonitorLink",
    ) as Record<string, unknown>;
    return {
      ...actual,
      __esModule: true,
      fetchDatabaseMetricCarriesServerId: (
        ...args: Array<unknown>
      ): unknown => {
        return carriesServerIdMock(...args);
      },
    };
  },
);

// The modal chrome, without the portal and focus trap.
jest.mock("../../../UI/Components/Modal/Modal", () => {
  return {
    __esModule: true,
    ModalWidth: { Normal: 0, Medium: 1, Large: 2 },
    default: (props: {
      title: string;
      children?: React.ReactNode;
    }): React.ReactElement => {
      return (
        <section role="dialog" aria-label={props.title}>
          {props.children}
        </section>
      );
    },
  };
});

import DatabaseMetricChartModal from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseMetricChartModal";
import {
  StandInChartRecord,
  getStandInChart,
  resetStandInCharts,
  standInDrag,
} from "./ChartZoomStandIn";
import { TimeRangeZoomProvider } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { getTimeRangeButtonLabel } from "../../../UI/Components/Date/TimeRangePickerDropdown";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";

interface FetchWindow {
  start: Date;
  end: Date;
}

function lastWindow(mock: MockFunction): FetchWindow {
  const call: Array<unknown> | undefined =
    mock.mock.calls[mock.mock.calls.length - 1];
  if (!call) {
    throw new Error("The fetcher was never called");
  }
  const request: FetchWindow = call[0] as FetchWindow;
  return { start: request.start, end: request.end };
}

function minutesOf(window: FetchWindow): number {
  return (window.end.getTime() - window.start.getTime()) / MINUTE;
}

/*
 * The page behind the modal offers a zoom of its own (and is zoomed, so it
 * offers a reset too). The modal must use neither.
 */
const pageZoomToTimeRange: MockFunction = getJestMockFunction();
const pageResetZoom: MockFunction = getJestMockFunction();

function pageZoom(): TimeRangeZoom {
  return {
    isZoomed: true,
    rangeBeforeZoom: { range: TimeRange.PAST_ONE_DAY },
    zoomToTimeRange: pageZoomToTimeRange as unknown as (
      startTime: Date,
      endTime: Date,
    ) => void,
    resetZoom: pageResetZoom as unknown as () => void,
  };
}

async function flush(): Promise<void> {
  for (let i: number = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderModal(): Promise<void> {
  render(
    <MemoryRouter>
      <TimeRangeZoomProvider zoom={pageZoom()}>
        <DatabaseMetricChartModal
          metricName="postgresql.backends"
          unit=""
          keys={[KEY]}
          projectId={PROJECT_ID}
          dbSystem="postgresql"
          databaseServerId={new ObjectID(DATABASE_ID)}
          databaseName="orders-db"
          initialTimeRange={{ range: TimeRange.PAST_THREE_HOURS }}
          onClose={(): void => {}}
        />
      </TimeRangeZoomProvider>
    </MemoryRouter>,
  );
  await flush();
  await waitFor(() => {
    expect(screen.getByTestId(`chart ${CHART}`)).toBeInTheDocument();
  });
}

async function dragAcrossChart(
  start: Date = ZOOM_START,
  end: Date = ZOOM_END,
): Promise<void> {
  standInDrag.start = start;
  standInDrag.end = end;
  fireEvent.click(screen.getByRole("button", { name: `Drag across ${CHART}` }));
  await flush();
  await waitFor(() => {
    expect(screen.getByTestId(`chart ${CHART}`)).toBeInTheDocument();
  });
}

async function doubleClickChart(): Promise<void> {
  fireEvent.doubleClick(screen.getByTestId(`chart ${CHART}`));
  await flush();
  await waitFor(() => {
    expect(screen.getByTestId(`chart ${CHART}`)).toBeInTheDocument();
  });
}

function modal(): HTMLElement {
  return screen.getByRole("dialog");
}

function pickerLabel(): string {
  return within(modal()).getByTestId(PICKER_BUTTON_TEST_ID).textContent || "";
}

function customLabel(start: Date, end: Date): string {
  return getTimeRangeButtonLabel({
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(start, end),
  });
}

function monitorParams(): URLSearchParams {
  const href: string =
    screen.getByRole("link", { name: "Create monitor" }).getAttribute("href") ||
    "";
  return new URLSearchParams(href.split("?")[1] || "");
}

function expectOnTheModalsOwnRange(): void {
  const window: FetchWindow = lastWindow(chartSeriesMock);
  expect(minutesOf(window)).toBe(180);
  expect(window.end.getTime()).toBeGreaterThanOrEqual(NOW.getTime());
  expect(window.end.getTime()).toBeLessThan(NOW.getTime() + 10 * MINUTE);
  expect(pickerLabel()).toBe("Past 3 Hours");
  expect(
    screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
  ).not.toBeInTheDocument();
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  resetStandInCharts();
  for (const mock of [
    chartSeriesMock,
    carriesServerIdMock,
    pageZoomToTimeRange,
    pageResetZoom,
  ]) {
    mock.mockReset();
  }
  chartSeriesMock.mockImplementation(async (window: unknown) => {
    const w: FetchWindow = window as FetchWindow;
    return [{ x: new Date(w.start.getTime() + MINUTE), y: 8 }];
  });
  carriesServerIdMock.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("DatabaseMetricChartModal: the chart zooms the modal's own range", () => {
  test("the chart takes the modal's zoom, not the zoom of the page around it", async () => {
    await renderModal();

    const record: StandInChartRecord = getStandInChart(CHART);
    expect(record.zoom.onTimeRangeSelect).toBeInstanceOf(Function);
    expect(record.zoom.onTimeRangeSelect).not.toBe(pageZoomToTimeRange);
    // The page is zoomed; the modal is not, so there is nothing to reset.
    expect(record.zoom.onTimeRangeReset).toBeUndefined();
    expect(pickerLabel()).toBe("Past 3 Hours");
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("the modal opens on the range the list handed it", async () => {
    await renderModal();

    expectOnTheModalsOwnRange();
  });

  test("a drag re-fetches the chart over the dragged window, and never retimes the page", async () => {
    await renderModal();

    await dragAcrossChart();

    expect(lastWindow(chartSeriesMock)).toEqual({
      start: ZOOM_START,
      end: ZOOM_END,
    });
    const record: StandInChartRecord = getStandInChart(CHART);
    expect(record.props.xAxis.options.min).toEqual(ZOOM_START);
    expect(record.props.xAxis.options.max).toEqual(ZOOM_END);
    expect(pageZoomToTimeRange).not.toHaveBeenCalled();
    expect(pageResetZoom).not.toHaveBeenCalled();
  });

  test("after a drag the modal's own picker reads Custom and offers Reset zoom", async () => {
    await renderModal();

    await dragAcrossChart();

    expect(pickerLabel()).toBe(customLabel(ZOOM_START, ZOOM_END));
    const reset: HTMLElement = within(modal()).getByTestId(
      RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
    );
    expect(reset).toBeVisible();
    expect(reset).toHaveAttribute(
      "title",
      `Go back to ${TimeRange.PAST_THREE_HOURS}, the time range before the zoom`,
    );
    expect(getStandInChart(CHART).zoom.onTimeRangeReset).toBeInstanceOf(
      Function,
    );
  });

  test("a double-click puts back the range the modal had before the zoom", async () => {
    await renderModal();

    await dragAcrossChart();
    await doubleClickChart();

    expectOnTheModalsOwnRange();
    expect(pageResetZoom).not.toHaveBeenCalled();
    expect(getStandInChart(CHART).zoom.onTimeRangeReset).toBeUndefined();
  });

  test("Reset zoom beside the modal's picker does the same", async () => {
    await renderModal();

    await dragAcrossChart();
    fireEvent.click(
      within(modal()).getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    );
    await flush();

    expectOnTheModalsOwnRange();
    expect(pageResetZoom).not.toHaveBeenCalled();
  });

  test("a zoom within a zoom: one reset returns to the modal's range", async () => {
    await renderModal();

    await dragAcrossChart();
    await dragAcrossChart(INNER_ZOOM_START, INNER_ZOOM_END);
    expect(lastWindow(chartSeriesMock)).toEqual({
      start: INNER_ZOOM_START,
      end: INNER_ZOOM_END,
    });
    expect(pickerLabel()).toBe(customLabel(INNER_ZOOM_START, INNER_ZOOM_END));

    await doubleClickChart();

    expectOnTheModalsOwnRange();
  });

  test("a double-click with nothing to undo does not re-fetch", async () => {
    await renderModal();
    const fetchesBefore: number = chartSeriesMock.mock.calls.length;

    await doubleClickChart();

    expect(chartSeriesMock.mock.calls.length).toBe(fetchesBefore);
    expect(pageResetZoom).not.toHaveBeenCalled();
  });

  test("Create monitor follows the zoom: the zoomed window pinned, then the rolling range again", async () => {
    await renderModal();

    await waitFor(() => {
      expect(monitorParams().get("range")).toBe(TimeRange.PAST_THREE_HOURS);
    });

    await dragAcrossChart();

    await waitFor(() => {
      expect(monitorParams().get("startTime")).toBe(ZOOM_START.toISOString());
    });
    expect(monitorParams().get("endTime")).toBe(ZOOM_END.toISOString());
    // A zoom is a pinned window, not a rolling preset.
    expect(monitorParams().get("range")).toBeNull();

    await doubleClickChart();

    await waitFor(() => {
      expect(monitorParams().get("range")).toBe(TimeRange.PAST_THREE_HOURS);
    });
  });

  test("the check behind Create monitor re-runs over the zoomed window", async () => {
    await renderModal();

    await dragAcrossChart();

    await waitFor(() => {
      expect(lastWindow(carriesServerIdMock)).toEqual({
        start: ZOOM_START,
        end: ZOOM_END,
      });
    });
  });

  test("picking a range in the modal ends the zoom", async () => {
    await renderModal();

    await dragAcrossChart();
    fireEvent.click(within(modal()).getByTestId(PICKER_BUTTON_TEST_ID));
    fireEvent.click(screen.getByRole("button", { name: "Past 1 Day" }));
    await flush();

    expect(pickerLabel()).toBe("Past 1 Day");
    expect(minutesOf(lastWindow(chartSeriesMock))).toBe(24 * 60);
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(getStandInChart(CHART).zoom.onTimeRangeReset).toBeUndefined();
    });
  });
});

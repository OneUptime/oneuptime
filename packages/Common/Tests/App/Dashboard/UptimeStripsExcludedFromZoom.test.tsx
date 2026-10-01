/** @timezone UTC */

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
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 made every time-series chart zoomable. The uptime day
 * strips are deliberately NOT: one button per day over a fixed 90-day
 * window, where a click opens that day, arrow keys move between days and a
 * phone swipes the strip sideways. A sub-day zoom has nothing to show in
 * whole-day bars, and a drag would fight every one of those gestures.
 *
 * Pinned here on the two strips in the monitor area: the monitor
 * Overview's "Uptime history" card and the monitor group view's "Uptime
 * Graph". Both are rendered for real (the day strip included) inside a
 * page that zooms, and already zoomed, so a strip that took part would
 * have both a zoom to join and a reset to trigger:
 *
 * - a drag across the bars and a double-click on a bar leave the page's
 *   range alone;
 * - the strip offers no drag affordance (no crosshair, no hint);
 * - the strip keeps its 90 days whatever the page is zoomed to.
 */

const getListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      const ReactModule: typeof React = jest.requireActual(
        "react",
      ) as typeof React;
      return ReactModule.createElement("div", {
        "data-testid": "group-details",
      });
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Utils/Navigation",
  ) as Record<string, unknown>;
  const actualDefault: Record<string, unknown> = actual["default"] as Record<
    string,
    unknown
  >;
  return {
    __esModule: true,
    default: {
      ...actualDefault,
      getLastParamAsObjectID: () => {
        return new ObjectID("55555555-5555-4555-8555-555555555555");
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

import MonitorUptimeHistoryCard from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorUptimeHistoryCard";
import MonitorGroupView from "../../../../App/FeatureSet/Dashboard/src/Pages/MonitorGroup/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { resolveSection } from "../../../../App/FeatureSet/Dashboard/src/Utils/OverviewSection";
import {
  ChartTimeRangeZoomContextValue,
  TimeRangeZoomScope,
  useChartTimeRangeZoom,
} from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import Route from "../../../Types/API/Route";
import {
  MonitorUptimeSummary,
  MonitorUptimeSummaryStatus,
  MonitorUptimeWindowKey,
} from "../../../Types/Monitor/MonitorUptimeSummary";
import UptimeBarTooltipIncident from "../../../Types/Monitor/UptimeBarTooltipIncident";
import ObjectID from "../../../Types/ObjectID";
import { UptimeDayBucket } from "../../../Types/StatusPage/UptimeDailyAggregate";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const START: Date = new Date("2026-06-24T00:00:00.000Z");
const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OPERATIONAL_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OFFLINE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const STATUSES: Array<MonitorUptimeSummaryStatus> = [
  {
    id: OPERATIONAL_ID,
    name: "Operational",
    color: "#10B981",
    isOperationalState: true,
    isOfflineState: false,
    priority: 1,
  },
  {
    id: OFFLINE_ID,
    name: "Offline",
    color: "#EF4444",
    isOperationalState: false,
    isOfflineState: true,
    priority: 3,
  },
];

const BUCKETS: Array<UptimeDayBucket> = [
  {
    bucketStart: new Date("2026-09-20T00:00:00.000Z"),
    bucketEnd: new Date("2026-09-21T00:00:00.000Z"),
    daySeconds: 86400,
    coveredSeconds: 86400,
    statusDurations: [
      { monitorStatusId: OPERATIONAL_ID, seconds: 86000 },
      { monitorStatusId: OFFLINE_ID, seconds: 400 },
    ],
  },
];

const SUMMARY: MonitorUptimeSummary = {
  monitorId: MONITOR_ID,
  timezone: "UTC",
  generatedAt: NOW,
  startDate: START,
  endDate: NOW,
  buckets: BUCKETS,
  windows: [
    {
      key: MonitorUptimeWindowKey.Last90Days,
      startDate: START,
      endDate: NOW,
      windowSeconds: 90 * 86400 - 12 * 3600,
      coveredSeconds: 90 * 86400 - 12 * 3600,
      statusDurations: [
        {
          monitorStatusId: OPERATIONAL_ID,
          seconds: 90 * 86400 - 12 * 3600 - 7776,
        },
        { monitorStatusId: OFFLINE_ID, seconds: 7776 },
      ],
    },
  ],
  isComplete: true,
  completeFrom: null,
  statuses: STATUSES,
};

// The page's range, zoomed to one hour before the strips are touched.
const PAGE_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_DAY,
};
const ZOOM_START: Date = new Date("2026-09-21T10:00:00.000Z");
const ZOOM_END: Date = new Date("2026-09-21T11:00:00.000Z");

let mockPageZoom: ChartTimeRangeZoomContextValue | null = null;

const ZoomProbe: React.FunctionComponent = (): ReactElement => {
  mockPageZoom = useChartTimeRangeZoom();
  return (
    <span data-testid="page-is-zoomed">{String(mockPageZoom?.isZoomed)}</span>
  );
};

/*
 * A page that zooms, holding the strip under test. Its range is shown so
 * a strip that retimed (or reset) the page would be seen doing it.
 */
const ZoomingPage: React.FunctionComponent<{
  children: ReactElement;
}> = (props: { children: ReactElement }): ReactElement => {
  const [timeRange, setTimeRange] =
    React.useState<RangeStartAndEndDateTime>(PAGE_RANGE);
  return (
    <TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={setTimeRange}>
      <span data-testid="page-range">
        {timeRange.range === TimeRange.CUSTOM && timeRange.startAndEndDate
          ? `${timeRange.startAndEndDate.startValue.toISOString()}/${timeRange.startAndEndDate.endValue.toISOString()}`
          : timeRange.range}
      </span>
      <ZoomProbe />
      {props.children}
    </TimeRangeZoomScope>
  );
};

const ZOOMED_PAGE_RANGE: string = `${ZOOM_START.toISOString()}/${ZOOM_END.toISOString()}`;

function zoomThePage(): void {
  // Zoomed from somewhere else on the page, as a time-series chart would.
  act(() => {
    mockPageZoom?.onTimeRangeSelect(ZOOM_START, ZOOM_END);
  });
  expect(screen.getByTestId("page-range")).toHaveTextContent(ZOOMED_PAGE_RANGE);
  expect(screen.getByTestId("page-is-zoomed")).toHaveTextContent("true");
}

/*
 * Every gesture a zoomable chart listens for: a press, a drag across the
 * bars, the release (inside and past the strip), a double-click.
 */
function dragAndDoubleClickAcross(strip: HTMLElement): void {
  const bars: Array<HTMLElement> = within(strip).getAllByTestId("uptime-bar");
  const from: HTMLElement = bars[10]!;
  const to: HTMLElement = bars[40]!;

  fireEvent.mouseDown(from, { clientX: 10, clientY: 5, button: 0 });
  fireEvent.mouseMove(to, { clientX: 200, clientY: 5, buttons: 1 });
  fireEvent.mouseUp(to, { clientX: 200, clientY: 5, button: 0 });
  fireEvent.mouseDown(from, { clientX: 10, clientY: 5, button: 0 });
  fireEvent.mouseMove(to, { clientX: 200, clientY: 5, buttons: 1 });
  fireEvent.mouseUp(window, { clientX: 900, clientY: 5, button: 0 });
  fireEvent.doubleClick(to);
  fireEvent.doubleClick(strip);
}

function expectNoZoomAffordance(container: HTMLElement): void {
  expect(within(container).queryByText(/Drag to zoom/)).toBeNull();
  expect(container.querySelector(".cursor-crosshair")).toBeNull();
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  mockPageZoom = null;
  getListMock.mockReset();
  postMock.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("the monitor Overview's uptime history strip stays out of the zoom", () => {
  function renderCard(): void {
    render(
      <MemoryRouter>
        <ZoomingPage>
          <MonitorUptimeHistoryCard
            summary={resolveSection<MonitorUptimeSummary>({
              value: SUMMARY,
              subjectId: MONITOR_ID.toString(),
            })}
            incidents={resolveSection<Array<UptimeBarTooltipIncident>>({
              value: [],
              subjectId: MONITOR_ID.toString(),
            })}
            monitorCreatedAt={new Date("2025-01-01T00:00:00.000Z")}
            onRetry={() => {}}
          />
        </ZoomingPage>
      </MemoryRouter>,
    );
  }

  test("a drag and a double-click on the strip leave the zoomed page alone", () => {
    renderCard();
    zoomThePage();

    const strip: HTMLElement = screen.getByTestId("day-uptime-graph");
    dragAndDoubleClickAcross(strip);

    // Neither a new zoom nor the reset the page had on offer.
    expect(screen.getByTestId("page-range")).toHaveTextContent(
      ZOOMED_PAGE_RANGE,
    );
    expect(screen.getByTestId("page-is-zoomed")).toHaveTextContent("true");
  });

  test("the strip keeps its 90 days, with no drag affordance, while the page is zoomed", () => {
    renderCard();
    zoomThePage();

    const strip: HTMLElement = screen.getByTestId("day-uptime-graph");
    expect(within(strip).getAllByTestId("uptime-bar")).toHaveLength(90);
    expectNoZoomAffordance(document.body);
  });

  test("a bar is still a button that opens its day", () => {
    renderCard();
    zoomThePage();

    const bars: Array<HTMLElement> = screen.getAllByTestId("uptime-bar");
    fireEvent.click(bars[bars.length - 2]!);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("page-range")).toHaveTextContent(
      ZOOMED_PAGE_RANGE,
    );
  });
});

describe("the monitor group view's uptime graph stays out of the zoom", () => {
  const PAGE_PROPS: PageComponentProps = {
    pageRoute: new Route("/dashboard/monitor-groups/view"),
    currentProject: null,
    hasPaymentMethod: true,
  };

  async function renderGroupView(): Promise<void> {
    const operational: MonitorStatus = new MonitorStatus();
    operational.id = OPERATIONAL_ID;
    operational.name = "Operational";
    operational.isOperationalState = true;
    getListMock.mockImplementation((...args: Array<unknown>) => {
      const request: { modelType: unknown } = args[0] as {
        modelType: unknown;
      };
      const data: Array<unknown> =
        request.modelType === MonitorStatus ? [operational] : [];
      return Promise.resolve({
        data: data,
        count: data.length,
        skip: 0,
        limit: 10000,
      });
    });
    postMock.mockResolvedValue(operational);

    render(
      <MemoryRouter>
        <ZoomingPage>
          <MonitorGroupView {...PAGE_PROPS} />
        </ZoomingPage>
      </MemoryRouter>,
    );
    await screen.findByTestId("day-uptime-graph");
  }

  test("a drag and a double-click on the graph leave the zoomed page alone", async () => {
    await renderGroupView();
    zoomThePage();

    dragAndDoubleClickAcross(screen.getByTestId("day-uptime-graph"));

    expect(screen.getByTestId("page-range")).toHaveTextContent(
      ZOOMED_PAGE_RANGE,
    );
    expect(screen.getByTestId("page-is-zoomed")).toHaveTextContent("true");
  });

  test("the graph keeps its 90 days, with no drag affordance, while the page is zoomed", async () => {
    await renderGroupView();
    zoomThePage();

    // Ninety days back to today, whatever hour the page is zoomed to.
    const bars: Array<HTMLElement> = within(
      screen.getByTestId("day-uptime-graph"),
    ).getAllByTestId("uptime-bar");
    expect(bars[0]!.getAttribute("aria-label")).toMatch(/^Jun 23, 2026/);
    expect(bars[bars.length - 1]!.getAttribute("aria-label")).toMatch(
      /^Sep 21, 2026/,
    );
    expectNoZoomAffordance(document.body);
  });
});

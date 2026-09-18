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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { MockFunction } from "../../MockType";

configure({ asyncUtilTimeout: 15000 });

/*
 * The Security Events page: a volume chart stacked by severity over the page's
 * time window, above the events table. What is pinned here is the wiring that
 * only shows once the pieces are together - the window the range picker sets
 * reaching both the table and the chart, the chart counting exactly what the
 * table reports it lists, drag-to-zoom and Refresh moving both, the URL
 * carrying the window, and the empty table telling "nothing in this window"
 * apart from "nothing ever".
 *
 * The data layer is stubbed (AnalyticsModelAPI), as is the table itself: its
 * half of the contract - reporting the query it lists with - is pinned against
 * a real BaseModelTable in BaseModelTableQueryChange.test.tsx, and the stub
 * below honours it the same way (once on mount, again when the query moves).
 */

interface CapturedTableProps {
  id?: string;
  query: Record<string, unknown>;
  onQueryChange?: (query: Record<string, unknown>) => void;
  refreshToggle?: string;
  noItemsMessage?: ReactElement;
  showRefreshButton?: boolean;
  filters: Array<{ field: Record<string, boolean>; title: string }>;
}

let tableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/AnalyticsModelTable", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: CapturedTableProps): ReactElement => {
      tableProps = props;
      const queryKey: string = JSON.stringify(props.query);

      react.useEffect(() => {
        props.onQueryChange?.(props.query);
      }, [queryKey]);

      return react.createElement(
        "div",
        { "data-testid": "security-events-analytics-table" },
        props.noItemsMessage || null,
      );
    },
  };
});

interface CapturedPickerProps {
  value: { range: string; startAndEndDate?: unknown };
  onChange: (value: unknown) => void;
}

let pickerProps: CapturedPickerProps | null = null;

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;

    return {
      __esModule: true,
      default: (props: CapturedPickerProps): ReactElement => {
        pickerProps = props;
        return react.createElement(
          "div",
          { "data-testid": "time-range-picker" },
          props.value.range,
        );
      },
    };
  },
);

// See TelemetryHistogramDragTooltip.test.tsx: one div per bucket, so a drag can be driven.
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
    Tooltip: () => {
      return null;
    },
    ReferenceArea: () => {
      return null;
    },
  };
});

import SecurityEventsExplorer, {
  SECURITY_EVENTS_REFRESH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsExplorer";
import SecurityEventsEmptyState from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsEmptyState";
import SecurityEventsNoResults, {
  SECURITY_EVENTS_NO_RESULTS_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsNoResults";
import { SECURITY_EVENTS_VOLUME_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsVolumeChart";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import AggregateBy from "../../../Types/BaseDatabase/AggregateBy";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import TimeRange from "../../../Types/Time/TimeRange";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const NOW: Date = new Date("2026-09-18T12:00:00.000Z");
const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

let now: Date = NOW;

type AggregateCall = { aggregateBy: AggregateBy<SecurityEvent> };

/*
 * aggregate and getList are generic statics, which spyOn's typing cannot
 * express as a SpiedFunction of the method; the calls are read back untyped
 * and cast where they are inspected.
 */
let aggregateMock: MockFunction;
let getListMock: MockFunction;

function row(
  timestamp: string,
  severity: OcsfSeverity,
  value: number,
): AggregatedModel {
  return {
    timestamp: timestamp as unknown as Date,
    value: value,
    severityName: severity,
  };
}

const SOME_EVENTS: Array<AggregatedModel> = [
  row("2026-09-18T10:00:00.000Z", OcsfSeverity.High, 3),
  row("2026-09-18T10:15:00.000Z", OcsfSeverity.Critical, 1),
  row("2026-09-18T10:30:00.000Z", OcsfSeverity.Informational, 3),
];

function resolvesWith(rows: Array<AggregatedModel>): void {
  aggregateMock.mockImplementation(async (): Promise<AggregatedResult> => {
    return { data: rows };
  });
}

function aggregateCalls(): Array<AggregateBy<SecurityEvent>> {
  return aggregateMock.mock.calls.map(
    (call: Array<unknown>): AggregateBy<SecurityEvent> => {
      return (call[0] as AggregateCall).aggregateBy;
    },
  );
}

function lastAggregate(): AggregateBy<SecurityEvent> {
  const calls: Array<AggregateBy<SecurityEvent>> = aggregateCalls();
  return calls[calls.length - 1]!;
}

function tableWindow(): { start: string; end: string } {
  const time: InBetween<Date> = tableProps!.query["time"] as InBetween<Date>;
  expect(time).toBeInstanceOf(InBetween);
  return {
    start: new Date(time.startValue).toISOString(),
    end: new Date(time.endValue).toISOString(),
  };
}

function urlParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function renderExplorer(): void {
  render(
    <MemoryRouter>
      <SecurityEventsExplorer />
    </MemoryRouter>,
  );
}

async function waitForCounts(calls: number = 1): Promise<void> {
  await waitFor(() => {
    expect(aggregateMock).toHaveBeenCalledTimes(calls);
  });
  await waitFor(() => {
    expect(
      screen.getByTestId(SECURITY_EVENTS_VOLUME_TEST_ID),
    ).not.toHaveAttribute("aria-busy", "true");
  });
}

function totalText(): string {
  return (
    screen.getByTestId(`${SECURITY_EVENTS_VOLUME_TEST_ID}-total`).textContent ||
    ""
  );
}

beforeEach(() => {
  tableProps = null;
  pickerProps = null;
  now = NOW;
  window.history.replaceState(null, "", "/dashboard/project/security-events");
  TableFilterUrlState.resetClaimedKeys();
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(now.getTime());
  });
  aggregateMock = jest.spyOn(
    AnalyticsModelAPI,
    "aggregate",
  ) as unknown as MockFunction;
  getListMock = jest.spyOn(
    AnalyticsModelAPI,
    "getList",
  ) as unknown as MockFunction;
  resolvesWith(SOME_EVENTS);
  getListMock.mockImplementation(async (): Promise<ListResult<never>> => {
    return { data: [], count: 0, skip: 0, limit: 1 };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("SecurityEventsExplorer: the window", () => {
  test("opens on the past day, scoped to the current project", async () => {
    renderExplorer();
    await waitForCounts();

    expect(tableProps!.query["projectId"]).toBe(PROJECT_ID);
    expect(tableWindow()).toEqual({
      start: new Date(NOW.getTime() - DAY_MS).toISOString(),
      end: NOW.toISOString(),
    });
    expect(pickerProps!.value).toEqual({ range: TimeRange.PAST_ONE_DAY });
  });

  test("puts the window in the URL, relative ranges without dates", async () => {
    renderExplorer();
    await waitForCounts();

    expect(urlParams().get("range")).toBe(TimeRange.PAST_ONE_DAY);
    expect(urlParams().get("start")).toBeNull();
    expect(urlParams().get("end")).toBeNull();
  });

  test("opens on the window a link names", async () => {
    window.history.replaceState(
      null,
      "",
      "/dashboard/project/security-events?range=Custom&start=2026-09-10T00:00:00.000Z&end=2026-09-11T00:00:00.000Z",
    );

    renderExplorer();
    await waitForCounts();

    expect(tableWindow()).toEqual({
      start: "2026-09-10T00:00:00.000Z",
      end: "2026-09-11T00:00:00.000Z",
    });
    expect(pickerProps!.value.range).toBe(TimeRange.CUSTOM);
  });

  test("honours an older link that set the window as a table time filter", async () => {
    const params: Record<string, string> =
      TableFilterUrlState.getLinkQueryParams("security-events-table", {
        filter: {
          time: new InBetween<Date>(
            new Date("2026-09-12T08:00:00.000Z"),
            new Date("2026-09-12T09:00:00.000Z"),
          ),
        },
      });
    window.history.replaceState(
      null,
      "",
      `/dashboard/project/security-events?security-events-table-filter=${params["security-events-table-filter"]}`,
    );

    renderExplorer();
    await waitForCounts();

    expect(tableWindow()).toEqual({
      start: "2026-09-12T08:00:00.000Z",
      end: "2026-09-12T09:00:00.000Z",
    });
    expect(urlParams().get("range")).toBe(TimeRange.CUSTOM);
    expect(urlParams().get("start")).toBe("2026-09-12T08:00:00.000Z");
  });

  test("picking a range moves the table, the chart and the URL", async () => {
    renderExplorer();
    await waitForCounts();

    act(() => {
      pickerProps!.onChange({ range: TimeRange.PAST_ONE_WEEK });
    });
    await waitForCounts(2);

    expect(tableWindow()).toEqual({
      start: new Date(NOW.getTime() - 7 * DAY_MS).toISOString(),
      end: NOW.toISOString(),
    });
    expect(new Date(lastAggregate().startTimestamp).toISOString()).toBe(
      new Date(NOW.getTime() - 7 * DAY_MS).toISOString(),
    );
    expect(urlParams().get("range")).toBe(TimeRange.PAST_ONE_WEEK);
  });

  test("a re-render does not move a relative window on its own", async () => {
    renderExplorer();
    await waitForCounts();

    const before: { start: string; end: string } = tableWindow();
    now = new Date(NOW.getTime() + 10 * MINUTE_MS);

    // Anything that re-renders the page: here, the table reporting a filter.
    act(() => {
      tableProps!.onQueryChange!({
        ...tableProps!.query,
        severityName: new Includes([OcsfSeverity.High]),
      });
    });
    await waitForCounts(2);

    expect(tableWindow()).toEqual(before);
  });
});

describe("SecurityEventsExplorer: the chart", () => {
  test("counts exactly the query the table reports it lists", async () => {
    renderExplorer();
    await waitForCounts();

    expect(lastAggregate().query).toEqual(tableProps!.query);
    expect(lastAggregate().groupBy).toEqual({ severityName: true });
    expect(lastAggregate().aggregationTimestampColumnName).toBe("time");
    expect(new Date(lastAggregate().startTimestamp).toISOString()).toBe(
      tableWindow().start,
    );
    expect(new Date(lastAggregate().endTimestamp).toISOString()).toBe(
      tableWindow().end,
    );
  });

  test("a filter applied in the table recounts the chart with it", async () => {
    renderExplorer();
    await waitForCounts();

    const filtered: Record<string, unknown> = {
      ...tableProps!.query,
      severityName: new Includes([OcsfSeverity.High, OcsfSeverity.Critical]),
      className: "Authentication",
    };

    act(() => {
      tableProps!.onQueryChange!(filtered);
    });
    await waitForCounts(2);

    expect(lastAggregate().query).toBe(filtered);
  });

  test("shows the window's total and its split by severity", async () => {
    renderExplorer();
    await waitForCounts();

    expect(totalText()).toBe("7 events");

    const severities: HTMLElement = screen.getByRole("list", {
      name: "Events by severity",
    });
    expect(
      within(severities)
        .getAllByRole("listitem")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        }),
    ).toEqual(["Critical1", "High3", "Informational3"]);
  });

  test("lays out every quarter hour of the day, quiet ones included", async () => {
    renderExplorer();
    await waitForCounts();

    expect(
      within(screen.getByTestId("bar-chart")).getAllByTestId(/^bucket-/),
    ).toHaveLength(97);
  });

  test("counts for a window the page has left do not land on the new one", async () => {
    let releaseFirst: (result: AggregatedResult) => void = () => {};

    aggregateMock.mockImplementationOnce((): Promise<AggregatedResult> => {
      return new Promise<AggregatedResult>(
        (resolve: (result: AggregatedResult) => void) => {
          releaseFirst = resolve;
        },
      );
    });

    renderExplorer();
    await waitFor(() => {
      expect(aggregateMock).toHaveBeenCalledTimes(1);
    });

    act(() => {
      pickerProps!.onChange({ range: TimeRange.PAST_ONE_HOUR });
    });
    await waitForCounts(2);
    expect(totalText()).toBe("7 events");

    await act(async () => {
      releaseFirst({
        data: [row("2026-09-18T11:00:00.000Z", OcsfSeverity.Low, 500)],
      });
    });

    expect(totalText()).toBe("7 events");
  });

  test("a failed count says so, and Refresh? counts again", async () => {
    aggregateMock.mockRejectedValueOnce(new Error("ClickHouse is down"));

    renderExplorer();

    await waitFor(() => {
      expect(
        screen.getByTestId(`${SECURITY_EVENTS_VOLUME_TEST_ID}-error`),
      ).toHaveTextContent("ClickHouse is down");
    });

    fireEvent.click(screen.getByTestId("refresh-button"));
    await waitForCounts(2);

    expect(
      screen.queryByTestId(`${SECURITY_EVENTS_VOLUME_TEST_ID}-error`),
    ).toBeNull();
    expect(totalText()).toBe("7 events");
  });

  test("an empty window says so in place of an empty axis", async () => {
    resolvesWith([]);

    renderExplorer();
    await waitForCounts();

    expect(
      screen.getByTestId(`${SECURITY_EVENTS_VOLUME_TEST_ID}-empty`),
    ).toHaveTextContent("No security events in this time range.");
    expect(totalText()).toBe("0 events");
  });
});

describe("SecurityEventsExplorer: zooming", () => {
  async function dragAcross(from: string, to: string): Promise<void> {
    await act(async () => {
      fireEvent.mouseDown(screen.getByTestId(`bucket-${from}`));
    });
    await act(async () => {
      fireEvent.mouseMove(screen.getByTestId(`bucket-${to}`));
    });
    await act(async () => {
      fireEvent.mouseUp(screen.getByTestId(`bucket-${to}`));
    });
  }

  test("dragging across the chart zooms the page into the buckets dragged over", async () => {
    renderExplorer();
    await waitForCounts();

    await dragAcross("2026-09-18T10:00:00.000Z", "2026-09-18T10:30:00.000Z");
    await waitForCounts(2);

    // The last bucket dragged over is kept whole: 10:30 + 15 minutes.
    expect(tableWindow()).toEqual({
      start: "2026-09-18T10:00:00.000Z",
      end: "2026-09-18T10:45:00.000Z",
    });
    expect(pickerProps!.value.range).toBe(TimeRange.CUSTOM);
    expect(urlParams().get("range")).toBe(TimeRange.CUSTOM);
    expect(urlParams().get("start")).toBe("2026-09-18T10:00:00.000Z");
    expect(urlParams().get("end")).toBe("2026-09-18T10:45:00.000Z");
  });

  test("double-clicking after a zoom returns to the window before it", async () => {
    renderExplorer();
    await waitForCounts();

    await dragAcross("2026-09-18T10:00:00.000Z", "2026-09-18T10:30:00.000Z");
    await waitForCounts(2);

    expect(screen.getByText("Double-click to zoom out")).toBeInTheDocument();

    fireEvent.doubleClick(
      screen.getByTestId("bar-chart").parentElement!.parentElement!,
    );
    await waitForCounts(3);

    expect(pickerProps!.value).toEqual({ range: TimeRange.PAST_ONE_DAY });
    expect(urlParams().get("range")).toBe(TimeRange.PAST_ONE_DAY);
  });

  test("the chart offers drag-to-zoom", async () => {
    renderExplorer();
    await waitForCounts();

    expect(screen.getByText("Drag to zoom")).toBeInTheDocument();
  });
});

describe("SecurityEventsExplorer: Refresh", () => {
  test("on a relative range, re-reads the window from now", async () => {
    renderExplorer();
    await waitForCounts();

    const toggleBefore: string | undefined = tableProps!.refreshToggle;
    now = new Date(NOW.getTime() + 5 * MINUTE_MS);

    fireEvent.click(screen.getByTestId(SECURITY_EVENTS_REFRESH_TEST_ID));
    await waitForCounts(2);

    expect(tableWindow().end).toBe(now.toISOString());
    expect(new Date(lastAggregate().endTimestamp).toISOString()).toBe(
      now.toISOString(),
    );
    // The query moved, which refetches the table; no second nudge on top.
    expect(tableProps!.refreshToggle).toBe(toggleBefore);
  });

  test("on a custom range, refetches the same window", async () => {
    window.history.replaceState(
      null,
      "",
      "/dashboard/project/security-events?range=Custom&start=2026-09-10T00:00:00.000Z&end=2026-09-11T00:00:00.000Z",
    );

    renderExplorer();
    await waitForCounts();

    const toggleBefore: string | undefined = tableProps!.refreshToggle;

    fireEvent.click(screen.getByTestId(SECURITY_EVENTS_REFRESH_TEST_ID));
    await waitForCounts(2);

    expect(tableProps!.refreshToggle).not.toBe(toggleBefore);
    expect(tableWindow()).toEqual({
      start: "2026-09-10T00:00:00.000Z",
      end: "2026-09-11T00:00:00.000Z",
    });
    expect(new Date(lastAggregate().startTimestamp).toISOString()).toBe(
      "2026-09-10T00:00:00.000Z",
    );
  });
});

describe("SecurityEventsExplorer: the table", () => {
  test("is the security events table, without a Time filter or a Refresh of its own", async () => {
    renderExplorer();
    await waitForCounts();

    expect(tableProps!.id).toBe("security-events-table");
    expect(tableProps!.showRefreshButton).toBe(false);
    expect(
      tableProps!.filters.map((filter: { field: Record<string, boolean> }) => {
        return Object.keys(filter.field)[0];
      }),
    ).not.toContain("time");
    expect(
      tableProps!.filters.map((filter: { title: string }) => {
        return filter.title;
      }),
    ).toEqual(
      expect.arrayContaining(["Severity", "Event Class", "Observable"]),
    );
  });

  test("with events in the window, never asks when the newest event arrived", async () => {
    renderExplorer();
    await waitForCounts();

    expect(getListMock).not.toHaveBeenCalled();
  });

  test("an empty window in a project that has never received an event keeps the setup guide", async () => {
    resolvesWith([]);

    renderExplorer();
    await waitForCounts();

    await waitFor(() => {
      expect(tableProps!.noItemsMessage?.type).toBe(SecurityEventsEmptyState);
    });

    expect(getListMock).toHaveBeenCalledTimes(1);
    const lookup: {
      query: Record<string, unknown>;
      limit: number;
      sort: Record<string, unknown>;
    } = getListMock.mock.calls[0]![0] as never;
    // The whole project, not the window: "has anything ever arrived?"
    expect(lookup.query).toEqual({ projectId: PROJECT_ID });
    expect(lookup.limit).toBe(1);
    expect(lookup.sort).toEqual({ time: SortOrder.Descending });
  });

  test("an empty window in a project with older events offers the range that reaches them", async () => {
    resolvesWith([]);
    getListMock.mockImplementation(async (): Promise<ListResult<never>> => {
      const event: SecurityEvent = new SecurityEvent();
      event.time = new Date(NOW.getTime() - 3 * DAY_MS);
      return { data: [event as never], count: 1, skip: 0, limit: 1 };
    });

    renderExplorer();
    await waitForCounts();

    // The careful message shows first; wait for the lookup to sharpen it.
    await waitFor(() => {
      expect(
        document.getElementById(SECURITY_EVENTS_NO_RESULTS_ID),
      ).toHaveTextContent("The most recent security event arrived");
    });

    expect(tableProps!.noItemsMessage?.type).toBe(SecurityEventsNoResults);
    const message: HTMLElement = document.getElementById(
      SECURITY_EVENTS_NO_RESULTS_ID,
    ) as HTMLElement;
    expect(message).toHaveTextContent("No security events in this time range");

    fireEvent.click(
      within(message).getByRole("button", { name: "Show past 1 week" }),
    );
    await waitForCounts(2);

    expect(pickerProps!.value).toEqual({ range: TimeRange.PAST_ONE_WEEK });
    expect(tableWindow().start).toBe(
      new Date(NOW.getTime() - 7 * DAY_MS).toISOString(),
    );
  });

  test("until the lookup answers, the empty table says only what is certain", async () => {
    resolvesWith([]);
    getListMock.mockImplementation((): Promise<ListResult<never>> => {
      return new Promise<ListResult<never>>(() => {});
    });

    renderExplorer();
    await waitForCounts();

    expect(tableProps!.noItemsMessage?.type).toBe(SecurityEventsNoResults);
    expect(
      document.getElementById(SECURITY_EVENTS_NO_RESULTS_ID),
    ).toHaveTextContent("Try a wider time range");
  });

  test("a failed lookup falls back to the same careful message", async () => {
    resolvesWith([]);
    getListMock.mockRejectedValue(new Error("nope"));

    renderExplorer();
    await waitForCounts();

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalled();
    });
    expect(tableProps!.noItemsMessage?.type).toBe(SecurityEventsNoResults);
    expect(
      document.getElementById(SECURITY_EVENTS_NO_RESULTS_ID),
    ).toHaveTextContent("Try a wider time range");
  });
});

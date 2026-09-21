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
 * The Security Events explorer.
 *
 * It is the same shell the traces, metrics and exceptions explorers render —
 * search bar, facet sidebar, severity-stacked volume histogram, dense rows, a
 * detail drawer and pagination — over the SecurityEvent ClickHouse table,
 * replacing the model table this page used to be.
 *
 * What is pinned here is the wiring that only shows once the pieces are
 * together: that the list, the histogram and EVERY facet count are built from
 * one query (so the chart never counts events the list would not show, and a
 * facet count never promises rows a click cannot reach), that every way of
 * narrowing writes itself into the URL and is read back from it, and that an
 * empty list tells "nothing in this window" apart from "nothing ever".
 *
 * The data layer is stubbed at AnalyticsModelAPI / ModelAPI; the shell itself
 * is real, so the assertions are about what a reader sees.
 */

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

// One div per bucket, so a drag across the histogram can be driven.
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

import SecurityEventsViewer, {
  SECURITY_EVENTS_VOLUME_TOTAL_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsViewer";
import SecurityEventAttributeUtil from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventAttributeUtil";
import { SECURITY_EVENT_ROW_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventListRow";
import { SECURITY_EVENT_DETAIL_PANEL_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventDetailPanel";
import { SECURITY_EVENTS_EMPTY_STATE_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsEmptyState";
import { SECURITY_EVENTS_NO_RESULTS_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsNoResults";
import {
  SECURITY_EVENT_FACET_KEYS,
  SECURITY_EVENT_SOURCE_FACET_KEY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsFacets";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import AggregateBy from "../../../Types/BaseDatabase/AggregateBy";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import TimeRange from "../../../Types/Time/TimeRange";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import Service from "../../../Models/DatabaseModels/Service";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SOURCE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const NOW: Date = new Date("2026-09-18T12:00:00.000Z");
const DAY_MS: number = 24 * 60 * 60 * 1000;

let now: Date = NOW;

let aggregateMock: MockFunction;
let getListMock: MockFunction;
let modelListMock: MockFunction;
let attributeKeysMock: MockFunction;

function event(fields: Partial<SecurityEvent> = {}): SecurityEvent {
  return Object.assign(new SecurityEvent(), {
    time: new Date("2026-09-18T10:00:00.000Z"),
    eventUid: "uid-1",
    severityName: OcsfSeverity.Critical,
    className: "Authentication",
    message: "Failed logon for alice",
    principalUser: "alice",
    ...fields,
  });
}

const EVENTS: Array<SecurityEvent> = [
  event(),
  event({
    eventUid: "uid-2",
    severityName: OcsfSeverity.Low,
    className: "DNS Activity",
    message: "Resolved internal.example.com",
    principalUser: "bob",
  }),
];

/*
 * The aggregate stub answers facet GROUP BYs with values keyed by the facet
 * column, and the volume aggregate with time-bucketed severity counts. Which
 * one it is asked for is read off the aggregateBy, exactly as the server
 * would.
 */
function stubAggregates(): void {
  aggregateMock.mockImplementation(
    async (data: {
      aggregateBy: AggregateBy<SecurityEvent>;
    }): Promise<AggregatedResult> => {
      const groupBy: Record<string, boolean> =
        (data.aggregateBy.groupBy as unknown as Record<string, boolean>) || {};
      const facetKey: string | undefined = Object.keys(groupBy)[0];

      if (data.aggregateBy.aggregationInterval === "Total") {
        if (facetKey === "severityName") {
          return {
            data: [
              { timestamp: NOW, value: 4, severityName: OcsfSeverity.Critical },
              { timestamp: NOW, value: 9, severityName: OcsfSeverity.Low },
            ],
          } as unknown as AggregatedResult;
        }

        if (facetKey === SECURITY_EVENT_SOURCE_FACET_KEY) {
          return {
            data: [
              {
                timestamp: NOW,
                value: 13,
                [SECURITY_EVENT_SOURCE_FACET_KEY]: SOURCE_ID.toString(),
              },
            ],
          } as unknown as AggregatedResult;
        }

        return { data: [] } as unknown as AggregatedResult;
      }

      return {
        data: [
          {
            timestamp: "2026-09-18T10:00:00.000Z",
            value: 4,
            severityName: OcsfSeverity.Critical,
          },
          {
            timestamp: "2026-09-18T10:15:00.000Z",
            value: 9,
            severityName: OcsfSeverity.Low,
          },
        ],
      } as unknown as AggregatedResult;
    },
  );
}

function stubList(
  events: Array<SecurityEvent> = EVENTS,
  count: number = events.length,
): void {
  getListMock.mockImplementation(
    async (data: { limit: number }): Promise<ListResult<SecurityEvent>> => {
      /*
       * The "has this project EVER had an event" probe asks for one row with
       * only `time` selected; every other call is the list.
       */
      if (data.limit === 1) {
        return {
          data: events.length > 0 ? [events[0]!] : [],
          count: events.length,
          skip: 0,
          limit: 1,
        };
      }

      /*
       * Fresh objects every call, as the real API hands back: a viewer that
       * tracked the open row by reference would lose its highlight on the
       * first refresh.
       */
      return {
        data: events.map((listed: SecurityEvent): SecurityEvent => {
          return Object.assign(new SecurityEvent(), listed);
        }),
        count,
        skip: 0,
        limit: data.limit,
      };
    },
  );
}

function listCalls(): Array<Record<string, unknown>> {
  return getListMock.mock.calls
    .map((call: Array<unknown>): Record<string, unknown> => {
      return call[0] as Record<string, unknown>;
    })
    .filter((call: Record<string, unknown>): boolean => {
      return call["limit"] !== 1;
    });
}

function lastListCall(): Record<string, unknown> {
  const calls: Array<Record<string, unknown>> = listCalls();
  return calls[calls.length - 1]!;
}

function listQuery(): Record<string, unknown> {
  return lastListCall()["query"] as Record<string, unknown>;
}

function aggregateCalls(): Array<AggregateBy<SecurityEvent>> {
  return aggregateMock.mock.calls.map(
    (call: Array<unknown>): AggregateBy<SecurityEvent> => {
      return (call[0] as { aggregateBy: AggregateBy<SecurityEvent> })
        .aggregateBy;
    },
  );
}

function facetAggregates(): Array<AggregateBy<SecurityEvent>> {
  return aggregateCalls().filter(
    (aggregate: AggregateBy<SecurityEvent>): boolean => {
      return String(aggregate.aggregationInterval) === "Total";
    },
  );
}

function volumeAggregates(): Array<AggregateBy<SecurityEvent>> {
  return aggregateCalls().filter(
    (aggregate: AggregateBy<SecurityEvent>): boolean => {
      return String(aggregate.aggregationInterval) !== "Total";
    },
  );
}

function urlParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function renderViewer(): void {
  render(
    <MemoryRouter>
      <SecurityEventsViewer />
    </MemoryRouter>,
  );
}

async function waitForLoad(): Promise<void> {
  await waitFor(() => {
    expect(listCalls().length).toBeGreaterThan(0);
  });
  await waitFor(() => {
    expect(facetAggregates().length).toBe(SECURITY_EVENT_FACET_KEYS.length);
  });
  // The volume total stops saying "Counting..." once the chart has its data.
  await waitFor(() => {
    expect(
      screen.getByTestId(SECURITY_EVENTS_VOLUME_TOTAL_TEST_ID),
    ).not.toHaveTextContent("Counting");
  });
  // And the list has either rows or one of its two empty states.
  await waitFor(() => {
    expect(
      rows().length > 0 ||
        document.getElementById(SECURITY_EVENTS_EMPTY_STATE_ID) !== null ||
        document.getElementById(SECURITY_EVENTS_NO_RESULTS_ID) !== null,
    ).toBe(true);
  });
}

function rows(): Array<HTMLElement> {
  return screen.queryAllByTestId(SECURITY_EVENT_ROW_TEST_ID);
}

function searchInput(): HTMLInputElement {
  return screen.getByPlaceholderText(
    /Search security events/i,
  ) as HTMLInputElement;
}

async function submitSearch(text: string): Promise<void> {
  fireEvent.change(searchInput(), { target: { value: text } });
  fireEvent.keyDown(searchInput(), { key: "Enter", code: "Enter" });

  await waitFor(() => {
    expect(String((listQuery()["message"] as Search<string>) ?? "")).toContain(
      "",
    );
  });
}

/*
 * A facet section by its header title. Sections whose facet has no values in
 * the window fold away entirely (hideWhenEmpty), so asking for one is also an
 * assertion that it has something to show.
 */
function facetSection(title: string): HTMLElement {
  const label: Element | undefined = Array.from(
    document.querySelectorAll("span.uppercase"),
  ).find((node: Element): boolean => {
    return (node.textContent || "").trim() === title;
  });

  if (!label) {
    throw new Error(
      `No facet section titled "${title}". Sections rendered: ${Array.from(
        document.querySelectorAll("span.uppercase"),
      )
        .map((node: Element): string => {
          return (node.textContent || "").trim();
        })
        .join(", ")}`,
    );
  }

  const section: HTMLElement | null = label.closest("div.border-b");

  if (!section) {
    throw new Error(`Facet section "${title}" has no container.`);
  }

  return section as HTMLElement;
}

beforeEach(() => {
  pickerProps = null;
  now = NOW;
  window.history.replaceState(null, "", "/dashboard/project/security-events");

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
  modelListMock = jest.spyOn(ModelAPI, "getList") as unknown as MockFunction;
  attributeKeysMock = jest.spyOn(
    SecurityEventAttributeUtil,
    "getAttributeKeys",
  ) as unknown as MockFunction;

  stubAggregates();
  stubList();

  modelListMock.mockImplementation(async (): Promise<ListResult<Service>> => {
    const service: Service = new Service();
    service.id = SOURCE_ID;
    service.name = "Google SecOps";

    return { data: [service], count: 1, skip: 0, limit: 100 };
  });

  attributeKeysMock.mockResolvedValue([
    "threat.matched",
    "device.hostname",
  ] as never);

  jest
    .spyOn(SecurityEventAttributeUtil, "getAttributeValues")
    .mockResolvedValue([] as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the explorer renders the shared telemetry shell", () => {
  test("a search bar, a time picker, a histogram, a facet sidebar, rows and pagination", async () => {
    renderViewer();
    await waitForLoad();

    expect(searchInput()).toBeInTheDocument();
    expect(screen.getByTestId("time-range-picker")).toBeInTheDocument();
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
    expect(screen.getByTestId("telemetry-pagination")).toBeInTheDocument();
    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toHaveTextContent("Failed logon for alice");
  });

  test("the list is newest first, and carries every field the drawer needs", async () => {
    renderViewer();
    await waitForLoad();

    expect(lastListCall()["sort"]).toEqual({ time: SortOrder.Descending });

    const select: Record<string, boolean> = lastListCall()["select"] as Record<
      string,
      boolean
    >;

    for (const field of [
      "attributes",
      "observables",
      "mitreTactics",
      "targetPort",
      "principalProcess",
      "eventUid",
    ]) {
      expect(select[field]).toBe(true);
    }
  });

  test("opens on the past day, scoped to the current project", async () => {
    renderViewer();
    await waitForLoad();

    expect(listQuery()["projectId"]).toBe(PROJECT_ID);

    const window_: InBetween<Date> = listQuery()["time"] as InBetween<Date>;
    expect(window_).toBeInstanceOf(InBetween);
    expect(new Date(window_.endValue).toISOString()).toBe(NOW.toISOString());
    expect(new Date(window_.startValue).toISOString()).toBe(
      new Date(NOW.getTime() - DAY_MS).toISOString(),
    );
  });

  test("the volume total is reported beside the chart", async () => {
    renderViewer();
    await waitForLoad();

    await waitFor(() => {
      expect(
        screen.getByTestId(SECURITY_EVENTS_VOLUME_TOTAL_TEST_ID),
      ).toHaveTextContent("13 events");
    });
  });
});

describe("one query behind everything", () => {
  test("the histogram and every facet count exactly the rows the list shows", async () => {
    renderViewer();
    await waitForLoad();

    const expected: Record<string, unknown> = listQuery();

    expect(volumeAggregates().length).toBeGreaterThan(0);

    for (const aggregate of [...volumeAggregates(), ...facetAggregates()]) {
      expect(aggregate.query).toEqual(expected);
    }
  });

  test("one aggregate per facet, each grouped by its own column", async () => {
    renderViewer();
    await waitForLoad();

    expect(
      facetAggregates().map((aggregate: AggregateBy<SecurityEvent>): string => {
        return Object.keys(
          aggregate.groupBy as unknown as Record<string, boolean>,
        )[0]!;
      }),
    ).toEqual([...SECURITY_EVENT_FACET_KEYS]);
  });

  test("a facet that errors leaves the others intact", async () => {
    aggregateMock.mockImplementation(
      async (data: {
        aggregateBy: AggregateBy<SecurityEvent>;
      }): Promise<AggregatedResult> => {
        const facetKey: string | undefined = Object.keys(
          (data.aggregateBy.groupBy as unknown as Record<string, boolean>) ||
            {},
        )[0];

        if (facetKey === "className") {
          throw new Error("boom");
        }

        if (
          facetKey === "severityName" &&
          String(data.aggregateBy.aggregationInterval) === "Total"
        ) {
          return {
            data: [
              { timestamp: NOW, value: 4, severityName: OcsfSeverity.Critical },
            ],
          } as unknown as AggregatedResult;
        }

        return { data: [] } as unknown as AggregatedResult;
      },
    );

    renderViewer();
    await waitForLoad();

    await waitFor(() => {
      expect(facetSection("Severity")).toHaveTextContent("Critical");
    });
  });

  /*
   * A failed count draws no bars rather than an error banner over a list that
   * loaded fine — the chart is a second read of rows the reader can already
   * see.
   */
  test("a failed histogram does not take the list down with it", async () => {
    aggregateMock.mockRejectedValue(new Error("boom") as never);

    renderViewer();

    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });

    expect(screen.queryByText(/boom/)).toBeNull();
  });

  test("a failed list is reported, and the rows are cleared", async () => {
    getListMock.mockRejectedValue(new Error("clickhouse is down") as never);

    renderViewer();

    await waitFor(() => {
      expect(screen.getByText(/clickhouse is down/)).toBeInTheDocument();
    });

    expect(rows()).toHaveLength(0);
  });
});

describe("the facet sidebar", () => {
  test("lists the counted values, Source named from Postgres rather than by id", async () => {
    renderViewer();
    await waitForLoad();

    await waitFor(() => {
      expect(facetSection("Severity")).toHaveTextContent("Critical");
    });

    expect(facetSection("Severity")).toHaveTextContent("Low");
    expect(facetSection("Source")).toHaveTextContent("Google SecOps");
    expect(facetSection("Source")).not.toHaveTextContent(SOURCE_ID.toString());
  });

  test("clicking a value narrows the list, the chart and the counts alike", async () => {
    renderViewer();
    await waitForLoad();

    await waitFor(() => {
      expect(facetSection("Severity")).toHaveTextContent("Critical");
    });

    fireEvent.click(
      within(facetSection("Severity")).getByText(OcsfSeverity.Critical),
    );

    await waitFor(() => {
      expect(listQuery()["severityName"]).toBe(OcsfSeverity.Critical);
    });

    const expected: Record<string, unknown> = listQuery();

    for (const aggregate of [
      ...volumeAggregates().slice(-1),
      ...facetAggregates().slice(-SECURITY_EVENT_FACET_KEYS.length),
    ]) {
      expect(aggregate.query).toEqual(expected);
    }

    expect(JSON.parse(urlParams().get("filters") as string)).toEqual([
      ["severityName", OcsfSeverity.Critical],
    ]);
  });

  test("a second value on the same facet is an IN, and a second click clears it", async () => {
    renderViewer();
    await waitForLoad();

    await waitFor(() => {
      expect(facetSection("Severity")).toHaveTextContent("Critical");
    });

    fireEvent.click(
      within(facetSection("Severity")).getByText(OcsfSeverity.Critical),
    );
    await waitFor(() => {
      expect(listQuery()["severityName"]).toBe(OcsfSeverity.Critical);
    });

    fireEvent.click(
      within(facetSection("Severity")).getByText(OcsfSeverity.Low),
    );
    await waitFor(() => {
      expect(listQuery()["severityName"]).toBeInstanceOf(Includes);
    });

    fireEvent.click(
      within(facetSection("Severity")).getByText(OcsfSeverity.Critical),
    );
    await waitFor(() => {
      expect(listQuery()["severityName"]).toBe(OcsfSeverity.Low);
    });
  });

  /*
   * The sidebar has always drawn an exclude action beside every value. This
   * pins that it does something.
   */
  test("excluding a value compiles to a not-equal, and says so on the chip", async () => {
    renderViewer();
    await waitForLoad();

    await waitFor(() => {
      expect(facetSection("Severity")).toHaveTextContent("Critical");
    });

    fireEvent.click(
      within(facetSection("Severity")).getByRole("button", {
        name: `Exclude ${OcsfSeverity.Low}`,
      }),
    );

    await waitFor(() => {
      expect(listQuery()["severityName"]).toBeInstanceOf(NotEqual);
    });

    expect(screen.getByText(/Severity is not/)).toBeInTheDocument();
    expect(JSON.parse(urlParams().get("filters") as string)).toEqual([
      [`!severityName`, OcsfSeverity.Low],
    ]);
  });
});

describe("the search bar", () => {
  test("free text searches the message and lands in the URL", async () => {
    renderViewer();
    await waitForLoad();

    await submitSearch("failed logon");

    await waitFor(() => {
      expect(listQuery()["message"]).toBeInstanceOf(Search);
    });

    expect(String(listQuery()["message"])).toContain("failed logon");
    expect(urlParams().get("search")).toBe("failed logon");
  });

  test("a field filter reaches its column", async () => {
    renderViewer();
    await waitForLoad();

    await submitSearch("severity:Critical");

    await waitFor(() => {
      expect(listQuery()["severityName"]).toBe("Critical");
    });
  });

  test("an attribute filter reaches the attributes map", async () => {
    renderViewer();
    await waitForLoad();

    await submitSearch("@threat.matched:true");

    await waitFor(() => {
      expect(listQuery()["attributes"]).toEqual({ "threat.matched": "true" });
    });
  });

  test("typing alone changes nothing until it is submitted", async () => {
    renderViewer();
    await waitForLoad();

    const before: number = listCalls().length;

    fireEvent.change(searchInput(), { target: { value: "severity:High" } });

    expect(listCalls()).toHaveLength(before);
    expect(listQuery()["severityName"]).toBeUndefined();
  });

  test("the attribute keys of this project back the bar's completion", async () => {
    renderViewer();
    await waitForLoad();

    await waitFor(() => {
      expect(attributeKeysMock).toHaveBeenCalled();
    });
  });
});

describe("chips", () => {
  test("clearing one widens the query and drops it from the URL", async () => {
    renderViewer();
    await waitForLoad();

    await waitFor(() => {
      expect(facetSection("Severity")).toHaveTextContent("Critical");
    });

    fireEvent.click(
      within(facetSection("Severity")).getByText(OcsfSeverity.Critical),
    );
    await waitFor(() => {
      expect(listQuery()["severityName"]).toBe(OcsfSeverity.Critical);
    });

    fireEvent.click(screen.getByRole("button", { name: /Remove .*Critical/i }));

    await waitFor(() => {
      expect(listQuery()["severityName"]).toBeUndefined();
    });

    expect(urlParams().get("filters")).toBeNull();
  });

  test("Clear all drops the chips AND the search text", async () => {
    renderViewer();
    await waitForLoad();

    await submitSearch("failed logon");

    await waitFor(() => {
      expect(listQuery()["message"]).toBeInstanceOf(Search);
    });

    await waitFor(() => {
      expect(facetSection("Severity")).toHaveTextContent("Critical");
    });

    // Two chips, which is when the shell offers "Clear all" at all.
    fireEvent.click(
      within(facetSection("Severity")).getByText(OcsfSeverity.Critical),
    );
    fireEvent.click(within(facetSection("Source")).getByText("Google SecOps"));

    await waitFor(() => {
      expect(listQuery()[SECURITY_EVENT_SOURCE_FACET_KEY]).toBe(
        SOURCE_ID.toString(),
      );
    });

    fireEvent.click(screen.getByText(/Clear all/i));

    await waitFor(() => {
      expect(listQuery()[SECURITY_EVENT_SOURCE_FACET_KEY]).toBeUndefined();
    });

    expect(listQuery()["severityName"]).toBeUndefined();
    expect(listQuery()["message"]).toBeUndefined();
    expect(searchInput().value).toBe("");
    expect(urlParams().get("search")).toBeNull();
  });
});

describe("the window", () => {
  test("picking a range moves the list, the chart and the URL together", async () => {
    renderViewer();
    await waitForLoad();

    act(() => {
      pickerProps!.onChange({ range: TimeRange.PAST_ONE_HOUR });
    });

    await waitFor(() => {
      const window_: InBetween<Date> = listQuery()["time"] as InBetween<Date>;
      expect(new Date(window_.startValue).toISOString()).toBe(
        new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
      );
    });

    expect(urlParams().get("range")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(volumeAggregates().slice(-1)[0]!.query).toEqual(listQuery());
  });

  test("dragging the histogram zooms into a custom window", async () => {
    renderViewer();
    await waitForLoad();

    await waitFor(() => {
      expect(
        screen.queryByTestId("bucket-2026-09-18T10:00:00.000Z"),
      ).toBeInTheDocument();
    });

    const first: HTMLElement = screen.getByTestId(
      "bucket-2026-09-18T10:00:00.000Z",
    );
    const second: HTMLElement = screen.getByTestId(
      "bucket-2026-09-18T10:15:00.000Z",
    );

    fireEvent.mouseDown(first);
    fireEvent.mouseMove(second);
    fireEvent.mouseUp(second);

    await waitFor(() => {
      expect(urlParams().get("range")).toBe(TimeRange.CUSTOM);
    });

    expect(urlParams().get("start")).toBe("2026-09-18T10:00:00.000Z");
  });

  test("Refresh re-reads a relative window from now", async () => {
    renderViewer();
    await waitForLoad();

    const before: number = listCalls().length;

    now = new Date(NOW.getTime() + 60 * 60 * 1000);

    fireEvent.click(screen.getByTitle("Refresh"));

    await waitFor(() => {
      expect(listCalls().length).toBeGreaterThan(before);
    });

    const window_: InBetween<Date> = listQuery()["time"] as InBetween<Date>;
    expect(new Date(window_.endValue).toISOString()).toBe(now.toISOString());
  });
});

describe("pagination", () => {
  test("moving to page 2 skips a page and records it in the URL", async () => {
    stubList(EVENTS, 500);

    renderViewer();
    await waitForLoad();

    fireEvent.click(screen.getByRole("button", { name: "Go to next page" }));

    await waitFor(() => {
      expect(lastListCall()["skip"]).toBe(50);
    });

    expect(urlParams().get("page")).toBe("2");
  });

  test("narrowing the list returns to page 1", async () => {
    stubList(EVENTS, 500);

    renderViewer();
    await waitForLoad();

    fireEvent.click(screen.getByRole("button", { name: "Go to next page" }));
    await waitFor(() => {
      expect(lastListCall()["skip"]).toBe(50);
    });

    await waitFor(() => {
      expect(facetSection("Severity")).toHaveTextContent("Critical");
    });

    fireEvent.click(
      within(facetSection("Severity")).getByText(OcsfSeverity.Critical),
    );

    await waitFor(() => {
      expect(lastListCall()["skip"]).toBe(0);
    });

    expect(urlParams().get("page")).toBeNull();
  });
});

describe("opening an event", () => {
  test("clicking a row opens the drawer on that event", async () => {
    renderViewer();
    await waitForLoad();

    fireEvent.click(rows()[0]!);

    expect(
      screen.getByTestId(SECURITY_EVENT_DETAIL_PANEL_TEST_ID),
    ).toHaveTextContent("Failed logon for alice");
  });

  test("a filter added from the drawer becomes a chip on the list", async () => {
    renderViewer();
    await waitForLoad();

    fireEvent.click(rows()[0]!);

    fireEvent.click(
      screen.getByRole("button", { name: "Filter by Event Class" }),
    );

    await waitFor(() => {
      expect(listQuery()["className"]).toBe("Authentication");
    });
  });

  test("the highlight follows the event across a refresh, not the row object", async () => {
    renderViewer();
    await waitForLoad();

    fireEvent.click(rows()[0]!);
    expect(rows()[0]).toHaveAttribute("aria-pressed", "true");

    const before: number = listCalls().length;
    fireEvent.click(screen.getByTitle("Refresh"));

    await waitFor(() => {
      expect(listCalls().length).toBeGreaterThan(before);
    });

    expect(rows()[0]).toHaveAttribute("aria-pressed", "true");
    expect(rows()[1]).not.toHaveAttribute("aria-pressed");
  });

  test("closing the drawer leaves the list where it was", async () => {
    renderViewer();
    await waitForLoad();

    fireEvent.click(rows()[0]!);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));

    expect(
      screen.queryByTestId(SECURITY_EVENT_DETAIL_PANEL_TEST_ID),
    ).toBeNull();
    expect(rows()).toHaveLength(2);
  });
});

describe("an empty list", () => {
  test("a project that has never received an event gets the setup guide", async () => {
    stubList([], 0);

    renderViewer();

    await waitFor(() => {
      expect(
        document.getElementById(SECURITY_EVENTS_EMPTY_STATE_ID),
      ).not.toBeNull();
    });

    expect(screen.getByText("No security events yet")).toBeInTheDocument();
  });

  /*
   * Offering the setup guide to someone who is already ingesting would send
   * them off to set up ingest they already have.
   */
  test("a project that has events gets a no-results message instead", async () => {
    getListMock.mockImplementation(
      async (data: { limit: number }): Promise<ListResult<SecurityEvent>> => {
        if (data.limit === 1) {
          return {
            data: [event({ time: new Date("2026-09-01T00:00:00.000Z") })],
            count: 1,
            skip: 0,
            limit: 1,
          };
        }

        return { data: [], count: 0, skip: 0, limit: data.limit };
      },
    );

    renderViewer();

    await waitFor(() => {
      expect(
        document.getElementById(SECURITY_EVENTS_NO_RESULTS_ID),
      ).not.toBeNull();
    });

    expect(document.getElementById(SECURITY_EVENTS_EMPTY_STATE_ID)).toBeNull();
  });

  test("a narrowed list never offers the setup guide, whatever the project has", async () => {
    stubList([], 0);

    renderViewer();

    await waitFor(() => {
      expect(
        document.getElementById(SECURITY_EVENTS_EMPTY_STATE_ID),
      ).not.toBeNull();
    });

    await submitSearch("severity:Critical");

    await waitFor(() => {
      expect(
        document.getElementById(SECURITY_EVENTS_NO_RESULTS_ID),
      ).not.toBeNull();
    });

    expect(document.getElementById(SECURITY_EVENTS_EMPTY_STATE_ID)).toBeNull();
  });
});

describe("a link into the explorer", () => {
  test("opens on the window, chips, search text and page it names", async () => {
    window.history.replaceState(
      null,
      "",
      `/dashboard/project/security-events?range=${TimeRange.PAST_ONE_HOUR}` +
        `&filters=${encodeURIComponent(
          JSON.stringify([["severityName", "Critical"]]),
        )}&search=${encodeURIComponent("failed logon")}&page=2&pageSize=25`,
    );

    renderViewer();
    await waitForLoad();

    expect(listQuery()["severityName"]).toBe("Critical");
    expect(String(listQuery()["message"])).toContain("failed logon");
    expect(lastListCall()["limit"]).toBe(25);
    expect(lastListCall()["skip"]).toBe(25);
    expect(searchInput().value).toBe("failed logon");
    expect(screen.getByTestId("time-range-picker")).toHaveTextContent(
      TimeRange.PAST_ONE_HOUR,
    );
  });

  /*
   * The connection diagnostics' "view these events" links, and anything else
   * written for the model table this explorer replaced, name their attribute
   * filter in the table's own param. Reading it back is what keeps an old
   * link from quietly opening an unfiltered list that looks like the right
   * answer.
   */
  test("a legacy model-table filter link is read back as a chip", async () => {
    const legacyFilter: string = encodeURIComponent(
      JSON.stringify({
        attributes: { "oneuptime.security_connection.id": "conn-1" },
      }),
    );

    window.history.replaceState(
      null,
      "",
      `/dashboard/project/security-events?security-events-table-filter=${legacyFilter}`,
    );

    renderViewer();
    await waitForLoad();

    expect(listQuery()["attributes"]).toEqual({
      "oneuptime.security_connection.id": "conn-1",
    });
    // And the chip says so, rather than narrowing the list silently.
    expect(
      screen.getByText(/oneuptime\.security_connection\.id/),
    ).toBeInTheDocument();
    expect(screen.getByText("conn-1")).toBeInTheDocument();
  });

  test("a malformed filters payload opens an unfiltered list rather than a blank page", async () => {
    window.history.replaceState(
      null,
      "",
      "/dashboard/project/security-events?filters=%7Bnot-json",
    );

    renderViewer();
    await waitForLoad();

    expect(rows()).toHaveLength(2);
    expect(listQuery()["severityName"]).toBeUndefined();
  });
});

describe("live updates", () => {
  test("are off until switched on, and then poll", async () => {
    jest.useFakeTimers();

    try {
      renderViewer();

      await act(async () => {
        await Promise.resolve();
      });

      const toggle: HTMLElement = screen.getByTitle("Enable live updates");
      expect(toggle).toHaveTextContent("Paused");

      fireEvent.click(toggle);

      expect(screen.getByTitle("Pause live updates")).toHaveTextContent("Live");

      const before: number = listCalls().length;

      await act(async () => {
        jest.advanceTimersByTime(20000);
        await Promise.resolve();
      });

      expect(listCalls().length).toBeGreaterThan(before);
    } finally {
      jest.useRealTimers();
    }
  });
});

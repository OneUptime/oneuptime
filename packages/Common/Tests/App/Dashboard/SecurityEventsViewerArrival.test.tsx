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
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { MockFunction } from "../../MockType";

configure({ asyncUtilTimeout: 15000 });

/*
 * THE EVENTS A HUNT'S RUN COUNTED, ON EVENTS (#10488).
 *
 * A scheduled hunt counts the events that ARRIVED in its run's window,
 * whenever they happened in the day before, so its notification, its last
 * find and its Run History open the explorer on exactly those: the run's
 * arrivals in the address (arrivedAfter, arrivedUntil) over a time range
 * that holds the day before them. The explorer reads them as a chip,
 * "Arrived: ...", and every read on the page - the list, the volume chart,
 * every facet count - carries them under their own key, by the condition
 * the run counted with, so the page shows what the run counted and nothing
 * else. The chip's x, or Clear all, shows everything in the time range
 * again, and the address follows.
 *
 * The data layer is stubbed at AnalyticsModelAPI / ModelAPI; the shell is
 * real, so the assertions are about what a reader sees and what is read.
 */

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;

    return {
      __esModule: true,
      default: (props: { value: { range: string } }): ReactElement => {
        return react.createElement(
          "div",
          { "data-testid": "time-range-picker" },
          props.value.range,
        );
      },
    };
  },
);

jest.mock("recharts", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    BarChart: (props: { children?: React.ReactNode }) => {
      return react.createElement(
        "div",
        { "data-testid": "bar-chart" },
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

import SecurityEventsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsViewer";
import SecurityEventAttributeUtil from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventAttributeUtil";
import { SECURITY_EVENT_ROW_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventListRow";
import {
  ARRIVED_CHIP_KEY,
  SECURITY_EVENTS_ARRIVAL_CHIP_FACET_KEY,
  SECURITY_EVENTS_ARRIVAL_CHIP_VALUE,
  applySecurityEventsArrival,
  getSecurityEventsArrivalChip,
  getSecurityEventsArrivalParams,
  isSecurityEventsArrivalChip,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsArrivalFilter";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { ActiveFilter } from "../../../UI/Components/TelemetryViewer/types";
import AggregateBy from "../../../Types/BaseDatabase/AggregateBy";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import {
  SECURITY_EVENTS_ARRIVED_AFTER_PARAM,
  SECURITY_EVENTS_ARRIVED_UNTIL_PARAM,
  SECURITY_EVENT_ARRIVAL_QUERY_KEY,
  SecurityEventArrivalRange,
} from "../../../Types/SecurityEvent/SecurityEventArrival";
import {
  SecurityHuntRunWindow,
  getSecurityHuntRunArrival,
  getSecurityHuntRunEventTimeRange,
} from "../../../Types/SecurityEvent/SecurityHunt";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import Service from "../../../Models/DatabaseModels/Service";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const NOW: Date = new Date("2026-10-29T12:05:00.000Z");

// An hourly run's window: what arrived after 10:58, up to 11:58.
const RUN: SecurityHuntRunWindow = {
  startTime: new Date("2026-10-29T10:58:00.000Z"),
  endTime: new Date("2026-10-29T11:58:00.000Z"),
};
const ARRIVAL: SecurityEventArrivalRange = getSecurityHuntRunArrival(RUN);
const SHOWN: SecurityHuntRunWindow = getSecurityHuntRunEventTimeRange(RUN);

const EXPECTED_ARRIVAL: { arrivedAfter: string; arrivedUntil: string } = {
  arrivedAfter: "2026-10-29T10:58:00.000Z",
  arrivedUntil: "2026-10-29T11:58:00.000Z",
};

let aggregateMock: MockFunction;
let getListMock: MockFunction;

function event(fields: Partial<SecurityEvent> = {}): SecurityEvent {
  return Object.assign(new SecurityEvent(), {
    // Happened five hours before it arrived: a shipper's backlog.
    time: new Date("2026-10-29T06:10:00.000Z"),
    eventUid: "uid-1",
    severityName: OcsfSeverity.High,
    className: "Process Activity",
    message: "powershell.exe -enc SQBFAFgA",
    principalHost: "web-1",
    ...fields,
  });
}

function stubList(events: Array<SecurityEvent>): void {
  getListMock.mockImplementation(
    async (data: { limit: number }): Promise<ListResult<SecurityEvent>> => {
      if (data.limit === 1) {
        return {
          data: events[0] ? [events[0]] : [],
          count: events.length > 0 ? 1 : 0,
          skip: 0,
          limit: 1,
        };
      }

      return {
        data: events.map((listed: SecurityEvent): SecurityEvent => {
          return Object.assign(new SecurityEvent(), listed);
        }),
        count: events.length,
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

function lastListQuery(): Record<string, unknown> {
  const calls: Array<Record<string, unknown>> = listCalls();

  return calls[calls.length - 1]!["query"] as Record<string, unknown>;
}

function aggregateQueries(): Array<Record<string, unknown>> {
  return aggregateMock.mock.calls.map(
    (call: Array<unknown>): Record<string, unknown> => {
      return (call[0] as { aggregateBy: AggregateBy<SecurityEvent> })
        .aggregateBy.query as Record<string, unknown>;
    },
  );
}

function rows(): Array<HTMLElement> {
  return screen.queryAllByTestId(SECURITY_EVENT_ROW_TEST_ID);
}

// The address a hunt's notification or its Run History opens the page on.
function openOnRun(extra: string = ""): void {
  window.history.replaceState(
    null,
    "",
    `/dashboard/project/security-events/events?range=Custom` +
      `&start=${encodeURIComponent(SHOWN.startTime.toISOString())}` +
      `&end=${encodeURIComponent(SHOWN.endTime.toISOString())}` +
      `&${SECURITY_EVENTS_ARRIVED_AFTER_PARAM}=${encodeURIComponent(RUN.startTime.toISOString())}` +
      `&${SECURITY_EVENTS_ARRIVED_UNTIL_PARAM}=${encodeURIComponent(RUN.endTime.toISOString())}` +
      extra,
  );
}

function renderViewer(): void {
  render(
    <MemoryRouter>
      <SecurityEventsViewer />
    </MemoryRouter>,
  );
}

async function waitForRows(count: number): Promise<void> {
  await waitFor(() => {
    expect(rows()).toHaveLength(count);
  });
}

beforeEach(() => {
  window.history.replaceState(
    null,
    "",
    "/dashboard/project/security-events/events",
  );
  window.localStorage.clear();

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(NOW.getTime());
  });

  aggregateMock = jest.spyOn(
    AnalyticsModelAPI,
    "aggregate",
  ) as unknown as MockFunction;
  getListMock = jest.spyOn(
    AnalyticsModelAPI,
    "getList",
  ) as unknown as MockFunction;

  aggregateMock.mockImplementation(async (): Promise<AggregatedResult> => {
    return { data: [] } as unknown as AggregatedResult;
  });
  stubList([event(), event({ eventUid: "uid-2", principalHost: "web-2" })]);

  (
    jest.spyOn(ModelAPI, "getList") as unknown as MockFunction
  ).mockImplementation(async (): Promise<ListResult<Service>> => {
    return { data: [], count: 0, skip: 0, limit: 100 };
  });
  jest
    .spyOn(SecurityEventAttributeUtil, "getAttributeKeys")
    .mockResolvedValue([] as never);
  jest
    .spyOn(SecurityEventAttributeUtil, "getAttributeValues")
    .mockResolvedValue([] as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the arrivals as a chip, without React", () => {
  test("the chip says when the events arrived, as the time range button writes a range", () => {
    const chip: ActiveFilter = getSecurityEventsArrivalChip(ARRIVAL);

    expect(chip.facetKey).toBe(SECURITY_EVENTS_ARRIVAL_CHIP_FACET_KEY);
    expect(chip.value).toBe(SECURITY_EVENTS_ARRIVAL_CHIP_VALUE);
    expect(chip.displayKey).toBe(ARRIVED_CHIP_KEY);
    expect(ARRIVED_CHIP_KEY).toBe("Arrived");
    // One day, so the day is said once: "Oct 29, 10:58 AM – 11:58 AM".
    expect(chip.displayValue).toContain("10:58");
    expect(chip.displayValue).toContain("11:58");
    expect(chip.displayValue).toContain(" – ");
    expect(chip.readOnly).toBeUndefined();
  });

  test("no facet of the sidebar is the chip's key", () => {
    expect(
      isSecurityEventsArrivalChip(SECURITY_EVENTS_ARRIVAL_CHIP_FACET_KEY),
    ).toBe(true);
    expect(isSecurityEventsArrivalChip("severityName")).toBe(false);
    expect(isSecurityEventsArrivalChip("attributes.arrived")).toBe(false);
  });

  test("the address names a range by its two params, and drops them both when it is taken off", () => {
    expect(getSecurityEventsArrivalParams(ARRIVAL)).toEqual({
      [SECURITY_EVENTS_ARRIVED_AFTER_PARAM]: EXPECTED_ARRIVAL.arrivedAfter,
      [SECURITY_EVENTS_ARRIVED_UNTIL_PARAM]: EXPECTED_ARRIVAL.arrivedUntil,
    });
    expect(getSecurityEventsArrivalParams(null)).toEqual({
      [SECURITY_EVENTS_ARRIVED_AFTER_PARAM]: null,
      [SECURITY_EVENTS_ARRIVED_UNTIL_PARAM]: null,
    });
  });

  test("a query carries the range under its own key, and one without a range is left as it was", () => {
    const query: Record<string, unknown> = { projectId: PROJECT_ID };

    expect(applySecurityEventsArrival(query, ARRIVAL)).toEqual({
      projectId: PROJECT_ID,
      [SECURITY_EVENT_ARRIVAL_QUERY_KEY]: EXPECTED_ARRIVAL,
    });
    expect(query[SECURITY_EVENT_ARRIVAL_QUERY_KEY]).toBeUndefined();
    expect(applySecurityEventsArrival(query, null)).toBe(query);
  });
});

describe("a run opened on what it counted", () => {
  test("the list reads the run's arrivals, over the day before them", async () => {
    openOnRun();
    renderViewer();
    await waitForRows(2);

    expect(lastListQuery()[SECURITY_EVENT_ARRIVAL_QUERY_KEY]).toEqual(
      EXPECTED_ARRIVAL,
    );

    const time: InBetween<Date> = lastListQuery()["time"] as InBetween<Date>;
    expect(new Date(time.startValue).toISOString()).toBe(
      SHOWN.startTime.toISOString(),
    );
    expect(new Date(time.endValue).toISOString()).toBe(
      SHOWN.endTime.toISOString(),
    );
  });

  test("the volume chart and every facet count read them too", async () => {
    openOnRun();
    renderViewer();
    await waitForRows(2);

    await waitFor(() => {
      expect(aggregateQueries().length).toBeGreaterThan(1);
    });

    for (const query of aggregateQueries()) {
      expect(query[SECURITY_EVENT_ARRIVAL_QUERY_KEY]).toEqual(EXPECTED_ARRIVAL);
    }
  });

  test("they show as a chip that says when the events arrived", async () => {
    openOnRun();
    renderViewer();
    await waitForRows(2);

    expect(await screen.findByText(/Arrived/)).toBeInTheDocument();
    expect(
      screen.getByTitle(
        `Remove Arrived: ${getSecurityEventsArrivalChip(ARRIVAL).displayValue}`,
      ),
    ).toBeInTheDocument();
  });

  test("the chip's x shows everything in the time range again, and the address follows", async () => {
    openOnRun();
    renderViewer();
    await waitForRows(2);

    fireEvent.click(
      screen.getByTitle(
        `Remove Arrived: ${getSecurityEventsArrivalChip(ARRIVAL).displayValue}`,
      ),
    );

    await waitFor(() => {
      expect(lastListQuery()[SECURITY_EVENT_ARRIVAL_QUERY_KEY]).toBeUndefined();
    });

    // The time range stays: the day the run's events can have happened in.
    expect(
      new Date(
        (lastListQuery()["time"] as InBetween<Date>).startValue,
      ).toISOString(),
    ).toBe(SHOWN.startTime.toISOString());
    expect(screen.queryByText(/Arrived/)).toBeNull();

    await waitFor(() => {
      expect(window.location.search).not.toContain(
        SECURITY_EVENTS_ARRIVED_AFTER_PARAM,
      );
    });
    expect(window.location.search).not.toContain(
      SECURITY_EVENTS_ARRIVED_UNTIL_PARAM,
    );
  });

  test("Clear all takes the arrivals off with the reader's own chips", async () => {
    openOnRun(
      `&filters=${encodeURIComponent(JSON.stringify([["severityName", "High"]]))}`,
    );
    renderViewer();
    await waitForRows(2);

    expect(lastListQuery()["severityName"]).toBe("High");
    expect(lastListQuery()[SECURITY_EVENT_ARRIVAL_QUERY_KEY]).toEqual(
      EXPECTED_ARRIVAL,
    );

    fireEvent.click(screen.getByText(/Clear all/i));

    await waitFor(() => {
      expect(lastListQuery()[SECURITY_EVENT_ARRIVAL_QUERY_KEY]).toBeUndefined();
    });
    expect(lastListQuery()["severityName"]).toBeUndefined();
  });

  test("a chip of the sidebar narrows inside the arrivals, and never takes them off", async () => {
    openOnRun(
      `&filters=${encodeURIComponent(
        JSON.stringify([
          ["severityName", "High"],
          ["principalHost", "web-1"],
        ]),
      )}`,
    );
    renderViewer();
    await waitForRows(2);

    fireEvent.click(screen.getByTitle(/Remove Principal Host: web-1/));

    await waitFor(() => {
      expect(lastListQuery()["principalHost"]).toBeUndefined();
    });
    expect(lastListQuery()[SECURITY_EVENT_ARRIVAL_QUERY_KEY]).toEqual(
      EXPECTED_ARRIVAL,
    );
  });

  test("the address keeps the arrivals while they are on", async () => {
    openOnRun();
    renderViewer();
    await waitForRows(2);

    const params: URLSearchParams = new URLSearchParams(window.location.search);

    expect(params.get(SECURITY_EVENTS_ARRIVED_AFTER_PARAM)).toBe(
      EXPECTED_ARRIVAL.arrivedAfter,
    );
    expect(params.get(SECURITY_EVENTS_ARRIVED_UNTIL_PARAM)).toBe(
      EXPECTED_ARRIVAL.arrivedUntil,
    );
  });
});

describe("a page opened on no run", () => {
  test("reads no arrivals and shows no chip", async () => {
    renderViewer();
    await waitForRows(2);

    expect(lastListQuery()[SECURITY_EVENT_ARRIVAL_QUERY_KEY]).toBeUndefined();
    expect(screen.queryByText(/Arrived/)).toBeNull();
  });

  test("an address with a range it cannot read reads none either: never everything with a broken chip", async () => {
    window.history.replaceState(
      null,
      "",
      `/dashboard/project/security-events/events?${SECURITY_EVENTS_ARRIVED_AFTER_PARAM}=yesterday&${SECURITY_EVENTS_ARRIVED_UNTIL_PARAM}=${encodeURIComponent(RUN.endTime.toISOString())}`,
    );
    renderViewer();
    await waitForRows(2);

    expect(lastListQuery()[SECURITY_EVENT_ARRIVAL_QUERY_KEY]).toBeUndefined();
    expect(screen.queryByText(/Arrived/)).toBeNull();
  });
});

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
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { MockFunction } from "../../MockType";

configure({ asyncUtilTimeout: 15000 });

/*
 * THE SECURITY EVENTS EXPLORER ON ONE RECORD (issue #5769): a network
 * device's Security Events page hands the explorer the device's scope - the
 * events read from its own syslog, or naming it - and every read on the
 * page carries it: the list, the volume chart, every facet count, and the
 * "has this ever had an event" probe behind the empty state. The search
 * bar and the chips narrow inside it and can never take it off; it shows
 * as a locked chip; the page's own empty state replaces the project's
 * setup guide; and hunts, which keep a search and its chips but not a
 * record, are kept from the Events page itself.
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

import SecurityEventsViewer, {
  SecurityEventsViewerScope,
  applySecurityEventsViewerScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsViewer";
import SecurityEventAttributeUtil from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventAttributeUtil";
import { SECURITY_EVENT_ROW_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventListRow";
import { SECURITY_EVENTS_EMPTY_STATE_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsEmptyState";
import { SECURITY_EVENTS_NO_RESULTS_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsNoResults";
import { HUNTS_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/HuntsCopy";
import { getDeviceSecurityEventsChip } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceSecurityEventsScope";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import AggregateBy from "../../../Types/BaseDatabase/AggregateBy";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Query from "../../../Types/BaseDatabase/Query";
import Search from "../../../Types/BaseDatabase/Search";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { SecurityConnectionKind } from "../../../Types/SecurityCase/SecurityConnection";
import {
  SECURITY_EVENT_SCOPE_QUERY_KEY,
  SecurityEventScope,
} from "../../../Types/SecurityEvent/SecurityEventScope";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import Service from "../../../Models/DatabaseModels/Service";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DEVICE_ID: string = "55555555-5555-4555-8555-555555555555";
const NOW: Date = new Date("2026-09-18T12:00:00.000Z");
const SCOPE_EMPTY_TEST_ID: string = "device-scope-empty";

const DEVICE_SCOPE: SecurityEventScope = {
  observables: ["hq firewall", "HQ FIREWALL", "203.0.113.7"],
  attributeKey: "networkDevice.id",
  attributeValues: [DEVICE_ID],
};

function viewerScope(): SecurityEventsViewerScope {
  return {
    query: DEVICE_SCOPE,
    chip: getDeviceSecurityEventsChip({
      kind: SecurityConnectionKind.NetworkDevice,
      id: DEVICE_ID,
      name: "HQ Firewall",
      values: ["hq firewall", "203.0.113.7"],
      isSearchedByLogs: false,
      scope: DEVICE_SCOPE,
    }),
    emptyContent: (
      <div data-testid={SCOPE_EMPTY_TEST_ID}>
        No security events for this device yet
      </div>
    ),
  };
}

let aggregateMock: MockFunction;
let getListMock: MockFunction;

function event(fields: Partial<SecurityEvent> = {}): SecurityEvent {
  return Object.assign(new SecurityEvent(), {
    time: new Date("2026-09-18T10:00:00.000Z"),
    eventUid: "uid-1",
    severityName: OcsfSeverity.High,
    className: "Network Activity",
    message: "Denied connection from 203.0.113.99 to 192.0.2.5:3389",
    principalIp: "203.0.113.99",
    targetIp: "192.0.2.5",
    ...fields,
  });
}

function stubList(events: Array<SecurityEvent>, everHad?: SecurityEvent): void {
  getListMock.mockImplementation(
    async (data: { limit: number }): Promise<ListResult<SecurityEvent>> => {
      if (data.limit === 1) {
        const newest: SecurityEvent | undefined = everHad || events[0];

        return {
          data: newest ? [newest] : [],
          count: newest ? 1 : 0,
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

function probeCalls(): Array<Record<string, unknown>> {
  return getListMock.mock.calls
    .map((call: Array<unknown>): Record<string, unknown> => {
      return call[0] as Record<string, unknown>;
    })
    .filter((call: Record<string, unknown>): boolean => {
      return call["limit"] === 1;
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

function searchInput(): HTMLInputElement {
  return screen.getByPlaceholderText(
    /Search security events/i,
  ) as HTMLInputElement;
}

function renderScoped(scope: SecurityEventsViewerScope = viewerScope()): void {
  render(
    <MemoryRouter>
      <SecurityEventsViewer scope={scope} />
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
    `/dashboard/project/network-devices/${DEVICE_ID}/security-events`,
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
  stubList([
    event(),
    event({ eventUid: "uid-2", principalIp: "198.51.100.4" }),
  ]);

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

describe("applySecurityEventsViewerScope", () => {
  test("puts the scope on a query under its own key, leaving the rest as it was", () => {
    const query: Query<SecurityEvent> = {
      projectId: PROJECT_ID,
      observables: new Search("10.0.0.4"),
    } as Query<SecurityEvent>;

    const scoped: Record<string, unknown> = applySecurityEventsViewerScope(
      query,
      viewerScope(),
    ) as unknown as Record<string, unknown>;

    expect(scoped[SECURITY_EVENT_SCOPE_QUERY_KEY]).toEqual(DEVICE_SCOPE);
    expect(scoped["projectId"]).toBe(PROJECT_ID);
    expect(scoped["observables"]).toBeInstanceOf(Search);
    // A new query: the one given is not changed.
    expect(
      (query as unknown as Record<string, unknown>)[
        SECURITY_EVENT_SCOPE_QUERY_KEY
      ],
    ).toBeUndefined();
  });

  test("an unscoped page's query is the query", () => {
    const query: Query<SecurityEvent> = {
      projectId: PROJECT_ID,
    } as Query<SecurityEvent>;

    expect(applySecurityEventsViewerScope(query, undefined)).toBe(query);
  });
});

describe("every read on a record's page carries its scope", () => {
  test("the list", async () => {
    renderScoped();
    await waitForRows(2);

    expect(lastListQuery()[SECURITY_EVENT_SCOPE_QUERY_KEY]).toEqual(
      DEVICE_SCOPE,
    );
    expect(lastListQuery()["projectId"]).toBe(PROJECT_ID);
  });

  test("the volume chart and every facet count", async () => {
    renderScoped();
    await waitForRows(2);

    await waitFor(() => {
      expect(aggregateQueries().length).toBeGreaterThan(1);
    });

    for (const query of aggregateQueries()) {
      expect(query[SECURITY_EVENT_SCOPE_QUERY_KEY]).toEqual(DEVICE_SCOPE);
    }
  });

  test("the probe for whether it has ever had an event", async () => {
    stubList([]);
    renderScoped();

    await waitFor(() => {
      expect(probeCalls().length).toBeGreaterThan(0);
    });

    for (const probe of probeCalls()) {
      expect(
        (probe["query"] as Record<string, unknown>)[
          SECURITY_EVENT_SCOPE_QUERY_KEY
        ],
      ).toEqual(DEVICE_SCOPE);
    }
  });

  test("a search narrows inside the scope, and never takes it off - even one on the observables", async () => {
    renderScoped();
    await waitForRows(2);

    fireEvent.change(searchInput(), {
      target: { value: "observable:10.0.0.4 severity:High" },
    });
    fireEvent.keyDown(searchInput(), { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(lastListQuery()["observables"]).toBeInstanceOf(Search);
    });

    expect(lastListQuery()["severityName"]).toBe("High");
    expect(lastListQuery()[SECURITY_EVENT_SCOPE_QUERY_KEY]).toEqual(
      DEVICE_SCOPE,
    );
  });

  test("the scope is the page's, never written into its address", async () => {
    renderScoped();
    await waitForRows(2);

    expect(window.location.search).not.toContain("securityEventScope");
    expect(window.location.search).not.toContain(DEVICE_ID);
  });
});

describe("the scope on screen", () => {
  test("is a locked chip naming the device, with nothing to take it off", async () => {
    renderScoped();
    await waitForRows(2);

    const chip: HTMLElement = await screen.findByTestId("locked-filter-chip");

    expect(chip).toHaveTextContent("Network Device");
    expect(chip).toHaveTextContent("HQ Firewall");
    expect(
      within(chip.parentElement as HTMLElement).queryByTitle(/Remove/),
    ).toBeNull();
  });

  test("Clear all takes off the reader's chips and search, and leaves the scope", async () => {
    // Two chips of the reader's own, which is when the shell offers Clear all.
    window.history.replaceState(
      null,
      "",
      `/dashboard/project/network-devices/${DEVICE_ID}/security-events` +
        `?filters=${encodeURIComponent(
          JSON.stringify([
            ["severityName", "High"],
            ["className", "Network Activity"],
          ]),
        )}&search=${encodeURIComponent("denied")}`,
    );

    renderScoped();
    await waitForRows(2);

    expect(lastListQuery()["severityName"]).toBe("High");
    expect(lastListQuery()["className"]).toBe("Network Activity");

    fireEvent.click(screen.getByText(/Clear all/i));

    await waitFor(() => {
      expect(lastListQuery()["severityName"]).toBeUndefined();
    });

    expect(lastListQuery()["className"]).toBeUndefined();
    expect(lastListQuery()["message"]).toBeUndefined();
    expect(lastListQuery()[SECURITY_EVENT_SCOPE_QUERY_KEY]).toEqual(
      DEVICE_SCOPE,
    );
    expect(screen.getByTestId("locked-filter-chip")).toBeInTheDocument();
  });

  test("hunts are kept from the Events page: a hunt keeps a search, and would lose the device", async () => {
    renderScoped();
    await waitForRows(2);

    expect(screen.queryByTestId(HUNTS_TEST_IDS.huntsMenu)).toBeNull();
    expect(screen.queryByTestId(HUNTS_TEST_IDS.menuNotLoaded)).toBeNull();
  });

  test("the rows say what each event is: when, how severe, and between which addresses", async () => {
    renderScoped();
    await waitForRows(2);

    expect(rows()[0]).toHaveTextContent(
      "Denied connection from 203.0.113.99 to 192.0.2.5:3389",
    );
  });
});

describe("an empty record's page", () => {
  test("a record that has never had an event says so in its own words, not the project's setup guide", async () => {
    stubList([]);
    renderScoped();

    expect(await screen.findByTestId(SCOPE_EMPTY_TEST_ID)).toBeInTheDocument();
    expect(document.getElementById(SECURITY_EVENTS_EMPTY_STATE_ID)).toBeNull();
    // The locked chip is the page's, so it does not count as narrowing the list.
    expect(screen.getByTestId("locked-filter-chip")).toBeInTheDocument();
  });

  test("a record that has had events, none in this window, is offered its newest", async () => {
    stubList([], event({ time: new Date("2026-09-01T00:00:00.000Z") }));
    renderScoped();

    await waitFor(() => {
      expect(
        document.getElementById(SECURITY_EVENTS_NO_RESULTS_ID),
      ).not.toBeNull();
    });
    expect(screen.queryByTestId(SCOPE_EMPTY_TEST_ID)).toBeNull();
  });

  test("a list the reader narrowed to nothing says no results, never the record's empty state", async () => {
    stubList([]);
    renderScoped();

    expect(await screen.findByTestId(SCOPE_EMPTY_TEST_ID)).toBeInTheDocument();

    fireEvent.change(searchInput(), { target: { value: "severity:Critical" } });
    fireEvent.keyDown(searchInput(), { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(
        document.getElementById(SECURITY_EVENTS_NO_RESULTS_ID),
      ).not.toBeNull();
    });
    expect(screen.queryByTestId(SCOPE_EMPTY_TEST_ID)).toBeNull();
  });
});

describe("the Events page itself", () => {
  test("reads the whole project, as before: no scope on any read", async () => {
    render(
      <MemoryRouter>
        <SecurityEventsViewer />
      </MemoryRouter>,
    );
    await waitForRows(2);

    expect(lastListQuery()[SECURITY_EVENT_SCOPE_QUERY_KEY]).toBeUndefined();

    await waitFor(() => {
      expect(aggregateQueries().length).toBeGreaterThan(0);
    });

    for (const query of aggregateQueries()) {
      expect(query[SECURITY_EVENT_SCOPE_QUERY_KEY]).toBeUndefined();
    }

    expect(screen.queryByTestId("locked-filter-chip")).toBeNull();
  });
});

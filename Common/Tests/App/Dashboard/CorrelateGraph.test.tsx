import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Security Events → Correlate (issue #3395): the quick single-observable
 * search stays as shorthand, a condition builder adds AND/OR chains, the
 * applied filter shows as removable chips and lives in the URL, AND chains
 * compile into ONE query, OR chains fan out and union by event id, class
 * nodes drill down into their events, and observable nodes offer
 * focus/add/exclude pivots. Everything the component promises the issue is
 * pinned here against a mocked AnalyticsModelAPI and a recording ReactFlow
 * stand-in.
 */

const getListMock: MockFunction = getJestMockFunction();
const mockQueryParams: Record<string, string | null> = {};
const setQueryStringMock: MockFunction = getJestMockFunction();
const navigateMock: MockFunction = getJestMockFunction();

const PROJECT_ID_STRING: string = "11111111-1111-4111-8111-111111111111";

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so naming the mocks directly would capture them before
 * their initializers have run.
 */
jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID("11111111-1111-4111-8111-111111111111");
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getQueryStringByName: (name: string) => {
        return mockQueryParams[name] ?? null;
      },
      setQueryString: (...args: Array<any>) => {
        return setQueryStringMock(...args);
      },
      navigate: (...args: Array<any>) => {
        return navigateMock(...args);
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

/*
 * ReactFlow renders nothing measurable in jsdom — replace it with a stand-in
 * that lists every node as a clickable button so node-click pivots are
 * testable, and forwards onNodeClick exactly like the real component.
 */
jest.mock("reactflow", () => {
  return {
    __esModule: true,
    default: (props: any) => {
      return React.createElement(
        "div",
        { "data-testid": "mock-react-flow" },
        (props.nodes || []).map((node: any) => {
          return React.createElement(
            "button",
            {
              key: node.id,
              type: "button",
              "data-testid": `flow-node-${node.id}`,
              onClick: (event: any) => {
                if (props.onNodeClick) {
                  props.onNodeClick(event, node);
                }
              },
            },
            typeof node.data?.label === "string" ? node.data.label : node.id,
          );
        }),
      );
    },
    Background: () => {
      return null;
    },
    Controls: () => {
      return null;
    },
    BackgroundVariant: { Dots: "dots" },
    MarkerType: { ArrowClosed: "arrowclosed" },
  };
});

const detailPivotObservable: string = "pivot-observable";

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventDetail",
  () => {
    return {
      __esModule: true,
      default: (props: any) => {
        return React.createElement(
          "div",
          { "data-testid": "mock-event-detail" },
          React.createElement(
            "span",
            { "data-testid": "mock-event-detail-message" },
            props.securityEvent?.message || "",
          ),
          React.createElement(
            "button",
            {
              type: "button",
              "data-testid": "mock-event-detail-pivot",
              onClick: () => {
                if (props.onCorrelateObservable) {
                  props.onCorrelateObservable("pivot-observable");
                }
              },
            },
            "pivot",
          ),
        );
      },
    };
  },
);

/*
 * The component import comes LAST: requiring it is what instantiates the
 * mock factories above, and those factories reference these imports (e.g.
 * ObjectID) — so everything else must be initialized first.
 */
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import ObjectID from "../../../Types/ObjectID";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import Search from "../../../Types/BaseDatabase/Search";
import {
  CorrelationFilter,
  serializeCorrelationFilter,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/SecurityEventCorrelation";
import CorrelateGraph from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/CorrelateGraph";

interface EventInput {
  id: string;
  className?: string;
  severityName?: OcsfSeverity;
  message?: string;
  observables?: Array<string>;
  principalUser?: string;
}

function buildEvent(input: EventInput): SecurityEvent {
  const event: SecurityEvent = new SecurityEvent();
  event._id = new ObjectID(input.id);
  event.time = new Date("2026-08-25T10:00:00.000Z");
  if (input.className) {
    event.className = input.className;
  }
  if (input.severityName) {
    event.severityName = input.severityName;
  }
  if (input.message) {
    event.message = input.message;
  }
  if (input.principalUser) {
    event.principalUser = input.principalUser;
  }
  event.observables = input.observables || [];
  return event;
}

function listResult(events: Array<SecurityEvent>): {
  data: Array<SecurityEvent>;
  count: number;
  skip: number;
  limit: number;
} {
  return { data: events, count: events.length, skip: 0, limit: 200 };
}

type QueryRecord = Record<string, unknown>;

function queryOfCall(callIndex: number): QueryRecord {
  const callArg: { query: QueryRecord } = getListMock.mock.calls[
    callIndex
  ]?.[0] as { query: QueryRecord };
  return callArg.query;
}

function runQuickSearch(observable: string): void {
  fireEvent.change(screen.getByTestId("security-events-correlate-observable"), {
    target: { value: observable },
  });
  fireEvent.click(screen.getByTestId("security-events-correlate-button"));
}

beforeEach(() => {
  getListMock.mockReset();
  getListMock.mockResolvedValue(listResult([]));
  setQueryStringMock.mockReset();
  navigateMock.mockReset();
  for (const key of Object.keys(mockQueryParams)) {
    delete mockQueryParams[key];
  }
});

afterEach(() => {
  cleanup();
});

describe("CorrelateGraph", () => {
  test("starts on the empty state without fetching", () => {
    render(<CorrelateGraph />);
    expect(screen.getByText("Correlate security events")).toBeInTheDocument();
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("quick search compiles to ONE hasAny query with project and time scope", async () => {
    getListMock.mockResolvedValue(
      listResult([
        buildEvent({
          id: "22222222-2222-4222-8222-222222222222",
          className: "Authentication",
          observables: ["wb-ubuntu-03", "alice"],
        }),
        buildEvent({
          id: "33333333-3333-4333-8333-333333333333",
          className: "Process Activity",
          observables: ["wb-ubuntu-03"],
        }),
      ]),
    );

    render(<CorrelateGraph />);
    runQuickSearch("wb-ubuntu-03");

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });

    const query: QueryRecord = queryOfCall(0);
    expect((query["projectId"] as ObjectID).toString()).toBe(PROJECT_ID_STRING);
    expect(query["time"]).toBeInstanceOf(InBetween);
    expect(query["observables"]).toBeInstanceOf(Includes);
    expect((query["observables"] as Includes).values).toEqual(["wb-ubuntu-03"]);

    const callArg: { limit: number; sort: Record<string, unknown> } =
      getListMock.mock.calls[0]?.[0] as {
        limit: number;
        sort: Record<string, unknown>;
      };
    expect(callArg.limit).toBe(200);

    await waitFor(() => {
      expect(screen.getByText(/2 matching events\./)).toBeInTheDocument();
    });

    // The applied filter shows as a chip and lands in the URL.
    expect(screen.getByTestId("correlate-filter-chip-0")).toHaveTextContent(
      "wb-ubuntu-03",
    );
    expect(setQueryStringMock).toHaveBeenCalledWith(
      expect.objectContaining({
        q: expect.stringContaining("wb-ubuntu-03"),
        observable: null,
      }),
    );

    // Class nodes made it into the graph.
    expect(
      screen.getByTestId("flow-node-class:Authentication"),
    ).toHaveTextContent("Authentication (1)");
  });

  test("a ?observable= deep link auto-correlates on mount", async () => {
    mockQueryParams["observable"] = "wb-ubuntu-03";
    render(<CorrelateGraph />);

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });
    expect((queryOfCall(0)["observables"] as Includes).values).toEqual([
      "wb-ubuntu-03",
    ]);
  });

  test("a ?q= deep link restores a multi-condition AND filter into one query and opens the builder", async () => {
    const filter: CorrelationFilter = {
      conditions: [
        { field: "principalIp", operator: "equals", value: "192.168.1.20" },
        { field: "principalHost", operator: "equals", value: "wb-ubuntu-03" },
      ],
      connector: "and",
    } as CorrelationFilter;
    mockQueryParams["q"] = serializeCorrelationFilter(filter);
    mockQueryParams["hours"] = "168";

    render(<CorrelateGraph />);

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });
    const query: QueryRecord = queryOfCall(0);
    expect(query["principalIp"]).toBe("192.168.1.20");
    expect(query["principalHost"]).toBe("wb-ubuntu-03");

    // Both chips visible, builder auto-opened for the chain.
    expect(screen.getByTestId("correlate-filter-chip-1")).toBeInTheDocument();
    expect(screen.getByTestId("correlate-filter-builder")).toBeInTheDocument();

    // The seeded time range makes it into the query window (168h ≈ 7 days).
    const timeWindow: InBetween<Date> = query["time"] as InBetween<Date>;
    const windowMs: number =
      new Date(timeWindow.endValue).getTime() -
      new Date(timeWindow.startValue).getTime();
    expect(Math.round(windowMs / (1000 * 60 * 60))).toBe(168);
  });

  test("OR filters fan out into one query per condition and union by event id", async () => {
    const filter: CorrelationFilter = {
      conditions: [
        { field: "observable", operator: "equals", value: "wb-ubuntu-03" },
        { field: "message", operator: "contains", value: "failed" },
      ],
      connector: "or",
    } as CorrelationFilter;
    mockQueryParams["q"] = serializeCorrelationFilter(filter);

    const sharedEvent: SecurityEvent = buildEvent({
      id: "44444444-4444-4444-8444-444444444444",
      className: "Authentication",
      message: "failed password for alice",
      observables: ["wb-ubuntu-03"],
    });

    getListMock.mockImplementation((args: any) => {
      const query: QueryRecord = args.query as QueryRecord;
      if (query["observables"]) {
        return Promise.resolve(
          listResult([
            sharedEvent,
            buildEvent({
              id: "55555555-5555-4555-8555-555555555555",
              className: "Authentication",
              observables: ["wb-ubuntu-03"],
            }),
          ]),
        );
      }
      return Promise.resolve(
        listResult([
          sharedEvent,
          buildEvent({
            id: "66666666-6666-4666-8666-666666666666",
            className: "Detection Finding",
            message: "failed logon burst",
            observables: [],
          }),
        ]),
      );
    });

    render(<CorrelateGraph />);

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });

    // 2 + 2 rows with one shared id → 3 unique events.
    await waitFor(() => {
      expect(screen.getByText(/3 matching events\./)).toBeInTheDocument();
    });

    const queries: Array<QueryRecord> = [queryOfCall(0), queryOfCall(1)];
    const observableQuery: QueryRecord | undefined = queries.find(
      (query: QueryRecord) => {
        return Boolean(query["observables"]);
      },
    );
    const messageQuery: QueryRecord | undefined = queries.find(
      (query: QueryRecord) => {
        return Boolean(query["message"]);
      },
    );
    expect(observableQuery).toBeTruthy();
    expect(messageQuery?.["message"]).toBeInstanceOf(Search);
  });

  test("an impossible AND chain surfaces the friendly compiler error and fetches nothing", async () => {
    const filter: CorrelationFilter = {
      conditions: [
        { field: "principalHost", operator: "equals", value: "host-a" },
        { field: "principalHost", operator: "equals", value: "host-b" },
      ],
      connector: "and",
    } as CorrelationFilter;
    mockQueryParams["q"] = serializeCorrelationFilter(filter);

    render(<CorrelateGraph />);

    await waitFor(() => {
      expect(screen.getByText(/can never match/)).toBeInTheDocument();
    });
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("hitting the per-query cap marks counts as lower bounds", async () => {
    const manyEvents: Array<SecurityEvent> = [];
    for (let eventIndex: number = 0; eventIndex < 200; eventIndex++) {
      manyEvents.push(
        buildEvent({
          id: `77777777-7777-4777-8777-${String(eventIndex).padStart(12, "0")}`,
          className: "Authentication",
          observables: ["wb-ubuntu-03"],
        }),
      );
    }
    getListMock.mockResolvedValue(listResult(manyEvents));

    render(<CorrelateGraph />);
    runQuickSearch("wb-ubuntu-03");

    await waitFor(() => {
      expect(
        screen.getByText(/treat counts as lower bounds/),
      ).toBeInTheDocument();
    });
  });

  test("removing a chip re-correlates with the remaining conditions", async () => {
    const filter: CorrelationFilter = {
      conditions: [
        { field: "principalIp", operator: "equals", value: "192.168.1.20" },
        { field: "principalHost", operator: "equals", value: "wb-ubuntu-03" },
      ],
      connector: "and",
    } as CorrelationFilter;
    mockQueryParams["q"] = serializeCorrelationFilter(filter);

    render(<CorrelateGraph />);
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByTestId("correlate-filter-chip-remove-0"));

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    const query: QueryRecord = queryOfCall(1);
    expect(query["principalIp"]).toBeUndefined();
    expect(query["principalHost"]).toBe("wb-ubuntu-03");
    expect(screen.queryByTestId("correlate-filter-chip-1")).toBeNull();
  });

  test("clearing every condition returns to the empty state and clears the URL", async () => {
    const filter: CorrelationFilter = {
      conditions: [
        { field: "observable", operator: "equals", value: "wb-ubuntu-03" },
        { field: "observable", operator: "equals", value: "192.168.1.20" },
      ],
      connector: "or",
    } as CorrelationFilter;
    mockQueryParams["q"] = serializeCorrelationFilter(filter);

    render(<CorrelateGraph />);
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByTestId("correlate-filter-clear-all"));

    await waitFor(() => {
      expect(screen.getByText("Correlate security events")).toBeInTheDocument();
    });
    expect(setQueryStringMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: null, hours: null }),
    );
  });

  test("clicking a class node opens the drill-down and a row opens the event detail; the detail pivot re-correlates", async () => {
    getListMock.mockResolvedValue(
      listResult([
        buildEvent({
          id: "88888888-8888-4888-8888-888888888888",
          className: "Authentication",
          severityName: OcsfSeverity.High,
          message: "failed password for alice",
          principalUser: "alice",
          observables: ["wb-ubuntu-03", "alice"],
        }),
        buildEvent({
          id: "99999999-9999-4999-8999-999999999999",
          className: "Process Activity",
          message: "suspicious process",
          observables: ["wb-ubuntu-03"],
        }),
      ]),
    );

    render(<CorrelateGraph />);
    runQuickSearch("wb-ubuntu-03");

    await waitFor(() => {
      expect(
        screen.getByTestId("flow-node-class:Authentication"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("flow-node-class:Authentication"));

    const drillDown: HTMLElement = screen.getByTestId("correlate-drilldown");
    expect(within(drillDown).getByText(/1 matching event/)).toBeInTheDocument();
    expect(
      within(drillDown).getByText("failed password for alice"),
    ).toBeInTheDocument();
    // Only Authentication events — not the Process Activity row.
    expect(within(drillDown).queryByText("suspicious process")).toBeNull();

    fireEvent.click(screen.getByTestId("correlate-drilldown-event-0"));
    expect(screen.getByTestId("mock-event-detail")).toBeInTheDocument();
    expect(screen.getByTestId("mock-event-detail-message")).toHaveTextContent(
      "failed password for alice",
    );

    fireEvent.click(screen.getByTestId("mock-event-detail-pivot"));
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    expect((queryOfCall(1)["observables"] as Includes).values).toEqual([
      detailPivotObservable,
    ]);
  });

  test("clicking an observable node offers Focus / Add / Exclude pivots", async () => {
    getListMock.mockResolvedValue(
      listResult([
        buildEvent({
          id: "22222222-2222-4222-8222-222222222222",
          className: "Authentication",
          observables: ["wb-ubuntu-03", "alice"],
        }),
      ]),
    );

    render(<CorrelateGraph />);
    runQuickSearch("wb-ubuntu-03");

    await waitFor(() => {
      expect(
        screen.getByTestId("flow-node-observable:alice"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("flow-node-observable:alice"));
    const actionBar: HTMLElement = screen.getByTestId(
      "correlate-observable-actions",
    );
    expect(within(actionBar).getByText("alice")).toBeInTheDocument();

    // Exclude appends "Observable is not alice" alongside the equality.
    fireEvent.click(screen.getByTestId("correlate-action-exclude"));
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    const operators: Array<unknown> = queryOfCall(1)[
      "observables"
    ] as Array<unknown>;
    expect(Array.isArray(operators)).toBe(true);
    expect(operators[0]).toBeInstanceOf(Includes);
    expect((operators[0] as Includes).values).toEqual(["wb-ubuntu-03"]);
    expect(operators[1]).toBeInstanceOf(IncludesNone);
    expect((operators[1] as IncludesNone).values).toEqual(["alice"]);
  });

  test("Focus replaces the whole filter with the selected observable", async () => {
    getListMock.mockResolvedValue(
      listResult([
        buildEvent({
          id: "22222222-2222-4222-8222-222222222222",
          className: "Authentication",
          observables: ["wb-ubuntu-03", "alice"],
        }),
      ]),
    );

    render(<CorrelateGraph />);
    runQuickSearch("wb-ubuntu-03");

    await waitFor(() => {
      expect(
        screen.getByTestId("flow-node-observable:alice"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("flow-node-observable:alice"));
    fireEvent.click(screen.getByTestId("correlate-action-focus"));

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    expect((queryOfCall(1)["observables"] as Includes).values).toEqual([
      "alice",
    ]);
    // The quick input follows a single-observable filter.
    expect(
      screen.getByTestId("security-events-correlate-observable"),
    ).toHaveValue("alice");
  });

  test("searched observables never appear as co-occurring nodes", async () => {
    getListMock.mockResolvedValue(
      listResult([
        buildEvent({
          id: "22222222-2222-4222-8222-222222222222",
          className: "Authentication",
          observables: ["wb-ubuntu-03", "alice"],
        }),
      ]),
    );

    render(<CorrelateGraph />);
    runQuickSearch("wb-ubuntu-03");

    await waitFor(() => {
      expect(
        screen.getByTestId("flow-node-observable:alice"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("flow-node-observable:wb-ubuntu-03"),
    ).toBeNull();
  });

  test("an API failure surfaces as an error message", async () => {
    getListMock.mockRejectedValue(new Error("ClickHouse is down"));

    render(<CorrelateGraph />);
    runQuickSearch("wb-ubuntu-03");

    await waitFor(() => {
      expect(screen.getByText(/ClickHouse is down/)).toBeInTheDocument();
    });
  });
});

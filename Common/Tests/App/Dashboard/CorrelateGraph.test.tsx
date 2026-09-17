import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { Edge as FlowEdge, Node as FlowNode, ReactFlowProps } from "reactflow";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import type { SpyInstance } from "jest-mock";

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
 * The props of the most recent ReactFlow render, so tests can inspect the
 * nodes, edges and canvas configuration the component hands to it.
 */
let mockFlowProps: ReactFlowProps | null = null;

/*
 * The React Flow instance the stand-in hands to onInit. Tests steer what the
 * canvas reports (the viewport) and inspect what the component asks of it
 * (fitting and panning).
 */
interface MockViewport {
  x: number;
  y: number;
  zoom: number;
}

const mockViewport: MockViewport = { x: 0, y: 0, zoom: 1 };
const fitViewMock: MockFunction = getJestMockFunction();
const setCenterMock: MockFunction = getJestMockFunction();
const mockFlowInstance: {
  fitView: (...args: Array<any>) => unknown;
  getViewport: () => MockViewport;
  setCenter: (...args: Array<any>) => unknown;
} = {
  fitView: (...args: Array<any>): unknown => {
    return fitViewMock(...args);
  },
  getViewport: (): MockViewport => {
    return { ...mockViewport };
  },
  setCenter: (...args: Array<any>): unknown => {
    return setCenterMock(...args);
  },
};

/*
 * The i18n language the component keys its node memo on, plus translations
 * a test can switch on. Unlisted strings translate to themselves.
 */
const mockI18n: { language: string } = { language: "en" };
const mockTranslations: Record<string, string> = {};

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
          return mockTranslations[key] ?? key;
        },
        i18n: mockI18n,
      };
    },
  };
});

/*
 * ReactFlow renders nothing measurable in jsdom — replace it with a stand-in
 * that lists every node as a clickable button so node-click pivots are
 * testable, and forwards onNodeClick exactly like the real component. It also
 * records its props, hands onInit the fake instance once per mount, and stubs
 * the handle exports the custom node card uses.
 */
jest.mock("reactflow", () => {
  const MockReactFlow: (props: any) => React.ReactElement = (
    props: any,
  ): React.ReactElement => {
    mockFlowProps = props;
    React.useEffect(() => {
      if (props.onInit) {
        props.onInit(mockFlowInstance);
      }
    }, []);
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
  };

  return {
    __esModule: true,
    default: MockReactFlow,
    Background: () => {
      return null;
    },
    Controls: () => {
      return null;
    },
    Handle: () => {
      return null;
    },
    Position: {
      Top: "top",
      Bottom: "bottom",
      Left: "left",
      Right: "right",
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
import OneUptimeDate from "../../../Types/Date";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesAll from "../../../Types/BaseDatabase/IncludesAll";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import Search from "../../../Types/BaseDatabase/Search";
import {
  CorrelationFilter,
  describeCorrelationCondition,
  describeCorrelationFilter,
  serializeCorrelationFilter,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/SecurityEventCorrelation";
import { CorrelationGraphNode } from "../../../../App/FeatureSet/Dashboard/src/Utils/CorrelationGraph";
import { LayoutPoint } from "../../../../App/FeatureSet/Dashboard/src/Utils/LayeredGraphLayout";
import {
  CORRELATE_NODE_SIZES,
  CorrelateNodeData,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/CorrelateNodeCard";
import CorrelateGraph, {
  getCanvasHeight,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/CorrelateGraph";

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
  mockFlowProps = null;
  for (const key of Object.keys(mockQueryParams)) {
    delete mockQueryParams[key];
  }
  fitViewMock.mockReset();
  fitViewMock.mockReturnValue(true);
  setCenterMock.mockReset();
  mockViewport.x = 0;
  mockViewport.y = 0;
  mockViewport.zoom = 1;
  mockI18n.language = "en";
  for (const key of Object.keys(mockTranslations)) {
    delete mockTranslations[key];
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

  test("changing the time range refetches with the new window and syncs the URL", async () => {
    getListMock.mockResolvedValue(
      listResult([
        buildEvent({
          id: "22222222-2222-4222-8222-222222222222",
          className: "Authentication",
          observables: ["wb-ubuntu-03"],
        }),
      ]),
    );

    render(<CorrelateGraph />);
    runQuickSearch("wb-ubuntu-03");
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });

    const timeRangeCombobox: HTMLElement = within(
      screen.getByTestId("security-events-correlate-time-range"),
    ).getByRole("combobox");
    fireEvent.keyDown(timeRangeCombobox, { key: "ArrowDown" });
    const option: HTMLElement = screen.getByText("Last 7 days");
    fireEvent.mouseDown(option);
    fireEvent.click(option);

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    const timeWindow: InBetween<Date> = queryOfCall(1)[
      "time"
    ] as InBetween<Date>;
    const windowMs: number =
      new Date(timeWindow.endValue).getTime() -
      new Date(timeWindow.startValue).getTime();
    expect(Math.round(windowMs / (1000 * 60 * 60))).toBe(168);
    expect(setQueryStringMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ hours: "168" }),
    );
  });

  test.each<[string]>([["999"], ["abc"], ["-5"]])(
    "an invalid ?hours=%s falls back to the 24-hour default",
    async (rawHours: string) => {
      mockQueryParams["observable"] = "wb-ubuntu-03";
      mockQueryParams["hours"] = rawHours;

      render(<CorrelateGraph />);
      await waitFor(() => {
        expect(getListMock).toHaveBeenCalledTimes(1);
      });

      const timeWindow: InBetween<Date> = queryOfCall(0)[
        "time"
      ] as InBetween<Date>;
      const windowMs: number =
        new Date(timeWindow.endValue).getTime() -
        new Date(timeWindow.startValue).getTime();
      expect(Math.round(windowMs / (1000 * 60 * 60))).toBe(24);
    },
  );

  test("OR mode hides the Exclude pivot and the drill-down class filter", async () => {
    const filter: CorrelationFilter = {
      conditions: [
        { field: "observable", operator: "equals", value: "wb-ubuntu-03" },
        { field: "observable", operator: "equals", value: "192.168.1.20" },
      ],
      connector: "or",
    } as CorrelationFilter;
    mockQueryParams["q"] = serializeCorrelationFilter(filter);

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
    await waitFor(() => {
      expect(
        screen.getByTestId("flow-node-observable:alice"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("flow-node-observable:alice"));
    expect(
      screen.getByTestId("correlate-observable-actions"),
    ).toBeInTheDocument();
    // "is not X" only narrows under AND — the pivot hides in OR mode.
    expect(screen.queryByTestId("correlate-action-exclude")).toBeNull();

    fireEvent.click(screen.getByTestId("flow-node-class:Authentication"));
    expect(screen.getByTestId("correlate-drilldown")).toBeInTheDocument();
    expect(screen.queryByTestId("correlate-drilldown-filter-class")).toBeNull();
  });

  test("the drill-down's Filter-to-this-class appends a className condition in AND mode", async () => {
    getListMock.mockResolvedValue(
      listResult([
        buildEvent({
          id: "22222222-2222-4222-8222-222222222222",
          className: "Authentication",
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
    fireEvent.click(screen.getByTestId("correlate-drilldown-filter-class"));

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    const query: QueryRecord = queryOfCall(1);
    expect((query["observables"] as Includes).values).toEqual(["wb-ubuntu-03"]);
    expect(query["className"]).toBe("Authentication");
  });

  test("Correlate stays disabled while a builder row has no value", () => {
    render(<CorrelateGraph />);

    // Open the builder — it seeds one default (empty-valued) row.
    fireEvent.click(
      screen.getByTestId("security-events-correlate-toggle-builder"),
    );
    expect(screen.getByTestId("correlate-filter-builder")).toBeInTheDocument();
    expect(
      screen.getByTestId("security-events-correlate-button"),
    ).toBeDisabled();

    fireEvent.change(screen.getByTestId("correlate-condition-value-0"), {
      target: { value: "wb-ubuntu-03" },
    });
    expect(
      screen.getByTestId("security-events-correlate-button"),
    ).not.toBeDisabled();
  });

  test("opening the builder seeds it from freshly typed (unapplied) quick text", async () => {
    getListMock.mockResolvedValue(listResult([]));

    render(<CorrelateGraph />);
    // Apply one search, then type something NEW without applying it.
    runQuickSearch("wb-ubuntu-03");
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });
    fireEvent.change(
      screen.getByTestId("security-events-correlate-observable"),
      { target: { value: "freshly-typed" } },
    );

    fireEvent.click(
      screen.getByTestId("security-events-correlate-toggle-builder"),
    );

    // The new text wins over the stale draft from the applied search.
    expect(screen.getByTestId("correlate-condition-value-0")).toHaveValue(
      "freshly-typed",
    );
  });
});

/*
 * The redesigned page: a query panel with a segmented search-mode control, a
 * results panel with a stat strip, a canvas of fixed-size node cards, a
 * selection panel that floats over the canvas, and the overview lists below
 * the legend. The helpers below drive it through the recording ReactFlow
 * stand-in and a deferred getList where timing matters.
 */

const SEARCHED_HOST: string = "wb-ubuntu-03";
const SELECTED_ACCENT: string = "#6366f1";

type MockListResult = ReturnType<typeof listResult>;
type CorrelateFlowNode = FlowNode<CorrelateNodeData>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  const deferred: Partial<Deferred<T>> = {};
  deferred.promise = new Promise<T>(
    (resolve: (value: T) => void, reject: (reason: unknown) => void): void => {
      deferred.resolve = resolve;
      deferred.reject = reject;
    },
  );
  return deferred as Deferred<T>;
}

/*
 * Four events around one host. After searching the host the graph has:
 * Authentication (2 events, worst High), Process Activity (1, Critical) and
 * Network Activity (1, no severity); alice (2, Authentication only),
 * 10.0.0.5 (2, Authentication and Network Activity) and bash (1, Process
 * Activity).
 */
function standardEvents(): Array<SecurityEvent> {
  return [
    buildEvent({
      id: "a1111111-1111-4111-8111-111111111111",
      className: "Authentication",
      severityName: OcsfSeverity.High,
      message: "failed password for alice",
      principalUser: "alice",
      observables: [SEARCHED_HOST, "alice", "10.0.0.5"],
    }),
    buildEvent({
      id: "a2222222-2222-4222-8222-222222222222",
      className: "Authentication",
      severityName: OcsfSeverity.Low,
      message: "accepted password for alice",
      observables: [SEARCHED_HOST, "alice"],
    }),
    buildEvent({
      id: "a3333333-3333-4333-8333-333333333333",
      className: "Process Activity",
      severityName: OcsfSeverity.Critical,
      message: "suspicious process",
      observables: [SEARCHED_HOST, "bash"],
    }),
    buildEvent({
      id: "a4444444-4444-4444-8444-444444444444",
      className: "Network Activity",
      message: "outbound connection",
      observables: [SEARCHED_HOST, "10.0.0.5"],
    }),
  ];
}

function cappedEvents(count: number): Array<SecurityEvent> {
  const events: Array<SecurityEvent> = [];
  for (let eventIndex: number = 0; eventIndex < count; eventIndex++) {
    events.push(
      buildEvent({
        id: `b7777777-7777-4777-8777-${String(eventIndex).padStart(12, "0")}`,
        className: "Authentication",
        observables: [SEARCHED_HOST],
      }),
    );
  }
  return events;
}

// One event that mentions the host and 35 other observables (5 over the cap).
function crowdedEvents(): Array<SecurityEvent> {
  const observables: Array<string> = [SEARCHED_HOST];
  for (
    let observableIndex: number = 0;
    observableIndex < 35;
    observableIndex++
  ) {
    observables.push(`obs-${String(observableIndex).padStart(2, "0")}`);
  }
  return [
    buildEvent({
      id: "c1111111-1111-4111-8111-111111111111",
      className: "Authentication",
      severityName: OcsfSeverity.Medium,
      observables: observables,
    }),
  ];
}

function twoConditionFilter(connector: "and" | "or"): CorrelationFilter {
  return {
    conditions: [
      { field: "principalIp", operator: "equals", value: "192.168.1.20" },
      { field: "principalHost", operator: "equals", value: SEARCHED_HOST },
    ],
    connector: connector,
  } as CorrelationFilter;
}

function impossibleFilter(): CorrelationFilter {
  return {
    conditions: [
      { field: "principalHost", operator: "equals", value: "host-a" },
      { field: "principalHost", operator: "equals", value: "host-b" },
    ],
    connector: "and",
  } as CorrelationFilter;
}

function twoObservableOrFilter(): CorrelationFilter {
  return {
    conditions: [
      { field: "observable", operator: "equals", value: SEARCHED_HOST },
      { field: "observable", operator: "equals", value: "192.168.1.20" },
    ],
    connector: "or",
  } as CorrelationFilter;
}

// Resolves once the results panel is no longer waiting on a request.
async function waitForSettled(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId("correlate-results")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });
}

async function renderCorrelated(
  events: Array<SecurityEvent> = standardEvents(),
): Promise<void> {
  getListMock.mockResolvedValue(listResult(events));
  render(<CorrelateGraph />);
  runQuickSearch(SEARCHED_HOST);
  await waitForSettled();
}

async function waitForNoResults(): Promise<void> {
  await waitFor(() => {
    expect(
      document.getElementById("security-events-correlate-no-results"),
    ).not.toBeNull();
  });
}

function clickFlowNode(nodeId: string): void {
  fireEvent.click(screen.getByTestId(`flow-node-${nodeId}`));
}

function getFlowProps(): ReactFlowProps {
  const props: ReactFlowProps | null = mockFlowProps;
  if (!props) {
    throw new Error("ReactFlow has not rendered");
  }
  return props;
}

function getFlowNodes(): Array<CorrelateFlowNode> {
  return (getFlowProps().nodes || []) as Array<CorrelateFlowNode>;
}

function getFlowNode(nodeId: string): CorrelateFlowNode {
  const node: CorrelateFlowNode | undefined = getFlowNodes().find(
    (candidate: CorrelateFlowNode): boolean => {
      return candidate.id === nodeId;
    },
  );
  if (!node) {
    throw new Error(`No flow node ${nodeId}`);
  }
  return node;
}

function getFlowEdges(): Array<FlowEdge> {
  return getFlowProps().edges || [];
}

function getFlowEdge(edgeId: string): FlowEdge {
  const edge: FlowEdge | undefined = getFlowEdges().find(
    (candidate: FlowEdge): boolean => {
      return candidate.id === edgeId;
    },
  );
  if (!edge) {
    throw new Error(`No flow edge ${edgeId}`);
  }
  return edge;
}

function getNodeIdsWhere(
  predicate: (node: CorrelateFlowNode) => boolean,
): Array<string> {
  return getFlowNodes()
    .filter(predicate)
    .map((node: CorrelateFlowNode): string => {
      return node.id;
    })
    .sort();
}

function getSelectedNodeIds(): Array<string> {
  return getNodeIdsWhere((node: CorrelateFlowNode): boolean => {
    return node.data.isSelected;
  });
}

function getDimmedNodeIds(): Array<string> {
  return getNodeIdsWhere((node: CorrelateFlowNode): boolean => {
    return node.data.isDimmed;
  });
}

function windowHoursOfCall(callIndex: number): number {
  const timeWindow: InBetween<Date> = queryOfCall(callIndex)[
    "time"
  ] as InBetween<Date>;
  const windowMs: number =
    new Date(timeWindow.endValue).getTime() -
    new Date(timeWindow.startValue).getTime();
  return Math.round(windowMs / (1000 * 60 * 60));
}

function selectTimeRange(label: string): void {
  const timeRangeCombobox: HTMLElement = within(
    screen.getByTestId("security-events-correlate-time-range"),
  ).getByRole("combobox");
  fireEvent.keyDown(timeRangeCombobox, { key: "ArrowDown" });
  const option: HTMLElement = screen.getByText(label);
  fireEvent.mouseDown(option);
  fireEvent.click(option);
}

function isBefore(first: HTMLElement, second: HTMLElement): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("CorrelateGraph start state", () => {
  test("explains the three steps and names the page exactly once", () => {
    render(<CorrelateGraph />);

    const steps: HTMLElement = screen.getByTestId("correlate-start-steps");
    const items: Array<HTMLElement> = within(steps).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Search");
    expect(items[1]).toHaveTextContent("Read the graph");
    expect(items[2]).toHaveTextContent("Pivot");

    expect(screen.getAllByText("Correlate security events")).toHaveLength(1);
    expect(
      document.getElementById("security-events-correlate-empty"),
    ).not.toBeNull();
    expect(screen.queryByTestId("correlate-applied-filter")).toBeNull();
    expect(screen.queryByTestId("mock-react-flow")).toBeNull();
  });
});

describe("CorrelateGraph query panel", () => {
  test("has a Correlate heading and a two-option search mode control", () => {
    render(<CorrelateGraph />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Correlate" }),
    ).toBeInTheDocument();

    const modeGroup: HTMLElement = screen.getByRole("radiogroup", {
      name: "Search mode",
    });
    expect(within(modeGroup).getAllByRole("radio")).toHaveLength(2);

    const simpleToggle: HTMLElement = screen.getByTestId(
      "security-events-correlate-toggle-simple",
    );
    const builderToggle: HTMLElement = screen.getByTestId(
      "security-events-correlate-toggle-builder",
    );
    expect(simpleToggle).toHaveAttribute("role", "radio");
    expect(builderToggle).toHaveAttribute("role", "radio");
    expect(simpleToggle).toHaveTextContent("Observable");
    expect(builderToggle).toHaveTextContent("Conditions");
    expect(simpleToggle).toHaveAttribute("aria-checked", "true");
    expect(builderToggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(builderToggle);
    expect(simpleToggle).toHaveAttribute("aria-checked", "false");
    expect(builderToggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(simpleToggle);
    expect(simpleToggle).toHaveAttribute("aria-checked", "true");
    expect(builderToggle).toHaveAttribute("aria-checked", "false");
  });

  test("builder mode swaps the quick input for the builder and moves the one Correlate button into its footer", () => {
    render(<CorrelateGraph />);

    const toolbar: HTMLElement = screen.getByTestId("correlate-toolbar");
    expect(
      within(toolbar).getByTestId("security-events-correlate-button"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("security-events-correlate-observable"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId("security-events-correlate-toggle-builder"),
    );

    expect(
      screen.queryByTestId("security-events-correlate-observable"),
    ).toBeNull();
    expect(toolbar).toHaveTextContent(
      "Combine fields with AND or OR below, then press Correlate.",
    );
    const builder: HTMLElement = screen.getByTestId("correlate-filter-builder");
    const footer: HTMLElement = within(builder).getByTestId(
      "correlate-builder-footer",
    );
    expect(
      within(footer).getByTestId("security-events-correlate-button"),
    ).toBeInTheDocument();
    expect(
      within(toolbar).queryByTestId("security-events-correlate-button"),
    ).toBeNull();
    expect(
      screen.getAllByTestId("security-events-correlate-button"),
    ).toHaveLength(1);

    fireEvent.click(
      screen.getByTestId("security-events-correlate-toggle-simple"),
    );

    expect(screen.queryByTestId("correlate-filter-builder")).toBeNull();
    expect(
      within(toolbar).getByTestId("security-events-correlate-button"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByTestId("security-events-correlate-button"),
    ).toHaveLength(1);
  });

  test("the builder footer's Correlate button applies the draft and keeps the builder open", async () => {
    render(<CorrelateGraph />);
    fireEvent.click(
      screen.getByTestId("security-events-correlate-toggle-builder"),
    );
    fireEvent.change(screen.getByTestId("correlate-condition-value-0"), {
      target: { value: SEARCHED_HOST },
    });
    fireEvent.click(
      within(screen.getByTestId("correlate-filter-builder")).getByTestId(
        "security-events-correlate-button",
      ),
    );

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });
    expect((queryOfCall(0)["observables"] as Includes).values).toEqual([
      SEARCHED_HOST,
    ]);
    expect(screen.getByTestId("correlate-filter-builder")).toBeInTheDocument();
    expect(screen.getByTestId("correlate-filter-chip-0")).toHaveTextContent(
      SEARCHED_HOST,
    );
  });

  test("switching back to Observable restores the applied single-observable value", async () => {
    render(<CorrelateGraph />);
    runQuickSearch(SEARCHED_HOST);
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });

    // Unapplied text seeds the builder but is dropped on the way back.
    fireEvent.change(
      screen.getByTestId("security-events-correlate-observable"),
      { target: { value: "not-applied" } },
    );
    fireEvent.click(
      screen.getByTestId("security-events-correlate-toggle-builder"),
    );
    expect(screen.getByTestId("correlate-condition-value-0")).toHaveValue(
      "not-applied",
    );

    fireEvent.click(
      screen.getByTestId("security-events-correlate-toggle-simple"),
    );
    expect(
      screen.getByTestId("security-events-correlate-observable"),
    ).toHaveValue(SEARCHED_HOST);
    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("switching back leaves the quick input empty when the applied filter needs the builder", async () => {
    mockQueryParams["q"] = serializeCorrelationFilter(
      twoConditionFilter("and"),
    );

    render(<CorrelateGraph />);
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(
      screen.getByTestId("security-events-correlate-toggle-simple"),
    );
    expect(
      screen.getByTestId("security-events-correlate-observable"),
    ).toHaveValue("");
    // The applied filter itself is untouched.
    expect(screen.getByTestId("correlate-filter-chip-1")).toBeInTheDocument();
    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("pressing Enter in the quick input applies the trimmed value", async () => {
    render(<CorrelateGraph />);
    const quickInput: HTMLElement = screen.getByTestId(
      "security-events-correlate-observable",
    );
    fireEvent.change(quickInput, { target: { value: `  ${SEARCHED_HOST}  ` } });
    fireEvent.keyDown(quickInput, { key: "Enter" });

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });
    expect((queryOfCall(0)["observables"] as Includes).values).toEqual([
      SEARCHED_HOST,
    ]);
  });

  test("pressing Enter in an empty quick input does nothing", () => {
    render(<CorrelateGraph />);
    const quickInput: HTMLElement = screen.getByTestId(
      "security-events-correlate-observable",
    );
    fireEvent.change(quickInput, { target: { value: "   " } });
    fireEvent.keyDown(quickInput, { key: "Enter" });

    expect(getListMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("correlate-applied-filter")).toBeNull();
    expect(
      screen.getByTestId("security-events-correlate-button"),
    ).toBeDisabled();
  });

  test("the applied filter row appears only once a filter is applied", async () => {
    render(<CorrelateGraph />);
    expect(screen.queryByTestId("correlate-applied-filter")).toBeNull();

    runQuickSearch(SEARCHED_HOST);

    const appliedRow: HTMLElement = screen.getByTestId(
      "correlate-applied-filter",
    );
    expect(appliedRow).toHaveTextContent("Applied filter");
    expect(
      within(appliedRow).getByTestId("correlate-filter-chip-0"),
    ).toHaveTextContent(SEARCHED_HOST);
    await waitForSettled();
  });

  test("the time range dropdown lists every preset and has no clear control", async () => {
    // A severity condition renders a clearable value dropdown: the control.
    mockQueryParams["q"] = serializeCorrelationFilter({
      conditions: [
        { field: "severityName", operator: "equals", value: "High" },
      ],
      connector: "and",
    } as CorrelationFilter);

    render(<CorrelateGraph />);
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });

    const builderRow: HTMLElement = screen.getByTestId(
      "correlate-condition-row-0",
    );
    expect(
      builderRow.querySelectorAll(".ou-select__clear-indicator"),
    ).toHaveLength(1);

    const timeRange: HTMLElement = screen.getByTestId(
      "security-events-correlate-time-range",
    );
    expect(timeRange).toHaveTextContent("Last 24 hours");
    expect(
      timeRange.querySelectorAll(".ou-select__clear-indicator"),
    ).toHaveLength(0);

    fireEvent.keyDown(within(timeRange).getByRole("combobox"), {
      key: "ArrowDown",
    });
    const optionLabels: Array<string> = screen
      .getAllByRole("option")
      .map((option: HTMLElement): string => {
        return option.textContent || "";
      });
    expect(optionLabels).toEqual([
      "Last 1 hour",
      "Last 6 hours",
      "Last 24 hours",
      "Last 7 days",
      "Last 30 days",
    ]);
  });
});

describe("CorrelateGraph results header and summary", () => {
  test("states the event count and the searched window once results load", async () => {
    await renderCorrelated();

    const resultCount: HTMLElement = screen.getByTestId(
      "correlate-result-count",
    );
    expect(resultCount).toHaveAttribute("role", "status");
    expect(resultCount).toHaveTextContent(/^4 matching events\.$/);
    // The sentence lives in the header only.
    expect(screen.getByText(/4 matching events\./)).toBe(resultCount);

    expect(screen.getByTestId("correlate-result-window")).toHaveTextContent(
      /^Searched .+ – .+$/,
    );
    expect(screen.queryByTestId("correlate-truncation-notice")).toBeNull();
  });

  test("uses the singular for a single event", async () => {
    await renderCorrelated([
      buildEvent({
        id: "d1111111-1111-4111-8111-111111111111",
        className: "Authentication",
        observables: [SEARCHED_HOST],
      }),
    ]);

    expect(screen.getByTestId("correlate-result-count")).toHaveTextContent(
      /^1 matching event\.$/,
    );
  });

  test("summarises events, classes, observables and the worst severity in stat tiles", async () => {
    await renderCorrelated();

    const eventsTile: HTMLElement = screen.getByTestId("correlate-stat-events");
    expect(within(eventsTile).getByText("4")).toBeInTheDocument();
    expect(eventsTile).toHaveTextContent("In the selected window");

    const classesTile: HTMLElement = screen.getByTestId(
      "correlate-stat-classes",
    );
    expect(within(classesTile).getByText("3")).toBeInTheDocument();
    // Critical (Process Activity) and High (Authentication).
    expect(classesTile).toHaveTextContent("2 critical or high");

    const observablesTile: HTMLElement = screen.getByTestId(
      "correlate-stat-observables",
    );
    expect(within(observablesTile).getByText("3")).toBeInTheDocument();
    expect(observablesTile).toHaveTextContent("All shown");

    const severityTile: HTMLElement = screen.getByTestId(
      "correlate-stat-severity",
    );
    expect(within(severityTile).getByText("Critical")).toBeInTheDocument();
    expect(
      within(severityTile).getByTestId("correlate-stat-worst-class"),
    ).toHaveTextContent("Process Activity");
  });

  test("the worst-class shortcut opens the highest-severity class", async () => {
    await renderCorrelated();

    fireEvent.click(screen.getByTestId("correlate-stat-worst-class"));

    const drillDown: HTMLElement = screen.getByTestId("correlate-drilldown");
    expect(within(drillDown).getByText("Process Activity")).toBeInTheDocument();
    expect(
      within(drillDown).getByText("suspicious process"),
    ).toBeInTheDocument();
    expect(
      within(drillDown).queryByText("failed password for alice"),
    ).toBeNull();
    expect(getSelectedNodeIds()).toEqual(["class:Process Activity"]);
  });

  test("without any severity the severity tile says so and offers no shortcut", async () => {
    await renderCorrelated([
      buildEvent({
        id: "d2222222-2222-4222-8222-222222222222",
        className: "Authentication",
        observables: [SEARCHED_HOST, "alice"],
      }),
    ]);

    const severityTile: HTMLElement = screen.getByTestId(
      "correlate-stat-severity",
    );
    expect(severityTile).toHaveTextContent("No severity recorded");
    expect(screen.queryByTestId("correlate-stat-worst-class")).toBeNull();
    expect(screen.getByTestId("correlate-stat-classes")).toHaveTextContent(
      "0 critical or high",
    );
  });

  test("a capped search marks every count as a lower bound", async () => {
    await renderCorrelated(cappedEvents(200));

    expect(screen.getByTestId("correlate-result-count")).toHaveTextContent(
      /^200\+ matching events\.$/,
    );

    const eventsTile: HTMLElement = screen.getByTestId("correlate-stat-events");
    expect(within(eventsTile).getByText("200+")).toBeInTheDocument();
    expect(eventsTile).toHaveTextContent("Search limit reached");

    const notice: HTMLElement = screen.getByTestId(
      "correlate-truncation-notice",
    );
    expect(notice).toHaveAttribute("role", "status");
    const lowerBoundTexts: Array<HTMLElement> = screen.getAllByText(
      /treat counts as lower bounds/,
    );
    expect(lowerBoundTexts).toHaveLength(1);
    expect(notice).toContainElement(lowerBoundTexts[0] as HTMLElement);

    const classNode: CorrelateFlowNode = getFlowNode("class:Authentication");
    expect(classNode.data.label).toBe("Authentication (200)");
    expect(classNode.data.count).toBe(200);
    expect(classNode.data.countIsLowerBound).toBe(true);

    expect(screen.getByTestId("correlate-overview-class-0")).toHaveTextContent(
      "200+",
    );
  });

  test("an OR search is capped when any one of its queries hits the limit", async () => {
    // Different fields, so the chain fans out into two queries.
    mockQueryParams["q"] = serializeCorrelationFilter({
      conditions: [
        { field: "observable", operator: "equals", value: SEARCHED_HOST },
        { field: "message", operator: "contains", value: "failed" },
      ],
      connector: "or",
    } as CorrelationFilter);
    getListMock.mockImplementation((args: any) => {
      if ((args.query as QueryRecord)["observables"]) {
        return Promise.resolve(listResult(cappedEvents(200)));
      }
      return Promise.resolve(
        listResult([
          buildEvent({
            id: "d3333333-3333-4333-8333-333333333333",
            className: "Detection Finding",
            message: "failed logon burst",
          }),
        ]),
      );
    });

    render(<CorrelateGraph />);
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByTestId("correlate-result-count")).toHaveTextContent(
        /^201\+ matching events\.$/,
      );
    });
    expect(
      screen.getByTestId("correlate-truncation-notice"),
    ).toBeInTheDocument();
  });

  test("more than 30 co-occurring observables are capped and the drop is reported", async () => {
    await renderCorrelated(crowdedEvents());

    const observablesTile: HTMLElement = screen.getByTestId(
      "correlate-stat-observables",
    );
    expect(within(observablesTile).getByText("30")).toBeInTheDocument();
    expect(observablesTile).toHaveTextContent("5 less frequent not shown");

    const droppedNote: HTMLElement = screen.getByTestId(
      "correlate-dropped-observables",
    );
    expect(droppedNote).toHaveAttribute("role", "status");
    expect(droppedNote).toHaveTextContent(
      "5 less frequent observables not drawn",
    );
    expect(
      within(screen.getByTestId("correlate-legend")).getByTestId(
        "correlate-dropped-observables",
      ),
    ).toBe(droppedNote);
    expect(screen.getByTestId("correlate-overview-dropped")).toHaveTextContent(
      "5 less frequent observables not shown",
    );

    expect(
      getNodeIdsWhere((node: CorrelateFlowNode): boolean => {
        return node.data.kind === "observable";
      }),
    ).toHaveLength(30);
    expect(screen.getByTestId("flow-node-observable:obs-29")).toBeTruthy();
    expect(screen.queryByTestId("flow-node-observable:obs-30")).toBeNull();
  });

  test("the legend explains the canvas and reports nothing dropped on a small graph", async () => {
    await renderCorrelated();

    const legend: HTMLElement = screen.getByTestId("correlate-legend");
    expect(legend).toHaveTextContent("Your filter");
    expect(legend).toHaveTextContent("Event class");
    expect(legend).toHaveTextContent("Co-occurring observable");
    expect(
      within(legend).getByTestId("correlate-legend-severity-critical"),
    ).toBeInTheDocument();
    expect(
      within(legend).getByTestId("correlate-legend-severity-none"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("correlate-dropped-observables")).toBeNull();
    expect(screen.queryByTestId("correlate-overview-dropped")).toBeNull();
  });

  test("Refresh refetches the same query without touching the URL", async () => {
    await renderCorrelated();
    const urlSyncCount: number = setQueryStringMock.mock.calls.length;

    fireEvent.click(screen.getByTestId("correlate-refresh"));

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    const firstQuery: QueryRecord = queryOfCall(0);
    const secondQuery: QueryRecord = queryOfCall(1);
    expect((secondQuery["projectId"] as ObjectID).toString()).toBe(
      (firstQuery["projectId"] as ObjectID).toString(),
    );
    expect((secondQuery["observables"] as Includes).values).toEqual(
      (firstQuery["observables"] as Includes).values,
    );
    expect(Object.keys(secondQuery).sort()).toEqual(
      Object.keys(firstQuery).sort(),
    );
    expect(windowHoursOfCall(1)).toBe(24);
    expect(setQueryStringMock).toHaveBeenCalledTimes(urlSyncCount);

    await waitForSettled();
    expect(screen.getByTestId("correlate-result-count")).toHaveTextContent(
      "4 matching events.",
    );
  });
});

describe("CorrelateGraph canvas", () => {
  test("configures React Flow as a read-only view that leaves page scrolling alone", async () => {
    await renderCorrelated();

    const props: ReactFlowProps = getFlowProps();
    expect(props.zoomOnScroll).toBe(false);
    expect(props.preventScrolling).toBe(false);
    expect(props.zoomOnDoubleClick).toBe(false);
    expect(props.nodesDraggable).toBe(false);
    expect(props.nodesConnectable).toBe(false);
    expect(props.nodesFocusable).toBe(false);
    expect(props.edgesFocusable).toBe(false);
    expect(props.elementsSelectable).toBe(false);
    expect(props.minZoom).toBe(0.1);
    expect(props.fitView).toBe(true);
    expect(props.fitViewOptions?.maxZoom).toBe(1);
    expect(props.nodeOrigin).toEqual([0.5, 0.5]);
    expect(Object.keys(props.nodeTypes || {})).toEqual(["correlate"]);
    expect(props.onPaneClick).toEqual(expect.any(Function));

    const canvas: HTMLElement = screen.getByRole("region", {
      name: "Correlation graph",
    });
    expect(canvas).toBe(screen.getByTestId("correlate-canvas"));
    expect(canvas).toContainElement(screen.getByTestId("mock-react-flow"));
  });

  test("hands React Flow fixed-size correlate cards that keep the plain-text labels", async () => {
    await renderCorrelated();

    expect(
      getNodeIdsWhere((node: CorrelateFlowNode): boolean => {
        return Boolean(node.id);
      }),
    ).toEqual([
      "center",
      "class:Authentication",
      "class:Network Activity",
      "class:Process Activity",
      "observable:10.0.0.5",
      "observable:alice",
      "observable:bash",
    ]);

    for (const node of getFlowNodes()) {
      expect(node.type).toBe("correlate");
      expect(typeof node.width).toBe("number");
      expect(typeof node.height).toBe("number");
      expect(node.width).toBe(CORRELATE_NODE_SIZES[node.data.kind].width);
      expect(node.height).toBe(CORRELATE_NODE_SIZES[node.data.kind].height);
      expect(node.draggable).toBe(false);
      expect(node.selectable).toBe(false);
      expect(node.data.isSelected).toBe(false);
      expect(node.data.isDimmed).toBe(false);
    }

    const center: CorrelateFlowNode = getFlowNode("center");
    expect(center.data.kind).toBe("center");
    expect(center.data.label).toBe(
      describeCorrelationCondition({
        field: "observable",
        operator: "equals",
        value: SEARCHED_HOST,
      } as CorrelationFilter["conditions"][number]),
    );
    expect(center.data.title).toBe(SEARCHED_HOST);
    expect(center.data.eyebrow).toBe("Your filter");
    expect(center.data.isMonospace).toBe(true);

    const authentication: CorrelateFlowNode = getFlowNode(
      "class:Authentication",
    );
    expect(authentication.data).toEqual(
      expect.objectContaining({
        kind: "class",
        label: "Authentication (2)",
        title: "Authentication",
        count: 2,
        countIsLowerBound: false,
        worstSeverity: OcsfSeverity.High,
      }),
    );
    expect(getFlowNode("class:Process Activity").data.worstSeverity).toBe(
      OcsfSeverity.Critical,
    );
    expect(
      getFlowNode("class:Network Activity").data.worstSeverity,
    ).toBeUndefined();
    expect(
      screen.getByTestId("flow-node-class:Network Activity"),
    ).toHaveTextContent("Network Activity (1)");

    const alice: CorrelateFlowNode = getFlowNode("observable:alice");
    expect(alice.data).toEqual(
      expect.objectContaining({
        kind: "observable",
        label: "alice",
        title: "alice",
        count: 2,
      }),
    );
    expect(getFlowNode("observable:bash").data.count).toBe(1);
  });

  test.each<["and" | "or", string, string]>([
    ["and", "Match all", "2 conditions (ALL)"],
    ["or", "Match any", "2 conditions (ANY)"],
  ])(
    "a multi-condition %s filter labels the centre card with its connector",
    async (connector: "and" | "or", eyebrow: string, label: string) => {
      mockQueryParams["q"] = serializeCorrelationFilter(
        twoConditionFilter(connector),
      );
      getListMock.mockResolvedValue(listResult(standardEvents()));

      render(<CorrelateGraph />);
      await waitForSettled();

      const center: CorrelateFlowNode = getFlowNode("center");
      expect(center.data.eyebrow).toBe(eyebrow);
      expect(center.data.title).toBe("2 conditions");
      expect(center.data.isMonospace).toBeFalsy();
      expect(center.data.label).toBe(label);
      expect(center.data.tooltip).toContain(
        connector === "or" ? " OR " : " AND ",
      );
    },
  );

  test("draws straight edges and labels only the class-to-observable counts on a small graph", async () => {
    await renderCorrelated();

    const edges: Array<FlowEdge> = getFlowEdges();
    expect(edges).toHaveLength(7);
    for (const edge of edges) {
      expect(edge.type).toBe("straight");
      expect(edge.animated).toBeFalsy();
      expect(edge.markerEnd).toBeUndefined();
      expect(edge.style?.opacity).toBe(0.85);
    }

    for (const classId of [
      "class:Authentication",
      "class:Network Activity",
      "class:Process Activity",
    ]) {
      const spoke: FlowEdge = getFlowEdge(`center->${classId}`);
      expect(spoke.source).toBe("center");
      expect(spoke.target).toBe(classId);
      expect(spoke.label).toBeUndefined();
    }

    const aliceEdge: FlowEdge = getFlowEdge(
      "class:Authentication->observable:alice",
    );
    expect(aliceEdge.label).toBe("2");
    expect(aliceEdge.labelShowBg).toBe(true);
    expect(String(aliceEdge.labelBgStyle?.fill)).toMatch(/^var\(--ou-/);
    expect(String(aliceEdge.labelStyle?.fill)).toMatch(/^var\(--ou-/);
    expect(getFlowEdge("class:Authentication->observable:10.0.0.5").label).toBe(
      "1",
    );
    expect(
      getFlowEdge("class:Network Activity->observable:10.0.0.5").label,
    ).toBe("1");
  });

  test("a large graph leaves every edge unlabelled until something is selected", async () => {
    await renderCorrelated(crowdedEvents());

    // 1 spoke + 30 observable edges is over the label budget.
    expect(getFlowEdges()).toHaveLength(31);
    for (const edge of getFlowEdges()) {
      expect(edge.label).toBeUndefined();
    }

    clickFlowNode("observable:obs-00");
    expect(getFlowEdge("class:Authentication->observable:obs-00").label).toBe(
      "1",
    );
    expect(
      getFlowEdge("class:Authentication->observable:obs-01").label,
    ).toBeUndefined();
  });
});

describe("CorrelateGraph selection", () => {
  test("nothing is selected and no panel shows before a click", async () => {
    await renderCorrelated();

    expect(getSelectedNodeIds()).toEqual([]);
    expect(getDimmedNodeIds()).toEqual([]);
    expect(screen.queryByTestId("correlate-inspector")).toBeNull();
    expect(screen.queryByTestId("correlate-drilldown")).toBeNull();
    expect(screen.queryByTestId("correlate-observable-actions")).toBeNull();
  });

  test("selection is single: a class click replaces an observable selection", async () => {
    await renderCorrelated();

    clickFlowNode("observable:alice");
    expect(
      screen.getByTestId("correlate-observable-actions"),
    ).toBeInTheDocument();
    expect(getSelectedNodeIds()).toEqual(["observable:alice"]);

    clickFlowNode("class:Process Activity");
    expect(screen.queryByTestId("correlate-observable-actions")).toBeNull();
    const inspector: HTMLElement = screen.getByTestId("correlate-inspector");
    expect(
      within(inspector).getByTestId("correlate-drilldown"),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("correlate-inspector")).toHaveLength(1);
    expect(getSelectedNodeIds()).toEqual(["class:Process Activity"]);

    // And back again.
    clickFlowNode("observable:bash");
    expect(screen.queryByTestId("correlate-drilldown")).toBeNull();
    expect(getSelectedNodeIds()).toEqual(["observable:bash"]);
  });

  test("selecting an observable dims everything outside its neighbourhood", async () => {
    await renderCorrelated();

    clickFlowNode("observable:alice");

    expect(getDimmedNodeIds()).toEqual([
      "class:Network Activity",
      "class:Process Activity",
      "observable:10.0.0.5",
      "observable:bash",
    ]);
    expect(getFlowNode("center").data.isDimmed).toBe(false);
    expect(getFlowNode("class:Authentication").data.isDimmed).toBe(false);
    expect(getFlowNode("observable:alice").data.isSelected).toBe(true);

    const litEdge: FlowEdge = getFlowEdge(
      "class:Authentication->observable:alice",
    );
    expect(litEdge.style?.stroke).toBe(SELECTED_ACCENT);
    expect(litEdge.style?.opacity).toBe(0.85);
    expect(litEdge.label).toBe("2");

    const litSpoke: FlowEdge = getFlowEdge("center->class:Authentication");
    expect(litSpoke.style?.stroke).toBe(SELECTED_ACCENT);
    expect(litSpoke.label).toBeUndefined();

    const fadedEdge: FlowEdge = getFlowEdge(
      "class:Process Activity->observable:bash",
    );
    expect(fadedEdge.style?.stroke).not.toBe(SELECTED_ACCENT);
    expect(fadedEdge.style?.opacity).toBe(0.15);
    // Outside the selection, counts are hidden even on a small graph.
    expect(fadedEdge.label).toBeUndefined();
    expect(getFlowEdge("center->class:Process Activity").style?.opacity).toBe(
      0.15,
    );
  });

  test("selecting a class lights its spoke and its observables", async () => {
    await renderCorrelated();

    clickFlowNode("class:Authentication");

    expect(getDimmedNodeIds()).toEqual([
      "class:Network Activity",
      "class:Process Activity",
      "observable:bash",
    ]);
    for (const edgeId of [
      "center->class:Authentication",
      "class:Authentication->observable:alice",
      "class:Authentication->observable:10.0.0.5",
    ]) {
      expect(getFlowEdge(edgeId).style?.stroke).toBe(SELECTED_ACCENT);
    }
    expect(
      getFlowEdge("class:Network Activity->observable:10.0.0.5").style?.opacity,
    ).toBe(0.15);
  });

  test("clicking the empty canvas clears the selection", async () => {
    await renderCorrelated();
    clickFlowNode("observable:alice");
    expect(screen.getByTestId("correlate-inspector")).toBeInTheDocument();

    act(() => {
      getFlowProps().onPaneClick?.({} as React.MouseEvent);
    });

    expect(screen.queryByTestId("correlate-inspector")).toBeNull();
    expect(getSelectedNodeIds()).toEqual([]);
    expect(getDimmedNodeIds()).toEqual([]);
  });

  test("clicking the centre card clears the selection", async () => {
    await renderCorrelated();
    clickFlowNode("class:Authentication");
    expect(screen.getByTestId("correlate-drilldown")).toBeInTheDocument();

    clickFlowNode("center");

    expect(screen.queryByTestId("correlate-inspector")).toBeNull();
    expect(getSelectedNodeIds()).toEqual([]);
    expect(getDimmedNodeIds()).toEqual([]);
  });

  test("the selection panel floats over the canvas while the overview stays below the legend", async () => {
    await renderCorrelated();

    const canvas: HTMLElement = screen.getByTestId("correlate-canvas");
    const legend: HTMLElement = screen.getByTestId("correlate-legend");
    const overview: HTMLElement = screen.getByTestId("correlate-overview");
    expect(isBefore(canvas, legend)).toBe(true);
    expect(isBefore(legend, overview)).toBe(true);

    clickFlowNode("observable:alice");

    const inspector: HTMLElement = screen.getByRole("complementary", {
      name: "Details",
    });
    expect(inspector).toBe(screen.getByTestId("correlate-inspector"));
    expect(inspector.tagName).toBe("ASIDE");
    // Focusable from script only, so a list selection can move focus to it.
    expect(inspector).toHaveAttribute("tabindex", "-1");
    /*
     * It shares the canvas's positioned wrapper and overlays it only from xl
     * up; below that it stacks under the canvas and scrolls on its own.
     */
    expect(inspector.parentElement).toBe(canvas.parentElement);
    expect(inspector.parentElement).toHaveClass("relative");
    expect(inspector).toHaveClass(
      "xl:absolute",
      "xl:right-3",
      "xl:top-3",
      "xl:bottom-3",
      "xl:w-[22rem]",
      "xl:max-h-none",
      "max-h-[28rem]",
      "overflow-y-auto",
      "border-t",
    );
    expect(inspector).not.toHaveClass("absolute");
    expect(inspector).not.toHaveClass("md:absolute");
    expect(inspector).not.toHaveClass("lg:absolute");
    expect(isBefore(canvas, inspector)).toBe(true);
    expect(canvas).not.toContainElement(inspector);
    expect(
      within(inspector).getByTestId("correlate-observable-actions"),
    ).toBeInTheDocument();

    // The overview is not replaced by the selection.
    expect(screen.getByTestId("correlate-overview")).toBe(overview);
    expect(isBefore(inspector, overview)).toBe(true);
    expect(isBefore(legend, overview)).toBe(true);
  });

  test("changing the time range closes an open drill-down", async () => {
    await renderCorrelated();
    clickFlowNode("class:Authentication");
    expect(screen.getByTestId("correlate-drilldown")).toBeInTheDocument();

    selectTimeRange("Last 7 days");

    expect(screen.queryByTestId("correlate-drilldown")).toBeNull();
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    await waitForSettled();
    expect(screen.queryByTestId("correlate-inspector")).toBeNull();
    expect(getSelectedNodeIds()).toEqual([]);
  });
});

describe("CorrelateGraph overview lists", () => {
  test("rank classes by worst severity and observables by frequency", async () => {
    await renderCorrelated();

    const overview: HTMLElement = screen.getByTestId("correlate-overview");
    expect(
      within(overview).getByTestId("correlate-overview-class-0"),
    ).toHaveTextContent(/Process Activity.*Critical.*1/);
    expect(
      within(overview).getByTestId("correlate-overview-class-1"),
    ).toHaveTextContent(/Authentication.*High.*2/);
    expect(
      within(overview).getByTestId("correlate-overview-class-2"),
    ).toHaveTextContent(/Network Activity.*No severity.*1/);
    expect(screen.queryByTestId("correlate-overview-class-3")).toBeNull();

    expect(
      within(overview).getByTestId("correlate-overview-observable-0"),
    ).toHaveTextContent(/10\.0\.0\.5.*2/);
    expect(
      within(overview).getByTestId("correlate-overview-observable-1"),
    ).toHaveTextContent(/alice.*2/);
    expect(
      within(overview).getByTestId("correlate-overview-observable-2"),
    ).toHaveTextContent(/bash.*1/);
    expect(screen.queryByTestId("correlate-overview-observable-3")).toBeNull();
  });

  test("a class row opens that class's events (the keyboard path)", async () => {
    await renderCorrelated();

    const row: HTMLElement = screen.getByTestId("correlate-overview-class-0");
    expect(row.tagName).toBe("BUTTON");
    expect(row).not.toBeDisabled();
    fireEvent.click(row);

    const drillDown: HTMLElement = screen.getByTestId("correlate-drilldown");
    expect(within(drillDown).getByText("Process Activity")).toBeInTheDocument();
    expect(
      within(drillDown).getByTestId("correlate-drilldown-count"),
    ).toHaveTextContent("1 matching event");
    expect(getSelectedNodeIds()).toEqual(["class:Process Activity"]);
    // The overview is still there to pick something else.
    expect(screen.getByTestId("correlate-overview")).toBeInTheDocument();
  });

  test("an observable row opens its pivots (the keyboard path)", async () => {
    await renderCorrelated();

    const row: HTMLElement = screen.getByTestId(
      "correlate-overview-observable-0",
    );
    expect(row.tagName).toBe("BUTTON");
    fireEvent.click(row);

    const actions: HTMLElement = screen.getByTestId(
      "correlate-observable-actions",
    );
    expect(within(actions).getByText("10.0.0.5")).toBe(
      within(actions).getByTestId("correlate-observable-value"),
    );
    expect(getSelectedNodeIds()).toEqual(["observable:10.0.0.5"]);

    // Picking another row swaps the panel.
    fireEvent.click(screen.getByTestId("correlate-overview-class-1"));
    expect(screen.queryByTestId("correlate-observable-actions")).toBeNull();
    expect(
      within(screen.getByTestId("correlate-drilldown")).getByText(
        "Authentication",
      ),
    ).toBeInTheDocument();
  });
});

describe("CorrelateGraph pivots", () => {
  test("Add appends an equality condition, refetches with hasAll and opens the builder", async () => {
    await renderCorrelated();
    const urlSyncCount: number = setQueryStringMock.mock.calls.length;

    clickFlowNode("observable:alice");
    expect(
      within(screen.getByTestId("correlate-observable-actions")).getByText(
        "Keep only events that also mention it.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("correlate-action-add"));

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    const observables: IncludesAll = queryOfCall(1)[
      "observables"
    ] as IncludesAll;
    expect(observables).toBeInstanceOf(IncludesAll);
    expect(observables.values).toEqual([SEARCHED_HOST, "alice"]);

    // A two-condition filter only fits the builder.
    expect(screen.getByTestId("correlate-filter-builder")).toBeInTheDocument();
    expect(
      screen.getByTestId("security-events-correlate-toggle-builder"),
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("correlate-condition-value-1")).toHaveValue(
      "alice",
    );
    expect(screen.getByTestId("correlate-filter-chip-1")).toHaveTextContent(
      "alice",
    );
    expect(
      within(screen.getByTestId("correlate-filter-builder")).getByTestId(
        "security-events-correlate-button",
      ),
    ).toBeInTheDocument();

    // The pivot clears the selection and lands in the URL.
    expect(screen.queryByTestId("correlate-inspector")).toBeNull();
    expect(setQueryStringMock).toHaveBeenCalledTimes(urlSyncCount + 1);
    expect(setQueryStringMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        q: expect.stringContaining("alice"),
        hours: "24",
        observable: null,
      }),
    );
    await waitForSettled();
  });

  test("Exclude opens the builder with the Correlate button in its footer", async () => {
    await renderCorrelated();

    clickFlowNode("observable:alice");
    fireEvent.click(screen.getByTestId("correlate-action-exclude"));

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    const operators: Array<unknown> = queryOfCall(1)[
      "observables"
    ] as Array<unknown>;
    expect(operators[0]).toBeInstanceOf(Includes);
    expect(operators[1]).toBeInstanceOf(IncludesNone);
    expect((operators[1] as IncludesNone).values).toEqual(["alice"]);

    const builder: HTMLElement = screen.getByTestId("correlate-filter-builder");
    expect(
      within(builder).getByTestId("security-events-correlate-button"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("security-events-correlate-observable"),
    ).toBeNull();
    await waitForSettled();
    expect(
      within(builder).getByTestId("security-events-correlate-button"),
    ).not.toBeDisabled();
  });

  test("Focus after an auto-opened builder closes it and fills the quick input", async () => {
    await renderCorrelated();

    clickFlowNode("observable:alice");
    fireEvent.click(screen.getByTestId("correlate-action-exclude"));
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    await waitForSettled();
    expect(screen.getByTestId("correlate-filter-builder")).toBeInTheDocument();

    // "is not alice" does not remove alice from the co-occurring layer.
    clickFlowNode("observable:alice");
    fireEvent.click(screen.getByTestId("correlate-action-focus"));

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(3);
    });
    expect((queryOfCall(2)["observables"] as Includes).values).toEqual([
      "alice",
    ]);
    expect(screen.queryByTestId("correlate-filter-builder")).toBeNull();
    expect(
      screen.getByTestId("security-events-correlate-toggle-simple"),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByTestId("security-events-correlate-observable"),
    ).toHaveValue("alice");
    expect(screen.queryByTestId("correlate-filter-chip-1")).toBeNull();
    await waitForSettled();
  });

  test("OR mode: Add joins the value into the OR chain and keeps the builder open", async () => {
    mockQueryParams["q"] = serializeCorrelationFilter(twoObservableOrFilter());
    getListMock.mockResolvedValue(listResult(standardEvents()));

    render(<CorrelateGraph />);
    // Same-field equalities under OR share one hasAny query.
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });
    await waitForSettled();

    clickFlowNode("observable:alice");
    expect(
      within(screen.getByTestId("correlate-observable-actions")).getByText(
        "Also include events that mention it.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("correlate-action-add"));

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    const observables: Includes = queryOfCall(1)["observables"] as Includes;
    expect(observables).toBeInstanceOf(Includes);
    expect(observables.values).toEqual([
      SEARCHED_HOST,
      "192.168.1.20",
      "alice",
    ]);
    expect(screen.getByTestId("correlate-filter-chip-2")).toHaveTextContent(
      "alice",
    );
    expect(screen.getByTestId("correlate-filter-chips")).toHaveTextContent(
      "OR",
    );
    expect(screen.getByTestId("correlate-filter-builder")).toBeInTheDocument();
    await waitForSettled();
  });

  test("a Seen-in chip switches the panel to that class", async () => {
    await renderCorrelated();

    clickFlowNode("observable:10.0.0.5");
    const actions: HTMLElement = screen.getByTestId(
      "correlate-observable-actions",
    );
    expect(
      within(actions).getByTestId("correlate-observable-fact-events"),
    ).toHaveTextContent("2");
    expect(
      within(actions).getByTestId("correlate-observable-fact-classes"),
    ).toHaveTextContent("2");
    expect(
      within(actions).getByTestId("correlate-observable-class-0"),
    ).toHaveTextContent("Authentication");
    expect(
      within(actions).getByTestId("correlate-observable-class-1"),
    ).toHaveTextContent("Network Activity");

    fireEvent.click(
      within(actions).getByTestId("correlate-observable-class-0"),
    );

    expect(screen.queryByTestId("correlate-observable-actions")).toBeNull();
    const drillDown: HTMLElement = screen.getByTestId("correlate-drilldown");
    expect(within(drillDown).getByText("Authentication")).toBeInTheDocument();
    expect(
      within(drillDown).getByTestId("correlate-drilldown-count"),
    ).toHaveTextContent("2 matching events");
    expect(
      within(drillDown).getByText("failed password for alice"),
    ).toBeInTheDocument();
    expect(
      within(drillDown).getByText("accepted password for alice"),
    ).toBeInTheDocument();
    expect(getSelectedNodeIds()).toEqual(["class:Authentication"]);
    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("the observable panel's dismiss button clears the selection", async () => {
    await renderCorrelated();
    clickFlowNode("observable:alice");

    fireEvent.click(screen.getByTestId("correlate-action-dismiss"));

    expect(screen.queryByTestId("correlate-inspector")).toBeNull();
    expect(getSelectedNodeIds()).toEqual([]);
    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("the drill-down close button clears the selection", async () => {
    await renderCorrelated();
    clickFlowNode("class:Authentication");

    fireEvent.click(screen.getByTestId("correlate-drilldown-close"));

    expect(screen.queryByTestId("correlate-inspector")).toBeNull();
    expect(getSelectedNodeIds()).toEqual([]);
    expect(getDimmedNodeIds()).toEqual([]);
  });

  test("Filter to this class opens the builder for the new chain", async () => {
    await renderCorrelated();
    clickFlowNode("class:Authentication");

    fireEvent.click(screen.getByTestId("correlate-drilldown-filter-class"));

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    expect(queryOfCall(1)["className"]).toBe("Authentication");
    expect(screen.getByTestId("correlate-filter-builder")).toBeInTheDocument();
    expect(screen.getByTestId("correlate-condition-value-1")).toHaveValue(
      "Authentication",
    );
    await waitForSettled();
    expect(
      screen.getByTestId("security-events-correlate-button"),
    ).not.toBeDisabled();
  });

  test("the event detail's pivot closes the detail and the builder and re-correlates", async () => {
    mockQueryParams["q"] = serializeCorrelationFilter(
      twoConditionFilter("and"),
    );
    getListMock.mockResolvedValue(listResult(standardEvents()));

    render(<CorrelateGraph />);
    await waitForSettled();
    expect(screen.getByTestId("correlate-filter-builder")).toBeInTheDocument();

    clickFlowNode("class:Authentication");
    fireEvent.click(screen.getByTestId("correlate-drilldown-event-0"));
    expect(screen.getByTestId("mock-event-detail")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mock-event-detail-pivot"));

    expect(screen.queryByTestId("mock-event-detail")).toBeNull();
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    const query: QueryRecord = queryOfCall(1);
    expect((query["observables"] as Includes).values).toEqual([
      detailPivotObservable,
    ]);
    expect(query["principalIp"]).toBeUndefined();
    expect(screen.queryByTestId("correlate-filter-builder")).toBeNull();
    expect(
      screen.getByTestId("security-events-correlate-observable"),
    ).toHaveValue(detailPivotObservable);
    expect(screen.getByTestId("correlate-filter-chip-0")).toHaveTextContent(
      detailPivotObservable,
    );
    expect(screen.queryByTestId("correlate-filter-chip-1")).toBeNull();
    expect(screen.queryByTestId("correlate-inspector")).toBeNull();
    await waitForSettled();
  });
});

describe("CorrelateGraph unclassified events and OR mode", () => {
  test("events without a class get an Unclassified node that cannot be filtered on", async () => {
    await renderCorrelated([
      buildEvent({
        id: "e1111111-1111-4111-8111-111111111111",
        message: "raw syslog line",
        observables: [SEARCHED_HOST],
      }),
      buildEvent({
        id: "e2222222-2222-4222-8222-222222222222",
        className: "Authentication",
        message: "failed password for bob",
        observables: [SEARCHED_HOST],
      }),
    ]);

    expect(
      screen.getByTestId("flow-node-class:Unclassified"),
    ).toHaveTextContent("Unclassified (1)");

    clickFlowNode("class:Unclassified");
    const drillDown: HTMLElement = screen.getByTestId("correlate-drilldown");
    expect(within(drillDown).getByText("raw syslog line")).toBeInTheDocument();
    expect(within(drillDown).queryByText("failed password for bob")).toBeNull();
    expect(screen.queryByTestId("correlate-drilldown-filter-class")).toBeNull();
    // This is an AND filter, so the OR explanation does not apply either.
    expect(screen.queryByTestId("correlate-drilldown-or-note")).toBeNull();

    // A real class still offers the filter.
    clickFlowNode("class:Authentication");
    expect(
      screen.getByTestId("correlate-drilldown-filter-class"),
    ).toBeInTheDocument();
  });

  test("OR mode explains why the class filter is missing", async () => {
    mockQueryParams["q"] = serializeCorrelationFilter(twoObservableOrFilter());
    getListMock.mockResolvedValue(listResult(standardEvents()));

    render(<CorrelateGraph />);
    await waitForSettled();

    clickFlowNode("class:Authentication");

    expect(screen.queryByTestId("correlate-drilldown-filter-class")).toBeNull();
    expect(screen.getByTestId("correlate-drilldown-or-note")).toHaveTextContent(
      "Class filters apply only when matching all conditions.",
    );
  });
});

describe("CorrelateGraph errors", () => {
  test("a failed request shows a retryable error instead of the graph", async () => {
    getListMock.mockRejectedValue(new Error("ClickHouse is down"));

    render(<CorrelateGraph />);
    runQuickSearch(SEARCHED_HOST);

    const requestError: HTMLElement = await screen.findByTestId(
      "correlate-request-error",
    );
    expect(requestError).toHaveTextContent("Couldn't load security events");
    expect(
      within(requestError).getByText(/ClickHouse is down/),
    ).toBeInTheDocument();
    expect(
      within(requestError).getByTestId("correlate-retry"),
    ).toHaveTextContent("Try again");
    // The banner announces itself; the result count stays mounted but silent.
    expect(requestError).toHaveAttribute("role", "alert");
    expect(screen.queryByTestId("mock-react-flow")).toBeNull();
    expect(screen.getByTestId("correlate-result-count")).toBeEmptyDOMElement();
    expect(screen.getByTestId("correlate-results-header")).toHaveClass(
      "sr-only",
    );
    expect(screen.queryByTestId("correlate-refresh")).toBeNull();
    expect(screen.queryByTestId("correlate-fit-view")).toBeNull();
    expect(screen.queryByTestId("correlate-result-window")).toBeNull();
    expect(screen.queryByTestId("correlate-filter-error")).toBeNull();
    // The filter itself is fine and stays applied.
    expect(screen.getByTestId("correlate-filter-chip-0")).toBeInTheDocument();
  });

  test("Try again refetches an equivalent query and renders the graph", async () => {
    getListMock.mockRejectedValueOnce(new Error("ClickHouse is down"));
    getListMock.mockResolvedValue(listResult(standardEvents()));

    render(<CorrelateGraph />);
    runQuickSearch(SEARCHED_HOST);
    await screen.findByTestId("correlate-request-error");
    const urlSyncCount: number = setQueryStringMock.mock.calls.length;

    fireEvent.click(screen.getByTestId("correlate-retry"));

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    const firstQuery: QueryRecord = queryOfCall(0);
    const retryQuery: QueryRecord = queryOfCall(1);
    expect(Object.keys(retryQuery).sort()).toEqual(
      Object.keys(firstQuery).sort(),
    );
    expect((retryQuery["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID_STRING,
    );
    expect((retryQuery["observables"] as Includes).values).toEqual([
      SEARCHED_HOST,
    ]);
    expect(windowHoursOfCall(1)).toBe(24);
    expect(setQueryStringMock).toHaveBeenCalledTimes(urlSyncCount);

    await waitFor(() => {
      expect(
        screen.getByTestId("flow-node-class:Authentication"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId("correlate-request-error")).toBeNull();
    expect(screen.getByTestId("correlate-result-count")).toHaveTextContent(
      "4 matching events.",
    );
  });

  test("an impossible URL filter shows the filter error without fetching", async () => {
    mockQueryParams["q"] = serializeCorrelationFilter(impossibleFilter());

    render(<CorrelateGraph />);

    const filterError: HTMLElement = await screen.findByTestId(
      "correlate-filter-error",
    );
    expect(filterError).toHaveTextContent("This filter can't run");
    expect(
      within(filterError).getByText(/can never match/),
    ).toBeInTheDocument();
    expect(getListMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("correlate-request-error")).toBeNull();
    expect(screen.queryByTestId("mock-react-flow")).toBeNull();
    // The builder is already open, so there is nothing to offer.
    expect(screen.getByTestId("correlate-filter-builder")).toBeInTheDocument();
    expect(screen.queryByTestId("correlate-edit-conditions")).toBeNull();
  });

  test("with the builder closed the filter error offers Edit conditions", async () => {
    mockQueryParams["q"] = serializeCorrelationFilter(impossibleFilter());

    render(<CorrelateGraph />);
    await screen.findByTestId("correlate-filter-error");

    fireEvent.click(
      screen.getByTestId("security-events-correlate-toggle-simple"),
    );
    const editButton: HTMLElement = within(
      screen.getByTestId("correlate-filter-error"),
    ).getByTestId("correlate-edit-conditions");

    fireEvent.click(editButton);

    expect(screen.getByTestId("correlate-filter-builder")).toBeInTheDocument();
    expect(screen.queryByTestId("correlate-edit-conditions")).toBeNull();
    // The builder is seeded from the applied (broken) filter.
    expect(screen.getByTestId("correlate-condition-value-1")).toHaveValue(
      "host-b",
    );
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("switching the connector to OR fixes the filter and fetches", async () => {
    mockQueryParams["q"] = serializeCorrelationFilter(impossibleFilter());

    render(<CorrelateGraph />);
    await screen.findByTestId("correlate-filter-error");

    fireEvent.click(screen.getByTestId("correlate-connector-or"));
    fireEvent.click(screen.getByTestId("security-events-correlate-button"));

    // Either host now matches: one hasAny/IN query over both values.
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });
    const hosts: Includes = queryOfCall(0)["principalHost"] as Includes;
    expect(hosts).toBeInstanceOf(Includes);
    expect(hosts.values).toEqual(["host-a", "host-b"]);
    await waitForNoResults();
    expect(screen.queryByTestId("correlate-filter-error")).toBeNull();
  });
});

describe("CorrelateGraph no results", () => {
  test.each<[string, string]>([
    ["1", "Search last 6 hours"],
    ["6", "Search last 24 hours"],
    ["24", "Search last 7 days"],
    ["168", "Search last 30 days"],
  ])(
    "at ?hours=%s the widen action reads %s",
    async (hours: string, widenLabel: string) => {
      mockQueryParams["observable"] = SEARCHED_HOST;
      mockQueryParams["hours"] = hours;

      render(<CorrelateGraph />);
      await waitForNoResults();

      expect(screen.getByText("No events found")).toBeInTheDocument();
      expect(
        screen.getByTestId("correlate-no-results-widen"),
      ).toHaveTextContent(widenLabel);
    },
  );

  test("there is nothing wider than 30 days", async () => {
    mockQueryParams["observable"] = SEARCHED_HOST;
    mockQueryParams["hours"] = "720";

    render(<CorrelateGraph />);
    await waitForNoResults();

    expect(screen.queryByTestId("correlate-no-results-widen")).toBeNull();
    expect(screen.getByTestId("correlate-no-results-edit")).toBeInTheDocument();
  });

  test("widening refetches a 7-day window and syncs the URL", async () => {
    render(<CorrelateGraph />);
    runQuickSearch(SEARCHED_HOST);
    await waitForNoResults();
    expect(windowHoursOfCall(0)).toBe(24);

    fireEvent.click(screen.getByTestId("correlate-no-results-widen"));

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    expect(windowHoursOfCall(1)).toBe(168);
    expect((queryOfCall(1)["observables"] as Includes).values).toEqual([
      SEARCHED_HOST,
    ]);
    expect(setQueryStringMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        q: expect.stringContaining(SEARCHED_HOST),
        hours: "168",
        observable: null,
      }),
    );
    expect(
      screen.getByTestId("security-events-correlate-time-range"),
    ).toHaveTextContent("Last 7 days");

    await waitForSettled();
    await waitForNoResults();
    expect(screen.getByTestId("correlate-no-results-widen")).toHaveTextContent(
      "Search last 30 days",
    );
  });

  test("Remove last condition appears only with several conditions and drops the last one", async () => {
    mockQueryParams["q"] = serializeCorrelationFilter(
      twoConditionFilter("and"),
    );

    render(<CorrelateGraph />);
    await waitForNoResults();

    const removeLast: HTMLElement = screen.getByTestId(
      "correlate-no-results-remove-last",
    );
    expect(removeLast).toHaveTextContent("Remove last condition");
    fireEvent.click(removeLast);

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    const query: QueryRecord = queryOfCall(1);
    expect(query["principalIp"]).toBe("192.168.1.20");
    expect(query["principalHost"]).toBeUndefined();
    expect(screen.getByTestId("correlate-filter-chip-0")).toHaveTextContent(
      "192.168.1.20",
    );
    expect(screen.queryByTestId("correlate-filter-chip-1")).toBeNull();

    await waitForSettled();
    await waitForNoResults();
    expect(screen.queryByTestId("correlate-no-results-remove-last")).toBeNull();
  });

  test("a single condition offers no Remove last condition", async () => {
    render(<CorrelateGraph />);
    runQuickSearch(SEARCHED_HOST);
    await waitForNoResults();

    expect(screen.queryByTestId("correlate-no-results-remove-last")).toBeNull();
  });

  test("Edit conditions opens the builder seeded from the filter and then hides", async () => {
    render(<CorrelateGraph />);
    runQuickSearch(SEARCHED_HOST);
    await waitForNoResults();

    fireEvent.click(screen.getByTestId("correlate-no-results-edit"));

    expect(screen.getByTestId("correlate-filter-builder")).toBeInTheDocument();
    expect(screen.getByTestId("correlate-condition-value-0")).toHaveValue(
      SEARCHED_HOST,
    );
    expect(screen.queryByTestId("correlate-no-results-edit")).toBeNull();
    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("Edit conditions is hidden while the builder is already open", async () => {
    mockQueryParams["q"] = serializeCorrelationFilter(
      twoConditionFilter("and"),
    );

    render(<CorrelateGraph />);
    await waitForNoResults();

    expect(screen.getByTestId("correlate-filter-builder")).toBeInTheDocument();
    expect(screen.queryByTestId("correlate-no-results-edit")).toBeNull();
    expect(
      screen.getByTestId("correlate-no-results-widen"),
    ).toBeInTheDocument();
  });
});

describe("CorrelateGraph loading", () => {
  test("the first load shows a loader instead of the canvas and blocks another Correlate", async () => {
    const firstLoad: Deferred<MockListResult> =
      createDeferred<MockListResult>();
    getListMock.mockImplementationOnce(() => {
      return firstLoad.promise;
    });

    render(<CorrelateGraph />);
    runQuickSearch(SEARCHED_HOST);

    const loader: HTMLElement = screen.getByTestId("correlate-loading");
    // The (hidden) result count announces the load, not the loader block.
    expect(loader).not.toHaveAttribute("role");
    expect(loader).not.toHaveAttribute("aria-live");
    expect(loader).toHaveTextContent("Correlating events…");
    expect(screen.getByTestId("correlate-results")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.queryByTestId("mock-react-flow")).toBeNull();
    const resultCount: HTMLElement = screen.getByTestId(
      "correlate-result-count",
    );
    expect(resultCount).toHaveTextContent(/^Correlating events…$/);
    expect(screen.getByTestId("correlate-results-header")).toHaveClass(
      "sr-only",
    );
    expect(screen.queryByTestId("correlate-refresh")).toBeNull();
    expect(
      document.getElementById("security-events-correlate-no-results"),
    ).toBeNull();

    const correlateButton: HTMLElement = screen.getByTestId(
      "security-events-correlate-button",
    );
    expect(correlateButton).toBeDisabled();
    // Enter is blocked too while the request is in flight.
    fireEvent.keyDown(
      screen.getByTestId("security-events-correlate-observable"),
      { key: "Enter" },
    );
    expect(getListMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstLoad.resolve(listResult(standardEvents()));
    });

    await waitForSettled();
    expect(screen.queryByTestId("correlate-loading")).toBeNull();
    expect(screen.getByTestId("mock-react-flow")).toBeInTheDocument();
    expect(correlateButton).not.toBeDisabled();
    // The same live region now carries the result, and the header shows.
    expect(screen.getByTestId("correlate-result-count")).toBe(resultCount);
    expect(resultCount).toHaveTextContent(/^4 matching events\.$/);
    expect(screen.getByTestId("correlate-results-header")).not.toHaveClass(
      "sr-only",
    );
  });

  test("a reload keeps the previous graph under an overlay and hides the selection panel", async () => {
    await renderCorrelated();
    clickFlowNode("observable:alice");
    expect(screen.getByTestId("correlate-inspector")).toBeInTheDocument();

    const reload: Deferred<MockListResult> = createDeferred<MockListResult>();
    getListMock.mockImplementationOnce(() => {
      return reload.promise;
    });
    fireEvent.click(screen.getByTestId("correlate-refresh"));

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByTestId("correlate-results")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByTestId("mock-react-flow")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("correlate-canvas")).getByTestId(
        "correlate-canvas-loading",
      ),
    ).toHaveTextContent("Correlating events…");
    expect(screen.queryByTestId("correlate-loading")).toBeNull();
    expect(screen.getByTestId("correlate-result-count")).toHaveTextContent(
      /^Correlating events…$/,
    );

    // No selection panel or neighbourhood dimming over stale data.
    expect(screen.queryByTestId("correlate-inspector")).toBeNull();
    expect(getDimmedNodeIds()).toEqual([]);
    // The previous results stay listed but cannot be acted on.
    expect(screen.getByTestId("correlate-overview-class-0")).toBeDisabled();
    expect(screen.getByTestId("correlate-stat-worst-class")).toBeDisabled();
    expect(screen.getByTestId("correlate-refresh")).toBeDisabled();
    expect(
      screen.getByTestId("security-events-correlate-button"),
    ).toBeDisabled();

    await act(async () => {
      reload.resolve(listResult(standardEvents()));
    });
    await waitForSettled();

    expect(screen.queryByTestId("correlate-canvas-loading")).toBeNull();
    expect(screen.getByTestId("correlate-result-count")).toHaveTextContent(
      "4 matching events.",
    );
    // The node is still on the canvas, so its selection comes back.
    expect(
      within(screen.getByTestId("correlate-observable-actions")).getByText(
        "alice",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("correlate-overview-class-0")).not.toBeDisabled();
  });
});

describe("CorrelateGraph applied filter chips", () => {
  test("a single condition still offers Clear all", async () => {
    await renderCorrelated();

    const chips: HTMLElement = screen.getByTestId("correlate-filter-chips");
    expect(
      within(chips).getByTestId("correlate-filter-clear-all"),
    ).toHaveTextContent("Clear all");
    expect(within(chips).queryByText("AND")).toBeNull();
  });

  test("removing the only chip returns to the start state", async () => {
    await renderCorrelated();

    fireEvent.click(screen.getByTestId("correlate-filter-chip-remove-0"));

    expect(screen.getAllByText("Correlate security events")).toHaveLength(1);
    expect(screen.getByTestId("correlate-start-steps")).toBeInTheDocument();
    expect(screen.queryByTestId("correlate-applied-filter")).toBeNull();
    expect(screen.queryByTestId("mock-react-flow")).toBeNull();
    expect(screen.queryByTestId("correlate-filter-builder")).toBeNull();
    expect(
      screen.getByTestId("security-events-correlate-observable"),
    ).toHaveValue("");
    expect(setQueryStringMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: null, hours: null, observable: null }),
    );
    expect(getListMock).toHaveBeenCalledTimes(1);
  });
});

describe("CorrelateGraph stale responses", () => {
  test("a slow response for an older query never overwrites newer results", async () => {
    const slow: Deferred<MockListResult> = createDeferred<MockListResult>();
    getListMock.mockImplementationOnce(() => {
      return slow.promise;
    });
    getListMock.mockResolvedValueOnce(
      listResult([
        buildEvent({
          id: "f1111111-1111-4111-8111-111111111111",
          className: "Fresh Class",
          observables: [SEARCHED_HOST],
        }),
      ]),
    );

    render(<CorrelateGraph />);
    runQuickSearch(SEARCHED_HOST);
    expect(getListMock).toHaveBeenCalledTimes(1);

    // The time range stays usable while loading and supersedes the request.
    selectTimeRange("Last 7 days");
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("flow-node-class:Fresh Class"),
      ).toBeInTheDocument();
    });

    await act(async () => {
      slow.resolve(
        listResult([
          buildEvent({
            id: "f2222222-2222-4222-8222-222222222222",
            className: "Stale Class",
            observables: [SEARCHED_HOST],
          }),
          buildEvent({
            id: "f3333333-3333-4333-8333-333333333333",
            className: "Stale Class",
            observables: [SEARCHED_HOST],
          }),
        ]),
      );
    });

    expect(screen.queryByTestId("flow-node-class:Stale Class")).toBeNull();
    expect(
      screen.getByTestId("flow-node-class:Fresh Class"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("correlate-result-count")).toHaveTextContent(
      /^1 matching event\.$/,
    );
    expect(screen.getByTestId("correlate-results")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });

  test("a slow failure for an older query does not replace newer results", async () => {
    const slow: Deferred<MockListResult> = createDeferred<MockListResult>();
    getListMock.mockImplementationOnce(() => {
      return slow.promise;
    });
    getListMock.mockResolvedValueOnce(listResult(standardEvents()));

    render(<CorrelateGraph />);
    runQuickSearch(SEARCHED_HOST);
    selectTimeRange("Last 7 days");
    await waitForSettled();
    expect(screen.getByTestId("mock-react-flow")).toBeInTheDocument();

    await act(async () => {
      slow.reject(new Error("ClickHouse is down"));
    });

    expect(screen.queryByTestId("correlate-request-error")).toBeNull();
    expect(screen.getByTestId("mock-react-flow")).toBeInTheDocument();
    expect(screen.getByTestId("correlate-result-count")).toHaveTextContent(
      "4 matching events.",
    );
  });

  test("a slow response that lands after Clear all is ignored", async () => {
    const slow: Deferred<MockListResult> = createDeferred<MockListResult>();
    getListMock.mockImplementationOnce(() => {
      return slow.promise;
    });

    render(<CorrelateGraph />);
    runQuickSearch(SEARCHED_HOST);
    fireEvent.click(screen.getByTestId("correlate-filter-clear-all"));
    expect(screen.getByTestId("correlate-start-steps")).toBeInTheDocument();

    await act(async () => {
      slow.resolve(listResult(standardEvents()));
    });

    expect(screen.getByTestId("correlate-start-steps")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-react-flow")).toBeNull();
    expect(screen.queryByTestId("correlate-result-count")).toBeNull();
    expect(getListMock).toHaveBeenCalledTimes(1);
    // Nothing is left spinning either.
    expect(
      screen.getByTestId("security-events-correlate-button"),
    ).toBeDisabled();
    fireEvent.change(
      screen.getByTestId("security-events-correlate-observable"),
      { target: { value: SEARCHED_HOST } },
    );
    expect(
      screen.getByTestId("security-events-correlate-button"),
    ).not.toBeDisabled();
  });
});

/*
 * Accessibility, layout, fitting, reveal and focus. requestAnimationFrame is
 * swapped for a queue the tests flush one frame at a time, matchMedia for a
 * switchable stub and ResizeObserver for a recorder, so every responsive
 * branch is reachable in jsdom.
 */

const WIDE_CANVAS_QUERY: string = "(min-width: 768px)";
const FLOATING_PANEL_QUERY: string = "(min-width: 1280px)";
const FIT_VIEW_OPTIONS: { padding: number; maxZoom: number } = {
  padding: 0.16,
  maxZoom: 1,
};
const CANVAS_WIDTH: number = 1000;
const CANVAS_HEIGHT: number = 500;
const PANEL_WIDTH: number = 352;
const REVEAL_MARGIN: number = 24;
// Where a node lands when the free area (left of the panel) is centred.
const FREE_AREA_SHIFT: number =
  CANVAS_WIDTH / 2 - (CANVAS_WIDTH - PANEL_WIDTH) / 2;

interface MediaState {
  wide: boolean;
  floating: boolean;
}

interface SyncedFilter {
  v: number;
  j: string;
  c: Array<[string, string, string]>;
}

interface Point {
  x: number;
  y: number;
}

const mediaState: MediaState = { wide: true, floating: true };
const mediaListeners: Set<() => void> = new Set<() => void>();

function installMatchMedia(state: MediaState): void {
  mediaState.wide = state.wide;
  mediaState.floating = state.floating;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => {
      return {
        media: query,
        onchange: null,
        get matches(): boolean {
          if (query === FLOATING_PANEL_QUERY) {
            return mediaState.floating;
          }
          if (query === WIDE_CANVAS_QUERY) {
            return mediaState.wide;
          }
          return false;
        },
        addEventListener: (_type: string, listener: () => void): void => {
          mediaListeners.add(listener);
        },
        removeEventListener: (_type: string, listener: () => void): void => {
          mediaListeners.delete(listener);
        },
        addListener: (listener: () => void): void => {
          mediaListeners.add(listener);
        },
        removeListener: (listener: () => void): void => {
          mediaListeners.delete(listener);
        },
        dispatchEvent: (): boolean => {
          return true;
        },
      } as unknown as MediaQueryList;
    },
  });
}

// Flips the stubbed screen size and fires every "change" listener.
function changeMedia(state: MediaState): void {
  act(() => {
    mediaState.wide = state.wide;
    mediaState.floating = state.floating;
    for (const listener of Array.from(mediaListeners)) {
      listener();
    }
  });
}

function removeMatchMedia(): void {
  delete (window as any).matchMedia;
  mediaListeners.clear();
}

const pendingFrames: Map<number, FrameRequestCallback> = new Map<
  number,
  FrameRequestCallback
>();
let nextFrameId: number = 1;
let frameSpies: Array<{ mockRestore: () => void }> = [];

function installFrameQueue(): void {
  pendingFrames.clear();
  frameSpies = [
    jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback): number => {
        const id: number = nextFrameId;
        nextFrameId += 1;
        pendingFrames.set(id, callback);
        return id;
      }),
    jest
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((id: number): void => {
        pendingFrames.delete(id);
      }),
  ];
}

function restoreFrameQueue(): void {
  for (const spy of frameSpies) {
    spy.mockRestore();
  }
  frameSpies = [];
  pendingFrames.clear();
}

// Runs the callbacks queued so far — anything they queue waits a frame.
function flushFrame(): void {
  const callbacks: Array<FrameRequestCallback> = Array.from(
    pendingFrames.values(),
  );
  pendingFrames.clear();
  act(() => {
    for (const callback of callbacks) {
      callback(0);
    }
  });
}

function flushFrames(count: number): void {
  for (let frame: number = 0; frame < count; frame++) {
    flushFrame();
  }
}

class RecordingResizeObserver {
  public static instances: Array<RecordingResizeObserver> = [];
  public readonly callback: ResizeObserverCallback;
  public readonly targets: Array<Element> = [];
  public isDisconnected: boolean = false;

  public constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    RecordingResizeObserver.instances.push(this);
  }

  public observe(target: Element): void {
    this.targets.push(target);
  }

  public unobserve(target: Element): void {
    const index: number = this.targets.indexOf(target);
    if (index >= 0) {
      this.targets.splice(index, 1);
    }
  }

  public disconnect(): void {
    this.isDisconnected = true;
  }
}

function installResizeObserver(): void {
  RecordingResizeObserver.instances = [];
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: RecordingResizeObserver,
  });
}

function removeResizeObserver(): void {
  delete (window as any).ResizeObserver;
  RecordingResizeObserver.instances = [];
}

function getCanvasObservers(
  canvas: HTMLElement,
): Array<RecordingResizeObserver> {
  return RecordingResizeObserver.instances.filter(
    (observer: RecordingResizeObserver): boolean => {
      return observer.targets.includes(canvas);
    },
  );
}

function setElementSize(
  element: HTMLElement,
  width: number,
  height: number,
): void {
  Object.defineProperty(element, "clientWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: height,
  });
}

// Gives the canvas a new width and tells its ResizeObserver about it.
function resizeCanvas(width: number): void {
  const canvas: HTMLElement = screen.getByTestId("correlate-canvas");
  setElementSize(canvas, width, CANVAS_HEIGHT);
  const observers: Array<RecordingResizeObserver> = getCanvasObservers(canvas);
  expect(observers.length).toBeGreaterThan(0);
  act(() => {
    for (const observer of observers) {
      observer.callback([], observer as unknown as ResizeObserver);
    }
  });
}

function setElementRect(
  element: HTMLElement,
  top: number,
  bottom: number,
): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: (): DOMRect => {
      return {
        top: top,
        bottom: bottom,
        left: 0,
        right: 0,
        x: 0,
        y: top,
        width: 0,
        height: bottom - top,
      } as unknown as DOMRect;
    },
  });
}

function stubScrollIntoView(element: HTMLElement): MockFunction {
  const scrollIntoViewMock: MockFunction = getJestMockFunction();
  Object.defineProperty(element, "scrollIntoView", {
    configurable: true,
    value: scrollIntoViewMock,
  });
  return scrollIntoViewMock;
}

function getNodePoint(nodeId: string): Point {
  const position: Point = getFlowNode(nodeId).position;
  return { x: position.x, y: position.y };
}

// Moves the fake viewport so the node's centre lands at (screenX, screenY).
function placeNodeOnScreen(
  nodeId: string,
  screenX: number,
  screenY: number,
  zoom: number,
): void {
  const point: Point = getNodePoint(nodeId);
  mockViewport.zoom = zoom;
  mockViewport.x = screenX - point.x * zoom;
  mockViewport.y = screenY - point.y * zoom;
}

function getClassPositions(): Map<string, Point> {
  const positions: Map<string, Point> = new Map<string, Point>();
  for (const node of getFlowNodes()) {
    if (node.data.kind === "class") {
      positions.set(node.id, getNodePoint(node.id));
    }
  }
  return positions;
}

// What getCanvasHeight makes of the graph currently handed to React Flow.
function expectedCanvasHeight(narrowCanvasWidth?: number): number {
  const graphNodes: Array<CorrelationGraphNode> = getFlowNodes().map(
    (node: CorrelateFlowNode): CorrelationGraphNode => {
      return { id: node.id, label: node.data.label, kind: node.data.kind };
    },
  );
  const positions: Map<string, LayoutPoint> = new Map<string, LayoutPoint>();
  for (const node of getFlowNodes()) {
    positions.set(node.id, getNodePoint(node.id));
  }
  return getCanvasHeight(graphNodes, positions, narrowCanvasWidth);
}

/*
 * jsdom's CSS parser drops min() values, so the canvas height is read from
 * what React writes to style.height rather than from the element.
 */
let heightSetterSpy: SpyInstance<(value: string) => void> | null = null;

function recordStyleHeights(): void {
  heightSetterSpy = jest.spyOn(CSSStyleDeclaration.prototype, "height", "set");
}

function restoreStyleHeights(): void {
  heightSetterSpy?.mockRestore();
  heightSetterSpy = null;
}

function getCanvasHeightStyle(): string {
  if (!heightSetterSpy) {
    throw new Error("Style heights are not being recorded");
  }
  const canvasHeights: Array<string> = heightSetterSpy.mock.calls
    .map((call: [value: string]): string => {
      return String(call[0]);
    })
    .filter((value: string): boolean => {
      return value.startsWith("min(");
    });
  return canvasHeights[canvasHeights.length - 1] || "";
}

function lastSyncedFilter(): SyncedFilter {
  const calls: Array<Array<unknown>> = setQueryStringMock.mock.calls;
  const lastArgs: { q: string | null } | undefined = calls[
    calls.length - 1
  ]?.[0] as { q: string | null } | undefined;
  if (!lastArgs || !lastArgs.q) {
    throw new Error("No filter was synced to the URL");
  }
  return JSON.parse(lastArgs.q) as SyncedFilter;
}

/*
 * Results land outside act(), so React may still owe the new graph its
 * passive effects (the fit scheduling, onInit, the ResizeObserver) when the
 * DOM already looks settled. Yielding a few macrotasks inside act() lets
 * them run before a test starts counting frames.
 */
async function flushPendingEffects(): Promise<void> {
  await act(async () => {
    for (let tick: number = 0; tick < 3; tick++) {
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 0);
      });
    }
  });
}

async function waitForGraph(): Promise<void> {
  await waitForSettled();
  await flushPendingEffects();
}

async function renderGraph(
  events: Array<SecurityEvent> = standardEvents(),
): Promise<void> {
  await renderCorrelated(events);
  await flushPendingEffects();
}

function focusAndClick(element: HTMLElement): void {
  act(() => {
    element.focus();
  });
  expect(document.activeElement).toBe(element);
  fireEvent.click(element);
}

describe("CorrelateGraph live region", () => {
  test("no results: the hidden header says 0 matching events and offers no graph actions", async () => {
    render(<CorrelateGraph />);
    runQuickSearch(SEARCHED_HOST);
    await waitForNoResults();
    await waitForGraph();

    const results: HTMLElement = screen.getByTestId("correlate-results");
    const header: HTMLElement = screen.getByTestId("correlate-results-header");
    expect(results.firstElementChild).toBe(header);
    expect(header).toHaveClass("sr-only");

    const resultCount: HTMLElement = within(header).getByTestId(
      "correlate-result-count",
    );
    expect(resultCount.tagName).toBe("P");
    expect(resultCount).toHaveAttribute("role", "status");
    expect(resultCount).toHaveAttribute("aria-live", "polite");
    expect(resultCount).toHaveTextContent(/^0 matching events\.$/);
    expect(within(results).getAllByRole("status")).toEqual([resultCount]);

    expect(screen.queryByTestId("correlate-fit-view")).toBeNull();
    expect(screen.queryByTestId("correlate-refresh")).toBeNull();
    expect(screen.queryByTestId("correlate-result-window")).toBeNull();
  });

  test("results: the header shows with the count, the window, Fit and Refresh", async () => {
    await renderGraph();

    const results: HTMLElement = screen.getByTestId("correlate-results");
    const header: HTMLElement = screen.getByTestId("correlate-results-header");
    expect(results.firstElementChild).toBe(header);
    expect(header).not.toHaveClass("sr-only");
    expect(header).toHaveClass("flex", "border-b");

    const resultCount: HTMLElement = within(header).getByTestId(
      "correlate-result-count",
    );
    expect(resultCount).toHaveAttribute("aria-live", "polite");
    expect(resultCount).toHaveTextContent(/^4 matching events\.$/);
    // Nothing else in the results competes with it on a small graph.
    expect(within(results).getAllByRole("status")).toEqual([resultCount]);

    expect(
      within(header).getByTestId("correlate-result-window"),
    ).toBeInTheDocument();
    expect(within(header).getByTestId("correlate-fit-view")).toHaveTextContent(
      "Fit to screen",
    );
    expect(within(header).getByTestId("correlate-refresh")).toHaveTextContent(
      "Refresh",
    );
  });

  test("a filter error leaves the live region empty and the warning alerts", async () => {
    mockQueryParams["q"] = serializeCorrelationFilter(impossibleFilter());

    render(<CorrelateGraph />);
    const filterError: HTMLElement = await screen.findByTestId(
      "correlate-filter-error",
    );

    expect(filterError).toHaveAttribute("role", "alert");
    const resultCount: HTMLElement = screen.getByTestId(
      "correlate-result-count",
    );
    expect(resultCount).toHaveAttribute("role", "status");
    expect(resultCount).toBeEmptyDOMElement();
    expect(screen.getByTestId("correlate-results-header")).toHaveClass(
      "sr-only",
    );
    expect(screen.queryByTestId("correlate-refresh")).toBeNull();
  });

  test("a reload announces itself in the same region and then the new count", async () => {
    await renderGraph();
    const resultCount: HTMLElement = screen.getByTestId(
      "correlate-result-count",
    );

    const reload: Deferred<MockListResult> = createDeferred<MockListResult>();
    getListMock.mockImplementationOnce(() => {
      return reload.promise;
    });
    fireEvent.click(screen.getByTestId("correlate-refresh"));

    await waitFor(() => {
      expect(resultCount).toHaveTextContent(/^Correlating events…$/);
    });
    expect(screen.getByTestId("correlate-result-count")).toBe(resultCount);
    // The stale graph is still up, so its header stays visible.
    expect(screen.getByTestId("correlate-results-header")).not.toHaveClass(
      "sr-only",
    );

    await act(async () => {
      reload.resolve(
        listResult([
          buildEvent({
            id: "d4444444-4444-4444-8444-444444444444",
            className: "Authentication",
            observables: [SEARCHED_HOST],
          }),
        ]),
      );
    });
    await waitForGraph();

    expect(screen.getByTestId("correlate-result-count")).toBe(resultCount);
    expect(resultCount).toHaveTextContent(/^1 matching event\.$/);
  });

  test("a request error after results empties the region and hides the header", async () => {
    await renderGraph();
    const resultCount: HTMLElement = screen.getByTestId(
      "correlate-result-count",
    );

    getListMock.mockRejectedValueOnce(new Error("ClickHouse is down"));
    fireEvent.click(screen.getByTestId("correlate-refresh"));

    await screen.findByTestId("correlate-request-error");
    expect(screen.getByTestId("correlate-result-count")).toBe(resultCount);
    expect(resultCount).toBeEmptyDOMElement();
    expect(screen.getByTestId("correlate-results-header")).toHaveClass(
      "sr-only",
    );
    expect(screen.queryByTestId("correlate-fit-view")).toBeNull();
    expect(screen.queryByTestId("correlate-refresh")).toBeNull();
    expect(screen.queryByTestId("correlate-result-window")).toBeNull();
  });
});

describe("CorrelateGraph toolbar", () => {
  test("is a wrapping row so the controls stack on narrow screens", () => {
    render(<CorrelateGraph />);

    expect(screen.getByTestId("correlate-toolbar")).toHaveClass(
      "flex",
      "flex-wrap",
      "items-center",
      "gap-3",
    );
  });
});

describe("CorrelateGraph filter normalization", () => {
  test("a one-condition OR link loads as AND and rewrites the URL", async () => {
    mockQueryParams["q"] = serializeCorrelationFilter({
      conditions: [
        { field: "observable", operator: "equals", value: SEARCHED_HOST },
      ],
      connector: "or",
    } as CorrelationFilter);
    getListMock.mockResolvedValue(listResult(standardEvents()));

    render(<CorrelateGraph />);
    await waitForGraph();

    expect(lastSyncedFilter()).toEqual({
      v: 1,
      j: "and",
      c: [["observable", "equals", SEARCHED_HOST]],
    });
    // It is the plain quick search again, so the builder stays closed.
    expect(
      screen.getByTestId("security-events-correlate-observable"),
    ).toHaveValue(SEARCHED_HOST);
    expect(screen.queryByTestId("correlate-filter-builder")).toBeNull();
    expect(getFlowNode("center").data.eyebrow).toBe("Your filter");

    // The AND-only pivots are available.
    clickFlowNode("observable:alice");
    expect(screen.getByTestId("correlate-action-exclude")).toBeInTheDocument();
    clickFlowNode("class:Authentication");
    expect(
      screen.getByTestId("correlate-drilldown-filter-class"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("correlate-drilldown-or-note")).toBeNull();
  });

  test("removing chips from an OR filter down to one condition makes it an AND filter", async () => {
    mockQueryParams["q"] = serializeCorrelationFilter(twoObservableOrFilter());
    getListMock.mockResolvedValue(listResult(standardEvents()));

    render(<CorrelateGraph />);
    await waitForGraph();
    expect(screen.getByTestId("correlate-filter-chips")).toHaveTextContent(
      "OR",
    );
    clickFlowNode("observable:alice");
    expect(screen.queryByTestId("correlate-action-exclude")).toBeNull();

    fireEvent.click(screen.getByTestId("correlate-filter-chip-remove-0"));

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    expect(lastSyncedFilter()).toEqual({
      v: 1,
      j: "and",
      c: [["observable", "equals", "192.168.1.20"]],
    });
    expect(screen.getByTestId("correlate-filter-chips")).not.toHaveTextContent(
      "OR",
    );
    await waitForGraph();

    // Exclude is back and builds an AND chain.
    clickFlowNode("observable:alice");
    fireEvent.click(screen.getByTestId("correlate-action-exclude"));
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(3);
    });
    const operators: Array<unknown> = queryOfCall(2)[
      "observables"
    ] as Array<unknown>;
    expect(operators[0]).toBeInstanceOf(Includes);
    expect((operators[0] as Includes).values).toEqual(["192.168.1.20"]);
    expect(operators[1]).toBeInstanceOf(IncludesNone);
    expect((operators[1] as IncludesNone).values).toEqual(["alice"]);
    expect(lastSyncedFilter()).toEqual({
      v: 1,
      j: "and",
      c: [
        ["observable", "equals", "192.168.1.20"],
        ["observable", "not-equals", "alice"],
      ],
    });
    expect(screen.getByTestId("correlate-filter-chips")).toHaveTextContent(
      "AND",
    );
    await waitForGraph();
  });

  test("Remove last condition on an OR filter leaves an AND filter", async () => {
    mockQueryParams["q"] = serializeCorrelationFilter(twoConditionFilter("or"));

    render(<CorrelateGraph />);
    await waitForNoResults();
    // Two fields under OR fan out into two queries.
    expect(getListMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByTestId("correlate-no-results-remove-last"));

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(3);
    });
    expect(lastSyncedFilter()).toEqual({
      v: 1,
      j: "and",
      c: [["principalIp", "equals", "192.168.1.20"]],
    });
    await waitForGraph();
    await waitForNoResults();
  });

  test("applying a one-row builder draft left on OR sends an AND filter", async () => {
    render(<CorrelateGraph />);
    fireEvent.click(
      screen.getByTestId("security-events-correlate-toggle-builder"),
    );
    fireEvent.change(screen.getByTestId("correlate-condition-value-0"), {
      target: { value: SEARCHED_HOST },
    });
    fireEvent.click(screen.getByTestId("correlate-add-condition"));
    fireEvent.click(screen.getByTestId("correlate-connector-or"));
    fireEvent.click(screen.getByTestId("correlate-condition-delete-1"));
    expect(screen.queryByTestId("correlate-condition-row-1")).toBeNull();

    fireEvent.click(
      within(screen.getByTestId("correlate-filter-builder")).getByTestId(
        "security-events-correlate-button",
      ),
    );

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });
    expect(lastSyncedFilter()).toEqual({
      v: 1,
      j: "and",
      c: [["observable", "equals", SEARCHED_HOST]],
    });
    await waitForGraph();
  });
});

describe("CorrelateGraph centre card", () => {
  test.each<[string, string, string, string]>([
    ["observable", "not-equals", "bob", "Observable is not"],
    ["message", "contains", "failed", "Message contains"],
    ["className", "equals", "Authentication", "Event Class is"],
    ["principalHost", "equals", SEARCHED_HOST, "Principal Host is"],
    ["severityName", "not-equals", "Informational", "Severity is not"],
  ])(
    "a single %s %s condition names its field and operator above the value",
    async (field: string, operator: string, value: string, eyebrow: string) => {
      const filter: CorrelationFilter = {
        conditions: [{ field: field, operator: operator, value: value }],
        connector: "and",
      } as CorrelationFilter;
      mockQueryParams["q"] = serializeCorrelationFilter(filter);
      getListMock.mockResolvedValue(listResult(standardEvents()));

      render(<CorrelateGraph />);
      await waitForGraph();

      const center: CorrelateFlowNode = getFlowNode("center");
      expect(center.data.eyebrow).toBe(eyebrow);
      expect(center.data.eyebrow).not.toBe("Your filter");
      expect(center.data.title).toBe(value);
      expect(center.data.tooltip).toBe(describeCorrelationFilter(filter));
      expect(center.data.label).toBe(
        describeCorrelationCondition(filter.conditions[0]!),
      );
    },
  );

  test("only the plain observable search reads Your filter", async () => {
    await renderGraph();

    const center: CorrelateFlowNode = getFlowNode("center");
    expect(center.data.eyebrow).toBe("Your filter");
    expect(center.data.title).toBe(SEARCHED_HOST);
  });

  test("the field and operator in the eyebrow are translated", async () => {
    mockTranslations["Observable"] = "Observable-T";
    mockTranslations["is not"] = "is-not-T";
    mockQueryParams["q"] = serializeCorrelationFilter({
      conditions: [
        { field: "observable", operator: "not-equals", value: "bob" },
      ],
      connector: "and",
    } as CorrelationFilter);
    getListMock.mockResolvedValue(listResult(standardEvents()));

    render(<CorrelateGraph />);
    await waitForGraph();

    expect(getFlowNode("center").data.eyebrow).toBe("Observable-T is-not-T");
  });
});

describe("CorrelateGraph edge names", () => {
  test("name both ends and the number of shared events", async () => {
    await renderGraph();

    const centerLabel: string = describeCorrelationFilter({
      conditions: [
        { field: "observable", operator: "equals", value: SEARCHED_HOST },
      ],
      connector: "and",
    } as CorrelationFilter);
    expect(getFlowEdge("center->class:Authentication").ariaLabel).toBe(
      `${centerLabel} – Authentication: 2 events`,
    );
    expect(getFlowEdge("center->class:Process Activity").ariaLabel).toBe(
      `${centerLabel} – Process Activity: 1 event`,
    );
    expect(
      getFlowEdge("class:Authentication->observable:alice").ariaLabel,
    ).toBe("Authentication – alice: 2 events");
    expect(
      getFlowEdge("class:Process Activity->observable:bash").ariaLabel,
    ).toBe("Process Activity – bash: 1 event");

    for (const edge of getFlowEdges()) {
      expect(edge.ariaLabel).toMatch(/^.+ – .+: \d+ events?$/);
      expect(edge.ariaLabel).not.toContain("Edge from");
      expect(edge.focusable).toBe(false);
    }
  });

  test("describe a multi-condition centre by the whole filter", async () => {
    const filter: CorrelationFilter = twoConditionFilter("or");
    mockQueryParams["q"] = serializeCorrelationFilter(filter);
    getListMock.mockResolvedValue(listResult(standardEvents()));

    render(<CorrelateGraph />);
    await waitForGraph();

    expect(getFlowEdge("center->class:Network Activity").ariaLabel).toBe(
      `${describeCorrelationFilter(filter)} – Network Activity: 1 event`,
    );
  });

  test("translate the event word", async () => {
    mockI18n.language = "xx";
    mockTranslations["event"] = "evt";
    mockTranslations["events"] = "evts";

    await renderGraph();

    expect(
      getFlowEdge("class:Authentication->observable:alice").ariaLabel,
    ).toBe("Authentication – alice: 2 evts");
    expect(
      getFlowEdge("class:Process Activity->observable:bash").ariaLabel,
    ).toBe("Process Activity – bash: 1 evt");
  });
});

describe("CorrelateGraph node memo", () => {
  test("keeps the same nodes across unrelated renders and rebuilds on a language switch", async () => {
    await renderGraph();
    const nodesBefore: Array<FlowNode> | undefined = getFlowProps().nodes;
    const edgesBefore: Array<FlowEdge> | undefined = getFlowProps().edges;
    expect(getFlowNode("center").data.eyebrow).toBe("Your filter");

    // Typing re-renders the page but changes nothing the graph shows.
    fireEvent.change(
      screen.getByTestId("security-events-correlate-observable"),
      { target: { value: "typed" } },
    );
    expect(getFlowProps().nodes).toBe(nodesBefore);
    expect(getFlowProps().edges).toBe(edgesBefore);

    // New strings alone don't rebuild; the language is the memo's key.
    mockTranslations["Your filter"] = "Filter-T";
    fireEvent.change(
      screen.getByTestId("security-events-correlate-observable"),
      { target: { value: "typed again" } },
    );
    expect(getFlowProps().nodes).toBe(nodesBefore);

    mockI18n.language = "de";
    fireEvent.change(
      screen.getByTestId("security-events-correlate-observable"),
      { target: { value: "typed once more" } },
    );
    expect(getFlowProps().nodes).not.toBe(nodesBefore);
    expect(getFlowNode("center").data.eyebrow).toBe("Filter-T");
  });
});

describe("CorrelateGraph stale selection", () => {
  test("a refresh that drops the selected node clears the selection for good", async () => {
    await renderGraph();
    clickFlowNode("observable:alice");
    expect(getSelectedNodeIds()).toEqual(["observable:alice"]);

    // alice is gone from the next result…
    getListMock.mockResolvedValueOnce(
      listResult([
        buildEvent({
          id: "d5555555-5555-4555-8555-555555555555",
          className: "Authentication",
          observables: [SEARCHED_HOST, "bash"],
        }),
      ]),
    );
    fireEvent.click(screen.getByTestId("correlate-refresh"));
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    await waitForGraph();

    expect(screen.queryByTestId("flow-node-observable:alice")).toBeNull();
    expect(screen.queryByTestId("correlate-inspector")).toBeNull();
    expect(getSelectedNodeIds()).toEqual([]);

    // …and coming back later must not reopen the panel on its own.
    getListMock.mockResolvedValueOnce(listResult(standardEvents()));
    fireEvent.click(screen.getByTestId("correlate-refresh"));
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(3);
    });
    await waitForGraph();

    expect(
      screen.getByTestId("flow-node-observable:alice"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("correlate-inspector")).toBeNull();
    expect(getSelectedNodeIds()).toEqual([]);
    expect(getDimmedNodeIds()).toEqual([]);
  });

  test("a refresh that keeps the selected node keeps the selection", async () => {
    await renderGraph();
    clickFlowNode("class:Authentication");

    fireEvent.click(screen.getByTestId("correlate-refresh"));
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    await waitForGraph();

    expect(getSelectedNodeIds()).toEqual(["class:Authentication"]);
    expect(screen.getByTestId("correlate-drilldown")).toBeInTheDocument();
  });
});

describe("CorrelateGraph fitting", () => {
  beforeEach(() => {
    installFrameQueue();
  });

  afterEach(() => {
    cleanup();
    restoreFrameQueue();
  });

  test("hands onInit to React Flow and fits a new graph only after two frames", async () => {
    await renderGraph();
    expect(getFlowProps().onInit).toEqual(expect.any(Function));

    // React Flow has not measured the new pane yet.
    expect(fitViewMock).not.toHaveBeenCalled();
    flushFrame();
    expect(fitViewMock).not.toHaveBeenCalled();
    flushFrame();
    expect(fitViewMock).toHaveBeenCalledTimes(1);
    expect(fitViewMock).toHaveBeenCalledWith(FIT_VIEW_OPTIONS);

    // A successful fit stops there.
    flushFrames(3);
    expect(fitViewMock).toHaveBeenCalledTimes(1);
    expect(pendingFrames.size).toBe(0);
  });

  test("retries on later frames until React Flow can fit", async () => {
    fitViewMock.mockReturnValueOnce(false).mockReturnValueOnce(false);
    await renderGraph();

    flushFrames(2);
    expect(fitViewMock).toHaveBeenCalledTimes(1);
    flushFrame();
    expect(fitViewMock).toHaveBeenCalledTimes(2);
    flushFrame();
    expect(fitViewMock).toHaveBeenCalledTimes(3);
    flushFrames(3);
    expect(fitViewMock).toHaveBeenCalledTimes(3);
  });

  test("gives up after a bounded number of retries", async () => {
    fitViewMock.mockReturnValue(false);
    await renderGraph();

    flushFrames(40);
    // Two waiting frames, the first attempt, then twenty retries.
    expect(fitViewMock).toHaveBeenCalledTimes(21);
    expect(pendingFrames.size).toBe(0);
  });

  test("an empty result never asks React Flow to fit", async () => {
    render(<CorrelateGraph />);
    runQuickSearch(SEARCHED_HOST);
    await waitForNoResults();

    flushFrames(30);
    expect(fitViewMock).not.toHaveBeenCalled();
  });

  test("a selection does not refit the graph", async () => {
    await renderGraph();
    flushFrames(2);
    expect(fitViewMock).toHaveBeenCalledTimes(1);
    fitViewMock.mockClear();

    clickFlowNode("class:Authentication");
    fireEvent.click(screen.getByTestId("correlate-overview-observable-1"));
    flushFrames(4);

    expect(fitViewMock).not.toHaveBeenCalled();
  });

  test("a refresh with the same nodes still refits because the window moved", async () => {
    const currentDate: SpyInstance<() => Date> = jest.spyOn(
      OneUptimeDate,
      "getCurrentDate",
    );
    try {
      currentDate.mockReturnValue(new Date("2026-08-25T12:00:00.000Z"));
      await renderGraph();
      flushFrames(2);
      expect(fitViewMock).toHaveBeenCalledTimes(1);
      fitViewMock.mockClear();

      currentDate.mockReturnValue(new Date("2026-08-25T12:05:00.000Z"));
      fireEvent.click(screen.getByTestId("correlate-refresh"));
      await waitFor(() => {
        expect(getListMock).toHaveBeenCalledTimes(2);
      });
      await waitForGraph();

      expect(fitViewMock).not.toHaveBeenCalled();
      flushFrame();
      expect(fitViewMock).not.toHaveBeenCalled();
      flushFrame();
      expect(fitViewMock).toHaveBeenCalledTimes(1);
    } finally {
      currentDate.mockRestore();
    }
  });

  test("a different graph refits after two more frames", async () => {
    await renderGraph();
    flushFrames(2);
    fitViewMock.mockClear();

    clickFlowNode("observable:alice");
    fireEvent.click(screen.getByTestId("correlate-action-focus"));
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    await waitForGraph();

    expect(fitViewMock).not.toHaveBeenCalled();
    flushFrame();
    expect(fitViewMock).not.toHaveBeenCalled();
    flushFrame();
    expect(fitViewMock).toHaveBeenCalledTimes(1);
    expect(fitViewMock).toHaveBeenCalledWith(FIT_VIEW_OPTIONS);
  });

  test("Fit to screen fits straight away with an animation", async () => {
    await renderGraph();

    fireEvent.click(screen.getByTestId("correlate-fit-view"));

    expect(fitViewMock).toHaveBeenCalledTimes(1);
    expect(fitViewMock).toHaveBeenCalledWith({
      ...FIT_VIEW_OPTIONS,
      duration: 300,
    });
  });
});

describe("CorrelateGraph responsive layout", () => {
  afterEach(() => {
    cleanup();
    restoreFrameQueue();
    restoreStyleHeights();
    removeMatchMedia();
    removeResizeObserver();
  });

  test("without matchMedia the page assumes a wide screen", async () => {
    await renderGraph();
    const defaultPositions: Map<string, Point> = getClassPositions();
    cleanup();

    installMatchMedia({ wide: true, floating: true });
    await renderGraph();

    expect(getClassPositions()).toEqual(defaultPositions);
  });

  test("a narrow screen draws the class ring round instead of wide", async () => {
    installMatchMedia({ wide: true, floating: true });
    await renderGraph();
    const widePositions: Map<string, Point> = getClassPositions();
    cleanup();

    installMatchMedia({ wide: false, floating: false });
    await renderGraph();
    const narrowPositions: Map<string, Point> = getClassPositions();

    expect(Array.from(narrowPositions.keys()).sort()).toEqual(
      Array.from(widePositions.keys()).sort(),
    );
    let compressedCount: number = 0;
    for (const [nodeId, widePoint] of Array.from(widePositions.entries())) {
      const narrowPoint: Point = narrowPositions.get(nodeId)!;
      // Same ring height, 1 / 1.6 of the horizontal spread.
      expect(narrowPoint.y).toBeCloseTo(widePoint.y, 0);
      expect(Math.abs(narrowPoint.x - widePoint.x / 1.6)).toBeLessThanOrEqual(
        1,
      );
      if (Math.abs(narrowPoint.x) < Math.abs(widePoint.x) - 1) {
        compressedCount += 1;
      }
    }
    // Two of the three classes sit off the vertical axis.
    expect(compressedCount).toBe(2);
  });

  test("switching between narrow and wide re-lays out and refits the graph", async () => {
    installFrameQueue();
    installMatchMedia({ wide: true, floating: true });
    await renderGraph();
    flushFrames(2);
    expect(fitViewMock).toHaveBeenCalledTimes(1);
    const widePositions: Map<string, Point> = getClassPositions();
    fitViewMock.mockClear();

    changeMedia({ wide: false, floating: false });

    const narrowPositions: Map<string, Point> = getClassPositions();
    expect(narrowPositions).not.toEqual(widePositions);
    expect(fitViewMock).not.toHaveBeenCalled();
    flushFrame();
    expect(fitViewMock).not.toHaveBeenCalled();
    flushFrame();
    expect(fitViewMock).toHaveBeenCalledTimes(1);
    fitViewMock.mockClear();

    // Crossing only the floating-panel breakpoint changes nothing drawn.
    changeMedia({ wide: false, floating: true });
    expect(getClassPositions()).toEqual(narrowPositions);
    flushFrames(3);
    expect(fitViewMock).not.toHaveBeenCalled();

    changeMedia({ wide: true, floating: true });
    expect(getClassPositions()).toEqual(widePositions);
    flushFrames(2);
    expect(fitViewMock).toHaveBeenCalledTimes(1);
  });

  test("on a narrow screen the canvas height follows the drawing at the canvas width", async () => {
    installFrameQueue();
    recordStyleHeights();
    installResizeObserver();
    installMatchMedia({ wide: false, floating: false });
    await renderGraph();
    flushFrames(2);
    fitViewMock.mockClear();

    // Unmeasured, the canvas keeps the desktop sizing.
    const unmeasuredHeight: number = expectedCanvasHeight();
    expect(unmeasuredHeight).toBeGreaterThanOrEqual(420);
    expect(getCanvasHeightStyle()).toBe(`min(${unmeasuredHeight}px, 72vh)`);

    resizeCanvas(360);

    const narrowHeight: number = expectedCanvasHeight(360);
    expect(narrowHeight).toBeGreaterThanOrEqual(280);
    expect(narrowHeight).toBeLessThanOrEqual(520);
    expect(narrowHeight).not.toBe(unmeasuredHeight);
    expect(getCanvasHeightStyle()).toBe(`min(${narrowHeight}px, 72vh)`);

    // A new canvas height is a new pane for React Flow: refit.
    expect(fitViewMock).not.toHaveBeenCalled();
    flushFrames(2);
    expect(fitViewMock).toHaveBeenCalledTimes(1);

    resizeCanvas(300);
    expect(getCanvasHeightStyle()).toBe(
      `min(${expectedCanvasHeight(300)}px, 72vh)`,
    );
  });

  test("on a wide screen the canvas width does not change its height", async () => {
    installFrameQueue();
    recordStyleHeights();
    installResizeObserver();
    installMatchMedia({ wide: true, floating: true });
    await renderGraph();
    flushFrames(2);
    fitViewMock.mockClear();

    const wideHeight: number = expectedCanvasHeight();
    expect(getCanvasHeightStyle()).toBe(`min(${wideHeight}px, 72vh)`);

    resizeCanvas(360);

    expect(getCanvasHeightStyle()).toBe(`min(${wideHeight}px, 72vh)`);
    flushFrames(3);
    expect(fitViewMock).not.toHaveBeenCalled();
  });

  test("the canvas ResizeObserver is disconnected when the graph goes away", async () => {
    installResizeObserver();
    installMatchMedia({ wide: false, floating: false });
    await renderGraph();

    const canvas: HTMLElement = screen.getByTestId("correlate-canvas");
    const observers: Array<RecordingResizeObserver> =
      getCanvasObservers(canvas);
    expect(observers).toHaveLength(1);
    expect(observers[0]!.isDisconnected).toBe(false);

    fireEvent.click(screen.getByTestId("correlate-filter-clear-all"));

    expect(screen.queryByTestId("correlate-canvas")).toBeNull();
    expect(observers[0]!.isDisconnected).toBe(true);
  });

  test("matchMedia change listeners are removed on unmount", async () => {
    installMatchMedia({ wide: true, floating: true });
    render(<CorrelateGraph />);
    expect(mediaListeners.size).toBe(2);

    cleanup();

    expect(mediaListeners.size).toBe(0);
  });
});

describe("CorrelateGraph revealing a selection", () => {
  afterEach(() => {
    cleanup();
    restoreFrameQueue();
    removeMatchMedia();
  });

  async function renderMeasuredCanvas(state: MediaState): Promise<HTMLElement> {
    installFrameQueue();
    installMatchMedia(state);
    await renderGraph();
    const canvas: HTMLElement = screen.getByTestId("correlate-canvas");
    setElementSize(canvas, CANVAS_WIDTH, CANVAS_HEIGHT);
    return canvas;
  }

  const visibleRight: number = CANVAS_WIDTH - PANEL_WIDTH - REVEAL_MARGIN;

  test.each<[string, number, number, boolean]>([
    ["in the free area", 300, 250, false],
    ["under the panel", 800, 250, true],
    ["partly under the panel", visibleRight - 98 + 1, 250, true],
    ["just clear of the panel", visibleRight - 98, 250, false],
    ["past the left edge", REVEAL_MARGIN + 98 - 1, 250, true],
    ["above the top edge", 300, REVEAL_MARGIN + 28 - 1, true],
    [
      "below the bottom edge",
      300,
      CANVAS_HEIGHT - REVEAL_MARGIN - 28 + 1,
      true,
    ],
  ])(
    "a floating panel pans a class node %s only when it is hidden",
    async (
      _where: string,
      screenX: number,
      screenY: number,
      shouldPan: boolean,
    ) => {
      await renderMeasuredCanvas({ wide: true, floating: true });
      const nodeId: string = "class:Process Activity";
      placeNodeOnScreen(nodeId, screenX, screenY, 1);

      clickFlowNode(nodeId);

      expect(getSelectedNodeIds()).toEqual([nodeId]);
      if (!shouldPan) {
        expect(setCenterMock).not.toHaveBeenCalled();
        return;
      }
      const point: Point = getNodePoint(nodeId);
      expect(setCenterMock).toHaveBeenCalledTimes(1);
      expect(setCenterMock).toHaveBeenCalledWith(
        point.x + FREE_AREA_SHIFT,
        point.y,
        { zoom: 1, duration: 300 },
      );
    },
  );

  test("the free-area shift and the zoom follow the current viewport", async () => {
    await renderMeasuredCanvas({ wide: true, floating: true });
    const nodeId: string = "class:Authentication";
    // At half zoom the card is 98px wide, so 600 + 49 is past the panel.
    placeNodeOnScreen(nodeId, 600, 250, 0.5);

    fireEvent.click(screen.getByTestId("correlate-overview-class-1"));

    expect(getSelectedNodeIds()).toEqual([nodeId]);
    const point: Point = getNodePoint(nodeId);
    expect(setCenterMock).toHaveBeenCalledWith(
      point.x + FREE_AREA_SHIFT / 0.5,
      point.y,
      { zoom: 0.5, duration: 300 },
    );
  });

  test("observable nodes are measured with the observable card size", async () => {
    await renderMeasuredCanvas({ wide: true, floating: true });
    const nodeId: string = "observable:alice";

    // An observable card is 164px wide: 82px either side of its centre.
    placeNodeOnScreen(nodeId, visibleRight - 82, 250, 1);
    clickFlowNode(nodeId);
    expect(setCenterMock).not.toHaveBeenCalled();

    act(() => {
      getFlowProps().onPaneClick?.({} as React.MouseEvent);
    });
    placeNodeOnScreen(nodeId, visibleRight - 81, 250, 1);
    clickFlowNode(nodeId);
    expect(setCenterMock).toHaveBeenCalledTimes(1);
  });

  test("an unmeasured canvas is never panned", async () => {
    installFrameQueue();
    await renderGraph();
    placeNodeOnScreen("class:Process Activity", 5000, 5000, 1);

    clickFlowNode("class:Process Activity");

    expect(setCenterMock).not.toHaveBeenCalled();
  });

  test("a stacked panel never pans the graph", async () => {
    await renderMeasuredCanvas({ wide: true, floating: false });
    placeNodeOnScreen("class:Process Activity", 800, 250, 1);

    clickFlowNode("class:Process Activity");
    fireEvent.click(screen.getByTestId("correlate-overview-class-1"));
    flushFrames(2);

    expect(setCenterMock).not.toHaveBeenCalled();
  });

  test.each<[string, number, number, boolean]>([
    ["below the viewport", 900, 1300, true],
    ["above the viewport", -400, 100, true],
    ["inside the viewport", 100, 700, false],
  ])(
    "a stacked panel %s is scrolled into view on the next frame",
    async (
      _where: string,
      top: number,
      bottom: number,
      shouldScroll: boolean,
    ) => {
      const canvas: HTMLElement = await renderMeasuredCanvas({
        wide: false,
        floating: false,
      });
      const canvasScroll: MockFunction = stubScrollIntoView(canvas);
      setElementRect(canvas, -2000, -1500);

      fireEvent.click(screen.getByTestId("correlate-overview-class-0"));
      const panel: HTMLElement = screen.getByTestId("correlate-inspector");
      const panelScroll: MockFunction = stubScrollIntoView(panel);
      setElementRect(panel, top, bottom);
      expect(panelScroll).not.toHaveBeenCalled();

      flushFrame();

      if (shouldScroll) {
        expect(panelScroll).toHaveBeenCalledTimes(1);
        expect(panelScroll).toHaveBeenCalledWith({
          block: "nearest",
          behavior: "smooth",
        });
      } else {
        expect(panelScroll).not.toHaveBeenCalled();
      }
      // The canvas is not what a stacked panel scrolls to.
      expect(canvasScroll).not.toHaveBeenCalled();
    },
  );

  test.each<[string, number, number, boolean]>([
    ["above the viewport", -600, -100, true],
    ["below the viewport", 700, 1200, true],
    ["inside the viewport", 20, 520, false],
  ])(
    "a floating panel scrolls the canvas into view when it is %s",
    async (
      _where: string,
      top: number,
      bottom: number,
      shouldScroll: boolean,
    ) => {
      const canvas: HTMLElement = await renderMeasuredCanvas({
        wide: true,
        floating: true,
      });
      const canvasScroll: MockFunction = stubScrollIntoView(canvas);
      setElementRect(canvas, top, bottom);

      fireEvent.click(screen.getByTestId("correlate-overview-observable-0"));
      const panel: HTMLElement = screen.getByTestId("correlate-inspector");
      const panelScroll: MockFunction = stubScrollIntoView(panel);
      setElementRect(panel, -5000, -4000);
      expect(canvasScroll).not.toHaveBeenCalled();

      flushFrame();

      if (shouldScroll) {
        expect(canvasScroll).toHaveBeenCalledTimes(1);
        expect(canvasScroll).toHaveBeenCalledWith({
          block: "nearest",
          behavior: "smooth",
        });
      } else {
        expect(canvasScroll).not.toHaveBeenCalled();
      }
      expect(panelScroll).not.toHaveBeenCalled();
    },
  );
});

describe("CorrelateGraph selection focus", () => {
  beforeEach(() => {
    installFrameQueue();
  });

  afterEach(() => {
    cleanup();
    restoreFrameQueue();
  });

  test("an overview row moves focus into the panel on the next frame and Close returns it", async () => {
    await renderGraph();
    const row: HTMLElement = screen.getByTestId("correlate-overview-class-0");

    focusAndClick(row);

    const panel: HTMLElement = screen.getByTestId("correlate-inspector");
    const focusSpy: SpyInstance<(options?: FocusOptions) => void> = jest.spyOn(
      panel,
      "focus",
    );
    // The panel only exists from this render on, so focus waits a frame.
    expect(document.activeElement).toBe(row);

    flushFrame();

    expect(document.activeElement).toBe(panel);
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });

    fireEvent.click(screen.getByTestId("correlate-drilldown-close"));

    expect(screen.queryByTestId("correlate-inspector")).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  test("the observable panel's dismiss button returns focus to its row", async () => {
    await renderGraph();
    const row: HTMLElement = screen.getByTestId(
      "correlate-overview-observable-1",
    );

    focusAndClick(row);
    flushFrame();
    expect(document.activeElement).toBe(
      screen.getByTestId("correlate-inspector"),
    );

    fireEvent.click(screen.getByTestId("correlate-action-dismiss"));

    expect(screen.queryByTestId("correlate-inspector")).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  test("the worst-class shortcut moves focus into the panel and gets it back", async () => {
    await renderGraph();
    const shortcut: HTMLElement = screen.getByTestId(
      "correlate-stat-worst-class",
    );

    focusAndClick(shortcut);
    flushFrame();

    expect(getSelectedNodeIds()).toEqual(["class:Process Activity"]);
    expect(document.activeElement).toBe(
      screen.getByTestId("correlate-inspector"),
    );

    fireEvent.click(screen.getByTestId("correlate-drilldown-close"));
    expect(document.activeElement).toBe(shortcut);
  });

  test("a graph click leaves focus alone and forgets an older return target", async () => {
    await renderGraph();
    const row: HTMLElement = screen.getByTestId("correlate-overview-class-0");
    focusAndClick(row);
    flushFrame();
    const panel: HTMLElement = screen.getByTestId("correlate-inspector");
    expect(document.activeElement).toBe(panel);

    const focusSpy: SpyInstance<(options?: FocusOptions) => void> = jest.spyOn(
      panel,
      "focus",
    );
    const nodeButton: HTMLElement = screen.getByTestId(
      "flow-node-observable:alice",
    );
    focusAndClick(nodeButton);
    flushFrames(2);

    expect(getSelectedNodeIds()).toEqual(["observable:alice"]);
    expect(screen.getByTestId("correlate-inspector")).toBe(panel);
    expect(focusSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(nodeButton);

    // Closing now has nowhere to send focus back to.
    fireEvent.click(screen.getByTestId("correlate-action-dismiss"));
    expect(screen.queryByTestId("correlate-inspector")).toBeNull();
    expect(document.activeElement).toBe(nodeButton);
    expect(document.activeElement).not.toBe(row);
  });

  test("a Seen-in chip keeps the row that opened the panel as the return target", async () => {
    await renderGraph();
    // 10.0.0.5 was seen in Authentication and Network Activity.
    const row: HTMLElement = screen.getByTestId(
      "correlate-overview-observable-0",
    );
    expect(row).toHaveTextContent("10.0.0.5");
    focusAndClick(row);
    flushFrame();
    const panel: HTMLElement = screen.getByTestId("correlate-inspector");
    expect(document.activeElement).toBe(panel);

    focusAndClick(screen.getByTestId("correlate-observable-class-1"));
    expect(getSelectedNodeIds()).toEqual(["class:Network Activity"]);
    flushFrame();

    expect(document.activeElement).toBe(
      screen.getByTestId("correlate-inspector"),
    );

    fireEvent.click(screen.getByTestId("correlate-drilldown-close"));
    expect(screen.queryByTestId("correlate-inspector")).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  test("a later list selection replaces the return target", async () => {
    await renderGraph();
    const firstRow: HTMLElement = screen.getByTestId(
      "correlate-overview-class-0",
    );
    const secondRow: HTMLElement = screen.getByTestId(
      "correlate-overview-observable-2",
    );

    focusAndClick(firstRow);
    flushFrame();
    focusAndClick(secondRow);
    flushFrame();
    expect(getSelectedNodeIds()).toEqual(["observable:bash"]);

    fireEvent.click(screen.getByTestId("correlate-action-dismiss"));
    expect(document.activeElement).toBe(secondRow);
  });

  test("clicking the empty canvas clears the selection without moving focus", async () => {
    await renderGraph();
    const row: HTMLElement = screen.getByTestId("correlate-overview-class-0");
    focusAndClick(row);
    flushFrame();
    const panel: HTMLElement = screen.getByTestId("correlate-inspector");
    expect(document.activeElement).toBe(panel);
    setCenterMock.mockClear();

    act(() => {
      getFlowProps().onPaneClick?.({} as React.MouseEvent);
    });
    flushFrames(2);

    expect(screen.queryByTestId("correlate-inspector")).toBeNull();
    expect(getSelectedNodeIds()).toEqual([]);
    expect(setCenterMock).not.toHaveBeenCalled();
    expect(pendingFrames.size).toBe(0);
    // The panel was removed under focus; nothing pulled focus to the row.
    expect(document.activeElement).not.toBe(row);
  });

  test("a pivot from the panel does not throw focus at a stale row", async () => {
    await renderGraph();
    const row: HTMLElement = screen.getByTestId("correlate-overview-class-0");
    focusAndClick(row);
    flushFrame();

    fireEvent.click(screen.getByTestId("correlate-drilldown-filter-class"));

    expect(screen.queryByTestId("correlate-inspector")).toBeNull();
    expect(document.activeElement).not.toBe(row);
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    await waitForGraph();
  });
});

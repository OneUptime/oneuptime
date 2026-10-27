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
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock, SpyInstance } from "jest-mock";
import * as React from "react";
import TraceExplorer from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceExplorer";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import Log from "../../../Models/AnalyticsModels/Log";
import Span, {
  SpanKind,
  SpanStatus,
} from "../../../Models/AnalyticsModels/Span";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import Service from "../../../Models/DatabaseModels/Service";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import EntityType from "../../../Types/Telemetry/EntityType";
import Color from "../../../Types/Color";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Clipboard from "../../../UI/Utils/Clipboard";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { resetPreferencesForTesting } from "../../../UI/Components/AttributesJSON/AttributesJSONPreferences";

/*
 * The trace detail page end to end, against a mocked data boundary: what it
 * asks the API for, what it draws, and how search, filters, batch loading,
 * the span panel, the operations view and the related signals behave. The
 * heavyweight explorers it embeds (logs, exceptions table, flame graphs,
 * service map) are replaced by recorders.
 */

type Props = Record<string, unknown>;
type ListArgs = {
  modelType: unknown;
  query: JSONObject;
  select?: JSONObject;
  sort?: JSONObject;
  skip: number;
  limit: number;
};
type ListResultLike = {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
};
type PostArgs = { url: { toString: () => string }; data: JSONObject };

const getListMock: Mock<(args: ListArgs) => Promise<ListResultLike>> =
  jest.fn<(args: ListArgs) => Promise<ListResultLike>>();
const countMock: Mock<
  (modelType: unknown, query: JSONObject) => Promise<number>
> = jest.fn<(modelType: unknown, query: JSONObject) => Promise<number>>();
const serviceListMock: Mock<(args: ListArgs) => Promise<ListResultLike>> =
  jest.fn<(args: ListArgs) => Promise<ListResultLike>>();
const postMock: Mock<(args: PostArgs) => Promise<unknown>> =
  jest.fn<(args: PostArgs) => Promise<unknown>>();
const logsViewerProps: Mock<(props: Props) => void> =
  jest.fn<(props: Props) => void>();
const exceptionTableProps: Mock<(props: Props) => void> =
  jest.fn<(props: Props) => void>();
const flameGraphProps: Mock<(props: Props) => void> =
  jest.fn<(props: Props) => void>();
const scopedFlamegraphProps: Mock<(props: Props) => void> =
  jest.fn<(props: Props) => void>();

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (args: ListArgs) => {
        return getListMock(args);
      },
      count: (modelType: unknown, query: JSONObject) => {
        return countMock(modelType, query);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (args: ListArgs) => {
        return serviceListMock(args);
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (args: PostArgs) => {
        return postMock(args);
      },
      getFriendlyMessage: (error: unknown): string => {
        if (error instanceof HTTPErrorResponse) {
          return String((error.data as JSONObject)?.["message"]);
        }
        return (error as Error)?.message || "Failed";
      },
    },
  };
});

/*
 * The selected project, as the dashboard keeps it: null (not loaded, read
 * as AI on) unless a test sets it.
 */
let mockCurrentProject: { enableAi?: boolean } | null = null;

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID("10000000-0000-4000-8000-000000000001");
      },
      getCurrentProject: () => {
        return mockCurrentProject;
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    return {
      __esModule: true,
      default: (props: Props) => {
        logsViewerProps(props);
        return <div data-testid="logs-viewer" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionInstanceTable",
  () => {
    return {
      __esModule: true,
      default: (props: Props) => {
        exceptionTableProps(props);
        return <div data-testid="exception-table" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/FlameGraph",
  () => {
    return {
      __esModule: true,
      default: (props: Props) => {
        flameGraphProps(props);
        return <div data-testid="flame-graph" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceServiceMap",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="service-map" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceScopedFlamegraph",
  () => {
    return {
      __esModule: true,
      default: (props: Props) => {
        scopedFlamegraphProps(props);
        return <div data-testid="scoped-flamegraph" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/RumSessionLookup",
  () => {
    return {
      __esModule: true,
      resolveReplayMomentRouteForSession: async () => {
        return undefined;
      },
    };
  },
);

const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const GATEWAY: string = "60000000-0000-4000-8000-000000000001";
const INVENTORY: string = "60000000-0000-4000-8000-000000000002";
const CHECKOUT: string = "60000000-0000-4000-8000-000000000003";
const MS: number = 1_000_000;
const EPOCH_MS: number = Date.UTC(2026, 8, 14, 12, 0, 0);

interface SpanDefinition {
  spanId: string;
  parentSpanId: string;
  name: string;
  serviceId: string;
  startMs: number;
  durationMs: number;
  isError?: boolean;
  kind?: SpanKind;
  // The pod the span ran in (k8sPodEntityKey); none outside Kubernetes.
  podEntityKey?: string;
}

function makeSpan(definition: SpanDefinition): Span {
  const start: number = (EPOCH_MS + definition.startMs) * MS;
  return Object.assign(new Span(), {
    traceId: TRACE_ID,
    spanId: definition.spanId,
    parentSpanId: definition.parentSpanId,
    name: definition.name,
    kind: definition.kind || SpanKind.Internal,
    statusCode: definition.isError ? SpanStatus.Error : SpanStatus.Ok,
    primaryEntityId: new ObjectID(definition.serviceId),
    startTime: new Date(EPOCH_MS + definition.startMs),
    endTime: new Date(EPOCH_MS + definition.startMs + definition.durationMs),
    startTimeUnixNano: start,
    endTimeUnixNano: start + definition.durationMs * MS,
    durationUnixNano: definition.durationMs * MS,
    k8sPodEntityKey: definition.podEntityKey || "",
  });
}

/*
 *   POST /api/v1/checkout (gateway, 0-1000ms)
 *   ├── auth.verifyToken (gateway)
 *   ├── POST /reserve (inventory, error)
 *   │   └── UPDATE stock (inventory)
 *   └── OrderService.validateCart (checkout)
 *       └── SELECT products WHERE id = $1  × 12   (an N+1)
 */
function checkoutDefinitions(): Array<SpanDefinition> {
  const definitions: Array<SpanDefinition> = [
    {
      spanId: "root",
      parentSpanId: "",
      name: "POST /api/v1/checkout",
      serviceId: GATEWAY,
      startMs: 0,
      durationMs: 1000,
      kind: SpanKind.Server,
    },
    {
      spanId: "auth",
      parentSpanId: "root",
      name: "auth.verifyToken",
      serviceId: GATEWAY,
      startMs: 5,
      durationMs: 20,
    },
    {
      spanId: "reserve",
      parentSpanId: "root",
      name: "POST /reserve",
      serviceId: INVENTORY,
      startMs: 100,
      durationMs: 300,
      isError: true,
    },
    {
      spanId: "update",
      parentSpanId: "reserve",
      name: "UPDATE stock",
      serviceId: INVENTORY,
      startMs: 150,
      durationMs: 200,
    },
    {
      spanId: "validate",
      parentSpanId: "root",
      name: "OrderService.validateCart",
      serviceId: CHECKOUT,
      startMs: 440,
      durationMs: 60,
    },
  ];
  for (let index: number = 0; index < 12; index++) {
    definitions.push({
      spanId: `query-${index}`,
      parentSpanId: "validate",
      name: "SELECT products WHERE id = $1",
      serviceId: CHECKOUT,
      startMs: 442 + index * 4,
      durationMs: 3 + (index === 7 ? 1 : 0),
    });
  }
  return definitions;
}

function services(): Array<Service> {
  return [
    Object.assign(new Service(), {
      _id: GATEWAY,
      name: "api-gateway",
      serviceColor: new Color("#6366f1"),
    }),
    Object.assign(new Service(), {
      _id: INVENTORY,
      name: "inventory-service",
      serviceColor: new Color("#f59e0b"),
    }),
    Object.assign(new Service(), {
      _id: CHECKOUT,
      name: "checkout-service",
      serviceColor: new Color("#10b981"),
    }),
  ];
}

interface Backend {
  traceSpans: Array<Span>;
  totalCount?: number;
  failTraceRead?: string;
  details?: Record<string, Partial<Span>>;
  logs?: Array<Log>;
  // Every line the pods wrote, read by pod and time window.
  podLogs?: Array<Log>;
  // How many logs carry the trace's ID; a string fails the count with it.
  linkedLogCount?: number | string;
  inventoryItems?: Array<InventoryItem>;
  exceptions?: Array<ExceptionInstance>;
  holdTraceRead?: Promise<void>;
}

let backend: Backend;

function setBackend(next: Backend): void {
  backend = next;
}

function spanReads(): Array<ListArgs> {
  return getListMock.mock.calls
    .map((call: [ListArgs]) => {
      return call[0];
    })
    .filter((args: ListArgs) => {
      return args.modelType === Span && !args.query["spanId"];
    });
}

function postsTo(path: string): Array<PostArgs> {
  return postMock.mock.calls
    .map((call: [PostArgs]) => {
      return call[0];
    })
    .filter((args: PostArgs) => {
      return args.url.toString().includes(path);
    });
}

beforeEach(() => {
  getListMock.mockReset();
  countMock.mockReset();
  serviceListMock.mockReset();
  postMock.mockReset();
  logsViewerProps.mockReset();
  exceptionTableProps.mockReset();
  flameGraphProps.mockReset();
  scopedFlamegraphProps.mockReset();

  setBackend({ traceSpans: checkoutDefinitions().map(makeSpan) });

  serviceListMock.mockImplementation(async (args: ListArgs) => {
    if (args.modelType === InventoryItem) {
      const items: Array<InventoryItem> = backend.inventoryItems || [];
      return { data: items, count: items.length, skip: 0, limit: args.limit };
    }
    return { data: services(), count: 3, skip: 0, limit: 10000 };
  });

  countMock.mockImplementation(async (modelType: unknown) => {
    if (modelType === Log) {
      if (typeof backend.linkedLogCount === "string") {
        throw new HTTPErrorResponse(
          500,
          { message: backend.linkedLogCount },
          {},
        );
      }
      return backend.linkedLogCount ?? 0;
    }
    return 2;
  });

  getListMock.mockImplementation(async (args: ListArgs) => {
    if (args.modelType === Span && args.query["spanId"]) {
      const spanId: string = String(args.query["spanId"]);
      const detail: Partial<Span> = backend.details?.[spanId] || {
        attributes: { "db.system": "postgresql", "http.status_code": 409 },
        events: [],
        links: [],
        statusMessage: "stock version changed",
      };
      return {
        data: [Object.assign(new Span(), detail)],
        count: 1,
        skip: 0,
        limit: 1,
      };
    }
    if (args.modelType === Span) {
      if (backend.holdTraceRead) {
        await backend.holdTraceRead;
      }
      if (backend.failTraceRead) {
        throw new HTTPErrorResponse(
          500,
          { message: backend.failTraceRead },
          {},
        );
      }
      return {
        data: backend.traceSpans.slice(args.skip, args.skip + args.limit),
        count: backend.totalCount ?? backend.traceSpans.length,
        skip: args.skip,
        limit: args.limit,
      };
    }
    if (args.modelType === Log && args.query["k8sPodEntityKey"]) {
      // `time` is a DateTime64(9): compared to the nanosecond, both ends in.
      const window: InBetween<Date> = args.query[
        "time"
      ] as unknown as InBetween<Date>;
      const rows: Array<Log> = (backend.podLogs || [])
        .filter((log: Log) => {
          const time: number = Number(log.timeUnixNano);
          return (
            log.k8sPodEntityKey === args.query["k8sPodEntityKey"] &&
            time >= window.startValue.getTime() * MS &&
            time <= window.endValue.getTime() * MS
          );
        })
        .sort((left: Log, right: Log) => {
          return Number(left.timeUnixNano) - Number(right.timeUnixNano);
        });
      if (args.sort?.["time"] === SortOrder.Descending) {
        rows.reverse();
      }
      return {
        data: rows.slice(0, args.limit),
        count: rows.length,
        skip: 0,
        limit: args.limit,
      };
    }
    if (args.modelType === Log) {
      return {
        data: backend.logs || [],
        count: (backend.logs || []).length,
        skip: 0,
        limit: 200,
      };
    }
    if (args.modelType === ExceptionInstance) {
      const rows: Array<ExceptionInstance> = backend.exceptions || [];
      return { data: rows, count: rows.length, skip: 0, limit: 50 };
    }
    return { data: [], count: 0, skip: 0, limit: 10 };
  });

  postMock.mockImplementation(async (args: PostArgs) => {
    const url: string = args.url.toString();
    if (url.includes("/telemetry/profiles/trace-presence")) {
      return new HTTPResponse(200, { sampleCount: 0 }, {});
    }
    if (url.includes("/telemetry/metrics/for-trace")) {
      return new HTTPResponse(200, { items: [] }, {});
    }
    return new HTTPResponse(200, {}, {});
  });
});

afterEach(() => {
  cleanup();
});

async function renderTrace(highlightSpanIds?: Array<string>): Promise<void> {
  render(
    <TraceExplorer
      traceId={TRACE_ID}
      {...(highlightSpanIds ? { highlightSpanIds } : {})}
    />,
  );
  await screen.findByTestId("trace-header");
}

function rows(): Array<string> {
  return screen.queryAllByRole("treeitem").map((item: HTMLElement) => {
    return item.getAttribute("data-span-id") || "";
  });
}

function row(spanId: string): HTMLElement {
  return document.querySelector(`[data-span-id="${spanId}"]`) as HTMLElement;
}

describe("loading the trace", () => {
  test("shows a skeleton until the spans arrive", async () => {
    let release: () => void = () => {};
    setBackend({
      traceSpans: checkoutDefinitions().map(makeSpan),
      holdTraceRead: new Promise<void>((resolve: () => void) => {
        release = resolve;
      }),
    });

    render(<TraceExplorer traceId={TRACE_ID} />);

    expect(screen.getByTestId("trace-loading")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await act(async () => {
      release();
    });
    expect(await screen.findByTestId("trace-header")).toBeInTheDocument();
    expect(screen.queryByTestId("trace-loading")).not.toBeInTheDocument();
  });

  test("asks for this trace's spans in start order, one page at a time", async () => {
    await renderTrace();

    const [read] = spanReads();
    expect(read!.query).toEqual({ traceId: TRACE_ID });
    expect(read!.sort).toEqual({ startTimeUnixNano: SortOrder.Ascending });
    expect(read!.skip).toBe(0);
    expect(read!.limit).toBe(500);
    expect(Object.keys(read!.select!).sort()).toEqual(
      [
        "durationUnixNano",
        "endTime",
        "endTimeUnixNano",
        "k8sPodEntityKey",
        "kind",
        "name",
        "parentSpanId",
        "primaryEntityId",
        "spanId",
        "startTime",
        "startTimeUnixNano",
        "statusCode",
        "traceId",
      ].sort(),
    );
    expect(serviceListMock.mock.calls[0]![0].modelType).toBe(Service);
    expect(String(serviceListMock.mock.calls[0]![0].query["projectId"])).toBe(
      PROJECT_ID,
    );
  });

  test("the header names the request and summarises the trace", async () => {
    await renderTrace();

    expect(screen.getByTestId("trace-title")).toHaveTextContent(
      "POST /api/v1/checkout",
    );
    expect(screen.getByTestId("trace-status")).toHaveTextContent("1 error");
    expect(screen.getByTestId("trace-stat-duration")).toHaveTextContent("1 s");
    expect(screen.getByTestId("trace-stat-spans")).toHaveTextContent("17");
    expect(screen.getByTestId("trace-stat-services")).toHaveTextContent("3");
    expect(screen.getByTestId("trace-stat-errors")).toHaveTextContent("1");
    expect(screen.getByTestId("trace-stat-errors")).toHaveTextContent(
      "5.9% of spans",
    );
    expect(screen.getByTestId("trace-stat-depth")).toHaveTextContent("3");
    expect(screen.getByTestId("trace-id")).toHaveTextContent("4bf92f35…0e4736");
    expect(
      within(screen.getByTestId("trace-header")).getByText("Server"),
    ).toBeInTheDocument();
  });

  test("the service breakdown lists every service by self time", async () => {
    await renderTrace();

    const chips: Array<HTMLElement> =
      screen.getAllByTestId("trace-service-chip");
    expect(
      chips.map((chip: HTMLElement) => {
        return chip.textContent;
      }),
    ).toEqual([
      expect.stringContaining("api-gateway"),
      expect.stringContaining("inventory-service"),
      expect.stringContaining("checkout-service"),
    ]);
    expect(chips[1]).toHaveTextContent("1 error");
    expect(chips[2]).toHaveTextContent("13 spans");
  });

  test("a failed read shows the error with a way to retry", async () => {
    setBackend({
      traceSpans: checkoutDefinitions().map(makeSpan),
      failTraceRead: "The trace store is unavailable.",
    });
    render(<TraceExplorer traceId={TRACE_ID} />);

    expect(
      await screen.findByText("The trace store is unavailable."),
    ).toBeInTheDocument();

    setBackend({ traceSpans: checkoutDefinitions().map(makeSpan) });
    fireEvent.click(screen.getByTestId("refresh-button"));

    expect(await screen.findByTestId("trace-header")).toBeInTheDocument();
    expect(spanReads()).toHaveLength(2);
  });

  test("a trace with no spans explains itself and still offers its logs", async () => {
    setBackend({ traceSpans: [] });
    render(<TraceExplorer traceId={TRACE_ID} />);

    expect(await screen.findByTestId("trace-empty")).toHaveTextContent(
      "No spans found for this trace",
    );
    expect(screen.queryByTestId("trace-waterfall")).not.toBeInTheDocument();
    expect(screen.getByTestId("logs-viewer")).toBeInTheDocument();
    expect(logsViewerProps.mock.calls[0]![0]["traceIds"]).toEqual([TRACE_ID]);
  });

  test("spans whose parent never arrived are flagged in the header", async () => {
    setBackend({
      traceSpans: [
        ...checkoutDefinitions().map(makeSpan),
        makeSpan({
          spanId: "lost",
          parentSpanId: "gone",
          name: "late span",
          serviceId: GATEWAY,
          startMs: 900,
          durationMs: 5,
        }),
      ],
    });
    await renderTrace();

    expect(screen.getByTestId("trace-orphans")).toHaveTextContent(
      "1 span missing a parent",
    );
  });

  test("refresh reads the trace again", async () => {
    await renderTrace();

    fireEvent.click(screen.getByTestId("trace-refresh"));

    await waitFor(() => {
      expect(spanReads()).toHaveLength(2);
    });
    expect(spanReads()[1]!.limit).toBe(500);
  });
});

describe("batch loading a large trace", () => {
  function largeBackend(total: number): Backend {
    const definitions: Array<SpanDefinition> = [
      {
        spanId: "root",
        parentSpanId: "",
        name: "GET /reindex",
        serviceId: GATEWAY,
        startMs: 0,
        durationMs: total,
      },
    ];
    for (let index: number = 1; index < total; index++) {
      definitions.push({
        spanId: `s${index}`,
        parentSpanId: "root",
        name: `item ${index}`,
        serviceId: CHECKOUT,
        startMs: index,
        durationMs: 1,
      });
    }
    return { traceSpans: definitions.map(makeSpan) };
  }

  test("offers the next page and then the rest", async () => {
    setBackend(largeBackend(1250));
    await renderTrace();

    const notice: HTMLElement = screen.getByTestId("trace-load-more");
    expect(notice).toHaveTextContent("Showing 500 of 1,250 spans");
    expect(screen.getByTestId("trace-stat-spans")).toHaveTextContent(
      "500of 1,250",
    );
    expect(screen.getByTestId("trace-load-next")).toHaveTextContent(
      "Load 500 more spans",
    );
    expect(screen.getByTestId("trace-load-all")).toHaveTextContent(
      "Load all 750",
    );

    fireEvent.click(screen.getByTestId("trace-load-next"));
    await waitFor(() => {
      expect(screen.getByTestId("trace-load-more")).toHaveTextContent(
        "Showing 1,000 of 1,250 spans",
      );
    });
    expect(spanReads()[1]).toMatchObject({ skip: 500, limit: 500 });
    expect(screen.queryByTestId("trace-load-all")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("trace-load-next"));
    await waitFor(() => {
      expect(screen.queryByTestId("trace-load-more")).not.toBeInTheDocument();
    });
    expect(spanReads()[2]).toMatchObject({ skip: 1000, limit: 250 });
    expect(screen.getByTestId("trace-stat-spans")).toHaveTextContent("1,250");
  });

  test("load all fetches every remaining span in one go", async () => {
    setBackend(largeBackend(1250));
    await renderTrace();

    fireEvent.click(screen.getByTestId("trace-load-all"));

    await waitFor(() => {
      expect(screen.queryByTestId("trace-load-more")).not.toBeInTheDocument();
    });
    expect(spanReads()[1]).toMatchObject({ skip: 500, limit: 750 });
    expect(spanReads()).toHaveLength(2);
  });

  test("a server that runs out early ends the batches instead of looping", async () => {
    const large: Backend = largeBackend(700);
    setBackend({ ...large, totalCount: 900 });
    await renderTrace();

    expect(screen.getByTestId("trace-load-more")).toHaveTextContent(
      "Showing 500 of 900 spans",
    );
    // The last 400 fit in one batch, so only "Load 400 more" is offered.
    expect(screen.queryByTestId("trace-load-all")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("trace-load-next"));

    await waitFor(() => {
      expect(screen.queryByTestId("trace-load-more")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("trace-stat-spans")).toHaveTextContent("700");
  });

  test("a failed batch keeps the loaded spans and shows the error", async () => {
    setBackend(largeBackend(1250));
    await renderTrace();

    backend.failTraceRead = "Could not load more spans.";
    fireEvent.click(screen.getByTestId("trace-load-next"));

    expect(
      await screen.findByText("Could not load more spans."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("trace-waterfall")).toBeInTheDocument();
    expect(screen.getByTestId("trace-load-next")).toBeInTheDocument();
  });
});

describe("finding spans", () => {
  test("search keeps matches with their ancestors and counts them", async () => {
    await renderTrace();

    fireEvent.change(screen.getByTestId("trace-search"), {
      target: { value: "stock" },
    });

    expect(rows()).toEqual(["root", "reserve", "update"]);
    expect(screen.getByTestId("trace-search-count")).toHaveTextContent(
      "1 match",
    );
    expect(screen.getByTestId("trace-filter-summary")).toHaveTextContent(
      "1 span of 17 match",
    );
    expect(within(row("update")).getByText("stock").tagName).toBe("MARK");
  });

  test("Enter jumps to the next match and opens it", async () => {
    await renderTrace();
    const search: HTMLElement = screen.getByTestId("trace-search");

    fireEvent.change(search, { target: { value: "select products" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(await screen.findByTestId("span-panel-title")).toHaveTextContent(
      "SELECT products WHERE id = $1",
    );
    expect(row("query-0")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("trace-search-count")).toHaveTextContent(
      "1 of 12",
    );

    fireEvent.keyDown(search, { key: "Enter" });
    expect(row("query-1")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("trace-search-count")).toHaveTextContent(
      "2 of 12",
    );

    fireEvent.keyDown(search, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(search, { key: "Enter", shiftKey: true });
    expect(row("query-11")).toHaveAttribute("aria-selected", "true");
  });

  test("Escape clears the search", async () => {
    await renderTrace();
    const search: HTMLInputElement = screen.getByTestId(
      "trace-search",
    ) as HTMLInputElement;

    fireEvent.change(search, { target: { value: "stock" } });
    fireEvent.keyDown(search, { key: "Escape" });

    expect(search.value).toBe("");
    expect(rows()).toHaveLength(17);
  });

  test("a search with no matches says so", async () => {
    await renderTrace();

    fireEvent.change(screen.getByTestId("trace-search"), {
      target: { value: "no such span" },
    });

    expect(screen.getByTestId("trace-search-count")).toHaveTextContent(
      "0 matches",
    );
    expect(screen.getByTestId("trace-waterfall-empty")).toBeInTheDocument();
  });

  test("errors only keeps the error spans, and the header's error count does the same", async () => {
    await renderTrace();

    fireEvent.click(screen.getByTestId("trace-errors-only"));
    expect(rows()).toEqual(["root", "reserve"]);
    expect(screen.getByTestId("trace-errors-only")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByTestId("trace-clear-filters"));
    expect(rows()).toHaveLength(17);

    fireEvent.click(
      within(screen.getByTestId("trace-stat-errors")).getByRole("button"),
    );
    expect(rows()).toEqual(["root", "reserve"]);
  });

  test("errors only is disabled when nothing failed", async () => {
    setBackend({
      traceSpans: checkoutDefinitions()
        .map((definition: SpanDefinition) => {
          return { ...definition, isError: false };
        })
        .map(makeSpan),
    });
    await renderTrace();

    expect(screen.getByTestId("trace-errors-only")).toBeDisabled();
    expect(screen.getByTestId("trace-status")).toHaveTextContent("No errors");
  });

  test("service chips filter the spans and can be removed one by one", async () => {
    await renderTrace();

    fireEvent.click(screen.getAllByTestId("trace-service-chip")[1]!);
    expect(rows()).toEqual(["root", "reserve", "update"]);
    expect(screen.getAllByTestId("trace-service-chip")[1]).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getAllByTestId("trace-service-chip")[2]!);
    expect(rows()).toHaveLength(16);

    fireEvent.click(
      screen.getByRole("button", { name: "Remove inventory-service filter" }),
    );
    expect(rows()).toEqual([
      "root",
      "validate",
      ...Array.from({ length: 12 }, (_: unknown, index: number) => {
        return `query-${index}`;
      }),
    ]);

    fireEvent.click(screen.getByText("Show all services"));
    expect(rows()).toHaveLength(17);
  });

  test("filters combine", async () => {
    await renderTrace();

    fireEvent.click(screen.getAllByTestId("trace-service-chip")[1]!);
    fireEvent.change(screen.getByTestId("trace-search"), {
      target: { value: "update" },
    });

    expect(rows()).toEqual(["root", "reserve", "update"]);
    expect(screen.getByTestId("trace-filter-summary")).toHaveTextContent(
      "Search: “update”",
    );
  });

  test("pressing / focuses the search from anywhere, but not while typing", async () => {
    await renderTrace();
    const search: HTMLElement = screen.getByTestId("trace-search");

    fireEvent.keyDown(window, { key: "/" });
    expect(document.activeElement).toBe(search);

    search.blur();
    const other: HTMLInputElement = document.createElement("input");
    document.body.appendChild(other);
    other.focus();
    fireEvent.keyDown(other, { key: "/" });
    expect(document.activeElement).toBe(other);
    other.remove();
  });
});

describe("the tree", () => {
  test("collapse all keeps the root's children visible; expand all shows everything", async () => {
    await renderTrace();

    fireEvent.click(screen.getByTestId("trace-collapse-all"));
    expect(rows()).toEqual(["root", "auth", "reserve", "validate"]);

    fireEvent.click(screen.getByTestId("trace-expand-all"));
    expect(rows()).toHaveLength(17);
  });

  test("the keyboard walks the tree and opens the span", async () => {
    await renderTrace();
    const tree: HTMLElement = screen.getByRole("tree");

    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "ArrowDown" });

    expect(row("auth")).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByTestId("span-panel-title")).toHaveTextContent(
      "auth.verifyToken",
    );

    fireEvent.keyDown(tree, { key: "Escape" });
    expect(screen.queryByTestId("trace-span-panel")).not.toBeInTheDocument();
  });

  test("the critical path is outlined on demand", async () => {
    await renderTrace();

    expect(
      screen.queryByTestId("trace-critical-path-summary"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("trace-critical-path"));

    expect(screen.getByTestId("trace-critical-path-summary")).toHaveTextContent(
      "Critical path:",
    );
    expect(screen.getByTestId("trace-critical-path")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("switching views keeps the filters and hands the flame graph the visible spans", async () => {
    await renderTrace();

    fireEvent.change(screen.getByTestId("trace-search"), {
      target: { value: "stock" },
    });
    fireEvent.click(screen.getByTestId("trace-view-flamegraph"));

    expect(screen.getByTestId("flame-graph")).toBeInTheDocument();
    const spans: Array<Span> = flameGraphProps.mock.calls[
      flameGraphProps.mock.calls.length - 1
    ]![0]["spans"] as Array<Span>;
    expect(
      spans.map((item: Span) => {
        return item.spanId;
      }),
    ).toEqual(["root", "reserve", "update"]);
    expect(screen.queryByTestId("trace-critical-path")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("trace-view-servicemap"));
    expect(screen.getByTestId("service-map")).toBeInTheDocument();
  });
});

describe("the span panel", () => {
  test("opens on click with timing, place in the tree and the full span", async () => {
    await renderTrace();

    fireEvent.click(row("update"));

    const panel: HTMLElement = await screen.findByTestId("trace-span-panel");
    expect(within(panel).getByTestId("span-panel-title")).toHaveTextContent(
      "UPDATE stock",
    );
    expect(within(panel).getByTestId("span-panel-timing")).toHaveTextContent(
      "200 ms",
    );
    expect(within(panel).getByTestId("span-panel-timing")).toHaveTextContent(
      "+150 ms",
    );
    expect(within(panel).getByTestId("span-panel-id")).toHaveTextContent(
      "update",
    );
    expect(within(panel).getByTestId("span-panel-parent")).toHaveTextContent(
      "POST /reserve",
    );

    await within(panel).findByTestId("span-attributes");
    expect(within(panel).getByText("db.system")).toBeInTheDocument();
    expect(within(panel).getByText("postgresql")).toBeInTheDocument();

    const detailRead: ListArgs = getListMock.mock.calls
      .map((call: [ListArgs]) => {
        return call[0];
      })
      .find((args: ListArgs) => {
        return args.modelType === Span && args.query["spanId"] === "update";
      })!;
    expect(detailRead.query["traceId"]).toBe(TRACE_ID);
    expect(String(detailRead.query["projectId"])).toBe(PROJECT_ID);
    expect(Object.keys(detailRead.select!)).toEqual(
      expect.arrayContaining([
        "attributes",
        "events",
        "links",
        "statusMessage",
        "sessionId",
      ]),
    );
  });

  test("an error span shows its status message", async () => {
    await renderTrace();

    fireEvent.click(row("reserve"));

    expect(
      await screen.findByTestId("span-panel-status-message"),
    ).toHaveTextContent("stock version changed");
    expect(screen.getByTestId("span-panel-status")).toHaveTextContent("Error");
  });

  test("the parent link selects the parent, and close closes the panel", async () => {
    await renderTrace();

    fireEvent.click(row("update"));
    fireEvent.click(await screen.findByTestId("span-panel-parent"));

    expect(screen.getByTestId("span-panel-title")).toHaveTextContent(
      "POST /reserve",
    );
    expect(row("reserve")).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByTestId("span-panel-close"));
    expect(screen.queryByTestId("trace-span-panel")).not.toBeInTheDocument();
  });

  test("attributes can be filtered, copied and turned into a traces search", async () => {
    const attributes: JSONObject = {};
    for (let index: number = 0; index < 10; index++) {
      attributes[`custom.key${index}`] = `value ${index}`;
    }
    backend.details = { update: { attributes, events: [], links: [] } };
    await renderTrace();

    fireEvent.click(row("update"));
    await screen.findByTestId("span-attributes");

    fireEvent.change(screen.getByLabelText("Filter attributes"), {
      target: { value: "key7" },
    });
    const list: HTMLElement = screen.getByTestId("span-attributes");
    expect(within(list).getAllByRole("definition")).toHaveLength(1);

    const search: HTMLAnchorElement = within(list)
      .getByTitle("Find traces with this attribute value")
      .closest("a") as HTMLAnchorElement;
    expect(decodeURIComponent(search.getAttribute("href") || "")).toContain(
      'search=@custom.key7:"value 7"',
    );
    expect(within(list).getByTitle("Copy custom.key7")).toBeInTheDocument();
  });

  test("events list exceptions with their message and offset", async () => {
    const start: number = (EPOCH_MS + 150) * MS;
    backend.details = {
      update: {
        attributes: {},
        links: [],
        events: [
          {
            name: "exception",
            time: new Date(),
            timeUnixNano: start + 180 * MS,
            attributes: {
              "exception.type": "SerializationError",
              "exception.message": "could not serialize access",
            },
          },
          {
            name: "lock.acquired",
            time: new Date(),
            timeUnixNano: start + 20 * MS,
            attributes: { "lock.wait_ms": 18 },
          },
        ],
      },
    };
    await renderTrace();

    fireEvent.click(row("update"));
    await waitFor(() => {
      expect(screen.getByTestId("span-panel-tab-events")).toHaveTextContent(
        "2",
      );
    });
    fireEvent.click(screen.getByTestId("span-panel-tab-events"));

    const events: HTMLElement = screen.getByTestId("span-events");
    const items: Array<HTMLElement> = within(events).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("lock.acquired");
    expect(items[0]).toHaveTextContent("+20 ms");
    expect(items[1]).toHaveTextContent("Exception: could not serialize access");
    expect(items[1]).toHaveTextContent("+180 ms");
    expect(screen.getByTestId("trace-span-panel")).toHaveTextContent(
      "1 exception",
    );
  });

  test("the logs tab reads this span's logs on first open only", async () => {
    backend.logs = [
      Object.assign(new Log(), {
        time: new Date(EPOCH_MS + 160),
        severityText: "WARN",
        body: "retrying UPDATE after serialization failure",
        spanId: "update",
        traceId: TRACE_ID,
      }),
    ];
    await renderTrace();

    fireEvent.click(row("update"));
    fireEvent.click(await screen.findByTestId("span-panel-tab-logs"));

    expect(
      await screen.findByText("retrying UPDATE after serialization failure"),
    ).toBeInTheDocument();
    const logReads: Array<ListArgs> = getListMock.mock.calls
      .map((call: [ListArgs]) => {
        return call[0];
      })
      .filter((args: ListArgs) => {
        return args.modelType === Log;
      });
    expect(logReads).toHaveLength(1);
    expect(logReads[0]!.query).toMatchObject({
      traceId: TRACE_ID,
      spanId: "update",
    });

    fireEvent.click(screen.getByTestId("span-panel-tab-attributes"));
    fireEvent.click(screen.getByTestId("span-panel-tab-logs"));
    expect(
      getListMock.mock.calls
        .map((call: [ListArgs]) => {
          return call[0];
        })
        .filter((args: ListArgs) => {
          return args.modelType === Log;
        }),
    ).toHaveLength(1);
    expect(screen.getByTestId("span-panel-tab-logs")).toHaveTextContent("1");
  });

  test("an empty logs tab points to the trace's logs", async () => {
    await renderTrace();

    fireEvent.click(row("auth"));
    fireEvent.click(await screen.findByTestId("span-panel-tab-logs"));

    expect(
      await screen.findByText(/No logs were written inside this span/),
    ).toBeInTheDocument();
  });

  test("the exceptions tab links each exception to its group", async () => {
    backend.exceptions = [
      Object.assign(new ExceptionInstance(), {
        exceptionType: "InventoryReservationError",
        message: "Could not reserve 3 units of SKU-4821",
        fingerprint: "9f86d081884c7d659a2feaa0c55ad015",
        stackTrace:
          "InventoryReservationError: Could not reserve\\n    at reserve (inventory.ts:12:3)",
        time: new Date(EPOCH_MS + 390),
      }),
    ];
    await renderTrace();

    fireEvent.click(row("reserve"));
    fireEvent.click(await screen.findByTestId("span-panel-tab-exceptions"));

    const list: HTMLElement = await screen.findByTestId("span-exceptions");
    expect(list).toHaveTextContent("InventoryReservationError");
    expect(list).toHaveTextContent("Could not reserve 3 units of SKU-4821");
    expect(
      within(list)
        .getByText("View exception")
        .closest("a")!
        .getAttribute("href"),
    ).toContain("9f86d081884c7d659a2feaa0c55ad015");
    expect(list.querySelector("pre")!.textContent).toContain(
      "\n    at reserve",
    );
    const exceptionRead: ListArgs = getListMock.mock.calls
      .map((call: [ListArgs]) => {
        return call[0];
      })
      .find((args: ListArgs) => {
        return args.modelType === ExceptionInstance;
      })!;
    expect(exceptionRead.query).toMatchObject({ spanId: "reserve" });
  });

  test("links open the linked span", async () => {
    backend.details = {
      update: {
        attributes: {},
        events: [],
        links: [
          { traceId: TRACE_ID, spanId: "auth" },
          {
            traceId: "0af7651916cd43dd8448eb211c80319c",
            spanId: "b7ad6b7169203331",
            attributes: { "link.reason": "retry" },
          },
        ],
      },
    };
    await renderTrace();

    fireEvent.click(row("update"));
    await waitFor(() => {
      expect(screen.getByTestId("span-panel-tab-links")).toHaveTextContent("2");
    });
    fireEvent.click(screen.getByTestId("span-panel-tab-links"));

    const links: HTMLElement = screen.getByTestId("span-links");
    expect(
      within(links).getByText("Show span").closest("a")!.getAttribute("href"),
    ).toContain(`/traces/view/${TRACE_ID}?spanId=auth`);
    expect(
      within(links).getByText("Open trace").closest("a")!.getAttribute("href"),
    ).toContain(
      "/traces/view/0af7651916cd43dd8448eb211c80319c?spanId=b7ad6b7169203331",
    );
    expect(links).toHaveTextContent("link.reason");
  });

  test("a span with profile samples gets a Profile tab scoped to it", async () => {
    postMock.mockImplementation(async (args: PostArgs) => {
      if (args.url.toString().includes("/telemetry/profiles/trace-presence")) {
        const spanIds: unknown = args.data["spanIds"];
        return new HTTPResponse(
          200,
          {
            sampleCount:
              Array.isArray(spanIds) && spanIds.includes("update") ? 42 : 0,
          },
          {},
        );
      }
      return new HTTPResponse(200, {}, {});
    });
    await renderTrace();

    fireEvent.click(row("update"));
    fireEvent.click(await screen.findByTestId("span-panel-tab-profile"));

    expect(screen.getByTestId("span-panel-tab-profile")).toHaveTextContent(
      "42",
    );
    expect(scopedFlamegraphProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ traceId: TRACE_ID, spanIds: ["update"] }),
    );
    expect(screen.getByTestId("span-profile")).toHaveTextContent(
      "Flame graph built from the 42 profile samples linked to this span.",
    );

    fireEvent.click(row("auth"));
    await waitFor(() => {
      expect(
        screen.queryByTestId("span-panel-tab-profile"),
      ).not.toBeInTheDocument();
    });
  });

  test("zoom to span narrows the time axis", async () => {
    await renderTrace();

    fireEvent.click(row("update"));
    fireEvent.click(await screen.findByTestId("span-panel-zoom"));

    expect(screen.getByTestId("trace-reset-zoom")).toBeInTheDocument();
    const labels: Array<string> = screen
      .getAllByTestId("trace-axis-tick")
      .map((tick: HTMLElement) => {
        return tick.textContent || "";
      });
    expect(labels[0]).not.toBe("0");

    fireEvent.click(screen.getByTestId("trace-reset-zoom"));
    expect(screen.queryByTestId("trace-reset-zoom")).not.toBeInTheDocument();
  });

  test("a failed span read is reported inside the panel", async () => {
    getListMock.mockImplementation(async (args: ListArgs) => {
      if (args.modelType === Span && args.query["spanId"]) {
        throw new HTTPErrorResponse(
          500,
          { message: "Could not load this span." },
          {},
        );
      }
      return {
        data: backend.traceSpans,
        count: backend.traceSpans.length,
        skip: 0,
        limit: 500,
      };
    });
    await renderTrace();

    fireEvent.click(row("auth"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load this span.",
    );
  });
});

/*
 * OBI v0.14 links a Node.js request's CPU samples to its "processing" span or
 * to the client call in flight, never to the SERVER span, so a span's Profile
 * tab covers the span and the spans nested under it.
 */
describe("the span panel's Profile tab", () => {
  // The presence probe counts the samples linked to the span ids it is sent.
  function linkSamples(samplesBySpanId: (spanId: string) => number): void {
    postMock.mockImplementation(async (args: PostArgs) => {
      if (args.url.toString().includes("/telemetry/profiles/trace-presence")) {
        const spanIds: Array<string> =
          (args.data["spanIds"] as Array<string> | undefined) || [];
        return new HTTPResponse(
          200,
          {
            sampleCount: spanIds.reduce((total: number, spanId: string) => {
              return total + samplesBySpanId(spanId);
            }, 0),
          },
          {},
        );
      }
      return new HTTPResponse(200, {}, {});
    });
  }

  function linkSamplesTo(samples: Record<string, number>): void {
    linkSamples((spanId: string): number => {
      return samples[spanId] || 0;
    });
  }

  function probedSpanIds(): Array<Array<string>> {
    return postsTo("/telemetry/profiles/trace-presence").map(
      (args: PostArgs) => {
        return args.data["spanIds"] as Array<string>;
      },
    );
  }

  function lastProbedSpanIds(): Array<string> {
    const probes: Array<Array<string>> = probedSpanIds();
    return probes[probes.length - 1]!;
  }

  /*
   *   GET /api/items/:id (server)
   *   ├── in queue
   *   └── processing
   *       ├── SELECT postgres (client)
   *       └── GET /ping (client)
   */
  function obiRequest(): Array<Span> {
    return [
      {
        spanId: "server",
        parentSpanId: "",
        name: "GET /api/items/:id",
        serviceId: GATEWAY,
        startMs: 0,
        durationMs: 20,
        kind: SpanKind.Server,
      },
      {
        spanId: "queue",
        parentSpanId: "server",
        name: "in queue",
        serviceId: GATEWAY,
        startMs: 0,
        durationMs: 1,
      },
      {
        spanId: "processing",
        parentSpanId: "server",
        name: "processing",
        serviceId: GATEWAY,
        startMs: 1,
        durationMs: 19,
      },
      {
        spanId: "select",
        parentSpanId: "processing",
        name: "SELECT postgres",
        serviceId: GATEWAY,
        startMs: 2,
        durationMs: 3,
        kind: SpanKind.Client,
      },
      {
        spanId: "ping",
        parentSpanId: "processing",
        name: "GET /ping",
        serviceId: GATEWAY,
        startMs: 8,
        durationMs: 10,
        kind: SpanKind.Client,
      },
    ].map(makeSpan);
  }

  // GET /reindex (server) with 1,249 spans directly under it: three pages.
  function wideRequest(): Array<Span> {
    const definitions: Array<SpanDefinition> = [
      {
        spanId: "root",
        parentSpanId: "",
        name: "GET /reindex",
        serviceId: GATEWAY,
        startMs: 0,
        durationMs: 1250,
        kind: SpanKind.Server,
      },
    ];
    for (let index: number = 1; index < 1250; index++) {
      definitions.push({
        spanId: `s${index}`,
        parentSpanId: "root",
        name: `item ${index}`,
        serviceId: CHECKOUT,
        startMs: index,
        durationMs: 1,
      });
    }
    return definitions.map(makeSpan);
  }

  test("a server span shows the samples linked to the spans under it", async () => {
    setBackend({ traceSpans: obiRequest() });
    linkSamplesTo({ processing: 30, ping: 4 });
    await renderTrace();

    fireEvent.click(row("server"));
    fireEvent.click(await screen.findByTestId("span-panel-tab-profile"));

    expect(screen.getByTestId("span-panel-tab-profile")).toHaveTextContent(
      "34",
    );
    expect(probedSpanIds()).toContainEqual([
      "server",
      "queue",
      "processing",
      "select",
      "ping",
    ]);
    expect(screen.getByTestId("span-profile")).toHaveTextContent(
      "Flame graph built from the 34 profile samples linked to this span and the 4 spans nested under it.",
    );
    expect(scopedFlamegraphProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        traceId: TRACE_ID,
        spanIds: ["server", "queue", "processing", "select", "ping"],
      }),
    );
  });

  test("a span's tab leaves out its parent and siblings", async () => {
    setBackend({ traceSpans: obiRequest() });
    linkSamplesTo({ server: 5, queue: 2, ping: 4 });
    await renderTrace();

    fireEvent.click(row("processing"));
    fireEvent.click(await screen.findByTestId("span-panel-tab-profile"));

    expect(screen.getByTestId("span-panel-tab-profile")).toHaveTextContent("4");
    expect(scopedFlamegraphProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ spanIds: ["processing", "select", "ping"] }),
    );

    fireEvent.click(row("queue"));
    fireEvent.click(await screen.findByTestId("span-panel-tab-profile"));

    expect(screen.getByTestId("span-profile")).toHaveTextContent(
      "Flame graph built from the 2 profile samples linked to this span.",
    );
    expect(scopedFlamegraphProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ spanIds: ["queue"] }),
    );
  });

  test("a search does not narrow a span's Profile tab", async () => {
    setBackend({ traceSpans: obiRequest() });
    linkSamplesTo({ processing: 30, ping: 4 });
    await renderTrace();

    fireEvent.change(screen.getByTestId("trace-search"), {
      target: { value: "GET /api" },
    });
    expect(rows()).toEqual(["server"]);

    fireEvent.click(row("server"));
    fireEvent.click(await screen.findByTestId("span-panel-tab-profile"));

    expect(screen.getByTestId("span-panel-tab-profile")).toHaveTextContent(
      "34",
    );
    expect(lastProbedSpanIds()).toEqual([
      "server",
      "queue",
      "processing",
      "select",
      "ping",
    ]);
    expect(scopedFlamegraphProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ spanIds: lastProbedSpanIds() }),
    );
  });

  test("a huge subtree asks for the nearest spans, again as more spans load", async () => {
    setBackend({ traceSpans: wideRequest() });
    // One sample on every span under the root.
    linkSamples((spanId: string): number => {
      return spanId === "root" ? 0 : 1;
    });
    await renderTrace();

    fireEvent.click(row("root"));
    await waitFor(() => {
      expect(screen.getByTestId("span-panel-tab-profile")).toHaveTextContent(
        "499",
      );
    });
    expect(lastProbedSpanIds()).toHaveLength(500);

    fireEvent.click(screen.getByTestId("trace-load-all"));
    await waitFor(() => {
      expect(screen.getByTestId("span-panel-tab-profile")).toHaveTextContent(
        "999",
      );
    });
    const lastProbe: Array<string> = lastProbedSpanIds();
    expect(lastProbe).toHaveLength(1000);
    expect(lastProbe[0]).toBe("root");

    fireEvent.click(screen.getByTestId("span-panel-tab-profile"));
    expect(screen.getByTestId("span-profile")).toHaveTextContent(
      "Flame graph built from the 999 profile samples linked to this span and the nearest 999 of the 1,249 spans nested under it.",
    );
    expect(scopedFlamegraphProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ spanIds: lastProbe }),
    );
  });

  test("an open Profile tab stays open while more spans load", async () => {
    setBackend({ traceSpans: wideRequest() });
    linkSamples((spanId: string): number => {
      return spanId === "root" ? 0 : 1;
    });
    await renderTrace();

    fireEvent.click(row("root"));
    fireEvent.click(await screen.findByTestId("span-panel-tab-profile"));
    expect(screen.getByTestId("span-profile")).toHaveTextContent(
      "the 499 spans nested under it",
    );

    // The tab keeps its count while it asks again, so it never closes.
    fireEvent.click(screen.getByTestId("trace-load-all"));
    await waitFor(() => {
      expect(screen.getByTestId("span-panel-tab-profile")).toHaveTextContent(
        "999",
      );
    });
    expect(screen.getByTestId("span-profile")).toHaveTextContent(
      "the nearest 999 of the 1,249 spans nested under it",
    );
  });

  test("a capped subtree asks again when a nearer span loads", async () => {
    /*
     *   GET /reindex (server)
     *   ├── a, with 1,247 spans under it
     *   └── b, loaded with the last page
     */
    const definitions: Array<SpanDefinition> = [
      {
        spanId: "root",
        parentSpanId: "",
        name: "GET /reindex",
        serviceId: GATEWAY,
        startMs: 0,
        durationMs: 2000,
        kind: SpanKind.Server,
      },
      {
        spanId: "a",
        parentSpanId: "root",
        name: "a",
        serviceId: GATEWAY,
        startMs: 1,
        durationMs: 1500,
      },
    ];
    for (let index: number = 2; index < 1249; index++) {
      definitions.push({
        spanId: `g${index}`,
        parentSpanId: "a",
        name: `item ${index}`,
        serviceId: CHECKOUT,
        startMs: index,
        durationMs: 1,
      });
    }
    definitions.push({
      spanId: "b",
      parentSpanId: "root",
      name: "b",
      serviceId: GATEWAY,
      startMs: 2,
      durationMs: 1,
    });
    setBackend({ traceSpans: definitions.map(makeSpan) });
    linkSamplesTo({ b: 7 });
    await renderTrace();

    fireEvent.click(row("root"));
    fireEvent.click(screen.getByTestId("trace-load-next"));
    await waitFor(() => {
      expect(lastProbedSpanIds()).toHaveLength(1000);
    });
    expect(
      screen.queryByTestId("span-panel-tab-profile"),
    ).not.toBeInTheDocument();

    // b displaces a's farthest span: as many ids as before, but not the same.
    fireEvent.click(screen.getByTestId("trace-load-next"));
    await waitFor(() => {
      expect(screen.getByTestId("span-panel-tab-profile")).toHaveTextContent(
        "7",
      );
    });
    expect(lastProbedSpanIds()).toHaveLength(1000);
    expect(lastProbedSpanIds()).toContain("b");
  });
});

/*
 * The span panel's attributes, its events' and its links' as JSON: copied
 * with their types intact (a status code stays a number), in the flat or
 * nested shape, or read in place as JSON instead of the list.
 */
describe("copying span attributes as JSON", () => {
  const copyMock: Mock<(text: string) => Promise<boolean>> =
    jest.fn<(text: string) => Promise<boolean>>();

  function copied(index: number): unknown {
    return JSON.parse(copyMock.mock.calls[index]![0]);
  }

  async function openSpan(spanId: string): Promise<HTMLElement> {
    fireEvent.click(row(spanId));
    return await screen.findByTestId("trace-span-panel");
  }

  beforeEach(() => {
    window.localStorage.clear();
    resetPreferencesForTesting();
    copyMock.mockReset();
    copyMock.mockResolvedValue(true);
    jest
      .spyOn(Clipboard, "copyToClipboard")
      .mockImplementation(
        copyMock as unknown as typeof Clipboard.copyToClipboard,
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    window.localStorage.clear();
    resetPreferencesForTesting();
  });

  test("Copy JSON copies every attribute with its type, flat or nested", async () => {
    backend.details = {
      update: {
        attributes: {
          "db.system": "postgresql",
          "db.statement.params": [42, "SKU-4821"],
          "http.status_code": 409,
          "retry.enabled": false,
        },
        events: [],
        links: [],
      },
    };
    await renderTrace();
    await openSpan("update");
    await screen.findByTestId("span-attributes");

    const control: HTMLElement = screen.getByTestId(
      "trace-span-attributes-copy-json",
    );
    await act(async () => {
      fireEvent.click(
        within(control).getByRole("button", { name: "Copy JSON" }),
      );
    });

    expect(copied(0)).toEqual({
      "db.statement.params": [42, "SKU-4821"],
      "db.system": "postgresql",
      "http.status_code": 409,
      "retry.enabled": false,
    });
    expect(
      within(control).getByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        within(control).getByRole("button", { name: "Choose JSON format" }),
      );
    });
    await act(async () => {
      fireEvent.click(
        within(control).getByRole("menuitemradio", { name: /Nested/ }),
      );
    });

    expect(copied(1)).toEqual({
      db: { statement: { params: [42, "SKU-4821"] }, system: "postgresql" },
      http: { status_code: 409 },
      retry: { enabled: false },
    });
  });

  test("the attributes tab switches to a JSON view and back, and the filter belongs to the list", async () => {
    const attributes: JSONObject = { "http.status_code": 409 };
    for (let index: number = 0; index < 9; index++) {
      attributes[`custom.key${index}`] = `value ${index}`;
    }
    backend.details = { update: { attributes, events: [], links: [] } };
    await renderTrace();
    const panel: HTMLElement = await openSpan("update");
    await within(panel).findByTestId("span-attributes");

    expect(
      within(panel).getByLabelText("Filter attributes"),
    ).toBeInTheDocument();

    const toggle: HTMLElement = within(panel).getByTestId(
      "trace-span-attributes-view-toggle",
    );
    fireEvent.click(within(toggle).getByRole("button", { name: "JSON" }));

    const json: HTMLElement = within(panel).getByTestId(
      "trace-span-attributes-json",
    );
    expect(json).toHaveTextContent('"http.status_code": 409');
    expect(json).toHaveTextContent('"custom.key8": "value 8"');
    expect(
      within(panel).queryByTestId("span-attributes"),
    ).not.toBeInTheDocument();
    expect(
      within(panel).queryByLabelText("Filter attributes"),
    ).not.toBeInTheDocument();
    expect(within(panel).getByText("10 attributes")).toBeInTheDocument();

    fireEvent.click(within(toggle).getByRole("button", { name: "List" }));

    expect(within(panel).getByTestId("span-attributes")).toBeInTheDocument();
    expect(
      within(panel).getByLabelText("Filter attributes"),
    ).toBeInTheDocument();
  });

  test("the JSON view is remembered for the next span opened", async () => {
    await renderTrace();
    let panel: HTMLElement = await openSpan("update");
    await within(panel).findByTestId("span-attributes");

    fireEvent.click(
      within(
        within(panel).getByTestId("trace-span-attributes-view-toggle"),
      ).getByRole("button", { name: "JSON" }),
    );

    panel = await openSpan("reserve");
    expect(
      await within(panel).findByTestId("trace-span-attributes-json"),
    ).toHaveTextContent('"db.system": "postgresql"');
  });

  test("each event's attributes copy as JSON on their own", async () => {
    const start: number = (EPOCH_MS + 150) * MS;
    backend.details = {
      update: {
        attributes: {},
        links: [],
        events: [
          {
            name: "exception",
            time: new Date(),
            timeUnixNano: start + 180 * MS,
            attributes: {
              "exception.type": "SerializationError",
              "exception.message": "could not serialize access",
              "exception.escaped": true,
            },
          },
          {
            name: "lock.acquired",
            time: new Date(),
            timeUnixNano: start + 20 * MS,
            attributes: { "lock.wait_ms": 18 },
          },
        ],
      },
    };
    await renderTrace();
    await openSpan("update");
    await waitFor(() => {
      expect(screen.getByTestId("span-panel-tab-events")).toHaveTextContent(
        "2",
      );
    });
    fireEvent.click(screen.getByTestId("span-panel-tab-events"));

    const controls: Array<HTMLElement> = screen.getAllByTestId(
      "span-event-attributes-copy-json",
    );
    expect(controls).toHaveLength(2);

    // Events are listed in time order: the lock (+20 ms), then the exception.
    await act(async () => {
      fireEvent.click(
        within(controls[1]!).getByRole("button", { name: "Copy JSON" }),
      );
    });
    await act(async () => {
      fireEvent.click(
        within(controls[0]!).getByRole("button", { name: "Copy JSON" }),
      );
    });

    expect(copied(0)).toEqual({
      "exception.escaped": true,
      "exception.message": "could not serialize access",
      "exception.type": "SerializationError",
    });
    expect(copied(1)).toEqual({ "lock.wait_ms": 18 });
  });

  test("a link's attributes copy as JSON", async () => {
    backend.details = {
      update: {
        attributes: {},
        events: [],
        links: [
          { traceId: TRACE_ID, spanId: "auth" },
          {
            traceId: "0af7651916cd43dd8448eb211c80319c",
            spanId: "b7ad6b7169203331",
            attributes: { "link.reason": "retry", "link.attempt": 2 },
          },
        ],
      },
    };
    await renderTrace();
    await openSpan("update");
    await waitFor(() => {
      expect(screen.getByTestId("span-panel-tab-links")).toHaveTextContent("2");
    });
    fireEvent.click(screen.getByTestId("span-panel-tab-links"));

    // Only the link that has attributes offers a copy.
    const controls: Array<HTMLElement> = screen.getAllByTestId(
      "span-link-attributes-copy-json",
    );
    expect(controls).toHaveLength(1);

    await act(async () => {
      fireEvent.click(
        within(controls[0]!).getByRole("button", { name: "Copy JSON" }),
      );
    });

    expect(copied(0)).toEqual({ "link.attempt": 2, "link.reason": "retry" });
  });

  test("a span without attributes offers nothing to copy", async () => {
    backend.details = { update: { attributes: {}, events: [], links: [] } };
    await renderTrace();
    const panel: HTMLElement = await openSpan("update");

    expect(
      await within(panel).findByText("This span has no attributes."),
    ).toBeInTheDocument();
    expect(
      within(panel).queryByTestId("trace-span-attributes-copy-json"),
    ).not.toBeInTheDocument();
  });
});

describe("links into the page", () => {
  test("a span named in the URL is selected, revealed and opened", async () => {
    await renderTrace(["query-5"]);

    await waitFor(() => {
      expect(row("query-5")).toHaveAttribute("aria-selected", "true");
    });
    expect(row("query-5")).toHaveAttribute("data-linked", "true");
    expect(await screen.findByTestId("span-panel-title")).toHaveTextContent(
      "SELECT products WHERE id = $1",
    );
  });

  test("an unknown span id in the URL is ignored", async () => {
    await renderTrace(["  ", "does-not-exist"]);

    expect(screen.queryByTestId("trace-span-panel")).not.toBeInTheDocument();
    expect(rows()).toHaveLength(17);
  });
});

describe("operations", () => {
  test("rolls spans up by operation and flags repeated calls", async () => {
    await renderTrace();

    fireEvent.click(screen.getByTestId("trace-view-operations"));

    const table: HTMLElement = screen.getByTestId("trace-operations");
    const operationRows: Array<HTMLElement> = within(table).getAllByTestId(
      "trace-operation-row",
    );
    expect(operationRows).toHaveLength(6);
    const selects: HTMLElement = operationRows.find(
      (operation: HTMLElement) => {
        return operation.textContent?.includes("SELECT products");
      },
    )!;
    expect(selects).toHaveTextContent("12");
    expect(
      within(selects).getByTestId("trace-operation-repeated"),
    ).toHaveTextContent("×12 from one parent");
    expect(
      within(table).getAllByTestId("trace-operation-repeated"),
    ).toHaveLength(1);
    expect(screen.getByTestId("trace-view-operations")).toHaveTextContent("6");
  });

  test("columns sort", async () => {
    await renderTrace();
    fireEvent.click(screen.getByTestId("trace-view-operations"));

    fireEvent.click(screen.getByRole("button", { name: "Calls" }));
    const first: HTMLElement = within(
      screen.getByTestId("trace-operations"),
    ).getAllByTestId("trace-operation-row")[0]!;
    expect(first).toHaveTextContent("SELECT products");
    expect(screen.getByRole("columnheader", { name: "Calls" })).toHaveAttribute(
      "aria-sort",
      "descending",
    );

    fireEvent.click(screen.getByRole("button", { name: "Calls" }));
    expect(screen.getByRole("columnheader", { name: "Calls" })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
  });

  test("choosing an operation shows its spans in the waterfall and opens the slowest", async () => {
    await renderTrace();
    fireEvent.click(screen.getByTestId("trace-view-operations"));

    const selects: HTMLElement = within(screen.getByTestId("trace-operations"))
      .getAllByTestId("trace-operation-row")
      .find((operation: HTMLElement) => {
        return operation.textContent?.includes("SELECT products");
      })!;
    fireEvent.click(selects);

    expect(screen.getByTestId("trace-waterfall")).toBeInTheDocument();
    expect((screen.getByTestId("trace-search") as HTMLInputElement).value).toBe(
      "SELECT products WHERE id = $1",
    );
    expect(rows()).toHaveLength(14);
    expect(row("query-7")).toHaveAttribute("aria-selected", "true");
  });
});

/*
 * "Fix performance with AI" shows only on a trace worth fixing. The page
 * asks the server (POST /ai-investigation/performance-fix-suggestion), which
 * runs the span-tree analysis with the spans' attributes and the same gates
 * the create route enforces, and draws exactly what it answers: the finding
 * in plain words with the fix (Act), a quiet link to connect a repository
 * (SetUp), a link to the fix already on its way (InProgress) - or nothing
 * at all (None).
 */
const SUGGESTION_PATH: string = "/ai-investigation/performance-fix-suggestion";
const CREATE_PATH: string = "/ai-investigation/create-performance-fix-task";
const RUN_ID: string = "70000000-0000-4000-8000-000000000009";

function nPlusOneFinding(overrides: JSONObject = {}): JSONObject {
  return {
    findingType: "NPlusOneQuery",
    headline: 'N+1: 12x "SELECT products"',
    evidence: "12 sibling spans ...",
    spanCount: 12,
    combinedDurationMs: 840,
    traceDurationMs: 1600,
    percentOfTrace: 52.5,
    normalizedSpanName: "SELECT products WHERE id = {n}",
    parentSpanName: "OrderService.validateCart",
    normalizedDbStatement: "SELECT * FROM products WHERE id = ?",
    dbSystem: "postgresql",
    implicatedSpans: [
      {
        spanId: "query-0",
        name: "SELECT products WHERE id = $1",
        durationMs: 70,
      },
      {
        spanId: "query-1",
        name: "SELECT products WHERE id = $1",
        durationMs: 70,
      },
    ],
    ...overrides,
  };
}

function answerSuggestion(
  suggestion: JSONObject | Error,
  onCreate?: () => Promise<unknown>,
  /*
   * What the suggestion route answers once a click was refused: the
   * server's offer as it stands after the refusal.
   */
  afterRefusal?: JSONObject,
): void {
  postMock.mockImplementation(async (args: PostArgs) => {
    const url: string = args.url.toString();
    if (url.includes(SUGGESTION_PATH)) {
      if (suggestion instanceof Error) {
        throw suggestion;
      }
      const isAfterRefusal: boolean = postsTo(CREATE_PATH).length > 0;
      return new HTTPResponse(
        200,
        isAfterRefusal && afterRefusal ? afterRefusal : suggestion,
        {},
      );
    }
    if (url.includes(CREATE_PATH)) {
      if (onCreate) {
        return onCreate();
      }
      return new HTTPResponse(200, { aiRunId: RUN_ID }, {});
    }
    return new HTTPResponse(200, { sampleCount: 0, items: [] }, {});
  });
}

async function suggestionStrip(): Promise<HTMLElement> {
  return screen.findByTestId("trace-performance-suggestion");
}

describe("performance fix with AI", () => {
  afterEach(() => {
    mockCurrentProject = null;
  });

  test("asks the server what to offer for this trace when the page loads", async () => {
    answerSuggestion({ offer: "None", finding: null });
    await renderTrace();

    await waitFor(() => {
      expect(postsTo(SUGGESTION_PATH)).toHaveLength(1);
    });
    expect(postsTo(SUGGESTION_PATH)[0]!.data).toEqual({ traceId: TRACE_ID });
  });

  test("a trace with nothing worth fixing shows nothing: no button, no note", async () => {
    answerSuggestion({ offer: "None", finding: null });
    await renderTrace();

    await waitFor(() => {
      expect(postsTo(SUGGESTION_PATH)).toHaveLength(1);
    });
    expect(
      screen.queryByTestId("trace-performance-suggestion"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("trace-fix-performance"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Fix performance with AI"),
    ).not.toBeInTheDocument();
  });

  test("a trace worth fixing names what was found, what it costs, and offers the fix", async () => {
    answerSuggestion({
      offer: "Act",
      finding: nPlusOneFinding(),
      findingCount: 1,
    });
    await renderTrace();

    const strip: HTMLElement = await suggestionStrip();

    expect(strip).toHaveAttribute("data-offer", "Act");
    expect(
      within(strip).getByTestId("trace-performance-finding"),
    ).toHaveTextContent(
      "The same database query ran 12 times in OrderService.validateCart",
    );
    expect(
      within(strip).getByTestId("trace-performance-query"),
    ).toHaveTextContent("SELECT * FROM products WHERE id = ?");
    expect(
      within(strip).getByTestId("trace-performance-detail"),
    ).toHaveTextContent("Together they take 840 ms of this 1.6 s request.");
    expect(
      within(strip).getByTestId("trace-fix-performance"),
    ).toHaveTextContent("Fix performance with AI");
    expect(
      within(strip).getByTestId("trace-fix-performance"),
    ).not.toBeDisabled();
    // The header's own actions no longer carry the AI button.
    expect(
      within(screen.getByTestId("trace-header")).getAllByTestId(
        "trace-fix-performance",
      ),
    ).toHaveLength(1);
  });

  test("calls one after another that are not database work are named by their operation", async () => {
    answerSuggestion({
      offer: "Act",
      finding: nPlusOneFinding({
        findingType: "SequentialSiblings",
        spanCount: 4,
        combinedDurationMs: 600,
        traceDurationMs: 900,
        percentOfTrace: 66.7,
        normalizedSpanName: "GET /inventory/{n}",
        parentSpanName: "reserve stock",
        normalizedDbStatement: undefined,
        dbSystem: undefined,
        implicatedSpans: [
          { spanId: "reserve", name: "GET /inventory/41", durationMs: 150 },
          { spanId: "update", name: "GET /inventory/42", durationMs: 150 },
        ],
      }),
    });
    await renderTrace();

    const strip: HTMLElement = await suggestionStrip();

    expect(
      within(strip).getByTestId("trace-performance-finding"),
    ).toHaveTextContent(
      "4 calls to GET /inventory/{n} ran one after another in reserve stock",
    );
    expect(within(strip).queryByTestId("trace-performance-query")).toBeNull();
    expect(
      within(strip).getByTestId("trace-performance-detail"),
    ).toHaveTextContent(
      "Together they take 600 ms of this 900 ms request, and they could run at the same time.",
    );
  });

  test("clicking the fix creates the task for this trace and links to it", async () => {
    answerSuggestion({ offer: "Act", finding: nPlusOneFinding() });
    await renderTrace();
    const strip: HTMLElement = await suggestionStrip();

    fireEvent.click(within(strip).getByTestId("trace-fix-performance"));

    expect(
      await within(strip).findByTestId("trace-fix-performance-progress"),
    ).toHaveTextContent("OneUptime AI is working on a fix. View task progress");
    expect(postsTo(CREATE_PATH)).toHaveLength(1);
    expect(postsTo(CREATE_PATH)[0]!.data).toEqual({ traceId: TRACE_ID });
    expect(
      within(strip)
        .getByText("View task progress")
        .closest("a")!
        .getAttribute("href"),
    ).toContain(RUN_ID);
    // One fix per click: the button gives way to the link.
    expect(within(strip).queryByTestId("trace-fix-performance")).toBeNull();
  });

  test("a refusal is shown beside the finding, and the fix can be tried again", async () => {
    answerSuggestion({ offer: "Act", finding: nPlusOneFinding() }, async () => {
      throw new HTTPErrorResponse(
        400,
        {
          message:
            "No connected repository exists for this project, so the agent has nowhere to open the performance-fix pull request. Connect one in Code.",
        },
        {},
      );
    });
    await renderTrace();
    const strip: HTMLElement = await suggestionStrip();

    fireEvent.click(within(strip).getByTestId("trace-fix-performance"));

    expect(
      await within(strip).findByTestId("trace-fix-performance-error"),
    ).toHaveTextContent(
      "Could not start the fix: No connected repository exists for this project",
    );
    expect(
      within(strip).getByTestId("trace-fix-performance"),
    ).not.toBeDisabled();
    // The refusal asked again what the server offers: still the fix.
    expect(postsTo(SUGGESTION_PATH)).toHaveLength(2);
  });

  test("refused because someone else's fix is already on its way: links to it, no error", async () => {
    answerSuggestion(
      { offer: "Act", finding: nPlusOneFinding() },
      async () => {
        throw new HTTPErrorResponse(
          400,
          {
            message:
              "A performance fix task is already queued or running for this trace. Track its progress in Code.",
          },
          {},
        );
      },
      { offer: "InProgress", finding: nPlusOneFinding(), aiRunId: RUN_ID },
    );
    await renderTrace();
    const strip: HTMLElement = await suggestionStrip();

    fireEvent.click(within(strip).getByTestId("trace-fix-performance"));

    expect(
      await within(strip).findByTestId("trace-fix-performance-progress"),
    ).toHaveTextContent("OneUptime AI is working on a fix. View task progress");
    expect(strip).toHaveAttribute("data-offer", "InProgress");
    expect(
      within(strip)
        .getByText("View task progress")
        .closest("a")!
        .getAttribute("href"),
    ).toContain(RUN_ID);
    expect(
      within(strip).queryByTestId("trace-fix-performance-error"),
    ).toBeNull();
    expect(within(strip).queryByTestId("trace-fix-performance")).toBeNull();
  });

  test("refused because a fix for the trace finished meanwhile: says how it came out, with a link to it - no error", async () => {
    answerSuggestion(
      { offer: "Act", finding: nPlusOneFinding() },
      async () => {
        throw new HTTPErrorResponse(
          400,
          {
            message:
              "OneUptime AI already worked on a fix for this trace. Open its task in Code to see how it came out, or to take it further.",
          },
          {},
        );
      },
      {
        offer: "Done",
        finding: nPlusOneFinding(),
        fixOutcome: "Fixed",
        aiRunId: RUN_ID,
      },
    );
    await renderTrace();
    const strip: HTMLElement = await suggestionStrip();

    fireEvent.click(within(strip).getByTestId("trace-fix-performance"));

    expect(
      await within(strip).findByTestId("trace-fix-performance-done"),
    ).toHaveTextContent(
      "OneUptime AI already opened a pull request that fixes this. View the task",
    );
    expect(strip).toHaveAttribute("data-offer", "Done");
    expect(
      within(strip)
        .getByTestId("trace-fix-performance-done-link")
        .closest("a")!
        .getAttribute("href"),
    ).toContain(RUN_ID);
    expect(
      within(strip).queryByTestId("trace-fix-performance-error"),
    ).toBeNull();
    expect(within(strip).queryByTestId("trace-fix-performance")).toBeNull();
  });

  test("refused because Code's gate now says no Runner is online: Code's words take the button's place - no error", async () => {
    answerSuggestion(
      { offer: "Act", finding: nPlusOneFinding() },
      async () => {
        throw new HTTPErrorResponse(
          400,
          {
            message:
              "No global Runner is online to work in this repository. Pick one of your Runners for it in the repository's settings in Code, or try again once the global Runner is back.",
          },
          {},
        );
      },
      {
        offer: "SetUp",
        finding: nPlusOneFinding(),
        blocker: {
          type: "NoAgent",
          message:
            "No global Runner is online to work in this repository. Pick one of your Runners for it in the repository's settings in Code, or try again once the global Runner is back.",
          repositoryId: "50000000-0000-4000-8000-000000000005",
        },
      },
    );
    await renderTrace();
    const strip: HTMLElement = await suggestionStrip();

    fireEvent.click(within(strip).getByTestId("trace-fix-performance"));

    const notice: HTMLElement =
      await within(strip).findByTestId("code-blocker");
    expect(notice).toHaveAttribute("data-blocker", "NoAgent");
    expect(notice).toHaveTextContent(
      "No global Runner is online to work in this repository.",
    );
    expect(strip).toHaveAttribute("data-offer", "SetUp");
    expect(
      within(strip).queryByTestId("trace-fix-performance-connect"),
    ).toBeNull();
    expect(
      within(strip).queryByTestId("trace-fix-performance-error"),
    ).toBeNull();
    expect(within(strip).queryByTestId("trace-fix-performance")).toBeNull();
  });

  test("refused because the repository was disconnected: the quiet link to connect a repository takes the button's place", async () => {
    answerSuggestion(
      { offer: "Act", finding: nPlusOneFinding() },
      async () => {
        throw new HTTPErrorResponse(
          400,
          {
            message:
              "No connected repository exists for this project, so the agent has nowhere to open the performance-fix pull request. Connect one in Code.",
          },
          {},
        );
      },
      { offer: "SetUp", finding: nPlusOneFinding() },
    );
    await renderTrace();
    const strip: HTMLElement = await suggestionStrip();

    fireEvent.click(within(strip).getByTestId("trace-fix-performance"));

    expect(
      await within(strip).findByTestId("trace-fix-performance-connect"),
    ).toHaveTextContent("Connect a repository to fix this with AI");
    expect(strip).toHaveAttribute("data-offer", "SetUp");
    // Said in the strip's own words, not the server's.
    expect(
      within(strip).queryByTestId("trace-fix-performance-error"),
    ).toBeNull();
    expect(within(strip).queryByTestId("trace-fix-performance")).toBeNull();
  });

  test("refused, and the offer cannot be read again: the reason stays beside the fix", async () => {
    let suggestionReads: number = 0;
    postMock.mockImplementation(async (args: PostArgs) => {
      const url: string = args.url.toString();
      if (url.includes(SUGGESTION_PATH)) {
        suggestionReads += 1;
        if (suggestionReads > 1) {
          throw new Error("network down");
        }
        return new HTTPResponse(
          200,
          { offer: "Act", finding: nPlusOneFinding() },
          {},
        );
      }
      if (url.includes(CREATE_PATH)) {
        throw new HTTPErrorResponse(
          400,
          { message: "This project used today's AI fix runs." },
          {},
        );
      }
      return new HTTPResponse(200, { sampleCount: 0, items: [] }, {});
    });
    await renderTrace();
    const strip: HTMLElement = await suggestionStrip();

    fireEvent.click(within(strip).getByTestId("trace-fix-performance"));

    expect(
      await within(strip).findByTestId("trace-fix-performance-error"),
    ).toHaveTextContent(
      "Could not start the fix: This project used today's AI fix runs.",
    );
    expect(strip).toHaveAttribute("data-offer", "Act");
    expect(
      within(strip).getByTestId("trace-fix-performance"),
    ).not.toBeDisabled();
  });

  test("no repository connected: a quiet link to connect a repository instead of the fix", async () => {
    answerSuggestion({ offer: "SetUp", finding: nPlusOneFinding() });
    await renderTrace();
    const strip: HTMLElement = await suggestionStrip();

    expect(strip).toHaveAttribute("data-offer", "SetUp");
    expect(
      within(strip).getByTestId("trace-performance-finding"),
    ).toHaveTextContent("The same database query ran 12 times");
    const connect: HTMLElement = within(strip).getByTestId(
      "trace-fix-performance-connect",
    );
    expect(connect).toHaveTextContent(
      "Connect a repository to fix this with AI",
    );
    expect(connect.closest("a")!.getAttribute("href")).toContain(
      `/dashboard/${PROJECT_ID}/code`,
    );
    expect(within(strip).queryByTestId("trace-fix-performance")).toBeNull();
  });

  test("a fix already on its way: links to it instead of offering another", async () => {
    answerSuggestion({
      offer: "InProgress",
      finding: nPlusOneFinding(),
      aiRunId: RUN_ID,
    });
    await renderTrace();
    const strip: HTMLElement = await suggestionStrip();

    expect(
      within(strip).getByTestId("trace-fix-performance-progress"),
    ).toHaveTextContent("OneUptime AI is working on a fix.");
    expect(
      within(strip)
        .getByText("View task progress")
        .closest("a")!
        .getAttribute("href"),
    ).toContain(RUN_ID);
    expect(within(strip).queryByTestId("trace-fix-performance")).toBeNull();
  });

  test("a fix already done: says how it came out and links to its task, instead of offering another", async () => {
    answerSuggestion({
      offer: "Done",
      finding: nPlusOneFinding(),
      fixOutcome: "NothingToChange",
      aiRunId: RUN_ID,
    });
    await renderTrace();
    const strip: HTMLElement = await suggestionStrip();

    expect(strip).toHaveAttribute("data-offer", "Done");
    // What was found is still said: it is what the fix was about.
    expect(
      within(strip).getByTestId("trace-performance-finding"),
    ).toHaveTextContent("The same database query ran 12 times");
    expect(
      within(strip).getByTestId("trace-fix-performance-done"),
    ).toHaveTextContent(
      "OneUptime AI already looked at this and found nothing to change.",
    );
    expect(
      within(strip)
        .getByText("View the task")
        .closest("a")!
        .getAttribute("href"),
    ).toContain(RUN_ID);
    expect(within(strip).queryByTestId("trace-fix-performance")).toBeNull();
    expect(
      within(strip).queryByTestId("trace-fix-performance-progress"),
    ).toBeNull();
  });

  test("Code's gate says the plan does not include AI in Code: its sentence instead of the fix", async () => {
    answerSuggestion({
      offer: "SetUp",
      finding: nPlusOneFinding(),
      blocker: {
        type: "PlanRequired",
        message:
          "AI in Code needs the Growth plan or above. Upgrade the project's plan in Project Settings > Billing and Invoices > Billing.",
      },
    });
    await renderTrace();
    const strip: HTMLElement = await suggestionStrip();

    expect(within(strip).getByTestId("code-blocker")).toHaveTextContent(
      "AI in Code needs the Growth plan or above.",
    );
    expect(within(strip).queryByTestId("trace-fix-performance")).toBeNull();
    expect(
      within(strip).queryByTestId("trace-fix-performance-connect"),
    ).toBeNull();
  });

  test("AI switched off for the project: the server is not even asked, and nothing is drawn", async () => {
    mockCurrentProject = { enableAi: false };
    answerSuggestion({ offer: "Act", finding: nPlusOneFinding() });
    await renderTrace();

    await waitFor(() => {
      expect(
        postsTo("/telemetry/profiles/trace-presence").length,
      ).toBeGreaterThan(0);
    });
    expect(postsTo(SUGGESTION_PATH)).toHaveLength(0);
    expect(
      screen.queryByTestId("trace-performance-suggestion"),
    ).not.toBeInTheDocument();
  });

  test("a failed suggestion read shows nothing and leaves the page working", async () => {
    answerSuggestion(new Error("network down"));
    await renderTrace();

    await waitFor(() => {
      expect(postsTo(SUGGESTION_PATH)).toHaveLength(1);
    });
    expect(
      screen.queryByTestId("trace-performance-suggestion"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("trace-title")).toHaveTextContent(
      "POST /api/v1/checkout",
    );
  });

  test.each([
    ["an offer with no finding", { offer: "Act" }],
    [
      "a finding too small to fix",
      { offer: "Act", finding: nPlusOneFinding({ combinedDurationMs: 12 }) },
    ],
    [
      "in progress with no run",
      { offer: "InProgress", finding: nPlusOneFinding() },
    ],
    [
      "done with no run",
      { offer: "Done", finding: nPlusOneFinding(), fixOutcome: "Fixed" },
    ],
    [
      "done that does not say how it came out",
      { offer: "Done", finding: nPlusOneFinding(), aiRunId: "run-9" },
    ],
    [
      "a set-up step whose blocker this build cannot draw",
      {
        offer: "SetUp",
        finding: nPlusOneFinding(),
        blocker: { type: "Eclipse", message: "Dark." },
      },
    ],
    [
      "an offer this build does not know",
      { offer: "Later", finding: nPlusOneFinding() },
    ],
  ])("%s shows nothing", async (_label: string, answer: JSONObject) => {
    answerSuggestion(answer);
    await renderTrace();

    await waitFor(() => {
      expect(postsTo(SUGGESTION_PATH)).toHaveLength(1);
    });
    expect(
      screen.queryByTestId("trace-performance-suggestion"),
    ).not.toBeInTheDocument();
  });

  /*
   * "Show them" puts the finding's spans in view: their shared name as the
   * search, nothing else hiding them, the waterfall scrolled to. The first
   * is opened where the span panel sits beside the waterfall (xl); on a
   * narrower screen the panel is a sheet over the page, so spans the search
   * marks are left in view instead of covered.
   */
  describe("'Show them'", () => {
    const XL_QUERY: string = "(min-width: 1280px)";
    let restoreWidth: () => void = () => {};
    let scrollIntoView: Mock<(options?: ScrollIntoViewOptions) => void>;

    function screenIs(width: "wide" | "narrow"): void {
      const window_: { matchMedia?: unknown } = window as unknown as {
        matchMedia?: unknown;
      };
      const original: unknown = window_.matchMedia;
      window_.matchMedia = (query: string): MediaQueryList => {
        return {
          matches: query === XL_QUERY && width === "wide",
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => {
            return false;
          },
        } as MediaQueryList;
      };
      restoreWidth = (): void => {
        window_.matchMedia = original;
      };
    }

    beforeEach(() => {
      scrollIntoView = jest.fn<(options?: ScrollIntoViewOptions) => void>();
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
        configurable: true,
        writable: true,
        value: scrollIntoView,
      });
    });

    afterEach(() => {
      restoreWidth();
      restoreWidth = () => {};
      delete (HTMLElement.prototype as unknown as { scrollIntoView?: unknown })
        .scrollIntoView;
    });

    function scrolledTo(): Array<unknown> {
      return scrollIntoView.mock.contexts;
    }

    test("on a wide screen: marks them all, opens the first beside the waterfall and scrolls to it", async () => {
      screenIs("wide");
      answerSuggestion({ offer: "Act", finding: nPlusOneFinding() });
      await renderTrace();
      const strip: HTMLElement = await suggestionStrip();

      fireEvent.click(
        within(strip).getByTestId("trace-performance-show-spans"),
      );

      expect(
        within(strip).getByTestId("trace-performance-show-spans"),
      ).toHaveTextContent("Show them");
      expect(
        (screen.getByTestId("trace-search") as HTMLInputElement).value,
      ).toBe("SELECT products WHERE id = $1");
      await waitFor(() => {
        expect(row("query-0")).toHaveAttribute("aria-selected", "true");
      });
      expect(screen.getByTestId("trace-span-panel")).toBeInTheDocument();
      expect(scrolledTo()).toEqual([screen.getByTestId("trace-spans")]);
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "start",
      });
    });

    test("on a narrower screen: marks them all and scrolls to them, with no sheet over them", async () => {
      screenIs("narrow");
      answerSuggestion({ offer: "Act", finding: nPlusOneFinding() });
      await renderTrace();
      const strip: HTMLElement = await suggestionStrip();

      fireEvent.click(
        within(strip).getByTestId("trace-performance-show-spans"),
      );

      expect(
        (screen.getByTestId("trace-search") as HTMLInputElement).value,
      ).toBe("SELECT products WHERE id = $1");
      expect(screen.getByTestId("trace-search-count")).toHaveTextContent(
        "12 matches",
      );
      expect(scrolledTo()).toEqual([screen.getByTestId("trace-spans")]);
      expect(row("query-0")).toHaveAttribute("aria-selected", "false");
      expect(screen.queryByTestId("trace-span-panel")).not.toBeInTheDocument();
    });

    test("a single slow span is opened on any screen ('Show it'), and a search typed before is cleared", async () => {
      screenIs("narrow");
      answerSuggestion({
        offer: "Act",
        finding: nPlusOneFinding({
          findingType: "DominantSpan",
          spanCount: 1,
          combinedDurationMs: 900,
          percentOfTrace: 90,
          implicatedSpans: [
            { spanId: "update", name: "UPDATE stock", durationMs: 900 },
          ],
        }),
      });
      await renderTrace();
      const strip: HTMLElement = await suggestionStrip();
      fireEvent.change(screen.getByTestId("trace-search"), {
        target: { value: "auth" },
      });

      fireEvent.click(
        within(strip).getByTestId("trace-performance-show-spans"),
      );

      expect(
        within(strip).getByTestId("trace-performance-show-spans"),
      ).toHaveTextContent("Show it");
      expect(
        (screen.getByTestId("trace-search") as HTMLInputElement).value,
      ).toBe("");
      await waitFor(() => {
        expect(row("update")).toHaveAttribute("aria-selected", "true");
      });
      expect(scrolledTo()).toEqual([screen.getByTestId("trace-spans")]);
    });

    test("lets go of the filters that would hide them: errors only and a service", async () => {
      screenIs("wide");
      answerSuggestion({ offer: "Act", finding: nPlusOneFinding() });
      await renderTrace();
      const strip: HTMLElement = await suggestionStrip();
      fireEvent.click(screen.getByTestId("trace-errors-only"));
      fireEvent.click(screen.getAllByTestId("trace-service-chip")[1]!);
      expect(row("query-0")).toBeNull();

      fireEvent.click(
        within(strip).getByTestId("trace-performance-show-spans"),
      );

      expect(screen.getByTestId("trace-errors-only")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      for (const chip of screen.getAllByTestId("trace-service-chip")) {
        expect(chip).toHaveAttribute("aria-pressed", "false");
      }
      await waitFor(() => {
        expect(row("query-0")).toHaveAttribute("aria-selected", "true");
      });
      expect(row("query-11")).not.toBeNull();
    });
  });

  test("no 'Show them' when none of the finding's spans is loaded", async () => {
    answerSuggestion({
      offer: "Act",
      finding: nPlusOneFinding({
        implicatedSpans: [
          { spanId: "not-loaded", name: "SELECT 1", durationMs: 70 },
        ],
      }),
    });
    await renderTrace();
    const strip: HTMLElement = await suggestionStrip();

    expect(
      within(strip).queryByTestId("trace-performance-show-spans"),
    ).toBeNull();
  });

  test("Refresh asks again, so the offer follows the trace", async () => {
    answerSuggestion({ offer: "None", finding: null });
    await renderTrace();
    await waitFor(() => {
      expect(postsTo(SUGGESTION_PATH)).toHaveLength(1);
    });

    answerSuggestion({ offer: "Act", finding: nPlusOneFinding() });
    fireEvent.click(screen.getByTestId("trace-refresh"));

    expect(await suggestionStrip()).toHaveAttribute("data-offer", "Act");
    expect(postsTo(SUGGESTION_PATH)).toHaveLength(2);
  });
});

/*
 * The permission snapshot the page reads, as the response header carries
 * it: the project's rows, allow and block. Every gate on the page reads it
 * (PermissionUtil.getAllPermissions goes through getProjectPermissions), so
 * the Metrics tab and the rest of the page agree. No rows at all is a
 * snapshot that has not landed yet.
 */
interface HeldPermissions {
  set: (allowed: Array<Permission>, blocked?: Array<Permission>) => void;
  restore: () => void;
}

function snapshotOf(
  allowed: Array<Permission>,
  blocked: Array<Permission>,
): UserTenantAccessPermission | null {
  if (allowed.length === 0 && blocked.length === 0) {
    return null;
  }

  const row: (
    isBlockPermission: boolean,
  ) => (permission: Permission) => UserPermission = (
    isBlockPermission: boolean,
  ): ((permission: Permission) => UserPermission) => {
    return (permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: isBlockPermission,
      };
    };
  };

  return {
    _type: "UserTenantAccessPermission",
    projectId: ObjectID.generate(),
    permissions: [...allowed.map(row(false)), ...blocked.map(row(true))],
  };
}

function holdPermissions(
  allowed: Array<Permission>,
  blocked: Array<Permission> = [],
): HeldPermissions {
  let current: UserTenantAccessPermission | null = snapshotOf(allowed, blocked);

  const project: SpyInstance<typeof PermissionUtil.getProjectPermissions> = jest
    .spyOn(PermissionUtil, "getProjectPermissions")
    .mockImplementation((): UserTenantAccessPermission | null => {
      return current;
    });
  const global: SpyInstance<typeof PermissionUtil.getGlobalPermissions> = jest
    .spyOn(PermissionUtil, "getGlobalPermissions")
    .mockReturnValue(null);

  return {
    set: (
      nextAllowed: Array<Permission>,
      nextBlocked: Array<Permission> = [],
    ): void => {
      current = snapshotOf(nextAllowed, nextBlocked);
    },
    restore: (): void => {
      project.mockRestore();
      global.mockRestore();
    },
  };
}

describe("related signals", () => {
  test("logs and exceptions are scoped to this trace, with an exception count", async () => {
    await renderTrace();

    expect(logsViewerProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ traceIds: [TRACE_ID], enableRealtime: false }),
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("trace-signal-tab-exceptions"),
      ).toHaveTextContent("2");
    });
    expect(countMock.mock.calls[0]![0]).toBe(ExceptionInstance);
    expect(countMock.mock.calls[0]![1]).toMatchObject({ traceId: TRACE_ID });

    fireEvent.click(screen.getByTestId("trace-signal-tab-exceptions"));
    expect(exceptionTableProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: { traceId: TRACE_ID },
        disableUrlState: true,
      }),
    );
  });

  test("metrics load on first open", async () => {
    postMock.mockImplementation(async (args: PostArgs) => {
      if (args.url.toString().includes("/telemetry/metrics/for-trace")) {
        return new HTTPResponse(
          200,
          {
            items: [
              {
                name: "http.server.duration",
                time: new Date(EPOCH_MS).toISOString(),
                value: 1000,
                spanId: "root",
                serviceId: GATEWAY,
                attributes: {},
              },
              {
                name: "db.client.connections.usage",
                time: new Date(EPOCH_MS).toISOString(),
                value: 4,
                spanId: "update",
                serviceId: INVENTORY,
                attributes: {},
              },
            ],
          },
          {},
        );
      }
      return new HTTPResponse(200, { sampleCount: 0 }, {});
    });
    await renderTrace();

    expect(postsTo("/telemetry/metrics/for-trace")).toHaveLength(0);
    fireEvent.click(screen.getByTestId("trace-signal-tab-metrics"));

    expect(await screen.findByText("http.server.duration")).toBeInTheDocument();
    expect(postsTo("/telemetry/metrics/for-trace")[0]!.data).toEqual({
      traceId: TRACE_ID,
      limit: 500,
    });
    expect(screen.getByTestId("trace-signal-tab-metrics")).toHaveTextContent(
      "2",
    );
  });

  /*
   * Metrics are read with the metric permission, not the trace one. Somebody
   * who may read this trace but not metrics gets no Metrics tab, rather than
   * a tab whose request the server refuses.
   */
  test.each([
    [[Permission.ReadTelemetryServiceTraces], []],
    /*
     * Nor does the metric permission held only as a block: a block row is
     * never a grant.
     */
    [
      [Permission.ReadTelemetryServiceTraces],
      [Permission.ReadTelemetryServiceMetrics],
    ],
    /*
     * A block with no labels takes the permission away, whatever another
     * team allows - the route reads it so.
     */
    [
      [Permission.ReadTelemetryServiceMetrics],
      [Permission.ReadTelemetryServiceMetrics],
    ],
    // A blocked wildcard grants nothing.
    [
      [
        Permission.ReadTelemetryServiceTraces,
        Permission.ReadAllOperationalResources,
      ],
      [Permission.ReadAllOperationalResources],
    ],
  ])(
    "the metrics tab is left out for %j (blocked: %j), which reads the trace but not metrics",
    async (allowed: Array<Permission>, blocked: Array<Permission>) => {
      const permissions: HeldPermissions = holdPermissions(allowed, blocked);

      try {
        await renderTrace();

        expect(
          screen.queryByTestId("trace-signal-tab-metrics"),
        ).not.toBeInTheDocument();
        expect(screen.getByTestId("trace-signal-tab-logs")).toBeInTheDocument();
        expect(postsTo("/telemetry/metrics/for-trace")).toHaveLength(0);
      } finally {
        permissions.restore();
      }
    },
  );

  test("a master admin gets the metrics tab whatever the project grants", async () => {
    const permissions: HeldPermissions = holdPermissions([
      Permission.ReadTelemetryServiceTraces,
    ]);
    const masterAdmin: SpyInstance<typeof User.isMasterAdmin> = jest
      .spyOn(User, "isMasterAdmin")
      .mockReturnValue(true);

    try {
      await renderTrace();

      expect(
        screen.getByTestId("trace-signal-tab-metrics"),
      ).toBeInTheDocument();
    } finally {
      masterAdmin.mockRestore();
      permissions.restore();
    }
  });

  test.each([
    [[Permission.ReadTelemetryServiceMetrics], []],
    [[Permission.TelemetryViewer], []],
    /*
     * Metrics are an operational resource: the metrics route accepts "Read
     * All Operational Resources" as the CRUD API does, so the tab opens too.
     */
    [
      [
        Permission.ReadTelemetryServiceTraces,
        Permission.ReadAllOperationalResources,
      ],
      [],
    ],
    /*
     * A block on another permission the route does not ask for changes
     * nothing.
     */
    [[Permission.ReadTelemetryServiceMetrics], [Permission.DeleteProject]],
    [[], []],
  ])(
    "the metrics tab is there for %j (blocked: %j; an empty snapshot is still loading)",
    async (allowed: Array<Permission>, blocked: Array<Permission>) => {
      const permissions: HeldPermissions = holdPermissions(allowed, blocked);

      try {
        await renderTrace();

        expect(
          screen.getByTestId("trace-signal-tab-metrics"),
        ).toBeInTheDocument();
      } finally {
        permissions.restore();
      }
    },
  );

  test("a Metrics tab still on screen after the snapshot changed sends nothing when clicked", async () => {
    const permissions: HeldPermissions = holdPermissions([]);

    try {
      await renderTrace();
      expect(
        screen.getByTestId("trace-signal-tab-metrics"),
      ).toBeInTheDocument();

      // The snapshot lands without re-rendering the card: the tab is stale.
      permissions.set([Permission.ReadTelemetryServiceTraces]);
      fireEvent.click(screen.getByTestId("trace-signal-tab-metrics"));

      await waitFor(() => {
        expect(screen.getByTestId("trace-signal-tab-logs")).toHaveAttribute(
          "aria-selected",
          "true",
        );
      });
      expect(
        screen.queryByTestId("trace-signal-tab-metrics"),
      ).not.toBeInTheDocument();
      expect(postsTo("/telemetry/metrics/for-trace")).toHaveLength(0);
    } finally {
      permissions.restore();
    }
  });

  test("metrics opened while the snapshot loaded fall back to logs once it shows they may not be read", async () => {
    const permissions: HeldPermissions = holdPermissions([]);
    let releaseMetrics: () => void = () => {};
    const metricsHeld: Promise<void> = new Promise<void>(
      (resolve: () => void) => {
        releaseMetrics = resolve;
      },
    );

    postMock.mockImplementation(async (args: PostArgs) => {
      if (args.url.toString().includes("/telemetry/metrics/for-trace")) {
        await metricsHeld;
        return new HTTPResponse(200, { items: [] }, {});
      }
      return new HTTPResponse(200, { sampleCount: 0 }, {});
    });

    try {
      await renderTrace();

      fireEvent.click(screen.getByTestId("trace-signal-tab-metrics"));
      expect(screen.getByTestId("trace-metrics")).toBeInTheDocument();

      // The snapshot arrives: this trace's reader may not read metrics.
      permissions.set([Permission.ReadTelemetryServiceTraces]);
      releaseMetrics();

      await waitFor(() => {
        expect(
          screen.queryByTestId("trace-signal-tab-metrics"),
        ).not.toBeInTheDocument();
      });
      expect(screen.queryByTestId("trace-metrics")).not.toBeInTheDocument();
      expect(screen.getByTestId("trace-signal-tab-logs")).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(logsViewerProps).toHaveBeenLastCalledWith(
        expect.objectContaining({ traceIds: [TRACE_ID] }),
      );
    } finally {
      permissions.restore();
    }
  });

  test("the profile tab only exists when the trace was profiled", async () => {
    postMock.mockImplementation(async (args: PostArgs) => {
      if (args.url.toString().includes("/telemetry/profiles/trace-presence")) {
        return new HTTPResponse(
          200,
          { sampleCount: args.data["spanIds"] ? 0 : 842 },
          {},
        );
      }
      return new HTTPResponse(200, {}, {});
    });
    await renderTrace();

    fireEvent.click(await screen.findByTestId("trace-signal-tab-profile"));

    expect(screen.getByTestId("trace-signal-tab-profile")).toHaveTextContent(
      "842",
    );
    expect(screen.getByTestId("trace-profile")).toHaveTextContent(
      "842 profile samples",
    );
    expect(scopedFlamegraphProps).toHaveBeenLastCalledWith({
      traceId: TRACE_ID,
    });
  });

  test("without profile samples there is no profile tab", async () => {
    await renderTrace();

    await waitFor(() => {
      expect(
        postsTo("/telemetry/profiles/trace-presence").length,
      ).toBeGreaterThan(0);
    });
    expect(
      screen.queryByTestId("trace-signal-tab-profile"),
    ).not.toBeInTheDocument();
  });
});

/*
 * An eBPF (OBI) span carries no trace context into the lines its pod writes,
 * so no log carries its trace's ID. What the pods wrote while the trace ran
 * is read by pod and time instead: the span panel's Logs tab and the related
 * signals' Logs tab both offer it, labelled as not linked by trace ID.
 */
describe("logs from the pods a trace ran in", () => {
  const GATEWAY_POD: string = "0a1b2c3d4e5f6071";
  const INVENTORY_POD: string = "7a2872b83f046399";

  // The gateway and the inventory service ran in pods; checkout did not.
  function podDefinitions(
    pods: { gateway?: string; inventory?: string } = {
      gateway: GATEWAY_POD,
      inventory: INVENTORY_POD,
    },
  ): Array<SpanDefinition> {
    return checkoutDefinitions().map(
      (definition: SpanDefinition): SpanDefinition => {
        if (definition.serviceId === GATEWAY && pods.gateway) {
          return { ...definition, podEntityKey: pods.gateway };
        }
        if (definition.serviceId === INVENTORY && pods.inventory) {
          return { ...definition, podEntityKey: pods.inventory };
        }
        return definition;
      },
    );
  }

  function podLog(
    podEntityKey: string,
    offsetMs: number,
    body: string,
    index: number,
  ): Log {
    return Object.assign(new Log(), {
      _id: new ObjectID(
        `30000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
      ),
      time: new Date(EPOCH_MS + offsetMs),
      timeUnixNano: (EPOCH_MS + offsetMs) * MS,
      severityText: "Information",
      body,
      k8sPodEntityKey: podEntityKey,
    });
  }

  // UPDATE stock ran 150-350 ms into the trace, in the inventory pod.
  function inventoryPodLogs(): Array<Log> {
    return [
      podLog(INVENTORY_POD, 120, "BEGIN", 1),
      podLog(INVENTORY_POD, 160, "UPDATE stock SET count = count - 1", 2),
      podLog(INVENTORY_POD, 345, "COMMIT", 3),
      podLog(INVENTORY_POD, 420, "GET /health", 4),
      podLog(INVENTORY_POD, 700, "outside the window", 5),
      podLog(GATEWAY_POD, 200, "another pod's line", 6),
    ];
  }

  function podReads(): Array<ListArgs> {
    return getListMock.mock.calls
      .map((call: [ListArgs]) => {
        return call[0];
      })
      .filter((args: ListArgs) => {
        return args.modelType === Log && Boolean(args.query["k8sPodEntityKey"]);
      });
  }

  function lastLogsViewerProps(): Props {
    return logsViewerProps.mock.calls[
      logsViewerProps.mock.calls.length - 1
    ]![0];
  }

  test("an eBPF span's Logs tab shows what its pod wrote around it, not linked by trace ID", async () => {
    setBackend({
      traceSpans: podDefinitions().map(makeSpan),
      details: {
        update: {
          attributes: { "resource.k8s.pod.name": "inventory-7d9f-x2kq1" },
          events: [],
          links: [],
          statusMessage: "",
        },
      },
      podLogs: inventoryPodLogs(),
    });
    await renderTrace();

    fireEvent.click(row("update"));
    fireEvent.click(await screen.findByTestId("span-panel-tab-logs"));

    const section: HTMLElement = await screen.findByTestId("span-pod-logs");
    expect(section).toHaveTextContent("No logs carry this span's ID.");
    expect(section).toHaveTextContent(
      "Logs from this pod during this span (not linked by trace ID)",
    );
    expect(
      await within(section).findByText("UPDATE stock SET count = count - 1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("span-pod-logs-before")).getByText("BEGIN"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("span-pod-logs-during")).getByText("COMMIT"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("span-pod-logs-after")).getByText(
        "GET /health",
      ),
    ).toBeInTheDocument();
    expect(within(section).queryByText("outside the window")).toBeNull();
    expect(within(section).queryByText("another pod's line")).toBeNull();
    expect(screen.getByTestId("span-pod-logs-window")).toHaveTextContent(
      "What inventory-7d9f-x2kq1 wrote from 100 ms before this span to 100 ms after it.",
    );
    expect(
      screen.queryByText(/No logs were written inside this span/),
    ).not.toBeInTheDocument();

    const [before, fromStart] = podReads();
    expect(podReads()).toHaveLength(2);
    expect(before!.query["k8sPodEntityKey"]).toBe(INVENTORY_POD);
    expect(String(before!.query["projectId"])).toBe(PROJECT_ID);
    expect(before!.query["time"]).toEqual(
      new InBetween<Date>(new Date(EPOCH_MS + 50), new Date(EPOCH_MS + 150)),
    );
    // The span's end, as makeSpan wrote it in nanoseconds, rounded outwards.
    const spanEndMs: number = Math.ceil(
      ((EPOCH_MS + 150) * MS + 200 * MS) / MS,
    );
    expect(fromStart!.query["time"]).toEqual(
      new InBetween<Date>(new Date(EPOCH_MS + 150), new Date(spanEndMs + 100)),
    );
  });

  test("a span whose logs carry its ID keeps its pod's lines folded below them", async () => {
    setBackend({
      traceSpans: podDefinitions().map(makeSpan),
      logs: [
        Object.assign(new Log(), {
          time: new Date(EPOCH_MS + 160),
          severityText: "WARN",
          body: "retrying UPDATE after serialization failure",
          spanId: "update",
          traceId: TRACE_ID,
        }),
      ],
      podLogs: inventoryPodLogs(),
    });
    await renderTrace();

    fireEvent.click(row("update"));
    fireEvent.click(await screen.findByTestId("span-panel-tab-logs"));

    expect(
      await screen.findByText("retrying UPDATE after serialization failure"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("span-panel-tab-logs")).toHaveTextContent("1");
    expect(
      screen.queryByText("No logs carry this span's ID."),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("span-pod-logs-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(podReads()).toHaveLength(0);

    fireEvent.click(screen.getByTestId("span-pod-logs-toggle"));

    expect(
      await screen.findByText("UPDATE stock SET count = count - 1"),
    ).toBeInTheDocument();
    expect(podReads()).toHaveLength(2);
  });

  test("a trace no log carries opens its Logs tab on what its pods wrote while it ran", async () => {
    setBackend({
      traceSpans: podDefinitions().map(makeSpan),
      linkedLogCount: 0,
      inventoryItems: [
        Object.assign(new InventoryItem(), {
          entityKey: INVENTORY_POD,
          entityType: EntityType.KubernetesPod,
          displayName: "inventory-7d9f-x2kq1",
          identifyingAttributes: {
            "k8s.cluster.name": "prod",
            "k8s.namespace.name": "default",
            "k8s.pod.name": "inventory-7d9f-x2kq1",
          },
        }),
      ],
    });
    await renderTrace();

    await waitFor(() => {
      expect(lastLogsViewerProps()["id"]).toBe("traces-pod-logs-viewer");
    });
    const props: Props = lastLogsViewerProps();
    expect(props["logQuery"]).toEqual({
      entityKeys: new Includes([GATEWAY_POD, INVENTORY_POD]),
      time: new InBetween<Date>(
        new Date(EPOCH_MS - 100),
        new Date(EPOCH_MS + 1100),
      ),
    });
    expect(props["traceIds"]).toBeUndefined();
    expect(props["enableRealtime"]).toBe(false);
    expect(props["noLogsMessage"]).toBe(
      "This trace's pods wrote nothing while it ran.",
    );

    // The pods' Inventory items name them in the viewer's chips.
    await waitFor(() => {
      expect(
        (
          lastLogsViewerProps()["entityKeyDisplays"] as Record<
            string,
            JSONObject
          >
        )[INVENTORY_POD],
      ).toMatchObject({
        displayKey: "Kubernetes Pod",
        displayValue: "inventory-7d9f-x2kq1",
      });
    });
    expect(
      (
        lastLogsViewerProps()["entityKeyDisplays"] as Record<string, JSONObject>
      )[GATEWAY_POD],
    ).toEqual({ displayKey: "Kubernetes Pod", displayValue: GATEWAY_POD });
    const inventoryRead: ListArgs = serviceListMock.mock.calls
      .map((call: [ListArgs]) => {
        return call[0];
      })
      .find((args: ListArgs) => {
        return args.modelType === InventoryItem;
      })!;
    expect(inventoryRead.query["entityKey"]).toEqual(
      new Includes([GATEWAY_POD, INVENTORY_POD]),
    );

    // Whether logs carry the trace was counted over its window, padded.
    const [, countQuery] = countMock.mock.calls.find(
      (call: [unknown, JSONObject]) => {
        return call[0] === Log;
      },
    )!;
    expect(countQuery).toMatchObject({ traceId: TRACE_ID });
    expect(countQuery["time"]).toEqual(
      new InBetween<Date>(
        new Date(EPOCH_MS - 5 * 60 * 1000),
        new Date(EPOCH_MS + 1000 + 5 * 60 * 1000),
      ),
    );

    expect(
      screen.getByTestId("trace-logs-scope-description"),
    ).toHaveTextContent(
      "What this trace's 2 pods wrote from 100 ms before the trace to 100 ms after it, not linked by trace ID. A pod serves many requests at once, so some of these lines may belong to other requests.",
    );
    expect(screen.getByTestId("trace-logs-scope-pods")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("trace-logs-scope-pods")).toHaveTextContent(
      "Same pods, same time",
    );

    fireEvent.click(screen.getByTestId("trace-logs-scope-trace"));

    expect(lastLogsViewerProps()).toMatchObject({
      id: "traces-logs-viewer",
      traceIds: [TRACE_ID],
    });
    expect(
      screen.getByTestId("trace-logs-scope-description"),
    ).toHaveTextContent(
      "Logs that carry this trace's ID, from every service it touched.",
    );
  });

  test("a trace its logs carry opens on them, with its pod one choice away", async () => {
    setBackend({
      traceSpans: podDefinitions({ inventory: INVENTORY_POD }).map(makeSpan),
      linkedLogCount: 3,
    });
    await renderTrace();

    await waitFor(() => {
      expect(screen.getByTestId("trace-logs-scope-trace")).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });
    expect(lastLogsViewerProps()).toMatchObject({
      id: "traces-logs-viewer",
      traceIds: [TRACE_ID],
    });
    expect(screen.getByTestId("trace-logs-scope-pods")).toHaveTextContent(
      "Same pod, same time",
    );

    fireEvent.click(screen.getByTestId("trace-logs-scope-pods"));

    expect(lastLogsViewerProps()).toMatchObject({
      id: "traces-pod-logs-viewer",
      noLogsMessage: "This trace's pod wrote nothing while it ran.",
    });
    expect(
      screen.getByTestId("trace-logs-scope-description"),
    ).toHaveTextContent(
      "What this trace's pod wrote from 100 ms before the trace to 100 ms after it, not linked by trace ID.",
    );
  });

  test("no view reads before the count that picks it has answered", async () => {
    let release: (count: number) => void = () => {};
    countMock.mockImplementation((modelType: unknown) => {
      if (modelType === Log) {
        return new Promise<number>((resolve: (count: number) => void) => {
          release = resolve;
        });
      }
      return Promise.resolve(2);
    });
    setBackend({ traceSpans: podDefinitions().map(makeSpan) });
    await renderTrace();

    await waitFor(() => {
      expect(
        countMock.mock.calls.some((call: [unknown, JSONObject]) => {
          return call[0] === Log;
        }),
      ).toBe(true);
    });
    expect(logsViewerProps).not.toHaveBeenCalled();
    expect(screen.queryByTestId("trace-logs-scope")).not.toBeInTheDocument();

    await act(async () => {
      release(0);
    });

    expect(lastLogsViewerProps()["id"]).toBe("traces-pod-logs-viewer");
    expect(
      logsViewerProps.mock.calls.some((call: [Props]) => {
        return call[0]["id"] === "traces-logs-viewer";
      }),
    ).toBe(false);
  });

  test("a count that fails keeps the logs linked by the trace's ID", async () => {
    setBackend({
      traceSpans: podDefinitions().map(makeSpan),
      linkedLogCount: "Logs could not be counted.",
    });
    await renderTrace();

    await waitFor(() => {
      expect(lastLogsViewerProps()["id"]).toBe("traces-logs-viewer");
    });
    expect(screen.getByTestId("trace-logs-scope-trace")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("a trace outside Kubernetes offers no choice and counts nothing", async () => {
    await renderTrace();

    expect(lastLogsViewerProps()).toMatchObject({
      id: "traces-logs-viewer",
      traceIds: [TRACE_ID],
    });
    expect(screen.queryByTestId("trace-logs-scope")).not.toBeInTheDocument();
    expect(
      countMock.mock.calls.some((call: [unknown, JSONObject]) => {
        return call[0] === Log;
      }),
    ).toBe(false);

    fireEvent.click(row("auth"));
    fireEvent.click(await screen.findByTestId("span-panel-tab-logs"));
    expect(
      await screen.findByText(/No logs were written inside this span/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("span-pod-logs")).not.toBeInTheDocument();
  });
});

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
import { Mock } from "jest-mock";
import * as React from "react";
import TraceExplorer from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceExplorer";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import Log from "../../../Models/AnalyticsModels/Log";
import Span, {
  SpanKind,
  SpanStatus,
} from "../../../Models/AnalyticsModels/Span";
import Service from "../../../Models/DatabaseModels/Service";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Color from "../../../Types/Color";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

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

  serviceListMock.mockImplementation(async () => {
    return { data: services(), count: 3, skip: 0, limit: 10000 };
  });

  countMock.mockImplementation(async () => {
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

describe("performance fix with AI", () => {
  test("creates the task for this trace and links to it", async () => {
    postMock.mockImplementation(async (args: PostArgs) => {
      if (
        args.url
          .toString()
          .includes("/ai-investigation/create-performance-fix-task")
      ) {
        return new HTTPResponse(
          200,
          { aiRunId: "70000000-0000-4000-8000-000000000009" },
          {},
        );
      }
      return new HTTPResponse(200, { sampleCount: 0 }, {});
    });
    await renderTrace();

    fireEvent.click(screen.getByTestId("trace-fix-performance"));

    expect(
      await screen.findByText("Performance fix task created"),
    ).toBeInTheDocument();
    expect(
      postsTo("/ai-investigation/create-performance-fix-task")[0]!.data,
    ).toEqual({ traceId: TRACE_ID });
    expect(
      screen.getByText("View task progress").closest("a")!.getAttribute("href"),
    ).toContain("70000000-0000-4000-8000-000000000009");
    expect(screen.getByTestId("trace-fix-performance")).toBeDisabled();
  });

  test("a refusal is shown, not swallowed", async () => {
    postMock.mockImplementation(async (args: PostArgs) => {
      if (
        args.url
          .toString()
          .includes("/ai-investigation/create-performance-fix-task")
      ) {
        throw new HTTPErrorResponse(
          400,
          {
            message:
              "No deterministic performance pattern was found in this trace.",
          },
          {},
        );
      }
      return new HTTPResponse(200, { sampleCount: 0 }, {});
    });
    await renderTrace();

    fireEvent.click(screen.getByTestId("trace-fix-performance"));

    expect(
      await screen.findByText("Could not create the performance fix task"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "No deterministic performance pattern was found in this trace.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("trace-fix-performance")).not.toBeDisabled();
  });
});

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

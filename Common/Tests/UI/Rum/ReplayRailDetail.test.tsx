import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
/*
 * See ReplayRail.test.tsx: react is pinned to Common's copy for every
 * importer so Dashboard components render with the same React instance.
 */
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "@jest/globals";
import Route from "../../../Types/API/Route";
import ReplayRailDetail, {
  ReplayRailDetailProps,
  ReplayRailLinks,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplayRailDetail";
import {
  ReplayBackendSignalsSlot,
  ReplaySignal,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignalTypes";
import {
  ReplayNetworkSignalDetail,
  ReplaySpanSignalDetail,
  ReplayTraceWaterfallSpan,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignals";

/*
 * The inline detail per row kind. Pinned: the "Backend for this request"
 * block appears only when a loaded trace shares the request's traceId; the
 * waterfall keeps span order and indents by depth and seeks on click; the
 * log detail links to the explorer at the moment; the error detail links
 * to the exception group; the click detail hands x,y to the stage.
 */

const START_UNIX_MS: number = 1_725_000_000_000;
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";

function networkDetail(
  overrides?: Partial<ReplayNetworkSignalDetail>,
): ReplayNetworkSignalDetail {
  return {
    method: "POST",
    url: "https://api.example.com/api/orders",
    origin: "https://api.example.com",
    path: "/api/orders",
    status: 500,
    durationMs: 220,
    responseBytes: 1229,
    requestBytes: null,
    initiator: "fetch",
    traceId: TRACE_ID,
    isError: true,
    failedBeforeResponse: false,
    aborted: false,
    isCapMarker: false,
    isSlow: false,
    atUnixMs: null,
    ...overrides,
  };
}

function networkSignal(
  overrides?: Partial<ReplayNetworkSignalDetail>,
): ReplaySignal {
  const detail: ReplayNetworkSignalDetail = networkDetail(overrides);

  return {
    id: "rec:0:1",
    kind: "network",
    source: "recording",
    offsetMs: 9000,
    severity: "error",
    title: "POST 500 /api/orders",
    links: detail.traceId ? { traceId: detail.traceId } : {},
    detail: detail,
    alignment: "exact",
  };
}

function waterfallSpan(
  overrides: Partial<ReplayTraceWaterfallSpan> & { spanId: string },
): ReplayTraceWaterfallSpan {
  return {
    parentSpanId: null,
    name: `span ${overrides.spanId}`,
    serviceName: "payment-svc",
    depth: 0,
    startOffsetMs: 0,
    durationMs: 100,
    hasError: false,
    sessionOffsetMs: 9200,
    ...overrides,
  };
}

function traceSignal(spans?: Array<ReplayTraceWaterfallSpan>): ReplaySignal {
  const waterfall: Array<ReplayTraceWaterfallSpan> = spans || [
    waterfallSpan({
      spanId: "root",
      name: "POST /api/orders",
      durationMs: 300,
    }),
    waterfallSpan({
      spanId: "child-a",
      parentSpanId: "root",
      name: "SELECT orders",
      depth: 1,
      startOffsetMs: 20,
      durationMs: 60,
      sessionOffsetMs: 9220,
    }),
    waterfallSpan({
      spanId: "child-b",
      parentSpanId: "child-a",
      name: "charge card",
      depth: 2,
      startOffsetMs: 100,
      durationMs: 150,
      hasError: true,
      sessionOffsetMs: 9300,
    }),
  ];
  const detail: ReplaySpanSignalDetail = {
    traceId: TRACE_ID,
    rootSpanId: "root",
    rootName: "POST /api/orders",
    serviceId: null,
    serviceName: "payment-svc",
    durationMs: 300,
    spanCount: waterfall.length,
    errorSpanCount: 1,
    hasError: true,
    startUnixMs: START_UNIX_MS + 9200,
    baselineOffsetMs: 9200,
    spans: waterfall,
    isWaterfallTruncated: false,
  };

  return {
    id: "span:root",
    kind: "span",
    source: "telemetry",
    offsetMs: 9200,
    endOffsetMs: 9500,
    severity: "error",
    title: "POST /api/orders",
    subtitle: "payment-svc",
    links: { traceId: TRACE_ID, spanId: "root" },
    detail: detail,
    alignment: "unanchored",
  };
}

function logSignal(overrides?: Partial<ReplaySignal>): ReplaySignal {
  return {
    id: "log:aaaaaaaaaaaaaaaaaaaaaaaa",
    kind: "log",
    source: "telemetry",
    offsetMs: 9400,
    severity: "error",
    title: "[ERROR] charge failed: card_declined",
    subtitle: "payment-svc",
    links: { traceId: TRACE_ID, spanId: "child-b", logId: "aaaa" },
    detail: {
      body: "charge failed: card_declined",
      level: "ERROR",
      severityText: "Error",
      severityNumber: 17,
      serviceId: null,
      serviceName: "payment-svc",
      traceId: TRACE_ID,
      spanId: "child-b",
      timeUnixMs: START_UNIX_MS + 9400,
      baselineOffsetMs: 9400,
    },
    alignment: "unanchored",
    ...overrides,
  };
}

function clientErrorSignal(overrides?: Partial<ReplaySignal>): ReplaySignal {
  return {
    id: "rec:0:7",
    kind: "client-error",
    source: "recording",
    offsetMs: 9500,
    severity: "error",
    title: "TypeError: cannot read total",
    links: {},
    detail: {
      kind: "error",
      message: "TypeError: cannot read total",
      source: "https://app.example.com/app.js",
      lineNumber: 12,
      columnNumber: 5,
      stack: "TypeError: cannot read total\n    at render (app.js:12:5)",
      location: "app.js:12:5",
      atUnixMs: null,
    },
    alignment: "exact",
    ...overrides,
  };
}

function serverErrorSignal(overrides?: Partial<ReplaySignal>): ReplaySignal {
  return {
    id: "exc:bbbbbbbbbbbbbbbbbbbbbbbb",
    kind: "server-error",
    source: "telemetry",
    offsetMs: 9800,
    severity: "error",
    title: "ValueError: TypeError: cannot read total",
    links: { traceId: TRACE_ID, exceptionFingerprint: "fp-123" },
    detail: {
      message: "TypeError: cannot read total",
      exceptionType: null,
      stackTrace: "Traceback...",
      fingerprint: "fp-123",
      serviceId: null,
      serviceName: "payment-svc",
      traceId: TRACE_ID,
      spanId: null,
      spanName: null,
      timeUnixMs: START_UNIX_MS + 9800,
      baselineOffsetMs: 9800,
    },
    alignment: "unanchored",
    ...overrides,
  };
}

function clickSignal(): ReplaySignal {
  return {
    id: "rec:0:5",
    kind: "interaction",
    source: "recording",
    offsetMs: 9100,
    severity: "info",
    title: 'click "Pay now"',
    links: {},
    detail: {
      selector: "button.pay",
      text: "Pay now",
      x: 640,
      y: 480,
      isCoordinateOnly: false,
      atUnixMs: null,
    },
    alignment: "exact",
  };
}

function navigationSignal(viewport: [number, number] | null): ReplaySignal {
  return {
    id: "rec:0:9",
    kind: "navigation",
    source: "recording",
    offsetMs: 100,
    severity: "info",
    title: "/cart → /checkout",
    links: {},
    detail: {
      from: "/cart",
      to: "/checkout",
      kind: viewport ? "full-load" : "pushState",
      viewportWidth: viewport ? viewport[0] : null,
      viewportHeight: viewport ? viewport[1] : null,
      atUnixMs: null,
    },
    alignment: "exact",
  };
}

const links: ReplayRailLinks = {
  traceView: (traceId: string): Route | null => {
    return new Route(`/dashboard/p/traces/view/${traceId}`);
  },
  spanView: (traceId: string, spanId: string): Route | null => {
    return new Route(`/dashboard/p/traces/view/${traceId}?spanId=${spanId}`);
  },
  exceptionGroup: (fingerprint: string): Route | null => {
    return new Route(
      `/dashboard/p/exceptions/unresolved?search=%40fingerprint%3A${fingerprint}`,
    );
  },
  logsAtMoment: (offsetMs: number): Route | null => {
    return new Route(`/dashboard/p/logs?at=${START_UNIX_MS + offsetMs}`);
  },
};

interface RenderResult {
  seeks: Array<number>;
  selections: Array<string>;
  stage: Array<[number, number]>;
  traceFilters: Array<string>;
  loads: Array<string>;
}

function renderDetail(
  signal: ReplaySignal,
  options?: {
    signals?: Array<ReplaySignal>;
    spanSlot?: ReplayBackendSignalsSlot | null;
    withShowOnStage?: boolean;
    linksOverride?: ReplayRailLinks;
  },
): RenderResult {
  const result: RenderResult = {
    seeks: [],
    selections: [],
    stage: [],
    traceFilters: [],
    loads: [],
  };

  const props: ReplayRailDetailProps = {
    signal: signal,
    signals: options?.signals || [signal],
    links: options?.linksOverride || links,
    spanSlot: options?.spanSlot,
    onLoadBackend: (kind: string): void => {
      result.loads.push(kind);
    },
    onSeek: (offsetMs: number): void => {
      result.seeks.push(offsetMs);
    },
    onSelectSignal: (id: string): void => {
      result.selections.push(id);
    },
    onShowOnStage:
      options?.withShowOnStage === false
        ? undefined
        : (x: number, y: number): void => {
            result.stage.push([x, y]);
          },
    onFilterLogsByTrace: (traceId: string): void => {
      result.traceFilters.push(traceId);
    },
    onClose: (): void => {
      return;
    },
    startTimeUnixMs: START_UNIX_MS,
  };

  render(
    <MemoryRouter>
      <ReplayRailDetail {...props} />
    </MemoryRouter>,
  );

  return result;
}

function hrefOf(element: HTMLElement): string {
  return (element.closest("a") as HTMLAnchorElement).getAttribute("href") || "";
}

describe("ReplayRailDetail network", () => {
  it("renders the backend block only when a loaded trace shares the traceId", () => {
    const request: ReplaySignal = networkSignal();

    renderDetail(request, {
      signals: [request, traceSignal(), logSignal()],
      spanSlot: {
        status: "ready",
        rowCount: 3,
        isTruncated: false,
        fetchedAtUnixMs: START_UNIX_MS,
      },
    });

    const block: HTMLElement = screen.getByTestId("rail-backend-block");

    expect(block).toHaveTextContent("POST /api/orders");
    expect(block).toHaveTextContent("payment-svc");
    expect(block).toHaveTextContent("300ms");
    expect(block).toHaveTextContent("error in 1 of 3 spans");
    /* The error log on that trace is listed and jumps to its row. */
    expect(block).toHaveTextContent("charge failed: card_declined");
  });

  it("says the trace is not loaded and offers to load it when the slot is idle", () => {
    const request: ReplaySignal = networkSignal();
    const result: RenderResult = renderDetail(request, {
      signals: [request],
      spanSlot: {
        status: "idle",
        rowCount: null,
        isTruncated: false,
        fetchedAtUnixMs: null,
      },
    });

    expect(screen.queryByTestId("rail-backend-block")).not.toBeInTheDocument();
    expect(
      screen.getByText("Backend traces are not loaded yet."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("rail-load-traces"));

    expect(result.loads).toEqual(["span"]);
  });

  it("explains a loaded trace set that does not carry the request's trace id", () => {
    const request: ReplaySignal = networkSignal();

    renderDetail(request, {
      signals: [request],
      spanSlot: {
        status: "ready",
        rowCount: 0,
        isTruncated: false,
        fetchedAtUnixMs: START_UNIX_MS,
      },
    });

    expect(screen.queryByTestId("rail-backend-block")).not.toBeInTheDocument();
    expect(
      screen.getByText(/No span in the loaded traces carries trace/),
    ).toBeInTheDocument();
  });

  it("renders no backend block at all for a request without a trace id", () => {
    renderDetail(networkSignal({ traceId: null }));

    expect(
      screen.queryByText("Backend for this request"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("rail-link-trace")).not.toBeInTheDocument();
  });

  it("shows the request facts, explains a status 0, and says what is never recorded", () => {
    renderDetail(
      networkSignal({
        status: 0,
        failedBeforeResponse: true,
        durationMs: null,
        responseBytes: null,
        traceId: null,
      }),
    );

    expect(
      screen.getByText(
        /failed before a response \(offline, DNS or blocked by CORS\)/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("not measured")).toBeInTheDocument();
    expect(screen.getByText(/response size not measured/)).toBeInTheDocument();
    expect(
      screen.getByText("Bodies and headers are never recorded."),
    ).toBeInTheDocument();
  });

  it("links to the trace view", () => {
    renderDetail(networkSignal());

    expect(hrefOf(screen.getByTestId("rail-link-trace"))).toContain(
      `/traces/view/${TRACE_ID}`,
    );
  });
});

describe("ReplayRailDetail trace waterfall", () => {
  it("keeps span order, indents by depth and seeks to a span on click", () => {
    const result: RenderResult = renderDetail(traceSignal());

    const spans: Array<HTMLElement> = screen.getAllByTestId(
      "rail-waterfall-span",
    );

    expect(spans).toHaveLength(3);
    expect(spans[0]).toHaveTextContent("POST /api/orders");
    expect(spans[1]).toHaveTextContent("SELECT orders");
    expect(spans[2]).toHaveTextContent("charge card");
    expect(spans[0]).toHaveStyle({ paddingLeft: "0px" });
    expect(spans[1]).toHaveStyle({ paddingLeft: "10px" });
    expect(spans[2]).toHaveStyle({ paddingLeft: "20px" });

    fireEvent.click(within(spans[2] as HTMLElement).getByRole("button"));

    expect(result.seeks).toEqual([9300]);
  });

  it("offers Logs for this trace and the trace link", () => {
    const result: RenderResult = renderDetail(traceSignal());

    fireEvent.click(screen.getByTestId("rail-logs-for-trace"));

    expect(result.traceFilters).toEqual([TRACE_ID]);
    expect(hrefOf(screen.getByTestId("rail-link-trace"))).toContain(TRACE_ID);
  });

  it("says when the waterfall is cut off", () => {
    const signal: ReplaySignal = traceSignal();

    (signal.detail as ReplaySpanSignalDetail).isWaterfallTruncated = true;
    (signal.detail as ReplaySpanSignalDetail).spanCount = 80;

    renderDetail(signal);

    expect(
      screen.getByText(/Showing the first 3 of 80 spans/),
    ).toBeInTheDocument();
  });
});

describe("ReplayRailDetail log", () => {
  it("links to the logs explorer at this moment and to the trace and span", () => {
    renderDetail(logSignal());

    expect(hrefOf(screen.getByTestId("rail-link-logs-at-moment"))).toContain(
      `at=${START_UNIX_MS + 9400}`,
    );
    expect(hrefOf(screen.getByTestId("rail-link-trace"))).toContain(TRACE_ID);
    expect(hrefOf(screen.getByTestId("rail-link-span"))).toContain(
      "spanId=child-b",
    );
    expect(
      screen.getByText("charge failed: card_declined"),
    ).toBeInTheDocument();
    expect(screen.getByText("payment-svc")).toBeInTheDocument();
  });

  it("omits the explorer link when the builder has no moment to offer", () => {
    renderDetail(logSignal(), {
      linksOverride: {
        ...links,
        logsAtMoment: (): Route | null => {
          return null;
        },
      },
    });

    expect(
      screen.queryByTestId("rail-link-logs-at-moment"),
    ).not.toBeInTheDocument();
  });

  it("labels server-stamped placement honestly", () => {
    renderDetail(logSignal());

    expect(screen.getByTestId("rail-detail")).toHaveTextContent(
      "server-stamped, unanchored",
    );
  });
});

describe("ReplayRailDetail errors", () => {
  it("shows the stack, the location and the exception group link for a server error", () => {
    renderDetail(serverErrorSignal());

    expect(hrefOf(screen.getByTestId("rail-link-exception-group"))).toContain(
      "fingerprint%3Afp-123",
    );
    expect(hrefOf(screen.getByTestId("rail-link-trace"))).toContain(TRACE_ID);
    expect(screen.getByText("Traceback...")).toBeInTheDocument();
  });

  it("gives a client error its location and stack, and no group link of its own", () => {
    renderDetail(clientErrorSignal());

    expect(screen.getByText("app.js:12:5")).toBeInTheDocument();
    expect(screen.getByText(/at render \(app.js:12:5\)/)).toBeInTheDocument();
    expect(
      screen.queryByTestId("rail-link-exception-group"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("uncaught error")).toBeInTheDocument();
  });

  it("links a client error to its server counterpart and borrows the group link", () => {
    const client: ReplaySignal = clientErrorSignal();
    const server: ReplaySignal = serverErrorSignal();
    const result: RenderResult = renderDetail(client, {
      signals: [client, server],
    });

    const counterpart: HTMLElement = screen.getByTestId(
      "rail-error-counterpart",
    );

    expect(counterpart).toHaveTextContent(
      "also reported server-side at 0:09.8",
    );
    expect(hrefOf(screen.getByTestId("rail-link-exception-group"))).toContain(
      "fp-123",
    );

    fireEvent.click(counterpart);

    expect(result.selections).toEqual([server.id]);
  });

  it("says when no stack reached the recorder rather than showing an empty block", () => {
    renderDetail(
      clientErrorSignal({
        detail: {
          kind: "error",
          message: "Script error.",
          source: null,
          lineNumber: null,
          columnNumber: null,
          stack: null,
          location: null,
          atUnixMs: null,
        },
      }),
    );

    expect(
      screen.getByText(/No stack trace reached the recorder/),
    ).toBeInTheDocument();
  });
});

describe("ReplayRailDetail interactions", () => {
  it("hands the click's coordinates to the stage", () => {
    const result: RenderResult = renderDetail(clickSignal());

    expect(screen.getByText("button.pay")).toBeInTheDocument();
    expect(screen.getByText("Pay now")).toBeInTheDocument();
    expect(screen.getByText("640, 480")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("rail-show-on-stage"));

    expect(result.stage).toEqual([[640, 480]]);
  });

  it("hides Show on stage when the stage cannot flash a ring", () => {
    renderDetail(clickSignal(), { withShowOnStage: false });

    expect(screen.queryByTestId("rail-show-on-stage")).not.toBeInTheDocument();
  });

  it("cross-references the error that followed the click", () => {
    const click: ReplaySignal = clickSignal();
    const error: ReplaySignal = clientErrorSignal();
    const result: RenderResult = renderDetail(click, {
      signals: [click, error],
    });

    const link: HTMLElement = screen.getByTestId("rail-error-after-click");

    expect(link).toHaveTextContent("error 400ms after this click");

    fireEvent.click(link);

    expect(result.selections).toEqual([error.id]);
  });
});

describe("ReplayRailDetail navigation", () => {
  it("renders the viewport for a full load and nothing for a history route", () => {
    const { unmount } = render(
      <MemoryRouter>
        <ReplayRailDetail
          signal={navigationSignal([1440, 900])}
          signals={[navigationSignal([1440, 900])]}
          links={links}
          onSeek={(): void => {
            return;
          }}
          onSelectSignal={(): void => {
            return;
          }}
          onClose={(): void => {
            return;
          }}
          startTimeUnixMs={START_UNIX_MS}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Viewport")).toBeInTheDocument();
    expect(screen.getByText("1440x900")).toBeInTheDocument();
    expect(screen.getByText("full page load")).toBeInTheDocument();

    unmount();

    renderDetail(navigationSignal(null));

    expect(screen.queryByText("Viewport")).not.toBeInTheDocument();
    expect(screen.getByText("history pushState")).toBeInTheDocument();
  });

  it("joins the page's vitals by time", () => {
    const navigation: ReplaySignal = navigationSignal(null);
    const vital: ReplaySignal = {
      id: "rec:0:20",
      kind: "performance",
      source: "recording",
      offsetMs: 4800,
      severity: "warn",
      title: "LCP 4.8s",
      subtitle: "poor",
      links: {},
      detail: {},
      alignment: "exact",
    };
    const later: ReplaySignal = {
      ...navigationSignal(null),
      id: "rec:1:1",
      offsetMs: 20_000,
    };
    const afterLater: ReplaySignal = {
      ...vital,
      id: "rec:1:2",
      offsetMs: 25_000,
      title: "INP 320ms",
    };

    renderDetail(navigation, {
      signals: [navigation, vital, later, afterLater],
    });

    expect(screen.getByText(/LCP 4.8s/)).toBeInTheDocument();
    expect(screen.queryByText(/INP 320ms/)).not.toBeInTheDocument();
  });
});

/*
 * Recorder notices in the detail. None of these is a failure, and the
 * detail used to render all of them as one: a cancelled request as
 * "failed before a response", the network cap marker as a request with no
 * url, a resource failure as an ordinary uncaught error, and the raw word
 * "resource" as its kind (ux-05, ux-06).
 */
describe("ReplayRailDetail recorder notices", () => {
  it("calls a cancelled request cancelled, not failed", () => {
    renderDetail(
      networkSignal({
        status: 0,
        aborted: true,
        isError: false,
        failedBeforeResponse: false,
        durationMs: 40,
      }),
    );

    expect(screen.getByText(/cancelled by the page/)).toBeInTheDocument();
    expect(screen.queryByText(/failed before a response/)).toBeNull();
  });

  it("explains the network cap marker instead of drawing an empty request", () => {
    renderDetail(
      networkSignal({
        method: "",
        url: "",
        origin: "",
        path: "",
        status: 0,
        isError: false,
        isCapMarker: true,
        durationMs: null,
        responseBytes: null,
        traceId: null,
      }),
    );

    expect(
      screen.getByText(/records at most 500 requests per session/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/HTTP 0/)).toBeNull();
  });

  it("names a resource failure in words and says it is not counted as an error", () => {
    renderDetail(
      clientErrorSignal({
        severity: "warn",
        title: "Resource failed to load: <img> /logo.png",
        detail: {
          kind: "resource",
          message: "Resource failed to load: <img>",
          source: "https://cdn.example.com/logo.png",
          lineNumber: null,
          columnNumber: null,
          stack: null,
          location: null,
          tagName: "img",
          isRepeat: false,
          occurrences: null,
          isCapMarker: false,
          atUnixMs: null,
        },
      }),
    );

    expect(screen.getByText("resource failed to load")).toBeInTheDocument();
    expect(screen.getAllByText(/<img>/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Next error steps past it/)).toBeInTheDocument();
    /* Never the wrong explanation for a missing stack. */
    expect(screen.queryByText(/cross-origin scripts hide theirs/)).toBeNull();
  });

  it("quantifies a repeated error", () => {
    renderDetail(
      clientErrorSignal({
        detail: {
          kind: "error",
          message: "TypeError: cannot read total",
          source: null,
          lineNumber: null,
          columnNumber: null,
          stack: null,
          location: null,
          tagName: null,
          isRepeat: true,
          occurrences: 2400,
          isCapMarker: false,
          atUnixMs: null,
        },
      }),
    );

    expect(
      screen.getByText("seen 2400 times so far this session"),
    ).toBeInTheDocument();
  });

  it("says where error capture stopped", () => {
    renderDetail(
      clientErrorSignal({
        severity: "warn",
        detail: {
          kind: "error",
          message: "Error capture stopped after 100 distinct errors",
          source: null,
          lineNumber: null,
          columnNumber: null,
          stack: null,
          location: null,
          tagName: null,
          isRepeat: false,
          occurrences: null,
          isCapMarker: true,
          atUnixMs: null,
        },
      }),
    );

    expect(screen.getByText("recorder notice")).toBeInTheDocument();
    expect(
      screen.getByText(/errors after this point are missing/i),
    ).toBeInTheDocument();
  });
});

/* ux-17: the detail spells out measures and ratings. */
describe("ReplayRailDetail performance wording", () => {
  function performanceSignal(detail: Record<string, unknown>): ReplaySignal {
    return {
      id: "rec:0:9",
      kind: "performance",
      source: "recording",
      offsetMs: 4800,
      severity: "warn",
      title: "LCP 4.8s needs improvement",
      links: {},
      detail: detail,
      alignment: "exact",
    };
  }

  it("renders the rating in words", () => {
    renderDetail(
      performanceSignal({
        kind: "web-vital",
        durationMs: null,
        budgetMs: null,
        isOverBudget: true,
        metric: "LCP",
        value: 4800,
        rating: "needs-improvement",
        url: null,
        atUnixMs: null,
      }),
    );

    expect(screen.getByText("needs improvement")).toBeInTheDocument();
    expect(screen.queryByText("needs-improvement")).toBeNull();
    expect(screen.getByText("LCP")).toBeInTheDocument();
  });

  it("names a budget kind in words rather than its enum value", () => {
    renderDetail(
      performanceSignal({
        kind: "long-task",
        durationMs: 320,
        budgetMs: 200,
        isOverBudget: true,
        metric: null,
        value: null,
        rating: null,
        url: null,
        atUnixMs: null,
      }),
    );

    expect(screen.getByText("Long task")).toBeInTheDocument();
    expect(screen.queryByText("long-task")).toBeNull();
  });
});

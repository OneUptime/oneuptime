import "@testing-library/jest-dom";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import Log from "../../../Models/AnalyticsModels/Log";
import LogSeverity from "../../../Types/Log/LogSeverity";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";

/*
 * The details panel's cross-signal affordances: the Session link card (lazy —
 * the route may need a RumSession lookup), the span-route fallback for
 * spanId-only rows, and the Context tab's scope toggle. "Nearby" context goes
 * through /telemetry/logs/context; "This trace" reuses the standard analytics
 * list query with a traceId filter (the context endpoint has no trace
 * dimension), so switching scopes must switch data paths.
 */

const postMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyErrorMessage: () => {
        return "mocked error";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

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

import LogDetailsPanel, {
  ContextLog,
  splitTraceContextLogs,
} from "../../../UI/Components/LogsViewer/components/LogDetailsPanel";

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
);

type MakeLogOptions = {
  id?: string | undefined;
  body?: string | undefined;
  time?: Date | undefined;
  traceId?: string | undefined;
  spanId?: string | undefined;
  sessionId?: string | undefined;
};

function makeLog(options: MakeLogOptions = {}): Log {
  const log: Log = new Log();
  log.body = options.body || "the log body";
  log.time = options.time || new Date("2026-08-10T10:15:00.000Z");
  log.severityText = LogSeverity.Error;
  log.primaryEntityId = SERVICE_ID;

  if (options.id) {
    log.setColumnValue("_id", options.id);
  }

  if (options.traceId) {
    log.traceId = options.traceId;
  }

  if (options.spanId) {
    log.spanId = options.spanId;
  }

  if (options.sessionId) {
    log.sessionId = options.sessionId;
  }

  return log;
}

function emptyContextResponse(): { data: Record<string, unknown> } {
  return { data: { before: [], after: [] } };
}

beforeEach(() => {
  postMock.mockReset();
  getListMock.mockReset();
  postMock.mockResolvedValue(emptyContextResponse());
  getListMock.mockResolvedValue({ data: [], count: 0 });
});

describe("LogDetailsPanel session card", () => {
  test("renders no session card when the row has no sessionId", () => {
    render(<LogDetailsPanel log={makeLog()} serviceMap={{}} />);

    expect(screen.queryByText("Session")).toBeNull();
  });

  test("renders the session id as plain text when no getSessionRoute is supplied", () => {
    render(
      <LogDetailsPanel
        log={makeLog({ sessionId: "sess-1" })}
        serviceMap={{}}
      />,
    );

    expect(screen.getByText("Session")).toBeInTheDocument();
    expect(screen.getByText("sess-1")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "View session replay sess-1" }),
    ).toBeNull();
  });

  test("renders a link when getSessionRoute returns a route synchronously", async () => {
    render(
      <LogDetailsPanel
        log={makeLog({ sessionId: "sess-1" })}
        serviceMap={{}}
        getSessionRoute={() => {
          return new Route("/rum/app-1/session-replay/sess-1");
        }}
      />,
    );

    const link: HTMLElement = await screen.findByRole("link", {
      name: "View session replay sess-1",
    });
    expect(link).toHaveAttribute("href", "/rum/app-1/session-replay/sess-1");
  });

  test("renders a link when getSessionRoute resolves asynchronously (lazy RumSession lookup)", async () => {
    const getSessionRoute: MockFunction = getJestMockFunction();
    getSessionRoute.mockResolvedValue(
      new Route("/rum/app-2/session-replay/sess-2"),
    );

    const log: Log = makeLog({ sessionId: "sess-2" });

    render(
      <LogDetailsPanel
        log={log}
        serviceMap={{}}
        getSessionRoute={
          getSessionRoute as (
            sessionId: string,
            log: Log,
          ) => Promise<Route | undefined>
        }
      />,
    );

    expect(getSessionRoute).toHaveBeenCalledWith("sess-2", log);

    const link: HTMLElement = await screen.findByRole("link", {
      name: "View session replay sess-2",
    });
    expect(link).toHaveAttribute("href", "/rum/app-2/session-replay/sess-2");
  });

  test("falls back to plain text when the async resolution yields nothing", async () => {
    const getSessionRoute: MockFunction = getJestMockFunction();
    getSessionRoute.mockResolvedValue(undefined);

    render(
      <LogDetailsPanel
        log={makeLog({ sessionId: "sess-3" })}
        serviceMap={{}}
        getSessionRoute={
          getSessionRoute as (
            sessionId: string,
            log: Log,
          ) => Promise<Route | undefined>
        }
      />,
    );

    await waitFor(() => {
      expect(getSessionRoute).toHaveBeenCalled();
    });

    expect(screen.getByText("sess-3")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "View session replay sess-3" }),
    ).toBeNull();
  });
});

describe("LogDetailsPanel span route fallback", () => {
  test("a spanId-only log resolves its span link lazily on expand", async () => {
    const resolveSpanRoute: MockFunction = getJestMockFunction();
    resolveSpanRoute.mockResolvedValue(
      new Route("/traces/trace-9?spanId=span-1"),
    );

    const log: Log = makeLog({ spanId: "span-1" });

    render(
      <LogDetailsPanel
        log={log}
        serviceMap={{}}
        resolveSpanRoute={
          resolveSpanRoute as (
            spanId: string,
            log: Log,
          ) => Promise<Route | undefined>
        }
      />,
    );

    expect(resolveSpanRoute).toHaveBeenCalledWith("span-1", log);

    const link: HTMLElement = await screen.findByRole("link", {
      name: "View span span-1",
    });
    expect(link).toHaveAttribute("href", "/traces/trace-9?spanId=span-1");
  });

  test("a spanId-only log without a resolver renders the id as plain text", () => {
    render(
      <LogDetailsPanel log={makeLog({ spanId: "span-1" })} serviceMap={{}} />,
    );

    expect(screen.getByText("span-1")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View span span-1" })).toBeNull();
  });
});

describe("LogDetailsPanel context scope toggle", () => {
  test("a log without a trace id gets no scope toggle and loads nearby context", async () => {
    render(
      <LogDetailsPanel
        log={makeLog({ id: "log-1" })}
        serviceMap={{}}
        projectId={PROJECT_ID}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Context" }));

    expect(screen.queryByRole("button", { name: "This trace" })).toBeNull();

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    const postCall: Record<string, any> = postMock.mock.calls[0]![0] as Record<
      string,
      any
    >;
    expect(postCall["url"].toString()).toContain("/telemetry/logs/context");
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("switching to 'This trace' queries the analytics list by traceId instead of the context endpoint", async () => {
    const traceRow: Log = makeLog({
      id: "log-other",
      body: "a sibling trace log",
      time: new Date("2026-08-10T10:14:00.000Z"),
      traceId: "trace-1",
    });

    getListMock.mockResolvedValue({ data: [traceRow], count: 1 });

    render(
      <LogDetailsPanel
        log={makeLog({ id: "log-1", traceId: "trace-1" })}
        serviceMap={{}}
        projectId={PROJECT_ID}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Context" }));

    // Default scope is nearby.
    expect(
      screen.getByRole("button", { name: "Nearby (service + time)" }),
    ).toHaveAttribute("aria-pressed", "true");

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "This trace" }));

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });

    const listCall: Record<string, any> = getListMock.mock
      .calls[0]![0] as Record<string, any>;
    expect(listCall["query"]).toEqual({ traceId: "trace-1" });
    expect(listCall["sort"]).toEqual({ time: SortOrder.Ascending });
    expect(listCall["limit"]).toBe(100);

    expect(await screen.findByText("a sibling trace log")).toBeInTheDocument();

    // The context endpoint is not consulted again for trace scope.
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  test("switching back to nearby refetches through the context endpoint", async () => {
    render(
      <LogDetailsPanel
        log={makeLog({ id: "log-1", traceId: "trace-1" })}
        serviceMap={{}}
        projectId={PROJECT_ID}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Context" }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "This trace" }));

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Nearby (service + time)" }),
    );

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(2);
    });
  });

  test("an empty trace shows the trace-scoped empty state", async () => {
    render(
      <LogDetailsPanel
        log={makeLog({ id: "log-1", traceId: "trace-1" })}
        serviceMap={{}}
        projectId={PROJECT_ID}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Context" }));
    fireEvent.click(screen.getByRole("button", { name: "This trace" }));

    expect(
      await screen.findByText("No other logs found for this trace."),
    ).toBeInTheDocument();
  });
});

describe("splitTraceContextLogs", () => {
  function traceLog(id: string, timeIso: string, body: string): Log {
    return makeLog({ id, time: new Date(timeIso), body });
  }

  test("splits around the current row by id and excludes the row itself", () => {
    const logs: Array<Log> = [
      traceLog("a", "2026-08-10T10:00:00.000Z", "first"),
      traceLog("current", "2026-08-10T10:01:00.000Z", "current row"),
      traceLog("b", "2026-08-10T10:02:00.000Z", "last"),
    ];

    const { before, after } = splitTraceContextLogs(
      logs,
      "current",
      new Date("2026-08-10T10:01:00.000Z"),
    );

    expect(
      before.map((row: ContextLog) => {
        return row.body;
      }),
    ).toEqual(["first"]);
    expect(
      after.map((row: ContextLog) => {
        return row.body;
      }),
    ).toEqual(["last"]);
  });

  test("falls back to time ordering when ids are absent; equal timestamps land after", () => {
    const logs: Array<Log> = [
      traceLog("", "2026-08-10T10:00:00.000Z", "earlier"),
      traceLog("", "2026-08-10T10:01:00.000Z", "same instant"),
      traceLog("", "2026-08-10T10:02:00.000Z", "later"),
    ];

    const { before, after } = splitTraceContextLogs(
      logs,
      "",
      new Date("2026-08-10T10:01:00.000Z"),
    );

    expect(
      before.map((row: ContextLog) => {
        return row.body;
      }),
    ).toEqual(["earlier"]);
    expect(
      after.map((row: ContextLog) => {
        return row.body;
      }),
    ).toEqual(["same instant", "later"]);
  });

  test("without a current time everything not matching the id lands before", () => {
    const logs: Array<Log> = [
      traceLog("", "2026-08-10T10:00:00.000Z", "one"),
      traceLog("", "2026-08-10T10:01:00.000Z", "two"),
    ];

    const { before, after } = splitTraceContextLogs(logs, "", undefined);

    expect(before).toHaveLength(2);
    expect(after).toHaveLength(0);
  });

  test("an empty result yields empty halves", () => {
    const { before, after } = splitTraceContextLogs([], "x", new Date());

    expect(before).toEqual([]);
    expect(after).toEqual([]);
  });
});

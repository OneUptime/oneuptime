import "@testing-library/jest-dom";
import { describe, expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import Log from "../../../Models/AnalyticsModels/Log";
import LogSeverity from "../../../Types/Log/LogSeverity";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import LogsTable from "../../../UI/Components/LogsViewer/components/LogsTable";

/*
 * Every trace/span id the logs table renders — dedicated columns and the
 * under-message annotations — must link out when the host supplies a route
 * builder, and degrade to plain text when it doesn't. spanId-only rows (no
 * trace id on the row) can't build a route synchronously, so they resolve
 * the destination on click through resolveSpanRoute and then navigate.
 * Following any of these links must NOT also toggle the row's expansion.
 */

const navigateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (...args: Array<any>) => {
        return navigateMock(...args);
      },
    },
  };
});

type MakeLogOptions = {
  traceId?: string | undefined;
  spanId?: string | undefined;
};

function makeLog(options: MakeLogOptions = {}): Log {
  const log: Log = new Log();
  log.body = "something happened";
  log.time = new Date("2026-08-10T10:15:00.000Z");
  log.severityText = LogSeverity.Error;

  if (options.traceId) {
    log.traceId = options.traceId;
  }

  if (options.spanId) {
    log.spanId = options.spanId;
  }

  return log;
}

const ALL_ID_COLUMNS: Array<string> = [
  "time",
  "service",
  "severity",
  "message",
  "traceId",
  "spanId",
];

type RenderTableOptions = {
  logs: Array<Log>;
  selectedColumns?: Array<string>;
  getTraceRoute?: (traceId: string, log: Log) => Route | URL | undefined;
  getSpanRoute?: (spanId: string, log: Log) => Route | URL | undefined;
  resolveSpanRoute?: (
    spanId: string,
    log: Log,
  ) => Promise<Route | URL | undefined>;
  onRowClick?: (log: Log, rowId: string) => void;
};

function renderTable(options: RenderTableOptions): void {
  render(
    <LogsTable
      logs={options.logs}
      serviceMap={{}}
      isLoading={false}
      onRowClick={options.onRowClick || (() => {})}
      selectedColumns={options.selectedColumns || ALL_ID_COLUMNS}
      getTraceRoute={options.getTraceRoute}
      getSpanRoute={options.getSpanRoute}
      resolveSpanRoute={options.resolveSpanRoute}
    />,
  );
}

describe("LogsTable trace/span cross-links", () => {
  test("trace and span id columns render links with the builder's href when builders are supplied", () => {
    renderTable({
      logs: [makeLog({ traceId: "trace-1", spanId: "span-1" })],
      getTraceRoute: (traceId: string) => {
        return new Route(`/traces/${traceId}`);
      },
      getSpanRoute: (spanId: string, log: Log) => {
        return new Route(`/traces/${log.traceId}?spanId=${spanId}`);
      },
    });

    const traceLink: HTMLElement = screen.getByRole("link", {
      name: "View trace trace-1",
    });
    expect(traceLink).toHaveAttribute("href", "/traces/trace-1");
    expect(traceLink).toHaveTextContent("trace-1");

    const spanLink: HTMLElement = screen.getByRole("link", {
      name: "View span span-1",
    });
    expect(spanLink).toHaveAttribute("href", "/traces/trace-1?spanId=span-1");
    expect(spanLink).toHaveTextContent("span-1");
  });

  test("ids render as plain text when no builders are supplied", () => {
    renderTable({
      logs: [makeLog({ traceId: "trace-1", spanId: "span-1" })],
    });

    expect(screen.getByText("trace-1")).toBeInTheDocument();
    expect(screen.getByText("span-1")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("ids render as plain text when the builders decline (return undefined) and no resolver exists", () => {
    renderTable({
      logs: [makeLog({ traceId: "trace-1", spanId: "span-1" })],
      getTraceRoute: () => {
        return undefined;
      },
      getSpanRoute: () => {
        return undefined;
      },
    });

    expect(screen.getByText("trace-1")).toBeInTheDocument();
    expect(screen.getByText("span-1")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("under-message annotations link the ids when the columns are hidden", () => {
    renderTable({
      logs: [makeLog({ traceId: "trace-1", spanId: "span-1" })],
      selectedColumns: ["time", "message"],
      getTraceRoute: (traceId: string) => {
        return new Route(`/traces/${traceId}`);
      },
      getSpanRoute: (spanId: string, log: Log) => {
        return new Route(`/traces/${log.traceId}?spanId=${spanId}`);
      },
    });

    expect(screen.getByText(/Trace:/)).toBeInTheDocument();
    expect(screen.getByText(/Span:/)).toBeInTheDocument();

    expect(
      screen.getByRole("link", { name: "View trace trace-1" }),
    ).toHaveAttribute("href", "/traces/trace-1");
    expect(
      screen.getByRole("link", { name: "View span span-1" }),
    ).toHaveAttribute("href", "/traces/trace-1?spanId=span-1");
  });

  test("a spanId-only row resolves its destination on click and navigates", async () => {
    navigateMock.mockClear();

    const resolvedRoute: Route = new Route("/traces/trace-9?spanId=span-1");
    const resolveSpanRoute: MockFunction = getJestMockFunction();
    resolveSpanRoute.mockResolvedValue(resolvedRoute);

    const log: Log = makeLog({ spanId: "span-1" });
    const onRowClick: MockFunction = getJestMockFunction();

    renderTable({
      logs: [log],
      // Mirrors the dashboard container: no trace id, no sync route.
      getSpanRoute: () => {
        return undefined;
      },
      resolveSpanRoute: resolveSpanRoute as (
        spanId: string,
        log: Log,
      ) => Promise<Route | URL | undefined>,
      onRowClick,
    });

    const spanLink: HTMLElement = screen.getByRole("button", {
      name: "View span span-1",
    });

    fireEvent.click(spanLink);

    expect(resolveSpanRoute).toHaveBeenCalledWith("span-1", log);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(resolvedRoute);
    });

    // The click followed the link; it must not also expand the row.
    expect(onRowClick).not.toHaveBeenCalled();
  });

  test("a failed span resolution leaves the user in place", async () => {
    navigateMock.mockClear();

    const resolveSpanRoute: MockFunction = getJestMockFunction();
    resolveSpanRoute.mockRejectedValue(new Error("lookup failed"));

    renderTable({
      logs: [makeLog({ spanId: "span-1" })],
      resolveSpanRoute: resolveSpanRoute as (
        spanId: string,
        log: Log,
      ) => Promise<Route | URL | undefined>,
    });

    fireEvent.click(screen.getByRole("button", { name: "View span span-1" }));

    await waitFor(() => {
      expect(resolveSpanRoute).toHaveBeenCalled();
    });

    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("clicking a trace link navigates without toggling the row expansion", () => {
    navigateMock.mockClear();

    const traceRoute: Route = new Route("/traces/trace-1");
    const onRowClick: MockFunction = getJestMockFunction();

    renderTable({
      logs: [makeLog({ traceId: "trace-1" })],
      getTraceRoute: () => {
        return traceRoute;
      },
      onRowClick,
    });

    fireEvent.click(screen.getByRole("link", { name: "View trace trace-1" }));

    expect(navigateMock).toHaveBeenCalledWith(traceRoute);
    expect(onRowClick).not.toHaveBeenCalled();

    // A click elsewhere in the row still expands it.
    fireEvent.click(screen.getByText("something happened"));
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  test("rows without ids render a dash, not a dead link", () => {
    renderTable({
      logs: [makeLog()],
      getTraceRoute: (traceId: string) => {
        return new Route(`/traces/${traceId}`);
      },
    });

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getAllByText("-").length).toBeGreaterThanOrEqual(2);
  });
});

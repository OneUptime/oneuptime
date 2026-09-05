import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
/*
 * The Dashboard has its own copy of react, so a component imported from there
 * would otherwise call hooks on a DIFFERENT React instance than the one
 * react-dom renders with. Common's jest moduleNameMapper pins react,
 * react-dom and react-router-dom to this project's single copy for every
 * importer; see the note at the top of ReplayStage.test.tsx.
 */
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, jest } from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import ObjectID from "../../../Types/ObjectID";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import Log from "../../../Models/AnalyticsModels/Log";
import Span from "../../../Models/AnalyticsModels/Span";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import LogSeverity from "../../../Types/Log/LogSeverity";
import ReplayRail, {
  ReplayRailHandle,
  ReplayRailProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplayRail";
import {
  ReplayBackendListRequest,
  ReplayBackendSignalsStore,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplayBackendSignals";
import {
  ReplayRailTabId,
  ReplaySignal,
  ReplaySignalKind,
  ReplaySignalSeverity,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignalTypes";
import { getRailEmptyCopy } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplayRailEmptyCopy";
import {
  buildRailTabModels,
  computeRailWindow,
  groupRepeatedSignals,
  stepRailRow,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplayRailTabs";

/*
 * The synced rail. What is pinned here is the contract the player and the
 * E2E suite rely on: the tabs never claim a telemetry count before a fetch,
 * the "now" divider sits between past and future rows, a row click seeks
 * one second early AND leaves the clicked row active (scrubber-devtools-5),
 * following yields to the viewer's scroll and comes back on the chip
 * (scrubber-devtools-6), a locked tab names the permission, and long lists
 * mount only a window of rows.
 */

const START_UNIX_MS: number = 1_725_000_000_000;
const SESSION_ID: string = "0123456789abcdef0123456789abcdef";
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";

let ordinal: number = 0;

function makeSignal(
  kind: ReplaySignalKind,
  offsetMs: number,
  overrides?: Partial<ReplaySignal>,
): ReplaySignal {
  ordinal++;

  const severity: ReplaySignalSeverity =
    kind === "client-error" || kind === "server-error" ? "error" : "info";
  const detailByKind: Record<string, Record<string, unknown>> = {
    console: {
      level: "log",
      message: `console line ${ordinal}`,
      atUnixMs: null,
    },
    network: {
      method: "GET",
      url: `https://api.example.com/items/${ordinal}`,
      origin: "https://api.example.com",
      path: `/items/${ordinal}`,
      status: 200,
      durationMs: 120,
      responseBytes: 512,
      requestBytes: null,
      initiator: "fetch",
      traceId: null,
      isError: false,
      failedBeforeResponse: false,
      isSlow: false,
      atUnixMs: null,
    },
    navigation: {
      from: "/cart",
      to: "/checkout",
      kind: "pushState",
      viewportWidth: null,
      viewportHeight: null,
      atUnixMs: null,
    },
    "client-error": {
      kind: "error",
      message: `TypeError ${ordinal}`,
      source: "app.js",
      lineNumber: 12,
      columnNumber: 5,
      stack: "TypeError: boom\n    at app.js:12:5",
      location: "app.js:12:5",
      atUnixMs: null,
    },
    interaction: {
      selector: "button.pay",
      text: "Pay now",
      x: 100,
      y: 200,
      isCoordinateOnly: false,
      atUnixMs: null,
    },
  };

  return {
    id: `rec:${Math.floor(offsetMs / 15000)}:${ordinal}`,
    kind: kind,
    source: "recording",
    offsetMs: offsetMs,
    severity: severity,
    title: `${kind} at ${offsetMs}`,
    chunkIndex: Math.floor(offsetMs / 15000),
    links: {},
    detail: detailByKind[kind] || {},
    alignment: "exact",
    ...overrides,
  };
}

function defaultSignals(): Array<ReplaySignal> {
  return [
    makeSignal("network", 2000, {
      id: "rec:0:1",
      title: "POST 500 /api/orders",
      severity: "error",
      links: { traceId: TRACE_ID },
      detail: {
        method: "POST",
        url: "https://api.example.com/api/orders",
        origin: "https://api.example.com",
        path: "/api/orders",
        status: 500,
        durationMs: 220,
        responseBytes: 1200,
        requestBytes: null,
        initiator: "fetch",
        traceId: TRACE_ID,
        isError: true,
        failedBeforeResponse: false,
        isSlow: false,
        atUnixMs: null,
      },
    }),
    makeSignal("console", 2500, { id: "rec:0:2", title: "order save failed" }),
    makeSignal("navigation", 4000, {
      id: "rec:0:3",
      title: "/cart → /checkout",
    }),
    makeSignal("client-error", 9000, {
      id: "rec:0:4",
      title: "TypeError: cannot read total",
    }),
  ];
}

interface RenderResult {
  seeks: Array<number>;
  selections: Array<string | null>;
  follows: Array<boolean>;
  tabs: Array<ReplayRailTabId>;
  queries: Array<string>;
  handle: React.RefObject<ReplayRailHandle>;
  rerender: (overrides: Partial<ReplayRailProps>) => void;
}

function renderRail(overrides?: Partial<ReplayRailProps>): RenderResult {
  const seeks: Array<number> = [];
  const selections: Array<string | null> = [];
  const follows: Array<boolean> = [];
  const tabs: Array<ReplayRailTabId> = [];
  const queries: Array<string> = [];
  const handle: React.RefObject<ReplayRailHandle> =
    React.createRef<ReplayRailHandle>();

  const baseProps: ReplayRailProps = {
    signals: defaultSignals(),
    sessionId: SESSION_ID,
    startTimeUnixMs: START_UNIX_MS,
    isFinalized: true,
    isExpiredFootage: false,
    currentTimeMs: 3000,
    isPlaying: false,
    selectedSignalId: null,
    onSeek: (offsetMs: number): void => {
      seeks.push(offsetMs);
    },
    onSelectSignal: (signalId: string | null): void => {
      selections.push(signalId);
    },
    onFollowChange: (follow: boolean): void => {
      follows.push(follow);
    },
    onTabChange: (tabId: ReplayRailTabId): void => {
      tabs.push(tabId);
    },
    onQueryChange: (query: string): void => {
      queries.push(query);
    },
    loadedChunkCount: 1,
    totalChunkCount: 1,
  };

  const view: ReturnType<typeof render> = render(
    <MemoryRouter>
      <ReplayRail ref={handle} {...baseProps} {...overrides} />
    </MemoryRouter>,
  );

  return {
    seeks: seeks,
    selections: selections,
    follows: follows,
    tabs: tabs,
    queries: queries,
    handle: handle,
    rerender: (next: Partial<ReplayRailProps>): void => {
      view.rerender(
        <MemoryRouter>
          <ReplayRail ref={handle} {...baseProps} {...overrides} {...next} />
        </MemoryRouter>,
      );
    },
  };
}

function rows(): Array<HTMLElement> {
  return screen.queryAllByTestId("rail-row");
}

function rowTitles(): Array<string> {
  return rows().map((row: HTMLElement): string => {
    return row.getAttribute("data-signal-id") || "";
  });
}

function listResult<T extends AnalyticsBaseModel>(
  data: Array<T>,
): ListResult<T> {
  return { data: data, count: data.length, skip: 0, limit: 500 };
}

function makeStore(options: {
  logs?: Array<Log>;
  spans?: Array<Span>;
  exceptions?: Array<ExceptionInstance>;
  reject?: Partial<Record<"log" | "span" | "exception", unknown>>;
}): {
  store: ReplayBackendSignalsStore;
  calls: Array<string>;
} {
  const calls: Array<string> = [];

  const fetchList: <T extends AnalyticsBaseModel>(
    request: ReplayBackendListRequest<T>,
  ) => Promise<ListResult<T>> = async <T extends AnalyticsBaseModel>(
    request: ReplayBackendListRequest<T>,
  ): Promise<ListResult<T>> => {
    const modelType: unknown = request.modelType;
    const kind: "log" | "span" | "exception" =
      modelType === Log ? "log" : modelType === Span ? "span" : "exception";

    calls.push(kind);

    if (options.reject && options.reject[kind] !== undefined) {
      throw options.reject[kind];
    }

    const data: Array<AnalyticsBaseModel> =
      kind === "log"
        ? options.logs || []
        : kind === "span"
          ? options.spans || []
          : options.exceptions || [];

    return listResult(data as Array<T>);
  };

  return {
    store: new ReplayBackendSignalsStore({
      sessionId: SESSION_ID,
      startTimeUnixMs: START_UNIX_MS,
      endTimeUnixMs: START_UNIX_MS + 60_000,
      isFinalized: true,
      fetchList: fetchList,
    }),
    calls: calls,
  };
}

function makeLog(id: string, atMs: number, body: string): Log {
  const log: Log = new Log();

  log.id = new ObjectID(id);
  log.time = new Date(START_UNIX_MS + atMs);
  log.body = body;
  log.severityText = LogSeverity.Error;
  log.traceId = TRACE_ID;

  return log;
}

describe("ReplayRail tabs and counts", () => {
  it("counts recording rows per tab and never claims a telemetry count before a fetch", () => {
    renderRail();

    expect(screen.getByTestId("rail-tab-all")).toHaveTextContent("All4");
    expect(screen.getByTestId("rail-tab-network")).toHaveTextContent(
      "Network1",
    );
    expect(screen.getByTestId("rail-tab-console")).toHaveTextContent(
      "Console1",
    );
    /* The client error is real; the server half is unknown, so the count is the client's. */
    expect(screen.getByTestId("rail-tab-errors")).toHaveTextContent("Errors1");
    /* Logs and Traces have no number at all - not "0". */
    expect(screen.getByTestId("rail-tab-logs")).toHaveTextContent(/^Logs$/);
    expect(screen.getByTestId("rail-tab-traces")).toHaveTextContent(/^Traces$/);
  });

  it("keeps Errors count-less before the exception fetch when the recording has no client error", () => {
    renderRail({
      signals: [makeSignal("network", 2000), makeSignal("console", 2500)],
    });

    expect(screen.getByTestId("rail-tab-errors")).toHaveTextContent(/^Errors$/);
  });

  it("shows matching/total on the tab badges while a search is active", () => {
    renderRail({ query: "status:>=400" });

    expect(screen.getByTestId("rail-tab-network")).toHaveTextContent(
      "Network1/1",
    );
    expect(screen.getByTestId("rail-tab-console")).toHaveTextContent(
      "Console0/1",
    );
    expect(screen.getByTestId("rail-tab-all")).toHaveTextContent("All1/4");
  });

  it("switches tabs with role=tab buttons and reports the change", () => {
    const result: RenderResult = renderRail();

    fireEvent.click(screen.getByTestId("rail-tab-network"));

    expect(result.tabs).toEqual(["network"]);
    expect(rowTitles()).toEqual(["rec:0:1"]);
    expect(screen.getByTestId("rail-tab-network")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("renders the coverage note while chunks are still loading and hides it once all are in", () => {
    const result: RenderResult = renderRail({
      loadedChunkCount: 2,
      totalChunkCount: 9,
    });

    expect(screen.getByTestId("rail-coverage-note")).toHaveTextContent(
      "Recording rows come from 2 of 9 segments loaded so far",
    );

    result.rerender({ loadedChunkCount: 9, totalChunkCount: 9 });

    expect(screen.queryByTestId("rail-coverage-note")).not.toBeInTheDocument();
  });
});

describe("ReplayRail playhead sync", () => {
  it("places the now divider between past and future rows and dims the future ones", () => {
    renderRail({ currentTimeMs: 3000 });

    const list: HTMLElement = screen.getByTestId("rail-list");
    const children: Array<Element> = Array.from(list.children);
    const dividerIndex: number = children.findIndex(
      (child: Element): boolean => {
        return child.getAttribute("data-testid") === "rail-now-divider";
      },
    );

    /* Two rows are at or before 3000ms (2000, 2500); the divider follows them. */
    expect(dividerIndex).toBe(2);
    expect(screen.getByTestId("rail-now-divider")).toHaveTextContent(
      "now 0:03.0",
    );

    const allRows: Array<HTMLElement> = rows();

    expect(allRows[0]).toHaveAttribute("data-future", "false");
    expect(allRows[1]).toHaveAttribute("data-future", "false");
    expect(allRows[2]).toHaveAttribute("data-future", "true");
    expect(allRows[3]).toHaveAttribute("data-future", "true");
  });

  it("marks the last row the playhead passed as active with aria-current", () => {
    renderRail({ currentTimeMs: 3000 });

    const active: HTMLElement = screen.getByTestId("rail-row-active");
    const activeRow: HTMLElement = active.closest(
      "[data-testid='rail-row']",
    ) as HTMLElement;

    expect(activeRow).toHaveAttribute("data-signal-id", "rec:0:2");
    expect(activeRow).toHaveAttribute("aria-current", "true");
    expect(activeRow).toHaveAttribute("role", "option");
    expect(screen.getByTestId("rail-list")).toHaveAttribute("role", "listbox");
  });

  it("puts the divider before the first row when nothing has happened yet", () => {
    renderRail({ currentTimeMs: 0 });

    const list: HTMLElement = screen.getByTestId("rail-list");

    expect(list.children[0]).toHaveAttribute("data-testid", "rail-now-divider");
    expect(screen.queryByTestId("rail-row-active")).not.toBeInTheDocument();
  });
});

describe("ReplayRail row click (scrubber-devtools-5)", () => {
  it("seeks one second before the row and selects it", () => {
    const result: RenderResult = renderRail();

    fireEvent.click(within(rows()[3] as HTMLElement).getByText(/TypeError/));

    expect(result.seeks).toEqual([8000]);
    expect(result.selections).toEqual(["rec:0:4"]);
  });

  it("keeps the clicked row active while the playhead sits in its pre-roll window", () => {
    const result: RenderResult = renderRail();

    fireEvent.click(within(rows()[3] as HTMLElement).getByText(/TypeError/));

    /* The player applies the seek and the selection. */
    result.rerender({ currentTimeMs: 8000, selectedSignalId: "rec:0:4" });

    const activeRow: HTMLElement = screen
      .getByTestId("rail-row-active")
      .closest("[data-testid='rail-row']") as HTMLElement;

    expect(activeRow).toHaveAttribute("data-signal-id", "rec:0:4");
    expect(activeRow).toHaveAttribute("aria-selected", "true");
    expect(activeRow).toHaveAttribute("data-future", "false");
    /* The row before it is NOT the active one, which is what the old rule did. */
    expect(rows()[2]).not.toHaveAttribute("aria-current");
  });

  it("expands the detail under the selected row and closes it from the detail", () => {
    const result: RenderResult = renderRail({ selectedSignalId: "rec:0:4" });

    const detail: HTMLElement = screen.getByTestId("rail-detail");

    expect(detail).toHaveAttribute("data-signal-kind", "client-error");
    expect(detail).toHaveTextContent("app.js:12:5");

    fireEvent.click(screen.getByLabelText("Close detail"));

    expect(result.selections).toEqual([null]);
  });

  it("keeps the trace link a sibling of the seek button, never nested inside it", () => {
    renderRail();

    const row: HTMLElement = rows()[0] as HTMLElement;
    const link: HTMLElement = within(row).getByText("trace");
    const seek: HTMLElement = within(row).getByLabelText(/^Seek to/);

    expect(link.closest("a")).not.toBeNull();
    expect(seek.tagName.toLowerCase()).toBe("button");
    expect(seek.contains(link)).toBe(false);
    expect(link.closest("button")).toBeNull();
    expect(link.closest("a")?.parentElement).toBe(seek.parentElement);
  });

  it("the seek hover action seeks without changing the selection", () => {
    const result: RenderResult = renderRail();

    fireEvent.click(
      within(rows()[1] as HTMLElement).getByLabelText(/^Seek to/),
    );

    expect(result.seeks).toEqual([1500]);
    expect(result.selections).toEqual([]);
  });
});

describe("ReplayRail follow (scrubber-devtools-6)", () => {
  it("turns follow off on a wheel inside the list and offers to resume", () => {
    const result: RenderResult = renderRail();

    expect(screen.queryByTestId("rail-resume-follow")).not.toBeInTheDocument();

    fireEvent.wheel(screen.getByTestId("rail-list"), { deltaY: 40 });

    expect(result.follows).toEqual([false]);
    expect(screen.getByTestId("rail-resume-follow")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("rail-resume-follow"));

    expect(result.follows).toEqual([false, true]);
    expect(screen.queryByTestId("rail-resume-follow")).not.toBeInTheDocument();
  });

  it("re-anchors the divider after a seek while paused, not only while playing", () => {
    const result: RenderResult = renderRail({
      currentTimeMs: 0,
      isPlaying: false,
    });
    const list: HTMLElement = screen.getByTestId("rail-list");

    Object.defineProperty(list, "clientHeight", {
      configurable: true,
      value: 100,
    });

    let scrollTop: number = 0;

    Object.defineProperty(list, "scrollTop", {
      configurable: true,
      get: (): number => {
        return scrollTop;
      },
      set: (value: number): void => {
        scrollTop = value;
      },
    });

    const divider: HTMLElement = screen.getByTestId("rail-now-divider");

    Object.defineProperty(divider, "offsetTop", {
      configurable: true,
      value: 500,
    });

    /* A marker click while paused moves the playhead past three rows. */
    result.rerender({ currentTimeMs: 5000, isPlaying: false });

    /* offsetTop (500) - 40% of the list height (40) = 460. */
    expect(scrollTop).toBe(460);
  });

  it("offers Jump to now when following is off and the divider is off-screen", () => {
    renderRail({ follow: false, currentTimeMs: 3000 });

    const list: HTMLElement = screen.getByTestId("rail-list");
    const divider: HTMLElement = screen.getByTestId("rail-now-divider");

    Object.defineProperty(list, "clientHeight", {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(list, "scrollTop", {
      configurable: true,
      value: 900,
      writable: true,
    });
    Object.defineProperty(divider, "offsetTop", {
      configurable: true,
      value: 50,
    });

    fireEvent.scroll(list);

    expect(screen.getByTestId("rail-jump-to-now")).toBeInTheDocument();
    /* Resume is offered too, but Jump to now must not turn following on. */
    expect(screen.getByTestId("rail-resume-follow")).toBeInTheDocument();
  });
});

describe("ReplayRail keyboard and stepping", () => {
  it("] and [ step through the rows of the current tab, seeking and selecting", () => {
    const result: RenderResult = renderRail({ currentTimeMs: 3000 });

    /* The playhead is on row 1 (2500ms); next is the navigation at 4000. */
    fireEvent.keyDown(screen.getByTestId("rail-list"), { key: "]" });

    expect(result.seeks).toEqual([3000]);
    expect(result.selections).toEqual(["rec:0:3"]);

    /* From the selected row, previous is the console row at 2500. */
    result.rerender({ currentTimeMs: 3000, selectedSignalId: "rec:0:3" });
    fireEvent.keyDown(screen.getByTestId("rail-list"), { key: "[" });

    expect(result.seeks).toEqual([3000, 1500]);
    expect(result.selections).toEqual(["rec:0:3", "rec:0:2"]);
  });

  it("stepping stays inside the current tab", () => {
    const result: RenderResult = renderRail({
      currentTimeMs: 0,
      activeTab: "console",
    });

    /* Only one console row; next lands on it, next again has nowhere to go. */
    expect(result.handle.current?.stepSignal(1)?.id).toBe("rec:0:2");

    result.rerender({
      currentTimeMs: 1500,
      activeTab: "console",
      selectedSignalId: "rec:0:2",
    });

    expect(result.handle.current?.stepSignal(1)).toBeNull();
    expect(result.seeks).toEqual([1500]);
  });

  it("j/k move the selection without seeking, Enter seeks to it, Escape clears it", () => {
    const result: RenderResult = renderRail({ currentTimeMs: 3000 });
    const list: HTMLElement = screen.getByTestId("rail-list");

    fireEvent.keyDown(list, { key: "j" });

    expect(result.selections).toEqual(["rec:0:3"]);
    expect(result.seeks).toEqual([]);

    result.rerender({ currentTimeMs: 3000, selectedSignalId: "rec:0:3" });
    fireEvent.keyDown(list, { key: "Enter" });

    expect(result.seeks).toEqual([3000]);

    fireEvent.keyDown(list, { key: "Escape" });

    expect(result.selections).toEqual(["rec:0:3", null]);
  });

  it("the handle reveals a signal on another tab by switching to it", () => {
    const result: RenderResult = renderRail({
      currentTimeMs: 0,
      activeTab: "console",
    });

    let revealed: boolean | undefined = undefined;

    act((): void => {
      revealed = result.handle.current?.revealSignal("rec:0:1");
    });

    expect(revealed).toBe(true);
    expect(result.tabs).toEqual(["network"]);
    expect(result.selections).toEqual(["rec:0:1"]);
    expect(result.seeks).toEqual([1000]);
    act((): void => {
      revealed = result.handle.current?.revealSignal("rec:9:9");
    });

    expect(revealed).toBe(false);
  });

  it("/ handler focuses the search box through the handle", () => {
    const result: RenderResult = renderRail();

    act((): void => {
      result.handle.current?.focusSearch();
    });

    expect(screen.getByTestId("rail-search-input")).toHaveFocus();
  });
});

describe("ReplayRail filtering", () => {
  it("filters rows by query tokens and reports the query", () => {
    const result: RenderResult = renderRail();

    fireEvent.change(screen.getByTestId("rail-search-input"), {
      target: { value: "status:>=400" },
    });

    expect(result.queries).toEqual(["status:>=400"]);
    expect(rowTitles()).toEqual(["rec:0:1"]);
  });

  it("chips narrow the current tab and clear together with the query", () => {
    renderRail({ activeTab: "network" });

    fireEvent.click(screen.getByTestId("rail-chip-network-2xx"));

    expect(rows()).toHaveLength(0);
    expect(screen.getByTestId("rail-empty")).toHaveTextContent(
      "No requests match this filter",
    );

    fireEvent.click(screen.getByText("Clear filters"));

    expect(rows()).toHaveLength(1);
  });

  it("the ±30s scope keeps only rows near the playhead", () => {
    renderRail({
      currentTimeMs: 2000,
      signals: [
        makeSignal("console", 1000, { id: "rec:0:1" }),
        makeSignal("console", 50_000, { id: "rec:3:2" }),
      ],
    });

    fireEvent.click(screen.getByText("±30s"));

    expect(rowTitles()).toEqual(["rec:0:1"]);
  });

  it("collapses consecutive identical rows into one with a repeat count", () => {
    renderRail({
      signals: [
        makeSignal("console", 1000, { id: "rec:0:1", title: "render loop" }),
        makeSignal("console", 1100, { id: "rec:0:2", title: "render loop" }),
        makeSignal("console", 1200, { id: "rec:0:3", title: "render loop" }),
        makeSignal("console", 1300, { id: "rec:0:4", title: "other" }),
      ],
    });

    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toHaveTextContent("×3");
    expect(screen.getByTestId("rail-tab-console")).toHaveTextContent(
      "Console4",
    );
  });
});

describe("ReplayRail telemetry tabs", () => {
  it("fetches logs on first open and counts them once loaded", async () => {
    const { store, calls } = makeStore({
      logs: [makeLog("aaaaaaaaaaaaaaaaaaaaaaaa", 5000, "charge failed")],
    });
    const result: RenderResult = renderRail({ backendStore: store });

    expect(calls).toEqual([]);

    fireEvent.click(screen.getByTestId("rail-tab-logs"));

    await waitFor((): void => {
      expect(screen.getByTestId("rail-tab-logs")).toHaveTextContent("Logs1");
    });

    expect(calls).toEqual(["log"]);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent("[ERROR] charge failed");
    /* Server-stamped rows carry the alignment note in the header. */
    expect(screen.getByTestId("rail-alignment-note")).toHaveTextContent(
      /unanchored/,
    );

    /* Switching back does not refetch a finalized session. */
    fireEvent.click(screen.getByTestId("rail-tab-all"));
    expect(calls).toEqual(["log"]);
    expect(result.tabs).toEqual(["logs", "all"]);
  });

  it("names the missing permission on a locked tab", async () => {
    const { store } = makeStore({
      reject: {
        log: new HTTPErrorResponse(403, { message: "Forbidden" }, {}),
      },
    });

    renderRail({ backendStore: store, activeTab: "logs" });

    await waitFor((): void => {
      expect(store.getSnapshot().slots.log.status).toBe("locked");
    });

    const permission: string = store.getSnapshot().slots.log
      .lockedPermission as string;

    expect(permission.length).toBeGreaterThan(0);
    expect(screen.getByTestId("rail-empty")).toHaveTextContent(
      `Your role lacks "${permission}"`,
    );
    expect(screen.getByTestId("rail-empty")).toHaveTextContent(
      "Backend logs are locked",
    );
  });

  it("loads every telemetry kind immediately once footage has expired", async () => {
    const { store, calls } = makeStore({});

    renderRail({ backendStore: store, isExpiredFootage: true, signals: [] });

    await waitFor((): void => {
      expect(calls.length).toBe(3);
    });

    expect(new Set(calls)).toEqual(new Set(["log", "span", "exception"]));
    expect(screen.getByTestId("rail-empty")).toHaveTextContent(
      "Signals expired with the footage",
    );
  });

  it("offers a retry when a fetch fails", async () => {
    const { store, calls } = makeStore({
      reject: { log: new HTTPErrorResponse(502, { message: "bad" }, {}) },
    });

    renderRail({ backendStore: store, activeTab: "logs" });

    await waitFor((): void => {
      expect(store.getSnapshot().slots.log.status).toBe("error");
    });

    expect(screen.getByTestId("rail-empty")).toHaveTextContent(/HTTP 502/);
    expect(screen.getAllByText(/HTTP 502/)).toHaveLength(1);

    fireEvent.click(screen.getByText("Retry"));

    await waitFor((): void => {
      expect(calls).toEqual(["log", "log"]);
    });
  });
});

describe("ReplayRail empty copy", () => {
  it("explains why each tab is empty rather than saying nothing", () => {
    const cases: Array<[ReplayRailTabId, string]> = [
      ["console", "No console output was recorded in the loaded footage"],
      ["network", "No requests were recorded in the loaded footage"],
      ["logs", "No backend logs carried this session's id"],
      ["traces", "No backend spans carried this session's id"],
    ];

    for (const [tabId, expected] of cases) {
      const copy: {
        title: string;
        detail: string;
        snippet?: string | undefined;
      } = getRailEmptyCopy({
        tabId: tabId,
        isFiltering: false,
        hadRowsBeforeFilter: false,
        slot:
          tabId === "logs" || tabId === "traces"
            ? {
                status: "ready",
                rowCount: 0,
                isTruncated: false,
                fetchedAtUnixMs: START_UNIX_MS,
              }
            : null,
        isExpiredFootage: false,
        recorderCapabilities: null,
        hasLoadedFootage: true,
      });

      expect(copy.title).toBe(expected);
      expect(copy.detail.length).toBeGreaterThan(20);
    }
  });

  it("ships the session.id snippet with the Logs and Traces copy", () => {
    renderRail({ signals: [], activeTab: "logs", backendStore: null });

    expect(screen.getByTestId("rail-empty")).toHaveTextContent(
      "OneUptimeReplay.onSessionChange",
    );
    expect(
      screen.getByTestId("rail-empty").querySelector("pre"),
    ).not.toBeNull();
  });

  it("tells old recordings apart on the Interactions tab, listing capabilities", () => {
    renderRail({
      signals: [],
      activeTab: "interactions",
      recorderCapabilities: ["console", "network"],
    });

    expect(screen.getByTestId("rail-empty")).toHaveTextContent(
      "This recording predates click labels",
    );
    expect(screen.getByTestId("rail-empty")).toHaveTextContent("network");
  });

  it("renders skeleton rows, never empty copy, while the manifest loads", () => {
    renderRail({ signals: [], isLoading: true });

    expect(screen.getByTestId("rail-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("rail-empty")).not.toBeInTheDocument();
  });
});

describe("ReplayRail windowing", () => {
  it("mounts only a slice of a long list around the active row", () => {
    const many: Array<ReplaySignal> = [];

    for (let i: number = 0; i < 700; i++) {
      many.push(
        makeSignal("network", i * 100, {
          id: `rec:${Math.floor(i / 150)}:${i}`,
          title: `GET 200 /items/${i}`,
        }),
      );
    }

    renderRail({ signals: many, currentTimeMs: 35_000 });

    const mounted: Array<HTMLElement> = rows();

    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThan(700);

    /* The active row (index 350) is inside the window. */
    expect(screen.getByTestId("rail-row-active")).toBeInTheDocument();

    const ids: Array<string> = rowTitles();

    expect(ids).toContain("rec:2:350");
    expect(ids).not.toContain("rec:0:0");
    expect(ids).not.toContain("rec:4:699");
  });

  it("computeRailWindow always includes the selected row", () => {
    expect(
      computeRailWindow({
        rowCount: 1000,
        centerIndex: 100,
        mustIncludeIndexes: [900],
      }),
    ).toEqual({ startIndex: 0, endIndex: 901 });
    expect(computeRailWindow({ rowCount: 20, centerIndex: 5 })).toEqual({
      startIndex: 0,
      endIndex: 20,
    });
  });
});

describe("ReplayRail pure helpers", () => {
  it("groupRepeatedSignals only merges consecutive identical groupable rows", () => {
    const grouped: ReturnType<typeof groupRepeatedSignals> =
      groupRepeatedSignals([
        makeSignal("console", 1, { id: "a", title: "x" }),
        makeSignal("console", 2, { id: "b", title: "x" }),
        makeSignal("network", 3, { id: "c", title: "x" }),
        makeSignal("network", 4, { id: "d", title: "x" }),
        makeSignal("console", 5, { id: "e", title: "x" }),
      ]);

    expect(
      grouped.map(
        (row: { repeatCount: number; memberIds: Array<string> }): number => {
          return row.repeatCount;
        },
      ),
    ).toEqual([2, 1, 1, 1]);
    expect(grouped[0]?.memberIds).toEqual(["a", "b"]);
  });

  it("stepRailRow starts from the selection, else the playhead, and clamps", () => {
    const list: ReturnType<typeof groupRepeatedSignals> = groupRepeatedSignals([
      makeSignal("console", 1000, { id: "a" }),
      makeSignal("console", 2000, { id: "b" }),
      makeSignal("network", 3000, { id: "c" }),
    ]);

    expect(
      stepRailRow(list, { selectedSignalId: null, currentTimeMs: 0, delta: 1 })
        ?.signal.id,
    ).toBe("a");
    expect(
      stepRailRow(list, {
        selectedSignalId: null,
        currentTimeMs: 0,
        delta: -1,
      }),
    ).toBeNull();
    expect(
      stepRailRow(list, { selectedSignalId: "b", currentTimeMs: 0, delta: 1 })
        ?.signal.id,
    ).toBe("c");
    expect(
      stepRailRow(list, { selectedSignalId: "c", currentTimeMs: 0, delta: 1 }),
    ).toBeNull();
  });

  it("buildRailTabModels leaves telemetry counts null until a slot has rows", () => {
    const models: ReturnType<typeof buildRailTabModels> = buildRailTabModels({
      signals: defaultSignals(),
      matchingSignals: null,
      slots: null,
    });
    const byId: Record<string, number | null> = {};

    for (const model of models) {
      byId[model.id] = model.count;
    }

    expect(byId["all"]).toBe(4);
    expect(byId["logs"]).toBeNull();
    expect(byId["traces"]).toBeNull();
    expect(byId["errors"]).toBe(1);
  });
});

describe("ReplayRail hover", () => {
  it("reports the hovered row's offset for the ghost playhead and clears it on leave", () => {
    const hovers: Array<number | null> = [];

    renderRail({
      onHoverSignal: (offsetMs: number | null): void => {
        hovers.push(offsetMs);
      },
    });

    fireEvent.mouseEnter(rows()[0] as HTMLElement);
    fireEvent.mouseLeave(rows()[0] as HTMLElement);

    expect(hovers).toEqual([2000, null]);
  });
});

/* Keep jest from flagging the unused helper on platforms without a real clipboard. */
export const noop: () => void = jest.fn() as unknown as () => void;

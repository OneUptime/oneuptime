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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * An embedded logs explorer's own block for an empty list
 * (Components/Logs/LogsViewer's emptyContentWhenUnfiltered): an ESXi host's
 * Logs tab shows how to send the host's syslog there, in place of "no logs
 * found", while nothing narrows the list. Pinned against the real Dashboard
 * LogsViewer over the real Common LogsViewer and a mocked data layer:
 *
 *   - an empty, unnarrowed list shows the embed's block;
 *   - a list a search narrows to nothing says what to try, without the
 *     block;
 *   - a list with lines shows them, without the block;
 *   - the Logs page's first steps (offersSetupWhenEmpty) win over it;
 *   - an embed's own line (how logs reach what it shows) is for a list
 *     nothing narrows: once the reader's search empties the list, it says
 *     what to try instead (getLogsEmptyMessage).
 */

const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const analyticsCountMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
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
        return analyticsGetListMock(...args);
      },
      count: (...args: Array<any>) => {
        return analyticsCountMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: Error) => {
        return error?.message || "error";
      },
      getFriendlyErrorMessage: (error: Error) => {
        return error?.message || "error";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Utils/Realtime", () => {
  return {
    __esModule: true,
    default: {
      listenToAnalyticsModelEvent: () => {
        return () => {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  return {
    __esModule: true,
    default: () => {
      return new Map();
    },
  };
});

jest.mock("recharts", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  const chart: (props: {
    children?: React.ReactNode;
  }) => React.ReactElement = (props: {
    children?: React.ReactNode;
  }): React.ReactElement => {
    return react.createElement("div", null, props.children);
  };

  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    AreaChart: chart,
    BarChart: chart,
    Area: nothing,
    Bar: nothing,
    XAxis: nothing,
    YAxis: nothing,
    CartesianGrid: nothing,
    Tooltip: nothing,
    ReferenceArea: nothing,
  };
});

import DashboardLogsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer";
import { LOGS_VIEWER_TOOLBAR_TEST_ID } from "../../../UI/Components/LogsViewer/components/LogsViewerToolbar";
import { LOGS_NARROWED_EMPTY_HINT } from "../../../UI/Components/LogsViewer/LogsViewer";
import Log from "../../../Models/AnalyticsModels/Log";
import LogSeverity from "../../../Types/Log/LogSeverity";
import Query from "../../../Types/BaseDatabase/Query";

const NOW: Date = new Date("2026-10-21T12:00:00.000Z");

// How many lines the window holds, for the mocked list endpoint.
let logsInWindow: number = 0;

function makeLogs(count: number): Array<Log> {
  const logs: Array<Log> = [];
  for (let index: number = 0; index < count; index++) {
    const log: Log = new Log();
    log.body = `vmkernel: line ${index}`;
    log.time = new Date(NOW.getTime() - index * 1000);
    log.severityText = LogSeverity.Information;
    logs.push(log);
  }
  return logs;
}

const HOST_QUERY: Query<Log> = {
  attributes: {
    "resource.vmware.vcenter.name": "vcenter-prod",
    hostname: "esx01.acme.example",
  },
} as unknown as Query<Log>;

function ownBlock(): React.ReactElement {
  return <div data-testid="embed-empty-block">Send the host syslog</div>;
}

// A host's Logs tab's own line (Pages/Host/View/Logs.tsx).
const HOST_HINT: string =
  "Make sure your OTel collector forwards logs with the host.name resource attribute.";

// Types a search into the bar and runs it, as a reader does.
async function search(text: string): Promise<void> {
  const box: HTMLElement = screen.getByRole("textbox");
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter", code: "Enter" });
  await settle();
}

async function settle(): Promise<void> {
  for (let round: number = 0; round < 6; round++) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

async function mount(element: React.ReactElement): Promise<void> {
  await act(async () => {
    render(element);
  });
  await waitFor(() => {
    expect(screen.getByTestId(LOGS_VIEWER_TOOLBAR_TEST_ID)).toBeInTheDocument();
  });
  await settle();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  logsInWindow = 0;

  getListMock.mockReset();
  analyticsGetListMock.mockReset();
  analyticsCountMock.mockReset();
  postMock.mockReset();

  getListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 0 };
  });
  analyticsGetListMock.mockImplementation(async (args: unknown) => {
    const limit: number = Number((args as { limit?: number }).limit || 100);
    const rows: number = Math.min(limit, logsInWindow);
    return {
      data: makeLogs(rows),
      count: rows,
      skip: 0,
      limit: limit,
      hasMore: false,
    };
  });
  analyticsCountMock.mockImplementation(async () => {
    return logsInWindow;
  });
  postMock.mockImplementation(async (args: unknown) => {
    const url: string = (
      args as { url: { toString: () => string } }
    ).url.toString();
    if (url.endsWith("/telemetry/logs/histogram")) {
      return { data: { bucketSizeInMinutes: 1, buckets: [] } };
    }
    if (url.endsWith("/telemetry/logs/facets")) {
      return { data: { facets: {} } };
    }
    return { data: {} };
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe("an embedded explorer's own empty block", () => {
  test("an empty list that nothing narrows shows the embed's block", async () => {
    await mount(
      <DashboardLogsViewer
        id="vmware-host-logs-test"
        logQuery={HOST_QUERY}
        showFilters={true}
        emptyContentWhenUnfiltered={ownBlock()}
      />,
    );

    expect(await screen.findByTestId("embed-empty-block")).toBeInTheDocument();
    expect(screen.queryByTestId("logs-table-empty")).toBeNull();
    expect(screen.queryByText(LOGS_NARROWED_EMPTY_HINT)).toBeNull();
  });

  test("a list a search narrows to nothing says what to try, without the block", async () => {
    await mount(
      <DashboardLogsViewer
        id="vmware-host-logs-test"
        logQuery={HOST_QUERY}
        showFilters={true}
        emptyContentWhenUnfiltered={ownBlock()}
      />,
    );
    await screen.findByTestId("embed-empty-block");

    await search("hostd");

    await waitFor(() => {
      expect(screen.queryByTestId("embed-empty-block")).toBeNull();
    });
    expect(screen.getByTestId("logs-table-empty")).toHaveTextContent(
      LOGS_NARROWED_EMPTY_HINT,
    );
  });

  test("a list with lines shows them, not the block", async () => {
    logsInWindow = 3;

    await mount(
      <DashboardLogsViewer
        id="vmware-host-logs-test"
        logQuery={HOST_QUERY}
        showFilters={true}
        emptyContentWhenUnfiltered={ownBlock()}
      />,
    );

    expect(await screen.findByText("vmkernel: line 0")).toBeInTheDocument();
    expect(screen.queryByTestId("embed-empty-block")).toBeNull();
  });

  test("the Logs page's first steps win over an embed's block", async () => {
    await mount(
      <DashboardLogsViewer
        id="logs"
        showFilters={true}
        offersSetupWhenEmpty={true}
        emptyContentWhenUnfiltered={ownBlock()}
      />,
    );

    expect(await screen.findByTestId("logs-first-steps")).toBeInTheDocument();
    expect(screen.queryByTestId("embed-empty-block")).toBeNull();
  });

  test("an embed without a block of its own keeps its plain message", async () => {
    await mount(
      <DashboardLogsViewer
        id="host-logs-test"
        logQuery={HOST_QUERY}
        showFilters={true}
        noLogsMessage={HOST_HINT}
      />,
    );

    expect(await screen.findByText(HOST_HINT)).toBeInTheDocument();
  });

  test("REGRESSION: an embed's own line gives way to what to try once a search empties the list", async () => {
    /*
     * A host's line says how its logs get here. Shown under a search that
     * found nothing, it told the reader the host sent no logs - it did, and
     * the search left none.
     */
    await mount(
      <DashboardLogsViewer
        id="host-logs-test"
        logQuery={HOST_QUERY}
        showFilters={true}
        noLogsMessage={HOST_HINT}
      />,
    );
    await screen.findByText(HOST_HINT);

    await search("connection refused");

    await waitFor(() => {
      expect(screen.getByTestId("logs-table-empty")).toHaveTextContent(
        LOGS_NARROWED_EMPTY_HINT,
      );
    });
    expect(screen.queryByText(HOST_HINT)).toBeNull();

    // The search cleared, the list is the host's again, with its line.
    await search("");

    await waitFor(() => {
      expect(screen.getByText(HOST_HINT)).toBeInTheDocument();
    });
    expect(screen.queryByText(LOGS_NARROWED_EMPTY_HINT)).toBeNull();
  });
});

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105: the investigation drawer's companion Traces and Exceptions
 * tabs are explorers pinned to the drawer's window. A zoom made on the
 * drawer's log chart (which sits above the tabs) moves that window while a
 * tab is open, so the explorer must follow a NEW pin the way the logs
 * explorer already did - and must not refetch, or undo a zoom the reader
 * made inside it, when the host merely rebuilds an equal query.
 *
 * The logs explorer is held to the same contract. It is the primary of a
 * Logs snapshot on the incident and alert pages, whose background refresh
 * (an acknowledge, an edit) re-reads the stored query into a NEW but equal
 * object, and the Logs tab of every other snapshot card.
 *
 * The real viewers are rendered with the telemetry shell (the logs
 * explorer: its shared LogsViewer) replaced by a probe that records what it
 * is handed, against mocked APIs.
 */

type ShellProps = {
  timeRange: {
    range: string;
    startAndEndDate?: { startValue: Date; endValue: Date };
  };
  onHistogramTimeRangeSelect?: (startTime: Date, endTime: Date) => void;
};

type LogsShellProps = ShellProps & {
  page: number;
  onPageChange: (page: number) => void;
};

const shellProbe: MockFunction = getJestMockFunction();
const logsShellProbe: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (props: ShellProps) => {
      shellProbe(props);
      return null;
    },
  };
});

jest.mock("../../../UI/Components/LogsViewer/LogsViewer", () => {
  return {
    __esModule: true,
    default: (props: LogsShellProps) => {
      logsShellProbe(props);
      return null;
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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      count: () => {
        return Promise.resolve(0);
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
      getFriendlyMessage: () => {
        return "error";
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySavedViewsControl",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import TracesViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer";
import ExceptionsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsViewer";
import DashboardLogsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import ProjectUtil from "../../../UI/Utils/Project";

const FIRST_START: string = "2026-08-20T10:00:00.000Z";
const FIRST_END: string = "2026-08-20T10:15:00.000Z";
const SECOND_START: string = "2026-08-20T10:03:00.000Z";
const SECOND_END: string = "2026-08-20T10:05:00.000Z";

function between(startIso: string, endIso: string): InBetween<Date> {
  return new InBetween<Date>(new Date(startIso), new Date(endIso));
}

function shellWindow(): string {
  const calls: Array<Array<unknown>> = shellProbe.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const props: ShellProps = calls[calls.length - 1]![0] as ShellProps;
  expect(props.timeRange.range).toBe(TimeRange.CUSTOM);
  return `${props.timeRange.startAndEndDate!.startValue.toISOString()}..${props.timeRange.startAndEndDate!.endValue.toISOString()}`;
}

function lastShellProps(): ShellProps {
  const calls: Array<Array<unknown>> = shellProbe.mock.calls;
  return calls[calls.length - 1]![0] as ShellProps;
}

function lastHistogramWindow(path: string): string {
  const requests: Array<Record<string, unknown>> = postMock.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as { url: { toString: () => string }; data: any };
    })
    .filter((args: { url: { toString: () => string } }): boolean => {
      return args.url.toString().includes(path);
    })
    .map((args: { data: any }) => {
      return args.data as Record<string, unknown>;
    });
  expect(requests.length).toBeGreaterThan(0);
  const last: Record<string, unknown> = requests[requests.length - 1]!;
  return `${last["startTime"]}..${last["endTime"]}`;
}

interface ViewerCase {
  name: string;
  histogramPath: string;
  element: (window: InBetween<Date>) => React.ReactElement;
}

const CASES: Array<ViewerCase> = [
  {
    name: "the traces explorer",
    histogramPath: "/telemetry/traces/histogram",
    element: (window: InBetween<Date>): React.ReactElement => {
      return (
        <TracesViewer
          spanQuery={{ startTime: window } as any}
          limit={10}
          disableUrlSync={true}
        />
      );
    },
  },
  {
    name: "the exceptions explorer",
    histogramPath: "/telemetry/exceptions/histogram",
    element: (window: InBetween<Date>): React.ReactElement => {
      return (
        <ExceptionsViewer
          exceptionInstanceQuery={{ time: window } as any}
          limit={10}
          disableUrlSync={true}
        />
      );
    },
  },
];

beforeEach(() => {
  shellProbe.mockReset();
  logsShellProbe.mockReset();
  getListMock.mockReset();
  analyticsGetListMock.mockReset();
  postMock.mockReset();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID("11111111-1111-4111-8111-111111111111"));
  getListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  analyticsGetListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  postMock.mockImplementation(async () => {
    return { data: {} };
  });
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe.each(CASES)(
  "$name pinned to a host's window",
  (viewerCase: ViewerCase) => {
    test("starts on the pinned window", async () => {
      await act(async () => {
        render(viewerCase.element(between(FIRST_START, FIRST_END)));
      });

      expect(shellWindow()).toBe(`${FIRST_START}..${FIRST_END}`);
      await waitFor(() => {
        expect(lastHistogramWindow(viewerCase.histogramPath)).toBe(
          `${FIRST_START}..${FIRST_END}`,
        );
      });
    });

    test("follows a new pinned window, chart request included", async () => {
      let rendered: ReturnType<typeof render> | null = null;
      await act(async () => {
        rendered = render(viewerCase.element(between(FIRST_START, FIRST_END)));
      });

      await act(async () => {
        rendered!.rerender(
          viewerCase.element(between(SECOND_START, SECOND_END)),
        );
      });

      expect(shellWindow()).toBe(`${SECOND_START}..${SECOND_END}`);
      await waitFor(() => {
        expect(lastHistogramWindow(viewerCase.histogramPath)).toBe(
          `${SECOND_START}..${SECOND_END}`,
        );
      });
    });

    test("an equal but rebuilt pin does not undo a zoom the reader made inside", async () => {
      let rendered: ReturnType<typeof render> | null = null;
      await act(async () => {
        rendered = render(viewerCase.element(between(FIRST_START, FIRST_END)));
      });

      await act(async () => {
        lastShellProps().onHistogramTimeRangeSelect!(
          new Date("2026-08-20T10:07:00.000Z"),
          new Date("2026-08-20T10:08:00.000Z"),
        );
      });
      expect(shellWindow()).toBe(
        "2026-08-20T10:07:00.000Z..2026-08-20T10:08:00.000Z",
      );

      // The host re-renders with a NEW query object for the SAME window.
      await act(async () => {
        rendered!.rerender(viewerCase.element(between(FIRST_START, FIRST_END)));
      });

      expect(shellWindow()).toBe(
        "2026-08-20T10:07:00.000Z..2026-08-20T10:08:00.000Z",
      );
    });

    test("a new pin after a zoom inside still wins: the host moved", async () => {
      let rendered: ReturnType<typeof render> | null = null;
      await act(async () => {
        rendered = render(viewerCase.element(between(FIRST_START, FIRST_END)));
      });

      await act(async () => {
        lastShellProps().onHistogramTimeRangeSelect!(
          new Date("2026-08-20T10:07:00.000Z"),
          new Date("2026-08-20T10:08:00.000Z"),
        );
      });

      await act(async () => {
        rendered!.rerender(
          viewerCase.element(between(SECOND_START, SECOND_END)),
        );
      });

      expect(shellWindow()).toBe(`${SECOND_START}..${SECOND_END}`);
    });
  },
);

describe("the logs explorer pinned to a host's window", () => {
  const ZOOM_START: string = "2026-08-20T10:07:00.000Z";
  const ZOOM_END: string = "2026-08-20T10:08:00.000Z";

  beforeEach(() => {
    // Enough rows for a second page: the explorer clamps its page to the count.
    analyticsGetListMock.mockImplementation(async () => {
      return { data: [], count: 100 };
    });
  });

  function logQueryFor(
    window: InBetween<Date>,
    extra?: Record<string, unknown>,
  ): Record<string, unknown> {
    return { time: window, ...(extra || {}) };
  }

  function logsElement(logQuery: Record<string, unknown>): React.ReactElement {
    return (
      <DashboardLogsViewer
        id="snapshot-logs"
        logQuery={logQuery as any}
        limit={10}
        noLogsMessage="No logs found"
      />
    );
  }

  function lastLogsShellProps(): LogsShellProps {
    const calls: Array<Array<unknown>> = logsShellProbe.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1]![0] as LogsShellProps;
  }

  // The window the explorer's picker, histogram and facets are on.
  function logsShellWindow(): string {
    const props: LogsShellProps = lastLogsShellProps();
    expect(props.timeRange.range).toBe(TimeRange.CUSTOM);
    return `${props.timeRange.startAndEndDate!.startValue.toISOString()}..${props.timeRange.startAndEndDate!.endValue.toISOString()}`;
  }

  function listQueries(): Array<Record<string, unknown>> {
    return analyticsGetListMock.mock.calls.map(
      (call: Array<unknown>): Record<string, unknown> => {
        return (call[0] as { query: Record<string, unknown> }).query;
      },
    );
  }

  // The window the log list was last fetched for.
  function lastListWindow(): string {
    const queries: Array<Record<string, unknown>> = listQueries();
    expect(queries.length).toBeGreaterThan(0);
    const time: InBetween<Date> = queries[queries.length - 1]![
      "time"
    ] as InBetween<Date>;
    return `${time.startValue.toISOString()}..${time.endValue.toISOString()}`;
  }

  async function renderPinned(
    logQuery: Record<string, unknown>,
  ): Promise<ReturnType<typeof render>> {
    let rendered: ReturnType<typeof render> | null = null;
    await act(async () => {
      rendered = render(logsElement(logQuery));
    });
    return rendered!;
  }

  async function zoomInside(): Promise<void> {
    await act(async () => {
      lastLogsShellProps().onHistogramTimeRangeSelect!(
        new Date(ZOOM_START),
        new Date(ZOOM_END),
      );
    });
    expect(logsShellWindow()).toBe(`${ZOOM_START}..${ZOOM_END}`);
    await waitFor(() => {
      expect(lastListWindow()).toBe(`${ZOOM_START}..${ZOOM_END}`);
    });
  }

  test("starts on the pinned window: list, histogram and picker", async () => {
    await renderPinned(logQueryFor(between(FIRST_START, FIRST_END)));

    expect(logsShellWindow()).toBe(`${FIRST_START}..${FIRST_END}`);
    await waitFor(() => {
      expect(lastListWindow()).toBe(`${FIRST_START}..${FIRST_END}`);
    });
    await waitFor(() => {
      expect(lastHistogramWindow("/telemetry/logs/histogram")).toBe(
        `${FIRST_START}..${FIRST_END}`,
      );
    });
  });

  test("follows a new pinned window, list and chart requests included", async () => {
    const rendered: ReturnType<typeof render> = await renderPinned(
      logQueryFor(between(FIRST_START, FIRST_END)),
    );

    await act(async () => {
      rendered.rerender(
        logsElement(logQueryFor(between(SECOND_START, SECOND_END))),
      );
    });

    expect(logsShellWindow()).toBe(`${SECOND_START}..${SECOND_END}`);
    await waitFor(() => {
      expect(lastListWindow()).toBe(`${SECOND_START}..${SECOND_END}`);
    });
    await waitFor(() => {
      expect(lastHistogramWindow("/telemetry/logs/histogram")).toBe(
        `${SECOND_START}..${SECOND_END}`,
      );
    });
  });

  test("an equal but rebuilt pin does not undo a zoom the reader made inside", async () => {
    const rendered: ReturnType<typeof render> = await renderPinned(
      logQueryFor(between(FIRST_START, FIRST_END)),
    );
    await zoomInside();

    // The host re-renders with a NEW query object for the SAME window.
    await act(async () => {
      rendered.rerender(
        logsElement(logQueryFor(between(FIRST_START, FIRST_END))),
      );
    });

    // The picker and the chart stay on the zoom...
    expect(logsShellWindow()).toBe(`${ZOOM_START}..${ZOOM_END}`);
    await waitFor(() => {
      expect(lastHistogramWindow("/telemetry/logs/histogram")).toBe(
        `${ZOOM_START}..${ZOOM_END}`,
      );
    });
    // ...and so does the list, which is fetched from a query of its own.
    expect(lastListWindow()).toBe(`${ZOOM_START}..${ZOOM_END}`);
  });

  test("an equal but rebuilt pin neither refetches the list nor moves the reader off their page", async () => {
    const rendered: ReturnType<typeof render> = await renderPinned(
      logQueryFor(between(FIRST_START, FIRST_END)),
    );
    await zoomInside();

    await act(async () => {
      lastLogsShellProps().onPageChange(2);
    });
    await waitFor(() => {
      expect(lastLogsShellProps().page).toBe(2);
    });
    const listRequests: number = listQueries().length;

    await act(async () => {
      rendered.rerender(
        logsElement(logQueryFor(between(FIRST_START, FIRST_END))),
      );
    });

    expect(lastLogsShellProps().page).toBe(2);
    expect(listQueries().length).toBe(listRequests);
  });

  test("an equal but rebuilt query with a scope of its own reloads neither the chart nor the facet counts", async () => {
    // A stored log monitor query: an attribute scope and an entity scope.
    const scopedQuery: () => Record<string, unknown> = (): Record<
      string,
      unknown
    > => {
      return logQueryFor(between(FIRST_START, FIRST_END), {
        attributes: { "resource.service.name": "checkout" },
        entityKeys: new Includes(["k8s-pod-1"]),
      });
    };
    const rendered: ReturnType<typeof render> =
      await renderPinned(scopedQuery());
    await zoomInside();
    await waitFor(() => {
      expect(lastHistogramWindow("/telemetry/logs/histogram")).toBe(
        `${ZOOM_START}..${ZOOM_END}`,
      );
    });
    await waitFor(() => {
      expect(lastHistogramWindow("/telemetry/logs/facets")).toBe(
        `${ZOOM_START}..${ZOOM_END}`,
      );
    });
    const requests: number = postMock.mock.calls.length;

    await act(async () => {
      rendered.rerender(logsElement(scopedQuery()));
    });

    expect(postMock.mock.calls.length).toBe(requests);
    expect(logsShellWindow()).toBe(`${ZOOM_START}..${ZOOM_END}`);
  });

  test("a new pin after a zoom inside still wins: the host moved", async () => {
    const rendered: ReturnType<typeof render> = await renderPinned(
      logQueryFor(between(FIRST_START, FIRST_END)),
    );
    await zoomInside();

    await act(async () => {
      rendered.rerender(
        logsElement(logQueryFor(between(SECOND_START, SECOND_END))),
      );
    });

    expect(logsShellWindow()).toBe(`${SECOND_START}..${SECOND_END}`);
    await waitFor(() => {
      expect(lastListWindow()).toBe(`${SECOND_START}..${SECOND_END}`);
    });
    expect(lastLogsShellProps().page).toBe(1);
  });

  test("a pin the host takes away leaves the reader on the window they were on", async () => {
    const rendered: ReturnType<typeof render> = await renderPinned(
      logQueryFor(between(FIRST_START, FIRST_END)),
    );
    await zoomInside();

    await act(async () => {
      rendered.rerender(logsElement({}));
    });

    expect(logsShellWindow()).toBe(`${ZOOM_START}..${ZOOM_END}`);
    await waitFor(() => {
      expect(lastListWindow()).toBe(`${ZOOM_START}..${ZOOM_END}`);
    });
  });

  test("a new scope under the same pin re-queries the list for it, over the reader's zoom", async () => {
    const rendered: ReturnType<typeof render> = await renderPinned(
      logQueryFor(between(FIRST_START, FIRST_END)),
    );
    await zoomInside();

    await act(async () => {
      rendered.rerender(
        logsElement(
          logQueryFor(between(FIRST_START, FIRST_END), {
            severityText: new Includes(["Error"]),
          }),
        ),
      );
    });

    await waitFor(() => {
      const queries: Array<Record<string, unknown>> = listQueries();
      expect(queries[queries.length - 1]!["severityText"]).toBeInstanceOf(
        Includes,
      );
    });
    expect(lastListWindow()).toBe(`${ZOOM_START}..${ZOOM_END}`);
    expect(logsShellWindow()).toBe(`${ZOOM_START}..${ZOOM_END}`);
  });

  test("the zoom made inside still resets to the pin after an equal rebuild", async () => {
    const rendered: ReturnType<typeof render> = await renderPinned(
      logQueryFor(between(FIRST_START, FIRST_END)),
    );
    await zoomInside();

    await act(async () => {
      rendered.rerender(
        logsElement(logQueryFor(between(FIRST_START, FIRST_END))),
      );
    });

    // What the explorer's Reset zoom asks the host for: the pin again.
    await act(async () => {
      (
        lastLogsShellProps() as unknown as {
          onTimeRangeChange: (value: unknown) => void;
        }
      ).onTimeRangeChange({
        range: TimeRange.CUSTOM,
        startAndEndDate: between(FIRST_START, FIRST_END),
      });
    });

    expect(logsShellWindow()).toBe(`${FIRST_START}..${FIRST_END}`);
    await waitFor(() => {
      expect(lastListWindow()).toBe(`${FIRST_START}..${FIRST_END}`);
    });
  });
});

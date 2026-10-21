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
 * The traces explorer commits only its newest request (issue #4105 review).
 *
 * A zoom, a reset, a new pinned window (a telemetry snapshot's zoom now
 * re-pins a Traces primary on every drag and reset) or a new filter starts
 * a span-list and a histogram request while older ones are still out. The
 * older answer - usually for the wider window, and slower - used to land
 * last and paint the window the reader had just left, under a picker that
 * named the new one. Live polling must not starve a slow list either: a
 * poll never replaces a request that is still out.
 *
 * The real TracesViewer and TelemetryViewer run against a data layer whose
 * answers each test releases in the order it wants; recharts is stood in
 * for with a chart that lays each bucket out as a div.
 */

interface Held<T> {
  args: Record<string, any>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

type ListAnswer = { data: Array<Record<string, unknown>>; count: number };
type PostAnswer = { data: Record<string, unknown> };

const heldLists: Array<Held<ListAnswer>> = [];
const heldHistograms: Array<Held<PostAnswer>> = [];

const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
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
        return "The request failed.";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return null;
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

jest.mock("recharts", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  interface StubRow {
    time: string;
  }

  interface StubChartProps {
    data: Array<StubRow>;
    children?: React.ReactNode;
    onMouseDown?: (state: { activeLabel: string }) => void;
    onMouseMove?: (state: { activeLabel: string }) => void;
    onMouseUp?: (state: { activeLabel: string }) => void;
  }

  const chart: (
    kind: string,
  ) => (props: StubChartProps) => React.ReactElement = (kind: string) => {
    return (props: StubChartProps): React.ReactElement => {
      return react.createElement(
        "div",
        { "data-testid": `${kind}-chart` },
        props.data.map((row: StubRow) => {
          return react.createElement("div", {
            key: row.time,
            "data-testid": `bucket-${row.time}`,
            onMouseDown: () => {
              props.onMouseDown?.({ activeLabel: row.time });
            },
            onMouseMove: () => {
              props.onMouseMove?.({ activeLabel: row.time });
            },
            onMouseUp: () => {
              props.onMouseUp?.({ activeLabel: row.time });
            },
          });
        }),
        props.children,
      );
    };
  };

  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    AreaChart: chart("area"),
    BarChart: chart("bar"),
    LineChart: chart("line"),
    Area: nothing,
    Bar: nothing,
    Line: nothing,
    XAxis: nothing,
    YAxis: nothing,
    CartesianGrid: nothing,
    Tooltip: nothing,
    ReferenceArea: nothing,
  };
});

import TracesViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer";

const NOW: Date = new Date("2026-09-17T11:00:00.000Z");
// The past hour's histogram is two-minute bars.
const HOUR_A: string = "2026-09-17 10:40:00";
const HOUR_B: string = "2026-09-17 10:42:00";
// A zoom into them asks for finer bars.
const ZOOM_A: string = "2026-09-17 10:41:00";
const ZOOM_B: string = "2026-09-17 10:42:30";

function span(name: string): Record<string, unknown> {
  return {
    _id: `${name}-id`,
    name: name,
    traceId: `${name}-trace`,
    spanId: `${name}-span`,
    startTime: NOW,
    durationUnixNano: 1000000,
    statusCode: 0,
    kind: "SPAN_KIND_SERVER",
    attributes: {},
  };
}

function listAnswer(...names: Array<string>): ListAnswer {
  return {
    data: names.map((name: string) => {
      return span(name);
    }),
    count: names.length,
  };
}

function histogramAnswer(...times: Array<string>): PostAnswer {
  return {
    data: {
      buckets: times.map((time: string) => {
        return { time, series: "ok", count: 3 };
      }),
    },
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function release<T>(held: Held<T>, value: T): Promise<void> {
  await act(async () => {
    held.resolve(value);
    await Promise.resolve();
  });
  await settle();
}

async function fail<T>(held: Held<T>): Promise<void> {
  await act(async () => {
    held.reject(new Error("timed out"));
    await Promise.resolve();
  });
  await settle();
}

function windowOf<T>(held: Held<T>): string {
  const query: Record<string, any> = held.args["query"] || {};
  const range: { startValue?: Date; endValue?: Date } | undefined =
    query["startTime"];
  if (range?.startValue && range.endValue) {
    return `${new Date(range.startValue).toISOString()}..${new Date(range.endValue).toISOString()}`;
  }
  return `${held.args["startTime"]}..${held.args["endTime"]}`;
}

async function renderExplorer(): Promise<void> {
  window.history.replaceState({}, "", "/");
  await act(async () => {
    render(<TracesViewer />);
  });
  await settle();
}

// The explorer's first requests are out; answer the histogram so it can be dragged.
async function renderWithHistogram(): Promise<Held<ListAnswer>> {
  await renderExplorer();
  expect(heldLists).toHaveLength(1);
  expect(heldHistograms).toHaveLength(1);
  const firstList: Held<ListAnswer> = heldLists[0]!;
  await release(heldHistograms[0]!, histogramAnswer(HOUR_A, HOUR_B));
  await waitFor(() => {
    expect(screen.getByTestId(`bucket-${HOUR_A}`)).toBeInTheDocument();
  });
  return firstList;
}

function drag(from: string, to: string): void {
  fireEvent.mouseDown(screen.getByTestId(`bucket-${from}`));
  fireEvent.mouseMove(screen.getByTestId(`bucket-${to}`));
  fireEvent.mouseUp(screen.getByTestId(`bucket-${to}`));
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  window.localStorage.clear();
  heldLists.length = 0;
  heldHistograms.length = 0;
  getListMock.mockReset();
  analyticsGetListMock.mockReset();
  postMock.mockReset();

  getListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  analyticsGetListMock.mockImplementation((args: Record<string, any>) => {
    return new Promise<ListAnswer>(
      (
        resolve: (value: ListAnswer) => void,
        reject: (error: Error) => void,
      ) => {
        heldLists.push({ args, resolve, reject });
      },
    );
  });
  postMock.mockImplementation(
    (args: { url: { toString: () => string }; data: Record<string, any> }) => {
      const url: string = args.url.toString();
      if (url.includes("/telemetry/traces/histogram")) {
        return new Promise<PostAnswer>(
          (
            resolve: (value: PostAnswer) => void,
            reject: (error: Error) => void,
          ) => {
            heldHistograms.push({ args: args.data, resolve, reject });
          },
        );
      }
      if (url.includes("/telemetry/traces/facets")) {
        return Promise.resolve({ data: { facets: {} } });
      }
      return Promise.resolve({ data: {} });
    },
  );
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe("the traces explorer's span list commits only its newest request", () => {
  test("the past hour answering after a zoom never paints over the zoomed list", async () => {
    const pastHour: Held<ListAnswer> = await renderWithHistogram();

    drag(HOUR_A, HOUR_B);
    await settle();
    expect(heldLists).toHaveLength(2);
    const zoomed: Held<ListAnswer> = heldLists[1]!;
    expect(windowOf(zoomed)).not.toBe(windowOf(pastHour));

    await release(zoomed, listAnswer("GET /zoomed"));
    expect(screen.getByText("GET /zoomed")).toBeInTheDocument();

    // The wider, slower answer lands last.
    await release(pastHour, listAnswer("GET /past-hour"));

    expect(screen.queryByText("GET /past-hour")).toBeNull();
    expect(screen.getByText("GET /zoomed")).toBeInTheDocument();
  });

  test("a superseded request's failure shows no error over the newer list", async () => {
    const pastHour: Held<ListAnswer> = await renderWithHistogram();

    drag(HOUR_A, HOUR_B);
    await settle();
    await release(heldLists[1]!, listAnswer("GET /zoomed"));
    await fail(pastHour);

    expect(screen.queryByText("The request failed.")).toBeNull();
    expect(screen.getByText("GET /zoomed")).toBeInTheDocument();
  });

  test("the newest request's own failure still shows", async () => {
    const pastHour: Held<ListAnswer> = await renderWithHistogram();

    drag(HOUR_A, HOUR_B);
    await settle();
    await release(pastHour, listAnswer("GET /past-hour"));
    expect(screen.queryByText("GET /past-hour")).toBeNull();

    await fail(heldLists[1]!);

    await waitFor(() => {
      expect(screen.getByText("The request failed.")).toBeInTheDocument();
    });
  });

  test("answers in order still commit the newest", async () => {
    const pastHour: Held<ListAnswer> = await renderWithHistogram();

    drag(HOUR_A, HOUR_B);
    await settle();
    await release(pastHour, listAnswer("GET /past-hour"));
    await release(heldLists[1]!, listAnswer("GET /zoomed"));

    expect(screen.queryByText("GET /past-hour")).toBeNull();
    expect(screen.getByText("GET /zoomed")).toBeInTheDocument();
  });
});

describe("the traces explorer's histogram commits only its newest request", () => {
  test("a zoomed histogram answering after the reset never paints over it", async () => {
    await renderWithHistogram();

    drag(HOUR_A, HOUR_B);
    await settle();
    expect(heldHistograms).toHaveLength(2);
    const zoomed: Held<PostAnswer> = heldHistograms[1]!;

    // Straight back out, before the zoomed histogram has answered.
    fireEvent.doubleClick(screen.getByTestId("bar-chart"));
    await settle();
    expect(heldHistograms).toHaveLength(3);
    const reset: Held<PostAnswer> = heldHistograms[2]!;

    await release(reset, histogramAnswer(HOUR_A, HOUR_B));
    await release(zoomed, histogramAnswer(ZOOM_A, ZOOM_B));

    expect(screen.queryByTestId(`bucket-${ZOOM_A}`)).toBeNull();
    expect(screen.getByTestId(`bucket-${HOUR_A}`)).toBeInTheDocument();
  });
});

describe("live polling never replaces a request that is still out", () => {
  test("a slow list is not asked for again every poll, and polling resumes once it lands", async () => {
    await renderWithHistogram();
    await release(heldLists[0]!, listAnswer("GET /first"));

    fireEvent.click(screen.getByTitle("Enable live updates"));
    await settle();

    // The first poll asks; its answer is slow.
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    await settle();
    expect(heldLists).toHaveLength(2);

    // Three more intervals pass while it is out: no poll replaces it.
    await act(async () => {
      jest.advanceTimersByTime(30000);
    });
    await settle();
    expect(heldLists).toHaveLength(2);

    await release(heldLists[1]!, listAnswer("GET /polled"));
    expect(screen.getByText("GET /polled")).toBeInTheDocument();

    // Landed: the next interval polls again.
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    await settle();
    expect(heldLists).toHaveLength(3);
  });
});

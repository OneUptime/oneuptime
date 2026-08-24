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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The per-series investigate menu is the chart's bridge from "this series
 * is spiking" to the signals that explain it: the chip's magnifier must
 * open a menu whose pivots carry the series' group-by labels as REAL
 * filters (logs/traces URLs), whose "Filter to this series" narrows the
 * live explorer view, and whose resource entry lands on the host page the
 * series is about. Rendering the real MetricCharts (not a stub) pins the
 * whole chain: series naming → chip → menu → scoped URL.
 */

/*
 * ResponsiveContainer measures its parent, which is always 0x0 in jsdom,
 * so the chart renders nothing without a fixed size.
 */
jest.mock("recharts", () => {
  const actual: Record<string, any> = jest.requireActual("recharts") as Record<
    string,
    any
  >;
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => {
      return React.cloneElement(children, {
        width: 600,
        height: 300,
      } as Record<string, unknown>);
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const fetchExemplarsMock: MockFunction = getJestMockFunction();
const showToastMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factory runs. Dereferencing them lazily, at call time, is what makes
 * this work.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Components/Toast/ToastInit", () => {
  return {
    __esModule: true,
    ShowToastNotification: (...args: Array<any>) => {
      return showToastMock(...args);
    },
  };
});

/*
 * Keep the exemplar fetch (fired by MetricCharts whenever the view has a
 * resolvable window) off the network; everything else on the Metrics util
 * surface that MetricCharts touches is pure enough to stub inline.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchExemplars: (...args: Array<any>) => {
          fetchExemplarsMock(...args);
          /*
           * Never resolves: a resolved exemplar set would setState after
           * each test's assertions and trip React's act() warning; no
           * test here cares about exemplar dots.
           */
          return new Promise(() => {
            // Intentionally never settles.
          });
        },
        setQueryTopNOverride: () => {
          return undefined;
        },
        getQueryConfigTopNKey: (
          _queryConfig: unknown,
          index: number,
          scope?: string,
        ) => {
          return `${scope || ""}:${index}`;
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
        serializeAttributeFiltersForKey: (attributes: unknown) => {
          return JSON.stringify(attributes || {});
        },
      },
      DEFAULT_TOP_N_SERIES: 10,
      SHOW_ALL_SERIES_TOP_N: 10_000,
      sanitizeAttributeFilters: (attributes: unknown) => {
        return attributes;
      },
    };
  },
);

import MetricCharts from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "77777777-1111-4111-8111-777777777777",
);
const HOST_MODEL_ID: string = "88888888-2222-4222-8222-888888888888";

const WINDOW_START: Date = new Date("2026-08-20T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-08-20T11:00:00.000Z");

function buildQueryConfig(): MetricQueryConfigData {
  return {
    metricAliasData: { metricVariable: "a" },
    metricQueryData: {
      filterData: {
        metricName: "cpu.usage",
        attributes: {},
        aggegationType: MetricsAggregationType.Avg,
      },
      groupByAttributeKeys: ["host.name"],
    },
  } as unknown as MetricQueryConfigData;
}

function buildViewData(): MetricViewData {
  return {
    queryConfigs: [buildQueryConfig()],
    formulaConfigs: [],
    startAndEndDate: new InBetween<Date>(WINDOW_START, WINDOW_END),
  } as MetricViewData;
}

function buildResults(): Array<AggregatedResult> {
  const timestamps: Array<string> = [
    "2026-08-20T10:10:00.000Z",
    "2026-08-20T10:20:00.000Z",
  ];
  const data: Array<Record<string, unknown>> = [];
  for (const host of ["web-01", "web-02"]) {
    for (const [index, timestamp] of timestamps.entries()) {
      data.push({
        timestamp: new Date(timestamp),
        value: host === "web-01" ? 90 + index : 10 + index,
        attributes: { "host.name": host },
      });
    }
  }
  return [{ data, truncated: false } as unknown as AggregatedResult];
}

let navigateSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  getListMock.mockReset();
  fetchExemplarsMock.mockReset();
  showToastMock.mockReset();
  navigateSpy = jest.spyOn(Navigation, "navigate").mockImplementation(() => {
    return undefined;
  });
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  jest.restoreAllMocks();
  cleanup();
});

function getNavigatedUrl(): string {
  const lastCall: Array<unknown> | undefined =
    navigateSpy.mock.calls[navigateSpy.mock.calls.length - 1];
  return decodeURIComponent(String(lastCall?.[0]));
}

describe("per-series investigate menu", () => {
  test("each series chip carries an investigate button that opens the menu", () => {
    render(
      <MetricCharts
        metricViewData={buildViewData()}
        metricResults={buildResults()}
        metricTypes={[]}
      />,
    );

    fireEvent.click(screen.getByLabelText("Investigate host.name=web-01"));

    const menu: HTMLElement = screen.getByRole("menu", {
      name: "Series investigation actions",
    });
    expect(menu).toBeInTheDocument();
    expect(screen.getByText("View logs")).toBeInTheDocument();
    expect(screen.getByText("View traces")).toBeInTheDocument();
    expect(screen.getByText("View exceptions")).toBeInTheDocument();
    // The menu header names the series and what it is scoped to.
    expect(menu.textContent).toContain("host.name = web-01");
  });

  test("read-only hosts get an explorer deep link; read-write hosts filter in place", () => {
    const onQueryConfigsChange: MockFunction = getJestMockFunction();

    const { unmount } = render(
      <MetricCharts
        metricViewData={buildViewData()}
        metricResults={buildResults()}
        metricTypes={[]}
      />,
    );

    fireEvent.click(screen.getByLabelText("Investigate host.name=web-01"));
    expect(screen.getByText("Open in Metric Explorer")).toBeInTheDocument();
    expect(screen.queryByText("Filter to this series")).toBeNull();
    unmount();

    render(
      <MetricCharts
        metricViewData={buildViewData()}
        metricResults={buildResults()}
        metricTypes={[]}
        onQueryConfigsChange={(...args: Array<any>) => {
          onQueryConfigsChange(...args);
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Investigate host.name=web-01"));
    expect(screen.queryByText("Open in Metric Explorer")).toBeNull();

    fireEvent.click(screen.getByText("Filter to this series"));

    expect(onQueryConfigsChange).toHaveBeenCalledTimes(1);
    const narrowedConfigs: Array<MetricQueryConfigData> = onQueryConfigsChange
      .mock.calls[0]?.[0] as Array<MetricQueryConfigData>;
    expect(
      (
        narrowedConfigs[0]?.metricQueryData.filterData as Record<
          string,
          unknown
        >
      )["attributes"],
    ).toEqual({ "host.name": "web-01" });
  });

  test("View logs navigates to the logs explorer scoped to the series and window", async () => {
    render(
      <MetricCharts
        metricViewData={buildViewData()}
        metricResults={buildResults()}
        metricTypes={[]}
      />,
    );

    fireEvent.click(screen.getByLabelText("Investigate host.name=web-02"));
    fireEvent.click(screen.getByText("View logs"));

    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalled();
    });

    const url: string = getNavigatedUrl();
    expect(url).toContain("/logs");
    expect(url).toContain('["attributes.host.name",["web-02"]]');
    expect(url).toContain("range=Custom");
    expect(url).toContain("start=");
    expect(url).toContain("end=");
  });

  test("View exceptions reports what the exceptions grammar cannot carry", async () => {
    render(
      <MetricCharts
        metricViewData={buildViewData()}
        metricResults={buildResults()}
        metricTypes={[]}
      />,
    );

    fireEvent.click(screen.getByLabelText("Investigate host.name=web-01"));
    fireEvent.click(screen.getByText("View exceptions"));

    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalled();
    });

    const url: string = getNavigatedUrl();
    expect(url).toContain("/exceptions");
    expect(url).toContain("status=all");
    // The host.name narrowing has no exceptions facet — the user is told.
    expect(showToastMock).toHaveBeenCalled();
  });

  test("the host series jumps to the matching Host page", async () => {
    getListMock.mockReturnValue(
      Promise.resolve({ data: [{ _id: HOST_MODEL_ID }] }),
    );

    render(
      <MetricCharts
        metricViewData={buildViewData()}
        metricResults={buildResults()}
        metricTypes={[]}
      />,
    );

    fireEvent.click(screen.getByLabelText("Investigate host.name=web-01"));
    fireEvent.click(screen.getByText('Open host "web-01"'));

    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalled();
    });

    const listArgs: Record<string, unknown> = getListMock.mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(listArgs["query"]).toEqual({
      projectId: PROJECT_ID,
      hostIdentifier: "web-01",
    });
    expect(getNavigatedUrl()).toContain(`/host/${HOST_MODEL_ID}`);
  });

  test("enableSeriesActions={false} renders plain chips with no investigate affordance", () => {
    render(
      <MetricCharts
        metricViewData={buildViewData()}
        metricResults={buildResults()}
        metricTypes={[]}
        enableSeriesActions={false}
      />,
    );

    // The chips themselves still render…
    expect(screen.getByText("host.name=web-01")).toBeInTheDocument();
    // …but nothing offers navigation.
    expect(screen.queryByLabelText("Investigate host.name=web-01")).toBeNull();
  });
});

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
import { act, cleanup, render, RenderResult } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4709, on the metrics explorer: one read of the metric list and of
 * each row's sparkline per page load and per real change.
 *
 * The list query was keyed on the project's service list itself, which
 * lands a moment after mount. With no `service:` token it changed nothing in
 * the query, but rebuilt it - so the metric list was read twice on every
 * load, and since each answer is a new array of rows, every row's sparkline
 * (one ClickHouse aggregate per metric) was aggregated twice too. A page
 * embedding the explorer re-rendering with an equal scope
 * (`serviceIds={[modelId]}`, `attributeFilters={{...}}`) read it all again.
 *
 * The real MetricsViewer runs with TelemetryViewer captured and the data
 * layer mocked. The clock moves on a little with every list answer, as it
 * does on a real page: a sparkline read again for the same names then asks
 * for a later window, which the aggregate cache cannot answer.
 */

let viewerProps: any = null;

jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (props: any) => {
      viewerProps = props;
      return null;
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();
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
      aggregate: (...args: Array<any>) => {
        return aggregateMock(...args);
      },
      getCommonHeaders: () => {
        return {};
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
      getFriendlyMessage: (error: unknown) => {
        return error instanceof Error ? error.message : "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  return {
    __esModule: true,
    default: () => {
      return {};
    },
  };
});

import MetricsViewer, {
  resolveMetricsServiceToken,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricsViewer";
import { parseMetricsSearch } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricsSearchQuery";
import Metric from "../../../Models/AnalyticsModels/Metric";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SERVICE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_SERVICE_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const METRIC_NAMES: Array<string> = [
  "http.server.duration",
  "process.cpu.utilization",
  "system.memory.usage",
];

/*
 * Every test gets its own hour, so the module-level aggregate cache never
 * answers one test's sparklines with another's.
 */
const BASE: number = new Date("2026-09-28T12:00:00.000Z").getTime();
let testHour: number = 0;

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function defer(): Deferred {
  let resolve: () => void = (): void => {};
  const promise: Promise<void> = new Promise<void>((res: () => void) => {
    resolve = res;
  });
  return { promise, resolve };
}

// When set, the project's service list waits for it.
let serviceListGate: Deferred | null = null;

type ModelType = { new (): unknown };

interface ListArgs {
  modelType: ModelType;
  query: Record<string, unknown>;
  skip: number;
  limit: number;
}

function listReads(): Array<ListArgs> {
  return getListMock.mock.calls
    .map((call: Array<unknown>): ListArgs => {
      return call[0] as ListArgs;
    })
    .filter((args: ListArgs): boolean => {
      return args.modelType === MetricType;
    });
}

function serviceListReads(): number {
  return getListMock.mock.calls.filter((call: Array<unknown>): boolean => {
    return (call[0] as ListArgs).modelType === Service;
  }).length;
}

function nameMatchReads(): number {
  return analyticsGetListMock.mock.calls.filter(
    (call: Array<unknown>): boolean => {
      return (call[0] as ListArgs).modelType === Metric;
    },
  ).length;
}

function sparklineReads(): number {
  return aggregateMock.mock.calls.length;
}

function facetReads(): number {
  return postMock.mock.calls.filter((call: Array<unknown>): boolean => {
    return String((call[0] as { url: unknown }).url).endsWith(
      "/telemetry/metrics/facets",
    );
  }).length;
}

function readCounts(): string {
  return JSON.stringify({
    list: listReads().length,
    nameMatch: nameMatchReads(),
    sparklines: sparklineReads(),
    facets: facetReads(),
  });
}

async function settle(): Promise<void> {
  for (let round: number = 0; round < 10; round++) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

async function mount(element: React.ReactElement): Promise<RenderResult> {
  let result: RenderResult | null = null;
  await act(async () => {
    result = render(element);
  });
  await settle();
  return result!;
}

async function openAt(search: string): Promise<RenderResult> {
  window.history.replaceState({}, "", `/dashboard/project/metrics${search}`);
  return mount(<MetricsViewer />);
}

function service(id: string, name: string): Service {
  const item: Service = new Service();
  item.id = new ObjectID(id);
  item.name = name;
  return item;
}

beforeEach(() => {
  jest.useFakeTimers();
  testHour += 1;
  jest.setSystemTime(new Date(BASE + testHour * 60 * 60 * 1000));
  window.history.replaceState({}, "", "/");
  viewerProps = null;
  serviceListGate = null;

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);

  getListMock.mockReset();
  analyticsGetListMock.mockReset();
  aggregateMock.mockReset();
  postMock.mockReset();

  getListMock.mockImplementation(async (args: unknown) => {
    const modelType: ModelType = (args as ListArgs).modelType;
    if (modelType === Service) {
      if (serviceListGate) {
        await serviceListGate.promise;
      }
      return {
        data: [
          service(SERVICE_ID, "checkout-api"),
          service(OTHER_SERVICE_ID, "billing-worker"),
        ],
        count: 2,
      };
    }
    if (modelType === MetricType) {
      // A list read takes a moment, as on a real page.
      jest.setSystemTime(new Date(Date.now() + 1500));
      return {
        data: METRIC_NAMES.map((name: string): MetricType => {
          const metricType: MetricType = new MetricType();
          metricType.name = name;
          return metricType;
        }),
        count: METRIC_NAMES.length,
      };
    }
    return { data: [], count: 0 };
  });
  analyticsGetListMock.mockImplementation(async () => {
    const metric: Metric = new Metric();
    metric.name = METRIC_NAMES[0]!;
    return { data: [metric], count: 1 };
  });
  aggregateMock.mockImplementation(async () => {
    return { data: [] };
  });
  postMock.mockImplementation(async () => {
    return { data: { facets: {}, attributes: [] } };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe("a page load reads the list and each sparkline once (#4709)", () => {
  test("REGRESSION: the service list landing after the first reads does not read the list or the sparklines again", async () => {
    serviceListGate = defer();

    await openAt("?range=Past%201%20Day");

    expect(listReads()).toHaveLength(1);
    expect(sparklineReads()).toBe(METRIC_NAMES.length);
    const before: string = readCounts();

    await act(async () => {
      serviceListGate!.resolve();
    });
    await settle();

    expect(serviceListReads()).toBe(1);
    expect(readCounts()).toBe(before);
  });

  test("a plain open: one list read, one aggregate per row, one facet read", async () => {
    await openAt("");

    expect(listReads()).toHaveLength(1);
    expect(sparklineReads()).toBe(METRIC_NAMES.length);
    expect(facetReads()).toBe(1);
    expect(nameMatchReads()).toBe(0);
  });

  test("a `service:` token waits for the names, then reads the list once with the service's id", async () => {
    serviceListGate = defer();

    await openAt(`?search=${encodeURIComponent("service:checkout")}`);

    // Before the names are in, the token cannot be applied: nothing is read.
    expect(listReads()).toHaveLength(0);
    expect(sparklineReads()).toBe(0);
    expect(viewerProps.isLoading).toBe(true);

    await act(async () => {
      serviceListGate!.resolve();
    });
    await settle();

    expect(listReads()).toHaveLength(1);
    expect(listReads()[0]!.query["services"]).toEqual(
      new Includes([new ObjectID(SERVICE_ID)]),
    );
    expect(sparklineReads()).toBe(METRIC_NAMES.length);
  });

  test("a `service:` token that names no service reads the list once, for nothing", async () => {
    await openAt(`?search=${encodeURIComponent("service:no-such-service")}`);

    expect(listReads()).toHaveLength(1);
    expect(listReads()[0]!.query["name"]).toBe("__no_match__");
  });
});

describe("an embedded explorer reads once, and only on a real change of its scope", () => {
  // A host's Metrics tab: scoped by its resource attribute and entity key.
  function hostMetrics(hostName: string): React.ReactElement {
    return (
      <MetricsViewer
        attributeFilters={{ "resource.host.name": hostName }}
        entityKeysFilter={[`host:${hostName}`]}
        disableUrlSync={true}
      />
    );
  }

  test("one name match, one list read, one aggregate per row", async () => {
    await mount(hostMetrics("web-01"));

    expect(nameMatchReads()).toBe(1);
    expect(listReads()).toHaveLength(1);
    expect(sparklineReads()).toBe(METRIC_NAMES.length);
    // A scoped view never loads the project's services.
    expect(serviceListReads()).toBe(0);
  });

  test("the page re-rendering with an equal scope (new objects, new arrays) reads nothing again", async () => {
    const view: RenderResult = await mount(hostMetrics("web-01"));
    const before: string = readCounts();

    for (let index: number = 0; index < 3; index++) {
      await act(async () => {
        view.rerender(hostMetrics("web-01"));
      });
      await settle();
    }

    expect(readCounts()).toBe(before);
  });

  test("a service page's fresh ObjectID on every render reads nothing again", async () => {
    const servicePage: () => React.ReactElement = (): React.ReactElement => {
      return (
        <MetricsViewer
          serviceIds={[new ObjectID(SERVICE_ID)]}
          disableUrlSync={true}
        />
      );
    };
    const view: RenderResult = await mount(servicePage());
    expect(listReads()).toHaveLength(1);
    const before: string = readCounts();

    await act(async () => {
      view.rerender(servicePage());
    });
    await settle();

    expect(readCounts()).toBe(before);
  });

  test("a new host: one name match, one list read, its sparklines", async () => {
    const view: RenderResult = await mount(hostMetrics("web-01"));

    await act(async () => {
      view.rerender(hostMetrics("web-02"));
    });
    await settle();

    expect(nameMatchReads()).toBe(2);
    /*
     * Once, after the new host's names are in - not first with the previous
     * host's names and then again.
     */
    expect(listReads()).toHaveLength(2);
    // The rows' sparklines, for the new host.
    expect(sparklineReads()).toBe(2 * METRIC_NAMES.length);
  });
});

describe("the name match answers for the scope on screen", () => {
  // Each host reports one metric of its own.
  const NAME_BY_HOST: Record<string, string> = {
    "web-01": "system.cpu.utilization",
    "web-02": "system.memory.usage",
  };

  function hostOf(args: unknown): string {
    const attributes: Record<string, unknown> =
      ((args as ListArgs).query["attributes"] as Record<string, unknown>) || {};
    return String(attributes["resource.host.name"] || "");
  }

  function hostMetrics(hostName: string): React.ReactElement {
    return (
      <MetricsViewer
        attributeFilters={{ "resource.host.name": hostName }}
        disableUrlSync={true}
      />
    );
  }

  test("a late match for a host the page has left is not used", async () => {
    const slowFirstHost: Deferred = defer();
    analyticsGetListMock.mockImplementation(async (args: unknown) => {
      const host: string = hostOf(args);
      if (host === "web-01") {
        await slowFirstHost.promise;
      }
      const metric: Metric = new Metric();
      metric.name = NAME_BY_HOST[host]!;
      return { data: [metric], count: 1 };
    });

    const view: RenderResult = await mount(hostMetrics("web-01"));
    // The list waits for web-01's names.
    expect(listReads()).toHaveLength(0);

    await act(async () => {
      view.rerender(hostMetrics("web-02"));
    });
    await settle();

    expect(listReads()).toHaveLength(1);
    expect(listReads()[0]!.query["name"]).toEqual(
      new Includes([NAME_BY_HOST["web-02"]!]),
    );

    // web-01's match lands now: too late to be the list's.
    await act(async () => {
      slowFirstHost.resolve();
    });
    await settle();

    expect(listReads()).toHaveLength(1);
    expect(viewerProps.isLoading).toBe(false);
  });

  test("a match still out when the scope stops needing one leaves no loader behind", async () => {
    const neverAnswers: Promise<void> = new Promise<void>(() => {});
    analyticsGetListMock.mockImplementation(async () => {
      await neverAnswers;
      return { data: [], count: 0 };
    });

    const view: RenderResult = await mount(hostMetrics("web-01"));
    expect(viewerProps.isLoading).toBe(true);

    // The page drops its attribute scope while the match is out.
    await act(async () => {
      view.rerender(<MetricsViewer disableUrlSync={true} />);
    });
    await settle();

    expect(listReads()).toHaveLength(1);
    expect(listReads()[0]!.query["name"]).toBeUndefined();
    expect(viewerProps.isLoading).toBe(false);
  });
});

describe("a real change reads once", () => {
  test("a new range: the rows' sparklines once more, the list not", async () => {
    await openAt("");
    const listBefore: number = listReads().length;

    await act(async () => {
      viewerProps.onTimeRangeChange({ range: TimeRange.PAST_ONE_WEEK });
    });
    await settle();

    // The metric list is not windowed; the sparklines are.
    expect(listReads()).toHaveLength(listBefore);
    expect(sparklineReads()).toBe(2 * METRIC_NAMES.length);
    expect(facetReads()).toBe(2);
  });

  test("paging: one list read, and sparklines only for rows not already drawn", async () => {
    await openAt("");

    await act(async () => {
      viewerProps.onPageChange(2);
    });
    await settle();

    expect(listReads()).toHaveLength(2);
    expect(listReads()[1]!.skip).toBe(listReads()[1]!.limit);
    /*
     * The mocked page 2 holds the same names: an equal list draws the
     * sparklines it already has rather than aggregating them again.
     */
    expect(sparklineReads()).toBe(METRIC_NAMES.length);
  });
});

describe("resolveMetricsServiceToken", () => {
  const services: Array<Service> = [
    service(SERVICE_ID, "checkout-api"),
    service(OTHER_SERVICE_ID, "billing-worker"),
  ];

  test("no token, or no names yet: nothing to apply", () => {
    expect(
      resolveMetricsServiceToken(
        parseMetricsSearch("").serviceMatcher,
        services,
      ),
    ).toBeNull();
    expect(
      resolveMetricsServiceToken(
        parseMetricsSearch("service:checkout").serviceMatcher,
        [],
      ),
    ).toBeNull();
  });

  test("a token resolves to the ids whose names it matches", () => {
    expect(
      resolveMetricsServiceToken(
        parseMetricsSearch("service:checkout").serviceMatcher,
        services,
      ),
    ).toEqual({ serviceIds: [SERVICE_ID], matchedNothing: false });
  });

  test("a token that matches no name says so", () => {
    expect(
      resolveMetricsServiceToken(
        parseMetricsSearch("service:nothing-like-it").serviceMatcher,
        services,
      ),
    ).toEqual({ serviceIds: [], matchedNothing: true });
  });

  test("the same list of names resolves to an equal value every time", () => {
    const first: unknown = resolveMetricsServiceToken(
      parseMetricsSearch("service:api").serviceMatcher,
      services,
    );
    const second: unknown = resolveMetricsServiceToken(
      parseMetricsSearch("service:api").serviceMatcher,
      services.map((item: Service): Service => {
        return service(item.id!.toString(), item.name!.toString());
      }),
    );
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

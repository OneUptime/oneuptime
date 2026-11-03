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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

configure({ asyncUtilTimeout: 15000 });

/*
 * "Is not" in the Logs, Traces, Metrics and Exceptions explorers.
 *
 * A facet row's minus leaves its value out. Only Security Events offered it:
 * the other explorers' charts and facet counts were read through endpoints
 * that took only values to keep, so an exclusion would have left rows out of
 * the list under a chart and counts still showing them. Each explorer is
 * mounted for real here - its own filter handlers over the shared shell and
 * sidebar - against a data layer whose facets endpoints COUNT the way the
 * server does: over the rows a request's filters leave, the values it
 * leaves out included. So what the sidebar shows is what a reader sees.
 *
 * Pinned for each: the row turns red (aria-checked "mixed"), the chip says
 * "<Facet> is not", the list query, the chart and the facet requests all
 * leave the value out, the facet it sits in is counted without it (so the
 * values beside it keep their counts), the address carries it, and a click
 * on the row takes it off again.
 */

const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const analyticsCountMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factories run.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      count: (...args: Array<any>) => {
        return countMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
      updateById: () => {
        return Promise.resolve();
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
        return error instanceof Error ? error.message : "error";
      },
      getFriendlyErrorMessage: (error: unknown) => {
        return error instanceof Error ? error.message : "error";
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
      return {};
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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesAnalyticsView",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
      formatDurationMs: (ms: number) => {
        return `${ms} ms`;
      },
    };
  },
);

// Every chart part renders its children and nothing else.
jest.mock("recharts", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;
  const passThrough: (props: { children?: React.ReactNode }) => any = (props: {
    children?: React.ReactNode;
  }): any => {
    return react.createElement("div", null, props.children);
  };
  return new Proxy(
    { __esModule: true },
    {
      get: (target: Record<string, unknown>, key: string | symbol): unknown => {
        if (key in target) {
          return target[key as string];
        }
        return passThrough;
      },
    },
  );
});

import TracesViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer";
import MetricsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricsViewer";
import ExceptionsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsViewer";
import DashboardLogsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer";
import Span from "../../../Models/AnalyticsModels/Span";
import Log from "../../../Models/AnalyticsModels/Log";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import Service from "../../../Models/DatabaseModels/Service";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import LogSavedView from "../../../Models/DatabaseModels/LogSavedView";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import LogSeverity from "../../../Types/Log/LogSeverity";
import ObjectID from "../../../Types/ObjectID";
import { ObjectType } from "../../../Types/JSON";
import ProjectUtil from "../../../UI/Utils/Project";
import TelemetryEntityNameResolver from "../../../UI/Utils/Telemetry/TelemetryEntityNames";
import { EXCLUDED_FILTER_CHIP_TEST_ID } from "../../../UI/Components/TelemetryViewer/components/TelemetryActiveFilterChips";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CHECKOUT_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BILLING_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const SERVICE_NAMES: Record<string, string> = {
  [CHECKOUT_ID]: "checkout-api",
  [BILLING_ID]: "billing-worker",
};

type ModelType = { new (): unknown };

interface ListArgs {
  modelType: ModelType;
  query: Record<string, unknown>;
  skip: number;
  limit: number;
}

interface FacetValue {
  value: string;
  count: number;
  displayName?: string | undefined;
}

interface SpanRow {
  statusCode: number;
  service: string;
  host: string;
}

interface LogRow {
  severityText: string;
  service: string;
}

interface ExceptionRow {
  exceptionType: string;
  environment: string;
  service: string;
}

function times<T>(count: number, row: T): Array<T> {
  return Array.from({ length: count }, (): T => {
    return { ...row };
  });
}

// Unset 30, Ok 20, Error 4.
const SPANS: Array<SpanRow> = [
  ...times(3, { statusCode: 2, service: CHECKOUT_ID, host: "web-01" }),
  ...times(1, { statusCode: 2, service: BILLING_ID, host: "web-02" }),
  ...times(12, { statusCode: 1, service: CHECKOUT_ID, host: "web-01" }),
  ...times(8, { statusCode: 1, service: BILLING_ID, host: "web-02" }),
  ...times(20, { statusCode: 0, service: CHECKOUT_ID, host: "web-01" }),
  ...times(10, { statusCode: 0, service: BILLING_ID, host: "web-02" }),
];

const LOGS: Array<LogRow> = [
  ...times(9, { severityText: "Error", service: CHECKOUT_ID }),
  ...times(3, { severityText: "Error", service: BILLING_ID }),
  ...times(6, { severityText: "Warning", service: CHECKOUT_ID }),
  ...times(25, { severityText: "Information", service: CHECKOUT_ID }),
  ...times(15, { severityText: "Information", service: BILLING_ID }),
];

const EXCEPTIONS: Array<ExceptionRow> = [
  ...times(3, {
    exceptionType: "TimeoutError",
    environment: "production",
    service: CHECKOUT_ID,
  }),
  ...times(2, {
    exceptionType: "TypeError",
    environment: "production",
    service: BILLING_ID,
  }),
  ...times(1, {
    exceptionType: "ValueError",
    environment: "staging",
    service: CHECKOUT_ID,
  }),
];

function service(id: string): Service {
  const item: Service = new Service();
  item.id = new ObjectID(id);
  item.name = SERVICE_NAMES[id]!;
  return item;
}

function listOf(value: unknown): Array<string> {
  return Array.isArray(value)
    ? (value as Array<unknown>).map((entry: unknown): string => {
        return String(entry);
      })
    : [];
}

// What a request keeps: its kept list (everything when it has none) less its left-out one.
function keeps(
  kept: unknown,
  leftOut: unknown,
  value: string | number,
): boolean {
  const keptValues: Array<string> = listOf(kept);
  const leftOutValues: Array<string> = listOf(leftOut);

  return (
    (keptValues.length === 0 || keptValues.includes(String(value))) &&
    !leftOutValues.includes(String(value))
  );
}

// An attribute filter on the wire, as the server reads it: = or !=.
function keepsAttribute(filter: unknown, value: string): boolean {
  if (filter === undefined) {
    return true;
  }

  if (typeof filter === "string") {
    return filter === value;
  }

  const operator: Record<string, unknown> = filter as Record<string, unknown>;

  if (operator["_type"] === ObjectType.NotEqual) {
    return operator["value"] !== value;
  }

  if (operator["_type"] === ObjectType.IncludesNone) {
    return !listOf(operator["value"]).includes(value);
  }

  return true;
}

function countBy<T>(
  rows: Array<T>,
  valueOf: (row: T) => string,
  nameOf?: (value: string) => string,
): Array<FacetValue> {
  const counts: Map<string, number> = new Map<string, number>();

  for (const row of rows) {
    const value: string = valueOf(row);
    counts.set(value, (counts.get(value) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left: [string, number], right: [string, number]): number => {
      return right[1] - left[1];
    })
    .map(([value, count]: [string, number]): FacetValue => {
      return nameOf
        ? { value: value, count: count, displayName: nameOf(value) }
        : { value: value, count: count };
    });
}

function serviceName(id: string): string {
  return SERVICE_NAMES[id] || id;
}

// The facets a request asked for, counted over the rows its filters leave.
function answerFacets<T extends { service: string }>(
  body: Record<string, unknown>,
  rows: Array<T>,
  matches: (row: T) => boolean,
  facetsOf: Record<string, (rows: Array<T>) => Array<FacetValue>>,
): Record<string, unknown> {
  const left: Array<T> = rows.filter((row: T): boolean => {
    return (
      keeps(body["serviceIds"], body["excludedServiceIds"], row.service) &&
      matches(row)
    );
  });
  const facets: Record<string, Array<FacetValue>> = {};

  for (const key of (body["facetKeys"] as Array<string>) || []) {
    facets[key] = facetsOf[key] ? facetsOf[key]!(left) : [];
  }

  return { data: { facets: facets, timedOutFacets: [] } };
}

function servicesOf<T extends { service: string }>(
  rows: Array<T>,
): Array<FacetValue> {
  return countBy(
    rows,
    (row: T): string => {
      return row.service;
    },
    serviceName,
  );
}

function postsTo(path: string): Array<Record<string, unknown>> {
  return postMock.mock.calls
    .filter((call: Array<unknown>): boolean => {
      return String((call[0] as { url: unknown }).url).endsWith(path);
    })
    .map((call: Array<unknown>): Record<string, unknown> => {
      return (call[0] as { data: Record<string, unknown> }).data;
    });
}

function lastPostTo(path: string): Record<string, unknown> {
  const posts: Array<Record<string, unknown>> = postsTo(path);
  expect(posts.length).toBeGreaterThan(0);
  return posts[posts.length - 1]!;
}

// The newest request that counted one facet on its own, without its selection.
function lastOwnCount(
  path: string,
  facetKey: string,
): Record<string, unknown> | undefined {
  const own: Array<Record<string, unknown>> = postsTo(path).filter(
    (body: Record<string, unknown>): boolean => {
      const keys: Array<string> = body["facetKeys"] as Array<string>;
      return keys.length === 1 && keys[0] === facetKey;
    },
  );

  return own[own.length - 1];
}

// The newest request that counted every facet nothing is chosen in.
function lastSharedCount(path: string): Record<string, unknown> {
  const shared: Array<Record<string, unknown>> = postsTo(path).filter(
    (body: Record<string, unknown>): boolean => {
      return (body["facetKeys"] as Array<string>).length > 1;
    },
  );
  expect(shared.length).toBeGreaterThan(0);
  return shared[shared.length - 1]!;
}

function lastListQuery(
  mock: MockFunction,
  modelType: ModelType,
): Record<string, unknown> {
  const reads: Array<ListArgs> = mock.mock.calls
    .map((call: Array<unknown>): ListArgs => {
      return call[0] as ListArgs;
    })
    .filter((args: ListArgs): boolean => {
      return args.modelType === modelType;
    });
  expect(reads.length).toBeGreaterThan(0);
  return reads[reads.length - 1]!.query;
}

/*
 * A row is named by its value; an excluded one also says so to a screen
 * reader ("TypeError Excluded"), so a string name matches either.
 */
async function findRow(name: string | RegExp): Promise<HTMLElement> {
  if (typeof name !== "string") {
    return screen.findByRole("checkbox", { name: name });
  }

  return screen.findByRole("checkbox", {
    name: (accessibleName: string): boolean => {
      return accessibleName === name || accessibleName === `${name} Excluded`;
    },
  });
}

async function clickRow(name: string | RegExp): Promise<void> {
  const row: HTMLElement = await findRow(name);
  await act(async () => {
    fireEvent.click(row);
  });
}

// The minus beside a value: leave its rows out.
async function excludeValue(name: string): Promise<void> {
  await findRow(name);
  const button: HTMLElement = await screen.findByRole("button", {
    name: `Exclude ${name}`,
  });
  await act(async () => {
    fireEvent.click(button);
  });
}

async function expectState(
  name: string | RegExp,
  state: "true" | "false" | "mixed",
): Promise<void> {
  await waitFor(async () => {
    expect(await findRow(name)).toHaveAttribute("aria-checked", state);
  });
}

async function expectExcludedChip(text: RegExp): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId(EXCLUDED_FILTER_CHIP_TEST_ID)).toHaveTextContent(
      text,
    );
  });
}

function noExcludedChip(): void {
  expect(screen.queryByTestId(EXCLUDED_FILTER_CHIP_TEST_ID)).toBeNull();
}

// The `filters` the page wrote to its address, as tuples.
function addressFilters(): Array<[string, unknown]> {
  const raw: string | null = new URLSearchParams(window.location.search).get(
    "filters",
  );

  return raw ? (JSON.parse(raw) as Array<[string, unknown]>) : [];
}

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  TelemetryEntityNameResolver.clearCache();
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);

  getListMock.mockReset();
  countMock.mockReset();
  analyticsGetListMock.mockReset();
  analyticsCountMock.mockReset();
  aggregateMock.mockReset();
  postMock.mockReset();

  getListMock.mockImplementation(async (args: unknown) => {
    const list: ListArgs = args as ListArgs;
    if (list.modelType === Service && !list.query?.["_id"]) {
      return { data: [service(CHECKOUT_ID), service(BILLING_ID)], count: 2 };
    }
    if (list.modelType === MetricType) {
      const metric: MetricType = new MetricType();
      metric.name = "http.server.duration";
      return { data: [metric], count: 1 };
    }
    if (list.modelType === TelemetryException) {
      const exception: TelemetryException = new TelemetryException();
      exception.fingerprint = "fp-checkout-timeout";
      exception.message = "checkout timed out";
      return { data: [exception], count: 1 };
    }
    if (list.modelType === LogSavedView) {
      return { data: [], count: 0, skip: 0, limit: 100 };
    }
    return { data: [], count: 0 };
  });
  countMock.mockImplementation(async () => {
    return 1;
  });
  analyticsGetListMock.mockImplementation(async (args: unknown) => {
    const list: ListArgs = args as ListArgs;
    if (list.modelType === Span) {
      const span: Span = new Span();
      span.name = "GET /orders";
      return { data: [span], count: 1, hasMore: false };
    }
    if (list.modelType === Log) {
      const log: Log = new Log();
      log.body = "request served";
      log.severityText = LogSeverity.Information;
      log.time = new Date();
      return { data: [log], count: 1, skip: 0, limit: 100, hasMore: false };
    }
    if (list.modelType === ExceptionInstance) {
      const instance: ExceptionInstance = new ExceptionInstance();
      instance.fingerprint = "fp-checkout-timeout";
      return { data: [instance], count: 1 };
    }
    return { data: [], count: 0 };
  });
  analyticsCountMock.mockImplementation(async () => {
    return 1;
  });
  aggregateMock.mockImplementation(async () => {
    return { data: [] };
  });
  postMock.mockImplementation(async (args: unknown) => {
    const url: string = String((args as { url: unknown }).url);
    const body: Record<string, unknown> =
      ((args as { data?: Record<string, unknown> }).data as Record<
        string,
        unknown
      >) || {};

    if (url.endsWith("/telemetry/traces/facets")) {
      const attributes: Record<string, unknown> =
        (body["attributes"] as Record<string, unknown>) || {};

      return answerFacets<SpanRow>(
        body,
        SPANS,
        (row: SpanRow): boolean => {
          return (
            keeps(
              body["statusCodes"],
              body["excludedStatusCodes"],
              row.statusCode,
            ) && keepsAttribute(attributes["resource.host.name"], row.host)
          );
        },
        {
          statusCode: (rows: Array<SpanRow>): Array<FacetValue> => {
            return countBy(rows, (row: SpanRow): string => {
              return String(row.statusCode);
            });
          },
          primaryEntityId: servicesOf,
          "resource.host.name": (rows: Array<SpanRow>): Array<FacetValue> => {
            return countBy(rows, (row: SpanRow): string => {
              return row.host;
            });
          },
        },
      );
    }

    if (url.endsWith("/telemetry/logs/facets")) {
      return answerFacets<LogRow>(
        body,
        LOGS,
        (row: LogRow): boolean => {
          return keeps(
            body["severityTexts"],
            body["excludedSeverityTexts"],
            row.severityText,
          );
        },
        {
          severityText: (rows: Array<LogRow>): Array<FacetValue> => {
            return countBy(rows, (row: LogRow): string => {
              return row.severityText;
            });
          },
          primaryEntityId: servicesOf,
        },
      );
    }

    if (url.endsWith("/telemetry/exceptions/facets")) {
      return answerFacets<ExceptionRow>(
        body,
        EXCEPTIONS,
        (row: ExceptionRow): boolean => {
          return (
            keeps(
              body["exceptionTypes"],
              body["excludedExceptionTypes"],
              row.exceptionType,
            ) &&
            keeps(
              body["environments"],
              body["excludedEnvironments"],
              row.environment,
            )
          );
        },
        {
          exceptionType: (rows: Array<ExceptionRow>): Array<FacetValue> => {
            return countBy(rows, (row: ExceptionRow): string => {
              return row.exceptionType;
            });
          },
          environment: (rows: Array<ExceptionRow>): Array<FacetValue> => {
            return countBy(rows, (row: ExceptionRow): string => {
              return row.environment;
            });
          },
          primaryEntityId: servicesOf,
        },
      );
    }

    if (url.endsWith("/telemetry/metrics/facets")) {
      return {
        data: {
          facets: {
            primaryEntityId: [
              { value: CHECKOUT_ID, count: 3, displayName: "checkout-api" },
              { value: BILLING_ID, count: 1, displayName: "billing-worker" },
            ],
          },
        },
      };
    }

    if (url.endsWith("/telemetry/logs/histogram")) {
      return { data: { buckets: [], bucketSizeInMinutes: 1 } };
    }

    return { data: { facets: {}, buckets: [], attributes: [] } };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("Logs: Severity is not", () => {
  async function open(): Promise<void> {
    window.history.replaceState({}, "", "/dashboard/project/logs");
    await act(async () => {
      render(
        <DashboardLogsViewer
          showFilters={true}
          serviceIds={[]}
          limit={100}
          enableRealtime={false}
          id="logs"
          syncUrlState={true}
        />,
      );
    });
    await findRow("Information");
  }

  test("the minus leaves Information out of the list, the chart and the counts, and says so", async () => {
    await open();

    await excludeValue("Information");

    await expectState("Information", "mixed");
    await expectExcludedChip(/^Severity is not:Information$/);

    await waitFor(() => {
      const severity: unknown = lastListQuery(analyticsGetListMock, Log)[
        "severityText"
      ];
      expect(severity).toBeInstanceOf(NotEqual);
      expect((severity as NotEqual<string>).value).toBe("Information");
    });

    await waitFor(() => {
      expect(
        lastPostTo("/telemetry/logs/histogram")["excludedSeverityTexts"],
      ).toEqual(["Information"]);
    });

    await waitFor(() => {
      expect(
        lastSharedCount("/telemetry/logs/facets")["excludedSeverityTexts"],
      ).toEqual(["Information"]);
    });

    // The Severity facet is counted without its own choice: its values keep their counts.
    const own: Record<string, unknown> | undefined = lastOwnCount(
      "/telemetry/logs/facets",
      "severityText",
    );
    expect(own).toBeDefined();
    expect(own!["excludedSeverityTexts"]).toBeUndefined();
    await expectState("Error", "false");
    await expectState("Warning", "false");

    expect(addressFilters()).toContainEqual(["!severityText", ["Information"]]);
  });

  test("a click on the excluded row takes the exclusion off", async () => {
    await open();

    await excludeValue("Information");
    await expectState("Information", "mixed");

    await clickRow("Information");

    await expectState("Information", "false");
    noExcludedChip();
    await waitFor(() => {
      expect(
        lastListQuery(analyticsGetListMock, Log)["severityText"],
      ).toBeUndefined();
    });
    await waitFor(() => {
      expect(
        lastPostTo("/telemetry/logs/histogram")["excludedSeverityTexts"],
      ).toBeUndefined();
    });
  });

  test("Service is not: a service left out leaves its logs out of the list and the counts", async () => {
    await open();

    await excludeValue("billing-worker");

    await expectState("billing-worker", "mixed");
    await expectExcludedChip(/^Service is not:billing-worker$/);

    await waitFor(() => {
      const service: unknown = lastListQuery(analyticsGetListMock, Log)[
        "primaryEntityId"
      ];
      expect(service).toBeInstanceOf(NotEqual);
      expect(String((service as NotEqual<string>).value)).toBe(BILLING_ID);
    });
    await waitFor(() => {
      expect(
        lastSharedCount("/telemetry/logs/facets")["excludedServiceIds"],
      ).toEqual([BILLING_ID]);
    });
  });

  test("picking a value that is left out in the search bar moves it: never both", async () => {
    await open();

    await excludeValue("Error");
    await expectState("Error", "mixed");

    const input: HTMLElement = screen.getByPlaceholderText(/Search logs/);
    await act(async () => {
      fireEvent.change(input, { target: { value: "severity:Error" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await expectState("Error", "true");
    noExcludedChip();
    await waitFor(() => {
      expect(lastListQuery(analyticsGetListMock, Log)["severityText"]).toBe(
        "Error",
      );
    });
  });

  test("a link that leaves a severity out opens with it left out", async () => {
    window.history.replaceState(
      {},
      "",
      `/dashboard/project/logs?filters=${encodeURIComponent(
        JSON.stringify([["!severityText", ["Information"]]]),
      )}`,
    );
    await act(async () => {
      render(
        <DashboardLogsViewer
          showFilters={true}
          serviceIds={[]}
          limit={100}
          enableRealtime={false}
          id="logs"
          syncUrlState={true}
        />,
      );
    });

    await expectExcludedChip(/^Severity is not:Information$/);
    await waitFor(() => {
      expect(
        lastListQuery(analyticsGetListMock, Log)["severityText"],
      ).toBeInstanceOf(NotEqual);
    });
  });
});

describe("Traces: Status is not", () => {
  async function open(): Promise<void> {
    await act(async () => {
      render(<TracesViewer />);
    });
    await findRow("Error");
  }

  test("the minus leaves error spans out of the list, the chart and the counts, and says so", async () => {
    await open();

    await excludeValue("Error");

    await expectState("Error", "mixed");
    await expectExcludedChip(/^Status is not:Error$/);

    await waitFor(() => {
      const status: unknown = lastListQuery(analyticsGetListMock, Span)[
        "statusCode"
      ];
      expect(status).toBeInstanceOf(NotEqual);
      expect((status as NotEqual<number>).value).toBe(2);
    });

    await waitFor(() => {
      expect(
        lastPostTo("/telemetry/traces/histogram")["excludedStatusCodes"],
      ).toEqual([2]);
    });

    await waitFor(() => {
      const shared: Record<string, unknown> = lastSharedCount(
        "/telemetry/traces/facets",
      );
      expect(shared["excludedStatusCodes"]).toEqual([2]);
      expect(shared["facetKeys"]).not.toContain("statusCode");
    });

    // The Status facet is counted without its own choice: Ok and Unset keep theirs.
    const own: Record<string, unknown> | undefined = lastOwnCount(
      "/telemetry/traces/facets",
      "statusCode",
    );
    expect(own).toBeDefined();
    expect(own!["excludedStatusCodes"]).toBeUndefined();
    await expectState(/^Ok/, "false");
    await expectState(/^Unset/, "false");

    expect(addressFilters()).toContainEqual(["!statusCode", "2"]);
  });

  test("a click on the excluded row takes it off, from the list and the chart", async () => {
    await open();

    await excludeValue("Error");
    await expectState("Error", "mixed");

    await clickRow("Error");

    await expectState("Error", "false");
    noExcludedChip();
    await waitFor(() => {
      expect(
        lastListQuery(analyticsGetListMock, Span)["statusCode"],
      ).toBeUndefined();
    });
    await waitFor(() => {
      expect(
        lastPostTo("/telemetry/traces/histogram")["excludedStatusCodes"],
      ).toBeUndefined();
    });
  });

  test("Host Name is not: an attribute facet leaves its value out in both transports", async () => {
    await open();

    await excludeValue("web-02");

    await expectState("web-02", "mixed");
    /*
     * An attribute chip names the attribute as it is typed in the search
     * bar, the chip that keeps a host included.
     */
    await expectExcludedChip(/^resource\.host\.name is not:web-02$/);

    await waitFor(() => {
      const attributes: Record<string, unknown> = lastListQuery(
        analyticsGetListMock,
        Span,
      )["attributes"] as Record<string, unknown>;
      expect(attributes["resource.host.name"]).toBeInstanceOf(NotEqual);
    });

    await waitFor(() => {
      const attributes: Record<string, unknown> = lastPostTo(
        "/telemetry/traces/histogram",
      )["attributes"] as Record<string, unknown>;
      expect(attributes["resource.host.name"]).toEqual({
        _type: ObjectType.NotEqual,
        value: "web-02",
      });
    });
  });

  test("leaving a checked status out moves it: the row is never both", async () => {
    await open();

    await clickRow("Error");
    await expectState("Error", "true");

    await excludeValue("Error");

    await expectState("Error", "mixed");
    await waitFor(() => {
      expect(
        lastListQuery(analyticsGetListMock, Span)["statusCode"],
      ).toBeInstanceOf(NotEqual);
    });
    expect(
      addressFilters().filter((tuple: [string, unknown]): boolean => {
        return tuple[0] === "statusCode";
      }),
    ).toEqual([]);
  });
});

describe("Exceptions: Exception Type is not", () => {
  async function open(): Promise<void> {
    await act(async () => {
      render(<ExceptionsViewer />);
    });
    await findRow("TypeError");
  }

  test("the minus leaves TypeError out of the list, the chart and the counts, and says so", async () => {
    await open();

    await excludeValue("TypeError");

    await expectState("TypeError", "mixed");
    await expectExcludedChip(/^Exception Type is not:TypeError$/);

    await waitFor(() => {
      const type: unknown = lastListQuery(getListMock, TelemetryException)[
        "exceptionType"
      ];
      expect(type).toBeInstanceOf(NotEqual);
      expect((type as NotEqual<string>).value).toBe("TypeError");
    });

    await waitFor(() => {
      expect(
        lastPostTo("/telemetry/exceptions/histogram")["excludedExceptionTypes"],
      ).toEqual(["TypeError"]);
    });

    await waitFor(() => {
      expect(
        lastSharedCount("/telemetry/exceptions/facets")[
          "excludedExceptionTypes"
        ],
      ).toEqual(["TypeError"]);
    });

    const own: Record<string, unknown> | undefined = lastOwnCount(
      "/telemetry/exceptions/facets",
      "exceptionType",
    );
    expect(own).toBeDefined();
    expect(own!["excludedExceptionTypes"]).toBeUndefined();
    await expectState("TimeoutError", "false");
  });

  test("Environment is not: staging left out of the list and the counts", async () => {
    await open();

    await excludeValue("staging");

    await expectState("staging", "mixed");
    await expectExcludedChip(/^Environment is not:staging$/);
    await waitFor(() => {
      expect(
        lastListQuery(getListMock, TelemetryException)["environment"],
      ).toBeInstanceOf(NotEqual);
    });
    await waitFor(() => {
      expect(
        lastSharedCount("/telemetry/exceptions/facets")["excludedEnvironments"],
      ).toEqual(["staging"]);
    });

    // ValueError happened only in staging: the type facet beside it says so.
    await waitFor(() => {
      expect(screen.queryByRole("checkbox", { name: /^ValueError/ })).toBe(
        null,
      );
    });
  });

  test("a click on the excluded row takes it off", async () => {
    await open();

    await excludeValue("TypeError");
    await expectState("TypeError", "mixed");

    await clickRow("TypeError");

    await expectState("TypeError", "false");
    noExcludedChip();
    await waitFor(() => {
      expect(
        lastListQuery(getListMock, TelemetryException)["exceptionType"],
      ).toBeUndefined();
    });
  });
});

describe("Metrics: Service is not", () => {
  test("the minus hides the metrics the service reports, and a click takes it off", async () => {
    await act(async () => {
      render(<MetricsViewer />);
    });
    await findRow("billing-worker");

    await excludeValue("billing-worker");

    await expectState("billing-worker", "mixed");
    await expectExcludedChip(/^Service is not:billing-worker$/);
    await waitFor(() => {
      const services: unknown = lastListQuery(getListMock, MetricType)[
        "services"
      ];
      expect(services).toBeInstanceOf(IncludesNone);
      expect(
        (services as IncludesNone).values.map((id: unknown): string => {
          return String(id);
        }),
      ).toEqual([BILLING_ID]);
    });

    await clickRow("billing-worker");

    await expectState("billing-worker", "false");
    await waitFor(() => {
      expect(
        lastListQuery(getListMock, MetricType)["services"],
      ).toBeUndefined();
    });
  });
});

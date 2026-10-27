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
 * A facet with a value checked keeps the values beside it, so a second one
 * can be checked.
 *
 * Every facet used to be counted with every filter, its own included: check
 * Status = Error, and the Status facet had nothing left to count but Error -
 * Ok and Unset dropped out, and the only way to add a second status was to
 * uncheck the first or type `status:(error OR unset)`. Each explorer now
 * counts a facet with a value chosen in a request of its own, with every
 * filter but that facet's own (FacetCountPlan), and the rest together.
 *
 * Each explorer is mounted for real - Traces, Logs and Exceptions, their
 * own filter handlers over the shared shell and sidebar - against a data
 * layer whose facets endpoints COUNT the way the server does: over the rows
 * the request's own filters leave. So what the sidebar shows here is what a
 * reader sees.
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
import ExceptionsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsViewer";
import DashboardLogsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer";
import Span from "../../../Models/AnalyticsModels/Span";
import Log from "../../../Models/AnalyticsModels/Log";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import Service from "../../../Models/DatabaseModels/Service";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import LogSavedView from "../../../Models/DatabaseModels/LogSavedView";
import Includes from "../../../Types/BaseDatabase/Includes";
import LogSeverity from "../../../Types/Log/LogSeverity";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import TelemetryEntityNameResolver from "../../../UI/Utils/Telemetry/TelemetryEntityNames";

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

// The rows behind each explorer's counts.
interface SpanRow {
  statusCode: number;
  service: string;
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

// Unset 30, Ok 20, Error 4: a mixed project.
const SPANS: Array<SpanRow> = [
  ...times(3, { statusCode: 2, service: CHECKOUT_ID }),
  ...times(1, { statusCode: 2, service: BILLING_ID }),
  ...times(12, { statusCode: 1, service: CHECKOUT_ID }),
  ...times(8, { statusCode: 1, service: BILLING_ID }),
  ...times(20, { statusCode: 0, service: CHECKOUT_ID }),
  ...times(10, { statusCode: 0, service: BILLING_ID }),
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

// What a request's own list of values keeps: everything, when it has none.
function keeps(list: unknown, value: string | number): boolean {
  if (!Array.isArray(list) || list.length === 0) {
    return true;
  }

  return (list as Array<unknown>).some((entry: unknown): boolean => {
    return String(entry) === String(value);
  });
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
    return keeps(body["serviceIds"], row.service) && matches(row);
  });
  const facets: Record<string, Array<FacetValue>> = {};

  for (const key of (body["facetKeys"] as Array<string>) || []) {
    facets[key] = facetsOf[key] ? facetsOf[key]!(left) : [];
  }

  return { data: { facets: facets, timedOutFacets: [] } };
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

// The requests that counted one facet on its own, without its selection.
function ownCounts(
  path: string,
  facetKey: string,
): Array<Record<string, unknown>> {
  return postsTo(path).filter((body: Record<string, unknown>): boolean => {
    const keys: Array<string> = body["facetKeys"] as Array<string>;
    return keys.length === 1 && keys[0] === facetKey;
  });
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

async function findRow(name: string | RegExp): Promise<HTMLElement> {
  return screen.findByRole("checkbox", { name: name });
}

async function clickRow(name: string | RegExp): Promise<void> {
  const row: HTMLElement = await findRow(name);
  await act(async () => {
    fireEvent.click(row);
  });
}

async function expectChecked(
  name: string | RegExp,
  checked: "true" | "false",
): Promise<void> {
  await waitFor(async () => {
    expect(await findRow(name)).toHaveAttribute("aria-checked", checked);
  });
}

function valuesOf(value: unknown): Array<string> {
  if (value instanceof Includes) {
    return value.values
      .map((entry: unknown): string => {
        return String(entry);
      })
      .sort();
  }

  return value === undefined ? [] : [String(value)];
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
      return answerFacets<SpanRow>(
        body,
        SPANS,
        (row: SpanRow): boolean => {
          return keeps(body["statusCodes"], row.statusCode);
        },
        {
          statusCode: (rows: Array<SpanRow>): Array<FacetValue> => {
            return countBy(rows, (row: SpanRow): string => {
              return String(row.statusCode);
            });
          },
          primaryEntityId: (rows: Array<SpanRow>): Array<FacetValue> => {
            return countBy(
              rows,
              (row: SpanRow): string => {
                return row.service;
              },
              serviceName,
            );
          },
        },
      );
    }

    if (url.endsWith("/telemetry/logs/facets")) {
      return answerFacets<LogRow>(
        body,
        LOGS,
        (row: LogRow): boolean => {
          return keeps(body["severityTexts"], row.severityText);
        },
        {
          severityText: (rows: Array<LogRow>): Array<FacetValue> => {
            return countBy(rows, (row: LogRow): string => {
              return row.severityText;
            });
          },
          primaryEntityId: (rows: Array<LogRow>): Array<FacetValue> => {
            return countBy(
              rows,
              (row: LogRow): string => {
                return row.service;
              },
              serviceName,
            );
          },
        },
      );
    }

    if (url.endsWith("/telemetry/exceptions/facets")) {
      return answerFacets<ExceptionRow>(
        body,
        EXCEPTIONS,
        (row: ExceptionRow): boolean => {
          return (
            keeps(body["exceptionTypes"], row.exceptionType) &&
            keeps(body["environments"], row.environment)
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
          primaryEntityId: (rows: Array<ExceptionRow>): Array<FacetValue> => {
            return countBy(
              rows,
              (row: ExceptionRow): string => {
                return row.service;
              },
              serviceName,
            );
          },
        },
      );
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

describe("Traces: a checked status keeps the other statuses beside it", () => {
  async function open(
    props: { primaryEntityId?: ObjectID } = {},
  ): Promise<void> {
    await act(async () => {
      render(<TracesViewer {...props} />);
    });
    await findRow("Error");
  }

  test("check Error: Ok and Unset stay listed with their counts, and Ok can be checked beside it", async () => {
    await open();

    await clickRow("Error");
    await expectChecked("Error", "true");

    // Before: the Status facet counted Error alone, and Ok and Unset left.
    await expectChecked(/^Ok/, "false");
    await expectChecked(/^Unset/, "false");

    await clickRow(/^Ok/);
    await expectChecked("Error", "true");
    await expectChecked(/^Ok/, "true");
    await expectChecked(/^Unset/, "false");

    // The list and every other facet are filtered by both.
    await waitFor(() => {
      expect(
        [
          ...(lastSharedCount("/telemetry/traces/facets")[
            "statusCodes"
          ] as Array<number>),
        ].sort(),
      ).toEqual([1, 2]);
    });
    expect(
      valuesOf(lastListQuery(analyticsGetListMock, Span)["statusCode"]),
    ).toEqual(["1", "2"]);
  });

  test("the Status facet is counted without its own selection; every other facet with it", async () => {
    await open();

    await clickRow("Error");
    await expectChecked("Error", "true");

    await waitFor(() => {
      expect(
        ownCounts("/telemetry/traces/facets", "statusCode").length,
      ).toBeGreaterThan(0);
    });

    const own: Array<Record<string, unknown>> = ownCounts(
      "/telemetry/traces/facets",
      "statusCode",
    );
    expect(own[own.length - 1]!["statusCodes"]).toBeUndefined();

    const shared: Record<string, unknown> = lastSharedCount(
      "/telemetry/traces/facets",
    );
    expect(shared["statusCodes"]).toEqual([2]);
    expect(shared["facetKeys"]).not.toContain("statusCode");
    expect(shared["facetKeys"]).toContain("primaryEntityId");
  });

  test("a service's Traces tab keeps its scope in the Status facet's own count", async () => {
    await open({ primaryEntityId: new ObjectID(CHECKOUT_ID) });

    await clickRow("Error");
    await expectChecked("Error", "true");

    await waitFor(() => {
      expect(
        ownCounts("/telemetry/traces/facets", "statusCode").length,
      ).toBeGreaterThan(0);
    });

    const own: Array<Record<string, unknown>> = ownCounts(
      "/telemetry/traces/facets",
      "statusCode",
    );
    expect(own[own.length - 1]!["serviceIds"]).toEqual([CHECKOUT_ID]);
    expect(own[own.length - 1]!["statusCodes"]).toBeUndefined();
  });

  test("nothing checked: one request counts every facet, as before", async () => {
    await open();

    const requests: Array<Record<string, unknown>> = postsTo(
      "/telemetry/traces/facets",
    );
    expect(requests.length).toBeGreaterThan(0);
    for (const body of requests) {
      expect(body["facetKeys"]).toContain("statusCode");
      expect(body["facetKeys"]).toContain("primaryEntityId");
    }
  });

  test("unchecking the last status goes back to one request a read", async () => {
    await open();

    await clickRow("Error");
    await expectChecked("Error", "true");
    await waitFor(() => {
      expect(
        ownCounts("/telemetry/traces/facets", "statusCode").length,
      ).toBeGreaterThan(0);
    });
    const ownBefore: number = ownCounts(
      "/telemetry/traces/facets",
      "statusCode",
    ).length;

    await clickRow("Error");
    await expectChecked("Error", "false");
    await waitFor(() => {
      expect(
        lastSharedCount("/telemetry/traces/facets")["facetKeys"],
      ).toContain("statusCode");
    });

    expect(ownCounts("/telemetry/traces/facets", "statusCode")).toHaveLength(
      ownBefore,
    );
  });
});

describe("Logs: a checked severity keeps the other severities beside it", () => {
  async function open(serviceIds: Array<ObjectID> = []): Promise<void> {
    window.history.replaceState({}, "", "/dashboard/project/logs");
    await act(async () => {
      render(
        <DashboardLogsViewer
          showFilters={true}
          serviceIds={serviceIds}
          limit={100}
          enableRealtime={false}
          id="logs"
          syncUrlState={true}
        />,
      );
    });
    await findRow("Error");
  }

  test("check Error: Warning and Information stay listed, and Information can be checked beside it", async () => {
    await open();

    await clickRow("Error");
    await expectChecked("Error", "true");
    await expectChecked("Warning", "false");
    await expectChecked("Information", "false");

    await clickRow("Information");
    await expectChecked("Error", "true");
    await expectChecked("Information", "true");

    await waitFor(() => {
      expect(
        valuesOf(lastListQuery(analyticsGetListMock, Log)["severityText"]),
      ).toEqual(["Error", "Information"]);
    });
    await waitFor(() => {
      expect(
        [
          ...(lastSharedCount("/telemetry/logs/facets")[
            "severityTexts"
          ] as Array<string>),
        ].sort(),
      ).toEqual(["Error", "Information"]);
    });
  });

  test("a service's Logs tab counts its Severity facet within that service", async () => {
    await open([new ObjectID(CHECKOUT_ID)]);

    await clickRow("Error");
    await expectChecked("Error", "true");

    await waitFor(() => {
      expect(
        ownCounts("/telemetry/logs/facets", "severityText").length,
      ).toBeGreaterThan(0);
    });
    const own: Array<Record<string, unknown>> = ownCounts(
      "/telemetry/logs/facets",
      "severityText",
    );
    expect(own[own.length - 1]!["serviceIds"]).toEqual([CHECKOUT_ID]);
    expect(own[own.length - 1]!["severityTexts"]).toBeUndefined();
  });

  test("two facets chosen: each counted with the other's choice and without its own", async () => {
    await open();

    await clickRow("Error");
    await expectChecked("Error", "true");
    await clickRow("checkout-api");
    await expectChecked("checkout-api", "true");

    // Billing still listed in the Service facet, beside the checked service.
    await expectChecked("billing-worker", "false");

    await waitFor(() => {
      const severityOwn: Array<Record<string, unknown>> = ownCounts(
        "/telemetry/logs/facets",
        "severityText",
      );
      const last: Record<string, unknown> =
        severityOwn[severityOwn.length - 1]!;
      expect(last["serviceIds"]).toEqual([CHECKOUT_ID]);
      expect(last["severityTexts"]).toBeUndefined();
    });

    const serviceOwn: Array<Record<string, unknown>> = ownCounts(
      "/telemetry/logs/facets",
      "primaryEntityId",
    );
    const lastService: Record<string, unknown> =
      serviceOwn[serviceOwn.length - 1]!;
    expect(lastService["severityTexts"]).toEqual(["Error"]);
    expect(lastService["serviceIds"]).toBeUndefined();

    const shared: Record<string, unknown> = lastSharedCount(
      "/telemetry/logs/facets",
    );
    expect(shared["severityTexts"]).toEqual(["Error"]);
    expect(shared["serviceIds"]).toEqual([CHECKOUT_ID]);
  });
});

describe("Exceptions: a checked type keeps the other types beside it", () => {
  test("check TimeoutError: TypeError stays listed, and can be checked beside it", async () => {
    await act(async () => {
      render(<ExceptionsViewer />);
    });

    await clickRow("TimeoutError");
    await expectChecked("TimeoutError", "true");
    await expectChecked("TypeError", "false");
    await expectChecked("ValueError", "false");

    await clickRow("TypeError");
    await expectChecked("TimeoutError", "true");
    await expectChecked("TypeError", "true");

    await waitFor(() => {
      expect(
        [
          ...(lastSharedCount("/telemetry/exceptions/facets")[
            "exceptionTypes"
          ] as Array<string>),
        ].sort(),
      ).toEqual(["TimeoutError", "TypeError"]);
    });

    const own: Array<Record<string, unknown>> = ownCounts(
      "/telemetry/exceptions/facets",
      "exceptionType",
    );
    expect(own[own.length - 1]!["exceptionTypes"]).toBeUndefined();
  });

  test("an environment chosen narrows the type counts, and its own facet keeps every environment", async () => {
    await act(async () => {
      render(<ExceptionsViewer />);
    });

    await clickRow("staging");
    await expectChecked("staging", "true");
    await expectChecked("production", "false");

    await waitFor(() => {
      const shared: Record<string, unknown> = lastSharedCount(
        "/telemetry/exceptions/facets",
      );
      expect(shared["environments"]).toEqual(["staging"]);
      expect(shared["facetKeys"]).toContain("exceptionType");
    });

    // Only ValueError happened in staging: the type facet says so.
    await expectChecked("ValueError", "false");
    expect(screen.queryByRole("checkbox", { name: /^TimeoutError/ })).toBe(
      null,
    );
  });
});

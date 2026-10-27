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
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

configure({ asyncUtilTimeout: 15000 });

/*
 * "I'm not able to uncheck when I click on this. Please check if we have the
 * same issue everywhere and fix it."
 *
 * Each explorer is mounted for real - its own filter handlers, the shared
 * TelemetryViewer / LogsViewer shell and the shared facet sidebar - over a
 * mocked data layer, and a facet value is clicked on and off the way a
 * reader does: by its row. Before the fix the Traces, Metrics and Exceptions
 * rows stayed checked (their handlers only ever added), the Traces "Root
 * spans" row could not be cleared, and a Host Name holding `*`, `?` or a
 * space never showed as checked at all. Logs toggled - but its exclude
 * button was an empty placeholder, as it was on every explorer but Security
 * Events (pinned in SecurityEventsViewer.test.tsx).
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
import Includes from "../../../Types/BaseDatabase/Includes";
import LogSeverity from "../../../Types/Log/LogSeverity";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import TelemetryEntityNameResolver from "../../../UI/Utils/Telemetry/TelemetryEntityNames";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SERVICE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_SERVICE_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// Host names a sidebar row has to show checked whatever they hold.
const SPECIAL_HOSTS: Array<string> = ["/api/*", "a?b", "my host"];

type ModelType = { new (): unknown };

interface ListArgs {
  modelType: ModelType;
  query: Record<string, unknown>;
  skip: number;
  limit: number;
}

function service(id: string, name: string): Service {
  const item: Service = new Service();
  item.id = new ObjectID(id);
  item.name = name;
  return item;
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

function listReadsOf(
  mock: MockFunction,
  modelType: ModelType,
): Array<ListArgs> {
  return mock.mock.calls
    .map((call: Array<unknown>): ListArgs => {
      return call[0] as ListArgs;
    })
    .filter((args: ListArgs): boolean => {
      return args.modelType === modelType;
    });
}

function lastListQuery(
  mock: MockFunction,
  modelType: ModelType,
): Record<string, unknown> {
  const reads: Array<ListArgs> = listReadsOf(mock, modelType);
  expect(reads.length).toBeGreaterThan(0);
  return reads[reads.length - 1]!.query;
}

// The checkbox row for a value, wherever its section is.
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

// A choice of one (the traces explorer's Span Type) is a radio group.
async function findChoice(name: string | RegExp): Promise<HTMLElement> {
  return screen.findByRole("radio", { name: name });
}

async function clickChoice(name: string | RegExp): Promise<void> {
  const choice: HTMLElement = await findChoice(name);
  await act(async () => {
    fireEvent.click(choice);
  });
}

async function expectChosen(
  name: string | RegExp,
  chosen: "true" | "false",
): Promise<void> {
  await waitFor(async () => {
    expect(await findChoice(name)).toHaveAttribute("aria-checked", chosen);
  });
}

function noExcludeButtons(): void {
  expect(screen.queryAllByRole("button", { name: /^Exclude / })).toEqual([]);
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
      return {
        data: [
          service(SERVICE_ID, "checkout-api"),
          service(OTHER_SERVICE_ID, "billing-worker"),
        ],
        count: 2,
      };
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

    if (url.endsWith("/telemetry/traces/facets")) {
      return {
        data: {
          facets: {
            primaryEntityId: [
              { value: SERVICE_ID, count: 9, displayName: "checkout-api" },
            ],
            statusCode: [
              { value: "0", count: 30 },
              { value: "2", count: 4 },
            ],
            isRootSpan: [
              { value: "true", count: 12 },
              { value: "false", count: 22 },
            ],
            hasException: [{ value: "true", count: 2 }],
            kind: [],
            name: [],
            "resource.service.instance.id": [],
            "resource.host.name": SPECIAL_HOSTS.map(
              (host: string, index: number) => {
                return { value: host, count: 5 - index };
              },
            ),
          },
        },
      };
    }

    if (url.endsWith("/telemetry/logs/facets")) {
      return {
        data: {
          facets: {
            severityText: [
              { value: "Error", count: 12 },
              { value: "Information", count: 40 },
            ],
          },
        },
      };
    }

    if (url.endsWith("/telemetry/logs/histogram")) {
      return { data: { buckets: [], bucketSizeInMinutes: 1 } };
    }

    if (url.endsWith("/telemetry/metrics/facets")) {
      return {
        data: {
          facets: {
            primaryEntityId: [
              { value: SERVICE_ID, count: 3, displayName: "checkout-api" },
              {
                value: OTHER_SERVICE_ID,
                count: 1,
                displayName: "billing-worker",
              },
            ],
          },
        },
      };
    }

    if (url.endsWith("/telemetry/exceptions/facets")) {
      return {
        data: {
          facets: {
            primaryEntityId: [
              { value: SERVICE_ID, count: 3, displayName: "checkout-api" },
            ],
            exceptionType: [
              { value: "TimeoutError", count: 3 },
              { value: "System.*Exception", count: 1 },
            ],
            environment: [{ value: "production", count: 4 }],
          },
        },
      };
    }

    return { data: { facets: {}, buckets: [], attributes: [] } };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("Traces: a facet value clicks on and off", () => {
  async function open(): Promise<void> {
    await act(async () => {
      render(<TracesViewer />);
    });
    await findRow("Error");
  }

  test("REGRESSION: Status 'Error' checks, then unchecks, and the chart and counts follow", async () => {
    await open();

    await clickRow("Error");
    await expectChecked("Error", "true");
    await waitFor(() => {
      expect(lastPostTo("/telemetry/traces/facets")["statusCodes"]).toEqual([
        2,
      ]);
    });
    expect(screen.getByTitle("Remove Status: Error")).toBeInTheDocument();

    await clickRow("Error");
    await expectChecked("Error", "false");
    await waitFor(() => {
      expect(
        lastPostTo("/telemetry/traces/facets")["statusCodes"],
      ).toBeUndefined();
    });
    expect(screen.queryByTitle("Remove Status: Error")).toBeNull();
  });

  test("REGRESSION: Span Type is one choice - Entry spans to start, Root spans when clicked, Entry spans again when that is clicked", async () => {
    /*
     * The span type is a choice of one, Entry spans by default, drawn as
     * radio buttons: there is always exactly one, so a click chooses rather
     * than toggles, and choosing the chosen one again changes nothing.
     */
    await open();

    await expectChosen("Entry spans", "true");
    await expectChosen("Root spans", "false");
    await expectChosen("All spans", "false");

    await clickChoice("Root spans");
    await expectChosen("Root spans", "true");
    await expectChosen("Entry spans", "false");
    await waitFor(() => {
      expect(lastPostTo("/telemetry/traces/facets")["rootOnly"]).toBe(true);
      expect(lastPostTo("/telemetry/traces/facets")["entryOnly"]).toBe(false);
    });

    await clickChoice("Root spans");
    await expectChosen("Root spans", "true");

    await clickChoice("Entry spans");
    await expectChosen("Entry spans", "true");
    await expectChosen("Root spans", "false");
    await waitFor(() => {
      expect(lastPostTo("/telemetry/traces/facets")["rootOnly"]).toBe(false);
      expect(lastPostTo("/telemetry/traces/facets")["entryOnly"]).toBe(true);
    });
  });

  test.each(
    SPECIAL_HOSTS.map((host: string) => {
      return [host];
    }),
  )(
    "REGRESSION: Host Name %j shows checked once clicked, and a second click unchecks it",
    async (host: string) => {
      await open();
      await findRow(host);

      await clickRow(host);
      await expectChecked(host, "true");
      await waitFor(() => {
        const attributes: Record<string, unknown> | undefined = lastPostTo(
          "/telemetry/traces/facets",
        )["attributes"] as Record<string, unknown> | undefined;
        expect(attributes?.["resource.host.name"]).toBe(host);
      });

      // Every other host stays unchecked: the escaped chip names this one.
      for (const other of SPECIAL_HOSTS) {
        if (other !== host) {
          expect(await findRow(other)).toHaveAttribute("aria-checked", "false");
        }
      }

      await clickRow(host);
      await expectChecked(host, "false");
      await waitFor(() => {
        const attributes: Record<string, unknown> | undefined = lastPostTo(
          "/telemetry/traces/facets",
        )["attributes"] as Record<string, unknown> | undefined;
        expect(attributes?.["resource.host.name"]).toBeUndefined();
      });
    },
  );

  test("two values of one facet: unchecking one keeps the other", async () => {
    await open();

    await clickRow("Error");
    await clickRow(/^Unset/);
    await expectChecked("Error", "true");
    await expectChecked(/^Unset/, "true");

    await clickRow("Error");
    await expectChecked("Error", "false");
    await expectChecked(/^Unset/, "true");
    await waitFor(() => {
      expect(lastPostTo("/telemetry/traces/facets")["statusCodes"]).toEqual([
        0,
      ]);
    });
  });

  test("the sidebar offers no exclude button: the traces chart and counts cannot leave a value out", async () => {
    await open();

    noExcludeButtons();
  });
});

describe("Metrics: a Service clicks on and off", () => {
  test("REGRESSION: checks, then unchecks, and the metric list follows", async () => {
    await act(async () => {
      render(<MetricsViewer />);
    });

    await clickRow("checkout-api");
    await expectChecked("checkout-api", "true");
    await waitFor(() => {
      const services: unknown = lastListQuery(getListMock, MetricType)[
        "services"
      ];
      expect(services).toBeInstanceOf(Includes);
      expect(
        (services as Includes).values.map((id: unknown): string => {
          return String(id);
        }),
      ).toEqual([SERVICE_ID]);
    });

    await clickRow("checkout-api");
    await expectChecked("checkout-api", "false");
    await waitFor(() => {
      expect(
        lastListQuery(getListMock, MetricType)["services"],
      ).toBeUndefined();
    });

    noExcludeButtons();
  });
});

describe("Exceptions: an Exception Type clicks on and off", () => {
  test("REGRESSION: checks, then unchecks, and the chart and counts follow", async () => {
    await act(async () => {
      render(<ExceptionsViewer />);
    });

    await clickRow("TimeoutError");
    await expectChecked("TimeoutError", "true");
    await waitFor(() => {
      expect(
        lastPostTo("/telemetry/exceptions/facets")["exceptionTypes"],
      ).toEqual(["TimeoutError"]);
    });

    await clickRow("TimeoutError");
    await expectChecked("TimeoutError", "false");
    await waitFor(() => {
      expect(
        lastPostTo("/telemetry/exceptions/facets")["exceptionTypes"],
      ).toBeUndefined();
    });

    noExcludeButtons();
  });

  test("a value with a wildcard character is a plain value, checked and unchecked as such", async () => {
    await act(async () => {
      render(<ExceptionsViewer />);
    });

    await clickRow("System.*Exception");
    await expectChecked("System.*Exception", "true");
    await expectChecked("TimeoutError", "false");

    await clickRow("System.*Exception");
    await expectChecked("System.*Exception", "false");
  });
});

describe("Logs: a severity clicks on and off", () => {
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
    await findRow("Error");
  }

  test("checks, then unchecks, and the list follows", async () => {
    await open();

    await clickRow("Error");
    await expectChecked("Error", "true");
    await waitFor(() => {
      expect(lastListQuery(analyticsGetListMock, Log)["severityText"]).toBe(
        "Error",
      );
    });

    await clickRow("Error");
    await expectChecked("Error", "false");
    await waitFor(() => {
      expect(
        lastListQuery(analyticsGetListMock, Log)["severityText"],
      ).toBeUndefined();
    });
  });

  test("the sidebar offers no exclude button: the old one was an empty placeholder", async () => {
    await open();

    noExcludeButtons();
  });

  test("REGRESSION: picking a severity already applied in the search bar keeps its chip", async () => {
    await open();

    await clickRow("Error");
    await expectChecked("Error", "true");

    const input: HTMLElement = screen.getByPlaceholderText(/Search logs/);
    await act(async () => {
      fireEvent.change(input, { target: { value: "severity:Error" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    // Picking it again used to take it off: the include toggled.
    await expectChecked("Error", "true");
    expect(
      within(document.body).getByTitle("Remove Severity: Error"),
    ).toBeInTheDocument();
  });
});

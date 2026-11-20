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
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * ALL APPS, AN ENVIRONMENT'S APPS, AND ITS OVERVIEW'S APPS CARD: AN APP
 * SERVICE APP THAT SENDS NO TRACES SHOWS ITS SITE'S AZURE MONITOR NUMBERS
 * (#10406).
 *
 * Each list showed an app's requests, error rate and p95 over the last hour
 * from its traces, and "No traces" for an App Service app that sends none -
 * though its own page drew its site's numbers from Azure Monitor. Now the
 * list reads the site the server keeps on the app (#10407), as the reader
 * may, and draws its last hour where "No traces" stood:
 *
 *   - the share of requests answered with a 5xx status, toned as an error
 *     rate is, then the requests and the mean response time - each worded
 *     as what Azure measures ("server errors", "on average"), and "Azure
 *     Monitor" under them, so no one compares them with traced requests;
 *   - an app whose site the reader may not read shows no number, and its
 *     site's metrics are never asked for;
 *   - an app that sends traces keeps its traced numbers; one with no site,
 *     a site that reported nothing, or a read that failed, says "No
 *     traces", never 0;
 *   - a skeleton while the site's numbers load, never "No traces" first.
 *
 * Rendered for real - the environment's card and the All Apps table, its
 * rows drawn through the table's own columns - with the network stood in
 * for, answering as the server would.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

/*
 * The table, drawn as its columns draw each row: the rows are fetched,
 * handed to onFetchSuccess as ModelTable hands them, and each column's
 * element drawn for each.
 */
const mockTable: {
  rows: Array<unknown>;
  props: Record<string, unknown> | null;
} = { rows: [], props: null };

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  const ReactInModule: typeof React = jest.requireActual("react");

  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      mockTable.props = props;

      ReactInModule.useEffect(() => {
        (props["onFetchSuccess"] as (rows: Array<unknown>) => void)(
          mockTable.rows,
        );
      }, []);

      const columns: Array<{
        id?: string;
        title: string;
        getElement?: (row: unknown) => React.ReactElement;
      }> = props["columns"] as never;

      return ReactInModule.createElement(
        "table",
        { "data-testid": "model-table" },
        ReactInModule.createElement(
          "tbody",
          null,
          mockTable.rows.map((row: unknown, index: number) => {
            return ReactInModule.createElement(
              "tr",
              { key: index, "data-testid": "model-table-row" },
              columns.map((column: { title: string; getElement?: unknown }) => {
                return ReactInModule.createElement(
                  "td",
                  { key: column.title, "data-column": column.title },
                  column.getElement
                    ? (
                        column.getElement as (
                          row: unknown,
                        ) => React.ReactElement
                      )(row)
                    : null,
                );
              }),
            );
          }),
        ),
      );
    },
  };
});

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CloudApp from "../../../Models/DatabaseModels/CloudApp";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import Includes from "../../../Types/BaseDatabase/Includes";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { INLINE_VALUE_SKELETON_TEST_ID } from "../../../UI/Components/Skeleton/InlineValueSkeleton";
import EnvironmentAppsCard from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/EnvironmentAppsCard";
import CloudAppsTable from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/CloudAppsTable";
import {
  APP_NO_TRACES_HINT,
  APP_PLATFORM_SIGNALS_HINT,
  CloudAppSignalsSummaryCell,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/CloudAppCells";
import {
  AppServiceMetric,
  getAppServiceStoredMetricName,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudAppPlatformResource";

const MINUTE_MS: number = 60 * 1000;
const APP_PLATFORMS: string = `/dashboard/${PROJECT_ID}/app-platforms`;
const ENVIRONMENT_ID: string = "7d000000-0000-4000-8000-000000000001";
const SUBSCRIPTION: string = "d6252cc9-f01c-428b-924d-9896199f9a13";

const CHECKOUT_SITE: string = "7d000000-0000-4000-8000-000000000101";
const QUIET_SITE: string = "7d000000-0000-4000-8000-000000000102";
// A site Azure Monitor reported nothing of in the hour.
const IDLE_SITE: string = "7d000000-0000-4000-8000-000000000104";
// A site the reader's labels do not give them.
const HIDDEN_SITE: string = "7d000000-0000-4000-8000-000000000103";

function armId(name: string): string {
  return `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-web/providers/Microsoft.Web/sites/${name}`;
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MINUTE_MS);
}

const ENVIRONMENT: CloudResource = Object.assign(new CloudResource(), {
  _id: ENVIRONMENT_ID,
  name: "Azure App Service · northcentralus",
  cloudPlatform: "azure_app_service",
  cloudProvider: "azure",
  cloudRegion: "northcentralus",
  cloudAccountId: SUBSCRIPTION,
});

interface AppFixture {
  index: number;
  name: string;
  site?: string;
  sendsTraces?: boolean;
  // Traced requests and errors over the last hour.
  requests?: number;
  errors?: number;
}

// Sent no trace, tied to its site: its site's numbers.
const CHECKOUT: AppFixture = {
  index: 1,
  name: "checkout-api",
  site: CHECKOUT_SITE,
};
// Its site is one the reader may not read: nothing of it.
const ORDERS: AppFixture = { index: 2, name: "orders-api", site: HIDDEN_SITE };
// No site kept: "No traces", as before.
const BILLING: AppFixture = { index: 3, name: "billing-api" };
// Sends traces: its traced numbers, never its site's.
const SEARCH: AppFixture = {
  index: 4,
  name: "search-api",
  site: CHECKOUT_SITE,
  sendsTraces: true,
  requests: 100,
  errors: 1,
};
// Its site answered nothing in the hour: a measured "No requests".
const QUIET: AppFixture = { index: 5, name: "quiet-api", site: QUIET_SITE };
// Its site reported nothing in the hour: unknown, so "No traces", never 0.
const IDLE: AppFixture = { index: 6, name: "idle-api", site: IDLE_SITE };

function appId(index: number): string {
  return `7d000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function toApp(fixture: AppFixture): CloudApp {
  return Object.assign(new CloudApp(), {
    _id: appId(fixture.index),
    name: fixture.name,
    cloudResourceId: ENVIRONMENT_ID,
    cloudPlatform: "azure_app_service",
    telemetryAttributes: { "service.name": fixture.name },
    lastSeenAt: minutesAgo(1),
    tracesLastReceivedAt: fixture.sendsTraces ? minutesAgo(1) : undefined,
    platformCloudResourceId: fixture.site
      ? new ObjectID(fixture.site)
      : undefined,
  });
}

function siteRow(id: string, name: string): CloudResource {
  return Object.assign(new CloudResource(), {
    _id: id,
    cloudResourceKind: CloudResourceKind.Resource,
    telemetryAttributes: { "azuremonitor.resource_id": armId(name) },
    cloudReadings: {},
  });
}

// The sites the reader may read.
const READABLE_SITES: Array<CloudResource> = [
  siteRow(CHECKOUT_SITE, "checkout-api"),
  siteRow(QUIET_SITE, "quiet-api"),
  siteRow(IDLE_SITE, "idle-api"),
];

const REQUESTS: string = getAppServiceStoredMetricName({
  metric: AppServiceMetric.Requests,
});
const SERVER_ERRORS: string = getAppServiceStoredMetricName({
  metric: AppServiceMetric.ServerErrors,
});
const RESPONSE_TIME: string = getAppServiceStoredMetricName({
  metric: AppServiceMetric.ResponseTime,
});

// What Azure Monitor measured over the hour, by stored name and site.
const MEASURED: Record<string, Record<string, number>> = {
  [REQUESTS]: {
    [armId("checkout-api")]: 1200,
    [armId("quiet-api")]: 0,
    [armId("orders-api")]: 999,
  },
  [SERVER_ERRORS]: {
    [armId("checkout-api")]: 60,
    [armId("quiet-api")]: 0,
    [armId("orders-api")]: 999,
  },
  [RESPONSE_TIME]: { [armId("checkout-api")]: 0.25, [armId("orders-api")]: 9 },
};

interface AggregateCall {
  aggregateBy: { query: Record<string, unknown> };
}

let apps: Array<AppFixture>;
let aggregates: Array<AggregateCall>;
let metricReads: "answer" | "pending" | "fail";

function listOf<T extends BaseModel>(data: Array<T>): ListResult<BaseModel> {
  return {
    data: data,
    count: data.length,
    skip: 0,
    limit: 100,
  } as unknown as ListResult<BaseModel>;
}

beforeEach(() => {
  apps = [CHECKOUT, ORDERS, BILLING, SEARCH, QUIET, IDLE];
  aggregates = [];
  metricReads = "answer";
  mockTable.rows = [];
  mockTable.props = null;
  goTo(APP_PLATFORMS);

  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});

  jest.spyOn(ModelAPI, "getList").mockImplementation(((options: {
    modelType: { new (): BaseModel };
    query?: Record<string, unknown>;
  }): Promise<ListResult<BaseModel>> => {
    const modelType: string = new options.modelType().tableName || "";

    if (modelType === "CloudApp") {
      return Promise.resolve(listOf(apps.map(toApp)));
    }

    if (modelType === "CloudResource") {
      // By id, as the reader may read them: the hidden site is not answered.
      const asked: Array<string> = (
        ((options.query?.["_id"] as Includes)?.values || []) as Array<unknown>
      ).map((value: unknown): string => {
        return String(value);
      });

      return Promise.resolve(
        listOf(
          READABLE_SITES.filter((site: CloudResource): boolean => {
            return asked.includes(String(site._id));
          }),
        ),
      );
    }

    return Promise.resolve(listOf([]));
  }) as never);

  // The traced requests, one grouped read by service.name.
  jest.spyOn(API, "post").mockImplementation((async () => {
    return new HTTPResponse(
      200,
      {
        data: apps
          .filter((fixture: AppFixture): boolean => {
            return Boolean(fixture.requests);
          })
          .map((fixture: AppFixture): JSONObject => {
            return {
              groupValues: { "resource.service.name": fixture.name },
              count: fixture.requests as number,
              errorCount: fixture.errors || 0,
              p95DurationMs: 120,
            };
          }),
      } as JSONObject,
      {},
    );
  }) as never);

  // Azure Monitor's numbers, grouped by the site's attribute.
  jest.spyOn(AnalyticsModelAPI, "aggregate").mockImplementation((async (
    request: AggregateCall,
  ) => {
    aggregates.push(request);

    if (metricReads === "pending") {
      return await new Promise((): void => {});
    }

    if (metricReads === "fail") {
      throw new Error("403");
    }

    const name: string = String(request.aggregateBy.query["name"]);
    const scope: Includes = (
      request.aggregateBy.query["attributes"] as Record<string, Includes>
    )["azuremonitor.resource_id"]!;

    return {
      data: (scope.values as Array<string>)
        .filter((resourceId: string): boolean => {
          return MEASURED[name]?.[resourceId] !== undefined;
        })
        .map((resourceId: string): AggregatedModel => {
          return {
            value: MEASURED[name]![resourceId],
            attributes: { "azuremonitor.resource_id": resourceId },
          } as unknown as AggregatedModel;
        }),
    };
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function settle(): Promise<void> {
  for (let tick: number = 0; tick < 4; tick++) {
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void): void => {
        setTimeout(resolve, 0);
      });
    });
  }
}

async function renderCard(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <EnvironmentAppsCard
          environmentId={new ObjectID(ENVIRONMENT_ID)}
          environment={ENVIRONMENT}
        />
      </MemoryRouter>,
    );
  });
  await settle();
}

async function renderAllApps(): Promise<void> {
  mockTable.rows = apps.map(toApp);

  await act(async () => {
    render(
      <MemoryRouter>
        <CloudAppsTable
          id="app-platforms-apps-table"
          environments={new Map([[ENVIRONMENT_ID, ENVIRONMENT]])}
        />
      </MemoryRouter>,
    );
  });
  await settle();
}

// A card's row, by its app's name.
function cardRowOf(name: string): HTMLElement {
  const row: HTMLElement | undefined = screen
    .getAllByTestId("environment-app")
    .find((candidate: HTMLElement): boolean => {
      return within(candidate).getByRole("link").textContent === name;
    });

  expect({ name, found: Boolean(row) }).toEqual({ name, found: true });

  return row as HTMLElement;
}

// The All Apps table's "Last hour" cell, by its app's name.
function tableCellOf(name: string): HTMLElement {
  const row: HTMLElement | undefined = screen
    .getAllByTestId("model-table-row")
    .find((candidate: HTMLElement): boolean => {
      return within(candidate).getByRole("link").textContent === name;
    });

  expect({ name, found: Boolean(row) }).toEqual({ name, found: true });

  return (row as HTMLElement).querySelector(
    "[data-column='Last hour']",
  ) as HTMLElement;
}

function textOf(scope: HTMLElement, testId: string): string {
  return (within(scope).getByTestId(testId).textContent || "")
    .replace(/[\u2066-\u2069\u200E\u200F]/g, "")
    .replace(/[\u00A0\u202F]/g, " ")
    .trim();
}

// The site ids the metric reads were scoped to.
function sitesAskedFor(): Set<string> {
  const asked: Set<string> = new Set<string>();

  for (const call of aggregates) {
    const scope: Includes = (
      call.aggregateBy.query["attributes"] as Record<string, Includes>
    )["azuremonitor.resource_id"]!;

    for (const value of scope.values as Array<string>) {
      asked.add(value);
    }
  }

  return asked;
}

describe.each([
  ["an environment's Overview Apps card", renderCard, cardRowOf],
  ["All Apps", renderAllApps, tableCellOf],
])(
  "%s",
  (
    _where: string,
    draw: () => Promise<void>,
    cellOf: (name: string) => HTMLElement,
  ) => {
    test("an App Service app that sends no traces shows its site's last hour, marked as Azure Monitor's", async () => {
      await draw();

      await waitFor(() => {
        expect(
          within(cellOf("checkout-api")).getByTestId(
            "cloud-app-platform-signals",
          ),
        ).toBeInTheDocument();
      });

      const cell: HTMLElement = cellOf("checkout-api");
      const errors: HTMLElement = within(cell).getByTestId(
        "cloud-app-platform-server-errors",
      );

      // 60 of 1,200 requests answered with a 5xx: red, as a 5% error rate is.
      expect(textOf(cell, "cloud-app-platform-server-errors")).toBe(
        "5.0% server errors",
      );
      expect(errors.getAttribute("data-tone")).toBe("danger");
      expect(textOf(cell, "cloud-app-platform-requests")).toBe("1.2k requests");
      expect(textOf(cell, "cloud-app-platform-response-time")).toBe(
        "250 ms on average",
      );
      expect(textOf(cell, "cloud-app-platform-source")).toBe("Azure Monitor");
      expect(
        within(cell)
          .getByTestId("cloud-app-platform-signals")
          .getAttribute("title"),
      ).toBe(APP_PLATFORM_SIGNALS_HINT);
      // Never the traced numbers' words: no "errors", no "p95".
      expect(within(cell).queryByTestId("cloud-app-error-rate")).toBeNull();
      expect(within(cell).queryByTestId("cloud-app-p95")).toBeNull();
      expect(within(cell).queryByTestId("cloud-app-no-traces")).toBeNull();
    });

    test("a site the reader may not read shows no number, and its metrics are never asked for", async () => {
      await draw();

      await waitFor(() => {
        expect(
          within(cellOf("checkout-api")).getByTestId(
            "cloud-app-platform-signals",
          ),
        ).toBeInTheDocument();
      });

      const cell: HTMLElement = cellOf("orders-api");

      expect(within(cell).getByTestId("cloud-app-no-traces")).toHaveTextContent(
        "No traces",
      );
      expect(
        within(cell).queryByTestId("cloud-app-platform-signals"),
      ).toBeNull();
      expect(sitesAskedFor().has(armId("orders-api"))).toBe(false);
      expect(sitesAskedFor()).toEqual(
        new Set([armId("checkout-api"), armId("quiet-api"), armId("idle-api")]),
      );
    });

    test("an app with no site kept says No traces, as before", async () => {
      await draw();

      await waitFor(() => {
        expect(
          within(cellOf("billing-api")).getByTestId("cloud-app-no-traces"),
        ).toBeInTheDocument();
      });

      expect(
        within(cellOf("billing-api"))
          .getByTestId("cloud-app-no-traces")
          .getAttribute("title"),
      ).toBe(APP_NO_TRACES_HINT);
    });

    test("an app that sends traces keeps its traced numbers, never its site's", async () => {
      await draw();

      await waitFor(() => {
        expect(
          within(cellOf("search-api")).getByTestId("cloud-app-error-rate"),
        ).toBeInTheDocument();
      });

      const cell: HTMLElement = cellOf("search-api");

      expect(textOf(cell, "cloud-app-error-rate")).toBe("1.0% errors");
      expect(
        within(cell).queryByTestId("cloud-app-platform-signals"),
      ).toBeNull();
    });

    test("a site that answered nothing reads No requests - measured - still marked Azure Monitor's", async () => {
      await draw();

      await waitFor(() => {
        expect(
          within(cellOf("quiet-api")).getByTestId(
            "cloud-app-platform-no-requests",
          ),
        ).toBeInTheDocument();
      });

      const cell: HTMLElement = cellOf("quiet-api");

      expect(textOf(cell, "cloud-app-platform-no-requests")).toBe(
        "No requests",
      );
      expect(textOf(cell, "cloud-app-platform-source")).toBe("Azure Monitor");
      expect(
        within(cell).queryByTestId("cloud-app-platform-server-errors"),
      ).toBeNull();
    });

    test("while the site's numbers load, a skeleton - never No traces first", async () => {
      metricReads = "pending";

      await draw();

      await waitFor(() => {
        expect(
          within(cellOf("checkout-api")).getByTestId(
            "cloud-app-platform-signals-loading",
          ),
        ).toBeInTheDocument();
      });

      const cell: HTMLElement = cellOf("checkout-api");

      expect(
        within(cell).getByTestId(INLINE_VALUE_SKELETON_TEST_ID),
      ).toBeInTheDocument();
      expect(within(cell).queryByTestId("cloud-app-no-traces")).toBeNull();
      // An app with no site to read waits for nothing.
      expect(
        within(cellOf("billing-api")).getByTestId("cloud-app-no-traces"),
      ).toBeInTheDocument();
    });

    test("a site Azure Monitor reported nothing of in the hour says No traces, never No requests or a 0", async () => {
      await draw();

      await waitFor(() => {
        expect(
          within(cellOf("checkout-api")).getByTestId(
            "cloud-app-platform-signals",
          ),
        ).toBeInTheDocument();
      });

      const cell: HTMLElement = cellOf("idle-api");

      expect(
        within(cell).getByTestId("cloud-app-no-traces"),
      ).toBeInTheDocument();
      expect(
        within(cell).queryByTestId("cloud-app-platform-signals"),
      ).toBeNull();
    });

    test("a read that fails shows No traces, never a 0", async () => {
      metricReads = "fail";

      await draw();

      await waitFor(() => {
        expect(
          within(cellOf("checkout-api")).getByTestId("cloud-app-no-traces"),
        ).toBeInTheDocument();
      });

      expect(
        within(cellOf("checkout-api")).queryByTestId(
          "cloud-app-platform-signals",
        ),
      ).toBeNull();
    });
  },
);

describe("the environment's Overview Apps card ranks by what it shows", () => {
  test("an App Service app whose site answers 5% of its requests with a 5xx comes first", async () => {
    apps = [BILLING, QUIET, SEARCH, CHECKOUT];

    await renderCard();

    await waitFor(() => {
      expect(
        within(cardRowOf("checkout-api")).getByTestId(
          "cloud-app-platform-signals",
        ),
      ).toBeInTheDocument();
    });

    const names: Array<string> = screen
      .getAllByTestId("environment-app")
      .map((row: HTMLElement): string => {
        return within(row).getByRole("link").textContent || "";
      });

    // Red first, then amber (search-api's 1%), then the rest by name.
    expect(names[0]).toBe("checkout-api");
    expect(names[1]).toBe("search-api");
  });
});

describe("All Apps", () => {
  test("reads each app's kept site and its cloud.resource_id with the rows", async () => {
    await renderAllApps();

    const select: Record<string, unknown> = mockTable.props?.[
      "selectMoreFields"
    ] as Record<string, unknown>;

    expect(select).toEqual(
      expect.objectContaining({
        platformCloudResourceId: true,
        providerResourceId: true,
        tracesLastReceivedAt: true,
      }),
    );
  });

  test("the Last hour column says where an App Service app's numbers come from", async () => {
    await renderAllApps();

    const column: { headerTooltip?: string } | undefined = (
      mockTable.props?.["columns"] as Array<{
        id?: string;
        headerTooltip?: string;
      }>
    ).find((candidate: { id?: string }): boolean => {
      return candidate.id === "last-hour";
    });

    expect(column?.headerTooltip).toContain(
      "An App Service app that sends no traces shows its site's numbers from Azure Monitor",
    );
  });
});

describe("the Last hour cell, drawn alone", () => {
  const NO_TRACED_REQUESTS: {
    requests: number;
    errors: number;
    errorRatePercent: number | null;
    p95Ms: number | null;
  } = { requests: 0, errors: 0, errorRatePercent: null, p95Ms: null };

  test("a refresh keeps the site's numbers on screen until the new ones are in", () => {
    render(
      <CloudAppSignalsSummaryCell
        signals={NO_TRACED_REQUESTS}
        hasTraces={false}
        platformSignals={{
          requests: 40,
          serverErrors: 0,
          serverErrorRatePercent: 0,
          responseTimeMs: 90,
        }}
        isLoadingPlatformSignals={true}
      />,
    );

    expect(
      screen.getByTestId("cloud-app-platform-signals"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("cloud-app-platform-signals-loading"),
    ).toBeNull();
  });

  test("a site that answered requests but no 5xx point was read says its requests first, never 0% server errors", () => {
    render(
      <CloudAppSignalsSummaryCell
        signals={NO_TRACED_REQUESTS}
        hasTraces={false}
        platformSignals={{
          requests: 40,
          serverErrors: null,
          serverErrorRatePercent: null,
          responseTimeMs: null,
        }}
      />,
    );

    expect(textOf(document.body, "cloud-app-platform-requests")).toBe(
      "40 requests",
    );
    expect(screen.queryByTestId("cloud-app-platform-server-errors")).toBeNull();
    expect(screen.queryByTestId("cloud-app-platform-response-time")).toBeNull();
    expect(textOf(document.body, "cloud-app-platform-source")).toBe(
      "Azure Monitor",
    );
  });

  test("an app whose traced requests are in keeps them, whatever its site measured", () => {
    render(
      <CloudAppSignalsSummaryCell
        signals={{ requests: 10, errors: 0, errorRatePercent: 0, p95Ms: 30 }}
        hasTraces={false}
        platformSignals={{
          requests: 40,
          serverErrors: 0,
          serverErrorRatePercent: 0,
          responseTimeMs: 90,
        }}
      />,
    );

    expect(screen.getByTestId("cloud-app-signals")).toBeInTheDocument();
    expect(screen.queryByTestId("cloud-app-platform-signals")).toBeNull();
  });
});

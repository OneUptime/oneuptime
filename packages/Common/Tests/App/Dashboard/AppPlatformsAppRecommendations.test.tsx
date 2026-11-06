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
import { MemoryRouter } from "react-router-dom";
import { PROJECT_ID } from "./SideMenuHarness";

/*
 * An App Platforms app's own recommended monitors, on its page: the real
 * page (Pages/AppPlatforms/View/App), with its tabs' heavy contents and the
 * network stood in for. Its Recommendations tab hands the shared shell the
 * app the page shows; the header's Set up alerts opens that tab - every time
 * it is pressed - for an app whose telemetry can be told apart, and links to
 * its service's recommendations for one whose cannot.
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

// Every tab's contents but the one under test: what each was handed.
function mockTabStub(testId: string): unknown {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): unknown => {
      const react: typeof React = jest.requireActual("react") as typeof React;

      return react.createElement("div", {
        "data-testid": testId,
        "data-props": JSON.stringify(
          Object.fromEntries(
            Object.entries(props).map(([key, value]: [string, unknown]) => {
              return [key, String(value)];
            }),
          ),
        ),
      });
    },
  };
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/CloudAppOverviewTab",
  () => {
    return mockTabStub("overview-tab");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/CloudAppRevisionsTab",
  () => {
    return mockTabStub("revisions-tab");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    return mockTabStub("logs-tab");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer",
  () => {
    return mockTabStub("traces-tab");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationsPage",
  () => {
    return mockTabStub("recommendations-tab");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return mockTabStub("auto-refresh");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/View/Instances",
  () => {
    return {
      __esModule: true,
      ...(mockTabStub("instances-page") as Record<string, unknown>),
      CloudInstancesTable: (
        mockTabStub("instances-tab") as {
          default: unknown;
        }
      ).default,
    };
  },
);

import CloudApp from "../../../Models/DatabaseModels/CloudApp";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import { MonitorRecommendationResourceType } from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import AppPlatformApp, {
  CloudAppTabName,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/View/App";
import { APP_SET_UP_APP_ALERTS_HINT } from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/CloudAppHeader";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";

const ENVIRONMENT_ID: string = "71000000-0000-4000-8000-000000000001";
const APP_ID: string = "75000000-0000-4000-8000-000000000001";
const SERVICE_ID: string = "77000000-0000-4000-8000-000000000001";
const APP_PAGE: string = `/dashboard/${PROJECT_ID}/app-platforms/${ENVIRONMENT_ID}/apps/${APP_ID}`;

interface AppPageScenario {
  // What ingest stored to tell the app's telemetry apart: none, too long a name.
  telemetryAttributes: Record<string, string>;
  // The service its telemetry is under, when Services has one of its name.
  withService: boolean;
  search?: string | undefined;
}

function environment(): CloudResource {
  return Object.assign(new CloudResource(), {
    _id: ENVIRONMENT_ID,
    name: "checkout · us-east-1 · 4109-2277-8841",
    cloudPlatform: "aws_ecs",
    cloudProvider: "aws",
    cloudAccountId: "4109-2277-8841",
    cloudRegion: "us-east-1",
    resourceIdentifier: "aws_ecs|4109-2277-8841|us-east-1",
  });
}

function app(scenario: AppPageScenario): CloudApp {
  return Object.assign(new CloudApp(), {
    _id: APP_ID,
    name: "checkout-api",
    cloudResourceId: new ObjectID(ENVIRONMENT_ID),
    cloudPlatform: "aws_ecs",
    groupName: "production",
    telemetryAttributes: scenario.telemetryAttributes,
    serviceName: "checkout-api",
    currentRevision: "43",
    currentRevisionSince: new Date(Date.now() - 25 * 60 * 1000),
    lastSeenAt: new Date(Date.now() - 60 * 1000),
  });
}

function stubNetwork(scenario: AppPageScenario): void {
  jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(
      async (options: { modelType: unknown }): Promise<BaseModel | null> => {
        if (options.modelType === CloudApp) {
          return app(scenario);
        }
        if (options.modelType === CloudResource) {
          return environment();
        }
        return null;
      },
    );

  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(
      async (options: {
        modelType: unknown;
      }): Promise<ListResult<BaseModel>> => {
        const data: Array<BaseModel> =
          scenario.withService &&
          new (options.modelType as new () => BaseModel)().tableName ===
            "Service"
            ? [
                Object.assign(
                  new (options.modelType as new () => BaseModel)(),
                  { _id: SERVICE_ID },
                ),
              ]
            : [];

        return { data, count: data.length, skip: 0, limit: 100 };
      },
    );
}

async function renderAppPage(scenario: AppPageScenario): Promise<void> {
  stubNetwork(scenario);
  window.history.pushState({}, "", `${APP_PAGE}${scenario.search || ""}`);

  render(
    <MemoryRouter>
      <AppPlatformApp
        pageRoute={RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_APP_DETAIL]!}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  await screen.findByTestId("cloud-app-header");
}

function tab(name: string): HTMLElement {
  return screen.getByTestId(`tab-${name}`);
}

function recommendationsTabProps(): Record<string, string> {
  return JSON.parse(
    screen.getByTestId("recommendations-tab").getAttribute("data-props")!,
  ) as Record<string, string>;
}

const CHECKOUT_ATTRIBUTES: Record<string, string> = {
  "aws.ecs.task.family": "checkout-api",
  "aws.ecs.cluster.arn":
    "arn:aws:ecs:us-east-1:4109-2277-8841:cluster/production",
};

describe("an app's Recommendations tab", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("is the last of its tabs, and hands the shell the app the page shows", async () => {
    await renderAppPage({
      telemetryAttributes: CHECKOUT_ATTRIBUTES,
      withService: true,
      search: "?tab=Recommendations",
    });

    expect(
      screen.getAllByRole("tab").map((element: HTMLElement): string => {
        return element.getAttribute("data-testid") || "";
      }),
    ).toEqual([
      "tab-Overview",
      "tab-Revisions",
      "tab-Instances",
      "tab-Logs",
      "tab-Traces",
      "tab-Recommendations",
    ]);
    // The address's tab, selected once the tabs have settled.
    await waitFor(() => {
      expect(tab(CloudAppTabName.Recommendations)).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
    expect(recommendationsTabProps()).toEqual({
      resourceType: MonitorRecommendationResourceType.CloudApp,
      resourceId: APP_ID,
    });
  });

  test("Set up alerts opens it for an app whose telemetry is told apart - every time, and focused", async () => {
    await renderAppPage({
      telemetryAttributes: CHECKOUT_ATTRIBUTES,
      withService: true,
    });

    await waitFor(() => {
      expect(tab(CloudAppTabName.Overview)).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
    expect(screen.queryByTestId("recommendations-tab")).toBeNull();

    // A button of the page, not a link to the service's recommendations.
    const setUp: HTMLElement = screen.getByRole("button", {
      name: "Set up alerts",
    });
    expect(setUp).toHaveAttribute("title", APP_SET_UP_APP_ALERTS_HINT);
    expect(screen.queryByRole("link", { name: "Set up alerts" })).toBeNull();

    act(() => {
      fireEvent.click(setUp);
    });

    await waitFor(() => {
      expect(tab(CloudAppTabName.Recommendations)).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
    expect(screen.getByTestId("recommendations-tab")).toBeInTheDocument();
    expect(document.activeElement).toBe(tab(CloudAppTabName.Recommendations));

    // Away to another tab, and Set up alerts brings it back.
    act(() => {
      fireEvent.click(tab(CloudAppTabName.Traces));
    });
    expect(tab(CloudAppTabName.Traces)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByTestId("recommendations-tab")).toBeNull();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Set up alerts" }));
    });

    await waitFor(() => {
      expect(tab(CloudAppTabName.Recommendations)).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
    expect(recommendationsTabProps()["resourceId"]).toBe(APP_ID);
  });

  test("an app whose name was too long to filter by is sent to its service's recommendations", async () => {
    await renderAppPage({ telemetryAttributes: {}, withService: true });

    expect(screen.queryByRole("button", { name: "Set up alerts" })).toBeNull();
    expect(screen.getByRole("link", { name: "Set up alerts" })).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/service/${SERVICE_ID}/recommendations`,
    );
    // Its tab is still there, and says why it offers nothing.
    expect(tab(CloudAppTabName.Recommendations)).toBeInTheDocument();
  });

  test("an app that cannot be told apart and has no service offers no Set up alerts", async () => {
    await renderAppPage({ telemetryAttributes: {}, withService: false });

    expect(screen.queryByRole("button", { name: "Set up alerts" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Set up alerts" })).toBeNull();
  });
});

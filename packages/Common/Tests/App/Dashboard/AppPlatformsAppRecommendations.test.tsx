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
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { PROJECT_ID } from "./SideMenuHarness";

/*
 * An App Platforms app's own recommended monitors, on its page: the real
 * page (Pages/AppPlatforms/View/App), with its tabs' heavy contents and the
 * network stood in for. Its Recommendations tab hands the shared shell the
 * app the page shows, and counts the monitors still to set up, as a
 * resource's menu entry counts its own (RecommendationsCount); the header's
 * Set up alerts opens that tab - every time it is pressed - for an app whose
 * telemetry can be told apart, and links to its service's recommendations
 * for one whose cannot. While a scheduled maintenance event holds its
 * environment, the page says so above its tabs: its monitors open no
 * incident or alert until it ends.
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
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { getAllCloudAppAlertTemplates } from "../../../Types/Monitor/CloudAppAlertTemplates";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ModelListCache from "../../../UI/Utils/ModelListCache";
import { buildCloudAppRecommendationContext } from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationResourceRegistry";
import { RECOMMENDATIONS_CHANGED_EVENT } from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationsChanged";
import { CLOUD_ENVIRONMENT_MAINTENANCE_NOTICE_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/CloudEnvironmentMaintenanceNotice";
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
  // The project's monitors, as the tab's count reads them.
  monitors?: Array<Monitor> | undefined;
  // The scheduled maintenance events in progress that hold its environment.
  holdingEvents?: Array<ScheduledMaintenance> | undefined;
}

// The project's states, its ongoing one an event is in progress in.
function maintenanceStates(): Array<ScheduledMaintenanceState> {
  return [
    Object.assign(new ScheduledMaintenanceState(), {
      _id: "44000000-0000-4000-8000-000000000001",
      name: "Scheduled",
      order: 1,
      isScheduledState: true,
    }),
    Object.assign(new ScheduledMaintenanceState(), {
      _id: "44000000-0000-4000-8000-000000000002",
      name: "Ongoing",
      order: 2,
      isOngoingState: true,
    }),
    Object.assign(new ScheduledMaintenanceState(), {
      _id: "44000000-0000-4000-8000-000000000003",
      name: "Ended",
      order: 3,
      isEndedState: true,
    }),
  ];
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
        query?: Record<string, unknown>;
      }): Promise<ListResult<BaseModel>> => {
        let data: Array<BaseModel> =
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

        if (options.modelType === Monitor) {
          // Read by kind, as the server answers it.
          data = (scenario.monitors || []).filter(
            (monitor: Monitor): boolean => {
              return monitor.monitorType === options.query?.["monitorType"];
            },
          );
        }

        if (options.modelType === ScheduledMaintenanceState) {
          data = maintenanceStates();
        }

        if (options.modelType === ScheduledMaintenance) {
          data = scenario.holdingEvents || [];
        }

        return { data, count: data.length, skip: 0, limit: 100 };
      },
    );
}

function getListCallsOf(modelType: unknown): number {
  return (
    ModelAPI.getList as unknown as { mock: { calls: Array<Array<unknown>> } }
  ).mock.calls.filter((call: Array<unknown>): boolean => {
    return (call[0] as { modelType: unknown }).modelType === modelType;
  }).length;
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

const TEMPLATE_IDS: Array<string> = getAllCloudAppAlertTemplates().map(
  (template: { id: string }): string => {
    return template.id;
  },
);

// A monitor made from one of the app's recommendations, as its tab makes it.
function monitorFor(templateId: string): Monitor {
  const recommendation: MonitorRecommendation =
    MonitorRecommendationCatalog.getRecommendations(
      MonitorRecommendationResourceType.CloudApp,
      buildCloudAppRecommendationContext({
        environmentId: ENVIRONMENT_ID,
        environment: {
          cloudPlatform: "aws_ecs",
          cloudAccountId: "4109-2277-8841",
          cloudRegion: "us-east-1",
        },
        telemetryAttributes: CHECKOUT_ATTRIBUTES,
      }),
    ).find((candidate: MonitorRecommendation): boolean => {
      return candidate.templateId === templateId;
    })!;
  const placeholder: ObjectID = ObjectID.getZeroObjectID();
  const monitor: Monitor = new Monitor();
  monitor._id = ObjectID.generate().toString();
  monitor.name = `checkout-api - ${recommendation.name}`;
  monitor.monitorType = recommendation.monitorType;
  monitor.monitorSteps = new MonitorSteps();
  monitor.monitorSteps.data = {
    monitorStepsInstanceArray: [
      recommendation.getMonitorStep({
        resourceIdentifier: APP_ID,
        onlineMonitorStatusId: placeholder,
        offlineMonitorStatusId: placeholder,
        defaultIncidentSeverityId: placeholder,
        defaultAlertSeverityId: placeholder,
        monitorName: "checkout-api",
      }),
    ],
    defaultMonitorStatusId: placeholder,
  };
  return monitor;
}

function holdingEvent(title: string): ScheduledMaintenance {
  return Object.assign(new ScheduledMaintenance(), {
    _id: "e0000000-0000-4000-8000-000000000001",
    title: title,
    endsAt: OneUptimeDate.addRemoveHours(OneUptimeDate.getCurrentDate(), 2),
  });
}

describe("an app's Recommendations tab", () => {
  beforeEach(() => {
    window.localStorage.clear();
    ModelListCache.invalidateAll();
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

describe("the Recommendations tab's count", () => {
  beforeEach(() => {
    window.localStorage.clear();
    ModelListCache.invalidateAll();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("counts the app's recommended monitors still to set up, as a resource's menu entry counts its own", async () => {
    await renderAppPage({
      telemetryAttributes: CHECKOUT_ATTRIBUTES,
      withService: true,
    });

    await waitFor(() => {
      expect(
        within(tab(CloudAppTabName.Recommendations)).getByText(
          String(TEMPLATE_IDS.length),
        ),
      ).toBeInTheDocument();
    });
    // Only that tab carries it: Revisions counts its own.
    expect(
      within(tab(CloudAppTabName.Overview)).queryByText(
        String(TEMPLATE_IDS.length),
      ),
    ).toBeNull();
  });

  test("one set up already is counted off, and the count is read again when the tab sets some up", async () => {
    const scenario: AppPageScenario = {
      telemetryAttributes: CHECKOUT_ATTRIBUTES,
      withService: true,
      monitors: [monitorFor("cloud-app-failed-operations")],
    };

    await renderAppPage(scenario);

    await waitFor(() => {
      expect(
        within(tab(CloudAppTabName.Recommendations)).getByText(
          String(TEMPLATE_IDS.length - 1),
        ),
      ).toBeInTheDocument();
    });

    // The tab makes two more, and says so.
    scenario.monitors!.push(
      monitorFor("cloud-app-latency-p95"),
      monitorFor("cloud-app-traffic-stopped"),
    );

    await act(async () => {
      window.dispatchEvent(new Event(RECOMMENDATIONS_CHANGED_EVENT));
    });

    await waitFor(() => {
      expect(
        within(tab(CloudAppTabName.Recommendations)).getByText(
          String(TEMPLATE_IDS.length - 3),
        ),
      ).toBeInTheDocument();
    });
  });

  test("a cleared count is no count: every recommended monitor set up", async () => {
    await renderAppPage({
      telemetryAttributes: CHECKOUT_ATTRIBUTES,
      withService: true,
      monitors: TEMPLATE_IDS.map((templateId: string): Monitor => {
        return monitorFor(templateId);
      }),
    });

    await waitFor(() => {
      expect(getListCallsOf(Monitor)).toBeGreaterThan(0);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(tab(CloudAppTabName.Recommendations)).toHaveTextContent(
      /^Recommendations$/,
    );
  });

  test("an app whose telemetry cannot be told apart has no count, and reads no monitor for one", async () => {
    await renderAppPage({ telemetryAttributes: {}, withService: true });

    await act(async () => {
      await Promise.resolve();
    });

    expect(tab(CloudAppTabName.Recommendations)).toHaveTextContent(
      /^Recommendations$/,
    );
    expect(getListCallsOf(Monitor)).toBe(0);
  });
});

describe("while maintenance holds the app's environment", () => {
  beforeEach(() => {
    window.localStorage.clear();
    ModelListCache.invalidateAll();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("the page says so above its tabs: which event, and that the app's monitors open nothing", async () => {
    await renderAppPage({
      telemetryAttributes: CHECKOUT_ATTRIBUTES,
      withService: true,
      holdingEvents: [holdingEvent("ECS cluster upgrade")],
    });

    const notice: HTMLElement = await screen.findByTestId(
      CLOUD_ENVIRONMENT_MAINTENANCE_NOTICE_TEST_ID,
    );

    expect(notice).toHaveTextContent("Under maintenance");
    expect(notice).toHaveTextContent(
      "covers this app's environment until",
    );
    expect(notice).toHaveTextContent(
      "Until then, the app's monitors open no incidents or alerts.",
    );
    expect(
      within(notice).getByRole("link", { name: "ECS cluster upgrade" }),
    ).toBeInTheDocument();

    // Under the header, before the tabs.
    const tablist: HTMLElement = screen.getByRole("tablist");
    expect(
      notice.compareDocumentPosition(tablist) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen
        .getByTestId("cloud-app-header")
        .compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("nothing is said while nothing holds it", async () => {
    await renderAppPage({
      telemetryAttributes: CHECKOUT_ATTRIBUTES,
      withService: true,
    });

    await waitFor(() => {
      expect(getListCallsOf(ScheduledMaintenance)).toBe(1);
    });

    expect(
      screen.queryByTestId(CLOUD_ENVIRONMENT_MAINTENANCE_NOTICE_TEST_ID),
    ).toBeNull();
  });
});

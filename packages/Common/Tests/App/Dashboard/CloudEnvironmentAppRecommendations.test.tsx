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
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * An App Platforms environment's Recommendations
 * (CloudEnvironmentAppRecommendations), rendered for real over a stubbed
 * data layer: the monitors OneUptime recommends for every app it runs, a row
 * per recommendation, added to one app or to every app still without it at
 * once - each monitor built for its own app, read by the app's own filter,
 * linked to the environment, made one at a time by the bulk runner. What an
 * app's own tab set up or dismissed is not offered again; the apps left out
 * are named, by why; a member who may not create monitors reads why, and
 * every Add is locked. The count beside the page in the environment's menu
 * (CloudEnvironmentRecommendationsMenuItem) is worked out the same way.
 */

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

// The arrow wrappers are load bearing: jest.mock is hoisted above the mocks.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      createOrUpdate: (...args: Array<unknown>) => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

/*
 * Billing off, whatever the environment says: CI's config.env turns it on,
 * and with it a Free plan's run waits for the charge to be acknowledged -
 * which ActiveMonitorLimitNotice's and PayAsYouGo's own suites hold.
 */
jest.mock("../../../UI/Config", () => {
  return {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
    BILLING_ENABLED: false,
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/ProjectUser", () => {
  return {
    __esModule: true,
    default: {
      fetchProjectUsersAsDropdownOptions: () => {
        return Promise.resolve([]);
      },
    },
  };
});

import CloudEnvironmentAppRecommendations from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/CloudEnvironmentAppRecommendations";
import CloudEnvironmentRecommendationsMenuItem from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/CloudEnvironmentRecommendationsMenuItem";
import { RECOMMENDATIONS_CHANGED_EVENT } from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationsChanged";
import { buildCloudAppRecommendationContext } from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationResourceRegistry";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import CloudApp from "../../../Models/DatabaseModels/CloudApp";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import RecommendationDismissal from "../../../Models/DatabaseModels/RecommendationDismissal";
import { getCloudEnvironmentKeyOfFilter } from "../../../Types/Cloud/CloudEnvironmentTelemetryScope";
import { getAllCloudAppAlertTemplates } from "../../../Types/Monitor/CloudAppAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";

const ENVIRONMENT_ID: string = "71000000-0000-4000-8000-000000000001";
const ENVIRONMENT_PAGE: string = `/dashboard/${PROJECT_ID}/app-platforms/${ENVIRONMENT_ID}`;

// The lock's first sentence on a page that makes monitors by the batch.
const MONITORS_LOCK_FIRST_SENTENCE: RegExp =
  /^You do not have permission to create monitors\./;

const TEMPLATE_COUNT: number = getAllCloudAppAlertTemplates().length;

const IDS: Record<string, string> = {
  checkoutApi: "75000000-0000-4000-8000-000000000001",
  inventory: "75000000-0000-4000-8000-000000000002",
  longName: "75000000-0000-4000-8000-000000000003",
};

function environmentRow(platform: string | null = "aws_ecs"): CloudResource {
  const environment: CloudResource = new CloudResource();
  const record: Record<string, unknown> = environment as unknown as Record<
    string,
    unknown
  >;
  record["_id"] = ENVIRONMENT_ID;

  if (platform) {
    record["cloudPlatform"] = platform;
  }

  record["cloudAccountId"] = "123456789012";
  record["cloudRegion"] = "us-east-1";
  return environment;
}

function appRow(data: {
  id: string;
  name: string;
  attributes: Record<string, string>;
  groupName?: string;
}): CloudApp {
  const app: CloudApp = new CloudApp();
  const record: Record<string, unknown> = app as unknown as Record<
    string,
    unknown
  >;
  record["_id"] = data.id;
  record["name"] = data.name;
  record["cloudResourceId"] = new ObjectID(ENVIRONMENT_ID);
  record["cloudPlatform"] = "aws_ecs";
  record["telemetryAttributes"] = data.attributes;

  if (data.groupName) {
    record["groupName"] = data.groupName;
  }

  return app;
}

// The environment's apps, as the page reads them.
function environmentApps(): Array<CloudApp> {
  return [
    appRow({
      id: IDS["checkoutApi"]!,
      name: "checkout-api",
      groupName: "production",
      attributes: {
        "aws.ecs.task.family": "checkout-api",
        "aws.ecs.cluster.arn":
          "arn:aws:ecs:us-east-1:123456789012:cluster/production",
      },
    }),
    appRow({
      id: IDS["inventory"]!,
      name: "inventory",
      groupName: "production",
      attributes: {
        "aws.ecs.task.family": "inventory",
        "aws.ecs.cluster.arn":
          "arn:aws:ecs:us-east-1:123456789012:cluster/production",
      },
    }),
    // Its name was too long to filter by: ingest stored no attribute for it.
    appRow({
      id: IDS["longName"]!,
      name: "a-very-long-generated-task-family-name",
      attributes: {},
    }),
  ];
}

// A monitor made from one of an app's recommendations, as its own tab makes it.
function monitorFor(app: CloudApp, templateId: string): Monitor {
  const recommendation: MonitorRecommendation =
    MonitorRecommendationCatalog.getRecommendations(
      MonitorRecommendationResourceType.CloudApp,
      buildCloudAppRecommendationContext({
        environmentId: ENVIRONMENT_ID,
        environment: {
          cloudPlatform: "aws_ecs",
          cloudAccountId: "123456789012",
          cloudRegion: "us-east-1",
        },
        telemetryAttributes: app.telemetryAttributes,
      }),
    ).find((candidate: MonitorRecommendation): boolean => {
      return candidate.templateId === templateId;
    })!;
  const placeholder: ObjectID = ObjectID.getZeroObjectID();
  const step: MonitorStep = recommendation.getMonitorStep({
    resourceIdentifier: app._id!,
    onlineMonitorStatusId: placeholder,
    offlineMonitorStatusId: placeholder,
    defaultIncidentSeverityId: placeholder,
    defaultAlertSeverityId: placeholder,
    monitorName: app.name!,
  });
  const monitor: Monitor = new Monitor();
  monitor._id = ObjectID.generate().toString();
  monitor.name = `${app.name} - ${recommendation.name}`;
  monitor.monitorType = recommendation.monitorType;
  monitor.monitorSteps = new MonitorSteps();
  monitor.monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: placeholder,
  };
  return monitor;
}

function dismissalFor(
  appId: string,
  templateId: string,
): RecommendationDismissal {
  const dismissal: RecommendationDismissal = new RecommendationDismissal();
  const record: Record<string, unknown> = dismissal as unknown as Record<
    string,
    unknown
  >;
  record["recommendationId"] = `CloudApp:${templateId}`;
  record["resourceId"] = new ObjectID(appId);
  record["recommendationType"] = "Monitor";
  record["resourceType"] = MonitorRecommendationResourceType.CloudApp;
  return dismissal;
}

let environment: CloudResource | null = null;
let apps: Array<CloudApp> = [];
let appTotal: number | null = null;
let monitors: Array<Monitor> = [];
let dismissals: Array<RecommendationDismissal> = [];
let failAppsRead: boolean = false;

// Everything a recommended monitor is built with, and what the panel offers.
function projectList(args: Record<string, unknown>): { data: Array<unknown> } {
  const modelType: unknown = args["modelType"];

  if (modelType === MonitorStatus) {
    const online: MonitorStatus = new MonitorStatus();
    online._id = "55000000-0000-4000-8000-000000000001";
    online.name = "Operational";
    online.isOperationalState = true;
    const offline: MonitorStatus = new MonitorStatus();
    offline._id = "55000000-0000-4000-8000-000000000002";
    offline.name = "Offline";
    offline.isOfflineState = true;
    return { data: [online, offline] };
  }

  if (modelType === IncidentSeverity || modelType === AlertSeverity) {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity._id = "52000000-0000-4000-8000-000000000001";
    severity.name = "Critical";
    severity.order = 1;
    return { data: [severity] };
  }

  if (modelType === OnCallDutyPolicy || modelType === Label) {
    return { data: [] };
  }

  if (modelType === Monitor) {
    // Read by kind, as the server answers it.
    const kind: unknown = (args["query"] as Record<string, unknown>)[
      "monitorType"
    ];

    return {
      data: monitors.filter((monitor: Monitor): boolean => {
        return monitor.monitorType === kind;
      }),
    };
  }

  if (modelType === RecommendationDismissal) {
    return { data: dismissals };
  }

  return { data: [] };
}

// A monitor as the server keeps it: under an id of its own.
function saved(model: Monitor): Monitor {
  model._id = ObjectID.generate().toString();
  return model;
}

function holding(permissions: Array<Permission>): void {
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
}

function listCallsOf(modelType: unknown): Array<Record<string, unknown>> {
  return getListMock.mock.calls
    .map((call: Array<unknown>): Record<string, unknown> => {
      return call[0] as Record<string, unknown>;
    })
    .filter((args: Record<string, unknown>): boolean => {
      return args["modelType"] === modelType;
    });
}

function createdMonitors(): Array<Monitor> {
  return createOrUpdateMock.mock.calls.map((call: Array<unknown>): Monitor => {
    return (call[0] as { model: Monitor }).model;
  });
}

beforeEach(() => {
  getItemMock.mockReset();
  getListMock.mockReset();
  createOrUpdateMock.mockReset();

  environment = environmentRow();
  apps = environmentApps();
  appTotal = null;
  monitors = [];
  dismissals = [];
  failAppsRead = false;

  goTo(`${ENVIRONMENT_PAGE}/recommendations`);

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));

  getItemMock.mockImplementation((args: unknown) => {
    if ((args as { modelType: unknown }).modelType === CloudResource) {
      return Promise.resolve(environment);
    }

    return Promise.resolve(null);
  });

  getListMock.mockImplementation((args: unknown) => {
    const modelType: unknown = (args as { modelType: unknown }).modelType;

    if (modelType === CloudApp) {
      if (failAppsRead) {
        return Promise.reject(new Error("The apps could not be read."));
      }

      return Promise.resolve({
        data: apps,
        count: appTotal === null ? apps.length : appTotal,
      });
    }

    return Promise.resolve(projectList(args as Record<string, unknown>));
  });

  // The server keeps each monitor, under an id of its own.
  createOrUpdateMock.mockImplementation((args: unknown) => {
    monitors.push(saved((args as { model: Monitor }).model));
    return Promise.resolve({});
  });

  holding([Permission.ProjectOwner]);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderPage(): Promise<void> {
  render(
    <MemoryRouter>
      <CloudEnvironmentAppRecommendations
        environmentId={new ObjectID(ENVIRONMENT_ID)}
      />
    </MemoryRouter>,
  );

  await screen.findByTestId("cloud-environment-recommendations");
}

function appsGroup(): HTMLElement {
  return screen.getByTestId("cloud-environment-recommendation-group-apps");
}

function rowOf(templateId: string): HTMLElement {
  return screen.getByTestId(
    `cloud-environment-recommendation-row-CloudApp:${templateId}`,
  );
}

async function createFromPanel(): Promise<void> {
  const panelCreate: HTMLElement = await screen.findByRole("button", {
    name: "Create Monitors",
  });

  await act(async () => {
    fireEvent.click(panelCreate);
  });
}

describe("what the environment is offered", () => {
  test("every app's recommended monitors, a row per recommendation, in one group of its apps", async () => {
    await renderPage();

    const group: HTMLElement = appsGroup();

    expect(within(group).getByText("Apps")).toBeInTheDocument();
    // The two apps it recommends monitors for: the third is named at the end.
    expect(
      within(group).getByText("Recommended for 2 apps"),
    ).toBeInTheDocument();

    const rows: Array<string> = within(group)
      .getAllByTestId(/^cloud-environment-recommendation-row-/)
      .map((element: HTMLElement): string => {
        return element.getAttribute("data-testid") || "";
      });

    expect(rows).toEqual(
      getAllCloudAppAlertTemplates().map((template: { id: string }) => {
        return `cloud-environment-recommendation-row-CloudApp:${template.id}`;
      }),
    );

    expect(
      within(rowOf("cloud-app-failed-operations")).getByText(
        "Set up on 0 of 2 apps",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "cloud-environment-recommendation-add-CloudApp:cloud-app-failed-operations",
      ),
    ).toHaveTextContent("Add to 2 Apps");
    expect(
      screen.getByText(
        "Monitors OneUptime recommends for this environment's apps, from the requests their OpenTelemetry reports. Add one to an app, or to every app at once.",
      ),
    ).toBeInTheDocument();
  });

  test("reads the environment's own apps, and its platform, account and Region once", async () => {
    await renderPage();

    const read: Record<string, unknown> = listCallsOf(CloudApp)[0]!;

    expect(
      (read["query"] as Record<string, unknown>)["cloudResourceId"]?.toString(),
    ).toBe(ENVIRONMENT_ID);
    expect(read["select"]).toEqual(
      expect.objectContaining({
        name: true,
        telemetryAttributes: true,
        groupName: true,
      }),
    );

    const environmentReads: Array<unknown> = getItemMock.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return (call[0] as { modelType: unknown }).modelType === CloudResource;
      },
    );
    expect(environmentReads).toHaveLength(1);

    // What may cover an app's recommendation: its Traces and Metrics monitors.
    expect(
      listCallsOf(Monitor)
        .map((args: Record<string, unknown>): unknown => {
          return (args["query"] as Record<string, unknown>)["monitorType"];
        })
        .sort(),
    ).toEqual([MonitorType.Metrics, MonitorType.Traces].sort());
    expect(
      (
        listCallsOf(RecommendationDismissal)[0]!["query"] as Record<
          string,
          unknown
        >
      )["resourceType"],
    ).toBe(MonitorRecommendationResourceType.CloudApp);
  });

  test("a row's list names each app with the cluster that tells it apart, each a link to its own Recommendations tab", async () => {
    await renderPage();

    const toggle: HTMLElement = screen.getByTestId(
      "cloud-environment-recommendation-toggle-CloudApp:cloud-app-error-burst",
    );

    expect(toggle).toHaveTextContent("Show apps");
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent("Hide apps");

    const list: HTMLElement = document.getElementById(
      toggle.getAttribute("aria-controls") || "",
    )!;
    const checkout: HTMLElement = within(list).getByTestId(
      `cloud-environment-recommendation-target-CloudApp:cloud-app-error-burst-${IDS["checkoutApi"]}`,
    );

    expect(checkout).toHaveTextContent("checkout-api");
    expect(checkout).toHaveTextContent("cluster production");
    expect(within(checkout).getByRole("link").getAttribute("href")).toBe(
      `${ENVIRONMENT_PAGE}/apps/${IDS["checkoutApi"]}?tab=Recommendations`,
    );
  });

  test("the apps it leaves out are named, by why, each a click from its own page", async () => {
    await renderPage();

    const section: HTMLElement = screen.getByTestId(
      "cloud-environment-recommendations-not-listed",
    );
    const tooLong: HTMLElement = within(section).getByTestId(
      "cloud-environment-recommendations-not-listed-NotScoped",
    );

    // Said of the one app it names.
    expect(tooLong).toHaveTextContent(
      "This app's name is too long to filter its telemetry by, so no monitor can watch it alone. Its telemetry is in this environment's tabs.",
    );
    expect(
      within(tooLong)
        .getByText("a-very-long-generated-task-family-name")
        .closest("a")
        ?.getAttribute("href"),
    ).toBe(`${ENVIRONMENT_PAGE}/apps/${IDS["longName"]}?tab=Recommendations`);
    // Nobody is offered the same app twice.
    expect(within(section).queryByText("checkout-api")).toBeNull();
  });

  test("two apps left out for a name too long are said of together", async () => {
    apps = [
      ...environmentApps(),
      appRow({
        id: "75000000-0000-4000-8000-000000000004",
        name: "another-very-long-generated-task-family-name",
        attributes: {},
      }),
    ];

    await renderPage();

    const tooLong: HTMLElement = screen.getByTestId(
      "cloud-environment-recommendations-not-listed-NotScoped",
    );

    expect(tooLong).toHaveTextContent(
      "Their names are too long to filter their telemetry by, so no monitor can watch one of them alone. Their telemetry is in this environment's tabs.",
    );
    expect(tooLong).not.toHaveTextContent("This app's name");
    expect(
      within(tooLong).getByText("a-very-long-generated-task-family-name"),
    ).toBeInTheDocument();
    expect(
      within(tooLong).getByText("another-very-long-generated-task-family-name"),
    ).toBeInTheDocument();
  });

  test("an environment that has more apps than one read lists says so", async () => {
    appTotal = 1200;

    await renderPage();

    expect(
      screen.getByText(
        "Only the first 3 of the environment's 1,200 apps are read here.",
      ),
    ).toBeInTheDocument();
  });

  test("a read that fails says so inside the page's card, and Refresh reads it again", async () => {
    failAppsRead = true;

    render(
      <MemoryRouter>
        <CloudEnvironmentAppRecommendations
          environmentId={new ObjectID(ENVIRONMENT_ID)}
        />
      </MemoryRouter>,
    );

    const failed: HTMLElement = await screen.findByTestId(
      "cloud-environment-recommendations-error",
    );
    expect(failed).toHaveTextContent("The apps could not be read.");
    expect(screen.getByText("Recommended Monitors")).toBeInTheDocument();

    failAppsRead = false;

    await act(async () => {
      fireEvent.click(within(failed).getByTestId("refresh-button"));
    });

    expect(
      await screen.findByTestId("cloud-environment-recommendations"),
    ).toBeInTheDocument();
  });
});

describe("adding monitors to every app at once", () => {
  test("Add to N Apps makes one monitor per app, read by the app's own filter, linked to the environment", async () => {
    await renderPage();

    fireEvent.click(
      screen.getByTestId(
        "cloud-environment-recommendation-add-CloudApp:cloud-app-failed-operations",
      ),
    );

    // The panel says what it makes, and on how many apps.
    expect(
      await screen.findByText(
        "These monitors will be created on 2 apps of this environment. Everything below applies to all of them.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("checkout-api - Failed Operations"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("inventory - Failed Operations"),
    ).toBeInTheDocument();

    await createFromPanel();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(2);
    });

    for (const monitor of createdMonitors()) {
      expect(monitor.monitorType).toBe(MonitorType.Traces);
      expect(
        (monitor.cloudResources || []).map((resource: CloudResource) => {
          return resource.id?.toString();
        }),
      ).toEqual([ENVIRONMENT_ID]);
      // The environment's maintenance holds it: it reads that environment only.
      expect(
        getCloudEnvironmentKeyOfFilter(
          monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!
            .traceMonitor!.attributes,
        ),
      ).toBe("aws_ecs|123456789012|us-east-1");
    }

    expect(
      await screen.findByTestId("bulk-action-succeeded-count"),
    ).toHaveTextContent("2");
  });

  test("Add All sets up every recommendation still to set up, on every app", async () => {
    await renderPage();

    fireEvent.click(
      screen.getByTestId("cloud-environment-recommendation-add-all-apps"),
    );
    await createFromPanel();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(2 * TEMPLATE_COUNT);
    });

    expect(
      new Set(
        createdMonitors().map((monitor: Monitor): string => {
          return monitor.name || "";
        }),
      ).size,
    ).toBe(2 * TEMPLATE_COUNT);
  });

  test("an app's own Add, in the row's list, makes just that one", async () => {
    await renderPage();

    fireEvent.click(
      screen.getByTestId(
        "cloud-environment-recommendation-toggle-CloudApp:cloud-app-latency-p95",
      ),
    );
    fireEvent.click(
      await screen.findByTestId(
        `cloud-environment-recommendation-add-one-CloudApp:cloud-app-latency-p95-${IDS["inventory"]}`,
      ),
    );
    await createFromPanel();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(createdMonitors()[0]!.name).toBe(
      "inventory - High Request Latency (p95)",
    );
    expect(createdMonitors()[0]!.monitorType).toBe(MonitorType.Metrics);
  });

  test("what was made is read again and offered no more, and the menu's count is told", async () => {
    const changed: MockFunction = getJestMockFunction();
    window.addEventListener(RECOMMENDATIONS_CHANGED_EVENT, changed);

    await renderPage();

    fireEvent.click(
      screen.getByTestId(
        "cloud-environment-recommendation-add-CloudApp:cloud-app-traffic-stopped",
      ),
    );
    await createFromPanel();

    await waitFor(() => {
      expect(changed).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(
        screen.queryByTestId(
          "cloud-environment-recommendation-row-CloudApp:cloud-app-traffic-stopped",
        ),
      ).toBeNull();
    });

    window.removeEventListener(RECOMMENDATIONS_CHANGED_EVENT, changed);
  });
});

describe("what an app's own tab set up or dismissed", () => {
  test("is counted as such, and not offered again", async () => {
    monitors = [monitorFor(apps[0]!, "cloud-app-failed-operations")];
    dismissals = [dismissalFor(IDS["inventory"]!, "cloud-app-traffic-stopped")];

    await renderPage();

    expect(
      within(rowOf("cloud-app-failed-operations")).getByText(
        "Set up on 1 of 2 apps",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "cloud-environment-recommendation-add-CloudApp:cloud-app-failed-operations",
      ),
    ).toHaveTextContent("Add to 1 App");
    expect(
      within(rowOf("cloud-app-traffic-stopped")).getByText(
        "Set up on 0 of 2 apps · 1 dismissed",
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId(
        "cloud-environment-recommendation-add-CloudApp:cloud-app-failed-operations",
      ),
    );
    await createFromPanel();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(createdMonitors()[0]!.name).toBe("inventory - Failed Operations");
  });

  test("every recommendation made: nothing left to set up, said of the environment's apps", async () => {
    monitors = apps.slice(0, 2).flatMap((app: CloudApp): Array<Monitor> => {
      return getAllCloudAppAlertTemplates().map(
        (template: { id: string }): Monitor => {
          return monitorFor(app, template.id);
        },
      );
    });

    await renderPage();

    expect(screen.getByText("Nothing left to set up here")).toBeInTheDocument();
    expect(
      screen.getByText(
        `All ${2 * TEMPLATE_COUNT} recommended monitors for this environment's apps have been created or dismissed. Use the tiles above to review them.`,
      ),
    ).toBeInTheDocument();
  });

  test("an environment with no apps yet says what brings them", async () => {
    apps = [];

    await renderPage();

    expect(
      screen.getByText("No apps in this environment yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Recommendations appear once an app in this environment sends its first telemetry.",
      ),
    ).toBeInTheDocument();
  });

  test("an environment whose platform is not known yet offers nothing, and says why for each app", async () => {
    environment = environmentRow(null);

    await renderPage();

    expect(
      screen.getByText("No recommendations for this environment's apps yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "cloud-environment-recommendations-not-listed-PlatformUnknown",
      ),
    ).toHaveTextContent(
      "Offered once this environment's telemetry names its platform",
    );
  });
});

describe("a member who may not create monitors", () => {
  test("sees what is recommended, reads why once, and every Add is locked", async () => {
    holding([Permission.Viewer]);

    await renderPage();

    expect(
      screen.getByTestId("cloud-environment-recommendations-locked")
        .textContent,
    ).toMatch(MONITORS_LOCK_FIRST_SENTENCE);

    const adds: Array<HTMLElement> = screen
      .getAllByRole("button")
      .filter((button: HTMLElement): boolean => {
        return (button.getAttribute("data-testid") || "").startsWith(
          "cloud-environment-recommendation-add",
        );
      });

    expect(adds.length).toBeGreaterThan(0);

    for (const add of adds) {
      expect(add).toBeDisabled();
    }

    fireEvent.click(adds[0]!);
    expect(
      screen.queryByRole("button", { name: "Create Monitors" }),
    ).toBeNull();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });
});

describe("the count beside the page in the environment's menu", () => {
  async function renderMenuItem(): Promise<void> {
    render(
      <MemoryRouter>
        <CloudEnvironmentRecommendationsMenuItem
          link={{
            title: "Recommendations",
            to: {
              toString: (): string => {
                return `${ENVIRONMENT_PAGE}/recommendations`;
              },
            } as never,
          }}
          environmentId={new ObjectID(ENVIRONMENT_ID)}
        />
      </MemoryRouter>,
    );

    await screen.findByText("Recommendations");
  }

  test("counts every monitor still to set up on every app, as the page does", async () => {
    monitors = [monitorFor(apps[0]!, "cloud-app-failed-operations")];

    await renderMenuItem();

    expect(
      await screen.findByText(String(2 * TEMPLATE_COUNT - 1)),
    ).toBeInTheDocument();
  });

  test("a cleared count is no badge at all", async () => {
    monitors = apps.slice(0, 2).flatMap((app: CloudApp): Array<Monitor> => {
      return getAllCloudAppAlertTemplates().map(
        (template: { id: string }): Monitor => {
          return monitorFor(app, template.id);
        },
      );
    });

    await renderMenuItem();
    // Let the reads settle.
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText("0")).toBeNull();
  });

  test("a read that fails leaves the entry, with no count", async () => {
    failAppsRead = true;

    await renderMenuItem();
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Recommendations")).toBeInTheDocument();
    expect(screen.queryByText(String(2 * TEMPLATE_COUNT))).toBeNull();
  });

  test("counts again when the page beside it sets some up", async () => {
    await renderMenuItem();

    expect(
      await screen.findByText(String(2 * TEMPLATE_COUNT)),
    ).toBeInTheDocument();

    monitors = [monitorFor(apps[1]!, "cloud-app-error-burst")];

    await act(async () => {
      window.dispatchEvent(new Event(RECOMMENDATIONS_CHANGED_EVENT));
    });

    expect(
      await screen.findByText(String(2 * TEMPLATE_COUNT - 1)),
    ).toBeInTheDocument();
  });
});

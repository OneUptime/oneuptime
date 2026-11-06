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
 * A cloud account's Recommendations (CloudAccountMonitorRecommendations),
 * rendered for real over a stubbed data layer: the monitors OneUptime
 * recommends for every resource the account holds, a row per
 * recommendation of each resource type, added to one resource, to every
 * resource of the type still without it, or every recommendation of a type
 * at once - each monitor built for its own resource, linked to it, every
 * five minutes, made one at a time by the bulk runner, which says what was
 * made and why anything was not. What is set up or dismissed is not offered
 * again; the resources left out are named, by why; a member who may not
 * create monitors reads why, and every Add is locked.
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

import CloudAccountMonitorRecommendations from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/CloudAccountMonitorRecommendations";
import { RECOMMENDATIONS_CHANGED_EVENT } from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationsChanged";
import { readCloudResourceRecommendationContext } from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationResourceRegistry";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import RecommendationDismissal from "../../../Models/DatabaseModels/RecommendationDismissal";
import { CLOUD_ALERT_MONITORING_INTERVAL } from "../../../Types/Monitor/CloudAlertTemplates";
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

const AWS_ACCOUNT: string = "123456789012";

function uuid(number: number): string {
  return `40000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

const IDS: Record<string, string> = {
  web1: uuid(1),
  web2: uuid(2),
  web3: uuid(3),
  checkout: uuid(4),
  ordersQueue: uuid(5),
  prodVpc: uuid(6),
  edgeNlb: uuid(7),
  ordersDb: uuid(8),
};

function attributes(
  namespace: string,
  dimensions: Record<string, string>,
): Record<string, string> {
  const values: Record<string, string> = {
    Namespace: namespace,
    "resource.cloud.account.id": AWS_ACCOUNT,
    "resource.cloud.region": "us-east-1",
  };

  for (const [name, value] of Object.entries(dimensions)) {
    values[`Dimensions.${name}`] = value;
  }

  return values;
}

function row(
  id: string,
  name: string,
  type: string,
  telemetryAttributes: Record<string, string>,
  properties: Record<string, unknown> = {},
): CloudResource {
  const resource: CloudResource = new CloudResource();
  const record: Record<string, unknown> = resource as unknown as Record<
    string,
    unknown
  >;
  record["_id"] = id;
  record["name"] = name;
  record["cloudProvider"] = "aws";
  record["cloudResourceType"] = type;
  record["telemetryAttributes"] = telemetryAttributes;
  record["cloudReadings"] = {};
  record["cloudProperties"] = properties;
  record["cloudConnectionId"] = "20000000-0000-4000-8000-000000000001";
  return resource;
}

// The account's resources, as the page reads them.
function accountRows(): Array<CloudResource> {
  return [
    row(
      IDS["web1"]!,
      "web-1",
      "AWS::EC2::Instance",
      attributes("AWS/EC2", { InstanceId: "i-1" }),
    ),
    row(
      IDS["web2"]!,
      "web-2",
      "AWS::EC2::Instance",
      attributes("AWS/EC2", { InstanceId: "i-2" }),
    ),
    // Listed a minute ago: its metrics have not arrived.
    row(IDS["web3"]!, "web-3", "AWS::EC2::Instance", {}),
    row(
      IDS["checkout"]!,
      "checkout",
      "AWS::Lambda::Function",
      attributes("AWS/Lambda", { FunctionName: "checkout" }),
    ),
    row(
      IDS["ordersQueue"]!,
      "orders-queue",
      "AWS::SQS::Queue",
      attributes("AWS/SQS", { QueueName: "orders-queue" }),
    ),
    row(
      IDS["ordersDb"]!,
      "orders-db",
      "AWS::RDS::DBInstance",
      attributes("AWS/RDS", { DBInstanceIdentifier: "orders-db" }),
      { AllocatedStorage: 200 },
    ),
    // No recommended monitor for a network.
    row(IDS["prodVpc"]!, "prod-vpc", "AWS::EC2::VPC", {}),
    // Nor for a network load balancer's namespace.
    row(
      IDS["edgeNlb"]!,
      "edge-nlb",
      "AWS::ElasticLoadBalancingV2::LoadBalancer",
      attributes("AWS/NetworkELB", { LoadBalancer: "net/edge-nlb/1" }),
    ),
  ];
}

// A monitor made from one of a resource's recommendations, as the page makes it.
function monitorFor(resource: CloudResource, templateId: string): Monitor {
  const recommendation: MonitorRecommendation =
    MonitorRecommendationCatalog.getRecommendations(
      MonitorRecommendationResourceType.CloudResource,
      readCloudResourceRecommendationContext(
        resource as unknown as Record<string, unknown>,
      ),
    ).find((candidate: MonitorRecommendation): boolean => {
      return candidate.templateId === templateId;
    })!;
  const placeholder: ObjectID = ObjectID.getZeroObjectID();
  const step: MonitorStep = recommendation.getMonitorStep({
    resourceIdentifier: resource._id!,
    onlineMonitorStatusId: placeholder,
    offlineMonitorStatusId: placeholder,
    defaultIncidentSeverityId: placeholder,
    defaultAlertSeverityId: placeholder,
    monitorName: resource.name!,
  });
  const monitor: Monitor = new Monitor();
  monitor._id = ObjectID.generate().toString();
  monitor.name = `${resource.name} - ${recommendation.name}`;
  monitor.monitorType = MonitorType.Metrics;
  monitor.monitorSteps = new MonitorSteps();
  monitor.monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: placeholder,
  };
  return monitor;
}

let resources: Array<CloudResource> = [];
let monitors: Array<Monitor> = [];
let dismissals: Array<RecommendationDismissal> = [];
let failResourcesRead: boolean = false;

// Everything a recommended monitor is built with, and what the panel offers.
function projectList(modelType: unknown): { data: Array<unknown> } {
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
    return { data: monitors };
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

  resources = accountRows();
  monitors = [];
  dismissals = [];
  failResourcesRead = false;

  goTo(
    `/dashboard/${PROJECT_ID}/cloud/accounts/30000000-0000-4000-8000-000000000001/recommendations`,
  );

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));

  getListMock.mockImplementation((args: unknown) => {
    const modelType: unknown = (args as { modelType: unknown }).modelType;

    if (modelType === CloudResource) {
      if (failResourcesRead) {
        return Promise.reject(new Error("The resources could not be read."));
      }

      return Promise.resolve({ data: resources, count: resources.length });
    }

    return Promise.resolve(projectList(modelType));
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
      <CloudAccountMonitorRecommendations
        provider="aws"
        cloudAccountId={AWS_ACCOUNT}
      />
    </MemoryRouter>,
  );

  await screen.findByTestId("cloud-account-recommendations");
}

function group(key: string): HTMLElement {
  return screen.getByTestId(`cloud-account-recommendation-group-${key}`);
}

function rowOf(templateId: string): HTMLElement {
  return screen.getByTestId(
    `cloud-account-recommendation-row-CloudResource:${templateId}`,
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

describe("what the account is offered", () => {
  test("its resources' recommendations, a group per type and a row per recommendation", async () => {
    await renderPage();

    const ec2: HTMLElement = group("aws|aws::ec2::instance");
    expect(within(ec2).getByText("EC2 Instance")).toBeInTheDocument();
    expect(
      within(ec2).getByText("2 resources in this account"),
    ).toBeInTheDocument();

    // The most important first: a broken state before a level.
    const rows: Array<string> = within(ec2)
      .getAllByTestId(/^cloud-account-recommendation-row-/)
      .map((element: HTMLElement): string => {
        return element.getAttribute("data-testid") || "";
      });
    expect(rows).toEqual([
      "cloud-account-recommendation-row-CloudResource:cloud-aws-ec2-status-check-failed",
      "cloud-account-recommendation-row-CloudResource:cloud-aws-ec2-high-cpu",
    ]);

    expect(
      within(rowOf("cloud-aws-ec2-status-check-failed")).getByText(
        "Set up on 0 of 2 resources",
      ),
    ).toBeInTheDocument();

    // Every group's type, by the name the product gives it, by that name.
    expect(screen.getByText("Lambda Function")).toBeInTheDocument();
    expect(screen.getByText("RDS DB Instance")).toBeInTheDocument();
    expect(screen.getByText("SQS Queue")).toBeInTheDocument();
  });

  test("the account's own resources only: read by its cloud and id, never an App Platforms environment", async () => {
    await renderPage();

    const read: Record<string, unknown> = listCallsOf(CloudResource)[0]!;
    const query: Record<string, unknown> = read["query"] as Record<
      string,
      unknown
    >;

    expect(query["cloudProvider"]).toBe("aws");
    expect(query["cloudResourceKind"]).toBe("resource");
    expect(query["isArchived"]).toBe(false);
    expect(
      (read["select"] as Record<string, boolean>)["cloudConnectionId"],
    ).toBe(true);
  });

  test("a type with more than one row to set up has its Add all; one with a single row does not", async () => {
    await renderPage();

    expect(
      screen.getByTestId(
        "cloud-account-recommendation-add-all-aws|aws::ec2::instance",
      ),
    ).toHaveTextContent("Add All 4 Monitors");
    expect(
      screen.queryByTestId(
        "cloud-account-recommendation-add-all-aws|aws::sqs::queue",
      ),
    ).toBeNull();
  });

  test("the resources it leaves out are named, by why, each a click from its own tab", async () => {
    await renderPage();

    const section: HTMLElement = screen.getByTestId(
      "cloud-account-recommendations-not-listed",
    );
    const waiting: HTMLElement = within(section).getByTestId(
      "cloud-account-recommendations-not-listed-NoMetrics",
    );
    const none: HTMLElement = within(section).getByTestId(
      "cloud-account-recommendations-not-listed-Unsupported",
    );

    expect(waiting).toHaveTextContent("Waiting for their first metrics");
    expect(within(waiting).getByText("web-3")).toBeInTheDocument();
    expect(within(none).getByText("edge-nlb")).toBeInTheDocument();
    expect(within(none).getByText("prod-vpc")).toBeInTheDocument();
    expect(within(none).getByText("VPC")).toBeInTheDocument();

    expect(
      within(waiting).getByText("web-3").closest("a")?.getAttribute("href"),
    ).toBe(`/dashboard/${PROJECT_ID}/cloud/${IDS["web3"]}/recommendations`);
    // Nobody is offered the same resource twice.
    expect(within(section).queryByText("web-1")).toBeNull();
  });

  test("a read that fails says so", async () => {
    failResourcesRead = true;

    render(
      <MemoryRouter>
        <CloudAccountMonitorRecommendations
          provider="aws"
          cloudAccountId={AWS_ACCOUNT}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("The resources could not be read."),
    ).toBeInTheDocument();
  });
});

describe("adding monitors", () => {
  test("Add to N Resources makes one monitor per resource, each linked to it, every five minutes", async () => {
    await renderPage();

    fireEvent.click(
      screen.getByTestId(
        "cloud-account-recommendation-add-CloudResource:cloud-aws-ec2-status-check-failed",
      ),
    );

    // The panel lists each monitor by its resource's name.
    expect(
      await screen.findByText("web-1 - Status Checks Failing"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("web-2 - Status Checks Failing"),
    ).toBeInTheDocument();

    await createFromPanel();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(2);
    });

    const made: Array<Monitor> = createdMonitors();
    expect(
      made.map((monitor: Monitor) => {
        return monitor.name;
      }),
    ).toEqual([
      "web-1 - Status Checks Failing",
      "web-2 - Status Checks Failing",
    ]);

    for (const [index, monitor] of made.entries()) {
      expect(monitor.monitorType).toBe(MonitorType.Metrics);
      expect(monitor.monitoringInterval).toBe(CLOUD_ALERT_MONITORING_INTERVAL);
      expect(
        (monitor.cloudResources || []).map((resource: CloudResource) => {
          return resource.id?.toString();
        }),
      ).toEqual([index === 0 ? IDS["web1"] : IDS["web2"]]);
    }

    // The run says what it made.
    expect(
      await screen.findByTestId("bulk-action-succeeded-count"),
    ).toHaveTextContent("2");
  });

  test("the monitors are made one at a time: each create waits for the one before", async () => {
    const answers: Array<() => void> = [];
    createOrUpdateMock.mockImplementation((args: unknown) => {
      monitors.push(saved((args as { model: Monitor }).model));
      return new Promise((resolve: (value: unknown) => void) => {
        answers.push(() => {
          resolve({});
        });
      });
    });

    await renderPage();

    fireEvent.click(
      screen.getByTestId(
        "cloud-account-recommendation-add-CloudResource:cloud-aws-ec2-high-cpu",
      ),
    );
    await createFromPanel();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    // The second waits for the first.
    await act(async () => {
      await Promise.resolve();
    });
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      answers[0]!();
    });

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      answers[1]!();
    });
  });

  test("Add all sets up every recommendation of the type still to set up", async () => {
    await renderPage();

    fireEvent.click(
      screen.getByTestId(
        "cloud-account-recommendation-add-all-aws|aws::ec2::instance",
      ),
    );
    await createFromPanel();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(4);
    });

    expect(
      createdMonitors()
        .map((monitor: Monitor) => {
          return monitor.name;
        })
        .sort(),
    ).toEqual(
      [
        "web-1 - High CPU",
        "web-1 - Status Checks Failing",
        "web-2 - High CPU",
        "web-2 - Status Checks Failing",
      ].sort(),
    );
  });

  test("a resource's own Add, in the row's list, makes just that one", async () => {
    await renderPage();

    fireEvent.click(
      screen.getByTestId(
        "cloud-account-recommendation-toggle-CloudResource:cloud-aws-ec2-high-cpu",
      ),
    );
    fireEvent.click(
      await screen.findByTestId(
        `cloud-account-recommendation-add-one-CloudResource:cloud-aws-ec2-high-cpu-${IDS["web2"]}`,
      ),
    );
    await createFromPanel();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(createdMonitors()[0]!.name).toBe("web-2 - High CPU");
  });

  test("what was made is read again and offered no more, and the menu's badge is told", async () => {
    const changed: MockFunction = getJestMockFunction();
    window.addEventListener(RECOMMENDATIONS_CHANGED_EVENT, changed);

    await renderPage();
    const monitorReadsBefore: number = listCallsOf(Monitor).length;

    fireEvent.click(
      screen.getByTestId(
        "cloud-account-recommendation-add-CloudResource:cloud-aws-sqs-oldest-message",
      ),
    );
    await createFromPanel();

    await waitFor(() => {
      expect(listCallsOf(Monitor).length).toBe(monitorReadsBefore + 1);
    });
    await waitFor(() => {
      expect(changed).toHaveBeenCalledTimes(1);
    });

    // Nothing left of the queue's: its row leaves the list of what to set up.
    await waitFor(() => {
      expect(
        screen.queryByTestId(
          "cloud-account-recommendation-row-CloudResource:cloud-aws-sqs-oldest-message",
        ),
      ).toBeNull();
    });

    window.removeEventListener(RECOMMENDATIONS_CHANGED_EVENT, changed);
  });

  test("a create the server refuses is listed with why; the others are still made", async () => {
    createOrUpdateMock.mockImplementation((args: unknown) => {
      const model: Monitor = (args as { model: Monitor }).model;

      if (model.name === "web-1 - High CPU") {
        return Promise.reject(
          new Error("You have reached the plan's limit of active monitors."),
        );
      }

      monitors.push(saved(model));
      return Promise.resolve({});
    });

    await renderPage();

    fireEvent.click(
      screen.getByTestId(
        "cloud-account-recommendation-add-CloudResource:cloud-aws-ec2-high-cpu",
      ),
    );
    await createFromPanel();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(2);
    });

    expect(
      await screen.findByTestId("bulk-action-failed-count"),
    ).toHaveTextContent("1");
    expect(
      await screen.findByText(/reached the plan's limit of active monitors/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("bulk-action-succeeded-count")).toHaveTextContent(
      "1",
    );
  });
});

describe("what is set up or dismissed already", () => {
  test("is counted as such, and not offered again", async () => {
    monitors = [
      monitorFor(resources[0]!, "cloud-aws-ec2-status-check-failed"),
      monitorFor(resources[0]!, "cloud-aws-ec2-high-cpu"),
    ];
    const dismissal: RecommendationDismissal = new RecommendationDismissal();
    (dismissal as unknown as Record<string, unknown>)["recommendationId"] =
      "CloudResource:cloud-aws-rds-low-storage";
    (dismissal as unknown as Record<string, unknown>)["resourceId"] =
      new ObjectID(IDS["ordersDb"]!);
    (dismissal as unknown as Record<string, unknown>)["recommendationType"] =
      "Monitor";
    (dismissal as unknown as Record<string, unknown>)["resourceType"] =
      MonitorRecommendationResourceType.CloudResource;
    dismissals = [dismissal];

    await renderPage();

    expect(
      within(rowOf("cloud-aws-ec2-status-check-failed")).getByText(
        "Set up on 1 of 2 resources",
      ),
    ).toBeInTheDocument();
    // web-2 alone is left: one resource to add it to.
    expect(
      screen.getByTestId(
        "cloud-account-recommendation-add-CloudResource:cloud-aws-ec2-status-check-failed",
      ),
    ).toHaveTextContent("Add to 1 Resource");

    // Dismissed on its resource's tab: not offered here, as to set up.
    expect(
      screen.queryByTestId(
        "cloud-account-recommendation-row-CloudResource:cloud-aws-rds-low-storage",
      ),
    ).toBeNull();

    fireEvent.click(
      screen.getByTestId(
        "cloud-account-recommendation-add-CloudResource:cloud-aws-ec2-status-check-failed",
      ),
    );
    await createFromPanel();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(createdMonitors()[0]!.name).toBe("web-2 - Status Checks Failing");
  });

  test("every recommendation made or dismissed: nothing left to set up", async () => {
    monitors = resources.flatMap((resource: CloudResource): Array<Monitor> => {
      return MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.CloudResource,
        readCloudResourceRecommendationContext(
          resource as unknown as Record<string, unknown>,
        ),
      ).map((recommendation: MonitorRecommendation): Monitor => {
        return monitorFor(resource, recommendation.templateId);
      });
    });

    await renderPage();

    expect(screen.getByText("Nothing left to set up here")).toBeInTheDocument();
  });

  test("an account with no resources yet says what brings them", async () => {
    resources = [];

    await renderPage();

    expect(
      screen.getByText("No resources in this account yet"),
    ).toBeInTheDocument();
  });
});

describe("a member who may not create monitors", () => {
  test("sees what is recommended, reads why once, and every Add is locked", async () => {
    holding([Permission.Viewer]);

    await renderPage();

    const locked: HTMLElement = screen.getByTestId(
      "cloud-account-recommendations-locked",
    );
    expect(locked.textContent).toMatch(/permission/i);

    const adds: Array<HTMLElement> = screen
      .getAllByRole("button")
      .filter((button: HTMLElement): boolean => {
        return (button.getAttribute("data-testid") || "").startsWith(
          "cloud-account-recommendation-add",
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
  });

  test("an owner reads no such line", async () => {
    await renderPage();

    expect(
      screen.queryByTestId("cloud-account-recommendations-locked"),
    ).toBeNull();
  });
});

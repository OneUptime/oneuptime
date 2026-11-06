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
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * A cloud resource's Recommendations tab (Pages/Cloud/View/Recommendations,
 * the shared RecommendationsPage shell) and the account's Recommendations
 * badge in its side menu, rendered for real over a stubbed data layer.
 *
 * The tab offers the monitors of the resource's cloud and type, says where
 * their numbers come from, says why fewer are offered when they are, and
 * makes each monitor every five minutes, linked to the resource. A member
 * who may not create monitors is told why. The account's badge counts what
 * is still to set up across its resources, says nothing when nothing is,
 * and counts again when a page beside it sets some up.
 */

const RESOURCE_ID: string = "40000000-0000-4000-8000-000000000001";
const ACCOUNT_ID: string = "30000000-0000-4000-8000-000000000001";

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

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

// Billing off, whatever the environment says (see CloudAccountRecommendations).
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

// Only the badge number matters here, not how the menu entry draws it.
jest.mock("../../../UI/Components/SideMenu/SideMenuItem", () => {
  return {
    __esModule: true,
    default: (props: { badge?: number | undefined }) => {
      return (
        <span data-testid="recommendations-badge">
          {props.badge === undefined ? "no badge" : String(props.badge)}
        </span>
      );
    },
  };
});

import CloudResourceRecommendations from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/Recommendations";
import CloudAccountRecommendationsMenuItem from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/CloudAccountRecommendationsMenuItem";
import { notifyRecommendationsChanged } from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationsChanged";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import Route from "../../../Types/API/Route";
import { CLOUD_ALERT_MONITORING_INTERVAL } from "../../../Types/Monitor/CloudAlertTemplates";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(
    `/dashboard/${PROJECT_ID}/cloud/${RESOURCE_ID}/recommendations`,
  ),
  currentProject: null,
  hasPaymentMethod: true,
};

const EC2_ATTRIBUTES: Record<string, string> = {
  Namespace: "AWS/EC2",
  "Dimensions.InstanceId": "i-0abc",
  "resource.cloud.account.id": "123456789012",
  "resource.cloud.region": "us-east-1",
};

function cloudRow(fields: Record<string, unknown>): CloudResource {
  const row: CloudResource = new CloudResource();
  const record: Record<string, unknown> = row as unknown as Record<
    string,
    unknown
  >;
  record["_id"] = RESOURCE_ID;
  record["projectId"] = new ObjectID(PROJECT_ID);
  record["cloudProvider"] = "aws";
  record["cloudReadings"] = {};
  record["cloudProperties"] = {};
  record["cloudConnectionId"] = "20000000-0000-4000-8000-000000000001";

  for (const [key, value] of Object.entries(fields)) {
    record[key] = value;
  }

  return row;
}

let resourceRow: CloudResource = cloudRow({});
let accountRows: Array<CloudResource> = [];
let monitors: Array<Monitor> = [];

function projectList(modelType: unknown): { data: Array<unknown> } {
  if (modelType === MonitorStatus) {
    const online: MonitorStatus = new MonitorStatus();
    online._id = ObjectID.generate().toString();
    online.isOperationalState = true;
    const offline: MonitorStatus = new MonitorStatus();
    offline._id = ObjectID.generate().toString();
    offline.isOfflineState = true;
    return { data: [online, offline] };
  }

  if (modelType === IncidentSeverity || modelType === AlertSeverity) {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity._id = ObjectID.generate().toString();
    severity.name = "Critical";
    return { data: [severity] };
  }

  if (modelType === Monitor) {
    return { data: monitors };
  }

  if (modelType === CloudResource) {
    return { data: accountRows };
  }

  return { data: [] };
}

function holding(permissions: Array<Permission>): void {
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
}

async function flushEffects(): Promise<void> {
  for (let i: number = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  getItemMock.mockReset();
  getListMock.mockReset();
  createOrUpdateMock.mockReset();
  monitors = [];
  accountRows = [];
  resourceRow = cloudRow({
    name: "web-1",
    cloudResourceType: "AWS::EC2::Instance",
    telemetryAttributes: EC2_ATTRIBUTES,
  });

  goTo(`/dashboard/${PROJECT_ID}/cloud/${RESOURCE_ID}/recommendations`);

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));

  getItemMock.mockImplementation((args: unknown) => {
    const modelType: unknown = (args as { modelType: unknown }).modelType;

    if (modelType === CloudAccount) {
      const account: CloudAccount = new CloudAccount();
      account._id = ACCOUNT_ID;
      account.provider = "aws" as never;
      account.accountId = "123456789012";
      return Promise.resolve(account);
    }

    return Promise.resolve(resourceRow);
  });

  getListMock.mockImplementation((args: unknown) => {
    return Promise.resolve(
      projectList((args as { modelType: unknown }).modelType),
    );
  });

  createOrUpdateMock.mockImplementation((args: unknown) => {
    const model: Monitor = (args as { model: Monitor }).model;
    model._id = ObjectID.generate().toString();
    monitors.push(model);
    return Promise.resolve({});
  });

  holding([Permission.ProjectOwner]);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function renderTab(): void {
  render(
    <MemoryRouter>
      <CloudResourceRecommendations {...PAGE_PROPS} />
    </MemoryRouter>,
  );
}

describe("a cloud resource's Recommendations tab", () => {
  test("offers its type's monitors, and says its numbers come from its cloud's monitoring", async () => {
    renderTab();

    expect(
      await screen.findByText("Status Checks Failing"),
    ).toBeInTheDocument();
    expect(screen.getByText("High CPU")).toBeInTheDocument();
    expect(
      screen.getByText(/from the metrics Amazon CloudWatch reports about it/),
    ).toBeInTheDocument();
  });

  test("reads the columns its recommendations depend on, with the row", async () => {
    renderTab();
    await screen.findByText("Status Checks Failing");

    const read: Record<string, unknown> = getItemMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(read["modelType"]).toBe(CloudResource);
    expect(read["select"]).toEqual({
      _id: true,
      name: true,
      cloudProvider: true,
      cloudResourceType: true,
      telemetryAttributes: true,
      cloudReadings: true,
      cloudProperties: true,
      cloudConnectionId: true,
    });
  });

  test("each monitor it creates is linked to the resource, and read every five minutes", async () => {
    renderTab();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Select Status Checks Failing",
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Create 1 Selected Monitor" }),
    );

    const panelCreate: HTMLElement = await screen.findByRole("button", {
      name: "Create Monitors",
    });
    await act(async () => {
      fireEvent.click(panelCreate);
    });

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const made: Monitor = (
      createOrUpdateMock.mock.calls[0]![0] as { model: Monitor }
    ).model;

    expect(made.name).toBe("web-1 - Status Checks Failing");
    expect(made.monitoringInterval).toBe(CLOUD_ALERT_MONITORING_INTERVAL);
    expect(
      (made.cloudResources || []).map((resource: CloudResource) => {
        return resource.id?.toString();
      }),
    ).toEqual([RESOURCE_ID]);
  });

  test("a type with none says so, and points at the Metrics tab", async () => {
    resourceRow = cloudRow({
      name: "prod-vpc",
      cloudResourceType: "AWS::EC2::VPC",
      telemetryAttributes: {},
    });

    renderTab();

    expect(
      await screen.findByText(/OneUptime has no recommended monitors for VPC/),
    ).toBeInTheDocument();

    /*
     * The note and the empty list say it: no four zero tiles, search box
     * or severity filter above them, and no Create that could never be
     * pressed.
     */
    expect(
      screen.getByText("No recommendations for this cloud resource yet"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("recommendation-coverage")).toBeNull();
    expect(screen.queryByTestId("recommendation-stat-All")).toBeNull();
    expect(
      screen.queryByPlaceholderText("Search recommendations..."),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Create Monitors" }),
    ).toBeNull();
  });

  /*
   * The catalog's words are English on every page: the card reads each in
   * an isolate of its own, so a Persian page keeps a sentence's full stop
   * at its end.
   */
  test("a recommendation's name and sentence read as written on a right-to-left page", async () => {
    renderTab();

    for (const text of [
      "Status Checks Failing",
      "The instance or the host it runs on fails a status check.",
    ]) {
      const isolate: HTMLElement = await screen.findByText(text);
      expect(isolate.tagName).toBe("BDI");
      expect(isolate).toHaveAttribute("dir", "ltr");
    }
  });

  test("an RDS instance whose storage the inventory has not listed says when Low Free Storage comes", async () => {
    resourceRow = cloudRow({
      name: "orders-db",
      cloudResourceType: "AWS::RDS::DBInstance",
      telemetryAttributes: {
        ...EC2_ATTRIBUTES,
        Namespace: "AWS/RDS",
      },
    });

    renderTab();

    expect(await screen.findByText("High CPU")).toBeInTheDocument();
    expect(screen.queryByText("Low Free Storage")).toBeNull();
    expect(
      screen.getByText(/Low Free Storage is offered once/),
    ).toBeInTheDocument();
  });

  test("a member who may not create monitors sees them, and every Create is locked", async () => {
    holding([Permission.Viewer]);

    renderTab();

    expect(
      await screen.findByText("Status Checks Failing"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Select Status Checks Failing" }),
    );

    const create: HTMLElement = await screen.findByRole("button", {
      name: "Create 1 Selected Monitor",
    });
    expect(create).toBeDisabled();
  });
});

describe("the account's Recommendations badge", () => {
  function accountRow(id: number, name: string): CloudResource {
    const row: CloudResource = cloudRow({
      name,
      cloudResourceType: "AWS::EC2::Instance",
      telemetryAttributes: {
        ...EC2_ATTRIBUTES,
        "Dimensions.InstanceId": `i-${id}`,
      },
    });
    (row as unknown as Record<string, unknown>)["_id"] =
      `40000000-0000-4000-8000-${String(id).padStart(12, "0")}`;
    return row;
  }

  function renderBadge(): void {
    render(
      <CloudAccountRecommendationsMenuItem
        link={{
          title: "Recommendations",
          to: new Route(
            `/dashboard/${PROJECT_ID}/cloud/accounts/${ACCOUNT_ID}/recommendations`,
          ),
        }}
        accountId={new ObjectID(ACCOUNT_ID)}
      />,
    );
  }

  test("counts the monitors still to set up across the account's resources", async () => {
    accountRows = [accountRow(11, "web-1"), accountRow(12, "web-2")];

    renderBadge();

    // Status Checks Failing and High CPU on each of two instances.
    await waitFor(() => {
      expect(screen.getByTestId("recommendations-badge")).toHaveTextContent(
        "4",
      );
    });
  });

  test("nothing to set up is no badge at all", async () => {
    renderBadge();
    await flushEffects();

    expect(screen.getByTestId("recommendations-badge")).toHaveTextContent(
      "no badge",
    );
  });

  test("counts again when the page beside it sets some up", async () => {
    accountRows = [accountRow(11, "web-1")];

    renderBadge();

    await waitFor(() => {
      expect(screen.getByTestId("recommendations-badge")).toHaveTextContent(
        "2",
      );
    });

    // The page made one: the next count reads one left.
    accountRows = [accountRow(11, "web-1"), accountRow(12, "web-2")];

    await act(async () => {
      notifyRecommendationsChanged();
    });

    await waitFor(() => {
      expect(screen.getByTestId("recommendations-badge")).toHaveTextContent(
        "4",
      );
    });
  });

  test("a read that fails leaves the entry, with no badge", async () => {
    getListMock.mockImplementation(() => {
      return Promise.reject(new Error("Network Error"));
    });

    renderBadge();
    await flushEffects();

    expect(screen.getByTestId("recommendations-badge")).toHaveTextContent(
      "no badge",
    );
  });
});

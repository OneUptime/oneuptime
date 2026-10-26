import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * A resource's Recommendations list their templates under the same headings
 * as Create Monitor's Quick Setup, and in the same order.
 *
 * Both show the same alert templates of a type (a Kubernetes cluster's
 * seventeen, a Ceph cluster's twenty-three), and both group them under the
 * headings AlertTemplateCategories names. The page used to take the order in
 * which the catalog first met each category instead: on Kubernetes,
 * Scheduling came second on the page (Pod Stuck in Pending is the catalog's
 * second template) and last in Quick Setup. Each page is rendered here for
 * real; its order is read off the headings' Select all buttons and held to
 * the picker's own grouping of the same templates.
 *
 * A Kubernetes cluster's Recommendations end with one heading Quick Setup
 * does not have: Events, the cluster's Warning Events alert - a Logs
 * monitor, which a Kubernetes monitor's Quick Setup cannot build (follow-up
 * of #5201).
 */

const RESOURCE_ID: string = "6c1b2a3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

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
    },
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

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import { getAllCephAlertTemplates } from "../../../Types/Monitor/CephAlertTemplates";
import { getAllDockerSwarmAlertTemplates } from "../../../Types/Monitor/DockerSwarmAlertTemplates";
import { getAllIoTAlertTemplates } from "../../../Types/Monitor/IotAlertTemplates";
import { getAllKubernetesAlertTemplates } from "../../../Types/Monitor/KubernetesAlertTemplates";
import { getAllKubernetesEventAlertTemplates } from "../../../Types/Monitor/KubernetesEventAlertTemplates";
import { getAllProxmoxAlertTemplates } from "../../../Types/Monitor/ProxmoxAlertTemplates";
import { getAllVMwareAlertTemplates } from "../../../Types/Monitor/VMwareAlertTemplates";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  AlertTemplateCategory,
  AlertTemplateGroup,
  AlertTemplatePickerTemplate,
  groupAlertTemplates,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/AlertTemplatePicker/AlertTemplateGroups";
import {
  CEPH_TEMPLATE_CATEGORIES,
  DOCKER_SWARM_TEMPLATE_CATEGORIES,
  IOT_TEMPLATE_CATEGORIES,
  KUBERNETES_TEMPLATE_CATEGORIES,
  PROXMOX_TEMPLATE_CATEGORIES,
  VMWARE_TEMPLATE_CATEGORIES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/AlertTemplatePicker/AlertTemplateCategories";
import KubernetesRecommendations from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Recommendations";
import CephRecommendations from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Recommendations";
import ProxmoxRecommendations from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Recommendations";
import VMwareRecommendations from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/Recommendations";
import DockerSwarmRecommendations from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Recommendations";
import IoTRecommendations from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/View/Recommendations";

type PageComponent = (props: PageComponentProps) => React.ReactElement | null;

interface OrderCase {
  name: string;
  page: PageComponent;
  modelType: { new (): BaseModel };
  // The path under the project the page is opened at.
  path: string;
  templates: Array<AlertTemplatePickerTemplate>;
  categories: Array<AlertTemplateCategory>;
  // Headings the page draws after Quick Setup's, in this order.
  afterQuickSetup?: Array<string>;
}

const CASES: Array<OrderCase> = [
  {
    name: "Kubernetes",
    page: KubernetesRecommendations as unknown as PageComponent,
    modelType: KubernetesCluster,
    path: "kubernetes",
    templates: getAllKubernetesAlertTemplates(),
    categories: KUBERNETES_TEMPLATE_CATEGORIES,
    afterQuickSetup: getAllKubernetesEventAlertTemplates().map(
      (template: { category: string }): string => {
        return template.category;
      },
    ),
  },
  {
    name: "Ceph",
    page: CephRecommendations as unknown as PageComponent,
    modelType: CephCluster,
    path: "ceph",
    templates: getAllCephAlertTemplates(),
    categories: CEPH_TEMPLATE_CATEGORIES,
  },
  {
    name: "Proxmox",
    page: ProxmoxRecommendations as unknown as PageComponent,
    modelType: ProxmoxCluster,
    path: "proxmox",
    templates: getAllProxmoxAlertTemplates(),
    categories: PROXMOX_TEMPLATE_CATEGORIES,
  },
  {
    name: "VMware",
    page: VMwareRecommendations as unknown as PageComponent,
    modelType: VMwareVCenter,
    path: "vmware",
    templates: getAllVMwareAlertTemplates(),
    categories: VMWARE_TEMPLATE_CATEGORIES,
  },
  {
    name: "Docker Swarm",
    page: DockerSwarmRecommendations as unknown as PageComponent,
    modelType: DockerSwarmCluster,
    path: "docker-swarm",
    templates: getAllDockerSwarmAlertTemplates(),
    categories: DOCKER_SWARM_TEMPLATE_CATEGORIES,
  },
  {
    name: "IoT",
    page: IoTRecommendations as unknown as PageComponent,
    modelType: IoTFleet,
    path: "iot",
    templates: getAllIoTAlertTemplates(),
    categories: IOT_TEMPLATE_CATEGORIES,
  },
];

const SELECT_ALL_PREFIX: string = "recommendation-group-select-all-";

// Everything MonitorRecommendations needs to build a monitor step.
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

  // No monitors yet, no dismissals, no policies / teams / labels.
  return { data: [] };
}

function resourceOf(modelType: { new (): BaseModel }): BaseModel {
  const row: BaseModel = new modelType();
  const values: Record<string, unknown> = row as unknown as Record<
    string,
    unknown
  >;
  row._id = RESOURCE_ID;
  for (const column of ["name", "clusterIdentifier"]) {
    if (row.hasColumn(column)) {
      values[column] = "production";
    }
  }
  return row;
}

// The page's headings, in the order it draws them.
function drawnCategoryOrder(): Array<string> {
  return Array.from(
    document.querySelectorAll(`[data-testid^="${SELECT_ALL_PREFIX}"]`),
  ).map((element: Element): string => {
    return (element.getAttribute("data-testid") || "").slice(
      SELECT_ALL_PREFIX.length,
    );
  });
}

beforeEach(() => {
  getItemMock.mockReset();
  getListMock.mockReset();
  getListMock.mockImplementation((args: unknown) => {
    return Promise.resolve(
      projectList((args as { modelType: unknown }).modelType),
    );
  });
});

afterEach(() => {
  cleanup();
});

describe.each(CASES)("$name Recommendations", (orderCase: OrderCase) => {
  test("list their headings in Quick Setup's order", async () => {
    goTo(
      `/dashboard/${PROJECT_ID}/${orderCase.path}/${RESOURCE_ID}/recommendations`,
    );
    getItemMock.mockResolvedValue(resourceOf(orderCase.modelType));

    const Page: PageComponent = orderCase.page;

    render(
      <MemoryRouter>
        <Page
          pageRoute={
            new Route(
              `/dashboard/${PROJECT_ID}/${orderCase.path}/${RESOURCE_ID}/recommendations`,
            )
          }
          currentProject={null}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Recommended Monitors")).toBeInTheDocument();
    await screen.findByTestId(
      `${SELECT_ALL_PREFIX}${orderCase.categories[0]!.category}`,
    );

    const quickSetupOrder: Array<string> = groupAlertTemplates(
      orderCase.templates,
      orderCase.categories,
    ).map((group: AlertTemplateGroup<AlertTemplatePickerTemplate>): string => {
      return group.category || "";
    });

    expect(quickSetupOrder.length).toBeGreaterThan(1);
    expect(drawnCategoryOrder()).toEqual([
      ...quickSetupOrder,
      ...(orderCase.afterQuickSetup || []),
    ]);
  });
});

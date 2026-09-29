import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Kubernetes resource pages, rendered for real with their data fetches
 * stubbed: every list table (Nodes, Pods, Deployments, ...) and every
 * resource's detail Overview. Each asserts that the (i) beside a column
 * header or summary field opens the text written for THAT page - "CPU" on
 * the Nodes list must explain a node's own usage, on the Deployments list a
 * sum over pods - and that identity columns and fields (name, namespace,
 * status, age) carry none.
 *
 * App/Tests/Dashboard/KubernetesResourceTooltipsWiring.test.ts pins the
 * same wiring in the source; this proves it reaches the DOM.
 */

const mockGetItem: MockFunction = getJestMockFunction();
const mockGetList: MockFunction = getJestMockFunction();
const mockFetchInventory: MockFunction = getJestMockFunction();
const mockFetchLatestObject: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factories run.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return mockGetItem(...args);
      },
      getList: (...args: Array<any>) => {
        return mockGetList(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown) => {
        return (
          ((error as { message?: unknown } | null)?.message as string) ||
          "Could not load"
        );
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("84858d6c-1111-4aaa-8bbb-000000000001");
      },
      getLastParamAsString: () => {
        return "web";
      },
      navigate: () => {},
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesResourceUtils",
  () => {
    return {
      __esModule: true,
      default: {
        fetchInventoryResources: (...args: Array<any>) => {
          return mockFetchInventory(...args);
        },
        fetchPodMetricsByOwner: () => {
          return Promise.resolve(new Map());
        },
        fetchPodMetricsByNamespace: () => {
          return Promise.resolve(new Map());
        },
        fetchNodeAllocatableMemory: () => {
          return Promise.resolve(new Map());
        },
        applyAggregateMetrics: () => {},
        parseK8sMemoryToBytes: () => {
          return 0;
        },
        formatAge: () => {
          return "3d";
        },
        formatBytesForChart: (value: number) => {
          return `${value} B`;
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesObjectFetcher",
  () => {
    return {
      __esModule: true,
      fetchLatestK8sObject: (...args: Array<any>) => {
        return mockFetchLatestObject(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/useNodeAllocatableCpu",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

/*
 * The other tabs are not what these tests are about; stubbing them keeps the
 * metric explorer, the events feed and the YAML viewer out of the render.
 * The Metrics tab stub still draws renderExtraCharts, which is where the
 * node's Network Throughput header lives.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesMetricsTab",
  () => {
    return {
      __esModule: true,
      default: (props: {
        renderExtraCharts?:
          | ((range: { startValue: Date; endValue: Date }) => React.ReactNode)
          | undefined;
      }) => {
        return (
          <div data-testid="metrics-tab">
            {props.renderExtraCharts
              ? props.renderExtraCharts({
                  startValue: new Date("2026-09-24T10:00:00Z"),
                  endValue: new Date("2026-09-24T11:00:00Z"),
                })
              : null}
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/KubernetesNetworkThroughputChart",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="network-throughput-chart" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesEventsTab",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="stub-KubernetesEventsTab" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesYamlTab",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="stub-KubernetesYamlTab" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesLogsTab",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="stub-KubernetesLogsTab" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesEnvVarsTab",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="stub-KubernetesEnvVarsTab" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesVolumeMountsTab",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="stub-KubernetesVolumeMountsTab" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesImageReferenceView",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="stub-KubernetesImageReferenceView" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesResourceLink",
  () => {
    return {
      __esModule: true,
      default: (props: { resourceName: string }) => {
        return <span>{props.resourceName}</span>;
      },
    };
  },
);

import NodesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Nodes";
import PodsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Pods";
import ContainersPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Containers";
import DeploymentsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Deployments";
import StatefulSetsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/StatefulSets";
import DaemonSetsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/DaemonSets";
import JobsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Jobs";
import CronJobsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/CronJobs";
import NamespacesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Namespaces";
import HPAsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/HPAs";
import VPAsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/VPAs";
import PersistentVolumeClaimsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/PersistentVolumeClaims";
import PersistentVolumesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/PersistentVolumes";
import NodeDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/NodeDetail";
import PodDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/PodDetail";
import DeploymentDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/DeploymentDetail";
import StatefulSetDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/StatefulSetDetail";
import DaemonSetDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/DaemonSetDetail";
import JobDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/JobDetail";
import CronJobDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/CronJobDetail";
import PVCDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/PVCDetail";
import PVDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/PVDetail";
import HPADetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/HPADetail";
import VPADetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/VPADetail";
import NamespaceDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/NamespaceDetail";
import ContainerDetailPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/ContainerDetail";
import { KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/KubernetesResourceMetricDescriptions";

const PAGES: Record<string, React.FunctionComponent<any>> = {
  Nodes: NodesPage,
  Pods: PodsPage,
  Containers: ContainersPage,
  Deployments: DeploymentsPage,
  StatefulSets: StatefulSetsPage,
  DaemonSets: DaemonSetsPage,
  Jobs: JobsPage,
  CronJobs: CronJobsPage,
  Namespaces: NamespacesPage,
  HPAs: HPAsPage,
  VPAs: VPAsPage,
  PersistentVolumeClaims: PersistentVolumeClaimsPage,
  PersistentVolumes: PersistentVolumesPage,
  NodeDetail: NodeDetailPage,
  PodDetail: PodDetailPage,
  DeploymentDetail: DeploymentDetailPage,
  StatefulSetDetail: StatefulSetDetailPage,
  DaemonSetDetail: DaemonSetDetailPage,
  JobDetail: JobDetailPage,
  CronJobDetail: CronJobDetailPage,
  PVCDetail: PVCDetailPage,
  PVDetail: PVDetailPage,
  HPADetail: HPADetailPage,
  VPADetail: VPADetailPage,
  NamespaceDetail: NamespaceDetailPage,
  ContainerDetail: ContainerDetailPage,
};

const D: Record<string, string> = KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS;

const PAGE_PROPS: Record<string, unknown> = {
  pageRoute: undefined,
  currentProject: null,
  hasPaymentMethod: false,
};

function inventoryRow(): Record<string, unknown> {
  return {
    name: "web",
    namespace: "default",
    cpuUtilization: 12.5,
    memoryUsageBytes: 64 * 1024 * 1024,
    memoryLimitBytes: 256 * 1024 * 1024,
    status: "Running",
    age: "3d",
    additionalAttributes: {
      containers: "2",
      ready: "2/3",
      "resource.k8s.node.name": "node-a",
      target: "Deployment/web",
      minReplicas: "1",
      maxReplicas: "5",
      currentReplicas: "2",
      desiredReplicas: "3",
      updateMode: "Auto",
      capacity: "10Gi",
      storageClass: "standard",
      volumeName: "pv-1",
      accessModes: "ReadWriteOnce",
      reclaimPolicy: "Delete",
      claimRef: "default/data",
      schedule: "*/5 * * * *",
    },
  };
}

function metadata(): Record<string, unknown> {
  return {
    name: "web",
    namespace: "default",
    uid: "uid-1",
    creationTimestamp: "2026-09-20T10:00:00Z",
    labels: {},
    annotations: {},
    ownerReferences: [],
  };
}

const OBJECTS: Record<string, Record<string, unknown>> = {
  nodes: {
    metadata: metadata(),
    status: {
      conditions: [
        {
          type: "Ready",
          status: "True",
          reason: "",
          message: "",
          lastTransitionTime: "",
        },
      ],
      addresses: [{ type: "InternalIP", address: "10.0.0.4" }],
      capacity: { cpu: "4", memory: "16336412Ki", pods: "110" },
      allocatable: { cpu: "3920m", memory: "15672348Ki" },
      nodeInfo: {
        osImage: "Ubuntu",
        containerRuntimeVersion: "containerd://1.7",
        kubeletVersion: "v1.30.0",
        operatingSystem: "linux",
        architecture: "amd64",
        kernelVersion: "6.8.0",
      },
    },
  },
  pods: {
    metadata: metadata(),
    spec: {
      containers: [
        {
          name: "app",
          image: "nginx:1.27",
          command: [],
          args: [],
          env: [],
          ports: [],
          resources: {
            requests: { cpu: "250m", memory: "256Mi" },
            limits: { memory: "512Mi" },
          },
          volumeMounts: [],
        },
      ],
      initContainers: [],
      serviceAccountName: "default",
      nodeName: "node-a",
      nodeSelector: {},
      tolerations: [],
      volumes: [],
    },
    status: {
      phase: "Running",
      podIP: "10.1.0.5",
      hostIP: "10.0.0.4",
      qosClass: "Burstable",
      conditions: [],
      containerStatuses: [
        {
          name: "app",
          ready: true,
          restartCount: 2,
          state: "running",
          reason: "",
          image: "nginx:1.27",
        },
      ],
      initContainerStatuses: [],
    },
  },
  deployments: {
    metadata: metadata(),
    spec: { replicas: 3, strategy: "RollingUpdate", selector: {} },
    status: {
      replicas: 3,
      readyReplicas: 2,
      availableReplicas: 2,
      unavailableReplicas: 1,
      conditions: [],
    },
  },
  statefulsets: {
    metadata: metadata(),
    spec: {
      replicas: 3,
      serviceName: "web",
      podManagementPolicy: "OrderedReady",
      updateStrategy: "RollingUpdate",
    },
    status: { replicas: 3, readyReplicas: 3, currentReplicas: 3 },
  },
  daemonsets: {
    metadata: metadata(),
    spec: { updateStrategy: "RollingUpdate" },
    status: {
      desiredNumberScheduled: 3,
      currentNumberScheduled: 3,
      numberReady: 2,
      numberMisscheduled: 0,
      numberAvailable: 2,
    },
  },
  jobs: {
    metadata: metadata(),
    spec: { completions: 1, parallelism: 1, backoffLimit: 6 },
    status: {
      active: 1,
      succeeded: 0,
      failed: 1,
      startTime: "2026-09-24T10:00:00Z",
      completionTime: "",
      conditions: [],
    },
  },
  cronjobs: {
    metadata: metadata(),
    spec: {
      schedule: "*/5 * * * *",
      suspend: false,
      concurrencyPolicy: "Forbid",
      successfulJobsHistoryLimit: 3,
      failedJobsHistoryLimit: 1,
    },
    status: { lastScheduleTime: "2026-09-24T10:55:00Z", activeCount: 0 },
  },
  persistentvolumeclaims: {
    metadata: metadata(),
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: "standard",
      volumeName: "pv-1",
      resources: { requests: { storage: "10Gi" } },
    },
    status: { phase: "Bound", capacity: { storage: "10Gi" } },
  },
  persistentvolumes: {
    metadata: metadata(),
    spec: {
      capacity: { storage: "10Gi" },
      accessModes: ["ReadWriteOnce"],
      storageClassName: "standard",
      persistentVolumeReclaimPolicy: "Delete",
      claimRef: { name: "data", namespace: "default" },
    },
    status: { phase: "Bound" },
  },
  horizontalpodautoscalers: {
    metadata: metadata(),
    spec: {
      minReplicas: 1,
      maxReplicas: 5,
      scaleTargetRef: { kind: "Deployment", name: "web" },
      metrics: [
        {
          type: "Resource",
          resourceName: "cpu",
          targetType: "Utilization",
          targetValue: "70",
        },
      ],
    },
    status: { currentReplicas: 2, desiredReplicas: 3, conditions: [] },
  },
  verticalpodautoscalers: {
    metadata: metadata(),
    spec: {
      targetRef: { kind: "Deployment", name: "web" },
      updatePolicy: { updateMode: "Auto" },
      resourcePolicy: "",
    },
    status: {
      recommendation: {
        containerRecommendations: [
          {
            containerName: "app",
            target: { cpu: "250m", memory: "262144k" },
            lowerBound: {},
            upperBound: {},
          },
        ],
      },
    },
  },
};

async function settle(): Promise<void> {
  for (let i: number = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
      jest.advanceTimersByTime(10);
    });
  }
}

async function tooltipFor(label: string): Promise<string> {
  const button: HTMLElement = screen.getByRole("button", {
    name: `About ${label}`,
  });

  fireEvent.mouseEnter(button);
  await act(async () => {
    jest.advanceTimersByTime(200);
  });

  const tooltips: Array<HTMLElement> = screen.getAllByRole("tooltip");
  const text: string = tooltips[tooltips.length - 1]?.textContent || "";

  fireEvent.mouseLeave(button);
  await act(async () => {
    jest.advanceTimersByTime(500);
  });

  return text;
}

function infoLabels(): Array<string> {
  return screen
    .queryAllByRole("button", { name: /^About / })
    .map((button: HTMLElement): string => {
      return (button.getAttribute("aria-label") || "").replace("About ", "");
    })
    .sort();
}

beforeEach(() => {
  jest.useFakeTimers();
  mockGetItem.mockReset();
  mockGetList.mockReset();
  mockFetchInventory.mockReset();
  mockFetchLatestObject.mockReset();

  mockGetItem.mockImplementation(() => {
    return Promise.resolve({ clusterIdentifier: "prod-cluster", name: "Prod" });
  });
  mockFetchInventory.mockImplementation(() => {
    return Promise.resolve([inventoryRow()]);
  });
  mockGetList.mockImplementation(() => {
    return Promise.resolve({
      data: [
        {
          name: "app",
          podName: "web-1",
          podNamespaceKey: "default",
          state: "running",
          reason: "",
          isReady: true,
          restartCount: 4,
          memoryLimitBytes: 512 * 1024 * 1024,
          latestCpuPercent: 3.2,
          latestMemoryBytes: 128 * 1024 * 1024,
          metricsUpdatedAt: new Date(),
          lastSeenAt: new Date(),
        },
      ],
      count: 1,
    });
  });
  mockFetchLatestObject.mockImplementation(
    (options: { resourceType: string }) => {
      return Promise.resolve(OBJECTS[options.resourceType] || null);
    },
  );
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

/*
 * ---------------------------------------------------------------------------
 * List pages
 * ---------------------------------------------------------------------------
 */

interface ListCase {
  page: string;
  // Header label -> description key.
  explained: Array<[string, string]>;
  // Headers the table renders that must stay without an (i).
  plain: Array<string>;
}

const LIST_CASES: Array<ListCase> = [
  {
    page: "Nodes",
    explained: [
      ["CPU", "nodeCpu"],
      ["Memory", "nodeMemory"],
    ],
    plain: ["Name", "Status", "Age"],
  },
  {
    page: "Pods",
    explained: [
      ["CPU", "podCpu"],
      ["Memory", "podMemory"],
      ["Containers", "podContainers"],
    ],
    plain: ["Name", "Namespace", "Status", "Node", "Age"],
  },
  {
    page: "Containers",
    explained: [
      ["CPU", "containerCpu"],
      ["Memory", "containerMemory"],
      ["Restarts", "containerRestarts"],
    ],
    plain: ["Name", "Namespace", "Status", "Pod", "Age"],
  },
  {
    page: "Deployments",
    explained: [
      ["CPU", "deploymentCpu"],
      ["Memory", "deploymentMemory"],
      ["Ready", "deploymentReady"],
    ],
    plain: ["Name", "Namespace", "Status", "Age"],
  },
  {
    page: "StatefulSets",
    explained: [
      ["CPU", "statefulSetCpu"],
      ["Memory", "statefulSetMemory"],
      ["Ready", "statefulSetReady"],
    ],
    plain: ["Name", "Namespace", "Status", "Age"],
  },
  {
    page: "DaemonSets",
    explained: [
      ["CPU", "daemonSetCpu"],
      ["Memory", "daemonSetMemory"],
      ["Ready", "daemonSetReady"],
    ],
    plain: ["Name", "Namespace", "Status", "Age"],
  },
  {
    page: "Jobs",
    explained: [
      ["CPU", "jobCpu"],
      ["Memory", "jobMemory"],
    ],
    plain: ["Name", "Namespace", "Status", "Age"],
  },
  {
    page: "CronJobs",
    explained: [
      ["CPU", "cronJobCpu"],
      ["Memory", "cronJobMemory"],
    ],
    plain: ["Name", "Namespace", "Status", "Schedule", "Age"],
  },
  {
    page: "Namespaces",
    explained: [
      ["CPU", "namespaceCpu"],
      ["Memory", "namespaceMemory"],
    ],
    plain: ["Name", "Status", "Age"],
  },
  {
    page: "HPAs",
    explained: [
      ["Min Replicas", "hpaMinReplicas"],
      ["Max Replicas", "hpaMaxReplicas"],
      ["Current", "hpaCurrentReplicas"],
      ["Desired", "hpaDesiredReplicas"],
    ],
    plain: ["Name", "Namespace", "Status", "Target", "Age"],
  },
  {
    page: "VPAs",
    explained: [],
    plain: ["Name", "Namespace", "Status", "Target", "Update Mode", "Age"],
  },
  {
    page: "PersistentVolumeClaims",
    explained: [["Capacity", "pvcCapacity"]],
    plain: [
      "Name",
      "Namespace",
      "Status",
      "Storage Class",
      "Volume",
      "Access Modes",
      "Age",
    ],
  },
  {
    page: "PersistentVolumes",
    explained: [["Capacity", "pvCapacity"]],
    plain: [
      "Name",
      "Status",
      "Storage Class",
      "Reclaim Policy",
      "Claim",
      "Age",
    ],
  },
];

async function renderPage(page: string): Promise<void> {
  const Page: React.FunctionComponent<any> | undefined = PAGES[page];

  if (!Page) {
    throw new Error(`No page named ${page}`);
  }

  render(<Page {...PAGE_PROPS} />);
  await settle();
}

describe("Kubernetes list pages: each metric header opens the text for that list", () => {
  test.each(LIST_CASES)(
    "$page shows an (i) on exactly its metric headers",
    async (listCase: ListCase) => {
      await renderPage(listCase.page);

      // The table rendered its headers (and the stubbed row).
      expect(screen.getAllByRole("columnheader").length).toBeGreaterThanOrEqual(
        listCase.plain.length,
      );

      expect(infoLabels()).toEqual(
        listCase.explained
          .map((entry: [string, string]): string => {
            return entry[0];
          })
          .sort(),
      );
    },
  );

  const hoverCases: Array<[string, string, string]> = [];

  for (const listCase of LIST_CASES) {
    for (const [label, key] of listCase.explained) {
      hoverCases.push([listCase.page, label, key]);
    }
  }

  test.each(hoverCases)(
    "%s: hovering the %s header shows %s",
    async (page: string, label: string, key: string) => {
      await renderPage(page);

      expect(D[key]).toBeTruthy();
      expect(await tooltipFor(label)).toBe(D[key]);
    },
  );

  test.each(LIST_CASES)(
    "$page leaves its identity and status headers plain",
    async (listCase: ListCase) => {
      await renderPage(listCase.page);

      for (const label of listCase.plain) {
        expect(
          screen.queryByRole("button", { name: `About ${label}` }),
        ).not.toBeInTheDocument();
      }
    },
  );

  test("the header (i) is beside the sort button, never inside it", async () => {
    await renderPage("Nodes");

    for (const label of ["CPU", "Memory"]) {
      const info: HTMLElement = screen.getByRole("button", {
        name: `About ${label}`,
      });

      expect(info.parentElement?.closest("button, a")).toBeNull();
      expect(info.closest("th")).not.toBeNull();
    }
  });

  test("the same title opens a different explanation on different lists", async () => {
    await renderPage("Nodes");
    const nodeCpu: string = await tooltipFor("CPU");
    cleanup();

    await renderPage("Deployments");
    const deploymentCpu: string = await tooltipFor("CPU");

    expect(nodeCpu).not.toBe(deploymentCpu);
    expect(nodeCpu).toContain("latest sample, not an average");
    expect(deploymentCpu).toContain("can pass 100%");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Detail pages
 * ---------------------------------------------------------------------------
 */

interface DetailCase {
  page: string;
  explained: Array<[string, string]>;
  plain: Array<string>;
}

const DETAIL_CASES: Array<DetailCase> = [
  {
    page: "NodeDetail",
    explained: [
      ["CPU (Capacity / Allocatable)", "nodeCpuCapacity"],
      ["Memory (Capacity / Allocatable)", "nodeMemoryCapacity"],
      ["Pods (Capacity)", "nodePodCapacity"],
    ],
    plain: ["Node Name", "Cluster", "Status", "Internal IP", "Created"],
  },
  {
    page: "PodDetail",
    explained: [["Restarts", "podRestarts"]],
    plain: ["Pod Name", "Cluster", "Namespace", "Status", "Node", "Created"],
  },
  {
    page: "DeploymentDetail",
    explained: [
      ["Rollout Status", "deploymentRolloutStatus"],
      ["Desired Replicas", "deploymentDesiredReplicas"],
      ["Ready Replicas", "deploymentReadyReplicas"],
      ["Available", "deploymentAvailableReplicas"],
      ["Unavailable", "deploymentUnavailableReplicas"],
    ],
    plain: ["Name", "Cluster", "Namespace", "Strategy", "Created"],
  },
  {
    page: "StatefulSetDetail",
    explained: [
      ["Replicas", "statefulSetReplicas"],
      ["Ready Replicas", "statefulSetReadyReplicas"],
    ],
    plain: ["Name", "Cluster", "Namespace", "Service Name", "Created"],
  },
  {
    page: "DaemonSetDetail",
    explained: [
      ["Desired Scheduled", "daemonSetDesiredScheduled"],
      ["Current Scheduled", "daemonSetCurrentScheduled"],
      ["Number Ready", "daemonSetNumberReady"],
      ["Number Available", "daemonSetNumberAvailable"],
    ],
    plain: ["Name", "Cluster", "Namespace", "Update Strategy", "Created"],
  },
  {
    page: "JobDetail",
    explained: [
      ["Completions", "jobCompletions"],
      ["Parallelism", "jobParallelism"],
      ["Backoff Limit", "jobBackoffLimit"],
      ["Active", "jobActive"],
      ["Succeeded", "jobSucceeded"],
      ["Failed", "jobFailed"],
    ],
    plain: ["Job Name", "Cluster", "Namespace", "Start Time", "Created"],
  },
  {
    page: "CronJobDetail",
    explained: [
      ["Successful Jobs History Limit", "cronJobSuccessfulJobsHistoryLimit"],
      ["Failed Jobs History Limit", "cronJobFailedJobsHistoryLimit"],
      ["Active Jobs", "cronJobActiveJobs"],
    ],
    plain: [
      "CronJob Name",
      "Cluster",
      "Namespace",
      "Schedule",
      "Concurrency Policy",
      "Last Schedule Time",
      "Created",
    ],
  },
  {
    page: "PVCDetail",
    explained: [
      ["Capacity", "pvcCapacity"],
      ["Requested Storage", "pvcRequestedStorage"],
    ],
    plain: ["PVC Name", "Cluster", "Namespace", "Status", "Created"],
  },
  {
    page: "PVDetail",
    explained: [["Capacity", "pvCapacity"]],
    plain: ["PV Name", "Cluster", "Status", "Reclaim Policy", "Created"],
  },
  {
    page: "HPADetail",
    explained: [
      ["Min Replicas", "hpaMinReplicas"],
      ["Max Replicas", "hpaMaxReplicas"],
      ["Current Replicas", "hpaCurrentReplicas"],
      ["Desired Replicas", "hpaDesiredReplicas"],
      ["Metrics", "hpaMetrics"],
    ],
    plain: ["Name", "Cluster", "Namespace", "Scaling Status", "Created"],
  },
  {
    page: "VPADetail",
    explained: [["Recommendation (app)", "vpaRecommendation"]],
    plain: ["Name", "Cluster", "Namespace", "Update Mode", "Status"],
  },
];

describe("Kubernetes detail pages: each metric-like summary field is explained", () => {
  test.each(DETAIL_CASES)(
    "$page shows an (i) on exactly its metric fields",
    async (detailCase: DetailCase) => {
      await renderPage(detailCase.page);

      expect(infoLabels()).toEqual(
        detailCase.explained
          .map((entry: [string, string]): string => {
            return entry[0];
          })
          .sort(),
      );
    },
  );

  const hoverCases: Array<[string, string, string]> = [];

  for (const detailCase of DETAIL_CASES) {
    for (const [label, key] of detailCase.explained) {
      hoverCases.push([detailCase.page, label, key]);
    }
  }

  test.each(hoverCases)(
    "%s: hovering %s shows %s",
    async (page: string, label: string, key: string) => {
      await renderPage(page);

      expect(D[key]).toBeTruthy();
      expect(await tooltipFor(label)).toBe(D[key]);
    },
  );

  test.each(DETAIL_CASES)(
    "$page leaves its identity and status fields plain",
    async (detailCase: DetailCase) => {
      await renderPage(detailCase.page);

      // The field is on the page ...
      for (const label of detailCase.plain) {
        expect(screen.getAllByText(label).length).toBeGreaterThan(0);
        // ... without an (i).
        expect(
          screen.queryByRole("button", { name: `About ${label}` }),
        ).not.toBeInTheDocument();
      }
    },
  );

  test("the Unavailable field, and its (i), only appear when pods are unavailable", async () => {
    mockFetchLatestObject.mockImplementation(
      (options: { resourceType: string }) => {
        const deployment: Record<string, unknown> = OBJECTS["deployments"]!;
        return Promise.resolve(
          options.resourceType === "deployments"
            ? {
                ...deployment,
                status: {
                  replicas: 3,
                  readyReplicas: 3,
                  availableReplicas: 3,
                  unavailableReplicas: 0,
                  conditions: [],
                },
              }
            : null,
        );
      },
    );

    await renderPage("DeploymentDetail");

    expect(
      screen.getByRole("button", { name: "About Ready Replicas" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "About Unavailable" }),
    ).not.toBeInTheDocument();
  });

  test("a VPA explains each container's recommendation", async () => {
    mockFetchLatestObject.mockImplementation(() => {
      const vpa: Record<string, unknown> = OBJECTS["verticalpodautoscalers"]!;
      return Promise.resolve({
        ...vpa,
        status: {
          recommendation: {
            containerRecommendations: [
              {
                containerName: "app",
                target: { cpu: "250m", memory: "256Mi" },
                lowerBound: {},
                upperBound: {},
              },
              {
                containerName: "sidecar",
                target: { cpu: "50m", memory: "64Mi" },
                lowerBound: {},
                upperBound: {},
              },
            ],
          },
        },
      });
    });

    await renderPage("VPADetail");

    expect(await tooltipFor("Recommendation (app)")).toBe(
      D["vpaRecommendation"],
    );
    expect(await tooltipFor("Recommendation (sidecar)")).toBe(
      D["vpaRecommendation"],
    );
  });

  test("the node's Network Throughput chart header explains the chart", async () => {
    await renderPage("NodeDetail");

    fireEvent.click(screen.getByRole("tab", { name: "Metrics" }));
    await settle();

    expect(screen.getByTestId("network-throughput-chart")).toBeInTheDocument();
    expect(screen.getByText("Network Throughput")).toBeInTheDocument();
    expect(await tooltipFor("Network Throughput")).toBe(
      D["nodeNetworkThroughput"],
    );

    const info: HTMLElement = screen.getByRole("button", {
      name: "About Network Throughput",
    });

    expect(info.parentElement?.closest("button, a")).toBeNull();
  });

  test("a pod's Containers tab explains its container cards", async () => {
    await renderPage("PodDetail");

    fireEvent.click(screen.getByRole("tab", { name: "Containers" }));
    await settle();

    expect(await tooltipFor("State")).toBe(D["containerState"]);
    expect(await tooltipFor("Ready")).toBe(D["containerReady"]);
    expect(await tooltipFor("Requests")).toBe(D["containerRequests"]);
    expect(await tooltipFor("Limits")).toBe(D["containerLimits"]);
    expect(await tooltipFor("Restarts")).toBe(D["containerRestarts"]);
  });

  test("NamespaceDetail and ContainerDetail have no metric fields to explain", async () => {
    mockFetchLatestObject.mockImplementation(() => {
      return Promise.resolve({
        metadata: metadata(),
        status: { phase: "Active" },
      });
    });

    await renderPage("NamespaceDetail");
    expect(infoLabels()).toEqual([]);
    cleanup();

    await renderPage("ContainerDetail");
    expect(infoLabels()).toEqual([]);
  });
});

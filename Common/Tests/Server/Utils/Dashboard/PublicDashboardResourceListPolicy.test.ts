import PublicDashboardResourceListPolicy, {
  PublicDashboardResourceListPolicyResult,
} from "../../../../Server/Utils/Dashboard/PublicDashboardResourceListPolicy";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
import Search from "../../../../Types/BaseDatabase/Search";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import DashboardComponentType from "../../../../Types/Dashboard/DashboardComponentType";
import { DashboardVariableType } from "../../../../Types/Dashboard/DashboardVariable";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";

const RANGE_START: Date = new Date("2026-08-09T10:00:00.000Z");
const RANGE_END: Date = new Date("2026-08-09T11:00:00.000Z");

function range(): InBetween<Date> {
  return new InBetween<Date>(RANGE_START, RANGE_END);
}

function widget(
  componentType: DashboardComponentType,
  argumentsObject: JSONObject = {},
): JSONObject {
  return {
    componentType,
    arguments: argumentsObject,
  };
}

function build(data: {
  componentType: DashboardComponentType;
  argumentsObject?: JSONObject | undefined;
  requestedQuery?: JSONObject | undefined;
  requestedVariables?: Array<JSONObject> | undefined;
  storedVariables?: Array<JSONObject> | undefined;
}): PublicDashboardResourceListPolicyResult {
  return PublicDashboardResourceListPolicy.build({
    widget: widget(data.componentType, data.argumentsObject || {}),
    dashboardViewConfig: {
      components: [],
      variables: data.storedVariables || [],
    },
    requestedVariables: data.requestedVariables || [],
    requestedQuery: data.requestedQuery || {},
  });
}

interface MappingCase {
  name: string;
  componentType: DashboardComponentType;
  resourceType: string;
  argumentsObject: JSONObject;
  expectedQuery: JSONObject;
  expectedSort: JSONObject;
  expectedLimit: number;
  requestedQuery?: JSONObject | undefined;
}

const MAPPING_CASES: Array<MappingCase> = [
  {
    name: "incident",
    componentType: DashboardComponentType.IncidentList,
    resourceType: "incident",
    argumentsObject: {
      maxRows: 11,
      stateFilter: "resolved",
      severityIds: ["severity"],
      stateIds: ["state"],
      monitorIds: ["monitor"],
      labelIds: ["label"],
    },
    expectedQuery: {
      currentIncidentState: { isResolvedState: true },
      incidentSeverityId: new Includes(["severity"]),
      currentIncidentStateId: new Includes(["state"]),
      monitors: new Includes(["monitor"]),
      labels: new Includes(["label"]),
    },
    expectedSort: { createdAt: SortOrder.Descending },
    expectedLimit: 11,
  },
  {
    name: "alert",
    componentType: DashboardComponentType.AlertList,
    resourceType: "alert",
    argumentsObject: {
      stateFilter: "acknowledged",
      severityIds: ["severity"],
      stateIds: ["state"],
      monitorIds: ["monitor"],
      labelIds: ["label"],
    },
    expectedQuery: {
      currentAlertState: { isAcknowledgedState: true },
      alertSeverityId: new Includes(["severity"]),
      currentAlertStateId: new Includes(["state"]),
      monitorId: new Includes(["monitor"]),
      labels: new Includes(["label"]),
    },
    expectedSort: { createdAt: SortOrder.Descending },
    expectedLimit: 25,
  },
  {
    name: "monitor",
    componentType: DashboardComponentType.MonitorList,
    resourceType: "monitor",
    argumentsObject: {
      statusFilter: "non-operational",
      monitorStatusIds: ["status"],
      monitorTypes: ["Ping"],
      labelIds: ["label"],
    },
    expectedQuery: {
      currentMonitorStatus: { isOperationalState: false },
      currentMonitorStatusId: new Includes(["status"]),
      monitorType: new Includes(["Ping"]),
      labels: new Includes(["label"]),
    },
    expectedSort: { name: SortOrder.Ascending },
    expectedLimit: 25,
  },
  {
    name: "network map",
    componentType: DashboardComponentType.NetworkMap,
    resourceType: "network-site",
    argumentsObject: {
      maxSites: "7",
      statusFilter: "down",
      networkSiteTypeIds: ["store"],
    },
    expectedQuery: {
      currentMonitorStatus: { isOperationalState: false },
      networkSiteTypeId: new Includes(["store"]),
    },
    expectedSort: { name: SortOrder.Ascending },
    expectedLimit: 8,
  },
  {
    name: "host",
    componentType: DashboardComponentType.HostList,
    resourceType: "host",
    argumentsObject: {
      statusFilter: "connected",
      osTypeFilter: "linux",
    },
    expectedQuery: {
      otelCollectorStatus: "connected",
      osType: "linux",
    },
    expectedSort: { name: SortOrder.Ascending },
    expectedLimit: 25,
  },
  {
    name: "kubernetes pod",
    componentType: DashboardComponentType.KubernetesPodList,
    resourceType: "kubernetes-resource",
    argumentsObject: {
      kubernetesClusterIds: ["cluster"],
      namespaces: " default, oneuptime ",
      podPhases: ["Running"],
    },
    expectedQuery: {
      kind: "Pod",
      kubernetesClusterId: new Includes(["cluster"]),
      namespaceKey: new Includes(["default", "oneuptime"]),
      phase: new Includes(["Running"]),
    },
    expectedSort: {
      namespaceKey: SortOrder.Ascending,
      name: SortOrder.Ascending,
    },
    expectedLimit: 25,
  },
  {
    name: "kubernetes node",
    componentType: DashboardComponentType.KubernetesNodeList,
    resourceType: "kubernetes-resource",
    argumentsObject: {
      kubernetesClusterIds: ["cluster"],
      readinessFilter: "not-ready",
    },
    expectedQuery: {
      kind: "Node",
      kubernetesClusterId: new Includes(["cluster"]),
      isReady: false,
    },
    expectedSort: {
      namespaceKey: SortOrder.Ascending,
      name: SortOrder.Ascending,
    },
    expectedLimit: 25,
  },
  {
    name: "kubernetes namespace",
    componentType: DashboardComponentType.KubernetesNamespaceList,
    resourceType: "kubernetes-resource",
    argumentsObject: { kubernetesClusterIds: ["cluster"] },
    expectedQuery: {
      kind: "Namespace",
      kubernetesClusterId: new Includes(["cluster"]),
    },
    expectedSort: {
      namespaceKey: SortOrder.Ascending,
      name: SortOrder.Ascending,
    },
    expectedLimit: 25,
  },
  ...[
    {
      name: "kubernetes deployment",
      componentType: DashboardComponentType.KubernetesDeploymentList,
      kind: "Deployment",
    },
    {
      name: "kubernetes stateful set",
      componentType: DashboardComponentType.KubernetesStatefulSetList,
      kind: "StatefulSet",
    },
    {
      name: "kubernetes daemon set",
      componentType: DashboardComponentType.KubernetesDaemonSetList,
      kind: "DaemonSet",
    },
    {
      name: "kubernetes job",
      componentType: DashboardComponentType.KubernetesJobList,
      kind: "Job",
    },
    {
      name: "kubernetes cron job",
      componentType: DashboardComponentType.KubernetesCronJobList,
      kind: "CronJob",
    },
  ].map(
    (data: {
      name: string;
      componentType: DashboardComponentType;
      kind: string;
    }): MappingCase => {
      return {
        name: data.name,
        componentType: data.componentType,
        resourceType: "kubernetes-resource",
        argumentsObject: {
          kubernetesClusterIds: ["cluster"],
          namespaces: "namespace",
        },
        expectedQuery: {
          kind: data.kind,
          kubernetesClusterId: new Includes(["cluster"]),
          namespaceKey: new Includes(["namespace"]),
        },
        expectedSort: {
          namespaceKey: SortOrder.Ascending,
          name: SortOrder.Ascending,
        },
        expectedLimit: 25,
      };
    },
  ),
  {
    name: "docker host",
    componentType: DashboardComponentType.DockerHostList,
    resourceType: "docker-host",
    argumentsObject: { statusFilter: "disconnected" },
    expectedQuery: { otelCollectorStatus: "disconnected" },
    expectedSort: { name: SortOrder.Ascending },
    expectedLimit: 25,
  },
  {
    name: "docker container",
    componentType: DashboardComponentType.DockerContainerList,
    resourceType: "docker-container",
    argumentsObject: {
      dockerHostIds: ["host"],
      imageName: " nginx ",
    },
    expectedQuery: {
      kind: "Container",
      dockerHostId: new Includes(["host"]),
      imageName: new Search("nginx"),
    },
    expectedSort: { name: SortOrder.Ascending },
    expectedLimit: 25,
  },
  {
    name: "docker image",
    componentType: DashboardComponentType.DockerImageList,
    resourceType: "docker-image",
    argumentsObject: { dockerHostIds: ["host"], nameSearch: " api " },
    expectedQuery: {
      kind: "Image",
      dockerHostId: new Includes(["host"]),
      name: new Search("api"),
    },
    expectedSort: { name: SortOrder.Ascending },
    expectedLimit: 25,
  },
  {
    name: "docker network",
    componentType: DashboardComponentType.DockerNetworkList,
    resourceType: "docker-network",
    argumentsObject: { dockerHostIds: ["host"] },
    expectedQuery: {
      kind: "Network",
      dockerHostId: new Includes(["host"]),
    },
    expectedSort: { name: SortOrder.Ascending },
    expectedLimit: 25,
  },
  {
    name: "docker volume",
    componentType: DashboardComponentType.DockerVolumeList,
    resourceType: "docker-volume",
    argumentsObject: { dockerHostIds: ["host"] },
    expectedQuery: {
      kind: "Volume",
      dockerHostId: new Includes(["host"]),
    },
    expectedSort: { name: SortOrder.Ascending },
    expectedLimit: 25,
  },
  {
    name: "podman host",
    componentType: DashboardComponentType.PodmanHostList,
    resourceType: "podman-host",
    argumentsObject: { statusFilter: "connected" },
    expectedQuery: { otelCollectorStatus: "connected" },
    expectedSort: { name: SortOrder.Ascending },
    expectedLimit: 25,
  },
  {
    name: "podman container",
    componentType: DashboardComponentType.PodmanContainerList,
    resourceType: "podman-container",
    argumentsObject: { podmanHostIds: ["host"], imageName: "redis" },
    expectedQuery: {
      kind: "Container",
      podmanHostId: new Includes(["host"]),
      imageName: new Search("redis"),
    },
    expectedSort: { name: SortOrder.Ascending },
    expectedLimit: 25,
  },
  {
    name: "podman image",
    componentType: DashboardComponentType.PodmanImageList,
    resourceType: "podman-image",
    argumentsObject: { podmanHostIds: ["host"], nameSearch: "worker" },
    expectedQuery: {
      kind: "Image",
      podmanHostId: new Includes(["host"]),
      name: new Search("worker"),
    },
    expectedSort: { name: SortOrder.Ascending },
    expectedLimit: 25,
  },
  {
    name: "podman network",
    componentType: DashboardComponentType.PodmanNetworkList,
    resourceType: "podman-network",
    argumentsObject: { podmanHostIds: ["host"] },
    expectedQuery: {
      kind: "Network",
      podmanHostId: new Includes(["host"]),
    },
    expectedSort: { name: SortOrder.Ascending },
    expectedLimit: 25,
  },
  {
    name: "podman volume",
    componentType: DashboardComponentType.PodmanVolumeList,
    resourceType: "podman-volume",
    argumentsObject: { podmanHostIds: ["host"] },
    expectedQuery: {
      kind: "Volume",
      podmanHostId: new Includes(["host"]),
    },
    expectedSort: { name: SortOrder.Ascending },
    expectedLimit: 25,
  },
  {
    name: "proxmox node",
    componentType: DashboardComponentType.ProxmoxNodeList,
    resourceType: "proxmox-resource",
    argumentsObject: {
      proxmoxClusterIds: ["cluster"],
      statusFilter: "offline",
    },
    expectedQuery: {
      kind: "Node",
      proxmoxClusterId: new Includes(["cluster"]),
      isUp: false,
    },
    expectedSort: { name: SortOrder.Ascending },
    expectedLimit: 25,
  },
  {
    name: "proxmox guest",
    componentType: DashboardComponentType.ProxmoxGuestList,
    resourceType: "proxmox-resource",
    argumentsObject: {
      proxmoxClusterIds: ["cluster"],
      guestTypeFilter: "lxc",
      statusFilter: "running",
    },
    expectedQuery: {
      kind: "Guest",
      proxmoxClusterId: new Includes(["cluster"]),
      guestType: "lxc",
      isUp: true,
    },
    expectedSort: { name: SortOrder.Ascending },
    expectedLimit: 25,
  },
  {
    name: "ceph OSD",
    componentType: DashboardComponentType.CephOsdList,
    resourceType: "ceph-resource",
    argumentsObject: { cephClusterIds: ["cluster"], stateFilter: "out" },
    expectedQuery: {
      kind: "Osd",
      cephClusterId: new Includes(["cluster"]),
      isIn: false,
    },
    expectedSort: { externalId: SortOrder.Ascending },
    expectedLimit: 25,
  },
  {
    name: "ceph pool",
    componentType: DashboardComponentType.CephPoolList,
    resourceType: "ceph-resource",
    argumentsObject: { cephClusterIds: ["cluster"] },
    expectedQuery: {
      kind: "Pool",
      cephClusterId: new Includes(["cluster"]),
    },
    expectedSort: { name: SortOrder.Ascending },
    expectedLimit: 25,
  },
  {
    name: "docker swarm node",
    componentType: DashboardComponentType.DockerSwarmNodeList,
    resourceType: "docker-swarm-resource",
    argumentsObject: {
      dockerSwarmClusterIds: ["cluster"],
      roleFilter: "manager",
      statusFilter: "notready",
    },
    expectedQuery: {
      kind: "Node",
      dockerSwarmClusterId: new Includes(["cluster"]),
      role: "manager",
      isReady: false,
    },
    expectedSort: { name: SortOrder.Ascending },
    expectedLimit: 25,
  },
  {
    name: "docker swarm service",
    componentType: DashboardComponentType.DockerSwarmServiceList,
    resourceType: "docker-swarm-resource",
    argumentsObject: {
      dockerSwarmClusterIds: ["cluster"],
      serviceModeFilter: "global",
      statusFilter: "converged",
    },
    expectedQuery: {
      kind: "Service",
      dockerSwarmClusterId: new Includes(["cluster"]),
      serviceMode: "global",
      isReady: true,
    },
    expectedSort: { name: SortOrder.Ascending },
    expectedLimit: 25,
  },
  {
    name: "trace list",
    componentType: DashboardComponentType.TraceList,
    resourceType: "span",
    argumentsObject: { statusFilter: "2", maxRows: "31" },
    requestedQuery: { startTime: range() },
    expectedQuery: { startTime: range(), statusCode: 2 },
    expectedSort: { startTime: SortOrder.Descending },
    expectedLimit: 31,
  },
  {
    name: "log stream",
    componentType: DashboardComponentType.LogStream,
    resourceType: "log",
    argumentsObject: {
      severityFilter: "Error",
      bodyContains: " failed ",
      attributeFilterQuery: "@service.name:api",
    },
    requestedQuery: { time: range() },
    expectedQuery: {
      time: range(),
      severityText: "Error",
      body: "failed",
      attributes: { "service.name": "api" },
    },
    expectedSort: { time: SortOrder.Descending },
    expectedLimit: 50,
  },
];

describe("PublicDashboardResourceListPolicy", () => {
  describe("component mappings", () => {
    it.each(MAPPING_CASES)(
      "builds the complete stored policy for $name",
      (testCase: MappingCase) => {
        const result: PublicDashboardResourceListPolicyResult = build({
          componentType: testCase.componentType,
          argumentsObject: testCase.argumentsObject,
          requestedQuery: testCase.requestedQuery,
        });

        expect(result.resourceType).toBe(testCase.resourceType);
        expect(result.query).toEqual(testCase.expectedQuery);
        expect(result.select).toEqual(expect.any(Object));
        expect(Object.keys(result.select).length).toBeGreaterThan(0);
        expect(result.sort).toEqual(testCase.expectedSort);
        expect(result.limit).toBe(testCase.expectedLimit);
        expect(result.query["projectId"]).toBeUndefined();
      },
    );

    it("keeps projections exact for widgets that share a resource model", () => {
      const proxmoxNode: JSONObject = build({
        componentType: DashboardComponentType.ProxmoxNodeList,
      }).select;
      const proxmoxGuest: JSONObject = build({
        componentType: DashboardComponentType.ProxmoxGuestList,
      }).select;
      const swarmNode: JSONObject = build({
        componentType: DashboardComponentType.DockerSwarmNodeList,
      }).select;
      const swarmService: JSONObject = build({
        componentType: DashboardComponentType.DockerSwarmServiceList,
      }).select;

      expect(proxmoxNode["latestCpuPercent"]).toBe(true);
      expect(proxmoxNode["vmid"]).toBeUndefined();
      expect(proxmoxGuest["vmid"]).toBe(true);
      expect(proxmoxGuest["latestCpuPercent"]).toBeUndefined();
      expect(swarmNode["latestCpuPercent"]).toBe(true);
      expect(swarmNode["desiredReplicas"]).toBeUndefined();
      expect(swarmService["desiredReplicas"]).toBe(true);
      expect(swarmService["latestCpuPercent"]).toBeUndefined();
    });

    it("does not expose sibling-only Kubernetes fields", () => {
      const pod: JSONObject = build({
        componentType: DashboardComponentType.KubernetesPodList,
      }).select;
      const node: JSONObject = build({
        componentType: DashboardComponentType.KubernetesNodeList,
      }).select;
      const deployment: JSONObject = build({
        componentType: DashboardComponentType.KubernetesDeploymentList,
      }).select;

      expect(pod["phase"]).toBe(true);
      expect(pod["hasMemoryPressure"]).toBeUndefined();
      expect(node["hasMemoryPressure"]).toBe(true);
      expect(node["phase"]).toBeUndefined();
      expect(deployment["isReady"]).toBe(true);
      expect(deployment["phase"]).toBeUndefined();
    });
  });

  describe("telemetry range ownership", () => {
    it("copies only time from the log request and keeps stored filters", () => {
      const result: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.LogStream,
        argumentsObject: { severityFilter: "Error", bodyContains: "stored" },
        requestedQuery: {
          time: range(),
          severityText: "Debug",
          body: "attacker",
          attributes: { secret: "probe" },
          projectId: "other-project",
        },
      });

      expect(result.query).toEqual({
        time: range(),
        severityText: "Error",
        body: "stored",
      });
    });

    it("accepts a serialized InBetween range and canonicalizes its dates", () => {
      const result: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.LogStream,
        requestedQuery: { time: range().toJSON() },
      });

      expect(result.query["time"]).toEqual(range());
    });

    it.each([
      {},
      { time: "not-a-range" },
      { time: new InBetween("invalid", "still-invalid") },
      { time: new InBetween(RANGE_START, RANGE_START) },
      { time: new InBetween(RANGE_END, RANGE_START) },
    ])(
      "rejects an invalid or missing log time range",
      (requestedQuery: unknown) => {
        expect(() => {
          return build({
            componentType: DashboardComponentType.LogStream,
            requestedQuery: requestedQuery as JSONObject,
          });
        }).toThrow(BadDataException);
      },
    );

    it("requires a valid startTime range for spans", () => {
      expect(() => {
        return build({ componentType: DashboardComponentType.TraceList });
      }).toThrow(BadDataException);

      expect(
        build({
          componentType: DashboardComponentType.TraceList,
          requestedQuery: { startTime: range(), time: "ignored" },
        }).query,
      ).toEqual({ startTime: range() });
    });
  });

  describe("dashboard variables", () => {
    const imageVariable: JSONObject = {
      id: "image",
      name: "Image",
      type: DashboardVariableType.TelemetryAttribute,
      attributeKey: "container.image.name",
      defaultValue: "nginx",
    };

    it("uses a stored default when the requested scalar is null", () => {
      const result: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.DockerContainerList,
        argumentsObject: { imageName: "stored-image" },
        storedVariables: [imageVariable],
        requestedVariables: [
          { id: "image", selectedValue: null, selectedValues: [] },
        ],
      });

      expect(result.query["imageName"]).toBe("nginx");
    });

    it("preserves an explicit empty scalar as All and removes the base filter", () => {
      const result: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.DockerContainerList,
        argumentsObject: { imageName: "stored-image" },
        storedVariables: [imageVariable],
        requestedVariables: [
          { id: "image", selectedValue: "", selectedValues: [] },
        ],
      });

      expect(result.query).toEqual({ kind: "Container" });
    });

    it("applies bounded multi-select values through the shared interpolation", () => {
      const result: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.KubernetesPodList,
        storedVariables: [
          {
            id: "namespace",
            name: "Namespace",
            type: DashboardVariableType.TelemetryAttribute,
            attributeKey: "k8s.namespace.name",
            isMultiSelect: true,
          },
        ],
        requestedVariables: [
          {
            id: "namespace",
            selectedValue: null,
            selectedValues: ["prod", "staging"],
          },
        ],
      });

      expect(result.query["namespaceKey"]).toEqual(
        new Includes(["prod", "staging"]),
      );
    });

    it("ignores a forged scalar All value for a stored multi-select", () => {
      const storedVariables: Array<JSONObject> = [
        {
          id: "namespace",
          name: "Namespace",
          type: DashboardVariableType.TelemetryAttribute,
          attributeKey: "k8s.namespace.name",
          isMultiSelect: true,
          defaultValue: "production",
        },
      ];

      const forgedScalar: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.KubernetesPodList,
        storedVariables,
        requestedVariables: [
          {
            id: "namespace",
            selectedValue: "",
            selectedValues: [],
          },
        ],
      });
      expect(forgedScalar.query["namespaceKey"]).toBe("production");

      const compatiblePlaceholder: PublicDashboardResourceListPolicyResult =
        build({
          componentType: DashboardComponentType.KubernetesPodList,
          storedVariables,
          requestedVariables: [
            {
              id: "namespace",
              selectedValue: null,
              selectedValues: [],
            },
          ],
        });
      expect(compatiblePlaceholder.query["namespaceKey"]).toBe("production");
    });

    it("ignores stale multi-value input for a stored single-select", () => {
      const result: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.DockerContainerList,
        storedVariables: [imageVariable],
        requestedVariables: [
          {
            id: "image",
            selectedValue: "redis",
            selectedValues: ["nginx"],
          },
        ],
      });

      expect(result.query["imageName"]).toBe("redis");
    });

    it("applies log variables to stored attributes and supports explicit All", () => {
      const storedVariables: Array<JSONObject> = [
        {
          id: "service",
          name: "Service",
          type: DashboardVariableType.TelemetryAttribute,
          attributeKey: "service.name",
          defaultValue: "worker",
        },
      ];

      const withDefault: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.LogStream,
        argumentsObject: { attributeFilterQuery: "@service.name:api" },
        requestedQuery: { time: range() },
        storedVariables,
        requestedVariables: [
          { id: "service", selectedValue: null, selectedValues: [] },
        ],
      });
      expect(withDefault.query["attributes"]).toEqual({
        "service.name": "worker",
      });

      const withAll: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.LogStream,
        argumentsObject: { attributeFilterQuery: "@service.name:api" },
        requestedQuery: { time: range() },
        storedVariables,
        requestedVariables: [
          { id: "service", selectedValue: "", selectedValues: [] },
        ],
      });
      expect(withAll.query["attributes"]).toBeUndefined();
    });

    it("rejects unbounded or malformed requested selections", () => {
      const tooMany: Array<JSONObject> = Array.from(
        { length: 51 },
        (_value: unknown, index: number): JSONObject => {
          return { id: `variable-${index}`, selectedValue: "value" };
        },
      );

      expect(() => {
        return build({
          componentType: DashboardComponentType.IncidentList,
          requestedVariables: tooMany,
        });
      }).toThrow(BadDataException);

      expect(() => {
        return build({
          componentType: DashboardComponentType.IncidentList,
          requestedVariables: [
            { id: "variable", selectedValues: Array(101).fill("value") },
          ],
        });
      }).toThrow(BadDataException);
    });
  });

  describe("fixed limits and malformed widgets", () => {
    it("clamps stored list and map limits to the project ceiling", () => {
      expect(
        build({
          componentType: DashboardComponentType.MonitorList,
          argumentsObject: { maxRows: LIMIT_PER_PROJECT + 100 },
        }).limit,
      ).toBe(LIMIT_PER_PROJECT);

      expect(
        build({
          componentType: DashboardComponentType.NetworkMap,
          argumentsObject: { maxSites: LIMIT_PER_PROJECT + 100 },
        }).limit,
      ).toBe(LIMIT_PER_PROJECT);
    });

    it("fails closed for unsupported and malformed components", () => {
      expect(() => {
        return build({ componentType: DashboardComponentType.Chart });
      }).toThrow(BadDataException);

      expect(() => {
        return PublicDashboardResourceListPolicy.build({
          widget: {
            componentType: DashboardComponentType.IncidentList,
            arguments: "invalid",
          },
          dashboardViewConfig: { components: [] },
          requestedVariables: [],
          requestedQuery: {},
        });
      }).toThrow(BadDataException);

      expect(() => {
        return build({
          componentType: DashboardComponentType.IncidentList,
          argumentsObject: { severityIds: "not-an-array" },
        });
      }).toThrow(BadDataException);
    });
  });
});

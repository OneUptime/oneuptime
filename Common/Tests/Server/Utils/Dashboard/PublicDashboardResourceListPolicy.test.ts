import PublicDashboardResourceListPolicy, {
  PublicDashboardResourceListPolicyResult,
} from "../../../../Server/Utils/Dashboard/PublicDashboardResourceListPolicy";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IncludesAnyOfGroups from "../../../../Types/BaseDatabase/IncludesAnyOfGroups";
import Search from "../../../../Types/BaseDatabase/Search";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import DashboardComponentType from "../../../../Types/Dashboard/DashboardComponentType";
import {
  SloWidgetDisplayType,
  SloWidgetMetric,
} from "../../../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
import { DashboardVariableType } from "../../../../Types/Dashboard/DashboardVariable";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import SloStatus from "../../../../Types/ServiceLevelObjective/SloStatus";

const RANGE_START: Date = new Date("2026-08-09T10:00:00.000Z");
const RANGE_END: Date = new Date("2026-08-09T11:00:00.000Z");

const SLO_ID: ObjectID = ObjectID.generate();

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
    name: "SLO fleet overview",
    componentType: DashboardComponentType.SloList,
    resourceType: "slo",
    argumentsObject: {
      maxRows: 50,
      sloStatuses: [SloStatus.AtRisk, SloStatus.BudgetExhausted],
      monitorIds: ["monitor"],
      labelIds: ["label"],
    },
    expectedQuery: {
      sloStatus: new Includes([
        SloStatus.AtRisk,
        SloStatus.BudgetExhausted,
      ]),
      monitors: new Includes(["monitor"]),
      labels: new Includes(["label"]),
    },
    expectedSort: { name: SortOrder.Ascending },
    expectedLimit: LIMIT_PER_PROJECT,
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
    name: "vmware host",
    componentType: DashboardComponentType.VMwareHostList,
    resourceType: "vmware-resource",
    argumentsObject: {
      vmwareVCenterIds: ["vcenter"],
      /*
       * The vcenter receiver reports no per-host state, so the host widget
       * offers no status filter; a stray one must not reach the query.
       */
      statusFilter: "online",
      powerStateFilter: "on",
    },
    expectedQuery: {
      kind: "Host",
      vmwareVCenterId: new Includes(["vcenter"]),
    },
    expectedSort: { name: SortOrder.Ascending },
    expectedLimit: 25,
  },
  {
    name: "vmware virtual machine",
    componentType: DashboardComponentType.VMwareVirtualMachineList,
    resourceType: "vmware-resource",
    argumentsObject: {
      vmwareVCenterIds: ["vcenter"],
      powerStateFilter: "on",
      templateFilter: "exclude",
    },
    expectedQuery: {
      kind: "VirtualMachine",
      vmwareVCenterId: new Includes(["vcenter"]),
      isPoweredOn: true,
      isTemplate: false,
    },
    expectedSort: { name: SortOrder.Ascending },
    expectedLimit: 25,
  },
  {
    name: "vmware virtual machine templates only, powered off",
    componentType: DashboardComponentType.VMwareVirtualMachineList,
    resourceType: "vmware-resource",
    argumentsObject: {
      vmwareVCenterIds: ["vcenter"],
      powerStateFilter: "off",
      templateFilter: "only",
    },
    expectedQuery: {
      kind: "VirtualMachine",
      vmwareVCenterId: new Includes(["vcenter"]),
      isPoweredOn: false,
      isTemplate: true,
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
  {
    name: "slo",
    componentType: DashboardComponentType.Slo,
    resourceType: "slo",
    argumentsObject: {
      serviceLevelObjectiveId: SLO_ID.toString(),
      sloMetric: SloWidgetMetric.BurnRate,
      displayType: SloWidgetDisplayType.Chart,
      widgetTitle: "Checkout availability",
      /*
       * A widget can only ever name ONE SLO, so a stray maxRows must not be
       * able to turn its read into a page of the project's other SLOs.
       */
      maxRows: 500,
    },
    expectedQuery: { _id: SLO_ID },
    expectedSort: { name: SortOrder.Ascending },
    expectedLimit: 1,
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
      const vmwareHost: JSONObject = build({
        componentType: DashboardComponentType.VMwareHostList,
      }).select;
      const vmwareVirtualMachine: JSONObject = build({
        componentType: DashboardComponentType.VMwareVirtualMachineList,
      }).select;

      expect(vmwareHost["cpuCapacityMhz"]).toBe(true);
      expect(vmwareHost["maxMemoryBytes"]).toBe(true);
      expect(vmwareHost["isPoweredOn"]).toBeUndefined();
      expect(vmwareHost["isTemplate"]).toBeUndefined();
      expect(vmwareHost["hostName"]).toBeUndefined();
      expect(vmwareVirtualMachine["isPoweredOn"]).toBe(true);
      expect(vmwareVirtualMachine["isTemplate"]).toBe(true);
      expect(vmwareVirtualMachine["hostName"]).toBe(true);
      expect(vmwareVirtualMachine["cpuCapacityMhz"]).toBeUndefined();
      expect(vmwareVirtualMachine["maxMemoryBytes"]).toBeUndefined();
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

  describe("VMware widgets", () => {
    const vmwareWidgets: Array<DashboardComponentType> = [
      DashboardComponentType.VMwareHostList,
      DashboardComponentType.VMwareVirtualMachineList,
    ];

    it("resolves both widgets to the vmware-resource registry key", () => {
      for (const componentType of vmwareWidgets) {
        expect(build({ componentType }).resourceType).toBe("vmware-resource");
      }
    });

    it("owns the kind and never copies a caller-supplied one", () => {
      const host: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.VMwareHostList,
        argumentsObject: { kind: "VirtualMachine" },
        requestedQuery: { kind: "Datastore", projectId: "other" },
      });
      const virtualMachine: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.VMwareVirtualMachineList,
        argumentsObject: { kind: "Host" },
        requestedQuery: { kind: "Datastore", projectId: "other" },
      });

      expect(host.query).toEqual({ kind: "Host" });
      expect(virtualMachine.query).toEqual({ kind: "VirtualMachine" });
    });

    it("whitelists the virtual machine power-state and template filters", () => {
      const expectations: Array<{
        argumentsObject: JSONObject;
        expectedQuery: JSONObject;
      }> = [
        {
          argumentsObject: { powerStateFilter: "on" },
          expectedQuery: { kind: "VirtualMachine", isPoweredOn: true },
        },
        {
          argumentsObject: { powerStateFilter: "off" },
          expectedQuery: { kind: "VirtualMachine", isPoweredOn: false },
        },
        {
          argumentsObject: { templateFilter: "exclude" },
          expectedQuery: { kind: "VirtualMachine", isTemplate: false },
        },
        {
          argumentsObject: { templateFilter: "only" },
          expectedQuery: { kind: "VirtualMachine", isTemplate: true },
        },
        // "" means All for both filters.
        {
          argumentsObject: { powerStateFilter: "", templateFilter: "" },
          expectedQuery: { kind: "VirtualMachine" },
        },
        // Proxmox-style filters mean nothing to a VMware widget.
        {
          argumentsObject: { statusFilter: "running", guestTypeFilter: "qemu" },
          expectedQuery: { kind: "VirtualMachine" },
        },
      ];

      for (const expectation of expectations) {
        expect(
          build({
            componentType: DashboardComponentType.VMwareVirtualMachineList,
            argumentsObject: expectation.argumentsObject,
          }).query,
        ).toEqual(expectation.expectedQuery);
      }

      /*
       * Anything outside the whitelist fails closed rather than reaching
       * the query: the receiver never reports "suspended" separately from
       * "off", and a non-string can never be a stored filter.
       */
      for (const invalidArguments of [
        { powerStateFilter: "suspended" },
        { powerStateFilter: "running" },
        { powerStateFilter: true },
        { templateFilter: "include" },
        { templateFilter: ["only"] },
        { templateFilter: 1 },
      ] as Array<JSONObject>) {
        expect(() => {
          return build({
            componentType: DashboardComponentType.VMwareVirtualMachineList,
            argumentsObject: invalidArguments,
          });
        }).toThrow(BadDataException);
      }
    });

    it("scopes hosts and virtual machines to the stored vCenter ids only", () => {
      for (const componentType of vmwareWidgets) {
        const result: PublicDashboardResourceListPolicyResult = build({
          componentType,
          argumentsObject: { vmwareVCenterIds: ["a", "b"] },
          requestedQuery: { vmwareVCenterId: "forged" },
        });
        expect(result.query["vmwareVCenterId"]).toEqual(
          new Includes(["a", "b"]),
        );

        const unscoped: PublicDashboardResourceListPolicyResult = build({
          componentType,
          argumentsObject: { vmwareVCenterIds: [] },
        });
        expect(unscoped.query["vmwareVCenterId"]).toBeUndefined();
      }
    });

    it("interpolates host variables by vSphere attribute, bare or resource-prefixed", () => {
      const hostVariable: JSONObject = {
        id: "host",
        name: "Host",
        type: DashboardVariableType.TelemetryAttribute,
        attributeKey: "resource.vcenter.host.name",
      };
      const clusterVariable: JSONObject = {
        id: "cluster",
        name: "Cluster",
        type: DashboardVariableType.TelemetryAttribute,
        attributeKey: "vcenter.cluster.name",
        isMultiSelect: true,
      };
      const datacenterVariable: JSONObject = {
        id: "datacenter",
        name: "Datacenter",
        type: DashboardVariableType.TelemetryAttribute,
        attributeKey: "vcenter.datacenter.name",
        defaultValue: "dc-1",
      };

      const result: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.VMwareHostList,
        storedVariables: [hostVariable, clusterVariable, datacenterVariable],
        requestedVariables: [
          { id: "host", selectedValue: "esxi-01.example.com" },
          {
            id: "cluster",
            selectedValue: null,
            selectedValues: ["prod", "dr"],
          },
          { id: "datacenter", selectedValue: null },
        ],
      });

      expect(result.query).toEqual({
        kind: "Host",
        name: "esxi-01.example.com",
        clusterName: new Includes(["prod", "dr"]),
        datacenterName: "dc-1",
      });
    });

    it("interpolates virtual machine variables onto the VM's own columns", () => {
      const result: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.VMwareVirtualMachineList,
        argumentsObject: { powerStateFilter: "on" },
        storedVariables: [
          {
            id: "vm",
            name: "VM",
            type: DashboardVariableType.TelemetryAttribute,
            attributeKey: "vcenter.vm.name",
          },
          {
            id: "host",
            name: "Host",
            type: DashboardVariableType.TelemetryAttribute,
            attributeKey: "resource.vcenter.host.name",
          },
          {
            id: "cluster",
            name: "Cluster",
            type: DashboardVariableType.TelemetryAttribute,
            attributeKey: "resource.vcenter.cluster.name",
          },
        ],
        requestedVariables: [
          { id: "vm", selectedValue: "web-01" },
          { id: "host", selectedValue: "esxi-01.example.com" },
          { id: "cluster", selectedValue: "prod" },
        ],
      });

      /*
       * For a VM the host attribute is its PARENT host (hostName), not the
       * row's own name — the maps differ between the two widgets on purpose.
       */
      expect(result.query).toEqual({
        kind: "VirtualMachine",
        isPoweredOn: true,
        name: "web-01",
        hostName: "esxi-01.example.com",
        clusterName: "prod",
      });
    });

    it("ignores variables keyed on attributes the widget does not map", () => {
      const result: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.VMwareHostList,
        storedVariables: [
          {
            id: "vm",
            name: "VM",
            type: DashboardVariableType.TelemetryAttribute,
            attributeKey: "vcenter.vm.name",
          },
          {
            id: "datastore",
            name: "Datastore",
            type: DashboardVariableType.TelemetryAttribute,
            attributeKey: "vcenter.datastore.name",
          },
        ],
        requestedVariables: [
          { id: "vm", selectedValue: "web-01" },
          { id: "datastore", selectedValue: "vsanDatastore" },
        ],
      });

      expect(result.query).toEqual({ kind: "Host" });
    });

    it("projects only public-safe inventory columns", () => {
      const publicColumns: Array<string> = [
        "_id",
        "name",
        "externalId",
        "kind",
        "datacenterName",
        "clusterName",
        "hostName",
        "resourcePoolName",
        "isPoweredOn",
        "isTemplate",
        "latestCpuPercent",
        "latestMemoryPercent",
        "latestDiskPercent",
        "cpuCapacityMhz",
        "maxMemoryBytes",
        "metricsUpdatedAt",
        "vmwareVCenterId",
        "vmwareVCenter",
      ];
      const privateColumns: Array<string> = [
        "projectId",
        "project",
        "createdByUserId",
        "createdByUser",
        "deletedByUserId",
        "deletedByUser",
        "resourcePoolPath",
        "virtualAppName",
        "vmInstanceUuid",
        "lastSeenAt",
      ];

      for (const componentType of vmwareWidgets) {
        const select: JSONObject = build({ componentType }).select;

        for (const column of Object.keys(select)) {
          expect(publicColumns).toContain(column);
        }
        for (const column of privateColumns) {
          expect(select[column]).toBeUndefined();
        }
        expect(select["vmwareVCenter"]).toEqual({ name: true });
      }
    });
  });

  describe("SLO widgets", () => {
    const sloArguments: JSONObject = {
      serviceLevelObjectiveId: SLO_ID.toString(),
    };

    it("publishes only the seven numbers the widget renders", () => {
      const select: JSONObject = build({
        componentType: DashboardComponentType.Slo,
        argumentsObject: sloArguments,
      }).select;

      expect(select).toEqual({
        _id: true,
        name: true,
        targetPercentage: true,
        currentSliPercentage: true,
        errorBudgetRemainingPercentage: true,
        errorBudgetRemainingSeconds: true,
        currentBurnRate: true,
        sloStatus: true,
      });

      /*
       * The definition of an SLO is not publishable even though its headline
       * numbers are: which monitors it watches, how it is evaluated, and who
       * created it all stay behind the session.
       */
      for (const privateColumn of [
        "description",
        "slug",
        "monitors",
        "monitorLabels",
        "autoAddedMonitors",
        "downtimeMonitorStatuses",
        "labels",
        "metricQueryConfig",
        "sliType",
        "windowType",
        "windowDays",
        "timezone",
        "projectId",
        "createdByUserId",
        "createdByUser",
        "lastEvaluatedAt",
        "nextEvaluationAt",
      ]) {
        expect(select[privateColumn]).toBeUndefined();
      }
    });

    it("ignores the caller's query entirely", () => {
      const result: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.Slo,
        argumentsObject: sloArguments,
        requestedQuery: {
          _id: ObjectID.generate().toString(),
          projectId: ObjectID.generate().toString(),
          name: "probe",
          isEnabled: true,
        },
      });

      expect(result.query).toEqual({ _id: SLO_ID });
      expect(result.limit).toBe(1);
    });

    it("fails closed when the widget names no SLO", () => {
      for (const brokenArguments of [
        {},
        { serviceLevelObjectiveId: "" },
        { serviceLevelObjectiveId: "   " },
        { serviceLevelObjectiveId: null },
      ] as Array<JSONObject>) {
        expect(() => {
          return build({
            componentType: DashboardComponentType.Slo,
            argumentsObject: brokenArguments,
          });
        }).toThrow(BadDataException);
      }
    });

    it("fails closed when the stored SLO id is not a UUID", () => {
      for (const brokenId of [
        "not-a-uuid",
        "1",
        "' OR 1=1 --",
        SLO_ID.toString().replace(/-/g, ""),
      ]) {
        expect(() => {
          return build({
            componentType: DashboardComponentType.Slo,
            argumentsObject: { serviceLevelObjectiveId: brokenId },
          });
        }).toThrow(BadDataException);
      }

      expect(() => {
        return build({
          componentType: DashboardComponentType.Slo,
          argumentsObject: {
            serviceLevelObjectiveId: [SLO_ID.toString()],
          } as unknown as JSONObject,
        });
      }).toThrow(BadDataException);
    });

    it("accepts every stored metric and display type the widget can persist", () => {
      for (const sloMetric of Object.values(SloWidgetMetric)) {
        for (const displayType of Object.values(SloWidgetDisplayType)) {
          const result: PublicDashboardResourceListPolicyResult = build({
            componentType: DashboardComponentType.Slo,
            argumentsObject: {
              ...sloArguments,
              sloMetric,
              displayType,
            },
          });

          /*
           * Neither argument changes the row that is read — they only pick
           * which of its numbers the widget draws.
           */
          expect(result.query).toEqual({ _id: SLO_ID });
        }
      }
    });

    it("rejects a stored metric or display type it does not recognise", () => {
      expect(() => {
        return build({
          componentType: DashboardComponentType.Slo,
          argumentsObject: { ...sloArguments, sloMetric: "Everything" },
        });
      }).toThrow(BadDataException);

      expect(() => {
        return build({
          componentType: DashboardComponentType.Slo,
          argumentsObject: { ...sloArguments, displayType: "Raw" },
        });
      }).toThrow(BadDataException);
    });

    it("publishes only headline state for the fleet overview", () => {
      const select: JSONObject = build({
        componentType: DashboardComponentType.SloList,
      }).select;

      expect(select).toEqual({
        _id: true,
        name: true,
        targetPercentage: true,
        currentSliPercentage: true,
        errorBudgetRemainingPercentage: true,
        errorBudgetRemainingSeconds: true,
        currentBurnRate: true,
        sloStatus: true,
        isEnabled: true,
      });

      for (const privateColumn of [
        "description",
        "monitors",
        "labels",
        "monitorLabels",
        "metricQueryConfig",
        "windowType",
        "windowDays",
        "timezone",
        "projectId",
        "createdByUserId",
      ]) {
        expect(select[privateColumn]).toBeUndefined();
      }
    });

    it("uses only stored fleet filters and ignores a forged caller query", () => {
      const result: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.SloList,
        argumentsObject: {
          maxRows: 50,
          sloStatuses: [SloStatus.AtRisk],
          monitorIds: ["stored-monitor"],
          labelIds: ["stored-label"],
        },
        requestedQuery: {
          _id: ObjectID.generate().toString(),
          projectId: ObjectID.generate().toString(),
          sloStatus: SloStatus.Healthy,
          monitors: ["forged-monitor"],
          labels: ["forged-label"],
          description: "probe",
        },
      });

      expect(result.query).toEqual({
        sloStatus: new Includes([SloStatus.AtRisk]),
        monitors: new Includes(["stored-monitor"]),
        labels: new Includes(["stored-label"]),
      });
      expect(result.limit).toBe(LIMIT_PER_PROJECT);
    });

    it("accepts every persisted SLO status and rejects unknown values", () => {
      const result: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.SloList,
        argumentsObject: {
          sloStatuses: Object.values(SloStatus),
        },
      });

      expect(result.query["sloStatus"]).toEqual(
        new Includes(Object.values(SloStatus)),
      );

      for (const invalidStatuses of [
        ["Breached"],
        [SloStatus.Healthy, "Unknown"],
        "Healthy",
        [null],
      ]) {
        expect(() => {
          return build({
            componentType: DashboardComponentType.SloList,
            argumentsObject: {
              sloStatuses: invalidStatuses,
            } as unknown as JSONObject,
          });
        }).toThrow(BadDataException);
      }
    });

    it("allows an unfiltered zero-config fleet overview", () => {
      const result: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.SloList,
      });

      expect(result.query).toEqual({});
      expect(result.sort).toEqual({ name: SortOrder.Ascending });
      expect(result.limit).toBe(LIMIT_PER_PROJECT);
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

    /*
     * A stored multi-select reads only `selectedValues`. A scalar in the
     * request is not a narrower selection the viewer is entitled to — it
     * is a field this variable does not have — so it must not become a
     * predicate, whatever it contains.
     */
    it("ignores a forged scalar value for a stored multi-select", () => {
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
            selectedValue: "kube-system",
            selectedValues: [],
          },
        ],
      });
      expect(forgedScalar.query["namespaceKey"]).toBeUndefined();

      const forgedScalarAlongsidePicks: PublicDashboardResourceListPolicyResult =
        build({
          componentType: DashboardComponentType.KubernetesPodList,
          storedVariables,
          requestedVariables: [
            {
              id: "namespace",
              selectedValue: "kube-system",
              selectedValues: ["prod"],
            },
          ],
        });
      expect(forgedScalarAlongsidePicks.query["namespaceKey"]).toEqual(
        new Includes(["prod"]),
      );
    });

    /*
     * The stored `defaultValue` is a single-select concept and never
     * reaches a multi-select. A viewer who picks nothing — or who clears
     * the popover, which is the same request on the wire — gets the
     * unfiltered view the selector is showing them, not the author's
     * default silently reapplied.
     */
    it("treats an empty multi-select as All rather than the stored default", () => {
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

      const emptyList: PublicDashboardResourceListPolicyResult = build({
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
      expect(emptyList.query["namespaceKey"]).toBeUndefined();

      const omittedList: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.KubernetesPodList,
        storedVariables,
        requestedVariables: [{ id: "namespace", selectedValue: null }],
      });
      expect(omittedList.query["namespaceKey"]).toBeUndefined();

      const noSelectionSent: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.KubernetesPodList,
        storedVariables,
        requestedVariables: [],
      });
      expect(noSelectionSent.query["namespaceKey"]).toBeUndefined();
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

  describe("monitor project label variables", () => {
    const firstLabelId: string = ObjectID.generate().toString();
    const secondLabelId: string = ObjectID.generate().toString();
    const fixedLabelId: string = ObjectID.generate().toString();
    const labelVariable: JSONObject = {
      id: "unit",
      name: "UNIT",
      type: DashboardVariableType.ProjectLabel,
      labelOptions: [
        { label: "Payments", value: firstLabelId },
        { label: "Support", value: secondLabelId },
      ],
      defaultValue: firstLabelId,
    };

    it("filters by the saved variable's default when no selection was sent", () => {
      const result: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.MonitorList,
        argumentsObject: { labelVariableId: "unit" },
        storedVariables: [labelVariable],
      });

      expect(result.query).toEqual({ labels: new Includes([firstLabelId]) });
    });

    it("uses the selected label ID while retaining the saved widget filters", () => {
      const result: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.MonitorList,
        argumentsObject: {
          labelVariableId: "unit",
          statusFilter: "operational",
          monitorTypes: ["Ping"],
          monitorStatusIds: ["status"],
          maxRows: 7,
        },
        storedVariables: [labelVariable],
        requestedVariables: [{ id: "unit", selectedValue: secondLabelId }],
      });

      expect(result.query).toEqual({
        labels: new Includes([secondLabelId]),
        currentMonitorStatus: { isOperationalState: true },
        monitorType: new Includes(["Ping"]),
        currentMonitorStatusId: new Includes(["status"]),
      });
      expect(result.limit).toBe(7);
      expect(result.sort).toEqual({ name: SortOrder.Ascending });
      expect(result.select).toEqual({
        _id: true,
        name: true,
        monitorType: true,
        currentMonitorStatus: { name: true, color: true },
      });
    });

    it("requires both a fixed label group and the selected variable group", () => {
      const result: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.MonitorList,
        argumentsObject: {
          labelVariableId: "unit",
          labelIds: [fixedLabelId],
        },
        storedVariables: [labelVariable],
        requestedVariables: [{ id: "unit", selectedValue: secondLabelId }],
      });

      expect(result.query["labels"]).toEqual(
        new IncludesAnyOfGroups([[fixedLabelId], [secondLabelId]]),
      );
    });

    it("lets All clear only the variable filter and preserves fixed labels", () => {
      const result: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.MonitorList,
        argumentsObject: {
          labelVariableId: "unit",
          labelIds: [fixedLabelId],
        },
        storedVariables: [labelVariable],
        requestedVariables: [{ id: "unit", selectedValue: "" }],
      });

      expect(result.query["labels"]).toEqual(new Includes([fixedLabelId]));
    });

    it("leaves the label filter absent when All is selected without fixed labels", () => {
      const result: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.MonitorList,
        argumentsObject: { labelVariableId: "unit" },
        storedVariables: [labelVariable],
        requestedVariables: [{ id: "unit", selectedValue: "" }],
      });

      expect(result.query["labels"]).toBeUndefined();
    });

    it("matches either selected label for a multi-select", () => {
      const result: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.MonitorList,
        argumentsObject: { labelVariableId: "unit" },
        storedVariables: [{ ...labelVariable, isMultiSelect: true }],
        requestedVariables: [
          { id: "unit", selectedValues: [firstLabelId, secondLabelId] },
        ],
      });

      expect(result.query["labels"]).toEqual(
        new Includes([firstLabelId, secondLabelId]),
      );
    });

    it("treats an empty multi-select as All even when a default or stale scalar exists", () => {
      for (const requestedVariables of [
        [],
        [{ id: "unit", selectedValue: firstLabelId, selectedValues: [] }],
      ]) {
        const result: PublicDashboardResourceListPolicyResult = build({
          componentType: DashboardComponentType.MonitorList,
          argumentsObject: {
            labelVariableId: "unit",
            labelIds: [fixedLabelId],
          },
          storedVariables: [{ ...labelVariable, isMultiSelect: true }],
          requestedVariables,
        });

        expect(result.query["labels"]).toEqual(new Includes([fixedLabelId]));
      }
    });

    it("ignores stale multi-select values for a saved single-select", () => {
      const result: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.MonitorList,
        argumentsObject: { labelVariableId: "unit" },
        storedVariables: [labelVariable],
        requestedVariables: [
          {
            id: "unit",
            selectedValue: firstLabelId,
            selectedValues: [secondLabelId],
          },
        ],
      });

      expect(result.query["labels"]).toEqual(new Includes([firstLabelId]));
    });

    it("does not apply a label variable to an unbound widget", () => {
      const result: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.MonitorList,
        argumentsObject: { labelIds: [fixedLabelId] },
        storedVariables: [labelVariable],
        requestedVariables: [{ id: "unit", selectedValue: secondLabelId }],
      });

      expect(result.query["labels"]).toEqual(new Includes([fixedLabelId]));
    });

    it("rejects a selection that is no longer among the published choices", () => {
      expect(() => {
        return build({
          componentType: DashboardComponentType.MonitorList,
          argumentsObject: { labelVariableId: "unit" },
          storedVariables: [labelVariable],
          requestedVariables: [
            { id: "unit", selectedValue: ObjectID.generate().toString() },
          ],
        });
      }).toThrow(BadDataException);
    });

    it("rejects a missing or incompatible saved variable binding", () => {
      for (const storedVariables of [
        [],
        [
          {
            id: "unit",
            name: "UNIT",
            type: DashboardVariableType.TelemetryAttribute,
            attributeKey: "unit",
          },
        ],
      ]) {
        expect(() => {
          return build({
            componentType: DashboardComponentType.MonitorList,
            argumentsObject: { labelVariableId: "unit" },
            storedVariables,
          });
        }).toThrow(BadDataException);
      }
    });

    it("rejects malformed saved label choices", () => {
      for (const labelOptions of [
        null,
        "Payments",
        [null],
        [{ value: firstLabelId }],
        [{ label: "Payments", value: 42 }],
        [{ label: "", value: firstLabelId }],
      ]) {
        expect(() => {
          return build({
            componentType: DashboardComponentType.MonitorList,
            argumentsObject: { labelVariableId: "unit" },
            storedVariables: [{ ...labelVariable, labelOptions }],
          });
        }).toThrow(BadDataException);
      }
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

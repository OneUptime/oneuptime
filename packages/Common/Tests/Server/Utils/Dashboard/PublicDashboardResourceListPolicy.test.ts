import PublicDashboardResourceListPolicy, {
  PublicDashboardResourceListPolicyResult,
} from "../../../../Server/Utils/Dashboard/PublicDashboardResourceListPolicy";
import PublicDashboardViewConfig from "../../../../Server/Utils/Dashboard/PublicDashboardViewConfig";
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
import DashboardVariable, {
  DashboardVariableType,
} from "../../../../Types/Dashboard/DashboardVariable";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import { PUBLIC_SLO_WIDGET_NOT_CONFIGURED_MESSAGE } from "../../../../Server/Utils/Dashboard/PublicDashboardSloWidget";
import { UNHEALTHY_HARDWARE_STATUSES } from "../../../../Server/Services/StorageArrayResourceService";
import { STORAGE_ARRAY_UNHEALTHY_COMPONENT_STATUSES } from "../../../../Utils/Dashboard/Components/DashboardStorageArrayResourceListShared";

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

/*
 * The variables the public page's toolbar draws from these stored ones -
 * what the routes hand the policy (PublicDashboardViewConfig.getDrawnConfig).
 */
function drawnVariables(stored: unknown): Array<DashboardVariable> {
  return (
    PublicDashboardViewConfig.getDrawnConfig({
      components: [],
      variables: stored,
    }).variables || []
  );
}

function build(data: {
  componentType: DashboardComponentType;
  argumentsObject?: JSONObject | undefined;
  requestedQuery?: JSONObject | undefined;
  requestedVariables?: Array<JSONObject> | undefined;
  // As stored: a list, or anything else a write can hold.
  storedVariables?: unknown;
}): PublicDashboardResourceListPolicyResult {
  return PublicDashboardResourceListPolicy.build({
    widget: widget(data.componentType, data.argumentsObject || {}),
    variables: drawnVariables(data.storedVariables || []),
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
  /*
   * Unresolved, Resolved or Acknowledged, which the route turns into the
   * project's state ids (Common/Utils/ResolvedState,
   * Common/Utils/AcknowledgedState) - not a query on one flag.
   */
  expectedResolvedStateFilter?:
    | "unresolved"
    | "resolved"
    | "acknowledged"
    | undefined;
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
      incidentSeverityId: new Includes(["severity"]),
      currentIncidentStateId: new Includes(["state"]),
      monitors: new Includes(["monitor"]),
      labels: new Includes(["label"]),
    },
    expectedResolvedStateFilter: "resolved",
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
    /*
     * Acknowledged is the project's acknowledged state and every state
     * placed after it short of resolved - by where its states sit, never a
     * query on the acknowledged flag, which left out a state between
     * Acknowledged and Resolved.
     */
    expectedQuery: {
      alertSeverityId: new Includes(["severity"]),
      currentAlertStateId: new Includes(["state"]),
      monitorId: new Includes(["monitor"]),
      labels: new Includes(["label"]),
    },
    expectedResolvedStateFilter: "acknowledged",
    expectedSort: { createdAt: SortOrder.Descending },
    expectedLimit: 25,
  },
  {
    name: "incident (acknowledged)",
    componentType: DashboardComponentType.IncidentList,
    resourceType: "incident",
    argumentsObject: {
      stateFilter: "acknowledged",
    },
    expectedQuery: {},
    expectedResolvedStateFilter: "acknowledged",
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
    name: "storage array volume",
    componentType: DashboardComponentType.StorageArrayVolumeList,
    resourceType: "storage-array-resource",
    argumentsObject: { storageArrayIds: ["array"] },
    expectedQuery: {
      kind: "Volume",
      storageArrayId: new Includes(["array"]),
    },
    expectedSort: { name: SortOrder.Ascending },
    expectedLimit: 25,
  },
  {
    name: "storage array hardware",
    componentType: DashboardComponentType.StorageArrayHardwareList,
    resourceType: "storage-array-resource",
    argumentsObject: { storageArrayIds: ["array"], maxRows: 100 },
    expectedQuery: {
      kind: new Includes(["Hardware", "Drive", "Controller"]),
      storageArrayId: new Includes(["array"]),
    },
    expectedSort: { name: SortOrder.Ascending },
    expectedLimit: 100,
  },
  {
    name: "storage array hardware, unhealthy drives only",
    componentType: DashboardComponentType.StorageArrayHardwareList,
    resourceType: "storage-array-resource",
    argumentsObject: {
      storageArrayIds: ["array"],
      kindFilter: "Drive",
      statusFilter: "unhealthy",
    },
    expectedQuery: {
      kind: "Drive",
      storageArrayId: new Includes(["array"]),
      status: new Includes([
        "critical",
        "failed",
        "missing",
        "unhealthy",
        "degraded",
        "unknown",
        "unrecognized",
        "not ready",
      ]),
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
        expect(result.resolvedStateFilter).toBe(
          testCase.expectedResolvedStateFilter,
        );
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

  describe("Storage Array widgets", () => {
    const storageArrayWidgets: Array<DashboardComponentType> = [
      DashboardComponentType.StorageArrayVolumeList,
      DashboardComponentType.StorageArrayHardwareList,
    ];

    it("resolves both widgets to the storage-array-resource registry key", () => {
      for (const componentType of storageArrayWidgets) {
        expect(build({ componentType }).resourceType).toBe(
          "storage-array-resource",
        );
      }
    });

    it("owns the kind and never copies a caller-supplied one", () => {
      const volume: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.StorageArrayVolumeList,
        argumentsObject: { kind: "Bucket" },
        requestedQuery: { kind: "Host", projectId: "other" },
      });
      const hardware: PublicDashboardResourceListPolicyResult = build({
        componentType: DashboardComponentType.StorageArrayHardwareList,
        argumentsObject: { kind: "Volume" },
        requestedQuery: { kind: "Bucket", projectId: "other" },
      });

      expect(volume.query).toEqual({ kind: "Volume" });
      expect(hardware.query).toEqual({
        kind: new Includes(["Hardware", "Drive", "Controller"]),
      });
    });

    it("narrows the hardware kinds only to one of the three the widget lists", () => {
      for (const kind of ["Hardware", "Drive", "Controller"]) {
        expect(
          build({
            componentType: DashboardComponentType.StorageArrayHardwareList,
            argumentsObject: { kindFilter: kind },
          }).query,
        ).toEqual({ kind: kind });
      }

      // "" is the dropdown's All option.
      expect(
        build({
          componentType: DashboardComponentType.StorageArrayHardwareList,
          argumentsObject: { kindFilter: "" },
        }).query,
      ).toEqual({ kind: new Includes(["Hardware", "Drive", "Controller"]) });

      /*
       * A kind outside the three would widen a hardware widget into the
       * array's volumes, hosts or buckets on an unauthenticated route, so
       * it fails closed instead.
       */
      for (const invalidArguments of [
        { kindFilter: "Volume" },
        { kindFilter: "Bucket" },
        { kindFilter: "drive" },
        { kindFilter: ["Drive"] },
        { kindFilter: true },
      ] as Array<JSONObject>) {
        expect(() => {
          return build({
            componentType: DashboardComponentType.StorageArrayHardwareList,
            argumentsObject: invalidArguments,
          });
        }).toThrow(BadDataException);
      }
    });

    it("whitelists the hardware status filter to the unhealthy statuses", () => {
      expect(
        build({
          componentType: DashboardComponentType.StorageArrayHardwareList,
          argumentsObject: { statusFilter: "unhealthy" },
        }).query,
      ).toEqual({
        kind: new Includes(["Hardware", "Drive", "Controller"]),
        status: new Includes([...STORAGE_ARRAY_UNHEALTHY_COMPONENT_STATUSES]),
      });

      expect(
        build({
          componentType: DashboardComponentType.StorageArrayHardwareList,
          argumentsObject: { statusFilter: "" },
        }).query,
      ).toEqual({ kind: new Includes(["Hardware", "Drive", "Controller"]) });

      for (const invalidArguments of [
        { statusFilter: "critical" },
        { statusFilter: "healthy" },
        { statusFilter: ["unhealthy"] },
        { statusFilter: 1 },
      ] as Array<JSONObject>) {
        expect(() => {
          return build({
            componentType: DashboardComponentType.StorageArrayHardwareList,
            argumentsObject: invalidArguments,
          });
        }).toThrow(BadDataException);
      }
    });

    it("treats unhealthy as exactly the statuses ingest counts as unhealthy hardware", () => {
      expect([...STORAGE_ARRAY_UNHEALTHY_COMPONENT_STATUSES].sort()).toEqual(
        [...UNHEALTHY_HARDWARE_STATUSES].sort(),
      );
    });

    it("ignores hardware filters on the volume widget", () => {
      expect(
        build({
          componentType: DashboardComponentType.StorageArrayVolumeList,
          argumentsObject: { kindFilter: "Drive", statusFilter: "unhealthy" },
        }).query,
      ).toEqual({ kind: "Volume" });
    });

    it("scopes both widgets to the stored storage array ids only", () => {
      for (const componentType of storageArrayWidgets) {
        const result: PublicDashboardResourceListPolicyResult = build({
          componentType,
          argumentsObject: { storageArrayIds: ["a", "b"] },
          requestedQuery: { storageArrayId: "forged" },
        });
        expect(result.query["storageArrayId"]).toEqual(
          new Includes(["a", "b"]),
        );

        const unscoped: PublicDashboardResourceListPolicyResult = build({
          componentType,
          argumentsObject: { storageArrayIds: [] },
        });
        expect(unscoped.query["storageArrayId"]).toBeUndefined();
      }
    });

    it("interpolates each widget's own object label onto externalId, and nothing else", () => {
      const storedVariables: Array<JSONObject> = [
        {
          id: "volume",
          name: "Volume",
          type: DashboardVariableType.TelemetryAttribute,
          attributeKey: "name",
        },
        {
          id: "component",
          name: "Component",
          type: DashboardVariableType.TelemetryAttribute,
          attributeKey: "component_name",
          isMultiSelect: true,
        },
        {
          id: "array",
          name: "Storage Array",
          type: DashboardVariableType.TelemetryAttribute,
          attributeKey: "resource.storage.array.name",
        },
      ];
      const requestedVariables: Array<JSONObject> = [
        { id: "volume", selectedValue: "vg1/db-data" },
        {
          id: "component",
          selectedValue: null,
          selectedValues: ["CH0.BAY1", "CH0.BAY2"],
        },
        { id: "array", selectedValue: "fa-prod-01" },
      ];

      expect(
        build({
          componentType: DashboardComponentType.StorageArrayVolumeList,
          storedVariables,
          requestedVariables,
        }).query,
      ).toEqual({ kind: "Volume", externalId: "vg1/db-data" });

      expect(
        build({
          componentType: DashboardComponentType.StorageArrayHardwareList,
          storedVariables,
          requestedVariables,
        }).query,
      ).toEqual({
        kind: new Includes(["Hardware", "Drive", "Controller"]),
        externalId: new Includes(["CH0.BAY1", "CH0.BAY2"]),
      });
    });

    it("projects each widget's own columns, never its sibling's", () => {
      const volume: JSONObject = build({
        componentType: DashboardComponentType.StorageArrayVolumeList,
      }).select;
      const hardware: JSONObject = build({
        componentType: DashboardComponentType.StorageArrayHardwareList,
      }).select;

      for (const column of [
        "readLatencyUsec",
        "writeLatencyUsec",
        "readIops",
        "writeIops",
        "usedBytes",
        "groupName",
      ]) {
        expect(volume[column]).toBe(true);
        expect(hardware[column]).toBeUndefined();
      }
      for (const column of [
        "status",
        "statusDetail",
        "componentType",
        "model",
        "temperatureCelsius",
      ]) {
        expect(hardware[column]).toBe(true);
        expect(volume[column]).toBeUndefined();
      }
    });

    it("projects only public-safe inventory columns", () => {
      const privateColumns: Array<string> = [
        "projectId",
        "project",
        "createdByUserId",
        "createdByUser",
        "deletedByUserId",
        "deletedByUser",
        "details",
        "lastSeenAt",
      ];

      for (const componentType of storageArrayWidgets) {
        const select: JSONObject = build({ componentType }).select;

        for (const column of privateColumns) {
          expect(select[column]).toBeUndefined();
        }
        expect(select["storageArray"]).toEqual({ name: true });
        expect(select["storageArrayId"]).toBe(true);
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
      /*
       * The status's priority is read too (issue #5082): the Status column
       * sorts by it, and an ordered list must select what it is ordered by.
       */
      expect(result.select).toEqual({
        _id: true,
        name: true,
        monitorType: true,
        currentMonitorStatus: { name: true, color: true, priority: true },
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
          variables: [],
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

  /*
   * Issue #6315. The routes hand the policy the widget and the variables as
   * the public page draws them (PublicDashboardViewConfig.getDrawnConfig) -
   * the reading every board makes of a stored config, signed in and public
   * alike. So a variable or a widget stored in a shape the editor never
   * writes lists exactly as the same one stored as the editor stores it,
   * and a viewer's pick is read for the one variable the page draws under
   * its id, and for no other.
   */
  describe("variables and widgets as the public page draws them (issue #6315)", () => {
    const TA: DashboardVariableType = DashboardVariableType.TelemetryAttribute;
    const CONTAINERS: DashboardComponentType =
      DashboardComponentType.DockerContainerList;

    // A Docker container list filters by these two keys (name, imageName).
    const NAME_VARIABLE: JSONObject = {
      id: "name",
      name: "Name",
      type: TA,
      attributeKey: "container.name",
    };
    const IMAGE_VARIABLE: JSONObject = {
      id: "image",
      name: "Image",
      type: TA,
      attributeKey: "container.image.name",
      defaultValue: "nginx",
    };

    const withoutId: (variable: JSONObject) => JSONObject = (
      variable: JSONObject,
    ): JSONObject => {
      const copy: JSONObject = { ...variable };
      delete copy["id"];
      return copy;
    };

    // The ids the page draws these stored variables under: where it sends its picks.
    const pageIdsOf: (stored: unknown) => Array<string> = (
      stored: unknown,
    ): Array<string> => {
      return drawnVariables(stored).map((variable: DashboardVariable) => {
        return variable.id;
      });
    };

    // The widget as the public page draws this stored one.
    const drawnWidget: (stored: unknown) => JSONObject = (
      stored: unknown,
    ): JSONObject => {
      const components: Array<unknown> =
        PublicDashboardViewConfig.getDrawnConfig({
          components: [stored],
        }).components;

      expect(components).toHaveLength(1);
      return components[0] as JSONObject;
    };

    const buildDrawn: (data: {
      storedWidget: unknown;
      storedVariables?: unknown;
      requestedVariables?: Array<JSONObject> | undefined;
      requestedQuery?: JSONObject | undefined;
    }) => PublicDashboardResourceListPolicyResult = (data: {
      storedWidget: unknown;
      storedVariables?: unknown;
      requestedVariables?: Array<JSONObject> | undefined;
      requestedQuery?: JSONObject | undefined;
    }): PublicDashboardResourceListPolicyResult => {
      return PublicDashboardResourceListPolicy.build({
        widget: drawnWidget(data.storedWidget),
        variables: drawnVariables(data.storedVariables || []),
        requestedVariables: data.requestedVariables || [],
        requestedQuery: data.requestedQuery || {},
      });
    };

    // A build's outcome in words: what it lists, or why it was refused.
    const outcomeOf: (
      buildPolicy: () => PublicDashboardResourceListPolicyResult,
    ) => string = (
      buildPolicy: () => PublicDashboardResourceListPolicyResult,
    ): string => {
      try {
        return `lists ${buildPolicy().resourceType}`;
      } catch (error) {
        if (error instanceof BadDataException) {
          return `refused: ${error.message}`;
        }

        return `threw: ${String(error)}`;
      }
    };

    describe("each variable shape reads as the editor's", () => {
      it("reads a variable list written as JSON text as the same list stored as a list", () => {
        for (const requestedVariables of [
          [],
          [{ id: "image", selectedValue: "redis", selectedValues: [] }],
          [{ id: "image", selectedValue: "", selectedValues: [] }],
          [{ id: "name", selectedValue: "web", selectedValues: [] }],
        ]) {
          const asList: PublicDashboardResourceListPolicyResult = build({
            componentType: CONTAINERS,
            storedVariables: [NAME_VARIABLE, IMAGE_VARIABLE],
            requestedVariables,
          });
          const asText: PublicDashboardResourceListPolicyResult = build({
            componentType: CONTAINERS,
            storedVariables: JSON.stringify([NAME_VARIABLE, IMAGE_VARIABLE]),
            requestedVariables,
          });

          expect(asText).toEqual(asList);
        }

        expect(
          build({
            componentType: CONTAINERS,
            storedVariables: JSON.stringify([IMAGE_VARIABLE]),
            requestedVariables: [{ id: "image", selectedValue: "redis" }],
          }).query,
        ).toEqual({ kind: "Container", imageName: "redis" });
      });

      it("reads a variable stored without an id under the id the page draws it under, and applies the page's pick sent there", () => {
        const stored: Array<JSONObject> = [withoutId(IMAGE_VARIABLE)];
        const [pageId] = pageIdsOf(stored);

        expect(ObjectID.isValidUUID(pageId!)).toBe(true);

        expect(
          build({
            componentType: CONTAINERS,
            storedVariables: stored,
            requestedVariables: [{ id: pageId!, selectedValue: "redis" }],
          }).query,
        ).toEqual({ kind: "Container", imageName: "redis" });

        // No pick: its default, as signed in.
        expect(
          build({ componentType: CONTAINERS, storedVariables: stored }).query,
        ).toEqual({ kind: "Container", imageName: "nginx" });

        // All, as signed in: no filter at all.
        expect(
          build({
            componentType: CONTAINERS,
            storedVariables: stored,
            requestedVariables: [{ id: pageId!, selectedValue: "" }],
          }).query,
        ).toEqual({ kind: "Container" });
      });

      it("reads two variables stored with one id each under its own id, and applies each pick to its own variable only", () => {
        const stored: Array<JSONObject> = [
          { ...NAME_VARIABLE, id: "shared" },
          { ...IMAGE_VARIABLE, id: "shared", defaultValue: undefined },
        ];
        const [firstId, secondId] = pageIdsOf(stored);

        expect(firstId).toBe("shared");
        expect(secondId).not.toBe("shared");

        expect(
          build({
            componentType: CONTAINERS,
            storedVariables: stored,
            requestedVariables: [
              { id: "shared", selectedValue: "web" },
              { id: secondId!, selectedValue: "redis" },
            ],
          }).query,
        ).toEqual({ kind: "Container", name: "web", imageName: "redis" });

        // The shared id names the first variable, never the second.
        expect(
          build({
            componentType: CONTAINERS,
            storedVariables: stored,
            requestedVariables: [{ id: "shared", selectedValue: "redis" }],
          }).query,
        ).toEqual({ kind: "Container", name: "redis" });

        // The second's own id names the second only.
        expect(
          build({
            componentType: CONTAINERS,
            storedVariables: stored,
            requestedVariables: [{ id: secondId!, selectedValue: "web" }],
          }).query,
        ).toEqual({ kind: "Container", imageName: "web" });
      });

      it('reads isMultiSelect written as "true" as a multi-select and "false" as a single select', () => {
        const namespaceVariable: (isMultiSelect: unknown) => JSONObject = (
          isMultiSelect: unknown,
        ): JSONObject => {
          return {
            id: "namespace",
            name: "Namespace",
            type: TA,
            attributeKey: "k8s.namespace.name",
            isMultiSelect: isMultiSelect as boolean,
            defaultValue: "production",
          };
        };
        const requestedVariables: Array<JSONObject> = [
          {
            id: "namespace",
            selectedValue: "kube-system",
            selectedValues: ["prod", "staging"],
          },
        ];

        const asText: PublicDashboardResourceListPolicyResult = build({
          componentType: DashboardComponentType.KubernetesPodList,
          storedVariables: [namespaceVariable("true")],
          requestedVariables,
        });

        expect(asText.query["namespaceKey"]).toEqual(
          new Includes(["prod", "staging"]),
        );
        expect(asText).toEqual(
          build({
            componentType: DashboardComponentType.KubernetesPodList,
            storedVariables: [namespaceVariable(true)],
            requestedVariables,
          }),
        );

        const single: PublicDashboardResourceListPolicyResult = build({
          componentType: DashboardComponentType.KubernetesPodList,
          storedVariables: [namespaceVariable("false")],
          requestedVariables,
        });

        expect(single.query["namespaceKey"]).toBe("kube-system");
        expect(single).toEqual(
          build({
            componentType: DashboardComponentType.KubernetesPodList,
            storedVariables: [namespaceVariable(false)],
            requestedVariables,
          }),
        );

        // A multi-select never falls back to the default, written either way.
        expect(
          build({
            componentType: DashboardComponentType.KubernetesPodList,
            storedVariables: [namespaceVariable("true")],
          }).query["namespaceKey"],
        ).toBeUndefined();
      });

      it("reads a default written as a number, or as true, as its text", () => {
        const withDefault: (defaultValue: unknown) => JSONObject = (
          defaultValue: unknown,
        ): JSONObject => {
          return {
            ...IMAGE_VARIABLE,
            defaultValue: defaultValue as string,
          };
        };

        expect(
          build({
            componentType: CONTAINERS,
            storedVariables: [withDefault(5)],
          }).query,
        ).toEqual({ kind: "Container", imageName: "5" });

        expect(
          build({
            componentType: CONTAINERS,
            storedVariables: [withDefault(true)],
          }).query,
        ).toEqual({ kind: "Container", imageName: "true" });

        // The viewer's pick still wins over it.
        expect(
          build({
            componentType: CONTAINERS,
            storedVariables: [withDefault(5)],
            requestedVariables: [{ id: "image", selectedValue: "redis" }],
          }).query,
        ).toEqual({ kind: "Container", imageName: "redis" });
      });

      it("reads an id written as a number, or with spaces around it, as the text the page sends", () => {
        const stored: Array<JSONObject> = [
          { ...IMAGE_VARIABLE, id: 42 as unknown as string },
          { ...NAME_VARIABLE, id: "  name  " },
        ];

        expect(pageIdsOf(stored)).toEqual(["42", "name"]);
        expect(
          build({
            componentType: CONTAINERS,
            storedVariables: stored,
            requestedVariables: [
              { id: "42", selectedValue: "redis" },
              { id: "name", selectedValue: "web" },
            ],
          }).query,
        ).toEqual({ kind: "Container", imageName: "redis", name: "web" });
      });

      it("skips an entry of the list that is no variable, as the toolbar does", () => {
        expect(
          build({
            componentType: CONTAINERS,
            storedVariables: [null, 7, "image", [], IMAGE_VARIABLE, true],
            requestedVariables: [{ id: "image", selectedValue: "redis" }],
          }).query,
        ).toEqual({ kind: "Container", imageName: "redis" });
      });

      it("keeps a Telemetry Attribute variable without a key, which filters no list - here as on the page - instead of refusing the widget", () => {
        expect(
          build({
            componentType: CONTAINERS,
            storedVariables: [
              { id: "unset", name: "Unset", type: TA },
              { id: "blank", name: "Blank", type: TA, attributeKey: "" },
              IMAGE_VARIABLE,
            ],
            requestedVariables: [
              { id: "unset", selectedValue: "x" },
              { id: "blank", selectedValue: "y" },
              { id: "image", selectedValue: "redis" },
            ],
          }).query,
        ).toEqual({ kind: "Container", imageName: "redis" });
      });

      it("reads a key with spaces around it as the page reads it, untrimmed", () => {
        // No list maps such a key, here as on the page.
        expect(
          build({
            componentType: CONTAINERS,
            storedVariables: [
              { ...IMAGE_VARIABLE, attributeKey: " container.image.name " },
            ],
            requestedVariables: [{ id: "image", selectedValue: "redis" }],
          }).query,
        ).toEqual({ kind: "Container" });

        // A log stream filters by the key as it is written, as on the page.
        expect(
          build({
            componentType: DashboardComponentType.LogStream,
            requestedQuery: { time: range() },
            storedVariables: [
              {
                id: "service",
                name: "Service",
                type: TA,
                attributeKey: " service ",
              },
            ],
            requestedVariables: [{ id: "service", selectedValue: "api" }],
          }).query["attributes"],
        ).toEqual({ " service ": "api" });
      });

      it("checks a project label variable's choices only for a widget that filters by it, as the page does", () => {
        const broken: JSONObject = {
          id: "unit",
          name: "UNIT",
          type: DashboardVariableType.ProjectLabel,
          labelOptions: "Payments",
        };

        // An incident list does not filter by it: it lists.
        expect(
          outcomeOf(() => {
            return build({
              componentType: DashboardComponentType.IncidentList,
              storedVariables: [broken],
              requestedVariables: [{ id: "unit", selectedValue: "x" }],
            });
          }),
        ).toBe("lists incident");

        // A monitor list that does is refused, as on the page.
        expect(
          outcomeOf(() => {
            return build({
              componentType: DashboardComponentType.MonitorList,
              argumentsObject: { labelVariableId: "unit" },
              storedVariables: [broken],
            });
          }),
        ).toBe(
          "refused: A project label variable must offer between 1 and 1000 labels.",
        );
      });

      it("reads a saved label choice without a label as the toolbar names it: by its label ID", () => {
        const labelId: string = ObjectID.generate().toString();
        const stored: Array<JSONObject> = [
          {
            id: "unit",
            name: "UNIT",
            type: DashboardVariableType.ProjectLabel,
            labelOptions: [{ value: labelId }],
          },
        ];

        expect(drawnVariables(stored)[0]?.labelOptions).toEqual([
          { label: labelId, value: labelId },
        ]);
        expect(
          build({
            componentType: DashboardComponentType.MonitorList,
            argumentsObject: { labelVariableId: "unit" },
            storedVariables: stored,
            requestedVariables: [{ id: "unit", selectedValue: labelId }],
          }).query,
        ).toEqual({ labels: new Includes([labelId]) });
      });

      /*
       * The same two variables in every shape: whatever the viewer picks,
       * sent under the ids the page draws them under, the list reads
       * exactly as with the variables stored as the editor stores them.
       */
      const EDITOR: Array<JSONObject> = [
        {
          id: "name",
          name: "Name",
          type: TA,
          attributeKey: "container.name",
          isMultiSelect: false,
          defaultValue: "5",
        },
        {
          id: "image",
          name: "Image",
          type: TA,
          attributeKey: "container.image.name",
          isMultiSelect: true,
        },
      ];

      const SHAPES: Array<[string, unknown]> = [
        ["a list written as JSON text", JSON.stringify(EDITOR)],
        ["variables stored without ids", EDITOR.map(withoutId)],
        [
          "variables sharing one id",
          EDITOR.map((variable: JSONObject) => {
            return { ...variable, id: "shared" };
          }),
        ],
        [
          'isMultiSelect written as "true" and "false"',
          EDITOR.map((variable: JSONObject) => {
            return {
              ...variable,
              isMultiSelect: String(variable["isMultiSelect"]),
            };
          }),
        ],
        [
          "a default written as a number",
          [{ ...EDITOR[0]!, defaultValue: 5 }, EDITOR[1]!],
        ],
        [
          "ids written as numbers",
          EDITOR.map((variable: JSONObject, index: number) => {
            return { ...variable, id: index + 1 };
          }),
        ],
        [
          "ids with spaces around them",
          EDITOR.map((variable: JSONObject) => {
            return { ...variable, id: `  ${variable["id"]}  ` };
          }),
        ],
        [
          "entries that are no variable among them",
          [null, EDITOR[0], "x", 7, EDITOR[1]],
        ],
        [
          "all of these at once, in a list written as JSON text",
          JSON.stringify([
            "junk",
            {
              ...withoutId(EDITOR[0]!),
              defaultValue: 5,
              isMultiSelect: "false",
            },
            null,
            { ...EDITOR[1]!, id: 7, isMultiSelect: "true" },
          ]),
        ],
      ];

      const PICKS: Array<[string, Array<JSONObject | null>]> = [
        ["no pick", [null, null]],
        ["a name", [{ selectedValue: "api", selectedValues: [] }, null]],
        [
          "two images",
          [null, { selectedValue: null, selectedValues: ["redis", "nginx"] }],
        ],
        [
          "All on both",
          [
            { selectedValue: "", selectedValues: [] },
            { selectedValue: null, selectedValues: [] },
          ],
        ],
        [
          "both",
          [
            { selectedValue: "web", selectedValues: ["ignored"] },
            { selectedValue: "ignored", selectedValues: ["redis"] },
          ],
        ],
      ];

      // The page's request: each pick sent under the id it draws that variable under.
      const requestFor: (
        stored: unknown,
        picks: Array<JSONObject | null>,
      ) => Array<JSONObject> = (
        stored: unknown,
        picks: Array<JSONObject | null>,
      ): Array<JSONObject> => {
        return pageIdsOf(stored)
          .slice(0, picks.length)
          .flatMap((id: string, index: number): Array<JSONObject> => {
            const pick: JSONObject | null = picks[index] || null;
            return pick ? [{ id, ...pick }] : [];
          });
      };

      it.each(SHAPES)(
        "lists as the editor's variables do with %s, for every pick",
        (_shape: string, stored: unknown) => {
          for (const [pickName, picks] of PICKS) {
            const asEditor: PublicDashboardResourceListPolicyResult = build({
              componentType: CONTAINERS,
              storedVariables: EDITOR,
              requestedVariables: requestFor(EDITOR, picks),
            });
            const asShape: PublicDashboardResourceListPolicyResult = build({
              componentType: CONTAINERS,
              storedVariables: stored,
              requestedVariables: requestFor(stored, picks),
            });

            expect([pickName, asShape]).toEqual([pickName, asEditor]);
          }
        },
      );

      it("hands every widget the drawn variables with the viewer's picks, as the signed-in board hands its widgets", () => {
        for (const [, stored] of SHAPES) {
          for (const [, picks] of PICKS) {
            const drawn: Array<DashboardVariable> = drawnVariables(stored);
            const resolved: Array<DashboardVariable> =
              PublicDashboardResourceListPolicy.resolveDashboardVariableSelections(
                {
                  variables: drawn,
                  requestedVariables: requestFor(stored, picks),
                },
              );

            // What the signed-in board hands its widgets: each drawn variable, the viewer's pick on it.
            const signedIn: Array<JSONObject> = drawn.map(
              (variable: DashboardVariable, index: number): JSONObject => {
                const pick: JSONObject | null = picks[index] || null;
                const isMultiSelect: boolean = variable.isMultiSelect === true;

                return {
                  id: variable.id,
                  type: variable.type,
                  attributeKey: variable.attributeKey,
                  isMultiSelect,
                  defaultValue: variable.defaultValue,
                  selectedValue:
                    !isMultiSelect &&
                    typeof pick?.["selectedValue"] === "string"
                      ? pick["selectedValue"]
                      : undefined,
                  selectedValues: isMultiSelect
                    ? (pick?.["selectedValues"] as Array<string> | undefined)
                    : undefined,
                };
              },
            );

            expect(
              resolved.map((variable: DashboardVariable): JSONObject => {
                return {
                  id: variable.id,
                  type: variable.type,
                  attributeKey: variable.attributeKey,
                  isMultiSelect: variable.isMultiSelect,
                  defaultValue: variable.defaultValue,
                  selectedValue: variable.selectedValue,
                  selectedValues: variable.selectedValues,
                };
              }),
            ).toEqual(signedIn);
          }
        }
      });
    });

    /*
     * A variable the page draws under an id derived for it - stored without
     * an id, or with one an earlier variable has - is answered for only
     * under that id, with only what it allows: never another variable's
     * values, and never a pick the request may not make at all.
     */
    describe("a pick can only ever select what its own drawn variable allows", () => {
      it("never reads a pick under an id the page draws no variable under", () => {
        const stored: Array<JSONObject> = [withoutId(IMAGE_VARIABLE)];
        const [pageId] = pageIdsOf(stored);

        for (const id of [
          "image",
          `${pageId!.slice(0, -1)}2`,
          "00000000-0000-4000-9000-000000000000",
          ObjectID.generate().toString(),
          "constructor",
          "__proto__",
          "toString",
        ]) {
          expect([
            id,
            build({
              componentType: CONTAINERS,
              storedVariables: stored,
              requestedVariables: [{ id, selectedValue: "redis" }],
            }).query,
          ]).toEqual([id, { kind: "Container", imageName: "nginx" }]);
        }
      });

      it("never reads a pick under a variable's stored id when the page draws it under another", () => {
        // Both store "shared": the page draws the second under an id of its own.
        const stored: Array<JSONObject> = [
          {
            ...NAME_VARIABLE,
            id: "shared",
            type: DashboardVariableType.CustomList,
          },
          { ...IMAGE_VARIABLE, id: "shared" },
        ];

        expect(
          build({
            componentType: CONTAINERS,
            storedVariables: stored,
            requestedVariables: [{ id: "shared", selectedValue: "redis" }],
          }).query,
        ).toEqual({ kind: "Container", imageName: "nginx" });
      });

      it("keeps a stored id that is the id a variable without one would be drawn under, and draws that one under the next", () => {
        const firstDerivedId: string = pageIdsOf([
          withoutId(NAME_VARIABLE),
        ])[0]!;
        const stored: Array<JSONObject> = [
          withoutId({ ...IMAGE_VARIABLE, defaultValue: undefined }),
          { ...NAME_VARIABLE, id: firstDerivedId },
        ];
        const [imageId, nameId] = pageIdsOf(stored);

        expect(nameId).toBe(firstDerivedId);
        expect(imageId).not.toBe(firstDerivedId);
        expect(ObjectID.isValidUUID(imageId!)).toBe(true);

        expect(
          build({
            componentType: CONTAINERS,
            storedVariables: stored,
            requestedVariables: [{ id: firstDerivedId, selectedValue: "web" }],
          }).query,
        ).toEqual({ kind: "Container", name: "web" });

        expect(
          build({
            componentType: CONTAINERS,
            storedVariables: stored,
            requestedVariables: [{ id: imageId!, selectedValue: "redis" }],
          }).query,
        ).toEqual({ kind: "Container", imageName: "redis" });
      });

      it("applies a pick under a derived id through that variable's own key only", () => {
        const stored: Array<JSONObject> = [
          withoutId(NAME_VARIABLE),
          withoutId({ ...IMAGE_VARIABLE, defaultValue: undefined }),
        ];
        const [nameId, imageId] = pageIdsOf(stored);

        expect(nameId).not.toBe(imageId);
        expect(
          build({
            componentType: CONTAINERS,
            storedVariables: stored,
            requestedVariables: [{ id: nameId!, selectedValue: "redis" }],
          }).query,
        ).toEqual({ kind: "Container", name: "redis" });
        expect(
          build({
            componentType: CONTAINERS,
            storedVariables: stored,
            requestedVariables: [
              { id: imageId!, selectedValue: "web", selectedValues: [] },
            ],
          }).query,
        ).toEqual({ kind: "Container", imageName: "web" });
      });

      it("takes a label pick under a derived id only from that variable's own choices", () => {
        const teamLabel: string = ObjectID.generate().toString();
        const unitLabel: string = ObjectID.generate().toString();
        const stored: Array<JSONObject> = [
          {
            name: "TEAM",
            type: DashboardVariableType.ProjectLabel,
            labelOptions: [{ label: "Payments", value: teamLabel }],
          },
          {
            name: "UNIT",
            type: DashboardVariableType.ProjectLabel,
            labelOptions: [{ label: "Support", value: unitLabel }],
          },
        ];
        const [teamId, unitId] = pageIdsOf(stored);
        const monitorsBy: (
          requestedVariables: Array<JSONObject>,
        ) => () => PublicDashboardResourceListPolicyResult = (
          requestedVariables: Array<JSONObject>,
        ): (() => PublicDashboardResourceListPolicyResult) => {
          return (): PublicDashboardResourceListPolicyResult => {
            return build({
              componentType: DashboardComponentType.MonitorList,
              argumentsObject: { labelVariableId: teamId! },
              storedVariables: stored,
              requestedVariables,
            });
          };
        };

        expect(
          monitorsBy([{ id: teamId!, selectedValue: teamLabel }])().query,
        ).toEqual({ labels: new Includes([teamLabel]) });

        // The other variable's choice is no choice of this one.
        expect(
          outcomeOf(monitorsBy([{ id: teamId!, selectedValue: unitLabel }])),
        ).toBe(
          "refused: Choose up to 100 labels offered by this dashboard variable, or select All.",
        );

        // And the other variable's pick, under its own id, never reaches it.
        expect(
          monitorsBy([{ id: unitId!, selectedValue: unitLabel }])().query,
        ).toEqual({});
      });

      it("refuses an over-long or over-many selection under a derived id as under any other", () => {
        const stored: Array<JSONObject> = [withoutId(IMAGE_VARIABLE)];
        const [pageId] = pageIdsOf(stored);
        const values: (count: number) => Array<string> = (
          count: number,
        ): Array<string> => {
          return Array.from({ length: count }, (_: unknown, index: number) => {
            return `value-${index}`;
          });
        };

        const refusedSelections: Array<[string, Array<JSONObject>]> = [
          [
            "an over-long value",
            [{ id: pageId!, selectedValue: "x".repeat(1025) }],
          ],
          [
            "an over-long value in a list",
            [{ id: pageId!, selectedValues: ["x".repeat(1025)] }],
          ],
          ["too many values", [{ id: pageId!, selectedValues: values(101) }]],
          [
            "too many values in all",
            [
              { id: pageId!, selectedValues: values(67) },
              { id: "b", selectedValues: values(67) },
              { id: "c", selectedValues: values(67) },
            ],
          ],
          [
            "the same id twice",
            [
              { id: pageId!, selectedValue: "a" },
              { id: pageId!, selectedValue: "b" },
            ],
          ],
          [
            "too many selections",
            Array.from({ length: 51 }, (_: unknown, index: number) => {
              return {
                id: index === 0 ? pageId! : `v-${index}`,
                selectedValue: "v",
              };
            }),
          ],
          ["an over-long id", [{ id: "x".repeat(257), selectedValue: "v" }]],
          ["a value that is no text", [{ id: pageId!, selectedValue: 5 }]],
          ["values that are no list", [{ id: pageId!, selectedValues: "v" }]],
        ];

        for (const [name, requestedVariables] of refusedSelections) {
          expect([
            name,
            outcomeOf(() => {
              return build({
                componentType: CONTAINERS,
                storedVariables: stored,
                requestedVariables,
              });
            }).startsWith("refused: "),
          ]).toEqual([name, true]);
        }

        // At the limits, it is read.
        expect(
          build({
            componentType: CONTAINERS,
            storedVariables: stored,
            requestedVariables: [
              { id: pageId!, selectedValue: "x".repeat(1024) },
            ],
          }).query["imageName"],
        ).toBe("x".repeat(1024));
      });

      it("reads the picks of variables of other types for their bounds, and applies none of them", () => {
        expect(
          build({
            componentType: CONTAINERS,
            storedVariables: [
              {
                id: "environment",
                name: "Environment",
                type: DashboardVariableType.CustomList,
                attributeKey: "container.name",
                customListValues: "a,b",
              },
              IMAGE_VARIABLE,
            ],
            requestedVariables: [
              { id: "environment", selectedValue: "a" },
              { id: "image", selectedValue: "redis" },
            ],
          }).query,
        ).toEqual({ kind: "Container", imageName: "redis" });
      });

      it("refuses variables no page draws: an id that is no text, a shared id, a flag that is no flag, an over-long default or key", () => {
        const handed: Array<[string, Array<DashboardVariable>]> = [
          [
            "an id that is no text",
            [{ ...IMAGE_VARIABLE, id: 42 } as unknown as DashboardVariable],
          ],
          [
            "a shared id",
            [
              IMAGE_VARIABLE as unknown as DashboardVariable,
              { ...NAME_VARIABLE, id: "image" } as unknown as DashboardVariable,
            ],
          ],
          [
            "a flag that is no flag",
            [
              {
                ...IMAGE_VARIABLE,
                isMultiSelect: "true",
              } as unknown as DashboardVariable,
            ],
          ],
          [
            "an over-long default",
            [
              {
                ...IMAGE_VARIABLE,
                defaultValue: "x".repeat(1025),
              } as unknown as DashboardVariable,
            ],
          ],
          [
            "an over-long key",
            [
              {
                ...IMAGE_VARIABLE,
                attributeKey: "x".repeat(1025),
              } as unknown as DashboardVariable,
            ],
          ],
          [
            "an entry that is no variable",
            [null as unknown as DashboardVariable],
          ],
        ];

        for (const [name, variables] of handed) {
          expect([
            name,
            outcomeOf(() => {
              return PublicDashboardResourceListPolicy.build({
                widget: widget(CONTAINERS),
                variables,
                requestedVariables: [],
                requestedQuery: {},
              });
            }).startsWith("refused: "),
          ]).toEqual([name, true]);
        }
      });
    });

    /*
     * A widget saved without settings - before November 2024, or by hand -
     * or with settings that say none is drawn with `arguments: {}`: its
     * defaults, signed in and on the public page. The policy answers it with
     * those defaults too.
     */
    describe("a widget saved without settings", () => {
      const NO_SETTINGS: Array<[string, (stored: JSONObject) => JSONObject]> = [
        [
          "saved without arguments",
          (stored: JSONObject): JSONObject => {
            const copy: JSONObject = { ...stored };
            delete copy["arguments"];
            return copy;
          },
        ],
        [
          "with arguments null",
          (stored: JSONObject): JSONObject => {
            return { ...stored, arguments: null };
          },
        ],
        [
          "with arguments a number",
          (stored: JSONObject): JSONObject => {
            return { ...stored, arguments: 5 };
          },
        ],
        [
          "with arguments a list",
          (stored: JSONObject): JSONObject => {
            return { ...stored, arguments: [{ maxRows: 7 }] };
          },
        ],
        [
          "with arguments empty text",
          (stored: JSONObject): JSONObject => {
            return { ...stored, arguments: "  " };
          },
        ],
        [
          "with arguments encoded twice",
          (stored: JSONObject): JSONObject => {
            return {
              ...stored,
              arguments: JSON.stringify(JSON.stringify({ maxRows: 7 })),
            };
          },
        ],
        [
          "with arguments cut short",
          (stored: JSONObject): JSONObject => {
            return {
              ...stored,
              arguments: '{"maxRows": 7, "stateFilter": "res',
            };
          },
        ],
      ];

      const LIST_CASES: Array<MappingCase> = MAPPING_CASES.filter(
        (testCase: MappingCase, index: number): boolean => {
          return (
            testCase.componentType !== DashboardComponentType.Slo &&
            MAPPING_CASES.findIndex((other: MappingCase): boolean => {
              return other.componentType === testCase.componentType;
            }) === index
          );
        },
      );

      it.each(LIST_CASES)(
        "lists a $name widget saved without settings with its defaults, in every shape",
        (testCase: MappingCase) => {
          const defaults: PublicDashboardResourceListPolicyResult = build({
            componentType: testCase.componentType,
            argumentsObject: {},
            requestedQuery: testCase.requestedQuery,
          });

          for (const [shape, storeAs] of NO_SETTINGS) {
            const stored: JSONObject = storeAs({
              componentId: ObjectID.generate().toString(),
              componentType: testCase.componentType,
            });

            // The page draws it with no settings at all.
            expect([shape, drawnWidget(stored)["arguments"]]).toEqual([
              shape,
              {},
            ]);

            expect([
              shape,
              buildDrawn({
                storedWidget: stored,
                requestedQuery: testCase.requestedQuery,
              }),
            ]).toEqual([shape, defaults]);
          }

          expect(defaults.resourceType).toBe(testCase.resourceType);
        },
      );

      it("reads an SLO widget saved without settings as one with no SLO selected, as it is drawn", () => {
        for (const [shape, storeAs] of NO_SETTINGS) {
          expect([
            shape,
            outcomeOf(() => {
              return buildDrawn({
                storedWidget: storeAs({
                  componentId: ObjectID.generate().toString(),
                  componentType: DashboardComponentType.Slo,
                }),
              });
            }),
          ]).toEqual([
            shape,
            `refused: ${PUBLIC_SLO_WIDGET_NOT_CONFIGURED_MESSAGE}`,
          ]);
        }
      });

      it("still refuses a widget handed with arguments that are no object: the routes hand it only the widgets the page draws", () => {
        for (const widgetArguments of [undefined, null, "{}", 5, []]) {
          expect(
            outcomeOf(() => {
              return PublicDashboardResourceListPolicy.build({
                widget: {
                  componentType: DashboardComponentType.IncidentList,
                  arguments: widgetArguments as unknown as JSONObject,
                },
                variables: [],
                requestedVariables: [],
                requestedQuery: {},
              });
            }),
          ).toBe("refused: Dashboard widget arguments must be an object.");
        }
      });
    });

    /*
     * The page reads each widget deserialized: an ObjectID stored as
     * `{"_type": "ObjectID", "value": ...}` as that id, a query operator as
     * the operator, a date as the date - or, for a widget it cannot revive
     * (a malformed typed value anywhere in it), every value as its stored
     * JSON. Every setting the list and SLO policies read reads both forms
     * as the page does, in object arguments and in arguments written as
     * JSON text.
     */
    describe("typed values in a widget's settings", () => {
      type Encoding =
        | "object arguments"
        | "JSON-text arguments"
        | "object arguments, in a widget the page cannot revive"
        | "JSON-text arguments, in a widget the page cannot revive";

      const ENCODINGS: Array<Encoding> = [
        "object arguments",
        "JSON-text arguments",
        "object arguments, in a widget the page cannot revive",
        "JSON-text arguments, in a widget the page cannot revive",
      ];

      const isRevived: (encoding: Encoding) => boolean = (
        encoding: Encoding,
      ): boolean => {
        return !encoding.includes("cannot revive");
      };

      // Includes.fromJSON cannot iterate a number: the page draws such a widget from its stored JSON.
      const UNREVIVABLE: JSONObject = { _type: "Includes", value: 5 };

      const storedIn: (
        encoding: Encoding,
        componentType: string,
        widgetArguments: JSONObject,
      ) => JSONObject = (
        encoding: Encoding,
        componentType: string,
        widgetArguments: JSONObject,
      ): JSONObject => {
        const settings: JSONObject = isRevived(encoding)
          ? widgetArguments
          : { ...widgetArguments, unrelated: UNREVIVABLE };

        return {
          componentId: ObjectID.generate().toString(),
          componentType,
          arguments: encoding.startsWith("JSON-text")
            ? JSON.stringify(settings)
            : settings,
        };
      };

      const idJSON: (id: string) => JSONObject = (id: string): JSONObject => {
        return new ObjectID(id).toJSON();
      };

      const ID_LISTS: Array<{
        componentType: DashboardComponentType;
        key: string;
        requestedQuery?: JSONObject | undefined;
      }> = [
        {
          componentType: DashboardComponentType.IncidentList,
          key: "severityIds",
        },
        { componentType: DashboardComponentType.IncidentList, key: "stateIds" },
        {
          componentType: DashboardComponentType.IncidentList,
          key: "monitorIds",
        },
        { componentType: DashboardComponentType.IncidentList, key: "labelIds" },
        { componentType: DashboardComponentType.AlertList, key: "severityIds" },
        { componentType: DashboardComponentType.AlertList, key: "stateIds" },
        { componentType: DashboardComponentType.AlertList, key: "monitorIds" },
        { componentType: DashboardComponentType.AlertList, key: "labelIds" },
        {
          componentType: DashboardComponentType.MonitorList,
          key: "monitorStatusIds",
        },
        { componentType: DashboardComponentType.MonitorList, key: "labelIds" },
        {
          componentType: DashboardComponentType.NetworkMap,
          key: "networkSiteTypeIds",
        },
        {
          componentType: DashboardComponentType.KubernetesPodList,
          key: "kubernetesClusterIds",
        },
        {
          componentType: DashboardComponentType.KubernetesNodeList,
          key: "kubernetesClusterIds",
        },
        {
          componentType: DashboardComponentType.DockerContainerList,
          key: "dockerHostIds",
        },
        {
          componentType: DashboardComponentType.DockerImageList,
          key: "dockerHostIds",
        },
        {
          componentType: DashboardComponentType.DockerVolumeList,
          key: "dockerHostIds",
        },
        {
          componentType: DashboardComponentType.PodmanContainerList,
          key: "podmanHostIds",
        },
        {
          componentType: DashboardComponentType.PodmanNetworkList,
          key: "podmanHostIds",
        },
        {
          componentType: DashboardComponentType.ProxmoxNodeList,
          key: "proxmoxClusterIds",
        },
        {
          componentType: DashboardComponentType.ProxmoxGuestList,
          key: "proxmoxClusterIds",
        },
        {
          componentType: DashboardComponentType.VMwareHostList,
          key: "vmwareVCenterIds",
        },
        {
          componentType: DashboardComponentType.VMwareVirtualMachineList,
          key: "vmwareVCenterIds",
        },
        {
          componentType: DashboardComponentType.CephOsdList,
          key: "cephClusterIds",
        },
        {
          componentType: DashboardComponentType.CephPoolList,
          key: "cephClusterIds",
        },
        {
          componentType: DashboardComponentType.StorageArrayVolumeList,
          key: "storageArrayIds",
        },
        {
          componentType: DashboardComponentType.StorageArrayHardwareList,
          key: "storageArrayIds",
        },
        {
          componentType: DashboardComponentType.DockerSwarmNodeList,
          key: "dockerSwarmClusterIds",
        },
        {
          componentType: DashboardComponentType.DockerSwarmServiceList,
          key: "dockerSwarmClusterIds",
        },
        { componentType: DashboardComponentType.SloList, key: "labelIds" },
      ];

      it.each(ID_LISTS)(
        "filters a $componentType by its $key stored as ObjectIDs exactly as by the same ids stored as text, in every encoding",
        (testCase: { componentType: DashboardComponentType; key: string }) => {
          const ids: Array<string> = [
            ObjectID.generate().toString(),
            ObjectID.generate().toString(),
          ];
          const asText: PublicDashboardResourceListPolicyResult = build({
            componentType: testCase.componentType,
            argumentsObject: { [testCase.key]: ids },
          });

          // Not vacuous: the ids are in the query.
          expect(JSON.stringify(asText.query)).toContain(ids[1]!);

          for (const encoding of ENCODINGS) {
            const stored: JSONObject = storedIn(
              encoding,
              testCase.componentType,
              { [testCase.key]: ids.map(idJSON) },
            );
            const held: Array<unknown> = (
              drawnWidget(stored)["arguments"] as JSONObject
            )[testCase.key] as Array<unknown>;

            /*
             * The page holds them as the ids they name, in text, whether it
             * revived the widget or draws it from its stored JSON - as every
             * board reads them (DashboardWidgetIds, issue #6328).
             */
            expect([encoding, held]).toEqual([encoding, ids]);

            expect([encoding, buildDrawn({ storedWidget: stored })]).toEqual([
              encoding,
              asText,
            ]);
          }
        },
      );

      interface TypedValueCase {
        reader: string;
        componentType: DashboardComponentType;
        key: string;
        // Other settings the widget needs to reach the reader.
        settings?: JSONObject | undefined;
        requestedQuery?: JSONObject | undefined;
        values: Array<[string, unknown]>;
        // The refusal, or "as unset": read as the widget saved without the setting.
        outcome: string;
      }

      const DATE: unknown = OneUptimeDate.toJSON(
        new Date("2026-11-08T00:00:00.000Z"),
      );
      const OPERATOR: unknown = new Includes([
        ObjectID.generate().toString(),
      ]).toJSON();
      const SEARCH: unknown = new Search("status:desc").toJSON();
      const ID: unknown = ObjectID.generate().toJSON();

      const TYPED_VALUES: Array<[string, unknown]> = [
        ["an ObjectID", ID],
        ["a query operator", OPERATOR],
        ["a search", SEARCH],
        ["a date", DATE],
      ];

      /*
       * An id setting reads an ObjectID as the id it names, as every board
       * does (issue #6328, pinned below); every other typed value names no
       * id, and is refused as before.
       */
      const NO_ID_TYPED_VALUES: Array<[string, unknown]> = TYPED_VALUES.filter(
        ([name]: [string, unknown]): boolean => {
          return name !== "an ObjectID";
        },
      );

      const TYPED_VALUE_CASES: Array<TypedValueCase> = [
        {
          reader: "a list of ids, as a whole",
          componentType: DashboardComponentType.IncidentList,
          key: "severityIds",
          values: TYPED_VALUES,
          outcome: "refused: Dashboard widget severityIds must be an array.",
        },
        {
          reader: "a value in a list of ids",
          componentType: DashboardComponentType.IncidentList,
          key: "severityIds",
          values: [
            ["a query operator", [OPERATOR]],
            ["a search", [SEARCH]],
            ["a date", [DATE]],
            ["an ObjectID with no text", [{ _type: "ObjectID", value: 5 }]],
            ["an ObjectID with no id", [{ _type: "ObjectID", value: "" }]],
            ["an id with no type", [{ value: ObjectID.generate().toString() }]],
          ],
          outcome:
            "refused: Dashboard widget severityIds contains an invalid value.",
        },
        {
          reader: "a choice",
          componentType: DashboardComponentType.IncidentList,
          key: "stateFilter",
          values: TYPED_VALUES,
          outcome: "refused: Dashboard widget stateFilter is invalid.",
        },
        {
          reader: "a choice of a log stream",
          componentType: DashboardComponentType.LogStream,
          key: "severityFilter",
          requestedQuery: { time: range() },
          values: TYPED_VALUES,
          outcome: "refused: Dashboard widget severityFilter is invalid.",
        },
        {
          reader: "a text",
          componentType: DashboardComponentType.DockerContainerList,
          key: "imageName",
          values: TYPED_VALUES,
          outcome: "refused: Dashboard widget imageName must be a string.",
        },
        {
          reader: "the text of a log stream",
          componentType: DashboardComponentType.LogStream,
          key: "bodyContains",
          requestedQuery: { time: range() },
          values: TYPED_VALUES,
          outcome: "refused: Dashboard widget bodyContains must be a string.",
        },
        {
          reader: "the label variable a list follows",
          componentType: DashboardComponentType.MonitorList,
          key: "labelVariableId",
          values: NO_ID_TYPED_VALUES,
          outcome:
            "refused: Dashboard widget labelVariableId must be a string.",
        },
        {
          reader: "an SLO list's statuses",
          componentType: DashboardComponentType.SloList,
          key: "sloStatuses",
          values: TYPED_VALUES.map(
            ([name, value]: [string, unknown]): [string, unknown] => {
              return [name, [value]];
            },
          ),
          outcome:
            "refused: Dashboard widget sloStatuses contains an invalid value.",
        },
        {
          reader: "a row cap",
          componentType: DashboardComponentType.IncidentList,
          key: "maxRows",
          values: [
            ...TYPED_VALUES,
            ["a value greater than", { _type: "GreaterThan", value: 5 }],
          ],
          outcome: "as unset",
        },
        {
          reader: "a map's site cap",
          componentType: DashboardComponentType.NetworkMap,
          key: "maxSites",
          values: TYPED_VALUES,
          outcome: "as unset",
        },
        {
          reader: "a list's own sort",
          componentType: DashboardComponentType.MonitorList,
          key: "sort",
          values: TYPED_VALUES,
          outcome: "as unset",
        },
        {
          reader: "the SLO a widget pins",
          componentType: DashboardComponentType.Slo,
          key: "serviceLevelObjectiveId",
          values: NO_ID_TYPED_VALUES,
          outcome: `refused: ${PUBLIC_SLO_WIDGET_NOT_CONFIGURED_MESSAGE}`,
        },
        {
          reader: "the variable an SLO widget follows",
          componentType: DashboardComponentType.Slo,
          key: "serviceLevelObjectiveVariableId",
          values: NO_ID_TYPED_VALUES,
          outcome:
            "refused: Dashboard widget serviceLevelObjectiveVariableId is invalid.",
        },
        {
          reader: "an SLO widget's series",
          componentType: DashboardComponentType.Slo,
          key: "sloMetric",
          settings: { serviceLevelObjectiveId: SLO_ID.toString() },
          values: TYPED_VALUES,
          outcome: "refused: Dashboard widget sloMetric is invalid.",
        },
        {
          reader: "an SLO widget's display",
          componentType: DashboardComponentType.Slo,
          key: "displayType",
          settings: { serviceLevelObjectiveId: SLO_ID.toString() },
          values: TYPED_VALUES,
          outcome: "refused: Dashboard widget displayType is invalid.",
        },
      ];

      it.each(TYPED_VALUE_CASES)(
        "reads a typed value in $reader ($key) as its JSON is read, in every encoding",
        (testCase: TypedValueCase) => {
          const unset: string = outcomeOf(() => {
            return build({
              componentType: testCase.componentType,
              argumentsObject: testCase.settings || {},
              requestedQuery: testCase.requestedQuery,
            });
          });

          for (const [valueName, value] of testCase.values) {
            for (const encoding of ENCODINGS) {
              const stored: JSONObject = storedIn(
                encoding,
                testCase.componentType,
                {
                  ...(testCase.settings || {}),
                  [testCase.key]: value as JSONObject,
                },
              );
              const outcome: string = outcomeOf(() => {
                return buildDrawn({
                  storedWidget: stored,
                  requestedQuery: testCase.requestedQuery,
                });
              });

              expect([valueName, encoding, outcome]).toEqual([
                valueName,
                encoding,
                testCase.outcome === "as unset" ? unset : testCase.outcome,
              ]);

              if (testCase.outcome === "as unset") {
                expect([
                  valueName,
                  encoding,
                  buildDrawn({ storedWidget: stored }),
                ]).toEqual([
                  valueName,
                  encoding,
                  build({ componentType: testCase.componentType }),
                ]);
              }
            }
          }
        },
      );

      it("reads a row cap stored as a date as none - Number() of a date is its time in milliseconds - and a row cap written as text as the number it says", () => {
        for (const encoding of ENCODINGS) {
          expect([
            encoding,
            buildDrawn({
              storedWidget: storedIn(
                encoding,
                DashboardComponentType.IncidentList,
                {
                  maxRows: DATE as JSONObject,
                },
              ),
            }).limit,
          ]).toEqual([encoding, 25]);

          expect([
            encoding,
            buildDrawn({
              storedWidget: storedIn(
                encoding,
                DashboardComponentType.NetworkMap,
                {
                  maxSites: DATE as JSONObject,
                },
              ),
            }).limit,
          ]).toEqual([encoding, 251]);

          expect([
            encoding,
            buildDrawn({
              storedWidget: storedIn(
                encoding,
                DashboardComponentType.IncidentList,
                {
                  maxRows: " 13 ",
                },
              ),
            }).limit,
          ]).toEqual([encoding, 13]);
        }

        // As a date revives: the time in milliseconds is far past the ceiling.
        expect(Number(new Date("2026-11-08T00:00:00.000Z"))).toBeGreaterThan(
          LIMIT_PER_PROJECT,
        );
      });

      it("reads a list's own sort written as text in JSON-text arguments as in object arguments", () => {
        for (const encoding of ENCODINGS) {
          expect([
            encoding,
            buildDrawn({
              storedWidget: storedIn(
                encoding,
                DashboardComponentType.MonitorList,
                {
                  sort: "status:desc",
                },
              ),
            }).sortChoice,
          ]).toEqual([encoding, { column: "status", direction: "desc" }]);
        }
      });

      it("pins an SLO widget's SLO stored as text in every encoding", () => {
        for (const encoding of ENCODINGS) {
          expect([
            encoding,
            buildDrawn({
              storedWidget: storedIn(encoding, DashboardComponentType.Slo, {
                serviceLevelObjectiveId: SLO_ID.toString(),
              }),
            }).query,
          ]).toEqual([encoding, { _id: SLO_ID }]);
        }
      });

      /*
       * Issue #6328: an SLO, or the variable a widget follows, stored as an
       * ObjectID is read as the id it names. The page now draws that SLO,
       * signed in and public alike, so the policy reads it as it reads the
       * same id stored as text - whether the page revived it or draws the
       * widget from its stored JSON.
       */
      it("pins an SLO widget's SLO stored as an ObjectID exactly as stored as text, in every encoding", () => {
        for (const encoding of ENCODINGS) {
          expect([
            encoding,
            buildDrawn({
              storedWidget: storedIn(encoding, DashboardComponentType.Slo, {
                serviceLevelObjectiveId: idJSON(SLO_ID.toString()),
              }),
            }).query,
          ]).toEqual([encoding, { _id: SLO_ID }]);

          // Called with the stored settings themselves, revived or not.
          for (const storedId of [
            SLO_ID,
            idJSON(SLO_ID.toString()),
            ` ${SLO_ID.toString()} `,
          ]) {
            expect([
              encoding,
              String(storedId),
              PublicDashboardResourceListPolicy.build({
                widget: {
                  componentType: DashboardComponentType.Slo,
                  arguments: {
                    serviceLevelObjectiveId: storedId as unknown as JSONObject,
                  },
                },
                variables: [],
                requestedVariables: [],
                requestedQuery: {},
              }).query,
            ]).toEqual([encoding, String(storedId), { _id: SLO_ID }]);
          }
        }
      });

      it("follows the label variable a list names by an ObjectID exactly as by its id in text, in every encoding", () => {
        const labelId: string = ObjectID.generate().toString();
        const labelVariable: JSONObject = {
          id: "unit",
          name: "unit",
          type: DashboardVariableType.ProjectLabel,
          labelOptions: [{ label: "Payments", value: labelId }],
          defaultValue: labelId,
        };

        for (const componentType of [
          DashboardComponentType.MonitorList,
          DashboardComponentType.SloList,
        ]) {
          const asText: PublicDashboardResourceListPolicyResult = build({
            componentType,
            argumentsObject: { labelVariableId: "unit" },
            storedVariables: [labelVariable],
          });

          // Not vacuous: the variable's pick filters the list.
          expect(JSON.stringify(asText.query)).toContain(labelId);

          for (const encoding of ENCODINGS) {
            expect([
              componentType,
              encoding,
              buildDrawn({
                storedWidget: storedIn(encoding, componentType, {
                  labelVariableId: { _type: "ObjectID", value: "unit" },
                }),
                storedVariables: [labelVariable],
              }),
            ]).toEqual([componentType, encoding, asText]);
          }

          // Called with the stored settings themselves, revived or not.
          for (const storedId of [
            new ObjectID("unit"),
            { _type: "ObjectID", value: "unit" },
          ]) {
            expect([
              componentType,
              String(storedId),
              PublicDashboardResourceListPolicy.build({
                widget: {
                  componentType,
                  arguments: {
                    labelVariableId: storedId as unknown as JSONObject,
                  },
                },
                variables: drawnVariables([labelVariable]),
                requestedVariables: [],
                requestedQuery: {},
              }),
            ]).toEqual([componentType, String(storedId), asText]);
          }
        }
      });

      it("follows the variable an SLO widget names by an ObjectID exactly as by its id in text, in every encoding", () => {
        const sloVariable: JSONObject = {
          id: "slo",
          name: "slo",
          type: DashboardVariableType.TelemetryAttribute,
          attributeKey: "sloName",
          defaultValue: "Checkout",
        };

        const asText: string = outcomeOf(() => {
          return build({
            componentType: DashboardComponentType.Slo,
            argumentsObject: { serviceLevelObjectiveVariableId: "slo" },
            storedVariables: [sloVariable],
          });
        });

        // Not vacuous: the widget follows the variable's pick.
        expect(asText).toBe("lists slo");

        for (const encoding of ENCODINGS) {
          expect([
            encoding,
            outcomeOf(() => {
              return buildDrawn({
                storedWidget: storedIn(encoding, DashboardComponentType.Slo, {
                  serviceLevelObjectiveVariableId: {
                    _type: "ObjectID",
                    value: "slo",
                  },
                }),
                storedVariables: [sloVariable],
              });
            }),
          ]).toEqual([encoding, asText]);
        }

        // Called with the stored settings themselves, revived or not.
        for (const storedId of [
          new ObjectID("slo"),
          { _type: "ObjectID", value: "slo" },
        ]) {
          expect([
            String(storedId),
            outcomeOf(() => {
              return PublicDashboardResourceListPolicy.build({
                widget: {
                  componentType: DashboardComponentType.Slo,
                  arguments: {
                    serviceLevelObjectiveVariableId:
                      storedId as unknown as JSONObject,
                  },
                },
                variables: drawnVariables([sloVariable]),
                requestedVariables: [],
                requestedQuery: {},
              });
            }),
          ]).toEqual([String(storedId), asText]);
        }
      });
    });
  });
});

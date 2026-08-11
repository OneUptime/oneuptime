import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import {
  LogFilter,
  queryStringToFilter,
} from "../../../Types/Log/LogQueryToFilter";
import DashboardModelQueryInterpolation, {
  AttributeToColumnMap,
} from "../../../Utils/Dashboard/ModelQueryVariableInterpolation";
import DashboardVariableInterpolation from "../../../Utils/Dashboard/VariableInterpolation";

export interface PublicDashboardResourceListPolicyResult {
  resourceType: string;
  query: JSONObject;
  select: JSONObject;
  sort: JSONObject;
  limit: number;
}

export interface BuildPublicDashboardResourceListPolicyData {
  widget: JSONObject;
  dashboardViewConfig: unknown;
  requestedVariables: unknown;
  requestedQuery: unknown;
}

interface PolicyDraft {
  resourceType: string;
  query: Record<string, unknown>;
  sort: JSONObject;
  limit: number;
  attributeToColumn?: AttributeToColumnMap | undefined;
  interpolateAttributeMap?: boolean | undefined;
}

const DEFAULT_LIST_LIMIT: number = 25;
const DEFAULT_TELEMETRY_LIMIT: number = 50;
const DEFAULT_NETWORK_MAP_MAX_SITES: number = 250;

/*
 * These bounds are deliberately much smaller than the request-body limit.
 * Variable values can become IN-list parameters, so a public request must not
 * be able to turn one dashboard refresh into an unbounded query compilation.
 */
const MAX_REQUESTED_VARIABLES: number = 50;
const MAX_SELECTED_VALUES_PER_VARIABLE: number = 100;
const MAX_TOTAL_SELECTED_VALUES: number = 200;
const MAX_VARIABLE_ID_LENGTH: number = 256;
const MAX_VARIABLE_VALUE_LENGTH: number = 1024;

const HOST_ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  "host.name": "name",
  "host.id": "hostIdentifier",
  "resource.host.name": "name",
  "resource.host.id": "hostIdentifier",
};

const CONTAINER_ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  "container.name": "name",
  "container.image.name": "imageName",
};

const IMAGE_ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  "container.image.name": "name",
};

const HOST_NAME_ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  "host.name": "name",
};

const KUBERNETES_POD_ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  "k8s.pod.name": "name",
  "k8s.namespace.name": "namespaceKey",
  "resource.k8s.pod.name": "name",
  "resource.k8s.namespace.name": "namespaceKey",
};

const KUBERNETES_NODE_ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  "k8s.node.name": "name",
  "resource.k8s.node.name": "name",
};

const KUBERNETES_NAMESPACE_ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  "k8s.namespace.name": "name",
  "resource.k8s.namespace.name": "name",
};

const KUBERNETES_DEPLOYMENT_ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  "k8s.deployment.name": "name",
  "k8s.namespace.name": "namespaceKey",
  "resource.k8s.deployment.name": "name",
  "resource.k8s.namespace.name": "namespaceKey",
};

const KUBERNETES_STATEFUL_SET_ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  "k8s.statefulset.name": "name",
  "k8s.namespace.name": "namespaceKey",
  "resource.k8s.statefulset.name": "name",
  "resource.k8s.namespace.name": "namespaceKey",
};

const KUBERNETES_DAEMON_SET_ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  "k8s.daemonset.name": "name",
  "k8s.namespace.name": "namespaceKey",
  "resource.k8s.daemonset.name": "name",
  "resource.k8s.namespace.name": "namespaceKey",
};

const KUBERNETES_JOB_ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  "k8s.job.name": "name",
  "k8s.namespace.name": "namespaceKey",
  "resource.k8s.job.name": "name",
  "resource.k8s.namespace.name": "namespaceKey",
};

const KUBERNETES_CRON_JOB_ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  "k8s.cronjob.name": "name",
  "k8s.namespace.name": "namespaceKey",
  "resource.k8s.cronjob.name": "name",
  "resource.k8s.namespace.name": "namespaceKey",
};

const PROXMOX_NODE_ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  "pve.id": "name",
};

const CEPH_OSD_ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  ceph_daemon: "externalId",
};

const CEPH_POOL_ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  pool_id: "externalId",
};

/*
 * Produces the complete server-owned policy for one already-selected public
 * dashboard widget. No caller-supplied project, kind, filter, sort, or limit is
 * copied. The route adds the dashboard's projectId after this policy returns.
 */
export default class PublicDashboardResourceListPolicy {
  public static build(
    data: BuildPublicDashboardResourceListPolicyData,
  ): PublicDashboardResourceListPolicyResult {
    const widget: Record<string, unknown> =
      PublicDashboardResourceListPolicy.requireObject(
        data.widget,
        "Dashboard widget",
      );
    const argumentsObject: Record<string, unknown> =
      PublicDashboardResourceListPolicy.requireObject(
        widget["arguments"],
        "Dashboard widget arguments",
      );

    const componentType: unknown = widget["componentType"];
    if (typeof componentType !== "string" || componentType.length === 0) {
      throw new BadDataException("Dashboard widget has no component type.");
    }

    const variables: Array<DashboardVariable> =
      PublicDashboardResourceListPolicy.resolveDashboardVariableSelections({
        dashboardViewConfig: data.dashboardViewConfig,
        requestedVariables: data.requestedVariables,
      });

    const draft: PolicyDraft = PublicDashboardResourceListPolicy.buildDraft({
      componentType: componentType as DashboardComponentType,
      argumentsObject,
      requestedQuery: data.requestedQuery,
    });

    let query: Record<string, unknown> = draft.query;

    if (draft.attributeToColumn) {
      query = DashboardModelQueryInterpolation.applyToQuery(
        query,
        variables,
        draft.attributeToColumn,
      );
    }

    if (draft.interpolateAttributeMap) {
      const currentAttributes: unknown = query["attributes"];
      const baseAttributes: Record<string, unknown> | undefined =
        currentAttributes === undefined
          ? undefined
          : PublicDashboardResourceListPolicy.requireObject(
              currentAttributes,
              "Log attributes filter",
            );
      const interpolatedAttributes: Record<string, unknown> =
        DashboardVariableInterpolation.applyToAttributes(
          baseAttributes,
          variables,
        );

      if (Object.keys(interpolatedAttributes).length > 0) {
        query["attributes"] = interpolatedAttributes;
      } else {
        delete query["attributes"];
      }
    }

    return {
      resourceType: draft.resourceType,
      query: query as JSONObject,
      select: PublicDashboardResourceListPolicy.selectForComponent(
        componentType as DashboardComponentType,
      ),
      sort: draft.sort,
      limit: draft.limit,
    };
  }

  /*
   * Public list responses are projected to the fields consumed by the exact
   * stored widget. Resource models shared by several widget kinds must never
   * inherit a union of their siblings' fields.
   */
  private static selectForComponent(
    componentType: DashboardComponentType,
  ): JSONObject {
    switch (componentType) {
      case DashboardComponentType.IncidentList:
        return {
          _id: true,
          title: true,
          createdAt: true,
          currentIncidentState: { name: true, color: true },
          incidentSeverity: { name: true, color: true },
        };
      case DashboardComponentType.AlertList:
        return {
          _id: true,
          title: true,
          createdAt: true,
          currentAlertState: { name: true, color: true },
          alertSeverity: { name: true, color: true },
        };
      case DashboardComponentType.MonitorList:
        return {
          _id: true,
          name: true,
          monitorType: true,
          currentMonitorStatus: { name: true, color: true },
        };
      case DashboardComponentType.NetworkMap:
        return {
          _id: true,
          name: true,
          networkSiteType: { name: true },
          latitude: true,
          longitude: true,
          currentMonitorStatus: {
            name: true,
            color: true,
            priority: true,
            isOperationalState: true,
          },
        };
      case DashboardComponentType.HostList:
        return {
          _id: true,
          name: true,
          otelCollectorStatus: true,
          osType: true,
          osVersion: true,
          cpuCores: true,
          totalMemoryBytes: true,
          lastSeenAt: true,
        };
      case DashboardComponentType.KubernetesPodList:
        return {
          _id: true,
          name: true,
          namespaceKey: true,
          phase: true,
          kubernetesClusterId: true,
          kubernetesCluster: { name: true },
        };
      case DashboardComponentType.KubernetesNodeList:
        return {
          _id: true,
          name: true,
          namespaceKey: true,
          isReady: true,
          hasMemoryPressure: true,
          hasDiskPressure: true,
          hasPidPressure: true,
          kubernetesClusterId: true,
          kubernetesCluster: { name: true },
        };
      case DashboardComponentType.KubernetesNamespaceList:
        return {
          _id: true,
          name: true,
          phase: true,
          kubernetesClusterId: true,
          kubernetesCluster: { name: true },
        };
      case DashboardComponentType.KubernetesDeploymentList:
      case DashboardComponentType.KubernetesStatefulSetList:
      case DashboardComponentType.KubernetesDaemonSetList:
      case DashboardComponentType.KubernetesJobList:
      case DashboardComponentType.KubernetesCronJobList:
        return {
          _id: true,
          name: true,
          namespaceKey: true,
          isReady: true,
          kubernetesClusterId: true,
          kubernetesCluster: { name: true },
        };
      case DashboardComponentType.DockerHostList:
      case DashboardComponentType.PodmanHostList:
        return {
          _id: true,
          name: true,
          otelCollectorStatus: true,
          containersRunning: true,
          containersStopped: true,
          containersPaused: true,
          osType: true,
          osVersion: true,
        };
      case DashboardComponentType.DockerContainerList:
        return {
          _id: true,
          name: true,
          imageName: true,
          state: true,
          latestCpuPercent: true,
          latestMemoryBytes: true,
          dockerHostId: true,
          dockerHost: { name: true },
        };
      case DashboardComponentType.DockerImageList:
        return {
          _id: true,
          name: true,
          containerId: true,
          dockerHost: { name: true },
        };
      case DashboardComponentType.DockerNetworkList:
      case DashboardComponentType.DockerVolumeList:
        return {
          _id: true,
          name: true,
          state: true,
          dockerHost: { name: true },
        };
      case DashboardComponentType.PodmanContainerList:
        return {
          _id: true,
          name: true,
          imageName: true,
          state: true,
          latestCpuPercent: true,
          latestMemoryBytes: true,
          podmanHostId: true,
          podmanHost: { name: true },
        };
      case DashboardComponentType.PodmanImageList:
        return {
          _id: true,
          name: true,
          containerId: true,
          podmanHost: { name: true },
        };
      case DashboardComponentType.PodmanNetworkList:
      case DashboardComponentType.PodmanVolumeList:
        return {
          _id: true,
          name: true,
          state: true,
          podmanHost: { name: true },
        };
      case DashboardComponentType.ProxmoxNodeList:
        return {
          _id: true,
          name: true,
          externalId: true,
          isUp: true,
          latestCpuPercent: true,
          latestMemoryPercent: true,
          proxmoxClusterId: true,
          proxmoxCluster: { name: true },
        };
      case DashboardComponentType.ProxmoxGuestList:
        return {
          _id: true,
          name: true,
          externalId: true,
          vmid: true,
          guestType: true,
          parentNodeName: true,
          isUp: true,
          haState: true,
          proxmoxClusterId: true,
          proxmoxCluster: { name: true },
        };
      case DashboardComponentType.CephOsdList:
        return {
          _id: true,
          name: true,
          externalId: true,
          hostname: true,
          deviceClass: true,
          isUp: true,
          isIn: true,
          statBytes: true,
          statBytesUsed: true,
          cephClusterId: true,
          cephCluster: { name: true },
        };
      case DashboardComponentType.CephPoolList:
        return {
          _id: true,
          name: true,
          externalId: true,
          storedBytes: true,
          maxAvailBytes: true,
          objects: true,
          cephClusterId: true,
          cephCluster: { name: true },
        };
      case DashboardComponentType.DockerSwarmNodeList:
        return {
          _id: true,
          name: true,
          externalId: true,
          role: true,
          state: true,
          isReady: true,
          latestCpuPercent: true,
          latestMemoryPercent: true,
          dockerSwarmClusterId: true,
          dockerSwarmCluster: { name: true },
        };
      case DashboardComponentType.DockerSwarmServiceList:
        return {
          _id: true,
          name: true,
          externalId: true,
          serviceMode: true,
          desiredReplicas: true,
          runningReplicas: true,
          image: true,
          isReady: true,
          dockerSwarmClusterId: true,
          dockerSwarmCluster: { name: true },
        };
      case DashboardComponentType.TraceList:
        return {
          startTime: true,
          name: true,
          statusCode: true,
          durationUnixNano: true,
        };
      case DashboardComponentType.LogStream:
        return {
          time: true,
          severityText: true,
          body: true,
        };
      default:
        throw new BadDataException(
          "This dashboard widget cannot list public resources.",
        );
    }
  }

  private static buildDraft(data: {
    componentType: DashboardComponentType;
    argumentsObject: Record<string, unknown>;
    requestedQuery: unknown;
  }): PolicyDraft {
    const { componentType, argumentsObject, requestedQuery } = data;

    switch (componentType) {
      case DashboardComponentType.IncidentList:
        return PublicDashboardResourceListPolicy.buildIncidentPolicy(
          argumentsObject,
        );
      case DashboardComponentType.AlertList:
        return PublicDashboardResourceListPolicy.buildAlertPolicy(
          argumentsObject,
        );
      case DashboardComponentType.MonitorList:
        return PublicDashboardResourceListPolicy.buildMonitorPolicy(
          argumentsObject,
        );
      case DashboardComponentType.NetworkMap:
        return PublicDashboardResourceListPolicy.buildNetworkMapPolicy(
          argumentsObject,
        );
      case DashboardComponentType.HostList:
        return PublicDashboardResourceListPolicy.buildHostPolicy(
          argumentsObject,
        );
      case DashboardComponentType.KubernetesPodList:
        return PublicDashboardResourceListPolicy.buildKubernetesPolicy({
          argumentsObject,
          kind: "Pod",
          attributeToColumn: KUBERNETES_POD_ATTRIBUTE_TO_COLUMN,
          includeNamespaces: true,
          componentType,
        });
      case DashboardComponentType.KubernetesNodeList:
        return PublicDashboardResourceListPolicy.buildKubernetesPolicy({
          argumentsObject,
          kind: "Node",
          attributeToColumn: KUBERNETES_NODE_ATTRIBUTE_TO_COLUMN,
          includeNamespaces: false,
          componentType,
        });
      case DashboardComponentType.KubernetesNamespaceList:
        return PublicDashboardResourceListPolicy.buildKubernetesPolicy({
          argumentsObject,
          kind: "Namespace",
          attributeToColumn: KUBERNETES_NAMESPACE_ATTRIBUTE_TO_COLUMN,
          includeNamespaces: false,
          componentType,
        });
      case DashboardComponentType.KubernetesDeploymentList:
        return PublicDashboardResourceListPolicy.buildKubernetesPolicy({
          argumentsObject,
          kind: "Deployment",
          attributeToColumn: KUBERNETES_DEPLOYMENT_ATTRIBUTE_TO_COLUMN,
          includeNamespaces: true,
          componentType,
        });
      case DashboardComponentType.KubernetesStatefulSetList:
        return PublicDashboardResourceListPolicy.buildKubernetesPolicy({
          argumentsObject,
          kind: "StatefulSet",
          attributeToColumn: KUBERNETES_STATEFUL_SET_ATTRIBUTE_TO_COLUMN,
          includeNamespaces: true,
          componentType,
        });
      case DashboardComponentType.KubernetesDaemonSetList:
        return PublicDashboardResourceListPolicy.buildKubernetesPolicy({
          argumentsObject,
          kind: "DaemonSet",
          attributeToColumn: KUBERNETES_DAEMON_SET_ATTRIBUTE_TO_COLUMN,
          includeNamespaces: true,
          componentType,
        });
      case DashboardComponentType.KubernetesJobList:
        return PublicDashboardResourceListPolicy.buildKubernetesPolicy({
          argumentsObject,
          kind: "Job",
          attributeToColumn: KUBERNETES_JOB_ATTRIBUTE_TO_COLUMN,
          includeNamespaces: true,
          componentType,
        });
      case DashboardComponentType.KubernetesCronJobList:
        return PublicDashboardResourceListPolicy.buildKubernetesPolicy({
          argumentsObject,
          kind: "CronJob",
          attributeToColumn: KUBERNETES_CRON_JOB_ATTRIBUTE_TO_COLUMN,
          includeNamespaces: true,
          componentType,
        });
      case DashboardComponentType.DockerHostList:
        return PublicDashboardResourceListPolicy.buildContainerHostPolicy({
          argumentsObject,
          resourceType: "docker-host",
        });
      case DashboardComponentType.DockerContainerList:
        return PublicDashboardResourceListPolicy.buildContainerPolicy({
          argumentsObject,
          resourceType: "docker-container",
          hostIdKey: "dockerHostId",
          storedHostIdsKey: "dockerHostIds",
        });
      case DashboardComponentType.DockerImageList:
        return PublicDashboardResourceListPolicy.buildImagePolicy({
          argumentsObject,
          resourceType: "docker-image",
          hostIdKey: "dockerHostId",
          storedHostIdsKey: "dockerHostIds",
        });
      case DashboardComponentType.DockerNetworkList:
        return PublicDashboardResourceListPolicy.buildContainerInventoryPolicy({
          argumentsObject,
          resourceType: "docker-network",
          kind: "Network",
          hostIdKey: "dockerHostId",
          storedHostIdsKey: "dockerHostIds",
        });
      case DashboardComponentType.DockerVolumeList:
        return PublicDashboardResourceListPolicy.buildContainerInventoryPolicy({
          argumentsObject,
          resourceType: "docker-volume",
          kind: "Volume",
          hostIdKey: "dockerHostId",
          storedHostIdsKey: "dockerHostIds",
        });
      case DashboardComponentType.PodmanHostList:
        return PublicDashboardResourceListPolicy.buildContainerHostPolicy({
          argumentsObject,
          resourceType: "podman-host",
        });
      case DashboardComponentType.PodmanContainerList:
        return PublicDashboardResourceListPolicy.buildContainerPolicy({
          argumentsObject,
          resourceType: "podman-container",
          hostIdKey: "podmanHostId",
          storedHostIdsKey: "podmanHostIds",
        });
      case DashboardComponentType.PodmanImageList:
        return PublicDashboardResourceListPolicy.buildImagePolicy({
          argumentsObject,
          resourceType: "podman-image",
          hostIdKey: "podmanHostId",
          storedHostIdsKey: "podmanHostIds",
        });
      case DashboardComponentType.PodmanNetworkList:
        return PublicDashboardResourceListPolicy.buildContainerInventoryPolicy({
          argumentsObject,
          resourceType: "podman-network",
          kind: "Network",
          hostIdKey: "podmanHostId",
          storedHostIdsKey: "podmanHostIds",
        });
      case DashboardComponentType.PodmanVolumeList:
        return PublicDashboardResourceListPolicy.buildContainerInventoryPolicy({
          argumentsObject,
          resourceType: "podman-volume",
          kind: "Volume",
          hostIdKey: "podmanHostId",
          storedHostIdsKey: "podmanHostIds",
        });
      case DashboardComponentType.ProxmoxNodeList:
        return PublicDashboardResourceListPolicy.buildProxmoxNodePolicy(
          argumentsObject,
        );
      case DashboardComponentType.ProxmoxGuestList:
        return PublicDashboardResourceListPolicy.buildProxmoxGuestPolicy(
          argumentsObject,
        );
      case DashboardComponentType.CephOsdList:
        return PublicDashboardResourceListPolicy.buildCephOsdPolicy(
          argumentsObject,
        );
      case DashboardComponentType.CephPoolList:
        return PublicDashboardResourceListPolicy.buildCephPoolPolicy(
          argumentsObject,
        );
      case DashboardComponentType.DockerSwarmNodeList:
        return PublicDashboardResourceListPolicy.buildDockerSwarmNodePolicy(
          argumentsObject,
        );
      case DashboardComponentType.DockerSwarmServiceList:
        return PublicDashboardResourceListPolicy.buildDockerSwarmServicePolicy(
          argumentsObject,
        );
      case DashboardComponentType.TraceList:
        return PublicDashboardResourceListPolicy.buildTracePolicy({
          argumentsObject,
          requestedQuery,
        });
      case DashboardComponentType.LogStream:
        return PublicDashboardResourceListPolicy.buildLogPolicy({
          argumentsObject,
          requestedQuery,
        });
      default:
        throw new BadDataException(
          `Unsupported public dashboard resource widget: ${componentType}`,
        );
    }
  }

  private static buildIncidentPolicy(
    argumentsObject: Record<string, unknown>,
  ): PolicyDraft {
    const query: Record<string, unknown> = {};
    const stateFilter: string | undefined =
      PublicDashboardResourceListPolicy.optionalEnum(
        argumentsObject,
        "stateFilter",
        ["unresolved", "resolved", "acknowledged"],
      );

    if (stateFilter === "unresolved") {
      query["currentIncidentState"] = { isResolvedState: false };
    } else if (stateFilter === "resolved") {
      query["currentIncidentState"] = { isResolvedState: true };
    } else if (stateFilter === "acknowledged") {
      query["currentIncidentState"] = { isAcknowledgedState: true };
    }

    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: "incidentSeverityId",
      argumentsObject,
      argumentKey: "severityIds",
    });
    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: "currentIncidentStateId",
      argumentsObject,
      argumentKey: "stateIds",
    });
    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: "monitors",
      argumentsObject,
      argumentKey: "monitorIds",
    });
    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: "labels",
      argumentsObject,
      argumentKey: "labelIds",
    });

    return PublicDashboardResourceListPolicy.listDraft({
      resourceType: "incident",
      query,
      sort: { createdAt: SortOrder.Descending },
      argumentsObject,
    });
  }

  private static buildAlertPolicy(
    argumentsObject: Record<string, unknown>,
  ): PolicyDraft {
    const query: Record<string, unknown> = {};
    const stateFilter: string | undefined =
      PublicDashboardResourceListPolicy.optionalEnum(
        argumentsObject,
        "stateFilter",
        ["unresolved", "resolved", "acknowledged"],
      );

    if (stateFilter === "unresolved") {
      query["currentAlertState"] = { isResolvedState: false };
    } else if (stateFilter === "resolved") {
      query["currentAlertState"] = { isResolvedState: true };
    } else if (stateFilter === "acknowledged") {
      query["currentAlertState"] = { isAcknowledgedState: true };
    }

    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: "alertSeverityId",
      argumentsObject,
      argumentKey: "severityIds",
    });
    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: "currentAlertStateId",
      argumentsObject,
      argumentKey: "stateIds",
    });
    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: "monitorId",
      argumentsObject,
      argumentKey: "monitorIds",
    });
    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: "labels",
      argumentsObject,
      argumentKey: "labelIds",
    });

    return PublicDashboardResourceListPolicy.listDraft({
      resourceType: "alert",
      query,
      sort: { createdAt: SortOrder.Descending },
      argumentsObject,
    });
  }

  private static buildMonitorPolicy(
    argumentsObject: Record<string, unknown>,
  ): PolicyDraft {
    const query: Record<string, unknown> = {};
    const statusFilter: string | undefined =
      PublicDashboardResourceListPolicy.optionalEnum(
        argumentsObject,
        "statusFilter",
        ["operational", "non-operational"],
      );

    if (statusFilter === "operational") {
      query["currentMonitorStatus"] = { isOperationalState: true };
    } else if (statusFilter === "non-operational") {
      query["currentMonitorStatus"] = { isOperationalState: false };
    }

    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: "currentMonitorStatusId",
      argumentsObject,
      argumentKey: "monitorStatusIds",
    });
    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: "monitorType",
      argumentsObject,
      argumentKey: "monitorTypes",
    });
    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: "labels",
      argumentsObject,
      argumentKey: "labelIds",
    });

    return PublicDashboardResourceListPolicy.listDraft({
      resourceType: "monitor",
      query,
      sort: { name: SortOrder.Ascending },
      argumentsObject,
    });
  }

  private static buildNetworkMapPolicy(
    argumentsObject: Record<string, unknown>,
  ): PolicyDraft {
    const query: Record<string, unknown> = {};
    const statusFilter: string | undefined =
      PublicDashboardResourceListPolicy.optionalEnum(
        argumentsObject,
        "statusFilter",
        ["down", "operational"],
      );

    if (statusFilter === "down") {
      query["currentMonitorStatus"] = { isOperationalState: false };
    } else if (statusFilter === "operational") {
      query["currentMonitorStatus"] = { isOperationalState: true };
    }

    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: "networkSiteTypeId",
      argumentsObject,
      argumentKey: "networkSiteTypeIds",
    });

    const maxSites: number = PublicDashboardResourceListPolicy.storedLimit({
      value: argumentsObject["maxSites"],
      fallback: DEFAULT_NETWORK_MAP_MAX_SITES,
      ceiling: LIMIT_PER_PROJECT - 1,
    });

    return {
      resourceType: "network-site",
      query,
      sort: { name: SortOrder.Ascending },
      // The map fetches one sentinel row to tell whether its display is capped.
      limit: Math.min(maxSites + 1, LIMIT_PER_PROJECT),
    };
  }

  private static buildHostPolicy(
    argumentsObject: Record<string, unknown>,
  ): PolicyDraft {
    const query: Record<string, unknown> = {};
    PublicDashboardResourceListPolicy.addCollectorStatusFilter(
      query,
      argumentsObject,
    );

    const osType: string | undefined =
      PublicDashboardResourceListPolicy.optionalEnum(
        argumentsObject,
        "osTypeFilter",
        ["linux", "darwin", "windows"],
      );
    if (osType) {
      query["osType"] = osType;
    }

    return {
      ...PublicDashboardResourceListPolicy.listDraft({
        resourceType: "host",
        query,
        sort: { name: SortOrder.Ascending },
        argumentsObject,
      }),
      attributeToColumn: HOST_ATTRIBUTE_TO_COLUMN,
    };
  }

  private static buildKubernetesPolicy(data: {
    argumentsObject: Record<string, unknown>;
    kind: string;
    attributeToColumn: AttributeToColumnMap;
    includeNamespaces: boolean;
    componentType: DashboardComponentType;
  }): PolicyDraft {
    const { argumentsObject } = data;
    const query: Record<string, unknown> = { kind: data.kind };

    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: "kubernetesClusterId",
      argumentsObject,
      argumentKey: "kubernetesClusterIds",
    });

    if (data.includeNamespaces) {
      const namespaces: string | undefined =
        PublicDashboardResourceListPolicy.optionalString(
          argumentsObject,
          "namespaces",
          true,
        );
      if (namespaces) {
        const parsedNamespaces: Array<string> = namespaces
          .split(",")
          .map((namespace: string) => {
            return namespace.trim();
          })
          .filter((namespace: string) => {
            return namespace.length > 0;
          });
        if (parsedNamespaces.length > 0) {
          query["namespaceKey"] = new Includes(parsedNamespaces);
        }
      }
    }

    if (data.componentType === DashboardComponentType.KubernetesPodList) {
      PublicDashboardResourceListPolicy.addIncludesFromArgument({
        query,
        queryKey: "phase",
        argumentsObject,
        argumentKey: "podPhases",
      });
    }

    if (data.componentType === DashboardComponentType.KubernetesNodeList) {
      const readinessFilter: string | undefined =
        PublicDashboardResourceListPolicy.optionalEnum(
          argumentsObject,
          "readinessFilter",
          ["ready", "not-ready"],
        );
      if (readinessFilter === "ready") {
        query["isReady"] = true;
      } else if (readinessFilter === "not-ready") {
        query["isReady"] = false;
      }
    }

    return {
      ...PublicDashboardResourceListPolicy.listDraft({
        resourceType: "kubernetes-resource",
        query,
        sort: {
          namespaceKey: SortOrder.Ascending,
          name: SortOrder.Ascending,
        },
        argumentsObject,
      }),
      attributeToColumn: data.attributeToColumn,
    };
  }

  private static buildContainerHostPolicy(data: {
    argumentsObject: Record<string, unknown>;
    resourceType: string;
  }): PolicyDraft {
    const query: Record<string, unknown> = {};
    PublicDashboardResourceListPolicy.addCollectorStatusFilter(
      query,
      data.argumentsObject,
    );

    return {
      ...PublicDashboardResourceListPolicy.listDraft({
        resourceType: data.resourceType,
        query,
        sort: { name: SortOrder.Ascending },
        argumentsObject: data.argumentsObject,
      }),
      attributeToColumn: HOST_NAME_ATTRIBUTE_TO_COLUMN,
    };
  }

  private static buildContainerPolicy(data: {
    argumentsObject: Record<string, unknown>;
    resourceType: string;
    hostIdKey: string;
    storedHostIdsKey: string;
  }): PolicyDraft {
    const query: Record<string, unknown> = { kind: "Container" };
    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: data.hostIdKey,
      argumentsObject: data.argumentsObject,
      argumentKey: data.storedHostIdsKey,
    });

    const imageName: string | undefined =
      PublicDashboardResourceListPolicy.optionalString(
        data.argumentsObject,
        "imageName",
        true,
      );
    if (imageName) {
      query["imageName"] = new Search(imageName);
    }

    return {
      ...PublicDashboardResourceListPolicy.listDraft({
        resourceType: data.resourceType,
        query,
        sort: { name: SortOrder.Ascending },
        argumentsObject: data.argumentsObject,
      }),
      attributeToColumn: CONTAINER_ATTRIBUTE_TO_COLUMN,
    };
  }

  private static buildImagePolicy(data: {
    argumentsObject: Record<string, unknown>;
    resourceType: string;
    hostIdKey: string;
    storedHostIdsKey: string;
  }): PolicyDraft {
    const query: Record<string, unknown> = { kind: "Image" };
    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: data.hostIdKey,
      argumentsObject: data.argumentsObject,
      argumentKey: data.storedHostIdsKey,
    });

    const nameSearch: string | undefined =
      PublicDashboardResourceListPolicy.optionalString(
        data.argumentsObject,
        "nameSearch",
        true,
      );
    if (nameSearch) {
      query["name"] = new Search(nameSearch);
    }

    return {
      ...PublicDashboardResourceListPolicy.listDraft({
        resourceType: data.resourceType,
        query,
        sort: { name: SortOrder.Ascending },
        argumentsObject: data.argumentsObject,
      }),
      attributeToColumn: IMAGE_ATTRIBUTE_TO_COLUMN,
    };
  }

  private static buildContainerInventoryPolicy(data: {
    argumentsObject: Record<string, unknown>;
    resourceType: string;
    kind: string;
    hostIdKey: string;
    storedHostIdsKey: string;
  }): PolicyDraft {
    const query: Record<string, unknown> = { kind: data.kind };
    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: data.hostIdKey,
      argumentsObject: data.argumentsObject,
      argumentKey: data.storedHostIdsKey,
    });

    return PublicDashboardResourceListPolicy.listDraft({
      resourceType: data.resourceType,
      query,
      sort: { name: SortOrder.Ascending },
      argumentsObject: data.argumentsObject,
    });
  }

  private static buildProxmoxNodePolicy(
    argumentsObject: Record<string, unknown>,
  ): PolicyDraft {
    const query: Record<string, unknown> = { kind: "Node" };
    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: "proxmoxClusterId",
      argumentsObject,
      argumentKey: "proxmoxClusterIds",
    });

    const statusFilter: string | undefined =
      PublicDashboardResourceListPolicy.optionalEnum(
        argumentsObject,
        "statusFilter",
        ["online", "offline"],
      );
    if (statusFilter === "online") {
      query["isUp"] = true;
    } else if (statusFilter === "offline") {
      query["isUp"] = false;
    }

    return {
      ...PublicDashboardResourceListPolicy.listDraft({
        resourceType: "proxmox-resource",
        query,
        sort: { name: SortOrder.Ascending },
        argumentsObject,
      }),
      attributeToColumn: PROXMOX_NODE_ATTRIBUTE_TO_COLUMN,
    };
  }

  private static buildProxmoxGuestPolicy(
    argumentsObject: Record<string, unknown>,
  ): PolicyDraft {
    const query: Record<string, unknown> = { kind: "Guest" };
    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: "proxmoxClusterId",
      argumentsObject,
      argumentKey: "proxmoxClusterIds",
    });

    const guestType: string | undefined =
      PublicDashboardResourceListPolicy.optionalEnum(
        argumentsObject,
        "guestTypeFilter",
        ["qemu", "lxc"],
      );
    if (guestType) {
      query["guestType"] = guestType;
    }

    const statusFilter: string | undefined =
      PublicDashboardResourceListPolicy.optionalEnum(
        argumentsObject,
        "statusFilter",
        ["running", "stopped"],
      );
    if (statusFilter === "running") {
      query["isUp"] = true;
    } else if (statusFilter === "stopped") {
      query["isUp"] = false;
    }

    return PublicDashboardResourceListPolicy.listDraft({
      resourceType: "proxmox-resource",
      query,
      sort: { name: SortOrder.Ascending },
      argumentsObject,
    });
  }

  private static buildCephOsdPolicy(
    argumentsObject: Record<string, unknown>,
  ): PolicyDraft {
    const query: Record<string, unknown> = { kind: "Osd" };
    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: "cephClusterId",
      argumentsObject,
      argumentKey: "cephClusterIds",
    });

    const stateFilter: string | undefined =
      PublicDashboardResourceListPolicy.optionalEnum(
        argumentsObject,
        "stateFilter",
        ["up", "down", "out"],
      );
    if (stateFilter === "up") {
      query["isUp"] = true;
    } else if (stateFilter === "down") {
      query["isUp"] = false;
    } else if (stateFilter === "out") {
      query["isIn"] = false;
    }

    return {
      ...PublicDashboardResourceListPolicy.listDraft({
        resourceType: "ceph-resource",
        query,
        sort: { externalId: SortOrder.Ascending },
        argumentsObject,
      }),
      attributeToColumn: CEPH_OSD_ATTRIBUTE_TO_COLUMN,
    };
  }

  private static buildCephPoolPolicy(
    argumentsObject: Record<string, unknown>,
  ): PolicyDraft {
    const query: Record<string, unknown> = { kind: "Pool" };
    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: "cephClusterId",
      argumentsObject,
      argumentKey: "cephClusterIds",
    });

    return {
      ...PublicDashboardResourceListPolicy.listDraft({
        resourceType: "ceph-resource",
        query,
        sort: { name: SortOrder.Ascending },
        argumentsObject,
      }),
      attributeToColumn: CEPH_POOL_ATTRIBUTE_TO_COLUMN,
    };
  }

  private static buildDockerSwarmNodePolicy(
    argumentsObject: Record<string, unknown>,
  ): PolicyDraft {
    const query: Record<string, unknown> = { kind: "Node" };
    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: "dockerSwarmClusterId",
      argumentsObject,
      argumentKey: "dockerSwarmClusterIds",
    });

    const role: string | undefined =
      PublicDashboardResourceListPolicy.optionalEnum(
        argumentsObject,
        "roleFilter",
        ["manager", "worker"],
      );
    if (role) {
      query["role"] = role;
    }

    const statusFilter: string | undefined =
      PublicDashboardResourceListPolicy.optionalEnum(
        argumentsObject,
        "statusFilter",
        ["ready", "notready"],
      );
    if (statusFilter === "ready") {
      query["isReady"] = true;
    } else if (statusFilter === "notready") {
      query["isReady"] = false;
    }

    return PublicDashboardResourceListPolicy.listDraft({
      resourceType: "docker-swarm-resource",
      query,
      sort: { name: SortOrder.Ascending },
      argumentsObject,
    });
  }

  private static buildDockerSwarmServicePolicy(
    argumentsObject: Record<string, unknown>,
  ): PolicyDraft {
    const query: Record<string, unknown> = { kind: "Service" };
    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: "dockerSwarmClusterId",
      argumentsObject,
      argumentKey: "dockerSwarmClusterIds",
    });

    const serviceMode: string | undefined =
      PublicDashboardResourceListPolicy.optionalEnum(
        argumentsObject,
        "serviceModeFilter",
        ["replicated", "global"],
      );
    if (serviceMode) {
      query["serviceMode"] = serviceMode;
    }

    const statusFilter: string | undefined =
      PublicDashboardResourceListPolicy.optionalEnum(
        argumentsObject,
        "statusFilter",
        ["converged", "notconverged"],
      );
    if (statusFilter === "converged") {
      query["isReady"] = true;
    } else if (statusFilter === "notconverged") {
      query["isReady"] = false;
    }

    return PublicDashboardResourceListPolicy.listDraft({
      resourceType: "docker-swarm-resource",
      query,
      sort: { name: SortOrder.Ascending },
      argumentsObject,
    });
  }

  private static buildTracePolicy(data: {
    argumentsObject: Record<string, unknown>;
    requestedQuery: unknown;
  }): PolicyDraft {
    const query: Record<string, unknown> = {
      startTime: PublicDashboardResourceListPolicy.requiredTimeRange(
        data.requestedQuery,
        "startTime",
      ),
    };

    const statusFilter: string | undefined =
      PublicDashboardResourceListPolicy.optionalEnum(
        data.argumentsObject,
        "statusFilter",
        ["0", "1", "2"],
      );
    if (statusFilter !== undefined) {
      query["statusCode"] = parseInt(statusFilter, 10);
    }

    return PublicDashboardResourceListPolicy.listDraft({
      resourceType: "span",
      query,
      sort: { startTime: SortOrder.Descending },
      argumentsObject: data.argumentsObject,
      fallbackLimit: DEFAULT_TELEMETRY_LIMIT,
    });
  }

  private static buildLogPolicy(data: {
    argumentsObject: Record<string, unknown>;
    requestedQuery: unknown;
  }): PolicyDraft {
    const query: Record<string, unknown> = {
      time: PublicDashboardResourceListPolicy.requiredTimeRange(
        data.requestedQuery,
        "time",
      ),
    };

    const severity: string | undefined =
      PublicDashboardResourceListPolicy.optionalEnum(
        data.argumentsObject,
        "severityFilter",
        ["Trace", "Debug", "Information", "Warning", "Error", "Fatal"],
      );
    if (severity) {
      query["severityText"] = severity;
    }

    const bodyContains: string | undefined =
      PublicDashboardResourceListPolicy.optionalString(
        data.argumentsObject,
        "bodyContains",
        true,
      );
    if (bodyContains) {
      query["body"] = bodyContains;
    }

    const attributeFilterQuery: string | undefined =
      PublicDashboardResourceListPolicy.optionalString(
        data.argumentsObject,
        "attributeFilterQuery",
        true,
      );
    if (attributeFilterQuery) {
      const parsedFilter: LogFilter = queryStringToFilter(attributeFilterQuery);
      if (
        parsedFilter.attributes &&
        Object.keys(parsedFilter.attributes).length > 0
      ) {
        query["attributes"] = parsedFilter.attributes;
      }
    }

    return {
      ...PublicDashboardResourceListPolicy.listDraft({
        resourceType: "log",
        query,
        sort: { time: SortOrder.Descending },
        argumentsObject: data.argumentsObject,
        fallbackLimit: DEFAULT_TELEMETRY_LIMIT,
      }),
      interpolateAttributeMap: true,
    };
  }

  private static listDraft(data: {
    resourceType: string;
    query: Record<string, unknown>;
    sort: JSONObject;
    argumentsObject: Record<string, unknown>;
    fallbackLimit?: number | undefined;
  }): PolicyDraft {
    return {
      resourceType: data.resourceType,
      query: data.query,
      sort: data.sort,
      limit: PublicDashboardResourceListPolicy.storedLimit({
        value: data.argumentsObject["maxRows"],
        fallback: data.fallbackLimit || DEFAULT_LIST_LIMIT,
        ceiling: LIMIT_PER_PROJECT,
      }),
    };
  }

  private static addCollectorStatusFilter(
    query: Record<string, unknown>,
    argumentsObject: Record<string, unknown>,
  ): void {
    const statusFilter: string | undefined =
      PublicDashboardResourceListPolicy.optionalEnum(
        argumentsObject,
        "statusFilter",
        ["connected", "disconnected"],
      );
    if (statusFilter) {
      query["otelCollectorStatus"] = statusFilter;
    }
  }

  private static addIncludesFromArgument(data: {
    query: Record<string, unknown>;
    queryKey: string;
    argumentsObject: Record<string, unknown>;
    argumentKey: string;
  }): void {
    const values: Array<string> | undefined =
      PublicDashboardResourceListPolicy.optionalStringArray(
        data.argumentsObject,
        data.argumentKey,
      );
    if (values && values.length > 0) {
      data.query[data.queryKey] = new Includes(values);
    }
  }

  private static optionalStringArray(
    object: Record<string, unknown>,
    key: string,
  ): Array<string> | undefined {
    const value: unknown = object[key];
    if (value === undefined || value === null) {
      return undefined;
    }
    if (!Array.isArray(value)) {
      throw new BadDataException(`Dashboard widget ${key} must be an array.`);
    }

    const values: Array<string> = [];
    for (const item of value) {
      if (typeof item !== "string" || item.length === 0) {
        throw new BadDataException(
          `Dashboard widget ${key} contains an invalid value.`,
        );
      }
      values.push(item);
    }
    return values;
  }

  private static optionalString(
    object: Record<string, unknown>,
    key: string,
    trim: boolean,
  ): string | undefined {
    const value: unknown = object[key];
    if (value === undefined || value === null || value === "") {
      return undefined;
    }
    if (typeof value !== "string") {
      throw new BadDataException(`Dashboard widget ${key} must be a string.`);
    }

    const normalized: string = trim ? value.trim() : value;
    return normalized.length > 0 ? normalized : undefined;
  }

  private static optionalEnum(
    object: Record<string, unknown>,
    key: string,
    allowedValues: Array<string>,
  ): string | undefined {
    const value: unknown = object[key];
    if (value === undefined || value === null || value === "") {
      return undefined;
    }
    if (typeof value !== "string" || !allowedValues.includes(value)) {
      throw new BadDataException(`Dashboard widget ${key} is invalid.`);
    }
    return value;
  }

  private static storedLimit(data: {
    value: unknown;
    fallback: number;
    ceiling: number;
  }): number {
    const parsed: number = Number(
      typeof data.value === "string" ? data.value.trim() : data.value,
    );
    if (!Number.isFinite(parsed) || parsed < 1) {
      return data.fallback;
    }
    return Math.min(Math.floor(parsed), data.ceiling);
  }

  private static requiredTimeRange(
    requestedQuery: unknown,
    key: "time" | "startTime",
  ): InBetween<Date> {
    const query: Record<string, unknown> =
      PublicDashboardResourceListPolicy.requireObject(
        requestedQuery,
        "Public dashboard telemetry query",
      );
    if (!Object.prototype.hasOwnProperty.call(query, key)) {
      throw new BadDataException(
        `Public dashboard telemetry query requires ${key}.`,
      );
    }

    const deserialized: JSONValue = JSONFunctions.deserializeValue(
      query[key] as JSONValue,
    );
    if (!(deserialized instanceof InBetween)) {
      throw new BadDataException(
        `Public dashboard telemetry ${key} must be an InBetween range.`,
      );
    }

    const start: Date = PublicDashboardResourceListPolicy.validDate(
      deserialized.startValue,
      key,
    );
    const end: Date = PublicDashboardResourceListPolicy.validDate(
      deserialized.endValue,
      key,
    );
    if (start.getTime() >= end.getTime()) {
      throw new BadDataException(
        `Public dashboard telemetry ${key} range is invalid.`,
      );
    }

    return new InBetween<Date>(start, end);
  }

  private static validDate(value: unknown, key: string): Date {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return new Date(value.getTime());
    }
    if (typeof value === "string" && value.length <= 128) {
      const date: Date = new Date(value);
      if (Number.isFinite(date.getTime())) {
        return date;
      }
    }
    throw new BadDataException(
      `Public dashboard telemetry ${key} range contains an invalid date.`,
    );
  }

  private static resolveDashboardVariableSelections(data: {
    dashboardViewConfig: unknown;
    requestedVariables: unknown;
  }): Array<DashboardVariable> {
    const dashboardViewConfig: Record<string, unknown> =
      PublicDashboardResourceListPolicy.requireObject(
        data.dashboardViewConfig,
        "Dashboard view config",
      );
    const storedVariablesValue: unknown = dashboardViewConfig["variables"];
    const storedVariables: Array<unknown> =
      storedVariablesValue === undefined || storedVariablesValue === null
        ? []
        : Array.isArray(storedVariablesValue)
          ? storedVariablesValue
          : (() => {
              throw new BadDataException(
                "Dashboard view config variables must be an array.",
              );
            })();

    const requestedSelections: Map<
      string,
      Record<string, unknown>
    > = PublicDashboardResourceListPolicy.validateRequestedVariableSelections(
      data.requestedVariables,
    );
    const variables: Array<DashboardVariable> = [];
    const storedIds: Set<string> = new Set<string>();

    for (const storedValue of storedVariables) {
      const stored: Record<string, unknown> =
        PublicDashboardResourceListPolicy.requireObject(
          storedValue,
          "Stored dashboard variable",
        );
      if (stored["type"] !== DashboardVariableType.TelemetryAttribute) {
        continue;
      }

      const id: unknown = stored["id"];
      const attributeKey: unknown = stored["attributeKey"];
      if (
        typeof id !== "string" ||
        id.length === 0 ||
        id.length > MAX_VARIABLE_ID_LENGTH ||
        typeof attributeKey !== "string" ||
        attributeKey.trim().length === 0 ||
        attributeKey.length > MAX_VARIABLE_VALUE_LENGTH
      ) {
        throw new BadDataException("Stored dashboard variable is malformed.");
      }
      if (storedIds.has(id)) {
        throw new BadDataException("Dashboard variable IDs must be unique.");
      }
      storedIds.add(id);

      const isMultiSelect: unknown = stored["isMultiSelect"];
      if (
        isMultiSelect !== undefined &&
        isMultiSelect !== null &&
        typeof isMultiSelect !== "boolean"
      ) {
        throw new BadDataException("Stored dashboard variable is malformed.");
      }

      const defaultValue: unknown = stored["defaultValue"];
      if (
        defaultValue !== undefined &&
        defaultValue !== null &&
        (typeof defaultValue !== "string" ||
          defaultValue.length > MAX_VARIABLE_VALUE_LENGTH)
      ) {
        throw new BadDataException("Stored dashboard variable is malformed.");
      }

      const selection: Record<string, unknown> | undefined =
        requestedSelections.get(id);
      const selectedValue: unknown = selection?.["selectedValue"];
      const selectedValues: unknown = selection?.["selectedValues"];
      const name: unknown = stored["name"];
      const storedIsMultiSelect: boolean = isMultiSelect === true;

      variables.push({
        id,
        name: typeof name === "string" ? name : "",
        type: DashboardVariableType.TelemetryAttribute,
        attributeKey: attributeKey.trim(),
        isMultiSelect: storedIsMultiSelect,
        defaultValue:
          typeof defaultValue === "string" ? defaultValue : undefined,
        selectedValue:
          !storedIsMultiSelect && typeof selectedValue === "string"
            ? selectedValue
            : undefined,
        selectedValues:
          storedIsMultiSelect && Array.isArray(selectedValues)
            ? (selectedValues as Array<string>)
            : undefined,
      });
    }

    return variables;
  }

  private static validateRequestedVariableSelections(
    requestedVariables: unknown,
  ): Map<string, Record<string, unknown>> {
    const selections: Map<string, Record<string, unknown>> = new Map<
      string,
      Record<string, unknown>
    >();
    if (requestedVariables === undefined || requestedVariables === null) {
      return selections;
    }
    if (!Array.isArray(requestedVariables)) {
      throw new BadDataException(
        "Public dashboard variable selections must be an array.",
      );
    }
    if (requestedVariables.length > MAX_REQUESTED_VARIABLES) {
      throw new BadDataException(
        "Too many public dashboard variable selections.",
      );
    }

    let totalSelectedValues: number = 0;
    for (const requestedValue of requestedVariables) {
      const requested: Record<string, unknown> =
        PublicDashboardResourceListPolicy.requireObject(
          requestedValue,
          "Public dashboard variable selection",
        );
      const id: unknown = requested["id"];
      if (
        typeof id !== "string" ||
        id.length === 0 ||
        id.length > MAX_VARIABLE_ID_LENGTH
      ) {
        throw new BadDataException(
          "Public dashboard variable selection has an invalid id.",
        );
      }
      if (selections.has(id)) {
        throw new BadDataException(
          "Public dashboard variable selections contain a duplicate id.",
        );
      }

      const selectedValue: unknown = requested["selectedValue"];
      if (
        selectedValue !== undefined &&
        selectedValue !== null &&
        (typeof selectedValue !== "string" ||
          selectedValue.length > MAX_VARIABLE_VALUE_LENGTH)
      ) {
        throw new BadDataException(
          "Public dashboard variable selection has an invalid value.",
        );
      }

      const selectedValues: unknown = requested["selectedValues"];
      if (
        selectedValues !== undefined &&
        selectedValues !== null &&
        !Array.isArray(selectedValues)
      ) {
        throw new BadDataException(
          "Public dashboard variable selection values must be an array.",
        );
      }
      if (
        Array.isArray(selectedValues) &&
        selectedValues.length > MAX_SELECTED_VALUES_PER_VARIABLE
      ) {
        throw new BadDataException(
          "Too many values in a public dashboard variable selection.",
        );
      }

      if (Array.isArray(selectedValues)) {
        totalSelectedValues += selectedValues.length;
        if (totalSelectedValues > MAX_TOTAL_SELECTED_VALUES) {
          throw new BadDataException(
            "Too many public dashboard variable selection values.",
          );
        }
        for (const value of selectedValues) {
          if (
            typeof value !== "string" ||
            value.length > MAX_VARIABLE_VALUE_LENGTH
          ) {
            throw new BadDataException(
              "Public dashboard variable selection has an invalid value.",
            );
          }
        }
      }

      selections.set(id, {
        selectedValue:
          typeof selectedValue === "string" ? selectedValue : undefined,
        selectedValues: Array.isArray(selectedValues)
          ? (selectedValues as Array<string>)
          : undefined,
      });
    }

    return selections;
  }

  private static requireObject(
    value: unknown,
    label: string,
  ): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadDataException(`${label} must be an object.`);
    }
    return value as Record<string, unknown>;
  }
}

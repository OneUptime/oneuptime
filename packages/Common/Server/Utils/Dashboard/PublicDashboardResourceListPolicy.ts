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
import PublicDashboardSloWidget, {
  PublicDashboardSloWidgetConfig,
  PublicDashboardSloWidgetTargetKind,
} from "./PublicDashboardSloWidget";
import { SLO_WIDGET_NAME_MATCH_LIMIT } from "../../../Utils/Dashboard/SloWidgetSource";
import {
  getSloListStatusFilterQuery,
  SLO_LIST_ATTRIBUTE_TO_COLUMN,
  SLO_LIST_DEFAULT_MAX_ROWS,
  SLO_LIST_STATUS_FILTER_VALUES,
} from "../../../Utils/Slo/SloListWidgetFormat";
import {
  LogFilter,
  queryStringToFilter,
} from "../../../Types/Log/LogQueryToFilter";
import DashboardModelQueryInterpolation, {
  AttributeToColumnMap,
} from "../../../Utils/Dashboard/ModelQueryVariableInterpolation";
import DashboardVariableInterpolation from "../../../Utils/Dashboard/VariableInterpolation";
import DashboardLabelVariable from "../../../Utils/Dashboard/LabelVariable";
import DashboardWidgetIds from "../../../Utils/Dashboard/DashboardWidgetIds";
import {
  getMonitorListQuery,
  MONITOR_LIST_STATUS_FILTER_VALUES,
  MONITOR_LIST_WIDGET_SELECT,
} from "../../../Utils/Dashboard/MonitorListWidgetFormat";
import {
  STORAGE_ARRAY_HARDWARE_UNHEALTHY_FILTER,
  STORAGE_ARRAY_HARDWARE_WIDGET_KINDS,
  STORAGE_ARRAY_UNHEALTHY_COMPONENT_STATUSES,
} from "../../../Utils/Dashboard/Components/DashboardStorageArrayResourceListShared";
import {
  DashboardWidgetSortChoice,
  readDashboardWidgetSortChoiceForColumns,
} from "../../../Types/Dashboard/DashboardWidgetSort";
import {
  getDashboardWidgetEffectiveSort,
  getDashboardWidgetListSort,
  getDashboardWidgetSortColumns,
  getDashboardWidgetSortSpec,
  readDashboardWidgetSavedSort,
  withDashboardWidgetListSortSelect,
} from "../../../Utils/Dashboard/DashboardWidgetSorts";

/*
 * An incident or alert list's "Unresolved", "Resolved" or "Acknowledged"
 * filter. Which states that means is the project's: its resolved state and
 * any state placed after it are resolved (Common/Utils/ResolvedState); its
 * acknowledged state and any state placed after it, short of resolved, are
 * acknowledged (Common/Utils/AcknowledgedState). The policy names the
 * filter; the route turns it into the project's state ids.
 */
export type PublicDashboardResolvedStateFilter =
  | "unresolved"
  | "resolved"
  | "acknowledged";

export interface PublicDashboardResourceListPolicyResult {
  resourceType: string;
  query: JSONObject;
  select: JSONObject;
  sort: JSONObject;
  limit: number;
  resolvedStateFilter?: PublicDashboardResolvedStateFilter | undefined;
  /*
   * The order the list is read in, for a widget the sort registry orders
   * (Utils/Dashboard/DashboardWidgetSorts): the viewer's pick when it names
   * one of the widget's sortable columns, else the widget's own sort, else
   * the order it always had. `sort` is its database order; a status read
   * rank by rank is read with getDashboardWidgetListReadSteps. Null for any
   * other widget.
   */
  sortChoice: DashboardWidgetSortChoice | null;
}

export interface BuildPublicDashboardResourceListPolicyData {
  /*
   * The widget as the public page draws it: a component of
   * PublicDashboardViewConfig.getDrawnConfig, found in whatever shape it was
   * stored, deserialized, and with an `arguments` object - an empty one for
   * a widget saved without settings, which the page draws with its defaults
   * (issue #6315).
   */
  widget: JSONObject;
  /*
   * The variables the public page's toolbar draws, as it draws them
   * (PublicDashboardViewConfig.getDrawnConfig's `variables`): the source of
   * every variable id, type, attribute key, default and label choice
   * (resolveDashboardVariableSelections).
   */
  variables: Array<DashboardVariable> | undefined;
  requestedVariables: unknown;
  requestedQuery: unknown;
  /*
   * The viewer's own sort from a header click (the request's `widgetSort`,
   * "status:desc"). Taken only when it names one of the stored widget's
   * own sortable columns; anything else - another column, another shape,
   * a database order - is ignored, and the widget's own sort is used.
   */
  requestedSort?: unknown;
}

interface PolicyDraft {
  resourceType: string;
  query: Record<string, unknown>;
  // Set for a widget the sort registry does not order.
  sort?: JSONObject | undefined;
  limit: number;
  resolvedStateFilter?: PublicDashboardResolvedStateFilter | undefined;
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

/*
 * The vcenter receiver stamps identity on RESOURCE attributes, so a
 * dashboard variable may be keyed either as the bare attribute or as the
 * `resource.`-prefixed form the metrics explorer exposes.
 */
const VMWARE_HOST_ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  "vcenter.host.name": "name",
  "resource.vcenter.host.name": "name",
  "vcenter.cluster.name": "clusterName",
  "resource.vcenter.cluster.name": "clusterName",
  "vcenter.datacenter.name": "datacenterName",
  "resource.vcenter.datacenter.name": "datacenterName",
};

const VMWARE_VIRTUAL_MACHINE_ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  "vcenter.vm.name": "name",
  "resource.vcenter.vm.name": "name",
  "vcenter.host.name": "hostName",
  "resource.vcenter.host.name": "hostName",
  "vcenter.cluster.name": "clusterName",
  "resource.vcenter.cluster.name": "clusterName",
};

const CEPH_OSD_ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  ceph_daemon: "externalId",
};

const CEPH_POOL_ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  pool_id: "externalId",
};

/*
 * Pure Storage names a volume in the `name` label of every per-volume series
 * and a hardware component or drive in `component_name`; both are stored
 * verbatim as StorageArrayResource.externalId. These maps must stay
 * byte-identical to ATTRIBUTE_TO_COLUMN in the dashboard's
 * DashboardStorageArrayVolumeListComponent /
 * DashboardStorageArrayHardwareListComponent — here they are the copy a
 * public dashboard applies.
 */
const STORAGE_ARRAY_VOLUME_ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  name: "externalId",
};

const STORAGE_ARRAY_HARDWARE_ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  component_name: "externalId",
};

/*
 * Produces the complete server-owned policy for one already-selected public
 * dashboard widget. No caller-supplied project, kind, filter, sort, or limit is
 * copied. The route adds the dashboard's projectId after this policy returns.
 *
 * The widget and the variables come as the public page draws them
 * (PublicDashboardViewConfig.getDrawnConfig) - the reading every board makes
 * of a stored config, signed in and public alike - so a widget lists with
 * exactly the settings and variables it is drawn with, in whatever shape
 * they were stored (issue #6315).
 *
 * The one thing a request may name is a viewer's sort from a header click
 * (issue #5082): a column and a direction, taken only when the column is one
 * of the stored widget's own sortable columns (Utils/Dashboard/
 * DashboardWidgetSorts). The database order it means is built here from that
 * registry, so a request can reorder a list by the columns the widget shows
 * and by nothing else.
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
        variables: data.variables,
        requestedVariables: data.requestedVariables,
      });

    const draft: PolicyDraft = PublicDashboardResourceListPolicy.buildDraft({
      componentType: componentType as DashboardComponentType,
      argumentsObject,
      requestedQuery: data.requestedQuery,
      variables,
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

    /*
     * The order: for a widget the sort registry orders, the viewer's pick
     * when it is one of the widget's own sortable columns, else the
     * widget's own sort, else the order it always had - never a database
     * order the request names. Its select gains the related fields that
     * order reads (a status's place in the project's list).
     */
    const sortChoice: DashboardWidgetSortChoice | null =
      PublicDashboardResourceListPolicy.getSortChoice({
        componentType,
        argumentsObject,
        requestedSort: data.requestedSort,
      });

    const select: JSONObject =
      PublicDashboardResourceListPolicy.selectForComponent(
        componentType as DashboardComponentType,
      );

    return {
      resourceType: draft.resourceType,
      query: query as JSONObject,
      select: sortChoice
        ? withDashboardWidgetListSortSelect(componentType, select)
        : select,
      sort: sortChoice
        ? getDashboardWidgetListSort(componentType, sortChoice)
        : draft.sort || {},
      limit: draft.limit,
      ...(draft.resolvedStateFilter
        ? { resolvedStateFilter: draft.resolvedStateFilter }
        : {}),
      sortChoice,
    };
  }

  /*
   * The choice a public widget's list is ordered by, or null for a widget
   * the sort registry does not order. A request's sort that names none of
   * the widget's own sortable columns is ignored, as is a stored one.
   */
  private static getSortChoice(data: {
    componentType: string;
    argumentsObject: Record<string, unknown>;
    requestedSort: unknown;
  }): DashboardWidgetSortChoice | null {
    if (!getDashboardWidgetSortSpec(data.componentType)) {
      return null;
    }

    const requested: DashboardWidgetSortChoice | null =
      readDashboardWidgetSortChoiceForColumns(
        data.requestedSort,
        getDashboardWidgetSortColumns(data.componentType),
      );

    return getDashboardWidgetEffectiveSort(
      data.componentType,
      requested ||
        readDashboardWidgetSavedSort(data.componentType, data.argumentsObject),
    );
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
      /*
       * The widget's own select (MonitorListWidgetFormat): with
       * disableActiveMonitoring, so the public page says Disabled for a
       * monitor whose monitoring is off, as the app does, instead of the
       * status its last check left.
       */
      case DashboardComponentType.MonitorList:
        return {
          ...MONITOR_LIST_WIDGET_SELECT,
          currentMonitorStatus: {
            ...MONITOR_LIST_WIDGET_SELECT.currentMonitorStatus,
          },
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
      case DashboardComponentType.VMwareHostList:
        return {
          _id: true,
          name: true,
          externalId: true,
          kind: true,
          datacenterName: true,
          clusterName: true,
          latestCpuPercent: true,
          latestMemoryPercent: true,
          cpuCapacityMhz: true,
          maxMemoryBytes: true,
          metricsUpdatedAt: true,
          vmwareVCenterId: true,
          vmwareVCenter: { name: true },
        };
      case DashboardComponentType.VMwareVirtualMachineList:
        return {
          _id: true,
          name: true,
          externalId: true,
          kind: true,
          datacenterName: true,
          clusterName: true,
          hostName: true,
          resourcePoolName: true,
          isPoweredOn: true,
          isTemplate: true,
          latestCpuPercent: true,
          latestMemoryPercent: true,
          latestDiskPercent: true,
          metricsUpdatedAt: true,
          vmwareVCenterId: true,
          vmwareVCenter: { name: true },
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
      case DashboardComponentType.StorageArrayVolumeList:
        return {
          _id: true,
          name: true,
          externalId: true,
          kind: true,
          groupName: true,
          capacityBytes: true,
          usedBytes: true,
          readLatencyUsec: true,
          writeLatencyUsec: true,
          readIops: true,
          writeIops: true,
          metricsUpdatedAt: true,
          storageArrayId: true,
          storageArray: { name: true },
        };
      case DashboardComponentType.StorageArrayHardwareList:
        return {
          _id: true,
          name: true,
          externalId: true,
          kind: true,
          status: true,
          statusDetail: true,
          componentType: true,
          model: true,
          capacityBytes: true,
          temperatureCelsius: true,
          storageArrayId: true,
          storageArray: { name: true },
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
      /*
       * Exactly the seven display fields the SLO widget renders. Everything
       * else the model carries — description, slug, the bound monitors and
       * labels, the metric query config, the evaluation schedule, the archive
       * stamps, createdBy — stays private: an SLO's headline numbers are
       * publishable, its definition is not.
       */
      case DashboardComponentType.Slo:
        return {
          _id: true,
          name: true,
          targetPercentage: true,
          currentSliPercentage: true,
          errorBudgetRemainingPercentage: true,
          errorBudgetRemainingSeconds: true,
          currentBurnRate: true,
          sloStatus: true,
        };
      /*
       * The same seven per row, plus `isEnabled`. A disabled SLO is not
       * evaluated and keeps the status and budget it had when it was switched
       * off, so without the flag the list would publish that frozen status as
       * live and count it in its status strip — the browser list reads the
       * same column for the same reason. The flag says whether an objective
       * is being measured, nothing about how it is defined.
       */
      case DashboardComponentType.SloList:
        return {
          _id: true,
          name: true,
          targetPercentage: true,
          currentSliPercentage: true,
          errorBudgetRemainingPercentage: true,
          errorBudgetRemainingSeconds: true,
          currentBurnRate: true,
          sloStatus: true,
          isEnabled: true,
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
    variables: Array<DashboardVariable>;
  }): PolicyDraft {
    const { componentType, argumentsObject, requestedQuery, variables } = data;

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
          variables,
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
      case DashboardComponentType.VMwareHostList:
        return PublicDashboardResourceListPolicy.buildVMwareHostPolicy(
          argumentsObject,
        );
      case DashboardComponentType.VMwareVirtualMachineList:
        return PublicDashboardResourceListPolicy.buildVMwareVirtualMachinePolicy(
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
      case DashboardComponentType.StorageArrayVolumeList:
        return PublicDashboardResourceListPolicy.buildStorageArrayVolumePolicy(
          argumentsObject,
        );
      case DashboardComponentType.StorageArrayHardwareList:
        return PublicDashboardResourceListPolicy.buildStorageArrayHardwarePolicy(
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
      case DashboardComponentType.Slo:
        return PublicDashboardResourceListPolicy.buildSloPolicy(
          argumentsObject,
          variables,
        );
      case DashboardComponentType.SloList:
        return PublicDashboardResourceListPolicy.buildSloListPolicy(
          argumentsObject,
          variables,
        );
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

    /*
     * Unresolved, Resolved and Acknowledged are the project's to say
     * (resolvedStateFilter): by where its states sit, not by one flag.
     */
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
      argumentsObject,
      resolvedStateFilter:
        PublicDashboardResourceListPolicy.toResolvedStateFilter(stateFilter),
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

    /*
     * Unresolved, Resolved and Acknowledged are the project's to say
     * (resolvedStateFilter): by where its states sit, not by one flag.
     */
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
      resolvedStateFilter:
        PublicDashboardResourceListPolicy.toResolvedStateFilter(stateFilter),
      resourceType: "alert",
      query,
      argumentsObject,
    });
  }

  /*
   * The Monitor List widget lists what the board lists in the app: the same
   * query from the same stored settings (getMonitorListQuery). Archived
   * monitors never reach a public page, and a status filter matches only the
   * monitors that are checked - one whose monitoring is off keeps the status
   * its last check saw, so "non-operational" would publish it as down.
   */
  private static buildMonitorPolicy(
    argumentsObject: Record<string, unknown>,
    variables: Array<DashboardVariable>,
  ): PolicyDraft {
    const statusFilter: string | undefined =
      PublicDashboardResourceListPolicy.optionalEnum(
        argumentsObject,
        "statusFilter",
        MONITOR_LIST_STATUS_FILTER_VALUES,
      );
    const monitorStatusIds: Array<string> | undefined =
      PublicDashboardResourceListPolicy.optionalStringArray(
        argumentsObject,
        "monitorStatusIds",
      );

    const query: Record<string, unknown> = getMonitorListQuery({
      statusFilter,
      monitorStatusIds,
    });

    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: "monitorType",
      argumentsObject,
      argumentKey: "monitorTypes",
    });
    const labels: ReturnType<typeof DashboardLabelVariable.getFilter> =
      DashboardLabelVariable.getFilter({
        labelIds: PublicDashboardResourceListPolicy.optionalStringArray(
          argumentsObject,
          "labelIds",
        ),
        labelVariableId: PublicDashboardResourceListPolicy.optionalVariableId(
          argumentsObject,
          "labelVariableId",
        ),
        variables,
      });
    if (labels) {
      query["labels"] = labels;
    }

    return PublicDashboardResourceListPolicy.listDraft({
      resourceType: "monitor",
      query,
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
      argumentsObject,
    });
  }

  /*
   * ESXi hosts. The vcenter receiver reports no per-host power or
   * connection state, so the host widget takes only the shared arguments
   * (vCenter scope, row cap): no status filter is accepted.
   */
  private static buildVMwareHostPolicy(
    argumentsObject: Record<string, unknown>,
  ): PolicyDraft {
    const query: Record<string, unknown> = { kind: "Host" };
    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: "vmwareVCenterId",
      argumentsObject,
      argumentKey: "vmwareVCenterIds",
    });

    return {
      ...PublicDashboardResourceListPolicy.listDraft({
        resourceType: "vmware-resource",
        query,
        argumentsObject,
      }),
      attributeToColumn: VMWARE_HOST_ATTRIBUTE_TO_COLUMN,
    };
  }

  /*
   * Virtual machines (kind VirtualMachine covers VMs and VM templates;
   * templates carry isTemplate = true and a null power state).
   */
  private static buildVMwareVirtualMachinePolicy(
    argumentsObject: Record<string, unknown>,
  ): PolicyDraft {
    const query: Record<string, unknown> = { kind: "VirtualMachine" };
    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: "vmwareVCenterId",
      argumentsObject,
      argumentKey: "vmwareVCenterIds",
    });

    const powerStateFilter: string | undefined =
      PublicDashboardResourceListPolicy.optionalEnum(
        argumentsObject,
        "powerStateFilter",
        ["on", "off"],
      );
    if (powerStateFilter === "on") {
      query["isPoweredOn"] = true;
    } else if (powerStateFilter === "off") {
      query["isPoweredOn"] = false;
    }

    const templateFilter: string | undefined =
      PublicDashboardResourceListPolicy.optionalEnum(
        argumentsObject,
        "templateFilter",
        ["exclude", "only"],
      );
    if (templateFilter === "exclude") {
      query["isTemplate"] = false;
    } else if (templateFilter === "only") {
      query["isTemplate"] = true;
    }

    return {
      ...PublicDashboardResourceListPolicy.listDraft({
        resourceType: "vmware-resource",
        query,
        argumentsObject,
      }),
      attributeToColumn: VMWARE_VIRTUAL_MACHINE_ATTRIBUTE_TO_COLUMN,
    };
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
        argumentsObject,
      }),
      attributeToColumn: CEPH_POOL_ATTRIBUTE_TO_COLUMN,
    };
  }

  private static buildStorageArrayVolumePolicy(
    argumentsObject: Record<string, unknown>,
  ): PolicyDraft {
    const query: Record<string, unknown> = { kind: "Volume" };
    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: "storageArrayId",
      argumentsObject,
      argumentKey: "storageArrayIds",
    });

    return {
      ...PublicDashboardResourceListPolicy.listDraft({
        resourceType: "storage-array-resource",
        query,
        argumentsObject,
      }),
      attributeToColumn: STORAGE_ARRAY_VOLUME_ATTRIBUTE_TO_COLUMN,
    };
  }

  /*
   * Hardware components, drives and controllers. The kind is ALWAYS pinned
   * to those three — to one of them when the widget's kind filter names it —
   * so the widget can never be widened to volumes, hosts or buckets. The
   * status filter only narrows, to the statuses that count as unhealthy
   * hardware.
   */
  private static buildStorageArrayHardwarePolicy(
    argumentsObject: Record<string, unknown>,
  ): PolicyDraft {
    const kinds: Array<string> = [...STORAGE_ARRAY_HARDWARE_WIDGET_KINDS];

    const kindFilter: string | undefined =
      PublicDashboardResourceListPolicy.optionalEnum(
        argumentsObject,
        "kindFilter",
        kinds,
      );

    const query: Record<string, unknown> = {
      kind: kindFilter ? kindFilter : new Includes(kinds),
    };
    PublicDashboardResourceListPolicy.addIncludesFromArgument({
      query,
      queryKey: "storageArrayId",
      argumentsObject,
      argumentKey: "storageArrayIds",
    });

    const statusFilter: string | undefined =
      PublicDashboardResourceListPolicy.optionalEnum(
        argumentsObject,
        "statusFilter",
        [STORAGE_ARRAY_HARDWARE_UNHEALTHY_FILTER],
      );
    if (statusFilter === STORAGE_ARRAY_HARDWARE_UNHEALTHY_FILTER) {
      query["status"] = new Includes([
        ...STORAGE_ARRAY_UNHEALTHY_COMPONENT_STATUSES,
      ]);
    }

    return {
      ...PublicDashboardResourceListPolicy.listDraft({
        resourceType: "storage-array-resource",
        query,
        argumentsObject,
      }),
      attributeToColumn: STORAGE_ARRAY_HARDWARE_ATTRIBUTE_TO_COLUMN,
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

  /*
   * The SLO widget renders exactly one SLO.
   *
   * PINNED (an id stored on the widget): the stored id IS the whole query.
   * Pinning `_id` to it and capping the read at a single row means the route
   * can return that SLO's headline numbers and nothing else: it can neither
   * be walked across the project's other SLOs nor turned into a filter
   * oracle, because it accepts no filter at all.
   *
   * FOLLOWING a variable: the author bound the widget to a toolbar variable,
   * which is their opt-in to publishing whichever ACTIVE SLO a viewer names
   * (see PublicDashboardSloWidget). The name is an exact-match equality —
   * never a search, never an IN-list — archived objectives are excluded like
   * every other SLO list, and the read is capped at two rows: one to show,
   * and one more so a name two SLOs share is reported as ambiguous instead
   * of silently serving whichever sorted first.
   */
  private static buildSloPolicy(
    argumentsObject: Record<string, unknown>,
    variables: Array<DashboardVariable>,
  ): PolicyDraft {
    const config: PublicDashboardSloWidgetConfig =
      PublicDashboardSloWidget.readConfigFromArguments(
        argumentsObject,
        variables,
      );

    if (config.target.kind === PublicDashboardSloWidgetTargetKind.Pinned) {
      return {
        resourceType: "slo",
        query: { _id: config.target.serviceLevelObjectiveId },
        sort: { name: SortOrder.Ascending },
        limit: 1,
      };
    }

    return {
      resourceType: "slo",
      query: {
        name: config.target.serviceLevelObjectiveName,
        isArchived: false,
      },
      sort: { name: SortOrder.Ascending },
      limit: SLO_WIDGET_NAME_MATCH_LIMIT,
    };
  }

  /*
   * The SLO List widget publishes the headline numbers of every ACTIVE SLO in
   * the project: archived objectives are hidden from every SLO list and are
   * no longer evaluated, so their frozen numbers never reach a public page.
   * Disabled objectives are listed, but the select carries `isEnabled` so the
   * page marks them Disabled instead of presenting their frozen status as
   * live, and every order but the name's puts them after every enabled one.
   *
   * The stored status and label filters narrow it (a status filter matches
   * enabled SLOs only, through the same getSloListStatusFilterQuery the
   * browser uses), and a Telemetry Attribute variable on `sloName` narrows it
   * to the picked objective through the same column map the browser applies
   * (SLO_LIST_ATTRIBUTE_TO_COLUMN). The row cap comes from the widget, never
   * from the request; the order is the sort registry's (build).
   */
  private static buildSloListPolicy(
    argumentsObject: Record<string, unknown>,
    variables: Array<DashboardVariable>,
  ): PolicyDraft {
    const query: Record<string, unknown> = { isArchived: false };

    const sloStatuses: Array<string> | undefined =
      PublicDashboardResourceListPolicy.optionalStringArray(
        argumentsObject,
        "sloStatuses",
      );

    if (sloStatuses && sloStatuses.length > 0) {
      for (const sloStatus of sloStatuses) {
        if (
          !(SLO_LIST_STATUS_FILTER_VALUES as Array<string>).includes(sloStatus)
        ) {
          throw new BadDataException(
            "Dashboard widget sloStatuses contains an invalid value.",
          );
        }
      }

      Object.assign(query, getSloListStatusFilterQuery(sloStatuses));
    }

    const labels: ReturnType<typeof DashboardLabelVariable.getFilter> =
      DashboardLabelVariable.getFilter({
        labelIds: PublicDashboardResourceListPolicy.optionalStringArray(
          argumentsObject,
          "labelIds",
        ),
        labelVariableId: PublicDashboardResourceListPolicy.optionalVariableId(
          argumentsObject,
          "labelVariableId",
        ),
        variables,
      });

    if (labels) {
      query["labels"] = labels;
    }

    return {
      ...PublicDashboardResourceListPolicy.listDraft({
        resourceType: "slo-list",
        query,
        argumentsObject,
        // The widget's own default, so an unset maxRows reads the same page.
        fallbackLimit: SLO_LIST_DEFAULT_MAX_ROWS,
      }),
      attributeToColumn: SLO_LIST_ATTRIBUTE_TO_COLUMN,
    };
  }

  private static listDraft(data: {
    resourceType: string;
    query: Record<string, unknown>;
    // Only for a widget the sort registry does not order (the log stream).
    sort?: JSONObject | undefined;
    argumentsObject: Record<string, unknown>;
    fallbackLimit?: number | undefined;
    resolvedStateFilter?: PublicDashboardResolvedStateFilter | undefined;
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
      ...(data.resolvedStateFilter
        ? { resolvedStateFilter: data.resolvedStateFilter }
        : {}),
    };
  }

  // A list's stored state filter: the states the project's lists say.
  private static toResolvedStateFilter(
    stateFilter: string | undefined,
  ): PublicDashboardResolvedStateFilter | undefined {
    if (
      stateFilter === "unresolved" ||
      stateFilter === "resolved" ||
      stateFilter === "acknowledged"
    ) {
      return stateFilter;
    }

    return undefined;
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
      const text: string | null =
        PublicDashboardResourceListPolicy.readListValue(item);
      if (text === null || text.length === 0) {
        throw new BadDataException(
          `Dashboard widget ${key} contains an invalid value.`,
        );
      }
      values.push(text);
    }
    return values;
  }

  /*
   * One value of a list a widget filters by, as the page filters by it:
   * text, or an id stored as an ObjectID (`{"_type": "ObjectID", "value":
   * ...}`), revived or left as that JSON (issue #6315) - read by the one
   * reader every board reads a widget's ids with (DashboardWidgetIds, issue
   * #6328). Null for anything else - a number, a list, a query operator, a
   * date - in either encoding, which is refused as before.
   */
  private static readListValue(item: unknown): string | null {
    return DashboardWidgetIds.readId(item);
  }

  /*
   * The id of the variable a widget follows, as the page reads it: text, or
   * an ObjectID stored as its JSON (DashboardWidgetIds, issue #6328). Left
   * out, null or empty is none; anything else that names no id is refused,
   * as a typed value in a text setting is.
   */
  private static optionalVariableId(
    object: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const value: unknown = object[key];
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    const id: string | null = DashboardWidgetIds.readId(value);
    if (id === null) {
      throw new BadDataException(`Dashboard widget ${key} must be a string.`);
    }

    return id.length > 0 ? id : undefined;
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

  /*
   * A stored row cap: a number, or text that says one. A value revived from
   * typed JSON - a date, an ObjectID, a query operator - is read as its JSON
   * is, as no number at all, and so is any other object: Number() of a date
   * is its time in milliseconds, which would read as the project's ceiling
   * (issue #6315).
   */
  private static storedLimit(data: {
    value: unknown;
    fallback: number;
    ceiling: number;
  }): number {
    if (
      data.value !== null &&
      typeof data.value === "object" &&
      !Array.isArray(data.value)
    ) {
      return data.fallback;
    }

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

  /*
   * The dashboard variables a public widget's query reads, each with the
   * viewer's pick: the Telemetry Attribute and Project Label variables of the
   * toolbar the public page draws, with the selection the request sends under
   * each one's id.
   *
   * `variables` are the ones the page draws (PublicDashboardViewConfig.
   * getDrawnConfig), not the stored list: every board reads a stored list
   * written as JSON text, a variable without an id or with one an earlier
   * variable has (each drawn under an id of its own - the id the page then
   * sends its pick under), `isMultiSelect` written as "true" and a default
   * written as a number, and so these are read here as the toolbar reads
   * them. Read as stored, any one of them refused every list and SLO widget
   * on the dashboard (issue #6315).
   *
   * Every id, type, attribute key, default and label choice comes from the
   * drawn variables; the request only ever contributes bounded selected
   * values. A pick is read for the one drawn variable under its id, never for
   * another - a pick under an id no drawn variable has is not read at all -
   * and is applied by that variable's own type and key, through the helpers
   * the signed-in widgets use: a label pick must be one of its own variable's
   * choices (DashboardLabelVariable.getFilter).
   *
   * Public so the SLO history route resolves a viewer's toolbar selections
   * through exactly the same validation as this route.
   */
  public static resolveDashboardVariableSelections(data: {
    variables: Array<DashboardVariable> | undefined;
    requestedVariables: unknown;
  }): Array<DashboardVariable> {
    const requestedSelections: Map<
      string,
      Record<string, unknown>
    > = PublicDashboardResourceListPolicy.validateRequestedVariableSelections(
      data.requestedVariables,
    );
    const variables: Array<DashboardVariable> = [];
    const drawnIds: Set<string> = new Set<string>();

    for (const drawnValue of data.variables || []) {
      const drawn: Record<string, unknown> =
        PublicDashboardResourceListPolicy.requireObject(
          drawnValue,
          "Dashboard variable",
        );
      const type: unknown = drawn["type"];
      if (
        type !== DashboardVariableType.TelemetryAttribute &&
        type !== DashboardVariableType.ProjectLabel
      ) {
        continue;
      }

      /*
       * The page draws every variable under an id of its own, as text, and
       * reads its other fields in the types the toolbar reads them in. These
       * checks hold for every variable it draws: one they do not hold for is
       * not a variable the page draws, and is refused.
       */
      const id: unknown = drawn["id"];
      if (
        typeof id !== "string" ||
        id.length === 0 ||
        id.length > MAX_VARIABLE_ID_LENGTH
      ) {
        throw new BadDataException("Stored dashboard variable is malformed.");
      }
      if (drawnIds.has(id)) {
        throw new BadDataException("Dashboard variable IDs must be unique.");
      }
      drawnIds.add(id);

      const isMultiSelect: unknown = drawn["isMultiSelect"];
      if (
        isMultiSelect !== undefined &&
        isMultiSelect !== null &&
        typeof isMultiSelect !== "boolean"
      ) {
        throw new BadDataException("Stored dashboard variable is malformed.");
      }

      const defaultValue: unknown = drawn["defaultValue"];
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
      const name: unknown = drawn["name"];
      const storedIsMultiSelect: boolean = isMultiSelect === true;

      const variable: DashboardVariable = {
        id,
        name: typeof name === "string" ? name : "",
        type,
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
      };

      if (type === DashboardVariableType.ProjectLabel) {
        /*
         * The choices as the toolbar offers them. Whether they are choices a
         * label filter can use, and the pick one of them, is for
         * DashboardLabelVariable.getFilter to say when a widget filters by
         * this variable - as on the page, where choices no widget filters
         * by take no other widget down.
         */
        const labelOptions: unknown = drawn["labelOptions"];
        variable.labelOptions = Array.isArray(labelOptions)
          ? ([...labelOptions] as NonNullable<
              DashboardVariable["labelOptions"]
            >)
          : undefined;
      } else {
        /*
         * The key as the page reads it, untrimmed. A variable without one
         * filters no list, here as on the page (DashboardModelQueryInterpolation,
         * DashboardVariableInterpolation), and an SLO widget may still follow
         * its pick by name (SloWidgetSource).
         */
        const attributeKey: unknown = drawn["attributeKey"];
        if (
          attributeKey !== undefined &&
          attributeKey !== null &&
          (typeof attributeKey !== "string" ||
            attributeKey.length > MAX_VARIABLE_VALUE_LENGTH)
        ) {
          throw new BadDataException("Stored dashboard variable is malformed.");
        }
        variable.attributeKey =
          typeof attributeKey === "string" ? attributeKey : undefined;
      }

      variables.push(variable);
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

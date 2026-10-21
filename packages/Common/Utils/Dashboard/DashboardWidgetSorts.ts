import Includes from "../../Types/BaseDatabase/Includes";
import IncludesNone from "../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../Types/BaseDatabase/IsNull";
import NotNull from "../../Types/BaseDatabase/NotNull";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import DashboardComponentType from "../../Types/Dashboard/DashboardComponentType";
import {
  DASHBOARD_WIDGET_SORT_ARGUMENT,
  DashboardWidgetSortChoice,
  DashboardWidgetSortColumnInfo,
  DashboardWidgetSortDirection,
  DashboardWidgetSortKind,
  findDashboardWidgetSortColumn,
  formatDashboardWidgetSortChoice,
  parseDashboardWidgetSortChoice,
  readDashboardWidgetSortChoiceForColumns,
} from "../../Types/Dashboard/DashboardWidgetSort";
import { JSONObject } from "../../Types/JSON";
import StoredDashboardViewConfig from "./StoredDashboardViewConfig";
import {
  STORAGE_ARRAY_CRITICAL_COMPONENT_STATUSES,
  STORAGE_ARRAY_WARNING_COMPONENT_STATUSES,
} from "./Components/DashboardStorageArrayResourceListShared";

/*
 * The columns each dashboard list widget can be sorted by, and how the
 * database orders the whole list by each (issue #5082).
 *
 * One registry, read by the widget in the browser (its headers, its query,
 * the Sort choice in its settings) and by the server for a public
 * dashboard (PublicDashboardResourceListPolicy), so a column a header
 * offers is always one the server orders by, and a public request can name
 * nothing else.
 *
 * Sorting happens where the rows are: a widget shows at most its Max Rows,
 * and sorting only the rows it fetched would show "the worst of the newest
 * 25" as if it were the worst. A column the database cannot order the list
 * by - a ratio drawn from two columns, a list of pressures - offers no sort.
 *
 * Status and severity columns sort by what they mean, worst first, in the
 * order each project keeps itself: a monitor status's priority (the higher,
 * the worse), an incident or alert severity's and state's order (the lower,
 * the worse). An up / ready / powered flag puts the down ones first. A
 * status written as a word (a pod's phase, a storage component's status,
 * a Ceph OSD's up and in flags together) is read rank by rank instead,
 * worst rank first (`ranks`): one query per rank, stopping as soon as the
 * widget has its rows.
 *
 * The order each widget always had is its `defaultSort`, and rows a column
 * ties on keep that order's own tie-break (`thenBy`), so a widget saved
 * without a sort lists exactly as before.
 *
 * React-free, browser-free and server-safe.
 */

/*
 * One database field a column orders by. `path` is the model's field, or a
 * related record's ("currentMonitorStatus.priority"), which the read must
 * then select (getDashboardWidgetListSortSelect).
 */
export interface DashboardWidgetSortField {
  path: string;
  // The database order when the column is sorted descending (worst first).
  whenDescending: SortOrder;
  /*
   * Rows with no value stay at the bottom both ways. Without it they sort
   * as the database places them: after every value ascending, before every
   * value descending - which is what a host that has never connected, read
   * as Disconnected, wants.
   */
  nullsLast?: boolean | undefined;
  /*
   * Holds its order whichever way the column runs: a disabled SLO, which
   * is not evaluated, stays after every enabled one both ways.
   */
  bothWays?: boolean | undefined;
}

/*
 * A status the database cannot order by its meaning, read rank by rank:
 * each rank is the query conditions its rows meet, worst rank first, and
 * no row meets two ranks' conditions. `unranked` reads the rest - no
 * status yet, a value this version does not know - last both ways.
 */
export interface DashboardWidgetSortRanks {
  ranks: Array<JSONObject>;
  unranked: Array<JSONObject>;
}

export interface DashboardWidgetListSortColumn
  extends DashboardWidgetSortColumnInfo {
  // The fields the database orders the column by, in order.
  fields?: Array<DashboardWidgetSortField> | undefined;
  // Or, for a status written as a word, the ranks it is read in.
  ranks?: DashboardWidgetSortRanks | undefined;
}

export interface DashboardWidgetSortTieBreak {
  path: string;
  order: SortOrder;
  nullsLast?: boolean | undefined;
}

export interface DashboardWidgetListSortSpec {
  columns: Array<DashboardWidgetListSortColumn>;
  // The order the widget always had, as the column choice that means it.
  defaultSort: DashboardWidgetSortChoice;
  /*
   * How rows the chosen column ties on are ordered, whichever way it runs:
   * the widget's own order, so equal statuses still list by name.
   */
  thenBy: Array<DashboardWidgetSortTieBreak>;
}

// One read of a list: the query and the database order.
export interface DashboardWidgetListReadStep {
  query: JSONObject;
  sort: JSONObject;
}

const ASC: SortOrder = SortOrder.Ascending;
const DESC: SortOrder = SortOrder.Descending;

// -- Column builders --------------------------------------------------------

function textColumn(data: {
  key: string;
  title: string;
  path: string | Array<string>;
}): DashboardWidgetListSortColumn {
  const paths: Array<string> = Array.isArray(data.path)
    ? data.path
    : [data.path];

  return {
    key: data.key,
    title: data.title,
    kind: DashboardWidgetSortKind.Text,
    // Descending text is Z to A, with rows that have none at the bottom.
    fields: paths.map((path: string): DashboardWidgetSortField => {
      return { path, whenDescending: DESC, nullsLast: true };
    }),
  };
}

function numberColumn(data: {
  key: string;
  title: string;
  path: string;
  firstDirection?: DashboardWidgetSortDirection | undefined;
}): DashboardWidgetListSortColumn {
  return {
    key: data.key,
    title: data.title,
    kind: DashboardWidgetSortKind.Number,
    ...(data.firstDirection ? { firstDirection: data.firstDirection } : {}),
    // A row with no reading yet is never the highest, nor the lowest.
    fields: [{ path: data.path, whenDescending: DESC, nullsLast: true }],
  };
}

/*
 * A time. `isAlwaysSet` for one every row has (when a record was
 * created): its order is then written plainly, as the lists always wrote it.
 */
function dateColumn(data: {
  key: string;
  title: string;
  path: string;
  isAlwaysSet?: boolean | undefined;
}): DashboardWidgetListSortColumn {
  return {
    key: data.key,
    title: data.title,
    kind: DashboardWidgetSortKind.Date,
    fields: [
      {
        path: data.path,
        whenDescending: DESC,
        ...(data.isAlwaysSet ? {} : { nullsLast: true }),
      },
    ],
  };
}

/*
 * An up / ready / powered-on flag: worst first is the false ones first
 * (false sorts before true), and a row that has not said is last both ways.
 */
function flagStatusColumn(data: {
  key: string;
  title: string;
  path: string;
}): DashboardWidgetListSortColumn {
  return {
    key: data.key,
    title: data.title,
    kind: DashboardWidgetSortKind.Status,
    fields: [{ path: data.path, whenDescending: ASC, nullsLast: true }],
  };
}

/*
 * A status kept as a project's own ordered list, read through the related
 * record's place in it. `worseIs` says which way the number grows.
 */
function orderedStatusColumn(data: {
  key: string;
  title: string;
  path: string;
  worseIs: "higher" | "lower";
}): DashboardWidgetListSortColumn {
  return {
    key: data.key,
    title: data.title,
    kind: DashboardWidgetSortKind.Status,
    fields: [
      {
        path: data.path,
        whenDescending: data.worseIs === "higher" ? DESC : ASC,
        nullsLast: true,
      },
    ],
  };
}

// -- Shared columns -----------------------------------------------------------

/*
 * A host's collector status, "connected" or "disconnected": worst first is
 * descending ("disconnected" sorts after "connected"), and a host that has
 * never connected - drawn as Disconnected - sorts with the disconnected
 * ones, as the database places no value before every value descending.
 */
function collectorStatusColumn(): DashboardWidgetListSortColumn {
  return {
    key: "status",
    title: "Status",
    kind: DashboardWidgetSortKind.Status,
    fields: [{ path: "otelCollectorStatus", whenDescending: DESC }],
  };
}

const BY_NAME: Array<DashboardWidgetSortTieBreak> = [
  { path: "name", order: ASC, nullsLast: true },
];

const NAME_ASCENDING: DashboardWidgetSortChoice = {
  column: "name",
  direction: DashboardWidgetSortDirection.Ascending,
};

// -- Kubernetes -----------------------------------------------------------------

/*
 * A pod's phase, worst rank first: Failed, Unknown (its node stopped
 * reporting), Pending, then the healthy Running and Succeeded together. A
 * phase this version does not know, and none at all, come last.
 */
export const KUBERNETES_POD_PHASE_RANKS: Array<Array<string>> = [
  ["Failed"],
  ["Unknown"],
  ["Pending"],
  ["Running", "Succeeded"],
];

function kubernetesPodPhaseColumn(): DashboardWidgetListSortColumn {
  const known: Array<string> = KUBERNETES_POD_PHASE_RANKS.flat();

  return {
    key: "phase",
    title: "Phase",
    kind: DashboardWidgetSortKind.Status,
    ranks: {
      ranks: KUBERNETES_POD_PHASE_RANKS.map((phases: Array<string>) => {
        return { phase: new Includes(phases) };
      }),
      unranked: [{ phase: new IncludesNone(known) }, { phase: new IsNull() }],
    },
  };
}

function kubernetesCluster(): DashboardWidgetListSortColumn {
  return textColumn({
    key: "cluster",
    title: "Cluster",
    path: "kubernetesCluster.name",
  });
}

function kubernetesNamespacedSpec(
  nameTitle: string,
  extraColumns: Array<DashboardWidgetListSortColumn> = [],
): DashboardWidgetListSortSpec {
  return {
    columns: [
      textColumn({ key: "name", title: nameTitle, path: "name" }),
      textColumn({
        key: "namespace",
        title: "Namespace",
        path: "namespaceKey",
      }),
      ...extraColumns,
      kubernetesCluster(),
    ],
    // The order these lists always had: namespace, then name.
    defaultSort: {
      column: "namespace",
      direction: DashboardWidgetSortDirection.Ascending,
    },
    thenBy: [
      { path: "namespaceKey", order: ASC, nullsLast: true },
      { path: "name", order: ASC, nullsLast: true },
    ],
  };
}

/*
 * Nodes and namespaces hold no namespace of their own, so the order they
 * always had (namespace, then name) is by name.
 */
function kubernetesClusterScopedSpec(
  nameTitle: string,
  extraColumns: Array<DashboardWidgetListSortColumn> = [],
): DashboardWidgetListSortSpec {
  return {
    columns: [
      textColumn({ key: "name", title: nameTitle, path: "name" }),
      ...extraColumns,
      kubernetesCluster(),
    ],
    defaultSort: NAME_ASCENDING,
    thenBy: [
      { path: "namespaceKey", order: ASC, nullsLast: true },
      { path: "name", order: ASC, nullsLast: true },
    ],
  };
}

// -- Docker and Podman -------------------------------------------------------

function containerHostSpec(): DashboardWidgetListSortSpec {
  return {
    columns: [
      textColumn({ key: "name", title: "Host", path: "name" }),
      collectorStatusColumn(),
      // The running count leads the cell ("3 / 1"), so it is what sorts.
      numberColumn({
        key: "containers",
        title: "Containers",
        path: "containersRunning",
      }),
      textColumn({ key: "os", title: "OS", path: ["osType", "osVersion"] }),
    ],
    defaultSort: NAME_ASCENDING,
    thenBy: BY_NAME,
  };
}

function containerSpec(hostRelation: string): DashboardWidgetListSortSpec {
  return {
    columns: [
      textColumn({ key: "name", title: "Container", path: "name" }),
      textColumn({ key: "image", title: "Image", path: "imageName" }),
      numberColumn({ key: "cpu", title: "CPU %", path: "latestCpuPercent" }),
      numberColumn({
        key: "memory",
        title: "Memory",
        path: "latestMemoryBytes",
      }),
      textColumn({ key: "host", title: "Host", path: `${hostRelation}.name` }),
    ],
    defaultSort: NAME_ASCENDING,
    thenBy: BY_NAME,
  };
}

function imageSpec(hostRelation: string): DashboardWidgetListSortSpec {
  return {
    columns: [
      textColumn({ key: "name", title: "Image", path: "name" }),
      textColumn({ key: "host", title: "Host", path: `${hostRelation}.name` }),
    ],
    defaultSort: NAME_ASCENDING,
    thenBy: BY_NAME,
  };
}

// A network's or volume's driver and scope are kept in `state`.
function containerInventorySpec(
  nameTitle: string,
  hostRelation: string,
): DashboardWidgetListSortSpec {
  return {
    columns: [
      textColumn({ key: "name", title: nameTitle, path: "name" }),
      textColumn({ key: "driver", title: "Driver / Scope", path: "state" }),
      textColumn({ key: "host", title: "Host", path: `${hostRelation}.name` }),
    ],
    defaultSort: NAME_ASCENDING,
    thenBy: BY_NAME,
  };
}

// -- Ceph -------------------------------------------------------------------------

/*
 * An OSD's state, from its up and in flags, worst rank first: down but in
 * (data degraded while Ceph waits to rebalance), up but out (draining),
 * down and out (already re-replicated around), up and in. An OSD missing
 * either flag comes last.
 */
function cephOsdStateColumn(): DashboardWidgetListSortColumn {
  return {
    key: "state",
    title: "State",
    kind: DashboardWidgetSortKind.Status,
    ranks: {
      ranks: [
        { isUp: false, isIn: true },
        { isUp: true, isIn: false },
        { isUp: false, isIn: false },
        { isUp: true, isIn: true },
      ],
      unranked: [
        { isUp: new IsNull() },
        { isUp: new NotNull(), isIn: new IsNull() },
      ],
    },
  };
}

// -- Storage arrays ----------------------------------------------------------

/*
 * A hardware component's status as ingest stores it (lowercase), worst
 * rank first: the statuses that make an array Critical, then those that
 * make it Warning, then every other status a component reports (ok, not
 * installed, unused, ...). A component that reports none comes last.
 */
function storageHardwareStatusColumn(): DashboardWidgetListSortColumn {
  const problems: Array<string> = [
    ...STORAGE_ARRAY_CRITICAL_COMPONENT_STATUSES,
    ...STORAGE_ARRAY_WARNING_COMPONENT_STATUSES,
  ];

  return {
    key: "status",
    title: "Status",
    kind: DashboardWidgetSortKind.Status,
    ranks: {
      ranks: [
        {
          status: new Includes([...STORAGE_ARRAY_CRITICAL_COMPONENT_STATUSES]),
        },
        { status: new Includes([...STORAGE_ARRAY_WARNING_COMPONENT_STATUSES]) },
        { status: new IncludesNone(problems) },
      ],
      unranked: [{ status: new IsNull() }],
    },
  };
}

// -- The registry ------------------------------------------------------------

const DASHBOARD_WIDGET_SORT_SPECS: Partial<
  Record<DashboardComponentType, DashboardWidgetListSortSpec>
> = {
  [DashboardComponentType.MonitorList]: {
    columns: [
      textColumn({ key: "name", title: "Name", path: "name" }),
      orderedStatusColumn({
        key: "status",
        title: "Status",
        path: "currentMonitorStatus.priority",
        worseIs: "higher",
      }),
      textColumn({ key: "type", title: "Type", path: "monitorType" }),
    ],
    defaultSort: NAME_ASCENDING,
    thenBy: BY_NAME,
  },
  [DashboardComponentType.IncidentList]: {
    columns: [
      textColumn({ key: "title", title: "Title", path: "title" }),
      orderedStatusColumn({
        key: "state",
        title: "State",
        path: "currentIncidentState.order",
        worseIs: "lower",
      }),
      orderedStatusColumn({
        key: "severity",
        title: "Severity",
        path: "incidentSeverity.order",
        worseIs: "lower",
      }),
      dateColumn({
        key: "declared",
        title: "Declared",
        path: "createdAt",
        isAlwaysSet: true,
      }),
    ],
    defaultSort: {
      column: "declared",
      direction: DashboardWidgetSortDirection.Descending,
    },
    thenBy: [{ path: "createdAt", order: DESC }],
  },
  [DashboardComponentType.AlertList]: {
    columns: [
      textColumn({ key: "title", title: "Title", path: "title" }),
      orderedStatusColumn({
        key: "state",
        title: "State",
        path: "currentAlertState.order",
        worseIs: "lower",
      }),
      orderedStatusColumn({
        key: "severity",
        title: "Severity",
        path: "alertSeverity.order",
        worseIs: "lower",
      }),
      dateColumn({
        key: "created",
        title: "Created",
        path: "createdAt",
        isAlwaysSet: true,
      }),
    ],
    defaultSort: {
      column: "created",
      direction: DashboardWidgetSortDirection.Descending,
    },
    thenBy: [{ path: "createdAt", order: DESC }],
  },
  /*
   * An SLO's status is worked out from its error budget - exhausted, then
   * at risk, then healthy - so its status sorts by the budget left, least
   * first. A disabled SLO is not evaluated and its numbers are frozen where
   * they were, so it never ranks among the measured ones: by status,
   * budget, SLI or burn rate every disabled SLO comes after every enabled
   * one (Postgres sorts false before true, so isEnabled descending), as the
   * list always ordered them (Utils/Slo/SloListWidgetFormat SLO_LIST_SORT).
   */
  [DashboardComponentType.SloList]: {
    columns: [
      textColumn({ key: "name", title: "SLO", path: "name" }),
      {
        key: "status",
        title: "Status",
        kind: DashboardWidgetSortKind.Status,
        fields: [
          { path: "isEnabled", whenDescending: DESC, bothWays: true },
          {
            path: "errorBudgetRemainingPercentage",
            whenDescending: ASC,
            nullsLast: true,
          },
        ],
      },
      {
        key: "sli",
        title: "SLI",
        kind: DashboardWidgetSortKind.Number,
        firstDirection: DashboardWidgetSortDirection.Ascending,
        fields: [
          { path: "isEnabled", whenDescending: DESC, bothWays: true },
          {
            path: "currentSliPercentage",
            whenDescending: DESC,
            nullsLast: true,
          },
        ],
      },
      {
        key: "errorBudget",
        title: "Error Budget",
        kind: DashboardWidgetSortKind.Number,
        firstDirection: DashboardWidgetSortDirection.Ascending,
        fields: [
          { path: "isEnabled", whenDescending: DESC, bothWays: true },
          {
            path: "errorBudgetRemainingPercentage",
            whenDescending: DESC,
            nullsLast: true,
          },
        ],
      },
      {
        key: "burnRate",
        title: "Burn Rate",
        kind: DashboardWidgetSortKind.Number,
        fields: [
          { path: "isEnabled", whenDescending: DESC, bothWays: true },
          { path: "currentBurnRate", whenDescending: DESC, nullsLast: true },
        ],
      },
    ],
    defaultSort: {
      column: "errorBudget",
      direction: DashboardWidgetSortDirection.Ascending,
    },
    thenBy: BY_NAME,
  },
  [DashboardComponentType.HostList]: {
    columns: [
      textColumn({ key: "name", title: "Host", path: "name" }),
      collectorStatusColumn(),
      textColumn({ key: "os", title: "OS", path: ["osType", "osVersion"] }),
      dateColumn({ key: "lastSeen", title: "Last Seen", path: "lastSeenAt" }),
    ],
    defaultSort: NAME_ASCENDING,
    thenBy: BY_NAME,
  },
  [DashboardComponentType.KubernetesPodList]: kubernetesNamespacedSpec("Pod", [
    kubernetesPodPhaseColumn(),
  ]),
  [DashboardComponentType.KubernetesNodeList]: kubernetesClusterScopedSpec(
    "Node",
    [flagStatusColumn({ key: "status", title: "Status", path: "isReady" })],
  ),
  [DashboardComponentType.KubernetesNamespaceList]:
    kubernetesClusterScopedSpec("Namespace"),
  [DashboardComponentType.KubernetesDeploymentList]:
    kubernetesNamespacedSpec("Deployment"),
  [DashboardComponentType.KubernetesStatefulSetList]:
    kubernetesNamespacedSpec("StatefulSet"),
  [DashboardComponentType.KubernetesDaemonSetList]:
    kubernetesNamespacedSpec("DaemonSet"),
  [DashboardComponentType.KubernetesJobList]: kubernetesNamespacedSpec("Job"),
  [DashboardComponentType.KubernetesCronJobList]:
    kubernetesNamespacedSpec("CronJob"),
  [DashboardComponentType.DockerHostList]: containerHostSpec(),
  [DashboardComponentType.PodmanHostList]: containerHostSpec(),
  [DashboardComponentType.DockerContainerList]: containerSpec("dockerHost"),
  [DashboardComponentType.PodmanContainerList]: containerSpec("podmanHost"),
  [DashboardComponentType.DockerImageList]: imageSpec("dockerHost"),
  [DashboardComponentType.PodmanImageList]: imageSpec("podmanHost"),
  [DashboardComponentType.DockerNetworkList]: containerInventorySpec(
    "Network",
    "dockerHost",
  ),
  [DashboardComponentType.PodmanNetworkList]: containerInventorySpec(
    "Network",
    "podmanHost",
  ),
  [DashboardComponentType.DockerVolumeList]: containerInventorySpec(
    "Volume",
    "dockerHost",
  ),
  [DashboardComponentType.PodmanVolumeList]: containerInventorySpec(
    "Volume",
    "podmanHost",
  ),
  [DashboardComponentType.ProxmoxNodeList]: {
    columns: [
      textColumn({ key: "name", title: "Node", path: "name" }),
      flagStatusColumn({ key: "status", title: "Status", path: "isUp" }),
      numberColumn({ key: "cpu", title: "CPU", path: "latestCpuPercent" }),
      numberColumn({
        key: "memory",
        title: "Memory",
        path: "latestMemoryPercent",
      }),
      textColumn({
        key: "cluster",
        title: "Cluster",
        path: "proxmoxCluster.name",
      }),
    ],
    defaultSort: NAME_ASCENDING,
    thenBy: BY_NAME,
  },
  /*
   * A guest's status is Running or Stopped by its up flag; an HA error is
   * drawn over it but is not a rank of its own.
   */
  [DashboardComponentType.ProxmoxGuestList]: {
    columns: [
      textColumn({ key: "name", title: "Guest", path: "name" }),
      numberColumn({
        key: "vmid",
        title: "VMID",
        path: "vmid",
        firstDirection: DashboardWidgetSortDirection.Ascending,
      }),
      textColumn({ key: "type", title: "Type", path: "guestType" }),
      flagStatusColumn({ key: "status", title: "Status", path: "isUp" }),
      textColumn({ key: "node", title: "Node", path: "parentNodeName" }),
      textColumn({
        key: "cluster",
        title: "Cluster",
        path: "proxmoxCluster.name",
      }),
    ],
    defaultSort: NAME_ASCENDING,
    thenBy: BY_NAME,
  },
  [DashboardComponentType.VMwareHostList]: {
    columns: [
      textColumn({ key: "name", title: "Host", path: "name" }),
      numberColumn({ key: "cpu", title: "CPU", path: "latestCpuPercent" }),
      numberColumn({
        key: "memory",
        title: "Memory",
        path: "latestMemoryPercent",
      }),
      textColumn({ key: "cluster", title: "Cluster", path: "clusterName" }),
      textColumn({
        key: "vcenter",
        title: "vCenter",
        path: "vmwareVCenter.name",
      }),
    ],
    defaultSort: NAME_ASCENDING,
    thenBy: BY_NAME,
  },
  [DashboardComponentType.VMwareVirtualMachineList]: {
    columns: [
      textColumn({
        key: "name",
        title: "Virtual Machine",
        path: "name",
      }),
      // Powered off first; templates, which have no power state, last.
      flagStatusColumn({ key: "power", title: "Power", path: "isPoweredOn" }),
      numberColumn({ key: "cpu", title: "CPU", path: "latestCpuPercent" }),
      numberColumn({
        key: "memory",
        title: "Memory",
        path: "latestMemoryPercent",
      }),
      textColumn({ key: "host", title: "Host", path: "hostName" }),
      textColumn({
        key: "vcenter",
        title: "vCenter",
        path: "vmwareVCenter.name",
      }),
    ],
    defaultSort: NAME_ASCENDING,
    thenBy: BY_NAME,
  },
  [DashboardComponentType.DockerSwarmNodeList]: {
    columns: [
      textColumn({ key: "name", title: "Node", path: "name" }),
      textColumn({ key: "role", title: "Role", path: "role" }),
      flagStatusColumn({ key: "status", title: "Status", path: "isReady" }),
      numberColumn({ key: "cpu", title: "CPU", path: "latestCpuPercent" }),
      numberColumn({
        key: "memory",
        title: "Memory",
        path: "latestMemoryPercent",
      }),
      textColumn({
        key: "cluster",
        title: "Cluster",
        path: "dockerSwarmCluster.name",
      }),
    ],
    defaultSort: NAME_ASCENDING,
    thenBy: BY_NAME,
  },
  [DashboardComponentType.DockerSwarmServiceList]: {
    columns: [
      textColumn({
        key: "name",
        title: "Service",
        path: "name",
      }),
      textColumn({ key: "mode", title: "Mode", path: "serviceMode" }),
      // The running count leads the cell ("2 / 3").
      numberColumn({
        key: "replicas",
        title: "Replicas",
        path: "runningReplicas",
      }),
      flagStatusColumn({ key: "status", title: "Status", path: "isReady" }),
      textColumn({ key: "image", title: "Image", path: "image" }),
    ],
    defaultSort: NAME_ASCENDING,
    thenBy: BY_NAME,
  },
  /*
   * OSDs are named by their daemon ("osd.3"), which is what the OSD column
   * shows and what the list always sorted by.
   */
  [DashboardComponentType.CephOsdList]: {
    columns: [
      textColumn({ key: "name", title: "OSD", path: "externalId" }),
      textColumn({ key: "host", title: "Host", path: "hostname" }),
      cephOsdStateColumn(),
      textColumn({
        key: "cluster",
        title: "Cluster",
        path: "cephCluster.name",
      }),
    ],
    defaultSort: NAME_ASCENDING,
    thenBy: [{ path: "externalId", order: ASC, nullsLast: true }],
  },
  [DashboardComponentType.CephPoolList]: {
    columns: [
      textColumn({ key: "name", title: "Pool", path: "name" }),
      numberColumn({ key: "stored", title: "Stored", path: "storedBytes" }),
      numberColumn({ key: "objects", title: "Objects", path: "objects" }),
      textColumn({
        key: "cluster",
        title: "Cluster",
        path: "cephCluster.name",
      }),
    ],
    defaultSort: NAME_ASCENDING,
    thenBy: BY_NAME,
  },
  [DashboardComponentType.StorageArrayVolumeList]: {
    columns: [
      textColumn({ key: "name", title: "Volume", path: "name" }),
      // The used amount leads the cell ("2 TB of 4 TB").
      numberColumn({
        key: "used",
        title: "Used / Provisioned",
        path: "usedBytes",
      }),
      textColumn({ key: "array", title: "Array", path: "storageArray.name" }),
    ],
    defaultSort: NAME_ASCENDING,
    thenBy: BY_NAME,
  },
  [DashboardComponentType.StorageArrayHardwareList]: {
    columns: [
      textColumn({
        key: "name",
        title: "Component",
        path: "name",
      }),
      textColumn({
        key: "type",
        title: "Type",
        path: ["kind", "componentType"],
      }),
      storageHardwareStatusColumn(),
      textColumn({ key: "array", title: "Array", path: "storageArray.name" }),
    ],
    defaultSort: NAME_ASCENDING,
    thenBy: BY_NAME,
  },
  /*
   * Spans in the dashboard's time range. Status is the span status code:
   * Error (2) worst, then Ok (1), then Unset (0).
   */
  [DashboardComponentType.TraceList]: {
    columns: [
      {
        key: "name",
        title: "Span Name",
        kind: DashboardWidgetSortKind.Text,
        fields: [{ path: "name", whenDescending: DESC }],
      },
      {
        key: "duration",
        title: "Duration",
        kind: DashboardWidgetSortKind.Number,
        fields: [{ path: "durationUnixNano", whenDescending: DESC }],
      },
      {
        key: "status",
        title: "Status",
        kind: DashboardWidgetSortKind.Status,
        fields: [{ path: "statusCode", whenDescending: DESC }],
      },
      {
        key: "time",
        title: "Time",
        kind: DashboardWidgetSortKind.Date,
        fields: [{ path: "startTime", whenDescending: DESC }],
      },
    ],
    defaultSort: {
      column: "time",
      direction: DashboardWidgetSortDirection.Descending,
    },
    thenBy: [{ path: "startTime", order: DESC }],
  },
  /*
   * Security events in the dashboard's time range. Severity is the OCSF
   * severity id, which grows with the severity (Informational 1 to Fatal
   * 6).
   */
  [DashboardComponentType.SecurityEventsList]: {
    columns: [
      {
        key: "time",
        title: "Time",
        kind: DashboardWidgetSortKind.Date,
        fields: [{ path: "time", whenDescending: DESC }],
      },
      {
        key: "severity",
        title: "Severity",
        kind: DashboardWidgetSortKind.Status,
        fields: [{ path: "severityId", whenDescending: DESC }],
      },
      {
        key: "class",
        title: "Class",
        kind: DashboardWidgetSortKind.Text,
        fields: [{ path: "className", whenDescending: DESC }],
      },
      {
        key: "host",
        title: "Host",
        kind: DashboardWidgetSortKind.Text,
        fields: [{ path: "principalHost", whenDescending: DESC }],
      },
    ],
    defaultSort: {
      column: "time",
      direction: DashboardWidgetSortDirection.Descending,
    },
    thenBy: [{ path: "time", order: DESC }],
  },
  /*
   * The trace table's rows are groups of spans, summed up in ClickHouse;
   * the server orders them by the column's aggregate
   * (TraceAggregationService TRACE_ANALYTICS_TABLE_SORT_COLUMNS), so these
   * columns name no model field. The group column's header is the
   * dimension the table is grouped by.
   */
  [DashboardComponentType.TraceTable]: {
    columns: [
      {
        key: "group",
        title: "Group",
        kind: DashboardWidgetSortKind.Text,
      },
      {
        key: "count",
        title: "Requests",
        kind: DashboardWidgetSortKind.Number,
      },
      {
        key: "errorCount",
        title: "Errors",
        kind: DashboardWidgetSortKind.Number,
      },
      { key: "avg", title: "Avg", kind: DashboardWidgetSortKind.Number },
      { key: "p50", title: "P50", kind: DashboardWidgetSortKind.Number },
      { key: "p90", title: "P90", kind: DashboardWidgetSortKind.Number },
      { key: "p95", title: "P95", kind: DashboardWidgetSortKind.Number },
      { key: "p99", title: "P99", kind: DashboardWidgetSortKind.Number },
      { key: "min", title: "Min", kind: DashboardWidgetSortKind.Number },
      { key: "max", title: "Max", kind: DashboardWidgetSortKind.Number },
    ],
    defaultSort: {
      column: "count",
      direction: DashboardWidgetSortDirection.Descending,
    },
    thenBy: [],
  },
};

// -- Reading the registry -------------------------------------------------

/*
 * The widget kinds whose rows the registry orders. The metric Table and
 * the Data Source Table sort the rows they hold themselves, by columns
 * their own settings or query name.
 */
export function getDashboardWidgetSortComponentTypes(): Array<DashboardComponentType> {
  return Object.keys(
    DASHBOARD_WIDGET_SORT_SPECS,
  ) as Array<DashboardComponentType>;
}

export function getDashboardWidgetSortSpec(
  componentType: unknown,
): DashboardWidgetListSortSpec | null {
  if (typeof componentType !== "string") {
    return null;
  }

  if (
    !Object.prototype.hasOwnProperty.call(
      DASHBOARD_WIDGET_SORT_SPECS,
      componentType,
    )
  ) {
    return null;
  }

  return (
    DASHBOARD_WIDGET_SORT_SPECS[componentType as DashboardComponentType] || null
  );
}

// The columns a widget kind's headers can be sorted by, or none.
export function getDashboardWidgetSortColumns(
  componentType: unknown,
): Array<DashboardWidgetListSortColumn> {
  return getDashboardWidgetSortSpec(componentType)?.columns || [];
}

/*
 * The widget's own sort, read from its arguments: a choice naming one of
 * its kind's columns, or null - none saved, or one no column of this kind
 * answers to (a typo, a column a newer version added), which is read as
 * none so the widget keeps its built-in order.
 */
export function readDashboardWidgetSavedSort(
  componentType: unknown,
  widgetArguments: unknown,
): DashboardWidgetSortChoice | null {
  if (!widgetArguments || typeof widgetArguments !== "object") {
    return null;
  }

  return readDashboardWidgetSortChoiceForColumns(
    (widgetArguments as JSONObject)[DASHBOARD_WIDGET_SORT_ARGUMENT],
    getDashboardWidgetSortColumns(componentType),
  );
}

/*
 * A widget with its own sort set to `sort` ("status:desc"), or with none -
 * its built-in order - for null. A new widget and arguments object; the
 * widget handed in is not changed.
 */
export function withDashboardWidgetSavedSort<T extends { arguments?: unknown }>(
  component: T,
  sort: string | null,
): T {
  const widgetArguments: JSONObject = {
    ...((component.arguments as JSONObject | undefined) || {}),
  };

  if (sort) {
    widgetArguments[DASHBOARD_WIDGET_SORT_ARGUMENT] = sort;
  } else {
    delete widgetArguments[DASHBOARD_WIDGET_SORT_ARGUMENT];
  }

  return { ...component, arguments: widgetArguments };
}

/*
 * The widget kinds whose columns come from the widget itself - the metric
 * Table's configured columns, a Data Source Table's query - so any column
 * can be sorted by and only the shape of a sort is checked.
 */
export const DASHBOARD_WIDGET_TYPES_SORTED_BY_OWN_COLUMNS: ReadonlyArray<DashboardComponentType> =
  [DashboardComponentType.Table, DashboardComponentType.DataSourceTable];

/*
 * Why a write's widgets cannot be saved for their sorts, or null when they
 * can: each widget's `arguments.sort` is one its kind can be sorted by
 * ("status:desc"), or left out for the order it always had. A sort no
 * reader would use would otherwise be read as none without a word; an API
 * or Terraform user now learns at once. Widgets of a kind that does not
 * sort, or that this version does not know, are not looked at: a config is
 * stored as it is sent.
 */
export function getDashboardWidgetSortsProblem(
  dashboardViewConfig: JSONObject,
): string | null {
  const entries: Array<unknown> =
    StoredDashboardViewConfig.getComponentEntries(dashboardViewConfig);

  for (let index: number = 0; index < entries.length; index++) {
    const entry: unknown = entries[index];

    if (!StoredDashboardViewConfig.isWidgetEntry(entry)) {
      continue;
    }

    const widgetArguments: unknown = entry["arguments"];

    if (
      !widgetArguments ||
      typeof widgetArguments !== "object" ||
      Array.isArray(widgetArguments)
    ) {
      continue;
    }

    const sort: unknown = (widgetArguments as JSONObject)[
      DASHBOARD_WIDGET_SORT_ARGUMENT
    ];

    if (sort === undefined || sort === null || sort === "") {
      continue;
    }

    const componentType: unknown = entry["componentType"];
    const field: string = `dashboardViewConfig.components[${index}].arguments.${DASHBOARD_WIDGET_SORT_ARGUMENT}`;
    const spec: DashboardWidgetListSortSpec | null =
      getDashboardWidgetSortSpec(componentType);

    if (spec) {
      if (readDashboardWidgetSavedSort(componentType, widgetArguments)) {
        continue;
      }

      const values: Array<string> = getDashboardWidgetSortValues(componentType);

      return `${field} must be one of ${values.slice(0, -1).join(", ")} or ${
        values[values.length - 1]
      }, or left out for the widget's own order (${formatDashboardWidgetSortChoice(
        spec.defaultSort,
      )}).`;
    }

    if (
      (
        DASHBOARD_WIDGET_TYPES_SORTED_BY_OWN_COLUMNS as ReadonlyArray<unknown>
      ).includes(componentType) &&
      !parseDashboardWidgetSortChoice(sort)
    ) {
      return `${field} must be a column and a direction, such as <column>:asc or <column>:desc, or left out for the widget's own order.`;
    }
  }

  return null;
}

// Every sort a widget kind can be saved with, as its arguments write it.
export function getDashboardWidgetSortValues(
  componentType: unknown,
): Array<string> {
  const values: Array<string> = [];

  for (const column of getDashboardWidgetSortColumns(componentType)) {
    for (const direction of [
      DashboardWidgetSortDirection.Ascending,
      DashboardWidgetSortDirection.Descending,
    ]) {
      values.push(
        formatDashboardWidgetSortChoice({ column: column.key, direction }),
      );
    }
  }

  return values;
}

/*
 * The relation fields a widget kind's reads must select for its sorts to
 * work: a list read a page at a time can only be ordered by a related
 * record's field it also reads. The same for every sort of the kind, so a
 * widget's select does not change with its order. Fields of the model
 * itself need nothing here.
 */
export function getDashboardWidgetListSortSelect(
  componentType: unknown,
): JSONObject {
  const select: JSONObject = {};
  const spec: DashboardWidgetListSortSpec | null =
    getDashboardWidgetSortSpec(componentType);

  if (!spec) {
    return select;
  }

  const paths: Array<string> = [];

  for (const column of spec.columns) {
    for (const field of column.fields || []) {
      paths.push(field.path);
    }
  }

  for (const tieBreak of spec.thenBy) {
    paths.push(tieBreak.path);
  }

  for (const path of paths) {
    const parts: Array<string> = path.split(".");

    if (parts.length !== 2) {
      continue;
    }

    const relation: string = parts[0] as string;
    const field: string = parts[1] as string;
    const existing: unknown = select[relation];
    const relationSelect: JSONObject =
      existing && typeof existing === "object" ? (existing as JSONObject) : {};

    relationSelect[field] = true;
    select[relation] = relationSelect;
  }

  return select;
}

/*
 * A select with the fields its sorts need added in, related records' fields
 * merged into the relation's own select. A new object; the input is not
 * changed.
 */
export function withDashboardWidgetListSortSelect(
  componentType: unknown,
  select: JSONObject,
): JSONObject {
  const merged: JSONObject = { ...select };
  const sortSelect: JSONObject =
    getDashboardWidgetListSortSelect(componentType);

  for (const relation of Object.keys(sortSelect)) {
    const existing: unknown = merged[relation];
    const existingSelect: JSONObject =
      existing && typeof existing === "object" ? (existing as JSONObject) : {};

    merged[relation] = {
      ...existingSelect,
      ...(sortSelect[relation] as JSONObject),
    };
  }

  return merged;
}

// -- Building the read -------------------------------------------------------

function setSortAtPath(
  sort: JSONObject,
  path: string,
  value: SortOrder | JSONObject,
): void {
  const parts: Array<string> = path.split(".");
  let target: JSONObject = sort;

  for (let index: number = 0; index < parts.length - 1; index++) {
    const part: string = parts[index] as string;
    const existing: unknown = target[part];

    if (!existing || typeof existing !== "object") {
      target[part] = {};
    }

    target = target[part] as JSONObject;
  }

  target[parts[parts.length - 1] as string] = value as JSONObject;
}

/*
 * How one field's order is written for the database. Postgres places rows
 * with no value last on an ascending order already, so only a descending
 * one that keeps them last needs saying - which also leaves every order a
 * widget always had written exactly as it was.
 */
function getSortValue(
  order: SortOrder,
  nullsLast: boolean | undefined,
): SortOrder | JSONObject {
  if (!nullsLast || order === ASC) {
    return order;
  }

  return { direction: order, nulls: "LAST" };
}

function flip(order: SortOrder): SortOrder {
  return order === ASC ? DESC : ASC;
}

/*
 * The database order a list of fields and tie-breaks means. A path already
 * placed is not placed again: the first place a field takes in the order
 * is the one that counts.
 */
function buildSort(
  entries: Array<{ path: string; order: SortOrder; nullsLast?: boolean }>,
): JSONObject {
  const sort: JSONObject = {};
  const placed: Set<string> = new Set<string>();

  for (const entry of entries) {
    if (placed.has(entry.path)) {
      continue;
    }

    placed.add(entry.path);
    setSortAtPath(sort, entry.path, getSortValue(entry.order, entry.nullsLast));
  }

  return sort;
}

function getTieBreakEntries(
  spec: DashboardWidgetListSortSpec,
): Array<{ path: string; order: SortOrder; nullsLast?: boolean }> {
  return spec.thenBy.map((tieBreak: DashboardWidgetSortTieBreak) => {
    return {
      path: tieBreak.path,
      order: tieBreak.order,
      ...(tieBreak.nullsLast ? { nullsLast: true } : {}),
    };
  });
}

/*
 * The choice a widget is read with: the one handed in when the kind has
 * its column, else the kind's own order.
 */
export function getDashboardWidgetEffectiveSort(
  componentType: unknown,
  choice: DashboardWidgetSortChoice | null | undefined,
): DashboardWidgetSortChoice | null {
  const spec: DashboardWidgetListSortSpec | null =
    getDashboardWidgetSortSpec(componentType);

  if (!spec) {
    return null;
  }

  if (choice && findDashboardWidgetSortColumn(spec.columns, choice.column)) {
    return choice;
  }

  return spec.defaultSort;
}

/*
 * The database order of a widget sorted by a column that has fields (or
 * by its own order when the choice names none of its columns).
 */
export function getDashboardWidgetListSort(
  componentType: unknown,
  choice: DashboardWidgetSortChoice | null | undefined,
): JSONObject {
  const spec: DashboardWidgetListSortSpec | null =
    getDashboardWidgetSortSpec(componentType);

  if (!spec) {
    return {};
  }

  const effective: DashboardWidgetSortChoice = getDashboardWidgetEffectiveSort(
    componentType,
    choice,
  ) as DashboardWidgetSortChoice;

  const column: DashboardWidgetListSortColumn | null =
    findDashboardWidgetSortColumn(
      spec.columns,
      effective.column,
    ) as DashboardWidgetListSortColumn | null;

  const isDescending: boolean =
    effective.direction === DashboardWidgetSortDirection.Descending;

  const entries: Array<{
    path: string;
    order: SortOrder;
    nullsLast?: boolean;
  }> = [];

  for (const field of column?.fields || []) {
    entries.push({
      path: field.path,
      order:
        isDescending || field.bothWays
          ? field.whenDescending
          : flip(field.whenDescending),
      ...(field.nullsLast ? { nullsLast: true } : {}),
    });
  }

  entries.push(...getTieBreakEntries(spec));

  return buildSort(entries);
}

/*
 * One condition of a rank, read together with the widget's own condition
 * on the same field, as one condition both must hold - or `drop` when no
 * row could meet both, or `cannot` when the widget's condition is one this
 * cannot read together with a rank (the list is then read in one go,
 * ordered by its tie-break).
 */
type CombinedCondition =
  | { kind: "condition"; value: unknown }
  | { kind: "drop" }
  | { kind: "cannot" };

function isPlainValue(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function getIncludedValues(value: Includes): Array<unknown> {
  return value.values as Array<unknown>;
}

function combineCondition(
  widgetCondition: unknown,
  rankCondition: unknown,
): CombinedCondition {
  if (widgetCondition === undefined) {
    return { kind: "condition", value: rankCondition };
  }

  if (isPlainValue(widgetCondition)) {
    if (isPlainValue(rankCondition)) {
      return widgetCondition === rankCondition
        ? { kind: "condition", value: widgetCondition }
        : { kind: "drop" };
    }

    if (rankCondition instanceof Includes) {
      return getIncludedValues(rankCondition).includes(widgetCondition)
        ? { kind: "condition", value: widgetCondition }
        : { kind: "drop" };
    }

    if (rankCondition instanceof IncludesNone) {
      return (rankCondition.values as Array<unknown>).includes(widgetCondition)
        ? { kind: "drop" }
        : { kind: "condition", value: widgetCondition };
    }

    if (rankCondition instanceof IsNull) {
      return { kind: "drop" };
    }

    if (rankCondition instanceof NotNull) {
      return { kind: "condition", value: widgetCondition };
    }

    return { kind: "cannot" };
  }

  if (widgetCondition instanceof Includes) {
    const widgetValues: Array<unknown> = getIncludedValues(widgetCondition);

    if (isPlainValue(rankCondition)) {
      return widgetValues.includes(rankCondition)
        ? { kind: "condition", value: rankCondition }
        : { kind: "drop" };
    }

    if (rankCondition instanceof Includes) {
      const both: Array<unknown> = widgetValues.filter((value: unknown) => {
        return getIncludedValues(rankCondition).includes(value);
      });

      return both.length > 0
        ? {
            kind: "condition",
            value: new Includes(both as Array<string>),
          }
        : { kind: "drop" };
    }

    if (rankCondition instanceof IncludesNone) {
      const rest: Array<unknown> = widgetValues.filter((value: unknown) => {
        return !(rankCondition.values as Array<unknown>).includes(value);
      });

      return rest.length > 0
        ? {
            kind: "condition",
            value: new Includes(rest as Array<string>),
          }
        : { kind: "drop" };
    }

    if (rankCondition instanceof IsNull) {
      return { kind: "drop" };
    }

    if (rankCondition instanceof NotNull) {
      return {
        kind: "condition",
        value: new Includes(widgetValues as Array<string>),
      };
    }

    return { kind: "cannot" };
  }

  return { kind: "cannot" };
}

/*
 * The widget's query with one rank's conditions added, null when no row
 * can be in both, or "cannot" when the two cannot be read together.
 */
function getRankQuery(
  query: JSONObject,
  rank: JSONObject,
): JSONObject | null | "cannot" {
  const rankQuery: JSONObject = { ...query };

  for (const field of Object.keys(rank)) {
    const combined: CombinedCondition = combineCondition(
      query[field],
      rank[field],
    );

    if (combined.kind === "cannot") {
      return "cannot";
    }

    if (combined.kind === "drop") {
      return null;
    }

    rankQuery[field] = combined.value as JSONObject;
  }

  return rankQuery;
}

/*
 * How a widget's list is read for a sort: one read for a column the
 * database orders, one per rank (worst first, or best first descending)
 * for a status read rank by rank. Each read is the widget's query, with a
 * rank's conditions where there are ranks, and the database order.
 */
export function getDashboardWidgetListReadSteps(data: {
  componentType: unknown;
  choice: DashboardWidgetSortChoice | null | undefined;
  query: JSONObject;
}): Array<DashboardWidgetListReadStep> {
  const spec: DashboardWidgetListSortSpec | null = getDashboardWidgetSortSpec(
    data.componentType,
  );

  if (!spec) {
    return [{ query: { ...data.query }, sort: {} }];
  }

  const effective: DashboardWidgetSortChoice = getDashboardWidgetEffectiveSort(
    data.componentType,
    data.choice,
  ) as DashboardWidgetSortChoice;

  const column: DashboardWidgetListSortColumn | null =
    findDashboardWidgetSortColumn(
      spec.columns,
      effective.column,
    ) as DashboardWidgetListSortColumn | null;

  if (!column?.ranks) {
    return [
      {
        query: { ...data.query },
        sort: getDashboardWidgetListSort(data.componentType, effective),
      },
    ];
  }

  const tieBreak: JSONObject = buildSort(getTieBreakEntries(spec));

  const ranks: Array<JSONObject> =
    effective.direction === DashboardWidgetSortDirection.Descending
      ? [...column.ranks.ranks]
      : [...column.ranks.ranks].reverse();

  const steps: Array<DashboardWidgetListReadStep> = [];

  for (const rank of [...ranks, ...column.ranks.unranked]) {
    const rankQuery: JSONObject | null | "cannot" = getRankQuery(
      data.query,
      rank,
    );

    if (rankQuery === "cannot") {
      /*
       * The widget narrows this field in a way the ranks cannot be read
       * within: read the list in one go, in its tie-break order.
       */
      return [{ query: { ...data.query }, sort: tieBreak }];
    }

    if (rankQuery) {
      steps.push({ query: rankQuery, sort: { ...tieBreak } });
    }
  }

  return steps;
}

/*
 * Reads a widget's list step by step until it has `limit` rows - one read
 * for most sorts, and for a status read by rank, ranks until the list is
 * full. `read` runs one step for at most the rows still wanted: the
 * browser's list call or the server's. `shouldStop` ends the reading
 * between steps: a browser read a viewer's next click has replaced reads
 * no further ranks.
 */
export async function readDashboardWidgetListInSteps<T>(data: {
  steps: Array<DashboardWidgetListReadStep>;
  limit: number;
  read: (step: DashboardWidgetListReadStep, limit: number) => Promise<Array<T>>;
  shouldStop?: (() => boolean) | undefined;
}): Promise<Array<T>> {
  const rows: Array<T> = [];

  for (const step of data.steps) {
    const wanted: number = data.limit - rows.length;

    if (wanted <= 0 || data.shouldStop?.()) {
      break;
    }

    const stepRows: Array<T> = await data.read(step, wanted);
    rows.push(...stepRows.slice(0, wanted));
  }

  return rows;
}

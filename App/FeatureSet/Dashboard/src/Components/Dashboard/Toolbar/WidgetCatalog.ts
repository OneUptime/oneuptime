import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import IconProp from "Common/Types/Icon/IconProp";

/*
 * The widget picker groups every dashboard widget twice: into a narrow
 * category (what the widget shows) and into a broader group (why you would
 * reach for that category). The group is what the picker renders as a section
 * heading in its left rail, so a project with a dozen integrations still has a
 * short, scannable list to navigate.
 */
export enum WidgetCategoryGroup {
  General = "General",
  Observability = "Observability",
  Infrastructure = "Infrastructure",
}

export const WIDGET_CATEGORY_GROUP_ORDER: ReadonlyArray<WidgetCategoryGroup> = [
  WidgetCategoryGroup.General,
  WidgetCategoryGroup.Observability,
  WidgetCategoryGroup.Infrastructure,
];

export interface WidgetCatalogItem {
  type: DashboardComponentType;
  label: string;
  icon: IconProp;
  description: string;
  /*
   * Extra search terms that are not in the label or description. These let
   * someone find the SLO widget by typing "error budget", or the HTML widget
   * by typing "iframe", without stuffing the visible copy with synonyms.
   */
  keywords: ReadonlyArray<string>;
}

export interface WidgetCatalogCategory {
  name: string;
  group: WidgetCategoryGroup;
  description: string;
  icon: IconProp;
  items: ReadonlyArray<WidgetCatalogItem>;
}

export const WIDGET_CATALOG: ReadonlyArray<WidgetCatalogCategory> = [
  {
    name: "Essentials",
    group: WidgetCategoryGroup.General,
    icon: IconProp.Sparkles,
    description:
      "Layout and presentation widgets that do not need a data source.",
    items: [
      {
        type: DashboardComponentType.Text,
        label: "Text",
        icon: IconProp.Text,
        description: "Free-form Markdown text for headers and notes.",
        keywords: ["markdown", "note", "heading", "title", "label", "comment"],
      },
      {
        type: DashboardComponentType.Clock,
        label: "Clock",
        icon: IconProp.Clock,
        description:
          "Current time in any timezone — digital or analog. Add one per office so you can see who is awake.",
        keywords: ["time", "timezone", "world", "analog", "digital", "utc"],
      },
      {
        type: DashboardComponentType.Html,
        label: "HTML",
        icon: IconProp.Code,
        description:
          "Your own HTML, CSS, and JavaScript, rendered in a sandbox.",
        keywords: ["embed", "iframe", "custom", "css", "javascript", "script"],
      },
    ],
  },
  {
    name: "Metrics",
    group: WidgetCategoryGroup.General,
    icon: IconProp.ChartBar,
    description: "Charts, numbers, and tables built from a metrics query.",
    items: [
      {
        type: DashboardComponentType.Chart,
        label: "Chart",
        icon: IconProp.ChartBar,
        description: "Time-series chart from a metrics query.",
        keywords: ["graph", "line", "area", "bar", "timeseries", "metric"],
      },
      {
        type: DashboardComponentType.Value,
        label: "Value",
        icon: IconProp.Hashtag,
        description: "Single big-number stat, ideal for KPIs.",
        keywords: ["number", "stat", "kpi", "single", "counter", "metric"],
      },
      {
        type: DashboardComponentType.Gauge,
        label: "Gauge",
        icon: IconProp.Gauge,
        description: "Radial gauge for a percent or threshold.",
        keywords: ["dial", "radial", "percent", "threshold", "meter", "metric"],
      },
      {
        type: DashboardComponentType.Table,
        label: "Table",
        icon: IconProp.TableCells,
        description:
          "Tabular metric values — set a Group By (e.g. host.name) for one row per entity, or none for time-bucketed rows. Add formulas for derived columns like availability %.",
        keywords: ["grid", "rows", "columns", "group by", "formula", "metric"],
      },
    ],
  },
  {
    name: "External Data Sources",
    group: WidgetCategoryGroup.General,
    icon: IconProp.Database,
    description:
      "The same visualizations, driven by a system OneUptime does not own — Prometheus, PostgreSQL, MySQL, SQL Server, ClickHouse, Loki, Elasticsearch, or any REST API. Connect one under Dashboards → Settings → Data Sources, then write a query in that system's own language. Not available on public dashboards.",
    items: [
      {
        type: DashboardComponentType.DataSourceChart,
        label: "Chart",
        icon: IconProp.ChartBar,
        description:
          "Time-series chart from one or more external queries, overlaid on the same axes.",
        keywords: [
          "external",
          "data source",
          "prometheus",
          "promql",
          "sql",
          "clickhouse",
          "loki",
          "logql",
          "elasticsearch",
          "rest",
          "api",
          "graph",
        ],
      },
      {
        type: DashboardComponentType.DataSourceValue,
        label: "Value",
        icon: IconProp.Hashtag,
        description:
          "Single big-number stat reduced from an external query's result.",
        keywords: [
          "external",
          "data source",
          "prometheus",
          "promql",
          "sql",
          "clickhouse",
          "loki",
          "elasticsearch",
          "rest",
          "api",
          "stat",
          "kpi",
        ],
      },
      {
        type: DashboardComponentType.DataSourceGauge,
        label: "Gauge",
        icon: IconProp.Gauge,
        description:
          "Radial gauge for a percent or threshold, reduced from an external query.",
        keywords: [
          "external",
          "data source",
          "prometheus",
          "promql",
          "sql",
          "clickhouse",
          "loki",
          "elasticsearch",
          "rest",
          "api",
          "dial",
          "threshold",
        ],
      },
      {
        type: DashboardComponentType.DataSourceTable,
        label: "Table",
        icon: IconProp.TableCells,
        description:
          "Rows straight from an external query — columns come from the result, so any read-only query works.",
        keywords: [
          "external",
          "data source",
          "prometheus",
          "sql",
          "clickhouse",
          "loki",
          "elasticsearch",
          "rest",
          "api",
          "rows",
          "grid",
        ],
      },
    ],
  },
  {
    name: "Logs",
    group: WidgetCategoryGroup.Observability,
    icon: IconProp.Logs,
    description: "Live and aggregated views of your log records.",
    items: [
      {
        type: DashboardComponentType.LogStream,
        label: "Log Stream",
        icon: IconProp.Logs,
        description: "Tail recent log records matching a filter.",
        keywords: ["tail", "live", "records", "severity", "search"],
      },
      {
        type: DashboardComponentType.LogChart,
        label: "Log Chart",
        icon: IconProp.ChartBar,
        description:
          "Log volume over time by severity, with bar, line, or area visualization and friendly attribute filters.",
        keywords: ["volume", "histogram", "severity", "error rate", "count"],
      },
    ],
  },
  {
    name: "Security",
    group: WidgetCategoryGroup.Observability,
    icon: IconProp.ShieldExclamation,
    description: "SIEM signals stored beside your observability data.",
    items: [
      {
        type: DashboardComponentType.SecurityEventsList,
        label: "Security Events",
        icon: IconProp.ShieldExclamation,
        description:
          "Most recent security events matching a filter, with severity, event class, and acting host.",
        keywords: [
          "siem",
          "detection",
          "threat",
          "events",
          "ocsf",
          "severity",
          "finding",
        ],
      },
      {
        type: DashboardComponentType.SecurityEventsFlow,
        label: "Security Events Flow",
        icon: IconProp.ChartBar,
        description:
          "Sankey flow of security events — from source, through OCSF event class, to severity.",
        keywords: [
          "siem",
          "detection",
          "threat",
          "sankey",
          "flow",
          "events",
          "diagram",
        ],
      },
    ],
  },
  {
    name: "Traces",
    group: WidgetCategoryGroup.Observability,
    icon: IconProp.Waterfall,
    description: "Distributed traces, spans, and response-time breakdowns.",
    items: [
      {
        type: DashboardComponentType.TraceList,
        label: "Trace List",
        icon: IconProp.Waterfall,
        description: "Most recent traces for a service or operation.",
        keywords: ["span", "request", "service", "operation", "apm"],
      },
      {
        type: DashboardComponentType.TraceChart,
        label: "Trace Chart",
        icon: IconProp.ChartBar,
        description:
          "Span counts or response-time percentiles over time, optionally split by an attribute (e.g. per tenant).",
        keywords: [
          "latency",
          "percentile",
          "p95",
          "p99",
          "throughput",
          "duration",
        ],
      },
      {
        type: DashboardComponentType.TraceTable,
        label: "Trace Table",
        icon: IconProp.TableCells,
        description:
          "Top dimensions by request count — requests, median, avg, min, and max response time per span name, status, or attribute.",
        keywords: ["top", "slowest", "endpoint", "latency", "dimension"],
      },
    ],
  },
  {
    name: "Incidents",
    group: WidgetCategoryGroup.Observability,
    icon: IconProp.Alert,
    description: "Incidents raised for your services, with state and severity.",
    items: [
      {
        type: DashboardComponentType.IncidentList,
        label: "Incident List",
        icon: IconProp.Alert,
        description: "Filtered list of incidents with state and severity.",
        keywords: ["outage", "postmortem", "severity", "on call", "downtime"],
      },
    ],
  },
  {
    name: "Alerts",
    group: WidgetCategoryGroup.Observability,
    icon: IconProp.Bell,
    description: "Alerts your monitors and telemetry rules have fired.",
    items: [
      {
        type: DashboardComponentType.AlertList,
        label: "Alert List",
        icon: IconProp.Bell,
        description: "Recent alerts with state and severity.",
        keywords: ["notification", "trigger", "severity", "paging", "warning"],
      },
    ],
  },
  {
    name: "Monitors",
    group: WidgetCategoryGroup.Observability,
    icon: IconProp.AltGlobe,
    description: "Uptime and current status of everything you monitor.",
    items: [
      {
        type: DashboardComponentType.MonitorList,
        label: "Monitor List",
        icon: IconProp.AltGlobe,
        description:
          "Monitors with current operational status — as a list, a honeycomb, or a state timeline showing when each one went down and for how long.",
        keywords: [
          "uptime",
          "probe",
          "ping",
          "status",
          "health",
          "availability",
          "state timeline",
          "status history",
          "downtime",
          "outage",
          "history",
        ],
      },
    ],
  },
  {
    name: "SLOs",
    group: WidgetCategoryGroup.Observability,
    icon: IconProp.Percent,
    description: "Service level objectives, error budgets, and burn rate.",
    items: [
      {
        type: DashboardComponentType.Slo,
        label: "SLO",
        icon: IconProp.Percent,
        description:
          "SLI, error budget remaining, or burn rate for one SLO — as a big number or a trend chart.",
        keywords: [
          "sli",
          "service level",
          "error budget",
          "burn rate",
          "reliability",
        ],
      },
    ],
  },
  {
    name: "Hosts",
    group: WidgetCategoryGroup.Infrastructure,
    icon: IconProp.Server,
    description:
      "Hosts auto-discovered from the host.name OTel resource attribute.",
    items: [
      {
        type: DashboardComponentType.HostList,
        label: "Hosts",
        icon: IconProp.Server,
        description:
          "Hosts with connection status, OS, CPU/memory, and last-seen.",
        keywords: ["server", "machine", "vm", "cpu", "memory", "agent"],
      },
    ],
  },
  {
    name: "Kubernetes",
    group: WidgetCategoryGroup.Infrastructure,
    icon: IconProp.SquareStack3D,
    description:
      "Live inventory from any connected Kubernetes cluster — populated by the OneUptime Kubernetes Agent.",
    items: [
      {
        type: DashboardComponentType.KubernetesPodList,
        label: "Pods",
        icon: IconProp.Cube,
        description: "Pods with phase, namespace, and cluster.",
        keywords: ["k8s", "kubernetes", "pod", "workload", "container"],
      },
      {
        type: DashboardComponentType.KubernetesNodeList,
        label: "Nodes",
        icon: IconProp.Server,
        description: "Nodes with readiness and pressure conditions.",
        keywords: ["k8s", "kubernetes", "node", "kubelet", "capacity"],
      },
      {
        type: DashboardComponentType.KubernetesNamespaceList,
        label: "Namespaces",
        icon: IconProp.Folder,
        description: "All namespaces across selected clusters.",
        keywords: ["k8s", "kubernetes", "namespace", "tenant"],
      },
      {
        type: DashboardComponentType.KubernetesDeploymentList,
        label: "Deployments",
        icon: IconProp.ServerStack,
        description: "Deployments in selected clusters or namespaces.",
        keywords: ["k8s", "kubernetes", "deployment", "replicaset", "rollout"],
      },
      {
        type: DashboardComponentType.KubernetesStatefulSetList,
        label: "StatefulSets",
        icon: IconProp.ServerStack,
        description: "StatefulSets in selected clusters or namespaces.",
        keywords: ["k8s", "kubernetes", "statefulset", "stateful", "database"],
      },
      {
        type: DashboardComponentType.KubernetesDaemonSetList,
        label: "DaemonSets",
        icon: IconProp.ServerStack,
        description: "DaemonSets in selected clusters or namespaces.",
        keywords: ["k8s", "kubernetes", "daemonset", "agent", "node"],
      },
      {
        type: DashboardComponentType.KubernetesJobList,
        label: "Jobs",
        icon: IconProp.Clock,
        description: "Jobs in selected clusters or namespaces.",
        keywords: ["k8s", "kubernetes", "job", "batch", "task"],
      },
      {
        type: DashboardComponentType.KubernetesCronJobList,
        label: "CronJobs",
        icon: IconProp.Clock,
        description: "CronJobs in selected clusters or namespaces.",
        keywords: ["k8s", "kubernetes", "cronjob", "schedule", "batch"],
      },
    ],
  },
  {
    name: "Docker",
    group: WidgetCategoryGroup.Infrastructure,
    icon: IconProp.Cube,
    description:
      "Live inventory from any connected Docker host — populated by the OneUptime Docker Agent.",
    items: [
      {
        type: DashboardComponentType.DockerHostList,
        label: "Hosts",
        icon: IconProp.Server,
        description:
          "Docker hosts with connection status and container counts.",
        keywords: ["docker", "daemon", "engine", "host"],
      },
      {
        type: DashboardComponentType.DockerContainerList,
        label: "Containers",
        icon: IconProp.Cube,
        description: "Containers with state, image, and CPU/memory.",
        keywords: ["docker", "container", "running", "exited", "cpu"],
      },
      {
        type: DashboardComponentType.DockerImageList,
        label: "Images",
        icon: IconProp.Cube,
        description: "Images present on selected hosts.",
        keywords: ["docker", "image", "tag", "registry", "layer"],
      },
      {
        type: DashboardComponentType.DockerNetworkList,
        label: "Networks",
        icon: IconProp.Globe,
        description: "Networks defined on selected hosts.",
        keywords: ["docker", "network", "bridge", "overlay"],
      },
      {
        type: DashboardComponentType.DockerVolumeList,
        label: "Volumes",
        icon: IconProp.Database,
        description: "Volumes defined on selected hosts.",
        keywords: ["docker", "volume", "storage", "mount"],
      },
    ],
  },
  {
    name: "Docker Swarm",
    group: WidgetCategoryGroup.Infrastructure,
    icon: IconProp.ServerStack,
    description:
      "Live inventory from any connected Docker Swarm cluster — populated by the OneUptime Docker Swarm Agent.",
    items: [
      {
        type: DashboardComponentType.DockerSwarmNodeList,
        label: "Nodes",
        icon: IconProp.ServerStack,
        description:
          "Swarm nodes with manager/worker role, ready state, and CPU/memory.",
        keywords: ["swarm", "docker", "manager", "worker", "node"],
      },
      {
        type: DashboardComponentType.DockerSwarmServiceList,
        label: "Services",
        icon: IconProp.Cube,
        description:
          "Replicated and global services with replicas, image, and converge state.",
        keywords: ["swarm", "docker", "service", "replica", "global"],
      },
    ],
  },
  {
    name: "Podman",
    group: WidgetCategoryGroup.Infrastructure,
    icon: IconProp.TransparentCube,
    description:
      "Live inventory from any connected Podman host — populated by the OneUptime Podman Agent.",
    items: [
      {
        type: DashboardComponentType.PodmanHostList,
        label: "Hosts",
        icon: IconProp.Server,
        description:
          "Podman hosts with connection status and container counts.",
        keywords: ["podman", "rootless", "host", "daemonless"],
      },
      {
        type: DashboardComponentType.PodmanContainerList,
        label: "Containers",
        icon: IconProp.Cube,
        description: "Containers with state, image, and CPU/memory.",
        keywords: ["podman", "container", "running", "exited", "cpu"],
      },
      {
        type: DashboardComponentType.PodmanImageList,
        label: "Images",
        icon: IconProp.Cube,
        description: "Images present on selected hosts.",
        keywords: ["podman", "image", "tag", "registry", "layer"],
      },
      {
        type: DashboardComponentType.PodmanNetworkList,
        label: "Networks",
        icon: IconProp.Globe,
        description: "Networks defined on selected hosts.",
        keywords: ["podman", "network", "bridge", "cni"],
      },
      {
        type: DashboardComponentType.PodmanVolumeList,
        label: "Volumes",
        icon: IconProp.Database,
        description: "Volumes defined on selected hosts.",
        keywords: ["podman", "volume", "storage", "mount"],
      },
    ],
  },
  {
    name: "Proxmox",
    group: WidgetCategoryGroup.Infrastructure,
    icon: IconProp.SquareStack,
    description:
      "Live inventory from any connected Proxmox VE cluster — populated by the OneUptime Proxmox Agent.",
    items: [
      {
        type: DashboardComponentType.ProxmoxNodeList,
        label: "Nodes",
        icon: IconProp.ServerStack,
        description: "PVE nodes with online status and CPU/memory.",
        keywords: ["proxmox", "pve", "node", "hypervisor", "cluster"],
      },
      {
        type: DashboardComponentType.ProxmoxGuestList,
        label: "Guests",
        icon: IconProp.Cube,
        description:
          "QEMU VMs and LXC containers with run state, HA state, and node.",
        keywords: ["proxmox", "qemu", "lxc", "vm", "guest", "virtual machine"],
      },
    ],
  },
  {
    name: "Ceph",
    group: WidgetCategoryGroup.Infrastructure,
    icon: IconProp.Database,
    description:
      "Live inventory from any connected Ceph cluster — populated by the OneUptime Ceph Agent.",
    items: [
      {
        type: DashboardComponentType.CephOsdList,
        label: "OSDs",
        icon: IconProp.SquareStack,
        description:
          "The OSD wall — a honeycomb of OSDs colored by up/in state.",
        keywords: ["ceph", "osd", "disk", "storage", "up", "in"],
      },
      {
        type: DashboardComponentType.CephPoolList,
        label: "Pools",
        icon: IconProp.Database,
        description:
          "Pools with stored bytes, capacity-used bars, and object counts.",
        keywords: ["ceph", "pool", "capacity", "storage", "objects"],
      },
    ],
  },
  {
    name: "Network",
    group: WidgetCategoryGroup.Infrastructure,
    icon: IconProp.Map,
    description:
      "The network estate itself — the sites you model on the Network Map page.",
    items: [
      {
        type: DashboardComponentType.NetworkMap,
        label: "Network Map",
        icon: IconProp.Map,
        description:
          "Your network sites on the world map, each pinned at its coordinates and colored by its rolled-up status.",
        keywords: [
          "map",
          "site",
          "geo",
          "location",
          "world",
          "branch",
          "store",
          "franchise",
          "wan",
        ],
      },
    ],
  },
];

export interface WidgetCategoryGroupSection {
  group: WidgetCategoryGroup;
  categories: ReadonlyArray<WidgetCatalogCategory>;
}

/**
 * Buckets categories by their group, preserving WIDGET_CATEGORY_GROUP_ORDER and
 * dropping groups that have no categories left (which happens once a search has
 * filtered the catalog down).
 */
export function groupWidgetCategories(
  categories: ReadonlyArray<WidgetCatalogCategory>,
): Array<WidgetCategoryGroupSection> {
  const sections: Array<WidgetCategoryGroupSection> = [];

  for (const group of WIDGET_CATEGORY_GROUP_ORDER) {
    const categoriesInGroup: Array<WidgetCatalogCategory> = categories.filter(
      (category: WidgetCatalogCategory) => {
        return category.group === group;
      },
    );

    if (categoriesInGroup.length > 0) {
      sections.push({ group: group, categories: categoriesInGroup });
    }
  }

  return sections;
}

/**
 * Everything a single widget can be matched against, lower-cased once so the
 * search does not rebuild it per keystroke token.
 */
function getSearchHaystack(
  category: WidgetCatalogCategory,
  item: WidgetCatalogItem,
): string {
  return [
    item.label,
    item.description,
    ...item.keywords,
    category.name,
    category.description,
    category.group,
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * Splits the raw search box value into lower-cased tokens. Every token has to
 * match for a widget to be kept, so "docker volume" finds the Docker Volumes
 * widget even though no single field contains that exact phrase.
 */
export function tokenizeSearchTerm(searchTerm: string): Array<string> {
  return searchTerm
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token: string) => {
      return token.length > 0;
    });
}

/**
 * Filters the catalog down to the widgets matching every search token. Returns
 * the catalog untouched for an empty search, and drops categories that end up
 * with no matching widgets.
 */
export function searchWidgetCatalog(
  searchTerm: string,
  catalog: ReadonlyArray<WidgetCatalogCategory> = WIDGET_CATALOG,
): Array<WidgetCatalogCategory> {
  const tokens: Array<string> = tokenizeSearchTerm(searchTerm);

  if (tokens.length === 0) {
    return [...catalog];
  }

  const matches: Array<WidgetCatalogCategory> = [];

  for (const category of catalog) {
    const items: Array<WidgetCatalogItem> = category.items.filter(
      (item: WidgetCatalogItem) => {
        const haystack: string = getSearchHaystack(category, item);

        return tokens.every((token: string) => {
          return haystack.includes(token);
        });
      },
    );

    if (items.length > 0) {
      matches.push({ ...category, items: items });
    }
  }

  return matches;
}

/**
 * Total number of widgets across the given categories — used for the result
 * count and to decide whether to show the empty state.
 */
export function countWidgets(
  categories: ReadonlyArray<WidgetCatalogCategory>,
): number {
  return categories.reduce((total: number, category: WidgetCatalogCategory) => {
    return total + category.items.length;
  }, 0);
}

/**
 * First widget in the given categories, in catalog order. The picker adds this
 * one when the search box is submitted with Enter.
 */
export function getFirstWidget(
  categories: ReadonlyArray<WidgetCatalogCategory>,
): WidgetCatalogItem | null {
  for (const category of categories) {
    const first: WidgetCatalogItem | undefined = category.items[0];

    if (first) {
      return first;
    }
  }

  return null;
}

/**
 * Looks a category up by name. Returns null when the name is not in the given
 * list, which is how the picker detects that its selected category has been
 * filtered away by the current search.
 */
export function findCategoryByName(
  categories: ReadonlyArray<WidgetCatalogCategory>,
  name: string | null,
): WidgetCatalogCategory | null {
  if (!name) {
    return null;
  }

  return (
    categories.find((category: WidgetCatalogCategory) => {
      return category.name === name;
    }) || null
  );
}

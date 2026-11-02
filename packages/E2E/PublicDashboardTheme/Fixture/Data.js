/*
 * What the fixture's public dashboard API answers: dashboards as a customer
 * would build them - from the product's own templates and widget defaults -
 * and data for every widget kind, serialized the way the real API
 * serializes it, so the app parses it exactly as it parses a production
 * answer.
 *
 * Boards (the query's `board`):
 *
 *   kubernetes      the Kubernetes template: values, charts, a table, pod and
 *                   node lists, a log stream, text
 *   host            the Host template: gauges, the host list
 *   slo             the SLO template: the SLO widget and the SLO list
 *   network         the Network template: the network map, the monitor list
 *   lists           incidents, alerts, monitors, traces, logs and every
 *                   other Kubernetes list
 *   containers      every Docker and Podman list
 *   infrastructure  Proxmox, VMware, Ceph, storage arrays, Docker Swarm
 *   other           clock, HTML, text, the widgets a public dashboard
 *                   cannot draw (log chart, trace chart and table, security
 *                   events), and a widget of a type nobody knows
 *
 * `data=empty` answers every list and chart with nothing, for the widgets'
 * empty states. Values are drawn from smooth curves, never a random
 * generator, so every run shows the same board.
 */
import {
  DashboardTemplateType,
  getTemplateConfig,
} from "Common/Types/Dashboard/DashboardTemplates";
import DashboardViewConfigUtil from "Common/Utils/Dashboard/DashboardViewConfig";
import JSONFunctions from "Common/Types/JSONFunctions";
import { ObjectType } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import { DashboardVariableType } from "Common/Types/Dashboard/DashboardVariable";
import DashboardIncidentListComponentUtil from "Common/Utils/Dashboard/Components/DashboardIncidentListComponent";
import DashboardAlertListComponentUtil from "Common/Utils/Dashboard/Components/DashboardAlertListComponent";
import DashboardMonitorListComponentUtil from "Common/Utils/Dashboard/Components/DashboardMonitorListComponent";
import DashboardTraceListComponentUtil from "Common/Utils/Dashboard/Components/DashboardTraceListComponent";
import DashboardLogStreamComponentUtil from "Common/Utils/Dashboard/Components/DashboardLogStreamComponent";
import DashboardKubernetesNamespaceListComponentUtil from "Common/Utils/Dashboard/Components/DashboardKubernetesNamespaceListComponent";
import DashboardKubernetesDeploymentListComponentUtil from "Common/Utils/Dashboard/Components/DashboardKubernetesDeploymentListComponent";
import DashboardKubernetesStatefulSetListComponentUtil from "Common/Utils/Dashboard/Components/DashboardKubernetesStatefulSetListComponent";
import DashboardKubernetesDaemonSetListComponentUtil from "Common/Utils/Dashboard/Components/DashboardKubernetesDaemonSetListComponent";
import DashboardKubernetesJobListComponentUtil from "Common/Utils/Dashboard/Components/DashboardKubernetesJobListComponent";
import DashboardKubernetesCronJobListComponentUtil from "Common/Utils/Dashboard/Components/DashboardKubernetesCronJobListComponent";
import DashboardDockerHostListComponentUtil from "Common/Utils/Dashboard/Components/DashboardDockerHostListComponent";
import DashboardDockerContainerListComponentUtil from "Common/Utils/Dashboard/Components/DashboardDockerContainerListComponent";
import DashboardDockerImageListComponentUtil from "Common/Utils/Dashboard/Components/DashboardDockerImageListComponent";
import DashboardDockerNetworkListComponentUtil from "Common/Utils/Dashboard/Components/DashboardDockerNetworkListComponent";
import DashboardDockerVolumeListComponentUtil from "Common/Utils/Dashboard/Components/DashboardDockerVolumeListComponent";
import DashboardPodmanHostListComponentUtil from "Common/Utils/Dashboard/Components/DashboardPodmanHostListComponent";
import DashboardPodmanContainerListComponentUtil from "Common/Utils/Dashboard/Components/DashboardPodmanContainerListComponent";
import DashboardPodmanImageListComponentUtil from "Common/Utils/Dashboard/Components/DashboardPodmanImageListComponent";
import DashboardPodmanNetworkListComponentUtil from "Common/Utils/Dashboard/Components/DashboardPodmanNetworkListComponent";
import DashboardPodmanVolumeListComponentUtil from "Common/Utils/Dashboard/Components/DashboardPodmanVolumeListComponent";
import DashboardProxmoxNodeListComponentUtil from "Common/Utils/Dashboard/Components/DashboardProxmoxNodeListComponent";
import DashboardProxmoxGuestListComponentUtil from "Common/Utils/Dashboard/Components/DashboardProxmoxGuestListComponent";
import DashboardVMwareHostListComponentUtil from "Common/Utils/Dashboard/Components/DashboardVMwareHostListComponent";
import DashboardVMwareVirtualMachineListComponentUtil from "Common/Utils/Dashboard/Components/DashboardVMwareVirtualMachineListComponent";
import DashboardCephOsdListComponentUtil from "Common/Utils/Dashboard/Components/DashboardCephOsdListComponent";
import DashboardCephPoolListComponentUtil from "Common/Utils/Dashboard/Components/DashboardCephPoolListComponent";
import DashboardStorageArrayVolumeListComponentUtil from "Common/Utils/Dashboard/Components/DashboardStorageArrayVolumeListComponent";
import DashboardStorageArrayHardwareListComponentUtil from "Common/Utils/Dashboard/Components/DashboardStorageArrayHardwareListComponent";
import DashboardDockerSwarmNodeListComponentUtil from "Common/Utils/Dashboard/Components/DashboardDockerSwarmNodeListComponent";
import DashboardDockerSwarmServiceListComponentUtil from "Common/Utils/Dashboard/Components/DashboardDockerSwarmServiceListComponent";
import DashboardClockComponentUtil from "Common/Utils/Dashboard/Components/DashboardClockComponent";
import DashboardHtmlComponentUtil from "Common/Utils/Dashboard/Components/DashboardHtmlComponent";
import DashboardTextComponentUtil from "Common/Utils/Dashboard/Components/DashboardTextComponent";
import DashboardLogChartComponentUtil from "Common/Utils/Dashboard/Components/DashboardLogChartComponent";
import DashboardTraceChartComponentUtil from "Common/Utils/Dashboard/Components/DashboardTraceChartComponent";
import DashboardTraceTableComponentUtil from "Common/Utils/Dashboard/Components/DashboardTraceTableComponent";
import DashboardSecurityEventsListComponentUtil from "Common/Utils/Dashboard/Components/DashboardSecurityEventsListComponent";
import DashboardSecurityEventsFlowComponentUtil from "Common/Utils/Dashboard/Components/DashboardSecurityEventsFlowComponent";
import { PASSWORD, TITLE, getScenario } from "./Scenarios";
// A data: URL (Common/UI/esbuild-config's file loader).
import LOGO_DATA_URL from "./logo.svg";
// The logo for the dark theme: light lettering, for a dark background.
import DARK_LOGO_DATA_URL from "./logo-dark.svg";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

const recordId = (value) => {
  return `ab000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
};

// A fixed "now", so every run draws the same times.
export const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);

const date = (msAgo) => {
  return { _type: "DateTime", value: new Date(NOW - msAgo).toISOString() };
};

const color = (hex) => {
  return { _type: "Color", value: hex };
};

// A smooth, repeatable curve: index -> 0..1.
const wave = (index, phase) => {
  return (
    0.5 +
    0.32 * Math.sin(index / 6 + phase) +
    0.12 * Math.sin(index / 2.3 + phase * 1.7)
  );
};

/*
 * ------------------------------------------------------------------------
 * Boards
 * ------------------------------------------------------------------------
 */

const fromDefaults = (utils, args) => {
  let config = DashboardViewConfigUtil.createDefaultDashboardViewConfig();

  utils.forEach((util, index) => {
    const component = util.getDefaultComponent();
    const { size, ...extra } = (args && args[index]) || {};

    component.arguments = { ...(component.arguments || {}), ...extra };

    if (size) {
      component.widthInDashboardUnits = size.width;
      component.heightInDashboardUnits = size.height;
    }

    config = DashboardViewConfigUtil.addComponentToDashboard({
      component,
      dashboardViewConfig: config,
    });
  });

  return config;
};

// A widget of a type this version does not know: "could not be shown".
const unknownWidget = () => {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: ObjectID.generate(),
    componentType: "HostMetricChart",
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 4,
    heightInDashboardUnits: 3,
    minWidthInDashboardUnits: 2,
    minHeightInDashboardUnits: 2,
    arguments: {},
  };
};

const BOARDS = {
  kubernetes: () => {
    return getTemplateConfig(DashboardTemplateType.Kubernetes);
  },
  host: () => {
    return getTemplateConfig(DashboardTemplateType.Host);
  },
  slo: () => {
    return getTemplateConfig(DashboardTemplateType.Slo);
  },
  network: () => {
    return getTemplateConfig(DashboardTemplateType.Network);
  },
  lists: () => {
    return fromDefaults(
      [
        DashboardIncidentListComponentUtil,
        DashboardAlertListComponentUtil,
        DashboardMonitorListComponentUtil,
        DashboardTraceListComponentUtil,
        DashboardLogStreamComponentUtil,
        DashboardKubernetesNamespaceListComponentUtil,
        DashboardKubernetesDeploymentListComponentUtil,
        DashboardKubernetesStatefulSetListComponentUtil,
        DashboardKubernetesDaemonSetListComponentUtil,
        DashboardKubernetesJobListComponentUtil,
        DashboardKubernetesCronJobListComponentUtil,
      ],
      [{ title: "Open incidents" }, { title: "Alerts" }, { title: "Monitors" }],
    );
  },
  containers: () => {
    return fromDefaults([
      DashboardDockerHostListComponentUtil,
      DashboardDockerContainerListComponentUtil,
      DashboardDockerImageListComponentUtil,
      DashboardDockerNetworkListComponentUtil,
      DashboardDockerVolumeListComponentUtil,
      DashboardPodmanHostListComponentUtil,
      DashboardPodmanContainerListComponentUtil,
      DashboardPodmanImageListComponentUtil,
      DashboardPodmanNetworkListComponentUtil,
      DashboardPodmanVolumeListComponentUtil,
    ]);
  },
  infrastructure: () => {
    return fromDefaults([
      DashboardProxmoxNodeListComponentUtil,
      DashboardProxmoxGuestListComponentUtil,
      DashboardVMwareHostListComponentUtil,
      DashboardVMwareVirtualMachineListComponentUtil,
      DashboardCephOsdListComponentUtil,
      DashboardCephPoolListComponentUtil,
      DashboardStorageArrayVolumeListComponentUtil,
      DashboardStorageArrayHardwareListComponentUtil,
      DashboardDockerSwarmNodeListComponentUtil,
      DashboardDockerSwarmServiceListComponentUtil,
    ]);
  },
  other: () => {
    const config = fromDefaults(
      [
        DashboardClockComponentUtil,
        DashboardHtmlComponentUtil,
        DashboardTextComponentUtil,
        DashboardLogChartComponentUtil,
        DashboardTraceChartComponentUtil,
        DashboardTraceTableComponentUtil,
        DashboardSecurityEventsListComponentUtil,
        DashboardSecurityEventsFlowComponentUtil,
      ],
      [
        {},
        {
          html: '<div style="padding:12px"><h3>Release train</h3><p>Next deploy: <strong>14:00 UTC</strong></p><ul><li>checkout-api 2.41</li><li>payments 7.2</li></ul></div>',
        },
        {
          text: "## Production at a glance\n\nEverything on this board is **live**. Questions? Ask in `#ops`.\n\n- Latencies are p95\n- Error rates are per minute",
          isMarkdown: true,
          size: { width: 6, height: 4 },
        },
      ],
    );

    return DashboardViewConfigUtil.addComponentToDashboard({
      component: unknownWidget(),
      dashboardViewConfig: config,
    });
  },
};

export const BOARD_NAMES = Object.keys(BOARDS);

// A telemetry attribute variable and a project label variable, for the toolbar.
const VARIABLES = [
  {
    id: "service",
    name: "service",
    type: DashboardVariableType.TelemetryAttribute,
    attributeKey: "service.name",
    selectedValue: "checkout",
  },
  {
    id: "region",
    name: "region",
    type: DashboardVariableType.CustomList,
    customListValues: "us-east-1,eu-west-1,ap-south-1",
    selectedValue: "us-east-1",
  },
];

export const buildBoard = (name, withVariables) => {
  const build = BOARDS[name] || BOARDS.kubernetes;
  const config = build();

  if (withVariables) {
    config.variables = VARIABLES.map((variable) => {
      return { ...variable };
    });
  }

  return config;
};

/*
 * ------------------------------------------------------------------------
 * Dashboard answers
 * ------------------------------------------------------------------------
 */

const LOGO = {
  file: LOGO_DATA_URL.slice(LOGO_DATA_URL.indexOf(",") + 1),
  fileType: "image/svg+xml",
};

export const DARK_LOGO = {
  file: DARK_LOGO_DATA_URL.slice(DARK_LOGO_DATA_URL.indexOf(",") + 1),
  fileType: "image/svg+xml",
};

export const metadataAnswer = (dashboardId, isUnlocked) => {
  const scenario = getScenario(dashboardId);

  if (!scenario || !scenario.answers) {
    return { status: 404, body: { message: "Dashboard not found" } };
  }

  if (scenario.isForbidden) {
    return {
      status: 403,
      body: {
        message:
          "Your IP address 198.51.100.5 is blocked from accessing this dashboard.",
      },
    };
  }

  const isPromptOnly = scenario.hasPassword && !isUnlocked;

  const body = {
    _id: dashboardId,
    name: TITLE,
    isPublicDashboard: true,
    enableMasterPassword: scenario.hasPassword,
    pageTitle: TITLE,
    faviconFile: null,
    description: isPromptOnly ? "" : "Live health of Acme's production",
    pageDescription: isPromptOnly ? "" : "Live health of Acme's production",
    logoFile: isPromptOnly ? null : LOGO,
  };

  // A dashboard made before the setting has none stored: the API says Light.
  body.theme = scenario.theme || "Light";

  return { status: 200, body };
};

/*
 * The board, as /view-config answers it: with the logo for the dark theme
 * when the page asks for one (`darkLogo=1`), and null for it otherwise, as
 * the API answers a dashboard without one.
 */
export const viewConfigAnswer = (
  dashboardId,
  boardName,
  withVariables,
  withDarkLogo,
) => {
  return {
    status: 200,
    body: {
      _id: dashboardId,
      name: TITLE,
      description: "Live health of Acme's production",
      pageTitle: TITLE,
      pageDescription: "Live health of Acme's production",
      logoFile: LOGO,
      darkThemeLogoFile: withDarkLogo ? DARK_LOGO : null,
      dashboardViewConfig: JSONFunctions.serialize(
        buildBoard(boardName, withVariables),
      ),
    },
  };
};

export const passwordAnswer = (password) => {
  if (password === PASSWORD) {
    return { status: 200, body: {} };
  }

  return { status: 400, body: { message: "Invalid password." } };
};

/*
 * ------------------------------------------------------------------------
 * Telemetry: metric types, aggregates, attribute values
 * ------------------------------------------------------------------------
 */

const UNITS = [
  ["k8s.pod.cpu.utilization", "%"],
  ["k8s.node.cpu.utilization", "%"],
  ["k8s.pod.memory.usage", "bytes"],
  ["k8s.node.memory.usage", "bytes"],
  ["system.cpu.utilization", "%"],
  ["system.memory.utilization", "%"],
  ["system.disk.io", "bytes"],
  ["system.network.io", "bytes"],
  ["http.server.request.duration", "ms"],
  ["http.server.requests", ""],
];

export const metricTypesAnswer = () => {
  return {
    status: 200,
    body: {
      metricTypes: UNITS.map(([name, unit]) => {
        return { name, unit };
      }),
    },
  };
};

const SERIES_GROUPS = ["checkout", "payments", "search"];

const timestampOf = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value === "object" && value.value) {
    return new Date(value.value).getTime();
  }

  return new Date(value).getTime();
};

/*
 * A series for one aggregate request: points across its window (one for a
 * whole-window value), one series per value of each attribute it groups
 * by, drawn from smooth curves.
 */
export const aggregateAnswer = (body, isEmpty, scale) => {
  if (isEmpty) {
    return { status: 200, body: { data: [] } };
  }

  const aggregateBy = (body && body["aggregateBy"]) || {};
  const start = timestampOf(aggregateBy["startTimestamp"]) || NOW - HOUR;
  const end = timestampOf(aggregateBy["endTimestamp"]) || NOW;
  const isTotal = aggregateBy["aggregationInterval"] === "Total";
  const groupKeys = aggregateBy["groupByAttributeKeys"] || [];
  const points = isTotal ? 1 : 48;
  const step = Math.max((end - start) / points, MINUTE);
  const groups = groupKeys.length > 0 ? SERIES_GROUPS : [null];
  const data = [];

  groups.forEach((group, groupIndex) => {
    for (let index = 0; index < points; index++) {
      const point = {
        timestamp: {
          _type: "DateTime",
          value: new Date(start + index * step).toISOString(),
        },
        value: Math.round(wave(index, groupIndex * 1.3) * scale * 100) / 100,
      };

      if (group) {
        point.attributes = {};
        for (const key of groupKeys) {
          point.attributes[key] = group;
        }
      }

      data.push(point);
    }
  });

  return { status: 200, body: { data } };
};

export const attributeValuesAnswer = () => {
  return {
    status: 200,
    body: { values: ["checkout", "payments", "search", "inventory"] },
  };
};

/*
 * ------------------------------------------------------------------------
 * Resource lists
 * ------------------------------------------------------------------------
 */

const NAMES = {
  incident: [
    "Checkout API latency above 2 s",
    "Payments failing for cards in eu-west-1",
    "Search index lagging behind writes",
    "Login page returning 502",
  ],
  alert: [
    "CPU above 90% on web-03",
    "Disk 85% full on db-primary",
    "Error rate up on checkout-api",
    "Certificate expires in 7 days",
  ],
  monitor: [
    "Checkout API",
    "Payments gateway",
    "Login page",
    "Search service",
    "CDN edge",
  ],
  host: ["web-01", "web-02", "web-03", "db-primary", "db-replica"],
  "network-site": ["New York", "Frankfurt", "Singapore", "São Paulo"],
  "kubernetes-resource": [
    "checkout-api-7f9c8d",
    "payments-6d5b4c",
    "search-indexer-0",
    "ingress-nginx",
    "node-exporter",
  ],
  "docker-host": ["build-01", "edge-02", "media-03"],
  "docker-container": ["checkout-api", "redis", "nginx", "worker"],
  "docker-image": ["acme/checkout:2.41", "redis:7.2", "nginx:1.27"],
  "docker-network": ["bridge", "backend", "frontend"],
  "docker-volume": ["pgdata", "redis-data", "uploads"],
  "podman-host": ["podman-01", "podman-02"],
  "podman-container": ["checkout-api", "metrics-agent", "proxy"],
  "podman-image": ["acme/checkout:2.41", "otel/collector:0.110"],
  "podman-network": ["podman", "backend"],
  "podman-volume": ["cache", "logs"],
  "proxmox-resource": ["pve-01", "pve-02", "vm-web-01", "ct-cache"],
  "vmware-resource": ["esxi-01", "esxi-02", "vm-db-01", "vm-web-02"],
  "ceph-resource": ["osd.0", "osd.1", "osd.2", "rbd-pool"],
  "storage-array-resource": ["vol-orders", "vol-logs", "ctrl-a", "disk-07"],
  "docker-swarm-resource": ["manager-1", "worker-2", "web", "api"],
  span: [
    "POST /api/checkout",
    "GET /api/products",
    "SELECT orders",
    "redis GET session",
  ],
  "slo-list": ["Checkout availability", "Payments latency", "Search freshness"],
  slo: ["Checkout availability"],
};

const STATES = {
  currentIncidentState: [
    ["Investigating", "#ef4444"],
    ["Identified", "#f59e0b"],
    ["Monitoring", "#6366f1"],
    ["Resolved", "#10b981"],
  ],
  currentAlertState: [
    ["Created", "#ef4444"],
    ["Acknowledged", "#f59e0b"],
    ["Resolved", "#10b981"],
  ],
  incidentSeverity: [
    ["Critical", "#dc2626"],
    ["Major", "#f97316"],
    ["Minor", "#eab308"],
  ],
  alertSeverity: [
    ["High", "#dc2626"],
    ["Medium", "#f59e0b"],
    ["Low", "#3b82f6"],
  ],
  currentMonitorStatus: [
    ["Operational", "#10b981"],
    ["Degraded", "#f59e0b"],
    ["Offline", "#ef4444"],
    ["Operational", "#10b981"],
  ],
};

const PHASES = ["Running", "Running", "Pending", "Succeeded", "Failed"];
const STATUSES = ["running", "running", "exited", "paused"];
const LOG_SEVERITIES = ["Error", "Warning", "Information", "Debug", "Fatal"];
const LOG_BODIES = [
  "payment declined: card_expired (order 51842)",
  "retrying upstream call to inventory (attempt 2 of 3)",
  "GET /api/checkout 200 in 184 ms",
  "cache hit ratio 0.93 for session store",
  "worker crashed: out of memory",
];
const SPAN_NAMES = [
  "POST /api/checkout",
  "GET /api/products",
  "SELECT orders",
  "redis GET session",
];

const BOOLEAN_COLUMN = /^(is|has)[A-Z]/;

const nameFor = (resourceType, index) => {
  const names = NAMES[resourceType] || ["resource"];
  const name = names[index % names.length];

  return index < names.length ? name : `${name}-${index}`;
};

// The query's own value for a column it pins (a kind, a resource type).
const pinnedValue = (query, key) => {
  const value = query ? query[key] : undefined;

  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object" && typeof value.value === "string") {
    return value.value;
  }

  return undefined;
};

const relationValue = (key, select, index) => {
  const palette = STATES[key];
  const value = {};

  if (palette) {
    const [name, hex] = palette[index % palette.length];

    for (const field of Object.keys(select)) {
      if (field === "name") {
        value.name = name;
      } else if (field === "color") {
        value.color = color(hex);
      } else if (field === "isOperationalState") {
        value.isOperationalState = name === "Operational";
      } else if (field === "isResolvedState") {
        value.isResolvedState = name === "Resolved";
      }
    }

    return value;
  }

  for (const field of Object.keys(select)) {
    if (field === "name") {
      value.name =
        key.indexOf("Cluster") >= 0 || key.indexOf("cluster") >= 0
          ? "prod-us-east"
          : `${key} ${index + 1}`;
    } else if (field === "_id") {
      value._id = recordId(9000 + index);
    }
  }

  return value;
};

// A plausible value for one selected column, by its name.
const columnValue = (resourceType, key, index, query) => {
  const pinned = pinnedValue(query, key);

  if (pinned !== undefined) {
    return pinned;
  }

  const lower = key.toLowerCase();

  if (key === "_id" || key === "id") {
    return recordId(index + 1);
  }

  if (key === "name" || key === "title" || key === "displayName") {
    return nameFor(resourceType, index);
  }

  if (
    lower.endsWith("at") ||
    lower.indexOf("timestamp") >= 0 ||
    key === "time"
  ) {
    return date((index + 1) * 7 * MINUTE);
  }

  if (key === "startTime" || key === "endTime") {
    return date((index + 1) * 3 * MINUTE);
  }

  // isReady, hasDiskPressure - never haState.
  if (BOOLEAN_COLUMN.test(key)) {
    if (lower.indexOf("pressure") >= 0) {
      return index === 2;
    }

    return index !== 2;
  }

  if (lower.indexOf("percent") >= 0 || lower.indexOf("utilization") >= 0) {
    return Math.round(wave(index * 3, 0.4) * 1000) / 10;
  }

  if (lower.indexOf("bytes") >= 0) {
    return Math.round((wave(index * 2, 1.1) + 0.2) * 4 * 1024 * 1024 * 1024);
  }

  if (lower.indexOf("count") >= 0 || lower.indexOf("replicas") >= 0) {
    return 1 + ((index * 2) % 5);
  }

  if (key === "phase") {
    return PHASES[index % PHASES.length];
  }

  if (key === "status" || key === "state" || key === "health") {
    return STATUSES[index % STATUSES.length];
  }

  if (key === "namespaceKey" || key === "namespace") {
    return ["default", "payments", "monitoring"][index % 3];
  }

  if (key === "monitorType") {
    return ["API", "Website", "Ping", "SSL Certificate", "Server"][index % 5];
  }

  if (key === "latitude") {
    return [40.71, 50.11, 1.35, -23.55][index % 4];
  }

  if (key === "longitude") {
    return [-74.0, 8.68, 103.82, -46.63][index % 4];
  }

  if (key === "severityText") {
    return LOG_SEVERITIES[index % LOG_SEVERITIES.length];
  }

  if (key === "body") {
    return LOG_BODIES[index % LOG_BODIES.length];
  }

  if (key === "durationUnixNano") {
    return Math.round((wave(index, 0.2) + 0.1) * 900) * 1000000;
  }

  if (key === "statusCode") {
    return index === 1 ? 2 : 1;
  }

  if (key === "traceId" || key === "spanId") {
    return `4bf92f3577b34da6a3ce929d0e0e${String(4736 + index)}`;
  }

  if (key === "attributes") {
    return { "service.name": SERIES_GROUPS[index % SERIES_GROUPS.length] };
  }

  if (key === "targetPercentage") {
    return 99.9;
  }

  if (key === "currentSliPercentage") {
    return [99.95, 99.81, 98.7][index % 3];
  }

  if (key === "errorBudgetRemainingPercentage") {
    return [72, 18, 0][index % 3];
  }

  if (key === "errorBudgetRemainingSeconds") {
    return [1866, 466, 0][index % 3];
  }

  if (key === "currentBurnRate") {
    return [0.4, 2.6, 14.4][index % 3];
  }

  if (key === "sloStatus") {
    return ["Healthy", "At Risk", "Budget Exhausted"][index % 3];
  }

  return `${key}-${index + 1}`;
};

const recordFor = (resourceType, select, index, query) => {
  const record = {};

  for (const key of Object.keys(select || {})) {
    const selected = select[key];

    if (selected && typeof selected === "object" && !selected._type) {
      record[key] = relationValue(key, selected, index);
      continue;
    }

    record[key] = columnValue(resourceType, key, index, query);
  }

  if (!record._id) {
    record._id = recordId(index + 1);
  }

  if (resourceType === "span" && !record.name) {
    record.name = SPAN_NAMES[index % SPAN_NAMES.length];
  }

  return record;
};

export const resourceListAnswer = (resourceType, body, isEmpty) => {
  if (isEmpty) {
    return {
      status: 200,
      body: { data: [], count: 0, skip: 0, limit: 10 },
    };
  }

  const select = (body && body["select"]) || {};
  const query = (body && body["query"]) || {};
  const rows = resourceType === "slo" ? 1 : 5;
  const data = [];

  for (let index = 0; index < rows; index++) {
    data.push(recordFor(resourceType, select, index, query));
  }

  return {
    status: 200,
    body: { data, count: rows, skip: 0, limit: rows },
  };
};

export const sloHistoryAnswer = (body, isEmpty) => {
  if (isEmpty) {
    return { status: 200, body: { data: [] } };
  }

  const answer = aggregateAnswer(body, false, 1);

  answer.body.data = answer.body.data.map((point) => {
    return { ...point, value: 99 + point.value };
  });

  return answer;
};

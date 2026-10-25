/*
 * Offline fixture for the tables: ModelTable, the BaseModelTable and Table
 * it draws, and the list pages built on them.
 *
 * Only the ModelAPI/API data boundary and the synthetic user's permission
 * snapshot are replaced; the pages, their tables (header, rows, row actions,
 * bulk bar, facet chips, footer and pagination) and the shared components
 * they draw are the production ones from this branch.
 *
 * Pages (the path picks one):
 *   /dashboard/<project>/incidents              Incidents: the list of the
 *                                                maintainer's screenshot
 *   /dashboard/<project>/alerts                 Alerts: the rows of the
 *                                                maintainer's screenshot of
 *                                                the alerts list, each
 *                                                monitor named once, in
 *                                                Affected Resources
 *   /dashboard/<project>/monitors               Monitors
 *   /dashboard/<project>/status-pages           Status Pages
 *   /dashboard/<project>/settings/teams         Settings > Teams
 *   /dashboard/<project>/network-devices/settings/roles
 *                                                Device Roles, a list put in
 *                                                order by dragging its rows
 *   /dashboard/<project>/runbooks               Runbooks: the list of the
 *                                                maintainer's screenshot of
 *                                                the gap under a card's
 *                                                title, in the real Runbooks
 *                                                layout (its side menu and
 *                                                breadcrumbs), full width as
 *                                                the Dashboard draws it
 *   /dashboard/<project>/card-headers           every card header shape
 *                                                (CardHeaders.js): a table's
 *                                                toolbar header, the default
 *                                                header and the stacked one
 *                                                of an overview's side column
 *   /dashboard/<project>/tables                 the gallery: every kind of
 *                                                column (?table=kinds), a
 *                                                table with many columns
 *                                                (?table=wide), a table
 *                                                drawn outside a card
 *                                                (?table=plain), and people,
 *                                                each name drawn beside a
 *                                                picture and over an email
 *                                                (?table=people)
 *
 * Steered by the query string:
 *   - data=rich       more incidents, monitors and status pages: labels,
 *                     owners, a private incident, several resources
 *   - data=long       long titles, names and resources with nowhere to break
 *   - data=empty      every list is empty
 *   - data=labels     the Monitors list of OneUptime issues #5187 and #5183:
 *                     monitors labelled the way that customer numbers their
 *                     labels ("1.Category=Application", "2.SubCategory=
 *                     Website", ... "10.Owner=..."), each monitor's handed
 *                     over in a scrambled order, one label longer than a
 *                     column may grow, five labels on one monitor
 *   - rows=<n>        n more rows on every list (pagination, a long page)
 *   - role=viewer     a member who may read but not create, edit or delete
 *   - delay=<ms>      each list read takes this long (40 ms otherwise), to
 *                     see the tables while they load
 *   - fail=<table>    every read of that table fails (Incident, Monitor,
 *                     ... or all), as a server that cannot be reached does
 *   - lang=de|ja|fa   the Dashboard's German, Japanese or Persian words
 *   - theme=dark      (read by server.js) the Dashboard's dark mode
 *
 * Every list read is recorded on `window.__fixture.listRequests`, every
 * write on `window.__fixture.updates`, every record created (a row's state
 * move, a new owner) on `window.__fixture.creates`, every delete on
 * `window.__fixture.deletes`, every navigation on
 * `window.__fixture.navigations`, and every read of a table this fixture
 * does not model on `window.__fixture.unmodelled` (the suite fails on any).
 */
import "Common/UI/Styles/Theme.css";
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Route as PageRoute,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import IncidentsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Incidents";
import AlertsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Alerts";
import MonitorsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Monitors";
import StatusPagesPage from "../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/StatusPages";
import TeamsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Teams/Index";
import DeviceRolesPage from "../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Settings/DeviceRoles";
import RunbooksLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Layout";
import RunbooksPage from "../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Runbooks";
import CardHeadersPage from "./CardHeaders";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Pill from "Common/UI/Components/Pill/Pill";
import LabelsElement from "Common/UI/Components/Label/Labels";
import UserElement from "../../../App/FeatureSet/Dashboard/src/Components/User/User";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentOwnerUser from "Common/Models/DatabaseModels/IncidentOwnerUser";
import IncidentOwnerTeam from "Common/Models/DatabaseModels/IncidentOwnerTeam";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorOwnerUser from "Common/Models/DatabaseModels/MonitorOwnerUser";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageOwnerUser from "Common/Models/DatabaseModels/StatusPageOwnerUser";
import Team from "Common/Models/DatabaseModels/Team";
import Label from "Common/Models/DatabaseModels/Label";
import UserModel from "Common/Models/DatabaseModels/User";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import NetworkDeviceRole from "Common/Models/DatabaseModels/NetworkDeviceRole";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import Color from "Common/Types/Color";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import MonitorType from "Common/Types/Monitor/MonitorType";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import MultiSearch from "Common/Types/BaseDatabase/MultiSearch";
import Search from "Common/Types/BaseDatabase/Search";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { sortLabels } from "Common/Utils/LabelOrder";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import JA from "../../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import FA from "../../../App/FeatureSet/Dashboard/src/Locales/fa.json";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "80000000-0000-4000-8000-000000000001";

const params = new URLSearchParams(window.location.search);
const dataKind = params.get("data") || "normal";
const isRich = dataKind === "rich" || dataKind === "long";
const isLong = dataKind === "long";
const isEmpty = dataKind === "empty";
const isNumberedLabels = dataKind === "labels";
const extraRows = Math.max(0, Number(params.get("rows") || 0));
const role = params.get("role") || "owner";
const delay = Number(params.get("delay") || 40);
const failingTable = params.get("fail") || "";
const galleryTable = params.get("table") || "kinds";
const language = ["de", "ja", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

window.__fixture = {
  listRequests: [],
  itemRequests: [],
  updates: [],
  creates: [],
  deletes: [],
  navigations: [],
  unmodelled: [],
};

function waitFor(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function idOf(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "object" && value._id) {
    return value._id.toString().toLowerCase();
  }
  return value.toString().toLowerCase();
}

function uuid(prefix, index) {
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function withProject(record) {
  record.projectId = new ObjectID(PROJECT_ID);
  return record;
}

// ---------------------------------------------------------------- labels

function label(index, name, color) {
  const record = withProject(new Label());
  record._id = uuid("21000000", index);
  record.name = name;
  record.color = new Color(color);
  return record;
}

/*
 * The labels of OneUptime issues #5187 and #5183 (data=labels): numbered
 * the way that customer numbers theirs, a key and a value in each. In the
 * order a label's ids put them, which is no order a person reads.
 */
const NUMBERED_LABELS = {
  businessSystem: label(11, "4.Business System=Customer Mobile App", "#ef4444"),
  subCategory: label(12, "2.SubCategory=Website", "#64748b"),
  owner: label(13, "10.Owner=Loyalty Platform Team", "#0ea5e9"),
  item: label(14, "3.Item=Connectivity", "#64748b"),
  category: label(15, "1.Category=Application", "#6366f1"),
  claude: label(16, "Claude", "#0ea5e9"),
  escalation: label(
    17,
    "5.Escalation=Loyalty Platform Engineering, Customer Mobile App Integrations",
    "#f59e0b",
  ),
};

const LABELS = [
  label(1, "Production", "#ef4444"),
  label(2, "Payments", "#6366f1"),
  label(3, "EU West", "#10b981"),
  label(4, "Customer facing", "#f59e0b"),
  label(5, "Database", "#0ea5e9"),
  ...(isNumberedLabels ? Object.values(NUMBERED_LABELS) : []),
];

// ---------------------------------------------------------------- people

function user(index, name, email) {
  const record = new UserModel();
  record._id = uuid("81000000", index);
  record.name = new Name(name);
  record.email = new Email(email);
  return record;
}

const PEOPLE = [
  user(1, "Ada Lovelace", "ada@acme-commerce.example"),
  user(2, "Grace Hopper", "grace@acme-commerce.example"),
  user(3, "Alan Turing", "alan@acme-commerce.example"),
  // A name longer than its column's 20rem, for the people gallery.
  ...(isLong
    ? [
        user(
          4,
          "Maximiliana Alexandrina Featherstonehaugh-Cholmondeley of the Platform Reliability Guild",
          "maximiliana@acme-commerce.example",
        ),
      ]
    : []),
];

function team(index, name, description, isTeamDeleteable) {
  const record = withProject(new Team());
  record._id = uuid("50000000", index);
  record.name = name;
  record.description = description;
  record.isTeamDeleteable = isTeamDeleteable;
  record.isPermissionsEditable = isTeamDeleteable;
  return record;
}

const TEAMS = isEmpty
  ? []
  : [
      team(1, "Owners", "Owners of this project.", false),
      team(2, "Admin", "Admins of this project.", false),
      team(3, "Members", "Members of this project.", true),
      team(4, "Platform On-Call", "Who is paged for the platform.", true),
    ];

// ------------------------------------------------------------- incidents

function incidentState(index, name, color, flags) {
  const record = withProject(new IncidentState());
  record._id = uuid("41000000", index);
  record.name = name;
  record.color = new Color(color);
  record.order = index;
  record.isCreatedState = Boolean(flags && flags.created);
  record.isAcknowledgedState = Boolean(flags && flags.acknowledged);
  record.isResolvedState = Boolean(flags && flags.resolved);
  return record;
}

const IDENTIFIED = incidentState(1, "Identified", "#ef4444", {
  created: true,
});
const ACKNOWLEDGED = incidentState(2, "Acknowledged", "#f59e0b", {
  acknowledged: true,
});
const RESOLVED = incidentState(3, "Resolved", "#10b981", { resolved: true });

function incidentSeverity(index, name, color) {
  const record = withProject(new IncidentSeverity());
  record._id = uuid("43000000", index);
  record.name = name;
  record.color = new Color(color);
  record.order = index;
  return record;
}

const CRITICAL = incidentSeverity(1, "Critical Incident", "#dc2626");
const MAJOR = incidentSeverity(2, "Major Incident", "#ea580c");
const MINOR = incidentSeverity(3, "Minor Incident", "#ca8a04");

function monitorStatus(index, name, color) {
  const record = withProject(new MonitorStatus());
  record._id = uuid("61000000", index);
  record.name = name;
  record.color = new Color(color);
  record.order = index;
  return record;
}

const OPERATIONAL = monitorStatus(1, "Operational", "#10b981");
const DEGRADED = monitorStatus(2, "Degraded", "#f59e0b");
const OFFLINE = monitorStatus(3, "Offline", "#ef4444");

function monitor(index, name, description, monitorType, status, extra) {
  const record = withProject(new Monitor());
  record._id = uuid("60000000", index);
  record.name = name;
  record.description = description;
  record.monitorType = monitorType;
  record.currentMonitorStatus = status;
  record.currentMonitorStatusId = new ObjectID(status._id);
  record.labels = (extra && extra.labels) || [];
  record.isArchived = false;
  record.disableActiveMonitoring = false;
  record.createdAt = new Date("2026-09-01T10:00:00.000Z");
  return record;
}

const SATURATION_MONITOR = monitor(
  1,
  isLong
    ? "oneuptime-test - API Server Request Saturation across every replica of the public gateway in eu-west-1 and us-east-2"
    : "oneuptime-test - API Server Request Saturation",
  "Requests in flight on the API servers",
  MonitorType.API,
  DEGRADED,
);

/*
 * data=labels: each monitor's labels handed over in a scrambled order, as
 * the database joins them, for the list to put in order.
 */
const NUMBERED_LABEL_MONITORS = [
  monitor(
    1,
    "Claude usage ingest",
    "Token usage from the assistant",
    MonitorType.API,
    OPERATIONAL,
    { labels: [NUMBERED_LABELS.claude] },
  ),
  monitor(
    2,
    "Loyalty web service dependency",
    "The loyalty service's own dependencies",
    MonitorType.API,
    OPERATIONAL,
    {
      labels: [
        NUMBERED_LABELS.item,
        NUMBERED_LABELS.subCategory,
        NUMBERED_LABELS.businessSystem,
        NUMBERED_LABELS.category,
      ],
    },
  ),
  monitor(
    3,
    "Loyalty web service",
    "The service itself",
    MonitorType.Website,
    OPERATIONAL,
    {
      /*
       * The label longer than a column may grow, on a row the gallery
       * copies too (its third), so a phone's card shows it.
       */
      labels: [
        NUMBERED_LABELS.escalation,
        NUMBERED_LABELS.businessSystem,
        NUMBERED_LABELS.item,
      ],
    },
  ),
  monitor(
    4,
    "Assign loyalty card",
    "Card assignment calls",
    MonitorType.API,
    DEGRADED,
    {
      labels: [
        NUMBERED_LABELS.owner,
        NUMBERED_LABELS.businessSystem,
        NUMBERED_LABELS.item,
        NUMBERED_LABELS.subCategory,
        NUMBERED_LABELS.category,
      ],
    },
  ),
  monitor(
    5,
    "Coupons lookup",
    "Coupon calls from the mobile app",
    MonitorType.API,
    OPERATIONAL,
    {
      labels: [NUMBERED_LABELS.escalation, NUMBERED_LABELS.subCategory],
    },
  ),
  monitor(
    6,
    "App insights errors",
    "Errors the app reports",
    MonitorType.API,
    OFFLINE,
  ),
];

const MONITORS = isEmpty
  ? []
  : isNumberedLabels
    ? NUMBERED_LABEL_MONITORS
    : [
        SATURATION_MONITOR,
        monitor(
          2,
          "Checkout API",
          "The payment path customers use",
          MonitorType.API,
          OPERATIONAL,
          { labels: isRich ? [LABELS[0], LABELS[1]] : [] },
        ),
        monitor(
          3,
          "Marketing Website",
          "www, from three regions",
          MonitorType.Website,
          OPERATIONAL,
          { labels: isRich ? [LABELS[3]] : [] },
        ),
        monitor(
          4,
          "Primary Database Ping",
          "The writer's address",
          MonitorType.Ping,
          isRich ? OFFLINE : OPERATIONAL,
          {
            labels: isRich ? [LABELS[0], LABELS[2], LABELS[3], LABELS[4]] : [],
          },
        ),
      ];

function kubernetesCluster(index, name) {
  const record = withProject(new KubernetesCluster());
  record._id = uuid("62000000", index);
  record.name = name;
  return record;
}

function databaseServer(index, name) {
  const record = withProject(new DatabaseServer());
  record._id = uuid("63000000", index);
  record.name = name;
  return record;
}

const CLICKHOUSE = databaseServer(1, "ClickHouse default/oneuptime-clickhouse");
const VALKEY = databaseServer(
  2,
  "Redis oneuptime-valkey-master.default.svc.cluster.local:6857",
);
const TEST_CLUSTER = kubernetesCluster(1, "oneuptime-test");

function incident(index, data) {
  const record = withProject(new Incident());
  record._id = uuid("40000000", index);
  record.incidentNumber = index;
  record.incidentNumberWithPrefix = `INC-${index}`;
  record.title = data.title;
  record.description = data.description || "";
  record.currentIncidentState = data.state;
  record.currentIncidentStateId = new ObjectID(data.state._id);
  record.incidentSeverity = data.severity;
  record.incidentSeverityId = new ObjectID(data.severity._id);
  record.monitors = data.monitors || [];
  record.kubernetesClusters = data.kubernetesClusters || [];
  record.databaseServers = data.databaseServers || [];
  record.hosts = [];
  record.dockerHosts = [];
  record.podmanHosts = [];
  record.proxmoxClusters = [];
  record.vmwareVCenters = [];
  record.cephClusters = [];
  record.storageArrays = [];
  record.dockerSwarmClusters = [];
  record.iotFleets = [];
  record.services = [];
  record.serviceLevelObjectives = [];
  record.labels = data.labels || [];
  record.declaredAt = new Date(data.declaredAt);
  record.createdAt = new Date(data.declaredAt);
  record.isPrivate = Boolean(data.isPrivate);
  return record;
}

// The two incidents of the maintainer's screenshot.
const INCIDENTS = isEmpty
  ? []
  : [
      incident(2, {
        title: isLong
          ? "Checkout requests time out for customers in every EU region while the payments gateway retries callbacks against the primary database"
          : "ghfghgf",
        state: IDENTIFIED,
        severity: CRITICAL,
        monitors: [SATURATION_MONITOR],
        databaseServers: [CLICKHOUSE],
        declaredAt: "2026-10-05T06:04:00.000Z",
        labels: isRich ? [LABELS[0], LABELS[1], LABELS[2]] : [],
      }),
      incident(1, {
        title: "sdfdsf",
        state: IDENTIFIED,
        severity: MAJOR,
        monitors: [SATURATION_MONITOR],
        kubernetesClusters: [TEST_CLUSTER],
        databaseServers: [VALKEY],
        declaredAt: "2026-10-05T05:26:00.000Z",
      }),
    ];

if (isRich) {
  INCIDENTS.unshift(
    incident(5, {
      title: "Checkout latency above 2 seconds",
      state: ACKNOWLEDGED,
      severity: MAJOR,
      monitors: [MONITORS[1]],
      declaredAt: "2026-10-16T09:12:00.000Z",
      labels: [LABELS[1], LABELS[3]],
    }),
    incident(4, {
      title: "Primary database unreachable from the EU West workers",
      state: RESOLVED,
      severity: CRITICAL,
      monitors: [MONITORS[3]],
      databaseServers: [VALKEY],
      declaredAt: "2026-10-12T22:40:00.000Z",
      labels: [LABELS[0], LABELS[2], LABELS[3], LABELS[4]],
      isPrivate: true,
    }),
    incident(3, {
      title: "Marketing site serves an old build",
      state: RESOLVED,
      severity: MINOR,
      monitors: [MONITORS[2]],
      declaredAt: "2026-10-08T13:05:00.000Z",
    }),
  );
}

for (let index = 0; index < extraRows; index++) {
  INCIDENTS.push(
    incident(100 + index, {
      title: `Elevated error rate on worker ${String(index + 1).padStart(2, "0")}`,
      state: index % 3 === 0 ? RESOLVED : IDENTIFIED,
      severity: index % 2 === 0 ? MINOR : MAJOR,
      monitors: [SATURATION_MONITOR],
      declaredAt: new Date(
        Date.UTC(2026, 8, 1 + (index % 28), 8, index % 60),
      ).toISOString(),
    }),
  );
  MONITORS.push(
    monitor(
      100 + index,
      `Regional health check ${String(index + 1).padStart(2, "0")}`,
      "One region's endpoint",
      MonitorType.Website,
      index % 4 === 0 ? DEGRADED : OPERATIONAL,
    ),
  );
}

// The resolved incidents' timelines, for their Duration column.
const INCIDENT_TIMELINE = INCIDENTS.filter((record) => {
  return idOf(record.currentIncidentState) === idOf(RESOLVED);
}).map((record, index) => {
  const row = withProject(new IncidentStateTimeline());
  row._id = uuid("42000000", index + 1);
  row.incidentId = new ObjectID(record._id);
  row.incidentStateId = new ObjectID(RESOLVED._id);
  row.incidentState = RESOLVED;
  row.startsAt = new Date(record.declaredAt.getTime() + 95 * 60 * 1000);
  return row;
});

// ---------------------------------------------------------------- alerts

function alertState(index, name, color, flags) {
  const record = withProject(new AlertState());
  record._id = uuid("45000000", index);
  record.name = name;
  record.color = new Color(color);
  record.order = index;
  record.isCreatedState = Boolean(flags && flags.created);
  record.isAcknowledgedState = Boolean(flags && flags.acknowledged);
  record.isResolvedState = Boolean(flags && flags.resolved);
  return record;
}

const ALERT_CREATED = alertState(1, "Created", "#ef4444", { created: true });
const ALERT_ACKNOWLEDGED = alertState(2, "Acknowledged", "#f59e0b", {
  acknowledged: true,
});
const ALERT_RESOLVED = alertState(3, "Resolved", "#10b981", {
  resolved: true,
});

function alertSeverity(index, name, color) {
  const record = withProject(new AlertSeverity());
  record._id = uuid("46000000", index);
  record.name = name;
  record.color = new Color(color);
  record.order = index;
  return record;
}

const HIGH_ALERT = alertSeverity(1, "High", "#dc2626");
const LOW_ALERT = alertSeverity(2, "Low", "#ca8a04");

/*
 * The monitors the screenshot's alerts were raised on, each watching the
 * oneuptime-test cluster. Listed among the project's monitors on this page
 * only, so the Monitor chip offers them and the Monitors page keeps its
 * rows. With data=long the first is named as an imported Prometheus rule
 * is: one word with nowhere to break.
 */
const ALERT_MONITORS = [
  isLong
    ? "oneuptime-test - KubeNodeMemoryUtilizationHighOnGeneralPurposePoolNodesInEuWest1"
    : "oneuptime-test - High Node Memory Utilization",
  "oneuptime-test - Pod CPU Saturating Containers",
  "oneuptime-test - Pod Stuck in Pending",
  "oneuptime-test - HPA Saturated at Max Replicas",
].map((name, index) => {
  return monitor(
    11 + index,
    name,
    "A Kubernetes metric of the oneuptime-test cluster",
    MonitorType.Kubernetes,
    DEGRADED,
  );
});

function alertRecord(index, data) {
  const record = withProject(new Alert());
  record._id = uuid("44000000", index);
  record.alertNumber = index;
  record.alertNumberWithPrefix = `ALT-${index}`;
  record.title = data.title;
  record.description = "";
  record.currentAlertState = data.state;
  record.currentAlertStateId = new ObjectID(data.state._id);
  record.alertSeverity = data.severity;
  record.alertSeverityId = new ObjectID(data.severity._id);
  if (data.monitor) {
    record.monitor = data.monitor;
    record.monitorId = new ObjectID(data.monitor._id);
  }
  record.kubernetesClusters = data.kubernetesClusters || [];
  record.databaseServers = data.databaseServers || [];
  record.hosts = [];
  record.dockerHosts = [];
  record.podmanHosts = [];
  record.proxmoxClusters = [];
  record.vmwareVCenters = [];
  record.cephClusters = [];
  record.storageArrays = [];
  record.dockerSwarmClusters = [];
  record.iotFleets = [];
  record.services = [];
  record.serviceLevelObjectives = [];
  record.labels = data.labels || [];
  record.createdAt = new Date(data.createdAt);
  record.isPrivate = false;
  return record;
}

/*
 * The rows of the maintainer's screenshot: each alert raised on a monitor
 * of the oneuptime-test cluster, and linked to the cluster too. Then an
 * alert created by hand about a database, with no monitor, and one linked
 * to nothing.
 */
const ALERTS = isEmpty
  ? []
  : [
      alertRecord(10, {
        title: "High Node Memory Utilization",
        state: ALERT_CREATED,
        severity: HIGH_ALERT,
        monitor: ALERT_MONITORS[0],
        kubernetesClusters: [TEST_CLUSTER],
        createdAt: "2026-10-16T05:20:00.000Z",
      }),
      alertRecord(9, {
        title: "Pod CPU Saturating Containers",
        state: ALERT_CREATED,
        severity: HIGH_ALERT,
        monitor: ALERT_MONITORS[1],
        kubernetesClusters: [TEST_CLUSTER],
        createdAt: "2026-10-16T04:55:00.000Z",
      }),
      alertRecord(8, {
        title: "Pod Stuck in Pending",
        state: ALERT_ACKNOWLEDGED,
        severity: LOW_ALERT,
        monitor: ALERT_MONITORS[2],
        kubernetesClusters: [TEST_CLUSTER],
        createdAt: "2026-10-16T03:10:00.000Z",
      }),
      alertRecord(7, {
        title: "HPA Saturated at Max Replicas",
        state: ALERT_RESOLVED,
        severity: LOW_ALERT,
        monitor: ALERT_MONITORS[3],
        kubernetesClusters: [TEST_CLUSTER],
        createdAt: "2026-10-15T22:40:00.000Z",
      }),
      alertRecord(6, {
        title: "ClickHouse disk filling up",
        state: ALERT_CREATED,
        severity: LOW_ALERT,
        databaseServers: [CLICKHOUSE],
        createdAt: "2026-10-15T18:05:00.000Z",
      }),
      alertRecord(5, {
        title: "Check the on-call handover notes",
        state: ALERT_ACKNOWLEDGED,
        severity: LOW_ALERT,
        createdAt: "2026-10-15T09:30:00.000Z",
      }),
    ];

// The resolved alerts' timelines, for their Duration column.
const ALERT_TIMELINE = ALERTS.filter((record) => {
  return idOf(record.currentAlertState) === idOf(ALERT_RESOLVED);
}).map((record, index) => {
  const row = withProject(new AlertStateTimeline());
  row._id = uuid("47000000", index + 1);
  row.alertId = new ObjectID(record._id);
  row.alertStateId = new ObjectID(ALERT_RESOLVED._id);
  row.alertState = ALERT_RESOLVED;
  row.startsAt = new Date(record.createdAt.getTime() + 40 * 60 * 1000);
  return row;
});

function ownerUser(ModelType, resourceIdField, index, resourceId, person) {
  const record = withProject(new ModelType());
  record._id = uuid("82000000", index);
  record[resourceIdField] = new ObjectID(resourceId);
  record.userId = new ObjectID(person._id);
  record.user = person;
  return record;
}

const INCIDENT_OWNERS = isRich
  ? [
      ownerUser(
        IncidentOwnerUser,
        "incidentId",
        1,
        uuid("40000000", 5),
        PEOPLE[0],
      ),
      ownerUser(
        IncidentOwnerUser,
        "incidentId",
        2,
        uuid("40000000", 5),
        PEOPLE[1],
      ),
      ownerUser(
        IncidentOwnerUser,
        "incidentId",
        3,
        uuid("40000000", 4),
        PEOPLE[2],
      ),
    ]
  : [];

const MONITOR_OWNERS = isRich
  ? [
      ownerUser(
        MonitorOwnerUser,
        "monitorId",
        11,
        uuid("60000000", 2),
        PEOPLE[0],
      ),
    ]
  : [];

// ----------------------------------------------------------- status pages

function statusPage(index, name, description, extra) {
  const record = withProject(new StatusPage());
  record._id = uuid("30000000", index);
  record.name = name;
  record.description = description;
  record.labels = (extra && extra.labels) || [];
  record.isArchived = false;
  record.isPublicStatusPage = true;
  return record;
}

const STATUS_PAGES = isEmpty
  ? []
  : [
      statusPage(
        1,
        "Acme Status",
        "What customers see at status.acme.example",
        {
          labels: isRich ? [LABELS[3]] : [],
        },
      ),
      statusPage(2, "Internal Platform", "For the platform team"),
      statusPage(
        3,
        isLong
          ? "Customer-Facing Status Page for EU-West Enterprise Customers, Partners and Resellers (Primary)"
          : "Partners",
        isLong
          ? "status.eu-west-1.enterprise-customers.partners-and-resellers.example.com"
          : "Resellers and partners",
      ),
    ];

const STATUS_PAGE_OWNERS = isRich
  ? [
      ownerUser(
        StatusPageOwnerUser,
        "statusPageId",
        21,
        uuid("30000000", 1),
        PEOPLE[1],
      ),
    ]
  : [];

// -------------------------------------------------------- network device roles

function deviceRole(index, name, key, shape, isCore, isWalkable) {
  const record = withProject(new NetworkDeviceRole());
  record._id = uuid("70000000", index);
  record.name = name;
  record.key = key;
  record.description = `${name}s on the network.`;
  record.topologyShape = shape;
  record.isCoreLayer = isCore;
  record.isSnmpWalkable = isWalkable;
  record.order = index;
  return record;
}

const DEVICE_ROLES = isEmpty
  ? []
  : [
      deviceRole(1, "Router", "router", "circle", true, true),
      deviceRole(2, "Firewall", "firewall", "diamond", true, true),
      deviceRole(3, "Switch", "switch", "rounded-square", false, true),
      deviceRole(4, "Wireless AP", "wireless-ap", "triangle", false, true),
      deviceRole(5, "Printer", "printer", "square", false, false),
    ];

// --------------------------------------------------------------- runbooks

function runbook(index, name, description, isEnabled) {
  const record = withProject(new Runbook());
  record._id = uuid("90000000", index);
  record.name = name;
  record.description = description;
  record.isEnabled = isEnabled;
  record.labels = [];
  return record;
}

// The one runbook of the maintainer's screenshot, and more with data=rich.
const RUNBOOKS = isEmpty
  ? []
  : [
      runbook(1, "Runbook", "Runbook", true),
      ...(isRich
        ? [
            runbook(
              2,
              "Database failover",
              "Promote the replica and point the API at it.",
              true,
            ),
            runbook(
              3,
              "Clear the CDN cache",
              "Purge every edge after a bad deploy.",
              false,
            ),
          ]
        : []),
    ];

// ------------------------------------------------------------ the records

const RECORDS = {
  Incident: INCIDENTS,
  IncidentState: [IDENTIFIED, ACKNOWLEDGED, RESOLVED],
  IncidentSeverity: [CRITICAL, MAJOR, MINOR],
  IncidentStateTimeline: INCIDENT_TIMELINE,
  IncidentOwnerUser: INCIDENT_OWNERS,
  IncidentOwnerTeam: [],
  Alert: ALERTS,
  AlertState: [ALERT_CREATED, ALERT_ACKNOWLEDGED, ALERT_RESOLVED],
  AlertSeverity: [HIGH_ALERT, LOW_ALERT],
  AlertStateTimeline: ALERT_TIMELINE,
  AlertOwnerUser: [],
  AlertOwnerTeam: [],
  Monitor: window.location.pathname.endsWith("/alerts")
    ? [...MONITORS, ...ALERT_MONITORS]
    : MONITORS,
  MonitorStatus: [OPERATIONAL, DEGRADED, OFFLINE],
  MonitorOwnerUser: MONITOR_OWNERS,
  MonitorOwnerTeam: [],
  StatusPage: STATUS_PAGES,
  StatusPageOwnerUser: STATUS_PAGE_OWNERS,
  StatusPageOwnerTeam: [],
  Team: TEAMS,
  Label: LABELS,
  User: PEOPLE,
  NetworkDeviceRole: DEVICE_ROLES,
  Runbook: RUNBOOKS,
  RunbookOwnerUser: [],
  RunbookOwnerTeam: [],
};

/*
 * Tables the pages read that hold nothing here: saved views, templates,
 * custom fields and the like. Read and answered with an empty list; any
 * other table is recorded as unmodelled.
 */
const EMPTY_TABLES = [
  "TableView",
  "IncidentTemplate",
  "IncidentNoteTemplate",
  "IncidentCustomField",
  "AlertNoteTemplate",
  "AlertCustomField",
  "MonitorCustomField",
  "StatusPageCustomField",
  "TeamMember",
  "TeamPermission",
  "ProjectUser",
  "MonitorTemplate",
  "OnCallDutyPolicy",
  "Probe",
  "TeamCustomField",
  "CustomRole",
  "CustomRolePermission",
];

function matchesCondition(record, key, condition) {
  const value = record[key];
  if (condition instanceof MultiSearch) {
    const needle = String(condition.value || "").toLowerCase();
    return condition.fields.some((field) => {
      return String(record[field] || "")
        .toLowerCase()
        .includes(needle);
    });
  }
  if (condition instanceof Search) {
    return String(value || "")
      .toLowerCase()
      .includes(String(condition.value || "").toLowerCase());
  }
  if (condition instanceof Includes) {
    const wanted = condition.values.map(idOf);
    if (Array.isArray(value)) {
      return value.some((item) => wanted.includes(idOf(item)));
    }
    return wanted.includes(idOf(value));
  }
  if (condition instanceof IncludesNone) {
    const unwanted = condition.values.map(idOf);
    if (Array.isArray(value)) {
      return !value.some((item) => unwanted.includes(idOf(item)));
    }
    return !unwanted.includes(idOf(value));
  }
  if (condition instanceof NotEqual) {
    return idOf(value) !== idOf(condition.value);
  }
  if (typeof condition === "boolean") {
    return Boolean(value) === condition;
  }
  if (condition instanceof ObjectID || typeof condition === "string") {
    return idOf(value) === idOf(condition);
  }
  if (typeof condition === "number") {
    return Number(value) === condition;
  }
  return true;
}

function matchesQuery(record, query) {
  for (const [key, condition] of Object.entries(query || {})) {
    if (condition === undefined || condition === null || key === "projectId") {
      continue;
    }
    if (!matchesCondition(record, key, condition)) {
      return false;
    }
  }
  return true;
}

function sortValue(value) {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (value && typeof value === "object") {
    return String(value.name || value.toString() || "").toLowerCase();
  }
  if (typeof value === "string") {
    return value.toLowerCase();
  }
  return value;
}

function sortRows(rows, sort) {
  const [field, order] = Object.entries(sort || {})[0] || [];
  if (!field) {
    return rows;
  }
  const direction = order === SortOrder.Descending ? -1 : 1;
  return [...rows].sort((first, second) => {
    const a = sortValue(first[field]);
    const b = sortValue(second[field]);
    return a > b ? direction : a < b ? -direction : 0;
  });
}

function serialize(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function failsFor(tableName) {
  return failingTable === "all" || failingTable === tableName;
}

// ------------------------------------------------------------ permissions

const heldPermission =
  role === "viewer" ? Permission.Viewer : Permission.ProjectOwner;

UserUtil.isMasterAdmin = () => false;
UserUtil.getUserId = () => new ObjectID(USER_ID);
/*
 * The people gallery lists users, whom a signed-in member may read
 * (Logged in User); every other page holds only the member's role.
 */
PermissionUtil.getAllPermissions = () =>
  galleryTable === "people" && window.location.pathname.endsWith("/tables")
    ? [heldPermission, Permission.CurrentUser]
    : [heldPermission];
PermissionUtil.getProjectPermissions = () => ({
  _type: "UserTenantAccessPermission",
  projectId: new ObjectID(PROJECT_ID),
  permissions: [
    {
      _type: "UserPermission",
      permission: heldPermission,
      labelIds: [],
      isBlockPermission: false,
    },
  ],
});
PermissionUtil.getGlobalPermissions = () => ({
  _type: "UserGlobalAccessPermission",
  globalPermissions: [
    Permission.Public,
    Permission.User,
    Permission.CurrentUser,
  ],
  projectIds: [new ObjectID(PROJECT_ID)],
});
ProjectUtil.getCurrentProjectId = () => new ObjectID(PROJECT_ID);
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

// ------------------------------------------------------------ the data API

ModelAPI.getList = async (options) => {
  const tableName = new options.modelType().tableName;
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 50);
  window.__fixture.listRequests.push({
    tableName,
    query: serialize(options.query),
    sort: serialize(options.sort),
    skip,
    limit,
  });

  await waitFor(delay);

  if (failsFor(tableName)) {
    throw new Error(`Could not reach the server to load ${tableName}.`);
  }

  if (!RECORDS[tableName]) {
    if (!EMPTY_TABLES.includes(tableName)) {
      window.__fixture.unmodelled.push(`getList ${tableName}`);
    }
    return { data: [], count: 0, skip, limit };
  }

  const matched = RECORDS[tableName].filter((record) => {
    return matchesQuery(record, options.query);
  });

  /*
   * Labels the way the server reads them (LabelService.getReadSort): in
   * natural order by name when asked for in no order or by name, the
   * other way round for a name sorted the other way.
   */
  const labelSort = Object.entries(options.sort || {})[0];
  const items =
    tableName === "Label" && (!labelSort || labelSort[0] === "name")
      ? labelSort && labelSort[1] === SortOrder.Descending
        ? sortLabels(matched).reverse()
        : sortLabels(matched)
      : sortRows(matched, options.sort);

  return {
    data: items.slice(skip, skip + limit),
    count: items.length,
    skip,
    limit,
  };
};

ModelAPI.getCount = async (options) => {
  const tableName = new options.modelType().tableName;
  if (!RECORDS[tableName]) {
    return 0;
  }
  return RECORDS[tableName].filter((record) => {
    return matchesQuery(record, options.query);
  }).length;
};

ModelAPI.getItem = async (options) => {
  const tableName = new options.modelType().tableName;
  const id = idOf(options.id);
  window.__fixture.itemRequests.push({ tableName, id });
  await waitFor(delay);
  return (
    (RECORDS[tableName] || []).find((record) => idOf(record._id) === id) || null
  );
};

ModelAPI.updateById = async (options) => {
  const tableName = new options.modelType().tableName;
  const id = idOf(options.id);
  window.__fixture.updates.push({
    tableName,
    id,
    data: serialize(options.data),
  });
  const record = (RECORDS[tableName] || []).find((candidate) => {
    return idOf(candidate._id) === id;
  });
  if (record) {
    Object.assign(record, options.data);
    /*
     * A value written by its id (a row's Change Severity) is read back
     * through its link, as the server joins it.
     */
    for (const [idColumn, [link, table]] of Object.entries(LINKED_VALUES)) {
      if (options.data && options.data[idColumn]) {
        record[link] =
          RECORDS[table].find((value) => {
            return idOf(value._id) === idOf(options.data[idColumn]);
          }) || record[link];
      }
    }
  }
};

// The values a record links to by an id column: the link, and its table.
const LINKED_VALUES = {
  incidentSeverityId: ["incidentSeverity", "IncidentSeverity"],
  alertSeverityId: ["alertSeverity", "AlertSeverity"],
};

ModelAPI.deleteItem = async (options) => {
  const tableName = new options.modelType().tableName;
  const id = idOf(options.id);
  window.__fixture.deletes.push({ tableName, id });
  const rows = RECORDS[tableName] || [];
  const index = rows.findIndex((record) => idOf(record._id) === id);
  if (index >= 0) {
    rows.splice(index, 1);
  }
};

// The member the fixture signs in, as an owner row names them.
const VIEWER = new UserModel();
VIEWER._id = USER_ID;
VIEWER.name = new Name("Morgan Lee");
VIEWER.email = new Email("morgan@acme-commerce.example");

// A created record's own values: ids as text, objects left out.
function plainOf(model) {
  const plain = {};
  for (const [key, value] of Object.entries(model)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (value instanceof ObjectID) {
      plain[key] = value.toString().toLowerCase();
    } else if (typeof value !== "object" && typeof value !== "function") {
      plain[key] = value;
    }
  }
  return plain;
}

/*
 * A record created as the API creates it. A state timeline row moves its
 * incident or alert into the state, as the server's timeline service does,
 * so the list read again shows it there; an owner row names its person.
 */
const STATE_MOVES = {
  IncidentStateTimeline: {
    records: "Incident",
    states: "IncidentState",
    recordId: "incidentId",
    stateId: "incidentStateId",
    current: "currentIncidentState",
  },
  AlertStateTimeline: {
    records: "Alert",
    states: "AlertState",
    recordId: "alertId",
    stateId: "alertStateId",
    current: "currentAlertState",
  },
};

ModelAPI.create = async (options) => {
  const model = options.model;
  const tableName =
    model.tableName || new options.modelType().tableName || "unknown";
  window.__fixture.creates.push({ tableName, data: plainOf(model) });

  await waitFor(delay);

  if (!RECORDS[tableName]) {
    window.__fixture.unmodelled.push(`create ${tableName}`);
    return { data: model };
  }

  model._id = uuid("83000000", window.__fixture.creates.length);

  const move = STATE_MOVES[tableName];
  if (move) {
    const record = RECORDS[move.records].find((candidate) => {
      return idOf(candidate._id) === idOf(model[move.recordId]);
    });
    const state = RECORDS[move.states].find((candidate) => {
      return idOf(candidate._id) === idOf(model[move.stateId]);
    });
    if (record && state) {
      record[move.current] = state;
      record[`${move.current}Id`] = new ObjectID(state._id);
    }
    model.startsAt = new Date();
  }

  if (tableName.endsWith("OwnerUser")) {
    model.user =
      [...PEOPLE, VIEWER].find((person) => {
        return idOf(person._id) === idOf(model.userId);
      }) || null;
  }

  RECORDS[tableName].push(model);
  return { data: model };
};

API.get = async (options) => {
  window.__fixture.unmodelled.push(
    `API.get ${options && options.url ? options.url.toString() : ""}`,
  );
  return { data: { data: [], count: 0 } };
};

API.post = async (options) => {
  window.__fixture.unmodelled.push(
    `API.post ${options && options.url ? options.url.toString() : ""}`,
  );
  return { data: { data: [], count: 0 } };
};

// ------------------------------------------------------------- the gallery

const KIND_ROWS = isEmpty
  ? []
  : MONITORS.slice(0, 4).map((source, index) => {
      // Copies, so the Monitors page keeps its own rows as they are.
      const record = monitor(
        200 + index,
        source.name,
        source.description,
        source.monitorType,
        source.currentMonitorStatus,
        { labels: source.labels },
      );
      /*
       * Every other row leaves its optional values unset - but its labels
       * under data=labels, so a phone's card shows four labels and the
       * fold of five ("2 more labels") too.
       */
      if (index % 2 === 1) {
        record.description = "";
        if (!isNumberedLabels) {
          record.labels = [];
        }
      }
      record.disableActiveMonitoring = index === 2;
      return record;
    });

RECORDS.GalleryMonitor = KIND_ROWS;

function GalleryKinds() {
  return (
    <ModelTable
      modelType={Monitor}
      id="gallery-kinds"
      name="Gallery: every kind of column"
      userPreferencesKey="gallery-kinds"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      isViewable={true}
      showViewIdButton={true}
      showRefreshButton={true}
      searchableFields={["name", "description"]}
      viewPageRoute={Navigation.getCurrentRoute()}
      bulkActions={{ buttons: [] }}
      cardProps={{
        title: "Every kind of column",
        description:
          "Text, a sentence that wraps, a pill, labels, a date, a yes/no, a number and an empty value.",
      }}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          fieldType: "Text",
          required: true,
        },
      ]}
      filters={[]}
      columns={[
        { field: { name: true }, title: "Name", type: FieldType.Text },
        {
          field: { description: true },
          title: "Description",
          type: FieldType.LongText,
          wrapContent: true,
        },
        {
          field: { currentMonitorStatus: { name: true, color: true } },
          title: "Monitor Status",
          type: FieldType.Entity,
          getElement: (item) => {
            return item.currentMonitorStatus ? (
              <Pill
                color={item.currentMonitorStatus.color}
                text={item.currentMonitorStatus.name}
              />
            ) : (
              <></>
            );
          },
        },
        {
          field: { labels: { name: true, color: true } },
          title: "Labels",
          type: FieldType.EntityArray,
          getElement: (item) => {
            return <LabelsElement labels={item.labels || []} />;
          },
        },
        {
          field: { createdAt: true },
          title: "Created",
          type: FieldType.DateTime,
        },
        {
          field: { disableActiveMonitoring: true },
          title: "Paused",
          type: FieldType.Boolean,
        },
        {
          field: { monitorType: true },
          title: "Monitor Type",
          type: FieldType.Text,
        },
      ]}
    />
  );
}

function GalleryWide() {
  return (
    <ModelTable
      modelType={Incident}
      id="gallery-wide"
      name="Gallery: many columns"
      userPreferencesKey="gallery-wide"
      isDeleteable={true}
      isEditable={false}
      isCreateable={false}
      isViewable={true}
      viewPageRoute={Navigation.getCurrentRoute()}
      cardProps={{
        title: "A table with many columns",
        description: "Wider than the card: the rows scroll sideways.",
      }}
      filters={[]}
      selectMoreFields={{ incidentNumberWithPrefix: true }}
      columns={[
        {
          field: { incidentNumber: true },
          title: "Incident Number",
          type: FieldType.Number,
        },
        { field: { title: true }, title: "Title", type: FieldType.Text },
        {
          field: { currentIncidentState: { name: true, color: true } },
          title: "Current State",
          type: FieldType.Entity,
          getElement: (item) => {
            return (
              <Pill
                isMinimal={true}
                color={item.currentIncidentState.color}
                text={item.currentIncidentState.name}
              />
            );
          },
        },
        {
          field: { incidentSeverity: { name: true, color: true } },
          title: "Incident Severity",
          type: FieldType.Entity,
          getElement: (item) => {
            return (
              <Pill
                isMinimal={true}
                color={item.incidentSeverity.color}
                text={item.incidentSeverity.name}
              />
            );
          },
        },
        {
          field: { declaredAt: true },
          title: "Declared At",
          type: FieldType.DateTime,
        },
        {
          field: { createdAt: true },
          title: "Created At",
          type: FieldType.DateTime,
        },
        {
          field: { description: true },
          title: "Description",
          type: FieldType.Text,
        },
        {
          field: { labels: { name: true, color: true } },
          title: "Labels",
          type: FieldType.EntityArray,
          getElement: (item) => {
            return <LabelsElement labels={item.labels || []} />;
          },
        },
        {
          field: { isPrivate: true },
          title: "Is Private",
          type: FieldType.Boolean,
        },
      ]}
    />
  );
}

function GalleryPlain() {
  return (
    <ModelTable
      modelType={Monitor}
      id="gallery-plain"
      name="Gallery: a table outside a card"
      userPreferencesKey="gallery-plain"
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      filters={[]}
      columns={[
        { field: { name: true }, title: "Name", type: FieldType.Text },
        {
          field: { monitorType: true },
          title: "Monitor Type",
          type: FieldType.Text,
        },
        {
          field: { createdAt: true },
          title: "Created",
          type: FieldType.Date,
        },
      ]}
    />
  );
}

/*
 * A list whose rows' names are not a line of text: the Dashboard's own
 * person, a picture beside a name over an email (a team's members, a
 * project's people). Such a name keeps its 20rem cap even in a table with
 * room to spare - set free, it would wrap inside itself.
 */
function GalleryPeople() {
  return (
    <ModelTable
      modelType={UserModel}
      id="gallery-people"
      name="Gallery: people"
      userPreferencesKey="gallery-people"
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      filters={[]}
      cardProps={{
        title: "People",
        description: "Each name drawn beside a picture, over an email.",
      }}
      columns={[
        {
          field: { name: true, email: true },
          title: "Person",
          type: FieldType.Element,
          getElement: (item) => {
            return <UserElement user={item} />;
          },
        },
        { field: { email: true }, title: "Email", type: FieldType.Email },
      ]}
    />
  );
}

const GALLERY = {
  kinds: GalleryKinds,
  wide: GalleryWide,
  plain: GalleryPlain,
  people: GalleryPeople,
};

/*
 * The gallery's kinds table reads monitors through its own name so its rows
 * can leave values unset without changing the Monitors page's.
 */
const galleryGetList = ModelAPI.getList;
ModelAPI.getList = async (options) => {
  const tableName = new options.modelType().tableName;
  if (
    tableName === "Monitor" &&
    window.location.pathname.endsWith("/tables") &&
    galleryTable === "kinds"
  ) {
    return galleryGetList({
      ...options,
      modelType: function GalleryMonitor() {
        return { tableName: "GalleryMonitor" };
      },
    });
  }
  return galleryGetList(options);
};

/*
 * The Dashboard looks every string up by its English text, so the separators
 * i18next reads in a key (the "." and ":" of a sentence) are turned off, as
 * the Dashboard's own setup does.
 */
await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: language,
  resources: {
    en: { translation: {} },
    de: { translation: DE },
    ja: { translation: JA },
    fa: { translation: FA },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
document.documentElement.lang = language;
if (language === "fa") {
  document.documentElement.dir = "rtl";
}

function Shell(props) {
  const navigate = useNavigate();
  Navigation.setNavigateHook((to, options) => {
    window.__fixture.navigations.push(to.toString());
    return navigate(to, options);
  });
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  const Page = props.page;
  return (
    <main className="mx-auto max-w-[1500px] px-4 py-8 sm:px-8">
      <div className="mb-7 text-sm text-gray-500" data-testid="fixture-trail">
        {props.trail}
      </div>
      <Page
        pageRoute={Navigation.getCurrentRoute()}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </main>
  );
}

/*
 * A page in its product's real layout - the Page with its side menu and
 * breadcrumbs - drawn across the window as the Dashboard draws it, not in
 * the gallery's narrower column: the card is as wide as it is in the
 * product.
 */
function LayoutShell(props) {
  const navigate = useNavigate();
  Navigation.setNavigateHook((to, options) => {
    window.__fixture.navigations.push(to.toString());
    return navigate(to, options);
  });
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  const Layout = props.layout;
  return (
    <Layout
      pageRoute={Navigation.getCurrentRoute()}
      currentProject={null}
      hasPaymentMethod={true}
    />
  );
}

// One of the layout's pages, where its <Outlet /> is.
function InLayout(props) {
  const Page = props.page;
  return (
    <Page
      pageRoute={Navigation.getCurrentRoute()}
      currentProject={null}
      hasPaymentMethod={true}
    />
  );
}

function GalleryPage() {
  const Table = GALLERY[galleryTable] || GalleryKinds;
  return <Table />;
}

const BASE = `/dashboard/${PROJECT_ID}`;

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <PageRoute
        path={`${BASE}/incidents`}
        element={<Shell page={IncidentsPage} trail="Incidents" />}
      />
      <PageRoute
        path={`${BASE}/incidents/:modelId`}
        element={<Shell page={() => <p>Incident</p>} trail="Incident" />}
      />
      <PageRoute
        path={`${BASE}/alerts`}
        element={<Shell page={AlertsPage} trail="Alerts" />}
      />
      <PageRoute
        path={`${BASE}/alerts/:modelId`}
        element={<Shell page={() => <p>Alert</p>} trail="Alert" />}
      />
      <PageRoute
        path={`${BASE}/monitors`}
        element={<Shell page={MonitorsPage} trail="Monitors" />}
      />
      <PageRoute
        path={`${BASE}/monitors/:modelId`}
        element={<Shell page={() => <p>Monitor</p>} trail="Monitor" />}
      />
      <PageRoute
        path={`${BASE}/status-pages`}
        element={<Shell page={StatusPagesPage} trail="Status Pages" />}
      />
      <PageRoute
        path={`${BASE}/settings/teams`}
        element={<Shell page={TeamsPage} trail="Settings / Teams" />}
      />
      <PageRoute
        path={`${BASE}/network-devices/settings/roles`}
        element={
          <Shell
            page={DeviceRolesPage}
            trail="Network Devices / Settings / Device Roles"
          />
        }
      />
      <PageRoute
        path={`${BASE}/tables`}
        element={<Shell page={GalleryPage} trail="Tables" />}
      />
      <PageRoute
        path={`${BASE}/runbooks`}
        element={<LayoutShell layout={RunbooksLayout} />}
      >
        <PageRoute index element={<InLayout page={RunbooksPage} />} />
      </PageRoute>
      <PageRoute
        path={`${BASE}/runbooks/:modelId`}
        element={<Shell page={() => <p>Runbook</p>} trail="Runbook" />}
      />
      <PageRoute
        path={`${BASE}/card-headers`}
        element={<Shell page={CardHeadersPage} trail="Card headers" />}
      />
      <PageRoute
        path="*"
        element={<Shell page={() => <p>Not modelled</p>} trail="Elsewhere" />}
      />
    </Routes>
  </BrowserRouter>,
);

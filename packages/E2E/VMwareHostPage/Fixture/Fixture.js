/*
 * Offline fixture for an ESXi host's page inside its vCenter: the production
 * vCenter layout (ModelPage, the vCenter side menu) and the production host
 * page (Pages/VMware/View/HostDetail) under their real RouteMap patterns,
 * plus the vCenter's Recommendations page that the host's "Turn on N
 * alerts" opens. Only the data boundary (ModelAPI, AnalyticsModelAPI, API,
 * Realtime) and the signed-in user are replaced. Every record is fabricated
 * for an "Acme Virtualization" workspace.
 *
 * Scenarios are picked with query parameters, parsed once at load:
 *
 *   ?state=      reporting (default) | not-reporting (newest metrics 2 h
 *                old) | no-data (in the inventory, no metrics yet) | gone
 *                (not in the inventory any more)
 *   ?vms=        many (default: seven VMs and a template) | none
 *   ?devices=0   vCenter reports no per-device counters (statistics level 1)
 *   ?alerts=     none (default) | some (CPU and memory saturation on) |
 *                all (every host alert on) | denied (the role may not read
 *                monitors)
 *   ?open=       0 (default) | 1 (an incident and two alerts for this host,
 *                and one for another host) | many (seven for this host)
 *   ?collection= agent (default) | probe
 *   ?standalone=1  the host is in no cluster
 *   ?lang=       de reads the German locale file
 *   ?theme=      dark adds html.dark (handled by server.js)
 *
 * Every read is recorded on window.__vmwareHostPageFixture: listRequests,
 * countRequests, itemRequests, aggregateRequests, apiRequests and
 * unhandled - anything the fixture does not model. The spec asserts
 * `unhandled` is empty.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import de from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import VCenterLayout from "../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/Layout";
import HostDetailPage from "../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/HostDetail";
import RecommendationsPage from "../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/Recommendations";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
import VMwareResource from "Common/Models/DatabaseModels/VMwareResource";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import Color from "Common/Types/Color";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorRecommendationCatalog from "Common/Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import Realtime from "Common/UI/Utils/Realtime";
import UserUtil from "Common/UI/Utils/User";

/*
 * ---------------------------------------------------------------------------
 * Scenario switches
 * ---------------------------------------------------------------------------
 */
const params = new URLSearchParams(window.location.search);

const STATE = ["not-reporting", "no-data", "gone"].includes(params.get("state"))
  ? params.get("state")
  : "reporting";
const HAS_VMS = params.get("vms") !== "none";
const HAS_DEVICES = params.get("devices") !== "0";
const ALERTS = ["some", "all", "denied"].includes(params.get("alerts"))
  ? params.get("alerts")
  : "none";
const OPEN = ["1", "many"].includes(params.get("open"))
  ? params.get("open")
  : "0";
const COLLECTION = params.get("collection") === "probe" ? "Probe" : "Agent";
const IS_STANDALONE = params.get("standalone") === "1";
const LANGUAGE = params.get("lang") === "de" ? "de" : "en";

const GLOBAL_PERMISSIONS = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];
const rolePermissions = [...GLOBAL_PERMISSIONS, Permission.ProjectOwner];

/*
 * ---------------------------------------------------------------------------
 * Ids and records
 * ---------------------------------------------------------------------------
 */
const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const projectObjectId = new ObjectID(PROJECT_ID);

function uuid(prefix, number) {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

const VCENTER_ID = uuid("31000000", 1);
const VCENTER_NAME = "vcenter-prod";
const DATACENTER = "dc-east";
const CLUSTER = "prod-cluster";
const HOST_NAME = "esx01.acme.example";
const HOST_EXTERNAL_ID = `host/${DATACENTER}/${HOST_NAME}`;
const OTHER_HOST_NAME = "esx02.acme.example";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const MINUTE = 60 * 1000;
const LOADED_AT = Date.now();

const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Virtualization",
});

const vcenter = {
  _id: VCENTER_ID,
  name: VCENTER_NAME,
  otelCollectorStatus: "connected",
  collectionMethod: COLLECTION,
  lastSeenAt: new Date(LOADED_AT - MINUTE),
  isArchived: false,
};

// When vCenter last reported the host's metrics, per scenario.
const metricsUpdatedAt =
  STATE === "not-reporting"
    ? new Date(LOADED_AT - 2 * 60 * MINUTE)
    : STATE === "no-data"
      ? null
      : new Date(LOADED_AT - 2 * MINUTE);

const hostRow = {
  _id: uuid("40000000", 1),
  vmwareVCenterId: VCENTER_ID,
  kind: "Host",
  externalId: HOST_EXTERNAL_ID,
  name: HOST_NAME,
  datacenterName: DATACENTER,
  clusterName: IS_STANDALONE ? undefined : CLUSTER,
  hostName: HOST_NAME,
  latestCpuPercent: STATE === "no-data" ? undefined : 41.6,
  latestCpuMhz: STATE === "no-data" ? undefined : 31949,
  cpuCapacityMhz: 76800,
  latestMemoryBytes: STATE === "no-data" ? undefined : 316 * GIB,
  maxMemoryBytes: 512 * GIB,
  latestMemoryPercent: STATE === "no-data" ? undefined : 61.7,
  metricsUpdatedAt: metricsUpdatedAt || undefined,
  lastSeenAt: new Date(LOADED_AT - 2 * MINUTE),
};

function vm(number, fields) {
  return {
    _id: uuid("41000000", number),
    vmwareVCenterId: VCENTER_ID,
    kind: "VirtualMachine",
    externalId: `vm/4210aaaa-bbbb-cccc-dddd-${String(number).padStart(12, "0")}`,
    vmInstanceUuid: `4210aaaa-bbbb-cccc-dddd-${String(number).padStart(12, "0")}`,
    datacenterName: DATACENTER,
    clusterName: IS_STANDALONE ? undefined : CLUSTER,
    hostName: HOST_NAME,
    resourcePoolName: "Resources",
    isTemplate: false,
    metricsUpdatedAt: vmMetricsUpdatedAt,
    lastSeenAt: new Date(LOADED_AT - 2 * MINUTE),
    ...fields,
  };
}

/*
 * A host vCenter stopped reporting stops with its VMs; a host gone from the
 * inventory took its VMs with it (moved, or pruned with it).
 */
const vmMetricsUpdatedAt =
  STATE === "not-reporting"
    ? metricsUpdatedAt
    : new Date(LOADED_AT - 2 * MINUTE);

const virtualMachines =
  HAS_VMS && STATE !== "gone"
    ? [
        vm(1, {
          name: "db-primary",
          isPoweredOn: true,
          latestCpuPercent: 78.4,
          latestCpuMhz: 7526,
          latestMemoryBytes: 58 * GIB,
          maxMemoryBytes: 64 * GIB,
          latestMemoryPercent: 90.6,
          cpuReadinessPercent: 6.2,
        }),
        vm(2, {
          name: "ci-runner-01",
          isPoweredOn: true,
          latestCpuPercent: 64.1,
          latestCpuMhz: 6154,
          latestMemoryBytes: 11 * GIB,
          maxMemoryBytes: 16 * GIB,
          cpuReadinessPercent: 12.4,
        }),
        vm(3, {
          name: "web-01",
          isPoweredOn: true,
          latestCpuPercent: 31.9,
          latestCpuMhz: 1531,
          latestMemoryBytes: 5 * GIB,
          maxMemoryBytes: 8 * GIB,
          cpuReadinessPercent: 1.1,
        }),
        vm(4, {
          name: "web-02",
          isPoweredOn: true,
          latestCpuPercent: 28.2,
          latestCpuMhz: 1354,
          latestMemoryBytes: 5 * GIB,
          maxMemoryBytes: 8 * GIB,
          cpuReadinessPercent: 0.9,
        }),
        vm(5, {
          name: "cache-01",
          isPoweredOn: true,
          latestCpuPercent: 12.7,
          latestCpuMhz: 610,
          latestMemoryBytes: 24 * GIB,
          maxMemoryBytes: 32 * GIB,
        }),
        vm(6, {
          name: "analytics-worker-with-a-rather-long-name-01",
          isPoweredOn: true,
          latestCpuPercent: 9.3,
          latestCpuMhz: 893,
          latestMemoryBytes: 30 * GIB,
          maxMemoryBytes: 48 * GIB,
        }),
        vm(7, {
          name: "legacy-app",
          isPoweredOn: false,
          resourcePoolName: "Retired",
          metricsUpdatedAt: new Date(LOADED_AT - 3 * 24 * 60 * MINUTE),
        }),
        vm(8, {
          name: "ubuntu-24-template",
          isTemplate: true,
          latestDiskBytes: 18 * GIB,
        }),
      ]
    : [];

/*
 * The vCenter's other host and its one VM: never on this host's page (the
 * VM read is scoped by host name), so they prove the scoping.
 */
const otherHostVirtualMachine = vm(20, {
  name: "other-host-vm",
  hostName: OTHER_HOST_NAME,
  isPoweredOn: true,
  latestCpuPercent: 99,
});

const incidentStates = [
  {
    _id: uuid("50000000", 1),
    name: "Identified",
    order: 1,
    isResolvedState: false,
  },
  {
    _id: uuid("50000000", 2),
    name: "Acknowledged",
    order: 2,
    isResolvedState: false,
  },
  {
    _id: uuid("50000000", 3),
    name: "Resolved",
    order: 3,
    isResolvedState: true,
  },
];
const alertStates = [
  {
    _id: uuid("51000000", 1),
    name: "Created",
    order: 1,
    isResolvedState: false,
  },
  {
    _id: uuid("51000000", 2),
    name: "Acknowledged",
    order: 2,
    isResolvedState: false,
  },
  {
    _id: uuid("51000000", 3),
    name: "Resolved",
    order: 3,
    isResolvedState: true,
  },
];

const criticalIncident = Object.assign(new IncidentSeverity(), {
  _id: uuid("52000000", 1),
  name: "Critical",
  color: new Color("#ef4444"),
});
const warningAlert = Object.assign(new AlertSeverity(), {
  _id: uuid("53000000", 1),
  name: "Warning",
  color: new Color("#f59e0b"),
});

function incident(number, fields) {
  return {
    _id: uuid("60000000", number),
    title: `[VMware] Host CPU Saturation (>90%) - ${VCENTER_NAME}`,
    incidentNumber: number,
    declaredAt: new Date(LOADED_AT - (10 + number) * MINUTE),
    createdAt: new Date(LOADED_AT - (10 + number) * MINUTE),
    seriesLabels: { "resource.vcenter.host.name": HOST_NAME },
    incidentSeverity: criticalIncident,
    currentIncidentState: Object.assign(new IncidentState(), {
      name: "Identified",
    }),
    ...fields,
  };
}

function alert(number, fields) {
  return {
    _id: uuid("61000000", number),
    title: `[VMware] Host Network Packet Errors - ${VCENTER_NAME}`,
    alertNumber: number,
    createdAt: new Date(LOADED_AT - (3 + number) * MINUTE),
    seriesLabels: { "resource.vcenter.host.name": HOST_NAME },
    alertSeverity: warningAlert,
    currentAlertState: Object.assign(new AlertState(), { name: "Created" }),
    ...fields,
  };
}

const incidents = [];
const alerts = [];

if (OPEN === "1") {
  incidents.push(incident(1, {}));
  // Another host's: never on this host's page.
  incidents.push(
    incident(2, {
      title: `[VMware] Host Memory Saturation (>90%) - ${VCENTER_NAME}`,
      seriesLabels: { "resource.vcenter.host.name": OTHER_HOST_NAME },
    }),
  );
  alerts.push(alert(1, {}));
  alerts.push(
    alert(2, {
      title: `[VMware] Host Disk Latency High (>50 ms) - ${VCENTER_NAME}`,
      seriesLabels: { "resource.vcenter.host.name": HOST_NAME.toUpperCase() },
    }),
  );
} else if (OPEN === "many") {
  for (let number = 1; number <= 3; number++) {
    incidents.push(incident(number, {}));
  }
  for (let number = 1; number <= 4; number++) {
    alerts.push(alert(number, {}));
  }
}

/*
 * The monitors that cover host alerts, built from the recommendation's own
 * step for this vCenter - exactly what Create on the Recommendations page
 * would have saved.
 */
const HOST_ALERT_IDS = [
  "vmware-host-cpu-saturation",
  "vmware-host-memory-saturation",
  "vmware-host-disk-latency-high",
  "vmware-host-network-packet-errors",
  "vmware-host-network-packet-drops",
];
const coveredAlertIds =
  ALERTS === "some"
    ? HOST_ALERT_IDS.slice(0, 2)
    : ALERTS === "all"
      ? HOST_ALERT_IDS
      : [];

const zeroId = ObjectID.getZeroObjectID();
const monitors = MonitorRecommendationCatalog.getRecommendations(
  MonitorRecommendationResourceType.VMware,
)
  .filter((recommendation) => {
    return coveredAlertIds.includes(recommendation.templateId);
  })
  .map((recommendation, index) => {
    const monitorSteps = new MonitorSteps();
    monitorSteps.data = {
      monitorStepsInstanceArray: [
        recommendation.getMonitorStep({
          resourceIdentifier: VCENTER_NAME,
          onlineMonitorStatusId: zeroId,
          offlineMonitorStatusId: zeroId,
          defaultIncidentSeverityId: zeroId,
          defaultAlertSeverityId: zeroId,
          monitorName: VCENTER_NAME,
        }),
      ],
      defaultMonitorStatusId: zeroId,
    };
    return {
      _id: uuid("70000000", index + 1),
      name: `${VCENTER_NAME} - ${recommendation.name}`,
      monitorType: MonitorType.VMware,
      monitorSteps: monitorSteps,
    };
  });

/*
 * ---------------------------------------------------------------------------
 * Metrics: generated per minute, the way the analytics server buckets a
 * window of three hours or less
 * ---------------------------------------------------------------------------
 */
function wave(time, base, amplitude, periodMinutes, phase) {
  return (
    base +
    amplitude * Math.sin((time / MINUTE / periodMinutes) * 2 * Math.PI + phase)
  );
}

// [object, direction, value(time)] per metric; "" is the whole host.
const SERIES = {
  "vcenter.host.cpu.utilization": [["", "", (t) => wave(t, 41, 9, 23, 0)]],
  "vcenter.host.memory.utilization": [["", "", (t) => wave(t, 61, 2, 47, 1)]],
  // MiB, as the receiver reports host memory.
  "vcenter.host.memory.usage": [["", "", (t) => wave(t, 323000, 9000, 47, 1)]],
  "vcenter.host.network.throughput": [
    ["", "received", (t) => wave(t, 21000, 6000, 13, 0)],
    ["", "transmitted", (t) => wave(t, 9500, 3000, 17, 1)],
    ["vmnic0", "received", (t) => wave(t, 14000, 4000, 13, 0)],
    ["vmnic0", "transmitted", (t) => wave(t, 6500, 2000, 17, 1)],
    ["vmnic1", "received", (t) => wave(t, 7000, 2000, 13, 0)],
    ["vmnic1", "transmitted", (t) => wave(t, 3000, 1000, 17, 1)],
  ],
  "vcenter.host.network.packet.rate": [
    ["", "received", (t) => wave(t, 2400, 500, 13, 0)],
    ["", "transmitted", (t) => wave(t, 1500, 300, 17, 1)],
    ["vmnic0", "received", (t) => wave(t, 1600, 300, 13, 0)],
    ["vmnic0", "transmitted", (t) => wave(t, 1000, 200, 17, 1)],
    ["vmnic1", "received", (t) => wave(t, 800, 200, 13, 0)],
    ["vmnic1", "transmitted", (t) => wave(t, 500, 100, 17, 1)],
  ],
  "vcenter.host.network.packet.error.rate": [
    ["", "received", () => 0.4],
    ["vmnic0", "received", () => 0],
    ["vmnic0", "transmitted", () => 0],
    ["vmnic1", "received", () => 0.4],
    ["vmnic1", "transmitted", () => 0],
  ],
  "vcenter.host.network.packet.drop.rate": [
    ["", "received", () => 0],
    ["vmnic0", "received", () => 0],
    ["vmnic0", "transmitted", () => 0],
    ["vmnic1", "received", () => 0],
    ["vmnic1", "transmitted", () => 0],
  ],
  "vcenter.host.disk.throughput": [
    ["", "read", (t) => wave(t, 52000, 15000, 11, 0)],
    ["", "write", (t) => wave(t, 31000, 9000, 19, 2)],
    [
      "naa.600508b1001c4d41ad6b8b6d9c2a0f17",
      "read",
      (t) => wave(t, 47000, 14000, 11, 0),
    ],
    [
      "naa.600508b1001c4d41ad6b8b6d9c2a0f17",
      "write",
      (t) => wave(t, 29000, 8000, 19, 2),
    ],
    [
      "t10.NVMe____Dell_Ent_NVMe_v2_AGN_RI_U.2_1.92TB",
      "read",
      (t) => wave(t, 5000, 1000, 11, 0),
    ],
    [
      "t10.NVMe____Dell_Ent_NVMe_v2_AGN_RI_U.2_1.92TB",
      "write",
      (t) => wave(t, 2000, 500, 19, 2),
    ],
  ],
  "vcenter.host.disk.latency.avg": [
    [
      "naa.600508b1001c4d41ad6b8b6d9c2a0f17",
      "read",
      (t) => wave(t, 24, 4, 11, 0),
    ],
    [
      "naa.600508b1001c4d41ad6b8b6d9c2a0f17",
      "write",
      (t) => wave(t, 58, 6, 19, 2),
    ],
    ["t10.NVMe____Dell_Ent_NVMe_v2_AGN_RI_U.2_1.92TB", "read", () => 0.4],
    ["t10.NVMe____Dell_Ent_NVMe_v2_AGN_RI_U.2_1.92TB", "write", () => 0.7],
  ],
  "vcenter.host.disk.latency.max": [["", "", (t) => wave(t, 31, 14, 9, 0)]],
};

const HOST_ATTRIBUTES = {
  "resource.vmware.vcenter.name": VCENTER_NAME,
  "resource.vcenter.datacenter.name": DATACENTER,
  "resource.vcenter.host.name": HOST_NAME,
};

// Whether a read's attribute filter is this host's.
function isThisHost(attributes) {
  for (const [key, value] of Object.entries(attributes || {})) {
    if (HOST_ATTRIBUTES[key] !== undefined && HOST_ATTRIBUTES[key] !== value) {
      return false;
    }
  }
  return attributes?.["resource.vcenter.host.name"] === HOST_NAME;
}

function generateRows(aggregateBy) {
  const query = aggregateBy.query || {};
  const name = query.name;
  const series = SERIES[name];

  if (!series || !isThisHost(query.attributes)) {
    return null;
  }

  if (STATE === "no-data" || STATE === "gone") {
    return [];
  }

  const start = new Date(aggregateBy.startTimestamp).getTime();
  const end = new Date(aggregateBy.endTimestamp).getTime();
  // Not reporting: nothing in the last two hours.
  const lastPoint =
    STATE === "not-reporting"
      ? Math.min(end, metricsUpdatedAt.getTime())
      : Math.min(end, LOADED_AT);

  const groupKeys = aggregateBy.groupByAttributeKeys || [];
  const groupedByAttributes = Boolean(aggregateBy.groupBy?.attributes);
  const perDevice = groupKeys.length > 0 || groupedByAttributes;

  const rows = [];

  for (
    let time = Math.ceil(start / MINUTE) * MINUTE;
    time <= lastPoint;
    time += MINUTE
  ) {
    for (const [object, direction, value] of series) {
      if (!HAS_DEVICES && object !== "") {
        continue;
      }
      if (!perDevice && object !== "") {
        continue;
      }
      const attributes = {};
      if (perDevice) {
        if (groupedByAttributes) {
          Object.assign(attributes, HOST_ATTRIBUTES);
        }
        if (object !== "" || groupKeys.includes("object")) {
          attributes.object = object;
        }
        if (direction) {
          attributes.direction = direction;
        }
      }
      rows.push({
        timestamp: new Date(time),
        value: Math.max(0, value(time)),
        ...(perDevice ? { attributes } : {}),
      });
    }
  }

  return rows;
}

/*
 * ---------------------------------------------------------------------------
 * Recorder
 * ---------------------------------------------------------------------------
 */
const fixture = {
  scenario: {
    state: STATE,
    vms: HAS_VMS,
    devices: HAS_DEVICES,
    alerts: ALERTS,
    open: OPEN,
    collection: COLLECTION,
    standalone: IS_STANDALONE,
    language: LANGUAGE,
  },
  listRequests: [],
  countRequests: [],
  itemRequests: [],
  aggregateRequests: [],
  apiRequests: [],
  unhandled: [],
};
window.__vmwareHostPageFixture = fixture;

function serialize(value) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value));
}

function tableName(modelType) {
  return new modelType().tableName;
}

function plain(value) {
  if (value instanceof ObjectID) {
    return value.toString();
  }
  return value;
}

// A query's plain values must match, as the server would compare them.
function matches(record, query) {
  for (const [field, wanted] of Object.entries(query || {})) {
    const value = plain(wanted);
    if (
      typeof value !== "string" &&
      typeof value !== "boolean" &&
      typeof value !== "number"
    ) {
      continue;
    }
    if (field === "projectId") {
      continue;
    }
    if ((record[field] ?? "") !== value) {
      return false;
    }
  }
  return true;
}

/*
 * The project's records, by table. Tables the pages read that this project
 * has nothing in are modelled as empty; a read of any other is `unhandled`.
 */
const store = {
  VMwareVCenter: [vcenter],
  VMwareResource: [
    ...(STATE === "gone" ? [] : [hostRow]),
    ...virtualMachines,
    otherHostVirtualMachine,
  ],
  IncidentState: incidentStates,
  AlertState: alertStates,
  ScheduledMaintenanceState: [
    { _id: uuid("54000000", 1), name: "Scheduled", order: 1 },
    { _id: uuid("54000000", 2), name: "Ongoing", order: 2 },
    {
      _id: uuid("54000000", 3),
      name: "Completed",
      order: 3,
      isResolvedState: true,
      isEndedState: true,
    },
  ],
  Incident: incidents,
  Alert: alerts,
  ScheduledMaintenance: [],
  Monitor: monitors,
  RecommendationDismissal: [],
  LogSavedView: [],
  /*
   * What the Logs tab's explorer and the Metrics tab's charts look up to
   * name what they show: this project has none of them.
   */
  Service: [],
  Host: [],
  DockerHost: [],
  PodmanHost: [],
  KubernetesCluster: [],
  MetricType: [],
};

function rows(modelType, query) {
  const name = tableName(modelType);
  if (!store[name]) {
    return null;
  }
  return store[name]
    .filter((record) => {
      return matches(record, query);
    })
    .map((record) => {
      return Object.assign(new modelType(), record);
    });
}

/*
 * ---------------------------------------------------------------------------
 * Identity and data-layer stubs
 * ---------------------------------------------------------------------------
 */
UserUtil.isMasterAdmin = () => {
  return false;
};
UserUtil.getUserId = () => {
  return new ObjectID(uuid("80000000", 1));
};
UserUtil.getName = () => {
  return "Sam Patel";
};
UserUtil.getEmail = () => {
  return "sam@acme-virtualization.example";
};
PermissionUtil.getAllPermissions = () => {
  return [...rolePermissions];
};
PermissionUtil.getGlobalPermissions = () => {
  return {
    _type: "UserGlobalAccessPermission",
    projectIds: [projectObjectId],
    globalPermissions: [...GLOBAL_PERMISSIONS],
  };
};
PermissionUtil.getProjectPermissions = () => {
  return {
    _type: "UserTenantAccessPermission",
    projectId: projectObjectId,
    permissions: rolePermissions
      .filter((permission) => {
        return !GLOBAL_PERMISSIONS.includes(permission);
      })
      .map((permission) => {
        return { _type: "UserPermission", permission, labelIds: [] };
      }),
  };
};
ProjectUtil.getCurrentProjectId = () => {
  return projectObjectId;
};
ProjectUtil.getCurrentProject = () => {
  return project;
};
ModelAPI.getCommonHeaders = () => {
  return { tenantid: PROJECT_ID };
};

const FORBIDDEN = "You do not have permission to read monitors.";

ModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.listRequests.push({
    modelName,
    query: serialize(options.query),
    select: serialize(options.select),
    limit: options.limit,
  });

  if (modelName === "Monitor" && ALERTS === "denied") {
    throw new Error(FORBIDDEN);
  }

  const data = rows(options.modelType, options.query);
  if (!data) {
    fixture.unhandled.push({ kind: "getList", modelName });
    return { data: [], count: 0, skip: 0, limit: 0 };
  }
  return { data, count: data.length, skip: 0, limit: options.limit || 10 };
};

ModelAPI.count = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.countRequests.push({ modelName, query: serialize(options.query) });

  const data = rows(options.modelType, options.query);
  if (!data) {
    fixture.unhandled.push({ kind: "count", modelName });
    return 0;
  }
  return data.length;
};

ModelAPI.getItem = async (options) => {
  const modelName = tableName(options.modelType);
  const id = plain(options.id);
  fixture.itemRequests.push({
    modelName,
    id,
    select: serialize(options.select),
  });

  if (!store[modelName]) {
    fixture.unhandled.push({ kind: "getItem", modelName });
    return null;
  }

  const record = store[modelName].find((candidate) => {
    return candidate._id === id;
  });

  return record ? Object.assign(new options.modelType(), record) : null;
};

AnalyticsModelAPI.aggregate = async (options) => {
  const modelName = tableName(options.modelType);
  const aggregateBy = options.aggregateBy;
  fixture.aggregateRequests.push({
    modelName,
    name: aggregateBy.query?.name,
    attributes: serialize(aggregateBy.query?.attributes),
    aggregationType: aggregateBy.aggregationType,
    groupByAttributeKeys: aggregateBy.groupByAttributeKeys || null,
    groupBy: serialize(aggregateBy.groupBy),
  });

  const data =
    modelName === "MetricItemV2" || modelName.startsWith("Metric")
      ? generateRows(aggregateBy)
      : null;

  if (!data) {
    fixture.unhandled.push({
      kind: "aggregate",
      modelName,
      name: aggregateBy.query?.name,
    });
    return { data: [] };
  }

  return { data };
};

AnalyticsModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.listRequests.push({ modelName, query: serialize(options.query) });

  /*
   * The host sent no syslog; no change events mark the Metrics tab's charts,
   * and their exemplar dots find no spans.
   */
  if (
    modelName.startsWith("Log") ||
    modelName.startsWith("ChangeEvent") ||
    modelName.startsWith("Metric")
  ) {
    return { data: [], count: 0, skip: 0, limit: options.limit || 10 };
  }

  fixture.unhandled.push({ kind: "analytics.getList", modelName });
  return { data: [], count: 0, skip: 0, limit: 0 };
};

AnalyticsModelAPI.count = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.countRequests.push({ modelName, query: serialize(options.query) });

  if (modelName.startsWith("Log")) {
    return 0;
  }

  fixture.unhandled.push({ kind: "analytics.count", modelName });
  return 0;
};

function ok(data) {
  return new HTTPResponse(200, data, {});
}

async function handleApi(method, options) {
  const url = options.url.toString();
  const parsed = new URL(url, window.location.origin);
  const body = options.data || {};
  fixture.apiRequests.push({
    method,
    url: parsed.pathname,
    body: serialize(body),
  });

  // The vCenter side menu's counts.
  if (
    method === "POST" &&
    parsed.pathname.includes("/vmware-resource/inventory-summary/")
  ) {
    return ok({
      hostCount: STATE === "gone" ? 1 : 2,
      virtualMachineCount:
        virtualMachines.filter((row) => {
          return !row.isTemplate;
        }).length + 1,
      datastoreCount: 3,
      clusterCount: IS_STANDALONE ? 0 : 1,
      resourcePoolCount: 2,
    });
  }

  /*
   * The vCenter's AI agent card: answered "no AI agent yet", as the server
   * answers for a vCenter nobody installed one for.
   */
  if (
    method === "POST" &&
    parsed.pathname.endsWith("/resource-ai-access/status")
  ) {
    return ok({
      resourceType: "VMwareVCenter",
      resourceId: VCENTER_ID,
      resourceName: VCENTER_NAME,
      isAiInvestigationEnabled: true,
      aiRemediationMode: "Disabled",
      aiCommandAllowlist: [],
      agent: null,
      gaps: [
        {
          code: "ai_agent_not_connected",
          title: "No AI agent is connected",
          nextStep: "Run the VMware AI agent next to the collector.",
          blocksInvestigation: true,
          blocksRemediation: true,
        },
      ],
      isInvestigationReady: false,
      isRemediationReady: false,
    });
  }

  // The Logs tab's explorer, for a host that sent no syslog.
  if (
    method === "POST" &&
    parsed.pathname.endsWith("/telemetry/logs/histogram")
  ) {
    return ok({ buckets: [], bucketSizeInMinutes: 1 });
  }
  if (method === "POST" && parsed.pathname.endsWith("/telemetry/logs/facets")) {
    return ok({ facets: {}, timedOutFacets: [] });
  }
  if (
    method === "POST" &&
    parsed.pathname.endsWith("/telemetry/logs/get-attributes")
  ) {
    return ok({ attributes: [] });
  }

  fixture.unhandled.push({ kind: "api", method, url: parsed.pathname });
  return new HTTPErrorResponse(404, { message: "Not modelled." }, {});
}

API.get = async (options) => {
  return handleApi("GET", options);
};
API.post = async (options) => {
  return handleApi("POST", options);
};
API.put = async (options) => {
  return handleApi("PUT", options);
};
API.delete = async (options) => {
  return handleApi("DELETE", options);
};
API.fetch = async (options) => {
  return handleApi(options.method || "GET", options);
};

// Live logs: the subscription is recorded and nothing is ever sent.
function subscribe() {
  return () => {};
}
Realtime.listenToAnalyticsModelEvent = subscribe;
Realtime.listenToModelEvent = subscribe;

await i18next.use(initReactI18next).init({
  lng: LANGUAGE,
  fallbackLng: "en",
  resources: {
    en: { translation: en },
    de: { translation: de },
  },
  interpolation: { escapeValue: false },
});

/*
 * ---------------------------------------------------------------------------
 * Router
 * ---------------------------------------------------------------------------
 */
function pageProps(pageKey) {
  return {
    pageRoute: RouteMap[pageKey],
    currentProject: project,
    hasPaymentMethod: true,
  };
}

function useNavigationHooks() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
}

function withNavigation(Component, pageKey) {
  return function NavigatedPage() {
    useNavigationHooks();
    return <Component {...pageProps(pageKey)} />;
  };
}

const FixtureVCenterLayout = withNavigation(
  VCenterLayout,
  PageMap.VMWARE_VCENTER_VIEW,
);
const FixtureHostDetail = withNavigation(
  HostDetailPage,
  PageMap.VMWARE_VCENTER_VIEW_HOST_DETAIL,
);
const FixtureRecommendations = withNavigation(
  RecommendationsPage,
  PageMap.VMWARE_VCENTER_VIEW_RECOMMENDATIONS,
);

// A page the host page links to that is not modelled: says where it is.
function StubPage() {
  useNavigationHooks();
  const location = useLocation();
  return (
    <main className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-xl font-semibold text-gray-900">Not modelled</h1>
      <p
        data-testid="stub-page"
        className="mt-2 break-all font-mono text-sm text-gray-600"
      >
        {location.pathname}
        {location.search}
      </p>
    </main>
  );
}

function FixtureApp() {
  useNavigationHooks();

  return (
    <>
      <header
        data-testid="fixture-header"
        className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-4 sm:px-6"
      >
        <div className="flex items-center gap-5">
          <span className="text-lg font-semibold text-gray-900">OneUptime</span>
          <span className="text-sm text-gray-500">Acme Virtualization</span>
        </div>
        <span data-testid="synthetic-banner" className="text-xs text-gray-500">
          Preview workspace · Synthetic data
        </span>
      </header>
      <Routes>
        <Route element={<FixtureVCenterLayout />}>
          <Route
            path={RouteMap[PageMap.VMWARE_VCENTER_VIEW_HOST_DETAIL].toString()}
            element={<FixtureHostDetail />}
          />
          <Route
            path={RouteMap[
              PageMap.VMWARE_VCENTER_VIEW_RECOMMENDATIONS
            ].toString()}
            element={<FixtureRecommendations />}
          />
        </Route>
        <Route path="*" element={<StubPage />} />
      </Routes>
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <FixtureApp />
  </BrowserRouter>,
);

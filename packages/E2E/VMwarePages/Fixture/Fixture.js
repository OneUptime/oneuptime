/*
 * Offline fixture for a vCenter's pages: the production vCenter layout
 * (ModelPage, the vCenter's side menu) with its Overview, its Hosts, Virtual
 * Machines, Datastores, Clusters and Resource Pools lists, the page of an
 * ESXi host, a VM, a datastore and a cluster, and the Recommendations page
 * their alert cards open - under their real RouteMap patterns. Only the data
 * boundary (ModelAPI, AnalyticsModelAPI, API, Realtime) and the signed-in
 * user are replaced. Every record is made up, for an "Acme Virtualization"
 * workspace (Fixture/Data.js).
 *
 * Scenarios are picked with query parameters, parsed once at load:
 *
 *   ?estate=    busy (default) | calm | new | large | standby (Data.js)
 *   ?collector= disconnected: the agent stopped reporting three days ago
 *   ?alerts=    none (default) | some (two host alerts on) | all | denied
 *               (the role may not read monitors)
 *   ?open=      0 | 1 (default: an incident on esx03, an alert on
 *               db-primary) | many
 *   ?fail=      inventory | metrics | events: that read fails, as a server
 *               that answers 500 does
 *   ?lang=      de or fa reads the German or Persian locale file (Persian
 *               lays the page out right to left)
 *   ?theme=     dark adds html.dark (server.js)
 *
 * Every read is recorded on window.__vmwarePagesFixture: listRequests,
 * countRequests, itemRequests, aggregateRequests, apiRequests and unhandled
 * - anything the fixture does not model. The spec keeps `unhandled` empty.
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
import fa from "../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import VCenterLayout from "../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/Layout";
import VCenterOverview from "../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/Index";
import VCenterHosts from "../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/Hosts";
import VCenterHostDetail from "../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/HostDetail";
import VCenterVirtualMachines from "../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/VirtualMachines";
import VCenterVirtualMachineDetail from "../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/VirtualMachineDetail";
import VCenterDatastores from "../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/Datastores";
import VCenterDatastoreDetail from "../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/DatastoreDetail";
import VCenterClusters from "../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/Clusters";
import VCenterClusterDetail from "../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/ClusterDetail";
import VCenterResourcePools from "../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/ResourcePools";
import VCenterRecommendations from "../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/Recommendations";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Project from "Common/Models/DatabaseModels/Project";
import Color from "Common/Types/Color";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import Includes from "Common/Types/BaseDatabase/Includes";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import LessThanOrEqual from "Common/Types/BaseDatabase/LessThanOrEqual";
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
import { followLanguageForPage } from "Common/UI/Utils/PageLanguage";
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import { ARCHIVABLE_VALUE_TABLE_NAMES } from "Common/Utils/ArchivableValues";
import { PROJECT_ID, VCENTER_ID, VCENTER_NAME, buildEstate, uuid } from "./Data";

/*
 * ---------------------------------------------------------------------------
 * Scenario switches
 * ---------------------------------------------------------------------------
 */
const params = new URLSearchParams(window.location.search);

const ESTATE = ["calm", "new", "large", "standby"].includes(
  params.get("estate"),
)
  ? params.get("estate")
  : "busy";
const COLLECTOR =
  params.get("collector") === "disconnected" ? "disconnected" : "connected";
const ALERTS = ["some", "all", "denied"].includes(params.get("alerts"))
  ? params.get("alerts")
  : "none";
const OPEN = ["0", "many"].includes(params.get("open"))
  ? params.get("open")
  : "1";
const FAIL = ["inventory", "metrics", "events"].includes(params.get("fail"))
  ? params.get("fail")
  : "";
const LANGUAGE = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

const GLOBAL_PERMISSIONS = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];
const rolePermissions = [...GLOBAL_PERMISSIONS, Permission.ProjectOwner];

/*
 * ---------------------------------------------------------------------------
 * The clock, the project and the estate
 * ---------------------------------------------------------------------------
 */
const MINUTE = 60 * 1000;
const MIB = 1024 * 1024;
const LOADED_AT = Date.now();
const projectObjectId = new ObjectID(PROJECT_ID);

const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Virtualization",
});

const estate = buildEstate({ estate: ESTATE, collector: COLLECTOR }, LOADED_AT);

/*
 * ---------------------------------------------------------------------------
 * Open incidents and alerts on the vCenter, each naming its part in its
 * series labels the way a VMware template groups them (VMwareGroupByKey).
 * ---------------------------------------------------------------------------
 */
const incidentStates = [
  { _id: uuid("50000000", 1), name: "Identified", order: 1 },
  { _id: uuid("50000000", 2), name: "Acknowledged", order: 2 },
  {
    _id: uuid("50000000", 3),
    name: "Resolved",
    order: 3,
    isResolvedState: true,
  },
];
const alertStates = [
  { _id: uuid("51000000", 1), name: "Created", order: 1 },
  { _id: uuid("51000000", 2), name: "Acknowledged", order: 2 },
  {
    _id: uuid("51000000", 3),
    name: "Resolved",
    order: 3,
    isResolvedState: true,
  },
];
const criticalIncident = {
  _id: uuid("52000000", 1),
  name: "Critical",
  color: new Color("#dc2626"),
};
const warningAlert = {
  _id: uuid("53000000", 1),
  name: "Warning",
  color: new Color("#d97706"),
};

function openIncident(number, title, labels, minutesAgo) {
  return {
    _id: uuid("56000000", number),
    title: `[VMware] ${title} - ${VCENTER_NAME}`,
    incidentNumber: 40 + number,
    incidentNumberWithPrefix: `INC-${40 + number}`,
    declaredAt: new Date(LOADED_AT - minutesAgo * MINUTE),
    createdAt: new Date(LOADED_AT - minutesAgo * MINUTE),
    seriesLabels: labels,
    incidentSeverity: criticalIncident,
    currentIncidentState: incidentStates[0],
    currentIncidentStateId: incidentStates[0]._id,
    vmwareVCenterIds: [VCENTER_ID],
  };
}

function openAlert(number, title, labels, minutesAgo) {
  return {
    _id: uuid("57000000", number),
    title: `[VMware] ${title} - ${VCENTER_NAME}`,
    alertNumber: 110 + number,
    alertNumberWithPrefix: `ALT-${110 + number}`,
    createdAt: new Date(LOADED_AT - minutesAgo * MINUTE),
    seriesLabels: labels,
    alertSeverity: warningAlert,
    currentAlertState: alertStates[0],
    currentAlertStateId: alertStates[0]._id,
    vmwareVCenterIds: [VCENTER_ID],
  };
}

const HOST_LABEL = "resource.vcenter.host.name";
const VM_LABEL = "resource.vcenter.vm.name";
const DATASTORE_LABEL = "resource.vcenter.datastore.name";
const CLUSTER_LABEL = "resource.vcenter.cluster.name";

const incidents = [];
const alerts = [];
if (OPEN !== "0" && (ESTATE === "busy" || ESTATE === "large")) {
  if (ESTATE === "large") {
    incidents.push(
      openIncident(
        1,
        "Host Not Responding",
        { [HOST_LABEL]: "esx-fra-27.acme.example" },
        24,
      ),
    );
  } else {
    incidents.push(
      openIncident(
        1,
        "Host Not Responding",
        { [HOST_LABEL]: "esx03.acme.example" },
        24,
      ),
    );
    alerts.push(
      openAlert(1, "VM Memory Swapping", { [VM_LABEL]: "db-primary" }, 40),
    );
  }
  if (OPEN === "many" && ESTATE === "busy") {
    alerts.push(
      openAlert(
        2,
        "Datastore Capacity Critical (>90%)",
        { [DATASTORE_LABEL]: "ds-prod-01" },
        300,
      ),
      openAlert(
        3,
        "Host CPU Saturation (>90%)",
        { [HOST_LABEL]: "esx02.acme.example" },
        90,
      ),
      openAlert(
        4,
        "VM CPU Ready Contention (>10%)",
        { [VM_LABEL]: "ci-runner-01" },
        23,
      ),
      openAlert(
        5,
        "Cluster Host Not Effective",
        { [CLUSTER_LABEL]: "dev-cluster" },
        180,
      ),
      openAlert(6, "VM Memory Ballooning", { [VM_LABEL]: "app-03" }, 22),
    );
  }
}

/*
 * ---------------------------------------------------------------------------
 * Monitors the vCenter already has, for the alert cards and Recommendations:
 * each built from the recommendation's own step, exactly what Create on the
 * Recommendations page would have saved.
 * ---------------------------------------------------------------------------
 */
const vmwareRecommendations = MonitorRecommendationCatalog.getRecommendations(
  MonitorRecommendationResourceType.VMware,
);
const placeholderId = ObjectID.getZeroObjectID();

function monitorFor(recommendation, number) {
  const step = recommendation.getMonitorStep({
    resourceIdentifier: VCENTER_NAME,
    onlineMonitorStatusId: placeholderId,
    offlineMonitorStatusId: placeholderId,
    defaultIncidentSeverityId: placeholderId,
    defaultAlertSeverityId: placeholderId,
    monitorName: VCENTER_NAME,
  });
  const steps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: placeholderId,
  };
  return {
    _id: uuid("58000000", number),
    name: `${VCENTER_NAME} - ${recommendation.name}`,
    monitorType: recommendation.monitorType || MonitorType.VMware,
    monitorSteps: steps,
  };
}

const COVERED_TEMPLATE_IDS =
  ALERTS === "some"
    ? ["vmware-host-not-responding", "vmware-host-cpu-saturation"]
    : ALERTS === "all"
      ? vmwareRecommendations.map((recommendation) => {
          return recommendation.templateId;
        })
      : [];
const monitors = vmwareRecommendations
  .filter((recommendation) => {
    return COVERED_TEMPLATE_IDS.includes(recommendation.templateId);
  })
  .map((recommendation, index) => {
    return monitorFor(recommendation, index + 1);
  });

/*
 * ---------------------------------------------------------------------------
 * Recorder
 * ---------------------------------------------------------------------------
 */
const fixture = {
  scenario: {
    estate: ESTATE,
    collector: COLLECTOR,
    alerts: ALERTS,
    open: OPEN,
    fail: FAIL,
    language: LANGUAGE,
  },
  loadedAt: LOADED_AT,
  listRequests: [],
  countRequests: [],
  itemRequests: [],
  aggregateRequests: [],
  apiRequests: [],
  unhandled: [],
};
window.__vmwarePagesFixture = fixture;

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

// A number or a date the way the server compares them.
function comparable(value) {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Date(value).getTime();
  }
  return typeof value === "number" ? value : Number(value);
}

function compares(record, field, operator) {
  const wanted = comparable(operator.value);
  const raw = record[field];
  if (raw === undefined || raw === null) {
    return false;
  }
  const actual = comparable(raw);
  if (!Number.isFinite(actual) || !Number.isFinite(wanted)) {
    return false;
  }
  if (operator instanceof GreaterThan) {
    return actual > wanted;
  }
  if (operator instanceof GreaterThanOrEqual) {
    return actual >= wanted;
  }
  if (operator instanceof LessThan) {
    return actual < wanted;
  }
  return actual <= wanted;
}

/*
 * A query's plain values, its Includes and its comparisons must match, as
 * the server would compare them. A relation filter (`vmwareVCenters:
 * Includes([id])`) reads the record's `<relation>Ids`. An operator the
 * fixture does not know is recorded as unhandled, never silently passed.
 */
const TRAILING_S = /s$/;

function matches(record, query, modelName) {
  for (const [field, wanted] of Object.entries(query || {})) {
    if (field === "projectId") {
      continue;
    }
    if (wanted instanceof Includes) {
      const allowed = new Set(
        wanted.values.map((entry) => {
          return String(plain(entry));
        }),
      );
      const relationIds = record[`${field.replace(TRAILING_S, "")}Ids`];
      if (Array.isArray(relationIds)) {
        if (
          !relationIds.some((id) => {
            return allowed.has(String(id));
          })
        ) {
          return false;
        }
        continue;
      }
      if (!allowed.has(String(plain(record[field])))) {
        return false;
      }
      continue;
    }
    if (
      wanted instanceof GreaterThan ||
      wanted instanceof GreaterThanOrEqual ||
      wanted instanceof LessThan ||
      wanted instanceof LessThanOrEqual
    ) {
      if (!compares(record, field, wanted)) {
        return false;
      }
      continue;
    }
    const value = plain(wanted);
    if (
      typeof value !== "string" &&
      typeof value !== "boolean" &&
      typeof value !== "number"
    ) {
      fixture.unhandled.push({
        kind: "query",
        modelName,
        field,
        value: serialize(value),
      });
      continue;
    }
    if (String(record[field] ?? "") !== String(value)) {
      return false;
    }
  }
  return true;
}

const store = {
  VMwareVCenter: [estate.vcenter],
  VMwareResource: estate.inventory,
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
  MonitorStatus: [
    {
      _id: uuid("55000000", 1),
      name: "Operational",
      isOperationalState: true,
      isOfflineState: false,
      priority: 1,
    },
    {
      _id: uuid("55000000", 2),
      name: "Offline",
      isOperationalState: false,
      isOfflineState: true,
      priority: 2,
    },
  ],
  IncidentSeverity: [criticalIncident],
  AlertSeverity: [warningAlert],
  OnCallDutyPolicy: [],
  Label: [],
  TelemetryIngestionKey: [
    {
      _id: uuid("59000000", 1),
      name: "VMware agent",
      secretKey: uuid("5a000000", 1),
      // A server key: the setup guide lists only those.
      keyType: "Server",
      description: "",
    },
  ],
  /*
   * What a part's Logs and Metrics tabs look up to name what they show:
   * this project has none of them.
   */
  LogSavedView: [],
  Service: [],
  Host: [],
  DockerHost: [],
  PodmanHost: [],
  KubernetesCluster: [],
  MetricType: [],
};

for (const name of ARCHIVABLE_VALUE_TABLE_NAMES) {
  for (const record of store[name] || []) {
    if (record.isArchived === undefined) {
      record.isArchived = false;
    }
  }
}

// In the order the server sorts them: by each sort field, in turn.
function sortRecords(records, sort) {
  const fields = Object.entries(sort || {});
  return [...records].sort((left, right) => {
    for (const [field, order] of fields) {
      const a = left[field] ?? "";
      const b = right[field] ?? "";
      if (a !== b) {
        const ascending =
          typeof a === "number" && typeof b === "number"
            ? a - b
            : String(a) < String(b)
              ? -1
              : 1;
        return String(order).toLowerCase().startsWith("desc")
          ? -ascending
          : ascending;
      }
    }
    return 0;
  });
}

function rows(modelType, query, sort) {
  const name = tableName(modelType);
  if (!store[name]) {
    return null;
  }
  return sortRecords(
    store[name].filter((record) => {
      return matches(record, query, name);
    }),
    sort,
  ).map((record) => {
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

const SERVER_ERROR = "Something went wrong on the server. Please try again.";

function failsInventory(modelName) {
  return FAIL === "inventory" && modelName === "VMwareResource";
}

function failsEvents(modelName) {
  return (
    FAIL === "events" && (modelName === "Incident" || modelName === "Alert")
  );
}

ModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.listRequests.push({
    modelName,
    query: serialize(options.query),
    select: serialize(options.select),
    sort: serialize(options.sort),
    limit: options.limit,
  });

  if (modelName === "Monitor" && ALERTS === "denied") {
    throw new Error("You do not have permission to read monitors.");
  }
  if (failsInventory(modelName) || failsEvents(modelName)) {
    throw new Error(SERVER_ERROR);
  }

  const data = rows(options.modelType, options.query, options.sort);
  if (!data) {
    fixture.unhandled.push({ kind: "getList", modelName });
    return { data: [], count: 0, skip: 0, limit: 0 };
  }
  const skip = options.skip || 0;
  const limit = options.limit || 10;
  return {
    data: data.slice(skip, skip + limit),
    count: data.length,
    skip: skip,
    limit: limit,
  };
};

ModelAPI.count = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.countRequests.push({ modelName, query: serialize(options.query) });

  if (failsEvents(modelName)) {
    throw new Error(SERVER_ERROR);
  }

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

/*
 * ---------------------------------------------------------------------------
 * Metrics: the vcenter receiver's series for each part, around its latest
 * reading in the inventory, with the resource attributes the receiver
 * stamps on each object and the datapoint attributes it adds.
 * ---------------------------------------------------------------------------
 */
function wave(seed, step) {
  return (
    Math.sin((step + seed * 7) / 5) * 0.5 + Math.sin((step + seed) / 13) * 0.5
  );
}

function seedOf(text) {
  let seed = 0;
  for (const character of text) {
    seed = (seed * 31 + character.charCodeAt(0)) % 997;
  }
  return seed;
}

// The resource attributes of a part's series (resource.vcenter.*).
function resourceAttributes(record) {
  const attributes = {
    "resource.vmware.vcenter.name": VCENTER_NAME,
    "resource.vcenter.datacenter.name": record.datacenterName,
  };
  if (record.clusterName) {
    attributes["resource.vcenter.cluster.name"] = record.clusterName;
  }
  switch (record.kind) {
    case "Host":
      attributes["resource.vcenter.host.name"] = record.hostName;
      break;
    case "VirtualMachine":
      attributes["resource.vcenter.host.name"] = record.hostName;
      if (record.isTemplate) {
        attributes["resource.vcenter.vm_template.id"] = record.vmInstanceUuid;
        attributes["resource.vcenter.vm_template.name"] = record.name;
      } else {
        attributes["resource.vcenter.vm.id"] = record.vmInstanceUuid;
        attributes["resource.vcenter.vm.name"] = record.name;
      }
      break;
    case "Datastore":
      attributes["resource.vcenter.datastore.name"] = record.name;
      break;
    case "ResourcePool":
      attributes["resource.vcenter.resource_pool.inventory_path"] =
        record.resourcePoolPath;
      attributes["resource.vcenter.resource_pool.name"] = record.name;
      break;
    default:
      break;
  }
  return attributes;
}

function around(value, swing, spread) {
  return value === undefined || value === null ? null : value + swing * spread;
}

function percentAround(value, swing, spread) {
  const reading = around(value, swing, spread);
  return reading === null ? null : Math.max(0, Math.min(100, reading));
}

const HOST_NICS = ["vmnic0", "vmnic1"];
const HOST_DISKS = [
  "naa.600508b1001c4d41ad6b8b6d9c2a0f17",
  "t10.NVMe____Dell_Ent_NVMe_v2_AGN_RI_U.2_1.92TB",
];
const DIRECTIONS = ["received", "transmitted"];
const DISK_DIRECTIONS = ["read", "write"];

/*
 * Each metric: the kind of part it is about and, for one part, its series
 * as [datapoint attributes, value at step] pairs. A value of null is a step
 * the receiver sent nothing for.
 */
const METRICS = {
  "vcenter.host.cpu.utilization": {
    kind: "Host",
    series: (record) => {
      return [
        [
          {},
          (swing) => {
            return percentAround(record.latestCpuPercent, swing, 4);
          },
        ],
      ];
    },
  },
  "vcenter.host.cpu.usage": {
    kind: "Host",
    series: (record) => {
      return [
        [
          {},
          (swing) => {
            return around(record.latestCpuMhz, swing, 900);
          },
        ],
      ];
    },
  },
  "vcenter.host.cpu.capacity": {
    kind: "Host",
    series: (record) => {
      return [
        [
          {},
          () => {
            return record.cpuCapacityMhz ?? null;
          },
        ],
      ];
    },
  },
  // MiB, as the receiver reports host memory.
  "vcenter.host.memory.usage": {
    kind: "Host",
    series: (record) => {
      return [
        [
          {},
          (swing) => {
            return record.latestMemoryBytes === undefined
              ? null
              : Math.max(0, (record.latestMemoryBytes / MIB) * (1 + swing * 0.01));
          },
        ],
      ];
    },
  },
  "vcenter.host.memory.capacity": {
    kind: "Host",
    series: (record) => {
      return [
        [
          {},
          () => {
            return record.maxMemoryBytes ? record.maxMemoryBytes / MIB : null;
          },
        ],
      ];
    },
  },
  "vcenter.host.memory.utilization": {
    kind: "Host",
    series: (record) => {
      return [
        [
          {},
          (swing) => {
            return percentAround(record.latestMemoryPercent, swing, 1);
          },
        ],
      ];
    },
  },
  "vcenter.host.network.throughput": {
    kind: "Host",
    series: (record) => {
      return hostDeviceSeries(record, HOST_NICS, DIRECTIONS, 9000);
    },
  },
  "vcenter.host.network.packet.rate": {
    kind: "Host",
    series: (record) => {
      return hostDeviceSeries(record, HOST_NICS, DIRECTIONS, 1200);
    },
  },
  "vcenter.host.network.packet.error.rate": {
    kind: "Host",
    series: (record) => {
      return hostDeviceSeries(record, HOST_NICS, DIRECTIONS, 0);
    },
  },
  "vcenter.host.network.packet.drop.rate": {
    kind: "Host",
    series: (record) => {
      return hostDeviceSeries(record, HOST_NICS, DIRECTIONS, 0);
    },
  },
  "vcenter.host.disk.throughput": {
    kind: "Host",
    series: (record) => {
      return hostDeviceSeries(record, HOST_DISKS, DISK_DIRECTIONS, 30000);
    },
  },
  "vcenter.host.disk.latency.avg": {
    kind: "Host",
    series: (record) => {
      return hostDeviceSeries(record, HOST_DISKS, DISK_DIRECTIONS, 6);
    },
  },
  "vcenter.host.disk.latency.max": {
    kind: "Host",
    series: (record) => {
      return isConnectedHost(record)
        ? [
            [
              {},
              (swing) => {
                return 18 + swing * 6;
              },
            ],
          ]
        : [];
    },
  },
  "vcenter.vm.cpu.utilization": {
    kind: "VirtualMachine",
    series: (record) => {
      return vmSeries(record, (swing) => {
        return percentAround(record.latestCpuPercent, swing, 5);
      });
    },
  },
  "vcenter.vm.cpu.usage": {
    kind: "VirtualMachine",
    series: (record) => {
      return vmSeries(record, (swing) => {
        return around(record.latestCpuMhz, swing, 120);
      });
    },
  },
  "vcenter.vm.cpu.readiness": {
    kind: "VirtualMachine",
    series: (record) => {
      return vmPerformanceSeries(record, (swing) => {
        return record.cpuReadinessPercent === undefined
          ? null
          : Math.max(0, record.cpuReadinessPercent + swing * 0.8);
      });
    },
  },
  // MiB, as the receiver reports VM memory.
  "vcenter.vm.memory.usage": {
    kind: "VirtualMachine",
    series: (record) => {
      return vmSeries(record, (swing) => {
        return record.latestMemoryBytes === undefined
          ? null
          : (record.latestMemoryBytes / MIB) * (1 + swing * 0.02);
      });
    },
  },
  "vcenter.vm.memory.utilization": {
    kind: "VirtualMachine",
    series: (record) => {
      return vmSeries(record, (swing) => {
        return percentAround(record.latestMemoryPercent, swing, 1.5);
      });
    },
  },
  "vcenter.vm.memory.ballooned": {
    kind: "VirtualMachine",
    series: (record) => {
      return vmSeries(record, () => {
        return (record.memoryBalloonedBytes || 0) / MIB;
      });
    },
  },
  "vcenter.vm.memory.swapped": {
    kind: "VirtualMachine",
    series: (record) => {
      return vmSeries(record, () => {
        return (record.memorySwappedBytes || 0) / MIB;
      });
    },
  },
  "vcenter.vm.disk.usage": {
    kind: "VirtualMachine",
    series: (record) => {
      return diskUsageSeries(record);
    },
  },
  "vcenter.vm.disk.utilization": {
    kind: "VirtualMachine",
    series: (record) => {
      return [
        [
          {},
          () => {
            return record.latestDiskPercent ?? null;
          },
        ],
      ];
    },
  },
  "vcenter.vm.network.throughput": {
    kind: "VirtualMachine",
    series: (record) => {
      if (!isOnConnectedHost(record)) {
        return [];
      }
      return DIRECTIONS.map((direction, index) => {
        return [
          { direction },
          (swing) => {
            return record.isPoweredOn
              ? 1800 / (index + 1) + swing * 400
              : null;
          },
        ];
      });
    },
  },
  "vcenter.vm.disk.throughput": {
    kind: "VirtualMachine",
    series: (record) => {
      if (!isOnConnectedHost(record)) {
        return [];
      }
      return DISK_DIRECTIONS.map((direction, index) => {
        return [
          { direction },
          (swing) => {
            return record.isPoweredOn
              ? 2400 / (index + 1) + swing * 600
              : null;
          },
        ];
      });
    },
  },
  "vcenter.vm.disk.latency.max": {
    kind: "VirtualMachine",
    series: (record) => {
      return vmPerformanceSeries(record, (swing) => {
        return 6 + swing * 3;
      });
    },
  },
  "vcenter.datastore.disk.usage": {
    kind: "Datastore",
    series: (record) => {
      return diskUsageSeries(record);
    },
  },
  "vcenter.datastore.disk.utilization": {
    kind: "Datastore",
    series: (record) => {
      return [
        [
          {},
          (swing, step, steps) => {
            return record.latestDiskPercent === undefined
              ? null
              : record.latestDiskPercent - (steps - step) * 0.004;
          },
        ],
      ];
    },
  },
  "vcenter.cluster.host.count": {
    kind: "Cluster",
    series: (record) => {
      return [
        [
          { effective: "true" },
          () => {
            return record.effectiveHostCount ?? null;
          },
        ],
        [
          { effective: "false" },
          () => {
            return record.hostCount === undefined
              ? null
              : record.hostCount - (record.effectiveHostCount || 0);
          },
        ],
      ];
    },
  },
  "vcenter.cluster.vm.count": {
    kind: "Cluster",
    series: (record) => {
      return [
        [
          { power_state: "on" },
          () => {
            return record.poweredOnVmCount ?? null;
          },
        ],
        [
          { power_state: "off" },
          () => {
            return record.vmCount === undefined
              ? null
              : record.vmCount - (record.poweredOnVmCount || 0);
          },
        ],
      ];
    },
  },
  "vcenter.cluster.cpu.effective": {
    kind: "Cluster",
    series: (record) => {
      return [
        [
          {},
          () => {
            return record.cpuEffectiveMhz ?? null;
          },
        ],
      ];
    },
  },
  "vcenter.cluster.cpu.limit": {
    kind: "Cluster",
    series: (record) => {
      return [
        [
          {},
          () => {
            return record.cpuCapacityMhz ?? null;
          },
        ],
      ];
    },
  },
  "vcenter.cluster.memory.effective": {
    kind: "Cluster",
    series: (record) => {
      return [
        [
          {},
          () => {
            return record.memoryEffectiveBytes ?? null;
          },
        ],
      ];
    },
  },
  "vcenter.cluster.memory.limit": {
    kind: "Cluster",
    series: (record) => {
      return [
        [
          {},
          () => {
            return record.maxMemoryBytes ?? null;
          },
        ],
      ];
    },
  },
};

// No cluster here runs vSAN: these reads find no series.
const NO_SERIES = new Set([
  "vcenter.cluster.vsan.latency.avg",
  "vcenter.cluster.vsan.throughput",
  "vcenter.cluster.vsan.congestions",
  "vcenter.cluster.vsan.operations",
]);

function isConnectedHost(record) {
  return !(record.latestMemoryBytes === 0 && !record.latestCpuMhz);
}

/*
 * A host's per-device series, and its whole-host one (no `object`). They
 * come from vCenter's performance counters, which a host vCenter cannot
 * reach, or one that is off, has none of: the receiver sends nothing.
 */
function hostDeviceSeries(record, objects, directions, base) {
  if (!isConnectedHost(record)) {
    return [];
  }
  const out = [];
  for (const direction of directions) {
    out.push([
      { direction },
      (swing) => {
        return Math.max(0, base + swing * base * 0.3);
      },
    ]);
    objects.forEach((object, index) => {
      out.push([
        { object, direction },
        (swing) => {
          return Math.max(0, (base / (index + 1.5)) * (1 + swing * 0.3));
        },
      ]);
    });
  }
  return out;
}

// A powered-on VM's series; a powered-off VM or a template sends none.
function vmSeries(record, value) {
  if (record.isTemplate || !record.isPoweredOn) {
    return [];
  }
  return [[{}, value]];
}

// Whether the host a VM runs on is one vCenter reaches.
function isOnConnectedHost(record) {
  const host = estate.inventory.find((candidate) => {
    return (
      candidate.kind === "Host" &&
      candidate.hostName === record.hostName &&
      candidate.datacenterName === record.datacenterName
    );
  });
  return !host || isConnectedHost(host);
}

/*
 * A VM's series from vCenter's performance counters: none for a VM on a
 * host vCenter cannot reach (its quick stats still say 0).
 */
function vmPerformanceSeries(record, value) {
  return isOnConnectedHost(record) ? vmSeries(record, value) : [];
}

function diskUsageSeries(record) {
  if (record.latestDiskBytes === undefined || !record.maxDiskBytes) {
    return [];
  }
  return [
    [
      { disk_state: "used" },
      (swing, step, steps) => {
        // Slowly filling: the datastore page projects when it is full.
        return record.latestDiskBytes * (1 - (steps - step) * 0.00004);
      },
    ],
    [
      { disk_state: "available" },
      (swing, step, steps) => {
        return (
          record.maxDiskBytes -
          record.latestDiskBytes * (1 - (steps - step) * 0.00004)
        );
      },
    ],
  ];
}

function attributeMatches(attributes, wanted) {
  for (const [key, value] of Object.entries(wanted || {})) {
    if (attributes[key] === undefined) {
      return false;
    }
    if (String(attributes[key]) !== String(value)) {
      return false;
    }
  }
  return true;
}

function aggregateValues(values, aggregationType) {
  const type = String(aggregationType || "Avg").toLowerCase();
  if (type === "sum") {
    return values.reduce((sum, value) => {
      return sum + value;
    }, 0);
  }
  if (type === "max") {
    return Math.max(...values);
  }
  if (type === "min") {
    return Math.min(...values);
  }
  if (type === "count") {
    return values.length;
  }
  return (
    values.reduce((sum, value) => {
      return sum + value;
    }, 0) / values.length
  );
}

function generateRows(aggregateBy) {
  const query = aggregateBy.query || {};
  const metricName = query.name;
  if (NO_SERIES.has(metricName)) {
    return [];
  }
  const metric = METRICS[metricName];
  if (!metric) {
    return null;
  }

  const wanted = query.attributes || {};
  const start = new Date(
    aggregateBy.startTimestamp || LOADED_AT - 30 * MINUTE,
  ).getTime();
  const end = Math.min(
    new Date(aggregateBy.endTimestamp || LOADED_AT).getTime(),
    LOADED_AT,
  );
  const spanMinutes = Math.max(1, Math.round((end - start) / MINUTE));
  // Per minute up to three hours, as the analytics server buckets.
  const stepMinutes = spanMinutes <= 180 ? 1 : Math.ceil(spanMinutes / 120);
  const steps = Math.floor(spanMinutes / stepMinutes);

  const groupKeys = aggregateBy.groupByAttributeKeys || [];
  const groupedByAttributes = Boolean(aggregateBy.groupBy?.attributes);

  // bucket time -> group key -> { attributes, values }
  const buckets = new Map();

  for (const record of estate.inventory) {
    if (record.kind !== metric.kind) {
      continue;
    }
    const lastMetricsAt = record.metricsUpdatedAt
      ? new Date(record.metricsUpdatedAt).getTime()
      : 0;
    const resource = resourceAttributes(record);
    const seed = seedOf(record.externalId);

    for (const [datapoint, valueAt] of metric.series(record)) {
      const attributes = { ...resource, ...datapoint };
      if (!attributeMatches(attributes, wanted)) {
        continue;
      }
      for (let index = 0; index <= steps; index++) {
        const time =
          Math.floor((start + index * stepMinutes * MINUTE) / MINUTE) * MINUTE;
        if (time > lastMetricsAt + MINUTE || time > end) {
          continue;
        }
        const value = valueAt(wave(seed, index), index, steps);
        if (value === null || value === undefined || !Number.isFinite(value)) {
          continue;
        }
        let groupAttributes = null;
        if (groupedByAttributes) {
          groupAttributes = attributes;
        } else if (groupKeys.length > 0) {
          groupAttributes = {};
          for (const key of groupKeys) {
            if (attributes[key] !== undefined) {
              groupAttributes[key] = attributes[key];
            }
          }
        }
        const groupKey = groupAttributes ? JSON.stringify(groupAttributes) : "";
        let groups = buckets.get(time);
        if (!groups) {
          groups = new Map();
          buckets.set(time, groups);
        }
        let group = groups.get(groupKey);
        if (!group) {
          group = { attributes: groupAttributes, values: [] };
          groups.set(groupKey, group);
        }
        group.values.push(value);
      }
    }
  }

  const out = [];
  for (const [time, groups] of buckets.entries()) {
    for (const group of groups.values()) {
      out.push({
        timestamp: new Date(time).toISOString(),
        value: aggregateValues(group.values, aggregateBy.aggregationType),
        ...(group.attributes ? { attributes: group.attributes } : {}),
      });
    }
  }
  return out.sort((left, right) => {
    return left.timestamp < right.timestamp ? 1 : -1;
  });
}

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

  if (FAIL === "metrics") {
    throw new Error(SERVER_ERROR);
  }

  const data = modelName.startsWith("Metric")
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
   * No host sent syslog; no change events mark the charts, and their
   * exemplar dots find no spans.
   */
  if (
    modelName.startsWith("Log") ||
    modelName.startsWith("ChangeEvent") ||
    modelName.startsWith("Metric") ||
    modelName.startsWith("Span")
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

// What POST /vmware-resource/inventory-summary/:id counts in Postgres.
function inventorySummary() {
  const ofKind = (kind) => {
    return estate.inventory.filter((record) => {
      return record.kind === kind;
    });
  };
  const virtualMachines = ofKind("VirtualMachine").filter((record) => {
    return record.isTemplate !== true;
  });
  return {
    datacenterCount: ofKind("Datacenter").length,
    clusterCount: ofKind("Cluster").length,
    hostCount: ofKind("Host").length,
    virtualMachineCount: virtualMachines.length,
    poweredOnVirtualMachineCount: virtualMachines.filter((record) => {
      return record.isPoweredOn === true;
    }).length,
    virtualMachineTemplateCount: ofKind("VirtualMachine").filter((record) => {
      return record.isTemplate === true;
    }).length,
    datastoreCount: ofKind("Datastore").length,
    resourcePoolCount: ofKind("ResourcePool").length,
  };
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

  // The side menu's badges and the Overview's count chips.
  if (
    method === "POST" &&
    parsed.pathname.includes("/vmware-resource/inventory-summary/")
  ) {
    if (FAIL === "inventory") {
      return new HTTPErrorResponse(500, { message: SERVER_ERROR }, {});
    }
    return ok(inventorySummary());
  }

  // The AI agent card: the vCenter has no AI agent yet.
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

  // A part's Metrics tab: the metric catalog it reads.
  if (
    method === "POST" &&
    parsed.pathname.endsWith("/telemetry/metrics/get-attributes")
  ) {
    return ok({
      attributes: [
        "resource.vmware.vcenter.name",
        "resource.vcenter.datacenter.name",
        "resource.vcenter.host.name",
        "resource.vcenter.vm.name",
      ],
    });
  }

  // A host's Logs tab, for a host that sent no syslog.
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
    fa: { translation: fa },
  },
  interpolation: { escapeValue: false },
});
followLanguageForDates(i18next);
// <html lang> and <html dir> follow the language, as the Dashboard's do.
followLanguageForPage(i18next);

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

const PAGES = [
  [PageMap.VMWARE_VCENTER_VIEW, VCenterOverview],
  [PageMap.VMWARE_VCENTER_VIEW_HOSTS, VCenterHosts],
  [PageMap.VMWARE_VCENTER_VIEW_HOST_DETAIL, VCenterHostDetail],
  [PageMap.VMWARE_VCENTER_VIEW_VIRTUAL_MACHINES, VCenterVirtualMachines],
  [
    PageMap.VMWARE_VCENTER_VIEW_VIRTUAL_MACHINE_DETAIL,
    VCenterVirtualMachineDetail,
  ],
  [PageMap.VMWARE_VCENTER_VIEW_DATASTORES, VCenterDatastores],
  [PageMap.VMWARE_VCENTER_VIEW_DATASTORE_DETAIL, VCenterDatastoreDetail],
  [PageMap.VMWARE_VCENTER_VIEW_CLUSTERS, VCenterClusters],
  [PageMap.VMWARE_VCENTER_VIEW_CLUSTER_DETAIL, VCenterClusterDetail],
  [PageMap.VMWARE_VCENTER_VIEW_RESOURCE_POOLS, VCenterResourcePools],
  [PageMap.VMWARE_VCENTER_VIEW_RECOMMENDATIONS, VCenterRecommendations],
].map(([pageKey, Component]) => {
  return {
    path: RouteMap[pageKey].toString(),
    Page: withNavigation(Component, pageKey),
  };
});

const FixtureLayout = withNavigation(VCenterLayout, PageMap.VMWARE_VCENTER_VIEW);

// A page the views link to that is not modelled: says where it is.
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
        <Route element={<FixtureLayout />}>
          {PAGES.map((page) => {
            return (
              <Route key={page.path} path={page.path} element={<page.Page />} />
            );
          })}
        </Route>
        <Route path="*" element={<StubPage />} />
      </Routes>
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <FixtureApp />
  </BrowserRouter>,
);

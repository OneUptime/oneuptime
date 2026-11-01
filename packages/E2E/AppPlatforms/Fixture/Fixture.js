/*
 * Offline fixture for App Platforms, the product the apps on managed app and
 * container platforms moved to out of Cloud: the REAL App Platforms route
 * group (Routes/AppPlatformsRoutes - its layout, side menus, Overview, All
 * Environments, an environment's pages, its rules and Archived) and Cloud's
 * REAL resource view layout, under their real RouteMap patterns, as App.tsx
 * mounts them. Only the data boundary (ModelAPI, AnalyticsModelAPI, API,
 * Realtime) and the signed-in user are replaced. Every record is fabricated
 * for an "Acme Apps" workspace.
 *
 * Scenarios are picked with query parameters, parsed once at load:
 *
 *   ?state=   (default: six environments on four platforms, two of them
 *             quiet) | empty (no environment yet)
 *   ?lang=    de | fa (Persian, laid out right to left, as production does)
 *   ?theme=   dark adds html.dark (handled by server.js)
 *
 * Every read is recorded on window.__appPlatformsFixture: listRequests,
 * countRequests, itemRequests, apiRequests and unhandled - anything the
 * fixture does not model. The spec asserts `unhandled` is empty.
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
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import FA from "../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import AppPlatformsRoutes from "../../../App/FeatureSet/Dashboard/src/Routes/AppPlatformsRoutes";
import CloudResourceViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/Layout";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import EqualToOrNull from "Common/Types/BaseDatabase/EqualToOrNull";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotNull from "Common/Types/BaseDatabase/NotNull";
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
import { setPageLanguage } from "Common/UI/Utils/PageLanguage";
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";

/*
 * ---------------------------------------------------------------------------
 * Scenario switches
 * ---------------------------------------------------------------------------
 */
const params = new URLSearchParams(window.location.search);
const EMPTY = params.get("state") === "empty";
// Every environment connected: the strip breaks them down by provider.
const ALL_CONNECTED = params.get("state") === "connected";
const LANGUAGE = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

await i18next.use(initReactI18next).init({
  lng: LANGUAGE,
  fallbackLng: LANGUAGE,
  resources: {
    en: { translation: {} },
    de: { translation: DE },
    fa: { translation: FA },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
// Persian reads right to left, as production's followLanguageForPage sets it.
setPageLanguage(LANGUAGE);
// Dates in the reader's language ("vor 3 Stunden"), as Utils/i18n.ts sets them.
followLanguageForDates(i18next);

/*
 * ---------------------------------------------------------------------------
 * The workspace
 * ---------------------------------------------------------------------------
 */
const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const LOADED_AT = Date.now();

function uuid(prefix, number) {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Apps",
});

ProjectUtil.getCurrentProjectId = () => {
  return new ObjectID(PROJECT_ID);
};
ProjectUtil.getCurrentProject = () => {
  return project;
};
UserUtil.getUserId = () => {
  return new ObjectID("10000000-0000-4000-8000-000000000002");
};
UserUtil.isMasterAdmin = () => {
  return false;
};
UserUtil.isLoggedIn = () => {
  return true;
};

const GRANTED = [Permission.ProjectOwner];

PermissionUtil.getAllPermissions = () => {
  return GRANTED;
};
PermissionUtil.getProjectPermissions = () => {
  return {
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: GRANTED.map((permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };
};
PermissionUtil.getGlobalPermissions = () => {
  return null;
};

/*
 * Six environments on four platforms - two of them quiet, the oldest
 * first on its platform's card - and one resource of a cloud account, which
 * is Cloud's and never listed here.
 */
function environment(number, fields) {
  return {
    _id: uuid("71000000", number),
    projectId: PROJECT_ID,
    cloudResourceKind: "environment",
    isArchived: false,
    createdAt: new Date(LOADED_AT - 30 * 24 * HOUR),
    ...fields,
  };
}

const ENVIRONMENTS = EMPTY
  ? []
  : [
      environment(1, {
        name: "checkout · us-east-1 · 4109-2277-8841",
        cloudPlatform: "aws_ecs",
        cloudProvider: "aws",
        cloudAccountId: "4109-2277-8841",
        cloudRegion: "us-east-1",
        resourceIdentifier: "aws_ecs|4109-2277-8841|us-east-1",
        otelCollectorStatus: "connected",
        lastSeenAt: new Date(LOADED_AT - MINUTE),
      }),
      environment(2, {
        name: "billing · eu-west-1 · 4109-2277-8841",
        cloudPlatform: "aws_ecs",
        cloudProvider: "aws",
        cloudAccountId: "4109-2277-8841",
        cloudRegion: "eu-west-1",
        resourceIdentifier: "aws_ecs|4109-2277-8841|eu-west-1",
        otelCollectorStatus: "disconnected",
        lastSeenAt: new Date(LOADED_AT - 3 * HOUR),
      }),
      environment(3, {
        name: "api · europe-west1 · acme-prod",
        cloudPlatform: "gcp_cloud_run",
        cloudProvider: "gcp",
        cloudAccountId: "acme-prod",
        cloudRegion: "europe-west1",
        resourceIdentifier: "gcp_cloud_run|acme-prod|europe-west1",
        otelCollectorStatus: "connected",
        lastSeenAt: new Date(LOADED_AT - MINUTE),
      }),
      environment(4, {
        name: "worker · us-central1 · acme-prod",
        cloudPlatform: "gcp_cloud_run",
        cloudProvider: "gcp",
        cloudAccountId: "acme-prod",
        cloudRegion: "us-central1",
        resourceIdentifier: "gcp_cloud_run|acme-prod|us-central1",
        otelCollectorStatus: "connected",
        lastSeenAt: new Date(LOADED_AT - 2 * MINUTE),
      }),
      environment(5, {
        name: "reports · westeurope · core-prod-sub",
        cloudPlatform: "azure_container_apps",
        cloudProvider: "azure",
        cloudAccountId: "core-prod-sub",
        cloudRegion: "westeurope",
        resourceIdentifier: "azure_container_apps|core-prod-sub|westeurope",
        otelCollectorStatus: "connected",
        lastSeenAt: new Date(LOADED_AT - MINUTE),
      }),
      environment(6, {
        name: "web · eastus · core-prod-sub",
        cloudPlatform: "azure_app_service",
        cloudProvider: "azure",
        cloudAccountId: "core-prod-sub",
        cloudRegion: "eastus",
        resourceIdentifier: "azure_app_service|core-prod-sub|eastus",
        otelCollectorStatus: "disconnected",
        lastSeenAt: null,
      }),
    ];

if (ALL_CONNECTED) {
  for (const row of ENVIRONMENTS) {
    row.otelCollectorStatus = "connected";
    row.lastSeenAt = new Date(LOADED_AT - MINUTE);
  }
}

const RESOURCE = {
  _id: uuid("72000000", 1),
  projectId: PROJECT_ID,
  name: "vm-prod-01",
  cloudResourceKind: "resource",
  cloudProvider: "azure",
  cloudResourceType: "Microsoft.Compute/virtualMachines",
  isArchived: false,
};

/*
 * The apps the environments run, as ingest names them: in checkout (ECS),
 * checkout-api deployed 25 minutes ago - revision 43 replaced 42, one task
 * still draining on 42 - and inventory, quiet for two hours; billing's one
 * app quiet with its environment; on Cloud Run, api (deployed an hour ago,
 * erroring at 6.2%) and worker; reports on Container Apps, rolled back 40
 * minutes ago from v12abc (deployed two days ago) to v11def. The App Service
 * environment that never reported has none.
 */
const ECS_CLUSTER = "arn:aws:ecs:us-east-1:4109-2277-8841:cluster/production";

function app(number, environmentNumber, fields) {
  return {
    _id: uuid("75000000", number),
    projectId: PROJECT_ID,
    cloudResourceId: uuid("71000000", environmentNumber),
    createdAt: new Date(LOADED_AT - 10 * 24 * HOUR),
    ...fields,
  };
}

const APPS = EMPTY
  ? []
  : [
      app(1, 1, {
        name: "checkout-api",
        appKey: "checkout-api-production",
        groupName: "production",
        cloudPlatform: "aws_ecs",
        telemetryAttributes: {
          "aws.ecs.task.family": "checkout-api",
          "aws.ecs.cluster.arn": ECS_CLUSTER,
        },
        serviceName: "checkout-api",
        image:
          "4109-2277-8841.dkr.ecr.us-east-1.amazonaws.com/checkout-api:2.4.1",
        revisionAttribute: "aws.ecs.task.revision",
        currentRevision: "43",
        currentRevisionSince: new Date(LOADED_AT - 25 * MINUTE),
        previousRevision: "42",
        lastSeenAt: new Date(LOADED_AT - MINUTE),
      }),
      app(2, 1, {
        name: "inventory",
        appKey: "inventory-production",
        groupName: "production",
        cloudPlatform: "aws_ecs",
        telemetryAttributes: {
          "aws.ecs.task.family": "inventory",
          "aws.ecs.cluster.arn": ECS_CLUSTER,
        },
        serviceName: "inventory",
        revisionAttribute: "aws.ecs.task.revision",
        currentRevision: "8",
        currentRevisionSince: new Date(LOADED_AT - 6 * 24 * HOUR),
        lastSeenAt: new Date(LOADED_AT - 2 * HOUR),
      }),
      app(3, 2, {
        name: "billing-api",
        appKey: "billing-api",
        cloudPlatform: "aws_ecs",
        telemetryAttributes: { "aws.ecs.task.family": "billing-api" },
        revisionAttribute: "aws.ecs.task.revision",
        currentRevision: "12",
        currentRevisionSince: new Date(LOADED_AT - 9 * 24 * HOUR),
        lastSeenAt: new Date(LOADED_AT - 3 * HOUR),
      }),
      app(4, 3, {
        name: "api",
        appKey: "api",
        cloudPlatform: "gcp_cloud_run",
        telemetryAttributes: { "faas.name": "api" },
        serviceName: "api",
        revisionAttribute: "faas.version",
        currentRevision: "api-00042-xyz",
        currentRevisionSince: new Date(LOADED_AT - HOUR),
        previousRevision: "api-00041-abc",
        lastSeenAt: new Date(LOADED_AT - MINUTE),
      }),
      app(5, 4, {
        name: "worker",
        appKey: "worker",
        cloudPlatform: "gcp_cloud_run",
        telemetryAttributes: { "faas.name": "worker" },
        revisionAttribute: "faas.version",
        currentRevision: "worker-00007-k2j",
        currentRevisionSince: new Date(LOADED_AT - 4 * 24 * HOUR),
        lastSeenAt: new Date(LOADED_AT - 2 * MINUTE),
      }),
      app(6, 5, {
        name: "reports",
        appKey: "reports",
        cloudPlatform: "azure_container_apps",
        telemetryAttributes: { "service.name": "reports" },
        serviceName: "reports",
        revisionAttribute: "service.version",
        currentRevision: "reports--v11def",
        currentRevisionSince: new Date(LOADED_AT - 40 * MINUTE),
        previousRevision: "reports--v12abc",
        lastSeenAt: new Date(LOADED_AT - MINUTE),
      }),
    ];

// Their revisions: each app's first is its baseline, the rest are deploys.
function revision(number, appNumber, environmentNumber, fields) {
  return {
    _id: uuid("76000000", number),
    projectId: PROJECT_ID,
    cloudAppId: uuid("75000000", appNumber),
    cloudResourceId: uuid("71000000", environmentNumber),
    cloudApp: Object.assign(
      {},
      APPS.find((row) => {
        return row._id === uuid("75000000", appNumber);
      }) || {},
    ),
    ...fields,
  };
}

const REVISIONS = EMPTY
  ? []
  : [
      revision(1, 1, 1, {
        revision: "41",
        firstSeenAt: new Date(LOADED_AT - 10 * 24 * HOUR),
        lastSeenAt: new Date(LOADED_AT - 3 * 24 * HOUR),
      }),
      revision(2, 1, 1, {
        revision: "42",
        previousRevision: "41",
        firstSeenAt: new Date(LOADED_AT - 3 * 24 * HOUR),
        lastSeenAt: new Date(LOADED_AT - 2 * MINUTE),
      }),
      revision(3, 1, 1, {
        revision: "43",
        previousRevision: "42",
        firstSeenAt: new Date(LOADED_AT - 25 * MINUTE),
        lastSeenAt: new Date(LOADED_AT - MINUTE),
      }),
      revision(4, 2, 1, {
        revision: "8",
        firstSeenAt: new Date(LOADED_AT - 6 * 24 * HOUR),
        lastSeenAt: new Date(LOADED_AT - 2 * HOUR),
      }),
      revision(5, 3, 2, {
        revision: "12",
        firstSeenAt: new Date(LOADED_AT - 9 * 24 * HOUR),
        lastSeenAt: new Date(LOADED_AT - 3 * HOUR),
      }),
      revision(6, 4, 3, {
        revision: "api-00041-abc",
        firstSeenAt: new Date(LOADED_AT - 5 * 24 * HOUR),
        lastSeenAt: new Date(LOADED_AT - 50 * MINUTE),
      }),
      revision(7, 4, 3, {
        revision: "api-00042-xyz",
        previousRevision: "api-00041-abc",
        firstSeenAt: new Date(LOADED_AT - HOUR),
        lastSeenAt: new Date(LOADED_AT - MINUTE),
      }),
      revision(8, 5, 4, {
        revision: "worker-00007-k2j",
        firstSeenAt: new Date(LOADED_AT - 4 * 24 * HOUR),
        lastSeenAt: new Date(LOADED_AT - 2 * MINUTE),
      }),
      // reports went back to v11def when v12abc stopped, 40 minutes ago.
      revision(9, 6, 5, {
        revision: "reports--v11def",
        firstSeenAt: new Date(LOADED_AT - 5 * 24 * HOUR),
        lastSeenAt: new Date(LOADED_AT - MINUTE),
      }),
      revision(10, 6, 5, {
        revision: "reports--v12abc",
        previousRevision: "reports--v11def",
        firstSeenAt: new Date(LOADED_AT - 2 * 24 * HOUR),
        lastSeenAt: new Date(LOADED_AT - 40 * MINUTE),
      }),
    ];

/*
 * The checkout environment's running tasks: CPU 30%, 36% and 42%, 1.5 GiB in
 * all - checkout-api's, two on revision 43 and one still on 42.
 */
const INSTANCES = EMPTY
  ? []
  : [1, 2, 3].map((number) => {
      return {
        _id: uuid("73000000", number),
        projectId: PROJECT_ID,
        cloudResourceId: uuid("71000000", 1),
        cloudAppId: uuid("75000000", 1),
        cloudApp: { _id: uuid("75000000", 1), name: "checkout-api" },
        revision: number === 3 ? "42" : "43",
        instanceName: `checkout/${number}a2b3c4d5e6f7`,
        lastSeenAt: new Date(LOADED_AT - number * MINUTE),
        latestCpuPercent: 24 + number * 6,
        latestMemoryBytes: 256 * 1024 * 1024 * number,
      };
    });

/*
 * The other running apps' instances: api's two on Cloud Run, worker's one,
 * reports' one replica. Counted on their apps, not on checkout.
 */
function instance(number, appNumber, environmentNumber, fields) {
  return {
    _id: uuid("73000000", number),
    projectId: PROJECT_ID,
    cloudResourceId: uuid("71000000", environmentNumber),
    cloudAppId: uuid("75000000", appNumber),
    lastSeenAt: new Date(LOADED_AT - MINUTE),
    ...fields,
  };
}

const OTHER_INSTANCES = EMPTY
  ? []
  : [
      instance(11, 4, 3, {
        instanceName: "00f1a2b3c4d5e6f7",
        revision: "api-00042-xyz",
      }),
      instance(12, 4, 3, {
        instanceName: "00f1a2b3c4d5e6f8",
        revision: "api-00042-xyz",
      }),
      instance(13, 5, 4, {
        instanceName: "00a9b8c7d6e5f4a3",
        revision: "worker-00007-k2j",
      }),
      instance(14, 6, 5, {
        instanceName: "reports--v11def-6d9f8-xk2lp",
        revision: "reports--v11def",
      }),
    ];

/*
 * Each app's requests, errors and p95 in the last hour, as the grouped trace
 * read answers them, and each of checkout-api's revisions'.
 */
const APP_SIGNALS = {
  [uuid("75000000", 1)]: { count: 1284, errorCount: 19, p95DurationMs: 122 },
  [uuid("75000000", 4)]: { count: 412, errorCount: 26, p95DurationMs: 340 },
  [uuid("75000000", 5)]: { count: 98, errorCount: 0, p95DurationMs: 45 },
  [uuid("75000000", 6)]: { count: 230, errorCount: 3, p95DurationMs: 88 },
};

const REVISION_SIGNALS = {
  43: { count: 820, errorCount: 18, p95DurationMs: 131 },
  42: { count: 464, errorCount: 1, p95DurationMs: 104 },
};

// One rule of each kind: App Platforms', Cloud's, and one for both.
function rule(number, fields) {
  return {
    _id: uuid("74000000", number),
    projectId: PROJECT_ID,
    isEnabled: true,
    createdAt: new Date(LOADED_AT - number * 24 * HOUR),
    ...fields,
  };
}

const OWNER_RULES = [
  rule(1, {
    name: "Payments team owns checkout",
    description: "Every checkout environment, wherever it runs.",
    cloudResourceKind: "environment",
    nameRegexPattern: "^checkout",
  }),
  rule(2, {
    name: "Platform team owns VMs",
    description: "Cloud's own: the virtual machines in our accounts.",
    cloudResourceKind: "resource",
  }),
  rule(3, {
    name: "Production owners",
    description: "Made before Cloud and App Platforms were split.",
    nameRegexPattern: "prod",
  }),
];

const LABEL_RULES = [
  rule(11, {
    name: "Label EU environments",
    description: "Environments in Europe get the region:eu label.",
    cloudResourceKind: "environment",
    nameRegexPattern: "europe|west",
  }),
  rule(12, {
    name: "Label every production row",
    description: "Made before Cloud and App Platforms were split.",
    nameRegexPattern: "prod",
  }),
];

// The service checkout-api's telemetry is under, in Services.
const SERVICES = EMPTY
  ? []
  : [{ _id: uuid("77000000", 1), projectId: PROJECT_ID, name: "checkout-api" }];

const TABLES = {
  CloudResource: [...ENVIRONMENTS, RESOURCE],
  Service: SERVICES,
  CloudResourceInstance: [...INSTANCES, ...OTHER_INSTANCES],
  CloudApp: APPS,
  CloudAppRevision: REVISIONS,
  CloudResourceOwnerRule: OWNER_RULES,
  CloudResourceLabelRule: LABEL_RULES,
};

/*
 * ---------------------------------------------------------------------------
 * The data boundary
 * ---------------------------------------------------------------------------
 */
const fixture = {
  listRequests: [],
  countRequests: [],
  itemRequests: [],
  aggregateRequests: [],
  apiRequests: [],
  analyticsRequests: [],
  unhandled: [],
};
window.__appPlatformsFixture = fixture;

function tableName(modelType) {
  return new modelType().tableName || "";
}

// A query, as it reads in the spec: Includes and EqualToOrNull by their values.
function serialize(query) {
  const plain = {};
  for (const [field, value] of Object.entries(query || {})) {
    if (value instanceof EqualToOrNull) {
      plain[field] = { equalToOrNull: String(value.value) };
    } else if (value instanceof Includes) {
      plain[field] = { includes: value.values.map(String) };
    } else if (value && typeof value === "object" && value._type) {
      plain[field] = { [value._type]: String(value.value ?? "") };
    } else if (value instanceof ObjectID) {
      plain[field] = value.toString();
    } else {
      plain[field] = value;
    }
  }
  return plain;
}

function idsOf(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => {
      return String(entry && entry._id ? entry._id : entry);
    });
  }
  return value === undefined || value === null ? [] : [String(value)];
}

// A query, matched as the server would, for the columns these pages read.
function rowMatches(row, query) {
  for (const [field, wanted] of Object.entries(query || {})) {
    if (field === "projectId") {
      continue;
    }
    if (wanted instanceof EqualToOrNull) {
      if (
        row[field] !== undefined &&
        row[field] !== null &&
        String(row[field]) !== String(wanted.value)
      ) {
        return false;
      }
      continue;
    }
    if (wanted instanceof Includes) {
      const allowed = wanted.values.map(String);
      if (
        !idsOf(row[field]).some((entry) => {
          return allowed.includes(entry);
        })
      ) {
        return false;
      }
      continue;
    }
    if (wanted instanceof ObjectID) {
      if (String(row[field]) !== wanted.toString()) {
        return false;
      }
      continue;
    }
    // The revisions' and the strip's reads: set, in a window, after a time.
    if (wanted instanceof NotNull) {
      if (row[field] === undefined || row[field] === null) {
        return false;
      }
      continue;
    }
    // The strip's environments that never reported: not set.
    if (wanted instanceof IsNull) {
      if (row[field] !== undefined && row[field] !== null) {
        return false;
      }
      continue;
    }
    if (wanted instanceof InBetween) {
      const time = new Date(row[field] || 0).getTime();
      if (
        time < new Date(wanted.startValue).getTime() ||
        time > new Date(wanted.endValue).getTime()
      ) {
        return false;
      }
      continue;
    }
    if (wanted instanceof GreaterThan) {
      if (
        new Date(row[field] || 0).getTime() <= new Date(wanted.value).getTime()
      ) {
        return false;
      }
      continue;
    }
    if (
      typeof wanted === "string" ||
      typeof wanted === "number" ||
      typeof wanted === "boolean"
    ) {
      if (String(row[field] ?? "") !== String(wanted)) {
        return false;
      }
    }
  }
  return true;
}

function rowsOf(modelType, query) {
  return (TABLES[tableName(modelType)] || []).filter((row) => {
    return rowMatches(row, query);
  });
}

// The tables the pages read that the fixture keeps empty, as a new project's are.
const EMPTY_TABLES = [
  "Label",
  "IncidentState",
  "AlertState",
  "Incident",
  "Alert",
  "Team",
  "User",
  "CloudResourceOwnerUser",
  "CloudResourceOwnerTeam",
  "CloudResourceFeed",
  "TelemetryIngestionKey",
  "ProjectUser",
  // The telemetry explorers' pickers and saved views, and the metric catalog.
  "Host",
  "DockerHost",
  "PodmanHost",
  "KubernetesCluster",
  "LogSavedView",
  "MetricType",
  // The Incidents and Alerts tabs' create forms.
  "IncidentCustomField",
  "IncidentNoteTemplate",
  "AlertCustomField",
  "AlertNoteTemplate",
];

function isModelled(modelType) {
  const name = tableName(modelType);
  return Boolean(TABLES[name]) || EMPTY_TABLES.includes(name);
}

ModelAPI.getList = async (options) => {
  const name = tableName(options.modelType);
  fixture.listRequests.push({
    modelName: name,
    query: serialize(options.query),
  });

  if (!isModelled(options.modelType)) {
    fixture.unhandled.push({ kind: "list", modelName: name });
  }

  let rows = rowsOf(options.modelType, options.query);

  const sort = options.sort || {};
  const [sortField] = Object.keys(sort);
  if (sortField) {
    const direction = String(sort[sortField]).toLowerCase().startsWith("desc")
      ? -1
      : 1;
    rows = [...rows].sort((a, b) => {
      const left = a[sortField];
      const right = b[sortField];
      // Times by time and numbers by number, as the server sorts them.
      if (left instanceof Date || right instanceof Date) {
        return (
          ((left ? new Date(left).getTime() : 0) -
            (right ? new Date(right).getTime() : 0)) *
          direction
        );
      }
      if (typeof left === "number" && typeof right === "number") {
        return (left - right) * direction;
      }
      return String(left ?? "").localeCompare(String(right ?? "")) * direction;
    });
  }

  const skip = options.skip || 0;
  const limit = options.limit || rows.length;

  return {
    data: rows.slice(skip, skip + limit).map((row) => {
      return Object.assign(new options.modelType(), row);
    }),
    count: rows.length,
    skip: skip,
    limit: limit,
  };
};

ModelAPI.count = async (options) => {
  const name = tableName(options.modelType);
  fixture.countRequests.push({
    modelName: name,
    query: serialize(options.query),
  });

  if (!isModelled(options.modelType)) {
    fixture.unhandled.push({ kind: "count", modelName: name });
  }

  return rowsOf(options.modelType, options.query).length;
};

ModelAPI.getItem = async (options) => {
  const name = tableName(options.modelType);
  fixture.itemRequests.push({
    modelName: name,
    id: options.id.toString(),
    select: Object.keys(options.select || {}).sort(),
  });

  if (!isModelled(options.modelType)) {
    fixture.unhandled.push({ kind: "item", modelName: name });
    return null;
  }

  const found = (TABLES[name] || []).find((row) => {
    return row._id === options.id.toString();
  });

  return found ? Object.assign(new options.modelType(), found) : null;
};

/*
 * Telemetry: an environment's spans and metrics, as aggregates - a smooth
 * series over the last half hour, scaled to what each one counts: requests,
 * the few that errored, a p95 in nanoseconds, a metric's own value.
 */
function seriesOf(base, swing) {
  const data = [];
  for (let step = 30; step >= 0; step--) {
    data.push({
      timestamp: new Date(LOADED_AT - step * MINUTE).toISOString(),
      value: base + swing * Math.sin(step / 4),
    });
  }
  return data;
}

AnalyticsModelAPI.aggregate = async (options) => {
  const name = tableName(options.modelType);
  const aggregateBy = options.aggregateBy || {};
  const query = aggregateBy.query || {};
  fixture.aggregateRequests.push({
    modelName: name,
    aggregationType: aggregateBy.aggregationType || null,
  });

  // The analytics tables are named by version (SpanItemV3, MetricItemV3).
  if (name.startsWith("Span")) {
    if (
      String(aggregateBy.aggregationType || "")
        .toLowerCase()
        .includes("95")
    ) {
      // 120 ms, in nanoseconds.
      return { data: seriesOf(120e6, 20e6) };
    }
    if (query.statusCode !== undefined) {
      return { data: seriesOf(0.6, 0.4) };
    }
    return { data: seriesOf(42, 8) };
  }

  // A metric: CPU as a fraction, memory in bytes.
  return {
    data: String(query.name || "").includes("memory")
      ? seriesOf(512 * 1024 * 1024, 64 * 1024 * 1024)
      : seriesOf(0.38, 0.06),
  };
};

AnalyticsModelAPI.getList = async (options) => {
  fixture.listRequests.push({
    modelName: tableName(options.modelType),
    query: {},
  });
  return { data: [], count: 0, skip: 0, limit: options.limit || 10 };
};

AnalyticsModelAPI.count = async () => {
  return 0;
};

function ok(data) {
  return new HTTPResponse(200, data, {});
}

async function handleApi(method, options) {
  const url = new URL(options.url.toString(), window.location.origin);
  fixture.apiRequests.push({ method, url: url.pathname });

  /*
   * The grouped trace read: every app of an environment by the attributes
   * that name it, or one app's revisions by its revision attribute.
   */
  if (url.pathname.endsWith("/telemetry/traces/analytics")) {
    const body = options.data || {};
    const groupBy = body.groupBy || [];
    const filters = body.attributes || {};
    fixture.analyticsRequests.push({
      groupBy,
      filters,
      entryOnly: body.entryOnly,
    });

    const revisionKey = groupBy.find((key) => {
      return /revision|version/.test(key);
    });
    if (revisionKey) {
      return ok({
        data: Object.entries(REVISION_SIGNALS).map(([value, signals]) => {
          return { groupValues: { [revisionKey]: value }, ...signals };
        }),
      });
    }

    const environment = ENVIRONMENTS.find((row) => {
      return (
        row.cloudPlatform === filters["resource.cloud.platform"] &&
        row.cloudRegion === filters["resource.cloud.region"]
      );
    });
    const rows = APPS.filter((row) => {
      return (
        environment &&
        row.cloudResourceId === environment._id &&
        APP_SIGNALS[row._id] &&
        Object.keys(row.telemetryAttributes)
          .map((key) => {
            return `resource.${key}`;
          })
          .sort()
          .join(",") === [...groupBy].sort().join(",")
      );
    }).map((row) => {
      const groupValues = {};
      for (const key of groupBy) {
        groupValues[key] = row.telemetryAttributes[key.slice(9)];
      }
      return { groupValues, ...APP_SIGNALS[row._id] };
    });
    return ok({ data: rows });
  }

  // The metrics search bar's attribute keys.
  if (url.pathname.endsWith("/telemetry/metrics/get-attributes")) {
    return ok({ attributes: ["resource.cloud.platform"] });
  }

  /*
   * The Logs and Traces tabs' explorers, for an environment that has sent
   * no logs or spans in the selected range: no attribute keys, no buckets,
   * no facet values.
   */
  if (/\/telemetry\/(logs|traces)\/get-attributes$/.test(url.pathname)) {
    return ok({ attributes: [] });
  }
  if (/\/telemetry\/(logs|traces)\/histogram$/.test(url.pathname)) {
    return ok({ buckets: [], bucketSizeInMinutes: 1 });
  }
  if (/\/telemetry\/(logs|traces)\/facets$/.test(url.pathname)) {
    return ok({ facets: {}, timedOutFacets: [] });
  }

  fixture.unhandled.push({ kind: "api", method, url: url.pathname });
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

/*
 * ---------------------------------------------------------------------------
 * Router, as App.tsx mounts the route groups
 * ---------------------------------------------------------------------------
 */
const PAGE_PROPS = {
  pageRoute: RouteMap[PageMap.APP_PLATFORMS_OVERVIEW],
  currentProject: project,
  hasPaymentMethod: true,
};

function useNavigationHooks() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
}

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

function CloudResourceView() {
  useNavigationHooks();
  return <CloudResourceViewLayout {...PAGE_PROPS} />;
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
          <span className="text-sm text-gray-500">Acme Apps</span>
        </div>
        <span data-testid="synthetic-banner" className="text-xs text-gray-500">
          Preview workspace · Synthetic data
        </span>
      </header>
      <Routes>
        <Route
          path={RouteMap[PageMap.APP_PLATFORMS_ROOT].toString()}
          element={<AppPlatformsRoutes {...PAGE_PROPS} />}
        />
        {/*
         * Cloud's view of one row: it reads the row's kind and forwards an
         * environment to App Platforms. Its tabs are not modelled.
         */}
        <Route
          path={`${RouteMap[PageMap.CLOUD_RESOURCE_VIEW].toString()}/*`}
          element={<CloudResourceView />}
        >
          <Route path="*" element={<StubPage />} />
        </Route>
        <Route path="*" element={<StubPage />} />
      </Routes>
    </>
  );
}

// As the Dashboard mounts it: navigations update synchronously.
createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <FixtureApp />
  </BrowserRouter>,
);

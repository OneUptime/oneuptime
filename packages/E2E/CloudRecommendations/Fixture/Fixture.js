/*
 * Offline fixture for a cloud account's and a cloud resource's recommended
 * monitors, and the scheduled maintenance that holds a cloud resource: the
 * production Cloud account layout (its side menu, with the Recommendations
 * badge) with the account's Recommendations page, and a cloud resource's
 * layout (its side menu) with its Recommendations and Scheduled
 * Maintenance pages, under their real RouteMap patterns. Only the data
 * boundary (ModelAPI, AnalyticsModelAPI, API, Realtime) and the signed-in
 * user are replaced. Every record is made up (Fixture/Data.js).
 *
 * Scenarios are picked with query parameters, parsed once at load:
 *
 *   ?coverage=     fresh (default: no monitor made yet)
 *                  | some (web-1's two monitors and orders-db's High CPU
 *                  made, orders-db's Low Free Storage dismissed)
 *                  | all (every recommended monitor of the account made)
 *   ?role=         owner (default) | viewer (may read, may not create a
 *                  monitor)
 *   ?maintenance=  none (default) | held (an event in progress holds
 *                  orders-db, another is scheduled for next week)
 *   ?fail=         monitors: the read of what covers a recommendation
 *                  answers 500
 *                  | create: every monitor create answers 400
 *   ?lang=         de or fa reads the German or Persian locale file
 *                  (Persian lays the page out right to left)
 *   ?theme=        dark adds html.dark (server.js)
 *
 * Every read is recorded on window.__cloudRecommendationsFixture -
 * listRequests, countRequests, itemRequests, creates, deletes, apiRequests
 * and unhandled (anything the fixture does not model). The spec keeps
 * `unhandled` empty.
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
import CloudAccountViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Accounts/View/Layout";
import CloudAccountRecommendations from "../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Accounts/View/Recommendations";
import CloudResourceViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/Layout";
import CloudResourceRecommendations from "../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/Recommendations";
import CloudResourceScheduledMaintenance from "../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/ScheduledMaintenance";
import { readCloudResourceRecommendationContext } from "../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationResourceRegistry";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Color from "Common/Types/Color";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import Includes from "Common/Types/BaseDatabase/Includes";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorRecommendationCatalog from "Common/Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import MonitorRecommendationUtil from "Common/Types/Monitor/Recommendation/MonitorRecommendationUtil";
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
import {
  PROJECT_ID,
  RESOURCE_IDS,
  buildAccount,
  buildResources,
  uuid,
} from "./Data";

/*
 * ---------------------------------------------------------------------------
 * Scenario switches
 * ---------------------------------------------------------------------------
 */
const params = new URLSearchParams(window.location.search);

const COVERAGE = ["some", "all"].includes(params.get("coverage"))
  ? params.get("coverage")
  : "fresh";
const ROLE = params.get("role") === "viewer" ? "viewer" : "owner";
const MAINTENANCE = params.get("maintenance") === "held" ? "held" : "none";
const FAIL = ["monitors", "create"].includes(params.get("fail"))
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
const rolePermissions = [
  ...GLOBAL_PERMISSIONS,
  ROLE === "viewer" ? Permission.Viewer : Permission.ProjectOwner,
];

/*
 * ---------------------------------------------------------------------------
 * The clock, the project, the account and its resources
 * ---------------------------------------------------------------------------
 */
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const LOADED_AT = Date.now();
const projectObjectId = new ObjectID(PROJECT_ID);

const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Commerce",
});

const resources = buildResources(LOADED_AT);
const account = buildAccount(LOADED_AT);

function resourceNamed(id) {
  return resources.find((row) => {
    return row._id === id;
  });
}

/*
 * ---------------------------------------------------------------------------
 * The monitors the project has: those made from a recommendation, built
 * exactly as the page builds them
 * ---------------------------------------------------------------------------
 */
const placeholderId = ObjectID.getZeroObjectID();
let monitorNumber = 0;

function monitorFor(row, templateId) {
  const context = readCloudResourceRecommendationContext(row);
  const recommendation = MonitorRecommendationCatalog.getRecommendations(
    MonitorRecommendationResourceType.CloudResource,
    context,
  ).find((candidate) => {
    return candidate.templateId === templateId;
  });
  if (!recommendation) {
    return null;
  }
  const step = recommendation.getMonitorStep({
    resourceIdentifier: row._id,
    onlineMonitorStatusId: placeholderId,
    offlineMonitorStatusId: placeholderId,
    defaultIncidentSeverityId: placeholderId,
    defaultAlertSeverityId: placeholderId,
    monitorName: row.name,
  });
  const steps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: placeholderId,
  };
  monitorNumber++;
  return {
    _id: uuid("58000000", monitorNumber),
    name: MonitorRecommendationUtil.getMonitorName({
      recommendation,
      resourceDisplayName: row.name,
    }),
    monitorType: MonitorType.Metrics,
    monitorSteps: steps,
  };
}

function everyMonitorOf(row) {
  const context = readCloudResourceRecommendationContext(row);
  return MonitorRecommendationCatalog.getRecommendations(
    MonitorRecommendationResourceType.CloudResource,
    context,
  ).map((recommendation) => {
    return monitorFor(row, recommendation.templateId);
  });
}

function initialMonitors() {
  if (COVERAGE === "some") {
    return [
      monitorFor(
        resourceNamed(RESOURCE_IDS.web1),
        "cloud-aws-ec2-status-check-failed",
      ),
      monitorFor(resourceNamed(RESOURCE_IDS.web1), "cloud-aws-ec2-high-cpu"),
      monitorFor(resourceNamed(RESOURCE_IDS.ordersDb), "cloud-aws-rds-high-cpu"),
    ].filter(Boolean);
  }

  if (COVERAGE === "all") {
    return resources
      .filter((row) => {
        return row.cloudResourceKind === "resource";
      })
      .flatMap(everyMonitorOf)
      .filter(Boolean);
  }

  return [];
}

const dismissals =
  COVERAGE === "some"
    ? [
        {
          _id: uuid("59000000", 1),
          recommendationId: "CloudResource:cloud-aws-rds-low-storage",
          recommendationType: "Monitor",
          resourceType: MonitorRecommendationResourceType.CloudResource,
          resourceId: RESOURCE_IDS.ordersDb,
          dismissalReason: "Storage autoscaling is on.",
        },
      ]
    : [];

/*
 * ---------------------------------------------------------------------------
 * Scheduled maintenance that holds orders-db
 * ---------------------------------------------------------------------------
 */
const MAINTENANCE_STATES = [
  {
    _id: uuid("54000000", 1),
    name: "Scheduled",
    order: 1,
    color: new Color("#6b7280"),
    isScheduledState: true,
  },
  {
    _id: uuid("54000000", 2),
    name: "Ongoing",
    order: 2,
    color: new Color("#f59e0b"),
    isOngoingState: true,
  },
  {
    _id: uuid("54000000", 3),
    name: "Completed",
    order: 3,
    color: new Color("#10b981"),
    isResolvedState: true,
    isEndedState: true,
  },
];

function maintenanceEvent(number, fields) {
  const ordersDb = resourceNamed(RESOURCE_IDS.ordersDb);
  return {
    _id: uuid("57000000", number),
    projectId: PROJECT_ID,
    scheduledMaintenanceNumber: number,
    scheduledMaintenanceNumberWithPrefix: `SM-${number}`,
    monitors: [],
    cloudResources: [
      {
        _id: ordersDb._id,
        name: ordersDb.name,
        projectId: PROJECT_ID,
        cloudResourceKind: "resource",
      },
    ],
    labels: [],
    isVisibleOnStatusPage: true,
    ...fields,
  };
}

const maintenanceEvents =
  MAINTENANCE === "held"
    ? [
        maintenanceEvent(41, {
          title: "orders-db engine upgrade to PostgreSQL 16",
          startsAt: new Date(LOADED_AT - 20 * MINUTE),
          endsAt: new Date(LOADED_AT + 40 * MINUTE),
          currentScheduledMaintenanceStateId: MAINTENANCE_STATES[1]._id,
          currentScheduledMaintenanceState: MAINTENANCE_STATES[1],
        }),
        maintenanceEvent(42, {
          title: "orders-db storage resize",
          startsAt: new Date(LOADED_AT + 7 * DAY),
          endsAt: new Date(LOADED_AT + 7 * DAY + 60 * MINUTE),
          currentScheduledMaintenanceStateId: MAINTENANCE_STATES[0]._id,
          currentScheduledMaintenanceState: MAINTENANCE_STATES[0],
        }),
      ]
    : [];

/*
 * ---------------------------------------------------------------------------
 * Recorder
 * ---------------------------------------------------------------------------
 */
const fixture = {
  scenario: {
    coverage: COVERAGE,
    role: ROLE,
    maintenance: MAINTENANCE,
    fail: FAIL,
    language: LANGUAGE,
  },
  loadedAt: LOADED_AT,
  listRequests: [],
  countRequests: [],
  itemRequests: [],
  creates: [],
  deletes: [],
  apiRequests: [],
  unhandled: [],
};
window.__cloudRecommendationsFixture = fixture;

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

function comparable(value) {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return Date.parse(value);
  }
  return value;
}

// A relation's ids, as an Includes on a list column reads them.
function relationIds(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.map((entry) => {
    return String(plain(entry && entry._id !== undefined ? entry._id : entry));
  });
}

/*
 * A query's values match as Postgres would match them: plain values,
 * Includes (on a column, or on a list relation), NotEqual, NotNull,
 * GreaterThan(OrEqual) and a Search.
 */
function matches(record, query) {
  for (const [field, wanted] of Object.entries(query || {})) {
    if (field === "projectId") {
      continue;
    }
    const value = record[field];
    if (wanted instanceof Includes) {
      const allowed = new Set(
        wanted.values.map((entry) => {
          return String(plain(entry));
        }),
      );
      const listed = relationIds(value);
      if (listed) {
        if (
          !listed.some((id) => {
            return allowed.has(id);
          })
        ) {
          return false;
        }
        continue;
      }
      if (!allowed.has(String(plain(value)))) {
        return false;
      }
      continue;
    }
    if (wanted instanceof NotEqual) {
      if (value === null || value === undefined) {
        return false;
      }
      if (String(value) === String(plain(wanted.value))) {
        return false;
      }
      continue;
    }
    if (wanted instanceof NotNull) {
      if (value === null || value === undefined) {
        return false;
      }
      continue;
    }
    if (wanted instanceof GreaterThanOrEqual || wanted instanceof GreaterThan) {
      if (value === null || value === undefined) {
        return false;
      }
      const left = comparable(value);
      const right = comparable(wanted.value);
      if (wanted instanceof GreaterThan ? !(left > right) : !(left >= right)) {
        return false;
      }
      continue;
    }
    if (wanted instanceof Search) {
      if (
        !String(value ?? "")
          .toLowerCase()
          .includes(String(wanted.value).toLowerCase())
      ) {
        return false;
      }
      continue;
    }
    const plainWanted = plain(wanted);
    if (
      typeof plainWanted !== "string" &&
      typeof plainWanted !== "boolean" &&
      typeof plainWanted !== "number"
    ) {
      continue;
    }
    if (String(value ?? "") !== String(plainWanted)) {
      return false;
    }
  }
  return true;
}

const store = {
  CloudAccount: [account],
  CloudResource: resources,
  Monitor: initialMonitors(),
  RecommendationDismissal: dismissals,
  MonitorStatus: [
    {
      _id: uuid("55000000", 1),
      name: "Operational",
      isOperationalState: true,
      isOfflineState: false,
      priority: 1,
      color: new Color("#10b981"),
      isArchived: false,
    },
    {
      _id: uuid("55000000", 2),
      name: "Offline",
      isOperationalState: false,
      isOfflineState: true,
      priority: 2,
      color: new Color("#ef4444"),
      isArchived: false,
    },
  ],
  IncidentSeverity: [
    {
      _id: uuid("52000000", 1),
      name: "Critical",
      order: 1,
      color: new Color("#dc2626"),
    },
    {
      _id: uuid("52000000", 2),
      name: "Minor",
      order: 2,
      color: new Color("#f59e0b"),
    },
  ],
  AlertSeverity: [
    {
      _id: uuid("53000000", 1),
      name: "High",
      order: 1,
      color: new Color("#dc2626"),
    },
    {
      _id: uuid("53000000", 2),
      name: "Low",
      order: 2,
      color: new Color("#6b7280"),
    },
  ],
  OnCallDutyPolicy: [{ _id: uuid("56000000", 1), name: "Storefront on-call" }],
  Label: [
    {
      _id: uuid("72000000", 1),
      name: "production",
      color: new Color("#4f46e5"),
    },
  ],
  ScheduledMaintenance: maintenanceEvents,
  ScheduledMaintenanceState: MAINTENANCE_STATES,
  ScheduledMaintenanceOwnerUser: [],
  ScheduledMaintenanceOwnerTeam: [],
  ScheduledMaintenanceCustomField: [],
  ScheduledMaintenanceNoteTemplate: [],
  Incident: [],
  IncidentState: [],
  Alert: [],
  AlertState: [],
  TableView: [],
  Team: [],
  User: [],
  StatusPage: [],
};

for (const name of ARCHIVABLE_VALUE_TABLE_NAMES) {
  for (const record of store[name] || []) {
    if (record.isArchived === undefined) {
      record.isArchived = false;
    }
  }
}

// In the order the server sorts them: nulls last, as Postgres sorts them.
function sortRecords(records, sort) {
  const fields = Object.entries(sort || {});
  return [...records].sort((left, right) => {
    for (const [field, order] of fields) {
      const descending = order === SortOrder.Descending;
      const a = left[field];
      const b = right[field];
      if (a === b) {
        continue;
      }
      if (a === null || a === undefined) {
        return 1;
      }
      if (b === null || b === undefined) {
        return -1;
      }
      const ascending =
        typeof a === "number" && typeof b === "number"
          ? a - b
          : a instanceof Date || b instanceof Date
            ? new Date(a).getTime() - new Date(b).getTime()
            : String(a) < String(b)
              ? -1
              : 1;
      if (ascending !== 0) {
        return descending ? -ascending : ascending;
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
      return matches(record, query);
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
UserUtil.isLoggedIn = () => {
  return true;
};
UserUtil.getUserId = () => {
  return new ObjectID(uuid("80000000", 1));
};
UserUtil.getName = () => {
  return "Sam Patel";
};
UserUtil.getEmail = () => {
  return "sam@acme-commerce.example";
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
        return {
          _type: "UserPermission",
          permission,
          labelIds: [],
          isBlockPermission: false,
        };
      }),
  };
};
ProjectUtil.getCurrentProjectId = () => {
  return projectObjectId;
};
ProjectUtil.getCurrentProject = () => {
  return project;
};
ProjectUtil.getCurrentPlan = () => {
  return null;
};
ModelAPI.getCommonHeaders = () => {
  return { tenantid: PROJECT_ID };
};

const SERVER_ERROR = "Something went wrong on the server. Please try again.";

ModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.listRequests.push({
    modelName,
    query: serialize(options.query),
    select: serialize(options.select),
    sort: serialize(options.sort),
    limit: options.limit,
  });

  if (FAIL === "monitors" && modelName === "Monitor") {
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
    return String(candidate._id) === String(id);
  });

  return record ? Object.assign(new options.modelType(), record) : null;
};

/*
 * A monitor the page creates: kept, so what covers a recommendation is read
 * back as the server would answer it. ?fail=create refuses each one, in
 * the server's own words.
 */
async function createModel(options) {
  const model = options.model;
  const modelName = tableName(options.modelType);
  const record = serialize(model.toJSON ? model.toJSON() : model) || {};
  fixture.creates.push({
    modelName,
    name: model.name,
    monitorType: model.monitorType,
    monitoringInterval: model.monitoringInterval,
    cloudResourceIds: (model.cloudResources || []).map((item) => {
      return plain(item.id || item._id);
    }),
    miscDataProps: serialize(options.miscDataProps),
    record,
  });

  if (FAIL === "create" && modelName === "Monitor") {
    throw new Error(
      "You do not have permission to create this monitor. Ask a project admin.",
    );
  }

  if (!store[modelName]) {
    fixture.unhandled.push({ kind: "create", modelName });
    return new HTTPResponse(200, {}, {});
  }

  const created = {
    ...(modelName === "Monitor"
      ? {
          name: model.name,
          monitorType: model.monitorType,
          monitorSteps: model.monitorSteps,
        }
      : record),
    _id: uuid("5f000000", fixture.creates.length),
  };
  store[modelName].push(created);
  return new HTTPResponse(200, created, {});
}

ModelAPI.createOrUpdate = createModel;
ModelAPI.create = createModel;

ModelAPI.deleteItem = async (options) => {
  const modelName = tableName(options.modelType);
  const id = String(plain(options.id));
  fixture.deletes.push({ modelName, id });
  if (store[modelName]) {
    store[modelName] = store[modelName].filter((record) => {
      return String(record._id) !== id;
    });
  }
};

AnalyticsModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.unhandled.push({ kind: "analytics.getList", modelName });
  return { data: [], count: 0, skip: 0, limit: 0 };
};

AnalyticsModelAPI.count = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.unhandled.push({ kind: "analytics.count", modelName });
  return 0;
};

function ok(data) {
  return new HTTPResponse(200, data, {});
}

async function handleApi(method, options) {
  const url = options.url.toString();
  const parsed = new URL(url, window.location.origin);
  const body = serialize(options.data) || {};
  fixture.apiRequests.push({ method, url: parsed.pathname, body });

  // When OneUptime itself was not receiving: never, here.
  if (method === "POST" && parsed.pathname.endsWith("/receiving-gaps")) {
    return ok({ gaps: [] });
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

const AccountLayout = withNavigation(
  CloudAccountViewLayout,
  PageMap.CLOUD_ACCOUNT_VIEW,
);
const ResourceLayout = withNavigation(
  CloudResourceViewLayout,
  PageMap.CLOUD_RESOURCE_VIEW,
);

const ACCOUNT_PAGES = [
  [PageMap.CLOUD_ACCOUNT_VIEW_RECOMMENDATIONS, CloudAccountRecommendations],
].map(([pageKey, Component]) => {
  return {
    path: RouteMap[pageKey].toString(),
    Page: withNavigation(Component, pageKey),
  };
});

const RESOURCE_PAGES = [
  [PageMap.CLOUD_RESOURCE_VIEW_RECOMMENDATIONS, CloudResourceRecommendations],
  [
    PageMap.CLOUD_RESOURCE_VIEW_SCHEDULED_MAINTENANCE,
    CloudResourceScheduledMaintenance,
  ],
].map(([pageKey, Component]) => {
  return {
    path: RouteMap[pageKey].toString(),
    Page: withNavigation(Component, pageKey),
  };
});

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
          <span className="text-sm text-gray-500">Acme Commerce</span>
        </div>
        <span data-testid="synthetic-banner" className="text-xs text-gray-500">
          Preview workspace · Synthetic data
        </span>
      </header>
      <Routes>
        <Route element={<AccountLayout />}>
          {ACCOUNT_PAGES.map((page) => {
            return (
              <Route key={page.path} path={page.path} element={<page.Page />} />
            );
          })}
        </Route>
        <Route element={<ResourceLayout />}>
          {RESOURCE_PAGES.map((page) => {
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

/*
 * Navigates as the Dashboard does (its src/Index.tsx): each navigation renders
 * at once, not in a React transition (Tests/Ops/E2EFixtureRouters).
 */
createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <FixtureApp />
  </BrowserRouter>,
);


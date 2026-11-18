/*
 * Offline fixture for how a product explains itself
 * (Components/ProductOnboarding): a product's first page says what the
 * product does while the project has nothing in it yet - under the empty
 * table, the steps to a first result with the first as the page's own
 * button, a drawn example and the documentation - and once there is
 * something in it, How it works beside the page's title opens the same
 * explanation in a dialog.
 *
 * Two lists, each in its production layout and mounted under its real
 * RouteMap pattern, stand for the two kinds of list:
 *
 *   MONITORS      /dashboard/:projectId/monitors
 *                 Pages/Monitor/{Layout,Monitors}: the first step is a page
 *                 of its own (Create Monitor)
 *   STATUS_PAGES  /dashboard/:projectId/status-pages
 *                 Pages/StatusPages/{Layout,StatusPages}: the first step is
 *                 the table's own create form
 *
 * And the page the issue was raised on, a product with no list of its own
 * at the start:
 *
 *   DATA_OBSERVABILITY  /dashboard/:projectId/data-observability/overview
 *                 Pages/DataObservability/{Layout,Overview}: no database
 *                 connected yet (its overview read says so), and one its
 *                 traces know of, which the page suggests under the
 *                 explanation; or, with data=..., a project using it (see
 *                 below)
 *
 * And one page of the fixture's own, which holds every product's
 * explanation at once, each as its How it works dialog draws it:
 *
 *   /dashboard/:projectId/product-explanations
 *                 every entry of Components/ProductOnboarding/
 *                 ProductOnboardings, in its order: the product's name over
 *                 its showcase (ResourceShowcaseCard, bare), in a box as wide
 *                 as the dialog's body
 *
 * Only the ModelAPI / API data boundary and the signed-in user's
 * permissions are replaced. Every record is fabricated for an "Acme Shop"
 * project.
 *
 * Steered by the query string:
 *   - monitors=1      the project has a monitor ("Storefront")
 *   - statusPages=1   the project has a status page ("Acme Status")
 *   - role=viewer     a project Viewer: reads every list, creates nothing
 *   - counts=fail     every count fails, as an API outage would
 *   - data=busy       Data Observability in use (#6435): three watched
 *                     databases - one that could not be read, one with no
 *                     alert on - and twenty-three things that need someone,
 *                     the eight most urgent listed (a failed and a late
 *                     pipeline run, a failing check, a drifted
 *                     reconciliation, a late data product, late tables, a
 *                     check that could not run), owned or not, alerted or
 *                     not; four of its five first steps done
 *   - data=healthy    every step done and nothing wrong
 *   - data=connected  one database just connected, not read yet: no table
 *                     counted, nothing wrong, one of the five steps done
 *   - data=fail       the Overview's read fails every time, as an outage would
 *
 * And Data Observability's Issues page (#6549), at
 * /dashboard/:projectId/data-observability/issues under the same layout:
 * every issue of the scenario, filtered and paged as the server does it
 * (DataObservabilityIssues), each request's body kept (`issueRequests`).
 * The menu beside every Data Observability page asks how many things need
 * someone (#6552): the Overview's own count, failing as the Overview does.
 *   - lang=de|fa      the Dashboard's German or Persian words (Persian reads
 *                     right to left)
 *   - theme=dark      dark mode (set before the bundle by server.js)
 *
 * Recorded on window.__productOnboardingFixture: every count asked
 * (`counts`: the table and the query as sent), every create (`creates`),
 * every read of Data Observability's own routes (`dataReads`: the route;
 * `issueRequests`: what the Issues page asked for)
 * and every read of a table this fixture does not model, or any other
 * request it does not answer (`unhandled`; the spec fails on any). It also
 * lists every product the explanations page draws (`products`: its key,
 * and the English keys of its name and its showcase's title), so the spec
 * reads the registry without importing the Dashboard.
 */
import "Common/UI/Styles/Theme.css";
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Outlet,
  Route as PageRoute,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import { initReactI18next } from "react-i18next";
import MonitorLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Layout";
import MonitorsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Monitors";
import StatusPagesLayout from "../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/Layout";
import StatusPagesPage from "../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/StatusPages";
import DataObservabilityLayout from "../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/Layout";
import DataObservabilityOverviewPage from "../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/Overview";
import DataObservabilityIssuesPage from "../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/Issues";
import { PRODUCT_ONBOARDINGS } from "../../../App/FeatureSet/Dashboard/src/Components/ProductOnboarding/ProductOnboardings";
import ResourceShowcaseCard from "../../../App/FeatureSet/Dashboard/src/Components/ResourceShowcase/ResourceShowcaseCard";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataAssetOwnerTeam from "Common/Models/DatabaseModels/DataAssetOwnerTeam";
import DataAssetOwnerUser from "Common/Models/DatabaseModels/DataAssetOwnerUser";
import DataPipelineOwnerTeam from "Common/Models/DatabaseModels/DataPipelineOwnerTeam";
import DataPipelineOwnerUser from "Common/Models/DatabaseModels/DataPipelineOwnerUser";
import DataProduct from "Common/Models/DatabaseModels/DataProduct";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorCustomField from "Common/Models/DatabaseModels/MonitorCustomField";
import MonitorOwnerTeam from "Common/Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "Common/Models/DatabaseModels/MonitorOwnerUser";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import Probe from "Common/Models/DatabaseModels/Probe";
import RecommendationDismissal from "Common/Models/DatabaseModels/RecommendationDismissal";
import Project from "Common/Models/DatabaseModels/Project";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageCustomField from "Common/Models/DatabaseModels/StatusPageCustomField";
import StatusPageOwnerTeam from "Common/Models/DatabaseModels/StatusPageOwnerTeam";
import StatusPageOwnerUser from "Common/Models/DatabaseModels/StatusPageOwnerUser";
import TableView from "Common/Models/DatabaseModels/TableView";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import WorkspaceProjectAuthToken from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Includes from "Common/Types/BaseDatabase/Includes";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Search from "Common/Types/BaseDatabase/Search";
import Color from "Common/Types/Color";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { followLanguageForPage } from "Common/UI/Utils/PageLanguage";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslator from "Common/UI/Utils/UseTranslator";
import UserUtil from "Common/UI/Utils/User";
import EN from "../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import { localeResources } from "../../SuiteHelpers/FixtureLocales";

const PROJECT_ID = "10000000-0000-4000-8000-0000000000a1";
const SAM_ID = "40000000-0000-4000-8000-0000000000a1";
const NEW_STATUS_PAGE_ID = "30000000-0000-4000-8000-0000000000a9";

const params = new URLSearchParams(window.location.search);
const language = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";
const countsFail = params.get("counts") === "fail";
const dataScenario = ["busy", "healthy", "connected", "fail"].includes(
  params.get("data"),
)
  ? params.get("data")
  : "new";

const fixture = {
  scenario: {
    monitors: params.get("monitors") === "1",
    statusPages: params.get("statusPages") === "1",
    role: params.get("role") === "viewer" ? "viewer" : "owner",
    countsFail,
    data: dataScenario,
    language,
  },
  counts: [],
  creates: [],
  dataReads: [],
  issueRequests: [],
  unhandled: [],
  // Every product the explanations page draws, in the registry's order.
  products: Object.entries(PRODUCT_ONBOARDINGS).map(([product, onboarding]) => {
    return {
      product,
      name: onboarding.name,
      title: onboarding.showcase.title,
    };
  }),
};
window.__productOnboardingFixture = fixture;

// ---- who is signed in -------------------------------------------------------

/*
 * The project's owner made it; a project Viewer reads every list and may
 * create nothing.
 */
const HELD =
  fixture.scenario.role === "viewer"
    ? [Permission.Viewer]
    : [Permission.ProjectOwner];
const GLOBAL_PERMISSIONS = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

UserUtil.isMasterAdmin = () => {
  return false;
};
UserUtil.getUserId = () => {
  return new ObjectID(SAM_ID);
};
UserUtil.getName = () => {
  return "Sam Patel";
};
UserUtil.getEmail = () => {
  return "sam@acme-shop.example";
};
PermissionUtil.getAllPermissions = () => {
  return [...GLOBAL_PERMISSIONS, ...HELD];
};
PermissionUtil.getProjectPermissions = () => {
  return {
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: HELD.map((permission) => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };
};
PermissionUtil.getGlobalPermissions = () => {
  return {
    _type: "UserGlobalAccessPermission",
    globalPermissions: [...GLOBAL_PERMISSIONS],
    projectIds: [new ObjectID(PROJECT_ID)],
  };
};

const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Shop",
});

ProjectUtil.getCurrentProjectId = () => {
  return new ObjectID(PROJECT_ID);
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

// ---- what the server holds ---------------------------------------------------

function tableName(modelType) {
  return String(new modelType().tableName);
}

function idOf(value) {
  return value === null || value === undefined ? "" : String(value);
}

function serialize(value) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value));
}

function record(ModelType, fields) {
  const item = new ModelType();
  item.createdAt = new Date("2026-11-02T09:00:00Z");
  item.updatedAt = new Date("2026-11-02T09:00:00Z");
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      item[key] = value;
    }
  }
  return item;
}

function monitorStatus(number, name, color, isOperationalState) {
  return record(MonitorStatus, {
    _id: `61000000-0000-4000-8000-00000000000${number}`,
    projectId: new ObjectID(PROJECT_ID),
    name,
    color: new Color(color),
    priority: number,
    isOperationalState,
  });
}

const OPERATIONAL = monitorStatus(1, "Operational", "#10b981", true);
const DEGRADED = monitorStatus(2, "Degraded", "#f59e0b", false);
const OFFLINE = monitorStatus(3, "Offline", "#ef4444", false);

const monitors = fixture.scenario.monitors
  ? [
      record(Monitor, {
        _id: "60000000-0000-4000-8000-0000000000a1",
        projectId: new ObjectID(PROJECT_ID),
        name: "Storefront",
        description: "The shop's home page, checked every minute.",
        monitorType: MonitorType.Website,
        currentMonitorStatus: OPERATIONAL,
        currentMonitorStatusId: new ObjectID(OPERATIONAL._id),
        labels: [],
        isArchived: false,
        disableActiveMonitoring: false,
        isAllProbesDisconnectedFromThisMonitor: false,
        isNoProbeEnabledOnThisMonitor: false,
      }),
    ]
  : [];

const statusPages = fixture.scenario.statusPages
  ? [
      record(StatusPage, {
        _id: "30000000-0000-4000-8000-0000000000a1",
        projectId: new ObjectID(PROJECT_ID),
        name: "Acme Status",
        description: "What customers see at status.acme-shop.example",
        labels: [],
        isArchived: false,
        isPublicStatusPage: true,
      }),
    ]
  : [];

/*
 * Data Observability in use (data=busy): who owns the tables and the data
 * product its Needs Attention names. public.orders has three owners,
 * public.payments one team, public.customers one person; the warehouse's
 * analytics.daily_sessions nobody; Finance daily revenue its owning team.
 */
const DATA = {
  ordersDb: "70000000-0000-4000-8000-0000000000d1",
  warehouse: "70000000-0000-4000-8000-0000000000d2",
  billingDb: "70000000-0000-4000-8000-0000000000d3",
  orders: "71000000-0000-4000-8000-0000000000d1",
  payments: "71000000-0000-4000-8000-0000000000d2",
  dailySessions: "71000000-0000-4000-8000-0000000000d3",
  customers: "71000000-0000-4000-8000-0000000000d4",
  nightlyLoad: "72000000-0000-4000-8000-0000000000d1",
  sessionsSync: "72000000-0000-4000-8000-0000000000d2",
  ordersEmailCheck: "73000000-0000-4000-8000-0000000000d1",
  customersIdCheck: "73000000-0000-4000-8000-0000000000d2",
  ordersReconciliation: "74000000-0000-4000-8000-0000000000d1",
  revenueProduct: "75000000-0000-4000-8000-0000000000d1",
  nightlyLoadAlert: "76000000-0000-4000-8000-0000000000d1",
  ordersEmailAlert: "76000000-0000-4000-8000-0000000000d2",
  paymentsAlert: "76000000-0000-4000-8000-0000000000d3",
};

const ADA = record(User, {
  _id: "41000000-0000-4000-8000-0000000000d1",
  name: "Ada Lovelace",
  email: "ada@acme-shop.example",
});
const GRACE = record(User, {
  _id: "41000000-0000-4000-8000-0000000000d2",
  name: "Grace Hopper",
  email: "grace@acme-shop.example",
});
const PAYMENTS_TEAM = record(Team, {
  _id: "42000000-0000-4000-8000-0000000000d1",
  name: "Payments",
});
const FINANCE_TEAM = record(Team, {
  _id: "42000000-0000-4000-8000-0000000000d2",
  name: "Finance Analytics",
});
const DATA_PLATFORM_TEAM = record(Team, {
  _id: "42000000-0000-4000-8000-0000000000d3",
  name: "Data Platform",
});

const isDataBusy = dataScenario === "busy";

const dataAssetOwnerUsers = isDataBusy
  ? [
      record(DataAssetOwnerUser, {
        _id: "43000000-0000-4000-8000-0000000000d1",
        projectId: new ObjectID(PROJECT_ID),
        dataAssetId: new ObjectID(DATA.orders),
        user: ADA,
      }),
      record(DataAssetOwnerUser, {
        _id: "43000000-0000-4000-8000-0000000000d2",
        projectId: new ObjectID(PROJECT_ID),
        dataAssetId: new ObjectID(DATA.orders),
        user: GRACE,
      }),
      record(DataAssetOwnerUser, {
        _id: "43000000-0000-4000-8000-0000000000d3",
        projectId: new ObjectID(PROJECT_ID),
        dataAssetId: new ObjectID(DATA.customers),
        user: ADA,
      }),
    ]
  : [];

const dataAssetOwnerTeams = isDataBusy
  ? [
      record(DataAssetOwnerTeam, {
        _id: "44000000-0000-4000-8000-0000000000d1",
        projectId: new ObjectID(PROJECT_ID),
        dataAssetId: new ObjectID(DATA.orders),
        team: PAYMENTS_TEAM,
      }),
      record(DataAssetOwnerTeam, {
        _id: "44000000-0000-4000-8000-0000000000d2",
        projectId: new ObjectID(PROJECT_ID),
        dataAssetId: new ObjectID(DATA.payments),
        team: PAYMENTS_TEAM,
      }),
    ]
  : [];

// The failed nightly load is the Data Platform team's (#6551).
const dataPipelineOwnerTeams = isDataBusy
  ? [
      record(DataPipelineOwnerTeam, {
        _id: "45000000-0000-4000-8000-0000000000d1",
        projectId: new ObjectID(PROJECT_ID),
        dataPipelineId: new ObjectID(DATA.nightlyLoad),
        team: DATA_PLATFORM_TEAM,
      }),
    ]
  : [];

const dataProducts = isDataBusy
  ? [
      record(DataProduct, {
        _id: DATA.revenueProduct,
        projectId: new ObjectID(PROJECT_ID),
        name: "Finance daily revenue",
        ownerTeam: FINANCE_TEAM,
      }),
    ]
  : [];

/*
 * Every table the pages read, registered up front: a read of anything else
 * is recorded as unhandled and fails the spec.
 */
const TABLES = {
  // Who owns what Data Observability's Needs Attention names (data=busy).
  [tableName(DataAssetOwnerUser)]: dataAssetOwnerUsers,
  [tableName(DataAssetOwnerTeam)]: dataAssetOwnerTeams,
  [tableName(DataPipelineOwnerUser)]: [],
  [tableName(DataPipelineOwnerTeam)]: dataPipelineOwnerTeams,
  [tableName(DataProduct)]: dataProducts,
  [tableName(Monitor)]: monitors,
  [tableName(MonitorStatus)]: [OPERATIONAL, DEGRADED, OFFLINE],
  [tableName(MonitorOwnerUser)]: [],
  [tableName(MonitorOwnerTeam)]: [],
  [tableName(MonitorCustomField)]: [],
  [tableName(StatusPage)]: statusPages,
  [tableName(StatusPageOwnerUser)]: [],
  [tableName(StatusPageOwnerTeam)]: [],
  [tableName(StatusPageCustomField)]: [],
  [tableName(Label)]: [],
  [tableName(TableView)]: [],
  [tableName(Team)]: [],
  [tableName(TeamMember)]: [],
  // The Monitors menu's probe pages and its workspace (Slack, Teams) section.
  [tableName(Probe)]: [],
  [tableName(WorkspaceProjectAuthToken)]: [],
  // Data Observability's suggested databases nobody has dismissed.
  [tableName(RecommendationDismissal)]: [],
};

function rowsOf(modelType, verb) {
  const name = tableName(modelType);

  if (!(name in TABLES)) {
    fixture.unhandled.push({ kind: verb, modelName: name });
    return null;
  }

  return TABLES[name];
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/*
 * The query, matched as the server would: plain values must be equal (an
 * unset boolean is false), an id is its text, NotNull is any value, a
 * Search is a case-insensitive "contains", Includes is any of its values,
 * and an object of plain values filters on a relation (the Monitors menu's
 * Not Operational count: `currentMonitorStatus: { isOperationalState:
 * false }`). Anything else is recorded as unhandled.
 */
function matches(item, query) {
  for (const [field, wanted] of Object.entries(query || {})) {
    if (field === "projectId") {
      continue;
    }

    const value = item[field];

    if (wanted instanceof ObjectID) {
      if (idOf(value) !== wanted.toString()) {
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

    if (wanted instanceof Search) {
      if (
        !String(value || "")
          .toLowerCase()
          .includes(String(wanted.value || "").toLowerCase())
      ) {
        return false;
      }
      continue;
    }

    if (wanted instanceof Includes) {
      const values = wanted.values.map(idOf);
      if (!values.includes(idOf(value))) {
        return false;
      }
      continue;
    }

    if (isPlainObject(wanted)) {
      if (!value || !matches(value, wanted)) {
        return false;
      }
      continue;
    }

    if (
      typeof wanted === "boolean" ||
      typeof wanted === "string" ||
      typeof wanted === "number"
    ) {
      if ((value ?? false) !== wanted) {
        return false;
      }
      continue;
    }

    fixture.unhandled.push({
      kind: "query",
      field,
      wanted: serialize(wanted),
    });
    return false;
  }

  return true;
}

// A record as a fresh read gives it: never the instance the page drew before.
function copyOf(item, modelType) {
  return BaseModel.fromJSONObject(BaseModel.toJSON(item, modelType), modelType);
}

ModelAPI.getList = async (options) => {
  const items = rowsOf(options.modelType, "getList") || [];
  const found = items.filter((item) => {
    return matches(item, options.query);
  });
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 10);

  return {
    data: found.slice(skip, skip + limit).map((item) => {
      return copyOf(item, options.modelType);
    }),
    count: found.length,
    skip,
    limit,
  };
};

/*
 * How many records match, as the server counts them: what a product's
 * first page asks to decide whether to explain the product, and what the
 * side menu's badges show.
 */
ModelAPI.count = async (options) => {
  fixture.counts.push({
    modelName: tableName(options.modelType),
    query: serialize(options.query),
  });

  if (countsFail) {
    throw new HTTPErrorResponse(
      500,
      { message: "Something went wrong. Please try again." },
      {},
    );
  }

  const items = rowsOf(options.modelType, "count") || [];

  return items.filter((item) => {
    return matches(item, options.query);
  }).length;
};

ModelAPI.getItem = async (options) => {
  const items = rowsOf(options.modelType, "getItem") || [];
  const item = items.find((candidate) => {
    return idOf(candidate._id) === idOf(options.id);
  });

  return item ? copyOf(item, options.modelType) : null;
};

// A create, recorded as sent, and kept: the list reads it back.
async function create(options) {
  const name = tableName(options.modelType);
  const json = BaseModel.toJSON(options.model, options.modelType);

  fixture.creates.push({
    modelName: name,
    data: serialize(json),
    misc: serialize(options.miscDataProps || {}),
  });

  if (name !== tableName(StatusPage)) {
    fixture.unhandled.push({ kind: "create", modelName: name });
    throw new HTTPErrorResponse(400, { message: "Not modelled." }, {});
  }

  const created = BaseModel.fromJSONObject(json, StatusPage);
  created._id = NEW_STATUS_PAGE_ID;
  created.projectId = new ObjectID(PROJECT_ID);
  created.isArchived = false;
  created.createdAt = new Date("2026-11-02T09:30:00Z");
  TABLES[name].push(created);

  return new HTTPResponse(200, BaseModel.toJSON(created, StatusPage), {});
}

ModelAPI.createOrUpdate = create;
ModelAPI.create = create;

/*
 * Data Observability's own reads (Components/DataObservability/
 * DataObservabilityApi). With no data scenario, no database connected and
 * one its traces know of; data=busy, data=healthy and data=fail as the
 * header says. Times are relative to now, so "2 hours ago" reads true.
 */
function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function dataStore(id, name, kind, fields) {
  return {
    dataStoreId: id,
    name,
    kind,
    isTableHealthEnabled: true,
    collector: "OneUptime",
    probeName: null,
    status: "Collected",
    message: null,
    collectedAt: hoursAgo(0.1),
    assetCount: 0,
    lateAssetCount: 0,
    alertMonitorCount: 0,
    ...fields,
  };
}

function attentionItem(kind, name, fields) {
  return {
    kind,
    name,
    where: null,
    message: null,
    overdueBySeconds: 0,
    since: null,
    dataStoreId: null,
    dataAssetId: null,
    dataPipelineId: null,
    dataCheckId: null,
    dataProductId: null,
    dataReconciliationId: null,
    alert: null,
    ...fields,
  };
}

const BUSY_STORES = [
  dataStore(DATA.ordersDb, "orders-db", "PostgreSQL", {
    assetCount: 184,
    lateAssetCount: 2,
    alertMonitorCount: 6,
  }),
  dataStore(DATA.warehouse, "warehouse", "Snowflake", {
    assetCount: 1640,
    lateAssetCount: 7,
    alertMonitorCount: 0,
  }),
  dataStore(DATA.billingDb, "billing-db", "MySQL", {
    status: "Failed",
    message: "Access denied for user 'oneuptime_reader'@'10.0.4.12'",
    collectedAt: hoursAgo(2),
    alertMonitorCount: 2,
  }),
];

// The eight most urgent, worst first, as the server sends them.
const BUSY_ATTENTION = [
  attentionItem("Collection Failed", "billing-db", {
    message: "Access denied for user 'oneuptime_reader'@'10.0.4.12'",
    since: hoursAgo(2),
    dataStoreId: DATA.billingDb,
  }),
  attentionItem("Pipeline Failed", "nightly_orders_load", {
    where: "Airflow",
    message:
      'Task load_orders failed: relation "staging.orders" does not exist',
    since: hoursAgo(3),
    dataPipelineId: DATA.nightlyLoad,
    alert: {
      alertId: DATA.nightlyLoadAlert,
      number: "ALT-42",
      title: "nightly_orders_load failed",
    },
  }),
  attentionItem("Check Failing", "orders.email is never empty", {
    where: "public.orders",
    since: hoursAgo(1),
    dataStoreId: DATA.ordersDb,
    dataAssetId: DATA.orders,
    dataCheckId: DATA.ordersEmailCheck,
    alert: {
      alertId: DATA.ordersEmailAlert,
      number: "ALT-41",
      title: "orders.email is never empty failed",
    },
  }),
  attentionItem("Reconciliation Drifted", "orders vs warehouse.orders", {
    since: hoursAgo(5),
    dataReconciliationId: DATA.ordersReconciliation,
  }),
  // As the server sends one: since when, not by how much.
  attentionItem("Data Product Late", "Finance daily revenue", {
    since: hoursAgo(2),
    dataProductId: DATA.revenueProduct,
  }),
  attentionItem("Table Late", "analytics.daily_sessions", {
    where: "warehouse",
    overdueBySeconds: 26 * 60 * 60,
    since: hoursAgo(32),
    dataStoreId: DATA.warehouse,
    dataAssetId: DATA.dailySessions,
  }),
  attentionItem("Table Late", "public.payments", {
    where: "orders-db",
    overdueBySeconds: 3 * 60 * 60,
    since: hoursAgo(9),
    dataStoreId: DATA.ordersDb,
    dataAssetId: DATA.payments,
    alert: {
      alertId: DATA.paymentsAlert,
      number: "ALT-40",
      title: "public.payments is late",
    },
  }),
  attentionItem("Check Could Not Run", "customers has no duplicate ids", {
    where: "public.customers",
    message: 'column "customer_id" does not exist',
    since: hoursAgo(0.5),
    dataStoreId: DATA.ordersDb,
    dataAssetId: DATA.customers,
    dataCheckId: DATA.customersIdCheck,
  }),
];

function dataOverview() {
  if (dataScenario === "busy") {
    return {
      storeCount: 3,
      assetCount: 1824,
      lateAssetCount: 9,
      droppedAssetCount: 0,
      unusedAssetCount: 0,
      unusedSizeInBytes: 0,
      schemaChangeCount: 5,
      failingStoreCount: 1,
      lateAssets: [],
      recentChanges: [
        {
          dataAssetId: DATA.orders,
          assetKey: "public.orders",
          postedAt: hoursAgo(2),
          feedInfoInMarkdown: "Column **discount_code** was added (text).",
        },
      ],
      stores: BUSY_STORES,
      attention: BUSY_ATTENTION,
      attentionCount: 23,
      failingCheckCount: 3,
      // Alerts are off on the warehouse: the one step left.
      setup: {
        storeCount: 3,
        storesWithAlertsCount: 2,
        firstStoreWithoutAlertsId: DATA.warehouse,
        checkCount: 12,
        pipelineCount: 4,
        tableOwnerCount: 5,
        ownerRuleCount: 0,
      },
    };
  }

  if (dataScenario === "healthy") {
    return {
      storeCount: 1,
      assetCount: 184,
      lateAssetCount: 0,
      droppedAssetCount: 0,
      unusedAssetCount: 0,
      unusedSizeInBytes: 0,
      schemaChangeCount: 0,
      failingStoreCount: 0,
      lateAssets: [],
      recentChanges: [],
      stores: [BUSY_STORES[0]],
      attention: [],
      attentionCount: 0,
      failingCheckCount: 0,
      setup: {
        storeCount: 1,
        storesWithAlertsCount: 1,
        firstStoreWithoutAlertsId: null,
        checkCount: 12,
        pipelineCount: 4,
        tableOwnerCount: 5,
        ownerRuleCount: 1,
      },
    };
  }

  // Connected a minute ago: its catalog is not read yet, so it has no table and no status.
  if (dataScenario === "connected") {
    return {
      storeCount: 1,
      assetCount: 0,
      lateAssetCount: 0,
      droppedAssetCount: 0,
      unusedAssetCount: 0,
      unusedSizeInBytes: 0,
      schemaChangeCount: 0,
      failingStoreCount: 0,
      lateAssets: [],
      recentChanges: [],
      stores: [
        dataStore(DATA.ordersDb, "orders-db", "PostgreSQL", {
          status: null,
          collectedAt: null,
        }),
      ],
      attention: [],
      attentionCount: 0,
      failingCheckCount: 0,
      setup: {
        storeCount: 1,
        storesWithAlertsCount: 0,
        firstStoreWithoutAlertsId: DATA.ordersDb,
        checkCount: 0,
        pipelineCount: 0,
        tableOwnerCount: 0,
        ownerRuleCount: 0,
      },
    };
  }

  return { storeCount: 0 };
}

/*
 * A page of the scenario's issues, filtered as the server filters them
 * (DataObservabilityIssues): by kind, database, owner - "none" for the
 * ones nobody owns - and whether an alert is open.
 */
const ISSUE_OWNERS = isDataBusy
  ? [
      {
        key: `user:${ADA._id}`,
        kind: "user",
        id: ADA._id,
        name: "Ada Lovelace",
      },
      {
        key: `user:${GRACE._id}`,
        kind: "user",
        id: GRACE._id,
        name: "Grace Hopper",
      },
      {
        key: `team:${DATA_PLATFORM_TEAM._id}`,
        kind: "team",
        id: DATA_PLATFORM_TEAM._id,
        name: "Data Platform",
      },
      {
        key: `team:${PAYMENTS_TEAM._id}`,
        kind: "team",
        id: PAYMENTS_TEAM._id,
        name: "Payments",
      },
    ]
  : [];

// Who owns each issue, by its owner key, as the server reads them.
const ISSUE_OWNER_KEYS = {
  [`pipeline:${DATA.nightlyLoad}`]: [`team:${DATA_PLATFORM_TEAM._id}`],
  [`asset:${DATA.orders}`]: [
    `user:${ADA._id}`,
    `user:${GRACE._id}`,
    `team:${PAYMENTS_TEAM._id}`,
  ],
  [`asset:${DATA.payments}`]: [`team:${PAYMENTS_TEAM._id}`],
  [`asset:${DATA.customers}`]: [`user:${ADA._id}`],
  [`asset:${DATA.dailySessions}`]: [],
  [`product:${DATA.revenueProduct}`]: [`team:${FINANCE_TEAM._id}`],
};

function issueOwnerKey(item) {
  if (item.dataProductId) {
    return `product:${item.dataProductId}`;
  }
  if (item.dataPipelineId) {
    return `pipeline:${item.dataPipelineId}`;
  }
  if (item.dataAssetId) {
    return `asset:${item.dataAssetId}`;
  }
  return null;
}

function dataIssues(request) {
  const all = isDataBusy ? BUSY_ATTENTION : [];
  const kinds =
    Array.isArray(request.kinds) && request.kinds.length > 0
      ? request.kinds
      : null;
  const items = all.filter((item) => {
    if (kinds && !kinds.includes(item.kind)) {
      return false;
    }
    if (request.dataStoreId && item.dataStoreId !== request.dataStoreId) {
      return false;
    }
    if (request.alert === "open" && !item.alert) {
      return false;
    }
    if (request.alert === "none" && item.alert) {
      return false;
    }
    if (request.owner) {
      const key = issueOwnerKey(item);
      const owners = key ? ISSUE_OWNER_KEYS[key] : undefined;
      if (!owners) {
        return false;
      }
      return request.owner === "none"
        ? owners.length === 0
        : owners.includes(request.owner);
    }
    return true;
  });
  const skip = typeof request.skip === "number" ? request.skip : 0;
  const limit = typeof request.limit === "number" ? request.limit : 25;

  return {
    items: items.slice(skip, skip + limit),
    count: items.length,
    totalCount: all.length,
    skip,
    limit,
    stores: isDataBusy ? BUSY_STORES : [],
    owners: ISSUE_OWNERS,
  };
}

function dataObservabilityAnswer(url) {
  const routes = {
    "/data-observability/overview": dataOverview,
    // The menu's count beside Overview: the Overview's own (#6552).
    "/data-observability/attention/count": () => {
      return { count: dataOverview().attentionCount || 0 };
    },
    "/data-observability/issues": dataIssues,
    "/data-observability/quality": () => {
      return {};
    },
    // Not billed, so the page draws no cost line.
    "/data-observability/watched-tables": () => {
      return { isBilled: false };
    },
    "/data-observability/stores/suggestions": () => {
      return {
        suggestions: [
          {
            id: "traces:postgres:billing-db",
            dataStoreId: null,
            name: "billing-db",
            kind: "postgres",
            origin: "Traces",
            connectionExample: null,
          },
        ],
      };
    },
  };

  return Object.entries(routes).find(([route]) => {
    return url.endsWith(route);
  });
}

async function handleApi(method, options) {
  const url = options && options.url ? options.url.toString() : "";
  const answer = method === "POST" ? dataObservabilityAnswer(url) : undefined;

  if (answer) {
    fixture.dataReads.push(answer[0]);

    if (answer[0] === "/data-observability/issues") {
      fixture.issueRequests.push(serialize((options && options.data) || {}));
    }

    // An outage fails every read of what needs someone: the Overview and the menu's count.
    if (
      dataScenario === "fail" &&
      (answer[0] === "/data-observability/overview" ||
        answer[0] === "/data-observability/attention/count")
    ) {
      return new HTTPErrorResponse(
        500,
        { message: "Something went wrong. Please try again." },
        {},
      );
    }

    return new HTTPResponse(
      200,
      serialize(answer[1]((options && options.data) || {})),
      {},
    );
  }

  fixture.unhandled.push({
    kind: "api",
    method,
    url: options && options.url ? options.url.toString() : "",
  });
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

/*
 * The Dashboard looks every string up by its English text, so the
 * separators i18next reads in a key (the "." and ":" of a sentence) are
 * turned off, as the Dashboard's own setup does. <html lang> and <html dir>
 * follow the language through the production helper.
 */
followLanguageForPage(i18next);

/*
 * English, the fallback, is in the bundle; German and Persian are each a
 * chunk of its own, loaded only by a page drawn in that language, as the
 * Dashboard loads a locale (src/Utils/I18nLocaleLoader.ts), and built as the
 * Dashboard ships them (server.js, SuiteHelpers/FixtureLocalesBuild.js).
 * Imported whole, they were parsed on every page load of every test (#8366).
 */
const LOCALE_LOADERS = {
  de: () => {
    return import("../../../App/FeatureSet/Dashboard/src/Locales/de.json");
  },
  fa: () => {
    return import("../../../App/FeatureSet/Dashboard/src/Locales/fa.json");
  },
};

await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: "en",
  resources: await localeResources({
    language: language,
    english: EN,
    loaders: LOCALE_LOADERS,
  }),
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
// Dates in the reader's language ("vor 2 Stunden"), as Utils/i18n.ts sets them.
followLanguageForDates(i18next);

// ---- the pages ---------------------------------------------------------------

function Shell() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return (
    <>
      <header
        data-testid="fixture-header"
        className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-4 sm:px-6"
      >
        <div className="flex items-center gap-5">
          <span className="text-lg font-semibold text-gray-900">OneUptime</span>
          <span className="text-sm text-gray-500">Acme Shop</span>
        </div>
        <span data-testid="synthetic-banner" className="text-xs text-gray-500">
          Preview project · Synthetic data
        </span>
      </header>
      <Outlet />
    </>
  );
}

const pageProps = {
  currentProject: project,
  hasPaymentMethod: true,
};

// A page the lists lead to that is not modelled: says where it is.
function StubPage() {
  const location = useLocation();

  return (
    <main className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-xl font-semibold text-gray-900">Not modelled</h1>
      <p
        data-testid="stub-page"
        className="mt-2 break-all font-mono text-sm text-gray-600"
      >
        {location.pathname}
      </p>
    </main>
  );
}

/*
 * Every product's explanation, each as its How it works dialog draws it
 * (ProductAboutButton): the product's name over its showcase without a
 * frame of its own, in a box as wide as a large dialog's body (Modal's
 * ModalWidth.Large: the full width on a phone, at most max-w-7xl from sm
 * up, its body padded px-5 sm:px-6). The showcase lays itself out by its
 * own width, so it lays out here as it does in the dialog. One page holds
 * them all, so a test reads every product's words in one language and at
 * one width at once.
 */
function ExplanationsPage() {
  const translator = useTranslator();

  return (
    <main
      data-testid="product-explanations"
      className="mx-auto w-full max-w-7xl space-y-6 py-6 sm:px-6"
    >
      {Object.entries(PRODUCT_ONBOARDINGS).map(([product, onboarding]) => {
        return (
          <section
            key={product}
            data-testid="product-explanation"
            data-product={product}
            className="overflow-hidden border-y border-gray-200 bg-white shadow-sm sm:rounded-xl sm:border-x"
          >
            <div
              data-testid="product-explanation-name"
              className="border-b border-gray-100 px-5 py-4 text-base font-semibold leading-6 tracking-tight text-gray-900 [overflow-wrap:anywhere] sm:px-6"
            >
              {translator.translateText(onboarding.name)}
            </div>
            <div className="px-5 py-5 sm:px-6">
              <ResourceShowcaseCard
                showcase={onboarding.showcase}
                docsRoute={onboarding.docsRoute}
                isBare={true}
              />
            </div>
          </section>
        );
      })}
    </main>
  );
}

const MONITORS_ROUTE = RouteMap[PageMap.MONITORS].toString();
const STATUS_PAGES_ROUTE = RouteMap[PageMap.STATUS_PAGES].toString();
const DATA_OBSERVABILITY_ROUTE =
  RouteMap[PageMap.DATA_OBSERVABILITY_OVERVIEW].toString();
const DATA_OBSERVABILITY_ISSUES_ROUTE =
  RouteMap[PageMap.DATA_OBSERVABILITY_ISSUES].toString();
const EXPLANATIONS_ROUTE = "/dashboard/:projectId/product-explanations";

/*
 * Navigates as the Dashboard does (its src/Index.tsx): each navigation renders
 * at once, not in a React transition (Tests/Ops/E2EFixtureRouters).
 */
createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <Routes>
      <PageRoute element={<Shell />}>
        <PageRoute
          element={
            <MonitorLayout
              {...pageProps}
              pageRoute={RouteMap[PageMap.MONITORS]}
            />
          }
        >
          <PageRoute
            path={MONITORS_ROUTE}
            element={
              <MonitorsPage
                {...pageProps}
                pageRoute={RouteMap[PageMap.MONITORS]}
              />
            }
          />
        </PageRoute>
        <PageRoute
          element={
            <StatusPagesLayout
              {...pageProps}
              pageRoute={RouteMap[PageMap.STATUS_PAGES]}
            />
          }
        >
          <PageRoute
            path={STATUS_PAGES_ROUTE}
            element={
              <StatusPagesPage
                {...pageProps}
                pageRoute={RouteMap[PageMap.STATUS_PAGES]}
              />
            }
          />
        </PageRoute>
        <PageRoute
          element={
            <DataObservabilityLayout
              {...pageProps}
              pageRoute={RouteMap[PageMap.DATA_OBSERVABILITY_OVERVIEW]}
            />
          }
        >
          <PageRoute
            path={DATA_OBSERVABILITY_ROUTE}
            element={
              <DataObservabilityOverviewPage
                {...pageProps}
                pageRoute={RouteMap[PageMap.DATA_OBSERVABILITY_OVERVIEW]}
              />
            }
          />
          <PageRoute
            path={DATA_OBSERVABILITY_ISSUES_ROUTE}
            element={
              <DataObservabilityIssuesPage
                {...pageProps}
                pageRoute={RouteMap[PageMap.DATA_OBSERVABILITY_ISSUES]}
              />
            }
          />
        </PageRoute>
        <PageRoute path={EXPLANATIONS_ROUTE} element={<ExplanationsPage />} />
        <PageRoute path="*" element={<StubPage />} />
      </PageRoute>
    </Routes>
  </BrowserRouter>,
);

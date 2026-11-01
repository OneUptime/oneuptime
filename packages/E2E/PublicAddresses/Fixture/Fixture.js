/*
 * Offline fixture for the addresses a status page, a public dashboard or a
 * form answers at (Components/CustomDomain/PublicAddresses): a status page's
 * Overview, whose Status Page Link card lists them, a dashboard's Sharing
 * page, which lists them under its public choice, and a form's Share page,
 * whose Share Link card lists them.
 *
 * Only the ModelAPI/API data boundary and the synthetic user's permission
 * snapshot are replaced; the pages, cards, rows, the DNS Setup dialog and
 * the shared components they draw are the production ones from this branch.
 *
 * Pages (the path picks one):
 *   /dashboard/<project>/status-pages/<id>                     a status page's Overview
 *   /dashboard/<project>/dashboards/<id>/authentication-settings  a dashboard's Sharing page
 *   /dashboard/<project>/forms/<id>/share                      a form's Share page
 *   /dashboard/<project>/forms/<id>/custom-domains             a form's Custom Domains page
 *
 * Steered by the query string:
 *   - domains=<state>:<domain>;...  the custom domains, each where it is on
 *                     its way to HTTPS: live, dns, issuing, unordered,
 *                     failed, expired, uploaded or renewal
 *   - access=public|signin|password   who can see the status page
 *   - share=private|link|password     who can view the dashboard
 *   - enabled=0       the form is turned off (Accepting Submissions)
 *   - role=owner|viewer|noread        a project owner; a member who may read
 *                     everything here but change none of it; one who may
 *                     read the page but not its custom domains
 *   - fail=domains|certs              that read fails, as a server that
 *                     cannot be reached does
 *   - delay=<ms>      each custom domain read takes this long (30 ms
 *                     otherwise), to see the list while it loads
 *   - lang=de|ja|fa   the Dashboard's German, Japanese or Persian words
 *   - theme=dark, cname=0   (read by server.js) the dark theme; an
 *                     installation with no CNAME record
 *
 * Every read is recorded on `window.__fixture` (listRequests, itemRequests,
 * apiGets), and every read it does not model on `window.__fixture.unmodelled`
 * (the suite fails on any).
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
import StatusPageOverviewPage from "../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Index";
import DashboardSharingPage from "../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/View/Sharing";
import FormSharePage from "../../../App/FeatureSet/Dashboard/src/Pages/Forms/View/Share";
import FormCustomDomainsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Forms/View/CustomDomains";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import DashboardDomain from "Common/Models/DatabaseModels/DashboardDomain";
import Form from "Common/Models/DatabaseModels/Form";
import FormDomain from "Common/Models/DatabaseModels/FormDomain";
import Label from "Common/Models/DatabaseModels/Label";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageDomain from "Common/Models/DatabaseModels/StatusPageDomain";
import Color from "Common/Types/Color";
import CustomDomainCertificates from "Common/Types/CustomDomain/CustomDomainCertificates";
import HashedString from "Common/Types/HashedString";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import Route from "Common/Types/API/Route";
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
const STATUS_PAGE_ID = "30000000-0000-4000-8000-000000000001";
const DASHBOARD_ID = "40000000-0000-4000-8000-000000000001";
const FORM_ID = "50000000-0000-4000-8000-000000000001";
const FORM_SHARE_KEY = "0f8fad5b-d9cb-469f-a165-70867728950e";
const DAY = 24 * 60 * 60 * 1000;

const params = new URLSearchParams(window.location.search);
const role = params.get("role") || "owner";
const access = params.get("access") || "public";
const share = params.get("share") || "link";
const failing = params.get("fail") || "";
const delay = Number(params.get("delay") || 30);
const language = ["de", "ja", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

window.__fixture = {
  itemRequests: [],
  listRequests: [],
  apiGets: [],
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

function unreachable() {
  return new HTTPErrorResponse(
    500,
    {
      message:
        "We could not reach OneUptime. Check your connection and try again.",
    },
    {},
  );
}

const LABEL = (() => {
  const record = new Label();
  record._id = "20000000-0000-4000-8000-000000000001";
  record.projectId = new ObjectID(PROJECT_ID);
  record.name = "Customer facing";
  record.color = new Color("#6366f1");
  return record;
})();

const STATUS_PAGE = (() => {
  const record = new StatusPage();
  record._id = STATUS_PAGE_ID;
  record.projectId = new ObjectID(PROJECT_ID);
  record.name = "Acme Status";
  record.description = "Public status for checkout, payments and the API.";
  record.labels = [LABEL];
  record.isPublicStatusPage = access === "public";
  record.enableMasterPassword = access === "password";
  record.requireSsoForLogin = false;
  if (access === "password") {
    record.masterPassword = new HashedString("stored-hash", true);
  }
  return record;
})();

const DASHBOARD = (() => {
  const record = new Dashboard();
  record._id = DASHBOARD_ID;
  record.projectId = new ObjectID(PROJECT_ID);
  record.name = "Checkout health";
  record.isPublicDashboard = share !== "private";
  record.enableMasterPassword = share === "password";
  if (share === "password") {
    record.masterPassword = new HashedString("stored-hash", true);
  }
  return record;
})();

const FORM = (() => {
  const record = new Form();
  record._id = FORM_ID;
  record.projectId = new ObjectID(PROJECT_ID);
  record.name = "Report a problem";
  record.shareKey = new ObjectID(FORM_SHARE_KEY);
  record.isEnabled = params.get("enabled") !== "0";
  record.successMessage = "";
  record.ipWhitelist = "";
  return record;
})();

/*
 * The custom domains, from ?domains=<state>:<domain>;... - each row as its
 * table holds it, and its certificate as the certificates route answers.
 */
const domainSpecs = (params.get("domains") || "")
  .split(";")
  .map((spec) => {
    return spec.trim();
  })
  .filter((spec) => {
    return spec.includes(":");
  })
  .map((spec, index) => {
    const colon = spec.indexOf(":");
    return {
      id: `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      state: spec.slice(0, colon),
      fullDomain: spec.slice(colon + 1),
    };
  });

function domainRow(ModelType, parentColumn, parentId, spec) {
  const record = new ModelType();
  record._id = spec.id;
  record.projectId = new ObjectID(PROJECT_ID);
  record[parentColumn] = new ObjectID(parentId);
  record.fullDomain = spec.fullDomain;
  record.subdomain = spec.fullDomain.split(".")[0];
  record.isCnameVerified = spec.state !== "dns";
  record.isSslOrdered = !["dns", "unordered", "uploaded"].includes(spec.state);
  record.isSslProvisioned = ["live", "expired", "renewal"].includes(spec.state);
  record.isCustomCertificate = spec.state === "uploaded";
  return record;
}

function certificateOf(spec) {
  const now = Date.now();
  switch (spec.state) {
    case "live":
      return { domainId: spec.id, expiresAt: new Date(now + 60 * DAY) };
    case "issuing":
      return { domainId: spec.id };
    case "failed":
      return {
        domainId: spec.id,
        lastOrderError: "CAA record for acme.com forbids letsencrypt.org",
      };
    case "expired":
      return { domainId: spec.id, expiresAt: new Date(now - 2 * DAY) };
    case "renewal":
      return {
        domainId: spec.id,
        expiresAt: new Date(now + 10 * DAY),
        lastOrderError: "Timeout during connect",
      };
    default:
      return null;
  }
}

const RECORDS = {
  StatusPage: () => [STATUS_PAGE],
  Dashboard: () => [DASHBOARD],
  Label: () => [LABEL],
  StatusPageCustomField: () => [],
  StatusPageResource: () => (params.get("firststep") === "1" ? [] : [{}]),
  StatusPageDomain: () => {
    return domainSpecs.map((spec) => {
      return domainRow(StatusPageDomain, "statusPageId", STATUS_PAGE_ID, spec);
    });
  },
  DashboardDomain: () => {
    return domainSpecs.map((spec) => {
      return domainRow(DashboardDomain, "dashboardId", DASHBOARD_ID, {
        ...spec,
        fullDomain: spec.fullDomain.replace("status", "dashboard"),
      });
    });
  },
  Form: () => [FORM],
  // The Custom Domains table's saved views: none saved.
  TableView: () => [],
  FormDomain: () => {
    return domainSpecs.map((spec) => {
      return domainRow(FormDomain, "formId", FORM_ID, {
        ...spec,
        fullDomain: spec.fullDomain.replace("status", "report"),
      });
    });
  },
};

/*
 * A project owner; a member who may read everything here but change none
 * of it; or one who may read the status page and the dashboard but not
 * their custom domains.
 */
const heldPermissions =
  role === "viewer"
    ? [Permission.Viewer]
    : role === "noread"
      ? [
          Permission.ReadProjectStatusPage,
          Permission.ReadDashboard,
          Permission.ReadStatusPageResource,
        ]
      : [Permission.ProjectOwner];

UserUtil.isMasterAdmin = () => false;
UserUtil.getUserId = () => new ObjectID(USER_ID);
PermissionUtil.getAllPermissions = () => [
  ...heldPermissions,
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];
PermissionUtil.getProjectPermissions = () => ({
  _type: "UserTenantAccessPermission",
  projectId: new ObjectID(PROJECT_ID),
  permissions: heldPermissions.map((permission) => ({
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
    scope: PermissionScope.All,
  })),
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
ProjectUtil.getCurrentProject = () => null;
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

ModelAPI.getItem = async (options) => {
  const tableName = new options.modelType().tableName;
  const id = idOf(options.id);
  window.__fixture.itemRequests.push({
    tableName,
    id,
    select: Object.keys(options.select || {}),
  });
  await waitFor(20);
  const rows = RECORDS[tableName] ? RECORDS[tableName]() : null;
  if (!rows) {
    window.__fixture.unmodelled.push(`getItem ${tableName}`);
    return null;
  }
  return rows.find((record) => idOf(record._id) === id) || null;
};

ModelAPI.getList = async (options) => {
  const tableName = new options.modelType().tableName;
  window.__fixture.listRequests.push({
    tableName,
    query: Object.keys(options.query || {}).sort(),
    select: Object.keys(options.select || {}).sort(),
  });
  if (tableName.endsWith("Domain")) {
    await waitFor(delay);
    if (failing === "domains") {
      throw unreachable();
    }
  }
  const rows = RECORDS[tableName] ? RECORDS[tableName]() : null;
  if (!rows) {
    window.__fixture.unmodelled.push(`getList ${tableName}`);
    return { data: [], count: 0, skip: 0, limit: 10 };
  }
  return { data: rows, count: rows.length, skip: 0, limit: rows.length };
};

ModelAPI.count = async (options) => {
  const tableName = new options.modelType().tableName;
  const rows = RECORDS[tableName] ? RECORDS[tableName]() : null;
  if (!rows) {
    window.__fixture.unmodelled.push(`count ${tableName}`);
    return 0;
  }
  return rows.length;
};
ModelAPI.getCount = ModelAPI.count;

API.get = async (options) => {
  const url = String(options && options.url);
  window.__fixture.apiGets.push(url);
  if (url.includes("/certificates/")) {
    if (failing === "certs") {
      return unreachable();
    }
    return new HTTPResponse(
      200,
      CustomDomainCertificates.toJSON(
        domainSpecs.map(certificateOf).filter(Boolean),
      ),
      {},
    );
  }
  if (url.includes("/verify-cname/")) {
    await waitFor(200);
    return new HTTPResponse(200, { certificateStatus: "Issuing" }, {});
  }
  window.__fixture.unmodelled.push(`API.get ${url}`);
  return new HTTPResponse(200, {}, {});
};
API.post = async (options) => {
  window.__fixture.unmodelled.push(
    `API.post ${String(options && options.url)}`,
  );
  return new HTTPResponse(200, {}, {});
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

// What App.tsx does for every page: the router's hooks, handed to Navigation.
function Shell(props) {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      {props.children}
    </div>
  );
}

const PAGE_PROPS = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: true,
};

function Fixture() {
  return (
    <Routes>
      <PageRoute
        path="/dashboard/:projectId/status-pages/:id"
        element={
          <Shell>
            <StatusPageOverviewPage {...PAGE_PROPS} />
          </Shell>
        }
      />
      <PageRoute
        path="/dashboard/:projectId/dashboards/:id/authentication-settings"
        element={
          <Shell>
            <DashboardSharingPage {...PAGE_PROPS} />
          </Shell>
        }
      />
      <PageRoute
        path="/dashboard/:projectId/forms/:id/share"
        element={
          <Shell>
            <FormSharePage {...PAGE_PROPS} />
          </Shell>
        }
      />
      <PageRoute
        path="/dashboard/:projectId/forms/:id/custom-domains"
        element={
          <Shell>
            <FormCustomDomainsPage {...PAGE_PROPS} />
          </Shell>
        }
      />
    </Routes>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Fixture />
  </BrowserRouter>,
);

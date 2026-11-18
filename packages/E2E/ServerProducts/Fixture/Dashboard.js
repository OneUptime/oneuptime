/*
 * The Dashboard's side of products switched off on the server (#6815,
 * #7480), its production pages from this branch:
 *
 *   /dashboard/:projectId/status-pages   an address of a product switched
 *   /dashboard/:projectId/logs           off: ServerProductGate, as App.tsx
 *                                        draws it around every route, in
 *                                        place of the page
 *   /dashboard/:projectId/settings/products
 *                                        Project Settings > Products in the
 *                                        Settings layout, with the products
 *                                        off on the server listed as off
 *
 * Only the data boundary is replaced: the project's products answer (the
 * store's fetcher, as GET /api/project-products would answer it), API,
 * ModelAPI and the signed-in person. Every record is fabricated for an
 * "Acme Shop" project.
 *
 * Steered by the query string:
 *   - off=status-pages     Status Pages switched off by a server admin (the
 *                          default)
 *   - off=ingestion        telemetry ingestion stopped: Logs, Metrics,
 *                          Traces, Profiles and Exceptions off for that
 *                          reason
 *   - off=two              Status Pages and Kubernetes switched off
 *   - role=admin           the person is a master admin (the default is a
 *                          project owner who is not)
 *   - lang=de|fa           the Dashboard's German or Persian words (Persian
 *                          reads right to left)
 *   - theme=dark           dark mode (set before the bundle by server.js)
 *
 * Recorded on window.__serverProductsFixture: every request the fixture
 * does not model (unmodeled), which each spec expects to stay empty.
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
import { initReactI18next } from "react-i18next";
import ServerProductGate from "../../../App/FeatureSet/Dashboard/src/Components/ServerProducts/ServerProductGate";
import SettingsLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Settings/Layout";
import SettingsProducts from "../../../App/FeatureSet/Dashboard/src/Pages/Settings/Products";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import ProjectProducts from "../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProjectProductsStore";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import ProductKey from "Common/Types/Product/ProductKey";
import { ProductUsage } from "Common/Types/Product/ProductUsage";
import { getEmptyProjectProductsAnswer } from "Common/Types/Product/ProjectProductsAnswer";
import {
  ServerProductOffReason,
  TELEMETRY_INGESTION_PRODUCTS,
} from "Common/Types/Product/ServerProducts";
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { followLanguageForPage } from "Common/UI/Utils/PageLanguage";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import EN from "../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import { localeResources } from "../../SuiteHelpers/FixtureLocales";

export const PROJECT_ID = "10000000-0000-4000-8000-0000000000c7";
const PERSON_ID = "10000000-0000-4000-8000-0000000000c8";

const params = new URLSearchParams(window.location.search);

const language = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";
const offScene = ["ingestion", "two"].includes(params.get("off"))
  ? params.get("off")
  : "status-pages";
const isMasterAdmin = params.get("role") === "admin";

const record = { unmodeled: [] };
window.__serverProductsFixture = record;

// ---- what is off on the server -----------------------------------------------

function offOnServer() {
  if (offScene === "ingestion") {
    const off = {};

    for (const product of TELEMETRY_INGESTION_PRODUCTS) {
      off[product] = ServerProductOffReason.TelemetryIngestionStopped;
    }

    return off;
  }

  if (offScene === "two") {
    return {
      [ProductKey.StatusPages]: ServerProductOffReason.SwitchedOff,
      [ProductKey.Kubernetes]: ServerProductOffReason.SwitchedOff,
    };
  }

  return { [ProductKey.StatusPages]: ServerProductOffReason.SwitchedOff };
}

// The project's products, as GET /api/project-products answers a project owner.
const ANSWER = {
  ...getEmptyProjectProductsAnswer(),
  canChooseProducts: true,
  usage: {
    [ProductKey.Monitors]: ProductUsage.InUse,
    [ProductKey.Incidents]: ProductUsage.InUse,
    [ProductKey.OnCall]: ProductUsage.InUse,
    [ProductKey.Logs]: ProductUsage.NotSetUp,
    [ProductKey.Traces]: ProductUsage.NotSetUp,
  },
  offOnServer: offOnServer(),
};

ProjectProducts.setFetcher(async () => {
  return ANSWER;
});
ProjectProducts.setAnswer(PROJECT_ID, ANSWER);

// ---- the signed-in person --------------------------------------------------

const HELD = [Permission.ProjectOwner];
const GLOBAL_PERMISSIONS = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

UserUtil.isMasterAdmin = () => {
  return isMasterAdmin;
};
UserUtil.isLoggedIn = () => {
  return true;
};
UserUtil.getUserId = () => {
  return new ObjectID(PERSON_ID);
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

// Monitor groups are off in this project, as in a new one.
const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Shop",
  isFeatureFlagMonitorGroupsEnabled: false,
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

// ---- nothing else is asked ---------------------------------------------------

function tableOf(options) {
  return options && options.modelType
    ? new options.modelType().tableName
    : "unknown";
}

function notModelled(what, options) {
  record.unmodeled.push({
    what,
    url: String((options && options.url) || "").split("?")[0],
    table: options && options.modelType ? tableOf(options) : undefined,
  });
  return new HTTPErrorResponse(404, { message: "Not modelled." }, {});
}

for (const method of ["fetch", "get", "post", "put", "delete"]) {
  API[method] = async (options) => {
    return notModelled(method, options);
  };
}

ModelAPI.getItem = async (options) => {
  notModelled("getItem", options);
  return null;
};
ModelAPI.getList = async (options) => {
  notModelled("getList", options);
  return { data: [], count: 0, skip: 0, limit: options.limit || 10 };
};
ModelAPI.count = async (options) => {
  notModelled("count", options);
  return 0;
};
ModelAPI.updateById = async (options) => {
  notModelled("updateById", options);
  throw new Error("Not modelled.");
};

// ---- the language ------------------------------------------------------------

/*
 * <html lang> and <html dir> follow the language through the production
 * helper.
 */
followLanguageForPage(i18next);

/*
 * English, the fallback, is in the bundle; German and Persian are each a
 * chunk of its own, loaded only by a page drawn in that language, as the
 * Dashboard loads a locale (src/Utils/I18nLocaleLoader.ts), and built as the
 * Dashboard ships them (server.js, SuiteHelpers/FixtureLocalesBuild.js).
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
  /*
   * The separators stay i18next's own, as the Dashboard's src/Utils/i18n.ts
   * leaves them: a sentence is looked up whole by the translator, which
   * turns them off for each lookup (Common/UI/Utils/TranslateTemplate),
   * and the products menu's names are nested keys ("navbar.items.…").
   */
});
// Dates in the reader's language, as Utils/i18n.ts sets them.
followLanguageForDates(i18next);

// ---- the pages ---------------------------------------------------------------

const pageProps = {
  currentProject: project,
  hasPaymentMethod: false,
};

function Shell() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return <Outlet />;
}

// What the page would be, were its product on: the gate draws its own instead.
function ProductPage() {
  return <main data-testid="product-page">The product's page</main>;
}

/*
 * Navigates as the Dashboard does (its src/Index.tsx): each navigation renders
 * at once, not in a React transition (Tests/Ops/E2EFixtureRouters).
 */
createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <Routes>
      <PageRoute element={<Shell />}>
        <PageRoute
          path={RouteMap[PageMap.STATUS_PAGES].toString()}
          element={
            <ServerProductGate>
              <ProductPage />
            </ServerProductGate>
          }
        />
        <PageRoute
          path={RouteMap[PageMap.LOGS].toString()}
          element={
            <ServerProductGate>
              <ProductPage />
            </ServerProductGate>
          }
        />
        <PageRoute
          element={
            <SettingsLayout
              {...pageProps}
              pageRoute={RouteMap[PageMap.SETTINGS]}
            />
          }
        >
          <PageRoute
            path={RouteMap[PageMap.SETTINGS_PRODUCTS].toString()}
            element={
              <SettingsProducts
                {...pageProps}
                pageRoute={RouteMap[PageMap.SETTINGS_PRODUCTS]}
              />
            }
          />
        </PageRoute>
      </PageRoute>
    </Routes>
  </BrowserRouter>,
);

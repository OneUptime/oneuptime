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
import Layout from "../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/Layout";
import UserFlows from "../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/UserFlows";
import Recordings from "../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/SessionReplay";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import User from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";

/*
 * The production RUM layout and User Flows page with a synthetic storefront.
 * The page, the flow-map engine (Common/Utils/Rum/UserFlow.ts), the layout,
 * the tables and the URL state all run unchanged; only the API boundary and
 * the signed-in user are replaced.
 *
 * The data is deterministic - no randomness - so the spec can assert exact
 * numbers worked out by hand from the templates below:
 *
 *   A  40 x  /                                                   (bounce)
 *   B  50 x  / > /collections > /products/N > /cart > /checkout
 *             > /checkout/payment > /order/confirmed               (purchase)
 *   C  30 x  the same, but the payment page throws and they leave
 *   D  20 x  / > /search > /products/N > /search > /products/M   (loop)
 *   E  20 x  /products/N > /cart > /checkout                     (ad landing)
 *   F  16 x  / > /login > /account
 *   G  14 x  /collections > /products/N > /collections
 *             > /products/M > /cart                    (frustrated browsing)
 *   H  10 x  / > /help
 *
 * ?fixture=empty answers with no sessions, ?fixture=error with a 500.
 */

const params = new URLSearchParams(window.location.search);
const projectId = "10000000-0000-4000-8000-000000000001";
const appId = "20000000-0000-4000-8000-000000000001";
const origin = "https://shop.example.com";
const scenario = params.get("fixture") || "";
const now = Date.now();
const requests = [];

const templates = [
  { key: "A", count: 40, pages: ["/"] },
  {
    key: "B",
    count: 50,
    pages: [
      "/",
      "/collections",
      "/products/{id}",
      "/cart",
      "/checkout",
      "/checkout/payment",
      "/order/confirmed",
    ],
  },
  {
    key: "C",
    count: 30,
    pages: [
      "/",
      "/collections",
      "/products/{id}",
      "/cart/",
      "/checkout",
      "/checkout/payment",
    ],
    errorPage: "/checkout/payment",
  },
  {
    key: "D",
    count: 20,
    pages: ["/", "/search", "/products/{id}", "/search", "/products/{id2}"],
  },
  { key: "E", count: 20, pages: ["/products/{id}", "/cart", "/checkout"] },
  { key: "F", count: 16, pages: ["/", "/login", "/account"] },
  {
    key: "G",
    count: 14,
    pages: [
      "/collections",
      "/products/{id}",
      "/collections",
      "/products/{id2}",
      "/cart",
    ],
    frustrationPage: "/collections",
  },
  { key: "H", count: 10, pages: ["/", "/help"] },
];

const DEVICES = ["desktop", "mobile", "tablet"];

/* A session id that looks like the recorder's (32 hex), but reproducible. */
function sessionIdFor(position) {
  let hash = ((position + 1) * 2654435761) >>> 0;
  let id = "";
  for (let part = 0; part < 4; part++) {
    hash = Math.imul(hash ^ (hash >>> 15), 2246822519) >>> 0;
    hash = Math.imul(hash ^ (hash >>> 13), 3266489917) >>> 0;
    id += hash.toString(16).padStart(8, "0");
  }
  return id;
}

function buildResponse() {
  const pages = [];
  const indexOf = (path) => {
    const url = `${origin}${path}`;
    let index = pages.indexOf(url);
    if (index < 0) {
      index = pages.length;
      pages.push(url);
    }
    return index;
  };

  const sessions = [];
  let position = 0;

  for (const template of templates) {
    for (let copy = 0; copy < template.count; copy++) {
      const productId = 1001 + (position % 9);
      const otherProductId = 2001 + (position % 5);
      const path = template.pages.map((page) =>
        page
          .replace("{id2}", String(otherProductId))
          .replace("{id}", String(productId)),
      );
      const pageSignals = [];
      if (template.errorPage) {
        pageSignals.push([indexOf(template.errorPage), 1, 0]);
      }
      if (template.frustrationPage) {
        pageSignals.push([indexOf(template.frustrationPage), 0, 2]);
      }
      sessions.push({
        sessionId: sessionIdFor(position),
        startUnixMs: now - position * 60 * 1000,
        durationMs: 30000 + path.length * 15000,
        deviceType: DEVICES[position % 3],
        browserName: "Chrome",
        countryCode: "DK",
        errorCount: template.errorPage ? 1 : 0,
        frustrationCount: template.frustrationPage ? 2 : 0,
        pages: path.map(indexOf),
        pageSignals,
      });
      position++;
    }
  }

  return {
    pages,
    sessions,
    sessionsInWindow: sessions.length,
    isSampled: false,
    maxSessions: 5000,
    startUnixMs: now - 7 * 86400000,
    endUnixMs: now,
  };
}

const fixture = { requests, projectId, appId };
window.__userFlowFixture = fixture;

const app = Object.assign(new RumApplication(), {
  _id: appId,
  name: "Storefront Web",
  appIdentifier: "storefront-web",
  isSessionReplayEnabled: true,
});
const project = Object.assign(new Project(), {
  _id: projectId,
  name: "Commerce",
  sessionReplayEnabled: true,
});

User.isMasterAdmin = () => true;
User.getUserId = () => new ObjectID("30000000-0000-4000-8000-000000000001");
PermissionUtil.getAllPermissions = () => [Permission.ProjectOwner];
ProjectUtil.getCurrentProjectId = () => new ObjectID(projectId);
ProjectUtil.getCurrentProject = () => project;
ModelAPI.getCommonHeaders = () => ({ tenantid: projectId });
ModelAPI.getItem = async (options) =>
  options.modelType === Project ? project : app;
ModelAPI.getList = async () => ({ data: [], count: 0, skip: 0, limit: 50 });
ModelAPI.getCount = async () => 0;
ModelAPI.count = async () => 0;

API.get = async () => new HTTPResponse(200, { data: [], count: 0 }, {});
API.post = async ({ url, data }) => {
  const route = url.toString().split("/session-replay/")[1] || "";
  requests.push({ route, data });
  if (route === "user-flow") {
    if (scenario === "error") {
      return new HTTPErrorResponse(
        500,
        { message: "ClickHouse is not reachable" },
        {},
      );
    }
    if (scenario === "empty") {
      return new HTTPResponse(
        200,
        {
          pages: [],
          sessions: [],
          sessionsInWindow: 0,
          isSampled: false,
          maxSessions: 5000,
          startUnixMs: 0,
          endUnixMs: 0,
        },
        {},
      );
    }
    return new HTTPResponse(200, buildResponse(), {});
  }
  if (route === "list") {
    return new HTTPResponse(200, { sessions: [], nextCursor: null }, {});
  }
  if (route === "ingest-status") {
    return new HTTPResponse(
      200,
      {
        isProjectAllowed: true,
        isApplicationEnabled: true,
        appIdentifier: "storefront-web",
        allowedOrigins: [origin],
        samplePercentage: 100,
        lastChunkReceivedAt: new Date(now - 30000).toISOString(),
        lastSessionStartedAt: new Date(now - 60000).toISOString(),
        sessionsLast24h: 200,
        playableSessionsLast24h: 200,
        refusalsLast24h: [],
        dropsLast24h: [],
        recorderCapabilities: [],
      },
      {},
    );
  }
  return new HTTPResponse(200, { data: [], count: 0 }, {});
};

await i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
});

function FixtureLayout() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  return <Layout />;
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-6 py-4">
      <div className="flex items-center gap-5">
        <span className="text-lg font-semibold text-gray-900">OneUptime</span>
        <span className="text-sm text-gray-500">Commerce</span>
      </div>
      <span className="text-xs text-gray-500">
        Preview workspace · Synthetic sessions
      </span>
    </header>
    <Routes>
      <Route path="/dashboard/:projectId/rum/:id" element={<FixtureLayout />}>
        <Route path="user-flows" element={<UserFlows />} />
        <Route path="session-replay" element={<Recordings />} />
      </Route>
    </Routes>
  </BrowserRouter>,
);

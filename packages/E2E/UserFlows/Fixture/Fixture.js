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
import Users from "../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/SessionReplayUsers";
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
 * ?fixture=empty answers with no sessions, ?fixture=error with a 500, and
 * ?fixture=unfiltered ignores a filter, as a server older than the page does.
 *
 * A read narrowed to one person or session answers from the people below
 * instead. Their sessions are not in the 200 above, which is the point: the
 * page has to ask the server for them.
 *
 *   jane     jane@example.com, three sessions:
 *              desktop  / > /collections > /products/1001 > /collections
 *                       > /products/1002 > /cart > /checkout/payment (2 errors)
 *              desktop  /login > /account (3 frustration signals on /account)
 *              mobile   /  (no recording: finalized with nothing stored)
 *   carol    carol@example.com, one session, and not in the list of people:
 *            only her reference finds her.
 *   hidden   the same key shape, for a role that may not read the label.
 *   visitor  an anonymous browser, one session.
 *   orphan   a session linked to nobody.
 *   long     100 pages and more: cut short by the read.
 *   denied@example.com is refused, as for a role without identity.
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

const janeKey = "a".repeat(64);
const hiddenKey = "b".repeat(64);
const carolKey = "e".repeat(64);
const visitorId = "0123456789abcdef0123456789abcdef";
const janeSession = "c0000000000000000000000000000001";
const janeSecondSession = "c0000000000000000000000000000002";
const janeUnrecordedSession = "c0000000000000000000000000000003";
const visitorSession = "c0000000000000000000000000000004";
const orphanSession = "c0000000000000000000000000000005";
const longSession = "c0000000000000000000000000000006";
const hiddenSession = "c0000000000000000000000000000007";

const scopedSessions = {
  [janeSession]: {
    deviceType: "desktop",
    minutesAgo: 30,
    pages: [
      "/",
      "/collections",
      "/products/1001",
      "/collections",
      "/products/1002",
      "/cart",
      "/checkout/payment",
    ],
    errorCount: 2,
    errorPage: "/checkout/payment",
  },
  [janeSecondSession]: {
    deviceType: "desktop",
    minutesAgo: 90,
    pages: ["/login", "/account"],
    frustrationCount: 3,
    frustrationPage: "/account",
  },
  [janeUnrecordedSession]: {
    deviceType: "mobile",
    minutesAgo: 240,
    pages: ["/"],
    hasRecording: false,
  },
  [visitorSession]: {
    deviceType: "tablet",
    minutesAgo: 10,
    pages: ["/", "/help"],
  },
  [orphanSession]: { deviceType: "desktop", minutesAgo: 5, pages: ["/help"] },
  [hiddenSession]: { deviceType: "desktop", minutesAgo: 15, pages: ["/cart"] },
  [longSession]: {
    deviceType: "desktop",
    minutesAgo: 3,
    pages: Array.from({ length: 100 }, (_, index) => `/step/${index}`),
    isTruncated: true,
  },
};

function journeysOf(sessionIds, scope) {
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

  const sessions = sessionIds.map((sessionId) => {
    const session = scopedSessions[sessionId];
    const pageSignals = [];
    if (session.errorPage) {
      pageSignals.push([indexOf(session.errorPage), session.errorCount, 0]);
    }
    if (session.frustrationPage) {
      pageSignals.push([
        indexOf(session.frustrationPage),
        0,
        session.frustrationCount,
      ]);
    }
    return {
      sessionId,
      startUnixMs: now - session.minutesAgo * 60 * 1000,
      durationMs: 30000 + session.pages.length * 15000,
      deviceType: session.deviceType,
      browserName: "Chrome",
      countryCode: "DK",
      errorCount: session.errorCount || 0,
      frustrationCount: session.frustrationCount || 0,
      pages: session.pages.map(indexOf),
      pageSignals,
      hasRecording: session.hasRecording !== false,
      ...(session.isTruncated ? { isTruncated: true } : {}),
    };
  });

  return {
    pages,
    sessions,
    sessionsInWindow: sessions.length,
    isSampled: false,
    maxSessions: 5000,
    startUnixMs: now - 7 * 86400000,
    endUnixMs: now,
    scope,
  };
}

function scope(overrides) {
  return {
    kind: "user",
    identifiedUserKey: "",
    visitorId: "",
    sessionId: "",
    ...overrides,
  };
}

const jane = {
  identifiedUserKey: janeKey,
  identifiedUserLabel: "jane@example.com",
};

function scopedResponse(filters) {
  if (
    filters.identifiedUserKey === janeKey ||
    filters.identifiedUserRef === "jane@example.com"
  ) {
    return journeysOf(
      [janeSession, janeSecondSession, janeUnrecordedSession],
      scope(jane),
    );
  }
  if (
    filters.identifiedUserKey === carolKey ||
    filters.identifiedUserRef === "carol@example.com"
  ) {
    return journeysOf(
      [visitorSession],
      scope({
        identifiedUserKey: carolKey,
        identifiedUserLabel: "carol@example.com",
      }),
    );
  }
  if (filters.identifiedUserKey === hiddenKey) {
    return journeysOf([hiddenSession], scope({ identifiedUserKey: hiddenKey }));
  }
  if (filters.visitorId === visitorId) {
    return journeysOf([visitorSession], scope({ kind: "visitor", visitorId }));
  }
  if (filters.identifiedUserRef || filters.identifiedUserKey) {
    return journeysOf(
      [],
      scope({ identifiedUserKey: "f".repeat(64), identifiedUserLabel: "" }),
    );
  }
  if (filters.sessionId === janeSession) {
    return journeysOf(
      [janeSession],
      scope({ ...jane, kind: "session", sessionId: janeSession, visitorId }),
    );
  }
  if (filters.sessionId === visitorSession) {
    return journeysOf(
      [visitorSession],
      scope({ kind: "session", sessionId: visitorSession, visitorId }),
    );
  }
  if (filters.sessionId === orphanSession) {
    return journeysOf(
      [orphanSession],
      scope({ kind: "session", sessionId: orphanSession }),
    );
  }
  if (filters.sessionId === longSession) {
    return journeysOf(
      [longSession],
      scope({ kind: "session", sessionId: longSession }),
    );
  }
  return journeysOf(
    [],
    scope({ kind: "session", sessionId: filters.sessionId }),
  );
}

const users = [
  {
    groupKey: `u:${janeKey}`,
    kind: "identified",
    identifiedUserKey: janeKey,
    visitorId: "",
    identifiedUserLabel: "jane@example.com",
    identifiedUserTraits: {},
    sessionCount: 3,
    lastSeenUnixMs: now - 30 * 60 * 1000,
    firstSeenUnixMs: now - 240 * 60 * 1000,
    lastSessionId: janeSession,
    totalDurationMs: 200000,
    errorCount: 2,
    errorSessionCount: 1,
    frustrationCount: 3,
    pageCount: 10,
    browserName: "Chrome",
    deviceType: "desktop",
    countryCode: "DK",
  },
  {
    groupKey: `v:${visitorId}`,
    kind: "visitor",
    identifiedUserKey: "",
    visitorId,
    identifiedUserLabel: "",
    identifiedUserTraits: {},
    sessionCount: 1,
    lastSeenUnixMs: now - 10 * 60 * 1000,
    firstSeenUnixMs: now - 10 * 60 * 1000,
    lastSessionId: visitorSession,
    totalDurationMs: 60000,
    pageCount: 2,
    browserName: "Chrome",
    deviceType: "tablet",
    countryCode: "DK",
  },
  {
    groupKey: "",
    kind: "anonymous",
    identifiedUserKey: "",
    visitorId: "",
    identifiedUserLabel: "",
    identifiedUserTraits: {},
    sessionCount: 4,
    lastSeenUnixMs: now - 60 * 60 * 1000,
    firstSeenUnixMs: now - 600 * 60 * 1000,
    lastSessionId: orphanSession,
    totalDurationMs: 300000,
    pageCount: 8,
  },
];

const fixture = {
  requests,
  projectId,
  appId,
  janeKey,
  hiddenKey,
  visitorId,
  janeSession,
  janeSecondSession,
  janeUnrecordedSession,
  visitorSession,
  orphanSession,
  longSession,
};
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
    if (data.filters && scenario !== "unfiltered") {
      if (data.filters.identifiedUserRef === "denied@example.com") {
        return new HTTPErrorResponse(
          400,
          {
            message:
              "Your role cannot read end-user identity, so it cannot look a user up by their reference. Pick them from the list of users instead, or ask a project admin for the session replay identity permission.",
          },
          {},
        );
      }
      return new HTTPResponse(200, scopedResponse(data.filters), {});
    }
    return new HTTPResponse(200, buildResponse(), {});
  }
  if (route === "users") {
    return new HTTPResponse(200, { users, nextCursor: null }, {});
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

/*
 * Navigates as the Dashboard does (its src/Index.tsx): each navigation renders
 * at once, not in a React transition (Tests/Ops/E2EFixtureRouters).
 */
createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
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
        <Route path="session-replay-users" element={<Users />} />
      </Route>
    </Routes>
  </BrowserRouter>,
);

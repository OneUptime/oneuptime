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
import Recordings from "../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/SessionReplay";
import Recording from "../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/SessionReplayView";
import ReplayUsers from "../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/SessionReplayUsers";
import Documentation from "../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/Documentation";
import ReplayPolicy from "../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/SessionReplaySettings";
import ReplayAccessLog from "../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/SessionReplayAudit";
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

// Actual routed pages, shared components, manifest parsing, binary chunk decoding,
// and the lazy rrweb Replayer all execute. Only API/user boundaries are replaced.
const params = new URLSearchParams(window.location.search);
const projectId = "10000000-0000-4000-8000-000000000001";
const appId = "20000000-0000-4000-8000-000000000001";
const sessionId = "a".repeat(32);
const tabId = "b".repeat(32);
const secondTabId = "c".repeat(32);
const empty = params.get("fixture") === "empty";
const now = Date.now();
const started = now - 7 * 60 * 1000;
const count = empty ? 0 : Number(params.get("count") || 8);
const requests = [];
const fixture = {
  requests,
  failList: params.get("fixture") === "error",
  sessionId,
  tabId,
  projectId,
  appId,
};
window.__sessionReplayFixture = fixture;
const app = Object.assign(new RumApplication(), {
  _id: appId,
  name: "Storefront Web",
  appIdentifier: "storefront-web",
  sessionReplayEnabled: true,
  sessionReplayAllowedOrigins: ["https://shop.example.com"],
  sessionReplaySamplePercentage: 100,
  sessionReplayCaptureTrigger: "Always",
  sessionReplayMaskingMode: "MaskInputsOnly",
  sessionReplayRetentionInDays: 30,
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
ModelAPI.updateById = async () => app;
// One visitor id per browser; the two anonymous rows share one so the list
// and the Users page can show "the same browser came back".
const visitorIds = [
  "7f3a2b1c9d8e4f5a6b7c8d9e0f1a2b3c",
  "1a2b3c4d5e6f708192a3b4c5d6e7f809",
  "9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b",
  "5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a09",
];
// ?identity=none: no row is identified, so the list shows the "call
// identify()" nudge and every user cell reads "Visitor ..." - the shape of
// the customer's screenshots in #3705.
const isAnonymousFixture = params.get("identity") === "none";
const records = Array.from({ length: count }, (_, index) => {
  const startTimeUnixMs = started - index * 75 * 1000;
  const hasError = index % 3 === 0;
  const identifiedUserLabel = isAnonymousFixture
    ? ""
    : ["alex@example.com", "jordan@example.com", "", "morgan@example.com"][
        index % 4
      ];
  return {
    sessionId:
      index === 0 ? sessionId : (index + 1).toString(16).padStart(32, "0"),
    startTimeUnixMs,
    startTime: new Date(startTimeUnixMs).toISOString(),
    endTime: new Date(startTimeUnixMs + 90000 + index * 7000).toISOString(),
    durationMs: 90000 + index * 7000,
    activeMs: 69000 + index * 2000,
    chunkCount: index === 7 ? 0 : 3,
    missingChunkCount: index === 5 ? 1 : 0,
    eventCount: 86 + index * 14,
    payloadBytes: 346720,
    isFinalized: index !== 2,
    sealedReason: index === 2 ? "" : "idle-timeout",
    hasError,
    errorCount: hasError ? index + 1 : 0,
    firstErrorOffsetMs: hasError ? 12000 : undefined,
    rageClickCount: index === 0 || index === 4 ? 2 : 0,
    deadClickCount: index === 4 ? 1 : 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    pageCount: 3 + index,
    clickCount: 9 + index * 2,
    traceCount: index % 2 === 0 ? 4 : 0,
    triggerReason: hasError ? "error" : index === 4 ? "frustration" : "sampled",
    entryUrl: "https://shop.example.com/collections",
    exitUrl:
      index % 2
        ? "https://shop.example.com/cart"
        : "https://shop.example.com/checkout",
    routes:
      index % 2
        ? ["/collections", "/products/linen-shirt", "/cart"]
        : ["/collections", "/cart", "/checkout"],
    browserName: ["Chrome", "Safari", "Firefox"][index % 3],
    browserVersion: "131.0",
    osName: ["macOS", "iOS", "Windows"][index % 3],
    deviceType: index % 3 === 1 ? "mobile" : "desktop",
    countryCode: ["GB", "US", "DE"][index % 3],
    identifiedUserLabel,
    identifiedUserKey: identifiedUserLabel
      ? `k-${identifiedUserLabel.split("@")[0]}`
      : "",
    visitorId: visitorIds[index % 4],
    identifiedUserTraits:
      index % 4 === 2 ? {} : { plan: "Pro", account: "Commerce" },
    tags: { release: "2026.09.11", environment: "production" },
    maskingMode: "MaskInputsOnly",
    fidelityNotices: [],
    expiresAtUnixMs: now + 29 * 86400000,
  };
});
const health = {
  isProjectAllowed: true,
  isApplicationEnabled: true,
  appIdentifier: "storefront-web",
  allowedOrigins: ["https://shop.example.com"],
  samplePercentage: 100,
  captureTrigger: "Always",
  consentMode: "Implicit",
  maskingMode: "MaskInputsOnly",
  retentionInDays: 30,
  publishedRecorderVersion: "13.0.0",
  lastChunkReceivedAt: empty ? null : new Date(now - 30000).toISOString(),
  lastConfigFetchAt: empty ? null : new Date(now - 45000).toISOString(),
  lastSessionStartedAt: empty ? null : new Date(started).toISOString(),
  sessionsLast24h: count,
  playableSessionsLast24h: count,
  refusalsLast24h: [],
  dropsLast24h: [],
  projectBytesUsedToday: 24000000,
  dailyByteLimit: 1073741824,
  applicationBytesUsedThisMonth: 120000000,
  monthlyBudgetInGB: null,
  budgetExceededAt: null,
  recorderCapabilities: [
    "click",
    "console",
    "network",
    "route",
    "error",
    "frustration",
  ],
};
function listMatches(row, filters) {
  if (filters.hasError && !row.hasError) return false;
  if (filters.hasFrustration && !row.rageClickCount && !row.deadClickCount)
    return false;
  if (filters.hasIdentifiedUser && !row.identifiedUserLabel) return false;
  if (filters.isFinalized === false && row.isFinalized) return false;
  if (filters.hasTraces && !row.traceCount) return false;
  if (filters.isPlayable && !row.chunkCount) return false;
  for (const key of [
    "browserName",
    "osName",
    "deviceType",
    "countryCode",
    "triggerReason",
  ]) {
    if (filters[`${key}s`] && !filters[`${key}s`].includes(row[key]))
      return false;
  }
  if (
    filters.identifiedUserRef &&
    !row.identifiedUserLabel.includes(filters.identifiedUserRef)
  )
    return false;
  // The digest goes only without a reference (the server ignores it beside one).
  if (
    !filters.identifiedUserRef &&
    filters.identifiedUserKey &&
    row.identifiedUserKey !== filters.identifiedUserKey
  )
    return false;
  if (filters.visitorId && row.visitorId !== filters.visitorId) return false;
  if (
    filters.search &&
    !JSON.stringify(row).toLowerCase().includes(filters.search.toLowerCase())
  )
    return false;
  if (filters.minDurationMs && row.durationMs < filters.minDurationMs)
    return false;
  if (
    filters.urlPrefix &&
    !row.routes.some((route) => route.includes(filters.urlPrefix))
  )
    return false;
  return true;
}
function listResult(data) {
  if (fixture.failList)
    throw new HTTPErrorResponse(
      503,
      { message: "The recordings service is unavailable." },
      {},
    );
  let result = records.filter((row) => listMatches(row, data.filters || {}));
  const sort = data.sortBy;
  result = [...result].sort((a, b) =>
    sort === "durationMs"
      ? b.durationMs - a.durationMs
      : sort === "errorCount"
        ? b.errorCount - a.errorCount
        : b.startTimeUnixMs - a.startTimeUnixMs,
  );
  if (data.cursor) {
    const position = result.findIndex(
      (row) => row.sessionId === data.cursor.sessionId,
    );
    result = result.slice(position + 1);
  }
  const page = result.slice(0, data.limit || 20);
  const last = page[page.length - 1];
  return {
    sessions: page,
    nextCursor:
      result.length > page.length
        ? { sessionId: last.sessionId, startTimeUnixMs: last.startTimeUnixMs }
        : null,
    ignoredFilters: [],
  };
}
// The /users rollup, as the server does it: one row per identified user
// ("u:<key>"), one per visitor ("v:<visitorId>"), one anonymous bucket ("")
// for rows with neither, newest last-seen first, keyset paged by
// {lastSeenUnixMs, groupKey}.
function usersResult(data) {
  if (fixture.failList)
    throw new HTTPErrorResponse(
      503,
      { message: "The recordings service is unavailable." },
      {},
    );
  const groups = new Map();
  for (const row of records) {
    const groupKey = row.identifiedUserKey
      ? `u:${row.identifiedUserKey}`
      : row.visitorId
        ? `v:${row.visitorId}`
        : "";
    const existing = groups.get(groupKey);
    const frustration =
      row.rageClickCount +
      row.deadClickCount +
      row.errorClickCount +
      row.refreshRageCount;
    if (!existing) {
      groups.set(groupKey, {
        groupKey,
        kind: row.identifiedUserKey
          ? "identified"
          : row.visitorId
            ? "visitor"
            : "anonymous",
        identifiedUserKey: row.identifiedUserKey,
        visitorId: row.visitorId,
        identifiedUserLabel: row.identifiedUserLabel,
        identifiedUserTraits: row.identifiedUserTraits,
        sessionCount: 1,
        liveSessionCount: row.isFinalized ? 0 : 1,
        firstSeenUnixMs: row.startTimeUnixMs,
        lastSeenUnixMs: row.startTimeUnixMs,
        totalDurationMs: row.durationMs,
        errorCount: row.errorCount,
        frustrationCount: frustration,
        errorSessionCount: row.errorCount > 0 ? 1 : 0,
        pageCount: row.pageCount,
        lastSessionId: row.sessionId,
        lastEntryUrl: row.entryUrl,
        browserName: row.browserName,
        browserVersion: row.browserVersion,
        osName: row.osName,
        deviceType: row.deviceType,
        countryCode: row.countryCode,
      });
      continue;
    }
    existing.sessionCount += 1;
    existing.liveSessionCount += row.isFinalized ? 0 : 1;
    existing.firstSeenUnixMs = Math.min(
      existing.firstSeenUnixMs,
      row.startTimeUnixMs,
    );
    existing.totalDurationMs += row.durationMs;
    existing.errorCount += row.errorCount;
    existing.frustrationCount += frustration;
    existing.errorSessionCount += row.errorCount > 0 ? 1 : 0;
    existing.pageCount += row.pageCount;
    if (row.startTimeUnixMs > existing.lastSeenUnixMs) {
      existing.lastSeenUnixMs = row.startTimeUnixMs;
      existing.lastSessionId = row.sessionId;
      existing.lastEntryUrl = row.entryUrl;
      existing.browserName = row.browserName;
      existing.browserVersion = row.browserVersion;
      existing.osName = row.osName;
      existing.deviceType = row.deviceType;
      existing.countryCode = row.countryCode;
    }
  }
  let result = [...groups.values()].sort(
    (a, b) =>
      b.lastSeenUnixMs - a.lastSeenUnixMs ||
      a.groupKey.localeCompare(b.groupKey),
  );
  if (data.cursor) {
    const position = result.findIndex(
      (row) => row.groupKey === data.cursor.groupKey,
    );
    result = result.slice(position + 1);
  }
  const page = result.slice(0, data.limit || 50);
  const last = page[page.length - 1];
  return {
    users: page,
    nextCursor:
      result.length > page.length
        ? { lastSeenUnixMs: last.lastSeenUnixMs, groupKey: last.groupKey }
        : null,
  };
}
const manifestChunks = Array.from({ length: 3 }, (_, index) => ({
  chunkIndex: index,
  tabId,
  chunkStartOffsetMs: index * 30000,
  chunkEndOffsetMs: (index + 1) * 30000,
  eventCount: 22,
  hasFullSnapshot: true,
  payloadBytes: 22000,
  errorCount: index === 0 ? 1 : 0,
  rageClickCount: index === 1 ? 1 : 0,
  deadClickCount: 0,
  errorClickCount: 0,
  refreshRageCount: 0,
  routeCount: 1,
  clickCount: 4,
  url: "https://shop.example.com/checkout",
}));
API.get = async () => new HTTPResponse(200, { data: [], count: 0 }, {});
API.post = async ({ url, data }) => {
  const route = url.toString().split("/session-replay/")[1];
  requests.push({ route, data });
  if (route === "list") return new HTTPResponse(200, listResult(data), {});
  if (route === "users") return new HTTPResponse(200, usersResult(data), {});
  if (route === "ingest-status") return new HTTPResponse(200, health, {});
  if (route === "manifest") {
    const row =
      records.find((item) => item.sessionId === data.sessionId) || records[0];
    return new HTTPResponse(
      200,
      {
        viewId: "40000000-0000-4000-8000-000000000001",
        header: {
          ...row,
          durationMs: 90000,
          consentState: "Granted",
          recorderVersion: "13.0.0",
          rrwebVersion: "2.0.0",
          viewportWidth: 1200,
          viewportHeight: 760,
          recorderCapabilities: health.recorderCapabilities,
          traceIds: [],
          exceptionFingerprints: [],
        },
        tabs: [
          { tabId, chunks: manifestChunks, gaps: [] },
          ...(params.get("tabs") === "multiple"
            ? [
                {
                  tabId: secondTabId,
                  chunks: manifestChunks.map((chunk) => ({
                    ...chunk,
                    tabId: secondTabId,
                  })),
                  gaps: [],
                },
                { tabId: "d".repeat(32), chunks: [], gaps: [] },
              ]
            : []),
        ],
        isChunkIndexTruncated: false,
      },
      {},
    );
  }
  if (route === "views")
    return new HTTPResponse(200, { views: [], nextCursor: null }, {});
  return new HTTPResponse(200, { data: [], count: 0 }, {});
};

let nodeId;
function textNode(textContent) {
  return { type: 3, id: nodeId++, textContent };
}
function element(tagName, attributes, children = []) {
  return { type: 2, id: nodeId++, tagName, attributes, childNodes: children };
}
function snapshot() {
  nodeId = 10;
  const css = `*{box-sizing:border-box}body{margin:0;background:#f6f7f9;color:#192132;font:16px -apple-system,BlinkMacSystemFont,sans-serif}header{background:white;padding:26px 52px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between}.brand{font-size:22px;font-weight:750;letter-spacing:3px}main{max-width:1080px;margin:38px auto;display:grid;grid-template-columns:1fr 360px;gap:28px}section,aside{background:white;border:1px solid #e3e6eb;border-radius:12px;padding:30px}h1{font-size:28px;margin:0 0 8px}h2{font-size:19px;margin:0 0 20px}.muted{color:#6b7280;font-size:14px}.field{border:1px solid #d1d5db;border-radius:7px;padding:14px;margin:9px 0 18px;background:#fafbfc}.label{font-size:13px;font-weight:600;margin-top:14px}.total{display:flex;justify-content:space-between;margin:20px 0}.product{padding:20px 0;border-bottom:1px solid #eee}button{width:100%;padding:16px;background:#292524;color:white;border:0;border-radius:7px;font-size:15px;font-weight:600}.notice{margin-top:18px;padding:13px;background:#fff7ed;color:#9a3412;border-radius:6px;font-size:13px}.steps{margin:22px 0;color:#78716c;font-size:13px}.swatch{background:#d6cfbf;width:50px;height:60px;float:left;border-radius:4px;margin-right:16px}`;
  const field = (label) =>
    element("div", {}, [
      element("div", { class: "label" }, [textNode(label)]),
      element("div", { class: "field" }, [textNode("••••••••••••••••")]),
    ]);
  const clockText = { type: 3, id: 7, textContent: "Reviewing order · 0:00" };
  const body = element("body", {}, [
    element("header", {}, [
      element("span", { class: "brand" }, [textNode("FORM & FIELD")]),
      element("span", { class: "muted" }, [textNode("Secure checkout")]),
    ]),
    element("main", {}, [
      element("section", {}, [
        element("h1", {}, [textNode("Complete your order")]),
        element("p", { class: "muted" }, [
          textNode("Thoughtfully made essentials, delivered to your door."),
        ]),
        element("div", { class: "steps" }, [
          textNode("1. Information   /   2. Shipping   /   3. Payment"),
        ]),
        element("h2", {}, [textNode("Contact and delivery")]),
        field("Email address"),
        field("Delivery address"),
        field("Card number"),
        element("button", { id: "place-order" }, [
          textNode("Place order · £128.00"),
        ]),
        element("div", { class: "notice", id: "fixture-stage-step" }, [
          clockText,
        ]),
      ]),
      element("aside", {}, [
        element("h2", {}, [textNode("Order summary")]),
        element("div", { class: "product" }, [
          element("div", { class: "swatch" }, []),
          element("strong", {}, [textNode("The everyday linen shirt")]),
          element("p", { class: "muted" }, [
            textNode("Natural / Medium · Qty 2"),
          ]),
        ]),
        element("div", { class: "total" }, [
          textNode("Subtotal"),
          element("strong", {}, [textNode("£120.00")]),
        ]),
        element("div", { class: "total" }, [
          textNode("Shipping"),
          element("span", {}, [textNode("£8.00")]),
        ]),
        element("div", { class: "total" }, [
          element("strong", {}, [textNode("Total")]),
          element("strong", {}, [textNode("£128.00")]),
        ]),
        element("p", { class: "muted" }, [
          textNode("Free returns within 30 days."),
        ]),
      ]),
    ]),
  ]);
  return {
    type: 0,
    id: 1,
    childNodes: [
      { type: 1, id: 2, name: "html", publicId: "", systemId: "" },
      element("html", {}, [
        element("head", {}, [element("style", {}, [textNode(css)])]),
        body,
      ]),
    ],
  };
}
function chunkEvents(index, startTime) {
  const offset = index * 30000;
  const timestamp = startTime + offset;
  const events = [
    {
      type: 4,
      timestamp,
      data: {
        href: "https://shop.example.com/checkout",
        width: 1200,
        height: 760,
      },
    },
    {
      type: 2,
      timestamp: timestamp + 1,
      data: { node: snapshot(), initialOffset: { top: 0, left: 0 } },
    },
  ];
  for (let at = 1000; at < 30000; at += 2500) {
    const time = offset + at;
    events.push({
      type: 3,
      timestamp: timestamp + at,
      data: {
        source: 0,
        texts: [
          {
            id: 7,
            value: `Reviewing order · ${Math.floor(time / 60000)}:${String(Math.floor(time / 1000) % 60).padStart(2, "0")}`,
          },
        ],
        attributes: [],
        removes: [],
        adds: [],
      },
    });
    events.push({
      type: 3,
      timestamp: timestamp + at + 1,
      data: {
        source: 1,
        positions: [{ id: 7, x: 390 + at / 200, y: 560, timeOffset: 0 }],
      },
    });
  }
  const custom = (at, tag, payload) =>
    events.push({
      type: 5,
      timestamp: timestamp + at,
      data: {
        tag: `oneuptime.${tag}`,
        payload: { ...payload, atUnixMs: timestamp + at },
      },
    });
  custom(3000, "click", {
    selector: "button#place-order",
    text: "Place order",
    x: 520,
    y: 640,
  });
  custom(6000, "network", {
    method: "POST",
    url: "https://shop.example.com/api/checkout",
    status: index === 0 ? 500 : 200,
    durationMs: 482,
    failed: index === 0,
  });
  if (index === 0) {
    custom(9000, "console", {
      level: "warn",
      message: "Checkout request is taking longer than expected",
    });
    custom(12000, "error", {
      message: "Payment request failed",
      name: "CheckoutError",
      stack:
        "CheckoutError: Payment request failed\n at submitCheckout (checkout.js:42:8)",
    });
  }
  if (index === 1)
    custom(15000, "frustration", {
      kind: "rage-click",
      clickCount: 5,
      x: 520,
      y: 640,
    });
  custom(21000, "route", {
    from: "https://shop.example.com/cart",
    to: "https://shop.example.com/checkout",
  });
  return events.sort((a, b) => a.timestamp - b.timestamp);
}
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.includes("/session-replay/heartbeat"))
    return new Response("{}", { status: 200 });
  if (!url.includes("/session-replay/chunks")) return nativeFetch(input, init);
  const data = JSON.parse(init.body);
  requests.push({ route: "chunks", data });
  const row =
    records.find((record) => record.sessionId === data.sessionId) || records[0];
  const frames = data.chunkIndexes.map((index) => {
    const payload = new TextEncoder().encode(
      JSON.stringify(chunkEvents(index, row.startTimeUnixMs)),
    );
    const frame = new Uint8Array(8 + payload.length);
    const view = new DataView(frame.buffer);
    view.setUint32(0, index, true);
    view.setUint32(4, payload.length, true);
    frame.set(payload, 8);
    return frame;
  });
  const body = new Uint8Array(
    frames.reduce((total, frame) => total + frame.length, 0),
  );
  let offset = 0;
  for (const frame of frames) {
    body.set(frame, offset);
    offset += frame.length;
  }
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/octet-stream" },
  });
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
        Preview workspace · Synthetic recording
      </span>
    </header>
    <Routes>
      <Route path="/dashboard/:projectId/rum/:id" element={<FixtureLayout />}>
        <Route path="session-replay" element={<Recordings />} />
        <Route path="session-replay/:subModelId" element={<Recording />} />
        <Route path="session-replay-users" element={<ReplayUsers />} />
        <Route path="documentation" element={<Documentation />} />
        <Route path="session-replay-settings" element={<ReplayPolicy />} />
        <Route path="session-replay-audit" element={<ReplayAccessLog />} />
      </Route>
    </Routes>
  </BrowserRouter>,
);

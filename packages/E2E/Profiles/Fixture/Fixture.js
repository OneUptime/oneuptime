/*
 * Offline fixture for the real Profiler.
 *
 * The Profiler's layout, its overview (Pages/Profiles/Index) and a
 * service's Profiles tab (Pages/Service/View/Profiles) are the production
 * components from this branch. Only the ModelAPI / AnalyticsModelAPI / API
 * data boundary and the synthetic user are replaced - by a small profile
 * store that answers the Profiler's reads the way the server does:
 *
 *   - stacks of four services and a host, sampled every minute, whose
 *     checkout service shipped v2.4.0 forty minutes ago (parseOrder has
 *     parsed a much bigger payload since);
 *   - profile-types, service-activity, flamegraph, diff-flamegraph,
 *     function-list (self, total and own-code time per function, as
 *     ProfileAggregationService.buildFunctionList counts them),
 *     function-comparison (Common's compareProfileWindows), function-focus
 *     (callers and callees split at the function's root-most frame),
 *     /code-task/source-links, and the Fix with AI suggestion - decided by
 *     Common's getProfileFixOffer on own-code time read from the focus
 *     trees (getOwnCodeValue), as ProfileFixTaskTrigger decides it.
 *
 * Every record is fabricated. Scenarios are picked with query parameters:
 *
 *   ?data=     full (default) | empty | quiet
 *              empty: no profile anywhere, ever
 *              quiet: profiles two to three days ago, none since
 *   ?ai=       on (default) | off - the project's Enable AI switch
 *   ?repo=     found (default) | pick | none
 *              found: the function's file is in acme/checkout
 *              pick:  two repositories, neither found to hold it
 *              none:  no repository connected in Code
 *   ?fix=      none (default) | running - a fix already on its way
 *   ?blocker=  none (default) | credits - Code's gate says no AI credits
 *   ?fail=     comma separated: types, functions, compare, focus, fix,
 *              entities, links
 *   ?theme=    dark - read by server.js
 *
 * The page's own address parameters (serviceId, profileType, rangeMinutes,
 * startTime, endTime, compare, changeTime, function, file) are passed
 * through untouched. Every read and write is recorded on
 * window.__profilesFixture so a spec can check what the page asked for.
 */
import "Common/UI/Styles/Theme.css";
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import ProfilesLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Profiles/Layout";
import ProfilesPage from "../../../App/FeatureSet/Dashboard/src/Pages/Profiles/Index";
import ProfilesAIInsights from "../../../App/FeatureSet/Dashboard/src/Pages/Profiles/AI/Insights";
import ProfilesAIInsightView from "../../../App/FeatureSet/Dashboard/src/Pages/Profiles/AI/InsightView";
import ProfilesAILogs from "../../../App/FeatureSet/Dashboard/src/Pages/Profiles/AI/Logs";
import ProfilesAISettings from "../../../App/FeatureSet/Dashboard/src/Pages/Profiles/AI/Settings";
import ServiceProfiles from "../../../App/FeatureSet/Dashboard/src/Pages/Service/View/Profiles";
import AIInsight from "Common/Models/DatabaseModels/AIInsight";
import AutoRemediationRule from "Common/Models/DatabaseModels/AutoRemediationRule";
import Service from "Common/Models/DatabaseModels/Service";
import Host from "Common/Models/DatabaseModels/Host";
import Project from "Common/Models/DatabaseModels/Project";
import ChangeEvent from "Common/Models/AnalyticsModels/ChangeEvent";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { CodeTaskBlockerType } from "Common/Types/AI/CodeTask";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";
import {
  compareProfileWindows,
  isComparisonFooted,
  limitProfileComparison,
} from "Common/Utils/Profiles/ProfileComparison";
import {
  getProfileFrameOrigin,
  isOwnProfileFrame,
  ProfileFrameOrigin,
} from "Common/Utils/Profiles/ProfileFrames";
import { getOwnCodeValue } from "Common/Utils/Profiles/ProfileHotspot";
import {
  getProfileCategory,
  isProfileCategory,
  ProfileCategory,
} from "Common/Utils/Profiles/ProfileTypes";
import {
  getProfileFixOffer,
  profileFixSuggestionToJSON,
} from "Common/Utils/Suggestions/ProfileFixSuggestion";
import {
  aiInsights,
  aiLogs,
  aiProject,
  aiProviders,
  aiReadiness,
  aiRules,
  filterInsights,
  saveProjectSwitches,
} from "./AiSection";

const params = new URLSearchParams(window.location.search);
const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "80000000-0000-4000-8000-000000000001";
const TASK_ID = "70000000-0000-4000-8000-0000000000f1";
const RUNNING_TASK_ID = "70000000-0000-4000-8000-0000000000f2";

const dataMode = params.get("data") || "full";
const isAiOn = params.get("ai") !== "off";
const repoMode = params.get("repo") || "found";
const isFixRunning = params.get("fix") === "running";
const blockerMode = params.get("blocker") || "none";
const failures = new Set(
  (params.get("fail") || "").split(",").filter((value) => value.length > 0),
);

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
/*
 * Every time is relative to page load. The spec pins the browser clock, so
 * "40 minutes ago" stays deterministic.
 */
const NOW = Date.now();
export const DEPLOY_AT = NOW - 40 * MINUTE;
const CONFIG_AT = NOW - 26 * 60 * MINUTE;

// When there are profiles at all.
const DATA_START =
  dataMode === "quiet"
    ? NOW - 3 * DAY
    : dataMode === "empty"
      ? NOW
      : NOW - 8 * DAY;
const DATA_END = dataMode === "quiet" ? NOW - 2 * DAY : NOW;

export const SERVICE_IDS = {
  checkout: "60000000-0000-4000-8000-0000000000a1",
  search: "60000000-0000-4000-8000-0000000000a2",
  reports: "60000000-0000-4000-8000-0000000000a3",
  kworker: "60000000-0000-4000-8000-0000000000a4",
  host: "60000000-0000-4000-8000-0000000000b1",
};

const SERVICES = [
  { id: SERVICE_IDS.checkout, name: "checkout", entityType: "OpenTelemetry" },
  { id: SERVICE_IDS.search, name: "search", entityType: "OpenTelemetry" },
  { id: SERVICE_IDS.reports, name: "reports", entityType: "OpenTelemetry" },
  { id: SERVICE_IDS.kworker, name: "kworker/0:1", entityType: "OpenTelemetry" },
  { id: SERVICE_IDS.host, name: "ip-10-0-1-12", entityType: "Host" },
];

// What one sample is worth, by unit: 10 ms of CPU, 512 KiB, or one.
const SAMPLE_VALUE = {
  nanoseconds: 10 * 1000 * 1000,
  bytes: 512 * 1024,
  count: 1,
};

/*
 * A stack is its frames root first ("function@file:line", or with a frame
 * type after a "|"), and how many samples a minute it takes before the
 * deploy and after it. Only checkout shipped a deploy.
 */
function stack(frames, before, after) {
  return { frames, before, after: after === undefined ? before : after };
}

const NODE_MAIN = "main@src/server.ts:12";
const EXPRESS = "Router.handle@node_modules/express/lib/router/index.js:284";
const HANDLE = "handleCheckout@src/routes/checkout.ts:40";
const GO_MAIN = "main.main@/app/cmd/search/main.go:40";
const GO_SERVE =
  "net/http.(*conn).serve@/usr/local/go/src/net/http/server.go:2009";
const GO_HANDLER =
  "search.(*Handler).ServeHTTP@/app/internal/search/handler.go:58";
const PY_MODULE = "<module>@/srv/reports/worker.py:10";
const PY_JOB = "process_job@/srv/reports/jobs.py:44";

const CHECKOUT_CPU = [
  stack(
    [
      NODE_MAIN,
      EXPRESS,
      HANDLE,
      "parseOrder@src/orders/parse.ts:88",
      "JSON.parse@node:internal/json:1",
    ],
    60,
    280,
  ),
  stack(
    [
      NODE_MAIN,
      EXPRESS,
      HANDLE,
      "parseOrder@src/orders/parse.ts:91",
      "normalizeLineItems@src/orders/normalize.ts:14",
    ],
    20,
    90,
  ),
  stack(
    [NODE_MAIN, EXPRESS, HANDLE, "validateCart@src/cart/validate.ts:31"],
    50,
  ),
  stack(
    [
      NODE_MAIN,
      EXPRESS,
      HANDLE,
      "Pool.query@node_modules/pg/lib/pool.js:210",
      "Socket.write@node:net:900",
    ],
    80,
  ),
  stack(
    [
      NODE_MAIN,
      EXPRESS,
      HANDLE,
      "renderReceipt@src/receipts/render.ts:55",
      "compile@node_modules/handlebars/dist/cjs/handlebars/compiler/compiler.js:507",
    ],
    40,
  ),
  stack(
    [
      NODE_MAIN,
      "processTicksAndRejections@node:internal/process/task_queues:95",
    ],
    10,
  ),
  stack(["(garbage collector)@:0"], 20, 40),
  stack([NODE_MAIN, EXPRESS], 5),
];

const CHECKOUT_MEMORY = [
  stack(
    [
      NODE_MAIN,
      "loadCatalog@src/catalog/cache.ts:22",
      "Map.set@node:internal/map:1",
    ],
    300,
  ),
  stack(
    [
      NODE_MAIN,
      EXPRESS,
      HANDLE,
      "parseOrder@src/orders/parse.ts:88",
      "JSON.parse@node:internal/json:1",
    ],
    40,
    160,
  ),
  stack([NODE_MAIN, "Pool.connect@node_modules/pg/lib/pool.js:120"], 80),
];

const CHECKOUT_ALLOCATIONS = [
  stack(
    [
      NODE_MAIN,
      EXPRESS,
      HANDLE,
      "parseOrder@src/orders/parse.ts:88",
      "JSON.parse@node:internal/json:1",
    ],
    120,
    520,
  ),
  stack(
    [
      NODE_MAIN,
      EXPRESS,
      HANDLE,
      "renderReceipt@src/receipts/render.ts:55",
      "Buffer.concat@node:buffer:580",
    ],
    90,
  ),
  stack(
    [NODE_MAIN, EXPRESS, HANDLE, "validateCart@src/cart/validate.ts:31"],
    40,
  ),
];

const SEARCH_CPU = [
  stack(
    [
      GO_MAIN,
      GO_SERVE,
      GO_HANDLER,
      "search.Rank@/app/internal/search/rank.go:112",
      "sort.Slice@/usr/local/go/src/sort/slice.go:23",
    ],
    120,
  ),
  stack(
    [
      GO_MAIN,
      GO_SERVE,
      GO_HANDLER,
      "search.Tokenize@/app/internal/search/tokenize.go:31",
      "strings.Fields@/usr/local/go/src/strings/strings.go:340",
    ],
    70,
  ),
  stack(["runtime.gcBgMarkWorker@/usr/local/go/src/runtime/mgc.go:1310"], 40),
  stack(
    [
      GO_MAIN,
      GO_SERVE,
      "encoding/json.Marshal@/usr/local/go/src/encoding/json/encode.go:161",
    ],
    50,
  ),
];

const SEARCH_LOCKS = [
  stack(
    [
      GO_MAIN,
      GO_SERVE,
      GO_HANDLER,
      "search.(*Index).Lookup@/app/internal/search/index.go:77",
      "sync.(*Mutex).Lock@/usr/local/go/src/sync/mutex.go:81",
    ],
    30,
  ),
  stack(
    [
      GO_MAIN,
      "search.(*Index).Rebuild@/app/internal/search/index.go:140",
      "sync.(*RWMutex).Lock@/usr/local/go/src/sync/rwmutex.go:146",
    ],
    10,
  ),
];

const SEARCH_GOROUTINES = [
  stack(
    [
      GO_MAIN,
      GO_SERVE,
      "net/http.(*conn).readRequest@/usr/local/go/src/net/http/server.go:1009",
    ],
    40,
  ),
  stack(
    [GO_MAIN, "search.(*Index).watch@/app/internal/search/index.go:200"],
    4,
  ),
];

const REPORTS_CPU = [
  stack(
    [
      PY_MODULE,
      PY_JOB,
      "render_pdf@/srv/reports/pdf.py:120",
      "build@/usr/lib/python3.11/site-packages/reportlab/platypus/doctemplate.py:1300",
    ],
    90,
  ),
  stack(
    [
      PY_MODULE,
      PY_JOB,
      "fetch_rows@/srv/reports/db.py:31",
      "execute@/usr/lib/python3.11/site-packages/psycopg/cursor.py:723",
    ],
    60,
  ),
];

const KERNEL_SAMPLES = [
  stack(
    [
      "ret_from_fork@[kernel]:0|kernel",
      "worker_thread@[kernel]:0|kernel",
      "process_one_work@[kernel]:0|kernel",
    ],
    12,
  ),
];

const HOST_SAMPLES = [
  stack(
    [
      "start_thread@/lib/x86_64-linux-gnu/libc.so.6:0|native",
      "epoll_wait@/lib/x86_64-linux-gnu/libc.so.6:0|native",
      "__x64_sys_epoll_wait@[kernel]:0|kernel",
    ],
    15,
  ),
  stack(["__schedule@[kernel]:0|kernel"], 8),
];

/*
 * What each entity sends: raw profile type, its unit, and its stacks. The
 * eBPF profiler's "samples" are counts, so the CPU time of every profiled
 * service is read in nanoseconds and the host's on its own.
 */
const PROFILES = {
  [SERVICE_IDS.checkout]: [
    { type: "cpu", unit: "nanoseconds", stacks: CHECKOUT_CPU },
    { type: "inuse_space", unit: "bytes", stacks: CHECKOUT_MEMORY },
    { type: "alloc_space", unit: "bytes", stacks: CHECKOUT_ALLOCATIONS },
  ],
  [SERVICE_IDS.search]: [
    { type: "cpu", unit: "nanoseconds", stacks: SEARCH_CPU },
    { type: "mutex", unit: "nanoseconds", stacks: SEARCH_LOCKS },
    { type: "goroutine", unit: "count", stacks: SEARCH_GOROUTINES },
  ],
  [SERVICE_IDS.reports]: [
    { type: "cpu", unit: "nanoseconds", stacks: REPORTS_CPU },
  ],
  [SERVICE_IDS.kworker]: [
    { type: "samples", unit: "count", stacks: KERNEL_SAMPLES },
  ],
  [SERVICE_IDS.host]: [
    { type: "samples", unit: "count", stacks: HOST_SAMPLES },
  ],
};

const fixture = {
  apiRequests: [],
  modelListRequests: [],
  analyticsListRequests: [],
  fixRequests: [],
  // The project switches the AI settings saved.
  switchSaves: [],
};
window.__profilesFixture = fixture;

function serialize(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function parseFrame(text) {
  const [frame, frameType] = text.split("|");
  const at = frame.indexOf("@");
  const functionName = at === -1 ? frame : frame.substring(0, at);
  const rest = at === -1 ? "" : frame.substring(at + 1);
  const colon = rest.lastIndexOf(":");
  const fileName = colon === -1 ? rest : rest.substring(0, colon);
  const lineNumber = colon === -1 ? 0 : Number(rest.substring(colon + 1)) || 0;
  return { functionName, fileName, lineNumber, frameType: frameType || "" };
}

function functionKey(frame) {
  return `${frame.functionName}\u0000${frame.fileName}`;
}

// Minutes of a window inside [from, to].
function overlapMinutes(start, end, from, to) {
  const begin = Math.max(start, from);
  const finish = Math.min(end, to);
  return finish > begin ? (finish - begin) / MINUTE : 0;
}

/*
 * The stacks a read matches: the entities in scope (every one when no ids
 * are given), the raw types asked for (every one when none are), within the
 * window - each with its samples and value, root-first frames.
 */
function readStacks(body, range) {
  const serviceIds = Array.isArray(body.serviceIds) ? body.serviceIds : null;
  const types =
    Array.isArray(body.profileTypes) && body.profileTypes.length > 0
      ? body.profileTypes
      : null;
  const start = new Date(range.startTime).getTime();
  const end = new Date(range.endTime).getTime();
  const rows = [];

  for (const service of SERVICES) {
    if (serviceIds && !serviceIds.includes(service.id)) {
      continue;
    }

    for (const profile of PROFILES[service.id] || []) {
      if (types && !types.includes(profile.type)) {
        continue;
      }

      const isCheckout = service.id === SERVICE_IDS.checkout;
      const minutesBefore = overlapMinutes(
        start,
        end,
        DATA_START,
        Math.min(DATA_END, isCheckout ? DEPLOY_AT : DATA_END),
      );
      const minutesAfter = isCheckout
        ? overlapMinutes(start, end, Math.max(DATA_START, DEPLOY_AT), DATA_END)
        : 0;

      for (const item of profile.stacks) {
        const samples = Math.round(
          item.before * minutesBefore + item.after * minutesAfter,
        );

        if (samples <= 0) {
          continue;
        }

        rows.push({
          serviceId: service.id,
          entityType: service.entityType,
          type: profile.type,
          unit: profile.unit,
          frames: item.frames.map(parseFrame),
          samples,
          value: samples * SAMPLE_VALUE[profile.unit],
          minutes: minutesBefore + minutesAfter,
        });
      }
    }
  }

  return rows;
}

function windowOf(body, prefix) {
  const startKey = prefix ? `${prefix}StartTime` : "startTime";
  const endKey = prefix ? `${prefix}EndTime` : "endTime";
  return {
    startTime: body[startKey] || new Date(NOW - 60 * MINUTE).toISOString(),
    endTime: body[endKey] || new Date(NOW).toISOString(),
  };
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + row[field], 0);
}

function profileTypes(body) {
  const byType = new Map();

  for (const row of readStacks(
    { serviceIds: body.serviceIds },
    windowOf(body),
  )) {
    const entry = byType.get(row.type) || {
      profileType: row.type,
      unit: row.unit,
      sampleCount: 0,
      profileCount: 0,
    };
    entry.sampleCount += row.samples;
    // One upload every ten seconds per entity and type.
    entry.profileCount = Math.max(
      entry.profileCount,
      Math.round(row.minutes * 6),
    );
    byType.set(row.type, entry);
  }

  return Array.from(byType.values());
}

function serviceActivity(body) {
  const byService = new Map();

  for (const row of readStacks(
    { profileTypes: body.profileTypes },
    windowOf(body),
  )) {
    const entry = byService.get(row.serviceId) || {
      primaryEntityId: row.serviceId,
      primaryEntityType: row.entityType,
      sampleCount: 0,
      profileCount: 0,
    };
    entry.sampleCount += row.samples;
    entry.profileCount = Math.max(
      entry.profileCount,
      Math.round(row.minutes * 6),
    );
    byService.set(row.serviceId, entry);
  }

  return Array.from(byService.values()).sort(
    (a, b) => b.sampleCount - a.sampleCount,
  );
}

function newNode(frame) {
  return {
    functionName: frame.functionName,
    fileName: frame.fileName,
    lineNumber: frame.lineNumber,
    frameType: frame.frameType,
    selfValue: 0,
    totalValue: 0,
    children: [],
  };
}

/*
 * A tree root first, merging frames by function and file (a function
 * sampled at two lines is one frame), as the server builds it.
 */
function flamegraph(rows) {
  const root = newNode({
    functionName: "(root)",
    fileName: "",
    lineNumber: 0,
    frameType: "",
  });

  for (const row of rows) {
    root.totalValue += row.value;
    let node = root;

    row.frames.forEach((frame, index) => {
      let child = node.children.find((candidate) => {
        return functionKey(candidate) === functionKey(frame);
      });

      if (!child) {
        child = newNode(frame);
        node.children.push(child);
      }

      child.totalValue += row.value;

      if (index === row.frames.length - 1) {
        child.selfValue += row.value;
      }

      node = child;
    });
  }

  return root;
}

function mergeDiff(baseline, comparison) {
  const baselineValue = baseline ? baseline.totalValue : 0;
  const comparisonValue = comparison ? comparison.totalValue : 0;
  const delta = comparisonValue - baselineValue;
  const node = {
    functionName:
      (baseline && baseline.functionName) ||
      (comparison && comparison.functionName) ||
      "(root)",
    fileName:
      (baseline && baseline.fileName) ||
      (comparison && comparison.fileName) ||
      "",
    lineNumber:
      (comparison && comparison.lineNumber) ||
      (baseline && baseline.lineNumber) ||
      0,
    baselineValue,
    comparisonValue,
    delta,
    deltaPercent:
      baselineValue > 0
        ? (delta / baselineValue) * 100
        : comparisonValue > 0
          ? 100
          : 0,
    selfBaselineValue: baseline ? baseline.selfValue : 0,
    selfComparisonValue: comparison ? comparison.selfValue : 0,
    selfDelta:
      (comparison ? comparison.selfValue : 0) -
      (baseline ? baseline.selfValue : 0),
    children: [],
    frameType:
      (baseline && baseline.frameType) ||
      (comparison && comparison.frameType) ||
      "",
  };
  const keys = new Map();

  for (const child of (baseline && baseline.children) || []) {
    keys.set(functionKey(child), { baseline: child, comparison: null });
  }

  for (const child of (comparison && comparison.children) || []) {
    const entry = keys.get(functionKey(child)) || {
      baseline: null,
      comparison: null,
    };
    entry.comparison = child;
    keys.set(functionKey(child), entry);
  }

  for (const entry of keys.values()) {
    node.children.push(mergeDiff(entry.baseline, entry.comparison));
  }

  return node;
}

/*
 * Per-function self, total and own-code time, as
 * ProfileAggregationService.buildFunctionList counts them.
 */
function functionList(rows) {
  const byFunction = new Map();

  for (const row of rows) {
    const seen = new Set();
    let isOwnCodeCounted = false;
    const leafFirst = [...row.frames].reverse();

    leafFirst.forEach((frame, index) => {
      const key = functionKey(frame);
      let entry = byFunction.get(key);

      if (!entry) {
        entry = {
          functionName: frame.functionName,
          fileName: frame.fileName,
          lineNumber: frame.lineNumber,
          frameType: frame.frameType,
          selfValue: 0,
          totalValue: 0,
          sampleCount: 0,
          ownValue: 0,
        };
        byFunction.set(key, entry);
      }

      if (!seen.has(key)) {
        entry.totalValue += row.value;
        entry.sampleCount += row.samples;
        seen.add(key);
      }

      if (index === 0) {
        entry.selfValue += row.value;
      }

      if (
        !isOwnCodeCounted &&
        isOwnProfileFrame(frame.fileName, frame.functionName, frame.frameType)
      ) {
        entry.ownValue += row.value;
        isOwnCodeCounted = true;
      }
    });
  }

  return Array.from(byFunction.values());
}

function sortFunctions(items, sortBy) {
  return [...items].sort((a, b) => {
    if (sortBy === "totalValue") {
      return b.totalValue - a.totalValue;
    }
    if (sortBy === "ownValue") {
      return b.ownValue - a.ownValue || b.selfValue - a.selfValue;
    }
    return b.selfValue - a.selfValue;
  });
}

// The first `limit`, then the own-code leaders it left out (as the server).
function withOwnCodeLeaders(sorted, limit) {
  const shown = sorted.slice(0, limit);
  const leaders = sorted
    .filter((item) => item.ownValue > 0)
    .sort((a, b) => b.ownValue - a.ownValue)
    .slice(0, 10);

  for (const leader of leaders) {
    if (!shown.includes(leader)) {
      shown.push(leader);
    }
  }

  return shown;
}

function readFunctionList(body, range) {
  const rows = readStacks(body, range);
  const items = sortFunctions(functionList(rows), body.sortBy || "selfValue");

  return {
    functions: withOwnCodeLeaders(items, Number(body.limit) || 50),
    windowTotal: sum(rows, "value"),
    windowSampleCount: sum(rows, "samples"),
    truncated: false,
  };
}

/*
 * One function's callers and callees, split at its root-most frame, as
 * ProfileAggregationService.getFunctionFocus builds them.
 */
function functionFocus(body, range) {
  const rows = readStacks(body, range);
  const callers = newNode({
    functionName: body.functionName,
    fileName: body.fileName || "",
    lineNumber: 0,
    frameType: "",
  });
  const callees = newNode({
    functionName: body.functionName,
    fileName: body.fileName || "",
    lineNumber: 0,
    frameType: "",
  });
  let selfValue = 0;
  let sampleCount = 0;
  let lineNumber = 0;

  const append = (root, frames, value) => {
    let node = root;

    for (const frame of frames) {
      let child = node.children.find((candidate) => {
        return functionKey(candidate) === functionKey(frame);
      });

      if (!child) {
        child = newNode({ ...frame, lineNumber: 0 });
        node.children.push(child);
      }

      child.totalValue += value;
      node = child;
    }

    node.selfValue += value;
  };

  for (const row of [...rows].sort((a, b) => b.value - a.value)) {
    const index = row.frames.findIndex((frame) => {
      return (
        frame.functionName === body.functionName &&
        frame.fileName === (body.fileName || "")
      );
    });

    if (index === -1) {
      continue;
    }

    if (!lineNumber && row.frames[index].lineNumber > 0) {
      lineNumber = row.frames[index].lineNumber;
    }

    callers.frameType = callers.frameType || row.frames[index].frameType;
    callees.frameType = callees.frameType || row.frames[index].frameType;
    callers.totalValue += row.value;
    callees.totalValue += row.value;
    sampleCount += row.samples;

    if (index === row.frames.length - 1) {
      selfValue += row.value;
    }

    append(callers, row.frames.slice(0, index).reverse(), row.value);
    append(callees, row.frames.slice(index + 1), row.value);
  }

  return {
    functionName: body.functionName,
    fileName: body.fileName || "",
    lineNumber,
    totalValue: callers.totalValue,
    selfValue,
    sampleCount,
    windowTotal: sum(rows, "value"),
    windowSampleCount: sum(rows, "samples"),
    callers,
    callees,
    truncated: false,
  };
}

const REPOSITORIES = {
  checkout: {
    id: "90000000-0000-4000-8000-0000000000c1",
    name: "acme/checkout",
  },
  platform: {
    id: "90000000-0000-4000-8000-0000000000c2",
    name: "acme/platform",
  },
};

function sourceLinks(body) {
  return (body.frames || [])
    .filter((frame) => {
      return (
        frame.fileName &&
        getProfileFrameOrigin(frame.fileName, "") === ProfileFrameOrigin.Own &&
        (frame.fileName.startsWith("src/") ||
          frame.fileName.startsWith("/app/"))
      );
    })
    .map((frame) => {
      const path = frame.fileName.replace(/^\/app\//, "");
      return {
        fileName: frame.fileName,
        lineNumber: frame.lineNumber || 0,
        repositoryName: REPOSITORIES.checkout.name,
        path,
        url: `https://github.com/${REPOSITORIES.checkout.name}/blob/main/${path}${
          frame.lineNumber ? `#L${frame.lineNumber}` : ""
        }`,
      };
    });
}

function kindOf(profileType) {
  const value = profileType || "cpu";
  return isProfileCategory(value) ? value : getProfileCategory(value);
}

// The raw types a kind is read as, for the fix's own reads.
function queryTypesFor(profileType, serviceId) {
  const category = kindOf(profileType);
  const types = (PROFILES[serviceId] || [])
    .filter((profile) => getProfileCategory(profile.type) === category)
    .map((profile) => profile.type);
  return types.length > 0 ? types : [profileType || "cpu"];
}

function ownShareFor(body, range) {
  const focus = functionFocus(
    {
      serviceIds: [body.serviceId],
      profileTypes: queryTypesFor(body.profileType, body.serviceId),
      functionName: body.functionName,
      fileName: body.fileName || "",
    },
    range,
  );

  return {
    ownShare:
      focus.windowTotal > 0
        ? (getOwnCodeValue(focus.callees) / focus.windowTotal) * 100
        : 0,
    functionSampleCount: focus.sampleCount,
    windowSampleCount: focus.windowSampleCount,
  };
}

function fixSuggestion(body) {
  const now = ownShareFor(body, windowOf(body));
  const evidence = {
    category: kindOf(body.profileType),
    isOwnCode:
      getProfileFrameOrigin(body.fileName || "", body.functionName) ===
      ProfileFrameOrigin.Own,
    ownShare: now.ownShare,
    functionSampleCount: now.functionSampleCount,
    windowSampleCount: now.windowSampleCount,
  };

  if (body.beforeStartTime && body.beforeEndTime) {
    evidence.ownShareBefore = ownShareFor(
      body,
      windowOf(body, "before"),
    ).ownShare;
  }

  const offer = getProfileFixOffer({
    evidence,
    isAiEnabled: isAiOn,
    hasActiveFix: isFixRunning,
    hasConnectedRepository: repoMode !== "none",
    blocker:
      blockerMode === "credits"
        ? {
            type: CodeTaskBlockerType.NoAiCredits,
            message: "The project has no AI credits left.",
          }
        : null,
  });

  return profileFixSuggestionToJSON({
    ...offer,
    evidence: offer.offer === "None" ? null : evidence,
    repository:
      offer.offer === "Act" && repoMode === "found"
        ? REPOSITORIES.checkout
        : null,
    repositories:
      offer.offer === "Act" && repoMode === "pick"
        ? [REPOSITORIES.checkout, REPOSITORIES.platform]
        : [],
    taskId: offer.offer === "InProgress" ? RUNNING_TASK_ID : null,
  });
}

function ok(data) {
  return new HTTPResponse(200, data, {});
}

function fail(status, message) {
  throw new HTTPErrorResponse(status, { message }, {});
}

async function handleApi(method, options) {
  const url = options.url.toString();
  const body = serialize(options.data);
  fixture.apiRequests.push({ method, url, body });

  if (url.includes("/telemetry/profiles/profile-types")) {
    if (failures.has("types")) {
      fail(500, "The profile store is unavailable.");
    }
    return ok({ profileTypes: profileTypes(body) });
  }

  if (url.includes("/telemetry/profiles/service-activity")) {
    if (failures.has("entities")) {
      fail(500, "Could not read which services are profiled.");
    }
    return ok({ activity: serviceActivity(body) });
  }

  if (url.includes("/telemetry/profiles/diff-flamegraph")) {
    const before = flamegraph(readStacks(body, windowOf(body, "baseline")));
    const after = flamegraph(readStacks(body, windowOf(body, "comparison")));
    return ok({ diffFlamegraph: mergeDiff(before, after), truncated: false });
  }

  if (url.includes("/telemetry/profiles/flamegraph")) {
    return ok({
      flamegraph: flamegraph(readStacks(body, windowOf(body))),
      truncated: false,
    });
  }

  if (url.includes("/telemetry/profiles/function-list")) {
    if (failures.has("functions")) {
      fail(500, "Could not read the functions.");
    }
    return ok(readFunctionList(body, windowOf(body)));
  }

  if (url.includes("/telemetry/profiles/function-comparison")) {
    if (failures.has("compare")) {
      fail(500, "Could not compare the windows.");
    }
    const before = readFunctionList(
      { ...body, limit: 500 },
      windowOf(body, "before"),
    );
    const after = readFunctionList(
      { ...body, limit: 500 },
      windowOf(body, "after"),
    );
    return ok({
      changes: limitProfileComparison(
        compareProfileWindows(before, after),
        Number(body.limit) || 50,
      ),
      before: {
        windowTotal: before.windowTotal,
        windowSampleCount: before.windowSampleCount,
        truncated: false,
      },
      after: {
        windowTotal: after.windowTotal,
        windowSampleCount: after.windowSampleCount,
        truncated: false,
      },
      isFooted: isComparisonFooted(before, after),
    });
  }

  if (url.includes("/telemetry/profiles/function-focus")) {
    if (failures.has("focus")) {
      fail(500, "Could not read this function.");
    }
    return ok(functionFocus(body, windowOf(body)));
  }

  if (url.includes("/code-task/source-links")) {
    if (failures.has("links")) {
      fail(500, "GitHub did not answer.");
    }
    return ok({ links: sourceLinks(body) });
  }

  if (url.includes("/ai-investigation/profile-fix-suggestion")) {
    return ok(fixSuggestion(body));
  }

  if (url.includes("/ai-investigation/create-profile-fix-task")) {
    fixture.fixRequests.push(body);
    if (failures.has("fix")) {
      fail(400, "Pick the repository that holds this code.");
    }
    return ok({ taskId: TASK_ID });
  }

  // The Profiler's AI section.
  if (url.includes("/telemetry-ai/readiness")) {
    return ok(aiReadiness());
  }

  if (url.includes("/telemetry-ai/logs")) {
    const logs = aiLogs(NOW, Number(body.skip) || 0);
    if (!logs) {
      fail(500, "The AI logs could not be read.");
    }
    return ok(logs);
  }

  if (url.includes("/ai-chat/providers")) {
    return ok(aiProviders());
  }

  if (url.includes("/ai-insight/triage-run")) {
    return ok({ run: null, events: [] });
  }

  return ok({});
}

UserUtil.isMasterAdmin = () => true;
UserUtil.getUserId = () => new ObjectID(USER_ID);
PermissionUtil.getAllPermissions = () => [Permission.ProjectOwner];
ProjectUtil.getCurrentProjectId = () => new ObjectID(PROJECT_ID);
ProjectUtil.getCurrentProject = () => {
  return aiProject(PROJECT_ID);
};
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });
AnalyticsModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

function idsOf(query) {
  const value = query && query._id;
  if (!value) {
    return null;
  }
  if (Array.isArray(value.values)) {
    return value.values.map((id) => id.toString());
  }
  if (Array.isArray(value)) {
    return value.map((id) => id.toString());
  }
  return [value.toString()];
}

ModelAPI.getList = async (options) => {
  const model = new options.modelType();
  fixture.modelListRequests.push({
    modelName: model.tableName,
    query: serialize(options.query),
  });

  const ids = idsOf(options.query);
  const wanted = (service) => !ids || ids.includes(service.id);

  if (options.modelType === Service) {
    const services = SERVICES.filter(
      (service) => service.entityType === "OpenTelemetry" && wanted(service),
    ).map((service) =>
      Object.assign(new Service(), { _id: service.id, name: service.name }),
    );
    return { data: services, count: services.length, skip: 0, limit: 100 };
  }

  if (options.modelType === Host) {
    const hosts = SERVICES.filter(
      (service) => service.entityType === "Host" && wanted(service),
    ).map((service) =>
      Object.assign(new Host(), {
        _id: service.id,
        name: service.name,
        hostIdentifier: service.name,
      }),
    );
    return { data: hosts, count: hosts.length, skip: 0, limit: 100 };
  }

  if (options.modelType === AIInsight) {
    const rows = filterInsights(
      aiInsights(NOW, SERVICE_IDS.checkout),
      options.query,
    );
    return {
      data: rows.slice(options.skip || 0, (options.skip || 0) + options.limit),
      count: rows.length,
      skip: options.skip || 0,
      limit: options.limit,
    };
  }

  if (options.modelType === AutoRemediationRule) {
    const rules = aiRules();
    return { data: rules, count: rules.length, skip: 0, limit: 10 };
  }

  return { data: [], count: 0, skip: 0, limit: 10 };
};
ModelAPI.getItem = async (options) => {
  if (options.modelType === Project) {
    return aiProject(PROJECT_ID);
  }

  if (options.modelType === AIInsight) {
    const id = options.id ? options.id.toString() : "";
    return (
      aiInsights(NOW, SERVICE_IDS.checkout).find((row) => {
        return row.id && row.id.toString() === id;
      }) || null
    );
  }

  return null;
};
ModelAPI.getCount = async () => 0;
ModelAPI.count = async (options) => {
  if (options.modelType === AIInsight) {
    return filterInsights(aiInsights(NOW, SERVICE_IDS.checkout), options.query)
      .length;
  }

  if (options.modelType === AutoRemediationRule) {
    return aiRules().filter((rule) => {
      return rule.isEnabled;
    }).length;
  }

  return 0;
};
ModelAPI.updateById = async (options) => {
  const data = serialize(options.data);
  fixture.switchSaves.push(data);
  if (options.modelType === Project) {
    saveProjectSwitches(data);
  }
  return ok({});
};

AnalyticsModelAPI.getList = async (options) => {
  const model = new options.modelType();
  fixture.analyticsListRequests.push({
    modelName: model.tableName,
    query: serialize(options.query),
  });

  if (options.modelType === ChangeEvent) {
    const entityId =
      options.query && options.query.primaryEntityId
        ? options.query.primaryEntityId.toString()
        : "";
    if (entityId !== SERVICE_IDS.checkout || dataMode !== "full") {
      return { data: [], count: 0, skip: 0, limit: 10 };
    }
    const changes = [
      { time: new Date(DEPLOY_AT), title: "v2.4.0", eventType: "deployment" },
      {
        time: new Date(CONFIG_AT),
        title: "Raise the pool size to 40",
        eventType: "config-change",
      },
    ].map((change) => Object.assign(new ChangeEvent(), change));
    return { data: changes, count: changes.length, skip: 0, limit: 10 };
  }

  return { data: [], count: 0, skip: 0, limit: 10 };
};
AnalyticsModelAPI.count = async () => 0;

API.get = async (options) => handleApi("GET", options);
API.post = async (options) => handleApi("POST", options);

await i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
});

function RouterHooks() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  return <Outlet />;
}

function PlaceholderPage(props) {
  const routeParams = useParams();
  return (
    <main className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-xl font-semibold text-gray-900">{props.title}</h1>
      <p data-testid={props.testId} className="mt-2 text-sm text-gray-600">
        {routeParams.modelId || window.location.pathname}
        {window.location.search}
      </p>
    </main>
  );
}

function ServicePage() {
  return (
    <div className="py-6">
      <h1
        className="mb-4 text-xl font-semibold text-gray-900"
        data-testid="service-page-title"
      >
        checkout · Profiles
      </h1>
      <ServiceProfiles />
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-6 py-4">
      <div className="flex items-center gap-5">
        <span className="text-lg font-semibold text-gray-900">OneUptime</span>
        <span className="text-sm text-gray-500">Commerce</span>
      </div>
      <span className="text-xs text-gray-500">
        Preview workspace · Synthetic profiles
      </span>
    </header>
    <div className="mx-auto max-w-[1600px] px-4 sm:px-8">
      <Routes>
        <Route element={<RouterHooks />}>
          <Route
            path="/dashboard/:projectId/profiles"
            element={<ProfilesLayout />}
          >
            <Route index element={<ProfilesPage />} />
            {/* The AI section: what OneUptime found, what it did, its settings. */}
            <Route path="ai/insights" element={<ProfilesAIInsights />} />
            <Route path="ai/insights/:id" element={<ProfilesAIInsightView />} />
            <Route path="ai/logs" element={<ProfilesAILogs />} />
            <Route path="ai/settings" element={<ProfilesAISettings />} />
          </Route>
          <Route
            path="/dashboard/:projectId/service/:modelId/profiles"
            element={<ServicePage />}
          />
          <Route
            path="/dashboard/:projectId/profiles/insights"
            element={
              <PlaceholderPage
                title="All profiles"
                testId="all-profiles-page"
              />
            }
          />
          <Route
            path="/dashboard/:projectId/profiles/documentation"
            element={
              <PlaceholderPage title="Setup guide" testId="setup-guide-page" />
            }
          />
          <Route
            path="/dashboard/:projectId/monitors/create"
            element={
              <PlaceholderPage
                title="Create Monitor"
                testId="monitor-create-page"
              />
            }
          />
          <Route
            path="/dashboard/:projectId/code/tasks/:modelId"
            element={
              <PlaceholderPage title="Code Task" testId="code-task-page" />
            }
          />
          <Route
            path="/dashboard/:projectId/code"
            element={<PlaceholderPage title="Code" testId="code-page" />}
          />
        </Route>
      </Routes>
    </div>
  </BrowserRouter>,
);

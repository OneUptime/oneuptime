/*
 * Offline fixture for the real exception detail pages.
 *
 * The layout, side menu, summary header and all seven pages (Overview, Stack
 * Trace, Occurrences, Context, Logs, AI Assistance, Settings) are the
 * production components from this branch. Only the ModelAPI / AnalyticsModelAPI / API
 * data boundary and the synthetic user are replaced.
 *
 * Every record is fabricated. Scenarios are picked with query parameters:
 *
 *   ?status=     unresolved (default) | resolved | archived | resolved-archived
 *   ?exception=  full (default) | minimal | long
 *   ?frames=     mapped (default) | unmapped | raw
 *   ?occurrence= trace (default) | no-trace | none
 *   ?ai=         ready (default) | setup | running | failed | no-fix |
 *                completed | mixed
 *   ?histogram=  data (default) | empty | fail
 *   ?replay=     none (default) | session
 *   ?spans=      data (default) | empty
 *   ?fail=       comma separated: update, delete, create-task, exception
 *   ?hold=       exception — keep the exception read pending until
 *                window.__exceptionFixture.releaseException() is called
 *
 * Every read and write is recorded on window.__exceptionFixture so a spec
 * can assert what the page asked for as well as what it drew.
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
import ExceptionViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Exceptions/View/Layout";
import ExceptionView from "../../../App/FeatureSet/Dashboard/src/Pages/Exceptions/View/Index";
import ExceptionDetailSection from "../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionDetailSection";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import Service from "Common/Models/DatabaseModels/Service";
import User from "Common/Models/DatabaseModels/User";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Span, { SpanKind } from "Common/Models/AnalyticsModels/Span";
import Log from "Common/Models/AnalyticsModels/Log";
import Color from "Common/Types/Color";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";

const params = new URLSearchParams(window.location.search);
const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const EXCEPTION_ID = "50000000-0000-4000-8000-000000000001";
const SERVICE_ID = "60000000-0000-4000-8000-000000000001";
const USER_ID = "80000000-0000-4000-8000-000000000001";
const TASK_IDS = {
  FixException: "70000000-0000-4000-8000-000000000001",
  WriteRegressionTest: "70000000-0000-4000-8000-000000000002",
  ImproveExceptionHandling: "70000000-0000-4000-8000-000000000003",
};

const status = params.get("status") || "unresolved";
const exceptionShape = params.get("exception") || "full";
const framesMode = params.get("frames") || "mapped";
const occurrenceMode = params.get("occurrence") || "trace";
const aiMode = params.get("ai") || "ready";
const histogramMode = params.get("histogram") || "data";
const replayMode = params.get("replay") || "none";
const spansMode = params.get("spans") || "data";
const failures = new Set(
  (params.get("fail") || "").split(",").filter((value) => value.length > 0),
);
const holdException = params.get("hold") === "exception";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/*
 * Every time is relative to page load. The spec pins the browser clock with
 * page.clock, so relative labels and chart buckets stay deterministic there.
 */
const NOW = Date.now();

const EXCEPTION_TYPE = "InventoryReservationError";
const EXCEPTION_MESSAGE =
  "Could not reserve 3 units of SKU-4821 for order ord_9f2c: warehouse eu-west-2 returned 409 Conflict (stock version changed)";
const LONG_MESSAGE = `${EXCEPTION_MESSAGE}. ${"The reservation was retried with a fresh stock version but the warehouse kept rejecting the write because a concurrent order held the row lock. ".repeat(4)}`;
const FINGERPRINT =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN_ID = "00f067aa0ba902b7";
const SESSION_ID = "d".repeat(32);
const RUM_APPLICATION_ID = "90000000-0000-4000-8000-000000000001";

const STACK_TRACE = [
  `${EXCEPTION_TYPE}: ${EXCEPTION_MESSAGE}`,
  "    at reserveInventory (/app/dist/services/inventory.js:212:17)",
  "    at async Promise.all (index 0)",
  "    at submitOrder (/app/dist/services/order.js:88:24)",
  "    at processTicksAndRejections (node:internal/process/task_queues:95:5)",
  "    at handleCheckout (/app/dist/routes/checkout.js:41:11)",
  "    at Layer.handle [as handle_request] (/app/node_modules/express/lib/router/layer.js:95:5)",
  "    at next (/app/node_modules/express/lib/router/route.js:149:13)",
  "    at Route.dispatch (/app/node_modules/express/lib/router/route.js:119:3)",
  "    at Layer.handle [as handle_request] (/app/node_modules/express/lib/router/layer.js:95:5)",
  "    at /app/node_modules/express/lib/router/index.js:284:15",
].join("\n");

const PARSED_FRAMES = [
  {
    functionName: "reserveInventory",
    fileName: "/app/dist/services/inventory.js",
    lineNumber: 212,
    columnNumber: 17,
    inApp: true,
  },
  {
    functionName: "async Promise.all (index 0)",
    fileName: "",
    lineNumber: 0,
    inApp: false,
  },
  {
    functionName: "submitOrder",
    fileName: "/app/dist/services/order.js",
    lineNumber: 88,
    columnNumber: 24,
    inApp: true,
  },
  {
    functionName: "processTicksAndRejections",
    fileName: "node:internal/process/task_queues",
    lineNumber: 95,
    columnNumber: 5,
    inApp: false,
  },
  {
    functionName: "handleCheckout",
    fileName: "/app/dist/routes/checkout.js",
    lineNumber: 41,
    columnNumber: 11,
    inApp: true,
  },
  {
    functionName: "Layer.handle [as handle_request]",
    fileName: "/app/node_modules/express/lib/router/layer.js",
    lineNumber: 95,
    columnNumber: 5,
    inApp: false,
  },
  {
    functionName: "next",
    fileName: "/app/node_modules/express/lib/router/route.js",
    lineNumber: 149,
    columnNumber: 13,
    inApp: false,
  },
  {
    functionName: "Route.dispatch",
    fileName: "/app/node_modules/express/lib/router/route.js",
    lineNumber: 119,
    columnNumber: 3,
    inApp: false,
  },
  {
    functionName: "Layer.handle [as handle_request]",
    fileName: "/app/node_modules/express/lib/router/layer.js",
    lineNumber: 95,
    columnNumber: 5,
    inApp: false,
  },
  {
    functionName: "",
    fileName: "/app/node_modules/express/lib/router/index.js",
    lineNumber: 284,
    columnNumber: 15,
    inApp: false,
  },
];

const ORIGINAL_LOCATIONS = {
  0: {
    originalFileName: "src/services/inventory.ts",
    originalLineNumber: 187,
    originalColumnNumber: 13,
    originalFunctionName: "InventoryService.reserveInventory",
    sourceCodeSnippet: {
      startLine: 183,
      highlightLine: 187,
      lines: [
        "    const current = await this.warehouse.getStock(sku);",
        "    if (current.version !== expectedVersion) {",
        "      span.addEvent(\"inventory.version_mismatch\", { sku });",
        "      // A concurrent order changed the row since we read it.",
        "      throw new InventoryReservationError(sku, quantity, orderId);",
        "    }",
        "    return this.warehouse.reserve(sku, quantity, current.version);",
      ],
    },
  },
  2: {
    originalFileName: "src/services/order.ts",
    originalLineNumber: 64,
    originalColumnNumber: 9,
    originalFunctionName: "OrderService.submitOrder",
  },
  4: {
    originalFileName: "src/routes/checkout.ts",
    originalLineNumber: 29,
    originalColumnNumber: 7,
    originalFunctionName: "handleCheckout",
  },
};

const fixture = {
  getItemRequests: [],
  analyticsListRequests: [],
  apiRequests: [],
  updates: [],
  deletes: [],
  createdTasks: [],
  releaseException: () => {},
};
window.__exceptionFixture = fixture;

const exceptionGate = holdException
  ? new Promise((resolve) => {
      fixture.releaseException = resolve;
    })
  : Promise.resolve();

function serialize(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

const triage = {
  isResolved: status === "resolved" || status === "resolved-archived",
  isArchived: status === "archived" || status === "resolved-archived",
  markedAsResolvedAt:
    status === "resolved" || status === "resolved-archived"
      ? new Date(NOW - 2 * HOUR)
      : null,
  markedAsArchivedAt:
    status === "archived" || status === "resolved-archived"
      ? new Date(NOW - 26 * HOUR)
      : null,
};

const resolver = Object.assign(new User(), {
  _id: USER_ID,
  name: new Name("Priya Raman"),
  email: new Email("priya@example.com"),
});

function makeException() {
  const record = new TelemetryException();
  record._id = EXCEPTION_ID;
  record.projectId = new ObjectID(PROJECT_ID);
  record.isResolved = triage.isResolved;
  record.isArchived = triage.isArchived;
  record.markedAsResolvedAt = triage.markedAsResolvedAt || undefined;
  record.markedAsArchivedAt = triage.markedAsArchivedAt || undefined;
  record.markedAsResolvedByUser = triage.isResolved ? resolver : undefined;
  record.markedAsArchivedByUser = triage.isArchived ? resolver : undefined;

  if (exceptionShape === "minimal") {
    record.occuranceCount = 0;
    return record;
  }

  record.exceptionType = EXCEPTION_TYPE;
  record.message = exceptionShape === "long" ? LONG_MESSAGE : EXCEPTION_MESSAGE;
  record.stackTrace = STACK_TRACE;
  record.fingerprint = FINGERPRINT;
  record.firstSeenAt = new Date(NOW - 6 * DAY - 3 * HOUR);
  record.lastSeenAt = new Date(NOW - 4 * MINUTE);
  record.occuranceCount = 1284;
  record.firstSeenInRelease = "checkout-api@2026.09.08";
  record.lastSeenInRelease = "checkout-api@2026.09.14";
  record.environment = "production";
  record.primaryEntityId = new ObjectID(SERVICE_ID);
  record.primaryEntityType = "OpenTelemetry";
  record.unhandled = true;
  record.errorClass = "code-fault";
  return record;
}

function makeService() {
  return Object.assign(new Service(), {
    _id: SERVICE_ID,
    name: "checkout-api",
    serviceColor: new Color("#6366f1"),
  });
}

const RELEASES = [
  "checkout-api@2026.09.14",
  "checkout-api@2026.09.14",
  "checkout-api@2026.09.12",
];
const SPANS = ["POST /api/checkout", "POST /api/checkout", "reserve-inventory"];

function makeOccurrence(index) {
  const record = new ExceptionInstance();
  record._id = `a0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
  record.projectId = new ObjectID(PROJECT_ID);
  record.primaryEntityId = new ObjectID(SERVICE_ID);
  record.primaryEntityType = "OpenTelemetry";
  record.time = new Date(NOW - 4 * MINUTE - index * 37 * MINUTE);
  record.exceptionType = EXCEPTION_TYPE;
  record.message = EXCEPTION_MESSAGE;
  record.stackTrace = STACK_TRACE;
  record.fingerprint = FINGERPRINT;
  record.escaped = index % 4 !== 3;
  record.spanStatusCode = 2;
  record.spanName = SPANS[index % SPANS.length];
  record.release = RELEASES[index % RELEASES.length];
  record.environment = index % 5 === 4 ? "staging" : "production";
  record.traceId =
    occurrenceMode === "no-trace" && index === 0
      ? ""
      : index === 0
        ? TRACE_ID
        : `${String(index).padStart(2, "0")}${TRACE_ID.slice(2)}`;
  record.spanId = index === 0 ? SPAN_ID : `${String(index).padStart(2, "0")}${SPAN_ID.slice(2)}`;
  record.sessionId = index % 3 === 0 ? SESSION_ID : "";
  record.parsedFrames =
    framesMode === "raw" ? "[]" : JSON.stringify(PARSED_FRAMES);
  record.attributes = {
    "checkout.stage": "reserve-inventory",
    "inventory.sku": "SKU-4821",
    "http.route": "/api/checkout",
  };
  return record;
}

const OCCURRENCE_COUNT = 24;
const occurrences =
  occurrenceMode === "none" || exceptionShape === "minimal"
    ? []
    : Array.from({ length: OCCURRENCE_COUNT }, (_, index) =>
        makeOccurrence(index),
      );

function spanEvent(name, offsetMs, attributes) {
  const time = new Date(NOW - 4 * MINUTE + offsetMs);
  return {
    name,
    time,
    timeUnixNano: time.getTime() * 1000000,
    attributes,
  };
}

function makeSpans() {
  const request = new Span();
  request.name = "POST /api/checkout";
  request.startTime = new Date(NOW - 4 * MINUTE - 900);
  request.events = [
    spanEvent("http.request", -880, {
      "http.method": "POST",
      "http.url": "https://shop.example.com/api/checkout",
    }),
    spanEvent("cart.loaded", -640, { "cart.items": 3, "cart.currency": "EUR" }),
    spanEvent("log", -520, {
      message: "Reserving stock for order ord_9f2c",
    }),
    spanEvent("db.query", -410, {
      "db.system": "postgresql",
      "db.statement":
        "SELECT sku, quantity, version FROM stock WHERE sku = $1 FOR UPDATE",
    }),
    spanEvent("db.query", -380, {
      "db.system": "postgresql",
      "db.statement":
        "SELECT sku, quantity, version FROM stock WHERE sku = $1 FOR UPDATE",
    }),
    spanEvent("inventory.version_mismatch warning", -120, {
      level: "warning",
      "inventory.sku": "SKU-4821",
      "inventory.expected_version": 41,
      "inventory.actual_version": 42,
    }),
    spanEvent("http.response", -40, {
      "http.method": "PUT",
      "http.url": "https://warehouse.internal/eu-west-2/reservations",
      "http.status_code": 409,
    }),
    spanEvent("exception", 0, {
      "exception.type": EXCEPTION_TYPE,
      "exception.message": EXCEPTION_MESSAGE,
      "exception.escaped": true,
    }),
  ];
  return [request];
}

/*
 * The spans the exception-scoped span list returns: one per occurrence, the
 * way the server's (traceId, spanId) IN subquery would match them.
 */
function makeExceptionSpans() {
  if (spansMode === "empty") {
    return [];
  }
  return occurrences.map((occurrence, index) => {
    const span = new Span();
    span._id = `b0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    span.projectId = new ObjectID(PROJECT_ID);
    span.primaryEntityId = new ObjectID(SERVICE_ID);
    span.primaryEntityType = "OpenTelemetry";
    span.traceId = occurrence.traceId || TRACE_ID;
    span.spanId = occurrence.spanId;
    span.parentSpanId = index % 2 === 0 ? "" : "aa00aa00aa00aa00";
    span.name = occurrence.spanName;
    span.kind = index % 3 === 2 ? SpanKind.Internal : SpanKind.Server;
    span.startTime = new Date(occurrence.time.getTime() - 180 - index * 7);
    span.endTime = occurrence.time;
    span.durationUnixNano = (180 + index * 7) * 1000000;
    span.statusCode = 2;
    span.statusMessage = EXCEPTION_MESSAGE;
    span.hasException = true;
    return span;
  });
}

function makeLogs(query) {
  const at = (offset) => new Date(NOW - 4 * MINUTE + offset);
  const rows = [
    ["INFO", "POST /api/checkout order=ord_9f2c items=3", -2400],
    ["DEBUG", "Loaded cart for customer cus_12 (3 items)", -1800],
    ["WARN", "stock version changed for SKU-4821 (expected 41, got 42)", -900],
    ["ERROR", `${EXCEPTION_TYPE}: ${EXCEPTION_MESSAGE}`, 0],
    ["ERROR", "checkout failed: responding 409 to client", 300],
  ];
  const isTraceScoped = Boolean(query && query.traceId);
  return rows
    .filter((row, index) => !isTraceScoped || index !== 1)
    .map(([severityText, body, offset], index) => {
      const log = new Log();
      log._id = `c0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      log.projectId = new ObjectID(PROJECT_ID);
      log.primaryEntityId = new ObjectID(SERVICE_ID);
      log.primaryEntityType = "OpenTelemetry";
      log.time = at(offset);
      log.timeUnixNano = at(offset).getTime() * 1000000;
      log.severityText = severityText;
      log.body = body;
      log.traceId = TRACE_ID;
      log.spanId = SPAN_ID;
      log.attributes = { "http.route": "/api/checkout" };
      return log;
    })
    .reverse();
}

function statusHistogram(body, series) {
  const start = new Date(body.startTime || NOW - HOUR).getTime();
  const end = new Date(body.endTime || NOW).getTime();
  const size = Math.max(MINUTE, Math.floor((end - start) / 40));
  const buckets = [];
  for (let time = start, index = 0; time < end; time += size, index += 1) {
    buckets.push({
      time: new Date(time).toISOString(),
      series,
      count: 1 + ((index * 7) % 5),
    });
  }
  return buckets;
}

function histogramBuckets(body) {
  const start = new Date(body.startTime).getTime();
  const end = new Date(body.endTime).getTime();
  const size = Number(body.bucketSizeInMinutes || 60) * MINUTE;
  const buckets = [];
  let index = 0;
  for (let time = start; time < end; time += size) {
    const wave = Math.round(
      6 + 5 * Math.sin(index / 3) + (index % 7 === 5 ? 18 : 0),
    );
    if (wave > 0) {
      buckets.push({
        time: new Date(time).toISOString(),
        series: "unhandled",
        count: wave,
      });
    }
    if (index % 3 === 0) {
      buckets.push({
        time: new Date(time).toISOString(),
        series: "handled",
        count: 2 + (index % 4),
      });
    }
    index += 1;
  }
  return buckets;
}

function aiTask(taskType, taskStatus, statusMessage) {
  const titles = {
    Queued: [
      "Queued",
      "The fix task is queued and waiting to be picked up by an AI agent.",
    ],
    Running: [
      "In Progress",
      "An AI agent is working on a fix for this exception.",
    ],
    Completed: [
      "Completed",
      "The AI agent finished. Review the pull request it opened for the proposed fix.",
    ],
    NoFixFound: [
      "No Fix Found",
      "The AI agent reviewed the code and did not find a fix to propose, so it opened no pull request.",
    ],
    Error: ["Error", "The AI agent could not complete the fix."],
  };
  return {
    _id: TASK_IDS[taskType],
    status: taskStatus,
    statusTitle: titles[taskStatus][0],
    statusDescription: titles[taskStatus][1],
    statusMessage,
    createdAt: new Date(NOW - 18 * MINUTE).toISOString(),
    taskType,
  };
}

function aiTasks() {
  switch (aiMode) {
    case "running":
      return [
        aiTask(
          "FixException",
          "Running",
          "Reading src/services/inventory.ts and reproducing the version check.",
        ),
      ];
    case "failed":
      return [
        aiTask(
          "FixException",
          "Error",
          "The agent could not clone OneUptime/checkout-api: repository access was revoked.",
        ),
      ];
    case "no-fix":
      return [aiTask("WriteRegressionTest", "NoFixFound", undefined)];
    case "completed":
      return [aiTask("FixException", "Completed", undefined)];
    case "mixed":
      return [
        aiTask("FixException", "Completed", undefined),
        aiTask(
          "WriteRegressionTest",
          "Queued",
          "Waiting for an agent to pick up the task.",
        ),
        aiTask(
          "ImproveExceptionHandling",
          "Error",
          "The agent stopped responding after 20 minutes.",
        ),
      ];
    default:
      return [];
  }
}

function aiReadiness() {
  if (aiMode === "setup") {
    return {
      ready: false,
      checks: [
        {
          id: "llmProvider",
          ok: true,
          title: "LLM provider",
          detail: "Using the project's Anthropic provider.",
        },
        {
          id: "repositoryConnected",
          ok: false,
          title: "GitHub repository",
          detail:
            "AI opens its fixes as pull requests, so it needs a repository to push to. Connect one through the GitHub App — installing it imports all of its repositories automatically.",
        },
        {
          id: "agentAvailable",
          ok: false,
          title: "AI agent online",
          detail:
            "No agent is available for this project. Install a OneUptime Runner and enable Runs AI Code Fixes on it (Settings > Runners).",
        },
      ],
    };
  }
  return {
    ready: true,
    checks: [
      {
        id: "llmProvider",
        ok: true,
        title: "LLM provider",
        detail: "Using the project's Anthropic provider.",
      },
      {
        id: "repositoryConnected",
        ok: true,
        title: "GitHub repository",
        detail:
          "Connected through the GitHub App. The agent opens its fix pull requests here.",
      },
      {
        id: "agentAvailable",
        ok: true,
        title: "AI agent online: runner-eu-1",
        detail: "Connected and polling for tasks.",
      },
    ],
  };
}

function matchesOccurrenceQuery(record, query) {
  for (const [key, condition] of Object.entries(query || {})) {
    if (condition === undefined || condition === null || key === "projectId") {
      continue;
    }
    if (key === "fingerprint" && record.fingerprint !== String(condition)) {
      return false;
    }
    if (
      key === "primaryEntityId" &&
      record.primaryEntityId.toString() !== condition.toString()
    ) {
      return false;
    }
  }
  return true;
}

UserUtil.isMasterAdmin = () => true;
UserUtil.getUserId = () => new ObjectID(USER_ID);
PermissionUtil.getAllPermissions = () => [Permission.ProjectOwner];
ProjectUtil.getCurrentProjectId = () => new ObjectID(PROJECT_ID);
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });
AnalyticsModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

ModelAPI.getItem = async (options) => {
  const modelName = new options.modelType().tableName;
  fixture.getItemRequests.push({
    modelName,
    id: options.id?.toString(),
    select: serialize(options.select),
  });

  if (options.modelType === TelemetryException) {
    await exceptionGate;
    if (failures.has("exception")) {
      throw new HTTPErrorResponse(
        500,
        { message: "The exception store is unavailable." },
        {},
      );
    }
    return makeException();
  }

  if (options.modelType === Service) {
    return makeService();
  }

  return null;
};

ModelAPI.getList = async (options) => {
  if (options.modelType === Service) {
    return { data: [makeService()], count: 1, skip: 0, limit: 10 };
  }
  return { data: [], count: 0, skip: 0, limit: 10 };
};
ModelAPI.getCount = async () => 0;

ModelAPI.updateById = async (options) => {
  fixture.updates.push({
    modelName: new options.modelType().tableName,
    id: options.id?.toString(),
    data: serialize(options.data),
  });
  if (failures.has("update")) {
    throw new HTTPErrorResponse(
      403,
      { message: "You do not have permission to edit this exception." },
      {},
    );
  }
  for (const key of ["isResolved", "isArchived"]) {
    if (key in options.data) {
      triage[key] = Boolean(options.data[key]);
    }
  }
  if ("markedAsResolvedAt" in options.data) {
    triage.markedAsResolvedAt = options.data.markedAsResolvedAt;
  }
  if ("markedAsArchivedAt" in options.data) {
    triage.markedAsArchivedAt = options.data.markedAsArchivedAt;
  }
  return new HTTPResponse(200, {}, {});
};

ModelAPI.deleteItem = async (options) => {
  fixture.deletes.push({
    modelName: new options.modelType().tableName,
    id: options.id?.toString(),
  });
  if (failures.has("delete")) {
    throw new HTTPErrorResponse(
      403,
      { message: "You do not have permission to delete this exception." },
      {},
    );
  }
};

AnalyticsModelAPI.getList = async (options) => {
  const modelName = new options.modelType().tableName;
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 10);
  fixture.analyticsListRequests.push({
    modelName,
    query: serialize(options.query),
    select: serialize(options.select),
    sort: serialize(options.sort),
    skip,
    limit,
  });

  let items = [];
  if (options.modelType === ExceptionInstance) {
    items = occurrences.filter((record) =>
      matchesOccurrenceQuery(record, options.query),
    );
  } else if (options.modelType === Span) {
    if (options.query && options.query.exceptionScope) {
      items = makeExceptionSpans();
    } else {
      items = occurrenceMode === "trace" ? makeSpans() : [];
    }
  } else if (options.modelType === Log) {
    items = makeLogs(options.query);
  }

  return {
    data: items.slice(skip, skip + limit),
    count: items.length,
    skip,
    limit,
  };
};

AnalyticsModelAPI.count = async (options) => {
  if (options.modelType === ExceptionInstance) {
    return occurrences.filter((record) =>
      matchesOccurrenceQuery(record, options.query),
    ).length;
  }
  return 0;
};

function ok(data) {
  return new HTTPResponse(200, data, {});
}

async function handleApi(method, options) {
  const url = options.url.toString();
  const body = serialize(options.data);
  fixture.apiRequests.push({ method, url, body });

  if (url.includes("/telemetry/exceptions/histogram")) {
    if (histogramMode === "fail") {
      throw new HTTPErrorResponse(500, { message: "Histogram failed" }, {});
    }
    return ok({
      buckets: histogramMode === "empty" ? [] : histogramBuckets(body),
    });
  }

  if (url.includes("/telemetry/traces/histogram")) {
    return ok({ buckets: spansMode === "empty" ? [] : statusHistogram(body, "error") });
  }

  if (url.includes("/telemetry/traces/facets")) {
    return ok({ facets: {} });
  }

  if (url.includes("/telemetry/logs/histogram")) {
    return ok({ buckets: statusHistogram(body, "error") });
  }

  if (url.includes("/telemetry/logs/facets")) {
    return ok({ facets: {} });
  }

  if (url.includes("/telemetry/exceptions/resolve-stack-trace")) {
    const frames = (body.frames || []).map((frame, index) => {
      const original = framesMode === "mapped" && ORIGINAL_LOCATIONS[index];
      return original
        ? { ...frame, resolved: true, ...original }
        : { ...frame, resolved: false };
    });
    return ok({
      frames,
      resolvedCount: frames.filter((frame) => frame.resolved).length,
      sourceMapCount: framesMode === "mapped" ? 3 : 0,
      sourceMapsSkippedForSize: 0,
    });
  }

  if (url.includes("/telemetry/logs/context")) {
    const at = (offset) => new Date(NOW - 4 * MINUTE + offset).toISOString();
    return ok({
      before: [
        {
          time: at(-2400),
          severityText: "INFO",
          body: "POST /api/checkout order=ord_9f2c items=3",
        },
        {
          time: at(-900),
          severityText: "WARN",
          body: "stock version changed for SKU-4821 (expected 41, got 42)",
        },
      ],
      after: [
        {
          time: at(300),
          severityText: "ERROR",
          body: "checkout failed: InventoryReservationError",
        },
      ],
    });
  }

  if (url.includes("/telemetry-exception/ai-fix-readiness/")) {
    return ok(aiReadiness());
  }

  if (url.includes("/telemetry-exception/get-ai-agent-task/")) {
    return ok({ aiAgentTasks: aiTasks() });
  }

  if (url.includes("/telemetry-exception/create-ai-agent-task/")) {
    fixture.createdTasks.push(body);
    if (failures.has("create-task")) {
      throw new HTTPErrorResponse(
        400,
        { message: "No AI agent is online for this project." },
        {},
      );
    }
    return ok({ aiAgentTaskId: TASK_IDS[body.taskType || "FixException"] });
  }

  /*
   * The occurrence table's replay links resolve session -> application
   * here. RumSession has no generic list API, so a getList stub for it
   * would describe a read the page can never make.
   */
  if (url.includes("/telemetry/rum/session-replay/resolve")) {
    const requested = Array.isArray(body.sessionIds) ? body.sessionIds : [];
    const startTime = new Date(NOW - 9 * MINUTE);

    return ok({
      sessions:
        replayMode === "session" && requested.includes(SESSION_ID)
          ? [
              {
                sessionId: SESSION_ID,
                rumApplicationId: RUM_APPLICATION_ID,
                startTime: startTime.toISOString(),
                startTimeUnixMs: startTime.getTime(),
              },
            ]
          : [],
      isApplicationScopeTruncated: false,
    });
  }

  if (url.includes("/telemetry/rum/session-replay/for-exception")) {
    return ok({
      sessions:
        replayMode === "session"
          ? [
              {
                sessionId: SESSION_ID,
                rumApplicationId: RUM_APPLICATION_ID,
                startTime: new Date(NOW - 9 * MINUTE).toISOString(),
                endTime: new Date(NOW - 2 * MINUTE).toISOString(),
                durationMs: 7 * MINUTE,
                chunkCount: 12,
                eventCount: 840,
                isFinalized: true,
                hasError: true,
                errorCount: 1,
                pageCount: 4,
                entryUrl: "https://shop.example.com/cart",
                exitUrl: "https://shop.example.com/checkout",
                browserName: "Chrome",
                browserVersion: "128",
                osName: "macOS",
                deviceType: "desktop",
                countryCode: "DE",
                identifiedUserLabel: "anna@example.com",
              },
            ]
          : [],
      isApplicationScopeTruncated: false,
    });
  }

  return ok({ data: [], count: 0 });
}

API.get = async (options) => handleApi("GET", options);
API.post = async (options) => handleApi("POST", options);

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
  return <ExceptionViewLayout />;
}

function AITaskPage() {
  const { taskId } = useParams();
  return (
    <main className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-xl font-semibold text-gray-900">AI Agent Task</h1>
      <p data-testid="ai-task-page" className="mt-2 text-sm text-gray-600">
        {taskId}
      </p>
    </main>
  );
}

function ListPage() {
  return (
    <main className="mx-auto max-w-3xl px-8 py-16">
      <h1 data-testid="exceptions-list-page" className="text-xl font-semibold">
        Exceptions
      </h1>
    </main>
  );
}

function section(value) {
  return <ExceptionView section={value} />;
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-6 py-4">
      <div className="flex items-center gap-5">
        <span className="text-lg font-semibold text-gray-900">OneUptime</span>
        <span className="text-sm text-gray-500">Commerce</span>
      </div>
      <span className="text-xs text-gray-500">
        Preview workspace · Synthetic exception
      </span>
    </header>
    <div className="mx-auto max-w-[1440px] px-4 sm:px-8">
      <Routes>
        <Route
          path="/dashboard/:projectId/exceptions/:id"
          element={<FixtureLayout />}
        >
          <Route index element={section(ExceptionDetailSection.Overview)} />
          <Route
            path="stack-trace"
            element={section(ExceptionDetailSection.StackTrace)}
          />
          <Route
            path="occurrences"
            element={section(ExceptionDetailSection.Occurrences)}
          />
          <Route
            path="context"
            element={section(ExceptionDetailSection.Context)}
          />
          <Route path="logs" element={section(ExceptionDetailSection.Logs)} />
          <Route
            path="ai-assistance"
            element={section(ExceptionDetailSection.AIAssistance)}
          />
          <Route
            path="settings"
            element={section(ExceptionDetailSection.Settings)}
          />
        </Route>
        <Route
          path="/dashboard/:projectId/ai/agents/:taskId"
          element={<AITaskPage />}
        />
        <Route
          path="/dashboard/:projectId/exceptions/unresolved"
          element={<ListPage />}
        />
      </Routes>
    </div>
  </BrowserRouter>,
);

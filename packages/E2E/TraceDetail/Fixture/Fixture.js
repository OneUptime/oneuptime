/*
 * Offline fixture for the real trace detail page.
 *
 * The layout and the Trace Explorer (waterfall, flame graph, service map,
 * span details and the correlated signals) are the production components from
 * this branch. Only the ModelAPI / AnalyticsModelAPI / API data boundary and
 * the synthetic user are replaced.
 *
 * Every record is fabricated. Scenarios are picked with query parameters:
 *
 *   ?trace=    checkout (default) | worker | large | orphans | empty
 *              checkout: 5 services, an N+1 query loop, a failed inventory
 *                        call that is retried, and a slow external payment call
 *              worker:   one service, 501 spans (loads 500, then the rest)
 *              large:    6 services, 1,250 spans (loads in 500-span batches)
 *              orphans:  spans whose parents were never received
 *              empty:    the trace has no spans
 *   ?profile=  none (default) | samples
 *   ?fail=     comma separated: spans, perf-fix, metrics, span-detail
 *   ?hold=     spans — keep the first span read pending until
 *              window.__traceFixture.releaseSpans() is called
 *   ?spanId=   the page's own highlight parameter (comma separated span ids)
 *
 * Every read and write is recorded on window.__traceFixture so a spec can
 * assert what the page asked for as well as what it drew.
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
import TracesViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Traces/View/Layout";
import TraceViewPage from "../../../App/FeatureSet/Dashboard/src/Pages/Traces/View/Index";
import Service from "Common/Models/DatabaseModels/Service";
import Span, { SpanKind, SpanStatus } from "Common/Models/AnalyticsModels/Span";
import Log from "Common/Models/AnalyticsModels/Log";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Color from "Common/Types/Color";
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
const AI_RUN_ID = "70000000-0000-4000-8000-000000000009";
const USER_ID = "80000000-0000-4000-8000-000000000001";

const traceMode = params.get("trace") || "checkout";
const profileMode = params.get("profile") || "none";
const failures = new Set(
  (params.get("fail") || "").split(",").filter((value) => value.length > 0),
);
const holdSpans = params.get("hold") === "spans";

const MINUTE = 60 * 1000;
/*
 * Every time is relative to page load. The spec pins the browser clock with
 * page.clock, so relative labels stay deterministic there.
 */
const NOW = Date.now();
const TRACE_START_MS = NOW - 3 * MINUTE;

export const TRACE_IDS = {
  checkout: "4bf92f3577b34da6a3ce929d0e0e4736",
  worker: "6aa85538140714b4892cd8f500735c51",
  large: "9c1d2e3f4a5b6c7d8e9fa0b1c2d3e4f5",
  orphans: "0af7651916cd43dd8448eb211c80319c",
  empty: "00000000000000000000000000000001",
};

const SERVICE_DEFINITIONS = {
  "api-gateway": {
    id: "60000000-0000-4000-8000-000000000001",
    color: "#6366f1",
  },
  "checkout-service": {
    id: "60000000-0000-4000-8000-000000000002",
    color: "#10b981",
  },
  "inventory-service": {
    id: "60000000-0000-4000-8000-000000000003",
    color: "#f59e0b",
  },
  "payment-service": {
    id: "60000000-0000-4000-8000-000000000004",
    color: "#ec4899",
  },
  "notification-service": {
    id: "60000000-0000-4000-8000-000000000005",
    color: "#0ea5e9",
  },
  api: {
    id: "60000000-0000-4000-8000-000000000006",
    color: "#8b5cf6",
  },
  "search-service": {
    id: "60000000-0000-4000-8000-000000000007",
    color: "#14b8a6",
  },
};

const fixture = {
  modelListRequests: [],
  analyticsListRequests: [],
  analyticsCountRequests: [],
  apiRequests: [],
  releaseSpans: () => {},
};
window.__traceFixture = fixture;

const spansGate = holdSpans
  ? new Promise((resolve) => {
      fixture.releaseSpans = resolve;
    })
  : Promise.resolve();

function serialize(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function makeServices() {
  return Object.entries(SERVICE_DEFINITIONS).map(([name, definition]) => {
    return Object.assign(new Service(), {
      _id: definition.id,
      name,
      serviceColor: new Color(definition.color),
    });
  });
}

/*
 * Deterministic 16-hex-character span ids, so a spec (and a screenshot) can
 * refer to the same span on every run.
 */
function spanIdFor(index) {
  // A multiply by an odd constant is a bijection mod 2^32, so ids never repeat.
  const high = Math.imul(index + 1, 0x9e3779b1) >>> 0;
  let low = Math.imul(high ^ (high >>> 15), 0x85ebca6b) >>> 0;
  low = (low ^ (low >>> 13)) >>> 0;
  return high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
}

const KIND = {
  server: SpanKind.Server,
  client: SpanKind.Client,
  internal: SpanKind.Internal,
  producer: SpanKind.Producer,
  consumer: SpanKind.Consumer,
};

const STATUS = {
  ok: SpanStatus.Ok,
  error: SpanStatus.Error,
  unset: SpanStatus.Unset,
};

/*
 * Turn a nested definition — { name, service, kind, start, duration, status,
 * attributes, events, children } with start/duration in milliseconds from
 * the trace start — into a flat, start-sorted Span list.
 */
function buildTrace(traceId, root, options = {}) {
  const spans = [];
  let counter = 0;

  function visit(node, parentSpanId) {
    const index = counter++;
    const spanId = node.spanId || spanIdFor(index + (options.idOffset || 0));
    const startMs = TRACE_START_MS + node.start;
    const span = new Span();
    span.projectId = new ObjectID(PROJECT_ID);
    span.traceId = traceId;
    span.spanId = spanId;
    span.parentSpanId =
      node.parentSpanId !== undefined ? node.parentSpanId : parentSpanId || "";
    span.name = node.name;
    span.kind = KIND[node.kind || "internal"];
    span.statusCode = STATUS[node.status || "unset"];
    span.statusMessage = node.statusMessage || "";
    span.primaryEntityId = new ObjectID(SERVICE_DEFINITIONS[node.service].id);
    span.primaryEntityType = "OpenTelemetry";
    span.startTime = new Date(startMs);
    span.endTime = new Date(startMs + node.duration);
    span.startTimeUnixNano = Math.round(startMs * 1000000);
    span.endTimeUnixNano = Math.round(startMs * 1000000) + Math.round(node.duration * 1000000);
    span.durationUnixNano = Math.round(node.duration * 1000000);
    span.attributes = {
      "service.name": node.service,
      ...(node.attributes || {}),
    };
    span.events = (node.events || []).map((event) => {
      const time = new Date(TRACE_START_MS + event.at);
      return {
        name: event.name,
        time,
        timeUnixNano: Math.round(time.getTime() * 1000000),
        attributes: event.attributes || {},
      };
    });
    span.links = node.links || [];
    span.sessionId = "";
    spans.push(span);

    for (const child of node.children || []) {
      visit(child, spanId);
    }
  }

  visit(root, "");

  return spans.sort((left, right) => {
    return left.startTimeUnixNano - right.startTimeUnixNano;
  });
}

function productQueries(start) {
  return Array.from({ length: 12 }, (_, index) => {
    return {
      name: "SELECT products WHERE id = $1",
      service: "checkout-service",
      kind: "client",
      start: start + index * 3.6,
      duration: 3.1 + ((index * 7) % 5) * 0.2,
      status: "ok",
      attributes: {
        "db.system": "postgresql",
        "db.name": "shop",
        "db.operation": "SELECT",
        "db.statement": "SELECT id, sku, price FROM products WHERE id = $1",
        "db.product_id": `prd_${1040 + index}`,
      },
    };
  });
}

function checkoutTrace() {
  return buildTrace(TRACE_IDS.checkout, {
    name: "POST /api/v1/checkout",
    service: "api-gateway",
    kind: "server",
    start: 0,
    duration: 1284,
    status: "error",
    statusMessage: "upstream checkout-service returned 502",
    attributes: {
      "http.method": "POST",
      "http.route": "/api/v1/checkout",
      "http.status_code": 502,
      "http.user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6)",
      "net.peer.ip": "203.0.113.24",
      "user.id": "usr_48c1",
    },
    events: [
      { name: "request.accepted", at: 1, attributes: { "queue.depth": 3 } },
    ],
    children: [
      {
        name: "auth.verifyToken",
        service: "api-gateway",
        start: 3,
        duration: 18,
        status: "ok",
        attributes: { "auth.scheme": "Bearer", "auth.cache_hit": false },
        children: [
          {
            name: "redis GET session:*",
            service: "api-gateway",
            kind: "client",
            start: 5,
            duration: 2.4,
            status: "ok",
            attributes: { "db.system": "redis", "db.operation": "GET" },
          },
        ],
      },
      {
        name: "POST checkout-service /orders",
        service: "api-gateway",
        kind: "client",
        start: 24,
        duration: 1246,
        status: "error",
        attributes: {
          "http.method": "POST",
          "http.url": "http://checkout-service:8080/orders",
          "http.status_code": 502,
        },
        children: [
          {
            name: "POST /orders",
            service: "checkout-service",
            kind: "server",
            start: 27,
            duration: 1239,
            status: "error",
            statusMessage: "order ord_9f2c completed after one retry",
            attributes: {
              "http.method": "POST",
              "http.route": "/orders",
              "order.id": "ord_9f2c",
              "order.items": 12,
            },
            children: [
              {
                name: "OrderService.validateCart",
                service: "checkout-service",
                start: 30,
                duration: 58,
                status: "ok",
                attributes: { "cart.items": 12, "cart.currency": "EUR" },
                children: [
                  {
                    name: "SELECT cart_items",
                    service: "checkout-service",
                    kind: "client",
                    start: 31.5,
                    duration: 9,
                    status: "ok",
                    attributes: {
                      "db.system": "postgresql",
                      "db.statement":
                        "SELECT * FROM cart_items WHERE cart_id = $1",
                    },
                  },
                  ...productQueries(42),
                ],
              },
              {
                name: "POST inventory-service /reserve",
                service: "checkout-service",
                kind: "client",
                start: 90,
                duration: 312,
                status: "error",
                statusMessage: "409 Conflict",
                attributes: {
                  "http.method": "POST",
                  "http.url": "http://inventory-service:8080/reserve",
                  "http.status_code": 409,
                },
                children: [
                  {
                    name: "POST /reserve",
                    service: "inventory-service",
                    kind: "server",
                    start: 93,
                    duration: 306,
                    status: "error",
                    statusMessage: "stock version changed",
                    attributes: {
                      "http.route": "/reserve",
                      "http.status_code": 409,
                      "inventory.sku": "SKU-4821",
                    },
                    events: [
                      {
                        name: "exception",
                        at: 398,
                        attributes: {
                          "exception.type": "InventoryReservationError",
                          "exception.message":
                            "Could not reserve 3 units of SKU-4821: stock version changed",
                          "exception.escaped": true,
                        },
                      },
                    ],
                    children: [
                      {
                        name: "SELECT stock FOR UPDATE",
                        service: "inventory-service",
                        kind: "client",
                        start: 97,
                        duration: 84,
                        status: "ok",
                        attributes: {
                          "db.system": "postgresql",
                          "db.statement":
                            "SELECT quantity, version FROM stock WHERE sku = $1 FOR UPDATE",
                          "db.lock_wait_ms": 71,
                        },
                      },
                      {
                        name: "UPDATE stock",
                        service: "inventory-service",
                        kind: "client",
                        start: 183,
                        duration: 208,
                        status: "error",
                        statusMessage: "serialization failure",
                        attributes: {
                          "db.system": "postgresql",
                          "db.statement":
                            "UPDATE stock SET quantity = quantity - $1, version = version + 1 WHERE sku = $2 AND version = $3",
                        },
                      },
                    ],
                  },
                ],
              },
              {
                name: "POST inventory-service /reserve (retry 1)",
                service: "checkout-service",
                kind: "client",
                start: 410,
                duration: 150,
                status: "ok",
                attributes: {
                  "http.method": "POST",
                  "http.status_code": 200,
                  "http.resend_count": 1,
                },
                children: [
                  {
                    name: "POST /reserve",
                    service: "inventory-service",
                    kind: "server",
                    start: 412,
                    duration: 145,
                    status: "ok",
                    attributes: { "http.status_code": 200 },
                    children: [
                      {
                        name: "SELECT stock FOR UPDATE",
                        service: "inventory-service",
                        kind: "client",
                        start: 414,
                        duration: 16,
                        status: "ok",
                        attributes: { "db.system": "postgresql" },
                      },
                      {
                        name: "UPDATE stock",
                        service: "inventory-service",
                        kind: "client",
                        start: 431,
                        duration: 121,
                        status: "ok",
                        attributes: { "db.system": "postgresql" },
                      },
                    ],
                  },
                ],
              },
              {
                name: "POST payment-service /charge",
                service: "checkout-service",
                kind: "client",
                start: 565,
                duration: 615,
                status: "ok",
                attributes: { "http.method": "POST", "http.status_code": 200 },
                children: [
                  {
                    name: "POST /charge",
                    service: "payment-service",
                    kind: "server",
                    start: 568,
                    duration: 608,
                    status: "ok",
                    attributes: {
                      "payment.amount": 184.5,
                      "payment.currency": "EUR",
                    },
                    children: [
                      {
                        name: "FraudCheck.score",
                        service: "payment-service",
                        start: 572,
                        duration: 118,
                        status: "ok",
                        attributes: { "fraud.score": 0.07 },
                      },
                      {
                        name: "POST api.stripe.com /v1/payment_intents",
                        service: "payment-service",
                        kind: "client",
                        start: 695,
                        duration: 465,
                        status: "ok",
                        attributes: {
                          "http.method": "POST",
                          "http.url": "https://api.stripe.com/v1/payment_intents",
                          "http.status_code": 200,
                          "peer.service": "stripe",
                        },
                      },
                    ],
                  },
                ],
              },
              {
                name: "INSERT orders",
                service: "checkout-service",
                kind: "client",
                start: 1185,
                duration: 27,
                status: "ok",
                attributes: {
                  "db.system": "postgresql",
                  "db.statement": "INSERT INTO orders (...) VALUES (...)",
                },
              },
              {
                name: "kafka publish order.created",
                service: "checkout-service",
                kind: "producer",
                start: 1215,
                duration: 10,
                status: "ok",
                attributes: {
                  "messaging.system": "kafka",
                  "messaging.destination": "order.created",
                },
                children: [
                  {
                    name: "kafka consume order.created",
                    service: "notification-service",
                    kind: "consumer",
                    start: 1226,
                    duration: 38,
                    status: "ok",
                    attributes: { "messaging.system": "kafka" },
                    children: [
                      {
                        name: "SendConfirmationEmail",
                        service: "notification-service",
                        start: 1229,
                        duration: 33,
                        status: "unset",
                        attributes: { "email.template": "order-confirmation" },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        name: "render response",
        service: "api-gateway",
        start: 1272,
        duration: 10,
        status: "ok",
      },
    ],
  });
}

function workerTrace() {
  const children = [];
  let cursor = 4;
  const add = (name, duration) => {
    children.push({
      name,
      service: "api",
      start: cursor,
      duration,
      status: "unset",
      attributes: { "code.function": name },
      children:
        name === "DatabaseService.findBy"
          ? [
              {
                name: "postgres SELECT MonitorProbe",
                service: "api",
                kind: "client",
                start: cursor + 0.4,
                duration: duration - 1,
                status: "unset",
              },
            ]
          : [],
    });
    cursor += duration + 0.6;
  };
  add("DatabaseService.findOneById", 4.6);
  add("Semaphore.lock", 1.4);
  add("DatabaseService.findBy", 5.2);
  add("DatabaseService.updateColumnsByIdWithoutHooks", 2.3);
  add("MonitorMetricUtil.saveMonitorMetrics", 2.1);
  // 2 parents + 498 children + the one nested postgres span = 501 spans.
  for (let index = 0; children.length < 498; index++) {
    add(
      "APIRequestCriteria.isMonitorInstanceCriteriaFilterMet",
      index === 1 ? 23 : 0.35 + ((index * 13) % 7) * 0.05,
    );
  }
  return buildTrace(TRACE_IDS.worker, {
    name: "worker.job Telemetry/ProcessTelemetry",
    service: "api",
    kind: "consumer",
    start: 0,
    duration: 716,
    status: "unset",
    children: [
      {
        name: "MonitorResourceUtil.monitorResource",
        service: "api",
        start: 1,
        duration: 714,
        status: "unset",
        children,
      },
    ],
  });
}

function largeTrace() {
  const services = [
    "api-gateway",
    "search-service",
    "checkout-service",
    "inventory-service",
    "payment-service",
    "notification-service",
  ];
  const batches = [];
  let cursor = 12;
  for (let batch = 0; batch < 12; batch++) {
    const service = services[(batch % (services.length - 1)) + 1];
    const items = [];
    const batchStart = cursor;
    for (let index = 0; index < 100; index++) {
      items.push({
        name: `${service}.handle item_${batch}_${index}`,
        service,
        start: cursor + 0.2,
        duration: 0.8 + (index % 4) * 0.15,
        status: (batch * 100 + index) % 97 === 5 ? "error" : "ok",
        children: [],
      });
      cursor += 1.3;
    }
    batches.push({
      name: `batch ${batch + 1} · ${service}`,
      service,
      kind: "internal",
      start: batchStart,
      duration: cursor - batchStart,
      status: "ok",
      children: items,
    });
    cursor += 2;
  }
  // 1 root + 12 batches + 1,200 items + 37 tail spans = 1,250 spans.
  const tail = Array.from({ length: 37 }, (_, index) => {
    return {
      name: `cache.warm shard-${index}`,
      service: "api-gateway",
      kind: "client",
      start: cursor + index * 0.9,
      duration: 0.7,
      status: "ok",
    };
  });
  return buildTrace(TRACE_IDS.large, {
    name: "GET /api/v1/search/reindex",
    service: "api-gateway",
    kind: "server",
    start: 0,
    duration: cursor + 40,
    status: "ok",
    children: [...batches, ...tail],
  });
}

function orphanTrace() {
  return buildTrace(TRACE_IDS.orphans, {
    name: "GET /api/v1/orders/:id",
    service: "api-gateway",
    kind: "server",
    start: 0,
    duration: 180,
    status: "ok",
    children: [
      {
        name: "OrderService.load",
        service: "checkout-service",
        start: 6,
        duration: 60,
        status: "ok",
      },
      {
        name: "late span from a lost parent",
        service: "inventory-service",
        parentSpanId: "ffffffffffffffff",
        start: 80,
        duration: 44,
        status: "error",
        statusMessage: "parent span was never received",
        children: [
          {
            name: "SELECT stock",
            service: "inventory-service",
            kind: "client",
            start: 84,
            duration: 30,
            status: "ok",
          },
        ],
      },
    ],
  });
}

const TRACE_BUILDERS = {
  checkout: checkoutTrace,
  worker: workerTrace,
  large: largeTrace,
  orphans: orphanTrace,
  empty: () => [],
};

const traceId = TRACE_IDS[traceMode] || TRACE_IDS.checkout;
const traceSpans = (TRACE_BUILDERS[traceMode] || checkoutTrace)();
fixture.traceId = traceId;
fixture.spans = traceSpans.map((span) => {
  return {
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    statusCode: span.statusCode,
    serviceId: span.primaryEntityId.toString(),
  };
});

function makeLogs(query) {
  const spanId = query && query.spanId ? String(query.spanId) : "";
  // The trace's logs are its first 18 spans; any one span has its own log.
  const source = spanId
    ? traceSpans.filter((span) => span.spanId === spanId)
    : traceSpans.slice(0, 18);
  return source.map((span, index) => {
      const log = new Log();
      log.projectId = new ObjectID(PROJECT_ID);
      log.time = new Date(span.startTime.getTime() + 1);
      log.timeUnixNano = span.startTimeUnixNano + 1000000;
      log.severityText = span.statusCode === SpanStatus.Error ? "ERROR" : index % 3 === 0 ? "DEBUG" : "INFO";
      log.body =
        span.statusCode === SpanStatus.Error
          ? `${span.name} failed: ${span.statusMessage || "error"}`
          : `${span.name} started`;
      log.traceId = traceId;
      log.spanId = span.spanId;
      log.primaryEntityId = span.primaryEntityId;
      log.primaryEntityType = "OpenTelemetry";
      log.attributes = {};
      return log;
    });
}

function makeExceptions(query) {
  const spanId = query && query.spanId ? String(query.spanId) : "";
  return traceSpans
    .filter((span) => {
      return (span.events || []).some((event) => event.name === "exception");
    })
    .filter((span) => !spanId || span.spanId === spanId)
    .map((span, index) => {
      const event = span.events.find((item) => item.name === "exception");
      const record = new ExceptionInstance();
      record._id = `a0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      record.projectId = new ObjectID(PROJECT_ID);
      record.time = event.time;
      record.timeUnixNano = event.timeUnixNano;
      record.exceptionType = event.attributes["exception.type"];
      record.message = event.attributes["exception.message"];
      record.stackTrace = `${event.attributes["exception.type"]}: ${event.attributes["exception.message"]}\n    at reserveInventory (/app/dist/services/inventory.js:212:17)`;
      record.fingerprint = "9f86d081884c7d659a2feaa0c55ad015";
      record.traceId = traceId;
      record.spanId = span.spanId;
      record.spanName = span.name;
      record.primaryEntityId = span.primaryEntityId;
      record.primaryEntityType = "OpenTelemetry";
      record.attributes = {};
      record.escaped = true;
      return record;
    });
}

UserUtil.isMasterAdmin = () => true;
UserUtil.getUserId = () => new ObjectID(USER_ID);
PermissionUtil.getAllPermissions = () => [Permission.ProjectOwner];
ProjectUtil.getCurrentProjectId = () => new ObjectID(PROJECT_ID);
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });
AnalyticsModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

ModelAPI.getList = async (options) => {
  const modelName = new options.modelType().tableName;
  fixture.modelListRequests.push({
    modelName,
    query: serialize(options.query),
    select: serialize(options.select),
  });
  if (options.modelType === Service) {
    const services = makeServices();
    return { data: services, count: services.length, skip: 0, limit: 100 };
  }
  return { data: [], count: 0, skip: 0, limit: 10 };
};
ModelAPI.getItem = async () => null;
ModelAPI.getCount = async () => 0;

let firstSpanRead = true;

function matchesSpanQuery(span, query) {
  for (const [key, condition] of Object.entries(query || {})) {
    if (condition === undefined || condition === null || key === "projectId") {
      continue;
    }
    if (key === "traceId" && span.traceId !== String(condition)) {
      return false;
    }
    if (key === "spanId" && span.spanId !== String(condition)) {
      return false;
    }
  }
  return true;
}

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
  if (options.modelType === Span) {
    // The span panel's detail read names a traceId too; a trace read has no spanId.
    const isTraceRead = Boolean(
      options.query && options.query.traceId && !options.query.spanId,
    );
    if (isTraceRead && firstSpanRead) {
      firstSpanRead = false;
      await spansGate;
    }
    if (isTraceRead && failures.has("spans")) {
      throw new HTTPErrorResponse(
        500,
        { message: "The trace store is unavailable." },
        {},
      );
    }
    if (!isTraceRead && failures.has("span-detail")) {
      throw new HTTPErrorResponse(
        500,
        { message: "Could not load this span." },
        {},
      );
    }
    items = traceSpans.filter((span) => matchesSpanQuery(span, options.query));
  } else if (options.modelType === Log) {
    items = makeLogs(options.query);
  } else if (options.modelType === ExceptionInstance) {
    items = makeExceptions(options.query);
  }

  return {
    data: items.slice(skip, skip + limit),
    count: items.length,
    skip,
    limit,
  };
};

AnalyticsModelAPI.count = async (modelType, query) => {
  fixture.analyticsCountRequests.push({
    modelName: new modelType().tableName,
    query: serialize(query),
  });
  if (modelType === ExceptionInstance) {
    return makeExceptions(query).length;
  }
  if (modelType === Log) {
    return makeLogs(query).length;
  }
  return 0;
};

function ok(data) {
  return new HTTPResponse(200, data, {});
}

function histogramBuckets(body) {
  const start = new Date(body.startTime || NOW - 60 * MINUTE).getTime();
  return [0, 1, 2, 3].map((index) => {
    return {
      time: new Date(start + index * 5 * MINUTE).toISOString(),
      series: "info",
      count: 3 + index,
    };
  });
}

async function handleApi(method, options) {
  const url = options.url.toString();
  const body = serialize(options.data);
  fixture.apiRequests.push({ method, url, body });

  if (url.includes("/telemetry/profiles/trace-presence")) {
    return ok({ sampleCount: profileMode === "samples" ? 842 : 0 });
  }

  if (url.includes("/telemetry/profiles/flamegraph")) {
    return ok({
      flamegraph: {
        functionName: "root",
        fileName: "",
        lineNumber: 0,
        selfValue: 0,
        totalValue: 842,
        children: [
          {
            functionName: "PaymentService.charge",
            fileName: "src/payment.ts",
            lineNumber: 88,
            selfValue: 120,
            totalValue: 600,
            children: [
              {
                functionName: "https.request",
                fileName: "node:https",
                lineNumber: 0,
                selfValue: 480,
                totalValue: 480,
                children: [],
              },
            ],
          },
          {
            functionName: "InventoryService.reserve",
            fileName: "src/inventory.ts",
            lineNumber: 187,
            selfValue: 242,
            totalValue: 242,
            children: [],
          },
        ],
      },
      truncated: false,
    });
  }

  if (url.includes("/telemetry/metrics/for-trace")) {
    if (failures.has("metrics")) {
      throw new HTTPErrorResponse(500, { message: "Metrics are unavailable." }, {});
    }
    const spans = traceSpans.slice(0, 6);
    return ok({
      items: spans.flatMap((span, index) => {
        return [
          {
            name: "http.server.duration",
            time: span.startTime.toISOString(),
            value: span.durationUnixNano / 1000000,
            spanId: span.spanId,
            serviceId: span.primaryEntityId.toString(),
            attributes: {},
          },
          ...(index % 2 === 0
            ? [
                {
                  name: "db.client.connections.usage",
                  time: span.startTime.toISOString(),
                  value: 4 + index,
                  spanId: span.spanId,
                  serviceId: span.primaryEntityId.toString(),
                  attributes: {},
                },
              ]
            : []),
        ];
      }),
    });
  }

  if (url.includes("/ai-investigation/create-performance-fix-task")) {
    if (failures.has("perf-fix")) {
      throw new HTTPErrorResponse(
        400,
        { message: "No deterministic performance pattern was found in this trace." },
        {},
      );
    }
    return ok({ aiRunId: AI_RUN_ID });
  }

  if (url.includes("/telemetry/logs/histogram")) {
    return ok({ buckets: histogramBuckets(body) });
  }

  if (url.includes("/telemetry/logs/facets")) {
    return ok({ facets: {} });
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
  return <TracesViewLayout />;
}

function PlaceholderPage(props) {
  const routeParams = useParams();
  return (
    <main className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-xl font-semibold text-gray-900">{props.title}</h1>
      <p data-testid={props.testId} className="mt-2 text-sm text-gray-600">
        {routeParams.modelId || routeParams.taskId || ""}
        {window.location.search}
      </p>
    </main>
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
        Preview workspace · Synthetic trace
      </span>
    </header>
    <div className="mx-auto max-w-[1600px] px-4 sm:px-8">
      <Routes>
        <Route
          path="/dashboard/:projectId/traces/view/:modelId"
          element={<FixtureLayout />}
        >
          <Route index element={<TraceViewPage />} />
        </Route>
        <Route
          path="/dashboard/:projectId/ai/agents/:taskId"
          element={<PlaceholderPage title="AI Agent Task" testId="ai-task-page" />}
        />
        <Route
          path="/dashboard/:projectId/traces"
          element={<PlaceholderPage title="Traces" testId="traces-list-page" />}
        />
        <Route
          path="/dashboard/:projectId/metrics/view"
          element={<PlaceholderPage title="Metric" testId="metric-page" />}
        />
      </Routes>
    </div>
  </BrowserRouter>,
);

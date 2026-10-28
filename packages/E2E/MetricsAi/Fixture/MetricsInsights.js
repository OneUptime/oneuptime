/*
 * What Metrics' Insights tab reads (Components/Metrics/MetricsDashboard),
 * answered as the server answers it: the project's services (Service), its
 * catalogued metric types (MetricType) and the metric points of the time
 * range (Metric: a name, the service it came from, a time), newest first.
 * The page counts the distinct names per service from the points and draws
 * a card per service - the cards this fixture is for.
 *
 * Every record is fabricated. Scenarios, by query parameter:
 *
 *   ?insights= busy (default) | long | one | empty
 *              busy:  seven services and points with no service.name (the
 *                     "Unknown Service" card), from 2 to 14 metrics each,
 *                     with the names OpenTelemetry's instrumentation sends
 *              long:  the names a large estate has: services named
 *                     storefront-checkout-service-eu-west-1-production, and
 *                     metric names of 60 characters with no space in them
 *              one:   one service, three metrics
 *              empty: no points in the range, eleven metric types
 *   ?fail=     metrics - the points cannot be read
 */
import Service from "Common/Models/DatabaseModels/Service";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ObjectID from "Common/Types/ObjectID";

const params = new URLSearchParams(window.location.search);
const mode = params.get("insights") || "busy";

export const INSIGHTS_SERVICE_IDS = {
  checkout: "52310000-0000-4000-8000-0000000000a1",
  worker: "52310000-0000-4000-8000-0000000000a2",
  payments: "52310000-0000-4000-8000-0000000000a3",
  frontend: "52310000-0000-4000-8000-0000000000a4",
  inventory: "52310000-0000-4000-8000-0000000000a5",
  search: "52310000-0000-4000-8000-0000000000a6",
  notifications: "52310000-0000-4000-8000-0000000000a7",
  // Sends nothing in the range: a quiet service.
  reports: "52310000-0000-4000-8000-0000000000a8",
};

// A service's name as a small project writes it, or as a large estate does.
const NAMES = {
  checkout: ["checkout", "storefront-checkout-service-eu-west-1-production"],
  worker: ["worker", "storefront-background-jobs-worker-eu-west-1"],
  payments: ["payments", "storefront-payments-gateway-eu-west-1-production"],
  frontend: ["frontend-web", "storefront-web-frontend-nextjs-eu-west-1"],
  inventory: ["inventory", "warehouse-inventory-reconciliation-batch"],
  search: ["search", "catalogue-search-indexer-opensearch-eu-west-1"],
  notifications: ["notifications", "customer-notifications-email-sms-push"],
  reports: ["reports", "finance-month-end-reports-generator"],
};

const COLORS = {
  checkout: "#6366f1",
  worker: "#0ea5e9",
  payments: "#10b981",
  frontend: "#f59e0b",
  inventory: "#ef4444",
  search: "#8b5cf6",
  notifications: "#14b8a6",
  reports: "#64748b",
};

/*
 * The metric names each service sends: OpenTelemetry's semantic
 * conventions, and the custom names a team adds. In the long scenario a
 * name has 60 characters and no space - a dotted name cannot wrap.
 */
const LONG_NAME_PREFIX = "com.acme.storefront.checkout.payment_authorization.";

function metricNames(service) {
  const long = mode === "long";
  const names = {
    checkout: [
      "http.server.request.duration",
      "http.server.active_requests",
      "http.client.request.duration",
      "db.client.connections.usage",
      "db.client.operation.duration",
      "process.cpu.time",
      "process.memory.usage",
      "jvm.memory.used",
      "jvm.gc.duration",
      "checkout.orders.placed",
      "checkout.cart.value",
      "checkout.payment.retries",
      "messaging.publish.duration",
      long
        ? `${LONG_NAME_PREFIX}retry_backoff_seconds_bucket`
        : "rpc.server.duration",
    ],
    worker: [
      "messaging.process.duration",
      "messaging.receive.messages",
      "kafka.consumer.records_lag_max",
      "process.cpu.time",
      "process.memory.usage",
      "worker.jobs.completed",
      "worker.jobs.failed",
      long
        ? "process.runtime.jvm.memory.usage_after_last_gc.tenured_generation"
        : "worker.jobs.duration",
    ],
    payments: [
      "http.server.request.duration",
      "http.client.request.duration",
      "payments.authorizations.declined",
      "payments.authorizations.approved",
      "process.cpu.time",
      long
        ? `${LONG_NAME_PREFIX}gateway_round_trip_milliseconds`
        : "payments.refunds",
    ],
    frontend: [
      "http.server.request.duration",
      "nodejs.eventloop.delay.p99",
      "v8js.memory.heap.used",
      "process.cpu.utilization",
      "frontend.render.duration",
    ],
    inventory: [
      "db.client.operation.duration",
      "db.client.connections.usage",
      "inventory.reconciliation.mismatches",
      "system.cpu.utilization",
    ],
    search: [
      "http.client.request.duration",
      "search.index.documents",
      "system.memory.usage",
    ],
    notifications: ["messaging.publish.duration", "notifications.sent"],
  };

  return names[service] || [];
}

function serviceName(key) {
  return NAMES[key][mode === "long" ? 1 : 0];
}

function serviceKeys() {
  if (mode === "one") {
    return ["checkout"];
  }
  return Object.keys(INSIGHTS_SERVICE_IDS);
}

// The project's services, by name, as the page asks for them.
export function insightsServices() {
  return serviceKeys()
    .map((key) => {
      const service = new Service();
      service._id = INSIGHTS_SERVICE_IDS[key];
      service.name = serviceName(key);
      service.serviceColor = COLORS[key];
      return service;
    })
    .sort((a, b) => {
      return a.name.localeCompare(b.name);
    });
}

// The catalogued metric types: every name any service has ever sent.
export function insightsMetricTypes() {
  const names = new Set();
  for (const key of Object.keys(INSIGHTS_SERVICE_IDS)) {
    for (const name of metricNames(key)) {
      names.add(name);
    }
  }
  return Array.from(names)
    .sort()
    .slice(0, mode === "empty" ? 11 : undefined)
    .map((name) => {
      const type = new MetricType();
      type.name = name;
      return type;
    });
}

/*
 * The range's points, newest first: three a name for each service, and -
 * when every service reports - two names sent with no service.name, which
 * the server tags with the project's id ("Unknown Service").
 */
export function insightsMetrics(projectId, now) {
  if (mode === "empty") {
    return [];
  }

  const points = [];
  let minute = 0;

  const add = (entityId, name) => {
    for (let index = 0; index < 3; index++) {
      const point = new Metric();
      point.name = name;
      point.primaryEntityId = new ObjectID(entityId);
      point.time = new Date(now - (minute + index * 7) * 60 * 1000);
      points.push(point);
    }
    minute += 1;
  };

  for (const key of serviceKeys()) {
    for (const name of metricNames(key)) {
      add(INSIGHTS_SERVICE_IDS[key], name);
    }
  }

  if (mode !== "one") {
    add(projectId, "otelcol_exporter_sent_metric_points");
    add(projectId, "otelcol_receiver_refused_metric_points");
  }

  return points.sort((a, b) => {
    return b.time.getTime() - a.time.getTime();
  });
}

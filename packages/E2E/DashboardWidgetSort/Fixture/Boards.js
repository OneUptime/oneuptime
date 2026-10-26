/*
 * The fixture's dashboard and the rows its widgets list, shared by the
 * dashboard inside OneUptime (AppFixture.js) and the public one
 * (PublicFixture.js).
 *
 * One dashboard ("Operations wall") with a widget of each way a list or a
 * table sorts (issue #5082): a monitor list (a status by its priority), a
 * pod list (a phase read rank by rank), an incident list (a severity by the
 * project's order), the security events list (ClickHouse), a trace table
 * (groups the server ranks) and a metric table (rows the widget sorts
 * itself). Its public copy shows the monitor and pod lists.
 *
 * The lists are answered the way the database answers them: each read is
 * filtered by the conditions it names and ordered by the order it asks for
 * - nested fields, `nulls: "LAST"` and Postgres's own null placement
 * included - then cut to its limit (readTable). So a test reads both what
 * the widget asked for and the rows it then drew.
 */
import Color from "Common/Types/Color";
import ObjectID from "Common/Types/ObjectID";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import DashboardMonitorListComponentUtil from "Common/Utils/Dashboard/Components/DashboardMonitorListComponent";
import DashboardKubernetesPodListComponentUtil from "Common/Utils/Dashboard/Components/DashboardKubernetesPodListComponent";
import DashboardIncidentListComponentUtil from "Common/Utils/Dashboard/Components/DashboardIncidentListComponent";
import DashboardSecurityEventsListComponentUtil from "Common/Utils/Dashboard/Components/DashboardSecurityEventsListComponent";
import DashboardTraceTableComponentUtil from "Common/Utils/Dashboard/Components/DashboardTraceTableComponent";
import DashboardTableComponentUtil from "Common/Utils/Dashboard/Components/DashboardTableComponent";

export const PROJECT_ID = "10000000-0000-4000-8000-0000000000e1";

export const DASHBOARD_ID = "db000000-0000-4000-8000-0000000000e1";

export const WIDGETS = {
  monitors: "c0000000-0000-4000-8000-0000000000e1",
  pods: "c0000000-0000-4000-8000-0000000000e2",
  incidents: "c0000000-0000-4000-8000-0000000000e3",
  security: "c0000000-0000-4000-8000-0000000000e4",
  traces: "c0000000-0000-4000-8000-0000000000e5",
  metrics: "c0000000-0000-4000-8000-0000000000e6",
};

export const METRIC_TYPES = [["http.server.request.count", ""]];

const place = (component, data) => {
  component.componentId = new ObjectID(data.id);
  component.topInDashboardUnits = data.top;
  component.leftInDashboardUnits = data.left;
  component.widthInDashboardUnits = data.width;
  component.heightInDashboardUnits = data.height;
  component.arguments = data.arguments;
  return component;
};

/*
 * The dashboard's config as the server stores it. `isPublic` keeps the
 * widgets a public dashboard draws.
 */
export const buildConfig = (options) => {
  const components = [
    place(DashboardMonitorListComponentUtil.getDefaultComponent(), {
      id: WIDGETS.monitors,
      top: 0,
      left: 0,
      width: 6,
      height: 4,
      arguments: { title: "Monitors", maxRows: 25 },
    }),
    place(DashboardKubernetesPodListComponentUtil.getDefaultComponent(), {
      id: WIDGETS.pods,
      top: 0,
      left: 6,
      width: 6,
      height: 4,
      arguments: { title: "Pods", maxRows: 25 },
    }),
  ];

  if (!options || !options.isPublic) {
    components.push(
      place(DashboardIncidentListComponentUtil.getDefaultComponent(), {
        id: WIDGETS.incidents,
        top: 4,
        left: 0,
        width: 6,
        height: 4,
        arguments: { title: "Incidents", maxRows: 25 },
      }),
      place(DashboardSecurityEventsListComponentUtil.getDefaultComponent(), {
        id: WIDGETS.security,
        top: 4,
        left: 6,
        width: 6,
        height: 4,
        arguments: { title: "Security events", limit: 10 },
      }),
      place(DashboardTraceTableComponentUtil.getDefaultComponent(), {
        id: WIDGETS.traces,
        top: 8,
        left: 0,
        width: 12,
        height: 4,
        arguments: {
          title: "Busiest endpoints",
          groupByAttribute: "name",
          topLimit: 10,
        },
      }),
      place(DashboardTableComponentUtil.getDefaultComponent(), {
        id: WIDGETS.metrics,
        top: 12,
        left: 0,
        width: 12,
        height: 4,
        arguments: {
          tableTitle: "Requests by service",
          columns: [
            {
              id: "requests",
              variable: "a",
              header: "Requests",
              kind: "Metric",
              metricName: "http.server.request.count",
              aggregation: "Sum",
            },
          ],
          groupByAttributes: [{ key: "service.name", header: "Service" }],
          maxRows: 25,
        },
      }),
    );
  }

  return {
    _type: "DashboardViewConfig",
    components,
    heightInDashboardUnits: options && options.isPublic ? 4 : 16,
  };
};

/*
 * A second dashboard (?board=narrow) for the headers' room: a metric table
 * at its narrowest, whose long headers must wrap rather than widen it, and
 * the security events list at its narrowest and at its default width, one
 * line per event at both.
 */
export const NARROW_WIDGETS = {
  metrics: "c0000000-0000-4000-8000-0000000000f1",
  security: "c0000000-0000-4000-8000-0000000000f2",
  narrowSecurity: "c0000000-0000-4000-8000-0000000000f3",
};

export const buildNarrowConfig = () => {
  return {
    _type: "DashboardViewConfig",
    components: [
      place(DashboardTableComponentUtil.getDefaultComponent(), {
        id: NARROW_WIDGETS.metrics,
        top: 0,
        left: 0,
        width: 4,
        height: 4,
        arguments: {
          tableTitle: "Requests per minute",
          columns: [
            {
              id: "requests",
              variable: "a",
              header: "Requests per minute",
              kind: "Metric",
              metricName: "http.server.request.count",
              aggregation: "Sum",
            },
          ],
          groupByAttributes: [{ key: "service.name", header: "Service name" }],
          maxRows: 25,
        },
      }),
      place(DashboardSecurityEventsListComponentUtil.getDefaultComponent(), {
        id: NARROW_WIDGETS.narrowSecurity,
        top: 0,
        left: 4,
        width: 6,
        height: 4,
        arguments: { title: "Security events at their narrowest", limit: 10 },
      }),
      place(DashboardSecurityEventsListComponentUtil.getDefaultComponent(), {
        id: NARROW_WIDGETS.security,
        top: 4,
        left: 0,
        width: 8,
        height: 5,
        arguments: { title: "Security events", limit: 10 },
      }),
    ],
    heightInDashboardUnits: 9,
  };
};

// ---- the rows -------------------------------------------------------------

const MINUTE = 60 * 1000;

const status = (name, priority, color) => {
  return { name, priority, color: new Color(color) };
};

const OPERATIONAL = status("Operational", 1, "#10b981");
const DEGRADED = status("Degraded", 2, "#f59e0b");
const OFFLINE = status("Offline", 3, "#ef4444");

export const monitors = () => {
  return [
    ["api-gateway", OPERATIONAL, "API"],
    ["billing", OFFLINE, "Website"],
    ["checkout", DEGRADED, "Website"],
    ["search", OPERATIONAL, "API"],
    ["auth", OFFLINE, "API"],
  ].map(([name, currentStatus, monitorType], index) => {
    return {
      _id: `b0000000-0000-4000-8000-00000000010${index}`,
      name,
      monitorType,
      currentMonitorStatus: { ...currentStatus },
    };
  });
};

export const pods = () => {
  return [
    ["web-1", "shop", "Running"],
    ["web-2", "shop", "Running"],
    ["batch-7", "jobs", "Succeeded"],
    ["payments-0", "shop", "Pending"],
    ["worker-3", "jobs", "Failed"],
    ["cache-1", "shop", "Unknown"],
  ].map(([name, namespaceKey, phase], index) => {
    return {
      _id: `b0000000-0000-4000-8000-00000000020${index}`,
      kind: "Pod",
      name,
      namespaceKey,
      phase,
      kubernetesClusterId: new ObjectID("b0000000-0000-4000-8000-000000000299"),
      kubernetesCluster: { name: "prod" },
    };
  });
};

// A title as long as an incident's often is.
export const LONG_INCIDENT_TITLE =
  "Elevated 5xx on the public API gateway after the 14.0.80 deploy to eu-west-1";

export const incidents = (now, options) => {
  const state = (name, order, color) => {
    return { name, order, color: new Color(color) };
  };
  const severity = (name, order, color) => {
    return { name, order, color: new Color(color) };
  };

  return [
    [
      options && options.longTitles ? LONG_INCIDENT_TITLE : "Checkout errors",
      state("Identified", 1, "#ef4444"),
      severity("Critical", 1, "#b91c1c"),
      60,
    ],
    [
      "Slow search",
      state("Acknowledged", 2, "#f59e0b"),
      severity("Minor", 3, "#64748b"),
      30,
    ],
    [
      "Login failures",
      state("Identified", 1, "#ef4444"),
      severity("Major", 2, "#ea580c"),
      180,
    ],
    [
      "Old certificate warning",
      state("Resolved", 3, "#10b981"),
      severity("Minor", 3, "#64748b"),
      2 * 24 * 60,
    ],
  ].map(
    ([title, currentIncidentState, incidentSeverity, minutesAgo], index) => {
      return {
        _id: `b0000000-0000-4000-8000-00000000030${index}`,
        title,
        createdAt: new Date(now - minutesAgo * MINUTE),
        currentIncidentState,
        incidentSeverity,
      };
    },
  );
};

export const securityEvents = (now) => {
  return [
    [60, "High", 4, "Authentication", "Failed login for root", "bastion-1"],
    [45, "Low", 2, "Network Activity", "Port scan blocked", "edge-2"],
    [30, "Critical", 5, "Authentication", "Brute force detected", "bastion-1"],
    [
      15,
      "Informational",
      1,
      "File System Activity",
      "Config file read",
      "app-3",
    ],
  ].map(([minutesAgo, severityName, severityId, className, message, host]) => {
    return {
      time: new Date(now - minutesAgo * MINUTE),
      severityName,
      severityId,
      className,
      message,
      principalHost: host,
    };
  });
};

export const traceGroups = () => {
  return [
    ["GET /cart", 1200, 4, 35],
    ["POST /pay", 300, 41, 220],
    ["GET /search", 900, 0, 80],
    ["POST /login", 450, 12, 150],
  ].map(([name, count, errorCount, avg]) => {
    return {
      groupValues: { name },
      count,
      errorCount,
      avgDurationMs: avg,
      p50DurationMs: avg * 0.8,
      p90DurationMs: avg * 1.6,
      p95DurationMs: avg * 2,
      p99DurationMs: avg * 3,
      minDurationMs: avg / 10,
      maxDurationMs: avg * 5,
    };
  });
};

// The metric table's requests per service, one value each.
export const REQUESTS_BY_SERVICE = [
  ["checkout", 120],
  ["search", 30],
  ["billing", 410],
  ["auth", 70],
];

// ---- answering a list as the database would ---------------------------------

const valueAt = (row, dottedPath) => {
  let value = row;

  for (const part of dottedPath.split(".")) {
    if (value === null || value === undefined) {
      return null;
    }

    value = value[part];
  }

  return value === undefined ? null : value;
};

// A sort as its entries, in order: { path, direction, nulls }.
const sortEntries = (sort, prefix) => {
  const entries = [];

  for (const key of Object.keys(sort || {})) {
    const value = sort[key];
    const path = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "string") {
      entries.push({ path, direction: value, nulls: null });
    } else if (value && typeof value === "object" && value.direction) {
      entries.push({
        path,
        direction: value.direction,
        nulls: value.nulls || null,
      });
    } else if (value && typeof value === "object") {
      entries.push(...sortEntries(value, path));
    }
  }

  return entries;
};

const comparable = (value) => {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  return value;
};

const compareRows = (entries) => {
  return (a, b) => {
    for (const entry of entries) {
      const isDescending = entry.direction === "DESC";
      // Postgres: no value after every value ascending, before descending.
      const nullsLast = entry.nulls ? entry.nulls === "LAST" : !isDescending;
      const av = valueAt(a, entry.path);
      const bv = valueAt(b, entry.path);

      if (av === null && bv === null) {
        continue;
      }

      if (av === null || bv === null) {
        return (av === null) === nullsLast ? 1 : -1;
      }

      const ac = comparable(av);
      const bc = comparable(bv);

      if (ac === bc) {
        continue;
      }

      const ascending = ac < bc ? -1 : 1;

      return isDescending ? -ascending : ascending;
    }

    return 0;
  };
};

const matches = (row, query) => {
  for (const key of Object.keys(query || {})) {
    const condition = query[key];
    const value = valueAt(row, key);

    if (condition instanceof Includes) {
      if (!condition.values.includes(value)) {
        return false;
      }
    } else if (condition instanceof IncludesNone) {
      if (value === null || condition.values.includes(value)) {
        return false;
      }
    } else if (condition instanceof IsNull) {
      if (value !== null) {
        return false;
      }
    } else if (condition instanceof NotNull) {
      if (value === null) {
        return false;
      }
    } else if (
      key === "phase" ||
      key === "kind" ||
      typeof condition === "boolean"
    ) {
      if (value !== condition) {
        return false;
      }
    }
  }

  return true;
};

export const readTable = (data) => {
  return data.rows
    .filter((row) => {
      return matches(row, data.query);
    })
    .sort(compareRows(sortEntries(data.sort)))
    .slice(0, data.limit || data.rows.length);
};

// The phase condition a read names, for the record: "Failed", "other", ...
export const describePhase = (query) => {
  const phase = query && query["phase"];

  if (phase instanceof Includes) {
    return phase.values.join("+");
  }

  if (phase instanceof IncludesNone) {
    return "other";
  }

  if (phase instanceof IsNull) {
    return "none";
  }

  return null;
};

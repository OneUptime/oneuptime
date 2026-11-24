/*
 * The fixture's project (issue #10409): its dashboards.
 *
 *   overview   Production overview  the product's Metrics Dashboard template,
 *                                   its title widget renamed after it, saved
 *                                   on Past 1 Day with auto-refresh off
 *   clusters   Kubernetes clusters  the same template, on Past 1 Hour
 *   notes      Team notes           no widget yet
 *
 * The Metrics template carries a `service` variable (a telemetry
 * attribute) and a log stream, so the toolbar shows a variable's picker and
 * the board reads logs as well as metrics.
 */
import {
  DashboardTemplateType,
  getTemplateConfig,
} from "Common/Types/Dashboard/DashboardTemplates";

export const PROJECT_ID = "10000000-0000-4000-8000-0000000000f1";

const dashboardId = (value) => {
  return `db000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
};

export const DASHBOARDS = {
  overview: {
    id: dashboardId(1),
    name: "Production overview",
    description: "Requests, latency and errors across the fleet",
    timeRange: "Past 1 Day",
  },
  clusters: {
    id: dashboardId(2),
    name: "Kubernetes clusters",
    description: "Nodes, pods and namespaces",
    timeRange: "Past 1 Hour",
  },
  notes: {
    id: dashboardId(3),
    name: "Team notes",
    description: "",
    isEmpty: true,
  },
};

export const getDashboardById = (id) => {
  const wanted = String(id || "").toLowerCase();

  return (
    Object.values(DASHBOARDS).find((dashboard) => {
      return dashboard.id === wanted;
    }) || null
  );
};

/*
 * The dashboard's config as the server stores it: the Metrics template,
 * its title widget saying the dashboard's name, and the dashboard's own
 * default time range - or a board with no widget yet.
 */
export const buildConfig = (dashboard) => {
  const config = getTemplateConfig(DashboardTemplateType.Metrics);

  if (dashboard.isEmpty) {
    config.components = [];
    config.variables = [];
    return config;
  }

  for (const component of config.components || []) {
    if (
      component.componentType === "Text" &&
      component.arguments &&
      component.arguments.text === "Metrics Dashboard"
    ) {
      component.arguments.text = dashboard.name;
    }
  }

  if (dashboard.timeRange) {
    config.timeRange = dashboard.timeRange;
  }

  return config;
};

const MINUTE = 60 * 1000;

// A smooth, repeatable curve: index -> 0..1.
const wave = (index, phase) => {
  return (
    0.5 +
    0.32 * Math.sin(index / 6 + phase) +
    0.12 * Math.sin(index / 2.3 + phase * 1.7)
  );
};

const phaseOf = (text) => {
  let phase = 0;

  for (let index = 0; index < text.length; index++) {
    phase += text.charCodeAt(index) / 97;
  }

  return phase;
};

// Points across [start, end], as the metrics API answers an aggregate.
export const seriesFor = (data) => {
  const isTotal = data.aggregationInterval === "Total";
  const points = isTotal ? 1 : 48;
  const step = Math.max((data.end - data.start) / points, MINUTE);
  const phase = phaseOf(data.metricName || "");
  const scale = (data.metricName || "").indexOf("duration") >= 0 ? 400 : 100;
  const series = [];

  for (let index = 0; index < points; index++) {
    series.push({
      timestamp: new Date(data.start + index * step),
      value: Math.round(wave(index, phase) * scale * 100) / 100,
    });
  }

  return series;
};

export const METRIC_TYPES = [
  ["http.server.request.count", ""],
  ["http.server.request.duration", "ms"],
  ["http.server.request.error_rate", "%"],
  ["http.server.active_requests", ""],
  ["http.server.response.body.size", "bytes"],
];

/*
 * The fixture's dashboards, shared by the dashboard inside OneUptime
 * (AppFixture.js) and the public one (PublicFixture.js): the product's own
 * Metrics Dashboard template - values and charts that read metrics over the
 * dashboard's time range - saved with the defaults each scenario names.
 *
 * Which dashboard a page shows is its id:
 *
 *   wall     a wall screen's board: Past 1 Day, refreshing every minute
 *   plain    one saved before the defaults existed: no time range, no
 *            auto-refresh - the past hour, with auto-refresh off
 *   weekly   Past 1 Week, auto-refresh off
 *   empty    a new dashboard with no widget yet: its editor's only step is
 *            to add one, so its editing toolbar has no defaults row
 *
 * Every metric read is answered with a smooth, repeatable curve across the
 * window it asks for, and recorded with that window, so a test can say
 * which time range the widgets read.
 */
import {
  DashboardTemplateType,
  getTemplateConfig,
} from "Common/Types/Dashboard/DashboardTemplates";

export const PROJECT_ID = "10000000-0000-4000-8000-0000000000d1";

const dashboardId = (value) => {
  return `db000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
};

export const DASHBOARDS = {
  wall: {
    id: dashboardId(1),
    name: "Production wall screen",
    timeRange: "Past 1 Day",
    refreshInterval: "1m",
  },
  plain: {
    id: dashboardId(2),
    name: "Checkout API",
  },
  weekly: {
    id: dashboardId(3),
    name: "Weekly trends",
    timeRange: "Past 1 Week",
    refreshInterval: "off",
  },
  empty: {
    id: dashboardId(4),
    name: "New dashboard",
    isEmpty: true,
  },
};

export const getScenario = (id) => {
  for (const key of Object.keys(DASHBOARDS)) {
    if (DASHBOARDS[key].id === String(id || "").toLowerCase()) {
      return { key, ...DASHBOARDS[key] };
    }
  }

  return null;
};

/*
 * The dashboard's config as the server stores it: the Metrics template's
 * widgets, and the scenario's defaults - none at all for a dashboard saved
 * before them.
 */
export const buildConfig = (scenario) => {
  const config = getTemplateConfig(DashboardTemplateType.Metrics);

  if (scenario.isEmpty) {
    config.components = [];
  }

  if (scenario.timeRange) {
    config.timeRange = scenario.timeRange;
  }

  if (scenario.refreshInterval) {
    config.refreshInterval = scenario.refreshInterval;
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

/*
 * Points across [start, end] - one for a whole-window value - as the
 * metrics API answers an aggregate.
 */
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

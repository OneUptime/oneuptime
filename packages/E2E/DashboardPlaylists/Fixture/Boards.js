/*
 * The fixture's project (issue #5235): its dashboards and its playlists.
 *
 * Every dashboard is the product's Metrics Dashboard template, its title
 * widget renamed after it, saved with its own default time range and
 * auto-refresh, so a test can tell the boards apart and see each opens on
 * its own. Which dashboards a viewer may read is what the API would answer:
 *
 *   overview   Production overview  Past 1 Day, refreshing every minute
 *   clusters   Kubernetes clusters  Past 1 Hour
 *   databases  Databases            Past 1 Week
 *   archived   Old checkout         archived: listed on the playlist's
 *                                   page, never played
 *   private    Finance              in the project, but this viewer may not
 *                                   read it: the API leaves it out
 *   deleted    -                    no such dashboard any more
 *
 * The playlists name them in this order:
 *
 *   wall       NOC wall             overview, clusters, databases; a minute
 *   skipping   Night shift          archived, private, overview, deleted,
 *                                   clusters; 30 seconds
 *   single     Lobby screen         overview alone; 15 seconds
 *   empty      Draft                none yet
 *   gone       Retired screens      deleted alone: nothing the viewer may see
 *   repeat     Overview first       overview, clusters, overview, databases
 */
import {
  DashboardTemplateType,
  getTemplateConfig,
} from "Common/Types/Dashboard/DashboardTemplates";

export const PROJECT_ID = "10000000-0000-4000-8000-0000000000e1";

const dashboardId = (value) => {
  return `db000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
};

const playlistId = (value) => {
  return `91000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
};

export const DASHBOARDS = {
  overview: {
    id: dashboardId(1),
    name: "Production overview",
    timeRange: "Past 1 Day",
    refreshInterval: "1m",
  },
  clusters: {
    id: dashboardId(2),
    name: "Kubernetes clusters",
    timeRange: "Past 1 Hour",
  },
  databases: {
    id: dashboardId(3),
    name: "Databases",
    timeRange: "Past 1 Week",
  },
  archived: {
    id: dashboardId(4),
    name: "Old checkout",
    isArchived: true,
  },
  private: {
    id: dashboardId(5),
    name: "Finance",
    // In the project, but not this viewer's to read.
    isReadable: false,
  },
  deleted: {
    id: dashboardId(6),
    // Gone: no name, no record.
    isDeleted: true,
  },
};

// The dashboards the API would answer this viewer with.
export const isReadableDashboard = (dashboard) => {
  return (
    Boolean(dashboard) && !dashboard.isDeleted && dashboard.isReadable !== false
  );
};

export const getDashboardById = (id) => {
  const wanted = String(id || "").toLowerCase();

  return (
    Object.values(DASHBOARDS).find((dashboard) => {
      return dashboard.id === wanted;
    }) || null
  );
};

const entries = (...keys) => {
  return keys.map((key) => {
    return { dashboardId: DASHBOARDS[key].id };
  });
};

export const PLAYLISTS = {
  wall: {
    id: playlistId(1),
    name: "NOC wall",
    dashboards: entries("overview", "clusters", "databases"),
    intervalInSeconds: 60,
  },
  skipping: {
    id: playlistId(2),
    name: "Night shift",
    dashboards: entries(
      "archived",
      "private",
      "overview",
      "deleted",
      "clusters",
    ),
    intervalInSeconds: 30,
  },
  single: {
    id: playlistId(3),
    name: "Lobby screen",
    dashboards: entries("overview"),
    intervalInSeconds: 15,
  },
  empty: {
    id: playlistId(4),
    name: "Draft",
    dashboards: [],
    intervalInSeconds: 60,
  },
  gone: {
    id: playlistId(5),
    name: "Retired screens",
    dashboards: entries("deleted"),
    intervalInSeconds: 60,
  },
  repeat: {
    id: playlistId(6),
    name: "Overview first",
    dashboards: entries("overview", "clusters", "overview", "databases"),
    intervalInSeconds: 45,
  },
};

// A playlist id no playlist has: deleted, or never there.
export const MISSING_PLAYLIST_ID = playlistId(99);

/*
 * The dashboard's config as the server stores it: the Metrics template,
 * its title widget saying the dashboard's name, and the dashboard's own
 * defaults.
 */
export const buildConfig = (dashboard) => {
  const config = getTemplateConfig(DashboardTemplateType.Metrics);

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

  if (dashboard.refreshInterval) {
    config.refreshInterval = dashboard.refreshInterval;
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

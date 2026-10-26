/*
 * What the fixture's status page API answers: a status page as a customer
 * would set one up, built from the real models and serialized the way the
 * real API serializes them, so the app parses it exactly as it parses a
 * production answer.
 *
 * A page with a logo made for a light background (dark lettering on
 * nothing) - and, with hasDarkLogo, one made for the dark theme too
 * (light lettering) - a description, an announcement, an incident in progress, a
 * maintenance event, a list group whose history shows every bar colour
 * the recommended rules give a day - and days with no data - and a grid
 * group. Colours are the product's defaults for new projects.
 */
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import File from "Common/Models/DatabaseModels/File";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageHistoryChartBarColorRule from "Common/Models/DatabaseModels/StatusPageHistoryChartBarColorRule";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import Color from "Common/Types/Color";
import ObjectID from "Common/Types/ObjectID";
import { RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES } from "Common/Utils/StatusPage/HistoryChartBarColors";
// data: URLs (Common/UI/esbuild-config's file loader).
import LOGO_DATA_URL from "./logo.svg";
import DARK_LOGO_DATA_URL from "./logo-dark.svg";

export const id = (value) => {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
};

export const PAGE_ID = id(1);
export const INCIDENT_ID = id(500);
export const ANNOUNCEMENT_ID = id(600);
export const MAINTENANCE_ID = id(700);

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/*
 * The logo (logo.svg): dark lettering and an indigo mark on nothing, the
 * way most logos are made for a light page. The sign-in pages load it from
 * the API's /logo route, which the fixture's server answers with the file.
 * The logo for the dark theme (logo-dark.svg) is light lettering, from
 * /dark-theme-logo.
 */
const logoBytes = (dataUrl) => {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = [];

  for (let index = 0; index < binary.length; index++) {
    bytes.push(binary.charCodeAt(index));
  }

  return bytes;
};

const logoFile = () => {
  const file = new File();
  file._id = id(900);
  file.name = "acme-logo.svg";
  file.fileType = "image/svg+xml";
  return file;
};

const darkLogoFile = () => {
  const file = new File();
  file._id = id(901);
  file.name = "acme-logo-dark.svg";
  file.fileType = "image/svg+xml";
  return file;
};

/*
 * The logos' bytes as the API sends them: a Node Buffer, which
 * JSON.stringify writes as { type: "Buffer", data: [...] }.
 */
const withLogoBytes = (statusPageJson) => {
  statusPageJson.logoFile.file = {
    _type: "Buffer",
    value: { type: "Buffer", data: logoBytes(LOGO_DATA_URL) },
  };

  if (statusPageJson.darkThemeLogoFile) {
    statusPageJson.darkThemeLogoFile.file = {
      _type: "Buffer",
      value: { type: "Buffer", data: logoBytes(DARK_LOGO_DATA_URL) },
    };
  }

  return statusPageJson;
};

const status = (value, name, color, priority, isOperationalState) => {
  return Object.assign(new MonitorStatus(), {
    _id: id(value),
    name,
    color: new Color(color),
    priority,
    isOperationalState,
  });
};

// The statuses a new project starts with.
export const OPERATIONAL = status(2, "Operational", "#2ab57d", 1, true);
export const DEGRADED = status(3, "Degraded", "#ffbf53", 2, false);
export const OFFLINE = status(4, "Offline", "#fd625e", 3, false);

const STATUSES = [OPERATIONAL, DEGRADED, OFFLINE];

const severity = Object.assign(new IncidentSeverity(), {
  _id: id(20),
  name: "Major Incident",
  color: new Color("#fd625e"),
  order: 2,
});

const identified = Object.assign(new IncidentState(), {
  _id: id(21),
  name: "Identified",
  color: new Color("#fd625e"),
  order: 1,
  isCreatedState: true,
});

const resolved = Object.assign(new IncidentState(), {
  _id: id(22),
  name: "Resolved",
  color: new Color("#2ab57d"),
  order: 3,
  isResolvedState: true,
});

const maintenanceOngoing = Object.assign(new ScheduledMaintenanceState(), {
  _id: id(23),
  name: "Ongoing",
  color: new Color("#ffbf53"),
  order: 2,
  isOngoingState: true,
});

const maintenanceScheduled = Object.assign(new ScheduledMaintenanceState(), {
  _id: id(24),
  name: "Scheduled",
  color: new Color("#6366f1"),
  order: 1,
  isScheduledState: true,
});

const listGroup = Object.assign(new StatusPageGroup(), {
  _id: id(10),
  name: "Core services",
  description: "What every Acme Cloud request goes through.",
  isExpandedByDefault: true,
  showCurrentStatus: true,
  showUptimePercent: true,
  order: 1,
});

const gridGroup = Object.assign(new StatusPageGroup(), {
  _id: id(11),
  name: "Regions",
  isExpandedByDefault: true,
  viewMode: "Grid",
  rowAxisLabel: "Service",
  columnAxisLabel: "Region",
  rowAxisValues: "API, Dashboard",
  columnAxisValues: "US, EU",
  order: 2,
});

/*
 * One monitor per list resource, each with its own history: a quiet one, a
 * 10-minute outage (a pale yellow day), a 1-hour outage (dark orange) and a
 * 3-hour outage (very dark red), plus 20 days before the monitor existed,
 * which have no data and are drawn hatched.
 */
const LIST_RESOURCES = [
  { name: "API", outages: [], statusNow: OPERATIONAL },
  { name: "Dashboard", outages: [[6, 10 * 60 * 1000]], statusNow: OPERATIONAL },
  {
    name: "Webhooks",
    outages: [
      [12, HOUR],
      [30, 3 * HOUR],
    ],
    statusNow: DEGRADED,
  },
  {
    name: "Email delivery",
    outages: [
      [3, 3 * HOUR],
      [45, 10 * 60 * 1000],
    ],
    statusNow: OFFLINE,
  },
];

const GRID_RESOURCES = [
  { name: "API in US", row: "API", column: "US", statusNow: OPERATIONAL },
  { name: "API in EU", row: "API", column: "EU", statusNow: DEGRADED },
  {
    name: "Dashboard in US",
    row: "Dashboard",
    column: "US",
    statusNow: OPERATIONAL,
  },
];

export const buildFixture = (data) => {
  const now = Date.now();
  const monitors = [];
  const resources = [];
  const timelines = [];

  LIST_RESOURCES.forEach((entry, index) => {
    const monitor = Object.assign(new Monitor(), {
      _id: id(100 + index),
      name: entry.name,
      currentMonitorStatusId: entry.statusNow.id,
    });
    monitors.push(monitor);

    resources.push(
      Object.assign(new StatusPageResource(), {
        _id: id(200 + index),
        displayName: entry.name,
        monitor,
        monitorId: monitor.id,
        statusPageGroupId: listGroup.id,
        showStatusHistoryChart: true,
        showCurrentStatus: true,
        showUptimePercent: index !== 1,
        order: index,
      }),
    );

    // Recorded from 70 days ago: the first 20 days of the 90 have no data.
    let cursor = now - 70 * DAY;
    const parts = [];

    for (const [daysAgo, length] of entry.outages) {
      const start = now - daysAgo * DAY - 12 * HOUR;
      parts.push([cursor, start, OPERATIONAL]);
      parts.push([start, start + length, OFFLINE]);
      cursor = start + length;
    }

    if (entry.statusNow !== OPERATIONAL) {
      const start = now - 2 * HOUR;
      parts.push([cursor, start, OPERATIONAL]);
      parts.push([start, undefined, entry.statusNow]);
    } else {
      parts.push([cursor, undefined, OPERATIONAL]);
    }

    parts.forEach(([startsAt, endsAt, statusNow], part) => {
      timelines.push(
        Object.assign(new MonitorStatusTimeline(), {
          _id: id(1000 + index * 10 + part),
          monitorId: monitor.id,
          monitorStatusId: statusNow.id,
          monitorStatus: statusNow,
          startsAt: new Date(startsAt),
          endsAt: endsAt ? new Date(endsAt) : undefined,
        }),
      );
    });
  });

  GRID_RESOURCES.forEach((entry, index) => {
    const monitor = Object.assign(new Monitor(), {
      _id: id(150 + index),
      name: entry.name,
      currentMonitorStatusId: entry.statusNow.id,
    });
    monitors.push(monitor);

    resources.push(
      Object.assign(new StatusPageResource(), {
        _id: id(250 + index),
        displayName: entry.name,
        monitor,
        monitorId: monitor.id,
        statusPageGroupId: gridGroup.id,
        rowAxisValue: entry.row,
        columnAxisValue: entry.column,
        showCurrentStatus: true,
        showUptimePercent: true,
        order: index,
      }),
    );

    timelines.push(
      Object.assign(new MonitorStatusTimeline(), {
        _id: id(1500 + index),
        monitorId: monitor.id,
        monitorStatusId: entry.statusNow.id,
        monitorStatus: entry.statusNow,
        startsAt: new Date(now - 80 * DAY),
      }),
    );
  });

  const statusPage = Object.assign(new StatusPage(), {
    _id: PAGE_ID,
    name: "Acme Cloud",
    pageTitle: "Acme Cloud Status",
    pageDescription: "How Acme Cloud is doing right now.",
    theme: data.theme,
    logoFile: logoFile(),
    logoFileId: new ObjectID(id(900)),
    ...(data.hasDarkLogo
      ? {
          darkThemeLogoFile: darkLogoFile(),
          darkThemeLogoFileId: new ObjectID(id(901)),
        }
      : {}),
    logoAltText: "Acme Cloud",
    copyrightText: "Acme, Inc.",
    overviewPageDescription:
      "Live status of **Acme Cloud**. For help, write to [support](https://example.com/support).",
    showUptimeHistoryInDays: 90,
    showOverallUptimePercentOnStatusPage: true,
    showIncidentsOnStatusPage: true,
    showAnnouncementsOnStatusPage: true,
    showScheduledMaintenanceEventsOnStatusPage: true,
    showSubscriberPageOnStatusPage: true,
    enableEmailSubscribers: true,
    isPublicStatusPage: !data.isPrivate,
    downtimeMonitorStatuses: [OFFLINE],
    defaultBarColor: new Color("#2ab57d"),
  });

  const barColorRules = RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES.map(
    (rule, index) => {
      return Object.assign(new StatusPageHistoryChartBarColorRule(), {
        _id: id(300 + index),
        uptimePercentGreaterThanOrEqualTo:
          rule.uptimePercentGreaterThanOrEqualTo,
        barColor: rule.barColor,
        order: index + 1,
      });
    },
  );

  const incident = Object.assign(new Incident(), {
    _id: INCIDENT_ID,
    title: "Webhook deliveries are delayed",
    description:
      "Some webhooks reach their endpoints up to **15 minutes** late. Deliveries are not lost.",
    declaredAt: new Date(now - 2 * HOUR),
    createdAt: new Date(now - 2 * HOUR),
    monitors: [monitors[2]],
    incidentSeverity: severity,
    currentIncidentState: identified,
  });

  const incidentNote = Object.assign(new IncidentPublicNote(), {
    _id: id(501),
    incidentId: new ObjectID(INCIDENT_ID),
    note: "We found the cause: a queue that fell behind. It is catching up now.",
    postedAt: new Date(now - HOUR),
    createdAt: new Date(now - HOUR),
  });

  const incidentTimeline = Object.assign(new IncidentStateTimeline(), {
    _id: id(502),
    incidentId: new ObjectID(INCIDENT_ID),
    incidentState: identified,
    incidentStateId: identified.id,
    startsAt: new Date(now - 2 * HOUR),
    createdAt: new Date(now - 2 * HOUR),
  });

  const announcement = Object.assign(new StatusPageAnnouncement(), {
    _id: ANNOUNCEMENT_ID,
    title: "New EU region",
    description: "Acme Cloud now runs in **Frankfurt** too.",
    showAnnouncementAt: new Date(now - DAY),
    createdAt: new Date(now - DAY),
  });

  const maintenance = Object.assign(new ScheduledMaintenance(), {
    _id: MAINTENANCE_ID,
    title: "Database upgrade",
    description:
      "The dashboard is read-only for a few minutes while we upgrade.",
    startsAt: new Date(now - HOUR),
    endsAt: new Date(now + 2 * HOUR),
    createdAt: new Date(now - DAY),
    monitors: [monitors[1]],
    currentScheduledMaintenanceState: maintenanceOngoing,
  });

  const maintenanceTimeline = Object.assign(
    new ScheduledMaintenanceStateTimeline(),
    {
      _id: id(701),
      scheduledMaintenanceId: new ObjectID(MAINTENANCE_ID),
      scheduledMaintenanceState: maintenanceOngoing,
      scheduledMaintenanceStateId: maintenanceOngoing.id,
      startsAt: new Date(now - HOUR),
      createdAt: new Date(now - HOUR),
    },
  );

  const json = (model, type) => {
    return BaseModel.toJSONObject(model, type);
  };

  const jsonArray = (models, type) => {
    return BaseModel.toJSONObjectArray(models, type);
  };

  const sharedResources = jsonArray(resources, StatusPageResource);

  return {
    masterPage: {
      statusPage: withLogoBytes(json(statusPage, StatusPage)),
      footerLinks: [],
      headerLinks: [
        { _id: id(40), title: "Website", link: "https://example.com" },
        { _id: id(41), title: "Docs", link: "https://example.com/docs" },
      ],
      hasEnabledSSO: data.hasSso ? 1 : 0,
      allowStatusPageCustomizations: false,
    },
    overview: {
      statusPage: json(statusPage, StatusPage),
      resourceGroups: jsonArray([listGroup, gridGroup], StatusPageGroup),
      statusPageResources: sharedResources,
      monitorStatuses: jsonArray(STATUSES, MonitorStatus),
      monitorStatusTimelines: jsonArray(timelines, MonitorStatusTimeline),
      statusPageHistoryChartBarColorRules: jsonArray(
        barColorRules,
        StatusPageHistoryChartBarColorRule,
      ),
      overallStatus: json(OFFLINE, MonitorStatus),
      activeIncidents: jsonArray([incident], Incident),
      incidentPublicNotes: jsonArray([incidentNote], IncidentPublicNote),
      incidentStateTimelines: jsonArray(
        [incidentTimeline],
        IncidentStateTimeline,
      ),
      incidentStates: jsonArray([identified, resolved], IncidentState),
      activeAnnouncements: jsonArray([announcement], StatusPageAnnouncement),
      scheduledMaintenanceEvents: jsonArray(
        [maintenance],
        ScheduledMaintenance,
      ),
      scheduledMaintenanceEventsPublicNotes: [],
      scheduledMaintenanceStateTimelines: jsonArray(
        [maintenanceTimeline],
        ScheduledMaintenanceStateTimeline,
      ),
      scheduledMaintenanceStates: jsonArray(
        [maintenanceScheduled, maintenanceOngoing],
        ScheduledMaintenanceState,
      ),
      monitorsInGroup: {},
      monitorGroupCurrentStatuses: {},
    },
    incidents: {
      incidents: jsonArray([incident], Incident),
      incidentPublicNotes: jsonArray([incidentNote], IncidentPublicNote),
      statusPageResources: sharedResources,
      incidentStateTimelines: jsonArray(
        [incidentTimeline],
        IncidentStateTimeline,
      ),
      incidentStates: jsonArray([identified, resolved], IncidentState),
      monitorsInGroup: {},
    },
    episodes: {
      episodes: [],
      episodePublicNotes: [],
      episodeStateTimelines: [],
      incidentStates: [],
      statusPageResources: [],
      monitorsInGroup: {},
    },
    announcements: {
      announcements: jsonArray([announcement], StatusPageAnnouncement),
      statusPageResources: sharedResources,
      monitorsInGroup: {},
    },
    scheduledEvents: {
      scheduledMaintenanceEvents: jsonArray(
        [maintenance],
        ScheduledMaintenance,
      ),
      scheduledMaintenanceEventsPublicNotes: [],
      scheduledMaintenanceStateTimelines: jsonArray(
        [maintenanceTimeline],
        ScheduledMaintenanceStateTimeline,
      ),
      scheduledMaintenanceStates: jsonArray(
        [maintenanceScheduled, maintenanceOngoing],
        ScheduledMaintenanceState,
      ),
      statusPageResources: sharedResources,
      monitorsInGroup: {},
    },
    resources: {
      statusPageResources: sharedResources,
      resourceGroups: jsonArray([listGroup, gridGroup], StatusPageGroup),
    },
  };
};

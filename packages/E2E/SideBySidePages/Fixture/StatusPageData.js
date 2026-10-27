/*
 * What the fixture's status page API answers for one page (Pages.js): the
 * page as a customer would set it up, built from the real models and
 * serialized the way the real API serializes them, so the app parses it
 * exactly as it parses a production answer.
 *
 * Each page has its own name, logo, colour and resource, so what a tab draws
 * says which page it is drawing.
 */
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import File from "Common/Models/DatabaseModels/File";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import Color from "Common/Types/Color";
import ObjectID from "Common/Types/ObjectID";
import { logoSvg, shortName } from "./Pages";

const DAY = 24 * 60 * 60 * 1000;

// Ids inside one page's answers: the page's own prefix and a number.
const idWithin = (page, value) => {
  return `${page.id.slice(0, 24)}${String(value).padStart(12, "0")}`;
};

const status = (page, value, name, color, priority, isOperationalState) => {
  return Object.assign(new MonitorStatus(), {
    _id: idWithin(page, value),
    name,
    color: new Color(color),
    priority,
    isOperationalState,
  });
};

/*
 * The logo's bytes as the API sends them: a Node Buffer, which
 * JSON.stringify writes as { type: "Buffer", data: [...] }.
 */
const withLogoBytes = (page, statusPageJson) => {
  const bytes = Array.from(new TextEncoder().encode(logoSvg(page)));

  statusPageJson.logoFile.file = {
    _type: "Buffer",
    value: { type: "Buffer", data: bytes },
  };

  return statusPageJson;
};

export const buildStatusPageAnswers = (page) => {
  const now = Date.now();
  const operational = status(page, 900, "Operational", "#2ab57d", 1, true);
  const offline = status(page, 901, "Offline", "#fd625e", 3, false);
  const statusNow = page.isOperational ? operational : offline;

  const logoFile = Object.assign(new File(), {
    _id: idWithin(page, 800),
    name: `${page.key}-logo.svg`,
    fileType: "image/svg+xml",
  });

  const statusPage = Object.assign(new StatusPage(), {
    _id: page.id,
    name: shortName(page),
    pageTitle: page.title,
    pageDescription: `How ${shortName(page)} is doing.`,
    theme: "Light",
    logoFile: logoFile,
    logoFileId: new ObjectID(logoFile._id),
    logoAltText: page.title,
    overviewPageDescription: `Live status of **${shortName(page)}**.`,
    showUptimeHistoryInDays: 90,
    showIncidentsOnStatusPage: true,
    showAnnouncementsOnStatusPage: true,
    showScheduledMaintenanceEventsOnStatusPage: true,
    showSubscriberPageOnStatusPage: true,
    enableEmailSubscribers: true,
    isPublicStatusPage: !page.isPrivate,
    enableMasterPassword: Boolean(page.hasMasterPassword),
    downtimeMonitorStatuses: [offline],
    defaultBarColor: new Color("#2ab57d"),
  });

  const monitor = Object.assign(new Monitor(), {
    _id: idWithin(page, 100),
    name: page.resource,
    currentMonitorStatusId: statusNow.id,
  });

  const resource = Object.assign(new StatusPageResource(), {
    _id: idWithin(page, 200),
    displayName: page.resource,
    monitor,
    monitorId: monitor.id,
    showStatusHistoryChart: true,
    showCurrentStatus: true,
    showUptimePercent: true,
    order: 1,
  });

  const timeline = Object.assign(new MonitorStatusTimeline(), {
    _id: idWithin(page, 300),
    monitorId: monitor.id,
    monitorStatusId: statusNow.id,
    monitorStatus: statusNow,
    startsAt: new Date(now - 80 * DAY),
  });

  const json = (model, type) => {
    return BaseModel.toJSONObject(model, type);
  };

  const jsonArray = (models, type) => {
    return BaseModel.toJSONObjectArray(models, type);
  };

  const resources = jsonArray([resource], StatusPageResource);

  return {
    masterPage: {
      statusPage: withLogoBytes(page, json(statusPage, StatusPage)),
      footerLinks: [],
      headerLinks: [],
      hasEnabledSSO: 0,
      allowStatusPageCustomizations: false,
    },
    overview: {
      statusPage: json(statusPage, StatusPage),
      resourceGroups: [],
      statusPageResources: resources,
      monitorStatuses: jsonArray([operational, offline], MonitorStatus),
      monitorStatusTimelines: jsonArray([timeline], MonitorStatusTimeline),
      statusPageHistoryChartBarColorRules: [],
      overallStatus: json(statusNow, MonitorStatus),
      activeIncidents: [],
      incidentPublicNotes: [],
      incidentStateTimelines: [],
      incidentStates: [],
      activeAnnouncements: [],
      scheduledMaintenanceEvents: [],
      scheduledMaintenanceEventsPublicNotes: [],
      scheduledMaintenanceStateTimelines: [],
      scheduledMaintenanceStates: [],
      monitorsInGroup: {},
      monitorGroupCurrentStatuses: {},
    },
    incidents: {
      incidents: [],
      incidentPublicNotes: [],
      statusPageResources: resources,
      incidentStateTimelines: [],
      incidentStates: [],
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
    resources: {
      statusPageResources: resources,
      resourceGroups: [],
    },
  };
};

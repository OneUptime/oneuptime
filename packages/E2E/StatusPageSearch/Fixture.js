import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import Overview from "../../App/FeatureSet/StatusPage/src/Pages/Overview/Overview";
import API from "../../App/FeatureSet/StatusPage/src/Utils/API";
import StatusPageUtil from "../../App/FeatureSet/StatusPage/src/Utils/StatusPage";
import "../../App/FeatureSet/StatusPage/src/Utils/i18n";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import Color from "Common/Types/Color";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";

// The actual public Overview, parsing, search, rollups and 90-day charts run
// unchanged. Only the overview API response is synthetic and deterministic.
const id = (value) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const pageId = id(1);
const operational = Object.assign(new MonitorStatus(), {
  _id: id(2),
  name: "Operational",
  color: new Color("#16a34a"),
  isOperationalState: true,
  priority: 1,
});
const offline = Object.assign(new MonitorStatus(), {
  _id: id(3),
  name: "Offline",
  color: new Color("#dc2626"),
  isOperationalState: false,
  priority: 2,
});
const statusPage = Object.assign(new StatusPage(), {
  _id: pageId,
  name: "Resource search regression",
  showUptimeHistoryInDays: 90,
  showOverallUptimePercentOnStatusPage: true,
  downtimeMonitorStatuses: [offline],
  defaultBarColor: operational.color,
});
const groups = ["Production", "Europe", "London", "Databases"].map(
  (name, index) =>
    Object.assign(new StatusPageGroup(), {
      _id: id(10 + index),
      name,
      parentStatusPageGroupId: index ? new ObjectID(id(9 + index)) : undefined,
      isExpandedByDefault: true,
      showCurrentStatus: true,
      showUptimePercent: true,
      order: index,
    }),
);
const resources = [];
const timelines = [];
for (let index = 0; index < 40; index++) {
  const monitor = Object.assign(new Monitor(), {
    _id: id(100 + index),
    name: `Internal monitor ${index}`,
    currentMonitorStatusId: operational.id,
  });
  resources.push(
    Object.assign(new StatusPageResource(), {
      _id: id(200 + index),
      displayName:
        index === 39
          ? "Database 0660"
          : `Service ${String(index + 1).padStart(4, "0")}`,
      displayDescription: index === 38 ? "Customer billing API" : undefined,
      monitor,
      monitorId: monitor.id,
      statusPageGroupId: groups[Math.floor(index / 10)].id,
      showStatusHistoryChart: true,
      showCurrentStatus: true,
      showUptimePercent: true,
      order: index,
    }),
  );
  // An actual timeline, including an outage inside the visible window, keeps
  // the regression representative of the expensive uptime rollup path.
  const now = Date.now();
  const day = 86400000;
  [
    [now - 100 * day, now - 2 * day, operational],
    [now - 2 * day, now - 2 * day + 3600000, offline],
    [now - 2 * day + 3600000, undefined, operational],
  ].forEach(([startsAt, endsAt, status], part) => {
    timelines.push(
      Object.assign(new MonitorStatusTimeline(), {
        _id: id(1000 + index * 3 + part),
        monitorId: monitor.id,
        monitorStatusId: status.id,
        monitorStatus: status,
        startsAt: new Date(startsAt),
        endsAt: endsAt ? new Date(endsAt) : undefined,
      }),
    );
  });
}

/*
 * ?maintenance=1: the page's scheduled maintenance on its 90-day history
 * (#5236), as the overview ships it - the project's four states, and two
 * events that have started: Database 0660's upgrade, completed, on the day
 * of the outage two days ago, and patching of the billing API (Service
 * 0039) in progress now. Without it the page has none, as before.
 */
const maintenanceMode =
  new URLSearchParams(window.location.search).get("maintenance") === "1";
const maintenanceStates = [
  ["Scheduled", "#000000", "isScheduledState"],
  ["Ongoing", "#eab308", "isOngoingState"],
  ["Ended", "#4a4a4a", "isEndedState"],
  ["Completed", "#16a34a", "isResolvedState"],
].map(([name, color, flag], index) =>
  Object.assign(new ScheduledMaintenanceState(), {
    _id: id(300 + index),
    name,
    color: new Color(color),
    order: index + 1,
    isScheduledState: false,
    isOngoingState: false,
    isEndedState: false,
    isResolvedState: false,
    [flag]: true,
  }),
);
const maintenanceNow = Date.now();
// 01:00 to 03:00 UTC on the day of the outage: one day, whatever the hour now.
const upgradeStart = new Date(maintenanceNow - 2 * 86400000);
upgradeStart.setUTCHours(1, 0, 0, 0);
const maintenanceEvents = maintenanceMode
  ? [
      Object.assign(new ScheduledMaintenance(), {
        _id: id(310),
        title: "Database 0660 upgrade",
        startsAt: upgradeStart,
        endsAt: new Date(upgradeStart.getTime() + 2 * 60 * 60000),
        currentScheduledMaintenanceState: maintenanceStates[3],
        monitors: [resources[39].monitor],
      }),
      Object.assign(new ScheduledMaintenance(), {
        _id: id(311),
        title: "Billing API patching",
        startsAt: new Date(maintenanceNow - 60 * 60000),
        endsAt: new Date(maintenanceNow + 60 * 60000),
        currentScheduledMaintenanceState: maintenanceStates[1],
        monitors: [resources[38].monitor],
      }),
    ]
  : [];

window.__statusPageSearchFixture = {
  requests: 0,
  refreshOffline: false,
  maintenanceIds: maintenanceEvents.map((event) => event._id),
};
API.post = async ({ url }) => {
  if (!url.toString().endsWith(`/overview/${pageId}`)) {
    throw new Error(`Unexpected fixture request: ${url}`);
  }
  window.__statusPageSearchFixture.requests += 1;
  const refreshOffline = window.__statusPageSearchFixture.refreshOffline;
  const freshResources = resources.map((resource, index) => {
    if (!refreshOffline || index !== 39) {
      return resource;
    }
    return Object.assign(new StatusPageResource(), resource, {
      monitor: Object.assign(new Monitor(), resource.monitor, {
        currentMonitorStatusId: offline.id,
      }),
    });
  });
  return new HTTPResponse(
    200,
    {
      statusPage: BaseModel.toJSONObject(statusPage, StatusPage),
      resourceGroups: BaseModel.toJSONObjectArray(groups, StatusPageGroup),
      statusPageResources: BaseModel.toJSONObjectArray(
        freshResources,
        StatusPageResource,
      ),
      monitorStatuses: BaseModel.toJSONObjectArray(
        [operational, offline],
        MonitorStatus,
      ),
      monitorStatusTimelines: BaseModel.toJSONObjectArray(
        timelines,
        MonitorStatusTimeline,
      ),
      overallStatus: BaseModel.toJSONObject(
        refreshOffline ? offline : operational,
        MonitorStatus,
      ),
      scheduledMaintenanceStates: BaseModel.toJSONObjectArray(
        maintenanceStates,
        ScheduledMaintenanceState,
      ),
      timelineScheduledMaintenanceEvents: BaseModel.toJSONObjectArray(
        maintenanceEvents,
        ScheduledMaintenance,
      ),
    },
    {},
  );
};
StatusPageUtil.setStatusPageId(new ObjectID(pageId));
StatusPageUtil.setIsPrivateStatusPage(false);

function Fixture() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  return (
    <main className="mx-auto max-w-5xl px-4 py-4 sm:px-8">
      <Overview pageRoute={new Route("/")} onLoadComplete={() => {}} />
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Fixture />
  </BrowserRouter>,
);

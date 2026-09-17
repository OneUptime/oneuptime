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

window.__statusPageSearchFixture = { requests: 0, refreshOffline: false };
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

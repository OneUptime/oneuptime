import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import IncidentView from "../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/Index";
import AlertView from "../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/Index";
import ScheduledMaintenanceView from "../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/Index";
import IncidentLayout from "../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/Layout";
import AlertLayout from "../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/Layout";
import MaintenanceLayout from "../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/Layout";
import RouteMap from "../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Incident from "Common/Models/DatabaseModels/Incident";
import Alert from "Common/Models/DatabaseModels/Alert";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Label from "Common/Models/DatabaseModels/Label";
import Color from "Common/Types/Color";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import PermissionUtil from "Common/UI/Utils/Permission";
import UserUtil from "Common/UI/Utils/User";
import BlankProfilePic from "Common/UI/Images/users/blank-profile.svg";

// Only session/data boundaries and the optional integrations documented in
// server.js are replaced. The overview pages, state forms, feed, detail cards,
// field permissions, editors, shared components and responsive CSS are real.
const scenario =
  new URLSearchParams(window.location.search).get("scenario") || "default";
const eventId = "20000000-0000-4000-8000-000000000001";
const projectId = "10000000-0000-4000-8000-000000000001";
const fixedNow = new Date("2026-09-07T10:45:00Z");
const startedAt = new Date("2026-09-07T10:00:00Z");
const id = (number) =>
  `30000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const make = (Type, fields) => Object.assign(new Type(), fields);
const project = make(Project, { _id: projectId, name: "Acme Production" });
const user = make(User, { _id: id(900), name: new Name("Alex Morgan") });
const monitor = make(Monitor, { _id: id(901), name: "Checkout API · Europe" });
const label = make(Label, {
  _id: id(902),
  name: "Production",
  color: new Color("#4f46e5"),
});
const types = { Incident, Alert, ScheduledMaintenance };
const titles = {
  Incident: "Checkout requests failing in Europe",
  Alert: "API latency above the response time threshold",
  ScheduledMaintenance: "Production database maintenance",
};
const records = Object.fromEntries(
  Object.entries(types).map(([name, Type]) => [
    name,
    make(Type, {
      _id: eventId,
      projectId: new ObjectID(projectId),
      title:
        scenario === "long-title"
          ? `${titles[name]} — affected production customers across all European regions while infrastructure recovery is in progress ${"checkout-service-".repeat(8)}`
          : titles[name],
      description:
        "The response team is investigating elevated errors affecting customer checkout. Updates will be posted here as recovery progresses.",
      createdAt: new Date("2026-09-07T09:55:00Z"),
      declaredAt: scenario === "missing-data" ? undefined : startedAt,
      startsAt:
        scenario === "missing-data"
          ? undefined
          : new Date("2026-09-07T12:00:00Z"),
      endsAt:
        scenario === "missing-data"
          ? undefined
          : new Date("2026-09-07T14:00:00Z"),
      incidentNumber: 142,
      incidentNumberWithPrefix: "INC-142",
      alertNumber: 86,
      alertNumberWithPrefix: "ALT-86",
      scheduledMaintenanceNumber: 24,
      scheduledMaintenanceNumberWithPrefix: "MNT-24",
      incidentSeverity:
        scenario === "missing-data"
          ? undefined
          : { _id: id(910), name: "Critical", color: new Color("#dc2626") },
      alertSeverity:
        scenario === "missing-data"
          ? undefined
          : { _id: id(911), name: "High", color: new Color("#d97706") },
      isPrivate: name === "Incident",
      declaredByUser: user,
      createdByUser: user,
      labels: scenario === "missing-data" ? [] : [label],
      monitors: scenario === "missing-data" ? [] : [monitor],
      monitor:
        name === "Alert" && scenario !== "missing-data" ? monitor : undefined,
      hosts: [],
      kubernetesClusters: [],
      dockerHosts: [],
      podmanHosts: [],
      networkSites: [],
      services: [],
      onCallDutyPolicies: [],
      statusPages: [],
      sendSubscriberNotificationsOnBeforeTheEvent: [],
      subscriberNotificationStatusOnIncidentCreated: "Success",
      subscriberNotificationStatusOnEventScheduled: "Success",
    }),
  ]),
);

const lists = new Map();
const requests = [];
window.__operationsOverviewRequests = requests;
ProjectUtil.getCurrentProject = () => project;
ProjectUtil.getCurrentProjectId = () => project.id;
UserUtil.getProfilePictureRoute = () => ({ toString: () => BlankProfilePic });
PermissionUtil.getGlobalPermissions = () => ({
  globalPermissions: Object.values(Permission),
});
PermissionUtil.getProjectPermissions = () => ({
  projectId: project.id,
  permissions: [],
});

function stateFields(name) {
  const maintenance = name.startsWith("ScheduledMaintenance");
  return (
    maintenance
      ? ["Scheduled", "Ongoing", "Completed"]
      : ["Created", "Acknowledged", "Resolved"]
  ).map((state, index) => ({
    _id: id(index + 1),
    name: state,
    order: index,
    color: new Color(
      [maintenance ? "#4f46e5" : "#dc2626", "#d97706", "#059669"][index],
    ),
    isCreatedState: index === 0,
    isAcknowledgedState: index === 1,
    isResolvedState: index === 2,
    isScheduledState: index === 0,
    isOngoingState: index === 1,
    isEndedState: index === 2,
  }));
}

function getData(modelType) {
  const name = modelType.name;
  if (lists.has(name)) return lists.get(name);
  let data = [];
  if (
    ["IncidentState", "AlertState", "ScheduledMaintenanceState"].includes(name)
  ) {
    data = stateFields(name).map((fields) => make(modelType, fields));
  } else if (name.endsWith("StateTimeline")) {
    const eventType = name.replace("StateTimeline", "");
    const field = eventType[0].toLowerCase() + eventType.slice(1) + "State";
    const indices =
      scenario === "missing-data"
        ? []
        : scenario === "resolved"
          ? [0, 1, 2]
          : [0];
    data = indices.map((index) =>
      make(modelType, {
        _id: id(100 + index),
        [field + "Id"]: new ObjectID(id(index + 1)),
        [field]: stateFields(eventType)[index],
        startsAt: new Date(startedAt.getTime() + index * 15 * 60000),
        createdAt: new Date(startedAt.getTime() + index * 15 * 60000),
        createdByUser: user,
      }),
    );
  } else if (
    ["IncidentFeed", "AlertFeed", "ScheduledMaintenanceFeed"].includes(name)
  ) {
    const maintenance = name.startsWith("ScheduledMaintenance");
    const feedText =
      scenario === "long-feed"
        ? Array.from(
            { length: 12 },
            (_, index) =>
              `**Update ${String(index + 1).padStart(2, "0")}**\n\nThe response team posted a progress update.`,
          )
        : [
            maintenance
              ? "**Maintenance scheduled**\n\nDatabase indexes will be rebuilt during the maintenance window. A brief interruption to checkout is expected."
              : "**Response started**\n\nThe on-call team is investigating increased errors from the checkout service in Europe.",
            maintenance
              ? "**Preparation complete**\n\nBackups are verified and the rollback plan has been reviewed."
              : "**Update from Alex Morgan**\n\nTraffic has been shifted to the healthy region. Error rates are improving while the team verifies recovery.",
          ];
    data =
      scenario === "missing-data"
        ? []
        : feedText.map((text, index) =>
            make(modelType, {
              _id: id(200 + index),
              feedInfoInMarkdown: text,
              postedAt: new Date(
                startedAt.getTime() +
                  index * (scenario === "long-feed" ? 3 : 20) * 60000,
              ),
              createdAt: startedAt,
              user,
              displayColor: new Color(index ? "#4f46e5" : "#dc2626"),
            }),
          );
  } else if (name === "Label") data = [label];
  else if (name === "Monitor") data = [monitor];
  else if (name === "IncidentSeverity")
    data = [
      make(
        modelType,
        records.Incident.incidentSeverity || {
          _id: id(910),
          name: "Critical",
          color: new Color("#dc2626"),
        },
      ),
    ];
  else if (name === "AlertSeverity")
    data = [
      make(
        modelType,
        records.Alert.alertSeverity || {
          _id: id(911),
          name: "High",
          color: new Color("#d97706"),
        },
      ),
    ];
  lists.set(name, data);
  return data;
}
ModelAPI.getList = async ({ modelType }) => {
  requests.push({ operation: "list", model: modelType.name });
  // Let React commit loading so Refresh exercises mounted-state preservation.
  if (modelType.name.endsWith("Feed")) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const data = getData(modelType);
  return { data, count: data.length, skip: 0, limit: 1000 };
};
ModelAPI.getItem = async ({ modelType }) => {
  requests.push({ operation: "get", model: modelType.name });
  if (scenario === "load-error" && modelType.name === "Incident")
    throw new Error("Fixture could not load the incident.");
  return records[modelType.name] || null;
};
ModelAPI.getCommonHeaders = () => ({});
ModelAPI.count = async () => 0;
ModelAPI.createOrUpdate = async ({ modelType, model, formType }) => {
  requests.push({
    operation: "save",
    model: modelType.name,
    formType,
    title: model.title,
  });
  if (modelType.name.endsWith("StateTimeline")) {
    model._id = id(999);
    model.startsAt = fixedNow;
    model.createdAt = fixedNow;
    getData(modelType).push(model);
  } else if (records[modelType.name]) {
    // Model constructors include unset columns. Apply the scalar editor fields
    // exercised here and retain the server-owned identifiers and timestamps.
    for (const field of ["title", "startsAt", "endsAt"]) {
      if (model[field] !== undefined) {
        records[modelType.name][field] = model[field];
      }
    }
  }
  return { data: model };
};
ModelAPI.updateById = async ({ modelType, data }) => {
  Object.assign(records[modelType.name], data);
  return { data: records[modelType.name] };
};
API.get = async () => ({ data: { data: [], count: 0 }, isSuccess: () => true });
API.post = async () => ({
  data: { data: [], count: 0 },
  isSuccess: () => true,
});

await i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
});
function Fixture() {
  const location = useLocation();
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(location);
  Navigation.setParams(useParams());
  return (
    <>
      <header className="border-b border-gray-200 bg-white px-4 py-4 sm:px-8">
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-5">
            <span className="text-lg font-semibold tracking-tight text-indigo-600">
              OneUptime
            </span>
            <span className="border-l border-gray-200 pl-5 text-sm text-gray-500">
              Acme Production
            </span>
          </div>
          <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
            Preview · Synthetic data
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-screen-2xl pb-10">
        <Routes>
          <Route
            path={RouteMap[PageMap.INCIDENT_VIEW].toString()}
            element={<IncidentLayout />}
          >
            <Route index element={<IncidentView />} />
          </Route>
          <Route
            path={RouteMap[PageMap.ALERT_VIEW].toString()}
            element={<AlertLayout />}
          >
            <Route index element={<AlertView />} />
          </Route>
          <Route
            path={RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW].toString()}
            element={<MaintenanceLayout />}
          >
            <Route index element={<ScheduledMaintenanceView />} />
          </Route>
        </Routes>
      </main>
    </>
  );
}
createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Fixture />
  </BrowserRouter>,
);

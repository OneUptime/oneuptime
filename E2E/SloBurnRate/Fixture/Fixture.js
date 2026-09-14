/*
 * Offline fixture for the real SLO Burn Rate Rules page.
 *
 * Only the ModelAPI/API data boundary and the synthetic user's permission
 * snapshot are replaced. The page component, its ModelTable, its form and
 * every cell renderer are the production ones from this branch — which is the
 * point: the screenshots this produces are of the actual UI, not a mock of it.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import SloBurnRateRules from "../../../App/FeatureSet/Dashboard/src/Pages/Slo/View/BurnRateRules";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import SliType from "Common/Types/ServiceLevelObjective/SliType";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import SloMultiMonitorMode from "Common/Types/ServiceLevelObjective/SloMultiMonitorMode";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import User from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const SLO_ID = "20000000-0000-4000-8000-000000000001";

/*
 * A fixed clock. The "Last fired" cell renders a relative time, so without
 * this the screenshot text would drift every run.
 */
const NOW = new Date("2026-09-11T12:00:00.000Z");

function minutesBefore(minutes) {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

function severity(model, id, name, order) {
  const record = new model();
  record._id = id;
  record.name = name;
  record.order = order;
  return record;
}

const alertSeverities = [
  severity(
    AlertSeverity,
    "30000000-0000-4000-8000-000000000001",
    "Critical",
    1,
  ),
  severity(AlertSeverity, "30000000-0000-4000-8000-000000000002", "Warning", 2),
];

const incidentSeverities = [
  severity(
    IncidentSeverity,
    "40000000-0000-4000-8000-000000000001",
    "SEV1 - Critical",
    1,
  ),
  severity(
    IncidentSeverity,
    "40000000-0000-4000-8000-000000000002",
    "SEV2 - Major",
    2,
  ),
];

function policy(id, name) {
  const record = new OnCallDutyPolicy();
  record._id = id;
  record.name = name;
  return record;
}

const onCallPolicies = [
  policy("50000000-0000-4000-8000-000000000001", "Checkout on-call"),
  policy("50000000-0000-4000-8000-000000000002", "Major incident commander"),
];

/*
 * Three rules, one per shape the "Declares" column can report: alert only
 * (the pre-incident default), both, and incident only. The middle one is
 * mid-lifecycle so the status cell renders the live "Firing" pill.
 */
function rule(data) {
  const record = new ServiceLevelObjectiveBurnRateRule();
  record._id = data.id;
  record.projectId = new ObjectID(PROJECT_ID);
  record.serviceLevelObjectiveId = new ObjectID(SLO_ID);
  record.name = data.name;
  record.isEnabled = true;
  record.burnRateThreshold = data.burnRateThreshold;
  record.longWindowInMinutes = data.longWindowInMinutes;
  record.shortWindowInMinutes = data.shortWindowInMinutes;
  record.refireSuppressionMinutes = data.refireSuppressionMinutes;
  record.shouldCreateAlert = data.shouldCreateAlert;
  record.shouldCreateIncident = data.shouldCreateIncident;
  record.alertSeverity = data.alertSeverity;
  record.alertSeverityId = data.alertSeverity && data.alertSeverity.id;
  record.incidentSeverity = data.incidentSeverity;
  record.incidentSeverityId = data.incidentSeverity && data.incidentSeverity.id;
  record.onCallDutyPolicies = data.onCallDutyPolicies || [];
  record.incidentOnCallDutyPolicies = data.incidentOnCallDutyPolicies || [];
  record.lastAlertCreatedAt = data.lastAlertCreatedAt;
  record.lastAlertResolvedAt = data.lastAlertResolvedAt;
  record.lastIncidentCreatedAt = data.lastIncidentCreatedAt;
  record.lastIncidentResolvedAt = data.lastIncidentResolvedAt;
  return record;
}

const rules = [
  rule({
    id: "60000000-0000-4000-8000-000000000001",
    name: "Fast burn",
    burnRateThreshold: 14.4,
    longWindowInMinutes: 60,
    shortWindowInMinutes: 5,
    shouldCreateAlert: true,
    shouldCreateIncident: true,
    alertSeverity: alertSeverities[0],
    incidentSeverity: incidentSeverities[0],
    onCallDutyPolicies: [onCallPolicies[0]],
    incidentOnCallDutyPolicies: [onCallPolicies[1]],
    // Fired 12 minutes ago and still open: the live "Firing" pill.
    lastAlertCreatedAt: minutesBefore(12),
    lastIncidentCreatedAt: minutesBefore(12),
  }),
  rule({
    id: "60000000-0000-4000-8000-000000000002",
    name: "Slow burn",
    burnRateThreshold: 6,
    longWindowInMinutes: 360,
    shortWindowInMinutes: 30,
    shouldCreateAlert: true,
    shouldCreateIncident: false,
    alertSeverity: alertSeverities[1],
    onCallDutyPolicies: [onCallPolicies[0]],
    lastAlertCreatedAt: minutesBefore(2880),
    lastAlertResolvedAt: minutesBefore(2760),
  }),
  rule({
    id: "60000000-0000-4000-8000-000000000003",
    name: "Budget emergency",
    burnRateThreshold: 30,
    longWindowInMinutes: 120,
    shortWindowInMinutes: 10,
    refireSuppressionMinutes: 240,
    shouldCreateAlert: false,
    shouldCreateIncident: true,
    incidentSeverity: incidentSeverities[0],
    incidentOnCallDutyPolicies: [onCallPolicies[1]],
  }),
];

const slo = new ServiceLevelObjective();
slo._id = SLO_ID;
slo.projectId = new ObjectID(PROJECT_ID);
slo.name = "Checkout availability";
slo.isEnabled = true;
slo.sloStatus = SloStatus.AtRisk;
slo.sliType = SliType.MonitorUptime;
slo.targetPercentage = 99.9;
slo.windowType = SloWindowType.Rolling;
slo.windowDays = 30;
slo.multiMonitorMode = SloMultiMonitorMode.AnyDown;
slo.errorBudgetTotalSeconds = 2592;
slo.lastEvaluatedAt = minutesBefore(1);
const monitor = new Monitor();
monitor._id = "70000000-0000-4000-8000-000000000001";
slo.monitors = [monitor];

User.isMasterAdmin = () => true;
User.getUserId = () => new ObjectID("80000000-0000-4000-8000-000000000001");
PermissionUtil.getAllPermissions = () => [Permission.ProjectOwner];
ProjectUtil.getCurrentProjectId = () => new ObjectID(PROJECT_ID);
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

ModelAPI.getItem = async (options) => {
  const tableName = new options.modelType().tableName;
  if (tableName === "ServiceLevelObjective") {
    return slo;
  }
  return null;
};

ModelAPI.getList = async (options) => {
  const tableName = new options.modelType().tableName;
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 50);
  const itemsByTable = {
    ServiceLevelObjectiveBurnRateRule: rules,
    AlertSeverity: alertSeverities,
    IncidentSeverity: incidentSeverities,
    OnCallDutyPolicy: onCallPolicies,
  };
  const items = itemsByTable[tableName] || [];
  return {
    data: items.slice(skip, skip + limit),
    count: items.length,
    skip,
    limit,
  };
};

ModelAPI.getCount = async (options) => {
  const tableName = new options.modelType().tableName;
  return tableName === "ServiceLevelObjectiveBurnRateRule" ? rules.length : 0;
};

ModelAPI.create = async (options) => {
  return options.model;
};

API.get = async () => ({ data: { data: [], count: 0 } });
API.post = async () => ({ data: { data: [], count: 0 } });

await i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
});

function Fixture() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  return (
    <>
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-8 py-5">
        <div className="flex items-center gap-5">
          <span className="text-lg font-semibold text-gray-900">OneUptime</span>
          <span className="text-sm text-gray-500">Checkout availability</span>
        </div>
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
          Demo workspace · Synthetic data
        </span>
      </header>
      <main className="mx-auto max-w-[1820px] px-8 py-8">
        <div className="mb-7 text-sm text-gray-500">
          SLOs <span className="mx-2">/</span> Checkout availability{" "}
          <span className="mx-2">/</span> Burn Rate Rules
        </div>
        <SloBurnRateRules />
      </main>
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Fixture />
  </BrowserRouter>,
);

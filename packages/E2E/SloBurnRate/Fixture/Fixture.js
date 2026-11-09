/*
 * Offline fixture for the real SLO Burn Rate Rules, Error Budget Policy and
 * Overview pages, and the SLO list (/dashboard/<project>/slos) with its Bulk
 * Actions.
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
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import SloView from "../../../App/FeatureSet/Dashboard/src/Pages/Slo/View/Index";
import SloViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Slo/View/Layout";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import SloBurnRateRules from "../../../App/FeatureSet/Dashboard/src/Pages/Slo/View/BurnRateRules";
import SloErrorBudgetPolicy from "../../../App/FeatureSet/Dashboard/src/Pages/Slo/View/ErrorBudgetPolicy";
import Slos from "../../../App/FeatureSet/Dashboard/src/Pages/Slo/Slos";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import ServiceLevelObjectiveErrorBudgetPolicyTier from "Common/Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import ServiceLevelObjectiveOwnerTeam from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import UserModel from "Common/Models/DatabaseModels/User";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Color from "Common/Types/Color";
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
import {
  SloRecommendedAlertSeverity,
  getMissingSloRecommendedBurnRateRules,
  sloRecommendedBurnRateRuleToJSON,
} from "Common/Utils/Slo/SloRecommendedBurnRateRules";
import {
  SLO_RECOMMENDED_POLICY_TIERS,
  getMissingSloRecommendedPolicyTiers,
  sloRecommendedPolicyTierToJSON,
} from "Common/Utils/Slo/SloErrorBudgetPolicy";
import {
  SloBulkRecommendedRulesStatus,
  sloBulkRecommendedRulesResultToJSON,
} from "Common/Utils/Slo/SloBulkRecommendedBurnRateRules";

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

function label(id, name, color) {
  const record = new Label();
  record._id = id;
  record.name = name;
  record.color = Color.fromString(color);
  return record;
}

const labels = [
  label("90000000-0000-4000-8000-000000000001", "checkout", "#4f46e5"),
  label("90000000-0000-4000-8000-000000000002", "customer-impact", "#dc2626"),
];

function team(id, name) {
  const record = new Team();
  record._id = id;
  record.name = name;
  return record;
}

const teams = [
  team("a0000000-0000-4000-8000-000000000001", "Checkout team"),
  team("a0000000-0000-4000-8000-000000000002", "Major incident team"),
];

function person(id, name, email) {
  const record = new UserModel();
  record._id = id;
  record.name = name;
  record.email = email;
  return record;
}

const people = [
  person(
    "b0000000-0000-4000-8000-000000000001",
    "Jane Doe",
    "jane@example.com",
  ),
  person("b0000000-0000-4000-8000-000000000002", "Sam Lee", "sam@example.com"),
];

/*
 * The owners pickers list the project's people through its team members
 * (User itself is not project-listable), and its teams, so the fixture
 * serves both.
 */
const teamMembers = people.map((member, index) => {
  const record = new TeamMember();
  record._id = `c0000000-0000-4000-8000-00000000000${index + 1}`;
  record.user = member;
  return record;
});

/*
 * The SLO's owners: nobody at first (?owners=team: the Checkout team), so
 * the hero offers Add owners. A row the hero's Add owners list adds lands
 * here, naming the person or the team as the server's join does.
 */
const sloOwnerUsers = [];
const sloOwnerTeams = [];

function sloOwnerRow(isUser, pickedId) {
  const row = isUser
    ? new ServiceLevelObjectiveOwnerUser()
    : new ServiceLevelObjectiveOwnerTeam();
  const number = sloOwnerUsers.length + sloOwnerTeams.length + 1;
  row._id = `d0000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
  row.serviceLevelObjectiveId = new ObjectID(SLO_ID);
  if (isUser) {
    row.userId = new ObjectID(pickedId);
    row.user = people.find((item) => item._id === pickedId);
  } else {
    row.teamId = new ObjectID(pickedId);
    row.team = teams.find((item) => item._id === pickedId);
  }
  return row;
}

if (new URLSearchParams(window.location.search).get("owners") === "team") {
  sloOwnerTeams.push(sloOwnerRow(false, teams[0]._id));
}

/*
 * Three rules, one per shape the "Declares" column can report: alert only
 * (the pre-incident default), both, and incident only. The middle one is
 * mid-lifecycle so the status cell renders the live "Firing" pill. Between
 * them they carry every option a cell reports: owners, labels, an alert that
 * is resolved by hand, a private incident, and SLO owners added as owners.
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
  // Existing database rows have null templates when they use the backend
  // fallback. Unlike missing create values, these must not be prefilled.
  record.alertTitleTemplate = data.alertTitleTemplate ?? null;
  record.alertDescriptionTemplate = data.alertDescriptionTemplate ?? null;
  record.alertRemediationNotes = data.alertRemediationNotes ?? null;
  record.incidentTitleTemplate = data.incidentTitleTemplate ?? null;
  record.incidentDescriptionTemplate = data.incidentDescriptionTemplate ?? null;
  record.incidentRemediationNotes = data.incidentRemediationNotes ?? null;
  record.alertSeverity = data.alertSeverity;
  record.alertSeverityId = data.alertSeverity && data.alertSeverity.id;
  record.incidentSeverity = data.incidentSeverity;
  record.incidentSeverityId = data.incidentSeverity && data.incidentSeverity.id;
  record.onCallDutyPolicies = data.onCallDutyPolicies || [];
  record.incidentOnCallDutyPolicies = data.incidentOnCallDutyPolicies || [];
  record.alertLabels = data.alertLabels || [];
  record.incidentLabels = data.incidentLabels || [];
  record.alertOwnerTeams = data.alertOwnerTeams || [];
  record.alertOwnerUsers = data.alertOwnerUsers || [];
  record.incidentOwnerTeams = data.incidentOwnerTeams || [];
  record.incidentOwnerUsers = data.incidentOwnerUsers || [];
  record.isAlertPrivate = data.isAlertPrivate === true;
  record.autoResolveAlert = data.autoResolveAlert !== false;
  record.isIncidentPrivate = data.isIncidentPrivate === true;
  record.autoResolveIncident = data.autoResolveIncident !== false;
  record.addSloOwnersAsOwners = data.addSloOwnersAsOwners === true;
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
    alertOwnerTeams: [teams[0]],
    incidentOwnerUsers: [people[0]],
    alertLabels: [labels[0]],
    incidentLabels: [labels[0], labels[1]],
    addSloOwnersAsOwners: true,
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
    // Stays open until someone resolves it.
    autoResolveAlert: false,
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
    incidentOwnerTeams: [teams[1]],
    isIncidentPrivate: true,
  }),
];

const slo = new ServiceLevelObjective();
slo._id = SLO_ID;
slo.projectId = new ObjectID(PROJECT_ID);
slo.name = "Checkout availability";
slo.description = "Availability of the checkout API for customer purchases.";
slo.labels = labels;
if (new URLSearchParams(window.location.search).get("details") === "empty") {
  slo.description = "";
  slo.labels = [];
}
slo.isEnabled = true;
slo.sloStatus = SloStatus.AtRisk;
slo.sliType = SliType.MonitorUptime;
slo.targetPercentage = 99.9;
slo.windowType = SloWindowType.Rolling;
slo.windowDays = 30;
slo.multiMonitorMode = SloMultiMonitorMode.AnyDown;
slo.errorBudgetTotalSeconds = 2592;
slo.errorBudgetRemainingSeconds = 518.4;
slo.errorBudgetRemainingPercentage = 20;
slo.currentSliPercentage = 99.92;
slo.currentBurnRate = 1.2;
slo.lastEvaluatedAt = minutesBefore(1);
const monitor = new Monitor();
monitor._id = "70000000-0000-4000-8000-000000000001";
slo.monitors = [monitor];

/*
 * The SLO list (/slos): the SLO above and three more, each with burn rate
 * rules of its own, for Bulk Actions > Add recommended rules:
 *
 *   - Checkout availability (30 days): Fast burn, Slow burn and Budget
 *     emergency - missing Slow leak, as an SLO from before it existed is;
 *   - Search latency (7 days): Fast burn and Slow burn - missing Slow leak
 *     in the shape a 7-day window gives it (16.8 hours, at 1x);
 *   - Payments API (30 days): all three - nothing to add;
 *   - Login (calendar month): a renamed fast-burn rule only ("Paging", over
 *     60 minutes) - missing Slow burn and Slow leak.
 */
const SEARCH_SLO_ID = "20000000-0000-4000-8000-000000000002";
const PAYMENTS_SLO_ID = "20000000-0000-4000-8000-000000000003";
const LOGIN_SLO_ID = "20000000-0000-4000-8000-000000000004";

function listSlo(data) {
  const record = new ServiceLevelObjective();
  record._id = data.id;
  record.projectId = new ObjectID(PROJECT_ID);
  record.name = data.name;
  record.isEnabled = true;
  record.isArchived = false;
  record.sloStatus = data.status;
  record.sliType = SliType.MonitorUptime;
  record.targetPercentage = data.target;
  record.windowType = data.windowType;
  record.windowDays = data.windowDays;
  record.atRiskThresholdPercentage = 20;
  record.currentSliPercentage = data.sli;
  record.errorBudgetRemainingPercentage = data.budget;
  record.currentBurnRate = data.burnRate;
  record.lastEvaluatedAt = minutesBefore(2);
  record.labels = [];
  record.monitors = [monitor];
  return record;
}

const listSlos = [
  slo,
  listSlo({
    id: SEARCH_SLO_ID,
    name: "Search latency",
    status: SloStatus.Healthy,
    target: 99.5,
    windowType: SloWindowType.Rolling,
    windowDays: 7,
    sli: 99.81,
    budget: 62,
    burnRate: 0.4,
  }),
  listSlo({
    id: PAYMENTS_SLO_ID,
    name: "Payments API",
    status: SloStatus.Healthy,
    target: 99.95,
    windowType: SloWindowType.Rolling,
    windowDays: 30,
    sli: 99.97,
    budget: 71,
    burnRate: 0.3,
  }),
  listSlo({
    id: LOGIN_SLO_ID,
    name: "Login",
    status: SloStatus.AtRisk,
    target: 99.9,
    windowType: SloWindowType.CalendarMonth,
    windowDays: 30,
    sli: 99.91,
    budget: 14,
    burnRate: 1.6,
  }),
];

let listRuleCount = 0;

function listRule(sloId, name, longWindowInMinutes) {
  listRuleCount += 1;
  const record = new ServiceLevelObjectiveBurnRateRule();
  record._id = `61000000-0000-4000-8000-${String(listRuleCount).padStart(12, "0")}`;
  record.projectId = new ObjectID(PROJECT_ID);
  record.serviceLevelObjectiveId = new ObjectID(sloId);
  record.name = name;
  record.isEnabled = true;
  record.longWindowInMinutes = longWindowInMinutes;
  return record;
}

// Each listed SLO's rules, by its id: the SLO above keeps `rules`.
const rulesOfListedSlo = {
  [SLO_ID]: rules,
  [SEARCH_SLO_ID]: [
    listRule(SEARCH_SLO_ID, "Fast burn", 60),
    listRule(SEARCH_SLO_ID, "Slow burn", 360),
  ],
  [PAYMENTS_SLO_ID]: [
    listRule(PAYMENTS_SLO_ID, "Fast burn", 60),
    listRule(PAYMENTS_SLO_ID, "Slow burn", 360),
    listRule(PAYMENTS_SLO_ID, "Slow leak", 4320),
  ],
  [LOGIN_SLO_ID]: [listRule(LOGIN_SLO_ID, "Paging", 60)],
};

/*
 * The SLO's error budget policy: none at first, so the Error Budget Policy
 * page offers the recommended one. ?policy=recommended starts it with the
 * recommended tiers, and puts the SLO - 20% of its budget left - in
 * Reliability first (25%), three hours ago by the browser's own clock, so
 * the Overview shows the tier it is in.
 */
function policyTier(data) {
  const record = new ServiceLevelObjectiveErrorBudgetPolicyTier();
  record._id = data.id;
  record.projectId = new ObjectID(PROJECT_ID);
  record.serviceLevelObjectiveId = new ObjectID(SLO_ID);
  record.name = data.name;
  record.thresholdPercentage = data.thresholdPercentage;
  record.whatWeDo = data.whatWeDo;
  record.isEnabled = true;
  record.shouldCreateAlert = false;
  record.shouldCreateIncident = false;
  record.isAlertPrivate = false;
  record.autoResolveAlert = true;
  record.isIncidentPrivate = false;
  record.autoResolveIncident = true;
  record.addSloOwnersAsOwners = false;
  return record;
}

const policyTiers = [];

function nextPolicyTierId() {
  return `e0000000-0000-4000-8000-${String(policyTiers.length + 1).padStart(12, "0")}`;
}

// As the API lists them for the page: from the highest threshold down.
function sortedPolicyTiers() {
  return [...policyTiers].sort((a, b) => {
    return b.thresholdPercentage - a.thresholdPercentage;
  });
}

if (
  new URLSearchParams(window.location.search).get("policy") === "recommended"
) {
  for (const recommended of SLO_RECOMMENDED_POLICY_TIERS) {
    policyTiers.push(policyTier({ id: nextPolicyTierId(), ...recommended }));
  }

  const current = policyTiers.find((item) => {
    return item.thresholdPercentage === 25;
  });

  slo.currentErrorBudgetPolicyTierId = new ObjectID(current._id);
  slo.currentErrorBudgetPolicyTierName = current.name;
  slo.currentErrorBudgetPolicyTierEnteredAt = new Date(
    Date.now() - 3 * 60 * 60 * 1000,
  );
}

User.isMasterAdmin = () => true;
User.getUserId = () => new ObjectID("80000000-0000-4000-8000-000000000001");
PermissionUtil.getAllPermissions = () => [Permission.ProjectOwner];
ProjectUtil.getCurrentProjectId = () => new ObjectID(PROJECT_ID);
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

ModelAPI.getItem = async (options) => {
  const tableName = new options.modelType().tableName;
  if (tableName === "ServiceLevelObjective") {
    // Form prefilling converts relation models to picker IDs. Each API read
    // returns a fresh record so those conversions cannot mutate stored data.
    return Object.assign(new ServiceLevelObjective(), slo, {
      labels: [...slo.labels],
    });
  }
  if (tableName === "ServiceLevelObjectiveErrorBudgetPolicyTier") {
    const existing = policyTiers.find(
      (item) => item._id === options.id.toString(),
    );
    return existing
      ? Object.assign(
          new ServiceLevelObjectiveErrorBudgetPolicyTier(),
          existing,
        )
      : null;
  }
  if (tableName === "ServiceLevelObjectiveBurnRateRule") {
    const existing = rules.find((item) => item._id === options.id.toString());
    // ModelForm turns relations into picker IDs while prefilling. Keep that
    // conversion out of the stored record, just as a real API response would.
    return existing
      ? Object.assign(new ServiceLevelObjectiveBurnRateRule(), existing)
      : null;
  }
  return null;
};

ModelAPI.getList = async (options) => {
  const tableName = new options.modelType().tableName;
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 50);
  const itemsByTable = {
    ServiceLevelObjective: listSlos,
    ServiceLevelObjectiveBurnRateRule: rules,
    ServiceLevelObjectiveErrorBudgetPolicyTier: sortedPolicyTiers(),
    AlertSeverity: alertSeverities,
    IncidentSeverity: incidentSeverities,
    OnCallDutyPolicy: onCallPolicies,
    Label: labels,
    Team: teams,
    TeamMember: teamMembers,
    ServiceLevelObjectiveOwnerUser: sloOwnerUsers,
    ServiceLevelObjectiveOwnerTeam: sloOwnerTeams,
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
  // The list's status tiles: the listed SLOs of the status and switch asked.
  if (tableName === "ServiceLevelObjective") {
    const query = options.query || {};
    return listSlos.filter((item) => {
      if (
        typeof query.sloStatus === "string" &&
        item.sloStatus !== query.sloStatus
      ) {
        return false;
      }
      if (
        typeof query.isEnabled === "boolean" &&
        item.isEnabled !== query.isEnabled
      ) {
        return false;
      }
      return true;
    }).length;
  }
  if (tableName === "ServiceLevelObjectiveErrorBudgetPolicyTier") {
    return policyTiers.length;
  }
  return tableName === "ServiceLevelObjectiveBurnRateRule" ? rules.length : 0;
};

ModelAPI.count = ModelAPI.getCount;
AnalyticsModelAPI.aggregate = async () => ({ data: [] });

ModelAPI.createOrUpdate = async (options) => {
  const record = options.model;
  if (
    record.tableName === "ServiceLevelObjectiveOwnerUser" ||
    record.tableName === "ServiceLevelObjectiveOwnerTeam"
  ) {
    const isUser = record.tableName === "ServiceLevelObjectiveOwnerUser";
    const row = sloOwnerRow(
      isUser,
      (isUser ? record.userId : record.teamId).toString(),
    );
    (isUser ? sloOwnerUsers : sloOwnerTeams).push(row);
    window.__sloOwnerAdds = [
      ...(window.__sloOwnerAdds || []),
      {
        model: record.tableName,
        serviceLevelObjectiveId: String(record.serviceLevelObjectiveId),
        id: String(isUser ? record.userId : record.teamId),
      },
    ];
    return { data: row };
  }
  if (record.tableName === "ServiceLevelObjectiveErrorBudgetPolicyTier") {
    const tierIndex = policyTiers.findIndex((item) => item._id === record._id);
    if (!record._id) {
      record._id = nextPolicyTierId();
    }
    if (tierIndex < 0) {
      policyTiers.push(record);
    } else {
      policyTiers[tierIndex] = record;
    }
    return { data: record };
  }
  if (record.tableName === "ServiceLevelObjective") {
    Object.assign(slo, record, {
      labels: (record.labels || []).map((value) => {
        const id = (value._id || value).toString();
        const related = labels.find((item) => item._id === id);
        if (!related) {
          throw new Error(`Unknown SLO label relation: ${id}`);
        }
        return related;
      }),
    });
    return { data: slo };
  }
  const index = rules.findIndex((item) => item._id === record._id);

  if (!record._id) {
    record._id = `60000000-0000-4000-8000-${String(rules.length + 1).padStart(12, "0")}`;
  }

  // Resolve exactly the IDs the production form submits. This exercises the
  // two independent owner, severity, label and on-call mappings on save.
  const relations = {
    alertSeverity: alertSeverities,
    incidentSeverity: incidentSeverities,
    onCallDutyPolicies: onCallPolicies,
    incidentOnCallDutyPolicies: onCallPolicies,
    alertLabels: labels,
    incidentLabels: labels,
    alertOwnerTeams: teams,
    alertOwnerUsers: people,
    incidentOwnerTeams: teams,
    incidentOwnerUsers: people,
  };

  for (const [field, candidates] of Object.entries(relations)) {
    const resolve = (value) => {
      const id = (value._id || value).toString();
      const related = candidates.find((item) => item._id === id);
      if (!related) {
        throw new Error(`Unknown ${field} relation: ${id}`);
      }
      return related;
    };
    if (Array.isArray(record[field])) {
      record[field] = record[field].map(resolve);
    } else if (record[field]) {
      record[field] = resolve(record[field]);
    }
  }

  if (index < 0) {
    rules.push(record);
  } else {
    rules[index] = record;
  }

  return { data: record };
};

/*
 * "Add recommended rules", as the API answers it: the recommended rules this
 * SLO is missing (the fixture has Fast burn and Slow burn, so Slow leak), at
 * the severity each raises at, and - on add - each added as a rule the table
 * then lists. Every add is recorded on window.__recommendedAdds.
 */
function missingRecommendedRules() {
  return getMissingSloRecommendedBurnRateRules({
    window: slo,
    existingRules: rules,
  }).map((recommended) => {
    const severity =
      recommended.alertSeverity === SloRecommendedAlertSeverity.LeastSevere
        ? alertSeverities[alertSeverities.length - 1]
        : alertSeverities[0];

    return { ...recommended, severity, alertSeverityName: severity.name };
  });
}

/*
 * "Use the recommended policy", as the API answers it: the recommended
 * tiers the SLO is missing and - on add - each added as a tier the table
 * then lists, raising nothing. Every add is recorded on
 * window.__recommendedPolicyAdds.
 */
function missingRecommendedPolicyTiers() {
  return getMissingSloRecommendedPolicyTiers({ existingTiers: policyTiers });
}

/*
 * "Add recommended rules" for many SLOs, as the bulk routes answer it: what
 * each listed SLO is missing, scaled to its window, at the severity each
 * raises at - and, on add, each added as a rule of that SLO, so asking again
 * finds nothing. Every bulk add is recorded on window.__bulkRecommendedAdds.
 */
function bulkPreviewOf(id) {
  const listed = listSlos.find((item) => item._id === id);

  if (!listed) {
    return {
      serviceLevelObjectiveId: id,
      status: SloBulkRecommendedRulesStatus.Refused,
      rules: [],
      message: "Service Level Objective not found.",
    };
  }

  const missing = getMissingSloRecommendedBurnRateRules({
    window: listed,
    existingRules: rulesOfListedSlo[id],
  }).map((recommended) => {
    const severity =
      recommended.alertSeverity === SloRecommendedAlertSeverity.LeastSevere
        ? alertSeverities[alertSeverities.length - 1]
        : alertSeverities[0];

    return { ...recommended, severity, alertSeverityName: severity.name };
  });

  return {
    serviceLevelObjectiveId: id,
    status:
      missing.length > 0
        ? SloBulkRecommendedRulesStatus.Missing
        : SloBulkRecommendedRulesStatus.NothingMissing,
    rules: missing,
    message: null,
  };
}

let bulkAddedRuleCount = 0;

function bulkAddTo(id) {
  const preview = bulkPreviewOf(id);

  if (preview.status !== SloBulkRecommendedRulesStatus.Missing) {
    return preview;
  }

  const added = preview.rules.map((recommended) => {
    bulkAddedRuleCount += 1;
    const record = rule({
      id: `62000000-0000-4000-8000-${String(bulkAddedRuleCount).padStart(12, "0")}`,
      name: recommended.name,
      burnRateThreshold: recommended.burnRateThreshold,
      longWindowInMinutes: recommended.longWindowInMinutes,
      shortWindowInMinutes: recommended.shortWindowInMinutes,
      refireSuppressionMinutes:
        recommended.refireSuppressionMinutes === null
          ? undefined
          : recommended.refireSuppressionMinutes,
      shouldCreateAlert: true,
      shouldCreateIncident: false,
      alertSeverity: recommended.severity,
    });
    record.serviceLevelObjectiveId = new ObjectID(id);
    rulesOfListedSlo[id].push(record);
    return { ...recommended, id: record._id };
  });

  return {
    ...preview,
    status: SloBulkRecommendedRulesStatus.Added,
    rules: added,
  };
}

API.get = async () => ({ data: { data: [], count: 0 } });
API.post = async (options) => {
  const url = options && options.url ? options.url.toString() : "";

  if (
    url.endsWith(
      "/service-level-objective-burn-rate-rule/recommended-rules/bulk",
    )
  ) {
    const ids = (options.data && options.data.serviceLevelObjectiveIds) || [];

    return {
      data: {
        results: ids
          .map(bulkPreviewOf)
          .map(sloBulkRecommendedRulesResultToJSON),
      },
    };
  }

  if (
    url.endsWith(
      "/service-level-objective-burn-rate-rule/recommended-rules/bulk/add",
    )
  ) {
    const ids = (options.data && options.data.serviceLevelObjectiveIds) || [];
    const results = ids.map(bulkAddTo);

    window.__bulkRecommendedAdds = [
      ...(window.__bulkRecommendedAdds || []),
      {
        serviceLevelObjectiveIds: ids,
        added: results.map((result) => {
          return result.rules.map((item) => item.name);
        }),
      },
    ];

    return {
      data: { results: results.map(sloBulkRecommendedRulesResultToJSON) },
    };
  }

  if (
    url.endsWith(
      "/service-level-objective-error-budget-policy-tier/recommended-policy",
    )
  ) {
    return {
      data: {
        tiers: missingRecommendedPolicyTiers().map(
          sloRecommendedPolicyTierToJSON,
        ),
      },
    };
  }

  if (
    url.endsWith(
      "/service-level-objective-error-budget-policy-tier/recommended-policy/add",
    )
  ) {
    const added = missingRecommendedPolicyTiers().map((recommended) => {
      const record = policyTier({ id: nextPolicyTierId(), ...recommended });
      policyTiers.push(record);
      return { ...recommended, id: record._id };
    });

    window.__recommendedPolicyAdds = [
      ...(window.__recommendedPolicyAdds || []),
      {
        serviceLevelObjectiveId: String(
          options.data && options.data.serviceLevelObjectiveId,
        ),
        names: added.map((item) => item.name),
      },
    ];

    return {
      data: { tiers: added.map(sloRecommendedPolicyTierToJSON) },
    };
  }

  if (
    url.endsWith("/service-level-objective-burn-rate-rule/recommended-rules")
  ) {
    return {
      data: {
        rules: missingRecommendedRules().map(sloRecommendedBurnRateRuleToJSON),
      },
    };
  }

  if (
    url.endsWith(
      "/service-level-objective-burn-rate-rule/recommended-rules/add",
    )
  ) {
    const added = missingRecommendedRules().map((recommended) => {
      const record = rule({
        id: `60000000-0000-4000-8000-${String(rules.length + 1).padStart(12, "0")}`,
        name: recommended.name,
        burnRateThreshold: recommended.burnRateThreshold,
        longWindowInMinutes: recommended.longWindowInMinutes,
        shortWindowInMinutes: recommended.shortWindowInMinutes,
        refireSuppressionMinutes:
          recommended.refireSuppressionMinutes === null
            ? undefined
            : recommended.refireSuppressionMinutes,
        shouldCreateAlert: true,
        shouldCreateIncident: false,
        alertSeverity: recommended.severity,
      });
      rules.push(record);
      return { ...recommended, id: record._id };
    });

    window.__recommendedAdds = [
      ...(window.__recommendedAdds || []),
      {
        serviceLevelObjectiveId: String(
          options.data && options.data.serviceLevelObjectiveId,
        ),
        names: added.map((item) => item.name),
      },
    ];

    return {
      data: { rules: added.map(sloRecommendedBurnRateRuleToJSON) },
    };
  }

  return { data: { data: [], count: 0 } };
};

await i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
});

function OverviewLayout() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  return <SloViewLayout />;
}

function Fixture() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  const pathname = useLocation().pathname;
  const isList = pathname.endsWith("/slos");
  const isPolicy = pathname.endsWith("/error-budget-policy");
  const isOverview =
    !pathname.endsWith("/burn-rate-rules") && !isPolicy && !isList;

  if (isList) {
    return (
      <>
        <header className="flex flex-wrap gap-3 items-center justify-between border-b border-gray-200 bg-white px-8 py-5">
          <span className="text-lg font-semibold text-gray-900">OneUptime</span>
          <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
            Demo workspace · Synthetic data
          </span>
        </header>
        <main className="mx-auto max-w-[1820px] px-8 py-8">
          <div className="mb-7 text-sm text-gray-500">SLOs</div>
          <Slos />
        </main>
      </>
    );
  }

  return (
    <>
      <header className="flex flex-wrap gap-3 items-center justify-between border-b border-gray-200 bg-white px-8 py-5">
        <div className="flex items-center gap-5">
          <span className="text-lg font-semibold text-gray-900">OneUptime</span>
          <span className="text-sm text-gray-500">Checkout availability</span>
        </div>
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
          Demo workspace · Synthetic data
        </span>
      </header>
      {isOverview ? (
        <main className="mx-auto max-w-[1820px]">
          <Routes>
            <Route
              path={RouteMap[PageMap.SLO_VIEW].toString()}
              element={<OverviewLayout />}
            >
              <Route index element={<SloView />} />
            </Route>
          </Routes>
        </main>
      ) : (
        <main className="mx-auto max-w-[1820px] px-8 py-8">
          <div className="mb-7 text-sm text-gray-500">
            SLOs <span className="mx-2">/</span> Checkout availability{" "}
            <span className="mx-2">/</span>{" "}
            {isPolicy ? "Error Budget Policy" : "Burn Rate Rules"}
          </div>
          {isPolicy ? <SloErrorBudgetPolicy /> : <SloBurnRateRules />}
        </main>
      )}
    </>
  );
}

/*
 * Navigates as the Dashboard does (its src/Index.tsx): each navigation renders
 * at once, not in a React transition (Tests/Ops/E2EFixtureRouters).
 */
createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <Fixture />
  </BrowserRouter>,
);

/*
 * Offline fixture for the auto remediation rules on Incidents -> AI ->
 * Settings and Alerts -> AI -> Settings: which new incidents (or alerts)
 * OneUptime AI fixes, and whether it asks first. The pages
 * (Pages/Incidents/Settings/IncidentAISettings and
 * Pages/Alerts/Settings/AlertAISettings), their More settings fold, the Auto
 * remediation rules table (Components/AutoRemediation/AutoRemediationRulesTable),
 * its create and edit dialogs, its More fields and the Runner picker
 * (Components/Runner/RunnerPicker) are the production ones from this
 * branch; only the ModelAPI / API data boundary and the signed-in user's
 * permissions are replaced.
 *
 * Steered by the query string:
 *   - lane=alert      Alerts -> AI -> Settings (Incidents by default)
 *   - rules=saved     the project has four rules saved before this change:
 *                     one that runs its runbooks every time, a OneUptime AI
 *                     rule with runbooks and a Runner, and the two shapes
 *                     from before rules were simplified (AI composes
 *                     commands on Runners, AI picks a runbook); none by
 *                     default
 *   - investigationRules=saved
 *                     the lane's investigation rules (issue #5074): one
 *                     that investigates right away, and one that
 *                     investigates only the records still open after 10
 *                     minutes; none by default
 *   - runners=0       the project has no Runner of its own (two by default,
 *                     prod-eu-runner connected and office-runner never
 *                     connected, beside the in-cluster Runner the Kubernetes
 *                     agent chart installed, which is never offered)
 *   - runbooks=0      the project has no runbook (three by default)
 *   - role=viewer     may read the page only (Viewer); the default is a
 *                     project owner
 *   - lang=de         the Dashboard's German words
 *   - theme=dark      dark mode (set before the bundle by server.js)
 *
 * What the page sends is recorded on window.__fixture: `creates` (each
 * created record as JSON), `updates` (each update: model, id, data) and
 * `deletes` (model and id) - so the spec checks what was sent, not only
 * what was drawn.
 */
import "Common/UI/Styles/Theme.css";
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Route as PageRoute,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import IncidentAISettings from "../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentAISettings";
import AlertAISettings from "../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertAISettings";
import AIInvestigationRule from "Common/Models/DatabaseModels/AIInvestigationRule";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AutoRemediationRule from "Common/Models/DatabaseModels/AutoRemediationRule";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import Runner from "Common/Models/DatabaseModels/Runner";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Color from "Common/Types/Color";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";

const PROJECT_ID = "10000000-0000-4000-8000-0000000000a1";
const USER_ID = "30000000-0000-4000-8000-0000000000c1";

const params = new URLSearchParams(window.location.search);
const lane = params.get("lane") === "alert" ? "alert" : "incident";
const hasSavedRules = params.get("rules") === "saved";
const hasSavedInvestigationRules = params.get("investigationRules") === "saved";
const runnerCount = params.get("runners") === "0" ? 0 : 2;
const runbookCount = params.get("runbooks") === "0" ? 0 : 3;
const role = params.get("role") === "viewer" ? "viewer" : "owner";
const language = params.get("lang") === "de" ? "de" : "en";

window.__fixture = {
  creates: [],
  updates: [],
  deletes: [],
};

// ---- who is signed in -------------------------------------------------------

const HELD = {
  owner: [Permission.ProjectOwner],
  viewer: [Permission.Viewer, Permission.ProjectUser],
}[role];

UserUtil.isMasterAdmin = () => false;
UserUtil.getUserId = () => new ObjectID(USER_ID);
PermissionUtil.getAllPermissions = () => HELD;
PermissionUtil.getProjectPermissions = () => ({
  _type: "UserTenantAccessPermission",
  projectId: new ObjectID(PROJECT_ID),
  permissions: HELD.map((permission) => ({
    _type: "UserPermission",
    permission,
    labelIds: [],
    isBlockPermission: false,
  })),
});
PermissionUtil.getGlobalPermissions = () => ({
  _type: "UserGlobalAccessPermission",
  globalPermissions: [
    Permission.Public,
    Permission.User,
    Permission.CurrentUser,
  ],
  projectIds: [new ObjectID(PROJECT_ID)],
});
ProjectUtil.getCurrentProjectId = () => new ObjectID(PROJECT_ID);
ProjectUtil.getCurrentPlan = () => null;
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

// ---- what the server holds ---------------------------------------------------

function record(ModelType, fields) {
  const item = new ModelType();
  item._id = fields._id;
  item.id = new ObjectID(fields._id);
  item.createdAt = new Date("2026-10-10T09:00:00Z");
  item.updatedAt = new Date("2026-10-12T09:00:00Z");
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      item[key] = value;
    }
  }
  return item;
}

const project = record(Project, {
  _id: PROJECT_ID,
  name: "Acme Production",
  enableAi: true,
  enableAutomaticIncidentInvestigation: true,
  enableAutomaticIncidentRemediation: true,
  enableAutomaticAlertInvestigation: true,
  enableAutomaticAlertRemediation: true,
  enableAutomaticPostmortemDraft: true,
  enableAutomaticIncidentCodeFixes: false,
  enableIncidentInstrumentationFixTasks: false,
  enableAutomaticAlertCodeFixes: false,
  enableAlertInstrumentationFixTasks: false,
  useGlobalRunners: true,
});

const INCIDENT_SEVERITIES = [
  record(IncidentSeverity, {
    _id: "50000000-0000-4000-8000-0000000000e1",
    name: "Critical",
    color: new Color("#dc2626"),
    order: 1,
  }),
  record(IncidentSeverity, {
    _id: "50000000-0000-4000-8000-0000000000e2",
    name: "Major",
    color: new Color("#ea580c"),
    order: 2,
  }),
];

const ALERT_SEVERITIES = [
  record(AlertSeverity, {
    _id: "51000000-0000-4000-8000-0000000000e1",
    name: "High",
    color: new Color("#dc2626"),
    order: 1,
  }),
  record(AlertSeverity, {
    _id: "51000000-0000-4000-8000-0000000000e2",
    name: "Low",
    color: new Color("#ca8a04"),
    order: 2,
  }),
];

const LABELS = [
  record(Label, {
    _id: "60000000-0000-4000-8000-0000000000f1",
    name: "production",
    color: new Color("#4f46e5"),
  }),
];

const MONITORS = [
  record(Monitor, {
    _id: "70000000-0000-4000-8000-000000000a01",
    name: "Checkout API",
  }),
];

const RUNBOOK_IDS = {
  restartCheckout: "a0000000-0000-4000-8000-000000000b01",
  failoverDatabase: "a0000000-0000-4000-8000-000000000b02",
  clearCache: "a0000000-0000-4000-8000-000000000b03",
};

const ALL_RUNBOOKS = [
  record(Runbook, {
    _id: RUNBOOK_IDS.restartCheckout,
    name: "Restart checkout",
    isEnabled: true,
  }),
  record(Runbook, {
    _id: RUNBOOK_IDS.failoverDatabase,
    name: "Fail over the database",
    isEnabled: true,
  }),
  record(Runbook, {
    _id: RUNBOOK_IDS.clearCache,
    name: "Clear the CDN cache",
    isEnabled: true,
  }),
];

const RUNBOOKS = ALL_RUNBOOKS.slice(0, runbookCount);

const RUNNER_IDS = {
  prodEu: "b0000000-0000-4000-8000-000000000c01",
  office: "b0000000-0000-4000-8000-000000000c02",
  agent: "b0000000-0000-4000-8000-000000000c03",
};

const ALL_RUNNERS = [
  record(Runner, {
    _id: RUNNER_IDS.prodEu,
    name: "prod-eu-runner",
    projectId: new ObjectID(PROJECT_ID),
    // Heard from a moment ago: connected.
    lastAlive: new Date(),
    hostInfo: {},
  }),
  record(Runner, {
    _id: RUNNER_IDS.office,
    name: "office-runner",
    projectId: new ObjectID(PROJECT_ID),
    hostInfo: {},
  }),
];

/*
 * The in-cluster Runner the Kubernetes agent chart installed: never one of
 * a rule's choices, whatever the project lists.
 */
const AGENT_RUNNER = record(Runner, {
  _id: RUNNER_IDS.agent,
  name: "kubernetes-agent/prod-us",
  projectId: new ObjectID(PROJECT_ID),
  lastAlive: new Date(),
  hostInfo: { kubernetes: { inCluster: true, clusterIdentifier: "prod-us" } },
});

const RUNNERS =
  runnerCount > 0 ? [...ALL_RUNNERS.slice(0, runnerCount), AGENT_RUNNER] : [];

const trigger = lane === "alert" ? "Alert" : "Incident";

function runbooksNamed(ids) {
  return ALL_RUNBOOKS.filter((runbook) => ids.includes(runbook._id));
}

const SAVED_RULE_IDS = {
  everyTime: "90000000-0000-4000-8000-000000000d01",
  aiWithRunner: "90000000-0000-4000-8000-000000000d02",
  commands: "90000000-0000-4000-8000-000000000d03",
  picks: "90000000-0000-4000-8000-000000000d04",
};

const SAVED_RULES = [
  // Saved with Fix With set to Runbooks: it runs them every time.
  record(AutoRemediationRule, {
    _id: SAVED_RULE_IDS.everyTime,
    projectId: new ObjectID(PROJECT_ID),
    name: "Restart checkout every time",
    isEnabled: true,
    triggerEntityType: trigger,
    remediationAction: "Runbooks",
    executionMode: "FullAuto",
    aiComposesCommands: false,
    aiSelectsRunbook: false,
    runbooks: runbooksNamed([RUNBOOK_IDS.restartCheckout]),
    criteria: null,
  }),
  // OneUptime AI, allowed two runbooks, with a Runner for its commands.
  record(AutoRemediationRule, {
    _id: SAVED_RULE_IDS.aiWithRunner,
    projectId: new ObjectID(PROJECT_ID),
    name: "Fix database incidents",
    isEnabled: true,
    triggerEntityType: trigger,
    remediationAction: "OneUptimeAI",
    executionMode: "Suggest",
    aiComposesCommands: false,
    aiSelectsRunbook: false,
    runbooks: runbooksNamed([
      RUNBOOK_IDS.failoverDatabase,
      RUNBOOK_IDS.clearCache,
    ]),
    runnerId: new ObjectID(RUNNER_IDS.prodEu),
    criteria: null,
  }),
  // Saved before rules were simplified: AI composes commands on Runners.
  record(AutoRemediationRule, {
    _id: SAVED_RULE_IDS.commands,
    projectId: new ObjectID(PROJECT_ID),
    name: "Commands on the bastion",
    isEnabled: true,
    triggerEntityType: trigger,
    remediationAction: "OneUptimeAI",
    executionMode: "Suggest",
    aiComposesCommands: true,
    aiSelectsRunbook: false,
    runbooks: [],
    runnerId: new ObjectID(RUNNER_IDS.office),
    criteria: null,
  }),
  // Saved before rules were simplified: AI picks one of the runbooks.
  record(AutoRemediationRule, {
    _id: SAVED_RULE_IDS.picks,
    projectId: new ObjectID(PROJECT_ID),
    name: "AI picks a runbook",
    isEnabled: false,
    triggerEntityType: trigger,
    remediationAction: "OneUptimeAI",
    executionMode: "FullAuto",
    aiComposesCommands: false,
    aiSelectsRunbook: true,
    runbooks: [],
    criteria: null,
  }),
];

/*
 * The lane's investigation rules (issue #5074): one that investigates right
 * away (no wait stored, as every rule saved before rules could wait), and one
 * that investigates only the records still open after 10 minutes.
 */
const SAVED_INVESTIGATION_RULE_IDS = {
  rightAway: "91000000-0000-4000-8000-000000000e01",
  waits: "91000000-0000-4000-8000-000000000e02",
};

const SAVED_INVESTIGATION_RULES = [
  record(AIInvestigationRule, {
    _id: SAVED_INVESTIGATION_RULE_IDS.rightAway,
    projectId: new ObjectID(PROJECT_ID),
    name: lane === "alert" ? "Production alerts" : "Production incidents",
    isEnabled: true,
    triggerEntityType: trigger,
    criteria: null,
  }),
  record(AIInvestigationRule, {
    _id: SAVED_INVESTIGATION_RULE_IDS.waits,
    projectId: new ObjectID(PROJECT_ID),
    name: "Flapping checks",
    isEnabled: true,
    triggerEntityType: trigger,
    onlyIfOpenAfterMinutes: 10,
    criteria: null,
  }),
];

const TABLES = {
  Project: [project],
  AutoRemediationRule: hasSavedRules ? SAVED_RULES : [],
  Runbook: RUNBOOKS,
  Runner: RUNNERS,
  IncidentSeverity: INCIDENT_SEVERITIES,
  AlertSeverity: ALERT_SEVERITIES,
  Label: LABELS,
  Monitor: MONITORS,
  AIInvestigationRule: hasSavedInvestigationRules
    ? SAVED_INVESTIGATION_RULES
    : [],
  AIPostmortemRule: [],
  IncidentPostmortemTemplate: [],
};

// ---- the API -----------------------------------------------------------------

function tableName(modelType) {
  try {
    return String(new modelType().tableName);
  } catch {
    return "unknown";
  }
}

function idOf(value) {
  return value ? value.toString().toLowerCase() : "";
}

function sorted(items, sort) {
  const [column, direction] = Object.entries(sort || {})[0] || [];

  if (!column) {
    return items;
  }

  const sign = direction === SortOrder.Descending ? -1 : 1;

  return [...items].sort((first, second) => {
    const a = first[column];
    const b = second[column];

    if (typeof a === "number" && typeof b === "number") {
      return (a - b) * sign;
    }

    return String(a ?? "").localeCompare(String(b ?? "")) * sign;
  });
}

// The query's plain values: a switch, or a word such as a rule's trigger.
function matchesQuery(item, query) {
  for (const [key, value] of Object.entries(query || {})) {
    if (
      (typeof value === "boolean" || typeof value === "string") &&
      item[key] !== value
    ) {
      return false;
    }
  }
  return true;
}

ModelAPI.getList = async (options) => {
  const name = tableName(options.modelType);
  const items = sorted(
    (TABLES[name] || []).filter((item) => matchesQuery(item, options.query)),
    options.sort,
  );
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 10);

  return {
    data: items.slice(skip, skip + limit),
    count: items.length,
    skip,
    limit,
  };
};

ModelAPI.count = async (options) => {
  return (TABLES[tableName(options.modelType)] || []).filter((item) =>
    matchesQuery(item, options.query),
  ).length;
};
ModelAPI.getCount = ModelAPI.count;

ModelAPI.getItem = async (options) => {
  const table = TABLES[tableName(options.modelType)] || [];
  return table.find((item) => idOf(item._id) === idOf(options.id)) || null;
};

ModelAPI.updateById = async (options) => {
  const name = tableName(options.modelType);
  const data = JSON.parse(JSON.stringify(options.data || {}));

  window.__fixture.updates.push({ model: name, id: idOf(options.id), data });

  const table = TABLES[name] || [];
  const item = table.find(
    (candidate) => idOf(candidate._id) === idOf(options.id),
  );
  if (item) {
    Object.assign(item, options.data || {});
  }

  return new HTTPResponse(200, {}, {});
};

function relationList(value, ModelType) {
  if (!Array.isArray(value)) {
    return [];
  }

  const table = TABLES[tableName(ModelType)] || [];

  return value
    .map((entry) => idOf(entry && (entry._id || entry.id || entry)))
    .map((id) => table.find((row) => idOf(row._id) === id))
    .filter(Boolean);
}

// What a rule keeps of what it is sent, the way the server keeps it.
function applyRuleFields(item, json) {
  for (const [key, value] of Object.entries(json)) {
    if (key === "runbooks") {
      item.runbooks = relationList(value, Runbook);
    } else if (key === "runnerId") {
      item.runnerId = value ? new ObjectID(idOf(value)) : null;
    } else if (key !== "_id") {
      item[key] = value;
    }
  }
}

// A create or an edit through a form: kept, and recorded as sent.
ModelAPI.createOrUpdate = async (options) => {
  const name = tableName(options.modelType);
  // What the API is sent: the model as the Dashboard serialises it.
  const json = BaseModel.toJSON(options.model, options.modelType);
  const table = TABLES[name] || [];
  const isCreate = !options.model._id;

  if (isCreate) {
    window.__fixture.creates.push({ model: name, data: json });

    const created = record(options.modelType, {
      _id: `90000000-0000-4000-8000-0000000000${String(
        10 + window.__fixture.creates.length,
      ).padStart(2, "0")}`,
      projectId: new ObjectID(PROJECT_ID),
      isEnabled: true,
    });
    applyRuleFields(created, json);
    table.push(created);

    return new HTTPResponse(
      200,
      BaseModel.toJSON(created, options.modelType),
      {},
    );
  }

  window.__fixture.updates.push({
    model: name,
    id: idOf(options.model._id),
    data: json,
  });

  const item = table.find(
    (candidate) => idOf(candidate._id) === idOf(options.model._id),
  );

  if (item) {
    applyRuleFields(item, json);
  }

  return new HTTPResponse(200, json, {});
};
ModelAPI.create = ModelAPI.createOrUpdate;

ModelAPI.deleteItem = async (options) => {
  const name = tableName(options.modelType);
  window.__fixture.deletes.push({ model: name, id: idOf(options.id) });

  const table = TABLES[name] || [];
  const index = table.findIndex(
    (candidate) => idOf(candidate._id) === idOf(options.id),
  );

  if (index !== -1) {
    table.splice(index, 1);
  }
};

/*
 * POST /ai-chat/providers: the project has the global provider, so no
 * notice is drawn over the page.
 */
API.post = async () =>
  new HTTPResponse(
    200,
    {
      isAIEnabledForProject: true,
      defaultProviderId: "9d9d9d9d-0000-4000-8000-000000000001",
      providers: [
        {
          id: "9d9d9d9d-0000-4000-8000-000000000001",
          name: "OneUptime AI",
          isGlobal: true,
          isDefault: false,
        },
      ],
    },
    {},
  );
API.get = async () => new HTTPResponse(200, {}, {});

/*
 * The Dashboard looks every string up by its English text, so the
 * separators i18next reads in a key (the "." and ":" of a sentence) are
 * turned off, as the Dashboard's own setup does.
 */
await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: language,
  resources: {
    en: { translation: {} },
    de: { translation: DE },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
document.documentElement.lang = language;

function Shell() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  const SettingsPage = lane === "alert" ? AlertAISettings : IncidentAISettings;

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-8 sm:px-8">
      <div className="mb-7 text-sm text-gray-500">
        {lane === "alert" ? "Alerts" : "Incidents"} / AI / Settings
      </div>
      <SettingsPage
        pageRoute={Navigation.getCurrentRoute()}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </main>
  );
}

const target = `/dashboard/${PROJECT_ID}/${lane === "alert" ? "alerts" : "incidents"}/ai/settings`;

if (window.location.pathname !== target) {
  window.history.replaceState(null, "", target + window.location.search);
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <PageRoute
        path="/dashboard/:projectId/:product/ai/settings"
        element={<Shell />}
      />
    </Routes>
  </BrowserRouter>,
);

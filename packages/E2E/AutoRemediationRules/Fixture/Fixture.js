/*
 * Offline fixture for the AI rules on Incidents -> AI -> Settings and
 * Alerts -> AI -> Settings: which new incidents (or alerts) OneUptime AI
 * investigates, and whether - and how - it fixes them. The investigation
 * rules and the auto remediation rules became one AI rule, in the auto
 * remediation rules' table: a rule matches, investigates (right away, or
 * only if still open after a wait) and fixes (or not, asking first or not).
 * The pages (Pages/Incidents/Settings/IncidentAISettings and
 * Pages/Alerts/Settings/AlertAISettings), their More settings fold, the AI
 * rules table (Components/AISettings/AiRulesTable), its create and edit
 * dialogs, its More fields and the Runner picker
 * (Components/Runner/RunnerPicker) are the production ones from this
 * branch; only the ModelAPI / API data boundary and the signed-in user's
 * permissions are replaced.
 *
 * Steered by the query string:
 *   - lane=alert      Alerts -> AI -> Settings (Incidents by default)
 *   - rules=saved     the project has four rules that were auto remediation
 *                     rules before they became AI rules: one that runs its
 *                     runbooks every time, a OneUptime AI rule with
 *                     runbooks and a Runner (merged with an investigation
 *                     rule of the same conditions, so it investigates too),
 *                     and the two shapes from before rules were simplified
 *                     (AI composes commands on Runners, AI picks a
 *                     runbook). The three not merged only fix, as the
 *                     upgrade leaves a rule in a lane whose investigation
 *                     rules decided what is investigated. None by default
 *   - investigationRules=saved
 *                     the lane's rules that only investigate, as the
 *                     upgrade made of its investigation rules (issue
 *                     #5074): one that investigates right away, and one
 *                     that investigates only the records still open after
 *                     10 minutes; none by default
 *   - investigationRules=many
 *                     those two and three more, as a full table looks: a
 *                     long name with three conditions that waits 90
 *                     minutes, one that waits 120, and a disabled one that
 *                     waits a day (1440)
 *   - layout=page     the page in the Dashboard's own frame, beside a side
 *                     menu (Common's Page and SideMenu), so the cards are as
 *                     wide as a person sees them (about 940px of a 1280px
 *                     screen); the default is the page alone
 *   - runners=0       the project has no Runner of its own (two by default,
 *                     prod-eu-runner connected and office-runner never
 *                     connected, beside the in-cluster Runner the Kubernetes
 *                     agent chart installed, which is never offered)
 *   - defaultRunner=prod
 *                     prod-eu-runner is the project's default Runner (none
 *                     by default): a new rule starts on it
 *   - globalRunners=0 the server runs no global Runner (one by default,
 *                     global-eu, connected, read from the global Runners'
 *                     own route as the Dashboard reads it); a rule that
 *                     picks none then reads No Runner;
 *                     globalRunners=disconnected, one not heard from lately
 *   - useGlobalRunners=0
 *                     the project turned global Runners off (on by
 *                     default): a rule that picks none reads No Runner
 *   - repositories=0  the project has no code repository (two by default,
 *                     checkout and billing, connected through the GitHub
 *                     App)
 *   - repositories=many
 *                     six repositories, some with a short name and a long
 *                     GitHub organization/name ("infra" is
 *                     acme-platform-engineering/terraform-infrastructure-live)
 *   - repositories=denied
 *                     the project's plan cannot read code repositories:
 *                     the list is refused, as on a plan without Code
 *   - hiddenRepository=1
 *                     the saved rule "Fix database incidents" also names a
 *                     repository the reader may not read (not in the list)
 *   - runbooks=0      the project has no runbook (three by default)
 *   - mcpServers=0    the project has no external MCP server (two by
 *                     default, AWS and GitHub)
 *   - role=viewer     may read the page only (Viewer); the default is a
 *                     project owner
 *   - providers=project
 *                     the project's own LLM providers, Azure GPT-4o (its
 *                     default) and Claude Opus, beside the global OneUptime
 *                     AI; providers=none for no provider at all,
 *                     providers=denied for a reader who may not read them;
 *                     the global OneUptime AI alone by default
 *   - rulePick=opus   the saved rules ("Fix database incidents", and the
 *                     investigation rule that investigates right away) pick
 *                     Claude Opus; rulePick=gone, a provider the project can
 *                     no longer use; none by default
 *   - ruleContext=1   the saved rule "Fix database incidents" carries notes
 *                     for OneUptime AI, its AI context; none by default
 *   - lang=de         the Dashboard's German words (fa: Persian, right to
 *                     left)
 *   - theme=dark      dark mode (set before the bundle by server.js)
 *
 * What the page sends is recorded on window.__fixture: `creates` (each
 * created record as JSON), `updates` (each update: model, id, data) and
 * `deletes` (model and id) - so the spec checks what was sent, not only
 * what was drawn. `window.__fixture.connectRepository(name)` connects a
 * repository as someone would in another tab while a rule is edited.
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
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AutoRemediationRule from "Common/Models/DatabaseModels/AutoRemediationRule";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import ExternalMcpServer from "Common/Models/DatabaseModels/ExternalMcpServer";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import Runner from "Common/Models/DatabaseModels/Runner";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Page from "Common/UI/Components/Page/Page";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
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
import FA from "../../../App/FeatureSet/Dashboard/src/Locales/fa.json";

const PROJECT_ID = "10000000-0000-4000-8000-0000000000a1";
const USER_ID = "30000000-0000-4000-8000-0000000000c1";

const params = new URLSearchParams(window.location.search);
const lane = params.get("lane") === "alert" ? "alert" : "incident";
const hasSavedRules = params.get("rules") === "saved";
const investigationRuleSet = ["saved", "many"].includes(
  params.get("investigationRules"),
)
  ? params.get("investigationRules")
  : "none";
const layout = params.get("layout") === "page" ? "page" : "alone";
const runnerCount = params.get("runners") === "0" ? 0 : 2;
const hasDefaultRunner = params.get("defaultRunner") === "prod";
const globalRunnerSet = ["0", "disconnected"].includes(
  params.get("globalRunners"),
)
  ? params.get("globalRunners")
  : "connected";
const usesGlobalRunners = params.get("useGlobalRunners") !== "0";
const repositorySet = ["0", "denied", "many"].includes(
  params.get("repositories"),
)
  ? params.get("repositories")
  : "two";
const hasHiddenRepository = params.get("hiddenRepository") === "1";
const runbookCount = params.get("runbooks") === "0" ? 0 : 3;
const hasMcpServers = params.get("mcpServers") !== "0";
const role = params.get("role") === "viewer" ? "viewer" : "owner";
const language = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";
const providerSet = ["project", "none", "denied"].includes(
  params.get("providers"),
)
  ? params.get("providers")
  : "global";
const rulePick = params.get("rulePick");
/*
 * ?ruleContext=1: the saved rule "Fix database incidents" carries notes for
 * OneUptime AI (its AI context, issue #5198); none by default.
 */
const RULE_AI_CONTEXT =
  params.get("ruleContext") === "1"
    ? "## Database incidents\n\n- **payments-db** is a PostgreSQL primary on `vm-db-07`. Fail over only after checking replication lag."
    : undefined;

window.__fixture = {
  creates: [],
  updates: [],
  deletes: [],
  // How often the page read the global Runners (a rule's Runner picker).
  globalRunnerReads: 0,
};

/*
 * The project's LLM providers, as POST /ai-chat/providers answers them
 * (?providers=): the global OneUptime AI alone, which the project uses (the
 * default); its own Azure GPT-4o, the default, and Claude Opus, then the
 * global one (project); none at all (none); or a refusal, for a reader who
 * may not read them (denied). `window.__fixture.addProvider(name)` adds one
 * of the project's own, as someone would on LLM Providers in another tab;
 * `providerReads` counts the reads.
 */
const LLM_PROVIDER_IDS = {
  oneUptimeAi: "9d9d9d9d-0000-4000-8000-000000000001",
  azure: "9d9d9d9d-0000-4000-8000-000000000002",
  opus: "9d9d9d9d-0000-4000-8000-000000000003",
  // A provider a rule picked that the project can no longer use.
  gone: "9d9d9d9d-0000-4000-8000-0000000000ff",
};

const GLOBAL_LLM_PROVIDER = {
  id: LLM_PROVIDER_IDS.oneUptimeAi,
  name: "OneUptime AI",
  modelName: null,
  isGlobal: true,
  isDefault: false,
};

const LLM_PROVIDERS =
  providerSet === "project"
    ? [
        {
          id: LLM_PROVIDER_IDS.azure,
          name: "Azure GPT-4o",
          modelName: "gpt-4o",
          isGlobal: false,
          isDefault: true,
        },
        {
          id: LLM_PROVIDER_IDS.opus,
          name: "Claude Opus",
          modelName: "claude-opus-4-5",
          isGlobal: false,
          isDefault: false,
        },
        GLOBAL_LLM_PROVIDER,
      ]
    : providerSet === "none" || providerSet === "denied"
      ? []
      : [GLOBAL_LLM_PROVIDER];

window.__fixture.providerReads = 0;
window.__fixture.addProvider = (name) => {
  // The project's own come before the global ones.
  const firstGlobal = LLM_PROVIDERS.findIndex((provider) => provider.isGlobal);
  LLM_PROVIDERS.splice(
    firstGlobal === -1 ? LLM_PROVIDERS.length : firstGlobal,
    0,
    {
      id: `9d9d9d9d-0000-4000-8000-0000000000${String(10 + LLM_PROVIDERS.length)}`,
      name,
      modelName: "gemini-2.5-pro",
      isGlobal: false,
      isDefault: false,
    },
  );
};

// The provider the saved rules pick (?rulePick=opus or gone); none by default.
const RULE_PICK =
  rulePick === "opus"
    ? new ObjectID(LLM_PROVIDER_IDS.opus)
    : rulePick === "gone"
      ? new ObjectID(LLM_PROVIDER_IDS.gone)
      : undefined;

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
  useGlobalRunners: usesGlobalRunners,
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
    isProjectDefault: hasDefaultRunner,
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

/*
 * The global Runners OneUptime runs for every project, as their own route
 * (/runner/global-runners) lists them: no project owns them. A rule that
 * picks no Runner shows the Global Runner while there is one.
 */
const GLOBAL_RUNNERS =
  globalRunnerSet === "0"
    ? []
    : [
        record(Runner, {
          _id: "b0000000-0000-4000-8000-000000000c10",
          name: "global-eu",
          isGlobalRunner: true,
          canRunRunbooks: true,
          // Heard from a moment ago - or an hour ago, not lately.
          lastAlive:
            globalRunnerSet === "disconnected"
              ? new Date(Date.now() - 60 * 60 * 1000)
              : new Date(),
        }),
      ];

// The project's external MCP servers, which both kinds of rule may name.
const MCP_SERVER_IDS = {
  aws: "c0000000-0000-4000-8000-000000000e01",
  github: "c0000000-0000-4000-8000-000000000e02",
};

const MCP_SERVERS = hasMcpServers
  ? [
      record(ExternalMcpServer, {
        _id: MCP_SERVER_IDS.aws,
        name: "AWS",
        projectId: new ObjectID(PROJECT_ID),
        url: "https://mcp.aws.example.com/mcp",
        isEnabled: true,
      }),
      record(ExternalMcpServer, {
        _id: MCP_SERVER_IDS.github,
        name: "GitHub",
        projectId: new ObjectID(PROJECT_ID),
        url: "https://mcp.github.example.com/mcp",
        isEnabled: true,
      }),
    ]
  : [];

/*
 * The project's code repositories, connected through the GitHub App, which
 * both kinds of rule may name.
 */
const CODE_REPOSITORY_IDS = {
  checkout: "d0000000-0000-4000-8000-000000000f01",
  billing: "d0000000-0000-4000-8000-000000000f02",
};

const TWO_CODE_REPOSITORIES = [
  record(CodeRepository, {
    _id: CODE_REPOSITORY_IDS.checkout,
    name: "checkout",
    organizationName: "acme",
    repositoryName: "checkout-service",
    projectId: new ObjectID(PROJECT_ID),
  }),
  record(CodeRepository, {
    _id: CODE_REPOSITORY_IDS.billing,
    name: "billing",
    organizationName: "acme",
    repositoryName: "billing",
    projectId: new ObjectID(PROJECT_ID),
  }),
];

/*
 * repositories=many: as an organization with several teams connects them,
 * short names beside long GitHub organization/names.
 */
const MORE_CODE_REPOSITORIES = [
  ["infra", "acme-platform-engineering", "terraform-infrastructure-live"],
  ["web", "acme", "web-frontend"],
  ["analytics", "acme-data", "analytics-pipelines"],
  [
    "payments-gateway-and-reconciliation-service",
    "acme-platform-engineering",
    "payments-gateway-and-reconciliation-service",
  ],
].map(([name, organizationName, repositoryName], index) => {
  return record(CodeRepository, {
    _id: `d0000000-0000-4000-8000-000000000f${String(11 + index)}`,
    name,
    organizationName,
    repositoryName,
    projectId: new ObjectID(PROJECT_ID),
  });
});

const CODE_REPOSITORIES =
  repositorySet === "two"
    ? TWO_CODE_REPOSITORIES
    : repositorySet === "many"
      ? [...TWO_CODE_REPOSITORIES, ...MORE_CODE_REPOSITORIES]
      : [];

// A repository the reader may not read: no list returns it.
const HIDDEN_CODE_REPOSITORY_ID = "d0000000-0000-4000-8000-000000000fff";

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
  // Saved with Fix With set to Runbooks: it runs them every time, and only fixes.
  record(AutoRemediationRule, {
    _id: SAVED_RULE_IDS.everyTime,
    projectId: new ObjectID(PROJECT_ID),
    name: "Restart checkout every time",
    isEnabled: true,
    triggerEntityType: trigger,
    investigates: false,
    fixes: true,
    remediationAction: "Runbooks",
    executionMode: "FullAuto",
    aiComposesCommands: false,
    aiSelectsRunbook: false,
    runbooks: runbooksNamed([RUNBOOK_IDS.restartCheckout]),
    // As the server keeps a rule saved before the switches: both on.
    openCodeFixPullRequests: true,
    openTelemetryPullRequests: true,
    criteria: null,
  }),
  /*
   * OneUptime AI, allowed two runbooks, with a Runner for its commands: an
   * investigation rule of the same conditions was merged into it, so it
   * investigates too, right away.
   */
  record(AutoRemediationRule, {
    _id: SAVED_RULE_IDS.aiWithRunner,
    projectId: new ObjectID(PROJECT_ID),
    name: "Fix database incidents",
    isEnabled: true,
    triggerEntityType: trigger,
    investigates: true,
    fixes: true,
    remediationAction: "OneUptimeAI",
    executionMode: "Suggest",
    aiComposesCommands: false,
    aiSelectsRunbook: false,
    runbooks: runbooksNamed([
      RUNBOOK_IDS.failoverDatabase,
      RUNBOOK_IDS.clearCache,
    ]),
    runnerId: new ObjectID(RUNNER_IDS.prodEu),
    // The LLM provider it fixes with (?rulePick=): none by default.
    llmProviderId: RULE_PICK,
    // Its notes for OneUptime AI (?ruleContext=1): none by default.
    aiContext: RULE_AI_CONTEXT,
    /*
     * It names one repository - and, with hiddenRepository=1, one the
     * reader may not read, which the list never returns - and opens fix
     * pull requests but not telemetry ones.
     */
    codeRepositories: hasHiddenRepository
      ? [
          ...CODE_REPOSITORIES.slice(0, 1),
          record(CodeRepository, {
            _id: HIDDEN_CODE_REPOSITORY_ID,
            projectId: new ObjectID(PROJECT_ID),
          }),
        ]
      : CODE_REPOSITORIES.slice(0, 1),
    openCodeFixPullRequests: true,
    openTelemetryPullRequests: false,
    criteria: null,
  }),
  // Saved before rules were simplified: AI composes commands on Runners.
  record(AutoRemediationRule, {
    _id: SAVED_RULE_IDS.commands,
    projectId: new ObjectID(PROJECT_ID),
    name: "Commands on the bastion",
    isEnabled: true,
    triggerEntityType: trigger,
    investigates: false,
    fixes: true,
    remediationAction: "OneUptimeAI",
    executionMode: "Suggest",
    aiComposesCommands: true,
    aiSelectsRunbook: false,
    runbooks: [],
    runnerId: new ObjectID(RUNNER_IDS.office),
    openCodeFixPullRequests: true,
    openTelemetryPullRequests: true,
    criteria: null,
  }),
  // Saved before rules were simplified: AI picks one of the runbooks.
  record(AutoRemediationRule, {
    _id: SAVED_RULE_IDS.picks,
    projectId: new ObjectID(PROJECT_ID),
    name: "AI picks a runbook",
    isEnabled: false,
    triggerEntityType: trigger,
    investigates: false,
    fixes: true,
    remediationAction: "OneUptimeAI",
    executionMode: "FullAuto",
    aiComposesCommands: false,
    aiSelectsRunbook: true,
    runbooks: [],
    openCodeFixPullRequests: true,
    openTelemetryPullRequests: true,
    criteria: null,
  }),
];

/*
 * The lane's rules that only investigate - its investigation rules, as the
 * upgrade copied them (MergeInvestigationRulesIntoAiRules: they investigate,
 * fix nothing, and hold an auto remediation rule's defaults for the rest):
 * one that investigates right away (no wait stored, as every rule saved
 * before rules could wait), and one that investigates only the records
 * still open after 10 minutes (issue #5074).
 */
const SAVED_INVESTIGATION_RULE_IDS = {
  rightAway: "91000000-0000-4000-8000-000000000e01",
  waits: "91000000-0000-4000-8000-000000000e02",
};

function investigationOnlyRule(fields) {
  return record(AutoRemediationRule, {
    projectId: new ObjectID(PROJECT_ID),
    triggerEntityType: trigger,
    investigates: true,
    fixes: false,
    executionMode: "Suggest",
    remediationAction: "OneUptimeAI",
    aiComposesCommands: false,
    aiSelectsRunbook: false,
    runbooks: [],
    openCodeFixPullRequests: true,
    openTelemetryPullRequests: true,
    criteria: null,
    ...fields,
  });
}

const SAVED_INVESTIGATION_RULES = [
  investigationOnlyRule({
    _id: SAVED_INVESTIGATION_RULE_IDS.rightAway,
    name: lane === "alert" ? "Production alerts" : "Production incidents",
    isEnabled: true,
    // The LLM provider it investigates with (?rulePick=): none by default.
    llmProviderId: RULE_PICK,
  }),
  investigationOnlyRule({
    _id: SAVED_INVESTIGATION_RULE_IDS.waits,
    name: "Flapping checks",
    isEnabled: true,
    onlyIfOpenAfterMinutes: 10,
  }),
];

/*
 * A full table (investigationRules=many): a long name with three
 * conditions, the waits a project picks most beyond a few minutes, and the
 * longest a rule may wait, on a disabled rule.
 */
const MORE_INVESTIGATION_RULES = [
  investigationOnlyRule({
    _id: "91000000-0000-4000-8000-000000000e03",
    name: "Payments and checkout incidents on the eu-west-1 cluster after a deploy",
    isEnabled: true,
    onlyIfOpenAfterMinutes: 90,
    criteria: {
      schemaVersion: 1,
      filterCondition: "All",
      filters: [
        {
          field: lane === "alert" ? "alertSeverities" : "incidentSeverities",
          operator: "HasAnyOf",
          value: [
            (lane === "alert" ? ALERT_SEVERITIES : INCIDENT_SEVERITIES)[0]._id,
          ],
        },
        { field: "labels", operator: "HasAnyOf", value: [LABELS[0]._id] },
        {
          field: "titlePattern",
          operator: "MatchesPattern",
          value: "payments|checkout",
        },
      ],
    },
  }),
  investigationOnlyRule({
    _id: "91000000-0000-4000-8000-000000000e04",
    name: "Batch jobs",
    isEnabled: true,
    onlyIfOpenAfterMinutes: 120,
  }),
  investigationOnlyRule({
    _id: "91000000-0000-4000-8000-000000000e05",
    name: "Nightly backups",
    isEnabled: false,
    onlyIfOpenAfterMinutes: 1440,
  }),
];

// One table holds them all: the AI rules.
const TABLES = {
  Project: [project],
  AutoRemediationRule: [
    ...(hasSavedRules ? SAVED_RULES : []),
    ...(investigationRuleSet === "many"
      ? [...SAVED_INVESTIGATION_RULES, ...MORE_INVESTIGATION_RULES]
      : investigationRuleSet === "saved"
        ? SAVED_INVESTIGATION_RULES
        : []),
  ],
  Runbook: RUNBOOKS,
  Runner: RUNNERS,
  IncidentSeverity: INCIDENT_SEVERITIES,
  AlertSeverity: ALERT_SEVERITIES,
  Label: LABELS,
  Monitor: MONITORS,
  ExternalMcpServer: MCP_SERVERS,
  CodeRepository: CODE_REPOSITORIES,
  AIPostmortemRule: [],
  IncidentPostmortemTemplate: [],
};

/*
 * A repository connected in another tab while a rule is being edited: the
 * next read of the list returns it.
 */
window.__fixture.connectRepository = (name) => {
  TABLES.CodeRepository.push(
    record(CodeRepository, {
      _id: `d0000000-0000-4000-8000-000000000e${String(
        10 + TABLES.CodeRepository.length,
      )}`,
      name,
      organizationName: "acme",
      repositoryName: name,
      projectId: new ObjectID(PROJECT_ID),
    }),
  );
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
  const overrideUrl = String(
    (options.requestOptions &&
      options.requestOptions.overrideRequestUrl &&
      options.requestOptions.overrideRequestUrl.toString()) ||
      "",
  );

  // The global Runners, from their own route: no project owns them.
  if (name === "Runner" && overrideUrl.includes("/runner/global-runners")) {
    window.__fixture.globalRunnerReads++;

    return {
      data: GLOBAL_RUNNERS,
      count: GLOBAL_RUNNERS.length,
      skip: 0,
      limit: Number(options.limit || 10),
    };
  }

  // A plan without Code: the repositories are refused (402).
  if (name === "CodeRepository" && repositorySet === "denied") {
    throw new Error(
      "Please upgrade your plan to Growth to access this feature.",
    );
  }

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
    } else if (key === "externalMcpServers") {
      item.externalMcpServers = relationList(value, ExternalMcpServer);
    } else if (key === "codeRepositories") {
      item.codeRepositories = relationList(value, CodeRepository);
    } else if (key === "runnerId") {
      item.runnerId = value ? new ObjectID(idOf(value)) : null;
    } else if (key === "llmProviderId") {
      item.llmProviderId = value ? new ObjectID(idOf(value)) : null;
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
 * POST /ai-chat/providers: the project's LLM providers (?providers=). With
 * the global provider, the default, no notice is drawn over the page.
 */
API.post = async () => {
  window.__fixture.providerReads++;

  if (providerSet === "denied") {
    return new HTTPErrorResponse(
      403,
      {
        message:
          "You do not have permission to read this project's AI providers.",
      },
      {},
    );
  }

  const defaultProvider =
    LLM_PROVIDERS.find((provider) => provider.isDefault) ||
    LLM_PROVIDERS.find((provider) => provider.isGlobal) ||
    null;

  return new HTTPResponse(
    200,
    {
      isAIEnabledForProject: true,
      defaultProviderId: defaultProvider ? defaultProvider.id : null,
      providers: LLM_PROVIDERS.map((provider) => ({ ...provider })),
    },
    {},
  );
};
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
    fa: { translation: FA },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
document.documentElement.lang = language;
document.documentElement.dir = language === "fa" ? "rtl" : "ltr";

function Shell() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  const SettingsPage = lane === "alert" ? AlertAISettings : IncidentAISettings;

  /*
   * The Dashboard's frame: the page beside its side menu, which is what
   * leaves a card about 940px of a 1280px screen.
   */
  if (layout === "page") {
    return (
      <Page
        title={lane === "alert" ? "Alerts" : "Incidents"}
        breadcrumbLinks={[]}
        sideMenu={
          <SideMenu
            sections={[
              {
                title: "AI",
                items: [
                  {
                    link: {
                      title: "Settings",
                      to: new Route(window.location.pathname),
                    },
                    icon: IconProp.Settings,
                  },
                ],
              },
            ]}
          />
        }
      >
        <SettingsPage
          pageRoute={Navigation.getCurrentRoute()}
          currentProject={project}
          hasPaymentMethod={true}
        />
      </Page>
    );
  }

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

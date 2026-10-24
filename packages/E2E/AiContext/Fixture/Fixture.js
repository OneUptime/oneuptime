/*
 * Offline fixture for the AI context (issue #5198): what a project's team
 * writes for OneUptime AI about its own systems.
 *
 *   - Project Settings -> AI -> AI Features (Pages/Settings/AIFeatures):
 *     Enable AI, then the AI context card (Components/AISettings/
 *     ProjectAiContextCard) - empty, written, or long enough to fold - its
 *     Add / Edit dialog with the counted Markdown field and the outline to
 *     start from, then the folded daily limits;
 *   - a run's details (Components/AI/InvestigationReport/
 *     InvestigationRunDetails): its activity's "Read the project's AI
 *     context" line, and the dialog its View opens with the notes the run
 *     read, word for word;
 *   - a live run (Components/AIChat/ChatActivityFeed, as the incident's
 *     conversation and the investigation panel draw it while a run works:
 *     its latest steps only), whose steps the spec adds.
 *
 * The pages and components are the production ones from this branch; only
 * the ModelAPI / API data boundary and the signed-in user's permissions are
 * replaced.
 *
 * Steered by the query string:
 *   - page=run        a run's details (the AI Features page by default);
 *                     page=live, a run still working, its latest eight
 *                     steps drawn - window.__aiContextFixture.addSteps(n)
 *                     adds n more
 *   - context=set     the project's AI context is written (a few
 *                     sections, taller than the card's fold);
 *                     context=short, two lines that fit; context=long,
 *                     two dozen sections; none by default
 *   - read=rules      what the run read (page=run): the project's notes and
 *                     two AI rules'; read=ruleOnly, one rule's alone;
 *                     read=leftOut, a rule's left out for the run's limit;
 *                     the project's alone by default
 *   - role=admin      a Project Admin (may write it too); member, a Project
 *                     Member (reads it, the button locked); the default is
 *                     a project owner
 *   - layout=page     the page inside the Dashboard's real Project Settings
 *                     layout - the side menu, the breadcrumbs - so widths
 *                     are the product's
 *   - lang=de         the Dashboard's German words (fa: Persian, right to
 *                     left; ja: Japanese)
 *   - theme=dark      dark mode (set before the bundle by server.js)
 *
 * What the page sends is recorded on window.__aiContextFixture.state:
 * `saves` (each save of the card's dialog, as the API is sent it),
 * `switches` (each switch flipped) and `unhandled` (any request this
 * fixture does not model - the spec fails on one).
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
import AIFeaturesPage from "../../../App/FeatureSet/Dashboard/src/Pages/Settings/AIFeatures";
import SettingsLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Settings/Layout";
import InvestigationRunDetails from "../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationReport/InvestigationRunDetails";
import ChatActivityFeed from "../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import FA from "../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import JA from "../../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import AIRunEventType from "Common/Types/AI/AIRunEventType";
import {
  AI_RULE_AI_CONTEXT_MAX_CHARACTERS,
  PROJECT_AI_CONTEXT_MAX_CHARACTERS,
  composeAiContext,
} from "Common/Types/AI/AiContext";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";

const PROJECT_ID = "10000000-0000-4000-8000-0000000000a1";
const USER_ID = "30000000-0000-4000-8000-0000000000c1";
const SETTINGS_PATH = `/dashboard/${PROJECT_ID}/settings/ai-features`;
const RUN_PATH = `/dashboard/${PROJECT_ID}/ai-run`;
const LIVE_PATH = `/dashboard/${PROJECT_ID}/ai-run-live`;

const params = new URLSearchParams(window.location.search);
const page = ["run", "live"].includes(params.get("page"))
  ? params.get("page")
  : "settings";
const role = ["admin", "member"].includes(params.get("role"))
  ? params.get("role")
  : "owner";
const language = ["de", "fa", "ja"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";
const contextKind = ["set", "short", "long"].includes(params.get("context"))
  ? params.get("context")
  : "none";
const readKind = ["rules", "ruleOnly", "leftOut"].includes(params.get("read"))
  ? params.get("read")
  : "project";
const isInSettingsLayout = params.get("layout") === "page";

// ---- who is signed in -------------------------------------------------------

const HELD = {
  owner: [Permission.ProjectOwner],
  admin: [Permission.ProjectAdmin],
  member: [Permission.ProjectMember],
}[role];

UserUtil.isMasterAdmin = () => false;
UserUtil.isLoggedIn = () => true;
UserUtil.getUserId = () => new ObjectID(USER_ID);
PermissionUtil.getAllPermissions = () => HELD;
PermissionUtil.getProjectPermissions = () => {
  return {
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: HELD.map((permission) => ({
      _type: "UserPermission",
      permission,
      labelIds: [],
      isBlockPermission: false,
    })),
  };
};
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

/*
 * The notes a team writes: how its systems fit together, who owns which
 * symptom, where the logs are, the words it uses - as the customer's own
 * architecture guide for their support team does.
 */
const NOTES = [
  "## How our systems fit together",
  "",
  "- **checkout-api** serves the checkout page and depends on **payments-db** and **redis-cart**.",
  "- **payments-db** is a PostgreSQL primary on `vm-db-07`, with one replica.",
  "",
  "## Who owns what",
  "",
  "| Symptom | Owner | Check first |",
  "| --- | --- | --- |",
  "| 502 on /checkout | Payments team | `vm-db-07` CPU and connections |",
  "| Slow search | Search team | the Elasticsearch heap |",
  "",
  "## Where the logs are",
  "",
  "- App logs: Loki, `app=<service>`.",
  "",
  "## Words we use",
  "",
  "- **PSP**: our payment service provider.",
].join("\n");

// Two lines: notes that fit the card's fold.
const SHORT_NOTES = [
  "- **checkout-api** depends on **payments-db**.",
  "- Its logs are in Loki under `app=checkout`.",
].join("\n");

function longNotes() {
  const sections = [];

  for (let index = 1; index <= 24; index++) {
    sections.push(
      `## Service ${index}\n\n- service-${index}-api depends on service-${index}-db and the shared message bus.\n- Its logs are in Loki under \`app=service-${index}\`, and its on-call rotation is team ${index}.`,
    );
  }

  return sections.join("\n\n");
}

const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  id: new ObjectID(PROJECT_ID),
  name: "Acme Production",
  enableAi: true,
  aiContext: {
    set: NOTES,
    short: SHORT_NOTES,
    long: longNotes(),
    none: undefined,
  }[contextKind],
});

window.__aiContextFixture = {
  state: {
    saves: [],
    switches: [],
    unhandled: [],
  },
  limits: {
    project: PROJECT_AI_CONTEXT_MAX_CHARACTERS,
    rule: AI_RULE_AI_CONTEXT_MAX_CHARACTERS,
  },
};

const state = window.__aiContextFixture.state;

function copy(item) {
  return Object.assign(new item.constructor(), item);
}

function tableName(modelType) {
  try {
    return String(new modelType().tableName);
  } catch {
    return "unknown";
  }
}

ModelAPI.getItem = async (options) => {
  if (tableName(options.modelType) === "Project") {
    return copy(project);
  }

  state.unhandled.push(`getItem ${tableName(options.modelType)}`);
  return null;
};

ModelAPI.getList = async (options) => {
  state.unhandled.push(`getList ${tableName(options.modelType)}`);
  return { data: [], count: 0, skip: 0, limit: 10 };
};

// The Enable AI switch.
ModelAPI.updateById = async (options) => {
  state.switches.push({
    id: String(options.id),
    data: JSON.parse(JSON.stringify(options.data || {})),
  });
  Object.assign(project, options.data || {});
  return new HTTPResponse(200, {}, {});
};

// A save of the AI context card's dialog: kept, and recorded as sent.
ModelAPI.createOrUpdate = async (options) => {
  const json = BaseModel.toJSON(options.model, options.modelType);
  state.saves.push(json);

  if (Object.prototype.hasOwnProperty.call(json, "aiContext")) {
    project.aiContext = json.aiContext === null ? undefined : json.aiContext;
  }

  return new HTTPResponse(200, json, {});
};

// The request's path, parsed: the page's API addresses are absolute URLs.
function pathOf(options) {
  return new URL(options.url.toString(), window.location.origin).pathname;
}

API.post = async (options) => {
  const path = pathOf(options);

  // POST /ai-chat/providers: the project has the global provider.
  if (path.endsWith("/ai-chat/providers")) {
    return new HTTPResponse(
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
  }

  // POST /ai/daily-usage: what AI used today, for the folded daily limits.
  if (path.endsWith("/ai/daily-usage")) {
    return new HTTPResponse(200, { usedTokensToday: 12400 }, {});
  }

  state.unhandled.push(`POST ${path}`);
  return new HTTPResponse(200, {}, {});
};

API.get = async (options) => {
  state.unhandled.push(`GET ${pathOf(options)}`);
  return new HTTPResponse(200, {}, {});
};

// ---- a run, and what it read ---------------------------------------------------

const RULE_NOTES_CHECKOUT =
  "Checkout runs on the **payments** Kubernetes cluster. Restarting `checkout-api` is safe; restarting `payments-db` is not.";
const RULE_NOTES_SEARCH =
  "Search incidents: check the Elasticsearch heap first.";

function readByTheRun() {
  if (readKind === "ruleOnly") {
    return composeAiContext({
      projectContext: "",
      rules: [
        {
          id: "a1000000-0000-4000-8000-000000000001",
          name: "Checkout incidents",
          aiContext: RULE_NOTES_CHECKOUT,
        },
      ],
    });
  }

  if (readKind === "leftOut") {
    return composeAiContext({
      projectContext: `${NOTES}\n\n${"x".repeat(PROJECT_AI_CONTEXT_MAX_CHARACTERS - NOTES.length - 2)}`,
      rules: [
        {
          id: "a1000000-0000-4000-8000-000000000001",
          name: "Checkout incidents",
          aiContext: "c".repeat(AI_RULE_AI_CONTEXT_MAX_CHARACTERS),
        },
        {
          id: "a1000000-0000-4000-8000-000000000002",
          name: "Database incidents",
          aiContext: "d".repeat(AI_RULE_AI_CONTEXT_MAX_CHARACTERS),
        },
        {
          id: "a1000000-0000-4000-8000-000000000003",
          name: "Search incidents",
          aiContext: "s".repeat(AI_RULE_AI_CONTEXT_MAX_CHARACTERS),
        },
      ],
    });
  }

  return composeAiContext({
    projectContext: NOTES,
    rules:
      readKind === "rules"
        ? [
            {
              id: "a1000000-0000-4000-8000-000000000001",
              name: "Checkout incidents",
              aiContext: RULE_NOTES_CHECKOUT,
            },
            {
              id: "a1000000-0000-4000-8000-000000000002",
              name: "Search incidents",
              aiContext: RULE_NOTES_SEARCH,
            },
          ]
        : [],
  });
}

function event(sequence, eventType, extra = {}) {
  return Object.assign(new AIRunEvent(), {
    _id: `e0000000-0000-4000-8000-0000000000${String(10 + sequence).padStart(2, "0")}`,
    id: new ObjectID(
      `e0000000-0000-4000-8000-0000000000${String(10 + sequence).padStart(2, "0")}`,
    ),
    sequence,
    eventType,
    createdAt: new Date("2026-10-24T09:00:00Z"),
    ...extra,
  });
}

const aiContext = readByTheRun();

const EVENTS = [
  event(0, AIRunEventType.RunStarted),
  event(1, AIRunEventType.ProgressLog, {
    resultSummary: {
      message: "Read the project's AI context.",
      severity: aiContext.leftOutRuleNames ? "Warning" : "Info",
      aiContext,
    },
  }),
  event(2, AIRunEventType.LlmCallStarted),
  event(3, AIRunEventType.LlmCallCompleted),
  event(4, AIRunEventType.ToolCallStarted, { toolName: "search_logs" }),
  event(5, AIRunEventType.ToolCallCompleted, {
    toolName: "search_logs",
    resultSummary: { rowCount: 42, durationInMs: 380 },
  }),
  event(6, AIRunEventType.LlmCallStarted),
  event(7, AIRunEventType.LlmCallCompleted),
  event(8, AIRunEventType.RunCompleted),
];

// An event of the live run, with an id of its own.
function liveEvent(sequence, eventType, extra = {}) {
  const id = `e1000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;

  return Object.assign(new AIRunEvent(), {
    _id: id,
    id: new ObjectID(id),
    sequence,
    eventType,
    createdAt: new Date("2026-10-24T09:00:00Z"),
    ...extra,
  });
}

/*
 * A live run's steps after the AI context line: one search of the logs at a
 * time, each a call to the model and a tool call, as a run's are.
 */
function liveStep(index) {
  const sequence = 100 + index * 4;

  return [
    liveEvent(sequence, AIRunEventType.LlmCallStarted),
    liveEvent(sequence + 1, AIRunEventType.LlmCallCompleted),
    liveEvent(sequence + 2, AIRunEventType.ToolCallStarted, {
      toolName: "search_logs",
    }),
    liveEvent(sequence + 3, AIRunEventType.ToolCallCompleted, {
      toolName: "search_logs",
      resultSummary: { rowCount: 10 + index, durationInMs: 200 + index },
    }),
  ];
}

// ---- the pages ---------------------------------------------------------------

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
    ja: { translation: JA },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
document.documentElement.lang = language;
document.documentElement.dir = language === "fa" ? "rtl" : "ltr";

function useNavigation() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
}

function RunPage() {
  useNavigation();

  return (
    <main
      className="mx-auto max-w-[900px] px-4 py-8 sm:px-8"
      data-testid="fixture-page"
    >
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          AI Investigation
        </h2>
        <InvestigationRunDetails
          evidence={[]}
          legacyEntries={[]}
          events={EVENTS}
          usage={{ toolCallCount: 1, totalTokens: 18400 }}
          modelName="claude-sonnet-5-5"
          subjectType="incident"
          subjectId="b0000000-0000-4000-8000-000000000001"
          runId="d0000000-0000-4000-8000-000000000001"
        />
      </section>
    </main>
  );
}

/*
 * A run still working: its activity as the incident's conversation draws it
 * (the latest eight steps, under a rule), the run's first steps - starting,
 * and the AI context it read - in it, and more added when the spec says.
 */
function LivePage() {
  useNavigation();

  const [stepCount, setStepCount] = React.useState(0);

  window.__aiContextFixture.addSteps = (count) => {
    setStepCount((current) => current + count);
  };

  const events = EVENTS.slice(0, 2);

  for (let index = 0; index < stepCount; index++) {
    events.push(...liveStep(index));
  }

  return (
    <main
      className="mx-auto max-w-[900px] px-4 py-8 sm:px-8"
      data-testid="fixture-page"
    >
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          OneUptime AI is investigating
        </h2>
        <div
          className="border-l-2 border-gray-200 pl-3"
          data-testid="live-steps"
        >
          <ChatActivityFeed
            events={events}
            hideChrome={true}
            showLiveIndicator={false}
            maxVisibleSteps={8}
          />
        </div>
      </section>
    </main>
  );
}

function SettingsShell() {
  useNavigation();

  if (isInSettingsLayout) {
    // Inside the real Project Settings layout: Page, side menu, breadcrumbs.
    return (
      <SettingsLayout
        pageRoute={Navigation.getCurrentRoute()}
        currentProject={project}
        hasPaymentMethod={true}
      />
    );
  }

  return (
    <main
      className="mx-auto max-w-[1100px] px-4 py-8 sm:px-8"
      data-testid="fixture-page"
    >
      <div className="mb-7 text-sm text-gray-500">
        Project Settings / AI / AI Features
      </div>
      <AIFeaturesPage
        pageRoute={Navigation.getCurrentRoute()}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </main>
  );
}

// What the settings layout draws in its outlet.
function OutletPage() {
  return (
    <div data-testid="fixture-page">
      <AIFeaturesPage
        pageRoute={Navigation.getCurrentRoute()}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </div>
  );
}

const target =
  page === "run" ? RUN_PATH : page === "live" ? LIVE_PATH : SETTINGS_PATH;

if (window.location.pathname !== target) {
  window.history.replaceState(null, "", target + window.location.search);
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <PageRoute path="/dashboard/:projectId/ai-run" element={<RunPage />} />
      <PageRoute
        path="/dashboard/:projectId/ai-run-live"
        element={<LivePage />}
      />
      {isInSettingsLayout ? (
        <PageRoute
          path="/dashboard/:projectId/settings"
          element={<SettingsShell />}
        >
          <PageRoute path="ai-features" element={<OutletPage />} />
        </PageRoute>
      ) : (
        <PageRoute
          path="/dashboard/:projectId/settings/ai-features"
          element={<SettingsShell />}
        />
      )}
    </Routes>
  </BrowserRouter>,
);

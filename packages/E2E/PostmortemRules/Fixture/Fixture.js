/*
 * Offline fixture for Incidents -> AI -> Settings and its Postmortem rules:
 * which resolved incidents OneUptime AI drafts a postmortem for, and the
 * postmortem templates each draft follows. The page
 * (Pages/Incidents/Settings/IncidentAISettings), its More settings fold, the
 * Postmortem rules table (Components/AISettings/AIPostmortemRulesTable), its
 * create and edit dialogs and its conditions builder are the production ones
 * from this branch; only the ModelAPI / API data boundary and the signed-in
 * user's permissions are replaced.
 *
 * Steered by the query string:
 *   - rules=<n>       how many postmortem rules the project has (0 by
 *                     default, at most 4), top of the list first; the
 *                     fourth is a disabled rule with a long name of its own
 *                     and all five templates
 *   - templates=<n>   how many postmortem templates it has (5 by default,
 *                     fewer for fewer)
 *   - layout=page     the page in the Dashboard's own frame, beside a side
 *                     menu (Common's Page and SideMenu), so the cards are as
 *                     wide as a person sees them; the default is the page
 *                     alone
 *   - role=viewer     may read the page only (Viewer); the default is a
 *                     project owner
 *   - billing=on      OneUptime Cloud (billing on), with plan=free or
 *                     plan=growth (the default) for the project's plan
 *   - fail=reorder    the next drop is refused, as a server would
 *   - providers=project
 *                     the project's own LLM providers, Azure GPT-4o (its
 *                     default) and Claude Opus, beside the global OneUptime
 *                     AI; providers=none for no provider at all,
 *                     providers=denied for a reader who may not read them;
 *                     the global OneUptime AI alone by default
 *   - rulePick=opus   the top rule picks Claude Opus; rulePick=gone, a
 *                     provider the project can no longer use; none by
 *                     default
 *   - lang=de         the Dashboard's German words
 *   - theme=dark      dark mode (set before the bundle by server.js)
 *
 * What the page sends is recorded on window.__fixture: `creates` (each
 * created record as JSON), `updates` (each updateById: model, id, data) and
 * `deletes` (model and id) - so the spec checks what was sent, not only
 * what was drawn. The tables answer from in-memory records, which a create,
 * an update or a delete changes, and a drop moves the rows the way the
 * server does (Common/Utils/ListOrder).
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
import AIPostmortemRule from "Common/Models/DatabaseModels/AIPostmortemRule";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentPostmortemTemplate from "Common/Models/DatabaseModels/IncidentPostmortemTemplate";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Color from "Common/Types/Color";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import { getListOrderCollisionChanges } from "Common/Utils/ListOrder";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import Page from "Common/UI/Components/Page/Page";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import PermissionUtil from "Common/UI/Utils/Permission";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";

const PROJECT_ID = "10000000-0000-4000-8000-0000000000a1";
const USER_ID = "30000000-0000-4000-8000-0000000000c1";

const params = new URLSearchParams(window.location.search);
const ruleCount = Math.min(4, Math.max(0, Number(params.get("rules") ?? 0)));
const templateCount = Math.min(
  5,
  Math.max(0, Number(params.get("templates") ?? 5)),
);
const layout = params.get("layout") === "page" ? "page" : "alone";
const role = params.get("role") === "viewer" ? "viewer" : "owner";
const plan = params.get("plan") === "free" ? PlanType.Free : PlanType.Growth;
const language = params.get("lang") === "de" ? "de" : "en";
let failNextReorder = params.get("fail") === "reorder";
const providerSet = ["project", "none", "denied"].includes(
  params.get("providers"),
)
  ? params.get("providers")
  : "global";
const rulePick = params.get("rulePick");

window.__fixture = {
  creates: [],
  updates: [],
  deletes: [],
};

/*
 * The project's LLM providers, as POST /ai-chat/providers answers them
 * (?providers=): the global OneUptime AI alone, which the project uses (the
 * default); its own Azure GPT-4o, the default, and Claude Opus, then the
 * global one (project); none at all (none); or a refusal, for a reader who
 * may not read them (denied).
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

// The provider the top rule picks (?rulePick=opus or gone); none by default.
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
// The project's plan, read on OneUptime Cloud only (billing=on).
ProjectUtil.getCurrentPlan = () =>
  window.process.env.BILLING_ENABLED === "true" ? plan : null;
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
  enableAutomaticIncidentRemediation: false,
  enableAutomaticPostmortemDraft: true,
});

/*
 * Live severities: a picker lists only the ones not archived (it asks for
 * isArchived false, and this fixture's query matching reads a flag as set).
 */
const SEVERITIES = [
  record(IncidentSeverity, {
    _id: "50000000-0000-4000-8000-0000000000e1",
    name: "Critical",
    color: new Color("#dc2626"),
    order: 1,
    isArchived: false,
  }),
  record(IncidentSeverity, {
    _id: "50000000-0000-4000-8000-0000000000e2",
    name: "Major",
    color: new Color("#ea580c"),
    order: 2,
    isArchived: false,
  }),
  record(IncidentSeverity, {
    _id: "50000000-0000-4000-8000-0000000000e3",
    name: "Minor",
    color: new Color("#ca8a04"),
    order: 3,
    isArchived: false,
  }),
];

const LABELS = [
  record(Label, {
    _id: "60000000-0000-4000-8000-0000000000f1",
    name: "production",
    color: new Color("#4f46e5"),
  }),
  record(Label, {
    _id: "60000000-0000-4000-8000-0000000000f2",
    name: "database",
    color: new Color("#0d9488"),
  }),
];

const MONITORS = [
  record(Monitor, {
    _id: "70000000-0000-4000-8000-000000000a01",
    name: "API",
  }),
  record(Monitor, {
    _id: "70000000-0000-4000-8000-000000000a02",
    name: "Postgres primary",
  }),
];

// The project's postmortem templates, by name.
const ALL_TEMPLATES = [
  record(IncidentPostmortemTemplate, {
    _id: "80000000-0000-4000-8000-000000000b01",
    templateName: "Customer-facing outage",
    templateDescription: "Outages customers saw.",
    postmortemNote: "## What customers saw\n\n## Timeline\n\n## Follow-ups",
  }),
  record(IncidentPostmortemTemplate, {
    _id: "80000000-0000-4000-8000-000000000b02",
    templateName: "Database outage",
    templateDescription: "Database failures and failovers.",
    postmortemNote:
      "## Summary\n\n## Replication and failover\n\n## Data loss\n\n## Action items",
  }),
  record(IncidentPostmortemTemplate, {
    _id: "80000000-0000-4000-8000-000000000b03",
    templateName: "Security incident",
    templateDescription: "Anything that touched access or data.",
    postmortemNote: "## Summary\n\n## Exposure\n\n## Remediation",
  }),
  record(IncidentPostmortemTemplate, {
    _id: "80000000-0000-4000-8000-000000000b04",
    templateName: "Network partition between regions",
    templateDescription: "When regions could not reach each other.",
    postmortemNote: "## Summary\n\n## Regions affected\n\n## Action items",
  }),
  record(IncidentPostmortemTemplate, {
    _id: "80000000-0000-4000-8000-000000000b05",
    templateName: "Payments and checkout outage",
    templateDescription: "When customers could not pay.",
    postmortemNote: "## Summary\n\n## Orders lost\n\n## Action items",
  }),
];

const TEMPLATES = ALL_TEMPLATES.slice(0, templateCount);

function templatesNamed(names) {
  return ALL_TEMPLATES.filter((template) =>
    names.includes(template.templateName),
  ).filter((template) => TEMPLATES.includes(template));
}

// The project's postmortem rules, top of the list first.
const ALL_RULES = [
  record(AIPostmortemRule, {
    _id: "90000000-0000-4000-8000-000000000c01",
    projectId: new ObjectID(PROJECT_ID),
    name: "Draft with Database outage",
    isEnabled: true,
    order: 1,
    // The LLM provider it drafts with (?rulePick=): none by default.
    llmProviderId: RULE_PICK,
    criteria: {
      schemaVersion: 1,
      filterCondition: "All",
      filters: [
        {
          field: "labels",
          operator: "HasAnyOf",
          value: [LABELS[1]._id],
        },
      ],
    },
    postmortemTemplates: templatesNamed(["Database outage"]),
  }),
  record(AIPostmortemRule, {
    _id: "90000000-0000-4000-8000-000000000c02",
    projectId: new ObjectID(PROJECT_ID),
    name: "Draft with Customer-facing outage, Security incident",
    isEnabled: true,
    order: 2,
    criteria: {
      schemaVersion: 1,
      filterCondition: "All",
      filters: [
        {
          field: "incidentSeverities",
          operator: "HasAnyOf",
          value: [SEVERITIES[0]._id],
        },
      ],
    },
    postmortemTemplates: templatesNamed([
      "Customer-facing outage",
      "Security incident",
    ]),
  }),
  record(AIPostmortemRule, {
    _id: "90000000-0000-4000-8000-000000000c03",
    projectId: new ObjectID(PROJECT_ID),
    name: "Draft with the standard outline",
    isEnabled: true,
    order: 3,
    criteria: null,
    postmortemTemplates: [],
  }),
  // Turned off, named by hand, and with more templates than a row lists.
  record(AIPostmortemRule, {
    _id: "90000000-0000-4000-8000-000000000c04",
    projectId: new ObjectID(PROJECT_ID),
    name: "SEV1 and SEV2 incidents on the payments platform and the customer-facing API",
    isEnabled: false,
    order: 4,
    criteria: {
      schemaVersion: 1,
      filterCondition: "All",
      filters: [
        {
          field: "incidentSeverities",
          operator: "HasAnyOf",
          value: [SEVERITIES[0]._id, SEVERITIES[1]._id],
        },
        {
          field: "labels",
          operator: "HasAnyOf",
          value: [LABELS[0]._id],
        },
      ],
    },
    postmortemTemplates: templatesNamed([
      "Customer-facing outage",
      "Database outage",
      "Security incident",
      "Network partition between regions",
      "Payments and checkout outage",
    ]),
  }),
];

const TABLES = {
  Project: [project],
  AIPostmortemRule: ALL_RULES.slice(0, ruleCount),
  IncidentPostmortemTemplate: TEMPLATES,
  IncidentSeverity: SEVERITIES,
  Label: LABELS,
  Monitor: MONITORS,
  // The AI rules beside them: none.
  AutoRemediationRule: [],
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

function matchesQuery(item, query) {
  for (const [key, value] of Object.entries(query || {})) {
    if (typeof value === "boolean" && item[key] !== value) {
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

// A list's numbers after one row takes `value`, the way the server keeps them.
function reorder(table, id, value) {
  const item = table.find((candidate) => idOf(candidate._id) === idOf(id));

  if (!item) {
    return;
  }

  const changes = getListOrderCollisionChanges({
    siblings: table.map((row) => ({
      id: idOf(row._id),
      value: row.order,
      createdAt: row.createdAt,
    })),
    itemId: idOf(id),
    previousValue: item.order,
    requestedValue: value,
    sortOrder: SortOrder.Ascending,
  });

  for (const change of changes) {
    const row = table.find((candidate) => idOf(candidate._id) === change.id);
    if (row) {
      row.order = change.value;
    }
  }

  item.order = value;
}

ModelAPI.updateById = async (options) => {
  const name = tableName(options.modelType);
  const data = JSON.parse(JSON.stringify(options.data || {}));

  window.__fixture.updates.push({ model: name, id: idOf(options.id), data });

  if (failNextReorder && data.order !== undefined) {
    failNextReorder = false;
    throw new HTTPErrorResponse(
      500,
      { message: "The rules could not be reordered. Please try again." },
      {},
    );
  }

  const table = TABLES[name] || [];

  if (data.order !== undefined) {
    reorder(table, options.id, Number(data.order));
  } else {
    const item = table.find(
      (candidate) => idOf(candidate._id) === idOf(options.id),
    );
    if (item) {
      Object.assign(item, options.data || {});
    }
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
      name: json.name,
      description: json.description,
      isEnabled: json.isEnabled === false ? false : true,
      // The server puts a new rule at the end of the list.
      order:
        table.reduce((highest, row) => Math.max(highest, row.order || 0), 0) +
        1,
      criteria: json.criteria || null,
      postmortemTemplates: relationList(
        json.postmortemTemplates,
        IncidentPostmortemTemplate,
      ),
      llmProviderId: json.llmProviderId
        ? new ObjectID(idOf(json.llmProviderId))
        : undefined,
    });
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
    for (const [key, value] of Object.entries(json)) {
      if (key === "postmortemTemplates") {
        item.postmortemTemplates = relationList(
          value,
          IncidentPostmortemTemplate,
        );
      } else if (key === "llmProviderId") {
        item.llmProviderId = value ? new ObjectID(idOf(value)) : null;
      } else if (key !== "_id") {
        item[key] = value;
      }
    }
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

  const settings = (
    <IncidentAISettings
      pageRoute={Navigation.getCurrentRoute()}
      currentProject={project}
      hasPaymentMethod={true}
    />
  );

  /*
   * The Dashboard's frame: the page beside its side menu, which is what
   * leaves a card about 940px of a 1280px screen.
   */
  if (layout === "page") {
    return (
      <Page
        title="Incidents"
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
        {settings}
      </Page>
    );
  }

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-8 sm:px-8">
      <div className="mb-7 text-sm text-gray-500">
        Incidents / AI / Settings
      </div>
      {settings}
    </main>
  );
}

const target = `/dashboard/${PROJECT_ID}/incidents/ai/settings`;

if (window.location.pathname !== target) {
  window.history.replaceState(null, "", target + window.location.search);
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <PageRoute
        path="/dashboard/:projectId/incidents/ai/settings"
        element={<Shell />}
      />
    </Routes>
  </BrowserRouter>,
);

/*
 * Offline fixture for On-Call Duty > Policies (Pages/OnCallDuty/
 * OnCallDutyPolicies) and its Create On-Call Policy dialog, beside the
 * on-call side menu, as a new project meets them: a project's first policy
 * is asked "Page this policy for every new incident and alert", on to start
 * with (Common/Types/OnCallDutyPolicy/EveryNewEventRules). The layout, the
 * page, its list, the dialog and its switch are the production ones from
 * this branch; only the ModelAPI / API data boundary and the signed-in
 * user's permissions are replaced.
 *
 * The project: Ada Lovelace (signed in) and Grace Hopper, no on-call policy
 * and no on-call rule - a project made a minute ago.
 *
 * Steered by the query string:
 *   - policies=one    the project has a policy already ("Platform on-call"),
 *                     which pages the Platform team first, then Grace Hopper
 *   - rules=incident  no policy yet, but an incident on-call rule
 *   - counts=fail     the project's counts fail, as an API outage would
 *   - counts=hold     the counts wait for window.__fixture.releaseCounts()
 *   - role=member     a Project Member: may create a policy, not an on-call
 *                     rule
 *   - lang=de|fa      the Dashboard's German or Persian words (Persian reads
 *                     right to left)
 *   - theme=dark      dark mode (set before the bundle by server.js)
 *
 * Recorded on window.__fixture: every create (`creates`: the model as the
 * Dashboard serialises it, and the misc data the form sends beside it),
 * every count asked (`counts`, by table) and every read of a table this
 * fixture does not model (`unmodelled`; the spec fails on any).
 */
import "Common/UI/Styles/Theme.css";
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Outlet,
  Route as PageRoute,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import { initReactI18next } from "react-i18next";
import OnCallDutyLayout from "../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/Layout";
import OnCallDutyPolicies from "../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicies";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AlertOnCallRule from "Common/Models/DatabaseModels/AlertOnCallRule";
import IncidentOnCallRule from "Common/Models/DatabaseModels/IncidentOnCallRule";
import Label from "Common/Models/DatabaseModels/Label";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyCustomField from "Common/Models/DatabaseModels/OnCallDutyPolicyCustomField";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicyOwnerTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyOwnerTeam";
import OnCallDutyPolicyOwnerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyOwnerUser";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import TableView from "Common/Models/DatabaseModels/TableView";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import WorkspaceProjectAuthToken from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Includes from "Common/Types/BaseDatabase/Includes";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import { followLanguageForPage } from "Common/UI/Utils/PageLanguage";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";
import EN from "../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import { localeResources } from "../../SuiteHelpers/FixtureLocales";

const PROJECT_ID = "10000000-0000-4000-8000-0000000000f1";
const ADA_ID = "40000000-0000-4000-8000-0000000000f1";
const GRACE_ID = "40000000-0000-4000-8000-0000000000f2";
const NEW_POLICY_ID = "20000000-0000-4000-8000-0000000000f9";

const params = new URLSearchParams(window.location.search);
const language = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";
const countsMode = params.get("counts") || "";

let releaseCounts = () => {};
const countsReleased = new Promise((resolve) => {
  releaseCounts = resolve;
});

window.__fixture = {
  creates: [],
  counts: [],
  unmodelled: [],
  releaseCounts: () => {
    releaseCounts();
  },
};

// ---- who is signed in -------------------------------------------------------

/*
 * A Project Owner made the project; a Project Member may create on-call
 * policies (OnCallDutyPolicy's create permissions) but not on-call rules,
 * which only owners, admins and the rule permissions may.
 */
const HELD =
  params.get("role") === "member"
    ? [Permission.ProjectMember]
    : [Permission.ProjectOwner];

UserUtil.isMasterAdmin = () => false;
UserUtil.getUserId = () => new ObjectID(ADA_ID);
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

function tableName(modelType) {
  try {
    return String(new modelType().tableName);
  } catch {
    return "unknown";
  }
}

function record(ModelType, fields) {
  const item = new ModelType();
  item.createdAt = new Date("2026-10-27T09:00:00Z");
  item.updatedAt = new Date("2026-10-27T09:00:00Z");
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      item[key] = value;
    }
  }
  if (fields._id) {
    item.id = new ObjectID(fields._id);
  }
  return item;
}

function person(id, name, email) {
  return record(User, {
    _id: id,
    name: new Name(name),
    email: new Email(email),
  });
}

const ada = person(ADA_ID, "Ada Lovelace", "ada@acme.example");
const grace = person(GRACE_ID, "Grace Hopper", "grace@acme.example");

const hasPolicy = params.get("policies") === "one";
const PLATFORM_POLICY_ID = "20000000-0000-4000-8000-0000000000f1";
const PLATFORM_TEAM_RULE_ID = "60000000-0000-4000-8000-0000000000f1";
const PLATFORM_LEAD_RULE_ID = "60000000-0000-4000-8000-0000000000f2";

const policies = hasPolicy
  ? [
      record(OnCallDutyPolicy, {
        _id: PLATFORM_POLICY_ID,
        projectId: new ObjectID(PROJECT_ID),
        name: "Platform on-call",
        description: "Pages the platform team, then its lead.",
        isArchived: false,
        labels: [],
      }),
    ]
  : [];

/*
 * Platform on-call's escalation rules, which the list's Paged First column
 * reads (#9701): the Platform team first, then its lead, Grace Hopper.
 */
const escalationRules = hasPolicy
  ? [
      record(OnCallDutyPolicyEscalationRule, {
        _id: PLATFORM_TEAM_RULE_ID,
        projectId: new ObjectID(PROJECT_ID),
        onCallDutyPolicyId: new ObjectID(PLATFORM_POLICY_ID),
        name: "Platform team",
        order: 1,
      }),
      record(OnCallDutyPolicyEscalationRule, {
        _id: PLATFORM_LEAD_RULE_ID,
        projectId: new ObjectID(PROJECT_ID),
        onCallDutyPolicyId: new ObjectID(PLATFORM_POLICY_ID),
        name: "Platform lead",
        order: 2,
      }),
    ]
  : [];

const escalationRuleTeams = hasPolicy
  ? [
      record(OnCallDutyPolicyEscalationRuleTeam, {
        _id: "61000000-0000-4000-8000-0000000000f1",
        projectId: new ObjectID(PROJECT_ID),
        onCallDutyPolicyEscalationRuleId: new ObjectID(PLATFORM_TEAM_RULE_ID),
        team: record(Team, {
          _id: "70000000-0000-4000-8000-0000000000f1",
          name: "Platform",
        }),
      }),
    ]
  : [];

const escalationRuleUsers = hasPolicy
  ? [
      record(OnCallDutyPolicyEscalationRuleUser, {
        _id: "62000000-0000-4000-8000-0000000000f1",
        projectId: new ObjectID(PROJECT_ID),
        onCallDutyPolicyEscalationRuleId: new ObjectID(PLATFORM_LEAD_RULE_ID),
        user: grace,
      }),
    ]
  : [];

const incidentRules =
  params.get("rules") === "incident"
    ? [
        record(IncidentOnCallRule, {
          _id: "30000000-0000-4000-8000-0000000000f1",
          projectId: new ObjectID(PROJECT_ID),
          name: "Critical incidents",
          isEnabled: true,
        }),
      ]
    : [];

/*
 * Every table the page reads, registered up front: a read of anything else
 * is recorded as unmodelled and fails the spec.
 */
const TABLES = {
  [tableName(OnCallDutyPolicy)]: policies,
  [tableName(IncidentOnCallRule)]: incidentRules,
  [tableName(AlertOnCallRule)]: [],
  [tableName(OnCallDutyPolicyCustomField)]: [],
  [tableName(OnCallDutyPolicyEscalationRule)]: escalationRules,
  [tableName(OnCallDutyPolicyEscalationRuleTeam)]: escalationRuleTeams,
  [tableName(OnCallDutyPolicyEscalationRuleUser)]: escalationRuleUsers,
  [tableName(OnCallDutyPolicyEscalationRuleSchedule)]: [],
  [tableName(OnCallDutyPolicyOwnerUser)]: [],
  [tableName(OnCallDutyPolicyOwnerTeam)]: [],
  [tableName(OnCallDutyPolicySchedule)]: [],
  [tableName(Label)]: [],
  [tableName(TableView)]: [],
  [tableName(Team)]: [],
  [tableName(WorkspaceProjectAuthToken)]: [],
  [tableName(TeamMember)]: [
    record(TeamMember, {
      _id: "50000000-0000-4000-8000-0000000000f1",
      projectId: new ObjectID(PROJECT_ID),
      userId: new ObjectID(ADA_ID),
      user: ada,
      hasAcceptedInvitation: true,
    }),
    record(TeamMember, {
      _id: "50000000-0000-4000-8000-0000000000f2",
      projectId: new ObjectID(PROJECT_ID),
      userId: new ObjectID(GRACE_ID),
      user: grace,
      hasAcceptedInvitation: true,
    }),
  ],
};

// The three counts that decide whether the switch is offered.
const OFFER_COUNTS = [
  tableName(OnCallDutyPolicy),
  tableName(IncidentOnCallRule),
  tableName(AlertOnCallRule),
];

function rowsOf(modelType, verb) {
  const name = tableName(modelType);

  if (!(name in TABLES)) {
    window.__fixture.unmodelled.push(`${verb} ${name}`);
    return [];
  }

  return TABLES[name];
}

// A record as a fresh read gives it: never the instance the page drew before.
function copyOf(item, modelType) {
  return BaseModel.fromJSONObject(BaseModel.toJSON(item, modelType), modelType);
}

/*
 * Whether a row is one a read asked for by ids (Includes): the escalation
 * rules of the list's policies, the people and teams of their first rules.
 */
function isAskedFor(item, query) {
  return Object.entries(query || {}).every(([column, value]) => {
    if (!(value instanceof Includes)) {
      return true;
    }

    const ids = value.values.map((id) => {
      return String(id).toLowerCase();
    });

    return ids.includes(String(item[column]).toLowerCase());
  });
}

ModelAPI.getList = async (options) => {
  const modelType = options.modelType;
  const items = rowsOf(modelType, "getList")
    .filter((item) => {
      return isAskedFor(item, options.query);
    })
    .map((item) => {
      return copyOf(item, modelType);
    });
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
  const name = tableName(options.modelType);

  window.__fixture.counts.push(name);

  if (OFFER_COUNTS.includes(name)) {
    if (countsMode === "hold") {
      await countsReleased;
    }

    if (countsMode === "fail") {
      throw new HTTPErrorResponse(
        500,
        { message: "Something went wrong. Please try again." },
        {},
      );
    }
  }

  return rowsOf(options.modelType, "count").length;
};
ModelAPI.getCount = ModelAPI.count;

ModelAPI.getItem = async (options) => {
  const item = rowsOf(options.modelType, "getItem").find((candidate) => {
    return (
      String(candidate._id).toLowerCase() === String(options.id).toLowerCase()
    );
  });
  return item ? copyOf(item, options.modelType) : null;
};

// A create, recorded as sent: the model and the misc data beside it.
ModelAPI.createOrUpdate = async (options) => {
  const name = tableName(options.modelType);
  const json = BaseModel.toJSON(options.model, options.modelType);

  window.__fixture.creates.push({
    model: name,
    data: json,
    misc: JSON.parse(JSON.stringify(options.miscDataProps || {})),
  });

  return new HTTPResponse(200, { ...json, _id: NEW_POLICY_ID }, {});
};

API.get = async () => {
  return new HTTPResponse(200, {}, {});
};
API.post = async () => {
  return new HTTPResponse(200, {}, {});
};

/*
 * The Dashboard looks every string up by its English text, so the
 * separators i18next reads in a key (the "." and ":" of a sentence) are
 * turned off, as the Dashboard's own setup does. <html lang> and <html dir>
 * follow the language through the production helper.
 */
followLanguageForPage(i18next);

/*
 * English, the fallback, is in the bundle; German and Persian are each a
 * chunk of its own, loaded only by a page drawn in that language, as the
 * Dashboard loads a locale (src/Utils/I18nLocaleLoader.ts), and built as the
 * Dashboard ships them (server.js, SuiteHelpers/FixtureLocalesBuild.js).
 * Imported whole, they were parsed on every page load of every test (#8366).
 */
const LOCALE_LOADERS = {
  de: () => {
    return import("../../../App/FeatureSet/Dashboard/src/Locales/de.json");
  },
  fa: () => {
    return import("../../../App/FeatureSet/Dashboard/src/Locales/fa.json");
  },
};

await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: "en",
  resources: await localeResources({
    language: language,
    english: EN,
    loaders: LOCALE_LOADERS,
  }),
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
// Dates in the reader's language ("vor 2 Stunden"), as Utils/i18n.ts sets them.
followLanguageForDates(i18next);

function Shell() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return <Outlet />;
}

const pageProps = {
  pageRoute: undefined,
  currentProject: null,
  hasPaymentMethod: true,
};

// Where a new policy opens: its Escalation Rules (the page itself is not here).
function PolicyEscalationRules() {
  const parameters = useParams();

  return (
    <div data-testid="new-policy-escalation-rules">{parameters.modelId}</div>
  );
}

/*
 * Where "Guided setup" leads (#7148): the on-call guided setup (the page
 * itself is not here; Journeys/OnCallSetup draws it).
 */
function OnCallGuidedSetupOpened() {
  return <div data-testid="on-call-guided-setup-opened" />;
}

const target = `/dashboard/${PROJECT_ID}/on-call-duty/policies`;

if (!window.location.pathname.startsWith(target)) {
  window.history.replaceState(null, "", target + window.location.search);
}

/*
 * Navigates as the Dashboard does (its src/Index.tsx): each navigation renders
 * at once, not in a React transition (Tests/Ops/E2EFixtureRouters).
 */
createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <Routes>
      <PageRoute element={<Shell />}>
        <PageRoute
          element={
            <OnCallDutyLayout
              {...pageProps}
              pageRoute={Navigation.getCurrentRoute()}
            />
          }
        >
          <PageRoute
            path="/dashboard/:projectId/on-call-duty/policies"
            element={
              <OnCallDutyPolicies
                {...pageProps}
                pageRoute={Navigation.getCurrentRoute()}
              />
            }
          />
        </PageRoute>
        <PageRoute
          path="/dashboard/:projectId/on-call-duty/policies/:modelId/escalation"
          element={<PolicyEscalationRules />}
        />
        <PageRoute
          path="/dashboard/:projectId/on-call-duty/setup"
          element={<OnCallGuidedSetupOpened />}
        />
      </PageRoute>
    </Routes>
  </BrowserRouter>,
);

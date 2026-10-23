/*
 * Offline fixture for an on-call policy's Escalation Rules page
 * (Pages/OnCallDuty/OnCallDutyPolicy/Escalation), in the policy's own side
 * menu: its levels, the Repeat Policy card, and - folded under More settings
 * - the Acknowledgement Timeout card (issue #5123) with the dialog that
 * changes it. The page, the fold, the cards and the dialog are the
 * production ones from this branch; only the ModelAPI / API data boundary
 * and the signed-in user's permissions are replaced.
 *
 * Steered by the query string:
 *   - timeout=<n>   the policy pages again after n minutes; absent, it does
 *                   not page again (what every policy starts with)
 *   - fail=save     the next save is refused, as a server would
 *   - lang=de       the Dashboard's German words
 *   - theme=dark    dark mode (set before the bundle by server.js)
 *
 * What the page saves is recorded on window.__fixture.saves (the policy as
 * the Dashboard serialises it for the API), so the spec checks what was
 * sent, not only what was drawn. A save changes the policy the page reads
 * next, as the server would.
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
import Escalation from "../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicy/Escalation";
import PolicySideMenu from "../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicy/SideMenu";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleUser from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import User from "Common/Models/DatabaseModels/User";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";
import Page from "Common/UI/Components/Page/Page";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";

const PROJECT_ID = "10000000-0000-4000-8000-0000000000d1";
const POLICY_ID = "20000000-0000-4000-8000-0000000000d1";
const RULE_ID = "30000000-0000-4000-8000-0000000000d1";
const USER_ID = "40000000-0000-4000-8000-0000000000d1";

const params = new URLSearchParams(window.location.search);
const timeout = params.get("timeout");
const language = params.get("lang") === "de" ? "de" : "en";
let failNextSave = params.get("fail") === "save";

window.__fixture = {
  saves: [],
};

// ---- who is signed in -------------------------------------------------------

const HELD = [Permission.ProjectOwner];

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

const policy = record(OnCallDutyPolicy, {
  _id: POLICY_ID,
  projectId: new ObjectID(PROJECT_ID),
  name: "Payments primary",
  repeatPolicyIfNoOneAcknowledges: false,
  repeatPolicyIfNoOneAcknowledgesNoOfTimes: 0,
  acknowledgementTimeoutInMinutes: timeout === null ? null : Number(timeout),
});

const dana = record(User, {
  _id: USER_ID,
  name: new Name("Dana Kim"),
  email: new Email("dana@example.com"),
});

const TABLES = {
  [tableName(OnCallDutyPolicy)]: [policy],
  [tableName(OnCallDutyEscalationRule)]: [
    record(OnCallDutyEscalationRule, {
      _id: RULE_ID,
      projectId: new ObjectID(PROJECT_ID),
      onCallDutyPolicyId: new ObjectID(POLICY_ID),
      name: "Level 1",
      escalateAfterInMinutes: 30,
      order: 1,
    }),
  ],
  [tableName(OnCallDutyPolicyEscalationRuleUser)]: [
    record(OnCallDutyPolicyEscalationRuleUser, {
      _id: "50000000-0000-4000-8000-0000000000d1",
      projectId: new ObjectID(PROJECT_ID),
      onCallDutyPolicyId: new ObjectID(POLICY_ID),
      onCallDutyPolicyEscalationRuleId: new ObjectID(RULE_ID),
      userId: new ObjectID(USER_ID),
      user: dana,
    }),
  ],
};

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

// A record as a fresh read gives it: never the instance the page drew before.
function copyOf(item, modelType) {
  return BaseModel.fromJSONObject(BaseModel.toJSON(item, modelType), modelType);
}

ModelAPI.getList = async (options) => {
  const modelType = options.modelType;
  const items = (TABLES[tableName(modelType)] || []).map((item) =>
    copyOf(item, modelType),
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
  return (TABLES[tableName(options.modelType)] || []).length;
};
ModelAPI.getCount = ModelAPI.count;

ModelAPI.getItem = async (options) => {
  const table = TABLES[tableName(options.modelType)] || [];
  const item = table.find((candidate) => {
    return idOf(candidate._id) === idOf(options.id);
  });
  return item ? copyOf(item, options.modelType) : null;
};

// An edit through a card's dialog: recorded as sent, and kept.
ModelAPI.createOrUpdate = async (options) => {
  const name = tableName(options.modelType);
  // What the API is sent: the model as the Dashboard serialises it.
  const json = BaseModel.toJSON(options.model, options.modelType);

  window.__fixture.saves.push({ model: name, data: json });

  if (failNextSave) {
    failNextSave = false;
    throw new HTTPErrorResponse(
      500,
      { message: "The policy could not be saved. Please try again." },
      {},
    );
  }

  const item = (TABLES[name] || []).find((candidate) => {
    return idOf(candidate._id) === idOf(options.model._id);
  });

  if (item) {
    for (const [key, value] of Object.entries(json)) {
      if (key !== "_id") {
        item[key] = value;
      }
    }
  }

  return new HTTPResponse(200, json, {});
};

ModelAPI.updateById = async () => {
  return new HTTPResponse(200, {}, {});
};

API.get = async () => new HTTPResponse(200, {}, {});
API.post = async () => new HTTPResponse(200, {}, {});

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

  // The policy's pages as the Dashboard frames them: beside its side menu.
  return (
    <Page
      title="Payments primary"
      breadcrumbLinks={[]}
      sideMenu={<PolicySideMenu modelId={new ObjectID(POLICY_ID)} />}
    >
      <Escalation
        pageRoute={Navigation.getCurrentRoute()}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </Page>
  );
}

const target = `/dashboard/${PROJECT_ID}/on-call-duty/policies/${POLICY_ID}/escalation`;

if (window.location.pathname !== target) {
  window.history.replaceState(null, "", target + window.location.search);
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <PageRoute
        path="/dashboard/:projectId/on-call-duty/policies/:modelId/escalation"
        element={<Shell />}
      />
    </Routes>
  </BrowserRouter>,
);

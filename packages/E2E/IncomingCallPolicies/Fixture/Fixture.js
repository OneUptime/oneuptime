/*
 * Offline fixture for the real Incoming Call Policies page.
 *
 * Only the ModelAPI/API data boundary and the synthetic user's permission
 * snapshot are replaced. The page, its ModelTable, the owner/facet filter bar,
 * the create form and the phone number cell are the production ones from this
 * branch.
 *
 * The phone number request can be steered with `?phoneNumbers=`:
 *   - (absent) answer immediately
 *   - hold     wait until `window.__fixture.releasePhoneNumbers()` is called
 *   - fail     reject, the way an API outage would
 *
 * Every list request and every create is recorded on `window.__fixture` so the
 * spec can assert what the page actually asked for, not just what it drew.
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
import IncomingCallPolicies from "../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/IncomingCallPolicies";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyPhoneNumber from "Common/Models/DatabaseModels/IncomingCallPolicyPhoneNumber";
import Label from "Common/Models/DatabaseModels/Label";
import Color from "Common/Types/Color";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import Permission from "Common/Types/Permission";
import Includes from "Common/Types/BaseDatabase/Includes";
import MultiSearch from "Common/Types/BaseDatabase/MultiSearch";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import Search from "Common/Types/BaseDatabase/Search";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import User from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const mode = new URLSearchParams(window.location.search).get("phoneNumbers");

function label(id, name, color) {
  const record = new Label();
  record._id = id;
  record.name = name;
  record.color = new Color(color);
  return record;
}

const labels = [
  label("20000000-0000-4000-8000-000000000001", "Production", "#16a34a"),
  label("20000000-0000-4000-8000-000000000002", "Finance", "#2563eb"),
];

function policy(data) {
  const record = new IncomingCallPolicy();
  record._id = data.id;
  record.projectId = new ObjectID(PROJECT_ID);
  record.name = data.name;
  record.description = data.description;
  record.isEnabled = data.isEnabled;
  record.labels = data.labels || [];
  if (data.routingPhoneNumber) {
    record.routingPhoneNumber = new Phone(data.routingPhoneNumber);
  }
  return record;
}

/*
 * One policy per shape the Phone Numbers cell can take:
 *   - several attached numbers  -> first number plus "+N more"
 *   - legacy scalar number only -> that number, never "Setup Needed"
 *   - legacy number that was already copied into the attachment table
 *                               -> shown once, not double counted
 *   - no number at all          -> "Setup Needed"
 */
const policies = [
  policy({
    id: "30000000-0000-4000-8000-000000000001",
    name: "Production Support Hotline",
    description: "Routes customer calls to the platform on-call rotation",
    isEnabled: true,
    labels: [labels[0]],
  }),
  policy({
    id: "30000000-0000-4000-8000-000000000002",
    name: "Billing Escalations",
    description: "After-hours payment failures",
    isEnabled: false,
    labels: [labels[1]],
    routingPhoneNumber: "+14155550199",
  }),
  policy({
    id: "30000000-0000-4000-8000-000000000003",
    name: "EU Night Desk",
    description: "London overnight coverage",
    isEnabled: true,
    routingPhoneNumber: "+442071234567",
  }),
  policy({
    id: "30000000-0000-4000-8000-000000000004",
    name: "Sandbox Line",
    description: "Not wired to a provider yet",
    isEnabled: false,
  }),
];

function attachedNumber(id, policyId, phoneNumber, purchasedAt) {
  const record = new IncomingCallPolicyPhoneNumber();
  record._id = id;
  record.projectId = new ObjectID(PROJECT_ID);
  record.incomingCallPolicyId = new ObjectID(policyId);
  record.phoneNumber = new Phone(phoneNumber);
  record.phoneNumberPurchasedAt = new Date(purchasedAt);
  return record;
}

const phoneNumbers = [
  attachedNumber(
    "40000000-0000-4000-8000-000000000001",
    policies[0]._id,
    "+14155550101",
    "2026-01-01T00:00:00.000Z",
  ),
  attachedNumber(
    "40000000-0000-4000-8000-000000000002",
    policies[0]._id,
    "+14155550102",
    "2026-02-01T00:00:00.000Z",
  ),
  attachedNumber(
    "40000000-0000-4000-8000-000000000003",
    policies[0]._id,
    "+14155550103",
    "2026-03-01T00:00:00.000Z",
  ),
  attachedNumber(
    "40000000-0000-4000-8000-000000000004",
    policies[2]._id,
    "+442071234567",
    "2026-01-15T00:00:00.000Z",
  ),
];

let releasePhoneNumbers = () => {};
const phoneNumbersReleased = new Promise((resolve) => {
  releasePhoneNumbers = resolve;
});

function serialize(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

window.__fixture = {
  listRequests: [],
  created: [],
  releasePhoneNumbers: () => releasePhoneNumbers(),
};

function matchesQuery(record, query) {
  for (const [key, condition] of Object.entries(query || {})) {
    if (condition === undefined || condition === null || key === "projectId") {
      continue;
    }
    if (condition instanceof MultiSearch) {
      const needle = condition.value.toLowerCase();
      const hit = condition.fields.some((field) =>
        String(record[field] || "")
          .toLowerCase()
          .includes(needle),
      );
      if (!hit) {
        return false;
      }
      continue;
    }
    if (condition instanceof Search) {
      if (
        !String(record[key] || "")
          .toLowerCase()
          .includes(String(condition.value).toLowerCase())
      ) {
        return false;
      }
      continue;
    }
    if (condition instanceof NotEqual) {
      if (String(record[key]) === String(condition.value)) {
        return false;
      }
      continue;
    }
    if (condition instanceof Includes) {
      const wanted = condition.values.map((value) => value.toString());
      const actual = Array.isArray(record[key])
        ? record[key].map((item) => item._id || item.toString())
        : [record[key] && record[key].toString()];
      if (!actual.some((value) => wanted.includes(value))) {
        return false;
      }
      continue;
    }
    if (typeof condition === "boolean") {
      if (Boolean(record[key]) !== condition) {
        return false;
      }
      continue;
    }
  }
  return true;
}

User.isMasterAdmin = () => true;
User.getUserId = () => new ObjectID("80000000-0000-4000-8000-000000000001");
PermissionUtil.getAllPermissions = () => [Permission.ProjectOwner];
ProjectUtil.getCurrentProjectId = () => new ObjectID(PROJECT_ID);
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

ModelAPI.getItem = async () => null;

ModelAPI.getList = async (options) => {
  const tableName = new options.modelType().tableName;
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 50);
  window.__fixture.listRequests.push({
    tableName,
    query: serialize(options.query),
    skip,
    limit,
  });

  let items = [];
  if (tableName === "IncomingCallPolicy") {
    items = policies.filter((record) => matchesQuery(record, options.query));
  } else if (tableName === "IncomingCallPolicyPhoneNumber") {
    if (mode === "hold") {
      await phoneNumbersReleased;
    }
    if (mode === "fail") {
      throw new Error("Phone number service is unreachable");
    }
    items = phoneNumbers.filter((record) =>
      matchesQuery(record, {
        incomingCallPolicyId: options.query.incomingCallPolicyId,
      }),
    );
  } else if (tableName === "Label") {
    items = labels;
  }

  return {
    data: items.slice(skip, skip + limit),
    count: items.length,
    skip,
    limit,
  };
};

ModelAPI.getCount = async (options) => {
  const tableName = new options.modelType().tableName;
  return tableName === "IncomingCallPolicy"
    ? policies.filter((record) => matchesQuery(record, options.query)).length
    : 0;
};

ModelAPI.createOrUpdate = async (options) => {
  const model = options.model;
  const tableName = new options.modelType().tableName;
  if (tableName === "IncomingCallPolicy") {
    model._id = `30000000-0000-4000-8000-${String(policies.length + 1).padStart(12, "0")}`;
    model.projectId = new ObjectID(PROJECT_ID);
    model.isEnabled = true;
    policies.push(model);
    window.__fixture.created.push({
      name: model.name,
      description: model.description || null,
    });
  }
  return { data: model, miscData: {} };
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
    <main className="mx-auto max-w-[1500px] px-8 py-8">
      <div className="mb-7 text-sm text-gray-500">
        On-Call Duty <span className="mx-2">/</span> Incoming Call Policies
      </div>
      <IncomingCallPolicies
        pageRoute={Navigation.getCurrentRoute()}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Fixture />
  </BrowserRouter>,
);

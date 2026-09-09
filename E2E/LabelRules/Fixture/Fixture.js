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
import NetworkDeviceLabelRulesPage from "../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Settings/LabelRules";
import MonitorLabelRulesPage from "../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorLabelRules";
import Label from "Common/Models/DatabaseModels/Label";
import NetworkDeviceLabelRule from "Common/Models/DatabaseModels/NetworkDeviceLabelRule";
import MonitorLabelRule from "Common/Models/DatabaseModels/MonitorLabelRule";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import User from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";

// Only data access and the synthetic user's permission snapshot are replaced.
// The routed production pages, table, import workflow, and transfer utilities
// are rendered without component mocks.
const params = new URLSearchParams(window.location.search);
const projectId = window.location.pathname.split("/")[2];
const destination = projectId.endsWith("2");
const records = [];
const writes = [];
const requests = [];
const labels = ["Production", "Network", "Critical"].map((name, index) => {
  const label = new Label();
  label._id = `10000000-0000-4000-8000-${String((destination ? 200 : 100) + index).padStart(12, "0")}`;
  label.name = name;
  return label;
});
const modelType = window.location.pathname.includes("/monitors/")
  ? MonitorLabelRule
  : NetworkDeviceLabelRule;
const seedCount = Number(params.get("count") || "3");
for (let index = 0; index < seedCount; index++) {
  const model = new modelType();
  model._id = `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
  model.name =
    [
      "Production core switches",
      "Edge router labels",
      "Critical network devices",
    ][index] || `Network label rule ${String(index + 1).padStart(3, "0")}`;
  model.description =
    "Attach the Network label to matching production resources.";
  model.isEnabled = index !== 1;
  const prefix = modelType === MonitorLabelRule ? "monitor" : "networkDevice";
  model.setValue(`${prefix}NamePattern`, "^core-");
  model.setValue(`${prefix}DescriptionPattern`, "production");
  model.setValue(`${prefix}Labels`, [labels[0]]);
  model.labelsToAdd = [labels[1]];
  records.push(model);
}
User.isMasterAdmin = () => params.get("role") !== "viewer";
User.getUserId = () => new ObjectID("30000000-0000-4000-8000-000000000001");
PermissionUtil.getAllPermissions = () =>
  params.get("role") === "viewer"
    ? [Permission.Viewer]
    : [Permission.ProjectOwner];
ProjectUtil.getCurrentProjectId = () => new ObjectID(projectId);
ModelAPI.getCommonHeaders = () => ({ tenantid: projectId });
ModelAPI.getList = async (options) => {
  const tableName = new options.modelType().tableName;
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 50);
  requests.push({
    operation: "list",
    tableName,
    skip,
    limit,
    tenantid: options.requestOptions?.requestHeaders?.tenantid,
  });
  let items =
    tableName === "Label"
      ? params.get("missingLabels")
        ? []
        : labels
      : options.modelType === modelType
        ? records
        : [];
  if (options.query?.name && typeof options.query.name === "string") {
    items = items.filter((item) => item.name.includes(options.query.name));
  }
  return {
    data: items.slice(skip, skip + limit),
    count: items.length,
    skip,
    limit,
  };
};
ModelAPI.getItem = async () => null;
ModelAPI.getCount = async () => records.length;
ModelAPI.create = async (options) => {
  const model = options.model;
  requests.push({
    operation: "create",
    name: model.name,
    tenantid: options.requestOptions?.requestHeaders?.tenantid,
  });
  if (model.name.includes("Fail this rule")) {
    throw new Error(
      "A temporary error prevented this rule from being created.",
    );
  }
  model._id = `40000000-0000-4000-8000-${String(writes.length + 1).padStart(12, "0")}`;
  records.push(model);
  writes.push({
    name: model.name,
    isEnabled: model.isEnabled,
    projectId: model.projectId?.toString(),
    labelsToAdd: model.labelsToAdd?.map((item) => item._id),
    monitorNamePattern: model.monitorNamePattern,
    networkDeviceNamePattern: model.networkDeviceNamePattern,
  });
  return model;
};
API.get = async () => ({ data: { data: [], count: 0 } });
API.post = async () => ({ data: { data: [], count: 0 } });
window.__labelRuleFixture = {
  writes,
  requests,
  projectId,
  labelIds: labels.map((label) => label._id),
};
await i18next
  .use(initReactI18next)
  .init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
  });
function Fixture() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  const isMonitor = modelType === MonitorLabelRule;
  return (
    <>
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-8 py-5">
        <div className="flex items-center gap-5">
          <span className="text-lg font-semibold text-gray-900">OneUptime</span>
          <span className="text-sm text-gray-500">
            {destination ? "Production Europe" : "Network Operations"}
          </span>
        </div>
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
          Demo workspace · Synthetic data
        </span>
      </header>
      <main className="mx-auto max-w-screen-2xl px-8 py-8">
        <div className="mb-7 text-sm text-gray-500">
          {isMonitor ? "Monitors" : "Network Devices"}{" "}
          <span className="mx-2">/</span> Settings{" "}
          <span className="mx-2">/</span> Label Rules
        </div>
        {isMonitor ? (
          <MonitorLabelRulesPage />
        ) : (
          <NetworkDeviceLabelRulesPage />
        )}
      </main>
    </>
  );
}
createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Fixture />
  </BrowserRouter>,
);

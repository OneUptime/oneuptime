/*
 * Offline fixture for the real Google SecOps Connections page.
 *
 * The page component, ModelTable and create form all come from production.
 * Only the ModelAPI/API boundary and a synthetic project/permission snapshot
 * are replaced, so this can never reach a developer stack or Google.
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
import GoogleSecOpsConnectionsPage from "../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/GoogleSecOpsConnections";
import Project from "Common/Models/DatabaseModels/Project";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import User from "Common/UI/Utils/User";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";

const project = new Project();
project._id = PROJECT_ID;
project.name = "Synthetic Security Workspace";

window.__fixture = { createAttempts: 0 };

User.isMasterAdmin = () => true;
User.getUserId = () => new ObjectID("20000000-0000-4000-8000-000000000001");
PermissionUtil.getAllPermissions = () => [Permission.ProjectOwner];
ProjectUtil.getCurrentProjectId = () => new ObjectID(PROJECT_ID);
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

ModelAPI.getItem = async () => null;
ModelAPI.getList = async (options) => ({
  data: [],
  count: 0,
  skip: Number(options.skip || 0),
  limit: Number(options.limit || 50),
});
ModelAPI.getCount = async () => 0;
ModelAPI.create = async (options) => {
  window.__fixture.createAttempts += 1;
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
          <span className="text-sm text-gray-500">
            Synthetic Security Workspace
          </span>
        </div>
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
          Offline fixture · No credentials
        </span>
      </header>
      <main className="mx-auto max-w-[1820px] px-8 py-8">
        <div className="mb-7 text-sm text-gray-500">
          Security Events <span className="mx-2">/</span> Connections
        </div>
        <GoogleSecOpsConnectionsPage
          pageRoute={new Route("/security-events/connections")}
          currentProject={project}
          hasPaymentMethod={true}
        />
      </main>
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Fixture />
  </BrowserRouter>,
);

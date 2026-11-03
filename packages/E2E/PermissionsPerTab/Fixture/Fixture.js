/*
 * Offline fixture for two projects open in two tabs (#5306's follow-up):
 * the Dashboard's real Settings > Labels page (Pages/Settings/Labels.tsx)
 * and Settings > Danger Zone page (Pages/Settings/DangerZone.tsx), for the
 * project the tab's address names.
 *
 * Nothing between the pages and the wire is replaced: their requests go
 * through the Dashboard's own ModelAPI and API client to the fixture server
 * as JSON, the tenantid header names the project the tab shows (ProjectUtil),
 * the permission snapshots the answers carry are kept where the Dashboard
 * keeps them (Common/UI/Utils/Permission), and every Create, Edit, Delete
 * and Delete Project button asks PermissionGate, as in the product. The
 * server answers as OneUptime's API does (server.js).
 *
 * Each tab picks its project as the Dashboard's App.tsx does once the
 * project list has loaded (ProjectUtil.setCurrentProject), and a link at
 * the top moves between the two pages inside the app, as the Settings side
 * menu does.
 */
import "Common/UI/Styles/Theme.css";
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  Route as RouterRoute,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import LabelsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Settings/Labels";
import DangerZonePage from "../../../App/FeatureSet/Dashboard/src/Pages/Settings/DangerZone";
import Project from "Common/Models/DatabaseModels/Project";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { PERSON, projectOf } from "./Projects.js";

// Who is signed in, as the sign-in leaves it: no master admin.
window.localStorage.setItem("user_id", PERSON.id);
window.localStorage.setItem("user_name", PERSON.name);

/*
 * The Dashboard looks every string up by its English text, so the separators
 * i18next reads in a key (the "." and ":" of a sentence) are turned off, as
 * the Dashboard's own setup does.
 */
await i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});

// The project the tab shows, picked as App.tsx picks it.
function useTabProject() {
  const { projectId } = useParams();
  const known = projectOf(projectId);

  if (!known) {
    return null;
  }

  const project = new Project();
  project._id = known.id;
  project.name = known.name;

  // Before the page draws, so its requests name the tab's project.
  ProjectUtil.setCurrentProject(project);

  return project;
}

function SettingsPage(props) {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  const project = useTabProject();

  if (!project) {
    return (
      <p data-testid="unknown-project">Not one of the fixture's projects.</p>
    );
  }

  const base = `/dashboard/${project._id}/settings`;
  const Page = props.page;

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-8 sm:px-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1
          className="text-lg font-semibold text-gray-900"
          data-testid="tab-project"
        >
          {project.name}
        </h1>
        <nav className="flex gap-4 text-sm">
          <Link data-testid="go-labels" to={`${base}/labels`}>
            Labels
          </Link>
          <Link data-testid="go-danger-zone" to={`${base}/danger-zone`}>
            Danger Zone
          </Link>
        </nav>
      </header>
      <Page
        pageRoute={new Route(Navigation.getCurrentPath().toString())}
        currentProject={project}
        hasPaymentMethod={true}
        onProjectDeleted={() => {}}
      />
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <Routes>
      <RouterRoute
        path="/dashboard/:projectId/settings/labels"
        element={<SettingsPage page={LabelsPage} />}
      />
      <RouterRoute
        path="/dashboard/:projectId/settings/danger-zone"
        element={<SettingsPage page={DangerZonePage} />}
      />
    </Routes>
  </BrowserRouter>,
);

import React, { useState } from "react";
import Project from "Common/Models/DatabaseModels/Project";
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ObjectID from "Common/Types/ObjectID";
import TopSection from "Common/UI/Components/TopSection/TopSection";
import API from "Common/UI/Utils/API/API";
import GlobalConfigUtil from "Common/UI/Utils/GlobalConfig";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import Realtime from "Common/UI/Utils/Realtime";
import UserUtil from "Common/UI/Utils/User";
import DashboardHeader from "../../App/FeatureSet/Dashboard/src/Components/Header/Header";
import HowOneUptimeWorksDialog from "../../App/FeatureSet/Dashboard/src/Components/Home/HowOneUptimeWorksDialog";
import DashboardNavbar from "../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar";
import EventName from "../../App/FeatureSet/Dashboard/src/Utils/EventName";

/*
 * ?header=true: the top of every Dashboard page - the production header
 * (Components/Header/Header) and nav bar (Components/NavBar/NavBar), stacked
 * in Common's TopSection as the Dashboard's MasterPage stacks them - in a
 * project named "Acme Commerce Production" with 2 active incidents and 3
 * active alerts. The page's reading language is ?lang= (en, de or ar: the
 * Arabic page reads right to left) and ?theme=dark draws it dark, with the
 * Dashboard's own fonts, tailwind.config and Theme.css (server.js).
 *
 * The header's reads are answered here, with nothing sent: the counts, the
 * current on-call lookup, the global config and the live updates. What its
 * buttons open is counted on window.__headerFixture (Search, Ask AI and the
 * keyboard shortcuts open dialogs this page does not mount); Help's How
 * OneUptime works opens the production dialog, as App.tsx mounts it.
 */

export const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
export const PROJECT_NAME = "Acme Commerce Production";

const query = new URLSearchParams(window.location.search);

export const isHeaderMode = query.get("header") === "true";

// The languages the header is drawn in here: one long, one right to left.
const HEADER_LANGUAGES = ["en", "de", "ar"];

export const headerLanguage =
  isHeaderMode && HEADER_LANGUAGES.includes(query.get("lang"))
    ? query.get("lang")
    : "en";

function makeProject() {
  const project = new Project();
  project.id = new ObjectID(PROJECT_ID);
  project.name = PROJECT_NAME;
  return project;
}

// Replaces the header's reads with answers made here. Header mode only.
export function installHeaderFixture() {
  const counted = {
    paletteToggles: 0,
    askAiToggles: 0,
    keyboardShortcutsToggles: 0,
    requests: [],
  };
  window.__headerFixture = counted;

  GlobalEvents.addEventListener(EventName.COMMAND_PALETTE_TOGGLE, () => {
    counted.paletteToggles += 1;
  });
  GlobalEvents.addEventListener(EventName.AI_CHAT_TOGGLE, () => {
    counted.askAiToggles += 1;
  });
  GlobalEvents.addEventListener(EventName.KEYBOARD_SHORTCUTS_TOGGLE, () => {
    counted.keyboardShortcutsToggles += 1;
  });

  const project = makeProject();

  ProjectUtil.getCurrentProjectId = () => {
    return new ObjectID(PROJECT_ID);
  };
  ProjectUtil.getCurrentProject = () => {
    return project;
  };
  UserUtil.isMasterAdmin = () => {
    return false;
  };
  /*
   * No signed-in user: the profile button draws the blank picture, rather
   * than one read from the server.
   */
  UserUtil.getUserId = () => {
    throw new Error("No user is signed in to the fixture");
  };
  ModelAPI.getCommonHeaders = () => {
    return { tenantid: PROJECT_ID };
  };
  ModelAPI.count = async (options) => {
    counted.requests.push(`count ${options.modelType.name}`);

    if (options.modelType === Incident) {
      return 2;
    }

    if (options.modelType === Alert) {
      return 3;
    }

    return 0;
  };
  // The incident and alert states the counts are read by: none needed here.
  ModelAPI.getList = async (options) => {
    counted.requests.push(`list ${options.modelType.name}`);
    return { data: [], count: 0, skip: 0, limit: 0 };
  };
  // The current on-call lookup: nobody is on call.
  API.get = async (options) => {
    counted.requests.push(`GET ${options.url.toString()}`);
    return new HTTPResponse(
      200,
      {
        escalationRulesByUser: [],
        escalationRulesByTeam: [],
        escalationRulesBySchedule: [],
      },
      {},
    );
  };
  GlobalConfigUtil.fetchVars = async () => {
    return { disableUserProjectCreation: false };
  };
  Realtime.listenToModelEvent = () => {
    return () => {
      // Nothing to stop listening to.
    };
  };
}

export function HeaderFixture(props) {
  const [project, setProject] = useState(makeProject);

  return (
    <div className="flex min-h-screen flex-col">
      <div data-testid="dashboard-top-section" className="sticky top-0 z-10">
        <TopSection
          header={
            <DashboardHeader
              projects={[project]}
              onProjectSelected={setProject}
              showProjectModal={false}
              onProjectModalClose={() => {}}
              selectedProject={project}
            />
          }
          navbar={<DashboardNavbar show={true} />}
        />
      </div>
      <HowOneUptimeWorksDialog />
      <main className="grow px-4 py-6 sm:px-8">
        <p data-testid="current-route" className="text-sm text-gray-500">
          {props.pathname}
        </p>
      </main>
    </div>
  );
}

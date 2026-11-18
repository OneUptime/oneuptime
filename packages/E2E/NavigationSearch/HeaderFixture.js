import React, { useState } from "react";
import Project from "Common/Models/DatabaseModels/Project";
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import TopSection from "Common/UI/Components/TopSection/TopSection";
import API from "Common/UI/Utils/API/API";
import GlobalConfigUtil from "Common/UI/Utils/GlobalConfig";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import Realtime from "Common/UI/Utils/Realtime";
import UserUtil from "Common/UI/Utils/User";
import DashboardCommandPalette from "../../App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPalette";
import DashboardHeader from "../../App/FeatureSet/Dashboard/src/Components/Header/Header";
import HowOneUptimeWorksDialog from "../../App/FeatureSet/Dashboard/src/Components/Home/HowOneUptimeWorksDialog";
import DashboardNavbar from "../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar";
import EventName from "../../App/FeatureSet/Dashboard/src/Utils/EventName";

/*
 * ?header=true: the top of every Dashboard page - the production header
 * (Components/Header/Header) and nav bar (Components/NavBar/NavBar), stacked
 * in Common's TopSection as the Dashboard's MasterPage stacks them - in a
 * project named "Acme Commerce Production" with 2 active incidents and 3
 * active alerts. The page's reading language is ?lang= (en, de, ar or fa:
 * the Arabic and Persian pages read right to left) and ?theme=dark draws it
 * dark, with the
 * Dashboard's own fonts, tailwind.config and Theme.css (server.js).
 * ?projects=many lists six more projects in the picker (MORE_PROJECTS).
 * ?palette=true mounts the Dashboard's Search (Cmd/Ctrl+K) beside them, as
 * App.tsx does, so the header's Search, the phone menu's and the keys open
 * it (PaletteOnPhonesAndDesktops.spec.ts): its Glossary, its docs search
 * and the project's people are answered here, Ask AI's and a new tab's
 * openings are counted, and ?as=admin (a Project Admin, the default) or
 * ?as=reader (who reads services and nothing else) is who is searching.
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

// The languages the header is drawn in here: one long, two right to left.
const HEADER_LANGUAGES = ["en", "de", "ar", "fa"];

export const headerLanguage =
  isHeaderMode && HEADER_LANGUAGES.includes(query.get("lang"))
    ? query.get("lang")
    : "en";

/*
 * ?projects=many: the list of someone with several projects, for the
 * project list's search (ProjectPickerSearch.spec.ts) - the names of a real
 * list, two of them the same - after the project the page is in.
 */
export const MORE_PROJECTS = [
  { id: "00000000-0000-4000-8000-000000000011", name: "OneUptime Kubernetes" },
  { id: "00000000-0000-4000-8000-000000000012", name: "Project test" },
  { id: "00000000-0000-4000-8000-000000000013", name: "Free demo" },
  { id: "00000000-0000-4000-8000-000000000014", name: "Sample: Acme Shop" },
  { id: "00000000-0000-4000-8000-000000000015", name: "Test Project\\" },
  { id: "00000000-0000-4000-8000-000000000016", name: "Test Project\\" },
];

const listsMoreProjects = isHeaderMode && query.get("projects") === "many";

// ?palette=true: the Dashboard's Search, mounted beside the header.
export const mountsPalette = isHeaderMode && query.get("palette") === "true";

// Who is searching: a Project Admin, or someone who reads services alone.
const searchesAsReader = mountsPalette && query.get("as") === "reader";

/*
 * The project's people, as POST /team-member/search-members answers a
 * reader who may see them (Types/Team/ProjectMemberSearch): by name or
 * email, a few at most.
 */
export const PROJECT_PEOPLE = [
  {
    userId: "00000000-0000-4000-8000-0000000000a1",
    name: "Ada Lovelace",
    email: "ada@acme.test",
  },
  {
    userId: "00000000-0000-4000-8000-0000000000b1",
    name: "Bob Builder",
    email: "bob@acme.test",
  },
  {
    userId: "00000000-0000-4000-8000-0000000000e1",
    name: "",
    email: "eve.invited@acme.test",
  },
];

/*
 * The Glossary the docs serve (/docs/glossary/<lang>.json), a few of its
 * real terms in each language the page is drawn in: Probe and Escalation
 * Rule, as introduction/glossary.md names them.
 */
const GLOSSARY = {
  en: [
    ["probe", "Probe", ["Monitoring location"]],
    ["escalation-rule", "Escalation Rule", []],
  ],
  de: [
    ["probe", "Sonde", []],
    ["escalation-rule", "Eskalationsregel", []],
  ],
  ar: [
    ["probe", "المسبار", []],
    ["escalation-rule", "قاعدة التصعيد", []],
  ],
  fa: [
    ["probe", "پراب", []],
    ["escalation-rule", "قاعده تشدید", []],
  ],
};

function json(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// The reads Search makes of its own, answered in the page with nothing sent.
function installPaletteFixture(counted) {
  counted.opened = [];
  counted.askAiRequests = [];
  counted.memberSearches = [];

  GlobalEvents.addEventListener(EventName.AI_CHAT_TOGGLE, (event) => {
    if (event && event.detail) {
      counted.askAiRequests.push(event.detail);
    }
  });

  // A page Search opens in a new tab: a term on the Glossary page, the docs.
  window.open = (url) => {
    counted.opened.push(String(url));
    return null;
  };

  window.fetch = async (input) => {
    const url = String(input && input.url ? input.url : input);
    counted.requests.push(`fetch ${url}`);
    const glossaryLanguage = /\/glossary\/([a-zA-Z-]+)\.json/.exec(url);

    if (glossaryLanguage) {
      const language = GLOSSARY[glossaryLanguage[1]]
        ? glossaryLanguage[1]
        : "en";
      return json({
        lang: language,
        entries: GLOSSARY[language].map(([id, term, alsoCalled]) => {
          return {
            id: id,
            term: term,
            definition: `${term}: what the Glossary says it is.`,
            alsoCalled: alsoCalled,
          };
        }),
      });
    }

    // The docs search: nothing, so a question is offered to Ask AI.
    if (url.includes("/search/")) {
      return json({ results: [] });
    }

    return new Response("{}", { status: 404 });
  };

  API.post = async (options) => {
    const url = options.url.toString();
    counted.requests.push(`POST ${url}`);

    if (url.endsWith("/team-member/search-members")) {
      const text = String((options.data && options.data.text) || "")
        .trim()
        .toLowerCase();
      counted.memberSearches.push(text);

      return new HTTPResponse(
        200,
        {
          members: PROJECT_PEOPLE.filter((person) => {
            return (
              person.name.toLowerCase().includes(text) ||
              person.email.toLowerCase().includes(text)
            );
          }),
        },
        {},
      );
    }

    // Product events and anything else: taken, with nothing to say.
    return new HTTPResponse(200, {}, {});
  };

  /*
   * Who is searching, as the permission snapshot says: a Project Admin may
   * create everything Search offers and see the project's people; a reader
   * of services may do neither.
   */
  PermissionUtil.getAllPermissions = () => {
    return searchesAsReader
      ? [Permission.ReadService]
      : [Permission.ProjectAdmin];
  };
  PermissionUtil.getProjectPermissions = () => {
    return null;
  };
}

function makeProject(id = PROJECT_ID, name = PROJECT_NAME) {
  const project = new Project();
  project.id = new ObjectID(id);
  project.name = name;
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

  if (mountsPalette) {
    installPaletteFixture(counted);
  }

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
  const [project, setProject] = useState(() => {
    return makeProject();
  });

  /*
   * ?projects=many: the page's project and the others, one list for as
   * long as the page is open, as App.tsx keeps the list it read.
   */
  const [moreProjects] = useState(() => {
    return listsMoreProjects
      ? [
          project,
          ...MORE_PROJECTS.map((more) => {
            return makeProject(more.id, more.name);
          }),
        ]
      : null;
  });

  return (
    <div className="flex min-h-screen flex-col">
      <div data-testid="dashboard-top-section" className="sticky top-0 z-10">
        <TopSection
          header={
            <DashboardHeader
              projects={moreProjects || [project]}
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
      {mountsPalette ? (
        <DashboardCommandPalette
          projects={moreProjects || [project]}
          onProjectSelected={setProject}
        />
      ) : (
        <></>
      )}
      <main className="grow px-4 py-6 sm:px-8">
        <p data-testid="current-route" className="text-sm text-gray-500">
          {props.pathname}
        </p>
        {/* The query wraps anywhere: a phone's line is narrower than it. */}
        <p
          data-testid="current-search"
          className="break-all text-sm text-gray-500"
        >
          {props.search || ""}
        </p>
      </main>
    </div>
  );
}

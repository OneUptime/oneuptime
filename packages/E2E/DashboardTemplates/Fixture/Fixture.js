/*
 * Offline fixture for Create a dashboard (Dashboards > Create Dashboard),
 * beside the Create a workflow dialog it was made to work like.
 *
 *   ?page=create-dashboard   (the default) a stand-in for the Dashboards
 *                            page's Create Dashboard button and the real
 *                            Create a dashboard dialog it opens, with the
 *                            real template catalog
 *   ?page=create-workflow    the same for the Workflows page's Create
 *                            Workflow button and the real Create a workflow
 *                            dialog, to hold the two side by side
 *
 * Only the server is left out. What the dialogs would create is kept on
 * window.__fixture.created for the spec to read, and every read the
 * fixture does not model is kept on window.__fixture.unmodelled, which the
 * spec holds to empty. Steered by the query string:
 *
 *   names=A,B          the names the project's dashboards already have
 *                      (none by default)
 *   namesDelay=1500    the names arrive that many milliseconds late
 *   names=fail         looking the names up fails
 *   create=taken       the first create is refused, as the server refuses
 *                      a name someone took meanwhile
 *   lang=de            the Dashboard's words in that language: any of its
 *                      locales (Dashboard/src/Locales), fetched from the
 *                      fixture server as the page opens
 *   theme=dark         dark mode
 */
import "Common/UI/Styles/Theme.css";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import WorkflowModel from "Common/Models/DatabaseModels/Workflow";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import CreateDashboardModal from "../../../App/FeatureSet/Dashboard/src/Components/Dashboard/CreateDashboardModal";
import CreateWorkflowModal from "../../../App/FeatureSet/Dashboard/src/Components/Workflow/CreateWorkflowModal";

const PROJECT_ID = "10000000-0000-4000-8000-0000000000d1";
const CREATED_DASHBOARD_ID = "20000000-0000-4000-8000-0000000000d2";
const CREATED_WORKFLOW_ID = "30000000-0000-4000-8000-0000000000d3";

// Every language the Dashboard has besides English (Dashboard/src/Locales).
const LANGUAGES = [
  "da",
  "de",
  "es",
  "fa",
  "fr",
  "hi",
  "it",
  "ja",
  "ko",
  "nl",
  "no",
  "pt",
  "ru",
  "sv",
  "zh-CN",
  "zh-TW",
];

const params = new URLSearchParams(window.location.search);
const fixturePage = params.get("page") || "create-dashboard";
const language = LANGUAGES.includes(params.get("lang"))
  ? params.get("lang")
  : "en";
const namesParam = params.get("names") || "";
const namesDelay = Number(params.get("namesDelay") || 0);

window.__fixture = {
  created: [],
  namesRequests: 0,
  unmodelled: [],
};

function unmodelled(call, detail) {
  window.__fixture.unmodelled.push(`${call} ${detail}`);
}

function tableOf(options) {
  return new options.modelType().tableName;
}

// ---- the project ------------------------------------------------------------

ProjectUtil.getCurrentProjectId = () => {
  return new ObjectID(PROJECT_ID);
};

// ---- the data boundary --------------------------------------------------------

/*
 * The one read Create a dashboard makes: every dashboard's name, so the one
 * it fills in is one nothing has yet.
 */
ModelAPI.getList = async (options) => {
  const table = tableOf(options);

  if (
    table === "Dashboard" &&
    JSON.stringify(options.select) === JSON.stringify({ name: true })
  ) {
    window.__fixture.namesRequests += 1;

    if (namesDelay > 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, namesDelay);
      });
    }

    if (namesParam === "fail") {
      throw new Error("The names could not be looked up.");
    }

    const names = namesParam
      ? namesParam.split(",").map((name) => {
          return name.trim();
        })
      : [];

    return {
      data: names.map((name) => {
        const dashboard = new Dashboard();
        dashboard.name = name;
        return dashboard;
      }),
      count: names.length,
      skip: 0,
      limit: names.length,
    };
  }

  unmodelled("getList", table);
  return { data: [], count: 0, skip: 0, limit: 0 };
};

let refusedCreates = 0;

ModelAPI.create = async (data) => {
  const model = data.model;

  if (data.modelType === Dashboard) {
    if (params.get("create") === "taken" && refusedCreates === 0) {
      refusedCreates += 1;
      throw new BadDataException(
        "Dashboard with the same name already exists.",
      );
    }

    window.__fixture.created.push({
      kind: "dashboard",
      name: model.name,
      description: model.description || null,
      projectId: model.projectId ? model.projectId.toString() : null,
      templateType: (data.miscDataProps || {}).dashboardTemplateType || null,
    });

    const created = new Dashboard();
    created._id = CREATED_DASHBOARD_ID;
    created.name = model.name;

    return { data: created };
  }

  if (data.modelType === WorkflowModel) {
    window.__fixture.created.push({ kind: "workflow", name: model.name });

    const created = new WorkflowModel();
    created.id = new ObjectID(CREATED_WORKFLOW_ID);
    created.name = model.name;

    return { data: created };
  }

  if (data.modelType === WorkflowVariable) {
    window.__fixture.created.push({ kind: "variable", name: model.name });
    return { data: model };
  }

  unmodelled("create", tableOf(data));
  throw new Error("The fixture only creates dashboards and workflows.");
};

/*
 * The language's words, as the Dashboard ships them. Fetched rather than
 * bundled: seventeen locales of thirty thousand strings each would make the
 * bundle the suite waits for many times larger.
 */
const translation =
  language === "en"
    ? {}
    : await fetch(`/locales/${language}.json`).then((response) => {
        if (!response.ok) {
          throw new Error(`The ${language} locale could not be loaded.`);
        }

        return response.json();
      });

/*
 * The Dashboard looks every string up by its English text, so the separators
 * i18next reads in a key (the "." and ":" of a sentence) are turned off, as
 * the Dashboard's own setup does.
 */
await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: language,
  resources: {
    [language]: { translation: translation },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
document.documentElement.lang = language;

// ---- the pages ----------------------------------------------------------------

const OPENER_CLASS_NAME =
  "rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700";

// The Dashboards page, reduced to its Create Dashboard button and the dialog.
function CreateDashboardPage() {
  const [isOpen, setIsOpen] = useState(false);
  const [created, setCreated] = useState(null);

  return (
    <div style={{ padding: "16px" }}>
      <button
        type="button"
        data-testid="create-dashboard"
        className={OPENER_CLASS_NAME}
        onClick={() => {
          setIsOpen(true);
        }}
      >
        Create Dashboard
      </button>
      {created ? (
        <p data-testid="created-dashboard" className="mt-4 text-sm">
          {`Opened the new dashboard: ${created.name}`}
        </p>
      ) : (
        <></>
      )}
      {isOpen ? (
        <CreateDashboardModal
          onClose={() => {
            setIsOpen(false);
          }}
          onCreated={(dashboard) => {
            setIsOpen(false);
            setCreated(dashboard);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
}

// The Workflows page, reduced to its Create Workflow button and the dialog.
function CreateWorkflowPage() {
  const [isOpen, setIsOpen] = useState(false);
  const [created, setCreated] = useState(null);

  return (
    <div style={{ padding: "16px" }}>
      <button
        type="button"
        data-testid="create-workflow"
        className={OPENER_CLASS_NAME}
        onClick={() => {
          setIsOpen(true);
        }}
      >
        Create Workflow
      </button>
      {created ? (
        <p data-testid="created-workflow" className="mt-4 text-sm">
          {`Opened the builder for ${created.name}`}
        </p>
      ) : (
        <></>
      )}
      {isOpen ? (
        <CreateWorkflowModal
          onClose={() => {
            setIsOpen(false);
          }}
          onCreated={(workflow) => {
            setIsOpen(false);
            setCreated(workflow);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  fixturePage === "create-workflow" ? (
    <CreateWorkflowPage />
  ) : (
    <CreateDashboardPage />
  ),
);

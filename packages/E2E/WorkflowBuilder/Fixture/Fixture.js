/*
 * The real workflow builder canvas: react-flow, the step cards, the Add
 * Component / Add Trigger picker and the step settings dialog, with the real
 * component catalog. Nothing is faked; the page around it is reduced to the
 * one toolbar button the Builder page has for adding a step. Like the
 * Builder's, it says Add Trigger while the canvas has no trigger and Add
 * Component once it has one (WorkflowAddButton), read from the graph the
 * canvas last reported.
 *
 * ?scenario=graph         a Manual trigger connected to a set-up Log step
 * ?scenario=trigger-only  just a Manual trigger
 * ?scenario=empty         the dashed "choose a trigger" placeholder
 * ?scenario=no-trigger    a Log step whose trigger was deleted, and the
 *                         dashed placeholder back in the trigger's place
 * ?scenario=switch        a Manual trigger, then a Switch / Case on an
 *                         environment: "production" leads to log-1,
 *                         "staging" to log-2 and Default to log-3; log-4 is
 *                         on the canvas, connected to nothing yet
 * ?scenario=switch-full   a Switch / Case holding every case a step can
 *                         (25, named like severities), Default to log-1
 * ?scenario=record        an On Update Incident trigger passing on the
 *                         incident's title, then a Log. Its two field lists
 *                         read the real Incident schema (IncidentSchema.json,
 *                         as /model-schema/Incident answers), and the Run
 *                         Workflow button opens the real Run Workflow panel,
 *                         whose record search is answered here from a few
 *                         incidents, by the rules the server uses.
 *                         ?select= and ?watch= set what the two lists hold
 *                         (JSON; &stored=text keeps it as the text older
 *                         workflows saved). ?trigger=create-or-update makes
 *                         the trigger On Create or Update Incident, and
 *                         &next=if-else or &next=switch puts an If / Else or
 *                         a Switch / Case on its What Happened after it, in
 *                         place of the Log. ?schema=fail and ?schema=slow,
 *                         ?records=none, =fail and =slow stand in for a
 *                         server that errs, is slow or has nothing; the slow
 *                         ones answer once window.releaseSchema() or
 *                         window.releaseRecords() is called. ?off=1 is a
 *                         workflow that is turned off.
 * ?scenario=record-new    the "choose a trigger" placeholder, with the same
 *                         stand-ins: a record trigger added from the picker.
 * ?scenario=record-branch the same trigger, then an If / Else on the title:
 *                         Yes runs an HTTP POST (api-post-1), No a Log
 *                         (log-1), and both lead to Slack. An HTTP GET
 *                         (api-get-1) follows Slack, and another (api-get-2)
 *                         is connected to nothing. So where Slack runs the
 *                         POST has run on some runs only, and where the Log
 *                         runs the POST is on another branch.
 * ?scenario=page...       the Page steps, and the project their settings
 *                         pick people from (PageScenarios.js)
 * ?scenario=huntress      the Huntress template's workflow, and its
 *                         trigger's panel: the URL to give Huntress, the
 *                         signing secret, and whether Huntress reaches it
 *                         (HuntressScenario.js)
 * ?page=on-call-logs      the Dashboard's real on-call logs table, with
 *                         pages that have no policy behind them among a
 *                         policy's runs (OnCallLogs.js)
 * ?page=on-call-timeline  the real timeline table of one such page
 *                         (OnCallLogs.js)
 *
 * ?page=create-workflow   the Workflows page's Create Workflow button and the
 *                         real "Create a workflow" dialog it opens, with the
 *                         real template catalog. Only the server is left out:
 *                         what the dialog would create is kept in
 *                         window.__createdRecords for the spec to read.
 *                         ?failVariables=true makes writing a template's
 *                         settings fail, as a server error would. Who to
 *                         page is picked from the Page steps' project
 *                         (PageScenarios.js).
 *
 * ?page=builder-page      the Dashboard's real Builder page around the
 *                         canvas: its toolbar and the notice shown while
 *                         the workflow is off (BuilderPage.js)
 */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import Workflow, {
  getPlaceholderTriggerNode,
} from "Common/UI/Components/Workflow/Workflow";
import { getWorkflowAddButton } from "Common/UI/Components/Workflow/WorkflowAddButton";
import { loadComponentsAndCategories } from "Common/UI/Components/Workflow/Utils";
import ObjectID from "Common/Types/ObjectID";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { NodeType } from "Common/Types/Workflow/Component";
import {
  RunRecordReferenceKind,
  getRunRecordSearchWords,
  isRunRecordNumberMatch,
  parseRunRecordReference,
} from "Common/Types/Workflow/RunRecord";
import WorkflowModel from "Common/Models/DatabaseModels/Workflow";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import CreateWorkflowModal from "../../../App/FeatureSet/Dashboard/src/Components/Workflow/CreateWorkflowModal";
import IncidentSchema from "./IncidentSchema.json";
import {
  OnCallLogsPage,
  OnCallTimelinePage,
  installOnCallLogs,
} from "./OnCallLogs";
import { getPageScenario, installPageProject } from "./PageScenarios";
import {
  HUNTRESS_WEBHOOK_KEY,
  getHuntressScenario,
  installHuntressWorkflow,
} from "./HuntressScenario";
import { BuilderPage, installBuilderPage } from "./BuilderPage";

const params = new URLSearchParams(window.location.search);
const scenario = params.get("scenario") || "graph";
const fixturePage = params.get("page") || "builder";

const catalog = loadComponentsAndCategories().components;

function metadataOf(id) {
  const metadata = catalog.find((component) => {
    return component.id === id;
  });

  if (!metadata) {
    throw new Error(`No workflow component with id ${id}`);
  }

  return metadata;
}

function step(metadataId, number, x, y, args) {
  const metadata = metadataOf(metadataId);

  return {
    id: `canvas-${metadataId}-${number}`,
    type: "node",
    position: { x: x, y: y },
    data: {
      id: `${metadataId}-${number}`,
      internalId: `runner-${metadataId}-${number}`,
      nodeType: NodeType.Node,
      componentType: metadata.componentType,
      metadataId: metadata.id,
      metadata: { ...metadata },
      error: "",
      arguments: args || {},
      returnValues: {},
    },
  };
}

let initialNodes = [];
let initialEdges = [];

function edge(source, sourceHandle, target) {
  return {
    id: `${source}-${sourceHandle}-to-${target}`,
    source: source,
    sourceHandle: sourceHandle,
    target: target,
    targetHandle: "in",
  };
}

/*
 * What one of the record trigger's field lists holds: ?select= or ?watch=,
 * as JSON - or, with &stored=text, as the text older workflows saved.
 */
function storedFields(name, fallback) {
  const given = params.get(name);

  if (given === null) {
    return fallback;
  }

  if (params.get("stored") === "text") {
    return given;
  }

  try {
    return JSON.parse(given);
  } catch {
    return given;
  }
}

if (scenario === "empty" || scenario === "record-new") {
  initialNodes = [getPlaceholderTriggerNode()];
} else if (scenario === "no-trigger") {
  initialNodes = [
    getPlaceholderTriggerNode(),
    step("log", 1, 96, 320, { value: "Deployment finished" }),
  ];
} else if (scenario === "record") {
  const recordTrigger =
    params.get("trigger") === "create-or-update"
      ? "incident-on-create-or-update"
      : "incident-on-update";

  const triggerStep = step(recordTrigger, 1, 160, 64, {
    "listen-on": storedFields("watch", {}),
    select: storedFields("select", { title: true }),
  });
  // What started the run: "created" or "updated" (On Create or Update).
  const whatHappened =
    "{{local.components." + recordTrigger + "-1.returnValues.what-happened}}";
  const next = params.get("next") || "log";

  if (next === "if-else") {
    initialNodes = [
      triggerStep,
      step("if-else", 1, 160, 320, {
        "input-1": whatHappened,
        operator: "==",
        "input-2": "",
      }),
    ];
    initialEdges = [
      edge("canvas-" + recordTrigger + "-1", "success", "canvas-if-else-1"),
    ];
  } else if (next === "switch") {
    initialNodes = [
      triggerStep,
      step("switch", 1, 160, 320, {
        value: whatHappened,
        cases: [
          { id: "case-1", comparison: "==", value: "", compareAs: "" },
          { id: "case-2", comparison: "==", value: "", compareAs: "" },
        ],
      }),
    ];
    initialEdges = [
      edge("canvas-" + recordTrigger + "-1", "success", "canvas-switch-1"),
    ];
  } else {
    initialNodes = [
      triggerStep,
      step("log", 1, 160, 320, {
        value:
          "{{local.components." +
          recordTrigger +
          "-1.returnValues.model.title}}",
      }),
    ];
    initialEdges = [
      edge("canvas-" + recordTrigger + "-1", "success", "canvas-log-1"),
    ];
  }
} else if (scenario === "record-branch") {
  initialNodes = [
    step("incident-on-update", 1, 160, 32, {
      "listen-on": {},
      select: { title: true },
    }),
    step("if-else", 1, 160, 240, {
      "input-1":
        "{{local.components.incident-on-update-1.returnValues.model.title}}",
      operator: "contains",
      "input-2": "database",
    }),
    step("api-post", 1, -96, 448, {
      url: "https://hooks.example.com/escalate",
    }),
    step("log", 1, 416, 448, { value: "Not a database incident" }),
    step("slack-send-message-to-channel", 1, 160, 672, {
      "webhook-url": "https://hooks.example.com/slack",
      text: "Incident updated",
    }),
    step("api-get", 1, 160, 896, { url: "https://status.example.com" }),
    step("api-get", 2, 672, 448, { url: "https://example.com/unused" }),
  ];
  initialEdges = [
    edge("canvas-incident-on-update-1", "success", "canvas-if-else-1"),
    edge("canvas-if-else-1", "yes", "canvas-api-post-1"),
    edge("canvas-if-else-1", "no", "canvas-log-1"),
    edge(
      "canvas-api-post-1",
      "success",
      "canvas-slack-send-message-to-channel-1",
    ),
    edge("canvas-log-1", "out", "canvas-slack-send-message-to-channel-1"),
    edge(
      "canvas-slack-send-message-to-channel-1",
      "success",
      "canvas-api-get-1",
    ),
  ];
} else if (scenario === "trigger-only") {
  initialNodes = [step("manual", 1, 160, 64)];
} else if (scenario === "switch") {
  // As the Switch / Case settings save it: a value and a list of cases.
  initialNodes = [
    step("manual", 1, 160, 32),
    step("switch", 1, 160, 240, {
      value: "{{local.components.manual-1.returnValues.value.environment}}",
      cases: [
        { id: "case-1", comparison: "==", value: "production", compareAs: "" },
        { id: "case-2", comparison: "==", value: "staging", compareAs: "" },
      ],
    }),
    step("log", 1, -224, 480, { value: "Production" }),
    step("log", 2, 160, 480, { value: "Staging" }),
    step("log", 3, 544, 480, { value: "Anything else" }),
    step("log", 4, 160, 704, { value: "Development" }),
  ];
  initialEdges = [
    edge("canvas-manual-1", "success", "canvas-switch-1"),
    edge("canvas-switch-1", "case-1", "canvas-log-1"),
    edge("canvas-switch-1", "case-2", "canvas-log-2"),
    edge("canvas-switch-1", "default", "canvas-log-3"),
  ];
} else if (scenario === "switch-full") {
  const names = [
    "Critical Incident",
    "Major Incident",
    "Minor Incident",
    "Customer reported",
  ];
  const cases = [];

  for (let index = 0; index < 25; index++) {
    cases.push({
      id: `case-${index + 1}`,
      comparison: "==",
      value: names[index] || `Severity ${index + 1}`,
      compareAs: "text",
    });
  }

  initialNodes = [
    step("manual", 1, 160, 32),
    step("switch", 1, 160, 240, {
      value: "{{local.components.manual-1.returnValues.value.severity}}",
      cases: cases,
    }),
    step("log", 1, 160, 480, { value: "Anything else" }),
  ];
  initialEdges = [
    edge("canvas-manual-1", "success", "canvas-switch-1"),
    edge("canvas-switch-1", "default", "canvas-log-1"),
  ];
} else {
  initialNodes = [
    step("manual", 1, 160, 64),
    step("log", 1, 160, 320, { value: "Deployment finished" }),
  ];
  initialEdges = [
    {
      id: "manual-to-log",
      source: "canvas-manual-1",
      sourceHandle: "success",
      target: "canvas-log-1",
      targetHandle: "in",
    },
  ];
}

// The Page steps' scenarios bring their own graph and their own project.
const pageScenario = getPageScenario(scenario, step, edge);

if (pageScenario) {
  initialNodes = pageScenario.nodes;
  initialEdges = pageScenario.edges;
  installPageProject(params);
}

// So does the Huntress template's, with the workflow its panel reads.
const huntressScenario = getHuntressScenario(scenario, metadataOf);

if (huntressScenario) {
  initialNodes = huntressScenario.nodes;
  initialEdges = huntressScenario.edges;
  installHuntressWorkflow(params);
}

// What the builder hands its page to save, for the spec to read.
window.__savedGraph = { nodes: initialNodes, edges: initialEdges };

/*
 * The record scenarios' server. Three requests reach it: the Incident
 * model's fields (/model-schema/Incident), the records Run Workflow can run
 * with (/run-records), and what the steps held when they last ran
 * (/step-samples: nothing yet). Each is noted for the spec to read.
 */
const INCIDENTS = [
  {
    id: "a0000000-0000-4000-8000-000000000012",
    numberValue: 12,
    number: "INC-12",
    name: "Checkout returns 502 for customers in the EU",
    createdAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
  },
  {
    id: "a0000000-0000-4000-8000-000000000011",
    numberValue: 11,
    number: "INC-11",
    name: "Database is down",
    createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "a0000000-0000-4000-8000-000000000010",
    numberValue: 10,
    number: "INC-10",
    name: "Login page is slow",
    createdAt: "2024-03-09T14:05:00.000Z",
  },
  {
    id: "a0000000-0000-4000-8000-000000000009",
    numberValue: 9,
    number: "INC-9",
    name: "Database replica is lagging behind the primary by several minutes and reports are stale",
    createdAt: "2024-02-21T08:30:00.000Z",
  },
  {
    id: "a0000000-0000-4000-8000-000000000008",
    numberValue: 8,
    number: "INC-8",
    name: "Status page shows the wrong region",
    createdAt: "2024-02-02T19:45:00.000Z",
  },
  {
    // Numbered before the project's prefix changed, and keeps its old one.
    id: "a0000000-0000-4000-8000-000000000007",
    numberValue: 7,
    number: "OPS-7",
    name: "Email worker has a backlog",
    createdAt: "2023-11-18T06:10:00.000Z",
  },
];

function listed(incident, matchedBy) {
  return {
    id: incident.id,
    number: incident.number,
    name: incident.name,
    createdAt: incident.createdAt,
    matchedBy: matchedBy,
  };
}

/*
 * The records a search finds, by the rules the server uses (the same pure
 * functions, Types/Workflow/RunRecord): an ID, then a number - with its
 * prefix or without one - then the titles that hold every word typed, in
 * any order; the newest ones when nothing is typed.
 */
function searchIncidents(search) {
  const reference = parseRunRecordReference(search);

  if (reference.kind === RunRecordReferenceKind.Empty) {
    return INCIDENTS.map((incident) => {
      return listed(incident, "Recent");
    });
  }

  if (reference.kind === RunRecordReferenceKind.Id) {
    return INCIDENTS.filter((incident) => {
      return incident.id === reference.id;
    }).map((incident) => {
      return listed(incident, "Id");
    });
  }

  const found = [];

  if (reference.kind === RunRecordReferenceKind.Number) {
    for (const incident of INCIDENTS) {
      if (
        incident.numberValue === reference.number &&
        isRunRecordNumberMatch({
          reference: reference,
          numberWithPrefix: incident.number,
        })
      ) {
        found.push(listed(incident, "Number"));
      }
    }
  }

  const words = getRunRecordSearchWords(reference.text).map((word) => {
    return word.toLowerCase();
  });

  for (const incident of INCIDENTS) {
    const isListed = found.some((record) => {
      return record.id === incident.id;
    });
    const name = incident.name.toLowerCase();

    if (
      !isListed &&
      words.every((word) => {
        return name.includes(word);
      })
    ) {
      found.push(listed(incident, "Name"));
    }
  }

  return found;
}

window.__schemaRequests = [];
window.__recordSearches = [];

// A slow answer waits here until the spec lets it go.
function gate(name) {
  let release = () => {};

  const opened = new Promise((resolve) => {
    release = resolve;
  });

  window[name] = () => {
    release();
  };

  return opened;
}

function installRecordServer() {
  const schemaMode = params.get("schema") || "";
  const recordsMode = params.get("records") || "";
  const schemaGate = schemaMode === "slow" ? gate("releaseSchema") : null;
  const recordsGate = recordsMode === "slow" ? gate("releaseRecords") : null;

  ModelAPI.getCommonHeaders = () => {
    return {};
  };

  // The workflow has no variables of its own.
  ModelAPI.getList = async () => {
    return { data: [], count: 0, skip: 0, limit: 100 };
  };

  API.get = async (options) => {
    const url = options.url.toString();

    window.__schemaRequests.push(url);

    if (schemaGate) {
      await schemaGate;
    }

    if (schemaMode === "fail") {
      return new HTTPErrorResponse(
        500,
        { message: "The fields are not available right now." },
        {},
      );
    }

    return new HTTPResponse(
      200,
      url.endsWith("/model-schema/Incident") ? IncidentSchema : { columns: [] },
      {},
    );
  };

  API.post = async (options) => {
    const url = options.url.toString();

    if (url.includes("/run-records/")) {
      const search = (options.data && options.data.search) || "";

      window.__recordSearches.push(search);

      if (recordsGate) {
        await recordsGate;
      }

      if (recordsMode === "fail") {
        return new HTTPErrorResponse(
          500,
          { message: "The incidents could not be listed." },
          {},
        );
      }

      return new HTTPResponse(
        200,
        { records: recordsMode === "none" ? [] : searchIncidents(search) },
        {},
      );
    }

    if (url.includes("/step-samples/")) {
      return new HTTPResponse(200, { samples: [] }, {});
    }

    return new HTTPResponse(200, {}, {});
  };
}

if (
  scenario === "record" ||
  scenario === "record-new" ||
  scenario === "record-branch"
) {
  installRecordServer();
}

// What Run Workflow started, for the spec to read.
window.__runs = [];

function App() {
  const [showPicker, setShowPicker] = useState(false);
  const [showRun, setShowRun] = useState(false);
  // The graph as the canvas last reported it, as the Builder page keeps it.
  const [graphNodes, setGraphNodes] = useState(initialNodes);

  return (
    <div style={{ padding: "16px" }}>
      <div style={{ marginBottom: "12px", display: "flex", gap: "8px" }}>
        <button
          type="button"
          data-testid="add-component"
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700"
          onClick={() => {
            setShowPicker(true);
          }}
        >
          {getWorkflowAddButton(graphNodes).title}
        </button>
        <button
          type="button"
          data-testid="run-workflow"
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700"
          onClick={() => {
            setShowRun(true);
          }}
        >
          Run Workflow
        </button>
      </div>
      <Workflow
        workflowId={new ObjectID("11111111-1111-4111-8111-111111111111")}
        initialNodes={initialNodes}
        initialEdges={initialEdges}
        showComponentsPickerModal={showPicker}
        onComponentPickerModalUpdate={(isShown) => {
          setShowPicker(isShown);
        }}
        showRunModal={showRun}
        onRunModalUpdate={(isShown) => {
          setShowRun(isShown);
        }}
        onRun={(trigger) => {
          window.__runs.push({
            metadataId: trigger.metadataId,
            arguments: trigger.arguments,
          });
        }}
        runsAreTestRuns={params.get("off") === "1"}
        webhookSecretKey={huntressScenario ? HUNTRESS_WEBHOOK_KEY : undefined}
        canSeeWebhookSecretKey={
          huntressScenario ? params.get("url") !== "hidden" : undefined
        }
        onWorkflowUpdated={(nodes, edges) => {
          window.__savedGraph = { nodes: nodes, edges: edges };
          setGraphNodes(nodes);
        }}
      />
    </div>
  );
}

const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const CREATED_WORKFLOW_ID = "33333333-3333-4333-8333-333333333333";

/*
 * What the dialog sends, in the order it sends it. The server is not here,
 * so these stand in for it: a workflow gets an id, a variable is accepted
 * (or refused, with ?failVariables=true), and a delete is noted.
 */
window.__createdRecords = [];

function installServerStandIns() {
  ProjectUtil.getCurrentProjectId = () => {
    return new ObjectID(PROJECT_ID);
  };

  ModelAPI.create = async (data) => {
    const model = data.model;

    if (data.modelType === WorkflowModel) {
      window.__createdRecords.push({
        kind: "workflow",
        name: model.name,
        description: model.description,
        isEnabled: model.isEnabled,
        projectId: model.projectId ? model.projectId.toString() : null,
        graph: model.graph,
      });

      const created = new WorkflowModel();
      created.id = new ObjectID(CREATED_WORKFLOW_ID);
      created.name = model.name;

      return { data: created };
    }

    if (data.modelType === WorkflowVariable) {
      if (params.get("failVariables") === "true") {
        throw new Error("The server refused this setting.");
      }

      window.__createdRecords.push({
        kind: "variable",
        name: model.name,
        content: model.content,
        isSecret: model.isSecret,
        workflowId: model.workflowId ? model.workflowId.toString() : null,
      });

      return { data: model };
    }

    throw new Error("The fixture only creates workflows and their variables.");
  };

  ModelAPI.deleteItem = async (data) => {
    window.__createdRecords.push({
      kind: "deleted",
      id: data.id.toString(),
    });
  };
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
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700"
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

if (fixturePage === "create-workflow") {
  // The project the who-to-page questions pick from (PageScenarios.js).
  installPageProject(params);
  installServerStandIns();
  createRoot(document.getElementById("root")).render(<CreateWorkflowPage />);
} else if (fixturePage === "on-call-logs") {
  installOnCallLogs();
  createRoot(document.getElementById("root")).render(<OnCallLogsPage />);
} else if (fixturePage === "on-call-timeline") {
  installOnCallLogs();
  createRoot(document.getElementById("root")).render(<OnCallTimelinePage />);
} else if (fixturePage === "builder-page") {
  installBuilderPage();
  createRoot(document.getElementById("root")).render(<BuilderPage />);
} else {
  createRoot(document.getElementById("root")).render(<App />);
}

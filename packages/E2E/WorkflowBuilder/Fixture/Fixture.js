/*
 * The real workflow builder canvas: react-flow, the step cards, the Add
 * Component / Add Trigger picker and the step settings dialog, with the real
 * component catalog. Nothing is faked; the page around it is reduced to the
 * one toolbar button the Builder page has for adding a step.
 *
 * ?scenario=graph         a Manual trigger connected to a set-up Log step
 * ?scenario=trigger-only  just a Manual trigger
 * ?scenario=empty         the dashed "choose a trigger" placeholder
 * ?scenario=switch        a Manual trigger, then a Switch / Case on an
 *                         environment: "production" leads to log-1,
 *                         "staging" to log-2 and Default to log-3; log-4 is
 *                         on the canvas, connected to nothing yet
 *
 * ?page=create-workflow   the Workflows page's Create Workflow button and the
 *                         real "Create a workflow" dialog it opens, with the
 *                         real template catalog. Only the server is left out:
 *                         what the dialog would create is kept in
 *                         window.__createdRecords for the spec to read.
 *                         ?failVariables=true makes writing a template's
 *                         settings fail, as a server error would.
 */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import Workflow, {
  getPlaceholderTriggerNode,
} from "Common/UI/Components/Workflow/Workflow";
import { loadComponentsAndCategories } from "Common/UI/Components/Workflow/Utils";
import ObjectID from "Common/Types/ObjectID";
import { NodeType } from "Common/Types/Workflow/Component";
import WorkflowModel from "Common/Models/DatabaseModels/Workflow";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import CreateWorkflowModal from "../../../App/FeatureSet/Dashboard/src/Components/Workflow/CreateWorkflowModal";

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

if (scenario === "empty") {
  initialNodes = [getPlaceholderTriggerNode()];
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

// What the builder hands its page to save, for the spec to read.
window.__savedGraph = { nodes: initialNodes, edges: initialEdges };

function App() {
  const [showPicker, setShowPicker] = useState(false);

  return (
    <div style={{ padding: "16px" }}>
      <div style={{ marginBottom: "12px" }}>
        <button
          type="button"
          data-testid="add-component"
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700"
          onClick={() => {
            setShowPicker(true);
          }}
        >
          Add Component
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
        showRunModal={false}
        onRunModalUpdate={() => {}}
        onRun={() => {}}
        onWorkflowUpdated={(nodes, edges) => {
          window.__savedGraph = { nodes: nodes, edges: edges };
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
  installServerStandIns();
  createRoot(document.getElementById("root")).render(<CreateWorkflowPage />);
} else {
  createRoot(document.getElementById("root")).render(<App />);
}

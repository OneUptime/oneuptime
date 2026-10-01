/*
 * The real workflow builder canvas: react-flow, the step cards, the Add
 * Component / Add Trigger picker and the step settings dialog, with the real
 * component catalog. Nothing is faked; the page around it is reduced to the
 * one toolbar button the Builder page has for adding a step.
 *
 * ?scenario=graph         a Manual trigger connected to a set-up Log step
 * ?scenario=trigger-only  just a Manual trigger
 * ?scenario=empty         the dashed "choose a trigger" placeholder
 */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import Workflow, {
  getPlaceholderTriggerNode,
} from "Common/UI/Components/Workflow/Workflow";
import { loadComponentsAndCategories } from "Common/UI/Components/Workflow/Utils";
import ObjectID from "Common/Types/ObjectID";
import { NodeType } from "Common/Types/Workflow/Component";

const scenario =
  new URLSearchParams(window.location.search).get("scenario") || "graph";

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

if (scenario === "empty") {
  initialNodes = [getPlaceholderTriggerNode()];
} else if (scenario === "trigger-only") {
  initialNodes = [step("manual", 1, 160, 64)];
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

createRoot(document.getElementById("root")).render(<App />);

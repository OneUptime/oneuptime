import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import "Common/UI/Styles/Theme.css";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Components from "Common/Types/Workflow/Components";
import ComponentID from "Common/Types/Workflow/ComponentID";
import { NodeType } from "Common/Types/Workflow/Component";
import Workflow from "Common/UI/Components/Workflow/Workflow";
import ValueTextField from "Common/UI/Components/Workflow/ValuePicker/ValueTextField";
import { ValuePickerProvider } from "Common/UI/Components/Workflow/ValuePicker/ValuePickerContext";
import { ValueSuggestionGroupKind } from "Common/UI/Components/Workflow/ValuePicker/ValueSuggestion";

await i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
});

const params = new URLSearchParams(window.location.search);

if (params.get("theme") === "dark") {
  document.documentElement.classList.add("dark");
}

const WORKFLOW_ID = new ObjectID("b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a");

export const BODY = "{{local.components.webhook-1.returnValues.request-body}}";
export const DEPLOY_ENV = "{{local.variables.DEPLOY_ENV}}";

/*
 * The picker's two requests, answered here: the workflow's variables (one
 * of its own, one global), and an empty model schema.
 */
ModelAPI.getList = async (args) => {
  if (args.modelType === WorkflowVariable) {
    const own = new WorkflowVariable();
    own.name = "DEPLOY_ENV";
    own.description = "staging or production";
    own.workflowId = WORKFLOW_ID;

    const global = new WorkflowVariable();
    global.name = "API_KEY";
    global.isSecret = true;

    return { data: [own, global], count: 2, skip: 0, limit: 100 };
  }

  return { data: [], count: 0, skip: 0, limit: 100 };
};

API.get = async () => {
  return new HTTPResponse(200, { columns: [] }, {});
};

function metadataOf(id) {
  return Components.find((component) => {
    return component.id === id;
  });
}

function stepNode(componentId, id, position, args) {
  const metadata = metadataOf(componentId);

  return {
    id: `rf-${id}`,
    type: "node",
    position: position,
    data: {
      id: id,
      error: "",
      nodeType: NodeType.Node,
      metadata: metadata,
      metadataId: metadata.id,
      internalId: `${id}-internal`,
      arguments: args || {},
      returnValues: {},
      componentType: metadata.componentType,
    },
  };
}

function edge(from, fromPort, to) {
  return {
    id: `${from}-${to}`,
    source: `rf-${from}`,
    sourceHandle: fromPort,
    target: `rf-${to}`,
    targetHandle: "in",
  };
}

/*
 * Webhook → HTTP POST → Log → Slack, and a Log nothing is connected to yet.
 */
function BuilderScenario() {
  const [saved, setSaved] = useState("{}");

  const nodes = [
    stepNode(ComponentID.Webhook, "webhook-1", { x: 80, y: 40 }),
    stepNode(
      ComponentID.ApiPost,
      "api-post-1",
      { x: 80, y: 260 },
      {
        url: "https://api.example.com/incidents",
      },
    ),
    stepNode(
      ComponentID.Log,
      "log-1",
      { x: 80, y: 480 },
      {
        value: `Body: ${BODY}`,
      },
    ),
    stepNode(ComponentID.SlackSendMessageToChannel, "slack-1", {
      x: 80,
      y: 700,
    }),
    stepNode(ComponentID.Log, "loose-1", { x: 520, y: 480 }),
  ];

  const edges = [
    edge("webhook-1", "out", "api-post-1"),
    edge("api-post-1", "success", "log-1"),
    edge("log-1", "out", "slack-1"),
  ];

  return (
    <div className="p-4">
      <Workflow
        initialNodes={nodes}
        initialEdges={edges}
        workflowId={WORKFLOW_ID}
        showComponentsPickerModal={false}
        showRunModal={false}
        onComponentPickerModalUpdate={() => {}}
        onRunModalUpdate={() => {}}
        onRun={() => {}}
        onWorkflowUpdated={(updatedNodes) => {
          const argumentsById = {};

          for (const node of updatedNodes) {
            if (node.data && node.data.id) {
              argumentsById[node.data.id] = node.data.arguments || {};
            }
          }

          setSaved(JSON.stringify(argumentsById));
        }}
      />
      <textarea hidden readOnly data-testid="saved-arguments" value={saved} />
    </div>
  );
}

const FIELD_GROUPS = [
  {
    id: "step:webhook-1",
    kind: ValueSuggestionGroupKind.Step,
    title: "Webhook",
    subtitle: "webhook-1",
    iconProp: IconProp.Bolt,
    order: 0,
    items: [
      {
        reference: BODY,
        label: "Request Body",
        description: "What the request sent.",
        typeLabel: "JSON",
        drillIn: {
          wholeValueLabel: "The whole Request Body",
          allowsPath: true,
          pathPlaceholder: "e.g. title or items[0].name",
        },
      },
    ],
  },
  {
    id: "variables:workflow",
    kind: ValueSuggestionGroupKind.WorkflowVariables,
    title: "Workflow variables",
    iconProp: IconProp.Variable,
    order: 1000,
    items: [{ reference: DEPLOY_ENV, label: "DEPLOY_ENV" }],
  },
];

const FIELD_SOURCES = [
  {
    id: "fixture",
    getGroups: () => {
      return FIELD_GROUPS;
    },
  },
];

function Field(props) {
  const [value, setValue] = useState(props.initial || "");

  return (
    <section
      data-testid={props.testId}
      className="space-y-2 rounded-xl border border-gray-200 bg-white p-5"
    >
      <label
        id={`${props.testId}-label`}
        className="block text-sm font-medium text-gray-700"
      >
        {props.title}
      </label>
      <ValueTextField
        value={value}
        multiline={Boolean(props.multiline)}
        ariaLabelledby={`${props.testId}-label`}
        dataTestId={`${props.testId}-field`}
        placeholder={props.placeholder}
        onChange={setValue}
      />
      <textarea
        hidden
        readOnly
        data-testid={`${props.testId}-value`}
        value={value}
      />
    </section>
  );
}

// The webhook the fields' references read from, for the chips' names.
const FIELD_GRAPH = [
  stepNode(ComponentID.Webhook, "webhook-1", { x: 0, y: 0 }).data,
];

function FieldsScenario() {
  return (
    <ValuePickerProvider graphComponents={FIELD_GRAPH} sources={FIELD_SOURCES}>
      <main className="mx-auto max-w-2xl space-y-4 p-6">
        <Field
          testId="message"
          title="Message"
          multiline={true}
          initial={`Body: ${BODY} end`}
        />
        <Field testId="subject" title="Subject" placeholder="A short line" />
        <Field
          testId="leading"
          title="Starts with a value"
          initial={`${DEPLOY_ENV} tail`}
        />
        <Field
          testId="trailing"
          title="Ends with a value"
          initial={`Env: ${DEPLOY_ENV}`}
        />
        <Field
          testId="broken"
          title="Reads a step that is not there"
          initial="{{local.components.gone-1.returnValues.body}}"
        />
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <label
            htmlFor="scratch"
            className="block text-sm font-medium text-gray-700"
          >
            Somewhere else to paste
          </label>
          <textarea
            id="scratch"
            data-testid="scratch"
            className="mt-2 block w-full rounded-md border border-gray-300 p-2 text-sm"
          />
        </section>
      </main>
    </ValuePickerProvider>
  );
}

const root = createRoot(document.getElementById("root"));

root.render(
  params.get("scenario") === "fields" ? (
    <FieldsScenario />
  ) : (
    <BuilderScenario />
  ),
);

import { JSONObject, JSONValue } from "../JSON";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  NodeDataProp,
  NodeType,
  Port,
  ComponentType,
} from "./Component";
import { getComponentOutPorts } from "./ComponentOutPorts";
import {
  TEMPLATE_ROW_HEIGHT,
  TEMPLATE_START,
  TemplateCardShape,
  getTemplateCardShape,
} from "./TemplateLayout";

/*
 * A WORKFLOW AS A LIST OF STEPS AND WHAT CONNECTS THEM.
 *
 * https://github.com/OneUptime/oneuptime/issues/5945 - someone describes a
 * workflow to Ask AI, and Ask AI builds it and changes it. A stored graph is
 * what a canvas needs: node and edge ids, positions, what each card has drawn.
 * None of that is the workflow, and asking a model to write it is asking for it
 * to be wrong in ways nobody sees until the workflow does not fire. So what is
 * written is a draft: each step by an id of its own and the component it is,
 * with its settings, and each connection by the steps it joins. The graph is
 * built from it, in the shape the Builder saves and the JSON import reads.
 *
 * What a draft has wrong in itself - a component that does not exist, a
 * connection from an output a step does not have - is refused with what to do
 * instead (checkWorkflowDraft), since a graph with those in it cannot run. What
 * it only leaves unfinished, such as a webhook URL to fill in, is what the
 * Builder's own checks say afterwards: it is off, and it is a person's to finish.
 *
 * A secret never travels in a draft of an existing workflow: a saved password
 * setting reads as HIDDEN_SECRET_VALUE, and that written back keeps what is saved,
 * as does a value the model only ever saw with something redacted out of it.
 *
 * Pure, with no database or React imports.
 */

export interface WorkflowDraftStep {
  // How later steps refer to it: {{local.components.<id>.returnValues.<value>}}.
  id: string;
  componentId: string;
  // Left out of a step that already exists, its settings stay as they are.
  arguments?: JSONObject | undefined;
}

export interface WorkflowDraftConnection {
  from: string;
  to: string;
  // Which of the step's outputs it leaves by: success, error, yes, no, ...
  fromOutput?: string | undefined;
}

export interface WorkflowDraft {
  steps: Array<WorkflowDraftStep>;
  connections: Array<WorkflowDraftConnection>;
}

export type GetWorkflowComponentFunction = (
  componentId: string,
) => ComponentMetadata | undefined;

// What a saved secret reads as, and what keeps it when written back.
export const HIDDEN_SECRET_VALUE: string = "[hidden]";

/*
 * What a value looks like once what goes to a model has had its secrets taken
 * out: "[redacted-ip]" (Server/Utils/AI/Toolbox/Serializer). Written back, it
 * would replace a real address with those words.
 */
const REDACTED_VALUE_MARK: string = "[redacted";

type IsReadBackHiddenFunction = (value: JSONValue) => boolean;

// Whether a setting's value still reads as it was hidden, rather than as a value.
const isReadBackHidden: IsReadBackHiddenFunction = (
  value: JSONValue,
): boolean => {
  const text: string =
    typeof value === "string" ? value : JSON.stringify(value);

  return (
    value === HIDDEN_SECRET_VALUE ||
    (typeof text === "string" && text.includes(REDACTED_VALUE_MARK))
  );
};

// Steps are referred to as {{local.components.<id>...}}, split on its dots.
const STEP_ID_PATTERN: RegExp = /^[A-Za-z0-9_-]+$/;

const MAX_DRAFT_STEPS: number = 100;

// A setting the Builder stores as the JSON text of an editor.
const JSON_TEXT_INPUT_TYPES: ReadonlyArray<ComponentInputType> = [
  ComponentInputType.JSON,
  ComponentInputType.Query,
  ComponentInputType.Select,
  ComponentInputType.JSONArray,
  ComponentInputType.BaseModel,
  ComponentInputType.BaseModelArray,
];

const GAP_BETWEEN_CARDS: number = 40;

type IsPlainObjectFunction = (value: unknown) => value is JSONObject;

const isPlainObject: IsPlainObjectFunction = (
  value: unknown,
): value is JSONObject => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

type ReadTextFunction = (value: unknown) => string;

const readText: ReadTextFunction = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : "";
};

type ReadWorkflowDraftFunction = (args: JSONObject) => WorkflowDraft;

/*
 * A draft from what a tool was called with, which is not to be trusted to have
 * any shape: what is not an object is dropped here, and what is missing from one
 * is for checkWorkflowDraft to say.
 */
export const readWorkflowDraft: ReadWorkflowDraftFunction = (
  args: JSONObject,
): WorkflowDraft => {
  const steps: unknown = args["steps"];
  const connections: unknown = args["connections"];

  return {
    steps: (Array.isArray(steps) ? steps : [])
      .filter(isPlainObject)
      .map((step: JSONObject): WorkflowDraftStep => {
        return {
          id: readText(step["id"]),
          componentId: readText(step["componentId"]),
          ...(isPlainObject(step["arguments"])
            ? { arguments: step["arguments"] }
            : {}),
        };
      }),
    connections: (Array.isArray(connections) ? connections : [])
      .filter(isPlainObject)
      .map((connection: JSONObject): WorkflowDraftConnection => {
        const fromOutput: string = readText(connection["fromOutput"]);

        return {
          from: readText(connection["from"]),
          to: readText(connection["to"]),
          ...(fromOutput ? { fromOutput: fromOutput } : {}),
        };
      }),
  };
};

type StepOutputsFunction = (
  component: ComponentMetadata,
  step: WorkflowDraftStep,
) => Array<Port>;

// A step's outputs, by its settings: a Switch / Case has one per case.
const getStepOutputs: StepOutputsFunction = (
  component: ComponentMetadata,
  step: WorkflowDraftStep,
): Array<Port> => {
  return getComponentOutPorts({
    metadata: component,
    arguments: step.arguments || {},
  });
};

type GetConnectionOutputFunction = (data: {
  connection: WorkflowDraftConnection;
  outputs: Array<Port>;
}) => string | null;

/*
 * The output a connection leaves by: the one it names, or - naming none - the
 * only one a step has, or Success. A step that branches has to be told, since
 * which way a run goes is the point of it.
 */
const getConnectionOutput: GetConnectionOutputFunction = (data: {
  connection: WorkflowDraftConnection;
  outputs: Array<Port>;
}): string | null => {
  if (data.connection.fromOutput) {
    return data.connection.fromOutput;
  }

  if (data.outputs.length === 1) {
    return data.outputs[0]!.id;
  }

  return (
    data.outputs.find((port: Port): boolean => {
      return port.id === "success";
    })?.id || null
  );
};

type NamesOfFunction = (items: Array<{ id: string }>) => string;

const namesOf: NamesOfFunction = (items: Array<{ id: string }>): string => {
  return items
    .map((item: { id: string }): string => {
      return item.id;
    })
    .join(", ");
};

type CheckWorkflowDraftFunction = (data: {
  draft: WorkflowDraft;
  getComponent: GetWorkflowComponentFunction;
}) => Array<string>;

/*
 * What is wrong with a draft, in words that say what to do instead: the graph
 * cannot be built from it until each is fixed. Empty when it can.
 */
export const checkWorkflowDraft: CheckWorkflowDraftFunction = (data: {
  draft: WorkflowDraft;
  getComponent: GetWorkflowComponentFunction;
}): Array<string> => {
  const problems: Array<string> = [];
  const steps: Array<WorkflowDraftStep> = data.draft.steps;

  if (steps.length === 0) {
    return [
      "A workflow needs a trigger and at least one step: steps is empty.",
    ];
  }

  if (steps.length > MAX_DRAFT_STEPS) {
    return [
      `This draft has ${steps.length} steps. A workflow here can have ${MAX_DRAFT_STEPS} at most.`,
    ];
  }

  const stepsById: Map<string, WorkflowDraftStep> = new Map<
    string,
    WorkflowDraftStep
  >();
  const componentsByStepId: Map<string, ComponentMetadata> = new Map<
    string,
    ComponentMetadata
  >();
  let triggers: number = 0;

  for (const step of steps) {
    if (!STEP_ID_PATTERN.test(step.id)) {
      problems.push(
        `A step's id can only have letters, numbers, - and _, and "${step.id}" does not. A later step's reference reads it, so a dot would break that.`,
      );
      continue;
    }

    if (stepsById.has(step.id)) {
      problems.push(`Two steps have the id "${step.id}". Give each its own.`);
      continue;
    }

    stepsById.set(step.id, step);

    const component: ComponentMetadata | undefined = data.getComponent(
      step.componentId,
    );

    if (!component) {
      problems.push(
        `Step "${step.id}": there is no component "${step.componentId}". Find one with find_workflow_components.`,
      );
      continue;
    }

    componentsByStepId.set(step.id, component);

    if (component.componentType === ComponentType.Trigger) {
      triggers++;
    }

    const known: Array<Argument> = component.arguments || [];

    for (const argumentId of Object.keys(step.arguments || {})) {
      if (
        !known.some((argument: Argument): boolean => {
          return argument.id === argumentId;
        })
      ) {
        problems.push(
          `Step "${step.id}": ${component.title} has no setting "${argumentId}". Its settings are: ${namesOf(known) || "none"}.`,
        );
      }
    }
  }

  if (triggers === 0 && componentsByStepId.size === stepsById.size) {
    problems.push(
      "A workflow starts from a trigger, and no step here is one. Find one with find_workflow_components.",
    );
  }

  if (triggers > 1) {
    problems.push(
      `A workflow has one trigger, and this one has ${triggers}. Make a second workflow for the other trigger.`,
    );
  }

  for (const connection of data.draft.connections) {
    const from: WorkflowDraftStep | undefined = stepsById.get(connection.from);
    const to: WorkflowDraftStep | undefined = stepsById.get(connection.to);

    if (!from || !to) {
      problems.push(
        `A connection from "${connection.from}" to "${connection.to}" names a step this draft does not have.`,
      );
      continue;
    }

    const toComponent: ComponentMetadata | undefined = componentsByStepId.get(
      to.id,
    );

    if (toComponent?.componentType === ComponentType.Trigger) {
      problems.push(
        `A connection leads into "${to.id}", which is the trigger. A run starts from a trigger, so nothing leads into one.`,
      );
    }

    const fromComponent: ComponentMetadata | undefined = componentsByStepId.get(
      from.id,
    );

    if (!fromComponent) {
      continue;
    }

    const outputs: Array<Port> = getStepOutputs(fromComponent, from);
    const output: string | null = getConnectionOutput({
      connection: connection,
      outputs: outputs,
    });

    if (!output) {
      problems.push(
        `A connection from "${from.id}" has to say which output it leaves by: ${namesOf(outputs)}.`,
      );
    } else if (
      !outputs.some((port: Port): boolean => {
        return port.id === output;
      })
    ) {
      problems.push(
        `"${from.id}" has no output "${output}". It has: ${namesOf(outputs) || "none"}.`,
      );
    }
  }

  return problems;
};

interface GraphNode {
  id: string;
  type?: string | undefined;
  position?: { x: number; y: number } | undefined;
  data: NodeDataProp;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null | undefined;
  targetHandle?: string | null | undefined;
}

type ReadGraphNodesFunction = (
  graph: JSONObject | null | undefined,
) => Array<GraphNode>;

// The steps of a stored graph, without what only stands in for a trigger.
const readGraphNodes: ReadGraphNodesFunction = (
  graph: JSONObject | null | undefined,
): Array<GraphNode> => {
  const nodes: unknown = graph?.["nodes"];

  return (Array.isArray(nodes) ? (nodes as Array<GraphNode>) : []).filter(
    (node: GraphNode): boolean => {
      return (
        Boolean(node?.data?.id) &&
        node.data.nodeType !== NodeType.PlaceholderNode
      );
    },
  );
};

type ReadGraphEdgesFunction = (
  graph: JSONObject | null | undefined,
) => Array<GraphEdge>;

const readGraphEdges: ReadGraphEdgesFunction = (
  graph: JSONObject | null | undefined,
): Array<GraphEdge> => {
  const edges: unknown = graph?.["edges"];

  return Array.isArray(edges) ? (edges as Array<GraphEdge>) : [];
};

type IsSecretArgumentFunction = (argument: Argument) => boolean;

const isSecretArgument: IsSecretArgumentFunction = (
  argument: Argument,
): boolean => {
  return argument.type === ComponentInputType.Password;
};

type GetDraftFromGraphFunction = (data: {
  graph: JSONObject | null | undefined;
  getComponent: GetWorkflowComponentFunction;
}) => WorkflowDraft;

// A stored graph as a draft: what is read to change it, with no saved secret in it.
export const getDraftFromGraph: GetDraftFromGraphFunction = (data: {
  graph: JSONObject | null | undefined;
  getComponent: GetWorkflowComponentFunction;
}): WorkflowDraft => {
  const nodes: Array<GraphNode> = readGraphNodes(data.graph);

  const steps: Array<WorkflowDraftStep> = nodes.map(
    (node: GraphNode): WorkflowDraftStep => {
      const component: ComponentMetadata | undefined = data.getComponent(
        node.data.metadataId,
      );
      const stored: JSONObject = (node.data.arguments || {}) as JSONObject;
      const shown: JSONObject = {};

      for (const argumentId of Object.keys(stored)) {
        const argument: Argument | undefined = component?.arguments?.find(
          (candidate: Argument): boolean => {
            return candidate.id === argumentId;
          },
        );

        shown[argumentId] =
          argument && isSecretArgument(argument) && stored[argumentId]
            ? HIDDEN_SECRET_VALUE
            : (stored[argumentId] as JSONValue);
      }

      return {
        id: node.data.id,
        componentId: node.data.metadataId,
        arguments: shown,
      };
    },
  );

  const stepIdByNodeId: Map<string, string> = new Map<string, string>(
    nodes.map((node: GraphNode): [string, string] => {
      return [node.id, node.data.id];
    }),
  );

  const connections: Array<WorkflowDraftConnection> = [];

  for (const edge of readGraphEdges(data.graph)) {
    const from: string | undefined = stepIdByNodeId.get(edge.source);
    const to: string | undefined = stepIdByNodeId.get(edge.target);

    if (from && to) {
      connections.push({
        from: from,
        to: to,
        ...(edge.sourceHandle ? { fromOutput: edge.sourceHandle } : {}),
      });
    }
  }

  return { steps: steps, connections: connections };
};

type StoredArgumentsFunction = (data: {
  step: WorkflowDraftStep;
  component: ComponentMetadata;
  existing: GraphNode | undefined;
}) => JSONObject;

/*
 * A step's settings as the Builder stores them: what is JSON as its editor's
 * text, and a saved secret that was read back hidden as what is saved.
 */
const getStoredArguments: StoredArgumentsFunction = (data: {
  step: WorkflowDraftStep;
  component: ComponentMetadata;
  existing: GraphNode | undefined;
}): JSONObject => {
  const saved: JSONObject = (data.existing?.data.arguments || {}) as JSONObject;

  if (!data.step.arguments) {
    return JSON.parse(JSON.stringify(saved)) as JSONObject;
  }

  const stored: JSONObject = {};

  for (const argumentId of Object.keys(data.step.arguments)) {
    const value: JSONValue = data.step.arguments[argumentId] as JSONValue;

    if (isReadBackHidden(value)) {
      if (saved[argumentId] !== undefined) {
        stored[argumentId] = saved[argumentId] as JSONValue;
      }
      continue;
    }

    const argument: Argument | undefined = (
      data.component.arguments || []
    ).find((candidate: Argument): boolean => {
      return candidate.id === argumentId;
    });

    stored[argumentId] =
      argument &&
      JSON_TEXT_INPUT_TYPES.includes(argument.type) &&
      value !== null &&
      typeof value === "object"
        ? JSON.stringify(value)
        : value;
  }

  return stored;
};

type LayOutStepsFunction = (data: {
  draft: WorkflowDraft;
  outputsByConnection: Map<WorkflowDraftConnection, string>;
  placed: Map<string, { x: number; y: number }>;
  metadataIdByStepId: Map<string, string>;
  triggerStepId: string | undefined;
}) => void;

/*
 * Where the steps with no place yet go: from the trigger down, each under the
 * output that leads to it, as a template's are (TemplateLayout), moved along its
 * row when another card is there. A step nothing leads to goes under them all,
 * where it can be seen and connected.
 */
const layOutSteps: LayOutStepsFunction = (data: {
  draft: WorkflowDraft;
  outputsByConnection: Map<WorkflowDraftConnection, string>;
  placed: Map<string, { x: number; y: number }>;
  metadataIdByStepId: Map<string, string>;
  triggerStepId: string | undefined;
}): void => {
  type WidthOfFunction = (stepId: string) => number;

  const widthOf: WidthOfFunction = (stepId: string): number => {
    return getTemplateCardShape(data.metadataIdByStepId.get(stepId) || "")
      .width;
  };

  type InTheWayFunction = (at: {
    stepId: string;
    x: number;
    y: number;
  }) => string | undefined;

  // The card already on that row that a card at x would run into.
  const inTheWayOf: InTheWayFunction = (at: {
    stepId: string;
    x: number;
    y: number;
  }): string | undefined => {
    const width: number = widthOf(at.stepId);

    return Array.from(data.placed.keys()).find((other: string): boolean => {
      const place: { x: number; y: number } = data.placed.get(other)!;

      return (
        place.y === at.y &&
        at.x < place.x + widthOf(other) + GAP_BETWEEN_CARDS &&
        place.x < at.x + width + GAP_BETWEEN_CARDS
      );
    });
  };

  type FreeXFunction = (stepId: string, x: number, y: number) => number;

  const freeX: FreeXFunction = (
    stepId: string,
    x: number,
    y: number,
  ): number => {
    let free: number = x;
    let other: string | undefined = inTheWayOf({
      stepId: stepId,
      x: free,
      y: y,
    });

    while (other) {
      free = data.placed.get(other)!.x + widthOf(other) + GAP_BETWEEN_CARDS;
      other = inTheWayOf({ stepId: stepId, x: free, y: y });
    }

    return free;
  };

  if (data.triggerStepId && !data.placed.has(data.triggerStepId)) {
    data.placed.set(data.triggerStepId, {
      x: TEMPLATE_START.x,
      y: TEMPLATE_START.y,
    });
  }

  const queue: Array<string> = data.draft.steps
    .filter((step: WorkflowDraftStep): boolean => {
      return data.placed.has(step.id);
    })
    .map((step: WorkflowDraftStep): string => {
      return step.id;
    });
  const seen: Set<string> = new Set<string>(queue);

  while (queue.length > 0) {
    const stepId: string = queue.shift() as string;
    const place: { x: number; y: number } = data.placed.get(stepId)!;
    const shape: TemplateCardShape = getTemplateCardShape(
      data.metadataIdByStepId.get(stepId) || "",
    );

    for (const connection of data.draft.connections) {
      if (connection.from !== stepId) {
        continue;
      }

      if (!data.placed.has(connection.to)) {
        const output: string = data.outputsByConnection.get(connection) || "";
        const dot: number = shape.dotX[output] ?? shape.width / 2;
        const y: number = place.y + TEMPLATE_ROW_HEIGHT;

        data.placed.set(connection.to, {
          x: freeX(
            connection.to,
            Math.round(place.x + dot - widthOf(connection.to) / 2),
            y,
          ),
          y: y,
        });
      }

      if (!seen.has(connection.to)) {
        seen.add(connection.to);
        queue.push(connection.to);
      }
    }
  }

  for (const step of data.draft.steps) {
    if (!data.placed.has(step.id)) {
      const lowest: number = Math.max(
        TEMPLATE_START.y - TEMPLATE_ROW_HEIGHT,
        ...Array.from(data.placed.values()).map(
          (place: { x: number; y: number }): number => {
            return place.y;
          },
        ),
      );

      data.placed.set(step.id, {
        x: TEMPLATE_START.x,
        y: lowest + TEMPLATE_ROW_HEIGHT,
      });
    }
  }
};

type BuildGraphFromDraftFunction = (data: {
  draft: WorkflowDraft;
  getComponent: GetWorkflowComponentFunction;
  generateId: () => string;
  // What is being changed. A step that stays keeps its place on the canvas.
  existingGraph?: JSONObject | null | undefined;
}) => JSONObject;

/*
 * The graph of a draft that has passed checkWorkflowDraft, in the shape the
 * Builder saves. A step of the existing graph with the same id and component
 * keeps what the canvas knows it by; every other is new.
 */
export const buildGraphFromDraft: BuildGraphFromDraftFunction = (data: {
  draft: WorkflowDraft;
  getComponent: GetWorkflowComponentFunction;
  generateId: () => string;
  existingGraph?: JSONObject | null | undefined;
}): JSONObject => {
  const existingNodes: Array<GraphNode> = readGraphNodes(data.existingGraph);
  const existingEdges: Array<GraphEdge> = readGraphEdges(data.existingGraph);

  const existingByStepId: Map<string, GraphNode> = new Map<string, GraphNode>();

  for (const node of existingNodes) {
    existingByStepId.set(node.data.id, node);
  }

  type ExistingOfFunction = (step: WorkflowDraftStep) => GraphNode | undefined;

  const existingOf: ExistingOfFunction = (
    step: WorkflowDraftStep,
  ): GraphNode | undefined => {
    const existing: GraphNode | undefined = existingByStepId.get(step.id);

    return existing?.data.metadataId === step.componentId
      ? existing
      : undefined;
  };

  const placed: Map<string, { x: number; y: number }> = new Map<
    string,
    { x: number; y: number }
  >();
  const metadataIdByStepId: Map<string, string> = new Map<string, string>();
  let triggerStepId: string | undefined = undefined;

  for (const step of data.draft.steps) {
    metadataIdByStepId.set(step.id, step.componentId);

    const component: ComponentMetadata | undefined = data.getComponent(
      step.componentId,
    );

    if (component?.componentType === ComponentType.Trigger) {
      triggerStepId = step.id;
    }

    const position: { x: number; y: number } | undefined =
      existingOf(step)?.position;

    if (position) {
      placed.set(step.id, position);
    }
  }

  const outputsByConnection: Map<WorkflowDraftConnection, string> = new Map<
    WorkflowDraftConnection,
    string
  >();

  for (const connection of data.draft.connections) {
    const from: WorkflowDraftStep | undefined = data.draft.steps.find(
      (step: WorkflowDraftStep): boolean => {
        return step.id === connection.from;
      },
    );
    const component: ComponentMetadata | undefined = from
      ? data.getComponent(from.componentId)
      : undefined;

    if (from && component) {
      outputsByConnection.set(
        connection,
        getConnectionOutput({
          connection: connection,
          outputs: getStepOutputs(component, from),
        }) || "",
      );
    }
  }

  layOutSteps({
    draft: data.draft,
    outputsByConnection: outputsByConnection,
    placed: placed,
    metadataIdByStepId: metadataIdByStepId,
    triggerStepId: triggerStepId,
  });

  const nodeIdByStepId: Map<string, string> = new Map<string, string>();

  const nodes: Array<JSONObject> = [];

  for (const step of data.draft.steps) {
    const component: ComponentMetadata = data.getComponent(
      step.componentId,
    ) as ComponentMetadata;
    const existing: GraphNode | undefined = existingOf(step);
    const nodeId: string = existing?.id || data.generateId();

    nodeIdByStepId.set(step.id, nodeId);

    nodes.push({
      id: nodeId,
      type: "node",
      position: placed.get(step.id) as unknown as JSONObject,
      data: {
        id: step.id,
        nodeType: NodeType.Node,
        componentType: component.componentType,
        metadataId: step.componentId,
        internalId: existing?.data.internalId || data.generateId(),
        error: "",
        arguments: getStoredArguments({
          step: step,
          component: component,
          existing: existing,
        }),
        returnValues: {},
      },
    });
  }

  const seen: Set<string> = new Set<string>();
  const edges: Array<JSONObject> = [];

  for (const connection of data.draft.connections) {
    const source: string | undefined = nodeIdByStepId.get(connection.from);
    const target: string | undefined = nodeIdByStepId.get(connection.to);
    const sourceHandle: string = outputsByConnection.get(connection) || "";
    const key: string = JSON.stringify([source, sourceHandle, target]);

    if (!source || !target || seen.has(key)) {
      continue;
    }

    seen.add(key);

    edges.push({
      id:
        existingEdges.find((edge: GraphEdge): boolean => {
          return (
            edge.source === source &&
            edge.target === target &&
            edge.sourceHandle === sourceHandle
          );
        })?.id || data.generateId(),
      source: source,
      target: target,
      sourceHandle: sourceHandle,
      targetHandle: "in",
    });
  }

  return { nodes: nodes, edges: edges };
};

export interface WorkflowDraftChanges {
  added: Array<string>;
  removed: Array<string>;
  changed: Array<string>;
}

type GetDraftValueKeyFunction = (value: unknown) => string;

/*
 * Settings as text that is the same for two that say the same thing,
 * whichever order they are written in, and whether the JSON of an editor is
 * kept as its text or as the value: what the approval card calls a change
 * (describeDraftChanges), and what tells whether a step changed after a
 * change to it was proposed (WorkflowDraftRebase).
 */
export const getDraftValueKey: GetDraftValueKeyFunction = (
  value: unknown,
): string => {
  if (typeof value === "string") {
    try {
      return getDraftValueKey(JSON.parse(value));
    } catch {
      return JSON.stringify(value);
    }
  }

  if (Array.isArray(value)) {
    return `[${value.map(getDraftValueKey).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value as JSONObject)
      .sort()
      .map((key: string): string => {
        return `${JSON.stringify(key)}:${getDraftValueKey((value as JSONObject)[key])}`;
      })
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

type DescribeDraftChangesFunction = (data: {
  before: WorkflowDraft;
  after: WorkflowDraft;
  titleOf: (step: WorkflowDraftStep) => string;
}) => WorkflowDraftChanges;

// What a new draft does to the steps of the one it replaces, by their titles.
export const describeDraftChanges: DescribeDraftChangesFunction = (data: {
  before: WorkflowDraft;
  after: WorkflowDraft;
  titleOf: (step: WorkflowDraftStep) => string;
}): WorkflowDraftChanges => {
  // Settings compared by what they say, whichever order they are written in.
  const canonical: GetDraftValueKeyFunction = getDraftValueKey;

  const beforeById: Map<string, WorkflowDraftStep> = new Map<
    string,
    WorkflowDraftStep
  >(
    data.before.steps.map(
      (step: WorkflowDraftStep): [string, WorkflowDraftStep] => {
        return [step.id, step];
      },
    ),
  );
  const afterIds: Set<string> = new Set<string>(
    data.after.steps.map((step: WorkflowDraftStep): string => {
      return step.id;
    }),
  );

  const changes: WorkflowDraftChanges = { added: [], removed: [], changed: [] };

  for (const step of data.after.steps) {
    const before: WorkflowDraftStep | undefined = beforeById.get(step.id);

    if (!before || before.componentId !== step.componentId) {
      changes.added.push(data.titleOf(step));
    } else if (
      step.arguments &&
      canonical(step.arguments) !== canonical(before.arguments || {})
    ) {
      changes.changed.push(data.titleOf(step));
    }
  }

  for (const step of data.before.steps) {
    if (
      !afterIds.has(step.id) ||
      data.after.steps.find((after: WorkflowDraftStep): boolean => {
        return after.id === step.id;
      })?.componentId !== step.componentId
    ) {
      changes.removed.push(data.titleOf(step));
    }
  }

  return changes;
};

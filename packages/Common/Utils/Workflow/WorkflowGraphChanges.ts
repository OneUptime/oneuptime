import { JSONObject, JSONValue } from "../../Types/JSON";
import ComponentMetadata, {
  Argument,
  NodeType,
  Port,
} from "../../Types/Workflow/Component";
import { getComponentOutPorts } from "../../Types/Workflow/ComponentOutPorts";

/*
 * WHAT CHANGED IN A WORKFLOW, AS A PERSON WOULD SAY IT.
 *
 * A workflow's graph is the whole builder canvas as JSON: every step with its
 * settings, every connection, and everything the canvas draws - where each
 * card sits, which one is selected, how big it measured. The builder saves
 * all of it a second after anything moves, a click on a step included. So
 * two saved graphs can differ without the workflow doing anything new, and
 * when they differ in what it does, the difference is buried in kilobytes
 * of coordinates.
 *
 * This reads two graphs the way the workflow runs them - its steps (which
 * component, under which id, with which settings) and the connections between
 * their outputs and inputs - and says what changed in plain lines:
 *
 *   Added "Send Email" (email-1)
 *   Changed "To" and "Subject" in "Send Email" (email-1)
 *   Connected the "Yes" output of "If / Else" (if-1) to "Send Email" (email-1)
 *
 * Where a card sits, selection, measured sizes and edge styling are not part
 * of what a workflow does, so a save that changes only those changes nothing
 * here. A setting is named, never quoted: its value may be a password, a
 * token or a webhook address typed into the step.
 *
 * The audit log records a workflow's graph this way (AuditLogRecorder). A
 * workflow's version history says what changed between versions with the
 * same lines, and asks for cards moved too (includeMoves): a version puts
 * back where each card sat, so a version that only moved cards says so. The
 * builder's Undo and Redo name what they would undo from the same changes,
 * by kind (`changes`). Pure: no DOM, no server.
 */

// What the lines need of a step's component: its title, settings and outputs.
export type WorkflowComponentLookup = (
  componentId: string,
) => ComponentMetadata | undefined;

export interface WorkflowGraphStep {
  // The canvas node's own id: what a connection names.
  key: string;
  // The id the step is referred to by ({{local.components.email-1...}}).
  stepId: string;
  // Its component (metadataId): "email", "if-else", "monitor-on-create".
  componentId: string;
  arguments: JSONObject;
  // The rest of the step's data, as far as it is part of what the step does.
  otherData: JSONObject;
}

export interface WorkflowGraphConnection {
  from: string;
  fromPort: string;
  to: string;
  toPort: string;
}

export interface WorkflowGraphContent {
  steps: Array<WorkflowGraphStep>;
  connections: Array<WorkflowGraphConnection>;
}

// What kind of change a line says.
export enum WorkflowGraphChangeKind {
  Added = "Added",
  Removed = "Removed",
  Renamed = "Renamed",
  // Another component under the same card: "Replaced "Log" with ...".
  Replaced = "Replaced",
  SettingsChanged = "SettingsChanged",
  // A part of the step other than its settings: "Changed how ... is set up".
  SetUpChanged = "SetUpChanged",
  Connected = "Connected",
  Disconnected = "Disconnected",
  // Only with includeMoves: the cards that moved, in one line.
  Moved = "Moved",
}

// A step a change is about: its canvas key, and how the lines name it.
export interface WorkflowGraphChangedStep {
  key: string;
  label: string;
}

export interface WorkflowGraphChange {
  kind: WorkflowGraphChangeKind;
  line: string;
  /*
   * The steps the line is about: the step added, removed or changed, both
   * ends of a connection (where it leaves first), every card that moved.
   */
  steps: Array<WorkflowGraphChangedStep>;
}

export interface WorkflowGraphChanges {
  // Every change, in plain words, in the order the lines below say.
  lines: Array<string>;
  // How many lines there were before they were cut to the limit.
  totalChanges: number;
  /*
   * Every change, uncut, in the order of the lines: what kind it is and
   * which steps it is about, for a caller that words a change its own way.
   */
  changes: Array<WorkflowGraphChange>;
}

// A summary longer than this ends with "and N more changes".
export const WORKFLOW_GRAPH_CHANGE_LINE_LIMIT: number = 25;

// How many settings a line names before it counts the rest.
const SETTINGS_NAMED_PER_LINE: number = 4;

/*
 * A step's data that is the canvas's, not the step's: what the checks said
 * (error), the component's metadata (dropped on save), the card's handlers,
 * and the values a run returned. Plus the keys read on their own below.
 */
const DATA_KEYS_NOT_COMPARED: ReadonlySet<string> = new Set<string>([
  "error",
  "metadata",
  "onClick",
  "isPreview",
  "returnValues",
  "id",
  "metadataId",
  "internalId",
  "nodeType",
  "componentType",
  "arguments",
]);

const isObject: (value: unknown) => value is JSONObject = (
  value: unknown,
): value is JSONObject => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

const asText: (value: unknown) => string = (value: unknown): string => {
  return typeof value === "string" ? value : "";
};

/*
 * A graph as saved: an object with nodes and edges, or that object as JSON
 * text. Anything else is an empty graph rather than an error - a change is
 * still recorded when a graph cannot be read.
 */
const toGraphObject: (graph: unknown) => JSONObject | null = (
  graph: unknown,
): JSONObject | null => {
  if (typeof graph === "string") {
    try {
      const parsed: unknown = JSON.parse(graph);
      return isObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  return isObject(graph) ? graph : null;
};

// Where a card sits on the canvas.
interface CardPosition {
  x: number;
  y: number;
}

const readCardPosition: (node: JSONObject) => CardPosition | null = (
  node: JSONObject,
): CardPosition | null => {
  const position: unknown = node["position"];

  if (!isObject(position)) {
    return null;
  }

  const x: unknown = position["x"];
  const y: unknown = position["y"];

  return typeof x === "number" &&
    typeof y === "number" &&
    Number.isFinite(x) &&
    Number.isFinite(y)
    ? { x, y }
    : null;
};

/*
 * The steps and connections of a saved graph, and where each step's card
 * sits (for includeMoves). One reading for both, so a card that moved is
 * the step the other lines name.
 */
const readWorkflowGraphAndPositions: (graph: unknown) => {
  content: WorkflowGraphContent;
  positions: Map<string, CardPosition>;
} = (
  graph: unknown,
): {
  content: WorkflowGraphContent;
  positions: Map<string, CardPosition>;
} => {
  const content: WorkflowGraphContent = { steps: [], connections: [] };
  const positions: Map<string, CardPosition> = new Map<string, CardPosition>();
  const graphObject: JSONObject | null = toGraphObject(graph);

  if (!graphObject) {
    return { content, positions };
  }

  const nodes: unknown = graphObject["nodes"];
  const edges: unknown = graphObject["edges"];
  const seen: Set<string> = new Set<string>();

  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!isObject(node)) {
      continue;
    }

    const data: JSONObject = isObject(node["data"]) ? node["data"] : {};

    // The empty slot where a trigger goes is not a step.
    if (data["nodeType"] === NodeType.PlaceholderNode) {
      continue;
    }

    const key: string =
      asText(node["id"]) || asText(data["internalId"]) || asText(data["id"]);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);

    const position: CardPosition | null = readCardPosition(node);

    if (position) {
      positions.set(key, position);
    }

    const otherData: JSONObject = {};

    for (const dataKey of Object.keys(data)) {
      if (!DATA_KEYS_NOT_COMPARED.has(dataKey)) {
        otherData[dataKey] = data[dataKey] as JSONValue;
      }
    }

    content.steps.push({
      key,
      stepId: asText(data["id"]),
      componentId: asText(data["metadataId"]),
      arguments: isObject(data["arguments"]) ? data["arguments"] : {},
      otherData,
    });
  }

  for (const edge of Array.isArray(edges) ? edges : []) {
    if (!isObject(edge)) {
      continue;
    }

    const from: string = asText(edge["source"]);
    const to: string = asText(edge["target"]);

    if (!from || !to) {
      continue;
    }

    content.connections.push({
      from,
      fromPort: asText(edge["sourceHandle"]),
      to,
      toPort: asText(edge["targetHandle"]),
    });
  }

  return { content, positions };
};

// The steps and connections of a saved graph, the way a run reads them.
export const readWorkflowGraph: (graph: unknown) => WorkflowGraphContent = (
  graph: unknown,
): WorkflowGraphContent => {
  return readWorkflowGraphAndPositions(graph).content;
};

/*
 * A value as text that is the same for the same value: object keys in order.
 * Two settings are the same when these are.
 */
const toComparableJson: (value: unknown) => string = (
  value: unknown,
): string => {
  if (value === undefined) {
    return "undefined";
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value
      .map((item: unknown): string => {
        return toComparableJson(item);
      })
      .join(",")}]`;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;

  return `{${Object.keys(record)
    .sort()
    .filter((key: string): boolean => {
      return record[key] !== undefined;
    })
    .map((key: string): string => {
      return `${JSON.stringify(key)}:${toComparableJson(record[key])}`;
    })
    .join(",")}}`;
};

/*
 * An empty setting is not set: a setting the builder writes as "" or null
 * and one it leaves out read alike, as the run reads them.
 */
const isUnset: (value: unknown) => boolean = (value: unknown): boolean => {
  return value === undefined || value === null || value === "";
};

const isSameSetting: (before: unknown, after: unknown) => boolean = (
  before: unknown,
  after: unknown,
): boolean => {
  if (isUnset(before) && isUnset(after)) {
    return true;
  }

  return toComparableJson(before) === toComparableJson(after);
};

const quote: (text: string) => string = (text: string): string => {
  return `"${text}"`;
};

// "A", "A and B", "A, B and C".
const joinWithAnd: (items: Array<string>) => string = (
  items: Array<string>,
): string => {
  if (items.length <= 1) {
    return items[0] || "";
  }

  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
};

class GraphWording {
  private lookup: WorkflowComponentLookup | undefined;

  public constructor(lookup: WorkflowComponentLookup | undefined) {
    this.lookup = lookup;
  }

  public getComponent(componentId: string): ComponentMetadata | undefined {
    if (!componentId || !this.lookup) {
      return undefined;
    }

    try {
      return this.lookup(componentId);
    } catch {
      return undefined;
    }
  }

  // "Send Email" (email-1): the card's title and the id the step goes by.
  public stepLabel(step: WorkflowGraphStep): string {
    const title: string =
      this.getComponent(step.componentId)?.title || step.componentId || "Step";

    return step.stepId ? `${quote(title)} (${step.stepId})` : quote(title);
  }

  public settingName(step: WorkflowGraphStep, argumentId: string): string {
    const argument: Argument | undefined = this.getComponent(
      step.componentId,
    )?.arguments?.find((candidate: Argument): boolean => {
      return candidate.id === argumentId;
    });

    return quote(argument?.name || argumentId);
  }

  /*
   * The output a connection leaves by, when the step has more than one to
   * choose from ("Yes" of an If / Else); null when it has only the one.
   */
  public outputName(step: WorkflowGraphStep, portId: string): string | null {
    const metadata: ComponentMetadata | undefined = this.getComponent(
      step.componentId,
    );

    if (!metadata) {
      return portId ? quote(portId) : null;
    }

    let ports: Array<Port> = [];

    try {
      ports = getComponentOutPorts({
        metadata,
        arguments: step.arguments,
      });
    } catch {
      ports = metadata.outPorts || [];
    }

    if (ports.length <= 1) {
      return null;
    }

    const port: Port | undefined = ports.find((candidate: Port): boolean => {
      return candidate.id === portId;
    });

    return quote(port?.title || portId);
  }
}

const connectionKey: (connection: WorkflowGraphConnection) => string = (
  connection: WorkflowGraphConnection,
): string => {
  return [
    connection.from,
    connection.fromPort,
    connection.to,
    connection.toPort,
  ].join("\u0000");
};

interface DescribedConnection {
  text: string;
  from: WorkflowGraphStep;
  to: WorkflowGraphStep;
}

const describeConnection: (data: {
  wording: GraphWording;
  connection: WorkflowGraphConnection;
  steps: Map<string, WorkflowGraphStep>;
}) => DescribedConnection | null = (data: {
  wording: GraphWording;
  connection: WorkflowGraphConnection;
  steps: Map<string, WorkflowGraphStep>;
}): DescribedConnection | null => {
  const from: WorkflowGraphStep | undefined = data.steps.get(
    data.connection.from,
  );
  const to: WorkflowGraphStep | undefined = data.steps.get(data.connection.to);

  // A connection to nothing draws nothing and runs nothing.
  if (!from || !to) {
    return null;
  }

  const output: string | null = data.wording.outputName(
    from,
    data.connection.fromPort,
  );
  const fromLabel: string = data.wording.stepLabel(from);

  return {
    text: output
      ? `the ${output} output of ${fromLabel} to ${data.wording.stepLabel(to)}`
      : `${fromLabel} to ${data.wording.stepLabel(to)}`,
    from,
    to,
  };
};

const byText: (a: string, b: string) => number = (
  a: string,
  b: string,
): number => {
  return a.localeCompare(b);
};

const byLine: (a: WorkflowGraphChange, b: WorkflowGraphChange) => number = (
  a: WorkflowGraphChange,
  b: WorkflowGraphChange,
): number => {
  return byText(a.line, b.line);
};

const isSamePosition: (
  first: CardPosition | undefined,
  second: CardPosition | undefined,
) => boolean = (
  first: CardPosition | undefined,
  second: CardPosition | undefined,
): boolean => {
  // A card with no position read on either side is not said to have moved.
  if (!first || !second) {
    return true;
  }

  return first.x === second.x && first.y === second.y;
};

// How many moved cards a line names before it counts them instead.
const MOVED_CARDS_NAMED_PER_LINE: number = 2;

/*
 * What changed from one saved graph to the next, in plain lines: steps added
 * and removed, renamed, reconfigured (by the names of the settings that
 * changed), and connections made and removed. No lines when the two do the
 * same thing - a card moved or selected, a graph saved again.
 *
 * With includeMoves, the cards that moved are one more line, last: "Moved
 * "Log" (log-1)", "Moved "Log" (log-1) and "Webhook" (webhook-1)", "Moved 4
 * steps". For a version history, whose versions put each card back where it
 * sat; the audit log, which records what a workflow does, leaves it out.
 */
export const getWorkflowGraphChanges: (data: {
  before: unknown;
  after: unknown;
  lookup?: WorkflowComponentLookup | undefined;
  lineLimit?: number | undefined;
  includeMoves?: boolean | undefined;
}) => WorkflowGraphChanges = (data: {
  before: unknown;
  after: unknown;
  lookup?: WorkflowComponentLookup | undefined;
  lineLimit?: number | undefined;
  includeMoves?: boolean | undefined;
}): WorkflowGraphChanges => {
  const wording: GraphWording = new GraphWording(data.lookup);
  const readBefore: {
    content: WorkflowGraphContent;
    positions: Map<string, CardPosition>;
  } = readWorkflowGraphAndPositions(data.before);
  const readAfter: {
    content: WorkflowGraphContent;
    positions: Map<string, CardPosition>;
  } = readWorkflowGraphAndPositions(data.after);
  const before: WorkflowGraphContent = readBefore.content;
  const after: WorkflowGraphContent = readAfter.content;

  const stepsBefore: Map<string, WorkflowGraphStep> = new Map(
    before.steps.map((step: WorkflowGraphStep): [string, WorkflowGraphStep] => {
      return [step.key, step];
    }),
  );
  const stepsAfter: Map<string, WorkflowGraphStep> = new Map(
    after.steps.map((step: WorkflowGraphStep): [string, WorkflowGraphStep] => {
      return [step.key, step];
    }),
  );

  const named: (step: WorkflowGraphStep) => WorkflowGraphChangedStep = (
    step: WorkflowGraphStep,
  ): WorkflowGraphChangedStep => {
    return { key: step.key, label: wording.stepLabel(step) };
  };

  const added: Array<WorkflowGraphChange> = [];
  const removed: Array<WorkflowGraphChange> = [];
  const renamed: Array<WorkflowGraphChange> = [];
  const reconfigured: Array<WorkflowGraphChange> = [];
  const moved: Array<WorkflowGraphStep> = [];

  for (const step of after.steps) {
    const previous: WorkflowGraphStep | undefined = stepsBefore.get(step.key);

    if (!previous) {
      added.push({
        kind: WorkflowGraphChangeKind.Added,
        line: `Added ${wording.stepLabel(step)}`,
        steps: [named(step)],
      });
      continue;
    }

    if (previous.componentId !== step.componentId) {
      reconfigured.push({
        kind: WorkflowGraphChangeKind.Replaced,
        line: `Replaced ${wording.stepLabel(previous)} with ${wording.stepLabel(step)}`,
        steps: [named(step)],
      });
      continue;
    }

    if (
      data.includeMoves &&
      !isSamePosition(
        readBefore.positions.get(step.key),
        readAfter.positions.get(step.key),
      )
    ) {
      moved.push(step);
    }

    if (previous.stepId !== step.stepId) {
      renamed.push({
        kind: WorkflowGraphChangeKind.Renamed,
        line: `Renamed ${wording.stepLabel(previous)} to ${quote(step.stepId || "no id")}`,
        steps: [named(previous)],
      });
    }

    const settingIds: Array<string> = Array.from(
      new Set<string>([
        ...Object.keys(previous.arguments),
        ...Object.keys(step.arguments),
      ]),
    ).filter((settingId: string): boolean => {
      return !isSameSetting(
        previous.arguments[settingId],
        step.arguments[settingId],
      );
    });

    if (settingIds.length > 0) {
      const names: Array<string> = settingIds
        .map((settingId: string): string => {
          return wording.settingName(step, settingId);
        })
        .sort(byText);
      const shown: Array<string> =
        names.length > SETTINGS_NAMED_PER_LINE
          ? [
              ...names.slice(0, SETTINGS_NAMED_PER_LINE - 1),
              `${names.length - (SETTINGS_NAMED_PER_LINE - 1)} more settings`,
            ]
          : names;

      reconfigured.push({
        kind: WorkflowGraphChangeKind.SettingsChanged,
        line: `Changed ${joinWithAnd(shown)} in ${wording.stepLabel(step)}`,
        steps: [named(step)],
      });
    }

    if (
      toComparableJson(previous.otherData) !== toComparableJson(step.otherData)
    ) {
      reconfigured.push({
        kind: WorkflowGraphChangeKind.SetUpChanged,
        line: `Changed how ${wording.stepLabel(step)} is set up`,
        steps: [named(step)],
      });
    }
  }

  for (const step of before.steps) {
    if (!stepsAfter.has(step.key)) {
      removed.push({
        kind: WorkflowGraphChangeKind.Removed,
        line: `Removed ${wording.stepLabel(step)}`,
        steps: [named(step)],
      });
    }
  }

  const connectionsBefore: Set<string> = new Set<string>(
    before.connections.map(connectionKey),
  );
  const connectionsAfter: Set<string> = new Set<string>(
    after.connections.map(connectionKey),
  );

  const connected: Array<WorkflowGraphChange> = [];
  const disconnected: Array<WorkflowGraphChange> = [];

  for (const connection of after.connections) {
    if (connectionsBefore.has(connectionKey(connection))) {
      continue;
    }

    const described: DescribedConnection | null = describeConnection({
      wording,
      connection,
      steps: stepsAfter,
    });

    if (described) {
      connected.push({
        kind: WorkflowGraphChangeKind.Connected,
        line: `Connected ${described.text}`,
        steps: [named(described.from), named(described.to)],
      });
    }
  }

  for (const connection of before.connections) {
    if (connectionsAfter.has(connectionKey(connection))) {
      continue;
    }

    // Removing a step removes its connections: the step's line says so.
    if (!stepsAfter.has(connection.from) || !stepsAfter.has(connection.to)) {
      continue;
    }

    const described: DescribedConnection | null = describeConnection({
      wording,
      connection,
      steps: stepsBefore,
    });

    if (described) {
      disconnected.push({
        kind: WorkflowGraphChangeKind.Disconnected,
        line: `Removed the connection from ${described.text}`,
        steps: [named(described.from), named(described.to)],
      });
    }
  }

  const movedLine: Array<WorkflowGraphChange> = [];

  if (moved.length > 0) {
    const movedSteps: Array<WorkflowGraphChangedStep> = moved
      .map(named)
      .sort((a: WorkflowGraphChangedStep, b: WorkflowGraphChangedStep) => {
        return byText(a.label, b.label);
      });

    movedLine.push({
      kind: WorkflowGraphChangeKind.Moved,
      line:
        movedSteps.length > MOVED_CARDS_NAMED_PER_LINE
          ? `Moved ${movedSteps.length} steps`
          : `Moved ${joinWithAnd(
              movedSteps.map((step: WorkflowGraphChangedStep): string => {
                return step.label;
              }),
            )}`,
      steps: movedSteps,
    });
  }

  const changes: Array<WorkflowGraphChange> = [
    ...added.sort(byLine),
    ...removed.sort(byLine),
    ...renamed.sort(byLine),
    ...reconfigured.sort(byLine),
    ...connected.sort(byLine),
    ...disconnected.sort(byLine),
    ...movedLine,
  ];

  const lines: Array<string> = changes.map(
    (change: WorkflowGraphChange): string => {
      return change.line;
    },
  );

  return {
    lines: limitLines({
      lines,
      limit: data.lineLimit || WORKFLOW_GRAPH_CHANGE_LINE_LIMIT,
      noun: "change",
    }),
    totalChanges: lines.length,
    changes,
  };
};

/*
 * At most `limit` lines, the last saying how many more there were: a
 * workflow rebuilt from scratch says "and 40 more changes" rather than
 * listing every one.
 */
export const limitLines: (data: {
  lines: Array<string>;
  limit: number;
  noun: string;
}) => Array<string> = (data: {
  lines: Array<string>;
  limit: number;
  noun: string;
}): Array<string> => {
  const max: number = Math.max(1, Math.floor(data.limit));

  if (data.lines.length <= max) {
    return data.lines;
  }

  const kept: Array<string> = data.lines.slice(0, max - 1);
  const rest: number = data.lines.length - kept.length;

  return [...kept, `and ${rest} more ${data.noun}${rest === 1 ? "" : "s"}`];
};

const countWord: (count: number, word: string) => string = (
  count: number,
  word: string,
): string => {
  if (count === 0) {
    return `no ${word}s`;
  }

  return `${count} ${word}${count === 1 ? "" : "s"}`;
};

// "3 steps and 2 connections": what a workflow holds, in a few words.
export const describeWorkflowGraphSize: (graph: unknown) => string = (
  graph: unknown,
): string => {
  const content: WorkflowGraphContent = readWorkflowGraph(graph);
  const keys: Set<string> = new Set<string>(
    content.steps.map((step: WorkflowGraphStep): string => {
      return step.key;
    }),
  );
  const connections: number = content.connections.filter(
    (connection: WorkflowGraphConnection): boolean => {
      return keys.has(connection.from) && keys.has(connection.to);
    },
  ).length;
  const steps: string = countWord(content.steps.length, "step");

  return `${steps.charAt(0).toUpperCase()}${steps.slice(1)} and ${countWord(connections, "connection")}`;
};

// The steps a workflow holds, one line each, for a workflow created or deleted.
export const listWorkflowGraphSteps: (data: {
  graph: unknown;
  lookup?: WorkflowComponentLookup | undefined;
  lineLimit?: number | undefined;
}) => Array<string> = (data: {
  graph: unknown;
  lookup?: WorkflowComponentLookup | undefined;
  lineLimit?: number | undefined;
}): Array<string> => {
  const wording: GraphWording = new GraphWording(data.lookup);
  const labels: Array<string> = readWorkflowGraph(data.graph)
    .steps.map((step: WorkflowGraphStep): string => {
      return wording.stepLabel(step);
    })
    .sort(byText);

  return limitLines({
    lines: labels,
    limit: data.lineLimit || WORKFLOW_GRAPH_CHANGE_LINE_LIMIT,
    noun: "step",
  });
};

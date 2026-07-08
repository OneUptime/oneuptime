import {
  Argument,
  ComponentInputType,
  ComponentType,
  NodeDataProp,
  NodeType,
  Port,
} from "../../../Types/Workflow/Component";
import { JSONObject } from "../../../Types/JSON";
import { Edge, Node } from "reactflow";

/*
 * Pure graph/presentation helpers for the workflow builder.
 *
 * Kept free of React and of the heavy catalog loader (Utils.ts pulls in every
 * database model) so these can be unit-tested cheaply and reused widely.
 */

/*
 * Return the set of component ids (NodeDataProp.id — the human "slack-1"
 * identifier, NOT the React Flow node id) that are UPSTREAM of the given
 * React Flow node, i.e. steps that run before it and whose output therefore
 * actually exists when this step runs.
 *
 * Edges connect React Flow node ids (node.id); tokens reference the data id
 * (node.data.id), so we walk the graph on node.id and translate the result
 * back to data ids.
 */
export type GetUpstreamComponentIdsFunction = (
  selectedNodeId: string,
  nodes: Array<Node>,
  edges: Array<Edge>,
) => Set<string>;

export const getUpstreamComponentIds: GetUpstreamComponentIdsFunction = (
  selectedNodeId: string,
  nodes: Array<Node>,
  edges: Array<Edge>,
): Set<string> => {
  // target node id -> list of source node ids feeding into it.
  const incoming: Map<string, Array<string>> = new Map<string, Array<string>>();
  for (const edge of edges) {
    if (!edge.source || !edge.target) {
      continue;
    }
    const list: Array<string> = incoming.get(edge.target) || [];
    list.push(edge.source);
    incoming.set(edge.target, list);
  }

  // Breadth-first walk backwards from the selected node.
  const visitedNodeIds: Set<string> = new Set<string>();
  const queue: Array<string> = [...(incoming.get(selectedNodeId) || [])];

  while (queue.length > 0) {
    const current: string = queue.shift() as string;
    if (visitedNodeIds.has(current) || current === selectedNodeId) {
      continue;
    }
    visitedNodeIds.add(current);
    for (const source of incoming.get(current) || []) {
      if (!visitedNodeIds.has(source)) {
        queue.push(source);
      }
    }
  }

  // Translate upstream React Flow node ids -> component data ids.
  const dataIds: Set<string> = new Set<string>();
  for (const node of nodes) {
    if (visitedNodeIds.has(node.id)) {
      const dataId: string | undefined = (node.data as NodeDataProp | undefined)
        ?.id;
      if (dataId) {
        dataIds.add(dataId);
      }
    }
  }

  return dataIds;
};

// Field names/types whose values must never be printed on the canvas.
const SECRET_NAME_REGEX: RegExp =
  /webhook|token|secret|password|api[_-]?key|authorization|bearer|credential/i;

const MAX_SUMMARY_VALUE_LENGTH: number = 40;

const REDACTED: string = "••••";

/*
 * Only these input types are safe to print verbatim on the always-visible
 * canvas. Structured/opaque types (JSON, StringDictionary/headers, DB queries,
 * URLs with embedded credentials, JavaScript, …) can carry secrets, so their
 * values are redacted rather than rendered — the node face is a shareable
 * surface (screenshots, screen-shares).
 */
const SAFE_DISPLAY_TYPES: Set<ComponentInputType> = new Set<ComponentInputType>(
  [
    ComponentInputType.Text,
    ComponentInputType.LongText,
    ComponentInputType.Markdown,
    ComponentInputType.HTML,
    ComponentInputType.Number,
    ComponentInputType.Decimal,
    ComponentInputType.Boolean,
    ComponentInputType.Date,
    ComponentInputType.DateTime,
    ComponentInputType.Email,
    ComponentInputType.CronTab,
    ComponentInputType.Operator,
    ComponentInputType.ValueType,
    ComponentInputType.WorkflowSelect,
  ],
);

type IsSecretArgumentFunction = (arg: Argument) => boolean;

const isSecretArgument: IsSecretArgumentFunction = (arg: Argument): boolean => {
  if (arg.type === ComponentInputType.Password) {
    return true;
  }
  return SECRET_NAME_REGEX.test(arg.id) || SECRET_NAME_REGEX.test(arg.name);
};

/*
 * Turn {{ tokens }} into friendly names so the node face reads like a
 * sentence ("Post {title}") instead of showing raw plumbing that also risks
 * being sliced mid-token by truncation.
 */
type HumanizeTokensFunction = (text: string) => string;

const humanizeTokens: HumanizeTokensFunction = (text: string): string => {
  return text
    .replace(
      /\{\{\s*local\.components\.[^.}]+\.returnValues\.([^}]+?)\s*\}\}/g,
      "{$1}",
    )
    .replace(/\{\{\s*(?:local|global)\.variables\.([^}]+?)\s*\}\}/g, "{$1}")
    .replace(/\{\{[^}]*\}\}/g, "{…}");
};

// Strip credentials and query/fragment from a URL before displaying it.
type MaskUrlFunction = (value: string) => string;

const maskUrl: MaskUrlFunction = (value: string): string => {
  /*
   * Strip userinfo: greedily consume up to the last "@" before the path so a
   * password containing "@" is fully removed.
   */
  let masked: string = value.replace(
    /^([a-z][a-z0-9+.-]*:\/\/)[^/?#\s]*@/i,
    "$1",
  );
  masked = masked.split("?")[0] as string;
  masked = masked.split("#")[0] as string;
  return masked;
};

type CollapseAndTruncateFunction = (text: string) => string;

const collapseAndTruncate: CollapseAndTruncateFunction = (
  text: string,
): string => {
  let result: string = text.replace(/\s+/g, " ").trim();
  if (result.length > MAX_SUMMARY_VALUE_LENGTH) {
    result = `${result.slice(0, MAX_SUMMARY_VALUE_LENGTH - 1).trimEnd()}…`;
  }
  return result;
};

/*
 * Produce the display string for one argument value, or null to skip it.
 * Secret and structured/opaque types are redacted; safe types are shown with
 * tokens humanized and long values truncated.
 */
type DisplayArgumentValueFunction = (
  arg: Argument,
  value: unknown,
) => string | null;

const displayArgumentValue: DisplayArgumentValueFunction = (
  arg: Argument,
  value: unknown,
): string | null => {
  if (isSecretArgument(arg)) {
    return REDACTED;
  }

  if (arg.type === ComponentInputType.URL) {
    return collapseAndTruncate(maskUrl(humanizeTokens(String(value))));
  }

  if (!SAFE_DISPLAY_TYPES.has(arg.type)) {
    return REDACTED;
  }

  let text: string;
  if (typeof value === "string") {
    text = value;
  } else if (typeof value === "object") {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  } else {
    text = String(value);
  }

  const display: string = collapseAndTruncate(humanizeTokens(text));
  /*
   * A value that was only whitespace collapses to "" — skip it so the node
   * never shows a dangling "Name: " label.
   */
  return display.length > 0 ? display : null;
};

/*
 * Build a short, human-readable summary of what a configured step actually
 * does, from its argument values — so the canvas is self-documenting instead
 * of showing the same static description on every node. Secret and structured
 * values are redacted. Returns null when nothing meaningful is configured (the
 * caller falls back to the static description).
 */
export type GetComponentSummaryFunction = (data: NodeDataProp) => string | null;

export const getComponentSummary: GetComponentSummaryFunction = (
  data: NodeDataProp,
): string | null => {
  const args: Array<Argument> = data.metadata?.arguments || [];
  const values: JSONObject = (data.arguments as JSONObject) || {};

  const parts: Array<string> = [];

  for (const arg of args) {
    if (parts.length >= 2) {
      break;
    }

    const value: unknown = values[arg.id];
    if (value === undefined || value === null || value === "") {
      continue;
    }

    const display: string | null = displayArgumentValue(arg, value);
    if (!display) {
      continue;
    }

    parts.push(`${arg.name}: ${display}`);
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join(" · ");
};

export type NodeStatus = "error" | "incomplete" | "ready";

/*
 * Classify a node for the at-a-glance status indicator on its face:
 *  - "error"      → the last run reported an error on this step.
 *  - "incomplete" → a required argument is still empty (needs setup).
 *  - "ready"      → everything required is filled in.
 */
export type GetNodeStatusFunction = (data: NodeDataProp) => NodeStatus;

export const getNodeStatus: GetNodeStatusFunction = (
  data: NodeDataProp,
): NodeStatus => {
  if (data.error) {
    return "error";
  }

  const args: Array<Argument> = data.metadata?.arguments || [];
  const values: JSONObject = (data.arguments as JSONObject) || {};

  const hasMissingRequired: boolean = args.some((arg: Argument) => {
    if (!arg.required) {
      return false;
    }
    const value: unknown = values[arg.id];
    return value === undefined || value === null || value === "";
  });

  return hasMissingRequired ? "incomplete" : "ready";
};

export interface OutlineEntry {
  // The component's human id (NodeDataProp.id), stable per node.
  nodeId: string;
  title: string;
  summary: string | null;
  // Indentation level; the trigger is 0.
  depth: number;
  // The out-port that led here, shown only when the parent branches.
  branchLabel?: string | undefined;
  /*
   * True when this step was already listed (a loop or a merge/fan-in) — it's
   * a reference back, not re-expanded.
   */
  repeated: boolean;
}

export interface WorkflowOutline {
  hasTrigger: boolean;
  entries: Array<OutlineEntry>;
  // A step is reached from more than one path (fan-in or loop).
  hasMultiplePaths: boolean;
}

/*
 * Linearise the graph into an ordered, indented list of steps for the
 * read-only Outline — a plain "read back what this workflow does" view. It
 * walks forward from the trigger following edges; branches nest under their
 * port label, and a step reached twice (loop / merge) is listed once more as a
 * reference rather than re-expanded, so this always terminates.
 */
export type BuildOutlineFunction = (
  nodes: Array<Node>,
  edges: Array<Edge>,
) => WorkflowOutline;

export const buildOutline: BuildOutlineFunction = (
  nodes: Array<Node>,
  edges: Array<Edge>,
): WorkflowOutline => {
  const nodeById: Map<string, Node> = new Map<string, Node>();
  for (const node of nodes) {
    nodeById.set(node.id, node);
  }

  const adjacency: Map<
    string,
    Array<{ port: string | null | undefined; target: string }>
  > = new Map();
  for (const edge of edges) {
    if (!edge.source || !edge.target) {
      continue;
    }
    const list: Array<{ port: string | null | undefined; target: string }> =
      adjacency.get(edge.source) || [];
    list.push({ port: edge.sourceHandle, target: edge.target });
    adjacency.set(edge.source, list);
  }

  const trigger: Node | undefined = nodes.find((node: Node) => {
    const data: NodeDataProp = node.data as NodeDataProp;
    return (
      data &&
      data.nodeType === NodeType.Node &&
      data.componentType === ComponentType.Trigger
    );
  });

  if (!trigger) {
    return { hasTrigger: false, entries: [], hasMultiplePaths: false };
  }

  const entries: Array<OutlineEntry> = [];
  const visited: Set<string> = new Set<string>();
  let hasMultiplePaths: boolean = false;

  type VisitFunction = (
    reactFlowId: string,
    depth: number,
    branchLabel: string | undefined,
  ) => void;

  const visit: VisitFunction = (
    reactFlowId: string,
    depth: number,
    branchLabel: string | undefined,
  ): void => {
    const node: Node | undefined = nodeById.get(reactFlowId);
    if (!node) {
      return;
    }

    const data: NodeDataProp = node.data as NodeDataProp;
    const alreadySeen: boolean = visited.has(reactFlowId);
    if (alreadySeen) {
      hasMultiplePaths = true;
    }

    entries.push({
      nodeId: data.id,
      title: data.metadata?.title || data.id,
      summary: getComponentSummary(data),
      depth: depth,
      branchLabel: branchLabel,
      repeated: alreadySeen,
    });

    if (alreadySeen) {
      return;
    }
    visited.add(reactFlowId);

    const outPorts: Array<Port> = data.metadata?.outPorts || [];
    const branches: boolean = outPorts.length > 1;
    const outEdges: Array<{ port: string | null | undefined; target: string }> =
      adjacency.get(reactFlowId) || [];

    for (const outEdge of outEdges) {
      const port: Port | undefined = outPorts.find((p: Port) => {
        return p.id === outEdge.port;
      });
      const label: string | undefined = branches
        ? port?.title || outEdge.port || undefined
        : undefined;
      visit(outEdge.target, depth + 1, label);
    }
  };

  visit(trigger.id, 0, undefined);

  return {
    hasTrigger: true,
    entries: entries,
    hasMultiplePaths: hasMultiplePaths,
  };
};

/*
 * Rewrite every downstream reference to a renamed step. Data references are
 * stored as {{local.components.<id>.returnValues.<rv>}} tokens inside argument
 * strings; when a step's identifier changes, those tokens must follow or they
 * silently break. Matching includes the trailing ".returnValues." so an id
 * that is a prefix of another (slack-1 vs slack-10) is never mis-rewritten.
 * Returns new node objects only where something changed.
 */
export type RenameComponentReferencesFunction = (
  nodes: Array<Node>,
  oldId: string,
  newId: string,
) => Array<Node>;

export const renameComponentReferences: RenameComponentReferencesFunction = (
  nodes: Array<Node>,
  oldId: string,
  newId: string,
): Array<Node> => {
  if (!oldId || !newId || oldId === newId) {
    return nodes;
  }

  const needle: string = `{{local.components.${oldId}.returnValues.`;
  const replacement: string = `{{local.components.${newId}.returnValues.`;

  return nodes.map((node: Node) => {
    const data: NodeDataProp = node.data as NodeDataProp;
    const args: JSONObject | undefined = data?.arguments as
      | JSONObject
      | undefined;
    if (!args) {
      return node;
    }

    let changed: boolean = false;
    const nextArgs: JSONObject = {};
    for (const key of Object.keys(args)) {
      const value: unknown = args[key];
      if (typeof value === "string" && value.includes(needle)) {
        nextArgs[key] = value.split(needle).join(replacement);
        changed = true;
      } else {
        nextArgs[key] = args[key];
      }
    }

    if (!changed) {
      return node;
    }

    return { ...node, data: { ...data, arguments: nextArgs } };
  });
};

// Captures the source component's data id from a data-reference token.
const COMPONENT_TOKEN_SOURCE_REGEX: RegExp =
  /\{\{local\.components\.([^.}]+)\.returnValues\.[^}]+\}\}/g;

/*
 * Derive "ghost" edges that visualise the data flow: for every
 * {{local.components.<id>.returnValues.…}} reference in a step's arguments,
 * draw a faint dashed edge from the referenced (source) step to the step that
 * consumes it. These are display-only — they are never added to the persisted
 * edges state — so they can't leak into a saved graph. Ids are deterministic
 * so React Flow doesn't churn across renders.
 */
export type DeriveDataEdgesFunction = (nodes: Array<Node>) => Array<Edge>;

export const deriveDataEdges: DeriveDataEdgesFunction = (
  nodes: Array<Node>,
): Array<Edge> => {
  const dataIdToNodeId: Map<string, string> = new Map<string, string>();
  for (const node of nodes) {
    const data: NodeDataProp = node.data as NodeDataProp;
    if (data?.id) {
      dataIdToNodeId.set(data.id, node.id);
    }
  }

  const ghostEdges: Array<Edge> = [];
  const seen: Set<string> = new Set<string>();

  for (const node of nodes) {
    const data: NodeDataProp = node.data as NodeDataProp;
    const args: JSONObject | undefined = data?.arguments as
      | JSONObject
      | undefined;
    if (!args) {
      continue;
    }

    for (const key of Object.keys(args)) {
      const value: unknown = args[key];
      if (typeof value !== "string") {
        continue;
      }

      COMPONENT_TOKEN_SOURCE_REGEX.lastIndex = 0;
      let match: RegExpExecArray | null = null;
      while ((match = COMPONENT_TOKEN_SOURCE_REGEX.exec(value)) !== null) {
        const sourceDataId: string | undefined = match[1];
        if (!sourceDataId) {
          continue;
        }
        const sourceNodeId: string | undefined =
          dataIdToNodeId.get(sourceDataId);
        // Skip unknown sources and self-references.
        if (!sourceNodeId || sourceNodeId === node.id) {
          continue;
        }

        const pairKey: string = `${sourceNodeId}->${node.id}`;
        if (seen.has(pairKey)) {
          continue;
        }
        seen.add(pairKey);

        ghostEdges.push({
          id: `data-ghost-${pairKey}`,
          source: sourceNodeId,
          target: node.id,
          type: "smoothstep",
          animated: true,
          deletable: false,
          style: {
            stroke: "#a5b4fc",
            strokeWidth: 1.5,
            strokeDasharray: "4 4",
            opacity: 0.7,
          },
        });
      }
    }
  }

  return ghostEdges;
};

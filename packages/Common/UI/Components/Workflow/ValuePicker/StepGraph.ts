/*
 * Which steps a step can read values from.
 *
 * A step's settings can only use what has already happened by the time it
 * runs: the trigger's values, and the return values of the steps that run
 * before it. The runner (RunWorkflow) walks the graph from the trigger along
 * its edges, one step at a time, and stores each step's return values as it
 * finishes. So the values a step can read are those of its ancestors - every
 * step from which an edge path leads to it.
 *
 * The trigger is always among them, connected yet or not. A step only ever
 * runs because a path from the trigger reaches it, so once the step is wired
 * up the trigger is upstream of it - and offering the trigger's values to a
 * step that has just been dropped on the canvas is exactly what the person
 * building it wants.
 *
 * A step that runs after this one never is. Its values do not exist yet when
 * this step's settings are read, which is the mistake GraphLint reports as a
 * ForwardReference; the picker does not offer what the linter would flag.
 *
 * This file has no UI or API imports, so it can be tested on its own.
 */

import Dictionary from "../../../../Types/Dictionary";
import {
  ComponentType,
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";

/** The parts of a react-flow node this needs. */
export interface StepGraphNode {
  id: string;
  data: NodeDataProp;
}

/** The parts of a react-flow edge this needs. */
export interface StepGraphEdge {
  source: string;
  target: string;
}

export interface StepValueSources {
  /**
   * The steps this one can read values from, in the order the runner reaches
   * them: the trigger first, then each step after the ones before it.
   */
  upstream: Array<NodeDataProp>;
  /**
   * The ids (NodeDataProp.id) of the steps that run after this one. A value
   * read from one of them is always empty.
   */
  downstreamIds: Array<string>;
  /**
   * False while nothing is connected into this step. The picker then says
   * how to get more values than the trigger's: connect the step.
   */
  hasIncomingConnection: boolean;
}

export const EMPTY_STEP_VALUE_SOURCES: StepValueSources = {
  upstream: [],
  downstreamIds: [],
  hasIncomingConnection: false,
};

type IsRealNodeFunction = (node: StepGraphNode) => boolean;

/*
 * The "click here to add a trigger" placeholder carries a partial metadata
 * object and no id. It is not a step and has nothing to read.
 */
const isRealNode: IsRealNodeFunction = (node: StepGraphNode): boolean => {
  return Boolean(
    node &&
      node.data &&
      node.data.metadata &&
      node.data.nodeType !== NodeType.PlaceholderNode,
  );
};

type WalkFunction = (
  startIds: Array<string>,
  adjacency: Dictionary<Array<string>>,
) => Array<string>;

/*
 * Breadth first, in discovery order, not including the start nodes unless a
 * path leads back to them. Breadth first is also the order the runner's FIFO
 * queue visits steps in, which is what makes it the right order to list them.
 */
const walk: WalkFunction = (
  startIds: Array<string>,
  adjacency: Dictionary<Array<string>>,
): Array<string> => {
  const visited: Set<string> = new Set<string>();
  const order: Array<string> = [];
  const queue: Array<string> = [];

  for (const startId of startIds) {
    for (const next of adjacency[startId] || []) {
      queue.push(next);
    }
  }

  while (queue.length > 0) {
    const current: string = queue.shift() as string;

    if (visited.has(current)) {
      continue;
    }

    visited.add(current);
    order.push(current);

    for (const next of adjacency[current] || []) {
      if (!visited.has(next)) {
        queue.push(next);
      }
    }
  }

  return order;
};

export type GetStepValueSourcesFunction = (graph: {
  nodes: Array<StepGraphNode>;
  edges: Array<StepGraphEdge>;
  /** The react-flow id of the step whose settings are open. */
  nodeId: string;
}) => StepValueSources;

export const getStepValueSources: GetStepValueSourcesFunction = (graph: {
  nodes: Array<StepGraphNode>;
  edges: Array<StepGraphEdge>;
  nodeId: string;
}): StepValueSources => {
  const nodes: Array<StepGraphNode> = (graph.nodes || []).filter(isRealNode);

  const nodesById: Dictionary<StepGraphNode> = {};

  for (const node of nodes) {
    nodesById[node.id] = node;
  }

  const editedNode: StepGraphNode | undefined = nodesById[graph.nodeId];

  if (!editedNode) {
    return EMPTY_STEP_VALUE_SOURCES;
  }

  const forward: Dictionary<Array<string>> = {};
  const backward: Dictionary<Array<string>> = {};

  for (const edge of graph.edges || []) {
    // An edge to or from something that is not a step leads nowhere.
    if (!nodesById[edge.source] || !nodesById[edge.target]) {
      continue;
    }

    (forward[edge.source] = forward[edge.source] || []).push(edge.target);
    (backward[edge.target] = backward[edge.target] || []).push(edge.source);
  }

  const descendantIds: Array<string> = walk([editedNode.id], forward).filter(
    (id: string) => {
      return id !== editedNode.id;
    },
  );

  const descendantSet: Set<string> = new Set<string>(descendantIds);

  /*
   * In a loop a step is both before and after this one. Reading it is a
   * forward reference as far as the linter is concerned (and the runner
   * stops a cyclic workflow anyway), so after wins.
   */
  const ancestorIds: Array<string> = walk([editedNode.id], backward).filter(
    (id: string) => {
      return id !== editedNode.id && !descendantSet.has(id);
    },
  );

  const isTrigger: boolean =
    editedNode.data.componentType === ComponentType.Trigger;

  const triggerIds: Array<string> = isTrigger
    ? []
    : nodes
        .filter((node: StepGraphNode) => {
          return (
            node.data.componentType === ComponentType.Trigger &&
            node.id !== editedNode.id &&
            !descendantSet.has(node.id)
          );
        })
        .map((node: StepGraphNode) => {
          return node.id;
        });

  const readable: Set<string> = new Set<string>([
    ...triggerIds,
    ...ancestorIds,
  ]);

  /*
   * Run order: the triggers, then everything they reach, breadth first. A
   * chain feeding into this step that no trigger reaches yet goes last,
   * farthest first, so it still reads top to bottom.
   */
  const runOrder: Array<string> = [...triggerIds, ...walk(triggerIds, forward)];

  const ordered: Array<string> = [];

  for (const id of runOrder) {
    if (readable.has(id) && !ordered.includes(id)) {
      ordered.push(id);
    }
  }

  for (const id of [...ancestorIds].reverse()) {
    if (!ordered.includes(id)) {
      ordered.push(id);
    }
  }

  return {
    upstream: ordered.map((id: string) => {
      return (nodesById[id] as StepGraphNode).data;
    }),
    downstreamIds: descendantIds
      .map((id: string) => {
        return (nodesById[id] as StepGraphNode).data.id;
      })
      .filter((id: string) => {
        return Boolean(id);
      }),
    hasIncomingConnection: (backward[editedNode.id] || []).length > 0,
  };
};

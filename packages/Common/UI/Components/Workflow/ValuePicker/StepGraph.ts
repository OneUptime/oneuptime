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
 * Every step takes one of its outputs when it runs - If / Else takes Yes or
 * No, Switch / Case one case, an API call Success or Error - so a step before
 * this one on only some of the paths to it ran on some runs only: its values
 * can be empty here. Those are told apart (`sometimes`), with the output that
 * decides it ("only when If / Else takes Yes"). And a connection only carries
 * a run from an output the step has now (ComponentOutPorts): one left over
 * from a Switch / Case case that was taken out leads nowhere.
 *
 * Everything else - the steps that run after this one, or that no path leads
 * from to it - is listed apart, with why (`unavailable`), so the picker can
 * say why a step's values are not offered rather than leave someone looking
 * for them.
 *
 * This file has no UI or API imports, so it can be tested on its own.
 */

import Dictionary from "../../../../Types/Dictionary";
import {
  ComponentType,
  NodeDataProp,
  NodeType,
  Port,
} from "../../../../Types/Workflow/Component";
import { getComponentOutPorts } from "../../../../Types/Workflow/ComponentOutPorts";

/** The parts of a react-flow node this needs. */
export interface StepGraphNode {
  id: string;
  data: NodeDataProp;
}

/** The parts of a react-flow edge this needs. */
export interface StepGraphEdge {
  source: string;
  target: string;
  /*
   * The output of the source step the connection leaves from. Absent on a
   * connection that does not say, which is then taken to leave from one.
   */
  sourceHandle?: string | null | undefined;
}

// Why a step's values cannot be read where the step being edited is.
export enum UnavailableReason {
  // It runs after this step: its values do not exist yet.
  RunsAfter = "RunsAfter",
  // No path leads from it to this step.
  NotOnPath = "NotOnPath",
  // Nothing connects it to the trigger, so it never runs at all.
  NeverRuns = "NeverRuns",
}

export interface UnavailableStep {
  step: NodeDataProp;
  reason: UnavailableReason;
}

/*
 * A step that runs before this one on some runs only: the step whose output
 * decides it, and that output when it is one ("If / Else", "Yes").
 */
export interface SometimesBefore {
  branchStep: NodeDataProp;
  portTitle?: string | undefined;
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
  /*
   * The upstream steps that run before this one on some runs only, by id
   * (NodeDataProp.id): their values can be empty here.
   */
  sometimes?: Dictionary<SometimesBefore> | undefined;
  // Every other step, with why its values are not offered.
  unavailable?: Array<UnavailableStep> | undefined;
}

export const EMPTY_STEP_VALUE_SOURCES: StepValueSources = {
  upstream: [],
  downstreamIds: [],
  hasIncomingConnection: false,
  sometimes: {},
  unavailable: [],
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
  skipId?: string,
) => Array<string>;

/*
 * Breadth first, in discovery order, not including the start nodes unless a
 * path leads back to them. Breadth first is also the order the runner's FIFO
 * queue visits steps in, which is what makes it the right order to list them.
 * A step skipped is treated as if it were not there.
 */
const walk: WalkFunction = (
  startIds: Array<string>,
  adjacency: Dictionary<Array<string>>,
  skipId?: string,
): Array<string> => {
  const visited: Set<string> = new Set<string>();
  const order: Array<string> = [];
  const queue: Array<string> = [];

  for (const startId of startIds) {
    if (startId === skipId) {
      continue;
    }

    for (const next of adjacency[startId] || []) {
      queue.push(next);
    }
  }

  while (queue.length > 0) {
    const current: string = queue.shift() as string;

    if (visited.has(current) || current === skipId) {
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

type OutputIdsFunction = (node: StepGraphNode) => Array<string>;

// The outputs a step has as it is set up now.
const outputIdsOf: OutputIdsFunction = (node: StepGraphNode): Array<string> => {
  return getComponentOutPorts({
    metadata: node.data.metadata,
    arguments: node.data.arguments,
  }).map((port: Port): string => {
    return port.id;
  });
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
  // The connections leaving each step, by the output they leave from.
  const outgoing: Dictionary<Array<StepGraphEdge>> = {};
  const outputIds: Dictionary<Array<string>> = {};

  for (const edge of graph.edges || []) {
    const source: StepGraphNode | undefined = nodesById[edge.source];

    // An edge to or from something that is not a step leads nowhere.
    if (!source || !nodesById[edge.target]) {
      continue;
    }

    // Nor does one from an output the step no longer has.
    if (edge.sourceHandle) {
      const outputs: Array<string> = (outputIds[edge.source] =
        outputIds[edge.source] || outputIdsOf(source));

      if (!outputs.includes(edge.sourceHandle)) {
        continue;
      }
    }

    (forward[edge.source] = forward[edge.source] || []).push(edge.target);
    (backward[edge.target] = backward[edge.target] || []).push(edge.source);
    (outgoing[edge.source] = outgoing[edge.source] || []).push(edge);
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

  const allTriggerIds: Array<string> = nodes
    .filter((node: StepGraphNode) => {
      return node.data.componentType === ComponentType.Trigger;
    })
    .map((node: StepGraphNode) => {
      return node.id;
    });

  const triggerIds: Array<string> = isTrigger
    ? []
    : allTriggerIds.filter((id: string): boolean => {
        return id !== editedNode.id && !descendantSet.has(id);
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
  const reachedFromTrigger: Array<string> = walk(allTriggerIds, forward);
  const runOrder: Array<string> = [...triggerIds, ...reachedFromTrigger];

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

  const reachedSet: Set<string> = new Set<string>(reachedFromTrigger);
  const isReached: boolean = !isTrigger && reachedSet.has(editedNode.id);

  /*
   * A step the trigger reaches can read only what the trigger reaches too:
   * a chain feeding into it that nothing starts never runs, so its values
   * are always empty. (While this step is itself unreached - still being
   * wired up - that chain is offered, as the steps it will run after.)
   */
  if (isReached) {
    for (const id of [...ordered]) {
      if (!reachedSet.has(id) && !allTriggerIds.includes(id)) {
        ordered.splice(ordered.indexOf(id), 1);
        readable.delete(id);
      }
    }
  }

  /*
   * Which steps before this one run on every run that reaches it. Only
   * answerable for a step a trigger reaches: one nothing starts never runs.
   * A step is before this one on every path when this one cannot be reached
   * from the trigger without it.
   */
  const sometimes: Dictionary<SometimesBefore> = {};

  if (isReached) {
    type IsAlwaysBeforeFunction = (id: string) => boolean;

    const isAlwaysBefore: IsAlwaysBeforeFunction = (id: string): boolean => {
      if (allTriggerIds.includes(id)) {
        return true;
      }

      return !walk(allTriggerIds, forward, id).includes(editedNode.id);
    };

    const alwaysBefore: Array<string> = ordered.filter(isAlwaysBefore);

    for (const id of ordered) {
      if (alwaysBefore.includes(id)) {
        continue;
      }

      const step: StepGraphNode = nodesById[id] as StepGraphNode;

      /*
       * The step whose output decides: the last step before this one on
       * every path that also leads to it, and the output of it that does.
       */
      const deciders: Array<string> = alwaysBefore.filter(
        (candidate: string): boolean => {
          return walk([candidate], forward).includes(id);
        },
      );
      const deciderId: string | undefined = deciders[deciders.length - 1];
      const decider: StepGraphNode | undefined = deciderId
        ? nodesById[deciderId]
        : undefined;

      if (!decider) {
        continue;
      }

      const leadingOutputs: Array<string> = [];

      for (const edge of outgoing[decider.id] || []) {
        const reaches: boolean =
          edge.target === id || walk([edge.target], forward).includes(id);
        const output: string = edge.sourceHandle || "";

        if (reaches && !leadingOutputs.includes(output)) {
          leadingOutputs.push(output);
        }
      }

      const port: Port | undefined =
        leadingOutputs.length === 1
          ? getComponentOutPorts({
              metadata: decider.data.metadata,
              arguments: decider.data.arguments,
            }).find((candidate: Port): boolean => {
              return candidate.id === leadingOutputs[0];
            })
          : undefined;

      const before: SometimesBefore = { branchStep: decider.data };

      if (port?.title) {
        before.portTitle = port.title;
      }

      if (step.data.id) {
        sometimes[step.data.id] = before;
      }
    }
  }

  const unavailable: Array<UnavailableStep> = [];

  for (const node of nodes) {
    if (
      node.id === editedNode.id ||
      readable.has(node.id) ||
      !node.data.id
    ) {
      continue;
    }

    let reason: UnavailableReason = UnavailableReason.NotOnPath;

    if (descendantSet.has(node.id)) {
      reason = UnavailableReason.RunsAfter;
    } else if (
      allTriggerIds.length > 0 &&
      !reachedSet.has(node.id) &&
      !allTriggerIds.includes(node.id)
    ) {
      reason = UnavailableReason.NeverRuns;
    }

    unavailable.push({ step: node.data, reason: reason });
  }

  // In the order they would run, the ones that never do last.
  const position: (node: NodeDataProp) => number = (
    node: NodeDataProp,
  ): number => {
    const canvasNode: StepGraphNode | undefined = nodes.find(
      (candidate: StepGraphNode): boolean => {
        return candidate.data === node;
      },
    );
    const index: number = canvasNode
      ? reachedFromTrigger.indexOf(canvasNode.id)
      : -1;

    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };

  unavailable.sort((a: UnavailableStep, b: UnavailableStep): number => {
    return position(a.step) - position(b.step);
  });

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
    sometimes: sometimes,
    unavailable: unavailable,
  };
};

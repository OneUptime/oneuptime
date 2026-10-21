/*
 * Which steps a step's outputs are connected to on the canvas, and the
 * connections a step's own settings have taken away.
 *
 * A connection (an edge) leaves a step from one of its outputs: its
 * sourceHandle is the output's id. Most steps' outputs never change, but a
 * Switch / Case has one per case (ComponentOutPorts), so removing a case
 * removes an output - and a connection from it would point at nothing. The
 * builder drops those connections when the step's settings are saved, and
 * the settings say beforehand which steps each output leads to, so a case is
 * never removed without the person seeing what it disconnects.
 *
 * Pure: no React Flow, no DOM.
 */

import { NodeDataProp, NodeType } from "../../../Types/Workflow/Component";
import { ConnectedStep, OutputConnections } from "./Switch/SwitchModel";

// The parts of a canvas node and edge this needs.
export interface ConnectionGraphNode {
  id: string;
  data?: NodeDataProp | undefined;
}

export interface ConnectionGraphEdge {
  source: string;
  target: string;
  sourceHandle?: string | null | undefined;
}

type GetOutputConnectionsFunction = (data: {
  nodes: Array<ConnectionGraphNode>;
  edges: Array<ConnectionGraphEdge>;
  // The react-flow id of the step whose outputs are asked about.
  nodeId: string;
}) => OutputConnections;

/**
 * The steps each output of a step leads to, by output id, in the order the
 * connections were drawn. A step is listed once per output however many
 * times it is connected to it, and a placeholder is not a step.
 */
export const getOutputConnections: GetOutputConnectionsFunction = (data: {
  nodes: Array<ConnectionGraphNode>;
  edges: Array<ConnectionGraphEdge>;
  nodeId: string;
}): OutputConnections => {
  const connections: OutputConnections = {};

  for (const edge of data.edges || []) {
    if (!edge || edge.source !== data.nodeId || !edge.sourceHandle) {
      continue;
    }

    const target: ConnectionGraphNode | undefined = (data.nodes || []).find(
      (node: ConnectionGraphNode): boolean => {
        return node.id === edge.target;
      },
    );

    if (
      !target ||
      !target.data ||
      target.data.nodeType === NodeType.PlaceholderNode
    ) {
      continue;
    }

    const steps: Array<ConnectedStep> = connections[edge.sourceHandle] || [];

    const componentId: string = target.data.id || target.id;

    if (
      steps.some((step: ConnectedStep): boolean => {
        return step.componentId === componentId;
      })
    ) {
      continue;
    }

    steps.push({
      componentId: componentId,
      title: target.data.metadata?.title || componentId,
    });

    connections[edge.sourceHandle] = steps;
  }

  return connections;
};

type DropConnectionsFromMissingOutputsFunction = <
  T extends ConnectionGraphEdge,
>(data: {
  edges: Array<T>;
  nodeId: string;
  // The outputs the step has now.
  outputIds: Array<string>;
}) => Array<T>;

/**
 * The connections left once those leaving the step from an output it no
 * longer has are dropped. Connections of other steps, and any without an
 * output id, are kept as they are.
 */
export const dropConnectionsFromMissingOutputs: DropConnectionsFromMissingOutputsFunction =
  <T extends ConnectionGraphEdge>(data: {
    edges: Array<T>;
    nodeId: string;
    outputIds: Array<string>;
  }): Array<T> => {
    const outputs: Set<string> = new Set<string>(data.outputIds);

    return (data.edges || []).filter((edge: T): boolean => {
      return (
        edge.source !== data.nodeId ||
        !edge.sourceHandle ||
        outputs.has(edge.sourceHandle)
      );
    });
  };

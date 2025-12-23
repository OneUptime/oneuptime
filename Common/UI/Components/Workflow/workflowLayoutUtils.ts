import type { ElkExtendedEdge, ElkNode, LayoutOptions } from "elkjs";
import ELK from "elkjs/lib/elk.bundled.js";
import { Edge, Node } from "reactflow";

// Minimal interface for the ELK layout engine
interface ElkLayoutEngine {
  layout: (graph: ElkNode) => Promise<ElkNode>;
}

// Node dimensions based on Component.tsx styling
const NODE_WIDTH: number = 240; // 15rem = 240px
const NODE_HEIGHT: number = 192; // 12rem = 192px

export interface LayoutResult {
  nodes: Array<Node>;
  edges: Array<Edge>;
}

export async function applyAutoLayout(
  nodes: Array<Node>,
  edges: Array<Edge>,
): Promise<LayoutResult> {
  const elk: ElkLayoutEngine = new ELK();

  // Build ELK graph structure
  const elkNodes: Array<{
    id: string;
    width: number;
    height: number;
  }> = nodes.map((node: Node) => {
    return {
      id: node.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    };
  });

  const elkEdges: Array<ElkExtendedEdge> = edges.map((edge: Edge) => {
    return {
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    };
  });

  const layoutOptions: LayoutOptions = {
    "elk.algorithm": "layered",
    "elk.direction": "DOWN",
    "elk.layered.spacing.nodeNodeBetweenLayers": "100",
    "elk.spacing.nodeNode": "80",
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  };

  const elkGraph: ElkNode = {
    id: "root",
    layoutOptions,
    children: elkNodes,
    edges: elkEdges,
  };

  try {
    const layoutedGraph: ElkNode = await elk.layout(elkGraph);

    // Map back to ReactFlow nodes with new positions
    const layoutedNodes: Array<Node> = nodes.map((node: Node) => {
      const elkNode:
        | {
            id: string;
            x?: number;
            y?: number;
            width?: number;
            height?: number;
          }
        | undefined = layoutedGraph.children?.find(
        (n: { id: string }) => {
          return n.id === node.id;
        },
      );

      if (elkNode && elkNode.x !== undefined && elkNode.y !== undefined) {
        return {
          ...node,
          position: {
            x: elkNode.x,
            y: elkNode.y,
          },
        };
      }

      return node;
    });

    return { nodes: layoutedNodes, edges };
  } catch (error) {
    // If layout fails, return original nodes
    return { nodes, edges };
  }
}

// Helper to center the layout around a specific point
export function centerLayout(
  nodes: Array<Node>,
  centerX: number = 400,
  centerY: number = 100,
): Array<Node> {
  if (nodes.length === 0) {
    return nodes;
  }

  // Find current bounds
  let minX: number = Infinity;
  let minY: number = Infinity;
  let maxX: number = -Infinity;
  let maxY: number = -Infinity;

  nodes.forEach((node: Node) => {
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + NODE_WIDTH);
    maxY = Math.max(maxY, node.position.y + NODE_HEIGHT);
  });

  const currentCenterX: number = (minX + maxX) / 2;
  const currentCenterY: number = minY; // Align to top

  const offsetX: number = centerX - currentCenterX;
  const offsetY: number = centerY - currentCenterY;

  return nodes.map((node: Node) => {
    return {
      ...node,
      position: {
        x: node.position.x + offsetX,
        y: node.position.y + offsetY,
      },
    };
  });
}

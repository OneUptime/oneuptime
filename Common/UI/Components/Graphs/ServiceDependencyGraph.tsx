import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ReactFlow, {
  Background,
  Controls,
  Edge,
  MarkerType,
  MiniMap,
  Node,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";
import type { ElkExtendedEdge, ElkNode } from "elkjs";
import ELK from "elkjs/lib/elk.bundled.js";

export interface ServiceNodeData {
  id: string;
  name: string;
  color?: string;
}

export interface ServiceEdgeData {
  fromServiceId: string;
  toServiceId: string;
}

export interface ServiceDependencyGraphProps {
  services: Array<ServiceNodeData>;
  dependencies: Array<ServiceEdgeData>;
}

const ServiceDependencyGraph: FunctionComponent<ServiceDependencyGraphProps> = (
  props: ServiceDependencyGraphProps,
): ReactElement => {
  const computeLuminance: (r: number, g: number, b: number) => number = (
    r: number,
    g: number,
    b: number,
  ): number => {
    const transform: (v: number) => number = (v: number): number => {
      const c: number = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const R: number = transform(r);
    const G: number = transform(g);
    const B: number = transform(b);
    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
  };

  const getContrastText: (bg?: string) => string = (bg?: string): string => {
    if (!bg) {
      return "#111827"; // gray-900
    }
    // normalize to hex like #rrggbb
    let hex: string = bg.trim();
    if (hex.startsWith("rgb")) {
      // basic rgb(a) parser
      const m: RegExpMatchArray | null = hex
        .replace(/\s+/g, "")
        .match(/rgba?\((\d+),(\d+),(\d+)/i);
      if (m) {
        const r: number = parseInt(m[1] as string, 10);
        const g: number = parseInt(m[2] as string, 10);
        const b: number = parseInt(m[3] as string, 10);
        const luminance: number = computeLuminance(r, g, b);
        return luminance > 0.5 ? "#111827" : "#ffffff";
      }
      return "#111827";
    }
    if (hex[0] === "#") {
      hex = hex.slice(1);
    }
    if (hex.length === 3) {
      hex = hex
        .split("")
        .map((c: string): string => {
          return c + c;
        })
        .join("");
    }
    if (hex.length !== 6) {
      return "#111827";
    }
    const r: number = parseInt(hex.slice(0, 2), 16);
    const g: number = parseInt(hex.slice(2, 4), 16);
    const b: number = parseInt(hex.slice(4, 6), 16);
    const luminance: number = computeLuminance(r, g, b);
    return luminance > 0.5 ? "#111827" : "#ffffff";
  };

  const [rfNodes, setRfNodes] = useState<Node[]>([]);
  const [rfEdges, setRfEdges] = useState<Edge[]>([]);

  useEffect((): void => {
    const elk: any = new ELK();
    // fixed node dimensions for layout (px)
    const NODE_WIDTH: number = 220;
    const NODE_HEIGHT: number = 56;

    const sortedServices: Array<ServiceNodeData> = [...props.services].sort(
      (a: ServiceNodeData, b: ServiceNodeData): number => {
        return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
      },
    );
    const sortedDeps: Array<ServiceEdgeData> = [...props.dependencies].sort(
      (a: ServiceEdgeData, b: ServiceEdgeData): number => {
        if (a.fromServiceId === b.fromServiceId) {
          return a.toServiceId.localeCompare(b.toServiceId);
        }
        return a.fromServiceId.localeCompare(b.fromServiceId);
      },
    );

    const elkGraph: ElkNode = {
      id: "root",
      layoutOptions: {
        algorithm: "layered",
        "elk.direction": "RIGHT",
        "elk.layered.spacing.nodeNodeBetweenLayers": "120",
        "elk.spacing.nodeNode": "60",
        "elk.edgeRouting": "POLYLINE",
      },
      children: sortedServices.map((svc: ServiceNodeData): ElkNode => {
        return {
          id: svc.id,
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
        } as ElkNode;
      }),
      edges: sortedDeps.map((dep: ServiceEdgeData): ElkExtendedEdge => {
        return {
          id: `e-${dep.fromServiceId}-${dep.toServiceId}`,
          sources: [dep.fromServiceId],
          targets: [dep.toServiceId],
        };
      }),
    };

    const layout: () => Promise<void> = async (): Promise<void> => {
      try {
        const res: any = await elk.layout(elkGraph as any);
        const placedNodes: Node[] = (res.children || []).map(
          (child: any): Node => {
            const svc: ServiceNodeData | undefined = sortedServices.find(
              (s: ServiceNodeData): boolean => {
                return s.id === child.id;
              },
            );
            const background: string = svc?.color || "#ffffff";
            const textColor: string = getContrastText(background);
            return {
              id: child.id || "",
              data: { label: svc?.name || "" },
              position: { x: child.x || 0, y: child.y || 0 },
              sourcePosition: Position.Right,
              targetPosition: Position.Left,
              style: {
                borderRadius: 8,
                padding: 8,
                border: "1px solid rgba(0,0,0,0.08)",
                background,
                color: textColor,
                boxShadow: "0 1px 2px rgba(16,24,40,.05)",
                width: NODE_WIDTH,
                height: NODE_HEIGHT,
              },
            } as Node;
          },
        );

        const stroke: string = "#94a3b8"; // slate-400
        const placedEdges: Edge[] = sortedDeps.map(
          (dep: ServiceEdgeData): Edge => {
            return {
              id: `e-${dep.fromServiceId}-${dep.toServiceId}`,
              source: dep.fromServiceId,
              target: dep.toServiceId,
              animated: false,
              style: { stroke, strokeWidth: 2 },
              markerEnd: { type: MarkerType.Arrow, color: stroke },
              type: "smoothstep",
            };
          },
        );

        setRfNodes(placedNodes);
        setRfEdges(placedEdges);
      } catch {
        // Fallback: deterministic grid by name
        const sorted: Array<ServiceNodeData> = sortedServices;
        const COLS: number = 4;
        const GAP_X: number = 260;
        const GAP_Y: number = 120;
        const nodes: Node[] = sorted.map(
          (svc: ServiceNodeData, i: number): Node => {
            const col: number = i % COLS;
            const row: number = Math.floor(i / COLS);
            const x: number = col * GAP_X;
            const y: number = row * GAP_Y;
            const background: string = svc.color || "#ffffff";
            const textColor: string = getContrastText(background);
            return {
              id: svc.id,
              data: { label: svc.name },
              position: { x, y },
              sourcePosition: Position.Right,
              targetPosition: Position.Left,
              style: {
                borderRadius: 8,
                padding: 8,
                border: "1px solid rgba(0,0,0,0.08)",
                background,
                color: textColor,
                boxShadow: "0 1px 2px rgba(16,24,40,.05)",
                width: NODE_WIDTH,
                height: NODE_HEIGHT,
              },
            };
          },
        );
        const stroke: string = "#94a3b8";
        const edges: Edge[] = sortedDeps.map((dep: ServiceEdgeData): Edge => {
          return {
            id: `e-${dep.fromServiceId}-${dep.toServiceId}`,
            source: dep.fromServiceId,
            target: dep.toServiceId,
            animated: false,
            style: { stroke, strokeWidth: 2 },
            markerEnd: { type: MarkerType.Arrow, color: stroke },
            type: "smoothstep",
          };
        });
        setRfNodes(nodes);
        setRfEdges(edges);
      }
    };

    layout();
  }, [props.services, props.dependencies]);

  return (
    <div style={{ width: "100%", height: 600 }}>
      <style>{`
        /* Hide/transparentize connection handles (ports) for read-only view */
        .service-dependency-graph .react-flow__handle {
          background: transparent !important;
          border-color: transparent !important;
        }
      `}</style>
      <ReactFlow
        className="service-dependency-graph"
        nodes={rfNodes}
        edges={rfEdges}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesUpdatable={false}
        connectOnClick={false}
      >
        <MiniMap
          nodeColor={(n: Node): string => {
            return (
              (n.style as any)?.background ||
              (n.data as any)?.color ||
              "#ffffff"
            );
          }}
        />
        <Controls />
        <Background gap={12} size={1} />
      </ReactFlow>
    </div>
  );
};

export default ServiceDependencyGraph;

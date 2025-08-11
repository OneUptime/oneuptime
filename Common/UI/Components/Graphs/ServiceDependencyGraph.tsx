import React, { FunctionComponent, ReactElement, useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  Edge,
  MarkerType,
  MiniMap,
  Node,
} from "reactflow";
import "reactflow/dist/style.css";

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
  const computeLuminance = (r: number, g: number, b: number): number => {
    const transform = (v: number): number => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const R: number = transform(r);
    const G: number = transform(g);
    const B: number = transform(b);
    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
  };

  const getContrastText = (bg?: string): string => {
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
        .map((c) => c + c)
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

  const nodes: Node[] = useMemo(() => {
    return props.services.map((svc: ServiceNodeData) => {
      const background: string = svc.color || "#ffffff";
      const textColor: string = getContrastText(background);
      return {
        id: svc.id,
        data: { label: svc.name },
        position: { x: Math.random() * 600, y: Math.random() * 400 },
        style: {
          borderRadius: 8,
          padding: 8,
          border: "1px solid rgba(0,0,0,0.08)",
          background,
          color: textColor,
          boxShadow: "0 1px 2px rgba(16,24,40,.05)",
        },
      };
    });
  }, [props.services]);

  const edges: Edge[] = useMemo(() => {
    return props.dependencies.map((dep: ServiceEdgeData, idx: number) => {
      const stroke = "#94a3b8"; // slate-400
      return {
        id: `e-${idx}`,
        source: dep.fromServiceId,
        target: dep.toServiceId,
        animated: false,
        style: { stroke, strokeWidth: 2 },
        markerEnd: {
          type: MarkerType.Arrow,
          color: stroke,
        },
        type: "smoothstep",
      };
    });
  }, [props.dependencies]);

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
        nodes={nodes}
        edges={edges}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesUpdatable={false}
        connectOnClick={false}
      >
        <MiniMap
          nodeColor={(n) =>
            (n.style as any)?.background || (n.data as any)?.color || "#ffffff"
          }
        />
        <Controls />
        <Background gap={12} size={1} />
      </ReactFlow>
    </div>
  );
};

export default ServiceDependencyGraph;

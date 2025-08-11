import React, { FunctionComponent, ReactElement, useMemo } from "react";
import ReactFlow, { Background, Controls, Edge, MiniMap, Node } from "reactflow";
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
  const nodes: Node[] = useMemo(() => {
    return props.services.map((svc) => ({
      id: svc.id,
      data: { label: svc.name },
      position: { x: Math.random() * 600, y: Math.random() * 400 },
      style: {
        borderRadius: 8,
        padding: 8,
        border: "1px solid #e5e7eb",
        background: "#fff",
        boxShadow: "0 1px 2px rgba(16,24,40,.05)",
      },
    }));
  }, [props.services]);

  const edges: Edge[] = useMemo(() => {
    return props.dependencies.map((dep, idx) => ({
      id: `e-${idx}`,
      source: dep.fromServiceId,
      target: dep.toServiceId,
      animated: false,
      style: { stroke: "#94a3b8", strokeWidth: 2 },
      markerEnd: {
        type: 2, // MarkerType.Arrow
      } as any,
      type: "smoothstep",
    }));
  }, [props.dependencies]);

  return (
    <div style={{ width: "100%", height: 600 }}>
      <ReactFlow nodes={nodes} edges={edges} fitView>
        <MiniMap />
        <Controls />
        <Background gap={12} size={1} />
      </ReactFlow>
    </div>
  );
};

export default ServiceDependencyGraph;

import SpanUtil, { DivisibilityFactor } from "../../Utils/SpanUtil";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import Service from "Common/Models/DatabaseModels/Service";
import React, { FunctionComponent, ReactElement } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  MarkerType,
  Node,
  NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import computeLayeredLayout, {
  LayoutPoint,
} from "../../Utils/LayeredGraphLayout";
import ServiceNodeCard from "../Topology/ServiceNodeCard";
import {
  HEALTH_COLORS,
  TrafficHealth,
  edgeWidthForCalls,
  healthForErrorRate,
} from "../Topology/TopologyMeta";

/*
 * Per-trace service map: the same aggregation as before (nodes = services
 * touched by this trace, edges = cross-service parent/child span pairs),
 * but rendered with the shared topology stack — layered layout,
 * React Flow, health colors, node cards — so this map and the
 * project-wide Service Map speak one visual language.
 */

export interface TraceServiceMapProps {
  spans: Span[];
  telemetryServices: Service[];
}

interface ServiceNode {
  primaryEntityId: string;
  serviceName: string;
  serviceColor: string;
  spanCount: number;
  errorCount: number;
  totalDurationUnixNano: number;
}

interface ServiceEdge {
  fromServiceId: string;
  toServiceId: string;
  callCount: number;
  totalDurationUnixNano: number;
  errorCount: number;
}

interface TraceNodeData {
  label: string;
  health: TrafficHealth;
  colorDot: string;
  statLines: Array<ReactElement>;
}

const TraceServiceMapNode: FunctionComponent<NodeProps<TraceNodeData>> = (
  props: NodeProps<TraceNodeData>,
): ReactElement => {
  return (
    <ServiceNodeCard
      label={props.data.label}
      health={props.data.health}
      colorDot={props.data.colorDot}
      statLines={props.data.statLines}
    />
  );
};

const NODE_TYPES: Record<
  string,
  FunctionComponent<NodeProps<TraceNodeData>>
> = {
  traceServiceNode: TraceServiceMapNode,
};

const X_GAP: number = 260;
const Y_GAP: number = 130;

const TraceServiceMap: FunctionComponent<TraceServiceMapProps> = (
  props: TraceServiceMapProps,
): ReactElement => {
  const { spans, telemetryServices } = props;

  // Build nodes and edges from spans
  const { nodes, edges } = React.useMemo(() => {
    const nodeMap: Map<string, ServiceNode> = new Map();
    const edgeMap: Map<string, ServiceEdge> = new Map();
    const spanServiceMap: Map<string, string> = new Map(); // spanId -> primaryEntityId

    // First pass: build span -> service mapping and service nodes
    for (const span of spans) {
      const primaryEntityId: string =
        span.primaryEntityId?.toString() || "unknown";
      spanServiceMap.set(span.spanId!, primaryEntityId);

      const existing: ServiceNode | undefined = nodeMap.get(primaryEntityId);
      if (existing) {
        existing.spanCount += 1;
        existing.totalDurationUnixNano += span.durationUnixNano!;
        if (span.statusCode === SpanStatus.Error) {
          existing.errorCount += 1;
        }
      } else {
        const service: Service | undefined = telemetryServices.find(
          (s: Service) => {
            return s._id?.toString() === primaryEntityId;
          },
        );
        nodeMap.set(primaryEntityId, {
          primaryEntityId,
          serviceName: service?.name || "Unknown",
          serviceColor: String(
            (service?.serviceColor as unknown as string) || "#6366f1",
          ),
          spanCount: 1,
          errorCount: span.statusCode === SpanStatus.Error ? 1 : 0,
          totalDurationUnixNano: span.durationUnixNano!,
        });
      }
    }

    // Second pass: build edges from parent-child relationships
    for (const span of spans) {
      if (!span.parentSpanId) {
        continue;
      }

      const parentServiceId: string | undefined = spanServiceMap.get(
        span.parentSpanId,
      );
      const childServiceId: string =
        span.primaryEntityId?.toString() || "unknown";

      if (!parentServiceId || parentServiceId === childServiceId) {
        continue; // Skip same-service calls
      }

      const edgeKey: string = `${parentServiceId}->${childServiceId}`;
      const existing: ServiceEdge | undefined = edgeMap.get(edgeKey);
      if (existing) {
        existing.callCount += 1;
        existing.totalDurationUnixNano += span.durationUnixNano!;
        if (span.statusCode === SpanStatus.Error) {
          existing.errorCount += 1;
        }
      } else {
        edgeMap.set(edgeKey, {
          fromServiceId: parentServiceId,
          toServiceId: childServiceId,
          callCount: 1,
          totalDurationUnixNano: span.durationUnixNano!,
          errorCount: span.statusCode === SpanStatus.Error ? 1 : 0,
        });
      }
    }

    return {
      nodes: Array.from(nodeMap.values()),
      edges: Array.from(edgeMap.values()),
    };
  }, [spans, telemetryServices]);

  // Compute trace duration for context
  const traceDuration: number = React.useMemo(() => {
    if (spans.length === 0) {
      return 0;
    }
    let minStart: number = spans[0]!.startTimeUnixNano!;
    let maxEnd: number = spans[0]!.endTimeUnixNano!;
    for (const span of spans) {
      if (span.startTimeUnixNano! < minStart) {
        minStart = span.startTimeUnixNano!;
      }
      if (span.endTimeUnixNano! > maxEnd) {
        maxEnd = span.endTimeUnixNano!;
      }
    }
    return maxEnd - minStart;
  }, [spans]);

  const divisibilityFactor: DivisibilityFactor =
    SpanUtil.getDivisibilityFactor(traceDuration);

  const { flowNodes, flowEdges } = React.useMemo((): {
    flowNodes: Array<Node<TraceNodeData>>;
    flowEdges: Array<Edge>;
  } => {
    const layout: Map<string, LayoutPoint> = computeLayeredLayout(
      nodes.map((node: ServiceNode) => {
        return node.primaryEntityId;
      }),
      edges.map((edge: ServiceEdge) => {
        return { from: edge.fromServiceId, to: edge.toServiceId };
      }),
      { xGap: X_GAP, yGap: Y_GAP },
    );

    const flowNodes: Array<Node<TraceNodeData>> = nodes.map(
      (node: ServiceNode): Node<TraceNodeData> => {
        const health: TrafficHealth = healthForErrorRate(
          node.spanCount,
          node.errorCount,
        );
        const statLines: Array<ReactElement> = [
          <span key="stats">
            {node.spanCount} span{node.spanCount === 1 ? "" : "s"}
            {node.errorCount > 0 && (
              <span style={{ color: HEALTH_COLORS[health], marginLeft: 8 }}>
                {node.errorCount} error{node.errorCount === 1 ? "" : "s"}
              </span>
            )}
          </span>,
          <span key="duration">
            {SpanUtil.getSpanDurationAsString({
              spanDurationInUnixNano: node.totalDurationUnixNano,
              divisibilityFactor: divisibilityFactor,
            })}
          </span>,
        ];
        return {
          id: node.primaryEntityId,
          type: "traceServiceNode",
          position: layout.get(node.primaryEntityId) || { x: 0, y: 0 },
          data: {
            label: node.serviceName,
            health,
            colorDot: node.serviceColor,
            statLines,
          },
        };
      },
    );

    const flowEdges: Array<Edge> = edges.map((edge: ServiceEdge): Edge => {
      const health: TrafficHealth = healthForErrorRate(
        edge.callCount,
        edge.errorCount,
      );
      const color: string =
        health === "unknown" ? "#94a3b8" : HEALTH_COLORS[health];
      const avgDuration: number =
        edge.callCount > 0 ? edge.totalDurationUnixNano / edge.callCount : 0;
      const durationStr: string = SpanUtil.getSpanDurationAsString({
        spanDurationInUnixNano: avgDuration,
        divisibilityFactor: divisibilityFactor,
      });
      return {
        id: `${edge.fromServiceId}->${edge.toServiceId}`,
        source: edge.fromServiceId,
        target: edge.toServiceId,
        type: "smoothstep",
        label: `${edge.callCount}x · avg ${durationStr}${
          edge.errorCount > 0
            ? ` · ${edge.errorCount} error${edge.errorCount === 1 ? "" : "s"}`
            : ""
        }`,
        labelStyle: { fontSize: 10, fill: "#6b7280" },
        labelBgStyle: {
          fill: "var(--ou-surface-primary, #ffffff)",
          fillOpacity: 0.85,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color },
        style: {
          stroke: color,
          strokeWidth: edgeWidthForCalls(edge.callCount),
        },
      };
    });

    return { flowNodes, flowEdges };
  }, [nodes, edges, divisibilityFactor]);

  if (nodes.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500 text-sm">
        No services found in this trace
      </div>
    );
  }

  return (
    <div className="trace-service-map">
      <div className="text-[11px] text-gray-500 mb-2 px-1">
        Service flow for this trace. Arrows show cross-service calls with count
        and latency.
      </div>
      <div
        className="rounded border border-gray-200 bg-gray-50"
        style={{ height: "420px", width: "100%" }}
      >
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={NODE_TYPES}
          fitView={true}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={true}
          nodesConnectable={false}
          elementsSelectable={false}
        >
          <Controls showInteractive={false} />
          <Background
            variant={BackgroundVariant.Dots}
            gap={16}
            size={1}
            color="var(--ou-chart-grid, #cbd5e1)"
          />
        </ReactFlow>
      </div>
    </div>
  );
};

export default TraceServiceMap;

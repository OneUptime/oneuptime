import SpanUtil, { DivisibilityFactor } from "../../Utils/SpanUtil";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import Service from "Common/Models/DatabaseModels/Service";
import React, { FunctionComponent, ReactElement } from "react";

export interface TraceServiceMapProps {
  spans: Span[];
  telemetryServices: Service[];
}

interface ServiceNode {
  serviceId: string;
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

const TraceServiceMap: FunctionComponent<TraceServiceMapProps> = (
  props: TraceServiceMapProps,
): ReactElement => {
  const { spans, telemetryServices } = props;

  // Build nodes and edges from spans
  const { nodes, edges } = React.useMemo(() => {
    const nodeMap: Map<string, ServiceNode> = new Map();
    const edgeMap: Map<string, ServiceEdge> = new Map();
    const spanServiceMap: Map<string, string> = new Map(); // spanId -> serviceId

    // First pass: build span -> service mapping and service nodes
    for (const span of spans) {
      const serviceId: string = span.serviceId?.toString() || "unknown";
      spanServiceMap.set(span.spanId!, serviceId);

      const existing: ServiceNode | undefined = nodeMap.get(serviceId);
      if (existing) {
        existing.spanCount += 1;
        existing.totalDurationUnixNano += span.durationUnixNano!;
        if (span.statusCode === SpanStatus.Error) {
          existing.errorCount += 1;
        }
      } else {
        const service: Service | undefined = telemetryServices.find(
          (s: Service) => {
            return s._id?.toString() === serviceId;
          },
        );
        nodeMap.set(serviceId, {
          serviceId,
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
      const childServiceId: string = span.serviceId?.toString() || "unknown";

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

  if (nodes.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500 text-sm">
        No services found in this trace
      </div>
    );
  }

  /*
   * Layout: arrange nodes in a topological order based on edges
   * Simple layout: find entry nodes and lay out left-to-right
   */
  const { nodePositions, layoutWidth, layoutHeight } = React.useMemo(() => {
    // Build adjacency list
    const adjList: Map<string, string[]> = new Map();
    const inDegree: Map<string, number> = new Map();

    for (const node of nodes) {
      adjList.set(node.serviceId, []);
      inDegree.set(node.serviceId, 0);
    }

    for (const edge of edges) {
      const neighbors: string[] = adjList.get(edge.fromServiceId) || [];
      neighbors.push(edge.toServiceId);
      adjList.set(edge.fromServiceId, neighbors);
      inDegree.set(edge.toServiceId, (inDegree.get(edge.toServiceId) || 0) + 1);
    }

    // Topological sort using BFS (Kahn's algorithm)
    const queue: string[] = [];
    for (const [nodeId, degree] of inDegree.entries()) {
      if (degree === 0) {
        queue.push(nodeId);
      }
    }

    const levels: Map<string, number> = new Map();
    let level: number = 0;
    const levelNodes: string[][] = [];

    while (queue.length > 0) {
      const levelSize: number = queue.length;
      const currentLevel: string[] = [];

      for (let i: number = 0; i < levelSize; i++) {
        const nodeId: string = queue.shift()!;
        levels.set(nodeId, level);
        currentLevel.push(nodeId);

        const neighbors: string[] = adjList.get(nodeId) || [];
        for (const neighbor of neighbors) {
          const newDegree: number = (inDegree.get(neighbor) || 1) - 1;
          inDegree.set(neighbor, newDegree);
          if (newDegree === 0) {
            queue.push(neighbor);
          }
        }
      }

      levelNodes.push(currentLevel);
      level++;
    }

    // Handle cycles - place unvisited nodes at the end
    for (const node of nodes) {
      if (!levels.has(node.serviceId)) {
        if (levelNodes.length === 0) {
          levelNodes.push([]);
        }
        levelNodes[levelNodes.length - 1]!.push(node.serviceId);
        levels.set(node.serviceId, levelNodes.length - 1);
      }
    }

    // Compute positions
    const nodeWidth: number = 200;
    const nodeHeight: number = 80;
    const horizontalGap: number = 120;
    const verticalGap: number = 40;

    const positions: Map<string, { x: number; y: number }> = new Map();
    let maxX: number = 0;
    let maxY: number = 0;

    for (let l: number = 0; l < levelNodes.length; l++) {
      const levelNodeIds: string[] = levelNodes[l]!;
      const x: number = l * (nodeWidth + horizontalGap) + 20;

      for (let n: number = 0; n < levelNodeIds.length; n++) {
        const y: number = n * (nodeHeight + verticalGap) + 20;
        positions.set(levelNodeIds[n]!, { x, y });
        if (x + nodeWidth > maxX) {
          maxX = x + nodeWidth;
        }
        if (y + nodeHeight > maxY) {
          maxY = y + nodeHeight;
        }
      }
    }

    return {
      nodePositions: positions,
      layoutWidth: maxX + 40,
      layoutHeight: maxY + 40,
    };
  }, [nodes, edges]);

  const nodeWidth: number = 200;
  const nodeHeight: number = 80;

  return (
    <div className="trace-service-map">
      <div className="text-[11px] text-gray-500 mb-2 px-1">
        Service flow for this trace. Arrows show cross-service calls with count
        and latency.
      </div>
      <div
        className="relative overflow-auto rounded border border-gray-200 bg-gray-50"
        style={{
          minHeight: `${Math.max(layoutHeight, 200)}px`,
        }}
      >
        <svg
          width={layoutWidth}
          height={layoutHeight}
          className="absolute top-0 left-0"
        >
          {/* Render edges */}
          {edges.map((edge: ServiceEdge) => {
            const fromPos: { x: number; y: number } | undefined =
              nodePositions.get(edge.fromServiceId);
            const toPos: { x: number; y: number } | undefined =
              nodePositions.get(edge.toServiceId);

            if (!fromPos || !toPos) {
              return null;
            }

            const x1: number = fromPos.x + nodeWidth;
            const y1: number = fromPos.y + nodeHeight / 2;
            const x2: number = toPos.x;
            const y2: number = toPos.y + nodeHeight / 2;

            const midX: number = (x1 + x2) / 2;

            const hasError: boolean = edge.errorCount > 0;
            const strokeColor: string = hasError ? "#ef4444" : "#9ca3af";

            const avgDuration: number =
              edge.callCount > 0
                ? edge.totalDurationUnixNano / edge.callCount
                : 0;
            const durationStr: string = SpanUtil.getSpanDurationAsString({
              spanDurationInUnixNano: avgDuration,
              divisibilityFactor: divisibilityFactor,
            });

            const edgeKey: string = `${edge.fromServiceId}->${edge.toServiceId}`;

            return (
              <g key={edgeKey}>
                {/* Curved path */}
                <path
                  d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={Math.min(2 + edge.callCount * 0.5, 5)}
                  strokeDasharray={hasError ? "4,4" : "none"}
                  markerEnd="url(#arrowhead)"
                />
                {/* Label */}
                <text
                  x={midX}
                  y={(y1 + y2) / 2 - 8}
                  textAnchor="middle"
                  className="text-[10px] fill-gray-500"
                >
                  {edge.callCount}x | avg {durationStr}
                </text>
                {hasError ? (
                  <text
                    x={midX}
                    y={(y1 + y2) / 2 + 6}
                    textAnchor="middle"
                    className="text-[9px] fill-red-500 font-medium"
                  >
                    {edge.errorCount} error{edge.errorCount > 1 ? "s" : ""}
                  </text>
                ) : (
                  <></>
                )}
              </g>
            );
          })}
          {/* Arrow marker definition */}
          <defs>
            <marker
              id="arrowhead"
              markerWidth="8"
              markerHeight="6"
              refX="8"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 8 3, 0 6" fill="#9ca3af" />
            </marker>
          </defs>
        </svg>

        {/* Render nodes */}
        {nodes.map((node: ServiceNode) => {
          const pos: { x: number; y: number } | undefined = nodePositions.get(
            node.serviceId,
          );
          if (!pos) {
            return null;
          }

          const hasErrors: boolean = node.errorCount > 0;

          return (
            <div
              key={node.serviceId}
              className={`absolute rounded-lg border-2 bg-white shadow-sm p-3 ${
                hasErrors ? "border-red-300" : "border-gray-200"
              }`}
              style={{
                left: `${pos.x}px`,
                top: `${pos.y}px`,
                width: `${nodeWidth}px`,
                height: `${nodeHeight}px`,
              }}
            >
              <div className="flex items-center space-x-2 mb-1">
                <span
                  className="h-3 w-3 rounded-sm ring-1 ring-black/10 flex-shrink-0"
                  style={{ backgroundColor: node.serviceColor }}
                />
                <span className="text-xs font-semibold text-gray-800 truncate">
                  {node.serviceName}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-3 text-[10px] text-gray-500">
                <span>{node.spanCount} spans</span>
                {hasErrors ? (
                  <span className="text-red-600 font-medium">
                    {node.errorCount} errors
                  </span>
                ) : (
                  <></>
                )}
              </div>
              <div className="text-[10px] text-gray-400 mt-0.5">
                {SpanUtil.getSpanDurationAsString({
                  spanDurationInUnixNano: node.totalDurationUnixNano,
                  divisibilityFactor: divisibilityFactor,
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TraceServiceMap;

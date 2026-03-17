import SpanUtil from "../../Utils/SpanUtil";
import CriticalPathUtil, {
  SpanData,
  SpanSelfTime,
} from "Common/Utils/Traces/CriticalPath";
import Span from "Common/Models/AnalyticsModels/Span";
import Service from "Common/Models/DatabaseModels/Service";
import Color from "Common/Types/Color";
import { Black } from "Common/Types/BrandColors";
import React, { FunctionComponent, ReactElement } from "react";

export interface FlameGraphProps {
  spans: Span[];
  telemetryServices: Service[];
  onSpanSelect?: (spanId: string) => void;
  selectedSpanId: string | undefined;
}

interface FlameGraphNode {
  span: Span;
  children: FlameGraphNode[];
  depth: number;
  startTimeUnixNano: number;
  endTimeUnixNano: number;
  durationUnixNano: number;
  selfTimeUnixNano: number;
  serviceColor: Color;
  serviceName: string;
}

const MIN_BLOCK_WIDTH_PX: number = 2;

const FlameGraph: FunctionComponent<FlameGraphProps> = (
  props: FlameGraphProps,
): ReactElement => {
  const { spans, telemetryServices, onSpanSelect, selectedSpanId } = props;

  const [hoveredSpanId, setHoveredSpanId] = React.useState<string | null>(null);
  const [focusedSpanId, setFocusedSpanId] = React.useState<string | null>(null);
  const containerRef: React.RefObject<HTMLDivElement | null> = React.useRef<HTMLDivElement>(null);

  // Build span data for critical path utility
  const spanDataList: SpanData[] = React.useMemo(() => {
    return spans.map((span: Span): SpanData => {
      return {
        spanId: span.spanId!,
        parentSpanId: span.parentSpanId || undefined,
        startTimeUnixNano: span.startTimeUnixNano!,
        endTimeUnixNano: span.endTimeUnixNano!,
        durationUnixNano: span.durationUnixNano!,
        serviceId: span.serviceId?.toString(),
        name: span.name,
      };
    });
  }, [spans]);

  // Compute self-times
  const selfTimes: Map<string, SpanSelfTime> = React.useMemo(() => {
    return CriticalPathUtil.computeSelfTimes(spanDataList);
  }, [spanDataList]);

  // Build tree structure
  const { rootNodes, traceStart, traceEnd } = React.useMemo(() => {
    if (spans.length === 0) {
      return { rootNodes: [], traceStart: 0, traceEnd: 0 };
    }

    const spanMap: Map<string, Span> = new Map();
    const childrenMap: Map<string, Span[]> = new Map();
    const allSpanIds: Set<string> = new Set();
    let tStart: number = spans[0]!.startTimeUnixNano!;
    let tEnd: number = spans[0]!.endTimeUnixNano!;

    for (const span of spans) {
      spanMap.set(span.spanId!, span);
      allSpanIds.add(span.spanId!);
      if (span.startTimeUnixNano! < tStart) {
        tStart = span.startTimeUnixNano!;
      }
      if (span.endTimeUnixNano! > tEnd) {
        tEnd = span.endTimeUnixNano!;
      }
    }

    for (const span of spans) {
      if (span.parentSpanId && allSpanIds.has(span.parentSpanId)) {
        const children: Span[] = childrenMap.get(span.parentSpanId) || [];
        children.push(span);
        childrenMap.set(span.parentSpanId, children);
      }
    }

    const getServiceInfo = (
      span: Span,
    ): { color: Color; name: string } => {
      const service: Service | undefined = telemetryServices.find(
        (s: Service) => {
          return s._id?.toString() === span.serviceId?.toString();
        },
      );
      return {
        color: (service?.serviceColor as Color) || Black,
        name: service?.name || "Unknown",
      };
    };

    const buildNode = (span: Span, depth: number): FlameGraphNode => {
      const children: Span[] = childrenMap.get(span.spanId!) || [];
      const selfTime: SpanSelfTime | undefined = selfTimes.get(span.spanId!);
      const serviceInfo: { color: Color; name: string } = getServiceInfo(span);

      // Sort children by start time
      children.sort((a: Span, b: Span) => {
        return a.startTimeUnixNano! - b.startTimeUnixNano!;
      });

      return {
        span,
        children: children.map((child: Span) => {
          return buildNode(child, depth + 1);
        }),
        depth,
        startTimeUnixNano: span.startTimeUnixNano!,
        endTimeUnixNano: span.endTimeUnixNano!,
        durationUnixNano: span.durationUnixNano!,
        selfTimeUnixNano: selfTime ? selfTime.selfTimeUnixNano : span.durationUnixNano!,
        serviceColor: serviceInfo.color,
        serviceName: serviceInfo.name,
      };
    };

    // Find root spans
    const roots: Span[] = spans.filter((span: Span) => {
      const p: string | undefined = span.parentSpanId;
      if (!p || p.trim() === "") {
        return true;
      }
      if (!allSpanIds.has(p)) {
        return true;
      }
      return false;
    });

    const effectiveRoots: Span[] = roots.length > 0 ? roots : [spans[0]!];

    return {
      rootNodes: effectiveRoots.map((root: Span) => {
        return buildNode(root, 0);
      }),
      traceStart: tStart,
      traceEnd: tEnd,
    };
  }, [spans, telemetryServices, selfTimes]);

  // Find max depth for height calculation
  const maxDepth: number = React.useMemo(() => {
    let max: number = 0;
    const traverse = (node: FlameGraphNode): void => {
      if (node.depth > max) {
        max = node.depth;
      }
      for (const child of node.children) {
        traverse(child);
      }
    };
    for (const root of rootNodes) {
      traverse(root);
    }
    return max;
  }, [rootNodes]);

  // Find the focused subtree range for zoom
  const { viewStart, viewEnd } = React.useMemo(() => {
    if (!focusedSpanId) {
      return { viewStart: traceStart, viewEnd: traceEnd };
    }

    const findNode = (nodes: FlameGraphNode[]): FlameGraphNode | null => {
      for (const node of nodes) {
        if (node.span.spanId === focusedSpanId) {
          return node;
        }
        const found: FlameGraphNode | null = findNode(node.children);
        if (found) {
          return found;
        }
      }
      return null;
    };

    const focused: FlameGraphNode | null = findNode(rootNodes);
    if (focused) {
      return {
        viewStart: focused.startTimeUnixNano,
        viewEnd: focused.endTimeUnixNano,
      };
    }
    return { viewStart: traceStart, viewEnd: traceEnd };
  }, [focusedSpanId, rootNodes, traceStart, traceEnd]);

  const totalDuration: number = viewEnd - viewStart;
  const rowHeight: number = 24;
  const chartHeight: number = (maxDepth + 1) * rowHeight + 8;

  if (spans.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500 text-sm">
        No spans to display
      </div>
    );
  }

  const renderNode = (node: FlameGraphNode): ReactElement | null => {
    // Calculate position relative to view
    const nodeStart: number = Math.max(node.startTimeUnixNano, viewStart);
    const nodeEnd: number = Math.min(node.endTimeUnixNano, viewEnd);

    if (nodeEnd <= nodeStart) {
      return null; // Not in view
    }

    const leftPercent: number =
      totalDuration > 0
        ? ((nodeStart - viewStart) / totalDuration) * 100
        : 0;
    const widthPercent: number =
      totalDuration > 0
        ? ((nodeEnd - nodeStart) / totalDuration) * 100
        : 0;

    const isHovered: boolean = hoveredSpanId === node.span.spanId;
    const isSelected: boolean = selectedSpanId === node.span.spanId;
    const isFocused: boolean = focusedSpanId === node.span.spanId;

    const durationStr: string = SpanUtil.getSpanDurationAsString({
      spanDurationInUnixNano: node.durationUnixNano,
      divisibilityFactor: SpanUtil.getDivisibilityFactor(totalDuration),
    });

    const selfTimeStr: string = SpanUtil.getSpanDurationAsString({
      spanDurationInUnixNano: node.selfTimeUnixNano,
      divisibilityFactor: SpanUtil.getDivisibilityFactor(totalDuration),
    });

    const colorStr: string = String(node.serviceColor);

    return (
      <React.Fragment key={node.span.spanId}>
        <div
          className={`absolute cursor-pointer border border-white/30 transition-opacity overflow-hidden ${
            isSelected
              ? "ring-2 ring-indigo-500 ring-offset-1 z-10"
              : isHovered
                ? "ring-1 ring-gray-400 z-10"
                : ""
          } ${isFocused ? "ring-2 ring-amber-400 z-10" : ""}`}
          style={{
            left: `${leftPercent}%`,
            width: `${Math.max(widthPercent, 0.1)}%`,
            top: `${node.depth * rowHeight}px`,
            height: `${rowHeight - 2}px`,
            backgroundColor: colorStr,
            opacity: isHovered || isSelected ? 1 : 0.85,
            minWidth: `${MIN_BLOCK_WIDTH_PX}px`,
          }}
          onMouseEnter={() => {
            setHoveredSpanId(node.span.spanId!);
          }}
          onMouseLeave={() => {
            setHoveredSpanId(null);
          }}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            if (onSpanSelect) {
              onSpanSelect(node.span.spanId!);
            }
          }}
          onDoubleClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            setFocusedSpanId((prev: string | null) => {
              return prev === node.span.spanId! ? null : node.span.spanId!;
            });
          }}
          title={`${node.span.name} (${node.serviceName})\nDuration: ${durationStr}\nSelf Time: ${selfTimeStr}`}
        >
          {widthPercent > 3 ? (
            <div className="px-1 text-[10px] font-medium text-white truncate leading-snug pt-0.5">
              {node.span.name}
            </div>
          ) : (
            <></>
          )}
        </div>
        {node.children.map((child: FlameGraphNode) => {
          return renderNode(child);
        })}
      </React.Fragment>
    );
  };

  const hoveredNode: FlameGraphNode | null = React.useMemo(() => {
    if (!hoveredSpanId) {
      return null;
    }
    const findNode = (nodes: FlameGraphNode[]): FlameGraphNode | null => {
      for (const node of nodes) {
        if (node.span.spanId === hoveredSpanId) {
          return node;
        }
        const found: FlameGraphNode | null = findNode(node.children);
        if (found) {
          return found;
        }
      }
      return null;
    };
    return findNode(rootNodes);
  }, [hoveredSpanId, rootNodes]);

  return (
    <div className="flame-graph" ref={containerRef}>
      {/* Controls */}
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="text-[11px] text-gray-500">
          Click a span to view details. Double-click to zoom into a subtree.
        </div>
        {focusedSpanId ? (
          <button
            type="button"
            onClick={() => {
              setFocusedSpanId(null);
            }}
            className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
          >
            Reset Zoom
          </button>
        ) : (
          <></>
        )}
      </div>

      {/* Flame graph */}
      <div
        className="relative overflow-hidden rounded border border-gray-200 bg-gray-50"
        style={{ height: `${chartHeight}px` }}
      >
        {rootNodes.map((root: FlameGraphNode) => {
          return renderNode(root);
        })}
      </div>

      {/* Tooltip */}
      {hoveredNode ? (
        <div className="mt-2 px-3 py-2 rounded-md border border-gray-200 bg-white/90 text-xs space-y-1">
          <div className="font-semibold text-gray-800">
            {hoveredNode.span.name}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-gray-600">
            <div>
              <span className="font-medium text-gray-700">Service: </span>
              {hoveredNode.serviceName}
            </div>
            <div>
              <span className="font-medium text-gray-700">Duration: </span>
              {SpanUtil.getSpanDurationAsString({
                spanDurationInUnixNano: hoveredNode.durationUnixNano,
                divisibilityFactor:
                  SpanUtil.getDivisibilityFactor(totalDuration),
              })}
            </div>
            <div>
              <span className="font-medium text-gray-700">Self Time: </span>
              {SpanUtil.getSpanDurationAsString({
                spanDurationInUnixNano: hoveredNode.selfTimeUnixNano,
                divisibilityFactor:
                  SpanUtil.getDivisibilityFactor(totalDuration),
              })}
            </div>
          </div>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default FlameGraph;

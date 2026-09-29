import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  HighlightSegment,
  TraceServiceInfo,
  formatDurationNano,
  formatOffsetNano,
  getServiceInfo,
  splitHighlightSegments,
} from "../../../Utils/TraceDetailPresentation";
import {
  BarGeometry,
  SpanTree,
  TimeViewport,
  TimelineTick,
  TreeKeyAction,
  VirtualWindow,
  WATERFALL_ROW_HEIGHT_PX,
  WaterfallRow,
  computeTimelineTicks,
  computeVirtualWindow,
  getBarGeometry,
  getScrollTopToReveal,
  getWaterfallBodyHeight,
  resolveTreeKeyAction,
} from "../../../Utils/TraceWaterfall";
import TraceTimelineMinimap from "./TraceTimelineMinimap";

const OVERSCAN_ROWS: number = 10;
const MAX_TICKS: number = 6;
const DEFAULT_NAME_COLUMN_PERCENT: number = 40;
const MIN_NAME_COLUMN_PERCENT: number = 18;
const MAX_NAME_COLUMN_PERCENT: number = 65;
const ERROR_BAR_COLOR: string = "#ef4444";

export interface ComponentProps {
  tree: SpanTree;
  rows: Array<WaterfallRow>;
  serviceInfoById: Map<string, TraceServiceInfo>;
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string | null) => void;
  onSetCollapsed: (spanId: string, isCollapsed: boolean) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  // Spans named in the page URL (?spanId=).
  linkedSpanIds: Set<string>;
  criticalPathSpanIds: Set<string> | null;
  searchText: string;
  viewport: TimeViewport;
  onViewportChange: (viewport: TimeViewport) => void;
  // Bumped to scroll the selected span into view even if it did not change.
  revealRequest: number;
  // Shown when a filter hides every span.
  emptyMessage: string;
}

/*
 * Error spans keep their service colour (so the bar still says which service
 * ran it) inside a red outline; selection and the critical path add rings.
 * Built as one inline box-shadow, since an inline shadow overrides ring classes.
 */
function getBarShadow(data: {
  isError: boolean;
  isSelected: boolean;
  isOnCriticalPath: boolean;
}): string | undefined {
  const shadows: Array<string> = [];
  if (data.isError) {
    shadows.push("inset 0 0 0 1px #ffffff", `0 0 0 1.5px ${ERROR_BAR_COLOR}`);
  }
  if (data.isSelected) {
    shadows.push(
      `0 0 0 ${data.isError ? 3 : 1}px #ffffff`,
      `0 0 0 ${data.isError ? 5 : 3}px #6366f1`,
    );
  } else if (data.isOnCriticalPath) {
    shadows.push(`0 0 0 ${data.isError ? 3 : 1.5}px rgba(17, 24, 39, 0.7)`);
  }
  return shadows.length > 0 ? shadows.join(", ") : undefined;
}

function clampNamePercent(value: number): number {
  return Math.min(
    MAX_NAME_COLUMN_PERCENT,
    Math.max(MIN_NAME_COLUMN_PERCENT, value),
  );
}

const HighlightedText: FunctionComponent<{
  text: string;
  searchText: string;
}> = (props: { text: string; searchText: string }): ReactElement => {
  const segments: Array<HighlightSegment> = splitHighlightSegments(
    props.text,
    props.searchText,
  );
  return (
    <>
      {segments.map(
        (segment: HighlightSegment, index: number): ReactElement => {
          return segment.isMatch ? (
            <mark
              key={index}
              className="rounded-sm bg-amber-100 px-px text-amber-700"
            >
              {segment.text}
            </mark>
          ) : (
            <React.Fragment key={index}>{segment.text}</React.Fragment>
          );
        },
      )}
    </>
  );
};

/*
 * The span waterfall: a virtualised tree (only the rows in view are in the
 * DOM, so a 10,000-span trace scrolls like a 10-span one) with a resizable
 * name column, a zoomable time axis and full keyboard navigation.
 */
const TraceWaterfall: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { tree, rows, viewport } = props;

  const containerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const bodyRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState<number>(0);
  const [namePercent, setNamePercent] = useState<number>(
    DEFAULT_NAME_COLUMN_PERCENT,
  );

  const [windowHeight, setWindowHeight] = useState<number>(
    typeof window !== "undefined" ? window.innerHeight : 0,
  );

  useEffect(() => {
    const onResize: () => void = (): void => {
      setWindowHeight(window.innerHeight);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const totalHeight: number = rows.length * WATERFALL_ROW_HEIGHT_PX;
  const bodyHeight: number = getWaterfallBodyHeight({
    totalHeight,
    windowHeight,
  });

  const virtualWindow: VirtualWindow = computeVirtualWindow({
    scrollTop,
    viewportHeight: bodyHeight,
    rowHeight: WATERFALL_ROW_HEIGHT_PX,
    rowCount: rows.length,
    overscan: OVERSCAN_ROWS,
  });

  const ticks: Array<TimelineTick> = useMemo(() => {
    return computeTimelineTicks(tree.durationUnixNano, viewport, MAX_TICKS);
  }, [tree.durationUnixNano, viewport]);

  const rowIndexBySpanId: Map<string, number> = useMemo(() => {
    const map: Map<string, number> = new Map();
    rows.forEach((row: WaterfallRow, index: number) => {
      map.set(row.node.span.spanId, index);
    });
    return map;
  }, [rows]);

  // Keep the selected span in view when it changes or a reveal is requested.
  useEffect(() => {
    if (!props.selectedSpanId || !bodyRef.current) {
      return;
    }
    const rowIndex: number | undefined = rowIndexBySpanId.get(
      props.selectedSpanId,
    );
    if (rowIndex === undefined) {
      return;
    }
    const nextScrollTop: number | null = getScrollTopToReveal({
      rowIndex,
      rowHeight: WATERFALL_ROW_HEIGHT_PX,
      scrollTop: bodyRef.current.scrollTop,
      viewportHeight: bodyHeight,
    });
    if (nextScrollTop !== null) {
      bodyRef.current.scrollTop = nextScrollTop;
      setScrollTop(nextScrollTop);
    }
  }, [props.selectedSpanId, props.revealRequest, rowIndexBySpanId]);

  const handleKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    const action: TreeKeyAction | null = resolveTreeKeyAction({
      key: event.key,
      rows,
      selectedSpanId: props.selectedSpanId,
      parentById: tree.parentById,
    });
    if (!action) {
      return;
    }
    event.preventDefault();
    if (action.type === "select") {
      props.onSelectSpan(action.spanId);
    } else if (action.type === "expand") {
      props.onSetCollapsed(action.spanId, false);
    } else if (action.type === "collapse") {
      props.onSetCollapsed(action.spanId, true);
    } else {
      props.onSelectSpan(null);
    }
  };

  const startResize: (event: React.PointerEvent<HTMLDivElement>) => void = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    event.preventDefault();
    const rect: DOMRect | undefined =
      containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) {
      return;
    }
    const onMove: (moveEvent: PointerEvent) => void = (
      moveEvent: PointerEvent,
    ): void => {
      setNamePercent(
        clampNamePercent(((moveEvent.clientX - rect.left) / rect.width) * 100),
      );
    };
    const onUp: () => void = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const timelineStyle: React.CSSProperties = {
    left: `${namePercent}%`,
    right: 0,
  };

  const visibleRows: Array<WaterfallRow> = rows.slice(
    virtualWindow.startIndex,
    virtualWindow.endIndex,
  );

  return (
    <div
      className="overflow-hidden rounded-lg border border-gray-200 bg-white"
      data-testid="trace-waterfall"
    >
      <TraceTimelineMinimap
        tree={tree}
        serviceInfoById={props.serviceInfoById}
        viewport={viewport}
        onViewportChange={props.onViewportChange}
      />
      <div className="overflow-x-auto">
        <div ref={containerRef} className="relative min-w-[720px]">
          {/* Header: column title, tree controls and the time axis. */}
          <div className="relative flex h-9 items-stretch border-b border-gray-200 bg-gray-50 text-[11px] text-gray-500">
            <div
              className="flex min-w-0 items-center justify-between gap-2 pl-3 pr-2"
              style={{ width: `${namePercent}%` }}
            >
              <span className="truncate font-medium uppercase tracking-wide">
                Span
              </span>
              <span className="flex flex-none items-center gap-0.5">
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 font-medium text-gray-500 hover:bg-gray-200 hover:text-gray-800"
                  onClick={props.onExpandAll}
                  data-testid="trace-expand-all"
                >
                  Expand all
                </button>
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 font-medium text-gray-500 hover:bg-gray-200 hover:text-gray-800"
                  onClick={props.onCollapseAll}
                  data-testid="trace-collapse-all"
                >
                  Collapse all
                </button>
              </span>
            </div>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize the span name column"
              aria-valuenow={Math.round(namePercent)}
              aria-valuemin={MIN_NAME_COLUMN_PERCENT}
              aria-valuemax={MAX_NAME_COLUMN_PERCENT}
              tabIndex={0}
              className="group absolute inset-y-0 z-10 -ml-1.5 w-3 cursor-col-resize focus:outline-none"
              style={{ left: `${namePercent}%` }}
              onPointerDown={startResize}
              onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  setNamePercent((current: number) => {
                    return clampNamePercent(
                      current + (event.key === "ArrowLeft" ? -2 : 2),
                    );
                  });
                }
              }}
            >
              <div className="mx-auto h-full w-px bg-gray-200 group-hover:w-0.5 group-hover:bg-indigo-400 group-focus:w-0.5 group-focus:bg-indigo-500" />
            </div>
            <div
              className="absolute inset-y-0 overflow-hidden"
              style={timelineStyle}
            >
              {ticks.map((tick: TimelineTick): ReactElement => {
                // Labels near the right edge sit left of their tick line.
                const isNearEnd: boolean = tick.percent > 90;
                return (
                  <span
                    key={tick.offsetUnixNano}
                    className={`absolute top-1/2 -translate-y-1/2 whitespace-nowrap tabular-nums ${isNearEnd ? "-translate-x-full pr-1.5" : "pl-1.5"}`}
                    style={{ left: `${tick.percent}%` }}
                    data-testid="trace-axis-tick"
                  >
                    {tick.label}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Body: the virtualised rows. */}
          <div
            ref={bodyRef}
            role="tree"
            aria-label="Spans in this trace"
            aria-multiselectable={false}
            tabIndex={0}
            className="relative overflow-y-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
            style={{ height: `${bodyHeight}px` }}
            onScroll={(event: React.UIEvent<HTMLDivElement>) => {
              setScrollTop(event.currentTarget.scrollTop);
            }}
            onKeyDown={handleKeyDown}
            data-testid="trace-waterfall-body"
            // Rows are virtualised; this is how many the tree shows in total.
            data-row-count={rows.length}
          >
            <div className="relative" style={{ height: `${totalHeight}px` }}>
              <div
                className="pointer-events-none absolute inset-y-0 border-l border-gray-200"
                style={timelineStyle}
                aria-hidden="true"
              >
                {ticks.map((tick: TimelineTick): ReactElement => {
                  return (
                    <div
                      key={tick.offsetUnixNano}
                      className="absolute inset-y-0 border-l border-dashed border-gray-100"
                      style={{ left: `${tick.percent}%` }}
                    />
                  );
                })}
              </div>

              {rows.length === 0 && (
                <div
                  className="absolute inset-x-0 top-6 text-center text-sm text-gray-500"
                  data-testid="trace-waterfall-empty"
                >
                  {props.emptyMessage}
                </div>
              )}

              {visibleRows.map(
                (row: WaterfallRow, offset: number): ReactElement => {
                  const index: number = virtualWindow.startIndex + offset;
                  const span: WaterfallRow["node"]["span"] = row.node.span;
                  const service: TraceServiceInfo = getServiceInfo(
                    props.serviceInfoById,
                    span.serviceId,
                  );
                  const parentId: string | undefined = tree.parentById.get(
                    span.spanId,
                  );
                  const parentServiceId: string | undefined = parentId
                    ? tree.nodesById.get(parentId)?.span.serviceId
                    : undefined;
                  const showServiceName: boolean =
                    parentServiceId === undefined ||
                    parentServiceId !== span.serviceId;
                  const isSelected: boolean =
                    props.selectedSpanId === span.spanId;
                  const isLinked: boolean = props.linkedSpanIds.has(
                    span.spanId,
                  );
                  const isOffCriticalPath: boolean = Boolean(
                    props.criticalPathSpanIds &&
                      !props.criticalPathSpanIds.has(span.spanId),
                  );
                  const geometry: BarGeometry = getBarGeometry({
                    span,
                    traceStartUnixNano: tree.startTimeUnixNano,
                    traceDurationUnixNano: tree.durationUnixNano,
                    viewport,
                  });
                  const durationLabel: string = formatDurationNano(
                    span.durationUnixNano,
                  );
                  const indentPx: number =
                    row.depth * (row.depth > 12 ? 8 : 14);

                  return (
                    <div
                      key={span.spanId}
                      role="treeitem"
                      aria-level={row.depth + 1}
                      aria-selected={isSelected}
                      aria-expanded={
                        row.hasChildren ? !row.isCollapsed : undefined
                      }
                      data-testid="trace-waterfall-row"
                      data-span-id={span.spanId}
                      data-selected={isSelected ? "true" : undefined}
                      data-linked={isLinked ? "true" : undefined}
                      data-context={row.isContext ? "true" : undefined}
                      className={`absolute inset-x-0 flex cursor-pointer items-stretch border-b border-gray-100 ${
                        isSelected
                          ? "bg-indigo-50"
                          : isLinked
                            ? "bg-amber-50/60 hover:bg-amber-50"
                            : "hover:bg-gray-50"
                      }`}
                      style={{
                        top: `${index * WATERFALL_ROW_HEIGHT_PX}px`,
                        height: `${WATERFALL_ROW_HEIGHT_PX}px`,
                      }}
                      onClick={() => {
                        bodyRef.current?.focus({ preventScroll: true });
                        props.onSelectSpan(isSelected ? null : span.spanId);
                      }}
                    >
                      {(isSelected || isLinked) && (
                        <span
                          className={`absolute inset-y-0 left-0 w-0.5 ${isSelected ? "bg-indigo-500" : "bg-amber-400"}`}
                          aria-hidden="true"
                        />
                      )}
                      <div
                        className={`flex min-w-0 items-center gap-1.5 pr-2 ${row.isContext || isOffCriticalPath ? "opacity-50" : ""}`}
                        style={{
                          width: `${namePercent}%`,
                          paddingLeft: `${8 + indentPx}px`,
                        }}
                      >
                        {row.hasChildren ? (
                          <button
                            type="button"
                            tabIndex={-1}
                            className="flex h-5 w-5 flex-none items-center justify-center rounded text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                            aria-label={
                              row.isCollapsed
                                ? `Expand ${span.name}`
                                : `Collapse ${span.name}`
                            }
                            data-testid="trace-row-toggle"
                            onClick={(event: React.MouseEvent) => {
                              event.stopPropagation();
                              props.onSetCollapsed(
                                span.spanId,
                                !row.isCollapsed,
                              );
                            }}
                          >
                            <Icon
                              icon={
                                row.isCollapsed
                                  ? IconProp.ChevronRight
                                  : IconProp.ChevronDown
                              }
                              className="h-3.5 w-3.5"
                            />
                          </button>
                        ) : (
                          <span className="w-5 flex-none" aria-hidden="true" />
                        )}
                        <span
                          className="h-2.5 w-2.5 flex-none rounded-sm"
                          style={{ backgroundColor: service.color }}
                          aria-hidden="true"
                        />
                        {showServiceName && (
                          <span
                            className="max-w-[45%] flex-none truncate text-xs font-medium text-gray-500"
                            title={service.name}
                          >
                            {service.name}
                          </span>
                        )}
                        <span
                          className={`min-w-0 truncate text-[13px] ${row.isContext ? "text-gray-500" : "text-gray-900"}`}
                          title={span.name}
                        >
                          <HighlightedText
                            text={span.name || "(unnamed span)"}
                            searchText={row.isContext ? "" : props.searchText}
                          />
                        </span>
                        {span.isError && (
                          <span
                            className="flex-none"
                            title="This span has an error status"
                          >
                            <Icon
                              icon={IconProp.Error}
                              className="h-3.5 w-3.5 text-red-500"
                            />
                          </span>
                        )}
                        {isLinked && (
                          <span
                            className="flex-none rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
                            title="This span was named in the link that opened this page"
                          >
                            Linked
                          </span>
                        )}
                        {row.isCollapsed && (
                          <span
                            className="flex-none rounded bg-gray-100 px-1.5 text-[10px] font-medium tabular-nums text-gray-600"
                            title={`${row.node.descendantCount} hidden spans`}
                          >
                            +{row.node.descendantCount}
                          </span>
                        )}
                      </div>
                      <div
                        className={`relative flex-1 ${isOffCriticalPath || row.isContext ? "opacity-30" : ""}`}
                        title={`${span.name} · ${durationLabel} · starts ${formatOffsetNano(span.startTimeUnixNano - tree.startTimeUnixNano)}`}
                      >
                        {geometry.isOutside ? (
                          <span
                            className={`absolute top-1/2 -translate-y-1/2 text-[10px] text-gray-300 ${geometry.leftPercent >= 100 ? "right-1" : "left-1"}`}
                            aria-hidden="true"
                          >
                            {geometry.leftPercent >= 100 ? "▸" : "◂"}
                          </span>
                        ) : (
                          <>
                            <div
                              className={`absolute top-1/2 h-3.5 -translate-y-1/2 ${
                                geometry.isClippedStart
                                  ? "rounded-r-sm"
                                  : geometry.isClippedEnd
                                    ? "rounded-l-sm"
                                    : "rounded-sm"
                              }`}
                              style={{
                                left: `${geometry.leftPercent}%`,
                                width: `max(${geometry.widthPercent}%, 2px)`,
                                backgroundColor: service.color,
                                boxShadow: getBarShadow({
                                  isError: span.isError,
                                  isSelected,
                                  isOnCriticalPath: Boolean(
                                    props.criticalPathSpanIds?.has(span.spanId),
                                  ),
                                }),
                              }}
                              data-error={span.isError ? "true" : undefined}
                              data-testid="trace-waterfall-bar"
                            />
                            <span
                              className={`pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] tabular-nums ${
                                geometry.labelPlacement === "inside"
                                  ? "font-medium text-white"
                                  : "text-gray-500"
                              }`}
                              style={
                                geometry.labelPlacement === "after"
                                  ? {
                                      left: `calc(${geometry.leftPercent + geometry.widthPercent}% + 6px)`,
                                    }
                                  : geometry.labelPlacement === "before"
                                    ? {
                                        right: `calc(${100 - geometry.leftPercent}% + 6px)`,
                                      }
                                    : {
                                        left: `calc(${geometry.leftPercent}% + 6px)`,
                                      }
                              }
                            >
                              {durationLabel}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TraceWaterfall;

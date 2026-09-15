import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  TraceServiceInfo,
  getServiceInfo,
} from "../../../Utils/TraceDetailPresentation";
import {
  SpanTree,
  TimeViewport,
  WaterfallNode,
  clampViewport,
  isFullViewport,
  zoomViewport,
} from "../../../Utils/TraceWaterfall";

export interface ComponentProps {
  tree: SpanTree;
  serviceInfoById: Map<string, TraceServiceInfo>;
  viewport: TimeViewport;
  onViewportChange: (viewport: TimeViewport) => void;
}

// Past this many spans the overview samples rows; it is a shape, not a list.
const MAX_MARKS: number = 1500;
const MINIMAP_HEIGHT_PX: number = 44;
// A drag shorter than this (as a fraction of the width) is a click.
const CLICK_TOLERANCE: number = 0.004;

interface Mark {
  key: string;
  x: number;
  width: number;
  y: number;
  color: string;
}

/*
 * The whole trace at a glance: every span as a hairline in tree order. Drag
 * across it to zoom the waterfall into that slice of time; click to move the
 * zoomed window. The buttons do the same from the keyboard.
 */
const TraceTimelineMinimap: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const trackRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const [dragWindow, setDragWindow] = useState<TimeViewport | null>(null);
  const dragAnchorRef: React.MutableRefObject<number | null> = useRef<
    number | null
  >(null);

  const { tree } = props;

  const marks: Array<Mark> = useMemo(() => {
    const ordered: Array<WaterfallNode> = [];
    const stack: Array<WaterfallNode> = [...tree.roots].reverse();
    while (stack.length > 0) {
      const node: WaterfallNode = stack.pop()!;
      ordered.push(node);
      for (let index: number = node.children.length - 1; index >= 0; index--) {
        stack.push(node.children[index]!);
      }
    }

    const step: number = Math.max(1, Math.ceil(ordered.length / MAX_MARKS));
    const duration: number = tree.durationUnixNano;
    const result: Array<Mark> = [];

    for (let index: number = 0; index < ordered.length; index += step) {
      const span: WaterfallNode["span"] = ordered[index]!.span;
      const left: number =
        duration > 0
          ? (span.startTimeUnixNano - tree.startTimeUnixNano) / duration
          : 0;
      const width: number = duration > 0 ? span.durationUnixNano / duration : 1;
      result.push({
        key: span.spanId,
        x: left * 1000,
        width: Math.max(width * 1000, 2),
        y: index,
        color: span.isError
          ? "#ef4444"
          : getServiceInfo(props.serviceInfoById, span.serviceId).color,
      });
    }

    return result;
  }, [tree, props.serviceInfoById]);

  const rowCount: number = Math.max(1, tree.spanCount);
  // Each mark is 1.5-4px tall on screen, whatever the span count.
  const pixelsPerRow: number = MINIMAP_HEIGHT_PX / rowCount;
  const markHeight: number =
    Math.min(4, Math.max(1.5, pixelsPerRow * 0.7)) / pixelsPerRow;

  const fractionAt: (clientX: number) => number = (clientX: number): number => {
    const rect: DOMRect | undefined = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) {
      return 0;
    }
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const shownWindow: TimeViewport = dragWindow || props.viewport;
  const isZoomed: boolean = !isFullViewport(props.viewport);

  return (
    <div
      className="flex items-center gap-3 border-b border-gray-200 bg-gray-50/60 px-3 py-2"
      data-testid="trace-minimap"
    >
      <div
        ref={trackRef}
        className="relative flex-1 cursor-crosshair touch-none select-none overflow-hidden rounded-md border border-gray-200 bg-white"
        style={{ height: `${MINIMAP_HEIGHT_PX}px` }}
        title="Drag across the trace to zoom into that time range"
        aria-label="Trace overview. Drag to zoom into a time range."
        role="img"
        onPointerDown={(event: React.PointerEvent<HTMLDivElement>) => {
          if (event.button !== 0) {
            return;
          }
          const fraction: number = fractionAt(event.clientX);
          dragAnchorRef.current = fraction;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setDragWindow({ start: fraction, end: fraction });
        }}
        onPointerMove={(event: React.PointerEvent<HTMLDivElement>) => {
          if (dragAnchorRef.current === null) {
            return;
          }
          const fraction: number = fractionAt(event.clientX);
          setDragWindow({
            start: Math.min(dragAnchorRef.current, fraction),
            end: Math.max(dragAnchorRef.current, fraction),
          });
        }}
        onPointerUp={(event: React.PointerEvent<HTMLDivElement>) => {
          const anchor: number | null = dragAnchorRef.current;
          dragAnchorRef.current = null;
          setDragWindow(null);
          if (anchor === null) {
            return;
          }
          const fraction: number = fractionAt(event.clientX);
          if (Math.abs(fraction - anchor) < CLICK_TOLERANCE) {
            if (isZoomed) {
              const width: number = props.viewport.end - props.viewport.start;
              props.onViewportChange(
                clampViewport({
                  start: Math.min(1 - width, Math.max(0, fraction - width / 2)),
                  end: Math.min(1, Math.max(width, fraction + width / 2)),
                }),
              );
            }
            return;
          }
          props.onViewportChange(
            clampViewport({
              start: Math.min(anchor, fraction),
              end: Math.max(anchor, fraction),
            }),
          );
        }}
        onPointerCancel={() => {
          dragAnchorRef.current = null;
          setDragWindow(null);
        }}
      >
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox={`0 0 1000 ${rowCount}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {marks.map((mark: Mark): ReactElement => {
            return (
              <rect
                key={mark.key}
                x={mark.x}
                y={mark.y}
                width={mark.width}
                height={markHeight}
                fill={mark.color}
                opacity={0.85}
              />
            );
          })}
        </svg>
        {(isZoomed || dragWindow) && (
          <>
            <div
              className="pointer-events-none absolute inset-y-0 left-0 bg-gray-900/10"
              style={{ width: `${shownWindow.start * 100}%` }}
            />
            <div
              className="pointer-events-none absolute inset-y-0 right-0 bg-gray-900/10"
              style={{ width: `${(1 - shownWindow.end) * 100}%` }}
            />
            <div
              className="pointer-events-none absolute inset-y-0 border-x-2 border-indigo-500 bg-indigo-500/10"
              data-testid="trace-minimap-window"
              style={{
                left: `${shownWindow.start * 100}%`,
                width: `${(shownWindow.end - shownWindow.start) * 100}%`,
              }}
            />
          </>
        )}
      </div>
      <div className="flex flex-none items-center gap-1">
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
          title="Zoom out"
          aria-label="Zoom out"
          disabled={!isZoomed}
          onClick={() => {
            props.onViewportChange(zoomViewport(props.viewport, 2));
          }}
        >
          <Icon icon={IconProp.MagnifyingGlassMinus} className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-800"
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() => {
            props.onViewportChange(zoomViewport(props.viewport, 0.5));
          }}
        >
          <Icon icon={IconProp.MagnifyingGlassPlus} className="h-4 w-4" />
        </button>
        {isZoomed && (
          <button
            type="button"
            className="ml-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
            data-testid="trace-reset-zoom"
            onClick={() => {
              props.onViewportChange({ start: 0, end: 1 });
            }}
          >
            Reset zoom
          </button>
        )}
      </div>
    </div>
  );
};

export default TraceTimelineMinimap;

import {
  LINEAGE_DIMMED_OPACITY,
  LINEAGE_HIGHLIGHT_COLOR,
  LINEAGE_NEUTRAL_COLOR,
  LINEAGE_PROBLEM_COLOR,
  LINEAGE_QUERY_HISTORY_DASH,
  LINEAGE_READS_COLOR,
  LINEAGE_VIEW_DEFINITION_DASH,
  LineageTone,
  getLineageToneColor,
} from "./LineageGraphModel";
import {
  LINEAGE_MAP_CARD_HEIGHT,
  LINEAGE_MAP_CARD_WIDTH,
  LineageMapLayout,
  LineageMapPoint,
  LineageMapView,
  getLineageMapNodeTone,
  getLineageMapView,
  layoutLineageMap,
} from "./LineageMapModel";
import {
  getLineageMapNodeIcon,
  getLineageMapNodeSubtitle,
} from "./LineageMapWords";
import FlowKeyboardFocus from "../Topology/FlowKeyboardFocus";
import {
  DataLineageMap,
  DataLineageMapEdge,
  DataLineageMapEdgeKind,
  DataLineageMapEvidence,
  DataLineageMapNode,
  DataLineageMapTrace,
  hasFailedLineageMapPipeline,
} from "Common/Types/DataObservability/DataLineageMap";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  CSSProperties,
  FunctionComponent,
  ReactElement,
  RefObject,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  FitViewOptions,
  Handle,
  MarkerType,
  Node,
  NodeProps,
  NodeTypes,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";

/*
 * THE LINEAGE MAP, DRAWN (#9114; LineageMapModel says where each card sits).
 *
 * One card per service, table, pipeline and dashboard, left to right as
 * data flows, each card's top edge saying how it is, as on a table's
 * lineage diagram: red for a table late or with an open alert and a
 * pipeline whose latest run failed, green for fresh, grey when it cannot be
 * said, dashed for a dropped table. An arrow is solid where a pipeline's
 * run moved the data, dashed where only query history saw it, dotted for a
 * view's definition, teal where a service's spans read or wrote the table,
 * light grey for a dashboard's read, and red when its pipeline's latest run
 * failed.
 *
 * Selecting a card (a click, or Enter on it) picks out everything upstream
 * and downstream of it in indigo, however many steps away, and fades the
 * rest; the page then says what it is and opens its page. The map opens
 * whole when it can be read whole, else at a zoom its names can be read at
 * from its first column (getLineageMapView). The canvas pans by dragging
 * and zooms with its controls or a pinch: the wheel scrolls the page, as on
 * every lineage diagram. Tab reaches each card, and the view
 * pans to the card the keyboard's focus goes to (FlowKeyboardFocus).
 */

export const LINEAGE_MAP_TRACES_COLOR: string = "#14b8a6";

const SELECTED_WIDTH: number = 2.5;

// The fit button shows the whole map, however small that makes it.
const FIT_VIEW_OPTIONS: FitViewOptions = { padding: 0.08, maxZoom: 1 };

// A canvas not measured yet (never on a page) is read as this wide.
const FALLBACK_CANVAS_WIDTH: number = 1200;

const HANDLE_STYLE: CSSProperties = { opacity: 0, pointerEvents: "none" };

const SELECT_CARD: string = translationKey("Select {{name}}");

interface CardData {
  node: DataLineageMapNode;
  isSelected: boolean;
  isDimmed: boolean;
  isOnTrace: boolean;
  onSelect: (nodeId: string) => void;
}

const LineageMapCard: FunctionComponent<NodeProps<CardData>> = (
  props: NodeProps<CardData>,
): ReactElement => {
  const translator: Translator = useTranslator();
  const node: DataLineageMapNode = props.data.node;
  const tone: LineageTone = getLineageMapNodeTone(node);
  const isDropped: boolean = tone === LineageTone.Dropped;
  const subtitle: string = getLineageMapNodeSubtitle(node, translator);

  const style: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    width: LINEAGE_MAP_CARD_WIDTH,
    height: LINEAGE_MAP_CARD_HEIGHT,
    boxSizing: "border-box",
    overflow: "hidden",
    textAlign: "start",
    border: isDropped
      ? "1px dashed var(--ou-border-primary, #cbd5e1)"
      : "1px solid var(--ou-border-primary, #e2e8f0)",
    borderTop: isDropped
      ? "1px dashed var(--ou-border-primary, #cbd5e1)"
      : `3px solid ${getLineageToneColor(tone)}`,
    borderRadius: 10,
    padding: "6px 12px",
    background: "var(--ou-surface-primary, #ffffff)",
    color: "var(--ou-text-primary, #111827)",
    cursor: "pointer",
    boxShadow: props.data.isSelected
      ? "0 0 0 3px rgba(99, 102, 241, 0.6), 0 2px 6px rgba(15, 23, 42, 0.08)"
      : props.data.isOnTrace
        ? "0 0 0 2px rgba(99, 102, 241, 0.3), 0 2px 6px rgba(15, 23, 42, 0.06)"
        : "0 2px 6px rgba(15, 23, 42, 0.06)",
  };

  return (
    <div
      style={{
        width: LINEAGE_MAP_CARD_WIDTH,
        ...(props.data.isDimmed ? { opacity: LINEAGE_DIMMED_OPACITY } : {}),
      }}
      data-node-id={node.id}
      {...(props.data.isDimmed ? { "data-dimmed": "true" } : {})}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        style={HANDLE_STYLE}
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={HANDLE_STYLE}
      />
      <button
        type="button"
        className="nodrag nopan block rounded-[10px] hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        style={style}
        aria-pressed={props.data.isSelected}
        aria-label={translator.translateTemplate(SELECT_CARD, {
          name: node.name,
        })}
        data-testid="lineage-map-card"
        onClick={(): void => {
          props.data.onSelect(node.id);
        }}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon
            icon={getLineageMapNodeIcon(node)}
            className="h-4 w-4 shrink-0 text-gray-400"
          />
          <span
            className={`min-w-0 truncate text-[13px] font-semibold ${
              isDropped ? "line-through decoration-gray-400" : ""
            }`}
            title={node.name}
          >
            <IsolatedText text={node.name} />
          </span>
        </span>
        {subtitle ? (
          <span
            className="mt-0.5 block truncate text-xs text-gray-500"
            title={subtitle}
          >
            {subtitle}
          </span>
        ) : (
          <></>
        )}
      </button>
    </div>
  );
};

const NODE_TYPES: NodeTypes = { lineageMapCard: LineageMapCard };

// How an arrow is drawn, before a selection picks it out or fades it.
export function getLineageMapEdgeLook(edge: DataLineageMapEdge): {
  color: string;
  dash: string | undefined;
} {
  if (hasFailedLineageMapPipeline(edge)) {
    return { color: LINEAGE_PROBLEM_COLOR, dash: undefined };
  }

  if (edge.seenIn.includes(DataLineageMapEvidence.Traces)) {
    return { color: LINEAGE_MAP_TRACES_COLOR, dash: undefined };
  }

  if (edge.seenIn.includes(DataLineageMapEvidence.BiTool)) {
    return { color: LINEAGE_READS_COLOR, dash: undefined };
  }

  if (
    edge.kind === DataLineageMapEdgeKind.Feeds &&
    !edge.seenIn.includes(DataLineageMapEvidence.Pipeline)
  ) {
    return {
      color: LINEAGE_NEUTRAL_COLOR,
      dash: edge.seenIn.includes(DataLineageMapEvidence.QueryHistory)
        ? LINEAGE_QUERY_HISTORY_DASH
        : LINEAGE_VIEW_DEFINITION_DASH,
    };
  }

  return { color: LINEAGE_NEUTRAL_COLOR, dash: undefined };
}

// A short, stable name for what is drawn, so a new set of cards is fitted to the canvas afresh.
function getDrawingKey(map: DataLineageMap): string {
  let hash: number = 0;

  for (const node of map.nodes) {
    for (let index: number = 0; index < node.id.length; index++) {
      hash = (hash * 31 + node.id.charCodeAt(index)) | 0;
    }
  }

  return `${map.nodes.length}:${map.edges.length}:${hash}`;
}

export interface ComponentProps {
  map: DataLineageMap;
  selectedNodeId: string | null;
  // What is upstream and downstream of the selected card.
  trace: DataLineageMapTrace | null;
  onSelect: (nodeId: string | null) => void;
}

const LineageMapGraph: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const layout: LineageMapLayout = useMemo((): LineageMapLayout => {
    return layoutLineageMap(props.map);
  }, [props.map]);

  const canvasRef: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState<number>(0);

  // The canvas's width, as the page lays it out: the map opens to fit it.
  useLayoutEffect(() => {
    const canvas: HTMLDivElement | null = canvasRef.current;

    if (!canvas) {
      return;
    }

    const measure: () => void = (): void => {
      setCanvasWidth(Math.round(canvas.getBoundingClientRect().width));
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer: ResizeObserver = new ResizeObserver(measure);
    observer.observe(canvas);

    return () => {
      observer.disconnect();
    };
  }, []);

  const selected: string | null = props.selectedNodeId;
  const trace: DataLineageMapTrace | null = selected ? props.trace : null;

  const nodes: Array<Node<CardData>> = useMemo((): Array<Node<CardData>> => {
    return props.map.nodes.map((node: DataLineageMapNode): Node<CardData> => {
      const point: LineageMapPoint = layout.positions.get(node.id) || {
        x: 0,
        y: 0,
      };
      const isOnTrace: boolean = Boolean(
        trace && (trace.upstream.has(node.id) || trace.downstream.has(node.id)),
      );

      return {
        id: node.id,
        type: "lineageMapCard",
        position: point,
        /*
         * React Flow lets a pointer through a card it may not select or
         * drag, to the pane: the card's own button takes the click.
         */
        style: { pointerEvents: "all" },
        data: {
          node,
          isSelected: node.id === selected,
          isOnTrace,
          isDimmed: Boolean(selected) && node.id !== selected && !isOnTrace,
          onSelect: (nodeId: string): void => {
            props.onSelect(nodeId === selected ? null : nodeId);
          },
        },
      };
    });
  }, [props.map, layout, selected, trace, props.onSelect]);

  const edges: Array<Edge> = useMemo((): Array<Edge> => {
    return props.map.edges.map((edge: DataLineageMapEdge): Edge => {
      const look: { color: string; dash: string | undefined } =
        getLineageMapEdgeLook(edge);
      const isPicked: boolean = Boolean(trace && trace.edgeIds.has(edge.id));
      const isFaded: boolean = Boolean(selected) && !isPicked;
      const color: string = isPicked ? LINEAGE_HIGHLIGHT_COLOR : look.color;

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "default",
        zIndex: isPicked ? 1 : 0,
        style: {
          stroke: color,
          strokeWidth: isPicked ? SELECTED_WIDTH : 1.5,
          ...(look.dash ? { strokeDasharray: look.dash } : {}),
          ...(isFaded ? { opacity: 0.2 } : {}),
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color,
          width: 16,
          height: 16,
        },
        data: { kind: edge.kind },
      };
    });
  }, [props.map, trace, selected]);

  const view: LineageMapView = getLineageMapView(
    layout,
    canvasWidth || FALLBACK_CANVAS_WIDTH,
  );

  return (
    <div
      ref={canvasRef}
      className="w-full overflow-hidden rounded-lg border border-gray-200"
      style={{ height: view.height }}
      role="figure"
      data-testid="lineage-map-canvas"
      data-zoom={view.zoom}
    >
      <ReactFlow
        // A new set of cards, or the canvas measured for the first time: opened afresh.
        key={`${getDrawingKey(props.map)}:${canvasWidth > 0}`}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        defaultViewport={{ x: view.x, y: view.y, zoom: view.zoom }}
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={0.1}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        panOnScroll={false}
        preventScrolling={false}
        onPaneClick={(): void => {
          props.onSelect(null);
        }}
      >
        <FlowKeyboardFocus
          onViewMoved={(): void => {
            // The reader's view: nothing here moves it back.
          }}
        />
        <Controls
          position="bottom-right"
          showInteractive={false}
          fitViewOptions={FIT_VIEW_OPTIONS}
        />
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1}
          color="var(--ou-border-primary, #e2e8f0)"
        />
      </ReactFlow>
    </div>
  );
};

export default LineageMapGraph;

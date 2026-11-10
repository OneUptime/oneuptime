import AppLink from "../AppLink/AppLink";
import { formatOverdue } from "./DataObservabilityFormat";
import {
  LINEAGE_CARD_HEIGHT,
  LINEAGE_CARD_WIDTH,
  LINEAGE_NEUTRAL_COLOR,
  LINEAGE_PROBLEM_COLOR,
  LINEAGE_QUERY_HISTORY_DASH,
  LINEAGE_VIEW_DEFINITION_DASH,
  LineageEdgeStyle,
  LineageLayout,
  LineageTone,
  getLineageEdgeStyle,
  getLineageNodeTone,
  getLineageToneColor,
  layoutLineage,
} from "./LineageGraphModel";
import { getRunStatePill } from "../../Pages/DataObservability/Pipelines";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { Gray500, Green500, Red500 } from "Common/Types/BrandColors";
import { DataAssetFreshness } from "Common/Types/DataObservability/DataAssetFreshness";
import DataAssetKind from "Common/Types/DataObservability/DataAssetKind";
import {
  DataLineageNodeKind,
  DataTableLineage,
  DataTableLineageEdge,
  DataTableLineageNode,
} from "Common/Types/DataObservability/DataTableLineage";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Link from "Common/UI/Components/Link/Link";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  CSSProperties,
  FunctionComponent,
  ReactElement,
  useMemo,
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
 * A TABLE'S LINEAGE, DRAWN (LineageGraphModel says where each card sits).
 *
 * Cards left to right as data flows, the table in the middle ringed. Each
 * card's top edge says how it is: red for a problem (a table late or with
 * an open alert, a pipeline whose latest run failed), green for healthy,
 * grey when that cannot be said yet, and a dashed card for a table dropped
 * from its database. An arrow is solid where a pipeline's run moved the
 * data, dashed where only the database's query history saw it, dotted for
 * a view's definition, and red, naming the pipeline, when that pipeline's
 * latest run failed.
 *
 * A table opens its own Lineage tab, so the diagram can be walked a table
 * at a time; a pipeline opens its page, a dashboard its tool. A small count
 * on a card's outer side says how many more tables lie that way than are
 * drawn. The page scrolls over the drawing - the wheel never zooms it - and
 * nothing on it is dragged; the controls zoom and fit it.
 */

const MAP_LABEL: string = translationKey(
  "The tables this table is built from, and the tables and dashboards built from it",
);
const PIPELINE: string = translationKey("Pipeline");
const THIS_TABLE: string = translationKey("This table");
const DROPPED: string = translationKey("Dropped");
const FRESH: string = translationKey("Fresh");
const FAILED_PIPELINE: string = translationKey("{{pipeline}} failed");

const OPEN_ALERTS: PluralTemplate = {
  one: "{{count}} open alert",
  other: "{{count}} open alerts",
};
const MORE_UPSTREAM: PluralTemplate = {
  one: "{{count}} more table upstream is not drawn. Open this table to center the diagram on it.",
  other:
    "{{count}} more tables upstream are not drawn. Open this table to center the diagram on it.",
};
const MORE_DOWNSTREAM: PluralTemplate = {
  one: "{{count}} more table downstream is not drawn. Open this table to center the diagram on it.",
  other:
    "{{count}} more tables downstream are not drawn. Open this table to center the diagram on it.",
};
const MORE_UPSTREAM_HERE: PluralTemplate = {
  one: "{{count}} more table this one is built from is not drawn. Built From below lists them all.",
  other:
    "{{count}} more tables this one is built from are not drawn. Built From below lists them all.",
};
const MORE_DOWNSTREAM_HERE: PluralTemplate = {
  one: "{{count}} more table built from this one is not drawn. Feeds below lists them all.",
  other:
    "{{count}} more tables built from this one are not drawn. Feeds below lists them all.",
};

const ASSET_KIND_ICONS: Readonly<Record<string, IconProp>> = {
  [DataAssetKind.View]: IconProp.Eye,
  [DataAssetKind.MaterializedView]: IconProp.Eye,
  [DataAssetKind.StoragePath]: IconProp.CloudArrowDown,
};

// Arrowheads one size whatever the arrow's width: React Flow scales them with it by default.
const ARROWHEAD_SIZE: number = 16;

const FIT_VIEW_OPTIONS: FitViewOptions = { padding: 0.12, maxZoom: 1 };

const HANDLE_STYLE: CSSProperties = { opacity: 0, pointerEvents: "none" };

// The canvas's height bounds; between them it keeps the drawing's shape.
const CANVAS_MIN_HEIGHT: number = 280;
const CANVAS_MAX_HEIGHT: number = 640;

// A pipeline's name on its arrow, cut to what an arrow's label holds.
const MAX_EDGE_LABEL_NAME: number = 32;

export function getLineageCanvasStyle(layout: LineageLayout): CSSProperties {
  return {
    width: "100%",
    aspectRatio: `${Math.max(1, layout.width)} / ${Math.max(1, layout.height)}`,
    minHeight: CANVAS_MIN_HEIGHT,
    maxHeight: CANVAS_MAX_HEIGHT,
  };
}

// The page a card opens inside OneUptime, if it opens one: never the table the diagram is about.
export function getLineageCardRoute(
  node: DataTableLineageNode,
  isFocus: boolean,
): Route | null {
  if (node.kind === DataLineageNodeKind.Table && node.dataAssetId && !isFocus) {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.DATA_OBSERVABILITY_TABLE_VIEW_LINEAGE] as Route,
      { modelId: new ObjectID(node.dataAssetId) },
    );
  }

  if (node.kind === DataLineageNodeKind.Pipeline && node.dataPipelineId) {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.DATA_OBSERVABILITY_PIPELINE_VIEW] as Route,
      { modelId: new ObjectID(node.dataPipelineId) },
    );
  }

  return null;
}

// A dashboard's link, when its tool gave one on the web: nothing else is opened.
export function getLineageDashboardUrl(node: DataTableLineageNode): URL | null {
  if (
    node.kind !== DataLineageNodeKind.Dashboard ||
    !node.url ||
    !/^https?:\/\//i.test(node.url.trim())
  ) {
    return null;
  }

  try {
    return URL.fromString(node.url.trim());
  } catch {
    return null;
  }
}

function getCardIcon(node: DataTableLineageNode): IconProp {
  if (node.kind === DataLineageNodeKind.Pipeline) {
    return IconProp.Workflow;
  }

  if (node.kind === DataLineageNodeKind.Dashboard) {
    return IconProp.ChartBar;
  }

  return ASSET_KIND_ICONS[node.assetKind || ""] || IconProp.TableCells;
}

// The line under a card's name: where a table lives and what it is, a pipeline's namespace, a dashboard's tool.
function getCardSubtitle(
  node: DataTableLineageNode,
  translator: Translator,
): string {
  if (node.kind === DataLineageNodeKind.Pipeline) {
    return node.jobNamespace || translator.translateText(PIPELINE) || "";
  }

  if (node.kind === DataLineageNodeKind.Dashboard) {
    return node.tool || "";
  }

  return [
    node.database || "",
    node.assetKind
      ? translator.translateText(node.assetKind) || node.assetKind
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

interface LineageCardData {
  node: DataTableLineageNode;
  isFocus: boolean;
}

// What most needs saying about a card, at most two chips.
const CardChips: FunctionComponent<LineageCardData> = (
  props: LineageCardData,
): ReactElement => {
  const translator: Translator = useTranslator();
  const node: DataTableLineageNode = props.node;
  const chips: Array<ReactElement> = [];

  if (props.isFocus) {
    chips.push(
      <Pill
        key="focus"
        text={THIS_TABLE}
        color={Gray500}
        size={PillSize.Small}
      />,
    );
  }

  if (node.kind === DataLineageNodeKind.Table) {
    if (node.isDropped) {
      chips.push(
        <Pill key="dropped" text={DROPPED} color={Gray500} size={PillSize.Small} />,
      );
    } else {
      if ((node.openAlertCount || 0) > 0) {
        chips.push(
          <Pill
            key="alerts"
            text={translator.translatePlural(
              OPEN_ALERTS,
              node.openAlertCount || 0,
            )}
            color={Red500}
            size={PillSize.Small}
          />,
        );
      }

      if (node.freshness === DataAssetFreshness.Late) {
        chips.push(
          <Pill
            key="late"
            text={formatOverdue(translator, node.lateBySeconds || 0)}
            color={Red500}
            size={PillSize.Small}
          />,
        );
      } else if (node.freshness === DataAssetFreshness.Fresh) {
        chips.push(
          <Pill key="fresh" text={FRESH} color={Green500} size={PillSize.Small} />,
        );
      }
    }
  }

  if (node.kind === DataLineageNodeKind.Pipeline) {
    chips.push(
      <span key="run" className="inline-flex">
        {getRunStatePill(node.lastRunState || undefined)}
      </span>,
    );
  }

  if (chips.length === 0) {
    return <></>;
  }

  return (
    <span className="mt-1.5 flex flex-nowrap items-center gap-1 overflow-hidden">
      {chips.slice(0, 2)}
    </span>
  );
};

// "+12" on a card's outer side: the tables that way that are not drawn.
const HiddenCount: FunctionComponent<{
  count: number;
  side: "left" | "right";
  tooltip: string;
}> = (props: {
  count: number;
  side: "left" | "right";
  tooltip: string;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span
      className="absolute top-1/2 -translate-y-1/2 rounded-full border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-600 shadow-sm"
      style={props.side === "left" ? { left: -14 } : { right: -14 }}
      title={props.tooltip}
      data-testid={`lineage-hidden-${props.side}`}
    >
      {translator.translateTemplate("+{{count}}", {
        count: translator.formatNumber(props.count),
      })}
    </span>
  );
};

const LineageCard: FunctionComponent<NodeProps<LineageCardData>> = (
  props: NodeProps<LineageCardData>,
): ReactElement => {
  const translator: Translator = useTranslator();
  const node: DataTableLineageNode = props.data.node;
  const isFocus: boolean = props.data.isFocus;
  const tone: LineageTone = getLineageNodeTone(node);
  const route: Route | null = getLineageCardRoute(node, isFocus);
  const dashboardUrl: URL | null = getLineageDashboardUrl(node);
  const subtitle: string = getCardSubtitle(node, translator);
  const isDropped: boolean = tone === LineageTone.Dropped;

  const cardStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    height: LINEAGE_CARD_HEIGHT,
    width: LINEAGE_CARD_WIDTH,
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
    padding: "8px 12px",
    background: "var(--ou-surface-primary, #ffffff)",
    color: "var(--ou-text-primary, #111827)",
    opacity: isDropped ? 0.75 : 1,
    boxShadow: isFocus
      ? "0 0 0 3px rgba(99, 102, 241, 0.25), 0 2px 6px rgba(15, 23, 42, 0.08)"
      : "0 2px 6px rgba(15, 23, 42, 0.06)",
  };

  const body: ReactElement = (
    <>
      <span className="flex min-w-0 items-center gap-1.5">
        <Icon
          icon={getCardIcon(node)}
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
          className="mt-0.5 block truncate text-[11px] text-gray-500"
          title={subtitle}
        >
          {subtitle}
        </span>
      ) : (
        <></>
      )}
      <CardChips node={node} isFocus={isFocus} />
    </>
  );

  let card: ReactElement = (
    <span style={cardStyle} data-testid="lineage-card">
      {body}
    </span>
  );

  if (route) {
    card = (
      <AppLink
        to={route}
        className="nodrag nopan block rounded-[10px] hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        dataTestId="lineage-card"
      >
        <span style={{ ...cardStyle, cursor: "pointer" }}>{body}</span>
      </AppLink>
    );
  } else if (dashboardUrl) {
    card = (
      <Link
        to={dashboardUrl}
        openInNewTab={true}
        className="nodrag nopan block rounded-[10px] hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        dataTestId="lineage-card"
      >
        <span style={{ ...cardStyle, cursor: "pointer" }}>{body}</span>
      </Link>
    );
  }

  const hiddenUpstream: number = node.hiddenUpstreamCount || 0;
  const hiddenDownstream: number = node.hiddenDownstreamCount || 0;

  return (
    <div
      style={{ width: LINEAGE_CARD_WIDTH, position: "relative" }}
      data-node-id={node.id}
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
      {card}
      {hiddenUpstream > 0 ? (
        <HiddenCount
          count={hiddenUpstream}
          side="left"
          tooltip={translator.translatePlural(
            isFocus ? MORE_UPSTREAM_HERE : MORE_UPSTREAM,
            hiddenUpstream,
            { count: translator.formatNumber(hiddenUpstream) },
          )}
        />
      ) : (
        <></>
      )}
      {hiddenDownstream > 0 ? (
        <HiddenCount
          count={hiddenDownstream}
          side="right"
          tooltip={translator.translatePlural(
            isFocus ? MORE_DOWNSTREAM_HERE : MORE_DOWNSTREAM,
            hiddenDownstream,
            { count: translator.formatNumber(hiddenDownstream) },
          )}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

const NODE_TYPES: NodeTypes = {
  lineageCard: LineageCard,
};

// The pipeline's name, cut to what an arrow's label holds.
function shortName(name: string): string {
  return name.length > MAX_EDGE_LABEL_NAME
    ? `${name.slice(0, MAX_EDGE_LABEL_NAME - 1)}…`
    : name;
}

export interface ComponentProps {
  lineage: DataTableLineage;
}

const LineageGraph: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const layout: LineageLayout = useMemo((): LineageLayout => {
    return layoutLineage(props.lineage);
  }, [props.lineage]);

  const nodes: Array<Node<LineageCardData>> = useMemo((): Array<
    Node<LineageCardData>
  > => {
    return props.lineage.nodes.map(
      (node: DataTableLineageNode): Node<LineageCardData> => {
        return {
          id: node.id,
          type: "lineageCard",
          position: layout.positions.get(node.id) || { x: 0, y: 0 },
          data: { node, isFocus: node.id === props.lineage.focusNodeId },
          selectable: false,
          draggable: false,
          /*
           * React Flow lets a node that is neither selectable nor draggable
           * take no pointer events, so a click would reach the pane under
           * the card, not the link on it.
           */
          style: { pointerEvents: "all" },
        };
      },
    );
  }, [layout, props.lineage]);

  const edges: Array<Edge> = useMemo((): Array<Edge> => {
    return props.lineage.edges.map((edge: DataTableLineageEdge): Edge => {
      const style: LineageEdgeStyle = getLineageEdgeStyle(edge);
      const label: string = style.failedPipeline
        ? translator.translateTemplate(FAILED_PIPELINE, {
            pipeline: shortName(style.failedPipeline.name),
          })
        : "";

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "default",
        ...(label
          ? {
              label,
              labelStyle: {
                fontSize: 10,
                fontWeight: 500,
                fill: LINEAGE_PROBLEM_COLOR,
              },
              labelBgStyle: {
                fill: "var(--ou-surface-primary, #ffffff)",
                fillOpacity: 0.92,
              },
              labelBgPadding: [4, 2] as [number, number],
              labelBgBorderRadius: 4,
            }
          : {}),
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: style.color,
          width: ARROWHEAD_SIZE,
          height: ARROWHEAD_SIZE,
          markerUnits: "userSpaceOnUse",
        },
        style: {
          stroke: style.color,
          strokeWidth: style.width,
          ...(style.dash ? { strokeDasharray: style.dash } : {}),
        },
      };
    });
  }, [props.lineage, translator.language]);

  /*
   * A new drawing - another table, or more steps - is drawn afresh and
   * fitted again; React Flow fits a drawing only when it first shows it.
   */
  const drawingKey: string = `${props.lineage.focusNodeId}:${props.lineage.depth}:${props.lineage.nodes.length}`;

  return (
    <div
      role="figure"
      aria-label={translator.translateText(MAP_LABEL) || MAP_LABEL}
      className="rounded-md border border-gray-200 bg-gray-50"
      style={getLineageCanvasStyle(layout)}
      data-testid="lineage-graph"
    >
      <ReactFlow
        key={drawingKey}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView={true}
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={0.15}
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
      >
        <Controls
          position="top-right"
          showInteractive={false}
          fitViewOptions={FIT_VIEW_OPTIONS}
        />
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1}
          color="var(--ou-chart-grid, #cbd5e1)"
        />
      </ReactFlow>
    </div>
  );
};

// A line drawn the way the diagram draws one kind of arrow.
const LegendLine: FunctionComponent<{
  color: string;
  dash?: string | undefined;
  width?: number | undefined;
}> = (props: {
  color: string;
  dash?: string | undefined;
  width?: number | undefined;
}): ReactElement => {
  return (
    <svg width="28" height="8" aria-hidden="true" className="shrink-0">
      <line
        x1="1"
        y1="4"
        x2="27"
        y2="4"
        stroke={props.color}
        strokeWidth={props.width || 1.75}
        {...(props.dash ? { strokeDasharray: props.dash } : {})}
      />
    </svg>
  );
};

// A card's top edge, drawn as the diagram draws it for one tone.
const LegendSwatch: FunctionComponent<{
  color: string;
  isDashed?: boolean | undefined;
}> = (props: {
  color: string;
  isDashed?: boolean | undefined;
}): ReactElement => {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3 w-4 shrink-0 rounded-sm bg-white"
      style={
        props.isDashed
          ? { border: "1px dashed #94a3b8" }
          : { border: "1px solid #e2e8f0", borderTop: `3px solid ${props.color}` }
      }
    />
  );
};

// What the diagram's lines and colours mean.
export const LineageLegend: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const item: (key: string, mark: ReactElement, text: string) => ReactElement =
    (key: string, mark: ReactElement, text: string): ReactElement => {
      return (
        <span key={key} className="inline-flex items-center gap-1.5">
          {mark}
          <span>{translator.translateText(text)}</span>
        </span>
      );
    };

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-500"
      data-testid="lineage-legend"
    >
      {item(
        "pipeline",
        <LegendLine color={LINEAGE_NEUTRAL_COLOR} />,
        translationKey("Pipeline run"),
      )}
      {item(
        "query",
        <LegendLine
          color={LINEAGE_NEUTRAL_COLOR}
          dash={LINEAGE_QUERY_HISTORY_DASH}
        />,
        translationKey("Query history"),
      )}
      {item(
        "view",
        <LegendLine
          color={LINEAGE_NEUTRAL_COLOR}
          dash={LINEAGE_VIEW_DEFINITION_DASH}
        />,
        translationKey("View definition"),
      )}
      {item(
        "failed",
        <LegendLine color={LINEAGE_PROBLEM_COLOR} width={2.25} />,
        translationKey("Latest run failed"),
      )}
      {item(
        "problem",
        <LegendSwatch color={getLineageToneColor(LineageTone.Problem)} />,
        translationKey("Late, open alert or failed run"),
      )}
      {item(
        "healthy",
        <LegendSwatch color={getLineageToneColor(LineageTone.Healthy)} />,
        translationKey("Fresh or last run complete"),
      )}
      {item(
        "dropped",
        <LegendSwatch color={LINEAGE_NEUTRAL_COLOR} isDashed={true} />,
        translationKey("Dropped"),
      )}
    </div>
  );
};

export default LineageGraph;

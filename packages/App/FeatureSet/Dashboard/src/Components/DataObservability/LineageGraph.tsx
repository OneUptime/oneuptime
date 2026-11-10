import AppLink from "../AppLink/AppLink";
import { formatOverdue } from "./DataObservabilityFormat";
import {
  LINEAGE_CARD_HEIGHT,
  LINEAGE_CARD_WIDTH,
  LINEAGE_DIMMED_OPACITY,
  LINEAGE_EDGE_LABEL_MAX_WIDTH,
  LINEAGE_FIT_PADDING,
  LINEAGE_HIGHLIGHT_COLOR,
  LINEAGE_HIGHLIGHT_WIDTH,
  LINEAGE_NEUTRAL_COLOR,
  LINEAGE_PROBLEM_COLOR,
  LINEAGE_QUERY_HISTORY_DASH,
  LINEAGE_VIEW_DEFINITION_DASH,
  LineageArrowLook,
  LineageCardRole,
  LineageHighlightSets,
  LineageLayout,
  LineagePlace,
  LineageTone,
  LineageViewport,
  getLineageArrowLook,
  getLineageCardRole,
  getLineageHighlightSets,
  getLineageViewport,
  getLineageNodeTone,
  getLineageToneColor,
  isLineageCardDimmed,
  layoutLineage,
} from "./LineageGraphModel";
import { getRunStatePill } from "../../Pages/DataObservability/Pipelines";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { Gray500, Green500, Indigo500, Red500 } from "Common/Types/BrandColors";
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
  MutableRefObject,
  ReactElement,
  RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  Edge,
  EdgeLabelRenderer,
  EdgeProps,
  EdgeTypes,
  FitViewOptions,
  Handle,
  MarkerType,
  Node,
  NodeProps,
  NodeTypes,
  Position,
  ReactFlowInstance,
  getBezierPath,
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
 * a view's definition, and red, with the pipeline's name on it, when that
 * pipeline's latest run failed.
 *
 * A table opens its own Lineage tab, so the diagram can be walked a table
 * at a time; a pipeline opens its page, a dashboard its tool. A small count
 * on a card's outer side says how many more tables lie that way than are
 * drawn. The page scrolls over the drawing - the wheel never zooms it - and
 * nothing on it is dragged; the controls zoom and fit it. A drawing too
 * wide to read whole opens on the table itself, at a zoom its names can be
 * read at (getLineageViewport); the rest is a drag away. Until the reader
 * pans or zooms, the view follows the canvas's size.
 *
 * The same drawing sits on a pipeline's page, the pipeline in the middle,
 * and on a data alert's page, around the alert's table or pipeline - which
 * opens its own page there - with the way to the alert's cause and to the
 * alerts it caused picked out: its cards and arrows in indigo, the cause
 * and each consequence named on its card, and the rest drawn faint.
 */

const MAP_LABELS: Readonly<Record<LineagePlace, string>> = {
  [LineagePlace.Table]: translationKey(
    "The tables this table is built from, and the tables and dashboards built from it",
  ),
  [LineagePlace.Pipeline]: translationKey(
    "The tables this pipeline reads and the tables it writes, with the lineage around them",
  ),
  [LineagePlace.Alert]: translationKey(
    "The lineage around this alert, with the way to the alert that caused it and to the alerts it caused",
  ),
};
// What the card the drawing is about says it is.
const FOCUS_LABELS: Readonly<Record<LineagePlace, string>> = {
  [LineagePlace.Table]: translationKey("This table"),
  [LineagePlace.Pipeline]: translationKey("This pipeline"),
  [LineagePlace.Alert]: translationKey("This alert"),
};
const ROLE_LABELS: Readonly<Record<LineageCardRole, string>> = {
  [LineageCardRole.Cause]: translationKey("Cause"),
  [LineageCardRole.Consequence]: translationKey("Consequence"),
};
const PIPELINE: string = translationKey("Pipeline");
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
const MORE_READ_BY_PIPELINE: PluralTemplate = {
  one: "{{count}} more table this pipeline reads is not drawn.",
  other: "{{count}} more tables this pipeline reads are not drawn.",
};
const MORE_WRITTEN_BY_PIPELINE: PluralTemplate = {
  one: "{{count}} more table this pipeline writes is not drawn.",
  other: "{{count}} more tables this pipeline writes are not drawn.",
};

const ASSET_KIND_ICONS: Readonly<Record<string, IconProp>> = {
  [DataAssetKind.View]: IconProp.Eye,
  [DataAssetKind.MaterializedView]: IconProp.Eye,
  [DataAssetKind.StoragePath]: IconProp.CloudArrowDown,
};

// Arrowheads one size whatever the arrow's width: React Flow scales them with it by default.
const ARROWHEAD_SIZE: number = 16;

const FIT_VIEW_OPTIONS: FitViewOptions = {
  padding: LINEAGE_FIT_PADDING,
  maxZoom: 1,
};

const HANDLE_STYLE: CSSProperties = { opacity: 0, pointerEvents: "none" };

// The canvas's height bounds; between them it keeps the drawing's shape.
const CANVAS_MIN_HEIGHT: number = 360;
const CANVAS_MAX_HEIGHT: number = 640;

export function getLineageCanvasStyle(layout: LineageLayout): CSSProperties {
  return {
    width: "100%",
    aspectRatio: `${Math.max(1, layout.width)} / ${Math.max(1, layout.height)}`,
    minHeight: CANVAS_MIN_HEIGHT,
    maxHeight: CANVAS_MAX_HEIGHT,
  };
}

/*
 * The page a card opens inside OneUptime, if it opens one: never the page
 * the diagram is on (isOwnPage), the table's or the pipeline's own.
 */
export function getLineageCardRoute(
  node: DataTableLineageNode,
  isOwnPage: boolean,
): Route | null {
  if (isOwnPage) {
    return null;
  }

  if (node.kind === DataLineageNodeKind.Table && node.dataAssetId) {
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

// An address on the web: a dashboard's link opens only when it is one.
const WEB_ADDRESS_REGEX: RegExp = /^https?:\/\//i;

// A dashboard's link, when its tool gave one on the web: nothing else is opened.
export function getLineageDashboardUrl(node: DataTableLineageNode): URL | null {
  if (
    node.kind !== DataLineageNodeKind.Dashboard ||
    !node.url ||
    !WEB_ADDRESS_REGEX.test(node.url.trim())
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
  place: LineagePlace;
  // At the end of an alert's way: its cause, or an alert it caused.
  role: LineageCardRole | null;
  // Off every way an alert's drawing picks out.
  isDimmed: boolean;
}

/*
 * What a count of tables not drawn says under the pointer: on a pipeline's
 * card, what it reads or writes; on the table whose Lineage tab this is,
 * the lists below; elsewhere, to open the table.
 */
function getHiddenTooltip(data: {
  translator: Translator;
  node: DataTableLineageNode;
  isFocus: boolean;
  place: LineagePlace;
  isUpstream: boolean;
  count: number;
}): string {
  let template: PluralTemplate;

  if (data.node.kind === DataLineageNodeKind.Pipeline) {
    template = data.isUpstream
      ? MORE_READ_BY_PIPELINE
      : MORE_WRITTEN_BY_PIPELINE;
  } else if (data.isFocus && data.place === LineagePlace.Table) {
    template = data.isUpstream ? MORE_UPSTREAM_HERE : MORE_DOWNSTREAM_HERE;
  } else {
    template = data.isUpstream ? MORE_UPSTREAM : MORE_DOWNSTREAM;
  }

  return data.translator.translatePlural(template, data.count, {
    count: data.translator.formatNumber(data.count),
  });
}

// What a card's chips are read from: the card's own data, but whether it fades.
interface CardChipsProps {
  node: DataTableLineageNode;
  isFocus: boolean;
  place: LineagePlace;
  role: LineageCardRole | null;
}

// What most needs saying about a card, at most two chips.
const CardChips: FunctionComponent<CardChipsProps> = (
  props: CardChipsProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const node: DataTableLineageNode = props.node;
  const chips: Array<ReactElement> = [];

  if (props.isFocus) {
    chips.push(
      <Pill
        key="focus"
        text={FOCUS_LABELS[props.place]}
        color={Gray500}
        size={PillSize.Small}
      />,
    );
  }

  if (props.role) {
    chips.push(
      <Pill
        key="role"
        text={ROLE_LABELS[props.role]}
        color={Indigo500}
        size={PillSize.Small}
      />,
    );
  }

  if (node.kind === DataLineageNodeKind.Table) {
    if (node.isDropped) {
      chips.push(
        <Pill
          key="dropped"
          text={DROPPED}
          color={Gray500}
          size={PillSize.Small}
        />,
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
          <Pill
            key="fresh"
            text={FRESH}
            color={Green500}
            size={PillSize.Small}
          />,
        );
      }
    }
  }

  if (node.kind === DataLineageNodeKind.Pipeline) {
    chips.push(
      <span key="run" className="inline-flex">
        {getRunStatePill(node.lastRunState || undefined, PillSize.Small)}
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
  const place: LineagePlace = props.data.place;
  const tone: LineageTone = getLineageNodeTone(node);
  // On an alert's page its table or pipeline opens its own page; on that page, nothing.
  const route: Route | null = getLineageCardRoute(
    node,
    isFocus && place !== LineagePlace.Alert,
  );
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
    // The card the drawing is about, ringed; the cause and the alerts it caused, ringed strongly.
    boxShadow: props.data.role
      ? "0 0 0 3px rgba(99, 102, 241, 0.6), 0 2px 6px rgba(15, 23, 42, 0.08)"
      : isFocus
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
      <CardChips
        node={node}
        isFocus={isFocus}
        place={place}
        role={props.data.role}
      />
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
      style={{
        width: LINEAGE_CARD_WIDTH,
        position: "relative",
        ...(props.data.isDimmed ? { opacity: LINEAGE_DIMMED_OPACITY } : {}),
      }}
      data-node-id={node.id}
      {...(props.data.role ? { "data-role": props.data.role } : {})}
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
      {card}
      {hiddenUpstream > 0 ? (
        <HiddenCount
          count={hiddenUpstream}
          side="left"
          tooltip={getHiddenTooltip({
            translator,
            node,
            isFocus,
            place,
            isUpstream: true,
            count: hiddenUpstream,
          })}
        />
      ) : (
        <></>
      )}
      {hiddenDownstream > 0 ? (
        <HiddenCount
          count={hiddenDownstream}
          side="right"
          tooltip={getHiddenTooltip({
            translator,
            node,
            isFocus,
            place,
            isUpstream: false,
            count: hiddenDownstream,
          })}
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

interface LineageArrowData {
  // The failed pipeline's name, on its arrow; the whole sentence under the pointer.
  label?: string | undefined;
  title?: string | undefined;
  // The label names a pipeline on an alert's way, not a failed one: indigo, not red.
  isLabelHighlighted?: boolean | undefined;
  // On an alert's way: drawn over a halo.
  isHighlighted?: boolean | undefined;
}

/*
 * An arrow, and on one whose pipeline failed that pipeline's name: an
 * HTML label, so it is cut to the room between two columns, ends in "..."
 * when it is longer, and says the whole sentence under the pointer. An
 * arrow on an alert's way is drawn over a wide, faint indigo halo.
 */
const LineageArrow: FunctionComponent<EdgeProps<LineageArrowData>> = (
  props: EdgeProps<LineageArrowData>,
): ReactElement => {
  const [path, labelX, labelY] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  });

  return (
    <>
      {props.data?.isHighlighted ? (
        <path
          d={path}
          fill="none"
          stroke={LINEAGE_HIGHLIGHT_COLOR}
          strokeOpacity={0.22}
          strokeWidth={9}
          strokeLinecap="round"
          data-testid="lineage-edge-halo"
        />
      ) : (
        <></>
      )}
      <BaseEdge
        id={props.id}
        path={path}
        {...(props.style ? { style: props.style } : {})}
        {...(props.markerEnd ? { markerEnd: props.markerEnd } : {})}
      />
      {props.data?.label ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute truncate rounded px-1 text-[10px] font-medium"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              maxWidth: LINEAGE_EDGE_LABEL_MAX_WIDTH,
              color: props.data.isLabelHighlighted
                ? LINEAGE_HIGHLIGHT_COLOR
                : LINEAGE_PROBLEM_COLOR,
              background: "var(--ou-surface-primary, #ffffff)",
              pointerEvents: "all",
            }}
            title={props.data.title}
            data-testid="lineage-edge-label"
          >
            {props.data.label}
          </div>
        </EdgeLabelRenderer>
      ) : (
        <></>
      )}
    </>
  );
};

const EDGE_TYPES: EdgeTypes = {
  lineageArrow: LineageArrow,
};

export interface ComponentProps {
  lineage: DataTableLineage;
  // The page it is on: a table's Lineage tab unless said otherwise.
  place?: LineagePlace | undefined;
}

const LineageGraph: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const place: LineagePlace = props.place || LineagePlace.Table;
  const layout: LineageLayout = useMemo((): LineageLayout => {
    return layoutLineage(props.lineage);
  }, [props.lineage]);
  const highlight: LineageHighlightSets | null =
    useMemo((): LineageHighlightSets | null => {
      return getLineageHighlightSets(props.lineage);
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
          data: {
            node,
            isFocus: node.id === props.lineage.focusNodeId,
            place,
            role: getLineageCardRole(highlight, node.id),
            isDimmed: isLineageCardDimmed(highlight, node.id),
          },
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
  }, [layout, props.lineage, place, highlight]);

  const edges: Array<Edge> = useMemo((): Array<Edge> => {
    return props.lineage.edges.map((edge: DataTableLineageEdge): Edge => {
      const look: LineageArrowLook = getLineageArrowLook(
        edge,
        props.lineage.focusNodeId,
        highlight,
      );
      const data: LineageArrowData = {
        ...(look.label
          ? {
              label: look.label.pipeline.name,
              title: look.label.isFailed
                ? translator.translateTemplate(FAILED_PIPELINE, {
                    pipeline: look.label.pipeline.name,
                  })
                : look.label.pipeline.name,
              ...(look.label.isFailed ? {} : { isLabelHighlighted: true }),
            }
          : {}),
        ...(look.isHighlighted ? { isHighlighted: true } : {}),
      };

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "lineageArrow",
        data,
        // Over the faint arrows around it.
        ...(look.isHighlighted ? { zIndex: 1 } : {}),
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: look.color,
          width: ARROWHEAD_SIZE,
          height: ARROWHEAD_SIZE,
          markerUnits: "userSpaceOnUse",
        },
        style: {
          stroke: look.color,
          strokeWidth: look.width,
          ...(look.dash ? { strokeDasharray: look.dash } : {}),
          ...(look.isDimmed ? { opacity: LINEAGE_DIMMED_OPACITY } : {}),
        },
      };
    });
  }, [props.lineage, highlight, translator.language]);

  /*
   * A new drawing - another table, or more steps - is drawn afresh and
   * fitted again; React Flow fits a drawing only when it first shows it.
   */
  const drawingKey: string = `${props.lineage.focusNodeId}:${props.lineage.depth}:${props.lineage.nodes.length}`;

  // The canvas's size, read before the drawing is first shown: where it is looked at from depends on it.
  const canvasRef: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const flowRef: MutableRefObject<ReactFlowInstance | null> =
    useRef<ReactFlowInstance | null>(null);
  // Once the reader pans or zooms, the view is theirs.
  const hasReaderMovedRef: MutableRefObject<boolean> = useRef<boolean>(false);
  const [measured, setMeasured] = useState<{
    key: string;
    viewport: LineageViewport | null;
  } | null>(null);

  const readViewport: () => LineageViewport | null =
    useCallback((): LineageViewport | null => {
      const box: DOMRect | undefined =
        canvasRef.current?.getBoundingClientRect();

      return getLineageViewport({
        layout,
        focusNodeId: props.lineage.focusNodeId,
        width: box?.width || 0,
        height: box?.height || 0,
      });
    }, [layout, props.lineage.focusNodeId]);

  useLayoutEffect(() => {
    hasReaderMovedRef.current = false;
    setMeasured({ key: drawingKey, viewport: readViewport() });
  }, [drawingKey, readViewport]);

  // The canvas settling into its width, or the window resized: looked at afresh, until the reader moves it.
  useEffect(() => {
    const canvas: HTMLDivElement | null = canvasRef.current;

    if (!canvas || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer: ResizeObserver = new ResizeObserver((): void => {
      const viewport: LineageViewport | null = readViewport();

      if (viewport && flowRef.current && !hasReaderMovedRef.current) {
        flowRef.current.setViewport(viewport);
      }
    });

    observer.observe(canvas);

    return () => {
      observer.disconnect();
    };
  }, [readViewport]);

  const isMeasured: boolean = measured?.key === drawingKey;
  const viewport: LineageViewport | null = isMeasured
    ? measured?.viewport || null
    : null;

  return (
    <div
      ref={canvasRef}
      role="figure"
      aria-label={
        translator.translateText(MAP_LABELS[place]) || MAP_LABELS[place]
      }
      className="rounded-md border border-gray-200 bg-gray-50"
      style={getLineageCanvasStyle(layout)}
      data-testid="lineage-graph"
    >
      {isMeasured ? (
        <ReactFlow
          key={drawingKey}
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          // A canvas with no size to go by (never on a page) is fitted by React Flow.
          fitView={!viewport}
          {...(viewport ? { defaultViewport: viewport } : {})}
          fitViewOptions={FIT_VIEW_OPTIONS}
          onInit={(instance: ReactFlowInstance): void => {
            flowRef.current = instance;
          }}
          onMoveStart={(event: MouseEvent | TouchEvent | null): void => {
            // Only the reader's own moves carry an event.
            if (event) {
              hasReaderMovedRef.current = true;
            }
          }}
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
            position="bottom-right"
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
      ) : (
        <></>
      )}
    </div>
  );
};

// A line drawn the way the diagram draws one kind of arrow.
const LegendLine: FunctionComponent<{
  color: string;
  dash?: string | undefined;
  width?: number | undefined;
  hasHalo?: boolean | undefined;
}> = (props: {
  color: string;
  dash?: string | undefined;
  width?: number | undefined;
  hasHalo?: boolean | undefined;
}): ReactElement => {
  return (
    <svg width="28" height="10" aria-hidden="true" className="shrink-0">
      {props.hasHalo ? (
        <line
          x1="3"
          y1="5"
          x2="25"
          y2="5"
          stroke={LINEAGE_HIGHLIGHT_COLOR}
          strokeOpacity={0.22}
          strokeWidth={8}
          strokeLinecap="round"
        />
      ) : (
        <></>
      )}
      <line
        x1="1"
        y1="5"
        x2="27"
        y2="5"
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
          : {
              border: "1px solid #e2e8f0",
              borderTop: `3px solid ${props.color}`,
            }
      }
    />
  );
};

// What the diagram's lines and colours mean; on an alert's drawing, what is picked out.
export const LineageLegend: FunctionComponent<{
  hasHighlight?: boolean | undefined;
}> = (props: { hasHighlight?: boolean | undefined }): ReactElement => {
  const translator: Translator = useTranslator();
  const item: (
    key: string,
    mark: ReactElement,
    text: string,
  ) => ReactElement = (
    key: string,
    mark: ReactElement,
    text: string,
  ): ReactElement => {
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
      {props.hasHighlight ? (
        item(
          "highlight",
          <LegendLine
            color={LINEAGE_HIGHLIGHT_COLOR}
            width={LINEAGE_HIGHLIGHT_WIDTH}
            hasHalo={true}
          />,
          translationKey("Way to the cause and the alerts it caused"),
        )
      ) : (
        <></>
      )}
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

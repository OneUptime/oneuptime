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
  LineageColumnTrail,
  LineageHighlightSets,
  LineageLayout,
  LineagePlace,
  LineageTone,
  LineageViewport,
  canExpandLineageCard,
  getLineageArrowLook,
  getLineageCardRole,
  getLineageCardsInView,
  getLineageColumnHighlightSets,
  getLineageHighlightSets,
  getLineageViewport,
  getLineageViewportAfterExpanding,
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
  DataLineageSide,
  DataTableLineage,
  DataTableLineageEdge,
  DataTableLineageNode,
  MAX_DATA_LINEAGE_NEIGHBORS,
} from "Common/Types/DataObservability/DataTableLineage";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
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
 * drawn; pressed, it draws the next of them here (onExpand), and the view
 * keeps the card pressed where it was on the screen while the drawing is
 * laid out again around them (getLineageViewportAfterExpanding), the cards
 * drawn tinted a moment so the eye finds them (data-lineage-drawn). The page
 * scrolls over the drawing - the wheel never zooms it - and nothing on it
 * is dragged; the controls zoom and fit it. A drawing too wide to read
 * whole opens on the table itself, at a zoom its names can be read at
 * (getLineageViewport); the rest is a drag away. Until the reader pans or
 * zooms, the view follows the canvas's size.
 *
 * One column followed (columnTrail) is picked out the way an alert's ways
 * are, in indigo with the rest faint, and each card on its way names the
 * column there in place of the line under its name.
 *
 * The same drawing sits on a pipeline's page, the pipeline in the middle,
 * and on a data alert's page, around the alert's table or pipeline - which
 * opens its own page there - with the way to the alert's cause and to the
 * alerts it caused picked out: its cards and arrows in indigo, the cause
 * and each consequence named on its card, and the rest drawn faint. Too
 * wide to read whole, an alert's drawing opens on its cause - or on its
 * own card when nothing caused it - and as much of its ways as fits
 * (getLineageCardsInView), not just centred on the alert's own card.
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

// What pressing a count draws: all of them, or the next of them when there are more than a card draws at once.
const DRAW_UPSTREAM: PluralTemplate = {
  one: "Draw one more table upstream",
  other: "Draw {{count}} more tables upstream",
};
const DRAW_SOME_UPSTREAM: PluralTemplate = {
  one: "Draw {{batch}} of the {{count}} more tables upstream",
  other: "Draw {{batch}} of the {{count}} more tables upstream",
};
const DRAW_DOWNSTREAM: PluralTemplate = {
  one: "Draw one more table downstream",
  other: "Draw {{count}} more tables downstream",
};
const DRAW_SOME_DOWNSTREAM: PluralTemplate = {
  one: "Draw {{batch}} of the {{count}} more tables downstream",
  other: "Draw {{batch}} of the {{count}} more tables downstream",
};
const DRAW_READ_BY_PIPELINE: PluralTemplate = {
  one: "Draw one more table this pipeline reads",
  other: "Draw {{count}} more tables this pipeline reads",
};
const DRAW_SOME_READ_BY_PIPELINE: PluralTemplate = {
  one: "Draw {{batch}} of the {{count}} more tables this pipeline reads",
  other: "Draw {{batch}} of the {{count}} more tables this pipeline reads",
};
const DRAW_WRITTEN_BY_PIPELINE: PluralTemplate = {
  one: "Draw one more table this pipeline writes",
  other: "Draw {{count}} more tables this pipeline writes",
};
const DRAW_SOME_WRITTEN_BY_PIPELINE: PluralTemplate = {
  one: "Draw {{batch}} of the {{count}} more tables this pipeline writes",
  other: "Draw {{batch}} of the {{count}} more tables this pipeline writes",
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

/*
 * Every card over every arrow, and a highlighted arrow over the faint ones
 * around it: an arrowhead never covers a card's count, nor a highlighted
 * arrow a card it passes behind. React Flow draws arrows of one height in
 * a layer of their own, and a card over the arrows only when its height
 * is greater.
 */
const HIGHLIGHTED_ARROW_Z_INDEX: number = 1;
export const LINEAGE_CARD_Z_INDEX: number = 2;

/*
 * A card drawn here by the last count pressed: tinted a moment, the tint
 * fading to the card's own colour (Theme.css), so the eye finds the cards
 * drawn among the cards they were drawn beside.
 */
export const LINEAGE_DRAWN_ATTRIBUTE: string = "data-lineage-drawn";

/*
 * How far a count reaches into its card: its inner edge stays there, and
 * a longer count ("+128") grows outward, never over the card's words,
 * which start 13px in (a 1px border and 12px of padding).
 */
const HIDDEN_COUNT_REACH_PX: number = 8;

// The focus went nowhere: a focused control was turned off or taken away.
export function isLineageFocusLost(): boolean {
  const active: Element | null = document.activeElement;

  return !active || active === document.body;
}

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

// A count of tables not drawn that draws them here when pressed.
interface HiddenCountAction {
  // What pressing it draws, said under the pointer and to a screen reader.
  label: string;
  // Its tables are being drawn now.
  isBusy: boolean;
  // Another card's tables are being drawn: one at a time.
  isLocked: boolean;
  onPress: () => void;
}

interface LineageCardData {
  node: DataTableLineageNode;
  isFocus: boolean;
  place: LineagePlace;
  // At the end of an alert's way: its cause, or an alert it caused.
  role: LineageCardRole | null;
  // Off every way an alert's drawing picks out.
  isDimmed: boolean;
  // On a column's way: the column there, in place of the line under its name.
  columns?: Array<string> | undefined;
  // Pressing a count draws its tables here.
  drawUpstream?: HiddenCountAction | undefined;
  drawDownstream?: HiddenCountAction | undefined;
  // Drawn here by the last count pressed: tinted a moment.
  isDrawn?: boolean | undefined;
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

/*
 * What pressing a count draws, as its label: a pipeline's what it reads or
 * writes, a table's the tables that way - all of them, or the next of
 * them when there are more than a card draws at once.
 */
export function getLineageDrawLabel(data: {
  translator: Translator;
  node: DataTableLineageNode;
  isUpstream: boolean;
  count: number;
}): string {
  const isSome: boolean = data.count > MAX_DATA_LINEAGE_NEIGHBORS;
  let template: PluralTemplate;

  if (data.node.kind === DataLineageNodeKind.Pipeline) {
    template = data.isUpstream
      ? isSome
        ? DRAW_SOME_READ_BY_PIPELINE
        : DRAW_READ_BY_PIPELINE
      : isSome
        ? DRAW_SOME_WRITTEN_BY_PIPELINE
        : DRAW_WRITTEN_BY_PIPELINE;
  } else {
    template = data.isUpstream
      ? isSome
        ? DRAW_SOME_UPSTREAM
        : DRAW_UPSTREAM
      : isSome
        ? DRAW_SOME_DOWNSTREAM
        : DRAW_DOWNSTREAM;
  }

  return data.translator.translatePlural(template, data.count, {
    count: data.translator.formatNumber(data.count),
    batch: data.translator.formatNumber(MAX_DATA_LINEAGE_NEIGHBORS),
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

const HIDDEN_COUNT_CLASS_NAME: string =
  "absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-600 shadow-sm";

/*
 * A count's tap area: the pill (21px high, 27px wide for "+3") with an
 * invisible margin 6px up and down and 4px either side, so a finger meets
 * a target of 24px or more even at the least zoom a drawing opens at
 * (LINEAGE_READABLE_ZOOM, three quarters), and presses the count rather
 * than the card under it, which would open that table and leave the
 * drawing. Over the card it reaches 4px further in than the pill, 12px in
 * all: short of the card's words, which start 13px in.
 */
export const LINEAGE_HIDDEN_COUNT_TAP_AREA_CLASS_NAME: string =
  "before:absolute before:-inset-x-1 before:-inset-y-1.5 before:content-['']";

/*
 * Where a count sits on its card's outer side: across the card's edge,
 * its inner edge HIDDEN_COUNT_REACH_PX in, so a count of any length
 * leaves the card's words clear.
 */
export function getLineageHiddenCountStyle(
  side: "left" | "right",
): CSSProperties {
  const inner: string = `calc(100% - ${HIDDEN_COUNT_REACH_PX}px)`;

  return side === "left" ? { right: inner } : { left: inner };
}

interface HiddenCountProps {
  count: number;
  side: "left" | "right";
  tooltip: string;
  action?: HiddenCountAction | undefined;
  // The count's button, while it is one.
  buttonRef?: RefObject<HTMLButtonElement> | undefined;
  // Pressed where the keyboard's focus is: the card keeps that place while its tables are drawn.
  onPressedFromFocus?: (() => void) | undefined;
}

/*
 * "+12" on a card's outer side: the tables that way that are not drawn.
 * With an action it is a button that draws the next of them here - its
 * label says how many - turning while they are read, and not pressable
 * while another card's are. Without one it says, under the pointer, where
 * to see them.
 */
const HiddenCount: FunctionComponent<HiddenCountProps> = (
  props: HiddenCountProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const text: string = translator.translateTemplate("+{{count}}", {
    count: translator.formatNumber(props.count),
  });
  const style: CSSProperties = getLineageHiddenCountStyle(props.side);
  const action: HiddenCountAction | undefined = props.action;

  if (!action) {
    return (
      <span
        className={HIDDEN_COUNT_CLASS_NAME}
        style={style}
        title={props.tooltip}
        data-testid={`lineage-hidden-${props.side}`}
      >
        {text}
      </span>
    );
  }

  return (
    <button
      ref={props.buttonRef}
      type="button"
      className={`nodrag nopan inline-flex items-center ${HIDDEN_COUNT_CLASS_NAME} ${LINEAGE_HIDDEN_COUNT_TAP_AREA_CLASS_NAME} focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${getHandDrawnButtonStateClassName(
        {
          isLocked: action.isLocked,
          isBusy: action.isBusy,
          hoverClassName:
            "cursor-pointer hover:border-indigo-400 hover:text-indigo-700",
        },
      )}`}
      style={style}
      title={action.label}
      aria-label={action.label}
      {...(action.isBusy ? { "aria-busy": true } : {})}
      disabled={action.isLocked || action.isBusy}
      onClick={(event: React.MouseEvent<HTMLButtonElement>): void => {
        // The card under it opens its table: the count draws, and only that.
        event.stopPropagation();
        event.preventDefault();

        if (document.activeElement === event.currentTarget) {
          props.onPressedFromFocus?.();
        }

        action.onPress();
      }}
      data-testid={`lineage-hidden-${props.side}`}
    >
      {/*
       * While they are read the spinner turns over the number, which stays
       * (unseen) so the count keeps its size and does not grow over the card.
       */}
      <span className={action.isBusy ? "invisible" : ""}>{text}</span>
      {action.isBusy ? (
        <span
          className="absolute inset-0 flex items-center justify-center"
          data-testid={`lineage-hidden-${props.side}-spinner`}
        >
          <Icon icon={IconProp.Spinner} className="h-2.5 w-2.5 animate-spin" />
        </span>
      ) : (
        <></>
      )}
    </button>
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
  // The column followed, as this table names it: in place of the line under its name.
  const columns: string = (props.data.columns || []).join(", ");
  const drawnMark: Record<string, string> = props.data.isDrawn
    ? { [LINEAGE_DRAWN_ATTRIBUTE]: "true" }
    : {};

  const rootRef: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const upstreamCountRef: RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  const downstreamCountRef: RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  // The count pressed where the keyboard's focus was, until its tables are drawn.
  const pressedFromFocusRef: MutableRefObject<"left" | "right" | null> = useRef<
    "left" | "right" | null
  >(null);
  const isDrawing: boolean = Boolean(
    props.data.drawUpstream?.isBusy || props.data.drawDownstream?.isBusy,
  );

  /*
   * A count pressed from the keyboard keeps the keyboard's place. While its
   * tables are drawn it cannot be pressed, and the browser moves the focus
   * off it to the page itself; once they are drawn - or could not be - the
   * focus comes back: to the count, while some are still not drawn; to its
   * card, when it has drawn them all and is gone; to the drawing, when the
   * card opens nothing. Only while the focus is still lost: a reader who
   * moved on meanwhile keeps their place.
   */
  useEffect(() => {
    const side: "left" | "right" | null = pressedFromFocusRef.current;

    if (isDrawing || !side) {
      return;
    }

    pressedFromFocusRef.current = null;

    if (!isLineageFocusLost()) {
      return;
    }

    const count: HTMLButtonElement | null =
      side === "left" ? upstreamCountRef.current : downstreamCountRef.current;
    const root: HTMLDivElement | null = rootRef.current;
    const place: HTMLElement | null =
      count && !count.disabled
        ? count
        : root?.querySelector<HTMLElement>("a[href]") ||
          root?.closest<HTMLElement>('[role="figure"]') ||
          null;

    place?.focus({ preventScroll: true });
  }, [isDrawing]);

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
      {columns ? (
        <span
          className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] font-medium text-indigo-600"
          title={columns}
          data-testid="lineage-card-columns"
        >
          <Icon icon={IconProp.ViewColumns} className="h-3 w-3 shrink-0" />
          <IsolatedText text={columns} className="min-w-0 truncate font-mono" />
        </span>
      ) : subtitle ? (
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
    <span style={cardStyle} data-testid="lineage-card" {...drawnMark}>
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
        <span style={{ ...cardStyle, cursor: "pointer" }} {...drawnMark}>
          {body}
        </span>
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
        <span style={{ ...cardStyle, cursor: "pointer" }} {...drawnMark}>
          {body}
        </span>
      </Link>
    );
  }

  const hiddenUpstream: number = node.hiddenUpstreamCount || 0;
  const hiddenDownstream: number = node.hiddenDownstreamCount || 0;

  return (
    <div
      ref={rootRef}
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
          action={props.data.drawUpstream}
          buttonRef={upstreamCountRef}
          onPressedFromFocus={(): void => {
            pressedFromFocusRef.current = "left";
          }}
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
          action={props.data.drawDownstream}
          buttonRef={downstreamCountRef}
          onPressedFromFocus={(): void => {
            pressedFromFocusRef.current = "right";
          }}
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

// A card's tables drawn here, for the view to follow.
export interface LineageGrowth {
  // One per drawing more: the view follows each once.
  key: number;
  // The card pressed.
  nodeId: string;
  // The cards drawn.
  newNodeIds: Array<string>;
}

// A card's count that is being drawn now.
export interface LineageExpanding {
  nodeId: string;
  side: DataLineageSide;
}

export interface ComponentProps {
  lineage: DataTableLineage;
  // The page it is on: a table's Lineage tab unless said otherwise.
  place?: LineagePlace | undefined;
  /*
   * The drawing the view belongs to: a drawing grown here keeps its key, so
   * the view stays where the reader has it. By default each drawing is new.
   */
  drawingKey?: string | undefined;
  // Pressing a card's count draws its tables here; without it a count only says where to see them.
  onExpand?: ((nodeId: string, side: DataLineageSide) => void) | undefined;
  // The count being drawn now: it turns, and no other can be pressed meanwhile.
  expanding?: LineageExpanding | null | undefined;
  // The tables drawn here last: the view keeps the card pressed in place and brings them into view.
  growth?: LineageGrowth | null | undefined;
  // One column followed up and down, picked out with its name on each card on its way.
  columnTrail?: LineageColumnTrail | null | undefined;
  /*
   * The drawing itself, which can take the keyboard's focus: where it goes
   * when the control that had it is gone (Reset diagram, once pressed).
   */
  figureRef?: RefObject<HTMLDivElement> | undefined;
}

const LineageGraph: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const place: LineagePlace = props.place || LineagePlace.Table;
  const layout: LineageLayout = useMemo((): LineageLayout => {
    return layoutLineage(props.lineage);
  }, [props.lineage]);
  // An alert's ways: what its drawing opens on.
  const alertHighlight: LineageHighlightSets | null =
    useMemo((): LineageHighlightSets | null => {
      return getLineageHighlightSets(props.lineage);
    }, [props.lineage]);
  // What is picked out: a column followed, else an alert's ways.
  const highlight: LineageHighlightSets | null =
    useMemo((): LineageHighlightSets | null => {
      return props.columnTrail
        ? getLineageColumnHighlightSets(props.columnTrail)
        : alertHighlight;
    }, [props.columnTrail, alertHighlight]);
  const onExpand:
    | ((nodeId: string, side: DataLineageSide) => void)
    | undefined = props.onExpand;
  const expanding: LineageExpanding | null = props.expanding || null;

  const nodes: Array<Node<LineageCardData>> = useMemo((): Array<
    Node<LineageCardData>
  > => {
    // Pressing a count draws its tables, one card's at a time.
    const actionFor: (
      node: DataTableLineageNode,
      side: DataLineageSide,
    ) => HiddenCountAction | undefined = (
      node: DataTableLineageNode,
      side: DataLineageSide,
    ): HiddenCountAction | undefined => {
      if (!onExpand || !canExpandLineageCard(props.lineage, node, side)) {
        return undefined;
      }

      const isUpstream: boolean = side === DataLineageSide.Upstream;
      const isBusy: boolean = Boolean(
        expanding && expanding.nodeId === node.id && expanding.side === side,
      );

      return {
        label: getLineageDrawLabel({
          translator,
          node,
          isUpstream,
          count:
            (isUpstream
              ? node.hiddenUpstreamCount
              : node.hiddenDownstreamCount) || 0,
        }),
        isBusy,
        isLocked: Boolean(expanding) && !isBusy,
        onPress: (): void => {
          onExpand(node.id, side);
        },
      };
    };

    const drawnIds: Set<string> = new Set(props.growth?.newNodeIds || []);

    return props.lineage.nodes.map(
      (node: DataTableLineageNode): Node<LineageCardData> => {
        const columns: Array<string> | undefined =
          props.columnTrail?.columns.get(node.id);
        const drawUpstream: HiddenCountAction | undefined = actionFor(
          node,
          DataLineageSide.Upstream,
        );
        const drawDownstream: HiddenCountAction | undefined = actionFor(
          node,
          DataLineageSide.Downstream,
        );

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
            ...(columns && columns.length > 0 ? { columns } : {}),
            ...(drawUpstream ? { drawUpstream } : {}),
            ...(drawDownstream ? { drawDownstream } : {}),
            ...(drawnIds.has(node.id) ? { isDrawn: true } : {}),
          },
          zIndex: LINEAGE_CARD_Z_INDEX,
          /*
           * Its size, which React Flow forgets whenever the drawing
           * changes - a count pressed, a column followed - hiding every
           * card until it has measured them again: a count or a card that
           * had the keyboard's focus lost it, and could not be given it
           * back while hidden.
           */
          width: LINEAGE_CARD_WIDTH,
          height: LINEAGE_CARD_HEIGHT,
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
  }, [
    layout,
    props.lineage,
    place,
    highlight,
    props.columnTrail,
    onExpand,
    expanding,
    props.growth,
    translator.language,
  ]);

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
        // Over the faint arrows around it, under the cards.
        ...(look.isHighlighted ? { zIndex: HIGHLIGHTED_ARROW_Z_INDEX } : {}),
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
   * A drawing grown here keeps the key it was given, so its view stays.
   */
  const drawingKey: string =
    props.drawingKey ||
    `${props.lineage.focusNodeId}:${props.lineage.depth}:${props.lineage.nodes.length}`;

  // The canvas's size, read before the drawing is first shown: where it is looked at from depends on it.
  const ownCanvasRef: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const canvasRef: RefObject<HTMLDivElement> = props.figureRef || ownCanvasRef;
  const flowRef: MutableRefObject<ReactFlowInstance | null> =
    useRef<ReactFlowInstance | null>(null);
  // Once the reader pans or zooms, the view is theirs.
  const hasReaderMovedRef: MutableRefObject<boolean> = useRef<boolean>(false);
  const [measured, setMeasured] = useState<{
    key: string;
    viewport: LineageViewport | null;
  } | null>(null);

  // Where the drawing is looked at from now: the last view set, or the reader's own.
  const viewportRef: MutableRefObject<LineageViewport | null> =
    useRef<LineageViewport | null>(null);
  // The layout on the screen, to keep a card pressed where it was once the drawing grows.
  const shownLayoutRef: MutableRefObject<LineageLayout | null> =
    useRef<LineageLayout | null>(null);
  const followedGrowthRef: MutableRefObject<number | null> = useRef<
    number | null
  >(null);

  const readViewport: () => LineageViewport | null =
    useCallback((): LineageViewport | null => {
      const box: DOMRect | undefined =
        canvasRef.current?.getBoundingClientRect();

      return getLineageViewport({
        layout,
        focusNodeId: props.lineage.focusNodeId,
        width: box?.width || 0,
        height: box?.height || 0,
        // On an alert's drawing, its cause first: what the person paged came to see.
        inView: getLineageCardsInView(props.lineage, layout, alertHighlight),
      });
    }, [layout, props.lineage, alertHighlight]);
  const readViewportRef: MutableRefObject<() => LineageViewport | null> =
    useRef<() => LineageViewport | null>(readViewport);

  readViewportRef.current = readViewport;

  // A new drawing: looked at afresh. A drawing grown here keeps its view.
  useLayoutEffect(() => {
    const viewport: LineageViewport | null = readViewportRef.current();

    hasReaderMovedRef.current = false;
    viewportRef.current = viewport;
    shownLayoutRef.current = null;
    setMeasured({ key: drawingKey, viewport });
  }, [drawingKey]);

  /*
   * Tables drawn here: the card pressed stays where it was on the screen
   * and the view slides to bring them in - or, while the reader has not
   * moved it and the drawing still reads whole, all of it is fitted again.
   */
  useEffect(() => {
    const shown: LineageLayout | null = shownLayoutRef.current;
    const growth: LineageGrowth | null = props.growth || null;

    shownLayoutRef.current = layout;

    if (
      !growth ||
      !shown ||
      shown === layout ||
      followedGrowthRef.current === growth.key
    ) {
      return;
    }

    followedGrowthRef.current = growth.key;

    const flow: ReactFlowInstance | null = flowRef.current;
    const box: DOMRect | undefined = canvasRef.current?.getBoundingClientRect();
    const current: LineageViewport | null =
      (flow && typeof flow.getViewport === "function"
        ? flow.getViewport()
        : null) || viewportRef.current;

    if (!flow || !current) {
      return;
    }

    const next: { viewport: LineageViewport; isFitted: boolean } | null =
      getLineageViewportAfterExpanding({
        before: shown,
        after: layout,
        viewport: current,
        nodeId: growth.nodeId,
        newNodeIds: growth.newNodeIds,
        focusNodeId: props.lineage.focusNodeId,
        width: box?.width || 0,
        height: box?.height || 0,
        hasReaderMoved: hasReaderMovedRef.current,
      });

    if (!next) {
      return;
    }

    flow.setViewport(next.viewport);
    viewportRef.current = next.viewport;

    // A view that is not the whole drawing fitted is the reader's: the canvas resizing no longer moves it.
    if (!next.isFitted) {
      hasReaderMovedRef.current = true;
    }
  }, [layout, props.growth]);

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
        viewportRef.current = viewport;
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
      /*
       * Focused by a script only - a count that drew all its tables on a
       * card that opens nothing, Reset diagram once pressed - so the
       * keyboard's place is kept, and Tab goes on to the cards in it.
       */
      tabIndex={-1}
      className="rounded-md border border-gray-200 bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
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
          onMoveEnd={(
            _event: MouseEvent | TouchEvent | null,
            moved: LineageViewport,
          ): void => {
            viewportRef.current = moved;
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

/*
 * A way picked out on an alert's drawing, drawn as the diagram draws it:
 * the mark that starts each sentence saying a way is highlighted, so the
 * sentence says what the indigo line is.
 */
export const LineageHighlightSwatch: FunctionComponent = (): ReactElement => {
  return (
    <LegendLine
      color={LINEAGE_HIGHLIGHT_COLOR}
      width={LINEAGE_HIGHLIGHT_WIDTH}
      hasHalo={true}
    />
  );
};

// What the diagram's lines and colours mean.
export const LineageLegend: FunctionComponent = (): ReactElement => {
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

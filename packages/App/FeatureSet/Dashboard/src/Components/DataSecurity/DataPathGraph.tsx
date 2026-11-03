import AppLink from "../AppLink/AppLink";
import { edgeWidthForCalls } from "../Topology/TopologyMeta";
import {
  ExposurePill,
  SENSITIVITY_COLOR,
  SensitivityPill,
} from "./DataSecurityPills";
import {
  DATA_PATH_CARD_WIDTH,
  DATA_PATH_COLUMN_DESTINATIONS,
  DATA_PATH_COLUMN_REACH,
  DATA_PATH_COLUMN_SERVICES,
  DATA_PATH_COLUMN_STORE,
  DataPathEdge,
  DataPathEdgeKind,
  DataPathGraph as DataPathGraphModel,
  DataPathHeading,
  DataPathLayout,
  DataPathMoreTarget,
  DataPathNode,
  DataPathNodeKind,
  DataPathReach,
  getDataPathDrawingSize,
  layoutDataPaths,
} from "./DataPathModel";
import {
  ANYONE_ON_THE_INTERNET,
  NOT_USED_IN_90_DAYS,
  OUTSIDE_YOUR_ACCOUNTS,
} from "./IdentityCells";
import { getStoreViewRoute } from "./IssueListRoute";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DataStoreAccess from "Common/Models/DatabaseModels/DataStoreAccess";
import Route from "Common/Types/API/Route";
import { Gray500, Orange500, Red500 } from "Common/Types/BrandColors";
import {
  DataStoreAccessLevel,
  DataStorePrincipalType,
} from "Common/Types/DataSecurity/DataStoreAccess";
import DataSensitivity from "Common/Types/DataSecurity/DataSensitivity";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Pill from "Common/UI/Components/Pill/Pill";
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
 * A STORE'S DATA PATHS, DRAWN (DataPathModel works out what is drawn).
 *
 * Cards in four columns with a heading over each, arrows left to right.
 * An arrow into the store is access, red from anyone on the internet and
 * orange from outside your accounts, worded with the most it allows. An
 * arrow out of the store or a service carries data, coloured by how
 * sensitive that data is, and dashed until a scan confirmed the data gets
 * there. A card opens its page: an identity's, a service's, a copy's, or
 * for "+N more" the page that lists them all.
 *
 * The page scrolls over the drawing - the wheel never zooms it - and
 * nothing on it is dragged; the controls zoom and fit it.
 */

export const DATA_PATH_CARD_MIN_HEIGHT: number = 62;

const HEADINGS: Readonly<Record<number, string>> = {
  [DATA_PATH_COLUMN_REACH]: translationKey("Who can reach it"),
  [DATA_PATH_COLUMN_STORE]: translationKey("This store"),
  [DATA_PATH_COLUMN_SERVICES]: translationKey("Services that use it"),
  [DATA_PATH_COLUMN_DESTINATIONS]: translationKey("Where its data can go"),
};

const MAP_LABEL: string = translationKey(
  "Who can reach this store, the services that use it, and where its data can go",
);
const UNKNOWN_SERVICE: string = translationKey("A service");
const UNKNOWN_STORE: string = translationKey("A store");
const SERVICE: string = translationKey("Service");
const AI_PROVIDER: string = translationKey("AI Provider");
const EXTERNAL_HOST: string = translationKey("External Host");
const COPY: string = translationKey("Copy");

const MORE: PluralTemplate = {
  one: "+{{count}} more",
  other: "+{{count}} more",
};
const CALLS: PluralTemplate = {
  one: "{{count}} call",
  other: "{{count}} calls",
};
const OVERLAP: string = translationKey("{{percent}}% of values");

// An arrow that carries nothing sensitive, or access from your own accounts.
export const NEUTRAL_EDGE_COLOR: string = "#94a3b8";

const REACH_COLOR: Readonly<Record<DataPathReach, string>> = {
  [DataPathReach.Public]: Red500.toString(),
  [DataPathReach.Outside]: Orange500.toString(),
  [DataPathReach.Yours]: NEUTRAL_EDGE_COLOR,
};

const ACCESS_EDGE_WIDTH: Readonly<Record<string, number>> = {
  [DataStoreAccessLevel.Admin]: 2.5,
  [DataStoreAccessLevel.Write]: 2,
  [DataStoreAccessLevel.Read]: 1.5,
};

const PRINCIPAL_ICONS: Readonly<Record<string, IconProp>> = {
  [DataStorePrincipalType.Public]: IconProp.Globe,
  [DataStorePrincipalType.Account]: IconProp.BuildingOffice,
  [DataStorePrincipalType.Role]: IconProp.Key,
  [DataStorePrincipalType.User]: IconProp.User,
  [DataStorePrincipalType.Group]: IconProp.UserGroup,
  [DataStorePrincipalType.ServicePrincipal]: IconProp.Cog,
  [DataStorePrincipalType.ServiceAccount]: IconProp.Cog,
};

const MAX_FLOW_EDGE_WIDTH: number = 3.5;

// Arrowheads one size whatever the arrow's width: React Flow scales them with it by default.
const ARROWHEAD_SIZE: number = 16;

const FIT_VIEW_OPTIONS: FitViewOptions = { padding: 0.12, maxZoom: 1 };

const HANDLE_STYLE: CSSProperties = { opacity: 0, pointerEvents: "none" };

// What travels along a flow, as a colour: grey for nothing sensitive.
export function getFlowEdgeColor(
  sensitivity: DataSensitivity | undefined,
): string {
  if (!sensitivity || sensitivity === DataSensitivity.Public) {
    return NEUTRAL_EDGE_COLOR;
  }

  return SENSITIVITY_COLOR[sensitivity].toString();
}

export function getDataPathEdgeColor(edge: DataPathEdge): string {
  if (edge.kind === DataPathEdgeKind.Access) {
    return REACH_COLOR[edge.reach || DataPathReach.Yours];
  }

  if (edge.kind === DataPathEdgeKind.Uses) {
    return NEUTRAL_EDGE_COLOR;
  }

  return getFlowEdgeColor(edge.sensitivity);
}

// The figure an arrow is worded with, or nothing.
function getEdgeLabel(edge: DataPathEdge, translator: Translator): string {
  if (edge.kind === DataPathEdgeKind.Access) {
    return translator.translateText(edge.accessLevel) || edge.accessLevel || "";
  }

  if (edge.kind === DataPathEdgeKind.Copy) {
    return edge.overlapPercent
      ? translator.translateTemplate(OVERLAP, {
          percent: translator.formatNumber(Math.round(edge.overlapPercent)),
        })
      : "";
  }

  return edge.callCount
    ? translator.translatePlural(CALLS, edge.callCount, {
        count: translator.formatNumber(edge.callCount),
      })
    : "";
}

function getEdgeWidth(edge: DataPathEdge): number {
  if (edge.kind === DataPathEdgeKind.Access) {
    return ACCESS_EDGE_WIDTH[edge.accessLevel || ""] || 1.5;
  }

  if (edge.kind === DataPathEdgeKind.Copy) {
    return 2;
  }

  // Busier is thicker, as on the Service Map, but never past the access arrows by much.
  return Math.min(MAX_FLOW_EDGE_WIDTH, edgeWidthForCalls(edge.callCount));
}

// The colour along a card's top: how bad what it stands for is.
function getCardAccent(node: DataPathNode): string {
  if (node.kind === DataPathNodeKind.Identity) {
    return REACH_COLOR[node.reach || DataPathReach.Yours];
  }

  if (node.kind === DataPathNodeKind.Service) {
    return NEUTRAL_EDGE_COLOR;
  }

  return getFlowEdgeColor(node.sensitivity);
}

function getCardIcon(node: DataPathNode): IconProp {
  switch (node.kind) {
    case DataPathNodeKind.Identity:
      return (
        PRINCIPAL_ICONS[node.principalType || ""] || IconProp.Identification
      );
    case DataPathNodeKind.Service:
      return IconProp.Cube;
    case DataPathNodeKind.AiProvider:
      return IconProp.Bolt;
    case DataPathNodeKind.ExternalHost:
      return IconProp.Globe;
    case DataPathNodeKind.More:
      return IconProp.ChevronRight;
    default:
      return IconProp.Database;
  }
}

function getCardTitle(node: DataPathNode, translator: Translator): string {
  if (node.kind === DataPathNodeKind.Identity && !node.name) {
    return translator.translateText(ANYONE_ON_THE_INTERNET) || "";
  }

  if (node.kind === DataPathNodeKind.Service && !node.name) {
    return translator.translateText(UNKNOWN_SERVICE) || "";
  }

  if (node.kind === DataPathNodeKind.Copy && !node.name) {
    return translator.translateText(UNKNOWN_STORE) || "";
  }

  if (node.kind === DataPathNodeKind.More) {
    return translator.translatePlural(MORE, node.moreCount || 0, {
      count: translator.formatNumber(node.moreCount || 0),
    });
  }

  return node.name;
}

// The line under a card's name: what kind of thing it is.
function getCardSubtitle(node: DataPathNode, translator: Translator): string {
  switch (node.kind) {
    case DataPathNodeKind.Identity:
      return node.reach === DataPathReach.Public
        ? ""
        : translator.translateText(node.principalType) ||
            node.principalType ||
            "";
    case DataPathNodeKind.Store:
      return node.storeKind || "";
    case DataPathNodeKind.Service:
      return translator.translateText(SERVICE) || "";
    case DataPathNodeKind.AiProvider:
      return translator.translateText(AI_PROVIDER) || "";
    case DataPathNodeKind.ExternalHost:
      return translator.translateText(EXTERNAL_HOST) || "";
    case DataPathNodeKind.Copy:
      return translator.translateText(COPY) || "";
    default:
      return "";
  }
}

function getDataStorePageRoute(storeId: string, page: PageMap): Route {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: new ObjectID(storeId),
  });
}

// The page a card opens, when it opens one by itself (an identity's is looked up).
export function getDataPathCardRoute(
  node: DataPathNode,
  storeId: string,
): Route | null {
  if (node.kind === DataPathNodeKind.Service && node.serviceId) {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.SERVICE_VIEW] as Route,
      { modelId: new ObjectID(node.serviceId) },
    );
  }

  if (node.kind === DataPathNodeKind.Copy && node.storeId) {
    return getStoreViewRoute(node.storeId);
  }

  if (node.kind === DataPathNodeKind.More && storeId) {
    return getDataStorePageRoute(
      storeId,
      node.moreTarget === DataPathMoreTarget.Access
        ? PageMap.DATA_SECURITY_STORE_VIEW_ACCESS
        : PageMap.DATA_SECURITY_STORE_VIEW_FLOWS,
    );
  }

  return null;
}

interface DataPathCardData {
  node: DataPathNode;
  storeId: string;
  onOpenIdentity?: ((access: DataStoreAccess) => void) | undefined;
}

interface DataPathHeadingData {
  text: string;
}

// A card's chips: what most needs saying about it, at most two.
const CardChips: FunctionComponent<{ node: DataPathNode }> = (props: {
  node: DataPathNode;
}): ReactElement => {
  const node: DataPathNode = props.node;
  const chips: Array<ReactElement> = [];

  if (node.kind === DataPathNodeKind.Store) {
    if (node.sensitivity) {
      chips.push(
        <SensitivityPill key="sensitivity" sensitivity={node.sensitivity} />,
      );
    }

    if (node.exposure) {
      chips.push(<ExposurePill key="exposure" exposure={node.exposure} />);
    }
  } else if (node.kind === DataPathNodeKind.Identity) {
    if (node.reach === DataPathReach.Outside) {
      chips.push(
        <Pill key="outside" text={OUTSIDE_YOUR_ACCOUNTS} color={Orange500} />,
      );
    }

    if (node.isUnused) {
      chips.push(
        <Pill key="unused" text={NOT_USED_IN_90_DAYS} color={Gray500} />,
      );
    }
  } else if (
    node.sensitivity &&
    node.sensitivity !== DataSensitivity.Public &&
    (node.kind === DataPathNodeKind.Copy ||
      node.kind === DataPathNodeKind.AiProvider)
  ) {
    chips.push(
      <SensitivityPill key="sensitivity" sensitivity={node.sensitivity} />,
    );
  }

  if (chips.length === 0) {
    return <></>;
  }

  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-1">{chips}</span>
  );
};

const DataPathCard: FunctionComponent<NodeProps<DataPathCardData>> = (
  props: NodeProps<DataPathCardData>,
): ReactElement => {
  const translator: Translator = useTranslator();
  const node: DataPathNode = props.data.node;
  const isMore: boolean = node.kind === DataPathNodeKind.More;
  const isStore: boolean = node.kind === DataPathNodeKind.Store;
  const title: string = getCardTitle(node, translator);
  const subtitle: string = getCardSubtitle(node, translator);
  const route: Route | null = getDataPathCardRoute(node, props.data.storeId);
  const access: DataStoreAccess | undefined =
    node.kind === DataPathNodeKind.Identity ? node.access : undefined;
  const onOpenIdentity: ((access: DataStoreAccess) => void) | undefined =
    props.data.onOpenIdentity;

  const cardStyle: CSSProperties = {
    // One height for a name and a line under it; chips add to it.
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    minHeight: DATA_PATH_CARD_MIN_HEIGHT,
    width: DATA_PATH_CARD_WIDTH,
    boxSizing: "border-box",
    textAlign: "start",
    border: isMore
      ? "1px dashed var(--ou-border-primary, #cbd5e1)"
      : "1px solid var(--ou-border-primary, #e2e8f0)",
    borderTop: isMore
      ? "1px dashed var(--ou-border-primary, #cbd5e1)"
      : `3px solid ${getCardAccent(node)}`,
    borderRadius: 10,
    padding: "10px 12px",
    background: "var(--ou-surface-primary, #ffffff)",
    color: "var(--ou-text-primary, #111827)",
    boxShadow: isStore
      ? "0 0 0 3px rgba(99, 102, 241, 0.18), 0 2px 6px rgba(15, 23, 42, 0.08)"
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
          className="min-w-0 truncate text-[13px] font-semibold"
          title={title}
        >
          {isMore ? title : <IsolatedText text={title} />}
        </span>
      </span>
      {subtitle ? (
        <span className="mt-0.5 block truncate text-[11px] text-gray-500">
          {subtitle}
        </span>
      ) : (
        <></>
      )}
      <CardChips node={node} />
    </>
  );

  let card: ReactElement = (
    <span style={cardStyle} data-testid="data-path-card">
      {body}
    </span>
  );

  if (route) {
    card = (
      <AppLink
        to={route}
        className="nodrag nopan block rounded-[10px] hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        dataTestId="data-path-card"
      >
        <span style={{ ...cardStyle, cursor: "pointer" }}>{body}</span>
      </AppLink>
    );
  } else if (access && onOpenIdentity) {
    card = (
      <button
        type="button"
        className="nodrag nopan block rounded-[10px] hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        style={{ padding: 0, border: 0, background: "transparent" }}
        data-testid="data-path-card"
        onClick={() => {
          onOpenIdentity(access);
        }}
      >
        <span style={{ ...cardStyle, cursor: "pointer" }}>{body}</span>
      </button>
    );
  }

  return (
    <div style={{ width: DATA_PATH_CARD_WIDTH }}>
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
    </div>
  );
};

const DataPathHeadingCard: FunctionComponent<NodeProps<DataPathHeadingData>> = (
  props: NodeProps<DataPathHeadingData>,
): ReactElement => {
  return (
    <div
      style={{ width: DATA_PATH_CARD_WIDTH }}
      className="text-xs font-medium uppercase tracking-wide text-gray-500"
    >
      {props.data.text}
    </div>
  );
};

const NODE_TYPES: NodeTypes = {
  dataPathCard: DataPathCard,
  dataPathHeading: DataPathHeadingCard,
};

// The canvas's height bounds; between them it keeps the drawing's shape.
const CANVAS_MIN_HEIGHT: number = 260;
const CANVAS_MAX_HEIGHT: number = 620;

export function getDataPathCanvasStyle(layout: DataPathLayout): CSSProperties {
  const size: { width: number; height: number } =
    getDataPathDrawingSize(layout);

  return {
    width: "100%",
    aspectRatio: `${size.width} / ${size.height}`,
    minHeight: CANVAS_MIN_HEIGHT,
    maxHeight: CANVAS_MAX_HEIGHT,
  };
}

export interface ComponentProps {
  graph: DataPathGraphModel;
  storeId: string;
  // Opens an identity's page from one of its grants; without it, identities do not open.
  onOpenIdentity?: ((access: DataStoreAccess) => void) | undefined;
}

const DataPathGraph: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const layout: DataPathLayout = useMemo((): DataPathLayout => {
    return layoutDataPaths(props.graph);
  }, [props.graph]);

  const nodes: Array<Node<DataPathCardData | DataPathHeadingData>> =
    useMemo((): Array<Node<DataPathCardData | DataPathHeadingData>> => {
      return [
        ...layout.headings.map(
          (heading: DataPathHeading): Node<DataPathHeadingData> => {
            const text: string = HEADINGS[heading.column] || "";

            return {
              id: `heading:${heading.column}`,
              type: "dataPathHeading",
              position: { x: heading.x, y: heading.y },
              data: { text: translator.translateText(text) || text },
              selectable: false,
              draggable: false,
            };
          },
        ),
        ...props.graph.nodes.map(
          (node: DataPathNode): Node<DataPathCardData> => {
            return {
              id: node.id,
              type: "dataPathCard",
              position: layout.positions.get(node.id) || { x: 0, y: 0 },
              data: {
                node: node,
                storeId: props.storeId,
                onOpenIdentity: props.onOpenIdentity,
              },
              selectable: false,
              draggable: false,
              /*
               * React Flow lets a node that is neither selectable nor
               * draggable take no pointer events, so a click would reach
               * the pane under the card, not the link or button on it.
               */
              style: { pointerEvents: "all" },
            };
          },
        ),
      ];
    }, [
      layout,
      props.graph,
      props.storeId,
      props.onOpenIdentity,
      translator.language,
    ]);

  const edges: Array<Edge> = useMemo((): Array<Edge> => {
    return props.graph.edges.map((edge: DataPathEdge): Edge => {
      const color: string = getDataPathEdgeColor(edge);
      const label: string = getEdgeLabel(edge, translator);

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "default",
        ...(label
          ? {
              label: label,
              labelStyle: { fontSize: 10, fill: "#6b7280" },
              labelBgStyle: {
                fill: "var(--ou-surface-primary, #ffffff)",
                fillOpacity: 0.9,
              },
              labelBgPadding: [4, 2] as [number, number],
              labelBgBorderRadius: 4,
            }
          : {}),
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: color,
          width: ARROWHEAD_SIZE,
          height: ARROWHEAD_SIZE,
          markerUnits: "userSpaceOnUse",
        },
        style: {
          stroke: color,
          strokeWidth: getEdgeWidth(edge),
          ...(edge.isConfirmed ? {} : { strokeDasharray: "6 4" }),
        },
      };
    });
  }, [props.graph, translator.language]);

  /*
   * A new set of cards - read again after a scan, say - is drawn afresh
   * and fitted again; React Flow fits a drawing only when it first shows it.
   */
  const drawingKey: string = props.graph.nodes
    .map((node: DataPathNode): string => {
      return node.id;
    })
    .join("|");

  return (
    <div
      role="figure"
      aria-label={translator.translateText(MAP_LABEL) || MAP_LABEL}
      className="rounded-md border border-gray-200 bg-gray-50"
      style={getDataPathCanvasStyle(layout)}
      data-testid="data-path-graph"
    >
      <ReactFlow
        key={drawingKey}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView={true}
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={0.2}
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
        {/* Top right: the "+N more" cards sit at the foot of their columns. */}
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

export default DataPathGraph;

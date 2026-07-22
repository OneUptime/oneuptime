import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Edge,
  Handle,
  Node,
  NodeProps,
  Position,
  ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SiteGridPosition,
  computeSiteGridLayout,
  gridColumnCount,
  gridRowCount,
} from "./SiteContainerLayout";
import { SiteChildView, SiteLinkView } from "./SiteHierarchyTypes";
import { SiteCardBody } from "./SiteCard";

/*
 * One drill-down level of the site hierarchy as a React Flow graph: the
 * children of the current site as fixed-size cards on a deterministic
 * grid (SiteContainerLayout), with the WAN links between them as labeled
 * edges colored by link status. Clicking a card hands the site id back to
 * the page, which decides whether that means another container level or
 * the Unit device topology.
 */

/*
 * Wide enough for a real franchise name — "Market 1401 — Chicago North",
 * "Unit 104822 — Michigan Ave" — to sit on one line inside the card's
 * padding instead of truncating to "Chicag…". The gaps are sized for what
 * goes BETWEEN the cards: a link-label chip has to fit in the horizontal
 * gap without touching either card it connects.
 */
const CARD_WIDTH: number = 264;
const CARD_HEIGHT: number = 152;
const GRID_GAP_X: number = 120;
const GRID_GAP_Y: number = 68;

/*
 * The canvas is sized to the grid it actually holds rather than to a fixed
 * slice of the viewport, so six cards no longer leave half a screen of
 * empty dot grid under them. The height is derived from what fitView will
 * actually do at the measured width (see FIT_VIEW_PADDING), then clamped
 * so one card still gets a canvas-shaped frame and a hundred-card level
 * stays pannable instead of making the page endless.
 */
const FIT_VIEW_PADDING: number = 0.15;
const CANVAS_MIN_HEIGHT: number = 260;
const CANVAS_MAX_HEIGHT: number = 620;

const DEFAULT_EDGE_COLOR: string = "#94a3b8"; // slate-400

/*
 * Link names are free text; past this many characters the chip would span
 * wider than the gap it is supposed to sit inside and start covering the
 * cards it connects. The full name stays in the edge's accessible name.
 */
const MAX_EDGE_LABEL_CHARS: number = 20;

const truncateEdgeLabel: (value: string) => string = (
  value: string,
): string => {
  if (value.length <= MAX_EDGE_LABEL_CHARS) {
    return value;
  }
  return `${value.slice(0, MAX_EDGE_LABEL_CHARS - 1).trimEnd()}…`;
};

interface SiteNodeData {
  site: SiteChildView;
  onActivate: (siteId: string) => void;
}

/*
 * Every side carries BOTH a source and a target handle so an edge can
 * always enter and leave through the sides that face each other. The
 * handles are invisible and non-interactive but MUST all exist — React
 * Flow resolves edge endpoints from <Handle> bounds, and an edge that
 * names a handle the node does not render is silently dropped (as is
 * every edge on a custom node with no handles at all).
 */
const HANDLE_SIDES: Array<{ id: string; position: Position }> = [
  { id: "top", position: Position.Top },
  { id: "right", position: Position.Right },
  { id: "bottom", position: Position.Bottom },
  { id: "left", position: Position.Left },
];

const HIDDEN_HANDLE_STYLE: React.CSSProperties = {
  opacity: 0,
  pointerEvents: "none",
};

// The React Flow skin over the shared SiteCardBody.
const SiteNodeCard: FunctionComponent<NodeProps<SiteNodeData>> = (
  props: NodeProps<SiteNodeData>,
): ReactElement => {
  const site: SiteChildView = props.data.site;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${site.name} — ${site.siteType}, open this site`}
      /*
       * transition-colors, not transition: the all-properties transition
       * includes box-shadow, which would fade the keyboard focus ring in
       * over 150ms instead of showing it the moment the card is focused.
       */
      className="h-full w-full cursor-pointer rounded-xl border border-gray-200 bg-white p-3 shadow-sm transition-colors hover:border-indigo-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.data.onActivate(site.id);
        }
      }}
    >
      {HANDLE_SIDES.map((side: { id: string; position: Position }) => {
        return (
          <Fragment key={side.id}>
            <Handle
              type="target"
              id={`t-${side.id}`}
              position={side.position}
              isConnectable={false}
              style={HIDDEN_HANDLE_STYLE}
            />
            <Handle
              type="source"
              id={`s-${side.id}`}
              position={side.position}
              isConnectable={false}
              style={HIDDEN_HANDLE_STYLE}
            />
          </Fragment>
        );
      })}
      <SiteCardBody site={site} />
    </div>
  );
};

const SITE_NODE_TYPES: Record<string, FunctionComponent<NodeProps>> = {
  siteNode: SiteNodeCard as FunctionComponent<NodeProps>,
};

const CANVAS_ZOOM_BUTTONS: Array<{
  label: string;
  title: string;
  apply: (instance: ReactFlowInstance) => void;
}> = [
  {
    label: "+",
    title: "Zoom in",
    apply: (instance: ReactFlowInstance) => {
      instance.zoomIn();
    },
  },
  {
    label: "−",
    title: "Zoom out",
    apply: (instance: ReactFlowInstance) => {
      instance.zoomOut();
    },
  },
  {
    label: "⟲",
    title: "Fit all sites in view",
    apply: (instance: ReactFlowInstance) => {
      instance.fitView({ padding: FIT_VIEW_PADDING, maxZoom: 1 });
    },
  },
];

interface HandlePair {
  sourceHandle: string;
  targetHandle: string;
}

/*
 * Connect the two sides that actually face each other: siblings in a row
 * link right-to-left, siblings in a column link bottom-to-top. Routing
 * every link out of the bottom and into the top instead made two adjacent
 * cards connect with a rectangular hook up and over the row, which reads
 * as circuitry rather than as "these two sites are linked".
 */
const handlePairForDelta: (deltaX: number, deltaY: number) => HandlePair = (
  deltaX: number,
  deltaY: number,
): HandlePair => {
  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return deltaX >= 0
      ? { sourceHandle: "s-right", targetHandle: "t-left" }
      : { sourceHandle: "s-left", targetHandle: "t-right" };
  }
  return deltaY >= 0
    ? { sourceHandle: "s-bottom", targetHandle: "t-top" }
    : { sourceHandle: "s-top", targetHandle: "t-bottom" };
};

export interface ComponentProps {
  /** Children of the current site ("sites" — `children` is React's). */
  sites: Array<SiteChildView>;
  /** Links between those children (already filtered by the server). */
  links: Array<SiteLinkView>;
  childrenTruncated: boolean;
  descendantCountsTruncated: boolean;
  onSiteClick: (siteId: string) => void;
}

const SiteContainerGraph: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const flowInstance: React.MutableRefObject<ReactFlowInstance | null> =
    useRef<ReactFlowInstance | null>(null);
  const canvasElement: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const [canvasWidth, setCanvasWidth] = useState<number>(0);

  /*
   * Read through a ref so the node array (and therefore the layout) does
   * not have to be rebuilt when the page hands down a new callback
   * identity on every render.
   */
  const onSiteClickRef: React.MutableRefObject<(siteId: string) => void> =
    useRef<(siteId: string) => void>(props.onSiteClick);
  useEffect(() => {
    onSiteClickRef.current = props.onSiteClick;
  }, [props.onSiteClick]);

  const layout: Map<string, SiteGridPosition> = useMemo(() => {
    return computeSiteGridLayout(
      props.sites.map((site: SiteChildView) => {
        return site.id;
      }),
      {
        cardWidth: CARD_WIDTH,
        cardHeight: CARD_HEIGHT,
        gapX: GRID_GAP_X,
        gapY: GRID_GAP_Y,
      },
    );
  }, [props.sites]);

  const nodes: Array<Node> = useMemo(() => {
    return props.sites
      .filter((site: SiteChildView) => {
        return layout.has(site.id);
      })
      .map((site: SiteChildView): Node => {
        const position: SiteGridPosition = layout.get(site.id)!;
        return {
          id: site.id,
          type: "siteNode",
          position: { x: position.x, y: position.y },
          data: {
            site,
            onActivate: (siteId: string) => {
              onSiteClickRef.current(siteId);
            },
          } as SiteNodeData,
          style: { width: CARD_WIDTH, height: CARD_HEIGHT },
        } as Node;
      });
  }, [props.sites, layout]);

  const edges: Array<Edge> = useMemo(() => {
    return props.links
      .filter((link: SiteLinkView) => {
        return (
          Boolean(link.fromSiteId) &&
          Boolean(link.toSiteId) &&
          layout.has(link.fromSiteId!) &&
          layout.has(link.toSiteId!)
        );
      })
      .map((link: SiteLinkView): Edge => {
        const color: string =
          (link.monitorStatus && link.monitorStatus.color) ||
          DEFAULT_EDGE_COLOR;
        const from: SiteGridPosition = layout.get(link.fromSiteId!)!;
        const to: SiteGridPosition = layout.get(link.toSiteId!)!;
        const handles: HandlePair = handlePairForDelta(
          to.x - from.x,
          to.y - from.y,
        );
        const statusName: string = link.monitorStatus
          ? link.monitorStatus.name
          : "No status";

        return {
          id: link.id,
          source: link.fromSiteId!,
          target: link.toSiteId!,
          sourceHandle: handles.sourceHandle,
          targetHandle: handles.targetHandle,
          type: "smoothstep",
          pathOptions: { borderRadius: 14 },
          label: truncateEdgeLabel(link.name),
          ariaLabel: `${link.name} — ${statusName} link`,
          /*
           * An opaque, bordered chip: the label sits in the gap between
           * two cards, and a bare label there was unreadable against the
           * dot grid (and invisible in dark, where it was hard-coded to a
           * near-black fill).
           */
          labelShowBg: true,
          labelBgPadding: [8, 4],
          labelBgBorderRadius: 6,
          labelStyle: {
            fontSize: 11,
            fontWeight: 500,
            fill: "var(--ou-text-secondary, #4b5563)",
          },
          labelBgStyle: {
            fill: "var(--ou-surface-primary, #ffffff)",
            fillOpacity: 1,
            stroke: "var(--ou-border-default, #e5e7eb)",
            strokeWidth: 1,
          },
          style: { stroke: color, strokeWidth: 2 },
        };
      });
  }, [props.links, layout]);

  const rows: number = gridRowCount(nodes.length);
  const columns: number = gridColumnCount(nodes.length);
  const contentHeight: number =
    rows * CARD_HEIGHT + Math.max(rows - 1, 0) * GRID_GAP_Y;
  const contentWidth: number =
    columns * CARD_WIDTH + Math.max(columns - 1, 0) * GRID_GAP_X;
  /*
   * fitView zooms by min(W / (cw * (1 + padding)), …) and never past 1, so
   * a grid wider than the canvas renders shorter than its raw height — ask
   * for exactly that much canvas rather than for the unscaled height.
   */
  const fitScale: number =
    canvasWidth > 0
      ? Math.min(1, canvasWidth / (contentWidth * (1 + FIT_VIEW_PADDING)))
      : 1;
  const canvasHeight: number = Math.round(
    Math.min(
      CANVAS_MAX_HEIGHT,
      Math.max(
        CANVAS_MIN_HEIGHT,
        contentHeight * fitScale * (1 + FIT_VIEW_PADDING),
      ),
    ),
  );

  /*
   * Re-fit when the visible level changes. A new controlled `nodes` array
   * wipes React Flow's measured dimensions, and fitView no-ops (returns
   * false) until nodes re-measure — retry on animation frames until it
   * lands. Also re-fits when the canvas is resized: its height is derived
   * from the measured width, so the first paint fits against a
   * provisional box that the measurement then corrects.
   */
  useEffect(() => {
    let raf: number = 0;
    let attempts: number = 16;
    /*
     * React Flow reads the canvas size from its own ResizeObserver, which
     * has not fired yet on the frame we change the height — the first
     * successful fit would centre the grid for the OLD box and clip a row.
     * A few extra fits after the first success let that measurement land.
     */
    let settleFrames: number = 3;
    const tryFit: () => void = (): void => {
      const didFit: boolean = Boolean(
        flowInstance.current &&
          nodes.length > 0 &&
          flowInstance.current.fitView({
            padding: FIT_VIEW_PADDING,
            maxZoom: 1,
          }),
      );
      if (!didFit && attempts > 0) {
        attempts--;
        raf = requestAnimationFrame(tryFit);
        return;
      }
      if (didFit && settleFrames > 0) {
        settleFrames--;
        raf = requestAnimationFrame(tryFit);
      }
    };
    tryFit();
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [nodes.length, props.sites, canvasHeight]);

  /*
   * The canvas height depends on how far fitView has to zoom out, which
   * depends on how wide the card is — so measure it. Width never depends
   * on the height we set, so observing our own box cannot loop.
   */
  const hasNodes: boolean = nodes.length > 0;
  useEffect(() => {
    const element: HTMLDivElement | null = canvasElement.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer: ResizeObserver = new ResizeObserver(
      (entries: Array<ResizeObserverEntry>) => {
        const width: number = entries[0] ? entries[0].contentRect.width : 0;
        setCanvasWidth((previous: number) => {
          return Math.abs(previous - width) < 1 ? previous : width;
        });
      },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [hasNodes]);

  if (props.sites.length === 0) {
    return (
      /* EmptyState ships 13rem of vertical padding for a full-page
       * placeholder; inside this page's card that reads as a hole. */
      <div className="-my-28">
        <EmptyState
          id="site-container-empty"
          icon={IconProp.SquareStack}
          title="No child sites here yet"
          description={
            <span className="mx-auto block max-w-md">
              Sites added under this one (and network devices assigned to them)
              will appear here as a map.
            </span>
          }
        />
      </div>
    );
  }

  return (
    <Fragment>
      {props.childrenTruncated || props.descendantCountsTruncated ? (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <Icon className="mt-px h-4 w-4 flex-shrink-0" icon={IconProp.Alert} />
          <span>
            {props.childrenTruncated
              ? "This level is very large, so only part of it is shown. Drill into a site to see the rest."
              : "This subtree is very large, so the rollup counts on these cards may be partial."}
          </span>
        </div>
      ) : (
        <></>
      )}
      <div
        ref={canvasElement}
        className="relative w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
        style={{ height: `${canvasHeight}px` }}
      >
        {/*
         * Zoom chrome mirrors the sibling NetworkDeviceGraph's corner
         * stack rather than React Flow's default bottom-left Controls:
         * the canvas is now only as tall as its content, so a floating
         * control panel down there would sit on top of the bottom row.
         */}
        <div className="absolute right-2 top-2 z-10 flex flex-col gap-1">
          {CANVAS_ZOOM_BUTTONS.map(
            (button: {
              label: string;
              title: string;
              apply: (instance: ReactFlowInstance) => void;
            }): ReactElement => {
              return (
                <button
                  key={button.title}
                  type="button"
                  title={button.title}
                  aria-label={button.title}
                  className="h-7 w-7 rounded border border-gray-300 bg-white text-sm text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  onClick={() => {
                    if (flowInstance.current) {
                      button.apply(flowInstance.current);
                    }
                  }}
                >
                  {button.label}
                </button>
              );
            },
          )}
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={SITE_NODE_TYPES}
          fitView={true}
          fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          /*
           * The card inside each node is the focusable control (it owns
           * the accessible name, the focus ring and the Enter/Space
           * handler), so the node wrapper must not be a second tab stop
           * on top of it.
           */
          nodesFocusable={false}
          elementsSelectable={true}
          onInit={(instance: ReactFlowInstance) => {
            flowInstance.current = instance;
          }}
          onNodeClick={(_event: React.MouseEvent, node: Node) => {
            props.onSiteClick(node.id);
          }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={18}
            size={1}
            color="var(--ou-chart-cursor, #d1d5db)"
          />
        </ReactFlow>
      </div>
    </Fragment>
  );
};

export default SiteContainerGraph;

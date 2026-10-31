import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
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
  EdgeProps,
  EdgeTypes,
  MarkerType,
  Node,
  ReactFlowInstance,
  ReactFlowState,
  useNodesInitialized,
  useReactFlow,
  useStore,
  useStoreApi,
} from "reactflow";
import "reactflow/dist/style.css";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  FlowExtent,
  FlowRect,
  drawingExtent,
  panDeltaToReveal,
} from "../Topology/FlowViewport";
import {
  FOCUS_REVEAL_PADDING_PX,
  isKeyboardFocus,
} from "../Topology/FlowViewportGuard";
import {
  ResourceTopologyGraph,
  ResourceTopologyNode,
  ResourceTopologyRelation,
  getTopologyNeighbours,
  getTopologyPathIds,
} from "./ResourceTopologyModel";
import {
  ResourceTopologyBranch,
  ResourceTopologyDirection,
  ResourceTopologyLayout,
  ResourceTopologyPlaced,
  ResourceTopologySide,
  getBranchPath,
  getRelatedColumnSides,
  getRelationCurve,
  getRelationSides,
  getTopologyKeyMove,
  placedNodeId,
} from "./ResourceTopologyLayout";
import {
  ResourceTopologyKeyAction,
  ResourceTopologyKeyMove,
  ResourceTopologyVisible,
  getTopologyKeyTarget,
} from "./ResourceTopologyView";
import {
  RESOURCE_TOPOLOGY_FIT_PADDING,
  getDrawingBounds,
  getTopAlignedViewport,
  getTopologyOpenFrameIds,
  holdsResourceTopologyDrawing,
} from "./ResourceTopologyFit";
import {
  RESOURCE_TOPOLOGY_NODE_TYPES,
  ResourceTopologyNodeCallbacks,
  ResourceTopologyNodeData,
  TOPOLOGY_DETAIL_CLASS,
  TOPOLOGY_ITEM_ATTRIBUTE,
  TOPOLOGY_TOGGLE_CLASS,
  tx,
} from "./ResourceTopologyNodes";
import {
  RESOURCE_TOPOLOGY_BRANCH_COLORS,
  RESOURCE_TOPOLOGY_HEALTH_COLORS,
  RESOURCE_TOPOLOGY_RELATION_COLOR,
  RESOURCE_TOPOLOGY_SELECTED_COLOR,
  ResourceTopologyBranchLine,
  ResourceTopologyBranchTone,
  ResourceTopologyDetailLevel,
  describeTopologyBranches,
  getResourceTopologyDetailLevel,
} from "./ResourceTopologyLook";

/*
 * The map itself: every card, chip and heading the layout placed, the
 * lines from each part to what it holds, and the lines for what crosses the
 * tree (a pod runs on a node, a service calls a database) - drawn for the
 * picked part, for a focused part's related column, and all the time on a
 * map that is about them (a host's calls).
 *
 * A line from a part to what it holds is grey when all is well that way,
 * amber or red when a part that needs attention or a critical one is, and
 * indigo on the way from the resource to the part someone picked.
 *
 * Every node is handed its exact size, so React Flow never holds one back
 * waiting to measure it (the blank-map race of #4117 cannot happen here).
 * The view is framed when the drawing is new - the first load, a filter, a
 * search, a focus - and when a part is opened it is the part that is
 * framed. Like the other maps in the product, the wheel scrolls the page
 * and Ctrl + scroll or a pinch zooms. Zoomed far out, a card keeps its name
 * and colour and drops its smaller lines, so the shape of a large resource
 * stays readable.
 *
 * The keyboard moves through the parts as through a tree: Tab reaches every
 * button, and from a part the arrows go down and up among the parts beside
 * it, forward into it (opening it) and back out to what holds it (closing
 * it). Keyboard focus is followed, so a part reached that way is on screen.
 */

export interface ResourceTopologyFitRequest {
  /* Bumped for every request. */
  token: number;
  /* Frame these parts; null frames the whole drawing. */
  nodeIds: Array<string> | null;
  animate: boolean;
}

export interface ComponentProps {
  graph: ResourceTopologyGraph;
  visible: ResourceTopologyVisible;
  layout: ResourceTopologyLayout;
  selectedId: string | null;
  callbacks: ResourceTopologyNodeCallbacks;
  fitRequest: ResourceTopologyFitRequest;
  height: number;
  /* Draw every relation, not only the selected part's (a host's calls). */
  alwaysShowRelations?: boolean | undefined;
}

export const RESOURCE_TOPOLOGY_PAN_MARGIN: number = 240;
/* The furthest out the map zooms. */
export const RESOURCE_TOPOLOGY_MIN_ZOOM: number = 0.05;

/* The class the canvas's own rules are scoped to. */
const CANVAS_CLASS: string = "resource-topology-map";

/*
 * Rules React Flow's nodes cannot carry inline: a card's smaller lines go
 * when the map is zoomed far out, and a part's round toggle takes the
 * map's accent under the pointer. Written here, not as utilities, so they
 * hold the moment a card appears (the Dashboard's utilities are made at run
 * time, a moment after the class first shows up).
 */
export const CANVAS_RULES: string = [
  `.${CANVAS_CLASS}[data-detail="far"] .${TOPOLOGY_DETAIL_CLASS}{display:none !important}`,
  `.${CANVAS_CLASS} .${TOPOLOGY_TOGGLE_CLASS}:hover{border-color:${RESOURCE_TOPOLOGY_SELECTED_COLOR} !important;color:${RESOURCE_TOPOLOGY_SELECTED_COLOR} !important}`,
].join("");

/*
 * A relation's line: React Flow's curve, with its label nearer the part it
 * points at than halfway (see getRelationCurve).
 */
type EdgeLook = Pick<
  EdgeProps,
  | "label"
  | "labelStyle"
  | "labelShowBg"
  | "labelBgStyle"
  | "labelBgPadding"
  | "labelBgBorderRadius"
  | "style"
>;

/* A line's words, their background and its stroke, as React Flow hands them on. */
function getEdgeLook(props: EdgeProps): EdgeLook {
  return {
    ...(props.label !== undefined ? { label: props.label } : {}),
    ...(props.labelStyle ? { labelStyle: props.labelStyle } : {}),
    ...(props.labelShowBg !== undefined
      ? { labelShowBg: props.labelShowBg }
      : {}),
    ...(props.labelBgStyle ? { labelBgStyle: props.labelBgStyle } : {}),
    ...(props.labelBgPadding ? { labelBgPadding: props.labelBgPadding } : {}),
    ...(props.labelBgBorderRadius !== undefined
      ? { labelBgBorderRadius: props.labelBgBorderRadius }
      : {}),
    ...(props.style ? { style: props.style } : {}),
  };
}

const RelationEdge: FunctionComponent<EdgeProps> = (
  props: EdgeProps,
): ReactElement => {
  const curve: { path: string; labelX: number; labelY: number } =
    getRelationCurve(
      {
        x: props.sourceX,
        y: props.sourceY,
        side: props.sourcePosition as ResourceTopologySide,
      },
      {
        x: props.targetX,
        y: props.targetY,
        side: props.targetPosition as ResourceTopologySide,
      },
    );

  return (
    <BaseEdge
      id={props.id}
      path={curve.path}
      labelX={curve.labelX}
      labelY={curve.labelY}
      interactionWidth={0}
      {...getEdgeLook(props)}
      {...(props.markerEnd ? { markerEnd: props.markerEnd } : {})}
    />
  );
};

/*
 * How far before a focused part's related column its lines meet: the
 * column's own spine, as a part's line meets its groups', with room on each
 * line's last leg for a call's rate.
 */
export const RELATED_SPINE_OFFSET: number = 60;

export interface ResourceTopologyRelatedBranchData {
  // Which end of the line is the related part; the other is the focused one.
  relatedEnd: "source" | "target";
}

/*
 * The points of a line from a focused part to one in its related column:
 * out of the focused part, along to the column's spine, down (or up) it and
 * into the related part - square, like the tree's own lines, and always
 * drawn from the focused part, so the lines to a dozen related parts share
 * one trunk and one spine (their dashes falling together) instead of
 * fanning out of one point.
 */
export function getRelatedBranchPoints(
  focus: { x: number; y: number },
  related: { x: number; y: number },
): Array<[number, number]> {
  const towards: number = related.x >= focus.x ? 1 : -1;
  const spineX: number = related.x - towards * RELATED_SPINE_OFFSET;

  return [
    [focus.x, focus.y],
    [spineX, focus.y],
    [spineX, related.y],
    [related.x, related.y],
  ];
}

export interface ResourceTopologyBranchData {
  path: string;
  tone: ResourceTopologyBranchTone;
  isOnPath: boolean;
}

/*
 * A line from a part to what it holds, along the path the layout worked
 * out (out of the part, down the spine, into the group).
 */
const BranchEdge: FunctionComponent<EdgeProps<ResourceTopologyBranchData>> = (
  props: EdgeProps<ResourceTopologyBranchData>,
): ReactElement => {
  const data: ResourceTopologyBranchData | undefined = props.data;

  return (
    <path
      data-testid={`resource-topology-branch-${props.target}`}
      data-tone={data?.isOnPath ? "path" : data?.tone || "calm"}
      d={data?.path || ""}
      fill="none"
      style={{
        stroke: data?.isOnPath
          ? RESOURCE_TOPOLOGY_SELECTED_COLOR
          : RESOURCE_TOPOLOGY_BRANCH_COLORS[data?.tone || "calm"],
        strokeWidth: data?.isOnPath ? 2.5 : data?.tone === "calm" ? 1.5 : 2,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      }}
    />
  );
};

/*
 * A line from a focused part to a part of its related column (see
 * getRelatedBranchPoints), its words - a call's rate - on its last leg.
 */
const RelatedBranchEdge: FunctionComponent<
  EdgeProps<ResourceTopologyRelatedBranchData>
> = (props: EdgeProps<ResourceTopologyRelatedBranchData>): ReactElement => {
  const relatedIsSource: boolean = props.data?.relatedEnd === "source";
  const source: { x: number; y: number } = {
    x: props.sourceX,
    y: props.sourceY,
  };
  const target: { x: number; y: number } = {
    x: props.targetX,
    y: props.targetY,
  };
  const related: { x: number; y: number } = relatedIsSource ? source : target;
  const points: Array<[number, number]> = getRelatedBranchPoints(
    relatedIsSource ? target : source,
    related,
  );
  const spineX: number = points[1]![0];

  return (
    <BaseEdge
      id={props.id}
      path={getBranchPath(points)}
      labelX={(spineX + related.x) / 2}
      labelY={related.y}
      interactionWidth={0}
      {...getEdgeLook(props)}
    />
  );
};

const RESOURCE_TOPOLOGY_EDGE_TYPES: EdgeTypes = {
  resourceTopologyRelation: RelationEdge,
  resourceTopologyBranch: BranchEdge,
  resourceTopologyRelatedBranch: RelatedBranchEdge,
};

function ignoreNodeClick(): void {
  // The buttons inside each node handle its clicks.
}

const NODE_TYPE_BY_KIND: Record<ResourceTopologyPlaced["kind"], string> = {
  card: "resourceTopologyCard",
  chip: "resourceTopologyChip",
  more: "resourceTopologyMore",
  heading: "resourceTopologyHeading",
  related: "resourceTopologyRelated",
  relatedCaption: "resourceTopologyRelatedCaption",
};

/*
 * The lines from each part to what it holds, as React Flow edges, in the
 * order describeTopologyBranches draws them: worst last, the picked part's
 * path over them all.
 */
export function buildBranchEdges(
  graph: ResourceTopologyGraph,
  branches: ReadonlyArray<ResourceTopologyBranch>,
  pathIds: ReadonlySet<string>,
): Array<Edge<ResourceTopologyBranchData>> {
  return describeTopologyBranches(graph, branches, pathIds).map(
    (line: ResourceTopologyBranchLine): Edge<ResourceTopologyBranchData> => {
      return {
        id: line.branch.id,
        source: line.branch.from,
        target: line.branch.to,
        sourceHandle: "right-source",
        targetHandle: "left-target",
        type: "resourceTopologyBranch",
        focusable: false,
        data: { path: line.path, tone: line.tone, isOnPath: line.isOnPath },
      };
    },
  );
}

/*
 * Frames what the map asks for, once React Flow has measured every node of
 * the drawing (useNodesInitialized): a fit before that frames nothing, and
 * React Flow takes a new nodes array in an effect of its own. A request is
 * kept until it lands, so a fit asked for while the next drawing is still
 * being measured happens as soon as it is.
 */
const ViewportController: FunctionComponent<{
  fitRequest: ResourceTopologyFitRequest;
  /* The ids of the drawing the map handed React Flow. */
  drawingIds: ReadonlyArray<string>;
  /* The drawing, to frame a part with what it holds. */
  layout: ResourceTopologyLayout;
  /* The level of detail the zoom asks for, reported as it changes. */
  onDetailLevel: (level: ResourceTopologyDetailLevel) => void;
}> = (props: {
  fitRequest: ResourceTopologyFitRequest;
  drawingIds: ReadonlyArray<string>;
  layout: ResourceTopologyLayout;
  onDetailLevel: (level: ResourceTopologyDetailLevel) => void;
}): ReactElement => {
  const instance: ReactFlowInstance = useReactFlow();
  const store: ReturnType<typeof useStoreApi> = useStoreApi();
  const nodesInitialized: boolean = useNodesInitialized();
  const pending: React.MutableRefObject<ResourceTopologyFitRequest | null> =
    useRef<ResourceTopologyFitRequest | null>(props.fitRequest);
  const detailLevel: ResourceTopologyDetailLevel = useStore(
    (state: ReactFlowState): ResourceTopologyDetailLevel => {
      return getResourceTopologyDetailLevel(state.transform[2]);
    },
  );

  useEffect(() => {
    props.onDetailLevel(detailLevel);
  }, [detailLevel]);

  useEffect(() => {
    pending.current = props.fitRequest;
  }, [props.fitRequest.token]);

  useEffect(() => {
    const request: ResourceTopologyFitRequest | null = pending.current;

    if (!request || !nodesInitialized) {
      return undefined;
    }

    let frame: number = 0;
    let attempts: number = 60;
    const attempt: () => void = (): void => {
      /*
       * React Flow still holds the previous drawing until its own effect
       * takes the new nodes: fitting that would frame what is gone.
       */
      const state: ReturnType<typeof store.getState> = store.getState();
      const holdsDrawing: boolean = holdsResourceTopologyDrawing(
        state.nodeInternals,
        props.drawingIds,
      );
      const canvas: { width: number; height: number } = {
        width: state.width,
        height: state.height,
      };
      const duration: number = request.animate ? 280 : 0;
      // A part is framed with what it holds, which has just appeared.
      const frameIds: Array<string> | null = request.nodeIds
        ? getTopologyOpenFrameIds(props.layout, request.nodeIds, canvas)
        : null;
      let fitted: boolean = false;

      if (holdsDrawing && frameIds && frameIds.length > 0) {
        fitted = instance.fitView({
          padding: RESOURCE_TOPOLOGY_FIT_PADDING,
          maxZoom: 1,
          duration: duration,
          nodes: frameIds.map((id: string): { id: string } => {
            return { id: id };
          }),
        });
      } else if (holdsDrawing && canvas.width > 0 && canvas.height > 0) {
        // The whole drawing, from the top: a tree reads from the resource down.
        instance.setViewport(
          getTopAlignedViewport(getDrawingBounds(props.layout.placed), canvas, {
            maxZoom: 1,
            minZoom: RESOURCE_TOPOLOGY_MIN_ZOOM,
          }),
          { duration: duration },
        );
        fitted = true;
      }

      if (fitted) {
        if (pending.current === request) {
          pending.current = null;
        }
        return;
      }

      if (attempts > 0) {
        attempts--;
        frame = requestAnimationFrame(attempt);
      }
    };

    frame = requestAnimationFrame(attempt);

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [props.fitRequest.token, nodesInitialized, props.drawingIds]);

  /*
   * Keyboard focus is followed: a card reached with Tab or an arrow is
   * panned into view, and a scroll the browser makes to show it is undone
   * first (it would slide the whole canvas, controls included, out of its
   * box).
   */
  useEffect(() => {
    const domNode: HTMLDivElement | null = store.getState().domNode;

    if (!domNode) {
      return undefined;
    }

    const followFocus: (event: FocusEvent) => void = (
      event: FocusEvent,
    ): void => {
      const target: EventTarget | null = event.target;

      if (!(target instanceof Element) || !isKeyboardFocus(target)) {
        return;
      }

      domNode.scrollLeft = 0;
      domNode.scrollTop = 0;

      const pane: HTMLElement | null = domNode.querySelector<HTMLElement>(
        ".react-flow__renderer",
      );

      if (!pane || !pane.contains(target)) {
        return;
      }

      const view: DOMRect = pane.getBoundingClientRect();
      const box: DOMRect = target.getBoundingClientRect();
      const x: number = panDeltaToReveal(
        box.left,
        box.right,
        view.left,
        view.right,
        FOCUS_REVEAL_PADDING_PX,
      );
      const y: number = panDeltaToReveal(
        box.top,
        box.bottom,
        view.top,
        view.bottom,
        FOCUS_REVEAL_PADDING_PX,
      );

      if (x || y) {
        store.getState().panBy({ x: x, y: y });
      }
    };

    domNode.addEventListener("focusin", followFocus);

    return () => {
      domNode.removeEventListener("focusin", followFocus);
    };
  }, [store]);

  return <></>;
};

/*
 * Zoom in, zoom out and fit, at the corner where a line of text starts: the
 * bottom left, or the bottom right on a page read from right to left. Fit
 * frames the drawing the way the map does, from the top.
 */
const MapControls: FunctionComponent<{
  layout: ResourceTopologyLayout;
  direction: ResourceTopologyDirection;
}> = (props: {
  layout: ResourceTopologyLayout;
  direction: ResourceTopologyDirection;
}): ReactElement => {
  const instance: ReactFlowInstance = useReactFlow();
  const store: ReturnType<typeof useStoreApi> = useStoreApi();

  return (
    <Controls
      showInteractive={false}
      position={props.direction === "rtl" ? "bottom-right" : "bottom-left"}
      onFitView={() => {
        const state: ReturnType<typeof store.getState> = store.getState();

        if (state.width > 0 && state.height > 0) {
          instance.setViewport(
            getTopAlignedViewport(
              getDrawingBounds(props.layout.placed),
              { width: state.width, height: state.height },
              { maxZoom: 1, minZoom: RESOURCE_TOPOLOGY_MIN_ZOOM },
            ),
          );
        }
      }}
    />
  );
};

const ResourceTopologyCanvas: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const wrapperRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const callbacksRef: React.MutableRefObject<ResourceTopologyNodeCallbacks> =
    useRef<ResourceTopologyNodeCallbacks>(props.callbacks);
  callbacksRef.current = props.callbacks;
  const direction: ResourceTopologyDirection = props.layout.direction;

  /*
   * One stable set of callbacks for every node, reading the latest ones:
   * a new function per render would hand React Flow a new nodes array on
   * every keystroke in the search box.
   */
  const callbacks: ResourceTopologyNodeCallbacks =
    useMemo((): ResourceTopologyNodeCallbacks => {
      return {
        onSelect: (nodeId: string): void => {
          callbacksRef.current.onSelect(nodeId);
        },
        onToggleOpen: (nodeId: string, open: boolean): void => {
          callbacksRef.current.onToggleOpen(nodeId, open);
        },
        onToggleGroup: (groupKey: string): void => {
          callbacksRef.current.onToggleGroup(groupKey);
        },
      };
    }, []);

  const pathIds: Set<string> = useMemo((): Set<string> => {
    return getTopologyPathIds(props.graph, props.selectedId);
  }, [props.graph, props.selectedId]);

  const nodes: Array<Node<ResourceTopologyNodeData>> = useMemo((): Array<
    Node<ResourceTopologyNodeData>
  > => {
    return props.layout.placed.map(
      (placed: ResourceTopologyPlaced): Node<ResourceTopologyNodeData> => {
        const nodeId: string | null = placedNodeId(placed);
        const node: ResourceTopologyNode | null = nodeId
          ? props.graph.nodes.get(nodeId) || null
          : null;
        const isPart: boolean =
          placed.kind === "card" ||
          placed.kind === "chip" ||
          placed.kind === "related";

        return {
          id: placed.id,
          type: NODE_TYPE_BY_KIND[placed.kind],
          position: { x: placed.x, y: placed.y },
          width: placed.width,
          height: placed.height,
          style: { width: placed.width, height: placed.height },
          // Lines run under the cards; a card's toggle sits over its own line.
          zIndex: 1000,
          draggable: false,
          connectable: false,
          selectable: false,
          focusable: false,
          data: {
            placed: placed,
            node: node,
            isSelected:
              isPart && nodeId !== null && nodeId === props.selectedId,
            isOnPath:
              isPart &&
              nodeId !== null &&
              nodeId !== props.selectedId &&
              pathIds.has(nodeId),
            direction: direction,
            callbacks: callbacks,
          },
        };
      },
    );
  }, [
    props.layout,
    props.graph,
    props.selectedId,
    pathIds,
    direction,
    callbacks,
  ]);

  /*
   * Lines for what crosses the tree: from a focused part to each related
   * part beside it, from the selected part to every related part on the
   * map, and — on a map that is about them (a host's calls) — every
   * relation all the time, coloured by how it is doing.
   */
  const relationEdges: Array<Edge> = useMemo((): Array<Edge> => {
    const result: Array<Edge> = [];
    const seen: Set<string> = new Set<string>();
    const selected: Set<string> = new Set<string>();

    if (props.selectedId) {
      selected.add(props.selectedId);
    }

    if (props.visible.focusId) {
      selected.add(props.visible.focusId);
    }

    const add: (
      from: string,
      to: string,
      label: string,
      relation?: ResourceTopologyRelation | undefined,
      showLabel?: boolean | undefined,
      forcedSides?:
        | { source: ResourceTopologySide; target: ResourceTopologySide }
        | undefined,
      relatedEnd?: "source" | "target" | undefined,
    ) => void = (
      from: string,
      to: string,
      label: string,
      relation?: ResourceTopologyRelation | undefined,
      showLabel: boolean = true,
      forcedSides?:
        | { source: ResourceTopologySide; target: ResourceTopologySide }
        | undefined,
      relatedEnd?: "source" | "target" | undefined,
    ): void => {
      const id: string = `relation:${from}->${to}`;

      if (
        seen.has(id) ||
        !props.layout.byId.has(from) ||
        !props.layout.byId.has(to)
      ) {
        return;
      }

      seen.add(id);

      const emphasised: boolean = selected.has(from) || selected.has(to);
      const color: string =
        relation?.health === "critical"
          ? RESOURCE_TOPOLOGY_HEALTH_COLORS.critical
          : relation?.health === "warning"
            ? RESOURCE_TOPOLOGY_HEALTH_COLORS.warning
            : emphasised || !props.alwaysShowRelations
              ? RESOURCE_TOPOLOGY_RELATION_COLOR
              : "var(--ou-text-subtle, #94a3b8)";
      const text: string =
        (props.alwaysShowRelations && !emphasised) || !showLabel
          ? relation?.detail || ""
          : [tx(label, translator), relation?.detail || ""]
              .filter((part: string): boolean => {
                return part.length > 0;
              })
              .join(" · ");

      const sides: {
        source: ResourceTopologySide;
        target: ResourceTopologySide;
      } =
        forcedSides ||
        getRelationSides(
          props.layout.byId.get(from)!,
          props.layout.byId.get(to)!,
        );

      result.push({
        id: id,
        source: from,
        target: to,
        sourceHandle: `${sides.source}-source`,
        targetHandle: `${sides.target}-target`,
        /*
         * A related column's lines share one spine, as the tree's do: the
         * column's heading says which way they point, so they carry no
         * arrows of their own.
         */
        type: relatedEnd
          ? "resourceTopologyRelatedBranch"
          : "resourceTopologyRelation",
        ...(relatedEnd ? { data: { relatedEnd: relatedEnd } } : {}),
        ...(text
          ? {
              label: text,
              labelShowBg: true,
              labelStyle: {
                fontSize: 11,
                fontWeight: 600,
                fill: "var(--ou-text-secondary, #4b5563)",
              },
              labelBgStyle: {
                fill: "var(--ou-surface-primary, #ffffff)",
                fillOpacity: 1,
                stroke: "var(--ou-border-default, #e5e7eb)",
                strokeWidth: 1,
              },
              labelBgPadding: [6, 3] as [number, number],
              labelBgBorderRadius: 6,
            }
          : {}),
        ...(relatedEnd
          ? {}
          : { markerEnd: { type: MarkerType.ArrowClosed, color: color } }),
        style: {
          stroke: color,
          strokeWidth: emphasised && !relatedEnd ? 2.25 : 1.5,
          strokeDasharray:
            props.alwaysShowRelations && !emphasised ? undefined : "6 4",
        },
        zIndex: 2000,
      });
    };

    const relationBetween: (
      from: string,
      to: string,
    ) => ResourceTopologyRelation | undefined = (
      from: string,
      to: string,
    ): ResourceTopologyRelation | undefined => {
      return (props.graph.relationsByNode.get(from) || []).find(
        (relation: ResourceTopologyRelation): boolean => {
          return relation.from === from && relation.to === to;
        },
      );
    };

    /*
     * The column's heading says what these lines are: no words on each.
     * They leave the focused part's side that faces the column, share one
     * spine before it and enter each related part's near side, so no line
     * runs down the column across the parts in it.
     */
    if (props.visible.focusId) {
      for (const related of props.visible.related) {
        const outward: boolean = related.direction === "out";
        const [from, to] = outward
          ? [props.visible.focusId, related.nodeId]
          : [related.nodeId, props.visible.focusId];
        add(
          from,
          to,
          related.label,
          relationBetween(from, to),
          false,
          getRelatedColumnSides(outward, direction),
          outward ? "target" : "source",
        );
      }
    }

    if (props.selectedId) {
      for (const neighbour of getTopologyNeighbours(
        props.graph,
        props.selectedId,
      )) {
        const [from, to] =
          neighbour.direction === "out"
            ? [props.selectedId, neighbour.nodeId]
            : [neighbour.nodeId, props.selectedId];
        add(from, to, neighbour.label, relationBetween(from, to));
      }
    }

    if (props.alwaysShowRelations) {
      for (const relation of props.graph.relations) {
        add(relation.from, relation.to, relation.label, relation);
      }
    }

    return result;
  }, [
    props.layout,
    props.graph,
    props.visible,
    props.selectedId,
    props.alwaysShowRelations,
    translator.language,
  ]);

  const edges: Array<Edge> = useMemo((): Array<Edge> => {
    return [
      ...buildBranchEdges(props.graph, props.layout.branches, pathIds),
      ...relationEdges,
    ];
  }, [props.graph, props.layout, pathIds, relationEdges]);

  const drawingIds: ReadonlyArray<string> = useMemo((): Array<string> => {
    return nodes.map((node: Node<ResourceTopologyNodeData>): string => {
      return node.id;
    });
  }, [nodes]);

  const extent: FlowExtent = useMemo((): FlowExtent => {
    const rects: Array<FlowRect> = props.layout.placed.map(
      (placed: ResourceTopologyPlaced): FlowRect => {
        return {
          x: placed.x,
          y: placed.y,
          width: placed.width,
          height: placed.height,
        };
      },
    );

    return drawingExtent(rects, RESOURCE_TOPOLOGY_PAN_MARGIN);
  }, [props.layout]);

  /*
   * The level of detail lives on the wrapper, as one attribute: the nodes
   * are the same objects either way, so React Flow draws none of them again.
   */
  const [detailLevel, setDetailLevel] =
    useState<ResourceTopologyDetailLevel>("near");
  const keysHintId: string = useId();

  const visibleRef: React.MutableRefObject<ResourceTopologyVisible> =
    useRef<ResourceTopologyVisible>(props.visible);
  visibleRef.current = props.visible;

  /*
   * The arrows, Home and End on a part move through the tree; anything
   * else is left alone (Tab, Enter and Space do what they do on a button).
   */
  const onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }

    const target: EventTarget | null = event.target;
    const itemId: string | null =
      target instanceof Element
        ? target.getAttribute(TOPOLOGY_ITEM_ATTRIBUTE)
        : null;
    const move: ResourceTopologyKeyMove | null = getTopologyKeyMove(
      event.key,
      direction,
    );

    if (!itemId || !move) {
      return;
    }

    const buttonFor: (id: string) => HTMLElement | null = (
      id: string,
    ): HTMLElement | null => {
      const found: Element | null | undefined =
        wrapperRef.current?.querySelector(
          `[${TOPOLOGY_ITEM_ATTRIBUTE}="${CSS.escape(id)}"]`,
        );

      return found instanceof HTMLElement ? found : null;
    };
    // A lane's heading has no button: the key goes on past it.
    const action: ResourceTopologyKeyAction | null = getTopologyKeyTarget(
      visibleRef.current,
      itemId,
      move,
      (id: string): boolean => {
        return buttonFor(id) !== null;
      },
    );

    // A key that goes nowhere still does not scroll the page.
    event.preventDefault();

    if (!action) {
      return;
    }

    if (action.type === "open" || action.type === "close") {
      callbacksRef.current.onToggleOpen(action.nodeId, action.type === "open");
      return;
    }

    buttonFor(action.itemId)?.focus();
  };

  return (
    <div
      ref={wrapperRef}
      data-testid="resource-topology-canvas"
      data-detail={detailLevel}
      data-direction={direction}
      role="group"
      aria-label={tx("Topology map", translator)}
      aria-describedby={keysHintId}
      style={{ height: props.height, width: "100%" }}
      className={`${CANVAS_CLASS} relative bg-slate-50 [&_.react-flow__node]:transition-transform [&_.react-flow__node]:duration-200 motion-reduce:[&_.react-flow__node]:transition-none`}
      onKeyDown={onKeyDown}
    >
      <style>{CANVAS_RULES}</style>
      {/*
       * What the keys do, for a screen reader: the arrows that open a part
       * and go back out are the other way round on a page read from right
       * to left.
       */}
      <p id={keysHintId} className="sr-only">
        {direction === "rtl"
          ? tx(
              "On a part, the Up and Down arrows move between the parts beside it, the Left arrow opens it and goes in, and the Right arrow closes it and goes back out.",
              translator,
            )
          : tx(
              "On a part, the Up and Down arrows move between the parts beside it, the Right arrow opens it and goes in, and the Left arrow closes it and goes back out.",
              translator,
            )}
      </p>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={RESOURCE_TOPOLOGY_NODE_TYPES}
        edgeTypes={RESOURCE_TOPOLOGY_EDGE_TYPES}
        minZoom={RESOURCE_TOPOLOGY_MIN_ZOOM}
        maxZoom={1.75}
        translateExtent={extent}
        /*
         * A map inside a page, like the Service Map: the wheel scrolls the
         * page, Ctrl + scroll or a pinch zooms, a double-click does not.
         */
        zoomOnScroll={false}
        preventScrolling={false}
        zoomOnDoubleClick={false}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        proOptions={{ hideAttribution: true }}
        /*
         * The nodes' own buttons do the work. React Flow only lets pointer
         * events reach a node that is selectable, draggable or clickable,
         * so it gets a click handler that leaves the click to them.
         */
        onNodeClick={ignoreNodeClick}
      >
        <MapControls layout={props.layout} direction={direction} />
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1}
          color="var(--ou-chart-grid, #cbd5e1)"
        />
        <ViewportController
          fitRequest={props.fitRequest}
          drawingIds={drawingIds}
          layout={props.layout}
          onDetailLevel={setDetailLevel}
        />
      </ReactFlow>
    </div>
  );
};

export default ResourceTopologyCanvas;

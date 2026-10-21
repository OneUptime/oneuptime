import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
} from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  MarkerType,
  Node,
  ReactFlowInstance,
  useReactFlow,
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
  ResourceTopologyNeighbour,
  getTopologyNeighbours,
} from "./ResourceTopologyModel";
import {
  ResourceTopologyLayout,
  ResourceTopologyPlaced,
} from "./ResourceTopologyLayout";
import { ResourceTopologyVisible } from "./ResourceTopologyView";
import {
  RESOURCE_TOPOLOGY_NODE_TYPES,
  ResourceTopologyNodeCallbacks,
  ResourceTopologyNodeData,
  tx,
} from "./ResourceTopologyNodes";
import { RESOURCE_TOPOLOGY_RELATION_COLOR } from "./ResourceTopologyLook";

/*
 * The map itself: every box, card and chip the layout placed, and lines for
 * what crosses the tree (a pod runs on a node, a service calls a database) —
 * drawn for the selected part, and for a focused part's related column.
 *
 * Every node is handed its exact size, so React Flow never holds one back
 * waiting to measure it (the blank-map race of #4117 cannot happen here).
 * The view is framed when the drawing is new — the first load, a filter, a
 * search, a focus — and when a part is opened it is the part that is
 * framed, so opening a host deep in a large vCenter brings its virtual
 * machines into view instead of zooming the whole vCenter out. Like the
 * other maps in the product, the wheel scrolls the page and Ctrl + scroll or
 * a pinch zooms, and keyboard focus is followed so a card reached with Tab
 * is always on screen.
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
}

export const RESOURCE_TOPOLOGY_FIT_PADDING: number = 0.08;
export const RESOURCE_TOPOLOGY_PAN_MARGIN: number = 240;

const NODE_TYPE_BY_KIND: Record<ResourceTopologyPlaced["kind"], string> = {
  container: "resourceTopologyContainer",
  card: "resourceTopologyCard",
  chip: "resourceTopologyChip",
  more: "resourceTopologyMore",
  related: "resourceTopologyRelated",
};

/*
 * Frames what the map asks for, once React Flow holds it. React Flow takes
 * a new nodes array in an effect of its own, so the first frame may still
 * hold the previous drawing: the fit is tried each frame until it lands.
 */
const ViewportController: FunctionComponent<{
  fitRequest: ResourceTopologyFitRequest;
}> = (props: { fitRequest: ResourceTopologyFitRequest }): ReactElement => {
  const instance: ReactFlowInstance = useReactFlow();
  const store: ReturnType<typeof useStoreApi> = useStoreApi();

  useEffect(() => {
    let frame: number = 0;
    let attempts: number = 30;
    const request: ResourceTopologyFitRequest = props.fitRequest;
    const attempt: () => void = (): void => {
      const known: boolean =
        !request.nodeIds ||
        request.nodeIds.every((id: string): boolean => {
          return store.getState().nodeInternals.has(id);
        });
      const fitted: boolean =
        known &&
        instance.fitView({
          padding: RESOURCE_TOPOLOGY_FIT_PADDING,
          maxZoom: 1,
          duration: request.animate ? 280 : 0,
          ...(request.nodeIds
            ? {
                nodes: request.nodeIds.map((id: string): { id: string } => {
                  return { id: id };
                }),
              }
            : {}),
        });

      if (!fitted && attempts > 0) {
        attempts--;
        frame = requestAnimationFrame(attempt);
      }
    };

    frame = requestAnimationFrame(attempt);

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [props.fitRequest.token]);

  /*
   * Keyboard focus is followed: a card reached with Tab is panned into
   * view, and a scroll the browser makes to show it is undone first (it
   * would slide the whole canvas, controls included, out of its box).
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

const ResourceTopologyCanvas: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const callbacksRef: React.MutableRefObject<ResourceTopologyNodeCallbacks> =
    useRef<ResourceTopologyNodeCallbacks>(props.callbacks);
  callbacksRef.current = props.callbacks;

  /*
   * One stable set of callbacks for every node, reading the latest ones:
   * a new function per render would hand React Flow a new nodes array on
   * every keystroke in the search box.
   */
  const callbacks: ResourceTopologyNodeCallbacks = useMemo(
    (): ResourceTopologyNodeCallbacks => {
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
    },
    [],
  );

  const nodes: Array<Node<ResourceTopologyNodeData>> = useMemo((): Array<
    Node<ResourceTopologyNodeData>
  > => {
    return props.layout.placed.map(
      (placed: ResourceTopologyPlaced): Node<ResourceTopologyNodeData> => {
        const nodeId: string | null =
          placed.card?.nodeId ||
          placed.chip?.nodeId ||
          placed.related?.nodeId ||
          null;

        return {
          id: placed.id,
          type: NODE_TYPE_BY_KIND[placed.kind],
          position: { x: placed.x, y: placed.y },
          width: placed.width,
          height: placed.height,
          style: { width: placed.width, height: placed.height },
          // Boxes under what they hold; cards and chips above every box.
          zIndex: placed.kind === "container" ? placed.depth : 1000,
          draggable: false,
          connectable: false,
          selectable: false,
          focusable: false,
          data: {
            placed: placed,
            node: nodeId ? props.graph.nodes.get(nodeId) || null : null,
            isSelected: nodeId !== null && nodeId === props.selectedId,
            callbacks: callbacks,
          },
        };
      },
    );
  }, [props.layout, props.graph, props.selectedId, callbacks]);

  /*
   * Lines for what crosses the tree: from a focused part to each related
   * part beside it, and from the selected part to every related part that
   * is on the map.
   */
  const edges: Array<Edge> = useMemo((): Array<Edge> => {
    const result: Array<Edge> = [];
    const seen: Set<string> = new Set<string>();
    const add: (from: string, to: string, label: string) => void = (
      from: string,
      to: string,
      label: string,
    ): void => {
      const id: string = `relation:${from}->${to}`;

      if (seen.has(id) || !props.layout.byId.has(from)) {
        return;
      }

      if (!props.layout.byId.has(to)) {
        return;
      }

      seen.add(id);
      result.push({
        id: id,
        source: from,
        target: to,
        type: "default",
        label: tx(label, translator),
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
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 6,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: RESOURCE_TOPOLOGY_RELATION_COLOR,
        },
        style: {
          stroke: RESOURCE_TOPOLOGY_RELATION_COLOR,
          strokeWidth: 1.75,
          strokeDasharray: "6 4",
        },
        zIndex: 2000,
      });
    };

    if (props.visible.focusId) {
      for (const related of props.visible.related) {
        if (related.direction === "out") {
          add(props.visible.focusId, related.nodeId, related.label);
        } else {
          add(related.nodeId, props.visible.focusId, related.label);
        }
      }
    }

    if (props.selectedId) {
      for (const neighbour of getTopologyNeighbours(
        props.graph,
        props.selectedId,
      )) {
        const relation: ResourceTopologyNeighbour = neighbour;

        if (relation.direction === "out") {
          add(props.selectedId, relation.nodeId, relation.label);
        } else {
          add(relation.nodeId, props.selectedId, relation.label);
        }
      }
    }

    return result;
  }, [
    props.layout,
    props.graph,
    props.visible,
    props.selectedId,
    translator.language,
  ]);

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

  return (
    <div
      data-testid="resource-topology-canvas"
      style={{ height: props.height, width: "100%" }}
      className="relative bg-slate-50 [&_.react-flow__node]:transition-transform [&_.react-flow__node]:duration-200 motion-reduce:[&_.react-flow__node]:transition-none"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={RESOURCE_TOPOLOGY_NODE_TYPES}
        minZoom={0.05}
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
      >
        <Controls showInteractive={false} />
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1}
          color="var(--ou-chart-grid, #cbd5e1)"
        />
        <ViewportController fitRequest={props.fitRequest} />
      </ReactFlow>
    </div>
  );
};

export default ResourceTopologyCanvas;

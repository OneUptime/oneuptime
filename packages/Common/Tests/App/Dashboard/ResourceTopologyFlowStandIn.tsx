import React, { ReactElement } from "react";
import type {
  CoordinateExtent,
  Edge,
  EdgeProps,
  Node,
  NodeProps,
  ReactFlowProps,
} from "reactflow";

/*
 * React Flow, as ResourceTopologyKeyboardFocus.test.tsx draws a resource's
 * topology map in jsdom: it mocks reactflow with this
 * (jest.mock("reactflow", () =>
 * jest.requireActual("./ResourceTopologyFlowStandIn"))).
 *
 * React Flow measures nothing in jsdom: the stand-in draws each part with
 * the node component the map registered for it and each line with its own,
 * and keeps the props of the latest drawing (flowProps). Its element is
 * laid out as React Flow's is - `.react-flow` around `.react-flow__renderer`,
 * which holds the parts and the lines, with the zoom buttons beside it
 * (Controls: zoom in, zoom out, and Fit, which runs the map's onFitView) -
 * and its store, as the keyboard's focus and the map read it (useStore,
 * useStoreApi), holds that element, the view, the canvas's size and React
 * Flow's panBy.
 *
 * As React Flow's does, panBy keeps the view inside the pan extent the map
 * hands it (translateExtent), with d3-zoom's own constraint, and says
 * whether the view moved; each pan asked for is written down (pansMade).
 * setViewport moves the view where it is told, unconstrained, as React
 * Flow's does, and is written down too (viewportsSet). The view starts where
 * a suite puts it (startViewAt), else at zoom 1 with the drawing's origin at
 * the canvas's top left: as if the reader had zoomed in to read. No part is
 * measured (useNodesInitialized is false), so the map never frames its
 * drawing on its own here. jsdom lays nothing out, so where anything is on
 * screen is the suite's to say, from the view shown and the canvas's size
 * (canvasSize).
 */

export interface StandInViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface StandInPan {
  x: number;
  y: number;
}

export interface StandInCanvas {
  width: number;
  height: number;
}

// React Flow's store, as much of it as the map and the keyboard's focus read.
export interface StandInFlowState {
  domNode: HTMLDivElement | null;
  transform: [number, number, number];
  width: number;
  height: number;
  nodeInternals: Map<string, Node>;
  panBy: (delta: StandInPan) => boolean;
}

const ORIGIN: StandInViewport = { x: 0, y: 0, zoom: 1 };
// A phone's canvas: 390 pixels less the page's gutters, the map's phone height.
const PHONE_CANVAS: StandInCanvas = { width: 358, height: 520 };

let latestProps: ReactFlowProps | null = null;
let shownViewport: StandInViewport = { ...ORIGIN };
let canvas: StandInCanvas = { ...PHONE_CANVAS };
const pans: Array<StandInPan> = [];
const viewportsSet: Array<StandInViewport> = [];
let flowElement: HTMLDivElement | null = null;
const storeListeners: Set<() => void> = new Set();

export function flowProps(): ReactFlowProps | null {
  return latestProps;
}

export function currentViewport(): StandInViewport {
  return shownViewport;
}

// The pans asked of React Flow's store, in screen pixels, in order.
export function pansMade(): Array<StandInPan> {
  return pans;
}

export function setViewportCalls(): Array<StandInViewport> {
  return viewportsSet;
}

// React Flow's element, `.react-flow`, while the map is on the page.
export function flowDomNode(): HTMLDivElement | null {
  return flowElement;
}

export function canvasSize(): StandInCanvas {
  return canvas;
}

export function setCanvasSize(size: StandInCanvas): void {
  canvas = { ...size };
}

// Where the view is when the map is drawn: call before it renders.
export function startViewAt(viewport: StandInViewport): void {
  shownViewport = { ...viewport };
}

export function resetFlowStandIn(): void {
  latestProps = null;
  shownViewport = { ...ORIGIN };
  canvas = { ...PHONE_CANVAS };
  pans.length = 0;
  viewportsSet.length = 0;
}

function notifyStore(): void {
  for (const listener of Array.from(storeListeners)) {
    listener();
  }
}

function subscribeStore(listener: () => void): () => void {
  storeListeners.add(listener);

  return (): void => {
    storeListeners.delete(listener);
  };
}

/*
 * d3-zoom's own constraint (its defaultConstrain), which React Flow's panBy
 * and a drag run: the view moves the least that keeps the canvas inside the
 * extent, or centres a drawing whose extent is smaller than the canvas.
 */
export function constrainToExtent(
  view: StandInViewport,
  size: StandInCanvas,
  extent: CoordinateExtent | undefined,
): StandInViewport {
  if (!extent) {
    return view;
  }

  const zoom: number = view.zoom;
  const dx0: number = -view.x / zoom - extent[0][0];
  const dx1: number = (size.width - view.x) / zoom - extent[1][0];
  const dy0: number = -view.y / zoom - extent[0][1];
  const dy1: number = (size.height - view.y) / zoom - extent[1][1];
  const dx: number =
    dx1 > dx0 ? (dx0 + dx1) / 2 : Math.min(0, dx0) || Math.max(0, dx1);
  const dy: number =
    dy1 > dy0 ? (dy0 + dy1) / 2 : Math.min(0, dy0) || Math.max(0, dy1);

  return { x: view.x + zoom * dx, y: view.y + zoom * dy, zoom };
}

// React Flow's store.panBy: moves the view by a delta, inside the extent.
function panViewBy(delta: StandInPan): boolean {
  if (!delta.x && !delta.y) {
    return false;
  }

  pans.push({ x: delta.x, y: delta.y });

  const next: StandInViewport = constrainToExtent(
    {
      x: shownViewport.x + delta.x,
      y: shownViewport.y + delta.y,
      zoom: shownViewport.zoom,
    },
    canvas,
    latestProps?.translateExtent,
  );
  const moved: boolean =
    next.x !== shownViewport.x || next.y !== shownViewport.y;

  shownViewport = next;

  if (moved) {
    notifyStore();
  }

  return moved;
}

// The reader drags the view: d3-zoom keeps a drag inside the extent too.
export function moveView(viewport: StandInViewport): void {
  shownViewport = constrainToExtent(
    viewport,
    canvas,
    latestProps?.translateExtent,
  );
  notifyStore();
}

function storeState(): StandInFlowState {
  return {
    domNode: flowElement,
    transform: [shownViewport.x, shownViewport.y, shownViewport.zoom],
    width: canvas.width,
    height: canvas.height,
    nodeInternals: new Map<string, Node>(
      (latestProps?.nodes || []).map((node: Node): [string, Node] => {
        return [node.id, node];
      }),
    ),
    panBy: panViewBy,
  };
}

const STORE_API: { getState: () => StandInFlowState } = {
  getState: storeState,
};

// React Flow's element mounting, or going: the store holds it, as React Flow's does.
function noteFlowElement(element: HTMLDivElement | null): void {
  if (flowElement !== element) {
    flowElement = element;
    notifyStore();
  }
}

export function useStore(
  selector: (state: StandInFlowState) => unknown,
): unknown {
  return React.useSyncExternalStore(subscribeStore, (): unknown => {
    return selector(storeState());
  });
}

export function useStoreApi(): { getState: () => StandInFlowState } {
  return STORE_API;
}

// No part is measured: the map does not frame its drawing on its own here.
export function useNodesInitialized(): boolean {
  return false;
}

export function useReactFlow(): {
  fitView: () => boolean;
  setViewport: (viewport: StandInViewport) => void;
  getViewport: () => StandInViewport;
} {
  return {
    fitView: (): boolean => {
      return false;
    },
    setViewport: (viewport: StandInViewport): void => {
      viewportsSet.push({ ...viewport });
      shownViewport = { ...viewport };
      notifyStore();
    },
    getViewport: (): StandInViewport => {
      return shownViewport;
    },
  };
}

type PartComponent = React.ComponentType<
  Pick<NodeProps, "id" | "data" | "type" | "xPos" | "yPos">
>;
type LineComponent = React.ComponentType<
  Pick<
    EdgeProps,
    | "id"
    | "source"
    | "target"
    | "data"
    | "sourceX"
    | "sourceY"
    | "targetX"
    | "targetY"
    | "sourcePosition"
    | "targetPosition"
  >
>;

const StandInFlow: (props: ReactFlowProps) => ReactElement = (
  props: ReactFlowProps,
): ReactElement => {
  /*
   * React in development calls a component with no props at all to find
   * where it is defined, for the component stack of a warning: that is
   * not a drawing.
   */
  if (props) {
    latestProps = props;
  }

  return (
    <div
      data-testid="mock-react-flow"
      className="react-flow"
      ref={noteFlowElement}
    >
      <div className="react-flow__renderer">
        <svg>
          {(props.edges || []).map((edge: Edge) => {
            const Line: LineComponent | undefined = props.edgeTypes?.[
              edge.type || ""
            ] as LineComponent | undefined;

            return Line ? (
              <Line
                key={edge.id}
                id={edge.id}
                source={edge.source}
                target={edge.target}
                data={edge.data}
                sourceX={0}
                sourceY={0}
                targetX={100}
                targetY={0}
                sourcePosition={"right" as EdgeProps["sourcePosition"]}
                targetPosition={"left" as EdgeProps["targetPosition"]}
              />
            ) : null;
          })}
        </svg>
        {(props.nodes || []).map((node: Node) => {
          const Part: PartComponent | undefined = props.nodeTypes?.[
            node.type || ""
          ] as PartComponent | undefined;

          return (
            <div
              key={node.id}
              className="react-flow__node"
              data-flow-node-id={node.id}
            >
              {Part ? (
                <Part
                  id={node.id}
                  data={node.data}
                  type={node.type || ""}
                  xPos={node.position.x}
                  yPos={node.position.y}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      {props.children}
    </div>
  );
};

export default StandInFlow;

export const Background: () => null = (): null => {
  return null;
};

// React Flow's zoom buttons: a panel beside the renderer, never inside it.
export const Controls: (props: {
  onFitView?: () => void;
  position?: string;
}) => ReactElement = (props: {
  onFitView?: () => void;
  position?: string;
}): ReactElement => {
  return (
    <div
      className="react-flow__panel react-flow__controls"
      data-testid="flow-controls"
      data-position={props.position}
    >
      <button
        type="button"
        className="react-flow__controls-button react-flow__controls-zoomin"
        aria-label="zoom in"
        data-testid="flow-zoom-in"
      />
      <button
        type="button"
        className="react-flow__controls-button react-flow__controls-zoomout"
        aria-label="zoom out"
        data-testid="flow-zoom-out"
      />
      <button
        type="button"
        className="react-flow__controls-button react-flow__controls-fitview"
        aria-label="fit view"
        data-testid="flow-fit-view"
        onClick={(): void => {
          props.onFitView?.();
        }}
      />
    </div>
  );
};

export const Handle: () => null = (): null => {
  return null;
};

export const BaseEdge: () => null = (): null => {
  return null;
};

export const Position: Record<string, string> = {
  Top: "top",
  Bottom: "bottom",
  Left: "left",
  Right: "right",
};

export const BackgroundVariant: Record<string, string> = { Dots: "dots" };

export const MarkerType: Record<string, string> = {
  ArrowClosed: "arrowclosed",
};

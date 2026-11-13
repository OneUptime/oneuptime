import React, { ReactElement } from "react";
import type { ReactFlowProps } from "reactflow";

/*
 * React Flow, as the suites that grow a lineage diagram draw it in jsdom
 * (LineageDrawMore.test.tsx, LineageFollowColumn.test.tsx,
 * LineageKeyboardFocus.test.tsx): they mock
 * reactflow with this (jest.mock("reactflow", () =>
 * jest.requireActual("./LineageFlowStandIn"))).
 *
 * React Flow measures nothing in jsdom: the stand-in draws each card with
 * the component type the diagram registered for it and each arrow with
 * its own, and keeps the props of the latest drawing (flowProps). The
 * instance it hands onInit is a view of its own: setViewport moves it and
 * is written down (viewportsSet), getViewport says where it is, starting
 * where the drawing opened (defaultViewport). moveView moves it as the
 * reader would, by dragging. A click that reaches a card's own wrapper is
 * counted (cardClicks), as React Flow's onNodeClick would see it. Every
 * arrow is drawn level, 100 across, unless a suite gives its ends other
 * heights (setArrowEnds); getBezierPath puts its label on its middle, as
 * React Flow's does.
 *
 * Its element is laid out as React Flow's is - `.react-flow` around
 * `.react-flow__renderer`, which holds the cards and arrows, with the
 * controls beside it - and its store, as the keyboard's focus reads it
 * (useStore, useStoreApi), holds that element and React Flow's panBy:
 * a pan moves the view as React Flow's does, unconstrained (a lineage
 * drawing has no pan extent), and is written down (pansMade). jsdom lays
 * nothing out, so where anything is on screen is a suite's to say.
 */

interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

interface ArrowEnds {
  sourceY: number;
  targetY: number;
}

interface Pan {
  x: number;
  y: number;
}

// React Flow's store, as much of it as the drawing reads.
export interface StandInFlowState {
  domNode: HTMLDivElement | null;
  transform: [number, number, number];
  panBy: (delta: Pan) => boolean;
}

let latestProps: ReactFlowProps | null = null;
let shownViewport: Viewport = { x: 0, y: 0, zoom: 1 };
const viewportsSet: Array<Viewport> = [];
const cardClicks: Array<string> = [];
const arrowEnds: Map<string, ArrowEnds> = new Map();
const pans: Array<Pan> = [];
let flowElement: HTMLDivElement | null = null;
const storeListeners: Set<() => void> = new Set();

export function flowProps(): ReactFlowProps | null {
  return latestProps;
}

export function setViewportCalls(): Array<Viewport> {
  return viewportsSet;
}

export function cardClicksSeen(): Array<string> {
  return cardClicks;
}

export function currentViewport(): Viewport {
  return shownViewport;
}

// The pans made through React Flow's store, in screen pixels, in order.
export function pansMade(): Array<Pan> {
  return pans;
}

// React Flow's element, `.react-flow`, while the drawing is on the page.
export function flowDomNode(): HTMLDivElement | null {
  return flowElement;
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

// React Flow's store.panBy: moves the view by a delta, unless there is none.
function panViewBy(delta: Pan): boolean {
  if (!delta.x && !delta.y) {
    return false;
  }

  pans.push({ x: delta.x, y: delta.y });
  shownViewport = {
    x: shownViewport.x + delta.x,
    y: shownViewport.y + delta.y,
    zoom: shownViewport.zoom,
  };

  return true;
}

function storeState(): StandInFlowState {
  return {
    domNode: flowElement,
    transform: [shownViewport.x, shownViewport.y, shownViewport.zoom],
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

export function resetFlowStandIn(): void {
  latestProps = null;
  shownViewport = { x: 0, y: 0, zoom: 1 };
  viewportsSet.length = 0;
  cardClicks.length = 0;
  pans.length = 0;
  arrowEnds.clear();
}

// Draws an arrow with its ends at these heights: one not level curves, as between two rows.
export function setArrowEnds(edgeId: string, ends: ArrowEnds): void {
  arrowEnds.set(edgeId, ends);
}

// The reader drags the view: React Flow's own move, with the event it carries.
export function moveView(viewport: Viewport): void {
  shownViewport = viewport;
  latestProps?.onMoveStart?.(
    new MouseEvent("mousedown") as never,
    viewport as never,
  );
  latestProps?.onMoveEnd?.(
    new MouseEvent("mouseup") as never,
    viewport as never,
  );
}

const StandInFlow: (props: ReactFlowProps) => ReactElement = (
  props: ReactFlowProps,
): ReactElement => {
  /*
   * React in development calls a component with no props at all to find
   * where it is defined, for the component stack of a warning - one about
   * an arrow's SVG drawn outside an <svg> here: that is not a drawing.
   */
  if (props) {
    latestProps = props;
  }

  React.useEffect(() => {
    shownViewport = (props.defaultViewport as Viewport | undefined) || {
      x: 0,
      y: 0,
      zoom: 1,
    };

    props.onInit?.({
      setViewport: (viewport: Viewport): void => {
        viewportsSet.push(viewport);
        shownViewport = viewport;
      },
      getViewport: (): Viewport => {
        return shownViewport;
      },
    } as never);
  }, []);

  return React.createElement(
    "div",
    {
      "data-testid": "mock-react-flow",
      className: "react-flow",
      ref: noteFlowElement,
    },
    React.createElement(
      "div",
      { className: "react-flow__renderer" },
      (props.edges || []).map((edge: any) => {
        const Arrow: any = (props.edgeTypes as any)?.[edge.type];

        return Arrow
          ? React.createElement(
              "div",
              { key: edge.id, "data-testid": `flow-edge-${edge.id}` },
              React.createElement(Arrow, {
                id: edge.id,
                source: edge.source,
                target: edge.target,
                data: edge.data,
                style: edge.style,
                markerEnd: "url(#arrow)",
                sourceX: 0,
                sourceY: arrowEnds.get(edge.id)?.sourceY ?? 0,
                targetX: 100,
                targetY: arrowEnds.get(edge.id)?.targetY ?? 0,
                sourcePosition: "right",
                targetPosition: "left",
              }),
            )
          : null;
      }),
      (props.nodes || []).map((node: any) => {
        const Card: any = (props.nodeTypes as any)[node.type];

        return React.createElement(
          "div",
          {
            key: node.id,
            "data-testid": `flow-node-${node.id}`,
            onClick: (): void => {
              cardClicks.push(node.id);
            },
          },
          React.createElement(Card, {
            id: node.id,
            data: node.data,
            type: node.type,
            selected: false,
            isConnectable: false,
            xPos: node.position.x,
            yPos: node.position.y,
            zIndex: 0,
            dragging: false,
          }),
        );
      }),
    ),
    props.children,
  );
};

export default StandInFlow;

export const Background: () => null = (): null => {
  return null;
};

export const Controls: () => null = (): null => {
  return null;
};

export const Handle: () => null = (): null => {
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

// An arrow's line, and its label drawn where it is.
export const BaseEdge: (props: { path: string }) => ReactElement = (props: {
  path: string;
}): ReactElement => {
  return React.createElement("svg", {
    "data-testid": "base-edge",
    "data-path": props.path,
  });
};

export const EdgeLabelRenderer: (props: {
  children?: React.ReactNode;
}) => ReactElement = (props: { children?: React.ReactNode }): ReactElement => {
  return React.createElement(React.Fragment, null, props.children);
};

// The arrow's path, and its middle, where React Flow puts its label.
export const getBezierPath: (ends: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}) => [string, number, number] = (ends: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}): [string, number, number] => {
  const middleX: number = (ends.sourceX + ends.targetX) / 2;
  const middleY: number = (ends.sourceY + ends.targetY) / 2;

  return [
    `M${ends.sourceX},${ends.sourceY} C${middleX},${ends.sourceY} ${middleX},${ends.targetY} ${ends.targetX},${ends.targetY}`,
    middleX,
    middleY,
  ];
};

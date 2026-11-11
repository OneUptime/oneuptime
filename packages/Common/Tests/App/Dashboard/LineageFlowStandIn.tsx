import React, { ReactElement } from "react";
import type { ReactFlowProps } from "reactflow";

/*
 * React Flow, as the suites that grow a lineage diagram draw it in jsdom
 * (LineageDrawMore.test.tsx, LineageFollowColumn.test.tsx): they mock
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
 * counted (cardClicks), as React Flow's onNodeClick would see it.
 */

interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

let latestProps: ReactFlowProps | null = null;
let shownViewport: Viewport = { x: 0, y: 0, zoom: 1 };
const viewportsSet: Array<Viewport> = [];
const cardClicks: Array<string> = [];

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

export function resetFlowStandIn(): void {
  latestProps = null;
  shownViewport = { x: 0, y: 0, zoom: 1 };
  viewportsSet.length = 0;
  cardClicks.length = 0;
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
  latestProps = props;

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
    { "data-testid": "mock-react-flow" },
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
              sourceY: 0,
              targetX: 100,
              targetY: 0,
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

export const getBezierPath: () => [string, number, number] = (): [
  string,
  number,
  number,
] => {
  return ["M0,0 C50,0 50,0 100,0", 50, 0];
};

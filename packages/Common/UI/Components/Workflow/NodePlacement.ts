import { ComponentType, NodeType } from "../../../Types/Workflow/Component";
import { Node, XYPosition } from "reactflow";

/** A step card's width on the canvas: 16rem, set in Component.tsx. */
export const WORKFLOW_NODE_WIDTH: number = 256;

// Room left below a step whose height the canvas has not measured yet.
export const DEFAULT_NODE_HEIGHT: number = 200;

/*
 * How tall a step that was just added is taken to be when deciding whether
 * it is in view, since the canvas has not drawn it yet. Cards come out about
 * 160 to 210 pixels tall, the most with the "Click to set up" prompt a new
 * step usually has, so this errs on the tall side.
 */
export const NEW_NODE_HEIGHT_ESTIMATE: number = 220;

const NODE_GAP: number = 80;

/*
 * How close to the canvas's edge, in screen pixels, a step may sit and still
 * count as in view. Also the gap a step is brought in to when it is not.
 */
const IN_VIEW_MARGIN: number = 24;

type GetNewWorkflowNodePositionFunction = (
  nodes: Array<Node>,
  componentType: ComponentType,
) => XYPosition;

/** Keep new steps clear of existing cards, including cards resized by content. */
export const getNewWorkflowNodePosition: GetNewWorkflowNodePositionFunction = (
  nodes: Array<Node>,
  componentType: ComponentType,
): XYPosition => {
  if (componentType === ComponentType.Trigger) {
    const trigger: Node | undefined = nodes.find((node: Node) => {
      return (
        node.data.nodeType === NodeType.PlaceholderNode ||
        node.data.componentType === ComponentType.Trigger
      );
    });

    if (trigger) {
      return { ...trigger.position };
    }

    const firstNode: Node | undefined = [...nodes].sort((a: Node, b: Node) => {
      return a.position.y - b.position.y;
    })[0];

    return firstNode
      ? {
          x: firstNode.position.x,
          y: firstNode.position.y - DEFAULT_NODE_HEIGHT - NODE_GAP,
        }
      : { x: 100, y: 100 };
  }

  let lastNode: Node | undefined;
  let lowestBottom: number = -Infinity;

  for (const node of nodes) {
    const bottom: number =
      node.position.y + (node.height || DEFAULT_NODE_HEIGHT);

    if (bottom > lowestBottom) {
      lowestBottom = bottom;
      lastNode = node;
    }
  }

  return lastNode
    ? { x: lastNode.position.x, y: lowestBottom + NODE_GAP }
    : { x: 100, y: 100 };
};

/** The canvas's pan and zoom, as react-flow reports them. */
export interface WorkflowCanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

/** The size of the canvas on screen, in pixels. */
export interface WorkflowCanvasSize {
  width: number;
  height: number;
}

/** A box on screen, in pixels from the canvas's top-left corner. */
export interface WorkflowCanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A step, and the canvas it is drawn on. */
export interface WorkflowNodeOnCanvas {
  /** The step's top-left corner, in canvas coordinates. */
  position: XYPosition;
  viewport: WorkflowCanvasViewport;
  canvasSize: WorkflowCanvasSize;
  /**
   * What is drawn over the canvas, such as the minimap and the zoom buttons.
   * A step under one of them is not in view: on a phone they cover the whole
   * bottom of the canvas, which is where a new step lands.
   */
  overlays?: Array<WorkflowCanvasRect> | undefined;
  /** Defaults to a step card's width. */
  width?: number | undefined;
  /** Defaults to NEW_NODE_HEIGHT_ESTIMATE: a new step is not measured yet. */
  height?: number | undefined;
}

type GetScreenBoxFunction = (
  params: WorkflowNodeOnCanvas,
) => WorkflowCanvasRect;

// react-flow draws a canvas point at (point * zoom + pan) on screen.
const getScreenBox: GetScreenBoxFunction = (
  params: WorkflowNodeOnCanvas,
): WorkflowCanvasRect => {
  const zoom: number = params.viewport.zoom || 1;

  return {
    left: params.position.x * zoom + params.viewport.x,
    top: params.position.y * zoom + params.viewport.y,
    width: (params.width || WORKFLOW_NODE_WIDTH) * zoom,
    height: (params.height || NEW_NODE_HEIGHT_ESTIMATE) * zoom,
  };
};

interface VerticalRoom {
  top: number;
  bottom: number;
}

type GetVerticalRoomFunction = (params: {
  box: WorkflowCanvasRect;
  canvasSize: WorkflowCanvasSize;
  overlays?: Array<WorkflowCanvasRect> | undefined;
}) => VerticalRoom;

/*
 * The band a step may sit in, top to bottom, given where it sits across.
 * An overlay the step would pass under, in the bottom half of the canvas,
 * lowers the floor to above it; one in the top half raises the ceiling.
 * Overlays off to the side of the step, or with no size, change nothing.
 */
const getVerticalRoom: GetVerticalRoomFunction = (params: {
  box: WorkflowCanvasRect;
  canvasSize: WorkflowCanvasSize;
  overlays?: Array<WorkflowCanvasRect> | undefined;
}): VerticalRoom => {
  const room: VerticalRoom = {
    top: IN_VIEW_MARGIN,
    bottom: params.canvasSize.height - IN_VIEW_MARGIN,
  };

  for (const overlay of params.overlays || []) {
    if (!overlay || overlay.width <= 0 || overlay.height <= 0) {
      continue;
    }

    const isBesideTheStep: boolean =
      overlay.left >= params.box.left + params.box.width ||
      overlay.left + overlay.width <= params.box.left;

    if (isBesideTheStep) {
      continue;
    }

    if (overlay.top + overlay.height / 2 >= params.canvasSize.height / 2) {
      room.bottom = Math.min(room.bottom, overlay.top - IN_VIEW_MARGIN);
    } else {
      room.top = Math.max(
        room.top,
        overlay.top + overlay.height + IN_VIEW_MARGIN,
      );
    }
  }

  return room;
};

type IsWorkflowNodeInViewFunction = (params: WorkflowNodeOnCanvas) => boolean;

/**
 * Whether the whole step is on screen, clear of the canvas's edges and of
 * anything drawn over it.
 */
export const isWorkflowNodeInView: IsWorkflowNodeInViewFunction = (
  params: WorkflowNodeOnCanvas,
): boolean => {
  const box: WorkflowCanvasRect = getScreenBox(params);
  const room: VerticalRoom = getVerticalRoom({
    box: box,
    canvasSize: params.canvasSize,
    overlays: params.overlays,
  });

  return (
    box.left >= IN_VIEW_MARGIN &&
    box.left + box.width <= params.canvasSize.width - IN_VIEW_MARGIN &&
    box.top >= room.top &&
    box.top + box.height <= room.bottom
  );
};

type GetPanToRevealFunction = (params: {
  start: number;
  size: number;
  /** The first pixel the span may start at. */
  min: number;
  /** The last pixel the span may end at. */
  max: number;
}) => number;

/*
 * How far to move along one axis so a span sits between min and max:
 * whichever end is out comes in, and a span too big to fit shows its start.
 */
const getPanToReveal: GetPanToRevealFunction = (params: {
  start: number;
  size: number;
  min: number;
  max: number;
}): number => {
  if (params.start < params.min || params.size > params.max - params.min) {
    return params.min - params.start;
  }

  if (params.start + params.size > params.max) {
    return params.max - (params.start + params.size);
  }

  return 0;
};

type GetViewportToRevealNodeFunction = (
  params: WorkflowNodeOnCanvas,
) => WorkflowCanvasViewport | null;

/**
 * Where to move the canvas so a step that was just added is on screen, or
 * null when it is on screen already.
 *
 * The zoom stays the one the builder chose, and the canvas moves only as far
 * as it must. Building a workflow is adding a step under the last one and
 * connecting the two, so centring the view on the new step would scroll the
 * step it gets connected to off the top. A step in plain sight does not move
 * the canvas at all.
 */
export const getViewportToRevealNode: GetViewportToRevealNodeFunction = (
  params: WorkflowNodeOnCanvas,
): WorkflowCanvasViewport | null => {
  if (isWorkflowNodeInView(params)) {
    return null;
  }

  const box: WorkflowCanvasRect = getScreenBox(params);

  const panX: number = getPanToReveal({
    start: box.left,
    size: box.width,
    min: IN_VIEW_MARGIN,
    max: params.canvasSize.width - IN_VIEW_MARGIN,
  });

  // Which overlays are in the way depends on where the step ends up across.
  const room: VerticalRoom = getVerticalRoom({
    box: { ...box, left: box.left + panX },
    canvasSize: params.canvasSize,
    overlays: params.overlays,
  });

  const panY: number = getPanToReveal({
    start: box.top,
    size: box.height,
    min: room.top,
    max: room.bottom,
  });

  return {
    x: params.viewport.x + panX,
    y: params.viewport.y + panY,
    zoom: params.viewport.zoom || 1,
  };
};

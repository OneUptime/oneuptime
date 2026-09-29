import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
} from "react";
import {
  FitViewOptions,
  Node,
  ReactFlowInstance,
  ReactFlowState,
  useReactFlow,
  useStore,
} from "reactflow";
import {
  FlowExtent,
  FlowRect,
  UNBOUNDED_FLOW_EXTENT,
  anyRectInView,
  drawingExtent,
  extentsMatch,
} from "./FlowViewport";

/*
 * Keeps a React Flow map on its canvas. Rendered as a child of <ReactFlow>,
 * the one place React Flow's store can be read, so every decision is made
 * against what React Flow has actually drawn rather than a guess at it:
 *
 * - Framing. The drawing is fitted once React Flow holds it with every node
 *   measured and knows the canvas's current size, never before. A fit that
 *   ran earlier would frame the previous drawing, or frame the new one in the
 *   old canvas: the canvas height follows the drawing, and React Flow only
 *   learns a new size from its own ResizeObserver a frame later. The
 *   drawing is fitted again whenever it changes, and when the canvas is
 *   resized while the view is still the automatic framing (see autoFrame) —
 *   a narrower window no longer leaves a fitted map sitting past the edge.
 * - The pan extent. The measured drawing plus a margin, reported for the
 *   map's translateExtent, so the viewport cannot be dragged or zoomed off
 *   the drawing. Measured rather than estimated, so it is centred exactly
 *   where the fit centres the drawing and the first drag does not jump.
 * - Whether anything is in view, for the map's "out of view" notice.
 * - The live instance. It is reported as soon as the viewport is ready and
 *   withdrawn on unmount, so a Fit to screen after Map/Table never reaches a
 *   React Flow that is gone (onInit fires a timer later and never clears).
 */

export interface ComponentProps {
  /* The ids of the nodes the map gives React Flow, in order, joined by "|". */
  drawingKey: string;
  fitViewOptions: FitViewOptions;
  /*
   * True while the view is the automatic framing. The map clears it when the
   * user pans or zooms and sets it on Fit to screen; every fit here sets it.
   */
  autoFrame: MutableRefObject<boolean>;
  /* Slack around the drawing the viewport may move into, in flow units. */
  panMargin: number;
  onInstance: (instance: ReactFlowInstance | null) => void;
  onExtentChange: (extent: FlowExtent) => void;
  onDrawingInViewChange: (inView: boolean) => void;
}

interface Callbacks {
  onInstance: ComponentProps["onInstance"];
  onExtentChange: ComponentProps["onExtentChange"];
  onDrawingInViewChange: ComponentProps["onDrawingInViewChange"];
}

interface DrawingState {
  key: string;
  rects: Array<FlowRect>;
  /* Every node has a measured size (and there is at least one node). */
  measured: boolean;
}

interface LastFit {
  drawingKey: string;
  paneWidth: number;
  paneHeight: number;
}

/* A node's box, or null while React Flow has not measured it. */
export function measuredRectOf(node: Node): FlowRect | null {
  if (!node.width || !node.height) {
    return null;
  }
  const position: { x: number; y: number } =
    node.positionAbsolute || node.position;
  return {
    x: position.x,
    y: position.y,
    width: node.width,
    height: node.height,
  };
}

function* measuredRects(
  nodeInternals: ReactFlowState["nodeInternals"],
): Generator<FlowRect> {
  for (const node of nodeInternals.values()) {
    const rect: FlowRect | null = measuredRectOf(node);
    if (rect) {
      yield rect;
    }
  }
}

const selectNodeInternals: (
  state: ReactFlowState,
) => ReactFlowState["nodeInternals"] = (
  state: ReactFlowState,
): ReactFlowState["nodeInternals"] => {
  return state.nodeInternals;
};

const selectPaneWidth: (state: ReactFlowState) => number = (
  state: ReactFlowState,
): number => {
  return state.width;
};

const selectPaneHeight: (state: ReactFlowState) => number = (
  state: ReactFlowState,
): number => {
  return state.height;
};

/*
 * A boolean, so the guard re-renders when the answer changes rather than on
 * every frame of a pan or zoom. Nodes still waiting to be measured are not
 * drawn (React Flow keeps them hidden), so they do not count as in view.
 */
export const selectDrawingInView: (state: ReactFlowState) => boolean = (
  state: ReactFlowState,
): boolean => {
  if (state.nodeInternals.size === 0) {
    return true;
  }
  return anyRectInView(measuredRects(state.nodeInternals), state.transform, {
    width: state.width,
    height: state.height,
  });
};

const FlowViewportGuard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const instance: ReactFlowInstance = useReactFlow();
  const nodeInternals: ReactFlowState["nodeInternals"] =
    useStore(selectNodeInternals);
  const paneWidth: number = useStore(selectPaneWidth);
  const paneHeight: number = useStore(selectPaneHeight);
  const drawingInView: boolean = useStore(selectDrawingInView);

  /* The latest callbacks, for effects that must not re-run when they change. */
  const callbacks: MutableRefObject<Callbacks> = useRef<Callbacks>({
    onInstance: props.onInstance,
    onExtentChange: props.onExtentChange,
    onDrawingInViewChange: props.onDrawingInViewChange,
  });
  callbacks.current = {
    onInstance: props.onInstance,
    onExtentChange: props.onExtentChange,
    onDrawingInViewChange: props.onDrawingInViewChange,
  };
  const lastFit: MutableRefObject<LastFit | null> = useRef<LastFit | null>(
    null,
  );
  const lastExtent: MutableRefObject<FlowExtent | null> =
    useRef<FlowExtent | null>(null);

  const drawing: DrawingState = useMemo((): DrawingState => {
    const ids: Array<string> = [];
    const rects: Array<FlowRect> = [];
    let measured: boolean = true;
    for (const node of nodeInternals.values()) {
      ids.push(node.id);
      const rect: FlowRect | null = measuredRectOf(node);
      if (rect) {
        rects.push(rect);
      } else {
        measured = false;
      }
    }
    return {
      key: ids.join("|"),
      rects,
      measured: measured && ids.length > 0,
    };
  }, [nodeInternals]);

  useEffect(() => {
    callbacks.current.onInstance(
      instance.viewportInitialized ? instance : null,
    );
  }, [instance]);

  useEffect(() => {
    callbacks.current.onDrawingInViewChange(drawingInView);
  }, [drawingInView]);

  useEffect(() => {
    return () => {
      callbacks.current.onInstance(null);
      callbacks.current.onDrawingInViewChange(true);
      callbacks.current.onExtentChange(UNBOUNDED_FLOW_EXTENT);
    };
  }, []);

  /*
   * React Flow applies a new nodes array in an effect of its own, so until
   * that has run its store still holds the previous drawing. Nothing below
   * acts on a drawing other than the one the map asked for.
   */
  const holdsDrawing: boolean =
    drawing.measured && drawing.key === props.drawingKey;

  useEffect(() => {
    if (
      !holdsDrawing ||
      !instance.viewportInitialized ||
      paneWidth <= 0 ||
      paneHeight <= 0
    ) {
      return;
    }
    const last: LastFit | null = lastFit.current;
    const drawingChanged: boolean =
      !last || last.drawingKey !== props.drawingKey;
    const paneResized: boolean = Boolean(
      last && (last.paneWidth !== paneWidth || last.paneHeight !== paneHeight),
    );
    if (!drawingChanged && !(paneResized && props.autoFrame.current)) {
      return;
    }
    if (instance.fitView(props.fitViewOptions)) {
      lastFit.current = {
        drawingKey: props.drawingKey,
        paneWidth,
        paneHeight,
      };
      props.autoFrame.current = true;
    }
  }, [holdsDrawing, instance, paneWidth, paneHeight, props.drawingKey]);

  useEffect(() => {
    if (!holdsDrawing) {
      return;
    }
    const extent: FlowExtent = drawingExtent(drawing.rects, props.panMargin);
    if (lastExtent.current && extentsMatch(lastExtent.current, extent)) {
      return;
    }
    lastExtent.current = extent;
    callbacks.current.onExtentChange(extent);
  }, [holdsDrawing, drawing, props.panMargin]);

  return <></>;
};

export default FlowViewportGuard;

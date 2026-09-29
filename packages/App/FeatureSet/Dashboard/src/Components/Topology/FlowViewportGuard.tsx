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
  Viewport,
  useReactFlow,
  useStore,
  useStoreApi,
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
 *   measured and the canvas size it has on record is the canvas on the page,
 *   never before. A fit that ran earlier would frame the previous drawing,
 *   or frame the new one in the old canvas: the canvas height follows the
 *   drawing, and React Flow only learns a new size from its own
 *   ResizeObserver a frame later. The drawing is fitted again whenever it
 *   changes, and when the canvas is resized while the view is still the
 *   automatic framing (see autoFrame) — a narrower window no longer leaves a
 *   fitted map sitting past the edge. Once the user has taken the view, a
 *   resize keeps it, within the pan extent: d3-zoom would otherwise apply the
 *   extent only on the next drag, which then jumps.
 * - Keyboard focus. React Flow 11 makes every card and connection
 *   focusable, and focusing one outside the canvas makes the browser scroll
 *   React Flow's overflow:hidden box. Everything React Flow draws, its
 *   controls included, then slides off the canvas while its viewport — as
 *   far as React Flow knows — never moved, so nothing could tell the map was
 *   blank. The scroll is turned into a pan of the viewport instead: the
 *   focused element comes into view, and the map stays whole.
 * - The pan extent. The measured drawing plus a margin, reported for the
 *   map's translateExtent, so the drawing's bounding box cannot be dragged or
 *   zoomed off the canvas. Measured rather than estimated, so it is centred
 *   exactly where the fit centres the drawing and the first drag does not
 *   jump.
 * - Whether any card is in view, for the map's "out of view" notice.
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
   * user pans or zooms and sets it on Fit to screen; every fit here sets it,
   * and a pan here that follows keyboard focus clears it.
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

interface PaneSize {
  width: number;
  height: number;
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

/*
 * The canvas as the page lays it out now: the element React Flow measures
 * its pane from (useResizeHandler watches `.react-flow__renderer`). Null
 * when there is nothing to compare with yet.
 */
export function renderedPaneSize(
  domNode: HTMLElement | null | undefined,
): PaneSize | null {
  const renderer: HTMLElement | null =
    domNode?.querySelector<HTMLElement>(".react-flow__renderer") || null;
  if (!renderer) {
    return null;
  }
  return { width: renderer.offsetWidth, height: renderer.offsetHeight };
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

const selectDomNode: (state: ReactFlowState) => HTMLDivElement | null = (
  state: ReactFlowState,
): HTMLDivElement | null => {
  return state.domNode;
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
  const store: ReturnType<typeof useStoreApi> = useStoreApi();
  const nodeInternals: ReactFlowState["nodeInternals"] =
    useStore(selectNodeInternals);
  const paneWidth: number = useStore(selectPaneWidth);
  const paneHeight: number = useStore(selectPaneHeight);
  const domNode: HTMLDivElement | null = useStore(selectDomNode);
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
  /* The drawing the view was last fitted to. */
  const fittedDrawingKey: MutableRefObject<string | null> = useRef<
    string | null
  >(null);
  /*
   * The canvas size the framing last acted on. A resize is judged against it
   * rather than against the last fit here: the map fits on its own too (Fit
   * to screen), and the canvas can be resized while the user has the view.
   */
  const lastPane: MutableRefObject<PaneSize | null> = useRef<PaneSize | null>(
    null,
  );
  /* A fit that is owed and has not landed yet (React Flow refused it). */
  const fitDue: MutableRefObject<boolean> = useRef<boolean>(false);
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
      lastExtent.current = null;
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
    /*
     * React Flow's record of the canvas size lags the page by a frame after
     * the canvas resizes (and says 500 x 500 for a canvas that has no size).
     * Until the two agree there is nothing to decide: the store update that
     * brings the new size runs this effect again.
     */
    const rendered: PaneSize | null = renderedPaneSize(
      store.getState().domNode,
    );
    if (
      rendered &&
      (rendered.width !== paneWidth || rendered.height !== paneHeight)
    ) {
      return;
    }

    const previousPane: PaneSize | null = lastPane.current;
    lastPane.current = { width: paneWidth, height: paneHeight };
    const paneResized: boolean = Boolean(
      previousPane &&
        (previousPane.width !== paneWidth ||
          previousPane.height !== paneHeight),
    );

    if (fittedDrawingKey.current !== props.drawingKey) {
      // A new drawing is always framed, whoever had the view.
      fitDue.current = true;
    } else if (paneResized && props.autoFrame.current) {
      fitDue.current = true;
    } else if (paneResized) {
      /*
       * The user has the view: keep it, but inside the pan extent now, not
       * on the next drag. translateBy(0, 0) is d3-zoom's way of applying
       * the extent without moving anything the extent allows.
       */
      const { d3Zoom, d3Selection } = store.getState();
      if (d3Zoom && d3Selection) {
        d3Zoom.translateBy(d3Selection, 0, 0);
      }
    }

    if (fitDue.current && instance.fitView(props.fitViewOptions)) {
      fitDue.current = false;
      fittedDrawingKey.current = props.drawingKey;
      props.autoFrame.current = true;
    }
  }, [
    holdsDrawing,
    instance,
    paneWidth,
    paneHeight,
    props.drawingKey,
    drawing,
  ]);

  useEffect(() => {
    if (!domNode) {
      return undefined;
    }
    const followFocus: () => void = (): void => {
      const left: number = domNode.scrollLeft;
      const top: number = domNode.scrollTop;
      if (!left && !top) {
        return;
      }
      domNode.scrollLeft = 0;
      domNode.scrollTop = 0;
      const viewport: Viewport = instance.getViewport();
      instance.setViewport({
        x: viewport.x - left,
        y: viewport.y - top,
        zoom: viewport.zoom,
      });
      props.autoFrame.current = false;
    };
    domNode.addEventListener("scroll", followFocus);
    return () => {
      domNode.removeEventListener("scroll", followFocus);
    };
  }, [domNode, instance]);

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

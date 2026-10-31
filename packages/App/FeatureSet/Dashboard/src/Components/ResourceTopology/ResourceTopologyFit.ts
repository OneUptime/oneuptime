import { ResourceTopologyGraph } from "./ResourceTopologyModel";
import {
  ResourceTopologyVisible,
  VIEW_BUDGET,
  computeResourceTopologyView,
  createResourceTopologyViewState,
  getAutomaticDepth,
} from "./ResourceTopologyView";
import {
  ResourceTopologyLanes,
  ResourceTopologyLayout,
  ResourceTopologyLayoutRelation,
  layoutResourceTopology,
} from "./ResourceTopologyLayout";

/*
 * How much of a resource the first view opens, for the canvas it is drawn
 * on. A larger screen reads more at once, so the budget of VIEW_BUDGET
 * cards is for a laptop's canvas and grows and shrinks with the canvas's
 * area. Then the drawing is laid out, and while it would only fit the
 * canvas below a readable zoom one level fewer opens by itself: the first
 * view is always one a person can read without zooming in.
 *
 * Worked out for the resource (or the focused part) with nothing opened,
 * closed, filtered or searched, so a person opening a part never makes
 * another part close by itself. Pure and free of React.
 */

/* What React Flow leaves around a framed drawing, as a share of it. */
export const RESOURCE_TOPOLOGY_FIT_PADDING: number = 0.08;
/* The smallest zoom the first view is drawn at, when it can be helped. */
export const READABLE_ZOOM: number = 0.7;
/* The canvas VIEW_BUDGET is for: a laptop's. */
export const REFERENCE_CANVAS_AREA: number = 900 * 640;
export const MIN_VIEW_BUDGET: number = 12;
export const MAX_VIEW_BUDGET: number = 56;

export interface ResourceTopologyCanvasSize {
  width: number;
  height: number;
}

export interface ResourceTopologyFit {
  budget: number;
  /* Levels the first view opens below its top (1: only the top). */
  depth: number;
}

export function getViewBudgetFor(canvas: ResourceTopologyCanvasSize): number {
  const area: number = Math.max(0, canvas.width) * Math.max(0, canvas.height);
  const scaled: number = Math.round(
    (VIEW_BUDGET * area) / REFERENCE_CANVAS_AREA,
  );

  return Math.min(MAX_VIEW_BUDGET, Math.max(MIN_VIEW_BUDGET, scaled));
}

/* The zoom React Flow frames a drawing at, the way its fitView works it out. */
export function getFitZoom(
  layout: Pick<ResourceTopologyLayout, "width" | "height">,
  canvas: ResourceTopologyCanvasSize,
  padding: number = RESOURCE_TOPOLOGY_FIT_PADDING,
): number {
  if (layout.width <= 0 || layout.height <= 0) {
    return 1;
  }

  return Math.min(
    canvas.width / (layout.width * (1 + padding)),
    canvas.height / (layout.height * (1 + padding)),
  );
}

export interface ResourceTopologyFitOptions {
  lanes?: ResourceTopologyLanes | undefined;
  /* The shape the map lays the drawing out for; the canvas's by default. */
  aspect?: number | undefined;
  /* The relations a lane's parts line up with (see the layout). */
  relations?: ReadonlyArray<ResourceTopologyLayoutRelation> | undefined;
}

/*
 * Whether React Flow holds the drawing the map handed it: every id of it,
 * and nothing else. Until it does it still holds the previous drawing, and
 * a fit would frame what is gone. The ids are compared one by one, never as
 * one joined string: a "+ N more" item's id holds its group's key, which
 * holds a "|" of its own.
 */
export function holdsResourceTopologyDrawing(
  held: { size: number; has: (id: string) => boolean },
  drawingIds: ReadonlyArray<string>,
): boolean {
  return (
    held.size === drawingIds.length &&
    drawingIds.every((id: string): boolean => {
      return held.has(id);
    })
  );
}

export function fitResourceTopology(
  graph: ResourceTopologyGraph,
  focusId: string | null,
  canvas: ResourceTopologyCanvasSize,
  options: ResourceTopologyFitOptions = {},
): ResourceTopologyFit {
  const budget: number = getViewBudgetFor(canvas);
  const topId: string =
    focusId && focusId !== graph.rootId && graph.nodes.has(focusId)
      ? focusId
      : graph.rootId;
  const deepest: number = getAutomaticDepth(graph, topId, budget);
  const state: ReturnType<typeof createResourceTopologyViewState> =
    createResourceTopologyViewState({
      focusId: topId === graph.rootId ? null : topId,
    });
  const aspect: number =
    options.aspect ??
    (canvas.height > 0 ? Math.max(0.5, canvas.width / canvas.height) : 1.8);

  for (let depth: number = deepest; depth > 1; depth--) {
    const visible: ResourceTopologyVisible = computeResourceTopologyView(
      graph,
      state,
      { budget: budget, maxAutomaticDepth: depth },
    );
    const layout: ResourceTopologyLayout = layoutResourceTopology(visible, {
      aspect: aspect,
      lanes: options.lanes,
      relations: options.relations,
    });

    if (getFitZoom(layout, canvas) >= READABLE_ZOOM) {
      return { budget: budget, depth: depth };
    }
  }

  return { budget: budget, depth: Math.min(deepest, 1) };
}

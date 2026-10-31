import { ResourceTopologyGraph } from "./ResourceTopologyModel";
import {
  ResourceTopologyVisible,
  VIEW_BUDGET,
  computeResourceTopologyView,
  createResourceTopologyViewState,
  getAutomaticDepth,
} from "./ResourceTopologyView";
import {
  ResourceTopologyHeadingWidth,
  ResourceTopologyLanes,
  ResourceTopologyLayout,
  ResourceTopologyLayoutRelation,
  ResourceTopologyPlaced,
  getTopologyFrameIds,
  getTopologySubtreeIds,
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
export const READABLE_ZOOM: number = 0.62;
/*
 * A first view that fits at this zoom or more has room to spare: the map
 * then opens healthy parts too (see fitResourceTopology).
 */
export const SPARE_ROOM_ZOOM: number = 1;
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
  /*
   * Healthy parts open too: the way to trouble left room to spare, so the
   * first view shows more of the resource (see fitResourceTopology).
   */
  opensAll: boolean;
  /*
   * The most parts a row holds, as the first view was laid out: kept while
   * a person opens and closes parts, so the rest of the drawing stays put.
   */
  rowLength: number;
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

/*
 * The most room left above a framed drawing. A tree reads from the
 * resource down, so a drawing shorter than its canvas sits at the top of
 * it, centred across - not floating in the middle with its resource
 * halfway down the canvas - and grows into the room below as parts open.
 */
export const RESOURCE_TOPOLOGY_TOP_GAP: number = 24;

export interface ResourceTopologyViewport {
  x: number;
  y: number;
  zoom: number;
}

/*
 * Where a whole drawing is framed: at the zoom React Flow's fitView would
 * pick (no closer than `maxZoom`), centred across the canvas, and at the
 * top of it with RESOURCE_TOPOLOGY_TOP_GAP above - or centred, as fitView
 * would, when it fills the canvas's height anyway.
 */
export function getTopAlignedViewport(
  drawing: { x: number; y: number; width: number; height: number },
  canvas: ResourceTopologyCanvasSize,
  options: { maxZoom?: number; minZoom?: number; padding?: number } = {},
): ResourceTopologyViewport {
  const zoom: number = Math.max(
    options.minZoom ?? 0,
    Math.min(
      options.maxZoom ?? 1,
      getFitZoom(drawing, canvas, options.padding),
    ),
  );
  const drawnWidth: number = drawing.width * zoom;
  const drawnHeight: number = drawing.height * zoom;
  const top: number = Math.min(
    (canvas.height - drawnHeight) / 2,
    RESOURCE_TOPOLOGY_TOP_GAP,
  );

  return {
    x: (canvas.width - drawnWidth) / 2 - drawing.x * zoom,
    y: top - drawing.y * zoom,
    zoom: zoom,
  };
}

/* The box around every placed item of a drawing. */
export function getDrawingBounds(
  placed: ReadonlyArray<
    Pick<ResourceTopologyPlaced, "x" | "y" | "width" | "height">
  >,
): { x: number; y: number; width: number; height: number } {
  if (placed.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX: number = Number.POSITIVE_INFINITY;
  let minY: number = Number.POSITIVE_INFINITY;
  let maxX: number = Number.NEGATIVE_INFINITY;
  let maxY: number = Number.NEGATIVE_INFINITY;

  for (const item of placed) {
    minX = Math.min(minX, item.x);
    minY = Math.min(minY, item.y);
    maxX = Math.max(maxX, item.x + item.width);
    maxY = Math.max(maxY, item.y + item.height);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/*
 * What to frame when a part opens: the part and everything that opened
 * with it - a namespace with the pods of its troubled workload - when that
 * still reads (READABLE_ZOOM) on this canvas; otherwise the part with its
 * own parts (getTopologyFrameIds), so what just appeared is on screen at a
 * size a person can read, rather than cut off at the canvas's edge.
 */
export function getTopologyOpenFrameIds(
  layout: Pick<ResourceTopologyLayout, "placed">,
  nodeIds: ReadonlyArray<string>,
  canvas: ResourceTopologyCanvasSize,
): Array<string> {
  const near: Array<string> = getTopologyFrameIds(layout, nodeIds);
  const all: Array<string> = getTopologySubtreeIds(layout, nodeIds);

  if (all.length <= near.length || canvas.width <= 0 || canvas.height <= 0) {
    return near;
  }

  const ids: Set<string> = new Set<string>(all);
  const bounds: { width: number; height: number } = getDrawingBounds(
    layout.placed.filter((item: ResourceTopologyPlaced): boolean => {
      return ids.has(item.id);
    }),
  );

  return getFitZoom(bounds, canvas) >= READABLE_ZOOM ? all : near;
}

export interface ResourceTopologyFitOptions {
  lanes?: ResourceTopologyLanes | undefined;
  /* The shape the map lays the drawing out for; the canvas's by default. */
  aspect?: number | undefined;
  /* The relations a lane's parts line up with (see the layout). */
  relations?: ReadonlyArray<ResourceTopologyLayoutRelation> | undefined;
  /* Parts always open and parts always shown (see the view's options). */
  alwaysOpen?: ReadonlySet<string> | undefined;
  reveal?: ReadonlyArray<string> | undefined;
  /* How wide a heading's words are drawn (see the layout's options). */
  headingWidth?: ResourceTopologyHeadingWidth | undefined;
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

  const layoutAt: (
    depth: number,
    opensAll: boolean,
  ) => ResourceTopologyLayout = (
    depth: number,
    opensAll: boolean,
  ): ResourceTopologyLayout => {
    const visible: ResourceTopologyVisible = computeResourceTopologyView(
      graph,
      state,
      {
        budget: budget,
        maxAutomaticDepth: depth,
        alwaysOpen: options.alwaysOpen,
        reveal: options.reveal,
        opensAll: opensAll,
      },
    );

    return layoutResourceTopology(visible, {
      aspect: aspect,
      lanes: options.lanes,
      relations: options.relations,
      headingWidth: options.headingWidth,
    });
  };

  // The way to trouble: as deep as reads.
  let chosen: { depth: number; layout: ResourceTopologyLayout } | null = null;

  for (let depth: number = deepest; depth > 1 && !chosen; depth--) {
    const layout: ResourceTopologyLayout = layoutAt(depth, false);

    if (getFitZoom(layout, canvas) >= READABLE_ZOOM) {
      chosen = { depth: depth, layout: layout };
    }
  }

  if (!chosen) {
    const depth: number = Math.min(deepest, 1);
    chosen = { depth: depth, layout: layoutAt(depth, false) };
  }

  /*
   * Room to spare - the way to trouble fits at its full size: healthy parts
   * open too, a level deeper or more while it still reads, so a calm
   * resource shows its shape rather than a few closed cards. A resource
   * whose trouble already fills the canvas keeps to its trouble.
   */
  if (getFitZoom(chosen.layout, canvas) >= SPARE_ROOM_ZOOM) {
    const deepestAll: number = getAutomaticDepth(graph, topId, budget, true);

    for (let depth: number = deepestAll; depth > chosen.depth; depth--) {
      const layout: ResourceTopologyLayout = layoutAt(depth, true);

      if (getFitZoom(layout, canvas) >= READABLE_ZOOM) {
        return {
          budget: budget,
          depth: depth,
          rowLength: layout.rowLength,
          opensAll: true,
        };
      }
    }
  }

  return {
    budget: budget,
    depth: chosen.depth,
    rowLength: chosen.layout.rowLength,
    opensAll: false,
  };
}

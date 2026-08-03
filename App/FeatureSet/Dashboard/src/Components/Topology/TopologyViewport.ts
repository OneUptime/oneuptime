import { clamp } from "../NetworkDevice/TopologyGraphUtil";

/*
 * Pan/zoom maths for the topology SVG, kept react-free so it can be unit
 * tested — App/Tests runs under `testEnvironment: "node"`.
 *
 * THE BUG THIS EXISTS TO FIX. The graph renders into an SVG with
 * `viewBox="0 0 1000 700"` and `preserveAspectRatio="xMidYMid meet"`,
 * inside an element whose aspect ratio is whatever the page gives it.
 * "meet" scales the viewBox uniformly until it fits, then centres it —
 * so unless the two aspect ratios happen to match exactly, the drawing
 * does not fill the element and does not start at its top-left corner.
 * There are bars down the sides or along the top and bottom.
 *
 * The previous implementation converted a pointer position with
 *
 *     u = (clientX - rect.left) / rect.width  * VIEWBOX_WIDTH
 *     v = (clientY - rect.top)  / rect.height * VIEWBOX_HEIGHT
 *
 * which assumes the drawing exactly fills the element on both axes. It
 * can only be true on the axis that happens to bind, and never on the
 * other, so at least one axis was always wrong whenever the SVG
 * letterboxed — which is the normal case, not the edge case. The visible
 * symptoms were a map that panned slower than the pointer (badly so in
 * tiered mode, where the pillarbox is hundreds of pixels wide) and a
 * wheel zoom that slid the graph sideways instead of holding the point
 * under the cursor.
 *
 * The corrected conversion is a two-stage transform: element pixels to
 * viewBox units through the "meet" fit, then viewBox units to world
 * coordinates through the inner <g>'s own translate/scale.
 */

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface WorldPoint {
  x: number;
  y: number;
}

/** The inner <g>'s transform: translate(tx ty) scale(scale). */
export interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

/** A DOMRect, reduced to what the maths needs. */
export interface ElementBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ViewBoxSize {
  width: number;
  height: number;
}

export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const MIN_ZOOM: number = 0.1;
export const MAX_ZOOM: number = 4;

/*
 * How far a pointer must travel before a press becomes a drag. Below the
 * threshold the gesture is still a click, which is what lets a user open
 * a device by clicking it on a pannable canvas. Touch is deliberately
 * harder: a finger never holds perfectly still.
 */
export const MOUSE_DRAG_THRESHOLD_PX: number = 4;
export const TOUCH_DRAG_THRESHOLD_PX: number = 10;

/** Slack left around the graph when fitting it to the viewport. */
export const FIT_PADDING_FRACTION: number = 0.06;

export const IDENTITY_VIEW: ViewTransform = { scale: 1, tx: 0, ty: 0 };

const isFiniteBox: (box: ElementBox, viewBox: ViewBoxSize) => boolean = (
  box: ElementBox,
  viewBox: ViewBoxSize,
): boolean => {
  return (
    Number.isFinite(box.left) &&
    Number.isFinite(box.top) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height) &&
    box.width > 0 &&
    box.height > 0 &&
    Number.isFinite(viewBox.width) &&
    Number.isFinite(viewBox.height) &&
    viewBox.width > 0 &&
    viewBox.height > 0
  );
};

export interface FitMetrics {
  /** Element pixels per viewBox unit. */
  scale: number;
  /** Element-space offset of the drawing's left edge. */
  offsetX: number;
  /** Element-space offset of the drawing's top edge. */
  offsetY: number;
}

/**
 * Resolve `preserveAspectRatio="xMidYMid meet"` for an element box.
 *
 * Returns the uniform scale the browser applies to the viewBox and the
 * letterbox offsets that centre it. Everything else in this module is
 * built on these three numbers.
 */
export const fitMetricsForBox: (
  box: ElementBox,
  viewBox: ViewBoxSize,
) => FitMetrics = (box: ElementBox, viewBox: ViewBoxSize): FitMetrics => {
  if (!isFiniteBox(box, viewBox)) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }
  const scale: number = Math.min(
    box.width / viewBox.width,
    box.height / viewBox.height,
  );
  return {
    scale: scale,
    offsetX: (box.width - viewBox.width * scale) / 2,
    offsetY: (box.height - viewBox.height * scale) / 2,
  };
};

/** Client pixels to viewBox units. */
export const screenToViewBox: (
  client: ScreenPoint,
  box: ElementBox,
  viewBox: ViewBoxSize,
) => ScreenPoint = (
  client: ScreenPoint,
  box: ElementBox,
  viewBox: ViewBoxSize,
): ScreenPoint => {
  const fit: FitMetrics = fitMetricsForBox(box, viewBox);
  if (fit.scale <= 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: (client.x - box.left - fit.offsetX) / fit.scale,
    y: (client.y - box.top - fit.offsetY) / fit.scale,
  };
};

/** Client pixels to world coordinates, through the inner transform. */
export const screenToWorld: (
  client: ScreenPoint,
  box: ElementBox,
  viewBox: ViewBoxSize,
  view: ViewTransform,
) => WorldPoint = (
  client: ScreenPoint,
  box: ElementBox,
  viewBox: ViewBoxSize,
  view: ViewTransform,
): WorldPoint => {
  const inViewBox: ScreenPoint = screenToViewBox(client, box, viewBox);
  const scale: number =
    Number.isFinite(view.scale) && view.scale !== 0 ? view.scale : 1;
  return {
    x: (inViewBox.x - view.tx) / scale,
    y: (inViewBox.y - view.ty) / scale,
  };
};

/** World coordinates back to client pixels. */
export const worldToScreen: (
  world: WorldPoint,
  box: ElementBox,
  viewBox: ViewBoxSize,
  view: ViewTransform,
) => ScreenPoint = (
  world: WorldPoint,
  box: ElementBox,
  viewBox: ViewBoxSize,
  view: ViewTransform,
): ScreenPoint => {
  const fit: FitMetrics = fitMetricsForBox(box, viewBox);
  const scale: number = Number.isFinite(view.scale) ? view.scale : 1;
  return {
    x: box.left + fit.offsetX + fit.scale * (view.tx + scale * world.x),
    y: box.top + fit.offsetY + fit.scale * (view.ty + scale * world.y),
  };
};

/**
 * A movement in client pixels, expressed in viewBox units.
 *
 * Deliberately NOT divided by the view scale. The inner transform is
 * `translate(tx ty) scale(s)`, so adding d to tx translates the rendered
 * drawing by exactly d viewBox units whatever s is — which is what
 * "the content follows the pointer one to one" means.
 */
export const screenDeltaToViewBoxDelta: (
  deltaPx: ScreenPoint,
  box: ElementBox,
  viewBox: ViewBoxSize,
) => ScreenPoint = (
  deltaPx: ScreenPoint,
  box: ElementBox,
  viewBox: ViewBoxSize,
): ScreenPoint => {
  const fit: FitMetrics = fitMetricsForBox(box, viewBox);
  if (fit.scale <= 0) {
    return { x: 0, y: 0 };
  }
  return { x: deltaPx.x / fit.scale, y: deltaPx.y / fit.scale };
};

/**
 * A movement in client pixels, expressed in world units.
 *
 * This one IS divided by the view scale: a node's world coordinate has
 * to change by less when the graph is zoomed in, or the node would run
 * away from the pointer that is dragging it.
 */
export const screenDeltaToWorldDelta: (
  deltaPx: ScreenPoint,
  box: ElementBox,
  viewBox: ViewBoxSize,
  view: ViewTransform,
) => WorldPoint = (
  deltaPx: ScreenPoint,
  box: ElementBox,
  viewBox: ViewBoxSize,
  view: ViewTransform,
): WorldPoint => {
  const inViewBox: ScreenPoint = screenDeltaToViewBoxDelta(
    deltaPx,
    box,
    viewBox,
  );
  const scale: number =
    Number.isFinite(view.scale) && view.scale !== 0 ? view.scale : 1;
  return { x: inViewBox.x / scale, y: inViewBox.y / scale };
};

/**
 * Zoom about a fixed point, given in viewBox units.
 *
 * The world point under the anchor stays under the anchor. At a zoom
 * limit the WHOLE transform is returned unchanged rather than just the
 * scale being clamped — clamping only the scale while still recomputing
 * the translation is what made the old implementation creep sideways
 * when the user kept scrolling at maximum zoom.
 */
export const applyZoomAtPoint: (
  view: ViewTransform,
  anchorViewBox: ScreenPoint,
  factor: number,
) => ViewTransform = (
  view: ViewTransform,
  anchorViewBox: ScreenPoint,
  factor: number,
): ViewTransform => {
  if (
    !Number.isFinite(factor) ||
    factor <= 0 ||
    !Number.isFinite(anchorViewBox.x) ||
    !Number.isFinite(anchorViewBox.y)
  ) {
    return view;
  }
  const current: number = Number.isFinite(view.scale) ? view.scale : 1;
  const next: number = clamp(current * factor, MIN_ZOOM, MAX_ZOOM);
  if (next === current) {
    return view;
  }
  const worldX: number = (anchorViewBox.x - view.tx) / current;
  const worldY: number = (anchorViewBox.y - view.ty) / current;
  return {
    scale: next,
    tx: anchorViewBox.x - next * worldX,
    ty: anchorViewBox.y - next * worldY,
  };
};

/** Translate the view by a viewBox-space delta. Never touches scale. */
export const panBy: (
  view: ViewTransform,
  viewBoxDelta: ScreenPoint,
) => ViewTransform = (
  view: ViewTransform,
  viewBoxDelta: ScreenPoint,
): ViewTransform => {
  if (!Number.isFinite(viewBoxDelta.x) || !Number.isFinite(viewBoxDelta.y)) {
    return view;
  }
  return {
    scale: view.scale,
    tx: view.tx + viewBoxDelta.x,
    ty: view.ty + viewBoxDelta.y,
  };
};

/**
 * The bounding box of a set of world points, grown by `padding`.
 *
 * Non-finite points are skipped rather than allowed to poison the
 * result: one NaN would otherwise blank the entire graph by making
 * fit-to-view produce a NaN transform.
 */
export const computeGraphBounds: (
  points: Iterable<WorldPoint>,
  padding: number,
) => WorldBounds | null = (
  points: Iterable<WorldPoint>,
  padding: number,
): WorldBounds | null => {
  let minX: number = Infinity;
  let minY: number = Infinity;
  let maxX: number = -Infinity;
  let maxY: number = -Infinity;
  let seen: boolean = false;

  for (const point of points) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue;
    }
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
    seen = true;
  }

  if (!seen) {
    return null;
  }
  const pad: number = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  return {
    minX: minX - pad,
    minY: minY - pad,
    maxX: maxX + pad,
    maxY: maxY + pad,
  };
};

/**
 * The transform that frames `bounds` inside the viewBox.
 *
 * Uniform on both axes so the graph is never stretched, centred on
 * whichever axis has slack, and safe on degenerate input: a single point
 * (zero span) fits at scale 1 rather than at infinity.
 */
export const fitViewToBounds: (
  bounds: WorldBounds | null,
  viewBox: ViewBoxSize,
) => ViewTransform = (
  bounds: WorldBounds | null,
  viewBox: ViewBoxSize,
): ViewTransform => {
  if (
    !bounds ||
    !Number.isFinite(viewBox.width) ||
    !Number.isFinite(viewBox.height) ||
    viewBox.width <= 0 ||
    viewBox.height <= 0
  ) {
    return IDENTITY_VIEW;
  }

  const spanX: number = bounds.maxX - bounds.minX;
  const spanY: number = bounds.maxY - bounds.minY;
  const usableWidth: number = viewBox.width * (1 - 2 * FIT_PADDING_FRACTION);
  const usableHeight: number = viewBox.height * (1 - 2 * FIT_PADDING_FRACTION);

  const scale: number = clamp(
    Math.min(
      spanX > 1e-6 ? usableWidth / spanX : Number.POSITIVE_INFINITY,
      spanY > 1e-6 ? usableHeight / spanY : Number.POSITIVE_INFINITY,
    ),
    MIN_ZOOM,
    MAX_ZOOM,
  );
  const safeScale: number = Number.isFinite(scale) && scale > 0 ? scale : 1;

  return {
    scale: safeScale,
    tx: (viewBox.width - spanX * safeScale) / 2 - bounds.minX * safeScale,
    ty: (viewBox.height - spanY * safeScale) / 2 - bounds.minY * safeScale,
  };
};

/** True once a press has travelled far enough to count as a drag. */
export const dragThresholdExceeded: (
  origin: ScreenPoint,
  current: ScreenPoint,
  pointerType: "mouse" | "touch" | "pen",
) => boolean = (
  origin: ScreenPoint,
  current: ScreenPoint,
  pointerType: "mouse" | "touch" | "pen",
): boolean => {
  const threshold: number =
    pointerType === "touch" ? TOUCH_DRAG_THRESHOLD_PX : MOUSE_DRAG_THRESHOLD_PX;
  const dx: number = current.x - origin.x;
  const dy: number = current.y - origin.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    return false;
  }
  /*
   * Distance from the ORIGIN, not accumulated travel. The old code summed
   * every frame's movement, so a dozen frames of one-pixel jitter latched
   * the gesture into a drag with the pointer still on the node the user
   * meant to click.
   */
  return dx * dx + dy * dy > threshold * threshold;
};

/*
 * A wheel event's deltaY, normalised to pixels.
 *
 * deltaMode says what unit the browser used: 0 pixels, 1 lines, 2 pages.
 * Firefox reports lines (about 3 per notch) where Chrome reports pixels
 * (about 100), so treating deltaY as pixels everywhere made wheel zoom
 * roughly thirty times slower in Firefox.
 */
export const WHEEL_LINE_HEIGHT_PX: number = 16;

export const normalizeWheelDeltaPx: (
  deltaY: number,
  deltaMode: number,
  viewportHeightPx: number,
) => number = (
  deltaY: number,
  deltaMode: number,
  viewportHeightPx: number,
): number => {
  if (!Number.isFinite(deltaY)) {
    return 0;
  }
  if (deltaMode === 1) {
    return deltaY * WHEEL_LINE_HEIGHT_PX;
  }
  if (deltaMode === 2) {
    const height: number =
      Number.isFinite(viewportHeightPx) && viewportHeightPx > 0
        ? viewportHeightPx
        : 800;
    return deltaY * height;
  }
  return deltaY;
};

/** Two transforms are the same view, within rounding noise. */
export const viewsMatch: (a: ViewTransform, b: ViewTransform) => boolean = (
  a: ViewTransform,
  b: ViewTransform,
): boolean => {
  const epsilon: number = 1e-4;
  return (
    Math.abs(a.scale - b.scale) < epsilon &&
    Math.abs(a.tx - b.tx) < epsilon &&
    Math.abs(a.ty - b.ty) < epsilon
  );
};

/*
 * Guard rail on a coordinate that came from a drag or from persisted
 * state. Keeps a hostile or stale value from reaching an SVG attribute,
 * where a NaN silently removes the element.
 */
export const MAX_WORLD_COORDINATE: number = 100000;

export const clampWorldPoint: (point: WorldPoint) => WorldPoint = (
  point: WorldPoint,
): WorldPoint => {
  return {
    x: clamp(point.x, -MAX_WORLD_COORDINATE, MAX_WORLD_COORDINATE),
    y: clamp(point.y, -MAX_WORLD_COORDINATE, MAX_WORLD_COORDINATE),
  };
};

/** Snap a dragged position to a grid, for tidy manual arrangements. */
export const snapToGrid: (point: WorldPoint, gridSize: number) => WorldPoint = (
  point: WorldPoint,
  gridSize: number,
): WorldPoint => {
  if (!Number.isFinite(gridSize) || gridSize <= 0) {
    return point;
  }
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
};

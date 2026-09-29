/*
 * Keeping a React Flow map on its canvas. React-free, so App/Tests can unit
 * test it under `testEnvironment: "node"` (and so it never drags `react` or
 * `reactflow` into the App compile context).
 *
 * The Service Map draws a whole project, which for a large one is a tall
 * column of cards fitted at a small zoom in a wide canvas. React Flow's
 * defaults let that drawing leave the canvas entirely: pan and zoom are
 * unbounded, so a drag or a zoom about an empty spot carries every card out
 * of view and nothing brings them back (issue #4117). These helpers describe
 * the drawing as boxes in flow coordinates, so the map can keep its viewport
 * on the drawing, tell a real move of the view from rounding noise, and
 * notice when nothing of the drawing is on screen.
 */

/** A node's box in flow coordinates: its position plus its size. */
export interface FlowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** React Flow's viewport transform: [translateX, translateY, zoom]. */
export type FlowTransform = [number, number, number];

/** The canvas (React Flow's pane) in screen pixels. */
export interface FlowPaneSize {
  width: number;
  height: number;
}

/** A React Flow `translateExtent`: [[minX, minY], [maxX, maxY]]. */
export type FlowExtent = [[number, number], [number, number]];

/** React Flow's own default: the viewport may go anywhere. */
export const UNBOUNDED_FLOW_EXTENT: FlowExtent = [
  [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
];

/** React Flow's `Viewport`: where the drawing is and how far zoomed. */
export interface FlowViewportPosition {
  x: number;
  y: number;
  zoom: number;
}

/*
 * The least a gesture has to move the view to count as moving it: more than
 * a click's slop (the drag threshold operating systems use), or a zoom
 * change of one part in a thousand.
 */
export const VIEWPORT_MOVE_TOLERANCE_PX: number = 4;
export const VIEWPORT_ZOOM_TOLERANCE: number = 1e-3;

/**
 * Whether a gesture really moved the view.
 *
 * React Flow reports a move whenever the transform changed at all. d3-zoom
 * re-applies the pan extent on every pointer move, so a press on a map the
 * extent pins in place (the fitted view of a large drawing) comes back a
 * floating-point ulp away from where it started and is reported as a move;
 * on a smaller map the pointer's slip during a click pans it a pixel or
 * two. Neither is the user taking the view.
 */
export function hasViewportMoved(
  from: FlowViewportPosition,
  to: FlowViewportPosition,
): boolean {
  if (
    !Number.isFinite(from.x) ||
    !Number.isFinite(from.y) ||
    !Number.isFinite(from.zoom) ||
    !Number.isFinite(to.x) ||
    !Number.isFinite(to.y) ||
    !Number.isFinite(to.zoom) ||
    from.zoom <= 0 ||
    to.zoom <= 0
  ) {
    // Nothing sensible to compare: treat it as a move, never as noise.
    return true;
  }
  return (
    Math.abs(to.x - from.x) > VIEWPORT_MOVE_TOLERANCE_PX ||
    Math.abs(to.y - from.y) > VIEWPORT_MOVE_TOLERANCE_PX ||
    Math.abs(to.zoom / from.zoom - 1) > VIEWPORT_ZOOM_TOLERANCE
  );
}

/*
 * How much of a node must be on the canvas, in screen pixels on each axis,
 * for the drawing to count as in view. A one-pixel sliver of a card at the
 * canvas edge is not a map anyone can read or find their way back from.
 */
export const MIN_VISIBLE_NODE_PX: number = 8;

/** A box with finite coordinates and a real (non-zero) size. */
export function isDrawnRect(rect: FlowRect | null | undefined): boolean {
  return Boolean(
    rect &&
      Number.isFinite(rect.x) &&
      Number.isFinite(rect.y) &&
      Number.isFinite(rect.width) &&
      Number.isFinite(rect.height) &&
      rect.width > 0 &&
      rect.height > 0,
  );
}

/**
 * The extent the viewport may pan and zoom within: the drawing's bounding
 * box, grown by `margin` flow units on every side.
 *
 * React Flow hands this to d3-zoom, which keeps the visible area inside the
 * extent when the extent is the larger of the two, and centres the extent
 * when the visible area is larger. Either way the visible area overlaps the
 * drawing's bounding box on both axes, as long as `margin` is smaller than
 * the visible area — so the drawing can no longer be dragged or zoomed off
 * the canvas. The box is not the drawing: a layered layout leaves empty
 * corners inside it, and a view zoomed in on one shows no card. That case
 * is what the map's out-of-view notice (see anyRectInView) is for.
 *
 * Boxes that are not drawn (unmeasured, non-finite) are skipped rather than
 * allowed to poison the result. With nothing drawn there is nothing to keep
 * in view, so the extent is unbounded.
 */
export function drawingExtent(
  rects: Iterable<FlowRect>,
  margin: number,
): FlowExtent {
  let minX: number = Number.POSITIVE_INFINITY;
  let minY: number = Number.POSITIVE_INFINITY;
  let maxX: number = Number.NEGATIVE_INFINITY;
  let maxY: number = Number.NEGATIVE_INFINITY;
  let seen: boolean = false;

  for (const rect of rects) {
    if (!isDrawnRect(rect)) {
      continue;
    }
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
    seen = true;
  }

  if (!seen) {
    return UNBOUNDED_FLOW_EXTENT;
  }

  const pad: number = Number.isFinite(margin) ? Math.max(0, margin) : 0;
  return [
    [minX - pad, minY - pad],
    [maxX + pad, maxY + pad],
  ];
}

/** Two extents describe the same area, within rounding noise. */
export function extentsMatch(a: FlowExtent, b: FlowExtent): boolean {
  const same: (x: number, y: number) => boolean = (
    x: number,
    y: number,
  ): boolean => {
    return x === y || Math.abs(x - y) < 1e-6;
  };
  return (
    same(a[0][0], b[0][0]) &&
    same(a[0][1], b[0][1]) &&
    same(a[1][0], b[1][0]) &&
    same(a[1][1], b[1][1])
  );
}

/**
 * Whether any drawn box shows on the canvas: at least `minVisiblePx` screen
 * pixels of it on both axes.
 *
 * A canvas that has no size yet cannot be judged, so it counts as in view.
 * A transform that is not finite puts nothing anywhere, so it does not.
 */
export function anyRectInView(
  rects: Iterable<FlowRect>,
  transform: FlowTransform,
  pane: FlowPaneSize,
  minVisiblePx: number = MIN_VISIBLE_NODE_PX,
): boolean {
  if (
    !Number.isFinite(pane.width) ||
    !Number.isFinite(pane.height) ||
    pane.width <= 0 ||
    pane.height <= 0
  ) {
    return true;
  }

  const [translateX, translateY, zoom] = transform;
  if (
    !Number.isFinite(translateX) ||
    !Number.isFinite(translateY) ||
    !Number.isFinite(zoom) ||
    zoom <= 0
  ) {
    return false;
  }

  const threshold: number =
    Number.isFinite(minVisiblePx) && minVisiblePx > 0 ? minVisiblePx : 0;
  /*
   * A wholly visible node smaller than the threshold must count, so each
   * axis needs min(threshold, the node's own size) — compared with slack
   * for rounding: right - left can come out an ulp below width * zoom.
   */
  const slack: number = 1e-9;

  for (const rect of rects) {
    if (!isDrawnRect(rect)) {
      continue;
    }
    // The box on screen, relative to the canvas's top-left corner.
    const left: number = translateX + rect.x * zoom;
    const top: number = translateY + rect.y * zoom;
    const right: number = left + rect.width * zoom;
    const bottom: number = top + rect.height * zoom;
    const visibleWidth: number =
      Math.min(right, pane.width) - Math.max(left, 0);
    const visibleHeight: number =
      Math.min(bottom, pane.height) - Math.max(top, 0);
    if (
      visibleWidth > 0 &&
      visibleHeight > 0 &&
      visibleWidth + slack >= Math.min(threshold, rect.width * zoom) &&
      visibleHeight + slack >= Math.min(threshold, rect.height * zoom)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * How far to pan along one axis, in screen pixels, to bring a box into
 * view with `padding` to spare: positive moves the drawing right (or
 * down), 0 means it already shows.
 *
 * A box that fits is brought wholly inside. A box longer than the view — a
 * connection can span the whole drawing — only has to show in part, so it
 * is left alone while any of it is in view, and otherwise brought in from
 * the side it is on until it fills the view.
 */
export function panDeltaToReveal(
  start: number,
  end: number,
  viewStart: number,
  viewEnd: number,
  padding: number,
): number {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    !Number.isFinite(viewStart) ||
    !Number.isFinite(viewEnd) ||
    end < start ||
    viewEnd <= viewStart
  ) {
    return 0;
  }
  const viewLength: number = viewEnd - viewStart;
  const pad: number =
    Number.isFinite(padding) && padding > 0
      ? Math.min(padding, viewLength / 4)
      : 0;
  const innerStart: number = viewStart + pad;
  const innerEnd: number = viewEnd - pad;

  if (end - start <= innerEnd - innerStart) {
    if (start < innerStart) {
      return innerStart - start;
    }
    if (end > innerEnd) {
      return innerEnd - end;
    }
    return 0;
  }
  if (end <= innerStart) {
    return innerEnd - end;
  }
  if (start >= innerEnd) {
    return innerStart - start;
  }
  return 0;
}

/**
 * Where a notice goes inside a tall canvas, as an offset from its top: the
 * middle of the part of the canvas that is on screen, so it is seen whether
 * the page shows the canvas's top, its bottom or all of it. Kept `inset`
 * pixels inside the canvas; at the top when none of the canvas is on
 * screen.
 */
export function noticeOffsetInCanvas(
  canvasTop: number,
  canvasHeight: number,
  viewportHeight: number,
  noticeHeight: number,
  inset: number,
): number {
  const margin: number = Number.isFinite(inset) && inset > 0 ? inset : 0;
  if (
    !Number.isFinite(canvasTop) ||
    !Number.isFinite(canvasHeight) ||
    !Number.isFinite(viewportHeight) ||
    canvasHeight <= 0
  ) {
    return margin;
  }
  const height: number =
    Number.isFinite(noticeHeight) && noticeHeight > 0 ? noticeHeight : 0;
  const visibleTop: number = Math.max(canvasTop, 0);
  const visibleBottom: number = Math.min(
    canvasTop + canvasHeight,
    viewportHeight,
  );
  if (visibleBottom <= visibleTop) {
    return margin;
  }
  const middle: number = (visibleTop + visibleBottom) / 2 - canvasTop;
  const lowest: number = Math.max(margin, canvasHeight - height - margin);
  return Math.min(Math.max(middle - height / 2, margin), lowest);
}

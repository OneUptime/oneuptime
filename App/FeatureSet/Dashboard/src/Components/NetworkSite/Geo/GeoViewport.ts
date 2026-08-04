import {
  ROBINSON_VIEW_BOX_HEIGHT,
  ROBINSON_VIEW_BOX_WIDTH,
} from "./GeoProjection";

/*
 * Pure, react-free viewport math for the NetworkSite map: which rectangle of
 * the world the map is currently showing, and how fitting, zooming and
 * panning move it.
 *
 * Kept out of the map component so the math can be imported (and unit-tested)
 * in a plain Node/TypeScript environment — see GeoProjection.ts for why.
 * Everything here is deterministic: same input, same output, no randomness
 * and no clock access.
 *
 * WHY THIS EXISTS
 *
 * The map used to offer a "United States / World" toggle. That is a hardcoded
 * geography preference in a product sold everywhere: half the control is dead
 * weight for a customer in Berlin or Bengaluru, and extending it country by
 * country only moves the arbitrariness. Dropping it and always drawing the
 * whole world is worse, though — a network that lives in one country becomes
 * a smudge, which is exactly why the US view existed.
 *
 * So the map keeps ONE projection and frames itself to wherever the sites
 * actually are. A US-only network gets a US-filling view, a UK-only network
 * gets the UK, a global one gets the globe — and no country is named
 * anywhere in the code or the UI.
 */

/*
 * The rectangle of the Robinson viewBox currently on screen, in viewBox
 * units. Maps directly onto an SVG viewBox attribute.
 */
export interface MapViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

// The whole world: the full Robinson viewBox, and the zoom-1 reference.
export const WORLD_VIEWPORT: MapViewport = {
  x: 0,
  y: 0,
  width: ROBINSON_VIEW_BOX_WIDTH,
  height: ROBINSON_VIEW_BOX_HEIGHT,
};

/**
 * The height that goes with a width, at the world's aspect ratio.
 *
 * Deliberately multiply-then-divide rather than scaling by a precomputed
 * ratio: 960 * (500 / 960) is 500.00000000000006, so a ratio constant makes
 * the whole world fail its own clamp — the frame ends up a hair taller than
 * the world, gets nudged up by that hair, and "0 0 960 500" reaches the DOM
 * as "0 -5.7e-14 960 500.00000000000006". Everything that compares frames
 * (is this already fitted? is this the whole world?) inherits the noise.
 */
const heightForWidth: (width: number) => number = (width: number): number => {
  return (width * ROBINSON_VIEW_BOX_HEIGHT) / ROBINSON_VIEW_BOX_WIDTH;
};

/*
 * Zoom is expressed as magnification relative to the whole-world view, so
 * zoom 1 is the world and zoom 8 shows an eighth of its width.
 *
 * MAX_ZOOM is a trade against the geometry we ship. The detail tier is
 * simplified to 0.04 viewBox units of error (see
 * Scripts/Geo/GenerateMapGeometry.js) — about one screen pixel at zoom 20,
 * and a couple of pixels here. That softening is worth paying for, because
 * the alternative is worse: sites in one metro area are a fraction of a
 * pixel apart at zoom 20, so a reader who zooms in to tell two of them apart
 * hits the stop with the two still on top of each other and no way further
 * in. Country outlines are the BACKDROP; the markers are the subject, and
 * this is the range in which a busy corner of an estate actually comes
 * apart.
 *
 * Beyond that the collision layout is what guarantees markers stay legible
 * (Geo/MarkerLayout.ts) — zoom separates them for real, and the layout holds
 * the picture together until it does.
 */
export const MIN_ZOOM: number = 1;
export const MAX_ZOOM: number = 64;

/*
 * The deepest the map will FRAME ITSELF, as opposed to the deepest a reader
 * may zoom. An estate that sits in one town has a near-zero bounding box, and
 * opening on a single street with no town around it tells nobody anything —
 * the opening view has to carry enough context to be recognisable. Manual
 * zoom goes all the way to MAX_ZOOM from there.
 */
export const FIT_MAX_ZOOM: number = 20;

/*
 * Below this zoom the map draws the small overview outlines; at or above it
 * the larger detail tier is fetched and swapped in. Roughly continent scale —
 * the point where the overview's ~40 km generalization starts to read as
 * chunky rather than as a map.
 */
export const DETAIL_GEOMETRY_MIN_ZOOM: number = 3;

/*
 * How much breathing room a fitted viewport leaves around the sites, as a
 * fraction of the fitted span. Without it, the outermost pins sit exactly on
 * the frame edge with half a marker clipped.
 */
const FIT_PADDING_FRACTION: number = 0.18;

/*
 * Minimum fitted width in viewBox units, before padding. A single site — or
 * several in one city — has a zero-size bounding box, which would otherwise
 * fit to infinite zoom.
 *
 * This is FIT_MAX_ZOOM's frame, not MAX_ZOOM's: how deep a reader may go and
 * how deep the map opens are different questions, and tying them together
 * meant that raising the manual limit silently dropped every one-town estate
 * onto a street corner the moment the page loaded.
 */
const MIN_FIT_WIDTH: number = WORLD_VIEWPORT.width / FIT_MAX_ZOOM;

export interface ViewportPoint {
  x: number;
  y: number;
}

const isFinitePoint: (point: ViewportPoint) => boolean = (
  point: ViewportPoint,
): boolean => {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
};

/**
 * Magnification of a viewport relative to the whole world: 1 is the world,
 * 8 shows an eighth of its width. Degenerate viewports read as 1.
 */
export const zoomOfViewport: (viewport: MapViewport) => number = (
  viewport: MapViewport,
): number => {
  if (!Number.isFinite(viewport.width) || viewport.width <= 0) {
    return 1;
  }
  return WORLD_VIEWPORT.width / viewport.width;
};

/**
 * Force a viewport to be something the map can actually draw: the world's
 * aspect ratio (the SVG box is fixed, so any other ratio would silently
 * letterbox and throw pin positions off), a width within the zoom limits, and
 * a position fully inside the world. Anything non-finite collapses to the
 * whole world.
 *
 * Width is authoritative and height is derived from it — a caller that has
 * only ever gone through this function can never hold a viewport whose two
 * dimensions disagree.
 */
export const clampViewport: (viewport: MapViewport) => MapViewport = (
  viewport: MapViewport,
): MapViewport => {
  if (!Number.isFinite(viewport.width) || viewport.width <= 0) {
    return { ...WORLD_VIEWPORT };
  }

  const width: number = Math.min(
    WORLD_VIEWPORT.width / MIN_ZOOM,
    Math.max(WORLD_VIEWPORT.width / MAX_ZOOM, viewport.width),
  );
  const height: number = heightForWidth(width);

  const x: number = Number.isFinite(viewport.x) ? viewport.x : 0;
  const y: number = Number.isFinite(viewport.y) ? viewport.y : 0;

  return {
    x: Math.min(WORLD_VIEWPORT.width - width, Math.max(0, x)),
    y: Math.min(WORLD_VIEWPORT.height - height, Math.max(0, y)),
    width: width,
    height: height,
  };
};

/**
 * The frame that shows every one of these points with a margin around them —
 * the map's opening view, and what the "Fit to sites" control returns to.
 *
 * No points (or no finite ones) means there is nothing to frame, so the whole
 * world is the honest answer. A cluster too tight to fill the frame is
 * widened to the zoom limit rather than magnified past what the outlines can
 * support.
 */
export const fitViewportToPoints: (
  points: Array<ViewportPoint>,
) => MapViewport = (points: Array<ViewportPoint>): MapViewport => {
  const finite: Array<ViewportPoint> = points.filter(isFinitePoint);
  if (finite.length === 0) {
    return { ...WORLD_VIEWPORT };
  }

  let minX: number = Infinity;
  let maxX: number = -Infinity;
  let minY: number = Infinity;
  let maxY: number = -Infinity;
  for (const point of finite) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  const centerX: number = (minX + maxX) / 2;
  const centerY: number = (minY + maxY) / 2;

  /*
   * Grow the tighter dimension until the box matches the world's aspect
   * ratio — the SVG box is fixed, so a box of any other shape would be
   * letterboxed and the fit would be looser than it looks in one axis.
   */
  const spanX: number = maxX - minX;
  const spanY: number = maxY - minY;
  const width: number = Math.max(
    MIN_FIT_WIDTH,
    spanX * (1 + FIT_PADDING_FRACTION),
    (spanY * (1 + FIT_PADDING_FRACTION) * ROBINSON_VIEW_BOX_WIDTH) /
      ROBINSON_VIEW_BOX_HEIGHT,
  );
  const height: number = heightForWidth(width);

  return clampViewport({
    x: centerX - width / 2,
    y: centerY - height / 2,
    width: width,
    height: height,
  });
};

/**
 * Zoom by `factor` (>1 zooms in) about a focal point in viewBox coordinates,
 * defaulting to the viewport's centre.
 *
 * The focus is held still: whatever is under the pointer stays under the
 * pointer. Once the result hits the world edge the clamp slides it back
 * inside, so a focus near the edge zooms as far as it can and then simply
 * stops moving rather than refusing to zoom.
 */
export const zoomViewport: (
  viewport: MapViewport,
  factor: number,
  focus?: ViewportPoint | undefined,
) => MapViewport = (
  viewport: MapViewport,
  factor: number,
  focus?: ViewportPoint | undefined,
): MapViewport => {
  const current: MapViewport = clampViewport(viewport);
  if (!Number.isFinite(factor) || factor <= 0) {
    return current;
  }

  const width: number = current.width / factor;
  const height: number = current.height / factor;

  const focusPoint: ViewportPoint =
    focus && isFinitePoint(focus)
      ? focus
      : {
          x: current.x + current.width / 2,
          y: current.y + current.height / 2,
        };

  /*
   * Where the focus sits inside the current frame, as a fraction — keeping
   * that fraction constant is what pins it under the pointer.
   */
  const fractionX: number = (focusPoint.x - current.x) / current.width;
  const fractionY: number = (focusPoint.y - current.y) / current.height;

  return clampViewport({
    x: focusPoint.x - fractionX * width,
    y: focusPoint.y - fractionY * height,
    width: width,
    height: height,
  });
};

/**
 * Slide the viewport by a delta in viewBox units, clamped to the world.
 * Zoom is untouched.
 */
export const panViewport: (
  viewport: MapViewport,
  deltaX: number,
  deltaY: number,
) => MapViewport = (
  viewport: MapViewport,
  deltaX: number,
  deltaY: number,
): MapViewport => {
  const current: MapViewport = clampViewport(viewport);
  return clampViewport({
    ...current,
    x: current.x + (Number.isFinite(deltaX) ? deltaX : 0),
    y: current.y + (Number.isFinite(deltaY) ? deltaY : 0),
  });
};

/** The viewport as an SVG `viewBox` attribute value. */
export const viewBoxOfViewport: (viewport: MapViewport) => string = (
  viewport: MapViewport,
): string => {
  const clamped: MapViewport = clampViewport(viewport);
  return `${clamped.x} ${clamped.y} ${clamped.width} ${clamped.height}`;
};

/**
 * Whether two viewports are the same frame, to within a hair of a viewBox
 * unit. Used to decide whether a control is already at its destination (so
 * "Fit to sites" can disable itself when the map is already fitted) without
 * floating-point noise from repeated zoom steps counting as a difference.
 */
export const viewportsMatch: (a: MapViewport, b: MapViewport) => boolean = (
  a: MapViewport,
  b: MapViewport,
): boolean => {
  const epsilon: number = 0.01;
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.width - b.width) < epsilon &&
    Math.abs(a.height - b.height) < epsilon
  );
};

/**
 * Whether a projected point is inside the frame. Edges count as inside, so a
 * pin exactly on the boundary is reported where it is drawn.
 */
export const viewportContainsPoint: (
  viewport: MapViewport,
  point: ViewportPoint,
) => boolean = (viewport: MapViewport, point: ViewportPoint): boolean => {
  if (!isFinitePoint(point)) {
    return false;
  }
  const frame: MapViewport = clampViewport(viewport);
  return (
    point.x >= frame.x &&
    point.x <= frame.x + frame.width &&
    point.y >= frame.y &&
    point.y <= frame.y + frame.height
  );
};

/**
 * How many of these points the frame currently shows.
 *
 * The map says this out loud whenever it is zoomed in. Zooming past a site
 * silently drops it off the map, and a count that no longer matches the
 * network is how somebody concludes a site has disappeared.
 */
export const countPointsInViewport: (
  points: Array<ViewportPoint>,
  viewport: MapViewport,
) => number = (points: Array<ViewportPoint>, viewport: MapViewport): number => {
  const frame: MapViewport = clampViewport(viewport);
  return points.filter((point: ViewportPoint): boolean => {
    return viewportContainsPoint(frame, point);
  }).length;
};

/**
 * Whether the viewport is zoomed far enough in to be worth fetching the
 * detail outlines for.
 */
export const shouldUseDetailGeometry: (viewport: MapViewport) => boolean = (
  viewport: MapViewport,
): boolean => {
  return zoomOfViewport(clampViewport(viewport)) >= DETAIL_GEOMETRY_MIN_ZOOM;
};

/**
 * Convert a length that should stay CONSTANT ON SCREEN — a marker radius, a
 * stroke width, a font size — from screen-relative units into the viewBox
 * units the SVG needs at this zoom.
 *
 * Without this every marker and border grows with the zoom, so zooming in to
 * separate two sites just produces two bigger overlapping blobs.
 */
export const screenLengthToViewportLength: (
  length: number,
  viewport: MapViewport,
) => number = (length: number, viewport: MapViewport): number => {
  if (!Number.isFinite(length)) {
    return 0;
  }
  return length / zoomOfViewport(clampViewport(viewport));
};

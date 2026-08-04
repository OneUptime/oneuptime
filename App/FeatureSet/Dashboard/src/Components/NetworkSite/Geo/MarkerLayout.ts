/*
 * Pure, react-free collision layout for map markers: where each marker is
 * DRAWN, given where it actually belongs.
 *
 * Kept out of the map component so the math can be imported (and unit-tested)
 * in a plain Node/TypeScript environment — see GeoProjection.ts for why.
 *
 * WHY THIS EXISTS
 *
 * A real estate piles markers on top of each other. Two stores in the same
 * retail park, a market whose centroid lands on its parent's, six regions
 * whose derived positions all average out over the same city — every one of
 * those draws N markers at one spot and shows ONE. The others are not merely
 * hard to read: they are unreachable. No hover, no name, no click, and
 * nothing on screen says they are there at all.
 *
 * Zoom alone cannot fix it. Markers are sized in screen units so they do not
 * grow with the map, but two sites a hundred metres apart are still a
 * fraction of a pixel apart at the deepest zoom this map supports — and two
 * derived centroids that landed on the SAME coordinates never separate at
 * any zoom, because there is no distance between them to magnify.
 *
 * So markers that would cover each other are pushed apart until they do not,
 * and every marker that had to move is drawn with a thin line back to the
 * exact spot it belongs to (SiteGeoMap draws the line; this decides the
 * positions). Two rules keep that honest:
 *
 *   - the displacement is the SMALLEST one that clears the overlap. A marker
 *     with room around it does not move at all — its drawn position is
 *     exactly its projected one, to the bit.
 *   - a marker is never pushed further than MAX_MARKER_DISPLACEMENT. Past
 *     that the map would be telling a lie no leader line can undo.
 *
 * Deterministic and order-independent by construction: markers are relaxed in
 * a canonical order (by key), markers that share a point exactly are seeded
 * along golden-angle rays derived from that order, and there is no randomness
 * and no clock access. The same markers at the same zoom always lay out the
 * same way — which is what keeps the map from twitching every time the page's
 * 60-second poll hands over a fresh array.
 */

// A marker to place. Position is viewBox units; radius is SCREEN units.
export interface CollidableMarker {
  // Stable identity: the placement comes back under this key.
  key: string;
  x: number;
  y: number;
  /*
   * The radius that has to stay clear of every other marker's, in SCREEN
   * units — the same units MapMarker.screenRadius is in. A marker drawn as
   * a square passes the radius of the circle that contains it, so two
   * squares cannot touch corner to corner.
   */
  radius: number;
}

export interface MarkerPlacement {
  key: string;
  // Where the marker is DRAWN, in viewBox units.
  x: number;
  y: number;
  // Where it belongs, in viewBox units — what the leader line points at.
  anchorX: number;
  anchorY: number;
  /*
   * Whether this marker's anchor is worth drawing a line to: it has moved
   * far enough that the spot it belongs to is no longer UNDER the marker.
   *
   * A marker nudged by less than its own radius still covers its true
   * position, so a line and a dot there would be drawn entirely beneath the
   * marker — ink nobody can see, and a legend entry explaining a line that
   * is not on screen. It is a real displacement either way; it just does not
   * need explaining.
   */
  needsLeaderLine: boolean;
}

/*
 * Clear space left between two marker edges, in screen units. Markers that
 * merely touch still read as one blob, and each one carries a soft halo a
 * couple of pixels wide that would otherwise be swallowed.
 */
export const MARKER_CLEARANCE: number = 3;

/*
 * How far a marker may be pushed from where it belongs, in screen units.
 * Roughly 90 minimum-size markers fit inside a disc this size, which covers
 * every pile-up a level realistically has; a denser one keeps some overlap
 * rather than scattering markers across a county they are not in.
 */
export const MAX_MARKER_DISPLACEMENT: number = 72;

/*
 * Below this (screen units) a marker has not visibly moved at all, so it
 * gets no leader line whatever its size. Its position is still the resolved
 * one — snapping it back would put the overlap back.
 */
export const MIN_VISIBLE_DISPLACEMENT: number = 1.5;

/*
 * Past this many markers the map is a texture rather than a set of things to
 * click, and the relaxation would run on every wheel tick of a zoom. The
 * layout steps aside rather than make a drag stutter for a picture where
 * moving a marker by a few pixels changes nothing anybody can see.
 */
export const MAX_LAID_OUT_MARKERS: number = 2500;

/*
 * Relaxation budget. Settling is the normal exit — these bound the work when
 * a pile-up is too dense to resolve inside MAX_MARKER_DISPLACEMENT and the
 * passes would otherwise keep nibbling at it forever.
 *
 * The budget is spent per MARKER rather than per pass, because a pass costs
 * what the map holds: a level with a dozen markers can afford to be relaxed
 * until it is perfect, and a thousand-marker "all sites" view cannot — it is
 * laid out again on every wheel tick of a zoom, and a map that stutters
 * under a drag is a worse map than one with a couple of overlaps left in a
 * crowd of a thousand.
 */
const MAX_RELAX_PASSES: number = 120;
const MIN_RELAX_PASSES: number = 12;
const RELAX_MARKER_VISITS: number = 24_000;

// Total movement in one pass below which the layout counts as settled.
const SETTLED_MOVEMENT: number = 0.01;

/*
 * Markers at EXACTLY the same point have no direction to be pushed apart in,
 * so each is first nudged a hair along its own ray. The golden angle spreads
 * consecutive rays as evenly as an angle can, and the index comes from the
 * canonical key order, so the fan is the same on every render.
 */
const GOLDEN_ANGLE: number = Math.PI * (3 - Math.sqrt(5));
const COINCIDENT_NUDGE: number = 0.01;

// Distance below which two markers count as being at the same point.
const COINCIDENT_EPSILON: number = 1e-9;

const compareKeys: (a: string, b: string) => number = (
  a: string,
  b: string,
): number => {
  // Plain code-unit comparison — localeCompare depends on the runtime locale.
  return a < b ? -1 : a > b ? 1 : 0;
};

/*
 * Bucket id for a grid cell. A numeric hash rather than the obvious "x:y"
 * string: the grid is rebuilt on every relaxation pass, and building
 * thousands of throwaway strings per pass costs more than every distance
 * check in the layout put together.
 *
 * Two different cells hashing the same is HARMLESS — a bucket is a set of
 * candidates, and every candidate is distance-checked anyway. It can only
 * ever add work, never hide a collision, because inserts and lookups run the
 * same function over the same cell coordinates.
 */
const cellHash: (cellX: number, cellY: number) => number = (
  cellX: number,
  cellY: number,
): number => {
  return (Math.imul(cellX, 73_856_093) ^ Math.imul(cellY, 19_349_663)) | 0;
};

/*
 * One marker mid-relaxation. Everything here is in SCREEN units: overlap is
 * a screen-space question (that is the whole reason marker radii are screen
 * units), so the math is done there and converted back once at the end.
 */
interface RelaxItem {
  key: string;
  anchorX: number;
  anchorY: number;
  x: number;
  y: number;
  radius: number;
  /*
   * How much of a shared push this marker absorbs. Heavier markers move
   * less, so a region standing for 300 units keeps its position and the
   * single store next to it steps aside — the reader's eye is on the big
   * one, and it is the one whose position carries the most meaning.
   */
  mass: number;
  // Its ray out of a coincident pile, from the canonical order.
  seedAngle: number;
}

const isFiniteMarker: (marker: CollidableMarker) => boolean = (
  marker: CollidableMarker,
): boolean => {
  return Number.isFinite(marker.x) && Number.isFinite(marker.y);
};

const safeRadius: (radius: number) => number = (radius: number): number => {
  return Number.isFinite(radius) && radius > 0 ? radius : 0;
};

/**
 * Push two overlapping markers apart, in place. Returns how far they moved
 * in total, so the caller can tell when the layout has settled.
 *
 * The pair is separated to exactly the distance it needs and no further, and
 * the two share the correction in inverse proportion to their mass.
 */
const separate: (a: RelaxItem, b: RelaxItem) => number = (
  a: RelaxItem,
  b: RelaxItem,
): number => {
  const required: number = a.radius + b.radius + MARKER_CLEARANCE;
  let deltaX: number = b.x - a.x;
  let deltaY: number = b.y - a.y;
  let distance: number = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

  if (distance >= required) {
    return 0;
  }

  if (distance < COINCIDENT_EPSILON) {
    /*
     * The same point to the bit. The seeding in the caller normally prevents
     * this, so this is the safety net for a pair that a third marker has
     * pushed onto each other — separate them along a direction built from
     * both of their rays, which is the same on every render.
     */
    const angle: number = a.seedAngle + b.seedAngle + GOLDEN_ANGLE;
    deltaX = Math.cos(angle) * COINCIDENT_NUDGE;
    deltaY = Math.sin(angle) * COINCIDENT_NUDGE;
    distance = COINCIDENT_NUDGE;
  }

  const overlap: number = required - distance;
  const unitX: number = deltaX / distance;
  const unitY: number = deltaY / distance;

  const totalMass: number = a.mass + b.mass;
  // Equal split when neither has any mass to speak of.
  const shareOfA: number = totalMass > 0 ? b.mass / totalMass : 0.5;
  const shareOfB: number = 1 - shareOfA;

  a.x -= unitX * overlap * shareOfA;
  a.y -= unitY * overlap * shareOfA;
  b.x += unitX * overlap * shareOfB;
  b.y += unitY * overlap * shareOfB;

  return overlap;
};

/**
 * Pull a marker back onto the disc of allowed displacement around its
 * anchor. Returns how far it had to be pulled.
 */
const clampToAnchor: (item: RelaxItem) => number = (
  item: RelaxItem,
): number => {
  const deltaX: number = item.x - item.anchorX;
  const deltaY: number = item.y - item.anchorY;
  const distance: number = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  if (distance <= MAX_MARKER_DISPLACEMENT || distance === 0) {
    return 0;
  }
  const scale: number = MAX_MARKER_DISPLACEMENT / distance;
  item.x = item.anchorX + deltaX * scale;
  item.y = item.anchorY + deltaY * scale;
  return distance - MAX_MARKER_DISPLACEMENT;
};

/**
 * One relaxation pass over every overlapping pair.
 *
 * Pairs are found through a uniform grid whose cell is the largest distance
 * two markers can be required to keep — so two markers that are too close
 * are always within one cell of each other, and checking the 3x3 block
 * around a marker finds every pair it could be colliding with. That is what
 * keeps a pass linear in the number of markers instead of quadratic: a
 * thousand-marker map cannot afford a million distance checks on every wheel
 * tick of a zoom.
 *
 * `reversed` flips the sweep direction. A pass carries a correction about
 * one marker along a run of overlapping ones, so sweeping the same way every
 * time makes a long row of markers unpack from one end at one marker per
 * pass — which is how a perfectly resolvable row runs out of budget with an
 * overlap still in it. Alternating the direction walks the correction back
 * the other way and settles a row in a handful of passes.
 */
const relaxPass: (
  items: Array<RelaxItem>,
  cellSize: number,
  reversed: boolean,
) => number = (
  items: Array<RelaxItem>,
  cellSize: number,
  reversed: boolean,
): number => {
  const buckets: Map<number, Array<number>> = new Map<number, Array<number>>();
  for (let index: number = 0; index < items.length; index++) {
    const item: RelaxItem = items[index]!;
    const key: number = cellHash(
      Math.floor(item.x / cellSize),
      Math.floor(item.y / cellSize),
    );
    const bucket: Array<number> | undefined = buckets.get(key);
    if (bucket) {
      bucket.push(index);
    } else {
      buckets.set(key, [index]);
    }
  }

  let movement: number = 0;

  for (let step: number = 0; step < items.length; step++) {
    const index: number = reversed ? items.length - 1 - step : step;
    const item: RelaxItem = items[index]!;
    const cellX: number = Math.floor(item.x / cellSize);
    const cellY: number = Math.floor(item.y / cellSize);
    for (let offsetX: number = -1; offsetX <= 1; offsetX++) {
      for (let offsetY: number = -1; offsetY <= 1; offsetY++) {
        const bucket: Array<number> | undefined = buckets.get(
          cellHash(cellX + offsetX, cellY + offsetY),
        );
        if (!bucket) {
          continue;
        }
        for (const other of bucket) {
          // Each pair once, and never a marker against itself.
          if (other <= index) {
            continue;
          }
          movement += separate(item, items[other]!);
        }
      }
    }
  }

  for (const item of items) {
    movement += clampToAnchor(item);
  }

  return movement;
};

/**
 * Decide where every marker is drawn so that none of them covers another.
 *
 * `zoom` is the map's magnification (see GeoViewport.zoomOfViewport): marker
 * radii are screen units and positions are viewBox units, and the zoom is
 * what relates the two. Zooming in therefore separates markers on its own,
 * and the displacement quietly falls to zero — the layout only ever moves
 * what genuinely overlaps at the zoom being drawn.
 *
 * Every marker gets exactly one placement, in the input's order, with its
 * anchor set to where it actually belongs. Markers whose coordinates are not
 * finite are passed straight through: they cannot collide with anything, and
 * this is not the place that decides whether they are drawn.
 */
export const resolveMarkerCollisions: (
  markers: Array<CollidableMarker>,
  zoom: number,
) => Array<MarkerPlacement> = (
  markers: Array<CollidableMarker>,
  zoom: number,
): Array<MarkerPlacement> => {
  const safeZoom: number = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;

  const identity: (marker: CollidableMarker) => MarkerPlacement = (
    marker: CollidableMarker,
  ): MarkerPlacement => {
    return {
      key: marker.key,
      x: marker.x,
      y: marker.y,
      anchorX: marker.x,
      anchorY: marker.y,
      needsLeaderLine: false,
    };
  };

  if (markers.length < 2 || markers.length > MAX_LAID_OUT_MARKERS) {
    return markers.map(identity);
  }

  /*
   * Canonical order, so the layout does not depend on paint order. Two
   * renders that draw the same markers in a different sequence — a re-sort,
   * a poll that reordered the payload — must produce the same picture.
   */
  const ordered: Array<CollidableMarker> = markers
    .filter(isFiniteMarker)
    .slice()
    .sort((a: CollidableMarker, b: CollidableMarker): number => {
      return compareKeys(a.key, b.key);
    });

  if (ordered.length < 2) {
    return markers.map(identity);
  }

  const items: Array<RelaxItem> = ordered.map(
    (marker: CollidableMarker, index: number): RelaxItem => {
      const radius: number = safeRadius(marker.radius);
      return {
        key: marker.key,
        anchorX: marker.x * safeZoom,
        anchorY: marker.y * safeZoom,
        x: marker.x * safeZoom,
        y: marker.y * safeZoom,
        radius: radius,
        // Area, so weight tracks how much of the map a marker is claiming.
        mass: radius * radius,
        seedAngle: index * GOLDEN_ANGLE,
      };
    },
  );

  /*
   * Markers sharing a point exactly have no direction to be separated in, so
   * fan them out by a hair first. Only the markers that need it are touched
   * — everything else must keep its projected position to the bit, or a map
   * with nothing overlapping on it would still redraw every marker slightly
   * off where the customer pinned it.
   */
  const atPoint: Map<string, Array<number>> = new Map<string, Array<number>>();
  for (let index: number = 0; index < items.length; index++) {
    const item: RelaxItem = items[index]!;
    const key: string = `${item.x}:${item.y}`;
    const bucket: Array<number> | undefined = atPoint.get(key);
    if (bucket) {
      bucket.push(index);
    } else {
      atPoint.set(key, [index]);
    }
  }
  for (const bucket of atPoint.values()) {
    if (bucket.length < 2) {
      continue;
    }
    for (const index of bucket) {
      const item: RelaxItem = items[index]!;
      item.x += Math.cos(item.seedAngle) * COINCIDENT_NUDGE;
      item.y += Math.sin(item.seedAngle) * COINCIDENT_NUDGE;
    }
  }

  let maxRadius: number = 0;
  for (const item of items) {
    maxRadius = Math.max(maxRadius, item.radius);
  }
  /*
   * The largest separation any pair can be required to keep. Anything closer
   * than this is inside the 3x3 block the pass scans, so no collision can
   * hide between cells.
   */
  const cellSize: number = Math.max(
    2 * maxRadius + MARKER_CLEARANCE,
    COINCIDENT_NUDGE,
  );

  const passes: number = Math.max(
    MIN_RELAX_PASSES,
    Math.min(MAX_RELAX_PASSES, Math.ceil(RELAX_MARKER_VISITS / items.length)),
  );
  for (let pass: number = 0; pass < passes; pass++) {
    if (relaxPass(items, cellSize, pass % 2 === 1) <= SETTLED_MOVEMENT) {
      break;
    }
  }

  const placed: Map<string, RelaxItem> = new Map<string, RelaxItem>();
  for (const item of items) {
    placed.set(item.key, item);
  }

  return markers.map((marker: CollidableMarker): MarkerPlacement => {
    const item: RelaxItem | undefined = placed.get(marker.key);
    if (!item || !isFiniteMarker(marker)) {
      return identity(marker);
    }
    const deltaX: number = item.x - item.anchorX;
    const deltaY: number = item.y - item.anchorY;
    const distance: number = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    /*
     * Nothing moved: hand back the anchor itself rather than a value that
     * has been through a multiply and a divide, so an untouched marker is
     * bit-for-bit where it was projected.
     */
    if (distance === 0) {
      return identity(marker);
    }
    return {
      key: marker.key,
      x: item.x / safeZoom,
      y: item.y / safeZoom,
      anchorX: marker.x,
      anchorY: marker.y,
      /*
       * A line is only worth drawing once the spot this marker belongs to is
       * out from under it. Nudged by less than its own radius, the marker is
       * still sitting on its own coordinates and the line would be buried
       * beneath it.
       */
      needsLeaderLine:
        distance >= MIN_VISIBLE_DISPLACEMENT && distance > item.radius,
    };
  });
};

import { CorrelationGraphEdge, CorrelationGraphNode } from "./CorrelationGraph";
import { LayoutPoint } from "./LayeredGraphLayout";

/*
 * Hub-and-spoke layout for Security Events → Correlate: the applied filter
 * sits at the origin, event classes on an inner ellipse around it, and
 * co-occurring observables on an outer ellipse, each one pulled toward the
 * classes it appeared in.
 *
 * The generic layered layout stacks every observable on one row, so a
 * correlation with a few dozen observables became thousands of pixels wide
 * and fit-to-view shrank the text past reading. Rings grow with the number
 * of nodes instead, and the hub stays in the middle — so a clamped zoom
 * still frames the part that matters.
 *
 * Returned points are node CENTRES (render with nodeOrigin [0.5, 0.5]).
 * Pure and deterministic: the same graph always lands in the same place.
 */

export interface CorrelationLayoutOptions {
  // Smallest inner-ring radius, before the ellipse stretch.
  minClassRadius?: number | undefined;
  // Arc length each class node needs on the inner ring.
  classSpacing?: number | undefined;
  // Distance between the class ring and the observable ring.
  ringGap?: number | undefined;
  /*
   * Arc each observable needs on the outer ring, measured on the unstretched
   * radius. Neighbours at the top and bottom sit side by side, so this has
   * to clear a node's width once the ellipse stretch is applied.
   */
  observableSpacing?: number | undefined;
  // The same, once observables alternate between two radii.
  staggeredObservableSpacing?: number | undefined;
  /*
   * From this many observables on, alternate them between two radii so
   * neighbours can sit closer together without their labels colliding.
   */
  staggerThreshold?: number | undefined;
  // Radial distance between the two staggered observable rings.
  staggerOffset?: number | undefined;
  // Horizontal stretch — canvases are wider than they are tall.
  horizontalStretch?: number | undefined;
}

// Every option resolved to a number.
type CorrelationLayoutSettings = {
  [Key in keyof CorrelationLayoutOptions]-?: NonNullable<
    CorrelationLayoutOptions[Key]
  >;
};

const DEFAULTS: CorrelationLayoutSettings = {
  minClassRadius: 170,
  classSpacing: 170,
  ringGap: 170,
  observableSpacing: 115,
  staggeredObservableSpacing: 60,
  staggerThreshold: 10,
  staggerOffset: 90,
  horizontalStretch: 1.6,
};

const TWO_PI: number = Math.PI * 2;

// Angles start at the top of the ring and run clockwise on screen.
const START_ANGLE: number = -Math.PI / 2;

function normalizeAngle(angle: number): number {
  const wrapped: number = angle % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

function roundPoint(x: number, y: number): LayoutPoint {
  /*
   * Whole pixels keep the output stable across floating-point noise, and
   * `|| 0` folds the -0 that cos/sin leave at the ring's poles.
   */
  return { x: Math.round(x) || 0, y: Math.round(y) || 0 };
}

interface Slot {
  id: string;
  preferred: number;
}

/*
 * Least-squares placement of ordered items on a line with a minimum gap:
 * overlapping neighbours merge into blocks centred on the mean of their
 * preferred positions, until no two blocks overlap. Ordering is preserved.
 */
function spreadOnLine(preferred: Array<number>, minGap: number): Array<number> {
  interface Block {
    start: number;
    count: number;
    sum: number;
  }

  const blocks: Array<Block> = [];

  for (let index: number = 0; index < preferred.length; index++) {
    blocks.push({ start: index, count: 1, sum: preferred[index]! });

    // Merge backwards while the newest block overlaps its predecessor.
    while (blocks.length > 1) {
      const current: Block = blocks[blocks.length - 1]!;
      const previous: Block = blocks[blocks.length - 2]!;
      const previousEnd: number =
        previous.sum / previous.count + ((previous.count - 1) / 2) * minGap;
      const currentStart: number =
        current.sum / current.count - ((current.count - 1) / 2) * minGap;

      if (currentStart - previousEnd >= minGap) {
        break;
      }

      /*
       * The merged block's centre is the mean of each item's preferred
       * position minus its offset inside the block — the least-squares
       * optimum for keeping every item as close to its preference as the
       * gap allows.
       */
      const start: number = previous.start;
      const count: number = previous.count + current.count;
      let sum: number = 0;
      for (
        let itemIndex: number = start;
        itemIndex < start + count;
        itemIndex++
      ) {
        const offset: number = (itemIndex - start - (count - 1) / 2) * minGap;
        sum += preferred[itemIndex]! - offset;
      }
      const merged: Block = { start, count, sum };

      blocks.pop();
      blocks.pop();
      blocks.push(merged);
    }
  }

  const positions: Array<number> = [];
  for (const block of blocks) {
    const centre: number = block.sum / block.count;
    for (
      let offsetIndex: number = 0;
      offsetIndex < block.count;
      offsetIndex++
    ) {
      positions.push(centre + (offsetIndex - (block.count - 1) / 2) * minGap);
    }
  }
  return positions;
}

/*
 * Spread items around a full circle: cut the circle at the widest gap in
 * the preferred angles, unroll, spread on the line, and — if the ends now
 * collide across the cut — fall back to one block centred on the circular
 * mean.
 */
function spreadOnCircle(
  slots: Array<Slot>,
  minGap: number,
): Map<string, number> {
  const result: Map<string, number> = new Map<string, number>();
  if (slots.length === 0) {
    return result;
  }

  const sorted: Array<Slot> = [...slots].sort((a: Slot, b: Slot): number => {
    if (a.preferred !== b.preferred) {
      return a.preferred - b.preferred;
    }
    return a.id.localeCompare(b.id);
  });

  if (sorted.length === 1) {
    result.set(sorted[0]!.id, sorted[0]!.preferred);
    return result;
  }

  // Find the widest gap between consecutive preferred angles (with wrap).
  let widestGap: number = -1;
  let cutAfter: number = sorted.length - 1;
  for (let index: number = 0; index < sorted.length; index++) {
    const current: number = sorted[index]!.preferred;
    const next: number =
      index === sorted.length - 1
        ? sorted[0]!.preferred + TWO_PI
        : sorted[index + 1]!.preferred;
    const gap: number = next - current;
    if (gap > widestGap + 1e-9) {
      widestGap = gap;
      cutAfter = index;
    }
  }

  const ordered: Array<Slot> = [];
  const unrolled: Array<number> = [];
  for (let step: number = 1; step <= sorted.length; step++) {
    const index: number = (cutAfter + step) % sorted.length;
    const slot: Slot = sorted[index]!;
    let angle: number = slot.preferred;
    if (unrolled.length > 0 && angle < unrolled[unrolled.length - 1]!) {
      angle += TWO_PI;
    }
    ordered.push(slot);
    unrolled.push(angle);
  }

  let spread: Array<number> = spreadOnLine(unrolled, minGap);

  const span: number = spread[spread.length - 1]! - spread[0]!;
  if (span > TWO_PI - minGap) {
    // Wrapped into itself: one evenly spaced block around the mean.
    const mean: number =
      unrolled.reduce((total: number, value: number) => {
        return total + value;
      }, 0) / unrolled.length;
    const evenGap: number = TWO_PI / ordered.length;
    spread = ordered.map((_slot: Slot, index: number): number => {
      return mean + (index - (ordered.length - 1) / 2) * evenGap;
    });
  }

  ordered.forEach((slot: Slot, index: number) => {
    result.set(slot.id, normalizeAngle(spread[index]!));
  });

  return result;
}

export default function computeCorrelationLayout(
  nodes: Array<Pick<CorrelationGraphNode, "id" | "kind">>,
  edges: Array<Pick<CorrelationGraphEdge, "from" | "to" | "count">>,
  options?: CorrelationLayoutOptions,
): Map<string, LayoutPoint> {
  // Field by field: an explicit `undefined` option still means "default".
  const settings: CorrelationLayoutSettings = {
    minClassRadius: options?.minClassRadius ?? DEFAULTS.minClassRadius,
    classSpacing: options?.classSpacing ?? DEFAULTS.classSpacing,
    ringGap: options?.ringGap ?? DEFAULTS.ringGap,
    observableSpacing: options?.observableSpacing ?? DEFAULTS.observableSpacing,
    staggeredObservableSpacing:
      options?.staggeredObservableSpacing ??
      DEFAULTS.staggeredObservableSpacing,
    staggerThreshold: options?.staggerThreshold ?? DEFAULTS.staggerThreshold,
    staggerOffset: options?.staggerOffset ?? DEFAULTS.staggerOffset,
    horizontalStretch: options?.horizontalStretch ?? DEFAULTS.horizontalStretch,
  };

  const positions: Map<string, LayoutPoint> = new Map<string, LayoutPoint>();
  if (nodes.length === 0) {
    return positions;
  }

  const stretch: number = settings.horizontalStretch;

  const centerNodes: Array<string> = [];
  const classNodes: Array<string> = [];
  const observableNodes: Array<string> = [];
  for (const node of nodes) {
    if (node.kind === "center") {
      centerNodes.push(node.id);
    } else if (node.kind === "class") {
      classNodes.push(node.id);
    } else {
      observableNodes.push(node.id);
    }
  }

  for (const centerId of centerNodes) {
    positions.set(centerId, roundPoint(0, 0));
  }

  // Inner ring: classes evenly spaced, first one at the top.
  const classCount: number = classNodes.length;
  const classRadius: number = Math.max(
    settings.minClassRadius,
    (classCount * settings.classSpacing) / TWO_PI,
  );
  const classAngles: Map<string, number> = new Map<string, number>();
  classNodes.forEach((classId: string, index: number) => {
    const angle: number = START_ANGLE + (TWO_PI * index) / classCount;
    classAngles.set(classId, angle);
    positions.set(
      classId,
      roundPoint(
        Math.cos(angle) * classRadius * stretch,
        Math.sin(angle) * classRadius,
      ),
    );
  });

  if (observableNodes.length === 0) {
    return positions;
  }

  /*
   * Each observable prefers the weighted circular mean of the angles of
   * the classes it co-occurred with. An observable with no class edge (or
   * whose pulls cancel out) prefers the top.
   */
  const pullX: Map<string, number> = new Map<string, number>();
  const pullY: Map<string, number> = new Map<string, number>();
  for (const edge of edges) {
    const classAngle: number | undefined = classAngles.get(edge.from);
    if (classAngle === undefined) {
      continue;
    }
    const weight: number = Math.max(1, edge.count);
    pullX.set(
      edge.to,
      (pullX.get(edge.to) || 0) + Math.cos(classAngle) * weight,
    );
    pullY.set(
      edge.to,
      (pullY.get(edge.to) || 0) + Math.sin(classAngle) * weight,
    );
  }

  const slots: Array<Slot> = observableNodes.map((observableId: string) => {
    const x: number = pullX.get(observableId) || 0;
    const y: number = pullY.get(observableId) || 0;
    const preferred: number =
      Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9
        ? normalizeAngle(START_ANGLE)
        : normalizeAngle(Math.atan2(y, x));
    return { id: observableId, preferred };
  });

  const isStaggered: boolean =
    observableNodes.length >= settings.staggerThreshold;
  const observableCount: number = observableNodes.length;

  /*
   * Size the outer ring so every observable gets its arc. Staggered rings
   * interleave — neighbours on the same radius are two slots apart — so
   * each slot can be narrower.
   */
  const spacing: number = isStaggered
    ? settings.staggeredObservableSpacing
    : settings.observableSpacing;
  const baseRadius: number = classRadius + settings.ringGap;
  const requiredRadius: number = (observableCount * spacing) / (TWO_PI * 0.92);
  const observableRadius: number = Math.max(baseRadius, requiredRadius);
  const minGap: number = spacing / observableRadius;

  const angles: Map<string, number> = spreadOnCircle(slots, minGap);

  // Stagger by angular order so alternating neighbours swap radius.
  const byAngle: Array<Slot> = [...slots].sort((a: Slot, b: Slot): number => {
    const angleA: number = angles.get(a.id) || 0;
    const angleB: number = angles.get(b.id) || 0;
    if (angleA !== angleB) {
      return angleA - angleB;
    }
    return a.id.localeCompare(b.id);
  });

  byAngle.forEach((slot: Slot, index: number) => {
    const angle: number = angles.get(slot.id) || 0;
    const radius: number =
      isStaggered && index % 2 === 1
        ? observableRadius + settings.staggerOffset
        : observableRadius;
    positions.set(
      slot.id,
      roundPoint(Math.cos(angle) * radius * stretch, Math.sin(angle) * radius),
    );
  });

  return positions;
}

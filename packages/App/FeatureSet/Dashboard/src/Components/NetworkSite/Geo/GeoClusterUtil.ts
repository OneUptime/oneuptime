/*
 * Pure, react-free grid-bucket clustering for map pins.
 *
 * Kept out of the map components so it can be imported (and unit-tested) in
 * a plain Node/TypeScript environment — see GeoProjection.ts for why.
 *
 * Deterministic by construction: buckets are keyed by integer grid cell,
 * clusters are emitted sorted by cell row then cell column, and member ids
 * are sorted lexicographically — the same points always produce the same
 * clusters in the same order, regardless of input order. No randomness.
 */

// A projected point to cluster. Coordinates are viewBox pixels.
export interface GeoClusterPoint {
  id: string;
  x: number;
  y: number;
  /*
   * Numeric severity of the point's health status. Convention: HIGHER means
   * WORSE — callers must encode their status scale accordingly so that the
   * cluster can surface the worst member status.
   */
  statusPriority: number;
  // How many underlying items this point represents. Defaults to 1.
  count?: number | undefined;
}

// A cluster of one or more points that share a grid cell.
export interface GeoCluster {
  // Mean position of the member points, in viewBox pixels.
  x: number;
  y: number;
  // Member point ids, sorted lexicographically.
  ids: Array<string>;
  // The maximum (= worst, see GeoClusterPoint) member statusPriority.
  worstStatusPriority: number;
  // Sum of member counts (each point defaults to 1).
  totalCount: number;
}

interface MutableCluster {
  cellX: number;
  cellY: number;
  sumX: number;
  sumY: number;
  ids: Array<string>;
  worstStatusPriority: number;
  totalCount: number;
}

const compareStrings: (a: string, b: string) => number = (
  a: string,
  b: string,
): number => {
  // Plain code-unit comparison — localeCompare depends on the runtime locale.
  return a < b ? -1 : a > b ? 1 : 0;
};

/**
 * Bucket projected points into square grid cells of `cellSize` pixels and
 * merge every cell's points into one cluster positioned at their mean.
 *
 * Points with non-finite coordinates are skipped (they cannot be bucketed).
 * A non-finite or non-positive cellSize falls back to 1. Clusters are
 * returned sorted by grid row, then grid column.
 */
export const clusterPoints: (
  points: Array<GeoClusterPoint>,
  cellSize: number,
) => Array<GeoCluster> = (
  points: Array<GeoClusterPoint>,
  cellSize: number,
): Array<GeoCluster> => {
  const size: number = Number.isFinite(cellSize) && cellSize > 0 ? cellSize : 1;

  const buckets: Map<string, MutableCluster> = new Map();

  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue;
    }

    const cellX: number = Math.floor(point.x / size);
    const cellY: number = Math.floor(point.y / size);
    const key: string = `${cellX}:${cellY}`;

    const count: number = point.count ?? 1;

    const existing: MutableCluster | undefined = buckets.get(key);
    if (existing) {
      existing.sumX += point.x;
      existing.sumY += point.y;
      existing.ids.push(point.id);
      existing.worstStatusPriority = Math.max(
        existing.worstStatusPriority,
        point.statusPriority,
      );
      existing.totalCount += count;
    } else {
      buckets.set(key, {
        cellX: cellX,
        cellY: cellY,
        sumX: point.x,
        sumY: point.y,
        ids: [point.id],
        worstStatusPriority: point.statusPriority,
        totalCount: count,
      });
    }
  }

  const clusters: Array<MutableCluster> = Array.from(buckets.values());

  clusters.sort((a: MutableCluster, b: MutableCluster): number => {
    if (a.cellY !== b.cellY) {
      return a.cellY - b.cellY;
    }
    return a.cellX - b.cellX;
  });

  return clusters.map((cluster: MutableCluster): GeoCluster => {
    return {
      x: cluster.sumX / cluster.ids.length,
      y: cluster.sumY / cluster.ids.length,
      ids: cluster.ids.slice().sort(compareStrings),
      worstStatusPriority: cluster.worstStatusPriority,
      totalCount: cluster.totalCount,
    };
  });
};

import { describe, expect, test } from "@jest/globals";
import {
  GeoCluster,
  GeoClusterPoint,
  clusterPoints,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/Geo/GeoClusterUtil";

/*
 * Pins the grid-bucket pin clustering used by the NetworkSite map views:
 * bucketing, worst-status propagation (higher statusPriority = worse), count
 * aggregation and — critically — determinism, since the map re-renders from
 * the same data and must never reshuffle clusters.
 */

function point(
  id: string,
  x: number,
  y: number,
  statusPriority: number = 0,
  count?: number,
): GeoClusterPoint {
  if (count === undefined) {
    return { id, x, y, statusPriority };
  }
  return { id, x, y, statusPriority, count };
}

describe("clusterPoints", () => {
  test("empty input yields no clusters", () => {
    expect(clusterPoints([], 40)).toEqual([]);
  });

  test("a lone point becomes a cluster at its own position", () => {
    const clusters: Array<GeoCluster> = clusterPoints(
      [point("a", 12.5, 30.25, 2)],
      40,
    );
    expect(clusters).toEqual([
      {
        x: 12.5,
        y: 30.25,
        ids: ["a"],
        worstStatusPriority: 2,
        totalCount: 1,
      },
    ]);
  });

  test("points sharing a grid cell merge into one cluster at their mean", () => {
    const clusters: Array<GeoCluster> = clusterPoints(
      [point("b", 2, 3), point("a", 4, 5)],
      10,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.x).toBeCloseTo(3, 5);
    expect(clusters[0]!.y).toBeCloseTo(4, 5);
    expect(clusters[0]!.ids).toEqual(["a", "b"]);
    expect(clusters[0]!.totalCount).toBe(2);
  });

  test("points in different cells stay separate", () => {
    const clusters: Array<GeoCluster> = clusterPoints(
      [point("a", 5, 5), point("b", 15, 5), point("c", 5, 15)],
      10,
    );
    expect(clusters).toHaveLength(3);
  });

  test("cell boundaries bucket by floor division", () => {
    // x = 10 with cellSize 10 belongs to cell 1; x = 9.999 to cell 0.
    const clusters: Array<GeoCluster> = clusterPoints(
      [point("edge", 10, 0), point("inside", 9.999, 0)],
      10,
    );
    expect(clusters).toHaveLength(2);
  });

  test("worst status propagates as the maximum priority", () => {
    const clusters: Array<GeoCluster> = clusterPoints(
      [point("a", 1, 1, 0), point("b", 2, 2, 2), point("c", 3, 3, 1)],
      100,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.worstStatusPriority).toBe(2);
  });

  test("totalCount sums explicit counts and defaults missing ones to 1", () => {
    const clusters: Array<GeoCluster> = clusterPoints(
      [point("a", 1, 1, 0, 5), point("b", 2, 2, 0), point("c", 3, 3, 0, 2)],
      100,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.totalCount).toBe(8);
  });

  test("clusters are ordered by grid row, then grid column", () => {
    const clusters: Array<GeoCluster> = clusterPoints(
      [
        point("bottomRight", 95, 95),
        point("topRight", 95, 5),
        point("bottomLeft", 5, 95),
        point("topLeft", 5, 5),
      ],
      10,
    );
    expect(
      clusters.map((cluster: GeoCluster) => {
        return cluster.ids[0];
      }),
    ).toEqual(["topLeft", "topRight", "bottomLeft", "bottomRight"]);
  });

  test("member ids are sorted within a cluster", () => {
    const clusters: Array<GeoCluster> = clusterPoints(
      [point("zulu", 1, 1), point("alpha", 2, 2), point("mike", 3, 3)],
      100,
    );
    expect(clusters[0]!.ids).toEqual(["alpha", "mike", "zulu"]);
  });

  test("deterministic regardless of input order", () => {
    const points: Array<GeoClusterPoint> = [
      point("a", 5, 5, 1),
      point("b", 8, 8, 3, 4),
      point("c", 55, 5, 0),
      point("d", 5, 55, 2),
      point("e", 58, 58, 1, 2),
    ];
    const reversed: Array<GeoClusterPoint> = points.slice().reverse();
    expect(clusterPoints(points, 20)).toEqual(clusterPoints(reversed, 20));
  });

  test("negative coordinates bucket consistently", () => {
    // -5 and -1 share cell -1; 1 sits in cell 0.
    const clusters: Array<GeoCluster> = clusterPoints(
      [point("a", -5, 5), point("b", -1, 5), point("c", 1, 5)],
      10,
    );
    expect(clusters).toHaveLength(2);
    expect(clusters[0]!.ids).toEqual(["a", "b"]);
    expect(clusters[1]!.ids).toEqual(["c"]);
  });

  test("points with non-finite coordinates are skipped", () => {
    const clusters: Array<GeoCluster> = clusterPoints(
      [point("bad", NaN, 5), point("worse", 5, Infinity), point("good", 5, 5)],
      10,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.ids).toEqual(["good"]);
  });

  test("a non-finite or non-positive cellSize falls back to 1", () => {
    const points: Array<GeoClusterPoint> = [
      point("a", 0.25, 0.25),
      point("b", 0.75, 0.75),
      point("c", 5.5, 5.5),
    ];
    // With cellSize 1, a and b share cell 0:0 and c sits alone in 5:5.
    const expected: Array<GeoCluster> = [
      {
        x: 0.5,
        y: 0.5,
        ids: ["a", "b"],
        worstStatusPriority: 0,
        totalCount: 2,
      },
      {
        x: 5.5,
        y: 5.5,
        ids: ["c"],
        worstStatusPriority: 0,
        totalCount: 1,
      },
    ];
    expect(clusterPoints(points, 1)).toEqual(expected);
    for (const cellSize of [0, -10, NaN, Infinity]) {
      expect(clusterPoints(points, cellSize)).toEqual(expected);
    }
  });

  test("worst status is the maximum, not the last or the first, member", () => {
    /*
     * Repo convention (see GeoClusterPoint): HIGHER statusPriority = WORSE.
     * Pin the direction from both input orders so an accidental Math.min or
     * last-write-wins regression cannot pass.
     */
    const worstFirst: Array<GeoCluster> = clusterPoints(
      [point("a", 1, 1, 4), point("b", 2, 2, 1)],
      100,
    );
    const worstLast: Array<GeoCluster> = clusterPoints(
      [point("a", 1, 1, 1), point("b", 2, 2, 4)],
      100,
    );
    expect(worstFirst[0]!.worstStatusPriority).toBe(4);
    expect(worstLast[0]!.worstStatusPriority).toBe(4);
  });
});

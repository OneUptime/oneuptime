import { describe, expect, test } from "@jest/globals";
import {
  DatabaseFleetSummaryTile,
  describeDatabaseSourceBreakdown,
  summarizeDatabaseFleet,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerSummary";
import { DATABASE_SERVER_LIVE_WINDOW_MINUTES } from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerPresentation";

describe("describeDatabaseSourceBreakdown", () => {
  test("busiest source first, zero counts left out", () => {
    expect(
      describeDatabaseSourceBreakdown({
        manual: 1,
        "client-spans": 4,
        kubernetes: 2,
        docker: 0,
      }),
    ).toBe("4 from traces · 2 Kubernetes · 1 manual");
  });

  test("ties keep the filter's order", () => {
    expect(
      describeDatabaseSourceBreakdown({
        podman: 2,
        collector: 2,
        docker: 2,
      }),
    ).toBe("2 collector · 2 Docker · 2 Podman");
  });

  test("unknown sources and junk values are ignored", () => {
    expect(
      describeDatabaseSourceBreakdown({
        "some-new-source": 9,
        manual: Number.NaN,
      } as Record<string, number>),
    ).toBe("");
    expect(describeDatabaseSourceBreakdown({})).toBe("");
  });
});

describe("summarizeDatabaseFleet", () => {
  test("four tiles in a fixed order", () => {
    const tiles: Array<DatabaseFleetSummaryTile> = summarizeDatabaseFleet({
      total: 10,
      engineMetricsConnected: 4,
      seenRecently: 7,
      bySource: { "client-spans": 6, kubernetes: 3, manual: 1 },
    });

    expect(
      tiles.map((tile: DatabaseFleetSummaryTile): string => {
        return tile.title;
      }),
    ).toEqual([
      "Databases",
      "Seen recently",
      "Engine metrics",
      "Without engine metrics",
    ]);
    expect(tiles[0]).toEqual({
      title: "Databases",
      value: "10",
      sublabel: "6 from traces · 3 Kubernetes · 1 manual",
    });
    expect(tiles[1]).toEqual({
      title: "Seen recently",
      value: "7",
      sublabel: `in the last ${DATABASE_SERVER_LIVE_WINDOW_MINUTES} min`,
    });
    expect(tiles[2]).toEqual({
      title: "Engine metrics",
      value: "4",
      sublabel: "40% of databases",
    });
    expect(tiles[3]).toEqual({
      title: "Without engine metrics",
      value: "6",
      sublabel: "no Database Agent or collector reporting",
    });
  });

  /*
   * A project whose databases were all found as Kubernetes StatefulSets has
   * no application queries at all; the tile must not claim it does.
   */
  test("'without engine metrics' says what is missing, not where rows came from", () => {
    const tiles: Array<DatabaseFleetSummaryTile> = summarizeDatabaseFleet({
      total: 4,
      engineMetricsConnected: 0,
      seenRecently: 4,
      bySource: { kubernetes: 3, docker: 1 },
    });

    expect(tiles[3]!.value).toBe("4");
    expect(tiles[3]!.sublabel).toBe("no Database Agent or collector reporting");
    expect(tiles[3]!.sublabel).not.toContain("applications");
  });

  test("clamps subsets to the total so the strip never contradicts itself", () => {
    const tiles: Array<DatabaseFleetSummaryTile> = summarizeDatabaseFleet({
      total: 3,
      engineMetricsConnected: 5,
      seenRecently: 9,
      bySource: {},
    });

    expect(tiles[1]!.value).toBe("3");
    expect(tiles[2]!.value).toBe("3");
    expect(tiles[3]!.value).toBe("0");
    expect(tiles[3]!.sublabel).toBe("every database reports engine metrics");
  });

  test("no agent connected yet", () => {
    const tiles: Array<DatabaseFleetSummaryTile> = summarizeDatabaseFleet({
      total: 2,
      engineMetricsConnected: 0,
      seenRecently: 0,
      bySource: { "client-spans": 2 },
    });

    expect(tiles[2]!.sublabel).toBe("no Database Agent connected yet");
  });

  test("an empty or broken count reads zero, not NaN", () => {
    const tiles: Array<DatabaseFleetSummaryTile> = summarizeDatabaseFleet({
      total: Number.NaN,
      engineMetricsConnected: -4,
      seenRecently: Number.NaN,
      bySource: {},
    });

    for (const tile of tiles) {
      expect(tile.value).toBe("0");
    }
    expect(tiles[0]!.sublabel).toBe("none discovered yet");
    expect(tiles[2]!.sublabel).toBe("—");
    expect(tiles[3]!.sublabel).toBe("—");
  });
});

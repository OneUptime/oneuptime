import { describe, expect, test } from "@jest/globals";
import {
  CloudFleetCounts,
  CloudFleetSummaryTile,
  describeProviderBreakdown,
  summarizeCloudFleet,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Utils/CloudFleetSummary";

/*
 * The stat strip's wording lives in a pure function so it can be checked
 * without a renderer. The tiles are positional (the component pairs them
 * with icons by index), so the order is part of the contract.
 */

function tileByTitle(
  tiles: Array<CloudFleetSummaryTile>,
  title: string,
): CloudFleetSummaryTile {
  const tile: CloudFleetSummaryTile | undefined = tiles.find(
    (candidate: CloudFleetSummaryTile): boolean => {
      return candidate.title === title;
    },
  );
  if (!tile) {
    throw new Error(`No tile titled "${title}"`);
  }
  return tile;
}

describe("summarizeCloudFleet", () => {
  test("returns four tiles in a fixed order", () => {
    const tiles: Array<CloudFleetSummaryTile> = summarizeCloudFleet({
      total: 0,
      connected: 0,
      disconnected: 0,
      byProvider: {},
      liveInstances: 0,
    });

    expect(
      tiles.map((tile: CloudFleetSummaryTile): string => {
        return tile.title;
      }),
    ).toEqual(["Environments", "Connected", "Disconnected", "Live instances"]);
  });

  test("an empty fleet reads as empty rather than as a broken one", () => {
    const tiles: Array<CloudFleetSummaryTile> = summarizeCloudFleet({
      total: 0,
      connected: 0,
      disconnected: 0,
      byProvider: {},
      liveInstances: 0,
    });

    expect(tileByTitle(tiles, "Environments")).toEqual({
      title: "Environments",
      value: "0",
      sublabel: "none discovered yet",
    });
    expect(tileByTitle(tiles, "Connected").value).toBe("0");
    expect(tileByTitle(tiles, "Connected").sublabel).toBe(
      "nothing reporting yet",
    );
    expect(tileByTitle(tiles, "Disconnected").value).toBe("0");
    expect(tileByTitle(tiles, "Live instances")).toEqual({
      title: "Live instances",
      value: "0",
      sublabel: "seen in the last 15 min",
    });
  });

  test("a mixed fleet breaks the total down by provider, busiest first", () => {
    const counts: CloudFleetCounts = {
      total: 6,
      connected: 4,
      disconnected: 2,
      byProvider: { aws: 3, gcp: 1, azure: 2 },
      liveInstances: 17,
    };

    const tiles: Array<CloudFleetSummaryTile> = summarizeCloudFleet(counts);

    expect(tileByTitle(tiles, "Environments")).toEqual({
      title: "Environments",
      value: "6",
      sublabel: "3 AWS · 2 Azure · 1 Google Cloud",
    });
    expect(tileByTitle(tiles, "Connected")).toEqual({
      title: "Connected",
      value: "4",
      sublabel: "67% of environments",
    });
    expect(tileByTitle(tiles, "Disconnected")).toEqual({
      title: "Disconnected",
      value: "2",
      sublabel: "no telemetry recently",
    });
    expect(tileByTitle(tiles, "Live instances").value).toBe("17");
  });

  test("an all-disconnected fleet says so without pretending anything is live", () => {
    const tiles: Array<CloudFleetSummaryTile> = summarizeCloudFleet({
      total: 3,
      connected: 0,
      disconnected: 3,
      byProvider: { aws: 3 },
      liveInstances: 0,
    });

    expect(tileByTitle(tiles, "Connected")).toEqual({
      title: "Connected",
      value: "0",
      sublabel: "0% of environments",
    });
    expect(tileByTitle(tiles, "Disconnected")).toEqual({
      title: "Disconnected",
      value: "3",
      sublabel: "no telemetry recently",
    });
    expect(tileByTitle(tiles, "Environments").sublabel).toBe("3 AWS");
  });

  test("a fully connected fleet celebrates instead of showing a zero warning", () => {
    const tiles: Array<CloudFleetSummaryTile> = summarizeCloudFleet({
      total: 2,
      connected: 2,
      disconnected: 0,
      byProvider: { gcp: 2 },
      liveInstances: 5,
    });

    expect(tileByTitle(tiles, "Connected").sublabel).toBe(
      "100% of environments",
    );
    expect(tileByTitle(tiles, "Disconnected").sublabel).toBe(
      "every environment is reporting",
    );
  });

  test("never shows negative or over-100% numbers when counts arrive inconsistent", () => {
    /*
     * The six counts are separate requests; a create between two of them
     * can make "connected" exceed "total" for one refresh.
     */
    const tiles: Array<CloudFleetSummaryTile> = summarizeCloudFleet({
      total: 1,
      connected: 2,
      disconnected: -1,
      byProvider: {},
      liveInstances: -3,
    });

    expect(tileByTitle(tiles, "Connected").value).toBe("1");
    expect(tileByTitle(tiles, "Connected").sublabel).toBe(
      "100% of environments",
    );
    expect(tileByTitle(tiles, "Disconnected").value).toBe("0");
    expect(tileByTitle(tiles, "Live instances").value).toBe("0");
  });
});

describe("describeProviderBreakdown", () => {
  test("uses the shared provider labels and drops zero counts", () => {
    expect(describeProviderBreakdown({ aws: 0, gcp: 2, azure: 0 })).toBe(
      "2 Google Cloud",
    );
  });

  test("orders by count, then by label, so refreshes do not reshuffle", () => {
    expect(describeProviderBreakdown({ azure: 2, aws: 2, gcp: 5 })).toBe(
      "5 Google Cloud · 2 AWS · 2 Azure",
    );
  });

  test("falls back to the raw value for a provider it has no label for", () => {
    expect(describeProviderBreakdown({ oracle: 1 })).toBe("1 oracle");
  });

  test("is empty when nothing has a count", () => {
    expect(describeProviderBreakdown({})).toBe("");
  });
});

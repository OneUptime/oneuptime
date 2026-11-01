import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_FLEET_DEPLOYS_WINDOW_HOURS,
  CloudFleetCounts,
  CloudFleetSummaryTile,
  describeProviderBreakdown,
  getProviderBreakdownParts,
  summarizeCloudFleet,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudFleetSummary";
import { CLOUD_FLEET_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/CloudMetricDescriptions";

/*
 * The stat strip's wording lives in a pure function so it can be checked
 * without a renderer. The tiles are positional (the component pairs them
 * with icons by index), so the order is part of the contract: the apps
 * first - what people deploy - then the environments they run in, the
 * deploys of the last day, and the instances live right now.
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

// An empty fleet, with the counts a test is about laid over it.
function fleet(counts: Partial<CloudFleetCounts>): CloudFleetCounts {
  return {
    total: 0,
    connected: 0,
    disconnected: 0,
    byProvider: {},
    liveInstances: 0,
    apps: 0,
    runningApps: 0,
    deploys: 0,
    ...counts,
  };
}

describe("summarizeCloudFleet", () => {
  test("returns four tiles in a fixed order: apps, environments, deploys, live instances", () => {
    const tiles: Array<CloudFleetSummaryTile> = summarizeCloudFleet(fleet({}));

    expect(
      tiles.map((tile: CloudFleetSummaryTile): string => {
        return tile.title;
      }),
    ).toEqual(["Apps", "Environments", "Deploys", "Live instances"]);
  });

  test("an empty fleet reads as empty rather than as a broken one", () => {
    const tiles: Array<CloudFleetSummaryTile> = summarizeCloudFleet(fleet({}));

    expect(tileByTitle(tiles, "Apps")).toEqual({
      title: "Apps",
      value: "0",
      sublabel: "none reported yet",
      description: CLOUD_FLEET_METRIC_DESCRIPTIONS.apps,
    });
    expect(tileByTitle(tiles, "Environments")).toEqual({
      title: "Environments",
      value: "0",
      sublabel: "none discovered yet",
      description: CLOUD_FLEET_METRIC_DESCRIPTIONS.environments,
    });
    expect(tileByTitle(tiles, "Deploys")).toEqual({
      title: "Deploys",
      value: "0",
      sublabel: "in the last 24 hours",
      description: CLOUD_FLEET_METRIC_DESCRIPTIONS.deploys,
    });
    expect(tileByTitle(tiles, "Live instances")).toEqual({
      title: "Live instances",
      value: "0",
      sublabel: "seen in the last 15 min",
      description: CLOUD_FLEET_METRIC_DESCRIPTIONS.liveInstances,
    });
  });

  test("the Deploys tile counts the window it names", () => {
    expect(CLOUD_FLEET_DEPLOYS_WINDOW_HOURS).toBe(24);

    expect(
      tileByTitle(summarizeCloudFleet(fleet({ deploys: 7 })), "Deploys"),
    ).toEqual({
      title: "Deploys",
      value: "7",
      sublabel: "in the last 24 hours",
      description: CLOUD_FLEET_METRIC_DESCRIPTIONS.deploys,
    });
  });

  test("apps that went quiet come first in the Apps line, and all running says so", () => {
    expect(
      tileByTitle(
        summarizeCloudFleet(fleet({ apps: 6, runningApps: 4 })),
        "Apps",
      ),
    ).toEqual({
      title: "Apps",
      value: "6",
      sublabel: "2 not reporting",
      description: CLOUD_FLEET_METRIC_DESCRIPTIONS.apps,
    });
    expect(
      tileByTitle(
        summarizeCloudFleet(fleet({ apps: 3, runningApps: 3 })),
        "Apps",
      ).sublabel,
    ).toBe("all running");
    expect(
      tileByTitle(
        summarizeCloudFleet(fleet({ apps: 3, runningApps: 0 })),
        "Apps",
      ).sublabel,
    ).toBe("3 not reporting");
  });

  test("disconnected environments come first in the Environments line, over the providers", () => {
    const tiles: Array<CloudFleetSummaryTile> = summarizeCloudFleet(
      fleet({
        total: 6,
        connected: 4,
        disconnected: 2,
        byProvider: { aws: 3, gcp: 1, azure: 2 },
      }),
    );

    expect(tileByTitle(tiles, "Environments")).toEqual({
      title: "Environments",
      value: "6",
      sublabel: "2 environments disconnected",
      description: CLOUD_FLEET_METRIC_DESCRIPTIONS.environments,
    });
  });

  test("a connected fleet breaks the environments down by provider, busiest first", () => {
    const tiles: Array<CloudFleetSummaryTile> = summarizeCloudFleet(
      fleet({
        total: 6,
        connected: 6,
        byProvider: { aws: 3, gcp: 1, azure: 2 },
        liveInstances: 17,
      }),
    );

    expect(tileByTitle(tiles, "Environments")).toEqual({
      title: "Environments",
      value: "6",
      sublabel: "3 AWS · 2 Azure · 1 Google Cloud",
      /*
       * The parts the strip keeps whole, so a narrow tile wraps between
       * providers and never breaks "Google Cloud" over two lines.
       */
      sublabelParts: ["3 AWS", "2 Azure", "1 Google Cloud"],
      description: CLOUD_FLEET_METRIC_DESCRIPTIONS.environments,
    });
    expect(tileByTitle(tiles, "Live instances").value).toBe("17");
  });

  test("an all-disconnected fleet says so without pretending anything is live", () => {
    const tiles: Array<CloudFleetSummaryTile> = summarizeCloudFleet(
      fleet({
        total: 3,
        disconnected: 3,
        byProvider: { aws: 3 },
        apps: 2,
      }),
    );

    expect(tileByTitle(tiles, "Environments").sublabel).toBe(
      "3 environments disconnected",
    );
    expect(tileByTitle(tiles, "Apps").sublabel).toBe("2 not reporting");
    expect(tileByTitle(tiles, "Live instances").value).toBe("0");
  });

  test("never shows negative or impossible numbers when counts arrive inconsistent", () => {
    /*
     * The counts are separate requests; a create between two of them can
     * make "connected" exceed "total", or "running" exceed the apps, for
     * one refresh.
     */
    const tiles: Array<CloudFleetSummaryTile> = summarizeCloudFleet({
      total: 1,
      connected: 2,
      disconnected: -1,
      byProvider: {},
      liveInstances: -3,
      apps: 2,
      runningApps: 5,
      deploys: -1,
    });

    expect(tileByTitle(tiles, "Apps").value).toBe("2");
    expect(tileByTitle(tiles, "Apps").sublabel).toBe("all running");
    expect(tileByTitle(tiles, "Environments").value).toBe("1");
    expect(tileByTitle(tiles, "Environments").sublabel).toBe(
      "none discovered yet",
    );
    expect(tileByTitle(tiles, "Deploys").value).toBe("0");
    expect(tileByTitle(tiles, "Live instances").value).toBe("0");

    expect(
      tileByTitle(
        summarizeCloudFleet(fleet({ apps: -2, runningApps: -1 })),
        "Apps",
      ),
    ).toEqual(
      expect.objectContaining({ value: "0", sublabel: "none reported yet" }),
    );
  });
});

describe("the numbers the strip writes", () => {
  test("are written the reader's way: thousands grouped, never a bare 1284", () => {
    const tiles: Array<CloudFleetSummaryTile> = summarizeCloudFleet({
      total: 1284,
      connected: 1200,
      disconnected: 84,
      byProvider: { aws: 1100, gcp: 184 },
      liveInstances: 15320,
      apps: 2310,
      runningApps: 1105,
      deploys: 1002,
    });

    expect(tileByTitle(tiles, "Apps").value).toBe("2,310");
    expect(tileByTitle(tiles, "Apps").sublabel).toBe("1,205 not reporting");
    expect(tileByTitle(tiles, "Environments").value).toBe("1,284");
    expect(tileByTitle(tiles, "Environments").sublabel).toBe(
      "84 environments disconnected",
    );
    expect(tileByTitle(tiles, "Deploys").value).toBe("1,002");
    expect(tileByTitle(tiles, "Live instances").value).toBe("15,320");

    expect(
      tileByTitle(
        summarizeCloudFleet(
          fleet({
            total: 1284,
            connected: 1284,
            byProvider: { aws: 1100, gcp: 184 },
          }),
        ),
        "Environments",
      ).sublabel,
    ).toBe("1,100 AWS · 184 Google Cloud");
  });

  test("a breakdown of one provider is one part, drawn as the sublabel alone", () => {
    const tiles: Array<CloudFleetSummaryTile> = summarizeCloudFleet(
      fleet({
        total: 3,
        connected: 3,
        byProvider: { azure: 3 },
        liveInstances: 4,
        apps: 2,
        runningApps: 2,
      }),
    );

    expect(tileByTitle(tiles, "Environments").sublabel).toBe("3 Azure");
    expect(tileByTitle(tiles, "Environments").sublabelParts).toBeUndefined();
    // Only the breakdown is a list: no other tile has parts.
    for (const tile of tiles) {
      if (tile.title !== "Environments") {
        expect(tile.sublabelParts).toBeUndefined();
      }
    }
  });

  test("the disconnected line is never split into parts", () => {
    const tile: CloudFleetSummaryTile = tileByTitle(
      summarizeCloudFleet(
        fleet({
          total: 4,
          connected: 3,
          disconnected: 1,
          byProvider: { aws: 2, gcp: 2 },
        }),
      ),
      "Environments",
    );

    expect(tile.sublabel).toBe("1 environment disconnected");
    expect(tile.sublabelParts).toBeUndefined();
  });
});

describe("getProviderBreakdownParts", () => {
  test("is the breakdown, one part per provider, busiest first", () => {
    expect(getProviderBreakdownParts({ azure: 2, aws: 2, gcp: 5 })).toEqual([
      "5 Google Cloud",
      "2 AWS",
      "2 Azure",
    ]);
    expect(getProviderBreakdownParts({ aws: 0 })).toEqual([]);
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

import { describe, expect, test } from "@jest/globals";
import {
  NETWORK_MAP_CLUSTER_CELL_SIZE,
  NETWORK_MAP_COLORS,
  NETWORK_MAP_LEGEND,
  NetworkMapLegendEntry,
  NetworkMapMarker,
  NetworkMapSite,
  NetworkMapSiteInput,
  NetworkMapSitesResult,
  NetworkMapStatusSummary,
  UNKNOWN_STATUS_LABEL,
  UNNAMED_SITE_LABEL,
  buildNetworkMapMarkers,
  countNetworkMapSitesInViewport,
  describeNetworkMapCoverage,
  fitNetworkMapViewport,
  networkMapClusterCellSize,
  NETWORK_MAP_MAX_SITES_CEILING,
  networkMapPoints,
  networkMapStatusSummary,
  resolveNetworkMapMaxSites,
  toNetworkMapSites,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Components/NetworkMapWidgetData";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import {
  MapViewport,
  WORLD_VIEWPORT,
  zoomOfViewport,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/Geo/GeoViewport";
import {
  ROBINSON_VIEW_BOX_HEIGHT,
  ROBINSON_VIEW_BOX_WIDTH,
  projectRobinson,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/Geo/GeoProjection";
import { MAX_LABELLED_MARKERS } from "../../FeatureSet/Dashboard/src/Components/NetworkSite/SiteMapViewModel";

/*
 * The react-free half of the Network Map dashboard widget: narrowing
 * NetworkSite rows into pins, clustering them, coloring them, and the words
 * printed under the map.
 *
 * The cases that matter most are the dishonest ones — a site with no
 * coordinates silently vanishing, an outage hidden inside a green cluster,
 * or a footer claiming the map holds a network it has only part of. Every
 * one of those is a map that looks complete and is not.
 */

// -- Fixtures --------------------------------------------------------------

type MakeInput = (
  overrides?: Partial<NetworkMapSiteInput>,
) => NetworkMapSiteInput;

const input: MakeInput = (
  overrides: Partial<NetworkMapSiteInput> = {},
): NetworkMapSiteInput => {
  return {
    id: "site-1",
    name: "London HQ",
    siteType: "Region",
    latitude: 51.5,
    longitude: -0.12,
    statusName: "Operational",
    statusColor: "#10b981",
    statusPriority: 1,
    isOperational: true,
    ...overrides,
  };
};

type MakeSite = (overrides?: Partial<NetworkMapSite>) => NetworkMapSite;

const site: MakeSite = (
  overrides: Partial<NetworkMapSite> = {},
): NetworkMapSite => {
  return {
    id: "site-1",
    name: "London HQ",
    siteType: "Region",
    latitude: 51.5,
    longitude: -0.12,
    statusName: "Operational",
    statusColor: null,
    statusPriority: 1,
    isOperational: true,
    ...overrides,
  };
};

function narrow(rows: Array<NetworkMapSiteInput>): NetworkMapSitesResult {
  return toNetworkMapSites(rows);
}

function markers(
  sites: Array<NetworkMapSite>,
  showLabels: boolean = true,
  cellSize: number = NETWORK_MAP_CLUSTER_CELL_SIZE,
  zoom: number = 1,
): Array<NetworkMapMarker> {
  return buildNetworkMapMarkers({
    sites: sites,
    cellSize: cellSize,
    showLabels: showLabels,
    zoom: zoom,
  });
}

// -- toNetworkMapSites -----------------------------------------------------

describe("toNetworkMapSites", () => {
  test("narrows a well-formed row faithfully", () => {
    const result: NetworkMapSitesResult = narrow([input()]);

    expect(result.unplacedCount).toBe(0);
    expect(result.sites).toEqual([
      {
        id: "site-1",
        name: "London HQ",
        siteType: "Region",
        latitude: 51.5,
        longitude: -0.12,
        statusName: "Operational",
        statusColor: "#10b981",
        statusPriority: 1,
        isOperational: true,
      },
    ]);
  });

  test("returns an empty result for no rows at all", () => {
    expect(narrow([])).toEqual({ sites: [], unplacedCount: 0 });
  });

  /*
   * A row with no id could not be keyed, deduped or linked, so it is dropped
   * outright rather than counted as unplaced — it is not a site the reader
   * is missing from the map, it is not a site.
   */
  test("drops rows with no id without counting them as unplaced", () => {
    const result: NetworkMapSitesResult = narrow([
      input({ id: "" }),
      input({ id: null }),
      input({ id: undefined }),
    ]);

    expect(result.sites).toHaveLength(0);
    expect(result.unplacedCount).toBe(0);
  });

  /*
   * The opposite case: a real site that simply has no coordinates yet. It
   * must be COUNTED, because a site missing from the map while its card sits
   * right underneath is a bug report waiting to happen.
   */
  test("counts a site with no coordinates as unplaced rather than dropping it silently", () => {
    const result: NetworkMapSitesResult = narrow([
      input({ id: "a", latitude: undefined, longitude: undefined }),
      input({ id: "b", latitude: null, longitude: null }),
      input({ id: "c", latitude: 10, longitude: undefined }),
      input({ id: "d", longitude: 10, latitude: undefined }),
    ]);

    expect(result.sites).toHaveLength(0);
    expect(result.unplacedCount).toBe(4);
  });

  /*
   * A CSV import that shifts a column by one puts a longitude in the
   * latitude field. 1246.7 would project to a marker — and a frame fitted
   * around it — somewhere no site is.
   */
  test("rejects coordinates outside the real latitude and longitude ranges", () => {
    const result: NetworkMapSitesResult = narrow([
      input({ id: "a", latitude: 91 }),
      input({ id: "b", latitude: -91 }),
      input({ id: "c", longitude: 181 }),
      input({ id: "d", longitude: -181 }),
      input({ id: "e", latitude: 1246.7 }),
    ]);

    expect(result.sites).toHaveLength(0);
    expect(result.unplacedCount).toBe(5);
  });

  test("accepts the exact poles and the antimeridian", () => {
    const result: NetworkMapSitesResult = narrow([
      input({ id: "a", latitude: 90, longitude: 180 }),
      input({ id: "b", latitude: -90, longitude: -180 }),
      input({ id: "c", latitude: 0, longitude: 0 }),
    ]);

    expect(result.sites).toHaveLength(3);
    expect(result.unplacedCount).toBe(0);
  });

  test("rejects non-finite and non-numeric coordinates", () => {
    const result: NetworkMapSitesResult = narrow([
      input({ id: "a", latitude: Number.NaN }),
      input({ id: "b", longitude: Number.POSITIVE_INFINITY }),
      input({ id: "c", latitude: "51.5" as unknown as number }),
    ]);

    expect(result.sites).toHaveLength(0);
    expect(result.unplacedCount).toBe(3);
  });

  test("falls back to readable placeholders for a missing name and status", () => {
    const result: NetworkMapSitesResult = narrow([
      input({ name: undefined, statusName: undefined }),
    ]);

    expect(result.sites[0]?.name).toBe(UNNAMED_SITE_LABEL);
    expect(result.sites[0]?.statusName).toBe(UNKNOWN_STATUS_LABEL);
  });

  test("trims whitespace and treats a blank string as absent", () => {
    const result: NetworkMapSitesResult = narrow([
      input({ name: "  Paris  ", siteType: "   ", statusColor: "  " }),
    ]);

    expect(result.sites[0]?.name).toBe("Paris");
    expect(result.sites[0]?.siteType).toBe("");
    expect(result.sites[0]?.statusColor).toBeNull();
  });

  /*
   * isOperational is TRI-state. A site that has never been rolled up has no
   * verdict at all, and collapsing that to `false` would paint a brand new
   * estate entirely red.
   */
  test("keeps isOperational tri-state rather than collapsing unknown to false", () => {
    const result: NetworkMapSitesResult = narrow([
      input({ id: "a", isOperational: true }),
      input({ id: "b", isOperational: false }),
      input({ id: "c", isOperational: undefined }),
      input({ id: "d", isOperational: null }),
      input({ id: "e", isOperational: "true" as unknown as boolean }),
    ]);

    expect(
      result.sites.map((s: NetworkMapSite): boolean | null => {
        return s.isOperational;
      }),
    ).toEqual([true, false, null, null, null]);
  });

  test("defaults a missing or non-finite status priority to zero", () => {
    const result: NetworkMapSitesResult = narrow([
      input({ id: "a", statusPriority: undefined }),
      input({ id: "b", statusPriority: Number.NaN }),
      input({ id: "c", statusPriority: 7 }),
    ]);

    expect(
      result.sites.map((s: NetworkMapSite): number => {
        return s.statusPriority;
      }),
    ).toEqual([0, 0, 7]);
  });

  test("preserves input order for the rows it keeps", () => {
    const result: NetworkMapSitesResult = narrow([
      input({ id: "c" }),
      input({ id: "a" }),
      input({ id: "b" }),
    ]);

    expect(
      result.sites.map((s: NetworkMapSite): string => {
        return s.id;
      }),
    ).toEqual(["c", "a", "b"]);
  });

  test("never throws on a completely malformed row", () => {
    expect(() => {
      return toNetworkMapSites([
        {} as NetworkMapSiteInput,
        null as unknown as NetworkMapSiteInput,
        undefined as unknown as NetworkMapSiteInput,
      ]);
    }).not.toThrow();
  });
});

// -- buildNetworkMapMarkers ------------------------------------------------

describe("buildNetworkMapMarkers", () => {
  test("draws nothing for no sites", () => {
    expect(markers([])).toEqual([]);
  });

  test("projects a lone site to its Robinson position", () => {
    const only: NetworkMapMarker = markers([site()])[0] as NetworkMapMarker;
    const [x, y]: [number, number] = projectRobinson(51.5, -0.12);

    expect(only.x).toBeCloseTo(x, 6);
    expect(only.y).toBeCloseTo(y, 6);
    expect(only.ids).toEqual(["site-1"]);
    expect(only.count).toBe(1);
  });

  test("merges sites that share a grid cell into one marker", () => {
    const result: Array<NetworkMapMarker> = markers([
      site({ id: "a", latitude: 51.5, longitude: -0.12 }),
      site({ id: "b", latitude: 51.51, longitude: -0.13 }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.count).toBe(2);
    expect(result[0]?.ids).toEqual(["a", "b"]);
  });

  test("keeps distant sites as separate markers", () => {
    const result: Array<NetworkMapMarker> = markers([
      site({ id: "london", latitude: 51.5, longitude: -0.12 }),
      site({ id: "sydney", latitude: -33.87, longitude: 151.21 }),
    ]);

    expect(result).toHaveLength(2);
  });

  /*
   * A smaller cell splits a lump apart. This is what makes the widget's
   * viewport-scaled cell size mean something rather than being decoration.
   */
  test("a smaller cell size separates sites a larger one merged", () => {
    const nearby: Array<NetworkMapSite> = [
      site({ id: "a", latitude: 51.5, longitude: -0.12 }),
      site({ id: "b", latitude: 51.9, longitude: -0.6 }),
    ];

    expect(markers(nearby, true, 28)).toHaveLength(1);
    expect(markers(nearby, true, 0.05)).toHaveLength(2);
  });

  /*
   * An outage must never hide inside a calm cluster. Red beats everything.
   */
  test("colors a cluster red when any member is down, however many are up", () => {
    const result: Array<NetworkMapMarker> = markers([
      site({ id: "a", isOperational: true }),
      site({ id: "b", isOperational: true, latitude: 51.51 }),
      site({ id: "c", isOperational: false, latitude: 51.52 }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.colorKey).toBe("down");
    expect(result[0]?.color).toBe(NETWORK_MAP_COLORS.down);
  });

  test("colors a wholly healthy cluster green", () => {
    const result: Array<NetworkMapMarker> = markers([
      site({ id: "a", isOperational: true }),
      site({ id: "b", isOperational: true, latitude: 51.51 }),
    ]);

    expect(result[0]?.colorKey).toBe("ok");
  });

  test("colors a cluster gray when no member carries any status at all", () => {
    const result: Array<NetworkMapMarker> = markers([
      site({ id: "a", isOperational: null, statusPriority: 0 }),
      site({
        id: "b",
        isOperational: null,
        statusPriority: 0,
        latitude: 51.51,
      }),
    ]);

    expect(result[0]?.colorKey).toBe("none");
    expect(result[0]?.color).toBe(NETWORK_MAP_COLORS.none);
  });

  test("colors a partly-known cluster amber", () => {
    const result: Array<NetworkMapMarker> = markers([
      site({ id: "a", isOperational: true }),
      site({
        id: "b",
        isOperational: null,
        statusPriority: 0,
        latitude: 51.51,
      }),
    ]);

    expect(result[0]?.colorKey).toBe("mixed");
    expect(result[0]?.color).toBe(NETWORK_MAP_COLORS.mixed);
  });

  /*
   * The legend under the map is only true if every marker obeys it. A
   * project can color its statuses anything, so painting one site's own hex
   * would make the same status one color alone, another inside a cluster,
   * and a third on the Network Map page — which has always used this
   * palette.
   */
  test("paints the palette, never the project's own status color", () => {
    const single: Array<NetworkMapMarker> = markers([
      site({ statusColor: "#7c3aed", isOperational: true }),
    ]);

    expect(single[0]?.colorKey).toBe("ok");
    expect(single[0]?.color).toBe(NETWORK_MAP_COLORS.ok);

    const clustered: Array<NetworkMapMarker> = markers([
      site({ id: "a", statusColor: "#7c3aed", isOperational: true }),
      site({
        id: "b",
        statusColor: "#0ea5e9",
        isOperational: true,
        latitude: 51.51,
      }),
    ]);

    expect(clustered[0]?.count).toBe(2);
    expect(clustered[0]?.color).toBe(NETWORK_MAP_COLORS.ok);
  });

  /*
   * Every marker's color must be one the legend names, whatever the sites
   * under it are colored.
   */
  test("every marker color is one the legend accounts for", () => {
    const palette: Array<string> = Object.values(NETWORK_MAP_COLORS);
    const result: Array<NetworkMapMarker> = markers([
      site({ id: "a", statusColor: "#7c3aed", isOperational: true }),
      site({
        id: "b",
        statusColor: "#123456",
        isOperational: false,
        latitude: 40,
      }),
      site({
        id: "c",
        statusColor: "#abcdef",
        isOperational: null,
        latitude: 20,
      }),
    ]);

    for (const marker of result) {
      expect(palette).toContain(marker.color);
    }
  });

  test("labels a single-site marker with its site name, placed below it", () => {
    const only: NetworkMapMarker = markers([
      site({ name: "Camden Store" }),
    ])[0] as NetworkMapMarker;

    expect(only.label).toBe("Camden Store");
    // Below reads best — the eye goes marker, then name.
    expect(only.labelPlacement).toBe("below");
  });

  /*
   * Two names printed on top of each other are worse than one name: the
   * overlapped label is unreadable AND it hides its neighbour. So a name
   * that fits in neither position is dropped, and the tooltip carries it.
   */
  test("drops a name it cannot place clear of its neighbours", () => {
    /*
     * Eight sites in one small city with long names: they are far enough
     * apart at this cell size to stay separate markers, and far too close
     * for eight labels to sit side by side.
     */
    const crowded: Array<NetworkMapSite> = Array.from(
      { length: 8 },
      (_unused: unknown, index: number): NetworkMapSite => {
        return site({
          id: `site-${index}`,
          name: `A Fairly Long Site Name ${index}`,
          latitude: 51.5 + index * 0.35,
          longitude: -0.12 + index * 0.35,
        });
      },
    );

    const result: Array<NetworkMapMarker> = markers(crowded, true, 0.5);
    const labelled: Array<NetworkMapMarker> = result.filter(
      (marker: NetworkMapMarker): boolean => {
        return marker.label !== "";
      },
    );

    expect(result.length).toBe(8);
    expect(labelled.length).toBeLessThan(result.length);

    // Whatever survived carries a placement; whatever did not carries none.
    for (const marker of result) {
      if (marker.label) {
        expect(marker.labelPlacement).not.toBeNull();
      } else {
        expect(marker.labelPlacement).toBeNull();
      }
    }
  });

  /*
   * Zoom genuinely separates markers, so a name that could not be placed on
   * the world view comes back once the frame tightens around the same
   * sites. This is the property that makes dropping labels acceptable
   * rather than lossy.
   */
  test("places more names as the frame zooms in on the same sites", () => {
    /*
     * Short names on purpose: the point under test is that ZOOM recovers
     * labels, and a name wide enough to never fit at any realistic zoom
     * would hold the count flat and prove nothing.
     */
    const crowded: Array<NetworkMapSite> = Array.from(
      { length: 8 },
      (_unused: unknown, index: number): NetworkMapSite => {
        return site({
          id: `site-${index}`,
          name: `S${index}`,
          latitude: 51.5 + index * 0.35,
          longitude: -0.12 + index * 0.35,
        });
      },
    );

    const countLabels: (zoom: number) => number = (zoom: number): number => {
      return markers(crowded, true, 0.5, zoom).filter(
        (marker: NetworkMapMarker): boolean => {
          return marker.label !== "";
        },
      ).length;
    };

    /*
     * These eight sit on a diagonal about 15 screen units apart at zoom 12,
     * which a 15-unit-wide label box still collides with — so the check
     * uses a frame tight enough to actually separate them. MAX_ZOOM is 64.
     */
    expect(countLabels(40)).toBeGreaterThan(countLabels(1));
  });

  test("gives a cluster no label, since it stands for more than one name", () => {
    const result: Array<NetworkMapMarker> = markers([
      site({ id: "a" }),
      site({ id: "b", latitude: 51.51 }),
    ]);

    expect(result[0]?.label).toBe("");
    expect(result[0]?.labelPlacement).toBeNull();
  });

  test("drops labels entirely when the widget asks for none", () => {
    const only: NetworkMapMarker = markers(
      [site()],
      false,
    )[0] as NetworkMapMarker;

    expect(only.label).toBe("");
    expect(only.labelPlacement).toBeNull();
  });

  test("truncates a long site name rather than letting it span the map", () => {
    const label: string = markers([
      site({ name: "A Very Long Franchise Unit Name That Runs On" }),
    ])[0]?.label as string;

    expect(label.length).toBeLessThan(
      "A Very Long Franchise Unit Name That Runs On".length,
    );
    expect(label.endsWith("…")).toBe(true);
  });

  /*
   * Past a certain density, names overlap into an unreadable mat — which is
   * worse than no names, because an overlapped label also hides its
   * neighbour. The tooltip still carries every one.
   */
  test("takes every label off once the map is too busy for them", () => {
    /*
     * A 7x7 lattice spread across the whole world — far enough apart that
     * every site is its own marker, so the 49 markers genuinely cross the
     * MAX_LABELLED_MARKERS threshold rather than clustering back under it.
     */
    const busy: Array<NetworkMapSite> = Array.from(
      { length: 49 },
      (_unused: unknown, index: number): NetworkMapSite => {
        return site({
          id: `site-${index}`,
          name: `Site ${index}`,
          latitude: -60 + Math.floor(index / 7) * 20,
          longitude: -170 + (index % 7) * 50,
        });
      },
    );

    const result: Array<NetworkMapMarker> = markers(busy);

    expect(result.length).toBeGreaterThan(MAX_LABELLED_MARKERS);
    expect(
      result.every((marker: NetworkMapMarker): boolean => {
        return marker.label === "";
      }),
    ).toBe(true);
  });

  test("names a single site, its type and its status in the tooltip", () => {
    expect(
      markers([site({ name: "Camden", siteType: "Store" })])[0]?.tooltip,
    ).toBe("Camden · Store · Operational");
  });

  test("omits the type from the tooltip when the site has none", () => {
    expect(markers([site({ name: "Camden", siteType: "" })])[0]?.tooltip).toBe(
      "Camden · Operational",
    );
  });

  test("lists cluster members in the tooltip and counts the overflow", () => {
    const many: Array<NetworkMapSite> = Array.from(
      { length: 8 },
      (_unused: unknown, index: number): NetworkMapSite => {
        return site({
          id: `site-${index}`,
          name: `Site ${index}`,
          latitude: 51.5 + index * 0.001,
        });
      },
    );

    const tooltip: string = markers(many)[0]?.tooltip as string;

    expect(tooltip.startsWith("8 sites: ")).toBe(true);
    expect(tooltip).toContain("+3 more");
  });

  /*
   * Output order is PAINT order. The smallest marker has to be painted last
   * or a single store disappears under the cluster holding its neighbours.
   */
  test("returns markers biggest-first so small ones are painted on top", () => {
    const result: Array<NetworkMapMarker> = markers([
      site({ id: "lone", latitude: -33.87, longitude: 151.21 }),
      site({ id: "a", latitude: 51.5, longitude: -0.12 }),
      site({ id: "b", latitude: 51.51, longitude: -0.13 }),
      site({ id: "c", latitude: 51.52, longitude: -0.14 }),
    ]);

    expect(
      result.map((marker: NetworkMapMarker): number => {
        return marker.count;
      }),
    ).toEqual([3, 1]);
  });

  /*
   * The widget refetches on a timer and row order really does vary between
   * responses. Five members in one cell is the case that used to break:
   * clusterPoints averages positions by accumulating in input order, and
   * IEEE-754 addition is not associative, so the cluster centre — and any
   * key derived from it — differed in the last bits.
   */
  test("is deterministic: the same sites in any order draw the same markers", () => {
    const sites: Array<NetworkMapSite> = [
      site({ id: "a", latitude: 51.5, longitude: -0.12 }),
      site({ id: "b", latitude: 51.53, longitude: -0.17 }),
      site({ id: "c", latitude: 51.57, longitude: -0.29 }),
      site({ id: "d", latitude: 51.61, longitude: -0.33 }),
      site({ id: "e", latitude: 51.67, longitude: -0.41 }),
      site({ id: "f", latitude: -33.87, longitude: 151.21 }),
    ];

    expect(markers([...sites].reverse())).toEqual(markers(sites));
  });

  /*
   * React keys must survive a poll that returns the same sites in a
   * different order, or every marker remounts and any hover or focus on one
   * is lost.
   */
  test("keys a marker by its sites, not by its floating-point centre", () => {
    const sites: Array<NetworkMapSite> = [
      site({ id: "a", latitude: 51.5, longitude: -0.12 }),
      site({ id: "b", latitude: 51.53, longitude: -0.17 }),
      site({ id: "c", latitude: 51.57, longitude: -0.29 }),
    ];

    const forward: Array<string> = markers(sites).map(
      (marker: NetworkMapMarker): string => {
        return marker.key;
      },
    );
    const reversed: Array<string> = markers([...sites].reverse()).map(
      (marker: NetworkMapMarker): string => {
        return marker.key;
      },
    );

    expect(reversed).toEqual(forward);
    expect(forward[0]).toBe("a");
  });

  /*
   * The label budget must count markers that CAN carry a name, not all of
   * them: an estate of paired sites plus a few lone ones would otherwise
   * clear the threshold on marker count and draw no names at all.
   */
  test("spends the label budget on the markers that can actually be labelled", () => {
    const sites: Array<NetworkMapSite> = [];

    // 50 well-separated PAIRS — none of which can ever carry a label.
    for (let index: number = 0; index < 50; index++) {
      const latitude: number = -60 + Math.floor(index / 10) * 25;
      const longitude: number = -170 + (index % 10) * 36;
      sites.push(site({ id: `pair-${index}-a`, latitude, longitude }));
      sites.push(site({ id: `pair-${index}-b`, latitude, longitude }));
    }

    // Three lone sites, far from everything, that should keep their names.
    sites.push(
      site({ id: "lone-1", name: "Alpha", latitude: 10, longitude: 5 }),
    );
    sites.push(
      site({ id: "lone-2", name: "Bravo", latitude: 5, longitude: 100 }),
    );
    sites.push(
      site({ id: "lone-3", name: "Charlie", latitude: -20, longitude: -60 }),
    );

    const labelled: Array<string> = markers(sites)
      .filter((marker: NetworkMapMarker): boolean => {
        return marker.label !== "";
      })
      .map((marker: NetworkMapMarker): string => {
        return marker.label;
      });

    expect(labelled.sort()).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  test("gives every marker a stable, unique key", () => {
    const keys: Array<string> = markers([
      site({ id: "a", latitude: 51.5, longitude: -0.12 }),
      site({ id: "b", latitude: -33.87, longitude: 151.21 }),
      site({ id: "c", latitude: 40.71, longitude: -74.0 }),
    ]).map((marker: NetworkMapMarker): string => {
      return marker.key;
    });

    expect(new Set(keys).size).toBe(keys.length);
  });

  test("sizes a cluster larger than a single site, up to a cap", () => {
    const single: number = markers([site()])[0]?.screenRadius as number;
    const clustered: number = markers([
      site({ id: "a" }),
      site({ id: "b", latitude: 51.501 }),
      site({ id: "c", latitude: 51.502 }),
      site({ id: "d", latitude: 51.503 }),
    ])[0]?.screenRadius as number;

    expect(clustered).toBeGreaterThan(single);
    expect(clustered).toBeLessThanOrEqual(22);
  });
});

// -- networkMapStatusSummary -----------------------------------------------

describe("networkMapStatusSummary", () => {
  test("counts nothing for no sites", () => {
    expect(networkMapStatusSummary([])).toEqual({
      total: 0,
      operational: 0,
      down: 0,
      unknown: 0,
    });
  });

  test("splits sites across operational, down and unknown", () => {
    const summary: NetworkMapStatusSummary = networkMapStatusSummary([
      site({ id: "a", isOperational: true }),
      site({ id: "b", isOperational: true }),
      site({ id: "c", isOperational: false }),
      site({ id: "d", isOperational: null }),
    ]);

    expect(summary).toEqual({
      total: 4,
      operational: 2,
      down: 1,
      unknown: 1,
    });
  });

  test("the three buckets always add up to the total", () => {
    const sites: Array<NetworkMapSite> = [
      site({ id: "a", isOperational: true }),
      site({ id: "b", isOperational: false }),
      site({ id: "c", isOperational: null }),
      site({ id: "d", isOperational: false }),
    ];
    const summary: NetworkMapStatusSummary = networkMapStatusSummary(sites);

    expect(summary.operational + summary.down + summary.unknown).toBe(
      summary.total,
    );
  });
});

// -- describeNetworkMapCoverage --------------------------------------------

describe("describeNetworkMapCoverage", () => {
  test("says how many sites are mapped when the frame holds them all", () => {
    expect(
      describeNetworkMapCoverage({
        siteCount: 12,
        inViewCount: 12,
        unplacedCount: 0,
        isTruncated: false,
      }),
    ).toBe("12 sites mapped");
  });

  test("uses the singular for a network of one", () => {
    expect(
      describeNetworkMapCoverage({
        siteCount: 1,
        inViewCount: 1,
        unplacedCount: 0,
        isTruncated: false,
      }),
    ).toBe("1 site mapped");
  });

  /*
   * A count that quietly shrinks as the frame tightens reads as sites
   * disappearing. Once the frame stops holding everything, the line has to
   * say what it does hold.
   */
  test("says what the frame holds once it stops holding everything", () => {
    expect(
      describeNetworkMapCoverage({
        siteCount: 40,
        inViewCount: 12,
        unplacedCount: 0,
        isTruncated: false,
      }),
    ).toBe("12 of 40 sites in view");
  });

  test("reports sites that have no coordinates at all", () => {
    expect(
      describeNetworkMapCoverage({
        siteCount: 10,
        inViewCount: 10,
        unplacedCount: 3,
        isTruncated: false,
      }),
    ).toBe("10 sites mapped · 3 without coordinates");
  });

  /*
   * Silence about the row cap would make a truncated map look complete —
   * the exact failure the whole coverage line exists to prevent.
   */
  test("admits when the fetch hit its cap", () => {
    expect(
      describeNetworkMapCoverage({
        siteCount: 250,
        inViewCount: 250,
        unplacedCount: 0,
        isTruncated: true,
      }),
    ).toBe("250 sites mapped · more sites not shown");
  });

  test("reports every caveat at once", () => {
    expect(
      describeNetworkMapCoverage({
        siteCount: 250,
        inViewCount: 90,
        unplacedCount: 4,
        isTruncated: true,
      }),
    ).toBe(
      "90 of 250 sites in view · 4 without coordinates · more sites not shown",
    );
  });

  test("still says something when the map drew nothing", () => {
    expect(
      describeNetworkMapCoverage({
        siteCount: 0,
        inViewCount: 0,
        unplacedCount: 0,
        isTruncated: false,
      }),
    ).toBe("0 sites mapped");
  });
});

// -- viewport --------------------------------------------------------------

describe("fitNetworkMapViewport", () => {
  test("opens on the whole world when there is nothing to frame", () => {
    expect(fitNetworkMapViewport([])).toEqual(WORLD_VIEWPORT);
  });

  test("frames a single-country estate tighter than the world", () => {
    const viewport: MapViewport = fitNetworkMapViewport([
      site({ id: "a", latitude: 51.5, longitude: -0.12 }),
      site({ id: "b", latitude: 53.48, longitude: -2.24 }),
    ]);

    expect(zoomOfViewport(viewport)).toBeGreaterThan(1);
  });

  /*
   * Equatorial longitudes on purpose: Robinson compresses the parallels
   * towards the poles, so two sites at 60° north and south of ±170° span
   * noticeably less of the projected width than the same longitudes do at
   * the equator, and would fit tighter than the world.
   */
  test("stays on the world for an estate that spans it", () => {
    const viewport: MapViewport = fitNetworkMapViewport([
      site({ id: "a", latitude: 0, longitude: -175 }),
      site({ id: "b", latitude: 0, longitude: 175 }),
    ]);

    expect(zoomOfViewport(viewport)).toBeCloseTo(1, 5);
  });

  test("keeps the frame inside the world in every direction", () => {
    const viewport: MapViewport = fitNetworkMapViewport([
      site({ id: "a", latitude: 89, longitude: 179 }),
    ]);

    expect(viewport.x).toBeGreaterThanOrEqual(0);
    expect(viewport.y).toBeGreaterThanOrEqual(0);
    expect(viewport.x + viewport.width).toBeLessThanOrEqual(
      ROBINSON_VIEW_BOX_WIDTH + 1e-6,
    );
    expect(viewport.y + viewport.height).toBeLessThanOrEqual(
      ROBINSON_VIEW_BOX_HEIGHT + 1e-6,
    );
  });

  test("frames every site it was given", () => {
    const sites: Array<NetworkMapSite> = [
      site({ id: "a", latitude: 51.5, longitude: -0.12 }),
      site({ id: "b", latitude: 48.85, longitude: 2.35 }),
      site({ id: "c", latitude: 52.52, longitude: 13.4 }),
    ];

    expect(
      countNetworkMapSitesInViewport(sites, fitNetworkMapViewport(sites)),
    ).toBe(3);
  });
});

describe("networkMapPoints", () => {
  test("projects each site once, in order", () => {
    const points: Array<{ x: number; y: number }> = networkMapPoints([
      site({ id: "a", latitude: 51.5, longitude: -0.12 }),
      site({ id: "b", latitude: -33.87, longitude: 151.21 }),
    ]);
    const [ax, ay]: [number, number] = projectRobinson(51.5, -0.12);

    expect(points).toHaveLength(2);
    expect(points[0]?.x).toBeCloseTo(ax, 6);
    expect(points[0]?.y).toBeCloseTo(ay, 6);
  });
});

describe("countNetworkMapSitesInViewport", () => {
  test("counts every site when the frame is the whole world", () => {
    expect(
      countNetworkMapSitesInViewport(
        [
          site({ id: "a", latitude: 51.5, longitude: -0.12 }),
          site({ id: "b", latitude: -33.87, longitude: 151.21 }),
        ],
        WORLD_VIEWPORT,
      ),
    ).toBe(2);
  });

  test("counts only the sites a tight frame is holding", () => {
    const london: NetworkMapSite = site({
      id: "london",
      latitude: 51.5,
      longitude: -0.12,
    });
    const sydney: NetworkMapSite = site({
      id: "sydney",
      latitude: -33.87,
      longitude: 151.21,
    });

    expect(
      countNetworkMapSitesInViewport(
        [london, sydney],
        fitNetworkMapViewport([london]),
      ),
    ).toBe(1);
  });
});

describe("resolveNetworkMapMaxSites", () => {
  const FALLBACK: number = 250;

  test("takes a plain number through", () => {
    expect(resolveNetworkMapMaxSites(40, FALLBACK)).toBe(40);
  });

  /*
   * THE case this function exists for. The settings form renders Max Sites
   * as an <input type="number"> whose onChange hands back e.target.value —
   * a STRING — and the arguments form stores it verbatim. A widget that
   * type-tested for a number would ignore the value the user just typed and
   * silently keep fetching the default, which is the one failure a settings
   * field must never have.
   */
  test("accepts the string the settings form actually stores", () => {
    expect(resolveNetworkMapMaxSites("40", FALLBACK)).toBe(40);
    expect(resolveNetworkMapMaxSites("  40  ", FALLBACK)).toBe(40);
  });

  test("falls back for anything that is not a usable count", () => {
    for (const value of [
      undefined,
      null,
      "",
      "   ",
      "not a number",
      Number.NaN,
      Number.POSITIVE_INFINITY,
      0,
      "0",
      -5,
      {},
      [],
    ]) {
      expect(resolveNetworkMapMaxSites(value, FALLBACK)).toBe(FALLBACK);
    }
  });

  test("floors a fractional count rather than sending it to the server", () => {
    expect(resolveNetworkMapMaxSites(40.9, FALLBACK)).toBe(40);
    expect(resolveNetworkMapMaxSites("40.9", FALLBACK)).toBe(40);
  });

  /*
   * A pasted 100000 would otherwise become a server-side "limit too large"
   * error and an empty widget — a settings value that breaks the widget
   * rather than being ignored.
   */
  test("clamps an absurd count to something the server will serve", () => {
    expect(resolveNetworkMapMaxSites(100000, FALLBACK)).toBe(
      NETWORK_MAP_MAX_SITES_CEILING,
    );
    expect(NETWORK_MAP_MAX_SITES_CEILING).toBeLessThan(LIMIT_PER_PROJECT);
  });

  /*
   * The widget asks for one row MORE than the cap so it can tell "exactly
   * at the cap" from "there is more", so the ceiling has to leave room for
   * that extra row inside the server's own limit.
   */
  test("leaves room for the extra probe row inside the server's limit", () => {
    expect(NETWORK_MAP_MAX_SITES_CEILING + 1).toBeLessThanOrEqual(
      LIMIT_PER_PROJECT,
    );
  });
});

describe("networkMapClusterCellSize", () => {
  /*
   * The cell is a constant distance ON SCREEN, so it covers less and less of
   * the world as the map zooms in — which is what lets a lump of nearby
   * sites come apart instead of staying one blob at every zoom.
   */
  test("shrinks in world units as the frame zooms in", () => {
    const world: number = networkMapClusterCellSize(WORLD_VIEWPORT);
    const zoomed: number = networkMapClusterCellSize({
      x: 0,
      y: 0,
      width: WORLD_VIEWPORT.width / 4,
      height: WORLD_VIEWPORT.height / 4,
    });

    expect(world).toBeCloseTo(NETWORK_MAP_CLUSTER_CELL_SIZE, 6);
    expect(zoomed).toBeLessThan(world);
    expect(zoomed).toBeCloseTo(NETWORK_MAP_CLUSTER_CELL_SIZE / 4, 6);
  });
});

// -- palette and legend ----------------------------------------------------

describe("NETWORK_MAP_LEGEND", () => {
  test("names every color the markers can be painted", () => {
    expect(
      NETWORK_MAP_LEGEND.map((entry: NetworkMapLegendEntry): string => {
        return entry.key;
      }).sort(),
    ).toEqual(Object.keys(NETWORK_MAP_COLORS).sort());
  });

  test("uses the same hex for a key as the markers do", () => {
    for (const entry of NETWORK_MAP_LEGEND) {
      expect(entry.color).toBe(NETWORK_MAP_COLORS[entry.key]);
      expect(entry.label.trim().length).toBeGreaterThan(0);
    }
  });

  /*
   * A reader scans a legend for trouble. Healthy first, then the two
   * degrees of "look at me", then the absence of data.
   */
  test("orders the legend healthy-first", () => {
    expect(
      NETWORK_MAP_LEGEND.map((entry: NetworkMapLegendEntry): string => {
        return entry.key;
      }),
    ).toEqual(["ok", "mixed", "down", "none"]);
  });
});

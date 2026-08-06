import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  GeometryFeature,
  GeometryTier,
  getCachedGeometryFeatures,
  loadGeometryFeatures,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/Geo/WorldGeometry";
import { ROBINSON_VIEW_BOX } from "../../FeatureSet/Dashboard/src/Components/NetworkSite/Geo/GeoProjection";

/*
 * The on-demand loader for the checked-in country outlines, shared by the
 * Network Map PAGE (SiteGeoMap) and the Network Map dashboard WIDGET.
 *
 * Two invariants live here, and both are about bytes a viewer downloads:
 *
 *  - The geometry is ~600 KB across both tiers, and every route module in
 *    the dashboard lands in ONE shared esbuild chunk. A static import would
 *    make Incidents, a monitor and Settings all download and parse country
 *    outlines they never draw.
 *
 *  - The cache is module-level, so a page showing the full map above a
 *    dashboard tile fetches the outlines once between them rather than
 *    once each. That only holds while both surfaces go through THIS module
 *    — which is why the loader was lifted out of SiteGeoMap.tsx.
 */

const GEO_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "NetworkSite",
  "Geo",
);

function readSource(fileName: string): string {
  return fs.readFileSync(path.join(GEO_DIR, fileName), "utf8");
}

const WIDGET_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "Dashboard",
  "Components",
  "DashboardNetworkMapComponent.tsx",
);

const SITE_GEO_MAP_PATH: string = path.join(GEO_DIR, "..", "SiteGeoMap.tsx");

describe("WorldGeometry source", () => {
  test("neither tier is statically imported", () => {
    expect(readSource("WorldGeometry.ts")).not.toMatch(
      /import \S+ from "\.\/WorldCountries\w*Geometry\.json";/,
    );
  });

  test("both tiers are loaded lazily, by literal specifier", () => {
    // Literal specifiers so esbuild can see both targets and split them out.
    const source: string = readSource("WorldGeometry.ts");

    expect(source).toContain('await import("./WorldCountriesGeometry.json")');
    expect(source).toContain(
      'await import("./WorldCountriesDetailGeometry.json")',
    );
  });

  /*
   * Both consumers must go through this module, or the shared cache is a
   * lie and the second surface on screen re-downloads 600 KB.
   */
  test("both map surfaces load their outlines through this module", () => {
    for (const consumer of [SITE_GEO_MAP_PATH, WIDGET_PATH]) {
      const source: string = fs.readFileSync(consumer, "utf8");

      expect(source).toContain("loadGeometryFeatures");
      expect(source).toContain("Geo/WorldGeometry");
      // Nobody re-implements the import() or keeps a second cache.
      expect(source).not.toContain("WorldCountriesGeometry.json");
      expect(source).not.toContain("WorldCountriesDetailGeometry.json");
    }
  });

  /*
   * A dashboard tile has no zoom controls, so it can never reach the zoom
   * at which the detail tier earns its ~500 KB. Fetching it there would
   * hand that cost to every viewer of every dashboard the widget is on.
   */
  test("the widget never asks for the expensive detail tier", () => {
    const source: string = fs.readFileSync(WIDGET_PATH, "utf8");

    expect(source).not.toContain('loadGeometryFeatures("detail")');
    expect(source).toContain('const GEOMETRY_TIER: GeometryTier = "overview";');
  });
});

describe("loadGeometryFeatures", () => {
  test("loads the overview tier as drawable outlines", async () => {
    const features: Array<GeometryFeature> =
      await loadGeometryFeatures("overview");

    expect(features.length).toBeGreaterThan(0);

    for (const feature of features) {
      expect(typeof feature.id).toBe("string");
      expect(feature.id.length).toBeGreaterThan(0);
      expect(typeof feature.name).toBe("string");
      expect(typeof feature.path).toBe("string");
      expect(feature.path.length).toBeGreaterThan(0);
    }
  });

  test("returns the SAME array on a second call, so nothing is re-parsed", async () => {
    const first: Array<GeometryFeature> =
      await loadGeometryFeatures("overview");
    const second: Array<GeometryFeature> =
      await loadGeometryFeatures("overview");

    expect(second).toBe(first);
  });

  test("exposes the cached tier synchronously once it has been loaded", async () => {
    const loaded: Array<GeometryFeature> =
      await loadGeometryFeatures("overview");

    expect(getCachedGeometryFeatures("overview")).toBe(loaded);
  });

  test("keeps the two tiers in separate cache slots", async () => {
    const overview: Array<GeometryFeature> =
      await loadGeometryFeatures("overview");
    const detail: Array<GeometryFeature> = await loadGeometryFeatures("detail");

    expect(detail).not.toBe(overview);
    expect(getCachedGeometryFeatures("detail")).toBe(detail);
    expect(getCachedGeometryFeatures("overview")).toBe(overview);
  });

  /*
   * The two tiers share a viewBox so the map can swap them under a live
   * frame without every coastline shifting — and so a pin projected at
   * runtime lands on the outline in either one.
   */
  test("both tiers share the runtime projection's viewBox", () => {
    for (const tier of [
      "WorldCountriesGeometry",
      "WorldCountriesDetailGeometry",
    ]) {
      const file: { viewBox: string } = JSON.parse(
        fs.readFileSync(path.join(GEO_DIR, `${tier}.json`), "utf8"),
      ) as { viewBox: string };

      expect(file.viewBox).toBe(ROBINSON_VIEW_BOX);
    }
  });

  test("the detail tier is the richer of the two", async () => {
    const overview: Array<GeometryFeature> =
      await loadGeometryFeatures("overview");
    const detail: Array<GeometryFeature> = await loadGeometryFeatures("detail");

    const totalPathLength: (features: Array<GeometryFeature>) => number = (
      features: Array<GeometryFeature>,
    ): number => {
      return features.reduce(
        (total: number, feature: GeometryFeature): number => {
          return total + feature.path.length;
        },
        0,
      );
    };

    expect(totalPathLength(detail)).toBeGreaterThan(totalPathLength(overview));
  });
});

describe("getCachedGeometryFeatures", () => {
  test("reports null for a tier nothing has loaded yet", () => {
    /*
     * Exercised through a tier name that is not a real one: the two real
     * slots are populated by the tests above, and the loader is a
     * module-level singleton that cannot be reset between them.
     */
    expect(getCachedGeometryFeatures("not-a-tier" as GeometryTier)).toBeNull();
  });
});

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
 * The on-demand loader for the checked-in map geometry, shared by the
 * Network Map PAGE (SiteGeoMap) and the Network Map dashboard WIDGET.
 *
 * Two invariants live here, and both are about bytes a viewer downloads:
 *
 *  - The geometry is ~700 KB across the three tiers, and every route module
 *    in the dashboard lands in ONE shared esbuild chunk. A static import
 *    would make Incidents, a monitor and Settings all download and parse
 *    country outlines they never draw.
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

const GEOMETRY_FILES: Array<string> = [
  "WorldCountriesGeometry.json",
  "WorldCountriesDetailGeometry.json",
  "WorldSubdivisionsGeometry.json",
];

describe("WorldGeometry source", () => {
  test("no tier is statically imported", () => {
    expect(readSource("WorldGeometry.ts")).not.toMatch(
      /import \S+ from "\.\/World\w*\.json";/,
    );
  });

  test("every tier is loaded lazily, by literal specifier", () => {
    // Literal specifiers so esbuild can see every target and split them out.
    const source: string = readSource("WorldGeometry.ts");

    for (const fileName of GEOMETRY_FILES) {
      expect(source).toContain(`await import("./${fileName}")`);
    }
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
      for (const fileName of GEOMETRY_FILES) {
        expect(source).not.toContain(fileName);
      }
    }
  });

  /*
   * A dashboard tile has no zoom controls, so it can never reach the zoom
   * at which the detail tier earns its ~500 KB, or the one at which state
   * lines start meaning anything. Fetching either there would hand that cost
   * to every viewer of every dashboard the widget is on — and draw state
   * lines a few pixels apart on a tile glanced at from across a room.
   */
  test("the widget never asks for the tiers only zoom can earn", () => {
    const source: string = fs.readFileSync(WIDGET_PATH, "utf8");

    expect(source).not.toContain('loadGeometryFeatures("detail")');
    expect(source).not.toContain('loadGeometryFeatures("subdivisions")');
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

  test("keeps every tier in its own cache slot", async () => {
    const overview: Array<GeometryFeature> =
      await loadGeometryFeatures("overview");
    const detail: Array<GeometryFeature> = await loadGeometryFeatures("detail");
    const subdivisions: Array<GeometryFeature> =
      await loadGeometryFeatures("subdivisions");

    expect(detail).not.toBe(overview);
    expect(subdivisions).not.toBe(overview);
    expect(subdivisions).not.toBe(detail);
    expect(getCachedGeometryFeatures("detail")).toBe(detail);
    expect(getCachedGeometryFeatures("overview")).toBe(overview);
    expect(getCachedGeometryFeatures("subdivisions")).toBe(subdivisions);
  });

  /*
   * The subdivision tier is drawn ON TOP of the detail outlines rather than
   * instead of them, so a mismatch here would not swap one map for another —
   * it would put every state line somewhere its own country is not.
   */
  test("loads the state and province lines as drawable paths", async () => {
    const features: Array<GeometryFeature> =
      await loadGeometryFeatures("subdivisions");

    expect(features.length).toBeGreaterThan(0);

    for (const feature of features) {
      expect(feature.id.length).toBeGreaterThan(0);
      expect(feature.name.length).toBeGreaterThan(0);
      expect(feature.path.startsWith("M")).toBe(true);
    }
  });

  /*
   * All three files share a viewBox so the map can swap and stack them under
   * a live frame without every coastline shifting — and so a pin projected at
   * runtime lands on the outline in any of them.
   */
  test("every tier shares the runtime projection's viewBox", () => {
    for (const fileName of GEOMETRY_FILES) {
      const file: { viewBox: string } = JSON.parse(
        fs.readFileSync(path.join(GEO_DIR, fileName), "utf8"),
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

/*
 * On-demand loader for the checked-in world country outlines, shared by
 * every surface that draws the map — the Network Map page's SiteGeoMap and
 * the Network Map dashboard widget.
 *
 * Kept react-free (and out of either component) so both share ONE cache: the
 * widget and the page drawn on the same screen fetch the outlines once
 * between them, and so the loader can be unit-tested in a plain
 * Node/TypeScript environment — see GeoProjection.ts for why that matters.
 */

/*
 * One drawable outline, already projected into the Robinson viewBox: a
 * country's coastline in the two country tiers, or one country's whole set of
 * internal state and province lines in the subdivision tier.
 */
export interface GeometryFeature {
  id: string;
  name: string;
  path: string;
}

export interface GeometryFile {
  viewBox: string;
  features: Array<GeometryFeature>;
}

/*
 * Geometry ships in three files (see Scripts/Geo/README.md), all in the same
 * viewBox, so swapping or stacking them never moves an outline or a pin:
 *
 *   overview     — small country outlines, drawn at continent-and-wider zoom.
 *   detail       — ~6x larger country outlines, fetched only once somebody
 *                  zooms in far enough for the overview's generalization to
 *                  read as chunky.
 *   subdivisions — the state, province and territory lines INSIDE those
 *                  outlines, drawn on top of the detail tier once the map is
 *                  zoomed in past SUBDIVISION_GEOMETRY_MIN_ZOOM. A country
 *                  outline on its own gives a pin in the middle of the United
 *                  States or India nothing to be located against.
 *
 * None of them is statically imported. Every route module in the dashboard
 * lands in one shared esbuild chunk, so a static import here would make every
 * page — Incidents, a monitor, Settings — download and parse outlines it
 * never draws. They are loaded on demand and memoized for the life of the
 * tab.
 *
 * They stay .json rather than .svg on purpose: esbuild base64-inlines an
 * imported .svg, which would put us straight back in the shared chunk.
 */
export type GeometryTier = "overview" | "detail" | "subdivisions";

const geometryCache: Partial<Record<GeometryTier, Array<GeometryFeature>>> = {};

/** Outlines already in memory for this tier, or null if none are yet. */
export const getCachedGeometryFeatures: (
  tier: GeometryTier,
) => Array<GeometryFeature> | null = (
  tier: GeometryTier,
): Array<GeometryFeature> | null => {
  return geometryCache[tier] || null;
};

export const loadGeometryFeatures: (
  tier: GeometryTier,
) => Promise<Array<GeometryFeature>> = async (
  tier: GeometryTier,
): Promise<Array<GeometryFeature>> => {
  const cached: Array<GeometryFeature> | undefined = geometryCache[tier];
  if (cached) {
    return cached;
  }

  /*
   * The import() calls are written out rather than built from a variable so
   * esbuild can statically see every target and emit a chunk for each.
   */
  const loaded: unknown =
    tier === "detail"
      ? await import("./WorldCountriesDetailGeometry.json")
      : tier === "subdivisions"
        ? await import("./WorldSubdivisionsGeometry.json")
        : await import("./WorldCountriesGeometry.json");

  // JSON modules arrive under `default` once bundled, bare under ts-jest.
  const file: GeometryFile = ((loaded as { default?: GeometryFile }).default ||
    loaded) as GeometryFile;
  const features: Array<GeometryFeature> = file.features || [];
  geometryCache[tier] = features;
  return features;
};

# Map Geometry Generator

Generates the checked-in SVG map geometry used by the NetworkSite map views:

- `App/FeatureSet/Dashboard/src/Components/NetworkSite/Geo/UsStatesGeometry.json`
  — US states projected through the AlbersUSA composite projection into a
  `0 0 975 610` viewBox. Entries are `{ id, name, path }` where `id` is the
  two-digit state FIPS code and `path` is an SVG path `d` string.
- `App/FeatureSet/Dashboard/src/Components/NetworkSite/Geo/WorldCountriesGeometry.json`
  — world countries projected through the Robinson projection into a
  `0 0 960 500` viewBox. `id` is the ISO 3166-1 numeric code (as a string,
  zero-padded as shipped by world-atlas).

## Data sources

- **US states**: [`us-atlas`](https://github.com/topojson/us-atlas) npm package
  (`us-atlas@3`, generated from this repo with 3.0.1), `states-10m.json`.
  Derived from the U.S. Census Bureau's cartographic boundary shapefiles —
  public domain.
- **World countries**: [`world-atlas`](https://github.com/topojson/world-atlas)
  npm package (`world-atlas@2`, generated with 2.0.2), `countries-110m.json`.
  Derived from [Natural Earth](https://www.naturalearthdata.com/) — public
  domain.

The raw atlases are NOT checked in — only the projected output is.

## Regeneration

Requires only Node (no npm dependencies) and network access for the two
downloads:

```sh
curl -L -o /tmp/states-10m.json https://unpkg.com/us-atlas@3/states-10m.json
curl -L -o /tmp/countries-110m.json https://unpkg.com/world-atlas@2/countries-110m.json
node ./Scripts/Geo/GenerateMapGeometry.js /tmp/states-10m.json /tmp/countries-110m.json
```

Then re-run the asset tests:

```sh
cd App && npx jest Tests/Dashboard/GeometryAssets Tests/Dashboard/GeoProjection
```

## How it works

1. Decodes the TopoJSON topology (delta-decoded quantized arcs → lon/lat
   rings) and assembles each state's/country's polygon rings.
2. Projects US rings through an AlbersUSA composite projection — conic
   equal-area with parallels 29.5°/45.5° for the lower 48, plus scaled
   Alaska (0.35×) and Hawaii insets at the bottom left, replicating
   `d3.geoAlbersUsa().scale(1300).translate([487.5, 305])` so the classic
   975×610 us-atlas layout matches. Each ring is assigned to the composite
   zone that owns the majority of its vertexes and projected through that
   single zone unclipped, so outlines are never torn at zone boundaries.
3. Projects world rings through the Robinson projection (standard 5°
   interpolation table, linear interpolation) into a 960×500 viewBox.
4. Rounds to 1 decimal, drops consecutive duplicate points (the
   resolution-appropriate simplification that keeps the files small) and
   emits SVG path `d` strings.

## Invariants and edge cases

- **Projection parity**: the projection constants in `GenerateMapGeometry.js`
  MUST stay in sync with
  `App/FeatureSet/Dashboard/src/Components/NetworkSite/Geo/GeoProjection.ts`.
  The runtime projects site pins with the same math, which is what makes a
  pin land exactly on its projected outline.
  `App/Tests/Dashboard/GeometryAssets.test.ts` cross-checks this.
- **Island territories**: American Samoa, Guam, Northern Mariana Islands,
  Puerto Rico and the US Virgin Islands (5 of us-atlas's 56 entries) fall
  outside the AlbersUSA composite and are omitted, leaving 51 features
  (50 states + DC). `projectAlbersUsa` likewise returns `null` for them.
- **Speck threshold**: rings whose projected area is below 0.5 px² are
  dropped (sub-pixel islands that cost bytes but render as nothing). The
  largest ring of every feature is always kept, so nothing disappears
  entirely (e.g. DC survives).
- **Missing ISO ids**: N. Cyprus, Somaliland and Kosovo carry no ISO numeric
  id in Natural Earth; their `name` is used as the `id` so they still render
  with a stable, unique id.
- **Holes**: a feature's path can contain hole rings (MultiPolygon interior
  rings). Render with `fill-rule="evenodd"` to be winding-agnostic.
- **Aleutian tail**: like the canonical us-atlas layout, the far Aleutian
  islands extend slightly past the left viewBox edge (x ≈ −58); an SVG
  viewBox simply clips them.

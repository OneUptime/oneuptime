# Map Geometry Generator

Generates the checked-in SVG map geometry used by the NetworkSite map view.
The map is a single zoomable world map — there is no per-country mode — so
the geometry ships in two resolution tiers that share one viewBox and are
swapped at runtime as the viewport zooms:

- `App/FeatureSet/Dashboard/src/Components/NetworkSite/Geo/WorldCountriesGeometry.json`
  — **overview** outlines, drawn at continent-and-wider zoom.
- `App/FeatureSet/Dashboard/src/Components/NetworkSite/Geo/WorldCountriesDetailGeometry.json`
  — **detail** outlines, loaded on demand once the viewport passes
  `DETAIL_GEOMETRY_MIN_ZOOM` (see `Geo/GeoViewport.ts`).

Both are `{ viewBox, features: [{ id, name, path }] }`, projected through the
Robinson projection into a `0 0 960 500` viewBox. `id` is the ISO 3166-1
numeric code (as a string, zero-padded as shipped by world-atlas).

Because both tiers share the viewBox, swapping tiers never moves a pin or an
outline — it only changes how finely that outline is drawn.

## Data sources

- **Overview**: [`world-atlas`](https://github.com/topojson/world-atlas) npm
  package (`world-atlas@2`, generated with 2.0.2), `countries-110m.json`.
- **Detail**: the same package's `countries-50m.json`.

Both are derived from [Natural Earth](https://www.naturalearthdata.com/) —
public domain. The raw atlases are NOT checked in; only the projected output.

## Regeneration

Requires only Node (no npm dependencies) and network access for the two
downloads:

```sh
curl -L -o /tmp/countries-110m.json https://unpkg.com/world-atlas@2/countries-110m.json
curl -L -o /tmp/countries-50m.json https://unpkg.com/world-atlas@2/countries-50m.json
node ./Scripts/Geo/GenerateMapGeometry.js /tmp/countries-110m.json /tmp/countries-50m.json
```

Then re-run the asset tests:

```sh
cd App && npx jest Tests/Dashboard/GeometryAssets Tests/Dashboard/GeoProjection
```

## How it works

1. Decodes the TopoJSON topology (delta-decoded quantized arcs → lon/lat
   rings) and assembles each country's polygon rings.
2. Cuts any ring that crosses the ±180° antimeridian at the meridian.
3. Projects the rings through the Robinson projection (standard 5°
   interpolation table, linear interpolation) into the 960×500 viewBox.
4. Simplifies each ring with Douglas-Peucker at the tier's tolerance, rounds
   to the tier's precision, and emits SVG path `d` strings.

## Tier settings

| | Source | Decimals | DP tolerance | Min ring area | Output |
|---|---|---|---|---|---|
| Overview | countries-110m | 1 | 0.05 px | 0.5 px² | ~84 KB |
| Detail | countries-50m | 2 | 0.04 px | 0.05 px² | ~511 KB |

The detail tier's 0.04 px tolerance is chosen against the map's zoom limits,
which make two different promises (`Geo/GeoViewport.ts`):

- `FIT_MAX_ZOOM` is the deepest frame the map ever picks for a reader — every
  opening view and every "Fit to sites". At that scale 0.04 viewBox units is
  about one screen pixel, so outlines nobody asked to magnify are exact.
- `MAX_ZOOM` is how far a reader may then push it by hand, and it is
  deliberately deeper: sites in one metro area only come apart well past
  `FIT_MAX_ZOOM`, and separating them is what zoom is for on this map.
  Coastlines soften there — about 2.7 px of simplification at the very
  bottom.

Raising `MAX_ZOOM` further means regenerating with a finer tolerance rather
than letting the outlines polygonize;
`App/Tests/Dashboard/GeometryAssets.test.ts` pins both ends of that trade.

## Invariants and edge cases

- **Projection parity**: the Robinson constants in `GenerateMapGeometry.js`
  MUST stay in sync with
  `App/FeatureSet/Dashboard/src/Components/NetworkSite/Geo/GeoProjection.ts`.
  The runtime projects site pins with the same math, which is what makes a
  pin land exactly on its projected outline.
  `App/Tests/Dashboard/GeometryAssets.test.ts` cross-checks this.
- **Path encoding**: each ring is one absolute `M` followed by a single
  relative `l` polyline (`M245.67,123.45l.03,-.05 .02,.01Z`). Relative steps
  are what make the detail tier affordable — about 40% smaller than absolute
  coordinates. Every step is emitted from the position the renderer is
  actually at, so rounding error cannot accumulate along a coastline, and
  every subpath re-anchors with its own absolute `M`. Anything parsing these
  paths must therefore accumulate deltas, not read absolute pairs.
- **Antimeridian**: Fiji and two Russian polygons cross ±180°. A vertex
  sitting exactly ON the meridian (Fiji has one in the 50m data) leaves no
  direction to read from the segment, so the cut uses the edge that vertex is
  already on — guessing instead puts a piece on the wrong side of the map and
  streaks a line across the whole world.
- **Speck threshold**: rings below the tier's minimum projected area are
  dropped (sub-pixel islands that cost bytes but render as nothing). The
  largest ring of every feature is always kept, so no country disappears.
  The detail tier's threshold is 10× lower, because at zoom those specks are
  real islands.
- **Missing ISO ids**: N. Cyprus, Somaliland and Kosovo carry no ISO numeric
  id in Natural Earth; their `name` is used as the `id` so they still render
  with a stable, unique id.
- **Holes**: a feature's path can contain hole rings (MultiPolygon interior
  rings). Render with `fill-rule="evenodd"` to be winding-agnostic.
- **Feature counts differ between tiers**: 177 overview features, 239 detail
  ones — the finer source carries small states and islands the coarse one
  drops entirely. Nothing may assume the two tiers hold the same id set.

# Map Geometry Generator

Generates the checked-in SVG map geometry used by the NetworkSite map view.
The map is a single zoomable world map — there is no per-country mode — so
the geometry ships in three files that share one viewBox and are swapped or
stacked at runtime as the viewport zooms:

- `App/FeatureSet/Dashboard/src/Components/NetworkSite/Geo/WorldCountriesGeometry.json`
  — **overview** country outlines, drawn at continent-and-wider zoom.
- `App/FeatureSet/Dashboard/src/Components/NetworkSite/Geo/WorldCountriesDetailGeometry.json`
  — **detail** country outlines, loaded on demand once the viewport passes
  `DETAIL_GEOMETRY_MIN_ZOOM` (see `Geo/GeoViewport.ts`).
- `App/FeatureSet/Dashboard/src/Components/NetworkSite/Geo/WorldSubdivisionsGeometry.json`
  — **subdivisions**: the state, province and territory lines _interior_ to a
  country, drawn over the detail outlines once the viewport passes
  `SUBDIVISION_GEOMETRY_MIN_ZOOM`.

All three are `{ viewBox, features: [{ id, name, path }] }`, projected through
the Robinson projection into a `0 0 960 500` viewBox.

Because they share the viewBox, swapping tiers never moves a pin or an
outline — it only changes how finely that outline is drawn.

## Data sources

- **Overview**: [`world-atlas`](https://github.com/topojson/world-atlas) npm
  package (`world-atlas@2`, generated with 2.0.2), `countries-110m.json`.
- **Detail**: the same package's `countries-50m.json`.
- **Subdivisions**:
  [`natural-earth-vector`](https://github.com/nvkelso/natural-earth-vector)'s
  `geojson/ne_50m_admin_1_states_provinces.geojson`.

All are derived from [Natural Earth](https://www.naturalearthdata.com/) —
public domain. The raw sources are NOT checked in; only the projected output.

The `_lakes` variant of the admin-1 file is deliberately NOT used: it cuts
lakes out of the subdivisions, which would leave the state lines stopping at
the shore of a Great Lake that the country outline underneath fills in as
land.

## Regeneration

Requires only Node (no npm dependencies) and network access for the three
downloads:

```sh
curl -L -o /tmp/countries-110m.json https://unpkg.com/world-atlas@2/countries-110m.json
curl -L -o /tmp/countries-50m.json https://unpkg.com/world-atlas@2/countries-50m.json
curl -L -o /tmp/admin-1-50m.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson
node ./Scripts/Geo/GenerateMapGeometry.js /tmp/countries-110m.json /tmp/countries-50m.json /tmp/admin-1-50m.geojson
```

Then re-run the asset tests:

```sh
cd App && npx jest Tests/Dashboard/GeometryAssets Tests/Dashboard/GeoProjection
```

## How it works

### Country tiers

1. Decodes the TopoJSON topology (delta-decoded quantized arcs → lon/lat
   rings) and assembles each country's polygon rings.
2. Cuts any ring that crosses the ±180° antimeridian at the meridian.
3. Projects the rings through the Robinson projection (standard 5°
   interpolation table, linear interpolation) into the 960×500 viewBox.
4. Simplifies each ring with Douglas-Peucker at the tier's tolerance, rounds
   to the tier's precision, and emits SVG path `d` strings.

### Subdivisions

The admin-1 source is a set of _polygons_, one per state or province, and
drawing them as-is would trace every coastline and international border a
second time — on top of the country tier, from a different simplification
pass, so the two would not quite line up. The generator keeps only the
boundaries **interior** to a country:

1. Counts how many subdivision rings trace each undirected lon/lat segment.
   Neighbours trace their shared border in opposite directions, so the
   segment's endpoints are ordered before they are compared.
2. Keeps the segments traced **twice by the same country**. Traced once is an
   outer edge (coastline, or a border with a country the source does not
   cover); traced twice across two countries is an international border — the
   US and Canada both carry the 49th parallel — and the country tier already
   draws both.
3. Walks each ring collecting maximal _runs_ of kept segments, skipping any
   run the neighbouring subdivision already emitted. Runs, not loose
   segments, because Douglas-Peucker can only straighten a line it can see
   the whole of, and because one `M` per border beats one per segment.
4. Projects, simplifies and rounds exactly as above, then emits one feature
   per country whose `path` holds all of that country's internal lines.

## Tier settings

|              | Source         | `id`               | Decimals | DP tolerance | Min ring area | Output  |
| ------------ | -------------- | ------------------ | -------- | ------------ | ------------- | ------- |
| Overview     | countries-110m | ISO 3166-1 numeric | 1        | 0.05 px      | 0.5 px²       | ~84 KB  |
| Detail       | countries-50m  | ISO 3166-1 numeric | 2        | 0.04 px      | 0.05 px²      | ~511 KB |
| Subdivisions | admin-1 50m    | ISO 3166-1 alpha-3 | 2        | 0.04 px      | n/a           | ~111 KB |

The country `id` is the ISO numeric code as a string, zero-padded as shipped
by world-atlas. The subdivision `id` is the source's `adm0_a3` — a different
code space, because the admin-1 source carries no numeric id; nothing joins
the two files by id.

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

The subdivisions share the detail tier's tolerance and precision because they
are drawn at the same zooms and on top of it — a coarser line would miss the
coastline it ends on, and a finer one would be paying for precision the
outline underneath does not have.

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
- **Open vs closed subpaths**: country outlines are closed rings and end in
  `Z`. A subdivision line is an OPEN polyline whose two ends are junctions
  with other borders, and it carries no `Z` — closing it would draw a chord
  straight back across the state. The exception is a subdivision entirely
  enclosed by its own country's others (Nebraska, Madhya Pradesh), whose
  boundary is a closed loop and does end in `Z`. Subdivision paths must
  therefore be rendered with `fill="none"`.
- **Antimeridian**: Fiji and two Russian polygons cross ±180°. A vertex
  sitting exactly ON the meridian (Fiji has one in the 50m data) leaves no
  direction to read from the segment, so the cut uses the edge that vertex is
  already on — guessing instead puts a piece on the wrong side of the map and
  streaks a line across the whole world.
- **Speck threshold**: rings below the tier's minimum projected area are
  dropped (sub-pixel islands that cost bytes but render as nothing). The
  largest ring of every feature is always kept, so no country disappears.
  The detail tier's threshold is 10× lower, because at zoom those specks are
  real islands. Subdivision lines have no such threshold: a short line is not
  an island nobody would miss, it is a fragment of a border, and dropping it
  leaves a gap in the middle of a boundary.
- **Missing ISO ids**: N. Cyprus, Somaliland and Kosovo carry no ISO numeric
  id in Natural Earth; their `name` is used as the `id` so they still render
  with a stable, unique id.
- **Holes**: a country feature's path can contain hole rings (MultiPolygon
  interior rings). Render with `fill-rule="evenodd"` to be winding-agnostic.
- **Feature counts differ between files**: 177 overview countries, 239 detail
  ones — the finer source carries small states and islands the coarse one
  drops entirely. Nothing may assume the two tiers hold the same id set. The
  subdivisions file holds 9 features, one per country: the admin-1 source
  covers exactly the countries whose subdivisions are legible at 1:50m
  (Russia, the US, India, Indonesia, China, Brazil, Canada, Australia and
  South Africa), which is why there is no hand-curated "large countries" list
  anywhere in the code.

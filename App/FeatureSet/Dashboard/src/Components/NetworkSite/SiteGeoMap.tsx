import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import IconProp from "Common/Types/Icon/IconProp";
import {
  ALBERS_USA_VIEW_BOX,
  ALBERS_USA_VIEW_BOX_HEIGHT,
  ALBERS_USA_VIEW_BOX_WIDTH,
  ROBINSON_VIEW_BOX,
  ROBINSON_VIEW_BOX_HEIGHT,
  ROBINSON_VIEW_BOX_WIDTH,
} from "./Geo/GeoProjection";
import { GeoCluster, clusterPoints } from "./Geo/GeoClusterUtil";
import {
  BuildPinsResult,
  ClusterColorKey,
  MapRegion,
  buildPins,
  clusterRadius,
  decideClusterColorKey,
  mapPinFingerprint,
} from "./SiteMapViewModel";
import { MapSiteView } from "./SiteHierarchyTypes";

/*
 * Inline-SVG geo map of network sites: checked-in state/country outlines
 * (projected offline with the exact math in Geo/GeoProjection.ts, so pins
 * projected at runtime land precisely on them) with clustered site markers
 * on top. Pure render — the projection/cluster/color decisions live in the
 * react-free SiteMapViewModel so they stay unit-testable.
 *
 * Clicking a single-site marker drills straight in; clicking a multi-site
 * cluster opens a small popover to pick the site (deliberately zoom-less —
 * the drill-down hierarchy is the zoom). SVG styling mirrors
 * NetworkDeviceGraph: theme CSS variables with hex fallbacks.
 */

interface GeometryFeature {
  id: string;
  name: string;
  path: string;
}

interface GeometryFile {
  viewBox: string;
  features: Array<GeometryFeature>;
}

/*
 * The two outline files are ~281 KB of geometry between them. Every route
 * module in the dashboard lands in one shared esbuild chunk, so a static
 * import here would make every page — Incidents, a monitor, Settings —
 * download and parse country outlines it never draws. They are loaded on
 * demand instead, per region, and memoized for the life of the tab.
 *
 * They stay .json rather than .svg on purpose: esbuild base64-inlines an
 * imported .svg, which would put us straight back in the shared chunk.
 */
const geometryCache: Partial<Record<MapRegion, Array<GeometryFeature>>> = {};

const loadGeometryFeatures: (
  region: MapRegion,
) => Promise<Array<GeometryFeature>> = async (
  region: MapRegion,
): Promise<Array<GeometryFeature>> => {
  const cached: Array<GeometryFeature> | undefined = geometryCache[region];
  if (cached) {
    return cached;
  }

  /*
   * The two import() calls are written out rather than built from a
   * variable so esbuild can statically see both targets and emit a chunk
   * for each.
   */
  const loaded: unknown =
    region === "us"
      ? await import("./Geo/UsStatesGeometry.json")
      : await import("./Geo/WorldCountriesGeometry.json");

  // JSON modules arrive under `default` once bundled, bare under ts-jest.
  const file: GeometryFile = ((loaded as { default?: GeometryFile }).default ||
    loaded) as GeometryFile;
  const features: Array<GeometryFeature> = file.features || [];
  geometryCache[region] = features;
  return features;
};

// Grid cell size (viewBox px) fed to the deterministic pin clustering.
const CLUSTER_CELL_SIZE: number = 28;

const CLUSTER_COLORS: Record<ClusterColorKey, string> = {
  none: "#9ca3af", // gray-400
  ok: "#10b981", // emerald-500
  down: "#ef4444", // red-500
  mixed: "#f59e0b", // amber-500
};

/*
 * Legend entries, in the order a reader scans for trouble: healthy first,
 * then the two degrees of "look at me", then the absence of data. The
 * labels describe what a marker of that color means for the sites under
 * it, which is also what decideClusterColorKey decides.
 */
const LEGEND: Array<{ key: ClusterColorKey; label: string }> = [
  { key: "ok", label: "Operational" },
  { key: "mixed", label: "Degraded" },
  { key: "down", label: "Offline" },
  { key: "none", label: "No status" },
];

const dotColorForSite: (site: MapSiteView) => string = (
  site: MapSiteView,
): string => {
  if (site.isOperational === false) {
    return CLUSTER_COLORS["down"];
  }
  if (site.isOperational === true) {
    return CLUSTER_COLORS["ok"];
  }
  return CLUSTER_COLORS["none"];
};

interface OpenCluster {
  // Cluster centre in viewBox coordinates — anchors the popover.
  x: number;
  y: number;
  ids: Array<string>;
}

interface HoveredCluster {
  x: number;
  y: number;
  label: string;
}

/*
 * Anchor an overlay (hover tooltip / site picker) to a marker, as
 * percentages of the SVG box the overlay shares. Markers near an edge
 * would push a centred overlay outside the card, so the horizontal
 * anchor is clamped and the overlay flips above markers in the lower
 * part of the map.
 */
const overlayPosition: (
  x: number,
  y: number,
  viewWidth: number,
  viewHeight: number,
  offsetPx: number,
) => React.CSSProperties = (
  x: number,
  y: number,
  viewWidth: number,
  viewHeight: number,
  offsetPx: number,
): React.CSSProperties => {
  const leftPercent: number = Math.min(88, Math.max(12, (x / viewWidth) * 100));
  const topPercent: number = (y / viewHeight) * 100;
  const flipAbove: boolean = topPercent > 62;
  return {
    left: `${leftPercent}%`,
    top: `${topPercent}%`,
    transform: flipAbove
      ? `translate(-50%, calc(-100% - ${offsetPx}px))`
      : `translate(-50%, ${offsetPx}px)`,
  };
};

export interface ComponentProps {
  sites: Array<MapSiteView>;
  region: MapRegion;
  onSiteClick: (siteId: string) => void;
}

const SiteGeoMap: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [openCluster, setOpenCluster] = useState<OpenCluster | null>(null);
  const [hovered, setHovered] = useState<HoveredCluster | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [features, setFeatures] = useState<Array<GeometryFeature> | null>(
    geometryCache[props.region] || null,
  );

  /*
   * A popover anchored to a cluster that is no longer there is meaningless
   * — close it. Keyed on the pin geometry, NOT on the sites array's
   * identity: the page's 60-second background poll hands us a brand-new
   * array every minute even when nothing changed, and closing the site
   * picker out from under someone scrolling it is not a data update.
   */
  const pinFingerprint: string = useMemo(() => {
    return mapPinFingerprint(props.sites);
  }, [props.sites]);
  useEffect(() => {
    setOpenCluster(null);
    setHovered(null);
  }, [props.region, pinFingerprint]);

  const isUs: boolean = props.region === "us";

  // Outlines are fetched on demand (see loadGeometryFeatures).
  useEffect(() => {
    let isCurrent: boolean = true;
    setFeatures(geometryCache[props.region] || null);

    loadGeometryFeatures(props.region)
      .then((loaded: Array<GeometryFeature>) => {
        if (isCurrent) {
          setFeatures(loaded);
        }
      })
      .catch(() => {
        /*
         * The outlines are backdrop, not data: if the chunk fails to load
         * (offline, a stale deploy), draw the markers on a bare viewBox
         * rather than blocking the map on decoration.
         */
        if (isCurrent) {
          setFeatures([]);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [props.region]);

  const viewBox: string = isUs ? ALBERS_USA_VIEW_BOX : ROBINSON_VIEW_BOX;
  const viewWidth: number = isUs
    ? ALBERS_USA_VIEW_BOX_WIDTH
    : ROBINSON_VIEW_BOX_WIDTH;
  const viewHeight: number = isUs
    ? ALBERS_USA_VIEW_BOX_HEIGHT
    : ROBINSON_VIEW_BOX_HEIGHT;

  const siteById: Map<string, MapSiteView> = useMemo(() => {
    const map: Map<string, MapSiteView> = new Map<string, MapSiteView>();
    for (const site of props.sites) {
      map.set(site.id, site);
    }
    return map;
  }, [props.sites]);

  const { pins, unmappableCount }: BuildPinsResult = useMemo(() => {
    return buildPins(props.sites, props.region);
  }, [props.sites, props.region]);

  const clusters: Array<GeoCluster> = useMemo(() => {
    return clusterPoints(pins, CLUSTER_CELL_SIZE);
  }, [pins]);

  const tooltipForCluster: (cluster: GeoCluster) => string = (
    cluster: GeoCluster,
  ): string => {
    if (cluster.ids.length === 1) {
      const site: MapSiteView | undefined = siteById.get(cluster.ids[0]!);
      if (!site) {
        return "";
      }
      return site.parentBreadcrumb
        ? `${site.name} — ${site.parentBreadcrumb}`
        : site.name;
    }
    const names: Array<string> = cluster.ids
      .slice(0, 5)
      .map((id: string): string => {
        return siteById.get(id)?.name || "Unnamed site";
      });
    const more: number = cluster.ids.length - names.length;
    return `${cluster.totalCount} sites: ${names.join(", ")}${
      more > 0 ? `, +${more} more` : ""
    }`;
  };

  /*
   * Nothing landed on this projection: say so instead of shipping a blank
   * map. Sites that exist but sit outside the current projection get a
   * different (actionable) message from sites with no coordinates at all.
   */
  if (clusters.length === 0) {
    const hasSites: boolean = props.sites.length > 0;
    let description: string =
      "Sites with a latitude and longitude appear here. Add coordinates to a site to place it on the map.";
    if (hasSites && unmappableCount > 0) {
      description = isUs
        ? `None of the ${unmappableCount} site${
            unmappableCount === 1 ? "" : "s"
          } here can be placed on the United States map. Switch to the World view to see them.`
        : `None of the ${unmappableCount} site${
            unmappableCount === 1 ? "" : "s"
          } here have usable coordinates yet.`;
    }
    return (
      <div className="w-full rounded-lg border border-gray-200 bg-white shadow-sm">
        <EmptyState
          id="site-geo-map-empty"
          icon={isUs ? IconProp.Map : IconProp.Globe}
          title={
            hasSites && unmappableCount > 0
              ? "No sites on this map"
              : "No sites on the map yet"
          }
          description={description}
        />
      </div>
    );
  }

  const mappedCount: number = pins.length;

  return (
    <div className="w-full rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="p-3 sm:p-4">
        {/*
         * This wrapper is exactly the SVG's box, so the percentage-anchored
         * overlays below line up with the markers they point at.
         */}
        <div className="relative">
          {/*
           * Outlines still in flight. The SVG underneath already holds the
           * map's exact box, so a skeleton laid over it keeps the card from
           * jumping and stops half-drawn markers showing on bare white. No
           * copy on purpose — a "loading" line would read as a failure
           * state for what is usually a sub-100ms chunk fetch.
           */}
          {features === null ? (
            <div
              aria-hidden="true"
              data-testid="site-geo-map-skeleton"
              className="absolute inset-0 z-30 animate-pulse rounded-md bg-gray-100"
            />
          ) : (
            <></>
          )}
          <svg
            role="img"
            aria-label={
              isUs ? "United States network site map" : "World network site map"
            }
            viewBox={viewBox}
            preserveAspectRatio="xMidYMid meet"
            className="block"
            style={{ width: "100%", height: "auto", minWidth: "480px" }}
          >
            {/* Land outlines under the pins. */}
            <g>
              {(features || []).map(
                (feature: GeometryFeature): ReactElement => {
                  return (
                    <path
                      key={feature.id}
                      d={feature.path}
                      fillRule="evenodd"
                      fill="var(--ou-surface-quaternary, #e5e7eb)"
                      stroke="var(--ou-chart-tick, #6b7280)"
                      strokeWidth={0.6}
                      strokeOpacity={0.8}
                    >
                      <title>{feature.name}</title>
                    </path>
                  );
                },
              )}
            </g>

            {/* Clustered site markers. */}
            <g>
              {clusters.map((cluster: GeoCluster): ReactElement => {
                const members: Array<MapSiteView> = cluster.ids
                  .map((id: string): MapSiteView | undefined => {
                    return siteById.get(id);
                  })
                  .filter(
                    (site: MapSiteView | undefined): site is MapSiteView => {
                      return site !== undefined;
                    },
                  );
                const colorKey: ClusterColorKey = decideClusterColorKey(
                  members.map((site: MapSiteView) => {
                    return {
                      statusPriority: site.statusPriority,
                      isOperational: site.isOperational,
                    };
                  }),
                );
                const color: string = CLUSTER_COLORS[colorKey];
                const radius: number = clusterRadius(cluster.totalCount);
                const isCluster: boolean = cluster.totalCount > 1;
                const label: string = tooltipForCluster(cluster);
                const key: string = `${cluster.x}:${cluster.y}:${cluster.ids[0]}`;
                const activate: () => void = (): void => {
                  if (cluster.ids.length === 1) {
                    setOpenCluster(null);
                    props.onSiteClick(cluster.ids[0]!);
                  } else {
                    setOpenCluster({
                      x: cluster.x,
                      y: cluster.y,
                      ids: cluster.ids,
                    });
                  }
                };
                return (
                  <g
                    key={key}
                    role="button"
                    tabIndex={0}
                    aria-label={label}
                    style={{ cursor: "pointer", outline: "none" }}
                    onClick={activate}
                    onKeyDown={(event: React.KeyboardEvent<SVGGElement>) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        activate();
                      }
                    }}
                    onMouseEnter={() => {
                      setHovered({ x: cluster.x, y: cluster.y, label: label });
                    }}
                    onMouseLeave={() => {
                      setHovered(null);
                    }}
                    onFocus={() => {
                      setFocusedKey(key);
                      setHovered({ x: cluster.x, y: cluster.y, label: label });
                    }}
                    onBlur={() => {
                      setFocusedKey(null);
                      setHovered(null);
                    }}
                  >
                    {/*
                     * Soft halo in the marker's own color: lifts the pin off
                     * both a pale landmass and a dark one, and gives a
                     * multi-site cluster visible extra weight.
                     */}
                    <circle
                      cx={cluster.x}
                      cy={cluster.y}
                      r={radius + (isCluster ? 4 : 3)}
                      fill={color}
                      fillOpacity={0.18}
                    />
                    <circle
                      cx={cluster.x}
                      cy={cluster.y}
                      r={radius}
                      fill={color}
                      fillOpacity={0.95}
                      stroke="var(--ou-chart-marker-ring, #ffffff)"
                      strokeWidth={isCluster ? 2.5 : 2}
                    />
                    {isCluster ? (
                      <text
                        x={cluster.x}
                        y={cluster.y}
                        dy="0.36em"
                        textAnchor="middle"
                        fontSize={radius >= 14 ? 13 : radius >= 10 ? 11 : 10}
                        fontWeight={700}
                        fill="#ffffff"
                        style={{ pointerEvents: "none" }}
                      >
                        {cluster.totalCount}
                      </text>
                    ) : (
                      <></>
                    )}
                    {/* Keyboard focus ring — the marker has no CSS box to outline. */}
                    {focusedKey === key ? (
                      <circle
                        cx={cluster.x}
                        cy={cluster.y}
                        r={radius + 5}
                        fill="none"
                        stroke="var(--ou-link, #4f46e5)"
                        strokeWidth={2}
                        style={{ pointerEvents: "none" }}
                      />
                    ) : (
                      <></>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>

          {/* Hover/focus label — readable in both themes, unlike a native title. */}
          {hovered && !openCluster ? (
            <div
              className="pointer-events-none absolute z-10 max-w-xs rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 shadow-md"
              style={overlayPosition(
                hovered.x,
                hovered.y,
                viewWidth,
                viewHeight,
                12,
              )}
            >
              {hovered.label}
            </div>
          ) : (
            <></>
          )}

          {/* Site picker for multi-site clusters (zoom-less by design). */}
          {openCluster ? (
            <div
              className="absolute z-20 w-60 rounded-md border border-gray-200 bg-white shadow-lg"
              style={overlayPosition(
                openCluster.x,
                openCluster.y,
                viewWidth,
                viewHeight,
                12,
              )}
            >
              <div className="flex items-center justify-between border-b border-gray-100 px-3 py-1.5">
                <span className="text-xs font-medium text-gray-700">
                  {openCluster.ids.length} sites here
                </span>
                <button
                  type="button"
                  aria-label="Close site list"
                  className="rounded text-xs text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  onClick={() => {
                    setOpenCluster(null);
                  }}
                >
                  ✕
                </button>
              </div>
              <ul role="list" className="max-h-48 overflow-y-auto py-1">
                {openCluster.ids.map((siteId: string): ReactElement | null => {
                  const site: MapSiteView | undefined = siteById.get(siteId);
                  if (!site) {
                    return null;
                  }
                  return (
                    <li key={siteId}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
                        title={
                          site.parentBreadcrumb
                            ? `${site.name} — ${site.parentBreadcrumb}`
                            : site.name
                        }
                        onClick={() => {
                          setOpenCluster(null);
                          props.onSiteClick(siteId);
                        }}
                      >
                        <span
                          className="h-2 w-2 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: dotColorForSite(site) }}
                        />
                        <span className="truncate">{site.name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <></>
          )}
        </div>
      </div>

      {/*
       * Legend + scale line. Without it a viewer cannot tell what a green
       * dot means, or how much of the network the map is actually showing.
       */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-gray-100 px-3 py-2.5 sm:px-4">
        <ul
          role="list"
          className="flex flex-wrap items-center gap-x-3 gap-y-1"
          aria-label="Marker color key"
        >
          {LEGEND.map(
            (entry: { key: ClusterColorKey; label: string }): ReactElement => {
              return (
                <li
                  key={entry.key}
                  className="flex items-center gap-1.5 text-xs text-gray-600"
                >
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full ring-2 ring-white"
                    style={{ backgroundColor: CLUSTER_COLORS[entry.key] }}
                  />
                  {entry.label}
                </li>
              );
            },
          )}
        </ul>

        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 sm:ml-auto">
          <span>
            {mappedCount} site{mappedCount === 1 ? "" : "s"} mapped
          </span>
          {/* Sites the current projection cannot place (e.g. abroad on the US map). */}
          {unmappableCount > 0 ? (
            <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-600">
              {unmappableCount} outside this map
              {isUs ? " — switch to World view" : ""}
            </span>
          ) : (
            <></>
          )}
        </div>
      </div>
    </div>
  );
};

export default SiteGeoMap;

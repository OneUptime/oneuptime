import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import DashboardNetworkMapComponent from "Common/Types/Dashboard/DashboardComponents/DashboardNetworkMapComponent";
import { DEFAULT_MAX_SITES } from "Common/Utils/Dashboard/Components/DashboardNetworkMapComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import DashboardResourceListBase, {
  ResourceListColumn,
} from "./DashboardResourceListBase";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import DashboardResourceList from "../Utils/DashboardResourceList";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import API from "Common/UI/Utils/API/API";
import IconProp from "Common/Types/Icon/IconProp";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import Includes from "Common/Types/BaseDatabase/Includes";
import JSONFunctions from "Common/Types/JSONFunctions";
import ProjectUtil from "Common/UI/Utils/Project";
import ObjectID from "Common/Types/ObjectID";
import Color from "Common/Types/Color";
import Route from "Common/Types/API/Route";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import AppLink from "../../AppLink/AppLink";
import Navigation from "Common/UI/Utils/Navigation";
import {
  GeometryFeature,
  GeometryTier,
  getCachedGeometryFeatures,
  loadGeometryFeatures,
} from "../../NetworkSite/Geo/WorldGeometry";
import {
  MapViewport,
  viewBoxOfViewport,
  zoomOfViewport,
} from "../../NetworkSite/Geo/GeoViewport";
import {
  NETWORK_MAP_LABEL_FONT_SIZE,
  NETWORK_MAP_LEGEND,
  NetworkMapLegendEntry,
  NetworkMapMarker,
  NetworkMapSite,
  NetworkMapSiteInput,
  NetworkMapSitesResult,
  NetworkMapStatusSummary,
  buildNetworkMapMarkers,
  countNetworkMapSitesInViewport,
  describeNetworkMapCoverage,
  fitNetworkMapViewport,
  networkMapClusterCellSize,
  networkMapStatusSummary,
  resolveNetworkMapMaxSites,
  toNetworkMapSites,
} from "./NetworkMapWidgetData";

/*
 * The Network Map widget: this project's network sites drawn on the world,
 * each marker colored by the monitor status rolled up onto its site.
 *
 * Deliberately a PICTURE rather than a place. The full Network Map page
 * (Pages/NetworkSite/NetworkMap) is a drill-down tool with its own zoom, pan
 * and hierarchy; a dashboard tile is glanced at from across a room, so this
 * one has no controls at all — it simply frames itself to the sites it drew
 * and says, in words above the map, how many of them are down. Clicking a
 * marker that stands for exactly one site opens that site.
 *
 * All of the geometry, clustering and color decisions live in the react-free
 * NetworkMapWidgetData module so they stay unit-testable; this file is the
 * fetch and the drawing.
 */

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardNetworkMapComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Site", widthPct: "40%" },
  { label: "Type", widthPct: "25%" },
  { label: "Status", widthPct: "35%" },
];

const EMPTY_MESSAGE: string =
  "No network sites with coordinates. Add latitude and longitude to a site to pin it on the map.";

/*
 * The widget always draws the small overview outlines. The detail tier is
 * ~6x larger and only earns its download once somebody zooms past continent
 * scale — which a dashboard tile, having no zoom controls, never does.
 */
const GEOMETRY_TIER: GeometryTier = "overview";

interface FetchedSites {
  rows: Array<NetworkSite>;
  // The fetch came back at the cap, so there may be sites it never saw.
  isTruncated: boolean;
}

function getSiteRoute(siteId: string): Route | undefined {
  if (!siteId) {
    return undefined;
  }
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_SITE_VIEW] as Route,
    { modelId: new ObjectID(siteId) },
  );
}

/**
 * The one thing a marker links to: the site it stands for, when it stands
 * for exactly one. A cluster has no single destination, so it gets none —
 * picking one of its members for the reader would be a guess.
 */
function getMarkerRoute(marker: NetworkMapMarker): Route | undefined {
  if (marker.ids.length !== 1) {
    return undefined;
  }
  return getSiteRoute(marker.ids[0] as string);
}

const DashboardNetworkMapComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const args: DashboardNetworkMapComponent["arguments"] =
    props.component.arguments;

  /*
   * COERCED, not type-tested. The settings form renders Max Sites as an
   * <input type="number"> whose onChange hands back `e.target.value` — a
   * STRING — and ArgumentsForm copies the form values into the component's
   * arguments verbatim. So the moment somebody edits this field it stops
   * being a number, and a `typeof === "number"` guard would silently ignore
   * the value they typed and keep fetching the default.
   *
   * Clamped one below LIMIT_PER_PROJECT because the fetch asks for one row
   * MORE than the cap (see below) and the server rejects a limit above it.
   */
  const maxSites: number = resolveNetworkMapMaxSites(
    args.maxSites,
    DEFAULT_MAX_SITES,
  );
  const viewMode: "map" | "list" = args.viewMode === "list" ? "list" : "map";
  const showLabels: boolean = args.showLabels !== false;
  const statusFilter: string | undefined = args.statusFilter;
  const networkSiteTypeIds: Array<string> | undefined = args.networkSiteTypeIds;
  const networkSiteTypeIdsKey: string = (networkSiteTypeIds || []).join(",");

  const [fetched, setFetched] = useState<FetchedSites>({
    rows: [],
    isTruncated: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [features, setFeatures] = useState<Array<GeometryFeature> | null>(
    getCachedGeometryFeatures(GEOMETRY_TIER),
  );

  const fetchSites: () => Promise<void> = useCallback(async () => {
    setIsLoading(true);

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!DashboardResourceList.isPublic() && !projectId) {
      setIsLoading(false);
      setError("No project selected.");
      return;
    }

    try {
      const query: Query<NetworkSite> = {
        projectId: projectId,
      } as Query<NetworkSite>;

      /*
       * Filtering on the joined status rather than on a status id keeps the
       * widget honest across projects: "down" means whatever that project
       * marked as a non-operational state, not one hardcoded row.
       */
      if (statusFilter === "down") {
        (query as Record<string, unknown>)["currentMonitorStatus"] = {
          isOperationalState: false,
        };
      } else if (statusFilter === "operational") {
        (query as Record<string, unknown>)["currentMonitorStatus"] = {
          isOperationalState: true,
        };
      }

      if (networkSiteTypeIds && networkSiteTypeIds.length > 0) {
        (query as Record<string, unknown>)["networkSiteTypeId"] = new Includes(
          networkSiteTypeIds,
        );
      }

      const listResult: ListResult<NetworkSite> =
        await ModelAPI.getList<NetworkSite>({
          modelType: NetworkSite,
          requestOptions: DashboardResourceList.getRequestOptions(
            "network-site",
            {
              componentId: props.componentId,
              variables: props.variables,
            },
          ),
          query: query,
          /*
           * One MORE than the cap, on purpose. Asking for exactly the cap
           * makes "a project with exactly 250 sites" indistinguishable from
           * "a project with 2,000" — both come back full — and the widget
           * would tell the first one that sites are being hidden from it.
           * The extra row is the answer, and it is dropped before drawing.
           */
          limit: maxSites + 1,
          skip: 0,
          select: {
            _id: true,
            name: true,
            /*
             * The type NAME comes from the networkSiteType relation, not
             * from NetworkSite.siteType — that column is the deprecated
             * pre-lookup-table string and is dropped in a follow-up PR.
             */
            networkSiteType: {
              name: true,
            },
            latitude: true,
            longitude: true,
            currentMonitorStatus: {
              name: true,
              color: true,
              priority: true,
              isOperationalState: true,
            },
          },
          sort: {
            name: SortOrder.Ascending,
          },
        });

      setFetched({
        rows: listResult.data.slice(0, maxSites),
        isTruncated: listResult.data.length > maxSites,
      });
      setError(null);
    } catch (err: unknown) {
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  }, [
    maxSites,
    statusFilter,
    networkSiteTypeIdsKey,
    props.componentId,
    props.variables,
  ]);

  useEffect(() => {
    fetchSites();
  }, [fetchSites, props.refreshTick]);

  // Outlines are fetched on demand — see Geo/WorldGeometry.ts.
  useEffect(() => {
    if (viewMode !== "map" || features !== null) {
      return;
    }

    let isMounted: boolean = true;

    loadGeometryFeatures(GEOMETRY_TIER)
      .then((loaded: Array<GeometryFeature>) => {
        if (isMounted) {
          setFeatures(loaded);
        }
        return loaded;
      })
      .catch(() => {
        /*
         * The markers are the subject and the outlines are the backdrop, so
         * a failed geometry fetch draws the pins on a bare frame rather than
         * failing the whole widget.
         */
        if (isMounted) {
          setFeatures([]);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [viewMode, features]);

  const parsed: NetworkMapSitesResult = useMemo(() => {
    return toNetworkMapSites(
      fetched.rows.map((row: NetworkSite): NetworkMapSiteInput => {
        const color: Color | undefined = row.currentMonitorStatus?.color as
          | Color
          | undefined;

        return {
          id: (row._id as string) || "",
          name: row.name as string,
          siteType: row.networkSiteType?.name as string,
          latitude: row.latitude as number,
          longitude: row.longitude as number,
          statusName: row.currentMonitorStatus?.name as string,
          statusColor: color ? color.toString() : null,
          statusPriority: row.currentMonitorStatus?.priority as number,
          isOperational:
            typeof row.currentMonitorStatus?.isOperationalState === "boolean"
              ? row.currentMonitorStatus.isOperationalState
              : null,
        };
      }),
    );
  }, [fetched.rows]);

  const sites: Array<NetworkMapSite> = parsed.sites;

  const viewport: MapViewport = useMemo(() => {
    return fitNetworkMapViewport(sites);
  }, [sites]);

  const markers: Array<NetworkMapMarker> = useMemo(() => {
    return buildNetworkMapMarkers({
      sites: sites,
      cellSize: networkMapClusterCellSize(viewport),
      showLabels: showLabels,
      zoom: zoomOfViewport(viewport),
    });
  }, [sites, viewport, showLabels]);

  const summary: NetworkMapStatusSummary = useMemo(() => {
    return networkMapStatusSummary(sites);
  }, [sites]);

  const coverage: string = useMemo(() => {
    return describeNetworkMapCoverage({
      siteCount: sites.length,
      inViewCount: countNetworkMapSitesInViewport(sites, viewport),
      unplacedCount: parsed.unplacedCount,
      isTruncated: fetched.isTruncated,
    });
  }, [sites, viewport, parsed.unplacedCount, fetched.isTruncated]);

  const rows: Array<ReactElement> = useMemo(() => {
    return sites.map((site: NetworkMapSite): ReactElement => {
      const route: Route | undefined = getSiteRoute(site.id);
      const dotColor: string =
        site.statusColor ||
        (site.isOperational === false
          ? "#ef4444"
          : site.isOperational === true
            ? "#10b981"
            : "#9ca3af");

      return (
        <tr
          key={site.id}
          className="hover:bg-gray-50/50 transition-colors duration-100 group"
        >
          <td className="px-3 py-2 text-xs text-gray-700 truncate">
            {route ? (
              <AppLink
                to={route}
                className="hover:underline text-gray-700 group-hover:text-blue-600"
              >
                {site.name}
              </AppLink>
            ) : (
              <span>{site.name}</span>
            )}
          </td>
          <td className="px-3 py-2 text-xs text-gray-500 truncate">
            {site.siteType || "—"}
          </td>
          <td className="px-3 py-2">
            <span
              className="inline-flex items-center gap-1.5 text-xs font-medium"
              style={{ fontSize: "10px" }}
            >
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: dotColor }}
              ></span>
              <span style={{ color: dotColor }}>{site.statusName}</span>
            </span>
          </td>
        </tr>
      );
    });
  }, [sites]);

  /*
   * The list view is the same resource-list chrome every other inventory
   * widget uses, so a dashboard that mixes them stays visually of a piece.
   */
  if (viewMode === "list") {
    return (
      <DashboardResourceListBase
        title={args.title}
        pluralLabel="sites"
        columns={COLUMNS}
        count={sites.length}
        isLoading={isLoading}
        error={error}
        isEmpty={sites.length === 0}
        emptyMessage={EMPTY_MESSAGE}
        emptyIcon={IconProp.Map}
        viewMode="list"
      >
        {rows}
      </DashboardResourceListBase>
    );
  }

  if (isLoading && sites.length === 0) {
    return (
      <div
        className="h-full flex flex-col animate-pulse"
        data-testid="network-map-widget-skeleton"
      >
        <div className="h-3 w-24 bg-gray-100 rounded mb-3"></div>
        <div className="flex-1 rounded-md bg-gray-50"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-2">
        <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center">
          <div className="h-5 w-5 text-gray-300">
            <span className="sr-only">{error}</span>
          </div>
        </div>
        <p className="text-xs text-gray-400 text-center max-w-48">{error}</p>
      </div>
    );
  }

  const zoom: number = zoomOfViewport(viewport);

  return (
    <div
      className="h-full overflow-hidden flex flex-col"
      data-testid="network-map-widget"
      style={{
        opacity: isLoading ? 0.5 : 1,
        transition: "opacity 0.2s ease-in-out",
      }}
    >
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider truncate">
          {args.title || "Network Map"}
        </span>
        <span
          className="text-xs text-gray-300 tabular-nums flex-shrink-0"
          data-testid="network-map-widget-summary"
        >
          {summary.down > 0
            ? `${summary.down} down · ${summary.total} sites`
            : `${summary.total} sites`}
        </span>
      </div>

      {sites.length === 0 ? (
        <div className="flex-1 rounded-md border border-gray-100 flex items-center justify-center px-4 py-8 text-center text-gray-400 text-sm">
          {EMPTY_MESSAGE}
        </div>
      ) : (
        <div className="flex-1 min-h-0 rounded-md border border-gray-100 overflow-hidden relative">
          <svg
            /*
             * `group`, not `img`: the markers inside are focusable buttons,
             * and role="img" would hide every one of them from assistive
             * technology along with the rest of the subtree.
             */
            role="group"
            aria-label={`World map of ${summary.total} network sites, ${summary.down} of them down.`}
            viewBox={viewBoxOfViewport(viewport)}
            preserveAspectRatio="xMidYMid meet"
            className="block w-full h-full"
            data-testid="network-map-widget-svg"
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
                      strokeWidth={0.6 / zoom}
                      strokeOpacity={0.8}
                    />
                  );
                },
              )}
            </g>

            {/* The markers, biggest first so a lone site is never buried. */}
            <g>
              {markers.map((marker: NetworkMapMarker): ReactElement => {
                const radius: number = marker.screenRadius / zoom;
                const route: Route | undefined = getMarkerRoute(marker);

                const onActivate: () => void = () => {
                  if (route) {
                    Navigation.navigate(route);
                  }
                };

                return (
                  <g
                    key={marker.key}
                    data-testid="network-map-widget-marker"
                    role={route ? "button" : undefined}
                    tabIndex={route ? 0 : undefined}
                    aria-label={marker.tooltip}
                    onClick={route ? onActivate : undefined}
                    onKeyDown={
                      route
                        ? (event: React.KeyboardEvent<SVGGElement>) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onActivate();
                            }
                          }
                        : undefined
                    }
                    style={{ cursor: route ? "pointer" : "default" }}
                  >
                    <circle
                      cx={marker.x}
                      cy={marker.y}
                      r={radius}
                      fill={marker.color}
                      fillOpacity={0.85}
                      stroke="var(--ou-surface-primary, #ffffff)"
                      strokeWidth={1.25 / zoom}
                    />
                    {marker.count > 1 ? (
                      <text
                        x={marker.x}
                        y={marker.y}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill="var(--ou-surface-primary, #ffffff)"
                        /*
                         * The same three-step band SiteGeoMap uses, against
                         * the same clusterRadius scale — a size proportional
                         * to the radius reads fine for "7" and overflows the
                         * disc for "128".
                         */
                        fontSize={
                          (marker.screenRadius >= 14
                            ? 13
                            : marker.screenRadius >= 10
                              ? 11
                              : 10) / zoom
                        }
                        fontWeight={600}
                        style={{ pointerEvents: "none" }}
                      >
                        {marker.count}
                      </text>
                    ) : (
                      <></>
                    )}
                    {marker.label && marker.labelPlacement ? (
                      <>
                        {/*
                         * A name that could not fit against its marker is
                         * pushed off it and keeps a thread back, so it is
                         * still obvious whose name it is. Without this, sites
                         * sitting on near-identical coordinates lost every
                         * name but the first.
                         */}
                        {marker.labelPlacement.leaderLine ? (
                          <line
                            x1={
                              marker.x +
                              marker.labelPlacement.leaderLine.x1 / zoom
                            }
                            y1={
                              marker.y +
                              marker.labelPlacement.leaderLine.y1 / zoom
                            }
                            x2={
                              marker.x +
                              marker.labelPlacement.leaderLine.x2 / zoom
                            }
                            y2={
                              marker.y +
                              marker.labelPlacement.leaderLine.y2 / zoom
                            }
                            stroke="var(--ou-text-secondary, #4b5563)"
                            strokeWidth={0.9 / zoom}
                            strokeOpacity={0.7}
                            strokeLinecap="round"
                            style={{ pointerEvents: "none" }}
                          />
                        ) : (
                          <></>
                        )}
                        <text
                          /*
                           * Position and anchor come straight off the
                           * placement, in the screen units the collision pass
                           * measured them in — the map must draw the name in
                           * the box that pass reserved, or the placement it
                           * chose is not the placement drawn.
                           */
                          x={marker.x + marker.labelPlacement.offsetX / zoom}
                          y={marker.y + marker.labelPlacement.offsetY / zoom}
                          dominantBaseline="central"
                          textAnchor={marker.labelPlacement.textAnchor}
                          fill="var(--ou-text-secondary, #4b5563)"
                          fontSize={NETWORK_MAP_LABEL_FONT_SIZE / zoom}
                          stroke="var(--ou-surface-primary, #ffffff)"
                          strokeWidth={2.5 / zoom}
                          paintOrder="stroke"
                          style={{ pointerEvents: "none" }}
                        >
                          {marker.label}
                        </text>
                      </>
                    ) : (
                      <></>
                    )}
                    <title>{marker.tooltip}</title>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mt-2 px-1">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {NETWORK_MAP_LEGEND.map(
            (entry: NetworkMapLegendEntry): ReactElement => {
              return (
                <span
                  key={entry.key}
                  className="inline-flex items-center gap-1 text-gray-400"
                  style={{ fontSize: "10px" }}
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ backgroundColor: entry.color }}
                  ></span>
                  {entry.label}
                </span>
              );
            },
          )}
        </div>
        <span
          className="text-gray-300 tabular-nums flex-shrink-0"
          style={{ fontSize: "10px" }}
          data-testid="network-map-widget-coverage"
        >
          {coverage}
        </span>
      </div>
    </div>
  );
};

/*
 * Deliberately does NOT compare props.variables, unlike every other
 * inventory-list widget.
 *
 * Dashboard variables bind to TELEMETRY attribute keys and are applied to a
 * widget's query by DashboardModelQueryInterpolation. NetworkSite is a plain
 * Postgres row with no telemetry attributes on it — there is no `deviceName`
 * or `k8s.namespace.name` to interpolate against — so this widget never
 * applies them, and re-rendering the map because an unrelated variable
 * changed would refetch and refit the frame for nothing.
 */
function arePropsEqual(prev: ComponentProps, next: ComponentProps): boolean {
  if (
    prev.componentId.toString() !== next.componentId.toString() ||
    prev.refreshTick !== next.refreshTick ||
    prev.isEditMode !== next.isEditMode ||
    prev.isSelected !== next.isSelected ||
    prev.dashboardComponentWidthInPx !== next.dashboardComponentWidthInPx ||
    prev.dashboardComponentHeightInPx !== next.dashboardComponentHeightInPx
  ) {
    return false;
  }

  return JSONFunctions.deepEqual(
    prev.component.arguments,
    next.component.arguments,
  );
}

export default React.memo(DashboardNetworkMapComponentElement, arePropsEqual);

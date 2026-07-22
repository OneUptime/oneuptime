import PageComponentProps from "../PageComponentProps";
import SiteBreadcrumbs from "../../Components/NetworkSite/SiteBreadcrumbs";
import SiteCard from "../../Components/NetworkSite/SiteCard";
import SiteContainerGraph from "../../Components/NetworkSite/SiteContainerGraph";
import SiteGeoMap from "../../Components/NetworkSite/SiteGeoMap";
import {
  NetworkMapDrillState,
  readDrillStateFromUrl,
} from "../../Components/NetworkSite/NetworkMapDrillState";
import { MapRegion } from "../../Components/NetworkSite/SiteMapViewModel";
import {
  MapSiteView,
  SiteBreadcrumbEntry,
  SiteChildView,
  SiteChildrenResponse,
  SiteLinkView,
  SiteMapResponse,
  parseSiteChildrenResponse,
  parseSiteMapResponse,
} from "../../Components/NetworkSite/SiteHierarchyTypes";
import NetworkTopologyLiveView from "../../Components/Topology/NetworkTopologyLiveView";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import NetworkSiteType from "Common/Types/NetworkSite/NetworkSiteType";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Loader, { LoaderType } from "Common/UI/Components/Loader/Loader";
import { Slate500 } from "Common/Types/BrandColors";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { APP_API_URL } from "Common/UI/Config";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Location, useLocation } from "react-router-dom";

/*
 * The drill-down network map — the franchise-network feature's
 * centerpiece. Three views share one page, keyed by the 'site' query
 * param:
 *
 *   ROOT (no site):   geo map (US or World, 'mapRegion' param) with
 *                     clustered pins + root-site cards + WAN link strip.
 *   CONTAINER:        breadcrumbs + a graph of the site's children with
 *                     the links between them — click to go deeper.
 *   UNIT:             breadcrumbs + the live device topology of that
 *                     unit, tiered like a rack diagram.
 *
 * Both params live in the URL via replaceState so a drill position is
 * shareable and survives navigation, without flooding browser history.
 * The children/map endpoints are polled every 60 seconds on the root and
 * container views; the unit view's embedded topology polls itself.
 */

const REFRESH_INTERVAL_MS: number = 60 * 1000;

// Debounce for mirroring drill state into the URL (see Navigation.setQueryString).
const QUERY_STRING_DEBOUNCE_MS: number = 200;

const PAGE_TITLE: string = "Network Map";
const PAGE_DESCRIPTION: string =
  "Your whole network on one map. Marker color shows the worst status at that location — click a marker to drill into a site, or use the cards below.";

/*
 * A labeled band inside the map card. Sections are separated by a rule
 * rather than by margin alone, so the page reads as one designed surface
 * with named parts instead of a stack of loose blocks.
 */
const MapSection: FunctionComponent<{
  title: string;
  hint: string;
  count: number;
  children: ReactElement;
}> = (props: {
  title: string;
  hint: string;
  count: number;
  children: ReactElement;
}): ReactElement => {
  return (
    <div className="mt-6 border-t border-gray-200 pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-gray-900">
          {props.title}
          <span className="ml-2 text-xs font-normal tabular-nums text-gray-400">
            {props.count}
          </span>
        </h3>
        <p className="text-xs text-gray-500">{props.hint}</p>
      </div>
      <div className="mt-3">{props.children}</div>
    </div>
  );
};

const NetworkSiteMap: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Lazy: the URL is read at mount, and after that only when a navigation
   * lands on this route (see the re-seed effect below).
   */
  const [currentSiteId, setCurrentSiteId] = useState<string | null>(
    (): string | null => {
      return readDrillStateFromUrl().siteId;
    },
  );
  const [mapRegion, setMapRegion] = useState<MapRegion>((): MapRegion => {
    return readDrillStateFromUrl().mapRegion;
  });
  const [childrenData, setChildrenData] = useState<SiteChildrenResponse | null>(
    null,
  );
  const [mapData, setMapData] = useState<SiteMapResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * Cancel-stale: every fetch takes a sequence number; only the latest
   * one may write state, so a slow response for the previous drill level
   * can never clobber the current one. The mounted flag keeps background
   * polls from touching an unmounted component.
   */
  const requestSeq: React.MutableRefObject<number> = useRef<number>(0);
  const isMounted: React.MutableRefObject<boolean> = useRef<boolean>(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  /*
   * URL mirror, debounced: rapid drill clicks (or a fast toggle) collapse
   * into one replaceState — Safari rate-limits replaceState calls.
   */
  const pendingQuery: React.MutableRefObject<Dictionary<string | null>> =
    useRef<Dictionary<string | null>>({});
  const queryTimer: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueQueryStringUpdate: (params: Dictionary<string | null>) => void = (
    params: Dictionary<string | null>,
  ): void => {
    pendingQuery.current = { ...pendingQuery.current, ...params };
    if (queryTimer.current) {
      clearTimeout(queryTimer.current);
    }
    queryTimer.current = setTimeout(() => {
      Navigation.setQueryString(pendingQuery.current);
      pendingQuery.current = {};
    }, QUERY_STRING_DEBOUNCE_MS);
  };
  useEffect(() => {
    return () => {
      if (queryTimer.current) {
        clearTimeout(queryTimer.current);
      }
    };
  }, []);

  const location: Location = useLocation();

  const fetchData: (
    siteId: string | null,
    region: MapRegion,
    isBackgroundRefresh: boolean,
  ) => Promise<void> = useCallback(
    async (
      siteId: string | null,
      region: MapRegion,
      isBackgroundRefresh: boolean,
    ): Promise<void> => {
      const seq: number = ++requestSeq.current;
      if (!isBackgroundRefresh) {
        setIsLoading(true);
        setError("");
      }

      try {
        const childrenUrl: URL = URL.fromString(
          APP_API_URL.toString(),
        ).addRoute("/network-site/children");
        const mapUrl: URL = URL.fromString(APP_API_URL.toString()).addRoute(
          "/network-site/map",
        );

        /*
         * Project scoping is attached automatically via the tenantid
         * header that ModelAPI.getCommonHeaders() sets from the current
         * project. The map is only fetched at the root level — it shows
         * every pinned site in the project, so a drill level never needs
         * it.
         */
        const childrenPromise: Promise<
          HTTPResponse<JSONObject> | HTTPErrorResponse
        > = API.post<JSONObject>({
          url: childrenUrl,
          data: siteId ? { siteId: siteId } : {},
          headers: { ...ModelAPI.getCommonHeaders() },
        });
        const mapPromise: Promise<
          HTTPResponse<JSONObject> | HTTPErrorResponse
        > | null = siteId
          ? null
          : API.post<JSONObject>({
              url: mapUrl,
              data: { mapRegion: region },
              headers: { ...ModelAPI.getCommonHeaders() },
            });

        const [childrenResponse, mapResponse]: [
          HTTPResponse<JSONObject> | HTTPErrorResponse,
          HTTPResponse<JSONObject> | HTTPErrorResponse | null,
        ] = await Promise.all([
          childrenPromise,
          mapPromise || Promise.resolve(null),
        ]);

        if (!isMounted.current || seq !== requestSeq.current) {
          return; // A newer fetch owns the state now.
        }

        if (childrenResponse instanceof HTTPErrorResponse) {
          throw childrenResponse;
        }
        if (mapResponse && mapResponse instanceof HTTPErrorResponse) {
          throw mapResponse;
        }

        setChildrenData(parseSiteChildrenResponse(childrenResponse.data));
        setMapData(mapResponse ? parseSiteMapResponse(mapResponse.data) : null);
        setError("");
      } catch (err) {
        /*
         * A failed background poll keeps showing the last good view —
         * only a foreground load surfaces the error state.
         */
        if (
          isMounted.current &&
          seq === requestSeq.current &&
          !isBackgroundRefresh
        ) {
          setError(API.getFriendlyMessage(err));
        }
      }

      if (
        isMounted.current &&
        seq === requestSeq.current &&
        !isBackgroundRefresh
      ) {
        setIsLoading(false);
      }
    },
    [],
  );

  /*
   * The current site is the LAST breadcrumb entry of the loaded data.
   * While a foreground load is in flight the page shows a loader, so a
   * stale breadcrumb can never drive the wrong view.
   */
  const currentSite: SiteBreadcrumbEntry | null =
    currentSiteId && childrenData && childrenData.breadcrumb.length > 0
      ? childrenData.breadcrumb[childrenData.breadcrumb.length - 1]!
      : null;
  const isUnitView: boolean = Boolean(
    currentSite && currentSite.siteType === NetworkSiteType.Unit,
  );

  // The unit view's embedded topology polls itself — skip our poll there.
  const isUnitViewRef: React.MutableRefObject<boolean> =
    useRef<boolean>(isUnitView);
  useEffect(() => {
    isUnitViewRef.current = isUnitView;
  }, [isUnitView]);

  useEffect(() => {
    fetchData(currentSiteId, mapRegion, false).catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      if (isUnitViewRef.current) {
        return;
      }
      fetchData(currentSiteId, mapRegion, true).catch(() => {
        // Background refresh failures are non-fatal; keep the last view.
      });
    }, REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [currentSiteId, mapRegion, fetchData]);

  /*
   * Drill transitions are made atomic here rather than left to fetchData:
   * the effect that calls it runs after paint, so setting only the site id
   * would commit one frame in which the id is the new level while
   * childrenData/mapData are still the previous one's. Going UP that frame
   * renders the root view over an already-cleared map — the "no sites on
   * the map yet" empty state — before the loader appears. Raising the
   * loader in the same batch as the id closes that gap.
   *
   * Both handlers no-op on an unchanged target: without the guard the
   * effect would not re-run (its deps are identical) and the loader would
   * never be lowered again.
   */
  const changeSite: (siteId: string | null) => void = (
    siteId: string | null,
  ): void => {
    if (siteId === currentSiteId) {
      return;
    }
    setIsLoading(true);
    setError("");
    setCurrentSiteId(siteId);
    queueQueryStringUpdate({ site: siteId });
  };

  const changeRegion: (region: MapRegion) => void = (
    region: MapRegion,
  ): void => {
    if (region === mapRegion) {
      return;
    }
    setIsLoading(true);
    setError("");
    setMapRegion(region);
    queueQueryStringUpdate({ mapRegion: region });
  };

  /*
   * Re-seed the drill position from the URL whenever a navigation lands on
   * this route. The params are otherwise read exactly once, at mount, and our
   * own mirror writes go through replaceState — which react-router never
   * observes — so a location change here always means somebody else asked for
   * a specific view: the sidebar's "Network Map" entry asking for the top
   * (getNetworkMapRootRoute), "Open in Network Map" from a site's detail page,
   * or a back/forward. Without this the mount-time seed wins forever and the
   * page keeps showing whatever level was drilled to, whatever the URL says.
   *
   * This only earns its keep because those links carry a query string: a
   * same-pathname navigation with none is dropped before it reaches the router
   * (Navigation.ts:285), and no location change means no re-seed. Keep the two
   * together — a bare route in the sidebar makes this effect dead code again.
   *
   * Routing it through the same handlers the UI uses is deliberate: they are
   * what makes the transition atomic, and they no-op when the URL already
   * agrees with what is on screen — which is every render but a real
   * navigation.
   */
  useEffect(() => {
    const drillState: NetworkMapDrillState = readDrillStateFromUrl();
    changeSite(drillState.siteId);
    changeRegion(drillState.mapRegion);
  }, [location.key, location.search]);

  const refreshButton: {
    title: string;
    buttonStyle: ButtonStyleType;
    icon: IconProp;
    onClick: () => void;
  } = {
    title: "Refresh",
    buttonStyle: ButtonStyleType.NORMAL,
    icon: IconProp.Refresh,
    onClick: () => {
      fetchData(currentSiteId, mapRegion, false).catch((err: Error) => {
        setError(API.getFriendlyMessage(err));
      });
    },
  };

  /*
   * Loading and error keep the page's own chrome instead of collapsing to a
   * bare spinner: the title stays put, so a slow drill level reads as "this
   * page is working" rather than as a blank screen.
   */
  if (isLoading) {
    return (
      <Card title={PAGE_TITLE} description={PAGE_DESCRIPTION}>
        <div className="flex flex-col items-center justify-center gap-3 py-20">
          {/* Slate reads on both the light and the dark surface; the
           * default VeryLightGray all but vanishes on white. */}
          <Loader loaderType={LoaderType.Bar} size={180} color={Slate500} />
          <p className="text-sm text-gray-500">Loading your network…</p>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card title={PAGE_TITLE} description={PAGE_DESCRIPTION}>
        <ErrorMessage message={error} />
      </Card>
    );
  }

  // UNIT level: the site's live device topology, tiered like a rack diagram.
  if (currentSiteId && isUnitView) {
    return (
      <Fragment>
        <div className="mb-5">
          <SiteBreadcrumbs
            breadcrumb={childrenData?.breadcrumb || []}
            onNavigate={changeSite}
          />
        </div>
        <NetworkTopologyLiveView siteId={currentSiteId} layoutMode="tiered" />
      </Fragment>
    );
  }

  // CONTAINER level: this site's children and the links between them.
  if (currentSiteId && currentSite) {
    return (
      <Fragment>
        <div className="mb-5">
          <SiteBreadcrumbs
            breadcrumb={childrenData?.breadcrumb || []}
            onNavigate={changeSite}
          />
        </div>
        <Card
          title={currentSite.name}
          description={`${currentSite.siteType} — click a site to drill down; a unit opens its device topology.`}
          buttons={[refreshButton]}
        >
          <SiteContainerGraph
            sites={childrenData?.children || []}
            links={childrenData?.links || []}
            childrenTruncated={Boolean(childrenData?.childrenTruncated)}
            descendantCountsTruncated={Boolean(
              childrenData?.descendantCountsTruncated,
            )}
            onSiteClick={changeSite}
          />
        </Card>
      </Fragment>
    );
  }

  // ROOT level: geo map + root-site cards + WAN link strip.
  const rootSites: Array<SiteChildView> = childrenData?.children || [];
  const rootLinks: Array<SiteLinkView> = childrenData?.links || [];
  const pinnedSites: Array<MapSiteView> = mapData?.sites || [];

  if (rootSites.length === 0 && pinnedSites.length === 0) {
    return (
      <Card title={PAGE_TITLE} description={PAGE_DESCRIPTION}>
        {/* EmptyState ships 13rem of vertical padding for a full-page
         * placeholder; inside a card that reads as a hole, so trim it. */}
        <div className="-my-28">
          <EmptyState
            id="network-map-empty"
            icon={IconProp.Globe}
            title="No network sites yet"
            description={
              <span className="mx-auto block max-w-md">
                Model your network as a hierarchy — regions, franchisees,
                markets, units — and this page becomes a drill-down map of all
                of it, from the whole country down to the switch in one store.
              </span>
            }
            footer={
              <Link
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.NETWORK_SITES] as Route,
                )}
                className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                Create your first network site
              </Link>
            }
          />
        </div>
      </Card>
    );
  }

  return (
    <Card
      title={PAGE_TITLE}
      description={PAGE_DESCRIPTION}
      buttons={[refreshButton]}
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* A real segmented control: one inset track, the active segment
         * lifted onto the surface color. */}
        <div
          className="inline-flex rounded-lg bg-gray-100 p-0.5"
          role="group"
          aria-label="Map region"
        >
          {(["us", "world"] as Array<MapRegion>).map(
            (region: MapRegion): ReactElement => {
              const isActive: boolean = mapRegion === region;
              return (
                <button
                  key={region}
                  type="button"
                  data-testid={`network-map-region-${region}`}
                  aria-pressed={isActive}
                  className={`rounded-md px-3 py-1 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    isActive
                      ? "bg-white font-semibold text-gray-900 shadow-sm"
                      : "font-medium text-gray-500 hover:text-gray-900"
                  }`}
                  onClick={() => {
                    changeRegion(region);
                  }}
                >
                  {region === "us" ? "United States" : "World"}
                </button>
              );
            },
          )}
        </div>
        <p className="flex items-center gap-1.5 text-xs text-gray-500">
          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500" />
          Live — updates every minute
        </p>
      </div>

      {mapData?.isTruncated || childrenData?.childrenTruncated ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <Icon className="mt-px h-4 w-4 flex-shrink-0" icon={IconProp.Alert} />
          <span>
            This network is very large, so only part of it is shown. Drill into
            a site to see the rest.
          </span>
        </div>
      ) : (
        <></>
      )}

      <SiteGeoMap
        sites={pinnedSites}
        region={mapRegion}
        onSiteClick={changeSite}
      />

      {rootSites.length > 0 ? (
        <MapSection
          title="Sites"
          count={rootSites.length}
          hint="Click a site to drill into its markets and units."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rootSites.map((site: SiteChildView): ReactElement => {
              return (
                <SiteCard key={site.id} site={site} onClick={changeSite} />
              );
            })}
          </div>
        </MapSection>
      ) : (
        <></>
      )}

      {rootLinks.length > 0 ? (
        <MapSection
          title="WAN links"
          count={rootLinks.length}
          hint="Connections between these top-level sites."
        >
          <div className="flex flex-wrap gap-2">
            {rootLinks.map((link: SiteLinkView): ReactElement => {
              return (
                <span
                  key={link.id}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700"
                  title={
                    link.monitorStatus
                      ? `${link.name} — ${link.monitorStatus.name}`
                      : link.name
                  }
                >
                  <span
                    className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        (link.monitorStatus && link.monitorStatus.color) ||
                        "#9ca3af",
                    }}
                  />
                  <span className="truncate font-medium">{link.name}</span>
                  {link.monitorStatus ? (
                    <span className="flex-shrink-0 text-gray-400">
                      {link.monitorStatus.name}
                    </span>
                  ) : (
                    <></>
                  )}
                </span>
              );
            })}
          </div>
        </MapSection>
      ) : (
        <></>
      )}
    </Card>
  );
};

export default NetworkSiteMap;

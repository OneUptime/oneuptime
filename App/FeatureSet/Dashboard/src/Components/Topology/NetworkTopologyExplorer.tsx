import NetworkTopologyLiveView from "./NetworkTopologyLiveView";
import {
  FlatFallbackReason,
  HierarchyTopologyView,
  HierarchyTopologyViewInput,
  SiteTopologyFilterMode,
  SiteTopologyFilterOption,
  SiteTopologyHealthSummary,
  TOPOLOGY_DEVICES_PARAM,
  TOPOLOGY_SITE_PARAM,
  TopologyDrillState,
  buildSiteTopologyFilterOptions,
  canShowDeviceView,
  describeSiteTopologyFilter,
  describeUnattachedDevices,
  filterSitesByTopologyHealth,
  firstMatchingSiteId,
  flatFallbackReason,
  parseTopologyDrillState,
  pluralChildLabel,
  resolveHierarchyTopologyView,
  summarizeSiteTopologyHealth,
} from "./HierarchyTopologyViewModel";
import SiteBreadcrumbs from "../NetworkSite/SiteBreadcrumbs";
import SiteCard from "../NetworkSite/SiteCard";
import {
  SiteBreadcrumbEntry,
  SiteChildView,
  SiteChildrenResponse,
  parseSiteChildrenResponse,
} from "../NetworkSite/SiteHierarchyTypes";
import {
  filterSitesBySearch,
  normalizeSiteSearchText,
} from "../NetworkSite/SiteSearchUtil";
import { childTypeLabelFor } from "../NetworkSite/SiteMapViewModel";
import StatusChipGroup, { StatusChipOption } from "../Filters/StatusChipGroup";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { Slate500 } from "Common/Types/BrandColors";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Input from "Common/UI/Components/Input/Input";
import Link from "Common/UI/Components/Link/Link";
import Loader, { LoaderType } from "Common/UI/Components/Loader/Loader";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * The network topology, entered through the hierarchy instead of all at
 * once.
 *
 * What this replaces: one flat graph of every device in the project. At the
 * scale issue #3320 reports — 21,700 devices across 949 sites — that graph
 * takes minutes to lay out, drops most of itself on the floor ("this
 * network is very large, so only part of it is shown"), and answers "what
 * needs attention right now" with a field of hundreds of unlabelled
 * two-node clusters that cannot be traced back to the store they came from.
 *
 * What it does instead: shows the levels the customer already models —
 * Region, Market, Unit — one level at a time, each row carrying the health
 * of every device beneath it, and opens the device topology when the drill
 * reaches the bottom. A level is a few dozen cards however large the estate
 * is, and the topology graph is only ever handed one site's devices.
 *
 * The flat map has NOT been deleted. It is what a project with no
 * hierarchy gets, what a project whose devices are not attached to sites
 * gets, and what the "All devices" toggle opens for anyone who wants it —
 * see resolveHierarchyTopologyView, which owns that decision and is tested
 * on its own.
 *
 * Fetch/refresh/render of the device graph itself still belongs to
 * NetworkTopologyLiveView; this component decides WHICH graph, and draws
 * the levels above it.
 */

export interface ComponentProps {
  /*
   * The layout the device topology opens on once the drill reaches it. A
   * drilled site defaults to "tiered" — at one site the graph reads like a
   * rack diagram — while the flat, project-wide map keeps the force layout
   * it has always had.
   */
  siteLayoutMode?: "force" | "tiered" | undefined;
}

const REFRESH_INTERVAL_MS: number = 60 * 1000;

// Debounce for mirroring drill state into the URL (Safari rate-limits it).
const QUERY_STRING_DEBOUNCE_MS: number = 200;

const CARD_TITLE: string = "Network Topology";
const CARD_DESCRIPTION: string =
  "Your network by the levels you model it in. Each card rolls up the health of every device beneath it — open one to go a level deeper, and the last level opens its live device map.";

/*
 * How a load ended. "superseded" is not a failure: a newer request (a
 * drill, a refresh) took ownership of the page state while this one was in
 * flight, and whatever it loads is the right answer.
 */
type FetchOutcome = "loaded" | "failed" | "superseded";

function readDrillStateFromUrl(): TopologyDrillState {
  return parseTopologyDrillState({
    siteId: Navigation.getQueryStringByName(TOPOLOGY_SITE_PARAM),
    devices: Navigation.getQueryStringByName(TOPOLOGY_DEVICES_PARAM),
  });
}

/*
 * The copy under the header when the explorer has fallen back to the flat
 * device map. Each reason is a different situation and gets a different
 * sentence — "no sites yet" is an invitation, "sites but no devices in
 * them" is a misconfiguration worth naming, and "you asked for this" needs
 * no explanation at all.
 */
const FLAT_FALLBACK_COPY: Record<
  Exclude<FlatFallbackReason, null | "requested">,
  string
> = {
  "no-sites":
    "This project has no network sites yet, so the whole network is drawn as one map. Group your devices into sites to browse them level by level.",
  "no-attached-devices":
    "None of your devices are attached to a site yet, so the whole network is drawn as one map. Set a site on a device and it will appear under that site here.",
};

const NetworkTopologyExplorer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  /*
   * Drill position. Read from the URL at mount so a link opens on the level
   * it names, and mirrored back to it (debounced, via replaceState) so what
   * is on screen survives a copy-paste and a reload.
   */
  const [currentSiteId, setCurrentSiteId] = useState<string | null>(
    (): string | null => {
      return readDrillStateFromUrl().siteId;
    },
  );
  const [requestedDeviceView, setRequestedDeviceView] = useState<boolean>(
    (): boolean => {
      return readDrillStateFromUrl().requestedDeviceView;
    },
  );

  const [levelData, setLevelData] = useState<SiteChildrenResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [searchText, setSearchText] = useState<string>("");
  /*
   * Which health states the LEVEL is narrowed to. Opens on "all" and resets
   * on every drill: "needs attention" at one level says nothing about the
   * next, and arriving inside a region with the filter still on shows a
   * level that is mostly empty for a reason two rows up and easy to miss.
   */
  const [healthFilterMode, setHealthFilterMode] =
    useState<SiteTopologyFilterMode>("all");

  /*
   * Cancel-stale: every fetch takes a sequence number and only the latest
   * may write state, so a slow response for the previous level can never
   * clobber the current one.
   */
  const requestSeq: React.MutableRefObject<number> = useRef<number>(0);
  const isMounted: React.MutableRefObject<boolean> = useRef<boolean>(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

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

  const fetchLevel: (
    siteId: string | null,
    isBackgroundRefresh: boolean,
  ) => Promise<FetchOutcome> = useCallback(
    async (
      siteId: string | null,
      isBackgroundRefresh: boolean,
    ): Promise<FetchOutcome> => {
      const seq: number = ++requestSeq.current;
      let outcome: FetchOutcome = "failed";

      if (!isBackgroundRefresh) {
        setIsLoading(true);
        setError("");
      }

      try {
        const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
          "/network-site/children",
        );

        /*
         * Project scoping rides on the tenantid header that
         * ModelAPI.getCommonHeaders() sets from the current project.
         */
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: url,
            data: siteId ? { siteId: siteId } : {},
            headers: { ...ModelAPI.getCommonHeaders() },
          });

        if (!isMounted.current || seq !== requestSeq.current) {
          return "superseded";
        }

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        setLevelData(parseSiteChildrenResponse(response.data));
        setError("");
        outcome = "loaded";
      } catch (err) {
        /*
         * A failed background poll keeps showing the last good level — only
         * a foreground load surfaces the error state.
         */
        if (!isMounted.current || seq !== requestSeq.current) {
          outcome = "superseded";
        } else if (!isBackgroundRefresh) {
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

      return outcome;
    },
    [],
  );

  const isAtRoot: boolean = currentSiteId === null;

  const breadcrumb: Array<SiteBreadcrumbEntry> = levelData?.breadcrumb || [];
  const currentSite: SiteBreadcrumbEntry | null =
    !isAtRoot && breadcrumb.length > 0
      ? breadcrumb[breadcrumb.length - 1]!
      : null;

  const allLevelSites: Array<SiteChildView> = levelData?.children || [];

  const viewInput: HierarchyTopologyViewInput = {
    isAtRoot: isAtRoot,
    isUnitLevel: Boolean(currentSite && currentSite.isUnitLevel),
    childCount: allLevelSites.length,
    attachedDeviceCount: levelData?.deviceScope.attachedDeviceCount ?? 0,
    requestedDeviceView: requestedDeviceView,
  };
  const view: HierarchyTopologyView = resolveHierarchyTopologyView(viewInput);

  /*
   * The device graph polls itself every minute, so while one is on screen
   * this component's own poll is pure waste — and at the root it is a poll
   * over every device in the project.
   */
  const isShowingDeviceGraph: boolean = view !== "hierarchy";
  const isShowingDeviceGraphRef: React.MutableRefObject<boolean> =
    useRef<boolean>(isShowingDeviceGraph);
  isShowingDeviceGraphRef.current = isShowingDeviceGraph;

  useEffect(() => {
    fetchLevel(currentSiteId, false).catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      if (isShowingDeviceGraphRef.current) {
        return;
      }
      fetchLevel(currentSiteId, true).catch(() => {
        // Background refresh failures are non-fatal; keep the last level.
      });
    }, REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [currentSiteId, fetchLevel]);

  /*
   * Drill transitions are made atomic here rather than left to the effect:
   * the effect runs after paint, so setting only the site id would commit
   * one frame in which the id is the new level while levelData is still the
   * previous one's — which renders the wrong view (and, going up, an empty
   * state) before the loader appears.
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
    setSearchText("");
    setHealthFilterMode("all");
    /*
     * A drill is a request for a LEVEL. Carrying "show me devices" into it
     * would open the next site's device map instead of the level the user
     * just clicked on.
     */
    setRequestedDeviceView(false);
    queueQueryStringUpdate({
      [TOPOLOGY_SITE_PARAM]: siteId,
      [TOPOLOGY_DEVICES_PARAM]: null,
    });
  };

  const changeDeviceView: (next: boolean) => void = (next: boolean): void => {
    setRequestedDeviceView(next);
    queueQueryStringUpdate({ [TOPOLOGY_DEVICES_PARAM]: next ? "1" : null });
  };

  /*
   * The level, narrowed. Search first, then health — so the chip counts
   * describe the rows the search left behind rather than a level the reader
   * cannot see.
   */
  const normalizedSearch: string = normalizeSiteSearchText(searchText);
  const searchedSites: Array<SiteChildView> = useMemo(() => {
    return filterSitesBySearch(allLevelSites, normalizedSearch);
  }, [allLevelSites, normalizedSearch]);

  const healthSummary: SiteTopologyHealthSummary = useMemo(() => {
    return summarizeSiteTopologyHealth(searchedSites);
  }, [searchedSites]);

  const visibleSites: Array<SiteChildView> = useMemo(() => {
    return filterSitesByTopologyHealth(searchedSites, healthFilterMode);
  }, [searchedSites, healthFilterMode]);

  /*
   * From the UNFILTERED list on purpose: the label names what the children
   * of this level ARE, and searching for one market does not turn a level
   * of Markets into a level of something else.
   */
  const childTypeLabel: string = childTypeLabelFor(allLevelSites);
  /*
   * The same noun in the plural, for the places a sentence needs one. Site
   * types are free text a customer wrote, so this goes through the shared
   * pluraliser rather than a "+ s" — "Search facilitys" is the tell that
   * two halves of the product disagree about somebody's own vocabulary.
   */
  const childTypeLabelPlural: string = pluralChildLabel(childTypeLabel);

  /*
   * Issue #3320's auto-zoom, at this level: the first site the filter
   * matched. The card is ringed and scrolled into view, and the hint row
   * offers to open it — so a filter lands the reader ON a relevant site
   * instead of somewhere in a grid they then have to search.
   *
   * Listing order, not worst-first: the card the page jumps to has to be
   * one the reader can find again by eye, and a hidden severity sort would
   * move it under them on the next poll.
   */
  const focusedSiteId: string | null = useMemo(() => {
    return firstMatchingSiteId(searchedSites, healthFilterMode);
  }, [searchedSites, healthFilterMode]);

  const gridRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!focusedSiteId || !gridRef.current) {
      return;
    }
    const card: Element | null = gridRef.current.querySelector(
      `[data-testid="site-card-${focusedSiteId}"]`,
    );
    if (card && typeof card.scrollIntoView === "function") {
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [focusedSiteId]);

  const focusedSite: SiteChildView | null = focusedSiteId
    ? visibleSites.find((site: SiteChildView) => {
        return site.id === focusedSiteId;
      }) || null
    : null;

  const chipOptions: Array<StatusChipOption> = useMemo(() => {
    return buildSiteTopologyFilterOptions(healthSummary, childTypeLabel).map(
      (option: SiteTopologyFilterOption): StatusChipOption => {
        return {
          value: option.value,
          label: option.label,
          description: option.description,
          color: option.color,
          count: option.count,
          testId: option.testId,
        };
      },
    );
  }, [healthSummary, childTypeLabel]);

  const refresh: () => void = (): void => {
    fetchLevel(currentSiteId, false).catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  };

  /*
   * ------------------------------------------------------------------
   * Chrome shared by every view
   * ------------------------------------------------------------------
   */

  const ownDeviceCount: number = levelData?.ownDeviceStats.total ?? 0;
  const showDeviceToggle: boolean = canShowDeviceView({
    view: view,
    isAtRoot: isAtRoot,
    ownDeviceCount: ownDeviceCount,
  });
  /*
   * The toggle also has to be reachable FROM the device view it opened —
   * otherwise "All devices" is a one-way door out of the hierarchy.
   */
  const showToggleFromDeviceView: boolean =
    requestedDeviceView &&
    (levelData?.deviceScope.attachedDeviceCount ?? 0) > 0;

  /*
   * The header earns its place only when it can DO something: a breadcrumb
   * with somewhere to go back to, or a scope toggle. A root that fell back
   * to the flat map because the project has no sites (or no devices in
   * them) would otherwise show a lone, inert "All Sites" crumb above a map
   * that is not part of any hierarchy.
   */
  const showHeader: boolean =
    breadcrumb.length > 0 || showDeviceToggle || showToggleFromDeviceView;

  const deviceToggleLabels: { level: string; devices: string } = isAtRoot
    ? { level: "Hierarchy", devices: "All devices" }
    : { level: "Sites here", devices: "Devices here" };

  const header: ReactElement = (
    <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <SiteBreadcrumbs breadcrumb={breadcrumb} onNavigate={changeSite} />
      {showDeviceToggle || showToggleFromDeviceView ? (
        <div
          role="group"
          aria-label={translateString("Topology scope") || "Topology scope"}
          data-testid="topology-hierarchy-scope-toggle"
          className="inline-flex flex-shrink-0 flex-wrap rounded-lg border border-gray-200 bg-gray-50 p-0.5"
        >
          {(
            [
              { value: false, label: deviceToggleLabels.level },
              { value: true, label: deviceToggleLabels.devices },
            ] as Array<{ value: boolean; label: string }>
          ).map((option: { value: boolean; label: string }): ReactElement => {
            const isActive: boolean = requestedDeviceView === option.value;
            return (
              <button
                key={option.label}
                type="button"
                title={option.label}
                aria-pressed={isActive}
                data-testid={`topology-hierarchy-scope-${
                  option.value ? "devices" : "level"
                }`}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  isActive
                    ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200"
                    : "text-gray-500 hover:text-gray-800"
                }`}
                onClick={() => {
                  changeDeviceView(option.value);
                }}
              >
                {translateString(option.label) || option.label}
              </button>
            );
          })}
        </div>
      ) : (
        <></>
      )}
    </div>
  );

  /*
   * ------------------------------------------------------------------
   * Loading and error
   * ------------------------------------------------------------------
   */

  if (isLoading && !levelData) {
    return (
      <Card title={CARD_TITLE} description={CARD_DESCRIPTION}>
        <div className="flex flex-col items-center justify-center gap-3 py-20">
          {/*
           * Slate reads on both the light and the dark surface; the default
           * VeryLightGray all but vanishes on white.
           */}
          <Loader loaderType={LoaderType.Bar} size={180} color={Slate500} />
          <p className="text-sm text-gray-500">
            {translateString("Loading your network…") ||
              "Loading your network…"}
          </p>
        </div>
      </Card>
    );
  }

  if (error && !levelData) {
    return (
      <Card
        title={CARD_TITLE}
        description={CARD_DESCRIPTION}
        buttons={[
          {
            title: "Refresh",
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.Refresh,
            onClick: refresh,
          },
        ]}
      >
        <ErrorMessage message={error} />
      </Card>
    );
  }

  /*
   * ------------------------------------------------------------------
   * The device graph views
   * ------------------------------------------------------------------
   */

  if (view !== "hierarchy") {
    const fallbackReason: FlatFallbackReason = flatFallbackReason(viewInput);
    const explanation: string =
      fallbackReason && fallbackReason !== "requested"
        ? FLAT_FALLBACK_COPY[fallbackReason]
        : "";

    return (
      <Fragment>
        {showHeader ? header : <></>}
        {explanation ? (
          <div
            className="mb-3 rounded-md border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-600"
            data-testid="topology-hierarchy-flat-note"
          >
            {translateString(explanation) || explanation}
          </div>
        ) : (
          <></>
        )}
        <NetworkTopologyLiveView
          /*
           * Remount when the scope changes. The live view owns a viewport,
           * a saved arrangement and a selection keyed to the node set it was
           * given; carrying those across a change of scope would frame the
           * new site's devices to the old site's coordinates.
           */
          key={currentSiteId || "all-devices"}
          siteId={currentSiteId || undefined}
          layoutMode={
            currentSiteId ? props.siteLayoutMode || "tiered" : "force"
          }
        />
      </Fragment>
    );
  }

  /*
   * ------------------------------------------------------------------
   * The hierarchy level
   * ------------------------------------------------------------------
   */

  const unattachedNote: string = describeUnattachedDevices(
    levelData?.deviceScope || {
      attachedDeviceCount: 0,
      unattachedDeviceCount: 0,
    },
  );

  return (
    <Fragment>
      {showHeader ? header : <></>}
      <Card
        title={currentSite ? currentSite.name : CARD_TITLE}
        description={
          currentSite
            ? `The ${childTypeLabelPlural} inside ${
                currentSite.name
              }, each rolling up the health of every device beneath it.`
            : CARD_DESCRIPTION
        }
        buttons={[
          {
            title: "Refresh",
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.Refresh,
            onClick: refresh,
          },
        ]}
      >
        {error ? (
          <div
            className="mb-3 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800"
            data-testid="topology-hierarchy-refresh-error"
          >
            {`${error} — showing the last level that loaded.`}
          </div>
        ) : (
          <></>
        )}

        <div className="mb-4 flex flex-col gap-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="md:w-72">
              <Input
                dataTestId="topology-hierarchy-search"
                placeholder={
                  translateString(`Search ${childTypeLabelPlural}`) ||
                  `Search ${childTypeLabelPlural}`
                }
                value={searchText}
                onChange={(value: string) => {
                  setSearchText(value);
                }}
              />
            </div>
            <p className="text-xs text-gray-500 md:ml-auto">
              {translateString(
                "Counts roll up everything below each card and refresh every minute.",
              ) ||
                "Counts roll up everything below each card and refresh every minute."}
            </p>
          </div>

          {/*
           * The health row. Its own line under the search box rather than a
           * second item beside it — "which of these needs me" is a different
           * question from "which of these am I looking for", and the chips
           * carry counts that make this row the level's status line as much
           * as its filter.
           */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <StatusChipGroup
              dataTestId="topology-hierarchy-health-filter"
              ariaLabel="Filter sites by health"
              options={chipOptions}
              value={healthFilterMode}
              onChange={(value: string) => {
                setHealthFilterMode(value as SiteTopologyFilterMode);
              }}
            />
            <p
              className="text-xs text-gray-500"
              data-testid="topology-hierarchy-filter-hint"
            >
              {describeSiteTopologyFilter({
                mode: healthFilterMode,
                summary: healthSummary,
                childTypeLabel: childTypeLabel,
              })}
            </p>
            {focusedSite ? (
              <button
                type="button"
                data-testid="topology-hierarchy-jump-to-first"
                className="rounded-md px-2 py-1 text-xs font-medium text-indigo-600 underline transition hover:text-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                onClick={() => {
                  changeSite(focusedSite.id);
                }}
              >
                {`Open ${focusedSite.name}`}
              </button>
            ) : (
              <></>
            )}
          </div>
        </div>

        {unattachedNote ? (
          <p
            className="mb-3 text-xs text-gray-500"
            data-testid="topology-hierarchy-unattached-note"
          >
            {unattachedNote}{" "}
            <button
              type="button"
              className="font-medium text-indigo-600 underline hover:text-indigo-800"
              onClick={() => {
                changeDeviceView(true);
              }}
            >
              {translateString("Show every device") || "Show every device"}
            </button>
          </p>
        ) : (
          <></>
        )}

        {levelData?.childrenTruncated ||
        levelData?.descendantCountsTruncated ? (
          <div
            className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800"
            data-testid="topology-hierarchy-truncated-note"
          >
            {translateString(
              "This level is very large, so some of the rollups below may be partial. Search to narrow it down.",
            ) ||
              "This level is very large, so some of the rollups below may be partial. Search to narrow it down."}
          </div>
        ) : (
          <></>
        )}

        {visibleSites.length === 0 ? (
          <EmptyState
            id="topology-hierarchy-empty"
            icon={IconProp.FlowDiagram}
            title={
              normalizedSearch || healthFilterMode !== "all"
                ? "Nothing here matches"
                : "Nothing at this level yet"
            }
            description={
              normalizedSearch || healthFilterMode !== "all"
                ? `No ${childTypeLabelPlural} at this level match what you are looking for. Clear the search or the health filter to see the rest.`
                : `Nothing has been added inside ${
                    currentSite ? currentSite.name : "this project"
                  } yet.`
            }
          />
        ) : (
          <div
            ref={gridRef}
            data-testid="topology-hierarchy-grid"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          >
            {visibleSites.map((site: SiteChildView): ReactElement => {
              return (
                <SiteCard
                  key={site.id}
                  site={site}
                  isHighlighted={site.id === focusedSiteId}
                  onClick={changeSite}
                />
              );
            })}
          </div>
        )}

        {isAtRoot ? (
          <p className="mt-4 text-xs text-gray-500">
            {translateString("Sites are managed in") || "Sites are managed in"}{" "}
            <Link
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.NETWORK_SITES] as Route,
              )}
              className="font-medium text-indigo-600 hover:text-indigo-800"
            >
              Network Sites
            </Link>
            .
          </p>
        ) : (
          <></>
        )}
      </Card>
    </Fragment>
  );
};

export default NetworkTopologyExplorer;

import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricView from "./MetricView";
import AddToDashboardModal from "./AddToDashboardModal";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import MetricExplorerUrl, {
  MetricExplorerUrlParam,
  SerializedMetricFormula,
  SerializedMetricQuery,
} from "Common/Utils/Metrics/MetricExplorerUrl";
import {
  buildFormulaConfigsFromSerializedFormulas,
  buildQueryConfigsFromSerializedQueries,
} from "./Utils/MetricConfigReconstruct";
import ExplorerLink from "./Utils/ExplorerLink";
import TimeRange from "Common/Types/Time/TimeRange";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import AutoRefreshControl from "../TelemetryResource/AutoRefreshControl";
import useAutoRefresh from "../TelemetryResource/useAutoRefresh";
import { AutoRefreshInterval } from "Common/Types/Dashboard/DashboardViewConfig";
import TelemetrySavedViewsControl from "../Telemetry/TelemetrySavedViewsControl";
import MetricSavedView from "Common/Models/DatabaseModels/MetricSavedView";
import TelemetrySavedViewState from "Common/Types/Telemetry/TelemetrySavedViewState";
import TelemetrySavedViewType from "Common/Types/Telemetry/TelemetrySavedViewType";
import Query from "Common/Types/BaseDatabase/Query";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import HintChip from "./HintChip";
import ChartTimeReferenceLineProps from "Common/UI/Components/Charts/Types/TimeReferenceLineProps";
import Incident from "Common/Models/DatabaseModels/Incident";
import Alert from "Common/Models/DatabaseModels/Alert";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";

const AUTO_REFRESH_STORAGE_KEY: string =
  "metric-explorer-auto-refresh-interval";
const SHOW_EVENTS_STORAGE_KEY: string = "metric-explorer-show-events";

// Max incidents and alerts (each) fetched for the event-overlay markers.
const EVENT_OVERLAY_FETCH_LIMIT: number = 50;

// Muted severity-ish marker colors (fallbacks when severity has no color).
const INCIDENT_MARKER_COLOR: string = "#f87171"; // red-400
const ALERT_MARKER_COLOR: string = "#fbbf24"; // amber-400

/*
 * Marker labels render vertically along the reference line, so an
 * unbounded incident/alert title would run down the whole plot height.
 * Only the chart label truncates — the marker's click-through target
 * still opens the full record.
 */
const EVENT_MARKER_TITLE_MAX_LENGTH: number = 40;

function truncateEventMarkerTitle(title: string): string {
  if (title.length <= EVENT_MARKER_TITLE_MAX_LENGTH) {
    return title;
  }

  return `${title.slice(0, EVENT_MARKER_TITLE_MAX_LENGTH).trimEnd()}…`;
}

// One toolbar-button idiom for the explorer's investigation row.
const TOOLBAR_BUTTON_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";
const TOOLBAR_BUTTON_IDLE_CLASS_NAME: string =
  "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50";
const TOOLBAR_BUTTON_ACTIVE_CLASS_NAME: string =
  "border-indigo-300 bg-indigo-50 text-indigo-700";

// One incident/alert mapped onto a chart time marker.
interface EventMarker {
  date: Date;
  label: string;
  color: string;
  route: Route;
}

type ResolveRangeTokenFunction = (rangeToken: string) => InBetween<Date>;

// Resolve a relative token against "now" (re-anchors on every call).
const resolveRangeToken: ResolveRangeTokenFunction = (
  rangeToken: string,
): InBetween<Date> => {
  return RangeStartAndEndDateTimeUtil.getStartAndEndDate({
    range: rangeToken as TimeRange,
  });
};

type GetDefaultEmptyQueryConfigFunction = () => MetricQueryConfigData;

const getDefaultEmptyQueryConfig: GetDefaultEmptyQueryConfigFunction =
  (): MetricQueryConfigData => {
    return {
      id: ObjectID.generate().toString(),
      metricAliasData: {
        metricVariable: "a",
        title: "",
        description: "",
        legend: "",
        legendUnit: "",
      },
      metricQueryData: {
        filterData: {
          metricName: "",
          attributes: {},
          aggegationType: MetricsAggregationType.Avg,
        },
      },
    };
  };

const MetricExplorer: FunctionComponent = (): ReactElement => {
  const metricQueriesFromUrl: Array<SerializedMetricQuery> =
    getMetricQueriesFromQuery();

  const metricFormulasFromUrl: Array<SerializedMetricFormula> =
    getMetricFormulasFromQuery();

  /*
   * Initial time window resolution, in precedence order:
   *  1. `range` token → re-anchor to now (deep links stay rolling; the
   *     mount-time "now" is NOT frozen because refresh re-resolves it).
   *  2. absolute startTime/endTime → pinned Custom window (back-compat
   *     with older links and monitor breach deep links).
   *  3. nothing → the default rolling Past 1 Hour.
   */
  const rangeTokenFromUrl: string | undefined =
    MetricExplorerUrl.getValidRangeToken(
      Navigation.getQueryStringByName(MetricExplorerUrlParam.Range),
    );

  const absoluteWindowFromUrl: InBetween<Date> | null = getTimeRangeFromQuery();

  const initialRangeToken: string | undefined = rangeTokenFromUrl
    ? rangeTokenFromUrl
    : absoluteWindowFromUrl
      ? undefined
      : TimeRange.PAST_ONE_HOUR;

  const initialTimeRange: InBetween<Date> = initialRangeToken
    ? resolveRangeToken(initialRangeToken)
    : absoluteWindowFromUrl!;

  const initialQueryConfigs: Array<MetricQueryConfigData> =
    buildQueryConfigsFromSerializedQueries(metricQueriesFromUrl);

  const initialFormulaConfigs: Array<MetricFormulaConfigData> =
    buildFormulaConfigsFromSerializedFormulas(
      metricFormulasFromUrl,
      initialQueryConfigs.length,
    );

  const [metricViewData, setMetricViewData] = React.useState<MetricViewData>({
    startAndEndDate: initialTimeRange,
    rangeToken: initialRangeToken,
    queryConfigs:
      initialQueryConfigs.length > 0
        ? initialQueryConfigs
        : [getDefaultEmptyQueryConfig()],
    formulaConfigs: initialFormulaConfigs,
  });

  const lastSerializedStateRef: React.MutableRefObject<string> =
    useRef<string>("");

  useEffect(() => {
    const urlParams: Dictionary<string> =
      MetricExplorerUrl.buildQueryParamsFromMetricViewData(metricViewData);

    const serializedState: string = JSON.stringify(urlParams);

    if (serializedState === lastSerializedStateRef.current) {
      return;
    }

    const params: URLSearchParams = new URLSearchParams(window.location.search);

    for (const paramName of Object.values(MetricExplorerUrlParam)) {
      const paramValue: string | undefined = urlParams[paramName];

      if (paramValue !== undefined) {
        params.set(paramName, paramValue);
      } else {
        params.delete(paramName);
      }
    }

    params.delete("metricName");
    params.delete("attributes");
    params.delete("serviceName");

    const newQueryString: string = params.toString();
    const newUrl: string =
      newQueryString.length > 0
        ? `${window.location.pathname}?${newQueryString}`
        : window.location.pathname;

    window.history.replaceState({}, "", newUrl);

    lastSerializedStateRef.current = serializedState;
  }, [metricViewData]);

  /*
   * Refresh plumbing. A refresh re-anchors the relative token to now (the
   * moved end timestamp naturally misses the fetch cache), and bumps the
   * nonce so a PINNED window — whose fetch snapshot cannot otherwise
   * change — bypasses the aggregate result cache too.
   */
  const [refreshNonce, setRefreshNonce] = useState<number>(0);
  const [isFetchingResults, setIsFetchingResults] = useState<boolean>(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  const handleRefresh: VoidFunction = useCallback((): void => {
    setMetricViewData((previous: MetricViewData): MetricViewData => {
      if (!previous.rangeToken) {
        return previous;
      }
      return {
        ...previous,
        startAndEndDate: resolveRangeToken(previous.rangeToken),
      };
    });
    setRefreshNonce((previous: number) => {
      return previous + 1;
    });
  }, []);

  const {
    autoRefreshInterval,
    setAutoRefreshInterval,
  }: {
    autoRefreshInterval: AutoRefreshInterval;
    setAutoRefreshInterval: (interval: AutoRefreshInterval) => void;
  } = useAutoRefresh({
    storageKey: AUTO_REFRESH_STORAGE_KEY,
    onRefresh: handleRefresh,
    defaultInterval: AutoRefreshInterval.OFF,
  });

  // -- Event overlays (incidents + alerts as chart time markers) --

  const [showEvents, setShowEvents] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return true;
    }
    return window.localStorage?.getItem(SHOW_EVENTS_STORAGE_KEY) !== "false";
  });

  const toggleShowEvents: VoidFunction = (): void => {
    setShowEvents((previous: boolean): boolean => {
      const next: boolean = !previous;
      if (typeof window !== "undefined") {
        window.localStorage?.setItem(SHOW_EVENTS_STORAGE_KEY, String(next));
      }
      return next;
    });
  };

  const [eventMarkers, setEventMarkers] = useState<Array<EventMarker>>([]);

  const eventsWindowStartMs: number | undefined =
    metricViewData.startAndEndDate?.startValue instanceof Date
      ? (metricViewData.startAndEndDate.startValue as Date).getTime()
      : undefined;
  const eventsWindowEndMs: number | undefined =
    metricViewData.startAndEndDate?.endValue instanceof Date
      ? (metricViewData.startAndEndDate.endValue as Date).getTime()
      : undefined;

  useEffect(() => {
    if (
      !showEvents ||
      eventsWindowStartMs === undefined ||
      eventsWindowEndMs === undefined
    ) {
      return;
    }

    let isCancelled: boolean = false;

    const fetchEventMarkers: () => Promise<void> = async (): Promise<void> => {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      if (!projectId) {
        return;
      }

      const eventsWindow: InBetween<Date> = new InBetween<Date>(
        new Date(eventsWindowStartMs),
        new Date(eventsWindowEndMs),
      );

      try {
        const [incidents, alerts]: [ListResult<Incident>, ListResult<Alert>] =
          await Promise.all([
            ModelAPI.getList<Incident>({
              modelType: Incident,
              query: {
                projectId: projectId,
                createdAt: eventsWindow,
              },
              select: {
                _id: true,
                title: true,
                createdAt: true,
                incidentSeverity: {
                  name: true,
                  color: true,
                },
              },
              sort: {
                createdAt: SortOrder.Descending,
              },
              limit: EVENT_OVERLAY_FETCH_LIMIT,
              skip: 0,
            }),
            ModelAPI.getList<Alert>({
              modelType: Alert,
              query: {
                projectId: projectId,
                createdAt: eventsWindow,
              },
              select: {
                _id: true,
                title: true,
                createdAt: true,
                alertSeverity: {
                  name: true,
                  color: true,
                },
              },
              sort: {
                createdAt: SortOrder.Descending,
              },
              limit: EVENT_OVERLAY_FETCH_LIMIT,
              skip: 0,
            }),
          ]);

        if (isCancelled) {
          return;
        }

        const markers: Array<EventMarker> = [];

        for (const incident of incidents.data) {
          if (!incident.createdAt || !incident.id) {
            continue;
          }
          markers.push({
            date: OneUptimeDate.fromString(
              incident.createdAt as unknown as string,
            ),
            label: `Incident: ${truncateEventMarkerTitle(incident.title || "")}`,
            color:
              incident.incidentSeverity?.color?.toString() ||
              INCIDENT_MARKER_COLOR,
            route: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENT_VIEW]!,
              { modelId: incident.id },
            ),
          });
        }

        for (const alert of alerts.data) {
          if (!alert.createdAt || !alert.id) {
            continue;
          }
          markers.push({
            date: OneUptimeDate.fromString(
              alert.createdAt as unknown as string,
            ),
            label: `Alert: ${truncateEventMarkerTitle(alert.title || "")}`,
            color: alert.alertSeverity?.color?.toString() || ALERT_MARKER_COLOR,
            route: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERT_VIEW]!,
              { modelId: alert.id },
            ),
          });
        }

        setEventMarkers(markers);
      } catch {
        // Event markers are best-effort — never break the charts.
      }
    };

    void fetchEventMarkers();

    return () => {
      isCancelled = true;
    };
  }, [showEvents, eventsWindowStartMs, eventsWindowEndMs]);

  const eventReferenceLines: Array<ChartTimeReferenceLineProps> =
    useMemo((): Array<ChartTimeReferenceLineProps> => {
      if (!showEvents) {
        return [];
      }
      return eventMarkers.map(
        (marker: EventMarker): ChartTimeReferenceLineProps => {
          return {
            date: marker.date,
            label: marker.label,
            color: marker.color,
            onClick: () => {
              Navigation.navigate(marker.route);
            },
          };
        },
      );
    }, [showEvents, eventMarkers]);

  // -- Saved explorer views --

  const [headerError, setHeaderError] = useState<string>("");

  // A deep link (metricQueries param) must not be clobbered by the default view.
  const hasInitialUrlState: boolean = useMemo((): boolean => {
    return Boolean(
      Navigation.getQueryStringByName(MetricExplorerUrlParam.MetricQueries),
    );
  }, []);

  const captureCurrentState: () => TelemetrySavedViewState =
    useCallback((): TelemetrySavedViewState => {
      /*
       * Persist the serializer's PLAIN shapes (never raw queryConfigs —
       * they can carry runtime function fields), plus the time selection:
       * the relative token when rolling, the absolute window when pinned.
       */
      const metricQueries: Array<SerializedMetricQuery> =
        metricViewData.queryConfigs
          .map((queryConfig: MetricQueryConfigData): SerializedMetricQuery => {
            return MetricExplorerUrl.buildSerializedMetricQuery(queryConfig);
          })
          .filter(MetricExplorerUrl.isMeaningfulMetricQuery);

      const metricFormulas: Array<SerializedMetricFormula> =
        metricViewData.formulaConfigs
          .map(
            (
              formulaConfig: MetricFormulaConfigData,
            ): SerializedMetricFormula => {
              return MetricExplorerUrl.buildSerializedMetricFormula(
                formulaConfig,
              );
            },
          )
          .filter(MetricExplorerUrl.isMeaningfulMetricFormula);

      const startValue: Date | undefined =
        metricViewData.startAndEndDate?.startValue;
      const endValue: Date | undefined =
        metricViewData.startAndEndDate?.endValue;

      const explorerConfig: JSONObject = {
        metricQueries: metricQueries,
        metricFormulas: metricFormulas,
        ...(metricViewData.rangeToken
          ? { rangeToken: metricViewData.rangeToken }
          : {}),
        ...(startValue && endValue
          ? {
              startTime: OneUptimeDate.toString(startValue),
              endTime: OneUptimeDate.toString(endValue),
            }
          : {}),
      } as unknown as JSONObject;

      return { explorerConfig };
    }, [metricViewData]);

  const applySavedViewState: (state: TelemetrySavedViewState) => void =
    useCallback((state: TelemetrySavedViewState): void => {
      const explorerConfig: JSONObject = (state.explorerConfig ||
        {}) as JSONObject;

      /*
       * Round-trip the stored arrays through the URL parsers so saved
       * views get the exact same defensive sanitization as deep links.
       */
      const metricQueries: Array<SerializedMetricQuery> =
        MetricExplorerUrl.parseMetricQueriesParam(
          JSON.stringify(explorerConfig["metricQueries"] || []),
        );
      const metricFormulas: Array<SerializedMetricFormula> =
        MetricExplorerUrl.parseMetricFormulasParam(
          JSON.stringify(explorerConfig["metricFormulas"] || []),
        );

      const queryConfigs: Array<MetricQueryConfigData> =
        buildQueryConfigsFromSerializedQueries(metricQueries);
      const formulaConfigs: Array<MetricFormulaConfigData> =
        buildFormulaConfigsFromSerializedFormulas(
          metricFormulas,
          queryConfigs.length,
        );

      const savedRangeToken: string | undefined =
        MetricExplorerUrl.getValidRangeToken(explorerConfig["rangeToken"]);

      let startAndEndDate: InBetween<Date> | null = null;

      if (!savedRangeToken) {
        const startRaw: unknown = explorerConfig["startTime"];
        const endRaw: unknown = explorerConfig["endTime"];
        if (
          typeof startRaw === "string" &&
          typeof endRaw === "string" &&
          OneUptimeDate.isValidDateString(startRaw) &&
          OneUptimeDate.isValidDateString(endRaw)
        ) {
          startAndEndDate = new InBetween<Date>(
            OneUptimeDate.fromString(startRaw),
            OneUptimeDate.fromString(endRaw),
          );
        }
      }

      // Token re-anchors to now; missing/invalid window → default rolling hour.
      const effectiveRangeToken: string | undefined = savedRangeToken
        ? savedRangeToken
        : startAndEndDate
          ? undefined
          : TimeRange.PAST_ONE_HOUR;

      setMetricViewData({
        startAndEndDate: effectiveRangeToken
          ? resolveRangeToken(effectiveRangeToken)
          : startAndEndDate,
        rangeToken: effectiveRangeToken,
        queryConfigs:
          queryConfigs.length > 0
            ? queryConfigs
            : [getDefaultEmptyQueryConfig()],
        formulaConfigs: formulaConfigs,
      });
    }, []);

  // -- Header actions --

  const timeRangePickerValue: RangeStartAndEndDateTime =
    metricViewData.rangeToken
      ? { range: metricViewData.rangeToken as TimeRange }
      : {
          range: TimeRange.CUSTOM,
          startAndEndDate: metricViewData.startAndEndDate || undefined,
        };

  const handleTimeRangePicked: (value: RangeStartAndEndDateTime) => void = (
    value: RangeStartAndEndDateTime,
  ): void => {
    if (value.range === TimeRange.CUSTOM) {
      if (value.startAndEndDate) {
        setMetricViewData({
          ...metricViewData,
          rangeToken: undefined,
          startAndEndDate: value.startAndEndDate,
        });
      }
      return;
    }

    setMetricViewData({
      ...metricViewData,
      rangeToken: value.range,
      startAndEndDate: resolveRangeToken(value.range),
    });
  };

  /*
   * Cross-signal pivot: open the logs/traces explorer scoped to the
   * CURRENT resolved window via their range=Custom&start&end URL params
   * (window-only — no filter mapping).
   */
  const navigateToSignalWithCurrentWindow: (pageMap: PageMap) => void = (
    pageMap: PageMap,
  ): void => {
    const route: Route = RouteUtil.populateRouteParams(RouteMap[pageMap]!);
    const currentUrl: URL = Navigation.getCurrentURL();
    const targetUrl: URL = new URL(
      currentUrl.protocol,
      currentUrl.hostname,
      route,
    );

    const startValue: Date | undefined =
      metricViewData.startAndEndDate?.startValue;
    const endValue: Date | undefined = metricViewData.startAndEndDate?.endValue;

    if (startValue && endValue) {
      targetUrl.addQueryParam("range", TimeRange.CUSTOM, true);
      targetUrl.addQueryParam(
        "start",
        OneUptimeDate.toString(startValue),
        true,
      );
      targetUrl.addQueryParam("end", OneUptimeDate.toString(endValue), true);
    }

    Navigation.navigate(targetUrl);
  };

  /*
   * "Create monitor from this view": Monitor Create parses the same
   * serializer params (metricQueries/metricFormulas + window) and
   * pre-seeds a Metric monitor.
   */
  const navigateToCreateMonitor: VoidFunction = (): void => {
    const route: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.MONITOR_CREATE]!,
    );
    const currentUrl: URL = Navigation.getCurrentURL();
    const targetUrl: URL = new URL(
      currentUrl.protocol,
      currentUrl.hostname,
      route,
    );

    const urlParams: Dictionary<string> =
      MetricExplorerUrl.buildQueryParamsFromMetricViewData(metricViewData);

    for (const paramName of Object.keys(urlParams)) {
      targetUrl.addQueryParam(paramName, urlParams[paramName] as string, true);
    }

    Navigation.navigate(targetUrl);
  };

  const [showAddToDashboardModal, setShowAddToDashboardModal] =
    useState<boolean>(false);

  return (
    <div>
      <div className="mb-4 space-y-2">
        {headerError ? <HintChip variant="red">{headerError}</HintChip> : null}

        {/*
         * One toolbar row: time window · refresh cadence · signal pivots ·
         * overlays on the left; view identity & share actions on the right.
         * Wraps into stacked clusters on narrow screens.
         */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-y-2">
            <AutoRefreshControl
              autoRefreshInterval={autoRefreshInterval}
              onAutoRefreshIntervalChange={setAutoRefreshInterval}
              onManualRefresh={handleRefresh}
              isRefreshing={isFetchingResults}
              lastRefreshedAt={lastRefreshedAt}
              timeRangePicker={
                <TelemetryTimeRangePicker
                  value={timeRangePickerValue}
                  onChange={handleTimeRangePicked}
                />
              }
            />
            <div className="ml-3 flex items-center gap-2 border-l border-gray-200 pl-3">
              <Tooltip text="Open the logs explorer scoped to this time window">
                <button
                  type="button"
                  aria-label="View logs for this time window"
                  className={`${TOOLBAR_BUTTON_CLASS_NAME} ${TOOLBAR_BUTTON_IDLE_CLASS_NAME}`}
                  onClick={() => {
                    navigateToSignalWithCurrentWindow(PageMap.LOGS);
                  }}
                >
                  <Icon icon={IconProp.Logs} className="h-3.5 w-3.5" />
                  <span>Logs</span>
                </button>
              </Tooltip>
              <Tooltip text="Open the traces explorer scoped to this time window">
                <button
                  type="button"
                  aria-label="View traces for this time window"
                  className={`${TOOLBAR_BUTTON_CLASS_NAME} ${TOOLBAR_BUTTON_IDLE_CLASS_NAME}`}
                  onClick={() => {
                    navigateToSignalWithCurrentWindow(PageMap.TRACES);
                  }}
                >
                  <Icon icon={IconProp.Layers} className="h-3.5 w-3.5" />
                  <span>Traces</span>
                </button>
              </Tooltip>
              <Tooltip
                text={
                  showEvents
                    ? "Hide incident and alert markers on the charts"
                    : "Show incident and alert markers on the charts"
                }
              >
                <button
                  type="button"
                  aria-label="Toggle incident and alert markers"
                  aria-pressed={showEvents}
                  onClick={toggleShowEvents}
                  className={`${TOOLBAR_BUTTON_CLASS_NAME} ${
                    showEvents
                      ? TOOLBAR_BUTTON_ACTIVE_CLASS_NAME
                      : TOOLBAR_BUTTON_IDLE_CLASS_NAME
                  }`}
                >
                  <Icon icon={IconProp.Bolt} className="h-3.5 w-3.5" />
                  <span>Events</span>
                  {showEvents && eventMarkers.length > 0 ? (
                    <span className="rounded-full bg-indigo-100 px-1.5 text-[11px] font-semibold text-indigo-700">
                      {eventMarkers.length}
                    </span>
                  ) : null}
                </button>
              </Tooltip>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <TelemetrySavedViewsControl<MetricSavedView>
              modelType={MetricSavedView}
              savedViewNoun="Metric Explorer"
              explorerLabel="metric explorer"
              hasInitialUrlState={hasInitialUrlState}
              captureCurrentState={captureCurrentState}
              applyState={applySavedViewState}
              onError={setHeaderError}
              additionalQuery={
                {
                  viewType: TelemetrySavedViewType.Explorer,
                } as Query<MetricSavedView>
              }
              additionalSaveFields={
                {
                  viewType: TelemetrySavedViewType.Explorer,
                } as Partial<MetricSavedView>
              }
            />
            <CopyTextButton
              textToBeCopied={ExplorerLink.buildExplorerUrl(
                metricViewData,
              ).toString()}
              label="Copy Link"
              copiedLabel="Link Copied!"
              size="sm"
              variant="ghost"
              title="Copy a shareable link to this view"
            />
            <MoreMenu text="Actions">
              <MoreMenuItem
                key="create-monitor-from-view"
                icon={IconProp.Activity}
                text="Create monitor from this view"
                onClick={navigateToCreateMonitor}
              />
              <MoreMenuItem
                key="add-to-dashboard"
                icon={IconProp.ChartBarSquare}
                text="Add to dashboard"
                onClick={() => {
                  setShowAddToDashboardModal(true);
                }}
              />
            </MoreMenu>
          </div>
        </div>
      </div>

      <MetricView
        data={metricViewData}
        hideStartAndEndDate={true}
        refreshNonce={refreshNonce}
        timeReferenceLines={
          eventReferenceLines.length > 0 ? eventReferenceLines : undefined
        }
        onIsFetchingResultsChange={(isFetching: boolean) => {
          setIsFetchingResults(isFetching);
          if (!isFetching) {
            setLastRefreshedAt(OneUptimeDate.getCurrentDate());
          }
        }}
        onChange={(data: MetricViewData) => {
          setMetricViewData(data);
        }}
      />

      {showAddToDashboardModal ? (
        <AddToDashboardModal
          metricViewData={metricViewData}
          onClose={() => {
            setShowAddToDashboardModal(false);
          }}
        />
      ) : null}
    </div>
  );
};

export default MetricExplorer;

function getMetricQueriesFromQuery(): Array<SerializedMetricQuery> {
  const metricQueriesParam: string | null = Navigation.getQueryStringByName(
    MetricExplorerUrlParam.MetricQueries,
  );

  if (!metricQueriesParam) {
    return [];
  }

  return MetricExplorerUrl.parseMetricQueriesParam(metricQueriesParam);
}

function getMetricFormulasFromQuery(): Array<SerializedMetricFormula> {
  const formulasParam: string | null = Navigation.getQueryStringByName(
    MetricExplorerUrlParam.MetricFormulas,
  );

  if (!formulasParam) {
    return [];
  }

  return MetricExplorerUrl.parseMetricFormulasParam(formulasParam);
}

function getTimeRangeFromQuery(): InBetween<Date> | null {
  const startTimeParam: string | null = Navigation.getQueryStringByName(
    MetricExplorerUrlParam.StartTime,
  );
  const endTimeParam: string | null = Navigation.getQueryStringByName(
    MetricExplorerUrlParam.EndTime,
  );

  if (!startTimeParam || !endTimeParam) {
    return null;
  }

  if (
    !OneUptimeDate.isValidDateString(startTimeParam) ||
    !OneUptimeDate.isValidDateString(endTimeParam)
  ) {
    return null;
  }

  try {
    const startDate: Date = OneUptimeDate.fromString(startTimeParam);
    const endDate: Date = OneUptimeDate.fromString(endTimeParam);

    if (!OneUptimeDate.isOnOrBefore(startDate, endDate)) {
      return null;
    }

    return new InBetween(startDate, endDate);
  } catch {
    return null;
  }
}

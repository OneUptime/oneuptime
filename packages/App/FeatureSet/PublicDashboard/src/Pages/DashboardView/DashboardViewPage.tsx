import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import DashboardCanvas from "../../Components/DashboardCanvas";
import DashboardViewConfig, {
  AutoRefreshInterval,
  getAutoRefreshIntervalInMs,
  getAutoRefreshIntervalLabel,
} from "Common/Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import API from "../../Utils/API";
import { PUBLIC_DASHBOARD_API_URL } from "../../Utils/Config";
import PublicDashboardWidgetContext from "../../Utils/WidgetContext";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import StoredDashboardViewConfig from "Common/Utils/Dashboard/StoredDashboardViewConfig";
import DefaultDashboardSize from "Common/Types/Dashboard/DashboardSize";
import { PromiseVoidFunction, VoidFunction } from "Common/Types/FunctionTypes";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import { DashboardTimeRangeZoom } from "Common/UI/Utils/UseDashboardTimeRangeZoom";
import useDashboardViewerSettings, {
  DashboardViewerSettings,
} from "Common/UI/Utils/UseDashboardViewerSettings";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";
import DashboardVariableUrlState from "Common/Utils/Dashboard/VariableUrlState";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import MoreMenuDivider from "Common/UI/Components/MoreMenu/Divider";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import DashboardVariableSelector from "./DashboardVariableSelector";
import { VariableValueChange } from "Common/UI/Components/Dashboard/DashboardVariableControl";
import MetricUtil from "../../../../Dashboard/src/Components/Metrics/Utils/Metrics";
import { setPublicDashboardContext } from "../../../../Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import PoweredByFooter from "../../Components/PoweredByFooter";
import ThemeMenu from "../../Components/ThemeMenu";
import LogoPlate from "../../Components/LogoPlate";
import { getDefaultChoiceLabel } from "Common/UI/Utils/DefaultChoiceLabel";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  PUBLIC_AUTO_REFRESH_DEFAULT_CHOICE_TEST_ID,
  PUBLIC_AUTO_REFRESH_MENU_LABEL,
  PUBLIC_AUTO_REFRESH_MENU_TEST_ID,
} from "./DashboardToolbarCopy";
import {
  PUBLIC_DASHBOARD_BOARD_TEST_ID,
  PUBLIC_DASHBOARD_FRAME_TEST_ID,
  PUBLIC_DASHBOARD_HEADER_TEST_ID,
  PUBLIC_DASHBOARD_PAGE_TEST_ID,
  PUBLIC_DASHBOARD_TOOLBAR_TEST_ID,
} from "./DashboardViewLayout";

export interface ComponentProps {
  dashboardId: ObjectID;
  onLoadComplete?: (() => void) | undefined;
}

/*
 * An image the public dashboard API sends ({ file: base64, fileType }) as a
 * data: URL, or null when there is none - the API sends null for an image
 * the dashboard does not have, or that is not a file of its own project.
 */
export const getImageDataUrl: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const image: JSONObject = value as JSONObject;
  const file: unknown = image["file"];

  if (typeof file !== "string" || !file) {
    return null;
  }

  const fileType: string =
    typeof image["fileType"] === "string" && image["fileType"]
      ? (image["fileType"] as string)
      : "image/png";

  return `data:${fileType};base64,${file}`;
};

const DashboardViewPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * The board's time range and auto-refresh as this visitor has them,
   * shared with the authenticated dashboard (issue #5080): the link's
   * (?range=, ?refresh=), else the visitor's own pick that their browser
   * remembers for this dashboard, else the dashboard's defaults, else the
   * past hour with no auto-refresh. Inside it, the board's one time range
   * plus the undo behind drag-to-zoom, so a panel gesture means the same
   * thing on both surfaces.
   */
  const viewerSettings: DashboardViewerSettings = useDashboardViewerSettings({
    dashboardId: props.dashboardId.toString(),
  });
  const timeRangeZoom: DashboardTimeRangeZoom = viewerSettings.timeRangeZoom;
  const startAndEndDate: RangeStartAndEndDateTime =
    timeRangeZoom.startAndEndDate;

  const autoRefreshInterval: AutoRefreshInterval =
    viewerSettings.autoRefreshInterval;
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [dashboardVariables, setDashboardVariables] = useState<
    Array<DashboardVariable>
  >([]);
  const autoRefreshTimerRef: React.MutableRefObject<ReturnType<
    typeof setInterval
  > | null> = useRef<ReturnType<typeof setInterval> | null>(null);
  const [refreshTick, setRefreshTick] = useState<number>(0);

  // The board itself: as wide as the page.
  const boardRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);

  const [dashboardTotalWidth, setDashboardTotalWidth] = useState<number>(0);
  const [dashboardName, setDashboardName] = useState<string>("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  // The logo made for the dark theme, drawn instead while the page is dark.
  const [darkThemeLogoUrl, setDarkThemeLogoUrl] = useState<string | null>(null);
  const [pageDescription, setPageDescription] = useState<string>("");
  const [metricTypes, setMetricTypes] = useState<Array<MetricType>>([]);

  const handleResize: VoidFunction = (): void => {
    setDashboardTotalWidth(boardRef.current?.offsetWidth || 0);
  };

  useEffect(() => {
    setDashboardTotalWidth(boardRef.current?.offsetWidth || 0);
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const [dashboardViewConfig, setDashboardViewConfig] =
    useState<DashboardViewConfig>({
      _type: ObjectType.DashboardViewConfig,
      components: [],
      heightInDashboardUnits: DefaultDashboardSize.heightInDashboardUnits,
    });

  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const hasComponents: boolean = Boolean(
    dashboardViewConfig &&
      dashboardViewConfig.components &&
      dashboardViewConfig.components.length > 0,
  );

  const fetchDashboardViewConfig: PromiseVoidFunction =
    async (): Promise<void> => {
      const response: HTTPResponse<JSONObject> = await API.post<JSONObject>({
        url: URL.fromString(PUBLIC_DASHBOARD_API_URL.toString()).addRoute(
          `/view-config/${props.dashboardId.toString()}`,
        ),
        data: {},
      });

      if (response.isFailure() || !response.data) {
        setError("Dashboard not found");
        return;
      }

      /*
       * Read the way the dashboard app reads it (issue #4571): a config the
       * server stored in another shape, or with widgets this version cannot
       * draw, opens with what can be shown instead of not at all.
       */
      const config: DashboardViewConfig = StoredDashboardViewConfig.read(
        response.data["dashboardViewConfig"],
      );

      setDashboardViewConfig(config);
      setDashboardName(
        (response.data["pageTitle"] as string) ||
          (response.data["name"] as string) ||
          "Untitled Dashboard",
      );
      setPageDescription((response.data["pageDescription"] as string) || "");

      // The logos, as data: URLs.
      setLogoUrl(getImageDataUrl(response.data["logoFile"]));
      setDarkThemeLogoUrl(getImageDataUrl(response.data["darkThemeLogoFile"]));

      /*
       * The dashboard's own default time range and auto-refresh, for a
       * visitor on the default; a link's or the visitor's own pick stays.
       */
      viewerSettings.applySavedDefaults(config);

      if (config.variables) {
        const urlSelections: ReturnType<
          typeof DashboardVariableUrlState.parseFromSearch
        > = DashboardVariableUrlState.parseFromSearch(window.location.search);
        const withUrl: Array<DashboardVariable> =
          DashboardVariableUrlState.applyUrlToVariables(
            config.variables,
            urlSelections,
          );
        setDashboardVariables(withUrl);
      }
    };

  /*
   * Best-effort: drives the unit labels shown in chart legends. Each widget
   * also loads metric types on its own for unit conversion, so a failure
   * here never blocks the dashboard from rendering.
   */
  const fetchMetricTypes: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const result: { metricTypes: Array<MetricType> } =
        await MetricUtil.loadAllMetricsTypes({ includeAttributes: false });
      setMetricTypes(result.metricTypes);
    } catch {
      setMetricTypes([]);
    }
  };

  const loadPage: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError(null);

    /*
     * Route the shared widgets' reads to the public, dashboard-scoped
     * endpoints under /public-dashboard-api, through this app's API client,
     * so any auth redirect lands on the master-password page and never on
     * /accounts/login (see PublicDashboardWidgetContext).
     */
    setPublicDashboardContext(
      PublicDashboardWidgetContext.build(props.dashboardId),
    );

    try {
      await fetchDashboardViewConfig();
      await fetchMetricTypes();
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
    props.onLoadComplete?.();
  };

  useEffect(() => {
    loadPage().catch((err: Error) => {
      setError(API.getFriendlyErrorMessage(err as Error));
    });

    return () => {
      // Stop routing widget reads to the public endpoints once this page unmounts.
      setPublicDashboardContext(null);
    };
  }, []);

  // Auto-refresh
  const triggerRefresh: () => void = useCallback(() => {
    setIsRefreshing(true);
    setRefreshTick((prev: number) => {
      return prev + 1;
    });
    setTimeout(() => {
      setIsRefreshing(false);
    }, 500);
  }, []);

  useEffect(() => {
    if (autoRefreshTimerRef.current) {
      clearInterval(autoRefreshTimerRef.current);
      autoRefreshTimerRef.current = null;
    }

    const intervalMs: number | null =
      getAutoRefreshIntervalInMs(autoRefreshInterval);

    if (intervalMs !== null) {
      autoRefreshTimerRef.current = setInterval(() => {
        triggerRefresh();
      }, intervalMs);
    }

    return () => {
      if (autoRefreshTimerRef.current) {
        clearInterval(autoRefreshTimerRef.current);
        autoRefreshTimerRef.current = null;
      }
    };
  }, [autoRefreshInterval, triggerRefresh]);

  const dashboardCanvasRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);

  // Once the board is drawn, the width its widgets are laid out in.
  useEffect(() => {
    if (!isLoading) {
      setDashboardTotalWidth(boardRef.current?.offsetWidth || 0);
    }
  }, [isLoading]);

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  /*
   * The page and the canvas take the dashboard's own grounds
   * (Common/UI/Styles/Theme.css), the ones the dashboard your team sees is
   * drawn on, so each is right in the light theme and the dark one.
   *
   * The page is the width of the screen, and so is the board: it lays its
   * widgets out in that width (DashboardViewLayout), on a phone one under
   * another. The board used to keep 1000px in a frame that scrolled
   * sideways, so a phone showed half of each row of widgets.
   */
  return (
    <div
      className="min-h-screen"
      style={{
        background: "var(--ou-background-primary, #f8f9fb)",
      }}
      data-testid={PUBLIC_DASHBOARD_PAGE_TEST_ID}
    >
      {/* Header */}
      <div
        className="bg-white border-b border-gray-200"
        style={{
          boxShadow: "var(--ou-shadow-sm, 0 1px 3px 0 rgba(0, 0, 0, 0.05))",
        }}
        data-testid={PUBLIC_DASHBOARD_HEADER_TEST_ID}
      >
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-5">
          {/*
           * The title and the toolbar on one row while the title keeps room
           * to be read (18rem); on a phone the toolbar moves under it, at
           * the right, and the title has the whole width - beside the
           * toolbar a phone cut a dashboard's name down to its first word.
           */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            {/* Logo + Title + Description */}
            <div className="flex min-w-0 flex-1 basis-72 items-center gap-3 sm:gap-4">
              {/*
               * The logo, or while the page is dark the logo made for the
               * dark theme (LogoPlate). A dashboard with only a dark theme
               * logo shows it on the dark page and nothing on the light one.
               */}
              {(logoUrl || darkThemeLogoUrl) && (
                <LogoPlate
                  className="flex-shrink-0"
                  darkLogo={
                    darkThemeLogoUrl ? (
                      <img
                        src={darkThemeLogoUrl}
                        alt={dashboardName}
                        className="h-8 w-auto object-contain"
                      />
                    ) : undefined
                  }
                >
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt={dashboardName}
                      className="h-8 w-auto object-contain"
                    />
                  ) : undefined}
                </LogoPlate>
              )}
              <div className="min-w-0">
                {/*
                 * Two lines at most on a phone, one beside the toolbar: a
                 * long name ends in an ellipsis rather than off the page.
                 */}
                <h1 className="line-clamp-2 break-words text-lg font-semibold text-gray-900 sm:line-clamp-1">
                  {dashboardName}
                </h1>
                {pageDescription && (
                  <p className="text-sm text-gray-500 truncate">
                    {pageDescription}
                  </p>
                )}
              </div>
            </div>

            {/* Controls */}
            <div
              className="ml-auto flex items-center gap-2 flex-shrink-0"
              data-testid={PUBLIC_DASHBOARD_TOOLBAR_TEST_ID}
            >
              {isRefreshing &&
                autoRefreshInterval !== AutoRefreshInterval.OFF && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-blue-600">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></span>
                    Refreshing
                  </span>
                )}

              {timeRangeZoom.isZoomed && (
                <Button
                  icon={IconProp.MagnifyingGlassMinus}
                  title="Reset Zoom"
                  buttonStyle={ButtonStyleType.HOVER_PRIMARY_OUTLINE}
                  onClick={() => {
                    timeRangeZoom.resetZoom();
                  }}
                  tooltip="Reset to the time range before the zoom"
                />
              )}

              {hasComponents && (
                <MoreMenu
                  menuIcon={IconProp.Refresh}
                  text={
                    autoRefreshInterval !== AutoRefreshInterval.OFF
                      ? getAutoRefreshIntervalLabel(autoRefreshInterval)
                      : ""
                  }
                  ariaLabel={PUBLIC_AUTO_REFRESH_MENU_LABEL}
                  dataTestId={PUBLIC_AUTO_REFRESH_MENU_TEST_ID}
                >
                  {[
                    /*
                     * First, the dashboard's own interval, "Default (1m)":
                     * the way back from a pick of the visitor's own, which
                     * their browser remembers for this dashboard.
                     */
                    <MoreMenuItem
                      key="default"
                      text={getDefaultChoiceLabel({
                        translator,
                        value: getAutoRefreshIntervalLabel(
                          viewerSettings.defaultAutoRefreshInterval,
                        ),
                      })}
                      icon={
                        viewerSettings.isOnDefaultAutoRefresh
                          ? IconProp.Check
                          : undefined
                      }
                      isIconSpaceReserved={true}
                      isChecked={viewerSettings.isOnDefaultAutoRefresh}
                      dataTestId={PUBLIC_AUTO_REFRESH_DEFAULT_CHOICE_TEST_ID}
                      onClick={() => {
                        viewerSettings.pickDefaultAutoRefreshInterval();
                      }}
                    />,
                    <MoreMenuDivider key="default-divider" />,
                    ...Object.values(AutoRefreshInterval).map(
                      (interval: AutoRefreshInterval) => {
                        /*
                         * A list of choices, so its mark is the tick on the
                         * one in use - as the dashboard's own auto-refresh
                         * picker shows it - and the others keep the tick's
                         * space, so every label lines up. While the visitor
                         * is on the default, its choice above has the tick.
                         */
                        const isInUse: boolean =
                          !viewerSettings.isOnDefaultAutoRefresh &&
                          interval === autoRefreshInterval;

                        return (
                          <MoreMenuItem
                            key={interval}
                            text={getAutoRefreshIntervalLabel(interval)}
                            icon={isInUse ? IconProp.Check : undefined}
                            isIconSpaceReserved={true}
                            isChecked={isInUse}
                            onClick={() => {
                              viewerSettings.pickAutoRefreshInterval(interval);
                            }}
                          />
                        );
                      },
                    ),
                  ]}
                </MoreMenu>
              )}

              {/*
               * Light, Dark or Auto - the dashboard's own - for this visitor,
               * on every public dashboard, unless its link names a theme.
               */}
              <ThemeMenu />

              <Button
                icon={IconProp.Expand}
                buttonStyle={ButtonStyleType.ICON}
                onClick={() => {
                  const canvasElement: HTMLDivElement | null =
                    dashboardCanvasRef.current;

                  if (!canvasElement) {
                    return;
                  }

                  if (canvasElement.requestFullscreen) {
                    canvasElement.requestFullscreen();
                  }
                }}
                tooltip="Full Screen"
              />
            </div>
          </div>

          {/* Time range + variables row */}
          {hasComponents && (
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              <div>
                <RangeStartAndEndDateView
                  dashboardStartAndEndDate={startAndEndDate}
                  onChange={(newRange: RangeStartAndEndDateTime) => {
                    /*
                     * An explicit pick is a new baseline, not a zoom — it
                     * retires the "reset" affordance instead of offering
                     * to jump back to a range the user just left. A preset
                     * is remembered for this dashboard and goes in the
                     * address; a custom range is not.
                     */
                    viewerSettings.pickTimeRange(newRange);
                  }}
                  defaultRange={viewerSettings.defaultTimeRange}
                  isOnDefaultRange={viewerSettings.isOnDefaultTimeRange}
                  onDefaultRangeSelect={viewerSettings.pickDefaultTimeRange}
                />
              </div>

              {dashboardVariables.length > 0 && (
                <>
                  {/*
                   * Between the time range and the variables on one line;
                   * on a phone they wrap, and a rule would hang at the end
                   * of the first line.
                   */}
                  <div className="w-px h-5 bg-gray-200 max-sm:hidden"></div>
                  <DashboardVariableSelector
                    variables={dashboardVariables}
                    dashboardId={props.dashboardId}
                    onVariableValueChange={(
                      variableId: string,
                      change: VariableValueChange,
                    ) => {
                      const updated: Array<DashboardVariable> =
                        dashboardVariables.map((v: DashboardVariable) => {
                          if (v.id === variableId) {
                            return {
                              ...v,
                              selectedValue:
                                change.selectedValues !== undefined
                                  ? undefined
                                  : change.selectedValue,
                              selectedValues: change.selectedValues,
                            };
                          }
                          return v;
                        });
                      setDashboardVariables(updated);
                      DashboardVariableUrlState.writeToBrowserUrl(updated);
                      // Trigger refresh when variable changes
                      setRefreshTick((prev: number) => {
                        return prev + 1;
                      });
                    }}
                  />
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/*
       * Dashboard Canvas: the board in a frame of its own, which is what
       * Full Screen shows.
       */}
      <div
        ref={dashboardCanvasRef}
        className="mt-3"
        style={{ background: "var(--ou-surface-primary, #ffffff)" }}
        data-testid={PUBLIC_DASHBOARD_FRAME_TEST_ID}
      >
        <div ref={boardRef} data-testid={PUBLIC_DASHBOARD_BOARD_TEST_ID}>
          <DashboardCanvas
            dashboardViewConfig={dashboardViewConfig}
            onDashboardViewConfigChange={(_config: DashboardViewConfig) => {
              // Read-only in public view
            }}
            isEditMode={false}
            selectedComponentId={null}
            onComponentSelected={(_id: ObjectID) => {
              // No selection in public view
            }}
            onComponentUnselected={() => {
              // No unselection in public view
            }}
            currentTotalDashboardWidthInPx={dashboardTotalWidth}
            dashboardStartAndEndDate={startAndEndDate}
            metrics={{
              metricTypes: metricTypes,
              telemetryAttributes: [],
            }}
            refreshTick={refreshTick}
            variables={dashboardVariables}
            dashboardId={props.dashboardId.toString()}
            onDashboardTimeRangeSelect={timeRangeZoom.zoomToTimeRange}
            onDashboardTimeRangeReset={timeRangeZoom.resetZoom}
            isDashboardTimeRangeZoomed={timeRangeZoom.isZoomed}
          />
        </div>
      </div>

      {/* Footer */}
      <PoweredByFooter />
    </div>
  );
};

export default DashboardViewPage;

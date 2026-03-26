import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import DashboardCanvas from "../../Components/DashboardCanvas";
import DashboardMode from "Common/Types/Dashboard/DashboardMode";
import DashboardViewConfig, {
  AutoRefreshInterval,
  getAutoRefreshIntervalInMs,
  getAutoRefreshIntervalLabel,
} from "Common/Types/Dashboard/DashboardViewConfig";
import { ObjectType } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "../../Utils/API";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import DashboardViewConfigUtil from "Common/Utils/Dashboard/DashboardViewConfig";
import DefaultDashboardSize from "Common/Types/Dashboard/DashboardSize";
import { PromiseVoidFunction, VoidFunction } from "Common/Types/FunctionTypes";
import JSONFunctions from "Common/Types/JSONFunctions";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import DashboardVariableSelector from "./DashboardVariableSelector";
import NavBar from "Common/UI/Components/Navbar/NavBar";
import NavBarItem from "Common/UI/Components/Navbar/NavBarItem";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PublicDashboardUtil from "../../Utils/PublicDashboard";
import Route from "Common/Types/API/Route";

export interface ComponentProps {
  dashboardId: ObjectID;
  onLoadComplete?: (() => void) | undefined;
}

const DashboardViewPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [startAndEndDate, setStartAndEndDate] =
    useState<RangeStartAndEndDateTime>({
      range: TimeRange.PAST_ONE_HOUR,
    });

  const [autoRefreshInterval, setAutoRefreshInterval] =
    useState<AutoRefreshInterval>(AutoRefreshInterval.OFF);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [dashboardVariables, setDashboardVariables] = useState<
    Array<DashboardVariable>
  >([]);
  const [timeRangeStack, setTimeRangeStack] = useState<
    Array<RangeStartAndEndDateTime>
  >([]);
  const autoRefreshTimerRef: React.MutableRefObject<ReturnType<
    typeof setInterval
  > | null> = useRef<ReturnType<typeof setInterval> | null>(null);
  const [refreshTick, setRefreshTick] = useState<number>(0);

  const dashboardViewRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);

  const [dashboardTotalWidth, setDashboardTotalWidth] = useState<number>(0);
  const [dashboardName, setDashboardName] = useState<string>("");

  const handleResize: VoidFunction = (): void => {
    setDashboardTotalWidth(dashboardViewRef.current?.offsetWidth || 0);
  };

  useEffect(() => {
    setDashboardTotalWidth(dashboardViewRef.current?.offsetWidth || 0);
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
      const dashboard: Dashboard | null = await ModelAPI.getItem({
        modelType: Dashboard,
        id: props.dashboardId,
        select: {
          dashboardViewConfig: true,
          name: true,
          description: true,
        },
      });

      if (!dashboard) {
        setError("Dashboard not found");
        return;
      }

      const config: DashboardViewConfig = JSONFunctions.deserializeValue(
        dashboard.dashboardViewConfig ||
          DashboardViewConfigUtil.createDefaultDashboardViewConfig(),
      ) as DashboardViewConfig;

      setDashboardViewConfig(config);
      setDashboardName(dashboard.name || "Untitled Dashboard");

      if (config.refreshInterval) {
        setAutoRefreshInterval(config.refreshInterval);
      }

      if (config.variables) {
        setDashboardVariables(config.variables);
      }
    };

  const loadPage: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      await fetchDashboardViewConfig();
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

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  const isPreview: boolean = PublicDashboardUtil.isPreviewPage();

  const overviewRoute: Route = RouteUtil.populateRouteParams(
    isPreview
      ? (RouteMap[PageMap.PREVIEW_OVERVIEW] as Route)
      : (RouteMap[PageMap.OVERVIEW] as Route),
  );

  return (
    <div
      ref={dashboardViewRef}
      className="min-h-screen"
      style={{
        minWidth: "1000px",
        background: "#fafbfc",
      }}
    >
      {/* Header and NavBar */}
      <div className="max-w-5xl mx-auto px-3 sm:px-5">
        <div className="flex items-center justify-between mt-5">
          <h1 className="text-xl font-semibold text-gray-900 truncate">
            {dashboardName}
          </h1>
        </div>

        <NavBar className="bg-white flex text-center justify-between py-2 mt-5 rounded-lg shadow px-5">
          <NavBarItem
            id="overview-nav-bar-item"
            title="Overview"
            icon={IconProp.CheckCircle}
            exact={true}
            route={overviewRoute}
          />
        </NavBar>
      </div>

      {/* Public Dashboard Toolbar */}
      <div
        className="mx-3 mt-3 mb-2 rounded-lg bg-white border border-gray-200"
        style={{
          boxShadow:
            "0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.04)",
        }}
      >
        <div
          className="h-0.5 rounded-t-lg"
          style={{
            background: "linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%)",
          }}
        ></div>
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3 min-w-0">
            {hasComponents && (
              <span className="text-xs text-gray-400 tabular-nums">
                {dashboardViewConfig.components.length} widget
                {dashboardViewConfig.components.length !== 1 ? "s" : ""}
              </span>
            )}
            {isRefreshing &&
              autoRefreshInterval !== AutoRefreshInterval.OFF && (
                <span className="inline-flex items-center gap-1.5 text-xs text-blue-600">
                  <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></span>
                  Refreshing
                </span>
              )}
          </div>

          <div className="flex items-center gap-1.5">
            {/* Reset Zoom button */}
            {timeRangeStack.length > 0 && (
              <Button
                icon={IconProp.Refresh}
                title="Reset Zoom"
                buttonStyle={ButtonStyleType.HOVER_PRIMARY_OUTLINE}
                onClick={() => {
                  const previousRange: RangeStartAndEndDateTime | undefined =
                    timeRangeStack[0];
                  if (previousRange) {
                    setStartAndEndDate(previousRange);
                    setTimeRangeStack([]);
                  }
                }}
                tooltip="Reset to original time range"
              />
            )}

            {/* Auto-refresh dropdown */}
            {hasComponents && (
              <MoreMenu
                menuIcon={IconProp.Refresh}
                text={
                  autoRefreshInterval !== AutoRefreshInterval.OFF
                    ? getAutoRefreshIntervalLabel(autoRefreshInterval)
                    : ""
                }
              >
                {Object.values(AutoRefreshInterval).map(
                  (interval: AutoRefreshInterval) => {
                    return (
                      <MoreMenuItem
                        key={interval}
                        text={getAutoRefreshIntervalLabel(interval)}
                        onClick={() => {
                          setAutoRefreshInterval(interval);
                        }}
                      />
                    );
                  },
                )}
              </MoreMenu>
            )}

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

        {/* Bottom row: Time range + variables */}
        {hasComponents && (
          <div className="flex items-center gap-3 px-5 pb-3 pt-0 flex-wrap">
            <div>
              <RangeStartAndEndDateView
                dashboardStartAndEndDate={startAndEndDate}
                onChange={(newRange: RangeStartAndEndDateTime) => {
                  setTimeRangeStack([...timeRangeStack, startAndEndDate]);
                  setStartAndEndDate(newRange);
                }}
              />
            </div>

            {dashboardVariables.length > 0 && (
              <>
                <div className="w-px h-5 bg-gray-200"></div>
                <DashboardVariableSelector
                  variables={dashboardVariables}
                  onVariableValueChange={(
                    variableId: string,
                    value: string,
                  ) => {
                    setDashboardVariables(
                      dashboardVariables.map((v: DashboardVariable) => {
                        if (v.id === variableId) {
                          return { ...v, currentValue: value };
                        }
                        return v;
                      }),
                    );
                  }}
                />
              </>
            )}
          </div>
        )}
      </div>

      <div ref={dashboardCanvasRef}>
        <DashboardCanvas
          dashboardViewConfig={dashboardViewConfig}
          onDashboardViewConfigChange={(_config: DashboardViewConfig) => {
            // Read-only in public view
          }}
          dashboardMode={DashboardMode.View}
          selectedComponentId={null}
          onComponentSelected={(_id: ObjectID | null) => {
            // No selection in public view
          }}
          dashboardTotalWidth={dashboardTotalWidth}
          startAndEndDate={startAndEndDate}
          onStartAndEndDateChange={(newRange: RangeStartAndEndDateTime) => {
            setTimeRangeStack([...timeRangeStack, startAndEndDate]);
            setStartAndEndDate(newRange);
          }}
          refreshTick={refreshTick}
          dashboardVariables={dashboardVariables}
        />
      </div>

      {/* Footer */}
      <div className="max-w-5xl mx-auto px-3 sm:px-5 py-5">
        <div className="flex items-center justify-center text-xs text-gray-400">
          <span>Powered by</span>
          <a
            href="https://oneuptime.com"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 text-gray-500 hover:text-gray-700 font-medium"
          >
            OneUptime
          </a>
        </div>
      </div>
    </div>
  );
};

export default DashboardViewPage;

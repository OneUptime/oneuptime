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
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
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
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [pageDescription, setPageDescription] = useState<string>("");

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

      const config: DashboardViewConfig = JSONFunctions.deserializeValue(
        response.data["dashboardViewConfig"] ||
          DashboardViewConfigUtil.createDefaultDashboardViewConfig(),
      ) as DashboardViewConfig;

      setDashboardViewConfig(config);
      setDashboardName(
        (response.data["pageTitle"] as string) ||
          (response.data["name"] as string) ||
          "Untitled Dashboard",
      );
      setPageDescription((response.data["pageDescription"] as string) || "");

      // Extract logo data
      const logoData: JSONObject | null =
        (response.data["logoFile"] as JSONObject) || null;
      if (logoData && logoData["file"]) {
        const fileData: string = logoData["file"] as string;
        const fileType: string =
          (logoData["fileType"] as string) || "image/png";
        setLogoUrl(`data:${fileType};base64,${fileData}`);
      }

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

  return (
    <div
      ref={dashboardViewRef}
      className="min-h-screen"
      style={{
        minWidth: "1000px",
        background: "#fafbfc",
      }}
    >
      {/* Header */}
      <div
        className="bg-white border-b border-gray-200"
        style={{
          boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.05)",
        }}
      >
        <div className="max-w-7xl mx-auto px-5 py-4">
          <div className="flex items-center justify-between">
            {/* Logo + Title + Description */}
            <div className="flex items-center gap-4 min-w-0">
              {logoUrl && (
                <img
                  src={logoUrl}
                  alt={dashboardName}
                  className="h-8 w-auto object-contain flex-shrink-0"
                />
              )}
              <div className="min-w-0">
                <h1 className="text-lg font-semibold text-gray-900 truncate">
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
            <div className="flex items-center gap-2 flex-shrink-0">
              {isRefreshing &&
                autoRefreshInterval !== AutoRefreshInterval.OFF && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-blue-600">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></span>
                    Refreshing
                  </span>
                )}

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

          {/* Time range + variables row */}
          {hasComponents && (
            <div className="flex items-center gap-3 mt-3 flex-wrap">
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
      </div>

      {/* Dashboard Canvas */}
      <div
        ref={dashboardCanvasRef}
        className="mt-3"
        style={{ background: "#ffffff" }}
      >
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
            metricTypes: [],
            telemetryAttributes: [],
          }}
          refreshTick={refreshTick}
        />
      </div>

      {/* Footer */}
      <div className="max-w-7xl mx-auto px-5 py-5">
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

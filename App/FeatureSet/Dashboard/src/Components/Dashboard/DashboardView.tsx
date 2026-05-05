import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import DashboardToolbar from "./Toolbar/DashboardToolbar";
import DashboardCanvas from "./Canvas/Index";
import DashboardMode from "Common/Types/Dashboard/DashboardMode";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import DashboardViewConfig, {
  AutoRefreshInterval,
  getAutoRefreshIntervalInMs,
} from "Common/Types/Dashboard/DashboardViewConfig";
import { ObjectType } from "Common/Types/JSON";
import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardChartComponentUtil from "Common/Utils/Dashboard/Components/DashboardChartComponent";
import DashboardValueComponentUtil from "Common/Utils/Dashboard/Components/DashboardValueComponent";
import DashboardTextComponentUtil from "Common/Utils/Dashboard/Components/DashboardTextComponent";
import DashboardTableComponentUtil from "Common/Utils/Dashboard/Components/DashboardTableComponent";
import DashboardGaugeComponentUtil from "Common/Utils/Dashboard/Components/DashboardGaugeComponent";
import DashboardLogStreamComponentUtil from "Common/Utils/Dashboard/Components/DashboardLogStreamComponent";
import DashboardTraceListComponentUtil from "Common/Utils/Dashboard/Components/DashboardTraceListComponent";
import DashboardIncidentListComponentUtil from "Common/Utils/Dashboard/Components/DashboardIncidentListComponent";
import DashboardAlertListComponentUtil from "Common/Utils/Dashboard/Components/DashboardAlertListComponent";
import DashboardMonitorListComponentUtil from "Common/Utils/Dashboard/Components/DashboardMonitorListComponent";
import DashboardKubernetesPodListComponentUtil from "Common/Utils/Dashboard/Components/DashboardKubernetesPodListComponent";
import DashboardKubernetesNodeListComponentUtil from "Common/Utils/Dashboard/Components/DashboardKubernetesNodeListComponent";
import DashboardKubernetesNamespaceListComponentUtil from "Common/Utils/Dashboard/Components/DashboardKubernetesNamespaceListComponent";
import DashboardKubernetesDeploymentListComponentUtil from "Common/Utils/Dashboard/Components/DashboardKubernetesDeploymentListComponent";
import DashboardKubernetesStatefulSetListComponentUtil from "Common/Utils/Dashboard/Components/DashboardKubernetesStatefulSetListComponent";
import DashboardKubernetesDaemonSetListComponentUtil from "Common/Utils/Dashboard/Components/DashboardKubernetesDaemonSetListComponent";
import DashboardKubernetesJobListComponentUtil from "Common/Utils/Dashboard/Components/DashboardKubernetesJobListComponent";
import DashboardKubernetesCronJobListComponentUtil from "Common/Utils/Dashboard/Components/DashboardKubernetesCronJobListComponent";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import DashboardViewConfigUtil from "Common/Utils/Dashboard/DashboardViewConfig";
import DefaultDashboardSize from "Common/Types/Dashboard/DashboardSize";
import { PromiseVoidFunction, VoidFunction } from "Common/Types/FunctionTypes";
import JSONFunctions from "Common/Types/JSONFunctions";
import MetricUtil from "../Metrics/Utils/Metrics";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";

export interface ComponentProps {
  dashboardId: ObjectID;
}

const DashboardViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [dashboardMode, setDashboardMode] = useState<DashboardMode>(
    DashboardMode.View,
  );

  const [startAndEndDate, setStartAndEndDate] =
    useState<RangeStartAndEndDateTime>({
      range: TimeRange.PAST_ONE_HOUR,
    });

  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Auto-refresh state
  const [autoRefreshInterval, setAutoRefreshInterval] =
    useState<AutoRefreshInterval>(AutoRefreshInterval.OFF);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [dashboardVariables, setDashboardVariables] = useState<
    Array<DashboardVariable>
  >([]);

  // Zoom stack for time range
  const [timeRangeStack, setTimeRangeStack] = useState<
    Array<RangeStartAndEndDateTime>
  >([]);
  const autoRefreshTimerRef: React.MutableRefObject<ReturnType<
    typeof setInterval
  > | null> = useRef<ReturnType<typeof setInterval> | null>(null);
  const [refreshTick, setRefreshTick] = useState<number>(0);

  // ref for dashboard div.

  const dashboardViewRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);

  const [dashboardTotalWidth, setDashboardTotalWidth] = useState<number>(
    dashboardViewRef.current?.offsetWidth || 0,
  );

  const [telemetryAttributes, setTelemetryAttributes] = useState<string[]>([]);

  const [metricTypes, setMetricTypes] = useState<MetricType[]>([]);

  const loadAllMetricsTypes: PromiseVoidFunction = async (): Promise<void> => {
    const {
      metricTypes,
      telemetryAttributes,
    }: {
      metricTypes: Array<MetricType>;
      telemetryAttributes: Array<string>;
    } = await MetricUtil.loadAllMetricsTypes();

    setMetricTypes(metricTypes);
    setTelemetryAttributes(telemetryAttributes);
  };

  const [dashboardName, setDashboardName] = useState<string>("");
  const [dashboardDescription, setDashboardDescription] = useState<string>("");

  const handleResize: VoidFunction = (): void => {
    setDashboardTotalWidth(dashboardViewRef.current?.offsetWidth || 0);
  };

  const saveDashboardViewConfig: PromiseVoidFunction =
    async (): Promise<void> => {
      try {
        setIsSaving(true);
        await ModelAPI.updateById({
          modelType: Dashboard,
          id: props.dashboardId,
          data: {
            dashboardViewConfig:
              JSONFunctions.serializeValue(dashboardViewConfig),
          },
        });
      } catch (err) {
        setError(API.getFriendlyErrorMessage(err as Error));
      }

      setIsSaving(false);
    };

  useEffect(() => {
    setDashboardTotalWidth(dashboardViewRef.current?.offsetWidth || 0);

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const [selectedComponentId, setSelectedComponentId] =
    useState<ObjectID | null>(null);

  /*
   * Component id we want to scroll into view. Set when a widget is added,
   * cleared once the scroll has been performed. The scroll is driven by a
   * useEffect rather than executed inline because adding a widget also
   * opens the settings sidebar, which in turn triggers a resize and a
   * canvas reflow — calling scrollIntoView before those settle scrolls
   * to a stale Y coordinate.
   */
  const [pendingScrollComponentId, setPendingScrollComponentId] =
    useState<ObjectID | null>(null);

  const [dashboardViewConfig, setDashboardViewConfig] =
    useState<DashboardViewConfig>({
      _type: ObjectType.DashboardViewConfig,
      components: [],
      heightInDashboardUnits: DefaultDashboardSize.heightInDashboardUnits,
    });

  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const fetchDashboardViewConfig: PromiseVoidFunction =
    async (): Promise<void> => {
      const dashboard: Dashboard | null = await ModelAPI.getItem({
        modelType: Dashboard,
        id: props.dashboardId,
        select: {
          dashboardViewConfig: true,
          name: true,
          description: true,
          pageTitle: true,
          pageDescription: true,
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
      setDashboardName(
        dashboard.pageTitle || dashboard.name || "Untitled Dashboard",
      );
      setDashboardDescription(
        dashboard.pageDescription || dashboard.description || "",
      );

      // Restore saved auto-refresh interval
      if (config.refreshInterval) {
        setAutoRefreshInterval(config.refreshInterval);
      }

      // Restore saved variables
      if (config.variables) {
        setDashboardVariables(config.variables);
      }
    };

  const loadPage: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      await loadAllMetricsTypes();
      await fetchDashboardViewConfig();
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    // Fetch the dashboard view config from the server
    loadPage().catch((err: Error) => {
      setError(API.getFriendlyErrorMessage(err as Error));
    });
  }, []);

  // Auto-refresh timer management
  const triggerRefresh: () => void = useCallback(() => {
    setIsRefreshing(true);
    setRefreshTick((prev: number) => {
      return prev + 1;
    });
    // Brief indicator
    setTimeout(() => {
      setIsRefreshing(false);
    }, 500);
  }, []);

  useEffect(() => {
    // Clear existing timer
    if (autoRefreshTimerRef.current) {
      clearInterval(autoRefreshTimerRef.current);
      autoRefreshTimerRef.current = null;
    }

    // Don't auto-refresh in edit mode
    if (dashboardMode === DashboardMode.Edit) {
      return;
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
  }, [autoRefreshInterval, dashboardMode, triggerRefresh]);

  const isEditMode: boolean = dashboardMode === DashboardMode.Edit;

  const sideBarWidth: number = isEditMode && selectedComponentId ? 650 : 0;

  useEffect(() => {
    handleResize();
  }, [dashboardMode, selectedComponentId]);

  /*
   * Scroll the most-recently added widget into view. Depends on
   * dashboardTotalWidth so the scroll waits for the canvas to reflow
   * after the settings sidebar opens (sidebar steals 650px from the
   * canvas, which shrinks unitSize and shifts every widget's Y).
   */
  useEffect(() => {
    if (!pendingScrollComponentId) {
      return undefined;
    }
    const id: string = `dashboard-component-${pendingScrollComponentId.toString()}`;
    /*
     * Scroll the widget into view in two passes. The settings sidebar
     * opens (sidebar steals 650px from the canvas, which shrinks unitSize
     * and shifts every widget's Y) and chart/list children render
     * asynchronously, so the layout keeps drifting for a few hundred
     * milliseconds. The first pass lands us close; the second corrects
     * any drift that happened between the two passes.
     */
    const firstPass: ReturnType<typeof setTimeout> = setTimeout(() => {
      const el: HTMLElement | null = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "auto", block: "center" });
      }
    }, 100);
    const secondPass: ReturnType<typeof setTimeout> = setTimeout(() => {
      const el: HTMLElement | null = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      setPendingScrollComponentId(null);
    }, 500);
    return () => {
      clearTimeout(firstPass);
      clearTimeout(secondPass);
    };
  }, [pendingScrollComponentId]);

  const dashboardCanvasRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);

  /*
   * Stable references for the props handed to DashboardCanvas. Without
   * memoization, every refresh tick / state change in this component
   * (auto-refresh, drag, resize, save) emits a new `metrics` object and
   * fresh callbacks, defeating React.memo on every widget downstream
   * and causing all charts to re-render in lockstep.
   */
  const metricsBundle: {
    telemetryAttributes: Array<string>;
    metricTypes: Array<MetricType>;
  } = useMemo(() => {
    return {
      telemetryAttributes,
      metricTypes,
    };
  }, [telemetryAttributes, metricTypes]);

  const handleConfigChange: (newConfig: DashboardViewConfig) => void =
    useCallback((newConfig: DashboardViewConfig) => {
      setDashboardViewConfig(newConfig);
    }, []);

  const handleComponentSelected: (componentId: ObjectID) => void = useCallback(
    (componentId: ObjectID) => {
      setSelectedComponentId(componentId);
    },
    [],
  );

  const handleComponentUnselected: () => void = useCallback(() => {
    setSelectedComponentId(null);
  }, []);

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
        width: `calc(100% - ${sideBarWidth}px)`,
        background: isEditMode
          ? "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)"
          : "#f8f9fb",
      }}
    >
      <DashboardToolbar
        dashboardMode={dashboardMode}
        onFullScreenClick={() => {
          const canvasElement: HTMLDivElement | null =
            dashboardCanvasRef.current;

          if (!canvasElement) {
            return;
          }

          if (canvasElement.requestFullscreen) {
            canvasElement.requestFullscreen();
          } else {
            // full screen not supported by browser
            alert(
              "Full screen not supported by this browser. Please use a different browser.",
            );
          }
        }}
        dashboardViewConfig={dashboardViewConfig}
        dashboardName={dashboardName}
        dashboardDescription={dashboardDescription}
        isSaving={isSaving}
        onSaveClick={() => {
          // Save auto-refresh interval with the config
          const configWithRefresh: DashboardViewConfig = {
            ...dashboardViewConfig,
            refreshInterval: autoRefreshInterval,
          };
          setDashboardViewConfig(configWithRefresh);

          saveDashboardViewConfig().catch((err: Error) => {
            setError(API.getFriendlyErrorMessage(err));
          });
          setDashboardMode(DashboardMode.View);
        }}
        startAndEndDate={startAndEndDate}
        canResetZoom={timeRangeStack.length > 0}
        onResetZoom={() => {
          if (timeRangeStack.length > 0) {
            const previousRange: RangeStartAndEndDateTime =
              timeRangeStack[timeRangeStack.length - 1]!;
            setStartAndEndDate(previousRange);
            setTimeRangeStack(timeRangeStack.slice(0, -1));
          }
        }}
        onStartAndEndDateChange={(
          newStartAndEndDate: RangeStartAndEndDateTime,
        ) => {
          // Push current range to zoom stack before changing
          setTimeRangeStack([...timeRangeStack, startAndEndDate]);
          setStartAndEndDate(newStartAndEndDate);
        }}
        onCancelEditClick={async () => {
          // load the dashboard view config again
          setDashboardMode(DashboardMode.View);
          await fetchDashboardViewConfig();
        }}
        onEditClick={() => {
          setDashboardMode(DashboardMode.Edit);
        }}
        autoRefreshInterval={autoRefreshInterval}
        onAutoRefreshIntervalChange={(interval: AutoRefreshInterval) => {
          setAutoRefreshInterval(interval);
        }}
        isRefreshing={isRefreshing}
        variables={dashboardVariables}
        onVariableValueChange={(variableId: string, value: string) => {
          const updatedVariables: Array<DashboardVariable> =
            dashboardVariables.map((v: DashboardVariable) => {
              if (v.id === variableId) {
                return { ...v, selectedValue: value };
              }
              return v;
            });
          setDashboardVariables(updatedVariables);
          // Trigger refresh when variable changes
          setRefreshTick((prev: number) => {
            return prev + 1;
          });
        }}
        onAddComponentClick={(componentType: DashboardComponentType) => {
          let newComponent: DashboardBaseComponent | null = null;

          if (componentType === DashboardComponentType.Chart) {
            newComponent = DashboardChartComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.Value) {
            newComponent = DashboardValueComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.Text) {
            newComponent = DashboardTextComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.Table) {
            newComponent = DashboardTableComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.Gauge) {
            newComponent = DashboardGaugeComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.LogStream) {
            newComponent =
              DashboardLogStreamComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.TraceList) {
            newComponent =
              DashboardTraceListComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.IncidentList) {
            newComponent =
              DashboardIncidentListComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.AlertList) {
            newComponent =
              DashboardAlertListComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.MonitorList) {
            newComponent =
              DashboardMonitorListComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.KubernetesPodList) {
            newComponent =
              DashboardKubernetesPodListComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.KubernetesNodeList) {
            newComponent =
              DashboardKubernetesNodeListComponentUtil.getDefaultComponent();
          }

          if (
            componentType === DashboardComponentType.KubernetesNamespaceList
          ) {
            newComponent =
              DashboardKubernetesNamespaceListComponentUtil.getDefaultComponent();
          }

          if (
            componentType === DashboardComponentType.KubernetesDeploymentList
          ) {
            newComponent =
              DashboardKubernetesDeploymentListComponentUtil.getDefaultComponent();
          }

          if (
            componentType === DashboardComponentType.KubernetesStatefulSetList
          ) {
            newComponent =
              DashboardKubernetesStatefulSetListComponentUtil.getDefaultComponent();
          }

          if (
            componentType === DashboardComponentType.KubernetesDaemonSetList
          ) {
            newComponent =
              DashboardKubernetesDaemonSetListComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.KubernetesJobList) {
            newComponent =
              DashboardKubernetesJobListComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.KubernetesCronJobList) {
            newComponent =
              DashboardKubernetesCronJobListComponentUtil.getDefaultComponent();
          }

          if (!newComponent) {
            throw new BadDataException(
              `Unknown component type: ${componentType}`,
            );
          }

          const newDashboardConfig: DashboardViewConfig =
            JSONFunctions.deserializeValue(
              DashboardViewConfigUtil.addComponentToDashboard({
                component: newComponent,
                dashboardViewConfig: dashboardViewConfig,
              }),
            ) as DashboardViewConfig;

          setDashboardViewConfig(newDashboardConfig);
          /*
           * Open the settings panel for the freshly added component and
           * queue a scroll-into-view. The scroll itself runs from a
           * useEffect once dashboardTotalWidth has settled, so we scroll
           * to the widget's final post-reflow position.
           */
          setSelectedComponentId(newComponent.componentId);
          setPendingScrollComponentId(newComponent.componentId);
        }}
      />
      <div
        ref={dashboardCanvasRef}
        className="px-1 pb-4 mx-3 mb-4 rounded-2xl border border-gray-200/60"
        style={{
          background: "#ffffff",
          boxShadow:
            "0 1px 4px 0 rgba(0, 0, 0, 0.04), 0 1px 2px -1px rgba(0, 0, 0, 0.03)",
        }}
      >
        <DashboardCanvas
          dashboardViewConfig={dashboardViewConfig}
          onDashboardViewConfigChange={handleConfigChange}
          onComponentSelected={handleComponentSelected}
          onComponentUnselected={handleComponentUnselected}
          dashboardStartAndEndDate={startAndEndDate}
          selectedComponentId={selectedComponentId}
          isEditMode={isEditMode}
          currentTotalDashboardWidthInPx={dashboardTotalWidth}
          metrics={metricsBundle}
          refreshTick={refreshTick}
        />
      </div>
    </div>
  );
};

export default DashboardViewer;

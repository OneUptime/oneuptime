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
import DashboardClockComponentUtil from "Common/Utils/Dashboard/Components/DashboardClockComponent";
import DashboardTableComponentUtil from "Common/Utils/Dashboard/Components/DashboardTableComponent";
import DashboardGaugeComponentUtil from "Common/Utils/Dashboard/Components/DashboardGaugeComponent";
import DashboardDataSourceChartComponentUtil from "Common/Utils/Dashboard/Components/DashboardDataSourceChartComponent";
import DashboardDataSourceValueComponentUtil from "Common/Utils/Dashboard/Components/DashboardDataSourceValueComponent";
import DashboardDataSourceGaugeComponentUtil from "Common/Utils/Dashboard/Components/DashboardDataSourceGaugeComponent";
import DashboardDataSourceTableComponentUtil from "Common/Utils/Dashboard/Components/DashboardDataSourceTableComponent";
import DashboardLogStreamComponentUtil from "Common/Utils/Dashboard/Components/DashboardLogStreamComponent";
import DashboardLogChartComponentUtil from "Common/Utils/Dashboard/Components/DashboardLogChartComponent";
import DashboardSecurityEventsListComponentUtil from "Common/Utils/Dashboard/Components/DashboardSecurityEventsListComponent";
import DashboardSecurityEventsFlowComponentUtil from "Common/Utils/Dashboard/Components/DashboardSecurityEventsFlowComponent";
import DashboardTraceListComponentUtil from "Common/Utils/Dashboard/Components/DashboardTraceListComponent";
import DashboardTraceChartComponentUtil from "Common/Utils/Dashboard/Components/DashboardTraceChartComponent";
import DashboardTraceTableComponentUtil from "Common/Utils/Dashboard/Components/DashboardTraceTableComponent";
import DashboardIncidentListComponentUtil from "Common/Utils/Dashboard/Components/DashboardIncidentListComponent";
import DashboardAlertListComponentUtil from "Common/Utils/Dashboard/Components/DashboardAlertListComponent";
import DashboardMonitorListComponentUtil from "Common/Utils/Dashboard/Components/DashboardMonitorListComponent";
import DashboardSloComponentUtil from "Common/Utils/Dashboard/Components/DashboardSloComponent";
import DashboardKubernetesPodListComponentUtil from "Common/Utils/Dashboard/Components/DashboardKubernetesPodListComponent";
import DashboardKubernetesNodeListComponentUtil from "Common/Utils/Dashboard/Components/DashboardKubernetesNodeListComponent";
import DashboardKubernetesNamespaceListComponentUtil from "Common/Utils/Dashboard/Components/DashboardKubernetesNamespaceListComponent";
import DashboardKubernetesDeploymentListComponentUtil from "Common/Utils/Dashboard/Components/DashboardKubernetesDeploymentListComponent";
import DashboardKubernetesStatefulSetListComponentUtil from "Common/Utils/Dashboard/Components/DashboardKubernetesStatefulSetListComponent";
import DashboardKubernetesDaemonSetListComponentUtil from "Common/Utils/Dashboard/Components/DashboardKubernetesDaemonSetListComponent";
import DashboardKubernetesJobListComponentUtil from "Common/Utils/Dashboard/Components/DashboardKubernetesJobListComponent";
import DashboardKubernetesCronJobListComponentUtil from "Common/Utils/Dashboard/Components/DashboardKubernetesCronJobListComponent";
import DashboardDockerHostListComponentUtil from "Common/Utils/Dashboard/Components/DashboardDockerHostListComponent";
import DashboardDockerContainerListComponentUtil from "Common/Utils/Dashboard/Components/DashboardDockerContainerListComponent";
import DashboardDockerImageListComponentUtil from "Common/Utils/Dashboard/Components/DashboardDockerImageListComponent";
import DashboardDockerNetworkListComponentUtil from "Common/Utils/Dashboard/Components/DashboardDockerNetworkListComponent";
import DashboardDockerVolumeListComponentUtil from "Common/Utils/Dashboard/Components/DashboardDockerVolumeListComponent";
import DashboardPodmanHostListComponentUtil from "Common/Utils/Dashboard/Components/DashboardPodmanHostListComponent";
import DashboardPodmanContainerListComponentUtil from "Common/Utils/Dashboard/Components/DashboardPodmanContainerListComponent";
import DashboardPodmanImageListComponentUtil from "Common/Utils/Dashboard/Components/DashboardPodmanImageListComponent";
import DashboardPodmanNetworkListComponentUtil from "Common/Utils/Dashboard/Components/DashboardPodmanNetworkListComponent";
import DashboardPodmanVolumeListComponentUtil from "Common/Utils/Dashboard/Components/DashboardPodmanVolumeListComponent";
import DashboardHostListComponentUtil from "Common/Utils/Dashboard/Components/DashboardHostListComponent";
import DashboardProxmoxNodeListComponentUtil from "Common/Utils/Dashboard/Components/DashboardProxmoxNodeListComponent";
import DashboardProxmoxGuestListComponentUtil from "Common/Utils/Dashboard/Components/DashboardProxmoxGuestListComponent";
import DashboardDockerSwarmNodeListComponentUtil from "Common/Utils/Dashboard/Components/DashboardDockerSwarmNodeListComponent";
import DashboardDockerSwarmServiceListComponentUtil from "Common/Utils/Dashboard/Components/DashboardDockerSwarmServiceListComponent";
import DashboardCephOsdListComponentUtil from "Common/Utils/Dashboard/Components/DashboardCephOsdListComponent";
import DashboardCephPoolListComponentUtil from "Common/Utils/Dashboard/Components/DashboardCephPoolListComponent";
import DashboardNetworkMapComponentUtil from "Common/Utils/Dashboard/Components/DashboardNetworkMapComponent";
import DashboardHtmlComponentUtil from "Common/Utils/Dashboard/Components/DashboardHtmlComponent";
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
import useDashboardTimeRangeZoom, {
  DashboardTimeRangeZoom,
} from "Common/UI/Utils/UseDashboardTimeRangeZoom";
import TimeRange from "Common/Types/Time/TimeRange";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";
import DashboardVariableUrlState from "Common/Utils/Dashboard/VariableUrlState";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";

export interface ComponentProps {
  dashboardId: ObjectID;
}

type SaveDashboardViewConfigFunction = (
  configToSave: DashboardViewConfig,
) => Promise<boolean>;

const DashboardViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [dashboardMode, setDashboardMode] = useState<DashboardMode>(
    DashboardMode.View,
  );

  /*
   * The board's one time range, plus the undo that makes drag-to-zoom on a
   * panel reversible. A drag-selection on any time-series widget retimes
   * every widget; a double-click on one puts them all back.
   */
  const timeRangeZoom: DashboardTimeRangeZoom = useDashboardTimeRangeZoom({
    range: TimeRange.PAST_ONE_HOUR,
  });
  const startAndEndDate: RangeStartAndEndDateTime =
    timeRangeZoom.startAndEndDate;

  const [isSaving, setIsSaving] = useState<boolean>(false);

  /*
   * A save that was refused, kept apart from the page-level `error`. That one
   * replaces the whole board with a bare message; on a failed save it took
   * every unsaved widget the user had just placed with it.
   */
  const [saveError, setSaveError] = useState<string | null>(null);

  /*
   * Whether this user may write to the dashboard at all.
   *
   * The board is a bespoke screen: it does not go through ModelTable or
   * ModelForm, so none of the generic gates ever ran over it. Every reader -
   * including a project-wide `Viewer`, whose whole definition is "read-only
   * access across all project resources" - was offered Edit, Add Widget,
   * Variables and Save Changes, could rearrange the whole board, and only
   * found out at Save that the API had never been going to accept it
   * (github.com/OneUptime/oneuptime/issues/3550). The write is refused by
   * TablePermission either way; what was broken is that the UI never said so,
   * and the work was lost when it finally did.
   */
  const editGate: PermissionGateResult = useMemo(() => {
    return PermissionGate.check(new Dashboard(), ModelAction.Update);
  }, []);

  const canEditDashboard: boolean = editGate.isAllowed;

  // Auto-refresh state
  const [autoRefreshInterval, setAutoRefreshInterval] =
    useState<AutoRefreshInterval>(AutoRefreshInterval.OFF);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [dashboardVariables, setDashboardVariables] = useState<
    Array<DashboardVariable>
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
    /*
     * Telemetry attribute keys are only used by ArgumentsForm inside the edit
     * Component Settings modal. Fetching them here would block the initial
     * dashboard render on a 30-day DISTINCT-arrayJoin against the metrics
     * table that can take 30s+ on busy projects. Load metric types only and
     * lazy-load attributes in the background.
     */
    const { metricTypes }: { metricTypes: Array<MetricType> } =
      await MetricUtil.loadAllMetricsTypes({ includeAttributes: false });

    setMetricTypes(metricTypes);
  };

  const telemetryAttributesRequestedRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const loadTelemetryAttributesInBackground: VoidFunction = useCallback(() => {
    if (telemetryAttributesRequestedRef.current) {
      return;
    }
    telemetryAttributesRequestedRef.current = true;
    MetricUtil.getTelemetryAttributes()
      .then((attrs: Array<string>) => {
        setTelemetryAttributes(attrs);
      })
      .catch(() => {
        telemetryAttributesRequestedRef.current = false;
      });
  }, []);

  const [dashboardName, setDashboardName] = useState<string>("");
  const [dashboardDescription, setDashboardDescription] = useState<string>("");

  const handleResize: VoidFunction = (): void => {
    setDashboardTotalWidth(dashboardViewRef.current?.offsetWidth || 0);
  };

  /*
   * Takes the config to persist as an argument rather than reading the
   * `dashboardViewConfig` state. The caller stamps the auto-refresh interval
   * onto the config immediately before saving, and a setState is not visible
   * to the closure that scheduled it - so reading the state here wrote the
   * board the user had *before* their last change to the refresh interval,
   * and that setting only landed on the following save.
   *
   * Returns whether the write actually happened, so the caller can keep the
   * user in edit mode with their work intact when it did not.
   */
  const saveDashboardViewConfig: SaveDashboardViewConfigFunction = async (
    configToSave: DashboardViewConfig,
  ): Promise<boolean> => {
    /*
     * Belt and braces: edit mode is already gated, but nothing should be able
     * to reach the write path without the permission the write needs.
     */
    if (!canEditDashboard) {
      setSaveError(
        editGate.disabledReason ||
          PermissionGate.getMissingPermissionMessage(
            new Dashboard(),
            ModelAction.Update,
          ),
      );
      return false;
    }

    try {
      setIsSaving(true);
      setSaveError(null);
      await ModelAPI.updateById({
        modelType: Dashboard,
        id: props.dashboardId,
        data: {
          dashboardViewConfig: JSONFunctions.serializeValue(configToSave),
        },
      });
    } catch (err) {
      // A failed save leaves the board on screen, in edit mode, and says why.
      setSaveError(API.getFriendlyErrorMessage(err as Error));
      setIsSaving(false);
      return false;
    }

    setIsSaving(false);
    return true;
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

      /*
       * Restore saved variables, with URL overrides applied so shared
       * links land with the same selection the sender had.
       *
       * This runs on load *and* on "Discard Changes", so it has to be a
       * full reconcile against the fetched config rather than a merge: a
       * config that saved no variables must clear the runtime list. Guard
       * this on `config.variables` and a variable that was added in edit
       * mode and then discarded keeps scoping every widget — and keeps
       * seeding the Variables modal — until the page is reloaded.
       */
      const savedVariables: Array<DashboardVariable> = config.variables || [];
      const urlSelections: ReturnType<
        typeof DashboardVariableUrlState.parseFromSearch
      > = DashboardVariableUrlState.parseFromSearch(window.location.search);
      const restoredVariables: Array<DashboardVariable> =
        DashboardVariableUrlState.applyUrlToVariables(
          savedVariables,
          urlSelections,
        );
      setDashboardVariables(restoredVariables);
      /*
       * Reconcile the URL to the restored set as well. Redefining a
       * variable in edit mode carries its selection onto the new
       * definition and rewrites `var-*` to match, so discarding has to
       * strip the params those discarded definitions left behind —
       * otherwise the link keeps naming variables that no longer exist.
       */
      DashboardVariableUrlState.writeToBrowserUrl(restoredVariables);
    };

  const loadPage: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      await Promise.all([loadAllMetricsTypes(), fetchDashboardViewConfig()]);
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);

    // Warm the autocomplete suggestion cache without blocking the render.
    loadTelemetryAttributesInBackground();
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

  /*
   * `canEditDashboard` is ANDed in here rather than only at the point the
   * mode is set, so the canvas and the toolbar cannot disagree with the gate
   * even if the mode were somehow left over from a permission that has since
   * been revoked.
   */
  const isEditMode: boolean =
    dashboardMode === DashboardMode.Edit && canEditDashboard;

  useEffect(() => {
    handleResize();
    if (dashboardMode === DashboardMode.Edit) {
      loadTelemetryAttributesInBackground();
    }
  }, [dashboardMode, loadTelemetryAttributesInBackground]);

  useEffect(() => {
    if (!pendingScrollComponentId) {
      return undefined;
    }
    const id: string = `dashboard-component-${pendingScrollComponentId.toString()}`;
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      const el: HTMLElement | null = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      setPendingScrollComponentId(null);
    }, 100);
    return () => {
      clearTimeout(timer);
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
        background: isEditMode
          ? "linear-gradient(135deg, var(--ou-background-primary, #f8fafc) 0%, var(--ou-surface-secondary, #f1f5f9) 100%)"
          : "var(--ou-background-primary, #f8f9fb)",
      }}
    >
      <DashboardToolbar
        dashboardMode={isEditMode ? DashboardMode.Edit : DashboardMode.View}
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

          saveDashboardViewConfig(configWithRefresh)
            .then((didSave: boolean) => {
              /*
               * Only leave edit mode once the board is actually persisted.
               * Dropping straight back to view mode meant a refused save
               * looked exactly like a successful one.
               */
              if (didSave) {
                setDashboardMode(DashboardMode.View);
              }
            })
            .catch((err: Error) => {
              setSaveError(API.getFriendlyErrorMessage(err));
            });
        }}
        startAndEndDate={startAndEndDate}
        onStartAndEndDateChange={(
          newStartAndEndDate: RangeStartAndEndDateTime,
        ) => {
          timeRangeZoom.setStartAndEndDate(newStartAndEndDate);
        }}
        isTimeRangeZoomed={timeRangeZoom.isZoomed}
        onResetTimeRangeZoom={timeRangeZoom.resetZoom}
        onCancelEditClick={async () => {
          // load the dashboard view config again
          setSaveError(null);
          setDashboardMode(DashboardMode.View);
          await fetchDashboardViewConfig();
        }}
        canEditDashboard={canEditDashboard}
        editDashboardDisabledReason={editGate.disabledReason}
        onEditClick={() => {
          // Readers get no editor. See `editGate` above.
          if (!canEditDashboard) {
            return;
          }
          setSaveError(null);
          /*
           * Editing hides the time-range picker and the reset button, so a
           * board left zoomed would be stranded on a Custom window with no
           * way out until the user leaves edit mode. Drop the zoom on the
           * way in.
           */
          timeRangeZoom.resetZoom();
          /*
           * Heal any layout corruption (overlapping or out-of-bounds
           * widgets saved by older builds) before editing starts, so
           * every drag begins from a valid board.
           */
          setDashboardViewConfig(
            DashboardViewConfigUtil.normalizeLayout(dashboardViewConfig),
          );
          setDashboardMode(DashboardMode.Edit);
        }}
        autoRefreshInterval={autoRefreshInterval}
        onAutoRefreshIntervalChange={(interval: AutoRefreshInterval) => {
          setAutoRefreshInterval(interval);
        }}
        isRefreshing={isRefreshing}
        variables={dashboardVariables}
        telemetryAttributeOptions={telemetryAttributes}
        onVariableValueChange={(
          variableId: string,
          change: {
            selectedValue?: string | undefined;
            selectedValues?: Array<string> | undefined;
          },
        ) => {
          const updatedVariables: Array<DashboardVariable> =
            dashboardVariables.map((v: DashboardVariable) => {
              if (v.id === variableId) {
                /*
                 * Multi-select selections overwrite both fields so the
                 * stale scalar from a previous single-select doesn't
                 * survive an "All" multi-select.
                 */
                if (change.selectedValues !== undefined) {
                  return {
                    ...v,
                    selectedValues: change.selectedValues,
                    selectedValue: undefined,
                  };
                }
                return { ...v, selectedValue: change.selectedValue };
              }
              return v;
            });
          setDashboardVariables(updatedVariables);
          DashboardVariableUrlState.writeToBrowserUrl(updatedVariables);
          // Trigger refresh when variable changes
          setRefreshTick((prev: number) => {
            return prev + 1;
          });
        }}
        onVariablesDefinitionChange={(updated: Array<DashboardVariable>) => {
          /*
           * Persist new variable definitions onto the dashboard config (so
           * they survive a save) and reset the runtime selection state to
           * mirror them. Preserve any prior selectedValue for variables
           * that still exist by id so the user does not lose context when
           * they tweak an unrelated variable.
           */
          const priorById: Map<string, DashboardVariable> = new Map(
            dashboardVariables.map((v: DashboardVariable) => {
              return [v.id, v];
            }),
          );
          const next: Array<DashboardVariable> = updated.map(
            (v: DashboardVariable) => {
              const prior: DashboardVariable | undefined = priorById.get(v.id);
              return {
                ...v,
                selectedValue: prior?.selectedValue,
                selectedValues: prior?.selectedValues,
              };
            },
          );
          setDashboardVariables(next);
          setDashboardViewConfig({
            ...dashboardViewConfig,
            variables: updated,
          });
          DashboardVariableUrlState.writeToBrowserUrl(next);
          // Lazy-load telemetry attribute options for the autocomplete.
          loadTelemetryAttributesInBackground();
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

          if (componentType === DashboardComponentType.Clock) {
            newComponent = DashboardClockComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.Table) {
            newComponent = DashboardTableComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.Gauge) {
            newComponent = DashboardGaugeComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.DataSourceChart) {
            newComponent =
              DashboardDataSourceChartComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.DataSourceValue) {
            newComponent =
              DashboardDataSourceValueComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.DataSourceGauge) {
            newComponent =
              DashboardDataSourceGaugeComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.DataSourceTable) {
            newComponent =
              DashboardDataSourceTableComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.LogStream) {
            newComponent =
              DashboardLogStreamComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.LogChart) {
            newComponent = DashboardLogChartComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.SecurityEventsList) {
            newComponent =
              DashboardSecurityEventsListComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.SecurityEventsFlow) {
            newComponent =
              DashboardSecurityEventsFlowComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.TraceList) {
            newComponent =
              DashboardTraceListComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.TraceChart) {
            newComponent =
              DashboardTraceChartComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.TraceTable) {
            newComponent =
              DashboardTraceTableComponentUtil.getDefaultComponent();
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

          if (componentType === DashboardComponentType.Slo) {
            newComponent = DashboardSloComponentUtil.getDefaultComponent();
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

          if (componentType === DashboardComponentType.DockerHostList) {
            newComponent =
              DashboardDockerHostListComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.DockerContainerList) {
            newComponent =
              DashboardDockerContainerListComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.DockerImageList) {
            newComponent =
              DashboardDockerImageListComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.DockerNetworkList) {
            newComponent =
              DashboardDockerNetworkListComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.DockerVolumeList) {
            newComponent =
              DashboardDockerVolumeListComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.PodmanHostList) {
            newComponent =
              DashboardPodmanHostListComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.PodmanContainerList) {
            newComponent =
              DashboardPodmanContainerListComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.PodmanImageList) {
            newComponent =
              DashboardPodmanImageListComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.PodmanNetworkList) {
            newComponent =
              DashboardPodmanNetworkListComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.PodmanVolumeList) {
            newComponent =
              DashboardPodmanVolumeListComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.HostList) {
            newComponent = DashboardHostListComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.ProxmoxNodeList) {
            newComponent =
              DashboardProxmoxNodeListComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.ProxmoxGuestList) {
            newComponent =
              DashboardProxmoxGuestListComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.DockerSwarmNodeList) {
            newComponent =
              DashboardDockerSwarmNodeListComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.DockerSwarmServiceList) {
            newComponent =
              DashboardDockerSwarmServiceListComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.CephOsdList) {
            newComponent =
              DashboardCephOsdListComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.CephPoolList) {
            newComponent =
              DashboardCephPoolListComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.NetworkMap) {
            newComponent =
              DashboardNetworkMapComponentUtil.getDefaultComponent();
          }

          if (componentType === DashboardComponentType.Html) {
            newComponent = DashboardHtmlComponentUtil.getDefaultComponent();
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
          setSelectedComponentId(newComponent.componentId);
          setPendingScrollComponentId(newComponent.componentId);
        }}
      />
      {saveError ? (
        <div className="mx-3 mb-3">
          <ErrorMessage message={saveError} />
        </div>
      ) : (
        <></>
      )}
      <div
        ref={dashboardCanvasRef}
        className="px-1 pb-4 mx-3 mb-4 rounded-2xl border border-gray-200/60"
        style={{
          background: "var(--ou-surface-primary, #ffffff)",
          boxShadow: "var(--ou-card-shadow)",
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
          variables={dashboardVariables}
          chartSyncId={props.dashboardId.toString()}
          onDashboardTimeRangeSelect={timeRangeZoom.zoomToTimeRange}
          onDashboardTimeRangeReset={timeRangeZoom.resetZoom}
          isDashboardTimeRangeZoomed={timeRangeZoom.isZoomed}
        />
      </div>
    </div>
  );
};

export default DashboardViewer;

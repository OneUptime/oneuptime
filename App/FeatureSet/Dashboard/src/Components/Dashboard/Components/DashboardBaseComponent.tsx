import React, {
  ComponentType,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardChartComponent from "./DashboardChartComponent";
import DashboardValueComponent from "./DashboardValueComponent";
import DashboardTextComponent from "./DashboardTextComponent";
import DashboardClockComponent from "./DashboardClockComponent";
import DashboardTableComponent from "./DashboardTableComponent";
import DashboardGaugeComponent from "./DashboardGaugeComponent";
import DashboardDataSourceChartComponent from "./DashboardDataSourceChartComponent";
import DashboardDataSourceValueComponent from "./DashboardDataSourceValueComponent";
import DashboardDataSourceGaugeComponent from "./DashboardDataSourceGaugeComponent";
import DashboardDataSourceTableComponent from "./DashboardDataSourceTableComponent";
import DashboardSloComponent from "./DashboardSloComponent";
import DashboardLogStreamComponent from "./DashboardLogStreamComponent";
import DashboardLogChartComponent from "./DashboardLogChartComponent";
import DashboardSecurityEventsListComponent from "./DashboardSecurityEventsListComponent";
import DashboardSecurityEventsFlowComponent from "./DashboardSecurityEventsFlowComponent";
import DashboardTraceListComponent from "./DashboardTraceListComponent";
import DashboardTraceChartComponent from "./DashboardTraceChartComponent";
import DashboardTraceTableComponent from "./DashboardTraceTableComponent";
import DashboardIncidentListComponent from "./DashboardIncidentListComponent";
import DashboardAlertListComponent from "./DashboardAlertListComponent";
import DashboardMonitorListComponent from "./DashboardMonitorListComponent";
import DashboardKubernetesPodListComponent from "./DashboardKubernetesPodListComponent";
import DashboardKubernetesNodeListComponent from "./DashboardKubernetesNodeListComponent";
import DashboardKubernetesNamespaceListComponent from "./DashboardKubernetesNamespaceListComponent";
import DashboardKubernetesDeploymentListComponent from "./DashboardKubernetesDeploymentListComponent";
import DashboardKubernetesStatefulSetListComponent from "./DashboardKubernetesStatefulSetListComponent";
import DashboardKubernetesDaemonSetListComponent from "./DashboardKubernetesDaemonSetListComponent";
import DashboardKubernetesJobListComponent from "./DashboardKubernetesJobListComponent";
import DashboardKubernetesCronJobListComponent from "./DashboardKubernetesCronJobListComponent";
import DashboardDockerHostListComponent from "./DashboardDockerHostListComponent";
import DashboardDockerContainerListComponent from "./DashboardDockerContainerListComponent";
import DashboardDockerImageListComponent from "./DashboardDockerImageListComponent";
import DashboardDockerNetworkListComponent from "./DashboardDockerNetworkListComponent";
import DashboardDockerVolumeListComponent from "./DashboardDockerVolumeListComponent";
import DashboardPodmanHostListComponent from "./DashboardPodmanHostListComponent";
import DashboardPodmanContainerListComponent from "./DashboardPodmanContainerListComponent";
import DashboardPodmanImageListComponent from "./DashboardPodmanImageListComponent";
import DashboardPodmanNetworkListComponent from "./DashboardPodmanNetworkListComponent";
import DashboardPodmanVolumeListComponent from "./DashboardPodmanVolumeListComponent";
import DashboardHostListComponent from "./DashboardHostListComponent";
import DashboardProxmoxNodeListComponent from "./DashboardProxmoxNodeListComponent";
import DashboardProxmoxGuestListComponent from "./DashboardProxmoxGuestListComponent";
import DashboardDockerSwarmNodeListComponent from "./DashboardDockerSwarmNodeListComponent";
import DashboardDockerSwarmServiceListComponent from "./DashboardDockerSwarmServiceListComponent";
import DashboardCephOsdListComponent from "./DashboardCephOsdListComponent";
import DashboardCephPoolListComponent from "./DashboardCephPoolListComponent";
import DashboardNetworkMapComponent from "./DashboardNetworkMapComponent";
import DashboardHtmlComponent from "./DashboardHtmlComponent";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import ObjectID from "Common/Types/ObjectID";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";
import {
  GridDndMode,
  ResizeDirection,
  getResizeCursor,
} from "Common/UI/Utils/UseDashboardGridDnd";

export interface DashboardBaseComponentProps {
  componentId: ObjectID;
  isEditMode: boolean;
  isSelected: boolean;
  key: string;
  onComponentUpdate: (component: DashboardBaseComponent) => void;
  totalCurrentDashboardWidthInPx: number;
  dashboardCanvasTopInPx: number;
  dashboardCanvasLeftInPx: number;
  dashboardCanvasWidthInPx: number;
  dashboardCanvasHeightInPx: number;
  dashboardComponentHeightInPx: number;
  dashboardComponentWidthInPx: number;
  dashboardViewConfig: DashboardViewConfig;
  dashboardStartAndEndDate: RangeStartAndEndDateTime;
  metricTypes: Array<MetricType>;
  refreshTick?: number | undefined;
  /*
   * Dashboard-wide crosshair-sync channel for metric chart widgets (the
   * dashboard id) — see ChartGroup.syncId.
   */
  chartSyncId?: string | undefined;
  variables?: Array<DashboardVariable> | undefined;
  /*
   * Drag-to-zoom on a time-series widget retimes the WHOLE dashboard —
   * a spike is investigated across every panel at once, the way Traces
   * and Logs already work. The shell owns the range, so the widget hands
   * the selected window up rather than narrowing itself.
   */
  onDashboardTimeRangeSelect?:
    | ((startTime: Date, endTime: Date) => void)
    | undefined;
  /*
   * Double-click on a time-series widget: undo the zoom and put the
   * dashboard back on the range it had before the first drag.
   */
  onDashboardTimeRangeReset?: (() => void) | undefined;
  /*
   * True while a drag-selection is narrowing the board. Widgets use it to
   * decide whether a reset gesture has anything to undo — see the chart
   * library's onTimeRangeReset for why an idle handler is not free.
   */
  isDashboardTimeRangeZoomed?: boolean | undefined;
}

export interface ComponentProps extends DashboardBaseComponentProps {
  onClick: () => void;
  /** Set while THIS widget is being dragged or resized. */
  dndActiveMode: GridDndMode | null;
  /** True while any widget on the board has an active gesture. */
  isAnyGestureActive: boolean;
  onMovePointerDown: (event: React.PointerEvent) => void;
  onResizePointerDown: (
    event: React.PointerEvent,
    direction: ResizeDirection,
  ) => void;
}

/**
 * Which concrete widget renders for each component type. Every entry
 * receives the full ComponentProps spread plus its own `component`.
 */
const WIDGET_BY_TYPE: Partial<
  Record<DashboardComponentType, ComponentType<any>>
> = {
  [DashboardComponentType.Text]: DashboardTextComponent,
  [DashboardComponentType.Clock]: DashboardClockComponent,
  [DashboardComponentType.Chart]: DashboardChartComponent,
  [DashboardComponentType.Value]: DashboardValueComponent,
  [DashboardComponentType.Table]: DashboardTableComponent,
  [DashboardComponentType.Gauge]: DashboardGaugeComponent,
  [DashboardComponentType.DataSourceChart]: DashboardDataSourceChartComponent,
  [DashboardComponentType.DataSourceValue]: DashboardDataSourceValueComponent,
  [DashboardComponentType.DataSourceGauge]: DashboardDataSourceGaugeComponent,
  [DashboardComponentType.DataSourceTable]: DashboardDataSourceTableComponent,
  [DashboardComponentType.LogStream]: DashboardLogStreamComponent,
  [DashboardComponentType.LogChart]: DashboardLogChartComponent,
  [DashboardComponentType.SecurityEventsList]:
    DashboardSecurityEventsListComponent,
  [DashboardComponentType.SecurityEventsFlow]:
    DashboardSecurityEventsFlowComponent,
  [DashboardComponentType.TraceList]: DashboardTraceListComponent,
  [DashboardComponentType.TraceChart]: DashboardTraceChartComponent,
  [DashboardComponentType.TraceTable]: DashboardTraceTableComponent,
  [DashboardComponentType.IncidentList]: DashboardIncidentListComponent,
  [DashboardComponentType.AlertList]: DashboardAlertListComponent,
  [DashboardComponentType.MonitorList]: DashboardMonitorListComponent,
  [DashboardComponentType.Slo]: DashboardSloComponent,
  [DashboardComponentType.KubernetesPodList]:
    DashboardKubernetesPodListComponent,
  [DashboardComponentType.KubernetesNodeList]:
    DashboardKubernetesNodeListComponent,
  [DashboardComponentType.KubernetesNamespaceList]:
    DashboardKubernetesNamespaceListComponent,
  [DashboardComponentType.KubernetesDeploymentList]:
    DashboardKubernetesDeploymentListComponent,
  [DashboardComponentType.KubernetesStatefulSetList]:
    DashboardKubernetesStatefulSetListComponent,
  [DashboardComponentType.KubernetesDaemonSetList]:
    DashboardKubernetesDaemonSetListComponent,
  [DashboardComponentType.KubernetesJobList]:
    DashboardKubernetesJobListComponent,
  [DashboardComponentType.KubernetesCronJobList]:
    DashboardKubernetesCronJobListComponent,
  [DashboardComponentType.DockerHostList]: DashboardDockerHostListComponent,
  [DashboardComponentType.DockerContainerList]:
    DashboardDockerContainerListComponent,
  [DashboardComponentType.DockerImageList]: DashboardDockerImageListComponent,
  [DashboardComponentType.DockerNetworkList]:
    DashboardDockerNetworkListComponent,
  [DashboardComponentType.DockerVolumeList]: DashboardDockerVolumeListComponent,
  [DashboardComponentType.PodmanHostList]: DashboardPodmanHostListComponent,
  [DashboardComponentType.PodmanContainerList]:
    DashboardPodmanContainerListComponent,
  [DashboardComponentType.PodmanImageList]: DashboardPodmanImageListComponent,
  [DashboardComponentType.PodmanNetworkList]:
    DashboardPodmanNetworkListComponent,
  [DashboardComponentType.PodmanVolumeList]: DashboardPodmanVolumeListComponent,
  [DashboardComponentType.HostList]: DashboardHostListComponent,
  [DashboardComponentType.ProxmoxNodeList]: DashboardProxmoxNodeListComponent,
  [DashboardComponentType.ProxmoxGuestList]: DashboardProxmoxGuestListComponent,
  [DashboardComponentType.DockerSwarmNodeList]:
    DashboardDockerSwarmNodeListComponent,
  [DashboardComponentType.DockerSwarmServiceList]:
    DashboardDockerSwarmServiceListComponent,
  [DashboardComponentType.CephOsdList]: DashboardCephOsdListComponent,
  [DashboardComponentType.CephPoolList]: DashboardCephPoolListComponent,
  [DashboardComponentType.NetworkMap]: DashboardNetworkMapComponent,
  [DashboardComponentType.Html]: DashboardHtmlComponent,
};

interface ResizeHandleSpec {
  direction: ResizeDirection;
  style: React.CSSProperties;
}

/**
 * Hit areas for the eight resize handles. They hang slightly outside the
 * card (the grid gap is 10px, so a 5px overhang never reaches a
 * neighbour).
 */
const RESIZE_HANDLES: Array<ResizeHandleSpec> = [
  {
    direction: "n",
    style: { top: "-4px", left: "14px", right: "14px", height: "8px" },
  },
  {
    direction: "s",
    style: { bottom: "-4px", left: "14px", right: "14px", height: "8px" },
  },
  {
    direction: "e",
    style: { right: "-4px", top: "14px", bottom: "14px", width: "8px" },
  },
  {
    direction: "w",
    style: { left: "-4px", top: "14px", bottom: "14px", width: "8px" },
  },
  {
    direction: "ne",
    style: { top: "-5px", right: "-5px", width: "14px", height: "14px" },
  },
  {
    direction: "nw",
    style: { top: "-5px", left: "-5px", width: "14px", height: "14px" },
  },
  {
    direction: "se",
    style: { bottom: "-5px", right: "-5px", width: "14px", height: "14px" },
  },
  {
    direction: "sw",
    style: { bottom: "-5px", left: "-5px", width: "14px", height: "14px" },
  },
];

const DashboardBaseComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const component: DashboardBaseComponent =
    props.dashboardViewConfig.components.find((c: DashboardBaseComponent) => {
      return c.componentId.toString() === props.componentId.toString();
    }) as DashboardBaseComponent;

  const [isHovered, setIsHovered] = useState<boolean>(false);

  // Boolean() so a JS caller passing undefined reads as inactive, not active.
  const isActive: boolean = Boolean(props.dndActiveMode);
  const isMoving: boolean = props.dndActiveMode === "move";

  const showHandles: boolean =
    props.isEditMode && (props.isSelected || isHovered || isActive);

  // ── card styling ──────────────────────────────────────────────────────

  let borderClass: string = "border-gray-200";
  let extraClass: string = "";

  if (isActive) {
    borderClass = "border-blue-400";
    extraClass = "ring-2 ring-blue-400/40";
  } else if (props.isSelected && props.isEditMode) {
    borderClass = "border-blue-400";
    extraClass = "ring-2 ring-blue-100";
  } else if (props.isEditMode && isHovered) {
    borderClass = "border-blue-300";
  }

  const className: string = [
    "relative rounded-xl bg-white border overflow-hidden w-full h-full",
    borderClass,
    extraClass,
  ].join(" ");

  const cardShadow: string = isActive
    ? "var(--ou-card-shadow-dragging, 0 20px 40px -8px rgba(59,130,246,0.18), 0 8px 16px -4px rgba(0,0,0,0.1))"
    : props.isSelected && props.isEditMode
      ? "var(--ou-card-shadow-selected, 0 4px 12px -2px rgba(59,130,246,0.12), 0 2px 4px -1px rgba(0,0,0,0.04))"
      : "var(--ou-card-shadow, 0 2px 8px -2px rgba(0,0,0,0.08), 0 1px 4px -1px rgba(0,0,0,0.04))";

  // ── chrome ────────────────────────────────────────────────────────────

  const getEditOverlay: GetReactElementFunction = (): ReactElement => {
    if (!props.isEditMode) {
      return <></>;
    }
    return (
      <div
        className="absolute inset-0 z-10"
        style={{
          cursor: isMoving ? "grabbing" : "grab",
          touchAction: "none",
        }}
        onPointerDown={(event: React.PointerEvent) => {
          props.onMovePointerDown(event);
        }}
      />
    );
  };

  const getHeaderBar: GetReactElementFunction = (): ReactElement => {
    if (!showHandles) {
      return <></>;
    }
    return (
      <div
        className="absolute top-0 left-0 right-0 z-20 flex items-center justify-center pointer-events-none"
        style={{
          height: "28px",
          background:
            "linear-gradient(180deg, rgba(59,130,246,0.08) 0%, rgba(59,130,246,0.02) 100%)",
          borderBottom: "1px solid rgba(59,130,246,0.12)",
        }}
      >
        <div className="flex items-center gap-0.5 opacity-40">
          <svg width="20" height="10" viewBox="0 0 20 10" fill="none">
            <circle cx="4" cy="3" r="1.2" fill="#3b82f6" />
            <circle cx="10" cy="3" r="1.2" fill="#3b82f6" />
            <circle cx="16" cy="3" r="1.2" fill="#3b82f6" />
            <circle cx="4" cy="7" r="1.2" fill="#3b82f6" />
            <circle cx="10" cy="7" r="1.2" fill="#3b82f6" />
            <circle cx="16" cy="7" r="1.2" fill="#3b82f6" />
          </svg>
        </div>
      </div>
    );
  };

  const getTypeBadge: GetReactElementFunction = (): ReactElement => {
    if (!props.isEditMode || isActive || (!props.isSelected && !isHovered)) {
      return <></>;
    }
    return (
      <div
        className="absolute z-20 pointer-events-none"
        style={{
          top: "32px",
          right: "6px",
        }}
      >
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium capitalize"
          style={{
            background:
              "color-mix(in srgb, var(--ou-surface-secondary, #f1f5f9) 90%, transparent)",
            color: "var(--ou-text-muted, #64748b)",
          }}
        >
          {component.componentType}
        </span>
      </div>
    );
  };

  const getResizeHandles: GetReactElementFunction = (): ReactElement => {
    if (!showHandles) {
      return <></>;
    }

    const accent: string = props.isSelected
      ? "rgba(59,130,246,0.8)"
      : "rgba(59,130,246,0.5)";

    return (
      <>
        {RESIZE_HANDLES.map((handle: ResizeHandleSpec) => {
          const isCorner: boolean = handle.direction.length === 2;
          return (
            <div
              key={handle.direction}
              className="absolute z-30"
              style={{
                ...handle.style,
                cursor: getResizeCursor(handle.direction),
                touchAction: "none",
              }}
              onPointerDown={(event: React.PointerEvent) => {
                props.onResizePointerDown(event, handle.direction);
              }}
            >
              {isCorner ? (
                <div
                  className="absolute"
                  style={{
                    width: "8px",
                    height: "8px",
                    ...(handle.direction.includes("s")
                      ? { bottom: "3px" }
                      : { top: "3px" }),
                    ...(handle.direction.includes("e")
                      ? { right: "3px" }
                      : { left: "3px" }),
                    borderRight: handle.direction.includes("e")
                      ? `2px solid ${accent}`
                      : undefined,
                    borderLeft: handle.direction.includes("w")
                      ? `2px solid ${accent}`
                      : undefined,
                    borderBottom: handle.direction.includes("s")
                      ? `2px solid ${accent}`
                      : undefined,
                    borderTop: handle.direction.includes("n")
                      ? `2px solid ${accent}`
                      : undefined,
                    borderRadius: "2px",
                  }}
                />
              ) : (
                <div
                  className="absolute rounded-full"
                  style={{
                    background: accent,
                    ...(handle.direction === "n" || handle.direction === "s"
                      ? {
                          width: "32px",
                          height: "4px",
                          left: "50%",
                          transform: "translateX(-50%)",
                          ...(handle.direction === "n"
                            ? { top: "2px" }
                            : { bottom: "2px" }),
                        }
                      : {
                          width: "4px",
                          height: "32px",
                          top: "50%",
                          transform: "translateY(-50%)",
                          ...(handle.direction === "w"
                            ? { left: "2px" }
                            : { right: "2px" }),
                        }),
                  }}
                />
              )}
            </div>
          );
        })}
      </>
    );
  };

  // ── content ───────────────────────────────────────────────────────────

  const Widget: ComponentType<any> | undefined =
    WIDGET_BY_TYPE[component.componentType];

  return (
    <div
      className={className}
      style={{
        boxShadow: cardShadow,
        transform: isMoving ? "scale(1.02)" : "scale(1)",
        transition: isActive
          ? "transform 0.15s ease"
          : "transform 0.15s ease, box-shadow 0.2s ease, border-color 0.2s ease",
      }}
      onClick={(event: React.MouseEvent) => {
        event.stopPropagation();
        if (!props.isEditMode) {
          props.onClick();
        }
      }}
      onMouseEnter={() => {
        setIsHovered(true);
      }}
      onMouseLeave={() => {
        setIsHovered(false);
      }}
    >
      {getEditOverlay()}
      {getHeaderBar()}
      {getTypeBadge()}

      {/* Component content — keep padding constant in edit mode so the move
          handle and resize handles overlay without resizing the child (which
          would force charts/tables to re-measure and flicker on hover). */}
      <div
        className="w-full h-full"
        style={{
          padding: props.isEditMode ? "28px 12px 12px 12px" : "12px",
        }}
      >
        {Widget ? (
          <Widget
            {...props}
            isEditMode={props.isEditMode}
            isSelected={props.isSelected}
            component={component}
          />
        ) : (
          <></>
        )}
      </div>

      {getResizeHandles()}
    </div>
  );
};

export default DashboardBaseComponentElement;

import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import DashboardTextComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardTextComponent";
import DashboardChartComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardChartComponent";
import DashboardValueComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardValueComponent";
import DashboardTableComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardTableComponent";
import DashboardGaugeComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardGaugeComponent";
import DashboardLogStreamComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardLogStreamComponent";
import DashboardTraceListComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardTraceListComponent";
import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardChartComponent from "./DashboardChartComponent";
import DashboardValueComponent from "./DashboardValueComponent";
import DashboardTextComponent from "./DashboardTextComponent";
import DashboardTableComponent from "./DashboardTableComponent";
import DashboardGaugeComponent from "./DashboardGaugeComponent";
import DashboardLogStreamComponent from "./DashboardLogStreamComponent";
import DashboardTraceListComponent from "./DashboardTraceListComponent";
import DefaultDashboardSize, {
  GetDashboardComponentHeightInDashboardUnits,
  GetDashboardComponentWidthInDashboardUnits,
  GetDashboardUnitHeightInPx,
  GetDashboardUnitWidthInPx,
  MarginForEachUnitInPx,
  SpaceBetweenUnitsInPx,
} from "Common/Types/Dashboard/DashboardSize";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import ObjectID from "Common/Types/ObjectID";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import MetricType from "Common/Models/DatabaseModels/MetricType";

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
}

export interface ComponentProps extends DashboardBaseComponentProps {
  onClick: () => void;
}

type InteractionMode = "idle" | "moving" | "resizing-width" | "resizing-height" | "resizing-corner";

interface DragState {
  startMouseX: number;
  startMouseY: number;
  startComponentTop: number;
  startComponentLeft: number;
  startComponentWidth: number;
  startComponentHeight: number;
}

const DashboardBaseComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const component: DashboardBaseComponent =
    props.dashboardViewConfig.components.find(
      (component: DashboardBaseComponent) => {
        return (
          component.componentId.toString() === props.componentId.toString()
        );
      },
    ) as DashboardBaseComponent;

  const widthOfComponent: number = component.widthInDashboardUnits;
  const heightOfComponent: number = component.heightInDashboardUnits;

  const [interactionMode, setInteractionMode] = useState<InteractionMode>("idle");
  const [isHovered, setIsHovered] = useState<boolean>(false);
  const dragStateRef: React.MutableRefObject<DragState | null> = useRef<DragState | null>(null);
  const dashboardComponentRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);

  const isDraggingOrResizing: boolean = interactionMode !== "idle";

  const eachDashboardUnitInPx: number = GetDashboardUnitWidthInPx(
    props.totalCurrentDashboardWidthInPx,
  );

  const clampPosition: (data: {
    top: number;
    left: number;
    width: number;
    height: number;
  }) => { top: number; left: number } = useCallback((data: {
    top: number;
    left: number;
    width: number;
    height: number;
  }): { top: number; left: number } => {
    let newTop: number = data.top;
    let newLeft: number = data.left;

    const maxLeft: number = DefaultDashboardSize.widthInDashboardUnits - data.width;
    const maxTop: number = props.dashboardViewConfig.heightInDashboardUnits - data.height;

    if (newTop > maxTop) {
      newTop = maxTop;
    }
    if (newLeft > maxLeft) {
      newLeft = maxLeft;
    }
    if (newTop < 0) {
      newTop = 0;
    }
    if (newLeft < 0) {
      newLeft = 0;
    }

    return { top: newTop, left: newLeft };
  }, [props.dashboardViewConfig.heightInDashboardUnits]);

  const clampSize: (data: {
    width: number;
    height: number;
  }) => { width: number; height: number } = useCallback((data: {
    width: number;
    height: number;
  }): { width: number; height: number } => {
    let newWidth: number = data.width;
    let newHeight: number = data.height;

    if (newWidth < component.minWidthInDashboardUnits) {
      newWidth = component.minWidthInDashboardUnits;
    }
    if (newWidth > DefaultDashboardSize.widthInDashboardUnits) {
      newWidth = DefaultDashboardSize.widthInDashboardUnits;
    }
    if (newHeight < component.minHeightInDashboardUnits) {
      newHeight = component.minHeightInDashboardUnits;
    }

    return { width: newWidth, height: newHeight };
  }, [component.minWidthInDashboardUnits, component.minHeightInDashboardUnits]);

  const handleMouseMove: (event: MouseEvent) => void = useCallback(
    (event: MouseEvent): void => {
      if (!dragStateRef.current) {
        return;
      }

      const state: DragState = dragStateRef.current;
      const deltaXInPx: number = event.clientX - state.startMouseX;
      const deltaYInPx: number = event.clientY - state.startMouseY;

      if (interactionMode === "moving") {
        const deltaXUnits: number = Math.round(deltaXInPx / eachDashboardUnitInPx);
        const deltaYUnits: number = Math.round(deltaYInPx / eachDashboardUnitInPx);

        const clamped: { top: number; left: number } = clampPosition({
          top: state.startComponentTop + deltaYUnits,
          left: state.startComponentLeft + deltaXUnits,
          width: component.widthInDashboardUnits,
          height: component.heightInDashboardUnits,
        });

        props.onComponentUpdate({
          ...component,
          topInDashboardUnits: clamped.top,
          leftInDashboardUnits: clamped.left,
        });
      } else if (interactionMode === "resizing-width") {
        if (!dashboardComponentRef.current) {
          return;
        }
        const newWidthPx: number =
          event.pageX -
          (window.scrollX + dashboardComponentRef.current.getBoundingClientRect().left);
        let widthUnits: number = GetDashboardComponentWidthInDashboardUnits(
          props.totalCurrentDashboardWidthInPx,
          newWidthPx,
        );
        const clamped: { width: number; height: number } = clampSize({
          width: widthUnits,
          height: component.heightInDashboardUnits,
        });
        widthUnits = clamped.width;

        props.onComponentUpdate({
          ...component,
          widthInDashboardUnits: widthUnits,
        });
      } else if (interactionMode === "resizing-height") {
        if (!dashboardComponentRef.current) {
          return;
        }
        const newHeightPx: number =
          event.pageY -
          (window.scrollY + dashboardComponentRef.current.getBoundingClientRect().top);
        let heightUnits: number = GetDashboardComponentHeightInDashboardUnits(
          props.totalCurrentDashboardWidthInPx,
          newHeightPx,
        );
        const clamped: { width: number; height: number } = clampSize({
          width: component.widthInDashboardUnits,
          height: heightUnits,
        });
        heightUnits = clamped.height;

        props.onComponentUpdate({
          ...component,
          heightInDashboardUnits: heightUnits,
        });
      } else if (interactionMode === "resizing-corner") {
        if (!dashboardComponentRef.current) {
          return;
        }
        const rect: DOMRect = dashboardComponentRef.current.getBoundingClientRect();
        const newWidthPx: number = event.pageX - (window.scrollX + rect.left);
        const newHeightPx: number = event.pageY - (window.scrollY + rect.top);

        let widthUnits: number = GetDashboardComponentWidthInDashboardUnits(
          props.totalCurrentDashboardWidthInPx,
          newWidthPx,
        );
        let heightUnits: number = GetDashboardComponentHeightInDashboardUnits(
          props.totalCurrentDashboardWidthInPx,
          newHeightPx,
        );

        const clamped: { width: number; height: number } = clampSize({
          width: widthUnits,
          height: heightUnits,
        });
        widthUnits = clamped.width;
        heightUnits = clamped.height;

        props.onComponentUpdate({
          ...component,
          widthInDashboardUnits: widthUnits,
          heightInDashboardUnits: heightUnits,
        });
      }
    },
    [interactionMode, eachDashboardUnitInPx, component, clampPosition, clampSize, props],
  );

  const handleMouseUp: () => void = useCallback((): void => {
    dragStateRef.current = null;
    setInteractionMode("idle");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    if (interactionMode !== "idle") {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "none";
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [interactionMode, handleMouseMove, handleMouseUp]);

  const startInteraction: (
    event: React.MouseEvent,
    mode: InteractionMode,
  ) => void = (event: React.MouseEvent, mode: InteractionMode): void => {
    event.preventDefault();
    event.stopPropagation();

    dragStateRef.current = {
      startMouseX: event.clientX,
      startMouseY: event.clientY,
      startComponentTop: component.topInDashboardUnits,
      startComponentLeft: component.leftInDashboardUnits,
      startComponentWidth: component.widthInDashboardUnits,
      startComponentHeight: component.heightInDashboardUnits,
    };

    setInteractionMode(mode);

    if (mode === "moving") {
      document.body.style.cursor = "grabbing";
    } else if (mode === "resizing-width") {
      document.body.style.cursor = "ew-resize";
    } else if (mode === "resizing-height") {
      document.body.style.cursor = "ns-resize";
    } else if (mode === "resizing-corner") {
      document.body.style.cursor = "nwse-resize";
    }
  };

  // Build class name
  let className: string = `relative rounded-lg col-span-${widthOfComponent} row-span-${heightOfComponent} bg-white border overflow-hidden`;

  if (isDraggingOrResizing) {
    className += " z-50 shadow-2xl ring-2 ring-blue-400/40";
  } else if (props.isSelected && props.isEditMode) {
    className += " border-blue-400 ring-2 ring-blue-100 shadow-lg z-10";
  } else if (props.isEditMode && isHovered) {
    className += " border-blue-300 shadow-md z-10 cursor-pointer";
  } else if (props.isEditMode) {
    className += " border-gray-200 hover:border-blue-300 hover:shadow-md cursor-pointer transition-all duration-200";
  } else {
    className += " border-gray-200 hover:shadow-md transition-shadow duration-200";
  }

  const showHandles: boolean = props.isEditMode && (props.isSelected || isHovered);

  const getMoveHandle: GetReactElementFunction = (): ReactElement => {
    if (!props.isEditMode) {
      return <></>;
    }

    // Full-width top drag bar visible on hover or selection
    if (!showHandles) {
      return <></>;
    }

    return (
      <div
        className="absolute top-0 left-0 right-0 z-20 flex items-center justify-center cursor-grab active:cursor-grabbing"
        style={{
          height: "28px",
          background: "linear-gradient(180deg, rgba(59,130,246,0.08) 0%, rgba(59,130,246,0.02) 100%)",
          borderBottom: "1px solid rgba(59,130,246,0.12)",
        }}
        onMouseDown={(event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
          startInteraction(event, "moving");
        }}
      >
        {/* Grip dots pattern */}
        <div className="flex items-center gap-0.5 opacity-40 hover:opacity-70 transition-opacity">
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

  const getResizeWidthHandle: GetReactElementFunction = (): ReactElement => {
    if (!showHandles) {
      return <></>;
    }

    return (
      <div
        className="absolute z-20 group"
        style={{
          top: "28px",
          right: "-4px",
          bottom: "4px",
          width: "8px",
          cursor: "ew-resize",
        }}
        onMouseDown={(event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
          startInteraction(event, "resizing-width");
        }}
      >
        {/* Visible handle bar */}
        <div
          className="absolute top-1/2 right-0.5 w-1 rounded-full bg-blue-400 group-hover:bg-blue-500 transition-all duration-150"
          style={{
            height: "32px",
            transform: "translateY(-50%)",
            opacity: props.isSelected ? 0.8 : 0.5,
          }}
        />
      </div>
    );
  };

  const getResizeHeightHandle: GetReactElementFunction = (): ReactElement => {
    if (!showHandles) {
      return <></>;
    }

    return (
      <div
        className="absolute z-20 group"
        style={{
          bottom: "-4px",
          left: "4px",
          right: "12px",
          height: "8px",
          cursor: "ns-resize",
        }}
        onMouseDown={(event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
          startInteraction(event, "resizing-height");
        }}
      >
        {/* Visible handle bar */}
        <div
          className="absolute bottom-0.5 left-1/2 h-1 rounded-full bg-blue-400 group-hover:bg-blue-500 transition-all duration-150"
          style={{
            width: "32px",
            transform: "translateX(-50%)",
            opacity: props.isSelected ? 0.8 : 0.5,
          }}
        />
      </div>
    );
  };

  const getResizeCornerHandle: GetReactElementFunction = (): ReactElement => {
    if (!showHandles) {
      return <></>;
    }

    return (
      <div
        className="absolute z-30 group"
        style={{
          bottom: "-4px",
          right: "-4px",
          width: "16px",
          height: "16px",
          cursor: "nwse-resize",
        }}
        onMouseDown={(event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
          startInteraction(event, "resizing-corner");
        }}
      >
        {/* Corner triangle indicator */}
        <div
          className="absolute bottom-1 right-1 transition-all duration-150"
          style={{
            width: "8px",
            height: "8px",
            borderRight: `2px solid ${props.isSelected ? "rgba(59,130,246,0.8)" : "rgba(59,130,246,0.5)"}`,
            borderBottom: `2px solid ${props.isSelected ? "rgba(59,130,246,0.8)" : "rgba(59,130,246,0.5)"}`,
            borderRadius: "0 0 2px 0",
          }}
        />
      </div>
    );
  };

  // Size tooltip during resize
  const getSizeTooltip: GetReactElementFunction = (): ReactElement => {
    if (!isDraggingOrResizing) {
      return <></>;
    }

    let label: string = "";

    if (interactionMode === "moving") {
      label = `${component.leftInDashboardUnits}, ${component.topInDashboardUnits}`;
    } else {
      label = `${component.widthInDashboardUnits} \u00d7 ${component.heightInDashboardUnits}`;
    }

    return (
      <div
        className="absolute z-50 pointer-events-none"
        style={{
          top: "-32px",
          left: "50%",
          transform: "translateX(-50%)",
        }}
      >
        <div
          className="px-2 py-1 rounded-md text-xs font-mono font-medium text-white whitespace-nowrap"
          style={{
            background: "rgba(30, 41, 59, 0.9)",
            backdropFilter: "blur(4px)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          }}
        >
          {label}
        </div>
      </div>
    );
  };

  const componentHeight: number =
    GetDashboardUnitHeightInPx(props.totalCurrentDashboardWidthInPx) *
      heightOfComponent +
    SpaceBetweenUnitsInPx * (heightOfComponent - 1);

  const componentWidth: number =
    GetDashboardUnitWidthInPx(props.totalCurrentDashboardWidthInPx) *
      widthOfComponent +
    (SpaceBetweenUnitsInPx - 2) * (widthOfComponent - 1);

  return (
    <div
      className={className}
      style={{
        margin: `${MarginForEachUnitInPx}px`,
        height: `${componentHeight}px`,
        width: `${componentWidth}px`,
        boxShadow: isDraggingOrResizing
          ? "0 20px 40px -8px rgba(59, 130, 246, 0.15), 0 8px 16px -4px rgba(0, 0, 0, 0.08)"
          : props.isSelected && props.isEditMode
            ? "0 4px 12px -2px rgba(59, 130, 246, 0.12), 0 2px 4px -1px rgba(0, 0, 0, 0.04)"
            : "0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px -1px rgba(0, 0, 0, 0.03)",
        transform: isDraggingOrResizing ? "scale(1.01)" : "scale(1)",
        transition: isDraggingOrResizing ? "none" : "box-shadow 0.2s ease, transform 0.15s ease, border-color 0.2s ease",
      }}
      key={component.componentId?.toString() || Math.random().toString()}
      ref={dashboardComponentRef}
      onClick={(e: React.MouseEvent) => {
        if (!isDraggingOrResizing) {
          props.onClick();
        }
        e.stopPropagation();
      }}
      onMouseEnter={() => {
        setIsHovered(true);
      }}
      onMouseLeave={() => {
        setIsHovered(false);
      }}
    >
      {getMoveHandle()}
      {getSizeTooltip()}

      {/* Component type badge - visible on hover or selection in edit mode */}
      {props.isEditMode && (props.isSelected || isHovered) && (
        <div
          className="absolute z-10"
          style={{
            top: showHandles ? "32px" : "6px",
            right: "6px",
          }}
        >
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium capitalize"
            style={{
              background: "rgba(241, 245, 249, 0.9)",
              color: "#64748b",
              backdropFilter: "blur(4px)",
            }}
          >
            {component.componentType}
          </span>
        </div>
      )}

      {/* Component content area */}
      <div
        className="w-full h-full"
        style={{
          paddingTop: showHandles ? "28px" : "0px",
          padding: showHandles ? "28px 12px 12px 12px" : "12px",
        }}
      >
        {component.componentType === DashboardComponentType.Text && (
          <DashboardTextComponent
            {...props}
            isEditMode={props.isEditMode}
            isSelected={props.isSelected}
            component={component as DashboardTextComponentType}
          />
        )}
        {component.componentType === DashboardComponentType.Chart && (
          <DashboardChartComponent
            {...props}
            isEditMode={props.isEditMode}
            isSelected={props.isSelected}
            component={component as DashboardChartComponentType}
          />
        )}
        {component.componentType === DashboardComponentType.Value && (
          <DashboardValueComponent
            {...props}
            isSelected={props.isSelected}
            isEditMode={props.isEditMode}
            component={component as DashboardValueComponentType}
          />
        )}
        {component.componentType === DashboardComponentType.Table && (
          <DashboardTableComponent
            {...props}
            isEditMode={props.isEditMode}
            isSelected={props.isSelected}
            component={component as DashboardTableComponentType}
          />
        )}
        {component.componentType === DashboardComponentType.Gauge && (
          <DashboardGaugeComponent
            {...props}
            isEditMode={props.isEditMode}
            isSelected={props.isSelected}
            component={component as DashboardGaugeComponentType}
          />
        )}
        {component.componentType === DashboardComponentType.LogStream && (
          <DashboardLogStreamComponent
            {...props}
            isEditMode={props.isEditMode}
            isSelected={props.isSelected}
            component={component as DashboardLogStreamComponentType}
          />
        )}
        {component.componentType === DashboardComponentType.TraceList && (
          <DashboardTraceListComponent
            {...props}
            isEditMode={props.isEditMode}
            isSelected={props.isSelected}
            component={component as DashboardTraceListComponentType}
          />
        )}
      </div>

      {getResizeWidthHandle()}
      {getResizeHeightHandle()}
      {getResizeCornerHandle()}
    </div>
  );
};

export default DashboardBaseComponentElement;

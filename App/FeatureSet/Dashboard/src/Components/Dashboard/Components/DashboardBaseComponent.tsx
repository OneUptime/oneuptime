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

type InteractionMode =
  | "idle"
  | "moving"
  | "resizing-width"
  | "resizing-height"
  | "resizing-corner";

interface DragState {
  mode: InteractionMode;
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
      (c: DashboardBaseComponent) => {
        return c.componentId.toString() === props.componentId.toString();
      },
    ) as DashboardBaseComponent;

  const widthOfComponent: number = component.widthInDashboardUnits;
  const heightOfComponent: number = component.heightInDashboardUnits;

  const [interactionMode, setInteractionMode] =
    useState<InteractionMode>("idle");
  const [isHovered, setIsHovered] = useState<boolean>(false);

  // Refs to hold mutable values the mouse handler reads.
  // This avoids recreating the handler (and removing/re-adding listeners) on
  // every render, which was causing the flicker.
  const dragStateRef: React.MutableRefObject<DragState | null> =
    useRef<DragState | null>(null);
  const componentRef: React.MutableRefObject<DashboardBaseComponent> =
    useRef<DashboardBaseComponent>(component);
  const propsRef: React.MutableRefObject<ComponentProps> =
    useRef<ComponentProps>(props);
  const dashboardComponentRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);

  // Keep refs in sync with latest values on every render.
  componentRef.current = component;
  propsRef.current = props;

  const isDraggingOrResizing: boolean = interactionMode !== "idle";

  // Stable handler — never recreated.  Reads everything from refs.
  const handleMouseMove: (event: MouseEvent) => void = useCallback(
    (event: MouseEvent): void => {
      const state: DragState | null = dragStateRef.current;

      if (!state) {
        return;
      }

      const currentComponent: DashboardBaseComponent = componentRef.current;
      const currentProps: ComponentProps = propsRef.current;
      const unitPx: number = GetDashboardUnitWidthInPx(
        currentProps.totalCurrentDashboardWidthInPx,
      );
      const deltaXInPx: number = event.clientX - state.startMouseX;
      const deltaYInPx: number = event.clientY - state.startMouseY;

      if (state.mode === "moving") {
        const deltaXUnits: number = Math.round(deltaXInPx / unitPx);
        const deltaYUnits: number = Math.round(deltaYInPx / unitPx);

        let newTop: number = state.startComponentTop + deltaYUnits;
        let newLeft: number = state.startComponentLeft + deltaXUnits;

        // Clamp to bounds
        const maxLeft: number =
          DefaultDashboardSize.widthInDashboardUnits -
          currentComponent.widthInDashboardUnits;
        const maxTop: number =
          currentProps.dashboardViewConfig.heightInDashboardUnits -
          currentComponent.heightInDashboardUnits;

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

        // Only update if position actually changed
        if (
          newTop !== currentComponent.topInDashboardUnits ||
          newLeft !== currentComponent.leftInDashboardUnits
        ) {
          currentProps.onComponentUpdate({
            ...currentComponent,
            topInDashboardUnits: newTop,
            leftInDashboardUnits: newLeft,
          });
        }
      } else if (state.mode === "resizing-width") {
        if (!dashboardComponentRef.current) {
          return;
        }
        const rect: DOMRect =
          dashboardComponentRef.current.getBoundingClientRect();
        const newWidthPx: number = event.pageX - (window.scrollX + rect.left);
        let widthUnits: number = GetDashboardComponentWidthInDashboardUnits(
          currentProps.totalCurrentDashboardWidthInPx,
          Math.max(newWidthPx, unitPx),
        );

        if (widthUnits < currentComponent.minWidthInDashboardUnits) {
          widthUnits = currentComponent.minWidthInDashboardUnits;
        }
        if (widthUnits > DefaultDashboardSize.widthInDashboardUnits) {
          widthUnits = DefaultDashboardSize.widthInDashboardUnits;
        }

        if (widthUnits !== currentComponent.widthInDashboardUnits) {
          currentProps.onComponentUpdate({
            ...currentComponent,
            widthInDashboardUnits: widthUnits,
          });
        }
      } else if (state.mode === "resizing-height") {
        if (!dashboardComponentRef.current) {
          return;
        }
        const rect: DOMRect =
          dashboardComponentRef.current.getBoundingClientRect();
        const newHeightPx: number = event.pageY - (window.scrollY + rect.top);
        let heightUnits: number = GetDashboardComponentHeightInDashboardUnits(
          currentProps.totalCurrentDashboardWidthInPx,
          Math.max(newHeightPx, unitPx),
        );

        if (heightUnits < currentComponent.minHeightInDashboardUnits) {
          heightUnits = currentComponent.minHeightInDashboardUnits;
        }

        if (heightUnits !== currentComponent.heightInDashboardUnits) {
          currentProps.onComponentUpdate({
            ...currentComponent,
            heightInDashboardUnits: heightUnits,
          });
        }
      } else if (state.mode === "resizing-corner") {
        if (!dashboardComponentRef.current) {
          return;
        }
        const rect: DOMRect =
          dashboardComponentRef.current.getBoundingClientRect();
        const newWidthPx: number = event.pageX - (window.scrollX + rect.left);
        const newHeightPx: number = event.pageY - (window.scrollY + rect.top);

        let widthUnits: number = GetDashboardComponentWidthInDashboardUnits(
          currentProps.totalCurrentDashboardWidthInPx,
          Math.max(newWidthPx, unitPx),
        );
        let heightUnits: number = GetDashboardComponentHeightInDashboardUnits(
          currentProps.totalCurrentDashboardWidthInPx,
          Math.max(newHeightPx, unitPx),
        );

        if (widthUnits < currentComponent.minWidthInDashboardUnits) {
          widthUnits = currentComponent.minWidthInDashboardUnits;
        }
        if (widthUnits > DefaultDashboardSize.widthInDashboardUnits) {
          widthUnits = DefaultDashboardSize.widthInDashboardUnits;
        }
        if (heightUnits < currentComponent.minHeightInDashboardUnits) {
          heightUnits = currentComponent.minHeightInDashboardUnits;
        }

        if (
          widthUnits !== currentComponent.widthInDashboardUnits ||
          heightUnits !== currentComponent.heightInDashboardUnits
        ) {
          currentProps.onComponentUpdate({
            ...currentComponent,
            widthInDashboardUnits: widthUnits,
            heightInDashboardUnits: heightUnits,
          });
        }
      }
    },
    [], // No dependencies — reads from refs
  );

  // Stable handler — never recreated.
  const handleMouseUp: () => void = useCallback((): void => {
    dragStateRef.current = null;
    setInteractionMode("idle");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseMove]);

  // Clean up listeners if the component unmounts mid-drag.
  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const startInteraction: (
    event: React.MouseEvent,
    mode: InteractionMode,
  ) => void = (event: React.MouseEvent, mode: InteractionMode): void => {
    event.preventDefault();
    event.stopPropagation();

    const currentComponent: DashboardBaseComponent = componentRef.current;

    dragStateRef.current = {
      mode,
      startMouseX: event.clientX,
      startMouseY: event.clientY,
      startComponentTop: currentComponent.topInDashboardUnits,
      startComponentLeft: currentComponent.leftInDashboardUnits,
      startComponentWidth: currentComponent.widthInDashboardUnits,
      startComponentHeight: currentComponent.heightInDashboardUnits,
    };

    setInteractionMode(mode);

    // Attach listeners directly — not via useEffect.
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    document.body.style.userSelect = "none";

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
    className +=
      " border-blue-300 shadow-md z-10 cursor-pointer";
  } else if (props.isEditMode) {
    className +=
      " border-gray-200 hover:border-blue-300 hover:shadow-md cursor-pointer transition-all duration-200";
  } else {
    className +=
      " border-gray-200 hover:shadow-md transition-shadow duration-200";
  }

  const showHandles: boolean =
    props.isEditMode && (props.isSelected || isHovered);

  const getMoveHandle: GetReactElementFunction = (): ReactElement => {
    if (!showHandles) {
      return <></>;
    }

    return (
      <div
        className="absolute top-0 left-0 right-0 z-20 flex items-center justify-center cursor-grab active:cursor-grabbing"
        style={{
          height: "28px",
          background:
            "linear-gradient(180deg, rgba(59,130,246,0.08) 0%, rgba(59,130,246,0.02) 100%)",
          borderBottom: "1px solid rgba(59,130,246,0.12)",
        }}
        onMouseDown={(
          event: React.MouseEvent<HTMLDivElement, MouseEvent>,
        ) => {
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
        onMouseDown={(
          event: React.MouseEvent<HTMLDivElement, MouseEvent>,
        ) => {
          startInteraction(event, "resizing-width");
        }}
      >
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
        onMouseDown={(
          event: React.MouseEvent<HTMLDivElement, MouseEvent>,
        ) => {
          startInteraction(event, "resizing-height");
        }}
      >
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
        onMouseDown={(
          event: React.MouseEvent<HTMLDivElement, MouseEvent>,
        ) => {
          startInteraction(event, "resizing-corner");
        }}
      >
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
        transition: isDraggingOrResizing
          ? "none"
          : "box-shadow 0.2s ease, transform 0.15s ease, border-color 0.2s ease",
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
        if (!isDraggingOrResizing) {
          setIsHovered(false);
        }
      }}
    >
      {getMoveHandle()}
      {getSizeTooltip()}

      {/* Component type badge */}
      {props.isEditMode && (props.isSelected || isHovered) && (
        <div
          className="absolute z-10 pointer-events-none"
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

import React, {
  FunctionComponent,
  ReactElement,
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

/*
 * ────────────────────────────────────────────────────────────
 * All mutable drag/resize state lives here, outside React.
 * Nothing in this struct triggers a re-render.
 * ────────────────────────────────────────────────────────────
 */
interface DragSession {
  mode: "move" | "resize-w" | "resize-h" | "resize-corner";
  startMouseX: number;
  startMouseY: number;
  // Snapped values at the START of the gesture (dashboard units)
  originTop: number;
  originLeft: number;
  originWidth: number;
  originHeight: number;
  // Live snapped values (updated every mousemove, used on commit)
  liveTop: number;
  liveLeft: number;
  liveWidth: number;
  liveHeight: number;
}

const DashboardBaseComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // ── Derived data ──────────────────────────────────────────
  const component: DashboardBaseComponent =
    props.dashboardViewConfig.components.find((c: DashboardBaseComponent) => {
      return c.componentId.toString() === props.componentId.toString();
    }) as DashboardBaseComponent;

  const widthOfComponent: number = component.widthInDashboardUnits;
  const heightOfComponent: number = component.heightInDashboardUnits;

  // ── Minimal React state (only for hover gating) ───────────
  const [isHovered, setIsHovered] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // ── Refs ──────────────────────────────────────────────────
  const elRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const tooltipRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const sessionRef: React.MutableRefObject<DragSession | null> =
    useRef<DragSession | null>(null);
  const overlayRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const latestProps: React.MutableRefObject<ComponentProps> =
    useRef<ComponentProps>(props);
  const latestComponent: React.MutableRefObject<DashboardBaseComponent> =
    useRef<DashboardBaseComponent>(component);
  latestProps.current = props;
  latestComponent.current = component;

  // ── Core imperative handlers (stable — no deps) ──────────

  function updateTooltip(session: DragSession): void {
    if (!tooltipRef.current) {
      return;
    }
    if (session.mode === "move") {
      tooltipRef.current.textContent = `${session.liveLeft}, ${session.liveTop}`;
    } else {
      tooltipRef.current.textContent = `${session.liveWidth} \u00d7 ${session.liveHeight}`;
    }
  }

  function onMouseMove(e: MouseEvent): void {
    const s: DragSession | null = sessionRef.current;
    if (!s) {
      return;
    }

    const p: ComponentProps = latestProps.current;
    const c: DashboardBaseComponent = latestComponent.current;
    const uW: number = GetDashboardUnitWidthInPx(
      p.totalCurrentDashboardWidthInPx,
    );
    const uH: number = GetDashboardUnitHeightInPx(
      p.totalCurrentDashboardWidthInPx,
    );
    const g: number = SpaceBetweenUnitsInPx;

    const dxPx: number = e.clientX - s.startMouseX;
    const dyPx: number = e.clientY - s.startMouseY;

    const el: HTMLDivElement | null = elRef.current;
    if (!el) {
      return;
    }

    if (s.mode === "move") {
      el.style.transform = `translate(${dxPx}px, ${dyPx}px) scale(1.01)`;
      el.style.zIndex = "100";

      const dxUnits: number = Math.round(dxPx / uW);
      const dyUnits: number = Math.round(dyPx / uH);

      let newLeft: number = s.originLeft + dxUnits;
      let newTop: number = s.originTop + dyUnits;
      const maxLeft: number =
        DefaultDashboardSize.widthInDashboardUnits - c.widthInDashboardUnits;
      const maxTop: number =
        p.dashboardViewConfig.heightInDashboardUnits - c.heightInDashboardUnits;
      newLeft = Math.max(0, Math.min(newLeft, maxLeft));
      newTop = Math.max(0, Math.min(newTop, maxTop));

      s.liveLeft = newLeft;
      s.liveTop = newTop;

      updateTooltip(s);
    } else {
      const rect: DOMRect = el.getBoundingClientRect();

      if (s.mode === "resize-w" || s.mode === "resize-corner") {
        const wPx: number = Math.max(
          uW,
          e.pageX - (window.scrollX + rect.left),
        );
        let wUnits: number = GetDashboardComponentWidthInDashboardUnits(
          p.totalCurrentDashboardWidthInPx,
          wPx,
        );
        wUnits = Math.max(c.minWidthInDashboardUnits, wUnits);
        wUnits = Math.min(DefaultDashboardSize.widthInDashboardUnits, wUnits);
        s.liveWidth = wUnits;

        const newWidthPx: number = uW * wUnits + g * (wUnits - 1);
        el.style.width = `${newWidthPx}px`;
      }

      if (s.mode === "resize-h" || s.mode === "resize-corner") {
        const hPx: number = Math.max(uH, e.pageY - (window.scrollY + rect.top));
        let hUnits: number = GetDashboardComponentHeightInDashboardUnits(
          p.totalCurrentDashboardWidthInPx,
          hPx,
        );
        hUnits = Math.max(c.minHeightInDashboardUnits, hUnits);
        s.liveHeight = hUnits;

        const newHeightPx: number = uH * hUnits + g * (hUnits - 1);
        el.style.height = `${newHeightPx}px`;
      }

      updateTooltip(s);
    }
  }

  function removeOverlay(): void {
    if (overlayRef.current) {
      overlayRef.current.remove();
      overlayRef.current = null;
    }
  }

  function createOverlay(cursor: string): void {
    removeOverlay();
    const overlay: HTMLDivElement = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "9999";
    overlay.style.cursor = cursor;
    overlay.style.background = "transparent";
    document.body.appendChild(overlay);
    overlayRef.current = overlay;
  }

  function onMouseUp(): void {
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    removeOverlay();

    const s: DragSession | null = sessionRef.current;
    const el: HTMLDivElement | null = elRef.current;

    if (el) {
      el.style.transform = "";
      el.style.zIndex = "";
      el.style.width = "";
      el.style.height = "";
    }

    sessionRef.current = null;
    setIsDragging(false);

    if (!s) {
      return;
    }

    const c: DashboardBaseComponent = latestComponent.current;
    const p: ComponentProps = latestProps.current;

    const updated: DashboardBaseComponent = { ...c };
    let changed: boolean = false;

    if (s.mode === "move") {
      if (
        s.liveTop !== c.topInDashboardUnits ||
        s.liveLeft !== c.leftInDashboardUnits
      ) {
        updated.topInDashboardUnits = s.liveTop;
        updated.leftInDashboardUnits = s.liveLeft;
        changed = true;
      }
    } else {
      if (s.liveWidth !== c.widthInDashboardUnits) {
        updated.widthInDashboardUnits = s.liveWidth;
        changed = true;
      }
      if (s.liveHeight !== c.heightInDashboardUnits) {
        updated.heightInDashboardUnits = s.liveHeight;
        changed = true;
      }
    }

    if (changed) {
      p.onComponentUpdate(updated);
    }
  }

  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      removeOverlay();
    };
  }, []);

  // ── Start a drag / resize session ─────────────────────────
  function startSession(e: React.MouseEvent, mode: DragSession["mode"]): void {
    e.preventDefault();
    e.stopPropagation();

    const c: DashboardBaseComponent = latestComponent.current;

    const session: DragSession = {
      mode,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      originTop: c.topInDashboardUnits,
      originLeft: c.leftInDashboardUnits,
      originWidth: c.widthInDashboardUnits,
      originHeight: c.heightInDashboardUnits,
      liveTop: c.topInDashboardUnits,
      liveLeft: c.leftInDashboardUnits,
      liveWidth: c.widthInDashboardUnits,
      liveHeight: c.heightInDashboardUnits,
    };

    sessionRef.current = session;
    setIsDragging(true);

    updateTooltip(session);

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    document.body.style.userSelect = "none";

    let cursor: string = "grabbing";
    if (mode === "resize-w") {
      cursor = "ew-resize";
    } else if (mode === "resize-h") {
      cursor = "ns-resize";
    } else if (mode === "resize-corner") {
      cursor = "nwse-resize";
    }

    document.body.style.cursor = cursor;
    createOverlay(cursor);
  }

  // ── Styling ───────────────────────────────────────────────
  const showHandles: boolean =
    props.isEditMode && (props.isSelected || isHovered || isDragging);

  let borderClass: string = "border-gray-200";
  let extraClass: string = "";

  if (isDragging) {
    borderClass = "border-blue-400";
    extraClass = "ring-2 ring-blue-400/40 shadow-2xl";
  } else if (props.isSelected && props.isEditMode) {
    borderClass = "border-blue-400";
    extraClass = "ring-2 ring-blue-100 shadow-lg z-10";
  } else if (props.isEditMode && isHovered) {
    borderClass = "border-blue-300";
    extraClass = "shadow-md z-10 cursor-pointer";
  } else if (props.isEditMode) {
    extraClass =
      "hover:border-blue-300 hover:shadow-md cursor-pointer transition-all duration-200";
  } else {
    extraClass = "hover:shadow-md transition-shadow duration-200";
  }

  const className: string = [
    "relative rounded-xl bg-white border overflow-hidden",
    borderClass,
    extraClass,
  ].join(" ");

  // ── Render ────────────────────────────────────────────────

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
        onMouseDown={(e: React.MouseEvent) => {
          startSession(e, "move");
        }}
      >
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
        onMouseDown={(e: React.MouseEvent) => {
          startSession(e, "resize-w");
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
        onMouseDown={(e: React.MouseEvent) => {
          startSession(e, "resize-h");
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
        onMouseDown={(e: React.MouseEvent) => {
          startSession(e, "resize-corner");
        }}
      >
        <div
          className="absolute bottom-1 right-1"
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

  return (
    <div
      className={className}
      style={{
        gridColumn: `span ${widthOfComponent}`,
        gridRow: `span ${heightOfComponent}`,
        boxShadow: isDragging
          ? "0 20px 40px -8px rgba(59,130,246,0.15), 0 8px 16px -4px rgba(0,0,0,0.08)"
          : props.isSelected && props.isEditMode
            ? "0 4px 12px -2px rgba(59,130,246,0.12), 0 2px 4px -1px rgba(0,0,0,0.04)"
            : "0 2px 8px -2px rgba(0,0,0,0.08), 0 1px 4px -1px rgba(0,0,0,0.04)",
        transition: isDragging
          ? "none"
          : "box-shadow 0.2s ease, border-color 0.2s ease",
      }}
      ref={elRef}
      onClick={(e: React.MouseEvent) => {
        if (!isDragging) {
          props.onClick();
        }
        e.stopPropagation();
      }}
      onMouseEnter={() => {
        setIsHovered(true);
      }}
      onMouseLeave={() => {
        if (!isDragging) {
          setIsHovered(false);
        }
      }}
    >
      {getMoveHandle()}

      {/* Tooltip — updated imperatively via ref, never causes a render */}
      <div
        className="absolute z-50 pointer-events-none"
        style={{
          top: "-32px",
          left: "50%",
          transform: "translateX(-50%)",
          display: isDragging ? "block" : "none",
        }}
      >
        <div
          ref={tooltipRef}
          className="px-2 py-1 rounded-md text-xs font-mono font-medium text-white whitespace-nowrap"
          style={{
            background: "rgba(30, 41, 59, 0.9)",
            backdropFilter: "blur(4px)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          }}
        />
      </div>

      {/* Component type badge */}
      {props.isEditMode && (props.isSelected || isHovered) && !isDragging && (
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
            }}
          >
            {component.componentType}
          </span>
        </div>
      )}

      {/* Component content */}
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

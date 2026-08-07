import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import BlankCanvasElement from "./BlankCanvas";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import DefaultDashboardSize, {
  SpaceBetweenUnitsInPx,
} from "Common/Types/Dashboard/DashboardSize";
import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardBaseComponentElement from "../Components/DashboardBaseComponent";
import ObjectID from "Common/Types/ObjectID";
import ComponentSettingsModal from "./ComponentSettingsModal";
import JSONFunctions from "Common/Types/JSONFunctions";
import DashboardViewConfigUtil from "Common/Utils/Dashboard/DashboardViewConfig";
import GridLayoutUtil, { GridRect } from "Common/Utils/Dashboard/GridLayout";
import useDashboardGridDnd, {
  DashboardGridDndResult,
  GRID_ITEM_TRANSITION,
  ResizeDirection,
} from "Common/UI/Utils/UseDashboardGridDnd";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";

export interface ComponentProps {
  dashboardViewConfig: DashboardViewConfig;
  onDashboardViewConfigChange: (newConfig: DashboardViewConfig) => void;
  isEditMode: boolean;
  currentTotalDashboardWidthInPx: number;
  onComponentSelected: (componentId: ObjectID) => void;
  onComponentUnselected: () => void;
  selectedComponentId: ObjectID | null;
  metrics: {
    metricTypes: Array<MetricType>;
    telemetryAttributes: string[];
  };
  dashboardStartAndEndDate: RangeStartAndEndDateTime;
  refreshTick?: number | undefined;
  variables?: Array<DashboardVariable> | undefined;
}

/** Extra empty rows kept below the lowest widget while editing. */
const EDIT_MODE_BUFFER_ROWS: number = 4;

/** Minimum rows the edit canvas shows, so an empty-ish board has room. */
const EDIT_MODE_MIN_ROWS: number = 12;

const DashboardCanvas: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const gap: number = SpaceBetweenUnitsInPx;
  const columns: number = DefaultDashboardSize.widthInDashboardUnits;

  /*
   * The positioner is the absolutely-positioned coordinate space widgets
   * live in. Its real content width — measured, not guessed from the page
   * width — is the source of truth for the unit size, so widgets get exact
   * pixel dimensions.
   */
  const positionerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const [measuredWidthInPx, setMeasuredWidthInPx] = useState<number>(0);

  useLayoutEffect(() => {
    const element: HTMLDivElement | null = positionerRef.current;
    if (!element) {
      return undefined;
    }

    setMeasuredWidthInPx(element.clientWidth);

    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer: ResizeObserver = new ResizeObserver(() => {
      setMeasuredWidthInPx(element.clientWidth);
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [props.dashboardViewConfig.components.length === 0]);

  const unitSizeInPx: number = Math.max(
    (measuredWidthInPx - (columns - 1) * gap) / columns,
    1,
  );
  const cellSizeInPx: number = unitSizeInPx + gap;

  type UnitsToSizePxFunction = (units: number) => number;
  const unitsToSizePx: UnitsToSizePxFunction = (units: number): number => {
    return units * unitSizeInPx + (units - 1) * gap;
  };

  const components: Array<DashboardBaseComponent> =
    props.dashboardViewConfig.components;

  const committedRects: Array<GridRect> = useMemo(() => {
    return GridLayoutUtil.fromDashboardComponents(components);
  }, [components]);

  const handleCommit: (rects: Array<GridRect>) => void = useCallback(
    (rects: Array<GridRect>): void => {
      const updatedComponents: Array<DashboardBaseComponent> =
        GridLayoutUtil.applyRectsToComponents(
          props.dashboardViewConfig.components,
          rects,
        );

      props.onDashboardViewConfigChange({
        ...props.dashboardViewConfig,
        components: updatedComponents,
        heightInDashboardUnits: Math.max(GridLayoutUtil.requiredRows(rects), 1),
      });
    },
    [props.dashboardViewConfig, props.onDashboardViewConfigChange],
  );

  const handleItemClick: (id: string) => void = useCallback(
    (id: string): void => {
      props.onComponentSelected(new ObjectID(id));
    },
    [props.onComponentSelected],
  );

  const dnd: DashboardGridDndResult = useDashboardGridDnd({
    items: committedRects,
    metrics: {
      unitSizeInPx,
      gapInPx: gap,
      columns,
    },
    isEnabled: props.isEditMode,
    canvasRef: positionerRef,
    onCommit: handleCommit,
    onItemClick: handleItemClick,
  });

  const rectById: Map<string, GridRect> = useMemo(() => {
    return new Map<string, GridRect>(
      dnd.rects.map((rect: GridRect) => {
        return [rect.id, rect];
      }),
    );
  }, [dnd.rects]);

  // ── canvas height ─────────────────────────────────────────────────────

  const contentRows: number = Math.max(dnd.totalRows, 1);
  const containerRows: number = props.isEditMode
    ? Math.max(contentRows + EDIT_MODE_BUFFER_ROWS, EDIT_MODE_MIN_ROWS)
    : contentRows;
  const containerHeightInPx: number = Math.max(
    containerRows * cellSizeInPx - gap,
    0,
  );

  // ── modal helpers (unchanged behaviour) ───────────────────────────────

  type UpdateComponentFunction = (
    updatedComponent: DashboardBaseComponent,
  ) => void;

  const updateComponent: UpdateComponentFunction = (
    updatedComponent: DashboardBaseComponent,
  ): void => {
    const updatedComponents: Array<DashboardBaseComponent> =
      props.dashboardViewConfig.components.map(
        (component: DashboardBaseComponent) => {
          if (
            component.componentId.toString() ===
            updatedComponent.componentId.toString()
          ) {
            return { ...updatedComponent };
          }

          return component;
        },
      );

    const updatedDashboardViewConfig: DashboardViewConfig =
      DashboardViewConfigUtil.normalizeLayout({
        ...props.dashboardViewConfig,
        components: [...updatedComponents],
      });

    props.onDashboardViewConfigChange(
      JSONFunctions.deserializeValue(
        updatedDashboardViewConfig,
      ) as DashboardViewConfig,
    );
  };

  // ── rendering ─────────────────────────────────────────────────────────

  type RenderComponentFunction = (
    component: DashboardBaseComponent,
  ) => ReactElement | null;

  const renderComponent: RenderComponentFunction = (
    component: DashboardBaseComponent,
  ): ReactElement | null => {
    const componentId: ObjectID = component.componentId;
    const id: string = componentId.toString();
    const rect: GridRect | undefined = rectById.get(id);

    if (!rect) {
      return null;
    }

    const isSelected: boolean = props.selectedComponentId?.toString() === id;
    const isActive: boolean = dnd.activeId === id;

    const widthInPx: number = unitsToSizePx(rect.width);
    const heightInPx: number = unitsToSizePx(rect.height);

    return (
      <div
        key={id}
        id={`dashboard-component-${id}`}
        ref={(element: HTMLDivElement | null) => {
          dnd.registerItemElement(id, element);
        }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: `${widthInPx}px`,
          height: `${heightInPx}px`,
          transform: `translate(${rect.left * cellSizeInPx}px, ${
            rect.top * cellSizeInPx
          }px)`,
          transition: isActive ? "none" : GRID_ITEM_TRANSITION,
          zIndex: isSelected && !isActive ? 20 : undefined,
        }}
      >
        <DashboardBaseComponentElement
          dashboardViewConfig={props.dashboardViewConfig}
          isEditMode={props.isEditMode}
          dashboardCanvasHeightInPx={containerHeightInPx}
          dashboardComponentWidthInPx={widthInPx}
          dashboardComponentHeightInPx={heightInPx}
          metricTypes={props.metrics.metricTypes}
          dashboardStartAndEndDate={props.dashboardStartAndEndDate}
          dashboardCanvasWidthInPx={measuredWidthInPx}
          dashboardCanvasTopInPx={0}
          dashboardCanvasLeftInPx={0}
          totalCurrentDashboardWidthInPx={props.currentTotalDashboardWidthInPx}
          componentId={componentId}
          key={id}
          onComponentUpdate={(updatedComponent: DashboardBaseComponent) => {
            updateComponent(updatedComponent);
          }}
          isSelected={isSelected}
          refreshTick={props.refreshTick}
          variables={props.variables}
          onClick={() => {
            props.onComponentSelected(componentId);
          }}
          dndActiveMode={isActive ? dnd.activeMode : null}
          isAnyGestureActive={dnd.isGestureActive}
          onMovePointerDown={(event: React.PointerEvent) => {
            dnd.startMove(id, event);
          }}
          onResizePointerDown={(
            event: React.PointerEvent,
            direction: ResizeDirection,
          ) => {
            dnd.startResize(id, direction, event);
          }}
        />
      </div>
    );
  };

  type RenderPlaceholderFunction = () => ReactElement | null;

  const renderPlaceholder: RenderPlaceholderFunction =
    (): ReactElement | null => {
      const rect: GridRect | null = dnd.placeholderRect;

      if (!rect) {
        return null;
      }

      const label: string =
        dnd.activeMode === "resize"
          ? `${rect.width} × ${rect.height}`
          : `${rect.left + 1}, ${rect.top + 1}`;

      return (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: `${unitsToSizePx(rect.width)}px`,
            height: `${unitsToSizePx(rect.height)}px`,
            transform: `translate(${rect.left * cellSizeInPx}px, ${
              rect.top * cellSizeInPx
            }px)`,
            transition:
              "transform 0.15s ease, width 0.15s ease, height 0.15s ease",
            borderRadius: "12px",
            border: "2px dashed rgba(59, 130, 246, 0.55)",
            background: "rgba(59, 130, 246, 0.08)",
            zIndex: 5,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "6px",
              right: "8px",
              padding: "2px 8px",
              borderRadius: "6px",
              fontSize: "11px",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontWeight: 600,
              color: "#ffffff",
              background: "rgba(30, 41, 59, 0.85)",
            }}
          >
            {label}
          </div>
        </div>
      );
    };

  if (
    !props.dashboardViewConfig ||
    props.dashboardViewConfig.components.length === 0
  ) {
    return <BlankCanvasElement isEditMode={props.isEditMode} />;
  }

  return (
    <div>
      <div
        style={{
          padding: "8px",
        }}
      >
        <div
          ref={positionerRef}
          onClick={(event: React.MouseEvent) => {
            // Only clicks on the empty canvas itself unselect.
            if (event.target === event.currentTarget) {
              props.onComponentUnselected();
            }
          }}
          style={{
            position: "relative",
            width: "100%",
            height: `${containerHeightInPx}px`,
            borderRadius: "12px",
            transition: "height 0.22s cubic-bezier(0.2, 0, 0, 1)",
            backgroundImage: props.isEditMode
              ? "radial-gradient(circle, rgba(148, 163, 184, 0.4) 1.5px, transparent 1.5px)"
              : undefined,
            backgroundSize: props.isEditMode
              ? `${cellSizeInPx}px ${cellSizeInPx}px`
              : undefined,
            backgroundPosition: props.isEditMode
              ? `${-gap / 2 - unitSizeInPx / 2}px ${
                  -gap / 2 - unitSizeInPx / 2
                }px`
              : undefined,
          }}
        >
          {renderPlaceholder()}
          {components.map((component: DashboardBaseComponent) => {
            return renderComponent(component);
          })}
        </div>
      </div>
      {props.selectedComponentId && props.isEditMode && (
        <ComponentSettingsModal
          title="Component Settings"
          description="Edit the settings of this component"
          dashboardViewConfig={props.dashboardViewConfig}
          onClose={() => {
            props.onComponentUnselected();
          }}
          onComponentDelete={() => {
            const updatedComponents: Array<DashboardBaseComponent> =
              props.dashboardViewConfig.components.filter(
                (c: DashboardBaseComponent) => {
                  return (
                    c.componentId.toString() !==
                    props.selectedComponentId?.toString()
                  );
                },
              );

            const updatedDashboardViewConfig: DashboardViewConfig = {
              ...props.dashboardViewConfig,
              components: [...updatedComponents],
            };

            props.onDashboardViewConfigChange(updatedDashboardViewConfig);
          }}
          onComponentDuplicate={(
            componentToDuplicate: DashboardBaseComponent,
          ) => {
            /*
             * Clone the component as-is but give it a brand-new id so it is
             * treated as a separate widget. addComponentToDashboard places
             * it at the first free spot that fits it.
             */
            const duplicatedComponent: DashboardBaseComponent = {
              ...componentToDuplicate,
              componentId: ObjectID.generate(),
            };

            const updatedDashboardViewConfig: DashboardViewConfig =
              JSONFunctions.deserializeValue(
                DashboardViewConfigUtil.addComponentToDashboard({
                  component: duplicatedComponent,
                  dashboardViewConfig: props.dashboardViewConfig,
                }),
              ) as DashboardViewConfig;

            props.onDashboardViewConfigChange(updatedDashboardViewConfig);
            props.onComponentSelected(duplicatedComponent.componentId);
          }}
          componentId={props.selectedComponentId}
          onComponentUpdate={(updatedComponent: DashboardBaseComponent) => {
            updateComponent(updatedComponent);
          }}
          metrics={props.metrics}
          dashboardStartAndEndDate={props.dashboardStartAndEndDate}
          totalCurrentDashboardWidthInPx={props.currentTotalDashboardWidthInPx}
        />
      )}
    </div>
  );
};

export default DashboardCanvas;

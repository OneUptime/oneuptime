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
import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardBaseComponentElement from "../Components/DashboardBaseComponent";
import ObjectID from "Common/Types/ObjectID";
import ComponentSettingsModal from "./ComponentSettingsModal";
import JSONFunctions from "Common/Types/JSONFunctions";
import DashboardViewConfigUtil from "Common/Utils/Dashboard/DashboardViewConfig";
import GridLayoutUtil, { GridRect } from "Common/Utils/Dashboard/GridLayout";
import DashboardBoardLayoutUtil, {
  DASHBOARD_BOARD_COLUMNS,
  DashboardBoardArrangement,
  DashboardBoardBox,
  DashboardBoardLayout,
} from "Common/Utils/Dashboard/DashboardBoardLayout";
import useDashboardGridDnd, {
  DashboardGridDndResult,
  GRID_ITEM_TRANSITION,
  ResizeDirection,
} from "Common/UI/Utils/UseDashboardGridDnd";
import DashboardStackingLayers, {
  DASHBOARD_CANVAS_ISOLATION,
} from "Common/UI/Utils/DashboardStackingLayers";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";
import { TimeRangeZoomProvider } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";

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
  chartSyncId?: string | undefined;
  /*
   * The dashboard on the board: a viewer's sort of each list or table
   * widget is remembered per widget on it.
   */
  dashboardId?: string | undefined;
  variables?: Array<DashboardVariable> | undefined;
  /*
   * Board-wide drag-to-zoom, owned by the dashboard shell above this
   * canvas: a time-series widget hands up the window the user dragged,
   * and a double-click on any of them hands up the undo. Both must be
   * identity-stable — widgets below are React.memo'd.
   */
  onDashboardTimeRangeSelect?:
    | ((startTime: Date, endTime: Date) => void)
    | undefined;
  onDashboardTimeRangeReset?: (() => void) | undefined;
  isDashboardTimeRangeZoomed?: boolean | undefined;
  /*
   * The empty board's own Add Widget (BlankCanvas). Handed in only to
   * someone who may edit the dashboard.
   */
  onAddWidgetClick?: (() => void) | undefined;
  /*
   * Opens one widget's settings in edit mode: the Edit widget a widget that
   * cannot be drawn offers in view mode (DashboardWidgetFallback). Handed in
   * only to someone who may edit the dashboard.
   */
  onEditWidgetClick?: ((componentId: ObjectID) => void) | undefined;
  /*
   * The board is one turn of a playlist on a screen (issue #5235): a
   * display nobody drives. Its widgets draw their data and nothing to act
   * on - no drag-to-zoom and no "Drag to zoom", no Investigate, no Open in
   * Explorer, no series menus. A drawer those open would land under the
   * player, which covers the whole window; the dashboard's own page is
   * where a reader digs in.
   */
  isPlayback?: boolean | undefined;
}

/** Extra empty rows kept below the lowest widget while editing. */
const EDIT_MODE_BUFFER_ROWS: number = 4;

/*
 * The board's widgets when its config holds no list of them. One constant,
 * so the memos keyed on the list do not recompute on every render.
 */
const NO_COMPONENTS: Array<DashboardBaseComponent> = [];

/*
 * The widget list the board draws. Loaders read the stored config through
 * StoredDashboardViewConfig, which always gives a list; this keeps the canvas
 * itself from ever reading a list off a config that has none - the line that
 * threw "Cannot read properties of undefined (reading 'length')" in #4571.
 */
export function getCanvasComponents(
  dashboardViewConfig: DashboardViewConfig | null | undefined,
): Array<DashboardBaseComponent> {
  const components: unknown = dashboardViewConfig?.components;

  return Array.isArray(components)
    ? (components as Array<DashboardBaseComponent>)
    : NO_COMPONENTS;
}

/** Minimum rows the edit canvas shows, so an empty-ish board has room. */
const EDIT_MODE_MIN_ROWS: number = 12;

/*
 * The room the board keeps around its widgets, on every side: room for a
 * selected widget's ring and the resize handles that hang past its edges.
 */
const BOARD_PADDING_IN_PX: number = 8;

// The board: data-arrangement says how its widgets are laid out.
export const DASHBOARD_BOARD_TEST_ID: string = "dashboard-board";

const DashboardCanvas: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const columns: number = DASHBOARD_BOARD_COLUMNS;

  const components: Array<DashboardBaseComponent> = getCanvasComponents(
    props.dashboardViewConfig,
  );

  /*
   * The board fills the width of the place it is drawn in - the dashboard's
   * page beside the side menu, a public dashboard's page, a playlist's
   * screen - and that width, measured, decides how its widgets are laid out
   * (DashboardBoardLayout): on the grid, its units sized to the board so
   * widgets get exact pixel dimensions, or on a phone one under another. It
   * is measured on the board's outer box, whose width comes from its place
   * alone: while editing on a phone, the grid inside it is wider and the
   * board scrolls sideways.
   *
   * The positioner is the coordinate space widgets live in.
   */
  const boardRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const positionerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const [boardWidthInPx, setBoardWidthInPx] = useState<number>(0);

  useLayoutEffect(() => {
    const element: HTMLDivElement | null = boardRef.current;
    if (!element) {
      return undefined;
    }

    const measure: () => void = (): void => {
      setBoardWidthInPx(
        Math.max(element.clientWidth - 2 * BOARD_PADDING_IN_PX, 0),
      );
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer: ResizeObserver = new ResizeObserver(() => {
      measure();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [components.length === 0]);

  const layout: DashboardBoardLayout = DashboardBoardLayoutUtil.getLayout({
    boardWidthInPx,
    isEditMode: props.isEditMode,
  });

  const isStacked: boolean =
    layout.arrangement === DashboardBoardArrangement.Stacked;

  const gap: number = layout.gapInPx;
  const columnCellInPx: number = layout.columnWidthInPx + gap;
  const rowCellInPx: number = layout.rowHeightInPx + gap;

  const committedRects: Array<GridRect> = useMemo(() => {
    return GridLayoutUtil.fromDashboardComponents(components);
  }, [components]);

  /*
   * The widgets in the order they are drawn: on a stacked board, the order
   * the grid is read in; on the grid, as the dashboard lists them (each is
   * placed where its rect says).
   */
  const drawnComponents: Array<DashboardBaseComponent> = useMemo(() => {
    if (!isStacked) {
      return components;
    }

    const indexByRect: Map<GridRect, number> = new Map<GridRect, number>(
      committedRects.map((rect: GridRect, index: number) => {
        return [rect, index];
      }),
    );

    return DashboardBoardLayoutUtil.getStackedOrder(committedRects)
      .map((rect: GridRect) => {
        return components[indexByRect.get(rect) ?? -1];
      })
      .filter((component: DashboardBaseComponent | undefined) => {
        return Boolean(component);
      }) as Array<DashboardBaseComponent>;
  }, [isStacked, components, committedRects]);

  const handleCommit: (rects: Array<GridRect>) => void = useCallback(
    (rects: Array<GridRect>): void => {
      const updatedComponents: Array<DashboardBaseComponent> =
        GridLayoutUtil.applyRectsToComponents(components, rects);

      props.onDashboardViewConfigChange({
        ...props.dashboardViewConfig,
        components: updatedComponents,
        heightInDashboardUnits: Math.max(GridLayoutUtil.requiredRows(rects), 1),
      });
    },
    [props.dashboardViewConfig, components, props.onDashboardViewConfigChange],
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
      unitSizeInPx: layout.columnWidthInPx,
      rowUnitSizeInPx: layout.rowHeightInPx,
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
  const containerHeightInPx: number = isStacked
    ? DashboardBoardLayoutUtil.getStackedHeightOfBoardInPx(
        components.map((component: DashboardBaseComponent, index: number) => {
          return {
            heightInUnits: committedRects[index]?.height ?? 1,
            componentType: component.componentType,
          };
        }),
      )
    : DashboardBoardLayoutUtil.getGridHeightInPx(containerRows, layout);

  // ── modal helpers (unchanged behaviour) ───────────────────────────────

  type UpdateComponentFunction = (
    updatedComponent: DashboardBaseComponent,
  ) => void;

  const updateComponent: UpdateComponentFunction = (
    updatedComponent: DashboardBaseComponent,
  ): void => {
    const updatedComponents: Array<DashboardBaseComponent> = components.map(
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

    /*
     * On the grid, where its rect sits. Stacked, the board's width and the
     * height it has on the narrowest grid, under the widget before it.
     */
    const box: DashboardBoardBox = isStacked
      ? {
          left: 0,
          top: 0,
          width: layout.widthInPx,
          height: DashboardBoardLayoutUtil.getStackedHeightInPx({
            heightInUnits: rect.height,
            componentType: component.componentType,
          }),
        }
      : DashboardBoardLayoutUtil.getGridBox(rect, layout);

    const widthInPx: number = box.width;
    const heightInPx: number = box.height;

    return (
      <div
        key={id}
        id={`dashboard-component-${id}`}
        ref={(element: HTMLDivElement | null) => {
          dnd.registerItemElement(id, element);
        }}
        style={
          isStacked
            ? {
                position: "relative",
                flex: "none",
                width: "100%",
                height: `${heightInPx}px`,
                zIndex:
                  isSelected && !isActive
                    ? DashboardStackingLayers.canvasSelectedComponent
                    : undefined,
              }
            : {
                position: "absolute",
                top: 0,
                left: 0,
                width: `${widthInPx}px`,
                height: `${heightInPx}px`,
                transform: `translate(${box.left}px, ${box.top}px)`,
                transition: isActive ? "none" : GRID_ITEM_TRANSITION,
                zIndex:
                  isSelected && !isActive
                    ? DashboardStackingLayers.canvasSelectedComponent
                    : undefined,
              }
        }
      >
        <DashboardBaseComponentElement
          dashboardViewConfig={props.dashboardViewConfig}
          isEditMode={props.isEditMode}
          dashboardCanvasHeightInPx={containerHeightInPx}
          dashboardComponentWidthInPx={widthInPx}
          dashboardComponentHeightInPx={heightInPx}
          metricTypes={props.metrics.metricTypes}
          dashboardStartAndEndDate={props.dashboardStartAndEndDate}
          dashboardCanvasWidthInPx={layout.widthInPx}
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
          chartSyncId={props.chartSyncId}
          dashboardId={props.dashboardId}
          variables={props.variables}
          onDashboardTimeRangeSelect={props.onDashboardTimeRangeSelect}
          onDashboardTimeRangeReset={props.onDashboardTimeRangeReset}
          isDashboardTimeRangeZoomed={props.isDashboardTimeRangeZoomed}
          isPlayback={props.isPlayback}
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
          onEditWidgetClick={
            props.onEditWidgetClick
              ? () => {
                  props.onEditWidgetClick?.(componentId);
                }
              : undefined
          }
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

      const box: DashboardBoardBox = DashboardBoardLayoutUtil.getGridBox(
        rect,
        layout,
      );

      return (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: `${box.width}px`,
            height: `${box.height}px`,
            transform: `translate(${box.left}px, ${box.top}px)`,
            transition:
              "transform 0.15s ease, width 0.15s ease, height 0.15s ease",
            borderRadius: "12px",
            border: "2px dashed rgba(59, 130, 246, 0.55)",
            background: "rgba(59, 130, 246, 0.08)",
            zIndex: DashboardStackingLayers.canvasPlaceholder,
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

  if (components.length === 0) {
    return (
      <BlankCanvasElement
        isEditMode={props.isEditMode}
        onAddWidgetClick={props.onAddWidgetClick}
      />
    );
  }

  /*
   * While editing on a phone the grid keeps the width it can be edited at
   * (DASHBOARD_MIN_EDIT_GRID_WIDTH_IN_PX), and the board scrolls it
   * sideways. Only then: a board that can scroll clips what a widget draws
   * past its edge, a chart's tooltip at the bottom of the board among them.
   */
  const canvas: ReactElement = (
    <div
      ref={boardRef}
      className={layout.isWiderThanBoard ? "overflow-x-auto" : undefined}
      data-testid={DASHBOARD_BOARD_TEST_ID}
      data-arrangement={layout.arrangement}
    >
      <div
        style={{
          padding: `${BOARD_PADDING_IN_PX}px`,
          width: layout.isWiderThanBoard
            ? `${layout.widthInPx + 2 * BOARD_PADDING_IN_PX}px`
            : undefined,
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
            /*
             * Widgets live in their own layer stack. Without this the raise a
             * selected or dragged tile asks for is measured against the whole
             * page, and it wins - that is issue #3660, where a clicked tile
             * covered the toolbar's auto-refresh menu. See
             * Common/UI/Utils/DashboardStackingLayers.
             */
            isolation: DASHBOARD_CANVAS_ISOLATION,
            width: layout.isWiderThanBoard ? `${layout.widthInPx}px` : "100%",
            // Stacked, the widgets one under another make the board's height.
            display: isStacked ? "flex" : undefined,
            flexDirection: isStacked ? "column" : undefined,
            gap: isStacked ? `${gap}px` : undefined,
            height: isStacked ? undefined : `${containerHeightInPx}px`,
            borderRadius: "12px",
            transition: isStacked
              ? undefined
              : "height 0.22s cubic-bezier(0.2, 0, 0, 1)",
            backgroundImage: props.isEditMode
              ? "radial-gradient(circle, rgba(148, 163, 184, 0.4) 1.5px, transparent 1.5px)"
              : undefined,
            backgroundSize: props.isEditMode
              ? `${columnCellInPx}px ${rowCellInPx}px`
              : undefined,
            backgroundPosition: props.isEditMode
              ? `${-gap / 2 - layout.columnWidthInPx / 2}px ${
                  -gap / 2 - layout.rowHeightInPx / 2
                }px`
              : undefined,
          }}
        >
          {renderPlaceholder()}
          {drawnComponents.map((component: DashboardBaseComponent) => {
            return renderComponent(component);
          })}
        </div>
      </div>
      {props.selectedComponentId && props.isEditMode && (
        <ComponentSettingsModal
          variables={props.variables}
          title="Component Settings"
          description="Edit the settings of this component"
          dashboardViewConfig={props.dashboardViewConfig}
          onClose={() => {
            props.onComponentUnselected();
          }}
          onComponentDelete={() => {
            const updatedComponents: Array<DashboardBaseComponent> =
              components.filter((c: DashboardBaseComponent) => {
                return (
                  c.componentId.toString() !==
                  props.selectedComponentId?.toString()
                );
              });

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

  /*
   * Widgets zoom the board only through the shell's own handlers above
   * (onDashboardTimeRangeSelect / Reset), which every time-series widget
   * receives and gates on edit mode itself. Nothing a surrounding page
   * might offer (TimeRangeZoomScope) may reach a chart on the board: a
   * panel without the board's handlers, in edit mode say, must stay inert
   * rather than retime a page whose range the board does not follow.
   */
  return <TimeRangeZoomProvider zoom={null}>{canvas}</TimeRangeZoomProvider>;
};

export default DashboardCanvas;

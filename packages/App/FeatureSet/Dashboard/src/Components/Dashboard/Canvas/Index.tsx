import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
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
import { isWidgetDrawnHere } from "../Utils/PublicDashboardContext";

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

// How the board's height follows its rows while it is edited.
export const EDITED_BOARD_HEIGHT_TRANSITION: string =
  "height 0.22s cubic-bezier(0.2, 0, 0, 1)";

/*
 * How a widget's box moves to a new place or size on the grid: only while
 * the board is edited. There a dropped widget glides into its cell and its
 * neighbours glide out of its way (Common/UI/Utils/UseDashboardGridDnd);
 * the widget being dragged follows the pointer itself, so it has none.
 *
 * Viewing, nobody moves a widget. Its box changes only when the board's
 * width does - a window resized, Full Screen, a playlist's next turn - and
 * it takes its new size in that frame, as the rest of a page reflows,
 * rather than every widget on the board growing or shrinking for a
 * quarter of a second, its chart drawn again on each frame of it.
 */
export function getWidgetBoxTransition(data: {
  isEditMode: boolean;
  isActive: boolean;
}): string {
  return data.isEditMode && !data.isActive ? GRID_ITEM_TRANSITION : "none";
}

// The board: data-arrangement says how its widgets are laid out.
export const DASHBOARD_BOARD_TEST_ID: string = "dashboard-board";

// What the board holds while its width is being measured: no widget yet.
export const DASHBOARD_BOARD_MEASURING_TEST_ID: string =
  "dashboard-board-measuring";

// The box of no height across the board that its ResizeObserver watches.
export const DASHBOARD_BOARD_WIDTH_PROBE_TEST_ID: string =
  "dashboard-board-width-probe";

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
   *
   * The width is null until the board's box is measured, and the widgets
   * are drawn only once it is (isBoardMeasured, below). They used to be
   * drawn before it, laid out for a board of no width - every widget a few
   * pixels across - and reading the box's width made the browser style
   * them at that size; their measured size then came in through their
   * transition, so on every load each widget grew from a sliver to its
   * size with its rows already in it (the 14.0.95 gate's trace). The
   * board's width itself never changed after it was first drawn.
   */
  const boardRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  // A box of no height across the board: only a new width resizes it.
  const widthProbeRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const positionerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const [boardWidthInPx, setBoardWidthInPx] = useState<number | null>(null);

  /*
   * A layout effect runs after the board's box is on the page and before
   * the browser paints it, and the width it sets is drawn in the same
   * frame: the board is never seen without its widgets.
   */
  useLayoutEffect(() => {
    const element: HTMLDivElement | null = boardRef.current;
    const widthProbe: HTMLDivElement | null = widthProbeRef.current;
    if (!element || !widthProbe) {
      /*
       * The empty board (BlankCanvas) has no box to measure. Its width is
       * forgotten, so the board that comes back with a first widget is
       * measured again before that widget is drawn - the window may have
       * changed in between.
       */
      setBoardWidthInPx(null);
      return undefined;
    }

    const readWidth: () => number = (): number => {
      return Math.max(element.clientWidth - 2 * BOARD_PADDING_IN_PX, 0);
    };

    // The width the widgets are laid out in.
    let laidOutWidth: number = readWidth();
    setBoardWidthInPx(laidOutWidth);

    /*
     * The board's width can change before the browser first paints it, and
     * at any time after: the Tailwind runtime styles classes new to the
     * page a moment after they are added (the margins of the card a board
     * opens in, when it opens with the page), the first layout adds or
     * takes away the window's scrollbar, the window is resized, Full
     * Screen, the side menu beside it comes or goes. follow lays the
     * widgets out to the board's width there and then (flushSync), before
     * the browser paints it: no frame shows them at a width the board does
     * not have. Left to React's own time, they were drawn at the old width
     * for a frame or more - 32px past the board's edge, when a board opened
     * before its card's margins were styled.
     */
    const follow: () => void = (): void => {
      const width: number = readWidth();

      if (width === laidOutWidth) {
        return;
      }

      laidOutWidth = width;
      flushSync(() => {
        setBoardWidthInPx(width);
      });
    };

    /*
     * Read again before the browser lays a frame out: in the board's first
     * frame (the card's late styles are in by then, and the scrollbar the
     * board's first layout adds or takes away), and when the window is
     * resized - Full Screen too - whose resize event comes first.
     */
    let firstFrame: number | null = window.requestAnimationFrame((): void => {
      firstFrame = null;
      follow();
    });

    window.addEventListener("resize", follow);

    /*
     * Anything else - the side menu beside the board coming or going, a
     * scrollbar that comes later, a board that was not shown and is - is
     * reported by a ResizeObserver once the browser has laid the frame out,
     * before it paints it. The widgets are laid out to it there, but the
     * board keeps the height it has until the next frame: a box another
     * observer watches that changes size inside an observer's call cannot
     * be reported in that frame, and the page got "ResizeObserver loop
     * completed with undelivered notifications" (the side menu watches the
     * page's body) whenever a new width changed the board's height. For
     * that one frame its widgets end short of its bottom edge, or run past
     * it; never past its sides.
     *
     * It watches the width probe, a box of no height across the board,
     * which only a new width resizes.
     */
    let heldFrame: number | null = null;

    const holdHeightUntilNextFrame: () => void = (): void => {
      element.style.height = `${element.getBoundingClientRect().height}px`;

      if (heldFrame === null) {
        heldFrame = window.requestAnimationFrame((): void => {
          heldFrame = null;
          element.style.height = "";
        });
      }
    };

    const observer: ResizeObserver | null =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((): void => {
            if (readWidth() === laidOutWidth) {
              return;
            }

            holdHeightUntilNextFrame();
            follow();
          });

    observer?.observe(widthProbe);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", follow);

      if (firstFrame !== null) {
        window.cancelAnimationFrame(firstFrame);
      }

      if (heldFrame !== null) {
        window.cancelAnimationFrame(heldFrame);
        element.style.height = "";
      }
    };
  }, [components.length === 0]);

  /*
   * Whether the board's width is known. Before it is, the board is drawn
   * as its box alone - that is what is measured - and its widgets and the
   * positioner that holds them come with the width, so their first size is
   * their real one. A box measured 0 wide (the board is not shown) counts
   * as known: it is laid out as a board of no width, as before, and drawn
   * again when its observer reports a width.
   */
  const isBoardMeasured: boolean = boardWidthInPx !== null;

  const layout: DashboardBoardLayout = DashboardBoardLayoutUtil.getLayout({
    boardWidthInPx: boardWidthInPx ?? 0,
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
            drawsNoChart: !isWidgetDrawnHere(component.componentType),
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
            /*
             * A public dashboard's log or trace chart says, in a line,
             * that it is not available there: no chart's floor for it.
             */
            drawsNoChart: !isWidgetDrawnHere(component.componentType),
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
                transition: getWidgetBoxTransition({
                  isEditMode: props.isEditMode,
                  isActive,
                }),
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
        ref={widthProbeRef}
        aria-hidden="true"
        style={{ height: 0 }}
        data-testid={DASHBOARD_BOARD_WIDTH_PROBE_TEST_ID}
      />
      <div
        style={{
          padding: `${BOARD_PADDING_IN_PX}px`,
          width: layout.isWiderThanBoard
            ? `${layout.widthInPx + 2 * BOARD_PADDING_IN_PX}px`
            : undefined,
        }}
      >
        {isBoardMeasured ? (
          /*
           * Keyed apart from the measuring box, so React adds it as a box
           * of its own at its real height - not that box, restyled.
           */
          <div
            key="positioner"
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
              /*
               * While editing, the board grows and shrinks with the rows a
               * dragged widget reaches. Viewing, its height changes only
               * with its width, and is taken at once, as its widgets'
               * sizes are (getWidgetBoxTransition).
               */
              transition:
                props.isEditMode && !isStacked
                  ? EDITED_BOARD_HEIGHT_TRANSITION
                  : undefined,
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
        ) : (
          /*
           * The board before its width is known: its box, measured in the
           * layout effect above and never painted like this. As tall as its
           * rows at their least, so the page is about as long as it will
           * be - whether the window shows a scrollbar, which takes from
           * the board's width, is decided as it will be with the widgets.
           */
          <div
            key="measuring"
            style={{ height: `${containerHeightInPx}px` }}
            data-testid={DASHBOARD_BOARD_MEASURING_TEST_ID}
          />
        )}
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

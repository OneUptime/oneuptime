import DefaultDashboardSize, {
  SpaceBetweenUnitsInPx,
} from "../../Types/Dashboard/DashboardSize";
import DashboardComponentType from "../../Types/Dashboard/DashboardComponentType";
import { GridRect } from "./GridLayout";

/*
 * How a dashboard's board lays its widgets out in the width it has: the
 * dashboard inside OneUptime, its public page and a playlist's turn on a
 * screen all draw the same canvas (Dashboard/Canvas/Index.tsx), and it asks
 * here.
 *
 * Widgets are placed on a grid twelve columns wide, in grid units. The board
 * used to be drawn at least 1000px wide, so a narrower screen scrolled it
 * sideways - on a phone the toolbar sat past the right edge of the page, and
 * inside OneUptime even a 1280px window scrolled sideways beside the side
 * menu. Now the board is as wide as the place it is drawn in:
 *
 *   - A wide board (DASHBOARD_SQUARE_GRID_MIN_WIDTH_IN_PX and up) is the grid
 *     it always was: square units, as wide as a twelfth of the board.
 *   - A narrower one keeps the grid, but only the columns narrow: every row
 *     keeps the height it had on the narrowest board before
 *     (DASHBOARD_MIN_ROW_HEIGHT_IN_PX), so a chart keeps its height instead
 *     of turning into a strip.
 *   - On a phone (narrower than DASHBOARD_STACKED_BELOW_WIDTH_IN_PX) the
 *     widgets are shown one under another, each the board's width, in the
 *     order the grid is read: row by row, and left to right within a row.
 *     Each is as tall as on the narrowest grid, and a chart at least
 *     DASHBOARD_STACKED_CHART_MIN_HEIGHT_IN_PX, so its plot has room.
 *
 * While the dashboard is edited, widgets are moved and resized on the grid,
 * so it is the grid at any width: never narrower than
 * DASHBOARD_MIN_EDIT_GRID_WIDTH_IN_PX, below which the board scrolls
 * sideways.
 *
 * React-free and DOM-free, so the canvas and its tests read the same rules.
 */

// The space between two widgets, across and down.
export const DASHBOARD_BOARD_GAP_IN_PX: number = SpaceBetweenUnitsInPx;

// The grid's columns.
export const DASHBOARD_BOARD_COLUMNS: number =
  DefaultDashboardSize.widthInDashboardUnits;

/*
 * The height of a row of the grid on the narrowest board before boards
 * fitted their place: 1000px wide, which left 950px for the grid (twelve
 * 70px units and eleven 10px gaps). A row is never shorter than this.
 */
export const DASHBOARD_MIN_ROW_HEIGHT_IN_PX: number = 70;

/*
 * The width from which the grid's units are square again: twelve units of
 * the smallest row height and the gaps between them (950px).
 */
export const DASHBOARD_SQUARE_GRID_MIN_WIDTH_IN_PX: number =
  DASHBOARD_BOARD_COLUMNS * DASHBOARD_MIN_ROW_HEIGHT_IN_PX +
  (DASHBOARD_BOARD_COLUMNS - 1) * DASHBOARD_BOARD_GAP_IN_PX;

/*
 * A board narrower than this shows its widgets one under another: a phone,
 * upright or on its side, and a tablet upright beside OneUptime's side
 * menu. From here up it is the grid, a unit at least 32px wide; a tablet on
 * its side keeps the dashboard's arrangement.
 */
export const DASHBOARD_STACKED_BELOW_WIDTH_IN_PX: number = 500;

/*
 * While editing, the grid is drawn at least this wide: on a narrower board
 * it scrolls sideways, rather than squeeze twelve columns into a phone.
 */
export const DASHBOARD_MIN_EDIT_GRID_WIDTH_IN_PX: number =
  DASHBOARD_STACKED_BELOW_WIDTH_IN_PX;

/*
 * The least a chart is drawn tall when the widgets are stacked. A chart's
 * title, its series and its legend take about 200px whatever its size,
 * and the narrowest grid's three rows (230px) left its plot almost none; a
 * phone has the room to give it.
 */
export const DASHBOARD_STACKED_CHART_MIN_HEIGHT_IN_PX: number = 400;

// The widgets that draw a chart over time.
export const DASHBOARD_CHART_COMPONENT_TYPES: ReadonlyArray<DashboardComponentType> =
  [
    DashboardComponentType.Chart,
    DashboardComponentType.DataSourceChart,
    DashboardComponentType.LogChart,
    DashboardComponentType.TraceChart,
  ];

export enum DashboardBoardArrangement {
  // On the twelve-column grid, as the dashboard was arranged.
  Grid = "grid",
  // One under another, each the board's width.
  Stacked = "stacked",
}

export interface DashboardBoardLayout {
  arrangement: DashboardBoardArrangement;
  /*
   * The width the widgets are laid out in: the board's, or, while editing
   * a board narrower than the edit grid, the edit grid's.
   */
  widthInPx: number;
  // True when that is wider than the board: the board scrolls sideways.
  isWiderThanBoard: boolean;
  /*
   * A grid unit's width, and a row's height: equal on a wide board. When
   * the widgets are stacked, the board's width and the narrowest row.
   */
  columnWidthInPx: number;
  rowHeightInPx: number;
  gapInPx: number;
}

// A widget's place on the board, in px from the board's top left corner.
export interface DashboardBoardBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

// A widget of a stacked board: its height on the grid, and what it is.
export interface DashboardStackedWidget {
  heightInUnits: number;
  componentType?: DashboardComponentType | string | undefined;
}

export default class DashboardBoardLayoutUtil {
  /*
   * The layout for a board of the given width. A width not measured yet
   * (0) is laid out as the grid, as it was before it was measured.
   */
  public static getLayout(data: {
    boardWidthInPx: number;
    isEditMode: boolean;
  }): DashboardBoardLayout {
    const boardWidthInPx: number =
      Number.isFinite(data.boardWidthInPx) && data.boardWidthInPx > 0
        ? data.boardWidthInPx
        : 0;

    const isMeasured: boolean = boardWidthInPx > 0;

    if (
      !data.isEditMode &&
      isMeasured &&
      boardWidthInPx < DASHBOARD_STACKED_BELOW_WIDTH_IN_PX
    ) {
      return {
        arrangement: DashboardBoardArrangement.Stacked,
        widthInPx: boardWidthInPx,
        isWiderThanBoard: false,
        columnWidthInPx: boardWidthInPx,
        rowHeightInPx: DASHBOARD_MIN_ROW_HEIGHT_IN_PX,
        gapInPx: DASHBOARD_BOARD_GAP_IN_PX,
      };
    }

    const isWiderThanBoard: boolean =
      data.isEditMode &&
      isMeasured &&
      boardWidthInPx < DASHBOARD_MIN_EDIT_GRID_WIDTH_IN_PX;

    const widthInPx: number = isWiderThanBoard
      ? DASHBOARD_MIN_EDIT_GRID_WIDTH_IN_PX
      : boardWidthInPx;

    const columnWidthInPx: number = Math.max(
      (widthInPx - (DASHBOARD_BOARD_COLUMNS - 1) * DASHBOARD_BOARD_GAP_IN_PX) /
        DASHBOARD_BOARD_COLUMNS,
      1,
    );

    return {
      arrangement: DashboardBoardArrangement.Grid,
      widthInPx,
      isWiderThanBoard,
      columnWidthInPx,
      rowHeightInPx: Math.max(columnWidthInPx, DASHBOARD_MIN_ROW_HEIGHT_IN_PX),
      gapInPx: DASHBOARD_BOARD_GAP_IN_PX,
    };
  }

  // The px a run of units spans, along one axis: the units and the gaps between them.
  public static unitsToSizeInPx(
    units: number,
    unitInPx: number,
    gapInPx: number = DASHBOARD_BOARD_GAP_IN_PX,
  ): number {
    return Math.max(units * unitInPx + (units - 1) * gapInPx, 0);
  }

  // A grid widget's box on the board: where its rect sits on the grid.
  public static getGridBox(
    rect: GridRect,
    layout: DashboardBoardLayout,
  ): DashboardBoardBox {
    return {
      left: rect.left * (layout.columnWidthInPx + layout.gapInPx),
      top: rect.top * (layout.rowHeightInPx + layout.gapInPx),
      width: DashboardBoardLayoutUtil.unitsToSizeInPx(
        rect.width,
        layout.columnWidthInPx,
        layout.gapInPx,
      ),
      height: DashboardBoardLayoutUtil.unitsToSizeInPx(
        rect.height,
        layout.rowHeightInPx,
        layout.gapInPx,
      ),
    };
  }

  // The height the grid takes for its rows: rows of the layout's height, and the gaps between them.
  public static getGridHeightInPx(
    rows: number,
    layout: DashboardBoardLayout,
  ): number {
    return DashboardBoardLayoutUtil.unitsToSizeInPx(
      Math.max(rows, 0),
      layout.rowHeightInPx,
      layout.gapInPx,
    );
  }

  /*
   * The widgets of a stacked board, in the order they are shown: the order
   * the grid is read in, row by row from the top, and left to right within
   * a row. Widgets at the same place keep the order the dashboard lists them
   * in. A new list; the rects are the ones given.
   */
  public static getStackedOrder(rects: Array<GridRect>): Array<GridRect> {
    return rects
      .map((rect: GridRect, index: number) => {
        return { rect, index };
      })
      .sort(
        (
          a: { rect: GridRect; index: number },
          b: { rect: GridRect; index: number },
        ) => {
          return (
            DashboardBoardLayoutUtil.orderValue(a.rect.top) -
              DashboardBoardLayoutUtil.orderValue(b.rect.top) ||
            DashboardBoardLayoutUtil.orderValue(a.rect.left) -
              DashboardBoardLayoutUtil.orderValue(b.rect.left) ||
            a.index - b.index
          );
        },
      )
      .map((entry: { rect: GridRect; index: number }) => {
        return entry.rect;
      });
  }

  /*
   * A widget's height when the board stacks its widgets: the height it has
   * on the narrowest grid - its rows, and the gaps between them - and a
   * chart at least DASHBOARD_STACKED_CHART_MIN_HEIGHT_IN_PX.
   */
  public static getStackedHeightInPx(widget: DashboardStackedWidget): number {
    const rows: number =
      Number.isFinite(widget.heightInUnits) && widget.heightInUnits >= 1
        ? Math.round(widget.heightInUnits)
        : 1;

    const heightInPx: number = DashboardBoardLayoutUtil.unitsToSizeInPx(
      rows,
      DASHBOARD_MIN_ROW_HEIGHT_IN_PX,
      DASHBOARD_BOARD_GAP_IN_PX,
    );

    return DashboardBoardLayoutUtil.isChart(widget.componentType)
      ? Math.max(heightInPx, DASHBOARD_STACKED_CHART_MIN_HEIGHT_IN_PX)
      : heightInPx;
  }

  /*
   * The height a stacked board takes: every widget's, and a gap between
   * each two.
   */
  public static getStackedHeightOfBoardInPx(
    widgets: Array<DashboardStackedWidget>,
  ): number {
    if (widgets.length === 0) {
      return 0;
    }

    return (
      widgets.reduce((total: number, widget: DashboardStackedWidget) => {
        return total + DashboardBoardLayoutUtil.getStackedHeightInPx(widget);
      }, 0) +
      (widgets.length - 1) * DASHBOARD_BOARD_GAP_IN_PX
    );
  }

  // Whether a widget of this kind draws a chart over time.
  public static isChart(
    componentType: DashboardComponentType | string | undefined,
  ): boolean {
    return DASHBOARD_CHART_COMPONENT_TYPES.some(
      (chartType: DashboardComponentType) => {
        return chartType === componentType;
      },
    );
  }

  // A coordinate to sort by: a broken one (a corrupt config) goes last.
  private static orderValue(value: number): number {
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
  }
}

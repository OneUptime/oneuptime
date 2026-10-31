import DashboardBoardLayoutUtil, {
  DASHBOARD_BOARD_COLUMNS,
  DASHBOARD_BOARD_GAP_IN_PX,
  DASHBOARD_CHART_COMPONENT_TYPES,
  DASHBOARD_MIN_EDIT_GRID_WIDTH_IN_PX,
  DASHBOARD_MIN_ROW_HEIGHT_IN_PX,
  DASHBOARD_SQUARE_GRID_MIN_WIDTH_IN_PX,
  DASHBOARD_STACKED_BELOW_WIDTH_IN_PX,
  DASHBOARD_STACKED_CHART_MIN_HEIGHT_IN_PX,
  DashboardBoardArrangement,
  DashboardBoardBox,
  DashboardBoardLayout,
} from "../../../Utils/Dashboard/DashboardBoardLayout";
import GridLayoutUtil, { GridRect } from "../../../Utils/Dashboard/GridLayout";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import {
  DashboardTemplateType,
  getTemplateConfig,
} from "../../../Types/Dashboard/DashboardTemplates";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import {
  getValueWidgetLayout,
  ValueWidgetLayout,
} from "../../../Utils/Dashboard/ValueWidgetLayout";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * How a dashboard's board lays its widgets out in the width it has
 * (Common/Utils/Dashboard/DashboardBoardLayout), on the dashboard inside
 * OneUptime, a public dashboard and a playlist's turn alike.
 *
 * The board used to be at least 1000px wide whatever the screen, so a
 * phone scrolled the page sideways with the toolbar past its edge, and
 * inside OneUptime a 1280px window did too, beside the side menu. These
 * pin the three ways it is laid out now: the square grid it always was on
 * a wide board, the grid with narrower columns and rows that keep their
 * height on a narrower one, and on a phone the widgets one under another.
 */

type RectSpec = Partial<GridRect> & { id: string };

function rect(spec: RectSpec): GridRect {
  return {
    left: 0,
    top: 0,
    width: 1,
    height: 1,
    minWidth: 1,
    minHeight: 1,
    ...spec,
  };
}

function ids(rects: Array<GridRect>): Array<string> {
  return rects.map((r: GridRect) => {
    return r.id;
  });
}

function view(width: number): DashboardBoardLayout {
  return DashboardBoardLayoutUtil.getLayout({
    boardWidthInPx: width,
    isEditMode: false,
  });
}

function edit(width: number): DashboardBoardLayout {
  return DashboardBoardLayoutUtil.getLayout({
    boardWidthInPx: width,
    isEditMode: true,
  });
}

describe("the board's numbers", () => {
  test("a row is never shorter than it was on the narrowest board before: 70px", () => {
    expect(DASHBOARD_MIN_ROW_HEIGHT_IN_PX).toBe(70);
  });

  test("the square grid starts where twelve 70px units and their gaps fit: 950px", () => {
    expect(DASHBOARD_BOARD_COLUMNS).toBe(12);
    expect(DASHBOARD_BOARD_GAP_IN_PX).toBe(10);
    expect(DASHBOARD_SQUARE_GRID_MIN_WIDTH_IN_PX).toBe(950);
  });

  test("widgets stack below 500px, and the edit grid is never narrower", () => {
    expect(DASHBOARD_STACKED_BELOW_WIDTH_IN_PX).toBe(500);
    expect(DASHBOARD_MIN_EDIT_GRID_WIDTH_IN_PX).toBe(
      DASHBOARD_STACKED_BELOW_WIDTH_IN_PX,
    );
  });
});

describe("a wide board: the square grid it always was", () => {
  test.each([950, 1000, 1280, 1920, 3840])(
    "at %ipx a unit is a twelfth of the board, as tall as it is wide",
    (width: number) => {
      const layout: DashboardBoardLayout = view(width);

      expect(layout.arrangement).toBe(DashboardBoardArrangement.Grid);
      expect(layout.isWiderThanBoard).toBe(false);
      expect(layout.widthInPx).toBe(width);
      expect(layout.columnWidthInPx).toBeCloseTo((width - 110) / 12, 6);
      expect(layout.rowHeightInPx).toBeCloseTo(layout.columnWidthInPx, 6);
      expect(layout.gapInPx).toBe(10);
    },
  );

  test("twelve units and eleven gaps fill the board exactly", () => {
    for (const width of [950, 1017, 1264, 2000]) {
      const layout: DashboardBoardLayout = view(width);

      expect(
        DashboardBoardLayoutUtil.unitsToSizeInPx(
          12,
          layout.columnWidthInPx,
          layout.gapInPx,
        ),
      ).toBeCloseTo(width, 6);
    }
  });

  test("a widget's box is where its rect sits, as the canvas drew it before", () => {
    const layout: DashboardBoardLayout = view(1000);
    const unit: number = (1000 - 110) / 12;

    const box: DashboardBoardBox = DashboardBoardLayoutUtil.getGridBox(
      rect({ id: "a", left: 3, top: 2, width: 6, height: 3 }),
      layout,
    );

    expect(box.left).toBeCloseTo(3 * (unit + 10), 6);
    expect(box.top).toBeCloseTo(2 * (unit + 10), 6);
    expect(box.width).toBeCloseTo(6 * unit + 50, 6);
    expect(box.height).toBeCloseTo(3 * unit + 20, 6);
  });
});

describe("a narrower board: the grid, its columns narrower and its rows as tall", () => {
  test.each([500, 568, 634, 700, 857, 949])(
    "at %ipx the columns share the width and every row is 70px",
    (width: number) => {
      const layout: DashboardBoardLayout = view(width);

      expect(layout.arrangement).toBe(DashboardBoardArrangement.Grid);
      expect(layout.isWiderThanBoard).toBe(false);
      expect(layout.columnWidthInPx).toBeCloseTo((width - 110) / 12, 6);
      expect(layout.columnWidthInPx).toBeLessThan(70);
      expect(layout.rowHeightInPx).toBe(70);
    },
  );

  test("a chart three rows high keeps the 230px it had on a 1000px board, at 1024 beside the side menu too", () => {
    const chart: GridRect = rect({ id: "c", width: 6, height: 3 });

    for (const width of [568, 700, 857, 949]) {
      expect(
        DashboardBoardLayoutUtil.getGridBox(chart, view(width)).height,
      ).toBe(230);
    }
  });

  test("the grid fills the board's width, never more: nothing scrolls sideways", () => {
    for (const width of [500, 600, 700, 857, 949]) {
      const layout: DashboardBoardLayout = view(width);
      const widest: DashboardBoardBox = DashboardBoardLayoutUtil.getGridBox(
        rect({ id: "w", left: 0, width: 12 }),
        layout,
      );
      const rightmost: DashboardBoardBox = DashboardBoardLayoutUtil.getGridBox(
        rect({ id: "r", left: 9, width: 3 }),
        layout,
      );

      expect(widest.width).toBeCloseTo(width, 6);
      expect(rightmost.left + rightmost.width).toBeCloseTo(width, 6);
    }
  });

  test("rows and the grid's height follow the rows' own height, not the columns'", () => {
    const layout: DashboardBoardLayout = view(600);

    expect(DashboardBoardLayoutUtil.getGridHeightInPx(4, layout)).toBe(
      4 * 70 + 3 * 10,
    );
    expect(
      DashboardBoardLayoutUtil.getGridBox(
        rect({ id: "a", top: 5, height: 2 }),
        layout,
      ).top,
    ).toBe(5 * 80);
  });
});

describe("a phone: the widgets one under another", () => {
  test.each([1, 280, 358, 374, 412, 499])(
    "at %ipx the widgets are stacked, each the board's width",
    (width: number) => {
      const layout: DashboardBoardLayout = view(width);

      expect(layout.arrangement).toBe(DashboardBoardArrangement.Stacked);
      expect(layout.widthInPx).toBe(width);
      expect(layout.columnWidthInPx).toBe(width);
      expect(layout.isWiderThanBoard).toBe(false);
    },
  );

  test("a board not measured yet is laid out as the grid, not stacked", () => {
    for (const width of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const layout: DashboardBoardLayout = view(width);

      expect(layout.arrangement).toBe(DashboardBoardArrangement.Grid);
      expect(layout.isWiderThanBoard).toBe(false);
      expect(layout.columnWidthInPx).toBe(1);
      expect(layout.rowHeightInPx).toBe(70);
    }
  });

  test("the widgets come in the order the grid is read: by row, then left to right", () => {
    const rects: Array<GridRect> = [
      rect({ id: "chart-right", left: 6, top: 1, width: 6, height: 3 }),
      rect({ id: "title", left: 0, top: 0, width: 12, height: 1 }),
      rect({ id: "chart-left", left: 0, top: 1, width: 6, height: 3 }),
      rect({ id: "table", left: 0, top: 4, width: 12, height: 4 }),
    ];

    expect(ids(DashboardBoardLayoutUtil.getStackedOrder(rects))).toEqual([
      "title",
      "chart-left",
      "chart-right",
      "table",
    ]);
  });

  test("a tall widget beside a column of short ones comes first, then the column top to bottom", () => {
    const rects: Array<GridRect> = [
      rect({ id: "value-2", left: 3, top: 1, width: 3, height: 1 }),
      rect({ id: "value-1", left: 3, top: 0, width: 3, height: 1 }),
      rect({ id: "gauge", left: 0, top: 0, width: 3, height: 3 }),
      rect({ id: "value-3", left: 3, top: 2, width: 3, height: 1 }),
    ];

    expect(ids(DashboardBoardLayoutUtil.getStackedOrder(rects))).toEqual([
      "gauge",
      "value-1",
      "value-2",
      "value-3",
    ]);
  });

  test("widgets at the same place keep the order the dashboard lists them in, and a broken place goes last", () => {
    const rects: Array<GridRect> = [
      rect({ id: "second", left: 2, top: 1 }),
      rect({ id: "broken", left: Number.NaN, top: Number.NaN }),
      rect({ id: "first", left: 2, top: 1 }),
      rect({ id: "top", left: 11, top: 0 }),
    ];

    expect(ids(DashboardBoardLayoutUtil.getStackedOrder(rects))).toEqual([
      "top",
      "second",
      "first",
      "broken",
    ]);
  });

  test("the order is a new list of the same rects, and the dashboard's own list is left as it was", () => {
    const rects: Array<GridRect> = [
      rect({ id: "b", top: 1 }),
      rect({ id: "a", top: 0 }),
    ];
    const frozen: Array<GridRect> = Object.freeze([
      ...rects,
    ]) as Array<GridRect>;

    const order: Array<GridRect> =
      DashboardBoardLayoutUtil.getStackedOrder(frozen);

    expect(order).not.toBe(frozen);
    expect(order[0]).toBe(rects[1]);
    expect(order[1]).toBe(rects[0]);
    expect(ids(frozen)).toEqual(["b", "a"]);
  });

  test("a widget is as tall as on the narrowest grid: its rows of 70px and the gaps between them", () => {
    expect(
      DashboardBoardLayoutUtil.getStackedHeightInPx({ heightInUnits: 1 }),
    ).toBe(70);
    expect(
      DashboardBoardLayoutUtil.getStackedHeightInPx({ heightInUnits: 3 }),
    ).toBe(230);
    expect(
      DashboardBoardLayoutUtil.getStackedHeightInPx({
        heightInUnits: 4,
        componentType: DashboardComponentType.MonitorList,
      }),
    ).toBe(310);
    expect(
      DashboardBoardLayoutUtil.getStackedHeightInPx({
        heightInUnits: 3,
        componentType: DashboardComponentType.Gauge,
      }),
    ).toBe(230);
  });

  test("a chart is at least 400px tall, so its plot has room under its title and legend", () => {
    expect(DASHBOARD_STACKED_CHART_MIN_HEIGHT_IN_PX).toBe(400);

    for (const componentType of DASHBOARD_CHART_COMPONENT_TYPES) {
      expect(
        DashboardBoardLayoutUtil.getStackedHeightInPx({
          heightInUnits: 3,
          componentType,
        }),
      ).toBe(400);
      // A taller chart keeps its own height.
      expect(
        DashboardBoardLayoutUtil.getStackedHeightInPx({
          heightInUnits: 6,
          componentType,
        }),
      ).toBe(6 * 70 + 5 * 10);
    }
  });

  test("the charts are the widgets that draw a chart over time, and only those", () => {
    expect([...DASHBOARD_CHART_COMPONENT_TYPES].sort()).toEqual(
      [
        DashboardComponentType.Chart,
        DashboardComponentType.DataSourceChart,
        DashboardComponentType.LogChart,
        DashboardComponentType.TraceChart,
      ].sort(),
    );

    for (const componentType of Object.values(DashboardComponentType)) {
      expect(DashboardBoardLayoutUtil.isChart(componentType)).toBe(
        DASHBOARD_CHART_COMPONENT_TYPES.includes(componentType),
      );
    }

    expect(DashboardBoardLayoutUtil.isChart(undefined)).toBe(false);
    expect(DashboardBoardLayoutUtil.isChart("constructor")).toBe(false);
  });

  test("a height a stored config broke is one row, never nothing or NaN", () => {
    for (const broken of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        DashboardBoardLayoutUtil.getStackedHeightInPx({
          heightInUnits: broken,
        }),
      ).toBe(70);
    }

    expect(
      DashboardBoardLayoutUtil.getStackedHeightInPx({ heightInUnits: 2.4 }),
    ).toBe(150);
  });

  test("the stacked board is every widget's height and a gap between each two", () => {
    expect(DashboardBoardLayoutUtil.getStackedHeightOfBoardInPx([])).toBe(0);
    expect(
      DashboardBoardLayoutUtil.getStackedHeightOfBoardInPx([
        { heightInUnits: 1 },
      ]),
    ).toBe(70);
    expect(
      DashboardBoardLayoutUtil.getStackedHeightOfBoardInPx([
        { heightInUnits: 1, componentType: DashboardComponentType.Text },
        { heightInUnits: 3, componentType: DashboardComponentType.Chart },
        { heightInUnits: 4, componentType: DashboardComponentType.Table },
      ]),
    ).toBe(70 + 400 + 310 + 2 * 10);
  });
});

describe("a Value widget one row high, the size every template's numbers are", () => {
  /*
   * The rows are 70px on every board 500 to 950px wide and on a phone, and a
   * one-row Value widget gave its title up there by half a pixel, so a
   * laptop beside the side menu and every phone showed bare numbers. The
   * value widget's own layout (ValueWidgetLayout) decides; these hold the
   * two together, the box the board hands the widget to what it draws in it.
   */
  function valueOn(box: DashboardBoardBox): ValueWidgetLayout {
    return getValueWidgetLayout({
      widthInPx: box.width,
      heightInPx: box.height,
      hasTitle: true,
      hasTrend: true,
      hasSparklineData: true,
      valueText: "2.67K",
      unitText: "",
    });
  }

  test("keeps its title on the grid at any width", () => {
    const tile: GridRect = rect({ id: "v", width: 3, height: 1 });

    for (let width: number = 500; width <= 1600; width = width + 25) {
      const box: DashboardBoardBox = DashboardBoardLayoutUtil.getGridBox(
        tile,
        view(width),
      );

      expect([width, valueOn(box).showTitle]).toEqual([width, true]);
    }
  });

  test("keeps its title and its trend on a phone, as wide as the board", () => {
    for (let width: number = 280; width < 500; width = width + 10) {
      const layout: DashboardBoardLayout = view(width);
      const value: ValueWidgetLayout = valueOn({
        left: 0,
        top: 0,
        width: layout.widthInPx,
        height: DashboardBoardLayoutUtil.getStackedHeightInPx({
          heightInUnits: 1,
          componentType: DashboardComponentType.Value,
        }),
      });

      expect([width, value.showTitle, value.showStatusRow]).toEqual([
        width,
        true,
        true,
      ]);
    }
  });
});

describe("while editing: the grid at any width", () => {
  test.each([1, 358, 374, 499])(
    "a %ipx board keeps the grid at 500px and scrolls sideways",
    (width: number) => {
      const layout: DashboardBoardLayout = edit(width);

      expect(layout.arrangement).toBe(DashboardBoardArrangement.Grid);
      expect(layout.isWiderThanBoard).toBe(true);
      expect(layout.widthInPx).toBe(500);
      expect(layout.columnWidthInPx).toBeCloseTo((500 - 110) / 12, 6);
      expect(layout.rowHeightInPx).toBe(70);
    },
  );

  test.each([500, 700, 950, 1280])(
    "a %ipx board is edited at its own width, laid out as viewers see it",
    (width: number) => {
      const layout: DashboardBoardLayout = edit(width);

      expect(layout.isWiderThanBoard).toBe(false);
      expect(layout).toEqual(view(width));
    },
  );

  test("a board not measured yet is not said to scroll", () => {
    expect(edit(0).isWiderThanBoard).toBe(false);
    expect(edit(0).arrangement).toBe(DashboardBoardArrangement.Grid);
  });
});

describe("every board the product ships, on a phone", () => {
  /*
   * Every dashboard template, read as the canvas reads it, keeps every
   * widget once stacked - none lost, none twice - and each stacked widget
   * is at least as tall as it is on the narrowest grid.
   */
  for (const templateType of Object.values(DashboardTemplateType)) {
    test(`${templateType}: every widget once, none shorter than on the grid`, () => {
      const config: DashboardViewConfig | null = getTemplateConfig(
        templateType,
      ) as DashboardViewConfig | null;

      if (!config) {
        return;
      }

      const components: Array<DashboardBaseComponent> = config.components;
      const rects: Array<GridRect> =
        GridLayoutUtil.fromDashboardComponents(components);
      const order: Array<GridRect> =
        DashboardBoardLayoutUtil.getStackedOrder(rects);

      expect(order).toHaveLength(rects.length);
      expect(new Set(order).size).toBe(rects.length);

      for (let index: number = 1; index < order.length; index++) {
        const before: GridRect = order[index - 1]!;
        const after: GridRect = order[index]!;

        // Read by row: a later widget never starts above an earlier one.
        expect(after.top).toBeGreaterThanOrEqual(before.top);
      }

      components.forEach((component: DashboardBaseComponent, index: number) => {
        const gridHeight: number = DashboardBoardLayoutUtil.getGridBox(
          rects[index]!,
          view(700),
        ).height;

        expect(
          DashboardBoardLayoutUtil.getStackedHeightInPx({
            heightInUnits: rects[index]!.height,
            componentType: component.componentType,
          }),
        ).toBeGreaterThanOrEqual(gridHeight);
      });
    });
  }
});

describe("random boards", () => {
  test("stacking keeps every widget once, in reading order, for 300 seeded boards", () => {
    const random: SeededRandom = seededRandom(5284);

    for (let round: number = 0; round < 300; round++) {
      const count: number = 1 + random(14);
      const rects: Array<GridRect> = [];

      for (let index: number = 0; index < count; index++) {
        rects.push(
          rect({
            id: `w${index}`,
            left: random(12),
            top: random(20),
            width: 1 + random(6),
            height: 1 + random(5),
          }),
        );
      }

      const order: Array<GridRect> =
        DashboardBoardLayoutUtil.getStackedOrder(rects);

      expect(new Set(ids(order))).toEqual(new Set(ids(rects)));

      for (let index: number = 1; index < order.length; index++) {
        const before: GridRect = order[index - 1]!;
        const after: GridRect = order[index]!;

        expect(
          after.top > before.top ||
            (after.top === before.top && after.left >= before.left),
        ).toBe(true);
      }
    }
  });
});

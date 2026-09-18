import {
  getValueContentBox,
  getValueWidgetLayout,
  getValueWidthInFontUnits,
  MAX_VALUE_FONT_SIZE_IN_PX,
  MIN_VALUE_FONT_SIZE_IN_PX,
  ValueContentBox,
  ValueWidgetLayout,
  ValueWidgetStackMode,
  VALUE_LINE_HEIGHT_RATIO,
  VALUE_UNIT_FONT_SCALE,
} from "../../../Utils/Dashboard/ValueWidgetLayout";

/*
 * The chrome DashboardBaseComponent puts around every widget: a 1px card
 * border plus 12px of padding (28px at the top while editing, for the drag
 * handle it overlays). The canvas hands the widget its OUTER tile size, so the
 * sizer has to subtract this before doing anything else.
 *
 * Re-declared here on purpose rather than imported. If someone drops the
 * subtraction from the sizer, these tests have to FAIL — importing the
 * constants would let the goalposts move along with the code.
 */
const CHROME_HORIZONTAL_IN_PX: number = 26;
const CHROME_VERTICAL_IN_PX: number = 26;
const CHROME_VERTICAL_EDIT_MODE_IN_PX: number = 42;

/** Breathing room the sizer keeps inside the content box. */
const HORIZONTAL_PADDING_IN_PX: number = 8;

/** Float slack, so exact-fit cases are not lost to binary rounding. */
const EPSILON: number = 0.001;

interface LayoutInput {
  widthInPx: number;
  heightInPx: number;
  isEditMode?: boolean | undefined;
  hasTitle: boolean;
  hasTrend: boolean;
  hasSparklineData: boolean;
  valueText: string;
  unitText: string;
}

type MakeInputFunction = (overrides?: Partial<LayoutInput>) => LayoutInput;

const makeInput: MakeInputFunction = (
  overrides?: Partial<LayoutInput>,
): LayoutInput => {
  return {
    widthInPx: 340,
    heightInPx: 200,
    hasTitle: true,
    hasTrend: true,
    hasSparklineData: true,
    valueText: "23.5",
    unitText: "°C",
    ...overrides,
  };
};

/**
 * The height the widget actually occupies — the same stack the renderer
 * builds, summed from the row heights the sizer RETURNED. Recomputing it this
 * way (rather than restating the sizer's own arithmetic) is what makes the fit
 * assertion meaningful: it checks the contract with the renderer, not the
 * sizer's internal consistency with itself.
 */
type RenderedStackHeightFunction = (layout: ValueWidgetLayout) => number;

const renderedStackHeightInPx: RenderedStackHeightFunction = (
  layout: ValueWidgetLayout,
): number => {
  if (layout.stackMode === ValueWidgetStackMode.Compact) {
    return layout.headerRowHeightInPx + layout.valueRowHeightInPx;
  }

  return (
    (layout.showTitle ? layout.titleRowHeightInPx : 0) +
    layout.valueRowHeightInPx +
    (layout.showStatusRow ? layout.statusRowHeightInPx : 0) +
    (layout.showSparkline ? layout.sparklineRowHeightInPx : 0)
  );
};

/**
 * The px dimensions the canvas hands a widget of `w` x `h` dashboard units on
 * a dashboard `totalWidthInPx` wide. Mirrors Canvas/Index.tsx: rows use the
 * grid's absolute `gridAutoRows` unit, columns are `1fr` inside the canvas
 * inset, and both add the 10px gap for every unit after the first.
 */
type TilePxFunction = (
  widthInUnits: number,
  heightInUnits: number,
  totalWidthInPx: number,
) => { widthInPx: number; heightInPx: number };

const tilePx: TilePxFunction = (
  widthInUnits: number,
  heightInUnits: number,
  totalWidthInPx: number,
): { widthInPx: number; heightInPx: number } => {
  const gapInPx: number = 10;
  const rowUnitInPx: number = (totalWidthInPx - 110) / 12;
  const columnUnitInPx: number = (totalWidthInPx - 160) / 12;

  return {
    widthInPx: columnUnitInPx * widthInUnits + gapInPx * (widthInUnits - 1),
    heightInPx: rowUnitInPx * heightInUnits + gapInPx * (heightInUnits - 1),
  };
};

/**
 * Every dashboard width worth sweeping. 1000 is the minimum the dashboard view
 * pins; 1310/1320 straddle the old `dashboardComponentHeightInPx > 100`
 * sparkline cliff, where a 40px change in browser width took the value box
 * from 34.9px to 9.2px.
 */
const DASHBOARD_WIDTHS_IN_PX: Array<number> = [
  1000, 1280, 1310, 1320, 1440, 1920, 2560,
];

describe("ValueWidgetLayout", () => {
  describe("getValueContentBox", () => {
    it("subtracts the card border and the widget padding", () => {
      const box: ValueContentBox = getValueContentBox({
        widthInPx: 300,
        heightInPx: 200,
      });

      expect(box.widthInPx).toBe(300 - CHROME_HORIZONTAL_IN_PX);
      expect(box.heightInPx).toBe(200 - CHROME_VERTICAL_IN_PX);
    });

    it("takes the taller edit-mode top padding off the height", () => {
      const box: ValueContentBox = getValueContentBox({
        widthInPx: 300,
        heightInPx: 200,
        isEditMode: true,
      });

      expect(box.widthInPx).toBe(300 - CHROME_HORIZONTAL_IN_PX);
      expect(box.heightInPx).toBe(200 - CHROME_VERTICAL_EDIT_MODE_IN_PX);
    });

    it("floors at zero rather than returning a negative box", () => {
      const box: ValueContentBox = getValueContentBox({
        widthInPx: 10,
        heightInPx: 4,
      });

      expect(box.widthInPx).toBe(0);
      expect(box.heightInPx).toBe(0);
    });
  });

  describe("getValueWidthInFontUnits", () => {
    it("counts the unit at its reduced size, plus its leading space", () => {
      const withoutUnit: number = getValueWidthInFontUnits({
        valueText: "23.5",
        unitText: "",
      });
      const withUnit: number = getValueWidthInFontUnits({
        valueText: "23.5",
        unitText: "°C",
      });

      expect(withUnit).toBeGreaterThan(withoutUnit);
      // 3 characters (" °C") at the unit scale, not the full value scale.
      expect(withUnit - withoutUnit).toBeLessThan(3 * VALUE_UNIT_FONT_SCALE);
    });

    it("grows with the number of characters", () => {
      expect(
        getValueWidthInFontUnits({ valueText: "1", unitText: "" }),
      ).toBeLessThan(
        getValueWidthInFontUnits({ valueText: "123456", unitText: "" }),
      );
    });

    it("is zero for an empty value with no unit", () => {
      expect(getValueWidthInFontUnits({ valueText: "", unitText: "" })).toBe(0);
    });
  });

  describe("the vertical stack always fits the content box", () => {
    /*
     * The regression test for the reported bug. At the shipped 3x1 default the
     * old widget needed 115px of content inside an 84.8px box, and because the
     * value div was the only shrinkable flex item (Tailwind's `truncate` sets
     * overflow:hidden, which zeroes a flex item's automatic minimum size) the
     * entire 30px deficit landed on the big number — 44.6px of line box
     * squeezed into 14.6px, or 0px in edit mode.
     */
    it("holds for every grid size, edit state and row combination", () => {
      let casesChecked: number = 0;

      for (const totalWidthInPx of DASHBOARD_WIDTHS_IN_PX) {
        for (let widthInUnits: number = 1; widthInUnits <= 12; widthInUnits++) {
          for (
            let heightInUnits: number = 1;
            heightInUnits <= 4;
            heightInUnits++
          ) {
            for (const isEditMode of [false, true]) {
              for (const hasTitle of [false, true]) {
                for (const hasTrend of [false, true]) {
                  for (const hasSparklineData of [false, true]) {
                    const tile: { widthInPx: number; heightInPx: number } =
                      tilePx(widthInUnits, heightInUnits, totalWidthInPx);

                    const layout: ValueWidgetLayout = getValueWidgetLayout({
                      widthInPx: tile.widthInPx,
                      heightInPx: tile.heightInPx,
                      isEditMode: isEditMode,
                      hasTitle: hasTitle,
                      hasTrend: hasTrend,
                      hasSparklineData: hasSparklineData,
                      valueText: "23.5",
                      unitText: "°C",
                    });

                    expect(renderedStackHeightInPx(layout)).toBeLessThanOrEqual(
                      layout.contentHeightInPx + EPSILON,
                    );

                    casesChecked = casesChecked + 1;
                  }
                }
              }
            }
          }
        }
      }

      // Guard against the loops being silently gutted by a future edit.
      expect(casesChecked).toBe(
        DASHBOARD_WIDTHS_IN_PX.length * 12 * 4 * 2 * 2 * 2 * 2,
      );
    });

    it("holds for long formatted values and long unit symbols", () => {
      const valueTexts: Array<string> = [
        "0",
        "23.5",
        "100",
        "1.23K",
        "119.25B",
        "-1234.56",
        "0.000012",
      ];
      const unitTexts: Array<string> = ["", "%", "°C", "µs", "MB/s", "ug/m3"];

      for (const totalWidthInPx of DASHBOARD_WIDTHS_IN_PX) {
        for (const valueText of valueTexts) {
          for (const unitText of unitTexts) {
            for (const heightInUnits of [1, 2, 3]) {
              const tile: { widthInPx: number; heightInPx: number } = tilePx(
                3,
                heightInUnits,
                totalWidthInPx,
              );

              const layout: ValueWidgetLayout = getValueWidgetLayout({
                widthInPx: tile.widthInPx,
                heightInPx: tile.heightInPx,
                hasTitle: true,
                hasTrend: true,
                hasSparklineData: true,
                valueText: valueText,
                unitText: unitText,
              });

              expect(renderedStackHeightInPx(layout)).toBeLessThanOrEqual(
                layout.contentHeightInPx + EPSILON,
              );
            }
          }
        }
      }
    });
  });

  describe("the value line always fits the content width", () => {
    /*
     * The horizontal half of the bug: the old font size derived from the tile
     * HEIGHT alone, so a narrow, tall widget could never be made to fit —
     * growing it grew the font just as fast as it grew the room. A 1x4 tile
     * rendered a 374px-wide line inside an 81px box, sliced 147px off EACH
     * side with no ellipsis.
     */
    it("holds across the whole grid sweep", () => {
      for (const totalWidthInPx of DASHBOARD_WIDTHS_IN_PX) {
        for (let widthInUnits: number = 1; widthInUnits <= 12; widthInUnits++) {
          for (
            let heightInUnits: number = 1;
            heightInUnits <= 4;
            heightInUnits++
          ) {
            for (const isEditMode of [false, true]) {
              const tile: { widthInPx: number; heightInPx: number } = tilePx(
                widthInUnits,
                heightInUnits,
                totalWidthInPx,
              );

              const layout: ValueWidgetLayout = getValueWidgetLayout({
                widthInPx: tile.widthInPx,
                heightInPx: tile.heightInPx,
                isEditMode: isEditMode,
                hasTitle: true,
                hasTrend: true,
                hasSparklineData: true,
                valueText: "23.5",
                unitText: "°C",
              });

              if (layout.valueFontSizeInPx <= MIN_VALUE_FONT_SIZE_IN_PX) {
                /*
                 * Legibility wins over fitting at the floor; the renderer
                 * truncates with an ellipsis and puts the full string on the
                 * element's `title` instead.
                 */
                continue;
              }

              const renderedWidthInPx: number =
                layout.valueFontSizeInPx *
                getValueWidthInFontUnits({
                  valueText: "23.5",
                  unitText: layout.showUnit ? "°C" : "",
                });

              expect(renderedWidthInPx).toBeLessThanOrEqual(
                layout.contentWidthInPx - HORIZONTAL_PADDING_IN_PX + EPSILON,
              );
            }
          }
        }
      }
    });

    it("shrinks the number on a narrow widget instead of overflowing it", () => {
      const narrow: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({ widthInPx: 100, heightInPx: 400 }),
      );
      const wide: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({ widthInPx: 600, heightInPx: 400 }),
      );

      expect(narrow.valueFontSizeInPx).toBeLessThan(wide.valueFontSizeInPx);
    });

    it("shrinks the number as the formatted value gets longer", () => {
      const short: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({ valueText: "7", widthInPx: 240 }),
      );
      const long: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({ valueText: "-1234567.89", widthInPx: 240 }),
      );

      expect(long.valueFontSizeInPx).toBeLessThan(short.valueFontSizeInPx);
    });
  });

  describe("the sparkline gate is continuous", () => {
    /*
     * The old gate was `dashboardComponentHeightInPx > 100`, which tested the
     * OUTER tile height and then added a row to a box 26-42px smaller than the
     * number it had just tested. Admitting the sparkline is now conditioned on
     * the value font ALREADY being at its ceiling, so crossing the gate cannot
     * shrink the number.
     */
    it("never shrinks the number as the widget gets taller, above the title gate", () => {
      let previousFontSizeInPx: number = -1;
      let previousShowSparkline: boolean = false;
      let sawGateCrossing: boolean = false;

      for (
        let contentHeightInPx: number = 100;
        contentHeightInPx <= 600;
        contentHeightInPx = contentHeightInPx + 0.5
      ) {
        const layout: ValueWidgetLayout = getValueWidgetLayout(
          makeInput({
            widthInPx: 340 + CHROME_HORIZONTAL_IN_PX,
            heightInPx: contentHeightInPx + CHROME_VERTICAL_IN_PX,
          }),
        );

        if (previousFontSizeInPx >= 0) {
          expect(layout.valueFontSizeInPx).toBeGreaterThanOrEqual(
            previousFontSizeInPx - EPSILON,
          );
        }
        if (layout.showSparkline && !previousShowSparkline) {
          sawGateCrossing = true;
          // The font is already pinned at its ceiling on both sides.
          expect(layout.valueFontSizeInPx).toBe(MAX_VALUE_FONT_SIZE_IN_PX);
          expect(previousFontSizeInPx).toBe(MAX_VALUE_FONT_SIZE_IN_PX);
        }

        previousFontSizeInPx = layout.valueFontSizeInPx;
        previousShowSparkline = layout.showSparkline;
      }

      expect(sawGateCrossing).toBe(true);
    });

    it("never turns the sparkline back off as the widget grows", () => {
      let previousShowSparkline: boolean = false;

      for (
        let contentHeightInPx: number = 0;
        contentHeightInPx <= 600;
        contentHeightInPx = contentHeightInPx + 1
      ) {
        const layout: ValueWidgetLayout = getValueWidgetLayout(
          makeInput({
            widthInPx: 340 + CHROME_HORIZONTAL_IN_PX,
            heightInPx: contentHeightInPx + CHROME_VERTICAL_IN_PX,
          }),
        );

        if (previousShowSparkline) {
          expect(layout.showSparkline).toBe(true);
        }
        previousShowSparkline = layout.showSparkline;
      }
    });
  });

  describe("the compact/column switch is continuous", () => {
    it("hands over at the same font size on both sides", () => {
      let previousLayout: ValueWidgetLayout | null = null;
      let sawSwitch: boolean = false;

      for (
        let contentHeightInPx: number = 100;
        contentHeightInPx <= 400;
        contentHeightInPx = contentHeightInPx + 0.5
      ) {
        const layout: ValueWidgetLayout = getValueWidgetLayout(
          makeInput({
            widthInPx: 340 + CHROME_HORIZONTAL_IN_PX,
            heightInPx: contentHeightInPx + CHROME_VERTICAL_IN_PX,
          }),
        );

        if (
          previousLayout &&
          previousLayout.stackMode === ValueWidgetStackMode.Compact &&
          layout.stackMode === ValueWidgetStackMode.Column
        ) {
          sawSwitch = true;
          expect(layout.valueFontSizeInPx).toBe(
            previousLayout.valueFontSizeInPx,
          );
        }

        previousLayout = layout;
      }

      expect(sawSwitch).toBe(true);
    });

    it("never falls back to the compact header as the widget grows", () => {
      let sawColumn: boolean = false;

      for (
        let contentHeightInPx: number = 0;
        contentHeightInPx <= 500;
        contentHeightInPx = contentHeightInPx + 1
      ) {
        const layout: ValueWidgetLayout = getValueWidgetLayout(
          makeInput({
            widthInPx: 340 + CHROME_HORIZONTAL_IN_PX,
            heightInPx: contentHeightInPx + CHROME_VERTICAL_IN_PX,
          }),
        );

        if (sawColumn) {
          expect(layout.stackMode).toBe(ValueWidgetStackMode.Column);
        }
        if (layout.stackMode === ValueWidgetStackMode.Column) {
          sawColumn = true;
        }
      }
    });

    it("stacks rather than sharing a line on a widget too narrow for both", () => {
      const layout: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({ widthInPx: 120, heightInPx: 140 }),
      );

      expect(layout.stackMode).toBe(ValueWidgetStackMode.Column);
    });

    it("uses the compact header on the shipped 3x1 default", () => {
      /*
       * 3x1 is both the default size and what all of the dashboard templates
       * produce, so it is the size that has to look right.
       */
      const tile: { widthInPx: number; heightInPx: number } = tilePx(
        3,
        1,
        1440,
      );
      const layout: ValueWidgetLayout = getValueWidgetLayout({
        widthInPx: tile.widthInPx,
        heightInPx: tile.heightInPx,
        hasTitle: true,
        hasTrend: true,
        hasSparklineData: true,
        valueText: "23.5",
        unitText: "°C",
      });

      expect(layout.stackMode).toBe(ValueWidgetStackMode.Compact);
      expect(layout.showTitle).toBe(true);
      expect(layout.showStatusRow).toBe(true);
      expect(layout.showSparkline).toBe(false);
      // Comfortably readable, where the old widget painted ~23% of the digits.
      expect(layout.valueFontSizeInPx).toBeGreaterThan(45);
    });
  });

  describe("the degradation ladder", () => {
    it("drops the sparkline, then the trend, then the title as the widget shrinks", () => {
      const tall: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({ heightInPx: 400 }),
      );
      const medium: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({ heightInPx: 150, widthInPx: 120 }),
      );
      const short: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({ heightInPx: 90, widthInPx: 120 }),
      );
      const tiny: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({ heightInPx: 60, widthInPx: 120 }),
      );

      expect(tall.showSparkline).toBe(true);

      expect(medium.showSparkline).toBe(false);
      expect(medium.showStatusRow).toBe(true);
      expect(medium.showTitle).toBe(true);

      expect(short.showStatusRow).toBe(false);
      expect(short.showTitle).toBe(true);

      expect(tiny.showTitle).toBe(false);
      expect(tiny.showStatusRow).toBe(false);
      expect(tiny.showSparkline).toBe(false);
    });

    it("never turns a row back on as the widget grows", () => {
      let previous: ValueWidgetLayout | null = null;

      for (
        let contentHeightInPx: number = 0;
        contentHeightInPx <= 600;
        contentHeightInPx = contentHeightInPx + 1
      ) {
        const layout: ValueWidgetLayout = getValueWidgetLayout(
          makeInput({
            widthInPx: 340 + CHROME_HORIZONTAL_IN_PX,
            heightInPx: contentHeightInPx + CHROME_VERTICAL_IN_PX,
          }),
        );

        if (previous) {
          if (previous.showTitle) {
            expect(layout.showTitle).toBe(true);
          }
          if (previous.showStatusRow) {
            expect(layout.showStatusRow).toBe(true);
          }
          if (previous.showSparkline) {
            expect(layout.showSparkline).toBe(true);
          }
        }

        previous = layout;
      }
    });

    it("never reserves a title row for a widget with no title", () => {
      const untitled: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({ hasTitle: false, hasSparklineData: false }),
      );
      const titled: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({ hasTitle: true, hasSparklineData: false }),
      );

      expect(untitled.showTitle).toBe(false);
      /*
       * The old renderer drew `title || " "`, permanently burning a row on an
       * untitled widget. That height goes to the number now.
       */
      expect(untitled.valueRowHeightInPx).toBeGreaterThan(
        titled.valueRowHeightInPx,
      );
    });

    it("spends the height an absent title frees on the sparkline when there is room", () => {
      /*
       * Not a contradiction of the test above: freed height goes to the number
       * only until the sparkline gate can afford a chart, at which point the
       * widget shows more data instead of a bigger number. The number is
       * already at its ceiling by then, which is what the gate guarantees.
       */
      const untitled: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({ hasTitle: false, heightInPx: 200 }),
      );
      const titled: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({ hasTitle: true, heightInPx: 200 }),
      );

      expect(titled.showSparkline).toBe(false);
      expect(untitled.showSparkline).toBe(true);
      expect(untitled.valueFontSizeInPx).toBe(titled.valueFontSizeInPx);
    });

    it("only steps the font size once, at the title gate", () => {
      /*
       * A discrete row appearing has to take its height from somewhere, so
       * perfect continuity would mean never showing a title on a short widget.
       * The step is deliberate and bounded — the number never goes below the
       * legibility floor and is never clipped. This pins it to ONE step so a
       * future edit cannot quietly add more.
       */
      const decreases: Array<number> = [];
      let previousFontSizeInPx: number = -1;

      for (
        let contentHeightInPx: number = 0;
        contentHeightInPx <= 600;
        contentHeightInPx = contentHeightInPx + 0.5
      ) {
        const layout: ValueWidgetLayout = getValueWidgetLayout(
          makeInput({
            widthInPx: 340 + CHROME_HORIZONTAL_IN_PX,
            heightInPx: contentHeightInPx + CHROME_VERTICAL_IN_PX,
          }),
        );

        if (
          previousFontSizeInPx >= 0 &&
          layout.valueFontSizeInPx < previousFontSizeInPx - EPSILON
        ) {
          decreases.push(contentHeightInPx);
        }
        previousFontSizeInPx = layout.valueFontSizeInPx;
      }

      expect(decreases).toHaveLength(1);
      expect(decreases[0]).toBeGreaterThan(40);
      expect(decreases[0]).toBeLessThan(50);
    });
  });

  describe("the status slot is hover-proof", () => {
    /*
     * The trend arrow and the hovered point's timestamp share one slot. Its
     * height is reserved from whether the widget COULD show either, never from
     * whether it currently is — otherwise scrubbing the sparkline on a widget
     * with no trend would add a row mid-hover and resize the number under the
     * cursor.
     */
    it("reserves the slot whenever the sparkline can be hovered", () => {
      const layout: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({ hasTrend: false, hasSparklineData: true, heightInPx: 400 }),
      );

      expect(layout.showSparkline).toBe(true);
      expect(layout.showStatusRow).toBe(true);
    });

    it("returns an identical layout with and without a trend when the sparkline is shown", () => {
      const withTrend: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({ hasTrend: true, hasSparklineData: true, heightInPx: 400 }),
      );
      const withoutTrend: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({ hasTrend: false, hasSparklineData: true, heightInPx: 400 }),
      );

      expect(withoutTrend).toEqual(withTrend);
    });

    it("reclaims the slot when neither a trend nor a sparkline can occupy it", () => {
      const reserved: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({
          hasTrend: true,
          hasSparklineData: false,
          heightInPx: 150,
          widthInPx: 120,
        }),
      );
      const reclaimed: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({
          hasTrend: false,
          hasSparklineData: true,
          heightInPx: 150,
          widthInPx: 120,
        }),
      );

      expect(reserved.showStatusRow).toBe(true);
      expect(reclaimed.showSparkline).toBe(false);
      expect(reclaimed.showStatusRow).toBe(false);
      /*
       * The reclaimed height lands on the value row. On this deliberately
       * narrow widget the font itself is width-bound, so the row is where the
       * effect is visible.
       */
      expect(reclaimed.valueRowHeightInPx).toBeGreaterThan(
        reserved.valueRowHeightInPx,
      );
    });

    it("gives the reclaimed row back to the number in a stacked layout", () => {
      /*
       * No title, so the status row is a row of its own rather than sharing
       * the compact header — reclaiming it frees real height. (With a title
       * present on a short widget the two share one line, so reclaiming the
       * status frees nothing, which is why this case sets hasTitle false.)
       */
      const reserved: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({
          hasTitle: false,
          hasTrend: true,
          hasSparklineData: false,
          heightInPx: 150,
          widthInPx: 600,
        }),
      );
      const reclaimed: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({
          hasTitle: false,
          hasTrend: false,
          hasSparklineData: true,
          heightInPx: 150,
          widthInPx: 600,
        }),
      );

      expect(reserved.showStatusRow).toBe(true);
      expect(reclaimed.showStatusRow).toBe(false);
      expect(reclaimed.valueRowHeightInPx).toBeGreaterThan(
        reserved.valueRowHeightInPx,
      );
      expect(reclaimed.valueFontSizeInPx).toBeGreaterThan(
        reserved.valueFontSizeInPx,
      );
    });

    it("hides the status row when there is neither a trend nor sparkline data", () => {
      const layout: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({ hasTrend: false, hasSparklineData: false }),
      );

      expect(layout.showStatusRow).toBe(false);
      expect(layout.showSparkline).toBe(false);
    });
  });

  describe("the unit suffix", () => {
    it("is dropped before the digits become illegible on a narrow widget", () => {
      const layout: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({
          widthInPx: 60,
          heightInPx: 200,
          valueText: "23.5",
          unitText: "°C",
        }),
      );

      expect(layout.showUnit).toBe(false);
      expect(layout.valueFontSizeInPx).toBeGreaterThanOrEqual(
        MIN_VALUE_FONT_SIZE_IN_PX,
      );
    });

    it("is kept when HEIGHT is the binding constraint, since dropping it recovers nothing", () => {
      const layout: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({ widthInPx: 800, heightInPx: 60 }),
      );

      expect(layout.showUnit).toBe(true);
    });

    it("is never shown when there is no unit", () => {
      const layout: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({ unitText: "" }),
      );

      expect(layout.showUnit).toBe(false);
    });

    it("scales with the value font", () => {
      const layout: ValueWidgetLayout = getValueWidgetLayout(makeInput());

      expect(layout.unitFontSizeInPx).toBeCloseTo(
        layout.valueFontSizeInPx * VALUE_UNIT_FONT_SCALE,
        6,
      );
      expect(layout.unitFontSizeInPx).toBeLessThan(layout.valueFontSizeInPx);
    });
  });

  describe("font size bounds", () => {
    it("clamps to the ceiling on a huge widget", () => {
      const layout: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({ widthInPx: 4000, heightInPx: 4000 }),
      );

      expect(layout.valueFontSizeInPx).toBe(MAX_VALUE_FONT_SIZE_IN_PX);
    });

    it("never returns anything below the legibility floor", () => {
      for (const widthInPx of [0, 10, 30, 60, 120]) {
        for (const heightInPx of [0, 10, 30, 60, 120]) {
          const layout: ValueWidgetLayout = getValueWidgetLayout(
            makeInput({ widthInPx: widthInPx, heightInPx: heightInPx }),
          );

          expect(layout.valueFontSizeInPx).toBeGreaterThanOrEqual(
            MIN_VALUE_FONT_SIZE_IN_PX,
          );
        }
      }
    });

    it("keeps the value row a whole number of line boxes at the ceiling", () => {
      const layout: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({ widthInPx: 4000, heightInPx: 4000 }),
      );

      expect(
        layout.valueFontSizeInPx * VALUE_LINE_HEIGHT_RATIO,
      ).toBeLessThanOrEqual(layout.valueRowHeightInPx + EPSILON);
    });
  });

  describe("edit mode", () => {
    it("never shows more than view mode does, and never overflows", () => {
      for (const totalWidthInPx of DASHBOARD_WIDTHS_IN_PX) {
        for (const heightInUnits of [1, 2, 3, 4]) {
          const tile: { widthInPx: number; heightInPx: number } = tilePx(
            3,
            heightInUnits,
            totalWidthInPx,
          );

          const viewing: ValueWidgetLayout = getValueWidgetLayout({
            widthInPx: tile.widthInPx,
            heightInPx: tile.heightInPx,
            isEditMode: false,
            hasTitle: true,
            hasTrend: true,
            hasSparklineData: true,
            valueText: "23.5",
            unitText: "°C",
          });
          const editing: ValueWidgetLayout = getValueWidgetLayout({
            widthInPx: tile.widthInPx,
            heightInPx: tile.heightInPx,
            isEditMode: true,
            hasTitle: true,
            hasTrend: true,
            hasSparklineData: true,
            valueText: "23.5",
            unitText: "°C",
          });

          expect(editing.contentHeightInPx).toBeLessThan(
            viewing.contentHeightInPx,
          );
          expect(renderedStackHeightInPx(editing)).toBeLessThanOrEqual(
            editing.contentHeightInPx + EPSILON,
          );

          if (viewing.showTitle === editing.showTitle) {
            /*
             * With the same rows on screen the smaller edit-mode box can only
             * shrink the number. It can legitimately GROW it when the drag
             * handle's extra 16px pushes the title below its gate — a widget
             * that can no longer afford a header spends that height on the
             * number instead of clipping it.
             */
            expect(editing.valueFontSizeInPx).toBeLessThanOrEqual(
              viewing.valueFontSizeInPx + EPSILON,
            );
          }
        }
      }
    });

    it("still shows the number on the default 3x1 widget while editing", () => {
      /*
       * This is the case that was completely invisible before: flexbox dumped
       * the whole 46px deficit onto the value div and clipped it to 0px.
       */
      const tile: { widthInPx: number; heightInPx: number } = tilePx(
        3,
        1,
        1440,
      );
      const layout: ValueWidgetLayout = getValueWidgetLayout({
        widthInPx: tile.widthInPx,
        heightInPx: tile.heightInPx,
        isEditMode: true,
        hasTitle: true,
        hasTrend: true,
        hasSparklineData: true,
        valueText: "23.5",
        unitText: "°C",
      });

      expect(layout.valueRowHeightInPx).toBeGreaterThan(30);
      expect(layout.valueFontSizeInPx).toBeGreaterThan(30);
    });
  });

  describe("degenerate first-paint sizes", () => {
    /*
     * The dashboard's total width seeds to 0 before the first measurement, so
     * a widget's very first render really does get a negative tile size.
     */
    it("returns finite, non-negative values for a zero-sized widget", () => {
      const layout: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({ widthInPx: 0, heightInPx: 0 }),
      );

      expect(Number.isFinite(layout.valueFontSizeInPx)).toBe(true);
      expect(layout.contentWidthInPx).toBe(0);
      expect(layout.contentHeightInPx).toBe(0);
      expect(layout.valueRowHeightInPx).toBe(0);
      expect(layout.sparklineWidthInPx).toBe(0);
      expect(layout.showTitle).toBe(false);
      expect(layout.showStatusRow).toBe(false);
      expect(layout.showSparkline).toBe(false);
    });

    it("returns finite, non-negative values for a negative-sized widget", () => {
      const layout: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({ widthInPx: -110, heightInPx: -110 }),
      );

      for (const measurement of [
        layout.contentWidthInPx,
        layout.contentHeightInPx,
        layout.valueFontSizeInPx,
        layout.unitFontSizeInPx,
        layout.titleFontSizeInPx,
        layout.statusFontSizeInPx,
        layout.valueRowHeightInPx,
        layout.sparklineWidthInPx,
        layout.sparklineHeightInPx,
      ]) {
        expect(Number.isFinite(measurement)).toBe(true);
        expect(measurement).toBeGreaterThanOrEqual(0);
      }
    });

    it("handles an empty value string", () => {
      const layout: ValueWidgetLayout = getValueWidgetLayout(
        makeInput({ valueText: "", unitText: "" }),
      );

      expect(Number.isFinite(layout.valueFontSizeInPx)).toBe(true);
      expect(layout.valueFontSizeInPx).toBe(MAX_VALUE_FONT_SIZE_IN_PX);
    });
  });

  describe("the sparkline never overflows the widget", () => {
    it("stays inside the content width at every grid size", () => {
      for (const totalWidthInPx of DASHBOARD_WIDTHS_IN_PX) {
        for (let widthInUnits: number = 1; widthInUnits <= 12; widthInUnits++) {
          const tile: { widthInPx: number; heightInPx: number } = tilePx(
            widthInUnits,
            3,
            totalWidthInPx,
          );

          const layout: ValueWidgetLayout = getValueWidgetLayout({
            widthInPx: tile.widthInPx,
            heightInPx: tile.heightInPx,
            hasTitle: true,
            hasTrend: true,
            hasSparklineData: true,
            valueText: "23.5",
            unitText: "°C",
          });

          expect(layout.sparklineWidthInPx).toBeLessThanOrEqual(
            layout.contentWidthInPx + EPSILON,
          );
          expect(layout.sparklineHeightInPx).toBeLessThanOrEqual(
            layout.sparklineRowHeightInPx,
          );
        }
      }
    });
  });
});

/*
 * Everything the dashboard Value widget needs in order to decide how big to
 * draw itself, derived by arithmetic from the tile size the canvas reports.
 *
 * It lives here rather than in the renderer for the same reason
 * ClockWidgetFormat.ts does: none of it needs a DOM, so it is unit-testable,
 * and the renderer stays a straight translation of these numbers into inline
 * styles. Measuring the rendered text instead would cost a second render on
 * every resize frame — the exact re-measure flicker DashboardBaseComponent's
 * constant edit-mode padding exists to avoid.
 *
 * The contract with the renderer is that EVERY optional row is drawn at the
 * pixel height returned here, with `shrink-0`, so the stack sums to the
 * content box by construction. Before this existed the value row was the only
 * shrinkable flex item (Tailwind's `truncate` sets overflow:hidden, which
 * zeroes a flex item's automatic minimum size), so the whole vertical deficit
 * landed on the big number and its glyphs were sliced in half — or, in edit
 * mode at the default 3x1 tile, clipped away entirely.
 */

/**
 * Padding the widget chrome puts between the tile edge and the widget's own
 * content box. DashboardBaseComponent draws every widget in a card with a 1px
 * `border` and wraps the child in `padding: 12px`, widened to
 * `28px 12px 12px 12px` in edit mode for the drag handle it overlays.
 *
 * The canvas hands each widget its OUTER tile size, so a sizer that skips this
 * overstates the box by 26px (42px while editing). On the shipped 3x1 default
 * that is around a third of the usable height, which is most of the reason the
 * big number ended up sliced.
 *
 * ClockWidgetFormat.ts uses 24/24/40 for the same three constants — it is
 * missing the card's 1px border. That is a separate (much smaller) bug; the
 * clock keeps 4px of its own vertical breathing room which absorbs it, and
 * correcting it there would churn 300 lines of unrelated tests.
 */
const VALUE_CHROME_HORIZONTAL_IN_PX: number = 26;
const VALUE_CHROME_VERTICAL_IN_PX: number = 26;
const VALUE_CHROME_VERTICAL_EDIT_MODE_IN_PX: number = 42;

/** Breathing room kept inside the content box so text never sits flush. */
const VALUE_HORIZONTAL_PADDING_IN_PX: number = 8;

/**
 * line-height on the value row. Inter's content area is 1.21em (typo ascender
 * 0.96875 + descender 0.24121), so the previous 1.15 let glyphs paint outside
 * their own line box and the row's clip shaved them. 1.25 keeps the ink inside
 * the box the budget reserved for it.
 */
export const VALUE_LINE_HEIGHT_RATIO: number = 1.25;

/** The unit suffix is drawn at this fraction of the value font size. */
export const VALUE_UNIT_FONT_SCALE: number = 0.36;

/**
 * Advance width of one character, as a fraction of the font size. The value
 * row is `tabular-nums`, so every digit has the same advance; `.` `,` `-` are
 * narrower than 0.62em and the row also carries `letter-spacing: -0.03em`, so
 * this over-estimates. That is the safe direction: the failure mode is a
 * slightly smaller number rather than a clipped one.
 */
const VALUE_CHAR_WIDTH_RATIO: number = 0.62;
const UNIT_CHAR_WIDTH_RATIO: number = 0.58;

/** Title row: font clamped to this range, at line-height 1.5 plus `mb-0.5`. */
const TITLE_FONT_HEIGHT_FRACTION: number = 0.11;
const MIN_TITLE_FONT_SIZE_IN_PX: number = 11;
const MAX_TITLE_FONT_SIZE_IN_PX: number = 14;
const TITLE_LINE_HEIGHT_RATIO: number = 1.5;
const TITLE_ROW_MARGIN_IN_PX: number = 2;

/** Status row: the trend arrow, or the hovered point's timestamp. */
const MIN_STATUS_FONT_SIZE_IN_PX: number = 10;
const MAX_STATUS_FONT_SIZE_IN_PX: number = 12;
const STATUS_LINE_HEIGHT_RATIO: number = 1.5;
const STATUS_ROW_MARGIN_IN_PX: number = 2;

/** Sparkline row: the chart plus the `mt-1` above it. */
const SPARKLINE_HEIGHT_FRACTION: number = 0.18;
const MIN_SPARKLINE_HEIGHT_IN_PX: number = 16;
const MAX_SPARKLINE_HEIGHT_IN_PX: number = 28;
const SPARKLINE_ROW_MARGIN_IN_PX: number = 4;
const SPARKLINE_WIDTH_FRACTION: number = 0.6;
const MIN_SPARKLINE_WIDTH_IN_PX: number = 32;
const MAX_SPARKLINE_WIDTH_IN_PX: number = 120;

export const MIN_VALUE_FONT_SIZE_IN_PX: number = 14;
export const MAX_VALUE_FONT_SIZE_IN_PX: number = 96;

/**
 * Value-row heights we refuse to drop below in order to show an optional row.
 * A Value widget exists to show one number; a title that shrinks the digits to
 * the legibility floor has taken more than it is worth.
 *
 * Crossing either of these steps the font size — a row that appears has to
 * take its height from somewhere. That step is deliberate and bounded (the
 * number never goes below MIN_VALUE_FONT_SIZE_IN_PX and is never clipped);
 * making it continuous would mean never showing a title on a short tile.
 */
const TITLE_GATE_VALUE_ROW_IN_PX: number = 26;
const STATUS_GATE_VALUE_ROW_IN_PX: number = 40;

/**
 * Below this content width the title and the trend cannot share a line without
 * both truncating to nothing, so the compact header is not offered.
 */
const COMPACT_HEADER_MIN_CONTENT_WIDTH_IN_PX: number = 180;

/** The value row height at which the value font reaches its ceiling. */
const MAX_VALUE_ROW_HEIGHT_IN_PX: number =
  MAX_VALUE_FONT_SIZE_IN_PX * VALUE_LINE_HEIGHT_RATIO;

export enum ValueWidgetStackMode {
  /** Title, value, status and sparkline each on their own row. */
  Column = "Column",
  /** Title and status share one line above the value. */
  Compact = "Compact",
}

export interface ValueContentBox {
  widthInPx: number;
  heightInPx: number;
}

export interface ValueWidgetLayout {
  stackMode: ValueWidgetStackMode;
  contentWidthInPx: number;
  contentHeightInPx: number;
  showTitle: boolean;
  showStatusRow: boolean;
  showSparkline: boolean;
  showUnit: boolean;
  titleFontSizeInPx: number;
  statusFontSizeInPx: number;
  valueFontSizeInPx: number;
  unitFontSizeInPx: number;
  headerRowHeightInPx: number;
  titleRowHeightInPx: number;
  statusRowHeightInPx: number;
  sparklineRowHeightInPx: number;
  valueRowHeightInPx: number;
  sparklineWidthInPx: number;
  sparklineHeightInPx: number;
}

type ClampFunction = (value: number, min: number, max: number) => number;

const clamp: ClampFunction = (
  value: number,
  min: number,
  max: number,
): number => {
  return Math.max(Math.min(value, max), min);
};

/**
 * Turn the OUTER tile size the dashboard canvas reports into the box the
 * widget actually gets to draw in, by subtracting the chrome around it.
 *
 * Edit mode is not cosmetic: the drag handle takes another 16px off the top,
 * so a widget that only just fits while viewing loses its bottom row — or its
 * entire number — the moment the dashboard is edited.
 */
export type GetValueContentBoxFunction = (data: {
  widthInPx: number;
  heightInPx: number;
  isEditMode?: boolean | undefined;
}) => ValueContentBox;

export const getValueContentBox: GetValueContentBoxFunction = (data: {
  widthInPx: number;
  heightInPx: number;
  isEditMode?: boolean | undefined;
}): ValueContentBox => {
  const verticalChrome: number = data.isEditMode
    ? VALUE_CHROME_VERTICAL_EDIT_MODE_IN_PX
    : VALUE_CHROME_VERTICAL_IN_PX;

  return {
    widthInPx: Math.max(data.widthInPx - VALUE_CHROME_HORIZONTAL_IN_PX, 0),
    heightInPx: Math.max(data.heightInPx - verticalChrome, 0),
  };
};

/**
 * How wide the value line reads, in multiples of the value font size — the
 * digits at full size plus the unit symbol at its reduced size. Used to size
 * the number to the tile instead of letting "23.5 °C" spill off a narrow one.
 *
 * The old widget derived its font size from the tile HEIGHT alone, which is
 * why a narrow, tall widget could never be made to fit: growing it grew the
 * font just as fast as it grew the room.
 */
export type GetValueWidthInFontUnitsFunction = (data: {
  valueText: string;
  unitText: string;
}) => number;

export const getValueWidthInFontUnits: GetValueWidthInFontUnitsFunction =
  (data: { valueText: string; unitText: string }): number => {
    // The unit is preceded by a space, drawn at the unit size.
    const unitChars: number =
      data.unitText.length > 0 ? data.unitText.length + 1 : 0;

    return (
      data.valueText.length * VALUE_CHAR_WIDTH_RATIO +
      unitChars * UNIT_CHAR_WIDTH_RATIO * VALUE_UNIT_FONT_SCALE
    );
  };

type GetWidthLimitedFontSizeFunction = (data: {
  widthBudgetInPx: number;
  valueText: string;
  unitText: string;
}) => number;

const getWidthLimitedFontSizeInPx: GetWidthLimitedFontSizeFunction = (data: {
  widthBudgetInPx: number;
  valueText: string;
  unitText: string;
}): number => {
  const widthInFontUnits: number = getValueWidthInFontUnits({
    valueText: data.valueText,
    unitText: data.unitText,
  });

  if (widthInFontUnits <= 0) {
    return MAX_VALUE_FONT_SIZE_IN_PX;
  }

  return data.widthBudgetInPx / widthInFontUnits;
};

/**
 * Solve the whole layout in one forward pass: which optional rows the tile can
 * still afford, how tall each of them is, and how big the number can be on
 * BOTH axes once they have taken their share.
 */
export type GetValueWidgetLayoutFunction = (data: {
  widthInPx: number;
  heightInPx: number;
  isEditMode?: boolean | undefined;
  hasTitle: boolean;
  hasTrend: boolean;
  hasSparklineData: boolean;
  valueText: string;
  unitText: string;
}) => ValueWidgetLayout;

export const getValueWidgetLayout: GetValueWidgetLayoutFunction = (data: {
  widthInPx: number;
  heightInPx: number;
  isEditMode?: boolean | undefined;
  hasTitle: boolean;
  hasTrend: boolean;
  hasSparklineData: boolean;
  valueText: string;
  unitText: string;
}): ValueWidgetLayout => {
  const contentBox: ValueContentBox = getValueContentBox(data);
  const contentHeightInPx: number = contentBox.heightInPx;
  const contentWidthInPx: number = contentBox.widthInPx;

  const titleFontSizeInPx: number = clamp(
    contentHeightInPx * TITLE_FONT_HEIGHT_FRACTION,
    MIN_TITLE_FONT_SIZE_IN_PX,
    MAX_TITLE_FONT_SIZE_IN_PX,
  );
  const titleRowHeightInPx: number =
    titleFontSizeInPx * TITLE_LINE_HEIGHT_RATIO + TITLE_ROW_MARGIN_IN_PX;

  const statusFontSizeInPx: number = clamp(
    contentHeightInPx * TITLE_FONT_HEIGHT_FRACTION,
    MIN_STATUS_FONT_SIZE_IN_PX,
    MAX_STATUS_FONT_SIZE_IN_PX,
  );
  const statusRowHeightInPx: number =
    statusFontSizeInPx * STATUS_LINE_HEIGHT_RATIO + STATUS_ROW_MARGIN_IN_PX;

  const sparklineHeightInPx: number = clamp(
    contentHeightInPx * SPARKLINE_HEIGHT_FRACTION,
    MIN_SPARKLINE_HEIGHT_IN_PX,
    MAX_SPARKLINE_HEIGHT_IN_PX,
  );
  const sparklineRowHeightInPx: number =
    sparklineHeightInPx + SPARKLINE_ROW_MARGIN_IN_PX;

  /*
   * The trend arrow and the hovered point's timestamp share one slot, so a
   * tile that could show either has to reserve it up front. Neither term
   * depends on whether the cursor is on the chart — that is what makes the
   * hover swap provably unable to move anything. The old layout claimed this
   * and did not deliver it: the timestamp was unconstrained and wrapped.
   */
  const hasStatus: boolean = data.hasTrend || data.hasSparklineData;

  /*
   * A short tile stacks title / value / trend and runs out of height; putting
   * the title and the trend on one line hands that height back to the number.
   * The switch sits exactly where the stacked layout stops being able to keep
   * the value at its ceiling, so crossing it cannot change the rendered font
   * size: below it the compact value row is still at least MAX_VALUE_ROW, and
   * above it the stacked value row is at least MAX_VALUE_ROW too.
   */
  const stackedValueRowInPx: number =
    contentHeightInPx -
    (data.hasTitle ? titleRowHeightInPx : 0) -
    (hasStatus ? statusRowHeightInPx : 0);

  const stackMode: ValueWidgetStackMode =
    data.hasTitle &&
    hasStatus &&
    contentWidthInPx >= COMPACT_HEADER_MIN_CONTENT_WIDTH_IN_PX &&
    stackedValueRowInPx < MAX_VALUE_ROW_HEIGHT_IN_PX
      ? ValueWidgetStackMode.Compact
      : ValueWidgetStackMode.Column;

  let showTitle: boolean = false;
  let showStatusRow: boolean = false;
  let showSparkline: boolean = false;

  if (stackMode === ValueWidgetStackMode.Compact) {
    const headerCandidateInPx: number = Math.max(
      titleRowHeightInPx,
      statusRowHeightInPx,
    );
    if (contentHeightInPx - headerCandidateInPx >= TITLE_GATE_VALUE_ROW_IN_PX) {
      showTitle = true;
      showStatusRow = true;
    }
  } else {
    /*
     * Hand the height out in priority order, never spending a pixel we do not
     * have and never letting an optional row take the number below a size
     * worth reading.
     */
    let spentInPx: number = 0;

    if (
      data.hasTitle &&
      contentHeightInPx - spentInPx - titleRowHeightInPx >=
        TITLE_GATE_VALUE_ROW_IN_PX
    ) {
      showTitle = true;
      spentInPx = spentInPx + titleRowHeightInPx;
    }

    if (
      hasStatus &&
      contentHeightInPx - spentInPx - statusRowHeightInPx >=
        STATUS_GATE_VALUE_ROW_IN_PX
    ) {
      showStatusRow = true;
      spentInPx = spentInPx + statusRowHeightInPx;
    }

    /*
     * The sparkline is admitted only once the value font is ALREADY at its
     * ceiling, so switching it on cannot make the number smaller. This
     * replaces a `dashboardComponentHeightInPx > 100` test, which compared the
     * OUTER tile height and then added a row to a box 26-42px smaller than the
     * number it had tested — a 40px change in browser width took the value box
     * from 34.9px to 9.2px, i.e. from a readable number to a dark sliver.
     */
    if (
      data.hasSparklineData &&
      contentHeightInPx - spentInPx - sparklineRowHeightInPx >=
        MAX_VALUE_ROW_HEIGHT_IN_PX
    ) {
      showSparkline = true;
    }
  }

  /*
   * Give the status slot back when neither occupant can appear: no trend, and
   * no sparkline left to hover. Recomputing the reservation from the final
   * flags (rather than decrementing as we go) keeps one source of truth, and
   * because this only ever SHRINKS the reservation it cannot invalidate the
   * sparkline decision, which was taken with the row still reserved. Moving
   * this above the sparkline gate would reintroduce that oscillation.
   */
  if (showStatusRow && !data.hasTrend && !showSparkline) {
    showStatusRow = false;
  }

  const headerRowHeightInPx: number =
    stackMode === ValueWidgetStackMode.Compact
      ? Math.max(
          showTitle ? titleRowHeightInPx : 0,
          showStatusRow ? statusRowHeightInPx : 0,
        )
      : 0;

  const reservedInPx: number =
    stackMode === ValueWidgetStackMode.Compact
      ? headerRowHeightInPx
      : (showTitle ? titleRowHeightInPx : 0) +
        (showStatusRow ? statusRowHeightInPx : 0) +
        (showSparkline ? sparklineRowHeightInPx : 0);

  const valueRowHeightInPx: number = Math.max(
    contentHeightInPx - reservedInPx,
    0,
  );

  const heightLimitedFontInPx: number =
    valueRowHeightInPx / VALUE_LINE_HEIGHT_RATIO;

  const widthBudgetInPx: number = Math.max(
    contentWidthInPx - VALUE_HORIZONTAL_PADDING_IN_PX,
    0,
  );

  /*
   * Try the number with its unit, and drop the unit only when carrying it
   * would force the digits below the legibility floor on WIDTH. Gating on
   * width alone matters: when height is the binding constraint, dropping the
   * unit recovers nothing, so there is no reason to lose the information. The
   * renderer keeps the full string on the element's `title` either way.
   */
  const fontWithUnitInPx: number = getWidthLimitedFontSizeInPx({
    widthBudgetInPx: widthBudgetInPx,
    valueText: data.valueText,
    unitText: data.unitText,
  });

  const showUnit: boolean =
    data.unitText.length > 0 && fontWithUnitInPx >= MIN_VALUE_FONT_SIZE_IN_PX;

  const widthLimitedFontInPx: number = showUnit
    ? fontWithUnitInPx
    : getWidthLimitedFontSizeInPx({
        widthBudgetInPx: widthBudgetInPx,
        valueText: data.valueText,
        unitText: "",
      });

  const valueFontSizeInPx: number = clamp(
    Math.min(heightLimitedFontInPx, widthLimitedFontInPx),
    MIN_VALUE_FONT_SIZE_IN_PX,
    MAX_VALUE_FONT_SIZE_IN_PX,
  );

  return {
    stackMode: stackMode,
    contentWidthInPx: contentWidthInPx,
    contentHeightInPx: contentHeightInPx,
    showTitle: showTitle,
    showStatusRow: showStatusRow,
    showSparkline: showSparkline,
    showUnit: showUnit,
    titleFontSizeInPx: titleFontSizeInPx,
    statusFontSizeInPx: statusFontSizeInPx,
    valueFontSizeInPx: valueFontSizeInPx,
    unitFontSizeInPx: valueFontSizeInPx * VALUE_UNIT_FONT_SCALE,
    headerRowHeightInPx: headerRowHeightInPx,
    titleRowHeightInPx: titleRowHeightInPx,
    statusRowHeightInPx: statusRowHeightInPx,
    sparklineRowHeightInPx: sparklineRowHeightInPx,
    valueRowHeightInPx: valueRowHeightInPx,
    sparklineWidthInPx: Math.min(
      Math.max(
        contentWidthInPx * SPARKLINE_WIDTH_FRACTION,
        MIN_SPARKLINE_WIDTH_IN_PX,
      ),
      contentWidthInPx,
      MAX_SPARKLINE_WIDTH_IN_PX,
    ),
    sparklineHeightInPx: sparklineHeightInPx,
  };
};

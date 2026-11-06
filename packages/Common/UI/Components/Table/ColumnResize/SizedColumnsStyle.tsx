import {
  ColumnWidthKind,
  ColumnWidths,
  getSizedColumnsCss,
} from "./ColumnWidths";
import ColumnWidthsStore, {
  useColumnWidthsSnapshot,
} from "./ColumnWidthsStore";
import React, {
  FunctionComponent,
  ReactElement,
  useLayoutEffect,
  useRef,
} from "react";

/*
 * The rules that let a sized column's values use its width
 * (ColumnWidths' getSizedColumnsCss), drawn from the table's widths: one
 * rule a column, read by every row at once, and drawn again on its own
 * when a width is kept - never the rows.
 *
 * They are written once the table is drawn, before it is painted: a table
 * a page draws itself names each column's kind as its header cell is drawn
 * (useResizableColumns' getResize), after these rules are.
 */

export interface SizedColumn {
  id: string;
  // Its place among its row's cells, from 1.
  cellNumber: number;
  /*
   * How its values may be cut short: a column kept whole (dates, numbers)
   * grows for a wider value rather than cut it.
   */
  kind?: ColumnWidthKind | undefined;
}

export interface ComponentProps {
  store: ColumnWidthsStore;
  // The table's COLUMN_WIDTHS_SCOPE_ATTRIBUTE.
  scope: string;
  // The columns a person may size, as the table draws them now.
  columns: ReadonlyArray<SizedColumn>;
  // A column's kind, where the columns do not say it.
  getKind?: ((columnId: string) => ColumnWidthKind | undefined) | undefined;
  /*
   * A table a page draws itself: a sized column's value boxes end words
   * they cut short in "..." (getSizedColumnsCss' clipsValueBoxes).
   */
  clipsValueBoxes?: boolean | undefined;
  /*
   * The rules changed after they were first written - a column sized for
   * the first time, given back (Delete) or every one reset - told once
   * they are on the page, before it is painted: a table that fits its card
   * by measuring itself (the shared Table) measures again there, so the
   * frame after Reset column widths is already fitted. Measured on the next
   * frame instead, the table was drawn for a frame at the widths its values
   * had been held at: Affected Resources about 340px wide in a 1214px card,
   * the rows past the card's edge, then back to 187px.
   */
  onRulesChange?: (() => void) | undefined;
}

export const SIZED_COLUMNS_STYLE_ATTRIBUTE: string = "data-column-widths-style";

const SizedColumnsStyle: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const widths: ColumnWidths = useColumnWidthsSnapshot(props.store);
  const styleRef: React.RefObject<HTMLStyleElement> =
    useRef<HTMLStyleElement>(null);
  // Whether the rules were written once: the first write changes nothing drawn.
  const isWrittenRef: React.MutableRefObject<boolean> = useRef<boolean>(false);
  const onRulesChangeRef: React.MutableRefObject<(() => void) | undefined> =
    useRef<(() => void) | undefined>(props.onRulesChange);
  onRulesChangeRef.current = props.onRulesChange;

  const sized: Array<SizedColumn> = props.columns.filter(
    (column: SizedColumn): boolean => {
      return widths[column.id] !== undefined;
    },
  );

  useLayoutEffect(() => {
    const style: HTMLStyleElement | null = styleRef.current;

    if (!style) {
      return;
    }

    const css: string = getSizedColumnsCss({
      scope: props.scope,
      cellNumbers: sized.map((column: SizedColumn): number => {
        return column.cellNumber;
      }),
      wholeCellNumbers: sized
        .filter((column: SizedColumn): boolean => {
          return (
            (column.kind ?? props.getKind?.(column.id)) ===
            ColumnWidthKind.Whole
          );
        })
        .map((column: SizedColumn): number => {
          return column.cellNumber;
        }),
      clipsValueBoxes: props.clipsValueBoxes,
    });

    if (style.textContent !== css) {
      style.textContent = css;

      if (isWrittenRef.current) {
        onRulesChangeRef.current?.();
      }
    }

    isWrittenRef.current = true;
  });

  return (
    <style
      ref={styleRef}
      {...{ [SIZED_COLUMNS_STYLE_ATTRIBUTE]: props.scope }}
    />
  );
};

export default SizedColumnsStyle;

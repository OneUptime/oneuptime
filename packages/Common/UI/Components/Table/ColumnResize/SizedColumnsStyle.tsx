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
}

export const SIZED_COLUMNS_STYLE_ATTRIBUTE: string = "data-column-widths-style";

const SizedColumnsStyle: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const widths: ColumnWidths = useColumnWidthsSnapshot(props.store);
  const styleRef: React.RefObject<HTMLStyleElement> =
    useRef<HTMLStyleElement>(null);

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
    });

    if (style.textContent !== css) {
      style.textContent = css;
    }
  });

  return (
    <style
      ref={styleRef}
      {...{ [SIZED_COLUMNS_STYLE_ATTRIBUTE]: props.scope }}
    />
  );
};

export default SizedColumnsStyle;

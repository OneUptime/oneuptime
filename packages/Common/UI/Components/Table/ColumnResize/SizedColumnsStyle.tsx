import { ColumnWidths, getSizedColumnsCss } from "./ColumnWidths";
import ColumnWidthsStore, { useColumnWidthsSnapshot } from "./ColumnWidthsStore";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The rules that let a sized column's values use its width
 * (ColumnWidths' getSizedColumnsCss), drawn from the table's widths: one
 * rule a column, read by every row at once, and drawn again on its own
 * when a width is kept - never the rows.
 */

export interface SizedColumn {
  id: string;
  // Its place among its row's cells, from 1.
  cellNumber: number;
}

export interface ComponentProps {
  store: ColumnWidthsStore;
  // The table's COLUMN_WIDTHS_SCOPE_ATTRIBUTE.
  scope: string;
  // The columns a person may size, as the table draws them now.
  columns: ReadonlyArray<SizedColumn>;
}

export const SIZED_COLUMNS_STYLE_ATTRIBUTE: string = "data-column-widths-style";

const SizedColumnsStyle: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const widths: ColumnWidths = useColumnWidthsSnapshot(props.store);

  const css: string = getSizedColumnsCss({
    scope: props.scope,
    cellNumbers: props.columns
      .filter((column: SizedColumn): boolean => {
        return widths[column.id] !== undefined;
      })
      .map((column: SizedColumn): number => {
        return column.cellNumber;
      }),
  });

  return (
    <style {...{ [SIZED_COLUMNS_STYLE_ATTRIBUTE]: props.scope }}>{css}</style>
  );
};

export default SizedColumnsStyle;

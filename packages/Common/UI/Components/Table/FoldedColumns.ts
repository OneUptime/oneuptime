import Column from "./Types/Column";
import Columns from "./Types/Columns";
import GenericObject from "../../../Types/GenericObject";
import FieldType from "../Types/FieldType";
import {
  TABLE_NARROW_BELOW_WIDTH_IN_PX,
  TABLE_NARROW_WINDOW_BELOW_WIDTH_IN_PX,
} from "./TableFit";

/*
 * A table folds its columns marked hideBelowLargeScreen (Column) - leaves
 * them out, their values shown in another column's cell instead
 * (useAreTableColumnsFolded) - when its own box is narrower than 48rem, and
 * in any box its rows do not fit (TableFit). Beside a side menu a card is
 * 430 to 758px wide up to a window of about 1100px: the Rule Library's four
 * columns needed 566px, a Kubernetes cluster's Events 680px, and both ran
 * under their sticky last column at 768px - and from 1024 to 1100px, where
 * they used to unfold because the window was wide, their main column stood
 * five lines tall in a 682-758px card.
 */
export const TABLE_FOLDED_COLUMNS_BELOW_BOX_WIDTH_IN_PX: number =
  TABLE_NARROW_BELOW_WIDTH_IN_PX;

// Where the table's box is not measured yet, a window below lg folds them.
export const TABLE_FOLDED_COLUMNS_BELOW_WIDTH_IN_PX: number =
  TABLE_NARROW_WINDOW_BELOW_WIDTH_IN_PX;

export interface DrawnTableColumns<T extends GenericObject> {
  // The columns the table draws, in their order.
  columns: Columns<T>;
  // Whether one was left out, so the cells show its value in their own place.
  areColumnsFolded: boolean;
  /*
   * The columns left out whose values the table shows itself, under another
   * column's value (Column.foldInto).
   */
  foldedColumns: Columns<T>;
}

/*
 * The columns a table draws. Folded, every one but those marked
 * hideBelowLargeScreen. As cards (a phone's, or a box too narrow for the
 * rows), a column the table folds under another's value (foldInto) is a
 * field of the card again - a card has the room down the page that a row
 * has not - while one the page's own cells show stays folded.
 */
export const getDrawnTableColumns: <T extends GenericObject>(
  columns: Columns<T>,
  isFolded: boolean,
  isCards?: boolean | undefined,
) => DrawnTableColumns<T> = <T extends GenericObject>(
  columns: Columns<T>,
  isFolded: boolean,
  isCards?: boolean | undefined,
): DrawnTableColumns<T> => {
  if (!isFolded) {
    return { columns: columns, areColumnsFolded: false, foldedColumns: [] };
  }

  const drawn: Columns<T> = columns.filter((column: Column<T>): boolean => {
    return (
      !column.hideBelowLargeScreen || Boolean(isCards && column.foldInto)
    );
  });

  // The same array when nothing is left out: nothing new to lay out.
  if (drawn.length === columns.length) {
    return { columns: columns, areColumnsFolded: false, foldedColumns: [] };
  }

  return {
    columns: drawn,
    areColumnsFolded: true,
    foldedColumns: columns.filter((column: Column<T>): boolean => {
      return Boolean(
        column.hideBelowLargeScreen && column.foldInto && !drawn.includes(column),
      );
    }),
  };
};

/*
 * The folded columns whose values a drawn column's cell shows under its
 * own (Column.foldInto): those that name it, by its id or its field - or,
 * when the column one names is not drawn (folded too, or switched off),
 * the row's first column, its name, so a value folded away is never
 * lost.
 */
export const getColumnsFoldedInto: <T extends GenericObject>(data: {
  column: Column<T>;
  drawnColumns: Columns<T>;
  foldedColumns: Columns<T>;
}) => Columns<T> = <T extends GenericObject>(data: {
  column: Column<T>;
  drawnColumns: Columns<T>;
  foldedColumns: Columns<T>;
}): Columns<T> => {
  if (data.foldedColumns.length === 0) {
    return [];
  }

  const canHold: (column: Column<T>) => boolean = (
    column: Column<T>,
  ): boolean => {
    return column.type !== FieldType.Actions;
  };

  const firstColumn: Column<T> | undefined = data.drawnColumns.find(canHold);

  return data.foldedColumns.filter((folded: Column<T>): boolean => {
    const target: Column<T> | undefined =
      data.drawnColumns.find((drawn: Column<T>): boolean => {
        return (
          canHold(drawn) &&
          (drawn.id === folded.foldInto ||
            (drawn.key !== undefined &&
              drawn.key !== null &&
              String(drawn.key) === folded.foldInto))
        );
      }) || firstColumn;

    return target === data.column;
  });
};

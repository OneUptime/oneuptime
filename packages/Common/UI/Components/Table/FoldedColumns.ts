import Column from "./Types/Column";
import Columns from "./Types/Columns";
import GenericObject from "../../../Types/GenericObject";

/*
 * Below lg (1024px) a table leaves out the columns marked
 * hideBelowLargeScreen (Column), and their values are shown in another
 * column's cell instead (useAreTableColumnsFolded). Beside a side menu a
 * card is 430 to 700px wide below lg: the Rule Library's four columns
 * needed 566px, a Kubernetes cluster's Events 680px, and both ran under
 * their sticky last column at 768px.
 */
export const TABLE_FOLDED_COLUMNS_BELOW_WIDTH_IN_PX: number = 1024;

export interface DrawnTableColumns<T extends GenericObject> {
  // The columns the table draws, in their order.
  columns: Columns<T>;
  // Whether one was left out, so the cells show its value in their own place.
  areColumnsFolded: boolean;
}

export const getDrawnTableColumns: <T extends GenericObject>(
  columns: Columns<T>,
  isBelowLargeScreen: boolean,
) => DrawnTableColumns<T> = <T extends GenericObject>(
  columns: Columns<T>,
  isBelowLargeScreen: boolean,
): DrawnTableColumns<T> => {
  if (!isBelowLargeScreen) {
    return { columns: columns, areColumnsFolded: false };
  }

  const drawn: Columns<T> = columns.filter((column: Column<T>): boolean => {
    return !column.hideBelowLargeScreen;
  });

  // The same array when nothing is left out: nothing new to lay out.
  if (drawn.length === columns.length) {
    return { columns: columns, areColumnsFolded: false };
  }

  return { columns: drawn, areColumnsFolded: true };
};

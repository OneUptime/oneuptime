/*
 * How much of a list a table's cell shows before the rest fold behind "N
 * more" (TableColumnListComponent: a row's labels, its Affected Resources,
 * its monitors or teams).
 *
 * Three items, one under another. A list of four shows all four: the "1
 * more" button takes a line of its own - a taller one than an item's - so
 * folding a single item saved no room and only hid it (a monitor's fourth
 * label, its Business System, behind "1 more label" on every row of the
 * list in OneUptime issue #5187). So "N more" always says two or more.
 *
 * React-free, so App's docs facts can read it.
 */
export const TABLE_COLUMN_LIST_VISIBLE_COUNT: number = 3;

/*
 * How many of `count` items a list shows before "N more": all of them when
 * at most one would be left over.
 */
export const getTableColumnListVisibleCount: (count: number) => number = (
  count: number,
): number => {
  return count > TABLE_COLUMN_LIST_VISIBLE_COUNT + 1
    ? TABLE_COLUMN_LIST_VISIBLE_COUNT
    : count;
};

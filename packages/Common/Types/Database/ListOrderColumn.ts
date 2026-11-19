import SortOrder from "../BaseDatabase/SortOrder";
import GenericFunction from "../GenericFunction";

/*
 * Marks a model as a list that people put in order by dragging its rows, and
 * names the number column that holds each row's place.
 *
 *   @ListOrderColumn({ column: "order", scopeColumns: ["statusPageId"] })
 *
 * With it, DatabaseService keeps that column for every caller - the dashboard,
 * the API, workflows, Terraform and seed data alike (issue #9609):
 *
 *   - a row created without a number goes to the end of its list;
 *   - a row created or updated WITH a number keeps it, and no other row
 *     moves - two rows may share a number, and are read in the order of
 *     their ids - so Terraform, which writes every row's number on its own,
 *     all at once, ends with every row at the number it wrote;
 *   - a row is moved past others by a request of its own, POST
 *     <the model's path>/:id/move { placeOfId } (BaseAPI,
 *     DatabaseService.moveInList), which is what a drop in a reorderable
 *     table sends: the row takes the place of the row it was dropped onto,
 *     and the list is numbered from scratch.
 *
 * The arithmetic lives in Common/Utils/ListOrder.ts and
 * Common/Types/Database/MoveInList.ts, shared with the table, so the two
 * cannot disagree. Nothing in a form should ask for this number: the order
 * IS the list, and the list is reordered by dragging.
 */
export interface ListOrderColumnOptions {
  // The number column that holds each row's place in its list.
  column: string;
  /*
   * The columns that say which list a row belongs to. Rows that share their
   * values are one list: every status page has its own header links, every
   * project its own reminder rules.
   */
  scopeColumns: Array<string>;
  /*
   * Which end of the numbers is the top of the list. Ascending (the default):
   * 1 is the top, the way lists are read. Descending: the highest number is
   * the top - for a list whose numbers already meant "higher wins" before it
   * could be dragged, so stored data and every reader of it keep their
   * meaning.
   */
  sortOrder?: SortOrder | undefined;
}

export interface ListOrderSettings {
  column: string;
  scopeColumns: Array<string>;
  sortOrder: SortOrder;
}

export default (options: ListOrderColumnOptions) => {
  return (ctr: GenericFunction) => {
    const settings: ListOrderSettings = {
      column: options.column,
      scopeColumns: [...options.scopeColumns],
      sortOrder: options.sortOrder || SortOrder.Ascending,
    };

    ctr.prototype.listOrder = settings;
  };
};

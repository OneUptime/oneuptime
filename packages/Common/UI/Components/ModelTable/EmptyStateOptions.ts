import IconProp from "../../../Types/Icon/IconProp";
import { TableEmptyStateAction } from "../Table/TableEmptyState";
import { ReactElement } from "react";

/*
 * A table's own words for its empty state - BaseModelTable's `emptyState`.
 *
 * Most tables need none of it. With nothing set, an empty model table shows
 * the model's icon, "No <plural name> yet", the card's description (what the
 * list is for - the card leaves it out of its header meanwhile, so it is not
 * said twice), the card's create button, and a link to the table's help or
 * documentation when it has one. A search or filter that hides every row,
 * a failed load and a viewer without access each get a state of their own.
 *
 * noItemsMessage still works: a sentence is split into the title (its first
 * sentence) and the description (the rest); an element replaces the whole
 * empty state.
 */
export default interface EmptyStateOptions {
  // In place of "No <plural name> yet". A heading: no full stop.
  title?: string | undefined;
  // What the list is for, or what to do next. In place of the card's.
  description?: string | ReactElement | undefined;
  // The illustration's icon. Defaults to the model's own (@TableMetadata).
  icon?: IconProp | undefined;
  /*
   * An empty list is good news here - no active incidents, no monitor
   * reporting a problem. Drawn with a green check, and no create button is
   * offered: creating one is not the answer to "all clear".
   */
  isAllClear?: boolean | undefined;
  // Never repeat the card's create button under the empty state.
  hideCreateButton?: boolean | undefined;
  /*
   * More ways forward, after the create button: "Read the setup guide",
   * "Connect a product". A Link-styled action reads as the quieter one.
   */
  actions?: Array<TableEmptyStateAction> | undefined;
  /*
   * Filters the page applies itself - facet chips above the table - hide
   * every row. The table then says nothing matches, as it does for its own
   * search and filters, offers no create button, and offers onClearFilters
   * when there is one.
   */
  isFiltered?: boolean | undefined;
  onClearFilters?: (() => void) | undefined;
}

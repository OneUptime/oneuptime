import { translationKey } from "../../Utils/TranslateTemplate";

/*
 * WHAT AN OPEN ENTITYDROPDOWN SAYS WHEN IT HAS NOTHING TO LIST.
 *
 * It used to say "No options." - a word for the control, not for what it
 * lists - and said it as well when every entry was already picked, which
 * read as though there had never been any. It now says which it is:
 *
 *   - a search that matches nothing: "No matching entries.";
 *   - a multi-select whose entries are all picked: "All of them are
 *     picked.", or "Search to find more." when the server's page of
 *     entries was full, so a search may still find some;
 *   - nothing to pick at all: what the field says is missing (its
 *     emptyListText, such as "No connected repositories yet."), or
 *     "Nothing to pick yet." for a field that says nothing.
 */

export const ENTITY_DROPDOWN_EMPTY_LIST_COPY: {
  nothingToPick: string;
  allPicked: string;
  searchForMore: string;
  noMatch: string;
} = {
  nothingToPick: translationKey("Nothing to pick yet."),
  allPicked: translationKey("All of them are picked."),
  searchForMore: translationKey("Search to find more."),
  noMatch: translationKey("No matching entries."),
};

export interface EntityDropdownEmptyListState {
  // What is typed in the search box.
  searchQuery: string;
  // Entries the list holds but does not show, because they are picked.
  pickedHiddenCount: number;
  // The server's page of entries was full: a search may find more.
  mayHaveMore: boolean;
  // The field's own words for having nothing to pick: a translation key.
  emptyListText?: string | undefined;
}

// What the empty list says, as a translation key.
export function getEntityDropdownEmptyListText(
  state: EntityDropdownEmptyListState,
): string {
  if (state.searchQuery.trim() !== "") {
    return ENTITY_DROPDOWN_EMPTY_LIST_COPY.noMatch;
  }

  if (state.pickedHiddenCount > 0) {
    return state.mayHaveMore
      ? ENTITY_DROPDOWN_EMPTY_LIST_COPY.searchForMore
      : ENTITY_DROPDOWN_EMPTY_LIST_COPY.allPicked;
  }

  return state.emptyListText || ENTITY_DROPDOWN_EMPTY_LIST_COPY.nothingToPick;
}

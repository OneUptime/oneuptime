import IconProp from "../../../Types/Icon/IconProp";
import {
  TranslateFunction,
  getEmptyMessageParts,
  getEmptyTableTitle,
  getLoadErrorTitle,
  EmptyMessageParts,
} from "./EmptyTableMessage";
import {
  TableEmptyStateAction,
  TableEmptyStateKind,
  TableEmptyStateProps,
} from "./TableEmptyState";

/*
 * The empty and error states a Table or List builds for itself, when the
 * caller hands it nothing more than a sentence (or nothing at all).
 * BaseModelTable builds richer ones - the card's description, the create
 * button, the filters - and passes them in whole.
 */

export const TRY_AGAIN: string = "Try again";
export const CLEAR_SEARCH: string = "Clear Search";
export const CLEAR_FILTERS: string = "Clear Filters";
export const CLEAR_SEARCH_AND_FILTERS: string = "Clear Search and Filters";

// The retry keeps the hook every table's Refresh link had.
export const TABLE_RETRY_BUTTON_TEST_ID: string = "refresh-button";
export const EMPTY_TABLE_CLEAR_FILTERS_TEST_ID: string =
  "empty-table-clear-filters-button";

export interface FilteredEmptyStateOptions {
  // What the reader is told: "No services match the current filters."
  title: string;
  description?: string | undefined;
  // Empties whatever is hiding the rows. No button without one.
  onClear?: (() => void) | undefined;
  // The button's words, when it clears more (or less) than filters.
  clearTitle?: string | undefined;
}

/*
 * Rows exist, but a search or filter hides every one of them: say so, and
 * offer the way back - never a Create button, the wrong answer to a search
 * that missed.
 */
export const getFilteredEmptyStateProps: (
  options: FilteredEmptyStateOptions,
) => TableEmptyStateProps = (
  options: FilteredEmptyStateOptions,
): TableEmptyStateProps => {
  const actions: Array<TableEmptyStateAction> = [];

  if (options.onClear) {
    actions.push({
      title: options.clearTitle || CLEAR_FILTERS,
      icon: IconProp.Close,
      onClick: options.onClear,
      dataTestId: EMPTY_TABLE_CLEAR_FILTERS_TEST_ID,
    });
  }

  return {
    kind: TableEmptyStateKind.Filtered,
    title: options.title,
    description: options.description,
    actions: actions,
  };
};

/*
 * Whether filter-form values narrow the rows - the same test BaseModelTable
 * applies to its own filters: any key with a value.
 */
export const hasFilterValues: (
  filterData: { [key: string]: unknown } | undefined,
) => boolean = (filterData: { [key: string]: unknown } | undefined): boolean => {
  if (!filterData) {
    return false;
  }

  return Object.keys(filterData).some((key: string): boolean => {
    return Boolean(filterData[key]);
  });
};

export interface LoadErrorStateOptions {
  pluralLabel: string;
  error: string;
  onRetry?: (() => void) | undefined;
  translate: TranslateFunction;
}

/*
 * A failed load: what failed, the server's reason, and a way to try again -
 * the underlined "Refresh?" this replaces was easy to miss under an error.
 */
export const getLoadErrorStateProps: (
  options: LoadErrorStateOptions,
) => TableEmptyStateProps = (
  options: LoadErrorStateOptions,
): TableEmptyStateProps => {
  const actions: Array<TableEmptyStateAction> = [];

  if (options.onRetry) {
    actions.push({
      title: TRY_AGAIN,
      icon: IconProp.Refresh,
      onClick: options.onRetry,
      dataTestId: TABLE_RETRY_BUTTON_TEST_ID,
    });
  }

  return {
    kind: TableEmptyStateKind.Error,
    title: getLoadErrorTitle({
      pluralLabel: options.pluralLabel,
      translate: options.translate,
    }),
    description: options.error,
    actions: actions,
  };
};

export interface MessageEmptyStateOptions {
  pluralLabel: string;
  // The page's own sentence(s), in English. Blank means the table's own.
  noItemsMessage?: string | undefined;
  translate: TranslateFunction;
}

/*
 * The title and description for an empty list: the page's own message,
 * split into a title and a description, or the table's own "No monitors
 * yet" when it has none.
 */
export const getMessageEmptyStateParts: (
  options: MessageEmptyStateOptions,
) => EmptyMessageParts = (
  options: MessageEmptyStateOptions,
): EmptyMessageParts => {
  const defaultTitle: string = getEmptyTableTitle({
    pluralLabel: options.pluralLabel,
    isFiltered: false,
    translate: options.translate,
  });

  const message: string = options.noItemsMessage?.trim() || "";

  if (!message) {
    return { title: defaultTitle };
  }

  return getEmptyMessageParts({
    message: options.translate(message) || message,
    defaultTitle: defaultTitle,
  });
};

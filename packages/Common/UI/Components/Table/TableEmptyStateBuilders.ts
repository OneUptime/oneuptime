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

// The retry keeps the hook every table's Refresh link had.
export const TABLE_RETRY_BUTTON_TEST_ID: string = "refresh-button";

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

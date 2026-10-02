import IconProp from "../../../Types/Icon/IconProp";
import { CardButtonSchema } from "../Card/Card";
import {
  EmptyMessageParts,
  TranslateFunction,
  getEmptyTableTitle,
  toHeadline,
} from "../Table/EmptyTableMessage";
import {
  TableEmptyStateAction,
  TableEmptyStateActionStyle,
  TableEmptyStateKind,
  TableEmptyStateProps,
} from "../Table/TableEmptyState";
import { getMessageEmptyStateParts } from "../Table/TableEmptyStateBuilders";
import EmptyStateOptions from "./EmptyStateOptions";
import { ReactElement } from "react";

/*
 * What an empty model table shows, decided in one place: BaseModelTable
 * gathers what it knows - the card, the create button, the search and
 * filters, the viewer's permission - and draws what this returns.
 */

export const CLEAR_SEARCH: string = "Clear Search";
export const CLEAR_FILTERS: string = "Clear Filters";
export const CLEAR_SEARCH_AND_FILTERS: string = "Clear Search and Filters";
export const VIEW_DOCUMENTATION: string = "View Documentation";

/*
 * Under a create button the viewer may not use. The button's own tooltip
 * names the permissions; a tooltip cannot be read on a phone, and a locked
 * button with no word of why looks broken.
 */
export const CREATE_NOT_ALLOWED_NOTE: string =
  "You don't have permission to create these. Ask a project admin for access.";

export const NO_ACCESS_TITLE: string = "You don't have access to this list";
export const NO_ACCESS_DESCRIPTION: string =
  "Ask a project admin for one of these permissions:";

export const EMPTY_TABLE_CREATE_BUTTON_TEST_ID: string =
  "empty-table-create-button";
export const EMPTY_TABLE_CLEAR_FILTERS_TEST_ID: string =
  "empty-table-clear-filters-button";
export const EMPTY_TABLE_HELP_LINK_TEST_ID: string = "empty-table-help-link";
export const EMPTY_TABLE_DOCS_LINK_TEST_ID: string = "empty-table-docs-link";

export interface ModelTableEmptyStateInput {
  // The table's plural noun, in English: "Incident Measurements".
  pluralLabel: string;
  options?: EmptyStateOptions | undefined;
  // The page's own sentence(s), when it gave noItemsMessage as text.
  noItemsMessage?: string | undefined;
  // The page gave noItemsMessage as an element: it is the empty state.
  hasCustomElement: boolean;
  // The card's description, said in the empty state instead of the header.
  cardDescription?: string | ReactElement | undefined;
  // The model's own icon (@TableMetadata), for the illustration.
  modelIcon?: IconProp | null | undefined;
  // The table's own search box (and its label chips) has something in it.
  isSearchActive: boolean;
  // The table's own filters have something set.
  isFilterActive: boolean;
  // Empties the table's search box and its filters.
  onClearSearchAndFilters: () => void;
  // The card header's create button, which the empty state repeats.
  createButton?: CardButtonSchema | undefined;
  // The viewer may not create this model at all (not just this button).
  isCreateDeniedByPermission: boolean;
  // The table's help (helpContent): its title, and what opens it.
  help?: { title: string; onClick: () => void } | undefined;
  // The table's documentation link.
  onDocumentationClick?: (() => void) | undefined;
  translate: TranslateFunction;
}

export interface ModelTableEmptyState {
  // Undefined when the page's own element is the empty state.
  emptyStateProps?: TableEmptyStateProps | undefined;
  /*
   * The empty state says what the card's description says: the card leaves
   * its description out while the empty state is on screen.
   */
  usesCardDescription: boolean;
}

type GetClearActionFunction = (
  input: ModelTableEmptyStateInput,
) => TableEmptyStateAction | undefined;

/*
 * The way out of a search or filter that hides every row, named for what it
 * clears. Filters the page applies itself are cleared too, when it says how.
 */
const getClearAction: GetClearActionFunction = (
  input: ModelTableEmptyStateInput,
): TableEmptyStateAction | undefined => {
  const isTableFiltered: boolean = input.isSearchActive || input.isFilterActive;
  const pageClear: (() => void) | undefined = input.options?.isFiltered
    ? input.options.onClearFilters
    : undefined;

  if (!isTableFiltered && !pageClear) {
    return undefined;
  }

  let title: string = CLEAR_FILTERS;

  if (input.isSearchActive && !input.isFilterActive && !pageClear) {
    title = CLEAR_SEARCH;
  }

  if (input.isSearchActive && (input.isFilterActive || pageClear)) {
    title = CLEAR_SEARCH_AND_FILTERS;
  }

  return {
    title: title,
    icon: IconProp.Close,
    dataTestId: EMPTY_TABLE_CLEAR_FILTERS_TEST_ID,
    onClick: (): void => {
      if (isTableFiltered) {
        input.onClearSearchAndFilters();
      }

      if (pageClear) {
        pageClear();
      }
    },
  };
};

type GetReadMoreActionFunction = (
  input: ModelTableEmptyStateInput,
) => TableEmptyStateAction | undefined;

// One way to read more: the table's own help, else its documentation.
const getReadMoreAction: GetReadMoreActionFunction = (
  input: ModelTableEmptyStateInput,
): TableEmptyStateAction | undefined => {
  if (input.help) {
    return {
      title: input.help.title,
      icon: IconProp.Help,
      style: TableEmptyStateActionStyle.Link,
      dataTestId: EMPTY_TABLE_HELP_LINK_TEST_ID,
      onClick: input.help.onClick,
    };
  }

  if (input.onDocumentationClick) {
    return {
      title: VIEW_DOCUMENTATION,
      icon: IconProp.Book,
      style: TableEmptyStateActionStyle.Link,
      dataTestId: EMPTY_TABLE_DOCS_LINK_TEST_ID,
      onClick: input.onDocumentationClick,
    };
  }

  return undefined;
};

export const buildModelTableEmptyState: (
  input: ModelTableEmptyStateInput,
) => ModelTableEmptyState = (
  input: ModelTableEmptyStateInput,
): ModelTableEmptyState => {
  const options: EmptyStateOptions = input.options || {};

  /*
   * A search or filter that hides every row. This wins over the page's own
   * wording, which is usually about a list with nothing in it at all - and
   * creating one is the wrong answer to a search that missed.
   */
  if (input.isSearchActive || input.isFilterActive || options.isFiltered) {
    const clearAction: TableEmptyStateAction | undefined =
      getClearAction(input);

    return {
      emptyStateProps: {
        kind: TableEmptyStateKind.Filtered,
        title: getEmptyTableTitle({
          pluralLabel: input.pluralLabel,
          isFiltered: true,
          translate: input.translate,
        }),
        actions: clearAction ? [clearAction] : [],
      },
      usesCardDescription: false,
    };
  }

  // The page drew its own empty state.
  if (input.hasCustomElement) {
    return { emptyStateProps: undefined, usesCardDescription: false };
  }

  const messageParts: EmptyMessageParts = getMessageEmptyStateParts({
    pluralLabel: input.pluralLabel,
    noItemsMessage: input.noItemsMessage,
    translate: input.translate,
  });

  /*
   * A title may be given as the sentence a locale already translates
   * ("Nothing here yet."): it is headed without the full stop all the same.
   */
  const title: string = options.title
    ? toHeadline(input.translate(options.title) || options.title)
    : messageParts.title;

  const ownDescription: string | ReactElement | undefined =
    options.description ||
    (options.title ? undefined : messageParts.description);

  /*
   * With nothing of its own to say, the empty state says what the list is
   * for, in the card's words. Not for "all clear": that is good news, and
   * the list's description stays in the header above it.
   */
  const usesCardDescription: boolean = Boolean(
    !ownDescription && !options.isAllClear && input.cardDescription,
  );

  const description: string | ReactElement | undefined = usesCardDescription
    ? input.cardDescription
    : ownDescription;

  const actions: Array<TableEmptyStateAction> = [];
  let note: string | undefined = undefined;

  const isCreateOffered: boolean = Boolean(
    input.createButton && !options.isAllClear && !options.hideCreateButton,
  );

  if (isCreateOffered && input.createButton) {
    const createButton: CardButtonSchema = input.createButton;

    actions.push({
      title: createButton.title,
      icon: createButton.icon,
      disabled: createButton.disabled,
      tooltip: createButton.tooltip,
      dataTestId: EMPTY_TABLE_CREATE_BUTTON_TEST_ID,
      onClick: (): void => {
        if (createButton.disabled) {
          return;
        }

        createButton.onClick();
      },
    });

    /*
     * A locked create button says why in words. When the viewer lacks the
     * permission that is the sentence everyone can act on; any other reason
     * the page gave the button is said as it gave it.
     */
    if (createButton.disabled) {
      note = input.isCreateDeniedByPermission
        ? CREATE_NOT_ALLOWED_NOTE
        : createButton.tooltip;
    }
  }

  for (const action of options.actions || []) {
    actions.push(action);
  }

  const readMoreAction: TableEmptyStateAction | undefined =
    getReadMoreAction(input);

  if (readMoreAction) {
    actions.push(readMoreAction);
  }

  return {
    emptyStateProps: {
      kind: options.isAllClear
        ? TableEmptyStateKind.AllClear
        : TableEmptyStateKind.Empty,
      icon:
        options.icon ||
        (options.isAllClear ? undefined : input.modelIcon || undefined),
      title: title,
      description: description,
      actions: actions,
      note: note,
    },
    usesCardDescription: usesCardDescription,
  };
};

export interface NoAccessStateInput {
  // The names of the permissions that would let the viewer read the list.
  permissionTitles: Array<string>;
  translate: TranslateFunction;
}

// A viewer who may read none of the table's columns.
export const buildNoAccessState: (
  input: NoAccessStateInput,
) => TableEmptyStateProps = (
  input: NoAccessStateInput,
): TableEmptyStateProps => {
  const permissions: string = input.permissionTitles.join(", ");

  return {
    kind: TableEmptyStateKind.NoAccess,
    title: input.translate(NO_ACCESS_TITLE) || NO_ACCESS_TITLE,
    description: permissions
      ? `${input.translate(NO_ACCESS_DESCRIPTION) || NO_ACCESS_DESCRIPTION} ${permissions}`
      : undefined,
  };
};

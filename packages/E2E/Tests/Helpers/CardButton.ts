import { Locator, Page } from "@playwright/test";

/*
 * The button of this name in a card's header - a list's Create button, or
 * any other action the card offers there ("Add Payment Method", "Add
 * Monitors").
 *
 * An EMPTY list repeats the header's create action under its "No X yet"
 * message (Common/UI/Components/ModelTable/ModelTableEmptyState.ts, the
 * button with data-testid "empty-table-create-button"): same name, same
 * handler. Since #4269 it does so under a page's own noItemsMessage too.
 * Asked for by its name alone, the button then matches two elements on an
 * empty list and Playwright's strict mode fails the wait or the click -
 * only once the table has loaded, so some runs pass and others do not. The
 * header's button is there whether or not the list is empty, so a spec that
 * means "open this card's create form" goes through it.
 */
type GetCardButtonFunction = (scope: Page | Locator, name: string) => Locator;

export const getCardButton: GetCardButtonFunction = (
  scope: Page | Locator,
  name: string,
): Locator => {
  return scope
    .getByTestId("card-button")
    .and(scope.getByRole("button", { name: name, exact: true }));
};

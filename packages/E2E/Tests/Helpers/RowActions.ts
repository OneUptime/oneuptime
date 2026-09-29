import { expect, Locator } from "@playwright/test";

/*
 * A table row carries one action as a button and folds the rest - Edit,
 * Delete, Show ID and most custom actions - into a ⋯ menu beside it.
 * Common/UI/Components/ActionButton/SplitActionButtons.ts decides which action
 * gets the button: View on a viewable table, otherwise the first call to
 * action, otherwise the first action that is not destructive. Delete is never
 * the button while anything else is on the row.
 *
 * So a spec after one of the folded actions has to open the menu first. Asking
 * the row for a "Delete" button finds nothing, and fails on a timeout that
 * says nothing about why.
 *
 * The menu is portalled into document.body, so a table's overflow scroller
 * cannot clip it - which puts its items outside the row. It is found through
 * the trigger that opened it (aria-controls) rather than inside the row, or as
 * "the menu on the page", which could be another menu left open.
 */
type OpenRowActionsMenuFunction = (row: Locator) => Promise<Locator>;

export const openRowActionsMenu: OpenRowActionsMenuFunction = async (
  row: Locator,
): Promise<Locator> => {
  const trigger: Locator = row.getByTestId("row-actions-more-button");

  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  const menuId: string | null = await trigger.getAttribute("aria-controls");

  if (!menuId) {
    throw new Error("The row's ⋯ trigger opened no menu it names.");
  }

  const menu: Locator = row.page().locator(`[id="${menuId}"]`);
  await expect(menu).toBeVisible();

  return menu;
};

/*
 * Opens the row's ⋯ menu and returns the named action in it, for a spec that
 * checks the action before (or instead of) choosing it. Escape closes the menu
 * again and hands focus back to its trigger.
 */
type GetRowMenuActionFunction = (data: {
  row: Locator;
  name: string;
}) => Promise<Locator>;

export const getRowMenuAction: GetRowMenuActionFunction = async (data: {
  row: Locator;
  name: string;
}): Promise<Locator> => {
  const menu: Locator = await openRowActionsMenu(data.row);

  return menu.getByRole("menuitem", { name: data.name, exact: true });
};

// Chooses the named action from the row's ⋯ menu.
type ClickRowMenuActionFunction = (data: {
  row: Locator;
  name: string;
}) => Promise<void>;

export const clickRowMenuAction: ClickRowMenuActionFunction = async (data: {
  row: Locator;
  name: string;
}): Promise<void> => {
  const action: Locator = await getRowMenuAction(data);

  await expect(action).toBeEnabled();
  await action.click();
};

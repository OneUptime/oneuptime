import { Locator, Page } from "@playwright/test";

/*
 * Drives the shared Dropdown in a browser. It is react-select, not a raw
 * <select>, so Playwright's selectOption and toHaveValue do not read it
 * (#9294): its combobox is the input a person types into, the choice it
 * shows is its single value, and its options are in a menu drawn over the
 * page, at the end of the document.
 */

// The combobox inside a box that holds one Dropdown (a data-testid's).
export function dropdownIn(container: Locator): Locator {
  return container.getByRole("combobox");
}

// What the picker shows as chosen.
export function shownDropdownValue(container: Locator): Locator {
  return container.locator(".ou-select__single-value");
}

// Opens the menu from the combobox and picks the option named `name`.
export async function pickDropdownOption(
  page: Page,
  combobox: Locator,
  name: string | RegExp,
): Promise<void> {
  await combobox.click();
  await page
    .locator(".ou-select__menu")
    .getByRole("option", { name, exact: typeof name === "string" })
    .click();
}

// Clears the picker with its clear (x) control.
export async function clearDropdown(container: Locator): Promise<void> {
  await container.locator(".ou-select__clear-indicator").click();
}

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

// Opens the menu from the combobox and reads its options' names, in order.
export async function listDropdownOptions(
  page: Page,
  combobox: Locator,
): Promise<Array<string>> {
  await combobox.click();
  const menu: Locator = page.locator(".ou-select__menu");
  await menu.getByRole("option").first().waitFor();
  const names: Array<string> = await menu.getByRole("option").allInnerTexts();
  await combobox.press("Escape");

  return names;
}

// The box a person sees and presses: the Dropdown's control.
export function dropdownControl(container: Locator): Locator {
  return container.locator(".ou-select__control");
}

/*
 * The control around a combobox found by its name: the box a layout check
 * measures, where the combobox itself is only the text box inside it.
 */
export function dropdownControlOf(combobox: Locator): Locator {
  return combobox.locator(
    "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' ou-select__control ')][1]",
  );
}

// What a picker found by its combobox's name shows as chosen.
export function shownDropdownValueOf(combobox: Locator): Locator {
  return dropdownControlOf(combobox).locator(".ou-select__single-value");
}

// The placeholder a picker found by its combobox's name shows.
export function shownDropdownPlaceholderOf(combobox: Locator): Locator {
  return dropdownControlOf(combobox).locator(".ou-select__placeholder");
}

// Clears the picker with its clear (x) control.
export async function clearDropdown(container: Locator): Promise<void> {
  await container.locator(".ou-select__clear-indicator").click();
}

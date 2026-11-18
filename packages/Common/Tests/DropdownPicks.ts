import { fireEvent, screen } from "@testing-library/react";

/*
 * Drives the shared Dropdown in jsdom, as a keyboard or a pointer would.
 *
 * The Dropdown is react-select: its combobox is the input a person types
 * into, the choice it shows is its single value, and its choices are the
 * options of the menu it opens, drawn over the page (document.body). The
 * pickers that used to be raw <select>s (#9294) are read through these.
 */

export function openDropdown(combobox: HTMLElement): void {
  fireEvent.keyDown(combobox, { key: "ArrowDown", code: "ArrowDown" });
}

export function closeDropdown(combobox: HTMLElement): void {
  fireEvent.keyDown(combobox, { key: "Escape", code: "Escape" });
}

// The box around the combobox, react-select's container.
export function getDropdownContainer(combobox: HTMLElement): HTMLElement {
  const container: HTMLElement | null = combobox.closest(".ou-select__control")
    ?.parentElement as HTMLElement | null;

  if (!container) {
    throw new Error("The combobox is not inside a shared Dropdown");
  }

  return container;
}

// What the picker shows as chosen, or null when it shows its placeholder.
export function getShownDropdownValue(combobox: HTMLElement): string | null {
  return (
    getDropdownContainer(combobox).querySelector(".ou-select__single-value")
      ?.textContent || null
  );
}

// The placeholder the picker shows while nothing is chosen.
export function getShownDropdownPlaceholder(
  combobox: HTMLElement,
): string | null {
  return (
    getDropdownContainer(combobox).querySelector(".ou-select__placeholder")
      ?.textContent || null
  );
}

// Whether the picker offers its clear (x) control.
export function hasDropdownClearControl(combobox: HTMLElement): boolean {
  return Boolean(
    getDropdownContainer(combobox).querySelector(".ou-select__clear-indicator"),
  );
}

// The names of the options the open menu lists, in order.
export async function listDropdownOptions(
  combobox: HTMLElement,
): Promise<Array<string>> {
  openDropdown(combobox);
  const options: Array<HTMLElement> = await screen.findAllByRole("option");
  const names: Array<string> = options.map((option: HTMLElement): string => {
    return option.textContent || "";
  });
  closeDropdown(combobox);

  return names;
}

// Opens the menu and picks the option named `name`.
export async function pickDropdownOption(
  combobox: HTMLElement,
  name: string | RegExp | ((accessibleName: string) => boolean),
): Promise<void> {
  openDropdown(combobox);
  fireEvent.click(await screen.findByRole("option", { name }));
}

/*
 * Picks an option at once, inside the same act: the menu opens on the key
 * and its options are there to click. `choice` is an option's name, or its
 * place in the list - for a test that reads the page in another language,
 * where the names are not English.
 */
export function chooseDropdownOption(
  combobox: HTMLElement,
  choice: string | RegExp | number,
): void {
  openDropdown(combobox);
  const option: HTMLElement | undefined =
    typeof choice === "number"
      ? screen.getAllByRole("option")[choice]
      : screen.getByRole("option", { name: choice });

  if (!option) {
    throw new Error(`The Dropdown has no option ${String(choice)}`);
  }

  fireEvent.click(option);
}

// Clears the picker with its clear (x) control, as a pointer does.
export function clearDropdown(combobox: HTMLElement): void {
  const clear: Element | null = getDropdownContainer(combobox).querySelector(
    ".ou-select__clear-indicator",
  );

  if (!clear) {
    throw new Error("The Dropdown has no clear control");
  }

  fireEvent.mouseDown(clear, { button: 0 });
}

/*
 * The names of the options the menu lists, read at once (inside the same
 * act), for a test that cannot wait: opened, read and closed again. An
 * empty menu reads as an empty list.
 */
export function readDropdownOptions(combobox: HTMLElement): Array<string> {
  openDropdown(combobox);
  const names: Array<string> = screen
    .queryAllByRole("option")
    .map((option: HTMLElement): string => {
      return option.textContent || "";
    });
  closeDropdown(combobox);

  return names;
}

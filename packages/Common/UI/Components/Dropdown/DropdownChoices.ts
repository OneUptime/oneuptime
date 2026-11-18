import type { DropdownOption, DropdownValue } from "./Dropdown";

/*
 * Helpers for a picker built from a fixed list of choices - a toolbar's
 * "Line labels", a filter chip's operator, a language - that used to be a
 * raw <select> (#9294).
 */

/*
 * A choice whose words the page has put in the reader's language already
 * (translateText, t()): drawn as given, never looked up a second time, and
 * read the page's way.
 */
export function getTranslatedDropdownOption(
  value: DropdownValue,
  label: string,
): DropdownOption {
  return {
    value: value,
    label: label,
    isUserContent: true,
    isInPageDirection: true,
  };
}

/*
 * A choice named by a person or by the data - a variable, a label, a device
 * type: drawn as written, never looked up, and read the way most of its
 * letters do.
 */
export function getNamedDropdownOption(
  value: DropdownValue,
  name: string,
): DropdownOption {
  return {
    value: value,
    label: name,
    isUserContent: true,
  };
}

/*
 * The option that holds a value, for the Dropdown's `value`: undefined when
 * none does, so the picker shows its placeholder. Values are compared as
 * text, so a number held as 7 finds the option "7" and the other way round.
 */
export function findDropdownOption(
  options: Array<DropdownOption>,
  value: DropdownValue | null | undefined,
): DropdownOption | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  return options.find((option: DropdownOption): boolean => {
    return String(option.value) === String(value);
  });
}

/*
 * The one value a single picker's change carries, as text, or null when it
 * was cleared. A multi-select's list is not a single pick and reads as null.
 */
export function readPickedDropdownValue(
  next: DropdownValue | Array<DropdownValue> | null,
): string | null {
  if (next === null || next === undefined || Array.isArray(next)) {
    return null;
  }

  return String(next);
}

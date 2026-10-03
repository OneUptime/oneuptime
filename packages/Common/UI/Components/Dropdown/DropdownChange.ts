import type {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "./Dropdown";
import ObjectID from "../../../Types/ObjectID";

/*
 * What a pick in a dropdown changed, as the list showed it: the options
 * picked now, and the ones that were picked before. A form field's onChange
 * receives it as its fourth argument (Forms/Types/Field), so a field can
 * name something after what was picked - a status page resource's display
 * name after the monitor - without a request of its own, and can tell a
 * name it filled in from one somebody typed.
 *
 * Only options the list can name are in it. A value whose label the list
 * has not loaded yet is left out rather than handed over with its raw id
 * as a label, which would read as a name.
 */
export interface DropdownChange {
  selectedOptions: Array<DropdownOption>;
  previousOptions: Array<DropdownOption>;
}

export const EMPTY_DROPDOWN_CHANGE: DropdownChange = {
  selectedOptions: [],
  previousOptions: [],
};

type IsDropdownOptionFunction = (value: unknown) => value is DropdownOption;

const isDropdownOption: IsDropdownOptionFunction = (
  value: unknown,
): value is DropdownOption => {
  return (
    value !== null &&
    typeof value === "object" &&
    !(value instanceof ObjectID) &&
    "value" in value &&
    "label" in value
  );
};

type ToKeyFunction = (value: unknown) => string | null;

const toKey: ToKeyFunction = (value: unknown): string | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (isDropdownOption(value)) {
    return toKey(value.value);
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value instanceof ObjectID
  ) {
    return value.toString();
  }

  return null;
};

export type FlattenDropdownOptionsFunction = (
  options: Array<DropdownOption | DropdownOptionGroup> | undefined,
) => Array<DropdownOption>;

// A list's options with their groups opened up, in the order they are shown.
export const flattenDropdownOptions: FlattenDropdownOptionsFunction = (
  options: Array<DropdownOption | DropdownOptionGroup> | undefined,
): Array<DropdownOption> => {
  const flat: Array<DropdownOption> = [];

  for (const item of options || []) {
    if (
      item &&
      typeof item === "object" &&
      "options" in item &&
      Array.isArray((item as DropdownOptionGroup).options)
    ) {
      flat.push(...(item as DropdownOptionGroup).options);
      continue;
    }

    flat.push(item as DropdownOption);
  }

  return flat;
};

export type GetDropdownOptionsForValueFunction = (data: {
  options: Array<DropdownOption | DropdownOptionGroup> | undefined;
  /*
   * What a form holds for the field: a value, an option, an ObjectID, or a
   * list of any of those for a multi-select.
   */
  value: unknown;
}) => Array<DropdownOption>;

/**
 * The options a dropdown's value stands for, in the value's order. A value
 * that is an option already is taken as it is; any other is looked up among
 * the options and left out when none has it.
 */
export const getDropdownOptionsForValue: GetDropdownOptionsForValueFunction =
  (data: {
    options: Array<DropdownOption | DropdownOptionGroup> | undefined;
    value: unknown;
  }): Array<DropdownOption> => {
    const values: Array<unknown> = Array.isArray(data.value)
      ? data.value
      : [data.value];

    const byKey: Map<string, DropdownOption> = new Map<
      string,
      DropdownOption
    >();

    for (const option of flattenDropdownOptions(data.options)) {
      const key: string | null = toKey(option.value);

      if (key !== null && !byKey.has(key)) {
        byKey.set(key, option);
      }
    }

    const found: Array<DropdownOption> = [];

    for (const value of values) {
      if (isDropdownOption(value)) {
        found.push(value);
        continue;
      }

      const key: string | null = toKey(value);
      const option: DropdownOption | undefined =
        key === null ? undefined : byKey.get(key);

      if (option) {
        found.push(option);
      }
    }

    return found;
  };

export type GetDropdownChangeFunction = (data: {
  options: Array<DropdownOption | DropdownOptionGroup> | undefined;
  // The value just picked: DropdownValue, a list of them, or null.
  value: DropdownValue | Array<DropdownValue> | null | unknown;
  // The value the field held before the pick.
  previousValue: unknown;
}) => DropdownChange;

/**
 * The change a pick made, for a dropdown whose options are all in hand (a
 * fixed list). A dropdown that searches the server for its options knows
 * more than its first page, so it reports its own (EntityDropdown).
 */
export const getDropdownChange: GetDropdownChangeFunction = (data: {
  options: Array<DropdownOption | DropdownOptionGroup> | undefined;
  value: DropdownValue | Array<DropdownValue> | null | unknown;
  previousValue: unknown;
}): DropdownChange => {
  return {
    selectedOptions: getDropdownOptionsForValue({
      options: data.options,
      value: data.value,
    }),
    previousOptions: getDropdownOptionsForValue({
      options: data.options,
      value: data.previousValue,
    }),
  };
};

export type GetPickedLabelFunction = (
  options: Array<DropdownOption> | undefined,
) => string | null;

/**
 * The label of the one option picked - a single-select's pick - or null
 * when nothing, or more than one, is picked.
 */
export const getPickedLabel: GetPickedLabelFunction = (
  options: Array<DropdownOption> | undefined,
): string | null => {
  if (!options || options.length !== 1) {
    return null;
  }

  const label: string = (options[0]?.label || "").trim();

  return label ? label : null;
};

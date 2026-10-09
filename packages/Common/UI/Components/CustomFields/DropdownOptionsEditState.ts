import { CustomFieldDropdownOption } from "../../../Types/CustomField/CustomFieldDropdownOption";
import {
  CustomFieldOptionRename,
  CustomFieldOptionUsage,
  CustomFieldOptionUsageValue,
  getCustomFieldOptionUsageCount,
} from "../../../Types/CustomField/CustomFieldOptionEdit";

/*
 * What the dropdown options editor (DropdownOptionsInput) works out from its
 * rows while a field that may already have values is edited (#4564), kept
 * apart from React so each rule can be tested on its own:
 *
 *   - a row the field already had, whose text was changed, is a RENAME: the
 *     records holding the old text are moved to the new one when the field
 *     is saved;
 *   - an option taken out - its row removed, or its text cleared - and a
 *     value records hold that was not an option even before, are NO LONGER
 *     OFFERED: the records keep them unless an option is picked for them,
 *     which is a rename too;
 *   - two rows of the same text are a mistake to point out, not to merge.
 *
 * Moving a row only changes the order the options are listed in.
 */

export interface EditableDropdownOption extends CustomFieldDropdownOption {
  // The row, for React and for drag and drop; never saved.
  id: number;
  /*
   * The option's text when the editor opened, for an option the field
   * already had; undefined for one added in the editor.
   */
  originalValue?: string | undefined;
}

// An option the field had, taken out in the editor: Undo puts it back.
export interface RemovedDropdownOption {
  option: EditableDropdownOption;
  // Where its row was.
  index: number;
}

/*
 * A value records may hold that the field will not offer once saved.
 */
export interface RetiredDropdownOptionValue {
  value: string;
  // Its color, when it was one of the field's options.
  color?: string | undefined;
  // How many records hold it; undefined when that is not known.
  count: number | undefined;
  // Whether the field offered it when the editor opened.
  wasOption: boolean;
  // Taken out in this edit: it can be put back.
  removed?: RemovedDropdownOption | undefined;
}

export type GetDropdownOptionTextFunction = (
  option: CustomFieldDropdownOption,
) => string;

// What a row saves as: its text, trimmed.
export const getDropdownOptionText: GetDropdownOptionTextFunction = (
  option: CustomFieldDropdownOption,
): string => {
  return (option.value || "").trim();
};

export type IsRenamedDropdownOptionFunction = (
  option: EditableDropdownOption,
) => boolean;

/**
 * Whether the row is an option the field had, now saved under another,
 * non-empty text.
 */
export const isRenamedDropdownOption: IsRenamedDropdownOptionFunction = (
  option: EditableDropdownOption,
): boolean => {
  const text: string = getDropdownOptionText(option);

  return (
    option.originalValue !== undefined &&
    text.length > 0 &&
    text !== option.originalValue
  );
};

export type GetDuplicateDropdownOptionTextsFunction = (
  options: Array<CustomFieldDropdownOption>,
) => Set<string>;

// The texts more than one row has. Empty rows are not counted.
export const getDuplicateDropdownOptionTexts: GetDuplicateDropdownOptionTextsFunction =
  (options: Array<CustomFieldDropdownOption>): Set<string> => {
    const seen: Set<string> = new Set<string>();
    const duplicates: Set<string> = new Set<string>();

    for (const option of options) {
      const text: string = getDropdownOptionText(option);

      if (!text) {
        continue;
      }

      if (seen.has(text)) {
        duplicates.add(text);
      }

      seen.add(text);
    }

    return duplicates;
  };

export type GetRetiredDropdownOptionValuesFunction = (data: {
  // The field's options when the editor opened.
  originalOptions: Array<CustomFieldDropdownOption>;
  options: Array<EditableDropdownOption>;
  removed: Array<RemovedDropdownOption>;
  // How many records hold each value; null or undefined while not known.
  usage: CustomFieldOptionUsage | null | undefined;
}) => Array<RetiredDropdownOptionValue>;

/**
 * The values records may hold that the field will not offer once saved: the
 * options taken out (in the order the field listed them), then the values
 * that were not options even before (the most held first). One that a row
 * offers again - the same text typed into another row - is not among them.
 *
 * With counts known, only values some record holds are listed: taking out
 * an option nobody chose touches nothing. Without them, every option taken
 * out is listed, as it may be held.
 */
export const getRetiredDropdownOptionValues: GetRetiredDropdownOptionValuesFunction =
  (data: {
    originalOptions: Array<CustomFieldDropdownOption>;
    options: Array<EditableDropdownOption>;
    removed: Array<RemovedDropdownOption>;
    usage: CustomFieldOptionUsage | null | undefined;
  }): Array<RetiredDropdownOptionValue> => {
    const offered: Set<string> = new Set<string>();
    const kept: Set<string> = new Set<string>();

    for (const option of data.options) {
      const text: string = getDropdownOptionText(option);

      if (!text) {
        continue;
      }

      offered.add(text);

      if (option.originalValue !== undefined) {
        kept.add(option.originalValue);
      }
    }

    const retired: Array<RetiredDropdownOptionValue> = [];
    const listed: Set<string> = new Set<string>();

    for (const original of data.originalOptions) {
      const value: string = original.value;

      if (listed.has(value) || kept.has(value) || offered.has(value)) {
        continue;
      }

      listed.add(value);

      const entry: RetiredDropdownOptionValue = {
        value,
        count: getCustomFieldOptionUsageCount(data.usage, value),
        wasOption: true,
      };

      if (original.color) {
        entry.color = original.color;
      }

      const removed: RemovedDropdownOption | undefined = data.removed.find(
        (candidate: RemovedDropdownOption): boolean => {
          return candidate.option.originalValue === value;
        },
      );

      if (removed) {
        entry.removed = removed;
      }

      retired.push(entry);
    }

    const originalValues: Set<string> = new Set<string>(
      data.originalOptions.map((option: CustomFieldDropdownOption): string => {
        return option.value;
      }),
    );

    for (const held of data.usage?.values || []) {
      const value: CustomFieldOptionUsageValue = held;

      if (
        listed.has(value.value) ||
        originalValues.has(value.value) ||
        offered.has(value.value)
      ) {
        continue;
      }

      listed.add(value.value);
      retired.push({
        value: value.value,
        count: value.count,
        wasOption: false,
      });
    }

    return retired.filter((entry: RetiredDropdownOptionValue): boolean => {
      return entry.count === undefined ? entry.wasOption : entry.count > 0;
    });
  };

export type GetDropdownOptionRenamesFunction = (data: {
  options: Array<EditableDropdownOption>;
  retired: Array<RetiredDropdownOptionValue>;
  /*
   * The row each retired value is to become, by the value; a value with
   * none stays on the records that hold it.
   */
  replacements: Record<string, number | undefined>;
}) => Array<CustomFieldOptionRename>;

/**
 * What the save renames: every option the field had whose text changed,
 * then every retired value an option was picked for, as the picked row reads
 * now. A value is renamed once at most - the first it is given wins.
 */
export const getDropdownOptionRenames: GetDropdownOptionRenamesFunction =
  (data: {
    options: Array<EditableDropdownOption>;
    retired: Array<RetiredDropdownOptionValue>;
    replacements: Record<string, number | undefined>;
  }): Array<CustomFieldOptionRename> => {
    const renames: Array<CustomFieldOptionRename> = [];
    const froms: Set<string> = new Set<string>();

    type AddFunction = (from: string, to: string) => void;

    const add: AddFunction = (from: string, to: string): void => {
      if (!from || !to || from === to || froms.has(from)) {
        return;
      }

      froms.add(from);
      renames.push({ from, to });
    };

    for (const option of data.options) {
      if (isRenamedDropdownOption(option)) {
        add(option.originalValue!, getDropdownOptionText(option));
      }
    }

    for (const entry of data.retired) {
      const rowId: number | undefined = Object.prototype.hasOwnProperty.call(
        data.replacements,
        entry.value,
      )
        ? data.replacements[entry.value]
        : undefined;

      if (rowId === undefined) {
        continue;
      }

      const row: EditableDropdownOption | undefined = data.options.find(
        (option: EditableDropdownOption): boolean => {
          return option.id === rowId;
        },
      );

      if (row) {
        add(entry.value, getDropdownOptionText(row));
      }
    }

    return renames;
  };

export type MoveDropdownOptionFunction = <T>(
  options: Array<T>,
  from: number,
  to: number,
) => Array<T>;

/**
 * The list with the row at `from` moved to `to`; the list itself when either
 * is out of range or they are the same.
 */
export const moveDropdownOption: MoveDropdownOptionFunction = <T>(
  options: Array<T>,
  from: number,
  to: number,
): Array<T> => {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= options.length ||
    to >= options.length
  ) {
    return options;
  }

  const next: Array<T> = [...options];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);

  return next;
};

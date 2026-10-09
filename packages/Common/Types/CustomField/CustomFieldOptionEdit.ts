import {
  CustomFieldDropdownOption,
  parseCustomFieldDropdownOptions,
} from "./CustomFieldDropdownOption";
import CustomFieldType from "./CustomFieldType";

/*
 * EDITING A DROPDOWN FIELD'S OPTIONS AFTER IT HAS VALUES (issue #4564).
 *
 * A record stores a Dropdown or MultiSelectDropdown answer as the option's
 * own text - `customFields: { "Facility": "Facility A" }`, or a list of
 * them - and every reader works with that text: the table, the filter chips,
 * templates ({{incident.customFields.<key>}}), subscriber messages,
 * webhooks, workflows, the API and the Terraform provider. So an option has
 * no identity apart from its text, and editing the option list cannot tell
 * on its own whether "Facility A" became "Facility Alpha" (a rename: every
 * record holding the old text should now hold the new) or was removed and a
 * different option added (records keep what they hold).
 *
 * That is said explicitly instead. A write that changes a field's options can
 * carry, beside its columns, the list of RENAMES it makes - in the request's
 * miscDataProps, under RENAMED_DROPDOWN_OPTIONS_KEY:
 *
 *   { "data": { "dropdownOptions": "Facility Alpha\nFacility C" },
 *     "miscDataProps": { "renamedDropdownOptions": [
 *       { "from": "Facility A", "to": "Facility Alpha" } ] } }
 *
 * The server then moves every stored value from `from` to `to` - on the
 * records, the templates, the saved views that filter by it and the form
 * templates that answer it - in one pass, so a swap (A to B and B to A at
 * once) works too. The dashboard sends one for every option whose text was
 * edited, and for every value no longer offered that it is told to change
 * into an option. Without one, options only change in the list: values
 * already stored stay exactly as they are, and are shown as "no longer an
 * option" until someone changes them - nothing is rewritten on a guess.
 *
 * The rules a rename list must follow (getCustomFieldOptionRenamesProblem):
 *
 *   - `from` and `to` are non-empty text, and differ;
 *   - each `from` appears once (a value cannot become two options);
 *   - `to` is one of the field's options once the write is saved, so a
 *     moved value always lands on a real option. `from` does not have to be
 *     an option: a value a record holds that is not one any more can be
 *     moved onto one, which is how such values are tidied up.
 *
 * Pure, with no database or React imports: the server's checks, its value
 * moves (CustomFieldOptionRename) and the dashboard's option editor read the
 * same rules.
 */

// Where a write carries its renames: the request's miscDataProps.
export const RENAMED_DROPDOWN_OPTIONS_KEY: string = "renamedDropdownOptions";

// The most renames one write may carry.
export const MAX_DROPDOWN_OPTION_RENAMES: number = 500;

export interface CustomFieldOptionRename {
  // A value records may hold today.
  from: string;
  // The option it becomes.
  to: string;
}

export interface ReadCustomFieldOptionRenamesResult {
  renames: Array<CustomFieldOptionRename>;
  // Why the list cannot be used, in a sentence; null when it can.
  problem: string | null;
}

type IsPlainObjectFunction = (
  value: unknown,
) => value is Record<string, unknown>;

const isPlainObject: IsPlainObjectFunction = (
  value: unknown,
): value is Record<string, unknown> => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

type QuoteFunction = (value: string) => string;

// A value quoted back in a message, bounded so a pasted essay stays one line.
const quote: QuoteFunction = (value: string): string => {
  const text: string = value.length > 80 ? `${value.slice(0, 80)}...` : value;

  return `"${text}"`;
};

export type ReadCustomFieldOptionRenamesFunction = (
  value: unknown,
) => ReadCustomFieldOptionRenamesResult;

/**
 * The renames a request asked for, trimmed, with every pair that renames a
 * value to itself dropped. Nothing sent (undefined or null) is no renames.
 * Anything that is not a list of { from, to } pairs of text is a problem,
 * not a partial list: half a rename would move some values and not others.
 */
export const readCustomFieldOptionRenames: ReadCustomFieldOptionRenamesFunction =
  (value: unknown): ReadCustomFieldOptionRenamesResult => {
    if (value === undefined || value === null) {
      return { renames: [], problem: null };
    }

    if (!Array.isArray(value)) {
      return {
        renames: [],
        problem: `${RENAMED_DROPDOWN_OPTIONS_KEY} must be a list of { "from", "to" } pairs.`,
      };
    }

    if (value.length > MAX_DROPDOWN_OPTION_RENAMES) {
      return {
        renames: [],
        problem: `One save can rename at most ${MAX_DROPDOWN_OPTION_RENAMES} options.`,
      };
    }

    const renames: Array<CustomFieldOptionRename> = [];
    const froms: Set<string> = new Set<string>();

    for (const entry of value) {
      if (
        !isPlainObject(entry) ||
        typeof entry["from"] !== "string" ||
        typeof entry["to"] !== "string"
      ) {
        return {
          renames: [],
          problem: `Each entry of ${RENAMED_DROPDOWN_OPTIONS_KEY} must be { "from": <the value records hold>, "to": <the option it becomes> }, both text.`,
        };
      }

      const from: string = entry["from"].trim();
      const to: string = entry["to"].trim();

      if (!from || !to) {
        return {
          renames: [],
          problem: "An option cannot be renamed from or to empty text.",
        };
      }

      if (from === to) {
        continue;
      }

      if (froms.has(from)) {
        return {
          renames: [],
          problem: `${quote(from)} is renamed more than once. A value can become only one option.`,
        };
      }

      froms.add(from);
      renames.push({ from, to });
    }

    return { renames, problem: null };
  };

export type GetCustomFieldOptionRenamesProblemFunction = (data: {
  renames: Array<CustomFieldOptionRename>;
  // The field's type: only dropdowns have options to rename.
  customFieldType: CustomFieldType | string | null | undefined;
  // The options the field will have once the write is saved, serialized.
  dropdownOptions: string | null | undefined;
}) => string | null;

/**
 * Why these renames cannot be applied to a field of this type with these
 * options, or null when they can.
 */
export const getCustomFieldOptionRenamesProblem: GetCustomFieldOptionRenamesProblemFunction =
  (data: {
    renames: Array<CustomFieldOptionRename>;
    customFieldType: CustomFieldType | string | null | undefined;
    dropdownOptions: string | null | undefined;
  }): string | null => {
    if (data.renames.length === 0) {
      return null;
    }

    if (
      data.customFieldType !== CustomFieldType.Dropdown &&
      data.customFieldType !== CustomFieldType.MultiSelectDropdown
    ) {
      return "Only a dropdown field has options to rename.";
    }

    const options: Set<string> = new Set<string>(
      parseCustomFieldDropdownOptions(data.dropdownOptions || undefined).map(
        (option: CustomFieldDropdownOption): string => {
          return option.value;
        },
      ),
    );

    const notOptions: Array<string> = data.renames
      .map((rename: CustomFieldOptionRename): string => {
        return rename.to;
      })
      .filter((to: string): boolean => {
        return !options.has(to);
      });

    if (notOptions.length === 0) {
      return null;
    }

    return `${notOptions
      .slice(0, 10)
      .map((to: string): string => {
        return quote(to);
      })
      .join(", ")} ${
      notOptions.length === 1 ? "is not one of" : "are not among"
    } the field's options. A value can only be renamed to an option the field offers.`;
  };

/*
 * The renames as a lookup from the value records hold to the option it
 * becomes. A Map rather than an object, so a value such as "__proto__" or
 * "constructor" is a value like any other.
 */
export type CustomFieldOptionRenameMap = Map<string, string>;

export type ToCustomFieldOptionRenameMapFunction = (
  renames: Array<CustomFieldOptionRename>,
) => CustomFieldOptionRenameMap;

export const toCustomFieldOptionRenameMap: ToCustomFieldOptionRenameMapFunction =
  (renames: Array<CustomFieldOptionRename>): CustomFieldOptionRenameMap => {
    const map: CustomFieldOptionRenameMap = new Map<string, string>();

    for (const rename of renames) {
      if (!map.has(rename.from)) {
        map.set(rename.from, rename.to);
      }
    }

    return map;
  };

export interface RenamedCustomFieldOptionValue {
  value: unknown;
  changed: boolean;
}

type IsOptionScalarFunction = (value: unknown) => boolean;

/*
 * What a dropdown value can be written as: its text, or a bare number or
 * yes/no sent over the API (CustomFieldValueValidator). Matched by its text.
 */
const isOptionScalar: IsOptionScalarFunction = (value: unknown): boolean => {
  return (
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
  );
};

export type RenameCustomFieldOptionValueFunction = (
  value: unknown,
  renames: CustomFieldOptionRenameMap,
) => RenamedCustomFieldOptionValue;

/**
 * One stored value with the renames applied, all at once: a single value
 * that was renamed holds the option's new text; a list has each renamed
 * entry replaced, keeping its place, and every entry that repeats one before
 * it dropped (merging "A" into "B" leaves ["B"], not ["B", "B"]). A list
 * none of whose entries is renamed is left as it is, repeats and all.
 * Anything else - empty, an object, a list entry that is not a value - is
 * left exactly as it is. The server's SQL (CustomFieldOptionRename) does the
 * same to the records, and is tested against this.
 */
export const renameCustomFieldOptionValue: RenameCustomFieldOptionValueFunction =
  (
    value: unknown,
    renames: CustomFieldOptionRenameMap,
  ): RenamedCustomFieldOptionValue => {
    if (renames.size === 0) {
      return { value, changed: false };
    }

    if (isOptionScalar(value)) {
      const renamed: string | undefined = renames.get(String(value));

      return renamed === undefined
        ? { value, changed: false }
        : { value: renamed, changed: true };
    }

    if (!Array.isArray(value)) {
      return { value, changed: false };
    }

    let changed: boolean = false;

    const mapped: Array<unknown> = value.map((entry: unknown): unknown => {
      if (!isOptionScalar(entry)) {
        return entry;
      }

      const renamed: string | undefined = renames.get(String(entry));

      if (renamed === undefined) {
        return entry;
      }

      changed = true;
      return renamed;
    });

    if (!changed) {
      return { value, changed: false };
    }

    /*
     * Repeats are told apart as JSON tells them apart - the text "1" and the
     * number 1 are two entries - which is how the database compares them.
     */
    const seen: Set<string> = new Set<string>();
    const entries: Array<unknown> = [];

    for (const entry of mapped) {
      const key: string = JSON.stringify(entry === undefined ? null : entry);

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      entries.push(entry);
    }

    return { value: entries, changed: true };
  };

export interface RenamedCustomFieldOptionList {
  options: Array<CustomFieldDropdownOption>;
  changed: boolean;
}

export type RenameCustomFieldOptionsInListFunction = (data: {
  options: Array<CustomFieldDropdownOption>;
  renames: CustomFieldOptionRenameMap;
  // Options to add at the end when the list does not offer them yet.
  addOptions?: Array<CustomFieldDropdownOption> | undefined;
}) => RenamedCustomFieldOptionList;

/**
 * An option list with the renames applied - each renamed option keeps its
 * place and its color, and one that now repeats an option before it is
 * merged into that one - and with `addOptions` appended where the list does
 * not offer them. For a field that copies its value from another field
 * (CustomFieldMappingCatalog): it must offer every option the field it
 * copies from can hold, so the source's renames and new options are made
 * here too.
 */
export const renameCustomFieldOptionsInList: RenameCustomFieldOptionsInListFunction =
  (data: {
    options: Array<CustomFieldDropdownOption>;
    renames: CustomFieldOptionRenameMap;
    addOptions?: Array<CustomFieldDropdownOption> | undefined;
  }): RenamedCustomFieldOptionList => {
    let changed: boolean = false;
    const byValue: Map<string, CustomFieldDropdownOption> = new Map<
      string,
      CustomFieldDropdownOption
    >();
    const options: Array<CustomFieldDropdownOption> = [];

    for (const option of data.options) {
      const renamed: string | undefined = data.renames.get(option.value);
      const value: string = renamed === undefined ? option.value : renamed;

      if (renamed !== undefined) {
        changed = true;
      }

      // Merged into the option of the same text listed before it.
      if (byValue.has(value)) {
        continue;
      }

      const next: CustomFieldDropdownOption = { value };

      if (option.color) {
        next.color = option.color;
      }

      byValue.set(value, next);
      options.push(next);
    }

    for (const option of data.addOptions || []) {
      if (byValue.has(option.value)) {
        continue;
      }

      const next: CustomFieldDropdownOption = { value: option.value };

      if (option.color) {
        next.color = option.color;
      }

      byValue.set(option.value, next);
      options.push(next);
      changed = true;
    }

    return { options, changed };
  };

export type GetCustomFieldOptionValuesFunction = (
  serializedOptions: unknown,
) => Array<string>;

// A field's options, as the values records store.
export const getCustomFieldOptionValues: GetCustomFieldOptionValuesFunction = (
  serializedOptions: unknown,
): Array<string> => {
  return parseCustomFieldDropdownOptions(serializedOptions).map(
    (option: CustomFieldDropdownOption): string => {
      return option.value;
    },
  );
};

/*
 * How many records hold each value of one field, as the server counts them
 * (POST /<custom field route>/:id/option-usage): what the dashboard's option
 * editor says a rename or a removal will touch.
 */
export interface CustomFieldOptionUsageValue {
  value: string;
  count: number;
}

/*
 * A field of another resource that copies its value from this one: renaming
 * an option here renames it there too, and an option added here is added
 * there (CustomFieldMappingCatalog).
 */
export interface CustomFieldOptionCopier {
  // The copying field's resource, as the catalog names it: "Incident".
  resource: string;
  // The copying field's name.
  fieldName: string;
}

/*
 * What a field's records are called, by the model names ModelTable uses
 * ("Incident", "Incidents"), for the option editor's counts.
 */
export interface CustomFieldRecordName {
  singular: string;
  plural: string;
}

export interface CustomFieldOptionUsage {
  // Every value the field's records hold, the most held first.
  values: Array<CustomFieldOptionUsageValue>;
  copiedBy: Array<CustomFieldOptionCopier>;
}

export type ReadCustomFieldOptionUsageFunction = (
  value: unknown,
) => CustomFieldOptionUsage;

/**
 * The usage answer as the dashboard reads it: anything malformed in it is
 * dropped rather than trusted, so a bad answer only means fewer counts.
 */
export const readCustomFieldOptionUsage: ReadCustomFieldOptionUsageFunction = (
  value: unknown,
): CustomFieldOptionUsage => {
  const usage: CustomFieldOptionUsage = { values: [], copiedBy: [] };

  if (!isPlainObject(value)) {
    return usage;
  }

  if (Array.isArray(value["values"])) {
    for (const entry of value["values"]) {
      if (
        isPlainObject(entry) &&
        typeof entry["value"] === "string" &&
        typeof entry["count"] === "number" &&
        Number.isFinite(entry["count"]) &&
        entry["count"] >= 0
      ) {
        usage.values.push({
          value: entry["value"],
          count: Math.floor(entry["count"]),
        });
      }
    }
  }

  if (Array.isArray(value["copiedBy"])) {
    for (const entry of value["copiedBy"]) {
      if (
        isPlainObject(entry) &&
        typeof entry["resource"] === "string" &&
        typeof entry["fieldName"] === "string"
      ) {
        usage.copiedBy.push({
          resource: entry["resource"],
          fieldName: entry["fieldName"],
        });
      }
    }
  }

  return usage;
};

export type GetCustomFieldOptionUsageCountFunction = (
  usage: CustomFieldOptionUsage | null | undefined,
  value: string,
) => number | undefined;

/**
 * How many records hold this value; undefined when the counts are not known
 * (still loading, or could not be read) - which is not the same as none.
 */
export const getCustomFieldOptionUsageCount: GetCustomFieldOptionUsageCountFunction =
  (
    usage: CustomFieldOptionUsage | null | undefined,
    value: string,
  ): number | undefined => {
    if (!usage) {
      return undefined;
    }

    const entry: CustomFieldOptionUsageValue | undefined = usage.values.find(
      (candidate: CustomFieldOptionUsageValue): boolean => {
        return candidate.value === value;
      },
    );

    return entry ? entry.count : 0;
  };

export type GetCustomFieldValuesNotOfferedFunction = (data: {
  // The field's options, serialized.
  dropdownOptions: unknown;
  // What a record holds for the field: a value, or a list of them.
  value: unknown;
}) => Array<string | number | boolean>;

/**
 * The values a record holds for a dropdown field that the field does not
 * offer - an option taken out since, or a value written over the API - in
 * the order the record lists them, once each, as stored. Shown as "no longer
 * an option" rather than hidden, so nobody takes the field for empty and
 * nobody loses the value by saving another field. A field with no options
 * at all offers nothing to compare with: nothing is reported for it.
 */
export const getCustomFieldValuesNotOffered: GetCustomFieldValuesNotOfferedFunction =
  (data: {
    dropdownOptions: unknown;
    value: unknown;
  }): Array<string | number | boolean> => {
    const options: Set<string> = new Set<string>(
      getCustomFieldOptionValues(data.dropdownOptions),
    );

    if (options.size === 0) {
      return [];
    }

    const held: Array<unknown> = Array.isArray(data.value)
      ? data.value
      : [data.value];

    const notOffered: Array<string | number | boolean> = [];
    const seen: Set<string> = new Set<string>();

    for (const entry of held) {
      if (!isOptionScalar(entry) || entry === "") {
        continue;
      }

      const text: string = String(entry);

      if (options.has(text) || seen.has(text)) {
        continue;
      }

      seen.add(text);
      notOffered.push(entry as string | number | boolean);
    }

    return notOffered;
  };

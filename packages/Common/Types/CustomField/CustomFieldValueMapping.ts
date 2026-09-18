import { JSONObject } from "../JSON";
import CustomFieldType from "./CustomFieldType";
import {
  CustomFieldDropdownOption,
  parseCustomFieldDropdownOptions,
} from "./CustomFieldDropdownOption";

/*
 * The pure half of "custom field value mapping" (issue #3549): given the
 * values a target's source records hold for one field, what — if anything —
 * should be written onto the target?
 *
 * Everything here is deliberately free of database and React imports so the
 * rules can be unit-tested directly and so both the server resolver and the
 * settings form can share one definition of "compatible" and "empty".
 *
 * THE ONE INVARIANT WORTH STATING UP FRONT: mapping is never destructive. It
 * writes a value that exists on a source, or it writes nothing at all. It has
 * no code path that clears a key. That is what makes turning a mapping on
 * safe on a project that has been filling the field in by hand for a year:
 * the worst case is that some rows are not filled yet, never that a value is
 * lost. The cost is that clearing the source does not clear the copies — said
 * plainly in the settings help text rather than papered over.
 */

/*
 * A single configured mapping, narrowed to what the resolver needs.
 * `targetFieldName` and `sourceFieldName` are the definitions' `name` values,
 * because the `customFields` bag is keyed by name (see the header comment on
 * Common/UI/Components/ModelTable/CustomFieldColumns.tsx).
 */
export interface CustomFieldValueMapping {
  targetFieldName: string;
  sourceFieldName: string;
  targetFieldType?: CustomFieldType | undefined;
}

export type IsCustomFieldValueEmptyFunction = (value: unknown) => boolean;

/*
 * The house definition of "this field holds nothing", lifted verbatim from
 * InventoryEntityRegistry.hasCustomFieldValues so the two cannot drift.
 *
 * Note what is NOT empty: `false` and `0`. A Boolean custom field set to No
 * stores a real `false` (BasicForm forces it when unset), and a Number field
 * set to zero stores "0" — a falsy check would treat both as absent and, in a
 * design that cleared absent values, would invert their meaning.
 */
export const isCustomFieldValueEmpty: IsCustomFieldValueEmptyFunction = (
  value: unknown,
): boolean => {
  if (value === undefined || value === null || value === "") {
    return true;
  }

  return Array.isArray(value) && value.length === 0;
};

/*
 * Canonical form used to decide whether two source values are "the same
 * answer". Arrays are order-insensitive because a MultiSelectDropdown holding
 * ["a","b"] and ["b","a"] is one value, and treating them as two would make an
 * incident's mapped field oscillate between syncs.
 */
type CanonicalizeFunction = (value: unknown) => string;

const canonicalize: CanonicalizeFunction = (value: unknown): string => {
  if (Array.isArray(value)) {
    return JSON.stringify(
      [...value]
        .map((entry: unknown) => {
          return String(entry);
        })
        .sort(),
    );
  }

  return JSON.stringify(value ?? null);
};

export interface ResolvedCustomFieldValue {
  /*
   * False means "write nothing". It covers every one of: no source record,
   * no source value, and sources that disagree. The caller must not turn a
   * false into a delete.
   */
  hasValue: boolean;
  value?: unknown;
}

export type ResolveMappedCustomFieldValueFunction = (data: {
  /*
   * One entry per source record, in whatever order the caller found them.
   * Order must not affect the answer — the ManyToMany monitor relations carry
   * no ORDER BY, so "the first monitor" is not a stable concept.
   */
  sourceValues: Array<unknown>;
  targetFieldType?: CustomFieldType | undefined;
}) => ResolvedCustomFieldValue;

/*
 * How several sources collapse into one value.
 *
 * - Nothing non-empty -> write nothing.
 * - All non-empty sources agree -> that value.
 * - They disagree, and the target is multi-select -> the sorted union, which
 *   is the honest answer for a field that can hold several values and mirrors
 *   what IncidentLabelRuleEngineService does with labels.
 * - They disagree and the target holds one value -> write nothing. Picking a
 *   winner would be arbitrary, and an arbitrary winner over an unordered
 *   relation is a value that changes on its own.
 */
export const resolveMappedCustomFieldValue: ResolveMappedCustomFieldValueFunction =
  (data: {
    sourceValues: Array<unknown>;
    targetFieldType?: CustomFieldType | undefined;
  }): ResolvedCustomFieldValue => {
    const presentValues: Array<unknown> = data.sourceValues.filter(
      (value: unknown) => {
        return !isCustomFieldValueEmpty(value);
      },
    );

    if (presentValues.length === 0) {
      return { hasValue: false };
    }

    const distinct: Map<string, unknown> = new Map<string, unknown>();

    for (const value of presentValues) {
      const key: string = canonicalize(value);

      if (!distinct.has(key)) {
        distinct.set(key, value);
      }
    }

    if (distinct.size === 1) {
      return { hasValue: true, value: presentValues[0] };
    }

    if (data.targetFieldType === CustomFieldType.MultiSelectDropdown) {
      const union: Set<string> = new Set<string>();

      for (const value of presentValues) {
        if (Array.isArray(value)) {
          for (const entry of value) {
            union.add(String(entry));
          }
        } else {
          union.add(String(value));
        }
      }

      return { hasValue: true, value: [...union].sort() };
    }

    return { hasValue: false };
  };

export interface MergedCustomFields {
  customFields: JSONObject;
  /*
   * False lets every caller skip the write entirely — which is what keeps a
   * monitor edit from issuing an UPDATE against thousands of rows that
   * already hold the right answer.
   */
  hasChanged: boolean;
}

export type MergeMappedCustomFieldValuesFunction = (data: {
  existingCustomFields: JSONObject | undefined | null;
  /* Keyed by the TARGET field name. Only keys present here are touched. */
  resolvedValues: JSONObject;
}) => MergedCustomFields;

/*
 * Fold resolved values into a bag, leaving every other key exactly as it was.
 * Returned bag is always a new object: callers write it straight into a
 * `customFields` column, and sharing the caller's object would let a later
 * mutation change a row that was already persisted.
 */
export const mergeMappedCustomFieldValues: MergeMappedCustomFieldValuesFunction =
  (data: {
    existingCustomFields: JSONObject | undefined | null;
    resolvedValues: JSONObject;
  }): MergedCustomFields => {
    const merged: JSONObject = {
      ...((data.existingCustomFields as JSONObject) || {}),
    };

    let hasChanged: boolean = false;

    for (const targetFieldName of Object.keys(data.resolvedValues)) {
      const nextValue: unknown = data.resolvedValues[targetFieldName];

      if (canonicalize(merged[targetFieldName]) === canonicalize(nextValue)) {
        continue;
      }

      merged[targetFieldName] = nextValue as JSONObject[string];
      hasChanged = true;
    }

    return { customFields: merged, hasChanged: hasChanged };
  };

export type GetCustomFieldMappingCompatibilityErrorFunction = (data: {
  targetFieldType?: CustomFieldType | undefined;
  sourceFieldType?: CustomFieldType | undefined;
  targetDropdownOptions?: string | undefined;
  sourceDropdownOptions?: string | undefined;
  sourceFieldName: string;
}) => string | null;

/*
 * Why both sides are checked, and why dropdown OPTIONS are checked too:
 *
 * Nothing on the server validates a custom field value against its
 * definition, so a mapped value that is not one of the target's options is
 * accepted, stored, rendered as an uncoloured badge, and — because the facet
 * chip's option list is built from the TARGET definition — cannot be filtered
 * for. Copying "AWS" out of a monitor dropdown into an alert dropdown offering
 * only "Acme"/"Globex" produces exactly that. Catching it when the mapping is
 * saved is the only moment a human is present to fix it.
 *
 * A field whose type is unset is rejected rather than assumed: the column is
 * nullable, and `undefined === undefined` would otherwise let any two
 * untyped fields map onto each other and any value flow between them.
 */
export const getCustomFieldMappingCompatibilityError: GetCustomFieldMappingCompatibilityErrorFunction =
  (data: {
    targetFieldType?: CustomFieldType | undefined;
    sourceFieldType?: CustomFieldType | undefined;
    targetDropdownOptions?: string | undefined;
    sourceDropdownOptions?: string | undefined;
    sourceFieldName: string;
  }): string | null => {
    if (!data.targetFieldType) {
      return "Please choose a field type before mapping this field's value from another resource.";
    }

    if (!data.sourceFieldType) {
      return `The source field "${data.sourceFieldName}" does not have a field type set. Set its field type before mapping from it.`;
    }

    if (data.targetFieldType !== data.sourceFieldType) {
      return `This field is a ${data.targetFieldType} field, but "${data.sourceFieldName}" is a ${data.sourceFieldType} field. Map from a field of the same type.`;
    }

    const isDropdown: boolean =
      data.targetFieldType === CustomFieldType.Dropdown ||
      data.targetFieldType === CustomFieldType.MultiSelectDropdown;

    if (!isDropdown) {
      return null;
    }

    const targetOptions: Set<string> = new Set<string>(
      parseCustomFieldDropdownOptions(data.targetDropdownOptions).map(
        (option: CustomFieldDropdownOption) => {
          return option.value;
        },
      ),
    );

    const missingOptions: Array<string> = parseCustomFieldDropdownOptions(
      data.sourceDropdownOptions,
    )
      .map((option: CustomFieldDropdownOption) => {
        return option.value;
      })
      .filter((value: string) => {
        return !targetOptions.has(value);
      });

    if (missingOptions.length === 0) {
      return null;
    }

    return `"${data.sourceFieldName}" can hold ${missingOptions
      .map((option: string) => {
        return `"${option}"`;
      })
      .join(
        ", ",
      )}, which this field does not offer. Add those options here, or map from a different field.`;
  };

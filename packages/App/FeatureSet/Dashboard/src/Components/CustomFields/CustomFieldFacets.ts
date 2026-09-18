import {
  DATE_FACET_OPERATORS,
  FacetKind,
  FilterChipDropdownOption,
  FilterOperator,
  NUMBER_FACET_OPERATORS,
  OPTION_FACET_OPERATORS,
  TEXT_FACET_OPERATORS,
} from "../ResourceOwners/FilterChipDropdownTypes";
import { ResourceFacet } from "../ResourceOwners/ResourceFacet";
import { buildFacetDateRangeQuery } from "../ResourceOwners/FacetDateRange";
import EndsWith from "Common/Types/BaseDatabase/EndsWith";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import LessThanOrEqual from "Common/Types/BaseDatabase/LessThanOrEqual";
import NotContains from "Common/Types/BaseDatabase/NotContains";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Search from "Common/Types/BaseDatabase/Search";
import StartsWith from "Common/Types/BaseDatabase/StartsWith";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import {
  CustomFieldDropdownOption,
  parseCustomFieldDropdownOptions,
} from "Common/Types/CustomField/CustomFieldDropdownOption";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { CustomFieldDefinition } from "Common/Types/CustomField/CustomFieldDefinition";

/*
 * Custom fields as chips in the facet bar.
 *
 * A project defines its own categories — Team, Region, Ticket, Impacted Users —
 * and until now could see them in a table column but not filter by them, which
 * is the thing people actually want to do with a category. These chips sit
 * beside State, Severity and Labels and behave the same way.
 *
 * Where this differs from every other facet: the values do not live in a column
 * of their own. They live under the field's *name* inside one `customFields`
 * jsonb column, so every chip on the bar writes the same query field. Two
 * consequences run through this whole module:
 *
 *  - each chip's query value is an *object* keyed by the field name, and the
 *    hook ANDs them together through `mergeQueryValue` rather than letting the
 *    last one win (see ResourceFacet.mergeQueryValue);
 *
 *  - "is empty" has to mean "this key is unset", not "the column is null", so
 *    the chips claim `handlesValuelessOperators` and build that predicate
 *    themselves.
 *
 * Deliberately free of React and of the API client, like DeviceFacets: the
 * definitions are fetched by the hook next door, while the mapping from "what
 * the chip says" to "what the database is asked" lives here where it can be
 * pinned in tests.
 */

/**
 * Namespaces a chip's key so a custom field called "labels" cannot collide with
 * the bar's own Labels chip — and so the settle-time reconciliation in
 * useResourceOwners can recognise a selection whose definition has since been
 * renamed or deleted.
 */
export const CUSTOM_FIELD_FACET_KEY_PREFIX: string = "customField:";

/** The one column every custom field chip filters on. */
export const CUSTOM_FIELD_QUERY_FIELD: string = "customFields";

export type GetCustomFieldFacetKeyFunction = (name: string) => string;

export const getCustomFieldFacetKey: GetCustomFieldFacetKeyFunction = (
  name: string,
): string => {
  return `${CUSTOM_FIELD_FACET_KEY_PREFIX}${name}`;
};

export type GetCustomFieldNameFromFacetKeyFunction = (
  key: string,
) => string | null;

export const getCustomFieldNameFromFacetKey: GetCustomFieldNameFromFacetKeyFunction =
  (key: string): string | null => {
    if (!key.startsWith(CUSTOM_FIELD_FACET_KEY_PREFIX)) {
      return null;
    }

    const name: string = key.slice(CUSTOM_FIELD_FACET_KEY_PREFIX.length);

    return name.length > 0 ? name : null;
  };

/**
 * Is this definition one of the two date types?
 *
 * Both store an ISO-8601 UTC string — the shared date `Input` normalises every
 * `date` and `datetime-local` entry through `OneUptimeDate.toString()` before
 * it reaches the `customFields` bag — and differ only in whether the time of
 * day is part of the answer.
 */
export type IsDateCustomFieldFunction = (
  definition: CustomFieldDefinition,
) => boolean;

export const isDateCustomField: IsDateCustomFieldFunction = (
  definition: CustomFieldDefinition,
): boolean => {
  return (
    definition.customFieldType === CustomFieldType.Date ||
    definition.customFieldType === CustomFieldType.DateTime
  );
};

/**
 * The chip kind a definition gets.
 *
 * A dropdown with no options configured falls back to a text chip rather than
 * rendering an empty picker: the field is real and has values in it, so
 * offering nothing to choose from would be worse than letting the user type.
 */
export type GetCustomFieldFacetKindFunction = (
  definition: CustomFieldDefinition,
) => FacetKind;

export const getCustomFieldFacetKind: GetCustomFieldFacetKindFunction = (
  definition: CustomFieldDefinition,
): FacetKind => {
  if (definition.customFieldType === CustomFieldType.Number) {
    return "number";
  }

  if (definition.customFieldType === CustomFieldType.Boolean) {
    return "options";
  }

  if (isDateCustomField(definition)) {
    return "dateRange";
  }

  if (
    definition.customFieldType === CustomFieldType.Dropdown ||
    definition.customFieldType === CustomFieldType.MultiSelectDropdown
  ) {
    return parseCustomFieldDropdownOptions(definition.dropdownOptions).length >
      0
      ? "options"
      : "text";
  }

  return "text";
};

/**
 * A boolean custom field is stored as a real JSON boolean, and these are the
 * two values it can hold. Labelled the way the table column renders them so
 * the chip and the cell agree.
 */
export const BOOLEAN_CUSTOM_FIELD_OPTIONS: Array<FilterChipDropdownOption> = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

export type GetCustomFieldFacetOptionsFunction = (
  definition: CustomFieldDefinition,
) => Array<FilterChipDropdownOption>;

export const getCustomFieldFacetOptions: GetCustomFieldFacetOptionsFunction = (
  definition: CustomFieldDefinition,
): Array<FilterChipDropdownOption> => {
  if (definition.customFieldType === CustomFieldType.Boolean) {
    return BOOLEAN_CUSTOM_FIELD_OPTIONS;
  }

  /*
   * Colours come along: a dropdown option that renders as an amber badge in
   * the table should be the same amber in the picker, or the two read as
   * different vocabularies.
   */
  return parseCustomFieldDropdownOptions(definition.dropdownOptions).map(
    (option: CustomFieldDropdownOption): FilterChipDropdownOption => {
      return {
        value: option.value,
        label: option.value,
        color: option.color,
      };
    },
  );
};

export type GetCustomFieldFacetOperatorsFunction = (
  definition: CustomFieldDefinition,
) => Array<FilterOperator>;

export const getCustomFieldFacetOperators: GetCustomFieldFacetOperatorsFunction =
  (definition: CustomFieldDefinition): Array<FilterOperator> => {
    const kind: FacetKind = getCustomFieldFacetKind(definition);

    if (kind === "number") {
      return NUMBER_FACET_OPERATORS;
    }

    if (kind === "dateRange") {
      return DATE_FACET_OPERATORS;
    }

    if (kind === "text") {
      return TEXT_FACET_OPERATORS;
    }

    return OPTION_FACET_OPERATORS;
  };

type IsMultiSelectFunction = (definition: CustomFieldDefinition) => boolean;

const isMultiSelectDefinition: IsMultiSelectFunction = (
  definition: CustomFieldDefinition,
): boolean => {
  return (
    definition.customFieldType === CustomFieldType.MultiSelectDropdown &&
    getCustomFieldFacetKind(definition) === "options"
  );
};

type ToFacetValueFunction = (
  definition: CustomFieldDefinition,
  value: string,
) => string | number | boolean;

/**
 * Restore the value's original JSON type where the definition tells us what it
 * was. Chip selections are strings — that is the bar's universal encoding —
 * but a boolean field holds `true`, not `"true"`, and a match against an array
 * of booleans is a containment check against `[true]`.
 */
const toFacetValue: ToFacetValueFunction = (
  definition: CustomFieldDefinition,
  value: string,
): string | number | boolean => {
  if (definition.customFieldType === CustomFieldType.Boolean) {
    return value === "true";
  }

  return value;
};

export interface CustomFieldFacetQueryInput {
  definition: CustomFieldDefinition;
  values: Array<string>;
  operator: FilterOperator;
}

export type BuildCustomFieldFacetQueryFunction = (
  input: CustomFieldFacetQueryInput,
) => JSONObject | undefined;

/**
 * The query value one chip contributes: an object holding this field's
 * predicate under its own name, ready to be merged with every other chip's.
 *
 * `undefined` means "do not constrain" — nothing selected, or a value this
 * operator cannot use. Returning an object with an empty predicate instead
 * would filter the list by something the chip is not showing.
 */
const buildCustomFieldFacetQuery: BuildCustomFieldFacetQueryFunction = (
  input: CustomFieldFacetQueryInput,
): JSONObject | undefined => {
  const { definition, operator } = input;
  const name: string = definition.name;

  if (!name) {
    return undefined;
  }

  type WrapFunction = (value: unknown) => JSONObject;

  const wrap: WrapFunction = (value: unknown): JSONObject => {
    return { [name]: value } as JSONObject;
  };

  /*
   * A date field delegates the whole vocabulary — including is_empty and
   * is_not_empty — to the shared range builder, so a custom field date and a
   * real date column answer "is before the 5th" identically. Only the wrapping
   * is ours.
   *
   * The comparison lands on text rather than on a timestamp, and is correct
   * because of what is stored: the shared date `Input` normalises every entry
   * through `OneUptimeDate.toString()` (i.e. `toISOString()`), and ISO-8601 is
   * ordered identically as text and as an instant. `JSONColumnQuery` compares
   * a non-numeric operand as text for exactly this reason.
   *
   * `undefined` comes back for a half-entered range and for `is_not`, which a
   * date chip does not offer; both mean "do not constrain this field".
   */
  if (isDateCustomField(definition)) {
    const dateQuery: unknown = buildFacetDateRangeQuery(
      input.values,
      operator,
      {
        isDateTime: definition.customFieldType === CustomFieldType.DateTime,
      },
    );

    return dateQuery === undefined ? undefined : wrap(dateQuery);
  }

  if (operator === "is_empty") {
    return wrap(new IsNull());
  }

  if (operator === "is_not_empty") {
    return wrap(new NotNull());
  }

  const values: Array<string> = (input.values || []).filter((value: string) => {
    return typeof value === "string" && value.trim() !== "";
  });

  if (values.length === 0) {
    return undefined;
  }

  const first: string = values[0]!.trim();

  if (operator === "contains") {
    return wrap(new Search(first));
  }

  if (operator === "not_contains") {
    return wrap(new NotContains(first));
  }

  if (operator === "starts_with") {
    return wrap(new StartsWith(first));
  }

  if (operator === "ends_with") {
    return wrap(new EndsWith(first));
  }

  if (
    operator === "greater_than" ||
    operator === "greater_than_or_equal" ||
    operator === "less_than" ||
    operator === "less_than_or_equal"
  ) {
    const numeric: number = Number(first);

    /*
     * The number chip's input keeps this from happening, but a hand-edited URL
     * does not. A comparison against NaN would compile to a predicate that
     * matches nothing, with a chip on screen claiming otherwise.
     */
    if (!Number.isFinite(numeric)) {
      return undefined;
    }

    if (operator === "greater_than") {
      return wrap(new GreaterThan(numeric));
    }

    if (operator === "greater_than_or_equal") {
      return wrap(new GreaterThanOrEqual(numeric));
    }

    if (operator === "less_than") {
      return wrap(new LessThan(numeric));
    }

    return wrap(new LessThanOrEqual(numeric));
  }

  const isMulti: boolean = isMultiSelectDefinition(definition);

  if (operator === "is_not") {
    if (isMulti) {
      return wrap(
        new IncludesNone(
          values.map((value: string) => {
            return value;
          }),
        ),
      );
    }

    return wrap(new NotEqual(first));
  }

  /*
   * "is". A multi-select chip means "holds any of these"; a single-select
   * chip means "equals this". The server treats a bare value as equality and
   * matches it whether the stored value is a scalar or sits inside an array,
   * so a field switched from single- to multi-select keeps filtering.
   */
  if (isMulti) {
    return wrap(new Includes(values));
  }

  return wrap(toFacetValue(definition, first));
};

export { buildCustomFieldFacetQuery };

export type MergeCustomFieldQueryValueFunction = (
  existing: unknown,
  incoming: unknown,
) => unknown;

/**
 * AND two chips' contributions to the `customFields` column.
 *
 * Both sides are plain objects keyed by field name, so the merge is a shallow
 * spread — and because the chips are built from a deterministically sorted
 * definition list, the merged object's key order is stable across renders.
 * That matters: the table compares `JSON.stringify(query)` to decide whether
 * to refetch, so an unstable order would loop.
 */
export const mergeCustomFieldQueryValue: MergeCustomFieldQueryValueFunction = (
  existing: unknown,
  incoming: unknown,
): unknown => {
  /*
   * Prototype-checked, not just `typeof === "object"`. Every query operator
   * (IsNull, Includes, Search, ...) is also an object with no own enumerable
   * properties, so a looser check would spread one into the accumulator, add
   * nothing, and silently drop the constraint it carried.
   */
  const isPlainObject: (value: unknown) => boolean = (
    value: unknown,
  ): boolean => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const prototype: unknown = Object.getPrototypeOf(value);

    return prototype === Object.prototype || prototype === null;
  };

  if (!isPlainObject(existing) || !isPlainObject(incoming)) {
    /*
     * Something other than a custom field chip wrote this column — a page's
     * own `query` prop, say. Its constraint wins rather than being silently
     * blended into a shape it did not choose.
     */
    return incoming;
  }

  return {
    ...(existing as JSONObject),
    ...(incoming as JSONObject),
  };
};

export type BuildCustomFieldFacetsFunction = (
  definitions: Array<CustomFieldDefinition>,
) => Array<ResourceFacet>;

/**
 * One chip per custom field definition, in the order the definitions arrive
 * (which `getCustomFieldDefinitions` has already sorted by name).
 */
export const buildCustomFieldFacets: BuildCustomFieldFacetsFunction = (
  definitions: Array<CustomFieldDefinition>,
): Array<ResourceFacet> => {
  return (definitions || [])
    .filter((definition: CustomFieldDefinition) => {
      return Boolean(definition && definition.name);
    })
    .map((definition: CustomFieldDefinition): ResourceFacet => {
      const kind: FacetKind = getCustomFieldFacetKind(definition);
      const isMulti: boolean = isMultiSelectDefinition(definition);

      return {
        key: getCustomFieldFacetKey(definition.name),
        label: definition.name,
        type: kind,
        icon:
          kind === "number"
            ? IconProp.Hashtag
            : kind === "dateRange"
              ? IconProp.Calendar
              : kind === "text"
                ? IconProp.Text
                : IconProp.List,
        isMultiSelect: isMulti,
        options:
          kind === "options"
            ? getCustomFieldFacetOptions(definition)
            : undefined,
        searchPlaceholder:
          kind === "options"
            ? `Search ${definition.name}...`
            : `Enter ${definition.name}`,
        supportedOperators: getCustomFieldFacetOperators(definition),
        queryField: CUSTOM_FIELD_QUERY_FIELD,
        /*
         * Every chip writes `customFields`, so without these two the last chip
         * would overwrite the rest and "is empty" would ask about the whole
         * column instead of this one key.
         */
        mergeQueryValue: mergeCustomFieldQueryValue,
        handlesValuelessOperators: true,
        toQueryValue: (
          values: Array<string>,
          operator: FilterOperator,
        ): unknown => {
          return buildCustomFieldFacetQuery({
            definition: definition,
            values: values,
            operator: operator,
          });
        },
      };
    });
};

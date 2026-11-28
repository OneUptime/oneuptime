import {
  FacetKind,
  FilterChipDropdownOption,
  FilterOperator,
} from "./FilterChipDropdownTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import type FilterGroups from "Common/Types/BaseDatabase/FilterGroups";
import type LinkedTo from "Common/Types/BaseDatabase/LinkedTo";

/*
 * The React-free half of the facet bar's contract.
 *
 * `ResourceFacet` lives here rather than in useResourceOwners.tsx for the same
 * reason FilterChipDropdownTypes does: a module that only *describes* a facet
 * — the custom field chips, the device chips — has to be importable from
 * App/Tests, and App's compile has no React in it. useResourceOwners re-exports
 * the interface, so every existing `import { ResourceFacet } from
 * "./useResourceOwners"` keeps working.
 */

export interface ResourceFacet {
  /** Internal state key; also the default query field name. */
  key: string;
  /** Chip label (e.g. "Status", "Type"). */
  label: string;
  /**
   * What the chip's popover holds. Defaults to "options" — a searchable option
   * list. Use "dateRange" for a date column, where there is no option list to
   * offer and the useful questions ("not seen since last Tuesday", "between the
   * 1st and the 5th") are only expressible by typing a date. Use "text" or
   * "number" for a free-form value the user types, where the set of values is
   * whatever anyone has ever entered and so cannot be listed.
   *
   * A "dateRange" facet stores its selection in FacetDateRange's encoding and
   * ignores `options` / `fetchOptions` / `loadOptions`; so do "text" and
   * "number", which store the typed value as a single-element array.
   */
  type?: FacetKind | undefined;
  /** Icon shown on the empty chip. */
  icon?: IconProp | undefined;
  /** Allow selecting multiple values. Defaults to false. */
  isMultiSelect?: boolean | undefined;
  /** Hint shown inside the popover search box. */
  searchPlaceholder?: string | undefined;
  /**
   * The hint is in the reader's words already - a sentence around a custom
   * field's name - so the chips draw it as given (#7682).
   */
  isSearchPlaceholderTranslated?: boolean | undefined;
  /** Static option list (use either this or `fetchOptions` / `loadOptions`). */
  options?: Array<FilterChipDropdownOption> | undefined;
  /**
   * Dynamic option list, fetched once on mount. Receives the current
   * project's id. Suitable for bounded option sets (state, severity,
   * status — typically <100 rows).
   */
  fetchOptions?:
    | ((projectId: ObjectID) => Promise<Array<FilterChipDropdownOption>>)
    | undefined;
  /**
   * Async loader for unbounded / very large option sets (e.g. a Monitor
   * picker on a project with thousands of monitors). The chip calls this
   * on open and on each (debounced) keystroke, so the server does the
   * heavy lifting. When set, `options` / `fetchOptions` are ignored.
   */
  loadOptions?:
    | ((
        projectId: ObjectID,
        searchTerm: string,
      ) => Promise<Array<FilterChipDropdownOption>>)
    | undefined;
  /**
   * Companion to `loadOptions`. Resolves a set of previously-selected
   * values (e.g. from a saved view) into options so the chip can show
   * proper labels even when the values aren't in the current search page.
   */
  resolveOptions?:
    | ((
        projectId: ObjectID,
        values: Array<string>,
      ) => Promise<Array<FilterChipDropdownOption>>)
    | undefined;
  /**
   * Query field name. Defaults to `key`. Useful when the chip key differs
   * from the actual entity field (e.g. internal key "status" mapped to
   * `currentMonitorStatus`).
   */
  queryField?: string | undefined;
  /**
   * Convert selected raw string values into the query value. Defaults:
   * - multi-select: new Includes(values) (raw strings)
   * - single-select: values[0] (raw string)
   * Override for ObjectID-wrapped values or booleans:
   *   `(values) => values[0] === "true"`
   *   `(values) => new Includes(values.map((v) => new ObjectID(v)))`
   */
  toQueryValue?:
    | ((values: Array<string>, operator: FilterOperator) => unknown)
    | undefined;
  /**
   * Which operators this facet should expose in the chip dropdown.
   * Defaults to ["is", "is_not", "is_empty", "is_not_empty"], or to
   * DATE_FACET_OPERATORS for a "dateRange" facet.
   */
  supportedOperators?: Array<FilterOperator> | undefined;
  /**
   * Other facet keys this chip cannot be active alongside, because they write
   * the same column.
   *
   * `mergeFiltersIntoQuery` builds one object, so two chips over one field do
   * not AND — the later one simply overwrites the earlier, silently, while both
   * chips stay lit and claim to apply. Naming the conflict here makes activating
   * either of them clear the other, so the bar always shows the filter the table
   * is actually running.
   *
   * Declaring it on one side is enough; the hook reads it symmetrically.
   *
   * The alternative, for facets that write *different keys inside* one column,
   * is `mergeQueryValue` — those chips genuinely do AND and should stay lit
   * together.
   */
  exclusiveWith?: Array<string> | undefined;
  /**
   * Combine this facet's query value with whatever an earlier facet already
   * wrote at the same `queryField`. Without it the value overwrites — correct
   * for a facet that owns its column outright, wrong for the custom field
   * chips, which all write different keys inside one `customFields` column.
   *
   * Called only when something is already there, so an implementation never
   * has to handle an absent `existing`.
   */
  mergeQueryValue?:
    | ((existing: unknown, incoming: unknown) => unknown)
    | undefined;
  /**
   * Let `toQueryValue` handle "is empty" / "is not empty" itself instead of the
   * hook writing IsNull / NotNull at `queryField`.
   *
   * Required for a facet over a *key inside* a JSON column, where "empty" means
   * that key is unset — writing IsNull at the field would ask whether the whole
   * column is null, which is a different and almost always wrong question.
   */
  handlesValuelessOperators?: boolean | undefined;
  /**
   * For a facet over several relations at once, OR'd (the "Affected
   * Resources" chip: a list's monitors, services, hosts ...), or over a
   * relation kept in a table of its own (the Teams list's Member chip: a
   * team's TeamMember rows): its filter as the server answers it, in the
   * list's own query - one LinkedTo under "linkedTo"
   * (Common/Types/BaseDatabase/LinkedTo, #11073, #11211) - or null when the
   * selection filters nothing. Nothing is read first, so the list pages and
   * counts every record that matches, however many: a filter worked out by
   * reading the matching ids first held only the first 10,000 of them.
   *
   * When set, `toQueryValue` and `queryField` are ignored. A list's query
   * holds one such filter, so a list has one facet that sets it.
   */
  toLinkedTo?:
    | ((values: Array<string>, operator: FilterOperator) => LinkedTo | null)
    | undefined;
  /**
   * For a facet whose values each stand for a condition on several of the
   * record's own columns (a database's engine-metrics status: its collector
   * status and when one last reported), OR'd: its filter as the server
   * answers it, in the list's own query - one FilterGroups under
   * "filterGroups" (Common/Types/BaseDatabase/FilterGroups, #11211) - or
   * null when the selection filters nothing. Nothing is read first, so the
   * list pages and counts every record that matches, however many.
   *
   * When set, `toQueryValue` and `queryField` are ignored. A list's query
   * holds one such filter, so a list has one facet that sets it.
   */
  toFilterGroups?:
    | ((values: Array<string>, operator: FilterOperator) => FilterGroups | null)
    | undefined;
}

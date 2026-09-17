import {
  FacetKind,
  FilterChipDropdownOption,
  FilterOperator,
} from "./FilterChipDropdownTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";

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
   * For facets that filter across *multiple* relationship fields with OR
   * semantics (e.g. an "Affected Resources" chip spanning monitors / hosts /
   * services / dockerHosts / kubernetesClusters), supply this resolver. It
   * receives the current selection and returns the set of parent-row IDs
   * (e.g. incident IDs) that match. The hook unions these into an
   * `_id` filter, intersected with the owner filter when both are active.
   *
   * When set, `toQueryValue` and `queryField` are ignored — the facet
   * never writes directly to a column.
   */
  computeMatchingResourceIds?:
    | ((
        projectId: ObjectID,
        values: Array<string>,
        operator: FilterOperator,
      ) => Promise<Array<string>>)
    | undefined;
}

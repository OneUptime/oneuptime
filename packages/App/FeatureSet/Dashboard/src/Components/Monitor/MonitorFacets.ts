import { FacetTileSelection } from "../ResourceOwners/FacetTileSelection";
import { buildEntityFacetQuery } from "../ResourceOwners/FacetColumnQuery";
import { FilterOperator } from "../ResourceOwners/FilterChipDropdownTypes";

/*
 * The vocabulary of the monitor list's Template chip.
 *
 * A monitor template is edited once and pushed onto every monitor created from
 * it, so the question that follows every template edit is "which monitors did
 * that just change?". Answering it by opening monitors one at a time does not
 * survive a fleet of thousands, which is what this chip — and the Template
 * column beside it — exist to replace.
 *
 * Deliberately free of React and of the API client, the same way DeviceFacets
 * is: the chip itself is assembled in MonitorTable (which can call the API for
 * its option list), while the mapping from "what the chip says" to "what the
 * database is asked" lives here, where it can be pinned in tests. App's own
 * `tsc` has no React in it, so a module App/Tests imports must not reach one.
 */

/*
 * Shared by the all-monitors table's `saveFilterProps.tableId` and, through it,
 * the URL namespace its filter/facet/view state is persisted under. Named here
 * rather than on the page because a link built elsewhere in the product has to
 * address that namespace to land the list pre-filtered — see
 * MonitorListFacetRoute.
 */
export const ALL_MONITORS_TABLE_ID: string = "all-monitors-table";

export const MONITOR_TEMPLATE_FACET_KEY: string = "monitorTemplate";

/*
 * The foreign key, not the `monitorTemplate` relation. Two reasons, and both
 * are load-bearing:
 *
 *  - "is empty" then asks the column for NULL, which is the only way to list
 *    the monitors that came from no template at all — exactly the rows the
 *    Template column renders as "—".
 *
 *  - It is the same field the template page's own Linked Monitors table scopes
 *    itself by. `mergeFiltersIntoQuery` builds one object, so a chip writing
 *    this key would overwrite that scope rather than narrow it, and the page
 *    would quietly list another template's monitors. That is why MonitorTable
 *    drops the chip when its query already names this field — see
 *    isQueryScopedToMonitorTemplate.
 */
export const MONITOR_TEMPLATE_FACET_QUERY_FIELD: string = "monitorTemplateId";

/** The relation this table also selects, and the other spelling of the column. */
export const MONITOR_TEMPLATE_RELATION_FIELD: string = "monitorTemplate";

export type BuildMonitorTemplateFacetQueryFunction = (
  values: Array<string>,
  operator: FilterOperator,
) => unknown;

/**
 * The `monitorTemplateId` constraint behind a Template selection.
 *
 * Multi-select, because "which monitors came from either of these two
 * templates" is a real question when a template has been superseded; and
 * ObjectID-valued, because the column is a foreign key.
 */
export const buildMonitorTemplateFacetQuery: BuildMonitorTemplateFacetQueryFunction =
  (values: Array<string>, operator: FilterOperator): unknown => {
    return buildEntityFacetQuery(values, operator, true);
  };

export type IsQueryScopedToMonitorTemplateFunction = (
  query: unknown,
) => boolean;

/**
 * Is this table already showing one template's monitors?
 *
 * Derived from the query rather than from a prop a caller has to remember,
 * because the failure it prevents is silent: a Template chip on the template
 * page's own Linked Monitors table overwrites the page's scope, and the table
 * carries on claiming — in its title, and in the URL — to be listing the
 * template the user is looking at.
 */
export const isQueryScopedToMonitorTemplate: IsQueryScopedToMonitorTemplateFunction =
  (query: unknown): boolean => {
    if (!query || typeof query !== "object") {
      return false;
    }

    const record: Record<string, unknown> = query as Record<string, unknown>;

    for (const field of [
      MONITOR_TEMPLATE_FACET_QUERY_FIELD,
      MONITOR_TEMPLATE_RELATION_FIELD,
    ]) {
      if (
        Object.prototype.hasOwnProperty.call(record, field) &&
        record[field] !== undefined &&
        record[field] !== null
      ) {
        return true;
      }
    }

    return false;
  };

export type GetMonitorTemplateFacetSelectionFunction = (
  templateId: string,
) => FacetTileSelection;

/**
 * The chip state that means "monitors linked to this template".
 *
 * Shared by whatever links into the monitor list — today the template page's
 * Linked Monitors card — so the arriving list shows a real, editable chip
 * rather than a filter hidden under the table.
 */
export const getMonitorTemplateFacetSelection: GetMonitorTemplateFacetSelectionFunction =
  (templateId: string): FacetTileSelection => {
    return {
      facetKey: MONITOR_TEMPLATE_FACET_KEY,
      values: templateId ? [templateId] : [],
      operator: "is",
    };
  };

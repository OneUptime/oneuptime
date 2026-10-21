/*
 * All or Any - how a rule combines its filters - is only a choice once there
 * are two filters to combine. With none, a rule matches everything; with one,
 * it matches what that one filter matches, whichever is picked. So a screen
 * asks for it from the second filter on, and not before, and says it only
 * then:
 *
 *   - the rules' conditions builder (RuleCriteriaBuilder: "Match all /
 *     Match any") and its summary in the rule lists;
 *   - Match Condition, under the filters: a metric pipeline rule's, a
 *     workspace notification rule's and summary's, a monitor criteria's;
 *   - a monitor criteria's folded header, read-only view and evaluation
 *     log, and a workspace rule's conditions in the rules list.
 *
 * A form that hides it keeps the value the record holds - All for a new
 * one - and saves it, so nothing changes in what a rule matches.
 *
 * FilterConditionOnlyWithTwoFiltersGuard holds every form field and every
 * hand-drawn control that asks for a filter condition to this rule.
 */

// The fewest filters that make All and Any mean something different.
export const FILTERS_TO_COMBINE: number = 2;

type IsFilterConditionNeededFunction = (filters: unknown) => boolean;

/**
 * Whether a list of filters is long enough for All / Any to matter: two or
 * more. Anything that is not a list (a form that has not drawn its filters
 * yet) counts as none.
 */
export const isFilterConditionNeeded: IsFilterConditionNeededFunction = (
  filters: unknown,
): boolean => {
  return Array.isArray(filters) && filters.length >= FILTERS_TO_COMBINE;
};

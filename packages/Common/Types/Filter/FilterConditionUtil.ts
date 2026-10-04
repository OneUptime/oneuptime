/*
 * All or Any - how a rule combines its filters - is only a choice once there
 * are two filters to combine. With none, a rule matches everything; with one,
 * it matches what that one filter matches, whichever is picked. So a form
 * asks for it from the second filter on, and not before: the rules'
 * conditions builder (RuleCriteriaBuilder: "Match all / Match any") and a
 * metric pipeline rule's Filter Condition (Metrics > Settings > Pipeline
 * Rules). A form that hides it keeps its value - the column's default, All -
 * and sends it, so nothing changes in what a rule matches.
 *
 * FilterConditionOnlyWithTwoFiltersGuard holds every form field that asks
 * for a filter condition to this rule.
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

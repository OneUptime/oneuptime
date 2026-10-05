import FilterCondition from "Common/Types/Filter/FilterCondition";
import { isFilterConditionNeeded } from "Common/Types/Filter/FilterConditionUtil";
import { CriteriaFilter } from "Common/Types/Monitor/CriteriaFilter";
import {
  PluralTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * How many filters a monitor criteria has, as its folded header and its
 * folded Filters section say it: "1 filter", "3 filters (ANY)". All or Any
 * is named only once there are two filters to combine
 * (isFilterConditionNeeded) - with one, the criteria is met when that filter
 * is, whichever is picked.
 */

export const CRITERIA_FILTER_COUNT: PluralTemplate = {
  one: "{{count}} filter",
  other: "{{count}} filters",
};

export const CRITERIA_FILTER_COUNT_WITH_CONDITION: PluralTemplate = {
  one: "{{count}} filter ({{condition}})",
  other: "{{count}} filters ({{condition}})",
};

export const CRITERIA_FILTER_CONDITION_WORDS: Record<FilterCondition, string> =
  {
    [FilterCondition.All]: translationKey("ALL"),
    [FilterCondition.Any]: translationKey("ANY"),
  };

export const getCriteriaFilterCountText: (data: {
  translator: Translator;
  filters: Array<CriteriaFilter> | undefined;
  filterCondition: FilterCondition | undefined;
}) => string = (data: {
  translator: Translator;
  filters: Array<CriteriaFilter> | undefined;
  filterCondition: FilterCondition | undefined;
}): string => {
  const filterCount: number = data.filters?.length || 0;

  if (!isFilterConditionNeeded(data.filters)) {
    return data.translator.translatePlural(CRITERIA_FILTER_COUNT, filterCount);
  }

  // A criteria saved without a condition is evaluated as All.
  const condition: FilterCondition =
    data.filterCondition === FilterCondition.Any
      ? FilterCondition.Any
      : FilterCondition.All;

  return data.translator.translatePlural(
    CRITERIA_FILTER_COUNT_WITH_CONDITION,
    filterCount,
    {
      condition:
        data.translator.translateText(
          CRITERIA_FILTER_CONDITION_WORDS[condition],
        ) || CRITERIA_FILTER_CONDITION_WORDS[condition],
    },
  );
};

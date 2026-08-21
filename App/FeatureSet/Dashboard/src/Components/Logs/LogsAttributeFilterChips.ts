import Dictionary from "Common/Types/Dictionary";
import {
  DictionaryEntryValue,
  formatDictionaryValueForDisplay,
} from "Common/UI/Components/Dictionary/DictionaryFilterOperator";
import { ActiveFilter } from "Common/UI/Components/LogsViewer/types";

/*
 * The read-only chips the logs viewer shows for the attribute filters its
 * host page pinned in `logQuery.attributes` (a resource detail page, a
 * dashboard log chart, the log monitor's criteria preview).
 */

/*
 * OTEL resource keys read as machine names in a chip. Give the handful we
 * scope pages by the label a person would use.
 */
const ATTRIBUTE_DISPLAY_NAMES: Record<string, string> = {
  "resource.k8s.cluster.name": "Cluster",
  "resource.k8s.pod.name": "Pod",
  "resource.k8s.container.name": "Container",
  "resource.k8s.namespace.name": "Namespace",
};

type BuildAttributeFilterChipsFunction = (
  attributes: Dictionary<DictionaryEntryValue> | undefined,
) => Array<ActiveFilter>;

/**
 * Turn pinned attribute filters into read-only chips.
 *
 * The values are NOT all strings. An attribute filter row stores a bare
 * scalar only for the implicit `=`; every other operator stores an operator
 * instance (`Includes`, `Search`, `NotEqual`, ...) — see
 * `buildDictionaryValue`. Handing one of those to React as a child throws
 * "Objects are not valid as a React child (found: object with keys
 * {_values})", and since the log monitor's criteria modal renders this
 * preview inside itself, that error replaced the whole form with the generic
 * error card and left no way to reach Save. Every value goes through the
 * shared formatter so a chip is always text.
 */
export const buildAttributeFilterChips: BuildAttributeFilterChipsFunction = (
  attributes: Dictionary<DictionaryEntryValue> | undefined,
): Array<ActiveFilter> => {
  if (!attributes) {
    return [];
  }

  const chips: Array<ActiveFilter> = [];

  for (const [attributeKey, attributeValue] of Object.entries(attributes)) {
    const text: string = formatDictionaryValueForDisplay(attributeValue);

    chips.push({
      facetKey: `attributes.${attributeKey}`,
      value: text,
      displayKey: ATTRIBUTE_DISPLAY_NAMES[attributeKey] || attributeKey,
      displayValue: text,
      readOnly: true,
    });
  }

  return chips;
};

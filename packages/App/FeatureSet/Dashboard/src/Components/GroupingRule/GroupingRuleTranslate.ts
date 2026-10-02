import { GroupingRuleTranslateFunction } from "../../Utils/GroupingRule/GroupingRuleSetup";
import useTranslateValue from "Common/UI/Utils/Translation";
import { translateTemplate } from "Common/UI/Utils/TranslateTemplate";

/*
 * Translation for the grouping rule pages' copy, keyed by its English text
 * like the rest of the Dashboard. A sentence with a value in it is
 * translated whole, {{placeholder}} and all, and filled in afterwards (see
 * Common/UI/Utils/TranslateTemplate).
 */

/*
 * For the form's callbacks - a field's onChange or customValidation - which
 * run outside React.
 */
export const translateGroupingRuleText: GroupingRuleTranslateFunction = (
  text: string,
  values?: Record<string, string | number> | undefined,
): string => {
  return translateTemplate(text, values || {});
};

/*
 * For components: the same lookups, and a re-render when the reader switches
 * language.
 */
const useGroupingRuleTranslate: () => GroupingRuleTranslateFunction =
  (): GroupingRuleTranslateFunction => {
    const { translateString } = useTranslateValue();

    return (
      text: string,
      values?: Record<string, string | number> | undefined,
    ): string => {
      if (values) {
        return translateTemplate(text, values);
      }

      return translateString(text) ?? text;
    };
  };

export default useGroupingRuleTranslate;

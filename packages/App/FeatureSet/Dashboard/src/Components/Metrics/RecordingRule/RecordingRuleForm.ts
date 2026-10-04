import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { normalizeFormValue } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * CREATE A RECORDING RULE: ITS NAME AND WHAT IT COMPUTES, ON ONE PAGE.
 *
 * Metrics > Settings > Recording Rules and Traces > Settings > Recording
 * Rules used to open on a "Basic Info" step - the name, the output metric
 * line made from it, a description and an Enabled switch - and asked what
 * the rule computes only on a second step. Both are one page now:
 *
 *   - the name, with the output metric line under it (made from the name;
 *     the server makes it when the create leaves it out, GeneratedKeyField);
 *   - the definition: the sources, the expression over them and the
 *     optional group by - one editor;
 *   - the description and Enabled, on, folded under More fields: the header
 *     says in a sentence what the rule will do while they are left alone.
 *
 * So the page asks two things, the name and the definition, and a Next
 * between them only split the rule from its name (LongFormStepsGuard lists
 * both pages as one page on purpose; MetricAndRecordingRuleFormsGuard pins
 * the shape). On Edit the output metric name is an ordinary field under the
 * name: renaming a rule's metric is rare, but allowed.
 */

// What the folded section says while Enabled is on and nothing is typed.
export const RECORDING_RULE_DEFAULTS_SUMMARY: string = translationKey(
  "The rule writes its metric every minute, starting within a minute of being saved.",
);

/**
 * The sentence under the folded More fields header while its fields hold
 * their defaults - no description, Enabled on - or nothing once one is set:
 * the header's chips then say what ("Enabled: Off").
 */
export const getRecordingRuleAdvancedSummary: <TModel>(
  values: FormValues<TModel>,
) => Array<string> | undefined = <TModel>(
  values: FormValues<TModel>,
): Array<string> | undefined => {
  const formValues: Record<string, unknown> = (values || {}) as Record<
    string,
    unknown
  >;
  const description: unknown = formValues["description"];
  const isEnabled: unknown = normalizeFormValue(formValues["isEnabled"]);

  const hasDescription: boolean =
    typeof description === "string" && description.trim().length > 0;

  return hasDescription || isEnabled === false
    ? undefined
    : [RECORDING_RULE_DEFAULTS_SUMMARY];
};

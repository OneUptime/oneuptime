import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";

/*
 * The burn rate rule form's pure half, split out of BurnRateRules.tsx so it
 * can be read without React.
 *
 * The page is a React module; deciding whether a set of form values is a
 * legal rule, and saying what a rule declares, is neither React nor DOM.
 * App has no react by design (its package.json does not depend on it and CI
 * installs node_modules for Common and App only), so a node test that wants
 * these four functions must not reach the page to get them - importing it
 * fails twice over, once when jest cannot resolve react and once when tsc
 * pulls the whole component graph into App's program.
 * App/Tests/FeatureSetImportsStayReactFree.test.ts is the guard for that,
 * and it is what caught this.
 *
 * BurnRateRules.tsx re-exports all four names, so existing importers are
 * unchanged.
 */

/*
 * Client-side mirrors of ServiceLevelObjectiveBurnRateRuleService's
 * validators. The server compares the two windows and rejects
 * short >= long, but that only surfaced after a failed round-trip that
 * re-rendered the raw exception - and the windows are exactly the pair a
 * user is most likely to transpose.
 */
export type ValidateBurnRateWindowsFunction = (
  value: FormValues<ServiceLevelObjectiveBurnRateRule>,
) => string | null;

export const validateBurnRateWindows: ValidateBurnRateWindowsFunction = (
  value: FormValues<ServiceLevelObjectiveBurnRateRule>,
): string | null => {
  const longWindow: number = Number(value.longWindowInMinutes);
  const shortWindow: number = Number(value.shortWindowInMinutes);

  if (!isFinite(longWindow) || !isFinite(shortWindow)) {
    return null;
  }

  if (shortWindow >= longWindow) {
    return "The short window must be shorter than the long window.";
  }

  return null;
};

export type ValidateBurnRateThresholdFunction = (
  value: FormValues<ServiceLevelObjectiveBurnRateRule>,
) => string | null;

export const validateBurnRateThreshold: ValidateBurnRateThresholdFunction = (
  value: FormValues<ServiceLevelObjectiveBurnRateRule>,
): string | null => {
  const threshold: number = Number(value.burnRateThreshold);

  if (!isFinite(threshold) || threshold <= 0) {
    return "The burn rate threshold must be greater than 0.";
  }

  return null;
};

/*
 * A rule that declares nothing is rejected by
 * ServiceLevelObjectiveBurnRateRuleService.onBeforeCreate/onBeforeUpdate.
 * Mirrored here for the same reason the window and threshold validators are:
 * the server's rejection only surfaces after a failed round-trip that
 * re-renders the raw exception, and "turn the alert off, forget to turn the
 * incident on" is the obvious way into it.
 *
 * The toggles are read with the model's own defaults - alerts on, incidents
 * off - because ModelForm leaves a field the user never touched undefined.
 */
export type ValidateBurnRateOutputsFunction = (
  value: FormValues<ServiceLevelObjectiveBurnRateRule>,
) => string | null;

export const validateBurnRateOutputs: ValidateBurnRateOutputsFunction = (
  value: FormValues<ServiceLevelObjectiveBurnRateRule>,
): string | null => {
  const shouldCreateAlert: boolean = value.shouldCreateAlert !== false;
  const shouldCreateIncident: boolean = value.shouldCreateIncident === true;

  if (!shouldCreateAlert && !shouldCreateIncident) {
    return "This rule would do nothing. Turn on Create Alert, Declare Incident, or both.";
  }

  return null;
};

/*
 * What a rule declares, as a label. Undefined means the column was not
 * selected, so it reads with the model's defaults rather than as "nothing" -
 * a row rendering "Nothing" because of a missing select would be a lie about
 * a rule that is in fact paging someone.
 */
export type DescribeBurnRateOutputsFunction = (
  rule: ServiceLevelObjectiveBurnRateRule,
) => string;

export const describeBurnRateOutputs: DescribeBurnRateOutputsFunction = (
  rule: ServiceLevelObjectiveBurnRateRule,
): string => {
  const createsAlert: boolean = rule.shouldCreateAlert !== false;
  const createsIncident: boolean = rule.shouldCreateIncident === true;

  if (createsAlert && createsIncident) {
    return "Alert + Incident";
  }

  if (createsIncident) {
    return "Incident";
  }

  if (createsAlert) {
    return "Alert";
  }

  return "Nothing";
};

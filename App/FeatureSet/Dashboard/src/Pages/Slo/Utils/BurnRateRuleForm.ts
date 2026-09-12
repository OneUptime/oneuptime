import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import type { ModelField } from "Common/UI/Components/Forms/ModelForm";
import type { FormStep } from "Common/UI/Components/Forms/Types/FormStep";

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
 * The two output flags are read in four places - the validator below, the two
 * conditional form steps, and the Declares column - and they are read with the
 * model's own defaults, because both ModelForm and a ModelTable `select` leave
 * an untouched or unselected field undefined. `!== false` for the alert and
 * `=== true` for the incident is the asymmetry the evaluation worker and
 * DetectionRuleEvaluator use: a rule read without the column keeps alerting,
 * and never declares an incident by accident.
 *
 * One pair of predicates rather than four inline comparisons, so a form step
 * cannot disagree with the validator that guards it about whether an output is
 * on.
 */
export interface BurnRateRuleOutputFlags {
  shouldCreateAlert?: boolean | undefined;
  shouldCreateIncident?: boolean | undefined;
}

export type ReadsBurnRateOutputFlagFunction = (
  rule: BurnRateRuleOutputFlags,
) => boolean;

export const willCreateAlert: ReadsBurnRateOutputFlagFunction = (
  rule: BurnRateRuleOutputFlags,
): boolean => {
  return rule.shouldCreateAlert !== false;
};

export const willDeclareIncident: ReadsBurnRateOutputFlagFunction = (
  rule: BurnRateRuleOutputFlags,
): boolean => {
  return rule.shouldCreateIncident === true;
};

/*
 * A rule that declares nothing is rejected by
 * ServiceLevelObjectiveBurnRateRuleService.onBeforeCreate/onBeforeUpdate.
 * Mirrored here for the same reason the window and threshold validators are:
 * the server's rejection only surfaces after a failed round-trip that
 * re-renders the raw exception, and "turn the alert off, forget to turn the
 * incident on" is the obvious way into it.
 *
 * Both toggles live on ONE form step on purpose. Form validation only runs for
 * the step being left (Validation.validate skips every field whose stepId is
 * not the current one), so a validator that has to see both flags could not
 * span two steps: turning the alert off would fail the step the user was
 * leaving, before they ever reached the incident toggle they were on their way
 * to.
 */
export type ValidateBurnRateOutputsFunction = (
  value: FormValues<ServiceLevelObjectiveBurnRateRule>,
) => string | null;

export const validateBurnRateOutputs: ValidateBurnRateOutputsFunction = (
  value: FormValues<ServiceLevelObjectiveBurnRateRule>,
): string | null => {
  if (!willCreateAlert(value) && !willDeclareIncident(value)) {
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
  const createsAlert: boolean = willCreateAlert(rule);
  const createsIncident: boolean = willDeclareIncident(rule);

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

/*
 * Twelve fields in one scrolling modal asked the user to hold the whole
 * rule in their head at once, and buried the two toggles that decide
 * what it does between the windows above them and the routing below.
 * The steps follow the four questions a rule answers: what is it, when
 * does it fire, what does it declare, and where does each output go.
 *
 * The two routing steps appear only for the output they configure.
 * BasicForm filters hidden steps out of both the rail and the
 * next/previous walk, so an alert-only rule never sees an incident
 * severity it has no use for.
 */
export const BURN_RATE_RULE_FORM_STEPS: Array<
  FormStep<ServiceLevelObjectiveBurnRateRule>
> = [
  {
    id: "rule",
    title: "Rule",
  },
  {
    id: "burn-window",
    title: "Burn Window",
  },
  {
    id: "declares",
    title: "What It Declares",
  },
  {
    id: "alert-routing",
    title: "Alert Routing",
    showIf: (value: FormValues<ServiceLevelObjectiveBurnRateRule>): boolean => {
      return willCreateAlert(value);
    },
  },
  {
    id: "incident-routing",
    title: "Incident Routing",
    showIf: (value: FormValues<ServiceLevelObjectiveBurnRateRule>): boolean => {
      return willDeclareIncident(value);
    },
  },
];

/*
 * Hoisted out of the JSX so the wiring is assertable: every field has to
 * carry a stepId, and a stepId that matches no declared step puts the field
 * on no step at all — it simply never renders, with nothing failing to
 * compile and nothing failing at runtime. The array closes over nothing in
 * the component, so there is no behaviour in the move.
 */
export const BURN_RATE_RULE_FORM_FIELDS: Array<
  ModelField<ServiceLevelObjectiveBurnRateRule>
> = [
  {
    field: {
      name: true,
    },
    title: "Name",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    placeholder: "Fast burn",
    stepId: "rule",
  },
  {
    field: {
      isEnabled: true,
    },
    title: "Enabled",
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
    description: "Enable or disable this burn rate rule.",
    /*
     * The column default. Without it the toggle renders OFF on a
     * create form while the row is in fact written enabled — the
     * form would be telling the user the opposite of what it does.
     */
    defaultValue: true,
    stepId: "rule",
  },
  {
    field: {
      burnRateThreshold: true,
    },
    title: "Burn Rate Threshold",
    description:
      "Fire when the burn rate exceeds this value over both windows. 14.4 is the classic fast-burn threshold for a 30-day window.",
    fieldType: FormFieldSchemaType.Number,
    required: true,
    placeholder: "14.4",
    customValidation: validateBurnRateThreshold,
    stepId: "burn-window",
  },
  {
    field: {
      longWindowInMinutes: true,
    },
    title: "Long Window (Minutes)",
    description:
      "Lookback that confirms the burn is sustained, e.g. 60 for fast burn or 360 for slow burn.",
    fieldType: FormFieldSchemaType.Number,
    required: true,
    placeholder: "60",
    validation: {
      minValue: 1,
    },
    stepId: "burn-window",
  },
  {
    field: {
      shortWindowInMinutes: true,
    },
    title: "Short Window (Minutes)",
    description:
      "Lookback that confirms the burn is still happening, e.g. 5 for fast burn or 30 for slow burn. Must be shorter than the long window.",
    fieldType: FormFieldSchemaType.Number,
    required: true,
    placeholder: "5",
    validation: {
      minValue: 1,
    },
    customValidation: validateBurnRateWindows,
    stepId: "burn-window",
  },
  /*
   * Minimum Sample Count is intentionally absent. It only guards
   * event-based (Metric) SLIs, which OneUptime does not evaluate
   * yet — the worker never reads the column, so offering the knob
   * promised a noise guard that does nothing. The column and its
   * server-side validation remain for that later phase.
   */
  {
    field: {
      refireSuppressionMinutes: true,
    },
    title: "Re-fire Suppression (Minutes)",
    description:
      "Quiet period after an alert or incident resolves before this rule may declare that same record again. Each output is suppressed independently. Defaults to the long window.",
    fieldType: FormFieldSchemaType.Number,
    required: false,
    placeholder: "60",
    validation: {
      minValue: 1,
    },
    stepId: "burn-window",
  },
  /*
   * Both toggles, on one step, before either routing step. The validator that
   * forbids a rule with no output has to see both values in one pass, and a
   * step is the unit validation runs over.
   *
   * It hangs off the ALERT toggle, and only off that one. Validation hands a
   * customValidation the whole form's values, so one attachment covers both
   * flags — but it only runs a field's validators when that field has a value
   * (Validation.validate's `name in entries` gate). `shouldCreateAlert` always
   * does, because its defaultValue is written into the form values on open;
   * `shouldCreateIncident` has no default, so an untouched incident toggle
   * never validates anything. Attaching to both would just render the same
   * sentence twice under two adjacent toggles.
   */
  {
    field: {
      shouldCreateAlert: true,
    },
    title: "Create Alert",
    description:
      "Raise an Alert when this rule fires. A rule must create an alert, declare an incident, or both.",
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
    // The column default, so the toggle shows what the row will hold.
    defaultValue: true,
    customValidation: validateBurnRateOutputs,
    stepId: "declares",
  },
  {
    field: {
      shouldCreateIncident: true,
    },
    title: "Declare Incident",
    description:
      "Declare an Incident when this rule fires. Burn rate incidents are never published to status pages and never notify subscribers.",
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
    stepId: "declares",
  },
  {
    field: {
      alertSeverity: true,
    },
    title: "Alert Severity",
    description:
      "Severity of the alert this rule creates. Defaults to the project's most severe.",
    fieldType: FormFieldSchemaType.Dropdown,
    dropdownModal: {
      type: AlertSeverity,
      labelField: "name",
      valueField: "_id",
    },
    required: false,
    placeholder: "Select Alert Severity",
    stepId: "alert-routing",
  },
  {
    field: {
      onCallDutyPolicies: true,
    },
    title: "Alert On-Call Duty Policies",
    description: "On-call policies to execute when this rule creates an alert.",
    fieldType: FormFieldSchemaType.MultiSelectDropdown,
    dropdownModal: {
      type: OnCallDutyPolicy,
      labelField: "name",
      valueField: "_id",
    },
    required: false,
    placeholder: "Select On-Call Policies (optional)",
    stepId: "alert-routing",
  },
  {
    field: {
      incidentSeverity: true,
    },
    title: "Incident Severity",
    description:
      "Severity of the incident this rule declares. Defaults to the project's most severe.",
    fieldType: FormFieldSchemaType.Dropdown,
    dropdownModal: {
      type: IncidentSeverity,
      labelField: "name",
      valueField: "_id",
    },
    required: false,
    placeholder: "Select Incident Severity",
    stepId: "incident-routing",
  },
  {
    field: {
      incidentOnCallDutyPolicies: true,
    },
    title: "Incident On-Call Duty Policies",
    description:
      "On-call policies to execute when this rule declares an incident. Kept separate from the alert policies so the two can escalate differently.",
    fieldType: FormFieldSchemaType.MultiSelectDropdown,
    dropdownModal: {
      type: OnCallDutyPolicy,
      labelField: "name",
      valueField: "_id",
    },
    required: false,
    placeholder: "Select On-Call Policies (optional)",
    stepId: "incident-routing",
  },
];

import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import {
  DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE,
  DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE,
  SLO_BURN_RATE_TEMPLATE_VARIABLE_GROUPS,
  SLO_BURN_RATE_TEMPLATE_VARIABLES,
  SloBurnRateTemplateVariableDefinition,
} from "Common/Utils/Slo/SloBurnRateTemplate";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import type { ModelField } from "Common/UI/Components/Forms/ModelForm";
import type { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import type { RadioButton } from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import {
  BURN_RATE_DECLARES_ANSWERS,
  BURN_RATE_DECLARES_COPY,
  BURN_RATE_DECLARES_FIELD_KEY,
  BURN_RATE_DECLARES_FIELD_TITLE,
  BURN_RATE_DECLARES_REQUIRED,
  BurnRateDeclares,
  getBurnRateDeclares,
  getValuesForBurnRateDeclares,
  isBurnRateDeclares,
} from "./BurnRateDeclares";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  SloRecordOutputCopy,
  SloRecordOutputFieldPlacement,
  SloRecordOutputSections,
  describeSloRecordOutputOptions,
  describeSloRecordOutputs,
  getSloAlertOutputFormFields,
  getSloAlertOutputSections,
  getSloIncidentOutputFormFields,
  getSloIncidentOutputSections,
} from "./SloRecordOutputForm";

/*
 * The burn rate rule form's pure half, split out of BurnRateRules.tsx so it
 * can be read without React.
 *
 * The page is a React module; deciding whether a set of form values is a
 * legal rule, and saying what a rule declares, is neither React nor DOM.
 * App has no react by design (its package.json does not depend on it and CI
 * installs node_modules for Common and App only), so a node test that wants
 * these functions must not reach the page to get them - importing it fails
 * twice over, once when jest cannot resolve react and once when tsc pulls the
 * whole component graph into App's program.
 * App/Tests/FeatureSetImportsStayReactFree.test.ts is the guard for that,
 * and it is what caught this.
 *
 * The same constraint is why nothing here fetches anything. The owners
 * pickers are plain data too (getOwnersFormField): the people picker the form
 * draws them with does its own searching.
 *
 * The alert and incident fields themselves are built by SloRecordOutputForm,
 * which a tier of the SLO's error budget policy asks them from too: this
 * module says what is particular to a rule - its template variables and
 * defaults, the help that says "this rule", and the steps and folded
 * sections each output's fields go on.
 *
 * BurnRateRules.tsx re-exports these names, so existing importers are
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
 * The two output flags are read in several places - the validator below, the
 * two conditional form steps, and the Declares column - and they are read with
 * the model's own defaults, because both ModelForm and a ModelTable `select`
 * leave an untouched or unselected field undefined. `!== false` for the alert
 * and `=== true` for the incident is the asymmetry the evaluation worker and
 * DetectionRuleEvaluator use: a rule read without the column keeps alerting,
 * and never declares an incident by accident.
 *
 * One pair of predicates rather than inline comparisons, so a form step cannot
 * disagree with the validator that guards it about whether an output is on.
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
 * The form asks one question with three answers now (BurnRateDeclares), none
 * of which declares nothing, so this only speaks for a form whose two
 * columns were both off when it opened - a rule written that way by hand.
 */
export type ValidateBurnRateOutputsFunction = (
  value: FormValues<ServiceLevelObjectiveBurnRateRule>,
) => string | null;

export const validateBurnRateOutputs: ValidateBurnRateOutputsFunction = (
  value: FormValues<ServiceLevelObjectiveBurnRateRule>,
): string | null => {
  if (!willCreateAlert(value) && !willDeclareIncident(value)) {
    return BURN_RATE_DECLARES_REQUIRED;
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
  // English; the page translates the label it shows.
  return describeSloRecordOutputs({
    createsAlert: willCreateAlert(rule),
    createsIncident: willDeclareIncident(rule),
  });
};

/*
 * The per-output options a reader of the rules table cannot infer from the
 * Declares label. Only departures from the column defaults are listed - a rule
 * whose alert auto-resolves and is visible to the whole project says nothing,
 * because that is what every burn rate rule has always done - and only for an
 * output the rule actually declares. Read with the same defaults as the worker:
 * `!== false` for auto-resolve, `=== true` for the private flags and for
 * addSloOwnersAsOwners, so an unselected column never invents an option.
 */
export interface BurnRateRuleOptionFlags extends BurnRateRuleOutputFlags {
  isAlertPrivate?: boolean | undefined;
  autoResolveAlert?: boolean | undefined;
  isIncidentPrivate?: boolean | undefined;
  autoResolveIncident?: boolean | undefined;
  addSloOwnersAsOwners?: boolean | undefined;
}

export type DescribeBurnRateOutputOptionsFunction = (
  rule: BurnRateRuleOptionFlags,
) => Array<string>;

export const describeBurnRateOutputOptions: DescribeBurnRateOutputOptionsFunction =
  (rule: BurnRateRuleOptionFlags): Array<string> => {
    // Each line whole, in English: the page translates the line it is given.
    return describeSloRecordOutputOptions(rule, {
      createsAlert: willCreateAlert(rule),
      createsIncident: willDeclareIncident(rule),
    });
  };

/*
 * The template variables, as the markdown table the page's help panel shows.
 * Generated from the shared catalog rather than written out, so the help can
 * never document a variable the worker does not fill in (the catalog's own
 * tests pin catalog === worker map).
 */
export const BURN_RATE_TEMPLATE_VARIABLES_MARKDOWN_TABLE: string = [
  "| Variable | What it holds | Example |",
  "|----------|---------------|---------|",
  ...SLO_BURN_RATE_TEMPLATE_VARIABLES.map(
    (definition: SloBurnRateTemplateVariableDefinition): string => {
      return `| \`{{${definition.key}}}\` | ${definition.description} | ${definition.example} |`;
    },
  ),
].join("\n");

/*
 * Every template field offers the variables itself: collapsed under the
 * field, behind the Markdown editor's Insert variable button, and when "{{"
 * is typed. They were three names run into each field's description, with
 * the rest in the page's help panel.
 */
export const BURN_RATE_TEMPLATE_VARIABLES_DESCRIPTION: string =
  "When the rule fires, these variables are filled in with the SLO's values at that moment.";

/*
 * When it fires: the three answers, each with its line.
 */
export const getBurnRateDeclaresChoices: () => Array<RadioButton> =
  (): Array<RadioButton> => {
    return BURN_RATE_DECLARES_ANSWERS.map(
      (declares: BurnRateDeclares): RadioButton => {
        return {
          value: declares,
          title: BURN_RATE_DECLARES_COPY[declares].title,
          description: BURN_RATE_DECLARES_COPY[declares].description,
        };
      },
    );
  };

/*
 * Each output has one step, matching the monitor form: title and severity
 * stay visible, with optional settings grouped into expandable sections.
 * Hidden outputs are skipped by both the step rail and Next/Previous.
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
    id: "alert-details",
    title: "Alert",
    showIf: (value: FormValues<ServiceLevelObjectiveBurnRateRule>): boolean => {
      return willCreateAlert(value);
    },
  },
  {
    id: "incident-details",
    title: "Incident",
    showIf: (value: FormValues<ServiceLevelObjectiveBurnRateRule>): boolean => {
      return willDeclareIncident(value);
    },
  },
];

/*
 * What the help under each output's fields says of a rule: what raises the
 * record, and what its default title and description say.
 */
const BURN_RATE_ALERT_COPY: SloRecordOutputCopy = {
  titleDescription: translationKey(
    "Title of the alert this rule raises. Leave empty to use the default: {{defaultTitle}}",
  ),
  severityDescription: translationKey(
    "Severity of the alert this rule creates. Defaults to the project's most severe.",
  ),
  descriptionDescription: translationKey(
    "Description of the alert, in Markdown. Leave empty to use the default, which states both burn rates, the threshold and the error budget remaining.",
  ),
  onCallDescription: translationKey(
    "On-call policies to execute when this rule creates an alert.",
  ),
  autoResolveDescription: translationKey(
    "Resolve the alert when the long window's burn rate drops below the threshold.",
  ),
};

const BURN_RATE_INCIDENT_COPY: SloRecordOutputCopy = {
  titleDescription: translationKey(
    "Title of the incident this rule declares. Leave empty to use the default: {{defaultTitle}}",
  ),
  severityDescription: translationKey(
    "Severity of the incident this rule declares. Defaults to the project's most severe.",
  ),
  descriptionDescription: translationKey(
    "Description of the incident, in Markdown. Leave empty to use the default, which states both burn rates, the threshold and the error budget remaining.",
  ),
  onCallDescription: translationKey(
    "On-call policies to execute when this rule declares an incident. Kept separate from the alert policies so the two can escalate differently.",
  ),
  autoResolveDescription: translationKey(
    "Resolve the incident when the long window's burn rate drops below the threshold.",
  ),
};

type GetBurnRateOutputPlacementFunction = (
  stepId: string,
  sections: SloRecordOutputSections<ServiceLevelObjectiveBurnRateRule>,
) => SloRecordOutputFieldPlacement<ServiceLevelObjectiveBurnRateRule>;

/*
 * Each output has one step, matching the monitor form: title and severity
 * stay visible, with optional settings grouped into expandable sections -
 * the description, ownership and labels, on-call, and More fields for
 * auto-resolve, privacy and remediation notes.
 */
const getBurnRateOutputPlacement: GetBurnRateOutputPlacementFunction = (
  stepId: string,
  sections: SloRecordOutputSections<ServiceLevelObjectiveBurnRateRule>,
): SloRecordOutputFieldPlacement<ServiceLevelObjectiveBurnRateRule> => {
  return {
    stepId: stepId,
    sections: {
      description: sections.description,
      ownership: sections.ownership,
      onCall: sections.onCall,
      advanced: sections.advanced,
    },
  };
};

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
    // The column's "Name of this burn rate rule" only says the title again.
    hideColumnDescription: true,
    stepId: "rule",
  },
  /*
   * A new rule starts enabled (the column's default), so the switch is on
   * the Edit form only, as on every rule form (RuleEnabledField).
   */
  {
    field: {
      isEnabled: true,
    },
    title: "Enabled",
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
    description: "Off stops this rule from firing. Its history is kept.",
    doNotShowWhenCreating: true,
    // The column default, should a form ever open without a stored value.
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
      "How long after an alert or incident resolves before this rule may open another. Defaults to the long window.",
    fieldType: FormFieldSchemaType.Number,
    required: false,
    placeholder: "60",
    validation: {
      minValue: 1,
    },
    stepId: "burn-window",
  },
  /*
   * When it fires: one choice of three (BurnRateDeclares) where Create
   * Alert and Declare Incident were two switches that could both be off.
   * Form-only: it starts on the answer the rule's two columns make (Create an
   * alert for a new rule), and a pick writes both columns, which are
   * registered just below, unseen, so the form loads and saves them.
   */
  {
    overrideField: {
      shouldCreateAlert: true,
    },
    overrideFieldKey: BURN_RATE_DECLARES_FIELD_KEY,
    formOnly: true,
    title: BURN_RATE_DECLARES_FIELD_TITLE,
    fieldType: FormFieldSchemaType.RadioButton,
    radioButtonOptions: getBurnRateDeclaresChoices(),
    required: true,
    // Each answer says what it opens; the column's sentence is half of it.
    hideColumnDescription: true,
    dataTestId: "burn-rate-declares",
    getDefaultValue: (
      values: FormValues<ServiceLevelObjectiveBurnRateRule>,
    ): string => {
      return getBurnRateDeclares(values) || "";
    },
    onChange: (
      value: unknown,
      currentValues: FormValues<ServiceLevelObjectiveBurnRateRule>,
      setNewFormValues: (
        values: FormValues<ServiceLevelObjectiveBurnRateRule>,
      ) => void,
    ): void => {
      if (!isBurnRateDeclares(value)) {
        return;
      }

      setNewFormValues(
        getValuesForBurnRateDeclares({
          values: currentValues,
          declares: value,
        }),
      );
    },
    customValidation: validateBurnRateOutputs,
    stepId: "declares",
  },
  {
    field: {
      shouldCreateAlert: true,
    },
    title: "Create Alert",
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
    // The column default: a new rule raises an alert.
    defaultValue: true,
    hideColumnDescription: true,
    showIf: (): boolean => {
      return false;
    },
    stepId: "declares",
  },
  {
    field: {
      shouldCreateIncident: true,
    },
    title: "Declare Incident",
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
    hideColumnDescription: true,
    showIf: (): boolean => {
      return false;
    },
    stepId: "declares",
  },
  /*
   * Here rather than on a per-output step because it applies to both outputs,
   * and a switch repeated on two steps could be left on for one and off for
   * the other with one column behind them. No defaultValue: the column
   * defaults to false, and a false defaultValue is indistinguishable from
   * none (BasicForm only applies a truthy one).
   */
  {
    field: {
      addSloOwnersAsOwners: true,
    },
    title: "Add SLO Owners as Owners",
    description:
      "Add this SLO's owners as owners of every alert and incident this rule creates. They may be notified twice.",
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
    stepId: "declares",
  },
  ...getSloAlertOutputFormFields<ServiceLevelObjectiveBurnRateRule>({
    templateVariables: SLO_BURN_RATE_TEMPLATE_VARIABLE_GROUPS,
    templateVariablesDescription: BURN_RATE_TEMPLATE_VARIABLES_DESCRIPTION,
    defaultTitleTemplate: DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE,
    defaultDescriptionTemplate: DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE,
    copy: BURN_RATE_ALERT_COPY,
    placement: getBurnRateOutputPlacement(
      "alert-details",
      getSloAlertOutputSections<ServiceLevelObjectiveBurnRateRule>(),
    ),
  }),
  ...getSloIncidentOutputFormFields<ServiceLevelObjectiveBurnRateRule>({
    templateVariables: SLO_BURN_RATE_TEMPLATE_VARIABLE_GROUPS,
    templateVariablesDescription: BURN_RATE_TEMPLATE_VARIABLES_DESCRIPTION,
    defaultTitleTemplate: DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE,
    defaultDescriptionTemplate: DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE,
    copy: BURN_RATE_INCIDENT_COPY,
    placement: getBurnRateOutputPlacement(
      "incident-details",
      getSloIncidentOutputSections<ServiceLevelObjectiveBurnRateRule>(),
    ),
  }),
];

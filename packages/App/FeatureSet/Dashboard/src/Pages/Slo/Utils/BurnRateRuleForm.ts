import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import {
  DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE,
  DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE,
  SLO_BURN_RATE_MARKDOWN_TEMPLATE_MAX_LENGTH,
  SLO_BURN_RATE_TEMPLATE_VARIABLE_GROUPS,
  SLO_BURN_RATE_TEMPLATE_VARIABLES,
  SLO_BURN_RATE_TITLE_TEMPLATE_MAX_LENGTH,
  SloBurnRateTemplateVariableDefinition,
} from "Common/Utils/Slo/SloBurnRateTemplate";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import getOwnersFormField from "Common/UI/Components/PeoplePicker/OwnersFormField";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import type { ModelField } from "Common/UI/Components/Forms/ModelForm";
import type { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
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
import {
  translateTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

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
  const createsAlert: boolean = willCreateAlert(rule);
  const createsIncident: boolean = willDeclareIncident(rule);

  // English; the page translates the label it shows.
  if (createsAlert && createsIncident) {
    return translationKey("Alert + Incident");
  }

  if (createsIncident) {
    return translationKey("Incident");
  }

  if (createsAlert) {
    return translationKey("Alert");
  }

  return translationKey("Nothing");
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

/*
 * Each line whole, so a translation never has to glue "Alert" to a list of
 * options: the page translates the English line it is given.
 */
interface OutputOptionLines {
  resolvedByHand: string;
  isPrivate: string;
  both: string;
}

const ALERT_OPTION_LINES: OutputOptionLines = {
  resolvedByHand: translationKey("Alert: resolved by hand"),
  isPrivate: translationKey("Alert: private"),
  both: translationKey("Alert: resolved by hand, private"),
};

const INCIDENT_OPTION_LINES: OutputOptionLines = {
  resolvedByHand: translationKey("Incident: resolved by hand"),
  isPrivate: translationKey("Incident: private"),
  both: translationKey("Incident: resolved by hand, private"),
};

export const describeBurnRateOutputOptions: DescribeBurnRateOutputOptionsFunction =
  (rule: BurnRateRuleOptionFlags): Array<string> => {
    const lines: Array<string> = [];

    type DescribeOutputFunction = (data: {
      lines: OutputOptionLines;
      isPrivate: boolean | undefined;
      autoResolve: boolean | undefined;
    }) => void;

    const describeOutput: DescribeOutputFunction = (data: {
      lines: OutputOptionLines;
      isPrivate: boolean | undefined;
      autoResolve: boolean | undefined;
    }): void => {
      const resolvedByHand: boolean = data.autoResolve === false;
      const isPrivate: boolean = data.isPrivate === true;

      if (resolvedByHand && isPrivate) {
        lines.push(data.lines.both);
      } else if (resolvedByHand) {
        lines.push(data.lines.resolvedByHand);
      } else if (isPrivate) {
        lines.push(data.lines.isPrivate);
      }
    };

    const createsAlert: boolean = willCreateAlert(rule);
    const createsIncident: boolean = willDeclareIncident(rule);

    if (createsAlert) {
      describeOutput({
        lines: ALERT_OPTION_LINES,
        isPrivate: rule.isAlertPrivate,
        autoResolve: rule.autoResolveAlert,
      });
    }

    if (createsIncident) {
      describeOutput({
        lines: INCIDENT_OPTION_LINES,
        isPrivate: rule.isIncidentPrivate,
        autoResolve: rule.autoResolveIncident,
      });
    }

    if (
      rule.addSloOwnersAsOwners === true &&
      (createsAlert || createsIncident)
    ) {
      lines.push(translationKey("SLO owners added as owners"));
    }

    return lines;
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

const alertDescriptionSection: FormFieldCollapsibleSection<ServiceLevelObjectiveBurnRateRule> =
  {
    id: "alert-description",
    title: "Description",
    description: "Optional alert description",
    isConfigured: (
      value: FormValues<ServiceLevelObjectiveBurnRateRule>,
    ): boolean => {
      return Boolean(value.alertDescriptionTemplate);
    },
  };

const alertOwnershipSection: FormFieldCollapsibleSection<ServiceLevelObjectiveBurnRateRule> =
  {
    id: "alert-ownership",
    title: "Ownership & Labels",
    description: "Assign owners and labels to the alert",
    isConfigured: (
      value: FormValues<ServiceLevelObjectiveBurnRateRule>,
    ): boolean => {
      return [
        value.alertOwnerTeams,
        value.alertOwnerUsers,
        value.alertLabels,
      ].some((selection: unknown): boolean => {
        return Array.isArray(selection) && selection.length > 0;
      });
    },
  };

const alertOnCallSection: FormFieldCollapsibleSection<ServiceLevelObjectiveBurnRateRule> =
  {
    id: "alert-on-call",
    title: "On-Call",
    description: "Configure on-call policy escalation",
    isConfigured: (
      value: FormValues<ServiceLevelObjectiveBurnRateRule>,
    ): boolean => {
      return (
        Array.isArray(value.onCallDutyPolicies) &&
        value.onCallDutyPolicies.length > 0
      );
    },
  };

/*
 * Auto-resolve, privacy and remediation notes: More fields, as on every form
 * - folded on create and edit, its header naming the three and showing the
 * ones chosen. A true auto-resolve is what a new rule starts with, so only
 * turning it off counts.
 */
const alertAdvancedSection: FormFieldCollapsibleSection<ServiceLevelObjectiveBurnRateRule> =
  getAdvancedFormSection<ServiceLevelObjectiveBurnRateRule>({
    id: "alert-advanced",
    description: "Auto-resolve, privacy and remediation settings",
    isConfigured: (
      value: FormValues<ServiceLevelObjectiveBurnRateRule>,
    ): boolean => {
      return (
        value.autoResolveAlert === false ||
        value.isAlertPrivate === true ||
        Boolean(value.alertRemediationNotes)
      );
    },
  });

const incidentDescriptionSection: FormFieldCollapsibleSection<ServiceLevelObjectiveBurnRateRule> =
  {
    id: "incident-description",
    title: "Description",
    description: "Optional incident description",
    isConfigured: (
      value: FormValues<ServiceLevelObjectiveBurnRateRule>,
    ): boolean => {
      return Boolean(value.incidentDescriptionTemplate);
    },
  };

const incidentOwnershipSection: FormFieldCollapsibleSection<ServiceLevelObjectiveBurnRateRule> =
  {
    id: "incident-ownership",
    title: "Ownership & Labels",
    description: "Assign owners and labels to the incident",
    isConfigured: (
      value: FormValues<ServiceLevelObjectiveBurnRateRule>,
    ): boolean => {
      return [
        value.incidentOwnerTeams,
        value.incidentOwnerUsers,
        value.incidentLabels,
      ].some((selection: unknown): boolean => {
        return Array.isArray(selection) && selection.length > 0;
      });
    },
  };

const incidentOnCallSection: FormFieldCollapsibleSection<ServiceLevelObjectiveBurnRateRule> =
  {
    id: "incident-on-call",
    title: "On-Call",
    description: "Configure on-call policy escalation",
    isConfigured: (
      value: FormValues<ServiceLevelObjectiveBurnRateRule>,
    ): boolean => {
      return (
        Array.isArray(value.incidentOnCallDutyPolicies) &&
        value.incidentOnCallDutyPolicies.length > 0
      );
    },
  };

const incidentAdvancedSection: FormFieldCollapsibleSection<ServiceLevelObjectiveBurnRateRule> =
  getAdvancedFormSection<ServiceLevelObjectiveBurnRateRule>({
    id: "incident-advanced",
    description: "Auto-resolve, privacy and remediation settings",
    isConfigured: (
      value: FormValues<ServiceLevelObjectiveBurnRateRule>,
    ): boolean => {
      return (
        value.autoResolveIncident === false ||
        value.isIncidentPrivate === true ||
        Boolean(value.incidentRemediationNotes)
      );
    },
  });

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
  {
    field: {
      alertTitleTemplate: true,
    },
    title: "Alert Title",
    // A getter, so the form reads it in the language of the moment.
    get description(): string {
      return translateTemplate(
        "Title of the alert this rule raises. Leave empty to use the default: {{defaultTitle}}",
        { defaultTitle: DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE },
      );
    },
    fieldType: FormFieldSchemaType.Text,
    templateVariables: SLO_BURN_RATE_TEMPLATE_VARIABLE_GROUPS,
    templateVariablesDescription: BURN_RATE_TEMPLATE_VARIABLES_DESCRIPTION,
    required: false,
    placeholder: DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE,
    defaultValue: DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE,
    validation: {
      maxLength: SLO_BURN_RATE_TITLE_TEMPLATE_MAX_LENGTH,
    },
    stepId: "alert-details",
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
      sort: {
        order: SortOrder.Ascending,
      },
    },
    required: false,
    placeholder: "Select Alert Severity",
    stepId: "alert-details",
  },
  {
    field: {
      alertDescriptionTemplate: true,
    },
    title: "Alert Description",
    description:
      "Description of the alert, in Markdown. Leave empty to use the default, which states both burn rates, the threshold and the error budget remaining.",
    fieldType: FormFieldSchemaType.Markdown,
    templateVariables: SLO_BURN_RATE_TEMPLATE_VARIABLE_GROUPS,
    templateVariablesDescription: BURN_RATE_TEMPLATE_VARIABLES_DESCRIPTION,
    defaultValue: DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE,
    required: false,
    validation: {
      maxLength: SLO_BURN_RATE_MARKDOWN_TEMPLATE_MAX_LENGTH,
    },
    collapsibleSection: alertDescriptionSection,
    stepId: "alert-details",
  },
  /*
   * People and teams in one picker, saved to the rule's alertOwnerUsers and
   * alertOwnerTeams columns.
   */
  getOwnersFormField<ServiceLevelObjectiveBurnRateRule>({
    fieldKey: "alertOwners",
    usersKey: "alertOwnerUsers",
    teamsKey: "alertOwnerTeams",
    title: "Alert Owners",
    description:
      "People and teams added as owners of the alert. Owners are notified when the alert is created.",
    collapsibleSection: alertOwnershipSection,
    stepId: "alert-details",
  }),
  {
    field: {
      alertLabels: true,
    },
    title: "Alert Labels",
    description:
      "Labels added to the alert, so alert filters, owner rules and workspace notification rules can match it.",
    fieldType: FormFieldSchemaType.MultiSelectDropdown,
    dropdownModal: {
      type: Label,
      labelField: "name",
      valueField: "_id",
    },
    required: false,
    placeholder: "Select Labels",
    collapsibleSection: alertOwnershipSection,
    stepId: "alert-details",
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
    placeholder: "Select On-Call Policies",
    collapsibleSection: alertOnCallSection,
    stepId: "alert-details",
  },
  {
    field: {
      autoResolveAlert: true,
    },
    title: "Auto Resolve Alert",
    description:
      "Resolve the alert when the long window's burn rate drops below the threshold.",
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
    /*
     * The column default is TRUE, so the toggle has to say so: without it a
     * create form would show auto-resolve off while the row is written on.
     */
    defaultValue: true,
    collapsibleSection: alertAdvancedSection,
    stepId: "alert-details",
  },
  {
    field: {
      isAlertPrivate: true,
    },
    title: "Private Alert",
    description:
      "Only the alert's owners, project admins and project owners can see it.",
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
    collapsibleSection: alertAdvancedSection,
    stepId: "alert-details",
  },
  {
    field: {
      alertRemediationNotes: true,
    },
    title: "Alert Remediation Notes",
    description: "Steps for whoever picks the alert up, in Markdown.",
    fieldType: FormFieldSchemaType.Markdown,
    templateVariables: SLO_BURN_RATE_TEMPLATE_VARIABLE_GROUPS,
    templateVariablesDescription: BURN_RATE_TEMPLATE_VARIABLES_DESCRIPTION,
    required: false,
    validation: {
      maxLength: SLO_BURN_RATE_MARKDOWN_TEMPLATE_MAX_LENGTH,
    },
    collapsibleSection: alertAdvancedSection,
    stepId: "alert-details",
  },
  {
    field: {
      incidentTitleTemplate: true,
    },
    title: "Incident Title",
    // A getter, so the form reads it in the language of the moment.
    get description(): string {
      return translateTemplate(
        "Title of the incident this rule declares. Leave empty to use the default: {{defaultTitle}}",
        { defaultTitle: DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE },
      );
    },
    fieldType: FormFieldSchemaType.Text,
    templateVariables: SLO_BURN_RATE_TEMPLATE_VARIABLE_GROUPS,
    templateVariablesDescription: BURN_RATE_TEMPLATE_VARIABLES_DESCRIPTION,
    required: false,
    placeholder: DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE,
    defaultValue: DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE,
    validation: {
      maxLength: SLO_BURN_RATE_TITLE_TEMPLATE_MAX_LENGTH,
    },
    stepId: "incident-details",
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
      sort: {
        order: SortOrder.Ascending,
      },
    },
    required: false,
    placeholder: "Select Incident Severity",
    stepId: "incident-details",
  },
  {
    field: {
      incidentDescriptionTemplate: true,
    },
    title: "Incident Description",
    description:
      "Description of the incident, in Markdown. Leave empty to use the default, which states both burn rates, the threshold and the error budget remaining.",
    fieldType: FormFieldSchemaType.Markdown,
    templateVariables: SLO_BURN_RATE_TEMPLATE_VARIABLE_GROUPS,
    templateVariablesDescription: BURN_RATE_TEMPLATE_VARIABLES_DESCRIPTION,
    defaultValue: DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE,
    required: false,
    validation: {
      maxLength: SLO_BURN_RATE_MARKDOWN_TEMPLATE_MAX_LENGTH,
    },
    collapsibleSection: incidentDescriptionSection,
    stepId: "incident-details",
  },
  // Saved to the rule's incidentOwnerUsers and incidentOwnerTeams columns.
  getOwnersFormField<ServiceLevelObjectiveBurnRateRule>({
    fieldKey: "incidentOwners",
    usersKey: "incidentOwnerUsers",
    teamsKey: "incidentOwnerTeams",
    title: "Incident Owners",
    description:
      "People and teams added as owners of the incident. Owners are notified when the incident is declared.",
    collapsibleSection: incidentOwnershipSection,
    stepId: "incident-details",
  }),
  {
    field: {
      incidentLabels: true,
    },
    title: "Incident Labels",
    description:
      "Labels added to the incident, so incident filters, owner rules and workspace notification rules can match it.",
    fieldType: FormFieldSchemaType.MultiSelectDropdown,
    dropdownModal: {
      type: Label,
      labelField: "name",
      valueField: "_id",
    },
    required: false,
    placeholder: "Select Labels",
    collapsibleSection: incidentOwnershipSection,
    stepId: "incident-details",
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
    placeholder: "Select On-Call Policies",
    collapsibleSection: incidentOnCallSection,
    stepId: "incident-details",
  },
  {
    field: {
      autoResolveIncident: true,
    },
    title: "Auto Resolve Incident",
    description:
      "Resolve the incident when the long window's burn rate drops below the threshold.",
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
    // TRUE, as on the alert toggle above.
    defaultValue: true,
    collapsibleSection: incidentAdvancedSection,
    stepId: "incident-details",
  },
  {
    field: {
      isIncidentPrivate: true,
    },
    title: "Private Incident",
    description:
      "Only the incident's owners, project admins and project owners can see it.",
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
    collapsibleSection: incidentAdvancedSection,
    stepId: "incident-details",
  },
  {
    field: {
      incidentRemediationNotes: true,
    },
    title: "Incident Remediation Notes",
    description: "Steps for whoever picks the incident up, in Markdown.",
    fieldType: FormFieldSchemaType.Markdown,
    templateVariables: SLO_BURN_RATE_TEMPLATE_VARIABLE_GROUPS,
    templateVariablesDescription: BURN_RATE_TEMPLATE_VARIABLES_DESCRIPTION,
    required: false,
    validation: {
      maxLength: SLO_BURN_RATE_MARKDOWN_TEMPLATE_MAX_LENGTH,
    },
    collapsibleSection: incidentAdvancedSection,
    stepId: "incident-details",
  },
];

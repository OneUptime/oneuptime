import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Team from "Common/Models/DatabaseModels/Team";
import {
  DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE,
  SLO_BURN_RATE_MARKDOWN_TEMPLATE_MAX_LENGTH,
  SLO_BURN_RATE_TEMPLATE_VARIABLES,
  SLO_BURN_RATE_TITLE_TEMPLATE_MAX_LENGTH,
  SloBurnRateTemplateVariableDefinition,
} from "Common/Utils/Slo/SloBurnRateTemplate";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import type { ModelField } from "Common/UI/Components/Forms/ModelForm";
import type { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import type { FormStep } from "Common/UI/Components/Forms/Types/FormStep";

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
 * The same constraint is why nothing here fetches anything: the owner-user
 * picker needs ProjectUser and ProjectUtil, which reach ModelAPI and read
 * `window` at module load, so the page injects that loader through
 * withOwnerUserDropdownOptions instead of this module importing it.
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
    const lines: Array<string> = [];

    type DescribeOutputFunction = (data: {
      label: string;
      isPrivate: boolean | undefined;
      autoResolve: boolean | undefined;
    }) => void;

    const describeOutput: DescribeOutputFunction = (data: {
      label: string;
      isPrivate: boolean | undefined;
      autoResolve: boolean | undefined;
    }): void => {
      const options: Array<string> = [];

      if (data.autoResolve === false) {
        options.push("resolved by hand");
      }

      if (data.isPrivate === true) {
        options.push("private");
      }

      if (options.length > 0) {
        lines.push(`${data.label}: ${options.join(", ")}`);
      }
    };

    const createsAlert: boolean = willCreateAlert(rule);
    const createsIncident: boolean = willDeclareIncident(rule);

    if (createsAlert) {
      describeOutput({
        label: "Alert",
        isPrivate: rule.isAlertPrivate,
        autoResolve: rule.autoResolveAlert,
      });
    }

    if (createsIncident) {
      describeOutput({
        label: "Incident",
        isPrivate: rule.isIncidentPrivate,
        autoResolve: rule.autoResolveIncident,
      });
    }

    if (
      rule.addSloOwnersAsOwners === true &&
      (createsAlert || createsIncident)
    ) {
      lines.push("SLO owners added as owners");
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
 * Named in the descriptions of every template field. Three is enough to show
 * the shape; the help panel carries the full table.
 */
const TEMPLATE_VARIABLES_HINT: string =
  'Supports template variables such as {{sloName}}, {{ruleName}} and {{longWindowBurnRate}} - see "How Burn Rate Rules Work" for the full list.';

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

const alertAdvancedSection: FormFieldCollapsibleSection<ServiceLevelObjectiveBurnRateRule> =
  {
    id: "alert-advanced",
    title: "Advanced Options",
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
  };

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
  {
    id: "incident-advanced",
    title: "Advanced Options",
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
   * Both toggles, on one step, before any per-output step. The validator that
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
      "Also add this SLO's owners - its owner users and the members of its owner teams - as owners of every alert and incident this rule creates. SLO owners are already notified when the SLO's status changes, so turning this on can notify them twice.",
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
    stepId: "declares",
  },
  {
    field: {
      alertTitleTemplate: true,
    },
    title: "Alert Title",
    description: `Title of the alert this rule raises. ${TEMPLATE_VARIABLES_HINT} Leave empty to use the default: ${DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE}`,
    fieldType: FormFieldSchemaType.Text,
    required: false,
    placeholder: DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE,
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
    description: `Description of the alert, in Markdown. ${TEMPLATE_VARIABLES_HINT} Leave empty to use the default, which states both burn rates, the threshold and the error budget remaining.`,
    fieldType: FormFieldSchemaType.Markdown,
    required: false,
    validation: {
      maxLength: SLO_BURN_RATE_MARKDOWN_TEMPLATE_MAX_LENGTH,
    },
    collapsibleSection: alertDescriptionSection,
    stepId: "alert-details",
  },
  {
    field: {
      alertOwnerTeams: true,
    },
    title: "Alert Owner Teams",
    description:
      "Teams added as owners of the alert. Owners are notified when the alert is created.",
    fieldType: FormFieldSchemaType.MultiSelectDropdown,
    dropdownModal: {
      type: Team,
      labelField: "name",
      valueField: "_id",
    },
    required: false,
    placeholder: "Select Teams (optional)",
    collapsibleSection: alertOwnershipSection,
    stepId: "alert-details",
  },
  /*
   * No dropdownModal: User is not a project-listable model, so its options
   * come from the project's team members, which the page injects through
   * withOwnerUserDropdownOptions (this module must not fetch).
   */
  {
    field: {
      alertOwnerUsers: true,
    },
    title: "Alert Owner Users",
    description:
      "Users added as owners of the alert. Owners are notified when the alert is created.",
    fieldType: FormFieldSchemaType.MultiSelectDropdown,
    required: false,
    placeholder: "Select Users (optional)",
    collapsibleSection: alertOwnershipSection,
    stepId: "alert-details",
  },
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
    placeholder: "Select Labels (optional)",
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
    placeholder: "Select On-Call Policies (optional)",
    collapsibleSection: alertOnCallSection,
    stepId: "alert-details",
  },
  {
    field: {
      autoResolveAlert: true,
    },
    title: "Auto Resolve Alert",
    description:
      "Resolve the alert automatically when the burn rate over the long window drops back below the threshold. Turn this off to keep the alert open until someone resolves it - the rule will not raise another alert while it is open.",
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
    description: `Steps for whoever picks the alert up, in Markdown. ${TEMPLATE_VARIABLES_HINT}`,
    fieldType: FormFieldSchemaType.Markdown,
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
    description: `Title of the incident this rule declares. ${TEMPLATE_VARIABLES_HINT} Leave empty to use the default: ${DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE}`,
    fieldType: FormFieldSchemaType.Text,
    required: false,
    placeholder: DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE,
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
    description: `Description of the incident, in Markdown. ${TEMPLATE_VARIABLES_HINT} Leave empty to use the default, which states both burn rates, the threshold and the error budget remaining.`,
    fieldType: FormFieldSchemaType.Markdown,
    required: false,
    validation: {
      maxLength: SLO_BURN_RATE_MARKDOWN_TEMPLATE_MAX_LENGTH,
    },
    collapsibleSection: incidentDescriptionSection,
    stepId: "incident-details",
  },
  {
    field: {
      incidentOwnerTeams: true,
    },
    title: "Incident Owner Teams",
    description:
      "Teams added as owners of the incident. Owners are notified when the incident is declared.",
    fieldType: FormFieldSchemaType.MultiSelectDropdown,
    dropdownModal: {
      type: Team,
      labelField: "name",
      valueField: "_id",
    },
    required: false,
    placeholder: "Select Teams (optional)",
    collapsibleSection: incidentOwnershipSection,
    stepId: "incident-details",
  },
  {
    field: {
      incidentOwnerUsers: true,
    },
    title: "Incident Owner Users",
    description:
      "Users added as owners of the incident. Owners are notified when the incident is declared.",
    fieldType: FormFieldSchemaType.MultiSelectDropdown,
    required: false,
    placeholder: "Select Users (optional)",
    collapsibleSection: incidentOwnershipSection,
    stepId: "incident-details",
  },
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
    placeholder: "Select Labels (optional)",
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
    placeholder: "Select On-Call Policies (optional)",
    collapsibleSection: incidentOnCallSection,
    stepId: "incident-details",
  },
  {
    field: {
      autoResolveIncident: true,
    },
    title: "Auto Resolve Incident",
    description:
      "Resolve the incident automatically when the burn rate over the long window drops back below the threshold. Turn this off to keep the incident open until someone resolves it - the rule will not declare another incident while it is open.",
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
    description: `Steps for whoever picks the incident up, in Markdown. ${TEMPLATE_VARIABLES_HINT}`,
    fieldType: FormFieldSchemaType.Markdown,
    required: false,
    validation: {
      maxLength: SLO_BURN_RATE_MARKDOWN_TEMPLATE_MAX_LENGTH,
    },
    collapsibleSection: incidentAdvancedSection,
    stepId: "incident-details",
  },
];

// The two fields whose options only the page can load.
export const BURN_RATE_RULE_OWNER_USER_COLUMNS: ReadonlyArray<string> = [
  "alertOwnerUsers",
  "incidentOwnerUsers",
];

export type FetchBurnRateRuleOwnerUserOptionsFunction = NonNullable<
  ModelField<ServiceLevelObjectiveBurnRateRule>["fetchDropdownOptions"]
>;

export type WithOwnerUserDropdownOptionsFunction = (
  fields: Array<ModelField<ServiceLevelObjectiveBurnRateRule>>,
  fetchOptions: FetchBurnRateRuleOwnerUserOptionsFunction,
) => Array<ModelField<ServiceLevelObjectiveBurnRateRule>>;

/*
 * Hands the owner-user fields their option loader, and leaves every other
 * field - and the input array - untouched. A MultiSelectDropdown with neither
 * a dropdownModal nor a loader renders an empty list, which reads as "this
 * project has no users" rather than as a bug, so the page must not forget this.
 */
export const withOwnerUserDropdownOptions: WithOwnerUserDropdownOptionsFunction =
  (
    fields: Array<ModelField<ServiceLevelObjectiveBurnRateRule>>,
    fetchOptions: FetchBurnRateRuleOwnerUserOptionsFunction,
  ): Array<ModelField<ServiceLevelObjectiveBurnRateRule>> => {
    return fields.map(
      (
        field: ModelField<ServiceLevelObjectiveBurnRateRule>,
      ): ModelField<ServiceLevelObjectiveBurnRateRule> => {
        const columns: Array<string> = Object.keys(
          (field.field || {}) as Record<string, unknown>,
        );

        const isOwnerUserField: boolean = columns.some(
          (column: string): boolean => {
            return BURN_RATE_RULE_OWNER_USER_COLUMNS.includes(column);
          },
        );

        if (!isOwnerUserField) {
          return field;
        }

        return {
          ...field,
          fetchDropdownOptions: fetchOptions,
        };
      },
    );
  };

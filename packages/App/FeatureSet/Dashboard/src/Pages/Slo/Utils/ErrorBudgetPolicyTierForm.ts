import ServiceLevelObjectiveErrorBudgetPolicyTier from "Common/Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import IconProp from "Common/Types/Icon/IconProp";
import {
  DEFAULT_SLO_POLICY_TIER_DESCRIPTION_TEMPLATE,
  DEFAULT_SLO_POLICY_TIER_TITLE_TEMPLATE,
  SLO_POLICY_TIER_TEMPLATE_VARIABLE_GROUPS,
} from "Common/Utils/Slo/SloBurnRateTemplate";
import {
  SLO_POLICY_TIER_MAX_THRESHOLD_PERCENTAGE,
  SLO_POLICY_TIER_MIN_THRESHOLD_PERCENTAGE,
  SLO_POLICY_TIER_WHAT_WE_DO_MAX_LENGTH,
} from "Common/Utils/Slo/SloErrorBudgetPolicy";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import type FormValues from "Common/UI/Components/Forms/Types/FormValues";
import type { ModelField } from "Common/UI/Components/Forms/ModelForm";
import type { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  SloRecordOutputCopy,
  SloRecordOutputFieldGroup,
  SloRecordOutputFieldPlacement,
  SloRecordOutputOptionFlags,
  SloRecordOutputs,
  describeSloRecordOutputOptions,
  describeSloRecordOutputs,
  getSloAlertOutputFormFields,
  getSloIncidentOutputFormFields,
} from "./SloRecordOutputForm";

/*
 * THE FORM OF A TIER OF AN SLO'S ERROR BUDGET POLICY.
 *
 * A tier is a level of budget left and what the team agreed to do there
 * (Common/Utils/Slo/SloErrorBudgetPolicy), so the form asks exactly that
 * first: its Name, its Budget Left Threshold (%) and What We Do. Most tiers
 * stop there - a policy is an agreement, not a page.
 *
 * The alert and incident a tier can raise when the SLO enters it are folded
 * away in one section, both switched off, as the columns default: open it,
 * switch one on, and that output's fields - the same ones a burn rate rule
 * asks, built by SloRecordOutputForm with the tier's own template variables
 * and defaults - appear under its switch. A tier may raise nothing at all,
 * so nothing here asks for an output the way a burn rate rule must have one.
 *
 * React-free, like the rest of Pages/Slo/Utils, so App's tests can read it
 * without the page (FeatureSetImportsStayReactFree).
 */

type TierValues = FormValues<ServiceLevelObjectiveErrorBudgetPolicyTier>;

/*
 * Whether a tier raises each record. `=== true` for both: the two columns
 * default to false on a tier, so a tier read without them raises nothing -
 * unlike a burn rate rule, whose alert defaults on (willCreateAlert).
 */
export interface PolicyTierOutputFlags {
  shouldCreateAlert?: boolean | undefined;
  shouldCreateIncident?: boolean | undefined;
}

export type ReadsPolicyTierOutputFlagFunction = (
  tier: PolicyTierOutputFlags,
) => boolean;

export const policyTierCreatesAlert: ReadsPolicyTierOutputFlagFunction = (
  tier: PolicyTierOutputFlags,
): boolean => {
  return tier.shouldCreateAlert === true;
};

export const policyTierDeclaresIncident: ReadsPolicyTierOutputFlagFunction = (
  tier: PolicyTierOutputFlags,
): boolean => {
  return tier.shouldCreateIncident === true;
};

type GetPolicyTierOutputsFunction = (
  tier: PolicyTierOutputFlags,
) => SloRecordOutputs;

const getPolicyTierOutputs: GetPolicyTierOutputsFunction = (
  tier: PolicyTierOutputFlags,
): SloRecordOutputs => {
  return {
    createsAlert: policyTierCreatesAlert(tier),
    createsIncident: policyTierDeclaresIncident(tier),
  };
};

export type DescribePolicyTierOutputsFunction = (
  tier: PolicyTierOutputFlags,
) => string;

// What a tier raises, as the tiers table's label: Nothing, Alert, Incident or both.
export const describePolicyTierOutputs: DescribePolicyTierOutputsFunction = (
  tier: PolicyTierOutputFlags,
): string => {
  return describeSloRecordOutputs(getPolicyTierOutputs(tier));
};

export interface PolicyTierOptionFlags
  extends PolicyTierOutputFlags,
    SloRecordOutputOptionFlags {}

export type DescribePolicyTierOutputOptionsFunction = (
  tier: PolicyTierOptionFlags,
) => Array<string>;

// The options of what it raises that its label does not say (SloRecordOutputForm).
export const describePolicyTierOutputOptions: DescribePolicyTierOutputOptionsFunction =
  (tier: PolicyTierOptionFlags): Array<string> => {
    return describeSloRecordOutputOptions(tier, getPolicyTierOutputs(tier));
  };

/*
 * Under each template field's variables: when they are filled in. A tier's
 * fields offer the SLO's variables and the tier's own, not a rule's
 * (SLO_POLICY_TIER_TEMPLATE_VARIABLE_GROUPS).
 */
export const POLICY_TIER_TEMPLATE_VARIABLES_DESCRIPTION: string =
  translationKey(
    "When the SLO enters this tier, these variables are filled in with the SLO's values at that moment.",
  );

const POLICY_TIER_ALERT_COPY: SloRecordOutputCopy = {
  titleDescription: translationKey(
    "Title of the alert this tier raises. Leave empty to use the default: {{defaultTitle}}",
  ),
  severityDescription: translationKey(
    "Severity of the alert this tier raises. Defaults to the project's most severe.",
  ),
  descriptionDescription: translationKey(
    "Description of the alert, in Markdown. Leave empty to use the default, which names the tier, gives the budget left and says what the team agreed to do.",
  ),
  onCallDescription: translationKey(
    "On-call policies to execute when this tier raises an alert.",
  ),
  autoResolveDescription: translationKey(
    "Resolve the alert when the SLO recovers to a less severe tier, or out of every tier.",
  ),
};

const POLICY_TIER_INCIDENT_COPY: SloRecordOutputCopy = {
  titleDescription: translationKey(
    "Title of the incident this tier declares. Leave empty to use the default: {{defaultTitle}}",
  ),
  severityDescription: translationKey(
    "Severity of the incident this tier declares. Defaults to the project's most severe.",
  ),
  descriptionDescription: translationKey(
    "Description of the incident, in Markdown. Leave empty to use the default, which names the tier, gives the budget left and says what the team agreed to do.",
  ),
  onCallDescription: translationKey(
    "On-call policies to execute when this tier declares an incident. Kept separate from the alert policies so the two can escalate differently.",
  ),
  autoResolveDescription: translationKey(
    "Resolve the incident when the SLO recovers to a less severe tier, or out of every tier.",
  ),
};

/*
 * What the folded section says the tier raises, in one sentence: the form
 * says what will happen without being opened.
 */
export const POLICY_TIER_OUTPUTS_SUMMARY: Record<
  "nothing" | "alert" | "incident" | "both",
  string
> = {
  nothing: translationKey(
    "Raises no alert or incident: the tier records and shows what the team agreed to do.",
  ),
  alert: translationKey("Raises an alert when the SLO enters this tier."),
  incident: translationKey(
    "Declares an incident when the SLO enters this tier.",
  ),
  both: translationKey(
    "Raises an alert and declares an incident when the SLO enters this tier.",
  ),
};

export type GetPolicyTierOutputsSummaryFunction = (
  values: TierValues,
) => Array<string>;

export const getPolicyTierOutputsSummary: GetPolicyTierOutputsSummaryFunction =
  (values: TierValues): Array<string> => {
    const outputs: SloRecordOutputs = getPolicyTierOutputs(values);

    if (outputs.createsAlert && outputs.createsIncident) {
      return [POLICY_TIER_OUTPUTS_SUMMARY.both];
    }

    if (outputs.createsIncident) {
      return [POLICY_TIER_OUTPUTS_SUMMARY.incident];
    }

    if (outputs.createsAlert) {
      return [POLICY_TIER_OUTPUTS_SUMMARY.alert];
    }

    return [POLICY_TIER_OUTPUTS_SUMMARY.nothing];
  };

export const POLICY_TIER_OUTPUTS_SECTION_ID: string = "policy-tier-outputs";

/*
 * The one folded section both outputs live in. Folded on a new tier, which
 * raises nothing; it opens by itself on a tier that raises something, so a
 * switched-on alert is never hidden behind a fold. The prefilled templates
 * do not count as set: they are what every tier starts with.
 */
export const POLICY_TIER_OUTPUTS_SECTION: FormFieldCollapsibleSection<ServiceLevelObjectiveErrorBudgetPolicyTier> =
  {
    id: POLICY_TIER_OUTPUTS_SECTION_ID,
    title: "Alerts and incidents",
    description: "What OneUptime raises when the SLO enters this tier.",
    icon: IconProp.Bell,
    isConfigured: (values: TierValues): boolean => {
      return (
        policyTierCreatesAlert(values) || policyTierDeclaresIncident(values)
      );
    },
    getSummary: (values: TierValues): Array<string> => {
      return getPolicyTierOutputsSummary(values);
    },
  };

type PolicyTierPlacementFunction = (
  showIf: (values: TierValues) => boolean,
) => SloRecordOutputFieldPlacement<ServiceLevelObjectiveErrorBudgetPolicyTier>;

// Every field of an output in the one section, shown while its switch is on.
const getPolicyTierOutputPlacement: PolicyTierPlacementFunction = (
  showIf: (values: TierValues) => boolean,
): SloRecordOutputFieldPlacement<ServiceLevelObjectiveErrorBudgetPolicyTier> => {
  return {
    sections: {
      [SloRecordOutputFieldGroup.Main]: POLICY_TIER_OUTPUTS_SECTION,
      [SloRecordOutputFieldGroup.Description]: POLICY_TIER_OUTPUTS_SECTION,
      [SloRecordOutputFieldGroup.Ownership]: POLICY_TIER_OUTPUTS_SECTION,
      [SloRecordOutputFieldGroup.OnCall]: POLICY_TIER_OUTPUTS_SECTION,
      [SloRecordOutputFieldGroup.Advanced]: POLICY_TIER_OUTPUTS_SECTION,
    },
    showIf: showIf,
  };
};

export const ERROR_BUDGET_POLICY_TIER_FORM_FIELDS: Array<
  ModelField<ServiceLevelObjectiveErrorBudgetPolicyTier>
> = [
  {
    field: {
      name: true,
    },
    title: "Name",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    placeholder: "Change freeze",
    // The column's line names the template variable, which is for the API.
    hideColumnDescription: true,
  },
  {
    field: {
      thresholdPercentage: true,
    },
    title: "Budget Left Threshold (%)",
    description:
      "The tier applies while this much of the error budget, or less, is left: 50 for half of it, 0 once it is spent.",
    fieldType: FormFieldSchemaType.Number,
    required: true,
    placeholder: "25",
    validation: {
      minValue: SLO_POLICY_TIER_MIN_THRESHOLD_PERCENTAGE,
      maxValue: SLO_POLICY_TIER_MAX_THRESHOLD_PERCENTAGE,
    },
  },
  {
    field: {
      whatWeDo: true,
    },
    title: "What We Do",
    description:
      "What the team agreed to do while the SLO is in this tier, in Markdown. It is shown on the SLO's Overview.",
    fieldType: FormFieldSchemaType.Markdown,
    required: true,
    placeholder:
      "For example: only reliability fixes ship until the budget recovers.",
    validation: {
      maxLength: SLO_POLICY_TIER_WHAT_WE_DO_MAX_LENGTH,
    },
  },
  /*
   * A new tier starts enabled (the column's default), so the switch is on
   * the Edit form only, as on every rule form.
   */
  {
    field: {
      isEnabled: true,
    },
    title: "Enabled",
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
    description:
      "Off takes this tier out of the policy, and resolves what it raised.",
    doNotShowWhenCreating: true,
    defaultValue: true,
  },
  /*
   * Folded: the two switches, each output's fields under its own, and the
   * switch that applies to both. Neither switch has a defaultValue - both
   * columns default to false, and BasicForm only applies a truthy one.
   */
  {
    field: {
      shouldCreateAlert: true,
    },
    title: "Create Alert",
    description: "Raise an alert when the SLO enters this tier.",
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
    collapsibleSection: POLICY_TIER_OUTPUTS_SECTION,
  },
  ...getSloAlertOutputFormFields<ServiceLevelObjectiveErrorBudgetPolicyTier>({
    templateVariables: SLO_POLICY_TIER_TEMPLATE_VARIABLE_GROUPS,
    templateVariablesDescription: POLICY_TIER_TEMPLATE_VARIABLES_DESCRIPTION,
    defaultTitleTemplate: DEFAULT_SLO_POLICY_TIER_TITLE_TEMPLATE,
    defaultDescriptionTemplate: DEFAULT_SLO_POLICY_TIER_DESCRIPTION_TEMPLATE,
    copy: POLICY_TIER_ALERT_COPY,
    placement: getPolicyTierOutputPlacement(policyTierCreatesAlert),
  }),
  {
    field: {
      shouldCreateIncident: true,
    },
    title: "Declare Incident",
    description: "Declare an incident when the SLO enters this tier.",
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
    collapsibleSection: POLICY_TIER_OUTPUTS_SECTION,
  },
  ...getSloIncidentOutputFormFields<ServiceLevelObjectiveErrorBudgetPolicyTier>(
    {
      templateVariables: SLO_POLICY_TIER_TEMPLATE_VARIABLE_GROUPS,
      templateVariablesDescription: POLICY_TIER_TEMPLATE_VARIABLES_DESCRIPTION,
      defaultTitleTemplate: DEFAULT_SLO_POLICY_TIER_TITLE_TEMPLATE,
      defaultDescriptionTemplate: DEFAULT_SLO_POLICY_TIER_DESCRIPTION_TEMPLATE,
      copy: POLICY_TIER_INCIDENT_COPY,
      placement: getPolicyTierOutputPlacement(policyTierDeclaresIncident),
    },
  ),
  // Applies to both outputs, so it shows while either is on.
  {
    field: {
      addSloOwnersAsOwners: true,
    },
    title: "Add SLO Owners as Owners",
    description:
      "Add this SLO's owners as owners of every alert and incident this tier raises. They may be notified twice.",
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
    collapsibleSection: POLICY_TIER_OUTPUTS_SECTION,
    showIf: (values: TierValues): boolean => {
      return (
        policyTierCreatesAlert(values) || policyTierDeclaresIncident(values)
      );
    },
  },
];

import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import type BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import type { TemplateVariableGroups } from "Common/Types/Template/TemplateVariable";
import {
  SLO_RECORD_OUTPUT_MARKDOWN_TEMPLATE_MAX_LENGTH,
  SLO_RECORD_OUTPUT_TITLE_TEMPLATE_MAX_LENGTH,
} from "Common/Utils/Slo/SloRecordOutputColumns";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import getOwnersFormField from "Common/UI/Components/PeoplePicker/OwnersFormField";
import type FormValues from "Common/UI/Components/Forms/Types/FormValues";
import type { ModelField } from "Common/UI/Components/Forms/ModelForm";
import type { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import type SelectFormFields from "Common/UI/Types/SelectEntityField";
import {
  translateTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE ALERT AND INCIDENT AN SLO RAISES, AS A FORM ASKS ABOUT THEM.
 *
 * Two kinds of record source raise them: a burn rate rule, when the budget
 * burns too fast, and a tier of the SLO's error budget policy, when the SLO
 * enters it. Both carry the same output columns under the same names
 * (Common/Utils/Slo/SloRecordOutputColumns), so both forms ask the same
 * questions about them - title, severity, description, owners, labels,
 * on-call policies, auto-resolve, privacy and remediation notes - from
 * these builders, over the form's own model.
 *
 * What differs between the two is said by the caller:
 *   - the template variables the fields offer, and the default title and
 *     description they are prefilled with;
 *   - the help lines that name what raises the record ("this rule", "this
 *     tier") and what its default says;
 *   - where the fields go: the burn rate rule form puts each output on a
 *     step of its own, with its optional fields grouped in folded sections;
 *     the tier form folds both outputs into one section, each output's
 *     fields shown while its switch is on.
 *
 * React-free, like the rest of Pages/Slo/Utils, so App's tests can read
 * the fields without the pages (FeatureSetImportsStayReactFree).
 */

// The two records an SLO raises.
export enum SloRecordOutput {
  Alert = "alert",
  Incident = "incident",
}

/*
 * The groups an output's fields come in: its title and severity, always
 * asked, then the optional ones.
 */
export enum SloRecordOutputFieldGroup {
  Main = "main",
  Description = "description",
  Ownership = "ownership",
  OnCall = "onCall",
  Advanced = "advanced",
}

/*
 * The output columns as a form holds them. A burn rate rule and a policy
 * tier name them alike, so the builders read either form's values as these.
 */
export interface SloRecordOutputFormValues {
  shouldCreateAlert?: unknown;
  shouldCreateIncident?: unknown;
  alertDescriptionTemplate?: unknown;
  alertOwnerTeams?: unknown;
  alertOwnerUsers?: unknown;
  alertLabels?: unknown;
  onCallDutyPolicies?: unknown;
  autoResolveAlert?: unknown;
  isAlertPrivate?: unknown;
  alertRemediationNotes?: unknown;
  incidentDescriptionTemplate?: unknown;
  incidentOwnerTeams?: unknown;
  incidentOwnerUsers?: unknown;
  incidentLabels?: unknown;
  incidentOnCallDutyPolicies?: unknown;
  autoResolveIncident?: unknown;
  isIncidentPrivate?: unknown;
  incidentRemediationNotes?: unknown;
}

export type ReadSloRecordOutputFormValuesFunction = <TModel>(
  values: FormValues<TModel>,
) => SloRecordOutputFormValues;

export const readSloRecordOutputFormValues: ReadSloRecordOutputFormValuesFunction =
  <TModel>(values: FormValues<TModel>): SloRecordOutputFormValues => {
    return (values || {}) as unknown as SloRecordOutputFormValues;
  };

type HasSelectionFunction = (selections: Array<unknown>) => boolean;

// Whether any of these pickers holds a pick.
const hasSelection: HasSelectionFunction = (
  selections: Array<unknown>,
): boolean => {
  return selections.some((selection: unknown): boolean => {
    return Array.isArray(selection) && selection.length > 0;
  });
};

// The column a field writes, in the form's own model.
function column<TModel>(name: string): SelectFormFields<TModel> {
  return { [name]: true } as SelectFormFields<TModel>;
}

// The folded sections one output's optional fields are grouped into.
export interface SloRecordOutputSections<TModel> {
  description: FormFieldCollapsibleSection<TModel>;
  ownership: FormFieldCollapsibleSection<TModel>;
  onCall: FormFieldCollapsibleSection<TModel>;
  advanced: FormFieldCollapsibleSection<TModel>;
}

/*
 * The alert's sections: its description, its ownership and labels, its
 * on-call policies, and More fields for auto-resolve, privacy and
 * remediation notes. Each opens when it holds something the reader set -
 * a true auto-resolve is what a new record source starts with, so only
 * turning it off counts.
 */
export function getSloAlertOutputSections<
  TModel,
>(): SloRecordOutputSections<TModel> {
  return {
    description: {
      id: "alert-description",
      title: "Description",
      description: "Optional alert description",
      isConfigured: (value: FormValues<TModel>): boolean => {
        return Boolean(
          readSloRecordOutputFormValues(value).alertDescriptionTemplate,
        );
      },
    },
    ownership: {
      id: "alert-ownership",
      title: "Ownership & Labels",
      description: "Assign owners and labels to the alert",
      isConfigured: (value: FormValues<TModel>): boolean => {
        const values: SloRecordOutputFormValues =
          readSloRecordOutputFormValues(value);

        return hasSelection([
          values.alertOwnerTeams,
          values.alertOwnerUsers,
          values.alertLabels,
        ]);
      },
    },
    onCall: {
      id: "alert-on-call",
      title: "On-Call",
      description: "Configure on-call policy escalation",
      isConfigured: (value: FormValues<TModel>): boolean => {
        return hasSelection([
          readSloRecordOutputFormValues(value).onCallDutyPolicies,
        ]);
      },
    },
    advanced: getAdvancedFormSection<TModel>({
      id: "alert-advanced",
      description: "Auto-resolve, privacy and remediation settings",
      isConfigured: (value: FormValues<TModel>): boolean => {
        const values: SloRecordOutputFormValues =
          readSloRecordOutputFormValues(value);

        return (
          values.autoResolveAlert === false ||
          values.isAlertPrivate === true ||
          Boolean(values.alertRemediationNotes)
        );
      },
    }),
  };
}

// The incident's sections, as the alert's.
export function getSloIncidentOutputSections<
  TModel,
>(): SloRecordOutputSections<TModel> {
  return {
    description: {
      id: "incident-description",
      title: "Description",
      description: "Optional incident description",
      isConfigured: (value: FormValues<TModel>): boolean => {
        return Boolean(
          readSloRecordOutputFormValues(value).incidentDescriptionTemplate,
        );
      },
    },
    ownership: {
      id: "incident-ownership",
      title: "Ownership & Labels",
      description: "Assign owners and labels to the incident",
      isConfigured: (value: FormValues<TModel>): boolean => {
        const values: SloRecordOutputFormValues =
          readSloRecordOutputFormValues(value);

        return hasSelection([
          values.incidentOwnerTeams,
          values.incidentOwnerUsers,
          values.incidentLabels,
        ]);
      },
    },
    onCall: {
      id: "incident-on-call",
      title: "On-Call",
      description: "Configure on-call policy escalation",
      isConfigured: (value: FormValues<TModel>): boolean => {
        return hasSelection([
          readSloRecordOutputFormValues(value).incidentOnCallDutyPolicies,
        ]);
      },
    },
    advanced: getAdvancedFormSection<TModel>({
      id: "incident-advanced",
      description: "Auto-resolve, privacy and remediation settings",
      isConfigured: (value: FormValues<TModel>): boolean => {
        const values: SloRecordOutputFormValues =
          readSloRecordOutputFormValues(value);

        return (
          values.autoResolveIncident === false ||
          values.isIncidentPrivate === true ||
          Boolean(values.incidentRemediationNotes)
        );
      },
    }),
  };
}

/*
 * The help lines that depend on what raises the record. English, wrapped in
 * translationKey() where they are written, and looked up when drawn.
 */
export interface SloRecordOutputCopy {
  // Under the title; {{defaultTitle}} is the default it is prefilled with.
  titleDescription: string;
  severityDescription: string;
  // Under the description: what the default description says.
  descriptionDescription: string;
  onCallDescription: string;
  autoResolveDescription: string;
}

/*
 * Where one output's fields go: a form step, the folded section each group
 * of them goes in (a group with none is not folded), and when they show.
 */
export interface SloRecordOutputFieldPlacement<TModel> {
  stepId?: string | undefined;
  sections?:
    | Partial<
        Record<SloRecordOutputFieldGroup, FormFieldCollapsibleSection<TModel>>
      >
    | undefined;
  showIf?: ((values: FormValues<TModel>) => boolean) | undefined;
}

export interface SloRecordOutputFormFieldsOptions<TModel> {
  templateVariables: TemplateVariableGroups;
  // Under each template field's variables.
  templateVariablesDescription: string;
  defaultTitleTemplate: string;
  defaultDescriptionTemplate: string;
  copy: SloRecordOutputCopy;
  placement: SloRecordOutputFieldPlacement<TModel>;
}

/*
 * Puts a field where the placement says. The field is changed in place, not
 * copied: a copy would read a description getter once, in the language of
 * the moment, instead of every time the form draws it.
 */
function place<TModel extends BaseModel>(
  field: ModelField<TModel>,
  group: SloRecordOutputFieldGroup,
  placement: SloRecordOutputFieldPlacement<TModel>,
): ModelField<TModel> {
  const section: FormFieldCollapsibleSection<TModel> | undefined =
    placement.sections?.[group];

  if (section) {
    field.collapsibleSection = section;
  }

  if (placement.showIf) {
    field.showIf = placement.showIf;
  }

  if (placement.stepId) {
    field.stepId = placement.stepId;
  }

  return field;
}

/*
 * The alert's fields, in the order the form asks them: what it says and how
 * serious it is, then who owns it, who is paged, and how it closes.
 */
export function getSloAlertOutputFormFields<TModel extends BaseModel>(
  options: SloRecordOutputFormFieldsOptions<TModel>,
): Array<ModelField<TModel>> {
  const copy: SloRecordOutputCopy = options.copy;
  const placement: SloRecordOutputFieldPlacement<TModel> = options.placement;

  return [
    place<TModel>(
      {
        field: column<TModel>("alertTitleTemplate"),
        title: "Alert Title",
        // A getter, so the form reads it in the language of the moment.
        get description(): string {
          return translateTemplate(copy.titleDescription, {
            defaultTitle: options.defaultTitleTemplate,
          });
        },
        fieldType: FormFieldSchemaType.Text,
        templateVariables: options.templateVariables,
        templateVariablesDescription: options.templateVariablesDescription,
        required: false,
        placeholder: options.defaultTitleTemplate,
        defaultValue: options.defaultTitleTemplate,
        validation: {
          maxLength: SLO_RECORD_OUTPUT_TITLE_TEMPLATE_MAX_LENGTH,
        },
      },
      SloRecordOutputFieldGroup.Main,
      placement,
    ),
    place<TModel>(
      {
        field: column<TModel>("alertSeverity"),
        title: "Alert Severity",
        description: copy.severityDescription,
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
      },
      SloRecordOutputFieldGroup.Main,
      placement,
    ),
    place<TModel>(
      {
        field: column<TModel>("alertDescriptionTemplate"),
        title: "Alert Description",
        description: copy.descriptionDescription,
        fieldType: FormFieldSchemaType.Markdown,
        templateVariables: options.templateVariables,
        templateVariablesDescription: options.templateVariablesDescription,
        defaultValue: options.defaultDescriptionTemplate,
        required: false,
        validation: {
          maxLength: SLO_RECORD_OUTPUT_MARKDOWN_TEMPLATE_MAX_LENGTH,
        },
      },
      SloRecordOutputFieldGroup.Description,
      placement,
    ),
    /*
     * People and teams in one picker, saved to the alertOwnerUsers and
     * alertOwnerTeams columns.
     */
    place<TModel>(
      getOwnersFormField<TModel>({
        fieldKey: "alertOwners",
        usersKey: "alertOwnerUsers",
        teamsKey: "alertOwnerTeams",
        title: "Alert Owners",
        description:
          "People and teams added as owners of the alert. Owners are notified when the alert is created.",
      }),
      SloRecordOutputFieldGroup.Ownership,
      placement,
    ),
    place<TModel>(
      {
        field: column<TModel>("alertLabels"),
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
      },
      SloRecordOutputFieldGroup.Ownership,
      placement,
    ),
    place<TModel>(
      {
        field: column<TModel>("onCallDutyPolicies"),
        title: "Alert On-Call Policies",
        description: copy.onCallDescription,
        fieldType: FormFieldSchemaType.MultiSelectDropdown,
        dropdownModal: {
          type: OnCallDutyPolicy,
          labelField: "name",
          valueField: "_id",
        },
        required: false,
        placeholder: "Select On-Call Policies",
      },
      SloRecordOutputFieldGroup.OnCall,
      placement,
    ),
    place<TModel>(
      {
        field: column<TModel>("autoResolveAlert"),
        title: "Auto Resolve Alert",
        description: copy.autoResolveDescription,
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        /*
         * The column default is TRUE, so the toggle has to say so: without
         * it a create form would show auto-resolve off while the row is
         * written on.
         */
        defaultValue: true,
      },
      SloRecordOutputFieldGroup.Advanced,
      placement,
    ),
    place<TModel>(
      {
        field: column<TModel>("isAlertPrivate"),
        title: "Private Alert",
        description:
          "Only the alert's owners, project admins and project owners can see it.",
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
      },
      SloRecordOutputFieldGroup.Advanced,
      placement,
    ),
    place<TModel>(
      {
        field: column<TModel>("alertRemediationNotes"),
        title: "Alert Remediation Notes",
        description: "Steps for whoever picks the alert up, in Markdown.",
        fieldType: FormFieldSchemaType.Markdown,
        templateVariables: options.templateVariables,
        templateVariablesDescription: options.templateVariablesDescription,
        required: false,
        validation: {
          maxLength: SLO_RECORD_OUTPUT_MARKDOWN_TEMPLATE_MAX_LENGTH,
        },
      },
      SloRecordOutputFieldGroup.Advanced,
      placement,
    ),
  ];
}

// The incident's fields, in the alert's order.
export function getSloIncidentOutputFormFields<TModel extends BaseModel>(
  options: SloRecordOutputFormFieldsOptions<TModel>,
): Array<ModelField<TModel>> {
  const copy: SloRecordOutputCopy = options.copy;
  const placement: SloRecordOutputFieldPlacement<TModel> = options.placement;

  return [
    place<TModel>(
      {
        field: column<TModel>("incidentTitleTemplate"),
        title: "Incident Title",
        // A getter, so the form reads it in the language of the moment.
        get description(): string {
          return translateTemplate(copy.titleDescription, {
            defaultTitle: options.defaultTitleTemplate,
          });
        },
        fieldType: FormFieldSchemaType.Text,
        templateVariables: options.templateVariables,
        templateVariablesDescription: options.templateVariablesDescription,
        required: false,
        placeholder: options.defaultTitleTemplate,
        defaultValue: options.defaultTitleTemplate,
        validation: {
          maxLength: SLO_RECORD_OUTPUT_TITLE_TEMPLATE_MAX_LENGTH,
        },
      },
      SloRecordOutputFieldGroup.Main,
      placement,
    ),
    place<TModel>(
      {
        field: column<TModel>("incidentSeverity"),
        title: "Incident Severity",
        description: copy.severityDescription,
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
      },
      SloRecordOutputFieldGroup.Main,
      placement,
    ),
    place<TModel>(
      {
        field: column<TModel>("incidentDescriptionTemplate"),
        title: "Incident Description",
        description: copy.descriptionDescription,
        fieldType: FormFieldSchemaType.Markdown,
        templateVariables: options.templateVariables,
        templateVariablesDescription: options.templateVariablesDescription,
        defaultValue: options.defaultDescriptionTemplate,
        required: false,
        validation: {
          maxLength: SLO_RECORD_OUTPUT_MARKDOWN_TEMPLATE_MAX_LENGTH,
        },
      },
      SloRecordOutputFieldGroup.Description,
      placement,
    ),
    // Saved to the incidentOwnerUsers and incidentOwnerTeams columns.
    place<TModel>(
      getOwnersFormField<TModel>({
        fieldKey: "incidentOwners",
        usersKey: "incidentOwnerUsers",
        teamsKey: "incidentOwnerTeams",
        title: "Incident Owners",
        description:
          "People and teams added as owners of the incident. Owners are notified when the incident is declared.",
      }),
      SloRecordOutputFieldGroup.Ownership,
      placement,
    ),
    place<TModel>(
      {
        field: column<TModel>("incidentLabels"),
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
      },
      SloRecordOutputFieldGroup.Ownership,
      placement,
    ),
    place<TModel>(
      {
        field: column<TModel>("incidentOnCallDutyPolicies"),
        title: "Incident On-Call Policies",
        description: copy.onCallDescription,
        fieldType: FormFieldSchemaType.MultiSelectDropdown,
        dropdownModal: {
          type: OnCallDutyPolicy,
          labelField: "name",
          valueField: "_id",
        },
        required: false,
        placeholder: "Select On-Call Policies",
      },
      SloRecordOutputFieldGroup.OnCall,
      placement,
    ),
    place<TModel>(
      {
        field: column<TModel>("autoResolveIncident"),
        title: "Auto Resolve Incident",
        description: copy.autoResolveDescription,
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        // TRUE, as on the alert toggle.
        defaultValue: true,
      },
      SloRecordOutputFieldGroup.Advanced,
      placement,
    ),
    place<TModel>(
      {
        field: column<TModel>("isIncidentPrivate"),
        title: "Private Incident",
        description:
          "Only the incident's owners, project admins and project owners can see it.",
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
      },
      SloRecordOutputFieldGroup.Advanced,
      placement,
    ),
    place<TModel>(
      {
        field: column<TModel>("incidentRemediationNotes"),
        title: "Incident Remediation Notes",
        description: "Steps for whoever picks the incident up, in Markdown.",
        fieldType: FormFieldSchemaType.Markdown,
        templateVariables: options.templateVariables,
        templateVariablesDescription: options.templateVariablesDescription,
        required: false,
        validation: {
          maxLength: SLO_RECORD_OUTPUT_MARKDOWN_TEMPLATE_MAX_LENGTH,
        },
      },
      SloRecordOutputFieldGroup.Advanced,
      placement,
    ),
  ];
}

// Which records a source raises, read with its own model's defaults.
export interface SloRecordOutputs {
  createsAlert: boolean;
  createsIncident: boolean;
}

export type DescribeSloRecordOutputsFunction = (
  outputs: SloRecordOutputs,
) => string;

/*
 * What a source raises, as the label a table shows. English; the page
 * translates the label it shows.
 */
export const describeSloRecordOutputs: DescribeSloRecordOutputsFunction = (
  outputs: SloRecordOutputs,
): string => {
  if (outputs.createsAlert && outputs.createsIncident) {
    return translationKey("Alert + Incident");
  }

  if (outputs.createsIncident) {
    return translationKey("Incident");
  }

  if (outputs.createsAlert) {
    return translationKey("Alert");
  }

  return translationKey("Nothing");
};

/*
 * The per-output options a reader of a table cannot infer from what the
 * source raises. Only departures from the column defaults are listed, and
 * only for an output the source raises: `=== false` for auto-resolve,
 * `=== true` for the private flags and for addSloOwnersAsOwners, so an
 * unselected column never invents an option.
 */
export interface SloRecordOutputOptionFlags {
  isAlertPrivate?: boolean | undefined;
  autoResolveAlert?: boolean | undefined;
  isIncidentPrivate?: boolean | undefined;
  autoResolveIncident?: boolean | undefined;
  addSloOwnersAsOwners?: boolean | undefined;
}

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

export type DescribeSloRecordOutputOptionsFunction = (
  flags: SloRecordOutputOptionFlags,
  outputs: SloRecordOutputs,
) => Array<string>;

export const describeSloRecordOutputOptions: DescribeSloRecordOutputOptionsFunction =
  (
    flags: SloRecordOutputOptionFlags,
    outputs: SloRecordOutputs,
  ): Array<string> => {
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

    if (outputs.createsAlert) {
      describeOutput({
        lines: ALERT_OPTION_LINES,
        isPrivate: flags.isAlertPrivate,
        autoResolve: flags.autoResolveAlert,
      });
    }

    if (outputs.createsIncident) {
      describeOutput({
        lines: INCIDENT_OPTION_LINES,
        isPrivate: flags.isIncidentPrivate,
        autoResolve: flags.autoResolveIncident,
      });
    }

    if (
      flags.addSloOwnersAsOwners === true &&
      (outputs.createsAlert || outputs.createsIncident)
    ) {
      lines.push(translationKey("SLO owners added as owners"));
    }

    return lines;
  };

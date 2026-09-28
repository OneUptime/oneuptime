import { PROJECT_SWITCHED_CHANNELS, getRuleTypeIcon } from "./ComplianceView";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import TeamComplianceSetting from "Common/Models/DatabaseModels/TeamComplianceSetting";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import ComplianceNotificationChannel from "Common/Types/Team/ComplianceNotificationChannel";
import ComplianceRule, {
  COMPLIANCE_CHANNEL_DEFINITIONS,
  COMPLIANCE_RULE_DEFINITIONS,
  ComplianceChannelDefinition,
  ComplianceRuleCategory,
  ComplianceRuleDefinition,
  ComplianceSeverityKind,
} from "Common/Types/Team/ComplianceRule";
import {
  CardSelectOption,
  CardSelectOptionGroup,
} from "Common/UI/Components/CardSelect/CardSelect";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { FormType, ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The create / edit form for one compliance rule, as a guided two-step
 * dialog: first WHAT every member must have (a card per rule kind, on-call
 * rules first because "will this person actually be paged" is the question
 * the page exists for), then HOW STRICT - which channel and which severities -
 * with a live sentence saying exactly what will be checked.
 *
 * Everything the form offers comes from the shared catalog
 * (Common/Types/Team/ComplianceRule), the same table the server evaluates
 * against, so a rule kind or channel added there shows up here without a
 * second list to keep in step.
 */

export const RULE_FORM_STEP_RULE: string = "rule";
export const RULE_FORM_STEP_SCOPE: string = "scope";

export const COMPLIANCE_RULE_FORM_STEPS: Array<
  FormStep<TeamComplianceSetting>
> = [
  { id: RULE_FORM_STEP_RULE, title: "Rule" },
  { id: RULE_FORM_STEP_SCOPE, title: "Scope" },
];

const toCardOption: (
  definition: ComplianceRuleDefinition,
) => CardSelectOption = (
  definition: ComplianceRuleDefinition,
): CardSelectOption => {
  return {
    value: definition.ruleType,
    title: definition.title,
    description: definition.description,
    icon: getRuleTypeIcon(definition.ruleType),
  };
};

export const getRuleTypeCardOptions: () => Array<CardSelectOptionGroup> =
  (): Array<CardSelectOptionGroup> => {
    const byCategory: (
      category: ComplianceRuleCategory,
    ) => Array<CardSelectOption> = (
      category: ComplianceRuleCategory,
    ): Array<CardSelectOption> => {
      return COMPLIANCE_RULE_DEFINITIONS.filter(
        (definition: ComplianceRuleDefinition): boolean => {
          return definition.category === category;
        },
      ).map(toCardOption);
    };

    return [
      {
        label: "On-call rules",
        options: byCategory(ComplianceRuleCategory.OnCallRule),
      },
      {
        label: "Notification methods",
        options: byCategory(ComplianceRuleCategory.NotificationMethod),
      },
    ];
  };

export const getChannelDropdownOptions: () => Array<DropdownOption> =
  (): Array<DropdownOption> => {
    return COMPLIANCE_CHANNEL_DEFINITIONS.map(
      (definition: ComplianceChannelDefinition): DropdownOption => {
        return {
          value: definition.channel,
          label: definition.label,
        };
      },
    );
  };

const getRuleType: (
  values: FormValues<TeamComplianceSetting>,
) => string | undefined = (
  values: FormValues<TeamComplianceSetting>,
): string | undefined => {
  const ruleType: unknown = values.ruleType;

  return typeof ruleType === "string" ? ruleType : undefined;
};

export const isSeverityFieldShown: (
  values: FormValues<TeamComplianceSetting>,
  kind: ComplianceSeverityKind,
) => boolean = (
  values: FormValues<TeamComplianceSetting>,
  kind: ComplianceSeverityKind,
): boolean => {
  return ComplianceRule.getSeverityKind(getRuleType(values)) === kind;
};

/*
 * Picking a different kind of rule drops the options that no longer apply,
 * so what the form holds is always what it shows: a channel stays with an
 * on-call rule, incident severities with an incident rule. (The settings
 * service clears them on save regardless; this keeps the live preview and
 * the saved rule telling the same story.)
 */
export const getValuesForRuleType: (
  values: FormValues<TeamComplianceSetting>,
  ruleType: string,
) => FormValues<TeamComplianceSetting> = (
  values: FormValues<TeamComplianceSetting>,
  ruleType: string,
): FormValues<TeamComplianceSetting> => {
  const next: FormValues<TeamComplianceSetting> = {
    ...values,
    ruleType: ruleType as TeamComplianceSetting["ruleType"],
  };

  /*
   * null, not undefined: the request body drops undefined keys, so an
   * undefined channel never reaches the server and an edited rule keeps the
   * channel it was saved with - even after the admin went to a method card
   * and back, and the form showed "Any channel". null is sent, and clears it.
   * (FormValues' types do not admit null for the column, which is nullable,
   * hence Object.assign.)
   */
  if (!ComplianceRule.supportsChannel(ruleType)) {
    Object.assign(next, { notificationChannel: null });
  }

  const kind: ComplianceSeverityKind | undefined =
    ComplianceRule.getSeverityKind(ruleType);

  if (kind !== ComplianceSeverityKind.Incident) {
    next.incidentSeverities = [];
  }

  if (kind !== ComplianceSeverityKind.Alert) {
    next.alertSeverities = [];
  }

  return next;
};

const countSelected: (value: unknown) => number = (value: unknown): number => {
  return Array.isArray(value) ? value.length : 0;
};

export interface RulePreviewText {
  title: string;
  sentence: string;
  notes: Array<string>;
}

/*
 * The sentence the preview shows. The form holds severity ids, not names, so
 * a scoped rule reads "for the 2 severities you selected" - still exactly what
 * will be checked, without a second fetch just to spell the names.
 */
export const getRulePreviewText: (
  values: FormValues<TeamComplianceSetting>,
) => RulePreviewText | null = (
  values: FormValues<TeamComplianceSetting>,
): RulePreviewText | null => {
  const ruleType: string | undefined = getRuleType(values);

  if (!ComplianceRule.isKnownRuleType(ruleType)) {
    return null;
  }

  const channel: string | null =
    ComplianceRule.supportsChannel(ruleType) &&
    ComplianceRule.isKnownChannel(values.notificationChannel)
      ? (values.notificationChannel as string)
      : null;

  const kind: ComplianceSeverityKind | undefined =
    ComplianceRule.getSeverityKind(ruleType);

  let selectedCount: number = 0;

  if (kind === ComplianceSeverityKind.Incident) {
    selectedCount = countSelected(values.incidentSeverities);
  }

  if (kind === ComplianceSeverityKind.Alert) {
    selectedCount = countSelected(values.alertSeverities);
  }

  const severityNames: Array<string> =
    selectedCount === 0
      ? []
      : [
          selectedCount === 1
            ? "the severity you selected"
            : `the ${selectedCount} severities you selected`,
        ];

  const notes: Array<string> = [];

  const definition: ComplianceRuleDefinition | undefined =
    ComplianceRule.getDefinition(ruleType);
  const switchedChannel: ComplianceNotificationChannel | undefined =
    (channel as ComplianceNotificationChannel | null) ||
    definition?.methodChannel;

  if (switchedChannel && PROJECT_SWITCHED_CHANNELS.includes(switchedChannel)) {
    notes.push(
      `${ComplianceRule.getChannelDefinition(switchedChannel)?.label || switchedChannel} notifications also have to be switched on for the project (Project Settings > Notification Settings), or nobody will be reached this way.`,
    );
  }

  if (values.enabled === false) {
    notes.push(
      "This rule is saved paused: it is listed but nobody is checked against it until you turn it on.",
    );
  }

  return {
    title: ComplianceRule.getTitle({
      ruleType: ruleType,
      notificationChannel: channel,
    }),
    sentence: ComplianceRule.describe({
      ruleType: ruleType,
      notificationChannel: channel,
      severityNames: severityNames,
    }),
    notes: notes,
  };
};

export const ComplianceRulePreview: FunctionComponent<{
  values: FormValues<TeamComplianceSetting>;
}> = (props: { values: FormValues<TeamComplianceSetting> }): ReactElement => {
  const preview: RulePreviewText | null = getRulePreviewText(props.values);

  if (!preview) {
    return <></>;
  }

  return (
    <div
      data-testid="compliance-rule-preview"
      aria-live="polite"
      className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        Members pass this rule when
      </p>
      <p
        data-testid="compliance-rule-preview-title"
        className="mt-1.5 text-sm font-semibold text-gray-900"
      >
        {preview.title}
      </p>
      <p
        data-testid="compliance-rule-preview-sentence"
        className="mt-0.5 text-sm leading-relaxed text-gray-600"
      >
        {preview.sentence}
      </p>
      {preview.notes.map((note: string, index: number): ReactElement => {
        return (
          <p
            key={`note-${index}`}
            className="mt-2 text-xs leading-relaxed text-gray-500"
          >
            {note}
          </p>
        );
      })}
    </div>
  );
};

export const getComplianceRuleFormFields: () => Array<
  ModelField<TeamComplianceSetting>
> = (): Array<ModelField<TeamComplianceSetting>> => {
  return [
    {
      field: {
        ruleType: true,
      },
      stepId: RULE_FORM_STEP_RULE,
      title: "What must every member have?",
      description:
        "On-call rules check that members will actually be paged; notification methods check they can be reached at all.",
      fieldType: FormFieldSchemaType.CardSelect,
      required: true,
      cardSelectOptions: getRuleTypeCardOptions(),
      /*
       * One column: the grid picks its column count from the VIEWPORT, so
       * inside the modal three columns squeeze each card to a few words a
       * line.
       */
      cardSelectSingleColumn: true,
      onChange: (
        value: string,
        currentValues: FormValues<TeamComplianceSetting>,
        setNewFormValues: (values: FormValues<TeamComplianceSetting>) => void,
      ): void => {
        setNewFormValues(getValuesForRuleType(currentValues, value));
      },
    },
    {
      field: {
        notificationChannel: true,
      },
      stepId: RULE_FORM_STEP_SCOPE,
      title: "Channel",
      description:
        "Require members' rules to notify them on this channel - Call, say, so a critical page rings their phone. Leave empty to accept any channel.",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: getChannelDropdownOptions(),
      placeholder: "Any channel",
      required: false,
      showIf: (values: FormValues<TeamComplianceSetting>): boolean => {
        return ComplianceRule.supportsChannel(getRuleType(values));
      },
    },
    {
      field: {
        incidentSeverities: true,
      },
      stepId: RULE_FORM_STEP_SCOPE,
      title: "Incident severities",
      description:
        "Members need a matching rule for each severity you pick. Leave empty to require every incident severity, including ones added later.",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: IncidentSeverity,
        labelField: "name",
        valueField: "_id",
      },
      placeholder: "All incident severities",
      required: false,
      showIf: (values: FormValues<TeamComplianceSetting>): boolean => {
        return isSeverityFieldShown(values, ComplianceSeverityKind.Incident);
      },
    },
    {
      field: {
        alertSeverities: true,
      },
      stepId: RULE_FORM_STEP_SCOPE,
      title: "Alert severities",
      description:
        "Members need a matching rule for each severity you pick. Leave empty to require every alert severity, including ones added later.",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: AlertSeverity,
        labelField: "name",
        valueField: "_id",
      },
      placeholder: "All alert severities",
      required: false,
      showIf: (values: FormValues<TeamComplianceSetting>): boolean => {
        return isSeverityFieldShown(values, ComplianceSeverityKind.Alert);
      },
    },
    {
      field: {
        enabled: true,
      },
      stepId: RULE_FORM_STEP_SCOPE,
      title: "Check members against this rule",
      description: "Paused rules stay listed but nobody is checked.",
      fieldType: FormFieldSchemaType.Toggle,
      defaultValue: true,
      required: false,
      getFooterElement: (
        values: FormValues<TeamComplianceSetting>,
      ): ReactElement => {
        return <ComplianceRulePreview values={values} />;
      },
    },
  ];
};

export interface ComponentProps {
  teamId: ObjectID;
  projectId: ObjectID | null;
  // Set to edit that rule; absent to create one.
  modelIdToEdit?: ObjectID | undefined;
  // Create only: what the form opens with (a recommended rule, say).
  initialValues?: FormValues<TeamComplianceSetting> | undefined;
  onClose: () => void;
  onSuccess: () => void;
}

export const getCreateInitialValues: (
  initialValues: FormValues<TeamComplianceSetting> | undefined,
) => FormValues<TeamComplianceSetting> = (
  initialValues: FormValues<TeamComplianceSetting> | undefined,
): FormValues<TeamComplianceSetting> => {
  return { enabled: true, ...(initialValues || {}) };
};

const ComplianceRuleFormModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isEditing: boolean = Boolean(props.modelIdToEdit);

  return (
    <ModelFormModal<TeamComplianceSetting>
      title={isEditing ? "Edit compliance rule" : "Add a compliance rule"}
      description={
        isEditing
          ? "Change what this rule checks. Every member is checked against the new version as soon as you save."
          : "Choose what every member of this team must have set up, then narrow it to the channel and severities that matter."
      }
      name={
        isEditing
          ? "Teams > Compliance > Edit Rule"
          : "Teams > Compliance > Add Rule"
      }
      modelType={TeamComplianceSetting}
      submitButtonText={isEditing ? "Save rule" : "Add rule"}
      initialValues={
        isEditing ? undefined : getCreateInitialValues(props.initialValues)
      }
      modelIdToEdit={props.modelIdToEdit}
      onClose={props.onClose}
      onSuccess={() => {
        props.onSuccess();
      }}
      onBeforeCreate={(
        item: TeamComplianceSetting,
      ): Promise<TeamComplianceSetting> => {
        if (!props.projectId) {
          throw new BadDataException("Project ID cannot be null");
        }

        item.teamId = props.teamId;
        item.projectId = props.projectId;

        return Promise.resolve(item);
      }}
      formProps={{
        id: "team-compliance-rule-form",
        name: isEditing
          ? "Teams > Compliance > Edit Rule"
          : "Teams > Compliance > Add Rule",
        modelType: TeamComplianceSetting,
        formType: isEditing ? FormType.Update : FormType.Create,
        fields: getComplianceRuleFormFields(),
        steps: COMPLIANCE_RULE_FORM_STEPS,
      }}
    />
  );
};

export default ComplianceRuleFormModal;

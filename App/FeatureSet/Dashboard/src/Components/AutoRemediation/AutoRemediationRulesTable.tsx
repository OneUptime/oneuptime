import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import AutoRemediationRule from "Common/Models/DatabaseModels/AutoRemediationRule";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import AutoRemediationExecutionMode from "Common/Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationTriggerEntity from "Common/Types/AutoRemediation/AutoRemediationTriggerEntity";
import { Blue, Green, Red, Yellow } from "Common/Types/BrandColors";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  triggerEntityType: AutoRemediationTriggerEntity;
  entityLabel: string; // "incident" | "alert"
}

const autoRemediationDocumentation: (entityLabel: string) => string = (
  entityLabel: string,
): string => {
  return `
### How Auto Remediation Rules Work

When a matching ${entityLabel} is created, the rule proposes — or starts — a remediation runbook. No one has to remember which runbook fixes what at 3am.

### Match Criteria

A rule matches when **all** specified criteria pass. Empty criteria are skipped.

- **Monitors** — the ${entityLabel} must come from one of the selected monitors.
- **Severities** — the ${entityLabel}'s severity must be one of the selected ones.
- **Labels** — the ${entityLabel} must carry at least one of the selected labels.
- **Monitor Labels** — the ${entityLabel}'s monitor must carry at least one of the selected labels. This is the natural way to scope a rule to an environment: label your staging monitors \`staging\` and your production monitors \`production\`, then scope full-auto rules to staging only.
- **Title / Description Pattern** — case-insensitive regex.

### Execution Modes

- **Suggest** (default) — the runbook is proposed on the ${entityLabel} and a human approves it with one click before anything runs.
- **Full Auto** — the runbook starts immediately, with no human in the loop. Use for well-tested runbooks in low-risk environments. A circuit breaker downgrades the rule to Suggest if it auto-executes more than 3 times in an hour.

### Let AI Pick the Runbook

Instead of always proposing the same runbook, the AI reads the ${entityLabel} and the surrounding telemetry, then picks the most applicable runbook from the attached candidates (or all enabled runbooks when none are attached) — or proposes nothing when none applies. AI-picked runbooks are **always suggest-only**: they never run without human approval, regardless of the execution mode.

### Guardrails

At most 3 suggestions per ${entityLabel}; a rule never re-proposes on the same ${entityLabel} (a dismissal is a "no"); AI planning is covered by the project's daily autonomous AI token budget; and auto-remediation can be disabled project-wide from Project Settings.
`;
};

const AutoRemediationRulesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isIncident: boolean =
    props.triggerEntityType === AutoRemediationTriggerEntity.Incident;

  return (
    <ModelTable<AutoRemediationRule>
      modelType={AutoRemediationRule}
      id={`auto-remediation-rules-table-${props.triggerEntityType}`}
      name={`Settings > Auto Remediation Rules > ${props.triggerEntityType}`}
      userPreferencesKey={`auto-remediation-rules-table-${props.triggerEntityType}`}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      query={{ triggerEntityType: props.triggerEntityType }}
      onBeforeCreate={async (item: AutoRemediationRule) => {
        item.triggerEntityType = props.triggerEntityType;
        return item;
      }}
      cardProps={{
        title: "Auto Remediation Rules",
        description: `Propose or start remediation runbooks automatically when matching ${props.entityLabel}s are created.`,
      }}
      helpContent={{
        title: "How Auto Remediation Rules Work",
        description: `Match ${props.entityLabel}s and remediate automatically — with a human in the loop by default.`,
        markdown: autoRemediationDocumentation(props.entityLabel),
      }}
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      selectMoreFields={{ isEnabled: true, aiSelectsRunbook: true }}
      filters={[
        { field: { name: true }, title: "Name", type: FieldType.Text },
        {
          field: { isEnabled: true },
          title: "Enabled",
          type: FieldType.Boolean,
        },
      ]}
      columns={[
        { field: { name: true }, title: "Name", type: FieldType.Text },
        {
          field: { executionMode: true },
          title: "Mode",
          type: FieldType.Text,
          getElement: (item: AutoRemediationRule): ReactElement => {
            if (item.aiSelectsRunbook) {
              return <Pill color={Blue} text="AI Suggest" />;
            }
            return item.executionMode ===
              AutoRemediationExecutionMode.FullAuto ? (
              <Pill color={Yellow} text="Full Auto" />
            ) : (
              <Pill color={Blue} text="Suggest" />
            );
          },
        },
        {
          field: { isEnabled: true },
          title: "Status",
          type: FieldType.Boolean,
          getElement: (item: AutoRemediationRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      viewPageRoute={Navigation.getCurrentRoute()}
      formSteps={[
        { title: "Basic Info", id: "basic-info" },
        { title: "Match Criteria", id: "match-criteria" },
        { title: "Remediation", id: "remediation" },
      ]}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Restart API pods on high error rate",
          validation: { minLength: 2 },
        },
        {
          field: { description: true },
          title: "Description",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
        },
        {
          field: { monitors: true },
          title: "Monitors",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription: `Filter ${props.entityLabel}s by monitor, severity and labels. Leave a filter empty to skip it.`,
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Monitor,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Monitors (optional)",
        },
        ...(isIncident
          ? [
              {
                field: { incidentSeverities: true },
                title: "Incident Severities",
                stepId: "match-criteria",
                fieldType: FormFieldSchemaType.MultiSelectDropdown,
                dropdownModal: {
                  type: IncidentSeverity,
                  labelField: "name",
                  valueField: "_id",
                },
                required: false,
                placeholder: "Select Severities (optional)",
              },
            ]
          : [
              {
                field: { alertSeverities: true },
                title: "Alert Severities",
                stepId: "match-criteria",
                fieldType: FormFieldSchemaType.MultiSelectDropdown,
                dropdownModal: {
                  type: AlertSeverity,
                  labelField: "name",
                  valueField: "_id",
                },
                required: false,
                placeholder: "Select Severities (optional)",
              },
            ]),
        {
          field: { labels: true },
          title: `${isIncident ? "Incident" : "Alert"} Labels`,
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Labels (optional)",
        },
        {
          field: { monitorLabels: true },
          title: "Monitor Labels",
          stepId: "match-criteria",
          description:
            "Scope by environment: only trigger when the monitor carries one of these labels (e.g. staging).",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Monitor Labels (optional)",
        },
        {
          field: { titlePattern: true },
          title: "Title Pattern",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription: "Case-insensitive regex. Leave empty to skip.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "database|postgres|db-",
        },
        {
          field: { descriptionPattern: true },
          title: "Description Pattern",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "timeout|connection refused",
        },
        {
          field: { runbooks: true },
          title: "Runbooks",
          stepId: "remediation",
          sectionTitle: "What to Run",
          sectionDescription:
            "Deterministic rules propose or start every selected runbook. AI rules pick the most applicable one from this list (or from all enabled runbooks when the list is empty).",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Runbook,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Runbooks",
        },
        {
          field: { aiSelectsRunbook: true },
          title: "Let AI Pick the Runbook",
          stepId: "remediation",
          description:
            "The AI reads the telemetry and picks the most applicable runbook — or proposes nothing when none applies. AI-picked runbooks are always suggest-only.",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
        },
        {
          field: { executionMode: true },
          title: "Execution Mode",
          stepId: "remediation",
          description:
            "Suggest waits for one-click human approval. Full Auto starts the runbook immediately (deterministic rules only — ignored when AI picks the runbook).",
          fieldType: FormFieldSchemaType.Dropdown,
          dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
            AutoRemediationExecutionMode,
          ),
          required: true,
          defaultValue: AutoRemediationExecutionMode.Suggest,
        },
      ]}
      showRefreshButton={true}
    />
  );
};

export default AutoRemediationRulesTable;

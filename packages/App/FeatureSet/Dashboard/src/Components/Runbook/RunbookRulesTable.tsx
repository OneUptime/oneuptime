import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import RunbookRule from "Common/Models/DatabaseModels/RunbookRule";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import RunbookRuleTriggerEntity from "Common/Types/Runbook/RunbookRuleTriggerEntity";
import { Green, Red } from "Common/Types/BrandColors";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  triggerEntityType: RunbookRuleTriggerEntity;
  entityLabel: string; // "incident", "alert", "scheduled maintenance event"
}

/*
 * The word the conditions put before "Labels", "Title" and "Description",
 * matching the other rules of the same product: "Incident Labels" on
 * incident rules, "Alert Labels" on alert rules, "Event Labels" on scheduled
 * maintenance rules.
 */
export function getRunbookRuleCriteriaSubject(
  triggerEntityType: RunbookRuleTriggerEntity,
): string {
  switch (triggerEntityType) {
    case RunbookRuleTriggerEntity.Alert:
      return "Alert";
    case RunbookRuleTriggerEntity.ScheduledMaintenance:
      return "Event";
    default:
      return "Incident";
  }
}

/*
 * How a rule's monitors relate to what it matches: an incident or a scheduled
 * maintenance event affects monitors, an alert is raised by one.
 */
function getMonitorsLine(data: {
  triggerEntityType: RunbookRuleTriggerEntity;
  entityLabel: string;
}): string {
  if (data.triggerEntityType === RunbookRuleTriggerEntity.Alert) {
    return `the ${data.entityLabel} was raised by one of the selected monitors.`;
  }

  return `the ${data.entityLabel} affects one of the selected monitors.`;
}

export function getRunbookRuleDocumentation(data: {
  triggerEntityType: RunbookRuleTriggerEntity;
  entityLabel: string;
}): string {
  const subject: string = getRunbookRuleCriteriaSubject(data.triggerEntityType);
  const entityLabel: string = data.entityLabel;
  const severityLine: string =
    data.triggerEntityType === RunbookRuleTriggerEntity.ScheduledMaintenance
      ? ""
      : `\n- **${subject} Severities** — the ${entityLabel}'s severity is one of the selected severities.`;

  return `
### How Runbook Rules Work

Runbook rules attach runbooks to ${entityLabel}s automatically when they are created — no one has to remember to kick them off.

### What Conditions Can Check

- **Monitors** — ${getMonitorsLine(data)}${severityLine}
- **${subject} Labels** — the ${entityLabel} carries one of the selected labels.
- **Monitor Labels** — one of the ${entityLabel}'s monitors carries one of the selected labels. Label monitors \`production\` or \`staging\` to run a runbook for one environment only.
- **${subject} Title**, **${subject} Description** — the text of the ${entityLabel}.
- **Monitor Name**, **Monitor Description** — the name or description of one of the ${entityLabel}'s monitors. Monitor conditions are checked one monitor at a time: with Match all, a single monitor has to meet all of them.

### Match Criteria

Add conditions to choose which ${entityLabel}s start the runbooks. A rule with no conditions starts them for every ${entityLabel}.

### Action

When a rule matches, every selected runbook starts its own execution attached to the ${entityLabel}. You'll find the runs on the ${entityLabel}'s page and under **Runbooks → Executions**. Multiple matching rules all fire — the union of their runbooks starts.
`;
}

const RunbookRulesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const criteriaSubject: string = getRunbookRuleCriteriaSubject(
    props.triggerEntityType,
  );

  return (
    <ModelTable<RunbookRule>
      modelType={RunbookRule}
      id={`runbook-rules-table-${props.triggerEntityType}`}
      name={`Settings > Runbook Rules > ${props.triggerEntityType}`}
      userPreferencesKey={`runbook-rules-table-${props.triggerEntityType}`}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      query={{ triggerEntityType: props.triggerEntityType }}
      onBeforeCreate={async (item: RunbookRule) => {
        item.triggerEntityType = props.triggerEntityType;
        return item;
      }}
      cardProps={{
        title: "Runbook Rules",
        description: `Auto-attach runbooks when matching ${props.entityLabel}s are created.`,
      }}
      helpContent={{
        title: "How Runbook Rules Work",
        description: `Match ${props.entityLabel}s and start runbooks automatically.`,
        markdown: getRunbookRuleDocumentation({
          triggerEntityType: props.triggerEntityType,
          entityLabel: props.entityLabel,
        }),
      }}
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      selectMoreFields={{ isEnabled: true }}
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
          field: { description: true },
          title: "Description",
          type: FieldType.Text,
        },
        {
          field: { isEnabled: true },
          title: "Status",
          type: FieldType.Boolean,
          getElement: (item: RunbookRule): ReactElement => {
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
        { title: "Runbooks", id: "runbooks" },
      ]}
      /*
       * The criteria the other rules of the same product offer, in the same
       * order and words (Types/Runbook/RunbookRuleCriteria lists them per
       * trigger): severities exist for incidents and alerts only.
       */
      formFields={[
        {
          field: { name: true },
          title: "Name",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Start DB-failover runbook for database incidents",
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
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Monitor,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Monitors (optional)",
        },
        ...(props.triggerEntityType === RunbookRuleTriggerEntity.Incident
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
          : []),
        ...(props.triggerEntityType === RunbookRuleTriggerEntity.Alert
          ? [
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
            ]
          : []),
        {
          field: { labels: true },
          title: `${criteriaSubject} Labels`,
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
          title: `${criteriaSubject} Title`,
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "database|postgres|db-",
        },
        {
          field: { descriptionPattern: true },
          title: `${criteriaSubject} Description`,
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "timeout|connection refused",
        },
        {
          field: { monitorNamePattern: true },
          title: "Monitor Name",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "prod-.*",
        },
        {
          field: { monitorDescriptionPattern: true },
          title: "Monitor Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        {
          field: { runbooks: true },
          title: "Runbooks to Start",
          stepId: "runbooks",
          sectionTitle: "Action",
          sectionDescription:
            "When this rule matches, every selected runbook starts its own execution attached to the event.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Runbook,
            labelField: "name",
            valueField: "_id",
          },
          required: true,
          placeholder: "Select Runbooks",
        },
      ]}
      showRefreshButton={true}
    />
  );
};

export default RunbookRulesTable;

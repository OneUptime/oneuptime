import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import IncidentSlaRule from "Common/Models/DatabaseModels/IncidentSlaRule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import { INCIDENT_SLA_NOTE_TEMPLATE_VARIABLE_GROUPS } from "Common/Utils/Incident/IncidentSlaNoteTemplateVariables";
import IncidentSlaNoteReminderCopy from "../../../Components/Incident/IncidentSlaNoteReminderCopy";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import {
  SLA_RULE_NAME_DESCRIPTION,
  clearEmptiedSlaRuleMinutes,
  followValueWithRuleName,
  getNewSlaRuleValues,
  getSlaRuleFormSteps,
  getSlaRuleName,
} from "../../../Utils/Form/EventRuleForm";
import { RULE_NAME_MAX_LENGTH } from "../../../Utils/Form/ResourceRuleForm";

/*
 * What most SLA rules leave alone, folded under More fields at the end of
 * the Targets step: when the SLA counts as at risk, the description, and
 * the notes it can post while the incident is open. Built once, so the
 * form folds the fields together.
 */
const SLA_RULE_MORE_FIELDS: FormFieldCollapsibleSection<IncidentSlaRule> =
  getAdvancedFormSection<IncidentSlaRule>();

const documentationMarkdown: string = `
### How Incident SLA Rules Work

An SLA (Service Level Agreement) rule sets how long the team has to acknowledge and to resolve an incident. When an incident is created, the first rule that matches it applies, and its deadlines start from the moment the incident was declared.

\`\`\`mermaid
flowchart TD
    A[New Incident Created] --> B{Match Against SLA Rules}
    B -->|Rule Matches| C[Create SLA Record]
    B -->|No Match| D[No SLA Tracking]
    C --> E[Calculate Deadlines]
    E --> F[Track Response Time]
    E --> G[Track Resolution Time]
    F --> H{Response Deadline Met?}
    G --> I{Resolution Deadline Met?}
    H -->|Yes| J[SLA Met]
    H -->|No| K[Response Breached]
    I -->|Yes| J
    I -->|No| L[Resolution Breached]
\`\`\`

---

### Match Criteria

The conditions a new incident must meet.

---

### SLA Targets

| Target | Description |
|--------|-------------|
| **Response Time** | Time allowed to acknowledge the incident |
| **Resolution Time** | Time allowed to resolve the incident |
| **At-Risk Threshold** | Under **More fields**: how much of a deadline may pass before the SLA is "At Risk" (default: 80%) |

---

### SLA Status Values

| Status | Description |
|--------|-------------|
| **On Track** | Deadlines have not been breached and at-risk threshold not reached |
| **At Risk** | Elapsed time has exceeded the at-risk threshold percentage |
| **Response Breached** | Response deadline was not met |
| **Resolution Breached** | Resolution deadline was not met |
| **Met** | Incident was resolved within all deadlines |

---

### Note Reminders

Under **More fields**, an SLA rule can post internal or public notes at regular intervals while the incident is open, to keep everyone informed.

- **Internal Note Reminders**: Posted to the incident's internal notes
- **Public Note Reminders**: Posted to the incident's public notes (visible on status pages)

Template variables available:
- \`{{incidentTitle}}\` - Incident title
- \`{{incidentNumber}}\` - Incident number
- \`{{elapsedTime}}\` - Time since incident was declared
- \`{{responseDeadline}}\` - Response deadline timestamp
- \`{{resolutionDeadline}}\` - Resolution deadline timestamp
- \`{{slaStatus}}\` - Current SLA status
- \`{{timeToResponseDeadline}}\` - Time remaining to response deadline
- \`{{timeToResolutionDeadline}}\` - Time remaining to resolution deadline
`;

const IncidentSlaRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<IncidentSlaRule>
        // Enable or Disable in each row's ⋯ menu: the one that changes the row.
        rowSwitch={{ column: "isEnabled" }}
        modelType={IncidentSlaRule}
        id="incident-sla-rules-table"
        name="Settings > Incident SLA Rules"
        userPreferencesKey="incident-sla-rules-table"
        saveFilterProps={{
          tableId: "incident-sla-rules-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: "Incident SLA Rules",
          description:
            "Track how fast incidents are acknowledged and resolved. The first rule that matches an incident applies - drag a rule to change its place.",
        }}
        helpContent={{
          title: "How Incident SLA Rules Work",
          description:
            "What an SLA rule tracks, which incidents it applies to, and the notes it can post.",
          markdown: documentationMarkdown,
        }}
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        // Evaluated from the top down; a new rule goes to the end.
        enableDragAndDrop={true}
        dragDropIndexField="order"
        selectMoreFields={{
          isEnabled: true,
        }}
        /*
         * A new rule starts with targets - respond in 15 minutes, resolve
         * in 4 hours - and the name they make. The Create form only: an
         * Edit form shows what the rule stores, an empty target included.
         */
        createInitialValues={getNewSlaRuleValues<IncidentSlaRule>()}
        // An emptied target or note interval is saved as none, not as "".
        onBeforeCreate={async (
          item: IncidentSlaRule,
        ): Promise<IncidentSlaRule> => {
          return clearEmptiedSlaRuleMinutes(item);
        }}
        onBeforeUpdate={async (
          item: IncidentSlaRule,
        ): Promise<IncidentSlaRule> => {
          return clearEmptiedSlaRuleMinutes(item);
        }}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            type: FieldType.Boolean,
          },
        ]}
        /*
         * The targets beside the name: they are what an SLA rule is, and
         * last in the row they sat behind the actions at every width a
         * table scrolls sideways.
         */
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              responseTimeInMinutes: true,
            },
            title: "Response Time (min)",
            type: FieldType.Number,
          },
          {
            field: {
              resolutionTimeInMinutes: true,
            },
            title: "Resolution Time (min)",
            type: FieldType.Number,
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            type: FieldType.Text,
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: IncidentSlaRule): ReactElement => {
              if (item.isEnabled) {
                return <Pill color={Green} text="Enabled" />;
              }
              return <Pill color={Red} text="Disabled" />;
            },
          },
        ]}
        viewPageRoute={Navigation.getCurrentRoute()}
        formSteps={getSlaRuleFormSteps<IncidentSlaRule>()}
        formFields={[
          // Match: drawn as one conditions builder, on "All incidents".
          {
            field: {
              monitors: true,
            },
            title: "Monitors",
            stepId: "match-criteria",
            sectionTitle: "Match by Attributes",
            sectionDescription:
              "Filter incidents by which monitor produced them and their severity/labels. Leave a filter empty to skip it.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Monitor,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Monitors (optional)",
          },
          {
            field: {
              incidentSeverities: true,
            },
            title: "Incident Severities",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: IncidentSeverity,
              labelField: "name",
              valueField: "_id",
              sort: {
                order: SortOrder.Ascending,
              },
            },
            required: false,
            placeholder: "Select Severities (optional)",
          },
          {
            field: {
              incidentLabels: true,
            },
            title: "Incident Labels",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Incident Labels (optional)",
          },
          {
            field: {
              monitorLabels: true,
            },
            title: "Monitor Labels",
            description:
              "Only match incidents whose monitor has one of these labels.",
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
            field: {
              incidentTitlePattern: true,
            },
            title: "Incident Title",
            description: "Leave empty to match any title.",
            stepId: "match-criteria",
            sectionTitle: "Match by Pattern",
            sectionDescription:
              "Case-insensitive regex matched against incident text.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "CPU.*high",
          },
          {
            field: {
              incidentDescriptionPattern: true,
            },
            title: "Incident Description",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "timeout|connection refused",
          },
          /*
           * Targets: the two deadlines, which name the rule ("Respond in 15
           * minutes, resolve in 4 hours") until somebody types a name. No
           * placeholder: an emptied box means the target is not tracked,
           * and a grey "15" in it read as a value.
           */
          {
            field: {
              responseTimeInMinutes: true,
            },
            title: "Response Time (minutes)",
            stepId: "sla-targets",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            description:
              "How long the team has to acknowledge the incident. Leave empty to not track it.",
            onChange: followValueWithRuleName<IncidentSlaRule>({
              column: "responseTimeInMinutes",
              makeName: getSlaRuleName,
            }),
          },
          {
            field: {
              resolutionTimeInMinutes: true,
            },
            title: "Resolution Time (minutes)",
            stepId: "sla-targets",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            description:
              "How long the team has to resolve the incident. Leave empty to not track it.",
            onChange: followValueWithRuleName<IncidentSlaRule>({
              column: "resolutionTimeInMinutes",
              makeName: getSlaRuleName,
            }),
          },
          {
            field: {
              name: true,
            },
            title: "Name",
            description: SLA_RULE_NAME_DESCRIPTION,
            stepId: "sla-targets",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "e.g. Respond in 15 minutes",
            validation: {
              minLength: 2,
              maxLength: RULE_NAME_MAX_LENGTH,
            },
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            stepId: "sla-targets",
            fieldType: FormFieldSchemaType.Toggle,
            // A rule starts on: the switch is on its edit form only.
            doNotShowWhenCreating: true,
            required: false,
            description: "Enable or disable this SLA rule.",
          },
          /*
           * More fields, folded: what most SLA rules leave alone - when the
           * SLA counts as at risk, a description, and notes posted while
           * the incident is open.
           */
          {
            field: {
              atRiskThresholdInPercentage: true,
            },
            title: "At-Risk Threshold (%)",
            stepId: "sla-targets",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "80",
            description:
              "The SLA is at risk once this much of a deadline has passed. Default is 80%.",
            collapsibleSection: SLA_RULE_MORE_FIELDS,
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "sla-targets",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            collapsibleSection: SLA_RULE_MORE_FIELDS,
          },
          {
            field: {
              internalNoteReminderIntervalInMinutes: true,
            },
            title: "Internal Note Reminder Interval (minutes)",
            description:
              "Post an internal note this often while the incident is open. Leave empty for none.",
            stepId: "sla-targets",
            sectionTitle: "Note Reminders",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            collapsibleSection: SLA_RULE_MORE_FIELDS,
          },
          {
            field: {
              internalNoteReminderTemplate: true,
            },
            title: "Internal Note Reminder Template",
            stepId: "sla-targets",
            fieldType: FormFieldSchemaType.Markdown,
            required: false,
            placeholder:
              "**SLA Reminder**: This incident has been open for {{elapsedTime}}...",
            description: IncidentSlaNoteReminderCopy.templateFieldDescription,
            // Every variable the reminder is filled with, under the editor.
            templateVariables: INCIDENT_SLA_NOTE_TEMPLATE_VARIABLE_GROUPS,
            templateVariablesDescription:
              IncidentSlaNoteReminderCopy.templateVariablesDescription,
            collapsibleSection: SLA_RULE_MORE_FIELDS,
          },
          {
            field: {
              publicNoteReminderIntervalInMinutes: true,
            },
            title: "Public Note Reminder Interval (minutes)",
            description:
              "Post a public status update this often while the incident is open. Leave empty for none.",
            stepId: "sla-targets",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            collapsibleSection: SLA_RULE_MORE_FIELDS,
          },
          {
            field: {
              publicNoteReminderTemplate: true,
            },
            title: "Public Note Reminder Template",
            stepId: "sla-targets",
            fieldType: FormFieldSchemaType.Markdown,
            required: false,
            placeholder:
              "**Status Update**: Our team continues to work on resolving this incident...",
            description: IncidentSlaNoteReminderCopy.templateFieldDescription,
            // Every variable the reminder is filled with, under the editor.
            templateVariables: INCIDENT_SLA_NOTE_TEMPLATE_VARIABLE_GROUPS,
            templateVariablesDescription:
              IncidentSlaNoteReminderCopy.templateVariablesDescription,
            collapsibleSection: SLA_RULE_MORE_FIELDS,
          },
        ]}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default IncidentSlaRulesPage;

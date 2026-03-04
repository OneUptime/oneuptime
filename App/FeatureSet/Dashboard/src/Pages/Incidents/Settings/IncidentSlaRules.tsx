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

const documentationMarkdown: string = `
### How Incident SLA Rules Work

SLA (Service Level Agreement) rules automatically track response and resolution times for incidents. When an incident is created, the first matching SLA rule is applied, and deadlines are calculated based on the rule's configuration.

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

Match criteria determines which incidents this SLA rule applies to. An incident must match ALL specified criteria for the rule to apply.

| Criteria | Description |
|----------|-------------|
| **Monitors** | Only incidents from these specific monitors |
| **Severities** | Only incidents with these severity levels |
| **Incident Labels** | Only incidents with at least one of these labels |
| **Monitor Labels** | Only incidents from monitors with at least one of these labels |
| **Title Pattern** | Regex pattern to match incident titles |
| **Description Pattern** | Regex pattern to match incident descriptions |

---

### SLA Targets

| Target | Description |
|--------|-------------|
| **Response Time** | Time allowed to acknowledge the incident |
| **Resolution Time** | Time allowed to resolve the incident |
| **At-Risk Threshold** | Percentage of deadline at which status changes to "At Risk" (default: 80%) |

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

SLA rules can automatically post internal or public notes at regular intervals while the incident remains open. This helps keep stakeholders informed and encourages progress updates.

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
        modelType={IncidentSlaRule}
        id="incident-sla-rules-table"
        name="Settings > Incident SLA Rules"
        userPreferencesKey="incident-sla-rules-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: "Incident SLA Rules",
          description:
            "Define SLA rules to automatically track response and resolution times for incidents. Rules are evaluated in order - lower order numbers are evaluated first.",
        }}
        helpContent={{
          title: "How Incident SLA Rules Work",
          description:
            "Understanding SLA tracking, match criteria, and automatic note reminders",
          markdown: documentationMarkdown,
        }}
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        selectMoreFields={{
          order: true,
          isEnabled: true,
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
              description: true,
            },
            title: "Description",
            type: FieldType.Text,
          },
          {
            field: {
              order: true,
            },
            title: "Order",
            type: FieldType.Number,
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
        ]}
        viewPageRoute={Navigation.getCurrentRoute()}
        formSteps={[
          {
            title: "Basic Info",
            id: "basic-info",
          },
          {
            title: "SLA Targets",
            id: "sla-targets",
          },
          {
            title: "Match Criteria",
            id: "match-criteria",
          },
          {
            title: "Note Reminders",
            id: "note-reminders",
          },
        ]}
        formFields={[
          // Basic Info
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Critical Incident SLA",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "SLA for critical incidents requiring fast response and resolution",
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description: "Enable or disable this SLA rule.",
          },
          // SLA Targets
          {
            field: {
              responseTimeInMinutes: true,
            },
            title: "Response Time (minutes)",
            stepId: "sla-targets",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "15",
            description:
              "Time allowed to acknowledge the incident. Leave empty if response tracking is not needed.",
          },
          {
            field: {
              resolutionTimeInMinutes: true,
            },
            title: "Resolution Time (minutes)",
            stepId: "sla-targets",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "60",
            description:
              "Time allowed to resolve the incident. Leave empty if resolution tracking is not needed.",
          },
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
              "Percentage of deadline at which status changes to 'At Risk'. Default is 80%.",
          },
          // Match Criteria
          {
            field: {
              monitors: true,
            },
            title: "Monitors",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Monitor,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            description:
              "Only apply this SLA to incidents from these monitors. Leave empty to match incidents from any monitor.",
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
            },
            required: false,
            description:
              "Only apply this SLA to incidents with these severities. Leave empty to match incidents of any severity.",
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
            description:
              "Only apply this SLA to incidents that have at least one of these labels. Leave empty to match incidents regardless of labels.",
            placeholder: "Select Incident Labels (optional)",
          },
          {
            field: {
              monitorLabels: true,
            },
            title: "Monitor Labels",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            description:
              "Only apply this SLA to incidents from monitors that have at least one of these labels. Leave empty to match incidents regardless of monitor labels.",
            placeholder: "Select Monitor Labels (optional)",
          },
          {
            field: {
              incidentTitlePattern: true,
            },
            title: "Incident Title Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "CPU.*high",
            description:
              "Regular expression pattern to match incident titles. Leave empty to match any title.",
          },
          {
            field: {
              incidentDescriptionPattern: true,
            },
            title: "Incident Description Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "timeout|connection refused",
            description:
              "Regular expression pattern to match incident descriptions. Leave empty to match any description.",
          },
          // Note Reminders
          {
            field: {
              internalNoteReminderIntervalInMinutes: true,
            },
            title: "Internal Note Reminder Interval (minutes)",
            stepId: "note-reminders",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "30",
            description:
              "Post an internal note reminder at this interval while the incident is open. Leave empty to disable internal note reminders.",
          },
          {
            field: {
              internalNoteReminderTemplate: true,
            },
            title: "Internal Note Reminder Template",
            stepId: "note-reminders",
            fieldType: FormFieldSchemaType.Markdown,
            required: false,
            placeholder:
              "**SLA Reminder**: This incident has been open for {{elapsedTime}}...",
            description:
              "Markdown template for internal note reminders. Use template variables like {{incidentTitle}}, {{elapsedTime}}, etc.",
          },
          {
            field: {
              publicNoteReminderIntervalInMinutes: true,
            },
            title: "Public Note Reminder Interval (minutes)",
            stepId: "note-reminders",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "60",
            description:
              "Post a public note reminder at this interval while the incident is open. Leave empty to disable public note reminders.",
          },
          {
            field: {
              publicNoteReminderTemplate: true,
            },
            title: "Public Note Reminder Template",
            stepId: "note-reminders",
            fieldType: FormFieldSchemaType.Markdown,
            required: false,
            placeholder:
              "**Status Update**: Our team continues to work on resolving this incident...",
            description:
              "Markdown template for public note reminders. Use template variables like {{incidentTitle}}, {{elapsedTime}}, etc.",
          },
        ]}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default IncidentSlaRulesPage;

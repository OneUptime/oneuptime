import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import IncidentReminderRule from "Common/Models/DatabaseModels/IncidentReminderRule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ReminderStopState from "Common/Types/Reminder/ReminderStopState";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";

const documentationMarkdown: string = `
### How Incident Reminder Rules Work

Reminder rules periodically re-notify incident owners while an incident is still open. When an incident is created, the first matching rule (by order) is applied, and reminders are sent to incident owners at the configured interval until the incident reaches the stop state.

\`\`\`mermaid
flowchart TD
    A[Incident Created] --> B{Match Against Reminder Rules}
    B -->|Rule Matches| C[Schedule Reminder]
    B -->|No Match| D[No Reminders]
    C --> E[Wait for Interval]
    E --> F{Incident Reached Stop State?}
    F -->|No| G[Notify Incident Owners]
    G --> E
    F -->|Yes| H[Stop Reminders]
\`\`\`

---

### Match Criteria

| Criteria | Description |
|----------|-------------|
| **Severities** | Only incidents with these severity levels. Leave empty to match all severities. |

Rules are evaluated in order - the first matching rule wins.

---

### Stop State

| State | Description |
|-------|-------------|
| **Acknowledged** | Stop reminders once the incident is acknowledged |
| **Resolved** | Keep reminding until the incident is resolved (default) |
`;

const IncidentReminderRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<IncidentReminderRule>
        modelType={IncidentReminderRule}
        id="incident-reminder-rules-table"
        name="Settings > Incident Reminder Rules"
        userPreferencesKey="incident-reminder-rules-table"
        saveFilterProps={{
          tableId: "incident-reminder-rules-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: "Reminder Rules",
          description:
            "Periodically remind incident owners while an incident is still open. Rules are evaluated in order — the first matching rule wins.",
        }}
        helpContent={{
          title: "How Incident Reminder Rules Work",
          description:
            "Understanding reminder intervals, match criteria, and stop states",
          markdown: documentationMarkdown,
        }}
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        selectMoreFields={{
          order: true,
          isEnabled: true,
          labels: {
            name: true,
            color: true,
          },
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
              order: true,
            },
            title: "Order",
            type: FieldType.Number,
          },
          {
            field: {
              reminderIntervalInMinutes: true,
            },
            title: "Reminder Interval (min)",
            type: FieldType.Number,
          },
          {
            field: {
              stopRemindersOnState: true,
            },
            title: "Stop Reminders When",
            type: FieldType.Text,
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.Element,
            getElement: (item: IncidentReminderRule): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: IncidentReminderRule): ReactElement => {
              if (item.isEnabled) {
                return <Pill color={Green} text="Enabled" />;
              }
              return <Pill color={Red} text="Disabled" />;
            },
          },
        ]}
        viewPageRoute={Navigation.getCurrentRoute()}
        formSteps={
          [
            {
              id: "rule-info",
              title: "Rule Info",
            },
            {
              id: "match-criteria",
              title: "Match Criteria",
            },
            {
              id: "reminder-settings",
              title: "Reminder Settings",
            },
            {
              id: "status",
              title: "Status",
            },
          ] as Array<FormStep<IncidentReminderRule>>
        }
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "rule-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Critical Incident Reminders",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "rule-info",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "Remind owners of critical incidents every 30 minutes until resolved",
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
            placeholder: "Select Severities (optional)",
            description:
              "Only apply this rule to incidents with these severities. Leave empty to match incidents of any severity.",
          },
          {
            field: {
              labels: true,
            },
            title: "Labels",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Labels (optional)",
            description:
              "Only apply this rule to incidents with these labels. Leave empty to match incidents with any labels.",
          },
          {
            field: {
              reminderIntervalInMinutes: true,
            },
            title: "Reminder Interval (minutes)",
            stepId: "reminder-settings",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "30",
            description:
              "How often to remind incident owners while the incident is open.",
          },
          {
            field: {
              stopRemindersOnState: true,
            },
            title: "Stop Reminders When",
            stepId: "reminder-settings",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(ReminderStopState),
            required: false,
            placeholder: "Resolved",
            description:
              "Stop sending reminders once the incident reaches this state. Defaults to Resolved.",
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            stepId: "status",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description: "Enable or disable this reminder rule.",
          },
        ]}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default IncidentReminderRulesPage;

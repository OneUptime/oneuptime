import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import IncidentReminderRule from "Common/Models/DatabaseModels/IncidentReminderRule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ReminderStopStateText from "../../../Components/Reminders/ReminderStopStateText";
import {
  getReminderRuleActionFields,
  getReminderRuleFormSteps,
} from "../../../Utils/Form/EventRuleForm";

const documentationMarkdown: string = `
### How Incident Reminder Rules Work

A reminder rule reminds an incident's owners, as often as it says, while the incident is open. A new incident gets the first rule that matches it, from the top of the list down, and its reminders stop as the rule's **Stop Reminders When** says: once the incident is resolved, or once someone acknowledges it.

\`\`\`mermaid
flowchart TD
    A[Incident Created] --> B{Match Against Reminder Rules}
    B -->|Rule Matches| C[Schedule Reminder]
    B -->|No Match| D[No Reminders]
    C --> E[Wait for Interval]
    E --> F{Time to Stop?}
    F -->|No| G[Notify Incident Owners]
    G --> E
    F -->|Yes| H[Stop Reminders]
\`\`\`

---

### Match Criteria

| Criteria | Description |
|----------|-------------|
| **Severities** | Only incidents with these severity levels. |
| **Labels** | Only incidents with at least one of these labels. |

Rules are evaluated from the top of the list down - the first matching rule wins. Drag a rule by its handle to change its place; a new rule is added to the end.

---

### Stop Reminders When

| Answer | What it does |
|--------|--------------|
| **Resolved** | Keep reminding until the incident is resolved. A new rule starts here. |
| **Acknowledged** | Stop once someone acknowledges the incident. |
`;

const IncidentReminderRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<IncidentReminderRule>
        // Enable or Disable in each row's ⋯ menu: the one that changes the row.
        rowSwitch={{ column: "isEnabled" }}
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
            "How often an open incident's owners are reminded, and until when.",
          markdown: documentationMarkdown,
        }}
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        /*
         * The first rule that matches wins, so where a rule sits matters:
         * drag it up or down. A new rule goes to the end.
         */
        enableDragAndDrop={true}
        dragDropIndexField="order"
        selectMoreFields={{
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
              reminderIntervalInMinutes: true,
            },
            title: "Reminder Interval (min)",
            type: FieldType.Number,
          },
          // The answer as the form words it, in the reader's language.
          {
            field: {
              stopRemindersOnState: true,
            },
            title: "Stop Reminders When",
            type: FieldType.Element,
            getElement: (item: IncidentReminderRule): ReactElement => {
              return (
                <ReminderStopStateText value={item.stopRemindersOnState} />
              );
            },
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
        formSteps={getReminderRuleFormSteps<IncidentReminderRule>()}
        formFields={[
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
          ...getReminderRuleActionFields<IncidentReminderRule>("incident"),
        ]}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default IncidentReminderRulesPage;

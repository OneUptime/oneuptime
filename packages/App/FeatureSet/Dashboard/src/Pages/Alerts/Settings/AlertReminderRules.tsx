import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import AlertReminderRule from "Common/Models/DatabaseModels/AlertReminderRule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ReminderStopStateText from "../../../Components/Reminders/ReminderStopStateText";
import {
  getReminderRuleActionFields,
  getReminderRuleFormSteps,
} from "../../../Utils/Form/EventRuleForm";

const documentationMarkdown: string = `
### How Alert Reminder Rules Work

A reminder rule reminds an alert's owners, as often as it says, while the alert is open. A new alert gets the first rule that matches it, from the top of the list down, and its reminders stop as the rule's **Stop Reminders When** says: once the alert is resolved, or once someone acknowledges it.

\`\`\`mermaid
flowchart TD
    A[Alert Created] --> B{Match Against Reminder Rules}
    B -->|Rule Matches| C[Schedule Reminder]
    B -->|No Match| D[No Reminders]
    C --> E[Wait for Interval]
    E --> F{Time to Stop?}
    F -->|No| G[Notify Alert Owners]
    G --> E
    F -->|Yes| H[Stop Reminders]
\`\`\`

---

### Match Criteria

| Criteria | Description |
|----------|-------------|
| **Severities** | Only alerts with these severity levels. |
| **Labels** | Only alerts with at least one of these labels. |

Rules are evaluated from the top of the list down - the first matching rule wins. Drag a rule by its handle to change its place; a new rule is added to the end.

---

### Stop Reminders When

| Answer | What it does |
|--------|--------------|
| **Resolved** | Keep reminding until the alert is resolved. A new rule starts here. |
| **Acknowledged** | Stop once someone acknowledges the alert. |
`;

const AlertReminderRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<AlertReminderRule>
        modelType={AlertReminderRule}
        // Enable or Disable in each row's ⋯ menu: the one that changes the row.
        rowSwitch={{ column: "isEnabled" }}
        id="alert-reminder-rules-table"
        name="Settings > Alert Reminder Rules"
        userPreferencesKey="alert-reminder-rules-table"
        saveFilterProps={{
          tableId: "alert-reminder-rules-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: "Reminder Rules",
          description:
            "Periodically remind alert owners while an alert is still open. Rules are evaluated in order — the first matching rule wins.",
        }}
        helpContent={{
          title: "How Alert Reminder Rules Work",
          description:
            "How often an open alert's owners are reminded, and until when.",
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
            getElement: (item: AlertReminderRule): ReactElement => {
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
            getElement: (item: AlertReminderRule): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: AlertReminderRule): ReactElement => {
              if (item.isEnabled) {
                return <Pill color={Green} text="Enabled" />;
              }
              return <Pill color={Red} text="Disabled" />;
            },
          },
        ]}
        viewPageRoute={Navigation.getCurrentRoute()}
        formSteps={getReminderRuleFormSteps<AlertReminderRule>()}
        formFields={[
          {
            field: {
              alertSeverities: true,
            },
            title: "Alert Severities",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: AlertSeverity,
              labelField: "name",
              valueField: "_id",
              sort: {
                order: SortOrder.Ascending,
              },
            },
            required: false,
            placeholder: "Select Severities",
            description:
              "Only apply this rule to alerts with these severities. Leave empty to match alerts of any severity.",
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
            placeholder: "Select Labels",
            description:
              "Only apply this rule to alerts with these labels. Leave empty to match alerts with any labels.",
          },
          ...getReminderRuleActionFields<AlertReminderRule>("alert"),
        ]}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default AlertReminderRulesPage;

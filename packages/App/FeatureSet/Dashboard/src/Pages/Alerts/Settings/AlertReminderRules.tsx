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
A reminder rule keeps reminding an alert's owners, as often as it says, until the alert is resolved or acknowledged.

## How It Works

- A new alert gets the first rule that matches it, from the top of the list down. Drag a rule by its handle to change its place; a new rule goes to the end.
- Its owners are reminded at the rule's interval while the alert is open, until the rule's **Stop Reminders When** says to stop.
- An alert no rule matches gets no reminders.

## Match Criteria

| Condition | Matches |
|-----------|---------|
| **Severities** | Alerts with one of these severities |
| **Labels** | Alerts with at least one of these labels |

## Stop Reminders When

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

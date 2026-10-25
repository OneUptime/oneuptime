import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ScheduledMaintenanceReminderRule from "Common/Models/DatabaseModels/ScheduledMaintenanceReminderRule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";
import LabelsElement from "Common/UI/Components/Label/Labels";
import { getReminderRuleFormSteps } from "../../../Utils/Form/EventRuleForm";
import { getMaintenanceReminderRuleActionFields } from "../../../Components/Reminders/MaintenanceReminderRuleFields";
import { MAINTENANCE_REMINDER_TIMING_FIELD_TITLE } from "../../../Components/Reminders/MaintenanceReminderTiming";
import MaintenanceReminderTimingText from "../../../Components/Reminders/MaintenanceReminderTimingText";

const documentationMarkdown: string = `
### How Scheduled Maintenance Reminder Rules Work

A reminder rule reminds a maintenance event's owners, as often as it says. A new event gets the first rule that matches it, from the top of the list down, and its reminders go out when the rule's **Remind Owners** says: before the event starts, while it is in progress, or both.

\`\`\`mermaid
flowchart TD
    A[Maintenance Event Created] --> B{Match Against Reminder Rules}
    B -->|Rule Matches| C[Schedule Reminder]
    B -->|No Match| D[No Reminders]
    C --> E[Wait for Interval]
    E --> F{Time to Stop?}
    F -->|No| G[Notify Event Owners]
    G --> E
    F -->|Yes| H[Stop Reminders]
\`\`\`

---

### Match Criteria

| Criteria | Description |
|----------|-------------|
| **Labels** | Only events with these labels. Leave empty to match all events. |

Rules are evaluated from the top of the list down - the first matching rule wins. Drag a rule by its handle to change its place; a new rule is added to the end.

---

### Remind Owners

| Answer | When reminders are sent |
|--------|-------------------------|
| **While it is in progress** | From when the event starts until it ends. A new rule starts here. |
| **Before it starts** | From when the event is scheduled until it starts. |
| **Before it starts and while it is in progress** | From when the event is scheduled until it ends. |
`;

const ScheduledMaintenanceReminderRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<ScheduledMaintenanceReminderRule>
        modelType={ScheduledMaintenanceReminderRule}
        // Enable or Disable in each row's ⋯ menu: the one that changes the row.
        rowSwitch={{ column: "isEnabled" }}
        id="scheduled-maintenance-reminder-rules-table"
        name="Settings > Scheduled Maintenance Reminder Rules"
        userPreferencesKey="scheduled-maintenance-reminder-rules-table"
        saveFilterProps={{
          tableId: "scheduled-maintenance-reminder-rules-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: "Reminder Rules",
          description:
            "Periodically remind scheduled maintenance event owners while an event has not yet finished. Rules are evaluated in order — the first matching rule wins.",
        }}
        helpContent={{
          title: "How Scheduled Maintenance Reminder Rules Work",
          description: "How often an event's owners are reminded, and when.",
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
          // With remindWhileScheduled, the answer the Remind Owners column says.
          stopRemindersOnState: true,
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
          /*
           * When the rule reminds, as the form asks it: one answer read off
           * the rule's two columns (MaintenanceReminderTiming).
           */
          {
            field: {
              remindWhileScheduled: true,
            },
            title: MAINTENANCE_REMINDER_TIMING_FIELD_TITLE,
            type: FieldType.Element,
            getElement: (
              item: ScheduledMaintenanceReminderRule,
            ): ReactElement => {
              return <MaintenanceReminderTimingText rule={item} />;
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
            getElement: (
              item: ScheduledMaintenanceReminderRule,
            ): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (
              item: ScheduledMaintenanceReminderRule,
            ): ReactElement => {
              if (item.isEnabled) {
                return <Pill color={Green} text="Enabled" />;
              }
              return <Pill color={Red} text="Disabled" />;
            },
          },
        ]}
        viewPageRoute={Navigation.getCurrentRoute()}
        formSteps={getReminderRuleFormSteps<ScheduledMaintenanceReminderRule>()}
        formFields={[
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
              "Only apply this rule to scheduled maintenance events with these labels. Leave empty to match events with any labels.",
          },
          ...getMaintenanceReminderRuleActionFields(),
        ]}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default ScheduledMaintenanceReminderRulesPage;

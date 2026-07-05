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
import ScheduledMaintenanceReminderStopState from "Common/Types/Reminder/ScheduledMaintenanceReminderStopState";

const documentationMarkdown: string = `
### How Scheduled Maintenance Reminder Rules Work

Reminder rules periodically re-notify scheduled maintenance event owners while an event has not yet finished. When an event is created, the first matching rule (by order) is applied, and reminders are sent to the event's owners at the configured interval until the event reaches the stop state.

\`\`\`mermaid
flowchart TD
    A[Maintenance Event Created] --> B{Match Against Reminder Rules}
    B -->|Rule Matches| C[Schedule Reminder]
    B -->|No Match| D[No Reminders]
    C --> E[Wait for Interval]
    E --> F{Event Reached Stop State?}
    F -->|No| G[Notify Event Owners]
    G --> E
    F -->|Yes| H[Stop Reminders]
\`\`\`

---

### Match Criteria

| Criteria | Description |
|----------|-------------|
| **Labels** | Only events with these labels. Leave empty to match all events. |

Rules are evaluated in order - the first matching rule wins.

---

### Stop State

| State | Description |
|-------|-------------|
| **Ongoing** | Stop reminders once the event starts (enters an ongoing state) |
| **Completed** | Keep reminding until the event is completed (default) |

---

### Reminder Timing

By default, reminders only begin once the event starts (enters an ongoing state). Enable **Remind While Event is Scheduled** on a rule to also send reminders while the event is still upcoming (before it starts).
`;

const ScheduledMaintenanceReminderRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<ScheduledMaintenanceReminderRule>
        modelType={ScheduledMaintenanceReminderRule}
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
          description:
            "Understanding reminder intervals, match criteria, and stop states",
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
              remindWhileScheduled: true,
            },
            title: "Remind While Scheduled",
            type: FieldType.Boolean,
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
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Maintenance Event Reminders",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "Remind owners of maintenance events every 30 minutes until completed",
          },
          {
            field: {
              labels: true,
            },
            title: "Labels",
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
          {
            field: {
              reminderIntervalInMinutes: true,
            },
            title: "Reminder Interval (minutes)",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "30",
            description:
              "How often to remind event owners while the event has not yet finished.",
          },
          {
            field: {
              stopRemindersOnState: true,
            },
            title: "Stop Reminders When",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: [
              {
                value: ScheduledMaintenanceReminderStopState.Ongoing,
                label: "Stop when event starts (Ongoing)",
              },
              {
                value: ScheduledMaintenanceReminderStopState.Completed,
                label: "Remind until event is Completed",
              },
            ],
            required: false,
            placeholder: "Completed",
            description:
              "Stop sending reminders once the event reaches this state. Defaults to Completed.",
          },
          {
            field: {
              remindWhileScheduled: true,
            },
            title: "Remind While Event is Scheduled",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Send reminders while the event is still scheduled (before it starts). When off, reminders only begin once the event has started.",
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
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

export default ScheduledMaintenanceReminderRulesPage;

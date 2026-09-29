import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import Label from "Common/Models/DatabaseModels/Label";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import NextReminderCountdown, {
  ReminderRuleScope,
} from "../../../Components/Reminders/NextReminderCountdown";

const ScheduledMaintenanceDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CardModelDetail
        name="Scheduled Maintenance Settings"
        cardProps={{
          title: "Scheduled Maintenance Settings",
          description: "Manage your scheduled maintenance event settings here.",
        }}
        editButtonText="Edit Settings"
        isEditable={true}
        formFields={[
          {
            field: {
              isVisibleOnStatusPage: true,
            },
            title: "Visible on Status Page",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: ScheduledMaintenance,
          id: "model-detail-incident-settings",
          fields: [
            {
              field: {
                isVisibleOnStatusPage: true,
              },
              title: "Visible on Status Page",
              fieldType: FieldType.Boolean,
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail
        name="Reminders"
        cardProps={{
          title: "Reminders",
          description:
            "Control reminder notifications for this scheduled maintenance event.",
        }}
        isEditable={true}
        editButtonText="Edit Reminders"
        formFields={[
          {
            field: {
              enableReminders: true,
            },
            title: "Enable Reminders",
            description:
              "If enabled, reminder notifications are sent to this event's owners based on the project's reminder rules until the event is completed.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: ScheduledMaintenance,
          id: "model-detail-scheduled-maintenance-reminders",
          fields: [
            {
              field: {
                enableReminders: true,
              },
              title: "Enable Reminders",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                nextReminderNotificationAt: true,
              },
              title: "Next Reminder In",
              fieldType: FieldType.Element,
              getElement: (item: ScheduledMaintenance): ReactElement => {
                return (
                  <NextReminderCountdown
                    nextReminderAt={item.nextReminderNotificationAt}
                    scope={ReminderRuleScope.ScheduledMaintenance}
                    labelIds={(item.labels || []).map((label: Label) => {
                      return label.id!;
                    })}
                    remindersEnabled={item.enableReminders !== false}
                  />
                );
              },
            },
            {
              field: {
                reminderNotificationSentCount: true,
              },
              title: "Reminders Sent",
              fieldType: FieldType.Number,
            },
          ],
          selectMoreFields: {
            labels: {
              _id: true,
            },
          },
          modelId: modelId,
        }}
      />
    </Fragment>
  );
};

export default ScheduledMaintenanceDelete;

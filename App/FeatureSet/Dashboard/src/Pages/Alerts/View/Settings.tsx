import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Alert from "Common/Models/DatabaseModels/Alert";
import React, { FunctionComponent, ReactElement } from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";

const AlertSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <CardModelDetail
      name="Reminders"
      cardProps={{
        title: "Reminders",
        description: "Control reminder notifications for this alert.",
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
            "If enabled, reminder notifications are sent to this alert's owners based on the project's reminder rules while the alert is still open.",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
        },
      ]}
      modelDetailProps={{
        showDetailsInNumberOfColumns: 1,
        modelType: Alert,
        id: "model-detail-alert-reminders",
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
            title: "Next Reminder At",
            fieldType: FieldType.DateTime,
          },
          {
            field: {
              reminderNotificationSentCount: true,
            },
            title: "Reminders Sent",
            fieldType: FieldType.Number,
          },
        ],
        modelId: modelId,
      }}
    />
  );
};

export default AlertSettings;

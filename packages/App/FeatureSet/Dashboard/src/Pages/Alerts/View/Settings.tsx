import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Alert from "Common/Models/DatabaseModels/Alert";
import Label from "Common/Models/DatabaseModels/Label";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import NextReminderCountdown, {
  ReminderRuleScope,
} from "../../../Components/Reminders/NextReminderCountdown";

const AlertSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CardModelDetail
        name="Alert Settings"
        cardProps={{
          title: "Alert Settings",
          description: "Manage settings for this alert here.",
        }}
        isEditable={true}
        editButtonText="Edit Settings"
        formFields={[
          {
            field: {
              isPrivate: true,
            },
            title: "Private Alert",
            description:
              "If enabled, only the alert's owner users and members of its owner teams (plus project admins and owners) can view this alert.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: Alert,
          id: "model-detail-alert-settings",
          fields: [
            {
              field: {
                isPrivate: true,
              },
              title: "Private Alert",
              description:
                "Visible only to owners (users + members of owner teams), project admins, and project owners.",
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
              title: "Next Reminder In",
              fieldType: FieldType.Element,
              getElement: (item: Alert): ReactElement => {
                return (
                  <NextReminderCountdown
                    nextReminderAt={item.nextReminderNotificationAt}
                    severityId={item.alertSeverityId}
                    labelIds={(item.labels || []).map((label: Label) => {
                      return label.id!;
                    })}
                    scope={ReminderRuleScope.Alert}
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
            alertSeverityId: true,
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

export default AlertSettings;

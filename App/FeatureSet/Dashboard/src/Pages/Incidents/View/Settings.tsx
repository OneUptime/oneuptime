import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Incident from "Common/Models/DatabaseModels/Incident";
import Label from "Common/Models/DatabaseModels/Label";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import NextReminderCountdown, {
  ReminderRuleScope,
} from "../../../Components/Reminders/NextReminderCountdown";

const IncidentDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CardModelDetail
        name="Incident Settings"
        cardProps={{
          title: "Incident Settings",
          description: "Manage settings for this incident here.",
        }}
        isEditable={true}
        editButtonText="Edit Settings"
        formFields={[
          {
            field: {
              isVisibleOnStatusPage: true,
            },
            title: "Visible on Status Page",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          {
            field: {
              isPrivate: true,
            },
            title: "Private Incident",
            description:
              "If enabled, only the incident's owner users and members of its owner teams (plus project admins and owners) can view this incident. Private incidents are automatically hidden from all status pages.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: Incident,
          id: "model-detail-incident-settings",
          fields: [
            {
              field: {
                isVisibleOnStatusPage: true,
              },
              title: "Visible on Status Page",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                isPrivate: true,
              },
              title: "Private Incident",
              description:
                "Visible only to owners (users + members of owner teams), project admins, and project owners. Hidden from status pages.",
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
          description: "Control reminder notifications for this incident.",
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
              "If enabled, reminder notifications are sent to this incident's owners based on the project's reminder rules while the incident is still open.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: Incident,
          id: "model-detail-incident-reminders",
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
              getElement: (item: Incident): ReactElement => {
                return (
                  <NextReminderCountdown
                    nextReminderAt={item.nextReminderNotificationAt}
                    severityId={item.incidentSeverityId}
                    labelIds={(item.labels || []).map((label: Label) => {
                      return label.id!;
                    })}
                    scope={ReminderRuleScope.Incident}
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
            incidentSeverityId: true,
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

export default IncidentDelete;

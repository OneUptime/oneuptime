import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "CommonUI/src/Components/ModelDetail/CardModelDetail";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import Navigation from "CommonUI/src/Utils/Navigation";
import StatusPage from "Model/Models/StatusPage";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CardModelDetail<StatusPage>
        name="Status Page > Settings"
        cardProps={{
          title: "Incident Settings",
          description: "Incident Settings for Status Page",
        }}
        editButtonText="Edit Settings"
        isEditable={true}
        formFields={[
          {
            field: {
              showIncidentHistoryInDays: true,
            },
            title: "Show Incident History (in days)",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "14",
          },
          {
            field: {
              showIncidentLabelsOnStatusPage: true,
            },
            title: "Show Incident Labels",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page",
          fields: [
            {
              field: {
                showIncidentHistoryInDays: true,
              },
              fieldType: FieldType.Number,
              title: "Show Incident History (in days)",
            },
            {
              field: {
                showIncidentLabelsOnStatusPage: true,
              },
              fieldType: FieldType.Boolean,
              title: "Show Incident Labels",
              placeholder: "No",
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail<StatusPage>
        name="Status Page > Settings"
        cardProps={{
          title: "Announcement Settings",
          description: "Announcement Settings for Status Page",
        }}
        editButtonText="Edit Settings"
        isEditable={true}
        formFields={[
          {
            field: {
              showAnnouncementHistoryInDays: true,
            },
            title: "Show Announcement History (in days)",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "14",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page",
          fields: [
            {
              field: {
                showAnnouncementHistoryInDays: true,
              },
              fieldType: FieldType.Number,
              title: "Show Announcement History (in days)",
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail<StatusPage>
        name="Status Page > Settings"
        cardProps={{
          title: "Scheduled Event Settings",
          description: "Scheduled Event Settings for Status Page",
        }}
        editButtonText="Edit Settings"
        isEditable={true}
        formFields={[
          {
            field: {
              showScheduledEventHistoryInDays: true,
            },
            title: "Show Scheduled Event History (in days)",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "14",
          },
          {
            field: {
              showScheduledEventLabelsOnStatusPage: true,
            },
            title: "Show Event Labels",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page",
          fields: [
            {
              field: {
                showScheduledEventHistoryInDays: true,
              },
              fieldType: FieldType.Number,
              title: "Show Scheduled Event History (in days)",
            },
            {
              field: {
                showScheduledEventLabelsOnStatusPage: true,
              },
              fieldType: FieldType.Boolean,
              title: "Show Event Labels",
              placeholder: "No",
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail<StatusPage>
        name="Status Page > Settings"
        cardProps={{
          title: "Powered By OneUptime Branding",
          description: "Show or hide the Powered By OneUptime Branding",
        }}
        editButtonText="Edit Settings"
        isEditable={true}
        formFields={[
          {
            field: {
              hidePoweredByOneUptimeBranding: true,
            },
            title: "Hide Powered By OneUptime Branding",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            placeholder: "No",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page",
          fields: [
            {
              field: {
                hidePoweredByOneUptimeBranding: true,
              },
              fieldType: FieldType.Boolean,
              title: "Hide Powered By OneUptime Branding",
            },
          ],
          modelId: modelId,
        }}
      />
    </Fragment>
  );
};

export default StatusPageDelete;

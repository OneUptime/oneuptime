import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const StatusPageDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
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
              showIncidentsOnStatusPage: true,
            },
            title: "Show Incidents",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
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
                showIncidentsOnStatusPage: true,
              },
              fieldType: FieldType.Boolean,
              title: "Show Incidents",
              placeholder: "No",
            },
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
          title: "Episode Settings",
          description: "Episode Settings for Status Page",
        }}
        editButtonText="Edit Settings"
        isEditable={true}
        formFields={[
          {
            field: {
              showEpisodesOnStatusPage: true,
            },
            title: "Show Episodes",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          {
            field: {
              showEpisodeHistoryInDays: true,
            },
            title: "Show Episode History (in days)",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "14",
          },
          {
            field: {
              showEpisodeLabelsOnStatusPage: true,
            },
            title: "Show Episode Labels",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page-episodes",
          fields: [
            {
              field: {
                showEpisodesOnStatusPage: true,
              },
              fieldType: FieldType.Boolean,
              title: "Show Episodes",
              placeholder: "No",
            },
            {
              field: {
                showEpisodeHistoryInDays: true,
              },
              fieldType: FieldType.Number,
              title: "Show Episode History (in days)",
            },
            {
              field: {
                showEpisodeLabelsOnStatusPage: true,
              },
              fieldType: FieldType.Boolean,
              title: "Show Episode Labels",
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
              showAnnouncementsOnStatusPage: true,
            },
            title: "Show Announcements",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
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
                showAnnouncementsOnStatusPage: true,
              },
              fieldType: FieldType.Boolean,
              title: "Show Announcements",
              placeholder: "No",
            },
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
              showScheduledMaintenanceEventsOnStatusPage: true,
            },
            title: "Show Scheduled Maintenance Events",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
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
                showScheduledMaintenanceEventsOnStatusPage: true,
              },
              fieldType: FieldType.Boolean,
              title: "Show Scheduled Maintenance Events",
              placeholder: "No",
            },
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
          title: "Subscriber Settings",
          description: "Subscriber Settings for Status Page",
        }}
        editButtonText="Edit Settings"
        isEditable={true}
        formFields={[
          {
            field: {
              showSubscriberPageOnStatusPage: true,
            },
            title: "Show Subscriber Page",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          {
            field: {
              enableEmailSubscribers: true,
            },
            title: "Enable Email Subscribers",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          {
            field: {
              enableSmsSubscribers: true,
            },
            title: "Enable SMS Subscribers",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          {
            field: {
              enableSlackSubscribers: true,
            },
            title: "Enable Slack Subscribers",
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
                showSubscriberPageOnStatusPage: true,
              },
              fieldType: FieldType.Boolean,
              title: "Show Subscriber Page",
              placeholder: "No",
            },
            {
              field: {
                enableEmailSubscribers: true,
              },
              fieldType: FieldType.Boolean,
              title: "Enable Email Subscribers",
              placeholder: "No",
            },
            {
              field: {
                enableSmsSubscribers: true,
              },
              fieldType: FieldType.Boolean,
              title: "Enable SMS Subscribers",
              placeholder: "No",
            },
            {
              field: {
                enableSlackSubscribers: true,
              },
              fieldType: FieldType.Boolean,
              title: "Enable Slack Subscribers",
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

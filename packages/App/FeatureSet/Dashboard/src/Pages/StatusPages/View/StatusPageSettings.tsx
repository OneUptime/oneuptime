import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import IncidentStatusPageScopeCopy from "../../../Components/Incident/IncidentStatusPageScopeCopy";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import { STATUS_PAGE_ARCHIVE_COPY } from "../../../Components/Archive/ResourceArchiveCopy";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";

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
        formSteps={[
          { title: "Incidents", id: "incidents" },
          { title: "Labels & Scope", id: "labels-and-scope" },
        ]}
        formFields={[
          {
            field: {
              showIncidentsOnStatusPage: true,
            },
            title: "Show Incidents",
            stepId: "incidents",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          {
            field: {
              showIncidentHistoryInDays: true,
            },
            title: "Show Incident History (in days)",
            stepId: "incidents",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "14",
          },
          {
            field: {
              showIncidentLabelsOnStatusPage: true,
            },
            title: "Show Incident Labels",
            stepId: "labels-and-scope",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          /*
           * For a page on a monitor shared with other pages: incidents that
           * are not limited to any page - including the ones monitors,
           * Slack, Teams, the API and AI create - never reach it.
           */
          {
            field: {
              onlyShowScopedIncidents: true,
            },
            title: IncidentStatusPageScopeCopy.onlyShowScopedIncidentsTitle,
            stepId: "labels-and-scope",
            description:
              IncidentStatusPageScopeCopy.onlyShowScopedIncidentsDescription,
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
            {
              field: {
                onlyShowScopedIncidents: true,
              },
              fieldType: FieldType.Boolean,
              title: IncidentStatusPageScopeCopy.onlyShowScopedIncidentsTitle,
              description:
                IncidentStatusPageScopeCopy.onlyShowScopedIncidentsDescription,
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
          title: "Uptime History Settings",
          description:
            "Configure how many days of uptime history to show on the status page",
        }}
        editButtonText="Edit Settings"
        isEditable={true}
        formFields={[
          {
            field: {
              showUptimeHistoryInDays: true,
            },
            title: "Show Uptime History (in days)",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "90",
            validation: {
              minValue: 1,
              maxValue: 90,
            },
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page-uptime-history",
          fields: [
            {
              field: {
                showUptimeHistoryInDays: true,
              },
              fieldType: FieldType.Number,
              title: "Show Uptime History (in days)",
            },
          ],
          modelId: modelId,
        }}
      />

      {/*
       * Whether the page shows a Subscribe link, and which channels visitors
       * can use there, are switched in one place: the Channels card on
       * Subscribers -> Subscriber Settings. This page had a second copy.
       */}
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

      {/*
       * Last on the page: taking the page offline is a decision about the
       * page as a whole, not one more thing it shows.
       */}
      <ArchiveResourceCard<StatusPage>
        modelType={StatusPage}
        modelId={modelId}
        singularName={STATUS_PAGE_ARCHIVE_COPY.singularName}
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.STATUS_PAGES] as Route,
        )}
        archiveCardDescription={STATUS_PAGE_ARCHIVE_COPY.archiveCardDescription}
        unarchiveCardDescription={
          STATUS_PAGE_ARCHIVE_COPY.unarchiveCardDescription
        }
        archiveConfirmMessage={STATUS_PAGE_ARCHIVE_COPY.archiveConfirmMessage}
        unarchiveConfirmMessage={
          STATUS_PAGE_ARCHIVE_COPY.unarchiveConfirmMessage
        }
      />
    </Fragment>
  );
};

export default StatusPageDelete;

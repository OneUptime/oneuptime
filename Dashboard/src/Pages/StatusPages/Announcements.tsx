import DashboardNavigation from "../../Utils/Navigation";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <ModelTable<StatusPageAnnouncement>
        modelType={StatusPageAnnouncement}
        id="table-status-page-note"
        isDeleteable={true}
        isCreateable={true}
        showViewIdButton={true}
        isEditable={true}
        name="Status Page > Announcements"
        isViewable={false}
        query={{
          projectId: DashboardNavigation.getProjectId()!,
        }}
        cardProps={{
          title: "Announcements",
          description:
            "Here are announcements for this status page. This will show up on the status page.",
        }}
        noItemsMessage={"No announcements found."}
        formSteps={[
          {
            title: "Basic",
            id: "basic",
          },
          {
            title: "More",
            id: "more",
          },
        ]}
        formFields={[
          {
            field: {
              title: true,
            },
            title: "Announcement Title",
            stepId: "basic",
            description: "Title of announcement",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Title",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "basic",
            fieldType: FormFieldSchemaType.Markdown,
            required: false,
            description: "Add an announcement note. This is in Markdown.",
          },
          {
            field: {
              showAnnouncementAt: true,
            },
            stepId: "more",
            title: "Start Showing Announcement At",
            fieldType: FormFieldSchemaType.DateTime,
            required: true,
            placeholder: "Pick Date and Time",
          },
          {
            field: {
              endAnnouncementAt: true,
            },
            stepId: "more",
            title: "End Showing Announcement At",
            fieldType: FormFieldSchemaType.DateTime,
            required: false,
            placeholder: "Pick Date and Time",
          },
          {
            field: {
              shouldStatusPageSubscribersBeNotified: true,
            },

            title: "Notify Status Page Subscribers",
            stepId: "more",
            description: "Should status page subscribers be notified?",
            fieldType: FormFieldSchemaType.Checkbox,
            defaultValue: true,
            required: false,
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              title: true,
            },
            title: "Title",
            type: FieldType.Text,
          },
          {
            field: {
              showAnnouncementAt: true,
            },
            title: "Show Announcement At",
            type: FieldType.Date,
          },
          {
            field: {
              endAnnouncementAt: true,
            },
            title: "End Announcement At",
            type: FieldType.Date,
          },
          {
            field: {
              shouldStatusPageSubscribersBeNotified: true,
            },
            title: "Subscribers Notified",
            type: FieldType.Boolean,
          },
        ]}
        columns={[
          {
            field: {
              title: true,
            },
            title: "Title",
            type: FieldType.Text,
          },
          {
            field: {
              showAnnouncementAt: true,
            },
            title: "Show Announcement At",
            type: FieldType.DateTime,
          },
          {
            field: {
              endAnnouncementAt: true,
            },
            title: "End Announcement At",
            type: FieldType.DateTime,
            noValueMessage: "-",
          },
          {
            field: {
              shouldStatusPageSubscribersBeNotified: true,
            },
            title: "Subscribers Notified",
            type: FieldType.Boolean,
          },
        ]}
      />
    </Fragment>
  );
};

export default StatusPageDelete;

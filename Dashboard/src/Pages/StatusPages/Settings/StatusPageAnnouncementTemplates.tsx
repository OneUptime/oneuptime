import MarkdownUtil from "Common/UI/Utils/Markdown";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import StatusPageAnnouncementTemplate from "Common/Models/DatabaseModels/StatusPageAnnouncementTemplate";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import StatusPagesElement from "../../../Components/StatusPage/StatusPagesElement";
import { RouteUtil } from "../../../Utils/RouteMap";

const StatusPageAnnouncementTemplates: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <ModelTable<StatusPageAnnouncementTemplate>
        modelType={StatusPageAnnouncementTemplate}
        id="status-page-announcement-templates-table"
        userPreferencesKey="status-page-announcement-templates-table"
        name="Settings > Status Page Announcement Templates"
        isDeleteable={false}
        viewPageRoute={RouteUtil.populateRouteParams(props.pageRoute)}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        cardProps={{
          title: "Status Page Announcement Templates",
          description:
            "Here is a list of all the status page announcement templates in this project.",
        }}
        noItemsMessage={"No status page announcement templates found."}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        showViewIdButton={true}
        formSteps={[
          {
            title: "Template Info",
            id: "template-info",
          },
          {
            title: "Announcement Details",
            id: "announcement-details",
          },
          {
            title: "Status Pages",
            id: "status-pages",
          },
          {
            title: "Resources Affected",
            id: "resources-affected",
          },
          {
            title: "Notification Settings",
            id: "notification-settings",
          },
        ]}
        formFields={[
          {
            field: {
              templateName: true,
            },
            title: "Template Name",
            stepId: "template-info",
            description: "Name of the announcement template",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Template Name",
          },
          {
            field: {
              templateDescription: true,
            },
            title: "Template Description",
            stepId: "template-info",
            description: "Description of the announcement template",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Template Description",
          },
          {
            field: {
              title: true,
            },
            title: "Announcement Title",
            stepId: "announcement-details",
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
            stepId: "announcement-details",
            fieldType: FormFieldSchemaType.Markdown,
            required: false,
            description: MarkdownUtil.getMarkdownCheatsheet(
              "Add an announcement note",
            ),
          },
          {
            field: {
              statusPages: true,
            },
            title: "Show announcement on these status pages ",
            stepId: "status-pages",
            description: "Select status pages to show this announcement on",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: StatusPage,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Status Pages",
          },
          {
            field: {
              monitors: true,
            },
            title: "Monitors affected (Optional)",
            stepId: "resources-affected",
            description:
              "Select monitors affected by this announcement template. If none selected, all subscribers will be notified.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Monitor,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Monitors (Optional)",
          },
          {
            field: {
              shouldStatusPageSubscribersBeNotified: true,
            },
            title: "Notify Subscribers",
            stepId: "notification-settings",
            description:
              "Should status page subscribers be notified when this announcement is created?",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        showRefreshButton={true}
        filters={[
          {
            field: {
              templateName: true,
            },
            title: "Template Name",
            type: FieldType.Text,
          },
          {
            field: {
              title: true,
            },
            title: "Announcement Title",
            type: FieldType.Text,
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created",
            type: FieldType.Date,
          },
        ]}
        columns={[
          {
            field: {
              templateName: true,
            },
            title: "Template Name",
            type: FieldType.Text,
          },
          {
            field: {
              title: true,
            },
            title: "Announcement Title",
            type: FieldType.Text,
          },
          {
            field: {
              statusPages: {
                _id: true,
                name: true,
              },
            },
            title: "Status Pages",
            type: FieldType.Element,
            getElement: (
              item: StatusPageAnnouncementTemplate,
            ): ReactElement => {
              return (
                <StatusPagesElement statusPages={item.statusPages || []} />
              );
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created",
            type: FieldType.DateTime,
          },
        ]}
      />
    </Fragment>
  );
};

export default StatusPageAnnouncementTemplates;

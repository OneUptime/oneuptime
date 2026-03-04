import MarkdownUtil from "Common/UI/Utils/Markdown";
import PageMap from "../../../Utils/PageMap";
import RouteMap from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPageAnnouncementTemplate from "Common/Models/DatabaseModels/StatusPageAnnouncementTemplate";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import StatusPagesElement from "../../../Components/StatusPage/StatusPagesElement";
import CheckboxViewer from "Common/UI/Components/Checkbox/CheckboxViewer";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";

const StatusPageAnnouncementTemplateView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return (
    <Fragment>
      {/* Status Page Announcement Template View  */}
      <CardModelDetail<StatusPageAnnouncementTemplate>
        name="Status Page Announcement Template Details"
        cardProps={{
          title: "Status Page Announcement Template Details",
          description:
            "Here are more details for this status page announcement template.",
        }}
        createEditModalWidth={ModalWidth.Large}
        isEditable={true}
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
            title: "Show announcement on these status pages",
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
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: StatusPageAnnouncementTemplate,
          id: "model-detail-status-page-announcement-template",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Status Page Announcement Template ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                templateName: true,
              },
              title: "Template Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                templateDescription: true,
              },
              title: "Template Description",
              fieldType: FieldType.Text,
            },
            {
              field: {
                title: true,
              },
              title: "Announcement Title",
              fieldType: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Announcement Description",
              fieldType: FieldType.Markdown,
            },
            {
              field: {
                statusPages: {
                  name: true,
                  _id: true,
                },
              },
              title: "Shown on Status Pages",
              fieldType: FieldType.Element,
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
                shouldStatusPageSubscribersBeNotified: true,
              },
              title: "Notify Status Page Subscribers",
              fieldType: FieldType.Boolean,
              getElement: (
                item: StatusPageAnnouncementTemplate,
              ): ReactElement => {
                return (
                  <CheckboxViewer
                    isChecked={
                      item.shouldStatusPageSubscribersBeNotified as boolean
                    }
                    text={
                      item.shouldStatusPageSubscribersBeNotified
                        ? "Notify Subscribers"
                        : "Do Not Notify Subscribers"
                    }
                  />
                );
              },
            },
            {
              field: {
                createdAt: true,
              },
              title: "Created",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                updatedAt: true,
              },
              title: "Updated",
              fieldType: FieldType.DateTime,
            },
          ],
          modelId: modelId,
        }}
      />

      <ModelDelete
        modelType={StatusPageAnnouncementTemplate}
        modelId={Navigation.getLastParamAsObjectID()}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteMap[
              PageMap.STATUS_PAGES_SETTINGS_ANNOUNCEMENT_TEMPLATES
            ] as Route,
          );
        }}
      />
    </Fragment>
  );
};

export default StatusPageAnnouncementTemplateView;

import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { RouteUtil } from "../../Utils/RouteMap";
import DropdownUtil from "Common/UI/Utils/Dropdown";

const SubscriberNotificationTemplates: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <ModelTable<StatusPageSubscriberNotificationTemplate>
        modelType={StatusPageSubscriberNotificationTemplate}
        id="subscriber-notification-templates-table"
        userPreferencesKey="subscriber-notification-templates-table"
        name="Settings > Subscriber Notification Templates"
        isDeleteable={false}
        viewPageRoute={RouteUtil.populateRouteParams(props.pageRoute)}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        cardProps={{
          title: "Subscriber Notification Templates",
          description:
            "Create custom notification templates for status page subscribers. These templates allow you to customize the messages sent via Email, SMS, Slack, Microsoft Teams, and Webhooks for different event types.",
        }}
        noItemsMessage={"No subscriber notification templates found."}
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
            title: "Template Settings",
            id: "template-settings",
          },
          {
            title: "Template Content",
            id: "template-content",
          },
        ]}
        formFields={[
          {
            field: {
              templateName: true,
            },
            title: "Template Name",
            stepId: "template-info",
            description: "A friendly name for this notification template",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "My Custom Template",
          },
          {
            field: {
              templateDescription: true,
            },
            title: "Template Description",
            stepId: "template-info",
            description: "Optional description for this template",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description of what this template is used for",
          },
          {
            field: {
              eventType: true,
            },
            title: "Event Type",
            stepId: "template-settings",
            description:
              "Select the type of event this template will be used for",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              StatusPageSubscriberNotificationEventType,
            ),
            required: true,
            placeholder: "Select Event Type",
          },
          {
            field: {
              notificationMethod: true,
            },
            title: "Notification Method",
            stepId: "template-settings",
            description:
              "Select the notification method (Email, SMS, Slack, Microsoft Teams, or Webhook)",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              StatusPageSubscriberNotificationMethod,
            ),
            required: true,
            placeholder: "Select Notification Method",
          },
          {
            field: {
              emailSubject: true,
            },
            title: "Email Subject",
            stepId: "template-content",
            description:
              "Subject line for email notifications. Only used when notification method is Email. You can use template variables like {{incidentTitle}}.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "{{statusPageName}}: {{incidentTitle}}",
          },
          {
            field: {
              templateBody: true,
            },
            title: "Template Body",
            stepId: "template-content",
            description:
              "The template content. For Email: Use HTML. For SMS: Use plain text. For Slack/Teams: Use Markdown. You can use template variables like {{incidentTitle}}, {{statusPageName}}, etc.",
            fieldType: FormFieldSchemaType.HTML,
            required: true,
            placeholder:
              "<p>Hello {{subscriberName}},</p><p>{{incidentTitle}} has been created.</p>",
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
              eventType: true,
            },
            title: "Event Type",
            type: FieldType.Dropdown,
            filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              StatusPageSubscriberNotificationEventType,
            ),
          },
          {
            field: {
              notificationMethod: true,
            },
            title: "Notification Method",
            type: FieldType.Dropdown,
            filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              StatusPageSubscriberNotificationMethod,
            ),
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
              eventType: true,
            },
            title: "Event Type",
            type: FieldType.Text,
          },
          {
            field: {
              notificationMethod: true,
            },
            title: "Notification Method",
            type: FieldType.Text,
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

export default SubscriberNotificationTemplates;

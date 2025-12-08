import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Card from "Common/UI/Components/Card/Card";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";

const SubscriberNotificationTemplateView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const templateVariablesHelp: string = `## Template Variables

You can use the following variables in your templates depending on the event type:

### Common Variables (all events)
- \`{{statusPageName}}\` - Name of the status page
- \`{{statusPageUrl}}\` - URL of the status page
- \`{{unsubscribeUrl}}\` - URL for subscribers to unsubscribe

### Incident Events
- \`{{incidentTitle}}\` - Title of the incident
- \`{{incidentDescription}}\` - Description of the incident
- \`{{incidentSeverity}}\` - Severity level of the incident
- \`{{incidentState}}\` - Current state of the incident
- \`{{incidentCreatedAt}}\` - When the incident was created

### Scheduled Maintenance Events
- \`{{scheduledMaintenanceTitle}}\` - Title of the scheduled maintenance
- \`{{scheduledMaintenanceDescription}}\` - Description
- \`{{scheduledMaintenanceStartsAt}}\` - Start time
- \`{{scheduledMaintenanceEndsAt}}\` - End time
- \`{{scheduledMaintenanceState}}\` - Current state

### Announcement Events
- \`{{announcementTitle}}\` - Title of the announcement
- \`{{announcementDescription}}\` - Description of the announcement`;

  return (
    <Fragment>
      {/* Template Variables Help */}
      <Card
        title="Template Variables Reference"
        description="Available variables you can use in your template body and email subject."
      >
        <MarkdownViewer text={templateVariablesHelp} />
      </Card>

      {/* Subscriber Notification Template View  */}
      <CardModelDetail<StatusPageSubscriberNotificationTemplate>
        name="Subscriber Notification Template Details"
        cardProps={{
          title: "Subscriber Notification Template Details",
          description:
            "Here are more details for this subscriber notification template.",
        }}
        createEditModalWidth={ModalWidth.Large}
        isEditable={true}
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
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(
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
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(
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
              "The template content. For Email: Use HTML. For SMS: Use plain text. For Slack/Teams: Use Markdown. You can use template variables.",
            fieldType: FormFieldSchemaType.HTML,
            required: true,
            placeholder: "<p>Hello,</p><p>{{incidentTitle}} has been created.</p>",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: StatusPageSubscriberNotificationTemplate,
          id: "model-detail-subscriber-notification-template",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Template ID",
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
                eventType: true,
              },
              title: "Event Type",
              fieldType: FieldType.Text,
            },
            {
              field: {
                notificationMethod: true,
              },
              title: "Notification Method",
              fieldType: FieldType.Text,
            },
            {
              field: {
                emailSubject: true,
              },
              title: "Email Subject",
              fieldType: FieldType.Text,
            },
            {
              field: {
                templateBody: true,
              },
              title: "Template Body",
              fieldType: FieldType.HTML,
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
        modelType={StatusPageSubscriberNotificationTemplate}
        modelId={Navigation.getLastParamAsObjectID()}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteMap[
              PageMap.SETTINGS_STATUS_PAGE_SUBSCRIBER_NOTIFICATION_TEMPLATES
            ] as Route,
          );
        }}
      />
    </Fragment>
  );
};

export default SubscriberNotificationTemplateView;
